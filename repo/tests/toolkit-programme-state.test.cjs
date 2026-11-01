'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const Ajv2020 = require('ajv/dist/2020');
const state = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');
const managedBlock = require('../scripts/toolkit-managed-block.cjs');
const { FakeGitHub } = require('./toolkit-programme-fake-github.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const schema = name => JSON.parse(fs.readFileSync(path.join(ROOT, 'repo', 'contracts', 'programme-state', name), 'utf8'));
const writer = { session: 'session-one', prefix: 'INT-TK421-' };
const other = { session: 'session-two', prefix: 'INT-TK421-' };
const controller = { session: 'controller-1', prefix: 'INT-TK421-' };
const heldParent = () => state.claimDocument(state.newParent({ repository: 'acme/app', parentIssue: 421, outcomes: [{ issue: 423, class: 'COMMITTED', parent: 421, order: 1, lane: 'integration' }] }), controller, {});
const outcome = { issue: 423, class: 'COMMITTED', parent: 421, order: 1, lane: 'integration' };

function child(overrides = {}) {
  return { ...state.newChild({ repository: 'acme/app', outcome }), ...overrides };
}

test('the JSON schemas and the runtime validator agree on valid and invalid documents', () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const validateChild = ajv.compile(schema('child-state-v1.schema.json'));
  const validateParent = ajv.compile(schema('parent-state-v1.schema.json'));
  const validateBindingV1 = ajv.compile(schema('binding-v1.schema.json'));
  const validateBinding = ajv.compile(schema('binding-v2.schema.json'));

  const good = child({ candidate: { branch: 'feature', head: SHA_A, tree: SHA_B, base: SHA_B } });
  assert.equal(validateChild(good), true, JSON.stringify(validateChild.errors));
  assert.deepEqual(state.validateChild(good), []);
  const parent = state.newParent({ repository: 'acme/app', parentIssue: 421, outcomes: [outcome], releasePlan: { record: 'INT-TK421-058', comment_id: 5 } });
  assert.equal(validateParent(parent), true, JSON.stringify(validateParent.errors));
  assert.deepEqual(state.validateParent(parent), []);
  const binding = JSON.parse(fs.readFileSync(path.join(ROOT, '.github', 'toolkit-programme.json'), 'utf8'));
  assert.equal(validateBinding(binding), true, JSON.stringify(validateBinding.errors));
  const normalized = state.validateBinding(binding);
  assert.deepEqual([normalized.parent_issue, normalized.record_prefix, normalized.writer_prefix], [binding.parents[0].issue, binding.parents[0].record_prefix, binding.parents[0].writer_prefix]);
  // Version 1 is still read, as enabled with one parent.
  // schedule_folder is a version 2 field.
  const { governance: _governance, parents: _parents, schedule_folder: _folder, ...rest } = binding;
  const v1 = { ...rest, schema: state.SCHEMA.binding, parent_issue: 421, record_prefix: 'INT-TK421-', writer_prefix: 'INT-TK421-' };
  assert.equal(validateBindingV1(v1), true, JSON.stringify(validateBindingV1.errors));
  assert.equal(state.validateBinding(v1), v1);
  const disabled = { schema: state.SCHEMA.bindingV2, repository: 'acme/app', governance: 'disabled' };
  assert.equal(validateBinding(disabled), true);
  assert.equal(state.bindingEnabled(state.validateBinding(disabled)), false);
  for (const doc of [{ ...disabled, governance: 'enabled' }, { ...binding, parents: [] }, { ...binding, parents: [{ issue: 1, record_prefix: 'X', children: [2] }] }]) {
    assert.equal(validateBinding(doc), false, JSON.stringify(doc).slice(0, 80));
    assert.throws(() => state.validateBinding(doc), /is invalid/);
  }

  const bad = [
    child({ candidate: { branch: 'x', head: 'abc1234', tree: null, base: null } }),
    child({ lifecycle: 'FINISHED' }),
    child({ next_action: '' }),
    child({ pr: { number: 7, state: 'OPEN', head: SHA_A, checks: { state: 'GREEN', required_total: 0, required_passed: 0, at_head: SHA_A } } }),
    child({ gate: { role: 'G3', state: null, session_id: null, route: null, returns: [] } }),
    child({ review: { state: 'PASSED', verdicts: [{ reviewer: 'r', head: 'short', verdict: 'PASSED' }] } }),
  ];
  for (const doc of bad) {
    assert.equal(validateChild(doc), false, `schema accepts ${JSON.stringify(doc).slice(0, 80)}`);
    assert.notDeepEqual(state.validateChild(doc), [], 'runtime accepts a document the schema refuses');
  }
  const looped = state.newParent({ repository: 'acme/app', parentIssue: 1, outcomes: [{ issue: 2, class: 'COMMITTED', parent: 3, order: 0 }, { issue: 3, class: 'COMMITTED', parent: 2, order: 0 }] });
  assert.match(state.validateParent(looped).join('\n'), /loop/);
  const stranger = state.newParent({ repository: 'acme/app', parentIssue: 1, outcomes: [{ issue: 2, class: 'COMMITTED', parent: 99, order: 0 }] });
  assert.match(state.validateParent(stranger).join('\n'), /not the programme parent/);
  assert.throws(() => state.validateBinding({ ...binding, store: { ...binding.store, repository: binding.repository } }), /separate repository/);
  assert.throws(() => state.validateBinding({ ...binding, store: { ...binding.store, path: '../escape/' } }), /store.path/);
  assert.throws(() => state.validateBinding({ ...binding, store: { ...binding.store, kind: 'onedrive' } }), /store.kind "onedrive" is not supported/);
  assert.equal(validateBinding({ ...binding, store: { ...binding.store, kind: 'onedrive' } }), false);
});

test('the content digest ignores the revision, timestamps and pending effects', () => {
  const doc = child();
  const moved = { ...doc, revision: 9, volatile: { written_at: 'later' }, pending_effects: [{ intent_id: 'x', kind: 'attach', target: { issue: 1 }, state: 'IN_FLIGHT' }] };
  assert.equal(state.contentDigest(doc), state.contentDigest(moved));
  assert.equal(state.sameState(doc, { ...doc, volatile: { written_at: 'now' } }), true);
  assert.equal(state.sameState(doc, moved), false, 'a pending effect is still a change to write');
  assert.equal(state.canonicalText({ b: 1, a: { d: 2, c: 3 } }), '{\n  "a": {\n    "c": 3,\n    "d": 2\n  },\n  "b": 1\n}\n');
});

