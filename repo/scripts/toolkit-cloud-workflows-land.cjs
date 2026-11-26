'use strict';

// Whether a governed repository's open Toolkit refresh pull request may land now under its task
// auto-merge switch: `toolkit-cloud-workflows.cjs --repo <dir> --land-refresh`. The controller runs it
// at a turn end or session start that sees the refresh pull request open; the cloud sweep never does.
// It never merges, pushes or writes to GitHub: like the merge train's `land`, it names the pull
// request, its head and the exact merge command, and the controller runs that command, which the merge
// hold checks again (the copy proof included). After the merge the controller posts the notice it
// gives, once.
//
// The route, in the order checked (the closure matrix its tests hold, toolkit-copies-carry.test.cjs):
//   none      nothing to land: not governed, the Toolkit itself, or no open refresh pull request;
//   hold      try again at a later turn: the merged binding was not read in the last 24 hours, or a
//             GitHub read, the pull request's head or the named Toolkit commit cannot be read here;
//   owner     the owner's typed merge, with the reason: task auto-merge is off, the repository's
//             TOOLKIT_REF pins it to one Toolkit commit, or the copy proof fails (a byte differs, a
//             path a refresh does not write, a Toolkit commit not on main, the owner's settings);
//   wait      a required check is still running: land at a later turn, nothing to ask;
//   attention a required check failed or never ran: the controller finds out why (a copy that breaks
//             CI needs a person) and tells the owner only if it cannot route it;
//   land      every condition holds: run `gh pr merge N --merge --match-head-commit <full head>` from
//             the repository's folder, then post the notice.
// The owner's `hold N` and "no other merge running" stay the controller's to check (gate rules, Task
// auto-merge); a G2 verdict is not needed, since the copy proof stands in for it (a scripted carry).
//
// Exit codes: 0 land, 1 any other route (one line says why), 2 bad arguments.

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SHA = /^[0-9a-f]{40}$/;
const PASSED = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
const FAILED = new Set(['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE', 'ERROR']);

