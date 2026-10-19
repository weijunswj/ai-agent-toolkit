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
// Most rows model the Windows host (platform 'win32'), where only a drive-letter or UNC path is an absolute
// CLAUDE_CONFIG_DIR or USERPROFILE; on another test host those two use a drive-letter form. The launcher and
// these fixtures join paths with the same host path module, so file identities still agree.
const winAbsolute = name => (process.platform === 'win32' ? pathModule.resolve(name) : `C:\\${name}`);
const CWD = pathModule.resolve('uat-project'), CONFIG = winAbsolute('claude-config');
const HOME = winAbsolute('owner-home');
const FILES = { user: pathModule.join(CONFIG, 'settings.json'), project: pathModule.join(CWD, '.claude', 'settings.json'),
  local: pathModule.join(CWD, '.claude', 'settings.local.json'), legacy: pathModule.join(CONFIG, '.claude.json'),
  homeLegacy: pathModule.join(HOME, '.claude.json'), dotConfig: pathModule.join(CONFIG, '.config.json'),
  homeDotConfig: pathModule.join(HOME, '.claude', '.config.json') };
function effortLauncher({ files = {}, base_args = [], calls = [], readError = null, fileErrors = {}, platform = 'win32', parent_env } = {}) {
  const read_file = file => {
    if (readError) throw Object.assign(new Error('denied'), { code: readError });
    const failing = Object.entries(fileErrors).find(([key]) => FILES[key] === file);
    if (failing) throw Object.assign(new Error('unreadable'), { code: failing[1] });
    const hit = Object.entries(files).find(([key]) => (FILES[key] || pathModule.resolve(CWD, key)) === file);
    if (!hit) throw Object.assign(new Error('absent'), { code: 'ENOENT' });
    return typeof hit[1] === 'string' ? hit[1] : JSON.stringify(hit[1]);
  };
  return new GateSessionLauncher({ captured: capturedStack('owner-claude'), role: 'G1', claude: 'claude', spawn: fakeSpawn(calls), base_args, read_file, platform,
    ...(parent_env ? { parent_env } : {}) });
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
    // Outside Windows only a / path is an absolute CLAUDE_CONFIG_DIR, whatever this test host's own path style.
    { name: 'a lowercase name is a different variable outside Windows', platform: 'linux',
      env: { CLAUDE_CONFIG_DIR: '/home/owner/claude-config', claude_code_effort_level: 'low' },
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
    '--effort', 'high', ...base_args, ...extra_args, '--disallowedTools', 'Agent,Task', '--output-format', 'stream-json', '--verbose']);
  assert.deepEqual(run.effort_assurance.setting_sources, ['project', 'local']);
  assert.equal(run.effort_assurance.client_clamp, null, 'the excluded user source does not clamp');
});

// Claude Code runs a PreToolUse hook that cannot start, crashes or times out as a non-blocking
// error, so a launched worker's helper path cannot rest on the hook alone. The launcher adds a
// host-enforced deny rule for the helper tools on start and resume, after every caller argument,
// and refuses the permission-bypass modes around it.
test('launched workers start and resume with the native helper tools denied by the host, whatever the caller allows', () => {
  const calls = [], launcher = effortLauncher({ calls, base_args: ['--setting-sources', 'project,local'], files: { project: { hooks: {} } } });
  const g = gate(), extra_args = ['--tools', 'Read,Agent', '--allowedTools', 'Agent', 'Task'];
  launcher.start(g, { session_id: 's1', prompt: 'work', cwd: CWD, env: baseEnv({}), extra_args });
  launcher.resume(g, { session_id: 's1', prompt: 'again', cwd: CWD, env: baseEnv({}), extra_args });
  assert.equal(calls.length, 2);
  for (const call of calls) {
    const at = call.args.indexOf('--disallowedTools');
    assert.ok(at > call.args.lastIndexOf('Task'), 'the deny follows every caller argument');
    assert.deepEqual(call.args.slice(at, at + 3), ['--disallowedTools', 'Agent,Task', '--output-format']);
  }
});

