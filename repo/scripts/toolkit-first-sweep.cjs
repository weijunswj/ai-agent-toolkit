'use strict';

// The first-install sweep: one report-only run of the personal data sweep workflow, started after a
// governance turn-on that added the guard is merged (toolkit-governance-finish.cjs). The run lists, in
// its own log and summary on GitHub, what is already in the repository's files, commit messages, pull
// request text and comments: places and rule names only. It changes and posts nothing.
//
// It starts at most one run: a sweep run already on GitHub (from an earlier finish, another computer or
// a person) is read instead of starting another, and when GitHub cannot be read nothing is started.
//
// run(slug) always ends as one plain line, so the sweep never fails the finish or makes it run again:
// { end: 'report', text } (the counts and the link, or the link of a run still going) or
// { end: 'held', step } (what stopped it and how the owner starts it by hand). Only counts, the run's
// link and fixed words are ever read out of GitHub.

const { spawnSync } = require('node:child_process');
const { resolvePathExecutable } = require('./claude-process-launch.cjs');
const { SWEEP_WORKFLOW } = require('./toolkit-cloud-workflows-copied.cjs');

const WORKFLOW = SWEEP_WORKFLOW.slice('.github/workflows/'.length);
const GH_TIMEOUT_MS = 15000;
const POLL_MS = 15000;
const WAIT_MS = 8 * 60 * 1000;
// The guard's annotation (SWEEP_TITLE and sweepCounts in personal-data-guard.cjs).
const TITLE = 'Toolkit personal data sweep';
const COUNTS = /^\d{1,9} found \(\d{1,9} in files, \d{1,9} in commit messages, \d{1,9} in pull request text, \d{1,9} in comments\), \d{1,9} not readable$/;
const SLUG = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/;
const BY_HAND = 'on GitHub, open Actions, choose Personal data sweep and press Run workflow';

// { ok, value } or { ok: false, reason }. GitHub's own error text is never shown.
function ghApi(args, input) {
  let result;
  try { result = spawnSync(resolvePathExecutable('gh'), ['api', ...args, ...(input === undefined ? [] : ['--input', '-'])], { input: input === undefined ? undefined : JSON.stringify(input), encoding: 'utf8', timeout: GH_TIMEOUT_MS, windowsHide: true, shell: false }); }
  catch { return { ok: false, reason: 'gh-unavailable' }; }
  if (!result || result.error) return { ok: false, reason: 'gh-unavailable' };
  if (result.status !== 0) {
    const status = /HTTP (\d{3})/.exec(String(result.stderr || ''))?.[1];
    // Too many requests also answers 403; it clears by itself.
    if (/rate limit/i.test(String(result.stderr || ''))) return { ok: false, reason: 'rate-limited' };
    return { ok: false, reason: { 403: 'forbidden', 404: 'not-found', 422: 'refused' }[status] || 'gh-request-failed' };
  }
  try { return { ok: true, value: String(result.stdout || '').trim() ? JSON.parse(result.stdout) : null }; } catch { return { ok: false, reason: 'gh-output-invalid' }; }
}

class FirstInstallSweep {
  #gh; #wait; #now;

  constructor({ gh = ghApi, wait = ms => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }, now = () => Date.now() } = {}) {
    this.#gh = gh;
    this.#wait = wait;
    this.#now = now;
  }

  // The newest sweep run on the default branch: { ok, run } (run null when there is none). A cancelled run
  // swept nothing.
  #newest(slug, branch) {
    const read = this.#gh([`repos/${slug}/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&branch=${encodeURIComponent(branch)}&per_page=20`]);
    if (!read.ok) return read;
    if (!Array.isArray(read.value?.workflow_runs)) return { ok: false, reason: 'gh-output-invalid' };
    const runs = read.value.workflow_runs.filter(run => Number.isSafeInteger(run?.id) && run.conclusion !== 'cancelled');
    return { ok: true, run: runs.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] || null };
  }

  run(slug) {
    if (!SLUG.test(String(slug))) return this.#held('it was not started, because the repository\'s name could not be read');
    const repository = this.#gh([`repos/${slug}`]);
    const branch = repository.ok ? repository.value?.default_branch : null;
    if (typeof branch !== 'string' || !branch) return this.#held('it was not started, because GitHub could not be read');
    const before = this.#newest(slug, branch);
    if (!before.ok) return this.#held(before.reason === 'not-found' ? 'it was not started, because its workflow is not on the default branch' : 'it was not started, because GitHub could not be read');
    if (!before.run) {
      const started = this.#gh(['--method', 'POST', `repos/${slug}/actions/workflows/${WORKFLOW}/dispatches`], { ref: branch });
      if (!started.ok) return this.#held(`GitHub did not start it (${started.reason})`);
    }
    const until = this.#now() + WAIT_MS;
    let run = before.run;
    while (run?.status !== 'completed') {
      if (this.#now() >= until) return this.#going(slug, run);
      this.#wait(POLL_MS);
      const read = this.#newest(slug, branch);
      if (!read.ok) return this.#going(slug, run);
      run = read.run || run;
    }
    return this.#ended(slug, run);
  }

  #held(why) { return { end: 'held', step: `${why}; ${BY_HAND}.` }; }

  // Started, with no result read yet.
  #going(slug, run) {
    const url = run ? `https://github.com/${slug}/actions/runs/${run.id}` : `https://github.com/${slug}/actions/workflows/${WORKFLOW}`;
    return { end: 'report', text: `First personal data sweep: started, and its list (places and rule names only) will be at ${url}. It changes and posts nothing.` };
  }

  #ended(slug, run) {
    const url = `https://github.com/${slug}/actions/runs/${run.id}`;
    if (run.conclusion !== 'success') return { end: 'held', step: `it could not scan everything; open ${url} to see why, then run it again: ${BY_HAND}.` };
    const counts = this.#counts(slug, run.id);
    return { end: 'report', text: `First personal data sweep: ${counts ? `${counts}; the list (places and rule names only) is at ${url}` : `it finished; its report is at ${url}`}. It changed and posted nothing.` };
  }

  // The guard's counts from the run's annotation, or null when they cannot be read.
  #counts(slug, id) {
    const jobs = this.#gh([`repos/${slug}/actions/runs/${id}/jobs?per_page=20`]);
    const job = jobs.ok && Array.isArray(jobs.value?.jobs) ? jobs.value.jobs.find(entry => entry?.name === 'sweep' && Number.isSafeInteger(entry.id)) : null;
    if (!job) return null;
    const notes = this.#gh([`repos/${slug}/check-runs/${job.id}/annotations?per_page=50`]);
    const note = notes.ok && Array.isArray(notes.value) ? notes.value.find(entry => entry?.title === TITLE && COUNTS.test(String(entry.message))) : null;
    return note ? note.message : null;
  }
}

module.exports = Object.freeze({ BY_HAND, FirstInstallSweep, WAIT_MS, WORKFLOW });
