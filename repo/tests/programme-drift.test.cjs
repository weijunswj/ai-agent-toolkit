'use strict';

// Drift findings: part of the programme that fell behind its state with nothing in the pass to fix
// it is reported, and each finding resolves by itself once its condition is gone.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const state = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');
const drift = require('../../skills/github-program-reconciler/scripts/programme-drift.cjs');
const { FakeGitHub } = require('./toolkit-programme-fake-github.cjs');

const VERSION = '3.9.1';
const SHA_A = 'a'.repeat(40);
const writer = { session: 'controller-1', prefix: 'INT-TK421-' };
const START = Date.parse('2026-11-01T00:00:00Z');
const ROOT = path.resolve(__dirname, '..', '..');

function setup({ outcomes = [{ issue: 806, class: 'COMMITTED', order: 1 }] } = {}) {
  const repository = 'acme/app';
  const github = new FakeGitHub({ repository, store: 'acme/state-store' });
  const binding = {
    schema: state.SCHEMA.binding, repository, parent_issue: 421, record_prefix: 'INT-TK421-', writer_prefix: 'INT-TK421-',
    store: { kind: 'github', repository: 'acme/state-store', branch: 'main', path: `state/${repository}/` }, required_checks: ['validate'],
  };
  github.addIssue(421, { body: '# Programme\n' });
  for (const outcome of outcomes) github.addIssue(outcome.issue, { body: `Body of ${outcome.issue}`, parent: 421 });
  const time = { now: START };
  const now = () => new Date(time.now).toISOString();
  const store = new state.StateStore({ transport: github, store: binding.store, now, toolkitVersion: VERSION });
  store.write('parent', 421, state.claimDocument(state.newParent({ repository, parentIssue: 421, outcomes: outcomes.map(outcome => ({ parent: 421, ...outcome })) }), writer, {}), { sha: null, previous: null });
  const reconciler = () => new state.Reconciler({
    store, reader: new state.ProgrammeGraphReader({ transport: github, repository }),
    mutator: new state.GitHubMutator({ transport: github, repository }), binding, writer, toolkitVersion: VERSION, now,
  });
  const open = code => (store.read('parent', 421).doc.attention || []).filter(entry => entry.code === code && ['new', 'acknowledged'].includes(entry.state));
  return { github, store, reconciler, time, open };
}
const codes = report => report.findings.filter(finding => drift.DRIFT_CODES.includes(finding.code));

test('every drift code is a reconcile finding with a next step, in the runtime table and the schema alike', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'repo/contracts/programme-state/parent-state-v1.schema.json'), 'utf8'));
  const listed = JSON.stringify(schema);
  for (const code of drift.DRIFT_CODES) {
    assert.equal(state.FINDING_CODES[code].source, 'reconcile', code);
    assert.match(state.FINDING_CODES[code].next_action, /^Controller: /, code);
    assert.ok(listed.includes(`"${code}"`), `${code} is in the parent schema's code list`);
  }
});

test('page drift: a page with no blocks or an older state is reported only when nothing redraws it or says why', () => {
  const page = (block, extra = {}) => ({ number: 806, block, planned: false, explained: false, holding: [], ...extra });
  assert.deepEqual(drift.pageDrift([page('current')]), []);
  assert.deepEqual(drift.pageDrift([page('missing', { planned: true }), page('behind', { explained: true })]), []);
  assert.deepEqual(drift.pageDrift([page('missing')]).map(entry => entry.code), ['BLOCKS_MISSING']);
  const [behind] = drift.pageDrift([page('behind', { holding: ['replace_block'] })]);
  assert.equal(behind.code, 'BLOCK_BEHIND');
  assert.match(behind.detail, /held by replace_block left in flight/, 'the holding effect is named');
  assert.match(drift.pageDrift([page('behind')])[0].detail, /no effect is in flight/);
});

