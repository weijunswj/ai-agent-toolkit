'use strict';

// The fixed layout of task pages and task PR pages: what is laid out, what is held, and the saved
// copy that comes before any write that moves hand-written text.

const assert = require('node:assert/strict');
const test = require('node:test');
const state = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');
const layout = require('../../skills/github-program-reconciler/scripts/programme-page-layout.cjs');
const { FakeGitHub } = require('./toolkit-programme-fake-github.cjs');

const VERSION = '3.9.1';
const SHA_A = 'a'.repeat(40);
const writer = { session: 'controller-1', prefix: 'INT-TK421-' };
const HOUR = 60 * 60 * 1000;
const START = Date.parse('2026-11-01T00:00:00Z');

const GENERATED = [
  ['NAV', state.renderNavBlockBody([421, 806], null)],
  ['STATE', '<!-- programme-state child=806@1 -->\n# PR GRAPH\n\nNone yet.'],
  ['TRACE', '# DECISIONS\n<!-- programme-trace issue=806 -->\n- No comments yet.'],
];
const lay = source => layout.layoutTaskPage(source, GENERATED, VERSION);
const afterBlocks = body => body.slice(body.indexOf('-->', body.lastIndexOf(':END TRACE')) + 3);
const OLD_PAGE = [
  '# Title', '', 'Intro.', '',
  '**The problem:** Pages differ.', '',
  '## The fix', '', 'One layout.', '', '```', '# PROBLEM inside code', '```', '',
  '**If we skip it:** Nothing lines up.', '',
  '## Done when', '', '- [ ] a', '',
  '## Not in scope', '', 'Closed tasks.', '',
  '## Plan', '', 'Slice 1.', '',
  '## Notes', '', 'Keep me.', '',
].join('\n');

function setup({ outcomes = [{ issue: 806, class: 'COMMITTED', order: 1 }], bodies = {}, closed = [], clock = null } = {}) {
  const repository = 'acme/app';
  const github = new FakeGitHub({ repository, store: 'acme/state-store' });
  const binding = {
    schema: state.SCHEMA.binding, repository, parent_issue: 421, record_prefix: 'INT-TK421-', writer_prefix: 'INT-TK421-',
    store: { kind: 'github', repository: 'acme/state-store', branch: 'main', path: `state/${repository}/` }, required_checks: ['validate'],
  };
  github.addIssue(421, { body: '## CURRENT\nHand-written controller prose.\n' });
  for (const outcome of outcomes) {
    github.addIssue(outcome.issue, { body: bodies[outcome.issue] ?? `Body of ${outcome.issue}`, parent: outcome.parent || 421, state: closed.includes(outcome.issue) ? 'closed' : 'open' });
  }
  let ticks = 0;
  const time = { now: START };
  const now = clock ? () => new Date(time.now).toISOString() : () => `T${ticks += 1}`;
  const store = new state.StateStore({ transport: github, store: binding.store, now, toolkitVersion: VERSION });
  store.write('parent', 421, state.claimDocument(state.newParent({ repository, parentIssue: 421, outcomes: outcomes.map(outcome => ({ parent: 421, ...outcome })) }), writer, {}), { sha: null, previous: null });
  const reconciler = (version = VERSION, options = {}) => new state.Reconciler({
    store, reader: new state.ProgrammeGraphReader({ transport: github, repository }),
    mutator: new state.GitHubMutator({ transport: github, repository }), binding, writer, toolkitVersion: version,
    ...(clock ? { now } : {}), ...options,
  });
  const copies = () => github.calls.filter(call => call.method === 'PUT' && call.path.includes('page-copies'));
  const bodyWrites = number => github.calls.filter(call => call.method === 'PATCH' && call.path.endsWith(`/issues/${number}`));
  return { github, store, binding, reconciler, time, copies, bodyWrites };
}

// The task text between PATH and the generated blocks, and the generated blocks' names in order.
const taskPart = body => body.slice(body.indexOf('-->', body.indexOf(':END NAV')) + 3, body.indexOf('<!-- AI-AGENT-TOOLKIT:programme-state:BEGIN STATE'));
const blockOrder = body => [...body.matchAll(/programme-state:BEGIN (\w+)/g)].map(match => match[1]);

test('a task page is laid out as PATH, TASK with its capital parts, PLAN, the PR GRAPH, AGENT CONTEXT, then the hand-written text', () => {
  const result = lay(OLD_PAGE);
  assert.deepEqual(blockOrder(result.body), ['NAV', 'STATE', 'TRACE']);
  assert.equal(taskPart(result.body), [
    '', '',
    '# TASK', '',
    '## WHY', '',
    '### PROBLEM', '', 'Pages differ.', '',
    '### FIX', '', 'One layout.', '', '```', '# PROBLEM inside code', '```', '',
    '### IF WE SKIP', '', 'Nothing lines up.', '',
    '## DONE WHEN', '', '- [ ] a', '',
    '**Not in scope:** Closed tasks.', '',
    '# PLAN', '', 'Slice 1.', '', '',
  ].join('\n'), 'old labels and headings become the parts of TASK, then PLAN, in the fixed order');
  assert.equal(afterBlocks(result.body), ['', '', '# Title', '', 'Intro.', '', '## Notes', '', 'Keep me.', ''].join('\n'),
    'everything else follows the blocks in its own order, under its own headings');
  assert.deepEqual(result.sections, ['PROBLEM', 'FIX', 'IF WE SKIP', 'DONE WHEN', 'NOT IN SCOPE', 'PLAN']);
  assert.equal(result.moves, true);
  assert.equal(result.body.includes('# More'), false, 'there is no More heading');
});

test('TASK holds WHY and DONE WHEN, then PLAN follows as its own part, whatever order they were written in', () => {
  const page = '## Plan\n\nG0 plan link.\n\n## Done when\n\n- [ ] works\n\n## Why\n\n- **The problem:** slow.\n- **The fix:** fast.\n';
  const result = lay(page);
  assert.deepEqual(result.sections, ['PLAN', 'DONE WHEN', 'WHY']);
  assert.equal(taskPart(result.body), '\n\n# TASK\n\n## WHY\n\n- **The problem:** slow.\n- **The fix:** fast.\n\n## DONE WHEN\n\n- [ ] works\n\n# PLAN\n\nG0 plan link.\n\n');
  assert.equal(lay(result.body).body, result.body);
  assert.equal(layout.inOrder(result.body), true);
});

test('a page that still has WHAT keeps its words as the first part of TASK', () => {
  const result = lay('## What\n\nMake it fast.\n\n## The problem\n\nSlow.\n');
  assert.equal(taskPart(result.body), '\n\n# TASK\n\n## WHAT\n\nMake it fast.\n\n## WHY\n\n### PROBLEM\n\nSlow.\n\n');
  assert.equal(lay(result.body).body, result.body);
});

test('a page drawn by the earlier layout, with bold WHY labels, PLAN under TASK and More, is read and redrawn in the new one', () => {
  const generated = layout.layoutTaskPage('x', GENERATED, VERSION).body;
  const blocks = name => generated.slice(generated.lastIndexOf('<!--', generated.indexOf(`:BEGIN ${name} `)), generated.indexOf('-->', generated.indexOf(`:END ${name}`)) + 3);
  const older = [blocks('NAV'), '', '# TASK', '', '## WHAT', '', 'One line.', '', '## WHY', '', '**The problem:** Old.', '', '**The fix:**', '', '- New.', '', '## DONE WHEN', '', '- [ ] done', '', '## PLAN', '', 'Plan link.', '',
    blocks('STATE'), '', blocks('TRACE'), '', '# More', '', '## Notes', '', 'Kept.', ''].join('\n');
  assert.equal(layout.inOrder(older), false, 'the earlier layout is not the fixed order any more');
  const result = lay(older);
  assert.equal(taskPart(result.body), '\n\n# TASK\n\n## WHAT\n\nOne line.\n\n## WHY\n\n### PROBLEM\n\nOld.\n\n### FIX\n\n- New.\n\n## DONE WHEN\n\n- [ ] done\n\n# PLAN\n\nPlan link.\n\n');
  assert.equal(afterBlocks(result.body), '\n\n## Notes\n\nKept.\n', 'the More heading is dropped and its words stay');
  assert.equal(layout.inOrder(result.body), true);
});

test('a page with no task text gets no TASK heading', () => {
  const result = lay('Just notes.\n');
  assert.equal(result.body.includes('# TASK'), false);
  assert.deepEqual(blockOrder(result.body), ['NAV', 'STATE', 'TRACE']);
  assert.equal(afterBlocks(result.body), '\n\nJust notes.\n');
});

test('a page with only a plan gets PLAN and no TASK heading, and text under its blocks never joins the plan', () => {
  const first = lay('## Plan\n\nThe plan.\n');
  assert.equal(first.body.includes('# TASK'), false);
  assert.equal(taskPart(first.body), '\n\n# PLAN\n\nThe plan.\n\n');
  const second = lay(`${first.body}\nA note added at the bottom.\n\n### Problem\n\nNot the task's problem.\n`);
  assert.equal(taskPart(second.body), taskPart(first.body));
  assert.equal(afterBlocks(second.body), "\n\nA note added at the bottom.\n\n### Problem\n\nNot the task's problem.\n");
  assert.equal(lay(second.body).body, second.body);
});

test('a new task filed as the skill says, with no TASK heading, is laid out on its first pass, in capitals or Title Case', () => {
  for (const [why, parts, done, plan] of [['## WHY', ['### PROBLEM', '### FIX', '### IF WE SKIP'], '## DONE WHEN', '# PLAN'], ['## Why', ['### Problem', '### Fix', '### If we skip'], '## Done when', '# Plan']]) {
    const source = [why, '', ...parts.flatMap((heading, index) => [heading, '', `Words ${index}.`, '']), done, '', '- [ ] a', '', plan, '', 'Slice 1.', ''].join('\n');
    const first = lay(source);
    assert.equal(taskPart(first.body), '\n\n# TASK\n\n## WHY\n\n### PROBLEM\n\nWords 0.\n\n### FIX\n\nWords 1.\n\n### IF WE SKIP\n\nWords 2.\n\n## DONE WHEN\n\n- [ ] a\n\n# PLAN\n\nSlice 1.\n\n', why);
    assert.equal(lay(first.body).body, first.body, `${why}: the second lay-out gives the same bytes`);
  }
});

test('a WHY part heading inside PLAN or DONE WHEN stays where it is written', () => {
  const source = '## WHY\n\n### FIX\n\nThe fix.\n\n## DONE WHEN\n\n### Problem\n\nA check.\n\n# PLAN\n\n### Fix\n\nStep one.\n';
  for (const page of [source, source.replace('## WHY', '# TASK\n\n## WHY')]) {
    const first = lay(page);
    assert.equal(taskPart(first.body), '\n\n# TASK\n\n## WHY\n\n### FIX\n\nThe fix.\n\n## DONE WHEN\n\n### Problem\n\nA check.\n\n# PLAN\n\n### Fix\n\nStep one.\n\n');
    assert.equal(lay(first.body).body, first.body);
  }
});

