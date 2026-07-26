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
const interceptorPath = path.join(fixturesDir, 'intercept-side-effects.cjs');
const manifestPath = path.join(fixturesDir, 'manifest.json');
const { buildTestRegistry, auditWithRegistry } = require('./lib/test-engine');
const { assertExactTuples } = require('./lib/exact-oracle');

function fixture(name) { return path.join(fixturesDir, name); }
function loadFixture(name) { return JSON.parse(fs.readFileSync(fixture(name), 'utf8')); }
function runAudit(inputPath, format) {
  var args = [auditScript, '--input', inputPath];
  if (format) args.push('--format', format);
  return spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 15000 });
}
function runAuditWithInterceptor(inputPath, format) {
  var args = ['--require', interceptorPath, auditScript, '--input', inputPath];
  if (format) args.push('--format', format);
  return spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 15000 });
}
function findCodes(findings, code) { return findings.filter(function(f) { return f.code === code; }); }

test('policy loads from canonical path and has version 2.0.0', function() {
  var p = JSON.parse(fs.readFileSync(path.join(repoRoot, '_projects', 'development', 'issue-governance', '_main', 'policy', 'issue-governance-policy.json'), 'utf8'));
  assert.equal(p.policy_version, '2.0.0');
  assert.ok(typeof p.finding_codes.GOV001 === 'object');
  assert.equal(p.finding_codes.GOV001.severity, 'error');
});

test('schema loads from canonical path and defines snapshot_version 2.0.0', function() {
  var s = JSON.parse(fs.readFileSync(path.join(repoRoot, '_projects', 'development', 'issue-governance', '_main', 'schema', 'issue-snapshot.schema.json'), 'utf8'));
  assert.equal(s.properties.snapshot_version.const, '2.0.0');
});

test('schema has draft in enum for implementation_prs state', function() {
  var s = JSON.parse(fs.readFileSync(path.join(repoRoot, '_projects', 'development', 'issue-governance', '_main', 'schema', 'issue-snapshot.schema.json'), 'utf8'));
  var states = s.$defs.issue_record.properties.implementation_prs.items.properties.state.enum;
  assert.ok(states.includes('draft'));
  assert.ok(states.includes('open'));
  assert.ok(states.includes('closed'));
  assert.ok(states.includes('merged'));
});

test('complete category removed from schema enum', function() {
  var s = JSON.parse(fs.readFileSync(path.join(repoRoot, '_projects', 'development', 'issue-governance', '_main', 'schema', 'issue-snapshot.schema.json'), 'utf8'));
  var cats = s.$defs.issue_record.properties.category.enum;
  assert.ok(!cats.includes('complete'));
});

test('valid toolkit-governed with parent and children produces no findings', function() {
  var result = audit.auditSnapshot(loadFixture('valid-full.json'));
  assert.deepEqual(result.schemaErrors, []);
  assert.equal(result.findings.length, 0, 'Expected 0 findings, got: ' + result.findings.map(function(f) { return f.code; }).join(', '));
});

test('valid repository-native is left unenforced', function() {
  var result = audit.auditSnapshot(loadFixture('valid-repository-native.json'));
  assert.equal(result.findings.length, 0);
});

test('valid unknown mode produces GOV021 advisory', function() {
  var result = audit.auditSnapshot(loadFixture('valid-unknown-mode.json'));
  var gov021 = findCodes(result.findings, 'GOV021');
  assert.equal(gov021.length, 1);
  assert.equal(gov021[0].severity, 'warning');
});

test('fully compliant snapshot produces no findings', function() {
  var result = audit.auditSnapshot(loadFixture('valid-no-op.json'));
  assert.equal(result.findings.length, 0, 'Expected 0, got: ' + result.findings.map(function(f) { return f.code; }).join(', '));
});

test('valid replacement PR with explicit reason produces no GOV024', function() {
  var result = audit.auditSnapshot(loadFixture('valid-replacement-with-reason.json'));
  var gov024 = findCodes(result.findings, 'GOV024');
  assert.equal(gov024.length, 0);
});

