'use strict';

// A takeover's upgrade of a project's scheduled tasks (#1242 S5): the plan from the host's read-back
// (current, outdated with its exact replacement, waiting for its additions, hand-made, damaged, not
// Toolkit's, stopped by the owner), the paused tasks in one unpause question, and the check of the
// second read-back after the swaps. Fixtures only: no host, no live task.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const hostile = require('./support/hostile-inputs.cjs');
const { renderBlock } = require('../scripts/toolkit-managed-block.cjs');
const { ProjectsTasks, TaskUpgradePlanner, READ_BACK_SCHEMA, PLAN_SCHEMA, PROJECT_HEADING, validateParams } = require('../scripts/toolkit-projects-tasks.cjs');

const ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(ROOT, 'repo/scripts/toolkit-projects-tasks.cjs');
const tasks = new ProjectsTasks({ root: ROOT });
const planner = new TaskUpgradePlanner({ tasks });
const PARAMS = {
  'daily-check-in': validateParams('daily-check-in', { project: 'EXAMPLE', repo: 'example-owner/example-repo', parent_issue: '12', report_dir: '/mnt/project-files/daily-check-in', effort: 'medium' }),
  'hourly-nudge': validateParams('hourly-nudge', { project: 'EXAMPLE', repo: 'example-owner/example-repo', report_dir: '/mnt/project-files/hourly-nudge', effort: 'medium' }),
  custom: validateParams('custom', { project: 'EXAMPLE', repo: 'none', report_dir: '/mnt/project-files/sweep', effort: 'medium' }),
};
const OWN_TEXT = 'Task: check the example folder and list what changed.\n1. List the folder.\n2. Compare with the last report.';

// The stored prompt from before pings: the full instructions as managed blocks (outdated today).
function full(kind, projectText) {
  const [setup, ...rest] = tasks.instructionBlocks(kind, PARAMS[kind]).map(renderBlock);
  const delivery = rest.pop();
  const fence = ['```toolkit-task-params', JSON.stringify(PARAMS[kind], null, 2), '```'].join('\n');
  return [setup, '', fence, '', ...rest.flatMap(block => [block, '']), projectText || `${PROJECT_HEADING}\n- none`, '', delivery, ''].join('\n');
}
const current = kind => tasks.render(kind, PARAMS[kind], kind === 'custom' ? OWN_TEXT : undefined);
const task = (id, name, prompt, enabled = true) => ({ id, name, enabled, cron: '0 * * * *', prompt });
const readBack = list => ({ schema: READ_BACK_SCHEMA, tasks: list });
const MEMORY = '- SCHEDULED TASKS: EXAMPLE: Daily check-in | trig_daily | 0 8 * * * | fresh; Old sweep | trig_old | 0 9 * * * | fresh | stopped by owner 2026-11-01\n';

test('the plan names each task\'s state, gives the exact replacement and never touches a task the owner stopped', () => {
  const back = readBack([
    task('trig_daily', 'EXAMPLE: Daily check-in', full('daily-check-in'), false),
    task('trig_nudge', 'EXAMPLE: Hourly nudge', current('hourly-nudge')),
    task('trig_sweep', 'EXAMPLE sweep', current('custom')),
    task('trig_old', 'EXAMPLE: Hourly nudge', full('hourly-nudge'), false),
    task('trig_mine', 'My own reminder', 'Remind me to water the plants.'),
    task('trig_hand', 'EXAMPLE: Daily check-in', 'Check the repository every morning.'),
    task('trig_broken', 'EXAMPLE: Hourly nudge', `${current('hourly-nudge')}\n<!-- AI-AGENT-TOOLKIT:claude-projects:BEGIN TASK-PING v2 toolkit=1.0.0 sha256=000000000000 -->\n`),
  ]);
  const plan = planner.plan(back, { memory: MEMORY });
  assert.equal(plan.schema, PLAN_SCHEMA);
  assert.deepEqual(plan.tasks.map(row => [row.id, row.kind, row.state, row.paused]), [
    ['trig_daily', 'daily-check-in', 'outdated', true],
    ['trig_nudge', 'hourly-nudge', 'current', false],
    ['trig_sweep', 'custom', 'current', false],
    ['trig_old', 'hourly-nudge', 'stopped', true],
    ['trig_mine', null, 'not-toolkit', false],
    ['trig_hand', 'daily-check-in', 'hand-made', false],
    ['trig_broken', 'hourly-nudge', 'damaged', false],
  ]);
  // The replacement is the ping a refresh gives in the same session, so the swap is an update in place.
  assert.equal(plan.tasks[0].replacement, current('daily-check-in'));
  assert.equal(tasks.check('daily-check-in', plan.tasks[0].replacement).state, 'current');
  for (const row of plan.tasks.slice(1)) assert.equal(row.replacement, undefined, row.id);
  // The stopped task is paused too, but only the owner restarts it, so it is not in the question.
  assert.deepEqual(plan.unpause.ids, ['trig_daily']);
  assert.equal(plan.unpause.question, 'Unpause "EXAMPLE: Daily check-in"? It is paused now, and an upgrade keeps a paused task paused. Reply with the ones to unpause, all, or none.');
});

