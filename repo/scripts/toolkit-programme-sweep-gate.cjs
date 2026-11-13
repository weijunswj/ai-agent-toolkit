'use strict';

// The gate in front of the cloud sweep (.github/workflows/toolkit-programme-sweep-gate.yml).
//
// The hourly start, issue, comment and pull request activity, and a start by hand all run this
// first. It uses only the built-in Actions token, reads a few small GitHub answers and either ends
// in seconds or starts the sweep workflow on main (`workflow_dispatch`). It never holds the
// governance App's key or tokens and runs nothing else from the repository.
//
// It starts the sweep when:
//   - no sweep has finished yet;
//   - a programme board line says the last pass stopped early (a saved place to resume), unless that
//     pass stopped at GitHub's hourly App limit and the limit has not reset yet;
//   - an issue or pull request changed, or a CI run finished, since the last successful sweep
//     finished (the sweep's own edits all land before its run finishes, so they never count);
//   - the last sweep finished six hours ago or more, so slower facts (checks, drift) still refresh.
// A start from activity (including a finished CI run) waits until an hour after the last sweep
// finished; the hourly start then picks the change up. Activity during a running sweep queues one
// more run behind it, since the running pass may have read past the change. Nothing starts while a
// sweep is already queued.
const SWEEP_WORKFLOW = 'toolkit-programme-sweep.yml';
const BRANCH = 'main';
const HOUR_MS = 60 * 60 * 1000;
// GitHub's hourly App limit resets at most an hour after the first request of the window, and the
// window began no later than the pass that hit it, so an hour and a minute after that pass started
// the limit has reset.
const RESET_WAIT_MS = HOUR_MS + 60 * 1000;
const REFRESH_MS = 6 * HOUR_MS;
const ACTIVITY_EVENTS = Object.freeze(['issues', 'issue_comment', 'pull_request_target', 'workflow_run']);
const WAITING = new Set(['queued', 'waiting', 'pending', 'requested']);
// The last sweep that finished its work: a failed or cancelled run may have saved nothing.
const lastSweep = runs => runs.find(run => run.status === 'completed' && run.conclusion === 'success') || null;
const COMPLETE_LINE = /^Board updated: .+ \(state revision \d+\)$/;
const LIMIT_NOTE = /hourly App limit/;
const SAFE_REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

// The CURRENT section's freshness line, as the sweep draws it.
function boardLine(body) {
  return String(body || '').split(/\r?\n/).find(line => /^(?:Board updated: |⚠️ Board out of date |⚠️ Sweep stuck)/.test(line)) || null;
}

// The parent issues the binding names, or null when governance is off or the binding is unreadable.
function parentsOf(binding) {
  if (!binding || binding.governance !== 'enabled') return null;
  const numbers = Array.isArray(binding.parents) ? binding.parents.map(parent => parent?.issue) : [binding.parent_issue];
  const valid = numbers.filter(number => Number.isSafeInteger(number) && number > 0);
  return valid.length ? valid : null;
}

// What the facts say: { start, reason }.
function decide({ event, now, runs, lines, changedSince }) {
  if (runs.some(run => WAITING.has(run.status))) return { start: false, reason: 'a sweep is already queued' };
  // A running sweep may have read past this change: activity queues one more behind it. The hourly
  // start leaves a running sweep alone.
  if (runs.some(run => run.status === 'in_progress')) {
    return ACTIVITY_EVENTS.includes(event) ? { start: true, reason: 'activity during a running sweep; one more waits behind it' } : { start: false, reason: 'a sweep is running' };
  }
  const last = lastSweep(runs);
  if (!last) return { start: true, reason: 'no sweep has finished yet' };
  const ended = Date.parse(last.updated_at);
  if (ACTIVITY_EVENTS.includes(event)) {
    if (now - ended < HOUR_MS) return { start: false, reason: 'a sweep finished within the last hour; the hourly start picks this change up' };
    return { start: true, reason: 'activity, and no sweep within the last hour' };
  }
  const pending = lines.filter(line => !line || !COMPLETE_LINE.test(line));
  if (pending.length) {
    const started = Date.parse(last.run_started_at || last.created_at);
    if (pending.every(line => line && LIMIT_NOTE.test(line)) && now - started < RESET_WAIT_MS) return { start: false, reason: 'the last pass paused at GitHub\'s hourly App limit, which has not reset yet' };
    return { start: true, reason: 'the last pass left a saved place to resume' };
  }
  if (changedSince) return { start: true, reason: 'issues, pull requests or CI results changed since the last sweep' };
  if (now - ended >= REFRESH_MS) return { start: true, reason: 'six hours since the last sweep' };
  return { start: false, reason: 'nothing changed since the last sweep' };
}

