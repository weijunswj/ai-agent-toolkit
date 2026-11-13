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

test('a task page is laid out as PATH, STATUS, DECISIONS, the capital sections in their fixed order, then More', () => {
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

test('a comment that runs over several lines hides headings until it ends, at either end form', () => {
  for (const end of ['-->', '--!>']) {
    const page = `Lead.\n\n<!-- note\n# PROBLEM\nstill a comment ${end}\n\n# FIX\n\nReal.\n`;
    const result = lay(page);
    assert.deepEqual(result.sections, ['FIX'], end);
    assert.equal(afterBlocks(result.body), `\n\n# FIX\n\nReal.\n\n# More\n\nLead.\n\n<!-- note\n# PROBLEM\nstill a comment ${end}\n`, end);
  }
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

const idleRun = ({ lifecycle = 'ACTIVE', gate = null, pr = null, prs = null, holder = false, openPr = false, openPrUpdated = null, merged = false, hours = 7, comment = null } = {}) => {
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

test('the parent page lists the work queue first and the graph says the shown PR merged', () => {
  const f = idleRun({ merged: true, pr: { number: 900, state: 'MERGED' }, hours: 2 });
  f.reconciler().run({ apply: true });
  const body = f.github.issues.get(421).body;
  assert.match(body, /Attention: \d+ new, 0 acknowledged, 1 in the work queue/);
  assert.match(body, /\*\*Work queue\*\* \(the controller acts on each now\)\n- TASK_MERGED_OPEN #806/);
  assert.match(body, /\|#806\|#900 merged\|NOW\|IN PROGRESS\|/);
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

test('a PR description that shows STATE and NAV blocks as examples keeps them byte for byte, and gets its own blocks on top', () => {
  const f = setup();
  f.reconciler().run({ apply: true });
  const description = `${QUOTED}\n\nRefs #806`;
  f.github.addPr(900, { head: SHA_A, branch: 'feature', body: description });
  assert.deepEqual(f.reconciler().run({ apply: true }).holds, []);
  const body = f.github.prs.get(900).body;
  assert.ok(body.endsWith(`-->\n\n${description}`), 'the description, examples included, is exactly what was written');
  const nav = state.findStateBlock(body, 'NAV').block, status = state.findStateBlock(body, 'STATE').block;
  assert.match(nav.body, /#421 > #806 > PR #900/);
  assert.match(status.body, /programme-pr-status pr=900/);
  assert.ok(nav.start === 0 && status.end < body.indexOf('Before and after'), 'the real blocks sit above the description');
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
  assert.match(state.findStateBlock(body, 'STATE').block.body, /- Task #807: /);
  assert.ok(body.endsWith(`-->\n\n${QUOTED}\n\nRefs #806\nRefs #807`), 'only the real blocks changed');
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
  assert.equal(planned.text, "Lay out #806's page in the fixed order (PATH, STATUS, DECISIONS, the capital sections, then More); its hand-written text moves, and a copy of the page is saved first");
  assert.ok(dry.findings.some(finding => finding.code === 'PROJECTION_STALE' && finding.issue === 806 && finding.detail === 'the page is not in the fixed section order'), 'the finding names the order on first contact too');
  const report = f.reconciler().run({ apply: true });
  const result = report.results.find(entry => entry.kind === 'replace_block' && entry.target.issue === 806);
  assert.equal(result.outcome, 'DONE');
  assert.match(result.text, /^Lay out #806's page in the fixed order/);
  const copy = decodeURIComponent(f.copies()[0].path.split('/contents/')[1].split('?')[0]);
  assert.equal(result.detail, `the page was laid out in the fixed order; the page as it was is saved at ${copy} in the state store`);

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
  for (const entry of laid) assert.match(entry.detail, /saved at state\/acme\/app\/page-copies\/issue-\d+-[0-9a-f]{16}\.json in the state store$/);
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
const PARENT_ONCE = { STATE: 1, TRACE: 1, CURRENT: 1, CONTEXT: 1 };
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
    assert.ok(f.github.prs.get(900).body.endsWith(`-->\n\n${page}\nRefs #806`), 'the description is exactly what was written');
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
