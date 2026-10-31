'use strict';

// The no-force-push branch ruleset a Toolkit-governed (ENABLED) GitHub repository must carry:
// an active repository or organisation ruleset that targets branches,
// includes `~ALL` with no exclusions, and has a `non_fast_forward` rule. Only github.com
// repositories can carry one; any other host reports `not-applicable`. A private repository on
// GitHub Free cannot have rulesets at all (GitHub answers 403 "Upgrade to GitHub Pro"): that is
// `not-enforceable`, never `present`, and the local guard is the only protection there.
//
// Read-only. The default reader asks the GitHub REST API through the signed-in `gh` CLI
// (GET /repos/{owner}/{repo}/rulesets, then each ruleset by id); when `gh` is missing, signed out
// or refused, the result is `unverified`, never `present`. Adding the ruleset is a GitHub write
// that only `ghRulesetCreator` makes, and only `toolkit governance migrate` calls it, after the
// owner's typed yes in that run; it needs a local session signed in to GitHub. The same holds for the
// keep-programme-state ruleset below.

const childProcess = require('node:child_process');

const { resolvePathExecutable } = require('./claude-process-launch.cjs');
const governance = require('./toolkit-governance-state.cjs');

const GH_TIMEOUT_MS = 15000;
const MAX_OUTPUT = 1024 * 1024;

// The verdict over fully read rulesets (each as GET /repos/{owner}/{repo}/rulesets/{id} returns it).
function rulesetVerdict(rulesets) {
  const qualifying = (Array.isArray(rulesets) ? rulesets : []).filter(ruleset => ruleset
    && ruleset.enforcement === 'active'
    && ruleset.target === 'branch'
    && ruleset.conditions && ruleset.conditions.ref_name
    && Array.isArray(ruleset.conditions.ref_name.include) && ruleset.conditions.ref_name.include.includes('~ALL')
    && Array.isArray(ruleset.conditions.ref_name.exclude) && ruleset.conditions.ref_name.exclude.length === 0
    && Array.isArray(ruleset.rules) && ruleset.rules.some(rule => rule && rule.type === 'non_fast_forward'));
  if (qualifying.length === 0) return Object.freeze({ status: 'missing', reason: 'no-active-all-branch-non-fast-forward-ruleset', bypass: null });
  // bypass_actors is returned only to callers with write access to the ruleset.
  const bypassKnown = qualifying.every(ruleset => Array.isArray(ruleset.bypass_actors));
  const noBypass = qualifying.some(ruleset => Array.isArray(ruleset.bypass_actors) && ruleset.bypass_actors.length === 0);
  return Object.freeze({ status: 'present', reason: null, bypass: noBypass ? 'none' : bypassKnown ? 'allowed' : 'not-visible' });
}

const RULESET_NAME = 'Toolkit: no force pushes';

// The ruleset Toolkit adds: active, every branch, no exclusions, no bypass, non_fast_forward only.
function noForcePushRulesetBody() {
  return {
    name: RULESET_NAME,
    target: 'branch',
    enforcement: 'active',
    bypass_actors: [],
    conditions: { ref_name: { include: ['~ALL'], exclude: [] } },
    rules: [{ type: 'non_fast_forward' }],
  };
}

function ghJson(args, spawn, input = null) {
  let result;
  try {
    result = spawn(resolvePathExecutable('gh'), ['api', ...args], {
      encoding: 'utf8', timeout: GH_TIMEOUT_MS, maxBuffer: MAX_OUTPUT, windowsHide: true, shell: false,
      ...(input === null ? {} : { input }),
    });
  } catch {
    return { ok: false, reason: 'gh-unavailable' };
  }
  if (!result || result.error) return { ok: false, reason: 'gh-unavailable' };
  if (result.status !== 0) {
    const stderr = String(result.stderr || '') + String(result.stdout || '');
    if (/HTTP 403/.test(stderr) && /upgrade to github pro|make this repository public/i.test(stderr)) return { ok: false, reason: 'plan-has-no-rulesets' };
    return { ok: false, reason: /HTTP 404/.test(stderr) ? 'repository-not-visible' : 'gh-request-failed' };
  }
  try { return { ok: true, value: JSON.parse(result.stdout) }; } catch { return { ok: false, reason: 'gh-output-invalid' }; }
}

// Reads every branch ruleset that applies to `slug` ("owner/name"). { ok, rulesets } or { ok: false, reason }.
function ghRulesetReader(slug, { spawn = childProcess.spawnSync } = {}) {
  const list = ghJson([`repos/${slug}/rulesets?includes_parents=true&targets=branch&per_page=100`], spawn);
  if (!list.ok) return list;
  if (!Array.isArray(list.value)) return { ok: false, reason: 'gh-output-invalid' };
  const rulesets = [];
  for (const entry of list.value) {
    if (!entry || !Number.isInteger(entry.id)) return { ok: false, reason: 'gh-output-invalid' };
    const detail = ghJson([`repos/${slug}/rulesets/${entry.id}`], spawn);
    if (!detail.ok) return detail;
    rulesets.push(detail.value);
  }
  return { ok: true, rulesets };
}

