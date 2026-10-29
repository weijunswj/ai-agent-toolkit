'use strict';

// The shell-call closure matrix and the commit-and-push chain checks, through attributionDecision and
// through both shell hooks as processes. Fake credentials are built from pieces at run time.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const { spawnSync } = childProcess;
const test = require('node:test');
const { BYPASS_MESSAGE, FORCE_MESSAGE, MESSAGE, attributionDecision, outgoingRefusal } = require('../scripts/toolkit-attribution-guard.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');
const trailer = 'Co-Authored-By: Claude <noreply@anthropic.com>';
const fakeToken = () => ['gh', 'p_', 'A1b2C3d4E5f6G7h8'.repeat(2), 'Q9r0'].join('');
const quiet = () => ({ notes: [] });
const claudeHook = path.join(repoRoot, 'repo', 'scripts', 'toolkit-claude-attribution-hook.cjs');
const codexHook = path.join(repoRoot, 'repo', 'scripts', 'toolkit-codex-helper-hook.cjs');
const runHook = (hook, tool, cwd, command, env = process.env) => spawnSync(process.execPath, [hook], { input: JSON.stringify({ tool_name: tool, cwd, tool_input: { command } }), encoding: 'utf8', env });

function fixtureGit(cwd, args, hooks) {
  return childProcess.execFileSync('git', ['-c', 'user.name=Fixture Author', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${hooks}`, '-c', 'init.defaultBranch=main', '-c', 'core.fsmonitor=false', ...args], { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
}

function writeFiles(root, files) {
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }
}

// The closure matrix for every shell-call shape the two hosts send (R1 to R9) against the checks
// that judge commits, pushes and pull requests (C1 to C5). Codex rows name the folder the command
// runs in as workdir, with the session folder elsewhere, so a check that judged the session folder
// would let them through. Each row runs through attributionDecision and through its host's hook as a
// process.
test('matrix: every host shape gets the attribution, bypass, force-push and push checks in the folder the command runs in', (t) => {
  const support = require('./toolkit-governed-fixture-support.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-shell-matrix-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const governed = support.makeGoverned(path.join(dir, 'governed'), 'shell-matrix');
  const session = path.join(dir, 'session');
  fs.mkdirSync(session);
  const hooks = path.join(dir, 'no-hooks');
  fs.mkdirSync(hooks);
  writeFiles(governed, { 'body.md': 'Summary\n\nGenerated with [Claude Code](https://claude.com/claude-code)\n', 'uat-config.txt': `token = "${fakeToken()}"\n` });
  fixtureGit(governed, ['checkout', '--quiet', '-b', 'feature'], hooks);
  fixtureGit(governed, ['add', '-A'], hooks);
  fixtureGit(governed, ['commit', '--quiet', '-m', 'fixture'], hooks);
  const checks = [
    ['C1 attribution in git commit -m', `git commit -m x -m "${trailer}"`, (reason) => reason === MESSAGE],
    ['C2 attribution in a body file read from the run folder', 'gh pr create --body-file body.md', (reason) => reason === MESSAGE],
    ['C3 bypass in a governed repository', 'git commit --no-verify -m x', (reason) => reason === BYPASS_MESSAGE],
    ['C4 force push in a governed repository', 'git push --force origin feature', (reason) => reason === FORCE_MESSAGE],
    ['C4 force push to an evidence store', 'git push https://github.com/owner/TRANSPORT-evidence.git +feature', (reason) => reason === FORCE_MESSAGE],
    ['C5 push of a committed credential', 'git push origin feature', (reason) => /uat-config\.txt:1 /.test(reason)],
  ];
  const rows = [
    ['R1 Claude Bash', claudeHook, (command) => ({ tool_name: 'Bash', cwd: governed, tool_input: { command } })],
    ['R2 Claude PowerShell', claudeHook, (command) => ({ tool_name: 'PowerShell', cwd: governed, tool_input: { command } })],
    ['R3 Codex Bash command', codexHook, (command) => ({ tool_name: 'Bash', cwd: governed, tool_input: { command, workdir: governed } })],
    ['R4 Codex Bash cmd and workdir', codexHook, (command) => ({ tool_name: 'Bash', cwd: session, tool_input: { cmd: command, workdir: governed } })],
    ['R5 Codex exec_command', codexHook, (command) => ({ tool_name: 'exec_command', cwd: session, tool_input: { cmd: command, workdir: governed } })],
    ['R6 Codex shell, bash -lc', codexHook, (command) => ({ tool_name: 'shell', cwd: session, tool_input: { command: ['bash', '-lc', command], workdir: governed } })],
    ['R6 Codex local_shell, pwsh -Command', codexHook, (command) => ({ tool_name: 'local_shell', cwd: session, tool_input: { command: ['pwsh', '-NoProfile', '-Command', command], workdir: governed } })],
    ['R8 Codex relative workdir', codexHook, (command) => ({ tool_name: 'exec_command', cwd: dir, tool_input: { cmd: command, workdir: 'governed' } })],
    ['R9 Codex command and cmd both given', codexHook, (command) => ({ tool_name: 'Bash', cwd: session, tool_input: { command: 'git status', cmd: command, workdir: governed } })],
  ];
  const env = { ...process.env };
  delete env.TOOLKIT_GIT_PATH;
  for (const [row, hookPath, shape] of rows) {
    for (const [check, command, expected] of checks) {
      const input = shape(command);
      const direct = attributionDecision(input, quiet()).hookSpecificOutput?.permissionDecisionReason || '';
      assert.ok(expected(direct), `${row} x ${check}: attributionDecision gave ${JSON.stringify(direct)}`);
      const hook = spawnSync(process.execPath, [hookPath], { input: JSON.stringify(input), encoding: 'utf8', env, timeout: 60000 });
      assert.equal(hook.status, 2, `${row} x ${check}: ${hook.stderr}`);
      const reason = JSON.parse(hook.stdout.trim().split('\n').pop()).hookSpecificOutput.permissionDecisionReason;
      // The Codex hook runs the governance gate first. It reads a word list unquoted too, and refuses a
      // continuation-like word list that names Claude before the attribution check sees it, as before.
      const gateFirst = Array.isArray(input.tool_input.command) && /claude/i.test(command) && /^Toolkit: the selected session's repository could not be verified/.test(reason);
      assert.ok(expected(reason) || gateFirst, `${row} x ${check}: the hook gave ${JSON.stringify(reason)}`);
    }
  }
  // R7: an argument list without a shell, the shape of the force push the owner's probe sent.
  const argv = { tool_name: 'shell', cwd: session, tool_input: { command: ['git', 'push', '--force', 'origin', 'feature'], workdir: governed } };
  assert.equal(attributionDecision(argv, quiet()).hookSpecificOutput?.permissionDecisionReason, FORCE_MESSAGE, 'R7');
  // Allowed controls in the same rows: an ordinary commit that mentions Claude, and git status.
  for (const [row, , shape] of rows) {
    for (const command of ['git commit -m "Document how Claude Code reads AGENTS.md"', 'git status']) {
      assert.deepEqual(attributionDecision(shape(command), quiet()), {}, `${row}: ${command}`);
    }
  }
  // The run folder decides, not the session folder: a force push run outside the governed repository passes.
  assert.deepEqual(attributionDecision({ tool_name: 'exec_command', cwd: governed, tool_input: { cmd: 'git push --force origin feature', workdir: session } }, quiet()), {}, 'R8');
});

// Commit and push in one shell command: the check runs before the commit exists, so it also reads
// what the commit could add. Each case gets its own clone with main pushed and a feature branch.
function chainRepos(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-push-chain-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const hooks = path.join(dir, 'no-hooks');
  fs.mkdirSync(hooks);
  const git = (cwd, ...args) => fixtureGit(cwd, args, hooks);
  let count = 0;
  const clone = () => {
    const name = `case-${count += 1}`;
    const origin = path.join(dir, `${name}-origin.git`);
    const work = path.join(dir, name);
    git(dir, 'init', '--quiet', '--bare', origin);
    git(dir, 'init', '--quiet', work);
    writeFiles(work, { 'README.md': 'A fixture.\n' });
    git(work, 'add', '-A');
    git(work, 'commit', '--quiet', '-m', 'base');
    git(work, 'remote', 'add', 'origin', origin);
    git(work, 'push', '--quiet', '-u', 'origin', 'main');
    git(work, 'checkout', '--quiet', '-b', 'feature');
    return work;
  };
  return { dir, git, clone };
}

test('commit and push in one command: what the commit could add is refused before it is sent', (t) => {
  const { dir, git, clone } = chainRepos(t);
  const secret = `token = "${fakeToken()}"\n`;
  const newFile = (repo) => writeFiles(repo, { 'uat-config.txt': secret });
  const refused = [
    ['add; commit; push', newFile, 'git add -A; git commit -m x; git push origin feature', /uat-config\.txt:1 \(not committed yet\): /],
    ['add && commit -m && push', newFile, 'git add . && git commit -m "x" && git push origin feature', /uat-config\.txt:1 \(not committed yet\)/],
    ['newline-separated lines', newFile, 'git add -A\ngit commit -m x\ngit push origin feature', /uat-config\.txt:1 \(not committed yet\)/],
    ['commit -am && push, a tracked file', (repo) => writeFiles(repo, { 'README.md': secret }), 'git commit -am x && git push origin feature', /README\.md:1 \(not committed yet\)/],
    ['commit; push with only staged changes', (repo) => { newFile(repo); git(repo, 'add', 'uat-config.txt'); }, 'git commit -m x; git push origin feature', /uat-config\.txt:1 \(not committed yet\)/],
    ['nested bash -c', newFile, 'bash -c "git add -A && git commit -m x && git push origin feature"', /uat-config\.txt:1 \(not committed yet\)/],
    ['nested pwsh -Command', newFile, 'pwsh -Command "git add -A; git commit -m x; git push origin feature"', /uat-config\.txt:1 \(not committed yet\)/],
    ['git -C from another folder', newFile, null, /uat-config\.txt:1 \(not committed yet\)/],
    ['a new pull request after the commit', (repo) => { newFile(repo); git(repo, 'add', '-A'); }, 'git commit -m x && gh pr create --fill', /uat-config\.txt:1 \(not committed yet\)/],
  ];
  for (const [name, prepare, command, expected] of refused) {
    const repo = clone();
    prepare(repo);
    const line = command || `git -C "${repo}" add -A && git -C "${repo}" commit -m x && git -C "${repo}" push origin feature`;
    const reason = outgoingRefusal(line, command ? repo : dir, quiet());
    assert.match(reason, expected, name);
    assert.match(reason, /If that file will not be in this commit, run the commit and the push as separate commands\./, name);
  }
  // A first commit in a new repository: there is no commit to read yet, only what it could add.
  const fresh = path.join(dir, 'fresh');
  git(dir, 'init', '--quiet', fresh);
  newFile(fresh);
  assert.match(outgoingRefusal('git add -A && git commit -m init && git push -u origin main', fresh, quiet()), /uat-config\.txt:1 \(not committed yet\)/, 'first commit');
  // Through both shell hooks as processes, Bash and PowerShell separators.
  for (const [tool, command] of [['Bash', 'git add -A && git commit -m x && git push origin feature'], ['PowerShell', 'git add -A; git commit -m x; git push origin feature']]) {
    const repo = clone();
    newFile(repo);
    const result = runHook(claudeHook, tool, repo, command);
    assert.equal(result.status, 2, `${tool}: ${result.stderr}`);
    assert.match(JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason, /uat-config\.txt:1 \(not committed yet\)/, tool);
  }
});

test('commit and push in one command: clean changes, unadded files and other repositories pass; merges before a push are refused', (t) => {
  const { dir, git, clone } = chainRepos(t);
  const secret = `token = "${fakeToken()}"\n`;
  let repo = clone();
  writeFiles(repo, { 'notes.txt': 'Plain words only.\n' });
  assert.equal(outgoingRefusal('git add -A; git commit -m x; git push origin feature', repo, quiet()), '', 'the same steps with no credential');
  repo = clone();
  writeFiles(repo, { 'notes.txt': 'Plain words only.\n' });
  git(repo, 'add', 'notes.txt');
  writeFiles(repo, { 'uat-config.txt': secret });
  assert.equal(outgoingRefusal('git commit -m x; git push origin feature', repo, quiet()), '', 'an untracked file with no git add in the command is not committed');
  const other = clone();
  writeFiles(other, { 'uat-config.txt': secret });
  repo = clone();
  assert.equal(outgoingRefusal(`git -C "${other}" add -A; git -C "${other}" commit -m x; git push origin feature`, repo, quiet()), '', 'a commit in another repository');
  repo = clone();
  for (const step of ['merge main', 'cherry-pick main', 'revert HEAD', 'am patch.mbox', 'rebase main']) {
    assert.match(outgoingRefusal(`git ${step}; git push origin feature`, repo, quiet()), new RegExp(`runs \`git ${step.split(' ')[0]}\` before the push in the same command.*Run the push as its own command after this finishes\\.`), step);
  }
  assert.match(outgoingRefusal('git merge main && gh pr create --fill', repo, quiet()), /Run the `gh pr create` as its own command/);
  assert.equal(outgoingRefusal('git pull; git push origin feature', repo, quiet()), '', 'a pull brings in only what a remote already has');
  assert.equal(outgoingRefusal('git push origin feature; git merge main', repo, quiet()), '', 'a merge after the push changes nothing it sends');
});

