'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const { spawnSync } = childProcess;
const test = require('node:test');
const { FORCE_MESSAGE, attributionRefusal, attributionDecision, forceRefusal, MESSAGE } = require('../scripts/toolkit-attribution-guard.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');
const trailer = 'Co-Authored-By: Claude <noreply@anthropic.com>';

function messageFiles(t) {
  const scratch = path.join(repoRoot, '.tmp');
  fs.mkdirSync(scratch, { recursive: true });
  const dir = fs.mkdtempSync(path.join(scratch, 'toolkit-attribution-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'msg.txt'), 'Fix the thing\n');
  fs.writeFileSync(path.join(dir, 'body.md'), 'Summary\n\nGenerated with [Claude Code](https://claude.com/claude-code)\n');
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'sub', 'msg.txt'), `Fix\n\n${trailer}\n`);
  fs.writeFileSync(path.join(dir, 'sub', 'body.md'), 'Harmless summary\n');
  return dir;
}

test('every attribution form in git commit and gh pr create/edit is refused', (t) => {
  const dir = messageFiles(t);
  for (const command of [
    `git commit -m "Fix the thing" -m "${trailer}"`,
    `git commit --amend -m "Fix\n\nClaude-Session: https://claude.ai/code/session_01ABC"`,
    'git commit -F sub/msg.txt',
    'git commit --file=sub/msg.txt',
    `git commit -F - <<'EOF'\nFix the thing\n\n${trailer}\nEOF`,
    'gh pr create --title "x" --body "See https://claude.ai/code/session_01XYZ for the run"',
    'gh pr edit 12 --body-file body.md',
    'gh pr create --title x --body-file=body.md',
    'cd repo && git -c core.editor=true commit -m "x\n\nGenerated with Claude Code"',
    'git commit -Fsub/msg.txt',
    `gh pr merge 12 --squash --body "${trailer}"`,
    'gh pr merge 12 --body-file body.md',
    `git -C sub commit -F msg.txt`,
    'git -c core.editor=true -C sub commit -F msg.txt',
    'git -C sub commit -m x && gh pr create --title x --body-file body.md'
  ]) {
    assert.equal(attributionRefusal(command, dir), MESSAGE, command);
  }
});

test('git message paths survive Bash and PowerShell line continuations', (t) => {
  const dir = messageFiles(t);
  for (const escape of ['\\', '`']) for (const newline of ['\n', '\r\n']) {
    assert.equal(attributionRefusal(`git -C sub commit ${escape}${newline}-F msg.txt`, dir), MESSAGE);
    assert.equal(attributionRefusal(`git ${escape}${newline}-C sub commit -F msg.txt`, dir), MESSAGE);
  }
});

test('raw command detection screens wrappers, substitutions and shell-specific quoting', (t) => {
  const dir = messageFiles(t);
  const commands = [
    ['heredoc with apostrophe', `cat > msg.txt <<'EOF'\nFix what doesn't work\n${trailer}\nEOF\ngit commit -F msg.txt`],
    ['subshell', `(git commit -m "${trailer}")`],
    ['command substitution', `x=$(git commit -m "${trailer}")`],
    ['bash wrapper', `bash -c "git commit -m '${trailer}'"`],
    ['PowerShell wrapper', `powershell -Command "git commit -m '${trailer}'"`],
    ['cmd wrapper', `cmd /c "git commit -m '${trailer}'"`],
    ['PowerShell trailing backslash', `Write-Output "C:\\repo\\"; git commit -m "${trailer}"`],
    ['backtick before closing quote', 'echo "note`"; git commit -m "' + trailer + '"'],
    ['ANSI-C apostrophe', "echo $'it\\'s'; git commit -m \"" + trailer + '"'],
    ['PowerShell here-string', `$m = @'\nFix what doesn't work\n${trailer}\n'@\ngit commit -m $m`],
    ['PowerShell call operator', `& git commit -m "${trailer}"`],
    ['wrapped PR merge', `bash -c "gh pr merge 12 --body '${trailer}'"`],
  ];
  for (const [label, command] of commands) assert.equal(attributionRefusal(command, dir), MESSAGE, label);
});

test('unpaired message and body files still get the legacy and base-folder screens', (t) => {
  const dir = messageFiles(t);
  for (const command of [
    "cat <<'EOF'\nFix what doesn't work\nEOF\ngit commit -F sub/msg.txt",
    '(git commit -F sub/msg.txt )',
    'x=$(git commit -F sub/msg.txt )',
    'bash -c "git commit -F sub/msg.txt"',
    'powershell -Command "git commit -F sub/msg.txt"',
    'cmd /c "git commit -F sub/msg.txt"',
    'bash -c "git -C sub commit -F msg.txt"',
    "echo doesn't; git -C sub commit -F msg.txt",
    'git status --file=sub/msg.txt ; git commit -m x',
    'git commit -- --body-file=body.md',
    'bash -c "gh pr create --body-file body.md"',
  ]) assert.equal(attributionRefusal(command, dir), MESSAGE, command);
  fs.writeFileSync(path.join(dir, 'msg.txt'), trailer);
  assert.equal(attributionRefusal('bash -c "git -C sub/clean commit -F msg.txt"', dir), MESSAGE);
});

test('quoted and escaped separators stay inside the same git command', (t) => {
  const dir = messageFiles(t);
  for (const separator of [';', '&&', '||', '|', '\n']) for (const quote of ['"', "'"]) {
    const command = `git -C sub commit -m ${quote}fix ${separator} notes${quote} -F msg.txt`;
    assert.equal(attributionRefusal(command, dir), MESSAGE, command);
  }
  assert.equal(attributionRefusal('git -C sub commit -m fix\\;notes -F msg.txt', dir), MESSAGE);
  assert.equal(attributionRefusal('git -C sub commit -m fix`|notes -F msg.txt', dir), MESSAGE);
  fs.writeFileSync(path.join(dir, 'sub', 'msg; notes.txt'), trailer);
  assert.equal(attributionRefusal('git -C sub commit --file="msg; notes.txt"', dir), MESSAGE);
});

