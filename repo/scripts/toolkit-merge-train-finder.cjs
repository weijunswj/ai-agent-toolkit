'use strict';

// Merge train finder: picks the open pull requests that are ready to board a train, so no agent has
// to count them by hand. It only reads: it never pushes, merges, comments or writes to GitHub, and
// writes one manifest file that `toolkit-merge-train.cjs build` takes as it is.
//
//   node repo/scripts/toolkit-merge-train.cjs find --out <manifest> [--live <file>] [--json]
//
// Ready means, at the pull request's current head:
//   - it is open, not a draft, and based on the default branch;
//   - the newest review verdict comment for that head says PASS. A verdict is a pull request comment
//     whose first line is exactly `Toolkit-G2: PASS <40-hex head> tier=LIGHT|NORMAL|RISKY` (or FAIL),
//     written by an account that can write to the repository (author association OWNER, MEMBER or
//     COLLABORATOR); every other comment is ignored;
//   - its route stamps hold (toolkit-gate-route.cjs): the verdict's second line and the body's one
//     `Route:` stamp line (the G1 builder's) are on their stack-registry pin, or carry an owner
//     override; an off-pin stamp never boards, and a RISKY pull request also needs both stamps
//     host-verified or launcher-attested, never missing or UNVERIFIED;
//   - every required check the merged binding lists has a successful latest run;
//   - its body has exactly one `Bump:` line and a `UAT:` line the auto-merge check accepts;
//   - it carries no version bump of its own and no open train pull request holds it.
// The manifest takes at most the train's cap (six), oldest pull request first, with the head from
// the verdict and the higher of the verdict's tier and the tier the repository's risk-tier list
// (toolkit-risk-tier.cjs) gives the changed files, so a verdict can never lower a tier; then the
// bump level, UAT line, closing lines and any `Pack changes` lines from the body. It never fills
// `owner_ok`, so a RISKY member keeps the owner's merge card. With fewer than two ready, it writes
// nothing and says to merge the one alone.
//
// --live reads every GitHub fact from a JSON file instead of `gh api` (REST):
//   { "default_branch": "main",
//     "pulls": [ { "number": 12, "draft": false, "base": { "ref": "main" }, "head": { "sha": "<sha>" }, "body": "..." } ],
//     "comments": { "12": [ { "body": "...", "author_association": "OWNER", "created_at": "<ISO>", "html_url": "..." } ] },
//     "checks": { "<sha>": [ { "name": "validate", "status": "completed", "conclusion": "success", "id": 1 } ] },
//     "files": { "12": ["path/a.txt"] } }

const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const governance = require('./toolkit-governance-state.cjs');
const { uatVerdict } = require('./toolkit-auto-merge-eligible.cjs');
const riskTier = require('./toolkit-risk-tier.cjs');
const gateRoute = require('./toolkit-gate-route.cjs');
const { mergeTrainMembers } = require('../../skills/github-program-reconciler/scripts/issue-closure.cjs');

const VERDICT = /^Toolkit-G2: (PASS|FAIL) ([0-9a-f]{40}) tier=(LIGHT|NORMAL|RISKY)[ \t]*$/;
const WRITERS = Object.freeze(['OWNER', 'MEMBER', 'COLLABORATOR']);
const BUMP = /^Bump: (patch|minor|major|none)[ \t]*$/gm;
const UAT = /^UAT: (?:NOT_REQUIRED|OWNER_TEST_NEEDED|PASSED)\b[^\r\n]*$/m;
const LINK = /^(?:Closes|Fixes|Resolves|Refs) #\d+$/;
// A pull request that changes this file carries its own release bump; it lands alone.
const VERSION_FILE = 'repo/contracts/toolkit-local-bridge/version.json';
const TIERS = Object.freeze(['LIGHT', 'NORMAL', 'RISKY']);

