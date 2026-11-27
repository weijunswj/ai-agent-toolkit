'use strict';

// Turning governance on in a fresh repository from the governance question bank. Before this, a
// repository with no governed rules or programme file stopped with "the adoption proposal is not
// ready" and an agent had to build the pieces by hand. After the owner's ticketed answer (or their
// own terminal), Toolkit does it in this order and reads back each step:
//
//   1. Evidence store, in this order: the store the owner named in their answer (used only when it
//      reads back as a private store of the same owner, else nothing is made), else this repository's
//      own TRANSPORT-<name> when discovery found it, else it creates that private store under the
//      repository's owner with the owner's own `gh` login, reads back that it is private and owned by
//      the same account, and seeds archives/README.md so discovery accepts it. Another repository's
//      store is never picked on its own.
//   2. Parent issue: when discovery found none, it opens one programme parent issue. The controller
//      still turns it into a programme parent document later; this only gives the binding its issue.
//   3. The plain-text check (which a governed repository always carries) and the Dependabot settings
//      are rendered only where the checkout lacks them, as the repository-agent-rules skill installs
//      them, into a scratch folder outside the checkout (`into`); their files join the same proposal,
//      read from there. The default cloud workflows join it the same way (toolkit-governance-proposal.cjs).
//      The owner's checkout is never written, so nothing is left behind that the merged pull request
//      also holds, and the session-start catch-up can bring the default branch up to date.
//
// No instruction file is written or proposed: the installed Toolkit gives every session in an
// enabled repository the governed rules and the playbooks, so the repository's own AGENTS.md and
// CLAUDE.md stay exactly as they are.
//
// A failed step stops with what was made and what was not. Nothing is deleted: a store or issue made
// on an earlier try is found again by discovery and reused.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const governance = require('./toolkit-governance-state.cjs');
const discovery = require('./toolkit-governance-discovery.cjs');
const { resolvePathExecutable } = require('./claude-process-launch.cjs');

const GH_TIMEOUT_MS = 15000;
const STORE_README = '# Evidence store\n\nPrivate evidence for the governed repository REPOSITORY: plans, reviews and archives that agents keep here instead of in the task repository.\n';
const PARENT_BODY = 'Programme parent for REPOSITORY. Toolkit opened it when governance was turned on from the governance question bank. Tasks join as native sub-issues; the controller keeps the tracker here.\n';

class AdoptError extends Error {
  constructor(message, made = []) { super(message); this.name = 'AdoptError'; this.made = made; }
}

// Whether the working tree already carries a prepared adoption: a programme file that turns
// governance on, so the bank uses it as it is and makes nothing. One that turns it off is a decision,
// not a prepared yes.
function adoptionPrepared(root) {
  try {
    const file = path.join(root, governance.BINDING_FILE);
    if (!fs.lstatSync(file).isFile()) return false;
    const binding = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    return Boolean(binding) && typeof binding === 'object' && !Array.isArray(binding) && binding.governance !== 'disabled';
  } catch { return false; }
}

function storeName(slug) { return `TRANSPORT-${slug.split('/')[1]}`; }

