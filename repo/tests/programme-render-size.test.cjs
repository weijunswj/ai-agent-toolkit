'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const ROOT = process.env.A2A_SOURCE_ROOT || path.resolve(__dirname, '../..');
const state = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme-state.cjs'));
const { renderScaleFixture } = require('./support/programme-render-scale.cjs');

test('72-row programme with four PRs per task and 106 waiting findings fits with margin', t => {
  const f = renderScaleFixture(state);
  const graph = state.renderParentBlockBody(f.parent, f.children, f.issues);
  const current = state.renderCurrentBlockBody(f.parent, f.children, f.issues, f.now);
  const projected = f.reconciler.projectBody(421, f.handWritten, graph, [], '3.56.0', null, current);
  t.diagnostic(JSON.stringify({ state: state.renderBlock(graph, '3.56.0').length, current: current.length, total: projected.body.length }));
  const plan = f.reconciler.plan();
  assert.ok(!plan.holds.some(h => h.code === 'BODY_TOO_LARGE'), JSON.stringify(plan.holds));
  assert.ok(state.renderBlock(graph, '3.56.0').length < 19000);
  assert.ok(projected.body.length < 57000, 'leave at least 3,000 characters below the unchanged threshold');
  const result = f.reconciler.apply(plan);
  assert.deepEqual(result.holds, []);
  const body = f.github.issues.get(421).body;
  t.diagnostic(`applied_total=${body.length}`);
  const withoutBlocks = body.replace(/<!-- AI-AGENT-TOOLKIT:programme-state:BEGIN (CURRENT|STATE|CONTEXT|TRACE)[^]*?<!-- AI-AGENT-TOOLKIT:programme-state:END \1 -->/g, '');
  assert.ok(withoutBlocks.replace(/\n{3,}/g, '\n\n').trim() === f.handWritten.trim(), 'keep the owner sections intact');
  assert.ok(body.length < 57000, `applied body: ${body.length}`);
  assert.match(body, /106 waiting on you/);
  assert.match(f.github.issues.get(500).body, /\|#2001\|MERGED\|/);
  assert.match(f.github.issues.get(500).body, /\|#2003\|MERGED\|/);
  const before = { commits: f.github.commits, writes: f.github.mutations() };
  assert.deepEqual(f.reconciler.run({ apply: true }).holds, []);
  assert.deepEqual({ commits: f.github.commits, writes: f.github.mutations() }, before, 'unchanged scale fixture makes no writes');
});

test('DONE WHEN progress on every row keeps the 72-row graph, its rows and the parent page within budget', () => {
  const f = renderScaleFixture(state, { doneWhen: true });
  const graph = state.renderParentBlockBody(f.parent, f.children, f.issues);
  const rows = graph.split('\n').filter(line => /^\|[^|\n]*\|#\d+\|/.test(line));
  assert.equal(rows.filter(line => /^\|[^|]*\|#\d+\|[^|]*\|Progress: 11\/12/.test(line)).length, 72, 'every row carries its count');
  for (const row of rows) assert.ok(row.length < 120, `a row stays short (${row.length}): ${row}`);
  assert.ok(state.renderBlock(graph, '3.56.0').length < 19000);
  const current = state.renderCurrentBlockBody(f.parent, f.children, f.issues, f.now);
  assert.ok(f.reconciler.projectBody(421, f.handWritten, graph, [], '3.56.0', null, current).body.length < 57000);
  assert.ok(!f.reconciler.plan().holds.some(h => h.code === 'BODY_TOO_LARGE'));
});

test('parent rows stay short and name no PR however many a task has; its task page lists every one', () => {
  const f = renderScaleFixture(state);
  const render = () => state.renderParentBlockBody(f.parent, f.children, f.issues);
  const rows = () => render().split('\n').filter(line => /^\|[^|\n]*\|#\d+\|/.test(line));
  assert.equal(rows().length, 72);
  const child = f.children.get(500);
  child.prs.push(...Array.from({ length: 100 }, (_, i) => ({ number: 5000 + i, state: 'MERGED', merge_sha: 'c'.repeat(40) })));
  for (const row of rows()) assert.ok(row.length < 120, `a row stays short (${row.length}): ${row}`);
  assert.doesNotMatch(render(), /#5\d{3}\b|#2\d{3}\b|\/commit\//, 'the parent names no PR (Waiting on names one only for an owner UAT)');
  const detail = state.renderChildBlockBody(child, f.parent.outcomes[0]);
  // The task page's PR GRAPH names every PR: a row each for the latest ten finished, the rest on its Earlier line.
  for (const pr of [child.pr, ...child.prs]) assert.ok(new RegExp(`^\\|[^|\\n]*\\|#${pr.number}\\|`, 'm').test(detail) || new RegExp(`^Earlier: .*#${pr.number}\\b`, 'm').test(detail), `#${pr.number}`);
  assert.match(detail, /\/commit\/ccccccc/);
});

test('CURRENT keeps only the waiting count; the full list is in the attention command', () => {
  const f = renderScaleFixture(state);
  const body = state.renderCurrentBlockBody(f.parent, f.children, f.issues, f.now);
  assert.match(body, /106 waiting on you\*\* · Holds: 0 · Full list: `programme\.cjs attention`/);
  assert.doesNotMatch(body, /CHILD_REOPENED|\*\*Waiting on you\*\*/);
  for (const entry of f.parent.attention) Object.assign(entry, { state: 'acknowledged', due: new Date(Date.parse(f.now) + 3600000).toISOString() });
  assert.doesNotMatch(state.renderCurrentBlockBody(f.parent, f.children, f.issues, f.now), /waiting on you/);
});

test('deliberately oversized unmarked prose still holds with BODY_TOO_LARGE and preserves the parent page', () => {
  const f = renderScaleFixture(state, { count: 300 });
  // Graph rows can now move. Immovable hand text must still exercise the original hard refusal.
  f.github.issues.get(421).body += 'Unmarked prose. '.repeat(4000);
  const before = f.github.issues.get(421).body;
  const plan = f.reconciler.plan();
  const hold = plan.holds.find(h => h.code === 'BODY_TOO_LARGE' && h.target === '#421');
  assert.ok(hold);
  assert.equal(hold.diagnostics.threshold, 60000);
  assert.ok(hold.diagnostics.projected_total >= 60000);
  assert.ok(f.reconciler.apply(plan).holds.some(h => h.code === 'BODY_TOO_LARGE'));
  assert.ok(f.github.issues.get(421).body === before, 'the oversized parent page is never written');
});
