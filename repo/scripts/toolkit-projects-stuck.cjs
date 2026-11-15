#!/usr/bin/env node
'use strict';

// Decides which Claude Projects threads are stuck and need a fresh successor, cloud threads and
// Remote Control lanes alike. The hourly nudge writes what it read (every list_threads page, each
// unresolved work thread and its Remote Control status) to a JSON file and runs this; the
// coordinator then starts a successor for each STUCK thread (`Successors for stuck threads` in the
// Projects skill's reference/periodic-runs.md) and records it in the ledger this reads back.
// Read-only: it prints to stdout and writes nothing.
//
//   node repo/scripts/toolkit-projects-stuck.cjs --input <file> [--ledger <file>]
//
// Input: { "now", "pages": [{ "threads", "next_cursor" }], "previous": { "run_at", "stalled": [id] },
// "threads": [{ "id", "title", "state", "last_activity_at", "owes_work", "waiting_on",
// "fresh_output_at"?, "expected_minutes"?, "rc"?: { "status", "connected", "served",
// "last_activity_at", "device_reachable" } }] }. Leave out task home threads, the coordinator's own
// thread and post reply threads. The ledger is a JSON array of { "lane", "old", "new", "at" }, one
// entry per successor the coordinator started; a missing ledger file is an empty one.
//
// Busy is never stuck: a working thread, or one whose run left output in the last 45 minutes, is
// never stuck, because a long run reads no messages until its turn ends. A working thread quiet
// past twice its expected time goes to the owner instead. Stuck: failed or stopped while it owes
// work; a Remote Control session that ended, or lost contact for 10 minutes or more while its device
// is reachable; or idle and owing work, listed stalled by the previous run (so the coordinator
// pinged it) and quiet since. At most one successor per lane in 2 hours: a second stall goes to
// the owner. Exit 0 nothing to act on, 1 something to act on, 2 bad input or arguments.

const fs = require('node:fs');

const QUIET_MINUTES = 45;
const FRESH_OUTPUT_MINUTES = 45;
const LOST_CONTACT_MINUTES = 10;
const EXPECTED_MINUTES = 90;
const SUCCESSOR_WINDOW_MINUTES = 120;
const STATES = Object.freeze(['working', 'blocked', 'review_ready', 'done', 'failed', 'stopped']);
const RC_STATUSES = Object.freeze(['active', 'waiting_for_approval', 'denied', 'revoked', 'ended']);
const USAGE = 'Usage: node repo/scripts/toolkit-projects-stuck.cjs --input <file> [--ledger <file>]';

class StuckInputError extends Error {}

function fail(what) {
  throw new StuckInputError(what);
}

function time(value, what) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(Date.parse(value))) fail(what);
  return Date.parse(value);
}

function text(value, what, max = 200) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) fail(what);
  return value;
}

function minutesSince(now, then) {
  return Math.floor((now - then) / 60000);
}

// One line per value: no line breaks or column bars from a thread title, which is user text.
function plain(value) {
  return value.replace(/[\s|]+/g, ' ').trim();
}

function readThread(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('thread');
  const thread = {
    id: text(raw.id, 'thread id', 100),
    title: text(raw.title, 'thread title', 300),
    state: raw.state,
    lastActivity: time(raw.last_activity_at, 'last_activity_at'),
    owesWork: raw.owes_work,
    waitingOn: raw.waiting_on === null || raw.waiting_on === undefined ? null : text(raw.waiting_on, 'waiting_on'),
    freshOutput: raw.fresh_output_at === undefined || raw.fresh_output_at === null ? null : time(raw.fresh_output_at, 'fresh_output_at'),
    expected: raw.expected_minutes === undefined ? EXPECTED_MINUTES : raw.expected_minutes
  };
  if (!STATES.includes(thread.state)) fail('thread state');
  if (typeof thread.owesWork !== 'boolean') fail('owes_work');
  if (!Number.isInteger(thread.expected) || thread.expected < 1) fail('expected_minutes');
  if (raw.rc !== undefined && raw.rc !== null) {
    const rc = raw.rc;
    if (typeof rc !== 'object' || Array.isArray(rc) || !RC_STATUSES.includes(rc.status)) fail('rc status');
    for (const key of ['connected', 'served', 'device_reachable']) if (typeof rc[key] !== 'boolean') fail(`rc ${key}`);
    thread.rc = { status: rc.status, connected: rc.connected, served: rc.served, deviceReachable: rc.device_reachable, lastActivity: time(rc.last_activity_at, 'rc last_activity_at') };
  }
  return thread;
}

