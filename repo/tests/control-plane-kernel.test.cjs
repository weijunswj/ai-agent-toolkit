'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const moduleApi = require('node:module');
const os = require('node:os');
const path = require('node:path');
const nodeTest = require('node:test');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..', '..');
const runtimePath = path.join(repoRoot, 'repo', 'scripts', 'toolkit-control-plane', 'control-plane-kernel.cjs');
const schemaPath = path.join(repoRoot, '_projects', 'development', 'control-plane-kernel', '_main', 'control-plane-contract.schema.json');
const fixtureManifestPath = path.join(repoRoot, '_projects', 'development', 'control-plane-kernel', '_main', 'fixtures', 'fixture-manifest.json');
const fixtureManifest = JSON.parse(fs.readFileSync(fixtureManifestPath, 'utf8'));
const requiredFixtureCaseIds = [...fixtureManifest.required_case_ids];
const requiredFixtureCaseIdSet = new Set(requiredFixtureCaseIds);
const executedFixtureCaseIds = [];
const fixtureCaseIdsByTestName = new Map([
  ['default-off refusal is side-effect free and privacy-minimized', ['default-off']],
  ['remote identity runtime and schema share one credential-free contract', ['remote-identity-r8-001', 'remote-identity-r8-002']],
  ['unknown resolver link types fail closed before normalization', ['unknown-resolver-link-type']],
  ['typed operations refuse opaque shell syntax, including all eleven shell-adversarial forms', ['mutating-nominal-read', 'attached-redirection', 'hidden-shell-expansion']],
  ['overwrite/no-clobber authority is typed and destination-bound', ['overwrite-no-clobber']],
  ['mutating git branch modes and broadened push options cannot reach routine allow', ['broadened-push-target', 'mutating-git-branch']],
  ['secret classification is derived and sensitive boundaries fail closed', ['secret-classification']],
  ['catastrophic UNC share roots are denied even when a ticket is supplied', ['unc-share-root']],
  ['compound authority validates every typed component, not only the winning decision', ['compound-component-role-limit']],
  ['caller finality claims and untruthful authority identity are rejected', ['caller-finality']],
  ['one-shot tickets bind operation/session/turn/call and controller GitHub authority is consumed once', ['controller-github-one-shot']],
  ['ticket replay is bounded and expired/exhausted slots are reclaimed', ['replay-slot-reclamation']],
  ['structural impact is deterministic and keeps the temporary #342 rule active', ['structural-impact']],
  ['compound hard denies cannot be routed through aggregate ticket authority', ['compound-hard-deny-composition']],
  ['ticket issuer trust and retained scope are part of consumption binding', ['trusted-issuer-authority']],
  ['arbitrary ticket stores cannot claim controller GitHub consumption', ['fake-ticket-store-denied']],
  ['copied or forged tickets cannot authorize through a bound context', ['copied-ticket-denied']],
  ['cross-authority-context and cross-store tickets cannot authorize', ['cross-authority-context-denied', 'trusted-authority-provenance']],
  ['scope, session, turn, call, operation, and target changes fail binding', ['ticket-scope-binding']],
  ['resolver raw/canonical conflicts fail closed before target or ticket decisions', ['resolver-raw-canonical-conflict']],
  ['git push options use a narrow typed allowlist', ['git-push-typed-options']],
  ['mixed external and filesystem target representations fail closed', ['external-digest-target-union']],
  ['git push remote names are closed and option-like values cannot consume tickets', ['git-push-remote-typed']],
  ['compound hard denies dominate unsupported components in every order', ['compound-hard-deny-precedence']],
  ['structural impact uses a closed deterministic kind contract', ['structural-impact-closed-kinds']],
  ['filesystem.move validates source and destination cardinality and binding', ['filesystem-move-cardinality']],
]);

function registerFixtureCaseIds(caseIds, registry = executedFixtureCaseIds) {
  for (const caseId of caseIds) {
    assert.equal(requiredFixtureCaseIdSet.has(caseId), true, 'fixture case is not declared by the manifest: ' + caseId);
    assert.equal(registry.includes(caseId), false, 'fixture case executed more than once: ' + caseId);
    registry.push(caseId);
  }
}

function registerFixtureCases(testName) {
  registerFixtureCaseIds(fixtureCaseIdsByTestName.get(testName) || []);
}

const test = (name, fn) => nodeTest(name, async (...args) => {
  const result = fn(...args);
  if (result && typeof result.then === 'function') await result;
  registerFixtureCases(name);
  return result;
});

function schemaTypeMatches(value, type) {
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'null') return value === null;
  return typeof value === type;
}

function validateJsonSchemaObject(value, schema) {
  const errors = [];
  const hasOwn = (key) => Object.prototype.hasOwnProperty.call(value, key);
  const types = (type) => Array.isArray(type) ? type : [type];
  if (!schemaTypeMatches(value, schema.type)) errors.push('type');
  for (const key of schema.required || []) if (!hasOwn(key)) errors.push('required:' + key);
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) if (!Object.prototype.hasOwnProperty.call(schema.properties || {}, key)) errors.push('additionalProperties:' + key);
  }
  for (const [key, rule] of Object.entries(schema.properties || {})) {
    if (!hasOwn(key)) continue;
    if (Object.prototype.hasOwnProperty.call(rule, 'const') && value[key] !== rule.const) errors.push('const:' + key);
    if (rule.enum && !rule.enum.includes(value[key])) errors.push('enum:' + key);
    if (rule.type && !types(rule.type).some((type) => schemaTypeMatches(value[key], type))) errors.push('type:' + key);
    if (typeof value[key] === 'string') {
      if (rule.minLength !== undefined && value[key].length < rule.minLength) errors.push('minLength:' + key);
      if (rule.pattern && !new RegExp(rule.pattern).test(value[key])) errors.push('pattern:' + key);
    }
    if (Number.isInteger(value[key])) {
      if (rule.minimum !== undefined && value[key] < rule.minimum) errors.push('minimum:' + key);
      if (rule.maximum !== undefined && value[key] > rule.maximum) errors.push('maximum:' + key);
    }
  }
  return errors;
}

const productionKernel = require(runtimePath);

const TEST_ONLY_EXPORT = '__testCreateTrustedAuthorityContext';

