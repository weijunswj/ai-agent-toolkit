'use strict';

// What each evidence store kind does, one table row per case: governance is ENABLED only with a
// private GitHub repository store; a folder, a drive, "none" or a missing store is refused with one
// plain message and reads as ERROR (never ENABLED); with governance off nothing needs a store; and
// turning on reuses a store under the same owner, never one under another owner. Offline fakes
// stand in for GitHub. The doc table in repo/docs/HOW-TO-USE.md ("Evidence store") says the same.

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { recordAbsent } = require('./toolkit-governed-fixture-support.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const scripts = path.join(ROOT, 'repo', 'scripts');
const programmeState = require(path.join(ROOT, 'skills', 'github-program-reconciler', 'scripts', 'programme-state.cjs'));
const governance = require(path.join(scripts, 'toolkit-governance-state.cjs'));
const { EvidenceStore, mergedStoreBinding } = require(path.join(scripts, 'toolkit-store.cjs'));
const { ScratchCleaner } = require(path.join(scripts, 'toolkit-cleanup.cjs'));
const { GovernanceDiscovery } = require(path.join(scripts, 'toolkit-governance-discovery.cjs'));
const adopt = require(path.join(scripts, 'toolkit-governance-adopt.cjs'));
const bank = require(path.join(scripts, 'toolkit-governance-bank.cjs'));

const SLUG = 'example-owner/example-repo';
const GITHUB_STORE = { kind: 'github', repository: 'example-owner/TRANSPORT-example-repo', branch: 'main', path: 'state/example-owner/example-repo/' };
const IDENTITY = { root: '/r', repository_id: 'a'.repeat(64), valid: true, remote: { host: 'github.com', path: `/${SLUG}.git` } };
const MATERIALS = { governed_block: { present: false }, binding: { present: false, valid: false, problems: [] } };

const NEEDED = 'Toolkit governance keeps its programme state in a private GitHub repository (store.kind "github"); a folder or drive can hold evidence copies but not this state. Without such a store, leave governance off.';
const OFF = 'a store block must name a private GitHub repository (store.kind "github"). Governance is off here, so it needs no store: remove the block or make it a github store.';

function binding(governanceValue, store) {
  const value = { schema: 'toolkit.programme-binding.v2', repository: SLUG, governance: governanceValue };
  if (governanceValue === 'enabled') Object.assign(value, { parents: [{ issue: 7, record_prefix: 'INT-EX7-' }], required_checks: ['validate'] });
  if (store !== undefined) value.store = store;
  return value;
}

// The binding as the merged default branch would serve it, judged and turned into a governance state.
function stateOf(value) {
  const merged = governance.judgeMerged({ text: JSON.stringify(value), commit: 'c'.repeat(40), fetched_at: new Date().toISOString() }, IDENTITY, new Date());
  return { merged, state: governance.GovernanceState.derive({ identity: IDENTITY, materials: MATERIALS, merged }) };
}

function refusal(value) {
  try { programmeState.validateBinding(value); } catch (error) { return { code: error.code, errors: error.details.errors }; }
  return null;
}

// Matrix rows 1 to 9 (row 13, an older copy reading a row 4 binding, is the same validator).
const BINDING_ROWS = [
  { row: 1, label: 'a private GitHub repository store, governance on', binding: binding('enabled', GITHUB_STORE), state: ['ENABLED', 'M1'] },
  { row: 2, label: 'the governed repository as its own store', binding: binding('enabled', { ...GITHUB_STORE, repository: SLUG }), state: ['ERROR', 'M0'], errors: ['store.repository must be a separate repository'] },
  { row: 4, label: 'a folder store, governance on', binding: binding('enabled', { kind: 'folder', path: 'evidence/' }), state: ['ERROR', 'M0'], errors: [`store.kind "folder" is not supported: ${NEEDED}`] },
  { row: 5, label: 'a drive store, governance on', binding: binding('enabled', { kind: 'drive', repository: 'example-owner/x', branch: 'main', path: 'x/' }), state: ['ERROR', 'M0'], errors: [`store.kind "drive" is not supported: ${NEEDED}`] },
  { row: 6, label: 'store kind none, governance on', binding: binding('enabled', { kind: 'none' }), state: ['ERROR', 'M0'], errors: [`store.kind "none" is not supported: ${NEEDED}`] },
  { row: 7, label: 'no store, governance on', binding: binding('enabled'), state: ['ERROR', 'M0'], errors: [`the binding names no evidence store: ${NEEDED}`] },
  { row: 7, label: 'an empty store block, governance on', binding: binding('enabled', null), state: ['ERROR', 'M0'], errors: [`store.kind is not supported: ${NEEDED}`] },
  { row: 7, label: 'a kind that is not a plain word is not echoed', binding: binding('enabled', { kind: 'folder"; rm -rf /' }), state: ['ERROR', 'M0'], errors: [`store.kind is not supported: ${NEEDED}`] },
  { row: 7, label: 'a secret-shaped kind is not echoed and is refused as a secret too', binding: binding('enabled', { kind: `ghp_${'x'.repeat(36)}` }), state: ['ERROR', 'M0'],
    errors: [`store.kind is not supported: ${NEEDED}`, 'binding.store.kind looks like a GitHub token; state documents and bindings never hold secrets'] },
  { row: 8, label: 'no store, governance off', binding: binding('disabled'), state: ['DISABLED', 'M2'] },
  { row: 9, label: 'store kind none, governance off', binding: binding('disabled', { kind: 'none' }), state: ['ERROR', 'M0'], errors: [`store.kind "none" is not supported: ${OFF}`] },
  { row: 9, label: 'a folder store, governance off', binding: binding('disabled', { kind: 'folder', path: 'evidence/' }), state: ['ERROR', 'M0'], errors: [`store.kind "folder" is not supported: ${OFF}`] },
];

test('store kinds in the binding: only a separate GitHub repository store turns governance on; every other kind is one plain refusal', () => {
  for (const entry of BINDING_ROWS) {
    const name = `row ${entry.row}: ${entry.label}`;
    assert.deepEqual(refusal(entry.binding), entry.errors ? { code: 'BINDING_INVALID', errors: entry.errors } : null, name);
    const { merged, state } = stateOf(entry.binding);
    assert.deepEqual([state.state, state.rule], entry.state, name);
    if (entry.errors) {
      assert.deepEqual(merged.problems, entry.errors, `${name}: the status shows the same plain message`);
      assert.equal(state.governed_effects_hold, true, `${name}: governance effects hold`);
    }
  }
  // Invariant I1: nothing but a valid github store ever reads as ENABLED.
  assert.deepEqual(BINDING_ROWS.filter(entry => stateOf(entry.binding).state.state === 'ENABLED').map(entry => entry.row), [1]);
});

test('row 3: a public GitHub store passes the binding check but every state read or write stops before using it', () => {
  assert.equal(refusal(binding('enabled', GITHUB_STORE)), null);
  const reads = [];
  const transport = { request: (method, url) => { reads.push(`${method} ${url}`); return { status: 200, json: { private: false, permissions: { push: true } } }; } };
  const store = new programmeState.StateStore({ transport, store: GITHUB_STORE });
  assert.throws(() => store.verify(), error => error.code === 'STATE_STORE_UNVERIFIED' && /because it is not private/.test(error.message));
  assert.deepEqual(reads, [`GET repos/${GITHUB_STORE.repository}`], 'nothing past the privacy check is read');
});

function scratch(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-store-kinds-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, registryOptions: { registryPath: path.join(root, 'home', 'state', 'repository-governance.v1.json'), testOnly: true } };
}