test('permission-bypass modes that could lift the helper deny are refused before any native process', () => {
  const calls = [], launcher = effortLauncher({ calls, base_args: ['--setting-sources', 'project,local'], files: { project: { hooks: {} } } });
  for (const extra_args of [['--dangerously-skip-permissions'], ['--allow-dangerously-skip-permissions'], ['--permission-mode', 'bypassPermissions'], ['--permission-mode=bypassPermissions']]) {
    assert.throws(() => launcher.start(gate(), { session_id: 's1', prompt: 'work', cwd: CWD, env: baseEnv({}), extra_args }), e => e.code === 'LAUNCHER_PERMISSION_BYPASS_REFUSED', extra_args.join(' '));
  }
  assert.throws(() => effortLauncher({ calls, base_args: ['--dangerously-skip-permissions'], files: {} }), e => e.code === 'LAUNCHER_PERMISSION_BYPASS_REFUSED');
  assert.equal(calls.length, 0);
  // Same boundary: an ordinary permission mode still launches.
  launcher.start(gate(), { session_id: 's1', prompt: 'work', cwd: CWD, env: baseEnv({}), extra_args: ['--permission-mode', 'default'] });
  assert.equal(calls.length, 1);
});

// R1c-F1: Claude Code keeps an explicit empty CLAUDE_CONFIG_DIR and resolves a relative one (or a relative home) against the
// spawned session's cwd, so the launcher cannot name the global config either selects. The first two rows
// are the reproduced bypasses: an effort in <cwd>/.config.json or <cwd>/rel/.config.json.
test('an empty, relative, non-string or ambiguously cased CLAUDE_CONFIG_DIR or home directory holds start and resume before any native process', () => {
  const low = { env: { CLAUDE_CODE_EFFORT_LEVEL: 'low' } }, unverified = 'LAUNCHER_EFFORT_SETTINGS_UNVERIFIED';
  const held = [
    { name: 'empty config dir with an effort in <cwd>/.config.json', files: { '.config.json': low }, env: { CLAUDE_CONFIG_DIR: '', USERPROFILE: HOME } },
    { name: 'relative config dir with an effort in <cwd>/rel/.config.json', files: { 'rel/.config.json': low }, env: { CLAUDE_CONFIG_DIR: 'rel', USERPROFILE: HOME } },
    { name: 'empty config dir in another Windows casing', files: { '.config.json': low }, env: { claude_config_dir: '', USERPROFILE: HOME } },
    { name: 'relative config dir in another Windows casing', env: { Claude_Config_Dir: 'rel', USERPROFILE: HOME } },
    { name: 'two Windows casings with equal absolute values', env: { CLAUDE_CONFIG_DIR: CONFIG, claude_config_dir: CONFIG } },
    { name: 'two Windows casings with differing values', env: { CLAUDE_CONFIG_DIR: CONFIG, claude_config_dir: HOME } },
    { name: 'an absolute and an empty Windows casing', env: { CLAUDE_CONFIG_DIR: CONFIG, Claude_Config_Dir: '' } },
    { name: 'non-string config dir', env: { CLAUDE_CONFIG_DIR: 7, USERPROFILE: HOME } },
    { name: 'Windows rooted path without a drive', env: { CLAUDE_CONFIG_DIR: '\\claude-config', USERPROFILE: HOME } },
    { name: 'Windows drive-relative path', env: { CLAUDE_CONFIG_DIR: 'C:claude-config', USERPROFILE: HOME } },
    { name: 'relative config dir outside Windows', platform: 'linux', env: { CLAUDE_CONFIG_DIR: 'rel', HOME: '/home/owner' } },
    { name: 'empty config dir outside Windows', platform: 'linux', env: { CLAUDE_CONFIG_DIR: '', HOME: '/home/owner' } },
    // The same family through the default config home: the home variable names <home>/.claude.
    { name: 'relative USERPROFILE with an effort in <cwd>/rel/.claude/.config.json', files: { 'rel/.claude/.config.json': low }, env: { USERPROFILE: 'rel' } },
    { name: 'empty USERPROFILE', env: { USERPROFILE: '' } },
    { name: 'two Windows casings of USERPROFILE', env: { USERPROFILE: HOME, userprofile: HOME } },
    { name: 'HOME without USERPROFILE on Windows', env: { HOME: HOME } },
    { name: 'relative HOME outside Windows', platform: 'linux', env: { HOME: 'rel' } }
  ];
  for (const c of held) {
    const calls = [], launcher = effortLauncher({ files: c.files || {}, base_args: ['--setting-sources', 'project,local'], calls, platform: c.platform || 'win32' });
    assert.throws(() => startEffort(launcher, c.env), e => e.code === unverified && !/low|rel|claude-config/.test(e.message), `${c.name}: start`);
    const replied = gate().transition('s1', 'ASK_OWNER', h('q')).transition('s1', 'OWNER_REPLY', h('a'));
    assert.throws(() => launcher.resume(replied, { session_id: 's1', prompt: 'x', cwd: CWD, env: c.env }), refusedWith(unverified), `${c.name}: resume`);
    assert.equal(calls.length, 0, `${c.name}: zero native processes`);
  }
});

