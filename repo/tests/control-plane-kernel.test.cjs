'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const moduleApi = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..', '..');
const runtimePath = path.join(repoRoot, 'repo', 'scripts', 'toolkit-control-plane', 'control-plane-kernel.cjs');
const schemaPath = path.join(repoRoot, '_projects', 'development', 'control-plane-kernel', '_main', 'control-plane-contract.schema.json');
const policyPath = path.join(repoRoot, '_projects', 'development', 'control-plane-kernel', '_main', 'control-plane-policy.json');
const fixtureManifestPath = path.join(repoRoot, '_projects', 'development', 'control-plane-kernel', '_main', 'fixtures', 'fixture-manifest.json');
const fixtureCounts = new Map();

const TEST_ONLY_AUTHORITY = '__testCreateTrustedAuthorityContext';
const TEST_ONLY_OBSERVE = '__testObserveRoot';
const ROOT = 'C:\\fixture\\workspace\\repo';
const WORKTREE = `${ROOT}\\worktree`;
const REMOTE = 'https://github.com/weijunswj/ai-agent-toolkit.git';
const NOW = '2026-08-16T14:00:00.000Z';
const AUTHORIZED_REF = 'refs/heads/topic';

function mark(...ids) {
  for (const id of ids) fixtureCounts.set(id, (fixtureCounts.get(id) || 0) + 1);
}

function loadInstrumentedKernel() {
  const source = fs.readFileSync(runtimePath, 'utf8');
  const marker = 'module.exports = publicApi;';
  assert.ok(source.includes(marker));
  const instrumented = source.replace(marker, `publicApi.${TEST_ONLY_AUTHORITY} = createTrustedAuthorityContext;\npublicApi.${TEST_ONLY_OBSERVE} = observeRoot;\n${marker}`);
  const testModule = { exports: {} };
  const wrapper = vm.runInThisContext(`(function (exports, require, module, __filename, __dirname) {\n${instrumented}\n})`, { filename: `${runtimePath} [test-harness]` });
  wrapper(testModule.exports, moduleApi.createRequire(runtimePath), testModule, runtimePath, path.dirname(runtimePath));
  assert.equal(typeof testModule.exports[TEST_ONLY_AUTHORITY], 'function');
  assert.equal(typeof testModule.exports[TEST_ONLY_OBSERVE], 'function');
  return testModule.exports;
}

const productionKernel = require(runtimePath);
const kernel = loadInstrumentedKernel();
const rawEvaluate = kernel.evaluate;

const TRUSTED_CONTROLLER = {
  role: 'controller',
  identity: 'controller-fixture',
  provider: 'OpenAI',
  model: 'GPT-5.6 Luna / Max',
  assignment: 'run-133-a1-soir-r1-g3-133',
  finality_claim: false,
  allowed_operation_types: [
    'filesystem.read', 'filesystem.write', 'filesystem.create', 'filesystem.move', 'filesystem.delete',
    'git.read', 'git.branch', 'git.push', 'github.read', 'github.mutation', 'network.request',
    'external.mutation', 'compound', 'shell',
  ],
};

function trustedRootContext(overrides = {}) {
  const root = overrides.root || ROOT;
  const worktree = overrides.worktree || `${root}\\worktree`;
  const remote = overrides.remote || REMOTE;
  return {
    repository_identity: `${root}|${worktree}|${remote}`,
    root,
    worktree,
    remote,
    authorized_remote: overrides.authorized_remote || 'origin',
    authorized_ref: overrides.authorized_ref || AUTHORIZED_REF,
    live_server_ref_sha: overrides.live_server_ref_sha || 'a'.repeat(40),
  };
}

function createTrustedAuthority(options = {}) {
  const authority = { ...TRUSTED_CONTROLLER, ...(options.authority || {}) };
  const rootContext = options.root_context || trustedRootContext();
  const { authority: _ignored, root_context: _rootIgnored, ...storeOptions } = options;
  return kernel[TEST_ONLY_AUTHORITY](authority, { now: () => Date.parse(NOW), root_context: rootContext, ...storeOptions });
}

function target(relativePath, overrides = {}) {
  const full = relativePath.startsWith(ROOT) ? relativePath : `${ROOT}\\${relativePath}`;
  return {
    path: full,
    resolution: { status: 'resolved', canonical_path: full, link_type: 'none', ...overrides },
  };
}

function readOperation(relativePath = 'src\\file.txt') {
  return { type: 'filesystem.read', target: target(relativePath) };
}

function baseInput(operation, overrides = {}) {
  return {
    enabled: true,
    activation: { mode: 'explicit-local', consented: true },
    now: NOW,
    repository: {
      root: ROOT,
      worktree: WORKTREE,
      remote: REMOTE,
      resolution: { status: 'resolved', link_type: 'none' },
    },
    authority: {
      role: 'executor',
      identity: 'executor-fixture',
      provider: 'OpenAI',
      model: 'GPT-5.6 Luna / Max',
      assignment: 'run-133-a1-soir-r1-g3-133',
      finality_claim: false,
      allowed_operation_types: [operation.type],
    },
    operation,
    ...overrides,
  };
}

