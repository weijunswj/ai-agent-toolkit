'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { capturedStack } = require('./support/captured-stack-fixture.cjs');
const { GateAssignment } = require('../scripts/toolkit-v3-lifecycle.cjs');
const { GateSessionLauncher } = require('../scripts/toolkit-gate-session-launcher.cjs');

const h = s => crypto.createHash('sha256').update(s).digest('hex');
// Launchers never read this machine's real Claude settings in these tests.
const noFiles = () => { throw Object.assign(new Error('absent'), { code: 'ENOENT' }); };
function fakeSpawn(calls) {
  return (cmd, args) => { calls.push({ cmd, args });
    return { status: 0, stdout: `${JSON.stringify({ type: 'system', subtype: 'init', session_id: args[args.indexOf('--session-id') + 1] || args[args.indexOf('--resume') + 1], model: 'claude-opus-5-5' })}\n${JSON.stringify({ type: 'result', result: 'done', total_cost_usd: 0 })}\n` }; };
}
function gate() {
  return GateAssignment.admit({ assignment_id: 'qual-slice', programme: 421, child: 461, role: 'G1',
    acceptance: { mode: 'OBJECTIVE', objective_reference: h('criteria'), owner: 'owner' } })
    .launch({ session_id: 's1', launch_request_id: 'L1', requested_by: 'CONTROLLER' }).gate;
}

test('model and effort come only from the pinned registry binding for the role', () => {
  const launcher = new GateSessionLauncher({ captured: capturedStack('owner-claude'), role: 'G1', claude: 'claude', read_file: noFiles, spawn: fakeSpawn([]) });
  assert.deepEqual({ model: launcher.route.model, effort: launcher.route.effort }, { model: 'claude-opus-5-5', effort: 'high' });
  assert.throws(() => new GateSessionLauncher({ captured: capturedStack('owner-gpt'), role: 'G1', spawn: fakeSpawn([]) }).route, e => e.code === 'CLAUDE_NATIVE_ROUTE_UNSUPPORTED');
});

test('a fresh start binds a derived native session identity; a second start of the same session is refused', () => {
  const calls = [], launcher = new GateSessionLauncher({ captured: capturedStack('owner-claude'), role: 'G1', claude: 'claude', read_file: noFiles, spawn: fakeSpawn(calls) });
  const g = gate();
  const run = launcher.start(g, { session_id: 's1', prompt: 'work', cwd: '.' });
  assert.equal(run.native_session_id, GateSessionLauncher.nativeSessionId(g, 's1'));
  assert.deepEqual(calls[0].args.slice(calls[0].args.indexOf('--model'), calls[0].args.indexOf('--model') + 4), ['--model', 'claude-opus-5-5', '--effort', 'high']);
  const checkpointed = g.transition('s1', 'CHECKPOINT', h('cp'));
  assert.throws(() => launcher.start(checkpointed, { session_id: 's1', prompt: 'again', cwd: '.' }), e => e.code === 'LAUNCHER_SESSION_NOT_FRESH');
});

// Stream shaped like a native Claude Code run whose lead waited on a background
// helper: a second init and result follow the first turn's interim result.
function streamSpawn(events) {
  return (cmd, args) => {
    const id = args[args.indexOf('--session-id') + 1];
    const init = { type: 'system', subtype: 'init', session_id: id, model: 'claude-opus-5-5' };
    const lines = events.map(e => e === 'INIT' ? init : { type: 'result', session_id: id, ...e });
    return { status: 0, stdout: `${lines.map(l => JSON.stringify(l)).join('\n')}\n` };
  };
}
function startWith(events) {
  const launcher = new GateSessionLauncher({ captured: capturedStack('owner-claude'), role: 'G1', claude: 'claude', read_file: noFiles, spawn: streamSpawn(events) });
  return launcher.start(gate(), { session_id: 's1', prompt: 'work', cwd: '.' });
}

test('with several result events the terminal one supplies text, error state and cost', () => {
  const run = startWith(['INIT', { subtype: 'success', is_error: false, result: 'Waiting for the helper.', total_cost_usd: 0.4 },
    'INIT', { subtype: 'success', is_error: false, result: 'W3-DONE', total_cost_usd: 0.5 }]);
  assert.deepEqual({ text: run.result_text, error: run.is_error, cost: run.cost_usd }, { text: 'W3-DONE', error: false, cost: 0.5 });
});

