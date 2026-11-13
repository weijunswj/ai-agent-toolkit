'use strict';

// Parity (delta closure rows P1 to P18): a queued sweep over a parent without a saved queue reads
// every task, so it must plan and apply exactly what the full refresh pass plans and applies on
// the same fixture: the same effects, the same results, the same documents and the same pages
// (the freshness line on CURRENT apart, which only the sweep draws). Each row names one consumer.
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const ROOT = process.env.A2A_SOURCE_ROOT || path.resolve(__dirname, '../..');
const state = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme-state.cjs'));
const cli = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme.cjs'));
const { FakeGitHub } = require('./toolkit-programme-fake-github.cjs');

const NOW = '2026-11-12T01:00:00.000Z';
// The earlier pass runs two hours before the compared pass; the new merge and close fall between.
const EARLIER = '2026-11-11T23:00:00.000Z';
const BETWEEN = '2026-11-12T00:00:00.000Z';
const controller = { session: 'fixture-controller', prefix: 'TEST-' };

// Settled tasks, native additions placed first, a closed task to copy, an open PR without a task,
// a task whose PR merged after the earlier pass (it advances the PR watermark), an open issue
// outside the catalogue, and a closed one (both closed items get the closing scan).
function fixture() {
  const github = new FakeGitHub({ repository: 'example.test/app', store: 'example.test/store' });
  const repository = github.repository;
  const binding = { schema: state.SCHEMA.binding, repository, parent_issue: 421, record_prefix: 'TEST-', writer_prefix: 'TEST-',
    store: { kind: 'github', repository: github.storeRepository, branch: 'main', path: 'state/' }, required_checks: [] };
  github.addIssue(421, { body: '# Programme\n\n## CURRENT\nHand-written notes.\n' });
  const outcomes = Array.from({ length: 12 }, (_, i) => ({ issue: 500 + i, class: i === 3 ? 'COMPLETED' : 'COMMITTED', parent: 421, order: i + 1 }));
  for (const outcome of outcomes) github.addIssue(outcome.issue, { parent: 421 });
  let now = EARLIER;
  const store = new state.StateStore({ transport: github, store: binding.store, now: () => now, toolkitVersion: '3.66.0' });
  store.write('parent', 421, state.claimDocument(state.newParent({ repository, parentIssue: 421, outcomes }), controller), { sha: null, previous: null });
  const full = () => new state.Reconciler({ binding, store, writer: state.refreshWriter(store.read('parent', 421).doc), refreshFacts: true, toolkitVersion: '3.66.0', now: () => now,
    reader: new state.ProgrammeGraphReader({ transport: github, repository }), mutator: new state.GitHubMutator({ transport: github, repository }) });
  assert.deepEqual(full().run({ apply: true }).holds, []);
  now = NOW;
  // Changes for one pass to find.
  for (let i = 0; i < 3; i += 1) github.addIssue(800 + i, { parent: 421 });
  github.issues.get(421).subs = [...github.issues.get(421).subs.slice(12), ...github.issues.get(421).subs.slice(0, 12)];
  Object.assign(github.issues.get(505), { state: 'closed', state_reason: 'completed', closed_at: github.tick(), updated_at: github.tick() });
  github.addPr(950, { head: 'c'.repeat(40), merged: true, mergedAt: BETWEEN, body: 'Refs #503' });
  Object.assign(github.prs.get(950), { closedAt: BETWEEN, updated_at: BETWEEN });
  github.issuePrLinks.set(503, { timeline: [950] });
  github.addPr(951, { head: 'd'.repeat(40), body: 'An open change for nothing in the catalogue' });
  github.addIssue(990, { body: 'Not placed anywhere' });
  Object.assign(github.addIssue(991, { state: 'closed' }), { closed_at: BETWEEN, updated_at: BETWEEN, state_reason: 'completed' });
  return { github, store, binding, full };
}

