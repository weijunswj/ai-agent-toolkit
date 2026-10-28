'use strict';

// The repository's merged binding as its governance setting: the default-branch reader and its
// cache, the state matrix (A), discovery before questions (B), old local answers (C) and the
// consumers that read the result (D). Fixtures use reserved example names only.

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const scripts = path.join(repoRoot, 'repo', 'scripts');
const governance = require(path.join(scripts, 'toolkit-governance-state.cjs'));
const bindingCache = require(path.join(scripts, 'toolkit-governance-binding.cjs'));
const discovery = require(path.join(scripts, 'toolkit-governance-discovery.cjs'));
const registry = require(path.join(scripts, 'toolkit-capability-registry.cjs'));
const conformance = require(path.join(scripts, 'toolkit-governance-conformance.cjs'));
const catalogue = require(path.join(scripts, 'toolkit-governance-catalogue.cjs'));
const migration = require(path.join(scripts, 'toolkit-governance-migration.cjs'));
const { governedRepo } = require(path.join(scripts, 'toolkit-governed-repo.cjs'));
const { GovernanceGate } = require(path.join(scripts, 'toolkit-governance-gate.cjs'));
const checkpoint = require(path.join(repoRoot, 'skills', 'github-program-reconciler', 'scripts', 'programme-checkpoint.cjs'));
const programmeState = require(path.join(repoRoot, 'skills', 'github-program-reconciler', 'scripts', 'programme-state.cjs'));

