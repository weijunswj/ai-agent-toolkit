'use strict';

// Fence, authority and evidence-truth cases for the programme reconciler, including the closure
// cases from its first independent review: a takeover stops a running pass, an executor cannot
// record its own acceptance, head-bound evidence without a head reads stale, a body hold leaves the
// links alone, secret-shaped values are refused, and runtime validation matches the schemas.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const Ajv2020 = require('ajv/dist/2020');
const state = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');
const { FakeGitHub, gatedChild } = require('./toolkit-programme-fake-github.cjs');

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const controller = { session: 'controller-1', prefix: 'INT-TK421-' };
const successor = { session: 'controller-2', prefix: 'INT-TK421-' };
const builder = { session: 'builder-1', prefix: 'INT-TK421-' };
const green = name => ({ kind: 'CheckRun', name, status: 'COMPLETED', conclusion: 'SUCCESS', required: false });
const CATALOGUE = [
  { issue: 423, label: 'C2', class: 'CORE', parent: 421, order: 1 },
  { issue: 467, label: 'Shared H', class: 'CORE', parent: 421, order: 2 },
  { issue: 469, label: 'H1', class: 'CORE', parent: 467, order: 1 },
  { issue: 470, label: 'H2', class: 'CORE', parent: 467, order: 2 },
  { issue: 471, label: 'H3', class: 'CORE', parent: 467, order: 3 },
];

function setup({ initialiseParent = true } = {}) {
  const repository = 'acme/app';
  const github = new FakeGitHub({ repository, store: 'acme/state-store' });
  const binding = {
    schema: state.SCHEMA.binding, repository, parent_issue: 421, record_prefix: 'INT-TK421-', writer_prefix: 'INT-TK421-',
    store: { kind: 'github', repository: 'acme/state-store', branch: 'main', path: `state/${repository}/` }, required_checks: ['validate'],
  };
  github.addIssue(421, { body: '## CURRENT\n' });
  for (const outcome of CATALOGUE) github.addIssue(outcome.issue, { body: `Body of ${outcome.issue}` });
  let clock = 0;
  const store = new state.StateStore({ transport: github, store: binding.store, now: () => `T${clock += 1}`, toolkitVersion: '3.9.0' });
  if (initialiseParent) store.write('parent', 421, state.claimDocument(state.newParent({ repository, parentIssue: 421, outcomes: CATALOGUE }), controller, {}), { sha: null, previous: null });
  const reconciler = (who = controller) => new state.Reconciler({
    store, reader: new state.ProgrammeGraphReader({ transport: github, repository }),
    mutator: new state.GitHubMutator({ transport: github, repository }), binding, writer: who, toolkitVersion: '3.9.0',
  });
  const parentDoc = () => store.read('parent', 421).doc;
  const assignG1 = () => store.mutate('child', 423, { writer: controller, parentDoc: parentDoc(), create: () => state.newChild({ repository, outcome: CATALOGUE[0] }), change: doc => state.assignGate(doc, { assignment: 'g1-a1', role: 'G1' }) });
  return { github, store, binding, reconciler, parentDoc, assignG1 };
}

test('a takeover during a pass stops the old writer before its next GitHub or state write', () => {
  const { github, store, reconciler } = setup();
  let takenAt = null;
  github.intercept(call => {
    if (takenAt === null && call.method === 'POST' && /\/sub_issues$/.test(call.path)) {
      store.mutate('parent', 421, { writer: successor, authorise: false, change: doc => state.claimDocument(doc, successor, { takeover: true }) });
      takenAt = github.calls.length;
    }
    return undefined;
  });
  assert.throws(() => reconciler(controller).run({ apply: true }), { code: 'STALE_WRITER' });
  const writesAfter = github.calls.slice(takenAt).filter(call => call.method !== 'GET' && call.path !== 'graphql');
  assert.deepEqual(writesAfter.map(call => `${call.method} ${call.path}`), [], 'the old writer made no GitHub or store write after the takeover');
  // The interrupted attach is left IN_FLIGHT and the successor settles it by readback, without replay.
  const inFlight = store.read('child', 423).doc.pending_effects;
  assert.deepEqual(inFlight.map(effect => effect.state), ['IN_FLIGHT']);
  const attachesBefore = github.calls.filter(call => call.method === 'POST' && call.body?.sub_issue_id === github.issues.get(423).id).length;
  const recovered = reconciler(successor).run({ apply: true });
  assert.ok(recovered.recovered.some(entry => entry.outcome === 'DONE'));
  assert.equal(github.calls.filter(call => call.method === 'POST' && call.body?.sub_issue_id === github.issues.get(423).id).length, attachesBefore);
  assert.deepEqual(recovered.holds, []);
  assert.equal(reconciler(successor).run().summary, 'No changes');
});