function loadInstrumentedTestKernel() {
  const source = fs.readFileSync(runtimePath, 'utf8');
  const exportMarker = 'module.exports = publicApi;';
  assert.equal(source.includes(exportMarker), true);
  const instrumentedSource = source.replace(exportMarker, `publicApi.${TEST_ONLY_EXPORT} = createTrustedAuthorityContext;\n${exportMarker}`);
  const testModule = { exports: {} };
  const testRequire = moduleApi.createRequire(runtimePath);
  const wrapper = vm.runInThisContext(`(function (exports, require, module, __filename, __dirname) {\n${instrumentedSource}\n})`, { filename: `${runtimePath} [test-harness]` });
  wrapper(testModule.exports, testRequire, testModule, runtimePath, path.dirname(runtimePath));
  assert.equal(typeof testModule.exports[TEST_ONLY_EXPORT], 'function');
  return testModule.exports;
}

const kernel = loadInstrumentedTestKernel();

const ROOT = 'C:\\fixture\\workspace\\repo';
const WORKTREE = `${ROOT}\\worktree`;
const NOW = '2026-08-16T14:00:00.000Z';
const TRUSTED_CONTROLLER = {
  role: 'controller',
  identity: 'controller-fixture',
  provider: 'OpenAI',
  model: 'GPT-5.6 Luna / Max',
  assignment: 'run-110-a1-control-plane-kernel-g3-110',
  finality_claim: false,
  allowed_operation_types: ['github.mutation', 'filesystem.delete', 'filesystem.write', 'filesystem.create', 'filesystem.move', 'git.push', 'git.branch', 'network.request'],
};

function createTrustedAuthority(options = {}) {
  const { authority: authorityOverrides = {}, ...storeOptions } = options;
  return kernel[TEST_ONLY_EXPORT]({ ...TRUSTED_CONTROLLER, ...authorityOverrides }, storeOptions);
}

function baseInput(operation, overrides = {}) {
  return {
    enabled: true,
    activation: { mode: 'explicit-local', consented: true },
    now: NOW,
    repository: {
      root: ROOT,
      worktree: WORKTREE,
      remote: 'https://github.com/weijunswj/ai-agent-toolkit.git',
      resolution: { status: 'resolved', link_type: 'none' },
    },
    authority: {
      role: 'executor',
      identity: 'executor-fixture',
      provider: 'OpenAI',
      model: 'GPT-5.6 Luna / Max',
      assignment: 'run-110-a1-control-plane-kernel-g3-110',
      finality_claim: false,
      allowed_operation_types: [operation.type],
    },
    operation,
    ...overrides,
  };
}

function target(relativePath, overrides = {}) {
  const canonicalPath = `${ROOT}\\${relativePath}`;
  return {
    path: canonicalPath,
    resolution: {
      status: 'resolved',
      canonical_path: canonicalPath,
      link_type: 'none',
      ...overrides,
    },
  };
}

function routineRead(relativePath = 'src\\file.txt') {
  return { type: 'filesystem.read', target: target(relativePath) };
}

function ticketRequest(operation, session = {}, overrides = {}) {
  return {
    session_id: session.session_id || 'session-1',
    turn_id: session.turn_id || 'turn-1',
    call_id: session.call_id || 'call-1',
    operation_type: operation.type,
    operation_digest: kernel.operationDigest(operation),
    target_digest: kernel.targetDigest(operation),
    scope: 'repo:weijunswj/ai-agent-toolkit',
    max_uses: 1,
    expires_at: '2026-08-16T14:05:00.000Z',
    ...overrides,
  };
}

test('default-off refusal is side-effect free and privacy-minimized', () => {
  const input = baseInput(routineRead());
  delete input.enabled;
  delete input.activation;
  const before = structuredClone(input);
  const result = kernel.evaluate(input);
  assert.equal(result.decision, 'unsupported');
  assert.equal(result.reason_code, 'CONTROL_PLANE_DEFAULT_OFF');
  assert.equal(result.privacy_safe, true);
  assert.deepEqual(input, before);
  assert.equal(JSON.stringify(result).includes(ROOT), false);
});

test('remote identity runtime and schema share one credential-free contract', () => {
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  assert.equal(schema.$id, kernel.CONTRACT_VERSION);
  assert.equal(schema.$defs.remoteIdentity.properties.contract_version.const, kernel.REMOTE_IDENTITY_CONTRACT_VERSION);
  assert.equal(schema.$defs.remoteIdentity.additionalProperties, false);
  const remoteIdentitySchema = schema.$defs.remoteIdentity;
  for (const value of [
    'https://github.com/weijunswj/ai-agent-toolkit.git',
    'ssh://git@github.com:22/weijunswj/ai-agent-toolkit.git',
    'git@github.com:weijunswj/ai-agent-toolkit.git',
  ]) {
    const result = kernel.validateRemoteIdentity(value);
    assert.equal(result.valid, true, value);
    const schemaErrors = validateJsonSchemaObject(result, remoteIdentitySchema);
    assert.deepEqual(schemaErrors, [], value + ': ' + schemaErrors.join('; '));
  }
  for (const value of [
    'https://user:secret@example.com/repo.git',
    'https://github.com/repo.git?token=synthetic',
    'https://github.com',
    'https://[::1]:65536/repo.git',
    'git@@github.com:repo.git',
    'git@github.com:',
    'C:\\fixture\\repo',
    '\\\\server\\share',
    './relative/repo',
  ]) assert.equal(kernel.validateRemoteIdentity(value).valid, false, value);
});

test('unknown resolver link types fail closed before normalization', () => {
  const result = kernel.evaluate(baseInput(routineRead(), {
    repository: {
      root: ROOT,
      worktree: WORKTREE,
      remote: 'https://github.com/weijunswj/ai-agent-toolkit.git',
      resolution: { status: 'resolved', link_type: 'future-link-type' },
    },
  }));
  assert.equal(result.decision, 'unsupported');
  assert.equal(result.reason_code, 'UNKNOWN_RESOLVER_LINK_TYPE');
});

