'use strict';

// The retired Toolkit direct launcher machinery survives only as the subject of the
// pinned Run-093/094 historical proof. These tests keep its retained safety invariants
// and prove it can no longer start anything but the harmless run093 fixture worker.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const Ajv2020 = require('ajv/dist/2020');
const control = require('../scripts/toolkit-agent-control.cjs');
const history = require('../scripts/toolkit-agent-control-run093-history.cjs');
const pluginSetup = require('../scripts/setup-claude-toolkit-plugin.cjs');
const resourceTest = require('./toolkit-resource-test-support.cjs');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'toolkit-agent-control.cjs');
const HISTORY_MODULE = path.join(__dirname, '..', 'scripts', 'toolkit-agent-control-run093-history.cjs');

function root() { return fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-agent-control-')); }
function resources(overrides = {}) { return { ...resourceTest.FIXTURE, ...overrides }; }
function spec(overrides = {}) {
  return {
    child_responsibility: 'Implement the isolated parser shard and its focused tests.',
    parent_responsibility: 'Reconcile interfaces and review the independent integration boundary.',
    integration_plan: 'The root owns interface reconciliation and final integration judgement.',
    validation_plan: 'The root runs cross-shard validation and reviews the final combined diff.',
    material_benefit: 'The shorter parser shard runs concurrently and reduces the implementation critical path.',
    tasks_separable: true,
    concurrent_execution_possible: true,
    expected_wall_clock_speedup: 'The shorter parser fixture completes while the root handles the longer integration task.',
    root_retains_longest_or_critical_path: true,
    child_task_is_shorter_or_easier: true,
    root_productive_work_declared: true,
    child_prompt: 'Implement only the isolated parser shard and report changed files and tests.',
    ...overrides,
  };
}
function capacity(overrides = {}) {
  return { capacity_mode: control.CAPACITY_MODES.AUTO, manual_maximum: 0, worker_estimate_bytes: control.DEFAULT_WORKER_COST, ...overrides };
}
// Admission inside the owned repository-test resource context, as the historical proof uses it.
function admit(work, selectedSpec = spec(), selectedProfile = capacity(), evidence = resources(), extra = {}) {
  resourceTest.registerOwnedRoot(work);
  return resourceTest.withFixture(work, () => control.resourceAdmissionDecision(selectedSpec, selectedProfile, evidence, resourceTest.options(work, extra)));
}
function state(work) { return JSON.parse(fs.readFileSync(control.statePath({ root: work }), 'utf8')); }

// The exact harmless worker the historical proof writes (createSupervisorFixture).
function fixtureWorker(work, { delayMs = 0, entry: entryOverrides = {}, witness = path.join(work, 'worker-witness.log') } = {}) {
  const cache = path.join(work, 'cache');
  for (const rel of ['.claude-plugin/plugin.json', '.claude-plugin/hooks/hooks.json', 'repo/scripts/toolkit-agent-control.cjs',
    'repo/scripts/claude-process-launch.cjs', 'repo/scripts/toolkit-claude-agent-hook.cjs']) {
    const target = path.join(cache, ...rel.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.resolve(__dirname, '..', '..', ...rel.split('/')), target);
  }
  const entry = { id: pluginSetup.pluginId(), version: control.CONTROL_VERSION, enabled: true, trusted: true, hooksActive: true, installPath: cache, ...entryOverrides };
  const cli = path.join(work, 'fake-claude.cjs');
  fs.writeFileSync(cli, [
    "'use strict';",
    "const fs=require('node:fs');",
    `const entry=${JSON.stringify(entry)};`,
    `const witness=${JSON.stringify(witness)};`,
    'const args=process.argv.slice(2);',
    "if(args[0]==='--version'){process.stdout.write('claude fake\\n');process.exit(0);}",
    "if(args[0]==='plugin'&&args[1]==='list'){process.stdout.write(JSON.stringify({installed:[entry]})+'\\n');process.exit(0);}",
    "fs.appendFileSync(witness,'worker-started\\n');",
    ...(delayMs > 0 ? [`Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,${delayMs});`] : []),
    "fs.appendFileSync(witness,'worker-completed\\n');",
    '',
  ].join('\n'), 'utf8');
  const proof = pluginSetup.installedActivationProof({ ...entry, installPath: cache }, control.CONTROL_VERSION);
  const profile = { schema: control.SCHEMA, host: 'claude-code', topology: control.TOPOLOGIES.CLAUDE_DIRECT,
    capacity_mode: control.CAPACITY_MODES.AUTO, manual_maximum: 0, worker_estimate_bytes: control.DEFAULT_WORKER_COST,
    queue_limit: control.MAX_QUEUE, reservation_limit: control.EMERGENCY_WORKER_CEILING, controller_version: control.CONTROL_VERSION,
    enforcement_verified: true, activation_proof: proof, claude_cli: cli, status: 'configured', supported: true };
  return { cache, cli, entry, witness, profile };
}
function assertNoResidue(work, name) {
  assert.equal(fs.existsSync(control.statePath({ root: work })), false, name);
  assert.equal(fs.existsSync(control.lockPath({ root: work })), false, name);
  assert.equal(fs.existsSync(path.join(work, 'jobs')), false, name);
}

test('launch and checkerWorkflow are retired and refuse with zero effects', () => {
  const work = root();
  const launched = control.launch(spec(), { root: work, profile: fixtureWorker(work).profile });
  assert.equal(launched.result, control.RESULTS.REFUSE);
  assert.match(launched.reason, /retired/i);
  const checked = control.checkerWorkflow({ implementation_complete: true }, { root: work });
  assert.equal(checked.status, control.CHECKER_RESULTS.ADMISSION_DENIED);
  assert.equal(checked.root_self_review_required, true);
  assertNoResidue(work, 'retired entrypoints');
});

test('native admission needs a caller-held historical profile and the verified fixture worker; nothing else is admitted', () => {
  const work = root();
  const fixture = fixtureWorker(work);
  const refusals = [
    ['no profile (the store never yields a direct one)', { root: work, claudeCli: fixture.cli }],
    ['root-only profile', { root: work, claudeCli: fixture.cli, profile: { ...fixture.profile, topology: control.TOPOLOGIES.ROOT_ONLY } }],
    ['broader-native profile', { root: work, claudeCli: fixture.cli, profile: { ...fixture.profile, topology: control.TOPOLOGIES.BROADER_NATIVE } }],
    ['bare claude executable', { root: work, claudeCli: 'claude', profile: fixture.profile }],
    ['node itself', { root: work, claudeCli: process.execPath, profile: fixture.profile }],
  ];
  for (const [name, options] of refusals) {
    const result = control.admissionDecision(spec(), options);
    assert.equal(result.result, control.RESULTS.REFUSE, name);
    assertNoResidue(work, name);
  }
});

test('the fixture-worker check accepts only the exact harmless template in the control root', () => {
  const work = root();
  const fixture = fixtureWorker(work, { delayMs: 1000 });
  assert.equal(history.verifiedFixtureWorker(fixture.cli, { root: work }), fixture.cli);
  assert.equal(history.verifiedFixtureWorker(fixture.cli, { root: root() }), null, 'outside the control root');
  const tampered = root();
  const tamperedFixture = fixtureWorker(tampered);
  fs.appendFileSync(tamperedFixture.cli, "require('node:child_process').execSync('claude');\n");
  assert.equal(history.verifiedFixtureWorker(tamperedFixture.cli, { root: tampered }), null, 'extra code');
  const elsewhere = root();
  const misdirected = fixtureWorker(elsewhere, { witness: path.join(os.tmpdir(), 'elsewhere.log') });
  assert.equal(history.verifiedFixtureWorker(misdirected.cli, { root: elsewhere }), null, 'witness outside the control root');
  const slow = root();
  const slowFixture = fixtureWorker(slow, { delayMs: 60_000 });
  assert.equal(history.verifiedFixtureWorker(slowFixture.cli, { root: slow }), null, 'unbounded delay');
  const renamed = root();
  const renamedFixture = fixtureWorker(renamed);
  const other = path.join(renamed, 'claude.cjs');
  fs.copyFileSync(renamedFixture.cli, other);
  assert.equal(history.verifiedFixtureWorker(other, { root: renamed }), null, 'another file name');
});

test('the supervisor refuses a stored worker that is not the verified fixture before any claim or execution', () => {
  const work = root();
  const reservation = '00000000-0000-4000-8000-000000000000';
  const jobs = path.join(work, 'jobs');
  fs.mkdirSync(jobs, { recursive: true });
  const fake = path.join(work, 'fake-claude.cjs');
  const witness = path.join(work, 'worker-witness.log');
  fs.writeFileSync(fake, `require('node:fs').appendFileSync(${JSON.stringify(witness)},'ran\\n');\n`);
  const stored = { ...history.validateLaunchSpec(spec()), child_prompt: undefined, child_prompt_base64: Buffer.from('x').toString('base64'), worker_executable: fake };
  const specPath = path.join(jobs, `${reservation}.json`);
  fs.writeFileSync(specPath, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
  const result = spawnSync(process.execPath, [SCRIPT, 'supervise', '--root', work, '--reservation', reservation, '--spec', specPath, '--claude-cli', fake], { encoding: 'utf8', windowsHide: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /retired/i);
  assert.equal(fs.existsSync(witness), false);
  assert.equal(fs.existsSync(control.statePath({ root: work })), false);
});

test('launch specifications carry no model route and admit only the worker role', () => {
  assert.equal(Object.hasOwn(history.validateLaunchSpec(spec()), 'model'), false);
  assert.throws(() => history.validateLaunchSpec(spec({ model: 'fable-5' })), /retired/i);
  assert.throws(() => history.validateLaunchSpec(spec({ role: 'checker' })), /retired/i);
  assert.throws(() => history.validateLaunchSpec(spec({ depth: 2 })), /blocks nested/i);
  assert.throws(() => history.validateLaunchSpec(spec({ effort: 'low' })), /medium/i);
  assert.throws(() => history.validateLaunchSpec(spec({ effort: 'high' })), /named difficult role/i);
  assert.throws(() => history.validateLaunchSpec(spec({ parent_responsibility: 'Wait for the child result.' })), /productive work|waiting/i);
  assert.throws(() => history.validateLaunchSpec(spec({ expected_wall_clock_speedup: '' })), /wall-clock speedup/i);
  assert.throws(() => history.validateLaunchSpec(spec({ tasks_separable: false })), /separable/i);
  assert.throws(() => history.validateLaunchSpec(spec({ concurrent_execution_possible: false })), /concurrently executable/i);
  assert.throws(() => history.validateLaunchSpec(spec({ root_retains_longest_or_critical_path: false })), /longest|critical-path/i);
  assert.throws(() => history.validateLaunchSpec(spec({ child_task_is_shorter_or_easier: false })), /shorter or easier/i);
  assert.throws(() => history.validateLaunchSpec(spec({ delegates_all_substantive_work: true })), /substantive/i);
  assert.throws(() => history.validateLaunchSpec(spec({ parent_responsibility: spec().child_responsibility })), /non-overlapping/i);
});

test('repository-test admission reserves, queues boundedly and keeps queue identity', () => {
  const work = root();
  const started = admit(work);
  assert.equal(started.result, control.RESULTS.START);
  assert.equal(Object.hasOwn(started, 'model'), false);
  assert.equal(state(work).reservations.length, 1);

  const queueRoot = root();
  const queued = admit(queueRoot, spec({ estimated_memory_bytes: 16 * control.GIB }));
  assert.equal(queued.result, control.RESULTS.QUEUE);
  const later = admit(queueRoot);
  assert.equal(later.result, control.RESULTS.QUEUE);
  const oldest = admit(queueRoot, spec({ queue_id: queued.queue_id }));
  assert.equal(oldest.result, control.RESULTS.START);
  assert.equal(state(queueRoot).queue.some((entry) => entry.id === queued.queue_id), false);
  const changed = admit(queueRoot, spec({ child_responsibility: 'Implement a different isolated parser shard with focused tests.', queue_id: later.queue_id }));
  assert.equal(changed.result, control.RESULTS.REFUSE, 'a queue ticket cannot be rebound to a different job');

  assert.equal(admit(root(), spec(), capacity(), resources({ physical_available: control.GIB })).result, control.RESULTS.REFUSE);
  const higher = root();
  const high = spec({ effort: 'high', difficult_role: 'protocol auditor', effort_justification: 'The narrow protocol proof crosses three state machines.' });
  assert.equal(admit(higher, high).result, control.RESULTS.START);
  assert.equal(admit(higher, high).result, control.RESULTS.REFUSE);
});

test('manual maximum is a restrictive backstop and malformed capacity profiles refuse before reserving', () => {
  const work = root();
  const manual = capacity({ capacity_mode: control.CAPACITY_MODES.MANUAL, manual_maximum: 1 });
  assert.equal(admit(work, spec(), manual).result, control.RESULTS.START);
  assert.equal(admit(work, spec(), manual).result, control.RESULTS.QUEUE);
  for (const malformed of [
    { capacity_mode: control.CAPACITY_MODES.MANUAL, worker_estimate_bytes: control.DEFAULT_WORKER_COST },
    { capacity_mode: control.CAPACITY_MODES.MANUAL, manual_maximum: 0, worker_estimate_bytes: control.DEFAULT_WORKER_COST },
    { capacity_mode: 'unverified', manual_maximum: 64, worker_estimate_bytes: control.DEFAULT_WORKER_COST },
    { capacity_mode: control.CAPACITY_MODES.ROOT_ONLY, manual_maximum: 0, worker_estimate_bytes: control.DEFAULT_WORKER_COST },
  ]) {
    const malformedRoot = root();
    const result = admit(malformedRoot, spec(), malformed);
    assert.equal(result.result, control.RESULTS.REFUSE);
    assert.equal(fs.existsSync(control.statePath({ root: malformedRoot })), false);
  }
});

test('Toolkit children cannot launch further workers', () => {
  const work = root();
  const result = admit(work, spec(), capacity(), resources(), { env: { ...process.env, AI_AGENT_TOOLKIT_CHILD: '1' } });
  assert.equal(result.result, control.RESULTS.REFUSE);
  assert.match(result.reason, /children cannot launch/i);
  assert.equal(fs.existsSync(control.statePath({ root: work })), false);
});

test('atomic admission subtracts aggregate reservations and serialises concurrent parents', async () => {
  const work = root();
  const expensive = spec({ estimated_memory_bytes: 3 * control.GIB });
  assert.equal(admit(work, expensive).result, control.RESULTS.START);
  assert.equal(admit(work, expensive).result, control.RESULTS.QUEUE);
  const manualRoot = root();
  const manual = capacity({ capacity_mode: control.CAPACITY_MODES.MANUAL, manual_maximum: 1 });
  const run = () => resourceTest.runAdmissionChild(spec(), manualRoot, manual).then((result) => result.result);
  assert.deepEqual((await Promise.all([run(), run()])).sort(), ['queue', 'start']);
});

test('stale dead reservations recover while live ownership is preserved and a sealed mode-0 reservation is never pruned', () => {
  const now = Date.now();
  const recovered = history.recoverState({ schema: control.SCHEMA, reservations: [
    { id: 'dead', owner_pid: 99999999, expires_at_ms: 1 },
    { id: 'live', owner_pid: process.pid, expires_at_ms: 1 },
    { id: 'mode0-unknown', owner_pid: 99999999, status: 'running', expires_at_ms: 1,
      producer_provenance: { schema: 'toolkit.agent-control.resource-provenance.v2', mode0_envelope: { dispatch_id: 'a'.repeat(64) } } },
  ], queue: [], checker_reviews: [] }, now);
  assert.deepEqual(recovered.reservations.map((entry) => entry.id), ['live', 'mode0-unknown']);
});

function reservation(id, overrides = {}) {
  const now = Date.now();
  return { id, host: 'claude-code', topology: 'toolkit-controlled-direct', depth: 1, role: 'worker',
    owner_pid: process.pid, created_at_ms: now, expires_at_ms: now + 60000,
    estimated_memory_bytes: control.DEFAULT_WORKER_COST, effort: 'medium', status: 'reserved', worker_executable: 'claude', ...overrides };
}
function writeState(work, contents) {
  const target = control.statePath({ root: work });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, typeof contents === 'string' ? contents : `${JSON.stringify(contents, null, 2)}\n`);
  return target;
}

test('an existing sealed mode-0 reservation holds the whole state byte-for-byte: no admission, release or replay', () => {
  const work = root();
  const target = writeState(work, { schema: control.SCHEMA, reservations: [reservation('mode0', {
    status: 'running', owner_pid: process.pid,
    producer_provenance: { schema: 'toolkit.agent-control.resource-provenance.v2', origin: 'native', resource_source: 'proc-meminfo',
      admission_id: '00000000-0000-4000-8000-000000000001', job_identity_digest: 'b'.repeat(64), mode0_envelope: { dispatch_id: 'a'.repeat(64) }, mac: 'c'.repeat(64) },
  })], queue: [], checker_reviews: [] });
  const before = fs.readFileSync(target);
  assert.equal(admit(work).result, control.RESULTS.REFUSE);
  assert.equal(control.releaseReservation('mode0', { root: work }), false);
  assert.deepEqual(fs.readFileSync(target), before);
});

test('reservation release preserves malformed, future, invalid and duplicate state bytes and touches only its own entry', () => {
  for (const invalid of [
    '{ malformed',
    { schema: control.SCHEMA + 1, reservations: [reservation('target')], queue: [] },
    { schema: control.SCHEMA, reservations: [reservation('target'), reservation('bad', { owner_pid: -1 })], queue: [] },
    { schema: control.SCHEMA, reservations: [reservation('target')], queue: [{ id: '', created_at_ms: 1, expires_at_ms: 2 }] },
    { schema: control.SCHEMA, reservations: [reservation('target'), reservation('target')], queue: [] },
  ]) {
    const work = root();
    const target = writeState(work, invalid);
    const before = fs.readFileSync(target);
    assert.equal(control.releaseReservation('target', { root: work }), false);
    assert.deepEqual(fs.readFileSync(target), before);
    assert.equal(admit(work).result, control.RESULTS.REFUSE);
  }
  const work = root();
  const target = writeState(work, { schema: control.SCHEMA, reservations: [reservation('target'), reservation('other')], queue: [] });
  const beforeMissing = fs.readFileSync(target);
  assert.equal(control.releaseReservation('missing', { root: work }), false);
  assert.deepEqual(fs.readFileSync(target), beforeMissing);
  assert.equal(control.releaseReservation('target', { root: work }), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(target, 'utf8')).reservations.map((entry) => entry.id), ['other']);
});

test('malformed reservation costs fail closed instead of becoming free capacity', () => {
  const work = root();
  writeState(work, { schema: control.SCHEMA, reservations: [{ id: 'bad', owner_pid: process.pid, created_at_ms: 1, expires_at_ms: Date.now() + 10000, estimated_memory_bytes: -1 }], queue: [] });
  assert.equal(admit(work).result, control.RESULTS.REFUSE);
});

test('Linux native resource collection uses proc-meminfo without fixture context', { skip: process.platform !== 'linux' }, () => {
  const sample = control.inspectResources();
  assert.ok(sample);
  assert.equal(sample.source, 'proc-meminfo');
  assert.equal(Object.hasOwn(sample, 'fixture_id'), false);
  for (const field of ['physical_total', 'physical_available', 'commit_total', 'commit_available']) assert.equal(Number.isSafeInteger(sample[field]), true, field);
  assert.ok(sample.physical_available <= sample.physical_total);
  const capability = control.inspectResourceCapability();
  assert.equal(capability.supported, true);
  assert.equal(capability.source, 'proc-meminfo');
  assert.equal(capability.resources.physical_total, sample.physical_total);
});

test('Windows native resource collection uses operating-system counters without fixture context', { skip: process.platform !== 'win32' }, () => {
  const sample = control.inspectResources();
  assert.ok(sample);
  assert.equal(sample.source, 'win32-operating-system');
  assert.equal(Object.hasOwn(sample, 'fixture_id'), false);
  for (const field of ['physical_total', 'physical_available', 'commit_total', 'commit_available']) {
    assert.equal(Number.isSafeInteger(sample[field]), true, field);
    assert.ok(sample[field] > 0, field);
  }
});

test('the signed Linux parser accepts exact subtraction and rejects malformed or unstable observations', () => {
  const sample = ['MemTotal: 4096 kB', 'MemAvailable: 0 kB', 'CommitLimit: 100 kB', 'Committed_AS: 200 kB'].join('\n');
  const parsed = history.parseLinuxMeminfoCounters(0, sample, 0);
  assert.deepEqual({ physical_total: parsed.physical_total, physical_available: parsed.physical_available, commit_total: parsed.commit_total,
    commit_available: parsed.commit_available, overcommit_mode: parsed.overcommit_mode },
  { physical_total: 4194304, physical_available: 0, commit_total: 102400, commit_available: -102400, overcommit_mode: 0 });
  assert.equal(control.inspectResources({ resourceState: parsed }), null, 'pure parser data cannot acquire native branding');
  for (const source of [
    sample.replace('MemAvailable: 0 kB\n', ''),
    `${sample}\nMemTotal: 4096 kB`,
    `${sample}\nCommitted_AS: -1 kB`,
    sample.replace('CommitLimit: 100 kB', 'CommitLimit: -100 kB'),
    sample.replace('Committed_AS: 200 kB', 'Committed_AS: 200 MB'),
    sample.replace('MemTotal: 4096 kB', 'MemTotal: 9007199254740992 kB'),
  ]) assert.throws(() => history.parseLinuxMeminfoCounters(0, source, 0));
  assert.throws(() => history.parseLinuxMeminfoCounters(0, sample, 2), /changed/i);
  assert.throws(() => history.parseLinuxMeminfoCounters(3, sample, 3), /unsupported/i);
});

test('the resource evidence schema preserves native and repository-test provenance without coercion', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'contracts', 'controller-kernel', 'resource-evidence-v1.schema.json'), 'utf8'));
  const ajv = new Ajv2020({ strict: true, allErrors: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
  const validateEvidence = ajv.compile(schema);
  const validateInvocation = ajv.compile({ ...schema.$defs.repositoryTestInvocation, $schema: schema.$schema });
  assert.equal(validateEvidence(resourceTest.FIXTURE), true, JSON.stringify(validateEvidence.errors));
  assert.equal(validateEvidence({ ...resourceTest.FIXTURE, source: 'proc-meminfo' }), false);
  assert.equal(validateEvidence({ ...resourceTest.FIXTURE, extra: true }), false);
  assert.equal(validateEvidence({ ...resourceTest.FIXTURE, physical_available: '8589934592' }), false);
  const linuxSigned = { source: 'proc-meminfo', physical_total: 1, physical_available: 0, commit_total: 0, commit_available: -Number.MAX_SAFE_INTEGER, host_responsive: true };
  assert.equal(validateEvidence(linuxSigned), true, JSON.stringify(validateEvidence.errors));
  assert.equal(validateEvidence({ ...linuxSigned, commit_available: -Number.MAX_SAFE_INTEGER - 1 }), false);
  assert.equal(validateInvocation(resourceTest.INVOCATION), true, JSON.stringify(validateInvocation.errors));
  assert.equal(validateInvocation({ ...resourceTest.INVOCATION, extra: true }), false);
});