test('an executor can neither record nor accept a return in the child document; the controller can', () => {
  const { github, store, parentDoc, assignG1 } = setup();
  assignG1();
  const commits = github.commits;
  assert.throws(() => store.mutate('child', 423, { writer: builder, parentDoc: parentDoc(), change: doc => state.recordReturn(doc, { returnId: 'r1', assignment: 'g1-a1' }) }), { code: 'STALE_WRITER' });
  store.mutate('child', 423, { writer: controller, parentDoc: parentDoc(), change: doc => state.recordReturn(doc, { returnId: 'r1', assignment: 'g1-a1' }) });
  assert.throws(() => store.mutate('child', 423, { writer: builder, parentDoc: parentDoc(), change: doc => state.consumeReturn(doc, { returnId: 'r1', verdict: 'REOPEN', writer: builder, parentDoc: parentDoc() }) }), { code: 'STALE_WRITER' });
  assert.equal(github.commits, commits + 1, 'only the controller\'s write reached the store');
  assert.equal(store.read('child', 423).doc.gate.state, 'SUBMITTED');
  store.mutate('child', 423, { writer: controller, parentDoc: parentDoc(), change: doc => state.consumeReturn(doc, { returnId: 'r1', verdict: 'REOPEN', writer: controller, parentDoc: parentDoc() }) });
  assert.equal(store.read('child', 423).doc.gate.state, 'ACTIVE');
});

test('claim rejects missing, ambiguous and invalid targets before opening the store', () => {
  const cli = require('../../skills/github-program-reconciler/scripts/programme.cjs');
  const { github, store, binding } = setup();
  const before = store.read('parent', 421).doc;
  const calls = github.calls.length;
  const writes = github.commits;
  for (const args of [
    ['--role', 'G1', '--takeover'],
    ['--issue', '0', '--role', 'G1', '--takeover'],
    ['--parent', '--role', 'G1'],
    ['--parent', '--issue', '423'],
    ['--issue', '-1'], ['--issue', '1.5'], ['--issue', '9007199254740992'],
  ]) {
    assert.throws(() => cli.main(['claim', ...args, '--session', builder.session], {
      transport: github, binding, originUrl: 'https://github.com/acme/app.git', repoRoot: __dirname,
    }), { code: 'USAGE' }, args.join(' '));
    assert.equal(github.calls.length, calls, 'usage is checked before any transport or store access');
    assert.equal(github.commits, writes, 'no store writes');
  }
  assert.deepEqual(store.read('parent', 421).doc, before, 'the parent and its epoch are unchanged');
});

test('an assignment the controller issues after planning survives applying a planned create_state', () => {
  const { store, reconciler, parentDoc } = setup();
  const pass = reconciler();
  const plan = pass.plan();
  const effect = plan.effects.find(entry => entry.kind === 'create_state' && entry.target.issue === 423);
  assert.ok(effect);
  const assigned = store.mutate('child', 423, {
    writer: controller, parentDoc: parentDoc(), create: () => state.newChild({ repository: 'acme/app', outcome: CATALOGUE[0] }),
    change: doc => state.assignGate(doc, { assignment: 'g0-a1', role: 'G0' }),
  }).doc;
  const applied = pass.apply(plan);
  assert.deepEqual(applied.holds, []);
  const after = store.read('child', 423).doc;
  for (const key of ['gate', 'lifecycle', 'fence', 'candidate', 'release', 'next_action', 'private']) {
    assert.deepEqual(after[key], assigned[key], `${key} survives apply`);
  }
  assert.deepEqual(after.pr, effect.doc.pr, 'observed PR fields are applied');
  assert.doesNotThrow(() => state.recordReturn(after, { returnId: 'g0-r1', assignment: 'g0-a1' }));
});