function readLedger(raw) {
  if (!Array.isArray(raw)) fail('ledger');
  return raw.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail('ledger entry');
    return { lane: text(entry.lane, 'ledger lane', 100), old: text(entry.old, 'ledger old', 100), next: text(entry.new, 'ledger new', 100), at: time(entry.at, 'ledger at') };
  });
}

// A full scan follows next_cursor to a page without one; an empty page with a cursor is not the end.
function scanProblem(pages) {
  if (!Array.isArray(pages) || pages.length === 0) fail('pages');
  for (const page of pages) {
    if (!page || typeof page !== 'object' || !Number.isInteger(page.threads) || page.threads < 0) fail('page');
    if (page.next_cursor !== null && page.next_cursor !== undefined && typeof page.next_cursor !== 'string') fail('page cursor');
  }
  const open = pages.findIndex(page => !page.next_cursor);
  if (open === -1) return `pages ${pages.length}, the last page still has a next_cursor`;
  if (open !== pages.length - 1) fail('pages after the last page');
  return null;
}

// What one thread needs, before the successor limit: { kind, reason }.
function judge(thread, now, stalledBefore) {
  const quiet = minutesSince(now, thread.lastActivity);
  if (thread.freshOutput !== null && minutesSince(now, thread.freshOutput) < FRESH_OUTPUT_MINUTES) return { kind: 'BUSY', reason: 'its run left output in the last 45 minutes' };
  const rc = thread.rc;
  if (rc) {
    if (!rc.deviceReachable) return { kind: 'OFFLINE', reason: 'its device is not reachable' };
    if (rc.status !== 'active' && rc.status !== 'ended') return { kind: 'OWNER', reason: `Remote Control ${rc.status.replace(/_/g, ' ')}` };
    if (thread.owesWork && rc.status === 'ended') return { kind: 'STUCK', reason: 'its Remote Control session ended' };
    const lost = minutesSince(now, rc.lastActivity);
    if (thread.owesWork && rc.status === 'active' && (!rc.connected || !rc.served) && lost >= LOST_CONTACT_MINUTES) {
      return { kind: 'STUCK', reason: `Remote Control lost contact ${lost} min` };
    }
  }
  if (thread.state === 'failed' || thread.state === 'stopped') {
    return thread.owesWork ? { kind: 'STUCK', reason: `${thread.state} while it owes work` } : { kind: 'OK', reason: thread.state };
  }
  if (thread.state === 'working') {
    if (quiet >= 2 * thread.expected) return { kind: 'OWNER', reason: `long run, working but quiet ${quiet} min` };
    return { kind: 'BUSY', reason: 'working' };
  }
  if (thread.waitingOn) return { kind: 'WAITING', reason: `waits on ${thread.waitingOn}` };
  if (thread.owesWork && quiet >= QUIET_MINUTES) {
    if (stalledBefore) return { kind: 'STUCK', reason: `missed the last run's ping, quiet ${quiet} min` };
    return { kind: 'STALLED', reason: `quiet ${quiet} min, ping it` };
  }
  return { kind: 'OK', reason: thread.state };
}