test('an omitted or absolute CLAUDE_CONFIG_DIR or home directory still launches and resumes; a single Windows casing is honoured', () => {
  const high = { env: { CLAUDE_CODE_EFFORT_LEVEL: 'high' } }, low = { env: { CLAUDE_CODE_EFFORT_LEVEL: 'low' } };
  const allowed = [
    { name: 'omitted config dir', env: { USERPROFILE: HOME }, files: { homeLegacy: high }, global: ['.claude.json', true, 'EQUAL'] },
    { name: 'absolute config dir', env: baseEnv({}), files: { dotConfig: high }, global: ['.config.json', true, 'EQUAL'] },
    { name: 'absolute config dir in another Windows casing', env: { claude_config_dir: CONFIG }, files: { dotConfig: high }, global: ['.config.json', true, 'EQUAL'] },
    { name: 'undefined config dir is omitted', env: { CLAUDE_CONFIG_DIR: undefined, USERPROFILE: HOME }, files: {}, global: ['.claude.json', false, 'ABSENT'] },
    { name: 'UNC config dir', env: { CLAUDE_CONFIG_DIR: '\\\\server\\share\\claude-config' }, files: {}, global: ['.claude.json', false, 'ABSENT'] },
    { name: 'absolute config dir outside Windows', platform: 'linux', env: { CLAUDE_CONFIG_DIR: '/home/owner/claude-config' }, files: {}, global: ['.claude.json', false, 'ABSENT'] },
    { name: 'an absolute config dir makes the home variable irrelevant', env: { CLAUDE_CONFIG_DIR: CONFIG, USERPROFILE: 'rel' }, files: { dotConfig: high }, global: ['.config.json', true, 'EQUAL'] },
    // On Windows libuv gives a child without USERPROFILE this process's USERPROFILE; modelled so any test host agrees.
    { name: 'no home variable uses this process home', env: {}, parent_env: { USERPROFILE: HOME }, files: { homeLegacy: high }, global: ['.claude.json', true, 'EQUAL'] },
    { name: 'absolute HOME outside Windows', platform: 'linux', env: { HOME: '/home/owner' }, files: {}, global: ['.claude.json', false, 'ABSENT'] },
    // R1c-N1: with no .claude.json Claude Code may select the zero-length .config.json; the file is not named.
    { name: 'empty .config.json without .claude.json', env: baseEnv({}), files: { dotConfig: '' }, global: ['UNVERIFIED', false, 'ABSENT'] }
  ];
  for (const c of allowed) {
    const calls = [], launcher = effortLauncher({ files: c.files, base_args: ['--setting-sources', 'project,local'], calls, platform: c.platform || 'win32', parent_env: c.parent_env });
    const run = startEffort(launcher, c.env);
    const replied = gate().transition('s1', 'ASK_OWNER', h('q')).transition('s1', 'OWNER_REPLY', h('a'));
    const resumed = launcher.resume(replied, { session_id: 's1', prompt: 'x', cwd: CWD, env: c.env });
    assert.equal(calls.length, 2, c.name);
    for (const r of [run, resumed]) {
      const row = r.effort_assurance.checked[0];
      assert.deepEqual([row.source, row.file, row.present, row.env_effort], ['legacy-global-config', ...c.global], c.name);
    }
    assert.deepEqual(calls[0].args.slice(calls[0].args.indexOf('--model'), calls[0].args.indexOf('--model') + 4), ['--model', 'claude-opus-5-5', '--effort', 'high']);
    assert.ok(calls[1].args.includes('--resume'));
  }
  // A single wrong-cased Windows name is the same variable: its .config.json is checked.
  const calls = [], launcher = effortLauncher({ files: { dotConfig: low }, calls });
  assert.throws(() => startEffort(launcher, { claude_config_dir: CONFIG }), refusedWith('LAUNCHER_SETTINGS_ENV_EFFORT_OVERRIDE_REFUSED'));
  assert.equal(calls.length, 0);
});

