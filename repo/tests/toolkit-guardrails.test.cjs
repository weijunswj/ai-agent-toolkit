'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const projectRoot = path.join(repoRoot, '_projects', 'development', 'toolkit-guardrails');
const runtimeRoot = path.join(repoRoot, 'repo', 'scripts', 'toolkit-guardrails');
const policy = require(path.join(runtimeRoot, 'toolkit-guardrail-policy.cjs'));
const repository = require(path.join(runtimeRoot, 'toolkit-active-repository.cjs'));
const normalizer = require(path.join(runtimeRoot, 'toolkit-operation-normalizer.cjs'));
const classifier = require(path.join(runtimeRoot, 'toolkit-command-classifier.cjs'));
const approvals = require(path.join(runtimeRoot, 'toolkit-approval-verifier.cjs'));
const engine = require(path.join(runtimeRoot, 'toolkit-guardrail-engine.cjs'));

const ROOT = 'C:\\fixture\\workspace\\repo';
const CWD = `${ROOT}\\src`;
const SIBLING = 'C:\\fixture\\workspace\\sibling-repo';
const PARENT_FILE = 'C:\\fixture\\workspace\\notes.txt';
const ADDITIONAL = 'C:\\fixture\\workspace\\approved-worktree';
const NOW = '2026-07-30T10:00:00.000Z';

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

function fixtureRepository(overrides = {}) {
  return {
    host_working_directory: CWD,
    proposed_repository_root: ROOT,
    proposed_worktree_root: ROOT,
    approved_additional_roots: [],
    resolution_status: 'resolved',
    path_semantics: { platform: 'win32', case_sensitive: false },
    resolution_evidence: { status: 'trusted', source: 'deterministic-fixture' },
    canonical_target_paths: [],
    ...overrides,
  };
}

function fixtureAuthority(overrides = {}) {
  return {
    prompt: { active: true },
    role: { name: 'executor', allowed: true },
    branch: { current: 'luna/tk-034-guardrail-policy-engine', authorized: 'luna/tk-034-guardrail-policy-engine', protected: false },
    design_lock: { id: 'DL-313-001', status: 'active', allowed_scopes: ['source-project', 'pure-runtime', 'tests', 'fixtures', 'manifests'] },
    push_authorized: true,
    ...overrides,
  };
}

function fixtureInput(operation, overrides = {}) {
  return {
    session: {
      host: 'fixture-host',
      host_version: 'fixture-1',
      session_id: 'session-1',
      turn_id: 'turn-1',
      call_id: 'call-1',
      lifecycle_event: 'operation.preflight',
    },
    repository: fixtureRepository(),
    authority: fixtureAuthority(),
    native_state: { capability_evidence: { status: 'verified', host: 'fixture-host', trusted_ask: true } },
    operation,
    ...overrides,
  };
}

function structured(action, target, extra = {}) {
  return {
    host_tool: 'fixture-file-tool',
    canonical_route: 'operation.preflight',
    structured_input: { action, ...(target !== undefined ? { target } : {}), ...extra },
  };
}

function editInside(extra = {}) {
  return fixtureInput(structured('edit', `${ROOT}\\src\\file.txt`, extra));
}

function buildApproval(input, overrides = {}) {
  const record = normalizer.normalizeOperation(input);
  const classification = classifier.classifyOperation(record);
  if (classification.targets?.length) record.operation.targets = classification.targets;
  normalizer.refreshOperationDigests(record, classification);
  return {
    contract_version: 'toolkit.guardrail.approval.v1',
    host: record.session.host,
    source: 'native-user-channel',
    trusted_user_channel: 'native-user-channel',
    exact_operation_digest: record.operation.input_digest,
    exact_targets_digest: record.operation.target_digest,
    canonical_target_set: normalizer.canonicalTargetSet(record.operation.targets),
    session_id: record.session.session_id,
    turn_id: record.session.turn_id,
    call_id: record.session.call_id,
    operation_class: classification.operation_class,
    issued_at: '2026-07-30T09:59:00.000Z',
    expires_at: '2026-07-30T10:01:00.000Z',
    one_shot: true,
    consumed: false,
    ...overrides,
  };
}