test('resolver raw/canonical conflicts fail closed before target or ticket decisions', () => {
  const outsideRaw = 'C:\\fixture\\workspace\\sibling\\outside.txt';
  const safeCanonical = ROOT + '\\src\\safe.txt';
  const conflictingTarget = (rawPath) => ({
    path: rawPath,
    resolution: { status: 'resolved', canonical_path: safeCanonical, link_type: 'none', existence: 'existing' },
  });

  const direct = kernel.evaluate(baseInput({ type: 'filesystem.read', target: conflictingTarget(outsideRaw) }));
  assert.notEqual(direct.decision, 'allow');
  assert.equal(direct.reason_code, 'TARGET_CONTEXT_CONFLICT');

  const sensitive = kernel.evaluate(baseInput({ type: 'filesystem.read', target: conflictingTarget(ROOT + '\\.env.synthetic') }));
  assert.notEqual(sensitive.decision, 'allow');
  assert.equal(sensitive.reason_code, 'TARGET_CONTEXT_CONFLICT');
  assert.equal(sensitive.secret_classification, 'confirmed');

  const operation = {
    type: 'compound',
    components: [
      { type: 'filesystem.read', target: conflictingTarget(ROOT + '\\.env.synthetic') },
      {
        type: 'network.request',
        source: conflictingTarget(ROOT + '\\.env.synthetic'),
        destination: { kind: 'external-system', digest: 'a'.repeat(64) },
        method: 'POST',
      },
    ],
  };
  const trusted = createTrustedAuthority({ now: NOW });
  const ticket = trusted.issue(ticketRequest(operation));
  const transmitted = kernel.evaluate(baseInput(operation, {
    authority: TRUSTED_CONTROLLER,
    ticket,
    session: { session_id: 'session-1', turn_id: 'turn-1', call_id: 'call-1' },
    scope: ticket.scope,
  }), { trustedAuthorityContext: trusted });
  assert.notEqual(transmitted.decision, 'allow');
  assert.notEqual(transmitted.reason_code, 'TICKET_CONSUMED');
  assert.notEqual(transmitted.ticket_status, 'consumed');
  assert.equal(transmitted.secret_classification, 'confirmed');

  const consistent = kernel.evaluate(baseInput({ type: 'filesystem.read', target: target('src\\safe.txt') }));
  assert.equal(consistent.decision, 'allow');
});

test('mixed external and filesystem target representations fail closed', () => {
  const safeCanonical = ROOT + '\\src\\safe.txt';
  const mixedTarget = (rawPath) => ({
    kind: 'external-system',
    digest: 'a'.repeat(64),
    path: rawPath,
    resolution: { status: 'resolved', canonical_path: safeCanonical, link_type: 'none', existence: 'existing' },
  });

  for (const rawPath of [ROOT + '\\.env.synthetic', 'C:\\fixture\\workspace\\sibling\\outside.txt']) {
    const direct = kernel.evaluate(baseInput({ type: 'filesystem.read', target: mixedTarget(rawPath) }));
    assert.notEqual(direct.decision, 'allow', rawPath);
    assert.notEqual(direct.secret_classification, 'none', rawPath);
  }

  const operation = {
    type: 'compound',
    components: [
      { type: 'git.read' },
      {
        type: 'network.request',
        source: mixedTarget(ROOT + '\\.env.synthetic'),
        destination: { kind: 'external-system', digest: 'b'.repeat(64) },
        method: 'POST',
      },
    ],
  };
  const trusted = createTrustedAuthority({ now: NOW, authority: { allowed_operation_types: ['git.read', 'network.request'] } });
  const ticket = trusted.issue(ticketRequest(operation));
  const transmitted = kernel.evaluate(baseInput(operation, {
    authority: TRUSTED_CONTROLLER,
    ticket,
    session: { session_id: 'session-1', turn_id: 'turn-1', call_id: 'call-1' },
    scope: ticket.scope,
  }), { trustedAuthorityContext: trusted });
  assert.notEqual(transmitted.decision, 'allow');
  assert.notEqual(transmitted.reason_code, 'TICKET_CONSUMED');
  assert.notEqual(transmitted.ticket_status, 'consumed');
  assert.notEqual(transmitted.secret_classification, 'none');

  const externalOperation = {
    type: 'github.mutation',
    repository: 'weijunswj/ai-agent-toolkit',
    action: 'inspect',
    target: { kind: 'github-repository', digest: 'c'.repeat(64) },
  };
  const externalTrusted = createTrustedAuthority({ now: NOW });
  const externalTicket = externalTrusted.issue(ticketRequest(externalOperation));
  const externalPositive = kernel.evaluate(baseInput(externalOperation, {
    authority: TRUSTED_CONTROLLER,
    ticket: externalTicket,
    session: { session_id: 'session-1', turn_id: 'turn-1', call_id: 'call-1' },
    scope: externalTicket.scope,
  }), { trustedAuthorityContext: externalTrusted });
  assert.equal(externalPositive.decision, 'allow');
  const pathPositive = kernel.evaluate(baseInput({ type: 'filesystem.read', target: target('src\\safe.txt') }));
  assert.equal(pathPositive.decision, 'allow');
});

test('typed operations refuse opaque shell syntax, including all eleven shell-adversarial forms', () => {
  const commands = [
    'find . -delete',
    'find . -exec rm -f {} +',
    'sed -i synthetic file.txt',
    'cat input>output',
    'sed -n 1p input>output',
    'git push --follow-tags origin main',
    "cat .en{v,v.prod}",
    "cat $'.env'",
    'git branch -f topic HEAD~2',
    'cat repo/file.txt; git commit -m synthetic',
    'rd /s "\\\\server\\share"',
  ];
  for (const command of commands) {
    const result = kernel.evaluate(baseInput({ type: 'shell', shell: 'posix', command }));
    assert.notEqual(result.decision, 'allow', command);
    assert.equal(result.reason_code, 'OPAQUE_OPERATION_UNSUPPORTED', command);
  }
});

test('overwrite/no-clobber authority is typed and destination-bound', () => {
  const existing = kernel.evaluate(baseInput({
    type: 'filesystem.create',
    target: target('src\\existing.txt', { existence: 'existing' }),
    no_clobber: false,
  }));
  assert.equal(existing.decision, 'ask');
  assert.equal(existing.reason_code, 'OVERWRITE_APPROVAL_REQUIRED');
  const absent = kernel.evaluate(baseInput({
    type: 'filesystem.create',
    target: target('src\\new.txt', { existence: 'absent' }),
    no_clobber: true,
  }));
  assert.equal(absent.decision, 'allow');
  assert.equal(absent.operation_type, 'filesystem.create');
});

test('mutating git branch modes and broadened push options cannot reach routine allow', () => {
  const branch = kernel.evaluate(baseInput({ type: 'git.branch', mode: 'move', branch: 'topic' }));
  assert.equal(branch.decision, 'ask');
  assert.equal(branch.reason_code, 'MUTATING_GIT_OPERATION_REQUIRES_TICKET');
  const push = kernel.evaluate(baseInput({
    type: 'git.push',
    remote: 'origin',
    refspecs: ['HEAD:refs/heads/topic'],
    options: ['--follow-tags'],
    authorized_remote: 'origin',
    authorized_ref: 'refs/heads/topic',
  }));
  assert.notEqual(push.decision, 'allow');
  assert.equal(push.reason_code, 'BROADENED_PUSH_TARGET_UNSUPPORTED');
});

