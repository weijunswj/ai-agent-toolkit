'use strict';
const test = require('node:test');
const {
  assert, fs, path, spawnSync, repoRoot, script, tmpRoot, isolatedHomeEnv, writeFile, run, runTestGit, escapeRegExp,
  createGitBackedSetupRepo, createGitBackedRealSetupRepo, createFakeManagedSetupScript,
  runWithUnclosedStdin, codexConfig, backupFiles
} = require('./toolkit-setup-test-support.cjs');
const delegation = require('../scripts/codex-delegation-config.cjs');

// Split by complete test declarations to keep the per-file time budget.
test('managed question-bank pause and safety blocker are never bypassed by active fallback', () => {
  for (const scenario of [
    { expected: 23, emitQuestionBank: true, extraLines: [] },
    { expected: 1, emitQuestionBank: false, extraLines: ["console.error('managed safety blocker');"] }
  ]) {
    const root = tmpRoot();
    createFakeManagedSetupScript(root, { exitCode: scenario.expected, emitQuestionBank: scenario.emitQuestionBank, extraLines: scenario.extraLines });
    const result = run(['--execute', '--profile', 'auto-main'], { env: isolatedHomeEnv(root) });
    assert.equal(result.status, scenario.expected, result.stderr || result.stdout);
    assert.match(result.stdout, /# setup toolkit managed route/);
    if (scenario.expected === 23) assert.match(result.stdout, /setup-toolkit-question-bank:complete/);
    else assert.match(result.stderr, /Managed setup failed before completing the question-bank protocol/);
    assert.doesNotMatch(result.stdout, /# setup toolkit checklist/);
  }
});

test('suppressed managed bank fails once with a precise no-output diagnosis and no writes', () => {
  const root = tmpRoot();
  createFakeManagedSetupScript(root, { exitCode: 23, emitQuestionBank: false });
  const result = run(['--execute', '--profile', 'auto-main'], { env: isolatedHomeEnv(root) });
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.doesNotMatch(result.stdout, /managed setup script version/);
  assert.doesNotMatch(result.stdout, /Accept all displayed recommended settings/);
  assert.match(result.stderr, /Managed setup returned no question-bank output/);
  assert.doesNotMatch(result.stderr, /retry/i);
  assert.equal(fs.existsSync(codexConfig(root)), false);
});