function withApproval(input, overrides = {}) {
  return { ...input, approval: buildApproval(input, overrides) };
}

function decision(input, options = {}) {
  return engine.evaluate(input, { now: NOW, ...options });
}

test('source policy, schemas, fixtures, and source-only project metadata stay aligned', () => {
  const sourcePolicy = readJson('_projects/development/toolkit-guardrails/_main/guardrail-policy.json');
  const policySchema = readJson('_projects/development/toolkit-guardrails/_main/guardrail-policy.schema.json');
  const operationSchema = readJson('_projects/development/toolkit-guardrails/_main/operation-contract.schema.json');
  const approvalSchema = readJson('_projects/development/toolkit-guardrails/_main/approval-contract.schema.json');
  const fixtures = readJson('_projects/development/toolkit-guardrails/_main/fixtures/fixture-manifest.json');
  const manifest = readJson('_projects/development/toolkit-guardrails/toolkit.project.json');
  assert.equal(sourcePolicy.schema_version, 'toolkit.guardrail.policy.v1');
  assert.equal(policySchema.$id, sourcePolicy.schema_version);
  assert.equal(operationSchema.$id, 'toolkit.guardrail.operation.v1');
  assert.equal(approvalSchema.$id, 'toolkit.guardrail.approval.v1');
  assert.equal(fixtures.policy_version, sourcePolicy.policy_version);
  assert.equal(fixtures.design_lock, sourcePolicy.design_lock);
  assert.deepEqual(manifest.outputs, []);
  assert.equal(manifest.surface.publish_as, 'source_only');
  assert.equal(manifest.surface.skill.status, 'not_applicable');
  assert.equal(manifest.surface.mcp.status, 'not_applicable');
  for (const file of fixtures.runtime_modules) assert.equal(fs.existsSync(path.join(runtimeRoot, file)), true, file);
  for (const file of fixtures.schema_files) assert.equal(fs.existsSync(path.join(projectRoot, '_main', file)), true, file);
  for (const caseId of fixtures.required_case_ids) assert.equal(typeof caseId, 'string');
  assert.equal(fixtures.published_outputs.length, 0);
  assert.equal(fixtures.global_instruction_outputs.length, 0);
  assert.equal(fs.existsSync(path.join(projectRoot, 'curated_output_for_ai', 'guardrail-policy-projection.md')), true);
});

test('capability matrix records only the locked conservative claims', () => {
  const matrix = readJson('_projects/development/toolkit-guardrails/_main/host-capability-matrix.json');
  const claims = new Map(matrix.claims.map((entry) => [entry.id, entry]));
  assert.match(claims.get('codex-current-toolkit-package').claim, /No operation-preflight hook installed/);
  assert.match(claims.get('codex-inspected-source').claim, /Partial route coverage.*PreToolUse ask unsupported/);
  assert.match(claims.get('claude-current-toolkit-package').claim, /Agent\|Task topology route/);
  assert.match(claims.get('claude-documented-capability').claim, /version-specific proof remains pending/);
  assert.match(claims.get('opencode-v1').claim, /approval correlation.*auto-mode safety/);
  assert.match(claims.get('antigravity').claim, /force_ask.*local installed\/runtime proof is absent/);
  assert.match(claims.get('four-host-parity').claim, /Not established/);
  assert.equal(matrix.four_host_parity, false);
  assert.equal(matrix.full_permission_safety, false);
});

