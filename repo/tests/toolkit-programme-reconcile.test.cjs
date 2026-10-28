'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const state = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');
const cli = require('../../skills/github-program-reconciler/scripts/programme.cjs');
const { FakeGitHub } = require('./toolkit-programme-fake-github.cjs');
const { gatedChild } = require('./toolkit-programme-fake-github.cjs');

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const writer = { session: 'controller-1', prefix: 'INT-TK421-' };
const green = name => ({ kind: 'CheckRun', name, status: 'COMPLETED', conclusion: 'SUCCESS', required: false });

const CATALOGUE = [
  { issue: 423, label: 'C2', class: 'COMMITTED', parent: 421, order: 1, lane: 'integration' },
  { issue: 467, label: 'Shared H', class: 'COMMITTED', parent: 421, order: 2, lane: 'integration' },
  { issue: 469, label: 'H1 Codex', class: 'COMMITTED', parent: 467, order: 3, lane: 'codex', owner_prefix: 'CDX-TK469-' },
  { issue: 470, label: 'H2 Claude', class: 'COMMITTED', parent: 467, order: 4, lane: 'claude' },
  { issue: 459, label: 'S1-A', class: 'COMPLETED', parent: 421, order: 3 },
  { issue: 422, label: 'C1 predecessor', class: 'RETIRED', parent: 421, order: 4 },
  { issue: 425, label: 'Q', class: 'OPTIONAL', parent: null, order: 0 },
  { issue: 499, label: 'R1', class: 'COMMITTED', parent: null, order: 5 },
];

function setup({ repository = 'acme/app', parentIssue = 421, outcomes = CATALOGUE, issues = null, version = '3.9.1', controller = writer, initialiseParent = true } = {}) {
  const github = new FakeGitHub({ repository, store: 'acme/state-store' });
  const binding = {
    schema: state.SCHEMA.binding, repository, parent_issue: parentIssue, record_prefix: 'INT-TK421-', writer_prefix: 'INT-TK421-',
    store: { kind: 'github', repository: 'acme/state-store', branch: 'main', path: `state/${repository}/` }, required_checks: ['validate'],
  };
  github.addIssue(parentIssue, { body: '## CURRENT\nHand-written controller prose.\n' });
  (issues || (() => {
    for (const outcome of outcomes) github.addIssue(outcome.issue, { body: `Body of ${outcome.issue}`, state: ['COMPLETED', 'RETIRED'].includes(outcome.class) ? 'closed' : 'open' });
    github.addIssue(424, { body: 'not catalogued' });
    github.link(parentIssue, 424);
    github.link(parentIssue, 470);
    github.link(parentIssue, 425);
    github.issues.get(499).blockedBy = [423];
  }))(github);
  let clock = 0;
  const store = new state.StateStore({ transport: github, store: binding.store, now: () => `T${clock += 1}`, toolkitVersion: version });
  const parent = state.claimDocument(state.newParent({ repository, parentIssue, outcomes }), controller, {});
  if (initialiseParent) store.write('parent', parentIssue, parent, { sha: null, previous: null });
  const reconciler = (who = controller) => new state.Reconciler({
    store, reader: new state.ProgrammeGraphReader({ transport: github, repository }),
    mutator: new state.GitHubMutator({ transport: github, repository }), binding, writer: who, toolkitVersion: version,
  });
  return { github, store, binding, reconciler, repository, parentIssue };
}

// Posts a comment and returns it as the REST list shows it.
const comment = (github, issue, body, options = {}) => { const id = github.addComment(issue, { body, ...options }); return github.commentsOf(issue).find(entry => entry.id === id); };
const codes = report => report.findings.map(finding => `${finding.code} #${finding.issue}`);
const kinds = report => report.effects.map(effect => `${effect.kind} #${effect.target.issue}`);
const patchCount = (github, number) => github.calls.filter(call => call.method === 'PATCH' && call.path.endsWith(`/issues/${number}`)).length;

