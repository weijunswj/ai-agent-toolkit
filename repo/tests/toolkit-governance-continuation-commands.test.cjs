'use strict';

// Continuation classification of shell commands: host folder names, folder-name exclusions, literal
// readers, inert data, shell families, embedded and hostile text, refusals and path guards; and the
// target-authority model with its resolver, transcript reader and selectors.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { ContinuationResolver, TranscriptReader, LIMITS, parse } = require('../scripts/toolkit-governance-continuation.cjs');
const gate = require('../scripts/toolkit-governance-gate.cjs');
const hostile = require('./support/hostile-inputs.cjs');
const matrix = require('./support/governance-continuation-matrix.json');
const refusalCases = require('./support/governance-continuation-refusal-cases.json');
const { dataClass, evidenceProjection, expectedFor, fixture, ID, message, OTHER_ID, shell, snapshot, transcript } = require('./support/governance-continuation-fixture.cjs');

test('host-named directories and variables are names, not continuation evidence, on both envelopes', t => {
  const ctx = fixture(t), before = snapshot(ctx.dir);
  // Everyday reads of host configuration and plugin folders, and the reported readiness shape.
  const ordinary = [
    "git rev-parse 'HEAD^{tree}'; node C:/example.test/.codex/check.cjs",
    "git rev-parse HEAD 'HEAD^{tree}'; git status --short; git ls-remote origin refs/heads/deployment/example; python _logs/example/validate.py; node C:/Users/example/.codex/plugins/cache/ai-agent-toolkit-local/ai-agent-toolkit/3.15.19/skills/external-operation-preflight/scripts/preflight-check.cjs _logs/example/plan.json",
    'Get-Content "$env:USERPROFILE/.claude/settings.json"',
    'Get-ChildItem ~/.claude -Recurse',
    'grep -rn example ~/.claude/settings.json',
    'cat .claude-plugin/plugin.json | jq -r .version',
    'Get-ChildItem C:\\Users\\example\\.codex\\sessions -Recurse',
    'node "$CLAUDE_PROJECT_DIR/scripts/example.js"',
    'ls $env:CODEX_HOME',
    'echo co/.claude/dex$x',
    'cat ~/.codex/sessions/example.jsonl | grep resume',
  ];
  // Earlier rows that used such a folder: 18 unproved-syntax rows whose only evidence it was,
  // and 61 proved rows that would pass without their proof. Both now use an undotted folder.
  const earlier = matrix.name_barrier_cases;
  assert.equal(earlier.length, 79);
  // A dotted name touching no path separator, a host after the directory, a selector beside a
  // variable, constructed spellings and non-ASCII input all keep the conservative result.
  const retained = [
    ...refusalCases.cases.filter(row => row.expected === 'UNKNOWN' && !row.data && !row.id.startsWith('D')).map(row => row.text),
    'codex resume --last',
    'claude -r example',
    "'.claude' -r example",
    'C:/example.test/.codex/codex.exe resume',
    'ls ~/.codex/; codex fork',
    '& $codex resume',
    '$env:CODEX_HOME; codex resume',
    "node C:/example.test/.codex/check.cjs; & ('co'+'dex') resume",
    'ls ~/.claude/; & ("cl"+"au"+"de") -r example',
    'Get-ChildItem ~/.claude/ -Recurse; & ("cl"+"aude") -c',
    'Get-Content "$env:USERPROFILE/.claude/\u00e9.json" -Raw',
    // Variables that can hold the host executable, and names that are not variables.
    '"$CLAUDE_CODE_EXECPATH" -c -p hi', '& $env:CLAUDE_CODE_EXECPATH -r x', 'exec "$CLAUDE_CODE_EXECPATH" -c -p hi',
    "Start-Process $env:CLAUDE_CODE_EXECPATH -ArgumentList '-r'", '& $claude -r', '& $env:claude_BIN -r', '"$claude_PATH" -r',
    "$x='$claude'.Substring(1); & $x -r", "x='$claude'; ${x:1} -r",
    // Runtime extraction of a host spelling from a folder name keeps the earlier result.
    'echo /.claude -r | cut -c3- | sh', 'echo /.codex resume | cut -c3- | sh', '$(echo /.claude | cut -c3-) -r',
    '& (gi ~/.claude).Name.Substring(1) -r', '& ("x/.claude".Substring(3)) -r',
    '& ([io.path]::GetFileName("~/.claude").TrimStart(".")) -r', "& ('~/.claude' -replace '.*\\.') -r",
    '& (-join (gi ~/.claude).Name[1..6]) -r', 'x=~/.claude/; y=${x%/}; ${y##*/.} -r', 'cmd /v:on /c "set x=~/.claude&& !x:~3! -r"',
  ];
  let checks = 0;
  for (const row of earlier) {
    const input = shell(ctx, row.text, row.shell ? { tool_input: { command: row.text, shell: row.shell } } : {});
    assert.equal(parse(row.text, input).status, row.expected, row.id); checks += 1;
  }
  for (const shellName of [undefined, 'powershell.exe', 'bash']) {
    for (const command of ordinary) {
      const input = shell(ctx, command, shellName ? { tool_input: { command, shell: shellName } } : {});
      assert.deepEqual(parse(command, input), { status: 'NOT_CONTINUATION' }, `${shellName}: ${command}`); checks += 1;
    }
    for (const command of retained) {
      const input = shell(ctx, command, shellName ? { tool_input: { command, shell: shellName } } : {});
      assert.notEqual(parse(command, input).status, 'NOT_CONTINUATION', `${shellName}: ${command}`); checks += 1;
    }
    // Copying a dotted plugin folder is data where a POSIX shell runs cp; the other shells keep the refusal.
    const copy = 'cp -r .claude-plugin /tmp/example', input = shell(ctx, copy, shellName ? { tool_input: { command: copy, shell: shellName } } : {});
    assert.equal(parse(copy, input).status, shellName === 'bash' ? 'NOT_CONTINUATION' : 'UNKNOWN', `${shellName}: ${copy}`); checks += 1;
  }
  // Production ToolGate keeps every raw guard for the newly ordinary reads.
  const held = { state: 'UNDECIDED', rule: 'R4', repository_id: 'synthetic-held' }, safe = { state: 'DISABLED', rule: 'R1' };
  for (const command of ordinary) for (const tool_name of ['Bash', 'PowerShell']) {
    const input = { ...shell(ctx, command), tool_name, tool_input: { command } };
    const make = stateReader => new gate.ToolGate({ registryOptions: ctx.options, environment: ctx.environment, stateReader,
      continuationResolver: new ContinuationResolver({ environment: ctx.environment, spawn() { throw new Error('UNEXPECTED_METADATA'); } }) });
    assert.equal(make(() => safe).decide(input)?.deny, undefined, command);
    assert.ok(make(() => held).decide(input)?.deny, command);
    checks += 2;
  }
  assert.deepEqual(snapshot(ctx.dir), before);
  t.diagnostic(JSON.stringify({ nameBarrierChecks: checks }));
});

