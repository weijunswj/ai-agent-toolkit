'use strict';
const test = require('node:test');
const { assert, fs, path, script, tmpRoot, isolatedHomeEnv, createGitBackedSetupRepo, createGitBackedRealSetupRepo, run, runWithUnclosedStdin } = require('./toolkit-setup-test-support.cjs');
const update = require('../scripts/toolkit-update-scheduled-task.cjs');
test('the explicit scheduled-task flag resolves the new question with stdin still open', async () => {
  const root = tmpRoot(), { origin, setupRepo } = createGitBackedSetupRepo(root);
  const result = await runWithUnclosedStdin(script, ['--execute', '--repo-root', setupRepo, '--repo-remote', origin,
    '--enable-repo-auto-update', '--enable-update-reports', '--default-update-report-retention-days',
    '--skip-codex-plugin-auto-refresh', '--codex-helper-capacity', 'keep', '--scheduled-task-update', 'no'],
  { env: isolatedHomeEnv(root), scheduledTaskQuestion: true, deadlineMs: 60000 });
  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /No setup-question stdin is required or read/);
  if (process.platform === 'win32') assert.match(result.stdout, /May Toolkit update scheduled tasks/);
});
test('complete ordered answers include the scheduled-task question before custom details', { skip: process.platform !== 'win32' }, () => {
  const root = tmpRoot(), { origin, setupRepo } = createGitBackedSetupRepo(root);
  const result = run(['--execute', '--repo-root', setupRepo, '--repo-remote', origin], {
    env: isolatedHomeEnv(root), scheduledTaskQuestion: true, input: ['disable', 'enable', 'default', 'keep', 'keep', 'no'].join('\n'), timeout: 60000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(update.readApproval(root).decision, 'no');
});
test('a held task update still reaches global rules and helper refresh in real setup', { skip: process.platform !== 'win32' }, () => {
  const root = tmpRoot(), { origin, setupRepo } = createGitBackedSetupRepo(root);
  update.saveApproval(root, { decision: 'standing', answer_ref: 'host/fixture-standing' }, '3.53.0');
  // An unresolvable local checkout is a held row, never a native task write.
  fs.mkdirSync(path.join(root, 'GitHub', 'held', '.git'), { recursive: true });
  const result = run(['--execute', '--repo-root', setupRepo, '--repo-remote', origin, '--yes-recommended',
    '--codex-helper-capacity', 'keep', '--scheduled-task-update', 'keep'], { env: isolatedHomeEnv(root), scheduledTaskQuestion: true, timeout: 60000 });
  assert.equal(result.status, require('../scripts/setup-toolkit-core.cjs').SETUP_ACTION_REQUIRED, result.stdout + result.stderr);
  assert.match(result.stdout, /Scheduled task update needs an owner answer/);
  assert.match(result.stdout, /## Global rules/);
  assert.match(result.stdout, /## Toolkit helpers/);
});
test('real setup fixture includes the updater complete local module closure', () => {
  const root = tmpRoot(), { setupRepo } = createGitBackedRealSetupRepo(root);
  const source = path.resolve(__dirname, '../..'), seen = new Set(), pending = ['repo/scripts/toolkit-update-scheduled-task.cjs'];
  while (pending.length) {
    const relative = pending.pop(); if (seen.has(relative)) continue; seen.add(relative);
    assert.equal(fs.existsSync(path.join(setupRepo, relative)), true, relative);
    for (const match of fs.readFileSync(path.join(source, relative), 'utf8').matchAll(/require\(['"](\.\.?\/[\w./-]+\.cjs)['"]\)/g)) pending.push(path.posix.normalize(path.posix.join(path.posix.dirname(relative), match[1])));
  }
  assert.ok(seen.size > 10, 'the real updater dependencies are exercised');
});