test('all value-taking git global options leave later -C options visible', (t) => {
  const dir = messageFiles(t);
  for (const option of ['-c', '--git-dir', '--work-tree', '--namespace', '--config-env', '--super-prefix']) {
    assert.equal(attributionRefusal(`git ${option} commit -C sub commit -F msg.txt`, dir), MESSAGE, option);
    if (option.startsWith('--')) assert.equal(attributionRefusal(`git ${option}=commit -C sub commit -F msg.txt`, dir), MESSAGE, `${option}=`);
  }
  for (const option of ['--exec-path=commit', '--git-dir=sub/.git', '--no-pager']) {
    assert.equal(attributionRefusal(`git ${option} -C sub commit -F msg.txt`, dir), MESSAGE, option);
  }
  assert.equal(attributionRefusal('git --git-dir sub/.git -C sub commit -F msg.txt', dir), MESSAGE);
  assert.equal(attributionRefusal('git --work-tree sub -C sub commit -F msg.txt', dir), MESSAGE);
  for (const git of ['git.exe', '/usr/bin/git', '"C:\\Program Files\\Git\\cmd\\git.exe"']) {
    assert.equal(attributionRefusal(`${git} -C sub commit -F msg.txt`, dir), MESSAGE, git);
  }
});

test('repeated -C options compose and affect only files in that git command', (t) => {
  const dir = messageFiles(t);
  fs.mkdirSync(path.join(dir, 'sub', 'nested'));
  fs.writeFileSync(path.join(dir, 'sub', 'nested', 'msg.txt'), trailer);
  fs.mkdirSync(path.join(dir, 'sub', 'clean'));
  fs.writeFileSync(path.join(dir, 'sub', 'clean', 'msg.txt'), 'Harmless message\n');
  assert.equal(attributionRefusal('git -C sub -C nested commit -F msg.txt', dir), MESSAGE);
  assert.equal(attributionRefusal('git -Csub -Cnested commit -Fmsg.txt', dir), MESSAGE);
  assert.equal(attributionRefusal('git -C sub -C clean commit -F msg.txt', dir), '');
  assert.equal(attributionRefusal('git -C sub -C "" commit -F msg.txt', dir), MESSAGE);
  for (const separator of [';', '&&', '||', '|', '\n']) {
    assert.equal(attributionRefusal(`git -C sub status ${separator} git commit -F msg.txt`, dir), '');
    assert.equal(attributionRefusal(`git -C sub commit -m x ${separator} gh pr create --body-file body.md`, dir), MESSAGE);
  }
});

test('long command detection is bounded and commands beyond the limit are refused', () => {
  const started = performance.now();
  assert.equal(attributionRefusal('git '.repeat(20000)), '');
  assert.equal(attributionRefusal('git -c x=y '.repeat(20000)), '');
  assert.match(attributionRefusal('x'.repeat(1024 * 1024 + 1)), /character limit/);
  assert.ok(performance.now() - started < 1000, 'long commands must return promptly');
});

test('repeated -C resolution is capped before paths can grow quadratically', (t) => {
  const dir = messageFiles(t);
  assert.equal(attributionRefusal(`git ${'-C "" '.repeat(64)}commit -m x`, dir), '');
  const started = performance.now();
  for (const command of [
    `git ${'-C -C '.repeat(50000)}`,
    `git ${'-C segment '.repeat(50000)}commit -F msg.txt`,
    `git ${'-Csegment '.repeat(50000)}commit -F msg.txt`,
    `git ${'-C "" '.repeat(65)}commit -m x`,
  ]) assert.match(attributionRefusal(command, dir), /64 git -C options per command/);
  assert.ok(performance.now() - started < 1500, 'repeated -C options must return promptly');
});

test('ordinary commits, PRs and other commands pass, even when they mention Claude', () => {
  for (const command of [
    'git commit -m "Document how Claude Code reads AGENTS.md"',
    'gh pr create --title "Claude Code settings" --body "Adds the Claude Code settings question"',
    `echo "${trailer}"`,
    'git log --grep "Co-Authored-By: Claude"',
    'git commit -F missing-file.txt'
  ]) {
    assert.equal(attributionRefusal(command, os.tmpdir()), '', command);
  }
  assert.deepEqual(attributionDecision({ tool_input: {} }), {});
});

test('trailers accept colon or equals separators with optional spaces', () => {
  for (const separator of [':', '=', ' : ', ' = ', '\t=\t']) {
    for (const trailer of [`Co-Authored-By${separator}Claude <noreply@anthropic.com>`, `Claude-Session${separator}session_123`]) {
      assert.equal(attributionRefusal(`git commit --trailer "${trailer}"`), MESSAGE);
      assert.equal(attributionRefusal(`git commit --trailer=${trailer}`), MESSAGE);
    }
  }
  assert.equal(attributionRefusal('git commit -m "Co-Authored-By=Human <human@example.com>"'), '');
  assert.equal(attributionRefusal('git commit -m "Describe Claude-Session settings and co-authored-by examples"'), '');
  const started = performance.now();
  assert.equal(attributionRefusal(`git commit -m "${'co-authored-by '.repeat(40000)}"`), '');
  assert.ok(performance.now() - started < 2000, 'trailer matching must stay linear');
});

test('unquoted parentheses separate commands without changing quoted or escaped paths', (t) => {
  const dir = messageFiles(t);
  for (const command of ['(git commit -F sub/msg.txt)', 'x=$(git commit -F sub/msg.txt)', '(git -C sub commit -F msg.txt)']) {
    assert.equal(attributionRefusal(command, dir), MESSAGE, command);
  }
  fs.writeFileSync(path.join(dir, 'msg(1).txt'), trailer);
  assert.equal(attributionRefusal('git commit -F "msg(1).txt"', dir), MESSAGE);
  assert.equal(attributionRefusal('git commit -F msg\\(1\\).txt', dir), MESSAGE);
});

