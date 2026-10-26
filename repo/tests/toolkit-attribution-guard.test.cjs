'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const { spawnSync } = childProcess;
const test = require('node:test');
const { BYPASS_MESSAGE, FORCE_MESSAGE, attributionRefusal, attributionDecision, bypassRefusal, MESSAGE } = require('../scripts/toolkit-attribution-guard.cjs');

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
function bypassRepos(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-bypass-'));
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

test('commands that skip commit or push checks are refused in governed and guarded repositories', (t) => {
  const repos = bypassRepos(t);
  const refused = [
    'git commit -n -m x',
    'git commit --no-verify -m x',
    'git commit -anm x',
    'git commit -a -n',
    'git push --no-verify origin main',
    'git push --no-veri',
    'git -c core.hooksPath=/dev/null commit -m x',
    'git -c CORE.HOOKSPATH= push',
    'git -ccore.hooksPath=x push',
    'git --config-env=core.hooksPath=EMPTY push',
    'git config core.hooksPath .nothing',
    'git config --local --unset core.hooksPath',
    'git config set core.hooksPath x',
    'bash -c "git push --no-verify"',
    'pwsh -Command "git commit -n -m x"',
    'cmd /c "git push --no-verify"',
    'git status; git commit --no-verify -m x',
    'git commit `\n  --no-verify -m x',
    'cd sub && git -C .. push --no-verify',
  ];
  for (const root of [repos.governed, repos.guarded]) {
    for (const command of refused) assert.equal(bypassRefusal(command, root), BYPASS_MESSAGE, `${path.basename(root)}: ${command}`);
    assert.equal(bypassRefusal('git commit -n -m x', path.join(root, 'sub')), BYPASS_MESSAGE, 'from a subfolder');
  }
});

test('ordinary commits and pushes, reads of core.hooksPath and other repositories pass', (t) => {
  const repos = bypassRepos(t);
  for (const command of [
    'git commit -m x',
    'git commit -m -nope',
    'git commit -am "fix -n handling"',
    'git commit --no-verbose -m x',
    'git push -n origin main',
    'git push origin main',
    'git config --get core.hooksPath',
    'git config core.hooksPath',
    'git -c core.editor=true commit -m x',
    'git commit -- -n',
    'echo "use git commit --no-verify only in docs"',
  ]) assert.equal(bypassRefusal(command, repos.governed), '', command);
  for (const command of ['git commit -n -m x', 'git push --no-verify']) assert.equal(bypassRefusal(command, repos.plain), '', `plain repository: ${command}`);
  assert.equal(bypassRefusal(`git -C ${JSON.stringify(repos.plain)} commit -n -m x`, repos.governed), '', 'the -C folder decides');
  assert.equal(bypassRefusal(`git -C ${JSON.stringify(repos.governed)} commit -n -m x`, repos.plain), BYPASS_MESSAGE);
});

test('the Claude Code hook and the Codex helper hook refuse a bypass with a deny decision', (t) => {
  const repos = bypassRepos(t);
  const input = (tool) => JSON.stringify({ tool_name: tool, cwd: repos.guarded, tool_input: { command: 'git push --no-verify origin main' } });
  for (const tool of ['Bash', 'PowerShell']) {
    const result = spawnSync(process.execPath, [path.join(repoRoot, 'repo', 'scripts', 'toolkit-claude-attribution-hook.cjs')], { input: input(tool), encoding: 'utf8' });
    assert.equal(result.status, 2, tool);
    assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason, BYPASS_MESSAGE);
  }
  const helper = spawnSync(process.execPath, [path.join(repoRoot, 'repo', 'scripts', 'toolkit-codex-helper-hook.cjs')], { input: input('Bash'), encoding: 'utf8' });
  assert.equal(JSON.parse(helper.stdout.trim().split('\n').pop()).hookSpecificOutput.permissionDecision, 'deny');
  assert.deepEqual(attributionDecision({ tool_input: { command: 'git push --no-verify' }, cwd: repos.plain }), {});
});

