'use strict';

// Open pull requests no task in progress owns: PR_UNOWNED (open 24 hours or more) and PR_RED_UNOWNED
// (red at its head, whatever its age), the sweep's reads and holds, and the owner `attention` shows.
// Each test names the rows of the closure matrix it covers (M1 to M28): pull request x checks x age x
// task link x acknowledgement. Every row runs through a real refresh pass on the in-memory GitHub.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const ROOT = process.env.A2A_SOURCE_ROOT || path.resolve(__dirname, '../..');
const state = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme-state.cjs'));
const cli = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme.cjs'));
const { FakeGitHub } = require('./toolkit-programme-fake-github.cjs');

const HOUR = 3600 * 1000;
const START = Date.parse('2026-11-24T09:00:00Z');
const iso = ms => new Date(ms).toISOString();
const sha = character => character.repeat(40);
const controller = { session: 'controller-1', prefix: 'INT-TK421-' };
const SHARD_BOT = 'example-governance[bot]';
const temps = [];
const tmp = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'open-prs-')); temps.push(dir); return dir; };
test.after(() => { for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true }); });
// Every fixture's GitHub, so the last test can check what was written to pull requests and runs.
const worlds = [];

// One check run of GitHub Actions, completed `minute` minutes after START.
const run = (name, conclusion, minute = 0) => ({ __typename: 'CheckRun', name, status: 'COMPLETED', conclusion, completedAt: iso(START + minute * 60000), checkSuite: { app: { databaseId: 15368 } }, isRequired: false });
const GREEN = [run('validate', 'SUCCESS')];
const RED = [run('tests-linux (linux-1)', 'FAILURE'), run('gate', 'FAILURE'), run('validate', 'FAILURE')];
// The shape that once read as red: failed rows a newer run of the same checks replaced.
const REPLACED = [...RED, run('tests-linux (linux-1)', 'SUCCESS', 9), run('gate', 'SUCCESS', 9), run('validate', 'SUCCESS', 9)];