// Only the appointed controller writes. The matrix runs every CLI command, in every
// scenario, as every role, in text and JSON output:
// - any write without --controller is USAGE before any GitHub or store call;
// - a non-holder that adds --controller is refused by the fence and changes nothing, except the two
//   inherently self-declared steps (creating a missing parent, a deliberate parent takeover), which
//   only the text guards and which this matrix therefore leaves out;
// - no output tells a non-controller to use --controller, --takeover, --consume or init-parent, and
//   every sentence about --apply or init-parent is addressed to the controller;
// - the controller's writes succeed or fail only for state reasons.
test('only the appointed controller writes: every command x scenario x role', () => {
  const cli = require('../../skills/github-program-reconciler/scripts/programme.cjs');
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'programme-split-'));
  const file = (name, value) => { const target = path.join(dir, `${name}.json`); fs.writeFileSync(target, JSON.stringify(value)); return target; };
  const catalogue = file('catalogue', { outcomes: CATALOGUE });
  const patches = {
    ordinary: file('ordinary', { next_action: 'Continue the build' }),
    uat: file('uat', { uat: { state: 'PASSED', at_head: SHA_A } }),
    done: file('done', { lifecycle: 'DONE' }),
    parent: file('parent', { private: { note: 'Catalogue change' } }),
  };
  const writes = [
    ['reconcile', '--apply'], ['init-parent', '--catalogue', catalogue, '--apply'], ['update-parent', '--patch', patches.parent],
    ['claim', '--parent'], ['claim', '--parent', '--takeover'], ['claim', '--issue', '423', '--lane'],
    ['assign', '--issue', '423', '--role', 'G1', '--assignment', 'g1-new'], ['assign', '--issue', '423', '--role', 'G1', '--assignment', 'g1-new', '--supersede', '--reason', 'lost'],
    ['reopen', '--issue', '423', '--reason', 'correction', '--assignment', 'g1-fix'], ['reopen', '--issue', '423', '--reason', 'correction'],
    ['interrupt', '--issue', '423', '--reason', 'lost'], ['update', '--issue', '423', '--patch', patches.ordinary],
    ['update', '--issue', '423', '--patch', patches.uat], ['update', '--issue', '423', '--patch', patches.done],
    ['return', '--issue', '423', '--record', 'r9', '--assignment', 'g1-a1'], ['return', '--issue', '423', '--consume', 'r1', '--verdict', 'ACCEPT'],
    ['return', '--issue', '423', '--consume', 'r1', '--verdict', 'REOPEN'],
  ];
  const reads = [['reconcile'], ['reconcile', '--issue', '423'], ['show', '--parent'], ['show', '--issue', '423'], ['init-parent', '--catalogue', catalogue]];
  const scenarios = [
    { name: 'no parent', parent: false },
    { name: 'parent held by the controller' },
    { name: 'child held by the controller with a submitted return', child: true },
    { name: 'body hold present', child: true, hold: true },
    { name: 'settled', child: true, settled: true },
  ];
  const others = [builder, successor, { session: 'reviewer-g2', prefix: 'INT-TK421-' }, { session: 'helper-1', prefix: 'INT-TK421-' }];
  const inherent = args => (args[0] === 'init-parent' && args.includes('--apply')) || (args[0] === 'claim' && args.includes('--takeover') && args.includes('--parent'));
  // A controller-only option or command may appear only in a sentence addressed to the controller.
  const addressed = text => {
    for (const sentence of text.split(/\n|(?<=[.!?])\s+/)) {
      if (!/--apply|--controller|--takeover|--consume|--verdict|init-parent|update-parent|claim --parent/.test(sentence)) continue;
      assert.match(sentence, /(?:^|: )"?(?:Controller:|The appointed controller|Only the appointed controller|The new controller)/, `not addressed to the controller: ${sentence}`);
    }
  };
  let cases = 0;
  try {
    for (const scenario of scenarios) {
      const prepare = () => {
        const fixture = setup({ initialiseParent: scenario.parent !== false });
        if (scenario.child) {
          const doc = gatedChild(state, state.newChild({ repository: 'acme/app', outcome: CATALOGUE[0] }), { role: 'G1', returnId: 'r1' });
          fixture.store.write('child', 423, doc, { sha: null, previous: null });
        }
        if (scenario.hold) fixture.github.issues.get(421).body = 'x'.repeat(59990);
        if (scenario.settled) fixture.reconciler().run({ apply: true });
        return fixture;
      };
      for (const json of [false, true]) {
        for (const role of [...others, controller]) {
          for (const args of [...writes, ...reads]) for (const flagged of role === controller ? [true] : [false, true]) {
            const isWrite = writes.includes(args);
            if (!isWrite && flagged && role !== controller) continue;
            if (role !== controller && flagged && inherent(args)) continue;
            const { github, store, binding } = prepare();
            const parentBefore = scenario.parent === false ? null : store.read('parent', 421).doc;
            const childBefore = scenario.child ? store.read('child', 423).doc : null;
            const calls = github.calls.length;
            const mutations = github.mutations();
            const commits = github.commits;
            let output = '';
            let error = null;
            const argv = [...args, '--session', role.session, ...(flagged && isWrite ? ['--controller'] : []), ...(json ? ['--json'] : [])];
            const deps = { transport: github, binding, originUrl: 'https://github.com/acme/app.git', repoRoot: __dirname,
              toolkitVersion: '3.9.0', environment: { TOOLKIT_PROGRAMME_SESSION: controller.session }, stdout: { write: text => { output += text; } } };
            try { cli.main(argv, deps); } catch (caught) { error = caught; output += `${caught.code}: ${caught.message}`; }
            const label = `${scenario.name} / ${role.session} / ${argv.join(' ')}`;
            cases += 1;
            if (role === controller) {
              if (error) assert.ok(!['STALE_WRITER', 'ROLE_REFUSED', 'CLAIM_HELD', 'USAGE', 'WRITER_UNKNOWN'].includes(error.code), `${label}: ${error.code}`);
              continue;
            }
            if (isWrite && !flagged) {
              assert.equal(error?.code, 'USAGE', label);
              assert.equal(github.calls.length, calls, `${label}: usage is checked before any GitHub call`);
            }
            if (isWrite) assert.ok(error, `${label}: a non-controller write succeeded`);
            assert.equal(github.mutations(), mutations, `${label}: GitHub changed`);
            assert.equal(github.commits, commits, `${label}: the store changed`);
            if (parentBefore) assert.deepEqual(store.read('parent', 421).doc, parentBefore, `${label}: parent changed`);
            if (childBefore) assert.deepEqual(store.read('child', 423).doc, childBefore, `${label}: child changed`);
            addressed(output);
          }
        }
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.ok(cases > 600, `${cases} cases`);
});

test('a stopped controller is told to stop and report, never to take the parent back', () => {
  const cli = require('../../skills/github-program-reconciler/scripts/programme.cjs');
  const { github, store, binding, reconciler } = setup();
  github.intercept(call => {
    if (call.method === 'POST' && /\/sub_issues$/.test(call.path) && store.read('parent', 421).doc.fence.epoch === 1) {
      store.mutate('parent', 421, { writer: successor, authorise: false, change: doc => state.claimDocument(doc, successor, { takeover: true }) });
    }
    return undefined;
  });
  const messages = [];
  try { reconciler(controller).run({ apply: true }); } catch (error) { messages.push(error.message); }
  const deps = { transport: github, binding, originUrl: 'https://github.com/acme/app.git', repoRoot: __dirname, toolkitVersion: '3.9.0', stdout: { write() {} } };
  for (const args of [['claim', '--parent'], ['reconcile', '--apply'], ['update-parent', '--patch', __filename]]) {
    try { cli.main([...args, '--session', controller.session, '--controller'], deps); } catch (error) { messages.push(error.message); }
  }
  assert.equal(messages.length, 4);
  for (const message of messages) {
    assert.match(message, /A controller stopped by a takeover stops and reports to the owner\./);
    assert.doesNotMatch(message, /--takeover|claim --parent/);
  }
});

test('the controller can reopen an accepted gate for a correction, and acceptance follows the new return', () => {
  const cli = require('../../skills/github-program-reconciler/scripts/programme.cjs');
  const { github, store, binding, reconciler } = setup();
  const run = args => {
    let output = '';
    cli.main([...args, '--session', controller.session, '--controller', '--json'], { transport: github, binding, originUrl: 'https://github.com/acme/app.git',
      repoRoot: __dirname, toolkitVersion: '3.9.0', stdout: { write: text => { output += text; } } });
    return JSON.parse(output);
  };
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'programme-reopen-'));
  try {
    const patch = (name, value) => { const file = path.join(dir, `${name}.json`); fs.writeFileSync(file, JSON.stringify(value)); return file; };
    github.addPr(540, { head: SHA_B, contexts: [green('validate')], branch: 'feature' });
    run(['assign', '--issue', '423', '--role', 'G1', '--assignment', 'g1-a1']);
    run(['update', '--issue', '423', '--patch', patch('branch', { candidate: { branch: 'feature' } })]);
    run(['return', '--issue', '423', '--record', 'g1-r1', '--assignment', 'g1-a1']);
    assert.throws(() => run(['return', '--issue', '423', '--consume', 'g1-r1', '--verdict', 'ACCEPT']), { code: 'EVIDENCE_STALE' }, 'no G2 verdict at the live head yet');
    run(['update', '--issue', '423', '--patch', patch('review', { review: { state: 'PASSED', verdicts: [{ reviewer: 'g2', head: SHA_B, verdict: 'PASSED' }] } })]);
    run(['return', '--issue', '423', '--consume', 'g1-r1', '--verdict', 'ACCEPT']);
    assert.equal(store.read('child', 423).doc.gate.state, 'RETIRED');
    assert.throws(() => run(['assign', '--issue', '423', '--role', 'G1', '--assignment', 'g1-a2']), { code: 'GATE_STATE' }, 'an accepted gate is reopened, not assigned again');
    assert.equal(run(['reopen', '--issue', '423', '--reason', 'G2 found a defect after acceptance', '--assignment', 'g1-a2']).outcome, 'WRITTEN');
    assert.deepEqual([store.read('child', 423).doc.gate.state, store.read('child', 423).doc.gate.assignment.id], ['ASSIGNED', 'g1-a2']);
    run(['return', '--issue', '423', '--record', 'g1-r2', '--assignment', 'g1-a2']);
    github.prs.get(540).merged = true;
    github.prs.get(540).state = 'MERGED';
    let report = reconciler().run();
    assert.deepEqual(report.close_list.map(entry => [entry.gate, entry.gate_accepted, entry.accepted]), [['G1', false, false]]);
    assert.ok(report.findings.some(finding => finding.code === 'CHILD_STATE_CONFLICT' && finding.issue === 423));
    run(['return', '--issue', '423', '--consume', 'g1-r2', '--verdict', 'ACCEPT']);
    report = reconciler().run();
    assert.deepEqual(report.close_list.map(entry => [entry.gate, entry.gate_accepted, entry.accepted]), [['G1', true, true]]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the close list shows evidence at an older head as STALE_HEAD', () => {
  const { github, store, reconciler, parentDoc } = setup();
  store.mutate('child', 423, { writer: controller, parentDoc: parentDoc(), create: () => state.newChild({ repository: 'acme/app', outcome: CATALOGUE[0] }), authorise: true,
    change: doc => {
      const next = gatedChild(state, doc, { role: 'G1', returnId: 'r1', verdict: 'ACCEPT', writer: controller, parentDoc: parentDoc(), head: SHA_A });
      return state.applyPatch('child', next, { candidate: { branch: 'feature' }, uat: { state: 'PASSED', at_head: SHA_A },
        review: { state: 'PASSED', verdicts: [{ reviewer: 'g2', head: SHA_A, verdict: 'PASSED' }] } }, { writer: controller, parentDoc: parentDoc() });
    } });
  github.addPr(540, { head: SHA_B, merged: true, state: 'MERGED', contexts: [green('validate')], branch: 'feature' });
  const stale = reconciler().run().close_list[0];
  assert.match(stale.uat, /^PASSED \(STALE_HEAD, was aaaaaaa\)$/);
  assert.match(stale.review, /^PASSED \(STALE_HEAD\)$/);
  github.prs.get(540).head = SHA_A;
  github.prs.get(540).rollupOid = SHA_A;
  const current = reconciler().run().close_list[0];
  assert.deepEqual([current.uat, current.review], ['PASSED', 'PASSED']);
});

test('sessions come from --session only, every --issue is 1 or more, and a dry run after an interrupted pass asks the controller to apply', () => {
  const cli = require('../../skills/github-program-reconciler/scripts/programme.cjs');
  const { github, store, binding, reconciler } = setup();
  const deps = { transport: github, binding, originUrl: 'https://github.com/acme/app.git', repoRoot: __dirname, toolkitVersion: '3.9.0',
    environment: { TOOLKIT_PROGRAMME_SESSION: controller.session }, stdout: { write() {} } };
  assert.throws(() => cli.main(['reconcile', '--apply', '--controller'], deps), { code: 'WRITER_UNKNOWN' }, 'an inherited session never writes');
  assert.throws(() => cli.parseArgs(['reconcile', '--apply', '--controller', '--session', '']), { code: 'USAGE' });
  assert.throws(() => cli.parseArgs(['reconcile', '--apply', '--controller', '--session', '  ']), { code: 'USAGE' }, 'a whitespace-only session is refused');
  assert.throws(() => cli.parseArgs(['bind', '--issue', '423', '--assignment', 'a', '--session', ' \t']), { code: 'USAGE' });
  for (const argv of [['show', '--issue', '0'], ['reconcile', '--issue', '0'], ['reconcile', '--issue', '-1'], ['show', '--issue', '1.5']]) {
    assert.throws(() => cli.parseArgs(argv), { code: 'USAGE' }, argv.join(' '));
  }
  // An effect that landed before its intent was cleared: the next dry run asks the controller to apply.
  reconciler().run({ apply: true });
  store.mutate('child', 423, { writer: controller, parentDoc: store.read('parent', 421).doc, change: doc => {
    doc.pending_effects.push({ intent_id: 'landed', kind: 'attach', target: { issue: 423, parent: 421 }, state: 'IN_FLIGHT' });
    return doc;
  } });
  const dry = reconciler().run();
  assert.deepEqual(dry.recovered.map(entry => entry.outcome), ['DONE']);
  assert.match(dry.next_action, /^Controller: run reconcile --apply --controller to clear 1 settled intent\(s\)$/);
  assert.equal(store.read('child', 423).doc.pending_effects.length, 1);
});

test('binding documentation scopes opt-in to the reconciler while governed issue records remain', () => {
  const read = file => fs.readFileSync(path.resolve(__dirname, '..', '..', file), 'utf8');
  const rules = read('repo/contracts/agent-rules/global-rules.md');
  if (!rules.includes('.github/toolkit-programme.json')) {
    for (const file of ['README.md', 'skills/github-program-reconciler/SKILL.md']) {
      const text = read(file);
      assert.doesNotMatch(text, /(?:issue tracking|records|comments)[^.\n]*(?:off by default|opt-in)/i, file);
      assert.doesNotMatch(text, /Toolkit writes no issues, comments or records|without the binding it does nothing/i, file);
      assert.match(text, /binding does not change the Toolkit-governed rules[^\n]*or their issue records/, file);
      assert.match(text, /without that block get no governed issue writes/i, file);
      assert.match(text, /every `programme\.cjs` command refuses without it/, file);
    }
  }
});

test('an executor cannot record its own UAT, review or completion', () => {
  const { store, parentDoc, assignG1 } = setup();
  assignG1();
  const patch = { lifecycle: 'DONE', uat: { state: 'PASSED', at_head: SHA_A }, review: { state: 'PASSED', verdicts: [{ reviewer: 'self', head: SHA_A, verdict: 'PASSED' }] } };
  assert.throws(() => store.mutate('child', 423, { writer: builder, parentDoc: parentDoc(), change: doc => state.applyPatch('child', doc, patch, { writer: builder, parentDoc: parentDoc() }) }), { code: 'STALE_WRITER' });
  // Even a document it somehow held would refuse the acceptance records.
  const held = state.claimDocument(store.read('child', 423).doc, builder, { takeover: true });
  assert.throws(() => state.applyPatch('child', held, patch, { writer: builder, parentDoc: parentDoc() }), { code: 'ROLE_REFUSED' });
  const doc = store.read('child', 423).doc;
  assert.deepEqual([doc.lifecycle, doc.uat.state, doc.review.state], ['ACTIVE', null, null]);
});

test('UAT or review evidence without its head is refused on write and rendered stale', () => {
  const { github, store, reconciler, parentDoc } = setup();
  const write = patch => store.mutate('child', 423, { writer: controller, parentDoc: parentDoc(), change: doc => state.applyPatch('child', doc, patch, { writer: controller, parentDoc: parentDoc() }) });
  github.addPr(540, { head: SHA_A, contexts: [green('validate')], branch: 'feature' });
  reconciler().run({ apply: true });
  assert.throws(() => write({ uat: { state: 'PASSED' } }), { code: 'STATE_INVALID' });
  assert.throws(() => write({ uat: { state: 'UAT_RETAINED', at_head: null } }), { code: 'STATE_INVALID' });
  assert.throws(() => write({ review: { state: 'PASSED', verdicts: [] } }), { code: 'STATE_INVALID' });
  assert.throws(() => write({ review: { state: 'NOT_PASSED' } }), { code: 'STATE_INVALID' });
  write({ candidate: { branch: 'feature', head: SHA_A }, uat: { state: 'PASSED', at_head: SHA_A }, review: { state: 'PASSED', verdicts: [{ reviewer: 'g2', head: SHA_A, verdict: 'PASSED' }] } });
  reconciler().run({ apply: true });
  assert.match(state.findStateBlock(github.issues.get(423).body).block.body, /UAT: PASSED; review: PASSED\n/);
  github.prs.get(540).head = SHA_B;
  github.prs.get(540).rollupOid = SHA_B;
  reconciler().run({ apply: true });
  assert.match(state.findStateBlock(github.issues.get(423).body).block.body, /UAT: PASSED \(STALE_HEAD, was aaaaaaa\); review: PASSED \(STALE_HEAD\)/);

  // Rendering stays safe even for a document that bypassed validation.
  const doc = { ...store.read('child', 423).doc, uat: { state: 'PASSED', at_head: null }, review: { state: 'PASSED', verdicts: [] } };
  const body = state.renderChildBlockBody(doc, CATALOGUE[0]);
  assert.match(body, /UAT: PASSED \(STALE_HEAD, head not recorded\); review: PASSED \(STALE_HEAD, no verdict recorded\)/);
  // A current-head verdict beside an older one is current.
  const mixed = { ...doc, uat: { state: 'PENDING', at_head: null }, review: { state: 'PASSED', verdicts: [{ reviewer: 'a', head: SHA_A, verdict: 'NOT_PASSED' }, { reviewer: 'a', head: SHA_B, verdict: 'PASSED' }] } };
  assert.match(state.renderChildBlockBody(mixed, CATALOGUE[0]), /UAT: PENDING; review: PASSED\n/);
});

test('a body hold skips only that issue\'s body, not its native link', () => {
  const { github, reconciler } = setup();
  github.issues.get(469).body = 'x'.repeat(59990);
  const report = reconciler().run({ apply: true });
  assert.ok(report.holds.some(hold => hold.code === 'BODY_TOO_LARGE' && hold.target === '#469'));
  assert.equal(github.issues.get(469).parent, 467);
  assert.equal(report.results.find(entry => entry.kind === 'attach' && entry.target.issue === 469).outcome, 'DONE');
});

test('secret-shaped values are refused anywhere in a state document or binding, without echoing them', () => {
  const { github, store, reconciler, parentDoc } = setup();
  reconciler().run({ apply: true });
  const commits = github.commits;
  const values = [
    `ghp_${'A1b2C3d4E5'.repeat(4)}`, `github_pat_${'x1'.repeat(15)}`, `sk-ant-${'k'.repeat(30)}`, `AKIA${'A'.repeat(16)}`,
    `xoxb-${'1'.repeat(12)}`, `AIza${'B'.repeat(35)}`, `eyJ${'a'.repeat(12)}.eyJ${'b'.repeat(12)}.${'c'.repeat(12)}`, `Bearer ${'t'.repeat(30)}`,
  ];
  for (const value of values) {
    for (const patch of [{ next_action: `Retry with ${value}` }, { private: { note: value } }, { blockers: [value] }]) {
      let error = null;
      try { store.mutate('child', 423, { writer: controller, parentDoc: parentDoc(), change: doc => state.applyPatch('child', doc, patch, { writer: controller, parentDoc: parentDoc() }) }); }
      catch (caught) { error = caught; }
      assert.equal(error?.code, 'STATE_INVALID', `${JSON.stringify(patch).slice(0, 40)} was accepted`);
      assert.equal(error.message.includes(value) || JSON.stringify(error.details).includes(value), false, 'the error repeats the value');
    }
  }
  assert.equal(github.commits, commits, 'nothing reached the store');
  assert.equal(github.issues.get(423).body.includes('ghp_'), false);
  const key = '-----BEGIN ' + 'PRIVATE KEY-----';
  assert.throws(() => state.assertValid('child', { ...store.read('child', 423).doc, private: { pem: key } }), { code: 'STATE_INVALID' });
  const binding = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', '.github', 'toolkit-programme.json'), 'utf8'));
  assert.throws(() => state.validateBinding({ ...binding, required_checks: [values[0]] }), /looks like a GitHub token/);
  assert.doesNotThrow(() => state.assertValid('child', store.read('child', 423).doc), 'ordinary documents pass');
});

test('runtime validation matches the schemas on unknown and missing nested fields', () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const schema = name => JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'contracts', 'programme-state', name), 'utf8'));
  const validateChild = ajv.compile(schema('child-state-v1.schema.json'));
  const validateParent = ajv.compile(schema('parent-state-v1.schema.json'));
  const base = () => state.newChild({ repository: 'acme/app', outcome: CATALOGUE[0] });
  const mutations = [
    doc => { doc.uat = { state: 'PENDING', at_head: null, token_note: 'x' }; },
    doc => { delete doc.uat.at_head; },
    doc => { doc.extra = 1; },
    doc => { delete doc.release; },
    doc => { doc.gate.route = { model: 'm', effort: 'e', read_back: true, note: 'x' }; },
    doc => { doc.gate.returns.push({ return_id: 'r', verdict: null, consumed: false, epoch: 0, by: 'x' }); },
    doc => { doc.pr.checks.extra = true; },
    doc => { doc.candidate.extra = null; },
    doc => { doc.fence.extra = 1; },
    doc => { doc.review = { state: 'IN_REVIEW', verdicts: [{ reviewer: 'r', head: SHA_A, verdict: 'PASSED', note: 'x' }] }; },
    doc => { doc.pending_effects.push({ intent_id: 'i', kind: 'attach', target: {}, state: 'IN_FLIGHT', extra: 1 }); },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const doc = base();
    mutate(doc);
    assert.equal(validateChild(doc), false, `schema accepts mutation ${index}`);
    assert.notDeepEqual(state.validateChild(doc), [], `runtime accepts mutation ${index}`);
  }
  const parent = state.newParent({ repository: 'acme/app', parentIssue: 421, outcomes: [{ ...CATALOGUE[0], note: 'x' }] });
  assert.equal(validateParent(parent), false);
  assert.notDeepEqual(state.validateParent(parent), []);
  const missingParentKey = state.newParent({ repository: 'acme/app', parentIssue: 421, outcomes: [{ issue: 423, class: 'CORE', order: 1 }] });
  assert.equal(validateParent(missingParentKey), false);
  assert.notDeepEqual(state.validateParent(missingParentKey), []);
});

