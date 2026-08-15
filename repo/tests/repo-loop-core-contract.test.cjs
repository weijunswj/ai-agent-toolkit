'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const runtimePath = path.join(repoRoot, 'repo', 'scripts', 'repo-loop-core', 'repo-loop-core.cjs');

const SHA = 'a'.repeat(40);
const TREE = 'b'.repeat(40);
const DESIGN_LOCK = 'DL-318-LOOP-BOOTSTRAP-SLICE-A-001-A2';

function candidate(overrides = {}) {
  return {
    repository_id: 'weijunswj/ai-agent-toolkit',
    remote_url: 'https://github.com/weijunswj/ai-agent-toolkit.git',
    child: 318,
    pull_request: 401,
    branch: 'luna/318-a1-loop-core-contract-default-off',
    base: SHA,
    merge_base: SHA,
    head: SHA,
    tree: TREE,
    ...overrides,
  };
}

function authorityInput(overrides = {}) {
  const identity = candidate(overrides.identity);
  const local = { ...identity, ...(overrides.local || {}) };
  const remote = { available: true, ...identity, ...(overrides.remote || {}) };
  return {
    local,
    remote,
    design_lock: { id: DESIGN_LOCK, scope_id: 'A1-contract-default-off' },
    risk_tier: 'T3',
    current_operation_time: { source: 'trusted-controller', observed_at: '2026-08-15T06:00:00.000Z', evidence_id: 'op-097' },
    ...overrides,
  };
}

function admitted(overrides = {}, options = {}) {
  return require(runtimePath).admitAuthority(authorityInput(overrides), options);
}

function assertCode(action, code) {
  assert.throws(action, (error) => error && error.code === code, `expected ${code}`);
}

function terminalInput(authority = admitted()) {
  return {
    authority,
    execution_assignment: { role: 'implementation-worker', provider: 'openai', model: 'gpt-5.6', reasoning: 'max' },
    identity: { ...authority.candidate, repository_id: authority.repository.id, remote_url: authority.repository.remote_url },
    scope: { design_lock_id: authority.design_lock.id, scope_id: authority.design_lock.scope_id, risk_tier: authority.risk_tier },
    review_surface: { manual_lines: 390, files: 13, risk_tier: 'T3' },
    validation: {
      local: [{ name: 'repo-loop-core-contract', status: 'pass', evidence_ref: 'local:test' }],
      hosted: [{ name: 'validate-toolkit', status: 'pass', evidence_ref: 'hosted:check' }],
    },
    findings: { state: 'none', records: [] },
    blocker_state: 'none',
    convergence: { generation: 1, reservation: 'reserved-for-later-convergence' },
    reconciliation: { state: 'complete', evidence: ['controller-readback-required'] },
    contradictions: [],
    unavailable_evidence: [],
    finality_actions: ['Web derives finality from this evidence and performs the authoritative reconciliation.'],
    secret_classification: 'none',
  };
}

test('loading the source-only module is inert and remains default-off', () => {
  const core = require(runtimePath);
  assert.equal(core.DEFAULT_OFF, true);
  for (const operation of ['executor-launch', 'pr-create', 'review-comment', 'governance-update', 'merge', 'deploy', 'provider-mutate']) {
    assert.deepEqual(core.execute(operation), {
      status: 'refused',
      code: 'DEFAULT_OFF_MUTATION_REFUSED',
      operation,
      side_effects: 'none',
    });
  }
});

test('Web runtime assignment fields and Web/controller roles are rejected', () => {
  const core = require(runtimePath);
  for (const assignment of [
    { role: 'implementation-worker', web_model: 'x' },
    { role: 'implementation-worker', web_provider: 'x' },
    { role: 'implementation-worker', web_reasoning: 'x' },
    { role: 'implementation-worker', controller_model: 'x' },
    { role: 'web-controller', provider: 'x', model: 'y', reasoning: 'z' },
    { role: 'controller', provider: 'x', model: 'y', reasoning: 'z' },
  ]) {
    const result = core.validateExecutionAssignment(assignment);
    assert.equal(result.valid, false);
    assert.match(result.error.code, /WEB_RUNTIME_OPAQUE|WEB_ROLE_FORBIDDEN/);
  }
  assertCode(() => core.admitAuthority({ ...authorityInput(), web_model: 'x' }), 'WEB_RUNTIME_OPAQUE');
});

test('bounded non-Web assignments are accepted without Web policy fields', () => {
  const core = require(runtimePath);
  const result = core.validateExecutionAssignment({ role: 'technical-g4-reviewer', provider: 'openai', model: 'gpt-5.6', reasoning: 'high' });
  assert.equal(result.valid, true);
  assert.equal(result.value.role, 'technical-g4-reviewer');
  assert.equal(Object.keys(result.value).some((key) => /web|controller/i.test(key)), false);
});

test('authority admission requires remote evidence and exact local/remote identity', () => {
  const core = require(runtimePath);
  assertCode(() => core.admitAuthority({ ...authorityInput(), remote: undefined }), 'REMOTE_AUTHORITY_REQUIRED');
  assertCode(() => core.admitAuthority(authorityInput({ remote: { available: false } })), 'REMOTE_AUTHORITY_UNAVAILABLE');
  for (const field of ['repository_id', 'pull_request', 'head', 'tree', 'base', 'merge_base']) {
    const remote = { available: true, ...candidate(), [field]: field === 'pull_request' ? 402 : field === 'repository_id' ? 'other/repo' : 'c'.repeat(40) };
    assertCode(() => core.admitAuthority(authorityInput({ remote })), 'AUTHORITY_IDENTITY_MISMATCH');
  }
});