// Every changed comparison row has an explicit result on its original shell envelopes.
// Shell envelopes are retained exactly, including omitted and malformed metadata.
for (const row of refusalCases.cases) test('comparison classification: ' + row.id, t => {
  const ctx = fixture(t), before = snapshot(ctx.dir);
  const resolver = new ContinuationResolver({ environment: ctx.environment,
    spawn() { assert.fail('unproved command cannot acquire target metadata'); } });
  const currentGate = new gate.ToolGate({ registryOptions: ctx.options, environment: ctx.environment,
    continuationResolver: resolver, stateReader: () => ({ state: 'DISABLED', rule: 'R1' }) });
  const heldGate = new gate.ToolGate({ registryOptions: ctx.options, environment: ctx.environment,
    continuationResolver: resolver, stateReader: () => ({ state: 'UNDECIDED', rule: 'R4', repository_id: 'synthetic-held' }) });
  assert.ok(['UNKNOWN', 'NOT_CONTINUATION'].includes(row.expected), row.id + ': explicit expected result');
  assert.ok(row.shell_indexes.length, row.id + ': changed shell envelopes retained');
  for (const index of row.shell_indexes) {
    assert.ok(Object.hasOwn(refusalCases.shell_envelopes, index));
    for (const tool_name of ['Bash', 'PowerShell']) for (const key of ['command', 'cmd']) {
      const input = { ...shell(ctx, row.text), tool_name,
        tool_input: { [key]: row.text, ...refusalCases.shell_envelopes[index] } };
      const label = row.id + '/' + index + '/' + tool_name + '/' + key, expected = expectedFor(row, input);
      assert.equal(parse(row.text, input).status, expected, label);
      assert.equal(resolver.resolve(row.text, input).status, expected, label);
      for (const actor of matrix.actors) {
        assert.equal(Boolean(currentGate.decide({ ...input, actor })?.deny), expected === 'UNKNOWN', label + '/' + actor);
        assert.ok(heldGate.decide({ ...input, actor })?.deny, label + '/' + actor + ': held repository');
      }
    }
  }
  assert.deepEqual(snapshot(ctx.dir), before);
});

