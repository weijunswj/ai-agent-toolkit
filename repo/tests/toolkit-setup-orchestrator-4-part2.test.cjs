'use strict';
const test = require('node:test');
const {
  assert, fs, path, script, tmpRoot, isolatedHomeEnv, writeFile, createFakeCodexAppServer, run, escapeRegExp, createGitBackedSetupRepo, runWithUnclosedStdin, codexConfig, backupFiles, displayedBankReference, auditFixture, specsForAudit, parseConciseInFreshProcess
} = require('./toolkit-setup-test-support.cjs');

// Split by complete test declarations to keep the per-file time budget.
test('explicit textual all recommended approves the exact visible bank', () => {
  const root = tmpRoot();
  const { origin } = createGitBackedSetupRepo(root);
  const env = isolatedHomeEnv(root);
  const preview = run(['--execute', '--repo-remote', origin], { codexDocLimitQuestion: true, env, input: '' });
  const reference = displayedBankReference(preview.stdout);
  const result = run(['--execute', '--repo-remote', origin], { codexDocLimitQuestion: true,
    env,
    input: `${reference}: all recommended\n`,
    timeout: 300000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Question answer source: user-approved all recommended/);
  assert.equal((result.stdout.match(/setup-toolkit-question-bank:begin/g) || []).length, 1);
  assert.equal((result.stdout.match(/setup-toolkit-question-bank:complete/g) || []).length, 1);
  assert.ok(result.stdout.indexOf('setup-toolkit-question-bank:complete') < result.stdout.indexOf('Setup choices confirmed before writes:'));
});

test('changed-only piped answer applies recommendations except exact indexed changes', () => {
  const root = tmpRoot();
  const { origin } = createGitBackedSetupRepo(root);
  const env = isolatedHomeEnv(root);
  const preview = run(['--execute', '--repo-remote', origin], { codexDocLimitQuestion: true, env, input: '' });
  const reference = displayedBankReference(preview.stdout);
  const result = run(['--execute', '--repo-remote', origin], { codexDocLimitQuestion: true,
    env,
    input: `${reference}: 1.2=c, 2.2=A\n`,
    timeout: 300000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Question answer source: user-approved recommended except listed changes/);
  assert.match(result.stdout, /1\.2 Automatic updates: C - Turn off \(canonical: disable; effective: disable\)/);
  // Maintenance is off already, so Turn off folds into Keep current and A is Keep current.
  assert.match(result.stdout, /2\.2 Codex Toolkit maintenance: A - Keep current \(canonical: keep; effective: disable\)/);
  // Reports are already kept, so the recommendation is the single Keep current.
  assert.match(result.stdout, /1\.3 Update reports: A - Keep current \(canonical: keep; effective: enable\)/);
});

test('cross-process concise replay fails before mapping across a host change', () => {
  const root = tmpRoot();
  const { origin } = createGitBackedSetupRepo(root);
  const baseArgs = ['--execute', '--repo-remote', origin];
  const baseEnv = isolatedHomeEnv(root);

  const codexPreview = run(baseArgs, { codexDocLimitQuestion: true, env: baseEnv, input: '' });
  const codexReference = displayedBankReference(codexPreview.stdout);
  const claudeReplay = run([...baseArgs, '--host', 'claude-code'], { codexDocLimitQuestion: true,
    env: baseEnv,
    input: `${codexReference}: 2.1=B\n`,
  });
  assert.notEqual(claudeReplay.status, 0);
  assert.match(claudeReplay.stderr, /reference is stale or belongs to a different rendered bank/);
  assert.doesNotMatch(claudeReplay.stderr, /unavailable question|unavailable choice/);
});