test('without the opt-in binding the command line refuses before any GitHub call', () => {
  const cli = require('../../skills/github-program-reconciler/scripts/programme.cjs');
  const github = new FakeGitHub();
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'programme-unbound-'));
  try {
    for (const argv of [['reconcile'], ['reconcile', '--apply', '--controller', '--session', 's'], ['show'],
      ['assign', '--issue', '1', '--role', 'G1', '--assignment', 'a', '--controller', '--session', 's'], ['bind', '--issue', '1', '--assignment', 'a', '--session', 's']]) {
      assert.throws(() => cli.main(argv, { transport: github, repoRoot: dir, originUrl: 'https://github.com/acme/app.git', stdout: { write() {} } }), { code: 'BINDING_MISSING' });
    }
    assert.equal(github.calls.length, 0, 'no GitHub call is made in a repository that has not opted in');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('every custody surface says only the appointed controller writes', () => {
  const read = file => fs.readFileSync(path.resolve(__dirname, '..', '..', file), 'utf8');
  const skill = read('skills/github-program-reconciler/SKILL.md');
  const surfaces = {
    description: skill.split('description: ')[1].split('\n')[0],
    when: skill.split('## When to run')[1].split('## What ships')[0],
    who: skill.split('**Who records what.**')[1].split('**Gates.**')[0],
    prompt: read('skills/github-program-reconciler/agents/openai.yaml').split('default_prompt: ')[1].split('\n')[0],
    readme: read('skills/github-program-reconciler/README.md'),
    changelog: read('repo/docs/CHANGELOG.md').split('## Unreleased')[1].split('## 3.9.0')[0],
    history: read('repo/docs/CHANGELOG.md').split('## 3.9.0')[1].split('## 3.8.0')[0],
    trigger: JSON.parse(read('repo/docs/skill-creation-center-baseline.json')).skill_creation_review['github-program-reconciler'].trigger,
  };
  for (const [name, text] of Object.entries(surfaces)) {
    assert.match(text, /only the appointed controller writes programme state/i, name);
    assert.doesNotMatch(text, /gate successor|takes the child|child holder may|submit returns;/i, `${name} still describes executor custody`);
  }
  assert.match(surfaces.who, /A controller stopped by a takeover stops and reports to the owner/);
  assert.match(surfaces.who, /verifies that the previous writer stopped, posts its takeover record/);
  assert.match(surfaces.who, /--takeover-record <comment id>/);
  // Executors write only their own journal; no surface says they never write at all.
  for (const name of ['description', 'who', 'prompt', 'readme', 'trigger']) {
    assert.match(surfaces[name], /writes only its own checkpoint journal/, name);
    assert.doesNotMatch(surfaces[name], /Executors \(G0, G1, G2\)[^.]*never write/, name);
  }
  assert.doesNotMatch(skill, /TOOLKIT_PROGRAMME_SESSION/);
});

test('user-facing reconciler text names no release numbers or roadmap', () => {
  const read = file => fs.readFileSync(path.resolve(__dirname, '..', '..', file), 'utf8');
  // Release numbers (bare or "in/since x.y"), "this version" and roadmap labels. Managed-block markers
  // (toolkit=x.y.z) and the reconciler's own version output are not prose.
  const forbidden = [/\bv?\d+\.\d+\.\d+\b/, /\b(?:in|since|from|until) (?:version )?v?\d+\.\d+\b/i, /\bthis version\b/i, /\bR\d+[a-z]?(?:-\d+)?\b/, /\bcustody release\b/i, /\b(?:next|later|upcoming|future) release\b/i];
  const prose = text => text.replace(/toolkit=\d+\.\d+\.\d+/g, '').replace(/toolkitVersion[^\n]*/g, '');
  const whole = ['skills/github-program-reconciler/SKILL.md', 'skills/github-program-reconciler/README.md',
    'skills/github-program-reconciler/agents/openai.yaml', 'repo/contracts/programme-state/binding-v1.schema.json',
    'repo/contracts/programme-state/child-state-v1.schema.json', 'repo/contracts/programme-state/journal-v1.schema.json',
    'repo/contracts/programme-state/host-contract-v1.json', 'repo/docs/HOST-CONTRACT.md'];
  const texts = whole.map(file => [file, read(file)]);
  // Shared files: only the reconciler's own row or paragraph is this skill's text.
  const row = (file, marker) => {
    const line = read(file).split('\n').find(text => text.includes(marker));
    assert.ok(line, `${file} must mention ${marker}`);
    return [file, line];
  };
  texts.push(row('README.md', 'github-program-reconciler'), row('repo/docs/SKILL-SAFETY-MATRIX.md', 'github-program-reconciler'),
    row('repo/docs/FOR_AI_AGENTS.md', 'github-program-reconciler'), row('repo/contracts/agent-rules/toolkit-skill-routing.md', 'github-program-reconciler'));
  texts.push(['skill-creation-center-baseline.json trigger', JSON.parse(read('repo/docs/skill-creation-center-baseline.json')).skill_creation_review['github-program-reconciler'].trigger]);
  // Messages the command line prints: the quoted strings in its scripts.
  for (const file of ['skills/github-program-reconciler/scripts/programme.cjs', 'skills/github-program-reconciler/scripts/programme-state.cjs',
    'skills/github-program-reconciler/scripts/programme-checkpoint.cjs', 'repo/scripts/toolkit-programme-checkpoint-hook.cjs']) {
    const strings = [...read(file).matchAll(/'((?:[^'\\\n]|\\.){12,})'|`((?:[^`\\]|\\.){12,})`/g)].map(match => match[1] || match[2]);
    texts.push([`${file} messages`, strings.join('\n')]);
  }
  for (const [file, text] of texts) {
    for (const pattern of forbidden) {
      const found = prose(text).match(pattern);
      assert.equal(found, null, `${file} has release or roadmap wording: "${found?.[0]}" in "${found ? found.input.slice(Math.max(0, found.index - 40), found.index + 40).replace(/\s+/g, ' ') : ''}"`);
    }
  }
});
