'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const control = require('../scripts/toolkit-agent-control.cjs');
const hook = require('../scripts/toolkit-claude-agent-hook.cjs');
const pluginSetup = require('../scripts/setup-claude-toolkit-plugin.cjs');

function root() { return fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-agent-control-')); }
function resources(overrides = {}) {
  return { physical_total: 32 * control.GIB, physical_available: 20 * control.GIB, commit_total: 48 * control.GIB, commit_available: 32 * control.GIB, source: 'fixture', ...overrides };
}
function spec(overrides = {}) {
  return {
    child_responsibility: 'Implement the isolated parser shard and its focused tests.',
    parent_responsibility: 'Reconcile interfaces and review the independent integration boundary.',
    integration_plan: 'The root owns interface reconciliation and final integration judgement.',
    validation_plan: 'The root runs cross-shard validation and reviews the final combined diff.',
    material_benefit: 'The parser shard is independent and materially improves review quality.',
    child_prompt: 'Implement only the isolated parser shard and report changed files and tests.',
    ...overrides,
  };
}
function activationProof(overrides = {}) {
  return { schema: 1, source: 'claude-plugin-list', plugin_version: control.CONTROL_VERSION,
    cache_identity: 'a'.repeat(64), hook_sha256: 'b'.repeat(64), controller_sha256: 'c'.repeat(64), ...overrides };
}
let defaultVerifier;
function configured(topology, capacity_mode, overrides = {}) {
  return { topology, capacity_mode, enforcement_verified: true, activation_proof: defaultVerifier?.proof || activationProof(),
    resource_counter_supported: topology === control.TOPOLOGIES.CLAUDE_DIRECT,
    resource_counter_source: topology === control.TOPOLOGIES.CLAUDE_DIRECT ? 'win32-operating-system' : 'not-applicable', ...overrides };
}
function profile(overrides = {}) {
  return { schema: control.SCHEMA, host: 'claude-code', topology: control.TOPOLOGIES.CLAUDE_DIRECT,
    capacity_mode: control.CAPACITY_MODES.AUTO, manual_maximum: 0, worker_estimate_bytes: control.DEFAULT_WORKER_COST,
    queue_limit: control.MAX_QUEUE, reservation_limit: control.EMERGENCY_WORKER_CEILING,
    controller_version: control.CONTROL_VERSION, enforcement_verified: true, activation_proof: defaultVerifier?.proof || activationProof(), status: 'configured', supported: true, ...overrides };
}
function verifiedOptions(overrides = {}) {
  const selected = overrides.profile || profile();
  return { claudeCli: defaultVerifier.cli, ...overrides, profile: selected };
}
function verifierFixture() {
  const work = root();
  const cache = path.join(work, 'cache');
  const sourceRoot = path.resolve(__dirname, '..', '..');
  for (const rel of ['.claude-plugin/plugin.json', '.claude-plugin/hooks/hooks.json', 'repo/scripts/toolkit-agent-control.cjs']) {
    const target = path.join(cache, ...rel.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(sourceRoot, ...rel.split('/')), target);
  }
  const entry = { id: pluginSetup.pluginId(), version: control.CONTROL_VERSION, enabled: true, trusted: true, hooksActive: true, installPath: cache };
  const statePath = path.join(work, 'claude-state.json');
  fs.writeFileSync(statePath, `${JSON.stringify(entry, null, 2)}\n`);
  const cli = path.join(work, 'fake-claude.cjs');
  fs.writeFileSync(cli, `'use strict';\nconst fs=require('node:fs');const args=process.argv.slice(2);const entry=JSON.parse(fs.readFileSync(${JSON.stringify(statePath)},'utf8'));if(args[0]==='--version'){process.stdout.write('claude fake\\n');process.exit(0);}if(args[0]==='plugin'&&args[1]==='list'){process.stdout.write(JSON.stringify({installed:[entry]})+'\\n');process.exit(0);}process.exit(9);\n`);
  const proof = pluginSetup.installedActivationProof(entry, control.CONTROL_VERSION);
  return { work, cache, cli, entry, statePath, proof };
}
function enforcementFixture() {
  const fixture = verifierFixture();
  const { work, proof } = fixture;
  control.configureProfile('claude-code', configured(control.TOPOLOGIES.CLAUDE_DIRECT, control.CAPACITY_MODES.AUTO, { activation_proof: proof }), { root: work });
  return fixture;
}
defaultVerifier = verifierFixture();

test('C2 speed-only and non-productive parent requests remain root-only', () => {
  const result = control.admissionDecision(spec({ parent_responsibility: 'Wait for the child result.' }), verifiedOptions({ root: root(), resourceState: resources() }));
  assert.equal(result.result, control.RESULTS.REFUSE);
  assert.match(result.reason, /productive work|waiting/i);
});

test('genuine independent work starts with a reservation and productive-root evidence', () => {
  const work = root();
  const result = control.admissionDecision(spec(), verifiedOptions({ root: work, resourceState: resources() }));
  assert.equal(result.result, control.RESULTS.START);
  assert.equal(result.effort, 'medium');
  assert.equal(result.non_fast, 'CLAUDE_CODE_DISABLE_FAST_MODE=1');
  assert.equal(result.productive_parent, true);
  assert.equal(JSON.parse(fs.readFileSync(control.statePath({ root: work }), 'utf8')).reservations.length, 1);
});

test('delegating every substantive shard and duplicate parent work are rejected', () => {
  const options = verifiedOptions({ root: root(), resourceState: resources() });
  assert.equal(control.admissionDecision(spec({ delegates_all_substantive_work: true }), options).result, control.RESULTS.REFUSE);
  assert.equal(control.admissionDecision(spec({ parent_responsibility: spec().child_responsibility }), options).result, control.RESULTS.REFUSE);
});

test('pressure queues boundedly and unknown state refuses root-only', () => {
  const work = root();
  const pressured = resources({ physical_available: 8 * control.GIB, commit_available: 10 * control.GIB });
  const queued = control.admissionDecision(spec(), verifiedOptions({ root: work, resourceState: pressured }));
  assert.equal(queued.result, control.RESULTS.QUEUE);
  assert.ok(queued.expires_at_ms > Date.now());
  const critical = resources({ physical_available: control.GIB, commit_available: control.GIB });
  assert.equal(control.admissionDecision(spec({ queue_id: queued.queue_id }), verifiedOptions({ root: work, resourceState: critical })).result, control.RESULTS.REFUSE);
  assert.equal(control.admissionDecision(spec(), verifiedOptions({ root: root(), resourceState: null })).result, control.RESULTS.REFUSE);
  fs.writeFileSync(control.statePath({ root: work }), '{ malformed');
  assert.equal(control.admissionDecision(spec(), verifiedOptions({ root: work, resourceState: resources() })).result, control.RESULTS.REFUSE);
});

test('bounded queue retry keeps identity and starts only the oldest request after pressure clears', () => {
  const work = root();
  const queued = control.admissionDecision(spec(), verifiedOptions({ root: work, resourceState: resources({ physical_available: 8 * control.GIB, commit_available: 10 * control.GIB }) }));
  assert.equal(queued.result, control.RESULTS.QUEUE);
  const later = control.admissionDecision(spec(), verifiedOptions({ root: work, resourceState: resources() }));
  assert.equal(later.result, control.RESULTS.QUEUE);
  const admitted = control.admissionDecision(spec({ queue_id: queued.queue_id }), verifiedOptions({ root: work, resourceState: resources() }));
  assert.equal(admitted.result, control.RESULTS.START);
  const state = JSON.parse(fs.readFileSync(control.statePath({ root: work }), 'utf8'));
  assert.equal(state.queue.some((entry) => entry.id === queued.queue_id), false);
});

test('manual maximum is a backstop and never bypasses resource admission', () => {
  const work = root();
  const manual = profile({ capacity_mode: control.CAPACITY_MODES.MANUAL, manual_maximum: 1 });
  assert.equal(control.admissionDecision(spec(), verifiedOptions({ root: work, profile: manual, resourceState: resources() })).result, control.RESULTS.START);
  assert.equal(control.admissionDecision(spec(), verifiedOptions({ root: work, profile: manual, resourceState: resources() })).result, control.RESULTS.QUEUE);
});

test('atomic admission prevents two concurrent parents from consuming one manual slot', async () => {
  const work = root();
  control.configureProfile('claude-code', configured(control.TOPOLOGIES.CLAUDE_DIRECT, control.CAPACITY_MODES.MANUAL, { manual_maximum: 1 }), { root: work });
  const script = `const c=require(${JSON.stringify(path.join(__dirname, '..', 'scripts', 'toolkit-agent-control.cjs'))});const s=${JSON.stringify(spec())};const r=${JSON.stringify(resources())};console.log(c.admissionDecision(s,{root:${JSON.stringify(work)},resourceState:r,claudeCli:${JSON.stringify(defaultVerifier.cli)}}).result)`;
  const run = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', script], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr)));
  });
  const results = await Promise.all([run(), run()]);
  assert.deepEqual(results.sort(), ['queue', 'start']);
});

