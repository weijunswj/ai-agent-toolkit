#!/usr/bin/env node
'use strict';

// Flags scheduled Projects task runs that never happened. The hourly nudge writes what it read for
// each task on the SCHEDULED TASKS line (its trigger's cron, creation and last fire times, and the
// run stamps in its task-runs folder) to a JSON file and runs this; the coordinator catches each
// missed run up (`RUN MISSED` in the Projects skill's reference/periodic-runs.md). Read-only: it
// prints to stdout and writes nothing.
//
//   node repo/scripts/toolkit-projects-run-missed.cjs --input <file>
//
// Input: { "now", "tasks": [{ "name", "cron_expression", "created_at", "last_fired_at", "stopped"?,
// "stamps": [<run UTC>] }] }. `cron_expression` is the trigger's own, five fields with an optional
// leading `CRON_TZ=<zone>`; each field takes `*`, numbers, ranges, lists and steps. A run UTC is a
// stamp name (YYYYMMDDTHHMMSSZ) or an ISO time.
//
// Each fire time of the cron after the newer of the task's newest stamp and its creation, at most
// 48 hours back, that is more than 20 minutes past is a missed run: "fired, no stamp" when the
// trigger fired at or after it, else "not fired". A stopped task is skipped. Hours the cron never
// fires (an hourly task's night) are never missed.
// Exit 0 nothing missed, 1 a missed run, 2 bad input or arguments.

const fs = require('node:fs');

const GRACE_MINUTES = 20;
const LOOKBACK_HOURS = 48;
const MINUTE = 60000;
const USAGE = 'Usage: node repo/scripts/toolkit-projects-run-missed.cjs --input <file>';
// minute, hour, day of month, month, day of week (0 or 7 is Sunday)
const FIELDS = Object.freeze([[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]]);

class RunInputError extends Error {}

function fail(what) {
  throw new RunInputError(what);
}

function time(value, what) {
  if (typeof value === 'string' && /^\d{8}T\d{6}Z$/.test(value)) {
    value = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`;
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(Date.parse(value))) fail(what);
  return Date.parse(value);
}

// One cron field as the set of values it matches.
function field(text, [min, max]) {
  const values = new Set();
  for (const part of text.split(',')) {
    const match = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
    if (!match) fail('cron_expression');
    const from = match[1] === '*' ? min : Number(match[2]);
    const to = match[1] === '*' ? max : match[3] !== undefined ? Number(match[3]) : match[4] !== undefined ? max : from;
    const step = match[4] !== undefined ? Number(match[4]) : 1;
    if (from < min || to > max || from > to || step < 1) fail('cron_expression');
    for (let value = from; value <= to; value += step) values.add(value);
  }
  return values;
}

function parseCron(expression) {
  if (typeof expression !== 'string') fail('cron_expression');
  let rest = expression.trim();
  let zone = 'UTC';
  const tz = /^CRON_TZ=(\S+)\s+(.*)$/.exec(rest);
  if (tz) [, zone, rest] = tz;
  const parts = rest.split(/\s+/);
  if (parts.length !== 5) fail('cron_expression');
  let local;
  try { local = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }); } catch { fail('cron_expression'); }
  const [minute, hour, day, month, weekday] = parts.map((part, index) => field(part, FIELDS[index]));
  if (weekday.has(7)) weekday.add(0);
  return { local, minute, hour, day, month, weekday, anyDay: parts[2] === '*', anyWeekday: parts[4] === '*' };
}

const WEEKDAYS = Object.freeze(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);

// True when the cron fires in the minute starting at `ms`. As in cron, a restricted day of month
// and day of week match when either does.
function fires(cron, ms) {
  const at = Object.fromEntries(cron.local.formatToParts(new Date(ms)).map(part => [part.type, part.value]));
  if (!cron.minute.has(Number(at.minute)) || !cron.hour.has(Number(at.hour)) || !cron.month.has(Number(at.month))) return false;
  const day = cron.day.has(Number(at.day));
  const weekday = cron.weekday.has(WEEKDAYS.indexOf(at.weekday));
  if (cron.anyDay || cron.anyWeekday) return day && weekday;
  return day || weekday;
}

// The fire times (UTC milliseconds, each on a whole minute) after `from` up to and including `to`.
function fireTimes(expression, from, to) {
  const cron = typeof expression === 'string' ? parseCron(expression) : expression;
  const times = [];
  for (let ms = Math.floor(from / MINUTE) * MINUTE + MINUTE; ms <= to; ms += MINUTE) if (fires(cron, ms)) times.push(ms);
  return times;
}

function readTask(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('task');
  if (typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 200) fail('task name');
  if (raw.stopped !== undefined && typeof raw.stopped !== 'boolean') fail('stopped');
  if (!Array.isArray(raw.stamps)) fail('stamps');
  return {
    name: raw.name.replace(/[\s|]+/g, ' ').trim(),
    cron: parseCron(raw.cron_expression),
    created: time(raw.created_at, 'created_at'),
    lastFired: raw.last_fired_at === null || raw.last_fired_at === undefined ? null : time(raw.last_fired_at, 'last_fired_at'),
    stopped: raw.stopped === true,
    stamps: raw.stamps.map(stamp => time(stamp, 'stamps')),
  };
}

const minuteText = ms => `${new Date(ms).toISOString().slice(0, 16)}Z`;

function check(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('input');
  const now = time(input.now, 'now');
  if (!Array.isArray(input.tasks)) fail('tasks');
  const tasks = input.tasks.map(readTask);
  const missed = [];
  for (const task of tasks.filter(entry => !entry.stopped)) {
    const from = Math.max(task.created, now - LOOKBACK_HOURS * 60 * MINUTE, ...task.stamps);
    for (const at of fireTimes(task.cron, from, now - GRACE_MINUTES * MINUTE - 1)) {
      missed.push({ task: task.name, at: minuteText(at), why: task.lastFired !== null && task.lastFired >= at ? 'fired, no stamp' : 'not fired' });
    }
  }
  return { tasks: tasks.length, checked: tasks.filter(entry => !entry.stopped).length, missed };
}

function report(result) {
  return `${[`RUN CHECK: tasks ${result.tasks}, checked ${result.checked}, missed ${result.missed.length}`,
    ...result.missed.map(entry => `RUN MISSED: ${entry.task} ${entry.at} (${entry.why})`)].join('\n')}\n`;
}

function main(args = process.argv.slice(2)) {
  try {
    if (args.length !== 2 || args[0] !== '--input') throw new RunInputError('argument');
    let input;
    try { input = JSON.parse(fs.readFileSync(args[1], 'utf8').replace(/^﻿/, '')); } catch { throw new RunInputError('json'); }
    const result = check(input);
    process.stdout.write(report(result));
    return result.missed.length ? 1 : 0;
  } catch (error) {
    if (!(error instanceof RunInputError)) throw error;
    process.stderr.write(`Run check input could not be read (${error.message}).\n${USAGE}\n`);
    return 2;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = Object.freeze({ check, report, fireTimes, main, RunInputError });
