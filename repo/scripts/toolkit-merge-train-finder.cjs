'use strict';

// Merge train finder: picks the open pull requests that are ready to board a train, so no agent has
// to count them by hand. It only reads: it never pushes, merges, comments or writes to GitHub, and
// writes one manifest file that `toolkit-merge-train.cjs build` takes as it is.
//
//   node repo/scripts/toolkit-merge-train.cjs find --out <manifest> [--pr <n,n,...>] [--live <file>] [--json]
//
// --pr names the pull requests to consider (the owner-approved members): only those are judged,
// with every check below, and the ready ones are written, oldest first up to the cap; a named one
// that is not ready, or not open here, is listed with its reason and left out. Without it, every open
// pull request is judged and the oldest ready ones board.
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
//   - or, with no PASS for the head, a scripted review carry (toolkit-review-carry.cjs) stands in: a
//     FAIL whose `Carry: body-only uat=<state>` line says only the body failed, with the fixed body's
//     UAT kept or made stricter; the shard-timing bot's manifest-only refresh; or a change to sync
//     outputs only. A carried pull request's title and body must pass the personal-data guard, and a
//     G2 stamp at the wording effort counts only when every changed file is a LIGHT `.md` file;
//   - every required check the merged binding lists has a successful latest run;
//   - its body has exactly one `Bump:` line and a `UAT:` line the auto-merge check accepts;
//   - it carries no version bump of its own and no open train pull request holds it.
// The manifest takes at most the train's cap (six), oldest pull request first, with the head from
// the verdict and the higher of the verdict's tier and the tier the repository's risk-tier list
// (toolkit-risk-tier.cjs) gives the changed files, so a verdict can never lower a tier; then the
// bump level, UAT line, closing lines and any `Pack changes` lines from the body. It never fills
// `owner_ok`, so a RISKY member keeps the owner's merge card.
// Trains stack by default: when a train pull request is open (its body holds the merge-train member
// table), the manifest gets `onto: { pr, branch, head }` for the newest train at the end of a chain
// (one no other open train is stacked on), and build stacks the members onto that head, so one bump
// and one owner ask cover them all; one ready pull request then stacks too. With no open train and
// fewer than two ready, it writes nothing and says to merge the one alone.
//
// --live reads every GitHub fact from a JSON file instead of `gh api` (REST):
//   { "default_branch": "main",
//     "pulls": [ { "number": 12, "draft": false, "base": { "ref": "main" }, "head": { "sha": "<sha>" }, "body": "..." } ],
//     "comments": { "12": [ { "body": "...", "author_association": "OWNER", "created_at": "<ISO>", "html_url": "..." } ] },
//     "checks": { "<sha>": [ { "name": "validate", "status": "completed", "conclusion": "success", "id": 1 } ] },
//     "files": { "12": ["path/a.txt"] },
//     "merge_bases": { "main...<sha>": "<sha>" }, "contents": { "<sha>:<path>": "<text>" } }

