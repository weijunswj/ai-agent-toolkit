'use strict';

// The sharded CI offer a governed repository gets from `refresh governance` (the governance bank's
// "Parallel CI shards" row): the minutes estimate it shows, the first shard list a yes writes, the
// binding text the answer pull request carries, and the check that every pinned Toolkit copy in the
// repository already reads the `ci_shards` binding key.
//
// The answer lives in the merged binding as `ci_shards` ({ answer: yes | not-now | never, offered_at }).
// Only yes makes the cloud workflows installer copy the test shards workflow and Shard Timings
// (toolkit-cloud-workflows.cjs), and only while the shard list is usable. Never stops the question.
//
// The first list (design: one rest shard plus one named shard per 10 measured minutes of the last
// green CI run, else two shards) runs `node --test` once per file: the copied shard jobs set up Node
// only, so a repository whose tests are not Node tests gets no list and is told so.

const fs = require('node:fs');
const path = require('node:path');
const util = require('node:util');
const { spawnSync } = require('node:child_process');

const governed = require('./governed-test-shards.cjs');

// The Toolkit commit that taught the binding reader `ci_shards` (Toolkit 3.113.0). A pinned copy on an
// older commit reads a binding carrying the key as invalid, so the answer pull request waits for it.
const CI_SHARDS_READER = 'd071a34a5ef47fce2da11608f745191f2ea318e0';
const SWEEP_IDS = Object.freeze(['programme-sweep', 'programme-sweep-gate']);
const MINUTES_PER_SHARD = 10;
const MAX_NAMED_SHARDS = 8;
// Node test file layouts, most specific first; the first that finds files is the list's discover glob.
const NODE_GLOBS = Object.freeze(['**/*.test.cjs', '**/*.test.mjs', '**/*.test.js', 'test/**/*.js', 'tests/**/*.js']);
const ANSWERS = Object.freeze(['yes', 'not-now', 'never']);

// The repository's own CI on its default branch, read with read-only gh: for each of its workflows
// (up to MAX_ESTIMATE_WORKFLOWS) the newest green push run, and the largest of those by summed job
// time, so a small lint workflow does not stand in for the test run. Returns { minutes, workflow,
// run } or null when none can be read. Toolkit's own copied workflows are not the repository's CI,
// so they are skipped.
const MAX_ESTIMATE_WORKFLOWS = 4;

function readEstimate(root, { run = spawnSync } = {}) {
  const gh = args => {
    const result = run('gh', args, { cwd: root, encoding: 'utf8', windowsHide: true, shell: false, timeout: 20000 });
    if (result.error || result.status !== 0) return null;
    try { return JSON.parse(result.stdout); } catch { return null; }
  };
  // A read that fails is { minutes: null, unread }, apart from null for no green run yet.
  const unread = { minutes: null, unread: 'the CI runs could not be read' };
  const repo = gh(['api', 'repos/{owner}/{repo}']);
  const branch = repo && typeof repo.default_branch === 'string' && repo.default_branch ? repo.default_branch : null;
  if (!branch) return unread;
  const runs = gh(['run', 'list', '--branch', branch, '--status', 'success', '--event', 'push', '--limit', '40', '--json', 'databaseId,workflowName,headBranch']);
  if (!Array.isArray(runs)) return unread;
  const newest = new Map();
  for (const item of runs) {
    if (!item || !Number.isInteger(item.databaseId) || typeof item.workflowName !== 'string') continue;
    if (/^Toolkit /.test(item.workflowName) || item.headBranch !== branch || newest.has(item.workflowName)) continue;
    newest.set(item.workflowName, item);
  }
  let best = null;
  for (const chosen of [...newest.values()].slice(0, MAX_ESTIMATE_WORKFLOWS)) {
    const view = gh(['run', 'view', String(chosen.databaseId), '--json', 'jobs']);
    if (!view || !Array.isArray(view.jobs)) continue;
    let ms = 0;
    for (const job of view.jobs) {
      const started = Date.parse(job?.startedAt || ''), finished = Date.parse(job?.completedAt || '');
      if (Number.isFinite(started) && Number.isFinite(finished) && finished > started) ms += finished - started;
    }
    if (ms > 0 && (!best || ms / 60000 > best.minutes)) best = { minutes: ms / 60000, workflow: chosen.workflowName, run: chosen.databaseId };
  }
  return best || (newest.size ? unread : null);
}