test('terminal result controls: a single result is unchanged and a terminal error after an interim success is reported', () => {
  const single = startWith(['INIT', { subtype: 'success', is_error: false, result: 'done', total_cost_usd: 0.25 }]);
  assert.deepEqual({ text: single.result_text, error: single.is_error, cost: single.cost_usd }, { text: 'done', error: false, cost: 0.25 });
  const failed = startWith(['INIT', { subtype: 'success', is_error: false, result: 'interim', total_cost_usd: 0.1 },
    'INIT', { subtype: 'error_during_execution', is_error: true, result: 'helper failed', total_cost_usd: 0.3 }]);
  assert.deepEqual({ text: failed.result_text, error: failed.is_error, cost: failed.cost_usd }, { text: 'helper failed', error: true, cost: 0.3 });
  assert.equal(single.terminal_result, true);
  // A clean process exit without a terminal result is not a completed run.
  const none = startWith(['INIT']);
  assert.equal(none.exit, 0);
  assert.deepEqual({ terminal: none.terminal_result, text: none.result_text, error: none.is_error, cost: none.cost_usd },
    { terminal: false, text: null, error: true, cost: null });
});

test('resume is refused for waiting, submitted, interrupted and retired sessions before any native process', () => {
  const calls = [], launcher = new GateSessionLauncher({ captured: capturedStack('owner-claude'), role: 'G1', claude: 'claude', read_file: noFiles, spawn: fakeSpawn(calls) });
  const waiting = gate().transition('s1', 'ASK_OWNER', h('q'));
  assert.equal(waiting.session('s1').state, 'WAITING_OWNER');
  const replied = waiting.transition('s1', 'OWNER_REPLY', h('a'));
  launcher.resume(replied, { session_id: 's1', prompt: 'continue', cwd: '.' });
  assert.equal(calls.length, 1);
  const submitted = replied.transition('s1', 'SUBMIT', h('r'));
  assert.throws(() => launcher.resume(submitted, { session_id: 's1', prompt: 'x', cwd: '.' }), e => e.code === 'V3_SUBMITTED_SESSION_AWAITING_CONSUMPTION');
  const retired = submitted.consumeReturn({ session_id: 's1', return_digest: h('r'), disposition: 'ACCEPT' }).gate;
  assert.throws(() => launcher.resume(retired, { session_id: 's1', prompt: 'x', cwd: '.' }), e => e.code === 'V3_RETIRED_SESSION_REFUSED');
  const interrupted = gate().transition('s1', 'INTERRUPT', h('crash'));
  assert.throws(() => launcher.resume(interrupted, { session_id: 's1', prompt: 'x', cwd: '.' }), e => e.code === 'V3_INTERRUPTED_SESSION_REQUIRES_SUCCESSOR');
  assert.equal(calls.length, 1, 'no native process was started for a refused session');
});

