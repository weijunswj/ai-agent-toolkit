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
// more run behind it, since the running pass may have read past the change, unless that run's
// follow-up is already waiting to start the next one. Nothing starts while a sweep is already queued.
const SWEEP_WORKFLOW = 'toolkit-programme-sweep.yml';
// The sweep workflow's follow-up job, by its name there.
const FOLLOW_UP_JOB = 'Start the next run after an early stop';
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
// Findings are for action: a sweep that holds or skips, or a gate that skips, says so in a titled
// warning each run (an annotation on that run). Three in a row with the same code turn the hourly
// gate red with the step that clears it. Only the hourly start and a start by hand go red, so the
// gate's check on pull requests stays about pull requests. The gate keeps no state: it reads the
// annotations of the last runs (the built-in token's checks: read).
const STREAK = 3;
const SWEEP_JOB = 'Refresh the programme';
const GATE_JOB = 'Start the sweep if there is work';
const GATE_WORKFLOW = 'toolkit-programme-sweep-gate.yml';
const TITLES = Object.freeze({ held: 'Programme Sweep held', skipped: 'Programme Sweep skipped', gate: 'Programme Sweep gate skipped' });
const STREAK_EVENTS = Object.freeze(['schedule', 'workflow_dispatch']);
// The code a titled warning carries: `<title> (<code>)` at the start of its message.
const CODE = /^\(([A-Za-z0-9_,; -]{1,200})\)/;

// The CURRENT section's freshness line, as the sweep draws it.
function boardLine(body) {
  return String(body || '').split(/\r?\n/).find(line => /^(?:Board updated: |⚠️ Board out of date |⚠️ Sweep stuck)/.test(line)) || null;
}

// How the sweep reads the file (programme-state's validateBinding, then bindingEnabled), cut down to
// the keys that decide on or off; a test keeps the two in step. The gate checks out only this file, so
// it reads the raw JSON and loads nothing else. 'enabled': version 1 with no version 2 keys (always
// on), or version 2 with governance enabled. 'disabled': governance says disabled. 'invalid': anything
// else, such as a version 1 file carrying a governance or parents key.
const BINDING_V1 = 'toolkit.programme-binding.v1';
const BINDING_V2 = 'toolkit.programme-binding.v2';
function governanceOf(binding) {
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) return 'invalid';
  if (binding.schema === BINDING_V1) return binding.governance === undefined && binding.parents === undefined && binding.parent_lifecycle === undefined && binding.detach_finished_children === undefined ? 'enabled' : 'invalid';
  if (binding.schema === BINDING_V2 && binding.governance === 'enabled') return 'enabled';
  return binding.governance === 'disabled' ? 'disabled' : 'invalid';
}

// The parent issues the binding names, or null when governance is off or the binding is unreadable.
function parentsOf(binding) {
  if (governanceOf(binding) !== 'enabled') return null;
  const numbers = Array.isArray(binding.parents) ? binding.parents.map(parent => parent?.issue) : [binding.parent_issue];
  const valid = numbers.filter(number => Number.isSafeInteger(number) && number > 0);
  return valid.length ? valid : null;
}