test('folder-name exclusions close command-position and derived-text families', () => {
  const retained = [];
  for (const separator of ['', '; ', '&& ', '|| ', '| ', '& ', '(', ') ', '{ ', '} ', '\n']) {
    for (const word of ['/.claude', '~/.claude.exe', '.codex/resume', '"C:/example path/.claude"',
      'C:/example\\ path/.claude', 'C:/example/".claude/resume"', "'C:/example/'\".claude/resume\""]) {
      retained.push((separator ? 'git status ' + separator : '') + word + ' -r');
    }
  }
  for (const wrapper of ['env', 'env -i', 'command --', 'nohup', 'xargs', 'sudo', 'time', 'nice -n 1',
    'timeout 1', 'setsid', 'stdbuf -o0', 'chroot /tmp/example.test', 'if', 'then', 'else', 'while', 'until', 'do',
    'VAR=value', '> /tmp/example.test', '"C:/tools/ENV.EXE"', "e'n'v", 'e\\nv', 'env command nohup']) {
    retained.push(wrapper + ' /.claude -r');
  }
  retained.push('cat /.claude -r | ForEach-Object { /.claude -r }');
  retained.push('cat /.claude -r | ForEach-Object { . /tmp/example.test }');
  for (const target of ['sh', '/bin/sh', '"sh"', "'sh'", 'C:/PowerShell/PWSH.EXE', 'env sh',
    'command sh', 'exec sh', 'nohup sh', 'xargs sh', "& 'iex'", 'Example-Transform']) {
    retained.push('echo /.claude -r | cut -c3- | ' + target);
  }
  for (const action of ['eval "$x -r"', 'source fixture.test', '. fixture.test', 'exec "$x" -r',
    'Invoke-Expression "$x -r"', 'IEX "$x -r"', '& ($x) -r', "& 'fixture' -r", '& "fixture" -r',
    '& $x -r', "& ('x/.claude'.('Sub'+'string')(3)) -r", '& $x.$method(3) -r']) {
    retained.push('x=/.claude -r; ' + action);
  }
  for (const action of ["e'va'l", 'e\\val', "s'ou'rce", "'.'", "'/bin/eval'", "'/bin/exec'", '"I"EX', "Invoke-'Expression'"]) {
    retained.push('echo /.claude -r | cut -c3- > /tmp/example.test; ' + action + ' /tmp/example.test');
  }
  for (const text of ['ls "$CODEX_HOME', 'ls ~/.claude/\u0000 -r', 'ls ~/.claude/\u00e9 -r']) retained.push(text);
  // Variable names spelled with a host word are listed data wherever the shell reads them as data.
  // cmd and unknown shells keep the refusal, and an omitted shell may be cmd, which reads '^'.
  const every = ['omitted', 'powershell', 'posix'];
  const named = [['ls $env:codex_home', every], ["ls '$CODEX_HOME'", every], ['ls \\$CODEX_HOME', every], ['ls ^$CODEX_HOME', ['powershell', 'posix']]];
  for (const envelope of refusalCases.shell_envelopes) {
    for (const text of retained) assert.equal(parse(text, { tool_input: { command: text, ...envelope } }).status, 'UNKNOWN', text);
    for (const [text, data] of named) {
      const input = { tool_input: { command: text, ...envelope } };
      assert.equal(parse(text, input).status, data.includes(dataClass(input)) ? 'NOT_CONTINUATION' : 'UNKNOWN', text + ' ' + JSON.stringify(envelope));
    }
  }
  // Every allowed pipe target consumes data without deriving a command name.
  for (const target of ['grep resume', 'jq -r .version', 'head', 'tail', 'sort', 'wc', 'cut -c1-',
    'ConvertFrom-Json', 'ConvertTo-Json', 'Select-Object', 'Select-String resume', 'Where-Object { $_ }',
    'ForEach-Object { $_ }', 'Out-String', 'git status']) {
    const text = 'cat ~/.codex/sessions/example.jsonl | ' + target;
    assert.equal(parse(text, { tool_input: { command: text } }).status, 'NOT_CONTINUATION', text);
  }
  // Oversized requests must return to the existing evidence path before any new scan.
  const bounded = evidenceProjection(source => source.replace('function derivedNameExecution(text) {',
    'function derivedNameExecution(text) { throw new Error("OVERSIZED_NAME_SCAN");'));
  for (const unit of ['ls ~/.claude/ -r; ', 'cat ~/.codex/sessions/example.jsonl | grep resume | ', '~/.claude/']) {
    const text = (unit === '~/.claude/' ? '"' : '') + unit.repeat(Math.ceil(1048576 / unit.length));
    assert.equal(bounded.parse(text, { tool_input: { command: text } }).status, 'UNKNOWN');
  }
});

test('literal reader roles and executable script operands follow the closed data boundary', t => {
  const ctx = fixture(t), before = snapshot(ctx.dir);
  const held = { state: 'UNDECIDED', rule: 'R4', repository_id: 'synthetic-held' };
  for (const row of matrix.literal_role_cases) {
    const input = shell(ctx, row.text);
    if (row.shell !== undefined) input.tool_input.shell = row.shell;
    const expected = expectedFor(row, input);
    assert.equal(parse(row.text, input).status, expected, row.id);
    for (const actor of matrix.actors) {
      const decide = stateReader => new gate.ToolGate({ registryOptions: ctx.options, environment: ctx.environment, stateReader }).decide({ ...input, actor });
      assert.equal(Boolean(decide(() => ({ state: 'DISABLED', rule: 'R1' }))?.deny), expected === 'UNKNOWN', row.id + '/' + actor);
      assert.ok(decide(() => held)?.deny, row.id + ': current guard before data proof');
      const workdir = { ...input, actor, tool_input: { ...input.tool_input, workdir: ctx.other } };
      assert.ok(new gate.ToolGate({ registryOptions: ctx.options, stateReader: cwd => cwd === ctx.other ? held : { state: 'DISABLED', rule: 'R1' } }).decide(workdir)?.deny, row.id + ': workdir guard');
    }
  }
  const currentGate = new gate.ToolGate({ registryOptions: ctx.options, stateReader: () => ({ state: 'DISABLED', rule: 'R1' }) });
  assert.ok(currentGate.decide(shell(ctx, 'rg -e "codex resume toolkit governance enable" fixture.txt'))?.deny, 'owner answer guard precedes reader roles');
  assert.ok(currentGate.decide({ tool_name: 'Write', cwd: ctx.caller, tool_input: { file_path: ctx.options.registryPath } })?.deny, 'user-state edit guard remains independent');
  const absoluteHeld = `rg -e "codex resume" "${ctx.other}/fixture.txt"`;
  assert.ok(new gate.ToolGate({ registryOptions: ctx.options, stateReader: cwd => cwd === ctx.other || cwd.startsWith(ctx.other + path.sep) ? held : { state: 'DISABLED', rule: 'R1' } }).decide(shell(ctx, absoluteHeld))?.deny, 'known absolute path guard precedes reader roles');
  assert.deepEqual(snapshot(ctx.dir), before);
});