test('GOV001: missing canonical parent', function() {
  var result = audit.auditSnapshot(loadFixture('invalid-no-parent.json'));
  assert.ok(findCodes(result.findings, 'GOV001').length >= 1);
});

test('GOV002: multiple canonical parents', function() {
  var result = audit.auditSnapshot(loadFixture('invalid-multiple-parents.json'));
  assert.ok(findCodes(result.findings, 'GOV002').length >= 1);
});

test('GOV004: active child with no parent link', function() {
  var snap = { snapshot_version: '2.0.0', repository: { governance_mode: 'toolkit_governed', canonical_parent_tracker: 1, policy_version: '2.0.0' }, issues: [
    { id: 1, state: 'open', category: 'canonical_parent_tracker', body: '# T\n\nLast reconciled: **25 July 2026, 12:00 SGT**\n', children: [] },
    { id: 2, state: 'open', category: 'active_multi_step_child', body: '# Current status\n\nX\n\nLast reconciled: **25 July 2026, 12:00 SGT**\n\nParent tracker: #1\nImplementation branch: null\nImplementation PR: Not opened\n\n# Why this issue exists\n\nY\n\n# Goal and scope\n\nZ\n\n# Completed work\n\n- n\n\n# Current blockers and findings\n\n- n\n\n# Remaining steps\n\n- [ ] s\n\n# Acceptance criteria\n\n- [ ] a\n\n# Linked PRs and follow-ups\n\n- n\n\n# Decisions and durable evidence\n\n- n\n\n# Safety and authority\n\nC', parent: null }
  ]};
  var result = audit.auditSnapshot(snap);
  assert.ok(findCodes(result.findings, 'GOV004').length >= 1);
});

test('GOV005: active child absent from parent checklist', function() {
  var result = audit.auditSnapshot(loadFixture('invalid-child-absent-from-parent.json'));
  assert.ok(findCodes(result.findings, 'GOV005').length >= 1);
});

test('GOV006: parent/child link not bidirectional', function() {
  var result = audit.auditSnapshot(loadFixture('invalid-one-way-link.json'));
  assert.ok(findCodes(result.findings, 'GOV006').length >= 1);
});

test('GOV007: checked parent with incomplete child', function() {
  var result = audit.auditSnapshot(loadFixture('invalid-checked-parent-incomplete-child.json'));
  assert.ok(findCodes(result.findings, 'GOV007').length >= 1);
});

test('GOV008: closed child with incomplete acceptance', function() {
  var result = audit.auditSnapshot(loadFixture('invalid-closed-child-incomplete-acceptance.json'));
  assert.ok(findCodes(result.findings, 'GOV008').length >= 1);
});

test('GOV009: closed child with unchecked parent item', function() {
  var result = audit.auditSnapshot(loadFixture('invalid-complete-child-unchecked-parent.json'));
  assert.ok(findCodes(result.findings, 'GOV009').length >= 1);
});

test('GOV010: missing current status', function() {
  var result = audit.auditSnapshot(loadFixture('invalid-missing-status.json'));
  assert.ok(findCodes(result.findings, 'GOV010').length >= 1);
});

test('GOV011: missing timestamp', function() {
  var result = audit.auditSnapshot(loadFixture('invalid-missing-timestamp.json'));
  assert.ok(findCodes(result.findings, 'GOV011').length >= 1);
});

test('GOV012: duplicate timestamps', function() {
  var result = audit.auditSnapshot(loadFixture('invalid-duplicate-timestamp.json'));
  assert.ok(findCodes(result.findings, 'GOV012').length >= 1);
});

test('GOV013: malformed timestamp', function() {
  var result = audit.auditSnapshot(loadFixture('invalid-malformed-timestamp.json'));
  assert.ok(findCodes(result.findings, 'GOV013').length >= 1);
});

test('GOV013: impossible calendar date (31 Feb)', function() {
  var result = audit.auditSnapshot(loadFixture('invalid-impossible-date.json'));
  assert.ok(findCodes(result.findings, 'GOV013').length >= 1);
});

test('GOV014: missing why section', function() {
  var result = audit.auditSnapshot(loadFixture('invalid-missing-why.json'));
  assert.ok(findCodes(result.findings, 'GOV014').length >= 1);
});

