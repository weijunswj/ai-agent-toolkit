'use strict';

// The no-model missed-run check the hourly nudge runs on every scheduled task: each fire time of
// the task's own cron since its newest run stamp, more than 20 minutes past, is a missed run.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { check, report, fireTimes } = require('../scripts/toolkit-projects-run-missed.cjs');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'toolkit-projects-run-missed.cjs');
// The Projects hourly nudge's own schedule: ten past each hour from 07:10 to 23:10 Singapore time.
const HOURLY = 'CRON_TZ=Asia/Singapore 10 7-23 * * *';

function task(extra = {}) {
  return { name: 'Hourly nudge', cron_expression: HOURLY, created_at: '2026-11-10T00:00:00Z', last_fired_at: '2026-11-18T15:10:04Z', stamps: ['20261118T151200Z'], ...extra };
}

const missed = (now, tasks) => check({ now, tasks }).missed.map(entry => `${entry.task} ${entry.at} (${entry.why})`);

test('the hourly nudge passes its own quiet hours (00:10 to 06:10 Singapore) with no missed run', () => {
  // The last run is 23:10 Singapore time; the next fire is 07:10 Singapore, 23:10 UTC.
  assert.deepEqual(missed('2026-11-18T22:59:00Z', [task()]), []);
});

test('a fire with no stamp is missed only once it is more than 20 minutes past', () => {
  assert.deepEqual(missed('2026-11-18T23:29:00Z', [task()]), [], '19 minutes after the fire');
  assert.deepEqual(missed('2026-11-18T23:30:00Z', [task()]), [], 'exactly 20 minutes is not over');
  assert.deepEqual(missed('2026-11-18T23:31:00Z', [task()]), ['Hourly nudge 2026-11-18T23:10Z (not fired)']);
  const fired = task({ last_fired_at: '2026-11-18T23:10:05Z' });
  assert.deepEqual(missed('2026-11-18T23:31:00Z', [fired]), ['Hourly nudge 2026-11-18T23:10Z (fired, no stamp)'], 'the trigger fired but the run left no stamp');
  const ran = task({ stamps: ['20261118T151200Z', '20261118T231300Z'] });
  assert.deepEqual(missed('2026-11-18T23:31:00Z', [ran]), [], 'a stamp after the fire covers it');
});

test('the checking run sees its own missed fires: its own time covers only the fire it answers', () => {
  // The hourly nudge checks itself. Its last stamp is 07:10 Singapore (23:12Z on the 17th); the 08:10
  // Singapore run (00:10Z) never happened, and this run answers the 09:10 Singapore fire (01:10Z).
  const self = extra => task({ last_fired_at: '2026-11-18T01:10:04Z', stamps: ['20261117T231200Z'], ...extra });
  assert.deepEqual(missed('2026-11-18T01:12:00Z', [self({ own_run: '2026-11-18T01:12:00Z' })]), ['Hourly nudge 2026-11-18T00:10Z (fired, no stamp)']);
  assert.deepEqual(missed('2026-11-18T01:35:00Z', [self({ own_run: '2026-11-18T01:35:00Z' })]), ['Hourly nudge 2026-11-18T00:10Z (fired, no stamp)'],
    'a run that starts 25 minutes late still covers the fire it answers, and only that one');
  const three = self({ stamps: ['20261117T151200Z'], own_run: '2026-11-18T02:12:00Z' });
  assert.deepEqual(missed('2026-11-18T02:12:00Z', [three]).map(line => line.slice(13, 30)), ['2026-11-17T23:10Z', '2026-11-18T00:10Z', '2026-11-18T01:10Z'],
    'every miss since the last stamp (23:10 Singapore), across the quiet hours');
  assert.deepEqual(missed('2026-11-18T01:12:00Z', [self({ stamps: ['20261118T001300Z'], own_run: '2026-11-18T01:12:00Z' })]), [], 'nothing missed');
  assert.deepEqual(missed('2026-11-18T23:31:00Z', [task({ own_run: '2026-11-18T23:31:00Z' })]), [], 'its first run of the morning answers the 07:10 fire');
  assert.throws(() => check({ now: '2026-11-18T01:12:00Z', tasks: [self({ own_run: 'now' })] }), /^RunInputError: own_run$|own_run/);
});