test('reopen, resubmit and accept work under one assignment; return IDs are idempotent and conflicts refused (LIFE-1)', () => {
  let doc = state.assignGate(child(), { assignment: 'g1-a1', role: 'G1' });
  assert.deepEqual([doc.gate.state, doc.gate.assignment, doc.lifecycle], ['ASSIGNED', { id: 'g1-a1', role: 'G1' }, 'ACTIVE']);
  assert.equal(state.assignGate(doc, { assignment: 'g1-a1', role: 'G1' }), null, 'issuing the same assignment again is a no-op');
  assert.throws(() => state.assignGate(doc, { assignment: 'g1-a2', role: 'G1' }), { code: 'ASSIGNMENT_LIVE' });
  assert.throws(() => state.recordReturn(doc, { returnId: 'r1', assignment: 'g1-old' }), { code: 'STALE_ASSIGNMENT' });
  doc = state.recordReturn(doc, { returnId: 'r1', assignment: 'g1-a1', atHead: SHA_A });
  assert.equal(doc.gate.state, 'SUBMITTED');
  assert.deepEqual(doc.gate.returns[0], { return_id: 'r1', verdict: null, consumed: false, epoch: 0, assignment: 'g1-a1', at_head: SHA_A, mode: 'toolkit_assisted' });
  assert.equal(state.recordReturn(doc, { returnId: 'r1', assignment: 'g1-a1' }), null, 'recording the same return again is a no-op');
  const decide = { writer: controller, parentDoc: heldParent() };
  assert.throws(() => state.consumeReturn(doc, { returnId: 'r1', verdict: 'ACCEPT', writer, parentDoc: decide.parentDoc }), { code: 'ROLE_REFUSED' }, 'only the parent holder consumes a return');
  assert.throws(() => state.consumeReturn(doc, { returnId: 'r1', verdict: 'ACCEPT' }), { code: 'ROLE_REFUSED' });
  doc = state.consumeReturn(doc, { returnId: 'r1', verdict: 'REOPEN', ...decide });
  assert.equal(doc.gate.state, 'ACTIVE');
  assert.equal(doc.gate.assignment.id, 'g1-a1', 'REOPEN keeps the assignment');
  assert.throws(() => state.recordReturn(doc, { returnId: 'r1', assignment: 'g1-a1' }), { code: 'RETURN_CONFLICT' });
  doc = state.recordReturn(doc, { returnId: 'r2', assignment: 'g1-a1' });
  assert.throws(() => state.consumeReturn(doc, { returnId: 'r2', verdict: 'ACCEPT', ...decide, liveHead: SHA_B }), { code: 'EVIDENCE_STALE' }, 'G1 needs G2 PASSED at the live head');
  doc = state.applyPatch('child', doc, { review: { state: 'PASSED', verdicts: [{ reviewer: 'g2', head: SHA_B, verdict: 'PASSED' }] } }, decide);
  doc = state.consumeReturn(doc, { returnId: 'r2', verdict: 'ACCEPT', ...decide, liveHead: SHA_B });
  assert.equal(doc.gate.state, 'RETIRED');
  assert.equal(state.consumeReturn(doc, { returnId: 'r2', verdict: 'ACCEPT', ...decide }), null, 'consuming the same return twice is idempotent');
  assert.throws(() => state.consumeReturn(doc, { returnId: 'r2', verdict: 'REOPEN', ...decide }), { code: 'RETURN_CONFLICT' });
  assert.throws(() => state.consumeReturn(doc, { returnId: 'r9', verdict: 'ACCEPT', ...decide }), { code: 'RETURN_UNKNOWN' });
  assert.deepEqual(state.validateChild(doc), []);

  // A return recorded before a takeover of the child's fence is stale.
  let fenced = state.recordReturn(state.assignGate(child(), { assignment: 'g1-b', role: 'G1' }), { returnId: 'old', assignment: 'g1-b' });
  fenced = state.claimDocument(fenced, other, {});
  assert.equal(fenced.fence.epoch, 1);
  assert.throws(() => state.consumeReturn(fenced, { returnId: 'old', verdict: 'ACCEPT', ...decide }), { code: 'STALE_RETURN' });
});

test('claims and takeovers move the fence; stale writers are refused', () => {
  const claimed = state.claimDocument(child(), writer, {});
  assert.deepEqual(claimed.fence, { epoch: 1, holder_prefix: 'INT-TK421-', holder_session: 'session-one' });
  assert.equal(state.claimDocument(claimed, writer, {}), null, 'claiming again is a no-op');
  assert.throws(() => state.claimDocument(claimed, other, {}), { code: 'CLAIM_HELD' });
  const taken = state.claimDocument(claimed, other, { takeover: true });
  assert.equal(taken.fence.epoch, 2);
  assert.throws(() => state.authoriseWrite('child', taken, null, writer), { code: 'STALE_WRITER' });
  assert.doesNotThrow(() => state.authoriseWrite('child', taken, null, other));
  const parent = state.claimDocument(state.newParent({ repository: 'acme/app', parentIssue: 421 }), writer, {});
  assert.doesNotThrow(() => state.authoriseWrite('child', taken, parent, writer), 'the parent holder may write a child');
  assert.throws(() => state.authoriseWrite('parent', parent, null, other), { code: 'STALE_WRITER' });
  assert.throws(() => state.authoriseWrite('parent', parent, null, null), { code: 'WRITER_UNKNOWN' });
});

test('patches touch only the holder fields, and only the controller records acceptance', () => {
  const doc = state.claimDocument(child(), writer, {});
  const parentDoc = heldParent();
  const own = state.applyPatch('child', doc, { next_action: 'Run G2', blockers: ['owner UAT'], candidate: { branch: 'b', head: SHA_A }, lifecycle: 'WAITING_OWNER' }, { writer, parentDoc });
  assert.equal(own.next_action, 'Run G2');
  // An executor cannot record its own UAT, review or a terminal lifecycle (G2 probe P13).
  for (const patch of [{ uat: { state: 'PASSED', at_head: SHA_A } }, { review: { state: 'PASSED', verdicts: [{ reviewer: 'self', head: SHA_A, verdict: 'PASSED' }] } }, { lifecycle: 'DONE' }, { lifecycle: 'RETIRED' }]) {
    assert.throws(() => state.applyPatch('child', doc, patch, { writer, parentDoc }), { code: 'ROLE_REFUSED' }, JSON.stringify(patch));
    assert.throws(() => state.applyPatch('child', doc, patch), { code: 'ROLE_REFUSED' }, 'no writer means no controller');
  }
  assert.throws(() => state.applyPatch('child', { ...doc, lifecycle: 'DONE' }, { lifecycle: 'ACTIVE' }, { writer, parentDoc }), { code: 'ROLE_REFUSED' }, 'nor reopen a finished outcome');
  const next = state.applyPatch('child', doc, { uat: { state: 'PASSED', at_head: SHA_A }, lifecycle: 'DONE' }, { writer: controller, parentDoc });
  assert.deepEqual(next.uat, { state: 'PASSED', at_head: SHA_A });
  assert.equal(next.lifecycle, 'DONE');
  assert.throws(() => state.applyPatch('child', doc, { pr: { number: 1 } }), { code: 'PATCH_REFUSED' });
  assert.throws(() => state.applyPatch('child', doc, { fence: { epoch: 9 } }), { code: 'PATCH_REFUSED' });
  assert.throws(() => state.applyPatch('parent', state.newParent({ repository: 'acme/app', parentIssue: 1 }), { parent_issue: 2 }), { code: 'PATCH_REFUSED' });
});

