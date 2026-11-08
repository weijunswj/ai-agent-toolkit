'use strict';
const test = require('node:test');
const {
  assert, fs, path, script, tmpRoot, isolatedHomeEnv, writeFile, createFakeCodexAppServer, run, escapeRegExp, createGitBackedSetupRepo, runWithUnclosedStdin, codexConfig, backupFiles, displayedBankReference, auditFixture, specsForAudit, parseConciseInFreshProcess
} = require('./toolkit-setup-test-support.cjs');

// Split by complete test declarations to keep the per-file time budget.
test('cross-process concise replay fails when a displayed recommendation changes', () => {
  const initial = specsForAudit(auditFixture({ retentionDays: 7 }));
  const changed = specsForAudit(auditFixture({ retentionDays: 30 }));
  const reference = initial[0].presentation.bank_reference;
  const replay = parseConciseInFreshProcess(changed, `${reference}: all recommended`);
  assert.notEqual(replay.status, 0);
  assert.match(replay.stderr, /reference is stale or belongs/);
});

test('non-interactive concise input rejects missing malformed and secondary-detail values before writes', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const args = ['--execute', '--repo-remote', origin];
  const env = isolatedHomeEnv(root);
  const preview = run(args, { codexDocLimitQuestion: true, env, input: '' });
  const reference = displayedBankReference(preview.stdout);
  for (const [input, expected] of [
    ['all recommended\n', /require the displayed bank reference/],
    ['BAD: all recommended\n', /malformed or truncated/],
    [`${reference.slice(0, -1)}: all recommended\n`, /malformed or truncated/],
  ]) {
    const rejected = run(args, { codexDocLimitQuestion: true, env, input });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, expected);
  }
  const plan = run(['--plan', '--json', '--repo-remote', origin], { codexDocLimitQuestion: true, env });
  const bank = JSON.parse(plan.stdout).question_bank;
  const retention = bank.find((row) => row.id === 'report-retention');
  const custom = retention.choices.find((choice) => choice.value === 'custom');
  const secondary = run(args, { codexDocLimitQuestion: true,
    env,
    input: `${reference}: ${retention.presentation.question_ref}=${custom.presentation_ref}\n`,
  });
  assert.notEqual(secondary.status, 0);
  assert.match(secondary.stderr, /requires additional values.*update-report-retention-days/i);
  const updateSource = bank.find((row) => row.id === 'update-source');
  const customSource = updateSource.choices.find((choice) => choice.value === 'custom');
  const sourceSecondary = run(args, { codexDocLimitQuestion: true,
    env,
    input: `${reference}: ${updateSource.presentation.question_ref}=${customSource.presentation_ref}\n`,
  });
  assert.notEqual(sourceSecondary.status, 0);
  assert.match(sourceSecondary.stderr, /requires additional values.*--repo-root/i);
  assert.equal(fs.existsSync(path.join(setupRepo, 'BRIDGE_ARGS.log')), false);
  assert.equal(fs.existsSync(path.join(setupRepo, 'PLUGIN_SETUP.log')), false);
});

test('extra non-empty piped answers fail before any setup write', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const result = run(['--execute', '--repo-root', setupRepo, '--repo-remote', origin], {
    env: isolatedHomeEnv(root),
    input: ['keep', 'keep', 'keep', 'keep', 'keep', 'unexpected'].join('\n'),
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unexpected extra non-empty input/);
  assert.equal(fs.existsSync(path.join(setupRepo, 'PLUGIN_SETUP.log')), false);
  assert.equal(fs.existsSync(codexConfig(root)), false);
});
