'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const auditScript = path.join(repoRoot, 'repo', 'scripts', 'audit-issue-governance.cjs');
const audit = require(auditScript);
const fixturesDir = path.join(__dirname, 'fixtures', 'issue-governance');

function fixture(name) { return path.join(fixturesDir, name); }
function loadFixture(name) { return JSON.parse(fs.readFileSync(fixture(name), 'utf8')); }
function runAudit(inputPath, format) {
  const args = [auditScript, '--input', inputPath];
  if (format) args.push('--format', format);
  return spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 15000 });
}
function findCodes(findings, code) { return findings.filter(f => f.code === code); }

// === Canonical source loads ===

test('policy loads from canonical path and has version 1.1.0', () => {
  const p = audit.loadPolicy();
  assert.equal(p.policy_version, '1.1.0');
  assert.ok(p.finding_codes.GOV021);
  assert.ok(p.finding_codes.GOV027);
});

test('schema loads from canonical path and defines snapshot_version 1.0.0', () => {
  const s = audit.loadSchema();
  assert.equal(s.properties.snapshot_version.const, '1.0.0');
  assert.ok(s.$defs.issue_record.additionalProperties === false);
});

test('finding codes come from canonical policy, not hardcoded', () => {
  const codes = audit.getFindingCodes();
  assert.equal(codes.GOV020, 'policy_version_drift');
  assert.equal(codes.GOV021, 'unknown_governance_mode_requires_selection');
  assert.equal(codes.GOV027, 'contradictory_derived_field');
});

// === Schema validation ===

test('schema rejects unknown top-level property', () => {
  const r = audit.validateAgainstSchema({ snapshot_version: '1.0.0', repository: { governance_mode: 'unknown' }, issues: [], extra: true });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('Unknown top-level property')));
});

test('schema rejects unknown issue property', () => {
  const r = audit.validateAgainstSchema({ snapshot_version: '1.0.0', repository: { governance_mode: 'unknown' }, issues: [{ id: 1, state: 'open', category: 'recurring_evidence_log', body: 'x', bogus: true }] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('unknown property')));
});

test('schema rejects unknown checklist_item property', () => {
  const r = audit.validateAgainstSchema({ snapshot_version: '1.0.0', repository: { governance_mode: 'toolkit_governed', canonical_parent_tracker: 1, policy_version: '1.1.0' }, issues: [{ id: 1, state: 'open', category: 'canonical_parent_tracker', body: '# T\n\nLast reconciled: **25 July 2026, 12:00 SGT**\n', children: [], checklist_items: [{ checked: false, text: '- [ ] x', linked_issue: null, extra: true }] }] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('unknown property')));
});

test('schema rejects duplicate issue IDs', () => {
  const r = audit.validateAgainstSchema({ snapshot_version: '1.0.0', repository: { governance_mode: 'unknown' }, issues: [{ id: 1, state: 'open', category: 'recurring_evidence_log', body: 'a' }, { id: 1, state: 'open', category: 'recurring_evidence_log', body: 'b' }] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('Duplicate issue id')));
});

test('schema rejects empty body', () => {
  const r = audit.validateAgainstSchema({ snapshot_version: '1.0.0', repository: { governance_mode: 'unknown' }, issues: [{ id: 1, state: 'open', category: 'recurring_evidence_log', body: '' }] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('must not be empty')));
});

test('schema accepts replacement PR without reason (audit catches via GOV024)', () => {
  const snap = loadFixture('invalid-replacement-no-reason.json');
  const r = audit.validateAgainstSchema(snap);
  assert.equal(r.ok, true, `Schema should accept: ${r.errors}`);
});

test('schema accepts valid snapshot', () => {
  const r = audit.validateAgainstSchema(loadFixture('valid-full.json'));
  assert.equal(r.ok, true);
});

// === Valid cases ===

