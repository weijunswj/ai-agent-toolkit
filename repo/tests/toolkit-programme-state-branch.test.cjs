'use strict';

// The public state branch: writes (matrix B), recovery (matrix C) and migration (matrix M), with the
// invariants they test: only public-safe bytes reach state/ on the bound repository (B2-1), commits
// skip CI and the branch is only parsed (B2-2), the fence and per-file compare-and-swap hold (B2-3),
// a missing branch is restored only by a digest-verified path or held (B2-4), a binding without
// `state` never restores or creates it (B2-5), migration copies every fence, hold and finding one to
// one (B2-6), sidecars go only to a private store (B2-7) and only refresh acts by the stored hash
// (B2-8). Offline: an in-memory GitHub with real branches and commits. Reserved example names only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Ajv2020 = require('ajv/dist/2020');

const ROOT = path.resolve(__dirname, '..', '..');
const state = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');
const checkpoint = require('../../skills/github-program-reconciler/scripts/programme-checkpoint.cjs');
const cli = require('../../skills/github-program-reconciler/scripts/programme.cjs');
const { BranchFakeGitHub } = require('./toolkit-programme-branch-fake.cjs');

const REPO = 'example-owner/example-repo';
const STORE_REPO = 'example-owner/example-store';
const STORE = { kind: 'github', repository: STORE_REPO, branch: 'main', path: 'state/example-owner/example-repo/' };
const STATE_BLOCK = { kind: 'branch', branch: state.STATE_BRANCH, path: 'state/' };
const BRANCH = state.STATE_BRANCH;
const controller = { session: 'controller-session-0001', prefix: 'INT-ER7-' };
const BASE = { schema: 'toolkit.programme-binding.v2', repository: REPO, governance: 'enabled', parents: [{ issue: 7, record_prefix: 'INT-ER7-' }], store: STORE, required_checks: ['validate'] };
const temps = [];
const tmp = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'programme-branch-')); temps.push(dir); return dir; };
test.after(() => { for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true }); });

const publicFile = name => `state/${name}.json`;
const sidecarDir = name => `${STORE.path}private/${name}`;
const checkpointFile = `${STORE.path}checkpoint.json`;

