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
  const waiting = planner.plan(back, { memory: MEMORY }).tasks[0];
  assert.deepEqual([waiting.state, waiting.replacement, waiting.additions], ['additions-unsaved', undefined, lines]);
  assert.equal(planner.plan(back, { memory: MEMORY, additions: '- something else\n' }).tasks[0].state, 'additions-unsaved', 'a saved file without the lines does not count');
  const ready = planner.plan(back, { memory: MEMORY, additions: `${lines}\n` }).tasks[0];
  assert.deepEqual([ready.state, ready.replacement], ['outdated', current('daily-check-in')]);
});

test('with nothing to upgrade or unpause the plan says so, and the CLI exits 0', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-task-upgrade-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'read-back.json');
  const memory = path.join(dir, 'memory.md');
  fs.writeFileSync(memory, MEMORY);
  fs.writeFileSync(file, JSON.stringify(readBack([task('trig_nudge', 'EXAMPLE: Hourly nudge', current('hourly-nudge'))])));
  // Without the project memory a stopped task could be planned as a swap, so the plan refuses.
  const bare = spawnSync(process.execPath, [SCRIPT, '--upgrade-plan', file], { encoding: 'utf8' });
  assert.equal(bare.status, 2);
  assert.match(bare.stderr, /Upgrade plan refused \(TASK_ARGUMENTS\): an upgrade plan needs --memory with the project memory/);
  const quiet = spawnSync(process.execPath, [SCRIPT, '--upgrade-plan', file, '--memory', memory], { encoding: 'utf8' });
  assert.equal(quiet.status, 0, quiet.stderr);
  assert.equal(JSON.parse(quiet.stdout).unpause, null);
  fs.writeFileSync(file, JSON.stringify(readBack([task('trig_nudge', 'EXAMPLE: Hourly nudge', current('hourly-nudge'), false)])));
  const paused = spawnSync(process.execPath, [SCRIPT, '--upgrade-plan', file, '--memory', memory], { encoding: 'utf8' });
  assert.equal(paused.status, 1, 'a paused task is one question for the owner');
  assert.equal(JSON.parse(paused.stdout).unpause.question, 'Unpause "EXAMPLE: Hourly nudge"? It is paused now. Reply with the ones to unpause, all, or none.');
});

test('the second read-back is verified only when it holds exactly the plan and the owner\'s unpauses', t => {
  const before = readBack([
    task('trig_daily', 'EXAMPLE: Daily check-in', full('daily-check-in'), false),
    task('trig_nudge', 'EXAMPLE: Hourly nudge', current('hourly-nudge'), false),
  ]);
  const plan = planner.plan(before, { memory: MEMORY });
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
  ]) assert.throws(() => planner.plan(raw, { memory: MEMORY }), error => error.message === 'TASK_READ_BACK', label);
  assert.throws(() => planner.plan(readBack([good]), { memory: '- SCHEDULED TASKS: not an entry\n' }), error => error.message === 'TASK_MEMORY');
  assert.throws(() => planner.plan(readBack([good]), { memory: 'no tasks line\n' }), error => error.message === 'TASK_MEMORY');
  // A stop mark the reader cannot read whole refuses the plan, so a task the owner stopped is never
  // planned as one to swap because a hidden character or line break hid its mark.
  const stopped = text => `- SCHEDULED TASKS: EXAMPLE: Daily check-in | trig_daily | 0 8 * * * | fresh; Old ${text} sweep | trig_old | 0 9 * * * | fresh | stopped by owner 2026-11-01\n`;
  const plans = text => {
    try { planner.plan(readBack([good]), { memory: stopped(text) }); return true; } catch (error) { if (error.message !== 'TASK_MEMORY') throw error; return false; }
  };
  // A look-alike letter in a task's name is a name, as --check-memory reads it; one inside the stop mark
  // fails the entry pattern, so it refuses rather than hiding the mark.
  hostile.expectDefaultDeny(assert, plans, hostile.cases(['line-breaks', 'invisible']), { allow: ['cyrillic-look-alike', 'non-breaking-hyphen'] });
  assert.throws(() => planner.plan(readBack([good]), { memory: '- SCHEDULED TASKS: Old sweep | trig_old | 0 9 * * * | fresh | stopped by \u043ewner 2026-11-01\n' }), error => error.message === 'TASK_MEMORY');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-task-upgrade-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'read-back.json');
  fs.writeFileSync(file, JSON.stringify({ tasks: [{ ...good, name: 'SECRET-NAME-1' }] }));
  const memory = path.join(dir, 'memory.md');
  fs.writeFileSync(memory, MEMORY);
  const refused = spawnSync(process.execPath, [SCRIPT, '--upgrade-plan', file, '--memory', memory], { encoding: 'utf8' });
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /^Task prompt could not be processed \(PROJECT_TASKS_INVALID\)\.\nUpgrade plan refused \(TASK_READ_BACK\): /);
  assert.doesNotMatch(refused.stderr, /SECRET-NAME-1/);
});