test('caller arguments cannot override the pinned route; other supported flags still pass', () => {
  for (const base_args of [['--model', 'claude-haiku-5-5'], ['--effort=low'], ['--fallback-model', 'claude-haiku-5-5'], ['--agent', 'other'], ['--model'], [7]]) {
    assert.throws(() => new GateSessionLauncher({ captured: capturedStack('owner-claude'), role: 'G1', claude: 'claude', read_file: noFiles, spawn: fakeSpawn([]), base_args }),
      e => ['LAUNCHER_ROUTE_OVERRIDE_REFUSED', 'LAUNCHER_ARGS_INVALID'].includes(e.code));
  }
  const calls = [], launcher = new GateSessionLauncher({ captured: capturedStack('owner-claude'), role: 'G1', claude: 'claude', read_file: noFiles, spawn: fakeSpawn(calls),
    base_args: ['--setting-sources', 'project,local', '--strict-mcp-config', '--plugin-dir', 'candidate', '--permission-mode', 'default'] });
  for (const extra_args of [['--model', 'claude-haiku-5-5'], ['--effort', 'low'], ['--fallback-model=claude-haiku-5-5'], ['--agent', 'other'], 'not-a-list']) {
    assert.throws(() => launcher.start(gate(), { session_id: 's1', prompt: 'work', cwd: '.', extra_args }),
      e => ['LAUNCHER_ROUTE_OVERRIDE_REFUSED', 'LAUNCHER_ARGS_INVALID'].includes(e.code));
  }
  assert.equal(calls.length, 0, 'a refused override starts no native process');
  // Positive control: the flags the accepted owner-UAT journey passed are unchanged.
  const run = launcher.start(gate(), { session_id: 's1', prompt: 'work', cwd: '.',
    extra_args: ['--agents', 'agents.json', '--tools', 'Read,Agent', '--allowedTools', 'Read', '--include-hook-events'] });
  assert.equal(run.route_observed, true); assert.equal(run.is_error, false);
  const args = calls[0].args;
  assert.equal(args.filter(a => a === '--model').length, 1); assert.equal(args.filter(a => a === '--effort').length, 1);
  assert.deepEqual(args.slice(args.indexOf('--model'), args.indexOf('--model') + 4), ['--model', 'claude-opus-5-5', '--effort', 'high']);
  assert.ok(args.includes('--agents'));
});

test('a native run whose observed model differs from the pinned route is not success', () => {
  const observed = model => (cmd, args) => ({ status: 0, stdout: [{ type: 'system', subtype: 'init', session_id: args[args.indexOf('--session-id') + 1], model },
    { type: 'result', subtype: 'success', is_error: false, result: 'done', total_cost_usd: 0.1 }].map(l => JSON.stringify(l)).join('\n') + '\n' });
  const start = model => new GateSessionLauncher({ captured: capturedStack('owner-claude'), role: 'G1', claude: 'claude', read_file: noFiles, spawn: observed(model) })
    .start(gate(), { session_id: 's1', prompt: 'work', cwd: '.' });
  const wrong = start('claude-haiku-5-5');
  assert.deepEqual({ model: wrong.model, route: wrong.route_observed, error: wrong.is_error, terminal: wrong.terminal_result },
    { model: 'claude-haiku-5-5', route: false, error: true, terminal: true });
  const missing = start(undefined);
  assert.deepEqual({ route: missing.route_observed, error: missing.is_error }, { route: false, error: true });
  const right = start('claude-opus-5-5');
  assert.deepEqual({ route: right.route_observed, error: right.is_error }, { route: true, error: false });
});

test('resume refuses a gate of another role before any native process', () => {
  const calls = [], g0 = new GateSessionLauncher({ captured: capturedStack('owner-claude'), role: 'G0', claude: 'claude', read_file: noFiles, spawn: fakeSpawn(calls) });
  const replied = gate().transition('s1', 'ASK_OWNER', h('q')).transition('s1', 'OWNER_REPLY', h('a'));
  assert.throws(() => g0.resume(replied, { session_id: 's1', prompt: 'x', cwd: '.' }), e => e.code === 'LAUNCHER_GATE_ROLE_MISMATCH');
  assert.throws(() => g0.resume(replied.value, { session_id: 's1', prompt: 'x', cwd: '.' }), e => e.code === 'LAUNCHER_GATE_ROLE_MISMATCH');
  assert.equal(calls.length, 0);
});

// Effort-route controls. Settings files are supplied through the injected reader so the
// tests never read this machine's real Claude configuration.
const pathModule = require('node:path');
const CWD = pathModule.resolve('uat-project'), CONFIG = pathModule.resolve('claude-config');
const HOME = pathModule.resolve('owner-home');
const FILES = { user: pathModule.join(CONFIG, 'settings.json'), project: pathModule.join(CWD, '.claude', 'settings.json'),
  local: pathModule.join(CWD, '.claude', 'settings.local.json'), legacy: pathModule.join(CONFIG, '.claude.json'),
  homeLegacy: pathModule.join(HOME, '.claude.json'), dotConfig: pathModule.join(CONFIG, '.config.json'),
  homeDotConfig: pathModule.join(HOME, '.claude', '.config.json') };