test('repository-test resource evidence is private to its owned context and cannot be smuggled in', () => {
  const work = root();
  const outside = control.resourceAdmissionDecision(spec(), capacity(), resourceTest.FIXTURE, { root: work });
  assert.equal(outside.result, control.RESULTS.REFUSE);
  assert.equal(fs.existsSync(control.statePath({ root: work })), false);
  const fixture = resourceTest.FIXTURE;
  for (const options of [{ resourceState: fixture }, { resourceState: null }, { resource_state: undefined }, { resourceState: fixture, resource_state: fixture },
    { resource: fixture }, { resources: fixture }, { resourceState: { ...fixture, source: 'proc-meminfo' } }]) {
    assert.equal(control.inspectResources(options), null);
  }
  let accessorCalls = 0;
  const accessor = {};
  Object.defineProperty(accessor, 'resourceState', { enumerable: true, get() { accessorCalls += 1; return fixture; } });
  assert.equal(control.inspectResources(accessor), null);
  const counters = { get: 0, ownKeys: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0 };
  const proxy = new Proxy({ resourceState: fixture }, {
    get(target, key, receiver) { counters.get += 1; return Reflect.get(target, key, receiver); },
    ownKeys(target) { counters.ownKeys += 1; return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor(target, key) { counters.getOwnPropertyDescriptor += 1; return Reflect.getOwnPropertyDescriptor(target, key); },
    getPrototypeOf(target) { counters.getPrototypeOf += 1; return Reflect.getPrototypeOf(target); },
  });
  assert.equal(control.inspectResources(proxy), null);
  assert.deepEqual(counters, { get: 0, ownKeys: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0 });
  assert.equal(accessorCalls, 0);
  for (const nodeOptions of ['', `--require=${path.join(work, 'preload.cjs')}`]) {
    fs.writeFileSync(path.join(work, 'preload.cjs'), `globalThis.__toolkitRepositoryTestResource=true;process.env.TOOLKIT_REPOSITORY_TEST_RESOURCE=${JSON.stringify(JSON.stringify(resourceTest.INVOCATION))};`);
    const childRoot = root();
    const script = `const c=require(${JSON.stringify(SCRIPT)});console.log(c.resourceAdmissionDecision(${JSON.stringify(spec())},${JSON.stringify(capacity())},${JSON.stringify(fixture)},{root:${JSON.stringify(childRoot)}}).result)`;
    const child = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', windowsHide: true, env: { ...process.env, NODE_OPTIONS: nodeOptions, NODE_PATH: '' } });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout.trim(), control.RESULTS.REFUSE);
    assert.equal(fs.existsSync(control.statePath({ root: childRoot })), false);
  }
  assert.equal(control.inspectResourceCapability({ resourceState: null }).supported, false);
});

function createLockDirectory(work, owner, ageMs = 0) {
  const target = control.lockPath({ root: work });
  fs.mkdirSync(target, { recursive: true });
  if (owner !== undefined) fs.writeFileSync(path.join(target, 'owner.json'), typeof owner === 'string' ? owner : JSON.stringify(owner), { mode: 0o600 });
  if (ageMs) { const old = new Date(Date.now() - ageMs); fs.utimesSync(target, old, old); }
  return target;
}
function createRecoveryMarker(work, owner, ageMs = 0, displaced = false) {
  const target = history.lockRecoveryPath({ root: work });
  fs.mkdirSync(target, { recursive: true });
  if (owner !== undefined) fs.writeFileSync(path.join(target, 'owner.json'), typeof owner === 'string' ? owner : JSON.stringify(owner), { mode: 0o600 });
  if (displaced) fs.mkdirSync(path.join(target, 'stale-lock'));
  if (ageMs) { const old = new Date(Date.now() - ageMs); fs.utimesSync(target, old, old); }
  return target;
}
function contenders(work, log) {
  const script = `const fs=require('node:fs');const c=require(${JSON.stringify(HISTORY_MODULE)});const release=c.acquireLock({root:${JSON.stringify(work)},lockWaitMs:5000});fs.appendFileSync(${JSON.stringify(log)},'start\\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,100);fs.appendFileSync(${JSON.stringify(log)},'end\\n');release();`;
  const run = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', script], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(stderr)));
  });
  return Promise.all([run(), run()]);
}