// E1: the environment the checks read must be the environment the native child receives. Node's spawn takes
// inherited enumerable keys, on Windows keeps the lexicographically first spelling of a name before dropping
// undefined, writes `${key}=${value}` and lets libuv copy USERPROFILE and other variables from this process.
// X1-X5 are the reviewer's recheck-05 shapes; each holds on start and resume with zero processes.
const fsModule = require('node:fs'), osModule = require('node:os');
const { spawnSync } = require('node:child_process');
const shape = 'LAUNCHER_ENV_SHAPE_UNSUPPORTED', unverifiedCode = 'LAUNCHER_EFFORT_SETTINGS_UNVERIFIED';
const replied = () => gate().transition('s1', 'ASK_OWNER', h('q')).transition('s1', 'OWNER_REPLY', h('a'));
const winHome = winAbsolute('parent-home');

// Rows modelled for the Windows host (and a few POSIX rows) through injected platform and parent environment.
function envShapeRows() {
  const inherited = (proto, own) => Object.assign(Object.create(proto), own);
  const flipFirstLow = () => { let n = 0; return Object.defineProperty({ CLAUDE_CONFIG_DIR: CONFIG }, 'CLAUDE_CODE_EFFORT_LEVEL',
    { enumerable: true, get: () => (n++ === 0 ? 'low' : 'high') }); };
  return [
    { name: 'X1 undefined CLAUDE_CONFIG_DIR beside an absolute Claude_Config_Dir', env: { CLAUDE_CONFIG_DIR: undefined, Claude_Config_Dir: CONFIG, USERPROFILE: HOME }, code: unverifiedCode },
    { name: 'X2 undefined USERPROFILE beside an absolute userprofile', env: { USERPROFILE: undefined, userprofile: HOME }, code: unverifiedCode },
    { name: 'X3 inherited CLAUDE_CODE_EFFORT_LEVEL', env: () => inherited({ CLAUDE_CODE_EFFORT_LEVEL: 'low' }, { CLAUDE_CONFIG_DIR: CONFIG }), code: shape },
    { name: 'X4 inherited relative CLAUDE_CONFIG_DIR', env: () => inherited({ CLAUDE_CONFIG_DIR: 'rel' }, { USERPROFILE: HOME }), code: shape },
    { name: 'X5 key CLAUDE_CONFIG_DIR=rel', env: { 'CLAUDE_CONFIG_DIR=rel': 'z', USERPROFILE: HOME }, code: shape },
    { name: 'undefined uppercase effort beside a lowercase effort', env: { CLAUDE_CODE_EFFORT_LEVEL: undefined, claude_code_effort_level: 'low', CLAUDE_CONFIG_DIR: CONFIG }, code: unverifiedCode },
    { name: 'defined uppercase config dir beside an undefined lowercase one', env: { CLAUDE_CONFIG_DIR: CONFIG, claude_config_dir: undefined }, code: unverifiedCode },
    { name: 'undefined HOME beside a lowercase home', env: { HOME: undefined, home: HOME, CLAUDE_CONFIG_DIR: CONFIG }, code: unverifiedCode },
    { name: 'inherited key under an own key of another casing', env: () => inherited({ claude_code_effort_level: 'low' }, { CLAUDE_CODE_EFFORT_LEVEL: 'high', CLAUDE_CONFIG_DIR: CONFIG }), code: shape },
    { name: 'inherited unrelated key', env: () => inherited({ UNRELATED: '1' }, { CLAUDE_CONFIG_DIR: CONFIG }), code: shape },
    { name: 'inherited relative HOME outside Windows', platform: 'linux', env: () => inherited({ HOME: 'rel' }, {}), code: shape },
    { name: 'key with = outside Windows', platform: 'linux', env: { 'HOME=/x': 'y', HOME: '/home/owner' }, code: shape },
    { name: 'key starting with =', env: { '=C:': CONFIG, CLAUDE_CONFIG_DIR: CONFIG }, code: shape },
    { name: 'empty key', env: { '': 'x', CLAUDE_CONFIG_DIR: CONFIG }, code: shape },
    { name: 'NUL in a key', env: { 'CLAUDE_CONFIG_DIR\u0000x': CONFIG }, code: shape },
    { name: 'NUL in a value', env: { CLAUDE_CONFIG_DIR: `${CONFIG}\u0000x` }, code: shape },
    { name: 'non-string unrelated value', env: { CLAUDE_CONFIG_DIR: CONFIG, UNRELATED: 7 }, code: shape },
    { name: 'non-string effort value', env: { CLAUDE_CONFIG_DIR: CONFIG, CLAUDE_CODE_EFFORT_LEVEL: 3 }, code: unverifiedCode },
    { name: 'dotless-i spelling Node folds into CLAUDE_CONFIG_DIR', env: { 'claude_config_dır': CONFIG, USERPROFILE: HOME }, code: shape },
    { name: 'long-s spelling Node folds into USERPROFILE', env: { 'UſERPROFILE': HOME }, code: shape },
    { name: 'two non-ASCII spellings of one name', env: { 'éX': '1', 'ÉX': '2', CLAUDE_CONFIG_DIR: CONFIG }, code: shape },
    { name: 'getter whose first read is a lower effort', env: flipFirstLow, code: 'LAUNCHER_ENV_EFFORT_OVERRIDE_REFUSED' },
    { name: 'getter that throws', env: () => Object.defineProperty({ CLAUDE_CONFIG_DIR: CONFIG }, 'X', { enumerable: true, get() { throw new Error('boom'); } }), code: shape },
    { name: 'proxy whose keys cannot be enumerated', env: () => new Proxy({}, { ownKeys() { throw new Error('boom'); } }), code: shape }
  ];
}

