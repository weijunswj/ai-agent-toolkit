'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const auditScript = path.join(repoRoot, 'repo', 'scripts', 'audit-fallback-risk.cjs');
const { auditFallbackRisk } = require(auditScript);

function tempFixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-fallback-risk-'));
}

function writeFixture(root, relPath, text) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text, 'utf8');
}

test('fallback-risk audit allows approved restrictive fallback policy wording', () => {
  const cwd = tempFixture();
  writeFixture(
    cwd,
    'policy.md',
    [
      '# Policy',
      '',
      'Do not add broad fallbacks, silent compatibility paths, synthetic/sample data fallbacks, fake success states, or catch-and-continue behaviour by default.',
      'A fallback is allowed only when necessary for correctness, data safety, migration safety, or an explicitly approved compatibility requirement.',
      'Fallbacks must never hide data loss, auth failure, permission failure, payment failure, persistence failure, audit failure, security failure, missing configuration, broken integrations, or failed validation.',
      ''
    ].join('\n')
  );

  const result = auditFallbackRisk(cwd, { targets: ['policy.md'] });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

test('fallback-risk audit warns for ambiguous compatibility fallback wording', () => {
  const cwd = tempFixture();
  writeFixture(cwd, 'policy.md', '# Policy\n\nUse a fallback for legacy config during migrations.\n');

  const result = auditFallbackRisk(cwd, { targets: ['policy.md'] });
  assert.deepEqual(result.errors, []);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0].severity, 'warning');
  assert.match(result.warnings[0].reason, /Compatibility fallback wording/);
});

test('fallback-risk audit fails for broad or silent fallback wording', () => {
  const cwd = tempFixture();
  writeFixture(cwd, 'policy.md', '# Policy\n\nAdd a silent fallback to empty results when auth fails.\n');

  const result = auditFallbackRisk(cwd, { targets: ['policy.md'] });
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].severity, 'error');
  assert.match(result.errors[0].reason, /Silent fallback/);
});

test('fallback-risk audit CLI exits nonzero only for error findings', () => {
  const cwd = tempFixture();
  writeFixture(cwd, 'warning.md', 'Use a fallback for legacy config during migrations.\n');
  writeFixture(cwd, 'error.md', 'Add broad fallbacks for missing configuration.\n');

  const warningResult = spawnSync(process.execPath, [auditScript, '--workspace', cwd, '--target', 'warning.md'], { encoding: 'utf8' });
  assert.equal(warningResult.status, 0, warningResult.stderr);
  assert.match(warningResult.stdout, /Warnings:/);
  assert.match(warningResult.stdout, /0 error\(s\), 1 warning\(s\)/);

  const errorResult = spawnSync(process.execPath, [auditScript, '--workspace', cwd, '--target', 'error.md'], { encoding: 'utf8' });
  assert.notEqual(errorResult.status, 0);
  assert.match(errorResult.stderr, /Errors:/);
  assert.match(errorResult.stderr, /1 error\(s\), 0 warning\(s\)/);
});
