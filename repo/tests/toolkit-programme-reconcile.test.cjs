'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const state = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');
const cli = require('../../skills/github-program-reconciler/scripts/programme.cjs');
const { FakeGitHub } = require('./toolkit-programme-fake-github.cjs');

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const writer = { session: 'controller-1', prefix: 'INT-TK421-' };
const green = name => ({ kind: 'CheckRun', name, status: 'COMPLETED', conclusion: 'SUCCESS', required: false });

const CATALOGUE = [
  { issue: 423, label: 'C2', class: 'CORE', parent: 421, order: 1, lane: 'integration' },
  { issue: 467, label: 'Shared H', class: 'CORE', parent: 421, order: 2, lane: 'integration' },
  { issue: 469, label: 'H1 Codex', class: 'CORE', parent: 467, order: 1, lane: 'codex', owner_prefix: 'CDX-TK469-' },
  { issue: 470, label: 'H2 Claude', class: 'CORE', parent: 467, order: 2, lane: 'claude' },
  { issue: 459, label: 'S1-A', class: 'COMPLETED', parent: 421, order: 3 },
  { issue: 422, label: 'C1 predecessor', class: 'RETIRED', parent: 421, order: 4 },
  { issue: 425, label: 'Q', class: 'OPTIONAL', parent: null, order: 0 },
  { issue: 499, label: 'R1', class: 'CORE', parent: null, order: 0 },
];

function setup({ repository = 'acme/app', parentIssue = 421, outcomes = CATALOGUE, issues = null, version = '3.9.0' } = {}) {
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
  const parent = state.claimDocument(state.newParent({ repository, parentIssue, outcomes }), writer, {});
  store.write('parent', parentIssue, parent, { sha: null, previous: null });
  const reconciler = (who = writer) => new state.Reconciler({
    store, reader: new state.ProgrammeGraphReader({ transport: github, repository }),
    mutator: new state.GitHubMutator({ transport: github, repository }), binding, writer: who, toolkitVersion: version,
  });
  return { github, store, binding, reconciler, repository, parentIssue };
}

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
  assert.ok(github.issues.get(421).body.endsWith('## CURRENT\nHand-written controller prose.\n'), 'hand-written text outside the block is kept');
  const rows = parentBlock.body.split('\n').filter(line => line.startsWith('| ') && !line.startsWith('| Outcome')).map(line => line.split(' | ')[0].slice(2));
  assert.deepEqual(rows, ['C2 #423', 'Shared H #467', 'H1 Codex #469 (under #467)', 'H2 Claude #470 (under #467)', 'S1-A #459', 'C1 predecessor #422', 'Q #425', 'R1 #499'], 'rows follow the tree');
});

test('reclassifying an outcome keeps its identity, document and native link', () => {
  const { github, store, reconciler } = setup();
  reconciler().run({ apply: true });
  const docBefore = store.read('child', 423).doc;
  store.mutate('parent', 421, { writer, change: doc => state.applyPatch('parent', doc, { outcomes: doc.outcomes.map(entry => (entry.issue === 423 ? { ...entry, class: 'HARDENING' } : entry)) }) });
  const report = reconciler().run({ apply: true });
  assert.deepEqual(kinds(report).sort(), ['replace_block #421', 'replace_block #423']);
  const docAfter = store.read('child', 423).doc;
  assert.equal(docAfter.revision, docBefore.revision);
  assert.deepEqual(docAfter.fence, docBefore.fence);
  assert.equal(github.issues.get(423).parent, 421);
  assert.match(state.findStateBlock(github.issues.get(423).body).block.body, /Class: HARDENING/);
});