function readText(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}

// The workflow that already runs this repository's tests in parallel, or null: a job matrix with a
// shard key (`shard: [linux-1, linux-2]`, `shard-index: [1, 2]`) or a step reading matrix.shard.
// Read only. A shard list on its own does not count: its workflows come only with a yes.
function existingShards(root) {
  let names = [];
  try { names = fs.readdirSync(path.join(root, '.github', 'workflows')).filter(name => /\.ya?ml$/i.test(name)).sort(); } catch { return null; }
  for (const name of names) {
    const text = readText(path.join(root, '.github', 'workflows', name)) || '';
    if (/^\s*matrix\s*:/m.test(text) && (/^\s+-?\s*shard[\w-]*\s*:/im.test(text) || /\$\{\{\s*matrix\.shard/i.test(text))) return `.github/workflows/${name}`;
  }
  return null;
}

// The repository's Node tests: { ok: true, discover, files } or { ok: false, reason }. A layout counts
// when package.json runs `node --test` or every file it finds uses node:test.
function detectNodeTests(root) {
  let pkg = null;
  try { pkg = JSON.parse(readText(path.join(root, 'package.json')) || 'null'); } catch { pkg = null; }
  const script = pkg && pkg.scripts && typeof pkg.scripts.test === 'string' ? pkg.scripts.test : '';
  const runsNodeTest = /(^|[\s;&|(])node(\.exe)?\s+(?:[^;&|]*\s)?--test\b/.test(script);
  for (const glob of NODE_GLOBS) {
    const files = governed.discoverFiles(root, glob);
    if (!files.length) continue;
    const nodeTest = files.every(file => /['"]node:test['"]/.test(readText(path.join(root, ...file.split('/'))) || ''));
    if (runsNodeTest || nodeTest) return { ok: true, discover: glob, files };
    return { ok: false, reason: `the test files ${glob} finds do not all use node:test and package.json does not run node --test` };
  }
  return { ok: false, reason: 'no Node test files were found (such as *.test.js using node:test)' };
}

// The first shard list for a yes: Linux only, `node --test` once per file, one rest shard plus one named
// shard per 10 measured minutes (at least one, so two shards without timings), never more named shards
// than leave the rest shard a file. Files are dealt round-robin; Shard Timings rebalances them later.
// { ok: true, manifest, text, shards } or { ok: false, reason }.
function firstList(root, estimate = null) {
  const found = detectNodeTests(root);
  if (!found.ok) return found;
  if (found.files.length < 2) return { ok: false, reason: 'the repository has fewer than two Node test files, so there is nothing to split' };
  const wanted = estimate && Number.isFinite(estimate.minutes) ? Math.floor(estimate.minutes / MINUTES_PER_SHARD) : 1;
  const named = Math.max(1, Math.min(wanted, MAX_NAMED_SHARDS, found.files.length - 1));
  const buckets = Array.from({ length: named + 1 }, () => []);
  found.files.forEach((file, index) => buckets[index % (named + 1)].push(file));
  const shards = [...buckets.slice(0, named).map((files, index) => ({ id: `linux-${index + 1}`, files })), { id: `linux-${named + 1}`, rest: true }];
  const manifest = {
    schema: governed.MANIFEST_SCHEMA,
    description: 'This repository\'s tests split into parallel CI shards (Toolkit). Shard Timings rebalances the named shards from measured times.',
    systems: { linux: { command: ['node', '--test', '{files}'], discover: found.discover, shards } },
  };
  const errors = governed.manifestErrors(manifest, governed.discoverAll(root, manifest));
  if (errors.length) return { ok: false, reason: `the first shard list would not be usable (${errors[0]})` };
  return { ok: true, manifest, text: `${JSON.stringify(manifest, null, 2)}\n`, shards: shards.length };
}

// The Toolkit copies of the sweep in `root` still pinned to one commit (from before layouts) that may
// not read a binding key: { tooOld, unchecked }.
// `reads(commit, git)` says whether the Toolkit at that commit does (tooOld when not). A copy whose commit
// this Toolkit copy cannot read (not a git checkout, or the commit is not in it) is unchecked; callers
// hold for both, and say which is which.
function oldSweepCopies(root, toolkitRoot, reads) {
  const workflows = require('./toolkit-cloud-workflows.cjs');
  const git = args => spawnSync('git', args, { cwd: toolkitRoot, windowsHide: true, shell: false, encoding: 'utf8' });
  const tooOld = [], unchecked = [];
  for (const copy of workflows.markedCopies(root).filter(entry => SWEEP_IDS.includes(entry.id))) {
    const text = readText(path.join(root, ...copy.file.split('/'))) || '';
    const marker = workflows.MARKER.exec(text.replace(/\r\n/g, '\n'));
    // A copy with a layout runs Toolkit main, which reads every binding key this Toolkit knows.
    if (marker?.[4]) continue;
    const commit = marker?.[2];
    const known = commit && git(['cat-file', '-e', `${commit}^{commit}`]).status === 0;
    if (!known) unchecked.push(copy.file);
    else if (!reads(commit, git)) tooOld.push(copy.file);
  }
  return { tooOld, unchecked };
}

// Whether every pinned Toolkit copy of the sweep in `root` reads ci_shards: { ok } or { ok: false,
// reason } naming the step.
function readersReady(root, toolkitRoot, { reader = CI_SHARDS_READER } = {}) {
  const { tooOld, unchecked } = oldSweepCopies(root, toolkitRoot, (commit, git) => git(['merge-base', '--is-ancestor', reader, commit]).status === 0);
  if (!tooOld.length && !unchecked.length) return { ok: true };
  const parts = [];
  if (tooOld.length) parts.push(`the pinned Toolkit copies ${tooOld.join(', ')} run a Toolkit older than the one that reads ci_shards (3.113.0), and would read the binding as invalid`);
  if (unchecked.length) parts.push(`the pinned Toolkit copies ${unchecked.join(', ')} could not be checked, because this Toolkit copy cannot read the commit they are pinned to (it is not a Toolkit git checkout, or does not have that commit yet), so they might read the binding as invalid`);
  const step = tooOld.length ? 'Refresh the repository rules first (merge their pull request)' : 'Run this from a Toolkit git checkout that has their commit, or refresh the repository rules first (merge their pull request)';
  return { ok: false, reason: `${parts.join('; ')}. ${step}, then answer again` };
}

// The merged binding text with only ci_shards set, so the owner's diff shows only that: an existing
// ci_shards member is replaced, or one goes before the top-level closing brace. The result must parse
// to the merged binding plus ci_shards; anything else is rendered whole.
function ciShardsText(mergedText, parsed, value) {
  const text = String(mergedText).replace(/^﻿/, '');
  const expected = { ...parsed, ci_shards: value };
  const matches = candidate => { try { return util.isDeepStrictEqual(JSON.parse(candidate), expected); } catch { return false; } };
  const member = `{ "answer": ${JSON.stringify(value.answer)}${value.offered_at ? `, "offered_at": ${JSON.stringify(value.offered_at)}` : ''} }`;
  let edited = null;
  const existing = text.match(/"ci_shards"\s*:\s*\{[^{}]*\}/g) || [];
  if (parsed.ci_shards !== undefined && existing.length === 1) edited = text.replace(/("ci_shards"\s*:\s*)\{[^{}]*\}/, `$1${member}`);
  else if (parsed.ci_shards === undefined) {
    const close = text.lastIndexOf('}');
    const body = text.slice(0, close).replace(/\s+$/, '');
    const newline = text.includes('\r\n') ? '\r\n' : '\n';
    const indent = /\n([ \t]+)"/.exec(body)?.[1];
    if (close > 0 && body.length && !body.endsWith('{')) edited = indent === undefined
      ? `${body},"ci_shards":${member.replace(/ /g, '')}${text.slice(body.length)}`
      : `${body},${newline}${indent}"ci_shards": ${member}${text.slice(body.length)}`;
  }
  return edited !== null && matches(edited) ? edited : `${JSON.stringify(expected, null, 2)}\n`;
}

// A shard split the owner closed without merging is asked about once (INT-TK421-1360): the bank's
// shards row asks, and the owner's answer to that bank is remembered here, on this computer, per
// repository and pull request number, so a later bank does not ask again about the same close. A
// later split closed again is a higher number, asked once more; until then the newest answer holds,
// even once GitHub's closed list no longer shows that pull request or cannot be read. The file holds repository ids, numbers,
// answers and times only; one that cannot be read counts as not answered.
const CLOSED_SCHEMA = 'toolkit.ci-shards-closed.v1';
const CLOSED_BASENAME = 'ci-shards-closed.v1.json';
const CLOSED_MAX = 64;

function closedFile(registryOptions) {
  return path.join(require('./toolkit-user-state.cjs').userStateDirectory(registryOptions), CLOSED_BASENAME);
}

function closedAnswers(registryOptions) {
  try {
    const parsed = JSON.parse(fs.readFileSync(closedFile(registryOptions), 'utf8'));
    if (parsed && parsed.schema === CLOSED_SCHEMA && parsed.answers && typeof parsed.answers === 'object' && !Array.isArray(parsed.answers)) return parsed.answers;
  } catch { /* none yet */ }
  return {};
}

const closedKey = (repositoryId, number) => `${repositoryId}#${number}`;

// The remembered answer for that closed pull request, or null.
function closedSplitAnswer(registryOptions, repositoryId, number) {
  const entry = closedAnswers(registryOptions)[closedKey(repositoryId, number)];
  return entry && ANSWERS.includes(entry.answer) ? entry : null;
}

// The newest close remembered for the repository ({ number, answer, at }), or null. It keeps holding
// when that pull request is no longer among the closed ones GitHub lists, or the list cannot be read.
function latestClosedSplit(registryOptions, repositoryId) {
  let latest = null;
  for (const [key, entry] of Object.entries(closedAnswers(registryOptions))) {
    const number = key.startsWith(`${repositoryId}#`) ? Number(key.slice(repositoryId.length + 1)) : NaN;
    if (Number.isInteger(number) && entry && ANSWERS.includes(entry.answer) && (!latest || number > latest.number)) latest = { number, answer: entry.answer, at: entry.at };
  }
  return latest;
}

function rememberClosedSplit(registryOptions, repositoryId, number, answer, { now = new Date() } = {}) {
  if (typeof repositoryId !== 'string' || !repositoryId || !Number.isInteger(number) || !ANSWERS.includes(answer)) return false;
  const answers = { ...closedAnswers(registryOptions), [closedKey(repositoryId, number)]: { answer, at: now.toISOString() } };
  const kept = Object.entries(answers).sort((a, b) => String(b[1].at).localeCompare(String(a[1].at))).slice(0, CLOSED_MAX);
  const file = closedFile(registryOptions);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  try { fs.writeFileSync(temp, `${JSON.stringify({ schema: CLOSED_SCHEMA, answers: Object.fromEntries(kept) }, null, 2)}\n`, { mode: 0o600 }); fs.renameSync(temp, file); }
  finally { fs.rmSync(temp, { force: true }); }
  return true;
}

module.exports = Object.freeze({ ANSWERS, CI_SHARDS_READER, MINUTES_PER_SHARD, NODE_GLOBS, ciShardsText, closedSplitAnswer, detectNodeTests, existingShards, firstList, latestClosedSplit, oldSweepCopies, readEstimate, readersReady, rememberClosedSplit });