const defaultAuthority = createTrustedAuthority();
kernel.evaluate = (input, options = {}) => rawEvaluate(input, { trustedAuthorityContext: defaultAuthority, ...options });

function ticketRequest(operation, overrides = {}) {
  return {
    session_id: 'session-1',
    turn_id: 'turn-1',
    call_id: 'call-1',
    operation_type: operation.type,
    operation_digest: kernel.operationDigest(operation),
    target_digest: kernel.targetDigest(operation),
    scope: 'repo:weijunswj/ai-agent-toolkit',
    expires_at: '2026-08-16T14:05:00.000Z',
    ...overrides,
  };
}

function withTicket(operation, trusted, overrides = {}) {
  const ticket = trusted.issue(ticketRequest(operation, overrides.ticket));
  return {
    ticket,
    input: baseInput(operation, {
      authority: TRUSTED_CONTROLLER,
      ticket,
      session: { session_id: 'session-1', turn_id: 'turn-1', call_id: 'call-1', ...(overrides.session || {}) },
      scope: ticket.scope,
      ...(overrides.input || {}),
    }),
  };
}

function secretExfiltration() {
  return {
    type: 'network.request',
    source: target('.env.synthetic', { existence: 'existing' }),
    destination: { kind: 'external-system', digest: 'b'.repeat(64) },
    method: 'POST',
  };
}

function catastrophicDelete() {
  return { type: 'filesystem.delete', target: target('') };
}

function makeCapturedKeyGraph(extraCapturedKeys) {
  const root = {};
  const evidence = [];
  const container = [[], []];
  root.left = evidence;
  root.right = container;
  const addAccessor = (object, key) => Object.defineProperty(object, key, {
    enumerable: true,
    configurable: true,
    get() { throw new Error('accessor probe'); },
  });
  const makeRecord = (arrayIndex, index, keyCount) => {
    const keys = Array.from({ length: keyCount }, (_, keyIndex) => `r${arrayIndex}${index}_${keyIndex}`);
    return new Proxy({}, {
      ownKeys() { return keys; },
      getOwnPropertyDescriptor() { return undefined; },
    });
  };
  evidence[0] = 0;
  addAccessor(evidence, 'array-evidence');
  addAccessor(evidence, Symbol('array-symbol'));
  const targetKeyCount = 59 + extraCapturedKeys;
  assert.ok(targetKeyCount <= 64);
  for (let arrayIndex = 0; arrayIndex < 2; arrayIndex += 1) {
    const values = container[arrayIndex];
    for (let index = 0; index < 63; index += 1) {
      const keyCount = arrayIndex === 1 && index === 62 ? targetKeyCount : 64;
      values[index] = makeRecord(arrayIndex, index, keyCount);
    }
  }
  return root;
}

function countDetachedNodes(root) {
  const pending = [root];
  const visited = new Set();
  let count = 0;
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node || visited.has(node)) continue;
    visited.add(node);
    count += 1;
    for (const entry of Array.isArray(node.children) ? node.children : []) pending.push(entry.node);
  }
  return count;
}


function makeObservedNodeGraph(extraScalarNodes = 0) {
  const children = [];
  for (let index = 0; index < 64; index += 1) {
    const record = {};
    const scalarCount = index < 62 ? 7 : 6 + (extraScalarNodes > 0 && index === 62 ? 1 : 0);
    for (let scalarIndex = 0; scalarIndex < scalarCount; scalarIndex += 1) record[`value-${index}-${scalarIndex}`] = scalarIndex;
    children.push(record);
  }
  return { children };
}

function makeDepthGraph(levels, key = 'hostile.path.key') {
  let value = {};
  for (let level = 0; level < levels; level += 1) value = { [key]: value };
  return value;
}

function keyOfLength(index, length) {
  const prefix = String(index).padStart(4, '0');
  return prefix + 'k'.repeat(length - prefix.length);
}

function objectWithKeys(keys) {
  const value = {};
  for (const [index, key] of keys.entries()) Object.defineProperty(value, key, { value: index, enumerable: true, configurable: true, writable: true });
  return value;
}

function makeIssueFlood() {
  const root = {};
  for (let index = 0; index < 17; index += 1) {
    const child = {};
    for (let keyIndex = 0; keyIndex < 64; keyIndex += 1) Object.defineProperty(child, `accessor-${keyIndex}`, { enumerable: true, configurable: true, get() { return keyIndex; } });
    root[`child-${index}`] = child;
  }
  return root;
}
test('trusted protected roots remain hard-deny evidence when caller repository evidence is invalid', () => {
  const trusted = createTrustedAuthority();
  const conflictingRepository = {
    root: `${ROOT}\\caller-root`,
    worktree: `${ROOT}\\caller-root\\worktree`,
    remote: REMOTE,
    resolution: { status: 'resolved', link_type: 'none' },
  };
  const trustedRootDelete = rawEvaluate(baseInput({ type: 'filesystem.delete', target: { path: ROOT, resolution: { status: 'resolved', canonical_path: ROOT, link_type: 'none' } } }, { repository: conflictingRepository }), { trustedAuthorityContext: trusted });
  assert.equal(trustedRootDelete.decision, 'deny');
  assert.equal(trustedRootDelete.reason_code, 'CATASTROPHIC_TARGET_DENIED');

  const malformedRepository = { root: ROOT, worktree: 42, remote: REMOTE, resolution: { status: 'resolved', link_type: 'none' } };
  const trustedWorktreeDelete = rawEvaluate(baseInput({ type: 'filesystem.delete', target: { path: WORKTREE, resolution: { status: 'resolved', canonical_path: WORKTREE, link_type: 'none' } } }, { repository: malformedRepository }), { trustedAuthorityContext: trusted });
  assert.equal(trustedWorktreeDelete.decision, 'deny');
  assert.equal(trustedWorktreeDelete.reason_code, 'CATASTROPHIC_TARGET_DENIED');
});

