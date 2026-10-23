'use strict';

// The no-force-push branch ruleset a Toolkit-governed (ENABLED) GitHub repository must carry
// (#542): an active repository or organisation ruleset that targets branches,
// includes `~ALL` with no exclusions, and has a `non_fast_forward` rule. Only github.com
// repositories can carry one; any other host reports `not-applicable`. A private repository on
// GitHub Free cannot have rulesets at all (GitHub answers 403 "Upgrade to GitHub Pro"): that is
// `not-enforceable`, never `present`, and the local guard is the only protection there.
//
// Read-only. The default reader asks the GitHub REST API through the signed-in `gh` CLI
// (GET /repos/{owner}/{repo}/rulesets, then each ruleset by id); when `gh` is missing, signed out
// or refused, the result is `unverified`, never `present`. Adding the ruleset is a GitHub write
// that the one-time migration offers and the owner approves per run; nothing here writes.

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

function ghJson(args, spawn) {
  let result;
  try {
    result = spawn(resolvePathExecutable('gh'), ['api', ...args], {
      encoding: 'utf8', timeout: GH_TIMEOUT_MS, maxBuffer: MAX_OUTPUT, windowsHide: true, shell: false,
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

// { status: present | missing | not-enforceable | unverified | not-applicable, reason, bypass } for the repository
// at `root`. `reader(slug)` is injectable for tests.
function noForcePushRuleset(root, { reader = ghRulesetReader } = {}) {
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
  return rulesetVerdict(read.rulesets);
}

module.exports = Object.freeze({ rulesetVerdict, ghRulesetReader, noForcePushRuleset });