test('git push options use a narrow typed allowlist', () => {
  const unsafeOptions = [
    '--repo',
    '--repo=ssh://git@attacker.example/repo.git',
    '--prune',
    '-d',
    '--delete',
    '--tags',
    '--all',
    '--mirror',
    '--follow-tags',
    '--recurse-submodules',
    '--recurse-submodules=on-demand',
  ];
  for (const option of unsafeOptions) {
    const operation = {
      type: 'git.push',
      remote: 'origin',
      refspecs: ['HEAD:refs/heads/topic'],
      options: [option],
      authorized_remote: 'origin',
      authorized_ref: 'refs/heads/topic',
    };
    const trusted = createTrustedAuthority({ now: NOW });
    const ticket = trusted.issue(ticketRequest(operation));
    const result = kernel.evaluate(baseInput(operation, {
      authority: TRUSTED_CONTROLLER,
      ticket,
      session: { session_id: 'session-1', turn_id: 'turn-1', call_id: 'call-1' },
      scope: ticket.scope,
    }), { trustedAuthorityContext: trusted });
    assert.notEqual(result.decision, 'allow', option);
    assert.notEqual(result.reason_code, 'TICKET_CONSUMED', option);
    assert.notEqual(result.ticket_status, 'consumed', option);
  }

  for (const option of ['--porcelain', '--dry-run']) {
    const operation = {
      type: 'git.push',
      remote: 'origin',
      refspecs: ['HEAD:refs/heads/topic'],
      options: [option],
      authorized_remote: 'origin',
      authorized_ref: 'refs/heads/topic',
    };
    const trusted = createTrustedAuthority({ now: NOW });
    const ticket = trusted.issue(ticketRequest(operation));
    const result = kernel.evaluate(baseInput(operation, {
      authority: TRUSTED_CONTROLLER,
      ticket,
      session: { session_id: 'session-1', turn_id: 'turn-1', call_id: 'call-1' },
      scope: ticket.scope,
    }), { trustedAuthorityContext: trusted });
    assert.equal(result.decision, 'allow', option);
    assert.equal(result.reason_code, 'TICKET_CONSUMED', option);
  }
});

test('git push remote names are closed and option-like values cannot consume tickets', () => {
  const unsafeRemotes = [
    '--mirror',
    '--all',
    '--repo=ssh://git@attacker.example/repo.git',
    '-d',
    '--receive-pack=synthetic',
    'ssh://attacker.example/repo.git',
  ];
  for (const remote of unsafeRemotes) {
    const operation = {
      type: 'git.push',
      remote,
      refspecs: ['HEAD:refs/heads/topic'],
      options: ['--porcelain'],
      authorized_remote: remote,
      authorized_ref: 'refs/heads/topic',
    };
    const trusted = createTrustedAuthority({ now: NOW });
    const ticket = trusted.issue(ticketRequest(operation));
    const result = kernel.evaluate(baseInput(operation, {
      authority: TRUSTED_CONTROLLER,
      ticket,
      session: { session_id: 'session-1', turn_id: 'turn-1', call_id: 'call-1' },
      scope: ticket.scope,
    }), { trustedAuthorityContext: trusted });
    assert.notEqual(result.decision, 'allow', remote);
    assert.notEqual(result.reason_code, 'TICKET_CONSUMED', remote);
    assert.notEqual(result.ticket_status, 'consumed', remote);
  }

  const safeOperation = {
    type: 'git.push',
    remote: 'origin',
    refspecs: ['HEAD:refs/heads/topic'],
    options: ['--porcelain'],
    authorized_remote: 'origin',
    authorized_ref: 'refs/heads/topic',
  };
  const trusted = createTrustedAuthority({ now: NOW });
  const ticket = trusted.issue(ticketRequest(safeOperation));
  const result = kernel.evaluate(baseInput(safeOperation, {
    authority: TRUSTED_CONTROLLER,
    ticket,
    session: { session_id: 'session-1', turn_id: 'turn-1', call_id: 'call-1' },
    scope: ticket.scope,
  }), { trustedAuthorityContext: trusted });
  assert.equal(result.decision, 'allow');
  assert.equal(result.reason_code, 'TICKET_CONSUMED');
});

test('secret classification is derived and sensitive boundaries fail closed', () => {
  const read = kernel.evaluate(baseInput({ type: 'filesystem.read', target: target('.env.synthetic', { existence: 'existing' }) }));
  assert.equal(read.secret_classification, 'confirmed');
  assert.equal(read.decision, 'ask');
  assert.equal(read.reason_code, 'SECRET_ACCESS_REQUIRES_TICKET');
  const exfiltration = kernel.evaluate(baseInput({
    type: 'network.request',
    source: target('.env.synthetic', { existence: 'existing' }),
    destination: { kind: 'external-system', digest: 'a'.repeat(64) },
  }));
  assert.equal(exfiltration.secret_classification, 'confirmed');
  assert.equal(exfiltration.decision, 'deny');
  assert.equal(exfiltration.reason_code, 'SECRET_EXFILTRATION_DENIED');
});

test('catastrophic UNC share roots are denied even when a ticket is supplied', () => {
  const result = kernel.evaluate(baseInput({
    type: 'filesystem.delete',
    target: { path: '\\\\server\\share', resolution: { status: 'resolved', canonical_path: '\\\\server\\share', link_type: 'none' } },
  }));
  assert.equal(result.decision, 'deny');
  assert.equal(result.reason_code, 'CATASTROPHIC_TARGET_DENIED');
});

test('compound authority validates every typed component, not only the winning decision', () => {
  const result = kernel.evaluate(baseInput({
    type: 'compound',
    components: [routineRead('src\\file.txt'), { type: 'git.branch', mode: 'rename', branch: 'topic' }],
  }, {
    authority: {
      role: 'executor',
      provider: 'OpenAI',
      model: 'GPT-5.6 Luna / Max',
      assignment: 'run-110-a1-control-plane-kernel-g3-110',
      finality_claim: false,
      allowed_operation_types: ['filesystem.read'],
    },
  }));
  assert.notEqual(result.decision, 'allow');
  assert.equal(result.reason_code, 'COMPONENT_AUTHORITY_REQUIRED');
});