test('trusted protected-root hard deny preserves finality and secret precedence', () => {
  const trusted = createTrustedAuthority();
  const conflictingRepository = {
    root: `${ROOT}\\caller-root`,
    worktree: `${ROOT}\\caller-root\\worktree`,
    remote: REMOTE,
    resolution: { status: 'resolved', link_type: 'none' },
  };
  const operation = { type: 'compound', components: [{ type: 'filesystem.delete', target: { path: ROOT, resolution: { status: 'resolved', canonical_path: ROOT, link_type: 'none' } } }, secretExfiltration()] };
  const finality = rawEvaluate(baseInput(operation, { repository: conflictingRepository, authority: { ...baseInput(readOperation()).authority, finality_claim: true } }), { trustedAuthorityContext: trusted });
  assert.equal(finality.decision, 'deny');
  assert.equal(finality.reason_code, 'CALLER_FINALITY_REJECTED');
  const secret = rawEvaluate(baseInput(operation, { repository: conflictingRepository }), { trustedAuthorityContext: trusted });
  assert.equal(secret.decision, 'deny');
  assert.equal(secret.reason_code, 'SECRET_EXFILTRATION_DENIED');
});

test('untrusted context cannot create protected-root hard-deny authority', () => {
  const fakeContext = { root: ROOT, worktree: WORKTREE, authorized_remote: 'origin', authorized_ref: AUTHORIZED_REF, live_server_ref_sha: 'a'.repeat(40) };
  const input = baseInput({ type: 'filesystem.delete', target: { path: ROOT, resolution: { status: 'resolved', canonical_path: ROOT, link_type: 'none' } } }, {
    repository: { root: `${ROOT}\\caller-root`, worktree: `${ROOT}\\caller-root\\worktree`, remote: REMOTE, resolution: { status: 'resolved', link_type: 'none' } },
  });
  const result = rawEvaluate(input, { trustedAuthorityContext: fakeContext });
  assert.notEqual(result.reason_code, 'CATASTROPHIC_TARGET_DENIED');
  assert.equal(result.reason_code, 'TRUSTED_AUTHORITY_REQUIRED');
});

test('observed node accounting includes scalar, unknown, failure and opaque nodes at exact 512', () => {
  const scalar = kernel[TEST_ONLY_OBSERVE]('scalar', null);
  assert.equal(scalar.stats.observedNodes, 1);
  const unknown = kernel[TEST_ONLY_OBSERVE](null, null);
  assert.equal(unknown.stats.observedNodes, 1);
  const opaque = kernel[TEST_ONLY_OBSERVE]({ ticket: {} }, 'input');
  assert.equal(opaque.stats.observedNodes, 2);

  const permitted = kernel[TEST_ONLY_OBSERVE](makeObservedNodeGraph(), null);
  assert.equal(permitted.stats.observedNodes, 512);
  assert.equal(permitted.issues.some((entry) => entry.code === 'OBSERVATION_NODE_LIMIT'), false);
  assert.equal(countDetachedNodes(permitted.node), 512);

  const exceeded = kernel[TEST_ONLY_OBSERVE](makeObservedNodeGraph(1), null);
  assert.equal(exceeded.stats.observedNodes, 512);
  assert.equal(exceeded.issues.some((entry) => entry.code === 'OBSERVATION_NODE_LIMIT'), true);
  assert.equal(countDetachedNodes(exceeded.node), 512);
});

test('retained hostile string keys consume scalar and total string budgets exactly once', () => {
  const scalarBoundary = kernel[TEST_ONLY_OBSERVE](objectWithKeys([keyOfLength(0, 4096)]), null);
  assert.equal(scalarBoundary.stats.stringUnits, 4096);
  assert.equal(scalarBoundary.issues.some((entry) => entry.code === 'OBSERVATION_SCALAR_LIMIT'), false);
  const scalarExceeded = kernel[TEST_ONLY_OBSERVE](objectWithKeys([keyOfLength(0, 4097)]), null);
  assert.equal(scalarExceeded.issues.some((entry) => entry.code === 'OBSERVATION_SCALAR_LIMIT'), true);

  const totalBoundary = kernel[TEST_ONLY_OBSERVE](objectWithKeys(Array.from({ length: 32 }, (_, index) => keyOfLength(index, 4096))), null);
  assert.equal(totalBoundary.stats.stringUnits, 131072);
  assert.equal(totalBoundary.issues.some((entry) => entry.code === 'OBSERVATION_STRING_TOTAL_LIMIT'), false);
  const totalExceeded = kernel[TEST_ONLY_OBSERVE](objectWithKeys([...Array.from({ length: 32 }, (_, index) => keyOfLength(index, 4096)), 'z']), null);
  assert.equal(totalExceeded.stats.stringUnits, 131073);
  assert.equal(totalExceeded.issues.some((entry) => entry.code === 'OBSERVATION_STRING_TOTAL_LIMIT'), true);
});