test('git short-option bundles respect the first value-taking option', (t) => {
  const dir = messageFiles(t);
  for (const option of ['-sF sub/msg.txt', '-asF sub/msg.txt', '-sFsub/msg.txt', '-asFsub/msg.txt']) {
    assert.equal(attributionRefusal(`git commit ${option}`, dir), MESSAGE, option);
  }
  fs.writeFileSync(path.join(dir, 'F'), trailer);
  for (const option of ['-amF', '-acF', '-aCF', '-atF', '-am F']) {
    assert.equal(attributionRefusal(`git commit ${option}`, dir), '', option);
  }
  assert.equal(attributionRefusal('gh pr create -sFsub/msg.txt', dir), '');
});

test('file-option screening is capped and bounded with long directories', (t) => {
  const dir = messageFiles(t);
  assert.equal(attributionRefusal(`git commit ${'-F msg.txt '.repeat(64)}`, dir), '');
  assert.equal(attributionRefusal(`git commit ${'-F msg.txt '.repeat(64)}; git commit ${'-F msg.txt '.repeat(64)}`, dir), '');
  const started = performance.now();
  for (const command of [
    `git commit ${'-F f '.repeat(80000)}`,
    `git commit ${'-sFf '.repeat(80000)}`,
    `bash -c "git commit ${'-F f '.repeat(80000)}"`,
    `bash -c "git commit ${'-F f '.repeat(40)}"; bash -c "git commit ${'-F f '.repeat(40)}"`,
    `git commit ${'--body-file=- '.repeat(65)}`,
  ]) assert.match(attributionRefusal(command, dir), /64 file options.*Split/);
  assert.equal(attributionRefusal(`git -C ${'x'.repeat(200000)} commit ${'-F x '.repeat(60)}`, dir), '');
  assert.ok(performance.now() - started < 2000, 'file screening must return promptly');
});

test('each resolved file is inspected once per call, including legacy and missing files', (t) => {
  const dir = messageFiles(t);
  const originalStat = fs.statSync;
  const originalRead = fs.readFileSync;
  const stats = []; const reads = [];
  t.mock.method(fs, 'statSync', (file, ...args) => { stats.push(file); return originalStat(file, ...args); });
  t.mock.method(fs, 'readFileSync', (file, ...args) => { reads.push(file); return originalRead(file, ...args); });
  assert.equal(attributionRefusal('git commit -F msg.txt -F ./msg.txt -F missing ; bash -c "git commit -F msg.txt -F missing"', dir), '');
  assert.equal(stats.filter((file) => file === path.join(dir, 'msg.txt')).length, 1);
  assert.equal(stats.filter((file) => file === path.join(dir, 'missing')).length, 1);
  assert.equal(reads.filter((file) => file === path.join(dir, 'msg.txt')).length, 1);
  assert.equal(attributionRefusal('git commit -F msg.txt', dir), '');
  assert.equal(reads.filter((file) => file === path.join(dir, 'msg.txt')).length, 2, 'cache must not outlive the call');
});

test('the Claude Code hook refuses with exit 2 and a deny decision, and passes everything else', () => {
  const hook = path.join(repoRoot, 'repo', 'scripts', 'toolkit-claude-attribution-hook.cjs');
  const refused = spawnSync(process.execPath, [hook], { input: JSON.stringify({ tool_name: 'Bash', cwd: os.tmpdir(), tool_input: { command: `git commit -m "x" -m "${trailer}"` } }), encoding: 'utf8' });
  assert.equal(refused.status, 2);
  assert.equal(JSON.parse(refused.stdout).hookSpecificOutput.permissionDecision, 'deny');
  const allowed = spawnSync(process.execPath, [hook], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git status' } }), encoding: 'utf8' });
  assert.equal(allowed.status, 0);
  assert.equal(allowed.stdout, '');
  const powershell = spawnSync(process.execPath, [hook], { input: JSON.stringify({ tool_name: 'PowerShell', cwd: os.tmpdir(), tool_input: { command: `git commit -m "x" -m "${trailer}"` } }), encoding: 'utf8' });
  assert.equal(powershell.status, 2);
  const unreadable = spawnSync(process.execPath, [hook], { input: 'not json', encoding: 'utf8' });
  assert.equal(unreadable.status, 0);
});

test('both plugins route shell commands to the attribution check', () => {
  const claude = JSON.parse(fs.readFileSync(path.join(repoRoot, '.claude-plugin', 'hooks', 'hooks.json'), 'utf8'));
  const bash = claude.hooks.PreToolUse.find((group) => group.matcher === 'Bash|PowerShell');
  assert.equal(bash.hooks[0].command, 'node "${CLAUDE_PLUGIN_ROOT}/repo/scripts/toolkit-claude-attribution-hook.cjs"');
  const codex = JSON.parse(fs.readFileSync(path.join(repoRoot, '.codex-plugin', 'hooks', 'hooks.json'), 'utf8'));
  assert.ok(new RegExp(codex.hooks.PreToolUse[0].matcher).test('Bash'));
  const helper = spawnSync(process.execPath, [path.join(repoRoot, 'repo', 'scripts', 'toolkit-codex-helper-hook.cjs')], {
    input: JSON.stringify({ tool_name: 'Bash', cwd: os.tmpdir(), tool_input: { command: 'gh pr create --body "Generated with Claude Code"' } }), encoding: 'utf8'
  });
  assert.equal(JSON.parse(helper.stdout.trim().split('\n').pop()).hookSpecificOutput.permissionDecision, 'deny');
});

// Folders shaped like repositories (a .git folder is enough): Toolkit-governed, guarded, or neither.
function guardRepos(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-guard-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const make = (name, files) => {
    const root = path.join(dir, name);
    fs.mkdirSync(path.join(root, '.git'), { recursive: true });
    fs.mkdirSync(path.join(root, 'sub'), { recursive: true });
    for (const [file, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), text);
    }
    return root;
  };
  return {
    governed: make('governed', { 'AGENTS.md': '<!-- AI-AGENT-TOOLKIT:repo/contracts/agent-rules/toolkit-governed-rules.md:BEGIN TOOLKIT-GOVERNED-RULES v2 toolkit=0.0.0 sha256=000000000000 -->\n' }),
    guarded: make('guarded', { '.github/personal-data-guard.json': '{}\n' }),
    plain: make('plain', { 'AGENTS.md': '# Rules\n' }),
    store: make('store', { '.git/config': '[remote "origin"]\n\turl = https://github.com/owner/TRANSPORT-evidence.git\n' }),
  };
}