function effortLauncher({ files = {}, base_args = [], calls = [], readError = null, fileErrors = {}, platform = 'win32' } = {}) {
  const read_file = file => {
    if (readError) throw Object.assign(new Error('denied'), { code: readError });
    const failing = Object.entries(fileErrors).find(([key]) => FILES[key] === file);
    if (failing) throw Object.assign(new Error('unreadable'), { code: failing[1] });
    const hit = Object.entries(files).find(([key]) => (FILES[key] || pathModule.resolve(CWD, key)) === file);
    if (!hit) throw Object.assign(new Error('absent'), { code: 'ENOENT' });
    return typeof hit[1] === 'string' ? hit[1] : JSON.stringify(hit[1]);
  };
  return new GateSessionLauncher({ captured: capturedStack('owner-claude'), role: 'G1', claude: 'claude', spawn: fakeSpawn(calls), base_args, read_file, platform });
}
const baseEnv = extra => ({ CLAUDE_CONFIG_DIR: CONFIG, ...extra });
const startEffort = (launcher, env, extra_args = []) => launcher.start(gate(), { session_id: 's1', prompt: 'work', cwd: CWD, env, extra_args });
const refusedWith = code => e => e.code === code;

test('an inherited effort that differs from the pinned route is refused before any native process', () => {
  const calls = [], launcher = effortLauncher({ calls });
  for (const value of ['low', 'medium', 'xhigh', 'max', 'HIGH']) {
    assert.throws(() => startEffort(launcher, baseEnv({ CLAUDE_CODE_EFFORT_LEVEL: value })), refusedWith('LAUNCHER_ENV_EFFORT_OVERRIDE_REFUSED'), value);
  }
  const replied = gate().transition('s1', 'ASK_OWNER', h('q')).transition('s1', 'OWNER_REPLY', h('a'));
  assert.throws(() => launcher.resume(replied, { session_id: 's1', prompt: 'x', cwd: CWD, env: baseEnv({ CLAUDE_CODE_EFFORT_LEVEL: 'low' }) }),
    refusedWith('LAUNCHER_ENV_EFFORT_OVERRIDE_REFUSED'));
  assert.equal(calls.length, 0, 'no native process for a refused inherited effort');
  for (const [env, inherited] of [[baseEnv({ CLAUDE_CODE_EFFORT_LEVEL: 'high' }), 'EQUAL'], [baseEnv({}), 'ABSENT'], [baseEnv({ CLAUDE_CODE_EFFORT_LEVEL: '' }), 'ABSENT']]) {
    const run = startEffort(launcher, env);
    assert.equal(run.effort_assurance.inherited_effort, inherited);
    assert.equal(run.effort_assurance.exact_effort, 'NOT_EXPOSED');
    assert.equal(run.effort_assurance.unobserved_sources.length, 3);
  }
  assert.equal(calls.length, 3);
});

test('an effort carried in CLAUDE_CODE_EXTRA_BODY is refused; an unrelated extra body is allowed', () => {
  const calls = [], launcher = effortLauncher({ calls });
  for (const body of ['{"output_config":{"effort":"low"}}', '{"thinking":{"type":"enabled","budget_tokens":1024}}', '{"reasoning_effort":"low"}']) {
    assert.throws(() => startEffort(launcher, baseEnv({ CLAUDE_CODE_EXTRA_BODY: body })), refusedWith('LAUNCHER_ENV_EXTRA_BODY_EFFORT_REFUSED'), body);
  }
  assert.throws(() => startEffort(launcher, baseEnv({ CLAUDE_CODE_EXTRA_BODY: 'not json' })), refusedWith('LAUNCHER_EFFORT_SETTINGS_UNVERIFIED'));
  assert.equal(calls.length, 0);
  startEffort(launcher, baseEnv({ CLAUDE_CODE_EXTRA_BODY: '{"metadata":{"user_id":"controlled"}}' }));
  assert.equal(calls.length, 1);
});

