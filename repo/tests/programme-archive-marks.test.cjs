'use strict';

// Keeping every page under its budget without anyone editing a page by hand: a task page moves
// the notes marked under one `## Archive` line into its saved page copy and links it; a holder
// order's `mark-archive` write adds that line, or removes unused link lines, after saving a copy;
// BODY_OVER_BUDGET names only steps that clear it on that kind of page; and the parent's AGENT
// CONTEXT links its handover file.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const state = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');
const layout = require('../../skills/github-program-reconciler/scripts/programme-page-layout.cjs');
const cli = require('../../skills/github-program-reconciler/scripts/programme.cjs');
const orders = require('../../skills/github-program-reconciler/scripts/programme-holder-order.cjs');
const drift = require('../../skills/github-program-reconciler/scripts/programme-drift.cjs');
const { FakeGitHub } = require('./toolkit-programme-fake-github.cjs');

const VERSION = '3.9.1';
const NOW = Date.parse('2026-11-12T12:00:00.000Z');
const HOLDER = 'toolkit-421-projects-controller';
const controller = { session: HOLDER, prefix: 'INT-TK421-' };
const STORE_URL = 'https://github.com/acme/state-store/blob/main/state/acme/app/';
const TASK_PAGE = ['## WHY', '', '**The problem:** Pages grow.', '', '## Done when', '', '- [ ] small', '', '## History', '', 'Kept.', ''].join('\n');
const PARENT_PAGE = ['# Programme', '', '## CURRENT', '', 'Hand-written controller prose.', '', 'Old note line.', '', 'See [the old plan][plan].', '',
  '[plan]: https://example.test/plan', '[unused]: https://example.test/unused', ''].join('\n');

function setup(t, { bodies = {} } = {}) {
  const repository = 'acme/app';
  const github = new FakeGitHub({ repository, store: 'acme/state-store' });
  const binding = { schema: state.SCHEMA.binding, repository, parent_issue: 421, record_prefix: 'INT-TK421-', writer_prefix: 'INT-TK421-',
    store: { kind: 'github', repository: 'acme/state-store', branch: 'main', path: `state/${repository}/` }, required_checks: ['validate'] };
  github.addIssue(421, { body: bodies[421] ?? PARENT_PAGE });
  github.addIssue(806, { body: bodies[806] ?? TASK_PAGE, parent: 421 });
  const outcomes = [{ issue: 806, class: 'COMMITTED', order: 1, parent: 421 }];
  const store = new state.StateStore({ transport: github, store: binding.store, now: () => new Date(NOW).toISOString(), toolkitVersion: VERSION });
  store.write('parent', 421, state.claimDocument(state.newParent({ repository, parentIssue: 421, outcomes }), controller, {}), { sha: null, previous: null });
  const reconciler = () => new state.Reconciler({ store, reader: new state.ProgrammeGraphReader({ transport: github, repository }),
    mutator: new state.GitHubMutator({ transport: github, repository }), binding, writer: controller, toolkitVersion: VERSION });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-marks-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const parentDoc = () => store.read('parent', 421).doc;
  const order = (ops, extra = {}) => ({ schema: orders.SCHEMA, order_id: 'mark-archive-1', parent_issue: 421, holder_session: HOLDER, epoch: parentDoc().fence.epoch,
    expires_at: new Date(NOW + 2 * 3600 * 1000).toISOString(), record: 'INT-TK421-950', ops, ...extra });
  const run = (body, argv = []) => {
    const file = path.join(dir, `order-${Math.random().toString(16).slice(2)}.json`);
    fs.writeFileSync(file, JSON.stringify(body));
    let output = '';
    let error = null;
    try {
      cli.main(['run-order', '--order', file, '--session', 'backlog-thread-1', ...argv], { transport: github, binding, originUrl: 'https://github.com/acme/app.git', repoRoot: '.',
        toolkitVersion: VERSION, now: () => new Date(NOW).toISOString(), orderClock: () => NOW, environment: {}, stdout: { write: text => { output += text; } } });
    } catch (thrown) { error = thrown; }
    return { error, report: output ? JSON.parse(output) : null };
  };
  const copies = issue => github.calls.filter(call => call.method === 'PUT' && call.path.includes(`page-copies/issue-${issue}/`));
  const bodyWrites = issue => github.calls.filter(call => call.method === 'PATCH' && call.path.endsWith(`/issues/${issue}`));
  const savedText = call => github.files.get(decodeURIComponent(call.path.split('/contents/')[1].split('?')[0])).text;
  return { github, store, reconciler, run, order, parentDoc, copies, bodyWrites, savedText };
}