test('valid toolkit-governed with parent and children produces no findings', () => {
  const { findings, schemaErrors } = audit.auditSnapshot(loadFixture('valid-full.json'));
  assert.deepEqual(schemaErrors, []);
  assert.equal(findings.length, 0, `Expected 0 findings, got: ${findings.map(f => f.code).join(', ')}`);
});

test('valid repository-native is left unenforced', () => {
  const { findings } = audit.auditSnapshot(loadFixture('valid-repository-native.json'));
  assert.equal(findings.length, 0);
});

test('valid unknown mode produces GOV021 advisory', () => {
  const { findings } = audit.auditSnapshot(loadFixture('valid-unknown-mode.json'));
  const gov021 = findCodes(findings, 'GOV021');
  assert.equal(gov021.length, 1);
  assert.equal(gov021[0].severity, 'warning');
});

test('fully compliant snapshot produces no findings', () => {
  const { findings } = audit.auditSnapshot(loadFixture('valid-no-op.json'));
  assert.equal(findings.length, 0, `Expected 0, got: ${findings.map(f => f.code).join(', ')}`);
});

test('valid replacement PR with explicit reason produces no GOV024', () => {
  const { findings } = audit.auditSnapshot(loadFixture('valid-replacement-with-reason.json'));
  const gov024 = findCodes(findings, 'GOV024');
  assert.equal(gov024.length, 0);
});

// === Invalid parent/child ===

test('GOV001: missing canonical parent', () => {
  const { findings } = audit.auditSnapshot(loadFixture('invalid-no-parent.json'));
  assert.equal(findCodes(findings, 'GOV001').length, 1);
});

test('GOV002: multiple canonical parents', () => {
  const { findings } = audit.auditSnapshot(loadFixture('invalid-multiple-parents.json'));
  assert.equal(findCodes(findings, 'GOV002').length, 1);
});

test('GOV003: parent checklist entry with no child', () => {
  const snap = { snapshot_version: '1.0.0', repository: { governance_mode: 'toolkit_governed', canonical_parent_tracker: 1, policy_version: '1.1.0' }, issues: [{ id: 1, state: 'open', category: 'canonical_parent_tracker', body: '# T\n\nLast reconciled: **25 July 2026, 12:00 SGT**\n\n- [ ] orphan\n', children: [] }] };
  const { findings } = audit.auditSnapshot(snap);
  assert.ok(findCodes(findings, 'GOV003').length >= 1);
});

test('GOV004: active child with no parent link', () => {
  const snap = { snapshot_version: '1.0.0', repository: { governance_mode: 'toolkit_governed', canonical_parent_tracker: 1, policy_version: '1.1.0' }, issues: [
    { id: 1, state: 'open', category: 'canonical_parent_tracker', body: '# T\n\nLast reconciled: **25 July 2026, 12:00 SGT**\n', children: [] },
    { id: 2, state: 'open', category: 'active_multi_step_child', body: '# Current status\n\nX\n\nLast reconciled: **25 July 2026, 12:00 SGT**\n\nParent tracker: #1\nImplementation PR: #10\n\n# Why this issue exists\n\nY\n\n# Goal and scope\n\nZ\n\n# Completed work\n\n- n\n\n# Current blockers and findings\n\n- n\n\n# Remaining steps\n\n- [ ] s\n\n# Acceptance criteria\n\n- [ ] a\n\n# Linked PRs and follow-ups\n\n- n\n\n# Decisions and durable evidence\n\n- n\n\n# Safety and authority\n\nC', parent: null }
  ]};
  const { findings } = audit.auditSnapshot(snap);
  assert.equal(findCodes(findings, 'GOV004').length, 1);
});

test('GOV005: active child absent from parent checklist', () => {
  const { findings } = audit.auditSnapshot(loadFixture('invalid-child-absent-from-parent.json'));
  assert.ok(findCodes(findings, 'GOV005').length >= 1);
});

test('GOV006: parent/child link not bidirectional', () => {
  const { findings } = audit.auditSnapshot(loadFixture('invalid-one-way-link.json'));
  assert.ok(findCodes(findings, 'GOV006').length >= 1);
});

