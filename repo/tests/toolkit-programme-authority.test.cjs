'use strict';

// Fence, authority and evidence-truth cases for the programme reconciler, including the closure
// cases from its first independent review: a takeover stops a running pass, an executor cannot
// record its own acceptance, head-bound evidence without a head reads stale, a body hold leaves the
// links alone, secret-shaped values are refused, and runtime validation matches the schemas.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const Ajv2020 = require('ajv/dist/2020');
const state = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');
const { FakeGitHub } = require('./toolkit-programme-fake-github.cjs');

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const controller = { session: 'controller-1', prefix: 'INT-TK421-' };
const successor = { session: 'controller-2', prefix: 'INT-TK421-' };
const builder = { session: 'builder-1', prefix: 'INT-TK421-' };
const green = name => ({ kind: 'CheckRun', name, status: 'COMPLETED', conclusion: 'SUCCESS', required: false });
const CATALOGUE = [
  { issue: 423, label: 'C2', class: 'CORE', parent: 421, order: 1 },
  { issue: 467, label: 'Shared H', class: 'CORE', parent: 421, order: 2 },
  { issue: 469, label: 'H1', class: 'CORE', parent: 467, order: 1 },
  { issue: 470, label: 'H2', class: 'CORE', parent: 467, order: 2 },
  { issue: 471, label: 'H3', class: 'CORE', parent: 467, order: 3 },
];

function setup() {
  const repository = 'acme/app';
  const github = new FakeGitHub({ repository, store: 'acme/state-store' });
  const binding = {
    schema: state.SCHEMA.binding, repository, parent_issue: 421, record_prefix: 'INT-TK421-', writer_prefix: 'INT-TK421-',
    store: { kind: 'github', repository: 'acme/state-store', branch: 'main', path: `state/${repository}/` }, required_checks: ['validate'],
  };
  github.addIssue(421, { body: '## CURRENT\n' });
  for (const outcome of CATALOGUE) github.addIssue(outcome.issue, { body: `Body of ${outcome.issue}` });
  let clock = 0;
  const store = new state.StateStore({ transport: github, store: binding.store, now: () => `T${clock += 1}`, toolkitVersion: '3.9.0' });
  store.write('parent', 421, state.claimDocument(state.newParent({ repository, parentIssue: 421, outcomes: CATALOGUE }), controller, {}), { sha: null, previous: null });
  const reconciler = (who = controller) => new state.Reconciler({
    store, reader: new state.ProgrammeGraphReader({ transport: github, repository }),
    mutator: new state.GitHubMutator({ transport: github, repository }), binding, writer: who, toolkitVersion: '3.9.0',
  });
  const parentDoc = () => store.read('parent', 421).doc;
  const claimAsBuilder = () => store.mutate('child', 423, { writer: builder, authorise: false, create: () => state.newChild({ repository, outcome: CATALOGUE[0] }), change: doc => state.claimDocument(doc, builder, { role: 'G1' }) });
  return { github, store, reconciler, parentDoc, claimAsBuilder };
}

test('a takeover during a pass stops the old writer before its next GitHub or state write', () => {
  const { github, store, reconciler } = setup();
  let takenAt = null;
  github.intercept(call => {
    if (takenAt === null && call.method === 'POST' && /\/sub_issues$/.test(call.path)) {
      store.mutate('parent', 421, { writer: successor, authorise: false, change: doc => state.claimDocument(doc, successor, { takeover: true }) });
      takenAt = github.calls.length;
    }
    return undefined;
  });
  assert.throws(() => reconciler(controller).run({ apply: true }), { code: 'STALE_WRITER' });
  const writesAfter = github.calls.slice(takenAt).filter(call => call.method !== 'GET' && call.path !== 'graphql');
  assert.deepEqual(writesAfter.map(call => `${call.method} ${call.path}`), [], 'the old writer made no GitHub or store write after the takeover');
  // The interrupted attach is left IN_FLIGHT and the successor settles it by readback, without replay.
  const inFlight = store.read('child', 423).doc.pending_effects;
  assert.deepEqual(inFlight.map(effect => effect.state), ['IN_FLIGHT']);
  const attachesBefore = github.calls.filter(call => call.method === 'POST' && call.body?.sub_issue_id === github.issues.get(423).id).length;
  const recovered = reconciler(successor).run({ apply: true });
  assert.ok(recovered.recovered.some(entry => entry.outcome === 'DONE'));
  assert.equal(github.calls.filter(call => call.method === 'POST' && call.body?.sub_issue_id === github.issues.get(423).id).length, attachesBefore);
  assert.deepEqual(recovered.holds, []);
  assert.equal(reconciler(successor).run().summary, 'No changes');
});