test('commands that skip commit or push checks are a written rule: the shell hooks let them through', (t) => {
  const repos = guardRepos(t);
  for (const root of [repos.governed, repos.guarded, repos.plain]) {
    for (const command of ['git commit -n -m x', 'git commit --no-verify -m x', 'git -c core.hooksPath=/dev/null commit -m x', 'git config core.hooksPath .nothing', 'bash -c "git commit --no-verify -m x"']) {
      assert.equal(forceRefusal(command, root), '', `${path.basename(root)}: ${command}`);
      assert.deepEqual(attributionDecision({ tool_name: 'Bash', cwd: root, tool_input: { command } }, { notes: [] }), {}, `${path.basename(root)}: ${command}`);
    }
  }
});

test('force pushes are refused in governed and guarded repositories and to evidence stores', (t) => {
  const repos = guardRepos(t);
  const forced = [
    'git push --force',
    'git push -f origin feature',
    'git push -uf origin feature',
    'git push --force-with-lease',
    'git push --force-with-lease=main:abc123 origin main',
    'git push --forc',
    'git push origin +main',
    'git push origin +HEAD:main',
    'git push --mirror',
    'bash -c "git push --force origin main"',
  ];
  for (const root of [repos.governed, repos.guarded, repos.store]) {
    for (const command of forced) assert.equal(forceRefusal(command, root), FORCE_MESSAGE, `${path.basename(root)}: ${command}`);
  }
  assert.equal(forceRefusal('git push https://github.com/owner/TRANSPORT-evidence.git +main', repos.plain), FORCE_MESSAGE, 'a store named on the command line');
  for (const command of ['git push origin main', 'git push -u origin feature', 'git push -o ci.skip origin main', 'git push --follow-tags origin main', 'git push origin :old-branch']) {
    assert.equal(forceRefusal(command, repos.store), '', command);
  }
  for (const command of forced) assert.equal(forceRefusal(command, repos.plain), '', `plain repository: ${command}`);
});

test('N3: an ENABLED repository is protected even before its governed block lands; a DISABLED one with a leftover block stays protected', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-bypass-state-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const registryOptions = { registryPath: path.join(dir, 'home', '.ai-agent-toolkit', 'user-state', 'repository-governance.v1.json'), testOnly: true };
  const gate = require('../scripts/toolkit-governance-gate.cjs');
  const repo = (name, { block = false } = {}) => {
    const root = path.join(dir, name);
    fs.mkdirSync(root, { recursive: true });
    childProcess.execFileSync('git', ['init', '--quiet', root]);
    childProcess.execFileSync('git', ['-C', root, 'remote', 'add', 'origin', `https://github.com/example-owner/${name}.git`]);
    if (block) fs.writeFileSync(path.join(root, 'AGENTS.md'), '<!-- AI-AGENT-TOOLKIT:repo/contracts/agent-rules/toolkit-governed-rules.md:BEGIN TOOLKIT-GOVERNED-RULES v2 toolkit=0.0.0 sha256=000000000000 -->\n');
    return root;
  };
  const enabled = repo('enabled');
  gate.writeGovernanceDecision(enabled, 'enable', { registryOptions });
  const disabledWithBlock = repo('disabled-block', { block: true });
  gate.writeGovernanceDecision(disabledWithBlock, 'disable', { registryOptions });
  const undecided = repo('undecided');
  for (const [root, refused] of [[enabled, true], [disabledWithBlock, true], [undecided, false]]) {
    assert.equal(forceRefusal('git push --force origin main', root, 0, registryOptions), refused ? FORCE_MESSAGE : '', path.basename(root));
  }
});

// The push check: what a git push or gh pr create would send. Fake credentials are built from
// pieces at run time, so no credential-shaped text sits in the repository.
const pushCheck = require('../scripts/toolkit-push-check.cjs');
const { outgoingChanges, outgoingRefusal } = require('../scripts/toolkit-attribution-guard.cjs');
const join = (...parts) => parts.join('');
const fakeToken = () => join('gh', 'p_', 'A1b2C3d4E5f6G7h8'.repeat(2), 'Q9r0');
const numberReference = () => join('#', '123');
const quiet = () => ({ notes: [] });
const claudeHook = path.join(repoRoot, 'repo', 'scripts', 'toolkit-claude-attribution-hook.cjs');
const codexHook = path.join(repoRoot, 'repo', 'scripts', 'toolkit-codex-helper-hook.cjs');