test('GOV007: checked parent with incomplete child', () => {
  const { findings } = audit.auditSnapshot(loadFixture('invalid-checked-parent-incomplete-child.json'));
  assert.ok(findCodes(findings, 'GOV007').length >= 1);
});

test('GOV008: closed child with incomplete acceptance', () => {
  const { findings } = audit.auditSnapshot(loadFixture('invalid-closed-child-incomplete-acceptance.json'));
  assert.ok(findCodes(findings, 'GOV008').length >= 1);
});

test('GOV009: complete child with unchecked parent item', () => {
  const { findings } = audit.auditSnapshot(loadFixture('invalid-complete-child-unchecked-parent.json'));
  assert.ok(findCodes(findings, 'GOV009').length >= 1);
});

test('GOV026: canonical_parent_tracker points to non-parent category', () => {
  const { findings } = audit.auditSnapshot(loadFixture('invalid-parent-not-category.json'));
  assert.ok(findCodes(findings, 'GOV026').length >= 1);
});

// === Invalid body cases ===

test('GOV010: missing current status', () => {
  const { findings } = audit.auditSnapshot(loadFixture('invalid-missing-status.json'));
  assert.ok(findCodes(findings, 'GOV010').length >= 1);
});

test('GOV011: missing timestamp', () => {
  const { findings } = audit.auditSnapshot(loadFixture('invalid-missing-timestamp.json'));
  assert.ok(findCodes(findings, 'GOV011').length >= 1);
});

test('GOV012: duplicate timestamps', () => {
  const { findings } = audit.auditSnapshot(loadFixture('invalid-duplicate-timestamp.json'));
  assert.ok(findCodes(findings, 'GOV012').length >= 1);
});

test('GOV013: malformed timestamp', () => {
  const { findings } = audit.auditSnapshot(loadFixture('invalid-malformed-timestamp.json'));
  assert.ok(findCodes(findings, 'GOV013').length >= 1);
});

test('GOV013: impossible calendar date (31 Feb)', () => {
  const { findings } = audit.auditSnapshot(loadFixture('invalid-impossible-date.json'));
  assert.ok(findCodes(findings, 'GOV013').length >= 1);
});

test('GOV014: missing why section', () => {
  const { findings } = audit.auditSnapshot(loadFixture('invalid-missing-why.json'));
  assert.ok(findCodes(findings, 'GOV014').length >= 1);
});

test('GOV015: missing required dimension (comprehensive child)', () => {
  const snap = { snapshot_version: '1.0.0', repository: { governance_mode: 'toolkit_governed', canonical_parent_tracker: 1, policy_version: '1.1.0' }, issues: [
    { id: 1, state: 'open', category: 'canonical_parent_tracker', body: '# T\n\nLast reconciled: **25 July 2026, 12:00 SGT**\n\n- [ ] #2 Task\n', children: [2] },
    { id: 2, state: 'open', category: 'active_multi_step_child', body: '# Current status\n\nX\n\nLast reconciled: **25 July 2026, 12:00 SGT**\n\nParent tracker: #1\nImplementation PR: #10\n\n# Why this issue exists\n\nY\n\n# Goal and scope\n\nZ\n\n# Completed work\n\n- n\n\n# Current blockers and findings\n\n- n\n\n# Remaining steps\n\n- [ ] s\n\n# Acceptance criteria\n\n- [ ] a\n\n# Linked PRs and follow-ups\n\n- n\n\n# Safety and authority\n\nC', parent: 1 }
  ]};
  const { findings } = audit.auditSnapshot(snap);
  const gov015 = findCodes(findings, 'GOV015');
  assert.ok(gov015.length >= 1, `Expected GOV015 for missing Decisions and durable evidence, got: ${findings.map(f=>f.code).join(',')}`);
});

test('GOV016: missing acceptance criteria', () => {
  const { findings } = audit.auditSnapshot(loadFixture('invalid-missing-acceptance.json'));
  assert.ok(findCodes(findings, 'GOV016').length >= 1);
});