test('GOV015: missing required dimension (comprehensive child)', function() {
  var snap = { snapshot_version: '2.0.0', repository: { governance_mode: 'toolkit_governed', canonical_parent_tracker: 1, policy_version: '2.0.0' }, issues: [
    { id: 1, state: 'open', category: 'canonical_parent_tracker', body: '# T\n\nLast reconciled: **25 July 2026, 12:00 SGT**\n\n- [ ] #2 Task\n', children: [2] },
    { id: 2, state: 'open', category: 'active_multi_step_child', body: '# Current status\n\nX\n\nLast reconciled: **25 July 2026, 12:00 SGT**\n\nParent tracker: #1\nImplementation branch: null\nImplementation PR: Not opened\n\n# Why this issue exists\n\nY\n\n# Goal and scope\n\nZ\n\n# Completed work\n\n- n\n\n# Current blockers and findings\n\n- n\n\n# Remaining steps\n\n- [ ] s\n\n# Acceptance criteria\n\n- [ ] a\n\n# Linked PRs and follow-ups\n\n- n\n\n# Safety and authority\n\nC', parent: 1 }
  ]};
  var result = audit.auditSnapshot(snap);
  assert.ok(findCodes(result.findings, 'GOV015').length >= 1);
});

test('GOV016: missing acceptance criteria', function() {
  var result = audit.auditSnapshot(loadFixture('invalid-missing-acceptance.json'));
  assert.ok(findCodes(result.findings, 'GOV016').length >= 1);
});

test('GOV017: superseded issue without reason or successor', function() {
  var result = audit.auditSnapshot(loadFixture('invalid-superseded-no-reason.json'));
  assert.equal(findCodes(result.findings, 'GOV017').length, 1);
});

test('GOV018: PR merge as completion (genuine claim)', function() {
  var result = audit.auditSnapshot(loadFixture('invalid-pr-merge-completion.json'));
  assert.ok(findCodes(result.findings, 'GOV018').length >= 1);
});

test('GOV018 NOT triggered by negated text', function() {
  var result = audit.auditSnapshot(loadFixture('adversarial-negation.json'));
  assert.equal(findCodes(result.findings, 'GOV018').length, 0);
});

test('GOV019: implementer self-acceptance (genuine claim)', function() {
  var result = audit.auditSnapshot(loadFixture('invalid-implementer-acceptance.json'));
  assert.ok(findCodes(result.findings, 'GOV019').length >= 1);
});

test('GOV020: policy version drift', function() {
  var result = audit.auditSnapshot(loadFixture('invalid-drift-policy-version.json'));
  assert.ok(findCodes(result.findings, 'GOV020').length >= 1);
});

test('GOV022: multiple active implementation PRs', function() {
  var result = audit.auditSnapshot(loadFixture('invalid-multiple-impl-prs.json'));
  assert.ok(findCodes(result.findings, 'GOV022').length >= 1);
});

test('GOV024: replacement PR without reason', function() {
  var result = audit.auditSnapshot(loadFixture('invalid-replacement-no-reason.json'));
  assert.ok(findCodes(result.findings, 'GOV024').length >= 1);
});

test('GOV024: replacement PR without supersedes_pr', function() {
  var snap = { snapshot_version: '2.0.0', repository: { governance_mode: 'toolkit_governed', canonical_parent_tracker: 1, policy_version: '2.0.0' }, issues: [
    { id: 1, state: 'open', category: 'canonical_parent_tracker', body: '# T\n\nLast reconciled: **25 July 2026, 12:00 SGT**\n\n- [ ] #2 Task\n', children: [2] },
    { id: 2, state: 'open', category: 'active_multi_step_child', body: '# Current status\n\nX\n\nLast reconciled: **25 July 2026, 12:00 SGT**\n\nParent tracker: #1\nImplementation branch: null\nImplementation PR: Not opened\n\n# Why this issue exists\n\nY\n\n# Goal and scope\n\nZ\n\n# Completed work\n\n- n\n\n# Current blockers and findings\n\n- n\n\n# Remaining steps\n\n- [ ] s\n\n# Acceptance criteria\n\n- [ ] a\n\n# Linked PRs and follow-ups\n\n- n\n\n# Decisions and durable evidence\n\n- n\n\n# Safety and authority\n\nC', parent: 1, implementation_prs: [{ number: 10, state: 'open', is_replacement: true, replacement_reason: 'reason' }] }
  ]};
  var result = audit.auditSnapshot(snap);
  assert.ok(findCodes(result.findings, 'GOV024').length >= 1);
});

