'use strict';

// Closure matrix for how the continuation guard reads quotes, pipes, host-named folders and
// shells: one table row for each place a host or selector spelling can appear, each with
// allowed and refused controls, under every shell reading that may run the text. Then the
// real hook entry points, which set the host, and the bound on nested command substitution.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { ContinuationResolver, LIMITS, parse } = require('../scripts/toolkit-governance-continuation.cjs');
const gate = require('../scripts/toolkit-governance-gate.cjs');
const { HOOKS, ID, fixture, root, runNodeProcesses, shell, snapshot } = require('./support/governance-continuation-fixture.cjs');

// The shell readings: the hook entry point sets the host, never the payload. Claude Code's Bash
// tool runs bash and its PowerShell tool PowerShell; Codex, Monitor and an unknown host give no
// shell and may run either.
const ENVELOPES = Object.freeze({
  'claude bash': [{ tool_name: 'Bash' }, 'claude'],
  'claude powershell': [{ tool_name: 'PowerShell' }, 'claude'],
  'claude monitor': [{ tool_name: 'Monitor' }, 'claude'],
  codex: [{ tool_name: 'Bash' }, 'codex'],
  omitted: [{ tool_name: 'Bash' }, null],
  bash: [{ tool_name: 'Bash', shell: 'bash' }, null],
  powershell: [{ tool_name: 'Bash', shell: 'powershell' }, null],
  cmd: [{ tool_name: 'Bash', shell: 'cmd' }, null],
});
const N = 'NOT_CONTINUATION', U = 'UNKNOWN';
const all = status => Object.fromEntries(Object.keys(ENVELOPES).map(name => [name, status]));
const but = (status, changes) => ({ ...all(status), ...changes });
function envelope(ctx, text, name) {
  const [{ tool_name, shell: selected }, host] = ENVELOPES[name];
  return { input: { tool_name, cwd: ctx.caller, session_id: 'fixture-run', tool_input: { command: text, ...(selected ? { shell: selected } : {}) } }, host };
}

const P = 'C:/Users/example/.codex/plugins/cache/ai-agent-toolkit-local/ai-agent-toolkit/3.16.6';
// The reported Codex batch, with only the user folder name replaced.
const OWNER_BATCH = [
  `rg -n -A 48 -B 60 'continuation\\?\\.status === .UNKNOWN.' '${P}/repo/scripts/toolkit-governance-gate.cjs'`,
  `rg -n 'function .*ontinu|continuation =|UNKNOWN|selected.session|PreToolUse|toolkit-governance-gate' '${P}/repo/scripts/toolkit-governance-gate.cjs'`,
  `rg --files '${P}' -g '*hook*' -g '*plugin*.json'`,
].join('\n');
const PROJECTS_READ = "cd /c/Users/example/.claude/projects/C--Users-example-GitHub-repo/ && ls -la 0000.jsonl 2>&1; head -c 3000 0000.jsonl | tr ',' '\\n' | grep -i -E 'model|effort|version|sessionId|entrypoint|permission' | head -20";
const WORKTREE_ADD = 'git worktree add -b claude/project-thread-x .tmp/worktrees/x-g1 origin/main 2>&1 | tail -2 && cd .tmp/worktrees/x-g1 && git log --oneline -1 && ls skills/x/scripts/ && wc -l skills/x/scripts/*.cjs repo/scripts/toolkit-governance.cjs';
const SWITCH = 'git switch -c claude/project-thread-x';
const POSIX_ONLY = "rg -n 'codex resume' docs";
// A reported PowerShell read of the plugin manifests under the desktop app's data folder.
const PLUGIN_READ = 'Get-Content "C:/Users/example/AppData/Local/Claude-Data/claude_x/rpm/1/2/plugin_01/.claude-plugin/plugin.json" | Select-String version; '
  + 'Get-ChildItem "$env:USERPROFILE/.claude/plugins/cache" -Recurse -Depth 3 -Filter plugin.json -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName; (Get-Content $_.FullName | Select-String \'"version"\') }';