function fixtureGit(cwd, args, hooks) {
  return childProcess.execFileSync('git', ['-c', 'user.name=Fixture Author', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${hooks}`, '-c', 'init.defaultBranch=main', '-c', 'core.fsmonitor=false', ...args], { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
}

function writeFiles(root, files) {
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }
}

// A clone whose main is pushed to a local bare origin, with origin/HEAD set; each scenario is a copy
// with one more commit on a new branch that has no upstream. Built once for every push check test;
// each test that changes a repository has its own.
let fixtures = null;
test.after(() => { if (fixtures) fs.rmSync(fixtures.dir, { recursive: true, force: true }); });
function pushFixtures() {
  if (fixtures) return fixtures;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-push-check-'));
  const hooks = path.join(dir, 'no-hooks');
  fs.mkdirSync(hooks);
  const git = (cwd, ...args) => fixtureGit(cwd, args, hooks);
  const commitAll = (work, message) => { git(work, 'add', '-A'); git(work, 'commit', '--quiet', '-m', message); };
  const base = (name, files) => {
    const origin = path.join(dir, `${name}-origin.git`);
    const work = path.join(dir, `${name}-base`);
    git(dir, 'init', '--quiet', '--bare', origin);
    git(dir, 'init', '--quiet', work);
    writeFiles(work, { 'README.md': 'A fixture.\n', ...files });
    commitAll(work, 'base');
    git(work, 'remote', 'add', 'origin', origin);
    git(work, 'push', '--quiet', '-u', 'origin', 'main');
    git(work, 'remote', 'set-head', 'origin', 'main');
    return work;
  };
  const scenario = (from, name, files) => {
    const work = path.join(dir, name);
    fs.cpSync(from, work, { recursive: true });
    git(work, 'checkout', '--quiet', '-b', 'feature');
    writeFiles(work, files);
    commitAll(work, 'change');
    return work;
  };
  const withSettings = base('settings', { '.github/plain-text.json': '{}\n' });
  const without = base('plain', {});
  const changes = {
    secret: { 'src/config.js': `const token = "${fakeToken()}";\n` },
    plain: { 'docs/guide.md': `See ${numberReference()} for details.\n` },
    clean: { 'docs/guide.md': 'Plain words only.\n' },
  };
  const repos = {};
  for (const [kind, files] of Object.entries(changes)) {
    repos[`settings-${kind}`] = scenario(withSettings, `settings-${kind}`, files);
    repos[`plain-${kind}`] = scenario(without, `plain-${kind}`, files);
  }
  for (const name of ['exceptions', 'range', 'targets', 'more']) repos[name] = scenario(withSettings, name, changes.clean);
  repos['toolkit-plain'] = scenario(without, 'toolkit-plain', {
    'repo/contracts/plain-references/config.json': '{}\n', 'repo/scripts/check-plain-references.cjs': '\'use strict\';\n', ...changes.plain
  });
  repos['switched-off'] = scenario(without, 'switched-off', { '.github/plain-text.json': '{ "off_reason": "this fixture does not run the check" }\n', ...changes.plain });
  repos['broken-settings'] = scenario(without, 'broken-settings', { '.github/plain-text.json': '{ not json\n', ...changes.secret, ...changes.plain });
  repos.notRepo = path.join(dir, 'not-a-repo');
  fs.mkdirSync(repos.notRepo);
  fixtures = { dir, git, commitAll, repos, withSettings };
  return fixtures;
}

function assertNoMatchText(text, label, token = fakeToken()) {
  for (let start = 0; start + 8 <= token.length; start += 4) assert.ok(!String(text).includes(token.slice(start, start + 8)), `${label} shows part of the credential`);
}

const runHook = (hook, tool, cwd, command, env = process.env) => spawnSync(process.execPath, [hook], { input: JSON.stringify({ tool_name: tool, cwd, tool_input: { command } }), encoding: 'utf8', env });

test('push check: credentials are refused everywhere, plain-text findings are left to CI, clean changes pass', () => {
  const { repos } = pushFixtures();
  const expected = {
    'settings-secret': 'secret', 'settings-plain': '', 'settings-clean': '',
    'plain-secret': 'secret', 'plain-plain': '', 'plain-clean': '', 'toolkit-plain': '', 'switched-off': '', notRepo: '',
  };
  for (const [name, kind] of Object.entries(expected)) {
    for (const command of ['git push', 'gh pr create --fill', 'gh pr create --base main']) {
      const options = quiet();
      const reason = outgoingRefusal(command, repos[name], options);
      assert.deepEqual(options.notes, [], `${name}, ${command}: no note`);
      if (!kind) { assert.equal(reason, '', `${name}, ${command}`); continue; }
      assert.match(reason, /^Toolkit checked what this (?:push|pull request) would send and found 1 item\(s\) to fix first:/, name);
      assert.match(reason, /src\/config\.js:1 \(commit [0-9a-f]{7}\): GitHub token/, name);
      assert.match(reason, /secret-scan: allow <reason>/, name);
      assertNoMatchText(reason, name);
    }
  }
});

test('push check: every command form finds the folder, remote and branch it sends', () => {
  const { dir, repos } = pushFixtures();
  const repo = repos['settings-secret'];
  const name = path.basename(repo);
  const forms = [
    ['git push', repo], ['git push -u origin feature', repo], [`git -C ${name} push`, dir], [`cd ${name} && git push`, dir],
    [`Set-Location ${name}; git push origin feature`, dir], [`git -C ${name} \`\n  push`, dir], [`bash -c "cd ${name} && git push"`, dir],
    [`pwsh -Command "git -C ${name} push"`, dir], ['gh pr create --title x --body y', repo], [`cd ${name}; gh pr create --fill`, dir],
  ];
  for (const [command, cwd] of forms) {
    assert.match(outgoingRefusal(command, cwd, quiet()), /GitHub token/, command);
    assert.equal(attributionDecision({ tool_input: { command }, cwd }, quiet()).hookSpecificOutput?.permissionDecision, 'deny', command);
  }
  assert.match(outgoingRefusal('gh pr create --title x', repo, quiet()), /^Toolkit checked what this pull request would send/);
  for (const command of ['git status', 'git push --delete origin feature', 'git push origin -d feature', 'git push origin :feature', 'gh pr view', 'git fetch && git log']) {
    assert.equal(outgoingRefusal(command, repo, quiet()), '', command);
  }
  assert.deepEqual(outgoingChanges('git push', dir), [{ folder: dir, remote: '', sources: [] }]);
  assert.deepEqual(outgoingChanges('git push -o ci.skip other +local:remote topic tag v1 :gone', dir), [{ folder: dir, remote: 'other', sources: ['local', 'topic', 'refs/tags/v1'] }]);
  assert.deepEqual(outgoingChanges('git push --all origin', dir), [{ folder: dir, remote: 'origin', sources: ['--branches'] }]);
  assert.deepEqual(outgoingChanges('git push origin :gone', dir), []);
  assert.deepEqual(outgoingChanges('gh pr create --base release --head owner:topic --title x', dir), [{ folder: dir, pullRequest: true, base: 'release', sources: ['topic'] }]);
  assert.deepEqual(outgoingChanges('gh pr create -Bnext -Htopic', dir), [{ folder: dir, pullRequest: true, base: 'next', sources: ['topic'] }]);
  assert.deepEqual(outgoingChanges('gh pr create --base=next', dir), [{ folder: dir, pullRequest: true, base: 'next', sources: [] }]);
});

