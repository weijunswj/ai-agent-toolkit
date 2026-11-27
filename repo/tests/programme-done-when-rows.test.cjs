'use strict';

// Every open task page carries DONE WHEN checkbox rows, so the programme graph's Progress count shows
// (INT-TK421-1396): the reader that finds plain or numbered rows and converts them (doneWhenRows), the
// sweep's DONE_WHEN_ROWS_MISSING finding, the `done-when-rows` backfill command, and the governance
// summary row that runs it on the owner's words. Red on main: none of them exist, so a task with
// numbered DONE WHEN rows (#1563, #1565 on 28 Nov) showed no count and nothing said so.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const rows = require('../../skills/github-program-reconciler/scripts/programme-child-rows.cjs');
const state = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');
const cli = require('../../skills/github-program-reconciler/scripts/programme.cjs');
const { FakeGitHub } = require('./toolkit-programme-fake-github.cjs');

const VERSION = '3.9.1';
const HOLDER = 'toolkit-421-controller';
const controller = { session: HOLDER, prefix: 'INT-TK421-' };
const temps = [];
const tmp = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'done-when-rows-')); temps.push(dir); return dir; };
test.after(() => { for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true }); });

const PLAIN = '# TASK\n\n## DONE WHEN\n\n- The first criterion.\n- The second one,\n  over two lines.\n\n**Not in scope:**\n\n- Something else.\n\n# PLAN\n\n- A plan step.\n';
const NUMBERED = '## DONE WHEN\r\n\r\n1. First.\r\n2) Second.\r\n10. Tenth.\r\n';
const MIXED = '## DONE WHEN\n\n* A star row.\n+ A plus row.\n3. A numbered row.\n   - a nested note\n- [] looks like a box\n';
const NONE = '## WHY\n\n- Not a done-when row.\n';
const BOXES = '## DONE WHEN\n\n- [ ] Open.\n- [x] Done.\n- A plain note beside them.\n';
const CODE = '## DONE WHEN\n\n```\n- in a code block\n```\n<!-- - in a comment -->\nA paragraph line\n2. continues the paragraph\n';
const GENERATED = '## DONE WHEN\n\n<!-- AI-AGENT-TOOLKIT:programme-state:BEGIN NOTE v2 toolkit=3.9.1 sha256=000000000000 -->\n- generated text\n<!-- AI-AGENT-TOOLKIT:programme-state:END NOTE -->\n';

test('the reader converts plain and numbered DONE WHEN rows, text and line endings kept, and nothing else', () => {
  const cases = [
    ['plain rows', PLAIN, '# TASK\n\n## DONE WHEN\n\n- [ ] The first criterion.\n- [ ] The second one,\n  over two lines.\n\n**Not in scope:**\n\n- Something else.\n\n# PLAN\n\n- A plan step.\n', 2],
    ['numbered rows (CRLF)', NUMBERED, '## DONE WHEN\r\n\r\n- [ ] First.\r\n- [ ] Second.\r\n- [ ] Tenth.\r\n', 3],
    ['mixed markers', MIXED, '## DONE WHEN\n\n* [ ] A star row.\n+ [ ] A plus row.\n- [ ] A numbered row.\n   - a nested note\n- [] looks like a box\n', 3],
    ['no DONE WHEN', NONE, NONE, 0],
    ['already checkboxes (a plain note beside them stays)', BOXES, BOXES, 0],
    ['rows in code, a comment, or continuing a paragraph', CODE, CODE, 0],
    ['rows in a generated block', GENERATED, GENERATED, 0],
  ];
  for (const [name, body, expected, converted] of cases) {
    const read = rows.doneWhenRows(body);
    assert.equal(read.body, expected, name);
    assert.equal(read.plain.length, converted, `${name}: rows converted`);
    const before = rows.rowTicks(body).done_when, after = rows.rowTicks(read.body).done_when;
    assert.equal(after.total, before.total + converted, `${name}: the count gains exactly the converted rows`);
    assert.equal(after.ticked, before.ticked, `${name}: no row is ticked`);
  }
  assert.equal(rows.doneWhenRows(NONE).heading, false);
  assert.equal(rows.doneWhenRows(CODE).heading, true);
  assert.deepEqual(rows.doneWhenRows(PLAIN).plain[0], { line: 5, from: '- The first criterion.', to: '- [ ] The first criterion.' });
});

