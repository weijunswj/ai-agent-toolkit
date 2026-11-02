'use strict';

// Discovery before questions: what Toolkit already finds for a github.com repository before it asks
// the owner anything about GitHub governance, and the one adoption proposal it puts to them.
//
//   1. A valid binding merged on the default branch is reused: no parent or store question at all.
//   2. Otherwise it lists candidates, each with its evidence:
//      - parent issues: issues titled or labelled as a programme parent, and issues with native
//        sub-issues (a closed one with open sub-issues is offered with a note);
//      - other repositories' bindings under the same owner (their stores and conventions);
//      - evidence stores: the owner's repositories named `TRANSPORT-*` or containing this
//        repository's name, or named by another binding. A store is eligible only when GitHub says
//        it is private, owned by the same account, readable, and its root has `archives/` or
//        `state/`. A name or prefix alone selects nothing (A5).
//   3. One strong candidate gives one recommendation to confirm, several give one recommendation with
//      alternatives, none gives a create proposal with concrete defaults, and a failed search says
//      what is unknown.
//   4. The adoption proposal lists what is there and what Toolkit would reuse, add, repair, keep and
//      defer (instructions, CI and checks, rulesets, schedules, deployment notes, monitoring and
//      programme issues), with the version 2 binding draft for the one setup pull request.
//
// Reads only: GitHub through `gh api` GET requests and the repository's working tree. No model
// calls, no writes, no workflow, App, token or schedule (A7). Candidates are only proposals: nothing
// is used until the owner confirms it.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const governance = require('./toolkit-governance-state.cjs');
const { resolvePathExecutable } = require('./claude-process-launch.cjs');

const SCHEMA = 'toolkit.governance-discovery.v1';
const GH_TIMEOUT_MS = 15000;
const MAX_OUTPUT = 8 * 1024 * 1024;
const MAX_BINDING_PEEKS = 20;
const MAX_PAGES = 3;
const PARENT_TITLE = /\b(?:programme|program|parent|roadmap|tracker|epic)\b/i;
const PARENT_LABEL = /^(?:programme|program|parent|epic|roadmap|tracker)(?:[-_ ].*)?$/i;
const STORE_LAYOUT = ['archives', 'state'];

function defaultGh(args) {
  let run;
  try {
    run = spawnSync(resolvePathExecutable('gh'), ['api', '--method', 'GET', ...args], { encoding: 'utf8', timeout: GH_TIMEOUT_MS, maxBuffer: MAX_OUTPUT, windowsHide: true, shell: false });
  } catch { return { ok: false, reason: 'gh-unavailable' }; }
  if (!run || run.error) return { ok: false, reason: 'gh-unavailable' };
  if (run.status !== 0) return { ok: false, reason: /HTTP 404/.test(`${run.stderr}${run.stdout}`) ? 'not-found' : 'gh-request-failed' };
  try { return { ok: true, value: JSON.parse(String(run.stdout || 'null')) }; } catch { return { ok: false, reason: 'gh-output-invalid' }; }
}

function offlineGh() { return { ok: false, reason: 'offline' }; }

function initials(name) {
  const words = String(name).split(/[^A-Za-z0-9]+/).filter(Boolean);
  const short = (words.length > 1 ? words.map(word => word[0]) : [String(name).slice(0, 3)]).join('').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return (short || 'REPO').slice(0, 6);
}

// Parent-issue candidates from the repository's issues (pull requests left out).
function parentCandidates(issues) {
  const out = [];
  for (const issue of Array.isArray(issues) ? issues : []) {
    if (!issue || typeof issue.number !== 'number' || issue.pull_request) continue;
    const summary = issue.sub_issues_summary && typeof issue.sub_issues_summary === 'object' ? issue.sub_issues_summary : null;
    const children = summary && Number.isInteger(summary.total) ? summary.total : 0;
    const openChildren = summary && Number.isInteger(summary.total) && Number.isInteger(summary.completed) ? summary.total - summary.completed : 0;
    const labels = (issue.labels || []).map(label => (typeof label === 'string' ? label : label && label.name)).filter(Boolean);
    const evidence = [];
    if (children > 0) evidence.push(`${children} native sub-issue${children === 1 ? '' : 's'}`);
    if (PARENT_TITLE.test(String(issue.title || ''))) evidence.push('titled as a programme parent');
    if (labels.some(label => PARENT_LABEL.test(label))) evidence.push('labelled as a programme parent');
    if (!evidence.length) continue;
    const open = issue.state === 'open';
    if (!open && openChildren <= 0) continue;
    out.push({
      issue: issue.number,
      title: String(issue.title || ''),
      open,
      evidence,
      note: open ? null : `closed, but ${openChildren} sub-issue${openChildren === 1 ? ' is' : 's are'} still open`,
      strength: (children > 0 ? 2 : 0) + (open ? 1 : 0),
    });
  }
  return out.sort((a, b) => b.strength - a.strength || a.issue - b.issue);
}

