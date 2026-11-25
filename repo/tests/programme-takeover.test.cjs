'use strict';

// One controller takeover through the command line, against the in-memory GitHub: the stop proof, the
// record, the claim and every refusal. The table at the end drives each state of the parent as each
// role. Every refusal before the record is checked to write nothing anywhere.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const state = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');
const cli = require('../../skills/github-program-reconciler/scripts/programme.cjs');
const { FakeGitHub } = require('./toolkit-programme-fake-github.cjs');

const REPO = 'acme/app';
const STORE_PATH = `state/${REPO}/`;
const PARENT_FILE = `${STORE_PATH}parent-421.json`;
const PREFIX = 'INT-TK421-';
const MINUTE = 60 * 1000;
const controller = { session: 'desk-controller-1', prefix: PREFIX };
const NEW = 'desk-controller-2';
const WORDS = ['--surface', 'test harness (host evidence read)', '--next', 'read the repository map'];
const PAGE = /^<!-- programme-page-archive/;
const OUTCOMES = [{ issue: 423, class: 'COMMITTED', parent: 421, order: 1 }];

function fixture({ held = true, missing = false, holder = controller } = {}) {
  const github = new FakeGitHub({ repository: REPO, store: 'acme/state-store' });
  github.repos.get(REPO).default_branch = 'main';
  const binding = { schema: state.SCHEMA.binding, repository: REPO, parent_issue: 421, record_prefix: PREFIX, writer_prefix: PREFIX,
    store: { kind: 'github', repository: 'acme/state-store', branch: 'main', path: STORE_PATH }, required_checks: ['validate'] };
  github.addIssue(421, { body: '## CURRENT\n' });
  github.addIssue(423, { body: 'Task' });
  const now = () => new Date(github.clock).toISOString();
  const store = new state.StateStore({ transport: github, store: binding.store, now, toolkitVersion: '3.9.0' });
  const fx = { github, binding, store, now, output: '', errors: '' };
  const empty = state.newParent({ repository: REPO, parentIssue: 421, outcomes: OUTCOMES });
  if (!missing) store.write('parent', 421, held ? state.claimDocument(empty, holder, {}) : empty, { sha: null, previous: null });
  // The old controller has been quiet for an hour unless a test says otherwise.
  fx.wait = minutes => { github.clock += minutes * MINUTE; };
  fx.wait(60);
  fx.parentDoc = () => store.read('parent', 421).doc;
  fx.fence = () => JSON.parse(github.files.get(PARENT_FILE).text).fence;
  fx.deps = (extra = {}) => ({ transport: github, binding, originUrl: `https://github.com/${REPO}.git`, repoRoot: __dirname, toolkitVersion: '3.9.0', environment: {}, now,
    stdout: { write: text => { fx.output += text; } }, stderr: { write: text => { fx.errors += text; } }, ...extra });
  fx.run = (argv, extra) => {
    fx.output = '';
    fx.errors = '';
    const from = github.calls.length;
    try {
      const code = cli.main(argv, fx.deps(extra));
      return { code, result: fx.output.startsWith('{') ? JSON.parse(fx.output) : fx.output, error: null, calls: github.calls.slice(from) };
    } catch (error) {
      if (!error.code) throw error;
      return { result: null, error, calls: github.calls.slice(from) };
    }
  };
  fx.takeover = (extra = [], { session = NEW, apply = true, deps = {} } = {}) => fx.run(['takeover', '--session', session, ...WORDS, ...(apply ? ['--apply', '--controller'] : []), '--json', ...extra], deps);
  fx.dry = (extra = [], options = {}) => fx.takeover(extra, { ...options, apply: false });
  // Another writer, on its own store object, as another process would be.
  fx.other = () => new state.StateStore({ transport: github, store: binding.store, now, toolkitVersion: '3.9.0' });
  fx.oldWrites = (note = 'old controller at work') => fx.other().mutate('parent', 421, { writer: holder, change: doc => { doc.private.note = `${note} ${github.clock}`; return doc; } });
  fx.sweepWrites = () => fx.other().mutate('parent', 421, { writer: state.refreshWriter(fx.other().read('parent', 421).doc),
    change: doc => { doc.attention = []; doc.private.sweep_note = String(github.clock); return doc; } });
  fx.commit = (file, message, login = github.login) => { github.committer = login; github.putFile(`${STORE_PATH}${file}`, { at: github.clock, message }, message); github.committer = null; };
  // Runs `effect` once, just before the first call that `when` matches.
  fx.before = (when, effect) => {
    let done = false;
    github.intercept(call => { if (!done && when(call)) { done = true; effect(call); } return undefined; });
  };
  fx.records = () => [...github.comments.values()].filter(comment => comment.issue === 421 && /TAKEOVER: controller/.test(comment.body));
  fx.writes = calls => calls.filter(call => call.method !== 'GET');
  return fx;
}

const POSTS = call => call.method === 'POST' && call.path.endsWith('/issues/421/comments');
const READS_RECORD = call => call.method === 'GET' && /issues\/comments\/\d+$/.test(call.path);
const CLAIMS = call => call.method === 'PUT' && call.path.endsWith('/parent-421.json');
// Nothing anywhere: no comment, no edit, no store commit.
function wroteNothing(fx, run, label) { assert.deepEqual(fx.writes(run.calls).map(call => `${call.method} ${call.path}`), [], `${label}: nothing was written`); }

test('1 an unheld parent does not move without a record; a takeover appoints with one', () => {
  const fx = fixture({ held: false });
  const before = fx.fence();
  assert.deepEqual([before.epoch, before.holder_session], [0, null]);
  // The command that once claimed an unheld parent with no record at all.
  const old = fx.run(['claim', '--parent', '--session', NEW, '--controller', '--json']);
  assert.deepEqual(fx.fence(), before, 'the epoch does not move without a record');
  assert.equal(old.error?.code, 'USAGE');
  wroteNothing(fx, old, 'the old claim');
  const { result, error } = fx.takeover();
  assert.equal(error, null, error?.message);
  assert.deepEqual([fx.fence().epoch, fx.fence().holder_session], [1, NEW]);
  assert.match(fx.records()[0].body, /; epoch 0 to 1, appointment; no previous writer holds the parent; next: /);
  assert.deepEqual(fx.parentDoc().private, { takeovers: [{ comment_id: result.record.comment_id, from_epoch: 0 }] }, 'nobody is retired by an appointment');
});