test('fresh and live-owner locks and recovery markers stay protected', () => {
  const staleAge = history.LOCK_TTL_MS + 2000;
  for (const owner of [undefined, '{ malformed']) {
    const work = root();
    const target = createLockDirectory(work, owner);
    assert.throws(() => history.acquireLock({ root: work, lockWaitMs: 30 }), /temporarily busy/i);
    assert.equal(fs.existsSync(target), true);
  }
  const liveRoot = root();
  const live = createLockDirectory(liveRoot, { pid: process.pid, created_at_ms: Date.now() - staleAge, token: 'live' }, staleAge);
  assert.throws(() => history.acquireLock({ root: liveRoot, lockWaitMs: 30 }), /temporarily busy/i);
  assert.equal(fs.existsSync(live), true);
  for (const fixture of [{ owner: undefined, age: 0 }, { owner: '{ malformed', age: 0 }, { owner: { pid: process.pid, created_at_ms: Date.now() - staleAge, token: 'live' }, age: staleAge }]) {
    const work = root();
    const marker = createRecoveryMarker(work, fixture.owner, fixture.age);
    assert.throws(() => history.acquireLock({ root: work, lockWaitMs: 30 }), /temporarily busy/i);
    assert.equal(fs.existsSync(marker), true);
  }
});