test('a task whose prompt still holds project lines waits until they are saved word for word', () => {
  const lines = `${PROJECT_HEADING}\n- Also list the example sweep.`;
  const back = readBack([task('trig_daily', 'EXAMPLE: Daily check-in', full('daily-check-in', lines))]);
  const waiting = planner.plan(back).tasks[0];
  assert.deepEqual([waiting.state, waiting.replacement, waiting.additions], ['additions-unsaved', undefined, lines]);
  assert.equal(planner.plan(back, { additions: '- something else\n' }).tasks[0].state, 'additions-unsaved', 'a saved file without the lines does not count');
  const ready = planner.plan(back, { additions: `${lines}\n` }).tasks[0];
  assert.deepEqual([ready.state, ready.replacement], ['outdated', current('daily-check-in')]);
});

test('with nothing to upgrade or unpause the plan says so, and the CLI exits 0', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-task-upgrade-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'read-back.json');
  fs.writeFileSync(file, JSON.stringify(readBack([task('trig_nudge', 'EXAMPLE: Hourly nudge', current('hourly-nudge'))])));
  const quiet = spawnSync(process.execPath, [SCRIPT, '--upgrade-plan', file], { encoding: 'utf8' });
  assert.equal(quiet.status, 0, quiet.stderr);
  assert.equal(JSON.parse(quiet.stdout).unpause, null);
  fs.writeFileSync(file, JSON.stringify(readBack([task('trig_nudge', 'EXAMPLE: Hourly nudge', current('hourly-nudge'), false)])));
  const paused = spawnSync(process.execPath, [SCRIPT, '--upgrade-plan', file], { encoding: 'utf8' });
  assert.equal(paused.status, 1, 'a paused task is one question for the owner');
  assert.equal(JSON.parse(paused.stdout).unpause.question, 'Unpause "EXAMPLE: Hourly nudge"? It is paused now. Reply with the ones to unpause, all, or none.');
});

