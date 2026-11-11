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
  assert.match(f.github.issues.get(500).body, /#2001 MERGED/);
  assert.match(f.github.issues.get(500).body, /#2003 MERGED/);
  const before = { commits: f.github.commits, writes: f.github.mutations() };
  assert.deepEqual(f.reconciler.run({ apply: true }).holds, []);
  assert.deepEqual({ commits: f.github.commits, writes: f.github.mutations() }, before, 'unchanged scale fixture makes no writes');
});

test('parent PR cells stay bounded and each row is no larger than the main row format', () => {
  const f = renderScaleFixture(state);
  const render = () => state.renderParentBlockBody(f.parent, f.children, f.issues);
  const rows = () => render().split('\n').filter(line => /^\|[^|]*\|[^|]*\|#\d+\|/.test(line));
  assert.equal(rows().length, 72);
  for (const row of rows()) {
    const cells = row.slice(1, -1).split('|');
    const child = f.children.get(Number(cells[2].slice(1)));
    // One PR per row: the most recently opened one, and none for a retired task.
    const latest = child.lifecycle === 'RETIRED' ? '-' : `#${state.latestPr(child)}`;
    assert.equal(cells[3], latest);
    assert.equal(/\+\d/.test(cells[3]), false, 'the cell never counts other PRs');
    const mainRow = `| ${cells.join(' | ')} |`;
    assert.ok(row.length <= mainRow.length, `${child.issue}: ${row.length} > main ${mainRow.length}`);
  }
  const child = f.children.get(500);
  child.prs.push(...Array.from({ length: 100 }, (_, i) => ({ number: 5000 + i, state: 'MERGED', merge_sha: 'c'.repeat(40) })));
  assert.equal(rows()[0].split('|')[4], '#5099', 'a hundred more PRs still show as one: the latest');
  assert.doesNotMatch(render(), /#5000|\/commit\//);
  const detail = state.renderChildBlockBody(child, f.parent.outcomes[0]);
  for (const pr of child.prs) assert.ok(detail.includes(`#${pr.number} ${pr.state}`));
  assert.match(detail, /\/commit\/ccccccc/);
  child.prs = [];
  assert.equal(rows()[0].split('|')[4], '#2000');
  child.pr.number = null;
  assert.equal(rows()[0].split('|')[4], '-');
});

test('waiting preview lists at most five short items and keeps the full count', () => {
  const f = renderScaleFixture(state);
  const body = state.renderCurrentBlockBody(f.parent, f.children, f.issues, f.now);
  const waiting = body.split('**Waiting on you**')[1];
  assert.ok(waiting);
  assert.match(body, /106 waiting on you/);
  assert.equal(waiting.split('\n').filter(line => /^- CHILD_REOPENED #\d+$/.test(line)).length, 5);
  assert.match(waiting, /and 101 more: run programme.cjs attention/);
  assert.doesNotMatch(waiting, /Controller:/);
  assert.equal(body.split('\n').filter(line => /^- CHILD_REOPENED #\d+/.test(line)).length, 5, 'waiting entries do not repeat in the ordinary preview');
  for (const entry of f.parent.attention) entry.state = 'acknowledged';
  assert.doesNotMatch(state.renderCurrentBlockBody(f.parent, f.children, f.issues, f.now), /Waiting on you|waiting on you/);
});

test('waiting preview omits absent issue numbers and distinguishes findings at different heads', () => {
  const parent = state.newParent({ repository: 'example.test/app', parentIssue: 421 });
  parent.attention = state.foldAttention([], { source: 'reconcile', complete: true, now: '2026-11-06T00:00:00Z', seen: [
    { code: 'CHECKS_RED', issue: 7, head: 'a'.repeat(40) },
    { code: 'CHECKS_RED', issue: 7, head: 'b'.repeat(40) },
  ] });
  parent.attention = state.foldAttention(parent.attention, { source: 'inventory', complete: false, now: '2026-11-06T00:00:00Z',
    seen: [{ code: 'INVENTORY_INCOMPLETE', issue: null }] });
  const body = state.renderCurrentBlockBody(parent, new Map(), new Map(), '2026-11-08T00:00:00Z');
  assert.match(body, /3 waiting on you/);
  const waiting = body.split('**Waiting on you**')[1];
  assert.ok(waiting);
  assert.deepEqual(waiting.split('\n').filter(line => line.startsWith('- ')).sort(), [
    '- INVENTORY_INCOMPLETE',
    '- CHECKS_RED #7 at aaaaaaa',
    '- CHECKS_RED #7 at bbbbbbb',
  ].sort());
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