test('push check: what is sent is each pushed commit the target does not have', () => {
  const { git, commitAll, repos, withSettings } = pushFixtures();
  const repo = repos.range;
  // A credential added and removed again within one push is still found, naming the commit.
  writeFiles(repo, { 'src/config.js': `const token = "${fakeToken()}";\n` });
  commitAll(repo, 'add');
  const added = git(repo, 'rev-parse', '--short=7', 'HEAD').trim();
  fs.rmSync(path.join(repo, 'src', 'config.js'));
  commitAll(repo, 'remove');
  assert.match(outgoingRefusal('git push', repo, quiet()), new RegExp(`src/config\\.js:1 \\(commit ${added}\\): GitHub token`));
  // Without origin/HEAD, a new branch is still compared with what origin has.
  git(repo, 'remote', 'set-head', 'origin', '--delete');
  assert.match(outgoingRefusal('git push -u origin feature', repo, quiet()), /GitHub token/);
  // Once origin has the branch, nothing is left to send to it. A new remote with no refs yet is read
  // against every remote, so history origin already holds is not read again, but a commit no remote
  // has still is. A name that is no configured remote sends nothing.
  git(repo, 'push', '--quiet', '-u', 'origin', 'feature');
  assert.equal(outgoingRefusal('git push', repo, quiet()), '');
  const other = path.join(path.dirname(repo), 'range-other.git');
  git(path.dirname(repo), 'init', '--quiet', '--bare', other);
  git(repo, 'remote', 'add', 'other', other);
  git(repo, 'fetch', '--quiet', 'other');
  assert.equal(outgoingRefusal('git push other HEAD:feature', repo, quiet()), '', 'history another remote holds is not read again');
  writeFiles(repo, { 'src/again.js': `const token = "${fakeToken()}";\n` });
  commitAll(repo, 'again');
  assert.match(outgoingRefusal('git push other HEAD:feature', repo, quiet()), /src\/again\.js:1 /, 'a commit no remote has is read for a new remote');
  assert.equal(outgoingRefusal('git push nowhere HEAD:feature', repo, quiet()), '', 'no such remote');
  assert.equal(outgoingRefusal('git push --dry-run other HEAD:feature', repo, quiet()), '', 'a dry run sends nothing');
  git(repo, 'reset', '--quiet', '--hard', 'HEAD~1');
  // A pull request against a base that already has the commits sends nothing new.
  assert.equal(outgoingRefusal('gh pr create --base feature', repo, quiet()), '');
  // On main, which tracks origin/main: only the commit not yet pushed counts.
  writeFiles(withSettings, { 'src/main.js': `const token = "${fakeToken()}";\n` });
  commitAll(withSettings, 'ahead');
  assert.match(outgoingRefusal('git push', withSettings, quiet()), /src\/main\.js:1 /);
  git(withSettings, 'reset', '--quiet', '--hard', 'HEAD~1');
});

test('push check: the pushed branch and the pull request head are read, not the current branch', () => {
  const { git, commitAll, repos } = pushFixtures();
  const repo = repos.targets;
  git(repo, 'checkout', '--quiet', '-b', 'leaky');
  writeFiles(repo, { 'src/leak.js': `"${fakeToken()}"\n` });
  commitAll(repo, 'leak');
  git(repo, 'checkout', '--quiet', 'feature');
  assert.equal(outgoingRefusal('git push', repo, quiet()), '', 'the clean current branch passes');
  assert.match(outgoingRefusal('git push origin leaky', repo, quiet()), /src\/leak\.js:1 /);
  assert.match(outgoingRefusal('git push origin leaky:main', repo, quiet()), /src\/leak\.js:1 /);
  assert.match(outgoingRefusal('gh pr create --head leaky --base main', repo, quiet()), /src\/leak\.js:1 /);
  assert.equal(outgoingRefusal('gh pr create --head no-such-branch', repo, quiet()), '');
  const before = fs.readdirSync(repo).sort();
  assert.deepEqual(pushCheck.checkOutgoing({ folder: repo, sources: ['--output=x'] }), {}, 'a source that reads as an option is never passed to git');
  assert.deepEqual(fs.readdirSync(repo).sort(), before, 'and git wrote no file for it');
});

test('push check: a broken plain-text setting changes nothing: the credential is refused and no note is added', () => {
  const { repos } = pushFixtures();
  const options = quiet();
  const reason = outgoingRefusal('git push', repos['broken-settings'], options);
  assert.match(reason, /GitHub token/);
  assert.deepEqual(options.notes, []);
});

test('push check: a reviewed exception, a placeholder and a long list are handled', () => {
  const { commitAll, repos } = pushFixtures();
  const repo = repos.exceptions;
  writeFiles(repo, {
    'src/allowed.js': `const token = "${fakeToken()}"; // secret-scan: allow fixture for the parser test\n`,
    'src/placeholder.js': `const token = "${join('gh', 'p_', 'x'.repeat(36))}";\n`,
  });
  commitAll(repo, 'exceptions');
  assert.equal(outgoingRefusal('git push', repo, quiet()), '');
  writeFiles(repo, { 'src/many.js': Array.from({ length: 12 }, () => `"${fakeToken()}"`).join('\n') });
  commitAll(repo, 'many');
  const reason = outgoingRefusal('git push', repo, quiet());
  assert.match(reason, /found 12 item\(s\)/);
  assert.match(reason, /src\/many\.js:10 \(commit [0-9a-f]{7}\): GitHub token\n {2}\.\.\.and 2 more\./);
  assert.ok(!reason.includes('src/many.js:11 '));
  assertNoMatchText(reason, 'long list');
});

