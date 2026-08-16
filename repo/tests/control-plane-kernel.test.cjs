'use strict';

const assert = require('node:assert/strict');
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

function ticketRequest(operation, session = {}) {
  return {
    issuer: { role: 'controller', identity: 'controller-fixture', provider: 'OpenAI', model: 'GPT-5.6 Luna / Max', assignment: 'run-110-a1-control-plane-kernel-g3-110', finality_claim: false, allowed_operation_types: [operation.type] },
    session_id: session.session_id || 'session-1',
    turn_id: session.turn_id || 'turn-1',
    call_id: session.call_id || 'call-1',
    operation_type: operation.type,
    operation_digest: kernel.operationDigest(operation),
    target_digest: kernel.targetDigest(operation),
    scope: 'repo:weijunswj/ai-agent-toolkit',
    max_uses: 1,
    expires_at: '2026-08-16T14:05:00.000Z',
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
  const store = kernel.createTicketStore({ now: NOW });
  const operation = { type: 'github.mutation', repository: 'weijunswj/ai-agent-toolkit', action: 'draft-pull-request', target: { kind: 'github-repository', digest: 'b'.repeat(64) } };
  const ticket = store.issue(ticketRequest(operation));
  const authority = { role: 'controller', identity: 'controller-fixture', provider: 'OpenAI', model: 'GPT-5.6 Luna / Max', assignment: 'run-110-a1-control-plane-kernel-g3-110', finality_claim: false, allowed_operation_types: ['github.mutation'] };
  const accepted = kernel.evaluate(baseInput(operation, { authority, ticket, session: { session_id: 'session-1', turn_id: 'turn-1', call_id: 'call-1' }, scope: 'repo:weijunswj/ai-agent-toolkit' }), { ticketStore: store });
  assert.equal(accepted.decision, 'allow');
  assert.equal(accepted.reason_code, 'TICKET_CONSUMED');
  const replay = kernel.evaluate(baseInput(operation, { authority, ticket, session: { session_id: 'session-1', turn_id: 'turn-1', call_id: 'call-1' }, scope: 'repo:weijunswj/ai-agent-toolkit' }), { ticketStore: store });
  assert.equal(replay.decision, 'deny');
  assert.equal(replay.reason_code, 'TICKET_REPLAY');
});

test('ticket replay is bounded and expired/exhausted slots are reclaimed', () => {
  let now = Date.parse(NOW);
  const store = kernel.createTicketStore({ now: () => now, maxEntries: 2, maxLifetimeMs: 60_000 });
  const operation = { type: 'filesystem.delete', target: target('src\\file.txt') };
  const ticket = store.issue({ ...ticketRequest(operation), max_uses: 2, expires_at: '2026-08-16T14:00:30.000Z' });
  const request = { issuer_role: ticket.issuer_role, issuer_identity_digest: ticket.issuer_identity_digest, issuer_authority_digest: ticket.issuer_authority_digest, session_id: 'session-1', turn_id: 'turn-1', call_id: 'call-1', operation_type: operation.type, operation_digest: kernel.operationDigest(operation), target_digest: kernel.targetDigest(operation), scope: ticket.scope };
  assert.equal(store.consume(ticket, request).valid, true);
  assert.equal(store.consume(ticket, request).valid, true);
  assert.equal(store.consume(ticket, request).reason_code, 'TICKET_REPLAY');
  assert.equal(store.size(), 0);
  const expiring = store.issue({ ...ticketRequest(operation), call_id: 'call-2', expires_at: '2026-08-16T14:00:10.000Z' });
  assert.equal(store.size(), 1);
  now += 11_000;
  assert.equal(store.compact(), 1);
  assert.equal(store.size(), 0);
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
  const store = kernel.createTicketStore({ now: NOW });
  const ticket = store.issue(ticketRequest(compoundOperation));
  const github = kernel.evaluate(baseInput(compoundOperation, {
    authority: { ...baseInput(routineRead()).authority, allowed_operation_types: ['filesystem.read', 'github.mutation'] },
    ticket,
    session: { session_id: 'session-1', turn_id: 'turn-1', call_id: 'call-1' },
    scope: 'repo:weijunswj/ai-agent-toolkit',
  }), { ticketStore: store });
  assert.equal(github.decision, 'deny');
  assert.equal(github.reason_code, 'CONTROLLER_GITHUB_AUTHORITY_REQUIRED');
});

test('ticket issuer trust and retained scope are part of consumption binding', () => {
  const operation = { type: 'github.mutation', repository: 'weijunswj/ai-agent-toolkit', action: 'draft-pull-request', target: { kind: 'github-repository', digest: 'c'.repeat(64) } };
  const authority = { role: 'controller', identity: 'controller-fixture', provider: 'OpenAI', model: 'GPT-5.6 Luna / Max', assignment: 'run-110-a1-control-plane-kernel-g3-110', finality_claim: false, allowed_operation_types: ['github.mutation'] };
  const store = kernel.createTicketStore({ now: NOW });
  const executorTicket = store.issue({ ...ticketRequest(operation), issuer: { role: 'executor', identity: 'executor-fixture', provider: 'OpenAI', model: 'GPT-5.6 Luna / Max', assignment: 'run-110-a1-control-plane-kernel-g3-110', finality_claim: false, allowed_operation_types: ['github.mutation'] } });
  const trustedScope = kernel.evaluate(baseInput(operation, {
    authority,
    ticket: executorTicket,
    session: { session_id: 'session-1', turn_id: 'turn-1', call_id: 'call-1' },
    scope: 'repo:weijunswj/ai-agent-toolkit',
  }), { ticketStore: store });
  assert.equal(trustedScope.decision, 'deny');
  assert.equal(trustedScope.reason_code, 'TICKET_TRUST_MISMATCH');

  const controllerTicket = store.issue({ ...ticketRequest(operation), call_id: 'call-2' });
  const wrongScope = kernel.evaluate(baseInput(operation, {
    authority,
    ticket: controllerTicket,
    session: { session_id: 'session-1', turn_id: 'turn-1', call_id: 'call-2' },
    scope: 'repo:other/repository',
  }), { ticketStore: store });
  assert.equal(wrongScope.decision, 'deny');
  assert.equal(wrongScope.reason_code, 'TICKET_BINDING_MISMATCH');
});