test('a moved PR head marks evidence STALE_HEAD and updates both projections together', () => {
  const { github, store, reconciler } = setup();
  github.addPr(540, { head: SHA_A, contexts: [green('validate')], branch: 'feature' });
  reconciler().run({ apply: true });
  store.mutate('child', 423, { writer, parentDoc: store.read('parent', 421).doc, change: doc => state.applyPatch('child', doc, {
    candidate: { branch: 'feature', head: SHA_A }, uat: { state: 'PASSED', at_head: SHA_A }, review: { state: 'PASSED', verdicts: [{ reviewer: 'g2', head: SHA_A, verdict: 'PASSED' }] }, next_action: 'Owner merge decision',
  }) });
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
  assert.match(parentBlock, /PASSED \(STALE_HEAD, was aaaaaaa\)/);
  assert.match(parentBlock, new RegExp(`423:${doc.revision}\\b`));
  assert.match(childBlock, new RegExp(`child=423@${doc.revision} -->`));
  assert.match(parentBlock, new RegExp(`\\[bbbbbbb\\]\\(https://github.com/acme/app/commit/${SHA_B}\\) \`${SHA_B}\``), 'short link plus full SHA as text');
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
  assert.ok(github.issues.get(423).body.endsWith('A person added this line.'));
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
  const executor = { session: 'builder-7', prefix: 'INT-TK421-' };
  const claim = () => store.mutate('child', 470, { writer: executor, authorise: false, change: doc => state.claimDocument(doc, executor, { role: 'G1' }) });
  assert.equal(claim().outcome, 'WRITTEN');
  assert.equal(claim().outcome, 'NOOP', 'the same session claiming again starts no new gate');
  github.addPr(600, { head: SHA_A, merged: true, state: 'MERGED', contexts: [green('validate')], branch: 'h2-allow-list' });
  store.mutate('child', 470, { writer: executor, change: doc => state.applyPatch('child', doc, { candidate: { branch: 'h2-allow-list' } }) });
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

test('a second repository with a different catalogue works with no code change', () => {
  const outcomes = [{ issue: 8, class: 'CORE', parent: 7, order: 2 }, { issue: 9, class: 'LATER', parent: 7, order: 1 }];
  const { github, reconciler } = setup({
    repository: 'other/tool', parentIssue: 7, outcomes,
    issues: gh => { gh.addIssue(8); gh.addIssue(9); },
  });
  const report = reconciler().run({ apply: true });
  assert.deepEqual(report.holds, []);
  assert.deepEqual(github.issues.get(7).subs, [9, 8]);
  assert.equal(reconciler().run().summary, 'No changes');
});

test('the command line binds identity, refuses writes without a session and prints a readable plan', () => {
  const { github, binding } = setup();
  const output = [];
  const deps = { transport: github, binding, originUrl: 'https://github.com/acme/app.git', repoRoot: os.tmpdir(), toolkitVersion: '3.9.0', environment: {}, stdout: { write: text => output.push(text) } };
  assert.equal(cli.main(['reconcile'], deps), 0);
  assert.match(output.join(''), /Planned effects\n1\. /);
  assert.match(output.join(''), /Next action: Review this plan, then run reconcile --apply/);
  assert.throws(() => cli.main(['reconcile', '--apply'], deps), { code: 'WRITER_UNKNOWN' });
  assert.throws(() => cli.main(['reconcile', '--apply', '--parent-file', 'x.json', '--session', 's'], deps), { code: 'USAGE' });
  assert.throws(() => cli.main(['reconcile'], { ...deps, originUrl: 'https://github.com/acme/other.git' }), { code: 'GH_FAILED' });
  assert.throws(() => cli.parseArgs(['reconcile', '--issue', 'abc']), { code: 'USAGE' });
  assert.throws(() => cli.parseArgs(['merge']), { code: 'USAGE' });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'programme-cli-'));
  try {
    const patch = path.join(dir, 'patch.json');
    fs.writeFileSync(patch, JSON.stringify({ next_action: 'Run the sandbox drill' }));
    output.length = 0;
    assert.equal(cli.main(['claim', '--issue', '423', '--role', 'G1', '--session', 'builder-1', '--model', 'opus', '--effort', 'high', '--route-read-back', '--json'], deps), 0);
    assert.equal(JSON.parse(output.join('')).epoch, 1);
    output.length = 0;
    cli.main(['update', '--issue', '423', '--patch', patch, '--session', 'builder-1'], deps);
    cli.main(['return', '--issue', '423', '--submit', 'r1', '--session', 'builder-1'], deps);
    cli.main(['return', '--issue', '423', '--consume', 'r1', '--verdict', 'REOPEN', '--session', 'controller-1'], deps);
    output.length = 0;
    cli.main(['show', '--issue', '423'], deps);
    const shown = JSON.parse(output.join(''));
    assert.equal(shown.document.next_action, 'Run the sandbox drill');
    assert.equal(shown.document.gate.state, 'ACTIVE');
    assert.equal(shown.document.gate.session_id, '(redacted)');
    assert.deepEqual(shown.document.gate.route, { model: 'opus', effort: 'high', read_back: true });
    assert.throws(() => cli.main(['update', '--issue', '423', '--patch', patch, '--session', 'someone-else'], deps), { code: 'STALE_WRITER' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
