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
const { FakeGitHub } = require('./toolkit-programme-fake-github.cjs');

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
  const claimAsBuilder = () => store.mutate('child', 423, { writer: builder, authorise: false, create: () => state.newChild({ repository, outcome: CATALOGUE[0] }), change: doc => state.claimDocument(doc, builder, { role: 'G1' }) });
  return { github, store, binding, reconciler, parentDoc, claimAsBuilder };
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

test('an executor cannot accept its own return; the controller can', () => {
  const { store, parentDoc, claimAsBuilder } = setup();
  claimAsBuilder();
  store.mutate('child', 423, { writer: builder, parentDoc: parentDoc(), change: doc => state.submitReturn(doc, { returnId: 'r1', writer: builder }) });
  assert.throws(() => store.mutate('child', 423, { writer: builder, parentDoc: parentDoc(), change: doc => state.consumeReturn(doc, { returnId: 'r1', verdict: 'ACCEPT', writer: builder, parentDoc: parentDoc() }) }), { code: 'ROLE_REFUSED' });
  assert.equal(store.read('child', 423).doc.gate.state, 'SUBMITTED');
  store.mutate('child', 423, { writer: controller, parentDoc: parentDoc(), change: doc => state.consumeReturn(doc, { returnId: 'r1', verdict: 'ACCEPT', writer: controller, parentDoc: parentDoc() }) });
  assert.equal(store.read('child', 423).doc.gate.state, 'RETIRED');
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

test('a concurrent first G0 claim survives the controller applying a planned create_state', () => {
  const { store, reconciler, parentDoc } = setup();
  const pass = reconciler();
  const plan = pass.plan();
  const effect = plan.effects.find(entry => entry.kind === 'create_state' && entry.target.issue === 423);
  assert.ok(effect);
  const claimed = store.mutate('child', 423, {
    writer: builder, authorise: false, create: () => state.newChild({ repository: 'acme/app', outcome: CATALOGUE[0] }),
    change: doc => state.claimDocument(doc, builder, { role: 'G0', parentDoc: parentDoc() }),
  }).doc;
  const applied = pass.apply(plan);
  assert.deepEqual(applied.holds, []);
  const after = store.read('child', 423).doc;
  for (const key of ['gate', 'lifecycle', 'fence', 'candidate', 'release', 'next_action', 'private']) {
    assert.deepEqual(after[key], claimed[key], `${key} survives apply`);
  }
  assert.deepEqual(after.pr, effect.doc.pr, 'observed PR fields are applied');
  assert.doesNotThrow(() => state.submitReturn(after, { returnId: 'g0-r1', writer: builder, parentDoc: parentDoc() }));
});

test('every command and next action preserves controller custody and authority for every role', t => {
  const cli = require('../../skills/github-program-reconciler/scripts/programme.cjs');
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'programme-messages-'));
  const catalogue = path.join(dir, 'catalogue.json');
  fs.writeFileSync(catalogue, JSON.stringify({ outcomes: CATALOGUE }));
  const patches = {
    ordinary: { next_action: 'Continue the assigned build' }, parent: { private: { note: 'Proposed catalogue update' } },
    uat: { uat: { state: 'PASSED', at_head: SHA_A } },
    review: { review: { state: 'PASSED', verdicts: [{ reviewer: 'g2', head: SHA_A, verdict: 'PASSED' }] } },
    done: { lifecycle: 'DONE' }, retired: { lifecycle: 'RETIRED' }, gate: { gate: {} }, fence: { fence: {} },
  };
  for (const [name, patch] of Object.entries(patches)) fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(patch));
  const patch = name => path.join(dir, `${name}.json`);
  // All four required entry states, plus the child holder who is not the parent holder, terminal
  // gates, both planning holds, and the settled/no-change and attention-only next-action branches.
  const scenarios = [
    { name: 'no parent', parent: false },
    { name: 'parent held by another session' },
    { name: 'child held by another session', child: 'other' },
    { name: 'holds present: body too large', child: 'other', hold: 'body' },
    { name: 'holds present: unknown effect', child: 'other', hold: 'unknown' },
    { name: 'child holder, parent held by another session', child: 'own' },
    { name: 'child holder, submitted gate', child: 'own', gate: 'SUBMITTED' },
    { name: 'child holder, retired gate', child: 'own', gate: 'RETIRED' },
    { name: 'child holder, gate not started', child: 'own', gate: 'unassigned' },
    { name: 'settled state', settled: true },
    { name: 'attention findings only', settled: true, attention: true },
  ];
  const commands = [
    ['reconcile'], ['reconcile', '--apply'], ['claim', '--parent'], ['claim', '--issue', '423', '--role', 'G1'],
    ['update', '--issue', '423', '--patch', patch('ordinary')], ['update-parent', '--patch', patch('parent')],
    ['return', '--issue', '423', '--submit', 'r1'], ['return', '--issue', '423', '--consume', 'r1', '--verdict', 'ACCEPT'],
    ['show', '--parent'], ['show', '--issue', '423'],
    ...['uat', 'review', 'done', 'retired', 'gate', 'fence'].map(name => ['update', '--issue', '423', '--patch', patch(name)]),
    ['init-parent', '--catalogue', catalogue],
  ];
  const roles = [
    { name: 'child holder', writer: builder },
    { name: 'assigned G1 successor', writer: { ...builder, session: 'assigned-g1' } },
    { name: 'G2 reviewer', writer: { ...builder, session: 'reviewer-g2' } },
    { name: 'helper', writer: { ...builder, session: 'unrelated-helper' } },
    { name: 'controller', writer: controller },
  ];
  const counts = Object.fromEntries(roles.map(role => [role.name, 0]));
  let takeovers = 0;
  const seen = new Set();
  const nextActions = new Set();
  const protectedChild = doc => ({
    uat: doc.uat, review: doc.review,
    terminal: ['DONE', 'RETIRED'].includes(doc.lifecycle) ? doc.lifecycle : null,
    consumed: doc.gate.returns.filter(entry => entry.consumed),
  });
  const childDocuments = store => CATALOGUE.map(outcome => store.read('child', outcome.issue).doc);
  const checkGuidance = text => {
    for (const sentence of text.split(/\n|(?<=[.!?])\s+/)) {
      if (!/init-parent|claim --parent|--apply|update-parent|shorten it first/.test(sentence)) continue;
      assert.match(sentence, /(?:^|: )(?:Controller:|The appointed controller|Only the appointed controller|If you are the appointed controller)/,
        `parent instruction is not addressed to the controller: ${sentence}`);
    }
    for (const sentence of text.split(/\n|(?<=[.!?])\s+/).filter(line => line.includes('--takeover'))) {
      assert.ok(sentence.includes('If you are the appointed controller') || /Issue 423.*controller assigned this gate to you/.test(sentence), sentence);
    }
  };
  try {
    for (const scenario of scenarios) {
      for (const role of roles) {
        const isController = role.name === 'controller';
        const isGateSuccessor = role.name === 'assigned G1 successor';
        // With no child yet these are prospective gate sessions. Initial claims create custody;
        // only the assigned successor tests changing another session's existing child custody.
        const writer = role.name === 'child holder' && scenario.child === 'other' ? successor : role.writer;
        const tries = [...commands,
          ...(scenario.parent !== false || isController ? [['init-parent', '--catalogue', catalogue, '--apply']] : []),
          ...(isGateSuccessor && scenario.child && scenario.gate !== 'unassigned'
            ? [['claim', '--issue', '423', '--role', 'G1', '--takeover']] : []),
        ];
        for (const args of tries) for (const json of [false, true]) {
          const { github, store, binding, reconciler } = setup({ initialiseParent: scenario.parent !== false });
          if (scenario.child) {
            const holder = scenario.child === 'own' ? builder : successor;
            let doc = state.claimDocument(state.newChild({ repository: 'acme/app', outcome: CATALOGUE[0] }), holder,
              { role: scenario.gate === 'unassigned' ? null : 'G0' });
            if (['SUBMITTED', 'RETIRED'].includes(scenario.gate)) doc = state.submitReturn(doc, { returnId: 'r1', writer: holder });
            if (scenario.gate === 'RETIRED') doc = state.consumeReturn(doc, { returnId: 'r1', verdict: 'ACCEPT', writer: controller, parentDoc: store.read('parent', 421).doc });
            store.write('child', 423, doc, { sha: null, previous: null });
          }
          if (scenario.hold === 'body') github.issues.get(421).body = 'x'.repeat(59990);
          if (scenario.hold === 'unknown') store.mutate('parent', 421, { writer: controller, change: doc => {
            doc.pending_effects.push({ intent_id: 'unknown', kind: 'replace_block', target: { issue: 999, digest: 'c'.repeat(64) }, state: 'UNKNOWN' });
            return doc;
          } });
          if (scenario.settled) reconciler().run({ apply: true });
          if (scenario.attention) github.addIssue(999, { parent: 421 });
          const before = store.read('parent', 421).doc;
          const childrenBefore = childDocuments(store);
          const writes = github.commits;
          const mutations = github.mutations();
          let output = '';
          let error = null;
          const deps = { transport: github, binding, originUrl: 'https://github.com/acme/app.git', repoRoot: __dirname,
            toolkitVersion: '3.9.0', environment: {}, stdout: { write: text => { output += text; } } };
          try { cli.main([...args, '--session', writer.session, ...(json ? ['--json'] : [])], deps); }
          catch (caught) { error = caught; output += `${caught.code}: ${caught.message}`; }
          const label = `${role.name}: ${scenario.name}: ${args.join(' ')} (${json ? 'JSON' : 'text'})`;
          counts[role.name] += 1;
          assert.ok(output, label);
          if (error) {
            assert.ok(error instanceof state.ProgrammeError, label);
            if (!isController) seen.add(error.code);
            assert.equal(github.commits, writes, `${label}: refused command writes nothing`);
          }
          if (args[0] === 'reconcile' && !isController) {
            let report;
            if (!error && json) report = JSON.parse(output);
            if (report) {
              report.holds.forEach(hold => seen.add(hold.code));
              const action = report.next_action;
              nextActions.add(action.startsWith('Controller: resolve') ? 'hold' : action.startsWith('Controller: run') ? 'plan'
                : action.startsWith('Controller: decide') ? 'attention' : action.startsWith('None:') ? 'none' : action);
            }
          }
          // JSON stores report text as escaped strings. Inspect the actual values too.
          if (json && !error) {
            const strings = value => typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : [];
            strings(JSON.parse(output)).forEach(checkGuidance);
          } else checkGuidance(output);
          const after = store.read('parent', 421).doc;
          const childrenAfter = childDocuments(store);
          if (!isController) {
            assert.deepEqual(after?.fence, before?.fence, `${label}: parent fence is unchanged`);
            for (const key of ['outcomes', 'release_plan', 'private']) {
              assert.deepEqual(after?.[key], before?.[key], `${label}: parent ${key} is unchanged`);
            }
            assert.deepEqual(after, before, `${label}: parent custody and content are unchanged`);
            for (const [index, outcome] of CATALOGUE.entries()) {
              const empty = state.newChild({ repository: 'acme/app', outcome });
              assert.deepEqual(protectedChild(childrenAfter[index] || empty), protectedChild(childrenBefore[index] || empty),
                `${label}: #${outcome.issue} acceptance, terminal lifecycle and consumed returns are unchanged`);
            }
            assert.equal(github.mutations(), mutations, `${label}: no public writes`);
            if (isGateSuccessor && childrenBefore[0]?.fence.holder_session && !args.includes('--takeover')) {
              assert.deepEqual(childrenAfter[0].fence, childrenBefore[0].fence, `${label}: custody needs the documented child takeover`);
            }
          } else if ((args[0] === 'reconcile' && args.includes('--apply')) || args.includes('--consume')
            || args[0] === 'update-parent' || args[0] === 'init-parent'
            || (args[0] === 'update' && ['uat', 'review', 'done'].some(name => args.includes(patch(name))))) {
            assert.ok(!['STALE_WRITER', 'ROLE_REFUSED', 'CLAIM_HELD'].includes(error?.code), `${label}: controller authority was refused`);
            assert.ok(!error || ['PARENT_STATE_MISSING', 'STATE_MISSING', 'STATE_EXISTS', 'RETURN_UNKNOWN'].includes(error.code),
              `${label}: controller failed for a reason other than fixture state: ${error?.code}`);
            if (before && (args[0] === 'update-parent' || (childrenBefore[0] && args[0] === 'update')
              || (args.includes('--consume') && childrenBefore[0]?.gate.returns.length))) {
              assert.equal(error, null, `${label}: the valid controller operation succeeds`);
            }
            if (!before && args[0] === 'init-parent' && args.includes('--apply')) {
              assert.equal(error, null, `${label}: the controller initialises the missing parent`);
              assert.deepEqual(after.fence, { epoch: 1, holder_prefix: controller.prefix, holder_session: controller.session });
            }
          }
          if (args.includes('--takeover')) {
            assert.equal(error, null, `${label}: the assigned successor can take the child`);
            const childBefore = childrenBefore[0];
            const childAfter = childrenAfter[0];
            assert.deepEqual(childAfter.fence, {
              epoch: childBefore.fence.epoch + 1, holder_prefix: writer.prefix, holder_session: writer.session,
            }, `${label}: only the child fence moves to the assigned successor`);
            assert.equal(childAfter.gate.role, 'G1', label);
            assert.equal(childAfter.gate.session_id, writer.session, label);
            assert.equal(childAfter.gate.state, 'ACTIVE', label);
            // A gate handover also records its new session and write metadata, but preserves all
            // other child content, including returns submitted at the previous epoch.
            assert.deepEqual(childAfter, {
              ...childBefore, fence: childAfter.fence,
              gate: { ...childBefore.gate, role: 'G1', session_id: writer.session, state: 'ACTIVE' },
              private: { ...childBefore.private, host_session: writer.session }, revision: childBefore.revision + 1,
              volatile: { ...childBefore.volatile, written_at: childAfter.volatile.written_at },
            }, `${label}: only child custody and write metadata change`);
            assert.deepEqual(childrenAfter.slice(1), childrenBefore.slice(1), `${label}: other child fences and documents are unchanged`);
            assert.equal(github.commits, writes + 1, `${label}: exactly one child document is written`);
            takeovers += 1;
          }
        }
      }
    }
    assert.deepEqual([...seen].sort(), ['CLAIM_HELD', 'EFFECT_UNKNOWN', 'GATE_NOT_ACTIVE', 'PARENT_STATE_MISSING', 'PATCH_REFUSED', 'ROLE_REFUSED', 'RETURN_CONFLICT', 'STALE_WRITER', 'STATE_EXISTS', 'STATE_MISSING', 'BODY_TOO_LARGE'].sort());
    assert.deepEqual([...nextActions].sort(), ['attention', 'hold', 'none', 'plan']);
    assert.deepEqual(Object.values(counts), [394, 406, 394, 394, 396]);
    assert.equal(takeovers, 12);
    t.diagnostic(`Role cases: ${JSON.stringify(counts)}; total: ${Object.values(counts).reduce((sum, count) => sum + count, 0)}; child takeovers: ${takeovers}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('executor parent refusals name the holder neutrally and address recovery only to the appointed controller', () => {
  const cli = require('../../skills/github-program-reconciler/scripts/programme.cjs');
  const { github, store, binding, claimAsBuilder } = setup();
  claimAsBuilder();
  const deps = { transport: github, binding, originUrl: 'https://github.com/acme/app.git', repoRoot: __dirname,
    toolkitVersion: '3.9.0', environment: {}, stdout: { write() {} } };
  const writes = github.mutations();
  for (const [args, code] of [[['reconcile', '--apply'], 'STALE_WRITER'], [['claim', '--parent'], 'CLAIM_HELD']]) {
    assert.throws(() => cli.main([...args, '--session', builder.session], deps), error => {
      assert.equal(error.code, code);
      assert.match(error.message, /the parent holder \(INT-TK421-, epoch 1\)/);
      assert.match(error.message, /Only the appointed controller applies/);
      assert.match(error.message, /dry-run and report to the controller/);
      assert.match(error.message, /If you are the appointed controller and another session holds the parent, post your takeover record, then run claim --parent --takeover\./);
      return true;
    });
  }
  assert.equal(github.mutations(), writes);
  assert.equal(store.read('parent', 421).doc.fence.holder_session, controller.session);
  const child = store.read('child', 423).doc;
  for (const action of [() => state.claimDocument(child, successor), () => state.authoriseWrite('child', child, null, successor)]) {
    assert.throws(action, error => {
      assert.match(error.message, /holder INT-TK421- for gate G1 \(epoch 1\)/);
      return true;
    });
  }
});

test('binding documentation scopes opt-in to the reconciler while governed issue records remain', () => {
  const read = file => fs.readFileSync(path.resolve(__dirname, '..', '..', file), 'utf8');
  const rules = read('repo/contracts/agent-rules/global-rules.md');
  if (!rules.includes('.github/toolkit-programme.json')) {
    for (const file of ['README.md', 'skills/github-program-reconciler/SKILL.md']) {
      const text = read(file);
      assert.doesNotMatch(text, /(?:issue tracking|records|comments)[^.\n]*(?:off by default|opt-in)/i, file);
      assert.doesNotMatch(text, /Toolkit writes no issues, comments or records|without the binding it does nothing/i, file);
      assert.match(text, /Toolkit-governed rules[^\n]*issue records are unchanged in 3\.9\.0/, file);
      assert.match(text, /without that block get no governed issue writes/i, file);
      assert.match(text, /every `programme\.cjs` command refuses without it/, file);
    }
  }
});

test('every custody surface bans executor parent claims but permits assigned child handover', () => {
  const read = file => fs.readFileSync(path.resolve(__dirname, '..', '..', file), 'utf8');
  const skill = read('skills/github-program-reconciler/SKILL.md');
  const when = skill.split('## When to run')[1].split('## What ships')[0];
  const description = skill.split('description: ')[1].split('\n')[0];
  const who = skill.split('**Who records what.**')[1].split('**Returns (LIFE-1).**')[0];
  const prompt = read('skills/github-program-reconciler/agents/openai.yaml').split('default_prompt: ')[1].split('\n')[0];
  const trigger = JSON.parse(read('repo/docs/skill-creation-center-baseline.json')).skill_creation_review['github-program-reconciler'].trigger;
  const readme = read('skills/github-program-reconciler/README.md');
  const changelog = read('repo/docs/CHANGELOG.md').split('## 3.9.0')[1].split('## 3.8.0')[0];
  for (const surface of [description, when, who, prompt, readme, changelog, trigger]) {
    const text = surface.replaceAll('`', '');
    assert.ok(text.includes('Executors never apply, and never claim or take over the parent document.'));
    assert.match(text, /(?:A gate successor the controller has assigned|The single gate successor assigned by the controller) \(for example G1 after G0\) takes the child with claim --issue <n> --role <gate> --takeover\./);
    assert.match(text, /Only the appointed controller takes over the parent document, after posting its takeover record/);
    assert.doesNotMatch(text, /never apply, claim the parent or take over|a controller arranges any child gate custody change/);
  }
  assert.match(who, /Only the appointed controller runs `init-parent --apply`\./);
  assert.match(who, /One session holds a gate at a time\./);
  assert.match(who, /G2 reviewers report their verdicts, and the controller records them in `review\.verdicts`; reviewers do not take over the child\./);
  assert.match(who, /If you are the appointed controller and another session holds the parent, post your takeover record, then run claim --parent --takeover\./);
  assert.match(skill, /\| `init-parent --catalogue[^\n]*Only the appointed controller runs `init-parent --apply`/);
  assert.doesNotMatch(skill, /held by this session/);
  assert.match(read('skills/github-program-reconciler/agents/openai.yaml'), /allow_implicit_invocation: true/);
  for (const text of [description, when, prompt, trigger]) {
    assert.match(text, /Any session may (?:run the )?dry-run/i);
    assert.match(text, /only the appointed controller holding the parent document runs `?--apply/i);
    assert.match(text, /the binding is added/i);
    assert.doesNotMatch(text, /governance setup/);
  }
});