test('repository resolver requires explicit repository context and recognizes Windows boundaries', () => {
  const resolved = repository.resolveRepositoryContext(fixtureRepository());
  assert.equal(resolved.path_resolution_status, 'resolved');
  assert.equal(resolved.canonical_repository_root, ROOT);
  assert.equal(resolved.path_semantics.case_sensitive, false);
  assert.equal(repository.resolveTarget({ path: `${ROOT}\\src\\file.txt` }, resolved).target_class, 'canonical-repository');
  assert.equal(repository.resolveTarget({ path: 'C:\\FIXTURE\\WORKSPACE\\REPO\\src\\FILE.TXT' }, resolved).target_class, 'canonical-repository');
  assert.notEqual(repository.resolveTarget({ path: SIBLING }, resolved).resolved_inside, true);
  assert.equal(repository.resolveTarget({ path: PARENT_FILE }, resolved).target_class, 'parent-workspace');
  assert.equal(repository.resolveTarget({ path: `${ROOT}\\..\\notes.txt` }, resolved).target_class, 'parent-workspace');
  assert.equal(repository.resolveTarget({ path: `${ROOT}\\src\\missing.txt`, resolution_evidence: { status: 'unresolved' } }, resolved).target_class, 'unresolved-target');
  const missing = repository.resolveRepositoryContext({ host_working_directory: CWD, resolution_status: 'resolved' });
  assert.equal(missing.path_resolution_status, 'missing-context');
});

test('repository resolver distinguishes approved additional roots and unauthorized roots', () => {
  const resolved = repository.resolveRepositoryContext(fixtureRepository({
    approved_additional_roots: [{ path: ADDITIONAL, kind: 'additional-worktree', resolution_evidence: { status: 'trusted' } }],
  }));
  assert.equal(resolved.path_resolution_status, 'resolved');
  assert.equal(repository.resolveTarget({ path: `${ADDITIONAL}\\src\\file.txt` }, resolved).target_class, 'approved-additional-root');
  const unauthorized = repository.resolveTarget({ path: 'C:\\fixture\\workspace\\unapproved-root\\file.txt' }, resolved);
  assert.equal(unauthorized.resolved_inside, false);
  assert.notEqual(unauthorized.target_class, 'approved-additional-root');
});

test('repository resolver uses injectable filesystem and Git evidence without live-machine dependence', () => {
  const fsResolved = repository.resolveTarget({ path: `${ROOT}\\fs-link\\file.txt` }, repository.resolveRepositoryContext(fixtureRepository()), {
    use_filesystem: true,
    fsResolver: {
      realpath: () => `${SIBLING}\\file.txt`,
      lstat: () => ({ isSymbolicLink: () => true }),
    },
  });
  assert.equal(fsResolved.link_type, 'symlink');
  assert.equal(fsResolved.target_class, 'outside-repository');
  const gitResolved = repository.resolveRepositoryContext(fixtureRepository(), {
    gitResolver: {
      showTopLevel: () => ROOT,
      showCommonDir: () => `${ROOT}\\.git`,
    },
  });
  assert.equal(gitResolved.path_resolution_status, 'resolved');
  assert.equal(gitResolved.git_evidence.common_directory, `${ROOT}\\.git`);
  const gitAmbiguous = repository.resolveRepositoryContext(fixtureRepository(), {
    gitResolver: { showTopLevel: () => SIBLING },
  });
  assert.equal(gitAmbiguous.path_resolution_status, 'ambiguous');
});

test('symlink, junction, and reparse evidence is resolved before boundary classification', () => {
  const resolved = repository.resolveRepositoryContext(fixtureRepository());
  for (const linkType of ['symlink', 'junction', 'reparse-point']) {
    const target = repository.resolveTarget({
      path: `${ROOT}\\link-${linkType}\\file.txt`,
      resolution_evidence: { status: 'trusted', link_type: linkType, resolved_path: `${SIBLING}\\file.txt` },
    }, resolved);
    assert.equal(target.link_type, linkType);
    assert.equal(target.resolved_inside, false);
    assert.equal(target.target_class, 'outside-repository');
  }
  const safeLink = repository.resolveTarget({
    path: `${ROOT}\\link-inside\\file.txt`,
    resolution_evidence: { status: 'trusted', link_type: 'symlink', resolved_path: `${ROOT}\\src\\file.txt` },
  }, resolved);
  assert.equal(safeLink.target_class, 'canonical-repository');
});