test('force pushes are refused in governed and guarded repositories and to evidence stores', (t) => {
  const repos = bypassRepos(t);
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
    for (const command of forced) assert.equal(bypassRefusal(command, root), FORCE_MESSAGE, `${path.basename(root)}: ${command}`);
  }
  assert.equal(bypassRefusal('git push https://github.com/owner/TRANSPORT-evidence.git +main', repos.plain), FORCE_MESSAGE, 'a store named on the command line');
  for (const command of ['git push origin main', 'git push -u origin feature', 'git push -o ci.skip origin main', 'git push --follow-tags origin main', 'git push origin :old-branch']) {
    assert.equal(bypassRefusal(command, repos.store), '', command);
  }
  for (const command of forced) assert.equal(bypassRefusal(command, repos.plain), '', `plain repository: ${command}`);
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
    assert.equal(bypassRefusal('git push --force origin main', root, 0, registryOptions), refused ? FORCE_MESSAGE : '', path.basename(root));
    assert.equal(bypassRefusal('git commit --no-verify -m x', root, 0, registryOptions), refused ? BYPASS_MESSAGE : '', path.basename(root));
  }
});

// The push check: what a git push or gh pr create would send. Fake credentials are built from
// pieces at run time, so no credential-shaped text sits in the repository.
const pushCheck = require('../scripts/toolkit-push-check.cjs');
const { outgoingChanges, outgoingRefusal } = require('../scripts/toolkit-attribution-guard.cjs');
const join = (...parts) => parts.join('');
const fakeToken = () => join('gh', 'p_', 'A1b2C3d4E5f6G7h8'.repeat(2), 'Q9r0');
const numberReference = () => join('#', '123');
// Room for a busy test machine; the real budget is 3 seconds.
const roomy = { budgetMs: 60000 };
const quiet = { err: { write() {} }, ...roomy };

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
  const base = (name, files) => {
    const origin = path.join(dir, `${name}-origin.git`);
    const work = path.join(dir, `${name}-base`);
    git(dir, 'init', '--quiet', '--bare', origin);
    git(dir, 'init', '--quiet', work);
    writeFiles(work, { 'README.md': 'A fixture.\n', ...files });
    git(work, 'add', '-A');
    git(work, 'commit', '--quiet', '-m', 'base');
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
    git(work, 'add', '-A');
    git(work, 'commit', '--quiet', '-m', 'change');
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
  repos.exceptions = scenario(withSettings, 'exceptions', changes.clean);
  repos['toolkit-plain'] = scenario(without, 'toolkit-plain', {
    'repo/contracts/plain-references/config.json': '{}\n', 'repo/scripts/check-plain-references.cjs': '\'use strict\';\n', ...changes.plain
  });
  repos.notRepo = path.join(dir, 'not-a-repo');
  fs.mkdirSync(repos.notRepo);
  fixtures = { dir, git, repos, withSettings };
  return fixtures;
}

function assertNoMatchText(text, label) {
  const token = fakeToken();
  for (let start = 0; start + 8 <= token.length; start += 4) assert.ok(!String(text).includes(token.slice(start, start + 8)), `${label} shows part of the credential`);
}

test('push check: credentials are refused everywhere, plain-text findings only where the check runs, clean changes pass', (t) => {
  const { repos } = pushFixtures();
  const expected = {
    'settings-secret': 'secret', 'settings-plain': 'plain', 'settings-clean': '',
    'plain-secret': 'secret', 'plain-plain': '', 'plain-clean': '', 'toolkit-plain': 'plain', notRepo: '',
  };
  for (const [name, kind] of Object.entries(expected)) {
    const notes = [];
    const reason = outgoingRefusal('git push', repos[name], { err: { write: (line) => notes.push(line) }, ...roomy });
    assert.deepEqual(notes, [], `${name}: no note`);
    if (!kind) { assert.equal(reason, '', name); continue; }
    assert.match(reason, /^Toolkit checked what this push would send and found 1 item\(s\) to fix first:/, name);
    if (kind === 'secret') {
      assert.match(reason, /src\/config\.js:1: GitHub token/, name);
      assert.match(reason, /secret-scan: allow <reason>/, name);
      assertNoMatchText(reason, name);
    } else assert.match(reason, /docs\/guide\.md:1: number-reference/, name);
  }
});