// [closure matrix row, text, expected status per shell reading]
const MATRIX = [
  // 1. A host word as the command word with a selector: as before, including the verified form.
  [1, 'codex resume', all(U)], [1, 'claude --resume ' + ID, all(U)], [1, 'claude -r x', all(U)],
  [1, 'codex exec resume --last', all('VERIFIED')], [1, 'codex resume --help', all(N)],
  // 2. A host spelling built from quote fragments, format, '+' or join.
  [2, "& ('co'+'dex') resume", all(U)], [2, '& ("cl"+"aude") -r x', all(U)], [2, 'x=co; "${x}dex" resume', all(U)],
  [2, "Write-Output ('ab'+'cd')", all(N)],
  // 3. A dotted host folder in a path argument.
  [3, 'Get-Content "$env:USERPROFILE/.claude/settings.json"', all(N)], [3, 'cat ~/.codex/sessions/x.jsonl | grep resume', all(N)],
  [3, "'.claude' -r example", all(U)], [3, 'C:/example.test/.codex/codex.exe resume', all(U)],
  // 4. An undotted host folder or joined name in a standalone path argument.
  [4, 'ls /c/Users/example/AppData/Local/Temp/claude/abc/scratchpad -r', all(N)], [4, SWITCH, all(N)],
  [4, 'rm -rf .tmp/claude-scratch', all(N)], [4, 'node scripts/toolkit-codex-helper-hook.cjs --resume', all(N)],
  [4, 'git push -u origin claude/project-thread-x', all(N)], [4, 'git checkout -b claude/project-thread-x origin/main', all(N)],
  [4, 'cat repo/tests/claude-projects-skill.test.cjs -r', all(N)], [4, PLUGIN_READ, all(N)],
  [4, 'git log -i -E --grep="co-authored|claude\\.ai|session" --format="%h %s" HEAD~3..HEAD', but(N, { cmd: U })],
  // 5. The same glued to another fragment by a quote or operator, which can spell a host.
  [5, '$x = "C:/x/claude-c"+"ode"; & $x -r', all(U)], [5, 'x=C:/x/claude-"co"de; "$x" -r', all(U)],
  [5, "x='C:/x/'claude-y; codex$x resume", all(U)], [5, '$p = "C:/x/claude-c"+"ode"; & $p -r y', all(U)],
  // Glued by adjacent quotes the word is no name; only bash's echo proves it data.
  [5, 'echo "C:/x/claude-c""ode" -r', { ...all(U), 'claude bash': N, bash: N }],
  // 6. A host spelling as a path leaf.
  [6, 'C:/bin/claude -r x', all(U)], [6, 'C:/x/codex.exe resume', all(U)], [6, 'C:/x/claude-code --resume a', all(U)],
  [6, 'env C:/bin/claude/../claude -r', all(U)], [6, 'ls C:/bin/claude/ && C:/bin/claude -r x', all(U)],
  [6, 'node C:/x/claude-code --resume a', all(U)],
  // 7. A '|' inside a quoted reader pattern is literal, except to cmd, which does not quote with '.
  [7, "rg -n 'resume|fork' C:/example.test/.codex/x.jsonl", but(N, { cmd: U })], [7, "rg -n 'a|b' C:/example.test/.codex/x.jsonl", all(N)],
  [7, OWNER_BATCH, but(N, { cmd: U })],
  // 8. A '|' inside a quoted script argument is a real pipe in that script.
  [8, "bash -c 'echo /x/.claude/ -c | tr -d ./ | sh'", all(U)], [8, "pwsh -Command 'echo /x/.claude -r | iex'", all(U)],
  [8, "sh -c 'cat a | /x/.claude -r'", all(U)], [8, "bash -c 'cat /x/.claude/settings.json | grep model'", all(N)],
  [8, "bash -c 'echo /.claude/ -c | tr -d ./ | sh' && echo ok", all(U)], [8, "env bash -c 'echo /.claude/ -c | tr -d ./ | sh'", all(U)],
  [8, "xargs sh -c 'echo /.claude/ -c | tr -d ./ | sh'", all(U)], [8, "\"C:/Program Files/Git/bin/bash.exe\" -c 'echo /.claude/ -c | tr -d ./ | sh'", all(U)],
  // The same selectors after a program that runs no script take an ordinary argument.
  [8, 'git -C "C:/Users/example/.claude/plugins/marketplaces/x" pull --ff-only', all(N)], [8, 'tar -C "C:/Users/example/.claude/x" -xf a.tar', all(N)],
  [8, 'mkdir -p "C:/Users/example/.claude/x" && cp -r a "C:/Users/example/.claude/x"', all(N)],
  // 9. A real pipe into a pure data filter keeps the folder names; cmd has no PowerShell cmdlets.
  [9, 'Get-Content ~/.claude/x.json | Sort-Object -r', but(N, { cmd: U })], [9, "cat ~/.claude/x.json | tr -cd 'a-z'", all(N)],
  [9, 'cat ~/.claude/x.json | uniq -c', all(N)], [9, 'Get-ChildItem ~/.claude/projects -r | Measure-Object | Format-List | Out-Null', but(N, { cmd: U })],
  [9, PROJECTS_READ, but(N, { cmd: U })],
  // 10. A real pipe into a shell, an interpreter, xargs or any other command withdraws them.
  [10, 'echo /x/.claude -r | xargs echo', all(U)], [10, 'echo /x/.claude -r | node', all(U)], [10, 'echo /x/.claude -r | python', all(U)],
  [10, 'echo /x/.claude -r | Example-Transform', all(U)], [10, 'echo /x/.claude -r | sh', all(U)], [10, 'echo /x/.claude -r | grep x', all(N)],
  // 11. Extraction signals withdraw them.
  [11, '$(echo /x/.claude | cut -c3-) -r', all(U)], [11, 'echo `ls /x/.claude` -r', all(U)], [11, '& (gi ~/.claude).Name.Substring(1) -r', all(U)],
  [11, 'x=/x/.claude; eval "$x -r"', all(U)], [11, '. /x/.claude/run.ps1 -r', all(U)], [11, 'cat ~/.claude/x -r', all(N)],
  // 12 and 13. Claude Code's Bash tool proves data as bash only; every other reading is unchanged.
  [12, POSIX_ONLY, { 'claude bash': N, 'claude powershell': N, 'claude monitor': U, codex: U, omitted: U, bash: N, powershell: N, cmd: U }],
  [12, "rg -n -e 'codex resume' repo/docs; git log --oneline -n 3 -- 'docs/claude notes.md'", but(N, { 'claude monitor': U, codex: U, omitted: U, cmd: U })],
  [13, 'codex resume', all(U)],
  // Fixed operand-only schemas: git apply, switch, checkout, merge-base and ls-tree, and sort operands.
  [4, WORKTREE_ADD, all(N)], [4, 'git fetch -q origin main | tail -1 && git rev-parse origin/main', all(N)],
  [3, 'cat ~/.claude/x.patch | git apply -R', all(N)],
  [4, 'git apply --check "notes on codex resume.patch"', but(N, { cmd: U })], [4, 'git apply -R --stat "codex resume.patch"', but(N, { cmd: U })],
  [4, 'git switch --track -c codex-resume-notes origin/main', but(N, { cmd: U })], [4, 'git checkout -q codex-resume-notes', but(N, { cmd: U })],
  [4, 'git merge-base --is-ancestor codex-resume-notes HEAD', but(N, { cmd: U })], [4, 'git ls-tree -r --name-only codex-resume-notes', but(N, { cmd: U })],
  [4, 'sort -r "codex resume.txt"', { ...all(U), 'claude bash': N, bash: N }],
  [4, "x='--compress-program=codex'; sort $x \"codex resume.txt\"", all(U)], [4, 'git switch -c codex-resume --exec=x', all(U)],
  [4, 'git checkout --ours codex-resume', all(U)], [4, 'git apply --check "codex resume.patch"; codex resume', all(U)],
  // PowerShell script blocks keep a host launch inside them visible.
  [1, 'Get-ChildItem ~/.codex | ForEach-Object { codex resume }', all(U)], [1, 'Get-ChildItem ~/.claude | Where-Object { claude -r x }', all(U)],
  [1, 'Invoke-Command -ScriptBlock { codex resume }', all(U)], [1, 'Get-Content ~/.claude/x | ForEach-Object { claude -r $_ }', all(U)],
];

