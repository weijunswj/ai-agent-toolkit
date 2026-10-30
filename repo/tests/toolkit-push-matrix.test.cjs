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
      const gateFirst = Array.isArray(input.tool_input.command) && /claude/i.test(command) && /^Toolkit: this command could resume or fork a Claude or Codex session/.test(reason);
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

// A governed repository whose main checkout (on `feature`) has two lane worktrees under its ignored
// .tmp/: lane/one with a new, uncommitted credential file, lane/two with a committed one. Its `uat`
// remote is a bare copy made from `main`, so the merge hold's default-branch rule stays out.
function laneRepos(t, { lanes = true } = {}) {
  const support = require('./toolkit-governed-fixture-support.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-push-lanes-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const hooks = path.join(dir, 'no-hooks');
  fs.mkdirSync(hooks);
  const git = (cwd, ...args) => fixtureGit(cwd, args, hooks);
  const repo = support.makeGoverned(path.join(dir, 'governed'), `push-lanes-${lanes ? 'two' : 'one'}`);
  writeFiles(repo, { '.gitignore': '.tmp/\n', 'notes.txt': 'Plain words only.\n' });
  git(repo, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  git(repo, 'add', '-A');
  git(repo, 'commit', '--quiet', '-m', 'base');
  const lane = (name) => path.join(repo, '.tmp', 'worktrees', name);
  if (lanes) {
    git(repo, 'branch', 'spare');
    for (const name of ['one', 'two']) {
      git(repo, 'branch', `lane/${name}`);
      git(repo, 'worktree', 'add', '--quiet', lane(`lane-${name}`), `lane/${name}`);
    }
  }
  git(dir, 'clone', '--quiet', '--bare', repo, path.join(dir, 'uat.git'));
  git(repo, 'remote', 'add', 'uat', path.join(dir, 'uat.git'));
  git(repo, 'fetch', '--quiet', 'uat');
  git(repo, 'checkout', '--quiet', '-b', 'feature');
  if (lanes) {
    writeFiles(lane('lane-two'), { 'uat-config.txt': `token = "${fakeToken()}"\n` });
    git(lane('lane-two'), 'add', '-A');
    git(lane('lane-two'), 'commit', '--quiet', '-m', 'key');
    writeFiles(lane('lane-one'), { 'uat-new.txt': `token = "${fakeToken()}"\n` });
  }
  return { dir, repo, laneOne: lane('lane-one') };
}

// The closure matrix for a Codex call that names no folder (the code-mode shape: Bash, a string
// command, the chat's folder as cwd): rows are the folder state, each with what the command must get,
// through attributionDecision as the Codex hook calls it and through the Codex hook as a process.
test('matrix: a Codex call that names no folder is checked in the working tree it can reach, or refused', (t) => {
  const pushCheck = require('../scripts/toolkit-push-check.cjs');
  const { dir, repo, laneOne } = laneRepos(t);
  const single = laneRepos(t, { lanes: false }).repo;
  const plain = path.join(dir, 'plain');
  fs.mkdirSync(plain);
  const pendingFile = (reason) => /uat-new\.txt:1 \(not committed yet\)/.test(reason);
  const unconfirmed = (reason) => reason === pushCheck.FOLDER_UNCONFIRMED;
  const allowed = (reason) => reason === '';
  const rows = [
    ['lanes: add, commit, push a named branch', repo, 'git add -A; git commit -m t2; git push uat lane/one', pendingFile],
    ['lanes: the same in a nested pwsh -Command', repo, 'pwsh -Command "git add -A; git commit -m t2; git push uat lane/one"', pendingFile],
    ['lanes: push a branch with a committed credential', repo, 'git push uat lane/two', (reason) => /uat-config\.txt:1 \(commit [0-9a-f]{7}\)/.test(reason)],
    ['lanes: bare push', repo, 'git push', unconfirmed],
    ['lanes: push of HEAD', repo, 'git push origin HEAD', unconfirmed],
    ['lanes: pull request without --head', repo, 'gh pr create --fill', unconfirmed],
    ['lanes: a relative cd keeps the folder unconfirmed', repo, 'cd .tmp/worktrees/lane-one; git push', unconfirmed],
    ['lanes: git -C to the full path confirms it', repo, `git -C "${laneOne}" add -A; git -C "${laneOne}" commit -m x; git -C "${laneOne}" push uat lane/one`, pendingFile],
    ['lanes: cd to the full path confirms it', repo, `cd "${laneOne}"; git add -A; git commit -m x; git push`, pendingFile],
    ['lanes: a branch no working tree has checked out, after a commit', repo, 'git commit -m x; git push uat spare', unconfirmed],
    ['lanes: --tags after a commit', repo, 'git add -A; git commit -m x; git tag v9; git push uat --tags', unconfirmed],
    ['one working tree: add, commit, push, clean', single, 'git add -A; git commit -m x; git push uat feature', allowed],
    ['one working tree: bare push, clean', single, 'git push', allowed],
    ['one working tree: a new branch made, committed and pushed in one command, clean', single, 'git checkout -b brand-new; git add -A; git commit -m x; git push -u uat brand-new', allowed],
    ['chat folder not a repository', plain, 'git push origin feature', unconfirmed],
    ['branch unknown in the chat repository', repo, 'git push origin other-branch', unconfirmed],
  ];
  const env = { ...process.env };
  delete env.TOOLKIT_GIT_PATH;
  // The hook runs as a process for the first row of each outcome and for the folder-state rows, which
  // keeps the file inside its time budget.
  const asProcess = new Set(['lanes: add, commit, push a named branch', 'lanes: push a branch with a committed credential', 'lanes: bare push', 'one working tree: add, commit, push, clean', 'chat folder not a repository', 'branch unknown in the chat repository']);
  for (const [row, cwd, command, expected] of rows) {
    const codex = { tool_name: 'Bash', cwd, tool_input: { command } };
    const direct = attributionDecision(codex, { ...quiet(), sessionFolderOnly: true }).hookSpecificOutput?.permissionDecisionReason || '';
    assert.ok(expected(direct), `${row}: attributionDecision gave ${JSON.stringify(direct)}`);
    // Confirmed by a workdir: today's check, the one the Claude hook runs (its cwd is the shell's own folder).
    const named = { tool_name: 'Bash', cwd, tool_input: { command, workdir: cwd } };
    assert.deepEqual(attributionDecision(named, { ...quiet(), sessionFolderOnly: true }), attributionDecision(codex, quiet()), `${row}: a named workdir`);
    if (!asProcess.has(row)) continue;
    const hook = spawnSync(process.execPath, [codexHook], { input: JSON.stringify(codex), encoding: 'utf8', env, timeout: 60000 });
    const reason = hook.stdout.trim() ? JSON.parse(hook.stdout.trim().split('\n').pop()).hookSpecificOutput.permissionDecisionReason : '';
    assert.equal(hook.status, expected === allowed ? 0 : 2, `${row}: ${hook.stderr}`);
    assert.ok(expected(reason), `${row}: the hook gave ${JSON.stringify(reason)}`);
  }
  // After a commit, a branch no working tree has checked out is refused: a checkout or tag step in the
  // same command could put the commit on it in whichever folder the command runs. So are sources held
  // in more than one working tree, --all and --tags.
  const codexDecision = (cwd, line) => attributionDecision({ tool_name: 'Bash', cwd, tool_input: { command: line } }, { ...quiet(), sessionFolderOnly: true }).hookSpecificOutput?.permissionDecisionReason || '';
  for (const line of ['git checkout spare; git add -A; git commit -m x; git push uat spare', 'git add -A; git commit -m x; git tag v9; git push uat v9', 'git add -A; git commit -m x; git push uat lane/one lane/two',
    'git add -A; git commit -m x; git push uat lane/one spare', 'git commit -m x; git push --all uat', 'git commit -m x; git push uat --tags']) {
    assert.ok(unconfirmed(codexDecision(repo, line)), line);
  }
  // One working tree: a source that does not exist yet falls through to the check of what the commit
  // could add, as for a named folder. A new branch or a first commit with a credential is refused
  // naming the file; the same steps with a clean change run.
  const { dir: chainDir, git: chainGit, clone } = chainRepos(t);
  const branchRepo = clone();
  writeFiles(branchRepo, { 'uat-config.txt': `token = "${fakeToken()}"\n` });
  assert.match(codexDecision(branchRepo, 'git checkout -b brand-new; git add -A; git commit -m x; git push -u origin brand-new'), /uat-config\.txt:1 \(not committed yet\)/);
  const fresh = path.join(chainDir, 'fresh');
  chainGit(chainDir, 'init', '--quiet', fresh);
  writeFiles(fresh, { 'uat-config.txt': `token = "${fakeToken()}"\n` });
  assert.match(codexDecision(fresh, 'git add -A && git commit -m init && git push -u origin main'), /uat-config\.txt:1 \(not committed yet\)/, 'first commit');
  writeFiles(fresh, { 'uat-config.txt': 'Plain words only.\n' });
  assert.equal(codexDecision(fresh, 'git add -A && git commit -m init && git push -u origin main'), '', 'a clean first commit');
  // A named workdir is believed: the lane folder gets the normal check there, the main checkout's
  // clean tree passes, and the Claude hook judges its cwd the same way.
  const command = 'git add -A; git commit -m t2; git push uat lane/one';
  assert.ok(pendingFile(attributionDecision({ tool_name: 'Bash', cwd: repo, tool_input: { command, workdir: laneOne } }, { ...quiet(), sessionFolderOnly: true }).hookSpecificOutput?.permissionDecisionReason || ''));
  assert.deepEqual(attributionDecision({ tool_name: 'Bash', cwd: repo, tool_input: { command, workdir: repo } }, { ...quiet(), sessionFolderOnly: true }), {});
  const claude = runHook(claudeHook, 'Bash', repo, command, env);
  assert.deepEqual([claude.status, claude.stdout.trim()], [0, ''], `the Claude hook: ${claude.stderr}`);
  assert.match(pushCheck.FOLDER_UNCONFIRMED, /name the branch \(`git push <remote> <branch>`\), or name the folder first with `git -C <full path>` or `cd <full path>`/);
});

test('push check: every target of one command shares one deadline', () => {
  const deadlines = [];
  const check = (target, options) => { deadlines.push(options.deadline); return {}; };
  assert.equal(outgoingRefusal('git push origin a; git push origin b; gh pr create --fill', os.tmpdir(), { notes: [], budgetMs: 5000, check }), '');
  assert.equal(deadlines.length, 3);
  assert.equal(new Set(deadlines).size, 1, 'one deadline');
  assert.ok(deadlines[0] > Date.now() && deadlines[0] <= Date.now() + 5000);
});