test('stale dead reservations recover but live ownership is preserved', () => {
  const work = root();
  fs.mkdirSync(path.dirname(control.statePath({ root: work })), { recursive: true });
  fs.writeFileSync(control.statePath({ root: work }), JSON.stringify({ schema: control.SCHEMA, reservations: [
    { id: 'dead', owner_pid: 99999999, expires_at_ms: 1 },
    { id: 'live', owner_pid: process.pid, expires_at_ms: 1 },
  ], queue: [] }));
  const state = control.recoverState(JSON.parse(fs.readFileSync(control.statePath({ root: work }), 'utf8')), Date.now());
  assert.deepEqual(state.reservations.map((entry) => entry.id), ['live']);
});

test('direct child defaults medium, disables fast, and blocks nested Agent and Task tools', () => {
  const invocation = control.claudeInvocation(spec());
  assert.deepEqual(invocation.raw_args.slice(0, 8), ['--print', '--output-format', 'json', '--effort', 'medium', '--disallowedTools', 'Agent', 'Task']);
  assert.equal(invocation.env.CLAUDE_CODE_DISABLE_FAST_MODE, '1');
  assert.equal(invocation.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS, '1');
  assert.throws(() => control.validateLaunchSpec(spec({ depth: 2 })), /blocks nested/i);
});