test('GOV023: branch disagrees with body', function() {
  var snap = { snapshot_version: '2.0.0', repository: { governance_mode: 'toolkit_governed', canonical_parent_tracker: 1, policy_version: '2.0.0' }, issues: [
    { id: 1, state: 'open', category: 'canonical_parent_tracker', body: '# T\n\nLast reconciled: **25 July 2026, 12:00 SGT**\n\n- [ ] #2 Task\n', children: [2] },
    { id: 2, state: 'open', category: 'active_multi_step_child', body: '# Current status\n\nX\n\nLast reconciled: **25 July 2026, 12:00 SGT**\n\nParent tracker: #1\nImplementation branch: main\nImplementation PR: Not opened\n\n# Why this issue exists\n\nY\n\n# Goal and scope\n\nZ\n\n# Completed work\n\n- n\n\n# Current blockers and findings\n\n- n\n\n# Remaining steps\n\n- [ ] s\n\n# Acceptance criteria\n\n- [ ] a\n\n# Linked PRs and follow-ups\n\n- n\n\n# Decisions and durable evidence\n\n- n\n\n# Safety and authority\n\nC', parent: 1, implementation_branch: 'feature-x' }
  ]};
  var result = audit.auditSnapshot(snap);
  assert.ok(findCodes(result.findings, 'GOV023').length >= 1);
});

test('GOV025: duplicate numeric/string identity aliases', function() {
  var result = audit.auditSnapshot(loadFixture('invalid-duplicate-id.json'));
  assert.ok(findCodes(result.findings, 'GOV025').length >= 1);
});

test('GOV026: canonical_parent_tracker points to non-parent category', function() {
  var result = audit.auditSnapshot(loadFixture('invalid-parent-not-category.json'));
  assert.ok(findCodes(result.findings, 'GOV026').length >= 1);
});

test('GOV027: checklist checked-state mismatch (isolated)', function() {
  var result = audit.auditSnapshot(loadFixture('adversarial-fabricated-checklist.json'));
  var gov027 = findCodes(result.findings, 'GOV027');
  assert.ok(gov027.length >= 1);
});

test('GOV027: acceptance_criteria_met contradiction (isolated)', function() {
  var result = audit.auditSnapshot(loadFixture('adversarial-fabricated-acceptance.json'));
  var gov027 = findCodes(result.findings, 'GOV027');
  assert.ok(gov027.length >= 1);
});

test('GOV003: parent checklist entry with no child', function() {
  var snap = { snapshot_version: '2.0.0', repository: { governance_mode: 'toolkit_governed', canonical_parent_tracker: 1, policy_version: '2.0.0' }, issues: [{ id: 1, state: 'open', category: 'canonical_parent_tracker', body: '# T\n\nLast reconciled: **25 July 2026, 12:00 SGT**\n\n- [ ] orphan\n', children: [] }] };
  var result = audit.auditSnapshot(snap);
  assert.ok(findCodes(result.findings, 'GOV003').length >= 1);
});

test('production module exports only auditSnapshot, formatHuman, formatJson', function() {
  assert.equal(typeof audit.auditSnapshot, 'function');
  assert.equal(typeof audit.formatHuman, 'function');
  assert.equal(typeof audit.formatJson, 'function');
  assert.equal(audit.buildRegistry, undefined);
  assert.equal(audit.emitFinding, undefined);
  assert.equal(audit.HANDLER_REGISTRY, undefined);
});