test('time-sensitive admission requires trusted current operation time', () => {
  const core = require(runtimePath);
  const missing = authorityInput();
  delete missing.current_operation_time;
  assertCode(() => core.admitAuthority(missing, { time_sensitive: true }), 'TRUSTED_OPERATION_TIME_REQUIRED');
  for (const field of ['issued_at', 'issue_created_at', 'pr_created_at']) {
    const input = authorityInput();
    delete input.current_operation_time;
    input[field] = '2026-08-15T05:00:00.000Z';
    assertCode(() => core.admitAuthority(input, { time_sensitive: true }), 'TRUSTED_OPERATION_TIME_REQUIRED');
  }
  assertCode(() => core.admitAuthority(authorityInput({ current_operation_time: { source: 'caller', observed_at: '2026-08-15T06:00:00.000Z', evidence_id: 'bad' } }), { time_sensitive: true }), 'TRUSTED_OPERATION_TIME_INVALID');
});

test('ambiguous authority ownership/liveness fails closed without recovery side effects', () => {
  const core = require(runtimePath);
  assert.deepEqual(core.recoverAuthority({ owner_state: 'unknown', lock_path: '.loop.lock' }), {
    status: 'blocked',
    code: 'AUTHORITY_LIVENESS_UNCERTAIN',
    side_effects: 'none',
  });
});

test('canonical Git paths reject aliases and duplicate canonical identities', () => {
  const core = require(runtimePath);
  for (const value of ['', '\\src\\file', '/src/file', 'src/file/', 'src//file', 'src/./file', 'src/../file', 'src%2Ffile', 'src%5Cfile', 'C:/src/file', '.', '..']) {
    assertCode(() => core.canonicalGitPath(value), 'CANONICAL_GIT_PATH_INVALID');
  }
  assert.equal(core.canonicalGitPath('src/repo-loop-core.cjs'), 'src/repo-loop-core.cjs');
  assertCode(() => core.canonicalGitPaths(['src/a.cjs', 'src/a.cjs']), 'DUPLICATE_CANONICAL_GIT_PATH');
});

test('terminal packets are self-describing, immutable by digest, and authority-bound', () => {
  const core = require(runtimePath);
  const packet = core.buildTerminalPacket(terminalInput());
  assert.match(packet.packet_digest, /^[a-f0-9]{64}$/);
  assert.equal(packet.packet_id, `repo-loop-core.packet.v1:${packet.packet_digest.slice(0, 16)}`);
  assert.equal(core.verifyTerminalPacket(packet, packet.authority_snapshot).valid, true);
  assert.throws(() => { packet.packet_digest = '0'.repeat(64); }, TypeError);
  const replayed = { ...packet, packet_id: 'repo-loop-core.packet.v1:0000000000000000' };
  assert.equal(core.verifyTerminalPacket(replayed).error.code, 'PACKET_ID_INVALID');
  const tampered = { ...packet, finality_actions: ['changed'] };
  assert.equal(core.verifyTerminalPacket(tampered).error.code, 'PACKET_DIGEST_MISMATCH');
  const otherAuthority = admitted({ identity: { pull_request: 402 } });
  assert.equal(core.verifyTerminalPacket(packet, otherAuthority).error.code, 'PACKET_AUTHORITY_MISMATCH');
});

test('duplicate canonical JSON keys and caller-authored finality booleans are rejected', () => {
  const core = require(runtimePath);
  assertCode(() => core.parseCanonicalJson('{"a":1,"a":2}'), 'DUPLICATE_CANONICAL_KEY');
  assert.equal(core.canonicalJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
  const input = terminalInput();
  input.checks_green = true;
  assertCode(() => core.buildTerminalPacket(input), 'CALLER_FINALITY_FIELD_FORBIDDEN');
});

test('missing underlying evidence remains blocked/unavailable rather than green', () => {
  const core = require(runtimePath);
  const input = terminalInput();
  input.validation = { local: input.validation.local, hosted: [] };
  input.unavailable_evidence = ['hosted exact-head evidence unavailable'];
  input.blocker_state = 'blocked';
  const packet = core.buildTerminalPacket(input);
  assert.equal(packet.blocker_state, 'blocked');
  assert.deepEqual(packet.validation.hosted, []);
  assert.equal(Object.keys(packet).some((key) => ['finality_eligible', 'checks_green', 'g4_passed', 'scope_valid'].includes(key)), false);
});

test('contract schemas are versioned and do not define Web runtime authority', () => {
  const authoritySchema = JSON.parse(fs.readFileSync(path.join(repoRoot, '_projects', 'development', 'repo-loop-core', '_main', 'authority-contract.schema.json'), 'utf8'));
  const packetSchema = JSON.parse(fs.readFileSync(path.join(repoRoot, '_projects', 'development', 'repo-loop-core', '_main', 'terminal-packet.schema.json'), 'utf8'));
  assert.equal(authoritySchema.properties.schema_version.const, 'repo-loop-core.authority.v1');
  assert.equal(packetSchema.properties.schema_version.const, 'repo-loop-core.terminal-packet.v1');
  for (const schema of [authoritySchema, packetSchema]) {
    const text = JSON.stringify(schema);
    assert.doesNotMatch(text, /web_model|web_reasoning|web_provider|controller_model/);
  }
});