test('push check: every command form finds the folder the push or pull request runs in', (t) => {
  const { dir, repos } = pushFixtures();
  const repo = repos['settings-secret'];
  const name = path.basename(repo);
  const forms = [
    ['git push', repo], ['git push -u origin feature', repo], [`git -C ${name} push`, dir], [`cd ${name} && git push`, dir],
    [`Set-Location ${name}; git push origin feature`, dir], [`git -C ${name} \`\n  push`, dir], [`bash -c "cd ${name} && git push"`, dir],
    [`pwsh -Command "git -C ${name} push"`, dir], ['gh pr create --title x --body y', repo], [`cd ${name}; gh pr create --fill`, dir],
  ];
  for (const [command, cwd] of forms) {
    assert.match(outgoingRefusal(command, cwd, quiet), /GitHub token/, command);
    const decision = attributionDecision({ tool_input: { command }, cwd }, quiet);
    assert.equal(decision.hookSpecificOutput?.permissionDecision, 'deny', command);
  }
  assert.match(outgoingRefusal('gh pr create --title x', repo, quiet), /^Toolkit checked what this pull request would send/);
  for (const command of ['git status', 'git push --delete origin feature', 'git push origin -d feature', 'gh pr view', 'git fetch && git log']) {
    assert.equal(outgoingRefusal(command, repo, quiet), '', command);
  }
  assert.deepEqual(outgoingChanges('gh pr create --base release --title x', dir), [{ folder: dir, pullRequestBase: 'release' }]);
  assert.deepEqual(outgoingChanges('gh pr create -Bnext', dir).map((item) => item.pullRequestBase), ['next']);
  assert.deepEqual(outgoingChanges('gh pr create --base=next', dir).map((item) => item.pullRequestBase), ['next']);
  assert.deepEqual(outgoingChanges('git push', dir), [{ folder: dir }]);
});

test('push check: the range is the tracked branch, else origin\'s default branch, else nothing', (t) => {
  const { git, repos, withSettings } = pushFixtures();
  // On main, which tracks origin/main: only the commit not yet pushed counts.
  writeFiles(withSettings, { 'src/config.js': `const token = "${fakeToken()}";\n` });
  git(withSettings, 'add', '-A');
  git(withSettings, 'commit', '--quiet', '-m', 'ahead');
  assert.match(outgoingRefusal('git push', withSettings, quiet), /GitHub token/);
  git(withSettings, 'push', '--quiet', 'origin', 'main');
  assert.equal(outgoingRefusal('git push', withSettings, quiet), '', 'nothing left to send');
  // No upstream and no origin/HEAD: not checked, and no note.
  const repo = repos['plain-secret'];
  git(repo, 'remote', 'set-head', 'origin', '--delete');
  const notes = [];
  assert.equal(outgoingRefusal('git push', repo, { err: { write: (line) => notes.push(line) }, ...roomy }), '');
  assert.deepEqual(notes, []);
  // A pull request base that origin has is used; a missing one falls back to origin's default branch.
  const pr = repos['settings-secret'];
  assert.match(pushCheck.checkOutgoing({ folder: pr, pullRequestBase: 'main' }, roomy).refusal, /GitHub token/);
  assert.match(pushCheck.checkOutgoing({ folder: pr, pullRequestBase: 'no-such-branch' }, roomy).refusal, /GitHub token/);
});

test('push check: a reviewed exception, a placeholder and a long list are handled', (t) => {
  const { git, repos } = pushFixtures();
  const repo = repos.exceptions;
  writeFiles(repo, {
    'src/allowed.js': `const token = "${fakeToken()}"; // secret-scan: allow fixture for the parser test\n`,
    'src/placeholder.js': `const token = "${join('gh', 'p_', 'x'.repeat(36))}";\n`,
  });
  git(repo, 'add', '-A');
  git(repo, 'commit', '--quiet', '-m', 'exceptions');
  assert.equal(outgoingRefusal('git push', repo, quiet), '');
  writeFiles(repo, { 'src/many.js': Array.from({ length: 12 }, () => `"${fakeToken()}"`).join('\n') });
  git(repo, 'add', '-A');
  git(repo, 'commit', '--quiet', '-m', 'many');
  const reason = outgoingRefusal('git push', repo, quiet);
  assert.match(reason, /found 12 item\(s\)/);
  assert.match(reason, /src\/many\.js:10: GitHub token\n {2}\.\.\.and 2 more\./);
  assert.ok(!reason.includes('src/many.js:11:'));
  assertNoMatchText(reason, 'long list');
});