test('production registry vs test engine identity parity', function() {
  var { DETECTOR_REGISTRY } = require(path.join(repoRoot, 'repo', 'scripts', 'lib', 'detectors', 'index'));
  var { detectorUnits } = require('./lib/test-engine');
  var policy = JSON.parse(fs.readFileSync(path.join(repoRoot, '_projects', 'development', 'issue-governance', '_main', 'policy', 'issue-governance-policy.json'), 'utf8'));
  var codes = Object.keys(policy.finding_codes).sort();

  for (var i = 0; i < codes.length; i++) {
    var code = codes[i];
    assert.ok(DETECTOR_REGISTRY[code], 'Production registry missing ' + code);
    assert.ok(detectorUnits[code], 'Test engine missing ' + code);
    assert.equal(typeof DETECTOR_REGISTRY[code], 'function', code + ' in production registry is not a function');
    assert.equal(typeof detectorUnits[code], 'function', code + ' in test engine is not a function');
    assert.strictEqual(DETECTOR_REGISTRY[code], detectorUnits[code], code + ': production and test functions are different');
  }

  assert.ok(Object.isFrozen(DETECTOR_REGISTRY), 'Production registry is not frozen');
  assert.equal(Object.keys(DETECTOR_REGISTRY).length, codes.length, 'Registry has extra entries');
});

test('test engine mutation does not alter production registry', function() {
  var { DETECTOR_REGISTRY } = require(path.join(repoRoot, 'repo', 'scripts', 'lib', 'detectors', 'index'));
  var original = Object.assign({}, DETECTOR_REGISTRY);
  var testReg = buildTestRegistry({ GOV014: function() {} });
  assert.deepStrictEqual(Object.assign({}, DETECTOR_REGISTRY), original);
});

test('exact oracle passes for valid-full', function() {
  var result = audit.auditSnapshot(loadFixture('valid-full.json'));
  assertExactTuples(result.findings, []);
});

test('exact oracle passes for isolated GOV014 fixture', function() {
  var result = audit.auditSnapshot(loadFixture('invalid-missing-why.json'));
  var expected = [{ code: 'GOV014', severity: 'error', group: 'required_sections', subject: 'S2', message_key: 'missing_why_section' }];
  assertExactTuples(result.findings, expected);
});

test('mutation of GOV014 detector causes expected oracle failure', function() {
  var snapshot = loadFixture('invalid-missing-why.json');
  var expected = [{ code: 'GOV014', severity: 'error', group: 'required_sections', subject: 'S2', message_key: 'missing_why_section' }];

  var normalResult = auditWithRegistry(buildTestRegistry(), snapshot);
  assertExactTuples(normalResult.findings, expected);

  var mutatedReg = buildTestRegistry({ GOV014: function(repo, issues, findings, subjects) {} });
  var mutResult = auditWithRegistry(mutatedReg, snapshot);

  assert.throws(function() {
    assertExactTuples(mutResult.findings, expected);
  });
});

test('mutation of one detector does not affect another code', function() {
  var snapshot = loadFixture('invalid-missing-status.json');
  var normalResult = auditWithRegistry(buildTestRegistry(), snapshot);
  assert.ok(normalResult.findings.some(function(f) { return f.code === 'GOV010'; }));

  var mutatedReg = buildTestRegistry({ GOV014: function(repo, issues, findings, subjects) {} });
  var mutResult = auditWithRegistry(mutatedReg, snapshot);
  assert.ok(mutResult.findings.some(function(f) { return f.code === 'GOV010'; }));
});

test('emitFinding throws on undeclared context key', function() {
  var { emitFinding } = require(path.join(repoRoot, 'repo', 'scripts', 'lib', 'emit-finding'));
  assert.throws(function() {
    emitFinding([], 'GOV002', null, 'multiple_canonical_parents', { count: 3, bogus: 1 });
  }, /Undeclared context key/);
});

test('emitFinding throws on missing context key', function() {
  var { emitFinding } = require(path.join(repoRoot, 'repo', 'scripts', 'lib', 'emit-finding'));
  assert.throws(function() {
    emitFinding([], 'GOV002', null, 'multiple_canonical_parents', {});
  }, /Missing context key/);
});

test('emitFinding throws on wrong context type', function() {
  var { emitFinding } = require(path.join(repoRoot, 'repo', 'scripts', 'lib', 'emit-finding'));
  assert.throws(function() {
    emitFinding([], 'GOV002', null, 'multiple_canonical_parents', { count: 'abc' });
  }, /must be integer/);
});