// A Windows folder as Git Bash writes it: C:\Users\x -> /c/Users/x (or /cygdrive/c/Users/x).
const gitBashPath = (folder, prefix = '') => `${prefix}/${folder[0].toLowerCase()}${folder.slice(2).replace(/\\/g, '/')}`;

test('Git Bash drive paths in cd, git -C and file options reach every check in the right folder', { skip: process.platform !== 'win32' && 'Git Bash drive paths are a Windows form' }, (t) => {
  const support = require('./toolkit-governed-fixture-support.cjs');
  const { clone } = chainRepos(t);
  const session = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-drive-session-'));
  t.after(() => fs.rmSync(session, { recursive: true, force: true }));
  for (const prefix of ['', '/cygdrive']) {
    const repo = clone();
    writeFiles(repo, { 'uat-config.txt': `token = "${fakeToken()}"\n` });
    fixtureGit(repo, ['add', '-A'], path.join(path.dirname(repo), 'no-hooks'));
    fixtureGit(repo, ['commit', '--quiet', '-m', 'key'], path.join(path.dirname(repo), 'no-hooks'));
    const drive = gitBashPath(repo, prefix);
    for (const command of [`cd ${drive} && git push origin feature`, `git -C ${drive} push origin feature`, `git -C "${drive}" push origin feature`]) {
      assert.match(outgoingRefusal(command, session, quiet()), /uat-config\.txt:1 \(commit [0-9a-f]{7}\)/, `${prefix || 'git bash'}: ${command}`);
      // The UAT forms, through the Claude Code hook as a process.
      const result = runHook(claudeHook, 'Bash', session, command);
      assert.equal(result.status, 2, `${command}: ${result.stderr}`);
      assert.match(JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason, /uat-config\.txt:1 /, command);
    }
  }
  // Bypass, force push and a body file named by a Git Bash path, in a governed repository.
  const governed = support.makeGoverned(path.join(session, 'governed'), 'drive-paths');
  writeFiles(governed, { 'body.md': 'Summary\n\nGenerated with [Claude Code](https://claude.com/claude-code)\n' });
  const drive = gitBashPath(governed);
  assert.equal(attributionDecision({ tool_name: 'Bash', cwd: session, tool_input: { command: `git -C ${drive} push --force origin feature` } }, quiet()).hookSpecificOutput?.permissionDecisionReason, FORCE_MESSAGE);
  assert.equal(attributionDecision({ tool_name: 'Bash', cwd: session, tool_input: { command: `cd ${drive} && git commit --no-verify -m x` } }, quiet()).hookSpecificOutput?.permissionDecisionReason, BYPASS_MESSAGE);
  assert.equal(attributionDecision({ tool_name: 'Bash', cwd: session, tool_input: { command: `gh pr create --body-file ${drive}/body.md` } }, quiet()).hookSpecificOutput?.permissionDecisionReason, MESSAGE);
  assert.equal(attributionDecision({ tool_name: 'exec_command', cwd: session, tool_input: { cmd: 'git push --force origin feature', workdir: drive } }, quiet()).hookSpecificOutput?.permissionDecisionReason, FORCE_MESSAGE, 'a Codex workdir in Git Bash form');
});

