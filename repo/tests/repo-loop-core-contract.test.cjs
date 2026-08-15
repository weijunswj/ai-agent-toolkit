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
  const { identity: identityOverride, ...additional } = overrides;
  const identity = candidate(identityOverride);
  const local = { ...identity, ...(overrides.local || {}) };
  const remote = { available: true, ...identity, ...(overrides.remote || {}) };
  return {
    local,
    remote,
    design_lock: { id: DESIGN_LOCK, scope_id: 'A1-contract-default-off' },
    risk_tier: 'T3',
    current_operation_time: { source: 'trusted-controller', observed_at: '2026-08-15T06:00:00.000Z', evidence_id: 'op-097' },
    ...additional,
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

test('explicit non-Web roles keep provider/model/reasoning identifiers opaque', () => {
  const core = require(runtimePath);
  const assignment = {
    role: 'implementation-worker',
    provider: 'synthetic-web-controller-provider',
    model: 'synthetic-controller-model',
    reasoning: 'synthetic-web-controller-reasoning',
  };
  const result = core.validateExecutionAssignment(assignment);
  assert.equal(result.valid, true);
  assert.deepEqual({ ...result.value }, assignment);
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
test('verified authority, parsed packets, and verified packets are immutable normalized copies', () => {
  const core = require(runtimePath);
  const authorityInputValue = JSON.parse(JSON.stringify(admitted()));
  const authorityResult = core.validateAuthoritySnapshot(authorityInputValue);
  assert.equal(authorityResult.valid, true);
  assert.notStrictEqual(authorityResult.value, authorityInputValue);
  assert.equal(Object.isFrozen(authorityResult.value), true);
  assert.equal(Object.isFrozen(authorityResult.value.candidate), true);
  authorityInputValue.candidate.head = 'c'.repeat(40);
  assert.equal(authorityResult.value.candidate.head, SHA);
  assert.equal(Object.isFrozen(authorityInputValue), false);
  assert.equal(Object.isFrozen(authorityInputValue.candidate), false);

  const packet = core.buildTerminalPacket(terminalInput());
  const callerPacket = JSON.parse(JSON.stringify(packet));
  const verified = core.verifyTerminalPacket(callerPacket);
  assert.equal(verified.valid, true);
  assert.notStrictEqual(verified.value, callerPacket);
  assert.equal(Object.isFrozen(verified.value), true);
  assert.equal(Object.isFrozen(verified.value.validation.local), true);
  callerPacket.blocker_state = 'blocked';
  callerPacket.validation.local[0].status = 'fail';
  assert.equal(verified.value.blocker_state, 'none');
  assert.equal(verified.value.validation.local[0].status, 'pass');
  assert.equal(Object.isFrozen(callerPacket), false);
  assert.equal(Object.isFrozen(callerPacket.validation.local), false);

  const callerPacketForParse = JSON.parse(JSON.stringify(packet));
  const parsed = core.parseTerminalPacket(JSON.stringify(callerPacketForParse));
  assert.equal(parsed.valid, true);
  assert.equal(Object.isFrozen(parsed.value), true);
  assert.equal(Object.isFrozen(parsed.value.authority_snapshot), true);
  callerPacketForParse.findings.records.push({ id: 'caller-only' });
  assert.equal(parsed.value.findings.records.length, 0);
  assert.equal(Object.isFrozen(callerPacketForParse), false);
  assert.throws(() => { parsed.value.blocker_state = 'blocked'; }, TypeError);
});

test('trusted operation time accepts only a real canonical UTC instant', () => {
  const core = require(runtimePath);
  for (const observed_at of [
    '2026-13-15T06:00:00.000Z',
    '2026-00-15T06:00:00.000Z',
    '2026-02-29T06:00:00.000Z',
    '2026-04-31T06:00:00.000Z',
    '2026-08-15T24:00:00.000Z',
    '2026-08-15T06:60:00.000Z',
    '2026-08-15T06:00:60.000Z',
  ]) {
    assert.equal(core.validateCurrentOperationTime({ source: 'trusted-controller', observed_at, evidence_id: 'synthetic-time' }).valid, false, observed_at);
  }
  const valid = '2024-02-29T23:59:59.999Z';
  const result = core.validateCurrentOperationTime({ source: 'trusted-controller', observed_at: valid, evidence_id: 'synthetic-time' });
  assert.equal(result.valid, true);
  assert.equal(result.value.observed_at, valid);
  assert.equal(new Date(result.value.observed_at).toISOString(), valid);
});

test('optional assignment identifiers are strict nonblank strings and are copied only after validation', () => {
  const core = require(runtimePath);
  for (const field of ['assignment_id', 'evidence_ref']) {
    for (const value of ['', '   ', '\t', 42, null]) {
      const result = core.validateExecutionAssignment({ role: 'implementation-worker', [field]: value });
      assert.equal(result.valid, false, field + '=' + String(value));
    }
  }
  const assignment = {
    role: 'implementation-worker',
    provider: 'openai',
    model: 'gpt-5.6',
    reasoning: 'max',
    assignment_id: 'assignment-100',
    evidence_ref: 'evidence:run-100',
  };
  const result = core.validateExecutionAssignment(assignment);
  assert.equal(result.valid, true);
  assert.deepEqual({ ...result.value }, assignment);
  assert.equal(Object.isFrozen(assignment), false);
});

test('DEFAULT OFF refusal clones structured operations before freezing the response', () => {
  const core = require(runtimePath);
  const operation = { name: 'review', nested: { enabled: true }, steps: [{ name: 'inspect' }] };
  const refusal = core.execute(operation);
  assert.equal(refusal.status, 'refused');
  assert.notStrictEqual(refusal.operation, operation);
  assert.deepEqual(refusal.operation, operation);
  assert.equal(Object.isFrozen(refusal), true);
  assert.equal(Object.isFrozen(refusal.operation), true);
  assert.equal(Object.isFrozen(refusal.operation.nested), true);
  assert.equal(Object.isFrozen(refusal.operation.steps[0]), true);
  assert.equal(Object.isFrozen(operation), false);
  assert.equal(Object.isFrozen(operation.nested), false);
  assert.equal(Object.isFrozen(operation.steps[0]), false);
  operation.nested.enabled = false;
  operation.steps.push({ name: 'caller-mutation' });
  assert.equal(refusal.operation.nested.enabled, true);
  assert.equal(refusal.operation.steps.length, 1);
});

test('findings require identifying fields and state/cardinality consistency', () => {
  const core = require(runtimePath);
  const required = ['id', 'kind', 'disposition', 'evidence_ref', 'summary'];
  assert.throws(() => core.buildTerminalPacket({
    ...terminalInput(),
    findings: { state: 'present', records: [{}] },
  }), /FINDING_ENVELOPE_INVALID/);
  for (const field of required) {
    const record = { id: 'finding-1', kind: 'blocker', disposition: 'open', evidence_ref: 'evidence:finding-1', summary: 'synthetic finding' };
    delete record[field];
    assert.throws(() => core.buildTerminalPacket({
      ...terminalInput(),
      findings: { state: 'present', records: [record] },
    }), /FINDING_ENVELOPE_INVALID/, 'missing ' + field);
  }
  const validRecord = { id: 'finding-1', kind: 'blocker', disposition: 'open', evidence_ref: 'evidence:finding-1', summary: 'synthetic finding' };
  const validPacket = core.buildTerminalPacket({
    ...terminalInput(),
    findings: { state: 'present', records: [validRecord] },
    blocker_state: 'blocked',
  });
  assert.deepEqual(validPacket.findings.records, [validRecord]);
  for (const [state, records] of [
    ['none', [validRecord]],
    ['present', []],
    ['deferred', []],
    ['unavailable', [validRecord]],
  ]) {
    assert.throws(() => core.buildTerminalPacket({
      ...terminalInput(),
      findings: { state, records },
      blocker_state: state === 'unavailable' ? 'unavailable' : 'none',
    }), /FINDING_ENVELOPE_INVALID/, state + ' cardinality');
  }
});

test('terminal state is fail-closed across validation, findings, reconciliation, and contradictions', () => {
  const core = require(runtimePath);
  for (const status of ['fail', 'pending']) {
    const input = terminalInput();
    input.validation.hosted[0].status = status;
    assert.throws(() => core.buildTerminalPacket(input), /MISSING_UNDERLYING_EVIDENCE|UNAVAILABLE_EVIDENCE_UNBLOCKED/);
  }
  for (const state of ['incomplete', 'unavailable']) {
    const input = terminalInput();
    input.reconciliation.state = state;
    assert.throws(() => core.buildTerminalPacket(input), /RECONCILIATION_EVIDENCE_UNAVAILABLE|UNAVAILABLE_EVIDENCE_UNBLOCKED/);
  }
  const unavailableFinding = terminalInput();
  unavailableFinding.findings = { state: 'unavailable', records: [] };
  unavailableFinding.blocker_state = 'none';
  assert.throws(() => core.buildTerminalPacket(unavailableFinding), /FINDING_EVIDENCE_UNAVAILABLE|UNAVAILABLE_EVIDENCE_UNBLOCKED/);

  const contradictions = terminalInput();
  contradictions.contradictions = ['validation contradicts reconciliation'];
  assert.throws(() => core.buildTerminalPacket(contradictions), /CONTRADICTION_UNBLOCKED|UNAVAILABLE_EVIDENCE_UNBLOCKED/);

  const findingsMismatch = terminalInput();
  findingsMismatch.findings = { state: 'present', records: [] };
  assert.throws(() => core.buildTerminalPacket(findingsMismatch), /FINDING_ENVELOPE_INVALID/);

  const blocked = terminalInput();
  blocked.validation.hosted[0].status = 'pending';
  blocked.reconciliation.state = 'incomplete';
  blocked.findings = { state: 'unavailable', records: [] };
  blocked.blocker_state = 'blocked';
  blocked.unavailable_evidence = ['synthetic validation, finding, and reconciliation evidence unavailable'];
  assert.doesNotThrow(() => core.buildTerminalPacket(blocked));
  assert.doesNotThrow(() => core.buildTerminalPacket(terminalInput()));
});

test('secret classification and classification hold are bidirectionally coherent', () => {
  const core = require(runtimePath);
  for (const secret_classification of ['possible', 'confirmed']) {
    const valid = terminalInput();
    valid.secret_classification = secret_classification;
    valid.blocker_state = 'classification_hold';
    const packet = core.buildTerminalPacket(valid);
    assert.equal(packet.secret_classification, secret_classification);
    assert.equal(packet.blocker_state, 'classification_hold');

    for (const blocker_state of ['none', 'blocked', 'deferred', 'unavailable']) {
      const invalid = terminalInput();
      invalid.secret_classification = secret_classification;
      invalid.blocker_state = blocker_state;
      assertCode(() => core.buildTerminalPacket(invalid), 'SECRET_CLASSIFICATION_BLOCKER_MISMATCH');
    }
  }

  for (const secret_classification of ['none', 'redacted']) {
    const invalid = terminalInput();
    invalid.secret_classification = secret_classification;
    invalid.blocker_state = 'classification_hold';
    assertCode(() => core.buildTerminalPacket(invalid), 'SECRET_CLASSIFICATION_BLOCKER_MISMATCH');

    const valid = terminalInput();
    valid.secret_classification = secret_classification;
    valid.blocker_state = 'blocked';
    assert.doesNotThrow(() => core.buildTerminalPacket(valid));
  }
});
test('authority input is closed-world before construction and digesting', () => {
  const core = require(runtimePath);
  for (const extra of [
    { arbitrary_claim: 'ignored-must-fail' },
    { web: { model: 'synthetic-web-model' } },
    { controller: { reasoning: 'synthetic-controller-reasoning' } },
  ]) {
    assertCode(() => core.admitAuthority({ ...authorityInput(), ...extra }), 'UNEXPECTED_FIELD');
  }
  const input = authorityInput();
  const authority = core.admitAuthority(input);
  assert.equal(authority.candidate.repository_id, input.local.repository_id);
  assert.equal(authority.remote_evidence.head, input.remote.head);
  assert.equal(authority.current_operation_time.observed_at, input.current_operation_time.observed_at);
});

test('credential-bearing repository URLs are rejected before evidence copies and safe identities remain accepted', () => {
  const core = require(runtimePath);
  const credentialBearing = 'https://synthetic-user:synthetic-token-placeholder@example.invalid/weijunswj/ai-agent-toolkit.git';
  assertCode(() => core.admitAuthority(authorityInput({ identity: { remote_url: credentialBearing } })), 'CREDENTIAL_BEARING_REMOTE_URL');

  const safeAuthority = core.admitAuthority(authorityInput({ identity: { remote_url: 'https://example.invalid/weijunswj/ai-agent-toolkit.git' } }));
  const packet = core.buildTerminalPacket(terminalInput(safeAuthority));
  const evidenceText = [safeAuthority, packet, JSON.stringify(packet), core.canonicalJson(packet)].map((value) => JSON.stringify(value)).join('\n');
  assert.doesNotMatch(evidenceText, /synthetic-token-placeholder/);
  assert.match(safeAuthority.repository.remote_url, /^https:\/\/example\.invalid\//);
});

test('remote URL identity fails closed on userinfo, every URL query, and every URL fragment', () => {
  const core = require(runtimePath);
  for (const remote_url of [
    'https://example.invalid/owner/repo.git?private_token=synthetic',
    'https://example.invalid/owner/repo.git?oauth_token=synthetic',
    'https://example.invalid/owner/repo.git?api_key=synthetic',
    'https://example.invalid/owner/repo.git?arbitrary=synthetic',
    'https://synthetic-user:synthetic-placeholder@example.invalid/owner/repo.git',
    'https://example.invalid/owner/repo.git#synthetic',
  ]) {
    assertCode(() => core.admitAuthority(authorityInput({ identity: { remote_url } })), 'CREDENTIAL_BEARING_REMOTE_URL');
  }

  for (const remote_url of [
    'https://example.invalid/owner/repo.git',
    'git@example.invalid:owner/repo.git',
  ]) {
    assert.doesNotThrow(() => core.admitAuthority(authorityInput({ identity: { remote_url } })));
  }
});
test('schemas express the tightened time, assignment, finding, and remote-identity contracts', () => {
  const authoritySchema = JSON.parse(fs.readFileSync(path.join(repoRoot, '_projects', 'development', 'repo-loop-core', '_main', 'authority-contract.schema.json'), 'utf8'));
  const packetSchema = JSON.parse(fs.readFileSync(path.join(repoRoot, '_projects', 'development', 'repo-loop-core', '_main', 'terminal-packet.schema.json'), 'utf8'));
  for (const schema of [authoritySchema, packetSchema]) {
    assert.equal(schema.$defs.time.properties.observed_at.format, 'date-time');
    assert.doesNotMatch('https://synthetic-user:synthetic-token-placeholder@example.invalid/repo.git', new RegExp('^' + schema.$defs.identity.properties.remote_url.pattern + '$'));
  }
  const assignment = packetSchema.$defs.assignment;
  for (const field of ['assignment_id', 'evidence_ref']) {
    assert.equal(assignment.properties[field].minLength, 1);
    assert.ok(assignment.properties[field].pattern);
  }
  assert.deepEqual(packetSchema.$defs.findingRecord.required, ['id', 'kind', 'disposition', 'evidence_ref', 'summary']);
  assert.ok(packetSchema.$defs.findings.allOf);
});

test('authority and terminal-packet schemas agree on credential-free remote identities and secret holds', () => {
  const authoritySchema = JSON.parse(fs.readFileSync(path.join(repoRoot, '_projects', 'development', 'repo-loop-core', '_main', 'authority-contract.schema.json'), 'utf8'));
  const packetSchema = JSON.parse(fs.readFileSync(path.join(repoRoot, '_projects', 'development', 'repo-loop-core', '_main', 'terminal-packet.schema.json'), 'utf8'));
  const authorityPattern = authoritySchema.$defs.identity.properties.remote_url.pattern;
  const packetPattern = packetSchema.$defs.identity.properties.remote_url.pattern;
  assert.equal(packetPattern, authorityPattern);
  const remotePattern = new RegExp(authorityPattern);
  for (const remote_url of [
    'https://example.invalid/owner/repo.git?private_token=synthetic',
    'https://example.invalid/owner/repo.git?oauth_token=synthetic',
    'https://example.invalid/owner/repo.git?api_key=synthetic',
    'https://synthetic-user:synthetic-placeholder@example.invalid/owner/repo.git',
    'https://example.invalid/owner/repo.git#synthetic',
  ]) {
    assert.doesNotMatch(remote_url, remotePattern);
  }
  for (const remote_url of ['https://example.invalid/owner/repo.git', 'git@example.invalid:owner/repo.git']) {
    assert.match(remote_url, remotePattern);
  }
  assert.ok(packetSchema.allOf.some((condition) => JSON.stringify(condition).includes('classification_hold')));
  assert.ok(packetSchema.allOf.some((condition) => JSON.stringify(condition).includes('possible')));
  assert.ok(packetSchema.allOf.some((condition) => JSON.stringify(condition).includes('confirmed')));
});