// One evidence store judged against A5: { repository, eligible, evidence, rejected }.
function judgeStore(gh, owner, fullName, evidence) {
  const [storeOwner, name] = String(fullName).split('/');
  if (!storeOwner || !name) return { repository: fullName, eligible: false, evidence, rejected: 'not an owner/name repository' };
  if (storeOwner.toLowerCase() !== owner.toLowerCase()) return { repository: fullName, eligible: false, evidence, rejected: 'it sits under another owner' };
  const repo = gh([`repos/${storeOwner}/${name}`]);
  if (!repo.ok || !repo.value) return { repository: fullName, eligible: false, evidence, rejected: repo.reason === 'not-found' ? 'it does not exist or is not readable' : `GitHub could not be read (${repo.reason})` };
  if (repo.value.private !== true) return { repository: fullName, eligible: false, evidence, rejected: 'it is public' };
  if (!repo.value.owner || String(repo.value.owner.login || '').toLowerCase() !== owner.toLowerCase()) return { repository: fullName, eligible: false, evidence, rejected: 'it sits under another owner' };
  const root = gh([`repos/${storeOwner}/${name}/contents/`]);
  if (!root.ok || !Array.isArray(root.value)) return { repository: fullName, eligible: false, evidence, rejected: 'its contents could not be read' };
  const dirs = root.value.filter(entry => entry && entry.type === 'dir').map(entry => entry.name);
  const layout = STORE_LAYOUT.filter(dir => dirs.includes(dir));
  if (!layout.length) return { repository: fullName, eligible: false, evidence, rejected: 'its layout has no archives/ or state/ folder' };
  return { repository: `${storeOwner}/${name}`, eligible: true, evidence: [...evidence, `private, owned by ${owner}, has ${layout.map(dir => `${dir}/`).join(' and ')}`], rejected: null };
}

// Pick one recommendation from ranked candidates: { status: 'one' | 'several' | 'none' | 'unknown', recommended, alternatives }.
function choose(candidates, unknown) {
  if (candidates.length === 1) return { status: 'one', recommended: candidates[0], alternatives: [] };
  if (candidates.length > 1) return { status: 'several', recommended: candidates[0], alternatives: candidates.slice(1) };
  return { status: unknown ? 'unknown' : 'none', recommended: null, alternatives: [] };
}

// The local inventory for the adoption proposal: what the working tree already carries.
function localInventory(root) {
  // By exact name, so a case-insensitive file system does not list one file twice.
  const exists = rel => { try { return fs.readdirSync(path.join(root, path.dirname(rel))).includes(path.basename(rel)); } catch { return false; } };
  const workflows = (() => { try { return fs.readdirSync(path.join(root, '.github', 'workflows')).filter(name => /\.ya?ml$/i.test(name)).sort(); } catch { return []; } })();
  const scheduled = workflows.filter((name) => {
    try { return /^\s*schedule\s*:/m.test(fs.readFileSync(path.join(root, '.github', 'workflows', name), 'utf8')); } catch { return false; }
  });
  const monitoring = workflows.filter(name => /monitor|uptime|health|probe/i.test(name));
  const deployDocs = ['DEPLOY.md', 'DEPLOYMENT.md', 'docs/DEPLOY.md', 'docs/DEPLOYMENT.md', 'docs/deploy.md', 'docs/deployment.md'].filter(exists);
  let agents = null;
  try { agents = governance.readGovernedBlock(root); } catch { agents = null; }
  return {
    agents_md: exists('AGENTS.md'),
    governed_block: Boolean(agents && agents.present),
    governed_block_legacy: Boolean(agents && agents.legacy),
    host_shims: ['CLAUDE.md', 'GEMINI.md', '.github/copilot-instructions.md'].filter(exists),
    workflows, scheduled, monitoring, deploy_docs: deployDocs,
    dependabot: exists('.github/dependabot.yml') || exists('.github/dependabot.yaml'),
  };
}