function fixture({ migrate = true, childText = {} } = {}) {
  const github = new BranchFakeGitHub({ repository: REPO, store: STORE_REPO });
  github.addIssue(7, { body: '## CURRENT\n' });
  github.addIssue(12, { body: 'Body of 12', parent: 7 });
  const now = () => new Date(github.clock).toISOString();
  const withoutState = state.validateBinding(BASE);
  const withState = state.validateBinding({ ...BASE, state: STATE_BLOCK });
  const priv = new state.StateStore({ transport: github, store: STORE, now, toolkitVersion: '3.20.0' });
  const outcome = { issue: 12, label: 'A1', class: 'COMMITTED', parent: 7, order: 1 };
  priv.write('parent', 7, state.claimDocument(state.newParent({ repository: REPO, parentIssue: 7, outcomes: [outcome] }), controller), { sha: null, previous: null });
  priv.write('child', 12, { ...state.newChild({ repository: REPO, outcome }), ...childText }, { sha: null, previous: null });
  const dir = tmp();
  const fx = { github, priv, withoutState, withState, now, dir, stdout: '', stderr: '' };
  fx.local = () => {
    const file = path.join(dir, 'checkpoints', 'example-owner--example-repo.json');
    return { read: () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')).checkpoint; } catch { return null; } }, write: () => {} };
  };
  fx.deps = (extra = {}) => ({ transport: github, binding: withState, originUrl: `https://github.com/${REPO}.git`, repoRoot: dir, toolkitVersion: '3.20.0', now,
    environment: {}, stateCheckpointDir: path.join(dir, 'checkpoints'), attentionDir: path.join(dir, 'attention'),
    stdout: { write: text => { fx.stdout += text; } }, stderr: { write: text => { fx.stderr += text; } }, ...extra });
  fx.run = (argv, extra = {}) => {
    fx.stdout = '';
    try { return { code: cli.main([...argv, '--json'], fx.deps(extra)), result: JSON.parse(fx.stdout), error: null }; }
    catch (error) { return { code: null, result: null, error }; }
  };
  fx.store = (binding = withState) => state.openStore({ transport: github, binding, now, toolkitVersion: '3.20.0', localCheckpoint: null });
  fx.writes = () => github.calls.filter(call => call.method !== 'GET');
  if (migrate) {
    const dry = fx.run(['migrate-state', '--dry-run'], { binding: withoutState });
    assert.equal(dry.error, null, dry.error?.message);
    const applied = fx.run(['migrate-state', '--apply', '--plan-digest', dry.result.plan_digest, '--controller', '--session', controller.session], { binding: withoutState, ask: () => 'yes' });
    assert.equal(applied.error, null, applied.error?.message);
    fx.migration = applied.result;
  }
  return fx;
}

const bumpChild = (fx, change = doc => { doc.next_action = 'Controller: plan the next step'; return doc; }, writer = controller) => {
  const store = fx.store();
  const parentDoc = store.read('parent', 7).doc;
  return { store, result: store.mutate('child', 12, { writer, parentDoc, change }) };
};

// ---------------------------------------------------------------------------------------------
// M. Migration

test('M: the dry run prints public documents, sidecars and digests and writes nothing', () => {
  const fx = fixture({ migrate: false });
  const before = fx.writes().length;
  const { result, error } = fx.run(['migrate-state', '--dry-run'], { binding: fx.withoutState });
  assert.equal(error, null);
  assert.equal(result.mode, 'dry-run');
  assert.deepEqual(result.documents.map(doc => doc.name), ['parent-7', 'issue-12']);
  for (const doc of result.documents) {
    assert.match(doc.public_sha256, /^[0-9a-f]{64}$/);
    assert.equal(doc.sidecar, `${sidecarDir(doc.name)}/r1-${doc.public_sha256.slice(0, 16)}.json`);
    assert.equal(doc.public.private, undefined, 'no private part');
    assert.equal(doc.public.fence.holder_session, undefined);
  }
  assert.equal(result.documents[0].public.fence.holder_session_hash, checkpoint.sessionHash(controller.session));
  assert.equal(fx.writes().length, before, 'the dry run wrote nothing');
  assert.equal(fx.github.head(REPO, BRANCH), null);
});

test('M: apply without the owner\'s typed yes in that run, or without a terminal, is refused', () => {
  const fx = fixture({ migrate: false });
  const dry = fx.run(['migrate-state', '--dry-run'], { binding: fx.withoutState }).result;
  const argv = ['migrate-state', '--apply', '--plan-digest', dry.plan_digest, '--controller', '--session', controller.session];
  const before = fx.writes().length;
  assert.equal(fx.run(argv, { binding: fx.withoutState, ask: () => 'no' }).error.code, 'NOT_CONFIRMED');
  assert.equal(fx.run(argv, { binding: fx.withoutState }).error.code, 'NOT_CONFIRMED', 'no terminal: never asked, never written');
  assert.throws(() => cli.parseArgs(['migrate-state', '--apply', '--controller', '--session', 's']), { code: 'USAGE' }, 'apply names the dry run');
  assert.equal(fx.run([...argv.slice(0, 3), 'a'.repeat(64), ...argv.slice(4)], { binding: fx.withoutState, ask: () => 'yes' }).error.code, 'MIGRATION_CHANGED');
  assert.equal(fx.run(argv.slice(0, 4), { binding: fx.withoutState, ask: () => 'yes' }).error.code, 'USAGE', 'only the controller applies');
  assert.equal(fx.run([...argv.slice(0, 5), '--session', 'someone-else-0001'], { binding: fx.withoutState, ask: () => 'yes' }).error.code, 'STALE_WRITER');
  assert.equal(fx.writes().length, before);
  assert.equal(fx.github.head(REPO, BRANCH), null);
});

test('M: apply makes one orphan commit of public documents, writes sidecars and the checkpoint, reads back and prints the binding change', () => {
  const fx = fixture();
  const result = fx.migration;
  assert.equal(result.mode, 'apply');
  assert.deepEqual(result.binding_change, { state: STATE_BLOCK });
  const head = fx.github.head(REPO, BRANCH);
  assert.equal(head, result.head);
  const commit = fx.github.git(REPO).commits.get(head);
  assert.deepEqual(commit.parents, [], 'an orphan commit');
  assert.match(commit.message, /\[skip ci\]$/);
  assert.deepEqual([...commit.files.keys()].sort(), [publicFile('issue-12'), publicFile('parent-7')]);
  for (const doc of result.documents) {
    const text = fx.github.textAt(REPO, head, publicFile(doc.name));
    assert.equal(state.sha256(text), doc.public_sha256, 'the digests match the dry run');
    assert.ok(fx.github.textAt(STORE_REPO, 'main', `${sidecarDir(doc.name)}/r1-${doc.public_sha256.slice(0, 16)}.json`), 'the sidecar is in the private store');
  }
  const cp = fx.github.readAt(STORE_REPO, 'main', checkpointFile);
  assert.equal(cp.head_sha, head);
  assert.deepEqual(Object.keys(cp.files).sort(), ['issue-12', 'parent-7']);
  // B2-6: every fence, epoch, hold and private part reads back one to one.
  const store = fx.store();
  assert.deepEqual(store.read('parent', 7).doc, fx.priv.read('parent', 7).doc);
  assert.deepEqual(store.read('child', 12).doc, fx.priv.read('child', 12).doc);
  // The binding schema accepts the printed block.
  const ajv = new Ajv2020({ strict: false });
  const validate = ajv.compile(JSON.parse(fs.readFileSync(path.join(ROOT, 'repo', 'contracts', 'programme-state', 'binding-v2.schema.json'), 'utf8')));
  assert.equal(validate({ ...BASE, ...result.binding_change }), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...BASE, state: { ...STATE_BLOCK, branch: 'main' } }), false);
  const noStore = { ...BASE, governance: 'disabled', ...result.binding_change };
  delete noStore.store;
  assert.equal(validate(noStore), false, 'state needs store in the schema too');
  // Once merged, there is nothing more to migrate.
  assert.equal(fx.run(['migrate-state', '--dry-run']).error.code, 'STATE_MIGRATED');
});