test('stale ownerless, malformed and dead-owner locks and recovery markers recover without residue', () => {
  const staleAge = history.LOCK_TTL_MS + 2000;
  for (const owner of [undefined, '{ malformed', { pid: -1, created_at_ms: 'bad' }, { pid: 99999999, created_at_ms: Date.now() - staleAge }]) {
    const work = root();
    const target = createLockDirectory(work, owner, staleAge);
    history.acquireLock({ root: work, lockWaitMs: 200 })();
    assert.equal(fs.existsSync(target), false);
    assert.equal(fs.existsSync(history.lockRecoveryPath({ root: work })), false);
  }
  for (const owner of [{ pid: 99999999, created_at_ms: Date.now() - staleAge, token: 'dead' }, undefined, '{ malformed']) {
    const work = root();
    createRecoveryMarker(work, owner, staleAge, true);
    history.acquireLock({ root: work, lockWaitMs: 200 })();
    assert.equal(fs.existsSync(history.lockRecoveryPath({ root: work })), false);
    assert.equal(fs.existsSync(control.lockPath({ root: work })), false);
  }
});

test('stale lock and recovery-marker contenders remain mutually exclusive', async () => {
  const lockRoot = root();
  createLockDirectory(lockRoot, undefined, history.LOCK_TTL_MS + 2000);
  await contenders(lockRoot, path.join(lockRoot, 'critical.log'));
  assert.deepEqual(fs.readFileSync(path.join(lockRoot, 'critical.log'), 'utf8').trim().split(/\r?\n/), ['start', 'end', 'start', 'end']);
  assert.equal(fs.existsSync(control.lockPath({ root: lockRoot })), false);
  const markerRoot = root();
  createRecoveryMarker(markerRoot, undefined, history.LOCK_TTL_MS + 2000, true);
  await contenders(markerRoot, path.join(markerRoot, 'recovery.log'));
  assert.deepEqual(fs.readFileSync(path.join(markerRoot, 'recovery.log'), 'utf8').trim().split(/\r?\n/), ['start', 'end', 'start', 'end']);
  assert.equal(fs.existsSync(history.lockRecoveryPath({ root: markerRoot })), false);
});