test('checks are GREEN only when every required check passed at the exact head', () => {
  const run = (name, conclusion, extra = {}) => ({ kind: 'CheckRun', name, status: 'COMPLETED', conclusion, required: false, ...extra });
  const evaluate = (contexts, extra = {}) => state.evaluateChecks({ head: SHA_A, rollupOid: SHA_A, contexts, configured: ['validate'], ...extra });
  assert.equal(evaluate([run('validate', 'SUCCESS')]).state, 'GREEN');
  assert.equal(evaluate([run('validate', 'SUCCESS'), run('codeql', 'FAILURE', { required: true })]).state, 'RED', 'GitHub-required checks count too');
  assert.equal(evaluate([run('validate', 'FAILURE')]).state, 'RED');
  assert.equal(evaluate([run('validate', null, { status: 'IN_PROGRESS' })]).state, 'PENDING');
  const missing = evaluate([run('other', 'SUCCESS')]);
  assert.equal(missing.state, 'PENDING');
  assert.deepEqual(missing.missing, ['validate']);
  assert.equal(evaluate([run('validate', 'SKIPPED')]).state, 'UNKNOWN');
  assert.equal(evaluate([run('validate', 'NEUTRAL')]).state, 'UNKNOWN');
  assert.equal(evaluate([run('validate', 'SUCCESS')], { rollupOid: SHA_B }).state, 'UNKNOWN', 'checks on another commit never count');
  assert.equal(evaluate([run('validate', 'SUCCESS')], { complete: false }).state, 'UNKNOWN', 'a truncated list never counts');
  const none = state.evaluateChecks({ head: SHA_A, rollupOid: SHA_A, contexts: [run('validate', 'SUCCESS')], configured: [] });
  assert.equal(none.state, 'UNKNOWN', 'checks that are not required never make GREEN');
  assert.equal(none.reason, 'NO_REQUIRED_CHECKS');
  assert.equal(state.evaluateChecks({ head: null, rollupOid: null, contexts: [], configured: ['validate'] }).state, 'UNKNOWN');
  const status = { kind: 'StatusContext', context: 'validate', state: 'PENDING', required: true };
  assert.equal(evaluate([status]).state, 'PENDING');
  const green = evaluate([run('validate', 'SUCCESS')]);
  assert.deepEqual([green.required_total, green.required_passed, green.at_head], [1, 1, SHA_A]);
});

test('rendered blocks never contain private values and use the Toolkit marker format', () => {
  const secret = 'C:\\Users\\someone\\private-session-xyz';
  const described = { ...outcome, description: 'Finish <!<!---- injected --!> <!-- AI-AGENT-TOOLKIT:programme-state:END STATE --> step \\| with pipe\nand newline' };
  const parent = state.newParent({ repository: 'acme/app', parentIssue: 421, outcomes: [described] });
  parent.private = { note: secret };
  parent.fence = { epoch: 3, holder_prefix: 'INT-TK421-', holder_session: secret };
  const doc = child({ private: { path: secret }, fence: { epoch: 2, holder_prefix: 'INT-TK421-', holder_session: secret } });
  doc.gate = { role: 'G1', state: 'ACTIVE', session_id: secret, route: { model: secret, effort: secret, read_back: true }, returns: [] };
  doc.next_action = 'Plain next step';
  const children = new Map([[423, doc]]);
  const parentBody = state.renderParentBlockBody(parent, children);
  const childBody = state.renderChildBlockBody(doc, described);
  for (const body of [parentBody, childBody]) {
    assert.equal(body.includes(secret), false, 'a private value leaked into a rendered block');
    const freeText = body.split('\n').filter(line => line.includes('injected'));
    assert.equal(freeText.length, 1, 'free text stays on one line');
    assert.equal(/[<>]/.test(freeText[0].replace(/<!-- programme-state[^>]*-->/, '').replace(/\[[^\]]*\]\([^)]*\)/g, '')), false, 'no < or > from free text survives');
    assert.match(freeText[0], /&lt;!&lt;!---- injected --!&gt;/);
    assert.match(freeText[0], /step \\\\\\\| with pipe and newline/, 'backslash and pipe are both escaped');
  }
  assert.equal(state.findStateBlock(state.renderBlock(childBody, '3.9.1')).error, undefined, 'free text cannot close the block early');
  const rendered = state.renderBlock(childBody, '3.9.1');
  const { blocks, errors } = managedBlock.findBlocks(rendered);
  assert.deepEqual(errors, []);
  assert.equal(blocks.length, 1);
  assert.equal(managedBlock.blockState(blocks[0], { source: state.BLOCK_SOURCE, name: state.BLOCK_NAME, version: '3.9.1', body: childBody }), 'current');
});