test('routine edit inside the canonical repository returns allow with safe digests', () => {
  const result = decision(editInside());
  assert.equal(result.decision, 'allow');
  assert.equal(result.reason_code, 'ROUTINE_REPOSITORY_OPERATION');
  assert.equal(result.enforcement_requirement, 'routine-repository-authority');
  assert.equal(result.safe_target_class, 'canonical-repository');
  assert.match(result.request_digest, /^[a-f0-9]{64}$/);
  assert.equal(result.privacy_safe, true);
});

test('structured create, destructive overwrite, truncation, and deletion use the expected boundary', () => {
  assert.equal(decision(fixtureInput(structured('create', `${ROOT}\\new.txt`))).decision, 'allow');
  assert.equal(decision(fixtureInput(structured('overwrite', `${ROOT}\\existing.txt`))).decision, 'ask');
  assert.equal(decision(fixtureInput(structured('truncate', `${ROOT}\\existing.txt`))).decision, 'ask');
  assert.equal(decision(fixtureInput(structured('delete', `${ROOT}\\existing.txt`))).decision, 'ask');
  assert.equal(decision(fixtureInput(structured('edit'))).decision, 'unsupported');
  assert.equal(decision(fixtureInput(structured('create'))).decision, 'unsupported');
});

test('outside, sibling, parent, and mixed target mutations require exact approval', () => {
  const outside = fixtureInput(structured('edit', `${SIBLING}\\file.txt`));
  assert.equal(decision(outside).decision, 'ask');
  assert.equal(decision(withApproval(outside)).decision, 'allow');
  const parent = fixtureInput(structured('edit', PARENT_FILE));
  assert.equal(decision(parent).decision, 'ask');
  const mixed = fixtureInput({
    host_tool: 'fixture-file-tool',
    canonical_route: 'operation.preflight',
    structured_input: { action: 'edit', targets: [`${ROOT}\\inside.txt`, `${SIBLING}\\outside.txt`] },
  });
  const mixedResult = decision(mixed);
  assert.equal(mixedResult.decision, 'ask');
  assert.ok(['mixed-targets', 'sibling-repository', 'outside-repository'].includes(mixedResult.safe_target_class));
});

test('decision precedence is deny over unsupported over ask over allow', () => {
  const allow = structured('edit', `${ROOT}\\inside.txt`);
  const ask = structured('delete', `${ROOT}\\delete.txt`);
  const unsupported = { command: 'bash -c "dynamic_target=$(Get-Item)"', shell: 'posix' };
  const deny = { command: 'cat .env', shell: 'posix' };
  assert.equal(decision({ ...fixtureInput({}), operations: [allow, ask] }).decision, 'ask');
  assert.equal(decision({ ...fixtureInput({}), operations: [allow, unsupported] }).decision, 'unsupported');
  assert.equal(decision({ ...fixtureInput({}), operations: [allow, unsupported, ask, deny] }).decision, 'deny');
});

test('Toolkit temporary cleanup is allow only for an exact same-transaction target set', () => {
  const target = `${ROOT}\\.toolkit-temp\\bounded.txt`;
  const safe = fixtureInput({
    ...structured('toolkit-temp-cleanup', target),
    transaction_evidence: { owned_by_toolkit: true, created_by_same_transaction: true, exact_target_set: true },
  });
  assert.equal(decision(safe).decision, 'allow');
  assert.equal(decision(fixtureInput(structured('toolkit-temp-cleanup', target))).decision, 'ask');
});