class GovernanceDiscovery {
  #gh; #registryOptions;

  // `gh` is for tests. Without it, a test registry or TOOLKIT_GOVERNANCE_OFFLINE=1 (set for test runs)
  // reads nothing from GitHub, and every search reports itself as unknown.
  constructor({ gh = null, registryOptions = {}, environment = process.env } = {}) {
    this.#gh = gh || (registryOptions.testOnly === true || environment.TOOLKIT_GOVERNANCE_OFFLINE === '1' ? offlineGh : defaultGh);
    this.#registryOptions = registryOptions;
  }

  discover(cwd) {
    const state = governance.governanceState(cwd, this.#registryOptions);
    const base = { schema: SCHEMA, state: state.state, rule: state.rule };
    if (state.rule === 'R1') return { ...base, status: 'not-applicable', reason: 'not a git repository' };
    if (state.rule === 'R8') return { ...base, status: 'not-applicable', reason: 'not on github.com' };
    if (state.rule === 'M1') return { ...base, status: 'reuse', reason: 'a valid binding is merged on the default branch, so nothing is asked', notes: state.notes };
    if (state.rule === 'M2') return { ...base, status: 'disabled', reason: 'the merged binding sets governance to disabled; only an owner-merged pull request changes it' };
    if (state.rule === 'S1') return { ...base, status: 'not-applicable', reason: 'an evidence store that a programme binding names (agent-managed, not governed)' };
    if (state.rule === 'R1s') return { ...base, status: 'not-applicable', reason: "a scratch clone in another repository's ignored .tmp folder (not governed)" };
    if (state.rule === 'M0') return { ...base, status: 'error', reason: 'the merged binding is invalid; fix it through a pull request first', problems: state.merged.problems };
    const identity = governance.readIdentity(state.root);
    const slug = governance.remoteSlug(identity.remote);
    if (!slug) return { ...base, status: 'not-applicable', reason: 'the origin is not an owner/name repository' };
    const [owner, name] = slug.split('/');
    const unknown = [];

    // Parents.
    const issues = pages(this.#gh, `repos/${owner}/${name}/issues?state=all&sort=updated&direction=desc`);
    if (!issues.ok) unknown.push(`parent issues (${issues.reason})`);
    const parents = choose(issues.ok ? parentCandidates(issues.value) : [], !issues.ok);

    // The owner's repositories, other bindings and store candidates.
    // The signed-in account's own list includes private repositories; another owner's public list does not.
    const repos = pages(this.#gh, 'user/repos?affiliation=owner,organization_member&sort=pushed');
    if (!repos.ok) unknown.push(`the owner's repositories (${repos.reason})`);
    const owned = repos.ok ? repos.value.filter(repo => repo && typeof repo.name === 'string' && repo.owner && String(repo.owner.login || '').toLowerCase() === owner.toLowerCase()) : [];
    const otherBindings = [];
    for (const repo of owned.filter(entry => entry.name.toLowerCase() !== name.toLowerCase() && !entry.fork && !entry.archived).slice(0, MAX_BINDING_PEEKS)) {
      const file = this.#gh([`repos/${owner}/${repo.name}/contents/.github/toolkit-programme.json`]);
      if (!file.ok || !file.value || typeof file.value.content !== 'string') continue;
      let parsed;
      try { parsed = JSON.parse(Buffer.from(file.value.content, 'base64').toString('utf8')); } catch { continue; }
      if (parsed && parsed.store && typeof parsed.store.repository === 'string') {
        otherBindings.push({ repository: `${owner}/${repo.name}`, store: parsed.store.repository, store_path: parsed.store.path || null, record_prefix: parsed.record_prefix || (parsed.parents && parsed.parents[0] && parsed.parents[0].record_prefix) || null });
      }
    }
    const storeEvidence = new Map();
    const addStore = (full, why) => { const key = full.toLowerCase(); if (!storeEvidence.has(key)) storeEvidence.set(key, { full, evidence: [] }); storeEvidence.get(key).evidence.push(why); };
    for (const repo of owned) {
      if (repo.name.toLowerCase() === name.toLowerCase()) continue;
      if (/^TRANSPORT-/i.test(repo.name)) addStore(`${owner}/${repo.name}`, 'named TRANSPORT-*');
      else if (repo.name.toLowerCase().includes(name.toLowerCase())) addStore(`${owner}/${repo.name}`, `name contains ${name}`);
    }
    // A repository is never its own evidence store, even when another binding names it as one.
    for (const binding of otherBindings) if (binding.store.toLowerCase() !== slug.toLowerCase()) addStore(binding.store, `the store of ${binding.repository}'s binding`);
    const judged = [...storeEvidence.values()].map(entry => judgeStore(this.#gh, owner, entry.full, entry.evidence));
    const eligible = judged.filter(entry => entry.eligible).sort((a, b) => storeRank(b, name) - storeRank(a, name));
    const stores = { ...choose(eligible, !repos.ok), rejected: judged.filter(entry => !entry.eligible) };

    // Required checks from the default branch's protection, when readable.
    const repoInfo = this.#gh([`repos/${owner}/${name}`]);
    const branch = repoInfo.ok && repoInfo.value && typeof repoInfo.value.default_branch === 'string' ? repoInfo.value.default_branch : null;
    // Required checks the default branch enforces: rulesets (effective rules) and classic protection.
    let requiredChecks = null;
    if (branch) {
      const rules = this.#gh([`repos/${owner}/${name}/rules/branches/${encodeURIComponent(branch)}`]);
      const classic = this.#gh([`repos/${owner}/${name}/branches/${encodeURIComponent(branch)}/protection/required_status_checks`]);
      if (rules.ok && (classic.ok || classic.reason === 'not-found')) {
        const found = new Set();
        for (const rule of Array.isArray(rules.value) ? rules.value : []) {
          if (rule && rule.type === 'required_status_checks' && rule.parameters && Array.isArray(rule.parameters.required_status_checks)) {
            for (const check of rule.parameters.required_status_checks) if (check && typeof check.context === 'string') found.add(check.context);
          }
        }
        if (classic.ok && classic.value && Array.isArray(classic.value.contexts)) for (const context of classic.value.contexts) found.add(context);
        requiredChecks = [...found].sort();
      }
    }
    if (requiredChecks === null) unknown.push('the default branch\'s required checks');
    const rulesets = this.#gh([`repos/${owner}/${name}/rulesets`]);
    if (!rulesets.ok) unknown.push(`rulesets (${rulesets.reason})`);

    const parentIssue = parents.recommended ? parents.recommended.issue : null;
    const prefix = `INT-${initials(name)}${parentIssue || ''}-`;
    const storeRepo = stores.recommended ? stores.recommended.repository : `${owner}/TRANSPORT-${name}`;
    const draft = {
      schema: 'toolkit.programme-binding.v2',
      repository: slug,
      governance: 'enabled',
      parents: [{ issue: parentIssue, record_prefix: prefix }],
      store: { kind: 'github', repository: storeRepo, branch: 'main', path: `state/${owner}/${name}/` },
      required_checks: requiredChecks || [],
      dependency_updates: { auto_merge: 'off', github_actions: 'owner' },
    };
    const local = localInventory(state.root);
    return {
      ...base,
      status: 'propose',
      repository: slug,
      parents,
      stores,
      other_bindings: otherBindings,
      unknown,
      binding_draft: draft,
      adoption: adoptionList({ local, parents, stores, requiredChecks, rulesets, otherBindings, draft, pending: state.notes.includes('pending-binding-merge') }),
    };
  }
}

// Up to MAX_PAGES pages of a GitHub list: { ok, value: [...], reason }.
function pages(gh, url) {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const got = gh([`${url}${url.includes('?') ? '&' : '?'}per_page=100&page=${page}`]);
    if (!got.ok) return page === 1 ? { ok: false, reason: got.reason } : { ok: true, value: all };
    if (!Array.isArray(got.value)) return { ok: false, reason: 'gh-output-invalid' };
    all.push(...got.value);
    if (got.value.length < 100) break;
  }
  return { ok: true, value: all };
}

function storeRank(entry, name) {
  const repo = entry.repository.split('/')[1].toLowerCase();
  return (repo === `transport-${name.toLowerCase()}` ? 4 : 0) + (entry.evidence.some(item => /binding/.test(item)) ? 2 : 0) + (/^transport-/.test(repo) ? 1 : 0);
}

// What Toolkit would reuse, add, repair, keep and defer, as { reuse, add, repair, keep, defer }.
function adoptionList({ local, parents, stores, requiredChecks, rulesets, draft, pending }) {
  const list = { reuse: [], add: [], repair: [], keep: [], defer: [] };
  if (local.governed_block && !local.governed_block_legacy) list.reuse.push('the governed block already in AGENTS.md');
  else if (local.governed_block_legacy) list.repair.push('refresh the old governed block in AGENTS.md to the current one');
  else list.add.push(local.agents_md ? 'the governed block in AGENTS.md (your own text stays byte-identical outside it)' : 'AGENTS.md with the governed block');
  if (local.host_shims.length) list.keep.push(`host instruction files: ${local.host_shims.join(', ')}`);
  list.add.push(pending ? 'merge the programme binding already in the working tree (as version 2)' : `.github/toolkit-programme.json (version 2): ${JSON.stringify(draft)}`);
  if (parents.recommended) list.reuse.push(`parent issue #${parents.recommended.issue} (${parents.recommended.evidence.join(', ')}${parents.recommended.note ? `; ${parents.recommended.note}` : ''})`);
  else list.add.push('a new parent issue for the programme, created after your yes');
  if (stores.recommended) list.reuse.push(`evidence store ${stores.recommended.repository} (${stores.recommended.evidence.join('; ')})`);
  else list.add.push(`a new private evidence store ${draft.store.repository}, created after your yes`);
  if (local.workflows.length) list.keep.push(`CI workflows: ${local.workflows.join(', ')}`);
  if (requiredChecks && requiredChecks.length) list.reuse.push(`required checks from the default branch protection: ${requiredChecks.join(', ')}`);
  else if (requiredChecks) list.defer.push('required checks: none are required on the default branch yet');
  if (rulesets.ok && Array.isArray(rulesets.value) && rulesets.value.length) list.keep.push(`rulesets: ${rulesets.value.map(entry => entry.name).filter(Boolean).join(', ')}`);
  else if (rulesets.ok) list.add.push('the no-force-push ruleset (offered by `toolkit governance migrate` after its own yes)');
  if (local.scheduled.length) list.keep.push(`scheduled workflows: ${local.scheduled.join(', ')}`);
  if (local.deploy_docs.length) list.keep.push(`deployment notes: ${local.deploy_docs.join(', ')}`);
  if (local.monitoring.length) list.keep.push(`monitoring workflows: ${local.monitoring.join(', ')}`);
  if (!local.dependabot) list.defer.push('Dependabot files (added by `toolkit governance security` once governance is on)');
  return list;
}

// The proposal as the one message the owner reads.
function describeDiscovery(result) {
  if (result.status !== 'propose') return [`Discovery: ${result.reason}.`];
  const lines = [`Discovery for ${result.repository}:`];
  const pick = (label, chosen, show) => {
    if (chosen.status === 'one') lines.push(`- ${label}: recommend ${show(chosen.recommended)}.`);
    else if (chosen.status === 'several') lines.push(`- ${label}: recommend ${show(chosen.recommended)}; alternatives: ${chosen.alternatives.map(show).join('; ')}.`);
    else if (chosen.status === 'none') lines.push(`- ${label}: none found, so Toolkit proposes creating one.`);
    else lines.push(`- ${label}: unknown, because the search failed.`);
  };
  pick('Parent issue', result.parents, entry => `#${entry.issue} "${entry.title}" (${entry.evidence.join(', ')}${entry.note ? `; ${entry.note}` : ''})`);
  pick('Evidence store', result.stores, entry => `${entry.repository} (${entry.evidence.join('; ')})`);
  for (const entry of result.stores.rejected) lines.push(`- Not eligible: ${entry.repository}, because ${entry.rejected}.`);
  if (result.unknown.length) lines.push(`- Unknown: ${result.unknown.join('; ')}.`);
  lines.push('Adoption proposal (one yes covers it all, as one setup pull request):');
  for (const [key, label] of [['reuse', 'Reuse'], ['add', 'Add'], ['repair', 'Repair'], ['keep', 'Keep as is'], ['defer', 'Defer']]) {
    for (const item of result.adoption[key]) lines.push(`- ${label}: ${item}`);
  }
  return lines;
}

module.exports = Object.freeze({ SCHEMA, GovernanceDiscovery, offlineGh, parentCandidates, judgeStore, choose, adoptionList, describeDiscovery, initials, localInventory });