test('I1 no other command moves the parent epoch', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'programme-takeover-'));
  try {
    const patch = value => { const file = path.join(dir, 'patch.json'); fs.writeFileSync(file, JSON.stringify(value)); return file; };
    for (const [held, argv] of [
      [true, ['update-parent', '--patch', patch({ fence: { epoch: 9, holder_session: NEW } })]], [true, ['reconcile', '--apply']], [true, ['refresh']],
      [false, ['reconcile', '--apply']], [false, ['refresh']], [false, ['claim', '--parent']], [true, ['claim', '--issue', '423', '--lane', '--takeover']], [true, ['claim', '--parent', '--takeover']],
    ]) {
      for (const session of [controller.session, NEW]) {
        const fx = fixture({ held });
        const before = fx.fence();
        fx.run(argv[0] === 'refresh' ? argv : [...argv, '--session', session, '--controller']);
        assert.deepEqual(fx.fence(), before, `${argv.join(' ')} as ${session}`);
      }
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('3 a quiet held parent: one record, then one claim, both read back', () => {
  const fx = fixture();
  fx.github.addComment(421, { body: `An older decision\n---\n${PREFIX}090 OWNER-DECISION: go` });
  fx.wait(60);
  const { result, error, calls } = fx.takeover();
  assert.equal(error, null, error?.message);
  const writes = fx.writes(calls);
  assert.deepEqual(writes.map(call => [POSTS(call), CLAIMS(call)]), [[true, false], [false, true]], 'the record, then the claim, and nothing else');
  const posted = calls.indexOf(writes[0]);
  const claimed = calls.indexOf(writes[1]);
  assert.ok(calls.findIndex((call, at) => at > posted && READS_RECORD(call)) < claimed, 'the record is read back before the claim');
  assert.ok(calls.some((call, at) => at > claimed && call.method === 'GET' && call.path.includes('/parent-421.json?ref=')), 'the claim is read back');
  assert.deepEqual([fx.fence().epoch, fx.fence().holder_session, fx.fence().holder_prefix], [2, NEW, PREFIX]);
  assert.deepEqual(fx.parentDoc().private, { retired_holders: [controller.session], takeovers: [{ comment_id: result.record.comment_id, from_epoch: 1 }] });
  const [record] = fx.records();
  assert.equal(record.body, `${PREFIX}091 TAKEOVER: controller ${NEW} on test harness (host evidence read); Toolkit main ${'1'.repeat(40)}; CONTROLLER.md blob ${'2'.repeat(40)}; epoch 1 to 2;`
    + ` old writer stopped: its last own write is comment ${result.stop.last_write.key} at ${result.stop.last_write.at}, 10 minutes or more before this record; next: read the repository map.`);
  assert.deepEqual([result.schema, result.mode, result.record.record_id, result.record.comment_id, result.record.author, result.parent.epoch, result.parent.taken_from],
    ['toolkit.takeover.v1', 'apply', `${PREFIX}091`, record.id, 'owner', 2, 1]);
  assert.match(result.done_line, new RegExp(`^Takeover done: ${NEW} holds #421 at epoch 2 \\(was 1\\); record ${PREFIX}091 https://github\\.com/acme/app/issues/421#issuecomment-${record.id}; Toolkit main 1111111, Controller blob 2222222; .*next: read the repository map\\.$`));
  assert.match(result.claim.commit, /^c\d+$/);
  // The replaced controller is refused from here on; the new one writes.
  assert.throws(() => fx.oldWrites(), { code: 'STALE_WRITER' });
  assert.equal(fx.run(['show', '--parent', '--json']).result.document.fence.epoch, 2);
});

test('3b the dry run writes nothing, needs no --controller, and prints the record a takeover would post', () => {
  const fx = fixture();
  const dry = fx.dry();
  assert.equal(dry.error, null, dry.error?.message);
  wroteNothing(fx, dry, 'the dry run');
  assert.equal(dry.result.ready, true);
  assert.deepEqual([dry.result.governance.state, dry.result.account.login, dry.result.account.permission, dry.result.parent.epoch, dry.result.parent.next_epoch, dry.result.stop.proven, dry.result.holds],
    ['ENABLED', 'owner', 'push', 1, 2, true, []]);
  assert.equal(dry.result.stop.last_write.source, 'state commits');
  assert.equal(dry.result.versions, null, 'the version block is not built here');
  const line = dry.result.record.line;
  assert.equal(fx.takeover().result.record.line, line, 'the apply posts the line the dry run printed');
  // Its text form says the same, with nothing in it addressed to another session.
  const text = fixture().run(['takeover', '--session', NEW, ...WORDS]);
  assert.match(text.result, /^Takeover dry run of acme\/app \(default branch main\): ready\. Nothing was written\.\nGovernance: ENABLED\n/);
  assert.match(text.result, /Stop: proven \(quiet for 10 minutes\)/);
});

test('4 a sweep writing the parent between the record and the claim: the claim lands', () => {
  for (const [label, when] of [['after the record is posted', READS_RECORD], ['just before the claim', CLAIMS]]) {
    const fx = fixture();
    fx.before(when, () => fx.sweepWrites());
    const { result, error } = fx.takeover();
    assert.equal(error, null, `${label}: ${error?.message}`);
    assert.deepEqual([fx.fence().epoch, fx.fence().holder_session], [2, NEW], label);
    assert.ok(fx.parentDoc().private.sweep_note, `${label}: the sweep's own change is kept`);
    assert.equal(fx.records().length, 1, `${label}: one record`);
    assert.equal(result.record.resumed, false);
  }
  // A sweep that writes before every one of the first five claims: each is a conflict, read again.
  const fx = fixture();
  let writes = 0;
  fx.github.intercept(call => { if (CLAIMS(call) && call.body.message.endsWith('revision 1') === false && !call.body.message.endsWith(state.REFRESH_MARK) && writes < 5) { writes += 1; fx.sweepWrites(); } return undefined; });
  const busy = fx.takeover();
  assert.equal(busy.error, null, busy.error?.message);
  assert.deepEqual([writes, fx.fence().epoch], [5, 2]);
});

test('5 the stop proof: 10 minutes from the old controller\'s last write, and nothing after the record', () => {
  const last = fx => fx.github.commitRows.at(-1).date;
  for (const [seconds, ok] of [[599, false], [600, true]]) {
    const fx = fixture();
    fx.oldWrites();
    const at = Date.parse(last(fx));
    fx.github.clock = at + seconds * 1000;
    const dry = fx.dry();
    assert.equal(dry.result.stop.proven, ok, `${seconds} s: the dry run says so`);
    assert.equal(dry.result.ready, ok);
    assert.equal(dry.result.stop.quiet_at, new Date(at + 10 * MINUTE).toISOString().replace('.000Z', 'Z'));
    const run = fx.takeover();
    if (ok) { assert.equal(run.error, null, run.error?.message); assert.equal(fx.fence().epoch, 2); continue; }
    assert.equal(run.error?.code, 'OLD_WRITER_ACTIVE');
    assert.match(run.error.message, new RegExp(`It will be at ${dry.result.stop.quiet_at}\\.`), 'the refusal names the time');
    wroteNothing(fx, run, '599 s');
    assert.equal(fx.fence().epoch, 1);
  }
  // Reads taken before the old controller's last write never carry the claim: it writes between them
  // and the record, right after the record, or right before the claim.
  for (const [label, when] of [['before the record', POSTS], ['after the record', READS_RECORD], ['before the claim', CLAIMS]]) {
    for (const [source, write] of [['state commit', fx => fx.oldWrites()], ['comment', fx => fx.github.addComment(421, { body: 'Still here' })], ['merge', fx => fx.github.addMerge()]]) {
      // Only a parent write is a conflict at the moment of the claim itself.
      if (when === CLAIMS && source !== 'state commit') continue;
      const fx = fixture();
      fx.before(when, () => write(fx));
      const run = fx.takeover();
      const name = `${source} ${label}`;
      assert.equal(run.error?.code, 'OLD_WRITER_ACTIVE', `${name}: ${run.error?.message}`);
      assert.match(run.error.message, /is marked NOT USED\.$/, name);
      assert.deepEqual([fx.fence().epoch, fx.fence().holder_session], [1, controller.session], `${name}: no claim`);
      assert.deepEqual(fx.records().map(record => record.body.startsWith('NOT USED: INT-TK421-')), [true], name);
    }
  }
  // The record's own GitHub time counts, not the time the reads began.
  const fx = fixture();
  fx.oldWrites();
  fx.github.clock = Date.parse(last(fx)) + 10 * MINUTE;
  fx.before(POSTS, () => { fx.github.clock -= 5000; });
  assert.equal(fx.takeover().error?.code, 'OLD_WRITER_ACTIVE');
  assert.match(fx.records()[0].body, /^NOT USED: /);
  assert.equal(fx.fence().epoch, 1);
});

const archive = `<!-- programme-page-archive key=graph-completed-1 -->\n# Programme graph: COMPLETED\n`;
// Each source alone, one minute old: [label, what happens, whether it counts as the old controller's].
const ACTIVITY = [
  ['a parent state commit', fx => fx.oldWrites(), true],
  ['a task state commit', fx => fx.commit('issue-423.json', 'programme state: issue-423 revision 4'), true],
  ['a pass commit of the controller', fx => fx.commit('issue-423.json', 'programme state: pass: issue-423 r4 [skip ci]'), true],
  ['a queued holder order', fx => fx.commit('orders/pending/x.json', 'programme order: pending x'), true],
  ['a commit it does not know', fx => fx.commit('issue-423.json', 'fixed by hand (refresh)'), true],
  ['a comment on the parent', fx => fx.github.addComment(421, { body: 'Checkpoint' }), true],
  ['the old controller\'s own takeover record', fx => fx.github.addComment(421, { body: `${PREFIX}050 TAKEOVER: controller ${controller.session} on x; Toolkit main ${'a'.repeat(40)}; CONTROLLER.md blob ${'b'.repeat(40)}; epoch 1 to 2; y` }), true],
  ['a merge to the default branch', fx => fx.github.addMerge(), true],
  ['a refresh commit', fx => fx.sweepWrites(), false],
  ['a refresh pass commit', fx => fx.commit('issue-423.json', `programme state: pass: issue-423 r4 [skip ci]${state.REFRESH_MARK}`), false],
  ['a lease commit', fx => fx.commit('sweep-lease.json', 'programme sweep: take the lease'), false],
  ['a pass history commit', fx => fx.commit('sweep-history.json', 'programme sweep: pass history'), false],
  ['a journal', fx => fx.commit('journal/issue-423/g1--0123456789abcdef.json', 'programme journal: issue-423 g1--0123456789abcdef.json seq 2'), false],
  ['a handover file', fx => fx.commit('handover/issue-423.md', 'programme handover: issue-423.md'), false],
  ['a handover file saved with the store command', fx => fx.commit('handover/issue-423.md', 'evidence: the G1 handover'), false],
  ['the controller settings', fx => fx.commit('controller-settings.json', 'lanes: two'), false],
  ['a page copy', fx => fx.commit('page-copies/issue-423-x.md', 'programme page copy: issue-423 abc'), false],
  ['a cloud sweep\'s state commit, marked or not', fx => fx.commit('issue-423.json', 'programme state: issue-423 revision 4', 'governance-bot[bot]'), false],
  ['a hand commit by another account', fx => fx.commit('orders/pending/x.json', 'queue an order', 'someone-else'), true],
  ['a page archive comment', fx => fx.github.addComment(421, { body: archive }), false],
  ['a trace index comment', fx => fx.github.addComment(421, { body: 'Comment index\n---\n<!-- decision-trace-index -->\nx' }), false],
  ['a closing facts comment', fx => fx.github.addComment(421, { body: 'Closed\n\n<!-- toolkit-closing kind=facts -->' }), false],
  ['a parent repair note', fx => fx.github.addComment(421, { body: '<!-- toolkit-parent-repair:421:1 -->\nReopened' }), false],
  ['another successor\'s record for this epoch', fx => fx.github.addComment(421, { body: `NOT USED: ${PREFIX}050 TAKEOVER: controller desk-controller-9 on x; Toolkit main ${'a'.repeat(40)}; CONTROLLER.md blob ${'b'.repeat(40)}; epoch 1 to 2; y` }), false],
  ['another account\'s comment', fx => fx.github.addComment(421, { body: 'Hello', login: 'someone-else' }), false],
  ['a comment on a task', fx => fx.github.addComment(423, { body: 'G1 report' }), false],
  ['a bot\'s merge', fx => fx.github.addMerge({ login: 'merge-bot[bot]' }), false],
  ['a merge to another branch', fx => fx.github.addMerge({ ref: 'refs/heads/feature' }), false],
];

test('6 each source alone trips the stop; a sweep\'s, a gate\'s or a bot\'s writes never do; an unread source is no proof', () => {
  assert.match(archive, PAGE);
  for (const [label, effect, counts] of ACTIVITY) {
    const fx = fixture();
    effect(fx);
    fx.wait(1);
    const run = fx.takeover();
    assert.equal(run.error?.code ?? null, counts ? 'OLD_WRITER_ACTIVE' : null, `${label}: ${run.error?.message}`);
    assert.equal(fx.fence().epoch, counts ? 1 : 2, label);
    if (counts) wroteNothing(fx, run, label);
  }
  const unread = { 'state commits': /acme\/state-store\/commits/, 'parent comments': /issues\/comments\?/, merges: /\/activity\?/ };
  for (const [name, route] of Object.entries(unread)) {
    for (const answer of [{ status: 403, json: { message: 'Resource not accessible' } }, { status: 200, json: { message: 'not a list' } }]) {
      const fx = fixture();
      fx.github.intercept(call => (route.test(call.path) ? answer : undefined));
      const run = fx.takeover();
      assert.equal(run.error?.code, 'STOP_UNREADABLE', name);
      assert.ok(run.error.message.includes(name), name);
      wroteNothing(fx, run, name);
      assert.deepEqual(fx.dry().result.holds.map(hold => hold.code), ['STOP_UNREADABLE'], name);
    }
    // Unread only after the record: no claim, and the record waits for the next run, which uses it.
    if (name === 'parent comments') continue;
    const fx = fixture();
    let record = false;
    let blocked = true;
    fx.github.intercept(call => { if (POSTS(call)) record = true; return record && blocked && route.test(call.path) ? { status: 502, json: {} } : undefined; });
    assert.equal(fx.takeover().error?.code, 'STOP_UNREADABLE', `${name} after the record`);
    assert.deepEqual([fx.fence().epoch, fx.records()[0].body.startsWith(PREFIX)], [1, true], `${name}: the record is kept`);
    blocked = false;
    assert.equal(fx.takeover().result?.record.resumed, true, `${name}: the next run uses it`);
    assert.equal(fx.records().length, 1);
  }
  // More refresh commits than one page: the old write behind them is still found.
  const fx = fixture();
  fx.oldWrites();
  for (let n = 0; n < 120; n += 1) fx.commit('issue-423.json', `programme state: pass: issue-423 r${n} [skip ci]${state.REFRESH_MARK}`);
  fx.wait(1);
  assert.equal(fx.takeover().error?.code, 'OLD_WRITER_ACTIVE');
  // Nothing found in every page read: proven only back to the oldest row read.
  for (const [minutes, code] of [[1, 'OLD_WRITER_ACTIVE'], [12, undefined]]) {
    const busy = fixture();
    for (let n = 0; n < 320; n += 1) { busy.commit('sweep-lease.json', 'programme sweep: keep the lease'); busy.github.clock -= 900; }
    busy.wait(minutes);
    assert.equal(busy.takeover().error?.code, code, `${minutes} min after the oldest row read`);
  }
});

test('6b every state commit of a real refresh pass is marked, and none of a controller pass is', () => {
  const states = fx => fx.github.commitRows.filter(row => /^programme[ -]state: /.test(row.message)).map(row => row.message);
  const swept = fixture();
  const before = states(swept).length;
  assert.equal(swept.run(['refresh', '--json']).error, null);
  const marked = states(swept).slice(before);
  assert.ok(marked.some(message => message.startsWith('programme state: pass: ')) && marked.some(message => / revision [0-9]+ [(]refresh[)]$/.test(message)), marked.join(' | '));
  assert.deepEqual(marked.filter(message => !message.endsWith(state.REFRESH_MARK)), []);
  swept.wait(1);
  assert.equal(swept.takeover().error, null, 'a pass a minute ago holds nothing');
  const own = fixture();
  const from = states(own).length;
  assert.equal(own.run(['reconcile', '--apply', '--session', controller.session, '--controller', '--json']).error, null);
  const plain = states(own).slice(from);
  assert.ok(plain.length > 1);
  assert.deepEqual(plain.filter(message => message.endsWith(state.REFRESH_MARK)), []);
  own.wait(1);
  assert.equal(own.takeover().error?.code, 'OLD_WRITER_ACTIVE', 'a controller pass a minute ago does');
});

test('7 the owner\'s words: quoted in the record, instead of the 10 minutes, never instead of the second read', () => {
  const words = ['--owner-stop', 'the old "desk" chat is closed'];
  const fx = fixture();
  fx.oldWrites();
  assert.equal(fx.takeover().error?.code, 'OLD_WRITER_ACTIVE');
  const { result, error } = fx.takeover(words);
  assert.equal(error, null, error?.message);
  assert.equal(fx.fence().epoch, 2);
  assert.match(fx.records().at(-1).body, /old writer stopped: the owner said "the old 'desk' chat is closed"; its last own write is state commit [0-9a-f]{7} at \S+; next: /);
  assert.equal(result.stop.by, 'owner');
  // The old controller writing after the record still refuses.
  const again = fixture();
  again.before(READS_RECORD, () => again.oldWrites());
  assert.equal(again.takeover(words).error?.code, 'OLD_WRITER_ACTIVE');
  assert.equal(again.fence().epoch, 1);
  assert.match(again.records()[0].body, /^NOT USED: /);
  // A source no read reaches is carried by the owner's words and named in the record; one that stops answering is not.
  const closed = fixture();
  closed.github.intercept(call => (/\/activity\?/.test(call.path) ? { status: 403, json: {} } : undefined));
  assert.equal(closed.takeover(words).error, null);
  assert.match(closed.records()[0].body, /; not read: merges; next: /);
  const lost = fixture();
  let posted = false;
  lost.github.intercept(call => { if (POSTS(call)) posted = true; return posted && /\/activity\?/.test(call.path) ? { status: 403, json: {} } : undefined; });
  assert.equal(lost.takeover(words).error?.code, 'STOP_UNREADABLE');
  assert.equal(lost.fence().epoch, 1);
  for (const empty of ['', '   ', '...']) {
    const none = fixture();
    const run = none.takeover(['--owner-stop', empty]);
    assert.equal(run.error?.code, 'USAGE', JSON.stringify(empty));
    assert.equal(run.calls.length, 0, 'refused before anything is read');
  }
});

test('8 a number another comment took first: the record moves to the next free one before the claim', () => {
  // The record number is read straight before posting, and a comment lands in between, on a task.
  const fx = fixture();
  fx.github.addComment(421, { body: `${PREFIX}1310 GATE-RECORD: earlier` });
  fx.wait(60);
  fx.before(POSTS, () => fx.github.addComment(423, { body: `${PREFIX}1311 OWNER-DECISION: the assistant's, eight seconds earlier` }));
  const run = fx.takeover();
  assert.equal(run.error, null, run.error?.message);
  assert.deepEqual([run.result.record.record_id, run.result.record.renumbered_from], [`${PREFIX}1312`, `${PREFIX}1311`]);
  assert.ok(fx.records()[0].body.startsWith(`${PREFIX}1312 TAKEOVER: `));
  assert.deepEqual(fx.writes(run.calls).map(call => call.method), ['POST', 'PATCH', 'PUT'], 'renumbered before the claim');
  assert.equal(fx.parentDoc().private.takeovers[0].comment_id, fx.records()[0].id);
  // 25 Nov as it was: the comment is on the parent, by the same account, after the reads began. It is a
  // write nothing shows the old controller did not make, so the takeover stops instead of claiming.
  const nov = fixture();
  nov.github.addComment(421, { body: `${PREFIX}1310 GATE-RECORD: earlier` });
  nov.wait(60);
  nov.before(POSTS, () => nov.github.addComment(421, { body: `${PREFIX}1311 OWNER-DECISION: the assistant's, eight seconds earlier` }));
  assert.equal(nov.takeover().error?.code, 'OLD_WRITER_ACTIVE');
  assert.deepEqual([nov.fence().epoch, nov.records()[0].body.split(' TAKEOVER')[0]], [1, `NOT USED: ${PREFIX}1312`]);
  nov.wait(11);
  assert.equal(nov.takeover().result?.record.record_id, `${PREFIX}1313`, 'ten minutes later it goes through under its own number');
  // GitHub's list lags the new record once: it is read again before the numbers are judged.
  const lag = fixture();
  let hidden = false;
  let stale = null;
  lag.before(POSTS, () => lag.github.addComment(423, { body: `${PREFIX}001 OWNER-DECISION: first` }));
  lag.github.intercept(call => {
    if (POSTS(call)) stale = [];
    if (stale && !hidden && call.path.includes('issues/comments?')) { hidden = true; return { status: 200, json: stale }; }
    return undefined;
  });
  assert.equal(lag.takeover().result?.record.record_id, `${PREFIX}002`);
  // A stranger's comment never picks or takes a number.
  const open = fixture();
  open.github.addComment(423, { body: `${PREFIX}99999 mine`, login: 'stranger', association: 'NONE' });
  assert.equal(open.takeover().result?.record.record_id, `${PREFIX}001`);
  // No record among the comments that were read, with older ones left unread: no number is guessed.
  const far = fixture();
  far.github.addComment(423, { body: `${PREFIX}007 an old record` });
  for (let n = 0; n < 1001; n += 1) far.github.addComment(423, { body: 'chat' });
  far.wait(11);
  const unknown = far.takeover();
  assert.equal(unknown.error?.code, 'RECORD_NUMBER_UNREADABLE');
  wroteNothing(far, unknown, 'no number');
});

// --- The closure matrix ---

const refused = code => ({ code });
// Each state of the parent: how it is set up, and what the dry run and the apply answer.
const M1 = [
  ['no parent document', { missing: true }, () => {}, { dry: ['STATE_MISSING'], apply: refused('STATE_MISSING') }],
  ['unheld', { held: false }, () => {}, { dry: [], apply: { epoch: 1 } }],
  ['held by this name', { holder: { session: NEW, prefix: PREFIX } }, () => {}, { dry: ['ALREADY_HOLDER'], apply: refused('ALREADY_HOLDER') }],
  ['name retired', {}, fx => fx.other().mutate('parent', 421, { writer: controller, change: doc => { doc.private.retired_holders = [NEW]; return doc; } }), { dry: ['STALE_WRITER'], apply: refused('STALE_WRITER') }],
  ['held by another, quiet', {}, () => {}, { dry: [], apply: { epoch: 2 } }],
  ['held by another, just wrote', {}, fx => fx.oldWrites(), { dry: ['OLD_WRITER_ACTIVE'], apply: refused('OLD_WRITER_ACTIVE') }],
  ['held by another, just wrote, the owner\'s words', { words: true }, fx => fx.oldWrites(), { dry: [], apply: { epoch: 2 } }],
  ['store not reachable', {}, fx => { fx.github.repos.delete('acme/state-store'); }, { dry: ['STORE_UNREACHABLE'], apply: refused('STORE_UNREACHABLE'), line: false }],
  ['store not private', {}, fx => { fx.github.repos.get('acme/state-store').private = false; }, { dry: ['STORE_UNREACHABLE'], apply: refused('STORE_UNREACHABLE'), line: false }],
  ['store not writable', {}, fx => { fx.github.repos.get('acme/state-store').permissions.push = false; }, { dry: ['STORE_UNREACHABLE'], apply: refused('STORE_UNREACHABLE'), line: false }],
  ['account cannot write the repository', {}, fx => { fx.github.repos.get(REPO).permissions.push = false; }, { dry: ['ACCOUNT_MISMATCH'], apply: refused('ACCOUNT_MISMATCH') }],
  ['account not read', {}, fx => fx.github.intercept(call => (call.path === 'user' ? { status: 401, json: {} } : undefined)), { dry: ['ACCOUNT_MISMATCH'], apply: refused('ACCOUNT_MISMATCH') }],
  ['the old controller writes as another account', {}, fx => { fx.github.login = 'other-owner'; }, { dry: ['ACCOUNT_MISMATCH'], apply: refused('ACCOUNT_MISMATCH') }],
  ['the old controller\'s record is another account\'s', {}, fx => {
    const id = fx.github.addComment(421, { body: 'An earlier takeover record', login: 'other-owner' });
    fx.oldWrites();
    fx.other().mutate('parent', 421, { writer: controller, change: doc => { doc.private.takeovers = [{ comment_id: id, from_epoch: 0 }]; return doc; } });
    fx.wait(11);
  }, { dry: ['ACCOUNT_MISMATCH'], apply: refused('ACCOUNT_MISMATCH') }],
  ['Toolkit main not read', {}, fx => fx.github.intercept(call => (/ai-agent-toolkit\/commits\/main$/.test(call.path) ? { status: 403, json: {} } : undefined)), { dry: ['TOOLKIT_UNREADABLE'], apply: refused('TOOLKIT_UNREADABLE') }],
];

test('9 M1: every state of the parent as the controller, and every other role refused', () => {
  for (const [label, options, arrange, expected] of M1) {
    const make = () => { const fx = fixture(options); arrange(fx); return fx; };
    const words = options.words ? ['--owner-stop', 'it is closed'] : [];
    const dryFx = make();
    const dry = dryFx.dry(words);
    assert.equal(dry.error, null, `${label}: ${dry.error?.message}`);
    wroteNothing(dryFx, dry, `${label}, dry run`);
    assert.deepEqual(dry.result.holds.map(hold => hold.code), expected.dry, label);
    assert.equal(dry.result.ready, expected.dry.length === 0, label);
    if (expected.line === false) assert.equal(dry.result.record, null, `${label}: no record line`);
    if (dry.result.ready) assert.equal(dry.result.record.ready, true, label);
    const fx = make();
    const run = fx.takeover(words);
    if (expected.apply.code) {
      assert.equal(run.error?.code, expected.apply.code, `${label}: ${run.error?.message}`);
      wroteNothing(fx, run, label);
    } else {
      assert.equal(run.error, null, `${label}: ${run.error?.message}`);
      assert.deepEqual([fx.fence().epoch, fx.fence().holder_session, fx.records().length], [expected.apply.epoch, NEW, 1], label);
    }
    // E: a gate or any session without --controller, and one a Toolkit launcher marked. L: a lane.
    for (const [role, argv, deps, code] of [
      ['executor', ['takeover', '--session', 'exec-a', ...WORDS, '--apply', '--json'], {}, 'USAGE'],
      ['launched executor', ['takeover', '--session', 'exec-a', ...WORDS, '--apply', '--controller', '--json'], { environment: { TOOLKIT_GATE_ROLE: 'G1' } }, 'USAGE'],
      ['lane', ['takeover', '--session', 'lane-1', '--prefix', 'CDX-TK469-', ...WORDS, '--apply', '--controller', '--json'], {}, 'ROLE_REFUSED'],
    ]) {
      const other = make();
      const refusal = other.run(argv, deps);
      assert.ok(refusal.error, `${label} / ${role}`);
      if (expected.line !== false || code === 'USAGE') assert.equal(refusal.error.code, code, `${label} / ${role}: ${refusal.error.message}`);
      wroteNothing(other, refusal, `${label} / ${role}`);
    }
  }
  // H: the current holder's other writes go on until the claim, then stop.
  const held = fixture();
  held.oldWrites();
  held.wait(11);
  assert.equal(held.takeover().error, null);
  assert.throws(() => held.oldWrites(), { code: 'STALE_WRITER' });
  // R: a sweep that began under the old holder stops; the next one runs under the new holder.
  const swept = fixture();
  const under = state.refreshWriter(swept.parentDoc());
  assert.equal(swept.takeover().error, null);
  assert.throws(() => swept.other().mutate('parent', 421, { writer: under, change: doc => { doc.attention = []; return doc; } }), { code: 'STALE_WRITER' });
  assert.equal(swept.sweepWrites().outcome, 'WRITTEN');
});

test('9 M1: the holder\'s own name is never shared, and the old one never takes the parent back', () => {
  const fx = fixture();
  assert.equal(fx.takeover().error, null);
  const again = fx.takeover();
  assert.equal(again.error?.code, 'ALREADY_HOLDER');
  assert.match(again.error.message, /that takeover is done: read it with show --parent.*for example desk-controller-3\.$/);
  wroteNothing(fx, again, 'already holder');
  const back = fx.takeover(['--owner-stop', 'take it back'], { session: controller.session });
  assert.equal(back.error?.code, 'STALE_WRITER');
  assert.match(back.error.message, /A controller stopped by a takeover stops and reports to the owner\.$/);
  wroteNothing(fx, back, 'the replaced controller');
  assert.deepEqual([fx.fence().epoch, fx.fence().holder_session], [2, NEW]);
});

test('9 M1: a run that stopped between the record and the claim is resumed, never repeated', () => {
  const crash = fx => {
    let dead = false;
    fx.before(READS_RECORD, () => { dead = true; });
    fx.github.intercept(call => { if (dead) { dead = false; throw Object.assign(new Error('killed'), { killed: true }); } void call; return undefined; });
    assert.throws(() => fx.takeover(), { killed: true });
    assert.deepEqual([fx.fence().epoch, fx.records().length], [1, 1]);
  };
  const fx = fixture();
  crash(fx);
  const [first] = fx.records();
  fx.wait(3);
  assert.deepEqual(fx.dry().result.record.unused, { comment_id: first.id, url: `https://github.com/${REPO}/issues/421#issuecomment-${first.id}` }, 'the dry run shows it');
  const run = fx.takeover();
  assert.equal(run.error, null, run.error?.message);
  assert.deepEqual([run.result.record.resumed, run.result.record.comment_id, fx.records().length, fx.fence().epoch], [true, first.id, 1, 2]);
  assert.deepEqual(fx.writes(run.calls).map(call => call.method), ['PUT'], 'only the claim');
  // The old controller wrote since: the record is marked and, once it is quiet again, a new one is posted.
  const stale = fixture();
  crash(stale);
  stale.oldWrites();
  const blocked = stale.takeover();
  assert.equal(blocked.error?.code, 'OLD_WRITER_ACTIVE');
  wroteNothing(stale, blocked, 'still active');
  stale.wait(11);
  const fresh = stale.takeover();
  assert.equal(fresh.error, null, fresh.error?.message);
  assert.deepEqual([fresh.result.record.resumed, stale.records().length, stale.fence().epoch], [false, 2, 2]);
  assert.match(stale.records()[0].body, /^NOT USED: INT-TK421-001 TAKEOVER: /);
  assert.match(stale.records()[1].body, /^INT-TK421-002 TAKEOVER: /);
  assert.equal(stale.parentDoc().private.takeovers[0].comment_id, stale.records()[1].id);
  // Another session never uses it.
  const other = fixture();
  crash(other);
  assert.equal(other.takeover([], { session: 'desk-controller-5' }).result?.record.resumed, false);
  assert.equal(other.fence().holder_session, 'desk-controller-5');
});

test('9 M1: an answer that never came back is settled by reading, for the record and for the claim', () => {
  const lose = (fx, when, { lands }) => {
    let armed = true;
    fx.github.intercept(call => {
      if (!armed || !when(call)) return undefined;
      armed = false;
      if (lands) fx.github.route(call.method, call.path, call.body);
      return { status: 502, json: { message: 'Bad gateway' } };
    });
  };
  // The claim landed: read as ours, nothing sent again.
  const landed = fixture();
  lose(landed, CLAIMS, { lands: true });
  const ours = landed.takeover();
  assert.equal(ours.error, null, ours.error?.message);
  assert.deepEqual([landed.fence().epoch, landed.writes(ours.calls).filter(CLAIMS).length], [2, 1]);
  // It did not: sent once more.
  const lost = fixture();
  lose(lost, CLAIMS, { lands: false });
  const retried = lost.takeover();
  assert.equal(retried.error, null, retried.error?.message);
  assert.deepEqual([lost.fence().epoch, lost.writes(retried.calls).filter(CLAIMS).length], [2, 2]);
  // Twice with no answer and nothing landed: it stops, and the record waits for the next run.
  const down = fixture();
  let stop = true;
  down.github.intercept(call => (stop && CLAIMS(call) ? { status: 502, json: {} } : undefined));
  const failed = down.takeover();
  assert.equal(failed.error?.code, 'GH_FAILED');
  assert.deepEqual([down.fence().epoch, down.writes(failed.calls).filter(CLAIMS).length, down.records()[0].body.startsWith(PREFIX)], [1, 2, true]);
  stop = false;
  assert.equal(down.takeover().result?.record.resumed, true);
  // The answer is lost and the parent cannot be read: never reported as failed or done.
  const blind = fixture();
  let sent = false;
  blind.github.intercept(call => {
    if (CLAIMS(call)) { sent = true; return { status: 502, json: {} }; }
    return sent && call.path.includes('/parent-421.json') ? { status: 502, json: {} } : undefined;
  });
  assert.equal(blind.takeover().error?.code, 'CLAIM_UNCERTAIN');
  assert.match(blind.records()[0].body, /^INT-TK421-/, 'the record is not marked: it may carry a claim');
  // Another successor claimed while the answer was out.
  const beaten = fixture();
  beaten.github.intercept(call => {
    if (!CLAIMS(call) || call.body.message.includes('rival')) return undefined;
    const doc = state.claimDocument(JSON.parse(beaten.github.files.get(PARENT_FILE).text), { session: 'desk-controller-9', prefix: PREFIX }, { takeover: true });
    beaten.github.putFile(PARENT_FILE, doc, 'rival');
    return { status: 502, json: {} };
  });
  assert.equal(beaten.takeover().error?.code, 'EPOCH_MOVED');
  assert.match(beaten.records()[0].body, /^NOT USED: /);
  // The store refuses the claim outright.
  const shut = fixture();
  shut.github.intercept(call => (CLAIMS(call) ? { status: 403, json: { message: 'no' } } : undefined));
  assert.equal(shut.takeover().error?.code, 'STORE_UNREACHABLE');
  assert.match(shut.records()[0].body, /^NOT USED: /);
  // The record's own answer is lost: found on the parent, never posted twice.
  const record = fixture();
  lose(record, POSTS, { lands: true });
  const found = record.takeover();
  assert.equal(found.error, null, found.error?.message);
  assert.deepEqual([record.records().length, record.fence().epoch], [1, 2]);
  const gone = fixture();
  lose(gone, POSTS, { lands: false });
  assert.equal(gone.takeover().error?.code, 'RECORD_UNCERTAIN');
  assert.deepEqual([gone.records().length, gone.fence().epoch], [0, 1]);
  // The comment list stops answering once the record is posted: no claim, and the next run uses the record.
  const mute = fixture();
  let posted = false;
  mute.github.intercept(call => { if (POSTS(call)) posted = true; return posted && call.path.includes('issues/comments?') ? { status: 502, json: {} } : undefined; });
  const unheard = mute.takeover();
  assert.equal(unheard.error?.code, 'GH_FAILED');
  assert.match(unheard.error.message, /^Reading repos\/acme\/app\/issues\/comments failed \(HTTP 502\)/);
  assert.deepEqual([mute.fence().epoch, mute.records()[0].body.startsWith(PREFIX)], [1, true]);
  const denied = fixture();
  denied.github.intercept(call => (POSTS(call) ? { status: 403, json: {} } : undefined));
  assert.equal(denied.takeover().error?.code, 'GH_FAILED');
  assert.equal(denied.fence().epoch, 1);
});

test('9 M1: two successors at once, and one that claimed first: one claim per epoch', () => {
  // The rival runs whole between this one's record and its claim.
  const fx = fixture();
  let rival = null;
  fx.before(READS_RECORD, () => { const output = fx.output; rival = fx.takeover([], { session: 'desk-controller-7' }); fx.output = output; });
  const run = fx.takeover();
  assert.equal(rival.error, null, rival.error?.message);
  assert.equal(run.error?.code, 'EPOCH_MOVED');
  assert.deepEqual([fx.fence().epoch, fx.fence().holder_session], [2, 'desk-controller-7']);
  const marked = fx.records().filter(record => record.body.startsWith('NOT USED: '));
  assert.deepEqual(marked.map(record => /controller (\S+) on/.exec(record.body)[1]), [NEW], 'the one that lost says so');
  assert.equal(fx.records().length, 2);
  // Both records stand before either claims: one claim lands, the other is refused.
  const both = fixture();
  let nested = null;
  both.before(CLAIMS, () => { nested = both.takeover([], { session: 'desk-controller-8' }); });
  const outer = both.takeover();
  assert.deepEqual([nested.error, outer.error?.code, both.fence().epoch, both.fence().holder_session], [null, 'EPOCH_MOVED', 2, 'desk-controller-8']);
  // A dry run after it shows the new epoch.
  const after = both.dry([], { session: 'desk-controller-4', apply: false });
  assert.deepEqual([after.result.parent.epoch, after.result.parent.next_epoch], [2, 3]);
});

test('9 M1: the record must read back as posted, on the parent and by the account that claims', () => {
  for (const [label, change, code] of [
    ['another account', comment => { comment.login = 'someone-else'; }, 'ACCOUNT_MISMATCH'],
    ['other text', comment => { comment.body += ' edited'; }, 'TAKEOVER_UNVERIFIED'],
    ['another issue', comment => { comment.issue = 423; }, 'TAKEOVER_UNVERIFIED'],
    ['gone', (comment, fx) => { fx.github.comments.delete(comment.id); }, 'TAKEOVER_UNVERIFIED'],
  ]) {
    const fx = fixture();
    fx.before(READS_RECORD, () => change(fx.records()[0], fx));
    const run = fx.takeover();
    assert.equal(run.error?.code, code, `${label}: ${run.error?.message}`);
    assert.equal(fx.fence().epoch, 1, label);
    assert.equal(fx.writes(run.calls).filter(CLAIMS).length, 0, label);
  }
});

test('9 M1: governance off, undecided or unreadable: the dry run says so and prints the record line for the evidence store', () => {
  const { openTakeover, takeover, formatTakeover } = require('../../skills/github-program-reconciler/scripts/programme-takeover.cjs');
  const args = { command: 'takeover', session: NEW, surface: 'test harness', next: 'read the map' };
  for (const [code, governance] of [['GITHUB_GOVERNANCE_OFF', 'DISABLED'], ['GITHUB_GOVERNANCE_OFF', 'UNDECIDED'], ['GOVERNANCE_STATE_UNAVAILABLE', undefined]]) {
    const github = new FakeGitHub();
    const open = () => { throw new state.ProgrammeError(code, 'off', governance ? { governance } : {}); };
    const context = openTakeover(args, { transport: github }, open);
    const result = takeover(args, context);
    assert.deepEqual([result.ready, result.governance.state, result.holds.map(hold => hold.code), result.record.carrier, result.record.ready], [false, governance || 'UNREADABLE', [code], 'evidence store', false]);
    assert.equal(result.record.line, `TAKEOVER: controller ${NEW} on test harness; Toolkit main ${'1'.repeat(40)}; CONTROLLER.md blob ${'2'.repeat(40)}; old writer: not read (no programme state); next: read the map.`);
    assert.match(formatTakeover(result), /Record \(evidence store\):\nTAKEOVER: /);
    assert.ok(github.calls.every(call => call.method === 'GET'));
    assert.throws(() => openTakeover({ ...args, apply: true }, { transport: github }, open), { code }, 'the apply refuses as every programme command does');
  }
  // Any other failure to open is not softened.
  assert.throws(() => openTakeover(args, {}, () => { throw new state.ProgrammeError('REPO_IDENTITY_MISMATCH', 'x'); }), { code: 'REPO_IDENTITY_MISMATCH' });
});

test('11 the record holds no secret, path, address or session ID, and names the old controller only when a record did', () => {
  const token = `ghp_${'a'.repeat(36)}`;
  const bad = [token, 'see C:\\Users\\me', 'in ~/notes', 'at /home/me/x', 'ask me@example.com', 'open https://example.com/x', 'on 10.0.0.1', 'on box.example.test',
    'chat 11111111-2222-3333-4444-555555555555', 'a <!-- mark -->', 'a\u202Eb', '@owner said so'];
  for (const flag of ['--surface', '--next', '--owner-stop']) {
    for (const value of bad) {
      const fx = fixture();
      const given = { '--surface': 'test harness', '--next': 'read the map', [flag]: value };
      const run = fx.run(['takeover', '--session', NEW, ...Object.entries(given).flat(), '--apply', '--controller', '--json']);
      assert.equal(run.error?.code, 'RECORD_TEXT_REFUSED', `${flag} ${value}`);
      assert.equal(run.calls.length, 0, 'refused before anything is read');
      assert.ok(!run.error.message.includes(token), 'the refusal never repeats a value');
    }
  }
  for (const [argv, label] of [
    [['--session', NEW, '--surface', 'a; epoch 9 to 10; b', '--next', 'x y'], 'a semicolon in the surface'],
    [['--session', '11111111-2222-3333-4444-555555555555', '--surface', 'x', '--next', 'y'], 'a host session id as the name'],
    [['--session', 'two words', '--surface', 'x', '--next', 'y'], 'a name with a space'],
    [['--session', NEW, '--surface', 'x'], 'no next action'], [['--session', NEW, '--next', 'x'], 'no surface'], [['--surface', 'x', '--next', 'y'], 'no name'],
    [['--session', NEW, '--surface', 'x', '--next', 'y'.repeat(301)], 'too long'],
    [['--session', NEW, '--surface', 'x', '--next', 'y', '--issue', '423'], 'another command\'s option'],
  ]) {
    const fx = fixture();
    const run = fx.run(['takeover', ...argv, '--apply', '--controller']);
    assert.equal(run.error?.code, 'USAGE', label);
    assert.equal(run.calls.length, 0, label);
  }
  // The first holder was never named in public, so the record does not name it; the next takeover's
  // record names the one this record named.
  const fx = fixture();
  assert.equal(fx.takeover().error, null);
  assert.ok(!fx.records()[0].body.includes(controller.session));
  fx.wait(11);
  const second = fx.takeover([], { session: 'desk-controller-3' });
  assert.equal(second.error, null, second.error?.message);
  assert.ok(fx.records()[1].body.includes(`old writer ${NEW} stopped: `));
  assert.match(second.result.done_line, new RegExp(`epoch 3 \\(was 2, ${NEW}\\)`));
  assert.deepEqual(fx.parentDoc().private.retired_holders, [controller.session, NEW]);
  // A holder that is a host session ID is never named, whatever an earlier comment holds.
  const uuid = '11111111-2222-3333-4444-555555555555';
  const raw = fixture({ holder: { session: uuid, prefix: PREFIX } });
  const earlier = raw.github.addComment(421, { body: `takeover by ${uuid}` });
  raw.other().mutate('parent', 421, { writer: { session: uuid, prefix: PREFIX }, change: doc => { doc.private.takeovers = [{ comment_id: earlier, from_epoch: 0 }]; return doc; } });
  raw.wait(11);
  assert.equal(raw.takeover().error, null);
  assert.ok(!raw.records()[0].body.includes(uuid));
});
