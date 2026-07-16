'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const control = require('../scripts/toolkit-agent-control.cjs');
const hook = require('../scripts/toolkit-claude-agent-hook.cjs');

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
function configured(topology, capacity_mode, overrides = {}) {
  return { topology, capacity_mode, enforcement_verified: true, activation_proof: activationProof(),
    resource_counter_supported: topology === control.TOPOLOGIES.CLAUDE_DIRECT,
    resource_counter_source: topology === control.TOPOLOGIES.CLAUDE_DIRECT ? 'win32-operating-system' : 'not-applicable', ...overrides };
}
function profile(overrides = {}) {
  return { schema: control.SCHEMA, host: 'claude-code', topology: control.TOPOLOGIES.CLAUDE_DIRECT,
    capacity_mode: control.CAPACITY_MODES.AUTO, manual_maximum: 0, worker_estimate_bytes: control.DEFAULT_WORKER_COST,
    queue_limit: control.MAX_QUEUE, reservation_limit: control.EMERGENCY_WORKER_CEILING,
    controller_version: control.CONTROL_VERSION, enforcement_verified: true, status: 'configured', supported: true, ...overrides };
}

test('C2 speed-only and non-productive parent requests remain root-only', () => {
  const result = control.admissionDecision(spec({ parent_responsibility: 'Wait for the child result.' }), { root: root(), profile: profile(), resourceState: resources() });
  assert.equal(result.result, control.RESULTS.REFUSE);
  assert.match(result.reason, /productive work|waiting/i);
});

test('genuine independent work starts with a reservation and productive-root evidence', () => {
  const work = root();
  const result = control.admissionDecision(spec(), { root: work, profile: profile(), resourceState: resources() });
  assert.equal(result.result, control.RESULTS.START);
  assert.equal(result.effort, 'medium');
  assert.equal(result.non_fast, 'CLAUDE_CODE_DISABLE_FAST_MODE=1');
  assert.equal(result.productive_parent, true);
  assert.equal(JSON.parse(fs.readFileSync(control.statePath({ root: work }), 'utf8')).reservations.length, 1);
});

test('delegating every substantive shard and duplicate parent work are rejected', () => {
  const options = { root: root(), profile: profile(), resourceState: resources() };
  assert.equal(control.admissionDecision(spec({ delegates_all_substantive_work: true }), options).result, control.RESULTS.REFUSE);
  assert.equal(control.admissionDecision(spec({ parent_responsibility: spec().child_responsibility }), options).result, control.RESULTS.REFUSE);
});

test('pressure queues boundedly and unknown state refuses root-only', () => {
  const work = root();
  const pressured = resources({ physical_available: 8 * control.GIB, commit_available: 10 * control.GIB });
  const queued = control.admissionDecision(spec(), { root: work, profile: profile(), resourceState: pressured });
  assert.equal(queued.result, control.RESULTS.QUEUE);
  assert.ok(queued.expires_at_ms > Date.now());
  const critical = resources({ physical_available: control.GIB, commit_available: control.GIB });
  assert.equal(control.admissionDecision(spec({ queue_id: queued.queue_id }), { root: work, profile: profile(), resourceState: critical }).result, control.RESULTS.REFUSE);
  assert.equal(control.admissionDecision(spec(), { root: root(), profile: profile(), resourceState: null }).result, control.RESULTS.REFUSE);
  fs.writeFileSync(control.statePath({ root: work }), '{ malformed');
  assert.equal(control.admissionDecision(spec(), { root: work, profile: profile(), resourceState: resources() }).result, control.RESULTS.REFUSE);
});

test('bounded queue retry keeps identity and starts only the oldest request after pressure clears', () => {
  const work = root();
  const queued = control.admissionDecision(spec(), { root: work, profile: profile(), resourceState: resources({ physical_available: 8 * control.GIB, commit_available: 10 * control.GIB }) });
  assert.equal(queued.result, control.RESULTS.QUEUE);
  const later = control.admissionDecision(spec(), { root: work, profile: profile(), resourceState: resources() });
  assert.equal(later.result, control.RESULTS.QUEUE);
  const admitted = control.admissionDecision(spec({ queue_id: queued.queue_id }), { root: work, profile: profile(), resourceState: resources() });
  assert.equal(admitted.result, control.RESULTS.START);
  const state = JSON.parse(fs.readFileSync(control.statePath({ root: work }), 'utf8'));
  assert.equal(state.queue.some((entry) => entry.id === queued.queue_id), false);
});

test('manual maximum is a backstop and never bypasses resource admission', () => {
  const work = root();
  const manual = profile({ capacity_mode: control.CAPACITY_MODES.MANUAL, manual_maximum: 1 });
  assert.equal(control.admissionDecision(spec(), { root: work, profile: manual, resourceState: resources() }).result, control.RESULTS.START);
  assert.equal(control.admissionDecision(spec(), { root: work, profile: manual, resourceState: resources() }).result, control.RESULTS.QUEUE);
});

test('atomic admission prevents two concurrent parents from consuming one manual slot', async () => {
  const work = root();
  control.configureProfile('claude-code', configured(control.TOPOLOGIES.CLAUDE_DIRECT, control.CAPACITY_MODES.MANUAL, { manual_maximum: 1 }), { root: work });
  const script = `const c=require(${JSON.stringify(path.join(__dirname, '..', 'scripts', 'toolkit-agent-control.cjs'))});const s=${JSON.stringify(spec())};const r=${JSON.stringify(resources())};console.log(c.admissionDecision(s,{root:${JSON.stringify(work)},resourceState:r}).result)`;
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

test('direct child defaults medium, disables fast, and blocks nested Agent tools', () => {
  const invocation = control.claudeInvocation(spec());
  assert.deepEqual(invocation.raw_args.slice(0, 7), ['--print', '--output-format', 'json', '--effort', 'medium', '--disallowedTools', 'Agent']);
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
  assert.equal(control.admissionDecision(high, { root: work, profile: profile(), resourceState: resources() }).result, 'start');
  assert.equal(control.admissionDecision(high, { root: work, profile: profile(), resourceState: resources() }).result, 'refuse-root-only');
});

test('root-only and broader-native profiles never claim Toolkit admission coverage', () => {
  for (const topology of [control.TOPOLOGIES.ROOT_ONLY, control.TOPOLOGIES.BROADER_NATIVE]) {
    const result = control.admissionDecision(spec(), { root: root(), profile: profile({ topology }), resourceState: resources() });
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
  const options = { root: work, profile: profile(), resourceState: resources() };
  assert.equal(control.admissionDecision(expensive, options).result, control.RESULTS.START);
  assert.equal(control.admissionDecision(expensive, options).result, control.RESULTS.QUEUE);

  const raceRoot = root();
  control.configureProfile('claude-code', configured(control.TOPOLOGIES.CLAUDE_DIRECT, control.CAPACITY_MODES.AUTO), { root: raceRoot });
  const script = `const c=require(${JSON.stringify(path.join(__dirname, '..', 'scripts', 'toolkit-agent-control.cjs'))});const s=${JSON.stringify(expensive)};const r=${JSON.stringify(resources())};console.log(c.admissionDecision(s,{root:${JSON.stringify(raceRoot)},resourceState:r}).result)`;
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
  assert.equal(control.admissionDecision(spec(), { root: work, profile: profile(), resourceState: resources() }).result, control.RESULTS.REFUSE);
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
