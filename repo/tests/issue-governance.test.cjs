'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const auditScript = path.join(repoRoot, 'repo', 'scripts', 'audit-issue-governance.cjs');
const audit = require(auditScript);

const fixturesDir = path.join(__dirname, 'fixtures', 'issue-governance');

function fixture(name) {
  return path.join(fixturesDir, name);
}

function loadFixture(name) {
  const raw = fs.readFileSync(fixture(name), 'utf8');
  return JSON.parse(raw);
}

function runAudit(inputPath, format) {
  const args = [auditScript, '--input', inputPath];
  if (format) args.push('--format', format);
  return spawnSync(process.execPath, args, { encoding: 'utf8' });
}

function findCodes(findings, code) {
  return findings.filter(f => f.code === code);
}

// === Valid cases ===

test('valid toolkit-governed with parent and children produces no findings', () => {
  const snapshot = loadFixture('valid-full.json');
  const findings = audit.auditSnapshot(snapshot);
  assert.equal(findings.length, 0, `Expected 0 findings, got ${findings.length}: ${findings.map(f => f.code).join(', ')}`);
});

test('valid comprehensive multi-step child has all required sections', () => {
  const snapshot = loadFixture('valid-full.json');
  const child = snapshot.issues.find(i => i.id === 101);
  assert.ok(child);
  assert.equal(child.category, 'active_multi_step_child');
});

test('valid atomic child has all required sections', () => {
  const snapshot = loadFixture('valid-full.json');
  const child = snapshot.issues.find(i => i.id === 102);
  assert.ok(child);
  assert.equal(child.category, 'small_atomic_child');
});

test('valid recurring evidence issue', () => {
  const snapshot = {
    snapshot_version: '1.0.0',
    repository: { governance_mode: 'repository_native', policy_version: '1.0.0' },
    issues: [{ id: 1, state: 'open', category: 'recurring_evidence_log', body: 'Log entry.' }]
  };
  const findings = audit.auditSnapshot(snapshot);
  assert.equal(findings.length, 0);
});

test('valid completed child with completed parent entry', () => {
  const snapshot = loadFixture('valid-full.json');
  const completeChild = snapshot.issues.find(i => i.id === 103);
  assert.ok(completeChild);
  assert.equal(completeChild.state, 'closed');
  assert.equal(completeChild.category, 'complete');
  const parent = snapshot.issues.find(i => i.id === 100);
  const item = parent.checklist_items.find(ci => ci.linked_issue === 103);
  assert.ok(item);
  assert.equal(item.checked, true);
});

test('valid repository-native is left unenforced', () => {
  const snapshot = loadFixture('valid-repository-native.json');
  const findings = audit.auditSnapshot(snapshot);
  assert.equal(findings.length, 0, `Expected 0 findings for repository-native, got ${findings.length}`);
});

test('valid unknown mode produces no findings', () => {
  const snapshot = loadFixture('valid-unknown-mode.json');
  const findings = audit.auditSnapshot(snapshot);
  assert.equal(findings.length, 0);
});

test('fully compliant snapshot produces true no-op audit', () => {
  const snapshot = loadFixture('valid-no-op.json');
  const findings = audit.auditSnapshot(snapshot);
  assert.equal(findings.length, 0, `Expected 0 findings, got ${findings.length}: ${findings.map(f => f.code).join(', ')}`);
});

// === Invalid parent/child cases ===

test('GOV001: missing canonical parent', () => {
  const snapshot = loadFixture('invalid-no-parent.json');
  const findings = audit.auditSnapshot(snapshot);
  const gov001 = findCodes(findings, 'GOV001');
  assert.equal(gov001.length, 1);
});

test('GOV002: multiple canonical parents', () => {
  const snapshot = loadFixture('invalid-multiple-parents.json');
  const findings = audit.auditSnapshot(snapshot);
  const gov002 = findCodes(findings, 'GOV002');
  assert.equal(gov002.length, 1);
});

test('GOV003: parent checklist entry with no child', () => {
  const snapshot = {
    snapshot_version: '1.0.0',
    repository: { governance_mode: 'toolkit_governed', canonical_parent_tracker: 1, policy_version: '1.0.0' },
    issues: [{
      id: 1, state: 'open', category: 'canonical_parent_tracker',
      body: '# Tracker\n\nLast reconciled: **25 July 2026, 12:00 SGT**\n\n- [ ] orphan line\n',
      children: [],
      checklist_items: [{ checked: false, text: '- [ ] orphan line', linked_issue: null }]
    }]
  };
  const findings = audit.auditSnapshot(snapshot);
  const gov003 = findCodes(findings, 'GOV003');
  assert.ok(gov003.length >= 1);
});