test('graph depth is numeric and hostile dotted keys do not inflate it', () => {
  const maximum = kernel[TEST_ONLY_OBSERVE](makeDepthGraph(32), null);
  assert.equal(maximum.issues.some((entry) => entry.code === 'OBSERVATION_GRAPH_DEPTH_LIMIT'), false);
  const exceeded = kernel[TEST_ONLY_OBSERVE](makeDepthGraph(33), null);
  assert.equal(exceeded.issues.some((entry) => entry.code === 'OBSERVATION_GRAPH_DEPTH_LIMIT'), true);
});

test('array structural length is excluded from the 64 non-structural key cap', () => {
  const permitted = kernel[TEST_ONLY_OBSERVE](Array.from({ length: 64 }, (_, index) => index), null);
  assert.equal(permitted.issues.some((entry) => entry.code === 'OBSERVATION_OWN_KEY_LIMIT'), false);
  const exceededArray = Array.from({ length: 64 }, (_, index) => index);
  exceededArray.extra = 0;
  const exceeded = kernel[TEST_ONLY_OBSERVE](exceededArray, null);
  assert.equal(exceeded.issues.some((entry) => entry.code === 'OBSERVATION_OWN_KEY_LIMIT'), true);
});

test('retained issue collection stays within 1024 entries with one overflow marker', () => {
  const observation = kernel[TEST_ONLY_OBSERVE](makeIssueFlood(), null);
  assert.equal(observation.issues.length, 1024);
  assert.equal(observation.issues.filter((entry) => entry.code === 'OBSERVATION_ISSUE_LIMIT').length, 1);
});
test('default-off is side-effect-free and the public surface is private', () => {
  mark('default-off');
  const input = baseInput(readOperation());
  delete input.enabled;
  delete input.activation;
  const before = structuredClone(input);
  const result = kernel.evaluate(input);
  assert.equal(result.decision, 'unsupported');
  assert.equal(result.reason_code, 'CONTROL_PLANE_DEFAULT_OFF');
  assert.equal(result.privacy_safe, true);
  assert.deepEqual(input, before);
  assert.equal(typeof productionKernel.createTrustedAuthorityContext, 'undefined');
  assert.equal(typeof productionKernel.createTicketStore, 'undefined');
});

test('remote identity has HTTPS, SSH and SCP parity and rejects broad forms', () => {
  mark('remote-identity-r8-001', 'remote-identity-r8-002');
  for (const remote of [REMOTE, 'ssh://git@github.com:22/weijunswj/ai-agent-toolkit.git', 'git@github.com:weijunswj/ai-agent-toolkit.git']) {
    const result = kernel.validateRemoteIdentity(remote);
    assert.equal(result.valid, true, remote);
    assert.equal(kernel.formatRemoteIdentity(remote), result.canonical);
  }
  for (const remote of [
    'https://user:secret@example.com/repo.git', 'https://github.com/repo.git?token=synthetic',
    'https://github.com', 'https://[::1]:65536/repo.git', 'git@@github.com:repo.git',
    'git@github.com:', 'C:\\fixture\\repo', '\\\\server\\share', './relative/repo',
  ]) assert.equal(kernel.validateRemoteIdentity(remote).valid, false, remote);
});

test('safe observation independently guards accessors, ownKeys, descriptors and prototypes', () => {
  mark('invalid-without-hard-deny');
  let getterCalls = 0;
  const accessorTarget = { resolution: { status: 'resolved', canonical_path: `${ROOT}\\src\\safe.txt`, link_type: 'none' } };
  Object.defineProperty(accessorTarget, 'path', { enumerable: true, get() { getterCalls += 1; return `${ROOT}\\src\\safe.txt`; } });
  assert.doesNotThrow(() => kernel.evaluate(baseInput({ type: 'filesystem.read', target: accessorTarget })));
  assert.equal(getterCalls, 0);

  const ownKeysFailure = new Proxy({ type: 'compound', components: [secretExfiltration()] }, {
    ownKeys() { throw new Error('ownKeys'); },
  });
  const descriptorFailure = new Proxy({ type: 'filesystem.delete', target: target('src\\safe.txt') }, {
    getOwnPropertyDescriptor(_target, key) { if (key === 'target') throw new Error('descriptor'); return Reflect.getOwnPropertyDescriptor(_target, key); },
  });
  const prototypeFailure = new Proxy({ type: 'compound', components: [secretExfiltration()] }, {
    getPrototypeOf() { throw new Error('prototype'); },
  });
  for (const operation of [ownKeysFailure, descriptorFailure, prototypeFailure]) {
    const result = kernel.evaluate(baseInput(operation));
    assert.notEqual(result.decision, 'allow');
  }
});