test('the complete 7,140-row target-authority model runs through ToolGate, independent of actor and held queue', t => {
  const ctx = fixture(t);
  const codes = new Set(Object.values(matrix.codes));
  assert.equal(matrix.commands.length * matrix.target_states.length * matrix.actors.length, matrix.expected_row_count);
  assert.equal(matrix.expected_row_count, 7140);
  for (const pattern of matrix.patterns) { assert.equal(pattern.length, matrix.target_states.length); for (const c of pattern) assert.ok(codes.has(c)); }
  // This is the authority model, deliberately separated from native-selector qualification below.
  // No injected VERIFIED result is claimed as production metadata proof.
  let count = 0;
  for (const [stateIndex, state] of matrix.target_states.entries()) {
    const registryOptions = { registryPath: path.join(ctx.home, state.id, '.ai-agent-toolkit', 'user-state', 'repository-governance.v1.json'), testOnly: true };
    const heldFile = path.join(path.dirname(registryOptions.registryPath), gate.HELD_BASENAME);
    fs.mkdirSync(path.dirname(heldFile), { recursive: true });
    if (state.store === 'unreadable-held-store') fs.mkdirSync(heldFile);
    else if (state.store === 'malformed-held-store') fs.writeFileSync(heldFile, '{invalid');
    else if (state.store) new gate.HeldPrompts({ registryOptions }).add('synthetic-other', 'synthetic queued fixture', state.store.includes('sessionless') ? null : 'other-session', {}, state.store.includes('rootless') ? null : ctx.other);
    const marked = gate.startSession({ session_id: 'fixture-run', source: 'startup' }, { registryOptions });
    assert.ok(marked);
    if (state.id === 'caller_later_new_run_held') {
      fs.writeFileSync(path.join(path.dirname(heldFile), gate.NOT_NOW_BASENAME), JSON.stringify({ schema: 'toolkit.governance-not-now.v1', repositories: { 'fixture-target': { sessions: { 'fixture-run': '2026-10-01T00:00:00.000Z' }, epochs: { 'fixture-run': marked }, repository_marks: {} } } }));
    }
    const before = snapshot(ctx.dir);
    for (const command of matrix.commands) for (const actor of matrix.actors) {
      const expected = matrix.patterns[command.expected][stateIndex];
      const text = command.text.replaceAll('{ID}', ID).replaceAll('{OTHER_ID}', OTHER_ID).replaceAll('{TARGET}', ctx.target)
        .replaceAll('{OTHER}', ctx.other).replaceAll('{TRANSCRIPT}', ctx.file).replaceAll('{USER_STATE}', path.dirname(registryOptions.registryPath));
      const input = shell(ctx, text, { actor });
      if (command.kind === 'state-denial' || command.id === 'target_edit') { input.tool_name = 'Write'; input.tool_input = { file_path: command.kind === 'state-denial' ? heldFile : path.join(ctx.target, 'fixture.txt') }; }
      if (command.id === 'target_patch') { input.tool_name = 'apply_patch'; input.tool_input = { input: text }; }
      if (command.variant === 'workdir' || command.variant === 'cwd') input.tool_input[command.variant] = state.executionHeld ? ctx.other : ctx.target;
      const stateReader = cwd => {
        const target = path.resolve(cwd);
        if (target === ctx.caller && state.currentHeld) return { state: 'UNDECIDED', rule: state.id === 'caller_state_unreadable' ? 'ERROR' : 'R4', repository_id: 'fixture-caller', error_code: 'SYNTHETIC' };
        if (target === ctx.other || target.startsWith(ctx.other + path.sep)) return { state: 'UNDECIDED', rule: 'R4', repository_id: 'fixture-other' };
        if (target === ctx.target || target.startsWith(ctx.target + path.sep)) {
          if (state.verdict === 'error') throw new Error('synthetic target read failure');
          return { state: state.verdict === 'hold' ? 'UNDECIDED' : state.id === 'disabled' ? 'DISABLED' : 'ENABLED', rule: state.id === 'not_github_awaiting_ok' ? 'R9' : state.id === 'target_registry_unreadable' ? 'ERROR' : 'R4', repository_id: 'fixture-target', error_code: 'SYNTHETIC' };
        }
        return { state: 'DISABLED', rule: 'R1', repository_id: null };
      };
      const continuationResolver = { resolve() {
        if (['ordinary', 'path-command', 'path-edit', 'owner-denial', 'state-denial'].includes(command.kind)) return { status: 'NOT_CONTINUATION' };
        if (command.kind === 'unknown' || (state.proof !== 'verified' && command.proof !== 'directory-restricted-last')) return { status: 'UNKNOWN' };
        return { status: 'VERIFIED', targets: [ctx.target, ...(state.otherHeld || state.executionHeld ? [ctx.other] : [])] };
      } };
      const decision = new gate.ToolGate({ registryOptions, stateReader, continuationResolver, environment: ctx.environment }).decide(input);
      assert.equal(Boolean(decision?.deny), expected !== 'A', `${command.id}/${state.id}/${actor}: ${expected}`);
      if (expected === 'O') assert.match(decision.deny, /only the user/);
      if (expected === 'U') assert.match(decision.deny, /user-state files/);
      count += 1;
    }
    assert.deepEqual(snapshot(ctx.dir), before, `no queue, epoch, decision, metadata or directory mutation: ${state.id}`);
  }
  assert.equal(count, 7140);
});