async function gate({ env = process.env, fetchImpl = globalThis.fetch, now = Date.now(), log = line => process.stdout.write(`${line}\n`) } = {}) {
  const repository = env.GITHUB_REPOSITORY || '';
  if (!SAFE_REPOSITORY.test(repository) || !env.GH_TOKEN) throw new Error('The gate needs GITHUB_REPOSITORY and GH_TOKEN.');
  const api = (env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
  const call = async (method, route, body) => {
    const response = await fetchImpl(`${api}/repos/${repository}/${route}`, { method, body: body ? JSON.stringify(body) : undefined,
      headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${env.GH_TOKEN}`, 'x-github-api-version': '2022-11-28', ...(body ? { 'content-type': 'application/json' } : {}) } });
    if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${method} ${route.split('?')[0]}.`);
    return response.status === 204 ? null : response.json();
  };
  // The binding merged on main decides governance, as everywhere else.
  let binding = null;
  try { binding = JSON.parse(Buffer.from((await call('GET', `contents/.github/toolkit-programme.json?ref=${BRANCH}`)).content || '', 'base64').toString('utf8')); } catch { binding = null; }
  const parents = parentsOf(binding);
  if (!parents) { log('Programme Sweep gate: governance is not enabled here; nothing to start.'); return { start: false, reason: 'governance off' }; }
  const runs = (await call('GET', `actions/workflows/${SWEEP_WORKFLOW}/runs?per_page=20`)).workflow_runs || [];
  const last = lastSweep(runs);
  const lines = [];
  for (const number of parents) lines.push(boardLine((await call('GET', `issues/${number}`)).body));
  let changedSince = false;
  if (last) {
    const since = new Date(Date.parse(last.updated_at)).toISOString();
    const changed = await call('GET', `issues?state=all&sort=updated&direction=desc&per_page=1&since=${encodeURIComponent(since)}`);
    changedSince = Array.isArray(changed) && changed.some(item => Date.parse(item.updated_at) > Date.parse(since));
    // A finished CI run changes no issue's update time, so CI results are checked apart.
    if (!changedSince && env.CI_WORKFLOW && /^[A-Za-z0-9_.-]+\.ya?ml$/.test(env.CI_WORKFLOW)) {
      const ci = (await call('GET', `actions/workflows/${env.CI_WORKFLOW}/runs?status=completed&per_page=1`)).workflow_runs || [];
      changedSince = ci.some(run => Date.parse(run.updated_at) > Date.parse(since));
    }
  }
  const verdict = decide({ event: env.EVENT_NAME || '', now, runs, lines, changedSince });
  if (verdict.start) await call('POST', `actions/workflows/${SWEEP_WORKFLOW}/dispatches`, { ref: BRANCH });
  log(`Programme Sweep gate: ${verdict.start ? 'started the sweep' : 'nothing to start'} (${verdict.reason}).`);
  return verdict;
}

// The sweep's follow-up: after a pass stops early, start one more run on main. A pass paused at
// GitHub's hourly App limit waits until the limit has reset; one stopped by its time limit starts
// again at once. `at` is a time in milliseconds; waiting is capped at RESET_WAIT_MS.
async function followUp({ env = process.env, fetchImpl = globalThis.fetch, now = () => Date.now(), sleep = ms => new Promise(done => setTimeout(done, ms)),
  log = line => process.stdout.write(`${line}\n`) } = {}) {
  const at = Number(env.FOLLOW_UP_AT);
  if (!Number.isFinite(at) || at <= 0) { log('Programme Sweep follow-up: none needed.'); return false; }
  const wait = Math.min(Math.max(0, at - now()), RESET_WAIT_MS);
  if (wait) { log(`Programme Sweep follow-up: waiting ${Math.ceil(wait / 60000)} minute(s) for GitHub's hourly limit to reset.`); await sleep(wait); }
  const repository = env.GITHUB_REPOSITORY || '';
  if (!SAFE_REPOSITORY.test(repository) || !env.GH_TOKEN) throw new Error('The follow-up needs GITHUB_REPOSITORY and GH_TOKEN.');
  const api = (env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
  const response = await fetchImpl(`${api}/repos/${repository}/actions/workflows/${SWEEP_WORKFLOW}/dispatches`, { method: 'POST', body: JSON.stringify({ ref: BRANCH }),
    headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${env.GH_TOKEN}`, 'x-github-api-version': '2022-11-28', 'content-type': 'application/json' } });
  if (!response.ok) throw new Error(`GitHub answered ${response.status} when starting the follow-up sweep.`);
  log('Programme Sweep follow-up: started the next sweep on main.');
  return true;
}

if (require.main === module) {
  const run = process.argv[2] === 'follow-up' ? followUp() : gate();
  run.catch(error => { process.stderr.write(`Programme Sweep ${process.argv[2] === 'follow-up' ? 'follow-up' : 'gate'} failed: ${error.message}\n`); process.exitCode = 1; });
}

module.exports = Object.freeze({ SWEEP_WORKFLOW, BRANCH, HOUR_MS, RESET_WAIT_MS, REFRESH_MS, ACTIVITY_EVENTS, boardLine, parentsOf, decide, gate, followUp });