test('Git command classes distinguish ordinary work, destructive work, force push, other targets, and authorized push', () => {
  assert.equal(decision(fixtureInput({ command: 'git status', shell: 'posix' })).decision, 'allow');
  assert.equal(decision(fixtureInput({ command: 'git diff -- repo/file.txt', shell: 'posix' })).decision, 'allow');
  assert.equal(decision(fixtureInput({ command: 'git add .', shell: 'posix' })).decision, 'allow');
  assert.equal(decision(fixtureInput({ command: 'git commit -m "bounded change"', shell: 'posix' })).decision, 'allow');
  assert.equal(decision(fixtureInput({ command: 'git reset --hard HEAD', shell: 'posix' })).decision, 'ask');
  assert.equal(decision(fixtureInput({ command: 'git clean -fd', shell: 'posix' })).decision, 'ask');
  assert.equal(decision(fixtureInput({ command: 'git restore --source=HEAD -- file.txt', shell: 'posix' })).decision, 'ask');
  assert.equal(decision(fixtureInput({ command: 'git branch -D old-branch', shell: 'posix' })).decision, 'ask');
  assert.equal(decision(fixtureInput({ command: 'git push --force origin HEAD', shell: 'posix' })).decision, 'ask');
  assert.equal(decision(fixtureInput({ command: 'git push origin other-branch', shell: 'posix' })).decision, 'ask');
  assert.equal(decision(fixtureInput({ command: 'git push origin HEAD', shell: 'posix' })).decision, 'allow');
});

test('external systems, database/cloud/deployment mutations, secret dumps, and bypasses are conservative', () => {
  assert.equal(decision(fixtureInput({ mcp_server: 'fixture-db', mcp_tool: 'write', structured_input: { action: 'write' } })).decision, 'ask');
  assert.equal(decision(fixtureInput({ canonical_route: 'database.migrate', structured_input: { action: 'write' } })).decision, 'ask');
  for (const route of ['cloud.update', 'deployment.apply', 'provider.mutate']) {
    assert.equal(decision(fixtureInput({ canonical_route: route, structured_input: { action: 'write' } })).decision, 'ask', route);
  }
  assert.equal(decision(fixtureInput({ command: 'cat .env', shell: 'posix' })).decision, 'deny');
  assert.equal(decision(fixtureInput({ command: 'tool --dangerously-skip-permissions', shell: 'posix' })).decision, 'deny');
  assert.equal(decision(fixtureInput({ command: 'gh issue comment 313 --body bounded', shell: 'posix' })).decision, 'deny');
});

test('POSIX, PowerShell, CMD, redirection, pipeline, nested shell, and opaque script forms classify deterministically', () => {
  assert.equal(decision(fixtureInput({ command: 'cat repo/file.txt', shell: 'posix' })).decision, 'allow');
  assert.equal(decision(fixtureInput({ command: 'printf value > repo/file.txt', shell: 'posix' })).decision, 'ask');
  assert.equal(decision(fixtureInput({ command: 'Get-Content repo/file.txt', shell: 'powershell' })).decision, 'allow');
  assert.equal(decision(fixtureInput({ command: 'Set-Content -Path repo/file.txt -Value value', shell: 'powershell' })).decision, 'ask');
  const powershellTarget = classifier.classifyCommand('Set-Content -Path repo/file.txt -Value value', { shell: 'powershell' });
  assert.ok(powershellTarget.target_inputs.some((entry) => entry.path === 'repo/file.txt'));
  assert.equal(decision(fixtureInput({ command: 'type repo/file.txt', shell: 'cmd' })).decision, 'allow');
  assert.equal(decision(fixtureInput({ command: 'del repo/file.txt', shell: 'cmd' })).decision, 'ask');
  assert.equal(decision(fixtureInput({ command: 'cat repo/file.txt | grep value', shell: 'posix' })).decision, 'unsupported');
  assert.equal(decision(fixtureInput({ command: 'bash -c "rm repo/file.txt"', shell: 'posix' })).decision, 'unsupported');
  assert.equal(decision(fixtureInput({ command: 'node repo/scripts/custom.cjs', shell: 'posix' })).decision, 'unsupported');
  const classified = classifier.classifyCommand('printf value > repo/file.txt', { shell: 'posix', repository: repository.resolveRepositoryContext(fixtureRepository()), operation_cwd: CWD });
  assert.equal(classified.redirection, true);
  assert.ok(classified.target_inputs.some((entry) => entry.kind === 'redirection'));
});