test('push check: it fails open with one note when git is missing, slow or the check breaks', () => {
  const folder = os.tmpdir();
  const missing = pushCheck.checkOutgoing({ folder }, { spawn: () => ({ error: Object.assign(new Error('x'), { code: 'ENOENT' }) }) });
  assert.equal(missing.refusal, undefined);
  assert.equal(missing.note, 'Toolkit could not check this push for credentials, so it was let through: git could not run (ENOENT).');
  const slow = pushCheck.checkOutgoing({ folder }, { spawn: () => ({ error: Object.assign(new Error('x'), { code: 'ETIMEDOUT' }), status: null, signal: 'SIGTERM' }) });
  assert.match(slow.note, /longer than 30 seconds/);
  assert.match(pushCheck.checkOutgoing({ folder }, { budgetMs: -1 }).note, /longer than 30 seconds/);
  const broken = pushCheck.checkOutgoing({ folder }, { spawn: () => { throw new TypeError('boom'); } });
  assert.match(broken.note, /the check failed \(TypeError\)/);
  // Each git call gets only the time left.
  const timeouts = [];
  pushCheck.checkOutgoing({ folder }, { budgetMs: 5000, spawn: (command, args, options) => { timeouts.push(options.timeout); return { status: 128, stdout: '', stderr: '' }; } });
  assert.equal(timeouts.length, 1);
  assert.ok(timeouts[0] > 0 && timeouts[0] <= 5000);
  assert.equal(pushCheck.BUDGET_MS, 30000);
  const options = quiet();
  assert.equal(outgoingRefusal('git push', folder, { ...options, check: () => { throw new Error('gone'); } }), '');
  assert.deepEqual(options.notes, ['Toolkit could not check this push for credentials, so it was let through: the check could not load.']);
  // The same target is checked once per command.
  let calls = 0;
  outgoingRefusal('git push && git push', folder, { notes: [], check: () => { calls += 1; return {}; } });
  assert.equal(calls, 1);
});

test('push check: added lines follow commits, hunk sizes, quoted paths, tabs and CRLF', () => {
  const patch = [
    '\0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '',
    'diff --git a/one.txt b/one.txt', '--- a/one.txt', '+++ b/one.txt', '@@ -1,2 +1,3 @@', '-old', '-old two', '+++ looks like a header', '+second\r', '+third',
    'diff --git "a/sp ace.txt" "b/sp ace.txt"', '--- /dev/null', '+++ b/sp ace.txt\t', '@@ -0,0 +5 @@', '+only',
    '\0bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '',
    'diff --git a/q.txt b/q.txt', '--- a/q.txt', '+++ "b/q\\"uote.txt"', '@@ -1 +1 @@', '-x', '+y',
    'diff --git a/gone.txt b/gone.txt', '--- a/gone.txt', '+++ /dev/null', '@@ -1 +0,0 @@', '-bye',
  ].join('\n');
  const changes = pushCheck.addedLines(patch);
  assert.deepEqual(changes.map((change) => [change.commit[0], change.file]), [['a', 'one.txt'], ['a', 'sp ace.txt'], ['b', 'q"uote.txt']]);
  assert.deepEqual(changes[0].lines, [{ line: 1, text: '++ looks like a header' }, { line: 2, text: 'second' }, { line: 3, text: 'third' }]);
  assert.deepEqual(changes[1].lines, [{ line: 5, text: 'only' }]);
});

test('push check: the Claude Code hook (Bash and PowerShell) and the Codex helper hook refuse a credential without showing it', () => {
  const { repos } = pushFixtures();
  const repo = repos['settings-secret'];
  for (const [tool, command] of [['Bash', 'git push'], ['PowerShell', `Set-Location '${repo}'; git push origin feature`]]) {
    const result = runHook(claudeHook, tool, repo, command);
    assert.equal(result.status, 2, `${tool}: ${result.stderr}`);
    assert.match(JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason, /src\/config\.js:1 \(commit [0-9a-f]{7}\): GitHub token/);
    assertNoMatchText(result.stdout + result.stderr, tool);
  }
  const helper = runHook(codexHook, 'Bash', repo, 'git push');
  assert.equal(JSON.parse(helper.stdout.trim().split('\n').pop()).hookSpecificOutput.permissionDecision, 'deny');
  assertNoMatchText(helper.stdout + helper.stderr, 'Codex helper');
  const clean = runHook(claudeHook, 'Bash', repos['settings-clean'], 'git push');
  assert.equal(clean.status, 0);
  assert.equal(clean.stdout + clean.stderr, '');
});

test('push check: with no git on PATH the check still finds git and refuses; when git cannot run, the Claude Code hook lets the push run and shows a note', (t) => {
  const { repos } = pushFixtures();
  // No git on PATH: node is started by its full path, and git is found in its install location.
  const key = Object.keys(process.env).find((name) => name.toUpperCase() === 'PATH') || 'PATH';
  const noPath = { ...process.env, [key]: path.join(os.tmpdir(), 'no-such-folder') };
  delete noPath.TOOLKIT_GIT_PATH;
  const found = runHook(claudeHook, 'Bash', repos['settings-secret'], 'git push', noPath);
  assert.equal(found.status, 2, found.stderr);
  assert.match(JSON.parse(found.stdout).hookSpecificOutput.permissionDecisionReason, /found 1 item\(s\) to fix first/);
  // A configured git that is not a program: the check cannot run.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-push-check-git-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const notAProgram = path.join(scratch, 'not-git.txt');
  fs.writeFileSync(notAProgram, 'not a program\n');
  const env = { ...noPath, TOOLKIT_GIT_PATH: notAProgram };
  // The Codex hook's own run of this case is in toolkit-codex-helper-hook.test.cjs: this fixture is
  // not on github.com, so the governance check holds it there first.
  const result = runHook(claudeHook, 'Bash', repos['settings-secret'], 'git push', env);
  assert.equal(result.status, 0, result.stderr);
  assert.match(JSON.parse(result.stdout).systemMessage, /^Toolkit could not check this push for credentials, so it was let through: git could not run \(\w+\)\.$/);
  assert.match(result.stderr, /git could not run \(\w+\)/);
});

