'use strict';
const test = require('node:test');
const {
  assert, fs, path, spawnSync, repoRoot, script, tmpRoot, isolatedHomeEnv, writeFile, createFakeCodexAppServer, run, runTestGit, escapeRegExp,
  createGitBackedSetupRepo, createGitBackedRealSetupRepo, createFakeManagedSetupScript,
  runWithUnclosedStdin, codexConfig, backupFiles, displayedBankReference, auditFixture, specsForAudit, parseConciseInFreshProcess
} = require('./toolkit-setup-test-support.cjs');
const core = require('../scripts/setup-toolkit-core.cjs');
function snapshotTree(root) {
  const entries = [];
  const visit = dir => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, item.name);
      entries.push([path.relative(root, file), item.isDirectory() ? null : fs.readFileSync(file).toString('base64')]);
      if (item.isDirectory()) visit(file);
    }
  };
  visit(root);
  return entries;
}

// Split by complete test declarations to keep the per-file time budget.
test('choice-activated custom retention detail follows the displayed canonical order', () => {
  const root = tmpRoot();
  const { origin } = createGitBackedSetupRepo(root);
  const result = run(['--execute', '--repo-remote', origin, '--enable-repo-auto-update'], {
    env: isolatedHomeEnv(root),
    input: ['A', 'A', 'B', 'keep', 'A', '14'].join('\n'),
    timeout: 300000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /2\. 1\.4 Report retention: positive report-retention duration in days \(when 1\.4 is B\/custom/);
  assert.match(result.stdout, /Detail 2 1\.4 Report retention: positive report-retention duration in days - 14 days/);
});

test('simultaneous custom checkout and retention consume details in displayed order', () => {
  const root = tmpRoot();
  const { origin } = createGitBackedSetupRepo(root);
  const customPath = path.join(root, 'Two Detail Managed Source');
  const result = run(['--execute', '--repo-remote', origin, '--enable-repo-auto-update'], {
    env: isolatedHomeEnv(root),
    input: ['custom', 'A', 'B', 'keep', 'A', customPath, '21'].join('\n'),
    timeout: 300000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const bank = result.stdout.split('<!-- setup-toolkit-question-bank:complete -->')[0];
  assert.ok(bank.indexOf('1. 1.1 Update source: custom managed-checkout path') < bank.indexOf('2. 1.4 Report retention: positive report-retention duration'));
  assert.ok(result.stdout.indexOf('Detail 1 1.1 Update source') < result.stdout.indexOf('Detail 2 1.4 Report retention'));
  assert.match(result.stdout, /Detail 2 1\.4 Report retention:[^\n]*21 days/);
  assert.equal(fs.existsSync(path.join(customPath, 'BRIDGE_ARGS.log')), true);
});

test('preselected path and helper details share rendering consumption and summary order with custom retention', () => {
  const root = tmpRoot();
  const { origin } = createGitBackedSetupRepo(root);
  const customPath = path.join(root, 'Preselected Detail Source');
  const result = run([
    '--execute', '--repo-remote', origin, '--managed-checkout', 'custom', '--enable-repo-auto-update',
    '--codex-helper-capacity', 'custom', '--codex-cli', createFakeCodexAppServer(root),
    '--approve-codex-config-proposal',
  ], {
    env: isolatedHomeEnv(root),
    input: ['A', 'B', 'A', customPath, '30', '1'].join('\n'),
    timeout: 300000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const bank = result.stdout.split('<!-- setup-toolkit-question-bank:complete -->')[0];
  const rendered = [
    bank.indexOf('1. 1.1 Update source: custom managed-checkout path'),
    bank.indexOf('2. 1.4 Report retention: positive report-retention duration'),
    bank.indexOf('3. 2.1 Codex helper capacity: bounded Codex helper count'),
  ];
  assert.ok(rendered.every((index) => index >= 0) && rendered[0] < rendered[1] && rendered[1] < rendered[2]);
  const summary = [
    result.stdout.indexOf('Detail 1 1.1 Update source'),
    result.stdout.indexOf('Detail 2 1.4 Report retention'),
    result.stdout.indexOf('Detail 3 2.1 Codex helper capacity'),
  ];
  assert.ok(summary.every((index) => index >= 0) && summary[0] < summary[1] && summary[1] < summary[2]);
});