test('reference drift: only a closed issue outside the programme that an open task PR names', () => {
  const context = { parentIssue: 421, catalogued: new Set([806]), registered: new Set([421, 500]) };
  const candidates = drift.referenceCandidates({ references: new Map([[806, [950]], [900, [950]], [901, [951]], [902, [950]], [421, [950]], [500, [950]], [960, [950]]]),
    taskPrs: new Set([950]), knownPrs: new Set([960]), ...context });
  assert.deepEqual(candidates, [{ number: 900, prs: [950] }, { number: 902, prs: [950] }], 'task issues, parents, PRs and issues only a non-task PR names are left out');
  const facts = { 900: { state: 'closed', parent: null, is_pull_request: false }, 902: { state: 'open', parent: null, is_pull_request: false } };
  assert.deepEqual(drift.referenceDrift(candidates.map(entry => ({ ...entry, facts: facts[entry.number] })), context).map(entry => [entry.code, entry.issue]), [['CHILD_NOT_NATIVE', 900]],
    'an open issue under no registered parent is the inventory\'s NEEDS_PLACEMENT, so it is not reported twice');
  for (const parent of [421, 806, 500]) assert.deepEqual(drift.referenceDrift([{ number: 900, prs: [950], facts: { ...facts[900], parent } }], context), [], `under #${parent}`);
  assert.deepEqual(drift.referenceDrift([{ number: 900, prs: [950], facts: null }], context), [], 'an unread issue is never guessed');
});

