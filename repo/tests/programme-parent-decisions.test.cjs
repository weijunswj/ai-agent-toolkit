'use strict';

// Page layout v2 on the parent: the page is exactly CURRENT, PROGRAMME GRAPH and AGENT CONTEXT, and
// the old DECISIONS block (a trace command plus a newest-only link) folds into the AGENT CONTEXT
// line as links to the full decision index, so the body itself always reaches every listed record.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ROOT = process.env.A2A_SOURCE_ROOT || path.resolve(__dirname, '../..');
const state = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme-state.cjs'));
const { auditDecisionTraces, INDEX_COMMENT_MARKER, DIRECTORY_COMMENT_MARKER } = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/decision-trace-audit.cjs'));
const { pageFixture } = require('./support/programme-page-fixture.cjs');

const REPO = 'example.test/app';
const link = id => `https://github.com/${REPO}/issues/12#issuecomment-${id}`;
const contextLine = body => state.findStateBlock(body, 'CONTEXT').block.body.split('\n')[2];
const person = (id, body, created) => ({ id, body, user: { login: 'owner', type: 'User' }, created_at: created });

test('the parent page has exactly CURRENT, PROGRAMME GRAPH and AGENT CONTEXT, with no DECISIONS block or newest-only link', () => {
  const f = pageFixture(state, { count: 2 });
  f.github.addComment(12, { body: 'Release plan\n---\nTEST-004 decision.' });
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.deepEqual(f.page().match(/^# [A-Z][A-Z ]+$/gm), ['# CURRENT', '# PROGRAMME GRAPH', '# AGENT CONTEXT']);
  assert.equal(state.findStateBlock(f.page(), 'TRACE').block, null, 'no TRACE block');
  assert.doesNotMatch(f.page(), /Newest:/, 'no newest-only link');
  assert.doesNotMatch(f.page(), /optional tasks/i, 'the graph order line no longer names optional tasks');
  const writes = f.github.mutations();
  assert.equal(f.make().run({ apply: true }).summary, 'No changes');
  assert.equal(f.github.mutations(), writes);
});

test('a parent page that still has the old DECISIONS block reads clean and loses it on the next write', () => {
  const old = state.renderBlock('# DECISIONS\n<!-- programme-trace issue=12 -->\nDecision records are this issue\'s tagged comments. Newest: [5](#issuecomment-5).', '3.57.0', 'TRACE');
  const hand = '# Programme\n\nUnmarked notes.\n';
  const f = pageFixture(state, { count: 1, hand: `${hand}\n${old}\n\n[ref]: https://example.test/ref\n` });
  const report = f.make().run({ apply: true });
  assert.deepEqual(report.holds, []);
  assert.ok(!report.findings.some(entry => entry.code === 'MANAGED_BLOCK_BROKEN'), 'the old block reads');
  assert.equal(state.findStateBlock(f.page(), 'TRACE').block, null);
  assert.doesNotMatch(f.page(), /^# DECISIONS$/m);
  assert.ok(f.page().startsWith('# Programme\n') && f.page().includes('\nUnmarked notes.\n'), 'hand-written text above is kept');
  assert.ok(f.page().endsWith('\n\n[ref]: https://example.test/ref\n'), 'hand-written text below is kept');
  assert.equal(f.make().run({ apply: true }).summary, 'No changes');
});

test('AGENT CONTEXT links every decision index comment, oldest first; bot, archive and other comments never count', () => {
  const comments = [
    person(40, `${INDEX_COMMENT_MARKER}\n## Decision index, part 2\n- [b](#issuecomment-2)`, '2026-11-02T00:00:00Z'),
    person(30, `${INDEX_COMMENT_MARKER}\n## Older decision index\n- [a](#issuecomment-1)`, '2026-10-01T00:00:00Z'),
    { id: 50, body: `${INDEX_COMMENT_MARKER}\n- [c](#issuecomment-3)`, user: { login: 'helper[bot]', type: 'Bot' }, created_at: '2026-11-03T00:00:00Z' },
    person(60, `<!-- programme-page-archive key=graph-retired-1 -->\n# Programme graph: RETIRED\n${INDEX_COMMENT_MARKER}\n`, '2026-11-04T00:00:00Z'),
    person(70, 'Release plan\n---\nA decision.', '2026-11-05T00:00:00Z'),
  ];
  const line = state.renderContextBlockBody(12, comments, REPO).split('\n')[2];
  assert.equal(line, `Agent context: none yet · Decisions: [index 1](${link(30)}), [index 2](${link(40)}) · \`programme.cjs trace 12\``);
  const one = state.renderContextBlockBody(12, comments.slice(1, 2), REPO).split('\n')[2];
  assert.equal(one, `Agent context: none yet · Decisions: [index](${link(30)}) · \`programme.cjs trace 12\``);
});

test('with a directory comment, AGENT CONTEXT links the directory alone, not the parts under it', () => {
  const part = (id, n) => person(id, `${INDEX_COMMENT_MARKER}\n<!-- programme-trace intent=x part=${n}/2 -->\n- [d](#issuecomment-${n})`, `2026-11-0${n}T00:00:00Z`);
  const directory = person(90, `${INDEX_COMMENT_MARKER}\n${DIRECTORY_COMMENT_MARKER}\n- **Topic:** [list 1](#issuecomment-81) [list 2](#issuecomment-82)`, '2026-11-09T00:00:00Z');
  const line = state.renderContextBlockBody(12, [part(81, 1), part(82, 2), directory], REPO).split('\n')[2];
  assert.equal(line, `Agent context: none yet · Decisions: [index](${link(90)}) · \`programme.cjs trace 12\``);
});

test('records listed only in index comments stay linked from the body through the generated Decisions links', () => {
  const f = pageFixture(state, { count: 1 });
  const records = [1, 2, 3, 4].map(n => f.github.addComment(12, { body: `Topic ${n}\n---\nTEST-00${n} decision.` }));
  f.github.addComment(12, { body: `${INDEX_COMMENT_MARKER}\n## Decision index, part 1\n${records.slice(0, 2).map(id => `- [r](${link(id)})`).join('\n')}` });
  f.github.addComment(12, { body: `${INDEX_COMMENT_MARKER}\n## Decision index, part 2\n${records.slice(2).map(id => `- [r](${link(id)})`).join('\n')}` });
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  const audit = body => auditDecisionTraces({ body, comments: f.github.commentsOf(12), recordPrefix: 'TEST-', repository: REPO, issue: 12 });
  const withLinks = audit(f.page());
  assert.deepEqual(withLinks.unlinked_decisions.map(entry => entry.id), [], 'every record is reachable from the body');
  assert.equal(withLinks.index_comments.length, 2);
  const line = contextLine(f.page());
  const stripped = f.page().replace(line, line.replace(/Decisions: .*? · `/, 'Decisions: `'));
  assert.notEqual(stripped, f.page());
  assert.deepEqual(audit(stripped).unlinked_decisions.map(entry => Number(entry.id)), records, 'without the generated links the records are unlinked');
});