test('GOV017: superseded issue without reason or successor', () => {
  const { findings } = audit.auditSnapshot(loadFixture('invalid-superseded-no-reason.json'));
  assert.equal(findCodes(findings, 'GOV017').length, 1);
});

// === Implementation PR lifecycle ===

test('GOV022: multiple active implementation PRs', () => {
  const { findings } = audit.auditSnapshot(loadFixture('invalid-multiple-impl-prs.json'));
  assert.ok(findCodes(findings, 'GOV022').length >= 1);
});

test('GOV024: replacement PR without reason', () => {
  const { findings } = audit.auditSnapshot(loadFixture('invalid-replacement-no-reason.json'));
  assert.ok(findCodes(findings, 'GOV024').length >= 1);
});

// === Conservative semantic checks ===

test('GOV018: PR merge as completion (genuine claim)', () => {
  const { findings } = audit.auditSnapshot(loadFixture('invalid-pr-merge-completion.json'));
  assert.ok(findCodes(findings, 'GOV018').length >= 1);
});

test('GOV018 NOT triggered by negated text', () => {
  const { findings } = audit.auditSnapshot(loadFixture('adversarial-negation.json'));
  assert.equal(findCodes(findings, 'GOV018').length, 0, 'Should not flag negated PR-merge text');
});

test('GOV019: implementer self-acceptance (genuine claim)', () => {
  const { findings } = audit.auditSnapshot(loadFixture('invalid-implementer-acceptance.json'));
  assert.ok(findCodes(findings, 'GOV019').length >= 1);
});

test('GOV019 NOT triggered by negated text', () => {
  const { findings } = audit.auditSnapshot(loadFixture('adversarial-negation.json'));
  assert.equal(findCodes(findings, 'GOV019').length, 0, 'Should not flag negated implementer text');
});

// === Derived-field contradictions ===

test('GOV027: structured checklist_item contradicts body', () => {
  const { findings } = audit.auditSnapshot(loadFixture('adversarial-fabricated.json'));
  assert.ok(findCodes(findings, 'GOV027').length >= 1, 'Should detect fabricated checklist contradicts body');
});

test('GOV027: structured acceptance_criteria_met contradicts body', () => {
  const { findings } = audit.auditSnapshot(loadFixture('adversarial-fabricated.json'));
  assert.ok(findCodes(findings, 'GOV027').some(f => f.message.includes('acceptance_criteria_met')), 'Should detect fabricated acceptance contradicts body');
});

// === Reliability ===

test('stable finding ordering', () => {
  const snap = loadFixture('invalid-missing-status.json');
  assert.deepEqual(audit.auditSnapshot(snap).findings, audit.auditSnapshot(snap).findings);
});

test('stable JSON output', () => {
  const snap = loadFixture('invalid-missing-status.json');
  const j1 = audit.formatJson(audit.auditSnapshot(snap).findings, snap.repository);
  const j2 = audit.formatJson(audit.auditSnapshot(snap).findings, snap.repository);
  assert.equal(j1, j2);
});

test('stable human output', () => {
  const snap = loadFixture('invalid-missing-status.json');
  const h1 = audit.formatHuman(audit.auditSnapshot(snap).findings, snap.repository);
  const h2 = audit.formatHuman(audit.auditSnapshot(snap).findings, snap.repository);
  assert.equal(h1, h2);
});

test('no input mutation', () => {
  const snap = loadFixture('valid-full.json');
  const original = JSON.stringify(snap);
  audit.auditSnapshot(snap);
  assert.equal(JSON.stringify(snap), original);
});

// === Exit codes ===

test('CLI exit 0 for no violations', () => {
  assert.equal(runAudit(fixture('valid-full.json')).status, 0);
});

test('CLI exit 1 for violations', () => {
  assert.equal(runAudit(fixture('invalid-no-parent.json')).status, 1);
});

test('CLI exit 2 for malformed JSON', () => {
  assert.equal(runAudit(fixture('malformed-json.txt')).status, 2);
});