test('E1: every child-environment shape that differs from its own-property reading holds start and resume before any native process', () => {
  for (const c of envShapeRows()) {
    for (const mode of ['start', 'resume']) {
      const calls = [];
      const launcher = new GateSessionLauncher({ captured: capturedStack('owner-claude'), role: 'G1', claude: 'claude', spawn: fakeSpawn(calls),
        read_file: noFiles, platform: c.platform || 'win32', parent_env: { USERPROFILE: winHome } });
      const env = typeof c.env === 'function' ? c.env() : c.env;
      const call = () => (mode === 'start' ? launcher.start(gate(), { session_id: 's1', prompt: 'w', cwd: CWD, env })
        : launcher.resume(replied(), { session_id: 's1', prompt: 'w', cwd: CWD, env }));
      assert.throws(call, e => e.code === c.code && !/low|rel|claude-config|owner-home/.test(e.message), `${c.name}: ${mode}`);
      assert.equal(calls.length, 0, `${c.name}: ${mode}: zero native processes`);
    }
  }
  for (const env of [null, [], 'CLAUDE_CONFIG_DIR=x']) {
    const calls = [], launcher = effortLauncher({ calls });
    assert.throws(() => startEffort(launcher, env), refusedWith('LAUNCHER_ARGS_INVALID'));
    assert.equal(calls.length, 0);
  }
});

