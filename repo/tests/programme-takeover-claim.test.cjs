'use strict';

// What a takeover says about its claim, for every way the claim's request, its read-backs and what
// happens around it can go, with the state documents in the private store and on the public branch.
// `fx.everHeld` is what really landed. One rule holds in every row: a claim that landed, or that may
// have, is never reported as not made, and its record is never marked NOT USED.

const assert = require('node:assert/strict');
const test = require('node:test');
const { state, fixture, wroteNothing, STORE_REPO, PREFIX, controller, NEW, POSTS, READS_RECORD, CLAIMS, AT_COMMIT, ON_BRANCH } = require('./programme-takeover-fixture.cjs');
const { claimStanding } = require('../../skills/github-program-reconciler/scripts/programme-takeover.cjs');

const BACKENDS = ['store', 'branch'];
const LOST = () => { throw new state.ProgrammeError('GH_FAILED', 'gh returned no HTTP status'); };
const answer = (status, json = { message: `HTTP ${status}` }) => () => ({ status, json });
const NOT_MADE = /No claim was made|made no claim/;
const COMMITS = call => call.method === 'GET' && /\/commits\?/.test(call.path);

// Arranges one route from the claim's request on. `lands`: the write happens. `put`: what GitHub answers
// (its own answer when not given). `then`: what else happens straight after it. `at`, `on`: what a read at
// a commit and one of the branch answer afterwards, every time or `once`. `lag`: branch reads serve the
// version before the newest. `again`: what the second request answers.
function route(fx, { lands = true, put = null, then = null, at = null, on = null, once = false, lag = false, again = null, staleCommits = false, lastRead = null }) {
  const { github } = fx;
  let sent = 0;
  let used = false;
  let confirmed = false;
  const lists = new Map();
  github.intercept(call => {
    if (COMMITS(call) && staleCommits) {
      if (!lists.has(call.path)) lists.set(call.path, github.route(call.method, call.path));
      return lists.get(call.path);
    }
    if (CLAIMS(call)) {
      sent += 1;
      if (sent === 2 && again) return again();
      if (sent > 1) return undefined;
      const real = lands ? github.route(call.method, call.path, call.body) : undefined;
      if (then) fx.aside(() => then(fx));
      github.branchLag = lag;
      return put ? put() : real;
    }
    if (!sent) return undefined;
    if (AT_COMMIT(call) && at && !(once && used)) { used = true; return at(); }
    if (ON_BRANCH(call) && on) return on();
    // The last read: the first branch read after the claim is read back.
    if (AT_COMMIT(call)) confirmed = true;
    if (ON_BRANCH(call) && confirmed && lastRead) return lastRead();
    return undefined;
  });
}