// Creates the ruleset on `slug` ("owner/name"). { ok: true, id } or { ok: false, reason }.
function ghRulesetCreator(slug, { spawn = childProcess.spawnSync } = {}) {
  const created = ghJson(['-X', 'POST', `repos/${slug}/rulesets`, '--input', '-'], spawn, JSON.stringify(noForcePushRulesetBody()));
  if (!created.ok) return created;
  return created.value && Number.isInteger(created.value.id) ? { ok: true, id: created.value.id } : { ok: false, reason: 'gh-output-invalid' };
}

// { status: present | missing | not-enforceable | unverified | not-applicable, reason, bypass } for the repository
// at `root`. `reader(slug)` is injectable for tests.
function noForcePushRuleset(root, { reader = ghRulesetReader } = {}) {
  return readVerdict(root, reader, rulesetVerdict);
}

function readVerdict(root, reader, verdict) {
  let identity;
  try { identity = governance.readIdentity(root); } catch { return Object.freeze({ status: 'unverified', reason: 'identity-unreadable', bypass: null }); }
  const slug = identity.valid ? governance.remoteSlug(identity.remote) : null;
  if (!identity.valid || identity.remote.host !== 'github.com' || !slug) {
    return Object.freeze({ status: 'not-applicable', reason: 'not-a-github-repository', bypass: null });
  }
  let read;
  try { read = reader(slug); } catch { read = { ok: false, reason: 'reader-failed' }; }
  if (read && read.ok === false && read.reason === 'plan-has-no-rulesets') return Object.freeze({ status: 'not-enforceable', reason: 'plan-has-no-rulesets', bypass: null });
  if (!read || read.ok !== true) return Object.freeze({ status: 'unverified', reason: (read && read.reason) || 'reader-failed', bypass: null });
  return verdict(read.rulesets);
}

// The second ruleset, for a repository whose merged binding keeps its programme state on the public
// state branch: nobody, Toolkit included, can delete that branch. Force pushes to it are already
// blocked by the no-force-push ruleset above. Added only by `toolkit governance migrate`, after its
// own typed yes; never on a repository without the state branch in its binding.
const STATE_BRANCH = 'DO-NOT-DELETE-IF-TOOLKIT-GOVERNANCE-IS-ENABLED';
const KEEP_STATE_RULESET_NAME = 'Toolkit: keep programme state';

function keepStateRulesetBody() {
  return {
    name: KEEP_STATE_RULESET_NAME,
    target: 'branch',
    enforcement: 'active',
    bypass_actors: [],
    conditions: { ref_name: { include: [`refs/heads/${STATE_BRANCH}`], exclude: [] } },
    rules: [{ type: 'deletion' }],
  };
}

// present when an active branch ruleset covers the state branch (by name or every branch), excludes
// nothing, has a `deletion` rule and lets nobody bypass it. One whose bypass list is not visible to
// this account is present with bypass `not-visible`; one with bypass actors does not count.
function keepStateVerdict(rulesets) {
  const covering = (Array.isArray(rulesets) ? rulesets : []).filter(ruleset => ruleset
    && ruleset.enforcement === 'active'
    && ruleset.target === 'branch'
    && ruleset.conditions && ruleset.conditions.ref_name
    && Array.isArray(ruleset.conditions.ref_name.include)
    && (ruleset.conditions.ref_name.include.includes(`refs/heads/${STATE_BRANCH}`) || ruleset.conditions.ref_name.include.includes('~ALL'))
    && Array.isArray(ruleset.conditions.ref_name.exclude) && ruleset.conditions.ref_name.exclude.length === 0
    && Array.isArray(ruleset.rules) && ruleset.rules.some(rule => rule && rule.type === 'deletion'));
  if (covering.some(ruleset => Array.isArray(ruleset.bypass_actors) && ruleset.bypass_actors.length === 0)) return Object.freeze({ status: 'present', reason: null, bypass: 'none' });
  if (covering.some(ruleset => !Array.isArray(ruleset.bypass_actors))) return Object.freeze({ status: 'present', reason: null, bypass: 'not-visible' });
  return Object.freeze({ status: 'missing', reason: covering.length ? 'state-branch-deletion-ruleset-allows-bypass' : 'no-active-state-branch-deletion-ruleset', bypass: covering.length ? 'allowed' : null });
}

function keepStateRuleset(root, { reader = ghRulesetReader } = {}) {
  return readVerdict(root, reader, keepStateVerdict);
}

function ghKeepStateRulesetCreator(slug, { spawn = childProcess.spawnSync } = {}) {
  const created = ghJson(['-X', 'POST', `repos/${slug}/rulesets`, '--input', '-'], spawn, JSON.stringify(keepStateRulesetBody()));
  if (!created.ok) return created;
  return created.value && Number.isInteger(created.value.id) ? { ok: true, id: created.value.id } : { ok: false, reason: 'gh-output-invalid' };
}

module.exports = Object.freeze({ RULESET_NAME, rulesetVerdict, noForcePushRulesetBody, ghRulesetReader, ghRulesetCreator, noForcePushRuleset,
  KEEP_STATE_RULESET_NAME, STATE_BRANCH, keepStateRulesetBody, keepStateVerdict, keepStateRuleset, ghKeepStateRulesetCreator });