test('fast roots cannot propagate fast mode and unverifiable modes fail closed', () => {
  const old = process.env.CLAUDE_CODE_DISABLE_FAST_MODE;
  delete process.env.CLAUDE_CODE_DISABLE_FAST_MODE;
  const invocation = control.claudeInvocation(spec());
  assert.equal(invocation.env.CLAUDE_CODE_DISABLE_FAST_MODE, '1');
  if (old !== undefined) process.env.CLAUDE_CODE_DISABLE_FAST_MODE = old;
  assert.throws(() => control.validateLaunchSpec(spec({ effort: 'low' })), /medium/i);
});

test('higher effort is isolated to a named justified role', () => {
  assert.throws(() => control.validateLaunchSpec(spec({ effort: 'high' })), /named difficult role/i);
  const high = spec({ effort: 'high', difficult_role: 'protocol auditor', effort_justification: 'The narrow protocol proof crosses three state machines.' });
  const work = root();
  assert.equal(control.admissionDecision(high, verifiedOptions({ root: work, resourceState: resources() })).result, 'start');
  assert.equal(control.admissionDecision(high, verifiedOptions({ root: work, resourceState: resources() })).result, 'refuse-root-only');
});

test('root-only and broader-native profiles never claim Toolkit admission coverage', () => {
  for (const topology of [control.TOPOLOGIES.ROOT_ONLY, control.TOPOLOGIES.BROADER_NATIVE]) {
    const result = control.admissionDecision(spec(), verifiedOptions({ root: root(), profile: profile({ topology }), resourceState: resources() }));
    assert.equal(result.result, control.RESULTS.REFUSE);
  }
});

test('Claude hook denies native Agent under root/direct profiles and allows broader native behavior', () => {
  for (const topology of [control.TOPOLOGIES.ROOT_ONLY, control.TOPOLOGIES.CLAUDE_DIRECT]) {
    const work = root();
    const capacityMode = topology === control.TOPOLOGIES.CLAUDE_DIRECT ? control.CAPACITY_MODES.AUTO : control.CAPACITY_MODES.ROOT_ONLY;
    control.configureProfile('claude-code', configured(topology, capacityMode), { root: work });
    assert.equal(hook.decision({ tool_name: 'Agent' }, { root: work }).hookSpecificOutput.permissionDecision, 'deny');
  }
  const work = root();
  control.configureProfile('claude-code', { topology: control.TOPOLOGIES.BROADER_NATIVE, capacity_mode: control.CAPACITY_MODES.ROOT_ONLY }, { root: work });
  assert.deepEqual(hook.decision({ tool_name: 'Agent' }, { root: work }), {});
});

test('Codex and Claude profile state is isolated', () => {
  const work = root();
  control.configureProfile('claude-code', configured(control.TOPOLOGIES.CLAUDE_DIRECT, control.CAPACITY_MODES.AUTO), { root: work });
  assert.equal(control.readProfile('codex', { root: work }).topology, control.TOPOLOGIES.ROOT_ONLY);
  assert.equal(control.readProfile('claude-code', { root: work }).topology, control.TOPOLOGIES.CLAUDE_DIRECT);
});

