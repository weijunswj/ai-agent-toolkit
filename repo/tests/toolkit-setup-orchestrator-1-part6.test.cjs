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
test('partial explicit flags reject concise input before writes and accept only the displayed ordered contract', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const args = ['--execute', '--repo-root', setupRepo, '--repo-remote', origin];
  const env = isolatedHomeEnv(root);
  const preview = run(args, { env, input: '' });
  const reference = displayedBankReference(preview.stdout);
  assert.match(preview.stdout, /Some visible questions are already resolved by explicit setup flags/);
  assert.doesNotMatch(preview.stdout, /Reply with either:/);

  const rejected = run(args, { env, input: `${reference}: all recommended\n` });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /Concise bank-reference answers are not accepted when explicit setup flags already resolved part of the bank/);
  assert.equal(fs.existsSync(path.join(setupRepo, 'BRIDGE_ARGS.log')), false);
  assert.equal(fs.existsSync(path.join(setupRepo, 'PLUGIN_SETUP.log')), false);

  const accepted = run(args, {
    env,
    input: ['disable', 'enable', 'default', 'one-helper', 'keep'].join('\n'),
    timeout: 300000,
  });
  assert.equal(accepted.status, 0, accepted.stderr || accepted.stdout);
  assert.match(accepted.stdout, /1\.2 Automatic updates: C - Turn off/);
});

test('multiple explicit flags render and accept one remaining ordered non-TTY answer', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const result = run([
    '--execute', '--repo-root', setupRepo, '--repo-remote', origin,
    '--enable-repo-auto-update', '--enable-update-reports', '--default-update-report-retention-days',
  ], { env: isolatedHomeEnv(root), input: 'keep\nA\n', timeout: 300000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const bank = result.stdout.split('<!-- setup-toolkit-question-bank:complete -->')[0];
  const guide = bank.slice(bank.indexOf('Some visible questions'));
  // Maintenance is off already, so Turn off folds into Keep current and A is Keep current.
  assert.match(guide, /\*\*2\.2\*\* Codex Toolkit maintenance \[A-B\]/);
  assert.doesNotMatch(guide, /\*\*1\.2\*\* Automatic updates \[A-C\]|: all recommended/);
  assert.match(result.stdout, /2\.2 Codex Toolkit maintenance: A - Keep current \(canonical: keep; effective: disable\)/);
});

test('choice-activated custom checkout detail is rendered and consumed in the canonical post-answer block', () => {
  const root = tmpRoot();
  const { origin } = createGitBackedSetupRepo(root);
  const customPath = path.join(root, 'Chosen Managed Source');
  const result = run(['--execute', '--repo-remote', origin, '--enable-repo-auto-update'], {
    env: isolatedHomeEnv(root),
    input: ['custom', 'A', 'A', 'keep', 'A', customPath].join('\n'),
    timeout: 300000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const bank = result.stdout.split('<!-- setup-toolkit-question-bank:complete -->')[0];
  assert.match(bank, /After those question-answer lines, append detail lines in this exact canonical order[\s\S]*1\. 1\.1 Update source: custom managed-checkout path \(when 1\.1 is [A-Z]+\/custom/);
  assert.match(result.stdout, /Detail 1 1\.1 Update source: custom managed-checkout path - custom path supplied \(value remains private\)/);
  assert.equal(fs.existsSync(path.join(customPath, 'BRIDGE_ARGS.log')), true);
});