// A programme under #421. Each task: { issue, doc? } where doc changes the task's state document; a task
// with `doc: null` has none.
function fixture(tasks = []) {
  const repository = 'acme/app';
  const github = new FakeGitHub({ repository, store: 'acme/state-store' });
  github.clock = START;
  const catalogue = tasks.map((task, i) => ({ issue: task.issue, class: task.class || 'COMMITTED', parent: 421, order: i + 1 }));
  const binding = state.validateBinding({
    schema: state.SCHEMA.bindingV2, repository, governance: 'enabled', parents: [{ issue: 421, record_prefix: 'INT-TK421-' }],
    store: { kind: 'github', repository: 'acme/state-store', branch: 'main', path: `state/${repository}/` }, required_checks: ['validate'],
  });
  github.addIssue(421, { body: '## CURRENT\n' });
  for (const task of tasks) github.addIssue(task.issue, { parent: 421, state: task.state || 'open' });
  const fx = { github, binding, now: START, output: '' };
  const store = new state.StateStore({ transport: github, store: binding.store, now: () => iso(fx.now), toolkitVersion: '3.9.0' });
  store.write('parent', 421, state.claimDocument(state.newParent({ repository, parentIssue: 421, outcomes: catalogue }), controller, {}), { sha: null, previous: null });
  tasks.forEach((task, i) => {
    if (task.doc === null) return;
    const doc = state.newChild({ repository, outcome: catalogue[i] });
    store.write('child', task.issue, task.doc ? task.doc(doc) : doc, { sha: null, previous: null });
  });
  worlds.push(fx);
  fx.store = store;
  fx.parent = () => store.read('parent', 421).doc;
  // An open pull request: opened `hours` before START unless created says otherwise.
  fx.pr = (number, { hours = 0, checks = GREEN, head = sha('a'), ...options } = {}) => github.addPr(number, { head, contexts: checks, createdAt: hours === null ? null : iso(START - hours * HOUR), ...options });
  fx.storePr = (number, hours, title = `Store ${number}`) => github.storePulls.push({ number, title, draft: false, created_at: iso(START - hours * HOUR) });
  fx.make = (extra = {}) => new state.Reconciler({ store, reader: new state.ProgrammeGraphReader({ transport: github, repository }), mutator: new state.GitHubMutator({ transport: github, repository }),
    binding, writer: state.refreshWriter(fx.parent()), toolkitVersion: '3.9.0', refreshFacts: true, now: () => iso(fx.now), ...extra });
  // A full refresh pass, and a queued one that reads only the tasks `canRead` lets it.
  fx.pass = () => fx.make().run({ apply: true });
  fx.sweep = ({ canRead = () => true } = {}) => fx.make().run({ apply: true, queued: { since: iso(fx.now - HOUR), queue: [], pass: 1, record: null, findings: [], canRead } });
  fx.deps = () => ({ transport: github, binding, originUrl: 'https://github.com/acme/app.git', repoRoot: tmp(), toolkitVersion: '3.9.0', lockFile: path.join(tmp(), 'pass.lock'),
    attentionDir: tmp(), environment: {}, now: () => iso(fx.now), stdout: { write: text => { fx.output += text; } }, stderr: { write: () => {} } });
  fx.run = argv => {
    fx.output = '';
    try { cli.main([...argv, '--json'], fx.deps()); return { result: JSON.parse(fx.output.split(/\n(?=\{)/).at(-1)), error: null }; }
    catch (error) { return { result: null, error }; }
  };
  fx.ctrl = argv => fx.run([...argv, '--session', controller.session, '--controller']);
  fx.entry = (code, number, kind = undefined) => (fx.parent().attention || []).find(entry => entry.code === code && entry.issue === number && entry.kind === kind && ['new', 'acknowledged'].includes(entry.state));
  fx.ack = (id, hours = 24) => fx.ctrl(['ack', '--finding', id, '--next', 'land it on the next train', '--due', iso(fx.now + hours * HOUR)]);
  // The open findings of the two codes, as `<code> <number>`, with a store or acknowledged mark.
  fx.flagged = () => (fx.parent().attention || []).filter(entry => ['PR_UNOWNED', 'PR_RED_UNOWNED'].includes(entry.code) && ['new', 'acknowledged'].includes(entry.state))
    .map(entry => `${entry.code} ${entry.kind === 'store' ? 'store ' : ''}${entry.issue}${entry.state === 'acknowledged' ? ' acknowledged' : ''}`).sort();
  fx.row = (number, where = 'repo') => (fx.run(['attention']).result.open_prs || []).find(row => row.where === where && row.number === number) || {};
  return fx;
}
const active = (pr = null) => doc => Object.assign(doc, { lifecycle: 'ACTIVE', next_action: 'Builder: finish the slice', ...(pr ? { pr: { ...doc.pr, ...pr } } : {}) });

// T1 to T9 are red on the base: bots are left out of every pull request finding there, neither code
// exists, and attention lists no pull requests.
test('T1 M2: a shard refresh and a source-watch notice nobody owns are findings once open 24 hours', () => {
  const fx = fixture([{ issue: 500 }]);
  fx.pr(1471, { hours: 25, author: SHARD_BOT, branch: 'toolkit/shard-timings-20261123', title: 'Refresh the test shards' });
  fx.pr(1261, { hours: 5 * 24, author: 'app/github-actions', branch: 'source-watch/notice', title: 'Upstream updates', checks: [] });
  fx.pass();
  assert.deepEqual(fx.flagged(), ['PR_UNOWNED 1261', 'PR_UNOWNED 1471']);
  const row = fx.row(1471);
  assert.deepEqual([row.owner, row.code, row.next], ['none', 'PR_UNOWNED', `flagged ${fx.entry('PR_UNOWNED', 1471).id}`]);
  assert.deepEqual(state.validateParent(fx.parent()), [], 'the stored findings are valid');
  assert.ok(state.NET_CODES.has('PR_UNOWNED') && state.NET_CODES.has('PR_RED_UNOWNED'), 'both are stale-work net findings');
  for (const code of ['PR_WITHOUT_TASK', 'PR_UNTRACKED']) assert.equal((fx.parent().attention || []).some(entry => entry.code === code), false, `${code} still leaves these bots out`);
});

test('T2 M1: under 24 hours nothing is raised, at 24 hours it is, and an unread open time counts as old', () => {
  const fx = fixture([{ issue: 500 }]);
  fx.pr(1471, { hours: 24 - 1 / 60, author: SHARD_BOT, branch: 'toolkit/shard-timings-20261123' });
  fx.pass();
  assert.deepEqual(fx.flagged(), []);
  assert.deepEqual([fx.row(1471).owner, fx.row(1471).next], ['none', `flagged after ${iso(START + HOUR / 60)}`]);
  fx.now = START + HOUR / 60;
  assert.equal(fx.row(1471).next, 'flagged by the next sweep');
  fx.pass();
  assert.deepEqual(fx.flagged(), ['PR_UNOWNED 1471']);
  const unread = fixture([]);
  unread.pr(7, { hours: null });
  unread.pass();
  assert.deepEqual(unread.flagged(), ['PR_UNOWNED 7']);
});

test('T3 M3 M4: an acknowledgement owns it for at most 24 hours, then it is new and called out at once; it is never disposed', () => {
  const fx = fixture([{ issue: 500 }]);
  fx.pr(1261, { hours: 30, author: 'github-actions[bot]' });
  fx.pass();
  assert.deepEqual(fx.flagged(), ['PR_UNOWNED 1261']);
  const { id } = fx.entry('PR_UNOWNED', 1261);
  const long = fx.ack(id, 30);
  assert.equal(long.error.code, 'USAGE');
  assert.match(long.error.message, /at most 24 hours ahead for PR_UNOWNED/);
  const disposed = fx.ctrl(['dispose', '--finding', id, '--reason', 'it can wait']);
  assert.equal(disposed.error.code, 'FINDING_NO_DISPOSE');
  for (const route of [/a train, or the owner's merge/, /hand it to the task/, /close it with a closing comment/, /at most 24 hours ahead/]) assert.match(disposed.error.message, route, 'names the routes that clear it');
  assert.equal(fx.run(['ack', '--finding', id, '--next', 'x', '--session', 'other', '--controller']).error.code, 'ROLE_REFUSED', 'only the parent\'s holder acknowledges');
  assert.equal(fx.ctrl(['ack', '--finding', id, '--next', 'land it on the next train']).error, null, 'with no due time it is 24 hours');
  assert.equal(fx.entry('PR_UNOWNED', 1261).due, iso(START + 24 * HOUR));
  fx.now = START + 23 * HOUR;
  fx.pass();
  assert.deepEqual(fx.flagged(), ['PR_UNOWNED 1261 acknowledged'], 'M3: stays acknowledged');
  const owned = fx.row(1261);
  assert.deepEqual([owned.owner, owned.next, owned.due], ['controller', 'land it on the next train', iso(START + 24 * HOUR)]);
  assert.equal(state.netCallout(fx.parent().attention, iso(fx.now)).count, 0);
  fx.now = START + 25 * HOUR;
  assert.equal(fx.row(1261).owner, 'none', 'M4: past due it has no owner, before any pass');
  fx.pass();
  assert.deepEqual(fx.flagged(), ['PR_UNOWNED 1261']);
  assert.deepEqual(state.netCallout(fx.parent().attention, iso(fx.now)).entries.map(entry => [entry.ref, entry.state, entry.hours]), [['PR #1261', 'overdue', 1]]);
  assert.equal(fx.ack(id).error, null, 'the missed step is answered again');
});

test('T4 M5 M6 M7 M8: red is raised on the first pass, one finding per pull request, and each head is its own', () => {
  const fx = fixture([{ issue: 500 }]);
  fx.pr(1443, { hours: 1 / 6, checks: RED, author: SHARD_BOT, branch: 'toolkit/shard-timings-20261122' });
  fx.pr(1261, { hours: 26, author: 'app/github-actions', head: sha('b') });
  fx.pass();
  assert.deepEqual(fx.flagged(), ['PR_RED_UNOWNED 1443', 'PR_UNOWNED 1261'], 'M5: ten minutes old and red');
  // M6: acknowledged while green, then red at the same head.
  assert.equal(fx.ack(fx.entry('PR_UNOWNED', 1261).id).error, null);
  fx.github.prs.get(1261).contexts = RED;
  fx.now = START + HOUR;
  fx.pass();
  assert.deepEqual(fx.flagged(), ['PR_RED_UNOWNED 1261', 'PR_RED_UNOWNED 1443'], 'the age finding resolved and the red one is new');
  assert.equal(fx.row(1261).owner, 'none');
  // M7: green again at the same head, under and over 24 hours.
  for (const number of [1443, 1261]) assert.equal(fx.ack(fx.entry('PR_RED_UNOWNED', number).id).error, null);
  assert.equal(fx.row(1443).owner, 'controller');
  for (const number of [1443, 1261]) fx.github.prs.get(number).contexts = [...RED, run('validate', 'SUCCESS', 30), run('gate', 'SUCCESS', 30)];
  fx.now = START + 2 * HOUR;
  fx.pass();
  assert.deepEqual(fx.flagged(), ['PR_UNOWNED 1261']);
  assert.equal(fx.entry('PR_UNOWNED', 1261).state, 'new');
  // M8: red again, acknowledged, then a new red head.
  fx.github.prs.get(1443).contexts = RED;
  fx.pass();
  const first = fx.entry('PR_RED_UNOWNED', 1443);
  assert.equal(fx.ack(first.id).error, null);
  Object.assign(fx.github.prs.get(1443), { head: sha('c'), rollupOid: sha('c') });
  fx.now = START + 3 * HOUR;
  fx.pass();
  const second = fx.entry('PR_RED_UNOWNED', 1443);
  assert.deepEqual([second.state, second.head], ['new', sha('c')]);
  assert.notEqual(second.id, first.id);
  assert.equal(fx.parent().attention.find(entry => entry.id === first.id).state, 'resolved');
  assert.equal(fx.ctrl(['dispose', '--finding', second.id, '--reason', 'flaky']).error.code, 'FINDING_NO_DISPOSE');
  assert.match(fx.ack(second.id, 25).error.message, /at most 24 hours ahead for PR_RED_UNOWNED/);
});

test('T5 M9: a failed row a newer run replaced is not red; a red one names every failing job once', () => {
  const fx = fixture([]);
  fx.pr(1523, { hours: 2, checks: REPLACED });
  fx.pass();
  assert.deepEqual(fx.flagged(), []);
  assert.deepEqual([fx.row(1523).red, fx.row(1523).failing], [false, []]);
  fx.github.prs.get(1523).contexts = [...REPLACED, run('gate', 'FAILURE', 20), run('validate', 'FAILURE', 20)];
  const report = fx.pass();
  assert.deepEqual(fx.flagged(), ['PR_RED_UNOWNED 1523']);
  assert.deepEqual(fx.row(1523).failing, ['gate', 'validate'], 'a job that passed since is not failing');
  assert.equal(report.findings.find(finding => finding.code === 'PR_RED_UNOWNED').detail, 'red at aaaaaaa (failing: gate, validate), and no task in progress owns it');
});

// M10 is a guard: the base raises CHECKS_RED and TASK_IDLE for these too, and must keep doing so.
test('T6 M10 to M14: a task in progress owns what it tracks or what names it; queued, finished and mentioned ones do not', () => {
  const fx = fixture([
    { issue: 500, doc: active({ number: 50, state: 'OPEN', head: sha('a') }) }, { issue: 501, doc: active() }, { issue: 502 },
    { issue: 503, class: 'COMPLETED', state: 'closed', doc: doc => Object.assign(doc, { lifecycle: 'DONE' }) }, { issue: 504, class: 'RETIRED', state: 'closed', doc: doc => Object.assign(doc, { lifecycle: 'RETIRED' }) },
    { issue: 505, doc: active({ number: 59, state: 'OPEN', head: sha('a') }) },
  ]);
  fx.github.issues.get(503).state_reason = 'completed';
  const old = { hours: 48, updated_at: iso(START - 48 * HOUR) };
  fx.pr(50, { ...old, checks: RED, body: 'No reference at all' });
  fx.pr(51, { ...old, body: 'Refs #501', checks: RED });
  fx.pr(52, { ...old, body: 'Refs #502' });
  fx.pr(53, { ...old, body: 'Closes #503', checks: RED });
  fx.pr(54, { ...old, body: 'Refs #504' });
  fx.pr(55, { ...old, body: 'Refs #502, #501', checks: RED });
  fx.pr(56, { ...old, body: 'Seen while on #501' });
  fx.pr(57, { ...old, body: 'Refs #421' });
  fx.pr(59, { ...old, body: 'A tracked one with nothing moving' });
  // A bare mention puts the pull request in #501's links on GitHub; it still owns nothing.
  fx.github.issuePrLinks.set(501, { timeline: [56] });
  for (const number of [50, 51, 52, 53, 54, 55, 56, 57, 59]) fx.github.prs.get(number).updated_at = old.updated_at;
  for (const number of [421, 500, 501, 502, 503, 504, 505]) fx.github.issues.get(number).updated_at = old.updated_at;
  fx.now = START + 8 * HOUR;
  const report = fx.pass();
  assert.deepEqual(fx.flagged(), ['PR_RED_UNOWNED 53', 'PR_UNOWNED 52', 'PR_UNOWNED 54', 'PR_UNOWNED 56', 'PR_UNOWNED 57']);
  const rows = new Map(fx.run(['attention']).result.open_prs.map(row => [row.number, row]));
  assert.deepEqual([50, 51, 52, 53, 54, 55, 56, 57, 59].map(number => rows.get(number).owner), ['#500', '#501', 'none', 'none', 'none', '#501', 'none', 'none', '#505']);
  assert.equal(rows.get(51).next, 'Builder: finish the slice', 'the owner\'s next action is the next step');
  assert.ok(report.findings.some(finding => finding.code === 'CHECKS_RED' && finding.issue === 500), 'a task\'s own red pull request is CHECKS_RED as before');
  assert.ok(report.findings.some(finding => finding.code === 'TASK_IDLE' && finding.issue === 505), 'a stalled task with an open pull request is TASK_IDLE as before');
  // M13: a claimed task no document shows yet counts for that pass; a finished one without a document does not.
  const parent = { ...fx.parent(), outcomes: [{ issue: 600, class: 'COMMITTED', parent: 421, order: 1 }, { issue: 601, class: 'COMPLETED', parent: 421, order: 2 }] };
  const open = [{ number: 60, body: 'Refs #600', created_at: iso(START - 48 * HOUR), head_sha: sha('a') }, { number: 61, body: 'Refs #601', created_at: iso(START - 48 * HOUR), head_sha: sha('a') }];
  const read = state.openPrRows({ open, parent, docs: new Map(), now: iso(START) });
  assert.deepEqual(read.map(row => [row.owner, row.code]), [['#600', null], ['none', 'PR_UNOWNED']]);
});

test('T7 M15 to M21: trains, drafts, stacked, dependency and outside pull requests all go by the same rule', () => {
  const fx = fixture([{ issue: 500, doc: active() }]);
  const member = { body: 'Refs #500', head: sha('d') };
  fx.pr(70, { hours: 1, ...member });
  const table = `## Merge train\n\n| Member | Reviewed head |\n|---|---|\n| #70 | \`${sha('d')}\` |\n\nRefs #500`;
  fx.pr(71, { hours: 23, body: table, checks: [] });
  fx.pr(72, { hours: 25, body: table });
  fx.pr(73, { hours: 1, body: table, checks: RED });
  fx.pr(74, { hours: 25, isDraft: true });
  fx.pr(75, { hours: 1, isDraft: true, checks: RED });
  fx.pr(76, { hours: 25, base: 'toolkit/500-first-slice', checks: [run('lint', 'FAILURE')] });
  fx.pr(77, { hours: 25, base: 'toolkit/500-first-slice', body: 'Refs #500', checks: [] });
  fx.pr(78, { hours: 6, author: 'dependabot[bot]' });
  fx.pr(79, { hours: 25, author: 'dependabot[bot]' });
  fx.pass();
  assert.deepEqual(fx.flagged(), ['PR_RED_UNOWNED 73', 'PR_UNOWNED 72', 'PR_UNOWNED 74', 'PR_UNOWNED 76', 'PR_UNOWNED 79', 'PR_RED_UNOWNED 75'].sort());
  const rows = new Map(fx.run(['attention']).result.open_prs.map(row => [row.number, row]));
  assert.deepEqual([rows.get(71).owner, rows.get(74).draft, rows.get(77).owner], ['none', true, '#500'], 'a train claims no task; a draft says so; a stacked one is owned by its own claim');
  // M21: a governed repository whose programme has no task for the pull request, beside PR_WITHOUT_TASK as today.
  const bare = fixture([]);
  bare.pr(80, { hours: 25, author: 'outside-contributor' });
  bare.pr(81, { hours: 1, author: 'outside-contributor' });
  bare.pass();
  assert.deepEqual(bare.flagged(), ['PR_UNOWNED 80']);
  assert.deepEqual(bare.parent().attention.filter(entry => entry.code === 'PR_WITHOUT_TASK').map(entry => entry.issue).sort(), [80, 81]);
});

test('T8 M22 M23 M24: the evidence store\'s pull requests go by age, keep their own ids and are held while unread', () => {
  const fx = fixture([{ issue: 500 }, { issue: 12 }]);
  fx.storePr(12, 25);
  fx.storePr(13, 23);
  fx.pr(12 + 1000, { hours: 25 });
  fx.pass();
  assert.deepEqual(fx.flagged(), ['PR_UNOWNED 1012', 'PR_UNOWNED store 12']);
  const entry = fx.entry('PR_UNOWNED', 12, 'store');
  assert.notEqual(entry.id, state.findingId('reconcile', 'PR_UNOWNED', 12), 'its id is not the repository pull request\'s');
  assert.deepEqual(state.validateParent(fx.parent()), []);
  assert.match(state.findingText(entry), /^PR_UNOWNED store PR 12: /);
  assert.deepEqual([fx.row(12, 'store').owner, fx.row(13, 'store').owner, fx.row(13, 'store').code], ['none', 'none', null]);
  assert.equal(fx.row(12, 'store').next, `flagged ${entry.id}`);
  // M23: a queued pass that reads no task: the store's 12 is not task 12's finding, and closes with its pull request.
  fx.github.storePulls = fx.github.storePulls.filter(pr => pr.number !== 12);
  fx.now = START + HOUR / 2;
  fx.sweep({ canRead: () => false });
  assert.deepEqual(fx.flagged(), ['PR_UNOWNED 1012'], 'resolved although task 12 was not read');
  // M24: a store that cannot be read holds its findings as they stand, and only its own.
  fx.storePr(14, 30);
  fx.pass();
  assert.deepEqual(fx.flagged(), ['PR_UNOWNED 1012', 'PR_UNOWNED store 14']);
  fx.github.storePulls = [];
  fx.github.prs.delete(1012);
  for (const status of [403, 404, 503]) {
    fx.github.hooks = [call => (call.path.startsWith('repos/acme/state-store/pulls') ? { status, json: { message: 'no' } } : undefined)];
    fx.pass();
    assert.deepEqual(fx.flagged(), ['PR_UNOWNED store 14'], `held on ${status}`);
  }
  fx.github.hooks = [];
  fx.pass();
  assert.deepEqual(fx.flagged(), []);
  // No separate GitHub store: nothing is read and no store finding exists.
  fx.storePr(15, 30);
  const reader = { storePullRequests: () => assert.fail('no store list to read'), pullRequests: () => new Map() };
  for (const store of [undefined, { kind: 'other', repository: 'acme/state-store' }, { kind: 'github', repository: 'Acme/App' }]) {
    const facts = state.readOpenPrFacts({ reader, binding: { ...fx.binding, store }, parent: fx.parent(), docs: new Map(), open: [], now: iso(START) });
    assert.deepEqual([facts.store, facts.store_unread], [[], null]);
  }
});

test('T9 M25 M26: an open list not read in full holds both codes, and unknown check results hold a red one at that head', () => {
  const fx = fixture([{ issue: 500 }]);
  fx.pr(90, { hours: 25 });
  fx.pr(91, { hours: 1, checks: RED, head: sha('b') });
  fx.storePr(5, 25);
  fx.pass();
  const all = ['PR_RED_UNOWNED 91', 'PR_UNOWNED 90', 'PR_UNOWNED store 5'];
  assert.deepEqual(fx.flagged(), all);
  // M25: nothing raised or resolved for the repository's; the store's list was read, so it still counts.
  const pulls = fx.github.prs;
  fx.github.prs = new Map();
  fx.github.storePulls = [];
  fx.github.hooks = [call => (call.path.startsWith('repos/acme/app/pulls?state=open') ? { status: 502, json: {} } : undefined)];
  for (const pass of [() => fx.pass(), () => fx.sweep()]) { pass(); assert.deepEqual(fx.flagged(), all.slice(0, 2)); }
  fx.github.hooks = [];
  fx.github.prs = pulls;
  fx.storePr(5, 25);
  fx.pass();
  assert.deepEqual(fx.flagged(), all);
  // M26: the results list is cut short, then refused: the red one stands, age goes on as usual, and a
  // pull request never read red raises nothing.
  const shown = fx.github.prs.get(91);
  shown.hasNextPage = true;
  fx.pr(92, { hours: 1, checks: RED, head: sha('c'), hasNextPage: true });
  fx.pass();
  assert.deepEqual(fx.flagged(), all, 'unknown holds the red one and raises none');
  assert.equal(fx.ack(fx.entry('PR_RED_UNOWNED', 91).id).error, null);
  shown.hasNextPage = false;
  fx.github.hooks = [call => (/p91: pullRequest/.test(call.body?.query || '') || /pulls\/9[0-2]$/.test(call.path) ? { status: 502, json: {} } : undefined)];
  fx.now = START + 24 * HOUR;
  fx.pass();
  assert.deepEqual(fx.flagged(), ['PR_RED_UNOWNED 91', 'PR_UNOWNED 90', 'PR_UNOWNED 92', 'PR_UNOWNED store 5'], 'held past its due time, and no age finding beside it');
  fx.github.hooks = [];
  Object.assign(shown, { head: sha('e'), rollupOid: sha('e'), hasNextPage: true });
  fx.pass();
  assert.deepEqual(fx.flagged(), ['PR_UNOWNED 90', 'PR_UNOWNED 91', 'PR_UNOWNED 92', 'PR_UNOWNED store 5'], 'a new head with unknown results keeps no red one');
});

test('T9 M27 M28: a merged one resolves although the sweep queue is unfinished; issue-scoped, plain and dry runs change nothing', () => {
  const fx = fixture([{ issue: 500 }, { issue: 501 }]);
  fx.pr(95, { hours: 25 });
  fx.pr(96, { hours: 25 });
  fx.storePr(5, 25);
  fx.pass();
  const all = ['PR_UNOWNED 95', 'PR_UNOWNED 96', 'PR_UNOWNED store 5'];
  assert.deepEqual(fx.flagged(), all);
  Object.assign(fx.github.prs.get(95), { state: 'CLOSED', closedAt: iso(START), updated_at: iso(START) });
  fx.github.storePulls = [];
  fx.pr(97, { hours: 25 });
  // M28 first: what they would have changed is still owed afterwards.
  fx.make({ refreshFacts: false, writer: controller }).run({ apply: true });
  assert.deepEqual(fx.flagged(), all, 'a plain reconcile holds both codes');
  fx.make({ refreshFacts: false, writer: controller }).run({ apply: true, issue: 500 });
  fx.make().run({ apply: true, issue: 500 });
  assert.deepEqual(fx.flagged(), all, 'an issue-scoped pass decides none');
  const dry = fx.make().run({ apply: false });
  assert.ok(dry.findings.some(finding => finding.code === 'PR_UNOWNED' && finding.issue === 97));
  assert.deepEqual(fx.flagged(), all, 'a dry run writes nothing');
  // M27: no task read, so the queue is unfinished and every other finding on a non-task number is held.
  const report = fx.sweep({ canRead: () => false });
  assert.ok(report.sweep.left > 0, 'the queue is unfinished');
  assert.deepEqual(fx.flagged(), ['PR_UNOWNED 96', 'PR_UNOWNED 97']);
});

// The no-write half is a guard; the list at the end is what the base lacks.
test('T10: a second pass on the same pull requests writes no document', () => {
  const fx = fixture([{ issue: 500, doc: active() }]);
  fx.pr(95, { hours: 25 });
  fx.pr(96, { hours: 1, checks: RED });
  fx.pr(97, { hours: 25, body: 'Refs #500' });
  fx.storePr(5, 25);
  fx.pass();
  fx.pass();
  const commits = fx.github.commits;
  const report = fx.pass();
  assert.deepEqual(report.effects.filter(effect => effect.kind === 'update_attention'), []);
  assert.equal(fx.github.commits, commits);
  assert.deepEqual(fx.flagged(), ['PR_RED_UNOWNED 96', 'PR_UNOWNED 95', 'PR_UNOWNED store 5']);
});

// Guard (the invariant): reads only. Runs last, over every request the tests above made.
test('T15: no request writes a pull request or a run, and nothing is posted on an open unowned one', () => {
  assert.ok(worlds.length >= 10);
  for (const { github } of worlds) {
    const writes = github.calls.filter(call => call.method !== 'GET' && (call.path !== 'graphql' || /\bmutation\b/.test(call.body.query)));
    assert.deepEqual(writes.filter(call => /\/(?:pulls|actions)(?:\/|\?|$)/.test(call.path)).map(call => `${call.method} ${call.path}`), []);
    const unowned = new Set([...github.prs.values()].filter(pr => pr.state === 'OPEN' && !/#5\d\d/.test(pr.body)).map(pr => pr.number));
    assert.deepEqual(writes.filter(call => unowned.has(Number(/^repos\/acme\/app\/issues\/(\d+)/.exec(call.path)?.[1]))).map(call => `${call.method} ${call.path}`)
      .filter(line => !/\/issues\/(?:50|59)$/.test(line)), [], 'only a tracked pull request\'s own PATH block is written');
    assert.deepEqual(writes.filter(call => call.path.startsWith('repos/acme/state-store/pulls')), []);
  }
});
