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
  ['safe observation rejects unknown resolver links before policy routing', ['unknown-resolver-link-type']],
  ['raw and canonical target conflicts retain deny-relevant evidence', ['resolver-raw-canonical-conflict']],
  ['external and filesystem target representations never mix', ['external-digest-target-union']],
  ['opaque shell syntax never reaches routine allow', ['mutating-nominal-read', 'attached-redirection', 'hidden-shell-expansion']],
  ['overwrite and no-clobber decisions stay destination-bound', ['overwrite-no-clobber']],
  ['git branch and push widening stay outside routine allow', ['broadened-push-target', 'mutating-git-branch']],
  ['typed git push options have a narrow allowlist', ['git-push-typed-options']],
  ['git push remote names are closed and option-like values cannot consume tickets', ['git-push-remote-typed']],
  ['secret classification and sensitive boundaries fail closed', ['secret-classification']],
  ['protected UNC share roots remain hard-denied', ['unc-share-root']],
  ['compound authority validates every component', ['compound-component-role-limit']],
  ['hard-deny precedence is independent of component order', ['compound-hard-deny-composition', 'compound-hard-deny-precedence']],
  ['caller finality and untruthful roles are rejected', ['caller-finality']],
  ['controller GitHub tickets are opaque and one-shot', ['controller-github-one-shot']],
  ['ticket replay compacts expired and exhausted slots', ['replay-slot-reclamation']],
  ['structural impact remains deterministic while #342 is active', ['structural-impact']],
  ['structural impact uses a closed kind contract', ['structural-impact-closed-kinds']],
  ['ticket issuer authority is immutable and trusted', ['trusted-issuer-authority']],
  ['arbitrary ticket stores cannot claim controller authority', ['fake-ticket-store-denied']],
  ['copied and forged ticket identities cannot authorize', ['copied-ticket-denied']],
  ['cross-context and cross-store tickets cannot authorize', ['cross-authority-context-denied', 'trusted-authority-provenance']],
  ['ticket bindings include scope and all call coordinates', ['ticket-scope-binding']],
  ['filesystem.move requires both endpoints and binds both', ['filesystem-move-cardinality']],
  ['invalid shape without hard deny stays unsupported', ['invalid-without-hard-deny']],
]);

function registerFixtureCaseIds(caseIds, registry = executedFixtureCaseIds) {
  for (const caseId of caseIds) {
    assert.equal(requiredFixtureCaseIdSet.has(caseId), true, `fixture case is not declared by the manifest: ${caseId}`);
    assert.equal(registry.includes(caseId), false, `fixture case executed more than once: ${caseId}`);
    registry.push(caseId);
  }
}