test('M: a field that is not public-safe stops the whole migration, and nothing is created', () => {
  const fx = fixture({ migrate: false, childText: { blockers: ['see https://ci.example.com/run/1'] } });
  const dry = fx.run(['migrate-state', '--dry-run'], { binding: fx.withoutState }).result;
  assert.equal(dry.problems.length, 1);
  assert.match(dry.problems[0], /issue-12: .*address/);
  const before = fx.writes().length;
  const applied = fx.run(['migrate-state', '--apply', '--plan-digest', dry.plan_digest, '--controller', '--session', controller.session], { binding: fx.withoutState, ask: () => 'yes' });
  assert.equal(applied.error.code, 'MIGRATION_HELD');
  assert.equal(fx.writes().length, before);
  assert.equal(fx.github.head(REPO, BRANCH), null);
});

test('M: until the binding change merges, readers keep the private store, and the branch exists only once', () => {
  const fx = fixture();
  const store = fx.store(fx.withoutState);
  assert.equal(store.constructor, state.StateStore, 'the merged binding without state opens the private store');
  assert.equal(store.read('parent', 7).doc.revision, 1);
  const again = fx.run(['migrate-state', '--dry-run'], { binding: fx.withoutState }).result;
  assert.equal(again.branch_exists, true);
  const applied = fx.run(['migrate-state', '--apply', '--plan-digest', again.plan_digest, '--controller', '--session', controller.session], { binding: fx.withoutState, ask: () => 'yes' });
  assert.equal(applied.error.code, 'STATE_BRANCH_EXISTS');
});

// ---------------------------------------------------------------------------------------------
// B. Writes