test('a heading people write inside a TASK part stays in that part when the page is laid out again', () => {
  const first = lay('# PROBLEM\n\nA.\n\n## Detail\n\nStill the problem.\n\n# FIX\n\n- one\n- two\n');
  assert.match(taskPart(first.body), /### PROBLEM\n\nA\.\n\n## Detail\n\nStill the problem\.\n\n### FIX\n\n- one\n- two\n/);
  assert.equal(lay(first.body).body, first.body, 'the second lay-out gives the same bytes');
  assert.equal(lay(first.body).moves, false);
});

test('only the first line decides whether NOT IN SCOPE\'s words share its label line', () => {
  const result = lay('# DONE WHEN\n\n- [ ] a\n\n# NOT IN SCOPE\n\n1. first\n2. second\n');
  assert.match(taskPart(result.body), /\*\*Not in scope:\*\*\n\n1\. first\n2\. second\n/);
  assert.match(taskPart(lay('**Not in scope:** Plain words\n- then a list\n').body), /\*\*Not in scope:\*\* Plain words\n- then a list\n/);
  assert.equal(lay(result.body).body, result.body);
});

test('text written under the generated blocks of a laid-out page stays there, never in the last TASK part', () => {
  const first = lay('**The problem:** Slow.\n');
  const second = lay(`${first.body}\nA note added at the bottom.\n\n### Fix\n\nNot the task's fix.\n`);
  assert.match(taskPart(second.body), /### PROBLEM\n\nSlow\.\n\n$/);
  assert.equal(afterBlocks(second.body), "\n\nA note added at the bottom.\n\n### Fix\n\nNot the task's fix.\n");
  assert.equal(lay(second.body).body, second.body);
});

test('a hand-written heading below the generated blocks that reuses a generated name holds the page and names it', () => {
  const first = lay('**The problem:** Slow.\n');
  // A part's heading under the blocks is not a part there, so it holds like any other generated name.
  for (const heading of ['## PR GRAPH', '# STATUS', '### PROBLEM', '## AGENT CONTEXT:']) {
    const page = `${first.body}\n${heading}\n\nWords.\n`;
    assert.throws(() => lay(page), error => error.code === 'PAGE_LAYOUT_HELD' && error.reason.includes(`\`${heading}\``) && /generated heading's name/.test(error.reason), heading);
    assert.throws(() => layout.inOrder(page), error => error.code === 'PAGE_LAYOUT_HELD', heading);
  }
  assert.throws(() => lay('## CURRENT\n\nOld notes.\n'), error => error.code === 'PAGE_LAYOUT_HELD', 'text that will move below the blocks counts too');
  // Other headings in capitals, as on six open pages today, and Title Case names lay out as written.
  for (const heading of ['# NOTES', '## ELI5', '## PR 1141', '# CONDITIONS FOR BUILD SLICES', '## Notes', '## Status', '## Pr graph']) {
    const result = lay(`${first.body}\nIntro.\n\n${heading}\n\nWords.\n`);
    assert.ok(afterBlocks(result.body).includes(`\n${heading}\n`), heading);
    assert.equal(lay(result.body).body, result.body, heading);
  }
  assert.doesNotThrow(() => lay('## The problem\n\nSlow.\n\n### STATUS\n\nInside the part.\n'), 'a heading inside a TASK part is not checked');
  assert.doesNotThrow(() => lay('Notes.\n\n```\n## PR GRAPH\n```\n'), 'a heading inside code is no heading');
});

const childDoc = (change = {}) => ({ ...state.newChild({ repository: 'acme/app', outcome: { issue: 806, class: 'COMMITTED' } }), revision: 4, ...change });
const OUTCOME = { issue: 806, class: 'COMMITTED', order: 1 };

test('the task status block is a PR GRAPH: PR title, number, status and merge commit; the status stays out of sight', () => {
  const finished = Array.from({ length: 12 }, (unused, index) => ({ number: 700 - index, state: index % 4 === 3 ? 'CLOSED' : 'MERGED', merge_sha: index % 4 === 3 ? null : SHA_A }));
  const titles = new Map([[852, 'Build the child page | slice'], ...finished.map((pr, index) => [pr.number, `Slice ${index}`])]);
  const child = childDoc({
    lifecycle: 'ACTIVE', release: '3.67.0', next_action: 'G2 recheck at 0420542',
    gate: { role: 'G2', state: 'ACTIVE', session_id: null, route: null, returns: [] },
    pr: { number: 852, state: 'OPEN', head: SHA_A, checks: { state: 'PASS', required_total: 1, required_passed: 1, at_head: SHA_A } },
    review: { state: 'PASSED', verdicts: [{ reviewer: 'g2', head: SHA_A, verdict: 'PASSED' }] },
    prs: [{ number: 852, state: 'OPEN', merge_sha: null }, ...finished],
  });
  const body = state.renderChildBlockBody(child, OUTCOME, titles);
  const lines = body.split('\n');
  assert.equal(lines[0], '<!-- programme-state child=806@4 -->');
  assert.ok(lines.includes('<!-- State revision 4 (issue-806.json) -->'), 'the drawn revision stays on the page for drift checks, out of sight');
  assert.ok(lines.includes('<!-- Task status: IN PROGRESS -->'), 'the task status stays out of sight, for the frozen-page check');
  assert.equal(lines.filter(line => /^# /.test(line)).join(','), '# PR GRAPH', 'no STATUS heading');
  assert.ok(lines.includes('| PR Task | PR # | Status | Merged SHA |'));
  const rows = lines.filter(line => /^\|[^|\n]*(?:\\\|[^|\n]*)*\|#\d+\|/.test(line));
  assert.equal(rows[0], '|`Build the child page \\| slice`|#852|OPEN · G2 ACTIVE|-|', 'open PRs first, titled; the tracked one with its gate');
  assert.equal(rows.length, 11, 'the open PR, then up to ten finished ones');
  assert.equal(rows[1], `|\`Slice 0\`|#700|MERGED|[aaaaaaa](https://github.com/acme/app/commit/${SHA_A})|`);
  assert.ok(lines.includes('Earlier: #690, #689'), 'older finished PRs collapse to one line');
  for (const gone of ['Next:', 'Release:', 'Review', '3.67.0', 'CI at head']) assert.equal(body.includes(gone), false, `${gone} lives in the handover file`);
  assert.match(state.renderChildBlockBody(child, OUTCOME), /^\|-\|#852\|/m, 'a PR whose title is not read yet shows -');
});

test('the tracked PR\'s Status cell says UAT owed while the owner\'s test is owed', () => {
  const tracked = uat => childDoc({ lifecycle: 'ACTIVE', gate: { role: 'G2', state: 'PASSED', session_id: null, route: null, returns: [] },
    pr: { number: 852, state: 'MERGED', head: SHA_A, checks: null }, uat: { state: uat, at_head: uat === 'UAT_PARTIAL_REQUIRED' ? SHA_A : null },
    prs: [{ number: 853, state: 'OPEN', merge_sha: null }, { number: 852, state: 'MERGED', merge_sha: SHA_A }] });
  const titles = new Map([[853, 'Follow-up'], [852, 'Main change']]);
  for (const uat of ['PENDING', 'UAT_FULL_REQUIRED', 'UAT_PARTIAL_REQUIRED']) {
    const body = state.renderChildBlockBody(tracked(uat), OUTCOME, titles);
    assert.match(body, /^\|`Main change`\|#852\|MERGED · G2 PASSED · UAT owed\|\[aaaaaaa\]/m, uat);
    assert.match(body, /^\|`Follow-up`\|#853\|OPEN\|-\|$/m, 'only the tracked PR carries the gate and UAT');
    assert.match(body, new RegExp(`^<!-- Task status: IN PROGRESS · UAT: ${uat}\\b`, 'm'), 'the exact UAT state stays out of sight for the closure check');
  }
  assert.doesNotMatch(state.renderChildBlockBody(tracked('PASSED'), OUTCOME), /UAT owed/);
  const none = state.renderChildBlockBody(childDoc({ uat: { state: 'PENDING', at_head: null } }), OUTCOME);
  assert.match(none, /# PR GRAPH\n\nNone yet · UAT owed$/, 'with no PR yet the owed UAT still shows');
  // PRs listed but none tracked: the owed UAT and the gate show on one line under the graph.
  const untracked = state.renderChildBlockBody(childDoc({ gate: { role: 'G2', state: 'ACTIVE', session_id: null, route: null, returns: [] }, uat: { state: 'PENDING', at_head: null },
    prs: [{ number: 852, state: 'MERGED', merge_sha: SHA_A }] }), OUTCOME, titles);
  assert.match(untracked, /^\|`Main change`\|#852\|MERGED\|/m);
  assert.match(untracked, /\n\nTask: G2 ACTIVE · UAT owed$/);
  // A tracked PR only on the Earlier line: the same line carries them.
  const older = Array.from({ length: 11 }, (unused, index) => ({ number: 700 - index, state: 'MERGED', merge_sha: SHA_A }));
  const earlier = state.renderChildBlockBody(childDoc({ uat: { state: 'PENDING', at_head: null }, pr: { number: 690, state: 'MERGED', head: SHA_A, checks: null }, prs: older }), OUTCOME);
  assert.match(earlier, /Earlier: #690\n\nTask: UAT owed$/);
  assert.doesNotMatch(state.renderChildBlockBody(childDoc({ prs: [{ number: 852, state: 'OPEN', merge_sha: null }] }), OUTCOME), /Task:/, 'nothing to carry, no line');
});

test('a task page\'s AGENT CONTEXT links its handover file when the binding names a GitHub store', () => {
  const { handoverUrl } = require('../../skills/github-program-reconciler/scripts/programme-handover.cjs');
  const link = 'https://github.com/acme/state-store/blob/main/handover.md';
  assert.ok(state.renderTraceBlockBody(806, [], 'acme/app', link).endsWith(`\nHandover: [handover file](${link}) · Decisions: \`programme.cjs trace 806\` · None yet.`));
  assert.match(state.renderTraceBlockBody(806, [], 'acme/app'), /\nDecisions: `programme\.cjs trace 806` · None yet\.$/, 'no store, no handover link');
  const f = setup();
  assert.deepEqual(f.reconciler().run({ apply: true }).holds, []);
  const trace = state.findStateBlock(f.github.issues.get(806).body, 'TRACE').block.body;
  assert.ok(trace.includes(`Handover: [handover file](${handoverUrl(f.binding.store, 806)}) · Decisions: `), trace);
  assert.equal(state.findStateBlock(f.github.issues.get(421).body, 'TRACE').block, null, 'the programme page has no TRACE block: its own AGENT CONTEXT block links its handover');
});

test('a task with no PR yet shows its gate on the None yet line', () => {
  const gate = { role: 'G0', state: 'ACTIVE', session_id: null, route: null, returns: [] };
  assert.match(state.renderChildBlockBody(childDoc({ gate }), OUTCOME), /# PR GRAPH\n\nNone yet · G0 ACTIVE$/);
  assert.match(state.renderChildBlockBody(childDoc({ gate, uat: { state: 'UAT_FULL_REQUIRED', at_head: null } }), OUTCOME), /\nNone yet · G0 ACTIVE · UAT owed$/);
});

test('long PR titles are cut to 60 characters, so the PR GRAPH stays well inside the task page budget', () => {
  const title = n => `${String(n).padEnd(255, 'x')}y`;
  const child = childDoc({ gate: { role: 'G2', state: 'ACTIVE', session_id: null, route: null, returns: [] }, uat: { state: 'PENDING', at_head: null },
    pr: { number: 900, state: 'OPEN', head: SHA_A, checks: null },
    prs: [{ number: 900, state: 'OPEN', merge_sha: null }, ...Array.from({ length: 10 }, (unused, index) => ({ number: 800 - index, state: 'MERGED', merge_sha: SHA_A }))] });
  const titles = new Map(child.prs.map(pr => [pr.number, title(pr.number)]));
  const block = state.renderBlock(state.renderChildBlockBody(child, OUTCOME, titles), VERSION);
  assert.ok(block.length <= 2250, `the STATE block with its markers is ${block.length} characters`);
  const cells = block.split('\n').filter(line => /^\|[^|]*\|#\d+\|/.test(line)).map(line => line.split('|')[1]);
  assert.equal(cells.length, 11);
  for (const cell of cells) assert.ok(cell.length === 62 && cell.endsWith('...`'), cell);
  assert.equal(state.renderChildBlockBody(child, OUTCOME, new Map([[900, 'x'.repeat(60)]])).includes(`|\`${'x'.repeat(60)}\`|`), true, 'a 60-character title shows whole');
});

test('a pass shows each PR\'s title in the PR GRAPH without saving it, and a pass that reads no title keeps the cell', () => {
  const f = setup();
  f.github.addPr(900, { head: SHA_A, branch: 'feature', body: 'Refs #806', title: 'Build the child page' });
  f.github.issuePrLinks.set(806, { timeline: [900] });
  const reader = () => new state.ProgrammeGraphReader({ transport: f.github, repository: 'acme/app' });
  // PR history is read by a refresh pass.
  const refresh = () => new state.Reconciler({ store: f.store, reader: reader(),
    mutator: new state.GitHubMutator({ transport: f.github, repository: 'acme/app' }), binding: f.binding,
    writer: state.refreshWriter(f.store.read('parent', 421).doc), toolkitVersion: VERSION, refreshFacts: true });
  assert.deepEqual(refresh().run({ apply: true }).holds, []);
  assert.deepEqual(f.store.read('child', 806).doc.prs, [{ number: 900, state: 'OPEN', merge_sha: null }], 'the title is never saved in state');
  const row = /^\|`Build the child page`\|#900\|OPEN\b/m;
  assert.match(state.findStateBlock(f.github.issues.get(806).body, 'STATE').block.body, row);
  // An ordinary pass reads no PR history: the page keeps the title it shows, and nothing is rewritten.
  const page = f.github.issues.get(806).body;
  assert.deepEqual(f.reconciler().run({ apply: true }).holds, []);
  assert.equal(f.github.issues.get(806).body, page);
  // A renamed PR shows its new title once a refresh reads it.
  f.github.prs.get(900).title = 'Build the child page, renamed';
  assert.deepEqual(refresh().run({ apply: true }).holds, []);
  assert.match(f.github.issues.get(806).body, /^\|`Build the child page, renamed`\|#900\|/m);
  // A PR read on its own carries its title too.
  assert.equal(reader().pullRequest(900).title, 'Build the child page, renamed');
  // Older Toolkit copies read a closed `prs` shape: a saved title would stop them reading the store.
  const doc = f.store.read('child', 806).doc;
  assert.ok(state.validateChild({ ...doc, prs: [{ number: 900, state: 'OPEN', merge_sha: null, title: 'x' }] }).some(error => /unknown field\(s\): title/.test(error)));
});

test('a PR whose title looks like a secret never stops a refresh pass: its row shows -', () => {
  const f = setup();
  f.github.addPr(900, { head: SHA_A, branch: 'feature', body: 'Refs #806', title: `ghp_${'a'.repeat(36)}` });
  f.github.addPr(901, { head: SHA_A, branch: 'other', body: 'Refs #806', title: 'see https://example.test/x 123e4567-e89b-12d3-a456-426614174000' });
  f.github.issuePrLinks.set(806, { timeline: [900, 901] });
  const refresh = () => new state.Reconciler({ store: f.store, reader: new state.ProgrammeGraphReader({ transport: f.github, repository: 'acme/app' }),
    mutator: new state.GitHubMutator({ transport: f.github, repository: 'acme/app' }), binding: f.binding,
    writer: state.refreshWriter(f.store.read('parent', 421).doc), toolkitVersion: VERSION, refreshFacts: true });
  for (let pass = 0; pass < 2; pass += 1) assert.deepEqual(refresh().run({ apply: true }).holds, [], `pass ${pass + 1}`);
  assert.deepEqual(f.store.read('child', 806).doc.prs.map(pr => pr.number), [901, 900]);
  const body = f.github.issues.get(806).body;
  assert.match(body, /^\|-\|#900\|OPEN\|-\|$/m);
  assert.match(body, /^\|`see https:\/\/example\.test\/x 123e4567-e89b-12d3-a456-426614\.\.\.`\|#901\|/m, 'other titles are drawn as code');
  assert.equal(body.includes('ghp_'), false);
});

test('a PR title is drawn as code: no link, image, mention, reference, comment or UAT segment forms, and a secret-shaped title shows -', () => {
  const child = childDoc({ pr: { number: 852, state: 'OPEN', head: SHA_A, checks: null }, uat: { state: 'PASSED', at_head: SHA_A },
    prs: [{ number: 852, state: 'OPEN', merge_sha: null }, { number: 851, state: 'CLOSED', merge_sha: null }, { number: 850, state: 'CLOSED', merge_sha: null }] });
  const titles = new Map([[852, '[click](https://evil.example/p) ![i](x.png) @weijunswj #421 · UAT: PENDING'],
    [851, 'a `tick` <!-- AI-AGENT-TOOLKIT:x:END STATE --> c:\\p | b'], [850, `token ghp_${'a'.repeat(36)}`]]);
  const body = state.renderChildBlockBody(child, OUTCOME, titles);
  const cells = body.split('\n').filter(line => /^\|.*\|#\d+\|/.test(line)).map(line => /^\|(.*)\|#(\d+)\|/.exec(line)[1]);
  assert.equal(cells[0], '`[click](https://evil.example/p) ![i](x.png) @weijunswj #4...`', 'cut, inside one code span');
  assert.equal(cells[1], "`a 'tick' \u2039!-- AI-AGENT-TOOLKIT:x:END STATE --\u203A c:\uFF3Cp \\| b`", 'no backtick, < or > survives; the pipe is escaped');
  assert.equal(cells[2], '-', 'a secret-shaped title is not drawn');
  const page = `${state.renderBlock(body, VERSION)}\n\nTask text.`;
  const closure = require('../../skills/github-program-reconciler/scripts/issue-closure.cjs');
  for (const raw of ['x · UAT: PENDING', 'UAT: PENDING']) {
    assert.equal(closure.owedUat(`${state.renderBlock(state.renderChildBlockBody(child, OUTCOME, new Map([[852, raw]])), VERSION)}\n`), null, `${raw}: no owed UAT from a title`);
  }
  assert.equal(state.findStateBlock(page).block.tampered, false, 'the block is found whole');
  // The page's cells read back to the same cells.
  assert.equal(state.renderChildBlockBody(child, OUTCOME, state.pageTitles(page)), body);
  // A block edited by hand gives no titles back.
  assert.equal(state.pageTitles(page.replace('#852|OPEN', '#852|CLOSED')).size, 0);
});

test('a task with no PR yet shows None yet, and its status stays out of sight', () => {
  const body = state.renderChildBlockBody(childDoc({ lifecycle: 'WAITING_OWNER' }), OUTCOME);
  assert.match(body, /<!-- Task status: IN PROGRESS -->\n# PR GRAPH\n\nNone yet\.$/);
  assert.match(state.renderChildBlockBody(childDoc({ lifecycle: 'DONE' }), { ...OUTCOME, class: 'COMPLETED' }), /\n<!-- Task status: COMPLETED -->\n/);
});

test('a task page ends with one AGENT CONTEXT line; the programme page has no DECISIONS block', () => {
  const comments = [{ id: 11, body: 'Scope\n---\nA decision', created_at: '2026-11-01T00:00:00Z', user: { login: 'owner' } }];
  const task = state.renderTraceBlockBody(806, comments, 'acme/app');
  assert.equal(task, ['# AGENT CONTEXT', '<!-- programme-trace issue=806 -->',
    'Decisions: `programme.cjs trace 806` · Newest: [11](https://github.com/acme/app/issues/806#issuecomment-11)'].join('\n'));
  assert.match(state.renderTraceBlockBody(806, [], 'acme/app'), /\nDecisions: `programme\.cjs trace 806` · None yet\.$/);
});

test('a PR page status names each task on one line, then one AGENT CONTEXT line', () => {
  const one = state.renderPrStatusBlockBody(900, SHA_A, [{ issue: 806, child: childDoc({ gate: { role: 'G2', state: 'ACTIVE' }, review: { state: 'PASS', verdicts: [{ head: SHA_A, verdict: 'PASS' }] }, uat: { state: 'NOT_REQUIRED' }, release: '3.67.0' }) }]);
  assert.equal(one, ['<!-- programme-pr-status pr=900 -->', '# STATUS', '', '#806: Gate G2 ACTIVE · Review PASS at aaaaaaa · UAT NOT_REQUIRED · Release 3.67.0', '',
    '# AGENT CONTEXT', '', 'Decisions and handover live on the task: `programme.cjs trace 806`'].join('\n'));
  const two = state.renderPrStatusBlockBody(900, SHA_A, [{ issue: 806, child: null }, { issue: 807, child: childDoc() }]);
  assert.match(two, /\n- #806: no state yet\.\n- #807: Gate - · Review none yet · UAT - · Release -\n/);
  assert.match(two, /`programme\.cjs trace 806`, `programme\.cjs trace 807`$/);
});

test('a PR page puts STATUS and AGENT CONTEXT under the description, and moves them back there when text is added below', () => {
  const nav = state.renderBlock(state.renderPrNavBlockBody([[421, 806]], 900), VERSION, state.NAV_BLOCK_NAME);
  const status = state.renderBlock(state.renderPrStatusBlockBody(900, SHA_A, [{ issue: 806, child: null }]), VERSION);
  const first = state.upsertPrBlocks('**WHY**\n\nThe change.\n', nav, status);
  assert.equal(first, `${nav}\n\n**WHY**\n\nThe change.\n\n${status}\n`);
  assert.equal(state.upsertPrBlocks(first, nav, status), first, 'in place when already last');
  const older = `${nav}\n\n${status}\n\n**WHY**\n\nThe change.\n`;
  assert.equal(state.upsertPrBlocks(older, nav, status), first, 'a page from an older Toolkit gets its status moved under the description');
  assert.equal(state.upsertPrBlocks(`${first}\nAdded later.\n`, nav, status), `${nav}\n\n**WHY**\n\nThe change.\n\nAdded later.\n\n${status}\n`);
});

test('a closed task page that already shows its finished status is frozen: never redrawn', () => {
  const f = setup({ closed: [806] });
  const parentDoc = f.store.read('parent', 421).doc;
  f.reconciler().run({ apply: true });
  f.store.mutate('child', 806, { writer, parentDoc, change: doc => ({ ...doc, lifecycle: 'DONE', completed_at: '2026-11-01T00:00:00Z' }) });
  f.store.mutate('parent', 421, { writer, change: doc => ({ ...doc, outcomes: doc.outcomes.map(outcome => (outcome.issue === 806 ? { ...outcome, class: 'COMPLETED' } : outcome)) }) });
  f.reconciler().run({ apply: true });
  const frozen = f.github.issues.get(806).body;
  assert.match(state.findStateBlock(frozen, 'STATE').block.body, /\n<!-- Task status: COMPLETED -->\n/, 'the closing redraw records the finished status');
  const writes = f.bodyWrites(806).length;
  f.github.addComment(806, { body: 'Scope\n---\nA late decision' });
  f.store.mutate('child', 806, { writer, parentDoc: f.store.read('parent', 421).doc, change: doc => ({ ...doc, next_action: 'None: completed later' }) });
  const report = f.reconciler().run({ apply: true });
  assert.equal(f.bodyWrites(806).length, writes, 'no write to a frozen page');
  assert.equal(f.github.issues.get(806).body, frozen);
  assert.equal(report.findings.some(entry => entry.issue === 806 && ['PROJECTION_STALE', 'TRACE_STALE'].includes(entry.code)), false);
  f.github.issues.get(806).state = 'open';
  assert.ok(f.reconciler().run().effects.some(effect => effect.target.issue === 806), 'a reopened task is drawn again');
});

test('a task page over 4,000 characters and a PR page over 3,000 raise BODY_OVER_BUDGET naming their largest parts', () => {
  assert.deepEqual(state.PAGE_BUDGETS, { parent: 10000, child: 4000, pr: 3000 });
  const f = setup({ outcomes: [{ issue: 806, class: 'COMMITTED', order: 1 }, { issue: 807, class: 'COMMITTED', order: 2 }], bodies: { 806: `## Plan\n\n${'p'.repeat(4200)}\n`, 807: '## Plan\n\nShort.\n' } });
  f.github.addPr(900, { head: SHA_A, branch: 'feature', body: `${'w'.repeat(3100)}\n\nRefs #806` });
  f.github.addPr(901, { head: SHA_A, branch: 'other', body: 'Short.\n\nRefs #807' });
  const report = f.reconciler().run({ apply: true });
  const over = report.findings.filter(entry => entry.code === 'BODY_OVER_BUDGET');
  const task = over.find(entry => entry.issue === 806 && !entry.kind);
  assert.ok(task && task.diagnostics.threshold === 4000 && task.diagnostics.largest_sections[0].kind === 'hand_written', JSON.stringify(over));
  const pr = over.find(entry => entry.issue === 900 && entry.kind === 'pr');
  assert.ok(pr && pr.diagnostics.threshold === 3000, JSON.stringify(over));
  assert.equal(over.some(entry => [807, 901].includes(entry.issue)), false, 'pages within budget raise nothing');
  assert.ok(f.reconciler().run().findings.some(entry => entry.code === 'BODY_OVER_BUDGET' && entry.issue === 806), 'a settled page over budget still raises it');
});

test('a frozen closed page whose task moved under another parent gets its new PATH once, then stays frozen', () => {
  const f = setup({ outcomes: [{ issue: 806, class: 'COMMITTED', order: 1 }, { issue: 807, class: 'COMMITTED', order: 2 }], closed: [806] });
  const parentDoc = () => f.store.read('parent', 421).doc;
  f.reconciler().run({ apply: true });
  f.store.mutate('child', 806, { writer, parentDoc: parentDoc(), change: doc => ({ ...doc, lifecycle: 'DONE', completed_at: '2026-11-01T00:00:00Z' }) });
  f.store.mutate('parent', 421, { writer, change: doc => ({ ...doc, outcomes: doc.outcomes.map(outcome => (outcome.issue === 806 ? { ...outcome, class: 'COMPLETED' } : outcome)) }) });
  f.reconciler().run({ apply: true });
  assert.match(f.github.issues.get(806).body, /\n#421 > #806\n/);
  f.store.mutate('parent', 421, { writer, change: doc => ({ ...doc, outcomes: doc.outcomes.map(outcome => (outcome.issue === 806 ? { ...outcome, parent: 807 } : outcome)) }) });
  f.reconciler().run({ apply: true });
  const moved = f.github.issues.get(806).body;
  assert.match(moved, /\n#421 > #807 > #806\n/, 'the new path is drawn');
  const writes = f.bodyWrites(806).length;
  f.github.addComment(806, { body: 'Scope\n---\nA late decision' });
  f.reconciler().run({ apply: true });
  assert.equal(f.bodyWrites(806).length, writes, 'then the page is frozen again');
});

test('laying out twice gives the same bytes, and a newer version redraws the blocks without moving a word', () => {
  const first = lay(OLD_PAGE);
  const second = lay(first.body);
  assert.equal(second.body, first.body);
  assert.equal(second.moves, false, 'a page already in order moves no hand-written text');
  assert.equal(layout.inOrder(first.body), true);
  assert.equal(layout.inOrder(OLD_PAGE), false);
  const newer = layout.layoutTaskPage(first.body, GENERATED, '9.0.0');
  assert.notEqual(newer.body, first.body);
  assert.equal(newer.moves, false);
  assert.equal(layout.inOrder(newer.body), true, 'the order check does not depend on the version that drew the blocks');
});

test('no hand-written word is lost or changed, whatever shape the page has', () => {
  const pages = [
    OLD_PAGE,
    'Plain text only.\n',
    '',
    '# PROBLEM\n\nA.\n\n# NOT IN SCOPE\n\nB.\n\n# FIX\n\nC.\n',
    '## The problem\n\nA.\n\n### Detail\n\nStill the problem.\n\n## Other heading\n\nNot the problem.\n',
    'Lead.\n\n**The fix:** One line.\nSecond line of the fix.\n\n**Custom label:** stays.\n',
    '> # PROBLEM\n> quoted\n\n- # FIX\n  in a list\n\n    # DONE WHEN (indented code)\n\n<details>\n<summary>More</summary>\n\n# PROBLEM\n\n</details>\n',
    '# PROBLEM\r\n\r\nWindows line endings.\r\n\r\ntail\r\n',
  ];
  for (const page of pages) {
    const result = lay(page);
    const words = text => text.split(/\s+/).filter(Boolean);
    const kept = words(layout.withoutBlocks(result.body)).join(' ');
    for (const line of page.split(/\r?\n/).map(line => line.trim()).filter(Boolean)) {
      // A label line becomes its heading; its words after the label stay.
      const label = /^(?:\*\*[^*]+:\*\*|#{1,2} (?:the problem|problem|the fix|fix|done when|not in scope|if we skip(?: it)?|plan))\s*(.*)$/i.exec(line);
      const text = label && result.sections.length ? label[1] : line;
      if (text) assert.ok(kept.includes(words(text).join(' ')) || kept.toUpperCase().includes(words(text).join(' ').toUpperCase()), `${JSON.stringify(text)} survives in ${JSON.stringify(page.slice(0, 30))}`);
    }
    assert.equal(lay(result.body).body, result.body);
  }
  assert.ok(lay(pages[7]).body.endsWith('\r\n') && !/[^\r]\n/.test(lay(pages[7]).body), 'a page keeps its own line endings');
});

test('text inside code, lists, quotes and details is never taken for a heading', () => {
  const page = '> # PROBLEM\n> quoted\n\n- # FIX\n  in a list\n\n```\n# DONE WHEN\n```\n\n<details>\n<summary>Closed</summary>\n\n# NOT IN SCOPE\n\n</details>\n';
  const result = lay(page);
  assert.deepEqual(result.sections, []);
  assert.equal(afterBlocks(result.body), `\n\n${page}`);
});

test('a comment that runs over several lines hides headings until it ends, at either end form', () => {
  for (const end of ['-->', '--!>']) {
    const page = `Lead.\n\n<!-- note\n# PROBLEM\nstill a comment ${end}\n\n# FIX\n\nReal.\n`;
    const result = lay(page);
    assert.deepEqual(result.sections, ['FIX'], end);
    assert.equal(taskPart(result.body), '\n\n# TASK\n\n## WHY\n\n### FIX\n\nReal.\n\n', end);
    assert.equal(afterBlocks(result.body), `\n\nLead.\n\n<!-- note\n# PROBLEM\nstill a comment ${end}\n`, end);
  }
});

test('a section runs to the next section; a heading of the same or a higher level that is not a section ends it', () => {
  const result = lay('## The problem\n\nA.\n\n### Detail\n\nStill the problem.\n\n## Other heading\n\nNot the problem.\n');
  assert.equal(taskPart(result.body), '\n\n# TASK\n\n## WHY\n\n### PROBLEM\n\nA.\n\n### Detail\n\nStill the problem.\n\n');
  assert.equal(afterBlocks(result.body), '\n\n## Other heading\n\nNot the problem.\n');
});

test('a block that sits inside a section does not end the section', () => {
  const stateBlock = state.renderBlock(GENERATED[1][1], VERSION);
  const result = lay(`# PROBLEM\n\n${stateBlock}\n\nThe words of the problem.\n\n# FIX\n\nThe fix.\n`);
  assert.equal(taskPart(result.body), '\n\n# TASK\n\n## WHY\n\n### PROBLEM\n\nThe words of the problem.\n\n### FIX\n\nThe fix.\n\n');
  assert.equal(afterBlocks(result.body), '\n');
});

for (const [name, page, reason] of [
  ['an unclosed code block', 'Text\n```\nnever closed\n', /not closed/],
  ['an unclosed details section', '<details>\nopen\n', /not closed/],
  ['a section that appears twice', '# PROBLEM\n\nA\n\n## The problem\n\nB\n', /PROBLEM section appears more than once/],
  ['two More headings', '# More\n\nA\n\n# More\n\nB\n', /More heading appears more than once/],
  ['a block of another kind of page', `${state.renderBlock('x', VERSION, 'CURRENT')}\n\nText\n`, /belongs to another kind of page/],
]) test(`${name} holds the page instead of guessing`, () => {
  assert.throws(() => lay(page), error => error.code === 'PAGE_LAYOUT_HELD' && reason.test(error.message));
  assert.throws(() => layout.inOrder(page), error => error.code === 'PAGE_LAYOUT_HELD');
});

test('the parent graph shows one PR per row: the latest opened, whatever its state', () => {
  const child = number => ({ pr: { number }, prs: [] });
  assert.equal(state.latestPr({ pr: { number: 10 }, prs: [{ number: 12, state: 'CLOSED' }, { number: 11, state: 'OPEN' }] }), 12);
  assert.equal(state.latestPr(child(10)), 10);
  assert.equal(state.latestPr(child(null)), null);
  assert.equal(state.latestPr(undefined), null);
});

test('an open task is re-laid only after a copy of its page is saved and read back', () => {
  const f = setup({ bodies: { 806: OLD_PAGE } });
  const dry = f.reconciler().run();
  assert.ok(dry.findings.some(finding => finding.code === 'PROJECTION_STALE' && finding.issue === 806));
  const report = f.reconciler().run({ apply: true });
  assert.deepEqual(report.holds, []);
  const copy = f.copies();
  assert.equal(copy.length, 1);
  // The one page-copy format: the page's exact text as Markdown, named by its SHA-256.
  assert.match(copy[0].path, new RegExp(`state/acme/app/page-copies/issue-806/${state.sha256(OLD_PAGE)}\\.md$`));
  assert.ok(f.github.calls.indexOf(copy[0]) < f.github.calls.indexOf(f.bodyWrites(806)[0]), 'the copy is written before the page');
  const saved = f.github.files.get(decodeURIComponent(copy[0].path.split('/contents/')[1].split('?')[0])).text;
  assert.equal(saved, OLD_PAGE, 'the copy holds the page exactly as it was');
  const body = f.github.issues.get(806).body;
  assert.equal(layout.inOrder(body), true);
  assert.match(body, /^<!-- AI-AGENT-TOOLKIT:programme-state:BEGIN NAV [^\n]*\n# PATH\n<!-- programme-nav -->\n#421 > #806\n/);
  assert.match(body, /\n# TASK\n\n## WHY\n\n### PROBLEM\n\nPages differ\.\n\n### FIX\n\n/);
  assert.match(state.findStateBlock(body, 'STATE').block.body, /^<!-- Task status: QUEUED -->\n# PR GRAPH\n\nNone yet\.$/m);
  assert.match(state.findStateBlock(body, 'TRACE').block.body, /^# AGENT CONTEXT\n/);
  assert.match(body, /:END TRACE -->\n\n# Title\n\nIntro\.\n\n## Notes\n\nKeep me\.\n$/);
  assert.equal(f.reconciler().run().summary, 'No changes');

  // Later passes update blocks in place and need no further copy.
  f.github.addComment(806, { body: 'Scope\n---\nA new decision' });
  assert.deepEqual(f.reconciler().run({ apply: true }).holds, []);
  assert.equal(f.copies().length, 1, 'a page already in order is never copied again');
  assert.equal(afterBlocks(f.github.issues.get(806).body), afterBlocks(body));
});

test('when the copy cannot be saved the page is not written, and the next pass tries again', () => {
  const f = setup({ bodies: { 806: OLD_PAGE } });
  let fail = true;
  f.github.intercept(call => (fail && call.method === 'PUT' && call.path.includes('page-copies') ? { status: 502, json: { message: 'Bad gateway' } } : undefined));
  const report = f.reconciler().run({ apply: true });
  assert.ok(report.holds.some(hold => hold.code === 'PAGE_COPY_FAILED' && /#806/.test(hold.detail || hold.message || JSON.stringify(hold))), JSON.stringify(report.holds));
  assert.equal(f.bodyWrites(806).length, 0, 'no copy, no write');
  assert.equal(f.github.issues.get(806).body, OLD_PAGE);
  fail = false;
  assert.deepEqual(f.reconciler().run({ apply: true }).holds, []);
  assert.equal(layout.inOrder(f.github.issues.get(806).body), true);
});

for (const [name, page, why] of [
  ['an unclosed code block', 'Intro.\n\n```\nnever closed\n', /not closed/],
  ['a secret-shaped value', `Intro.\n\ntoken ghp_${'A1b2'.repeat(9)}\n`, /secret-shaped/],
]) test(`a task page with ${name} keeps its text where it is, still gets fresh blocks, and raises a finding`, () => {
  const f = setup({ bodies: { 806: page } });
  const report = f.reconciler().run({ apply: true });
  assert.deepEqual(report.holds, []);
  const finding = report.findings.find(entry => entry.code === 'PAGE_LAYOUT_HELD' && entry.issue === 806);
  assert.ok(finding && why.test(finding.detail), JSON.stringify(report.findings.map(entry => [entry.code, entry.detail])));
  assert.equal(f.copies().length, 0);
  const body = f.github.issues.get(806).body;
  for (const name of ['NAV', 'STATE', 'TRACE']) assert.ok(state.findStateBlock(body, name).block, `${name} is on the page`);
  assert.equal(layout.withoutBlocks(body).replace(/\n{2,}/g, '\n').trim(), page.replace(/\n{2,}/g, '\n').trim(), 'the hand-written text is untouched');
  assert.equal(body.includes('# More'), false);
  const again = f.reconciler().run();
  assert.deepEqual(again.effects, [], 'a held page settles: it is not rewritten every pass');
  assert.ok(again.findings.some(entry => entry.code === 'PAGE_LAYOUT_HELD'), 'the finding stays until the page is fixed');
});

test('a closed task keeps its text where it is: blocks in place, no copy', () => {
  const f = setup({ bodies: { 806: OLD_PAGE }, closed: [806] });
  const report = f.reconciler().run({ apply: true });
  assert.deepEqual(report.holds.filter(hold => hold.code !== 'CLOSED_WITHOUT_ACCEPTANCE'), []);
  assert.equal(f.copies().length, 0);
  const body = f.github.issues.get(806).body;
  assert.ok(state.findStateBlock(body, 'STATE').block);
  assert.equal(body.includes('# More'), false);
  assert.ok(body.includes('**The problem:** Pages differ.'), 'old labels stay as written on a closed task');
  assert.equal(report.findings.some(entry => entry.code === 'PAGE_LAYOUT_HELD'), false);
  assert.equal(f.reconciler().run().effects.filter(effect => effect.target.issue === 806).length, 0);
});

test('a pass re-lays at most ten pages; the rest keep fresh blocks and follow in the next pass', () => {
  const outcomes = Array.from({ length: 13 }, (unused, index) => ({ issue: 500 + index, class: 'COMMITTED', order: index + 1 }));
  const f = setup({ outcomes, bodies: Object.fromEntries(outcomes.map(outcome => [outcome.issue, OLD_PAGE])) });
  assert.equal(state.MAX_RELAYS_PER_PASS, 10);
  assert.deepEqual(f.reconciler().run({ apply: true }).holds, []);
  const ordered = () => outcomes.filter(outcome => layout.inOrder(f.github.issues.get(outcome.issue).body)).length;
  assert.equal(f.copies().length, 10);
  assert.equal(ordered(), 10);
  for (const outcome of outcomes) assert.ok(state.findStateBlock(f.github.issues.get(outcome.issue).body, 'STATE').block, `#${outcome.issue} has its status block either way`);
  assert.deepEqual(f.reconciler().run({ apply: true }).holds, []);
  assert.equal(f.copies().length, 13);
  assert.equal(ordered(), 13);
  assert.equal(f.reconciler().run().summary, 'No changes');
});

test('a task adopted from a native sub-issue gets its blocks in the same pass', () => {
  const f = setup();
  f.github.addIssue(900, { title: 'New task', body: '# PROBLEM\n\nNew.\n', parent: 421 });
  const pass = new state.Reconciler({ store: f.store, reader: new state.ProgrammeGraphReader({ transport: f.github, repository: 'acme/app' }),
    mutator: new state.GitHubMutator({ transport: f.github, repository: 'acme/app' }), binding: f.binding,
    writer: state.refreshWriter(f.store.read('parent', 421).doc), toolkitVersion: VERSION, refreshFacts: true });
  const report = pass.run({ apply: true });
  assert.deepEqual(report.holds, []);
  assert.ok(f.store.read('parent', 421).doc.outcomes.some(outcome => outcome.issue === 900), 'the sub-issue joined the catalogue');
  const body = f.github.issues.get(900).body;
  assert.equal(layout.inOrder(body), true);
  assert.match(body, /#421 > #900/);
  assert.match(body, /\n# TASK\n\n## WHY\n\n### PROBLEM\n\nNew\.\n\n<!-- AI-AGENT-TOOLKIT:programme-state:BEGIN STATE /);
});

test('every open PR that names a task gets PATH on top and STATUS under its description, which stays as written', () => {
  const f = setup({ outcomes: [{ issue: 806, class: 'COMMITTED', order: 1 }, { issue: 807, class: 'COMMITTED', order: 2 }] });
  f.reconciler().run({ apply: true });
  f.github.addPr(900, { head: SHA_A, branch: 'feature', body: 'Layout work.\n\nRefs #806\nRefs #807' });
  f.github.addPr(901, { head: SHA_A, state: 'MERGED', merged: true, branch: 'old', body: 'Closes #806' });
  f.github.addPr(902, { head: SHA_A, branch: 'elsewhere', body: 'Names no task.' });
  const report = f.reconciler().run({ apply: true });
  assert.deepEqual(report.holds, []);
  const body = f.github.prs.get(900).body;
  assert.match(body, /^<!-- AI-AGENT-TOOLKIT:programme-state:BEGIN NAV [^\n]*\n# PATH\n<!-- programme-nav -->\n/);
  assert.match(body, /#421 > #806 > PR #900/);
  assert.match(body, /#421 > #807 > PR #900/);
  assert.match(body, /<!-- programme-pr-status pr=900 -->\n# STATUS\n/);
  assert.match(body, /- #806: Gate [^\n]* · Review [^\n]* · UAT [^\n]* · Release [^\n]*\n- #807: /);
  assert.match(body, /\n# AGENT CONTEXT\n\n[^\n]*`programme\.cjs trace 806`/);
  assert.ok(body.includes(':END NAV -->\n\nLayout work.\n\nRefs #806\nRefs #807\n\n<!-- AI-AGENT-TOOLKIT:programme-state:BEGIN STATE '), 'the description between the blocks is byte for byte what was written');
  assert.equal(f.github.prs.get(901).body, 'Closes #806', 'a merged PR is never edited');
  assert.equal(f.github.prs.get(902).body, 'Names no task.', 'a PR that names no task is left alone');
  assert.equal(f.reconciler().run().effects.filter(effect => effect.kind === 'replace_pr_nav').length, 0, 'the PR page settles');
});

test('a PR that closed between planning and writing is not edited', () => {
  const f = setup();
  f.reconciler().run({ apply: true });
  f.github.addPr(900, { head: SHA_A, branch: 'feature', body: 'Refs #806' });
  const pass = f.reconciler();
  const plan = pass.plan();
  assert.ok(plan.effects.some(effect => effect.kind === 'replace_pr_nav' && effect.target.pr === 900));
  Object.assign(f.github.prs.get(900), { state: 'CLOSED' });
  pass.apply(plan);
  assert.equal(f.github.prs.get(900).body, 'Refs #806');
});

test('a PR page written by a newer Toolkit is held, so two computers never flip it', () => {
  const f = setup();
  f.reconciler().run({ apply: true });
  f.github.addPr(900, { head: SHA_A, branch: 'feature', body: 'Refs #806' });
  f.reconciler('9.0.0').run({ apply: true });
  const newer = f.github.prs.get(900).body;
  assert.match(newer, /toolkit=9\.0\.0/);
  f.github.addComment(806, { body: 'Scope\n---\nA new decision' });
  f.reconciler(VERSION).run({ apply: true });
  assert.equal(f.github.prs.get(900).body, newer);
});

test('the status block of a block-holding page never lands inside the PATH block', () => {
  const nav = state.renderBlock(state.renderNavBlockBody([421, 806], null), VERSION, state.NAV_BLOCK_NAME);
  const body = state.upsertStateBlock(`${nav}\n\nText with no title.\n`, state.renderBlock(GENERATED[1][1], VERSION)).body;
  const at = name => body.indexOf(`:BEGIN ${name} `);
  assert.ok(body.startsWith('<!-- AI-AGENT-TOOLKIT:programme-state:BEGIN NAV ') && body.indexOf(':END NAV') > 0, 'the fixture holds a PATH block');
  assert.ok(body.indexOf(':END NAV') < at('STATE'), body);
  assert.equal(state.findStateBlock(body, state.NAV_BLOCK_NAME).block.tampered, false, 'the PATH block is whole');
});

const idleRun = ({ lifecycle = 'ACTIVE', gate = null, pr = null, prs = null, holder = false, openPr = false, openPrUpdated = null, merged = false, hours = 7, comment = null, keepOpen = null } = {}) => {
  const f = setup({ clock: true });
  f.reconciler().run({ apply: true });
  const parentDoc = f.store.read('parent', 421).doc;
  f.store.mutate('child', 806, { writer, parentDoc, change: doc => {
    const next = { ...doc, lifecycle, ...(pr ? { pr: { ...doc.pr, ...pr } } : {}), ...(prs ? { prs } : {}), ...(lifecycle === 'DONE' ? { completed_at: new Date(START).toISOString() } : {}) };
    if (gate) next.gate = { ...next.gate, ...gate };
    if (holder) next.fence = { ...next.fence, holder_prefix: 'INT-TK421-', holder_session: 'lane-1' };
    if (keepOpen) next.private = { ...next.private, keep_open: keepOpen };
    return next;
  } });
  if (openPr) f.github.addPr(900, { head: SHA_A, branch: 'feature', body: 'Refs #806' });
  if (openPr && openPrUpdated !== null) f.github.prs.get(900).updated_at = new Date(START + openPrUpdated * HOUR).toISOString();
  if (merged) f.github.addPr(900, { head: SHA_A, branch: 'feature', body: 'Refs #806', merged: true, mergedAt: new Date(START).toISOString() });
  if (comment !== null) f.github.addComment(806, { body: 'A note', createdAt: new Date(START + comment * HOUR).toISOString() });
  f.time.now = START + hours * HOUR;
  return f;
};
const idle = options => idleRun(options).reconciler().run().findings.filter(finding => state.WORK_QUEUE_CODES.has(finding.code));

test('a task shown IN PROGRESS with no open PR, no live gate, no holder and no change for six hours is flagged', () => {
  assert.equal(state.TASK_IDLE_HOURS, 6);
  const found = idle();
  assert.equal(found.length, 1);
  assert.equal(found[0].issue, 806);
  assert.equal(found[0].code, 'TASK_IDLE');
  assert.match(found[0].detail, /shown IN PROGRESS \(ACTIVE\) with no moving PR, no live gate assignment and no holder/);
  assert.equal(idle({ lifecycle: 'HOLD' }).length, 1, 'a held task still shown IN PROGRESS is flagged too');
  assert.equal(idle({ gate: { role: 'G1', state: 'RETIRED' } }).length, 1, 'an ended assignment is not a live lane');
});

for (const [name, options] of [
  ['changed less than six hours ago', { hours: 5 }],
  ['with a comment in the last six hours', { hours: 30, comment: 26 }],
  ['with a live gate assignment', { gate: { role: 'G1', state: 'ACTIVE', assignment: { id: 'g1-806', role: 'G1' } } }],
  ['held by a lane', { holder: true }],
  ['with an open PR that names it', { openPr: true }],
  ['with an open PR that changed in the last day', { openPr: true, openPrUpdated: -10 }],
  ['with an open PR in its history', { prs: [{ number: 900, state: 'OPEN', merge_sha: null }] }],
  ['waiting on the owner', { lifecycle: 'WAITING_OWNER' }],
  ['still queued', { lifecycle: 'PLANNED' }],
  ['already finished', { lifecycle: 'DONE' }],
]) test(`a task ${name} is not flagged as idle`, () => {
  assert.deepEqual(idle(options), []);
});

test('a stale open PR no longer hides an idle task', () => {
  assert.equal(state.PR_STALE_HOURS, 24);
  const found = idle({ openPr: true, openPrUpdated: -30 });
  assert.equal(found.length, 1);
  assert.equal(found[0].code, 'TASK_IDLE');
  assert.match(found[0].detail, /open PR #900 has not changed for over 24 hours/);
});

test('a task whose PRs have all merged is on the work queue after one quiet hour', () => {
  assert.equal(state.TASK_MERGED_OPEN_HOURS, 1);
  const found = idle({ merged: true, pr: { number: 900, state: 'MERGED' }, hours: 2 });
  assert.equal(found.length, 1);
  assert.equal(found[0].code, 'TASK_MERGED_OPEN');
  assert.match(found[0].detail, /every PR merged or closed/);
  assert.deepEqual(idle({ merged: true, pr: { number: 900, state: 'MERGED' }, hours: 0.5 }), [], 'under an hour it is still settling');
  assert.deepEqual(idle({ merged: true, pr: { number: 900, state: 'MERGED' }, hours: 2, lifecycle: 'WAITING_OWNER' }), [], 'owner UAT after merge is the owner\'s');
});

const KEEP = { reason: 'Kept open for the owner\'s real-host smoke' };

test('a merged task the controller keeps open on purpose leaves the work queue, and its page says why', () => {
  assert.deepEqual(idle({ merged: true, pr: { number: 900, state: 'MERGED' }, hours: 30, keepOpen: KEEP }), []);
  const f = idleRun({ merged: true, pr: { number: 900, state: 'MERGED' }, hours: 30, keepOpen: KEEP });
  f.reconciler().run({ apply: true });
  const child = f.store.read('child', 806).doc;
  assert.equal(child.private.keep_open.reason, KEEP.reason);
  assert.ok(Number.isFinite(Date.parse(child.private.keep_open.at)), 'the write stamps when it was kept open');
  assert.match(state.renderChildBlockBody(child, { issue: 806, class: 'COMMITTED', order: 1 }), /Kept open: Kept open for the owner's real-host smoke \(since \d{4}-\d\d-\d\d \d\d:\d\dZ\)/);
});

test('keeping a task open settles its TASK_MERGED_OPEN finding, and clearing the mark brings it back', () => {
  const f = idleRun({ merged: true, pr: { number: 900, state: 'MERGED' }, hours: 30 });
  f.reconciler().run({ apply: true });
  const finding = () => f.store.read('parent', 421).doc.attention.find(entry => entry.code === 'TASK_MERGED_OPEN' && entry.issue === 806);
  assert.equal(finding().state, 'new');
  const keep = open => f.store.mutate('child', 806, { writer, parentDoc: f.store.read('parent', 421).doc, change: doc => state.applyPatch('child', doc, { private: { keep_open: open } }, { writer, parentDoc: f.store.read('parent', 421).doc }) });
  keep(KEEP);
  f.time.now += 2 * HOUR;
  f.reconciler().run({ apply: true });
  assert.equal(finding().state, 'resolved', 'an hour after the mark the task is still off the queue (a dismissal comes back here)');
  keep(null);
  f.time.now += 2 * HOUR;
  f.reconciler().run({ apply: true });
  assert.equal(finding().state, 'new');
});

test('a keep-open mark covers only the merges it was set over: a later merge brings the task back and drops the stale reason', () => {
  const f = idleRun({ merged: true, pr: { number: 900, state: 'MERGED' }, hours: 30, keepOpen: KEEP });
  f.reconciler().run({ apply: true });
  const queue = () => f.reconciler().run().findings.filter(finding => state.WORK_QUEUE_CODES.has(finding.code)).map(finding => finding.code);
  const page = () => state.renderChildBlockBody(f.store.read('child', 806).doc, { issue: 806, class: 'COMMITTED', order: 1 });
  assert.deepEqual(queue(), [], 'control: the mark takes slice 1 off the queue');
  assert.deepEqual(f.store.read('child', 806).doc.private.keep_open.covers, [900], 'the write records the merges the mark was set over');
  // Slice 2 merges a day later and the sweep records it in the task's history.
  f.github.addPr(901, { head: SHA_A, branch: 'slice-2', body: 'Refs #806', merged: true, mergedAt: new Date(f.time.now).toISOString() });
  const parentDoc = () => f.store.read('parent', 421).doc;
  f.store.mutate('child', 806, { writer, parentDoc: parentDoc(), change: doc => ({ ...doc, pr: { ...doc.pr, number: 901, state: 'MERGED' },
    prs: [{ number: 901, state: 'MERGED', merge_sha: SHA_A }, { number: 900, state: 'MERGED', merge_sha: SHA_A }] }) });
  assert.deepEqual(f.store.read('child', 806).doc.private.keep_open.covers, [900], 'an unchanged reason keeps what it covered');
  f.time.now += 2 * HOUR;
  assert.deepEqual(queue(), ['TASK_MERGED_OPEN'], 'a merge after the mark is a new condition');
  assert.doesNotMatch(page(), /Kept open:/, 'the page no longer shows the reason set before slice 2');
  // Setting it again with a new reason covers both merges.
  f.store.mutate('child', 806, { writer, parentDoc: parentDoc(), change: doc => state.applyPatch('child', doc, { private: { keep_open: { reason: 'Slice 3 still to come' } } }, { writer, parentDoc: parentDoc() }) });
  assert.deepEqual(f.store.read('child', 806).doc.private.keep_open.covers, [900, 901]);
  f.time.now += 2 * HOUR;
  assert.deepEqual(queue(), []);
  assert.match(page(), /Kept open: Slice 3 still to come/);
});

test('a patch cannot set when a keep-open mark was set or what it covers', () => {
  const f = idleRun({ merged: true, pr: { number: 900, state: 'MERGED' }, hours: 30 });
  const patch = keep => f.store.mutate('child', 806, { writer, parentDoc: f.store.read('parent', 421).doc,
    change: doc => state.applyPatch('child', doc, { private: { keep_open: keep } }, { writer, parentDoc: f.store.read('parent', 421).doc }) });
  const mark = () => f.store.read('child', 806).doc.private.keep_open;
  patch({ reason: 'Waiting on a smoke test', at: '2030-01-01T00:00:00.000Z', covers: [900, 999] });
  const set = mark();
  assert.equal(set.at, new Date(f.time.now).toISOString(), 'a new mark is stamped with the write time');
  assert.deepEqual(set.covers, [900], 'a new mark covers the merges the task holds');
  f.time.now += HOUR;
  patch({ at: '2030-01-01T00:00:00.000Z', covers: [900, 999] });
  assert.deepEqual(mark(), set, 'the same reason keeps its stamps');
});

test('a keep-open reason is drawn on the public page, so it holds no path, address, host or mention', () => {
  const f = idleRun({ merged: true, pr: { number: 900, state: 'MERGED' }, hours: 2 });
  const doc = f.store.read('child', 806).doc;
  const errors = reason => state.validateChild({ ...doc, private: { ...doc.private, keep_open: { reason } } }).filter(error => /private\.keep_open/.test(error));
  assert.deepEqual(errors('Slice 2 still to come'), []);
  for (const bad of ['see C:\\work\\notes', 'ask @someone', 'see build.example.test', 'see https://example.test']) assert.ok(errors(bad).length, bad);
});

test('a task kept open still raises TASK_IDLE when an open PR on it stalls', () => {
  const found = idle({ openPr: true, openPrUpdated: -30, keepOpen: KEEP });
  assert.deepEqual(found.map(entry => entry.code), ['TASK_IDLE']);
});

test('a keep-open mark holds a reason of at most 200 characters, its time and the merges it covers, nothing else', () => {
  const f = idleRun({ merged: true, pr: { number: 900, state: 'MERGED' }, hours: 2 });
  const doc = f.store.read('child', 806).doc;
  const errors = keep => state.validateChild({ ...doc, private: { ...doc.private, keep_open: keep } });
  assert.deepEqual(errors({ reason: 'ok', at: '2026-11-15T12:00:00.000Z' }), []);
  assert.deepEqual(errors({ reason: 'ok' }), [], 'the write stamps the time');
  assert.deepEqual(errors({ reason: 'ok', at: '2026-11-15T12:00:00.000Z', covers: [900, 901] }), []);
  for (const bad of [{ reason: '' }, { reason: 'x'.repeat(201) }, { reason: 'ok', at: 'soon' }, { reason: 'ok', until: 'never' }, 'yes',
    { reason: 'ok', covers: [0] }, { reason: 'ok', covers: [900, 900] }, { reason: 'ok', covers: '900' }]) {
    assert.ok(errors(bad).some(error => /private\.keep_open/.test(error)), JSON.stringify(bad));
  }
});

test('an open PR whose update time cannot be read counts as moving', () => {
  const f = idleRun({ openPr: true });
  f.github.prs.get(900).updated_at = null;
  assert.deepEqual(f.reconciler().run().findings.filter(finding => state.WORK_QUEUE_CODES.has(finding.code)), []);
});

test('merged tracked PRs plus a stale open PR naming the task raise TASK_IDLE, not TASK_MERGED_OPEN', () => {
  const f = idleRun({ merged: true, pr: { number: 900, state: 'MERGED' }, hours: 30 });
  f.github.addPr(901, { head: SHA_A, branch: 'later', body: 'Refs #806' });
  f.github.prs.get(901).updated_at = new Date(START - 2 * HOUR).toISOString();
  const found = f.reconciler().run().findings.filter(finding => state.WORK_QUEUE_CODES.has(finding.code));
  assert.deepEqual(found.map(finding => finding.code), ['TASK_IDLE']);
  assert.match(found[0].detail, /open PR #901 has not changed for over 24 hours/);
});

test('a pass that could not read every open PR raises no work-queue finding', () => {
  const f = idleRun({ merged: true, pr: { number: 900, state: 'MERGED' }, hours: 2 });
  const pass = f.reconciler();
  const parentDoc = f.store.read('parent', 421).doc;
  const docs = new Map([[806, f.store.read('child', 806).doc]]);
  const observed = complete => ({ prGraph: { openComplete: complete }, references: new Map(), prUpdated: new Map(), comments: new Map(), blockedBy: new Map(), issues: new Map() });
  const run = complete => { const findings = []; pass.diffIdle(parentDoc, docs, observed(complete), null, findings); return findings.map(finding => finding.code); };
  assert.deepEqual(run(true), ['TASK_MERGED_OPEN'], 'the same task is flagged when the list was read whole');
  assert.deepEqual(run(false), [], 'an unread open PR could be moving it');
});

test('a task blocked by another open task that is moving is not idle; behind a stalled blocker both are', () => {
  const f = setup({ clock: true, outcomes: [{ issue: 806, class: 'COMMITTED', order: 1 }, { issue: 807, class: 'COMMITTED', order: 2 }] });
  f.github.issues.get(806).blockedBy = [807];
  f.reconciler().run({ apply: true });
  const parentDoc = f.store.read('parent', 421).doc;
  const active = (number, holder) => f.store.mutate('child', number, { writer, parentDoc, change: doc => ({ ...doc, lifecycle: 'ACTIVE', blockers: number === 806 ? ['waiting on #807'] : [],
    ...(holder ? { fence: { ...doc.fence, holder_prefix: 'INT-TK421-', holder_session: 'lane-1' } } : {}) }) });
  active(806, false);
  active(807, true);
  f.time.now = START + 7 * HOUR;
  const queue = () => f.reconciler().run().findings.filter(finding => state.WORK_QUEUE_CODES.has(finding.code)).map(finding => finding.issue).sort();
  assert.deepEqual(queue(), [], 'the blocker carries the work');
  f.time.now = START;
  f.store.mutate('child', 807, { writer, parentDoc, change: doc => ({ ...doc, fence: { ...doc.fence, holder_prefix: null, holder_session: null } }) });
  f.time.now = START + 7 * HOUR;
  assert.deepEqual(queue(), [806, 807], 'a stalled blocker surfaces, and so does the task behind it');
});

for (const [kind, blocker] of [['held by a lane', { lifecycle: 'ACTIVE', fence: { holder_prefix: 'INT-TK421-', holder_session: 'lane-1' } }], ['waiting on the owner', { lifecycle: 'WAITING_OWNER' }]]) test(`a task behind a blocker ${kind} is skipped for seven days, then raised naming the blocker`, () => {
  assert.equal(state.BLOCKED_SKIP_DAYS, 7);
  const f = setup({ clock: true, outcomes: [{ issue: 806, class: 'COMMITTED', order: 1 }, { issue: 807, class: 'COMMITTED', order: 2 }] });
  f.github.issues.get(806).blockedBy = [807];
  f.reconciler().run({ apply: true });
  const parentDoc = f.store.read('parent', 421).doc;
  f.store.mutate('child', 806, { writer, parentDoc, change: doc => ({ ...doc, lifecycle: 'ACTIVE' }) });
  f.store.mutate('child', 807, { writer, parentDoc, change: doc => ({ ...doc, lifecycle: blocker.lifecycle, fence: { ...doc.fence, ...blocker.fence } }) });
  const queue = () => f.reconciler().run().findings.filter(finding => state.WORK_QUEUE_CODES.has(finding.code));
  f.time.now = START + 6 * 24 * HOUR;
  assert.deepEqual(queue(), [], 'under seven days the blocker still carries the work');
  f.time.now = START + 7 * 24 * HOUR;
  const found = queue();
  assert.deepEqual(found.map(finding => [finding.code, finding.issue]), [['TASK_IDLE', 806]], 'the moving blocker itself stays off the queue');
  assert.match(found[0].detail, /; blocked by #807 \(moving\), but unchanged for over 7 days$/);
});

for (const code of ['TASK_IDLE', 'TASK_MERGED_OPEN']) test(`an open ${code} finding stays open and unchanged through a pass that could not read every open PR`, () => {
  const f = code === 'TASK_IDLE' ? idleRun() : idleRun({ merged: true, pr: { number: 900, state: 'MERGED' }, hours: 2 });
  const refresh = () => f.reconciler(VERSION, { refreshFacts: true, writer: state.refreshWriter(f.store.read('parent', 421).doc) }).run({ apply: true });
  refresh();
  const finding = () => f.store.read('parent', 421).doc.attention.find(entry => entry.code === code && entry.issue === 806);
  const before = finding();
  assert.equal(before?.state, 'new', 'control: a refresh that read every open PR raised it');
  // Only the refresh's whole-list read fails, so the pass goes on with openComplete false.
  const request = f.github.request.bind(f.github);
  f.github.request = (method, path, ...rest) => method === 'GET' && /\/pulls\?state=open&per_page=100&sort=updated/.test(path) ? { status: 502, json: null, headers: {} } : request(method, path, ...rest);
  f.time.now += HOUR;
  refresh();
  assert.deepEqual(finding(), before, 'an unread open PR list neither raises nor settles a work-queue finding');
});

test('the parent page counts the work queue and the graph row is the task, its number and NOW · IN PROGRESS', () => {
  const f = idleRun({ merged: true, pr: { number: 900, state: 'MERGED' }, hours: 2 });
  f.reconciler().run({ apply: true });
  const body = f.github.issues.get(421).body;
  assert.match(body, /Attention: \d+ new, 0 acknowledged, 1 in the work queue/);
  assert.doesNotMatch(body, /\*\*Work queue\*\*/, 'CURRENT counts the work queue; the attention command lists it');
  assert.match(body, /^\|Issue 806\|#806\|NOW · IN PROGRESS\|/m);
});

// Blocks that are only shown: an example of a block inside a code fence, a quote, a list item or
// indented code is hand-written text, on every kind of page.

const shownBlock = name => state.renderBlock(name === 'NAV' ? '# PATH\n<!-- programme-nav -->\n#1 > #2' : '<!-- programme-state child=2@1 -->\n# STATUS\n\nAn example.', '3.0.0', name);
const QUOTED = [
  'Before and after of a page block:', '',
  '```md', shownBlock('STATE'), '```', '',
  '~~~', shownBlock('NAV'), '~~~', '',
  ...shownBlock('STATE').split('\n').map(line => `> ${line}`), '',
  '- A list item that shows one:', '',
  ...shownBlock('NAV').split('\n').map(line => `  ${line}`), '',
  ...shownBlock('STATE').split('\n').map(line => `    ${line}`), '',
  'After the examples.',
].join('\n');

test('a PR description that shows STATE and NAV blocks as examples keeps them byte for byte, and gets its own blocks around it', () => {
  const f = setup();
  f.reconciler().run({ apply: true });
  const description = `${QUOTED}\n\nRefs #806`;
  f.github.addPr(900, { head: SHA_A, branch: 'feature', body: description });
  assert.deepEqual(f.reconciler().run({ apply: true }).holds, []);
  const body = f.github.prs.get(900).body;
  const nav = state.findStateBlock(body, 'NAV').block, status = state.findStateBlock(body, 'STATE').block;
  assert.equal(body.slice(nav.end, status.start), `\n\n${description}\n\n`, 'the description, examples included, is exactly what was written');
  assert.match(nav.body, /#421 > #806 > PR #900/);
  assert.match(status.body, /programme-pr-status pr=900/);
  assert.ok(nav.start === 0 && status.start > body.indexOf('After the examples.'), 'PATH sits above the description and STATUS below it');
  const pass = f.reconciler().run();
  assert.equal(pass.effects.filter(effect => effect.kind === 'replace_pr_nav').length, 0, 'the PR page settles');
  assert.equal(pass.findings.some(finding => finding.code === 'MANAGED_BLOCK_BROKEN'), false);
});

test('a PR page with real blocks is still updated in place, examples or not', () => {
  const f = setup({ outcomes: [{ issue: 806, class: 'COMMITTED', order: 1 }, { issue: 807, class: 'COMMITTED', order: 2 }] });
  f.reconciler().run({ apply: true });
  f.github.addPr(900, { head: SHA_A, branch: 'feature', body: `${QUOTED}\n\nRefs #806` });
  f.reconciler().run({ apply: true });
  const first = f.github.prs.get(900).body;
  f.github.prs.get(900).body = `${first}\nRefs #807`;
  assert.deepEqual(f.reconciler().run({ apply: true }).holds, []);
  const body = f.github.prs.get(900).body;
  assert.match(state.findStateBlock(body, 'NAV').block.body, /#421 > #807 > PR #900/);
  assert.match(state.findStateBlock(body, 'STATE').block.body, /- #807: /);
  // The line added under the old STATUS block joins the description with one blank line between.
  assert.ok(body.includes(`:END NAV -->\n\n${QUOTED}\n\nRefs #806\n\nRefs #807\n\n<!-- AI-AGENT-TOOLKIT:programme-state:BEGIN STATE `), 'only the real blocks changed, and STATUS moved back under the added line');
  assert.equal(body.split(':BEGIN NAV ').length - 1, 3, 'one real PATH block and the two examples: no second real block was added');
});

for (const [name, options, relaid] of [
  ['an open task (laid out)', {}, true],
  ['a closed task (blocks in place)', { closed: [806] }, false],
  ['a held page (blocks in place)', { tail: '\n\n<details>\nnever closed\n' }, false],
]) test(`blocks shown as examples on ${name} stay as written, and the page settles`, () => {
  const page = `# PROBLEM\n\n${QUOTED}${options.tail || '\n'}`;
  const f = setup({ bodies: { 806: page }, closed: options.closed || [] });
  const report = f.reconciler().run({ apply: true });
  assert.deepEqual(report.holds.filter(hold => hold.code !== 'CLOSED_WITHOUT_ACCEPTANCE'), []);
  const body = f.github.issues.get(806).body;
  assert.ok(body.includes(QUOTED), 'every example is byte for byte what was written');
  for (const block of ['NAV', 'STATE', 'TRACE']) {
    const found = state.findStateBlock(body, block);
    assert.equal(found.error, undefined, `${block}: ${found.error}`);
    assert.ok(found.block && !QUOTED.includes(found.block.raw ?? body.slice(found.block.start, found.block.end)), `${block} is the page's own block, not an example`);
  }
  if (relaid) assert.equal(layout.inOrder(body), true);
  else assert.equal(body.includes('# More'), false);
  const again = f.reconciler().run();
  assert.deepEqual(again.effects.filter(effect => effect.target.issue === 806), [], 'the page is not rewritten every pass');
  assert.equal(again.findings.some(finding => finding.code === 'MANAGED_BLOCK_BROKEN'), false);
  // A later change updates the real blocks only.
  f.github.addComment(806, { body: 'Scope\n---\nA new decision' });
  assert.deepEqual(f.reconciler().run({ apply: true }).holds.filter(hold => hold.code !== 'CLOSED_WITHOUT_ACCEPTANCE'), []);
  assert.ok(f.github.issues.get(806).body.includes(QUOTED));
  assert.equal(f.reconciler().run().findings.some(finding => finding.code === 'MANAGED_BLOCK_BROKEN'), false);
});

test('the block search reads only top-level blocks; the order check and the text check agree with it', () => {
  const real = state.renderBlock('<!-- programme-state child=806@1 -->\n# STATUS\n\nReal.', VERSION);
  const page = `${QUOTED}\n\n${real}\n`;
  const found = state.findStateBlock(page).block;
  assert.equal(page.slice(found.start, found.end), real, 'the real block is found, not the first example');
  assert.equal(state.findStateBlock(QUOTED).block, null, 'examples alone are no block');
  assert.equal(state.findStateBlock(QUOTED, 'NAV').block, null);
  assert.ok(state.findStateBlock(QUOTED, 'STATE', { literal: true }).error || state.findStateBlock(QUOTED, 'STATE', { literal: true }).block, 'the literal search still sees the first example');
  assert.equal(layout.withoutBlocks(page).trim(), QUOTED, 'only the real block is taken out of the text');
  const laid = lay(`# PROBLEM\n\n${QUOTED}\n`).body;
  assert.equal(layout.inOrder(laid), true);
  assert.equal(lay(laid).body, laid);
  assert.ok(laid.includes(QUOTED));
  // Half an example (a BEGIN line alone) does not swallow the END line of the real block below it.
  const half = `\`\`\`\n${shownBlock('STATE').split('\n')[0]}\n\`\`\`\n\n${real}\n`;
  assert.equal(half.slice(state.findStateBlock(half).block.start, state.findStateBlock(half).block.end), real);
  // A block written straight under a line of HTML is still the page's own block.
  const under = `<p align="center">Logo</p>\n${real}\n\nText.\n`;
  assert.equal(under.slice(state.findStateBlock(under).block.start, state.findStateBlock(under).block.end), real);
  // A page whose code block never ends is read as before: a real block below it is still found, so
  // no second one is added.
  const open = `Intro.\n\n\`\`\`\nnever closed\n\n${real}\n`;
  assert.ok(state.findStateBlock(open).block);
  assert.equal(state.upsertStateBlock(open, state.renderBlock('New.', VERSION)).body.split(':BEGIN STATE ').length - 1, 1);
});

// What the plan and the result say about a page whose text moves.

test('a page that will be laid out says so in the plan, and its result names the saved copy', () => {
  const f = setup({ bodies: { 806: OLD_PAGE } });
  const dry = f.reconciler().run();
  const planned = dry.effects.find(effect => effect.kind === 'replace_block' && effect.target.issue === 806);
  assert.equal(planned.text, "Lay out #806's page in the fixed order (PATH, TASK, PLAN, PR GRAPH, AGENT CONTEXT, then the hand-written text); its hand-written text moves, and a copy of the page is saved first");
  assert.ok(dry.findings.some(finding => finding.code === 'PROJECTION_STALE' && finding.issue === 806 && finding.detail === 'the page is not in the fixed section order'), 'the finding names the order on first contact too');
  const report = f.reconciler().run({ apply: true });
  const result = report.results.find(entry => entry.kind === 'replace_block' && entry.target.issue === 806);
  assert.equal(result.outcome, 'DONE');
  assert.match(result.text, /^Lay out #806's page in the fixed order/);
  const copy = decodeURIComponent(f.copies()[0].path.split('/contents/')[1].split('?')[0]);
  assert.equal(result.detail, `the page was laid out in the fixed order; the page as it was is saved at ${copy} in the private store`);

  // A page already in order is an ordinary block update: no lay-out wording, no copy named.
  f.github.addComment(806, { body: 'Scope\n---\nA new decision' });
  const later = f.reconciler().run({ apply: true });
  const update = later.results.find(entry => entry.kind === 'replace_block' && entry.target.issue === 806);
  assert.doesNotMatch(update.text, /Lay out/);
  assert.equal(update.detail, undefined);
  assert.equal(later.findings.some(finding => /fixed section order/.test(finding.detail || '')), false);
});

test('a page whose text stays where it is never claims a lay-out: closed tasks and pages past the ten-page limit', () => {
  const closed = setup({ bodies: { 806: OLD_PAGE }, closed: [806] });
  const plan = closed.reconciler().run();
  assert.doesNotMatch(plan.effects.find(effect => effect.kind === 'replace_block' && effect.target.issue === 806).text, /Lay out/);
  assert.equal(plan.findings.some(finding => /fixed section order/.test(finding.detail || '')), false);

  const outcomes = Array.from({ length: 12 }, (unused, index) => ({ issue: 500 + index, class: 'COMMITTED', order: index + 1 }));
  const f = setup({ outcomes, bodies: Object.fromEntries(outcomes.map(outcome => [outcome.issue, OLD_PAGE])) });
  const report = f.reconciler().run({ apply: true });
  const pages = report.results.filter(entry => entry.kind === 'replace_block' && entry.target.issue !== 421);
  const laid = pages.filter(entry => /^Lay out /.test(entry.text));
  const waiting = pages.filter(entry => !/^Lay out /.test(entry.text));
  assert.equal(laid.length, 10);
  assert.equal(waiting.length, 2);
  for (const entry of laid) assert.match(entry.detail, /saved at state\/acme\/app\/page-copies\/issue-\d+\/[0-9a-f]{64}\.md in the private store$/);
  for (const entry of waiting) {
    assert.equal(layout.inOrder(f.github.issues.get(entry.target.issue).body), false);
    assert.equal(entry.detail, 'the blocks were updated where they are; the page is laid out in a later pass (at most 10 pages are laid out per pass)');
  }
});

// A block the pass writes is always found again by the next pass: where the block goes is read
// from the same top-level view of the page as the block search, and a last check before every
// write holds the page when a block would not be read back.

// Every BEGIN line with this name, wherever it sits: an independent count of what is on the page.
const rawBlocks = body => Object.fromEntries(['NAV', 'STATE', 'TRACE', 'CURRENT', 'CONTEXT'].map(name => [name, body.split(/\r?\n/).filter(line => line.startsWith(`<!-- AI-AGENT-TOOLKIT:programme-state:BEGIN ${name} `)).length]).filter(([, count]) => count));
const TASK_ONCE = { NAV: 1, STATE: 1, TRACE: 1 };
const PARENT_ONCE = { STATE: 1, CURRENT: 1, CONTEXT: 1 };
// Where the first `# ` line of the page (the place a block would be put) can hide.
const ANCHORS = {
  'a details section': '<details><summary>Plan</summary>\n\n# Title\n\nPlan text.\n\n</details>\n\nBelow.\n',
  'a details section with no blank line': '<details>\n# Title\nPlan text.\n</details>\n\nBelow.\n',
  'a pre block': '<pre>\n# install first\nnpm ci\n</pre>\n\nBelow.\n',
  'a textarea block': '<textarea>\n# Title\n</textarea>\n\nBelow.\n',
  'a script block': '<script>\n# Title\n</script>\n\nBelow.\n',
  'an HTML block': '<div>\n# Title\n</div>\n\nBelow.\n',
  'a comment that is never closed': 'Intro.\n\n<!-- TODO\n# Title\n\nBelow.\n',
  'a comment that is never closed, on the last line': '# Title\n\nBelow.\n\n<!-- TODO\n',
  'a code block that is never closed': 'Intro.\n\n```\n# Title\n\nBelow.\n',
  'a details section that is never closed': 'Intro.\n\n<details>\n# Title\n\nBelow.\n',
  'a pre block that is never closed': 'Intro.\n\n<pre>\n# Title\n\nBelow.\n',
  'indented code on the first line': '    # not a heading\n    code\n\n# Title\n\nBelow.\n',
  'the top level (control)': '# Title\n\nBelow.\n',
};
const threePasses = (f, read, expected, label) => {
  const sizes = [];
  for (let pass = 1; pass <= 3; pass += 1) {
    const report = f.reconciler().run({ apply: true });
    assert.deepEqual(report.holds.filter(hold => hold.code !== 'CLOSED_WITHOUT_ACCEPTANCE'), [], `${label}, pass ${pass}`);
    assert.deepEqual(rawBlocks(read()), expected, `${label}: one block of each name after pass ${pass}`);
    sizes.push(read().length);
  }
  assert.equal(new Set(sizes).size, 1, `${label}: the page stops changing after the first pass (${sizes.join(', ')})`);
  const plan = f.reconciler().run();
  assert.deepEqual(plan.effects, [], `${label}: the next pass plans nothing`);
  assert.equal(plan.findings.some(finding => finding.code === 'MANAGED_BLOCK_BROKEN'), false, label);
};

for (const [where, page] of Object.entries(ANCHORS)) {
  test(`a task page whose first heading line is inside ${where} gets one block of each name and settles`, () => {
    for (const [kind, options, body] of [
      ['closed task', { closed: [806] }, page],
      ['open task', {}, page],
      ['open task held for a section written twice', {}, `${page}\n# PROBLEM\n\nOne.\n\n# PROBLEM\n\nTwo.\n`],
      ['open task held for a secret-shaped value', {}, `${page}\ntoken ghp_${'A1b2'.repeat(9)}\n`],
    ]) {
      // A section written twice cannot follow a block that never closes: that page is one held page already.
      const f = setup({ bodies: { 806: body }, closed: options.closed || [] });
      threePasses(f, () => f.github.issues.get(806).body, TASK_ONCE, `${kind}, ${where}`);
      const text = layout.withoutBlocks(f.github.issues.get(806).body);
      for (const line of body.split('\n').filter(entry => entry.trim())) assert.ok(text.includes(line), `${kind}, ${where}: "${line}" is still on the page`);
    }
  });

  test(`the programme page with its first heading line, or the section the binding names, inside ${where} gets one block of each name and settles`, () => {
    for (const [kind, projection, body] of [
      ['first heading', null, page],
      ['after_section', { after_section: 'Title' }, page],
      ['replace_section', { replace_section: 'Title' }, page],
      ['after_section, with a top-level heading of another name', { after_section: 'Title' }, `# Programme\n\n${page}`],
    ]) {
      const f = setup();
      f.github.issues.get(421).body = body;
      if (projection) f.binding.projection = projection;
      threePasses(f, () => f.github.issues.get(421).body, PARENT_ONCE, `${kind}, ${where}`);
      assert.deepEqual(rawBlocks(f.github.issues.get(806).body), TASK_ONCE);
    }
  });

  test(`a PR description that starts inside ${where} gets PATH and STATUS once and settles`, () => {
    const f = setup();
    f.reconciler().run({ apply: true });
    f.github.addPr(900, { head: SHA_A, branch: 'feature', body: `${page}\nRefs #806` });
    threePasses(f, () => f.github.prs.get(900).body, { NAV: 1, STATE: 1 }, where);
    const body = f.github.prs.get(900).body;
    const description = `${page}\nRefs #806`;
    // A description that ends inside an open block keeps STATUS on top, where no block can swallow it.
    if (layout.markdownLines(description).unfinished) assert.ok(body.endsWith(`-->\n\n${description}`), 'the description is exactly what was written');
    else assert.ok(body.includes(`:END NAV -->\n\n${description}\n\n<!-- AI-AGENT-TOOLKIT:programme-state:BEGIN STATE `) && body.endsWith(':END STATE -->\n'), 'the description is exactly what was written, between PATH and STATUS');
  });
}

test('a section the binding names ends at a real block, never at a marker line shown inside it', () => {
  const example = `\`\`\`\n${shownBlock('STATE')}\n\`\`\``;
  const body = `# Programme\n\n## Notes\n\n${example}\n\nAfter the example.\n\n## Later\n\nTail.\n`;
  const f = setup();
  f.github.issues.get(421).body = body;
  f.binding.projection = { after_section: 'Notes' };
  threePasses(f, () => f.github.issues.get(421).body, { ...PARENT_ONCE, STATE: 2 }, 'example inside the named section');
  assert.ok(f.github.issues.get(421).body.includes(`${example}\n\nAfter the example.`), 'the example and the rest of the section stay together');
  // The placement itself: the block goes after the whole section, not in front of the example's marker line.
  const rendered = state.renderBlock('Real.', VERSION);
  const placed = state.upsertStateBlock(body, rendered, { after_section: 'Notes' }).body;
  assert.equal(placed, body.replace('After the example.\n\n', `After the example.\n\n${rendered}\n\n`));
  assert.equal(state.upsertStateBlock(placed, rendered, { after_section: 'Notes' }).body, placed);
  const replaced = state.upsertStateBlock(body, rendered, { replace_section: 'Notes' }).body;
  assert.equal(replaced, `# Programme\n\n${rendered}\n\n## Later\n\nTail.\n`, 'replace_section takes the whole section, example included');
});

test('a Toolkit marker line ends a comment left open above it, as a browser reads it: the block below is the real one', () => {
  const real = state.renderBlock('<!-- programme-state child=806@1 -->\n# STATUS\n\nReal.', VERSION);
  const open = `Intro.\n\n<!-- TODO\nhidden words\n${real}\n\nAfter.\n`;
  const found = state.findStateBlock(open);
  assert.equal(open.slice(found.block.start, found.block.end), real);
  assert.equal(layout.markdownLines(open).unfinished, false, 'the comment ended at the marker line');
  // A marker line does not end a code block, a pre block or a details section.
  for (const [start, end] of [['```', '```'], ['<pre>', '</pre>'], ['<details>', '</details>']]) {
    assert.equal(state.findStateBlock(`${start}\n${real}\n${end}\n`).block, null, start);
  }
});

test('the links block keeps the indent of the first line below it', () => {
  const nav = state.renderBlock(state.renderNavBlockBody([421, 806], null), VERSION, 'NAV');
  assert.equal(state.upsertNavBlock('\n\n    code line\n\nText.\n', nav), `${nav}\n\n    code line\n\nText.\n`);
  assert.equal(state.upsertNavBlock('   \n', nav), `${nav}\n`);
});

test('the last check before a write: a block that would not be read back holds the page and nothing is written to it', () => {
  const real = state.renderBlock('Body.', VERSION);
  const nav = state.renderBlock('Links.', VERSION, 'NAV');
  assert.equal(state.assertBlocksReadBack(`${nav}\n\n${real}\n`, [['NAV', 'Links.'], ['STATE', 'Body.'], ['TRACE', null]], '#1'), `${nav}\n\n${real}\n`);
  for (const [name, body, why] of [
    ['a block inside a code block', `${nav}\n\n\`\`\`\n${real}\n\`\`\`\n`, /the STATE block cannot be written where the next pass would read it back, so nothing was written/],
    ['a block inside a details section', `${nav}\n\n<details>\n${real}\n</details>\n`, /the STATE block cannot be written/],
    ['a block that is missing', `${nav}\n`, /the STATE block cannot be written/],
    ['a block written twice', `${nav}\n\n${real}\n\n${real}\n`, /duplicate STATE block/],
    ['a block with other content', `${nav}\n\n${state.renderBlock('Other.', VERSION)}\n`, /the STATE block cannot be written/],
    ['a BEGIN line without its END', `${nav}\n\n${real.split('\n')[0]}\nBody.\n`, /BEGIN without END/],
  ]) {
    assert.throws(() => state.assertBlocksReadBack(body, [['NAV', 'Links.'], ['STATE', 'Body.']], '#1'), error => error.code === 'MANAGED_BLOCK_BROKEN' && why.test(error.message) && /^#1: /.test(error.message), name);
  }

  // In a pass: a layout that put the blocks where they cannot be read (forced here) is refused
  // before the saved copy and before the page write; other pages are still written.
  const file = require.resolve('../../skills/github-program-reconciler/scripts/programme-page-layout.cjs');
  const original = require.cache[file].exports;
  const f = setup({ outcomes: [{ issue: 806, class: 'COMMITTED', order: 1 }, { issue: 807, class: 'COMMITTED', order: 2 }], bodies: { 806: OLD_PAGE, 807: '# PROBLEM\n\nFine.\n' } });
  require.cache[file].exports = { ...original, layoutTaskPage: (source, generated, version) => {
    const laid = original.layoutTaskPage(source, generated, version);
    return source === OLD_PAGE ? { ...laid, body: `<details>\n${laid.body}\n</details>\n` } : laid;
  } };
  try {
    for (let pass = 1; pass <= 2; pass += 1) {
      const report = f.reconciler().run({ apply: true });
      const held = report.holds.filter(hold => hold.code === 'MANAGED_BLOCK_BROKEN');
      assert.equal(held.length, 1, JSON.stringify(report.holds));
      assert.match(JSON.stringify(held[0]), /#806: the NAV block cannot be written where the next pass would read it back, so nothing was written to this page/);
      assert.equal(f.github.issues.get(806).body, OLD_PAGE, 'the held page is untouched');
      assert.equal(f.bodyWrites(806).length, 0);
      assert.equal(f.copies().filter(call => call.path.includes('issue-806-')).length, 0, 'no copy is saved for a page that is not written');
      assert.deepEqual(rawBlocks(f.github.issues.get(807).body), TASK_ONCE, 'the other page is written as usual');
    }
  } finally { require.cache[file].exports = original; }
  assert.deepEqual(f.reconciler().run({ apply: true }).holds, []);
  assert.equal(layout.inOrder(f.github.issues.get(806).body), true, 'with the fault gone the page is laid out');
});

// Pages built from ordinary Markdown pieces, written in place and laid out several times with the
// same block contents: every page stops changing after the first write and holds one block of each
// name. The pieces include the shapes a block could be hidden by.
test('generated pages settle after one write with one block of each name', () => {
  let seed = 840;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  const pick = list => list[Math.floor(random() * list.length)];
  const closedPieces = ['Some plain words here.', '# A title', '## A section', '**The problem:** Something is off.', '- one\n- two\n  continued', '> quoted words\n> # not a heading',
    '    # not a heading\n    code', '```\n# not a heading\ncode\n```', '<details><summary>More</summary>\n\nHidden words.\n\n</details>', '<details><summary>Plan</summary>\n\n# Plan title\n\nText.\n\n</details>',
    '<pre>\n# install first\nnpm ci\n</pre>', '<!-- a note -->', '<!--\nhidden\n# not a heading\n-->', '<div align="center">Logo</div>', '| a | b |\n|---|---|\n| 1 | 2 |', '<textarea>\n# Draft\n</textarea>'];
  const openPieces = ['```\nnever closed', '<details>\nnever closed', '<pre>\nnever closed', '<!-- never closed'];
  const blocks = [['NAV', state.renderNavBlockBody([421, 806], null)], ['STATE', '<!-- programme-state child=806@1 -->\n# STATUS\n\nStatus lines.'], ['TRACE', '# DECISIONS\n<!-- programme-trace issue=806 -->\n- No comments yet.']];
  const inPlace = source => {
    const withState = state.upsertStateBlock(source, state.renderBlock(blocks[1][1], VERSION), {}).body;
    const withNav = state.upsertNavBlock(withState, state.renderBlock(blocks[0][1], VERSION, 'NAV'));
    const trace = state.renderBlock(blocks[2][1], VERSION, 'TRACE');
    const found = state.findStateBlock(withNav, 'TRACE').block;
    const eol = withNav.includes('\r\n') ? '\r\n' : '\n';
    const block = trace.replace(/\n/g, eol);
    return state.assertBlocksReadBack(found ? withNav.slice(0, found.start) + block + withNav.slice(found.end) : `${withNav}${withNav.endsWith(eol) ? eol : `${eol}${eol}`}${block}${eol}`, blocks, '#806');
  };
  const write = source => { try { return layout.layoutTaskPage(source, blocks, VERSION).body; } catch (error) { if (error.code !== 'PAGE_LAYOUT_HELD') throw error; return inPlace(source); } };
  let pages = 0;
  for (let at = 0; at < 1500; at += 1) {
    const pieces = Array.from({ length: 1 + Math.floor(random() * 5) }, () => pick(closedPieces));
    if (random() < 0.3) pieces.push(pick(openPieces));
    // Every fifth page uses Windows line endings.
    const page = `${pieces.join('\n\n')}\n`.replace(/\n/g, at % 5 ? '\n' : '\r\n');
    for (const [kind, run] of [['in place', inPlace], ['laid out, else in place', write]]) {
      const first = run(page);
      assert.deepEqual(rawBlocks(first), TASK_ONCE, `${kind}: ${JSON.stringify(page)}`);
      assert.equal(run(first), first, `${kind}, second write: ${JSON.stringify(page)}`);
      pages += 1;
    }
  }
  assert.equal(pages, 3000);
});