// The backfill writes a page from free text, so it reads a default-deny subset (programme-child-rows
// doneWhenRows): any shape outside it is left as written.
const hostile = require('./support/hostile-inputs.cjs');
const ROWS_BASE = impostor => `# TASK\n\n## DONE WHEN\n\n${impostor}\n\n# PLAN\n\nNow.\n`;
const PLAN_ROWS = impostor => `# TASK\n\n## DONE WHEN\n\nProse only.\n\n# PLAN\n\n${impostor}\n`;
const point = code => String.fromCodePoint(code);
const PLAIN_IMPOSTORS = [
  ...[
    ['backtick-fence', '```\n- fake\n```'],
    ['tilde-fence', '~~~\n- fake\n~~~'],
    ['unclosed-fence', '```\n- fake'],
    ['comment', '<!--\n- fake\n-->'],
    ['quote', '> - fake'],
    ['tab-indent', '\t- fake'],
    ['indented-code', '    - fake'],
    ['zero-width-before', `${point(0x200b)}- fake`],
    ['nbsp-after-marker', `-${point(0xa0)}fake`],
    ['en-dash', `${point(0x2013)} fake`],
    ['bullet-character', `${point(0x2022)} fake`],
    ['no-space', '-fake'],
    ['empty-item', '- '],
    ['thematic-break', '- - -'],
    ['nested-only', '- [ ] a real box\n  - fake nested'],
    ['box-shaped', '- [] fake'],
    ['paragraph-continuation', 'A paragraph\n2. fake'],
    ['not-in-scope', '**Not in scope:**\n\n- fake'],
    ['generated-block', '<!-- AI-AGENT-TOOLKIT:programme-state:BEGIN NOTE v2 toolkit=3.9.1 sha256=000000000000 -->\n- fake\n<!-- AI-AGENT-TOOLKIT:programme-state:END NOTE -->'],
    ...['cr', 'nel', 'ls', 'ps'].map(name => [`joined-by-${name}`, `a note${hostile.BREAKS[name]}- fake`]),
  ].map(([id, text]) => ({ id, text: ROWS_BASE(text) })),
  ...[
    ['heading-in-fence', '```\n## DONE WHEN\n- fake\n```'],
    ['heading-in-comment', '<!--\n## DONE WHEN\n- fake\n-->'],
    ['heading-without-space', '#DONE WHEN\n- fake'],
    ['heading-four-space-indent', '    ## DONE WHEN\n- fake'],
    ['heading-other-words', '## NOT DONE WHEN\n- fake'],
    ['heading-with-bom', `${point(0xfeff)}## DONE WHEN\n- fake`],
  ].map(([id, text]) => ({ id: `plan-${id}`, text: PLAN_ROWS(text) })),
];

test('the backfill reader converts no shape outside its subset (hostile inputs)', () => {
  const converts = text => rows.doneWhenRows(text).plain.length > 0;
  assert.equal(converts(ROWS_BASE('- a real row')), true, 'control: a plain row converts');
  assert.equal(converts(ROWS_BASE('1. a real row')), true, 'control: a numbered row converts');
  hostile.expectDefaultDeny(assert, converts, PLAIN_IMPOSTORS);
  // A converted page changes only the converted lines, each to its marker, `[ ] ` and the same text.
  const real = ROWS_BASE('- a real row\n2. a second row');
  for (const variant of [real, ...hostile.variants(real).map(shape => shape.text)]) {
    const read = rows.doneWhenRows(variant);
    const before = variant.split('\n'), after = read.body.split('\n');
    assert.equal(after.length, before.length);
    const changed = before.map((line, index) => index).filter(index => before[index] !== after[index]);
    assert.deepEqual(changed.map(index => index + 1), read.plain.map(row => row.line));
    for (const row of read.plain) assert.match(row.to, /^ {0,3}[-*+] \[ \] \S/);
  }
  const large = hostile.timing(rows.doneWhenRows, size => ROWS_BASE('- row\n'.repeat(Math.ceil(size / 6))));
  assert.ok(large.ok, large.message);
});

