'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const moduleRoot = path.join(repoRoot, '_projects', 'cicd', 'repository-security-gate');
const mainRoot = path.join(moduleRoot, '_main');
const runnerPath = path.join(mainRoot, 'tools', 'security-gate.cjs');
const lockPath = path.join(mainRoot, 'config', 'tool-lock.json');
const {
  classifyRepository,
  riskClassification,
  stableFinding,
  validateSuppressions,
  validateToolLock
} = require(runnerPath);

function runNode(args, cwd = repoRoot) {
  return spawnSync(process.execPath, args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024
  });
}

function temporaryRepository(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-security-gate-test-'));
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents, 'utf8');
  }
  return root;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

test('self-test covers all profile and malicious classification fixtures', () => {
  const result = runNode([runnerPath, 'self-test']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /8 classification cases, 12 rule cases/);
});

test('content-derived classification cannot self-declare exemption', () => {
  const root = temporaryRepository({
    'security-profile.json': '{"profile":"SECURITY_PROFILE_EXEMPT"}\n',
    '.GitHub/Workflows/check.YML': 'jobs: {}\n',
    'nested/tool.TXT': '#!/usr/bin/env node\n'
  });
  try {
    assert.equal(classifyRepository(root).profile, 'SECURITY_PROFILE_TOOLING_LIBRARY');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('tool lock rejects checksum, licence, publisher shape, stale, blocked-active, and superseded-active drift', () => {
  const original = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  assert.equal(validateToolLock(original, new Date('2026-07-23T00:00:00Z')).valid, true);
  for (const mutate of [
    (lock) => { lock.records.find((item) => item.state === 'active' && item.kind === 'scanner').release_checksum = '0'.repeat(63); },
    (lock) => { lock.records.find((item) => item.state === 'active').license_sha256 = 'bad'; },
    (lock) => { lock.records.find((item) => item.state === 'active').upstream = 'not-an-owner-repo'; },
    (lock) => { lock.records.find((item) => item.state === 'active').publisher = 'different-publisher'; },
    (lock) => { lock.last_verified_date = '2025-01-01'; },
    (lock) => { const item = lock.records.find((entry) => entry.state === 'active'); item.adoption_decision = 'DEFER'; },
    (lock) => { const item = lock.records.find((entry) => entry.state === 'active'); item.state = 'superseded'; item.adoption_decision = 'ADOPT'; lock.records.push({ ...item, name: `${item.name}-replacement`, state: 'active', release_checksum: null }); }
  ]) {
    const copy = structuredClone(original);
    mutate(copy);
    assert.equal(validateToolLock(copy, new Date('2026-07-23T00:00:00Z')).valid, false);
  }
});

test('stable findings are deterministic and repository-relative', () => {
  const first = stableFinding('toolkit-rules', 'TKSG001', 'src\\tool.js', 4, 'unsafe   execution');
  const second = stableFinding('toolkit-rules', 'TKSG001', 'src/tool.js', 4, 'unsafe execution');
  assert.equal(first.identity, second.identity);
  assert.equal(first.path, 'src/tool.js');
  assert.doesNotMatch(JSON.stringify(first), /^[A-Za-z]:\\/);
});

test('suppressions require exact current source and expiry bindings', () => {
  const contents = 'synthetic fixture\n';
  const root = temporaryRepository({ 'fixtures/synthetic/sample.txt': contents });
  const valid = {
    schema_version: 1,
    suppressions: [{
      id: 'synthetic-one',
      tool: 'toolkit-rules',
      rule: 'TKSG006',
      finding_identity: 'a'.repeat(64),
      path: 'fixtures/synthetic/sample.txt',
      scope: 'synthetic_fixture',
      exploitability_rationale: 'Synthetic fixture only.',
      approver_reference: 'issue-284',
      introduction_commit: 'b'.repeat(40),
      expires: '2026-08-23',
      compensating_test: 'repository-security-gate.test.cjs',
      tool_version: '1.0.0',
      rule_version: '1.0.0',
      source_sha256: sha256(contents)
    }]
  };
  try {
    assert.equal(validateSuppressions(valid, root, new Date('2026-07-23T00:00:00Z')).valid, true);
    const wildcard = structuredClone(valid);
    wildcard.suppressions[0].path = '**/*';
    assert.equal(validateSuppressions(wildcard, root, new Date('2026-07-23T00:00:00Z')).valid, false);
    const expired = structuredClone(valid);
    expired.suppressions[0].expires = '2026-07-22';
    assert.equal(validateSuppressions(expired, root, new Date('2026-07-23T00:00:00Z')).valid, false);
    const permanent = structuredClone(valid);
    permanent.suppressions[0].expires = '2027-07-23';
    assert.equal(validateSuppressions(permanent, root, new Date('2026-07-23T00:00:00Z')).valid, false);
    const changed = structuredClone(valid);
    changed.suppressions[0].source_sha256 = 'c'.repeat(64);
    assert.equal(validateSuppressions(changed, root, new Date('2026-07-23T00:00:00Z')).valid, false);
    const versionDrift = structuredClone(valid);
    versionDrift.suppressions[0].rule_version = '2.0.0';
    assert.equal(validateSuppressions(versionDrift, root, new Date('2026-07-23T00:00:00Z')).valid, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('missing scanners and invalid mode inputs fail closed without raw source output', () => {
  const root = temporaryRepository({ 'src/index.js': 'module.exports = 1;\n', 'package.json': '{}\n' });
  try {
    const scan = runNode([runnerPath, 'scan', '--mode', 'full', '--repo', root, '--tools-dir', path.join(root, 'missing')], root);
    assert.equal(scan.status, 2);
    const report = JSON.parse(fs.readFileSync(path.join(root, 'security-reports', 'security-gate.json'), 'utf8'));
    assert.equal(report.state, 'SECURITY_GATE_INFRA_BLOCKED');
    assert.ok(report.infrastructure_failures.length > 0);
    assert.doesNotMatch(JSON.stringify(report), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    assert.doesNotMatch(JSON.stringify(report), /module\.exports = 1/);
    const invalid = runNode([runnerPath, 'scan', '--mode', 'unknown', '--repo', root], root);
    assert.equal(invalid.status, 2);
    assert.match(invalid.stderr, /SECURITY_GATE_UNVERIFIED/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('PR and release modes require exact revisions while full and scheduled route', () => {
  const root = temporaryRepository({ 'README.md': '# documentation\n' });
  try {
    for (const mode of ['full', 'scheduled']) {
      const result = runNode([runnerPath, 'scan', '--mode', mode, '--repo', root], root);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /SECURITY_PROFILE_EXEMPT/);
    }
    assert.equal(runNode([runnerPath, 'scan', '--mode', 'pr', '--repo', root], root).status, 2);
    assert.equal(runNode([runnerPath, 'scan', '--mode', 'release', '--repo', root, '--head', '0'.repeat(40)], root).status, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AI risk classifier skips docs and triggers on security-sensitive executable changes', () => {
  assert.deepEqual(riskClassification(['README.md', 'docs/guide.md']), { required: false, sensitive: [] });
  const result = riskClassification(['src/auth/session.ts', '.github/workflows/release.yml']);
  assert.equal(result.required, true);
  assert.deepEqual(result.sensitive, ['src/auth/session.ts', '.github/workflows/release.yml']);
});

test('workflows separate untrusted PR scans from privileged candidate execution', () => {
  const gate = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'repository-security-gate.yml'), 'utf8');
  const candidate = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'security-candidate-validation.yml'), 'utf8');
  assert.match(gate, /^  pull_request:/m);
  assert.doesNotMatch(gate, /pull_request_target/);
  assert.match(gate, /permissions:\r?\n  contents: read/);
  assert.doesNotMatch(gate, /\bsecrets\./);
  assert.match(candidate, /^  workflow_dispatch:/m);
  assert.doesNotMatch(candidate, /^  pull_request:/m);
  assert.match(candidate, /ref: refs\/heads\/main/);
  for (const workflow of [gate, candidate]) {
    assert.doesNotMatch(workflow, /uses:\s+[^@\s]+@(?:main|master|v?\d+(?:\.\d+)*)\s*$/m);
  }
});

test('authoritative surfaces contain no mandatory Codex Security workflow', () => {
  const targets = [
    path.join(repoRoot, '_projects', 'development', 'project-completion-audit', '_main', 'skill', 'SKILL.md'),
    path.join(repoRoot, '_projects', 'development', 'ai-coding-agent-rules', '_main', 'repo-local', 'docs', 'agent-playbooks', 'project-completion-audit.md')
  ];
  for (const target of targets) {
    const text = fs.readFileSync(target, 'utf8');
    assert.doesNotMatch(text, /invoke Codex Security|open (?:a )?Security workspace|press Start scan|continue a blocked scan/i);
    assert.match(text, /repository-owned security gate/i);
  }
});

test('source-watch remains notification-only and candidate validation is a separate handoff', () => {
  const sourceWatch = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'source-watch-pr.yml'), 'utf8');
  const candidate = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'security-candidate-validation.yml'), 'utf8');
  assert.match(sourceWatch, /cron: ['"]17 \* \* \* \*['"]/);
  assert.doesNotMatch(sourceWatch, /install-pinned-tools|security-candidate-validation/);
  assert.match(candidate, /manual_review_required/);
  assert.match(candidate, /workflow_dispatch/);
});