test('an executor cannot accept its own return; the controller can', () => {
  const { store, parentDoc, claimAsBuilder } = setup();
  claimAsBuilder();
  store.mutate('child', 423, { writer: builder, parentDoc: parentDoc(), change: doc => state.submitReturn(doc, { returnId: 'r1', writer: builder }) });
  assert.throws(() => store.mutate('child', 423, { writer: builder, parentDoc: parentDoc(), change: doc => state.consumeReturn(doc, { returnId: 'r1', verdict: 'ACCEPT', writer: builder, parentDoc: parentDoc() }) }), { code: 'ROLE_REFUSED' });
  assert.equal(store.read('child', 423).doc.gate.state, 'SUBMITTED');
  store.mutate('child', 423, { writer: controller, parentDoc: parentDoc(), change: doc => state.consumeReturn(doc, { returnId: 'r1', verdict: 'ACCEPT', writer: controller, parentDoc: parentDoc() }) });
  assert.equal(store.read('child', 423).doc.gate.state, 'RETIRED');
});

test('an executor cannot record its own UAT, review or completion', () => {
  const { store, parentDoc, claimAsBuilder } = setup();
  claimAsBuilder();
  const patch = { lifecycle: 'DONE', uat: { state: 'PASSED', at_head: SHA_A }, review: { state: 'PASSED', verdicts: [{ reviewer: 'self', head: SHA_A, verdict: 'PASSED' }] } };
  assert.throws(() => store.mutate('child', 423, { writer: builder, parentDoc: parentDoc(), change: doc => state.applyPatch('child', doc, patch, { writer: builder, parentDoc: parentDoc() }) }), { code: 'ROLE_REFUSED' });
  const doc = store.read('child', 423).doc;
  assert.deepEqual([doc.lifecycle, doc.uat.state, doc.review.state], ['ACTIVE', null, null]);
});

test('UAT or review evidence without its head is refused on write and rendered stale', () => {
  const { github, store, reconciler, parentDoc } = setup();
  const write = patch => store.mutate('child', 423, { writer: controller, parentDoc: parentDoc(), change: doc => state.applyPatch('child', doc, patch, { writer: controller, parentDoc: parentDoc() }) });
  github.addPr(540, { head: SHA_A, contexts: [green('validate')], branch: 'feature' });
  reconciler().run({ apply: true });
  assert.throws(() => write({ uat: { state: 'PASSED' } }), { code: 'STATE_INVALID' });
  assert.throws(() => write({ uat: { state: 'UAT_RETAINED', at_head: null } }), { code: 'STATE_INVALID' });
  assert.throws(() => write({ review: { state: 'PASSED', verdicts: [] } }), { code: 'STATE_INVALID' });
  assert.throws(() => write({ review: { state: 'NOT_PASSED' } }), { code: 'STATE_INVALID' });
  write({ candidate: { branch: 'feature', head: SHA_A }, uat: { state: 'PASSED', at_head: SHA_A }, review: { state: 'PASSED', verdicts: [{ reviewer: 'g2', head: SHA_A, verdict: 'PASSED' }] } });
  reconciler().run({ apply: true });
  assert.match(state.findStateBlock(github.issues.get(423).body).block.body, /UAT: PASSED; review: PASSED\n/);
  github.prs.get(540).head = SHA_B;
  github.prs.get(540).rollupOid = SHA_B;
  reconciler().run({ apply: true });
  assert.match(state.findStateBlock(github.issues.get(423).body).block.body, /UAT: PASSED \(STALE_HEAD, was aaaaaaa\); review: PASSED \(STALE_HEAD\)/);

  // Rendering stays safe even for a document that bypassed validation.
  const doc = { ...store.read('child', 423).doc, uat: { state: 'PASSED', at_head: null }, review: { state: 'PASSED', verdicts: [] } };
  const body = state.renderChildBlockBody(doc, CATALOGUE[0]);
  assert.match(body, /UAT: PASSED \(STALE_HEAD, head not recorded\); review: PASSED \(STALE_HEAD, no verdict recorded\)/);
  // A current-head verdict beside an older one is current.
  const mixed = { ...doc, uat: { state: 'PENDING', at_head: null }, review: { state: 'PASSED', verdicts: [{ reviewer: 'a', head: SHA_A, verdict: 'NOT_PASSED' }, { reviewer: 'a', head: SHA_B, verdict: 'PASSED' }] } };
  assert.match(state.renderChildBlockBody(mixed, CATALOGUE[0]), /UAT: PENDING; review: PASSED\n/);
});

test('a body hold skips only that issue\'s body, not its native link', () => {
  const { github, reconciler } = setup();
  github.issues.get(469).body = 'x'.repeat(59990);
  const report = reconciler().run({ apply: true });
  assert.ok(report.holds.some(hold => hold.code === 'BODY_TOO_LARGE' && hold.target === '#469'));
  assert.equal(github.issues.get(469).parent, 467);
  assert.equal(report.results.find(entry => entry.kind === 'attach' && entry.target.issue === 469).outcome, 'DONE');
});