test('the Programme Graph has seven columns, works out NOW, LATER and OPTIONAL, sorts each by priority order then child number, then COMPLETED by completion, then RETIRED, and flattens nesting', () => {
  const outcomes = [
    { issue: 8, class: 'COMMITTED', parent: 7, order: 9, name: 'Shared host contract', description: 'One contract for both hosts' },
    { issue: 9, class: 'RETIRED', parent: 7, order: 0, description: 'Old predecessor' },
    { issue: 10, class: 'COMMITTED', parent: 7, order: 0 },
    { issue: 11, class: 'COMMITTED', parent: 7, order: 0 },
    { issue: 12, class: 'COMPLETED', parent: 7, order: 0 },
    { issue: 13, class: 'OPTIONAL', parent: 7, order: 0 },
    { issue: 15, class: 'COMMITTED', parent: 7, order: 1 },
    { issue: 14, class: 'COMMITTED', parent: 7, order: 1 },
    { issue: 16, class: 'COMMITTED', parent: 8, order: 0 },
    { issue: 17, class: 'COMMITTED', parent: 8, order: 99 },
    { issue: 18, class: 'OPTIONAL', parent: null, order: 0 },
    { issue: 19, class: 'OPTIONAL', parent: 7, order: 0 },
    { issue: 21, class: 'COMMITTED', parent: null, order: 0 },
  ];
  const parent = state.newParent({ repository: 'acme/app', parentIssue: 7, outcomes });
  const doc = (issue, changes = {}) => ({ ...state.newChild({ repository: 'acme/app', outcome: outcomes.find(entry => entry.issue === issue) }), ...changes });
  const pr = (number, prState) => ({ number, state: prState, head: null, checks: { state: 'UNKNOWN', required_total: 0, required_passed: 0, at_head: null } });
  const children = new Map([
    [8, doc(8, { lifecycle: 'ACTIVE', release: 'Lane B', gate: { role: 'G1', state: 'ACTIVE', session_id: null, route: null, returns: [] }, pr: pr(549, 'DRAFT') })],
    [9, doc(9, { completed_at: '2026-10-01T00:00:00Z' })],
    [10, doc(10, { release: 'Lane B' })],
    [11, doc(11, { pr: pr(550, 'OPEN') })],
    [12, doc(12)],
    [14, doc(14, { pr: pr(551, 'CLOSED') })],
    [16, doc(16, { lifecycle: 'DONE', completed_at: '2026-10-20T00:00:00Z', pr: pr(552, 'MERGED') })],
    [17, doc(17, { lifecycle: 'WAITING_OWNER', release: 'Lane C' })],
    [19, doc(19, { release: 'Lane C' })],
  ]);
  const issues = new Map([
    [12, { title: 'X3 — External Operation Authority', closed_at: '2026-10-05T00:00:00Z' }],
    [14, { title: 'Toolkit 3.11.0: per-repository governance states' }],
    [15, { title: 'W2-A — Toolkit temporary-resource hygiene' }],
  ]);
  const body = state.renderParentBlockBody(parent, children, issues);
  const lines = body.split('\n');
  assert.equal(lines[1], '## Programme Graph');
  assert.ok(lines.includes('| Task | Task Description | Child # | PR # | Class | Status | Last updated (SGT) |'));
  assert.equal(/CORE|HARDENING/.test(body), false, 'the old classes never show');
  const rows = lines.filter(line => /^\| [^|]+ \| [^|]+ \| #\d+ \|/.test(line)).map(line => line.split(' | ').map(cell => cell.replace(/^\| | \|$/g, '')));
  assert.deepEqual(rows.map(row => Number(row[2].slice(1))), [11, 8, 17, 10, 21, 14, 15, 13, 18, 19, 12, 16, 9], 'NOW, LATER, OPTIONAL by priority order and child number; finished oldest first');
  assert.equal(/\bNEXT\b/.test(body), false, 'there is no Next group');
  const classOf = Object.fromEntries(rows.map(row => [row[2], row[4]]));
  for (const [issue, expected, why] of [
    ['#11', 'NOW', 'an open PR'],
    ['#8', 'NOW', 'a draft PR wins over a release'],
    ['#10', 'LATER', 'a planned release does not change the group'],
    ['#17', 'NOW', 'waiting on the owner with no PR is still in progress'],
    ['#19', 'OPTIONAL', 'an optional task with a release stays optional'],
    ['#21', 'LATER', 'committed, no release'],
    ['#14', 'LATER', 'a closed PR is not current work'],
    ['#13', 'OPTIONAL', 'optional, no release'],
    ['#12', '-', 'finished rows carry no class'],
    ['#9', '-', 'retired rows carry no class'],
  ]) assert.equal(classOf[issue], expected, `${issue}: ${why}`);
  assert.deepEqual(rows[1], ['Shared host contract', 'One contract for both hosts', '#8', '#549', 'NOW', 'IN PROGRESS', '-'], 'the description follows the task, and the gate is not a column');
  assert.deepEqual([rows[5][0], rows[5][2]], ['per-repository governance states', '#14'], 'a release prefix is not part of the name');
  assert.deepEqual([rows[6][0], rows[6][2]], ['Toolkit temporary-resource hygiene', '#15'], 'a code prefix is not part of the name');
  assert.deepEqual(rows[2].slice(4), ['NOW', 'IN PROGRESS', '-']);
  assert.deepEqual([rows[12][1], ...rows[12].slice(4)], ['Old predecessor', '-', 'RETIRED', '2026-10-01 08:00'], 'retired is its own group below COMPLETED');
  assert.deepEqual(rows[11].slice(4), ['-', 'COMPLETED', '2026-10-20 08:00'], 'a finished nested child goes down to COMPLETED');
  assert.equal(rows[10][0], 'External Operation Authority');
  assert.equal(body.includes('Roadmap') || body.includes('<details>'), false, 'one table, nothing else');
});

test('the Programme Graph renders deterministic Singapore update times from task state and comments', () => {
  const cases = [
    { class: 'COMPLETED', completed_at: '2026-11-01T06:38:59Z', closed_at: '2026-11-02T00:00:00Z', expected: '2026-11-01 14:38' },
    { class: 'COMPLETED', closed_at: '2026-10-31T16:30:00Z', expected: '2026-11-01 00:30' },
    { class: 'RETIRED', completed_at: '2026-10-31T16:30:00Z', expected: '2026-11-01 00:30' },
    { lifecycle: 'DONE', expected: '-' },
    { lifecycle: 'RETIRED', expected: '-' },
    { lifecycle: 'ACTIVE', written_at: '2026-11-01T06:38:59Z', expected: '2026-11-01 14:38' },
    { lifecycle: 'ACTIVE', written_at: '2026-11-01T06:38:59Z', comments: [
      { body: 'New update', created_at: '2026-11-01T07:01:00Z' },
      { body: 'Older update', created_at: '2026-11-01T06:00:00Z' },
    ], expected: '2026-11-01 15:01' },
    { lifecycle: 'ACTIVE', written_at: '2026-10-31T16:30:00Z', comments: [
      { body: 'Topic\n<!-- programme-trace intent=own-index -->', created_at: '2026-11-02T00:00:00Z' },
      { body: 'Older update', created_at: '2026-10-31T15:00:00Z' },
    ], expected: '2026-11-01 00:30' },
    { lifecycle: 'ACTIVE', comments: [{ body: 'First update', created_at: '2026-10-31T16:30:00Z' }], expected: '2026-11-01 00:30' },
    { lifecycle: 'ACTIVE', expected: '-' },
    { class: 'COMMITTED', written_at: '2026-11-01T06:38:59Z', comments: [{ body: 'Queued', created_at: '2026-11-02T00:00:00Z' }], expected: '-' },
    { class: 'OPTIONAL', written_at: '2026-11-01T06:38:59Z', comments: [{ body: 'Optional', created_at: '2026-11-02T00:00:00Z' }], expected: '-' },
  ];
  const outcomes = cases.map((entry, index) => ({ issue: index + 10, class: entry.class || 'COMMITTED', parent: 7, order: index }));
  const parent = state.newParent({ repository: 'acme/app', parentIssue: 7, outcomes });
  const children = new Map(outcomes.map((outcome, index) => {
    const entry = cases[index];
    return [outcome.issue, { ...state.newChild({ repository: 'acme/app', outcome }),
      ...(entry.lifecycle ? { lifecycle: entry.lifecycle } : {}), ...(entry.completed_at ? { completed_at: entry.completed_at } : {}),
      ...(entry.written_at ? { volatile: { written_at: entry.written_at } } : {}) }];
  }));
  const issues = new Map(outcomes.map((outcome, index) => [outcome.issue, { closed_at: cases[index].closed_at }]));
  const comments = new Map(outcomes.map((outcome, index) => [outcome.issue, cases[index].comments || []]));
  const render = () => state.renderBlock(state.renderParentBlockBody(parent, children, issues, comments), '3.9.1');
  const body = render();
  assert.equal(render(), body, 'the same input renders the same block twice');
  for (const [index, outcome] of outcomes.entries()) {
    const row = body.split('\n').find(line => line.startsWith(`| #${outcome.issue} |`));
    assert.equal(row.split(' | ')[6], `${cases[index].expected} |`, `task #${outcome.issue}`);
  }
});

test('a priority tie is named only among queued rows of one group', () => {
  const outcomes = [
    { issue: 2, class: 'COMMITTED', parent: 7, order: 1 },
    { issue: 3, class: 'COMMITTED', parent: 7, order: 1 },
    { issue: 4, class: 'COMMITTED', parent: 7, order: 1 },
    { issue: 5, class: 'OPTIONAL', parent: 7, order: 1 },
    { issue: 6, class: 'COMPLETED', parent: 7, order: 1 },
    { issue: 8, class: 'COMMITTED', parent: 7, order: 2 },
    { issue: 10, class: 'COMMITTED', parent: 7, order: 1 },
  ];
  const parent = state.newParent({ repository: 'acme/app', parentIssue: 7, outcomes });
  const pr = { number: 9, state: 'OPEN', head: null, checks: { state: 'UNKNOWN', required_total: 0, required_passed: 0, at_head: null } };
  const children = new Map([
    [4, { ...state.newChild({ repository: 'acme/app', outcome: outcomes[2] }), pr }],
    [10, { ...state.newChild({ repository: 'acme/app', outcome: outcomes[6] }), lifecycle: 'ACTIVE' }],
  ]);
  assert.deepEqual(state.orderTies(parent, children).map(tie => tie.map(outcome => outcome.issue)), [[2, 3]], 'two NOW rows sharing an order, optional and finished rows do not tie');
  assert.deepEqual(state.orderTies(parent, new Map()).map(tie => tie.map(outcome => outcome.issue)), [[2, 3, 4, 10]]);
});

test('older class names are read as COMMITTED and anything else is refused', () => {
  for (const cls of ['CORE', 'HARDENING', 'LATER']) {
    const parent = state.newParent({ repository: 'acme/app', parentIssue: 7, outcomes: [{ issue: 8, class: cls, parent: 7, order: 0 }] });
    assert.deepEqual(state.validateParent(parent), [], `${cls} still reads`);
    const body = state.renderParentBlockBody(parent, new Map(), new Map());
    assert.match(body, /^\| #8 \| - \| #8 \| - \| LATER \| QUEUED \| - \|$/m, `${cls} shows as LATER with no release`);
  }
  const bad = state.newParent({ repository: 'acme/app', parentIssue: 7, outcomes: [{ issue: 8, class: 'NOW', parent: 7, order: 0 }] });
  assert.match(state.validateParent(bad).join('\n'), /class must be one of COMMITTED, OPTIONAL, COMPLETED, RETIRED/, 'the bucket is never stored');
});

test('the generated CURRENT summary lists work in progress, saying what waits on the owner, then the Later task to start next', () => {
  const outcomes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(issue => ({ issue, class: 'COMMITTED', parent: 7, order: issue, name: `Task ${issue}` }));
  outcomes.push({ issue: 11, class: 'COMPLETED', parent: 7, order: 0, name: 'Done task' });
  const parent = state.newParent({ repository: 'acme/app', parentIssue: 7, outcomes });
  const doc = (issue, changes = {}) => ({ ...state.newChild({ repository: 'acme/app', outcome: outcomes.find(entry => entry.issue === issue) }), ...changes });
  const pr = number => ({ number, state: 'OPEN', head: null, checks: { state: 'UNKNOWN', required_total: 0, required_passed: 0, at_head: null } });
  const gate = role => ({ role, state: 'ACTIVE', session_id: null, route: null, returns: [] });
  const children = new Map([
    [1, doc(1, { lifecycle: 'ACTIVE', gate: gate('G1'), pr: pr(541), next_action: 'Finish the sweep' })],
    [2, doc(2, { lifecycle: 'ACTIVE', gate: gate('G1'), pr: pr(543), uat: { state: 'PENDING', at_head: null } })],
    [3, doc(3, { lifecycle: 'WAITING_OWNER' })],
    [4, doc(4, { lifecycle: 'HOLD', blockers: ['needs the key'] })],
    [11, doc(11, { lifecycle: 'DONE' })],
  ]);
  const body = state.renderCurrentBlockBody(parent, children, new Map());
  assert.equal(body, [
    '<!-- programme-current -->',
    '_Generated from the programme state (revision 0). The Programme Graph follows; hand-written notes come after it._',
    '',
    '**In progress**',
    '- Task 1 (#1): G1, PR #541; next: Finish the sweep',
    '- Task 2 (#2): G1, PR #543; waiting on you: your UAT on PR #543; next: Controller: admit and plan this outcome',
    '- Task 3 (#3); waiting on you: your decision; next: Controller: admit and plan this outcome',
    '- Task 4 (#4); waiting on you: blocked: needs the key; next: Controller: admit and plan this outcome',
    '',
    '**Start next:** Task 5 (#5)',
    '',
    '**Attention: clear**',
  ].join('\n'), 'queued work shows in the graph, with only the top Later task named here');
  const idle = state.renderCurrentBlockBody(state.newParent({ repository: 'acme/app', parentIssue: 7, outcomes: [] }), new Map());
  assert.match(idle, /\*\*In progress\*\*\n- None\.\n\n\*\*Start next:\*\* None\.\n/);
  // The top LATER task by priority order starts next; optional work is never named.
  const later = state.newParent({ repository: 'acme/app', parentIssue: 7, outcomes: [
    { issue: 2, class: 'OPTIONAL', parent: 7, order: 0, name: 'Optional' },
    { issue: 3, class: 'COMMITTED', parent: 7, order: 4, name: 'Low' },
    { issue: 4, class: 'COMMITTED', parent: 7, order: 1, name: 'Top' },
  ] });
  assert.match(state.renderCurrentBlockBody(later, new Map(), new Map()), /\*\*Start next:\*\* Top \(#4\)\n/);
  const merged = { number: 5, state: 'MERGED', head: null, checks: { state: 'UNKNOWN', required_total: 0, required_passed: 0, at_head: null } };
  const top = { ...state.newChild({ repository: 'acme/app', outcome: later.outcomes[2] }), pr: merged };
  assert.match(state.renderCurrentBlockBody(later, new Map([[4, top]]), new Map()), /\*\*Start next:\*\* Low \(#3\)\n/, 'a merged PR is not picked before its state catches up');
  assert.match(state.renderCurrentBlockBody(later, new Map(), new Map([[4, { closed_at: '2026-10-25T00:00:00Z' }]])), /\*\*Start next:\*\* Low \(#3\)\n/, 'a closed issue is not picked');
  const onlyOptional = state.newParent({ repository: 'acme/app', parentIssue: 7, outcomes: [{ issue: 2, class: 'OPTIONAL', parent: 7, order: 0 }] });
  assert.match(state.renderCurrentBlockBody(onlyOptional, new Map(), new Map()), /\*\*Start next:\*\* None\.\n/);
});

test('a finished outcome takes the issue close time once, and the controller may set it', () => {
  const outcomeDone = { issue: 459, class: 'COMPLETED', parent: 421, order: 1 };
  const parentDoc = state.claimDocument(state.newParent({ repository: 'acme/app', parentIssue: 421, outcomes: [outcomeDone] }), controller, {});
  const done = state.applyPatch('child', { ...state.newChild({ repository: 'acme/app', outcome: outcomeDone }), fence: parentDoc.fence }, { lifecycle: 'DONE', completed_at: '2026-10-23T10:00:00Z' }, { writer: controller, parentDoc });
  assert.equal(done.completed_at, '2026-10-23T10:00:00Z');
  assert.throws(() => state.assertValid('child', state.applyPatch('child', done, { completed_at: 'yesterday' }, { writer: controller, parentDoc })), /completed_at/);
});

test('a state block is replaced without touching the bytes around it', () => {
  const before = '# Title line\r\n\r\n';
  const after = '\r\n\r\n## Notes\r\nkept as is\r\n';
  const original = `${before}${state.renderBlock('old body', '3.8.0').split('\n').join('\r\n')}${after}`;
  const { body } = state.upsertStateBlock(original, state.renderBlock('new body', '3.9.1'));
  const found = state.findStateBlock(body).block;
  assert.equal(body.slice(0, found.start), before);
  assert.equal(body.slice(found.end), after);
  assert.equal(found.body, 'new body');
  assert.equal(found.tampered, false);
  const inserted = state.upsertStateBlock('Hand text', state.renderBlock('x', '3.9.1')).body;
  assert.ok(inserted.endsWith('\n\nHand text'));
  const lowered = state.upsertStateBlock(`Hand text\n\n${state.renderBlock('x', '3.9.1')}\n`, state.renderBlock('x', '3.9.1'));
  assert.equal(lowered.moved, true, 'with no title, a block below hand-written text moves to the top');
  assert.equal(lowered.body, `${inserted}\n`);
  const twice = `${state.renderBlock('a', '3.9.1')}\n${state.renderBlock('b', '3.9.1')}`;
  assert.match(state.findStateBlock(twice).error, /duplicate/);
  assert.throws(() => state.upsertStateBlock(twice, state.renderBlock('c', '3.9.1')), { code: 'MANAGED_BLOCK_BROKEN' });
  const edited = state.renderBlock('original', '3.9.1').replace('\noriginal\n', '\nedited\n');
  assert.equal(state.findStateBlock(edited).block.tampered, true);
});

test('the block goes right after the CURRENT summary, else in place of the named section, after the status section, or under the title above its note, and moves to its place', () => {
  const block = state.renderBlock('graph', '3.9.1');
  const page = '# Programme\n\nIntro.\n\n## CURRENT\n\nLive now.\n\n## Delivery model\n\nText.\n\n## Programme index\n\n| old | table |\n\n## Parent completion\n\nDone when.\n';
  const placement = { after_section: 'CURRENT', replace_section: 'Programme index' };
  const replaced = state.upsertStateBlock(page, block, placement).body;
  assert.equal(replaced, `# Programme\n\nIntro.\n\n## CURRENT\n\nLive now.\n\n## Delivery model\n\nText.\n\n${block}\n\n## Parent completion\n\nDone when.\n`);
  assert.ok(state.upsertStateBlock(replaced, block, placement).body.includes(`Live now.\n\n${block}\n\n## Delivery model`), 'once the section is gone the block moves to its place under the status section');

  const noIndex = page.replace('## Programme index\n\n| old | table |\n\n', '');
  const afterCurrent = state.upsertStateBlock(noIndex, block, placement).body;
  assert.ok(afterCurrent.includes(`Live now.\n\n${block}\n\n## Delivery model`));

  const topped = `${block}\n\n${noIndex}`;
  const moved = state.upsertStateBlock(topped, block, placement);
  assert.equal(moved.moved, true, 'a block above its place moves down');
  assert.equal(moved.body, afterCurrent);
  assert.equal(state.upsertStateBlock(moved.body, block, placement).moved, false, 'and stays there');

  const lower = noIndex.replace('Done when.\n', `Done when.\n\n${block}\n`);
  const raised = state.upsertStateBlock(lower, block, placement);
  assert.equal(raised.moved, true, 'a block placed lower by hand moves up to its place');
  assert.equal(raised.body, afterCurrent);

  // On the parent the graph sits right under the generated CURRENT summary, ahead of hand-written notes,
  // and a hand-kept index it replaces is removed in the same pass.
  const current = state.renderBlock('summary', '3.9.1', 'CURRENT');
  const withSummary = `# Programme\n\n## CURRENT\n\n${current}\n\nLive now.\n\n## Programme index\n\n| old | table |\n\n## Parent completion\n\nDone when.\n`;
  const parentPlacement = { ...placement, after_block: 'CURRENT' };
  const graphed = state.upsertStateBlock(withSummary, block, parentPlacement).body;
  assert.equal(graphed, `# Programme\n\n## CURRENT\n\n${current}\n\n${block}\n\nLive now.\n\n## Parent completion\n\nDone when.\n`);
  assert.equal(state.upsertStateBlock(graphed, block, parentPlacement).moved, false, 'and settles');
  const notesFirst = `# Programme\n\n## CURRENT\n\n${current}\n\nLive now.\n\n${block}\n\n## Parent completion\n\nDone when.\n`;
  assert.equal(state.upsertStateBlock(notesFirst, block, parentPlacement).body, graphed, 'hand-written notes move below the graph, unchanged');

  const child = '# Child title\n\n<!-- INT-X:CURRENT-DIRECTION:BEGIN -->\n> Direction note.\n<!-- INT-X:CURRENT-DIRECTION:END -->\n\nParent: #421\n\n## Status\n\nText.\n';
  const childPlaced = child.replace('# Child title\n\n', `# Child title\n\n${block}\n\n`);
  assert.equal(state.upsertStateBlock(`${block}\n\n${child}`, block).body, childPlaced, 'a task page puts its status right under the title, above the direction note');
  const belowNote = child.replace('END -->\n\n', `END -->\n\n${block}\n\n`);
  assert.equal(state.upsertStateBlock(belowNote, block).body, childPlaced, 'a status block below the note moves up');
  assert.equal(state.upsertStateBlock('No title here.\n', block).body, `${block}\n\nNo title here.\n`);
  const fenced = '```\n# not a title\n```\n# Real title\nBody.\n';
  assert.ok(state.upsertStateBlock(fenced, block).body.includes(`# Real title\n\n${block}\n\nBody.`));
});

test('order moves reach the catalogue order and leave other sub-issues alone', () => {
  const apply = (current, moves) => {
    const list = [...current];
    for (const move of moves) {
      list.splice(list.indexOf(move.issue), 1);
      if (move.before !== undefined) list.splice(list.indexOf(move.before), 0, move.issue);
      else list.splice(list.indexOf(move.after) + 1, 0, move.issue);
    }
    return list;
  };
  const current = [5, 99, 3, 4, 1, 2];
  const desired = [1, 2, 3, 4, 5];
  const moves = state.orderMoves(current, desired);
  assert.deepEqual(apply(current, moves).filter(n => n !== 99), desired);
  assert.deepEqual(state.orderMoves([1, 2, 3], [1, 2, 3]), []);
  assert.deepEqual(state.orderMoves([2, 3], [1, 2, 3]), [], 'absent members do not misalign the rest');
  // A first attach appends in catalogue order, so only the few existing members move.
  assert.equal(state.orderMoves([30, 10, 99, 1, 2, 3, 4, 5, 6], [1, 2, 3, 10, 4, 5, 6, 30]).length, 2);
  let seed = 7;
  const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let round = 0; round < 200; round += 1) {
    const members = Array.from({ length: 1 + Math.floor(random() * 12) }, (_, index) => index + 1);
    const shuffled = [...members, 100, 101].sort(() => random() - 0.5);
    const result = apply(shuffled, state.orderMoves(shuffled, members));
    assert.deepEqual(result.filter(n => n < 100), members, `round ${round}: ${shuffled.join(',')}`);
    assert.deepEqual(result.filter(n => n >= 100), shuffled.filter(n => n >= 100));
  }
});

test('gh output with headers and redirects parses to the last status and its body', () => {
  const raw = 'HTTP/2.0 301 Moved\r\nLocation: x\r\n\r\nHTTP/2.0 200 OK\r\nContent-Type: application/json\r\n\r\n{"a":1}';
  assert.deepEqual(state.GitHubTransport.parse(raw), { status: 200, json: { a: 1 } });
  assert.deepEqual(state.GitHubTransport.parse('HTTP/2.0 404 Not Found\n\n{"message":"Not Found"}'), { status: 404, json: { message: 'Not Found' } });
  assert.throws(() => state.GitHubTransport.parse('', 'boom'), { code: 'GH_FAILED' });
  const calls = [];
  const transport = new state.GitHubTransport({ ghPath: 'C:\\Program Files\\GitHub CLI\\gh.exe', run: (file, args, options) => { calls.push({ file, args, options }); return { status: 0, stdout: 'HTTP/2.0 201 Created\n\n{}' }; } });
  assert.equal(transport.request('POST', 'repos/a/b/issues/1/sub_issues', { sub_issue_id: 5 }).status, 201);
  assert.equal(calls[0].file, 'C:\\Program Files\\GitHub CLI\\gh.exe', 'gh runs by full path');
  assert.equal(calls[0].options.input, '{"sub_issue_id":5}');
  assert.ok(calls[0].args.includes('--input'));
});

test('gh and git resolve to a full .exe path, never from the working folder or a relative PATH entry', () => {
  const existing = new Set(['C:\\work\\gh.exe', 'C:\\work\\gh.cmd', 'C:\\tools\\gh.cmd', 'C:\\Program Files\\GitHub CLI\\gh.exe']);
  const options = { platform: 'win32', cwd: 'C:\\work', exists: file => existing.has(file), environment: { PATH: 'C:\\work;.\\bin;C:\\tools;"C:\\Program Files\\GitHub CLI"' } };
  assert.equal(state.resolveExecutable('gh', options), 'C:\\Program Files\\GitHub CLI\\gh.exe');
  assert.throws(() => state.resolveExecutable('gh', { ...options, environment: { PATH: 'C:\\work;C:\\tools' } }), { code: 'EXECUTABLE_NOT_FOUND' });
});

test('the state store refuses a public or read-only store and never writes unchanged state', () => {
  for (const options of [{ storePrivate: false }, { storeWritable: false }]) {
    const github = new FakeGitHub(options);
    const store = new state.StateStore({ transport: github, store: { repository: 'acme/state-store', branch: 'main', path: 'state/acme/app/' } });
    assert.throws(() => store.verify(), { code: 'STATE_STORE_UNVERIFIED' });
  }
  const github = new FakeGitHub();
  const store = new state.StateStore({ transport: github, store: { repository: 'acme/state-store', branch: 'main', path: 'state/acme/app/' }, now: () => 'T' });
  assert.equal(store.verify(), true);
  const created = store.write('child', 423, child(), { sha: null, previous: null });
  assert.equal(created.outcome, 'WRITTEN');
  assert.equal(created.doc.revision, 1);
  const commits = github.commits;
  const again = store.write('child', 423, { ...created.doc, volatile: { written_at: 'other' } }, { sha: created.sha, previous: created.doc });
  assert.equal(again.outcome, 'NOOP');
  assert.equal(github.commits, commits, 'identical state makes no commit (GitHub would make an empty one)');
  const intent = { ...created.doc, pending_effects: [{ intent_id: 'i', kind: 'attach', target: { issue: 423, parent: 421 }, state: 'IN_FLIGHT' }] };
  const withIntent = store.write('child', 423, intent, { sha: created.sha, previous: created.doc });
  assert.equal(withIntent.doc.revision, 1, 'an intent write does not change the revision');
  const changed = store.write('child', 423, { ...withIntent.doc, next_action: 'Next' }, { sha: withIntent.sha, previous: withIntent.doc });
  assert.equal(changed.doc.revision, 2);
  assert.throws(() => store.write('child', 423, { ...changed.doc, next_action: 'Stale' }, { sha: created.sha, previous: changed.doc }), { code: 'STATE_CONFLICT' });
  assert.throws(() => store.write('child', 423, child({ next_action: 'Racing create' }), { sha: null, previous: null }), { code: 'STATE_CONFLICT' });
});

test('a branch read that lags behind a write neither fails the read-back nor the next compare-and-swap', () => {
  const github = new FakeGitHub();
  const store = new state.StateStore({ transport: github, store: { repository: 'acme/state-store', branch: 'main', path: 'state/acme/app/' } });
  const parent = state.claimDocument(state.newParent({ repository: 'acme/app', parentIssue: 421, outcomes: [outcome] }), writer, {});
  github.branchLag = true;
  const created = store.write('child', 423, child(), { sha: null, previous: null });
  assert.equal(created.outcome, 'WRITTEN', 'the read-back reads the new commit, not the lagging branch');
  assert.equal(github.calls.at(-1).path.endsWith('?ref=c1'), true);
  const first = store.mutate('child', 423, { writer, parentDoc: parent, change: doc => { doc.next_action = 'First'; return doc; } });
  assert.equal(first.outcome, 'WRITTEN', 'a branch read showing nothing yet returns the version this process created');
  const second = store.mutate('child', 423, { writer, parentDoc: parent, change: doc => { doc.next_action = 'Second'; return doc; } });
  assert.equal(second.outcome, 'WRITTEN', 'a branch read showing the replaced version returns the written one, so its sha is current');
  assert.equal(second.doc.next_action, 'Second');
  github.branchLag = false;
  assert.equal(github.readFile(store.docPath('child', 423)).next_action, 'Second');
  assert.equal(store.read('child', 423).doc.next_action, 'Second');

  // Another writer's version is never replaced by this process's own copy.
  const filePath = store.docPath('child', 423);
  const theirs = github.readFile(filePath);
  theirs.blockers = ['theirs'];
  github.putFile(filePath, theirs);
  assert.deepEqual(store.read('child', 423).doc.blockers, ['theirs']);
});

test('a compare-and-swap conflict re-applies disjoint changes and holds overlapping ones or takeovers', () => {
  const github = new FakeGitHub();
  const store = new state.StateStore({ transport: github, store: { repository: 'acme/state-store', branch: 'main', path: 'state/acme/app/' } });
  const filePath = store.docPath('child', 423);
  const parent = state.claimDocument(state.newParent({ repository: 'acme/app', parentIssue: 421, outcomes: [outcome] }), writer, {});
  store.write('child', 423, child(), { sha: null, previous: null });
  const sneak = change => {
    let done = false;
    github.intercept(call => {
      if (done || call.method !== 'PUT') return undefined;
      done = true;
      const doc = github.readFile(filePath);
      change(doc);
      github.putFile(filePath, doc);
      return undefined;
    });
  };
  sneak(doc => { doc.next_action = 'Changed by someone else'; });
  const merged = store.mutate('child', 423, { writer, parentDoc: parent, change: doc => { doc.blockers = ['owner UAT']; return doc; } });
  assert.equal(merged.outcome, 'WRITTEN');
  assert.equal(merged.doc.next_action, 'Changed by someone else');
  assert.deepEqual(merged.doc.blockers, ['owner UAT']);

  github.hooks = [];
  sneak(doc => { doc.blockers = ['theirs']; });
  assert.throws(() => store.mutate('child', 423, { writer, parentDoc: parent, change: doc => { doc.blockers = ['mine']; return doc; } }), { code: 'STATE_CONFLICT' });

  github.hooks = [];
  sneak(doc => { doc.fence = { epoch: doc.fence.epoch + 1, holder_prefix: 'CDX-TK469-', holder_session: 'codex' }; });
  assert.throws(() => store.mutate('child', 423, { writer, parentDoc: parent, change: doc => { doc.next_action = 'Late'; return doc; } }), { code: 'STALE_WRITER' });
});

test('repository identity comes from origin and GitHub; the binding cannot override it', () => {
  const github = new FakeGitHub();
  const binding = { repository: 'acme/app' };
  assert.equal(state.bindRepository({ transport: github, originUrl: 'https://github.com/acme/app.git', binding }), 'acme/app');
  assert.equal(state.originSlug('git@github.com:acme/app.git'), 'acme/app');
  assert.throws(() => state.bindRepository({ transport: github, originUrl: 'https://github.com/acme/app.git', binding: { repository: 'acme/other' } }), { code: 'REPO_IDENTITY_MISMATCH' });
  assert.throws(() => state.bindRepository({ transport: github, originUrl: 'https://gitlab.com/acme/app.git', binding }), { code: 'REPO_IDENTITY_MISMATCH' });
  // One github.com test, shared with the governance state: aliases and ssh.github.com count, Enterprise servers do not.
  for (const [url, slug] of [
    ['https://github.com/acme/app.git', 'acme/app'], ['git@github.com:acme/app.git', 'acme/app'], ['git@github-work:acme/app.git', 'acme/app'],
    ['ssh://git@ssh.github.com:443/acme/app.git', 'acme/app'], ['https://token@github.com/acme/app', 'acme/app'],
    ['https://github.example-corp.invalid/acme/app.git', null], ['git@github.example-corp.invalid:acme/app.git', null], ['https://gitlab.com/acme/app.git', null],
  ]) assert.equal(state.originSlug(url), slug, url);
});

test('a moved block trims only blank lines, keeping a line break and an indent at the join', () => {
  const page = `# Title\n\nline with a break  \n\n${state.renderBlock('x', '3.9.1')}\n\n    indented code\n`;
  const { body, moved } = state.upsertStateBlock(page, state.renderBlock('x', '3.9.1'));
  assert.equal(moved, true);
  assert.equal(body, `# Title\n\n${state.renderBlock('x', '3.9.1')}\n\nline with a break  \n\n    indented code\n`);
});

test('a replaced last section ends at the next managed block, keeping the trace and the text after it', () => {
  const trace = state.renderBlock('trace', '3.9.1', state.TRACE_BLOCK_NAME);
  const page = `# Title\n\n## Programme index\nold list\n\n${trace}\n\n[i1]: https://example.com/\n`;
  const { body } = state.upsertStateBlock(page, state.renderBlock('graph', '3.9.1'), { replace_section: 'Programme index' });
  assert.equal(body, `# Title\n\n${state.renderBlock('graph', '3.9.1')}\n\n${trace}\n\n[i1]: https://example.com/\n`);
});