const SLUG = 'example-owner/example-repo';
const REMOTE = `https://github.com/${SLUG}.git`;
const NOW = new Date('2026-10-28T06:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const STORE = { kind: 'github', repository: 'example-owner/TRANSPORT-example-repo', branch: 'main', path: 'state/example-owner/example-repo/' };

function v2(overrides = {}) {
  return { schema: 'toolkit.programme-binding.v2', repository: SLUG, governance: 'enabled', parents: [{ issue: 7, record_prefix: 'INT-ER7-' }], store: STORE, required_checks: ['validate'], ...overrides };
}

function v1(overrides = {}) {
  return { schema: 'toolkit.programme-binding.v1', repository: SLUG, parent_issue: 7, record_prefix: 'INT-ER7-', writer_prefix: 'INT-ER7-', store: STORE, required_checks: ['validate'], ...overrides };
}

function scratch(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-governance-binding-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const registryPath = path.join(root, 'state', 'repository-governance.v1.json');
  return { root, registryPath, opts: { registryPath, testOnly: true } };
}

// A real (empty) git repository: the registry resolves identity through git.
function fakeRepo(ctx, name, { remote = `https://github.com/example-owner/${name}.git`, workingBinding = null } = {}) {
  const repo = path.join(ctx.root, name);
  childProcess.execFileSync('git', ['init', '--quiet', repo], { stdio: 'ignore', windowsHide: true });
  childProcess.execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', remote], { stdio: 'ignore', windowsHide: true });
  if (workingBinding) {
    fs.mkdirSync(path.join(repo, '.github'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.github', 'toolkit-programme.json'), JSON.stringify(workingBinding));
  }
  return repo;
}

// Writes this computer's cache entry as a refresh would.
function cache(ctx, repo, { status = 'present', binding = v2(), text = undefined, ageMs = 0 } = {}) {
  const identity = governance.readIdentity(repo);
  // Each fixture repository has its own origin; a binding naming the example slug is written for it.
  const own = binding && binding.repository === SLUG ? { ...binding, repository: governance.remoteSlug(identity.remote) } : binding;
  const body = status === 'present' ? (text !== undefined ? text : JSON.stringify(own)) : null;
  return bindingCache.writeCache(ctx.registryPath, {
    schema: bindingCache.CACHE_SCHEMA, repository_id: identity.repository_id, remote: identity.remote.canonical,
    default_branch: 'main', commit: 'a'.repeat(40), fetched_at: new Date(NOW.getTime() - ageMs).toISOString(), status,
    bytes_sha256: body === null ? null : crypto.createHash('sha256').update(body, 'utf8').digest('hex'), text: body, problem: null,
  });
}

function decide(ctx, repo, operation) {
  const current = registry.getRepositoryStatus({ cwd: repo, ...ctx.opts });
  return registry.writeCapabilityDecision({
    cwd: repo, ...ctx.opts, capabilityId: 'repository.governance', operation,
    ownerAction: {
      confirmed: true, category: 'explicit-owner', channel: 'capability-route', operation,
      choice_semantic_id: registry.capabilityDecisionSemanticId('repository.governance', operation),
      contract_digest: registry.CONTRACT_DIGEST,
      scope_digest: registry.capabilityScopeDigest(current.repository_id, 'repository.governance', operation, 'capability-route'),
    },
    expectedRevision: current.registry_revision, expectedHash: current.snapshot_hash,
  });
}

function stateAt(ctx, repo, now = NOW) {
  return new governance.GovernanceState({ registryOptions: ctx.opts, now: () => now }).evaluate(repo);
}

function registryBytes(ctx) { return fs.existsSync(ctx.registryPath) ? fs.readFileSync(ctx.registryPath) : null; }

// ---- binding v2 ---------------------------------------------------------------------------------

test('binding v2: enabled needs parents, store and checks; disabled needs only its identity', () => {
  const normalized = programmeState.validateBinding(v2({ parents: [{ issue: 7, record_prefix: 'INT-ER7-' }, { issue: 9, record_prefix: 'INT-ER9-', writer_prefix: 'W-' }] }));
  assert.deepEqual([normalized.parent_issue, normalized.record_prefix, normalized.writer_prefix], [7, 'INT-ER7-', 'INT-ER7-']);
  assert.equal(programmeState.bindingEnabled(normalized), true);
  const disabled = programmeState.validateBinding({ schema: 'toolkit.programme-binding.v2', repository: SLUG, governance: 'disabled' });
  assert.equal(programmeState.bindingEnabled(disabled), false);
  assert.equal(programmeState.bindingEnabled(programmeState.validateBinding(v1())), true, 'v1 reads as enabled with one parent');
  const bad = [
    v2({ governance: 'maybe' }), v2({ parents: [] }), v2({ parents: [{ issue: 0, record_prefix: 'X' }] }),
    v2({ parents: [{ issue: 7, record_prefix: 'X' }, { issue: 7, record_prefix: 'Y' }] }),
    v2({ parents: [{ issue: 7, record_prefix: 'X', children: [8] }] }), v2({ parent_issue: 7 }), v2({ store: undefined }),
    v1({ governance: 'enabled' }), { ...v2(), schema: 'toolkit.programme-binding.v3' },
  ];
  for (const binding of bad) assert.throws(() => programmeState.validateBinding(binding), /BINDING_INVALID|is invalid/, JSON.stringify(binding));
});

test('this repository\'s own binding is version 2 and valid for its origin', () => {
  const own = JSON.parse(fs.readFileSync(path.join(repoRoot, '.github', 'toolkit-programme.json'), 'utf8'));
  assert.equal(own.schema, 'toolkit.programme-binding.v2');
  assert.equal(own.governance, 'enabled');
  assert.deepEqual(governance.bindingProblems(own, { remote: { path: '/weijunswj/ai-agent-toolkit.git' } }), []);
});

// ---- matrix A: state -----------------------------------------------------------------------------

test('A: the merged binding decides on every computer; the local file decides only where nothing is merged', (t) => {
  const ctx = scratch(t);
  const row = (name, setup) => { const repo = fakeRepo(ctx, name, setup.repo || {}); setup.before && setup.before(repo); return stateAt(ctx, repo); };

  const enabled = row('v2-enabled', { before: repo => cache(ctx, repo) });
  assert.deepEqual([enabled.state, enabled.rule, enabled.hold, enabled.governed_rules_bind, enabled.programme_records_bind], ['ENABLED', 'M1', false, true, true]);

  const localNo = row('v2-enabled-local-no', { before: (repo) => { decide(ctx, repo, 'decline'); cache(ctx, repo, { binding: v2({ repository: SLUG }) }); } });
  assert.deepEqual([localNo.state, localNo.rule], ['ENABLED', 'M1']);
  assert.ok(localNo.notes.includes('local-no-is-preference'));

  const old = row('v1', { before: repo => cache(ctx, repo, { binding: v1() }) });
  assert.deepEqual([old.state, old.rule, old.merged.version], ['ENABLED', 'M1', 1]);
  assert.ok(old.notes.includes('binding-v2-migration-offered'));

  const disabled = row('v2-disabled-local-yes', { before: (repo) => { decide(ctx, repo, 'enable'); cache(ctx, repo, { binding: { schema: 'toolkit.programme-binding.v2', repository: SLUG, governance: 'disabled' } }); } });
  assert.deepEqual([disabled.state, disabled.rule, disabled.hold], ['DISABLED', 'M2', false]);

  const none = row('none', { before: repo => cache(ctx, repo, { status: 'absent' }) });
  assert.deepEqual([none.state, none.rule, none.hold], ['UNDECIDED', 'R7', true], 'never set up: pause and block until the owner\'s own reply');

  const ownerNo = row('none-owner-no', { before: (repo) => { decide(ctx, repo, 'decline'); cache(ctx, repo, { status: 'absent' }); } });
  assert.deepEqual([ownerNo.state, ownerNo.rule, ownerNo.hold], ['DISABLED', 'R2', false]);

  const ownerYes = row('none-owner-yes', { before: (repo) => { decide(ctx, repo, 'enable'); cache(ctx, repo, { status: 'absent' }); } });
  assert.deepEqual([ownerYes.state, ownerYes.rule, ownerYes.hold, ownerYes.programme_records_bind], ['ENABLED', 'R5', false, false], 'records bind only once the binding merges');
  assert.ok(ownerYes.notes.includes('setup-pr-offered'));

  const pending = row('none-working-tree', { repo: { workingBinding: v2() }, before: repo => cache(ctx, repo, { status: 'absent' }) });
  assert.deepEqual([pending.state, pending.rule], ['UNDECIDED', 'R7'], 'a working tree never turns it on (A1)');
  assert.ok(pending.notes.includes('pending-binding-merge'));

  for (const [name, text] of [['bad-json', '{oops'], ['unknown-schema', JSON.stringify({ ...v2(), schema: 'toolkit.programme-binding.v9' })], ['bad-field', JSON.stringify(v2({ required_checks: 'validate' }))]]) {
    const error = row(name, { before: repo => cache(ctx, repo, { text }) });
    assert.deepEqual([error.state, error.rule, error.hold, error.governed_rules_bind, error.programme_records_bind, error.governed_effects_hold], ['ERROR', 'M0', false, false, false, true], `${name}: ERROR is never ON and never quietly OFF (A2)`);
  }

  const fork = row('fork', { before: repo => cache(ctx, repo, { binding: v2({ repository: 'example-owner/upstream-repo' }) }) });
  assert.deepEqual([fork.state, fork.rule, fork.merged.foreign_repository], ['UNDECIDED', 'R7', 'example-owner/upstream-repo']);
  assert.ok(fork.notes.includes('binding-belongs-to-other-repository'));

  const fresh = row('cached-23h', { before: repo => cache(ctx, repo, { ageMs: 23 * HOUR }) });
  assert.deepEqual([fresh.state, fresh.governed_rules_bind, fresh.programme_records_bind], ['ENABLED', true, true]);
  const stale = row('cached-25h', { before: repo => cache(ctx, repo, { ageMs: 25 * HOUR }) });
  assert.deepEqual([stale.state, stale.hold, stale.governed_rules_bind, stale.programme_records_bind, stale.governed_effects_hold], ['ENABLED', false, true, false, true], 'stale: routine work on, admission, finality and writes hold (A4)');
  assert.ok(stale.notes.includes('merged-binding-stale'));

  const unread = row('never-read', { before: repo => decide(ctx, repo, 'enable') });
  assert.deepEqual([unread.state, unread.rule, unread.programme_records_bind], ['ENABLED', 'R5', false], 'nothing cached: as none, governed effects hold');
  assert.ok(unread.notes.includes('merged-binding-unknown'));

  const gitlab = row('gitlab', { repo: { remote: 'https://gitlab.com/example-owner/example-repo.git' } });
  assert.deepEqual([gitlab.state, gitlab.rule, gitlab.merged], ['UNDECIDED', 'R9', null], 'not github.com: unchanged');
});

test('A3: a merged disabled is not flipped by the CLI, discovery or migration', async (t) => {
  const ctx = scratch(t);
  const repo = fakeRepo(ctx, 'sticky');
  cache(ctx, repo, { binding: { schema: 'toolkit.programme-binding.v2', repository: SLUG, governance: 'disabled' } });
  const { ToolkitGovernanceCli } = require(path.join(scripts, 'toolkit-governance.cjs'));
  const out = []; const err = [];
  const cli = new ToolkitGovernanceCli({ cwd: repo, registryOptions: ctx.opts, interactive: true, ask: async () => 'yes', stdout: { write: text => out.push(text) }, stderr: { write: text => err.push(text) }, refresh: () => ({}) });
  assert.equal(await cli.main(['enable']), 2);
  assert.match(err.join(''), /merged on the default branch decides/);
  assert.equal(registryBytes(ctx), null, 'nothing written');
  assert.equal(new discovery.GovernanceDiscovery({ registryOptions: ctx.opts, gh: () => { throw new Error('no GitHub read'); } }).discover(repo).status, 'disabled');
  assert.equal(migration.proposalFor(governance.governanceState(repo, ctx.opts), SLUG, new Set()).action, 'keep');
});

test('A4: the cache never upgrades OFF to ON; offline keeps the last read', (t) => {
  const ctx = scratch(t);
  const repo = fakeRepo(ctx, 'offline');
  const identity = governance.readIdentity(repo);
  const offline = () => ({ status: 128, stdout: Buffer.alloc(0), stderr: Buffer.from('fatal: unable to access') });
  assert.deepEqual(bindingCache.refreshBindingCache(identity, ctx.registryPath, { runGit: offline }), { refreshed: false, entry: null, error: 'remote-unreachable' });
  assert.equal(stateAt(ctx, repo).rule, 'R7');
  cache(ctx, repo, { status: 'absent' });
  assert.equal(bindingCache.refreshBindingCache(identity, ctx.registryPath, { runGit: offline }).entry.status, 'absent', 'offline keeps the last read');
  assert.equal(stateAt(ctx, repo).rule, 'R7');
});

// ---- the reader and its cache, hostile input ---------------------------------------------------

function fakeGit(script) {
  return (args) => {
    const key = args[0];
    const answer = script[key];
    if (typeof answer === 'function') return answer(args);
    return answer || { status: 1, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  };
}
const ok = text => ({ status: 0, stdout: Buffer.from(text), stderr: Buffer.alloc(0) });
const SHA = 'b'.repeat(40);

test('reader: default branch from the symref, then the binding at its tip; hostile answers never become a binding', () => {
  const base = { 'ls-remote': ok(`ref: refs/heads/main\tHEAD\n${SHA}\tHEAD\n`), fetch: ok(''), 'rev-parse': ok(`${SHA}\n`) };
  const text = JSON.stringify(v2());
  const present = bindingCache.readDefaultBranchBinding('/r', { runGit: fakeGit({ ...base, 'ls-tree': ok(`100644 blob ${'c'.repeat(40)}    ${text.length}\t.github/toolkit-programme.json\n`), 'cat-file': ok(text) }) });
  assert.deepEqual([present.status, present.default_branch, present.commit, present.text], ['present', 'main', SHA, text]);
  assert.equal(bindingCache.readDefaultBranchBinding('/r', { runGit: fakeGit({ ...base, 'ls-tree': ok('') }) }).status, 'absent');
  const link = bindingCache.readDefaultBranchBinding('/r', { runGit: fakeGit({ ...base, 'ls-tree': ok(`120000 blob ${'c'.repeat(40)}    20\t.github/toolkit-programme.json\n`) }) });
  assert.deepEqual([link.status, link.text], ['present', null], 'a link is an unusable binding (ERROR), never absent');
  const huge = bindingCache.readDefaultBranchBinding('/r', { runGit: fakeGit({ ...base, 'ls-tree': ok(`100644 blob ${'c'.repeat(40)} 9999999\t.github/toolkit-programme.json\n`) }) });
  assert.deepEqual([huge.status, huge.problem], ['present', 'too large']);
  for (const symref of ['ref: refs/heads/../x\tHEAD\n', 'ref: refs/heads/.hidden\tHEAD\n', `${SHA}\tHEAD\n`, 'ref: refs/heads/a b\tHEAD\n', 'ref: refs/tags/v1\tHEAD\n']) {
    assert.equal(bindingCache.readDefaultBranchBinding('/r', { runGit: fakeGit({ ...base, 'ls-remote': ok(symref) }) }).status, 'unknown', JSON.stringify(symref));
  }
  assert.equal(bindingCache.readDefaultBranchBinding('/r', { runGit: fakeGit({ ...base, fetch: { status: 1, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) } }) }).error, 'fetch-failed');
  assert.equal(bindingCache.readDefaultBranchBinding('/r', { runGit: fakeGit({ ...base, 'rev-parse': ok('not-a-sha') }) }).error, 'commit-unreadable');
  assert.equal(bindingCache.readDefaultBranchBinding('/r', { runGit: () => { throw new Error('spawn failed'); } }).status, 'unknown');
});

test('cache: an entry for another identity, a tampered or damaged entry reads as no entry', (t) => {
  const ctx = scratch(t);
  const repo = fakeRepo(ctx, 'cached');
  const identity = governance.readIdentity(repo);
  const entry = cache(ctx, repo);
  const file = bindingCache.cacheFileFor(ctx.registryPath, identity.repository_id);
  assert.ok(bindingCache.readBindingCache(identity, ctx.registryPath));
  const rewrite = change => fs.writeFileSync(file, JSON.stringify({ ...entry, ...change }));
  for (const change of [{ text: JSON.stringify(v2({ governance: 'enabled', required_checks: [] })) }, { remote: 'github.com/example-owner/other-repo' }, { repository_id: 'f'.repeat(64) }, { schema: 'x' }, { commit: 'nope' }, { fetched_at: 'yesterday' }, { status: 'maybe' }, { default_branch: '../x' }]) {
    rewrite(change);
    assert.equal(bindingCache.readBindingCache(identity, ctx.registryPath), null, JSON.stringify(change));
  }
  fs.writeFileSync(file, '{damaged');
  assert.equal(bindingCache.readBindingCache(identity, ctx.registryPath), null);
  fs.writeFileSync(file, ' '.repeat(300 * 1024));
  assert.equal(bindingCache.readBindingCache(identity, ctx.registryPath), null);
  assert.deepEqual([stateAt(ctx, repo).rule, stateAt(ctx, repo).merged.status], ['R7', 'unknown']);
  assert.match(path.relative(path.dirname(ctx.registryPath), file), /^governance-binding-cache[\\/][0-9a-f]{32}\.json$/, 'kept next to the user-state files the gate guards');
});

test('A1 end to end with real git: only the default branch\'s merged binding counts', (t) => {
  const ctx = scratch(t);
  const git = (cwd, args) => childProcess.execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }).trim();
  const id = ['-c', 'user.email=a@example.com', '-c', 'user.name=A'];
  const origin = path.join(ctx.root, 'origin.git');
  const seed = path.join(ctx.root, 'seed');
  git(ctx.root, ['init', '--quiet', '--bare', '-b', 'main', origin]);
  git(ctx.root, ['init', '--quiet', '-b', 'main', seed]);
  fs.writeFileSync(path.join(seed, 'README.md'), 'x\n');
  git(seed, ['add', '.']);
  git(seed, [...id, 'commit', '--quiet', '-m', 'init']);
  git(seed, ['push', '--quiet', origin, 'main']);
  // A binding only on another branch.
  git(seed, ['checkout', '--quiet', '-b', 'feature']);
  fs.mkdirSync(path.join(seed, '.github'));
  fs.writeFileSync(path.join(seed, '.github', 'toolkit-programme.json'), JSON.stringify(v2()));
  git(seed, ['add', '.']);
  git(seed, [...id, 'commit', '--quiet', '-m', 'binding on a branch']);
  git(seed, ['push', '--quiet', origin, 'feature']);

  const clone = path.join(ctx.root, 'clone');
  git(ctx.root, ['clone', '--quiet', origin, clone]);
  // The origin is named as github.com and served from the local bare repository.
  git(clone, ['remote', 'set-url', 'origin', REMOTE]);
  git(clone, ['config', `url.${origin.replace(/\\/g, '/')}.insteadOf`, REMOTE]);
  git(clone, ['checkout', '--quiet', 'feature']);
  assert.equal(governance.refreshMergedBinding(clone, ctx.opts).refreshed, true);
  let current = governance.governanceState(clone, ctx.opts);
  assert.deepEqual([current.rule, current.merged.status], ['R7', 'none'], 'a checked-out branch with a binding is not the default branch');
  assert.ok(current.notes.includes('pending-binding-merge'));

  git(seed, ['checkout', '--quiet', 'main']);
  git(seed, [...id, 'merge', '--quiet', '--no-ff', '-m', 'merge binding', 'feature']);
  git(seed, ['push', '--quiet', origin, 'main']);
  assert.equal(governance.refreshMergedBinding(clone, ctx.opts).refreshed, true);
  current = governance.governanceState(clone, ctx.opts);
  assert.deepEqual([current.state, current.rule, current.programme_records_bind], ['ENABLED', 'M1', true]);
  // Editing the working tree does not change what was merged.
  fs.writeFileSync(path.join(clone, '.github', 'toolkit-programme.json'), JSON.stringify({ schema: 'toolkit.programme-binding.v2', repository: SLUG, governance: 'disabled' }));
  assert.equal(governance.governanceState(clone, ctx.opts).rule, 'M1');
  assert.deepEqual(governance.bindingRequiredChecks(clone, ctx.opts), ['validate'], 'required checks come from the merged binding');
  assert.equal(governance.bindingStoreRepository(clone, ctx.opts), STORE.repository);
});

// ---- matrix B: discovery ---------------------------------------------------------------------------

function fakeGh(routes) {
  const calls = [];
  const gh = (args) => {
    const url = args[0];
    calls.push(url);
    for (const [pattern, answer] of routes) if (pattern.test(url)) return typeof answer === 'function' ? answer(url) : answer;
    return { ok: false, reason: 'not-found' };
  };
  gh.calls = calls;
  return gh;
}
const found = value => ({ ok: true, value });
const storeRepo = (name, { privacy = true, owner = 'example-owner' } = {}) => ({ name, private: privacy, owner: { login: owner }, fork: false, archived: false });

function discoverWith(ctx, routes, name = 'disc') {
  const repo = fakeRepo(ctx, name, { remote: REMOTE });
  cache(ctx, repo, { status: 'absent' });
  const gh = fakeGh(routes);
  return { result: new discovery.GovernanceDiscovery({ registryOptions: ctx.opts, gh }).discover(repo), gh, repo };
}

test('B: a valid merged binding is reused and nothing is asked or read', (t) => {
  const ctx = scratch(t);
  const repo = fakeRepo(ctx, 'reuse');
  cache(ctx, repo);
  const gh = fakeGh([]);
  assert.equal(new discovery.GovernanceDiscovery({ registryOptions: ctx.opts, gh }).discover(repo).status, 'reuse');
  assert.deepEqual(gh.calls, []);
});

test('B: one, several, none and a failed search; stores are judged on GitHub\'s own facts (A5)', (t) => {
  const ctx = scratch(t);
  const layout = found([{ type: 'dir', name: 'state' }, { type: 'dir', name: 'archives' }]);
  const base = [
    [/^repos\/example-owner\/example-repo\/issues/, found([
      { number: 3, title: 'Programme parent', state: 'open', labels: [], sub_issues_summary: { total: 4, completed: 1 } },
      { number: 5, title: 'A bug', state: 'open', labels: [] },
      { number: 6, title: 'Old roadmap', state: 'closed', labels: [], sub_issues_summary: { total: 2, completed: 1 } },
      { number: 8, title: 'Done tracker', state: 'closed', labels: [], sub_issues_summary: { total: 2, completed: 2 } },
      { number: 9, title: 'Programme PR', state: 'open', pull_request: {} },
    ])],
    [/^user\/repos/, found([storeRepo('example-repo'), storeRepo('TRANSPORT-example-repo'), storeRepo('TRANSPORT-public', { privacy: false }), storeRepo('example-repo-notes'), storeRepo('other-app')])],
    [/^repos\/example-owner\/other-app\/contents\/\.github\/toolkit-programme\.json/, found({ content: Buffer.from(JSON.stringify({ store: { repository: 'someone-else/TRANSPORT-x' } })).toString('base64') })],
    [/^repos\/example-owner\/TRANSPORT-example-repo$/, found({ private: true, owner: { login: 'example-owner' } })],
    [/^repos\/example-owner\/TRANSPORT-example-repo\/contents\/$/, layout],
    [/^repos\/example-owner\/TRANSPORT-public$/, found({ private: false, owner: { login: 'example-owner' } })],
    [/^repos\/example-owner\/example-repo-notes$/, found({ private: true, owner: { login: 'example-owner' } })],
    [/^repos\/example-owner\/example-repo-notes\/contents\/$/, found([{ type: 'dir', name: 'docs' }])],
    [/^repos\/example-owner\/example-repo$/, found({ default_branch: 'main' })],
    [/rules\/branches\/main$/, found([{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'validate' }] } }])],
    [/protection\/required_status_checks$/, { ok: false, reason: 'not-found' }],
    [/\/rulesets$/, found([{ name: 'protect-main' }])],
  ];
  const { result } = discoverWith(ctx, base);
  assert.equal(result.status, 'propose');
  assert.equal(result.parents.status, 'several');
  assert.equal(result.parents.recommended.issue, 3, 'open with sub-issues is the strongest');
  assert.deepEqual(result.parents.alternatives.map(entry => entry.issue), [6]);
  assert.match(result.parents.alternatives[0].note, /closed, but 1 sub-issue is still open/);
  assert.deepEqual([result.stores.status, result.stores.recommended.repository], ['one', 'example-owner/TRANSPORT-example-repo']);
  const rejected = Object.fromEntries(result.stores.rejected.map(entry => [entry.repository, entry.rejected]));
  assert.match(rejected['example-owner/TRANSPORT-public'], /public/);
  assert.match(rejected['someone-else/TRANSPORT-x'], /another owner/);
  assert.match(rejected['example-owner/example-repo-notes'], /layout/);
  assert.deepEqual(result.binding_draft.required_checks, ['validate']);
  assert.deepEqual(result.binding_draft.parents, [{ issue: 3, record_prefix: 'INT-ER3-' }]);
  assert.doesNotThrow(() => programmeState.validateBinding(result.binding_draft), 'the draft is a valid v2 binding');
  const text = discovery.describeDiscovery(result).join('\n');
  assert.match(text, /recommend #3/);
  assert.match(text, /one setup pull request/);

  const none = discoverWith(ctx, [[/issues/, found([])], [/^user\/repos/, found([])], [/^repos\/example-owner\/example-repo$/, found({ default_branch: 'main' })], [/rules\/branches/, found([])], [/rulesets$/, found([])]], 'none').result;
  assert.deepEqual([none.parents.status, none.stores.status], ['none', 'none']);
  assert.equal(none.binding_draft.store.repository, 'example-owner/TRANSPORT-example-repo', 'the create proposal has concrete defaults');
  assert.match(discovery.describeDiscovery(none).join('\n'), /none found, so Toolkit proposes creating one/);

  const failed = discoverWith(ctx, [], 'failed').result;
  assert.deepEqual([failed.parents.status, failed.stores.status], ['unknown', 'unknown']);
  assert.ok(failed.unknown.length >= 2);
  assert.match(discovery.describeDiscovery(failed).join('\n'), /Unknown: /);

  const two = discoverWith(ctx, [...base.slice(0, 1), [/^user\/repos/, found([storeRepo('TRANSPORT-example-repo'), storeRepo('TRANSPORT-shared')])],
    [/^repos\/example-owner\/TRANSPORT-(example-repo|shared)$/, found({ private: true, owner: { login: 'example-owner' } })], [/contents\/$/, layout]], 'two').result;
  assert.deepEqual([two.stores.status, two.stores.recommended.repository, two.stores.alternatives.length], ['several', 'example-owner/TRANSPORT-example-repo', 1]);
});