test('approval verification binds exact operation, target set, host, session, turn, call, expiry, one-shot, and replay', () => {
  const outside = fixtureInput(structured('edit', `${SIBLING}\\file.txt`));
  const approval = buildApproval(outside);
  const record = normalizer.normalizeOperation(outside);
  const classification = classifier.classifyOperation(record);
  normalizer.refreshOperationDigests(record, classification);
  assert.equal(approvals.verifyApproval(record, approval, { now: NOW }).valid, true);
  assert.equal(approvals.verifyApproval(record, { ...approval, host: 'other-host' }, { now: NOW }).reason_code, 'APPROVAL_HOST_MISMATCH');
  assert.equal(approvals.verifyApproval(record, { ...approval, turn_id: 'turn-2' }, { now: NOW }).reason_code, 'APPROVAL_TURN_MISMATCH');
  assert.equal(approvals.verifyApproval(record, { ...approval, call_id: 'call-2' }, { now: NOW }).reason_code, 'APPROVAL_CALL_MISMATCH');
  assert.equal(approvals.verifyApproval(record, { ...approval, expires_at: '2026-07-30T09:59:59.000Z' }, { now: NOW }).reason_code, 'APPROVAL_EXPIRED');
  assert.equal(approvals.verifyApproval(record, { ...approval, consumed: true }, { now: NOW }).reason_code, 'APPROVAL_REPLAY');
  assert.equal(approvals.verifyApproval(record, { ...approval, replay_detected: true }, { now: NOW }).reason_code, 'APPROVAL_REPLAY');
  assert.equal(approvals.verifyApproval(record, { ...approval, exact_operation_digest: '0'.repeat(64) }, { now: NOW }).reason_code, 'APPROVAL_OPERATION_MISMATCH');
  assert.equal(approvals.verifyApproval(record, { ...approval, exact_targets_digest: '0'.repeat(64) }, { now: NOW }).reason_code, 'APPROVAL_TARGET_EXPANSION');
});

test('approval cannot be broadened, modified commands invalidate it, and native auto/bypass is not equivalent', () => {
  const outside = fixtureInput(structured('edit', `${SIBLING}\\file.txt`));
  const approved = withApproval(outside);
  assert.equal(decision(approved).decision, 'allow');
  const modified = { ...approved, operation: { ...approved.operation, structured_input: { action: 'edit', target: `${SIBLING}\\other.txt` } } };
  assert.equal(decision(modified).decision, 'ask');
  const expanded = {
    ...approved,
    operation: {
      ...approved.operation,
      structured_input: { action: 'edit', targets: [`${SIBLING}\\file.txt`, `${SIBLING}\\other.txt`] },
    },
  };
  assert.equal(decision(expanded).decision, 'ask');
  const auto = { ...outside, native_state: { auto_or_bypass: true, permission_mode: 'auto' } };
  assert.equal(decision(auto).decision, 'ask');
  for (const mode of ['always-allow', 'saved-permission', 'bypass-mode']) {
    assert.equal(decision({ ...outside, native_state: { permission_mode: mode, auto_or_bypass: true } }).decision, 'ask', mode);
  }
  const fakeNativeApproval = withApproval(outside, { source: 'auto-mode', trusted_user_channel: 'auto-mode' });
  assert.equal(decision(fakeNativeApproval).decision, 'ask');
  for (const source of ['always-allow', 'saved-permission', 'bypass-mode']) {
    assert.equal(decision(withApproval(outside, { source, trusted_user_channel: source })).decision, 'ask', source);
  }
  const denyInput = fixtureInput({ command: 'cat .env', shell: 'posix' });
  assert.equal(decision(withApproval(denyInput)).decision, 'deny');
});