test('emitFinding throws on oversized count', function() {
  var { emitFinding } = require(path.join(repoRoot, 'repo', 'scripts', 'lib', 'emit-finding'));
  assert.throws(function() {
    emitFinding([], 'GOV002', null, 'multiple_canonical_parents', { count: 999999 });
  }, /out of bounds/);
});

test('stable finding ordering', function() {
  var snap = loadFixture('invalid-missing-status.json');
  assert.deepEqual(audit.auditSnapshot(snap).findings, audit.auditSnapshot(snap).findings);
});

test('stable JSON output', function() {
  var snap = loadFixture('invalid-missing-status.json');
  var j1 = audit.formatJson(audit.auditSnapshot(snap), snap.repository);
  var j2 = audit.formatJson(audit.auditSnapshot(snap), snap.repository);
  assert.equal(j1, j2);
});

test('no input mutation', function() {
  var snap = loadFixture('valid-full.json');
  var original = JSON.stringify(snap);
  audit.auditSnapshot(snap);
  assert.equal(JSON.stringify(snap), original);
});

test('CLI exit 0 for no violations', function() {
  assert.equal(runAudit(fixture('valid-full.json')).status, 0);
});

test('CLI exit 1 for violations', function() {
  assert.equal(runAudit(fixture('invalid-no-parent.json')).status, 1);
});

test('CLI exit 2 for malformed JSON', function() {
  assert.equal(runAudit(fixture('malformed-json.txt')).status, 2);
});

test('CLI exit 2 for missing input', function() {
  assert.equal(spawnSync(process.execPath, [auditScript], { encoding: 'utf8' }).status, 2);
});

test('CLI exit 2 for unsupported version', function() {
  assert.equal(runAudit(fixture('unsupported-version.json')).status, 2);
});

test('diagnostics do not expose body text', function() {
  var r = runAudit(fixture('invalid-missing-status.json'), 'human');
  assert.ok(!r.stdout.includes('No status section here'));
});

test('diagnostics sanitize secrets', function() {
  var r = runAudit(fixture('adversarial-secrets.json'), 'human');
  assert.ok(!r.stdout.includes('TOKEN_ABCDEF0123456789'));
});

test('repeat execution is identical', function() {
  var r1 = runAudit(fixture('valid-full.json'), 'json');
  var r2 = runAudit(fixture('valid-full.json'), 'json');
  assert.equal(r1.stdout, r2.stdout);
});

test('JSON output is valid JSON', function() {
  var r = runAudit(fixture('invalid-no-parent.json'), 'json');
  var parsed = JSON.parse(r.stdout);
  assert.ok(parsed.findings);
  assert.ok(typeof parsed.finding_count === 'number');
});

