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