test('next action drift: set before the latest merge or close, never guessed for an older document', () => {
  const task = (since, at) => ({ number: 806, nextAction: 'Executor: start G1', since, latest: at ? { at, what: 'the merge of PR #950' } : null });
  assert.deepEqual(drift.nextActionDrift([task('2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z'), task('2026-11-02T00:00:00Z', '2026-11-01T00:00:00Z'), task(null, '2026-11-02T00:00:00Z'), task('2026-11-01T00:00:00Z', null)]), []);
  const [stale] = drift.nextActionDrift([task('2026-11-01T00:00:00Z', '2026-11-02T03:04:00Z')]);
  assert.equal(stale.code, 'NEXT_ACTION_STALE');
  assert.match(stale.detail, /set at 2026-11-01T00:00Z, before the merge of PR #950 at 2026-11-02T03:04Z/);
  // The time is kept on create and on every change of the next action, and only then.
  const doc = { next_action: 'A', private: {} };
  assert.equal(drift.stampNextAction(null, structuredClone(doc), 'T1').private.next_action_at, 'T1');
  assert.equal(drift.stampNextAction({ next_action: 'A', private: {} }, structuredClone(doc), 'T2').private.next_action_at, undefined);
  assert.equal(drift.stampNextAction({ next_action: 'B' }, structuredClone(doc), 'T3').private.next_action_at, 'T3');
});

test('a full pass that redraws a new task page raises no drift: only what nothing fixes is drift', () => {
  const f = setup();
  f.github.addPr(950, { head: SHA_A, body: 'Refs #806' });
  const report = f.reconciler().run({ apply: true });
  assert.deepEqual(report.holds, []);
  assert.deepEqual(codes(report), []);
  assert.ok(state.findStateBlock(f.github.issues.get(806).body).block, 'the page was drawn in the same pass');
  assert.deepEqual(codes(f.reconciler().run({ apply: true })), []);
});

test('an open task PR naming a closed issue outside the programme raises CHILD_NOT_NATIVE, which resolves once the PR stops naming it', () => {
  const f = setup();
  f.github.addIssue(900, { state: 'closed' });
  f.github.addPr(950, { head: SHA_A, body: 'Refs #806, #900' });
  assert.deepEqual(f.reconciler().run({ apply: true }).holds, []);
  assert.deepEqual(f.open('CHILD_NOT_NATIVE').map(entry => entry.issue), [900]);
  f.github.prs.get(950).body = 'Refs #806';
  f.reconciler().run({ apply: true });
  assert.deepEqual(f.open('CHILD_NOT_NATIVE'), []);
});

test('an open task PR whose PATH markers are broken raises PR_NAV_MISSING; an issue-scoped pass checks no drift', () => {
  const f = setup();
  const broken = '<!-- AI-AGENT-TOOLKIT:programme-state:BEGIN NAV v2 toolkit=3.9.1 sha256=000000000000 -->\n# PATH\n';
  f.github.addPr(950, { head: SHA_A, body: `${broken}Refs #806` });
  const scoped = f.reconciler().run({ issue: 806 });
  assert.deepEqual(codes(scoped), []);
  const report = f.reconciler().run({ apply: true });
  const found = codes(report).filter(entry => entry.code === 'PR_NAV_MISSING');
  assert.deepEqual(found.map(entry => entry.issue), [950]);
  assert.match(found[0].detail, /markers on the PR page are broken/);
  assert.deepEqual(f.open('PR_NAV_MISSING').map(entry => entry.issue), [950]);
});

test('a task whose PR merged after its next action was set raises NEXT_ACTION_STALE until the next action changes', () => {
  const f = setup();
  f.reconciler().run({ apply: true });
  const { doc, sha } = f.store.read('child', 806);
  assert.equal(doc.private.next_action_at, '2026-11-01T00:00:00.000Z', 'the time the next action was set is kept');
  f.github.addPr(950, { head: SHA_A, merged: true, mergedAt: '2026-11-02T00:00:00Z', body: 'Refs #806' });
  f.store.write('child', 806, { ...doc, pr: { number: 950, state: 'OPEN', head: SHA_A, checks: { state: 'UNKNOWN', required_total: 0, required_passed: 0, at_head: null } } }, { sha, previous: doc });
  f.time.now = Date.parse('2026-11-03T00:00:00Z');
  const report = f.reconciler().run({ apply: true });
  assert.ok(codes(report).some(entry => entry.code === 'NEXT_ACTION_STALE' && entry.issue === 806 && /before the merge of PR #950/.test(entry.detail)), JSON.stringify(codes(report)));
  assert.deepEqual(f.open('NEXT_ACTION_STALE').map(entry => entry.issue), [806]);
  const latest = f.store.read('child', 806);
  f.store.write('child', 806, { ...latest.doc, next_action: 'Controller: judge the done-when and close' }, { sha: latest.sha, previous: latest.doc });
  assert.equal(f.store.read('child', 806).doc.private.next_action_at, '2026-11-03T00:00:00.000Z');
  f.reconciler().run({ apply: true });
  assert.deepEqual(f.open('NEXT_ACTION_STALE'), []);
});

test('a pass that sets a new next action after a merge reports no NEXT_ACTION_STALE for it, with no one-pass flicker', () => {
  const f = setup();
  f.reconciler().run({ apply: true });
  const { doc, sha } = f.store.read('child', 806);
  f.github.addPr(950, { head: SHA_A, merged: true, mergedAt: '2026-11-02T00:00:00Z', body: 'Refs #806' });
  f.store.write('child', 806, { ...doc, pr: { number: 950, state: 'OPEN', head: SHA_A, checks: { state: 'UNKNOWN', required_total: 0, required_passed: 0, at_head: null } } }, { sha, previous: doc });
  f.time.now = Date.parse('2026-11-03T00:00:00Z');
  const reconciler = f.reconciler();
  const desiredChild = reconciler.desiredChild.bind(reconciler);
  reconciler.desiredChild = (outcome, existing, observed) => {
    const result = desiredChild(outcome, existing, observed);
    if (outcome.issue === 806) result.doc.next_action = 'Controller: judge the done-when and close';
    return result;
  };
  const report = reconciler.run({ apply: true });
  assert.equal(codes(report).some(entry => entry.code === 'NEXT_ACTION_STALE'), false, JSON.stringify(codes(report)));
  assert.deepEqual(f.open('NEXT_ACTION_STALE'), []);
});