// What turning on would make, from a discovery result: { store: { repository, create, named }, parent: { issue, title, create }, checks }.
// A search that failed blocks it ({ blocked }), so an unreadable GitHub never leads to a second store or parent.
// `store` is the owner/name the owner named in their answer, or null for the default.
function adoptionPlan(found, { store: named = null } = {}) {
  if (!found || ['unavailable', 'error'].includes(found.status)) return { blocked: found ? found.reason : 'discovery did not run' };
  if (found.status !== 'propose') return null;
  if (found.parents.status === 'unknown' || found.stores.status === 'unknown' || found.unknown.some(item => /^(?:parent issues|the owner's repositories)/.test(item))) {
    return { blocked: found.unknown.join('; ') || 'the search failed' };
  }
  const owner = found.repository.split('/')[0];
  // Discovery recommends only this repository's own TRANSPORT-<name>; a named store is checked in adopt.
  const own = found.stores.recommended;
  return {
    repository: found.repository,
    store: named ? { repository: named, create: false, named: true }
      : own ? { repository: own.repository, create: false } : { repository: `${owner}/${storeName(found.repository)}`, create: true },
    found_store: own ? own.repository : null,
    store_name: storeName(found.repository),
    parent: found.parents.recommended ? { issue: found.parents.recommended.issue, title: found.parents.recommended.title, create: false } : { issue: null, create: true },
    checks: found.binding_draft.required_checks,
    visibility: found.visibility || 'unknown',
    unknown: found.unknown,
    draft: found.binding_draft,
  };
}

// `gh api` writes for the two things the bank may create. `run` is for tests.
class GitHubAdoptionWriter {
  #run;
  constructor({ run = null } = {}) {
    this.#run = run || ((args, input) => {
      let result;
      try {
        result = spawnSync(resolvePathExecutable('gh'), ['api', ...args, ...(input === undefined ? [] : ['--input', '-'])], { input: input === undefined ? undefined : JSON.stringify(input), encoding: 'utf8', timeout: GH_TIMEOUT_MS, windowsHide: true, shell: false });
      } catch { return { ok: false, reason: 'gh-unavailable' }; }
      if (!result || result.error) return { ok: false, reason: 'gh-unavailable' };
      if (result.status !== 0) return { ok: false, reason: /HTTP 404/.test(`${result.stderr}${result.stdout}`) ? 'not-found' : /HTTP 422/.test(`${result.stderr}${result.stdout}`) ? 'exists' : 'gh-request-failed' };
      try { return { ok: true, value: JSON.parse(String(result.stdout || 'null')) }; } catch { return { ok: false, reason: 'gh-output-invalid' }; }
    });
  }
  get(endpoint) { return this.#run([endpoint]); }
  // A private repository under `owner`: the signed-in account's own, or an organisation it belongs to.
  createPrivateRepository(owner, name) {
    const user = this.#run(['user']);
    if (!user.ok || !user.value || typeof user.value.login !== 'string') return { ok: false, reason: user.reason || 'gh-output-invalid' };
    const body = { name, private: true, auto_init: true, description: 'Private Toolkit evidence store' };
    if (user.value.login.toLowerCase() === owner.toLowerCase()) return this.#run(['--method', 'POST', 'user/repos'], body);
    return this.#run(['--method', 'POST', `orgs/${owner}/repos`], body);
  }
  putFile(repository, file, text, message) {
    return this.#run(['--method', 'PUT', `repos/${repository}/contents/${file}`], { message, content: Buffer.from(text).toString('base64') });
  }
  createIssue(repository, title, body) { return this.#run(['--method', 'POST', `repos/${repository}/issues`], { title, body }); }
}

// Step 1: the store, created or reused, read back as eligible.
function ensureStore(plan, writer, made) {
  const owner = plan.repository.split('/')[0];
  const reader = args => writer.get(args[0]);
  // A store the owner named passes the same checks as a found one before anything is made.
  if (plan.store.named) {
    const judged = discovery.judgeStore(reader, owner, plan.store.repository, ['named by you']);
    if (!judged.eligible) throw new AdoptError(`${plan.store.repository} was not used as the evidence store, because ${judged.rejected}.`, made);
    return judged.repository;
  }
  if (!plan.store.create) return plan.store.repository;
  const [, name] = plan.store.repository.split('/');
  const existing = writer.get(`repos/${plan.store.repository}`);
  if (existing.ok) {
    // An earlier try made it but stopped before seeding: finish it only when it is clearly that store.
    if (existing.value?.private !== true || String(existing.value?.owner?.login || '').toLowerCase() !== owner.toLowerCase()) {
      throw new AdoptError(`${plan.store.repository} already exists and is not a private repository of ${owner}, so Toolkit did not use it.`, made);
    }
  } else if (existing.reason === 'not-found') {
    const created = writer.createPrivateRepository(owner, name);
    if (!created.ok) throw new AdoptError(`The private evidence store ${plan.store.repository} could not be created (${created.reason}).`, made);
    made.push(`private evidence store ${plan.store.repository}`);
  } else {
    throw new AdoptError(`GitHub could not be read to check ${plan.store.repository} (${existing.reason}).`, made);
  }
  let judged = discovery.judgeStore(reader, owner, plan.store.repository, ['created for governance']);
  if (!judged.eligible && judged.rejected === 'its layout has no archives/ or state/ folder') {
    const seeded = writer.putFile(plan.store.repository, 'archives/README.md', STORE_README.replace('REPOSITORY', plan.repository), 'Start the evidence store');
    if (!seeded.ok) throw new AdoptError(`${plan.store.repository} was made but archives/README.md could not be added (${seeded.reason}).`, made);
    judged = discovery.judgeStore(reader, owner, plan.store.repository, ['created for governance']);
  }
  if (!judged.eligible) throw new AdoptError(`${plan.store.repository} did not read back as a private store of ${owner} (${judged.rejected}).`, made);
  return judged.repository;
}

// Step 2: the parent issue, created or reused.
function ensureParent(plan, writer, made) {
  if (!plan.parent.create) return plan.parent.issue;
  const name = plan.repository.split('/')[1];
  const created = writer.createIssue(plan.repository, `Programme: ${name}`, PARENT_BODY.replace('REPOSITORY', plan.repository));
  if (!created.ok || !Number.isSafeInteger(created.value?.number)) throw new AdoptError(`The parent issue could not be opened (${created.reason || 'gh-output-invalid'}).`, made);
  made.push(`parent issue #${created.value.number}`);
  return created.value.number;
}

// Step 3: the plain-text check, where the checkout lacks it, rendered into `into`. Returns the lines to show.
function ensurePlainText(root, into, installer = null) {
  if (fs.existsSync(path.join(root, '.github', 'plain-text.json'))) return [];
  const { PlainTextInstaller } = require('../../skills/secure-ci-cd/scripts/install-plain-text-check.cjs');
  let said = '';
  const run = installer || (() => new PlainTextInstaller({ repo: root, out: { write: text => { said += text; return true; } } }).install({ workflow: true, into }));
  try { run(into); } catch (error) { throw new AdoptError(`The plain-text check could not be added (${error.message}).`); }
  // Its own "commit these through a pull request" line is left out: the files join this one.
  return [...said.split('\n').filter(line => line && !line.startsWith('Next:')), 'The plain-text check files travel in the turn-on pull request; nothing was written to your checkout.'];
}

// Step 4: a dependabot.yml for every package ecosystem found, where missing, rendered into `into`. It
// travels in the turn-on pull request, so governance never starts with its own security check failing.
// An existing file is never changed.
function ensureSecurityFiles(root, into, writer = null) {
  const security = require('./toolkit-governance-security.cjs');
  const results = (writer || ((dir, target) => security.writeSecurityFiles(dir, { dependabot: true }, { into: target })))(root, into);
  const failed = results.filter(entry => entry.result !== 'written');
  if (failed.length) throw new AdoptError(`The Dependabot settings could not be added (${failed.map(entry => `${entry.file}: ${entry.result}`).join(', ')}).`);
  return results.length ? [`Added ${results.map(entry => entry.file).join(' and ')} to the turn-on pull request; nothing was written to your checkout.`] : [];
}

// Why the planned store cannot be used, known from the plan alone, or null: a named store that is this
// repository itself (the binding would refuse it only after the parent issue is made).
function storeProblem(plan) {
  return plan.store.named && plan.store.repository.toLowerCase() === plan.repository.toLowerCase()
    ? `${plan.store.repository} is this repository itself, so it was not used as the evidence store: the store must be a separate private repository.` : null;
}

// The whole turn-on: { binding, made, lines }. The binding still goes through the one
// governance pull request, which decides nothing until the owner merges it. The caller refuses a plan
// with a store problem (storeProblem) first, before anything is written.
// `into` is the scratch folder the turn-on renders its files into (never the checkout).
function adopt({ root, into, plan, writer, switches = { auto_merge: 'off', merge_train: 'off' }, plainText = null, securityFiles = null }) {
  const made = [];
  // The local, pure steps first, so a render that fails leaves nothing made on GitHub.
  let lines;
  try { lines = [...ensurePlainText(root, into, plainText), ...ensureSecurityFiles(root, into, securityFiles)]; } catch (error) { error.made = made; throw error; }
  const store = ensureStore(plan, writer, made);
  const issue = ensureParent(plan, writer, made);
  const [owner, name] = plan.repository.split('/');
  const binding = {
    ...plan.draft,
    parents: [{ issue, record_prefix: `INT-${discovery.initials(name)}${issue}-` }],
    store: { kind: 'github', repository: store, branch: 'main', path: `state/${owner}/${name}/` },
    task_prs: { ...switches },
  };
  return { binding, made, lines };
}

// A repository whose programme file was already prepared in the working tree: nothing is made on
// GitHub, and the plain-text check and Dependabot settings are rendered into `into` where missing, so
// its turn-on pull request carries exactly what a fresh one does.
// { binding (the working tree's, or null when unreadable), made: [], lines }.
function prepared({ root, into, plainText = null, securityFiles = null }) {
  const lines = [...ensurePlainText(root, into, plainText), ...ensureSecurityFiles(root, into, securityFiles)];
  let binding = null;
  try { binding = JSON.parse(fs.readFileSync(path.join(root, governance.BINDING_FILE), 'utf8').replace(/^\uFEFF/, '')); } catch { binding = null; }
  return { binding, made: [], lines };
}

module.exports = Object.freeze({ AdoptError, GitHubAdoptionWriter, adopt, adoptionPlan, adoptionPrepared, prepared, storeName, storeProblem });