test('stale capability evidence, missing fields, malformed records, and injected failures never allow', () => {
  const stale = fixtureInput(structured('edit', `${ROOT}\\src\\file.txt`), { native_state: { capability_evidence: { status: 'stale' } } });
  assert.equal(decision(stale).decision, 'unsupported');
  assert.equal(decision(null).decision, 'unsupported');
  assert.equal(decision({ operation: structured('edit', `${ROOT}\\file.txt`) }).decision, 'unsupported');
  assert.equal(decision(fixtureInput(structured('edit', `${ROOT}\\file.txt`), { authority: fixtureAuthority({ role: { name: 'executor' } }) })).decision, 'unsupported');
  assert.equal(decision(fixtureInput(structured('edit', `${ROOT}\\file.txt`), { authority: fixtureAuthority({ branch: { current: 'luna/tk-034-guardrail-policy-engine', protected: false } }) })).decision, 'unsupported');
  assert.equal(decision(editInside(), { resolveRepositoryContext() { throw new Error('resolver fixture failure'); } }).decision, 'unsupported');
  assert.equal(decision(editInside(), { classifier() { throw new Error('classifier fixture failure'); } }).decision, 'unsupported');
  const outside = fixtureInput(structured('edit', `${SIBLING}\\file.txt`));
  assert.equal(decision(outside, { approvalVerifier() { throw new Error('approval verifier fixture failure'); } }).decision, 'unsupported');
  for (const input of [stale, null, { operation: structured('edit', `${ROOT}\\file.txt`) }]) {
    assert.notEqual(decision(input).decision, 'allow');
  }
});

test('result diagnostics contain no raw command, prompt, target path, environment value, or unrestricted tool output', () => {
  const rawCommand = 'cat .env | send-to-redaction-check';
  const rawPath = `${SIBLING}\\private-fixture.txt`;
  const result = decision(fixtureInput({ command: rawCommand, shell: 'posix', structured_input: { prompt: 'redaction-check-value', target: rawPath } }));
  const text = JSON.stringify(result);
  assert.equal(result.privacy_safe, true);
  assert.doesNotMatch(text, /\.env|send-to-redaction-check|redaction-check-value|private-fixture|fixture\\workspace/i);
  assert.match(text, /SECRET_EXFILTRATION_DENIED/);
});

test('runtime authority path does not parse prose instruction files', () => {
  const runtime = fs.readdirSync(runtimeRoot).filter((name) => name.endsWith('.cjs')).map((name) => fs.readFileSync(path.join(runtimeRoot, name), 'utf8')).join('\n');
  assert.doesNotMatch(runtime, /readFileSync\([^\n]*(?:AGENTS\.md|CLAUDE\.md|GEMINI\.md)/i);
  assert.doesNotMatch(runtime, /parse.*(?:AGENTS\.md|CLAUDE\.md|GEMINI\.md)/i);
  assert.match(fs.readFileSync(path.join(projectRoot, 'curated_output_for_ai', 'guardrail-policy-projection.md'), 'utf8'), /not executable policy/i);
});

test('normalizer preserves explicit nulls and produces the versioned adapter-neutral record', () => {
  const record = normalizer.normalizeOperation(editInside());
  assert.equal(record.contract_version, 'toolkit.guardrail.operation.v1');
  for (const key of ['host', 'host_version', 'session_id', 'turn_id', 'call_id', 'lifecycle_event']) assert.ok(Object.hasOwn(record.session, key));
  for (const key of ['permission_mode', 'auto_or_bypass', 'native_permission_route', 'hook_order_evidence', 'capability_evidence']) assert.ok(Object.hasOwn(record.native_state, key));
  for (const key of ['host_tool', 'canonical_route', 'structured_input', 'opaque_input', 'command', 'shell', 'operation_cwd', 'targets', 'external_targets', 'mutation_class', 'mcp_server', 'mcp_tool', 'input_digest', 'target_digest', 'scope', 'transaction_evidence']) assert.ok(Object.hasOwn(record.operation, key));
  assert.match(record.operation.input_digest, /^[a-f0-9]{64}$/);
  assert.match(record.operation.target_digest, /^[a-f0-9]{64}$/);
});