test('Proxy-over-array length failure keeps numeric children reachable by hard deny', () => {
  mark('compound-hard-deny-precedence');
  const components = [catastrophicDelete(), secretExfiltration(), readOperation('src\\safe.txt')];
  const proxiedComponents = new Proxy(components, {
    getOwnPropertyDescriptor(targetValue, key) {
      if (key === 'length') throw new Error('length probe');
      return Reflect.getOwnPropertyDescriptor(targetValue, key);
    },
  });
  const result = kernel.evaluate(baseInput({ type: 'compound', components: proxiedComponents }));
  assert.equal(result.decision, 'deny');
  assert.equal(result.reason_code, 'SECRET_EXFILTRATION_DENIED');
});

test('hard-deny precedence is fixed across reversal, permutations, nesting, branching and excess shape', () => {
  const secret = secretExfiltration();
  const catastrophic = catastrophicDelete();
  const partial = { type: 'filesystem.read' };
  for (const components of [[catastrophic, partial, secret], [secret, partial, catastrophic], [partial, secret, catastrophic]]) {
    const result = kernel.evaluate(baseInput({ type: 'compound', components }));
    assert.equal(result.reason_code, 'SECRET_EXFILTRATION_DENIED');
  }
  const excess = Array.from({ length: 17 }, (_, index) => index === 0 ? catastrophic : index === 16 ? secret : readOperation(`src\\excess-${index}.txt`));
  const nested = { type: 'compound', components: [catastrophic, { type: 'compound', components: excess }] };
  const branched = { type: 'compound', components: [{ type: 'compound', components: excess }, { type: 'compound', components: [secret] }] };
  for (const operation of [nested, branched]) {
    const result = kernel.evaluate(baseInput(operation));
    assert.equal(result.reason_code, 'SECRET_EXFILTRATION_DENIED');
  }
  const ordinaryInvalid = kernel.evaluate(baseInput({ type: 'compound', components: Array.from({ length: 17 }, (_, index) => readOperation(`src\\ordinary-${index}.txt`)) }));
  assert.equal(ordinaryInvalid.decision, 'unsupported');
  assert.equal(ordinaryInvalid.operation_digest, null);
  assert.equal(ordinaryInvalid.target_digest, null);
});

test('global compound components are counted at 128 and rejected at 129', () => {
  mark('compound-hard-deny-composition');
  const compound = (components) => ({ type: 'compound', components });
  const reads = (count) => Array.from({ length: count }, () => ({ type: 'git.read' }));
  const allowed = compound(Array.from({ length: 8 }, (_, index) => compound(reads(15, `branch-${index}`))));
  const rejected = compound(Array.from({ length: 8 }, (_, index) => compound(reads(index === 0 ? 16 : 15, `branch-over-${index}`))));
  assert.equal(kernel.evaluate(baseInput(allowed, { authority: { ...baseInput({ type: 'git.read' }).authority, allowed_operation_types: ['git.read', 'compound'] } })).decision, 'allow');
  assert.equal(kernel.evaluate(baseInput(rejected)).reason_code, 'COMPOUND_COMPONENT_LIMIT');
});

test('captured-key accounting includes mixed record, array-extra and symbol keys at 8192/8193', () => {
  const permitted = kernel[TEST_ONLY_OBSERVE](makeCapturedKeyGraph(0), null);
  assert.equal(permitted.stats.capturedKeys, 8192);
  assert.equal(permitted.issues.some((issue) => issue.code === 'OBSERVATION_CAPTURED_KEY_LIMIT'), false);
  assert.equal(permitted.issues.some((issue) => issue.code === 'OBSERVATION_ARRAY_EXTRA_KEY'), true);
  assert.equal(permitted.issues.some((issue) => issue.code === 'OBSERVATION_SYMBOL_KEY'), true);
  const exceeded = kernel[TEST_ONLY_OBSERVE](makeCapturedKeyGraph(1), null);
  assert.equal(exceeded.stats.capturedKeys, 8193);
  assert.equal(exceeded.issues.some((issue) => issue.code === 'OBSERVATION_CAPTURED_KEY_LIMIT'), true);
});

