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

// Every temp folder a test makes is removed after the file's tests, also when they fail.
const tempFolders = [];
test.after(() => { for (const dir of tempFolders) fs.rmSync(dir, { recursive: true, force: true }); });
function tempFolder(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempFolders.push(dir);
  return dir;
}

function tempFixture() {
  return tempFolder('toolkit-fallback-risk-');
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

test('L4: past GitHub\'s 10 annotations per step, each severity shows 9 and a 10th naming how many more the log holds', () => {
  const { annotations } = require(auditScript);
  const finding = (severity, index) => ({ severity, path: `docs/${severity}-${index}.md`, line: index + 1, matched: 'm', phrase: 'p', reason: 'r' });
  const few = [...Array.from({ length: 10 }, (_, index) => finding('warning', index)), finding('error', 0)];
  const shown = annotations(few);
  assert.equal(shown.length, 11, 'ten or fewer per severity are all shown');
  assert.match(shown[0], /^::error file=docs\/error-0\.md/, 'errors first');
  const many = [...Array.from({ length: 25 }, (_, index) => finding('warning', index)), ...Array.from({ length: 12 }, (_, index) => finding('error', index))];
  const capped = annotations(many);
  const errors = capped.filter(line => line.startsWith('::error')), warnings = capped.filter(line => line.startsWith('::warning'));
  assert.equal(errors.length, 10);
  assert.equal(warnings.length, 10);
  assert.equal(errors[9], '::error title=Fallback risk::3 more fallback risk errors are not shown here (GitHub shows 10 per step); the audit log in this step lists all 12.');
  assert.equal(warnings[9], '::warning title=Fallback risk::16 more fallback risk warnings are not shown here (GitHub shows 10 per step); the audit log in this step lists all 25.');
  assert.match(warnings[8], /^::warning file=docs\/warning-8\.md,line=9,/);
});

test('fallback-risk audit: under GitHub Actions each finding is a file and line annotation, escaped', () => {
  const { annotation } = require(auditScript);
  assert.equal(annotation({ severity: 'warning', path: 'docs/a,b:c.md', line: 7, matched: 'fallback', phrase: 'use a fallback', reason: 'say what fails\nand why' }),
    '::warning file=docs/a%2Cb%3Ac.md,line=7,title=Fallback risk::matched "fallback" (use a fallback) - say what fails%0Aand why');
  assert.match(annotation({ severity: 'error', path: 'x.md', line: 1, matched: 'm', phrase: 'p', reason: 'r' }), /^::error file=x\.md,line=1,title=Fallback risk::/);
  const plain = spawnSync(process.execPath, [auditScript], { encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: '' } });
  const actions = spawnSync(process.execPath, [auditScript], { encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: 'true' } });
  assert.equal(actions.status, plain.status, 'the exit code does not change');
  const findings = auditFallbackRisk().findings.length;
  assert.equal((actions.stdout.match(/^::(?:warning|error) file=/gm) || []).length, findings);
  assert.doesNotMatch(plain.stdout, /^::/m, 'outside GitHub Actions the report is unchanged');
});