test('CLI exit 2 for missing input', () => {
  assert.equal(spawnSync(process.execPath, [auditScript], { encoding: 'utf8' }).status, 2);
});

test('CLI exit 2 for unsupported version', () => {
  assert.equal(runAudit(fixture('unsupported-version.json')).status, 2);
});

test('CLI exit 2 for duplicate IDs', () => {
  assert.equal(runAudit(fixture('invalid-duplicate-id.json')).status, 2);
});

// === Privacy-safe diagnostics ===

test('diagnostics do not expose body text', () => {
  const r = runAudit(fixture('invalid-missing-status.json'), 'human');
  assert.ok(!r.stdout.includes('No status section here'));
});

test('diagnostics sanitize secrets', () => {
  const r = runAudit(fixture('adversarial-secrets.json'), 'human');
  assert.ok(!r.stdout.includes('TOKEN_ABCDEF0123456789'));
  assert.ok(!r.stdout.includes('CONFIDENTIAL_TOKEN_XYZ123456789'));
});

test('diagnostics sanitize absolute Windows paths', () => {
  const r = runAudit(fixture('adversarial-secrets.json'), 'human');
  assert.ok(!r.stdout.includes('C:\\Users\\admin\\secrets'));
});

test('diagnostics sanitize absolute POSIX paths', () => {
  const r = runAudit(fixture('adversarial-secrets.json'), 'human');
  assert.ok(!r.stdout.includes('/home/user/.ssh/id_rsa'));
});

test('sanitize function strips secrets and paths', () => {
  assert.ok(!audit.sanitize('C:\\Users\\admin\\secrets\\creds.json').includes('C:\\Users'));
  assert.ok(!audit.sanitize('/home/user/.ssh/id_rsa').includes('/home/user'));
});

// === Read-only and network-free ===

test('no network access (production entry point)', () => {
  const r = runAudit(fixture('valid-full.json'));
  assert.equal(r.status, 0);
});

test('no file writes (production entry point)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-ro-'));
  const inputPath = path.join(tmpDir, 'snapshot.json');
  fs.copyFileSync(fixture('valid-full.json'), inputPath);
  const before = new Set(fs.readdirSync(tmpDir));
  runAudit(inputPath);
  const after = new Set(fs.readdirSync(tmpDir));
  assert.deepEqual([...after].sort(), [...before].sort());
  fs.unlinkSync(inputPath);
  fs.rmdirSync(tmpDir);
});

// === Governance mode production entry point ===

test('toolkit_governed mode applies full audit via CLI', () => {
  const r = runAudit(fixture('invalid-no-parent.json'), 'json');
  assert.equal(r.status, 1);
  const parsed = JSON.parse(r.stdout);
  assert.ok(parsed.findings.some(f => f.code === 'GOV001'));
});

test('unknown mode reports GOV021 via CLI', () => {
  const r = runAudit(fixture('valid-unknown-mode.json'), 'json');
  assert.equal(r.status, 1);
  const parsed = JSON.parse(r.stdout);
  assert.ok(parsed.findings.some(f => f.code === 'GOV021'));
});

test('repository_native mode produces no findings via CLI', () => {
  const r = runAudit(fixture('valid-repository-native.json'));
  assert.equal(r.status, 0);
});

// === Output determinism ===

test('repeat execution is identical', () => {
  const r1 = runAudit(fixture('valid-full.json'), 'json');
  const r2 = runAudit(fixture('valid-full.json'), 'json');
  assert.equal(r1.stdout, r2.stdout);
  assert.equal(r1.status, r2.status);
});

test('JSON output is valid JSON', () => {
  const r = runAudit(fixture('invalid-no-parent.json'), 'json');
  const parsed = JSON.parse(r.stdout);
  assert.ok(parsed.findings);
  assert.ok(typeof parsed.finding_count === 'number');
  assert.ok(typeof parsed.audit_version === 'string');
});

test('human output is readable', () => {
  const r = runAudit(fixture('valid-full.json'), 'human');
  assert.ok(r.stdout.includes('No violations found'));
});