// The rule itself, for any route: what was said and left against what landed.
function checkTruth(fx, run, label) {
  const landed = fx.everHeld(NEW, 2);
  const record = fx.records()[0];
  const marked = record.body.startsWith('NOT USED: ');
  const { code = null, message = '' } = run.error || {};
  const name = `${label}: ${code} ${message}`;
  assert.equal(/is marked NOT USED\.$/.test(message), marked, `${name}: the message and the record agree`);
  if (landed) {
    assert.equal(marked, false, `${name}: the record that carried the claim is marked`);
    assert.doesNotMatch(message, NOT_MADE, name);
    assert.ok([null, 'CLAIM_LANDED', 'CLAIM_UNCERTAIN', 'EPOCH_MOVED'].includes(code), name);
    if (code === 'CLAIM_LANDED' || code === 'EPOCH_MOVED') assert.match(message, /^The claim of #421 landed: /, name);
    if (code === 'EPOCH_MOVED') assert.match(message, /another takeover followed this one\. Stop and report to the owner\.$/, name);
  } else {
    assert.ok(code && code !== 'CLAIM_LANDED', `${name}: nothing landed`);
    assert.doesNotMatch(message, /^The claim of #421 landed/, name);
    if (code === 'CLAIM_UNCERTAIN') assert.equal(marked, false, name);
  }
  if (code === 'CLAIM_UNCERTAIN') assert.doesNotMatch(message, NOT_MADE, name);
  const holders = new Set(fx.fences().filter(fence => fence.epoch === 2).map(fence => fence.holder_session || fence.holder_session_hash));
  assert.ok(holders.size <= 1, `${name}: one claim per epoch`);
  return { code, landed, marked };
}

const comment = fx => fx.github.addComment(421, { body: 'Still here' });
const follows = fx => fx.rivalClaims();
// [route, the outcome's code (null: done; by backend where they differ), whether the claim landed, the record]
const STANDS = 'stands';
const VOID = 'NOT USED';
const ROUTES = [
  ['answered and read back', {}, null, true, STANDS],
  // It landed and its answer did not say so.
  ['landed, answer 502', { put: answer(502) }, null, true, STANDS],
  ['landed, answer 500', { put: answer(500) }, null, true, STANDS],
  ['landed, answer 408', { put: answer(408) }, null, true, STANDS],
  ['landed, no answer', { put: LOST }, null, true, STANDS],
  ['landed, an answer with no commit', { put: answer(200, { content: {} }) }, null, true, STANDS],
  ['landed, an empty answer', { put: answer(200, null) }, null, true, STANDS],
  // It landed, GitHub said so, and its read-back failed.
  ...[401, 403, 404, 422, 429, 500, 502].map(status => [`landed, read-back ${status}`, { at: answer(status), once: true }, null, true, STANDS]),
  ['landed, read-back with no answer', { at: LOST, once: true }, null, true, STANDS],
  ['landed, read-back not a document', { at: answer(200, { sha: 'f'.repeat(40), encoding: 'base64', content: Buffer.from('{}').toString('base64') }), once: true }, null, true, STANDS],
  ['landed, an empty read-back', { at: answer(200, null), once: true }, null, true, STANDS],
  ['landed, no read at its commit works, the branch read does', { at: answer(403) }, null, true, STANDS],
  ['landed, read-back 404 once, the branch read old', { at: answer(404), once: true, lag: true }, null, true, STANDS],
  ['landed, read-back 403 once, the branch read and the commit list old', { at: answer(403), once: true, lag: true, staleCommits: true }, null, true, STANDS],
  ['landed, no read at its commit works, the branch read old', { at: answer(404), lag: true }, 'CLAIM_UNCERTAIN', true, STANDS],
  ['landed, no read at its commit works, the branch read and the commit list old', { at: answer(404), lag: true, staleCommits: true }, 'CLAIM_UNCERTAIN', true, STANDS],
  ['landed, no read works', { at: answer(403), on: answer(403) }, 'CLAIM_UNCERTAIN', true, STANDS],
  ['landed, answer 502, the branch read 403', { put: answer(502), on: answer(403) }, 'CLAIM_UNCERTAIN', true, STANDS],
  ['landed, answer 502, the branch read 502', { put: answer(502), on: answer(502) }, 'CLAIM_UNCERTAIN', true, STANDS],
  ['landed, answer 502, the branch read gives no answer', { put: answer(502), on: LOST }, 'CLAIM_UNCERTAIN', true, STANDS],
  // The public branch reads its head commit when a branch read shows less than its checkpoint.
  ['landed, answer 502, the branch read 404', { put: answer(502), on: answer(404) }, { store: 'CLAIM_UNCERTAIN', branch: null }, true, STANDS],
  // It landed, and the branch read still serves the version before it: its own commit is no write of the old controller.
  ['landed, answer 502, the branch read old', { put: answer(502), lag: true }, null, true, STANDS],
  ['landed, no answer, the branch read old, a comment on the parent', { put: LOST, lag: true, then: comment }, null, true, STANDS],
  ['landed, answer 502, the branch read and the commit list old', { put: answer(502), lag: true, staleCommits: true }, 'CLAIM_UNCERTAIN', true, STANDS],
  ['landed, answer 502, both old, the second request 502', { put: answer(502), lag: true, staleCommits: true, again: answer(502) }, 'CLAIM_UNCERTAIN', true, STANDS],
  ['landed, answer 502, both old, the second request 403', { put: answer(502), lag: true, staleCommits: true, again: answer(403) }, 'CLAIM_UNCERTAIN', true, STANDS],
  // It landed, and someone wrote after it.
  ['landed, answer 502, the next successor took over', { put: answer(502), then: follows }, 'EPOCH_MOVED', true, STANDS],
  ['landed, read-back 403, the next successor took over', { at: answer(403), then: follows }, 'EPOCH_MOVED', true, STANDS],
  ['landed and read back, the next successor took over', { then: follows }, 'EPOCH_MOVED', true, STANDS],
  ['landed, answer 502, a sweep wrote', { put: answer(502), then: fx => fx.sweepWrites() }, null, true, STANDS],
  // Read back, and the last read does not work or does not show it.
  ['read back, the last read 403', { lastRead: answer(403) }, 'CLAIM_LANDED', true, STANDS],
  ['read back, the last read 502', { lastRead: answer(502) }, 'CLAIM_LANDED', true, STANDS],
  ['read back, the last read gives no answer', { lastRead: LOST }, 'CLAIM_LANDED', true, STANDS],
  ['read back, an empty last read', { lastRead: answer(200, null) }, 'CLAIM_LANDED', true, STANDS],
  ['read back, the last read finds nothing', { lastRead: answer(404) }, { store: 'CLAIM_LANDED', branch: null }, true, STANDS],
  // It did not land, and no answer said so.
  ['lost, answer 502', { lands: false, put: answer(502) }, null, true, STANDS],
  ['lost, no answer', { lands: false, put: LOST }, null, true, STANDS],
  ['lost, answer 502 twice', { lands: false, put: answer(502), again: answer(502) }, 'CLAIM_UNCERTAIN', false, STANDS],
  ['lost, answer 502, then refused', { lands: false, put: answer(502), again: answer(403) }, 'CLAIM_UNCERTAIN', false, STANDS],
  ['lost, answer 502, the branch read 403', { lands: false, put: answer(502), on: answer(403) }, 'CLAIM_UNCERTAIN', false, STANDS],
  ['lost, answer 502, a comment on the parent', { lands: false, put: answer(502), then: comment }, 'CLAIM_UNCERTAIN', false, STANDS],
  // ... and a later version of the parent shows it can no longer land.
  ['lost, answer 502, a sweep wrote the parent', { lands: false, put: answer(502), then: fx => fx.sweepWrites() }, null, true, STANDS],
  ['lost, answer 502 twice, a sweep wrote the parent in between', { lands: false, put: answer(502), then: fx => fx.sweepWrites(), again: answer(502) }, 'CLAIM_UNCERTAIN', false, STANDS],
  ['lost, answer 502, the old controller wrote the parent', { lands: false, put: answer(502), then: fx => fx.oldWrites() }, 'OLD_WRITER_ACTIVE', false, VOID],
  ['lost, answer 502, another successor claimed', { lands: false, put: answer(502), then: follows }, 'EPOCH_MOVED', false, VOID],
  // GitHub said the write was refused.
  ...[401, 403, 404, 422, 429].map(status => [`refused ${status}`, { lands: false, put: answer(status) }, 'STORE_UNREACHABLE', false, VOID]),
  ['refused 409, unchanged', { lands: false, put: answer(409) }, null, true, STANDS],
  ['refused: gh is not signed in', { lands: false, put: () => { throw new state.ProgrammeError('GH_AUTH', 'gh is not signed in'); } }, 'GH_AUTH', false, STANDS],
];

test('F1 every route from the claim on says what is true, on both backends', () => {
  for (const backend of BACKENDS) {
    for (const [label, options, outcome, landed, record] of ROUTES) {
      const code = outcome && typeof outcome === 'object' ? outcome[backend] : outcome;
      const fx = fixture({ backend });
      route(fx, options);
      const run = fx.takeover();
      const name = `${backend}: ${label}`;
      const seen = checkTruth(fx, run, name);
      assert.deepEqual([seen.code, seen.landed, seen.marked ? VOID : STANDS], [code, landed, record], `${name}: ${run.error?.message}`);
      assert.equal(fx.records().length, 1, name);
      // A claim GitHub answered with a commit is never sent again, and the words say GitHub took it.
      if (!options.put && !options.then) assert.equal(fx.writes(run.calls).filter(CLAIMS).length, 1, name);
      if (!options.put && code === 'CLAIM_UNCERTAIN') assert.match(run.error.message, /GitHub accepted it as commit \S+, and no read settled it\./, name);
      if (code) continue;
      assert.deepEqual([run.result.parent.epoch, run.result.claim.acting.session], [2, NEW], name);
      assert.match(run.result.done_line, /^Takeover done: /, name);
    }
  }
});

test('F1 every combination of those answers, reads and events keeps to what landed', () => {
  const puts = [['200', null], ['502', answer(502)], ['408', answer(408)], ['no answer', LOST], ['403', answer(403)], ['empty', answer(200, null)]];
  const ats = [['read-back works', {}], ['read-back 403 once', { at: answer(403), once: true }], ['read-back 404', { at: answer(404) }], ['read-back lost', { at: LOST }], ['read-back empty', { at: answer(200, null) }]];
  const ons = [['branch works', {}], ['branch old', { lag: true }], ['branch and commit list old', { lag: true, staleCommits: true }], ['branch 403', { on: answer(403) }], ['branch lost', { on: LOST }]];
  const thens = [['nothing else', null], ['a comment', comment], ['a sweep', fx => fx.sweepWrites()], ['a rival', follows], ['the old controller', fx => { try { fx.oldWrites(); } catch (error) { if (error.code !== 'STALE_WRITER') throw error; } }]];
  const agains = [['', null], [', then 502', answer(502)], [', then 403', answer(403)]];
  const codes = new Map();
  for (const backend of BACKENDS) {
    let at = 0;
    for (const lands of [true, false]) for (const [p, put] of puts) for (const [a, atRead] of ats) for (const [o, onRead] of ons) for (const [t, then] of thens) for (const [g, again] of agains) {
      at += 1;
      // A refusal that landed is not an answer GitHub gives; one that did not land is never a success.
      if (lands ? put && p === '403' : p === '200' || p === 'empty') continue;
      // The branch backend runs every thirteenth row: a prime, so every value of each part is met.
      if (backend === 'branch' && at % 13 !== 0) continue;
      const fx = fixture({ backend });
      route(fx, { lands, put, ...atRead, ...onRead, then, again });
      const { code } = checkTruth(fx, fx.takeover(), `${backend}: ${lands ? 'landed' : 'lost'}, ${p}${g}, ${a}, ${o}, ${t}`);
      codes.set(`${backend} ${code}`, (codes.get(`${backend} ${code}`) || 0) + 1);
    }
  }
  for (const backend of BACKENDS) for (const code of [null, 'CLAIM_LANDED', 'CLAIM_UNCERTAIN', 'EPOCH_MOVED', 'OLD_WRITER_ACTIVE', 'STORE_UNREACHABLE']) assert.ok(codes.get(`${backend} ${code}`), `${backend}: ${code} was met`);
});

test('F1 an appointment keeps to the same rule', () => {
  for (const [label, options, code, marked] of [
    ['answered', {}, null, false], ['landed, answer 502', { put: answer(502) }, null, false], ['landed, read-back 403', { at: answer(403), once: true }, null, false],
    ['landed, answer 502, the branch read old', { put: answer(502), lag: true }, 'CLAIM_UNCERTAIN', false], ['refused 403', { lands: false, put: answer(403) }, 'STORE_UNREACHABLE', true],
  ]) {
    const fx = fixture({ held: false });
    route(fx, options);
    const run = fx.takeover();
    assert.equal(run.error?.code ?? null, code, `${label}: ${run.error?.message}`);
    assert.equal(fx.records()[0].body.startsWith('NOT USED: '), marked, label);
    if (code !== 'STORE_UNREACHABLE') { assert.ok(fx.everHeld(NEW, 1), label); assert.doesNotMatch(run.error?.message || '', NOT_MADE, label); }
  }
});

test('F1 a request that is not the claim is never its answer: on the branch, the sidecar and the privacy check come first', () => {
  const SIDECAR = call => call.path.includes('/private/parent-421/');
  const PRIVATE = call => call.method === 'GET' && call.path === `repos/${STORE_REPO}`;
  let posted;
  for (const [label, when, reply, code, marked] of [
    ['the sidecar write refused', call => SIDECAR(call) && call.method === 'PUT', answer(403), 'STORE_UNREACHABLE', false],
    ['the sidecar read-back refused', call => SIDECAR(call) && call.method === 'GET' && /ref=[0-9a-f]{40}$/.test(call.path), answer(403), 'STORE_UNREACHABLE', false],
    ['the store cannot be read', PRIVATE, answer(403), 'STORE_UNREACHABLE', false],
    ['the store is not private', PRIVATE, answer(200, { private: false, permissions: { push: true } }), 'STORE_UNREACHABLE', true],
    ['the sidecar write gets no answer once', (call, seen) => SIDECAR(call) && call.method === 'PUT' && seen === 0, answer(502), null, false],
    ['the sidecar write gets no answer twice', call => SIDECAR(call) && call.method === 'PUT', answer(502), 'GH_FAILED', false],
    ['the checkpoint after the claim is refused', call => call.method === 'PUT' && call.path.endsWith('/checkpoint.json'), answer(403), 'CLAIM_LANDED', false],
  ]) {
    const fx = fixture({ backend: 'branch' });
    posted = false;
    let seen = 0;
    fx.github.intercept(call => { if (POSTS(call)) posted = true; return posted && when(call, seen) ? (seen += 1, reply()) : undefined; });
    const run = fx.takeover();
    assert.equal(run.error?.code ?? null, code, `${label}: ${run.error?.message}`);
    const landed = [null, 'CLAIM_LANDED'].includes(code);
    assert.equal(fx.everHeld(NEW, 2), landed, label);
    assert.equal(fx.records()[0].body.startsWith('NOT USED: '), marked, label);
    if (!landed) assert.match(run.error.message, /No claim was made\./, label);
  }
});

test('F1 the next run: a claim an earlier run sent is never repeated or its record marked', () => {
  // The run dies after its claim landed, before any read-back.
  const died = fx => {
    let dead = false;
    fx.github.intercept(call => {
      if (dead) throw Object.assign(new Error('killed'), { killed: true });
      if (!CLAIMS(call) || fx.died) return undefined;
      fx.died = true;
      dead = true;
      fx.github.route(call.method, call.path, call.body);
      throw Object.assign(new Error('killed'), { killed: true });
    });
    // A failure with no code of its own after a claim went out is uncertain too, never a bare crash.
    const run = fx.takeover();
    assert.equal(run.error?.code, 'CLAIM_UNCERTAIN');
    assert.equal(run.error.cause.killed, true);
    fx.github.hooks = [];
    assert.ok(fx.everHeld(NEW, 2));
    return fx.records()[0];
  };
  const fx = fixture();
  const first = died(fx);
  const again = fx.takeover();
  assert.equal(again.error?.code, 'ALREADY_HOLDER');
  wroteNothing(fx, again, 'the next run');
  // The branch read is still old in the next run: whatever it answers, the record that carried the claim stands.
  for (const words of [[], ['--owner-stop', 'it is closed']]) {
    const old = fixture();
    const record = died(old);
    old.github.branchLag = true;
    const run = old.takeover(words);
    assert.ok(run.error, 'nothing is claimed twice');
    assert.doesNotMatch(run.error.message, /No claim was made/, run.error.message);
    assert.ok(record.body.startsWith(PREFIX), `${words.join(' ')}: the record that carried the claim stands`);
    old.github.branchLag = false;
    assert.equal(old.takeover(words).error?.code, 'ALREADY_HOLDER');
    assert.ok(old.records()[0].body.startsWith(PREFIX));
  }
  assert.ok(first.body.startsWith(PREFIX));
  // The earlier run's own record is resumed while its claim shows only at the newest state commit.
  const late = fixture();
  let record = false;
  late.before(READS_RECORD, () => { record = true; });
  late.github.intercept(call => { if (record && !late.killed) { late.killed = true; throw Object.assign(new Error('killed'), { killed: true }); } void call; return undefined; });
  assert.throws(() => late.takeover(), { killed: true });
  late.github.hooks = [];
  const id = late.records()[0].id;
  late.before(READS_RECORD, () => { late.aside(() => late.other().mutate('parent', 421, { writer: { session: NEW, prefix: PREFIX }, authorise: false, change: doc => {
    const next = state.claimDocument(doc, { session: NEW, prefix: PREFIX }, { takeover: true });
    return { ...next, private: { ...next.private, takeovers: [{ comment_id: id, from_epoch: 1 }] } };
  } })); late.github.branchLag = true; });
  const resumed = late.takeover();
  assert.ok(late.records()[0].body.startsWith(PREFIX), resumed.error?.message);
  assert.doesNotMatch(resumed.error?.message || '', NOT_MADE);
});

test('F1 two runs under one name: the one whose record carried the claim is never marked', () => {
  // The other run of this name posts and claims with its own record between this one's record and claim.
  const fx = fixture();
  let twin = null;
  fx.before(CLAIMS, () => { fx.aside(() => {
    const id = fx.github.addComment(421, { body: fx.records()[0].body.replace(`${PREFIX}001`, `${PREFIX}002`) });
    twin = fx.github.comments.get(id);
    fx.rivalClaims(NEW, id);
  }); });
  const run = fx.takeover();
  assert.equal(run.error?.code, 'EPOCH_MOVED', run.error?.message);
  assert.deepEqual(fx.records().map(record => record.body.startsWith('NOT USED: ')), [true, false], 'this run\'s record carried nothing, the other\'s did');
  assert.ok(twin.body.startsWith(PREFIX));
  // Two unused records of one name: the one not used is marked only once the claim landed.
  const two = fixture();
  let dead = true;
  two.github.intercept(call => { if (dead && READS_RECORD(call)) throw Object.assign(new Error('killed'), { killed: true }); return undefined; });
  assert.throws(() => two.takeover(), { killed: true });
  const copy = two.github.addComment(421, { body: two.records()[0].body.replace(`${PREFIX}001`, `${PREFIX}002`) });
  dead = false;
  let before = null;
  two.before(CLAIMS, () => { before = two.records().map(record => record.body.startsWith('NOT USED: ')); });
  const claimed = two.takeover();
  assert.equal(claimed.error, null, claimed.error?.message);
  assert.deepEqual([claimed.result.record.comment_id, before], [copy, [false, false]]);
  assert.deepEqual(two.records().map(record => record.body.startsWith('NOT USED: ')), [true, false]);
});

// A run that stopped right after its record, and the record.
function stoppedAfterRecord(words = []) {
  const fx = fixture();
  let dead = true;
  fx.github.intercept(call => { if (dead && READS_RECORD(call)) throw Object.assign(new Error('killed'), { killed: true }); return undefined; });
  assert.throws(() => fx.takeover(words), { killed: true });
  dead = false;
  return { fx, first: fx.records()[0] };
}

test('F1 an earlier record of the name: marked when a read shows another claim left its epoch, never when it carried it', () => {
  const words = ['--owner-stop', 'it is closed'];
  for (const [label, claims, expected] of [
    ['another controller claimed', fx => fx.rivalClaims(), [true, true]],
    ['this name claimed with the earlier record', (fx, first) => fx.rivalClaims(NEW, first.id), [false, true]],
  ]) {
    const { fx, first } = stoppedAfterRecord();
    // The second run's words are not in the first record, so it posts its own.
    fx.before(CLAIMS, () => fx.aside(() => claims(fx, first)));
    const run = fx.takeover(words);
    assert.equal(run.error?.code, 'EPOCH_MOVED', `${label}: ${run.error?.message}`);
    assert.deepEqual(fx.records().map(record => record.body.startsWith('NOT USED: ')), expected, label);
    assert.match(run.error.message, /This run made no claim\./, label);
  }
});

test('F1 a resumed record is not marked for what could not be read: an earlier run may have claimed with it', () => {
  for (const [label, arrange, code, marked] of [
    ['a comment, the newest state commit not read', fx => fx.github.intercept(call => (AT_COMMIT(call) ? { status: 404, json: {} } : undefined)), 'OLD_WRITER_ACTIVE', false],
    ['a comment, the newest state commit read', () => {}, 'OLD_WRITER_ACTIVE', true],
  ]) {
    const { fx } = stoppedAfterRecord();
    arrange(fx);
    fx.before(READS_RECORD, () => comment(fx));
    const run = fx.takeover();
    assert.equal(run.error?.code, code, `${label}: ${run.error?.message}`);
    assert.match(run.error.message, /This run made no claim\./, label);
    assert.equal(fx.records()[0].body.startsWith('NOT USED: '), marked, label);
  }
  // The fence is far past the record's epoch with no trace of who left it: the same for a new record is final.
  const jump = fx => fx.before(CLAIMS, () => fx.aside(() => fx.other().mutate('parent', 421, { writer: controller, change: doc => ({ ...doc, fence: { ...doc.fence, epoch: 5, holder_session: 'x-controller' } }) })));
  const { fx } = stoppedAfterRecord();
  jump(fx);
  assert.equal(fx.takeover().error?.code, 'EPOCH_MOVED');
  assert.ok(fx.records()[0].body.startsWith(PREFIX));
  const fresh = fixture();
  jump(fresh);
  assert.equal(fresh.takeover().error?.code, 'EPOCH_MOVED');
  assert.match(fresh.records()[0].body, /^NOT USED: /);
});

test('F1 where a parent document stands against one claim', () => {
  const writer = { session: NEW, prefix: PREFIX };
  const fence = { epoch: 1, holder_session: controller.session, holder_prefix: PREFIX };
  const at = (epoch, session, takeovers, prefix = PREFIX) => ({ schema: state.SCHEMA.parent, fence: { epoch, holder_session: session, holder_prefix: prefix }, private: takeovers === null ? undefined : { takeovers } });
  const ours = { comment_id: 7, from_epoch: 1 };
  for (const [label, doc, expected] of [
    ['as the record names it', at(1, controller.session, []), 'unclaimed'], ['with no private part', at(1, controller.session, null), 'unclaimed'],
    ['ours', at(2, NEW, [ours]), 'held'], ['ours, then another', at(3, 'x-controller', [ours, { comment_id: 8, from_epoch: 2 }]), 'followed'],
    ['ours, then this name again', at(3, NEW, [ours, { comment_id: 8, from_epoch: 2 }]), 'followed'],
    ['this name, with another record', at(2, NEW, [{ comment_id: 8, from_epoch: 1 }]), 'taken'], ['this name, with no record', at(2, NEW, []), 'taken'],
    ['another claim, one epoch on', at(2, 'x-controller', []), 'taken'], ['another claim, then more', at(5, 'x-controller', [{ comment_id: 8, from_epoch: 1 }]), 'taken'],
    ['later epochs with no trace of this one', at(5, 'x-controller', [{ comment_id: 8, from_epoch: 4 }]), 'unknown'],
    ['the record\'s id for another epoch', at(1, controller.session, [{ comment_id: 7, from_epoch: 0 }]), 'unclaimed'],
    ['the same epoch, another holder', at(1, 'x-controller', []), 'unknown'], ['the same epoch and name, another prefix', at(1, controller.session, [], 'CDX-TK421-'), 'unknown'],
    ['an earlier epoch', at(0, controller.session, []), 'unknown'],
  ]) assert.equal(claimStanding(doc, { fence, writer, recordId: 7 }), expected, label);
  // The fence the record names is every part of it: a changed holder or prefix at the same epoch stops the claim.
  for (const change of [{ holder_session: 'x-controller' }, { holder_prefix: 'CDX-TK421-' }, { epoch: 4 }]) {
    const fx = fixture();
    fx.before(CLAIMS, () => fx.aside(() => fx.other().mutate('parent', 421, { writer: controller, change: doc => ({ ...doc, fence: { ...doc.fence, ...change } }) })));
    const run = fx.takeover();
    assert.equal(run.error?.code, 'EPOCH_MOVED', `${JSON.stringify(change)}: ${run.error?.message}`);
    assert.equal(fx.everHeld(NEW, 2), false);
  }
});
