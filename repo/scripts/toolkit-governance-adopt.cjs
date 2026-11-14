'use strict';

// Turning governance on in a fresh repository from the governance question bank. Before this, a
// repository with no governed rules or programme file stopped with "the adoption proposal is not
// ready" and an agent had to build the pieces by hand. After the owner's ticketed answer (or their
// own terminal), Toolkit does it in this order and reads back each step:
//
//   1. Evidence store: when discovery found none, or the owner chose a new one, it creates the
//      private store TRANSPORT-<name> under the repository's owner with the owner's own `gh` login,
//      reads back that it is private and owned by the same account, and seeds archives/README.md so
//      discovery accepts it.
//   2. Parent issue: when discovery found none, it opens one programme parent issue. The controller
//      still turns it into a programme parent document later; this only gives the binding its issue.
//   3. Governed rules: the governed AGENTS.md block, the CLAUDE.md shim and the playbooks are rendered
//      from the repository-agent-rules templates straight into the proposal. The working tree is not
//      changed, and text outside the block markers keeps its exact bytes.
//   4. The plain-text check (which a governed repository always carries) is installed into the
//      working tree only where it is missing, as the repository-agent-rules skill does; its files join
//      the same proposal.
//
// A failed step stops with what was made and what was not. Nothing is deleted: a store or issue made
// on an earlier try is found again by discovery and reused.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const governance = require('./toolkit-governance-state.cjs');
const managedBlock = require('./toolkit-managed-block.cjs');
const discovery = require('./toolkit-governance-discovery.cjs');
const { resolvePathExecutable } = require('./claude-process-launch.cjs');

const TEMPLATES = path.join(__dirname, '..', '..', 'skills', 'repository-agent-rules', 'repo-local');
const PLAYBOOKS = path.join(TEMPLATES, 'docs', 'agent-playbooks');
const GH_TIMEOUT_MS = 15000;
const STORE_README = '# Evidence store\n\nPrivate evidence for the governed repository REPOSITORY: plans, reviews and archives that agents keep here instead of in the task repository.\n';
const PARENT_BODY = 'Programme parent for REPOSITORY. Toolkit opened it when governance was turned on from the governance question bank. Tasks join as native sub-issues; the controller keeps the tracker here.\n';

class AdoptError extends Error {
  constructor(message, made = []) { super(message); this.name = 'AdoptError'; this.made = made; }
}

// Whether the working tree already carries a prepared adoption (the governed block and a programme
// file), so the bank uses it as it is and makes nothing.
function adoptionPrepared(root) {
  let block = null;
  try { block = governance.readGovernedBlock(root); } catch { return false; }
  if (!block.present || block.legacy || block.marker_errors) return false;
  try { return fs.lstatSync(path.join(root, governance.BINDING_FILE)).isFile(); } catch { return false; }
}

function storeName(slug) { return `TRANSPORT-${slug.split('/')[1]}`; }