const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const governance = require('./toolkit-governance-state.cjs');
const { uatVerdict } = require('./toolkit-auto-merge-eligible.cjs');
const riskTier = require('./toolkit-risk-tier.cjs');
const gateRoute = require('./toolkit-gate-route.cjs');
const carry = require('./toolkit-review-carry.cjs');
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
  mergeBase(base, head) {
    const result = spawnSync('gh', ['api', `repos/${this.repository}/compare/${base}...${head}`, '--jq', '.merge_base_commit.sha'], { encoding: 'utf8', windowsHide: true });
    if (result.error || result.status !== 0) throw new Error(`could not compare ${base}...${head}`);
    return result.stdout.trim();
  }
  // A file's text at a commit, or null when it is not there.
  text(ref, file) {
    const result = spawnSync('gh', ['api', '-H', 'Accept: application/vnd.github.raw+json', `repos/${this.repository}/contents/${file.split('/').map(encodeURIComponent).join('/')}?ref=${ref}`], { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    if (result.error) throw new Error(`could not read ${file} at ${ref}: ${result.error.message}`);
    if (result.status !== 0) {
      if (/HTTP 404/.test(result.stderr || '')) return null;
      throw new Error(`could not read ${file} at ${ref}: ${(result.stderr || '').trim()}`);
    }
    return result.stdout;
  }
}

class LiveFacts {
  constructor(file) { this.facts = JSON.parse(fs.readFileSync(file, 'utf8')); }
  defaultBranch() { return this.facts.default_branch || 'main'; }
  pulls() { return this.facts.pulls || []; }
  comments(number) { return (this.facts.comments || {})[String(number)] || []; }
  checks(sha) { return (this.facts.checks || {})[sha] || []; }
  files(number) { return (this.facts.files || {})[String(number)] || []; }
  mergeBase(base, head) { return (this.facts.merge_bases || {})[`${base}...${head}`] || base; }
  text(ref, file) { const value = (this.facts.contents || {})[`${ref}:${file}`]; return typeof value === 'string' ? value : null; }
}

// The newest verdict comment for `head` from an account that can write here, or null.
function verdictFor(comments, head) {
  const found = comments
    .filter(comment => WRITERS.includes(comment.author_association))
    .map(comment => ({ comment, lines: String(comment.body || '').split(/\r?\n/) }))
    .map(({ comment, lines }) => ({ comment, route: lines[1] ?? null, carry: carry.carryFloor(lines.slice(2)), match: VERDICT.exec(lines[0]) }))
    .filter(entry => entry.match && entry.match[2] === head)
    // An edited verdict counts from its edit.
    .sort((a, b) => Date.parse(a.comment.updated_at || a.comment.created_at) - Date.parse(b.comment.updated_at || b.comment.created_at));
  const last = found[found.length - 1];
  return last ? { verdict: last.match[1], tier: last.match[3], route: last.route, carry: last.carry, link: last.comment.html_url || `verdict for ${head}` } : null;
}

// The required checks that have no successful latest run, by name.
function missingChecks(runs, required) {
  return required.filter(name => {
    const latest = runs.filter(run => run.name === name).sort((a, b) => Number(b.id || 0) - Number(a.id || 0))[0];
    return !latest || latest.status !== 'completed' || latest.conclusion !== 'success';
  });
}

// The body lines that end a Pack changes section even with no heading between: member bodies put
// their UAT, Bump, closing and route lines and the programme-state block straight after it.
const PACK_END = /^(?:#{1,6} |UAT:|Agent UAT:|Bump:|Route:|Tier:|(?:Refs|Closes|Fixes|Resolves) |<!--)/;

// The `Pack changes` lines under that heading, up to the next heading or body line that ends it.
function packChanges(body) {
  const lines = String(body || '').split(/\r?\n/);
  const start = lines.findIndex(line => /^#{2,3} Pack changes\s*$/.test(line));
  if (start < 0) return [];
  const out = [];
  for (const line of lines.slice(start + 1)) {
    if (PACK_END.test(line.trim())) break;
    if (line.trim()) out.push(line.trim());
  }
  return out;
}

// Why the route stamps keep the pull request off a train, or null. The G2 stamp is the verdict's
// second line; the G1 stamp is the body's one `Route:` stamp line.
// A scripted carry (shard-timings, generated-sync) had no G2, so only an off-pin G1 stamp counts
// against it; a wording-only pull request's G2 may stamp the wording effort.
function routeProblem(verdict, body, tier, registry, { scripted = false, wording = false } = {}) {
  const lines = gateRoute.stampLines(body);
  if (lines.length > 1) return `its body has ${lines.length} route stamp lines; the G1 builder's one stays`;
  const g1 = gateRoute.stampStatus(lines[0] ?? null, 'BUILDER', registry);
  if (scripted) return g1.status === 'off-pin' ? `its G1 route stamp is off the stack-registry pin: ${g1.stamp}` : null;
  const stamps = [['G2', gateRoute.stampStatus(verdict.route, 'reviewer', registry, wording ? { effort: carry.WORDING_EFFORT } : {})], ['G1', g1]];
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
  if (verdict && verdict.verdict !== 'PASS' && !verdict.carry) return { skip: `its newest verdict for ${head.slice(0, 12)} is FAIL` };
  const missing = missingChecks(facts.checks(head), required);
  if (missing.length) return { skip: `required checks not green: ${missing.join(', ')}` };
  const body = String(pull.body || '');
  const bumps = [...body.matchAll(BUMP)];
  if (bumps.length !== 1) return { skip: `needs exactly one Bump: line (has ${bumps.length})` };
  const uat = UAT.exec(body);
  const uatState = uatVerdict(body);
  if (!uat || !uatState.mergeable) {
    const why = uatState.state === 'absent' ? 'missing' : `invalid${uatState.problem ? `: ${uatState.problem}` : ''}`;
    return { skip: `no UAT: line the auto-merge check accepts (${why})` };
  }
  const files = facts.files(pull.number);
  if (files.includes(VERSION_FILE)) return { skip: 'carries its own version bump: it lands alone' };
  const byFiles = riskTier.classify(files.map(file => ({ path: file })), tiers).tier;
  const review = reviewFor(pull, facts, verdict, files, uatState.state, byFiles, tiers);
  if (review.skip) return review;
  const route = routeProblem(review.verdict, body, review.tier, registry, review.route);
  if (route) return { skip: route };
  const links = body.split(/\r?\n/).map(line => line.trim()).filter(line => LINK.test(line));
  const pack = packChanges(body);
  return { member: { pr: pull.number, head, g2: review.g2, tier: review.tier, bump: bumps[0][1], uat: uat[0].trim(), links, ...(pack.length ? { pack_changes: pack } : {}) } };
}

const higher = (a, b) => (TIERS.indexOf(a) > TIERS.indexOf(b) ? a : b);

// What stands for the review at the head: a G2 PASS, a body-only FAIL carried forward, or a scripted
// carry (toolkit-review-carry.cjs) when no verdict names the head. { verdict, tier, g2, route } or
// { skip }. A carried pull request also needs a title and body the personal-data guard passes.
function reviewFor(pull, facts, verdict, files, uatState, byFiles, tiers) {
  const head = pull.head.sha;
  const wording = carry.wordingOnly(files, tiers);
  if (verdict && verdict.verdict === 'PASS') return { verdict, tier: higher(byFiles, verdict.tier), g2: verdict.link, route: { wording } };
  const text = carry.textProblem(pull.title, pull.body);
  if (verdict) {
    // A FAIL whose Carry line says only the description failed, at the head it reviewed.
    if (!carry.uatKept(verdict.carry, uatState)) return { skip: `its body-only FAIL named UAT ${verdict.carry}; the body now says ${uatState}, which needs a fresh G2` };
    if (text) return { skip: text };
    return { verdict, tier: higher(byFiles, verdict.tier), g2: `body-only FAIL carried forward: ${verdict.link}`, route: {} };
  }
  const none = `no review verdict comment for its head ${String(head).slice(0, 12)}`;
  const base = () => facts.mergeBase(pull.base.ref, head);
  const read = (ref, file) => facts.text(ref, file);
  const isShard = String(pull.head && pull.head.ref).startsWith(carry.SHARD_BRANCH);
  const isSync = files.length > 0 && files.every(file => carry.OUTPUTS.has(file));
  if (!isShard && !isSync) return { skip: none };
  const problem = isShard ? carry.shardRefreshProblem(pull, files, read, base()) : carry.generatedSyncProblem(pull, files, read, base());
  if (problem) return { skip: `${none}, and no scripted carry: ${problem}` };
  if (text) return { skip: text };
  return { verdict: null, tier: byFiles, g2: `scripted carry (${isShard ? 'shard-timings' : 'generated-sync'}), no G2`, route: { scripted: true } };
}

// The open train pull requests: { pr, branch, base, head }, oldest first. A train is a pull request
// from this repository (its head repository is `repository`) whose body holds the merge-train member
// table; a fork's pull request with such a body is not a train here.
function openTrains(pulls, repository) {
  const here = String(repository || '').toLowerCase();
  return pulls.filter(pull => here && String(pull.head && pull.head.repo && pull.head.repo.full_name || '').toLowerCase() === here && mergeTrainMembers(pull.body))
    .map(pull => ({ pr: pull.number, branch: pull.head && pull.head.ref, base: pull.base && pull.base.ref, head: pull.head && pull.head.sha }))
    .sort((a, b) => a.pr - b.pr);
}

// The trains reached by stacking on `branch`, directly or through other stacked trains.
function stackedOn(trains, branch) {
  const reached = new Set([branch]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const entry of trains) {
      if (entry.branch && !reached.has(entry.branch) && reached.has(entry.base)) { reached.add(entry.branch); grew = true; }
    }
  }
  reached.delete(branch);
  return trains.filter(entry => reached.has(entry.branch));
}

// The train new members stack onto: the newest open train no other open train is stacked on, and
// the other chain ends, if any. { tip: null } when no train is open.
function stackTip(trains) {
  const bases = new Set(trains.map(entry => entry.base));
  const ends = trains.filter(entry => !bases.has(entry.branch));
  const tip = ends.length ? ends[ends.length - 1] : (trains[trains.length - 1] || null);
  return { tip, others: ends.filter(entry => entry !== tip) };
}

// Open trains read from GitHub (or a --live file in find's format): for build's open-train check.
function readOpenTrains(cwd, repository, liveFile) {
  const slug = repository || governance.remoteSlug(governance.readIdentity(cwd).remote);
  const facts = liveFile ? new LiveFacts(liveFile) : new GitHubFacts(slug);
  return openTrains(facts.pulls(), slug);
}

const PLAIN_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const SHA40 = /^[0-9a-f]{40}$/;

// `maxMembers` is the train's own cap (toolkit-merge-train.cjs).
function find(cwd, options, maxMembers) {
  const repository = governance.remoteSlug(governance.readIdentity(cwd).remote);
  if (!repository) throw new Error('this folder has no github.com repository');
  const binding = governance.mergedBinding(cwd, options.registryOptions || {});
  const required = binding ? [...binding.required_checks] : [];
  const facts = options.live ? new LiveFacts(options.live) : new GitHubFacts(repository);
  const branch = facts.defaultBranch();
  const pulls = facts.pulls().slice().sort((a, b) => a.number - b.number);
  const trains = openTrains(pulls, repository);
  const held = new Set(pulls.filter(pull => trains.some(entry => entry.pr === pull.number)).flatMap(pull => mergeTrainMembers(pull.body)));
  const { tip, others } = stackTip(trains);
  if (tip && (!PLAIN_REF.test(tip.branch || '') || tip.branch.includes('..') || !SHA40.test(tip.head || ''))) {
    throw new Error(`open train #${tip.pr} has no readable head branch and SHA, so nothing can stack onto it; read it again`);
  }
  const tiers = riskTier.loadConfig(governance.findGitRoot(cwd)).config;
  const registry = gateRoute.loadRegistry();
  const ready = [];
  const skipped = [];
  const named = options.prs ? new Set(options.prs) : null;
  for (const pull of pulls) {
    if (named && !named.has(pull.number)) continue; // only the named pull requests are judged
    if (mergeTrainMembers(pull.body)) { if (named) skipped.push(`#${pull.number}: a train pull request, not a member`); continue; }
    const outcome = judge(pull, facts, { required, branch, held, tiers, registry });
    if (outcome.member) ready.push(outcome.member);
    else skipped.push(`#${pull.number}: ${outcome.skip}`);
  }
  for (const number of named ? [...named].sort((a, b) => a - b) : []) {
    if (!pulls.some(pull => pull.number === number)) skipped.push(`#${number}: not an open pull request here`);
  }
  const members = ready.slice(0, maxMembers);
  const later = ready.slice(maxMembers).map(member => `#${member.pr}`);
  if (!members.length || (members.length < 2 && !tip)) {
    return { ok: true, written: false, ready: members.map(member => `#${member.pr}`), skipped,
      next: members.length ? [`merge #${members[0].pr} alone: one ready pull request makes no train`] : [] };
  }
  if (!options.out) throw new Error('--out is required');
  const onto = tip ? { pr: tip.pr, branch: tip.branch, head: tip.head } : undefined;
  fs.writeFileSync(options.out, `${JSON.stringify({ repository, ...(onto ? { onto } : {}), members }, null, 2)}\n`);
  const next = [];
  if (onto) {
    next.push(`stack ${members.map(member => `#${member.pr}`).join(', ')} onto train #${onto.pr} (${onto.branch} at ${onto.head.slice(0, 12)}): fetch it, then build takes onto from this manifest`);
    if (others.length) next.push(`${others.map(entry => `#${entry.pr}`).join(', ')} ${others.length > 1 ? 'are' : 'is'} also open on a chain of its own: this train stacks onto the newest, #${onto.pr}`);
  }
  if (later.length) next.push(`board the next train with ${later.join(', ')}`);
  return { ok: true, written: true, out: options.out, ready: members.map(member => `#${member.pr}`), skipped,
    ...(onto ? { onto } : {}), next };
}

module.exports = { VERDICT, find, missingChecks, openTrains, packChanges, readOpenTrains, stackTip, stackedOn, verdictFor };