test('a dry run plans the native tree without writing; apply makes it agree and a second pass changes nothing', () => {
  const { github, reconciler } = setup();
  const commits = github.commits;
  const dry = reconciler().run();
  assert.equal(github.mutations(), 0, 'a dry run makes no GitHub writes');
  assert.equal(github.commits, commits, 'a dry run makes no store writes');
  assert.ok(codes(dry).includes('NATIVE_PARENT_MISSING #423'));
  assert.ok(codes(dry).includes('NATIVE_PARENT_WRONG #470'));
  assert.ok(codes(dry).includes('NATIVE_CHILD_UNKNOWN #424'));
  assert.ok(kinds(dry).includes('attach #469'));
  assert.ok(dry.effects.some(effect => effect.text === 'Move #470 from under #421 to under #467'));
  assert.ok(dry.effects.some(effect => effect.text === 'Attach #469 under #467'));
  assert.match(cli.formatReport(dry), /^Repository acme\/app, parent #421; state store acme\/state-store main state\/acme\/app\/ \(parent revision 1\)\nDry run: /);

  const applied = reconciler().run({ apply: true });
  assert.deepEqual(applied.results.filter(entry => !['DONE', 'NOOP'].includes(entry.outcome)), [], JSON.stringify(applied.holds));
  assert.deepEqual(applied.holds, []);
  // Native and canonical agree: every catalogued parent link, in catalogue order.
  assert.deepEqual(github.issues.get(421).subs.filter(n => n !== 424 && n !== 425), [423, 467, 459, 422]);
  assert.deepEqual(github.issues.get(467).subs, [469, 470]);
  assert.equal(github.issues.get(470).parent, 467);
  assert.equal(github.issues.get(424).parent, 421, 'an uncatalogued sub-issue is reported, never detached');

  const before = { commits: github.commits, mutations: github.mutations() };
  for (const apply of [false, true]) {
    const again = reconciler().run({ apply });
    assert.equal(again.summary, 'No changes', JSON.stringify(again.effects));
    assert.deepEqual(again.writes, { state: 0, github: 0 });
  }
  assert.equal(github.commits, before.commits, 'the second pass makes no store commit');
  assert.equal(github.mutations(), before.mutations, 'the second pass makes no GitHub write');
});

test('a full apply finishes and settles while every branch read lags one commit behind', () => {
  const { github, reconciler } = setup();
  github.branchLag = true;
  const applied = reconciler().run({ apply: true });
  assert.deepEqual(applied.holds, []);
  assert.deepEqual(applied.results.filter(entry => !['DONE', 'NOOP'].includes(entry.outcome)), [], JSON.stringify(applied.results));
  assert.equal(reconciler().run({ apply: true }).summary, 'No changes');
  github.branchLag = false;
  assert.equal(reconciler().run().summary, 'No changes');
});

test('dependencies are shown but never set or imply a parent', () => {
  const { github, reconciler } = setup();
  const report = reconciler().run({ apply: true });
  assert.ok(codes(report).includes('DEPENDENCY_IMPLIES_PARENT #499'));
  assert.ok(codes(report).includes('NATIVE_PARENT_UNEXPECTED #425'));
  assert.equal(github.issues.get(499).parent, null);
  assert.equal(github.issues.get(425).parent, 421, 'an unexpected parent is reported, not removed');
  assert.equal(report.effects.some(effect => effect.target.issue === 499 && ['attach', 'reparent'].includes(effect.kind)), false);
  assert.match(reconciler().run().next_action, /^Controller: decide on 3 finding\(s\) the reconciler does not change, starting with /);
});

test('parent and child blocks are rendered from the same state revision', () => {
  const { github, store, reconciler } = setup();
  reconciler().run({ apply: true });
  const parentBlock = state.findStateBlock(github.issues.get(421).body).block;
  const childBlock = state.findStateBlock(github.issues.get(423).body).block;
  const doc = store.read('child', 423).doc;
  assert.match(parentBlock.body, new RegExp(`children=[^ ]*423:${doc.revision}\\b`));
  assert.match(childBlock.body, new RegExp(`child=423@${doc.revision} -->`));
  assert.ok(github.issues.get(421).body.includes('## CURRENT\nHand-written controller prose.\n'), 'hand-written text outside the blocks is kept');
  const rows = parentBlock.body.split('\n').filter(line => /^\| [^|]+ \| [^|]+ \| #\d+ \|/.test(line)).map(line => line.split(' | ')[2]);
  assert.deepEqual(rows, ['#423', '#467', '#469', '#470', '#499', '#425', '#459', '#422'], 'active rows by class, priority order and child number, then finished work by close time');
});

test('the graph replaces the hand-kept index once, sits right under the CURRENT summary ahead of hand-written notes, and then settles', () => {
  const { github, binding, reconciler } = setup();
  binding.projection = { after_section: 'CURRENT', replace_section: 'Programme index' };
  github.issues.get(421).body = '# Programme\n\n## CURRENT\n\nLive now.\n\n## Programme index\n\n| old | table |\n\n## Parent completion\n\nDone when.\n';
  github.issues.get(423).body = '# C2 title\n\nBody of 423';
  reconciler().run({ apply: true });
  const page = github.issues.get(421).body;
  assert.equal(page.includes('Programme index'), false, 'the hand-kept index is replaced');
  assert.ok(page.startsWith('# Programme\n\n## CURRENT\n\n<!-- AI-AGENT-TOOLKIT:programme-state:BEGIN CURRENT'), 'the generated summary opens the status section');
  assert.ok(page.includes('<!-- AI-AGENT-TOOLKIT:programme-state:END CURRENT -->\n\n<!-- AI-AGENT-TOOLKIT:programme-state:BEGIN STATE'), 'the graph follows the summary directly');
  assert.ok(page.includes('<!-- AI-AGENT-TOOLKIT:programme-state:END STATE -->\n\nLive now.\n\n## Parent completion\n\nDone when.\n\n<!-- AI-AGENT-TOOLKIT:programme-state:BEGIN TRACE'), 'hand-written notes come after the graph, and the comment trace closes the page');
  assert.ok(page.endsWith('<!-- AI-AGENT-TOOLKIT:programme-state:END TRACE -->\n'));
  assert.match(github.issues.get(423).body, /^<!-- AI-AGENT-TOOLKIT:programme-state:BEGIN NAV [^\n]*\n<!-- programme-nav -->\n\*\*Path:\*\* #421 > #423\n<!-- AI-AGENT-TOOLKIT:programme-state:END NAV -->\n\n# C2 title\n\n<!-- AI-AGENT-TOOLKIT:programme-state:BEGIN STATE/, 'a task page opens with its links, then the title, then its status block');
  assert.equal(reconciler().run().summary, 'No changes');

  // A block someone moved back to the top is planned as a move, not a content change.
  const end = page.indexOf('-->', page.indexOf(':END STATE')) + 3;
  const block = page.slice(page.lastIndexOf('<!--', page.indexOf(':BEGIN STATE')), end);
  github.issues.get(421).body = `${block}\n\n${page.replace(`${block}\n\n`, '')}`;
  const dry = reconciler().run();
  assert.deepEqual(dry.effects.map(effect => effect.text), ["Move the state block in #421's body"]);
  assert.ok(dry.findings.some(finding => finding.detail === 'the block is not in its place on the page'));
  reconciler().run({ apply: true });
  assert.equal(github.issues.get(421).body, page);
});

test('every body lists every comment on its issue, with supersession marked and the latest comment winning', () => {
  const { github, reconciler } = setup();
  reconciler().run({ apply: true });
  const first = comment(github, 423, '## INT-TK421-010 - First call\nDetails.');
  const second = comment(github, 423, 'INT-TK421-011 new call\nSUPERSEDES=INT-TK421-010');
  comment(github, 423, 'bot noise', { login: 'ci[bot]', type: 'Bot' });
  const dry = reconciler().run();
  assert.ok(dry.findings.some(finding => finding.code === 'TRACE_STALE' && finding.issue === 423));
  assert.deepEqual(dry.effects.map(effect => effect.text), ["Update the comment trace in #423's body"]);
  reconciler().run({ apply: true });
  const trace = state.findStateBlock(github.issues.get(423).body, state.TRACE_BLOCK_NAME).block.body.split('\n');
  assert.match(trace[1], /One line per topic; each number is a comment and opens it\. Read the body first; within a topic, where comments disagree, the latest one wins\./);
  const url = id => `https://github.com/acme/app/issues/423#issuecomment-${id}`;
  assert.deepEqual(trace.slice(3), [
    `- **Issue 423:** [${first.id}](${url(first.id)}) (replaced by [${second.id}](${url(second.id)})) · [${second.id}](${url(second.id)})`,
  ], 'one line under the task name, each comment by its ID with a full link; bots are left out');
  const audit = require('../../skills/github-program-reconciler/scripts/decision-trace-audit.cjs');
  assert.equal(audit.auditDecisionTraces({ body: github.issues.get(423).body, comments: github.commentsOf(423), recordPrefix: 'INT-TK421-' }).ok, true);
  assert.equal(reconciler().run().summary, 'No changes');
  assert.deepEqual(state.findStateBlock(github.issues.get(467).body, state.TRACE_BLOCK_NAME).block.body.split('\n').slice(3), ['- No comments yet.']);
});

test('a trace that would overflow the body moves whole into one index comment, then new comments list directly again', () => {
  const { github, reconciler } = setup();
  reconciler().run({ apply: true });
  const limit = Math.max(github.issues.get(421).body.length + 100, github.issues.get(423).body.length + 600);
  const run = apply => { const pass = reconciler(); pass.threshold = limit; return pass.run({ apply }); };
  const early = Array.from({ length: 16 }, (unused, n) => comment(github, 423, `INT-TK421-2${String(n).padStart(2, '0')} a decision with a summary long enough to fill the body quickly ${'x'.repeat(40)}`));
  const dry = run(false);
  assert.ok(dry.effects.some(effect => effect.text === "Move #423's \"Issue 423\" comment trace (16 link(s)) into a new index comment"));
  const applied = run(true);
  assert.deepEqual(applied.holds, []);
  const comments = github.commentsOf(423);
  const index = comments.at(-1);
  assert.ok(index.body.startsWith('<!-- decision-trace-index -->'), 'an untopiced list carries no topic line');
  assert.ok(index.body.includes('## Comment trace for #423: Issue 423'));
  for (const comment of early) assert.ok(index.body.includes(`[${comment.id}](https://github.com/acme/app/issues/423#issuecomment-${comment.id})`), 'the whole list moved');
  const body = github.issues.get(423).body;
  assert.ok(body.length < limit);
  const lines = state.findStateBlock(body, state.TRACE_BLOCK_NAME).block.body.split('\n').slice(3);
  assert.deepEqual(lines, [`- **Issue 423:** [list 1](https://github.com/acme/app/issues/423#issuecomment-${index.id})`], 'the body keeps one link in place of the list');
  assert.equal(run(false).summary, 'No changes');

  const later = comment(github, 423, 'INT-TK421-030 later');
  run(true);
  const again = state.findStateBlock(github.issues.get(423).body, state.TRACE_BLOCK_NAME).block.body.split('\n').slice(3);
  assert.equal(again.length, 1);
  assert.match(again[0], new RegExp(`\\[list 1\\][^ ]+ · \\[${later.id}\\]\\([^)]*#issuecomment-${later.id}\\)$`), 'a newer comment is listed directly again, after the index');
  const audit = require('../../skills/github-program-reconciler/scripts/decision-trace-audit.cjs');
  assert.equal(audit.auditDecisionTraces({ body: github.issues.get(423).body, comments: github.commentsOf(423), recordPrefix: 'INT-TK421-', threshold: limit }).ok, true);
});

test('each tag keeps its own list and overflows into its own index comment; tags are never combined', () => {
  const { github, reconciler } = setup();
  reconciler().run({ apply: true });
  const fix = Array.from({ length: 24 }, (unused, n) => n + 1).map(n => comment(github, 423, `data-leak-fix-122\r\n---\r\nINT-TK421-05${n} fix step ${'z'.repeat(60)}`));
  const table = comment(github, 423, 'TABLE-CREATION\n---\nINT-TK421-060 columns agreed');
  const loose = comment(github, 423, 'A note with no tag');
  reconciler().run({ apply: true });
  const sections = body => state.findStateBlock(body, state.TRACE_BLOCK_NAME).block.body.split('\n').map(line => /^- \*\*(.+?):\*\* /.exec(line)?.[1]).filter(Boolean);
  assert.deepEqual(sections(github.issues.get(423).body), ['data-leak-fix-122', 'TABLE-CREATION', 'Issue 423'], 'topics as first written, in first-seen order, then the task name for untopiced comments');
  const trace = state.findStateBlock(github.issues.get(423).body, state.TRACE_BLOCK_NAME).block.body;
  assert.match(trace, new RegExp(`\\*\\*data-leak-fix-122:\\*\\* \\[${fix[0].id}\\]`));
  assert.match(trace, new RegExp(`\\*\\*TABLE-CREATION:\\*\\* \\[${table.id}\\]\\(https://github.com/acme/app/issues/423#issuecomment-${table.id}\\)$`, 'm'));
  assert.match(trace, new RegExp(`\\*\\*Issue 423:\\*\\* \\[${loose.id}\\]`));

  // Only the largest tag's list moves out, into its own tagged index comment.
  const limit = github.issues.get(423).body.length - 200;
  const pass = reconciler();
  pass.threshold = limit;
  const report = pass.run({ apply: true });
  assert.deepEqual(report.holds, []);
  const index = github.commentsOf(423).at(-1);
  assert.ok(index.body.startsWith('data-leak-fix-122\n---\n<!-- decision-trace-index -->'), 'the index comment carries its topic');
  for (const entry of fix) assert.ok(index.body.includes(`#issuecomment-${entry.id})`));
  assert.equal(index.body.includes(`#issuecomment-${table.id})`), false, 'another tag never joins it');
  const after = state.findStateBlock(github.issues.get(423).body, state.TRACE_BLOCK_NAME).block.body;
  assert.match(after, new RegExp(`- \\*\\*data-leak-fix-122:\\*\\* \\[list 1\\]\\(https://github.com/acme/app/issues/423#issuecomment-${index.id}\\)\\n- \\*\\*TABLE-CREATION:\\*\\*`));
  assert.match(after, new RegExp(`#issuecomment-${table.id}\\)`), 'the smaller tag stays listed in the body');
  const audit = require('../../skills/github-program-reconciler/scripts/decision-trace-audit.cjs');
  assert.equal(audit.auditDecisionTraces({ body: github.issues.get(423).body, comments: github.commentsOf(423), recordPrefix: 'INT-TK421-', threshold: limit }).ok, true);
  const again = reconciler();
  again.threshold = limit;
  assert.equal(again.run().summary, 'No changes');
});

test('task pages and their open PRs start with Parent > Child > PR links; merged PRs are left alone', () => {
  const { github, store, reconciler } = setup();
  reconciler().run({ apply: true });
  const parentDoc = store.read('parent', 421).doc;
  github.addPr(601, { head: SHA_A, branch: 'h1-codex', body: 'Codex host support.' });
  github.addPr(602, { head: SHA_B, state: 'MERGED', merged: true, branch: 'h2-claude', body: 'Claude host support.' });
  store.mutate('child', 469, { writer, parentDoc, change: doc => state.applyPatch('child', doc, { candidate: { branch: 'h1-codex' } }) });
  store.mutate('child', 470, { writer, parentDoc, change: doc => state.applyPatch('child', doc, { candidate: { branch: 'h2-claude' } }) });
  const report = reconciler().run({ apply: true });
  assert.deepEqual(report.holds, []);
  assert.ok(report.results.some(entry => entry.text === 'Add the parent and task links at the top of PR #601' && entry.outcome === 'DONE'));
  const path = body => /\*\*Path:\*\* ([^\n]*)/.exec(body)[1];
  assert.equal(path(github.issues.get(469).body), '#421 > #467 > #469 > PR #601', 'a nested task shows every parent');
  assert.equal(path(github.issues.get(470).body), '#421 > #467 > #470 > PR #602');
  assert.match(github.prs.get(601).body, /^<!-- AI-AGENT-TOOLKIT:programme-state:BEGIN NAV [^\n]*\n<!-- programme-nav -->\n\*\*Path:\*\* #421 > #467 > #469 > PR #601\n<!-- AI-AGENT-TOOLKIT:programme-state:END NAV -->\n\nCodex host support\.$/);
  assert.equal(github.prs.get(602).body, 'Claude host support.', 'a merged PR is not edited');
  assert.equal(reconciler().run().summary, 'No changes');
});

test('an interrupted index-comment move is settled by reading the comments, never posted twice', () => {
  const { github, store, reconciler } = setup();
  reconciler().run({ apply: true });
  const limit = Math.max(github.issues.get(423).body.length, github.issues.get(421).body.length) + 400;
  const run = apply => { const pass = reconciler(); pass.threshold = limit; return pass.run({ apply }); };
  Array.from({ length: 16 }, (unused, n) => comment(github, 423, `INT-TK421-4${String(n).padStart(2, '0')} ${'y'.repeat(80)}`));
  let failBody = true;
  github.intercept(call => (failBody && call.method === 'PATCH' && call.path.endsWith('/issues/423') ? (failBody = false, { status: 502, json: { message: 'Bad gateway' } }) : undefined));
  run(true);
  const posted = () => github.commentsOf(423).filter(comment => comment.body.startsWith('<!-- decision-trace-index -->')).length;
  assert.equal(posted(), 1);
  run(true);
  assert.equal(posted(), 1, 'the next pass reads the index comment back instead of posting again');
  assert.deepEqual(store.read('child', 423).doc.pending_effects, []);
  const last = run(false);
  assert.equal(last.summary, 'No changes', JSON.stringify(last.holds));
});

test('an open PR that references an untracked outcome is reported for the controller, never recorded', () => {
  const { github, store, reconciler } = setup();
  reconciler().run({ apply: true });
  github.addPr(601, { head: SHA_A, body: 'Work for the shared contract.\n\nRefs #421, #423 and #467' });
  github.addPr(602, { head: SHA_B, state: 'MERGED', merged: true, body: 'Closes #423' });
  github.addPr(603, { head: SHA_B, isDraft: true, state: 'DRAFT', body: 'Completes: #459' });
  const commits = github.commits;
  const report = reconciler().run({ apply: true });
  assert.deepEqual(report.findings.filter(finding => finding.code === 'PR_UNTRACKED').map(finding => `#${finding.issue}: ${finding.detail}`), [
    '#423: open PR #601 references this outcome, but its state records no PR or branch; the controller confirms and records it with update --patch',
    '#467: open PR #601 references this outcome, but its state records no PR or branch; the controller confirms and records it with update --patch',
  ], 'merged PRs and finished outcomes are left out');
  assert.equal(github.commits, commits, 'nothing is recorded');
  assert.equal(store.read('child', 423).doc.pr.number, null);
});

test('reclassifying an outcome keeps its identity, document and native link', () => {
  const { github, store, reconciler } = setup();
  reconciler().run({ apply: true });
  const docBefore = store.read('child', 423).doc;
  store.mutate('parent', 421, { writer, change: doc => state.applyPatch('parent', doc, { outcomes: doc.outcomes.map(entry => (entry.issue === 423 ? { ...entry, class: 'OPTIONAL' } : entry)) }) });
  const report = reconciler().run({ apply: true });
  assert.deepEqual(kinds(report).sort(), ['reorder #423', 'replace_block #421', 'replace_block #423']);
  const docAfter = store.read('child', 423).doc;
  assert.equal(docAfter.revision, docBefore.revision);
  assert.deepEqual(docAfter.fence, docBefore.fence);
  assert.equal(github.issues.get(423).parent, 421);
  assert.match(state.findStateBlock(github.issues.get(423).body).block.body, /class: OPTIONAL/);
});

test('older classes read as COMMITTED and sort by priority like any task, are reported as CLASS_LEGACY, and migrate in one patch', () => {
  // Written by 3.12.0: `order` counted within each old class, so the old numbers tie across classes
  // and child number breaks the ties until the migration patch renumbers them.
  const outcomes = [
    { issue: 12, class: 'CORE', parent: 7, order: 0 },
    { issue: 9, class: 'CORE', parent: 7, order: 1 },
    { issue: 8, class: 'HARDENING', parent: 7, order: 0 },
    { issue: 11, class: 'LATER', parent: 7, order: 0 },
    { issue: 10, class: 'COMPLETED', parent: 7, order: 0 },
  ];
  const { github, store, reconciler } = setup({
    repository: 'other/tool', parentIssue: 7, outcomes,
    issues: gh => { for (const outcome of outcomes) gh.addIssue(outcome.issue, { parent: outcome.parent, state: outcome.class === 'COMPLETED' ? 'closed' : 'open' }); },
  });
  assert.deepEqual(github.issues.get(7).subs, [12, 9, 8, 11, 10]);
  const legacy = reconciler().run({ apply: true });
  assert.deepEqual(legacy.holds, []);
  assert.equal(kinds(legacy).some(kind => kind.startsWith('reorder')), true, 'the old per-class numbers tie, so the pass reorders');
  assert.deepEqual(github.issues.get(7).subs, [8, 11, 12, 9, 10], 'open tasks by order, then child number, then the finished one');
  assert.match(legacy.findings.find(entry => entry.code === 'ORDER_TIE').detail, /#8, #11, #12 share priority order 0, so child number decides\. Controller: set a distinct order/);
  const finding = legacy.findings.find(entry => entry.code === 'CLASS_LEGACY');
  assert.ok(finding, 'CLASS_LEGACY is reported');
  assert.match(finding.detail, /#12 CORE, #9 CORE, #8 HARDENING, #11 LATER read as COMMITTED and sort like any other task, by group, priority \(order\) and child number/);
  assert.doesNotMatch(finding.detail, /kept in their old|moves no task/);
  assert.match(finding.detail, /apply it whole with update-parent/);
  assert.deepEqual(finding.patch.outcomes.map(entry => [entry.issue, entry.class, entry.order]),
    [[12, 'COMMITTED', 0], [9, 'COMMITTED', 1], [8, 'COMMITTED', 2], [11, 'COMMITTED', 3], [10, 'COMPLETED', 0]]);

  // A write never adds an older class, even to an entry that had another one.
  assert.throws(() => store.mutate('parent', 7, { writer, change: doc => state.applyPatch('parent', doc, { outcomes: doc.outcomes.map(entry => (entry.issue === 11 ? { ...entry, class: 'HARDENING' } : entry)) }) }), /PATCH_REFUSED|older class names/);
  assert.throws(() => state.refuseNewLegacy(null, state.newParent({ repository: 'other/tool', parentIssue: 7, outcomes: [{ issue: 8, class: 'CORE', parent: 7, order: 0 }] })), /older class names/, 'init-parent refuses them too');

  store.mutate('parent', 7, { writer, change: doc => state.applyPatch('parent', doc, finding.patch) });
  const migrated = reconciler().run({ apply: true });
  assert.equal(codes(migrated).includes('CLASS_LEGACY #7'), false);
  assert.equal(codes(migrated).some(code => code.startsWith('ORDER_TIE')), false, 'the renumbered order has no ties');
  assert.deepEqual(github.issues.get(7).subs, [12, 9, 8, 11, 10], 'the old CORE, HARDENING, LATER sequence becomes the priority');
  assert.equal(kinds(reconciler().run({ apply: true })).some(kind => kind.startsWith('reorder')), false, 'a later pass moves nothing');
});

test('a moved PR head marks evidence STALE_HEAD and updates both projections together', () => {
  const { github, store, reconciler } = setup();
  github.addPr(540, { head: SHA_A, contexts: [green('validate')], branch: 'feature' });
  reconciler().run({ apply: true });
  store.mutate('child', 423, { writer, parentDoc: store.read('parent', 421).doc, change: doc => state.applyPatch('child', doc, {
    candidate: { branch: 'feature', head: SHA_A }, uat: { state: 'PASSED', at_head: SHA_A }, review: { state: 'PASSED', verdicts: [{ reviewer: 'g2', head: SHA_A, verdict: 'PASSED' }] }, next_action: 'Owner merge decision',
  }, { writer, parentDoc: store.read('parent', 421).doc }) });
  const settled = reconciler().run({ apply: true });
  assert.ok(codes(settled).includes('CHECKS_GREEN_AT_HEAD #423'));
  assert.equal(store.read('child', 423).doc.pr.checks.state, 'GREEN');

  github.prs.get(540).head = SHA_B;
  github.prs.get(540).rollupOid = SHA_B;
  github.prs.get(540).contexts = [{ ...green('validate'), status: 'IN_PROGRESS', conclusion: null }];
  const moved = reconciler().run({ apply: true });
  assert.ok(codes(moved).includes('PR_HEAD_MOVED #423'));
  assert.ok(codes(moved).includes('CHECKS_PENDING #423'));
  assert.deepEqual(moved.holds, []);
  const doc = store.read('child', 423).doc;
  assert.equal(doc.pr.head, SHA_B);
  assert.equal(doc.pr.checks.state, 'PENDING');
  const childBlock = state.findStateBlock(github.issues.get(423).body).block.body;
  const parentBlock = state.findStateBlock(github.issues.get(421).body).block.body;
  assert.match(childBlock, /UAT: PASSED \(STALE_HEAD, was aaaaaaa\); review: PASSED \(STALE_HEAD\)/);
  assert.match(parentBlock, new RegExp(`423:${doc.revision}\\b`));
  assert.match(childBlock, new RegExp(`child=423@${doc.revision} -->`));
  assert.match(childBlock, new RegExp(`\\[bbbbbbb\\]\\(https://github.com/acme/app/commit/${SHA_B}\\) \`${SHA_B}\``), 'short link plus full SHA as text');
  assert.match(parentBlock, /^\| Issue 423 \| - \| #423 \| #540 \| NOW \| IN PROGRESS \|$/m, 'an open PR means the work is in progress');
});

test('a body edited between read and write is held, then completed on the next pass with the edit kept', () => {
  const { github, reconciler } = setup();
  let armed = true;
  github.intercept(call => {
    if (armed && call.method === 'PUT' && call.path.includes('issue-423.json') && JSON.parse(Buffer.from(call.body.content, 'base64').toString()).pending_effects.some(effect => effect.kind === 'replace_block')) {
      armed = false;
      github.issues.get(423).body += '\nA person added this line.';
      github.issues.get(423).updated_at = github.tick();
    }
    return undefined;
  });
  const first = reconciler().run({ apply: true });
  assert.ok(first.holds.some(hold => hold.code === 'BODY_MOVED' && hold.target === '#423'));
  assert.equal(patchCount(github, 423), 0, 'nothing was written over the person\'s edit');
  const second = reconciler().run({ apply: true });
  assert.deepEqual(second.holds, []);
  assert.equal(patchCount(github, 423), 1);
  assert.ok(github.issues.get(423).body.includes('A person added this line.'));
});

test('a failed body write is not replayed blindly; an interrupted pass is resolved by readback without a duplicate write', () => {
  const { github, store, reconciler } = setup();
  let failBody = true;
  github.intercept(call => {
    if (failBody && call.method === 'PATCH' && call.path.endsWith('/issues/423')) { failBody = false; return { status: 502, json: { message: 'Bad gateway' } }; }
    return undefined;
  });
  const first = reconciler().run({ apply: true });
  assert.ok(first.holds.some(hold => hold.code === 'EFFECT_NOT_DONE' && hold.target === '#423'));
  assert.deepEqual(store.read('child', 423).doc.pending_effects, [], 'a known failure leaves no intent behind');
  const second = reconciler().run({ apply: true });
  assert.deepEqual(second.holds, []);
  assert.ok(state.findStateBlock(github.issues.get(423).body).block);

  // Interrupt after the mutation and before the resolution write: the intent stays IN_FLIGHT.
  store.mutate('parent', 421, { writer, change: doc => state.applyPatch('parent', doc, { outcomes: doc.outcomes.map(entry => (entry.issue === 469 ? { ...entry, label: 'H1 Codex lane' } : entry)) }) });
  let crash = true;
  const startPatches = patchCount(github, 421);
  github.intercept(call => {
    if (crash && call.method === 'PUT' && call.path.includes('parent-421.json') && patchCount(github, 421) > startPatches) {
      const doc = JSON.parse(Buffer.from(call.body.content, 'base64').toString());
      if (!doc.pending_effects.length) { crash = false; return { status: 500, json: { message: 'connection reset' } }; }
    }
    return undefined;
  });
  assert.throws(() => reconciler().run({ apply: true }), /connection reset/);
  assert.equal(store.read('parent', 421).doc.pending_effects[0].state, 'IN_FLIGHT');
  const patchesBefore = patchCount(github, 421);
  const recovered = reconciler().run({ apply: true });
  assert.deepEqual(recovered.recovered.map(entry => entry.outcome), ['DONE']);
  assert.equal(patchCount(github, 421), patchesBefore, 'the landed write is not repeated');
  assert.deepEqual(store.read('parent', 421).doc.pending_effects, []);
  assert.equal(reconciler().run().summary, 'No changes');
});

test('completed and retired history is accurate and contradictions are reported, not hidden', () => {
  const { github, store, reconciler } = setup();
  const report = reconciler().run({ apply: true });
  assert.equal(store.read('child', 459).doc.lifecycle, 'DONE');
  assert.equal(store.read('child', 422).doc.lifecycle, 'RETIRED');
  assert.equal(codes(report).some(code => code.startsWith('CHILD_STATE_CONFLICT')), false);
  github.issues.get(459).state = 'open';
  assert.ok(codes(reconciler().run()).includes('CHILD_STATE_CONFLICT #459'));
  github.issues.get(423).state = 'closed';
  assert.ok(codes(reconciler().run()).includes('CHILD_STATE_CONFLICT #423'));
});

test('continuation makes no duplicate child, no new gate and no false finality', () => {
  const { github, store, reconciler } = setup();
  reconciler().run({ apply: true });
  const files = github.files.size;
  const parentDoc = store.read('parent', 421).doc;
  const assign = () => store.mutate('child', 470, { writer, parentDoc, change: doc => state.assignGate(doc, { assignment: 'g1-a1', role: 'G1' }) });
  assert.equal(assign().outcome, 'WRITTEN');
  assert.equal(assign().outcome, 'NOOP', 'issuing the same assignment again starts no new gate');
  github.addPr(600, { head: SHA_A, merged: true, state: 'MERGED', contexts: [green('validate')], branch: 'h2-allow-list' });
  store.mutate('child', 470, { writer, parentDoc, change: doc => state.applyPatch('child', doc, { candidate: { branch: 'h2-allow-list' } }) });
  const report = reconciler().run({ apply: true });
  assert.ok(codes(report).includes('CHILD_STATE_CONFLICT #470'), 'a merged PR without an accepted return is not completion');
  assert.equal(store.read('child', 470).doc.lifecycle, 'ACTIVE');
  assert.equal(github.files.size, files, 'no duplicate state document');
});

test('only the parent holder may apply, and a takeover refuses the old writer', () => {
  const { github, store, reconciler } = setup();
  assert.throws(() => reconciler({ session: 'intruder', prefix: 'INT-TK421-' }).run({ apply: true }), { code: 'STALE_WRITER' });
  assert.equal(github.mutations(), 0);
  const successor = { session: 'controller-2', prefix: 'INT-TK421-' };
  const taken = store.mutate('parent', 421, { writer: successor, authorise: false, change: doc => state.claimDocument(doc, successor, { takeover: true }) });
  assert.equal(taken.doc.fence.epoch, 2);
  assert.throws(() => reconciler(writer).run({ apply: true }), { code: 'STALE_WRITER' });
  assert.deepEqual(reconciler(successor).run({ apply: true }).holds, []);
});

test('a body that would reach the trace threshold is refused', () => {
  const { github, reconciler } = setup();
  github.issues.get(421).body = 'x'.repeat(59950);
  const report = reconciler().run({ apply: true });
  assert.ok(report.holds.some(hold => hold.code === 'BODY_TOO_LARGE' && hold.target === '#421'));
  assert.equal(patchCount(github, 421), 0);
  assert.equal(github.issues.get(421).body.length, 59950);
});

test('a second repository orders native sub-issues like the Programme Graph, including nested children', () => {
  const outcomes = [
    { issue: 8, class: 'COMMITTED', parent: 7, order: 2 },
    { issue: 9, class: 'COMMITTED', parent: 7, order: 1 },
    { issue: 10, class: 'RETIRED', parent: 7, order: 0 },
    { issue: 11, class: 'COMPLETED', parent: 7, order: 0 },
    { issue: 12, class: 'OPTIONAL', parent: 7, order: 0 },
    { issue: 13, class: 'COMMITTED', parent: 7, order: 0 },
    { issue: 15, class: 'COMMITTED', parent: 7, order: 1 },
    { issue: 14, class: 'COMMITTED', parent: 7, order: 1 },
    { issue: 16, class: 'OPTIONAL', parent: 8, order: 0 },
    { issue: 17, class: 'COMMITTED', parent: 8, order: 99 },
  ];
  const { github, reconciler } = setup({
    repository: 'other/tool', parentIssue: 7, outcomes,
    issues: gh => { for (const outcome of outcomes) gh.addIssue(outcome.issue, { parent: outcome.parent }); },
  });
  const dry = reconciler().run();
  assert.ok(codes(dry).includes('NATIVE_ORDER_DRIFT #7'));
  assert.ok(codes(dry).includes('NATIVE_ORDER_DRIFT #8'));
  assert.equal(github.mutations(), 0);
  const report = reconciler().run({ apply: true });
  assert.deepEqual(report.holds, []);
  assert.deepEqual(github.issues.get(7).subs, [13, 9, 14, 15, 8, 12, 11, 10], 'LATER by priority order and then child number, OPTIONAL, COMPLETED, then RETIRED');
  assert.deepEqual(github.issues.get(8).subs, [17, 16]);
  const settled = reconciler().run();
  assert.equal(settled.summary, 'No changes');
  assert.match(settled.next_action, /^Controller: decide on 3 finding\(s\) the reconciler does not change/, 'both priority ties wait on the controller');
  assert.deepEqual(settled.findings.filter(finding => finding.code === 'ORDER_TIE').map(finding => finding.detail.split(' share')[0]), ['#12, #16', '#9, #14, #15']);
});

test('merged PRs with green checks list open issues for the controller without closing them', () => {
  for (const accepted of [false, true]) {
    const outcomes = [{ issue: 8, class: 'COMMITTED', parent: 7, order: 0 }];
    const { github, store, reconciler } = setup({ parentIssue: 7, outcomes, issues: gh => gh.addIssue(8, { parent: 7 }) });
    const doc = gatedChild(state, state.newChild({ repository: 'acme/app', outcome: outcomes[0] }), { role: 'G1', returnId: 'r1',
      verdict: accepted ? 'ACCEPT' : null, writer, parentDoc: store.read('parent', 7).doc, head: SHA_A });
    doc.candidate.branch = 'feature';
    store.write('child', 8, doc, { sha: null, previous: null });
    github.addPr(540, { head: SHA_A, merged: true, contexts: [green('validate')], branch: 'feature' });

    const dry = reconciler().run();
    const finding = dry.findings.find(entry => entry.code === 'READY_TO_CLOSE');
    assert.equal(finding.issue, 8);
    assert.match(finding.detail, /PR #540 merged, checks GREEN at aaaaaaa/);
    assert.ok(finding.detail.endsWith(accepted ? 'G1 acceptance recorded' : 'G1 not accepted'));
    assert.deepEqual(dry.close_list, [{ issue: 8, pr: 540, head: SHA_A, gate: 'G1', gate_accepted: accepted, accepted, closable: accepted, uat: null, review: accepted ? 'PASSED' : null }]);
    assert.equal(codes(dry).includes('CHILD_STATE_CONFLICT #8'), !accepted, 'a missing accepted return still conflicts');
    assert.equal(github.mutations(), 0);
    const formatted = cli.formatReport(dry);
    assert.ok(formatted.includes('Ready to close (the controller closes each closable one as completed; the reconciler never closes)'));
    assert.ok(formatted.includes(`- #8: PR #540, head aaaaaaa; ${accepted ? 'G1 acceptance recorded' : 'G1 not accepted'}`));
    assert.ok(formatted.includes(`; UAT: not recorded; review: ${accepted ? 'PASSED' : 'not recorded'}`));

    const applied = reconciler().run({ apply: true });
    assert.deepEqual(applied.holds, []);
    assert.deepEqual(applied.close_list, dry.close_list);
    assert.equal(github.issues.get(8).state, 'open');
    const patches = github.calls.filter(call => call.method === 'PATCH' && /\/issues\/\d+$/.test(call.path));
    assert.ok(patches.length > 0, 'the pass writes managed bodies');
    assert.ok(patches.every(call => !Object.hasOwn(call.body, 'state')), 'no issue PATCH may change state');
    const settled = reconciler().run();
    assert.match(settled.next_action, /^Controller: decide on .*starting with READY_TO_CLOSE on #8/);
    assert.deepEqual(settled.close_list, dry.close_list);
  }
});

test('G0 acceptance cannot stand in for the current G1 gate acceptance on a merged PR', () => {
  const outcomes = [{ issue: 8, class: 'COMMITTED', parent: 7, order: 0 }];
  const { github, store, reconciler } = setup({ parentIssue: 7, outcomes, issues: gh => gh.addIssue(8, { parent: 7 }) });
  const parentDoc = store.read('parent', 7).doc;
  let doc = gatedChild(state, state.newChild({ repository: 'acme/app', outcome: outcomes[0] }), { role: 'G0', returnId: 'g0-r1', verdict: 'ACCEPT', writer, parentDoc });
  doc = state.assignGate(doc, { assignment: 'g1-a1', role: 'G1' });
  doc.candidate.branch = 'feature';
  doc.uat.state = 'PENDING';
  doc.review.state = 'IN_REVIEW';
  store.write('child', 8, doc, { sha: null, previous: null });
  github.addPr(540, { head: SHA_A, merged: true, contexts: [green('validate')], branch: 'feature' });

  const check = (accepted, review = 'IN_REVIEW') => {
    const report = reconciler().run();
    assert.deepEqual(report.close_list, [{ issue: 8, pr: 540, head: SHA_A, gate: 'G1', gate_accepted: accepted, accepted, closable: false, uat: 'PENDING', review }]);
    assert.equal(codes(report).includes('CHILD_STATE_CONFLICT #8'), !accepted);
    assert.match(cli.formatReport(report), new RegExp(`UAT: PENDING; review: ${review}`));
  };
  check(false);
  store.mutate('child', 8, { writer, parentDoc, change: child => state.recordReturn(child, { returnId: 'g1-r1', assignment: 'g1-a1' }) });
  check(false);
  assert.throws(() => store.mutate('child', 8, { writer, parentDoc, change: child => state.consumeReturn(child, { returnId: 'g1-r1', verdict: 'ACCEPT', writer, parentDoc, liveHead: SHA_A }) }), { code: 'EVIDENCE_STALE' });
  store.mutate('child', 8, { writer, parentDoc, change: child => state.applyPatch('child', child, { review: { state: 'PASSED', verdicts: [{ reviewer: 'g2', head: SHA_A, verdict: 'PASSED' }] } }, { writer, parentDoc }) });
  store.mutate('child', 8, { writer, parentDoc, change: child => state.consumeReturn(child, { returnId: 'g1-r1', verdict: 'ACCEPT', writer, parentDoc, liveHead: SHA_A }) });
  check(true, 'PASSED');
  assert.equal(github.issues.get(8).state, 'open');
});

test('the CLI bootstraps with the controller, which records gates and acceptance; executors only dry-run', () => {
  const ctrl = { session: 'ctrl', prefix: writer.prefix };
  const outcomes = [{ issue: 8, class: 'COMMITTED', parent: 7, order: 0 }];
  const { github, store, binding } = setup({ parentIssue: 7, outcomes, controller: ctrl, initialiseParent: false, issues: gh => gh.addIssue(8, { parent: 7 }) });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'programme-handover-'));
  const output = [];
  const deps = { transport: github, binding, originUrl: 'https://github.com/acme/app.git', repoRoot: __dirname,
    toolkitVersion: '3.9.1', environment: {}, stdout: { write: text => output.push(text) } };
  const run = (args, session = 'ctrl') => {
    output.length = 0;
    assert.equal(cli.main([...args, '--session', session, '--controller', '--json'], deps), 0);
    return JSON.parse(output.join(''));
  };
  const dryRun = () => { output.length = 0; cli.main(['reconcile', '--json'], deps); return JSON.parse(output.join('')); };
  try {
    assert.equal(cli.main(['reconcile', '--session', 'g1'], deps), 1);
    assert.match(output.join(''), /Controller: resolve PARENT_STATE_MISSING on #7/);
    assert.ok(output.join('').includes('No parent state document for #7 yet. The appointed controller creates and holds it with init-parent --apply --controller; other sessions report this to the controller.'));
    assert.throws(() => cli.main(['assign', '--issue', '8', '--role', 'G1', '--assignment', 'g1-a1', '--session', 'g1'], deps), { code: 'USAGE' });
    assert.equal(github.commits, 0);
    const catalogue = path.join(dir, 'catalogue.json');
    fs.writeFileSync(catalogue, JSON.stringify({ outcomes }));
    assert.equal(run(['init-parent', '--catalogue', catalogue, '--apply']).outcome, 'WRITTEN');
    assert.equal(store.read('parent', 7).doc.fence.holder_session, 'ctrl');
    run(['assign', '--issue', '8', '--role', 'G0', '--assignment', 'g0-a1']);
    run(['return', '--issue', '8', '--record', 'g0-r1', '--assignment', 'g0-a1']);
    run(['return', '--issue', '8', '--consume', 'g0-r1', '--verdict', 'ACCEPT']);
    const handover = run(['assign', '--issue', '8', '--role', 'G1', '--assignment', 'g1-a1']);
    assert.deepEqual(handover.acting, { prefix: writer.prefix, session: 'ctrl' }, 'write results name the acting session');
    const patch = path.join(dir, 'candidate.json');
    fs.writeFileSync(patch, JSON.stringify({ candidate: { branch: 'feature' } }));
    run(['update', '--issue', '8', '--patch', patch]);
    run(['return', '--issue', '8', '--record', 'g1-r1', '--assignment', 'g1-a1']);
    github.addPr(540, { head: SHA_A, merged: true, contexts: [green('validate')], branch: 'feature' });
    const pending = dryRun();
    assert.deepEqual(pending.close_list, [{ issue: 8, pr: 540, head: SHA_A, gate: 'G1', gate_accepted: false, accepted: false, closable: false, uat: null, review: null }]);
    assert.match(cli.formatReport(pending), /G1 not accepted/);
    for (const session of ['g0', 'g1', 'g2', 'helper']) {
      assert.throws(() => cli.main(['return', '--issue', '8', '--consume', 'g1-r1', '--verdict', 'ACCEPT', '--session', session], deps), { code: 'USAGE' });
      assert.throws(() => cli.main(['return', '--issue', '8', '--consume', 'g1-r1', '--verdict', 'ACCEPT', '--session', session, '--controller'], deps), { code: 'STALE_WRITER' });
    }
    const review = path.join(dir, 'review.json');
    fs.writeFileSync(review, JSON.stringify({ review: { state: 'PASSED', verdicts: [{ reviewer: 'g2', head: SHA_A, verdict: 'PASSED' }] } }));
    run(['update', '--issue', '8', '--patch', review]);
    run(['return', '--issue', '8', '--consume', 'g1-r1', '--verdict', 'ACCEPT']);
    const accepted = dryRun();
    assert.deepEqual(accepted.close_list, [{ issue: 8, pr: 540, head: SHA_A, gate: 'G1', gate_accepted: true, accepted: true, closable: true, uat: null, review: 'PASSED' }]);
    assert.match(cli.formatReport(accepted), /G1 acceptance recorded/);
    assert.equal(codes(accepted).includes('CHILD_STATE_CONFLICT #8'), false);
    assert.equal(store.read('child', 8).doc.fence.holder_session, null, 'the controller writes children through the parent fence');
    assert.equal(github.issues.get(8).state, 'open');
    assert.equal(github.mutations(), 0, 'the walk writes private state only, never public issue state');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('G0-only acceptance is named but cannot count as merged implementation completion', () => {
  for (const gate of ['G0', 'G1', 'G2']) {
    const outcomes = [{ issue: 8, class: 'COMMITTED', parent: 7, order: 0 }];
    const { github, store, reconciler } = setup({ parentIssue: 7, outcomes, issues: gh => gh.addIssue(8, { parent: 7 }) });
    const doc = gatedChild(state, state.newChild({ repository: 'acme/app', outcome: outcomes[0] }), { role: gate, returnId: 'r1', verdict: 'ACCEPT', writer, parentDoc: store.read('parent', 7).doc, head: SHA_A });
    doc.candidate.branch = 'feature';
    store.write('child', 8, doc, { sha: null, previous: null });
    github.addPr(540, { head: SHA_A, merged: true, contexts: [green('validate')], branch: 'feature' });
    const report = reconciler().run();
    const accepted = gate !== 'G0';
    assert.deepEqual(report.close_list, [{ issue: 8, pr: 540, head: SHA_A, gate, gate_accepted: true, accepted, closable: accepted, uat: null, review: gate === 'G1' ? 'PASSED' : null }]);
    const finding = report.findings.find(entry => entry.code === 'READY_TO_CLOSE');
    assert.equal(finding.gate, gate);
    assert.equal(finding.accepted, accepted);
    assert.match(finding.detail, new RegExp(`${gate} acceptance recorded$`));
    const line = cli.formatReport(report).split('\n').find(text => text.startsWith('- #8: PR #540'));
    assert.ok(line.includes(`${gate} acceptance recorded`));
    assert.equal(line.endsWith('; completion not accepted'), !accepted);
    assert.equal(codes(report).includes('CHILD_STATE_CONFLICT #8'), !accepted);
    assert.equal(github.issues.get(8).state, 'open');
  }
});

test('binding checks name workflow jobs that always wait for every test job', () => {
  const root = path.resolve(__dirname, '..', '..');
  const binding = JSON.parse(fs.readFileSync(path.join(root, '.github/toolkit-programme.json'), 'utf8'));
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/validate.yml'), 'utf8');
  // Only the job keys and their text are needed; no YAML dependency or expression evaluation.
  const jobText = workflow.split(/^jobs:\s*$/m)[1];
  assert.ok(jobText, 'the workflow must define jobs');
  const jobs = new Map([...jobText.matchAll(/^  ([\w-]+):\r?\n([\s\S]*?)(?=^  [\w-]+:|(?![\s\S]))/gm)].map(match => [match[1], match[2]]));
  const tests = [...jobs].filter(([, body]) => /(?:^|\n)\s+(?:run:\s*)?(?:node\s+[^\n]*run-tests\.cjs(?![^\n]*--verify-ci)|node\s+--test\b|npm\s+(?:run\s+)?test\b)/.test(body)).map(([name]) => name);
  assert.ok(tests.length > 0, 'the workflow must contain test jobs');
  assert.ok(binding.required_checks.length > 0, 'the binding must require a check');
  for (const name of binding.required_checks) {
    const body = jobs.get(name);
    assert.ok(body, `required check ${name} must be a workflow job`);
    assert.match(body, /^    if: \$\{\{\s*always\(\)\s*\}\}\s*$/m, `${name} must run even after failed tests`);
    const needs = /^    needs:\s*\[([^\]]*)\]/m.exec(body)?.[1].split(',').map(value => value.trim().replace(/^['"]|['"]$/g, ''))
      || [...(body.match(/^    needs:\s*\r?\n((?:      - [\w-]+\r?\n)+)/m)?.[1] || '').matchAll(/- ([\w-]+)/g)].map(match => match[1]);
    for (const testJob of tests.filter(job => job !== name)) assert.ok(needs.includes(testJob), `${name} must need ${testJob}`);
  }
});

test('the close list excludes red, missing, pending or off-head checks, unmerged PRs and closed issues', () => {
  const cases = [
    { name: 'red', contexts: [{ ...green('validate'), conclusion: 'FAILURE' }] },
    { name: 'missing', contexts: [green('other')] },
    { name: 'pending', contexts: [{ ...green('validate'), status: 'IN_PROGRESS', conclusion: null }] },
    { name: 'off-head', rollupOid: SHA_B },
    { name: 'incomplete', hasNextPage: true },
    { name: 'no required checks', requiredChecks: [] },
    { name: 'open PR', merged: false },
    { name: 'closed issue', issueState: 'closed' },
  ];
  for (const variant of cases) {
    const outcomes = [{ issue: 8, class: 'COMMITTED', parent: 7, order: 0 }];
    const { github, store, binding, reconciler } = setup({ parentIssue: 7, outcomes, issues: gh => gh.addIssue(8, { parent: 7, state: variant.issueState || 'open' }) });
    const doc = state.newChild({ repository: 'acme/app', outcome: outcomes[0] });
    doc.candidate.branch = 'feature';
    store.write('child', 8, doc, { sha: null, previous: null });
    if (variant.requiredChecks) binding.required_checks = variant.requiredChecks;
    github.addPr(540, { head: SHA_A, merged: true, contexts: [green('validate')], branch: 'feature', ...variant });
    for (const apply of [false, true]) {
      const report = reconciler().run({ apply });
      assert.deepEqual(report.holds, [], variant.name);
      assert.equal(codes(report).includes('READY_TO_CLOSE #8'), false, variant.name);
      assert.deepEqual(report.close_list, [], variant.name);
      assert.equal(cli.formatReport(report).includes('Ready to close ('), false, variant.name);
    }
    assert.equal(github.issues.get(8).state, variant.issueState || 'open');
    assert.ok(github.calls.filter(call => call.method === 'PATCH' && /\/issues\/\d+$/.test(call.path)).every(call => !Object.hasOwn(call.body, 'state')));
  }
});

test('the command line binds identity, refuses writes without the controller flag or session and prints a readable plan', () => {
  const { github, binding } = setup();
  const output = [];
  const deps = { transport: github, binding, originUrl: 'https://github.com/acme/app.git', repoRoot: os.tmpdir(), toolkitVersion: '3.9.1', environment: {}, stdout: { write: text => output.push(text) } };
  assert.equal(cli.main(['reconcile'], deps), 0);
  assert.match(output.join(''), /Planned effects\n1\. /);
  assert.match(output.join(''), /Next action: Controller: run reconcile --apply --controller for this plan; other sessions report it/);
  assert.throws(() => cli.main(['reconcile', '--apply'], deps), { code: 'USAGE' });
  assert.throws(() => cli.main(['reconcile', '--apply', '--controller'], deps), { code: 'WRITER_UNKNOWN' });
  assert.throws(() => cli.main(['reconcile', '--apply', '--controller', '--parent-file', 'x.json', '--session', writer.session], deps), { code: 'USAGE' });
  assert.throws(() => cli.main(['reconcile'], { ...deps, originUrl: 'https://github.com/acme/other.git' }), { code: 'GH_FAILED' });
  assert.throws(() => cli.parseArgs(['reconcile', '--issue', 'abc']), { code: 'USAGE' });
  assert.throws(() => cli.parseArgs(['merge']), { code: 'USAGE' });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'programme-cli-'));
  try {
    const patch = path.join(dir, 'patch.json');
    fs.writeFileSync(patch, JSON.stringify({ next_action: 'Run the sandbox drill' }));
    const asController = args => cli.main([...args, '--session', writer.session, '--controller'], deps);
    output.length = 0;
    assert.equal(asController(['assign', '--issue', '423', '--role', 'G1', '--assignment', 'g1-a1', '--json']), 0);
    assert.equal(JSON.parse(output.join('')).epoch, 0, 'assigning a gate does not move the fence');
    asController(['return', '--issue', '423', '--record', 'r1', '--assignment', 'g1-a1']);
    asController(['return', '--issue', '423', '--consume', 'r1', '--verdict', 'REOPEN']);
    asController(['update', '--issue', '423', '--patch', patch]);
    output.length = 0;
    cli.main(['show', '--issue', '423'], deps);
    const shown = JSON.parse(output.join(''));
    assert.equal(shown.document.next_action, 'Run the sandbox drill');
    assert.equal(shown.document.gate.state, 'ACTIVE');
    assert.deepEqual(shown.document.gate.assignment, { id: 'g1-a1', role: 'G1' });
    assert.equal(shown.document.gate.returns.at(-1).verdict, 'REOPEN');
    assert.throws(() => cli.main(['update', '--issue', '423', '--patch', patch, '--session', 'someone-else'], deps), { code: 'USAGE' });
    assert.throws(() => cli.main(['update', '--issue', '423', '--patch', patch, '--session', 'someone-else', '--controller'], deps), { code: 'STALE_WRITER' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a task name with & is one topic on its task page, escaped once; untopiced parent comments are "Other comments"', () => {
  const outcomes = CATALOGUE.map(outcome => (outcome.issue === 423 ? { ...outcome, name: 'Setup & install' } : outcome));
  const { github, reconciler } = setup({ outcomes });
  comment(github, 423, 'Setup & install\n---\nINT-TK421-070 agreed');
  comment(github, 423, 'A note with no topic');
  comment(github, 421, 'A parent note with no topic');
  reconciler().run({ apply: true });
  const traceLines = number => state.findStateBlock(github.issues.get(number).body, state.TRACE_BLOCK_NAME).block.body.split('\n').filter(line => line.startsWith('- **'));
  const task = traceLines(423);
  assert.equal(task.length, 1, 'the tagged and untopiced comments share the task name line');
  assert.match(task[0], /^- \*\*Setup &amp; install:\*\* /);
  assert.doesNotMatch(github.issues.get(423).body, /&amp;amp;/);
  assert.match(traceLines(421).at(-1), /^- \*\*Other comments:\*\* /);
});

test('a page written by a newer Toolkit is held, not rewritten, so two versions never flip a page', () => {
  const { github, store, binding, reconciler, repository } = setup();
  reconciler().run({ apply: true });
  comment(github, 421, 'A newer note');
  const before = github.issues.get(421).body;
  const older = new state.Reconciler({
    store, reader: new state.ProgrammeGraphReader({ transport: github, repository }),
    mutator: new state.GitHubMutator({ transport: github, repository }), binding, writer, toolkitVersion: '3.9.0',
  });
  const report = older.run({ apply: true });
  const held = report.holds.find(entry => entry.code === 'BLOCK_NEWER_TOOLKIT' && entry.target === '#421');
  assert.ok(held, 'the older copy holds the page');
  assert.match(held.detail, /Toolkit 3\.9\.1, newer than this copy \(3\.9\.0\)/);
  assert.equal(github.issues.get(421).body, before, 'the page is left as the newer copy wrote it');
  reconciler().run({ apply: true });
  assert.notEqual(github.issues.get(421).body, before, 'the same version still writes it');
});
