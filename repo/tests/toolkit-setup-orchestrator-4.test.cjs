'use strict';
const test = require('node:test');
const {
  assert, fs, path, script, tmpRoot, isolatedHomeEnv, writeFile, createFakeCodexAppServer, run, escapeRegExp, createGitBackedSetupRepo, runWithUnclosedStdin, codexConfig, backupFiles, displayedBankReference, auditFixture, specsForAudit, parseConciseInFreshProcess
} = require('./toolkit-setup-test-support.cjs');

// Split by complete test declarations to keep the per-file time budget.
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