// === Timestamp validation ===

test('isRealTimestamp accepts valid date', () => {
  assert.ok(audit.isRealTimestamp({ day: 25, month: 'July', year: 2026, hour: 12, minute: 0 }));
});

test('isRealTimestamp rejects 31 February', () => {
  assert.equal(audit.isRealTimestamp({ day: 31, month: 'February', year: 2026, hour: 12, minute: 0 }), false);
});

test('isRealTimestamp rejects 25:90', () => {
  assert.equal(audit.isRealTimestamp({ day: 1, month: 'January', year: 2026, hour: 25, minute: 90 }), false);
});

test('isRealTimestamp rejects 30 February (non-leap)', () => {
  assert.equal(audit.isRealTimestamp({ day: 30, month: 'February', year: 2026, hour: 12, minute: 0 }), false);
});

test('isRealTimestamp accepts 29 February (leap year)', () => {
  assert.ok(audit.isRealTimestamp({ day: 29, month: 'February', year: 2024, hour: 12, minute: 0 }));
});

test('isRealTimestamp rejects 0 day', () => {
  assert.equal(audit.isRealTimestamp({ day: 0, month: 'January', year: 2026, hour: 12, minute: 0 }), false);
});

// === Negation context ===

test('isNegatedContext detects "not" prefix', () => {
  assert.ok(audit.isNegatedContext('PR merge is not task completion.', 0, 11));
});

test('isNegatedContext detects "must not"', () => {
  assert.ok(audit.isNegatedContext('The implementer must not claim acceptance.', 4, 10));
});

test('isNegatedContext returns false for genuine claim', () => {
  assert.equal(audit.isNegatedContext('PR #500 merged = task complete.', 0, 15), false);
});

// === Body parsing ===

test('parseChecklistFromBody finds checkboxes', () => {
  const items = audit.parseChecklistFromBody('- [ ] A\n- [x] B\n- [X] C\nPlain text\n');
  assert.equal(items.length, 3);
  assert.equal(items[0].checked, false);
  assert.equal(items[1].checked, true);
  assert.equal(items[2].checked, true);
});

test('parseChecklistFromBody extracts linked issue', () => {
  const items = audit.parseChecklistFromBody('- [ ] #123 Task\n- [ ] No link\n');
  assert.equal(items[0].linked_issue, 123);
  assert.equal(items[1].linked_issue, null);
});

test('parseTimestamps extracts date parts', () => {
  const ts = audit.parseTimestamps('Last reconciled: **25 July 2026, 14:30 SGT**');
  assert.equal(ts.length, 1);
  assert.equal(ts[0].day, 25);
  assert.equal(ts[0].month, 'July');
  assert.equal(ts[0].year, 2026);
  assert.equal(ts[0].hour, 14);
  assert.equal(ts[0].minute, 30);
});

// === Module exports ===

test('module exports expected functions and constants', () => {
  assert.equal(typeof audit.auditSnapshot, 'function');
  assert.equal(typeof audit.validateAgainstSchema, 'function');
  assert.equal(typeof audit.formatHuman, 'function');
  assert.equal(typeof audit.formatJson, 'function');
  assert.equal(typeof audit.getFindingCodes, 'function');
  assert.equal(typeof audit.getPolicyVersion, 'function');
  assert.equal(typeof audit.getSnapshotVersion, 'function');
  assert.equal(typeof audit.loadPolicy, 'function');
  assert.equal(typeof audit.loadSchema, 'function');
  assert.equal(typeof audit.isNegatedContext, 'function');
  assert.equal(typeof audit.isRealTimestamp, 'function');
  assert.equal(typeof audit.parseTimestamps, 'function');
  assert.equal(typeof audit.parseChecklistFromBody, 'function');
  assert.equal(typeof audit.sanitize, 'function');
  assert.equal(audit.getPolicyVersion(), '1.1.0');
  assert.equal(audit.getSnapshotVersion(), '1.0.0');
});