test('the reader keeps the rowTicks count it shares the walk with', () => {
  const page = `${PLAIN}\n## ROWS\n\n- [x] a polish row\n\n<!-- AI-AGENT-TOOLKIT:programme-state:BEGIN STATE v2 toolkit=3.9.1 sha256=000000000000 -->\n# PR GRAPH\n<!-- AI-AGENT-TOOLKIT:programme-state:END STATE -->\n`;
  assert.deepEqual(rows.rowTicks(page), { ticked: 1, unticked: 0, merged: [], done_when: { ticked: 0, total: 0 } });
  assert.deepEqual(rows.rowTicks(rows.doneWhenRows(page).body), { ticked: 1, unticked: 2, merged: [], done_when: { ticked: 0, total: 2 } });
});

// A programme under #421 whose tasks have the given pages; tasks are native sub-issues of #421.
function programme(tasks) {
  const repository = 'acme/app';
  const github = new FakeGitHub({ repository, store: 'acme/state-store' });
  const binding = { schema: state.SCHEMA.binding, repository, parent_issue: 421, record_prefix: 'INT-TK421-', writer_prefix: 'INT-TK421-',
    store: { kind: 'github', repository: 'acme/state-store', branch: 'main', path: `state/${repository}/` }, required_checks: ['validate'] };
  github.addIssue(421, { body: '## CURRENT\n' });
  for (const task of tasks) github.addIssue(task.issue, { parent: task.parent === undefined ? 421 : task.parent, body: task.body, state: task.state || 'open' });
  const outcomes = tasks.filter(task => task.parent === undefined).map((task, i) => ({ issue: task.issue, class: 'COMMITTED', parent: 421, order: i + 1 }));
  const now = () => new Date(github.clock).toISOString();
  const store = new state.StateStore({ transport: github, store: binding.store, now, toolkitVersion: VERSION });
  store.write('parent', 421, state.claimDocument(state.newParent({ repository, parentIssue: 421, outcomes }), controller, {}), { sha: null, previous: null });
  for (const outcome of outcomes) store.write('child', outcome.issue, state.newChild({ repository, outcome }), { sha: null, previous: null });
  const fx = { github, store, binding };
  fx.run = argv => {
    let output = '';
    let code = null, error = null;
    try {
      code = cli.main(['done-when-rows', ...argv, '--json'], { transport: github, binding, originUrl: 'https://github.com/acme/app.git', repoRoot: tmp(), toolkitVersion: VERSION,
        now, environment: {}, stdout: { write: text => { output += text; } }, stderr: { write: () => {} } });
    } catch (thrown) { error = thrown; }
    return { code, error, result: output ? JSON.parse(output) : null };
  };
  fx.pass = () => new state.Reconciler({ store, reader: new state.ProgrammeGraphReader({ transport: github, repository }), mutator: new state.GitHubMutator({ transport: github, repository }),
    binding, writer: state.refreshWriter(store.read('parent', 421).doc), toolkitVersion: VERSION, refreshFacts: true, now }).run({ apply: true });
  fx.open = (code, issue) => (store.read('parent', 421).doc.attention || []).find(entry => entry.code === code && entry.issue === issue && ['new', 'acknowledged'].includes(entry.state)) || null;
  fx.bodyWrites = () => github.calls.filter(call => call.method === 'PATCH' && /\/issues\/\d+$/.test(call.path));
  fx.copies = issue => github.calls.filter(call => call.method === 'PUT' && call.path.includes(`page-copies/issue-${issue}/`));
  return fx;
}

test('the sweep raises DONE_WHEN_ROWS_MISSING for an open task without DONE WHEN checkbox rows, and it resolves once they are there', () => {
  const fx = programme([
    { issue: 71, body: NONE }, { issue: 72, body: PLAIN }, { issue: 73, body: NUMBERED }, { issue: 74, body: BOXES },
    { issue: 75, body: CODE }, { issue: 76, body: '## DONE WHEN\n\nOnly prose here.\n' },
  ]);
  const report = fx.pass();
  for (const number of [71, 72, 73, 75, 76]) assert.ok(fx.open('DONE_WHEN_ROWS_MISSING', number), `#${number} raises`);
  assert.equal(fx.open('DONE_WHEN_ROWS_MISSING', 74), null, 'a page with checkbox rows raises none');
  const detail = number => report.findings.find(entry => entry.code === 'DONE_WHEN_ROWS_MISSING' && entry.issue === number)?.detail;
  assert.equal(detail(71), 'the page has no DONE WHEN section');
  assert.equal(detail(72), 'its DONE WHEN has 2 plain or numbered list row(s) and no checkbox row; done-when-rows --apply converts them');
  assert.equal(detail(76), 'its DONE WHEN has no list rows');
  const row = state.FINDING_CODES.DONE_WHEN_ROWS_MISSING;
  assert.equal(row.net, true);
  assert.equal(row.no_dispose, true, 'it clears only when the rows are there');
  assert.match(row.next_action, /done-when-rows command, --issue <n> --apply/);
  fx.github.issues.get(72).body = rows.doneWhenRows(PLAIN).body; fx.github.tick();
  fx.github.issues.get(71).body = `${NONE}\n## DONE WHEN\n\n- [ ] Written by the controller.\n`; fx.github.tick();
  fx.pass();
  assert.equal(fx.open('DONE_WHEN_ROWS_MISSING', 72), null, 'converted rows resolve it');
  assert.equal(fx.open('DONE_WHEN_ROWS_MISSING', 71), null, 'written rows resolve it');
  assert.ok(fx.open('DONE_WHEN_ROWS_MISSING', 73), 'the others stay');
});