test('ticket defaults, ranges, immutable private binding and replay are enforced', () => {
  mark('trusted-issuer-authority', 'fake-ticket-store-denied', 'copied-ticket-denied');
  const operation = { type: 'filesystem.delete', target: target('src\\ticket.txt') };
  const trusted = createTrustedAuthority({ authority: { allowed_operation_types: ['filesystem.delete'] } });
  const omitted = ticketRequest(operation, { call_id: 'default-call' });
  delete omitted.max_uses;
  const ticket = trusted.issue(omitted);
  assert.equal(ticket.max_uses, 1);
  assert.equal(ticket.issuer_role, 'controller');
  assert.throws(() => trusted.issue({ ...ticketRequest(operation, { call_id: 'forged-issuer' }), issuer: 'caller' }), /TICKET_ISSUER_INPUT_FORBIDDEN/);
  assert.equal(Object.isFrozen(ticket), true);
  for (const maxUses of [1, 8]) assert.equal(trusted.issue(ticketRequest(operation, { call_id: `valid-${maxUses}`, max_uses: maxUses })).max_uses, maxUses);
  for (const maxUses of [0, 9, 1.5, '1', null, {}]) assert.throws(() => trusted.issue(ticketRequest(operation, { call_id: `invalid-${String(maxUses)}`, max_uses: maxUses })), /TICKET/);

  const issued = withTicket(operation, trusted, { ticket: { call_id: 'consume-call' }, session: { call_id: 'consume-call' } });
  assert.equal(kernel.evaluate(issued.input, { trustedAuthorityContext: trusted }).decision, 'allow');
  assert.equal(kernel.evaluate(issued.input, { trustedAuthorityContext: trusted }).reason_code, 'TICKET_REPLAY');
  const copied = { ...ticket };
  assert.equal(kernel.evaluate(baseInput(operation, { authority: TRUSTED_CONTROLLER, ticket: copied, session: { session_id: 'session-1', turn_id: 'turn-1', call_id: 'default-call' }, scope: ticket.scope }), { trustedAuthorityContext: trusted }).reason_code, 'TICKET_INVALID');
  const fakeStoreResult = rawEvaluate(baseInput(operation, { authority: TRUSTED_CONTROLLER, ticket: {}, session: { session_id: 'session-1', turn_id: 'turn-1', call_id: 'x' } }), { ticketStore: { consume: () => ({ valid: true }) } });
  assert.equal(fakeStoreResult.reason_code, 'TICKET_TRUST_SOURCE_REQUIRED');
});

test('trusted authority provenance is required for opaque ticket use', () => {
  mark('trusted-authority-provenance');
  const operation = { type: 'filesystem.delete', target: target('src\\provenance.txt') };
  const trusted = createTrustedAuthority({ authority: { allowed_operation_types: ['filesystem.delete'] } });
  const issued = withTicket(operation, trusted);
  const result = rawEvaluate(issued.input);
  assert.equal(result.reason_code, 'TICKET_TRUST_SOURCE_REQUIRED');
});

test('controller GitHub mutation ticket is one-shot', () => {
  mark('controller-github-one-shot');
  const operation = { type: 'github.mutation', repository: 'weijunswj/ai-agent-toolkit', action: 'comment', target: { kind: 'github-repository', digest: 'b'.repeat(64) } };
  const trusted = createTrustedAuthority({ authority: { allowed_operation_types: ['github.mutation'] } });
  const issued = withTicket(operation, trusted);
  const first = rawEvaluate(issued.input, { trustedAuthorityContext: trusted });
  assert.equal(first.decision, 'allow');
  assert.equal(first.reason_code, 'TICKET_CONSUMED');
  const replay = rawEvaluate(issued.input, { trustedAuthorityContext: trusted });
  assert.equal(replay.decision, 'deny');
  assert.equal(replay.reason_code, 'TICKET_REPLAY');
});

test('expired ticket slots are reclaimed before issuing a replacement', () => {
  mark('replay-slot-reclamation');
  let nowValue = Date.parse(NOW);
  const operation = { type: 'filesystem.delete', target: target('src\\reclaim.txt') };
  const trusted = createTrustedAuthority({ authority: { allowed_operation_types: ['filesystem.delete'] }, now: () => nowValue, maxEntries: 1 });
  const first = trusted.issue(ticketRequest(operation, { call_id: 'reclaim-first', expires_at: '2026-08-16T14:05:00.000Z' }));
  assert.equal(trusted.size(), 1);
  nowValue = Date.parse('2026-08-16T14:06:00.000Z');
  const second = trusted.issue(ticketRequest(operation, { call_id: 'reclaim-second', expires_at: '2026-08-16T14:10:00.000Z' }));
  assert.notEqual(second, first);
  assert.equal(trusted.size(), 1);
});

test('ticket provenance rejects a ticket across trusted authority contexts', () => {
  mark('cross-authority-context-denied');
  const operation = { type: 'filesystem.delete', target: target('src\\cross-context.txt') };
  const issuer = createTrustedAuthority({ authority: { allowed_operation_types: ['filesystem.delete'] } });
  const receiver = createTrustedAuthority({ authority: { allowed_operation_types: ['filesystem.delete'] } });
  const issued = withTicket(operation, issuer);
  const result = rawEvaluate(issued.input, { trustedAuthorityContext: receiver });
  assert.equal(result.decision, 'deny');
  assert.equal(result.reason_code, 'TICKET_AUTHORITY_CONTEXT_MISMATCH');
});

test('ticket scope is bound and cannot be widened by caller input', () => {
  mark('ticket-scope-binding');
  const operation = { type: 'filesystem.delete', target: target('src\\scope.txt') };
  const trusted = createTrustedAuthority({ authority: { allowed_operation_types: ['filesystem.delete'] } });
  const issued = withTicket(operation, trusted, { ticket: { scope: 'scope-a' }, input: { scope: 'scope-b' } });
  const result = rawEvaluate(issued.input, { trustedAuthorityContext: trusted });
  assert.equal(result.decision, 'deny');
  assert.equal(result.reason_code, 'TICKET_BINDING_MISMATCH');
});