// A github.com checkout with no programme file, whose default branch was read as having none.
function freshRepo(ctx, slug) {
  const repo = path.join(ctx.root, slug.replace('/', '-'));
  childProcess.execFileSync('git', ['init', '--quiet', repo], { stdio: 'ignore', windowsHide: true });
  fs.writeFileSync(path.join(repo, '.git', 'config'), `[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = https://github.com/${slug}.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`);
  recordAbsent(repo, { registryPath: ctx.registryOptions.registryPath });
  return repo;
}

test('row 10: an ungoverned repository with no binding works; the store command and cleanup say there is no store', t => {
  const ctx = scratch(t);
  const repo = freshRepo(ctx, 'example-owner/plain');
  assert.notEqual(governance.governanceState(repo, ctx.registryOptions).state, 'ENABLED');
  const bound = mergedStoreBinding(repo, { stateOptions: ctx.registryOptions });
  assert.deepEqual(bound, { ok: false, reason: 'this computer has no enabled merged Toolkit binding for that repository' });
  assert.throws(() => new EvidenceStore({ readBinding: () => bound }).open({ store: repo, repoRoot: repo }),
    error => error.message.includes('no bound evidence store: this computer has no enabled merged Toolkit binding for that repository.') && /toolkit governance status/.test(error.message));
  assert.deepEqual(new ScratchCleaner({ home: ctx.root, tmpdir: ctx.root, cwd: repo }).readBack(repo, null),
    { ok: false, reason: 'this repository binds no evidence store, so nothing could be read back' });
});