test('B: adoption lists what exists from the working tree and keeps the owner text', (t) => {
  const ctx = scratch(t);
  const repo = fakeRepo(ctx, 'adopt');
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), text); };
  const shim = ['CLAU', 'DE.md'].join('');
  write('AGENTS.md', '# Owner rules\n');
  write(shim, '@AGENTS.md\n');
  write('.github/workflows/ci.yml', 'on: push\n');
  write('.github/workflows/nightly.yml', 'on:\n  schedule:\n    - cron: "0 3 * * *"\n');
  write('.github/workflows/uptime-monitor.yml', 'on: push\n');
  write('docs/DEPLOY.md', '# Deploy\n');
  const local = discovery.localInventory(repo);
  assert.deepEqual([local.agents_md, local.governed_block, local.host_shims, local.scheduled, local.monitoring, local.deploy_docs, local.dependabot],
    [true, false, [shim], ['nightly.yml'], ['uptime-monitor.yml'], ['docs/DEPLOY.md'], false]);
  const list = discovery.adoptionList({ local, parents: { recommended: null }, stores: { recommended: null }, requiredChecks: [], rulesets: { ok: true, value: [] }, draft: { store: { repository: 'example-owner/TRANSPORT-adopt' } }, pending: false });
  assert.match(list.add.join('\n'), /your own text stays byte-identical outside it/);
  assert.match(list.add.join('\n'), /a new private evidence store example-owner\/TRANSPORT-adopt, created after your yes/);
  assert.match(list.keep.join('\n'), /scheduled workflows: nightly\.yml/);
  assert.match(list.keep.join('\n'), /deployment notes: docs\/DEPLOY\.md/);
  assert.match(list.keep.join('\n'), /monitoring workflows: uptime-monitor\.yml/);
  assert.match(list.defer.join('\n'), /required checks: none/);
  assert.match(list.defer.join('\n'), /Dependabot/);
  assert.equal(fs.readFileSync(path.join(repo, 'AGENTS.md'), 'utf8'), '# Owner rules\n', 'discovery writes nothing');
});