test('compound hard denies dominate unsupported components in every order', () => {
  const opaque = { type: 'shell', shell: 'posix', command: 'opaque synthetic command' };
  const secret = {
    type: 'network.request',
    source: target('.env.synthetic', { existence: 'existing' }),
    destination: { kind: 'external-system', digest: 'd'.repeat(64) },
    method: 'POST',
  };
  for (const components of [[opaque, secret], [secret, opaque]]) {
    const result = kernel.evaluate(baseInput({ type: 'compound', components }, {
      authority: { ...baseInput(routineRead()).authority, allowed_operation_types: ['shell', 'network.request'] },
    }));
    assert.equal(result.decision, 'deny');
    assert.equal(result.reason_code, 'SECRET_EXFILTRATION_DENIED');
  }

  const catastrophic = {
    type: 'filesystem.delete',
    target: { path: ROOT, resolution: { status: 'resolved', canonical_path: ROOT, link_type: 'none' } },
  };
  for (const components of [[opaque, catastrophic], [catastrophic, opaque]]) {
    const result = kernel.evaluate(baseInput({ type: 'compound', components }, {
      authority: { ...baseInput(routineRead()).authority, allowed_operation_types: ['shell', 'filesystem.delete'] },
    }));
    assert.equal(result.decision, 'deny');
    assert.equal(result.reason_code, 'CATASTROPHIC_TARGET_DENIED');
  }

  const benign = kernel.evaluate(baseInput({
    type: 'compound',
    components: [routineRead('src\\safe.txt'), { type: 'git.read' }],
  }, {
    authority: { ...baseInput(routineRead()).authority, allowed_operation_types: ['filesystem.read', 'git.read'] },
  }));
  assert.equal(benign.decision, 'allow');
});

test('caller finality claims and untruthful authority identity are rejected', () => {
  const finality = kernel.evaluate(baseInput(routineRead(), {
    authority: {
      role: 'executor', provider: 'OpenAI', model: 'GPT-5.6 Luna / Max', assignment: 'run-110-a1-control-plane-kernel-g3-110', finality_claim: true, allowed_operation_types: ['filesystem.read'],
    },
  }));
  assert.equal(finality.decision, 'deny');
  assert.equal(finality.reason_code, 'CALLER_FINALITY_REJECTED');
  const identity = kernel.evaluate(baseInput(routineRead(), {
    authority: {
      role: 'Web/controller', provider: '', model: '', assignment: 'run-110-a1-control-plane-kernel-g3-110', finality_claim: false, allowed_operation_types: ['filesystem.read'],
    },
  }));
  assert.equal(identity.decision, 'unsupported');
  assert.equal(identity.reason_code, 'AUTHORITY_IDENTITY_INVALID');
});

test('one-shot tickets bind operation/session/turn/call and controller GitHub authority is consumed once', () => {
  const trusted = createTrustedAuthority({ now: NOW, authority: { allowed_operation_types: ['github.mutation'] } });
  const operation = { type: 'github.mutation', repository: 'weijunswj/ai-agent-toolkit', action: 'draft-pull-request', target: { kind: 'github-repository', digest: 'b'.repeat(64) } };
  const ticket = trusted.issue(ticketRequest(operation));
  const authority = { ...TRUSTED_CONTROLLER, identity: 'caller-claimed-controller', provider: 'caller-provider', model: 'caller-model', assignment: 'caller-assignment' };
  const accepted = kernel.evaluate(baseInput(operation, { authority, ticket, session: { session_id: 'session-1', turn_id: 'turn-1', call_id: 'call-1' }, scope: 'repo:weijunswj/ai-agent-toolkit' }), { trustedAuthorityContext: trusted, ticketStore: { consume: () => ({ valid: true, reason_code: 'FAKE_CONSUMED' }) } });
  assert.equal(accepted.decision, 'allow');
  assert.equal(accepted.reason_code, 'TICKET_CONSUMED');
  const replay = kernel.evaluate(baseInput(operation, { authority, ticket, session: { session_id: 'session-1', turn_id: 'turn-1', call_id: 'call-1' }, scope: 'repo:weijunswj/ai-agent-toolkit' }), { trustedAuthorityContext: trusted });
  assert.equal(replay.decision, 'deny');
  assert.equal(replay.reason_code, 'TICKET_REPLAY');
});

test('ticket replay is bounded and expired/exhausted slots are reclaimed', () => {
  let now = Date.parse(NOW);
  const trusted = createTrustedAuthority({ now: () => now, maxEntries: 2, maxLifetimeMs: 60_000 });
  const operation = { type: 'filesystem.delete', target: target('src\\file.txt') };
  const ticket = trusted.issue({ ...ticketRequest(operation), max_uses: 2, expires_at: '2026-08-16T14:00:30.000Z' });
  const input = () => baseInput(operation, { authority: TRUSTED_CONTROLLER, ticket, session: { session_id: 'session-1', turn_id: 'turn-1', call_id: 'call-1' }, scope: ticket.scope });
  assert.equal(kernel.evaluate(input(), { trustedAuthorityContext: trusted }).decision, 'allow');
  assert.equal(kernel.evaluate(input(), { trustedAuthorityContext: trusted }).decision, 'allow');
  const replay = kernel.evaluate(input(), { trustedAuthorityContext: trusted });
  assert.equal(replay.reason_code, 'TICKET_REPLAY');
  assert.equal(trusted.size(), 0);
  const expiring = trusted.issue({ ...ticketRequest(operation), call_id: 'call-2', expires_at: '2026-08-16T14:00:10.000Z' });
  assert.equal(trusted.size(), 1);
  now += 11_000;
  assert.equal(trusted.compact(), 1);
  assert.equal(trusted.size(), 0);
  assert.ok(expiring);
});

test('structural impact is deterministic and keeps the temporary #342 rule active', () => {
  const structural = kernel.assessStructuralImpact({ kind: 'rename', identity: 'operation.authority' });
  assert.equal(structural.required, true);
  assert.equal(structural.search_scope, 'targeted-repo-wide');
  assert.ok(structural.consumer_categories.includes('source-shape-tests'));
  assert.equal(structural.compatibility_rule.issue, 342);
  assert.equal(structural.compatibility_rule.status, 'active-until-propagation-verification');
  const local = kernel.assessStructuralImpact({ kind: 'value-change', identity: 'timeout-ms' });
  assert.equal(local.required, false);
  assert.equal(local.search_scope, 'local');
});

