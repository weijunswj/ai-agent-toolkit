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
const heldParent = () => state.claimDocument(state.newParent({ repository: 'acme/app', parentIssue: 421, outcomes: [{ issue: 423, class: 'CORE', parent: 421, order: 1, lane: 'integration' }] }), controller, {});
const outcome = { issue: 423, class: 'CORE', parent: 421, order: 1, lane: 'integration' };

function child(overrides = {}) {
  return { ...state.newChild({ repository: 'acme/app', outcome }), ...overrides };
}

test('the JSON schemas and the runtime validator agree on valid and invalid documents', () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const validateChild = ajv.compile(schema('child-state-v1.schema.json'));
  const validateParent = ajv.compile(schema('parent-state-v1.schema.json'));
  const validateBinding = ajv.compile(schema('binding-v1.schema.json'));

  const good = child({ candidate: { branch: 'feature', head: SHA_A, tree: SHA_B, base: SHA_B } });
  assert.equal(validateChild(good), true, JSON.stringify(validateChild.errors));
  assert.deepEqual(state.validateChild(good), []);
  const parent = state.newParent({ repository: 'acme/app', parentIssue: 421, outcomes: [outcome], releasePlan: { record: 'INT-TK421-058', comment_id: 5 } });
  assert.equal(validateParent(parent), true, JSON.stringify(validateParent.errors));
  assert.deepEqual(state.validateParent(parent), []);
  const binding = JSON.parse(fs.readFileSync(path.join(ROOT, '.github', 'toolkit-programme.json'), 'utf8'));
  assert.equal(validateBinding(binding), true, JSON.stringify(validateBinding.errors));
  assert.equal(state.validateBinding(binding), binding);

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
  const looped = state.newParent({ repository: 'acme/app', parentIssue: 1, outcomes: [{ issue: 2, class: 'CORE', parent: 3, order: 0 }, { issue: 3, class: 'CORE', parent: 2, order: 0 }] });
  assert.match(state.validateParent(looped).join('\n'), /loop/);
  const stranger = state.newParent({ repository: 'acme/app', parentIssue: 1, outcomes: [{ issue: 2, class: 'CORE', parent: 99, order: 0 }] });
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
  const parent = state.newParent({ repository: 'acme/app', parentIssue: 421, outcomes: [outcome] });
  parent.private = { note: secret };
  parent.fence = { epoch: 3, holder_prefix: 'INT-TK421-', holder_session: secret };
  const doc = child({ private: { path: secret }, fence: { epoch: 2, holder_prefix: 'INT-TK421-', holder_session: secret } });
  doc.gate = { role: 'G1', state: 'ACTIVE', session_id: secret, route: { model: secret, effort: secret, read_back: true }, returns: [] };
  doc.next_action = 'Finish <!<!---- injected --!> <!-- AI-AGENT-TOOLKIT:programme-state:END STATE --> step \\| with pipe\nand newline';
  const children = new Map([[423, doc]]);
  const parentBody = state.renderParentBlockBody(parent, children);
  const childBody = state.renderChildBlockBody(doc, outcome);
  for (const body of [parentBody, childBody]) {
    assert.equal(body.includes(secret), false, 'a private value leaked into a rendered block');
    const freeText = body.split('\n').filter(line => line.includes('injected'));
    assert.equal(freeText.length, 1, 'free text stays on one line');
    assert.equal(/[<>]/.test(freeText[0].replace(/<!-- programme-state[^>]*-->/, '').replace(/\[[^\]]*\]\([^)]*\)/g, '')), false, 'no < or > from free text survives');
    assert.match(freeText[0], /&lt;!&lt;!---- injected --!&gt;/);
    assert.match(freeText[0], /step \\\\\\\| with pipe and newline/, 'backslash and pipe are both escaped');
  }
  assert.equal(state.findStateBlock(state.renderBlock(childBody, '3.9.0')).error, undefined, 'free text cannot close the block early');
  const rendered = state.renderBlock(childBody, '3.9.0');
  const { blocks, errors } = managedBlock.findBlocks(rendered);
  assert.deepEqual(errors, []);
  assert.equal(blocks.length, 1);
  assert.equal(managedBlock.blockState(blocks[0], { source: state.BLOCK_SOURCE, name: state.BLOCK_NAME, version: '3.9.0', body: childBody }), 'current');
});

test('parent rows sort by class, then order and issue, including nested children and the parentless tail', () => {
  const outcomes = [
    { issue: 8, class: 'CORE', parent: 7, order: 9 },
    { issue: 9, class: 'RETIRED', parent: 7, order: 0 },
    { issue: 10, class: 'LATER', parent: 7, order: 0 },
    { issue: 11, class: 'HARDENING', parent: 7, order: 0 },
    { issue: 12, class: 'COMPLETED', parent: 7, order: 0 },
    { issue: 13, class: 'OPTIONAL', parent: 7, order: 0 },
    { issue: 15, class: 'CORE', parent: 7, order: 1 },
    { issue: 14, class: 'CORE', parent: 7, order: 1 },
    { issue: 16, class: 'RETIRED', parent: 8, order: 0 },
    { issue: 17, class: 'CORE', parent: 8, order: 99 },
    { issue: 18, class: 'OPTIONAL', parent: null, order: 0 },
    { issue: 20, class: 'CORE', parent: null, order: 1 },
    { issue: 19, class: 'CORE', parent: null, order: 1 },
    { issue: 21, class: 'CORE', parent: null, order: 0 },
  ];
  const parent = state.newParent({ repository: 'acme/app', parentIssue: 7, outcomes });
  const body = state.renderParentBlockBody(parent, new Map());
  const rows = body.split('\n').filter(line => line.startsWith('| #')).map(line => Number(/^\| #(\d+)/.exec(line)[1]));
  assert.deepEqual(rows, [14, 15, 8, 17, 16, 11, 10, 13, 12, 9, 21, 19, 20, 18]);
});

test('a state block is replaced without touching the bytes around it', () => {
  const before = 'Intro line\r\nwith CRLF\r\n\r\n';
  const after = '\r\n\r\n## Notes\r\nkept as is\r\n';
  const original = `${before}${state.renderBlock('old body', '3.8.0').split('\n').join('\r\n')}${after}`;
  const { body } = state.upsertStateBlock(original, state.renderBlock('new body', '3.9.0'));
  const found = state.findStateBlock(body).block;
  assert.equal(body.slice(0, found.start), before);
  assert.equal(body.slice(found.end), after);
  assert.equal(found.body, 'new body');
  assert.equal(found.tampered, false);
  const inserted = state.upsertStateBlock('Hand text', state.renderBlock('x', '3.9.0')).body;
  assert.ok(inserted.endsWith('\n\nHand text'));
  const twice = `${state.renderBlock('a', '3.9.0')}\n${state.renderBlock('b', '3.9.0')}`;
  assert.match(state.findStateBlock(twice).error, /duplicate/);
  assert.throws(() => state.upsertStateBlock(twice, state.renderBlock('c', '3.9.0')), { code: 'MANAGED_BLOCK_BROKEN' });
  const edited = state.renderBlock('original', '3.9.0').replace('\noriginal\n', '\nedited\n');
  assert.equal(state.findStateBlock(edited).block.tampered, true);
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
});