// ---- matrix C: old local answers -------------------------------------------------------------------

test('C: old local answers are read and annotated, never rewritten', (t) => {
  const ctx = scratch(t);
  const yes = fakeRepo(ctx, 'old-yes');
  decide(ctx, yes, 'enable');
  const no = fakeRepo(ctx, 'old-no', { remote: 'https://github.com/example-owner/old-no.git' });
  decide(ctx, no, 'decline');
  const noMerged = fakeRepo(ctx, 'old-no-merged', { remote: 'https://github.com/example-owner/old-no-merged.git' });
  decide(ctx, noMerged, 'decline');
  const before = registryBytes(ctx);
  cache(ctx, yes, { status: 'absent' });
  cache(ctx, no, { status: 'absent' });
  cache(ctx, noMerged, { binding: v2({ repository: 'example-owner/old-no-merged' }) });
  assert.deepEqual([stateAt(ctx, yes).state, stateAt(ctx, yes).rule, stateAt(ctx, yes).hold], ['ENABLED', 'R5', false]);
  assert.deepEqual([stateAt(ctx, no).state, stateAt(ctx, no).rule], ['DISABLED', 'R2']);
  assert.deepEqual([stateAt(ctx, noMerged).state, stateAt(ctx, noMerged).notes.includes('local-no-is-preference')], ['ENABLED', true]);
  assert.deepEqual(registryBytes(ctx), before, 'answers, holds and epochs are byte-identical');
});

