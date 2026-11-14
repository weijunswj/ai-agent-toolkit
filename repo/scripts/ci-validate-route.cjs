#!/usr/bin/env node
'use strict';

// Full or light Validate runs (.github/workflows/validate.yml).
//
//   node repo/scripts/ci-validate-route.cjs route   the route job: prints mode=full or mode=light
//   node repo/scripts/ci-validate-route.cjs legs    the gate job: the test job results and the run
//                                                   whose shard summaries to read
//
// A pull request title or body edit changes no code, so when an earlier run of this workflow already
// tested exactly the same code, the edit run reuses that run's test and hook-pack results instead of
// running them again. "Exactly the same code" means all of these hold for the earlier run:
//   - it is a completed pull_request run of this workflow file, for the same head commit and head
//     repository, and not this run;
//   - in its newest attempt every test and hook-pack job (each matrix member) concluded success;
//   - it kept a summary artifact for every shard whose name ends with this run's tested commit
//     (GITHUB_SHA, the pull request merge commit), not expired. So a base that moved since, which
//     gives a new merge commit, means a full run.
// The route job reads the event: only the `edited` action without a base change can be light. Any
// other event, any doubt and any error is a full run, and the route job always exits 0, so it can
// only ever choose more testing. The gate job checks the chosen run again before it reuses it; there
// a failed check fails the job, since the route job had just accepted that run.
// The token is the workflow's own read-only token (actions: read). Nothing is written to GitHub.

const fs = require('node:fs');
const path = require('node:path');
const shards = require('./ci-test-shards.cjs');

const WORKFLOW_PATH = '.github/workflows/validate.yml';
const WORKFLOW_FILE = path.posix.basename(WORKFLOW_PATH);
const SHA = /^[0-9a-f]{40}$/;
const SLUG = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const RUN_ID = /^[1-9][0-9]{0,19}$/;
// How many earlier runs at the same head the route job looks at, newest first.
const MAX_CANDIDATES = 5;

class RouteError extends Error {}