const unboard = body => body.split('\n').filter(line => !/^(?:Board updated: |⚠️ Board out of date |⚠️ Sweep stuck: )/.test(line)).join('\n');
const view = f => ({
  parent: (({ revision, volatile, sweep, attention, ...rest }) => ({ ...rest, attention: (attention || []).map(({ first_seen, changed_at, ...entry }) => entry) }))(f.store.read('parent', 421).doc),
  children: [...Array.from({ length: 12 }, (_, i) => 500 + i), 800, 801, 802].map(issue => (({ volatile, ...doc }) => doc)(f.store.read('child', issue).doc)),
  pages: [421, ...Array.from({ length: 12 }, (_, i) => 500 + i), 800, 801, 802].map(issue => [issue, unboard(f.github.issues.get(issue).body).replace(/CURRENT v2 toolkit=3\.66\.0 sha256=[0-9a-f]{12}/, 'CURRENT')]),
  prs: [950, 951].map(number => f.github.prs.get(number).body),
});
const shape = report => ({
  effects: report.effects.map(effect => `${effect.kind} #${effect.target.issue ?? effect.target.parent}`).sort(),
  results: report.results.map(result => `${result.kind} #${result.target.issue ?? result.target.parent} ${result.outcome}`).sort(),
  findings: report.findings.map(finding => `${finding.code} #${finding.issue}`).sort(),
  holds: report.holds,
});

test('parity: a queued pass on a parent without a queue applies what the full refresh applies', () => {
  const queued = fixture();
  let output = '';
  const code = cli.main(['refresh', '--json'], { transport: queued.github, binding: queued.binding, originUrl: 'https://github.com/example.test/app.git', repoRoot: '.',
    toolkitVersion: '3.66.0', now: () => NOW, passClock: () => Date.parse(NOW), lockFile: null, environment: {}, requestCap: 1000, stdout: { write: text => { output += text; } } });
  const sweep = JSON.parse(output);
  const plain = fixture();
  const inventory = new state.ProgrammeInventory({ transport: plain.github, repository: plain.github.repository, parents: [421], catalogue: plain.store.read('parent', 421).doc.outcomes.map(outcome => outcome.issue) }).run();
  const refresh = plain.full().run({ apply: true, inventory });
  assert.equal(code, 0, JSON.stringify(sweep.holds));
  assert.equal(sweep.sweep.read, 12, 'every catalogued task was read; the three new ones join as additions');
  const attention = f => f.store.read('parent', 421).doc.attention.map(entry => `${entry.code} #${entry.issue}`);
  // Rows with an expected value must find that work on both routes, so removing the step fails here.
  const expected = {
    'C1 inventory': [true, true],
    'C14 closing scan': [['DONE'], ['#950', '#991']],
    'C15 PR graph': [true, ['DONE']],
  };
  const rows = [
    ['C1 inventory', (report, f) => [report.inventory.complete, attention(f).includes('NEEDS_PLACEMENT #990')]],
    ['C2 native additions', report => report.results.filter(result => result.kind === 'add_native_children').map(result => result.outcome)],
    ['C3 attention', report => report.results.filter(result => result.kind === 'update_attention').map(result => result.outcome)],
    ['C4 state documents', report => report.results.filter(result => ['create_state', 'update_state'].includes(result.kind)).map(result => `${result.kind} #${result.target.issue}`).sort()],
    ['C5 lifecycle copy', report => report.results.filter(result => result.kind === 'copy_child_lifecycle').map(result => `#${result.target.issue} ${result.outcome}`)],
    ['C8 parent page', report => report.results.filter(result => result.kind === 'replace_block' && result.target.issue === 421).map(result => result.outcome)],
    ['C10 order', report => report.results.filter(result => result.kind === 'reorder').length],
    ['C12 task pages', report => report.results.filter(result => result.kind === 'replace_block' && result.target.issue !== 421).map(result => `#${result.target.issue} ${result.outcome}`).sort()],
    ['C14 closing scan', report => [report.results.filter(result => result.kind === 'advance_closing_scan').map(result => result.outcome),
      report.findings.filter(finding => finding.code === 'CLOSING_COMMENT_MISSING').map(finding => `#${finding.issue}`).sort()]],
    ['C15 PR graph', report => [report.findings.some(finding => finding.code === 'PR_WITHOUT_TASK' && finding.issue === 951), report.results.filter(result => result.kind === 'advance_pr_watermark').map(result => result.outcome)]],
    ['C17 findings', report => report.findings.map(finding => finding.code).sort()],
  ];
  for (const [name, pick] of rows) {
    assert.deepEqual(pick(sweep, queued), pick(refresh, plain), name);
    if (expected[name]) assert.deepEqual(pick(sweep, queued), expected[name], `${name}: the step ran`);
  }
  assert.deepEqual(shape(sweep), shape(refresh));
  assert.deepEqual(view(queued), view(plain), 'the same documents and pages');
  assert.match(queued.github.issues.get(421).body, /^Board updated: /m, 'only the sweep draws the freshness line');
  assert.doesNotMatch(plain.github.issues.get(421).body, /^Board updated: /m);
});
