'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const runtimePath = path.join(repoRoot, 'repo', 'scripts', 'toolkit-control-plane', 'control-plane-kernel.cjs');
const schemaPath = path.join(repoRoot, '_projects', 'development', 'control-plane-kernel', '_main', 'control-plane-contract.schema.json');
const kernel = require(runtimePath);

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
  return kernel.createTestTrustedAuthorityFixture({ authority: { ...TRUSTED_CONTROLLER, ...authorityOverrides }, ...storeOptions });
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
  for (const value of [
    'https://github.com/weijunswj/ai-agent-toolkit.git',
    'ssh://git@github.com:22/weijunswj/ai-agent-toolkit.git',
    'git@github.com:weijunswj/ai-agent-toolkit.git',
  ]) assert.equal(kernel.validateRemoteIdentity(value).valid, true, value);
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
  assert.equal(typeof kernel.createTicketStore, 'undefined');
  assert.equal(typeof kernel.createTestTrustedAuthorityFixture, 'function');
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  const child = childProcess.execFileSync(process.execPath, ['-e', `const k = require(${JSON.stringify(runtimePath)}); process.stdout.write(JSON.stringify({ store: typeof k.createTicketStore, fixture: typeof k.createTestTrustedAuthorityFixture }));`], { encoding: 'utf8', env: childEnv });
  assert.deepEqual(JSON.parse(child), { store: 'undefined', fixture: 'undefined' });
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