test('secret-shaped values are refused anywhere in a state document or binding, without echoing them', () => {
  const { github, store, reconciler, parentDoc } = setup();
  reconciler().run({ apply: true });
  const commits = github.commits;
  const values = [
    `ghp_${'A1b2C3d4E5'.repeat(4)}`, `github_pat_${'x1'.repeat(15)}`, `sk-ant-${'k'.repeat(30)}`, `AKIA${'A'.repeat(16)}`,
    `xoxb-${'1'.repeat(12)}`, `AIza${'B'.repeat(35)}`, `eyJ${'a'.repeat(12)}.eyJ${'b'.repeat(12)}.${'c'.repeat(12)}`, `Bearer ${'t'.repeat(30)}`,
  ];
  for (const value of values) {
    for (const patch of [{ next_action: `Retry with ${value}` }, { private: { note: value } }, { blockers: [value] }]) {
      let error = null;
      try { store.mutate('child', 423, { writer: controller, parentDoc: parentDoc(), change: doc => state.applyPatch('child', doc, patch, { writer: controller, parentDoc: parentDoc() }) }); }
      catch (caught) { error = caught; }
      assert.equal(error?.code, 'STATE_INVALID', `${JSON.stringify(patch).slice(0, 40)} was accepted`);
      assert.equal(error.message.includes(value) || JSON.stringify(error.details).includes(value), false, 'the error repeats the value');
    }
  }
  assert.equal(github.commits, commits, 'nothing reached the store');
  assert.equal(github.issues.get(423).body.includes('ghp_'), false);
  const key = '-----BEGIN ' + 'PRIVATE KEY-----';
  assert.throws(() => state.assertValid('child', { ...store.read('child', 423).doc, private: { pem: key } }), { code: 'STATE_INVALID' });
  const binding = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', '.github', 'toolkit-programme.json'), 'utf8'));
  assert.throws(() => state.validateBinding({ ...binding, required_checks: [values[0]] }), /looks like a GitHub token/);
  assert.doesNotThrow(() => state.assertValid('child', store.read('child', 423).doc), 'ordinary documents pass');
});

test('runtime validation matches the schemas on unknown and missing nested fields', () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const schema = name => JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'contracts', 'programme-state', name), 'utf8'));
  const validateChild = ajv.compile(schema('child-state-v1.schema.json'));
  const validateParent = ajv.compile(schema('parent-state-v1.schema.json'));
  const base = () => state.newChild({ repository: 'acme/app', outcome: CATALOGUE[0] });
  const mutations = [
    doc => { doc.uat = { state: 'PENDING', at_head: null, token_note: 'x' }; },
    doc => { delete doc.uat.at_head; },
    doc => { doc.extra = 1; },
    doc => { delete doc.release; },
    doc => { doc.gate.route = { model: 'm', effort: 'e', read_back: true, note: 'x' }; },
    doc => { doc.gate.returns.push({ return_id: 'r', verdict: null, consumed: false, epoch: 0, by: 'x' }); },
    doc => { doc.pr.checks.extra = true; },
    doc => { doc.candidate.extra = null; },
    doc => { doc.fence.extra = 1; },
    doc => { doc.review = { state: 'IN_REVIEW', verdicts: [{ reviewer: 'r', head: SHA_A, verdict: 'PASSED', note: 'x' }] }; },
    doc => { doc.pending_effects.push({ intent_id: 'i', kind: 'attach', target: {}, state: 'IN_FLIGHT', extra: 1 }); },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const doc = base();
    mutate(doc);
    assert.equal(validateChild(doc), false, `schema accepts mutation ${index}`);
    assert.notDeepEqual(state.validateChild(doc), [], `runtime accepts mutation ${index}`);
  }
  const parent = state.newParent({ repository: 'acme/app', parentIssue: 421, outcomes: [{ ...CATALOGUE[0], note: 'x' }] });
  assert.equal(validateParent(parent), false);
  assert.notDeepEqual(state.validateParent(parent), []);
  const missingParentKey = state.newParent({ repository: 'acme/app', parentIssue: 421, outcomes: [{ issue: 423, class: 'CORE', order: 1 }] });
  assert.equal(validateParent(missingParentKey), false);
  assert.notDeepEqual(state.validateParent(missingParentKey), []);
});

test('without the opt-in binding the command line refuses before any GitHub call', () => {
  const cli = require('../../skills/github-program-reconciler/scripts/programme.cjs');
  const github = new FakeGitHub();
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'programme-unbound-'));
  try {
    for (const argv of [['reconcile'], ['reconcile', '--apply', '--session', 's'], ['show'], ['claim', '--issue', '1', '--session', 's']]) {
      assert.throws(() => cli.main(argv, { transport: github, repoRoot: dir, originUrl: 'https://github.com/acme/app.git', stdout: { write() {} } }), { code: 'BINDING_MISSING' });
    }
    assert.equal(github.calls.length, 0, 'no GitHub call is made in a repository that has not opted in');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