test('a task page moves its notes under `## Archive` into the saved page copy and links it', t => {
  const f = setup(t);
  assert.deepEqual(f.reconciler().run({ apply: true }).holds, []);
  const laid = f.github.issues.get(806).body;
  assert.equal(layout.inOrder(laid), true);
  const marked = `${laid.replace(/\n$/, '')}\n\n## Archive\n\nOld review rounds.\n\n### Round 2\n\nMore history.\n`;
  f.github.issues.get(806).body = marked;
  assert.equal(layout.inOrder(marked), false, 'a page with marked notes is not settled');
  assert.deepEqual(f.reconciler().run({ apply: true }).holds, []);
  const body = f.github.issues.get(806).body;
  assert.doesNotMatch(body, /Old review rounds|More history|## Archive/);
  assert.match(body, /\n## History\n\nKept\./, 'text outside the marked area stays');
  const copy = f.copies(806).find(call => call.path.includes(state.sha256(marked)));
  assert.ok(copy, 'the page as it was is saved first');
  assert.equal(f.savedText(copy), marked);
  assert.ok(f.github.calls.indexOf(copy) < f.github.calls.indexOf(f.bodyWrites(806).at(-1)), 'the copy is written before the page');
  assert.ok(body.split('\n').includes(`Archived notes: [page copy](${STORE_URL}page-copies/issue-806/${state.sha256(marked)}.md)`), body);
  assert.equal(layout.inOrder(body), true);
  assert.equal(f.reconciler().run().summary, 'No changes');
});

test('a task page with two `## Archive` lines, or a marked link line used elsewhere, keeps its notes and says why', t => {
  const twice = setup(t, { bodies: { 806: `${TASK_PAGE}\n## Archive\n\nA.\n\n## Archive\n\nB.\n` } });
  const report = twice.reconciler().run({ apply: true });
  assert.match(twice.github.issues.get(806).body, /\nA\.\n[\s\S]*\nB\.\n/);
  const held = report.findings.find(entry => entry.code === 'PAGE_LAYOUT_HELD' && entry.issue === 806);
  assert.match(held?.detail || '', /`## Archive` line appears more than once/);
  const shared = setup(t, { bodies: { 806: `See [plan][p].\n\n${TASK_PAGE}\n## Archive\n\n[p]: https://example.test/p\n` } });
  const sharedReport = shared.reconciler().run({ apply: true });
  assert.match(shared.github.issues.get(806).body, /\[p\]: https:\/\/example\.test\/p/);
  assert.match(sharedReport.findings.find(entry => entry.code === 'PAGE_LAYOUT_HELD' && entry.issue === 806)?.detail || '', /link line under `## Archive` is used elsewhere/);
});

test('BODY_OVER_BUDGET names only steps that clear it on each kind of page', () => {
  const next = state.FINDING_CODES.BODY_OVER_BUDGET.next_action;
  assert.match(next, /mark-archive/, 'parent and task pages: an order marks the old text');
  assert.match(next, /task page/);
  assert.match(next, /PR page: its builder trims the description to the CHANGE shape/);
  assert.doesNotMatch(next, /have an agent put old hand-written text/);
});

test('a mark-archive write adds one `## Archive` line before the named line, after saving the page, and a re-run changes nothing', t => {
  const f = setup(t);
  const result = f.run(f.order([{ command: 'mark-archive', issue: 421, before: 'Old note line.' }]));
  assert.equal(result.error, null, result.error?.message);
  assert.equal(result.report.outcome, 'DONE');
  const body = f.github.issues.get(421).body;
  assert.equal(body, PARENT_PAGE.replace('Old note line.', '## Archive\nOld note line.'));
  const copy = f.copies(421)[0];
  assert.ok(copy, 'a copy of the page is saved first');
  assert.equal(f.savedText(copy), PARENT_PAGE);
  assert.ok(f.github.calls.indexOf(copy) < f.github.calls.indexOf(f.bodyWrites(421)[0]));
  const writes = f.bodyWrites(421).length;
  const again = f.run(f.order([{ command: 'mark-archive', issue: 421, before: 'Old note line.' }], { order_id: 'mark-archive-2' }));
  assert.equal(again.report.outcome, 'DONE');
  assert.equal(again.report.results[0].outcome, 'NOOP');
  assert.equal(f.bodyWrites(421).length, writes, 'the marked page is not written again');
});

test('a mark-archive write removes only link lines nothing else on the page uses', t => {
  const f = setup(t);
  const result = f.run(f.order([{ command: 'mark-archive', issue: 421, remove: ['[unused]: https://example.test/unused'] }]));
  assert.equal(result.report.outcome, 'DONE', result.error?.message);
  assert.equal(f.github.issues.get(421).body, PARENT_PAGE.replace('[unused]: https://example.test/unused\n', ''));
  const used = f.run(f.order([{ command: 'mark-archive', issue: 421, remove: ['[plan]: https://example.test/plan'] }], { order_id: 'mark-archive-3' }));
  assert.equal(used.report.outcome, 'STOPPED');
  assert.equal(used.report.results[0].code, 'ARCHIVE_MARK_REFUSED');
  const prose = f.run(f.order([{ command: 'mark-archive', issue: 421, remove: ['Hand-written controller prose.'] }], { order_id: 'mark-archive-4' }));
  assert.equal(prose.report.results[0].code, 'ARCHIVE_MARK_REFUSED', 'only link lines can be removed');
  assert.ok(f.github.issues.get(421).body.includes('Hand-written controller prose.'));
});

test('a mark-archive write refuses a missing or repeated line, a PR page and a page the reader would refuse, and writes nothing', t => {
  const f = setup(t, { bodies: { 421: `${PARENT_PAGE}\nTwice.\n\nTwice.\n` } });
  f.github.addIssue(900, { body: 'A PR description.\n', pull_request: true });
  const before = f.github.issues.get(421).body;
  for (const [id, op] of [
    ['m-1', { command: 'mark-archive', issue: 421, before: 'Not on the page.' }],
    ['m-2', { command: 'mark-archive', issue: 421, before: 'Twice.' }],
    ['m-3', { command: 'mark-archive', issue: 900, before: 'A PR description.' }],
    ['m-4', { command: 'mark-archive', issue: 421, before: '# Programme' }],
  ]) {
    const result = f.run(f.order([op], { order_id: id }));
    assert.equal(result.report?.outcome, 'STOPPED', `${id}: ${result.error?.message}`);
    assert.equal(result.report.results[0].code, 'ARCHIVE_MARK_REFUSED', id);
  }
  assert.equal(f.github.issues.get(421).body, before);
  assert.equal(f.copies(421).length, 0);
});

test('a mark-archive write marks an open task page, refuses a closed or outside task, and stops on a page that moves or reads back wrong', t => {
  const f = setup(t);
  const task = f.run(f.order([{ command: 'mark-archive', issue: 806, before: 'Kept.' }]));
  assert.equal(task.report?.outcome, 'DONE', task.error?.message);
  assert.equal(f.github.issues.get(806).body, TASK_PAGE.replace('Kept.', '## Archive\nKept.'));
  f.github.addIssue(950, { body: 'Elsewhere.\n' });
  const outside = f.run(f.order([{ command: 'mark-archive', issue: 950, before: 'Elsewhere.' }], { order_id: 'm-outside' }));
  assert.equal(outside.report.results[0].code, 'ARCHIVE_MARK_REFUSED');
  // A person edits the page after it was read: nothing is written over the edit.
  f.github.intercept((call, github) => {
    if (call.method === 'PUT' && call.path.includes('page-copies/issue-421/')) github.issues.get(421).body += '\nA late edit.\n';
  });
  const moved = f.run(f.order([{ command: 'mark-archive', issue: 421, before: 'Old note line.' }], { order_id: 'm-moved' }));
  assert.equal(moved.report.results[0].code, 'BODY_MOVED');
  assert.ok(f.github.issues.get(421).body.endsWith('A late edit.\n'));
  assert.equal(f.bodyWrites(421).length, 0);
  f.github.hooks = [];
  // GitHub stores something other than what was written: the write is reported, never taken as done.
  f.github.intercept((call, github) => {
    if (call.method !== 'PATCH' || !call.path.endsWith('/issues/421')) return null;
    const answer = github.route(call.method, call.path, call.body);
    github.issues.get(421).body += 'x';
    return answer;
  });
  const mismatch = f.run(f.order([{ command: 'mark-archive', issue: 421, before: 'Old note line.' }], { order_id: 'm-readback' }));
  assert.equal(mismatch.report.results[0].code, 'BODY_READBACK_MISMATCH');
  f.github.hooks = [];
  f.github.issues.get(806).state = 'closed';
  const closed = f.run(f.order([{ command: 'mark-archive', issue: 806, remove: ['[x]: y'] }], { order_id: 'm-closed' }));
  assert.equal(closed.report.results[0].code, 'ARCHIVE_MARK_REFUSED', 'a closed task page keeps its text');
});

test('a dry run of a mark-archive order writes nothing, and the order needs exactly one of before or remove', t => {
  const f = setup(t);
  const dry = f.run(f.order([{ command: 'mark-archive', issue: 421, before: 'Old note line.' }]), ['--dry-run']);
  assert.equal(dry.report.outcome, 'READY', dry.error?.message);
  assert.equal(f.github.issues.get(421).body, PARENT_PAGE);
  assert.equal(f.copies(421).length, 0);
  for (const op of [{ command: 'mark-archive', issue: 421 }, { command: 'mark-archive', issue: 421, before: 'x', remove: ['[a]: b'] }, { command: 'mark-archive', issue: 421, remove: [] }]) {
    assert.equal(f.run(f.order([op])).error?.code, 'ORDER_INVALID', JSON.stringify(op));
  }
});

test('the parent AGENT CONTEXT links its handover file', t => {
  const line = state.renderContextBlockBody(421, [], 'acme/app', [], `${STORE_URL}handover/issue-421.md`).split('\n').at(-1);
  assert.equal(line, `Agent context: none yet · Handover: [handover file](${STORE_URL}handover/issue-421.md) · Decisions: \`programme.cjs trace 421\``);
  const f = setup(t);
  assert.deepEqual(f.reconciler().run({ apply: true }).holds, []);
  const context = state.findStateBlock(f.github.issues.get(421).body, 'CONTEXT').block.body;
  assert.match(context, new RegExp(`Handover: \\[handover file\\]\\(${STORE_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}handover/issue-421\\.md\\)`));
});

// BLOCK_BEHIND means the page shows an older state than the stored document: its drawn revision is
// older. A page drawn at the stored revision by an older Toolkit is only an older look, which the
// rotation redraws; a page outside this pass's scope is not checked.
test('BLOCK_BEHIND compares the drawn revision with the stored one, and only for pages in the pass', t => {
  const f = setup(t);
  assert.deepEqual(f.reconciler().run({ apply: true }).holds, []);
  const doc = f.store.read('child', 806).doc;
  const body = f.github.issues.get(806).body;
  assert.equal(drift.drawnRevision(body), doc.revision);
  // The same revision as an older Toolkit drew it: a different look, its own marker hash intact.
  const drawn = state.findStateBlock(body).block;
  const redraw = (text, from, to) => text.slice(0, drawn.start) + state.renderBlock(drawn.body.replace(from, to), '3.0.0') + text.slice(drawn.end);
  const older = redraw(body, /^# STATUS$/m, '# STATUS\n\nAn older Toolkit drew this line.');
  assert.notEqual(older, body);
  assert.equal(state.findStateBlock(older).block.tampered, false);
  const r = f.reconciler();
  const run = (page, scope = null) => {
    const findings = [];
    const parent = f.store.read('parent', 421).doc;
    const issue = { ...f.github.issues.get(806), body: page, is_pull_request: false, state: 'open' };
    r.scope = scope;
    r.diffDrift(parent, new Map([[806, doc]]), { issues: new Map([[806, issue]]), prs: new Map(), references: new Map(), prPages: new Map() }, [], findings, []);
    return findings.filter(entry => entry.code === 'BLOCK_BEHIND').map(entry => entry.issue);
  };
  assert.deepEqual(run(older), [], 'same revision, older look: not behind');
  const stale = redraw(body, `State revision ${doc.revision} (issue-806.json)`, `State revision ${doc.revision - 1} (issue-806.json)`);
  assert.deepEqual(run(stale), [806], 'an older drawn revision is behind');
  assert.deepEqual(run(stale, new Set([999])), [], 'a page outside this pass is not checked');
});

test('mark-archive on the command line keeps every repeated --remove, and any other value given twice is refused', () => {
  const args = cli.parseArgs(['mark-archive', '--controller', '--issue', '421', '--remove', '[a]: https://example.test/a', '--remove', '[b]: https://example.test/b']);
  assert.deepEqual(args.remove, ['[a]: https://example.test/a', '[b]: https://example.test/b']);
  assert.throws(() => cli.parseArgs(['mark-archive', '--controller', '--issue', '421', '--issue', '806', '--before', 'x']), error => error.code === 'USAGE' && /--issue was given more than once/.test(error.message));
});