const test = (name, fn) => nodeTest.test(name, async (...args) => {
  const result = fn(...args);
  if (result && typeof result.then === 'function') await result;
  registerFixtureCaseIds(fixtureCaseIdsByTestName.get(name) || []);
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
  for (const key of schema.required || []) if (!hasOwn(key)) errors.push(`required:${key}`);
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) if (!Object.prototype.hasOwnProperty.call(schema.properties || {}, key)) errors.push(`additionalProperties:${key}`);
  }
  for (const [key, rule] of Object.entries(schema.properties || {})) {
    if (!hasOwn(key)) continue;
    if (Object.prototype.hasOwnProperty.call(rule, 'const') && value[key] !== rule.const) errors.push(`const:${key}`);
    if (rule.enum && !rule.enum.includes(value[key])) errors.push(`enum:${key}`);
    if (rule.type && !types(rule.type).some((type) => schemaTypeMatches(value[key], type))) errors.push(`type:${key}`);
    if (typeof value[key] === 'string') {
      if (rule.minLength !== undefined && value[key].length < rule.minLength) errors.push(`minLength:${key}`);
      if (rule.pattern && !new RegExp(rule.pattern).test(value[key])) errors.push(`pattern:${key}`);
    }
    if (Number.isInteger(value[key])) {
      if (rule.minimum !== undefined && value[key] < rule.minimum) errors.push(`minimum:${key}`);
      if (rule.maximum !== undefined && value[key] > rule.maximum) errors.push(`maximum:${key}`);
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
  const instrumentedSource = source.replace(
    exportMarker,
    `publicApi.${TEST_ONLY_EXPORT} = createTrustedAuthorityContext;\n${exportMarker}`
  );
  const testModule = { exports: {} };
  const testRequire = moduleApi.createRequire(runtimePath);
  const wrapper = vm.runInThisContext(
    `(function (exports, require, module, __filename, __dirname) {\n${instrumentedSource}\n})`,
    { filename: `${runtimePath} [test-harness]` }
  );
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
  assignment: 'run-127-a1-soir-r1-g3-127',
  finality_claim: false,
  allowed_operation_types: [
    'github.mutation',
    'filesystem.delete',
    'filesystem.write',
    'filesystem.create',
    'filesystem.move',
    'git.push',
    'git.branch',
    'network.request',
  ],
};

function createTrustedAuthority(options = {}) {
  const { authority: authorityOverrides = {}, ...storeOptions } = options;
  return kernel[TEST_ONLY_EXPORT]({ ...TRUSTED_CONTROLLER, ...authorityOverrides }, { now: () => Date.parse(NOW), ...storeOptions });
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
      assignment: 'run-127-a1-soir-r1-g3-127',
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

function evaluateWithTicket(operation, trusted, overrides = {}) {
  const ticket = trusted.issue(ticketRequest(operation, overrides.session, overrides.ticket));
  return {
    ticket,
    result: kernel.evaluate(baseInput(operation, {
      authority: TRUSTED_CONTROLLER,
      ticket,
      session: {
        session_id: 'session-1',
        turn_id: 'turn-1',
        call_id: 'call-1',
        ...(overrides.session || {}),
      },
      scope: ticket.scope,
      ...(overrides.input || {}),
    }), { trustedAuthorityContext: trusted }),
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
  for (const value of [
    'https://github.com/weijunswj/ai-agent-toolkit.git',
    'ssh://git@github.com:22/weijunswj/ai-agent-toolkit.git',
    'git@github.com:weijunswj/ai-agent-toolkit.git',
  ]) {
    const result = kernel.validateRemoteIdentity(value);
    assert.equal(result.valid, true, value);
    assert.deepEqual(validateJsonSchemaObject(result, schema.$defs.remoteIdentity), [], value);
    assert.equal(kernel.formatRemoteIdentity(value), result.canonical);
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

test('safe observation rejects unknown resolver links before policy routing', () => {
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

test('raw and canonical target conflicts retain deny-relevant evidence', () => {
  const safeCanonical = `${ROOT}\\src\\safe.txt`;
  const conflictingTarget = (rawPath) => ({
    path: rawPath,
    resolution: { status: 'resolved', canonical_path: safeCanonical, link_type: 'none', existence: 'existing' },
  });
  const direct = kernel.evaluate(baseInput({ type: 'filesystem.read', target: conflictingTarget(`${ROOT}\\outside.txt`) }));
  assert.equal(direct.decision, 'unsupported');
  assert.equal(direct.reason_code, 'TARGET_CONTEXT_CONFLICT');
  const sensitive = kernel.evaluate(baseInput({ type: 'filesystem.read', target: conflictingTarget(`${ROOT}\\.env.synthetic`) }));
  assert.equal(sensitive.reason_code, 'TARGET_CONTEXT_CONFLICT');
  assert.equal(sensitive.secret_classification, 'confirmed');
});

test('external and filesystem target representations never mix', () => {
  const mixed = {
    kind: 'external-system',
    digest: 'a'.repeat(64),
    path: `${ROOT}\\.env.synthetic`,
    resolution: { status: 'resolved', canonical_path: `${ROOT}\\src\\safe.txt`, link_type: 'none' },
  };
  const result = kernel.evaluate(baseInput({ type: 'filesystem.read', target: mixed }));
  assert.notEqual(result.decision, 'allow');
  assert.notEqual(result.secret_classification, 'none');
});

test('opaque shell syntax never reaches routine allow', () => {
  for (const command of [
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
  ]) {
    const result = kernel.evaluate(baseInput({ type: 'shell', shell: 'posix', command }));
    assert.notEqual(result.decision, 'allow', command);
    assert.equal(result.reason_code, 'OPAQUE_OPERATION_UNSUPPORTED', command);
  }
});

test('overwrite and no-clobber decisions stay destination-bound', () => {
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
});

test('git branch and push widening stay outside routine allow', () => {
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
  assert.equal(push.reason_code, 'BROADENED_PUSH_TARGET_UNSUPPORTED');
});

test('typed git push options have a narrow allowlist', () => {
  for (const option of ['--repo', '--prune', '-d', '--delete', '--tags', '--all', '--mirror', '--follow-tags', '--recurse-submodules']) {
    const operation = {
      type: 'git.push',
      remote: 'origin',
      refspecs: ['HEAD:refs/heads/topic'],
      options: [option],
      authorized_remote: 'origin',
      authorized_ref: 'refs/heads/topic',
    };
    const trusted = createTrustedAuthority({ authority: { allowed_operation_types: ['git.push'] } });
    const { result } = evaluateWithTicket(operation, trusted);
    assert.notEqual(result.decision, 'allow', option);
    assert.notEqual(result.ticket_status, 'consumed', option);
  }
  const operation = {
    type: 'git.push',
    remote: 'origin',
    refspecs: ['HEAD:refs/heads/topic'],
    options: ['--porcelain'],
    authorized_remote: 'origin',
    authorized_ref: 'refs/heads/topic',
  };
  const trusted = createTrustedAuthority({ authority: { allowed_operation_types: ['git.push'] } });
  const { result } = evaluateWithTicket(operation, trusted);
  assert.equal(result.decision, 'allow');
  assert.equal(result.reason_code, 'TICKET_CONSUMED');
});

test('git push remote names are closed and option-like values cannot consume tickets', () => {
  for (const remote of ['--mirror', '--all', '--repo=ssh://git@attacker.example/repo.git', '-d', 'ssh://attacker.example/repo.git']) {
    const operation = {
      type: 'git.push',
      remote,
      refspecs: ['HEAD:refs/heads/topic'],
      options: ['--porcelain'],
      authorized_remote: remote,
      authorized_ref: 'refs/heads/topic',
    };
    const trusted = createTrustedAuthority({ authority: { allowed_operation_types: ['git.push'] } });
    const { result } = evaluateWithTicket(operation, trusted);
    assert.notEqual(result.decision, 'allow', remote);
    assert.notEqual(result.ticket_status, 'consumed', remote);
  }
});

test('secret classification and sensitive boundaries fail closed', () => {
  const read = kernel.evaluate(baseInput({ type: 'filesystem.read', target: target('.env.synthetic', { existence: 'existing' }) }));
  assert.equal(read.secret_classification, 'confirmed');
  assert.equal(read.decision, 'ask');
  assert.equal(read.reason_code, 'SECRET_ACCESS_REQUIRES_TICKET');
  const exfiltration = kernel.evaluate(baseInput({
    type: 'network.request',
    source: target('.env.synthetic', { existence: 'existing' }),
    destination: { kind: 'external-system', digest: 'a'.repeat(64) },
    method: 'POST',
  }));
  assert.equal(exfiltration.secret_classification, 'confirmed');
  assert.equal(exfiltration.decision, 'deny');
  assert.equal(exfiltration.reason_code, 'SECRET_EXFILTRATION_DENIED');
});

test('protected UNC share roots remain hard-denied', () => {
  const operation = {
    type: 'filesystem.delete',
    target: { path: '\\\\server\\share', resolution: { status: 'resolved', canonical_path: '\\\\server\\share', link_type: 'none' } },
  };
  const result = kernel.evaluate(baseInput(operation));
  assert.equal(result.decision, 'deny');
  assert.equal(result.reason_code, 'CATASTROPHIC_TARGET_DENIED');
  assert.equal(kernel.isUncShareRoot('\\\\server\\share'), true);
});

test('compound authority validates every component', () => {
  const result = kernel.evaluate(baseInput({
    type: 'compound',
    components: [routineRead(), { type: 'git.branch', mode: 'rename', branch: 'topic' }],
  }, {
    authority: {
      role: 'executor',
      identity: 'executor-fixture',
      provider: 'OpenAI',
      model: 'GPT-5.6 Luna / Max',
      assignment: 'run-127-a1-soir-r1-g3-127',
      finality_claim: false,
      allowed_operation_types: ['filesystem.read'],
    },
  }));
  assert.equal(result.decision, 'unsupported');
  assert.equal(result.reason_code, 'COMPONENT_AUTHORITY_REQUIRED');
});

test('hard-deny precedence is independent of component order', () => {
  const opaque = { type: 'shell', shell: 'posix', command: 'opaque synthetic command' };
  const secret = {
    type: 'network.request',
    source: target('.env.synthetic', { existence: 'existing' }),
    destination: { kind: 'external-system', digest: 'd'.repeat(64) },
    method: 'POST',
  };
  const catastrophic = {
    type: 'filesystem.delete',
    target: { path: ROOT, resolution: { status: 'resolved', canonical_path: ROOT, link_type: 'none' } },
  };
  for (const components of [[opaque, secret], [secret, opaque]]) {
    const result = kernel.evaluate(baseInput({ type: 'compound', components }, {
      authority: { ...baseInput(routineRead()).authority, allowed_operation_types: ['shell', 'network.request'] },
    }));
    assert.equal(result.decision, 'deny');
    assert.equal(result.reason_code, 'SECRET_EXFILTRATION_DENIED');
  }
  for (const components of [[opaque, catastrophic], [catastrophic, opaque]]) {
    const result = kernel.evaluate(baseInput({ type: 'compound', components }, {
      authority: { ...baseInput(routineRead()).authority, allowed_operation_types: ['shell', 'filesystem.delete'] },
    }));
    assert.equal(result.decision, 'deny');
    assert.equal(result.reason_code, 'CATASTROPHIC_TARGET_DENIED');
  }
});

test('caller finality and untruthful roles are rejected', () => {
  const finality = kernel.evaluate(baseInput(routineRead(), {
    authority: { ...baseInput(routineRead()).authority, finality_claim: true },
  }));
  assert.equal(finality.decision, 'deny');
  assert.equal(finality.reason_code, 'CALLER_FINALITY_REJECTED');
  const identity = kernel.evaluate(baseInput(routineRead(), {
    authority: { role: 'Web/controller', identity: '', provider: '', model: '', assignment: '', finality_claim: false, allowed_operation_types: ['filesystem.read'] },
  }));
  assert.equal(identity.decision, 'unsupported');
  assert.equal(identity.reason_code, 'AUTHORITY_IDENTITY_INVALID');
});

test('controller GitHub tickets are opaque and one-shot', () => {
  const operation = {
    type: 'github.mutation',
    repository: 'weijunswj/ai-agent-toolkit',
    action: 'draft-pull-request',
    target: { kind: 'github-repository', digest: 'b'.repeat(64) },
  };
  const trusted = createTrustedAuthority({ authority: { allowed_operation_types: ['github.mutation'] } });
  const ticket = trusted.issue(ticketRequest(operation));
  const result = kernel.evaluate(baseInput(operation, {
    authority: { ...TRUSTED_CONTROLLER, identity: 'caller-claimed-controller', provider: 'caller-provider', model: 'caller-model', assignment: 'caller-assignment' },
    ticket,
    session: { session_id: 'session-1', turn_id: 'turn-1', call_id: 'call-1' },
    scope: ticket.scope,
  }), { trustedAuthorityContext: trusted, ticketStore: { consume: () => ({ valid: true, reason_code: 'FAKE_CONSUMED' }) } });
  assert.equal(result.decision, 'allow');
  assert.equal(result.reason_code, 'TICKET_CONSUMED');
  const replay = kernel.evaluate(baseInput(operation, {
    authority: TRUSTED_CONTROLLER,
    ticket,
    session: { session_id: 'session-1', turn_id: 'turn-1', call_id: 'call-1' },
    scope: ticket.scope,
  }), { trustedAuthorityContext: trusted });
  assert.equal(replay.decision, 'deny');
  assert.equal(replay.reason_code, 'TICKET_REPLAY');
});

test('ticket replay compacts expired and exhausted slots', () => {
  let now = Date.parse(NOW);
  const trusted = createTrustedAuthority({ now: () => now, maxEntries: 2, maxLifetimeMs: 60_000, authority: { allowed_operation_types: ['filesystem.delete'] } });
  const operation = { type: 'filesystem.delete', target: target('src\\file.txt') };
  const ticket = trusted.issue({ ...ticketRequest(operation), max_uses: 2, expires_at: '2026-08-16T14:00:30.000Z' });
  const input = () => kernel.evaluate(baseInput(operation, { authority: TRUSTED_CONTROLLER, ticket, session: { session_id: 'session-1', turn_id: 'turn-1', call_id: 'call-1' }, scope: ticket.scope }), { trustedAuthorityContext: trusted });
  assert.equal(input().decision, 'allow');
  const second = kernel.evaluate(baseInput(operation, { authority: TRUSTED_CONTROLLER, ticket, session: { session_id: 'session-1', turn_id: 'turn-1', call_id: 'call-1' }, scope: ticket.scope }), { trustedAuthorityContext: trusted });
  assert.equal(second.decision, 'allow');
  const replay = kernel.evaluate(baseInput(operation, { authority: TRUSTED_CONTROLLER, ticket, session: { session_id: 'session-1', turn_id: 'turn-1', call_id: 'call-1' }, scope: ticket.scope }), { trustedAuthorityContext: trusted });
  assert.equal(replay.reason_code, 'TICKET_REPLAY');
  assert.equal(trusted.size(), 0);
  const expiring = trusted.issue({ ...ticketRequest(operation), call_id: 'call-2', expires_at: '2026-08-16T14:00:10.000Z' });
  assert.ok(expiring);
  now += 11_000;
  assert.equal(trusted.compact(), 1);
  assert.equal(trusted.size(), 0);
});

test('structural impact remains deterministic while #342 is active', () => {
  const structural = kernel.assessStructuralImpact({ kind: 'rename', identity: 'operation.authority' });
  assert.equal(structural.valid, true);
  assert.equal(structural.required, true);
  assert.equal(structural.search_scope, 'targeted-repo-wide');
  assert.ok(structural.consumer_categories.includes('source-shape-tests'));
  assert.equal(structural.compatibility_rule.issue, 342);
  assert.equal(structural.compatibility_rule.status, 'active-until-propagation-verification');
  const local = kernel.assessStructuralImpact({ kind: 'value-change', identity: 'timeout-ms' });
  assert.equal(local.required, false);
  assert.equal(local.search_scope, 'local');
});

test('structural impact uses a closed kind contract', () => {
  for (const kind of ['rename', 'remove', 'move', 'resignature', 're-signature', 'contract-shape', 'generated-surface', 'path', 'symbol', 'command', 'schema-field', 'public-contract', 'internal-contract', 'repository-identity', 'structural-replace', 'replace']) {
    const result = kernel.assessStructuralImpact({ kind, identity: 'operation.authority' });
    assert.equal(result.valid, true, kind);
    assert.equal(result.required, true, kind);
  }
  for (const kind of ['unknown-kind', 'Rename']) {
    const result = kernel.assessStructuralImpact({ kind, identity: 'operation.authority' });
    assert.equal(result.valid, false, kind);
    assert.equal(result.reason_code, 'STRUCTURAL_IMPACT_KIND_UNSUPPORTED', kind);
  }
  const extra = kernel.assessStructuralImpact({ kind: 'value-change', identity: 'timeout-ms', scope: 'synthetic' });
  assert.equal(extra.reason_code, 'STRUCTURAL_IMPACT_FIELDS_UNSUPPORTED');
});

test('ticket issuer authority is immutable and trusted', () => {
  const operation = { type: 'github.mutation', repository: 'weijunswj/ai-agent-toolkit', action: 'draft-pull-request', target: { kind: 'github-repository', digest: 'c'.repeat(64) } };
  const issuer = createTrustedAuthority();
  const other = createTrustedAuthority({ authority: { identity: 'different-controller' } });
  const ticket = issuer.issue(ticketRequest(operation));
  const mismatch = kernel.evaluate(baseInput(operation, { authority: TRUSTED_CONTROLLER, ticket, scope: ticket.scope }), { trustedAuthorityContext: other });
  assert.equal(mismatch.decision, 'deny');
  assert.equal(mismatch.reason_code, 'TICKET_AUTHORITY_CONTEXT_MISMATCH');
  assert.throws(() => issuer.issue({ ...ticketRequest(operation), issuer: { role: 'controller' } }), /TICKET_ISSUER_INPUT_FORBIDDEN/);
});

test('arbitrary ticket stores cannot claim controller authority', () => {
  const operation = { type: 'github.mutation', repository: 'weijunswj/ai-agent-toolkit', action: 'draft-pull-request', target: { kind: 'github-repository', digest: 'd'.repeat(64) } };
  const result = kernel.evaluate(baseInput(operation, { authority: TRUSTED_CONTROLLER, ticket: {} }), { ticketStore: { consume: () => ({ valid: true, reason_code: 'TICKET_CONSUMED' }) } });
  assert.equal(result.decision, 'deny');
  assert.equal(result.reason_code, 'CONTROLLER_TRUST_SOURCE_REQUIRED');
});

test('copied and forged ticket identities cannot authorize', () => {
  const operation = { type: 'filesystem.delete', target: target('src\\file.txt') };
  const trusted = createTrustedAuthority({ authority: { allowed_operation_types: ['filesystem.delete'] } });
  const ticket = trusted.issue(ticketRequest(operation));
  const copied = { ...ticket };
  const copiedResult = kernel.evaluate(baseInput(operation, { authority: TRUSTED_CONTROLLER, ticket: copied, scope: ticket.scope }), { trustedAuthorityContext: trusted });
  assert.equal(copiedResult.decision, 'deny');
  assert.equal(copiedResult.reason_code, 'TICKET_INVALID');
  const forged = Object.create(Object.getPrototypeOf(ticket));
  const forgedResult = kernel.evaluate(baseInput(operation, { authority: TRUSTED_CONTROLLER, ticket: forged, scope: ticket.scope }), { trustedAuthorityContext: trusted });
  assert.equal(forgedResult.decision, 'deny');
  assert.equal(forgedResult.reason_code, 'TICKET_INVALID');
});

test('cross-context and cross-store tickets cannot authorize', () => {
  const operation = { type: 'filesystem.delete', target: target('src\\file.txt') };
  const first = createTrustedAuthority({ authority: { allowed_operation_types: ['filesystem.delete'] } });
  const second = createTrustedAuthority({ authority: { allowed_operation_types: ['filesystem.delete'] } });
  const ticket = first.issue(ticketRequest(operation));
  const result = kernel.evaluate(baseInput(operation, { authority: TRUSTED_CONTROLLER, ticket, scope: ticket.scope }), { trustedAuthorityContext: second });
  assert.equal(result.decision, 'deny');
  assert.equal(result.reason_code, 'TICKET_AUTHORITY_CONTEXT_MISMATCH');
});

test('ticket bindings include scope and all call coordinates', () => {
  const original = { type: 'filesystem.delete', target: target('src\\file.txt') };
  const trusted = createTrustedAuthority({ authority: { allowed_operation_types: ['filesystem.delete', 'filesystem.write'] } });
  const ticket = trusted.issue(ticketRequest(original));
  const base = baseInput(original, { authority: TRUSTED_CONTROLLER, ticket, session: { session_id: 'session-1', turn_id: 'turn-1', call_id: 'call-1' }, scope: ticket.scope });
  for (const mutate of [
    (input) => ({ ...input, scope: 'repo:other/repository' }),
    (input) => ({ ...input, session: { ...input.session, session_id: 'session-2' } }),
    (input) => ({ ...input, session: { ...input.session, turn_id: 'turn-2' } }),
    (input) => ({ ...input, session: { ...input.session, call_id: 'call-2' } }),
    (input) => ({ ...input, operation: { type: 'filesystem.write', target: input.operation.target, no_clobber: true } }),
    (input) => ({ ...input, operation: { ...input.operation, target: target('src\\other.txt') } }),
  ]) {
    const result = kernel.evaluate(mutate(base), { trustedAuthorityContext: trusted });
    assert.equal(result.decision, 'deny');
    assert.equal(result.reason_code, 'TICKET_BINDING_MISMATCH');
  }
});

test('filesystem.move requires both endpoints and binds both', () => {
  const missingSource = kernel.evaluate(baseInput({ type: 'filesystem.move', destination: target('src\\destination.txt', { existence: 'absent' }), no_clobber: true }));
  assert.equal(missingSource.decision, 'unsupported');
  assert.equal(missingSource.reason_code, 'TYPED_OPERATION_REQUIRED');
  const missingDestination = kernel.evaluate(baseInput({ type: 'filesystem.move', source: target('src\\source.txt', { existence: 'existing' }), no_clobber: true }));
  assert.equal(missingDestination.decision, 'unsupported');
  assert.equal(missingDestination.reason_code, 'TYPED_OPERATION_REQUIRED');
  const operation = { type: 'filesystem.move', source: target('src\\source.txt', { existence: 'existing' }), destination: target('src\\destination.txt', { existence: 'absent' }), no_clobber: true };
  const trusted = createTrustedAuthority({ authority: { allowed_operation_types: ['filesystem.move'] } });
  const ticket = trusted.issue(ticketRequest(operation));
  const changed = kernel.evaluate(baseInput({ ...operation, destination: target('src\\other.txt', { existence: 'absent' }) }, { authority: TRUSTED_CONTROLLER, ticket, session: { session_id: 'session-1', turn_id: 'turn-1', call_id: 'call-1' }, scope: ticket.scope }), { trustedAuthorityContext: trusted });
  assert.equal(changed.decision, 'deny');
  assert.equal(changed.reason_code, 'TICKET_BINDING_MISMATCH');
});

test('invalid shape without hard deny stays unsupported', () => {
  const operation = { type: 'compound', malformed_wrapper_field: 'synthetic', components: [{ type: 'git.read' }] };
  const result = kernel.evaluate(baseInput(operation));
  assert.equal(result.decision, 'unsupported');
  assert.equal(result.reason_code, 'TYPED_OPERATION_FIELDS_UNSUPPORTED');
  assert.equal(result.operation_digest, null);
  assert.equal(result.target_digest, null);
});

test('array length descriptor accepts a non-writable length', () => {
  const input = baseInput(routineRead());
  Object.defineProperty(input.authority.allowed_operation_types, 'length', { writable: false });
  const result = kernel.evaluate(input);
  assert.equal(result.decision, 'allow');
});

test('safe observation probes prototypes, accessors, symbols, cycles, and limits without raw rereads', () => {
  let getterCalls = 0;
  const accessorTarget = { resolution: { status: 'resolved', canonical_path: `${ROOT}\\src\\safe.txt`, link_type: 'none' } };
  Object.defineProperty(accessorTarget, 'path', { enumerable: true, get() { getterCalls += 1; return `${ROOT}\\src\\safe.txt`; } });
  const accessorResult = kernel.evaluate(baseInput({ type: 'filesystem.read', target: accessorTarget }));
  assert.equal(accessorResult.decision, 'unsupported');
  assert.equal(getterCalls, 0);

  const prototypeTarget = Object.create({ inherited: true });
  Object.defineProperties(prototypeTarget, {
    path: { value: `${ROOT}\\.env.synthetic`, enumerable: true },
    resolution: { value: { status: 'resolved', canonical_path: `${ROOT}\\.env.synthetic`, link_type: 'none' }, enumerable: true },
  });
  const prototypeResult = kernel.evaluate(baseInput({ type: 'filesystem.read', target: prototypeTarget }));
  assert.notEqual(prototypeResult.decision, 'allow');

  const cyclic = { type: 'compound', components: [] };
  cyclic.components.push(cyclic);
  const cycleResult = kernel.evaluate(baseInput(cyclic));
  assert.notEqual(cycleResult.decision, 'allow');

  const deep = { type: 'compound', components: [] };
  let cursor = deep;
  for (let i = 0; i < 40; i += 1) {
    const next = { type: 'compound', components: [] };
    cursor.components.push(next);
    cursor = next;
  }
  assert.notEqual(kernel.evaluate(baseInput(deep)).decision, 'allow');
});

test('opaque tickets stay outside observation and production has no self-mint surface', () => {
  assert.equal(typeof productionKernel.createTicketStore, 'undefined');
  assert.equal(typeof productionKernel.createTrustedAuthorityContext, 'undefined');
  const ticketPayload = { nested: { marker: 'synthetic-ticket-data' } };
  let trapCalls = 0;
  const ticketLike = new Proxy(ticketPayload, {
    get() { trapCalls += 1; throw new Error('ticket getter invoked'); },
    ownKeys() { trapCalls += 1; throw new Error('ticket ownKeys invoked'); },
    getPrototypeOf() { trapCalls += 1; throw new Error('ticket prototype invoked'); },
  });
  const result = kernel.evaluate(baseInput({ type: 'filesystem.write', target: target('src\\safe.txt'), no_clobber: true }, { ticket: ticketLike }));
  assert.equal(result.reason_code, 'TICKET_TRUST_SOURCE_REQUIRED');
  assert.equal(trapCalls, 0);
  assert.equal(Object.isFrozen(ticketPayload), false);
});

test('canonical digests ignore caller insertion order and never invoke toJSON', () => {
  let serializationCalls = 0;
  const first = routineRead('src\\digest.txt');
  const second = { target: first.target, type: 'filesystem.read' };
  Object.defineProperty(second, 'toJSON', { enumerable: true, value() { serializationCalls += 1; return { type: 'filesystem.delete', target: target(ROOT) }; } });
  assert.equal(kernel.operationDigest(first), kernel.operationDigest(second));
  assert.equal(serializationCalls, 0);
  assert.match(kernel.operationDigest(first), /^[a-f0-9]{64}$/);
  assert.match(kernel.targetDigest(first), /^[a-f0-9]{64}$/);
});

test('fixture manifest required case IDs are executed exactly once', () => {
  const probeRegistry = [];
  assert.throws(() => registerFixtureCaseIds(['undeclared-fixture-case'], probeRegistry), /not declared by the manifest/);
  registerFixtureCaseIds(['default-off'], probeRegistry);
  assert.throws(() => registerFixtureCaseIds(['default-off'], probeRegistry), /executed more than once/);
  assert.equal(new Set(requiredFixtureCaseIds).size, requiredFixtureCaseIds.length);
  assert.deepEqual([...executedFixtureCaseIds].sort(), [...requiredFixtureCaseIds].sort());
});

test('fresh A1 surface preserves the public schema and exact fixture extension', () => {
  assert.equal(fixtureManifest.contract_version, kernel.CONTRACT_VERSION);
  assert.equal(fixtureManifest.policy_version, kernel.POLICY.policy_version);
  assert.equal(requiredFixtureCaseIds.length, 32);
  assert.equal(requiredFixtureCaseIds.includes('invalid-without-hard-deny'), true);
  const result = kernel.evaluate(baseInput(routineRead()));
  assert.deepEqual(Object.keys(result).sort(), [
    'contract_version',
    'decision',
    'operation_type',
    'operation_class',
    'operation_digest',
    'privacy_safe',
    'reason_code',
    'secret_classification',
    'structural_impact_required',
    'target_class',
    'target_digest',
    'ticket_status',
  ].sort());
});

test('fresh test harness cannot expose trusted authority through forged markers', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a1-kernel-forged-entry-'));
  const entryPath = path.join(tempRoot, 'forged-entry.test.cjs');
  const entrySource = [
    "'use strict';",
    `const k = require(${JSON.stringify(runtimePath)});`,
    'process.stdout.write(JSON.stringify({ fixture: typeof k.createTrustedAuthorityContext, store: typeof k.createTicketStore }));',
  ].join('\n');
  const childEnv = { ...process.env, NODE_TEST_CONTEXT: 'forged-by-caller' };
  try {
    fs.writeFileSync(entryPath, entrySource, 'utf8');
    const child = childProcess.execFileSync(process.execPath, [entryPath], { encoding: 'utf8', env: childEnv });
    assert.deepEqual(JSON.parse(child), { fixture: 'undefined', store: 'undefined' });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
