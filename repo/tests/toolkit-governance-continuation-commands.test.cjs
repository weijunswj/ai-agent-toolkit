'use strict';

// The continuation target-authority model with its resolver, transcript reader and selectors;
// embedded and hostile text; the reviewed command corpus under every shell reading; and path guards.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { ContinuationResolver, TranscriptReader, LIMITS, parse } = require('../scripts/toolkit-governance-continuation.cjs');
const gate = require('../scripts/toolkit-governance-gate.cjs');
const hostile = require('./support/hostile-inputs.cjs');
const matrix = require('./support/governance-continuation-matrix.json');
const corpus = require('./support/governance-continuation-corpus.json');
const { READINGS, expectedFor, fixture, ID, message, OTHER_ID, readingInput, shell, snapshot, transcript } = require('./support/governance-continuation-fixture.cjs');

test('the reviewed command corpus keeps its result under every shell reading', t => {
  // Commands earlier reviews collected, each with its expected result per reading. A row whose
  // `was` differs is a reviewed allowance of the letters-anywhere guard's refusal; it never
  // covers a verified resume, and no row refused by that guard is allowed in its own shell
  // unless the text runs no host there.
  const ctx = fixture(t), before = snapshot(ctx.dir);
  assert.deepEqual(corpus.readings, READINGS);
  let checks = 0, allowances = 0;
  for (const row of corpus.rows) for (const reading of READINGS) {
    const text = row.text.replaceAll('{TARGET}', ctx.target).replaceAll('{TRANSCRIPT}', ctx.file);
    const input = readingInput(ctx, text, reading);
    assert.equal(parse(text, input).status, row.expected[reading], `${row.ids[0]} ${reading}: ${row.text.slice(0, 120)}`);
    if (row.was?.[reading] && row.expected[reading] === 'NOT_CONTINUATION') {
      assert.equal(row.was[reading], 'UNKNOWN', row.ids[0]);
      allowances += 1;
    }
    checks += 1;
  }
  assert.equal(corpus.rows.length, 911);
  t.diagnostic(JSON.stringify({ corpusChecks: checks, reviewedAllowances: allowances }));
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