test('the second read-back is verified only when it holds exactly the plan and the owner\'s unpauses', t => {
  const before = readBack([
    task('trig_daily', 'EXAMPLE: Daily check-in', full('daily-check-in'), false),
    task('trig_nudge', 'EXAMPLE: Hourly nudge', current('hourly-nudge'), false),
  ]);
  const plan = planner.plan(before);
  const after = (changes = {}) => readBack([
    { ...task('trig_daily', 'EXAMPLE: Daily check-in', current('daily-check-in').replace(/\n/g, '\r\n'), false), ...changes.daily },
    { ...task('trig_nudge', 'EXAMPLE: Hourly nudge', current('hourly-nudge'), false), ...changes.nudge },
  ]);
  assert.deepEqual(planner.verify(plan, after()), { verified: true, tasks: [{ id: 'trig_daily', name: 'EXAMPLE: Daily check-in', verified: true }, { id: 'trig_nudge', name: 'EXAMPLE: Hourly nudge', verified: true }] });
  assert.equal(planner.verify(plan, after({ nudge: { enabled: true } }), { unpaused: ['trig_nudge'] }).verified, true, 'unpaused on the owner\'s word');
  const why = (result, id) => result.tasks.find(row => row.id === id).why;
  assert.equal(why(planner.verify(plan, after({ daily: { prompt: full('daily-check-in') } })), 'trig_daily'), 'its prompt is not the planned replacement');
  assert.equal(why(planner.verify(plan, after({ nudge: { enabled: true } })), 'trig_nudge'), 'it is no longer paused', 'never unpaused without the owner');
  assert.equal(why(planner.verify(plan, after(), { unpaused: ['trig_nudge'] }), 'trig_nudge'), 'it is still paused');
  assert.equal(why(planner.verify(plan, after({ daily: { cron: '0 9 * * *', name: 'Renamed' } })), 'trig_daily'), 'its name changed; its schedule changed');
  assert.equal(why(planner.verify(plan, readBack([after().tasks[1]])), 'trig_daily'), 'it is not in the read-back');
  assert.equal(why(planner.verify(plan, after({ nudge: { prompt: `${current('hourly-nudge')}- one more line
` } })), 'trig_nudge'), 'its prompt changed, and the plan changes none here');
  assert.throws(() => planner.verify(plan, after(), { unpaused: ['trig_other'] }), /TASK_ARGUMENTS/);
  // From the command line: verified exits 0, anything else 1.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-task-upgrade-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const planFile = path.join(dir, 'plan.json');
  const backFile = path.join(dir, 'after.json');
  fs.writeFileSync(planFile, JSON.stringify(plan));
  fs.writeFileSync(backFile, JSON.stringify(after()));
  assert.equal(spawnSync(process.execPath, [SCRIPT, '--upgrade-verify', planFile, backFile], { encoding: 'utf8' }).status, 0);
  fs.writeFileSync(backFile, JSON.stringify(after({ nudge: { enabled: true } })));
  const refused = spawnSync(process.execPath, [SCRIPT, '--upgrade-verify', planFile, backFile], { encoding: 'utf8' });
  assert.equal(refused.status, 1);
  assert.equal(JSON.parse(refused.stdout).verified, false);
});

test('a read-back or memory line Toolkit cannot read refuses the whole plan, without echoing it', t => {
  const good = task('trig_daily', 'EXAMPLE: Daily check-in', current('daily-check-in'));
  for (const [label, raw] of [
    ['no schema', { tasks: [good] }],
    ['an extra top key', { ...readBack([good]), more: 1 }],
    ['an extra task key', readBack([{ ...good, thread: 'x' }])],
    ['a missing task key', readBack([{ id: good.id, name: good.name, enabled: true, prompt: good.prompt }])],
    ['enabled as text', readBack([{ ...good, enabled: 'false' }])],
    ['a repeated id', readBack([good, good])],
    ['an id of another shape', readBack([{ ...good, id: 'trig_a/b' }])],
    ['a name with a line break', readBack([{ ...good, name: 'EXAMPLE:\nDaily check-in' }])],
    ['a list, not an object', [good]],
  ]) assert.throws(() => planner.plan(raw), error => error.message === 'TASK_READ_BACK', label);
  assert.throws(() => planner.plan(readBack([good]), { memory: '- SCHEDULED TASKS: not an entry\n' }), error => error.message === 'TASK_MEMORY');
  assert.throws(() => planner.plan(readBack([good]), { memory: 'no tasks line\n' }), error => error.message === 'TASK_MEMORY');
  // A stop mark the reader cannot read whole refuses the plan, so a task the owner stopped is never
  // planned as one to swap because a hidden character or line break hid its mark.
  const stopped = text => `- SCHEDULED TASKS: EXAMPLE: Daily check-in | trig_daily | 0 8 * * * | fresh; Old ${text} sweep | trig_old | 0 9 * * * | fresh | stopped by owner 2026-11-01\n`;
  const plans = text => {
    try { planner.plan(readBack([good]), { memory: stopped(text) }); return true; } catch (error) { if (error.message !== 'TASK_MEMORY') throw error; return false; }
  };
  hostile.expectDefaultDeny(assert, plans, hostile.cases(['line-breaks', 'invisible']));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-task-upgrade-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'read-back.json');
  fs.writeFileSync(file, JSON.stringify({ tasks: [{ ...good, name: 'SECRET-NAME-1' }] }));
  const refused = spawnSync(process.execPath, [SCRIPT, '--upgrade-plan', file], { encoding: 'utf8' });
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /^Task prompt could not be processed \(PROJECT_TASKS_INVALID\)\.\nUpgrade plan refused \(TASK_READ_BACK\): /);
  assert.doesNotMatch(refused.stderr, /SECRET-NAME-1/);
});