test('done-when-rows is a dry run anyone may make: it lists the pages to convert and the ones without rows, and writes nothing', () => {
  const fx = programme([{ issue: 71, body: NONE }, { issue: 72, body: PLAIN }, { issue: 73, body: NUMBERED }, { issue: 74, body: BOXES }, { issue: 77, body: PLAIN, state: 'closed' }]);
  const before = fx.github.calls.length;
  const { result, code, error } = fx.run([]);
  assert.equal(error, null);
  assert.equal(code, 0);
  assert.equal(result.mode, 'dry-run');
  assert.equal(result.read, 4, 'the open sub-issues only');
  assert.deepEqual(result.pages.map(page => [page.issue, page.rows.length]), [[72, 2], [73, 3]]);
  assert.deepEqual(result.missing.map(page => [page.issue, page.why]), [[71, 'no DONE WHEN section']]);
  assert.match(result.lines[0], /^2 open task page\(s\) have plain or numbered DONE WHEN rows to turn into checkboxes: #72, #73\.$/);
  assert.deepEqual(fx.github.calls.slice(before).filter(call => call.method !== 'GET' && call.path !== 'graphql'), [], 'nothing written');
  assert.equal(fx.github.issues.get(72).body, PLAIN);
});

test('done-when-rows --apply is the parent holder\'s write: each page is copied, re-read, written and read back', () => {
  const fx = programme([{ issue: 72, body: PLAIN }, { issue: 73, body: NUMBERED }, { issue: 74, body: BOXES }]);
  assert.match(fx.run(['--apply']).error.message, /Only the appointed controller writes programme state/);
  assert.equal(fx.run(['--apply', '--controller', '--session', 'someone-else']).error.code, 'STALE_WRITER');
  assert.deepEqual(fx.bodyWrites(), [], 'nothing written by a refused run');
  const { result, code } = fx.run(['--apply', '--controller', '--session', HOLDER]);
  assert.equal(code, 0);
  assert.equal(result.outcome, 'DONE');
  assert.deepEqual(result.results.map(entry => [entry.issue, entry.outcome, entry.rows]), [[72, 'DONE', 2], [73, 'DONE', 3]]);
  assert.equal(fx.github.issues.get(72).body, rows.doneWhenRows(PLAIN).body);
  assert.equal(fx.github.issues.get(73).body, rows.doneWhenRows(NUMBERED).body);
  assert.equal(fx.github.issues.get(74).body, BOXES, 'a page with checkbox rows is not touched');
  for (const issue of [72, 73]) {
    const copy = fx.copies(issue)[0];
    assert.ok(copy, `#${issue}: the page as it was is saved first`);
    assert.ok(fx.github.calls.indexOf(copy) < fx.github.calls.indexOf(fx.bodyWrites().find(call => call.path.endsWith(`/issues/${issue}`))), `#${issue}: copy before write`);
  }
  const again = fx.run(['--apply', '--controller', '--session', HOLDER]).result;
  assert.equal(again.outcome, 'NOOP', 'a second run finds nothing to convert');
});

test('the backfill leaves a page that changed since the plan, and refuses a task that is not the programme\'s', () => {
  const fx = programme([{ issue: 72, body: PLAIN }, { issue: 73, body: NUMBERED }, { issue: 90, body: PLAIN, parent: null }]);
  const { DoneWhenBackfill } = require('../../skills/github-program-reconciler/scripts/programme-done-when-backfill.cjs');
  const backfill = new DoneWhenBackfill({ transport: fx.github, repository: 'acme/app', parents: [421], store: fx.store });
  const plan = backfill.plan();
  fx.github.issues.get(72).body = `${PLAIN}\nA line someone added.\n`;
  const result = backfill.apply(plan);
  assert.equal(result.outcome, 'PARTIAL');
  assert.deepEqual(result.results.map(entry => [entry.issue, entry.outcome, entry.code || null]), [[72, 'REFUSED', 'BODY_MOVED'], [73, 'DONE', null]]);
  assert.equal(fx.github.issues.get(72).body, `${PLAIN}\nA line someone added.\n`, 'the changed page is left as it is');
  assert.equal(fx.run(['--issue', '90']).error.code, 'BACKFILL_REFUSED');
  // From the command line, a refused page makes the run PARTIAL with exit code 1.
  fx.github.issues.get(72).body = PLAIN;
  fx.github.intercept(call => call.method === 'PATCH' && call.path.endsWith('/issues/72') ? { status: 502, json: {} } : null);
  const partial = fx.run(['--apply', '--controller', '--session', HOLDER]);
  assert.equal(partial.code, 1);
  assert.equal(partial.result.outcome, 'PARTIAL');
  assert.equal(partial.result.results[0].outcome, 'REFUSED');
  assert.equal(fx.github.issues.get(72).body, PLAIN);
  assert.deepEqual(fx.run(['--issue', '72']).result.pages.map(page => page.issue), [72], 'one named task');
});

// ---- the governance summary row ---------------------------------------------------------------
const governanceScripts = path.join(__dirname, '..', 'scripts');
const summary = require(path.join(governanceScripts, 'toolkit-governance-summary.cjs'));
const stepModule = () => require(path.join(governanceScripts, 'toolkit-governance-done-when.cjs'));

test('the governance summary shows the backfill dry run, and only offers the change while pages are left', () => {
  const rowOf = doneWhen => summary.summaryRows({ doneWhen }).rows.find(row => row[0] === 'Task DONE WHEN rows') || null;
  assert.deepEqual(rowOf({ pages: [72, 73], missing: [71] }).slice(1), [
    '2 pages have plain rows (#72, #73); say convert done-when rows; 1 without rows for the controller to write (#71)',
    "Checkbox rows under each open task's DONE WHEN, so the programme graph shows its Progress count"]);
  assert.equal(rowOf({ pages: [], missing: [] })[1], 'No plain rows to convert');
  assert.equal(rowOf({ unread: true })[1], 'Not read: the task pages could not be read just now');
  assert.equal(rowOf(null), null, 'no row once the repository is done');
  assert.deepEqual(summary.parseChange('Convert done-when rows.', { rows: true }), { convertRows: true });
  assert.throws(() => summary.parseChange('convert done-when rows', { rows: false }), /not read as a change/);
});

test('the step reads the pages until nothing is left to convert, then stops reading for that repository', () => {
  const registryOptions = { registryPath: path.join(tmp(), 'home', '.ai-agent-toolkit', 'user-state', 'repository-governance.v1.json'), testOnly: true };
  const calls = [];
  let left = [72];
  const backfill = (root, { apply }) => {
    calls.push(apply ? 'apply' : 'dry-run');
    const pages = left.map(issue => ({ issue }));
    if (apply) left = [];
    return apply ? { results: pages.map(page => ({ issue: page.issue, outcome: 'DONE' })), missing: [] } : { pages, missing: [] };
  };
  const { DoneWhenBackfillStep } = stepModule();
  const step = new DoneWhenBackfillStep({ registryOptions, backfill });
  const repo = { repository_id: 'github.com/acme/app#1', root: '/fixture' };
  assert.deepEqual(step.facts(repo), { pages: [72], missing: [] });
  const applied = step.apply(repo);
  assert.equal(applied.ok, true);
  assert.match(applied.lines[0], /^Converted the DONE WHEN rows on 1 task page\(s\): #72\. Each page was saved to the private store first and read back after\.$/);
  assert.equal(step.facts(repo), null, 'done once: no row and no read');
  assert.deepEqual(calls, ['dry-run', 'apply']);
  const failing = new DoneWhenBackfillStep({ registryOptions, backfill: () => { throw Object.assign(new Error('x'), { code: 'GH_FAILED' }); } });
  assert.deepEqual(failing.facts({ repository_id: 'other', root: '/fixture' }), { unread: true });
  assert.equal(new DoneWhenBackfillStep({ registryOptions, backfill: null }).facts(repo), null, 'no backfill here (tests, offline): no row');
});

test('refresh governance shows the row, and the owner\'s convert done-when rows runs the backfill once', async () => {
  const { makeGoverned, recordMerged } = require('./toolkit-governed-fixture-support.cjs');
  const gate = require('../scripts/toolkit-governance-gate.cjs');
  const governance = require('../scripts/toolkit-governance-state.cjs');
  const { ToolkitGovernanceCli } = require('../scripts/toolkit-governance.cjs');
  const { BankTickets } = require('../scripts/toolkit-governance-bank.cjs');
  const base = tmp();
  const home = path.join(base, 'home');
  const repoDir = makeGoverned(path.join(base, 'rows'), 'rows', { home });
  const registryPath = path.join(home, '.ai-agent-toolkit', 'user-state', 'repository-governance.v1.json');
  const registryOptions = { registryPath, testOnly: true };
  const text = `${JSON.stringify({ schema: 'toolkit.programme-binding.v2', repository: 'toolkit-test-fixture/rows', governance: 'enabled',
    parents: [{ issue: 1, record_prefix: 'INT-FX', writer_prefix: 'FX' }], store: { kind: 'github', repository: 'toolkit-test-fixture/store', branch: 'main', path: 'state/' },
    required_checks: ['validate'] }, null, 2)}\n`;
  fs.writeFileSync(path.join(repoDir, '.github', 'toolkit-programme.json'), text);
  recordMerged(repoDir, { registryPath, text });
  const calls = [];
  let left = [72, 73];
  const doneWhenBackfill = (root, { apply }) => {
    calls.push([path.resolve(root) === path.resolve(repoDir), apply]);
    const pages = left.map(issue => ({ issue }));
    if (apply) left = [];
    return apply ? { results: pages.map(page => ({ issue: page.issue, outcome: 'DONE' })), missing: [{ issue: 71 }] } : { pages, missing: [{ issue: 71 }] };
  };
  const SESSION = 'session-owner-rows';
  const run = async argv => {
    let out = '', err = '';
    const code = await new ToolkitGovernanceCli({
      stdout: { write: chunk => { out += chunk; return true; } }, stderr: { write: chunk => { err += chunk; return true; } },
      cwd: repoDir, interactive: false, registryOptions, ask: async () => '', refresh: () => ({ refreshed: true }), hookReader: () => null, queueReader: () => null,
      permissionsChecker: () => ({ checked: true, host: 'claude', missing: 0, stale: 0 }), environment: { TOOLKIT_HOST_SESSION: SESSION }, doneWhenBackfill,
    }).main(argv);
    return { code, out, err };
  };
  new gate.SessionEpochs({ registryOptions }).start(SESSION, 'startup', governance.governanceState(repoDir, registryOptions).repository_id);
  const shown = await run(['setup']);
  assert.equal(shown.code, 0, shown.err);
  assert.match(shown.out, /^\| Task DONE WHEN rows \| 2 pages have plain rows \(#72, #73\); say convert done-when rows; 1 without rows for the controller to write \(#71\) \|/m);
  const epoch = new gate.SessionEpochs({ registryOptions }).get(SESSION);
  const reference = new BankTickets({ registryOptions }).pendingFor(SESSION, epoch).bank_reference;
  const ticket = new BankTickets({ registryOptions }).issue(SESSION, epoch);
  const answered = await run(['setup', '--answers', `${reference}: convert done-when rows`, '--ticket', ticket]);
  assert.equal(answered.code, 0, answered.err);
  assert.match(answered.out, /Converted the DONE WHEN rows on 2 task page\(s\): #72, #73\./);
  assert.match(answered.out, /Still without checkbox rows, for the controller to write: #71\./);
  assert.deepEqual(calls, [[true, false], [true, false], [true, true]], 'a dry run for each showing, then the backfill on the owner\'s words, in this repository');
  const after = await run(['setup']);
  assert.doesNotMatch(after.out, /Task DONE WHEN rows/, 'done once: no row');
  assert.equal(calls.length, 3, 'and no further read');
});