test('B: a holder write puts the sidecar first, then the public file, both read back, then the checkpoint; commits skip CI', () => {
  const fx = fixture();
  const start = fx.github.calls.length;
  const { result } = bumpChild(fx);
  assert.equal(result.outcome, 'WRITTEN');
  assert.equal(result.doc.revision, 2);
  const puts = fx.github.calls.slice(start).filter(call => call.method === 'PUT').map(call => call.path.replace(/^repos\/[^/]+\/[^/]+\/contents\//, '').split('/').map(decodeURIComponent).join('/'));
  assert.equal(puts.length, 3);
  assert.match(puts[0], /private\/issue-12\/r2-[0-9a-f]{16}\.json$/, 'sidecar first');
  assert.equal(puts[1], publicFile('issue-12'), 'then the public file');
  assert.equal(puts[2], checkpointFile, 'then the checkpoint');
  const text = fx.github.textAt(REPO, BRANCH, publicFile('issue-12'));
  assert.equal(JSON.parse(text).revision, 2);
  assert.equal(fx.github.readAt(STORE_REPO, 'main', checkpointFile).files['issue-12'].sha256, state.sha256(text));
  const messages = fx.github.commitLog.filter(entry => entry.repository === REPO && entry.branch === BRANCH).map(entry => entry.message);
  assert.ok(messages.length && messages.every(message => message.endsWith('[skip ci]')), messages.join('; '));
  assert.ok(messages.includes('programme-state: issue-12 r2 [skip ci]'));
  // The same-revision sidecar a later write replaces is removed; older revisions stay.
  bumpChild(fx, doc => { doc.pending_effects = [{ intent_id: 'i-1', kind: 'replace_block', target: { issue: 12 }, state: 'IN_FLIGHT' }]; return doc; });
  bumpChild(fx, doc => { doc.pending_effects = []; return doc; });
  const listing = [...fx.github.filesAt(STORE_REPO, 'main').keys()].filter(file => file.startsWith(`${sidecarDir('issue-12')}/`));
  assert.equal(listing.filter(file => /\/r2-/.test(file)).length, 1, 'one sidecar for revision 2');
  assert.equal(listing.filter(file => /\/r1-/.test(file)).length, 1, 'revision 1 kept');
});

test('B: a stale blob is a conflict and is re-read; a lower epoch is a stale writer', () => {
  const fx = fixture();
  const store = fx.store();
  const { doc, sha } = store.read('child', 12);
  bumpChild(fx);
  assert.throws(() => store.write('child', 12, { ...doc, next_action: 'Controller: other' }, { sha, previous: doc }), { code: 'STATE_CONFLICT' });
  const taker = { session: 'controller-session-0002', prefix: 'INT-ER7-' };
  const fresh = fx.store();
  fresh.mutate('parent', 7, { writer: taker, authorise: false, change: parent => state.claimDocument(parent, taker, { takeover: true }) });
  assert.throws(() => bumpChild(fx), { code: 'STALE_WRITER' }, 'the old holder is refused');
});

test('B: a path, address, host, @, session ID or unknown key in the public part is STATE_INVALID before any write', () => {
  const cases = [
    ['a path', doc => { doc.blockers = ['C:\\Users\\example\\notes.txt']; }],
    ['an address', doc => { doc.next_action = 'Controller: read https://example.com/x'; }],
    ['a host', doc => { doc.blockers = ['db.internal.example']; }],
    ['an @', doc => { doc.blockers = ['waiting on @example-owner']; }],
    ['a session ID', doc => { doc.blockers = ['session 123e4567-e89b-12d3-a456-426614174000 stopped']; }],
    ['a raw session ID', doc => { doc.next_action = `Controller: ask ${controller.session}`; }],
  ];
  for (const [name, change] of cases) {
    const fx = fixture();
    const before = fx.writes().length;
    assert.throws(() => bumpChild(fx, doc => { change(doc); return doc; }), { code: 'STATE_INVALID' }, name);
    assert.equal(fx.writes().length, before, `${name}: nothing written`);
  }
  // An unknown key in the public part, and a monitoring finding with a host name (Slice D's rule).
  const fx = fixture();
  const view = state.publicView('parent', fx.priv.read('parent', 7).doc);
  assert.throws(() => state.validatePublic('parent', { ...view, extra: 1 }), { code: 'STATE_INVALID' });
  assert.throws(() => state.validatePublic('parent', { ...view, private: {} }), { code: 'STATE_INVALID' });
  const finding = { id: 'a'.repeat(12), source: 'monitor', code: 'MONITOR_DOWN', issue: null, head: null, state: 'new', first_seen: fx.now(), changed_at: fx.now(), host: 'db.example.com' };
  assert.throws(() => state.validatePublic('parent', { ...view, attention: [finding] }), { code: 'STATE_INVALID' });
  // The private part may hold anything the private store allowed before.
  assert.doesNotThrow(() => bumpChild(fx, doc => { doc.private = { note: 'see https://example.com and @someone' }; return doc; }));
});

test('B: the public branch is only ever state/ on the bound repository, and only this store writes it', () => {
  for (const block of [{ ...STATE_BLOCK, path: 'other/' }, { ...STATE_BLOCK, branch: 'main' }, { ...STATE_BLOCK, path: 'state/x/' }]) {
    assert.throws(() => state.validateBinding({ ...BASE, state: block }), { code: 'BINDING_INVALID' });
    assert.throws(() => new state.BranchStateStore({ transport: null, binding: { ...BASE, state: block } }), { code: 'BINDING_INVALID' });
  }
  const fx = fixture();
  bumpChild(fx);
  fx.run(['refresh']);
  for (const call of fx.github.calls.filter(entry => entry.method !== 'GET' && entry.path.startsWith(`repos/${REPO}/contents/`))) {
    assert.match(decodeURIComponent(call.path), /^repos\/example-owner\/example-repo\/contents\/state\/(?:parent|issue)-\d+\.json$/);
    assert.equal(call.body.branch, BRANCH);
  }
  // No other Toolkit script names the branch: only the state module writes it and the ruleset module protects it.
  const sources = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory() && !['node_modules', '.git', '.tmp'].includes(entry.name)) walk(file);
      else if (/\.(?:c?js|mjs|ps1|sh)$/.test(entry.name) && fs.readFileSync(file, 'utf8').includes(BRANCH)) sources.push(path.relative(ROOT, file).replace(/\\/g, '/'));
    }
  };
  walk(path.join(ROOT, 'skills'));
  walk(path.join(ROOT, 'repo', 'scripts'));
  assert.deepEqual(sources.sort(), ['repo/scripts/toolkit-governance-ruleset.cjs', 'skills/github-program-reconciler/scripts/programme-state.cjs']);
});

test('B: refresh is accepted by the stored hash, writes nothing when nothing changed, and takes no decision', () => {
  const fx = fixture();
  const first = fx.run(['refresh']);
  assert.equal(first.error, null, first.error?.message);
  const commits = fx.github.commitLog.length;
  const checkpointBefore = fx.github.textAt(STORE_REPO, 'main', checkpointFile);
  const second = fx.run(['refresh']);
  assert.equal(second.result.summary, 'No changes');
  assert.equal(fx.github.commitLog.length, commits, 'no commit on the branch or the store');
  assert.equal(fx.github.textAt(STORE_REPO, 'main', checkpointFile), checkpointBefore, 'no checkpoint edit');
  // The refresh writer carries only the hash, and decisions refuse it.
  const parentDoc = fx.store().read('parent', 7).doc;
  const writer = state.refreshWriter(parentDoc);
  assert.deepEqual(Object.keys(writer).sort(), ['by_hash', 'prefix', 'session_hash']);
  assert.equal(state.isHolder(parentDoc, writer), true);
  assert.equal(state.isDecisionHolder(parentDoc, writer), false);
  assert.equal(state.isHolder(parentDoc, { ...writer, session_hash: '0'.repeat(16) }), false);
  const context = { binding: fx.withState, writer, store: fx.store(), repository: REPO };
  const finding = state.findingId('inventory', 'NEEDS_PLACEMENT', 99, '');
  assert.throws(() => cli.commands.ack({ command: 'ack', finding }, context, {}), { code: 'ROLE_REFUSED' }, 'ack through the refresh path is refused');
  assert.throws(() => state.claimDocument(parentDoc, writer), { code: 'ROLE_REFUSED' });
  assert.throws(() => state.consumeReturn(fx.store().read('child', 12).doc, { returnId: 'r1', verdict: 'ACCEPT', writer, parentDoc }), { code: 'ROLE_REFUSED' });
});