test('filesystem move requires exactly one source and one destination', () => {
  mark('filesystem-move-cardinality');
  const source = target('src\\move-source.txt');
  const destination = target('src\\move-destination.txt');
  const operation = { type: 'filesystem.move', source, destination, no_clobber: false };
  assert.notEqual(kernel.operationDigest(operation), null);
  assert.notEqual(kernel.targetDigest(operation), null);
  assert.equal(kernel.operationDigest({ type: 'filesystem.move', source, no_clobber: false }), null);
  assert.equal(kernel.operationDigest({ type: 'filesystem.move', destination, no_clobber: false }), null);
});
test('trusted root, resolver, role and digest gates cannot be broadened by caller metadata', () => {
  mark('unknown-resolver-link-type', 'resolver-raw-canonical-conflict', 'external-digest-target-union', 'compound-component-role-limit');
  const unresolved = baseInput(readOperation(), { repository: { root: ROOT, worktree: WORKTREE, remote: REMOTE, resolution: { status: 'unknown', link_type: 'none' } } });
  assert.equal(kernel.evaluate(unresolved).reason_code, 'RESOLUTION_INVALID');
  const unknownLink = baseInput(readOperation(), { repository: { root: ROOT, worktree: WORKTREE, remote: REMOTE, resolution: { status: 'resolved', link_type: 'future-link' } } });
  assert.equal(kernel.evaluate(unknownLink).reason_code, 'UNKNOWN_RESOLVER_LINK_TYPE');
  const conflict = baseInput({ type: 'filesystem.read', target: { path: `${ROOT}\\outside.txt`, resolution: { status: 'resolved', canonical_path: `${ROOT}\\safe.txt`, link_type: 'none' } } });
  assert.equal(kernel.evaluate(baseInput({ type: 'filesystem.read', target: target('src\\\\*.txt') })).reason_code, 'TARGET_DYNAMIC_PATH_UNSUPPORTED');
  assert.equal(kernel.evaluate(conflict).reason_code, 'TARGET_CONTEXT_CONFLICT');
  const outside = baseInput(readOperation('src\\safe.txt'), { authority: { ...baseInput(readOperation()).authority, allowed_operation_types: ['filesystem.delete'] }, repository: { root: ROOT + '\\other', worktree: ROOT + '\\other\\worktree', remote: REMOTE, resolution: { status: 'resolved', link_type: 'none' } } });
  assert.equal(kernel.evaluate(outside).reason_code, 'REPOSITORY_INVALID');
  const mixed = { kind: 'external-system', digest: 'a'.repeat(64), path: `${ROOT}\\src\\safe.txt`, resolution: { status: 'resolved', canonical_path: `${ROOT}\\src\\safe.txt`, link_type: 'none' } };
  assert.notEqual(kernel.evaluate(baseInput({ type: 'filesystem.read', target: mixed })).decision, 'allow');
  const role = kernel.evaluate(baseInput({ type: 'compound', components: [readOperation(), { type: 'git.branch', mode: 'move', branch: 'topic' }] }, { authority: { ...baseInput(readOperation()).authority, allowed_operation_types: ['filesystem.read'] } }));
  assert.equal(role.reason_code, 'COMPONENT_AUTHORITY_REQUIRED');
  assert.equal(kernel.operationDigest({ type: 'shell', shell: 'posix', command: 'synthetic' }), null);
  assert.equal(kernel.targetDigest({ type: 'future.operation' }), null);
});

test('sensitive, catastrophic, finality, push and branch boundaries fail closed', () => {
  mark('secret-classification', 'unc-share-root', 'caller-finality', 'broadened-push-target', 'git-push-typed-options', 'git-push-remote-typed', 'mutating-git-branch', 'mutating-nominal-read', 'overwrite-no-clobber', 'attached-redirection', 'hidden-shell-expansion');
  const secretRead = kernel.evaluate(baseInput({ type: 'filesystem.read', target: target('.env.synthetic', { existence: 'existing' }) }));
  assert.equal(secretRead.reason_code, 'SECRET_ACCESS_REQUIRES_TICKET');
  const exfil = kernel.evaluate(baseInput(secretExfiltration()));
  assert.equal(exfil.reason_code, 'SECRET_EXFILTRATION_DENIED');
  const rootDelete = kernel.evaluate(baseInput({ type: 'filesystem.delete', target: { path: '\\\\server\\share', resolution: { status: 'resolved', canonical_path: '\\\\server\\share', link_type: 'none' } } }));
  assert.equal(rootDelete.reason_code, 'CATASTROPHIC_TARGET_DENIED');
  assert.equal(kernel.isUncShareRoot('\\\\server\\share\\'), true);
  assert.equal(kernel.evaluate(baseInput(readOperation(), { authority: { ...baseInput(readOperation()).authority, finality_claim: true } })).reason_code, 'CALLER_FINALITY_REJECTED');
  assert.equal(kernel.evaluate(baseInput({ type: 'git.branch', mode: 'move', branch: 'topic' })).reason_code, 'MUTATING_GIT_OPERATION_REQUIRES_TICKET');
  for (const option of ['--follow-tags', '--recurse-submodules', '--mirror', '--delete', '--all']) {
    const result = kernel.evaluate(baseInput({ type: 'git.push', remote: 'origin', refspecs: ['HEAD:refs/heads/topic'], options: [option], authorized_remote: 'origin', authorized_ref: AUTHORIZED_REF }));
    assert.notEqual(result.decision, 'allow', option);
  }
  const remoteMismatch = kernel.evaluate(baseInput({ type: 'git.push', remote: 'upstream', refspecs: ['HEAD:refs/heads/topic'], options: [], authorized_remote: 'origin', authorized_ref: AUTHORIZED_REF }));
  assert.equal(remoteMismatch.reason_code, 'BROADENED_PUSH_TARGET_UNSUPPORTED');

  for (const command of ['find . -delete', 'find . -exec rm -f {} +', 'sed -i synthetic file.txt', 'cat input>output', 'git push --follow-tags origin main', "cat $'.env'", 'git branch -f topic HEAD~2']) {
    const result = kernel.evaluate(baseInput({ type: 'shell', shell: 'posix', command }));
    assert.equal(result.reason_code, 'OPAQUE_OPERATION_UNSUPPORTED', command);
  }
  assert.equal(kernel.evaluate(baseInput({ type: 'filesystem.create', target: target('src\\existing.txt', { existence: 'existing' }), no_clobber: false })).reason_code, 'OVERWRITE_APPROVAL_REQUIRED');
  assert.equal(kernel.evaluate(baseInput({ type: 'filesystem.create', target: target('src\\new.txt', { existence: 'absent' }), no_clobber: true })).decision, 'allow');
});