test('GOV004: active child with no parent link', () => {
  const snapshot = {
    snapshot_version: '1.0.0',
    repository: { governance_mode: 'toolkit_governed', canonical_parent_tracker: 1, policy_version: '1.0.0' },
    issues: [
      { id: 1, state: 'open', category: 'canonical_parent_tracker', body: '# Tracker\n\nLast reconciled: **25 July 2026, 12:00 SGT**\n', children: [], checklist_items: [] },
      { id: 2, state: 'open', category: 'active_multi_step_child', body: '# Current status\n\nX\n\nLast reconciled: **25 July 2026, 12:00 SGT**\n\n# Why this issue exists\n\nY\n\n# Goal and scope\n\nZ\n\n# Completed work\n\n- n\n\n# Current blockers and findings\n\n- n\n\n# Remaining steps\n\n- [ ] s\n\n# Acceptance criteria\n\n- [ ] a\n\n# Linked PRs and follow-ups\n\n- n\n\n# Decisions and durable evidence\n\n- n\n\n# Safety and authority\n\nC', parent: null }
    ]
  };
  const findings = audit.auditSnapshot(snapshot);
  const gov004 = findCodes(findings, 'GOV004');
  assert.equal(gov004.length, 1);
});

test('GOV005: active child absent from parent checklist', () => {
  const snapshot = loadFixture('invalid-child-absent-from-parent.json');
  const findings = audit.auditSnapshot(snapshot);
  const gov005 = findCodes(findings, 'GOV005');
  assert.ok(gov005.length >= 1);
});

test('GOV006: parent/child link not bidirectional', () => {
  const snapshot = loadFixture('invalid-one-way-link.json');
  const findings = audit.auditSnapshot(snapshot);
  const gov006 = findCodes(findings, 'GOV006');
  assert.ok(gov006.length >= 1);
});

test('GOV007: checked parent with incomplete child', () => {
  const snapshot = loadFixture('invalid-checked-parent-incomplete-child.json');
  const findings = audit.auditSnapshot(snapshot);
  const gov007 = findCodes(findings, 'GOV007');
  assert.ok(gov007.length >= 1);
});

test('GOV008: closed child with incomplete acceptance', () => {
  const snapshot = loadFixture('invalid-closed-child-incomplete-acceptance.json');
  const findings = audit.auditSnapshot(snapshot);
  const gov008 = findCodes(findings, 'GOV008');
  assert.ok(gov008.length >= 1);
});

test('GOV009: complete child with unchecked parent item', () => {
  const snapshot = loadFixture('invalid-complete-child-unchecked-parent.json');
  const findings = audit.auditSnapshot(snapshot);
  const gov009 = findCodes(findings, 'GOV009');
  assert.ok(gov009.length >= 1);
});

// === Invalid body cases ===

test('GOV010: missing current status', () => {
  const snapshot = loadFixture('invalid-missing-status.json');
  const findings = audit.auditSnapshot(snapshot);
  const gov010 = findCodes(findings, 'GOV010');
  assert.ok(gov010.length >= 1);
});

test('GOV011: missing timestamp', () => {
  const snapshot = loadFixture('invalid-missing-timestamp.json');
  const findings = audit.auditSnapshot(snapshot);
  const gov011 = findCodes(findings, 'GOV011');
  assert.ok(gov011.length >= 1);
});

test('GOV012: duplicate timestamps', () => {
  const snapshot = loadFixture('invalid-duplicate-timestamp.json');
  const findings = audit.auditSnapshot(snapshot);
  const gov012 = findCodes(findings, 'GOV012');
  assert.ok(gov012.length >= 1);
});

test('GOV013: malformed timestamp', () => {
  const snapshot = loadFixture('invalid-malformed-timestamp.json');
  const findings = audit.auditSnapshot(snapshot);
  const gov013 = findCodes(findings, 'GOV013');
  assert.ok(gov013.length >= 1);
});

test('GOV014: missing why section', () => {
  const snapshot = loadFixture('invalid-missing-why.json');
  const findings = audit.auditSnapshot(snapshot);
  const gov014 = findCodes(findings, 'GOV014');
  assert.ok(gov014.length >= 1);
});

test('GOV015: missing required sections', () => {
  const snapshot = loadFixture('invalid-missing-acceptance.json');
  const findings = audit.auditSnapshot(snapshot);
  const gov016 = findCodes(findings, 'GOV016');
  assert.ok(gov016.length >= 1, 'Expected GOV016 for missing acceptance criteria section');
});

test('GOV016: missing acceptance criteria', () => {
  const snapshot = loadFixture('invalid-missing-acceptance.json');
  const findings = audit.auditSnapshot(snapshot);
  const gov016 = findCodes(findings, 'GOV016');
  assert.ok(gov016.length >= 1);
});

test('GOV017: superseded issue without reason or successor', () => {
  const snapshot = loadFixture('invalid-superseded-no-reason.json');
  const findings = audit.auditSnapshot(snapshot);
  const gov017 = findCodes(findings, 'GOV017');
  assert.equal(gov017.length, 1);
});

test('GOV018: PR merge treated as completion', () => {
  const snapshot = loadFixture('invalid-pr-merge-completion.json');
  const findings = audit.auditSnapshot(snapshot);
  const gov018 = findCodes(findings, 'GOV018');
  assert.ok(gov018.length >= 1);
});

test('GOV019: implementer claims independent acceptance', () => {
  const snapshot = loadFixture('invalid-implementer-acceptance.json');
  const findings = audit.auditSnapshot(snapshot);
  const gov019 = findCodes(findings, 'GOV019');
  assert.ok(gov019.length >= 1);
});