test('structural impact uses a closed deterministic kind contract', () => {
  for (const kind of ['rename', 'remove', 'move', 'resignature', 're-signature', 'contract-shape', 'generated-surface', 'path', 'symbol', 'command', 'schema-field', 'public-contract', 'internal-contract', 'repository-identity', 'structural-replace', 'replace']) {
    const result = kernel.assessStructuralImpact({ kind, identity: 'operation.authority' });
    assert.equal(result.valid, true, kind);
    assert.equal(result.required, true, kind);
    assert.equal(result.search_scope, 'targeted-repo-wide', kind);
  }

  for (const kind of ['unknown-kind', 'Rename']) {
    const result = kernel.assessStructuralImpact({ kind, identity: 'operation.authority' });
    assert.equal(result.valid, false, kind);
    assert.equal(result.decision, 'unsupported', kind);
    assert.equal(result.reason_code, 'STRUCTURAL_IMPACT_KIND_UNSUPPORTED', kind);
    assert.equal(result.compatibility_rule.issue, 342, kind);
    assert.equal(result.compatibility_rule.status, 'active-until-propagation-verification', kind);
  }

  const extraField = kernel.assessStructuralImpact({ kind: 'value-change', identity: 'timeout-ms', scope: 'synthetic' });
  assert.equal(extraField.valid, false);
  assert.equal(extraField.reason_code, 'STRUCTURAL_IMPACT_FIELDS_UNSUPPORTED');
  const local = kernel.assessStructuralImpact({ kind: 'value-change', identity: 'timeout-ms' });
  assert.equal(local.valid, true);
  assert.equal(local.required, false);
  assert.equal(local.search_scope, 'local');
});

test('typed operations reject unmodeled mutation fields and missing external targets', () => {
  const opaque = kernel.evaluate(baseInput({ type: 'git.read', command: 'git branch -f topic HEAD~2' }));
  assert.equal(opaque.decision, 'unsupported');
  assert.equal(opaque.reason_code, 'TYPED_OPERATION_FIELDS_UNSUPPORTED');
  const missingTarget = kernel.evaluate(baseInput({
    type: 'github.mutation',
    repository: 'weijunswj/ai-agent-toolkit',
    action: 'draft-pull-request',
  }));
  assert.equal(missingTarget.decision, 'unsupported');
  assert.equal(missingTarget.reason_code, 'TYPED_OPERATION_REQUIRED');
});
test('catastrophic delete roots remain hard-denied through compound composition', () => {
  const cases = [
    ['repository-root', ROOT],
    ['drive-root', 'C:\\'],
    ['unc-share-root', '\\\\server\\share'],
  ];
  for (const [label, rootPath] of cases) {
    const deleteTarget = { path: rootPath, resolution: { status: 'resolved', canonical_path: rootPath, link_type: 'none' } };
    const direct = kernel.evaluate(baseInput({ type: 'filesystem.delete', target: deleteTarget }));
    assert.equal(direct.decision, 'deny', `${label} direct decision`);
    assert.equal(direct.reason_code, 'CATASTROPHIC_TARGET_DENIED', `${label} direct reason`);
    const compound = kernel.evaluate(baseInput({
      type: 'compound',
      components: [routineRead(), { type: 'filesystem.delete', target: deleteTarget }],
    }, { authority: { ...baseInput(routineRead()).authority, allowed_operation_types: ['filesystem.read', 'filesystem.delete'] } }));
    assert.equal(compound.decision, 'deny', `${label} compound decision`);
    assert.equal(compound.reason_code, 'CATASTROPHIC_TARGET_DENIED', `${label} compound reason`);
  }
});

test('compound hard denies cannot be routed through aggregate ticket authority', () => {
  const secretOperation = {
    type: 'network.request',
    source: target('.env.synthetic', { existence: 'existing' }),
    destination: { kind: 'external-system', digest: 'a'.repeat(64) },
  };
  const secret = kernel.evaluate(baseInput({
    type: 'compound',
    components: [routineRead(), secretOperation],
  }, { authority: { ...baseInput(routineRead()).authority, allowed_operation_types: ['filesystem.read', 'network.request'] } }));
  assert.equal(secret.decision, 'deny');
  assert.equal(secret.reason_code, 'SECRET_EXFILTRATION_DENIED');

  const githubOperation = { type: 'github.mutation', repository: 'weijunswj/ai-agent-toolkit', action: 'draft-pull-request', target: { kind: 'github-repository', digest: 'b'.repeat(64) } };
  const compoundOperation = { type: 'compound', components: [routineRead(), githubOperation] };
  const trusted = createTrustedAuthority({ now: NOW, authority: { role: 'executor', identity: 'executor-fixture', allowed_operation_types: ['filesystem.read', 'github.mutation'] } });
  const ticket = trusted.issue(ticketRequest(compoundOperation));
  const github = kernel.evaluate(baseInput(compoundOperation, {
    authority: { ...baseInput(routineRead()).authority, allowed_operation_types: ['filesystem.read', 'github.mutation'] },
    ticket,
    session: { session_id: 'session-1', turn_id: 'turn-1', call_id: 'call-1' },
    scope: 'repo:weijunswj/ai-agent-toolkit',
  }), { trustedAuthorityContext: trusted });
  assert.equal(github.decision, 'deny');
  assert.equal(github.reason_code, 'CONTROLLER_GITHUB_AUTHORITY_REQUIRED');
});

test('ticket issuer trust and retained scope are part of consumption binding', () => {
  const operation = { type: 'github.mutation', repository: 'weijunswj/ai-agent-toolkit', action: 'draft-pull-request', target: { kind: 'github-repository', digest: 'c'.repeat(64) } };
  const authority = TRUSTED_CONTROLLER;
  const trusted = createTrustedAuthority({ now: NOW });
  const executorTrusted = createTrustedAuthority({ now: NOW, authority: { role: 'executor', identity: 'executor-fixture' } });
  const executorTicket = executorTrusted.issue(ticketRequest(operation));
  const trustedScope = kernel.evaluate(baseInput(operation, {
    authority,
    ticket: executorTicket,
    session: { session_id: 'session-1', turn_id: 'turn-1', call_id: 'call-1' },
    scope: 'repo:weijunswj/ai-agent-toolkit',
  }), { trustedAuthorityContext: trusted });
  assert.equal(trustedScope.decision, 'deny');
  assert.equal(trustedScope.reason_code, 'TICKET_AUTHORITY_CONTEXT_MISMATCH');

  const controllerTicket = trusted.issue({ ...ticketRequest(operation), call_id: 'call-2' });
  const wrongScope = kernel.evaluate(baseInput(operation, {
    authority,
    ticket: controllerTicket,
    session: { session_id: 'session-1', turn_id: 'turn-1', call_id: 'call-2' },
    scope: 'repo:other/repository',
  }), { trustedAuthorityContext: trusted });
  assert.equal(wrongScope.decision, 'deny');
  assert.equal(wrongScope.reason_code, 'TICKET_BINDING_MISMATCH');
});