test('a lower maxEffortLevel in a selected settings source is refused; unselected or higher clamps are not', () => {
  const lower = { maxEffortLevel: 'medium' };
  const cases = [
    { files: { project: lower }, code: 'LAUNCHER_EFFORT_CLAMPED' },
    { files: { local: lower }, code: 'LAUNCHER_EFFORT_CLAMPED' },
    { files: { user: lower }, code: 'LAUNCHER_EFFORT_CLAMPED' },
    { files: { user: lower }, base_args: ['--setting-sources', 'project,local'], clamp: null },
    { files: { project: { maxEffortLevel: 'max', modelSettings: { 'claude-opus-5-5': { maxEffortLevel: 'medium' } } } }, code: 'LAUNCHER_EFFORT_CLAMPED' },
    { files: { project: { maxEffortLevel: 'low', modelSettings: { 'claude-opus-5-5': { maxEffortLevel: 'max' } } } }, clamp: null },
    { files: { project: { modelSettings: { 'claude-opus-5-5-20261001': { maxEffortLevel: 'low' } } } }, code: 'LAUNCHER_EFFORT_CLAMPED' },
    { files: { project: { modelSettings: { 'claude-haiku-5-5': { maxEffortLevel: 'low' } } } }, clamp: null },
    { files: { project: { maxEffortLevel: 'high' }, local: { maxEffortLevel: 'xhigh' } }, clamp: 'high' },
    { files: { project: { maxEffortLevel: 'xhigh' }, local: { maxEffortLevel: 'medium' } }, code: 'LAUNCHER_EFFORT_CLAMPED' },
    { base_args: ['--settings', '{"maxEffortLevel":"low"}'], code: 'LAUNCHER_EFFORT_CLAMPED' },
    { files: { 'policy.json': { maxEffortLevel: 'low' } }, base_args: ['--settings', 'policy.json'], code: 'LAUNCHER_EFFORT_CLAMPED' }
  ];
  for (const c of cases) {
    const calls = [], launcher = effortLauncher({ files: c.files, base_args: c.base_args || [], calls });
    if (c.code) {
      assert.throws(() => startEffort(launcher, baseEnv({})), refusedWith(c.code), JSON.stringify(c));
      assert.equal(calls.length, 0);
    } else {
      assert.equal(startEffort(launcher, baseEnv({})).effort_assurance.client_clamp, c.clamp, JSON.stringify(c));
      assert.equal(calls.length, 1);
    }
  }
});

test('effort settings that cannot be read or verified hold the launch', () => {
  for (const c of [
    { files: { project: '{not json' } },
    { files: { project: { maxEffortLevel: 'ultra' } } },
    { files: { project: [] } },
    { base_args: ['--setting-sources', 'user,enterprise'] },
    { base_args: ['--settings', 'missing.json'] },
    { base_args: ['--settings'] },
    { readError: 'EACCES' }
  ]) {
    const calls = [], launcher = effortLauncher({ files: c.files || {}, base_args: c.base_args || [], calls, readError: c.readError || null });
    assert.throws(() => startEffort(launcher, baseEnv({})), refusedWith('LAUNCHER_EFFORT_SETTINGS_UNVERIFIED'), JSON.stringify(c));
    assert.equal(calls.length, 0);
  }
});