test('a leading ~ is the home folder for every check; a folder written as a variable is refused as unreadable', (t) => {
  const support = require('./toolkit-governed-fixture-support.cjs');
  // A scratch home for this process and the hooks it starts, never the real one.
  const home = support.governedHome();
  assert.equal(path.resolve(os.homedir()), path.resolve(home));
  const { clone } = chainRepos(t);
  const session = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-home-session-'));
  t.after(() => fs.rmSync(session, { recursive: true, force: true }));
  const repo = path.join(home, 'tilde-repo');
  fs.cpSync(clone(), repo, { recursive: true });
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  writeFiles(repo, { 'uat-config.txt': `token = "${fakeToken()}"\n` });
  fixtureGit(repo, ['add', '-A'], session);
  fixtureGit(repo, ['commit', '--quiet', '-m', 'key'], session);
  for (const command of ['cd ~/tilde-repo && git push origin feature', 'git -C ~/tilde-repo push origin feature', 'git -C ~\\tilde-repo push origin feature', 'cd ~/tilde-repo && gh pr create --fill']) {
    assert.match(outgoingRefusal(command, session, quiet()), /uat-config\.txt:1 \(commit [0-9a-f]{7}\)/, command);
    const result = runHook(claudeHook, 'Bash', session, command);
    assert.equal(result.status, 2, `${command}: ${result.stderr}`);
    assert.match(JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason, /uat-config\.txt:1 /, command);
  }
  const governed = support.makeGoverned(path.join(home, 'tilde-governed'), 'tilde-paths');
  t.after(() => fs.rmSync(governed, { recursive: true, force: true }));
  writeFiles(home, { 'tilde-msg.txt': `Fix\n\n${trailer}\n` });
  t.after(() => fs.rmSync(path.join(home, 'tilde-msg.txt'), { force: true }));
  assert.equal(attributionDecision({ tool_name: 'Bash', cwd: session, tool_input: { command: 'cd ~/tilde-governed && git commit --no-verify -m x' } }, quiet()).hookSpecificOutput?.permissionDecisionReason, BYPASS_MESSAGE);
  assert.equal(attributionDecision({ tool_name: 'Bash', cwd: session, tool_input: { command: 'git commit -F ~/tilde-msg.txt' } }, quiet()).hookSpecificOutput?.permissionDecisionReason, MESSAGE);
  // Written with a variable or a command, the folder cannot be read: refused, saying so.
  const pushCheck = require('../scripts/toolkit-push-check.cjs');
  for (const command of ['cd $HOME/tilde-repo && git push origin feature', 'git -C "$(pwd)/x" push', 'cd $env:USERPROFILE\\tilde-repo; git push origin feature']) {
    assert.equal(outgoingRefusal(command, session, quiet()), pushCheck.FOLDER_UNREADABLE, command);
  }
  assert.match(pushCheck.FOLDER_UNREADABLE, /could not read the folder .* variable or a command/);
});