// What the facts say: { start, reason }.
function decide({ event, now, runs, lines, changedSince, followUpWaiting = false }) {
  if (runs.some(run => WAITING.has(run.status))) return { start: false, reason: 'a sweep is already queued' };
  // A running sweep may have read past this change: activity queues one more behind it. The hourly
  // start leaves a running sweep alone.
  if (runs.some(run => run.status === 'in_progress')) {
    // A run whose sweep stopped early and whose follow-up is waiting (for GitHub's hourly App limit to
    // reset, most often) starts the next sweep itself; one started now would begin under the margin.
    if (followUpWaiting) return { start: false, reason: 'a follow-up run is already on its way' };
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

// A fault in the run's own set-up (no repository or token): the run shows red.
class SetupError extends Error {}
// A GitHub answer that was not OK, with its HTTP status.
class GitHubAnswerError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
// Only a GitHub blip is a notice, since the next start tries again: a 5xx, a 429 rate limit, or a
// dropped connection (fetch's own TypeError carrying a cause). A 401, 403 or 404 means a set-up fault
// (a missing workflow, a token without the permission) and any other error is a bug: both stay red.
function isBlip(error) {
  if (error instanceof GitHubAnswerError) return error.status >= 500 || error.status === 429;
  return error instanceof TypeError && error.message === 'fetch failed';
}

async function gate({ env = process.env, fetchImpl = globalThis.fetch, now = Date.now(), log = line => process.stdout.write(`${line}\n`) } = {}) {
  const repository = env.GITHUB_REPOSITORY || '';
  if (!SAFE_REPOSITORY.test(repository) || !env.GH_TOKEN) throw new SetupError('The gate needs GITHUB_REPOSITORY and GH_TOKEN.');
  const api = (env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
  const call = async (method, route, body) => {
    const response = await fetchImpl(`${api}/repos/${repository}/${route}`, { method, body: body ? JSON.stringify(body) : undefined,
      headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${env.GH_TOKEN}`, 'x-github-api-version': '2022-11-28', ...(body ? { 'content-type': 'application/json' } : {}) } });
    if (!response.ok) throw new GitHubAnswerError(response.status, `GitHub answered ${response.status} for ${method} ${route.split('?')[0]}.`);
    return response.status === 204 ? null : response.json();
  };
  // The binding merged on main decides governance, as everywhere else.
  // Only a 404 means there is no file: any other answer (401, 403, a 5xx) is not "governance off" and
  // goes to the blip rule (a 5xx or 429 is a notice, the rest red). Content that does not parse is
  // an unreadable file.
  let binding = null;
  let content = null;
  try { content = (await call('GET', `contents/.github/toolkit-programme.json?ref=${BRANCH}`)).content || ''; } catch (error) {
    if (!(error instanceof GitHubAnswerError && error.status === 404)) throw error;
  }
  if (content !== null) try { binding = JSON.parse(Buffer.from(content, 'base64').toString('utf8')); } catch { binding = null; }
  const parents = parentsOf(binding);
  if (!parents) {
    // Record 808: a skip is one visible warning that names the repository, the reason and the fix.
    const governance = governanceOf(binding);
    const why = !binding || typeof binding !== 'object' ? 'the programme file on main is missing or unreadable'
      : governance === 'disabled' ? 'the programme file on main turns governance off'
        : governance === 'invalid' ? 'the programme file on main is not a valid programme file' : 'the programme file on main names no parent issue';
    const code = !binding || typeof binding !== 'object' ? 'unreadable' : governance === 'disabled' ? 'disabled' : governance === 'invalid' ? 'invalid' : 'no_parent';
    log(`::warning title=${TITLES.gate}::(${code}) Programme Sweep gate skipped ${repository}: ${why}. Fix: run toolkit governance check in a clone of ${repository}; turn governance on with toolkit governance enable, or remove the Toolkit Programme Sweep workflows if it should not be governed.`);
    const verdict = { start: false, reason: 'governance off' };
    if (!STREAK_EVENTS.includes(env.EVENT_NAME || '')) return verdict;
    // This run counts as one; the earlier finished hourly runs make up the rest.
    const earlier = ((await call('GET', `actions/workflows/${GATE_WORKFLOW}/runs?event=schedule&status=completed&per_page=${STREAK - 1}`)).workflow_runs || []).slice(0, STREAK - 1);
    const codes = [];
    for (const run of earlier) codes.push((await runFinding(call, run, GATE_JOB, TITLES.gate))?.code || null);
    if (codes.length === STREAK - 1 && codes.every(item => item === code)) {
      verdict.alert = `Programme Sweep gate skipped ${repository} ${STREAK} hourly runs in a row (${code}): ${why}. Owner: turn governance on with toolkit governance enable, or remove the Toolkit Programme Sweep workflows (both workflow files) if ${repository} should not be governed.`;
    }
    return verdict;
  }
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
  // Only while a sweep run is in progress: is its follow-up job the part still running?
  let followUpWaiting = false;
  for (const run of runs.filter(item => item.status === 'in_progress' && Number.isSafeInteger(item.id))) {
    const jobs = (await call('GET', `actions/runs/${run.id}/jobs`)).jobs || [];
    if (jobs.some(job => job.name === FOLLOW_UP_JOB && job.status !== 'completed')) followUpWaiting = true;
  }
  const verdict = decide({ event: env.EVENT_NAME || '', now, runs, lines, changedSince, followUpWaiting });
  if (verdict.start) await call('POST', `actions/workflows/${SWEEP_WORKFLOW}/dispatches`, { ref: BRANCH });
  log(`Programme Sweep gate: ${verdict.start ? 'started the sweep' : 'nothing to start'} (${verdict.reason}).`);
  if (STREAK_EVENTS.includes(env.EVENT_NAME || '')) {
    const streak = await sweepStreak(call, runs);
    if (streak) verdict.alert = streak;
  }
  return verdict;
}

// The titled finding (held or skipped) on one run's job, or null. A run of the wrong shape, a job
// that is missing or an annotation without a code counts as no finding, which ends a streak.
async function runFinding(call, run, jobName, ...titles) {
  if (!Number.isSafeInteger(run?.id)) return null;
  const job = ((await call('GET', `actions/runs/${run.id}/jobs`)).jobs || []).find(item => item.name === jobName && Number.isSafeInteger(item.id));
  if (!job) return null;
  // A job's id is its check run's id.
  const notes = await call('GET', `check-runs/${job.id}/annotations?per_page=50`);
  for (const note of Array.isArray(notes) ? notes : []) {
    if (!titles.includes(note?.title) || note.annotation_level !== 'warning') continue;
    const code = CODE.exec(String(note.message || ''))?.[1];
    if (code) return { title: note.title, code, at: run.run_started_at || run.created_at || null };
  }
  return null;
}

// The last STREAK finished sweeps: all held, or all skipped, with the same code? Stops reading at
// the first run that breaks the streak, so a quiet hour costs two small reads.
async function sweepStreak(call, runs) {
  const finished = runs.filter(run => run.status === 'completed' && run.conclusion === 'success').slice(0, STREAK);
  if (finished.length < STREAK) return null;
  let first = null, since = null;
  for (const run of finished) {
    const found = await runFinding(call, run, SWEEP_JOB, TITLES.held, TITLES.skipped);
    if (!found || (first && (found.title !== first.title || found.code !== first.code))) return null;
    first = first || found;
    since = found.at;
  }
  const when = since ? ` since ${since}` : '';
  return first.title === TITLES.held
    ? `Programme Sweep held ${STREAK} runs in a row (${first.code})${when}. Controller: read the held items on the programme page and clear their cause, or ask the owner; the first clean sweep clears this.`
    : `Programme Sweep skipped ${STREAK} runs in a row (${first.code})${when}. Owner: follow the fix in the sweep run's warning (toolkit governance check names it), or remove the Toolkit Programme Sweep workflows if this repository should not be governed.`;
}

// The sweep's follow-up: after a pass stops early, start one more run on main. A pass paused at
// GitHub's hourly App limit waits until the limit has reset; one stopped by its time limit starts
// again at once. `at` is a time in milliseconds; waiting is capped at RESET_WAIT_MS. After the wait
// it starts nothing when another sweep is queued, running or started after its own run.
async function followUp({ env = process.env, fetchImpl = globalThis.fetch, now = () => Date.now(), sleep = ms => new Promise(done => setTimeout(done, ms)),
  log = line => process.stdout.write(`${line}\n`) } = {}) {
  const at = Number(env.FOLLOW_UP_AT);
  if (!Number.isFinite(at) || at <= 0) { log('Programme Sweep follow-up: none needed.'); return false; }
  const wait = Math.min(Math.max(0, at - now()), RESET_WAIT_MS);
  if (wait) { log(`Programme Sweep follow-up: waiting ${Math.ceil(wait / 60000)} minute(s) for GitHub's hourly limit to reset.`); await sleep(wait); }
  const repository = env.GITHUB_REPOSITORY || '';
  if (!SAFE_REPOSITORY.test(repository) || !env.GH_TOKEN) throw new SetupError('The follow-up needs GITHUB_REPOSITORY and GH_TOKEN.');
  const api = (env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
  const call = async (method, route, body) => {
    const response = await fetchImpl(`${api}/repos/${repository}/${route}`, { method, body: body ? JSON.stringify(body) : undefined,
      headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${env.GH_TOKEN}`, 'x-github-api-version': '2022-11-28', ...(body ? { 'content-type': 'application/json' } : {}) } });
    if (!response.ok) throw new GitHubAnswerError(response.status, `GitHub answered ${response.status} for ${method} ${route.split('?')[0]}.`);
    return response.status === 204 ? null : response.json();
  };
  // Re-check after the wait: another sweep queued or running, or one started after this run, already
  // covers the saved place (a merge or the hourly gate during the wait), so none more is needed.
  const own = Number(env.GITHUB_RUN_ID);
  const runs = (await call('GET', `actions/workflows/${SWEEP_WORKFLOW}/runs?per_page=20`)).workflow_runs || [];
  const mine = runs.find(run => run.id === own);
  const ownStart = mine ? Date.parse(mine.created_at) : NaN;
  const newer = runs.find(run => run.id !== own && (WAITING.has(run.status) || run.status === 'in_progress' || (Number.isFinite(ownStart) && Date.parse(run.created_at) > ownStart)));
  if (newer) { log('Programme Sweep follow-up: another sweep already started; none more needed.'); return false; }
  await call('POST', `actions/workflows/${SWEEP_WORKFLOW}/dispatches`, { ref: BRANCH });
  log('Programme Sweep follow-up: started the next sweep on main.');
  return true;
}

if (require.main === module) {
  const which = process.argv[2] === 'follow-up' ? 'follow-up' : 'gate';
  const run = which === 'follow-up' ? followUp() : gate();
  run.then(verdict => {
    if (!verdict?.alert) return;
    process.stdout.write(`::error title=Programme Sweep needs action::${verdict.alert}\n`);
    process.exitCode = 1;
  }, error => {
    if (!isBlip(error)) { process.stderr.write(`Programme Sweep ${which} failed: ${error?.message}\n`); process.exitCode = 1; return; }
    const what = error instanceof GitHubAnswerError ? error.message : 'GitHub did not answer.';
    process.stdout.write(`::notice::Programme Sweep ${which} could not finish: ${what} The next start tries again.\n`);
  });
}

module.exports = Object.freeze({ STREAK, TITLES, sweepStreak, runFinding, SWEEP_WORKFLOW, FOLLOW_UP_JOB, BRANCH, HOUR_MS, RESET_WAIT_MS, REFRESH_MS, ACTIVITY_EVENTS, boardLine, governanceOf, parentsOf, decide, gate, followUp, SetupError, GitHubAnswerError, isBlip });
