'use strict';
// Toolkit no longer creates, updates or starts scheduled tasks on a computer: the cloud runs those
// jobs. Setup asks no task question, ignores the old flag with one notice, and never acts on a
// standing answer an older setup saved.
const test = require('node:test');
const { assert, fs, path, script, tmpRoot, isolatedHomeEnv, createGitBackedSetupRepo, run, runWithUnclosedStdin } = require('./toolkit-setup-test-support.cjs');
const core = require('../scripts/setup-toolkit-core.cjs');
const tasks = require('../scripts/toolkit-tasks.cjs');

test('the retired scheduled-task flag is accepted with stdin still open, ignored with one notice, and asks nothing', async () => {
  const root = tmpRoot(), { origin, setupRepo } = createGitBackedSetupRepo(root);
  const result = await runWithUnclosedStdin(script, ['--execute', '--repo-root', setupRepo, '--repo-remote', origin,
    '--enable-repo-auto-update', '--enable-update-reports', '--default-update-report-retention-days',
    '--skip-codex-plugin-auto-refresh', '--codex-helper-capacity', 'keep', '--keep-codex-doc-limit', '--scheduled-task-update', 'standing'],
  { env: isolatedHomeEnv(root), deadlineMs: 60000 });
  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /No setup-question stdin is required or read/);
  assert.equal(result.stdout.split(core.SCHEDULED_TASK_FLAG_RETIRED).length, 2, result.stdout);
  assert.doesNotMatch(result.stdout, /May Toolkit update scheduled tasks|Scheduled task update/);
});

test('the setup question bank has no scheduled-task row', () => {
  assert.equal(core.setupQuestionDocumentationSpecs().some(row => /scheduled-task|scheduled task/i.test(`${row.id} ${row.title}`)), false);
});

test('a standing task answer an older setup saved is never acted on, and setup writes no task state', () => {
  const root = tmpRoot(), { origin, setupRepo } = createGitBackedSetupRepo(root);
  const state = tasks.userStateDir(root);
  fs.mkdirSync(state, { recursive: true });
  const approval = path.join(state, 'scheduled-task-approval.json');
  fs.writeFileSync(approval, JSON.stringify({ decision: 'standing', answer_ref: 'host/fixture-standing' }));
  const taskFiles = () => fs.readdirSync(state).filter(name => /task|registry|last-run/i.test(name)).sort();
  const result = run(['--execute', '--repo-root', setupRepo, '--repo-remote', origin, '--yes-recommended', '--codex-helper-capacity', 'keep'],
    { env: isolatedHomeEnv(root), timeout: 60000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(result.stdout, /Scheduled task update|toolkit-windows-tasks/);
  assert.match(result.stdout, /## Global rules/);
  assert.deepEqual(taskFiles(), ['scheduled-task-approval.json'], 'no task registry, stamp or run file written');
  assert.equal(JSON.parse(fs.readFileSync(approval, 'utf8')).decision, 'standing', 'left as it was');
});

test('the retired task runner and task updater print one line, exit 0 and write nothing', t => {
  const { spawnSync } = require('node:child_process');
  const home = tmpRoot();
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  for (const [file, args] of [['toolkit-scheduled-job.cjs', ['programme-sweep', '--task-id', 'x', '--repo-root', home]], ['toolkit-update-scheduled-task.cjs', ['--apply']]]) {
    const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', file), ...args],
      { encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home }, cwd: home, timeout: 30000 });
    assert.equal(result.status, 0, file + result.stderr);
    assert.equal(result.stderr, '', file);
    assert.match(result.stdout, /^This Toolkit scheduled task is retired|^[^\n]*retired[^\n]*\n$/, file);
    assert.equal(result.stdout.trim().split('\n').length, 1, file);
    assert.deepEqual(fs.readdirSync(home), [], `${file} wrote nothing`);
  }
});