// R1b: the `env` map of every settings source Claude Code applies, the legacy global config and a
// caller environment in any Windows casing carry the same effort rules. One frozen input matrix.
test('an effort carried in an applied settings env map or a differently cased Windows key is refused before any native process', () => {
  const UAT = ['--setting-sources', 'project,local'];
  const low = { env: { CLAUDE_CODE_EFFORT_LEVEL: 'low' } };
  const level = 'LAUNCHER_SETTINGS_ENV_EFFORT_OVERRIDE_REFUSED', body = 'LAUNCHER_SETTINGS_ENV_EXTRA_BODY_EFFORT_REFUSED';
  const unverified = 'LAUNCHER_EFFORT_SETTINGS_UNVERIFIED';
  const refused = [
    { name: 'user settings env', files: { user: low }, code: level },
    { name: 'project settings env', files: { project: low }, code: level },
    { name: 'local settings env', files: { local: low }, code: level },
    { name: '--settings JSON env', base_args: ['--settings', JSON.stringify(low)], code: level },
    { name: '--settings file env', files: { 'policy.json': low }, base_args: ['--settings', 'policy.json'], code: level },
    { name: 'project env extra body effort', files: { project: { env: { CLAUDE_CODE_EXTRA_BODY: '{"output_config":{"effort":"low"}}' } } }, code: body },
    { name: '--settings JSON env extra body thinking', base_args: ['--settings', JSON.stringify({ env: { CLAUDE_CODE_EXTRA_BODY: '{"thinking":{"type":"disabled"}}' } })], code: body },
    { name: 'legacy global config env under the UAT sources', files: { legacy: { numStartups: 3, env: { CLAUDE_CODE_EFFORT_LEVEL: 'medium' } } }, base_args: UAT, code: level },
    { name: 'legacy global config in the home directory', files: { homeLegacy: low }, env: { USERPROFILE: HOME }, base_args: UAT, code: level },
    { name: 'wrong-cased Windows key in a settings env', files: { project: { env: { claude_code_effort_level: 'low' } } }, code: level },
    { name: 'wrong-cased Windows caller key', env: { claude_code_effort_level: 'low' }, code: 'LAUNCHER_ENV_EFFORT_OVERRIDE_REFUSED' },
    { name: 'wrong-cased Windows caller extra body', env: { Claude_Code_Extra_Body: '{"reasoning_effort":"low"}' }, code: 'LAUNCHER_ENV_EXTRA_BODY_EFFORT_REFUSED' },
    { name: 'conflicting Windows casings of one caller key', env: { CLAUDE_CODE_EFFORT_LEVEL: 'high', claude_code_effort_level: 'low' }, code: unverified },
    { name: 'settings env that is not an object', files: { local: { env: 'CLAUDE_CODE_EFFORT_LEVEL=low' } }, code: unverified },
    { name: 'non-string settings env effort', files: { project: { env: { CLAUDE_CODE_EFFORT_LEVEL: 3 } } }, code: unverified },
    { name: 'unparseable settings env extra body', files: { project: { env: { CLAUDE_CODE_EXTRA_BODY: '{not json' } } }, code: unverified },
    { name: 'unparseable legacy global config', files: { legacy: '{"env":' }, base_args: UAT, code: unverified },
    { name: 'legacy global config that is not an object', files: { legacy: '[]' }, base_args: UAT, code: unverified }
  ];
  for (const c of refused) {
    const calls = [], launcher = effortLauncher({ files: c.files || {}, base_args: c.base_args || [], calls });
    const env = c.env && c.env.USERPROFILE ? c.env : baseEnv(c.env || {});
    assert.throws(() => startEffort(launcher, env), e => e.code === c.code && !/low|medium/.test(e.message), c.name);
    assert.equal(calls.length, 0, `${c.name}: zero native processes`);
  }
  // A resumed gate is checked the same way.
  const calls = [], launcher = effortLauncher({ files: { project: low }, calls });
  const replied = gate().transition('s1', 'ASK_OWNER', h('q')).transition('s1', 'OWNER_REPLY', h('a'));
  assert.throws(() => launcher.resume(replied, { session_id: 's1', prompt: 'x', cwd: CWD, env: baseEnv({}) }), refusedWith(level));
  assert.equal(calls.length, 0);
});

test('absent, equal, unselected and unrelated settings env inputs still launch on the pinned route', () => {
  const high = { env: { CLAUDE_CODE_EFFORT_LEVEL: 'high' } };
  const allowed = [
    { name: 'absent everywhere', files: { project: { hooks: {} }, legacy: { numStartups: 3 } }, env_effort: ['ABSENT', 'ABSENT', 'ABSENT', 'ABSENT'] },
    { name: 'equal in every source', files: { legacy: high, user: high, project: high, local: high, 'policy.json': high }, base_args: ['--settings', 'policy.json'],
      env_effort: ['EQUAL', 'EQUAL', 'EQUAL', 'EQUAL', 'EQUAL'] },
    { name: 'unselected user settings', files: { user: { env: { CLAUDE_CODE_EFFORT_LEVEL: 'low' } } }, base_args: ['--setting-sources', 'project,local'],
      env_effort: ['ABSENT', 'ABSENT', 'ABSENT'] },
    { name: 'unrelated settings env keys', files: { project: { env: { DISABLE_TELEMETRY: '1', CLAUDE_CODE_EXTRA_BODY: '{"metadata":{"user_id":"controlled"}}' } } },
      env_effort: ['ABSENT', 'ABSENT', 'ABSENT', 'ABSENT'] },
    { name: 'a lowercase name is a different variable outside Windows', platform: 'linux', env: { claude_code_effort_level: 'low' },
      env_effort: ['ABSENT', 'ABSENT', 'ABSENT', 'ABSENT'] }
  ];
  for (const c of allowed) {
    const calls = [], launcher = effortLauncher({ files: c.files || {}, base_args: c.base_args || [], calls, platform: c.platform || 'win32' });
    const run = startEffort(launcher, baseEnv(c.env || {}));
    assert.equal(calls.length, 1, c.name);
    assert.deepEqual(run.effort_assurance.checked.map(x => x.env_effort), c.env_effort, c.name);
    assert.equal(run.effort_assurance.checked[0].source, 'legacy-global-config');
    assert.deepEqual(calls[0].args.slice(calls[0].args.indexOf('--model'), calls[0].args.indexOf('--model') + 4), ['--model', 'claude-opus-5-5', '--effort', 'high']);
  }
});