test('E1: the spawned environment is the checked one: Node casing selection, undefined, symbols, getters, proxies and the Windows backfill', () => {
  const spawnedEnv = (c, platform = 'win32') => {
    let seen = null;
    const reads = [];
    const launcher = new GateSessionLauncher({ captured: capturedStack('owner-claude'), role: 'G1', claude: 'claude', platform,
      parent_env: c.parent || {}, read_file: file => { reads.push(file); return noFiles(); },
      spawn: (cmd, args, options) => { seen = options.env; return fakeSpawn([])(cmd, args); } });
    const run = (c.mode === 'resume' ? launcher.resume(replied(), { session_id: 's1', prompt: 'w', cwd: CWD, env: c.env })
      : launcher.start(gate(), { session_id: 's1', prompt: 'w', cwd: CWD, env: c.env }));
    return { env: { ...seen }, proto: Object.getPrototypeOf(seen), reads, run };
  };
  // Windows: the lexicographically first spelling of an unrelated name wins; undefined and symbol keys are not sent.
  const sym = Symbol('ignored');
  for (const mode of ['start', 'resume']) {
    const r = spawnedEnv({ mode, env: { Path: 'second', PATH: 'first', DROPPED: undefined, [sym]: 'x', CLAUDE_CONFIG_DIR: CONFIG } });
    assert.deepEqual(r.env, { PATH: 'first', CLAUDE_CONFIG_DIR: CONFIG }, mode);
    assert.equal(r.proto, null, 'the spawn receives a null-prototype copy, so nothing inherited reaches the child');
  }
  // Windows: libuv's backfill from this process is part of the checked environment; a caller value is never replaced.
  const parent = { USERPROFILE: winHome, PATH: 'parent-path', SYSTEMROOT: winAbsolute('Windows'), UNRELATED: 'not copied' };
  const backfilled = spawnedEnv({ env: {}, parent });
  assert.deepEqual(backfilled.env, { USERPROFILE: winHome, PATH: 'parent-path', SYSTEMROOT: winAbsolute('Windows') });
  assert.ok(backfilled.reads.includes(pathModule.join(winHome, '.claude', '.config.json')), 'the backfilled home is the one checked');
  const own = spawnedEnv({ env: { userprofile: HOME, Path: 'mine' }, parent });
  assert.deepEqual(own.env, { userprofile: HOME, Path: 'mine', SYSTEMROOT: winAbsolute('Windows') });
  assert.ok(own.reads.includes(pathModule.join(HOME, '.claude', '.config.json')));
  // A caller HOME without a caller USERPROFILE still holds although the backfill supplies USERPROFILE.
  assert.throws(() => spawnedEnv({ env: { HOME: HOME }, parent }), refusedWith(unverifiedCode));
  // POSIX: no backfill; a missing HOME is the account's passwd home, not this process's HOME (only a POSIX
  // test host has a POSIX account home to compare).
  if (process.platform !== 'win32') {
    const posix = spawnedEnv({ env: { Home: '/elsewhere' }, parent }, process.platform);
    assert.deepEqual(posix.env, { Home: '/elsewhere' });
    assert.ok(posix.reads.includes(pathModule.join(osModule.userInfo().homedir, '.claude', '.config.json')));
  }
  // Every value is read once: a getter that changes after the check cannot reach the child with another value.
  let n = 0;
  const flip = Object.defineProperty({ CLAUDE_CONFIG_DIR: CONFIG }, 'CLAUDE_CODE_EFFORT_LEVEL', { enumerable: true, get: () => (n++ === 0 ? 'high' : 'low') });
  const flipped = spawnedEnv({ env: flip });
  assert.equal(flipped.env.CLAUDE_CODE_EFFORT_LEVEL, 'high'); assert.equal(n, 1);
  assert.equal(flipped.run.effort_assurance.inherited_effort, 'EQUAL');
  let m = 0;
  const lying = new Proxy({ CLAUDE_CONFIG_DIR: CONFIG, CLAUDE_CODE_EFFORT_LEVEL: 'high' }, { get: (t, k) => (k === 'CLAUDE_CODE_EFFORT_LEVEL' && m++ > 0 ? 'low' : t[k]) });
  assert.equal(spawnedEnv({ env: lying }).env.CLAUDE_CODE_EFFORT_LEVEL, 'high');
});

// Real native children: a harmless Node stand-in receives the launcher's actual spawn options through the real
// spawnSync, on this host's own platform (Windows locally, Linux in CI), and reports what it received.
const STANDIN = pathModule.join(__dirname, 'support', 'claude-env-standin.cjs');
function realChildLauncher() {
  const dir = fsModule.mkdtempSync(pathModule.join(osModule.tmpdir(), 'launcher-env-'));
  const markers = pathModule.join(dir, 'markers');
  fsModule.mkdirSync(markers);
  const spawned = [], reads = [];
  const launcher = new GateSessionLauncher({ captured: capturedStack('owner-claude'), role: 'G1', claude: 'claude',
    read_file: file => { reads.push(file); return noFiles(); },
    spawn: (cmd, args, options) => { const r = spawnSync(process.execPath, [STANDIN, ...args], options); spawned.push(options); return r; } });
  const go = (mode, env) => (mode === 'start' ? launcher.start(gate(), { session_id: 's1', prompt: markers, cwd: dir, env })
    : launcher.resume(replied(), { session_id: 's1', prompt: markers, cwd: dir, env }));
  return { dir, spawned, reads, go, children: () => fsModule.readdirSync(markers).length, done: () => fsModule.rmSync(dir, { recursive: true, force: true }) };
}
// Names (never values) of the variables whose presence or value differs, so a failure cannot print this host's environment.
const envDiff = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => a[k] !== b[k]).sort();
const childValue = (env, name) => Object.entries(env).find(([k]) => (process.platform === 'win32' ? k.toUpperCase() === name : k === name))?.[1];