test('a push whose folder does not exist is refused, not let through unchecked, in both hooks', (t) => {
  const session = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-missing-folder-'));
  t.after(() => fs.rmSync(session, { recursive: true, force: true }));
  const missing = path.join(session, 'no-such-folder');
  const pushCheck = require('../scripts/toolkit-push-check.cjs');
  for (const command of [`git -C "${missing}" push origin main`, `cd "${missing}" && git push`, `cd "${missing}" && gh pr create --fill`]) {
    assert.equal(outgoingRefusal(command, session, quiet()), pushCheck.FOLDER_MISSING, command);
    for (const hook of [claudeHook, codexHook]) {
      const result = runHook(hook, 'Bash', session, command);
      assert.equal(result.status, 2, `${path.basename(hook)} ${command}: ${result.stderr}`);
      assert.match(JSON.parse(result.stdout.trim().split('\n').pop()).hookSpecificOutput.permissionDecisionReason, /could not find the folder this push or pull request runs in/, command);
    }
  }
  assert.equal(outgoingRefusal('git status', session, quiet()), '', 'a command that sends nothing');
  // A folder the same command creates first: the refusal says to run that step on its own.
  assert.match(outgoingRefusal(`mkdir "${missing}" && cd "${missing}" && git init && git push origin main`, session, quiet()), /run that step as its own command, then the push/);
});

test('push check: every target of one command shares one deadline', () => {
  const deadlines = [];
  const check = (target, options) => { deadlines.push(options.deadline); return {}; };
  assert.equal(outgoingRefusal('git push origin a; git push origin b; gh pr create --fill', os.tmpdir(), { notes: [], budgetMs: 5000, check }), '');
  assert.equal(deadlines.length, 3);
  assert.equal(new Set(deadlines).size, 1, 'one deadline');
  assert.ok(deadlines[0] > Date.now() && deadlines[0] <= Date.now() + 5000);
});