function fetchBranches(root, branches) {
  const result = spawnSync('git', ['fetch', '--quiet', '--no-tags', 'origin', ...branches.map(branch => `+refs/heads/${branch}:refs/remotes/origin/${branch}`)], { cwd: root, encoding: 'utf8', windowsHide: true, shell: false, timeout: 120000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  return !result.error && result.status === 0;
}

// Each required check's state at a commit from its check runs and commit statuses (newest first):
// 'passed', 'failed', 'running' or 'missing'.
function checkStates(required, runs, statuses) {
  const out = {};
  for (const name of required) {
    const run = runs.filter(entry => entry.name === name).sort((a, b) => Number(b.id || 0) - Number(a.id || 0))[0];
    const status = statuses.find(entry => entry.context === name);
    if (run) {
      const state = String(run.status || '').toUpperCase();
      const conclusion = String(run.conclusion || '').toUpperCase();
      out[name] = state !== 'COMPLETED' ? 'running' : PASSED.has(conclusion) ? 'passed' : FAILED.has(conclusion) ? 'failed' : 'failed';
    } else if (status) {
      const state = String(status.state || '').toUpperCase();
      out[name] = state === 'SUCCESS' ? 'passed' : state === 'PENDING' ? 'running' : 'failed';
    } else out[name] = 'missing';
  }
  return out;
}

class RefreshLanding {
  #root;
  #github;
  #registryOptions;
  #proof;
  #fetchBranches;
  #refresh;

  // `github(endpoint, { missing })` reads GitHub with the person's own login; `registryOptions` say
  // where this computer's governance reads are (the repository's state, its task auto-merge answer and
  // its merged binding's required checks); `proof(root)` gives a copy proof (toolkit-copies-proof.cjs);
  // `fetch` (called with the root and branch names) fetches origin's branches into their remote-tracking refs.
  constructor({ root, registryOptions = {}, github = null, proof = null, fetch = fetchBranches }) {
    this.#root = root;
    this.#registryOptions = registryOptions;
    this.#refresh = require('./toolkit-cloud-workflows-refresh.cjs');
    this.#github = github || this.#refresh.ghApi;
    const state = require('./toolkit-governance-state.cjs');
    this.#proof = proof || (target => new (require('./toolkit-copies-proof.cjs').RefreshProof)({ root: target, governance: folder => state.governanceState(folder, registryOptions) }));
    this.#fetchBranches = fetch;
  }

  // { route, line, pr?, head?, merge?, notice? }.
  decide() {
    const done = (route, line, extra = {}) => ({ route, line, ...extra });
    const workflows = require('./toolkit-cloud-workflows.cjs');
    if (workflows.isToolkitCheckout(this.#root)) return done('none', 'This is the Toolkit repository, which runs its own files; there is no refresh to land.');
    let state;
    const reads = require('./toolkit-governance-state.cjs');
    try { state = reads.governanceState(this.#root, this.#registryOptions); } catch { state = null; }
    if (!state || state.state === 'UNAVAILABLE') return done('hold', 'Governance could not be checked here; try again at a later turn.');
    if (state.state !== 'ENABLED') return done('none', 'This repository is not governed, so it carries no Toolkit copies to land.');
    if (state.governed_effects_hold || state.notes?.includes('could-not-check-governance')) return done('hold', 'The merged programme binding was not read in the last 24 hours; run toolkit-governance.cjs status online, then try again.');
    const repository = state.repository;
    const branch = state.merged?.default_branch;
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(repository || '')) || !/^[A-Za-z0-9_][A-Za-z0-9._/-]{0,199}$/.test(String(branch || ''))) return done('hold', 'The repository or its default branch could not be read here; run toolkit-governance.cjs status online, then try again.');
    let open, pin, checks, statuses;
    try {
      open = (this.#github(`repos/${repository}/pulls?state=open&head=${encodeURIComponent(`${repository.split('/')[0]}:${this.#refresh.BRANCH}`)}&per_page=10`) || [])
        .filter(pr => pr.head?.ref === this.#refresh.BRANCH && pr.base?.ref === branch && pr.head?.repo?.full_name?.toLowerCase() === repository.toLowerCase());
    } catch { return done('hold', 'GitHub could not be read; try again at a later turn.'); }
    if (!open.length) return done('none', `${repository} has no open Toolkit refresh pull request.`);
    const pr = open[0];
    const head = pr.head?.sha;
    if (!SHA.test(String(head || ''))) return done('hold', `Pull request #${pr.number}'s head could not be read; try again at a later turn.`);
    const facts = { pr: pr.number, head };
    const answer = reads.taskAutoMerge(this.#root, this.#registryOptions);
    if (answer?.auto_merge !== 'after-gates' || answer?.fresh !== true) return done('owner', `Task auto-merge is off for ${repository}, so refresh pull request #${pr.number} waits for the owner's typed merge.`, facts);
    try { pin = this.#github(`repos/${repository}/actions/variables/TOOLKIT_REF`, { missing: true }); } catch { return done('hold', 'The repository\'s TOOLKIT_REF variable could not be read; try again at a later turn.', facts); }
    if (pin) return done('owner', `${repository} holds its Toolkit copies on one Toolkit commit (its TOOLKIT_REF variable is set), so refresh pull request #${pr.number} waits for the owner's typed merge.`, facts);
    if (!this.#fetchBranches(this.#root, [branch, this.#refresh.BRANCH])) return done('hold', `The pull request's head and ${branch} could not be fetched here; try again at a later turn.`, facts);
    const base = spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}^{commit}`], { cwd: this.#root, encoding: 'utf8', windowsHide: true }).stdout?.trim();
    if (!SHA.test(String(base || ''))) return done('hold', `${branch} could not be read here after the fetch; try again at a later turn.`, facts);
    const proof = this.#proof(this.#root).prove(base, head);
    if (!proof.proved) return done(proof.hold ? 'hold' : 'owner', `Refresh pull request #${pr.number} is not proved, so it ${proof.hold ? 'waits for a later turn' : 'waits for the owner\'s typed merge'}: ${proof.reason}.`, facts);
    const required = this.#requiredChecks();
    if (!required) return done('hold', 'The merged binding\'s required checks could not be read here; try again at a later turn.', facts);
    try {
      checks = (this.#github(`repos/${repository}/commits/${head}/check-runs?per_page=100`) || {}).check_runs || [];
      statuses = (this.#github(`repos/${repository}/commits/${head}/status`) || {}).statuses || [];
    } catch { return done('hold', 'The pull request\'s checks could not be read; try again at a later turn.', facts); }
    const states = checkStates(required, checks, statuses);
    const failed = required.filter(name => states[name] === 'failed' || states[name] === 'missing');
    if (failed.length) return done('attention', `Refresh pull request #${pr.number}: ${failed.map(name => `${name} ${states[name] === 'missing' ? 'never ran' : 'failed'}`).join(', ')} at ${head.slice(0, 7)}. Controller: find out why (gh pr checks ${pr.number}); a Toolkit copy that breaks this repository's CI needs a person, so tell the owner only if you cannot route it.`, facts);
    const running = required.filter(name => states[name] === 'running');
    if (running.length) return done('wait', `Refresh pull request #${pr.number} is proved; ${running.join(', ')} ${running.length === 1 ? 'is' : 'are'} still running at ${head.slice(0, 7)}. Land it at a later turn once green; nothing to ask.`, facts);
    const merge = `gh pr merge ${pr.number} --merge --match-head-commit ${head}`;
    const short = proof.commit.slice(0, 7);
    return done('land', `Refresh pull request #${pr.number} is proved (every file is Toolkit commit ${short}'s render, on Toolkit main) and green at ${head.slice(0, 7)}. Unless the owner said hold ${pr.number} or another merge is running here, run from this repository's folder: ${merge}`, {
      ...facts, merge, commit: proof.commit, files: proof.files,
      notice: `Landed ${repository}#${pr.number}: its Toolkit copies (${proof.files.join(', ')}) now match Toolkit main at ${short}, under this repository's task auto-merge. To undo it, revert that merge in a pull request; to hold this repository on one Toolkit commit, set its TOOLKIT_REF variable; to stop automatic landings, merge an Off switch (refresh governance).`,
    });
  }

  #requiredChecks() {
    try { return require('./toolkit-governance-state.cjs').mergedBinding(this.#root, this.#registryOptions)?.required_checks || null; } catch { return null; }
  }
}

// Runs the decision for `--land-refresh`: { code, line, result }.
function landRefresh({ repo, ...dependencies }) {
  const result = new RefreshLanding({ root: path.resolve(repo), ...dependencies }).decide();
  const lines = [result.line, ...(result.notice ? [`After the merge, tell the owner once: ${result.notice}`] : [])];
  return { code: result.route === 'land' ? 0 : 1, line: lines.join('\n'), result };
}

module.exports = Object.freeze({ RefreshLanding, checkStates, landRefresh });