test('B: a write that stops after its sidecar leaves an orphan that is ignored; the next write succeeds', () => {
  const fx = fixture();
  let fail = true;
  fx.github.intercept(call => (fail && call.method === 'PUT' && call.path.includes('/contents/state/issue-12.json') ? (fail = false, { status: 500, json: { message: 'stopped' } }) : undefined));
  assert.throws(() => bumpChild(fx), { code: 'GH_FAILED' });
  const orphans = [...fx.github.filesAt(STORE_REPO, 'main').keys()].filter(file => /private\/issue-12\/r2-/.test(file));
  assert.equal(orphans.length, 1, 'the orphan sidecar is there');
  assert.equal(fx.store().read('child', 12).doc.revision, 1, 'readers still join revision 1');
  assert.equal(bumpChild(fx, doc => { doc.next_action = 'Controller: try again'; return doc; }).result.doc.revision, 2);
  assert.equal(fx.store().read('child', 12).doc.next_action, 'Controller: try again');
});

test('B: a write that stops after the public file, before its checkpoint, is not applied twice; the next run sets the checkpoint from the branch', () => {
  const fx = fixture();
  fx.github.intercept(call => (call.method === 'PUT' && call.path.endsWith('checkpoint.json') ? { status: 500, json: { message: 'stopped' } } : undefined));
  const { store, result } = bumpChild(fx);
  assert.equal(result.outcome, 'WRITTEN');
  assert.ok(store.stateBranch().events.some(event => event.code === 'STATE_CHECKPOINT_STALE'));
  fx.github.hooks = [];
  const next = fx.store();
  const read = next.read('child', 12).doc;
  assert.equal(read.revision, 2, 'written once, read once');
  const cp = fx.github.readAt(STORE_REPO, 'main', checkpointFile);
  assert.equal(cp.head_sha, fx.github.head(REPO, BRANCH));
  assert.equal(cp.files['issue-12'].revision, 2);
  assert.ok(next.stateBranch().events.some(event => event.code === 'STATE_CHECKPOINT_RECOMPUTED'));
});

test('B: two computers writing the same document: one wins, the other re-reads and nothing is lost', () => {
  const fx = fixture();
  const one = fx.store();
  const two = fx.store();
  const parentDoc = one.read('parent', 7).doc;
  const a = one.read('child', 12);
  two.read('child', 12);
  // The first computer writes between the second's read and its write.
  let raced = false;
  fx.github.intercept((call, gh) => {
    if (!raced && call.method === 'PUT' && call.path.includes('/contents/state/issue-12.json') && call.body.message.includes('r2')) {
      raced = true;
      one.write('child', 12, { ...a.doc, release: 'first' }, { sha: a.sha, previous: a.doc });
    }
    return undefined;
  });
  two.mutate('child', 12, { writer: controller, parentDoc, change: doc => { doc.next_action = 'Controller: second'; return doc; } });
  const doc = fx.store().read('child', 12).doc;
  assert.equal(doc.release, 'first');
  assert.equal(doc.next_action, 'Controller: second');
});

test('B: a private store that turned public holds every public write (STORE_NOT_PRIVATE); an unreadable one is STATE_STORE_UNVERIFIED', () => {
  const fx = fixture();
  const store = fx.store();
  const parentDoc = store.read('parent', 7).doc;
  fx.github.setPrivate(STORE_REPO, false);
  const before = fx.writes().length;
  assert.throws(() => store.mutate('child', 12, { writer: controller, parentDoc, change: doc => { doc.release = 'x'; return doc; } }), { code: 'STORE_NOT_PRIVATE' });
  assert.equal(fx.writes().length, before, 'no sidecar and no public write');
  assert.throws(() => fx.store().verify(), { code: 'STATE_STORE_UNVERIFIED' });
  fx.github.setPrivate(STORE_REPO, true);
  fx.github.intercept(call => (call.method === 'GET' && call.path === `repos/${STORE_REPO}` ? { status: 503, json: { message: 'down' } } : undefined));
  assert.throws(() => store.mutate('child', 12, { writer: controller, parentDoc, change: doc => { doc.release = 'x'; return doc; } }), { code: 'STATE_STORE_UNVERIFIED' });
  assert.equal(fx.writes().length, before);
});