// R1c: Claude Code 2.1.301 takes its global config from a nonempty <config home>/.config.json before
// falling back to .claude.json. The first two rows are the two reproduced H-R1b-1 bypasses.
test('an effort in a nonempty .config.json global config is refused before any native process; unusable ones hold', () => {
  const UAT = ['--setting-sources', 'project,local'];
  const low = { env: { CLAUDE_CODE_EFFORT_LEVEL: 'low' } };
  const level = 'LAUNCHER_SETTINGS_ENV_EFFORT_OVERRIDE_REFUSED', unverified = 'LAUNCHER_EFFORT_SETTINGS_UNVERIFIED';
  const refused = [
    { name: '.config.json in CLAUDE_CONFIG_DIR under the UAT sources', files: { dotConfig: low }, code: level },
    { name: '.config.json in the default Windows config home', files: { homeDotConfig: low }, env: { USERPROFILE: HOME }, code: level },
    { name: '.config.json env extra body effort', files: { dotConfig: { env: { CLAUDE_CODE_EXTRA_BODY: '{"output_config":{"effort":"low"}}' } } },
      code: 'LAUNCHER_SETTINGS_ENV_EXTRA_BODY_EFFORT_REFUSED' },
    { name: 'wrong-cased Windows key in .config.json env', files: { dotConfig: { env: { Claude_Code_Effort_Level: 'low' } } }, code: level },
    { name: 'empty .config.json falls back to .claude.json', files: { dotConfig: '', legacy: low }, code: level },
    { name: 'unparseable .config.json', files: { dotConfig: '{"env":' }, code: unverified },
    { name: 'whitespace-only .config.json', files: { dotConfig: ' \n' }, code: unverified },
    { name: '.config.json that is not an object', files: { dotConfig: '[]' }, code: unverified },
    { name: '.config.json env that is not an object', files: { dotConfig: { env: ['CLAUDE_CODE_EFFORT_LEVEL=low'] } }, code: unverified },
    { name: 'unreadable .config.json', fileErrors: { dotConfig: 'EACCES' }, code: unverified },
    { name: '.config.json that is a directory', fileErrors: { dotConfig: 'EISDIR' }, code: unverified },
    { name: 'custom OAuth URL selects an unmodelled global config name', env: { CLAUDE_CODE_CUSTOM_OAUTH_URL: 'https://oauth.invalid' }, code: unverified },
    { name: 'wrong-cased Windows custom OAuth URL', files: { dotConfig: { env: {} } }, env: { claude_code_custom_oauth_url: 'https://oauth.invalid' }, code: unverified }
  ];
  for (const c of refused) {
    const calls = [], launcher = effortLauncher({ files: c.files || {}, fileErrors: c.fileErrors || {}, base_args: UAT, calls });
    const env = c.env && c.env.USERPROFILE ? c.env : baseEnv(c.env || {});
    assert.throws(() => startEffort(launcher, env), e => e.code === c.code && !/low|oauth/i.test(e.message), c.name);
    assert.equal(calls.length, 0, `${c.name}: zero native processes`);
  }
  const calls = [], launcher = effortLauncher({ files: { dotConfig: low }, base_args: UAT, calls });
  const replied = gate().transition('s1', 'ASK_OWNER', h('q')).transition('s1', 'OWNER_REPLY', h('a'));
  assert.throws(() => launcher.resume(replied, { session_id: 's1', prompt: 'x', cwd: CWD, env: baseEnv({}) }), refusedWith(level));
  assert.equal(calls.length, 0, 'a resumed gate is checked the same way');
});