test('CRON_TZ is honoured: the same cron without it fires on UTC hours', () => {
  assert.deepEqual(missed('2026-11-18T23:31:00Z', [task()]), ['Hourly nudge 2026-11-18T23:10Z (not fired)']);
  const utc = missed('2026-11-18T23:31:00Z', [task({ cron_expression: '10 7-23 * * *' })]);
  assert.equal(utc.length, 8, utc.join('\n'));
  assert.equal(utc[0], 'Hourly nudge 2026-11-18T16:10Z (not fired)');
});

test('stopped tasks are skipped, created_at bounds a new task and the look-back stops at 48 hours', () => {
  assert.deepEqual(missed('2026-11-18T23:31:00Z', [task({ stopped: true })]), []);
  const daily = task({ name: 'Daily check-in', cron_expression: 'CRON_TZ=Asia/Singapore 0 8 * * *', created_at: '2026-11-18T10:00:00Z', stamps: [], last_fired_at: null });
  assert.deepEqual(missed('2026-11-18T23:31:00Z', [daily]), [], 'no fire since the task was created');
  const old = task({ cron_expression: '0 * * * *', created_at: '2026-11-01T00:00:00Z', stamps: [], last_fired_at: null });
  const result = check({ now: '2026-11-18T23:31:00Z', tasks: [old] });
  assert.equal(result.missed.length, 48, 'one per hour for 48 hours');
  assert.equal(result.missed[0].at, '2026-11-17T00:00Z');
});

test('cron fields take lists, ranges and steps, and day of month or week matches either', () => {
  const at = (cron, from, to) => fireTimes(cron, Date.parse(from), Date.parse(to)).map(ms => new Date(ms).toISOString().slice(0, 16));
  assert.deepEqual(at('*/30 9-17/4 * * *', '2026-11-18T00:00:00Z', '2026-11-18T23:59:00Z'),
    ['2026-11-18T09:00', '2026-11-18T09:30', '2026-11-18T13:00', '2026-11-18T13:30', '2026-11-18T17:00', '2026-11-18T17:30']);
  assert.deepEqual(at('5 1 * * 1,3', '2026-11-16T00:00:00Z', '2026-11-22T23:59:00Z'), ['2026-11-16T01:05', '2026-11-18T01:05'], 'Monday and Wednesday');
  assert.deepEqual(at('0 0 20 * 7', '2026-11-16T00:00:00Z', '2026-11-22T23:59:00Z'), ['2026-11-20T00:00', '2026-11-22T00:00'], 'the 20th or a Sunday (7)');
});

test('the report lists each missed run under one summary line', () => {
  const text = report(check({ now: '2026-11-18T23:31:00Z', tasks: [task(), task({ name: 'Daily check-in', stopped: true })] }));
  assert.equal(text, 'RUN CHECK: tasks 2, checked 1, missed 1\nRUN MISSED: Hourly nudge 2026-11-18T23:10Z (not fired)\n');
});

test('the command exits 0 when clear, 1 on a missed run and 2 on bad input', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-missed-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const run = input => {
    const file = path.join(dir, 'input.json');
    fs.writeFileSync(file, typeof input === 'string' ? input : JSON.stringify(input));
    return spawnSync(process.execPath, [SCRIPT, '--input', file], { encoding: 'utf8' });
  };
  assert.equal(run({ now: '2026-11-18T22:59:00Z', tasks: [task()] }).status, 0);
  const late = run({ now: '2026-11-18T23:31:00Z', tasks: [task()] });
  assert.equal(late.status, 1);
  assert.match(late.stdout, /^RUN MISSED: Hourly nudge 2026-11-18T23:10Z \(not fired\)$/m);
  for (const cron of ['61 * * * *', '* * *', 'CRON_TZ=Nowhere/City 0 * * * *', '0 25 * * *', '*/0 * * * *', '0 * * JAN *']) {
    const bad = run({ now: '2026-11-18T23:31:00Z', tasks: [task({ cron_expression: cron })] });
    assert.equal(bad.status, 2, cron);
    assert.match(bad.stderr, /^Run check input could not be read \(cron_expression\)/, cron);
  }
  for (const input of ['{', { now: 'later', tasks: [] }, { now: '2026-11-18T23:31:00Z', tasks: [task({ stamps: ['yesterday'] })] }]) {
    assert.equal(run(input).status, 2, JSON.stringify(input));
  }
  assert.equal(spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' }).status, 2, 'no --input');
});