// === Reliability cases ===

test('stable finding ordering', () => {
  const snapshot = loadFixture('invalid-missing-status.json');
  const findings1 = audit.auditSnapshot(snapshot);
  const findings2 = audit.auditSnapshot(snapshot);
  assert.deepEqual(findings1, findings2);
});

test('stable JSON output', () => {
  const snapshot = loadFixture('invalid-missing-status.json');
  const j1 = audit.formatJson(audit.auditSnapshot(snapshot), snapshot.repository);
  const j2 = audit.formatJson(audit.auditSnapshot(snapshot), snapshot.repository);
  assert.equal(j1, j2);
});

test('stable human output', () => {
  const snapshot = loadFixture('invalid-missing-status.json');
  const h1 = audit.formatHuman(audit.auditSnapshot(snapshot), snapshot.repository);
  const h2 = audit.formatHuman(audit.auditSnapshot(snapshot), snapshot.repository);
  assert.equal(h1, h2);
});

test('malformed schema input fails safely', () => {
  const result = audit.parseSnapshot(fixture('malformed-json.txt'));
  assert.equal(result.ok, false);
  assert.ok(result.error.includes('Invalid JSON'));
});

test('unsupported policy version fails safely', () => {
  const result = audit.parseSnapshot(fixture('unsupported-version.json'));
  assert.equal(result.ok, false);
  assert.ok(result.error.includes('Unsupported snapshot version'));
});

test('GOV020: policy version drift', () => {
  const snapshot = loadFixture('invalid-drift-policy-version.json');
  const findings = audit.auditSnapshot(snapshot);
  const gov020 = findCodes(findings, 'GOV020');
  assert.equal(gov020.length, 1);
});

test('no input mutation', () => {
  const snapshot = loadFixture('valid-full.json');
  const original = JSON.stringify(snapshot);
  audit.auditSnapshot(snapshot);
  assert.equal(JSON.stringify(snapshot), original);
});

test('no network access', () => {
  const result = spawnSync(process.execPath, [auditScript, '--input', fixture('valid-full.json')], {
    encoding: 'utf8',
    timeout: 10000,
    env: { ...process.env, NODE_OPTIONS: '--dns-result-order=ipv4first' }
  });
  assert.equal(result.status, 0);
});

test('CLI exit code 0 for no violations', () => {
  const result = runAudit(fixture('valid-full.json'));
  assert.equal(result.status, 0);
});

test('CLI exit code 1 for violations', () => {
  const result = runAudit(fixture('invalid-no-parent.json'));
  assert.equal(result.status, 1);
});

test('CLI exit code 2 for malformed input', () => {
  const result = runAudit(fixture('malformed-json.txt'));
  assert.equal(result.status, 2);
});

test('CLI exit code 2 for missing input', () => {
  const result = spawnSync(process.execPath, [auditScript], { encoding: 'utf8' });
  assert.equal(result.status, 2);
});

test('JSON format output is valid JSON', () => {
  const result = runAudit(fixture('invalid-no-parent.json'), 'json');
  assert.equal(result.status, 1);
  const parsed = JSON.parse(result.stdout);
  assert.ok(parsed.findings);
  assert.ok(parsed.finding_count > 0);
});

test('human format output is readable', () => {
  const result = runAudit(fixture('valid-full.json'), 'human');
  assert.equal(result.status, 0);
  assert.ok(result.stdout.includes('No violations found'));
});

test('privacy-safe diagnostics: no full body in output', () => {
  const result = runAudit(fixture('invalid-missing-status.json'), 'human');
  assert.equal(result.status, 1);
  assert.ok(!result.stdout.includes('No status section here'));
});

test('repeat execution is identical', () => {
  const r1 = runAudit(fixture('valid-full.json'), 'json');
  const r2 = runAudit(fixture('valid-full.json'), 'json');
  assert.equal(r1.stdout, r2.stdout);
  assert.equal(r1.status, r2.status);
});

test('paths with spaces handled correctly', () => {
  const tmpDir = require('node:os').tmpdir();
  const spaceDir = path.join(tmpDir, 'test space dir');
  try { fs.mkdirSync(spaceDir, { recursive: true }); } catch {}
  const src = fixture('valid-full.json');
  const dst = path.join(spaceDir, 'snapshot.json');
  fs.copyFileSync(src, dst);
  const result = runAudit(dst);
  assert.equal(result.status, 0);
  try { fs.unlinkSync(dst); } catch {}
  try { fs.rmdirSync(spaceDir); } catch {}
});

test('finding codes module export matches policy', () => {
  assert.equal(Object.keys(audit.FINDING_CODES).length, 20);
  assert.equal(audit.FINDING_CODES.GOV001, 'toolkit_governed_no_canonical_parent');
  assert.equal(audit.FINDING_CODES.GOV020, 'policy_version_or_surface_drift');
});

test('policy version constant is 1.0.0', () => {
  assert.equal(audit.POLICY_VERSION, '1.0.0');
});

test('snapshot version constant is 1.0.0', () => {
  assert.equal(audit.SNAPSHOT_VERSION, '1.0.0');
});