test('array length descriptor accepts either writable boolean value', () => {
  const input = baseInput(readOperation());
  Object.defineProperty(input.authority.allowed_operation_types, 'length', { writable: false });
  assert.equal(kernel.evaluate(input).decision, 'allow');
});

test('valid typed git push consumes a matching opaque ticket', () => {
  const operation = { type: 'git.push', remote: 'origin', refspecs: ['HEAD:refs/heads/topic'], options: ['--porcelain'], authorized_remote: 'origin', authorized_ref: AUTHORIZED_REF };
  const trusted = createTrustedAuthority({ authority: { allowed_operation_types: ['git.push'] } });
  const issued = withTicket(operation, trusted);
  const result = kernel.evaluate(issued.input, { trustedAuthorityContext: trusted });
  assert.equal(result.decision, 'allow');
  assert.equal(result.reason_code, 'TICKET_CONSUMED');
});

test('structural impact is closed and retains #342 targeted-repo-wide behavior', () => {
  mark('structural-impact', 'structural-impact-closed-kinds');
  const result = kernel.assessStructuralImpact({ kind: 'structural-replace', identity: 'operation.authority' });
  assert.equal(result.valid, true);
  assert.equal(result.required, true);
  assert.equal(result.search_scope, 'targeted-repo-wide');
  assert.ok(result.consumer_categories.includes('source-shape-tests'));
  assert.equal(result.compatibility_rule.issue, 342);
  assert.equal(kernel.assessStructuralImpact({ kind: 'value-change', identity: 'timeout-ms' }).required, false);
  assert.equal(kernel.assessStructuralImpact({ kind: 'unknown-kind', identity: 'operation.authority' }).reason_code, 'STRUCTURAL_IMPACT_KIND_UNSUPPORTED');
  assert.equal(kernel.assessStructuralImpact({ kind: 'value-change', identity: 'timeout-ms', scope: 'extra' }).reason_code, 'STRUCTURAL_IMPACT_FIELDS_UNSUPPORTED');
});

test('schema, policy and fixture manifest preserve the locked public contracts', () => {
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  const fixtures = JSON.parse(fs.readFileSync(fixtureManifestPath, 'utf8'));
  assert.equal(schema.$id, kernel.CONTRACT_VERSION);
  assert.equal(policy.design_lock, 'DL-AGENT-NATIVE-LOOP-MVP-001-A1-SOIR-R1');
  assert.equal(policy.observation.captured_keys, 8192);
  assert.equal(policy.authority_ticket.default_uses, 1);
  assert.equal(fixtures.contract_version, kernel.CONTRACT_VERSION);
  assert.equal(fixtures.required_case_ids.length, 32);
  assert.equal(new Set(fixtures.required_case_ids).size, 32);
  const manifestIds = fixtures.required_case_ids;
  const executedIds = [...fixtureCounts.keys()];
  assert.deepEqual([...executedIds].sort(), [...manifestIds].sort());
  assert.equal(executedIds.some((id) => !manifestIds.includes(id)), false);
  assert.equal(manifestIds.some((id) => !fixtureCounts.has(id)), false);
  for (const id of manifestIds) assert.equal(fixtureCounts.get(id), 1, id);
  assert.equal([...fixtureCounts.values()].reduce((total, count) => total + count, 0), manifestIds.length);
});

test('forged public entry points cannot expose trusted authority', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a1-run133-forged-'));
  const entry = path.join(tempRoot, 'entry.cjs');
  fs.writeFileSync(entry, `'use strict'; const k = require(${JSON.stringify(runtimePath)}); process.stdout.write(JSON.stringify({ authority: typeof k.createTrustedAuthorityContext, store: typeof k.createTicketStore }));`, 'utf8');
  try {
    const output = childProcess.execFileSync(process.execPath, [entry], { encoding: 'utf8' });
    assert.deepEqual(JSON.parse(output), { authority: 'undefined', store: 'undefined' });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