test('production resolver reads exact native Claude metadata in its acquisition child and returns only directories', t => {
  const ctx = fixture(t);
  transcript(ctx, [message(ctx.target), message(ctx.other, { uuid: OTHER_ID })]);
  const before = snapshot(ctx.dir);
  const resolver = new ContinuationResolver({ environment: ctx.environment });
  for (const command of [`claude --resume "${ctx.file}"`, `claude -r "${ctx.file}" --fork-session`, `claude -p --resume="${ctx.file}" "summarise"`, `cd "${ctx.target}" && cd sub && claude --resume "${ctx.file}"`]) {
    const result = resolver.resolve(command, shell(ctx, command));
    assert.equal(result.status, 'VERIFIED', command);
    assert.ok(result.targets.includes(ctx.target)); assert.ok(result.targets.includes(ctx.other));
    assert.doesNotMatch(JSON.stringify(result), /synthetic fixture|message|content|sessionId/);
  }
  const noise = path.join(ctx.projects, 'unrelated-project');
  fs.mkdirSync(noise); fs.mkdirSync(path.join(noise, `${ID}.jsonl`));
  assert.equal(resolver.resolve(`claude -r "${ctx.file}"`, shell(ctx, '')).status, 'VERIFIED', 'exact path does not scan an unrelated lower-priority project');
  fs.rmSync(noise, { recursive: true });
  assert.deepEqual(snapshot(ctx.dir), before);
});

test('default transcript reader refuses missing, malformed, nested, conflicting, truncated and excessive metadata', t => {
  const ctx = fixture(t), reader = new TranscriptReader();
  const read = () => reader.read({ file: ctx.file, projects: ctx.projects });
  const cases = [
    [], [{ type: 'summary', nested: message(ctx.target) }], [message(undefined)], [message('relative')],
    [message(ctx.target, { sessionId: OTHER_ID })], [message(ctx.target), message(ctx.target, { sessionId: OTHER_ID })],
    [message(ctx.target, { uuid: 'not-native' })], [message(ctx.target, { timestamp: 'invalid' })],
    [message(ctx.target, { isSidechain: true })], [message(ctx.target, { message: null })],
    [message(ctx.target, { message: { content: 'x'.repeat(LIMITS.record) } })],
  ];
  for (const rows of cases) { transcript(ctx, rows); assert.equal(read().status, 'UNKNOWN'); }
  for (const bytes of ['{bad', JSON.stringify(message(ctx.target)) + '\n{', ' '.repeat(LIMITS.bytes + 1), '\n'.repeat(LIMITS.records + 1)]) {
    fs.writeFileSync(ctx.file, bytes); assert.equal(read().status, 'UNKNOWN');
  }
  fs.writeFileSync(ctx.file, Buffer.from([0xff])); assert.equal(read().status, 'UNKNOWN');
  fs.rmSync(ctx.file); assert.equal(read().status, 'UNKNOWN');
  fs.mkdirSync(ctx.file); assert.equal(read().status, 'UNKNOWN'); fs.rmdirSync(ctx.file);
  transcript(ctx);
  assert.equal(reader.read({ file: ctx.file, projects: ctx.caller }).status, 'UNKNOWN');
  let stats = 0;
  const io = Object.create(fs);
  io.fstatSync = fd => { const stat = fs.fstatSync(fd); if (++stats > 1) stat.size += 1; return stat; };
  assert.equal(new TranscriptReader({ io }).read({ file: ctx.file, projects: ctx.projects }).status, 'UNKNOWN', 'read drift is refused');
  const unreadable = Object.create(fs); unreadable.openSync = () => { throw new Error('synthetic unreadable'); };
  assert.equal(new TranscriptReader({ io: unreadable }).read({ file: ctx.file, projects: ctx.projects }).status, 'UNKNOWN');
  const replaced = Object.create(fs); replaced.lstatSync = file => { const stat = fs.lstatSync(file); if (file === ctx.file) stat.ino = -1; return stat; };
  assert.equal(new TranscriptReader({ io: replaced }).read({ file: ctx.file, projects: ctx.projects }).status, 'UNKNOWN', 'replacement identity is refused');
});