test('aggregate reserved memory is subtracted under the admission lock', async () => {
  const work = root();
  const expensive = spec({ estimated_memory_bytes: 7 * control.GIB });
  const options = verifiedOptions({ root: work, resourceState: resources() });
  assert.equal(control.admissionDecision(expensive, options).result, control.RESULTS.START);
  assert.equal(control.admissionDecision(expensive, options).result, control.RESULTS.QUEUE);

  const raceRoot = root();
  control.configureProfile('claude-code', configured(control.TOPOLOGIES.CLAUDE_DIRECT, control.CAPACITY_MODES.AUTO), { root: raceRoot });
  const script = `const c=require(${JSON.stringify(path.join(__dirname, '..', 'scripts', 'toolkit-agent-control.cjs'))});const s=${JSON.stringify(expensive)};const r=${JSON.stringify(resources())};console.log(c.admissionDecision(s,{root:${JSON.stringify(raceRoot)},resourceState:r,claudeCli:${JSON.stringify(defaultVerifier.cli)}}).result)`;
  const run = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', script], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr)));
  });
  assert.deepEqual((await Promise.all([run(), run()])).sort(), ['queue', 'start']);
});

test('malformed reservation costs fail closed instead of becoming free capacity', () => {
  const work = root();
  fs.mkdirSync(path.dirname(control.statePath({ root: work })), { recursive: true });
  fs.writeFileSync(control.statePath({ root: work }), JSON.stringify({
    schema: control.SCHEMA,
    reservations: [{ id: 'bad', owner_pid: process.pid, created_at_ms: 1, expires_at_ms: Date.now() + 10000, estimated_memory_bytes: -1 }],
    queue: [],
  }));
  assert.equal(control.admissionDecision(spec(), verifiedOptions({ root: work, resourceState: resources() })).result, control.RESULTS.REFUSE);
});

test('complete profile validation rejects corrupted, partial, future, unknown and contradictory state', () => {
  const cases = [
    '{',
    JSON.stringify({ schema: control.SCHEMA, host: 'claude-code' }),
    JSON.stringify({ ...profile(), schema: control.SCHEMA + 1 }),
    JSON.stringify({ ...profile(), topology: 'future-topology' }),
    JSON.stringify({ ...profile(), worker_estimate_bytes: -1 }),
    JSON.stringify({ ...profile(), topology: control.TOPOLOGIES.ROOT_ONLY, capacity_mode: control.CAPACITY_MODES.AUTO }),
  ];
  for (const contents of cases) {
    const work = root();
    const target = control.profilePath('claude-code', { root: work });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
    const read = control.readProfile('claude-code', { root: work });
    assert.equal(read.topology, control.TOPOLOGIES.ROOT_ONLY);
    assert.equal(read.supported, false);
    assert.notEqual(read.status, 'configured');
    assert.equal(control.admissionDecision(spec(), { root: work, resourceState: resources() }).result, control.RESULTS.REFUSE);
  }
});

test('strict profiles require exact native activation proof and direct profiles require resource counters', () => {
  const work = root();
  assert.throws(() => control.configureProfile('claude-code', {
    topology: control.TOPOLOGIES.ROOT_ONLY, capacity_mode: control.CAPACITY_MODES.ROOT_ONLY, enforcement_verified: true,
  }, { root: work }), /trust and activation/i);
  assert.throws(() => control.configureProfile('claude-code', {
    topology: control.TOPOLOGIES.CLAUDE_DIRECT, capacity_mode: control.CAPACITY_MODES.AUTO,
    enforcement_verified: true, activation_proof: activationProof(),
  }, { root: work }), /resource counters/i);
  for (const bad of [null, activationProof({ plugin_version: 'old' }), activationProof({ cache_identity: 'bad' })]) {
    assert.equal(control.validActivationProof(bad), false);
  }
  assert.equal(control.validActivationProof(activationProof(), { cachePath: work, pluginVersion: control.CONTROL_VERSION }), false);
});

test('resource capability rejects unsupported malformed and overflowed states', () => {
  assert.equal(control.inspectResourceCapability({ resourceState: null }).supported, false);
  assert.equal(control.inspectResourceCapability({ resourceState: resources({ physical_available: Infinity }) }).supported, false);
  assert.equal(control.inspectResourceCapability({ resourceState: resources({ commit_available: Number.MAX_VALUE }) }).supported, false);
  assert.equal(control.inspectResourceCapability({ resourceState: resources() }).supported, true);
});