test('push check: a URL remote and --all', () => {
  const { git, commitAll, repos } = pushFixtures();
  const repo = repos.more;
  const branch = (name) => git(repo, 'checkout', '--quiet', '-b', name, 'origin/main');
  // A remote given as a path or URL is compared with what any remote has.
  branch('by-url');
  writeFiles(repo, { 'src/url.js': `"${fakeToken()}"\n` });
  commitAll(repo, 'url');
  const url = git(repo, 'remote', 'get-url', 'origin').trim();
  assert.match(outgoingRefusal(`git push "${url}" by-url`, repo, quiet()), /src\/url\.js:1 /);
  // Once the remote has that commit, a clean commit on top is all a URL push sends.
  git(repo, 'push', '--quiet', 'origin', 'by-url');
  writeFiles(repo, { 'docs/url.md': 'Plain.\n' });
  commitAll(repo, 'clean on top');
  assert.equal(outgoingRefusal(`git push "${url}" by-url`, repo, quiet()), '');
  // --all reads every branch.
  branch('all-plain');
  writeFiles(repo, { 'docs/all.md': `See ${numberReference()}.\n`, 'src/all.js': `"${fakeToken()}"\n` });
  commitAll(repo, 'all');
  const all = outgoingRefusal('git push --all origin', repo, quiet());
  assert.match(all, /src\/all\.js:1 /);
  assert.ok(!all.includes('number-reference'));
});

test('push check: a pull request falls back to origin/main, then gives a note when origin has no base', () => {
  const { git, commitAll, repos } = pushFixtures();
  const repo = repos.more;
  git(repo, 'checkout', '--quiet', '-b', 'pr-base', 'origin/main');
  writeFiles(repo, { 'src/pr.js': `"${fakeToken()}"\n` });
  commitAll(repo, 'pr');
  git(repo, 'remote', 'set-head', 'origin', '--delete');
  assert.match(outgoingRefusal('gh pr create --fill', repo, quiet()), /src\/pr\.js:1 /, 'origin/main without origin/HEAD');
  assert.match(outgoingRefusal('gh pr create --base no-such-branch', repo, quiet()), /src\/pr\.js:1 /, 'a missing --base falls back');
  git(repo, 'update-ref', '-d', 'refs/remotes/origin/main');
  const options = quiet();
  assert.equal(outgoingRefusal('gh pr create --fill', repo, options), '');
  assert.deepEqual(options.notes, ['Toolkit could not check this push for credentials, so it was let through: no base branch was found on origin.']);
});

test('push check: the Claude Code hook refuses a credential next to a broken plain-text setting, and big output has its own note', () => {
  const { repos } = pushFixtures();
  const result = runHook(claudeHook, 'Bash', repos['broken-settings'], 'git push');
  assert.equal(result.status, 2);
  assert.match(JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason, /GitHub token/);
  const big = pushCheck.checkOutgoing({ folder: os.tmpdir() }, { spawn: () => ({ error: Object.assign(new Error('x'), { code: 'ENOBUFS' }), status: null, signal: 'SIGTERM' }) });
  assert.match(big.note, /git wrote more than 64 MB, more than the check reads/);
});

test('push check: git is run by absolute path, never from the pushed folder, PATH order kept', () => {
  const windowsFiles = new Set(['C:\\Tools\\git.exe', 'C:\\repo\\git.exe', 'C:\\Program Files\\Git\\cmd\\git.exe', 'C:\\Users\\u\\AppData\\Local\\Programs\\Git\\cmd\\git.exe', 'D:\\custom\\git.exe']);
  const windows = (environment, folder = 'C:\\repo') => pushCheck.resolveGit(folder, { environment, platform: 'win32', exists: (file) => windowsFiles.has(file) });
  assert.equal(windows({ Path: 'C:\\repo;C:\\Tools' }), 'C:\\Tools\\git.exe', 'the pushed folder on PATH is skipped');
  assert.equal(windows({ PATH: '.;relative\\bin;;C:\\Tools' }), 'C:\\Tools\\git.exe', 'empty and relative entries are skipped');
  assert.equal(windows({ PATH: '"C:\\Tools"' }), 'C:\\Tools\\git.exe', 'a quoted entry');
  assert.equal(windows({ PATH: '', ProgramFiles: 'C:\\Program Files' }), 'C:\\Program Files\\Git\\cmd\\git.exe', 'the usual install location');
  assert.equal(windows({ PATH: '', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }), 'C:\\Users\\u\\AppData\\Local\\Programs\\Git\\cmd\\git.exe', 'a per-user install');
  assert.equal(windows({ toolkit_git_path: 'D:\\custom\\git.exe', PATH: 'C:\\Tools' }), 'D:\\custom\\git.exe', 'TOOLKIT_GIT_PATH first, any case on Windows');
  assert.equal(windows({ TOOLKIT_GIT_PATH: 'custom\\git.exe', PATH: 'C:\\Tools' }), 'C:\\Tools\\git.exe', 'a relative TOOLKIT_GIT_PATH is ignored');
  assert.equal(windows({ PATH: 'C:\\repo' }), '', 'only the pushed folder holds a git');
  const posix = (environment) => pushCheck.resolveGit('/work/repo', { environment, platform: 'linux', exists: (file) => ['/opt/git/bin/git', '/usr/bin/git', '/work/repo/git'].includes(file) });
  assert.equal(posix({ PATH: '/work/repo:/opt/git/bin' }), '/opt/git/bin/git');
  assert.equal(posix({ PATH: '' }), '/usr/bin/git');
  // Every git call of one check spawns the resolved program.
  const programs = [];
  pushCheck.checkOutgoing({ folder: os.tmpdir() }, { git: () => '/fixed/git', spawn: (program) => { programs.push(program); return { status: 128, stdout: '', stderr: '' }; } });
  assert.deepEqual(programs, ['/fixed/git']);
  assert.deepEqual(pushCheck.checkOutgoing({ folder: os.tmpdir() }, { git: () => '' }), { note: 'Toolkit could not check this push for credentials, so it was let through: git was not found.' });
});