test('B: journals stay in the private store; blockers text never reaches the branch', () => {
  const fx = fixture();
  const store = fx.store();
  const hash = checkpoint.sessionHash('executor-session-0001');
  const journal = { schema: state.SCHEMA.journal, repository: REPO, issue: 12, assignment: 'g1-a1', session_hash: hash, completion_mode: 'native', route: null, seq: 1,
    checkpoint: null, returns: [{ return_id: 'r1', verdict_requested: 'ACCEPT', at_head: null, next_action: 'Controller: review', blockers: ['waiting on the owner'] }], last_error: null };
  const name = `g1-a1--${hash}.json`;
  store.writeJournal(12, name, journal, { sha: null, previous: null });
  assert.ok(fx.github.textAt(STORE_REPO, 'main', `${STORE.path}journal/issue-12/${name}`));
  assert.equal([...fx.github.filesAt(REPO, BRANCH).keys()].some(file => file.includes('journal')), false);
  assert.deepEqual(store.listJournals(12).map(file => file.name), [name]);
});

test('B: a binding with state and no store is BINDING_INVALID, nothing is written, and governance answers as for any invalid binding', () => {
  const binding = { ...BASE, state: STATE_BLOCK };
  delete binding.store;
  assert.throws(() => state.validateBinding(binding), { code: 'BINDING_INVALID' });
  assert.throws(() => state.validateBinding({ ...binding, governance: 'disabled', parents: undefined, required_checks: undefined }), { code: 'BINDING_INVALID' });
  // The governance reader turns any binding validateBinding refuses into the same answer: covered by
  // toolkit-governance-binding.test.cjs, which runs unchanged.
});

// ---------------------------------------------------------------------------------------------
// C. Recovery

test('C: a deleted branch whose checkpoint commit is still served and matches is restored at that commit', () => {
  const fx = fixture();
  bumpChild(fx);
  const head = fx.github.head(REPO, BRANCH);
  fx.github.deleteBranch(REPO, BRANCH);
  const { result, error } = fx.run(['show', '--issue', '12']);
  assert.equal(error, null, error?.message);
  assert.equal(fx.github.head(REPO, BRANCH), head);
  assert.equal(result.state_branch.events[0].code, 'STATE_RESTORED');
  assert.equal(result.document.revision, 2);
});

test('C: a deleted branch whose commit is gone is rebuilt from the sidecars when every digest matches', () => {
  const fx = fixture();
  bumpChild(fx);
  const head = fx.github.head(REPO, BRANCH);
  fx.github.deleteBranch(REPO, BRANCH);
  fx.github.dropCommit(REPO, head);
  const store = fx.store();
  assert.equal(store.read('child', 12).doc.revision, 2);
  const rebuilt = fx.github.head(REPO, BRANCH);
  assert.notEqual(rebuilt, head);
  assert.match(fx.github.git(REPO).commits.get(rebuilt).message, /rebuilt .* \[skip ci\]$/);
  assert.equal(store.stateBranch().events[0].code, 'STATE_REBUILT');
  assert.equal(fx.github.readAt(STORE_REPO, 'main', checkpointFile).head_sha, rebuilt);
});

test('C: a deleted branch with unsettled intents holds and shows the intent', () => {
  const fx = fixture();
  bumpChild(fx, doc => { doc.pending_effects = [{ intent_id: 'intent-7', kind: 'replace_block', target: { issue: 12 }, state: 'IN_FLIGHT' }]; return doc; });
  fx.github.deleteBranch(REPO, BRANCH);
  const posts = fx.writes().length;
  assert.throws(() => fx.store().read('child', 12), error => error.code === 'STATE_RESTORE_HELD' && /intent-7/.test(error.message));
  assert.equal(fx.writes().length, posts, 'nothing restored');
  assert.equal(fx.github.head(REPO, BRANCH), null);
});

test('C: a deleted branch with no matching commit or sidecar holds and is never started empty', () => {
  const fx = fixture();
  const head = fx.github.head(REPO, BRANCH);
  fx.github.deleteBranch(REPO, BRANCH);
  fx.github.dropCommit(REPO, head);
  for (const file of [...fx.github.filesAt(STORE_REPO, 'main').keys()].filter(name => name.includes('/private/'))) fx.github.writeRaw(STORE_REPO, 'main', file, null);
  const store = fx.store();
  assert.throws(() => store.read('parent', 7), { code: 'STATE_RESTORE_HELD' });
  assert.throws(() => store.read('parent', 7), { code: 'STATE_RESTORE_HELD' }, 'still held');
  assert.equal(fx.github.head(REPO, BRANCH), null);
  assert.equal(fx.github.calls.some(call => call.method === 'POST' && call.path.endsWith('/git/refs')), true, 'only the migration created a ref');
  assert.equal(fx.github.calls.filter(call => call.method === 'POST' && call.path.endsWith('/git/refs')).length, 1);
});