test('oversized Unicode prompts refuse before admission or artifact creation', () => {
  const work = root();
  const result = control.launch(spec({ child_prompt: `${'a'.repeat(control.MAX_PROMPT_BYTES - 2)}€` }), {
    root: work, claudeCli: path.join(work, 'fake.cjs'), profile: profile(), resourceState: resources(),
  });
  assert.equal(result.result, control.RESULTS.REFUSE);
  assert.notEqual(result.status, 'launched');
  assert.equal(fs.existsSync(control.statePath({ root: work })), false);
  assert.equal(fs.existsSync(path.join(work, 'jobs')), false);
  const exact = control.claudeInvocation(spec({ child_prompt: 'a'.repeat(control.MAX_PROMPT_BYTES) }));
  assert.equal(exact.stdin.length, control.MAX_PROMPT_BYTES);
});

test('direct admission revalidates current Claude trust, hooks and installed identities before reservation', () => {
  const cases = [
    ['disabled plugin', ({ entry }) => { entry.enabled = false; }],
    ['untrusted plugin', ({ entry }) => { entry.trusted = false; }],
    ['inactive hooks', ({ entry }) => { entry.hooksActive = false; }],
    ['changed hook bytes', ({ cache }) => { fs.appendFileSync(path.join(cache, '.claude-plugin', 'hooks', 'hooks.json'), ' '); }],
    ['changed controller bytes', ({ cache }) => { fs.appendFileSync(path.join(cache, 'repo', 'scripts', 'toolkit-agent-control.cjs'), '\n'); }],
    ['replayed proof for replaced cache', (fixture) => {
      const replacement = path.join(fixture.work, 'replacement-cache');
      fs.cpSync(fixture.cache, replacement, { recursive: true });
      fixture.entry.installPath = replacement;
    }],
  ];
  for (const [name, mutate] of cases) {
    const fixture = enforcementFixture();
    mutate(fixture);
    fs.writeFileSync(fixture.statePath, `${JSON.stringify(fixture.entry, null, 2)}\n`);
    const result = control.admissionDecision(spec(), { root: fixture.work, claudeCli: fixture.cli, resourceState: resources() });
    assert.equal(result.result, control.RESULTS.REFUSE, name);
    assert.match(result.reason, /current Claude plugin trust, hook activation, and installed enforcement identity/i, name);
    assert.equal(fs.existsSync(control.statePath({ root: fixture.work })), false, name);
    assert.equal(fs.existsSync(path.join(fixture.work, 'jobs')), false, name);
  }

  const current = enforcementFixture();
  const admitted = control.admissionDecision(spec(), { root: current.work, claudeCli: current.cli, resourceState: resources() });
  assert.equal(admitted.result, control.RESULTS.START);
  assert.equal(control.releaseReservation(admitted.reservation_id, { root: current.work }), true);
});

test('missing Claude executable forms refuse before admission or artifacts', () => {
  for (const executable of ['missing-claude-command-for-toolkit-test', ...['cjs', 'exe', 'cmd', 'bat'].map((ext) => path.join(root(), `missing-claude.${ext}`))]) {
    const work = root();
    const result = control.launch(spec(), verifiedOptions({ root: work, claudeCli: executable, resourceState: resources() }));
    assert.equal(result.result, control.RESULTS.REFUSE, executable);
    assert.notEqual(result.status, 'launched', executable);
    assert.equal(fs.existsSync(control.statePath({ root: work })), false, executable);
    assert.equal(fs.existsSync(path.join(work, 'jobs')), false, executable);
  }
});

test('broken Claude executable symlink refuses before admission or artifacts', { skip: process.platform === 'win32' }, (t) => {
  const work = root();
  const broken = path.join(work, 'broken-claude');
  try {
    fs.symlinkSync(path.join(work, 'missing-target'), broken);
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) return t.skip(`symlink creation is unavailable: ${error.code}`);
    throw error;
  }
  const result = control.launch(spec(), verifiedOptions({ root: work, claudeCli: broken, resourceState: resources() }));
  assert.equal(result.result, control.RESULTS.REFUSE);
  assert.notEqual(result.status, 'launched');
  assert.equal(fs.existsSync(control.statePath({ root: work })), false);
  assert.equal(fs.existsSync(path.join(work, 'jobs')), false);
});