// ---- matrix D: consumers ---------------------------------------------------------------------------

test('D: consumers read ENABLED, DISABLED, ERROR and stale the same way', (t) => {
  const ctx = scratch(t);
  const make = (name, setup) => { const repo = fakeRepo(ctx, name, { remote: `https://github.com/example-owner/${name}.git` }); setup(repo); return repo; };
  const repos = {
    enabled: make('d-enabled', repo => cache(ctx, repo, { binding: v2({ repository: 'example-owner/d-enabled' }) })),
    disabled: make('d-disabled', repo => cache(ctx, repo, { binding: { schema: 'toolkit.programme-binding.v2', repository: 'example-owner/d-disabled', governance: 'disabled' } })),
    error: make('d-error', repo => cache(ctx, repo, { text: '{bad' })),
    stale: make('d-stale', repo => cache(ctx, repo, { binding: v2({ repository: 'example-owner/d-stale' }), ageMs: 30 * 24 * HOUR })),
  };
  const gate = new GovernanceGate({ registryOptions: ctx.opts });
  const expect = {
    enabled: { hold: false, governed: true, records: true, tiers: ['portable', 'governed'] },
    disabled: { hold: false, governed: false, records: false, tiers: ['portable'] },
    error: { hold: false, governed: false, records: false, tiers: ['portable'] },
    stale: { hold: false, governed: true, records: false, tiers: ['portable', 'governed'] },
  };
  for (const [kind, repo] of Object.entries(repos)) {
    const state = governance.governanceState(repo, ctx.opts);
    assert.equal(gate.evaluate(repo).hold, expect[kind].hold, `${kind}: gate`);
    assert.equal(governedRepo(repo, {}, { registryOptions: ctx.opts }).governed, expect[kind].governed, `${kind}: governed-repo`);
    assert.equal(checkpoint.githubGovernanceOn(repo, { governanceState: () => state }), expect[kind].records, `${kind}: programme records`);
    assert.deepEqual(catalogue.tiersFor(state.state, state.materials_complete), expect[kind].tiers, `${kind}: catalogue`);
    const report = conformance.checkConformance(repo, { ...ctx.opts, offline: true });
    assert.equal(report.exit_code === 2, kind === 'error', `${kind}: conformance`);
    assert.equal(migration.proposalFor(state, null, new Set()).action, kind === 'error' ? 'skip' : 'keep', `${kind}: migration`);
  }
  assert.ok(conformance.checkConformance(repos.stale, { ...ctx.opts, offline: true }).findings.some(entry => entry.id === 'MERGED_BINDING_STALE'));
  // The session line agents read says the same.
  const { sessionLine } = require(path.join(scripts, 'toolkit-governance-gate.cjs'));
  assert.match(sessionLine(repos.error, { registryOptions: ctx.opts }), /^Toolkit governance: ERROR [^\n]*Never treat this as ENABLED or as DISABLED/);
  assert.match(sessionLine(repos.stale, { registryOptions: ctx.opts }), /^Toolkit governance: ENABLED [^\n]*last read over 24 hours ago, so programme records, gate admission and finality hold/);
  assert.match(sessionLine(repos.disabled, { registryOptions: ctx.opts }), /^Toolkit governance: DISABLED/);
  assert.doesNotMatch(sessionLine(repos.enabled, { registryOptions: ctx.opts }), /24 hours/);
});
