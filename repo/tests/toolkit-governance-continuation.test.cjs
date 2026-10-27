'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { ContinuationResolver, TranscriptReader, LIMITS, parse } = require('../scripts/toolkit-governance-continuation.cjs');
const gate = require('../scripts/toolkit-governance-gate.cjs');
const hostile = require('./support/hostile-inputs.cjs');
const matrix = require('./support/governance-continuation-matrix.json');

// Selector receipts, inspected against the PATH host versions frozen by discovery:
// Claude 2.1.310: https://code.claude.com/docs/en/sessions (exact transcript path; internal JSONL).
// Codex 0.164.0: https://github.com/openai/codex/tree/rust-v0.164.0/codex-rs
// exec/src/lib.rs resolve_resume_thread_id compares latest_thread_cwd to config.cwd.
// tui/src/resume_picker.rs repository_cwd_filter expands interactive --last to worktrees.
// Consequently only exec/e resume --last is directory-proven here. UUIDs need authoritative
// native selection including state-db/revert/compression; no filename or session_index shortcut.
const ID = '11111111-1111-4111-8111-111111111111';
const MESSAGE_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ID = '33333333-3333-4333-8333-333333333333';
const root = path.resolve(__dirname, '../..');

function fixture(t) {
  // Windows app temp redirection may alias a newly created child even when the
  // temp parent itself resolves unchanged. Fixtures use native identity; the
  // separate junction/alias cases still prove that production refuses aliases.
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'continuation-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ctx = { dir, caller: path.join(dir, 'caller'), target: path.join(dir, 'target'), other: path.join(dir, 'other'), home: path.join(dir, 'home') };
  ctx.projects = path.join(ctx.home, '.claude', 'projects');
  ctx.file = path.join(ctx.projects, 'fixture project', `${ID}.jsonl`);
  for (const folder of [ctx.caller, ctx.target, ctx.other, path.join(ctx.target, 'sub'), path.dirname(ctx.file)]) fs.mkdirSync(folder, { recursive: true });
  ctx.options = { registryPath: path.join(ctx.home, '.ai-agent-toolkit', 'user-state', 'repository-governance.v1.json'), testOnly: true };
  ctx.environment = { USERPROFILE: ctx.home, HOME: ctx.home, CLAUDE_CONFIG_DIR: path.join(ctx.home, '.claude'), CODEX_HOME: path.join(ctx.home, '.codex') };
  return ctx;
}
function message(cwd, extra = {}) {
  return { type: 'user', sessionId: ID, cwd, uuid: MESSAGE_ID, timestamp: '2026-10-01T00:00:00.000Z', message: { role: 'user', content: 'synthetic fixture' }, ...extra };
}
function transcript(ctx, rows = [message(ctx.target)]) { fs.writeFileSync(ctx.file, rows.map(row => JSON.stringify(row)).join('\n') + '\n'); }
function shell(ctx, command, extra = {}) { return { tool_name: 'Bash', cwd: ctx.caller, session_id: 'fixture-run', tool_input: { command }, ...extra }; }
function snapshot(dir) {
  const result = {};
  function walk(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name), name = path.relative(dir, file);
      if (entry.isSymbolicLink()) result[name] = `link:${fs.readlinkSync(file)}`;
      else if (entry.isDirectory()) { result[name] = 'directory'; walk(file); }
      else result[name] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    }
  }
  walk(dir); return result;
}