class GitHubFacts {
  constructor(repository) { this.repository = repository; }
  #api(endpoint) {
    const result = spawnSync('gh', ['api', '--paginate', '--jq', '.[]?', endpoint], { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    if (result.error || result.status !== 0) throw new Error(`could not read ${endpoint}: ${result.error ? result.error.message : (result.stderr || '').trim()}`);
    return result.stdout.split('\n').filter(Boolean).map(line => JSON.parse(line));
  }
  defaultBranch() {
    const result = spawnSync('gh', ['api', `repos/${this.repository}`, '--jq', '.default_branch'], { encoding: 'utf8', windowsHide: true });
    if (result.error || result.status !== 0) throw new Error(`could not read ${this.repository}`);
    return result.stdout.trim();
  }
  pulls() { return this.#api(`repos/${this.repository}/pulls?state=open&per_page=100`); }
  comments(number) { return this.#api(`repos/${this.repository}/issues/${number}/comments?per_page=100`); }
  checks(sha) {
    const result = spawnSync('gh', ['api', '--paginate', '--jq', '.check_runs[]', `repos/${this.repository}/commits/${sha}/check-runs?per_page=100`], { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    if (result.error || result.status !== 0) throw new Error(`could not read the checks of ${sha}`);
    return result.stdout.split('\n').filter(Boolean).map(line => JSON.parse(line));
  }
  files(number) { return this.#api(`repos/${this.repository}/pulls/${number}/files?per_page=100`).map(file => file.filename); }
}

class LiveFacts {
  constructor(file) { this.facts = JSON.parse(fs.readFileSync(file, 'utf8')); }
  defaultBranch() { return this.facts.default_branch || 'main'; }
  pulls() { return this.facts.pulls || []; }
  comments(number) { return (this.facts.comments || {})[String(number)] || []; }
  checks(sha) { return (this.facts.checks || {})[sha] || []; }
  files(number) { return (this.facts.files || {})[String(number)] || []; }
}

// The newest verdict comment for `head` from an account that can write here, or null.
function verdictFor(comments, head) {
  const found = comments
    .filter(comment => WRITERS.includes(comment.author_association))
    .map(comment => ({ comment, lines: String(comment.body || '').split(/\r?\n/, 2) }))
    .map(({ comment, lines }) => ({ comment, route: lines[1] ?? null, match: VERDICT.exec(lines[0]) }))
    .filter(entry => entry.match && entry.match[2] === head)
    // An edited verdict counts from its edit.
    .sort((a, b) => Date.parse(a.comment.updated_at || a.comment.created_at) - Date.parse(b.comment.updated_at || b.comment.created_at));
  const last = found[found.length - 1];
  return last ? { verdict: last.match[1], tier: last.match[3], route: last.route, link: last.comment.html_url || `verdict for ${head}` } : null;
}

// The required checks that have no successful latest run, by name.
function missingChecks(runs, required) {
  return required.filter(name => {
    const latest = runs.filter(run => run.name === name).sort((a, b) => Number(b.id || 0) - Number(a.id || 0))[0];
    return !latest || latest.status !== 'completed' || latest.conclusion !== 'success';
  });
}

// The `Pack changes` lines under that heading, up to the next heading.
function packChanges(body) {
  const lines = String(body || '').split(/\r?\n/);
  const start = lines.findIndex(line => /^#{2,3} Pack changes\s*$/.test(line));
  if (start < 0) return [];
  const out = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6} /.test(line)) break;
    if (line.trim()) out.push(line.trim());
  }
  return out;
}

// Why the route stamps keep the pull request off a train, or null. The G2 stamp is the verdict's
// second line; the G1 stamp is the body's one `Route:` stamp line.
function routeProblem(verdict, body, tier, registry) {
  const lines = gateRoute.stampLines(body);
  if (lines.length > 1) return `its body has ${lines.length} route stamp lines; the G1 builder's one stays`;
  const stamps = [['G2', gateRoute.stampStatus(verdict.route, 'reviewer', registry)], ['G1', gateRoute.stampStatus(lines[0] ?? null, 'BUILDER', registry)]];
  for (const [gate, stamp] of stamps) {
    if (stamp.status === 'off-pin') return `its ${gate} route stamp is off the stack-registry pin: ${stamp.stamp}`;
    if (tier === 'RISKY' && stamp.status !== 'on-pin') return `a RISKY pull request needs a verified or launcher-attested ${gate} route stamp (${stamp.status})`;
  }
  return null;
}

// Why the pull request cannot board, or a manifest member.
function judge(pull, facts, { required, branch, held, tiers, registry }) {
  const head = pull.head && pull.head.sha;
  if (pull.draft) return { skip: 'a draft' };
  if (!pull.base || pull.base.ref !== branch) return { skip: `based on ${pull.base && pull.base.ref}, not ${branch}` };
  if (held.has(pull.number)) return { skip: 'already on an open train' };
  const verdict = verdictFor(facts.comments(pull.number), head);
  if (!verdict) return { skip: `no review verdict comment for its head ${String(head).slice(0, 12)}` };
  if (verdict.verdict !== 'PASS') return { skip: `its newest verdict for ${head.slice(0, 12)} is FAIL` };
  const missing = missingChecks(facts.checks(head), required);
  if (missing.length) return { skip: `required checks not green: ${missing.join(', ')}` };
  const body = String(pull.body || '');
  const bumps = [...body.matchAll(BUMP)];
  if (bumps.length !== 1) return { skip: `needs exactly one Bump: line (has ${bumps.length})` };
  const uat = UAT.exec(body);
  if (!uat || !uatVerdict(body).mergeable) return { skip: 'no UAT: line the auto-merge check accepts' };
  const files = facts.files(pull.number);
  if (files.includes(VERSION_FILE)) return { skip: 'carries its own version bump: it lands alone' };
  const byFiles = riskTier.classify(files.map(file => ({ path: file })), tiers).tier;
  const tier = TIERS.indexOf(byFiles) > TIERS.indexOf(verdict.tier) ? byFiles : verdict.tier;
  const route = routeProblem(verdict, body, tier, registry);
  if (route) return { skip: route };
  const links = body.split(/\r?\n/).map(line => line.trim()).filter(line => LINK.test(line));
  const pack = packChanges(body);
  return { member: { pr: pull.number, head, g2: verdict.link, tier, bump: bumps[0][1], uat: uat[0].trim(), links, ...(pack.length ? { pack_changes: pack } : {}) } };
}

// `maxMembers` is the train's own cap (toolkit-merge-train.cjs).
function find(cwd, options, maxMembers) {
  const repository = governance.remoteSlug(governance.readIdentity(cwd).remote);
  if (!repository) throw new Error('this folder has no github.com repository');
  const binding = governance.mergedBinding(cwd, options.registryOptions || {});
  const required = binding ? [...binding.required_checks] : [];
  const facts = options.live ? new LiveFacts(options.live) : new GitHubFacts(repository);
  const branch = facts.defaultBranch();
  const pulls = facts.pulls().slice().sort((a, b) => a.number - b.number);
  const held = new Set(pulls.flatMap(pull => mergeTrainMembers(pull.body) || []));
  const tiers = riskTier.loadConfig(governance.findGitRoot(cwd)).config;
  const registry = gateRoute.loadRegistry();
  const ready = [];
  const skipped = [];
  for (const pull of pulls) {
    if (mergeTrainMembers(pull.body)) continue; // a train pull request itself
    const outcome = judge(pull, facts, { required, branch, held, tiers, registry });
    if (outcome.member) ready.push(outcome.member);
    else skipped.push(`#${pull.number}: ${outcome.skip}`);
  }
  const members = ready.slice(0, maxMembers);
  const later = ready.slice(maxMembers).map(member => `#${member.pr}`);
  if (members.length < 2) {
    return { ok: true, written: false, ready: members.map(member => `#${member.pr}`), skipped,
      next: members.length ? [`merge #${members[0].pr} alone: one ready pull request makes no train`] : [] };
  }
  if (!options.out) throw new Error('--out is required');
  fs.writeFileSync(options.out, `${JSON.stringify({ repository, members }, null, 2)}\n`);
  return { ok: true, written: true, out: options.out, ready: members.map(member => `#${member.pr}`), skipped,
    next: later.length ? [`board the next train with ${later.join(', ')}`] : [] };
}

module.exports = { VERDICT, find, missingChecks, packChanges, verdictFor };
