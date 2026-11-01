'use strict';

// Setup question bank: conditional details, piped and concise answers, replay and failure ordering.
// Split from toolkit-setup-orchestrator-1.test.cjs so node --test runs the two in parallel.

const test = require('node:test');
const {
  assert, fs, path, script, tmpRoot, isolatedHomeEnv, writeFile, createFakeCodexAppServer, run, escapeRegExp, createGitBackedSetupRepo, runWithUnclosedStdin, codexConfig, backupFiles, displayedBankReference, auditFixture, specsForAudit, parseConciseInFreshProcess
} = require('./toolkit-setup-test-support.cjs');

test('missing and misordered conditional details fail before every setup write', () => {
  for (const mode of ['missing', 'misordered']) {
    const root = tmpRoot();
    const { origin, setupRepo } = createGitBackedSetupRepo(root);
    const customPath = path.join(root, 'Must Not Be Written');
    const input = mode === 'missing'
      ? ['custom', 'A', 'A', 'keep', 'A'].join('\n')
      : ['custom', 'A', 'B', 'keep', 'A', '14', customPath].join('\n');
    const result = run(['--execute', '--repo-remote', origin, '--enable-repo-auto-update'], {
      env: isolatedHomeEnv(root), input, timeout: 300000,
    });
    assert.notEqual(result.status, 0);
    if (mode === 'missing') assert.match(result.stderr, /requires the 1\.1 Update source custom path detail/);
    else assert.match(result.stderr, /Report retention day count (?:must be|requires) a positive integer/);
    assert.equal(fs.existsSync(customPath), false);
    assert.equal(fs.existsSync(path.join(setupRepo, 'BRIDGE_ARGS.log')), false);
    assert.equal(fs.existsSync(path.join(setupRepo, 'PLUGIN_SETUP.log')), false);
  }
});

test('fully explicit setup does not wait for or advertise setup-question stdin', async () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const result = await runWithUnclosedStdin(script, [
    '--execute', '--repo-root', setupRepo, '--repo-remote', origin,
    '--enable-repo-auto-update', '--enable-update-reports', '--default-update-report-retention-days',
    '--skip-codex-plugin-auto-refresh', '--codex-helper-capacity', 'keep',
  ], { env: isolatedHomeEnv(root), deadlineMs: 300000 });
  assert.equal(result.code, 0, result.stderr || result.stdout);
  const bank = result.stdout.split('<!-- setup-toolkit-question-bank:complete -->')[0];
  assert.match(bank, /All visible setup questions are already resolved by explicit inputs/);
  assert.match(bank, /No setup-question stdin is required or read/);
  assert.doesNotMatch(bank, /Reply with either:|Reply with one line for each unresolved question/);
});

test('Windows drive-letter path with spaces remains line-by-line detail input', { skip: process.platform !== 'win32' }, () => {
  const fixtureRoot = path.join(tmpRoot(), 'Managed Source With Spaces');
  const { origin, setupRepo } = createGitBackedSetupRepo(fixtureRoot);
  const result = run([
    '--execute', '--managed-checkout', 'custom', '--repo-remote', origin,
    '--enable-repo-auto-update', '--enable-update-reports', '--default-update-report-retention-days',
    '--skip-codex-plugin-auto-refresh', '--codex-helper-capacity', 'keep',
  ], { env: isolatedHomeEnv(fixtureRoot), input: `${setupRepo}\n`, timeout: 300000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /append detail lines in this exact canonical order[\s\S]*custom managed-checkout path/);
  assert.doesNotMatch(result.stderr, /bank reference|concise/i);
  assert.match(fs.readFileSync(path.join(setupRepo, 'BRIDGE_ARGS.log'), 'utf8'), new RegExp(escapeRegExp(setupRepo)));
});

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

test('downstream setup failure cannot mutate Codex config or create a backup', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root, { validationFailure: true });
  const configPath = codexConfig(root);
  const original = Buffer.from('model = "gpt-5.6"\n');
  writeFile(configPath, original.toString('utf8'));
  const result = run([
    '--execute', '--repo-root', setupRepo, '--repo-remote', origin,
    '--yes-recommended', '--skip-codex-plugin-auto-refresh',
    '--codex-delegation-control', 'limit'
  ], { env: isolatedHomeEnv(root), timeout: 300000 });
  assert.notEqual(result.status, 0);
  assert.deepEqual(fs.readFileSync(configPath), original);
  assert.deepEqual(backupFiles(root), []);
});

test('final bridge audit failure occurs before delegation config commitment', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const configPath = codexConfig(root);
  const original = Buffer.from('model = "gpt-5.6"\n');
  writeFile(configPath, original.toString('utf8'));
  const result = run([
    '--execute', '--repo-root', setupRepo, '--repo-remote', origin,
    '--yes-recommended', '--skip-codex-plugin-auto-refresh',
    '--codex-delegation-control', 'limit', '--codex-cli', createFakeCodexAppServer(root)
  ], {
    env: { ...isolatedHomeEnv(root), SETUP_FAKE_AUDIT_MALFORMED: '1' },
    timeout: 300000,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Final bridge audit did not return valid JSON/);
  assert.deepEqual(fs.readFileSync(configPath), original);
  assert.deepEqual(backupFiles(root), []);
});

test('custom helper counts above one require separate RAM-risk approval', () => {
  const blockedRoot = tmpRoot();
  const blockedRepo = createGitBackedSetupRepo(blockedRoot);
  const blocked = run([
    '--execute', '--repo-root', blockedRepo.setupRepo, '--repo-remote', blockedRepo.origin,
    '--yes-recommended', '--skip-codex-plugin-auto-refresh', '--codex-helper-count', '2',
  ], { env: isolatedHomeEnv(blockedRoot), timeout: 300000 });
  assert.equal(blocked.status, 23, blocked.stderr || blocked.stdout);
  assert.match(`${blocked.stdout}\n${blocked.stderr}`, /More than one helper may exhaust RAM|require the exact approval answer/);
  assert.equal(fs.existsSync(codexConfig(blockedRoot)), false);
  assert.deepEqual(backupFiles(blockedRoot), []);

  const approvedRoot = tmpRoot();
  const approvedRepo = createGitBackedSetupRepo(approvedRoot);
  const approved = run([
    '--execute', '--repo-root', approvedRepo.setupRepo, '--repo-remote', approvedRepo.origin,
    '--yes-recommended', '--skip-codex-plugin-auto-refresh', '--codex-helper-count', '2',
    '--approve-high-helper-capacity', '--codex-cli', createFakeCodexAppServer(approvedRoot),
  ], { env: isolatedHomeEnv(approvedRoot), timeout: 300000 });
  assert.equal(approved.status, 0, approved.stderr || approved.stdout);
  assert.match(approved.stdout, /RAM-risk approval for more than one helper: approved/);
  assert.match(approved.stdout, /Normal helper capacity: 2 helper agents; 3 total session threads including the main agent/);
  assert.match(approved.stdout, /Defined multi-worker workflow exception: Only when the user invoked that workflow/);
  assert.match(approved.stdout, /helpers must not spawn helpers; root retains coordination and final judgment/);
  assert.match(approved.stdout, /Never imply that an official Deep Scan can run with insufficient capacity/);
  assert.match(fs.readFileSync(codexConfig(approvedRoot), 'utf8'), /max_concurrent_threads_per_session = 3/);
});