// G2 round 1 of PR 1544 (evidence/g2-1544-r1), red at 2b62a77: the stop guard is never opt-in, a
// hand-rendered task verifies once it checks current, a task the plan does not hold is reported, a
// person's own task name may hold any character a person types, and a store that is not private gets
// no advice to move sessions.
test('M1: without the project memory the plan refuses, and a memory line --check-memory calls current is read', () => {
  const back = readBack([task('trig_old', 'EXAMPLE: Hourly nudge', full('hourly-nudge'), false)]);
  assert.throws(() => planner.plan(back), error => error.message === 'TASK_MEMORY' && /needs the project memory/.test(error.rule));
  assert.equal(planner.plan(back, { memory: MEMORY }).tasks.find(row => row.id === 'trig_old').state, 'stopped');
  const accented = '- SCHEDULED TASKS: Caf\u00e9 sweep | trig_old | 0 9 * * * | fresh | stopped by owner 2026-11-01\n';
  assert.deepEqual(require('../scripts/toolkit-projects-tasks.cjs').checkMemory(`- BINDING: example-owner/example-repo main commit ${'a'.repeat(40)} CONTROLLER.md blob ${'b'.repeat(40)} toolkit 3.1.0 skill x bound 2026-11-01\n${accented}`).lines, ['current']);
  const read = planner.plan(back, { memory: accented });
  assert.deepEqual([read.tasks[0].state, read.unpause], ['stopped', null]);
});

test('M2: a hand-made or damaged task rendered by hand verifies once it checks current, and only then', () => {
  const back = readBack([task('trig_hand', 'EXAMPLE: Daily check-in', 'Check the repository every morning.')]);
  const plan = planner.plan(back, { memory: MEMORY });
  assert.equal(plan.tasks[0].state, 'hand-made');
  const rendered = tasks.refresh('daily-check-in', 'Check the repository every morning.', { params: PARAMS['daily-check-in'], session: 'bound', additions: '- none\n' });
  assert.equal(tasks.check('daily-check-in', rendered).state, 'current');
  assert.equal(planner.verify(plan, readBack([task('trig_hand', 'EXAMPLE: Daily check-in', rendered)])).verified, true);
  assert.equal(planner.verify(plan, readBack([task('trig_hand', 'EXAMPLE: Daily check-in', 'Check it every evening.')])).tasks[0].why, 'its prompt changed, and it does not check current');
  assert.equal(planner.verify(plan, readBack([task('trig_hand', 'EXAMPLE: Daily check-in', rendered, false)])).verified, false, 'paused by the swap: not verified');
});

test('L1: a task in the second read-back that the plan does not hold is reported', () => {
  const back = readBack([task('trig_nudge', 'EXAMPLE: Hourly nudge', current('hourly-nudge'))]);
  const plan = planner.plan(back, { memory: MEMORY });
  const result = planner.verify(plan, readBack([...back.tasks, task('trig_extra', 'EXAMPLE: Hourly nudge', current('hourly-nudge'))]));
  assert.equal(result.verified, false);
  assert.deepEqual(result.tasks.at(-1), { id: 'trig_extra', name: 'EXAMPLE: Hourly nudge', verified: false, why: 'it is not in the plan' });
});

test('L4: a project task named in any language is read; a name with a hidden or line-break character is not', () => {
  const back = readBack([task('trig_nudge', 'EXAMPLE: Hourly nudge', current('hourly-nudge')), task('trig_mine', 'Caf\u00e9 reminder \u2013 weekly', 'Remind me.')]);
  assert.equal(planner.plan(back, { memory: MEMORY }).tasks[1].state, 'not-toolkit');
  for (const name of ['Caf\u200be', 'two\u2028lines', 'tab\there', ' padded']) {
    assert.throws(() => planner.plan(readBack([task('trig_mine', name, 'Remind me.')]), { memory: MEMORY }), error => error.message === 'TASK_READ_BACK', JSON.stringify(name));
  }
});