test('literal reader roles and executable script operands follow the closed data boundary', t => {
  const ctx = fixture(t), before = snapshot(ctx.dir);
  const held = { state: 'UNDECIDED', rule: 'R4', repository_id: 'synthetic-held' };
  for (const row of matrix.literal_role_cases) {
    const input = shell(ctx, row.text);
    if (row.shell !== undefined) input.tool_input.shell = row.shell;
    assert.equal(parse(row.text, input).status, row.expected, row.id);
    for (const actor of matrix.actors) {
      const decide = stateReader => new gate.ToolGate({ registryOptions: ctx.options, environment: ctx.environment, stateReader }).decide({ ...input, actor });
      assert.equal(Boolean(decide(() => ({ state: 'DISABLED', rule: 'R1' }))?.deny), row.expected === 'UNKNOWN', row.id + '/' + actor);
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
  for (const { text, expected } of matrix.inert_data_cases) {
    const input = shell(ctx, text);
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
    const expected = unknown.includes(selected) ? 'UNKNOWN' : row.expected;
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

test('Windows/source-hook UAT: both native entrypoints cross both CLI families with isolated stdin and no state mutation', t => {
  const ctx = fixture(t);
  const env = { ...process.env, ...ctx.environment, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(ctx.home, 'absent-gitconfig') };
  for (const key of Object.keys(env)) if (/^(?:TOOLKIT_|CLAUDE_CODE_REMOTE|CLAUDE_ENV_FILE)/.test(key)) delete env[key];
  const git = (cwd, args) => {
    const result = spawnSync('git', ['-C', cwd, ...args], { env, encoding: 'utf8', windowsHide: true, timeout: 10000 });
    assert.equal(result.status, 0, `synthetic git ${args[0]}: ${result.stderr}`);
  };
  for (const [cwd, name] of [[ctx.caller, 'caller'], [ctx.target, 'target'], [ctx.other, 'held']]) {
    git(cwd, ['init', '--quiet']); git(cwd, ['remote', 'add', 'origin', `https://github.com/example-owner/${name}.git`]);
  }
  for (const cwd of [ctx.caller, ctx.target]) gate.writeGovernanceDecision(cwd, 'enable', { registryOptions: ctx.options });
  transcript(ctx);
  const stores = new gate.HeldPrompts({ registryOptions: ctx.options });
  stores.add('synthetic-unrelated', 'synthetic held fixture', null, {}, null);
  const heldFile = path.join(path.dirname(ctx.options.registryPath), gate.HELD_BASENAME);
  const hooks = [
    { name: 'claude', file: 'toolkit-governance-hook.cjs', args: ['--event', 'PreToolUse'], deniedExit: 0 },
    { name: 'codex', file: 'toolkit-codex-helper-hook.cjs', args: [], deniedExit: 2 },
  ];
  let sourceCalls = 0;
  function invoke(hook, input, denied, marker = {}) {
    sourceCalls += 1;
    const before = snapshot(ctx.dir);
    const result = spawnSync(process.execPath, [path.join(root, 'repo/scripts', hook.file), ...hook.args], {
      input: JSON.stringify(input), env: { ...env, ...marker }, cwd: ctx.caller, encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 256 * 1024,
    });
    assert.equal(result.status, denied ? hook.deniedExit : 0, `${hook.name}: ${result.stderr}`);
    const output = result.stdout.trim() ? JSON.parse(result.stdout) : {};
    if (result.stdout) assert.equal(result.stdout, JSON.stringify(output) + '\n', 'exact adapter JSON stdout');
    assert.equal(output.hookSpecificOutput?.permissionDecision === 'deny', denied, hook.name + ': ' + input.tool_input.command);
    if (!denied) {
      if (hook.name === 'codex') assert.equal(result.stdout, '', 'Codex admission is empty stdout');
      else assert.deepEqual(output, {}, 'Claude admission has no permission grant');
      assert.equal(result.stderr, '');
    }
    assert.equal(result.stderr, denied && hook.name === 'codex' ? output.hookSpecificOutput.permissionDecisionReason + '\n' : '', 'adapter stderr contract');
    assert.doesNotMatch(result.stdout + result.stderr, /synthetic held fixture|synthetic fixture/);
    assert.deepEqual(snapshot(ctx.dir), before, `${hook.name}: bytes and directory entries unchanged`);
  }
  const commands = [`claude --resume "${ctx.file}"`, `codex -C "${ctx.target}" exec resume --last`];
  for (const hook of hooks) {
    for (const { text, expected } of matrix.inert_data_cases) invoke(hook, shell(ctx, text), expected === 'UNKNOWN');
    for (const row of matrix.literal_role_cases.filter(row => ['original-read', 'powershell.exe/pattern', 'get-content', 'findstr', 'pre', 'hostname', 'wrapper/runtime/read', 'wrapper/runtime/location', 'wrapper/runtime/assignment', 'wrapper/runtime/concat', 'wrapper/runtime/method', 'wrapper/cmd', 'cmd-single-control'].includes(row.id))) {
      for (const tool_name of ['Bash', 'PowerShell']) invoke(hook, { ...shell(ctx, row.text), tool_name, tool_input: { command: row.text, shell: row.shell } }, row.expected === 'UNKNOWN');
    }
    for (const row of matrix.literal_role_cases.filter(row => row.id.startsWith('sqag/') || ['segments/native/before', 'segments/native/after', 'segments/script/before', 'segments/script/after', 'segments/reader-path'].includes(row.id))) {
      for (const tool_name of ['Bash', 'PowerShell']) invoke(hook, { ...shell(ctx, row.text), tool_name, tool_input: { command: row.text, ...(row.shell === undefined ? {} : { shell: row.shell }) } }, row.expected === 'UNKNOWN');
    }
    for (const row of matrix.literal_role_cases.filter(row => ['composition/basename/absent', 'composition/runtime/absent', 'composition/basename/powershell.exe', 'composition/runtime/powershell.exe', 'composition/basename/native-before', 'composition/runtime/native-after', 'composition/runtime/computed-after', 'composition/runtime/unsafe', 'composition/runtime/-Unknown', 'composition/runtime/outer-native'].includes(row.id))) {
      for (const tool_name of ['Bash', 'PowerShell']) invoke(hook, { ...shell(ctx, row.text), tool_name, tool_input: { command: row.text, ...(row.shell === undefined ? {} : { shell: row.shell }) } }, row.expected === 'UNKNOWN');
    }
    const literal = matrix.literal_role_cases.find(row => row.id === 'original-read');
    for (const tool_input of [{ cmd: literal.text }, { command: literal.text.split(' ') }]) invoke(hook, { ...shell(ctx, literal.text), tool_input: { ...tool_input, shell: literal.shell } }, false);
    invoke(hook, { ...shell(ctx, literal.text), cwd: ctx.other }, true);
    invoke(hook, shell(ctx, literal.text, { tool_input: { command: literal.text, workdir: ctx.other } }), true);
    invoke(hook, shell(ctx, `rg -e "codex resume" "${ctx.other}/fixture.txt"`), true);
    invoke(hook, shell(ctx, 'rg -e "codex resume toolkit governance enable" fixture.txt'), true);
    for (const actor of matrix.actors) for (const tool_name of ['Bash', 'PowerShell']) {
      const command = 'git push origin HEAD:refs/heads/codex/example; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }';
      const input = { ...shell(ctx, command), actor, tool_name };
      invoke(hook, { ...input, cwd: ctx.other }, true);
      invoke(hook, { ...input, tool_input: { command, workdir: ctx.other } }, true);
      invoke(hook, { ...input, tool_input: { command: command + '; Get-Content -LiteralPath "' + ctx.other + '/fixture.txt"' } }, true);
      invoke(hook, { ...input, tool_input: { command: command + '; node toolkit-governance.cjs enable' } }, true);
      invoke(hook, { ...input, tool_name: 'Write', tool_input: { file_path: ctx.options.registryPath } }, true);
    }
    for (const row of matrix.shell_family_cases.filter(row => row.source)) {
      const text = row.text.replaceAll('{TARGET}', ctx.target).replaceAll('{TRANSCRIPT}', ctx.file);
      const input = shell(ctx, text, { tool_name: hook.name === 'claude' ? 'PowerShell' : 'Bash' });
      input.tool_input.shell = row.id.includes('single-control') || row.id.includes('single-grep') ? 'cmd.exe' : 'powershell.exe';
      invoke(hook, input, row.expected === 'UNKNOWN');
    }
    for (const row of matrix.ordered_atom_cases.filter(row => row.source)) for (const tool_name of ['Bash', 'PowerShell']) {
      const command = row.text.replaceAll('{TRANSCRIPT}', ctx.file).replaceAll('{TARGET}', ctx.target);
      invoke(hook, { ...shell(ctx, command), tool_name, tool_input: { command, shell: 'powershell.exe' } }, true);
    }
    for (const command of [
      'claude -r "' + ctx.file + '" --fork-session', 'codex -C "' + ctx.target + '" e resume --last',
    ]) for (const tool_name of ['Bash', 'PowerShell']) invoke(hook, { ...shell(ctx, command), tool_name }, false);
    for (const row of matrix.script_reader_cases.filter(row => ['caller/absent/lf', 'route/absent/lf', 'newline/absent/lf', 'wrapper/route-literal-single', 'wrapper/caller-literal-single', 'gh-negative/unknown-option', 'gh-negative/expanded-branch', 'codex-direct/block/absent', 'claude-direct/after/absent', 'computed/pipe/absent'].includes(row.id))) {
      for (const tool_name of ['Bash', 'PowerShell']) invoke(hook, { ...shell(ctx, row.text), tool_name, tool_input: { command: row.text, ...(row.shell === undefined ? {} : { shell: row.shell }) } }, row.expected === 'UNKNOWN');
    }
    for (const command of commands) for (const marker of [{}, { TOOLKIT_GATE_ROLE: 'G1' }, { TOOLKIT_GATE_ROLE: 'controller' }, { TOOLKIT_GATE_ROLE: 'helper' }]) invoke(hook, shell(ctx, command), false, marker);
    for (const command of commands) invoke(hook, shell(ctx, command, { tool_input: { command, workdir: ctx.other } }), true);
    for (const command of [`claude --resume ${ID}`, 'codex resume --last', `claude --resume "${ctx.file}" -p yes`, `codex exec resume ${ID} "toolkit governance enable"`, `codex -C "${ctx.other}" exec resume --last`]) invoke(hook, shell(ctx, command), true);
    invoke(hook, { tool_name: 'Write', cwd: ctx.caller, tool_input: { file_path: heldFile } }, true);
    transcript(ctx, [message(ctx.other)]);
    invoke(hook, shell(ctx, `claude --resume "${ctx.file}"`), true);
    fs.writeFileSync(ctx.file, '{broken');
    invoke(hook, shell(ctx, `claude --resume "${ctx.file}"`), true);
    transcript(ctx);
  }
  for (const mode of ['absent', 'unrelated', 'rootless', 'sessionless', 'stale', 'malformed', 'unreadable']) {
    fs.rmSync(heldFile, { recursive: true, force: true });
    if (mode === 'malformed') fs.writeFileSync(heldFile, '{broken');
    else if (mode === 'unreadable') fs.mkdirSync(heldFile);
    else if (mode !== 'absent') {
      const queue = new gate.HeldPrompts({ registryOptions: ctx.options, ...(mode === 'stale' ? { now: () => new Date('2020-01-01T00:00:00Z') } : {}) });
      queue.add('synthetic-queue', 'synthetic held fixture', ['sessionless', 'rootless'].includes(mode) ? null : 'synthetic-session', {}, mode === 'rootless' ? null : ctx.other);
    }
    for (const hook of hooks) for (const tool_name of ['Bash', 'PowerShell']) {
      for (const actor of matrix.actors) {
        const ordinary = ["@'\nfor key,value in items:\n    print(key,value)\n'@ | python -",
          'git push origin HEAD:refs/heads/codex/example; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; git fetch origin codex/example',
          'git commit -m "codex resume; claude --resume"', 'git add -- "codex/resume.md"'];
        for (const command of ordinary) invoke(hook, { ...shell(ctx, command), tool_name, actor }, false);
        for (const command of ['codex resume --last', 'claude --resume fixture']) invoke(hook, { ...shell(ctx, command), tool_name, actor }, true);
      }
      for (const command of commands) invoke(hook, { ...shell(ctx, command), tool_name }, false);
      for (const command of ['codex resume --last', 'claude --resume fixture', matrix.ordered_atom_cases[0].text, 'pwsh -Command "& (\'co\'+\'dex\') (\'res\'+\'ume\')"']) invoke(hook, { ...shell(ctx, command), tool_name }, true);
      invoke(hook, { ...shell(ctx, 'rg -e "codex resume" repo\\notes.txt'), tool_name }, false);
      invoke(hook, { ...shell(ctx, matrix.literal_role_cases.find(row => row.id === 'sqag/compound/absent').text), tool_name }, false);
      invoke(hook, { ...shell(ctx, matrix.literal_role_cases.find(row => row.id === 'composition/runtime/absent').text), tool_name }, false);
      for (const row of matrix.script_reader_cases.filter(row => ['caller/absent/lf', 'route/absent/lf', 'newline/absent/lf', 'wrapper/caller-literal-single', 'codex-direct/block/absent', 'claude-direct/after/absent'].includes(row.id))) {
        invoke(hook, { ...shell(ctx, row.text), tool_name, tool_input: { command: row.text, ...(row.shell === undefined ? {} : { shell: row.shell }) } }, row.expected === 'UNKNOWN');
      }
    }
  }
  t.diagnostic(JSON.stringify({ sourceCalls, productionDefault: true, byteAndDirectoryEquality: true, nativeDispatchExercised: false }));
  // Only the two source processes were executed. No host CLI continuation, native dispatcher,
  // installed hook, service, installation, owner acceptance or desktop-binary qualification.
});


// Exercise the private pure projection without adding a product export or entrypoint.
function evidenceProjection() {
  const Module = require('node:module');
  const filename = path.join(root, 'repo/scripts/toolkit-governance-continuation.cjs');
  const loaded = new Module(filename, module);
  loaded.filename = filename; loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  let source = fs.readFileSync(filename, 'utf8');
  source = source.replace('for (const step of pattern.steps) {', 'for (const step of pattern.steps) { evidenceOperations += 1;');
  const start = source.indexOf('function roleWords('), end = source.indexOf('\nfunction literalWord(', start);
  const lexer = source.slice(start, end).replace('for (let i = 0; i < text.length;) {', 'for (let i = 0; i < text.length;) { roleVisits += 1;')
    .replace('value += text[i++];', 'roleVisits += 1; value += text[i++];')
    .replace('while (i < text.length && text[i] !== quote) i += 1;', 'while (i < text.length && text[i] !== quote) { roleVisits += 1; i += 1; }');
  source = source.slice(0, start) + lexer + source.slice(end);
  loaded._compile(source + '\nlet evidenceOperations = 0, roleVisits = 0; module.exports = { CANDIDATE_MACHINES, atomPattern, advancePrefixes, quoteAtoms, orderedEvidence, commandRoles, roleWords, roleVisits: () => roleVisits, operations: () => evidenceOperations };', filename);
  return loaded.exports;
}

test('complete data proofs retain consumed spans and unknown wrappers retain raw executable evidence', t => {
  const { commandRoles, roleWords, roleVisits } = evidenceProjection();
  for (const row of matrix.literal_role_cases) {
    const input = { tool_input: { ...(row.shell === undefined ? {} : { shell: row.shell }) } };
    const result = commandRoles(row.text, input);
    assert.equal(Boolean(result.data), row.proof, row.id);
    if (result.data) {
      assert.equal(result.data.consumed, row.text.trimEnd().length, row.id);
      for (const word of result.data.roles) {
        assert.ok(word.end > word.start && word.start >= 0 && word.end <= row.text.length);
        assert.ok(row.text.slice(word.start, word.end).includes(word.quote || word.value));
      }
      for (const word of result.data.inner?.roles || result.data.roles) assert.ok(word.role, row.id + ': every word has a role');
    }
    if (row.mask) {
      assert.ok(result.segments?.proofs.length, row.id + ': complete reader segment proof');
      assert.equal(result.candidate.length, row.text.length);
      const dataSpans = result.segments.proofs.flatMap(proof => proof.roles.filter(word => word.role.startsWith('literal ') || word.role === 'attached literal pattern' || (word.role === 'reader executable' && /[\\/]/.test(word.value))));
      if (result.excludedExecutable) dataSpans.push(result.excludedExecutable);
      for (let i = 0; i < row.text.length; i += 1) {
        if (result.candidate[i] !== row.text[i]) {
          assert.equal(result.candidate[i], ' ');
          assert.ok(dataSpans.some(span => i >= span.start && i < span.end), 'only proved data/executable spans excluded');
        }
      }
      for (const segment of result.segments.unproved) assert.ok(result.candidate.includes(segment), 'all unproved source retained');
    }
    if (row.noMask) assert.equal(result.candidate, row.text, row.id + ': unsupported list has no mask');
    if (['wrapper/unknown-flag', 'wrapper/encoded', 'wrapper/file', 'wrapper/config'].includes(row.id)) assert.equal(result.candidate, row.text, row.id + ': no path masking');
    if (row.id.startsWith('wrapper/runtime/')) {
      const span = roleWords(row.text)[1];
      assert.equal(result.candidate.length, row.text.length);
      assert.equal(result.candidate.slice(span.start, span.end), ' '.repeat(span.end - span.start));
      assert.equal(result.candidate.slice(span.end), row.text.slice(span.end), 'all options and script bytes retained');
    }
  }
  const shells = [undefined, 'cmd.exe', 'powershell.exe', 'bash', 'C:/example.test/codex-runtimes/pwsh.exe'];
  let count = 0;
  for (const selected of shells) for (const native of ['codex', 'claude', 'resume', 'fork']) {
    for (const file of [`repo/${native}/notes.txt`, `repo\\${native}\\notes.txt`, `C:/example.test/${native}/notes.txt`, `C:\\example.test\\${native}\\notes.txt`, `//server.example.test/share/${native}/notes.txt`]) {
      for (const quote of ['', '"']) for (const prefix of ['rg -n -e "codex resume"', 'rg --regexp=claude --regexp=resume --']) {
        const text = prefix + ' ' + quote + file + quote;
        const input = { tool_input: { ...(selected === undefined ? {} : { shell: selected }) } };
        assert.ok(commandRoles(text, input).data, text);
        assert.equal(parse(text, input).status, 'NOT_CONTINUATION', text); count += 1;
      }
    }
  }
  for (const ending of ['\\', '\\"', '\\ ', '\\&', '\\$', '\\`']) {
    const text = 'rg -e "codex resume" repo' + ending;
    assert.equal(commandRoles(text, { tool_input: {} }).data, null, 'ambiguous escape has no proof');
  }
  for (const flag of ['--pre', '--hostname-bin', '--unknown', '-ni', '-ecodex']) {
    assert.equal(commandRoles('rg ' + flag + ' "codex resume" fixture.txt', { tool_input: {} }).data, null);
  }
  for (const name of ['-n', '--line-number', '-i', '--ignore-case', '-F', '--fixed-strings', '-l', '--files-with-matches', '--hidden', '--no-ignore', '--no-config', '--help']) {
    assert.ok(commandRoles('rg ' + name + ' -e "codex resume" fixture.txt', { tool_input: {} }).data, name);
  }
  for (const text of ['rg -e "codex resume" ' + 'x'.repeat(LIMITS.command), 'pwsh -Command "' + 'x'.repeat(LIMITS.command) + '"']) {
    assert.equal(commandRoles(text, { tool_input: {} }).data, null, 'no over-limit proof or truncation');
  }
  for (const prefix of ['rg -e "codex resume" ', 'rg -e "', 'pwsh -Command "', 'rg ']) {
    const text = (prefix + 'x'.repeat(LIMITS.command)).slice(0, LIMITS.command - 1) + (prefix.endsWith('"') ? '"' : 'x');
    const before = roleVisits(); commandRoles(text, { tool_input: {} });
    assert.ok(roleVisits() - before <= 4 * text.length, 'bounded single-layer lexical acquisition');
  }
  const wrapperPrefix = 'pwsh -Command "git status; rg -e codex ';
  const composed = wrapperPrefix + 'x'.repeat(LIMITS.command - wrapperPrefix.length - 1) + '"';
  const beforeComposed = roleVisits(), composedRoles = commandRoles(composed, { tool_input: {} });
  assert.ok(composedRoles.segments?.proofs.length);
  assert.equal(composedRoles.candidate.length, composed.length);
  assert.ok(roleVisits() - beforeComposed <= 4 * composed.length, 'bounded composed lexical acquisition');
  assert.equal(parse(composed, { tool_input: {} }).status, 'NOT_CONTINUATION');
  for (const { word } of evidenceProjection().CANDIDATE_MACHINES) for (let cut = 1; cut < word.length; cut += 1) {
    for (const body of [`& ('${word.slice(0, cut)}'.ToString()+'${word.slice(cut)}')`, `& (' ${word.slice(0, cut)}'.Trim()+'${word.slice(cut)}')`, `& ('${word.slice(0, cut)}{0}' -f '${word.slice(cut)}')`]) {
      for (const prefix of ['pwsh', '"C:/example.test/codex-runtimes/pwsh.exe"']) {
        const text = prefix + ' -Command "' + body + '"';
        assert.equal(parse(text, { tool_input: {} }).status, 'UNKNOWN', 'quoted script role retains every fixed spelling split');
      }
    }
  }
  t.diagnostic(JSON.stringify({ pathRoleProperties: count, wrapperLayers: 1, nativeAdmissionGrammarChanged: false }));
});

test('ordered evidence retains every partition and arbitrary prefix state under inserted atoms', t => {
  const { CANDIDATE_MACHINES, atomPattern, advancePrefixes } = evidenceProjection();
  assert.equal(CANDIDATE_MACHINES.length, 18);
  assert.ok(Object.isFrozen(CANDIDATE_MACHINES));
  const noise = ['z', 'noise', 'co', 're', '--last', '', ' q '].map(atomPattern);
  let partitions = 0, insertions = 0, whitespace = 0, arbitrary = 0;
  for (const machine of CANDIDATE_MACHINES) {
    assert.ok(Object.isFrozen(machine)); assert.ok(Object.isFrozen(machine.characters));
    const word = machine.word;
    for (let cuts = 0; cuts < 2 ** (word.length - 1); cuts += 1) {
      const pieces = []; let last = 0;
      for (let p = 1; p < word.length; p += 1) if (cuts & (1 << (p - 1))) { pieces.push(word.slice(last, p)); last = p; }
      pieces.push(word.slice(last));
      const patterns = pieces.map(atomPattern); let states = 1;
      for (let slot = 0; slot <= patterns.length; slot += 1) {
        for (const atom of noise) {
          const withNoise = advancePrefixes(machine, states, atom);
          assert.equal(withNoise & states, states);
          let final = withNoise;
          for (let p = slot; p < patterns.length; p += 1) final = advancePrefixes(machine, final, patterns[p]);
          assert.ok(final & machine.end); insertions += 1;
        }
        if (slot < patterns.length) states = advancePrefixes(machine, states, patterns[slot]);
      }
      assert.ok(states & machine.end); partitions += 1;
      for (const edge of [' ', '  ', '\t', '\r\n']) {
        let padded = 1;
        for (const piece of pieces) padded = advancePrefixes(machine, padded, atomPattern(edge + piece + edge));
        assert.ok(padded & machine.end); whitespace += 1;
      }
    }
    for (let states = 1; states <= machine.full; states += 2) for (const atom of noise) {
      assert.equal(advancePrefixes(machine, states, atom) & states, states); arbitrary += 1;
    }
  }
  assert.equal(partitions, 63448); assert.equal(insertions, 3874724); assert.equal(whitespace, 253792);
  assert.equal(arbitrary, CANDIDATE_MACHINES.reduce((sum, machine) => sum + machine.end * noise.length, 0));
  t.diagnostic(JSON.stringify({ partitions, insertions, whitespace, arbitrary }));
});

test('whole atoms, fixed-letter holes and overlapping quote extraction keep finite boundaries', () => {
  const api = evidenceProjection();
  const { CANDIDATE_MACHINES, atomPattern, advancePrefixes, quoteAtoms, orderedEvidence } = api;
  for (const machine of CANDIDATE_MACHINES) {
    const word = machine.word;
    for (let hole = 0; hole <= word.length; hole += 1) {
      for (const template of [word.slice(0, hole) + '{0}' + word.slice(hole), word.slice(0, hole) + '{0}{1,2:x}' + word.slice(hole)]) {
        assert.ok(advancePrefixes(machine, 1, atomPattern(template)) & machine.end);
      }
    }
    for (let split = 1; split < word.length; split += 1) for (const quote of ['"', "'"]) for (const edge of ['', ' ', '\t', '\r\n']) {
      const left = quote + edge + word.slice(0, split).toUpperCase() + edge + quote;
      const right = quote + edge + word.slice(split) + edge + quote;
      for (const body of [left + '+' + right, '[string]' + left + '+' + right, left + '+[System.String]' + right,
        left + '.ToString()+' + right, left + '.Replace(' + quote + 'z' + quote + ',' + quote + quote + ')+' + right,
        left + '.Replace(' + quote + 'noise' + quote + ',' + quote + 'co' + quote + ')+' + right,
        '[string]::Concat(' + left + ',' + right + ')', '-join (' + left + ',' + right + ')']) {
        for (const outer of ['', '"', "'"]) {
          const text = 'powershell -Command (' + outer + '(' + body + ')' + outer + ')';
          assert.equal(orderedEvidence(text), true, text);
          assert.equal(parse(text, { cwd: root, tool_input: {} }).status, 'UNKNOWN', text);
        }
      }
    }
  }
  for (const atoms of [['cxdex'], ['rcsume'], ['scooter'], ['rescue'], ['co noise','dex'], ['{0}'], ['fixture {0}'], ['x{0}'], ['{0}q'], ['fixture','world'], ['c','q','d','e','x'], ['-c'], ['-r'], ['{0}','dex']]) {
    assert.equal(orderedEvidence(atoms.map(atom => '"' + atom + '"').join('+')), false, JSON.stringify(atoms));
  }
  assert.equal(orderedEvidence('("c{0}d" -f "o" + "ex")'), true);
  assert.equal(orderedEvidence('("r{0}s" -f "e" + "ume")'), true);
  assert.equal(orderedEvidence('"co"+"dex"'), true);
  assert.equal(orderedEvidence('"fixture"'), false, 'fresh per-call prefix states');
  for (const text of ['"q".'.repeat(8192), '"' + 'q'.repeat(32766) + '"', '"' + '{0}'.repeat(10920) + '"', "'\"".repeat(16384), '"co"+' + '"z"+'.repeat(8192) + '"dex"', '"' + '{' + '1'.repeat(32768), '"' + ' \t'.repeat(8192) + 'q"']) {
    const spans = quoteAtoms(text);
    assert.ok(spans.length <= text.length);
    assert.ok(spans.reduce((n, raw) => n + raw.length, 0) <= 2 * text.length);
    const before = api.operations(); orderedEvidence(text);
    assert.ok(api.operations() - before <= spans.length * 18 * 31);
    for (const raw of spans) {
      const pattern = atomPattern(raw);
      if (pattern) { assert.ok(pattern.literals <= 15); assert.ok(pattern.steps.length <= 31); }
    }
  }
  assert.equal(parse('& ("co"+"dex") ' + 'x'.repeat(LIMITS.command), { tool_input: {} }).status, 'UNKNOWN');
  assert.equal(parse('echo ' + 'x'.repeat(LIMITS.command), { tool_input: {} }).status, 'NOT_CONTINUATION');
});

test('ordered-atom closure table is UNKNOWN before target proof across placements, metadata and aliases', t => {
  const ctx = fixture(t), before = snapshot(ctx.dir);
  const shells = [undefined, 'cmd.exe', 'powershell.exe', 'pwsh.exe', 'bash', '/bin/sh', 'C:\\synthetic shell\\pwsh.exe', 'unknown-shell', '', null, ['cmd.exe']];
  for (const row of matrix.ordered_atom_cases) for (const tool_name of ['Bash', 'PowerShell']) for (const selected of shells) {
    const text = row.text.replaceAll('{TRANSCRIPT}', ctx.file).replaceAll('{TARGET}', ctx.target);
    const input = shell(ctx, text, { tool_name });
    if (selected !== undefined) input.tool_input.shell = selected;
    assert.equal(parse(text, input).status, row.expected, row.id + '/' + selected);
    const reader = new ContinuationResolver({ environment: ctx.environment, spawn() { assert.fail('computed evidence cannot acquire target metadata'); } });
    assert.equal(reader.resolve(text, input).status, row.expected, row.id);
    for (const args of [{ command: text }, { cmd: text }, { command: text.split(' ') }]) {
      const decision = new gate.ToolGate({ registryOptions: ctx.options, environment: ctx.environment, stateReader: () => ({ state: 'DISABLED', rule: 'R1' }) }).decide({ ...input, tool_input: { ...args, ...(selected === undefined ? {} : { shell: selected }) } });
      assert.equal(Boolean(decision?.deny), row.expected === 'UNKNOWN', row.id + '/alias');
    }
  }
  // A queue read trap proves the dependency boundary, independently of native source proof.
  const stateReader = () => ({ state: 'DISABLED', rule: 'R1' });
  const originalRead = fs.readFileSync; let queueReads = 0;
  const heldFile = path.join(path.dirname(ctx.options.registryPath), gate.HELD_BASENAME);
  fs.readFileSync = (file, ...args) => { if (file === heldFile) queueReads += 1; return originalRead(file, ...args); };
  try {
    assert.equal(new gate.ToolGate({ registryOptions: ctx.options, stateReader }).decide(shell(ctx, 'codex exec resume --last')), null);
    assert.ok(new gate.ToolGate({ registryOptions: ctx.options, stateReader }).decide(shell(ctx, matrix.ordered_atom_cases[0].text))?.deny);
    for (const id of ['original-read', 'sqag/single/absent', 'sqag/compound/absent', 'wrapper/runtime/assignment', 'wrapper/runtime/concat', 'composition/runtime/absent', 'composition/runtime/native-after', 'composition/runtime/computed-after']) {
      const row = matrix.literal_role_cases.find(row => row.id === id);
      assert.equal(Boolean(new gate.ToolGate({ registryOptions: ctx.options, stateReader }).decide({ ...shell(ctx, row.text), tool_input: { command: row.text, ...(row.shell === undefined ? {} : { shell: row.shell }) } })?.deny), row.expected === 'UNKNOWN', id);
    }
  } finally { fs.readFileSync = originalRead; }
  assert.equal(queueReads, 0, 'no held-queue read on verified or computed paths');
  assert.deepEqual(snapshot(ctx.dir), before);
});


test('multiline pipeline reader model keeps literal data separate from all executable source', t => {
  const ctx = fixture(t), api = evidenceProjection(), before = snapshot(ctx.dir);
  const heldFile = path.join(path.dirname(ctx.options.registryPath), gate.HELD_BASENAME);
  const originalRead = fs.readFileSync; let queueReads = 0;
  fs.readFileSync = (file, ...args) => { if (file === heldFile) queueReads += 1; return originalRead(file, ...args); };
  t.after(() => { fs.readFileSync = originalRead; });
  const held = { state: 'UNDECIDED', rule: 'R4', repository_id: 'synthetic-held' };
  let positive = 0;
  for (const row of matrix.script_reader_cases) {
    const input = shell(ctx, row.text);
    if (Object.hasOwn(row, 'shell')) input.tool_input.shell = row.shell;
    assert.equal(parse(row.text, input).status, row.expected, row.id);
    const roles = api.commandRoles(row.text, input);
    if (roles.segments) {
      assert.equal(roles.candidate.length, row.text.length, row.id);
      const spans = roles.segments.proofs.flatMap(proof => proof.roles.filter(word => word.role.startsWith('literal ')
        || word.role === 'attached literal pattern' || (word.role === 'reader executable' && /[\\/]/.test(word.value))));
      if (roles.excludedExecutable) spans.push(roles.excludedExecutable);
      for (let i = 0; i < row.text.length; i += 1) if (roles.candidate[i] !== row.text[i]) {
        assert.equal(roles.candidate[i], ' ', row.id + ': equal-length mask');
        assert.ok(spans.some(span => i >= span.start && i < span.end), row.id + ': only consumed roles masked');
      }
      for (const separator of roles.segments.separators || []) {
        assert.equal(roles.candidate.slice(separator.start, separator.end), row.text.slice(separator.start, separator.end), row.id + ': exact separator offsets');
      }
      for (const proof of roles.segments.proofs) for (const word of proof.roles) {
        assert.ok(word.start >= proof.start && word.end <= proof.end && word.end > word.start, row.id + ': exact source extent');
        assert.ok(row.text.slice(word.start, word.end).includes(word.quote || word.value), row.id + ': original word bytes');
      }
      for (const text of roles.segments.unproved) assert.ok(roles.candidate.includes(text), row.id + ': unproved code retained');
    }
    if (['unknown-option', 'trailing-pipe', 'empty-semi', 'bare-cr', 'comment', 'here-string', 'doubled-quote'].includes(row.id)
      || row.id.startsWith('bad-shell/')) assert.equal(roles.candidate, row.text, row.id + ': no unsupported projection');
    for (const actor of matrix.actors) {
      const decide = stateReader => new gate.ToolGate({ registryOptions: ctx.options, environment: ctx.environment, stateReader }).decide({ ...input, actor });
      assert.equal(Boolean(decide(() => ({ state: 'DISABLED', rule: 'R1' }))?.deny), row.expected === 'UNKNOWN', row.id + '/' + actor);
      if (row.expected !== 'NOT_CONTINUATION') continue;
      positive += 1;
      const ordinary = new gate.ToolGate({ registryOptions: ctx.options, environment: ctx.environment, stateReader: () => ({ state: 'DISABLED', rule: 'R1' }) });
      assert.match(ordinary.decide({ ...input, actor, tool_input: { ...input.tool_input, command: row.text + '\nnode toolkit-governance.cjs enable' } })?.deny || '', /only the user/, row.id + ': raw owner-answer guard');
      assert.match(ordinary.decide({ ...input, actor, tool_name: 'Write', tool_input: { command: row.text, file_path: ctx.options.registryPath } })?.deny || '', /user-state files/, row.id + ': user-state edit guard');
      const reached = new gate.ToolGate({ registryOptions: ctx.options, stateReader: cwd => cwd === ctx.other || cwd.startsWith(ctx.other + path.sep) ? held : { state: 'DISABLED', rule: 'R1' } });
      assert.ok(reached.decide({ ...input, actor, tool_input: { ...input.tool_input, command: row.text + '\nGet-Content -LiteralPath "' + ctx.other + '/fixture.txt"' } })?.deny, row.id + ': raw known absolute-path guard');
      assert.ok(decide(() => held)?.deny, row.id + ': current guard');
      assert.ok(decide(() => ({ state: 'UNDECIDED', rule: 'ERROR', error_code: 'SYNTHETIC' }))?.deny, row.id + ': unreadable current guard');
      assert.ok(new gate.ToolGate({ registryOptions: ctx.options, stateReader: cwd => cwd === ctx.other ? held : { state: 'DISABLED', rule: 'R1' } })
        .decide({ ...input, actor, tool_input: { ...input.tool_input, workdir: ctx.other } })?.deny, row.id + ': workdir guard');
    }
  }
  const legacy = matrix.literal_role_cases.find(row => row.id === 'segments/pipeline');
  assert.equal(legacy.baseline_expected, 'UNKNOWN'); assert.ok(legacy.allowance);
  for (const text of [
    'Get-Content -Unknown "codex resume" | git status',
    'Get-Content -LiteralPath "$codex/resume" | git status',
    legacy.text + '; codex resume --last', legacy.text + '; claude --continue',
  ]) assert.equal(parse(text, { tool_input: { shell: 'powershell.exe' } }).status, 'UNKNOWN', 'historical pipeline unsafe siblings');
  assert.equal(queueReads, 0, 'role proof and all actor decisions never read the held queue');
  fs.readFileSync = originalRead;
  assert.deepEqual(snapshot(ctx.dir), before);
  t.diagnostic(JSON.stringify({ modelRows: matrix.script_reader_cases.length, positiveActorChecks: positive, zeroQueueReads: true }));
});


test('acquisition schema and structural reader resources stay within the closed lexical subset', () => {
  const api = evidenceProjection(), input = { tool_input: { shell: 'powershell.exe' } };
  const branch = 'gh run list --branch codex/resume';
  const fields = ['attempt', 'conclusion', 'createdAt', 'databaseId', 'displayTitle', 'event', 'headBranch', 'headSha',
    'name', 'number', 'startedAt', 'status', 'updatedAt', 'url', 'workflowDatabaseId', 'workflowName'];
  for (const tail of ['', ' --repo example-org/example-repo', ' --repo github.example.test/example-org/example-repo',
    ' --commit ' + 'a'.repeat(40), ' --limit 8', ...fields.map(field => ' --json ' + field), ' --json ' + fields.join(',')]) {
    const text = branch + tail;
    assert.equal(parse(text, input).status, 'NOT_CONTINUATION', tail);
    const proof = api.commandRoles(text, input).segments.proofs[0];
    assert.equal(proof.consumed, text.length);
    assert.equal(proof.schema, 'gh run list literal filters');
  }
  for (const tail of [' --unknown value', ' -R example-org/example-repo', ' --repo=example-org/example-repo',
    ' --repo', ' --limit', ' --json', ' --commit bad', ' --commit ' + 'a'.repeat(39), ' --limit 1+1',
    ' --json status,', ' --json ,status', ' --json status,,headSha', ' --json Status', ' --json codex,resume',
    ' --jq .status', ' --template "codex resume"', ' --branch other', ' --repo example-org', ' --repo github.example.test/example-org/example-repo/extra',
    ...['--repo example-org/example-repo', '--commit ' + 'a'.repeat(40), '--limit 8', '--json status'].map(option => ' ' + option + ' ' + option)]) {
    const text = branch + tail;
    assert.equal(parse(text, input).status, 'UNKNOWN', tail);
    assert.equal(api.commandRoles(text, input).candidate, text, 'whole malformed acquisition stage is retained');
  }
  for (const text of ['gh run list --branch --codex', 'gh run list --branch -codex/resume',
    'gh run list --branch=codex/example-branch', 'gh run list -b codex/example-branch',
    'gh run watch --branch codex/example-branch', 'gh workflow list --branch codex/example-branch',
    'gh "run" list --branch codex/example-branch', 'gh run "list" --branch codex/example-branch']) {
    assert.equal(api.commandRoles(text, input).candidate, text, 'no alias, option-like value or alternate command proof');
  }
  for (const text of ['rg --regexp="codex resume" fixture.txt | ConvertFrom-Json', 'findstr /c:"codex resume" fixture.txt | ConvertFrom-Json']) {
    const roles = api.commandRoles(text, input);
    assert.equal(parse(text, input).status, 'NOT_CONTINUATION');
    assert.ok(roles.candidate.includes(text.startsWith('rg') ? '--regexp=' : '/c:'), 'attached option prefix retained');
  }
  const reader = 'Get-Content -LiteralPath C:/example.test/.codex/notes.md';
  for (const shape of hostile.cases(['line-breaks', 'continued-lines', 'quoting', 'indents', 'invisible', 'large-input'], ['shell', 'text'])) {
    const text = reader + '\n' + shape.text + '\ncodex resume --last';
    assert.equal(parse(text, input).status, 'UNKNOWN', shape.id);
  }
  for (const text of [reader + '\n' + '('.repeat(12000) + 'codex resume' + ')'.repeat(12000),
    (reader + '\n').repeat(500), reader + '\n' + ' '.repeat(LIMITS.command),
    (reader + '\n').repeat(500) + 'claude --continue']) {
    const roles = api.commandRoles(text, input);
    assert.equal(roles.candidate.length, text.length, 'no truncation or recursive stack growth');
    if (text.length > LIMITS.command) assert.equal(roles.candidate, text, 'over-limit source receives no projection');
    if (text.includes('codex resume') || text.includes('claude --continue')) assert.equal(parse(text, input).status, 'UNKNOWN');
  }
  assert.equal(api.roleWords('rg -e codex status,headSha'), null, 'comma belongs only to acquisition JSON fields');
});


// These anonymous equivalents exercise evidence roles only; no payload is dispatched.
test('evidence boundary model keeps separate source words and complete Git operands distinct', t => {
  const model = matrix.evidence_boundary_model, api = evidenceProjection();
  const input = selected => ({ tool_input: selected === null ? {} : { shell: selected } });
  let rows = 0, masks = 0;
  function check(id, text, expected, selected) {
    const envelope = input(selected), roles = api.commandRoles(text, envelope);
    assert.equal(parse(text, envelope).status, expected, id + '/' + selected); rows += 1;
    if (!roles.segments) return;
    const spans = [...roles.segments.spans, ...(roles.excludedExecutable ? [roles.excludedExecutable] : [])].sort((a, b) => a.start - b.start);
    let at = 0;
    for (const span of spans) {
      assert.ok(span.start >= at && span.end <= text.length, id + ': non-overlapping original offsets');
      assert.equal(roles.candidate.slice(at, span.start), text.slice(at, span.start), id + ': executable bytes retained');
      assert.equal(roles.candidate.slice(span.start, span.end), ' '.repeat(span.end - span.start));
      at = span.end; masks += 1;
    }
    assert.equal(roles.candidate.slice(at), text.slice(at));
    assert.equal(roles.candidate.length, text.length);
    for (const unproved of roles.segments.unproved) assert.ok(roles.candidate.includes(unproved));
    for (const proof of roles.segments.proofs) {
      assert.equal(proof.consumed, text.slice(proof.start, proof.end).trimEnd().length, id + ': complete stage consumption');
      for (const role of proof.roles) assert.ok(role.role);
    }
  }
  for (const [id, body] of model.bodies) for (const selected of model.shells) {
    for (const text of [body, "@'\n" + body + "\n'@ | python -", '@"\n' + body + '\n"@ | python -',
      'python -c "' + body + '"', "python - <<'PY'\n" + body + '\nPY']) check('foreign/' + id, text, 'NOT_CONTINUATION', selected);
  }
  for (const operation of model.native) for (const selected of model.shells) {
    const body = "@'\nfor key in items:\n    pass\n'@ | python -";
    for (const text of [operation + '; ' + body, body + '; ' + operation, body + ' | ' + operation,
      "@'\nfor key in items:\n    pass\n" + operation + "\n'@ | python -",
      "@'\nimport subprocess\nsubprocess.run([\"codex\",\"resume\"])\n'@ | python -",
      "pwsh -Command '" + operation + "'"]) check('executable-neighbour', text, 'UNKNOWN', selected);
  }
  for (const [id, command] of model.git) for (const selected of model.shells) {
    for (const text of [command, 'git status --short\n' + command,
      'git status --short; ' + command + '; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }', command + ' | ConvertTo-Json']) {
      check('git/' + id, text, 'NOT_CONTINUATION', selected);
    }
    for (const text of ['codex resume --last; ' + command, command + '; claude --resume fixture',
      command + ' | codex resume --last', command.replace('codex/example', '$(codex resume)') + '; & ("co"+"dex") ("res"+"ume")']) {
      check('git-executable/' + id, text, 'UNKNOWN', selected);
    }
  }
  for (const [n, command] of model.unsupported.entries()) for (const selected of model.shells) {
    assert.equal(api.commandRoles(command, input(selected)).segments, null, 'no partial proof for unsupported schema');
    // An unsupported form without candidate evidence retains the ordinary boundary.
    check('unsupported/' + n, command, n === 8 ? 'NOT_CONTINUATION' : 'UNKNOWN', selected);
    check('unsupported-native/' + n, command + '; & ("co"+"dex") ("res"+"ume")', 'UNKNOWN', selected);
  }
  for (const [command, proved, expected] of model.schema) for (const selected of model.shells) {
    assert.equal(Boolean(api.commandRoles(command, input(selected)).segments?.proofs.some(p => p.schema.startsWith('git '))), proved, command);
    check('schema', command, expected, selected);
  }
  for (const [id, text] of model.construction) for (const selected of model.shells) check('construction/' + id, text, 'UNKNOWN', selected);
  for (const selected of [null, '', 5, 'unknown.exe']) {
    const text = 'git push origin HEAD:refs/heads/codex/example; if ($x) { Write-Output $x }';
    const envelope = { tool_input: { shell: selected } };
    assert.equal(api.commandRoles(text, envelope).segments, null); assert.equal(parse(text, envelope).status, 'UNKNOWN');
  }
  for (const selected of model.shells) for (const [id, body] of [
    ['ref', 'git push origin HEAD:refs/heads/codex/example; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }'],
    ['message', 'git commit -m "codex resume"'],
  ]) {
    const text = "pwsh -NoProfile -Command '" + body + "'";
    const ordinary = ['powershell.exe', 'pwsh'].includes(selected) || (id === 'message' && ['bash', 'sh'].includes(selected));
    check('wrapper/' + id, text, ordinary ? 'NOT_CONTINUATION' : 'UNKNOWN', selected);
    check('wrapper-neighbour', text + '; & ("co"+"dex") ("res"+"ume")', 'UNKNOWN', selected);
  }
  // Frozen G0 structural rows: unsupported syntax gets no role proof; it does
  // not invent a continuation when neither native family has visible evidence.
  for (const [ending, expected] of [[';', 'NOT_CONTINUATION'], [' |', 'NOT_CONTINUATION'],
    [' && git status', 'NOT_CONTINUATION'], [' || git status', 'NOT_CONTINUATION'],
    [' # comment', 'UNKNOWN'], [' ' + String.fromCharCode(0), 'UNKNOWN'], [' ' + String.fromCharCode(0x2603), 'UNKNOWN']]) {
    const text = 'git push origin HEAD:refs/heads/codex/example' + ending;
    const roles = api.commandRoles(text, input(null));
    assert.equal(roles.segments, null); assert.equal(roles.candidate, text);
    assert.equal(parse(text, input(null)).status, expected, JSON.stringify(ending));
    assert.equal(parse(text + '; codex resume --last', input(null)).status, 'UNKNOWN', 'executable neighbour still refused');
  }
  const long = 'git push origin HEAD:refs/heads/codex/' + 'x'.repeat(LIMITS.command);
  assert.equal(api.commandRoles(long, input(null)).segments, null); assert.equal(parse(long, input(null)).status, 'UNKNOWN');
  const witness = "@'\nv={'example':1}\nfor key,value in v.items():\n    print(key,value)\n'@ | python -";
  for (const selected of model.shells) check('restart-witness-equivalent', witness, 'NOT_CONTINUATION', selected);
  t.diagnostic(JSON.stringify({ rows, masks, payloadsDispatched: false }));
});

test('contiguous evidence keeps whitespace barriers while punctuation and marked constructions stay conservative', t => {
  const { CANDIDATE_MACHINES } = evidenceProjection(); let rows = 0;
  for (const { word } of CANDIDATE_MACHINES) for (let cut = 1; cut < word.length; cut += 1) {
    for (const separator of [' ', '\t', '\n', '\r\n', ';', '|', '(', ')', '[', ']', ',', ':', '+', '.', '/']) {
      const text = '(' + word.slice(0, cut) + separator + word.slice(cut) + ')';
      // Independent finite reference, including the inherited fixed format/join step.
      const reference = [...text.replace(/-(?:f|join)\b/gi, '')].map(c => /[a-z0-9-]/i.test(c) ? c : /[ \x09-\x0d]/.test(c) ? ' ' : '').join('');
      const expected = /claude|codex|resume|fork|--(?:continue|session-id)/i.test(reference) ? 'UNKNOWN' : 'NOT_CONTINUATION';
      assert.equal(parse(text, { tool_input: {} }).status, expected, word + '/' + cut + '/' + JSON.stringify(separator)); rows += 1;
    }
  }
  // VT/FF remain barriers in the broad projection even though they cannot gain operand proof.
  for (const separator of ['\v', '\f']) assert.equal(parse('(for' + separator + 'key)', { tool_input: {} }).status, 'NOT_CONTINUATION');
  assert.equal(rows, 2400);
  t.diagnostic(JSON.stringify({ primitiveRows: rows }));
});


test('new evidence allowances retain every raw guard without reading a held queue or acquiring metadata', t => {
  const ctx = fixture(t), before = snapshot(ctx.dir);
  const held = { state: 'UNDECIDED', rule: 'R4', repository_id: 'synthetic-held' }, safe = { state: 'DISABLED', rule: 'R1' };
  const positives = ["@'\nfor key,value in items:\n    print(key,value)\n'@ | python -",
    'git push origin HEAD:refs/heads/codex/example; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; git fetch origin codex/example',
    'git commit -m "codex resume; claude --resume"', 'git add -- "codex/resume.md"', 'rg -e "codex resume" fixture.txt'];
  const originals = {}; let queueReads = 0, spawns = 0, checks = 0;
  // Throw on queue reads, metadata probes or directory scans, rather than inferring
  // zero access solely from equal bytes after the call.
  for (const name of ['readFileSync', 'readdirSync', 'statSync', 'lstatSync', 'existsSync']) {
    originals[name] = fs[name];
    fs[name] = (file, ...args) => {
      if (String(file).includes(gate.HELD_BASENAME)) { queueReads += 1; throw new Error('SYNTHETIC_QUEUE_ACCESS'); }
      return originals[name](file, ...args);
    };
  }
  try {
    for (const command of positives) for (const actor of matrix.actors) for (const tool_name of ['Bash', 'PowerShell']) for (const selected of [undefined, 'powershell.exe']) {
      const input = { ...shell(ctx, command), actor, tool_name, tool_input: { cmd: command, ...(selected === undefined ? {} : { shell: selected }) } };
      const make = stateReader => new gate.ToolGate({ registryOptions: ctx.options, environment: ctx.environment, stateReader,
        continuationResolver: new ContinuationResolver({ environment: ctx.environment, spawn() { spawns += 1; throw new Error('UNEXPECTED_METADATA'); } }) });
      const check = (stateReader, value, denied, reason) => {
        assert.equal(Boolean(make(stateReader).decide(value)?.deny), denied, reason); checks += 1;
      };
      check(() => safe, input, false, 'ordinary');
      check(() => held, input, true, 'held current');
      check(() => ({ ...held, rule: 'ERROR', error_code: 'SYNTHETIC' }), input, true, 'unreadable current');
      check(cwd => path.resolve(cwd) === ctx.other ? held : safe, { ...input, tool_input: { ...input.tool_input, workdir: ctx.other } }, true, 'held workdir');
      check(cwd => path.resolve(cwd).startsWith(ctx.other) ? held : safe,
        { ...input, tool_input: { ...input.tool_input, cmd: command + '; Get-Content -LiteralPath "' + ctx.other + '/fixture.txt"' } }, true, 'held raw path');
      check(() => safe, { ...input, tool_input: { ...input.tool_input, cmd: command + '; node toolkit-governance.cjs enable' } }, true, 'owner answer');
      check(() => safe, { ...input, tool_name: 'Write', tool_input: { file_path: ctx.options.registryPath } }, true, 'user-state edit');
    }
  } finally { for (const name of Object.keys(originals)) fs[name] = originals[name]; }
  assert.equal(checks, 560); assert.equal(queueReads, 0); assert.equal(spawns, 0);
  assert.deepEqual(snapshot(ctx.dir), before);
  t.diagnostic(JSON.stringify({ rawGuardChecks: checks, queueReads, metadataSpawns: spawns, bytesAndDirectoriesUnchanged: true }));
});