function readEvent(env) {
  if (!env.GITHUB_EVENT_PATH) return null;
  try { return JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8')); } catch { return null; }
}

// What the event allows: a light run only for a pull request title or body edit with no base change.
// Returns { light: false, reason } or { light: true, head, headRepository, tested }.
function eventVerdict(env, event) {
  if (env.GITHUB_EVENT_NAME !== 'pull_request') return { light: false, reason: `a ${env.GITHUB_EVENT_NAME || 'unknown'} event always runs in full` };
  if (!event || typeof event !== 'object') return { light: false, reason: 'the event could not be read' };
  if (event.action !== 'edited') return { light: false, reason: `a pull request ${event.action || 'unknown'} event always runs in full` };
  const changes = event.changes && typeof event.changes === 'object' ? event.changes : {};
  if (Object.hasOwn(changes, 'base')) return { light: false, reason: 'the base branch changed' };
  const pr = event.pull_request || {};
  const head = pr.head && pr.head.sha;
  const headRepository = pr.head && pr.head.repo && pr.head.repo.full_name;
  const tested = env.GITHUB_SHA;
  if (!SHA.test(head || '') || !SLUG.test(headRepository || '') || !SHA.test(tested || '')) return { light: false, reason: 'the event does not name the head, its repository or the tested commit' };
  return { light: true, head, headRepository, tested };
}

function apiClient(env, fetchImpl) {
  const repository = env.GITHUB_REPOSITORY || '';
  if (!SLUG.test(repository) || !env.GH_TOKEN) throw new RouteError('GITHUB_REPOSITORY and GH_TOKEN are needed to read earlier runs.');
  const base = (env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
  return async (route) => {
    const response = await fetchImpl(`${base}/repos/${repository}/${route}`, {
      headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${env.GH_TOKEN}`, 'x-github-api-version': '2022-11-28' },
    });
    if (!response.ok) throw new RouteError(`GitHub answered ${response.status} for ${route.split('?')[0]}.`);
    return response.json();
  };
}

// Why the earlier run `run` cannot stand in for this run's test jobs, or null when it can. `jobs` is
// its newest attempt's job list and `artifacts` its artifact list. On success also returns the legs
// in the shape of toJSON(needs) for the test jobs.
function reuseProblem({ run, jobs, artifacts, want, manifest }) {
  if (!run || typeof run !== 'object') return { problem: 'the run could not be read' };
  if (String(run.id) === String(want.currentRunId)) return { problem: 'it is this run' };
  if (run.event !== 'pull_request') return { problem: `it ran for a ${run.event} event` };
  if (run.path !== WORKFLOW_PATH) return { problem: `it ran ${run.path}, not ${WORKFLOW_PATH}` };
  if (run.status !== 'completed') return { problem: `it is ${run.status}, not completed` };
  if (run.head_sha !== want.head) return { problem: 'it tested another head commit' };
  if (!run.head_repository || run.head_repository.full_name !== want.headRepository) return { problem: 'it ran for another head repository' };
  const byName = new Map();
  for (const job of Array.isArray(jobs) ? jobs : []) {
    if (!byName.has(job.name)) byName.set(job.name, []);
    byName.get(job.name).push(job);
  }
  const legs = {};
  for (const [job, names] of Object.entries(shards.testJobCheckNames(manifest))) {
    for (const name of names) {
      const found = byName.get(name) || [];
      if (!found.length) return { problem: `its newest attempt has no ${name} job` };
      const bad = found.find((entry) => entry.status !== 'completed' || entry.conclusion !== 'success');
      if (bad) return { problem: `${name} finished as ${bad.conclusion || bad.status}, not success` };
    }
    legs[job] = { result: 'success', outputs: {} };
  }
  const kept = new Set((Array.isArray(artifacts) ? artifacts : []).filter((artifact) => artifact && artifact.expired === false).map((artifact) => artifact.name));
  for (const system of shards.SYSTEMS) {
    for (const id of shards.shardIds(manifest, system)) {
      const pattern = new RegExp(`^test-summary-${id}-attempt-[1-9][0-9]*-${want.tested}$`);
      if (![...kept].some((name) => pattern.test(name))) return { problem: `it kept no ${id} summary for the tested commit ${want.tested.slice(0, 12)}` };
    }
  }
  return { problem: null, legs };
}

async function checkRun(call, runId, want, manifest) {
  const run = await call(`actions/runs/${runId}`);
  const jobs = (await call(`actions/runs/${runId}/jobs?filter=latest&per_page=100`)).jobs;
  const artifacts = (await call(`actions/runs/${runId}/artifacts?per_page=100`)).artifacts;
  return reuseProblem({ run, jobs, artifacts, want, manifest });
}

// The route job's decision: { mode: 'full' | 'light', runId, reason }.
async function route({ env = process.env, fetchImpl = globalThis.fetch, manifest = shards.loadManifest(), event = readEvent(env) } = {}) {
  const verdict = eventVerdict(env, event);
  if (!verdict.light) return { mode: 'full', runId: '', reason: verdict.reason };
  const want = { ...verdict, currentRunId: env.GITHUB_RUN_ID };
  const call = apiClient(env, fetchImpl);
  const listed = (await call(`actions/workflows/${WORKFLOW_FILE}/runs?event=pull_request&status=completed&head_sha=${want.head}&per_page=20`)).workflow_runs;
  const candidates = (Array.isArray(listed) ? listed : [])
    .filter((run) => run && RUN_ID.test(String(run.id)) && String(run.id) !== String(want.currentRunId))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, MAX_CANDIDATES);
  const reasons = [];
  for (const candidate of candidates) {
    const { problem } = await checkRun(call, candidate.id, want, manifest);
    if (!problem) return { mode: 'light', runId: String(candidate.id), reason: `run ${candidate.id} already tested this exact code` };
    reasons.push(`run ${candidate.id}: ${problem}`);
  }
  return { mode: 'full', runId: '', reason: reasons.length ? `no earlier run can be reused (${reasons.join('; ')})` : 'no earlier completed run at this head' };
}

// The gate job's legs: { legs, runId, reused }. A full run passes on its own test jobs' results (the
// route job's own result left out: a failed route job only means the run went full). A light run
// checks the route job's chosen run again and takes its results.
async function legs({ env = process.env, fetchImpl = globalThis.fetch, manifest = shards.loadManifest(), event = readEvent(env) } = {}) {
  if (env.ROUTE_MODE !== 'light') {
    let needs;
    try { needs = JSON.parse(env.NEEDS || 'null'); } catch { needs = null; }
    if (!needs || typeof needs !== 'object' || Array.isArray(needs)) throw new RouteError('NEEDS is not the toJSON(needs) object.');
    const own = Object.fromEntries(Object.entries(needs).filter(([job]) => job !== 'route'));
    if (!RUN_ID.test(env.GITHUB_RUN_ID || '')) throw new RouteError('GITHUB_RUN_ID is missing.');
    return { legs: own, runId: env.GITHUB_RUN_ID, reused: false };
  }
  const verdict = eventVerdict(env, event);
  if (!verdict.light) throw new RouteError(`the route job chose a light run, but ${verdict.reason}`);
  if (!RUN_ID.test(env.ROUTE_RUN_ID || '')) throw new RouteError('the route job chose a light run without naming a run');
  const want = { ...verdict, currentRunId: env.GITHUB_RUN_ID };
  const { problem, legs: reused } = await checkRun(apiClient(env, fetchImpl), env.ROUTE_RUN_ID, want, manifest);
  if (problem) throw new RouteError(`run ${env.ROUTE_RUN_ID} cannot be reused: ${problem}`);
  return { legs: reused, runId: env.ROUTE_RUN_ID, reused: true };
}

function writeOutputs(env, values) {
  const text = Object.entries(values).map(([name, value]) => `${name}=${value}\n`).join('');
  if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, text);
}

async function main(argv = process.argv.slice(2), { env = process.env, fetchImpl = globalThis.fetch, out = process.stdout, err = process.stderr } = {}) {
  const command = argv[0];
  if (argv.length !== 1 || !['route', 'legs'].includes(command)) { err.write('Usage: node repo/scripts/ci-validate-route.cjs route|legs\n'); return 2; }
  if (command === 'route') {
    let decision;
    try { decision = await route({ env, fetchImpl }); }
    catch (error) { decision = { mode: 'full', runId: '', reason: `could not read earlier runs (${error.message})` }; }
    writeOutputs(env, { mode: decision.mode, run_id: decision.runId });
    out.write(`Validate runs ${decision.mode === 'light' ? 'light: the test and hook-pack jobs are reused because' : 'in full:'} ${decision.reason}.\n`);
    return 0;
  }
  try {
    const result = await legs({ env, fetchImpl });
    writeOutputs(env, { legs: JSON.stringify(result.legs), run_id: result.runId, reused: String(result.reused) });
    out.write(result.reused ? `The test and hook-pack results come from run ${result.runId}, which tested this exact code.\n` : 'The test and hook-pack results come from this run.\n');
    return 0;
  } catch (error) {
    err.write(`The test legs could not be found: ${error.message} Re-run this workflow run; a new commit runs in full.\n`);
    return 1;
  }
}

if (require.main === module) main().then((code) => { process.exitCode = code; });

module.exports = Object.freeze({ MAX_CANDIDATES, WORKFLOW_PATH, eventVerdict, legs, main, reuseProblem, route });