test('push check: it fails open with one note when git is missing, slow or the check breaks', () => {
  const folder = os.tmpdir();
  const missing = pushCheck.checkOutgoing({ folder }, { spawn: () => ({ error: Object.assign(new Error('x'), { code: 'ENOENT' }) }) });
  assert.equal(missing.refusal, undefined);
  assert.match(missing.note, /did not check this push.*git could not run \(ENOENT\)\. CI still checks it\./);
  const slow = pushCheck.checkOutgoing({ folder }, { spawn: () => ({ error: Object.assign(new Error('x'), { code: 'ETIMEDOUT' }), status: null, signal: 'SIGTERM' }) });
  assert.match(slow.note, /longer than 3 seconds/);
  assert.match(pushCheck.checkOutgoing({ folder }, { budgetMs: -1 }).note, /longer than 3 seconds/);
  const broken = pushCheck.checkOutgoing({ folder }, { spawn: () => { throw new TypeError('boom'); } });
  assert.match(broken.note, /the check failed \(TypeError\)/);
  const notes = [];
  assert.equal(outgoingRefusal('git push', folder, { err: { write: (line) => notes.push(line) }, check: () => { throw new Error('gone'); } }), '');
  assert.equal(notes.length, 1);
  assert.match(notes[0], /could not load\. CI still checks it\.\n$/);
  // The same folder and kind is checked once per command.
  let calls = 0;
  outgoingRefusal('git push && git push origin feature', folder, { err: { write() {} }, check: () => { calls += 1; return {}; } });
  assert.equal(calls, 1);
});

test('push check: added lines follow hunk sizes, quoted paths and CRLF', () => {
  const patch = [
    'diff --git a/one.txt b/one.txt', '--- a/one.txt', '+++ b/one.txt', '@@ -1,2 +1,3 @@', '-old', '-old two', '+++ looks like a header', '+second\r', '+third',
    'diff --git "a/sp ace.txt" "b/sp ace.txt"', '--- /dev/null', '+++ "b/sp ace.txt"', '@@ -0,0 +5 @@', '+only',
    'diff --git a/gone.txt b/gone.txt', '--- a/gone.txt', '+++ /dev/null', '@@ -1 +0,0 @@', '-bye',
  ].join('\n');
  const lines = pushCheck.addedLines(patch);
  assert.deepEqual([...lines.keys()], ['one.txt', 'sp ace.txt']);
  assert.deepEqual(lines.get('one.txt'), [{ line: 1, text: '++ looks like a header' }, { line: 2, text: 'second' }, { line: 3, text: 'third' }]);
  assert.deepEqual(lines.get('sp ace.txt'), [{ line: 5, text: 'only' }]);
});

test('push check: the Claude Code hook (Bash and PowerShell) and the Codex helper hook refuse a credential without showing it', (t) => {
  const { repos } = pushFixtures();
  const repo = repos['settings-secret'];
  // The hooks run with the real 3-second budget; on a machine too busy for it they pass with a note.
  const tooSlow = (result) => {
    if (result.status !== 0 || !/longer than 3 seconds/.test(result.stderr)) return false;
    t.diagnostic('this machine was too slow for the 3-second budget, so the hook passed with a note');
    return true;
  };
  for (const [tool, command] of [['Bash', 'git push'], ['PowerShell', `Set-Location '${repo}'; git push origin feature`]]) {
    const result = spawnSync(process.execPath, [path.join(repoRoot, 'repo', 'scripts', 'toolkit-claude-attribution-hook.cjs')], { input: JSON.stringify({ tool_name: tool, cwd: repo, tool_input: { command } }), encoding: 'utf8' });
    assertNoMatchText(result.stdout + result.stderr, tool);
    if (tooSlow(result)) continue;
    assert.equal(result.status, 2, tool);
    assert.match(JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason, /src\/config\.js:1: GitHub token/);
    assertNoMatchText(result.stdout + result.stderr, tool);
  }
  const helper = spawnSync(process.execPath, [path.join(repoRoot, 'repo', 'scripts', 'toolkit-codex-helper-hook.cjs')], { input: JSON.stringify({ tool_name: 'Bash', cwd: repo, tool_input: { command: 'git push' } }), encoding: 'utf8' });
  assertNoMatchText(helper.stdout + helper.stderr, 'Codex helper');
  if (!/longer than 3 seconds/.test(helper.stderr)) assert.equal(JSON.parse(helper.stdout.trim().split('\n').pop()).hookSpecificOutput.permissionDecision, 'deny');
  const clean = spawnSync(process.execPath, [path.join(repoRoot, 'repo', 'scripts', 'toolkit-claude-attribution-hook.cjs')], { input: JSON.stringify({ tool_name: 'Bash', cwd: repos['settings-clean'], tool_input: { command: 'git push' } }), encoding: 'utf8' });
  assert.equal(clean.status, 0);
  assert.equal(clean.stdout, '');
  if (!tooSlow(clean)) assert.equal(clean.stderr, '');
});