// The daily check-in (#1546 PR 3): the same plan in its daily mode, over every task read back once.
// The owner's answer (INT-TK421-1378, 3): tasks on Toolkit's shell get shell updates without asking,
// with the same read-back as a takeover; a stopped task is never touched; a paused one stays paused and
// is listed. Red on main: no daily mode (the CLI refuses --daily, the plan asks the unpause question)
// and an old full shell reads as not Toolkit's, so it is never brought in step.
test('the daily plan swaps every outdated Toolkit and shell task, never a stopped one, and keeps a paused one paused with no question', () => {
  const back = readBack([
    task('trig_daily', 'EXAMPLE: Daily check-in', full('daily-check-in')),
    task('trig_nudge', 'EXAMPLE: Hourly nudge', current('hourly-nudge')),
    task('trig_sweep', 'EXAMPLE: Example sweep', full('custom', OWN_TEXT)),
    task('trig_weekly', 'EXAMPLE: Weekly sweep', full('custom', OWN_TEXT), false),
    task('trig_old', 'EXAMPLE: Hourly nudge', full('hourly-nudge'), false),
    task('trig_mine', 'My own reminder', 'Remind me to water the plants.', false),
  ]);
  const plan = planner.plan(back, { memory: MEMORY, daily: true });
  assert.equal(plan.mode, 'daily');
  assert.deepEqual(plan.tasks.map(row => [row.id, row.kind, row.state, row.paused]), [
    ['trig_daily', 'daily-check-in', 'outdated', false],
    ['trig_nudge', 'hourly-nudge', 'current', false],
    ['trig_sweep', 'custom', 'outdated', false],
    ['trig_weekly', 'custom', 'outdated', true],
    ['trig_old', 'hourly-nudge', 'stopped', true],
    ['trig_mine', null, 'not-toolkit', true],
  ]);
  // Each replacement is the current prompt for that task; the shell task keeps its own steps word for word.
  assert.equal(plan.tasks[0].replacement, current('daily-check-in'));
  for (const row of [plan.tasks[2], plan.tasks[3]]) {
    assert.equal(tasks.check('custom', row.replacement).state, 'current', row.id);
    assert.ok(row.replacement.includes(OWN_TEXT), row.id);
  }
  assert.equal(plan.tasks[4].replacement, undefined, 'a stopped task is never planned as a swap');
  // No unpause question in the daily run: the paused shell task is listed and stays paused.
  assert.equal(plan.unpause, null);
  assert.deepEqual(plan.paused, [{ id: 'trig_weekly', name: 'EXAMPLE: Weekly sweep' }]);
  // The takeover keeps its one question.
  assert.deepEqual(planner.plan(back, { memory: MEMORY }).unpause.ids, ['trig_weekly']);

  const after = (changes = {}) => readBack(back.tasks.map(entry => {
    const row = plan.tasks.find(planned => planned.id === entry.id);
    return { ...entry, ...(row.replacement ? { prompt: row.replacement } : {}), ...changes[entry.id] };
  }));
  // Only the exact second read-back verifies: every swap in place, the paused task still paused.
  assert.equal(planner.verify(plan, after()).verified, true);
  const why = (result, id) => result.tasks.find(row => row.id === id).why;
  assert.equal(why(planner.verify(plan, after({ trig_weekly: { enabled: true } })), 'trig_weekly'), 'it is no longer paused');
  assert.equal(why(planner.verify(plan, after({ trig_old: { prompt: current('hourly-nudge') } })), 'trig_old'), 'its prompt changed, and the plan changes none here');
  assert.equal(why(planner.verify(plan, after({ trig_sweep: { prompt: full('custom', OWN_TEXT) } })), 'trig_sweep'), 'its prompt is not the planned replacement');
  assert.throws(() => planner.verify(plan, after({ trig_weekly: { enabled: true } }), { unpaused: ['trig_weekly'] }), /TASK_ARGUMENTS/, 'the daily run never unpauses');
});

test('from the command line the daily plan asks nothing: a paused task alone exits 0, a swap to make exits 1', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-task-upgrade-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'read-back.json');
  const memory = path.join(dir, 'memory.md');
  fs.writeFileSync(memory, MEMORY);
  const plan = (...extra) => spawnSync(process.execPath, [SCRIPT, '--upgrade-plan', file, '--memory', memory, ...extra], { encoding: 'utf8' });
  fs.writeFileSync(file, JSON.stringify(readBack([task('trig_nudge', 'EXAMPLE: Hourly nudge', current('hourly-nudge'), false)])));
  const quiet = plan('--daily');
  assert.equal(quiet.status, 0, quiet.stderr);
  assert.deepEqual([JSON.parse(quiet.stdout).mode, JSON.parse(quiet.stdout).unpause, JSON.parse(quiet.stdout).paused], ['daily', null, [{ id: 'trig_nudge', name: 'EXAMPLE: Hourly nudge' }]]);
  assert.equal(plan().status, 1, 'the takeover still asks');
  fs.writeFileSync(file, JSON.stringify(readBack([task('trig_sweep', 'EXAMPLE: Example sweep', full('custom', OWN_TEXT))])));
  const swap = plan('--daily');
  assert.equal(swap.status, 1);
  assert.equal(JSON.parse(swap.stdout).tasks[0].state, 'outdated');
  // --daily is a switch: a value after it, or on the check, is refused.
  assert.equal(plan('--daily', 'yes').status, 2);
  const planFile = path.join(dir, 'plan.json');
  fs.writeFileSync(planFile, swap.stdout);
  assert.equal(spawnSync(process.execPath, [SCRIPT, '--upgrade-verify', planFile, file, '--daily'], { encoding: 'utf8' }).status, 2);
});