test('arbitrary ticket stores cannot claim controller GitHub consumption', () => {
  const operation = { type: 'github.mutation', repository: 'weijunswj/ai-agent-toolkit', action: 'draft-pull-request', target: { kind: 'github-repository', digest: 'd'.repeat(64) } };
  const trusted = createTrustedAuthority({ now: NOW });
  const ticket = trusted.issue(ticketRequest(operation));
  const authority = { ...TRUSTED_CONTROLLER, identity: 'caller-claimed-controller', provider: 'Attacker', model: 'forged-model', assignment: 'forged-assignment' };
  const result = kernel.evaluate(baseInput(operation, { authority, ticket }), {
    ticketStore: { consume: () => ({ valid: true, reason_code: 'TICKET_CONSUMED' }) },
  });
  assert.equal(result.decision, 'deny');
  assert.equal(result.reason_code, 'CONTROLLER_TRUST_SOURCE_REQUIRED');
});

test('public kernel has no self-mint store or production trusted-fixture path', () => {
  assert.equal(typeof productionKernel.createTicketStore, 'undefined');
  assert.equal(typeof productionKernel.createTestTrustedAuthorityFixture, 'undefined');
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  const child = childProcess.execFileSync(process.execPath, ['-e', `const k = require(${JSON.stringify(runtimePath)}); process.stdout.write(JSON.stringify({ store: typeof k.createTicketStore, fixture: typeof k.createTestTrustedAuthorityFixture }));`], { encoding: 'utf8', env: childEnv });
  assert.deepEqual(JSON.parse(child), { store: 'undefined', fixture: 'undefined' });
});