test('the selected global config file decides the env check: absent or empty .config.json uses .claude.json', () => {
  const high = { env: { CLAUDE_CODE_EFFORT_LEVEL: 'high' } }, low = { env: { CLAUDE_CODE_EFFORT_LEVEL: 'low' } };
  const allowed = [
    { name: 'no .config.json', files: { legacy: high }, global: ['.claude.json', true, 'EQUAL'] },
    { name: 'no global config at all', files: {}, global: ['.claude.json', false, 'ABSENT'] },
    { name: 'empty .config.json', files: { dotConfig: '', legacy: high }, global: ['.claude.json', true, 'EQUAL'] },
    { name: 'equal effort in .config.json', files: { dotConfig: high }, global: ['.config.json', true, 'EQUAL'] },
    { name: '.config.json takes precedence over .claude.json', files: { dotConfig: high, legacy: low }, global: ['.config.json', true, 'EQUAL'] },
    { name: '.config.json without env', files: { dotConfig: { numStartups: 3 }, legacy: low }, global: ['.config.json', true, 'ABSENT'] },
    { name: 'default config home .config.json', files: { homeDotConfig: high, homeLegacy: low }, env: { USERPROFILE: HOME }, global: ['.config.json', true, 'EQUAL'] }
  ];
  for (const c of allowed) {
    const calls = [], launcher = effortLauncher({ files: c.files, base_args: ['--setting-sources', 'project,local'], calls });
    const env = c.env || baseEnv({});
    const g = gate(), run = launcher.start(g, { session_id: 's1', prompt: 'work', cwd: CWD, env });
    assert.equal(calls.length, 1, c.name);
    const row = run.effort_assurance.checked[0];
    assert.deepEqual([row.source, row.file, row.present, row.env_effort], ['legacy-global-config', ...c.global], c.name);
    assert.deepEqual(calls[0].args.slice(calls[0].args.indexOf('--model'), calls[0].args.indexOf('--model') + 4), ['--model', 'claude-opus-5-5', '--effort', 'high']);
  }
  // Resume uses the same selection.
  const calls = [], launcher = effortLauncher({ files: { dotConfig: high, legacy: low }, calls });
  const replied = gate().transition('s1', 'ASK_OWNER', h('q')).transition('s1', 'OWNER_REPLY', h('a'));
  const run = launcher.resume(replied, { session_id: 's1', prompt: 'x', cwd: CWD, env: baseEnv({}) });
  assert.equal(run.effort_assurance.checked[0].file, '.config.json');
  assert.ok(calls[0].args.includes('--resume'));
});

test('the accepted owner-UAT invocation is unchanged by the effort-route check', () => {
  const calls = [], base_args = ['--setting-sources', 'project,local', '--strict-mcp-config', '--plugin-dir', 'candidate', '--permission-mode', 'default'];
  const extra_args = ['--agents', 'agents.json', '--tools', 'Read,Edit,Write,Glob,Grep,Bash,Agent', '--allowedTools', 'Read', 'Agent', '--include-hook-events'];
  const launcher = effortLauncher({ calls, base_args, files: { project: { hooks: {} }, user: { maxEffortLevel: 'low' } } });
  const g = gate(), run = launcher.start(g, { session_id: 's1', prompt: 'work', cwd: CWD, env: baseEnv({}), extra_args });
  assert.equal(run.is_error, false);
  assert.deepEqual(calls[0].args, ['-p', 'work', '--session-id', GateSessionLauncher.nativeSessionId(g, 's1'), '--model', 'claude-opus-5-5',
    '--effort', 'high', ...base_args, ...extra_args, '--output-format', 'stream-json', '--verbose']);
  assert.deepEqual(run.effort_assurance.setting_sources, ['project', 'local']);
  assert.equal(run.effort_assurance.client_clamp, null, 'the excluded user source does not clamp');
});