test('C: a branch never created reads as not created; writes are refused; a local checkpoint alone holds', () => {
  const fx = fixture({ migrate: false });
  const store = fx.store();
  assert.deepEqual(store.read('parent', 7), { doc: null, sha: null });
  assert.throws(() => store.write('parent', 7, fx.priv.read('parent', 7).doc, { sha: null, previous: null }), { code: 'STATE_BRANCH_MISSING' });
  const held = state.openStore({ transport: fx.github, binding: fx.withState, now: fx.now, localCheckpoint: { read: () => ({ head_sha: 'a'.repeat(40) }), write() {} } });
  assert.throws(() => held.read('parent', 7), { code: 'STATE_RESTORE_HELD' });
  assert.equal(fx.github.head(REPO, BRANCH), null);
});

test('C: a branch pushed back below the checkpoint, or a file removed, holds and reports', () => {
  const fx = fixture();
  const first = fx.github.head(REPO, BRANCH);
  bumpChild(fx);
  fx.github.setBranch(REPO, BRANCH, first);
  assert.throws(() => fx.store().read('child', 12), { code: 'STATE_ROLLED_BACK' });
  const other = fixture();
  other.github.writeRaw(REPO, BRANCH, publicFile('issue-12'), null);
  assert.throws(() => other.store().read('child', 12), { code: 'STATE_ROLLED_BACK' });
});

test('C: a hand edit to invalid is STATE_INVALID; a valid-looking edit without a sidecar holds', () => {
  const fx = fixture();
  const text = fx.github.textAt(REPO, BRANCH, publicFile('issue-12'));
  fx.github.writeRaw(REPO, BRANCH, publicFile('issue-12'), text.replace('"next_action": "', '"next_action": "see https://example.com '));
  assert.throws(() => fx.store().read('child', 12), { code: 'STATE_INVALID' });
  const other = fixture();
  const raw = other.github.textAt(REPO, BRANCH, publicFile('issue-12'));
  other.github.writeRaw(REPO, BRANCH, publicFile('issue-12'), raw.replace('"next_action": "', '"next_action": "Edited: '));
  const store = other.store();
  assert.throws(() => store.read('child', 12), { code: 'STATE_SIDECAR_MISSING' });
});

test('C: a binding without state never restores or creates the branch, and leaves it in place', () => {
  const fx = fixture();
  fx.github.deleteBranch(REPO, BRANCH);
  const store = fx.store(fx.withoutState);
  store.read('parent', 7);
  store.mutate('parent', 7, { writer: controller, change: doc => { doc.release_plan = { record: 'R1', comment_id: null }; return doc; } });
  assert.equal(fx.github.head(REPO, BRANCH), null, 'nothing restored');
  assert.equal(fx.github.calls.some(call => call.path.includes(BRANCH) && call.method !== 'GET'), false);
  const kept = fixture();
  const head = kept.github.head(REPO, BRANCH);
  kept.store(kept.withoutState).read('parent', 7);
  assert.equal(kept.github.head(REPO, BRANCH), head, 'the branch is kept, never deleted');
  // A disabled binding never opens a store at all.
  const disabled = kept.run(['show'], { binding: undefined, originUrl: undefined, repoRoot: kept.dir });
  assert.notEqual(disabled.error, null);
});

test('C: when the branch is gone, the hourly refresh restores it by the same path or holds and reports', () => {
  const fx = fixture();
  bumpChild(fx);
  fx.github.deleteBranch(REPO, BRANCH);
  const { result, error } = fx.run(['refresh']);
  assert.equal(error, null, error?.message);
  assert.equal(result.state_branch.events[0].code, 'STATE_RESTORED');
  const text = cli.formatReport(result);
  assert.match(text, /STATE_RESTORED/);
  const held = fixture();
  const head = held.github.head(REPO, BRANCH);
  held.github.deleteBranch(REPO, BRANCH);
  held.github.dropCommit(REPO, head);
  for (const file of [...held.github.filesAt(STORE_REPO, 'main').keys()].filter(name => name.includes('/private/'))) held.github.writeRaw(STORE_REPO, 'main', file, null);
  assert.equal(held.run(['refresh']).error.code, 'STATE_RESTORE_HELD');
});

// ---------------------------------------------------------------------------------------------
// M. Writes between the move and the binding merge

const applyAgain = (fx, binding) => {
  const dry = fx.run(['migrate-state', '--dry-run'], { binding });
  if (dry.error) return dry;
  return fx.run(['migrate-state', '--apply', '--plan-digest', dry.result.plan_digest, '--controller', '--session', controller.session], { binding, ask: () => 'yes' });
};