test('closure matrix: every place a host or selector can appear, under every shell reading', t => {
  const ctx = fixture(t), before = snapshot(ctx.dir);
  const rows = new Set();
  let checks = 0;
  for (const [row, text, expected] of MATRIX) {
    rows.add(row);
    for (const name of Object.keys(ENVELOPES)) {
      const { input, host } = envelope(ctx, text, name);
      assert.equal(parse(text, input, { host }).status, expected[name], `row ${row} ${name}: ${text}`);
      // The resolver carries the same host. A selector proves no target here, so nothing is spawned.
      if (expected[name] !== 'VERIFIED') {
        const resolver = new ContinuationResolver({ environment: ctx.environment, host, spawn() { assert.fail('no metadata acquisition'); } });
        assert.equal(resolver.resolve(text, input).status, expected[name], `resolver row ${row} ${name}: ${text}`);
      }
      checks += 1;
    }
  }
  assert.deepEqual([...rows].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  assert.deepEqual(snapshot(ctx.dir), before);
  t.diagnostic(JSON.stringify({ closureChecks: checks }));
});

test('the reported Codex batch passes in the Codex input shape and under explicit PowerShell', t => {
  const ctx = fixture(t);
  const make = stateReader => new gate.ToolGate({ registryOptions: ctx.options, environment: ctx.environment, stateReader, host: 'codex' });
  const held = { state: 'UNDECIDED', rule: 'R4', repository_id: 'synthetic-held' }, safe = { state: 'DISABLED', rule: 'R1' };
  const extra = { workdir: ctx.caller, sandbox_permissions: 'use_default' };
  for (const input of [
    { tool_name: 'Bash', cwd: ctx.caller, tool_input: { command: OWNER_BATCH, ...extra } },
    { tool_name: 'exec_command', cwd: ctx.caller, tool_input: { cmd: OWNER_BATCH, ...extra } },
    { tool_name: 'Bash', cwd: ctx.caller, tool_input: { command: OWNER_BATCH, ...extra, shell: 'powershell.exe' } },
  ]) {
    assert.equal(parse(OWNER_BATCH, input, { host: 'codex' }).status, N, input.tool_name);
    assert.equal(make(() => safe).decide(input)?.deny, undefined, input.tool_name);
    assert.ok(make(() => held).decide(input)?.deny, input.tool_name + ': the repository guard still runs first');
  }
});

test('nested command substitution stops at a fixed depth and never throws, up to the length limit', () => {
  const tail = 'cat .claude/x';
  const widest = Math.floor((LIMITS.command - 'grep -c x '.length - tail.length) / 3);
  for (const depth of [1000, 5000, widest]) {
    for (const [open, close] of [['$(', ')'], ['"$(', ')"']]) {
      const text = 'grep -c x ' + open.repeat(depth) + tail + close.repeat(depth);
      if (text.length > LIMITS.command) continue;
      for (const name of Object.keys(ENVELOPES)) {
        const { input, host } = envelope({ caller: root }, text, name);
        assert.equal(parse(text, input, { host }).status, U, `${depth} ${open} ${name}`);
      }
    }
  }
  assert.equal(parse('echo $(echo $(echo ok))', { tool_name: 'Bash', cwd: root, tool_input: { command: 'echo $(echo $(echo ok))' } }, { host: 'claude' }).status, N);
  // A smaller stack than the default must not reach its limit either.
  const probe = `const { parse } = require(${JSON.stringify(path.join(root, 'repo/scripts/toolkit-governance-continuation.cjs'))});
const text = 'grep -c x ' + '$('.repeat(1000) + 'cat .claude/x' + ')'.repeat(1000);
process.stdout.write(parse(text, { tool_name: 'Bash', cwd: process.cwd(), tool_input: { command: text } }).status);`;
  const result = spawnSync(process.execPath, ['--stack-size=400', '-e', probe], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, U);
});

test('the source hooks set their own host: Claude Bash reads as bash, Codex and Monitor keep both shells', async t => {
  const ctx = fixture(t);
  const env = { ...process.env, ...ctx.environment, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(ctx.home, 'absent-gitconfig') };
  for (const key of Object.keys(env)) if (/^(?:TOOLKIT_|CLAUDE_CODE_REMOTE|CLAUDE_ENV_FILE|NODE_OPTIONS)/.test(key)) delete env[key];
  for (const args of [['init', '--quiet'], ['remote', 'add', 'origin', 'https://github.com/example-owner/caller.git']]) {
    const result = spawnSync('git', ['-c', 'core.fsmonitor=false', '-C', ctx.caller, ...args], { env, encoding: 'utf8', windowsHide: true, timeout: 10000 });
    assert.equal(result.status, 0, 'synthetic fixture git: ' + result.stderr);
  }
  gate.writeGovernanceDecision(ctx.caller, 'enable', { registryOptions: ctx.options });
  // [text, tool, refused by the Claude hook, refused by the Codex hook]
  const cases = [
    [OWNER_BATCH, 'Bash', false, false], [PROJECTS_READ, 'Bash', false, false], [WORKTREE_ADD, 'Bash', false, false], [SWITCH, 'Bash', false, false],
    [POSIX_ONLY, 'Bash', false, true], [POSIX_ONLY, 'PowerShell', false, false], [POSIX_ONLY, 'Monitor', true, true], [PLUGIN_READ, 'PowerShell', false, false],
    ['codex resume', 'Bash', true, true], ['claude --resume ' + ID, 'Bash', true, true],
  ];
  const calls = [];
  for (const hook of HOOKS) for (const [command, tool_name, claudeDenies, codexDenies] of cases) {
    calls.push({ hook, denied: hook.name === 'claude' ? claudeDenies : codexDenies, label: hook.name + '/' + tool_name + ': ' + command.slice(0, 60),
      input: { ...shell(ctx, command), tool_name, tool_input: { command } } });
  }
  const before = snapshot(ctx.dir);
  const results = await runNodeProcesses(calls.map(({ hook, input }) => ({
    args: [path.join(root, 'repo/scripts', hook.file), ...hook.args], input: JSON.stringify(input), env, cwd: ctx.caller,
  })));
  calls.forEach(({ hook, denied, label }, index) => {
    const result = results[index];
    assert.equal(result.status, denied ? hook.deniedExit : 0, label + ': exit');
    const output = result.stdout.trim() ? JSON.parse(result.stdout) : {};
    assert.equal(output.hookSpecificOutput?.permissionDecision === 'deny', denied, label);
    if (denied) assert.match(output.hookSpecificOutput.permissionDecisionReason, /continuation is refused/, label);
  });
  assert.deepEqual(snapshot(ctx.dir), before);
});