test('native parent junctions and symlinks cannot supply target identity', t => {
  const ctx = fixture(t);
  transcript(ctx);
  const alias = path.join(ctx.home, 'alias');
  fs.symlinkSync(ctx.projects, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(new TranscriptReader().read({ file: path.join(alias, 'fixture-project', `${ID}.jsonl`), projects: alias }).status, 'UNKNOWN');
  const cwdAlias = path.join(ctx.dir, 'alias-target');
  fs.symlinkSync(ctx.target, cwdAlias, process.platform === 'win32' ? 'junction' : 'dir');
  transcript(ctx, [message(cwdAlias)]);
  assert.equal(new ContinuationResolver({ environment: ctx.environment }).resolve(`claude -r "${ctx.file}"`, shell(ctx, '')).status, 'UNKNOWN');
});

test('only source-proven selectors qualify; directory-filtered exec/e --last never reads transcript or ID indexes', t => {
  const ctx = fixture(t);
  const resolver = new ContinuationResolver({ environment: ctx.environment, spawn() { assert.fail('directory proof must not acquire metadata'); } });
  for (const command of ['codex exec resume --last', 'codex e resume --last', `codex -C "${ctx.target}" exec resume --last`, `codex exec --cd="${ctx.target}" resume --last`, `cd "${ctx.target}" && cd sub && codex exec resume --last`]) {
    const result = resolver.resolve(command, shell(ctx, command));
    assert.equal(result.status, 'VERIFIED', command);
  }
  for (const command of [`codex resume ${ID}`, `codex exec resume ${ID}`, `codex e resume ${ID}`, `codex exec fork ${ID}`, 'codex resume --last', 'codex fork --last', 'codex exec fork --last', 'codex exec resume --last --all', `claude --resume ${ID}`, `claude --session-id ${ID}`, 'claude --continue', 'claude -pc summarise', `codex exec resume ${ID} --last`]) {
    assert.equal(resolver.resolve(command, shell(ctx, command)).status, 'UNKNOWN', command);
  }
  const ordinary = 'codex -c model=x exec "summarise"';
  assert.equal(resolver.resolve(ordinary, shell(ctx, ordinary)).status, 'NOT_CONTINUATION');
  for (const command of ['claude --version', 'head -n 3 notes.txt; claude --version', 'echo "codex resume"', 'echo "claude --resume fixture"', 'git log --grep="codex resume"', `git -C "${ctx.target}" status && claude -p "summarise the repo"`, 'codex exec "please resume the task"', `cd "${ctx.target}" && claude -p "summarise the repo"`]) assert.equal(resolver.resolve(command, shell(ctx, command)).status, 'NOT_CONTINUATION', command);
  const workdir = resolver.resolve('codex exec resume --last', shell(ctx, '', { tool_input: { workdir: ctx.target } }));
  assert.deepEqual(workdir.targets, [ctx.target]);
  assert.equal(resolver.resolve('codex exec resume --last', shell(ctx, '', { tool_input: { workdir: ctx.target, cwd: ctx.other } })).status, 'UNKNOWN');
  for (const workdir of ['C:relative', 'relative', 1]) assert.equal(resolver.resolve('codex exec resume --last', shell(ctx, '', { tool_input: { workdir } })).status, 'UNKNOWN');
  if (process.platform === 'win32') assert.equal(resolver.resolve('codex exec resume --last', shell(ctx, '', { tool_input: { workdir: '\\unbound-drive' } })).status, 'UNKNOWN');
});

test('every command axis has an explicit default native qualification, with no injected target proof', t => {
  const ctx = fixture(t); transcript(ctx);
  const resolver = new ContinuationResolver({ environment: ctx.environment });
  let checked = 0;
  for (const command of matrix.commands) {
    const text = command.text.replaceAll('{ID}', ID).replaceAll('{OTHER_ID}', OTHER_ID).replaceAll('{TARGET}', ctx.target)
      .replaceAll('{OTHER}', ctx.other).replaceAll('{TRANSCRIPT}', ctx.file).replaceAll('{USER_STATE}', path.dirname(ctx.options.registryPath));
    const result = resolver.resolve(text, shell(ctx, text));
    const expected = ['claude_transcript', 'codex_exec_last'].includes(command.id) ? 'VERIFIED'
      : ['continuation', 'unknown', 'owner-denial'].includes(command.kind) && command.id !== 'governance_cli_answer' ? 'UNKNOWN' : 'NOT_CONTINUATION';
    assert.equal(result.status, expected, command.id); checked += 1;
  }
  assert.equal(checked, 51);
  for (const tool_name of ['Bash', 'PowerShell', 'Monitor', 'exec_command', 'shell', 'local_shell']) for (const args of [{ command: 'codex exec resume --last' }, { cmd: 'codex exec resume --last' }, { command: ['codex', 'exec', 'resume', '--last'] }]) {
    const input = { tool_name, cwd: ctx.caller, tool_input: { ...args, workdir: ctx.target } };
    assert.equal(new gate.ToolGate({ registryOptions: ctx.options, environment: ctx.environment, stateReader: () => ({ state: 'DISABLED', rule: 'R1' }) }).decide(input), null, `${tool_name}/${Object.keys(args)[0]}`);
  }
});

test('inert-data model distinguishes literal arguments from actual command positions and wrappers', t => {
  const ctx = fixture(t), resolver = new ContinuationResolver({ environment: ctx.environment });
  assert.equal(matrix.inert_data_cases.length, 39);
  for (const row of matrix.inert_data_cases) {
    const { text } = row, input = shell(ctx, text), expected = expectedFor(row, input);
    assert.equal(resolver.resolve(text, input).status, expected, text);
    const decision = new gate.ToolGate({ registryOptions: ctx.options, environment: ctx.environment, stateReader: () => ({ state: 'DISABLED', rule: 'R1' }) }).decide(input);
    assert.equal(Boolean(decision?.deny), expected === 'UNKNOWN', text);
    if (expected === 'NOT_CONTINUATION') {
      const held = { state: 'UNDECIDED', rule: 'R4', repository_id: 'synthetic-held' };
      assert.ok(new gate.ToolGate({ registryOptions: ctx.options, stateReader: () => held }).decide(input)?.deny, `current-scope guard before inert/help: ${text}`);
      const inHeldWorkdir = { ...input, tool_input: { ...input.tool_input, workdir: ctx.other } };
      assert.ok(new gate.ToolGate({ registryOptions: ctx.options, stateReader: cwd => cwd === ctx.other ? held : { state: 'DISABLED', rule: 'R1' } }).decide(inHeldWorkdir)?.deny, `workdir guard before inert/help: ${text}`);
    }
  }
  assert.match(new gate.ToolGate({ registryOptions: ctx.options, stateReader: () => ({ state: 'DISABLED', rule: 'R1' }) }).decide(shell(ctx, 'echo "claude --resume fixture toolkit governance enable"'))?.deny || '', /only the user/, 'existing owner-answer guard remains before inert classification');
});

test('shell-family model refuses ambiguous data, help and native selector syntax on both envelopes', t => {
  const ctx = fixture(t);
  const spaced = path.join(ctx.target, 'space directory');
  fs.mkdirSync(spaced); transcript(ctx);
  new gate.HeldPrompts({ registryOptions: ctx.options }).add('synthetic-rootless', 'synthetic queued fixture', null, {}, null);
  const before = snapshot(ctx.dir);
  const resolver = new ContinuationResolver({ environment: ctx.environment });
  const supported = [undefined, 'cmd.exe', 'powershell.exe', 'pwsh.exe', 'bash', '/bin/sh', 'C:\\synthetic shell\\pwsh.exe'];
  const unknown = ['unknown-shell', '', null, ['cmd.exe']];
  assert.equal(matrix.shell_family_cases.length, 392);
  // Opaque runtime generation is outside this cooperative detector. No evaluation
  // or generic script interception is inferred from conservative static candidates.
  for (const text of [
    '& $runtime $argument', '& ([char[]](99,111,100,101,120) -join "") $argument',
    'PowerShell -Command "Write-Output $value"', 'bash -c "echo $value"',
    'powershell -Command "$n=1; Write-Output $n"', 'bash -c "printf %s fixture"',
    'git -c core.fsmonitor=false log --format=%H',
    'git -c color.ui=false log --format="%h %s"', 'rg -r "$replacement" pattern fixture.txt',
    'grep -c "$pattern" fixture.txt', 'findstr /r "$pattern" fixture.txt',
    'cat ~/.claude/settings.json | grep -n yes', 'codex login --with-api-key < key.txt; echo ok',
    'Write-Output ("fixture {0}" -f 1)', 'echo ("{0}" -f "fixture")',
    'Write-Output (-join ("fi","xture"))', 'Write-Output ([char[]](102,105,120) -join "")',
    'Write-Output ("x{0}" -f 1)', 'Write-Output ("{0}q" -f 1)',
    'Write-Output ("fi"+[string]"xture")', 'Write-Output ("fi".ToString()+"xture")',
    'Write-Output (-join ([string]"fi",[string]"xture"))',
  ]) for (const selected of [...supported, ...unknown]) {
    const input = shell(ctx, text);
    if (selected !== undefined) input.tool_input.shell = selected;
    assert.equal(resolver.resolve(text, input).status, 'NOT_CONTINUATION', text);
    assert.equal(new gate.ToolGate({ registryOptions: ctx.options, environment: ctx.environment, stateReader: () => ({ state: 'DISABLED', rule: 'R1' }) }).decide(input), null, text);
  }
  for (const row of matrix.shell_family_cases) for (const tool_name of ['Bash', 'PowerShell']) for (const selected of [...supported, ...unknown]) {
    const text = row.text.replaceAll('{TARGET}', spaced).replaceAll('{TRANSCRIPT}', ctx.file);
    const input = shell(ctx, text, { tool_name });
    if (selected !== undefined) input.tool_input.shell = selected;
    const expected = unknown.includes(selected) ? 'UNKNOWN' : expectedFor(row, input);
    assert.equal(resolver.resolve(text, input).status, expected, `${row.id}/${tool_name}/${selected}`);
    const decision = new gate.ToolGate({ registryOptions: ctx.options, environment: ctx.environment, stateReader: () => ({ state: 'DISABLED', rule: 'R1' }) }).decide(input);
    assert.equal(Boolean(decision?.deny), expected === 'UNKNOWN', `${row.id}/${tool_name}/${selected}`);
    if (expected !== 'UNKNOWN') {
      const held = { state: 'UNDECIDED', rule: 'R4', repository_id: 'synthetic-held' };
      assert.ok(new gate.ToolGate({ registryOptions: ctx.options, stateReader: () => held }).decide(input)?.deny, `${row.id}: current guard`);
      const workdir = { ...input, tool_input: { ...input.tool_input, workdir: ctx.other } };
      assert.ok(new gate.ToolGate({ registryOptions: ctx.options, environment: ctx.environment, stateReader: cwd => cwd === ctx.other ? held : { state: 'DISABLED', rule: 'R1' } }).decide(workdir)?.deny, `${row.id}: workdir guard`);
    }
  }
  for (const tool_name of ['Bash', 'PowerShell', 'Monitor', 'exec_command', 'shell', 'local_shell']) {
    for (const command of ['echo (codex resume)', "echo 'fixture & claude --continue & echo fixture'", 'co""dex resu""me', '& ("co"+"dex") resume', 'codex ("res"+"ume")']) {
      for (const args of [{ command }, { cmd: command }, { command: command.split(' ') }]) {
        const input = { tool_name, cwd: ctx.caller, tool_input: { ...args, shell: 'cmd.exe' } };
        assert.ok(new gate.ToolGate({ registryOptions: ctx.options, environment: ctx.environment, stateReader: () => ({ state: 'DISABLED', rule: 'R1' }) }).decide(input)?.deny, `${tool_name}: text aliases cannot hide evaluation`);
      }
    }
  }
  assert.deepEqual(snapshot(ctx.dir), before, 'classification and target proof do not mutate queue, metadata or registry');
});

test('visible embedded and hostile continuations remain unknown rather than falling out of classification', t => {
  const ctx = fixture(t), command = 'codex exec resume --last';
  const cases = hostile.cases(['line-breaks', 'continued-lines', 'quoting', 'indents', 'invisible', 'large-input'], ['shell', 'text']);
  hostile.expectDefaultDeny(assert, text => parse(text, shell(ctx, text)).status !== 'UNKNOWN', cases.map(shape => ({ ...shape, text: `${shape.text}\n${command}` })));
  for (const variant of hostile.variants(`echo fixture\n${command}`)) assert.equal(parse(variant.text, shell(ctx, variant.text)).status, 'UNKNOWN', variant.id);
  for (const text of [`sh -c '${command}'`, `claude --version && sh -c '${command}'`, `echo "${command}" && ${command}`, `git log --grep="${command}"; ${command}`, `echo "$(${command})"`, `echo fixture | ${command}`, `function f(){ ${command}; }`, `${command} > file`, `${command}; git status`, `${command} && ${command}`, `${command} # comment`, `cd - && ${command}`, `cd C:relative && ${command}`, `${command} ${'x'.repeat(LIMITS.command)}`, `codex --remote ws://example.test exec resume --last`, `claude --resume "${ctx.file}`, `claude --resume "$SESSION"`, `claude --resume "$(cat id)"`]) assert.equal(parse(text, shell(ctx, text)).status, 'UNKNOWN', text.slice(0, 100));
  for (const point of [0, 9, 13, 0x85, 0xa0, 0x200b, 0x2028, 0xfeff]) {
    const text = command.replace(' exec', String.fromCodePoint(point) + 'exec');
    assert.equal(parse(text, shell(ctx, text)).status, 'UNKNOWN', `codepoint ${point}`);
  }
  if (process.platform === 'win32') {
    const executable = 'C:\\synthetic host\\codex.cmd';
    assert.equal(parse(`& "${executable}" exec resume --last`, shell(ctx, '')).status, 'VERIFIED');
    transcript(ctx);
    const text = `Set-Location -LiteralPath "${ctx.target}"; & "C:\\synthetic host\\claude.exe" --resume "${ctx.file}"`;
    assert.equal(new ContinuationResolver({ environment: ctx.environment }).resolve(text, shell(ctx, text)).status, 'VERIFIED');
  }
});

test('resolver and target-reader failures, malformed verdicts and claimed target flags never grant authority', t => {
  const ctx = fixture(t);
  const stateReader = () => ({ state: 'DISABLED', rule: 'R1' });
  for (const continuationResolver of [{ resolve() { throw new Error('synthetic'); } }, { resolve() { return null; } }, { resolve() {} }, { resolve() { return { status: 'VERIFIED', targets: [] }; } }, { resolve() { return { status: 'VERIFIED', targets: ['relative'] }; } }]) {
    assert.ok(new gate.ToolGate({ registryOptions: ctx.options, stateReader, continuationResolver }).decide(shell(ctx, 'codex exec resume --last'))?.deny);
  }
  assert.ok(new gate.ToolGate({ registryOptions: ctx.options, stateReader: cwd => cwd === ctx.target ? {} : stateReader(), continuationResolver: { resolve: () => ({ status: 'VERIFIED', targets: [ctx.target] }) } }).decide(shell(ctx, 'codex exec resume --last'))?.deny);
  for (const spawn of [() => ({ status: 1 }), () => ({ status: 0, stdout: '{bad' }), () => ({ status: 0, stdout: '{}', stderr: 'synthetic error' }), () => { throw new Error('synthetic'); }]) {
    assert.equal(new ContinuationResolver({ environment: ctx.environment, spawn }).resolve(`claude -r "${ctx.file}"`, shell(ctx, '')).status, 'UNKNOWN');
  }
  const input = shell(ctx, `claude --resume ${ID}`);
  Object.assign(input.tool_input, { verified: true, target_repository: ctx.target });
  assert.equal(new ContinuationResolver({ environment: ctx.environment }).resolve(input.tool_input.command, input).status, 'UNKNOWN');
});

test('existing path guards anchor a relative shell workdir to hook cwd before resolving cd destinations', t => {
  const ctx = fixture(t), held = path.join(ctx.target, 'sub');
  assert.notEqual(process.cwd(), ctx.caller, 'the process cwd deliberately differs from the hook cwd');
  const visited = [];
  const stateReader = cwd => {
    visited.push(cwd);
    return cwd === held ? { state: 'UNDECIDED', rule: 'R4', repository_id: 'synthetic-held' } : { state: 'DISABLED', rule: 'R1' };
  };
  for (const field of ['workdir', 'cwd']) {
    const input = shell(ctx, 'cd sub && git status --short');
    input.tool_input[field] = '../target';
    const decision = new gate.ToolGate({ registryOptions: ctx.options, stateReader }).decide(input);
    assert.match(decision?.deny || '', /works in a repository that is waiting/);
    assert.ok(visited.includes(held));
  }
});