// What turning on would make, from a discovery result: { store: { repository, create }, parent: { issue, title, create }, checks }.
// A search that failed blocks it ({ blocked }), so an unreadable GitHub never leads to a second store or parent.
function adoptionPlan(found, { newStore = false } = {}) {
  if (!found || ['unavailable', 'error'].includes(found.status)) return { blocked: found ? found.reason : 'discovery did not run' };
  if (found.status !== 'propose') return null;
  if (found.parents.status === 'unknown' || found.stores.status === 'unknown' || found.unknown.some(item => /^(?:parent issues|the owner's repositories)/.test(item))) {
    return { blocked: found.unknown.join('; ') || 'the search failed' };
  }
  const owner = found.repository.split('/')[0];
  // A new store is offered only when the found one is not already the name Toolkit would create.
  const choice = Boolean(found.stores.recommended) && found.stores.recommended.repository.toLowerCase() !== `${owner}/${storeName(found.repository)}`.toLowerCase();
  const reuse = !(newStore && choice) && found.stores.recommended;
  return {
    repository: found.repository,
    store: reuse ? { repository: found.stores.recommended.repository, create: false } : { repository: `${owner}/${storeName(found.repository)}`, create: true },
    found_store: found.stores.recommended ? found.stores.recommended.repository : null,
    store_name: storeName(found.repository),
    store_choice: choice,
    parent: found.parents.recommended ? { issue: found.parents.recommended.issue, title: found.parents.recommended.title, create: false } : { issue: null, create: true },
    checks: found.binding_draft.required_checks,
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

// Step 3: the governed rules as proposal files, rendered from the templates. `root` is read, never written.
function renderedRules(root) {
  const template = fs.readFileSync(path.join(TEMPLATES, 'AGENTS.managed.template.md'), 'utf8').replace(/\r\n/g, '\n');
  const block = managedBlock.findBlocks(template).blocks.find(entry => entry.name === 'TOOLKIT-GOVERNED-RULES');
  const read = rel => { try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
  const files = {};
  try {
    files['AGENTS.md'] = managedBlock.upsertBlock(read('AGENTS.md') || '', { source: block.source, name: block.name, version: block.version, body: block.body }, { replaces: ['TOOLKIT-GOVERNED-RULES', 'GLOBAL-AGENTS.MD-TEMPLATE'] }).replace(/\r\n/g, '\n');
  } catch (error) {
    throw new AdoptError(`AGENTS.md has broken Toolkit markers, so the governed rules were not added (${error.message}). Repair them with repository-agent-rules first.`);
  }
  const claude = read('CLAUDE.md');
  if (claude === null) files['CLAUDE.md'] = '@AGENTS.md\n';
  else if (!/^@AGENTS\.md[ \t]*\r?$/m.test(claude)) files['CLAUDE.md'] = `@AGENTS.md\n\n${claude.replace(/\r\n/g, '\n')}`;
  for (const name of fs.readdirSync(PLAYBOOKS).filter(entry => entry.endsWith('.md')).sort()) {
    files[`docs/agent-playbooks/${name}`] = fs.readFileSync(path.join(PLAYBOOKS, name), 'utf8').replace(/\r\n/g, '\n');
  }
  return files;
}

// Step 4: the plain-text check, where it is missing. Returns the lines to show.
function ensurePlainText(root, installer = null) {
  if (fs.existsSync(path.join(root, '.github', 'plain-text.json'))) return [];
  const { PlainTextInstaller } = require('../../skills/secure-ci-cd/scripts/install-plain-text-check.cjs');
  let said = '';
  const run = installer || (() => new PlainTextInstaller({ repo: root, out: { write: text => { said += text; return true; } } }).install({ workflow: true }));
  try { run(); } catch (error) { throw new AdoptError(`The plain-text check could not be added (${error.message}).`); }
  // Its own "commit these through a pull request" line is left out: the files join this one.
  return [...said.split('\n').filter(line => line && !line.startsWith('Next:')), 'The plain-text check files were added to the working tree and travel in the turn-on pull request.'];
}

// The whole turn-on: { binding, files, made, lines }. The binding still goes through the one
// governance pull request, which decides nothing until the owner merges it.
function adopt({ root, plan, writer, switchTo = 'off', plainText = null }) {
  const made = [];
  const store = ensureStore(plan, writer, made);
  const issue = ensureParent(plan, writer, made);
  const [owner, name] = plan.repository.split('/');
  const binding = {
    ...plan.draft,
    parents: [{ issue, record_prefix: `INT-${discovery.initials(name)}${issue}-` }],
    store: { kind: 'github', repository: store, branch: 'main', path: `state/${owner}/${name}/` },
    task_prs: { auto_merge: switchTo },
  };
  let lines;
  try { lines = ensurePlainText(root, plainText); } catch (error) { error.made = made; throw error; }
  let files;
  try { files = renderedRules(root); } catch (error) { error.made = made; throw error; }
  return { binding, files, made, lines };
}

module.exports = Object.freeze({ AdoptError, GitHubAdoptionWriter, adopt, adoptionPlan, adoptionPrepared, renderedRules, storeName });