test('E1: a real child receives exactly the checked environment and the config home the check read, on start and resume', () => {
  const t = realChildLauncher();
  try {
    const abs = name => pathModule.join(t.dir, name);
    const homeName = process.platform === 'win32' ? 'USERPROFILE' : 'HOME';
    const base = { ...process.env };
    for (const k of Object.keys(base)) if (/^(CLAUDE_CONFIG_DIR|CLAUDE_CODE_EFFORT_LEVEL|CLAUDE_CODE_EXTRA_BODY|CLAUDE_CODE_CUSTOM_OAUTH_URL|USERPROFILE|HOME)$/i.test(k)) delete base[k];
    const rows = [
      { name: 'process.env default (the supported default object)', env: undefined },
      { name: 'process.env passed explicitly', env: process.env },
      { name: 'absolute config dir (accepted owner-UAT profile)', env: { ...base, CLAUDE_CONFIG_DIR: abs('config') } },
      { name: 'omitted config dir with an absolute home', env: { ...base, [homeName]: abs('home') } },
      { name: 'omitted config dir and home: native fallback', env: { ...base } },
      { name: 'empty caller environment', env: {} },
      { name: 'equal inherited-effort name', env: { ...base, CLAUDE_CONFIG_DIR: abs('config'), CLAUDE_CODE_EFFORT_LEVEL: 'high' } },
      // On Windows the X1/X2 shapes collide and hold (rows above); on POSIX they are different variables.
      ...(process.platform === 'win32' ? [{ name: 'two spellings of an unrelated name', env: { ...base, Path: 'second', PATH: base.PATH || base.Path || 'p' } }]
        : [{ name: 'X1 POSIX analogue', env: { ...base, CLAUDE_CONFIG_DIR: undefined, Claude_Config_Dir: abs('config'), HOME: abs('home') } },
          { name: 'X2 POSIX analogue', env: { ...base, HOME: undefined, home: abs('home') } }])
    ];
    for (const c of rows) {
      for (const mode of ['start', 'resume']) {
        const before = t.spawned.length, readsBefore = t.reads.length;
        const run = t.go(mode, c.env);
        assert.equal(run.exit, 0, `${c.name}: ${mode}`); assert.equal(run.is_error, false, `${c.name}: ${mode}`);
        assert.equal(t.spawned.length, before + 1);
        const report = JSON.parse(run.result_text), given = { ...t.spawned.at(-1).env };
        assert.deepEqual(envDiff(report.env, given), [], `${c.name}: ${mode}: child environment equals the spawned one`);
        assert.equal(report.effort, 'high');
        const effort = childValue(report.env, 'CLAUDE_CODE_EFFORT_LEVEL');
        assert.ok(effort === undefined || effort === 'high', `${c.name}: ${mode}: no unchecked effort in the child`);
        const configHome = childValue(report.env, 'CLAUDE_CONFIG_DIR') || pathModule.join(report.home, '.claude');
        assert.ok(t.reads.slice(readsBefore).includes(pathModule.join(configHome, '.config.json')),
          `${c.name}: ${mode}: the check read the config home the child resolves`);
        // An accepted shape reaches the child exactly as a direct spawn of the caller's own object would.
        const direct = spawnSync(process.execPath, [STANDIN, '-p', pathModule.join(t.dir, 'markers')], c.env === undefined ? {} : { env: c.env });
        const directReport = JSON.parse(JSON.parse(String(direct.stdout).trim().split(/\r?\n/).at(-1)).result);
        assert.deepEqual(envDiff(report.env, directReport.env), [], `${c.name}: ${mode}: unchanged from a direct spawn`);
        assert.equal(report.home, directReport.home);
      }
    }
    assert.equal(t.children(), rows.length * 4, 'one launcher child and one direct child per row and mode');
  } finally { t.done(); }
});