test('child refusals identify the appointed controller when it also holds the child', () => {
  const cli = require('../../skills/github-program-reconciler/scripts/programme.cjs');
  const { github, store, binding } = setup();
  const deps = { transport: github, binding, originUrl: 'https://github.com/acme/app.git', repoRoot: __dirname,
    toolkitVersion: '3.9.0', environment: {}, stdout: { write() {} } };
  cli.main(['claim', '--issue', '423', '--role', 'G1', '--session', controller.session], deps);
  const child = store.read('child', 423).doc;
  const parentDoc = store.read('parent', 421).doc;
  for (const action of [
    () => cli.main(['claim', '--issue', '423', '--role', 'G1', '--session', builder.session], deps),
    () => state.authoriseWrite('child', child, parentDoc, builder),
  ]) {
    assert.throws(action, error => {
      assert.match(error.message, /held by the appointed controller \(INT-TK421-, gate G1, epoch 1\)/);
      assert.doesNotMatch(error.message, /G1 gate holder|controller-1|builder-1/);
      return true;
    });
  }
});

test('an executor cannot record its own UAT, review or completion', () => {
  const { store, parentDoc, claimAsBuilder } = setup();
  claimAsBuilder();
  const patch = { lifecycle: 'DONE', uat: { state: 'PASSED', at_head: SHA_A }, review: { state: 'PASSED', verdicts: [{ reviewer: 'self', head: SHA_A, verdict: 'PASSED' }] } };
  assert.throws(() => store.mutate('child', 423, { writer: builder, parentDoc: parentDoc(), change: doc => state.applyPatch('child', doc, patch, { writer: builder, parentDoc: parentDoc() }) }), { code: 'ROLE_REFUSED' });
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
    for (const argv of [['reconcile'], ['reconcile', '--apply', '--session', 's'], ['show'], ['claim', '--issue', '1', '--session', 's']]) {
      assert.throws(() => cli.main(argv, { transport: github, repoRoot: dir, originUrl: 'https://github.com/acme/app.git', stdout: { write() {} } }), { code: 'BINDING_MISSING' });
    }
    assert.equal(github.calls.length, 0, 'no GitHub call is made in a repository that has not opted in');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
