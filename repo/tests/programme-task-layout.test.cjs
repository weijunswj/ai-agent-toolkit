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
  ['STATE', '<!-- programme-state child=806@1 -->\n# STATUS\n\nStatus lines.'],
  ['TRACE', '# COMMENT TRACE\n<!-- programme-trace issue=806 -->\n- No comments yet.'],
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
  const reconciler = (version = VERSION) => new state.Reconciler({
    store, reader: new state.ProgrammeGraphReader({ transport: github, repository }),
    mutator: new state.GitHubMutator({ transport: github, repository }), binding, writer, toolkitVersion: version,
    ...(clock ? { now } : {}),
  });
  const copies = () => github.calls.filter(call => call.method === 'PUT' && call.path.includes('page-copies'));
  const bodyWrites = number => github.calls.filter(call => call.method === 'PATCH' && call.path.endsWith(`/issues/${number}`));
  return { github, store, binding, reconciler, time, copies, bodyWrites };
}

test('a task page is laid out as PATH, STATUS, COMMENT TRACE, the capital sections in their fixed order, then More', () => {
  const result = lay(OLD_PAGE);
  assert.deepEqual([...result.body.matchAll(/programme-state:BEGIN (\w+)/g)].map(match => match[1]), ['NAV', 'STATE', 'TRACE']);
  assert.equal(afterBlocks(result.body), [
    '', '',
    '# PROBLEM', '', 'Pages differ.', '',
    '# FIX', '', 'One layout.', '', '```', '# PROBLEM inside code', '```', '',
    '# IF WE SKIP', '', 'Nothing lines up.', '',
    '# DONE WHEN', '', '- [ ] a', '',
    '# NOT IN SCOPE', '', 'Closed tasks.', '',
    '# More', '', '# Title', '', 'Intro.', '', '## Notes', '', 'Keep me.', '',
  ].join('\n'), 'old labels and headings become the capital sections; everything else follows under More in its own order');
  assert.deepEqual(result.sections, ['PROBLEM', 'FIX', 'IF WE SKIP', 'DONE WHEN', 'NOT IN SCOPE']);
  assert.equal(result.moves, true);
  assert.equal(layout.MORE_HEADING, 'More', 'the optional heading is sentence case; generated and required ones are capitals');
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
    const kept = words(afterBlocks(result.body)).join(' ');
    for (const line of page.split(/\r?\n/).map(line => line.trim()).filter(Boolean)) {
      // A label line becomes its heading; its words after the label stay.
      const label = /^(?:\*\*[^*]+:\*\*|#{1,2} (?:the problem|the fix|done when|not in scope|if we skip(?: it)?))\s*(.*)$/i.exec(line);
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
  assert.equal(afterBlocks(result.body), `\n\n# More\n\n${page}`);
});

test('a section runs to the next section; a heading of the same or a higher level that is not a section ends it', () => {
  const result = lay('## The problem\n\nA.\n\n### Detail\n\nStill the problem.\n\n## Other heading\n\nNot the problem.\n');
  assert.equal(afterBlocks(result.body), '\n\n# PROBLEM\n\nA.\n\n### Detail\n\nStill the problem.\n\n# More\n\n## Other heading\n\nNot the problem.\n');
});

test('a block that sits inside a section does not end the section', () => {
  const stateBlock = state.renderBlock(GENERATED[1][1], VERSION);
  const result = lay(`# PROBLEM\n\n${stateBlock}\n\nThe words of the problem.\n\n# FIX\n\nThe fix.\n`);
  assert.equal(afterBlocks(result.body), '\n\n# PROBLEM\n\nThe words of the problem.\n\n# FIX\n\nThe fix.\n');
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
  assert.match(copy[0].path, /state\/acme\/app\/page-copies\/issue-806-[0-9a-f]{16}\.json/);
  assert.ok(f.github.calls.indexOf(copy[0]) < f.github.calls.indexOf(f.bodyWrites(806)[0]), 'the copy is written before the page');
  const saved = f.github.readFile(decodeURIComponent(copy[0].path.split('/contents/')[1].split('?')[0]));
  assert.equal(saved.body, OLD_PAGE, 'the copy holds the page exactly as it was');
  assert.equal(saved.issue, 806);
  const body = f.github.issues.get(806).body;
  assert.equal(layout.inOrder(body), true);
  assert.match(body, /^<!-- AI-AGENT-TOOLKIT:programme-state:BEGIN NAV [^\n]*\n# PATH\n<!-- programme-nav -->\n#421 > #806\n/);
  assert.match(body, /\n# PROBLEM\n\nPages differ\.\n\n# FIX\n/);
  assert.match(body, /\n# More\n\n# Title\n\nIntro\.\n\n## Notes\n\nKeep me\.\n$/);
  assert.equal(f.reconciler().run().summary, 'No changes');

  // Later passes update blocks in place and need no further copy.
  f.github.addComment(806, { body: 'A new comment' });
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
  assert.match(body, /\n# PROBLEM\n\nNew\.\n$/);
});

test('every open PR that names a task gets PATH and STATUS on top; its description stays as written', () => {
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
  assert.match(body, /- Task #806: gate [^\n]*; review [^\n]*; UAT [^\n]*; release [^\n]*\n- Task #807: /);
  assert.ok(body.endsWith('-->\n\nLayout work.\n\nRefs #806\nRefs #807'), 'the description below the blocks is byte for byte what was written');
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
  f.github.addComment(806, { body: 'A new comment' });
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

const idle = ({ lifecycle = 'ACTIVE', gate = null, pr = null, prs = null, holder = false, openPr = false, hours = 7, comment = null } = {}) => {
  const f = setup({ clock: true });
  f.reconciler().run({ apply: true });
  const parentDoc = f.store.read('parent', 421).doc;
  f.store.mutate('child', 806, { writer, parentDoc, change: doc => {
    const next = { ...doc, lifecycle, ...(pr ? { pr: { ...doc.pr, ...pr } } : {}), ...(prs ? { prs } : {}), ...(lifecycle === 'DONE' ? { completed_at: new Date(START).toISOString() } : {}) };
    if (gate) next.gate = { ...next.gate, ...gate };
    if (holder) next.fence = { ...next.fence, holder_prefix: 'INT-TK421-', holder_session: 'lane-1' };
    return next;
  } });
  if (openPr) f.github.addPr(900, { head: SHA_A, branch: 'feature', body: 'Refs #806' });
  if (comment !== null) f.github.addComment(806, { body: 'A note', createdAt: new Date(START + comment * HOUR).toISOString() });
  f.time.now = START + hours * HOUR;
  return f.reconciler().run().findings.filter(finding => finding.code === 'TASK_IDLE');
};

test('a task shown IN PROGRESS with no open PR, no live gate, no holder and no change for six hours is flagged', () => {
  assert.equal(state.TASK_IDLE_HOURS, 6);
  const found = idle();
  assert.equal(found.length, 1);
  assert.equal(found[0].issue, 806);
  assert.match(found[0].detail, /shown IN PROGRESS \(ACTIVE\) with no open PR, no live gate assignment and no holder/);
  assert.equal(idle({ lifecycle: 'HOLD' }).length, 1, 'a held task still shown IN PROGRESS is flagged too');
  assert.equal(idle({ gate: { role: 'G1', state: 'RETIRED' } }).length, 1, 'an ended assignment is not a live lane');
});

for (const [name, options] of [
  ['changed less than six hours ago', { hours: 5 }],
  ['with a comment in the last six hours', { hours: 30, comment: 26 }],
  ['with a live gate assignment', { gate: { role: 'G1', state: 'ACTIVE', assignment: { id: 'g1-806', role: 'G1' } } }],
  ['held by a lane', { holder: true }],
  ['with an open PR that names it', { openPr: true }],
  ['with an open PR in its history', { prs: [{ number: 900, state: 'OPEN', merge_sha: null }] }],
  ['waiting on the owner', { lifecycle: 'WAITING_OWNER' }],
  ['still queued', { lifecycle: 'PLANNED' }],
  ['already finished', { lifecycle: 'DONE' }],
]) test(`a task ${name} is not flagged as idle`, () => {
  assert.deepEqual(idle(options), []);
});