test('forged test markers cannot expose a trusted fixture from ordinary production loading', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a1-kernel-forged-entry-'));
  const entryPath = path.join(tempRoot, 'forged-entry.test.cjs');
  const entrySource = [
    "'use strict';",
    `const k = require(${JSON.stringify(runtimePath)});`,
    'const authoritySurfaceKeys = Reflect.ownKeys(k).filter((key) => /trusted|fixture|ticket.?store/i.test(String(key)));',
    'process.stdout.write(JSON.stringify({ fixture: typeof k.createTestTrustedAuthorityFixture, constructor: typeof k.createTrustedAuthorityContext, store: typeof k.createTicketStore, authoritySurfaceKeys }));',
  ].join('\n');
  const childEnv = { ...process.env, NODE_TEST_CONTEXT: 'forged-by-caller' };
  try {
    fs.writeFileSync(entryPath, entrySource, 'utf8');
    const child = childProcess.execFileSync(process.execPath, [entryPath], { encoding: 'utf8', env: childEnv });
    assert.deepEqual(JSON.parse(child), { fixture: 'undefined', constructor: 'undefined', store: 'undefined', authoritySurfaceKeys: [] });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('caller-declared controller identity cannot obtain GitHub authority without a trusted context', () => {
  const operation = { type: 'github.mutation', repository: 'weijunswj/ai-agent-toolkit', action: 'draft-pull-request', target: { kind: 'github-repository', digest: 'e'.repeat(64) } };
  const trusted = createTrustedAuthority({ now: NOW });
  const ticket = trusted.issue(ticketRequest(operation));
  const result = kernel.evaluate(baseInput(operation, {
    authority: { ...TRUSTED_CONTROLLER, identity: 'arbitrary-request-identity', provider: 'arbitrary-provider', model: 'arbitrary-model', assignment: 'arbitrary-assignment' },
    ticket,
  }), { ticketStore: { consume: () => ({ valid: true, reason_code: 'TICKET_CONSUMED' }) } });
  assert.equal(result.decision, 'deny');
  assert.equal(result.reason_code, 'CONTROLLER_TRUST_SOURCE_REQUIRED');
});

test('copied or forged tickets cannot authorize through a bound context', () => {
  const operation = { type: 'github.mutation', repository: 'weijunswj/ai-agent-toolkit', action: 'draft-pull-request', target: { kind: 'github-repository', digest: 'f'.repeat(64) } };
  const trusted = createTrustedAuthority({ now: NOW });
  const ticket = trusted.issue(ticketRequest(operation));
  const copied = { ...ticket };
  const forged = Object.freeze({ ...ticket, ticket_id: '0'.repeat(64) });
  for (const candidate of [copied, forged]) {
    const result = kernel.evaluate(baseInput(operation, { authority: TRUSTED_CONTROLLER, ticket: candidate, scope: ticket.scope }), { trustedAuthorityContext: trusted });
    assert.equal(result.decision, 'deny');
    assert.equal(result.reason_code, 'TICKET_INVALID');
  }
});

test('cross-authority-context and cross-store tickets cannot authorize', () => {
  const operation = { type: 'github.mutation', repository: 'weijunswj/ai-agent-toolkit', action: 'draft-pull-request', target: { kind: 'github-repository', digest: '1'.repeat(64) } };
  const issuer = createTrustedAuthority({ now: NOW });
  const otherContext = createTrustedAuthority({ now: NOW });
  const ticket = issuer.issue(ticketRequest(operation));
  const result = kernel.evaluate(baseInput(operation, { authority: TRUSTED_CONTROLLER, ticket, scope: ticket.scope }), { trustedAuthorityContext: otherContext });
  assert.equal(result.decision, 'deny');
  assert.equal(result.reason_code, 'TICKET_AUTHORITY_CONTEXT_MISMATCH');
});

test('trusted issuer identity, provider, model, and assignment are immutable authority bindings', () => {
  const operation = { type: 'github.mutation', repository: 'weijunswj/ai-agent-toolkit', action: 'draft-pull-request', target: { kind: 'github-repository', digest: '2'.repeat(64) } };
  for (const [field, value] of [['identity', 'wrong-identity'], ['provider', 'WrongProvider'], ['model', 'WrongModel'], ['assignment', 'wrong-assignment']]) {
    const issuer = createTrustedAuthority({ now: NOW });
    const wrongContext = createTrustedAuthority({ now: NOW, authority: { [field]: value } });
    const ticket = issuer.issue(ticketRequest(operation));
    const result = kernel.evaluate(baseInput(operation, { authority: { ...TRUSTED_CONTROLLER, [field]: 'caller-value' }, ticket, scope: ticket.scope }), { trustedAuthorityContext: wrongContext });
    assert.equal(result.decision, 'deny', field);
    assert.equal(result.reason_code, 'TICKET_AUTHORITY_CONTEXT_MISMATCH', field);
  }
});

test('ticket issuer fields cannot be supplied in the issue request', () => {
  const operation = { type: 'filesystem.delete', target: target('src\\file.txt') };
  const trusted = createTrustedAuthority({ now: NOW });
  assert.throws(() => trusted.issue({ ...ticketRequest(operation), issuer: { role: 'controller', identity: 'attacker' } }), /TICKET_ISSUER_INPUT_FORBIDDEN/);
});

test('scope, session, turn, call, operation, and target changes fail binding', () => {
  const original = { type: 'filesystem.delete', target: target('src\\file.txt') };
  const cases = [
    ['scope', (input) => ({ ...input, scope: 'repo:other/repository' })],
    ['session', (input) => ({ ...input, session: { ...input.session, session_id: 'session-2' } })],
    ['turn', (input) => ({ ...input, session: { ...input.session, turn_id: 'turn-2' } })],
    ['call', (input) => ({ ...input, session: { ...input.session, call_id: 'call-2' } })],
    ['operation', (input) => ({ ...input, operation: { type: 'filesystem.write', target: input.operation.target, no_clobber: false } })],
    ['target', (input) => ({ ...input, operation: { ...input.operation, target: target('src\\other.txt') } })],
  ];
  for (const [label, mutate] of cases) {
    const trusted = createTrustedAuthority({ now: NOW });
    const ticket = trusted.issue(ticketRequest(original));
    const base = baseInput(original, { authority: TRUSTED_CONTROLLER, ticket, session: { session_id: 'session-1', turn_id: 'turn-1', call_id: 'call-1' }, scope: ticket.scope });
    const result = kernel.evaluate(mutate(base), { trustedAuthorityContext: trusted });
    assert.equal(result.decision, 'deny', label);
    assert.equal(result.reason_code, 'TICKET_BINDING_MISMATCH', label);
  }
});

test('filesystem.move validates source and destination cardinality and binding', () => {
  const makeMove = (sourcePath = 'src\\source.txt', destinationPath = 'src\\destination.txt', destinationExistence = 'absent', noClobber = true) => ({
    type: 'filesystem.move',
    source: target(sourcePath, { existence: 'existing' }),
    destination: target(destinationPath, { existence: destinationExistence }),
    no_clobber: noClobber,
  });
  const accept = (operation) => {
    const trusted = createTrustedAuthority({ now: NOW, authority: { allowed_operation_types: ['filesystem.move'] } });
    const ticket = trusted.issue(ticketRequest(operation));
    const result = kernel.evaluate(baseInput(operation, {
      authority: TRUSTED_CONTROLLER,
      ticket,
      session: { session_id: 'session-1', turn_id: 'turn-1', call_id: 'call-1' },
      scope: ticket.scope,
    }), { trustedAuthorityContext: trusted });
    assert.equal(result.decision, 'allow');
    assert.equal(result.reason_code, 'TICKET_CONSUMED');
  };

  const bounded = makeMove();
  accept(bounded);

  const missingSource = kernel.evaluate(baseInput({
    type: 'filesystem.move',
    destination: target('src\\destination.txt', { existence: 'absent' }),
    no_clobber: true,
  }));
  assert.equal(missingSource.decision, 'unsupported');
  assert.equal(missingSource.reason_code, 'TYPED_OPERATION_REQUIRED');

  const missingDestination = kernel.evaluate(baseInput({
    type: 'filesystem.move',
    source: target('src\\source.txt', { existence: 'existing' }),
    no_clobber: true,
  }));
  assert.equal(missingDestination.decision, 'unsupported');
  assert.equal(missingDestination.reason_code, 'TYPED_OPERATION_REQUIRED');

  const extraTarget = kernel.evaluate(baseInput({ ...bounded, target: target('src\\extra.txt') }));
  assert.equal(extraTarget.decision, 'unsupported');
  assert.equal(extraTarget.reason_code, 'TYPED_OPERATION_FIELDS_UNSUPPORTED');

  const overwriteOperation = makeMove('src\\source.txt', 'src\\existing-destination.txt', 'existing', false);
  const overwrite = kernel.evaluate(baseInput(overwriteOperation));
  assert.equal(overwrite.decision, 'ask');
  assert.equal(overwrite.reason_code, 'OVERWRITE_APPROVAL_REQUIRED');
  accept(overwriteOperation);

  const bindingTrusted = createTrustedAuthority({ now: NOW, authority: { allowed_operation_types: ['filesystem.move'] } });
  const bindingTicket = bindingTrusted.issue(ticketRequest(bounded));
  const bindingInput = (operation) => kernel.evaluate(baseInput(operation, {
    authority: TRUSTED_CONTROLLER,
    ticket: bindingTicket,
    session: { session_id: 'session-1', turn_id: 'turn-1', call_id: 'call-1' },
    scope: bindingTicket.scope,
  }), { trustedAuthorityContext: bindingTrusted });
  const changedSource = bindingInput({ ...bounded, source: target('src\\other-source.txt', { existence: 'existing' }) });
  assert.equal(changedSource.decision, 'deny');
  assert.equal(changedSource.reason_code, 'TICKET_BINDING_MISMATCH');
  const changedDestination = bindingInput({ ...bounded, destination: target('src\\other-destination.txt', { existence: 'absent' }) });
  assert.equal(changedDestination.decision, 'deny');
  assert.equal(changedDestination.reason_code, 'TICKET_BINDING_MISMATCH');
});

test('fixture manifest required case IDs are executed exactly once', () => {
  const probeRegistry = [];
  assert.throws(() => registerFixtureCaseIds(['undeclared-fixture-case'], probeRegistry), /not declared by the manifest/);
  registerFixtureCaseIds(['default-off'], probeRegistry);
  assert.throws(() => registerFixtureCaseIds(['default-off'], probeRegistry), /executed more than once/);
  assert.equal(new Set(requiredFixtureCaseIds).size, requiredFixtureCaseIds.length, 'fixture manifest case IDs must be unique');
  assert.deepEqual([...executedFixtureCaseIds].sort(), [...requiredFixtureCaseIds].sort(), 'fixture manifest and executed case inventory differ');
});
