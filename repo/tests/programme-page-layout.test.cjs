'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ROOT = process.env.A2A_SOURCE_ROOT || path.resolve(__dirname, '../..');
const state = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme-state.cjs'));
const { pageFixture } = require('./support/programme-page-fixture.cjs');

test('B-T1: the parent owns four capital H1 headings in order and settles', () => {
  const f = pageFixture(state, { count: 2 });
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.deepEqual(f.page().match(/^# (CURRENT|PROGRAMME GRAPH|AGENT CONTEXT|COMMENT TRACE)$/gm), ['# CURRENT', '# PROGRAMME GRAPH', '# AGENT CONTEXT', '# COMMENT TRACE']);
  for (const [name, heading] of [['CURRENT', 'CURRENT'], ['STATE', 'PROGRAMME GRAPH'], ['CONTEXT', 'AGENT CONTEXT'], ['TRACE', 'COMMENT TRACE']]) assert.ok(state.findStateBlock(f.page(), name).block.body.includes(`# ${heading}`));
  const writes = f.github.mutations();
  assert.equal(f.make().run({ apply: true }).summary, 'No changes');
  assert.equal(f.github.mutations(), writes);
});

test('B-T2: CURRENT migration removes just one adjacent exact heading and preserves hand bytes', () => {
  for (const eol of ['\n', '\r\n']) for (const adjacent of [true, false, 'blank-before-note']) {
    const current = state.renderBlock('old summary', '3.56.0', 'CURRENT').replace(/\n/g, eol);
    const isAdjacent = adjacent === true;
    const prefix = `# Programme${eol}  ${eol}## CURRENT${eol}${isAdjacent ? `${eol}` : `${adjacent === 'blank-before-note' ? eol : ''}Keep here.  ${eol}${eol}`}`;
    const suffix = `${eol}${eol}  Indented notes.  ${eol}${eol}${eol}[ref]: https://example.com${eol}  `;
    const f = pageFixture(state, { hand: prefix + current + suffix });
    const body = f.project().body;
    assert.equal(body.startsWith(isAdjacent ? prefix.replace(`## CURRENT${eol}`, '') : prefix), true);
    assert.ok(body.includes(suffix), 'all suffix bytes remain in order');
    assert.equal(body.includes(`## CURRENT${eol}`), !isAdjacent);
  }
});

test('B-T3: overflow chooses the shortest row prefix, terminal groups before trace and live groups', t => {
  const f = pageFixture(state, { count: 84, hand: '# Programme\n\n' + 'Notes. '.repeat(5700) });
  const projected = f.project();
  assert.ok(projected.body.length < 55000);
  assert.ok(projected.graphRows.length > 0);
  const groups = projected.archive.filter(part => part.kind === 'graph' && part.count).map(part => part.group);
  assert.deepEqual(groups, ['RETIRED', 'COMPLETED'].slice(0, groups.length));
  const archived = projected.archive.filter(part => part.kind === 'graph').flatMap(part => part.body.match(/^\|[^\n]*\|#\d+\|[^\n]*$/gm) || []);
  const kept = projected.body.match(/^\|[^\n]*\|#\d+\|[^\n]*$/gm) || [];
  assert.equal(new Set([...kept, ...archived].map(row => row.split('|')[3])).size, 84);
  assert.equal(kept.length + archived.length, 84);
  const last = archived.at(-1);
  // In this fixture the last removed row stays in the same archive part. Restoring it costs exactly
  // its line and newline; the count remains one digit, so the summary costs the same.
  assert.ok(projected.body.length + last.length + 1 >= 55000, 'one fewer row cannot restore the safe limit');
  assert.match(projected.body, /Archived: \[\d+ retired\]/);
  t.diagnostic(JSON.stringify({ fixture: '84 rows', moved: projected.archive.filter(part => part.kind === 'graph').map(part => [part.group, part.count]), posts: projected.posts, body: projected.body.length }));
});

test('B-T6: retained text above the safe limit moves only the hard-limit prefix and reports near-limit', () => {
  const f = pageFixture(state, { count: 5, hand: '# Programme\n' + 'n'.repeat(55000) });
  const report = f.make().run({ apply: true });
  assert.deepEqual(report.holds, []);
  assert.ok(f.page().length >= 55000 && f.page().length < 60000);
  const entry = f.parent().attention.find(entry => entry.code === 'BODY_NEAR_LIMIT');
  assert.equal(entry.state, 'new');
  assert.equal(entry.diagnostics.largest_sections.reduce((sum, part) => sum + part.size, entry.diagnostics.remainder), entry.diagnostics.projected_total);
  const before = structuredClone(entry);
  f.make().run({ apply: true, issue: 100 });
  assert.deepEqual(f.parent().attention.find(entry => entry.code === 'BODY_NEAR_LIMIT'), before, 'partial passes cannot resolve it');
  assert.equal(f.posts().length, 0, 'no row must move when the full page already fits the hard limit');
});

test('B-T7: impossible body size refuses before all archive and body effects', () => {
  const f = pageFixture(state, { count: 84, hand: '# Programme\n\n' + 'Notes. '.repeat(5700) });
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.equal(f.parent().page_archive[0].state, 'moved');
  const hand = '# Programme\n' + 'n'.repeat(60000) + '\n\n## Archive\n### Marked\nChanged.\n';
  f.github.issues.get(12).body = hand;
  const posts = f.posts().length, edits = f.edits().length;
  const report = f.make().run({ apply: true });
  assert.ok(report.holds.some(hold => hold.code === 'BODY_TOO_LARGE'));
  assert.equal(f.page(), hand);
  assert.equal(f.posts().length, posts); assert.equal(f.edits().length, edits);
  assert.equal(f.parent().attention.find(entry => entry.code === 'BODY_TOO_LARGE').state, 'new');
});

test('newer CONTEXT blocks stop an older page writer before all effects', () => {
  const f = pageFixture(state, { hand: '# Programme\n' + state.renderBlock('# AGENT CONTEXT', '999.0.0', 'CONTEXT') + '\n## Archive\n### Notes\nKeep.\n' });
  const report = f.make().run({ apply: true });
  assert.ok(report.holds.some(hold => hold.code === 'BLOCK_NEWER_TOOLKIT'));
  assert.equal(f.posts().length + f.edits().length, 0);
});

test('apply-time near-limit warnings persist with exact sizes and resolve only after a full safe redraw', () => {
  const f = pageFixture(state, { count: 1 });
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  f.github.issues.get(12).body += '\nA small new note.';
  const pass = f.make(), plan = pass.plan();
  f.github.issues.get(12).body += '\n' + 'n'.repeat(55000);
  const result = pass.apply(plan);
  assert.deepEqual(result.holds, []);
  const entry = f.parent().attention.find(entry => entry.code === 'BODY_NEAR_LIMIT');
  assert.equal(entry.state, 'new');
  assert.equal(entry.diagnostics.projected_total, f.page().length);
  assert.equal(entry.diagnostics.largest_sections.reduce((sum, part) => sum + part.size, entry.diagnostics.remainder), f.page().length);
  f.make().run({ apply: true, issue: 100 });
  assert.equal(f.parent().attention.find(entry => entry.code === 'BODY_NEAR_LIMIT').state, 'new');
  f.github.issues.get(12).body = f.page().replace('n'.repeat(55000), 'Shorter.');
  f.make().run({ apply: true, inventory: { complete: false, findings: [], issues: [] } });
  assert.equal(f.parent().attention.find(entry => entry.code === 'BODY_NEAR_LIMIT').state, 'new');
  assert.deepEqual(f.make().run({ apply: true }).holds, []);
  assert.equal(f.parent().attention.find(entry => entry.code === 'BODY_NEAR_LIMIT').state, 'resolved');
});

test('a configured redraw threshold cannot raise the hard body limit', () => {
  const f = pageFixture(state, { hand: '# Programme\n' + 'n'.repeat(62000) + '\n## Archive\n### Notes\nText\n' });
  const pass = f.make();
  const guarded = new state.Reconciler({ store: f.store, reader: pass.reader, mutator: pass.mutator, binding: f.binding, writer: f.writer, toolkitVersion: '3.57.0', threshold: 70000 });
  assert.equal(guarded.threshold, 60000);
  assert.ok(guarded.run({ apply: true }).holds.some(entry => entry.code === 'BODY_TOO_LARGE'));
  assert.equal(f.posts().length + f.edits().length, 0);
});

test('a refusal measures the smallest feasible body within the five-post budget', () => {
  const pass = new state.Reconciler({ store: null, reader: null, mutator: null,
    binding: { repository: 'example.test/app', parent_issue: 12, record_prefix: 'TEST-' }, toolkitVersion: '3.57.0' });
  const rows = Array.from({ length: 900 }, (_, i) => `|${i}${'n'.repeat(195)}|${'d'.repeat(200)}|#${1000 + i}|-|-|RETIRED|-|`);
  const graph = '# PROGRAMME GRAPH\n\n| Task | Task Description | Child # | PR # | Class | Status | Last updated (SGT) |\n|---|---|---|---|---|---|---|\n' + rows.join('\n');
  const projected = pass.projectBody(12, '# Programme\n', graph, [], '3.57.0');
  assert.equal(projected.refused, true);
  assert.ok(projected.posts <= 5);
  assert.ok(projected.body.length >= 60000, 'report the feasible body size, not the smaller impossible seven-comment body');
});

test('the smaller CONTEXT stub retains an exact disjoint size span and 5000 units of safe headroom', () => {
  const f = pageFixture(state);
  const projected = f.project(), context = state.findStateBlock(projected.body, 'CONTEXT').block;
  assert.equal(context.body, state.renderContextBlockBody());
  assert.match(context.body, /Hand-written sections stay on this page/);
  assert.doesNotMatch(context.body, /## Archive|ARCHIVE_SECTION_UNSAFE|Archived notes:/);
  const sizes = state.bodySizeDiagnostics(projected.body, state.SAFE_LIMIT);
  assert.equal(sizes.largest_sections.find(part => part.kind === 'CONTEXT').size, context.end - context.start);
  assert.equal(sizes.largest_sections.reduce((sum, part) => sum + part.size, sizes.remainder), projected.body.length);
  assert.equal(60000 - state.SAFE_LIMIT, 5000);
  assert.equal(sizes.required_reduction, 0);
  assert.equal(sizes.threshold, 55000);
});

test('M1: a refused parent size does not block another page redraw', () => {
  const f = pageFixture(state, { count: 1, groups: ['NOW'], hand: '# Programme\n' + 'n'.repeat(60000) });
  const hand = f.page();
  const report = f.make().run({ apply: true });
  assert.ok(report.holds.some(hold => hold.code === 'BODY_TOO_LARGE' && hold.target === '#12'));
  assert.equal(f.page(), hand);
  assert.equal(f.posts().length + f.edits().length, 0);
  assert.match(state.findStateBlock(f.github.issues.get(100).body).block.body, /Status: IN PROGRESS; class: NOW; lane: G1/);
  assert.equal(f.store.read('child', 100).doc.lifecycle, 'ACTIVE');
});