test('M: a write that reached the private store after the move holds the first branch read; moving again carries it over', () => {
  const fx = fixture();
  assert.match(fx.migration.until_merged, /stop the programme sweep/);
  // Before the binding merges, a write still goes to the private store.
  const parentDoc = fx.priv.read('parent', 7).doc;
  fx.priv.mutate('child', 12, { writer: controller, parentDoc, change: doc => { doc.next_action = 'Controller: written before the merge'; return doc; } });
  const before = fx.writes().length;
  assert.throws(() => fx.store().read('child', 12), error => error.code === 'STATE_MIGRATION_STALE' && /issue-12/.test(error.message));
  assert.throws(() => fx.store().read('parent', 7), { code: 'STATE_MIGRATION_STALE' }, 'every read holds, not only the changed document');
  assert.equal(fx.writes().length, before, 'nothing written while held');
  // The move runs again, after the binding merged (and before it).
  const again = applyAgain(fx, fx.withState);
  assert.equal(again.error, null, again.error?.message);
  assert.equal(again.result.again, true);
  const head = fx.github.head(REPO, BRANCH);
  assert.deepEqual(fx.github.git(REPO).commits.get(head).parents, [fx.migration.head], 'the branch moved forward, not replaced');
  assert.match(fx.github.git(REPO).commits.get(head).message, /^programme-state: migrate again 2 document\(s\) \[skip ci\]$/);
  const store = fx.store();
  assert.equal(store.read('child', 12).doc.next_action, 'Controller: written before the merge');
  assert.deepEqual(store.read('child', 12).doc, fx.priv.read('child', 12).doc);
  // With nothing newer there is nothing to move.
  assert.equal(applyAgain(fx, fx.withState).error.code, 'STATE_MIGRATED');
  assert.equal(applyAgain(fx, fx.withoutState).error.code, 'STATE_BRANCH_EXISTS');
});

test('M: once the branch has been written, a later private-store write still holds and is never moved over it', () => {
  const fx = fixture();
  bumpChild(fx);
  const parentDoc = fx.priv.read('parent', 7).doc;
  fx.priv.mutate('child', 12, { writer: controller, parentDoc, change: doc => { doc.release = 'from a stale binding'; return doc; } });
  assert.throws(() => fx.store().read('child', 12), { code: 'STATE_MIGRATION_STALE' });
  const head = fx.github.head(REPO, BRANCH);
  const again = applyAgain(fx, fx.withState);
  assert.equal(again.error.code, 'STATE_MIGRATED');
  assert.equal(fx.github.head(REPO, BRANCH), head, 'the branch is not replaced');
  // A new document in the private store holds too.
  const other = fixture();
  other.priv.write('child', 13, { ...state.newChild({ repository: REPO, outcome: { issue: 13, class: 'COMMITTED', parent: 7, order: 2 } }) }, { sha: null, previous: null });
  assert.throws(() => other.store().read('parent', 7), error => error.code === 'STATE_MIGRATION_STALE' && /issue-13/.test(error.message));
});

test('M: the owner\'s typed yes is never asked in a shell a coding agent started', () => {
  const fx = fixture({ migrate: false });
  const dry = fx.run(['migrate-state', '--dry-run'], { binding: fx.withoutState }).result;
  const markers = require('../scripts/toolkit-env.cjs').AGENT_MARKERS;
  assert.ok(markers.includes('CLAUDECODE') && markers.includes('CODEX_THREAD_ID'));
  for (const marker of markers) {
    let asked = false;
    const refused = fx.run(['migrate-state', '--apply', '--plan-digest', dry.plan_digest, '--controller', '--session', controller.session],
      { binding: fx.withoutState, environment: { [marker]: '1' }, ask: () => { asked = true; return 'yes'; } });
    assert.equal(refused.error?.code, 'NOT_CONFIRMED', marker);
    assert.match(refused.error.message, new RegExp(marker));
    assert.equal(asked, false, `${marker}: never asked`);
  }
  assert.equal(fx.github.head(REPO, BRANCH), null);
});

test('B: when a checkpoint write fails, the sidecar the old checkpoint names is kept', () => {
  const fx = fixture();
  const { store } = bumpChild(fx);
  const before = [...fx.github.filesAt(STORE_REPO, 'main').keys()].filter(file => /private\/issue-12\/r2-/.test(file));
  assert.equal(before.length, 1);
  fx.github.intercept(call => (call.method === 'PUT' && call.path.endsWith('checkpoint.json') ? { status: 500, json: { message: 'stopped' } } : undefined));
  const parentDoc = store.read('parent', 7).doc;
  store.mutate('child', 12, { writer: controller, parentDoc, change: doc => { doc.pending_effects = [{ intent_id: 'i-2', kind: 'replace_block', target: { issue: 12 }, state: 'IN_FLIGHT' }]; return doc; } });
  const after = [...fx.github.filesAt(STORE_REPO, 'main').keys()].filter(file => /private\/issue-12\/r2-/.test(file));
  assert.equal(after.length, 2, 'the replaced revision 2 sidecar stays while the checkpoint names it');
  assert.ok(after.includes(before[0]));
});