test('E1: with no home variable for the child, the check reads the native fallback home, not this process home variable', () => {
  // POSIX: this process's HOME differs from the account home a HOME-less child uses. Windows: this process has
  // no USERPROFILE, so libuv copies none and the child falls back to the profile directory.
  const name = process.platform === 'win32' ? 'USERPROFILE' : 'HOME', saved = process.env[name];
  const t = realChildLauncher();
  try {
    if (process.platform === 'win32') delete process.env[name]; else process.env[name] = pathModule.join(t.dir, 'not-the-account-home');
    const base = { ...process.env };
    for (const k of Object.keys(base)) if (/^(CLAUDE_CONFIG_DIR|CLAUDE_CODE_EFFORT_LEVEL|CLAUDE_CODE_EXTRA_BODY|CLAUDE_CODE_CUSTOM_OAUTH_URL|USERPROFILE|HOME)$/i.test(k)) delete base[k];
    for (const mode of ['start', 'resume']) {
      const readsBefore = t.reads.length, run = t.go(mode, base), report = JSON.parse(run.result_text);
      assert.equal(childValue(report.env, name), undefined, mode);
      assert.deepEqual(envDiff(report.env, { ...t.spawned.at(-1).env }), [], mode);
      assert.ok(t.reads.slice(readsBefore).includes(pathModule.join(report.home, '.claude', '.config.json')), `${mode}: the check read the child's home`);
    }
  } finally {
    if (saved === undefined) delete process.env[name]; else process.env[name] = saved;
    t.done();
  }
});

test('E1: X1-X5 and their equivalents start no real child on start or resume on this host', () => {
  const t = realChildLauncher();
  try {
    const abs = name => pathModule.join(t.dir, name);
    const homeName = process.platform === 'win32' ? 'USERPROFILE' : 'HOME';
    const rows = [
      { name: 'X3 inherited effort', env: () => Object.assign(Object.create({ CLAUDE_CODE_EFFORT_LEVEL: 'low' }), { CLAUDE_CONFIG_DIR: abs('config') }), code: shape },
      { name: 'X4 inherited relative config dir', env: () => Object.assign(Object.create({ CLAUDE_CONFIG_DIR: 'rel' }), { [homeName]: abs('home') }), code: shape },
      { name: 'X5 key with =', env: () => ({ 'CLAUDE_CONFIG_DIR=rel': 'z', [homeName]: abs('home') }), code: shape },
      ...(process.platform === 'win32' ? [
        { name: 'X1', env: () => ({ CLAUDE_CONFIG_DIR: undefined, Claude_Config_Dir: abs('config'), USERPROFILE: abs('home') }), code: unverifiedCode },
        { name: 'X2', env: () => ({ USERPROFILE: undefined, userprofile: abs('home') }), code: unverifiedCode },
        { name: 'dotless-i config dir', env: () => ({ 'claude_config_dır': abs('config'), USERPROFILE: abs('home') }), code: shape }] : [])
    ];
    for (const c of rows) {
      for (const mode of ['start', 'resume']) assert.throws(() => t.go(mode, c.env()), refusedWith(c.code), `${c.name}: ${mode}`);
    }
    // An enumerable property on Object.prototype reaches a child through process.env and plain objects alike.
    Object.defineProperty(Object.prototype, 'CLAUDE_CODE_EFFORT_LEVEL', { value: 'low', enumerable: true, configurable: true, writable: true });
    try {
      for (const env of [undefined, process.env, { CLAUDE_CONFIG_DIR: abs('config') }]) {
        for (const mode of ['start', 'resume']) assert.throws(() => t.go(mode, env), refusedWith(shape), mode);
      }
    } finally { delete Object.prototype.CLAUDE_CODE_EFFORT_LEVEL; }
    assert.equal(t.spawned.length, 0); assert.equal(t.children(), 0, 'zero real child processes');
  } finally { t.done(); }
});
