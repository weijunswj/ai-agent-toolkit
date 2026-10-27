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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'continuation-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ctx = { dir, caller: path.join(dir, 'caller'), target: path.join(dir, 'target'), other: path.join(dir, 'other'), home: path.join(dir, 'home') };
  ctx.projects = path.join(ctx.home, '.claude', 'projects');
  ctx.file = path.join(ctx.projects, 'fixture-project', `${ID}.jsonl`);
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
  for (const command of ['claude --version', 'head -n 3 notes.txt; claude --version', `git -C "${ctx.target}" status && claude -p "summarise the repo"`, 'codex exec "please resume the task"', `cd "${ctx.target}" && claude -p "summarise the repo"`]) assert.equal(resolver.resolve(command, shell(ctx, command)).status, 'NOT_CONTINUATION', command);
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
  for (const text of [`echo "${command}"`, `sh -c '${command}'`, `claude --version && sh -c '${command}'`, `function f(){ ${command}; }`, `echo fixture | ${command}`, `${command} > file`, `${command}; git status`, `${command} && ${command}`, `${command} # comment`, `cd - && ${command}`, `cd C:relative && ${command}`, `${command} ${'x'.repeat(LIMITS.command)}`, `codex --remote ws://example.test exec resume --last`, `claude --resume "${ctx.file}`, `claude --resume "$SESSION"`, `claude --resume "$(cat id)"`]) assert.equal(parse(text, shell(ctx, text)).status, 'UNKNOWN', text.slice(0, 100));
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
  function invoke(hook, input, denied, marker = {}) {
    const before = snapshot(ctx.dir);
    const result = spawnSync(process.execPath, [path.join(root, 'repo/scripts', hook.file), ...hook.args], {
      input: JSON.stringify(input), env: { ...env, ...marker }, cwd: ctx.caller, encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 256 * 1024,
    });
    assert.equal(result.status, denied ? hook.deniedExit : 0, `${hook.name}: ${result.stderr}`);
    const output = result.stdout.trim() ? JSON.parse(result.stdout) : {};
    assert.equal(output.hookSpecificOutput?.permissionDecision === 'deny', denied, hook.name);
    if (!denied) {
      if (hook.name === 'codex') assert.equal(result.stdout, '', 'Codex admission is empty stdout');
      else assert.deepEqual(output, {}, 'Claude admission has no permission grant');
      assert.equal(result.stderr, '');
    }
    assert.doesNotMatch(result.stdout + result.stderr, /synthetic held fixture|synthetic fixture/);
    assert.deepEqual(snapshot(ctx.dir), before, `${hook.name}: bytes and directory entries unchanged`);
  }
  const commands = [`claude --resume "${ctx.file}"`, `codex -C "${ctx.target}" exec resume --last`];
  for (const hook of hooks) {
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
  for (const mode of ['malformed', 'unreadable']) {
    fs.rmSync(heldFile);
    if (mode === 'malformed') fs.writeFileSync(heldFile, '{broken'); else fs.mkdirSync(heldFile);
    for (const hook of hooks) for (const command of commands) invoke(hook, shell(ctx, command), false);
  }
  // Only the two source processes were executed. No host CLI continuation, native dispatcher,
  // installed hook, service, installation, owner acceptance or desktop-binary qualification.
});