// GitHub as discovery reads it: the owner's repositories, their programme files and each store's root.
function discoveryGh({ slug, repos }) {
  return ([endpoint]) => {
    const url = endpoint.split('?')[0];
    if (url === `repos/${slug}/issues`) return { ok: true, value: [] };
    if (url === 'user/repos') return { ok: true, value: Object.keys(repos).map(full => ({ name: full.split('/')[1], owner: { login: full.split('/')[0] } })) };
    if (url === `repos/${slug}`) return { ok: true, value: { default_branch: 'main', private: true } };
    if (url === `repos/${slug}/rules/branches/main`) return { ok: true, value: [] };
    if (url === `repos/${slug}/branches/main/protection/required_status_checks`) return { ok: false, reason: 'not-found' };
    if (url === `repos/${slug}/rulesets`) return { ok: true, value: [] };
    const match = /^repos\/([^/]+\/[^/]+?)(\/contents\/.*)?$/.exec(url);
    const entry = match && repos[match[1]];
    if (!entry) return { ok: false, reason: 'not-found' };
    if (!match[2]) return { ok: true, value: { private: entry.private, owner: { login: match[1].split('/')[0] } } };
    if (match[2] === '/contents/') return { ok: true, value: (entry.dirs || []).map(name => ({ type: 'dir', name })) };
    if (match[2] === '/contents/.github/toolkit-programme.json' && entry.binding) return { ok: true, value: { content: Buffer.from(JSON.stringify(entry.binding)).toString('base64') } };
    return { ok: false, reason: 'not-found' };
  };
}

test('row 11: a store another repository of the same owner already uses is used only when the owner names it', t => {
  const ctx = scratch(t);
  const owner = 'example-owner';
  const repo = freshRepo(ctx, `${owner}/b`);
  const store = `${owner}/TRANSPORT-a`;
  const gh = discoveryGh({ slug: `${owner}/b`, repos: {
    [`${owner}/a`]: { private: true, binding: binding('enabled', { kind: 'github', repository: store, branch: 'main', path: `state/${owner}/a/` }) },
    [store]: { private: true, dirs: ['archives', 'state'] },
  } });
  const found = new GovernanceDiscovery({ gh, registryOptions: ctx.registryOptions }).discover(repo);
  assert.equal(found.status, 'propose');
  assert.equal(found.stores.recommended, null, 'never picked on its own');
  assert.deepEqual(found.stores.alternatives.map(entry => entry.repository), [store], 'still listed, for the owner to name');
  assert.deepEqual(adopt.adoptionPlan(found).store, { repository: `${owner}/TRANSPORT-b`, create: true }, 'the default is this repository\'s own store');
  const named = adopt.adoptionPlan(found, { store });
  assert.deepEqual(named.store, { repository: store, create: false, named: true }, 'named: no new store is made');
  const row = bank.governanceBankSpecs({ state: governance.governanceState(repo, ctx.registryOptions), adoption: adopt.adoptionPlan(found) }).find(spec => spec.id === 'evidence-store');
  assert.equal(row.report_only, true, 'a status row, never a question');
  assert.match(row.recommended_text, /^None yet: Toolkit creates the private GitHub repository example-owner\/TRANSPORT-b /);
});

test('row 12: a store under another owner is never reused; turning on plans a new store under the repository\'s owner', t => {
  const ctx = scratch(t);
  const repo = freshRepo(ctx, 'example-org/b');
  const personal = 'example-owner/TRANSPORT-a';
  const gh = discoveryGh({ slug: 'example-org/b', repos: {
    'example-org/a': { private: true, binding: binding('enabled', { kind: 'github', repository: personal, branch: 'main', path: 'state/example-org/a/' }) },
    [personal]: { private: true, dirs: ['archives'] },
  } });
  const found = new GovernanceDiscovery({ gh, registryOptions: ctx.registryOptions }).discover(repo);
  assert.equal(found.stores.recommended, null);
  assert.deepEqual(found.stores.rejected.map(entry => [entry.repository, entry.rejected]), [[personal, 'it sits under another owner']]);
  assert.deepEqual(adopt.adoptionPlan(found).store, { repository: 'example-org/TRANSPORT-b', create: true });
});