function classify(input, ledgerRaw = []) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('input');
  const now = time(input.now, 'now');
  const incomplete = scanProblem(input.pages);
  if (!Array.isArray(input.threads)) fail('threads');
  const threads = input.threads.map(readThread);
  if (new Set(threads.map(thread => thread.id)).size !== threads.length) fail('duplicate thread id');
  const previous = input.previous === undefined || input.previous === null ? null : input.previous;
  let stalledBefore = new Set();
  let previousRun = null;
  if (previous) {
    if (typeof previous !== 'object' || !Array.isArray(previous.stalled)) fail('previous');
    previousRun = time(previous.run_at, 'previous run_at');
    stalledBefore = new Set(previous.stalled.map(id => text(id, 'previous stalled id', 100)));
  }
  const ledger = readLedger(ledgerRaw);
  const laneOf = new Map(ledger.map(entry => [entry.next, entry.lane]));
  const supersededBy = new Map(ledger.map(entry => [entry.old, entry.next]));
  const results = threads.map((thread) => {
    const lane = laneOf.get(thread.id) || thread.id;
    if (supersededBy.has(thread.id)) return { thread, lane, kind: 'SUPERSEDED', reason: `by ${supersededBy.get(thread.id)}` };
    // Stalled last run and no activity since that run: the coordinator's ping went unanswered.
    const ignoredPing = previousRun !== null && stalledBefore.has(thread.id) && thread.lastActivity <= previousRun;
    const verdict = judge(thread, now, ignoredPing);
    if (verdict.kind === 'STUCK') {
      const recent = ledger.find(entry => entry.lane === lane && minutesSince(now, entry.at) < SUCCESSOR_WINDOW_MINUTES);
      if (recent) return { thread, lane, kind: 'OWNER', reason: `${verdict.reason}; second stall within 2 hours of successor ${recent.next}` };
    }
    return { thread, lane, ...verdict };
  });
  const count = kind => results.filter(result => result.kind === kind).length;
  const prefixes = [];
  if (incomplete) prefixes.push(`THREAD SCAN INCOMPLETE: ${incomplete} | `);
  if (count('STUCK')) prefixes.push(`STUCK THREADS: ${count('STUCK')} | `);
  if (count('OWNER')) prefixes.push(`STUCK FOR OWNER: ${count('OWNER')} | `);
  const act = Boolean(incomplete) || ['STUCK', 'OWNER', 'STALLED'].some(kind => count(kind) > 0);
  return { results, prefixes, incomplete, act, pages: input.pages.length, counts: Object.fromEntries(['STUCK', 'OWNER', 'STALLED', 'BUSY', 'WAITING', 'OFFLINE', 'SUPERSEDED', 'OK'].map(kind => [kind, count(kind)])) };
}

const ORDER = ['STUCK', 'OWNER', 'STALLED', 'OFFLINE', 'WAITING', 'BUSY', 'SUPERSEDED'];

function report(result) {
  const lines = [`PREFIXES: ${result.prefixes.length ? result.prefixes.join('') : 'none'}`];
  const counts = Object.entries(result.counts).filter(([kind]) => kind !== 'OK').map(([kind, n]) => `${kind.toLowerCase()} ${n}`).join(', ');
  lines.push(`STUCK CHECK: pages ${result.pages}, threads ${result.results.length} | ${counts}`);
  for (const kind of ORDER) {
    for (const item of result.results.filter(entry => entry.kind === kind)) {
      const lane = item.lane === item.thread.id ? '' : ` | lane ${item.lane}`;
      lines.push(`${kind} ${item.thread.id} | ${plain(item.thread.title)}${lane} | ${item.reason}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg !== '--input' && arg !== '--ledger') throw new StuckInputError('argument');
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--') || options[arg.slice(2)] !== undefined) throw new StuckInputError('argument');
    options[arg.slice(2)] = value;
    index += 1;
  }
  if (!options.input) throw new StuckInputError('argument');
  return options;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { throw new StuckInputError('json'); }
}

function main(args = process.argv.slice(2)) {
  try {
    const options = parseArgs(args);
    const ledger = options.ledger && fs.existsSync(options.ledger) ? readJson(options.ledger) : [];
    const result = classify(readJson(options.input), ledger);
    process.stdout.write(report(result));
    return result.act ? 1 : 0;
  } catch (error) {
    if (!(error instanceof StuckInputError)) throw error;
    process.stderr.write(`Stuck-thread input could not be read (${error.message}).\n${USAGE}\n`);
    return 2;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = Object.freeze({ classify, report, parseArgs, main, StuckInputError });