test('interceptor self-test: blocks http.request', function() {
  var r = spawnSync(process.execPath, ['--require', interceptorPath, '-e', 'try { require("node:http").request(); process.exit(1); } catch(e) { process.exit(0); }'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(r.status, 0);
});

test('interceptor self-test: blocks fs.writeFileSync', function() {
  var r = spawnSync(process.execPath, ['--require', interceptorPath, '-e', 'try { require("node:fs").writeFileSync("/tmp/test","x"); process.exit(1); } catch(e) { process.exit(0); }'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(r.status, 0);
});

test('interceptor self-test: blocks child_process.exec', function() {
  var r = spawnSync(process.execPath, ['--require', interceptorPath, '-e', 'try { require("node:child_process").exec("echo hi"); process.exit(1); } catch(e) { process.exit(0); }'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(r.status, 0);
});

test('interceptor self-test: blocks dns.lookup', function() {
  var r = spawnSync(process.execPath, ['--require', interceptorPath, '-e', 'try { require("node:dns").lookup("example.com", ()=>{}); process.exit(1); } catch(e) { process.exit(0); }'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(r.status, 0);
});

test('real CLI succeeds under interceptor (read-only audit)', function() {
  var r = runAuditWithInterceptor(fixture('valid-full.json'), 'json');
  assert.equal(r.status, 0);
});

test('real CLI finds violations under interceptor', function() {
  var r = runAuditWithInterceptor(fixture('invalid-no-parent.json'), 'json');
  assert.equal(r.status, 1);
});

test('semantic parity check passes', function() {
  var r = spawnSync(process.execPath, [path.join(repoRoot, 'repo', 'scripts', 'check-issue-governance-parity.cjs')], { encoding: 'utf8', timeout: 15000 });
  assert.equal(r.status, 0, 'Parity check failed: ' + r.stderr);
});

test('closed multi-step child receives required-section checks', function() {
  var snap = { snapshot_version: '2.0.0', repository: { governance_mode: 'toolkit_governed', canonical_parent_tracker: 1, policy_version: '2.0.0' }, issues: [
    { id: 1, state: 'open', category: 'canonical_parent_tracker', body: '# T\n\nLast reconciled: **25 July 2026, 12:00 SGT**\n\n- [x] #2 Task\n', children: [2], checklist_items: [{ checked: true, text: '- [x] #2 Task', linked_issue: 2 }] },
    { id: 2, state: 'closed', category: 'active_multi_step_child', body: '# Current status\n\nDONE\n\nLast reconciled: **25 July 2026, 12:00 SGT**\n\nParent tracker: #1\nImplementation branch: null\nImplementation PR: Not opened\n\n# Why this issue exists\n\nY\n\n# Goal and scope\n\nZ\n\n# Completed work\n\n- done\n\n# Current blockers and findings\n\n- none\n\n# Remaining steps\n\n- none\n\n# Acceptance criteria\n\n- [x] Done\n\n# Linked PRs and follow-ups\n\n- none\n\n# Safety and authority\n\nController-owned.', parent: 1, acceptance_criteria_met: true }
  ]};
  var result = audit.auditSnapshot(snap);
  var gov015 = findCodes(result.findings, 'GOV015');
  assert.ok(gov015.length >= 1);
});

test('subject map: reversed numeric/string produce identical subjects', function() {
  var { buildSubjectMap } = require(path.join(repoRoot, 'repo', 'scripts', 'lib', 'subject-map'));
  var issues1 = [{ id: 1 }, { id: '1' }, { id: 2 }];
  var issues2 = [{ id: '1' }, { id: 1 }, { id: 2 }];
  var s1 = buildSubjectMap(issues1);
  var s2 = buildSubjectMap(issues2);
  assert.equal(s1.map.get('n:1'), s2.map.get('n:1'));
  assert.equal(s1.duplicates.length, 1);
  assert.equal(s2.duplicates.length, 1);
});

test('subject map: repeated audits produce identical subjects', function() {
  var { buildSubjectMap } = require(path.join(repoRoot, 'repo', 'scripts', 'lib', 'subject-map'));
  var issues = [{ id: 10 }, { id: 20 }, { id: 'abc' }];
  var s1 = buildSubjectMap(issues);
  var s2 = buildSubjectMap(issues);
  assert.deepStrictEqual(Object.fromEntries(s1.map), Object.fromEntries(s2.map));
});

test('subject map: numeric keys sort numerically, strings lexicographically', function() {
  var { buildSubjectMap } = require(path.join(repoRoot, 'repo', 'scripts', 'lib', 'subject-map'));
  var issues = [{ id: 100 }, { id: 20 }, { id: 'abc' }];
  var s = buildSubjectMap(issues);
  assert.equal(s.map.get('n:20'), 'S1');
  assert.equal(s.map.get('n:100'), 'S2');
  assert.equal(s.map.get('s:abc'), 'S3');
});

test('GOV025 uses subject null and no raw IDs in message', function() {
  var result = audit.auditSnapshot(loadFixture('invalid-duplicate-id.json'));
  var gov025 = findCodes(result.findings, 'GOV025');
  assert.equal(gov025.length, 1);
  assert.equal(gov025[0].subject, null);
});

test('workflow inventory check passes', function() {
  var r = spawnSync(process.execPath, [path.join(repoRoot, 'repo', 'scripts', 'check-workflow-inventory.cjs')], { encoding: 'utf8', timeout: 15000 });
  assert.equal(r.status, 0, 'Workflow inventory check failed: ' + r.stderr);
});
