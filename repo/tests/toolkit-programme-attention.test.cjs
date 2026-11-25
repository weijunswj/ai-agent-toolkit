'use strict';

// Programme attention: the open-issue inventory, durable attention findings on the primary parent,
// their lifecycle and how they reach the controller (the attention command, the stored line on gate
// commands, the parent's CURRENT block and the session-start line), and the hook capability line.
// Every row of the closure matrices E1, E2, E3 and F has a case here, against the in-memory GitHub.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const state = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');
const cli = require('../../skills/github-program-reconciler/scripts/programme.cjs');
const cache = require('../../skills/github-program-reconciler/scripts/programme-attention-cache.cjs');
const checkpoint = require('../../skills/github-program-reconciler/scripts/programme-checkpoint.cjs');
const gate = require('../scripts/toolkit-governance-gate.cjs');
const tasks = require('../scripts/toolkit-tasks.cjs');
const hooks = require('../scripts/toolkit-hook-capability.cjs');
const { FakeGitHub } = require('./toolkit-programme-fake-github.cjs');

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const controller = { session: 'controller-1', prefix: 'INT-TK421-' };
const temps = [];
const tmp = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'programme-attention-')); temps.push(dir); return dir; };
test.after(() => { for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true }); });

// A v2 binding with two registered parents (#421 primary, #600 second) and a catalogue under #421.
function fixture({ catalogue = [{ issue: 423, class: 'COMMITTED', parent: 421, order: 1 }], parents = [421, 600], issues = null } = {}) {
  const repository = 'acme/app';
  const github = new FakeGitHub({ repository, store: 'acme/state-store' });
  const binding = state.validateBinding({
    schema: state.SCHEMA.bindingV2, repository, governance: 'enabled',
    parents: parents.map(issue => ({ issue, record_prefix: 'INT-TK421-' })),
    store: { kind: 'github', repository: 'acme/state-store', branch: 'main', path: `state/${repository}/` }, required_checks: ['validate'],
  });
  (issues || (gh => {
    gh.addIssue(421, { body: '## CURRENT\n' });
    gh.addIssue(600, { body: 'Second programme' });
    for (const outcome of catalogue) gh.addIssue(outcome.issue, { body: `Body of ${outcome.issue}`, parent: 421 });
  }))(github);
  const store = new state.StateStore({ transport: github, store: binding.store, now: () => new Date(github.clock).toISOString(), toolkitVersion: '3.9.0' });
  store.write('parent', 421, state.claimDocument(state.newParent({ repository, parentIssue: 421, outcomes: catalogue }), controller, {}), { sha: null, previous: null });
  const fx = { github, binding, store, attentionDir: tmp(), lockFile: path.join(tmp(), 'pass.lock'), output: '', errors: '' };
  fx.parentDoc = () => store.read('parent', 421).doc;
  fx.deps = (extra = {}) => ({ transport: github, binding, originUrl: 'https://github.com/acme/app.git', repoRoot: tmp(), toolkitVersion: '3.9.0', lockFile: fx.lockFile,
    attentionDir: fx.attentionDir, environment: {}, now: () => new Date(github.clock).toISOString(),
    stdout: { write: text => { fx.output += text; } }, stderr: { write: text => { fx.errors += text; } }, ...extra });
  fx.run = (argv, extra = {}, { json = true } = {}) => {
    fx.output = '';
    fx.errors = '';
    try {
      const code = cli.main(json ? [...argv, '--json'] : argv, fx.deps(extra));
      return { code, result: json ? JSON.parse(fx.output.split(/\n(?=\{)/).at(-1)) : fx.output, error: null };
    } catch (error) { return { code: null, result: null, error }; }
  };
  fx.ctrl = (argv, options) => fx.run([...argv, '--session', controller.session, '--controller'], {}, options);
  fx.inventory = (extra = {}) => new state.ProgrammeInventory({ transport: github, repository, parents: state.registeredParents(binding), catalogue: fx.parentDoc().outcomes.map(o => o.issue), ...extra }).run();
  fx.classOf = (result, number) => result.issues.filter(entry => entry.number === number).map(entry => entry.class);
  fx.open = () => fx.parentDoc().attention.filter(entry => ['new', 'acknowledged'].includes(entry.state)).map(entry => `${entry.state} ${entry.code}${entry.issue ? ` #${entry.issue}` : ''}`).sort();
  return fx;
}

// ---- E1. Inventory ------------------------------------------------------------------------------

test('completed PR attention is stable, can be acknowledged, survives incomplete discovery and resolves on backfill', () => {
  const fx = fixture({ parents: [421], catalogue: [{ issue: 423, class: 'COMPLETED', parent: 421, order: 1 }] });
  fx.github.issues.get(423).state = 'closed';
  const reconcile = () => fx.ctrl(['reconcile', '--apply']);
  assert.equal(reconcile().error, null);
  const entry = code => fx.parentDoc().attention.find(item => item.code === code);
  const first = entry('COMPLETED_PR_MISSING');
  assert.equal(first.state, 'new');
  const commits = fx.github.commits;
  assert.equal(reconcile().result.summary, 'No changes');
  assert.equal(fx.github.commits, commits);
  assert.deepEqual(entry('COMPLETED_PR_MISSING'), first);
  assert.equal(fx.ctrl(['ack', '--finding', first.id, '--next', 'Fix the catalogue entry today.']).error, null);
  assert.equal(entry('COMPLETED_PR_MISSING').state, 'acknowledged');
  fx.github.issuePrLinks.set(423, { timelineTruncated: true });
  assert.equal(reconcile().error, null);
  assert.equal(entry('COMPLETED_PR_MISSING').state, 'acknowledged', 'an incomplete read must not resolve an earlier missing PR');
  assert.equal(entry('PR_DISCOVERY_INCOMPLETE').state, 'new');
  const partialCommits = fx.github.commits;
  assert.equal(reconcile().result.summary, 'No changes');
  assert.equal(fx.github.commits, partialCommits);
  fx.github.issuePrLinks.set(423, {});
  fx.github.addPr(800, { head: SHA_A, merged: true, body: 'Refs #423' });
  assert.equal(reconcile().error, null);
  assert.equal(fx.store.read('child', 423).doc.pr.number, 800);
  assert.equal(entry('COMPLETED_PR_MISSING').state, 'resolved');
  assert.equal(entry('PR_DISCOVERY_INCOMPLETE').state, 'resolved');
  assert.equal(reconcile().result.summary, 'No changes');
});

test('E1: 250 open issues over three pages are each classified once, and no pull request is listed', () => {
  const fx = fixture();
  for (let n = 1000; n < 1250; n += 1) fx.github.addIssue(n, { parent: n % 2 ? 421 : null });
  for (let n = 1100; n < 1105; n += 1) fx.github.addPr(n + 500, { head: SHA_A });
  // A pull request node slipped into the connection is never listed either.
  fx.github.intercept(call => {
    if (call.path !== 'graphql' || !/issues\(states: OPEN/.test(call.body.query) || call.body.variables.after !== '100') return undefined;
    const answer = fx.github.inventoryRoute(call.body);
    answer.json.data.repository.issues.nodes.push({ __typename: 'PullRequest', number: 1601, state: 'OPEN', parent: null, labels: { nodes: [] } });
    return answer;
  });
  const result = fx.inventory();
  assert.equal(result.complete, true);
  const numbers = result.issues.map(entry => entry.number);
  assert.equal(numbers.length, new Set(numbers).size, 'nothing counted twice');
  assert.equal(numbers.length, 250 + 3, 'every open issue, the parents and #423 included');
  assert.equal(numbers.some(number => number >= 1600), false, 'no pull request listed');
  assert.equal(fx.github.calls.filter(call => call.path === 'graphql').length, 3, 'three pages');
  assert.deepEqual(fx.classOf(result, 1001), ['CHILD']);
  assert.deepEqual(fx.classOf(result, 1000), ['NEEDS_PLACEMENT']);
  assert.deepEqual(fx.classOf(result, 421), ['PARENT']);
  assert.deepEqual(fx.classOf(result, 600), ['PARENT']);
});

test('E1: a failed page or a passed deadline makes the run incomplete, and it resolves nothing', () => {
  for (const failure of ['page', 'deadline']) {
    const fx = fixture();
    for (let n = 1000; n < 1150; n += 1) fx.github.addIssue(n);
    fx.run(['refresh']);
    const before = fx.open();
    assert.ok(before.includes('new NEEDS_PLACEMENT #1000'));
    for (let n = 1000; n < 1150; n += 1) fx.github.issues.get(n).state = 'closed';
    let clock = 0;
    const extra = {};
    if (failure === 'page') fx.github.intercept(call => (call.path === 'graphql' && call.body.variables?.after === '100' ? { status: 502, json: { message: 'Bad gateway' } } : undefined));
    else extra.inventoryClock = () => (clock += 60000);
    fx.github.addIssue(1200);
    for (let n = 1201; n < 1310; n += 1) fx.github.addIssue(n, { parent: 421 });
    const { result, error } = fx.run(['refresh'], extra);
    assert.equal(error, null, error?.message);
    assert.equal(result.inventory.complete, false, failure);
    // The inventory source only: the reconcile source's complete pass reports the new children itself.
    const inventoryOnly = lines => lines.filter(line => /NEEDS_PLACEMENT|CLOSED_PARENT_OPEN_CHILD|INVENTORY_INCOMPLETE/.test(line));
    const after = fx.open();
    assert.deepEqual(inventoryOnly(after).filter(line => line !== 'new INVENTORY_INCOMPLETE'), inventoryOnly(before), `${failure}: nothing resolved, nothing added from a partial view`);
    assert.ok(after.includes('new INVENTORY_INCOMPLETE'));
  }
});

test('E1: classes for nested children, catalogued outcomes, closed parents and outside markers', () => {
  const fx = fixture({ catalogue: [{ issue: 423, class: 'COMMITTED', parent: 421, order: 1 }, { issue: 430, class: 'COMMITTED', parent: 421, order: 2 }] });
  const gh = fx.github;
  gh.addIssue(430);                                   // catalogued, no native parent yet
  gh.addIssue(440, { parent: 423 });                  // level 2
  gh.addIssue(441, { parent: 440 });                  // level 3
  gh.addIssue(442, { parent: 441 });                  // level 4 under #421
  gh.addIssue(450, { parent: 421 });                  // direct child, not catalogued
  gh.addIssue(460, { parent: 600 });                  // second registered parent
  gh.addIssue(470);                                   // nothing
  gh.addIssue(471, { labels: ['programme:outside'] });
  for (const [number, association] of [[480, 'OWNER'], [481, 'MEMBER'], [482, 'COLLABORATOR'], [483, 'CONTRIBUTOR'], [484, 'NONE']]) {
    gh.addIssue(number);
    gh.addComment(number, { body: 'OUTSIDE-PROGRAMME\nA personal note', association });
  }
  gh.addComment(441, { body: 'OUTSIDE-PROGRAMME', association: 'OWNER' });
  gh.issues.get(600).state = 'closed';                // closed registered parent, open child #460
  const result = fx.inventory();
  const expect = { 423: 'CHILD', 430: 'CHILD', 440: 'CHILD', 441: 'CHILD', 442: 'CHILD', 450: 'CHILD', 460: 'CHILD', 470: 'NEEDS_PLACEMENT', 471: 'OUTSIDE',
    480: 'OUTSIDE', 481: 'OUTSIDE', 482: 'OUTSIDE', 483: 'NEEDS_PLACEMENT', 484: 'NEEDS_PLACEMENT' };
  for (const [number, expected] of Object.entries(expect)) assert.deepEqual(fx.classOf(result, Number(number)), [expected], `#${number}`);
  assert.equal(result.issues.find(entry => entry.number === 480).reason, 'A personal note');
  assert.deepEqual(result.findings.map(finding => `${finding.code} #${finding.issue}`).sort(),
    ['CLOSED_PARENT_OPEN_CHILD #600', 'NEEDS_PLACEMENT #470', 'NEEDS_PLACEMENT #483', 'NEEDS_PLACEMENT #484'], 'deeper descendants raise nothing');
  const commentReads = gh.calls.filter(call => /\/comments/.test(call.path)).map(call => Number(/issues\/(\d+)\/comments/.exec(call.path)[1]));
  assert.deepEqual([...new Set(commentReads)].sort(), [470, 480, 481, 482, 483, 484], 'comments are read only for would-be NEEDS_PLACEMENT issues, never a CHILD');
  // The reconcile source reports the direct uncatalogued child once, and attaches the catalogued one.
  gh.issues.get(600).state = 'open';
  const report = fx.run(['reconcile']).result;
  assert.deepEqual(report.findings.filter(f => f.issue === 450).map(f => f.code), ['NATIVE_CHILD_UNKNOWN'], 'no second code');
  assert.ok(report.findings.some(f => f.code === 'NATIVE_PARENT_MISSING' && f.issue === 430));
  assert.ok(report.effects.some(effect => effect.kind === 'attach' && effect.target.issue === 430));
});

test('E1: a catalogued outcome under another registered parent is never moved; under an unregistered one it is', () => {
  const fx = fixture({ catalogue: [{ issue: 423, class: 'COMMITTED', parent: 421, order: 1 }, { issue: 424, class: 'COMMITTED', parent: 421, order: 2 }] });
  fx.github.addIssue(424, { parent: 600 });
  fx.github.addIssue(425);
  fx.github.link(425, 423);
  const report = fx.run(['reconcile']).result;
  assert.deepEqual(report.findings.filter(f => f.issue === 424 && !/STALE$/.test(f.code)).map(f => f.code), ['DUPLICATE_HIERARCHY']);
  assert.equal(report.effects.some(effect => effect.target.issue === 424 && ['attach', 'reparent'].includes(effect.kind)), false, 'no reparent across programmes');
  assert.deepEqual(report.findings.filter(f => f.issue === 423).map(f => f.code).filter(code => code.startsWith('NATIVE')), ['NATIVE_PARENT_WRONG']);
  assert.ok(report.effects.some(effect => effect.kind === 'reparent' && effect.target.issue === 423));
  fx.run(['reconcile', '--apply', '--controller', '--session', controller.session]);
  assert.equal(fx.github.issues.get(424).parent, 600, 'still under the second programme');
  assert.ok(fx.open().includes('new DUPLICATE_HIERARCHY #424'));
});

test('E1: a parent chain that loops or runs deeper than eight levels makes the run incomplete', () => {
  for (const shape of ['loop', 'deep']) {
    const fx = fixture();
    const gh = fx.github;
    if (shape === 'deep') {
      gh.addIssue(700, { state: 'closed' });
      for (let n = 701; n <= 710; n += 1) gh.addIssue(n, { parent: n - 1, state: n === 710 ? 'open' : 'closed' });
    } else {
      gh.addIssue(800, { state: 'closed' });
      gh.addIssue(801, { state: 'closed', parent: 800 });
      gh.addIssue(802, { parent: 801 });
      gh.issues.get(800).parent = 801; // faked: GitHub itself refuses a loop
    }
    const result = fx.inventory();
    assert.equal(result.complete, false, shape);
    assert.deepEqual(result.findings, [{ code: 'INVENTORY_INCOMPLETE', issue: null }]);
  }
});

test('E1: a repository whose governance is not ENABLED refuses the inventory and attention, changing nothing', () => {
  // A github.com checkout with no merged binding and no decision: UNDECIDED, so never ENABLED.
  const folder = tmp();
  for (const args of [['init', '-q'], ['remote', 'add', 'origin', 'https://github.com/acme/undecided-app.git']]) {
    assert.equal(spawnSync('git', args, { cwd: folder, windowsHide: true }).status, 0);
  }
  for (const command of [['inventory'], ['attention'], ['attention', '--refresh']]) {
    const output = { text: '', write(chunk) { this.text += chunk; } };
    let error = null;
    let code = null;
    try { code = cli.main([...command, '--repo-root', folder], { stdout: output, environment: {} }); } catch (caught) { error = caught; }
    if (command[0] === 'inventory') assert.equal(error.code, 'GITHUB_GOVERNANCE_OFF');
    else { assert.equal(code, 1); assert.match(output.text, /^Attention: unknown \(GITHUB_GOVERNANCE_OFF/); }
  }
});

// ---- E2. Lifecycle ------------------------------------------------------------------------------

test('E2: findings are added, kept without writes, acknowledged, resolved, return and are disposed', () => {
  const fx = fixture();
  fx.github.addIssue(470);
  fx.github.addIssue(471);
  assert.equal(fx.run(['refresh']).error, null);
  const found = fx.parentDoc().attention.find(entry => entry.issue === 470);
  assert.equal(found.state, 'new');
  assert.equal(found.first_seen, found.changed_at);
  assert.equal(found.id, state.findingId('inventory', 'NEEDS_PLACEMENT', 470, ''));
  // Same condition: unchanged, and no store write.
  const commits = fx.github.commits;
  assert.equal(fx.run(['refresh']).result.summary, 'No changes');
  // The sweep takes and releases its lease; no state is written.
  assert.equal(fx.github.commits, commits + 2, 'an unchanged run writes no state');
  // ack by the holder: acknowledged, still listed and printed.
  assert.equal(fx.ctrl(['ack', '--finding', found.id, '--next', 'Find the merged PR today.']).result.state, 'acknowledged');
  const listed = fx.run(['attention'], {}, { json: false }).result;
  assert.match(listed, /^Attention: 1 new, 1 acknowledged/);
  assert.match(listed, new RegExp(`${found.id} acknowledged NEEDS_PLACEMENT #470`));
  assert.match(listed, /Promised by \S+Z: Find the merged PR today\./, 'the promised step and its due time are printed');
  // Condition gone on a partial reconcile or another source's complete run: unchanged.
  fx.github.issues.get(470).labels = ['programme:outside'];
  fx.run(['reconcile', '--apply', '--controller', '--session', controller.session, '--issue', '423']);
  fx.run(['reconcile', '--apply', '--controller', '--session', controller.session]);
  assert.equal(fx.parentDoc().attention.find(entry => entry.id === found.id).state, 'acknowledged');
  // Complete run of its own source: resolved.
  fx.run(['refresh']);
  assert.equal(fx.parentDoc().attention.find(entry => entry.id === found.id).state, 'resolved');
  // Back again: new, same id.
  fx.github.issues.get(470).labels = [];
  fx.run(['refresh']);
  const back = fx.parentDoc().attention.filter(entry => entry.issue === 470);
  assert.deepEqual(back.map(entry => [entry.id, entry.state]), [[found.id, 'new']]);
  // dispose: the reason stays private.
  const other = fx.parentDoc().attention.find(entry => entry.issue === 471);
  assert.equal(fx.ctrl(['dispose', '--finding', other.id, '--reason', 'tracked in the other board']).result.state, 'disposed');
  const doc = fx.parentDoc();
  assert.equal(doc.attention.find(entry => entry.id === other.id).state, 'disposed');
  assert.deepEqual(doc.private.attention_notes, { [found.id]: 'Find the merged PR today.', [other.id]: 'tracked in the other board' });
  assert.equal(JSON.stringify(doc.attention).includes('other board'), false, 'never in the public part');
  assert.equal(fx.run(['show', '--parent']).result.document.private, '(redacted; --include-private shows it)');
});

test('E2: only the parent holder answers a finding; refresh takes no answer at all', () => {
  const fx = fixture();
  fx.github.addIssue(470);
  fx.run(['refresh']);
  const { id } = fx.parentDoc().attention[0];
  for (const argv of [['ack', '--finding', id, '--next', 'x'], ['dispose', '--finding', id, '--reason', 'x']]) {
    assert.equal(fx.run([...argv, '--session', 'someone-else', '--controller']).error.code, 'ROLE_REFUSED', argv[0]);
    assert.equal(fx.run([...argv, '--session', 'lane-1', '--prefix', 'LANE-X-', '--controller']).error.code, 'ROLE_REFUSED');
    assert.equal(fx.run(argv).error.code, 'USAGE', 'without --controller');
    assert.equal(fx.run([...argv, '--session', controller.session, '--controller'], { environment: { TOOLKIT_GATE_ROLE: 'G1' } }).error.code, 'USAGE', 'an executor never answers');
  }
  assert.throws(() => cli.parseArgs(['refresh', '--finding', id]), { code: 'USAGE' });
  assert.equal(fx.parentDoc().attention[0].state, 'new');
});

test('E2: the list keeps 200 entries by dropping the oldest closed ones, and stops adding at 500 open', () => {
  const at = n => new Date(Date.UTC(2026, 9, 1) + n * 60000).toISOString();
  const entry = (n, entryState) => ({ id: state.findingId('inventory', 'NEEDS_PLACEMENT', n, ''), source: 'inventory', code: 'NEEDS_PLACEMENT', issue: n, head: null, state: entryState, first_seen: at(n), changed_at: at(n),
    ...(entryState === 'acknowledged' ? { due: at(10000) } : {}) });
  // 201 entries after a change: the oldest resolved or disposed goes first.
  const list = [...Array.from({ length: 150 }, (unused, n) => entry(n + 1, n % 2 ? 'resolved' : 'disposed')), ...Array.from({ length: 50 }, (unused, n) => entry(n + 1000, 'acknowledged'))];
  const seen = list.filter(item => item.state === 'acknowledged').map(item => ({ code: 'NEEDS_PLACEMENT', issue: item.issue }));
  const next = state.foldAttention(list, { source: 'inventory', complete: true, now: at(9999), seen: [...seen, { code: 'NEEDS_PLACEMENT', issue: 5000 }] });
  assert.equal(next.length, 200);
  assert.equal(next.some(item => item.issue === 1), false, 'the oldest closed entry was dropped');
  assert.equal(next.filter(item => item.state === 'acknowledged').length, 50, 'acknowledged entries are never dropped');
  assert.ok(next.some(item => item.issue === 5000 && item.state === 'new'));
  // 500 open: another condition is not added; ATTENTION_FULL is set, and resolves once back under.
  const full = Array.from({ length: state.ATTENTION_LIMIT }, (unused, n) => entry(n + 1, 'new'));
  const all = full.map(item => ({ code: 'NEEDS_PLACEMENT', issue: item.issue }));
  const capped = state.foldAttention(full, { source: 'inventory', complete: true, now: at(1), seen: [...all, { code: 'NEEDS_PLACEMENT', issue: 9001 }] });
  assert.equal(capped.some(item => item.issue === 9001), false);
  assert.deepEqual(capped.filter(item => item.code === 'ATTENTION_FULL').map(item => item.state), ['new']);
  assert.deepEqual(state.validateParent({ ...state.newParent({ repository: 'acme/app', parentIssue: 421 }), attention: capped }), []);
  const relieved = state.foldAttention(capped, { source: 'inventory', complete: true, now: at(2), seen: all.slice(0, 10) });
  assert.equal(relieved.some(item => item.code === 'ATTENTION_FULL' && item.state === 'new'), false, 'resolved once back under the bound');
  assert.equal(relieved.length, state.ATTENTION_KEEP);
});

test('E2: an attention-only change is written without a revision bump, and the CURRENT line follows', () => {
  const fx = fixture();
  fx.run(['refresh']);
  const before = fx.parentDoc();
  assert.match(fx.github.issues.get(421).body, /\*\*Attention: clear\*\*/);
  fx.github.addIssue(470);
  const commits = fx.github.commits;
  fx.run(['refresh']);
  const after = fx.parentDoc();
  assert.ok(fx.github.commits > commits, 'the store was written');
  assert.equal(after.revision, before.revision, 'revision unchanged');
  assert.match(fx.github.issues.get(421).body, /\*\*Attention: 1 new, 0 acknowledged\*\* · Holds: 0 · Full list: `programme\.cjs attention`/);
  assert.equal(fx.run(['refresh']).result.summary, 'No changes', 'and then it settles');
});

test('E2: the parent schema accepts the attention list the code writes', () => {
  const Ajv2020 = require('ajv/dist/2020');
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'contracts', 'programme-state', 'parent-state-v1.schema.json'), 'utf8'));
  const validate = new Ajv2020({ strict: false, allErrors: true }).compile(schema);
  const fx = fixture();
  fx.github.addIssue(470);
  fx.run(['refresh']);
  const doc = fx.parentDoc();
  assert.ok(doc.attention.length > 0);
  assert.equal(validate(doc), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...doc, attention: [{ ...doc.attention[0], extra: 1 }] }), false);
  assert.equal(state.ATTENTION_LIMIT + state.ATTENTION_KEEP, schema.properties.attention.maxItems);
});

test('E2: the parent schema enum lists every finding code the runtime table can emit', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'contracts', 'programme-state', 'parent-state-v1.schema.json'), 'utf8'));
  const enumerated = schema.properties.attention.items.properties.code.enum;
  const emitted = Object.keys(state.FINDING_CODES);
  assert.deepEqual(emitted.filter(code => !enumerated.includes(code)), [], 'runtime codes missing from the schema enum');
  assert.deepEqual(enumerated.filter(code => !emitted.includes(code)), [], 'schema codes the runtime table does not emit');
});

test('E2: validation refuses a finding with an unknown code, field, state or a forged id', () => {
  const good = { id: state.findingId('reconcile', 'CHECKS_RED', 423, SHA_A), source: 'reconcile', code: 'CHECKS_RED', issue: 423, head: SHA_A, state: 'new', first_seen: '2026-10-28T00:00:00Z', changed_at: '2026-10-28T00:00:00Z' };
  const parent = attention => ({ ...state.newParent({ repository: 'acme/app', parentIssue: 421 }), attention });
  assert.deepEqual(state.validateParent(parent([good])), []);
  for (const [change, pattern] of [
    [{ code: 'MADE_UP' }, /not a known finding code/], [{ note: 'free text' }, /unknown field/], [{ state: 'closed' }, /state must be/],
    [{ id: '0'.repeat(12) }, /own id/], [{ source: 'inventory' }, /code's source/], [{ head: 'abc' }, /head must be/],
  ]) assert.match(state.validateParent(parent([{ ...good, ...change }])).join('\n'), pattern, JSON.stringify(change));
});

// ---- E3. Delivery -------------------------------------------------------------------------------

test('E3: sessionLine appends Checkpoint lines for an ENABLED repository only, with no attention line, no background start and no network call', () => {
  const root = tmp();
  const sessionsDir = tmp();
  const attentionDir = tmp();
  const started = [];
  let now = '2026-10-28T10:00:00.000Z';
  const enabled = { state: 'ENABLED', rule: 'M1', materials_complete: true, programme_records_bind: true, root };
  const programmeDeps = { attentionDir, sessionsDir, home: tmp(), mergedBinding: () => ({ repository: 'acme/app' }), startRefresh: folder => started.push(folder), now: () => now };
  // The repository's state as decided, in place of reading it.
  const evaluate = (stateValue, deps = programmeDeps) => gate.sessionLine(root, { stateReader: () => stateValue, programmeDeps: deps });
  // Due findings reach the controller at turn end: session start shows no attention line and starts no refresh.
  const first = evaluate(enabled);
  assert.match(first, /^Toolkit governance: ENABLED/);
  assert.doesNotMatch(first, /Attention:|refresh has started/);
  now = '2026-10-28T13:00:00.000Z';
  assert.doesNotMatch(evaluate(enabled), /Attention:/);
  assert.deepEqual(started, [], 'no background refresh from session start');
  // A session here whose last turn-end record failed.
  const hash = checkpoint.sessionHash('exec-a');
  checkpoint.writeLocalBinding({ session_hash: hash, repository: 'acme/app', issue: 423, assignment: 'g1-a1', repo_root: root, bound_at: 'x' }, { sessionsDir });
  checkpoint.recordError(hash, 'GH_AUTH', 'gh is not signed in', { sessionsDir });
  assert.match(evaluate(enabled), new RegExp(`Checkpoint: last turn's record failed \\(GH_AUTH\\); see node "[^"]*programme\\.cjs" show --session <that session's id> \\(session ${hash.slice(0, 8)}\\)`));
  fs.writeFileSync(checkpoint.errorsFile(hash, { sessionsDir }), JSON.stringify({ pending: null, recent: [] }));
  assert.doesNotMatch(evaluate(enabled), /Checkpoint:/, 'gone after a later good checkpoint');
});

// Claude Code keeps a session-start text only up to 10,000 characters (else a 2,000-character
// preview), and one Checkpoint line per failed session has no bound: the rules must stay whole.
test('E3: many failed Checkpoint lines are counted, not listed, so the session line keeps the governed rules within the host limit', () => {
  const root = tmp();
  const sessionsDir = tmp();
  const programmeDeps = { attentionDir: tmp(), sessionsDir, home: tmp(), mergedBinding: () => ({ repository: 'acme/app' }), startRefresh: () => {}, now: () => '2026-10-28T10:00:00.000Z' };
  const enabled = { state: 'ENABLED', rule: 'M1', materials_complete: true, programme_records_bind: true, root };
  const evaluate = () => gate.sessionLine(root, { stateReader: () => enabled, programmeDeps });
  const rules = fs.readFileSync(path.join(__dirname, '..', 'contracts', 'agent-rules', 'toolkit-governed-rules.md'), 'utf8').replace(/\r\n/g, '\n').trim();
  for (let index = 0; index < 60; index += 1) {
    const hash = checkpoint.sessionHash(`exec-${index}`);
    checkpoint.writeLocalBinding({ session_hash: hash, repository: 'acme/app', issue: 423, assignment: `g1-${index}`, repo_root: root, bound_at: 'x' }, { sessionsDir });
    checkpoint.recordError(hash, 'GH_AUTH', 'gh is not signed in', { sessionsDir });
  }
  const line = evaluate();
  assert.equal(gate.SESSION_TEXT_LIMIT, 10000);
  assert.ok(Buffer.byteLength(line, 'utf8') <= gate.SESSION_TEXT_LIMIT, `${Buffer.byteLength(line, 'utf8')} bytes`);
  assert.equal(line.split(rules).length, 2, 'the whole governed rules text, once');
  assert.match(line, /^Toolkit governance: ENABLED/);
  assert.doesNotMatch(line, /Attention:/);
  const listed = (line.match(/Checkpoint: last turn's record failed/g) || []).length;
  const more = Number((/Checkpoint: (\d+) more sessions here also failed their last turn's record \(left out to keep this text within the host's session-start limit\)/.exec(line) || [])[1]);
  assert.ok(listed > 0, 'the first ones are still listed');
  assert.equal(listed + more, 60, 'every failed session is listed or counted');
});

test('E3: sessionLine never reads the retired Windows task registry, whatever an old sweep task recorded', () => {
  const root = tmp();
  const home = tmp();
  const now = new Date(2026, 10, 1, 12, 0, 0);
  const programmeDeps = { attentionDir: tmp(), sessionsDir: tmp(), home, mergedBinding: () => ({ repository: 'acme/app' }), startRefresh: () => {}, now: () => now.toISOString() };
  const enabled = { state: 'ENABLED', rule: 'M1', materials_complete: true, programme_records_bind: true, root };
  const evaluate = () => gate.sessionLine(root, { stateReader: () => enabled, programmeDeps });
  tasks.writeRegistry(home, [{ id: 'app-programme-sweep', name: 'APP - PROGRAMME SWEEP', host: 'windows', folder: 'APP', schedule: 'hourly, 08:00 to 23:59', model: null, effort: null,
    purpose: 'Sweep.', repository: 'acme/app', created: '2026-10-30T00:00:00.000Z', created_by: 'toolkit-windows-tasks apply', job: 'programme-sweep', definition: '0123456789ab' }]);
  const at = new Date(now.getTime() - 50 * 60000).toISOString();
  const lastRun = path.join(tasks.userStateDir(home), 'tasks', 'app-programme-sweep', 'last-run.json');
  fs.mkdirSync(path.dirname(lastRun), { recursive: true });
  for (const status of ['skipped', 'held', 'failed']) {
    fs.writeFileSync(lastRun, JSON.stringify({ started: at, finished: at, exit: status === 'failed' ? 1 : 0, status, reason: 'offline', skipped_streak: 3, summary: [] }));
    const line = evaluate();
    assert.match(line, /Toolkit governance: ENABLED/);
    assert.doesNotMatch(line, /Programme sweep:|Task health|see toolkit tasks/, status);
  }
});

test('E3: attention reports gh signed out as unknown, never clear', () => {
  const fx = fixture();
  const signedOut = new state.GitHubTransport({ ghPath: 'gh-for-tests', run: () => ({ status: 4, stdout: '', stderr: 'To get started with GitHub CLI, please run:  gh auth login' }) });
  const { code, result } = fx.run(['attention'], { transport: signedOut }, { json: false });
  assert.equal(code, 1);
  assert.equal(result, 'Attention: unknown (gh not signed in)\n');
  const refreshed = fx.run(['attention', '--refresh'], { transport: signedOut });
  assert.equal(refreshed.result.line, 'Attention: unknown (gh not signed in)');
});

test('E3: claim, assign, return --consume and a terminal update print the stored line first, with no extra GitHub request', () => {
  const fx = fixture();
  fx.github.addIssue(470);
  fx.run(['refresh']);
  const calls = argv => { const from = fx.github.calls.length; const run = fx.ctrl(argv, { json: false }); return { run, count: fx.github.calls.length - from }; };
  const withLine = calls(['assign', '--issue', '423', '--role', 'G1', '--assignment', 'g1-a1']);
  assert.equal(withLine.run.error, null);
  assert.match(fx.errors, /^Attention: 1 new, 0 acknowledged \(stored on #421, written \d+ min ago\)\n$/);
  assert.equal(JSON.parse(fx.output).attention.line, 'Attention: 1 new, 0 acknowledged');
  // The same command with no findings makes exactly as many requests.
  const clean = fixture();
  clean.run(['refresh']);
  const from = clean.github.calls.length;
  clean.ctrl(['assign', '--issue', '423', '--role', 'G1', '--assignment', 'g1-a1'], { json: false });
  assert.equal(withLine.count, clean.github.calls.length - from, 'no extra GitHub request');
  for (const argv of [['claim', '--parent'], ['return', '--issue', '423', '--record', 'g1-r1', '--assignment', 'g1-a1'], ['return', '--issue', '423', '--consume', 'g1-r1', '--verdict', 'REOPEN']]) {
    const { run } = calls(argv);
    const printed = /^Attention: /.test(fx.errors);
    assert.equal(printed, argv[1] !== '--issue' || argv.includes('--consume'), argv.join(' '));
    void run;
  }
  const patch = path.join(tmp(), 'patch.json');
  fs.writeFileSync(patch, JSON.stringify({ lifecycle: 'RETIRED', completed_at: '2026-10-28T00:00:00Z' }));
  calls(['update', '--issue', '423', '--patch', patch]);
  assert.match(fx.errors, /^Attention: 1 new/);
  fs.writeFileSync(patch, JSON.stringify({ blockers: ['waiting'] }));
  calls(['update', '--issue', '423', '--patch', patch]);
  assert.equal(fx.errors, '', 'an ordinary update prints nothing');
});

test('E3: refresh and attention write this computer\'s cache, and a cloud surface reads the CURRENT block', () => {
  const fx = fixture();
  fx.github.addIssue(470);
  fx.run(['refresh']);
  const written = cache.readCache('acme/app', { attentionDir: fx.attentionDir });
  assert.equal(written.repository, 'acme/app');
  assert.ok(Array.isArray(written.net));
  assert.deepEqual(Object.keys(written).sort(), ['as_of', 'complete', 'net', 'repository', 'schema'], 'no line, counts or finding text in the cache');
  const block = fx.github.issues.get(421).body;
  assert.match(block, /AI-AGENT-TOOLKIT:programme-state:BEGIN CURRENT[^]*\*\*Attention: 1 new, 0 acknowledged\*\*[^]*END CURRENT/);
});

// ---- F. Hook capability -------------------------------------------------------------------------

// The hand-run path names both programme commands runnable, from where the script really is.
const PORTABLE = /^Without hooks, run node "[^"]*programme\.cjs" refresh and node "[^"]*programme\.cjs" attention by hand at session start and before each gate\.$/;

test('F: the Hooks lines for each host, with the portable path whenever a host has no running hook', () => {
  const home = () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    return dir;
  };
  const plugin = tmp();
  fs.mkdirSync(path.join(plugin, '.claude-plugin', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(plugin, '.claude-plugin', 'hooks', 'hooks.json'), '{}');
  const installed = { toolkitInstall: () => ({ installed: true, runningRoot: plugin }) };
  const absent = { toolkitInstall: () => ({ installed: false }) };
  const rows = [
    ['Claude Code, plugin, hooks declared', { claudeRegistry: installed, claudeBlockers: () => [] }, {}, ['Hooks: Claude Code present (trust not checkable)'], false],
    ['Claude Code from the desktop app\'s claude.ai account copy', { claudeRegistry: absent, claudeAccountCopy: () => plugin, claudeBlockers: () => [] }, {}, ['Hooks: Claude Code present (claude.ai account copy; trust not checkable)'], false],
    ['Claude Code account copy, hooks off in settings', { claudeRegistry: absent, claudeAccountCopy: () => plugin, claudeBlockers: () => ['Your Claude Code user settings set disableAllHooks.'] }, {}, ['Hooks: Claude Code disabled (Your Claude Code user settings set disableAllHooks.)'], true],
    ['Claude Code account copy with no hooks declared', { claudeRegistry: absent, claudeAccountCopy: () => tmp(), claudeBlockers: () => [] }, {}, ['Hooks: Claude Code plugin present, no hooks declared'], true],
    ['Claude Code, no install and no account copy', { claudeRegistry: absent, claudeAccountCopy: () => null }, {}, ['Hooks: Claude Code plugin absent'], true],
    ['Claude Code, hooks off in settings', { claudeRegistry: installed, claudeBlockers: () => ['Your Claude Code user settings set disableAllHooks.'] }, {}, ['Hooks: Claude Code disabled (Your Claude Code user settings set disableAllHooks.)'], true],
    // Codex runs the hooks and Claude Code has no Toolkit, so no session here runs Toolkit without hooks.
    ['Codex, plugin enabled', { claudeRegistry: absent, codexInspect: () => ({ status: 'enabled' }) }, { codex: true }, ['Hooks: Claude Code plugin absent', 'Hooks: Codex present, trust unknown'], false],
    ['Projects synced copy', { claudeRegistry: absent }, { synced: true }, ['Hooks: Claude Code plugin absent', 'Hooks: Claude Projects hooks run in cloud threads from the account copy'], true],
    // #1381 L2: the synced Projects line is not this computer's, so it never adds the hand-run line.
    ['Claude Code hooks and the Projects synced copy', { claudeRegistry: installed, claudeBlockers: () => [] }, { synced: true }, ['Hooks: Claude Code present (trust not checkable)', 'Hooks: Claude Projects hooks run in cloud threads from the account copy'], false],
    ['Claude Code hooks, Codex without Toolkit', { claudeRegistry: installed, claudeBlockers: () => [], codexInspect: () => ({ status: 'unprovable' }) }, { codex: true }, ['Hooks: Claude Code present (trust not checkable)', 'Hooks: Codex plugin absent'], false],
    ['Claude Code hooks off, Codex hooks on', { claudeRegistry: installed, claudeBlockers: () => ['Your Claude Code user settings set disableAllHooks.'], codexInspect: () => ({ status: 'enabled' }) }, { codex: true }, ['Hooks: Claude Code disabled (Your Claude Code user settings set disableAllHooks.)', 'Hooks: Codex present, trust unknown'], true],
    ['no plugin anywhere', { claudeRegistry: absent, codexInspect: () => ({ status: 'unprovable' }) }, { codex: true }, ['Hooks: Claude Code plugin absent', 'Hooks: Codex plugin absent'], true],
  ];
  for (const [name, readers, setup, expected, portable] of rows) {
    const dir = home();
    if (setup.codex) fs.mkdirSync(path.join(dir, '.codex'));
    if (setup.synced) {
      fs.mkdirSync(path.join(dir, '.claude', 'skills', 'synced', 'abc', 'web-controller-projects'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.claude', 'skills', 'synced', 'abc', 'web-controller-projects', 'SKILL.md'), 'x');
    }
    const result = hooks.hookCapability({ environment: {}, homeDir: dir, readers });
    const lines = hooks.describeHooks(result);
    assert.deepEqual(lines.filter(line => line.startsWith('Hooks:')), expected, name);
    assert.equal(lines.some(line => PORTABLE.test(line)), portable, `${name}: portable path`);
  }
  // A Claude Code cloud session runs the account copy's hooks, so it needs no hand-run line.
  const cloud = hooks.describeHooks(hooks.hookCapability({ environment: { CLAUDE_CODE_REMOTE: 'true' }, homeDir: tmp(), readers: {} }));
  assert.deepEqual(cloud, ['Hooks: Claude Code account copy hooks run (cloud session; merge hold runs)']);
  const nothing = hooks.describeHooks(hooks.hookCapability({ environment: {}, homeDir: tmp(), readers: {} }));
  assert.equal(nothing.length, 2);
  assert.equal(nothing[0], 'Hooks: Toolkit plugin absent');
  assert.match(nothing[1], PORTABLE);
});

test('every attention and inventory script stays free of model calls', () => {
  for (const file of ['programme.cjs', 'programme-state.cjs', 'programme-attention-cache.cjs', 'programme-checkpoint.cjs']) {
    const text = fs.readFileSync(path.join(__dirname, '..', '..', 'skills', 'github-program-reconciler', 'scripts', file), 'utf8');
    assert.doesNotMatch(text, /api\.anthropic\.com|openai\.com|\/v1\/messages|claude\s+-p|codex\s+exec/i, file);
  }
});

// ---- status lines and the session-start queue discard ---------------------------------------------

const { ToolkitGovernanceCli } = require('../scripts/toolkit-governance.cjs');
const bindingCache = require('../scripts/toolkit-governance-binding.cjs');

function githubRepo() {
  const root = tmp();
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  for (const args of [['init', '-q'], ['remote', 'add', 'origin', 'https://github.com/example-owner/example-repo.git']]) {
    assert.equal(spawnSync('git', args, { cwd: repo, windowsHide: true }).status, 0);
  }
  return { repo, registryOptions: { registryPath: path.join(root, 'state', 'repository-governance.v1.json'), testOnly: true } };
}

test('status: Hooks lines for each host, and Queue only while turns wait', async () => {
  const { repo, registryOptions } = githubRepo();
  const run = async readers => {
    const out = { text: '', write(chunk) { this.text += chunk; return true; } };
    const cli = new ToolkitGovernanceCli({ stdout: out, stderr: out, cwd: repo, registryOptions, refresh: () => ({ refreshed: true }), interactive: false, ...readers });
    await cli.main(['status']);
    return out.text;
  };
  const hostsOf = hosts => () => ({ hosts, portable: hosts.some(entry => !/^present/.test(entry.state)) });
  const present = await run({ hookReader: hostsOf([{ host: 'Claude Code', state: 'present (trust not checkable)' }, { host: 'Codex', state: 'present, trust unknown' }]), queueReader: () => ({ count: 0, oldest: null }) });
  assert.match(present, /Hooks: Claude Code present \(trust not checkable\)\nHooks: Codex present, trust unknown\n/);
  assert.doesNotMatch(present, /Queue:|by hand/);
  const waiting = await run({ hookReader: hostsOf([{ host: 'Claude Code', state: 'plugin absent' }]), queueReader: () => ({ count: 3, oldest: '2026-10-27T08:00:00.000Z' }) });
  assert.match(waiting, /Hooks: Claude Code plugin absent\nWithout hooks, run node "[^"]*programme\.cjs" refresh and node "[^"]*programme\.cjs" attention by hand/);
  assert.match(waiting, /Queue: 3 turns waiting \(oldest 2026-10-27\); they are written at the next turn end that can reach GitHub, and dropped unwritten after seven days\./);
  const broken = await run({ hookReader: () => { throw new Error('unreadable'); }, queueReader: () => { throw new Error('unreadable'); } });
  assert.match(broken, /Hooks: could not be checked on this computer\./);
});

test('status: a refresh held by an error code gets a plain reason line', () => {
  assert.equal(bindingCache.refreshReason('IDENTITY_UNREADABLE'), 'the identity read failed (IDENTITY_UNREADABLE)');
  assert.equal(bindingCache.refreshReason('not-applicable'), null);
  assert.equal(bindingCache.refreshReason('<script>'), null);
  // #1394 L3: codes that never reach status have no line of their own.
  for (const code of ['refresh-failed', 'identity-invalid']) assert.equal(bindingCache.refreshReason(code), null, code);
});

test('status: an origin that cannot be read is not a refresh that was held', () => {
  const dir = tmp();
  const governance = require('../scripts/toolkit-governance-state.cjs');
  // No repository, no origin and an origin with no repository in it: each is answered before any refresh.
  for (const origin of [null, '', 'https://github.com/']) {
    const repo = path.join(dir, `repo-${String(origin).length}-${origin === null}`);
    if (origin === null) fs.mkdirSync(repo);
    else {
      require('node:child_process').execFileSync('git', ['init', '--quiet', repo], { stdio: 'ignore', windowsHide: true });
      if (origin) require('node:child_process').execFileSync('git', ['-C', repo, 'config', 'remote.origin.url', origin], { stdio: 'ignore', windowsHide: true });
    }
    const runGit = () => { throw new Error('no read is started'); };
    assert.deepEqual(governance.refreshMergedBinding(repo, { registryPath: path.join(dir, 'state', 'repository-governance.v1.json'), testOnly: true }, { runGit }), { refreshed: false, error: 'not-applicable' }, String(origin));
  }
});

test('session start deletes this repository\'s offline queues once governance is confirmed off, and only then', () => {
  for (const decision of ['disable', null]) {
    const { repo, registryOptions } = githubRepo();
    const sessionsDir = tmp();
    const hash = checkpoint.sessionHash(`exec-${decision}`);
    checkpoint.writeLocalBinding({ session_hash: hash, repository: 'example-owner/example-repo', issue: 7, assignment: 'g1-a1', repo_root: repo, bound_at: 'x' }, { sessionsDir });
    fs.writeFileSync(checkpoint.queueFile(hash, { sessionsDir }), JSON.stringify({ schema: 'toolkit.programme-checkpoint-queue.v1', entries: [{ at: new Date().toISOString(), repository: 'example-owner/example-repo', issue: 7, assignment: 'g1-a1', facts: null, entry: null }] }));
    if (decision) require('./support/governance-observations.cjs').seedMerged(repo, decision, { registryOptions });
    gate.startSession({ session_id: `s-${decision}`, cwd: repo, source: 'startup' }, { registryOptions, refreshBinding: () => ({ refreshed: false }), programmeDeps: { sessionsDir } });
    assert.equal(fs.existsSync(checkpoint.queueFile(hash, { sessionsDir })), decision === null, `${decision || 'undecided'}`);
  }
});

// ---- Review fixes -------------------------------------------------------------------------------

test('M2: attention --refresh prints the pass\'s holds and exits 1, as plain refresh does', () => {
  const fx = fixture();
  // Pages written by a newer Toolkit: the pass holds their bodies.
  const newer = '<!-- AI-AGENT-TOOLKIT:programme-state:BEGIN STATE v2 toolkit=9.9.9 sha256=000000000000 -->\nx\n<!-- AI-AGENT-TOOLKIT:programme-state:END STATE -->';
  fx.github.issues.get(421).body = `## CURRENT\n${newer}\n`;
  const plain = fx.run(['refresh']);
  assert.equal(plain.code, 1);
  assert.ok(plain.result.holds.some(hold => hold.code === 'BLOCK_NEWER_TOOLKIT'));
  const json = fx.run(['attention', '--refresh']);
  assert.equal(json.code, 1);
  assert.ok(json.result.refreshed.holds.some(hold => hold.code === 'BLOCK_NEWER_TOOLKIT' && hold.target === '#421'));
  const text = fx.run(['attention', '--refresh'], {}, { json: false });
  assert.equal(text.code, 1);
  assert.match(text.result, /^Attention: [^\n]+\n\nThe refresh pass held\n- BLOCK_NEWER_TOOLKIT #421: /);
  // Without a hold it exits 0 and prints no hold section.
  const clean = fixture();
  const ok = clean.run(['attention', '--refresh'], {}, { json: false });
  assert.equal(ok.code, 0);
  assert.doesNotMatch(ok.result, /refresh pass held/);
});

test('L1: a partial reconcile resolves no reconcile-source finding', () => {
  const fx = fixture();
  fx.github.addIssue(450, { parent: 421 });
  fx.run(['reconcile', '--apply', '--controller', '--session', controller.session]);
  const entry = () => fx.parentDoc().attention.find(item => item.code === 'NATIVE_CHILD_UNKNOWN' && item.issue === 450);
  assert.equal(entry().state, 'new');
  // The condition goes away, but a pass for one issue never resolves anything.
  fx.github.issues.get(421).subs = fx.github.issues.get(421).subs.filter(number => number !== 450);
  fx.github.issues.get(450).parent = null;
  fx.run(['reconcile', '--apply', '--controller', '--session', controller.session, '--issue', '423']);
  assert.equal(entry().state, 'new', 'unchanged after reconcile --issue');
  fx.run(['reconcile', '--apply', '--controller', '--session', controller.session]);
  assert.equal(entry().state, 'resolved', 'a full pass resolves it');
});

test('L4: inventory and attention only read GitHub, and the inventory command lists every class', () => {
  const fx = fixture();
  fx.github.addIssue(440, { parent: 423 });
  fx.github.addIssue(470);
  fx.github.addIssue(471, { labels: ['programme:outside'] });
  fx.github.addIssue(472);
  fx.github.addComment(472, { body: 'OUTSIDE-PROGRAMME\nOwn board', association: 'OWNER' });
  fx.run(['refresh']);
  const from = fx.github.calls.length;
  const commits = fx.github.commits;
  const text = fx.run(['inventory'], {}, { json: false });
  assert.equal(text.code, 0);
  assert.match(text.result, /^Inventory of acme\/app \(registered parents #421, #600\): complete\nPARENT 2, CHILD 2, OUTSIDE 2, NEEDS_PLACEMENT 1\n/);
  assert.match(text.result, /NEEDS_PLACEMENT\n- #470\n/);
  assert.match(text.result, /OUTSIDE\n- #471: label programme:outside\n- #472: Own board\n/);
  assert.match(text.result, /Findings \(recorded by the next refresh\)\n- NEEDS_PLACEMENT #470/);
  const json = fx.run(['inventory']).result;
  assert.deepEqual(json.counts, { PARENT: 2, CHILD: 2, OUTSIDE: 2, NEEDS_PLACEMENT: 1 });
  fx.run(['attention']);
  fx.run(['attention'], {}, { json: false });
  const writes = fx.github.calls.slice(from).filter(call => call.method !== 'GET' && !(call.path === 'graphql' && !/\bmutation\b/.test(call.body.query)));
  assert.deepEqual(writes, [], 'no write of any kind: no issue, comment, label, link or store change');
  assert.equal(fx.github.commits, commits, 'no store commit');
});

test('N3: a dispose reason goes when its finding drops off the list, and stays while it is listed', () => {
  const fx = fixture();
  const at = n => new Date(Date.UTC(2026, 9, 1) + n * 60000).toISOString();
  const entry = (n, entryState) => ({ id: state.findingId('inventory', 'NEEDS_PLACEMENT', n, ''), source: 'inventory', code: 'NEEDS_PLACEMENT', issue: n, head: null, state: entryState, first_seen: at(n), changed_at: at(n),
    ...(entryState === 'acknowledged' ? { due: at(10000) } : {}) });
  // 200 closed entries: the oldest is disposed (it drops first), and one recent disposed entry stays.
  const list = Array.from({ length: 200 }, (unused, n) => entry(5000 + n, n === 0 || n === 199 ? 'disposed' : 'resolved'));
  const oldest = list[0].id;
  const recent = list[199].id;
  fx.store.mutate('parent', 421, { writer: controller, change: doc => ({ ...doc, attention: list, private: { ...doc.private, attention_notes: { [oldest]: 'old reason', [recent]: 'recent reason' } } }) });
  fx.github.addIssue(470);
  fx.run(['refresh']);
  const doc = fx.parentDoc();
  assert.equal(doc.attention.length, 200);
  assert.equal(doc.attention.some(item => item.id === oldest), false, 'the oldest closed entry dropped');
  assert.deepEqual(doc.private.attention_notes, { [recent]: 'recent reason' }, 'its reason went with it; the listed one kept its reason');
});

test('a folder at the throttle path never stops background refreshes', () => {
  const attentionDir = tmp();
  const deps = { attentionDir, now: () => '2026-10-28T10:00:00.000Z' };
  fs.mkdirSync(`${cache.cacheFile('acme/app', deps)}.started`, { recursive: true });
  assert.equal(cache.claimBackgroundStart('acme/app', deps), true);
  assert.equal(cache.claimBackgroundStart('acme/app', deps), true, 'unthrottled, never blocked');
  const fresh = { attentionDir: tmp(), now: () => '2026-10-28T10:00:00.000Z' };
  assert.equal(cache.claimBackgroundStart('acme/app', fresh), true);
  assert.equal(cache.claimBackgroundStart('acme/app', fresh), false, 'a normal file throttles');
});

test('F: an account folder without a readable manifest never hides a later one that holds Toolkit', () => {
  const appData = tmp();
  const rpm = path.join(appData, 'Claude-Data', 'claude_test', 'rpm');
  const empty = path.join(rpm, 'a', 'b');
  const broken = path.join(rpm, 'a', 'c');
  const holder = path.join(rpm, 'a', 'd');
  for (const folder of [empty, broken, holder]) fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(broken, 'manifest.json'), '{ not json');
  fs.writeFileSync(path.join(holder, 'manifest.json'), JSON.stringify({ plugins: [{ name: 'other', id: 'x1' }, { name: 'ai-agent-toolkit', id: 'tk_1' }] }));
  assert.equal(hooks.accountHookCopy({ LOCALAPPDATA: appData }), path.join(holder, 'tk_1'));
  assert.equal(hooks.accountHookCopy({ LOCALAPPDATA: tmp() }), null, 'no account folders');
  fs.writeFileSync(path.join(holder, 'manifest.json'), JSON.stringify({ plugins: [{ name: 'ai-agent-toolkit', id: '../escape' }] }));
  assert.equal(hooks.accountHookCopy({ LOCALAPPDATA: appData }), null, 'an id that is not a plain name is never followed');
});

test('a refresh that changes only the CURRENT summary names it in the effect', () => {
  const fx = fixture();
  fx.run(['refresh']);
  fx.github.addIssue(450, { parent: 421 });
  const plan = fx.run(['reconcile']).result;
  assert.ok(plan.effects.some(effect => effect.kind === 'update_attention'));
  assert.ok(plan.effects.some(effect => effect.text === "Update the CURRENT summary in #421's body"), JSON.stringify(plan.effects.map(effect => effect.text)));
  assert.equal(plan.effects.some(effect => /DECISIONS block/.test(effect.text)), false, 'the parent has no DECISIONS block to name');
});

test('work queue: a stalled-task finding is never acknowledged, leads the list, and returns as new after a dispose clears', () => {
  const at = minute => new Date(Date.parse('2026-11-13T00:00:00Z') + minute * 60000).toISOString();
  const seen = [{ code: 'TASK_IDLE', issue: 835 }, { code: 'TASK_MERGED_OPEN', issue: 877 }];
  const noise = Array.from({ length: 12 }, (_, i) => ({ code: 'CLOSING_COMMENT_MISSING', issue: 900 + i }));
  let list = state.foldAttention([], { source: 'reconcile', complete: true, now: at(0), seen });
  list = state.foldAttention(list, { source: 'reconcile', complete: true, now: at(5), seen: [...seen, ...noise] });
  const idle = list.find(entry => entry.code === 'TASK_IDLE');
  const doc = { attention: list, private: {} };
  assert.throws(() => state.answerFinding(doc, { next: 'Fixture next step', id: idle.id, state: 'acknowledged', now: at(6) }), error => error.code === 'QUEUE_FINDING_NEEDS_ACTION' && /dispose --finding/.test(error.message));
  // The line counts the queue, and the CURRENT block shows every queue entry ahead of twelve newer findings.
  assert.match(state.attentionLine(list, at(6)), /^Attention: 14 new, 0 acknowledged, 2 in the work queue$/);
  assert.deepEqual(state.workQueue(list).map(entry => entry.issue).sort(), [835, 877]);
  // Two days on, they show as work queue, never as waiting on the owner.
  assert.match(state.attentionLine(list, at(3000)), /, 2 in the work queue, 12 waiting on you$/);
  // Disposed with a reason, then the task moves (unseen on a complete run): resolved, so a later stall is new.
  const disposed = state.answerFinding(doc, { next: 'Fixture next step', id: idle.id, state: 'disposed', reason: 'owner parked it until Monday', now: at(7) });
  const moved = state.foldAttention(disposed.attention, { source: 'reconcile', complete: true, now: at(8), seen: [seen[1], ...noise] });
  assert.equal(moved.find(entry => entry.id === idle.id).state, 'resolved');
  const again = state.foldAttention(moved, { source: 'reconcile', complete: true, now: at(9), seen: [...seen, ...noise] });
  assert.equal(again.find(entry => entry.id === idle.id).state, 'new');
  // Other codes keep their old answers.
  const other = list.find(entry => entry.code === 'CLOSING_COMMENT_MISSING');
  assert.equal(state.answerFinding(doc, { next: 'Fixture next step', id: other.id, state: 'acknowledged', now: at(6) }).attention.find(entry => entry.id === other.id).state, 'acknowledged');
});

// Findings are the controller's work: an acknowledgement is a promise with a next step and a due time,
// and a missed one goes back to new and waits on the owner at once.
test('an ack needs a next step and a due time within 72 hours; past due it is new and waiting at once', () => {
  const base = Date.parse('2026-11-13T00:00:00.000Z');
  const at = hours => new Date(base + hours * 3600000).toISOString();
  const doc = state.newParent({ repository: 'acme/app', parentIssue: 421 });
  doc.attention = state.foldAttention([], { source: 'reconcile', complete: true, now: at(0), seen: [{ code: 'CHECKS_RED', issue: 7, head: SHA_A }] });
  const id = doc.attention[0].id;
  assert.throws(() => state.answerFinding(doc, { id, state: 'acknowledged', now: at(0) }), /ack needs --next/);
  assert.throws(() => state.answerFinding(doc, { id, state: 'acknowledged', next: 'x'.repeat(201), now: at(0) }), /ack needs --next/);
  assert.throws(() => state.answerFinding(doc, { id, state: 'acknowledged', next: 'Fix CI', due: at(73), now: at(0) }), /at most 72 hours/);
  assert.throws(() => state.answerFinding(doc, { id, state: 'acknowledged', next: 'Fix CI', due: at(-1), now: at(0) }), /after now/);
  assert.throws(() => state.answerFinding(doc, { id, state: 'acknowledged', next: 'Fix CI', due: '2026-11-13T09:00:00', now: at(0) }), /with Z or an offset/, 'no zone is never read as local time');
  assert.equal(state.answerFinding(doc, { id, state: 'acknowledged', next: 'Fix CI', due: '2026-11-13T17:00:00+08:00', now: at(0) }).attention[0].due, at(9));
  const acked = state.answerFinding(doc, { id, state: 'acknowledged', next: 'Builder fixes CI today', now: at(0) });
  assert.equal(acked.attention[0].due, at(24), 'due 24 hours ahead unless given');
  assert.equal(acked.private.attention_notes[id], 'Builder fixes CI today');
  assert.deepEqual(state.validateParent(acked), []);
  assert.doesNotMatch(state.attentionLine(acked.attention, at(23)), /waiting on you/);
  assert.match(state.attentionLine(acked.attention, at(24)), /1 waiting on you/, 'a missed promise waits on the owner at once');
  // Any run past the due time stores it as new; it stays waiting until answered again.
  const folded = state.foldAttention(acked.attention, { source: 'inventory', complete: true, now: at(25), seen: [] });
  assert.equal(folded[0].state, 'new');
  assert.match(state.attentionLine(folded, at(25)), /1 waiting on you/);
  // Overdue, it is answered again with a new step; a still-current ack is not.
  assert.equal(state.answerFinding(acked, { id, state: 'acknowledged', next: 'again', now: at(1) }), null, 'a current ack is left as it is');
  const again = state.answerFinding(acked, { id, state: 'acknowledged', next: 'Owner told; fix lands tonight', now: at(25) });
  assert.equal(again.attention[0].due, at(49));
  assert.doesNotMatch(state.attentionLine(again.attention, at(26)), /waiting on you/);
  // An acknowledgement from before due times falls due a day after its last change.
  const legacy = [{ ...doc.attention[0], state: 'acknowledged', changed_at: at(0) }];
  assert.equal(state.foldAttention(legacy, { source: 'inventory', complete: true, now: at(23), seen: [] }), legacy, 'not due yet: unchanged');
  assert.equal(state.foldAttention(legacy, { source: 'inventory', complete: true, now: at(24), seen: [] })[0].state, 'new');
  assert.throws(() => cli.parseArgs(['ack', '--finding', id, '--controller', '--session', 's']), /--next/);
  assert.throws(() => cli.parseArgs(['dispose', '--finding', id, '--reason', 'r', '--next', 'n', '--controller', '--session', 's']), /--next and --due go with ack/);
});

test('every reported finding carries a next step, and a stuck sweep is a finding', () => {
  for (const [code, entry] of Object.entries(state.FINDING_CODES)) assert.ok(typeof entry.next_action === 'string' && entry.next_action.length > 10, `${code} has a next action`);
  for (const code of ['PR_WITHOUT_TASK', 'CLOSED_WITHOUT_ACCEPTANCE', 'CHILD_REOPENED', 'SWEEP_STUCK']) {
    assert.equal(state.withNextAction({ code, issue: 5 }).detail, state.FINDING_CODES[code].next_action, `${code} prints its next step, never undefined`);
  }
  assert.equal(state.withNextAction({ code: 'CHECKS_RED', issue: 5, detail: 'own' }).detail, 'own');
  assert.match(state.withNextAction({ code: 'NOT_A_CODE', issue: 5 }).detail, /Toolkit bug/);
  // Every finding the reconciler pushes without its own detail is in the table.
  const source = fs.readFileSync(path.join(__dirname, '../../skills/github-program-reconciler/scripts/programme-state.cjs'), 'utf8');
  const bare = [...source.matchAll(/findings\.push\(\{ ?code: ?'([A-Z_]+)'(?:(?!detail)[^}])*\}\)/g)].map(match => match[1]);
  assert.ok(bare.includes('SWEEP_STUCK'));
  for (const code of bare) assert.ok(Object.hasOwn(state.FINDING_CODES, code), `${code} has a next action in FINDING_CODES`);
  const stuck = state.foldAttention([], { source: 'reconcile', complete: false, now: '2026-11-13T00:00:00.000Z', seen: [{ code: 'SWEEP_STUCK', issue: 421 }] });
  assert.equal(stuck[0].state, 'new');
  assert.deepEqual(state.validateParent({ ...state.newParent({ repository: 'acme/app', parentIssue: 421 }), attention: stuck }), []);
});

test('every session-start problem line names who acts and when, and an attention cache adds no line', () => {
  const root = tmp();
  const home = tmp();
  const attentionDir = tmp();
  const sessionsDir = tmp();
  const now = new Date(2026, 10, 1, 12, 0, 0);
  const programmeDeps = { attentionDir, sessionsDir, home, mergedBinding: () => ({ repository: 'acme/app' }), startRefresh: () => {}, now: () => now.toISOString() };
  const enabled = { state: 'ENABLED', rule: 'M1', materials_complete: true, programme_records_bind: true, root };
  const evaluate = () => gate.sessionLine(root, { stateReader: () => enabled, programmeDeps });
  cache.writeCache('acme/app', { complete: true, net: [{ id: 'abcdefabcdef', code: 'TASK_IDLE', issue: 4, kind: null, state: 'new', changed_at: '2026-10-30T00:00:00.000Z', due: null }] }, { attentionDir, now: () => now.toISOString() });
  const hash = checkpoint.sessionHash('exec-b');
  checkpoint.writeLocalBinding({ session_hash: hash, repository: 'acme/app', issue: 423, assignment: 'g1-a1', repo_root: root, bound_at: 'x' }, { sessionsDir });
  checkpoint.recordError(hash, 'GH_AUTH', 'gh is not signed in', { sessionsDir });
  const line = evaluate();
  assert.deepEqual(Object.keys(gate.FINDING_ACTIONS), ['checkpoint']);
  assert.ok(line.includes(gate.FINDING_ACTIONS.checkpoint), line);
  assert.doesNotMatch(line, /Attention:|answer each new or overdue finding/);
});

test('work queue: a disposed stalled-task finding that is still seen stays disposed', () => {
  const at = minute => new Date(Date.parse('2026-11-13T00:00:00Z') + minute * 60000).toISOString();
  const seen = [{ code: 'TASK_IDLE', issue: 835 }];
  const list = state.foldAttention([], { source: 'reconcile', complete: true, now: at(0), seen });
  const disposed = state.answerFinding({ attention: list, private: {} }, { id: list[0].id, state: 'disposed', reason: 'blocked by the vendor fix', now: at(1) });
  const still = state.foldAttention(disposed.attention, { source: 'reconcile', complete: true, now: at(60), seen });
  assert.equal(still.find(entry => entry.id === list[0].id).state, 'disposed', 'the same stall keeps its answer');
  assert.equal(state.workQueue(still).length, 0);
});

test('work queue: an older acknowledged stalled-task finding still counts on CURRENT', () => {
  const now = '2026-11-13T10:00:00.000Z';
  const entry = { id: state.findingId('reconcile', 'TASK_IDLE', 835, ''), source: 'reconcile', code: 'TASK_IDLE', issue: 835, head: null, state: 'acknowledged', first_seen: now, changed_at: now };
  const body = state.renderCurrentBlockBody({ revision: 1, outcomes: [], attention: [entry] }, new Map(), new Map(), now);
  assert.match(body, /\*\*Attention: 0 new, 1 acknowledged, 1 in the work queue\*\* · Holds: 0 · /);
});

test('E4: attention writes the open net findings into the cache for the turn-end owed check, oldest first, IDs and times only', () => {
  const fx = fixture();
  fx.run(['refresh']);
  const older = '2026-11-12T00:00:00.000Z';
  const newer = '2026-11-13T00:03:00.000Z';
  const merged = { id: state.findingId('reconcile', 'TASK_MERGED_OPEN', 423, ''), source: 'reconcile', code: 'TASK_MERGED_OPEN', issue: 423, head: null, state: 'new', first_seen: newer, changed_at: newer };
  const close = { id: state.findingId('reconcile', 'CLOSE_DUE', 423, '', 'g1-423-a1'), source: 'reconcile', code: 'CLOSE_DUE', issue: 423, head: null, kind: 'g1-423-a1', state: 'acknowledged', first_seen: older, changed_at: older, due: newer };
  const notNet = { id: state.findingId('inventory', 'INVENTORY_INCOMPLETE', null, ''), source: 'inventory', code: 'INVENTORY_INCOMPLETE', issue: null, head: null, state: 'new', first_seen: older, changed_at: older };
  assert.equal(state.NET_CODES.has(notNet.code), false);
  fx.store.mutate('parent', 421, { writer: controller, change: doc => ({ ...doc, attention: [...(doc.attention || []), merged, close, notNet] }) });
  fx.run(['attention']);
  const written = cache.readCache('acme/app', { attentionDir: fx.attentionDir });
  const mine = written.net.filter(entry => [merged.id, close.id, notNet.id].includes(entry.id));
  assert.deepEqual(mine, [
    { id: close.id, code: 'CLOSE_DUE', issue: 423, kind: 'g1-423-a1', state: 'acknowledged', changed_at: older, due: newer },
    { id: merged.id, code: 'TASK_MERGED_OPEN', issue: 423, kind: null, state: 'new', changed_at: newer, due: null },
  ]);
});

// ---- Owner waits --------------------------------------------------------------------------------

test('attention lists every task waiting on the owner, read from the children at read time, and says unknown when a child cannot be read', () => {
  const catalogue = [423, 424, 425, 426, 427].map((issue, order) => ({ issue, class: 'COMMITTED', parent: 421, order }));
  // Agent UAT first: an owed UAT waits on the owner only once the agent's UAT passed at its head.
  const agentPassed = (doc, head) => { doc.private = { ...doc.private, agent_uat: { state: 'PASSED', at_head: head, evidence: 'evidence/agent-uat/REPORT.md' } }; };
  const fx = fixture({ catalogue });
  const write = (issue, change) => {
    const doc = { ...state.newChild({ repository: 'acme/app', outcome: catalogue.find(outcome => outcome.issue === issue) }), lifecycle: 'ACTIVE' };
    change(doc);
    fx.store.write('child', issue, doc, { sha: null, previous: null });
  };
  write(423, doc => { doc.lifecycle = 'WAITING_OWNER'; Object.assign(doc.pr, { number: 900, state: 'MERGED', head: SHA_A }); Object.assign(doc.uat, { state: 'PENDING', at_head: SHA_A }); agentPassed(doc, SHA_A); });
  write(424, doc => { doc.blockers = ['waits for #423']; });
  write(425, doc => {
    Object.assign(doc.pr, { number: 901, state: 'OPEN', head: SHA_B });
    Object.assign(doc.uat, { state: 'PENDING', at_head: SHA_B });
    Object.assign(doc.gate, { role: 'G2', state: 'ACTIVE', assignment: { id: 'a-425-g2', role: 'G2' } });
    agentPassed(doc, SHA_B);
  });
  write(427, doc => { doc.lifecycle = 'WAITING_OWNER'; Object.assign(doc.pr, { number: 902, state: 'MERGED', head: SHA_B }); Object.assign(doc.uat, { state: 'PENDING', at_head: SHA_B }); });
  const json = fx.run(['attention']);
  assert.equal(json.error, null);
  // Graph order: 425 is in progress; 423's task PR merged, so it sorts in the NOW · CLOSE CHECK band after it.
  assert.deepEqual(json.result.owner_waits, [
    { issue: 425, ask: 'UAT on PR #901', after: 'G2', agent_uat: 'PASSED', uat_head: SHA_B, pr_state: 'OPEN', gate_live: true, pr: 901, head: SHA_B },
    { issue: 423, ask: 'UAT on PR #900', after: null, agent_uat: 'PASSED', uat_head: SHA_A, pr_state: 'MERGED', gate_live: false, pr: 900, head: SHA_A },
  ], 'a blocked task, a task with no document and a UAT the agent still owes are not owner waits');
  const text = fx.run(['attention'], {}, { json: false }).result;
  assert.match(text, /^Owner waits \(2\)\n- #425 UAT on PR #901 after G2 · PR #901 · bbbbbbb\n- #423 UAT on PR #900 · PR #900 · aaaaaaa$/m);
  assert.match(text, /^Attention: /, 'the Attention line still leads');
  const { blobSha } = require('./toolkit-programme-fake-github.cjs');
  fx.github.files.set(fx.store.docPath('child', 424), { text: '{not json', sha: blobSha('{not json') });
  fx.github.commit();
  const broken = fx.run(['attention']);
  assert.equal(broken.error, null, 'the findings still print');
  assert.equal(broken.result.owner_waits, null);
  assert.equal(broken.result.owner_waits_unknown, 'STATE_INVALID');
  assert.match(fx.run(['attention'], {}, { json: false }).result, /^Owner waits: unknown \(STATE_INVALID\)$/m, 'never an empty list from a failed read');
});

// ---- Open pull requests -------------------------------------------------------------------------

test('attention lists every open pull request with its owner, next step and failing jobs, read live, and never a short list', () => {
  const catalogue = [{ issue: 423, class: 'COMMITTED', parent: 421, order: 1 }];
  const fx = fixture({ catalogue });
  fx.store.write('child', 423, { ...state.newChild({ repository: 'acme/app', outcome: catalogue[0] }), lifecycle: 'ACTIVE', next_action: `Builder: ${'finish the slice '.repeat(12)}` }, { sha: null, previous: null });
  const before = hours => new Date(fx.github.clock - hours * 3600 * 1000).toISOString();
  const job = (name, conclusion) => ({ __typename: 'CheckRun', name, status: 'COMPLETED', conclusion, completedAt: before(1), checkSuite: { app: { databaseId: 15368 } }, isRequired: false });
  fx.github.addPr(900, { head: SHA_A, title: 'The owned slice', body: 'Refs #423', createdAt: before(30), contexts: [job('validate', 'FAILURE')] });
  fx.github.addPr(901, { head: SHA_A, title: 'A title that runs past\u0007 the sixty characters the list keeps of it', createdAt: before(7 * 24 + 1), author: 'app/github-actions', isDraft: true });
  fx.github.addPr(902, { head: SHA_B, title: 'Refresh the shards', createdAt: before(2), contexts: [job('gate', 'FAILURE'), job('validate', 'FAILURE'), job('lint', 'SUCCESS')] });
  fx.github.addPr(903, { head: SHA_B, title: 'A new one', createdAt: before(0.5) });
  const flaggedAfter = new Date(Date.parse(before(0.5)) + 24 * 3600 * 1000).toISOString();
  fx.github.storePulls.push({ number: 12, title: 'Store clean-up', draft: false, created_at: before(26) });
  fx.run(['refresh']);
  const entry = (code, issue, kind) => fx.parentDoc().attention.find(item => item.code === code && item.issue === issue && item.kind === kind);
  const ids = { aged: entry('PR_UNOWNED', 901)?.id, red: entry('PR_RED_UNOWNED', 902)?.id, store: entry('PR_UNOWNED', 12, 'store')?.id };
  const at = fx.github.calls.length;
  const text = fx.run(['attention'], {}, { json: false }).result;
  const block = text.slice(text.indexOf('Open PRs')).split('\n');
  assert.deepEqual(block.slice(0, 7), ['Open PRs (5)',
    `- PR #903 "A new one", open 0 h, owner none, flagged after ${flaggedAfter}`,
    `- PR #902 "Refresh the shards", open 2 h, owner none, flagged ${ids.red}, failing: gate, validate`,
    `- PR #901 "A title that runs past the sixty characters the list keep...", draft, open 7 d, owner none, flagged ${ids.aged}`,
    `- PR #900 "The owned slice", open 30 h, owner #423, next: Builder: ${'finish the slice '.repeat(12).slice(0, 108)}...`,
    `- store PR 12 "Store clean-up", open 26 h, owner none, flagged ${ids.store}`, '']);
  assert.doesNotMatch(text, /store (?:PR )?#12|#12\b/, 'a store number never links to a task here');
  assert.match(text, new RegExp(`^- ${ids.store} new PR_UNOWNED store PR 12: Controller: today, land`, 'm'));
  assert.match(text, new RegExp(`^- ${ids.red} new PR_RED_UNOWNED PR #902 at bbbbbbb: Controller: read the failing job`, 'm'));
  const reads = fx.github.calls.slice(at);
  assert.deepEqual([reads.filter(call => /\/pulls\?state=open/.test(call.path)).length, reads.filter(call => /p90\d: pullRequest/.test(call.body?.query || '')).length], [2, 1], 'two lists and one check batch');
  // The owner of an acknowledged one is the controller, until its due time.
  const acked = fx.ctrl(['ack', '--finding', ids.red, '--next', 'gate failed on a full disk; rerun every job']);
  assert.equal(acked.error, null);
  const json = fx.run(['attention']).result;
  assert.deepEqual(json.open_prs.map(row => [row.where, row.number, row.owner, row.code, row.red, row.failing]), [['repo', 903, 'none', null, false, []],
    ['repo', 902, 'controller', 'PR_RED_UNOWNED', true, ['gate', 'validate']], ['repo', 901, 'none', 'PR_UNOWNED', false, []],
    ['repo', 900, '#423', null, false, []], ['store', 12, 'none', 'PR_UNOWNED', false, []]]);
  assert.match(fx.run(['attention'], {}, { json: false }).result, new RegExp(`^- PR #902 "Refresh the shards", open 2 h, owner controller until ${acked.result.due}, next: gate failed on a full disk; rerun every job, failing: gate, validate$`, 'm'));
  // Each read failing on its own.
  const failing = match => { fx.github.hooks = [call => (match(call) ? { status: 503, json: { message: 'unavailable' } } : undefined)]; return fx.run(['attention'], {}, { json: false }); };
  const noList = failing(call => call.path.startsWith('repos/acme/app/pulls?state=open'));
  assert.equal(noList.error, null, 'the rest still prints');
  assert.match(noList.result, /^Open PRs: unknown \(GH_FAILED\)$/m);
  assert.match(noList.result, /^Owner waits \(0\)$/m);
  const noStore = failing(call => call.path.startsWith('repos/acme/state-store/pulls')).result;
  assert.match(noStore, /^Open PRs \(4\)$/m);
  assert.match(noStore, /^store pull requests not read \(GH_FAILED\)$/m);
  const noChecks = failing(call => /p90\d: pullRequest/.test(call.body?.query || '') || /\/pulls\/90\d$/.test(call.path)).result;
  assert.match(noChecks, /^Open PRs \(5\)$/m);
  assert.match(noChecks, /^check results not read \(GH_FAILED\)$/m);
  assert.match(noChecks, /^- PR #902 .*owner controller until /m, 'a red one known before stays so');
  fx.github.hooks = [];
  assert.equal(fx.run(['attention']).result.open_prs_store_unread, undefined);
  const { blobSha } = require('./toolkit-programme-fake-github.cjs');
  fx.github.files.set(fx.store.docPath('child', 423), { text: '{not json', sha: blobSha('{not json') });
  fx.github.commit();
  const broken = fx.run(['attention']).result;
  assert.deepEqual([broken.open_prs, broken.open_prs_unknown], [null, 'STATE_INVALID'], 'owners cannot be worked out without every task');
});

test('the parent schema and the reader take a store pull request finding, and no other kind on these codes', () => {
  const Ajv2020 = require('ajv/dist/2020');
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'contracts', 'programme-state', 'parent-state-v1.schema.json'), 'utf8'));
  const validate = new Ajv2020({ strict: false, allErrors: true }).compile(schema);
  const at = '2026-11-24T09:00:00Z';
  const make = (code, kind, head = null) => ({ id: state.findingId('reconcile', code, 12, head, kind), source: 'reconcile', code, issue: 12, head, state: 'new', first_seen: at, changed_at: at, ...(kind ? { kind } : {}) });
  const doc = entry => ({ ...state.newParent({ repository: 'acme/app', parentIssue: 421 }), attention: [entry] });
  for (const [entry, taken] of [[make('PR_UNOWNED'), true], [make('PR_UNOWNED', 'store'), true], [make('PR_UNOWNED', 'pr'), false], [make('PR_RED_UNOWNED', null, SHA_A), true], [make('PR_RED_UNOWNED', 'store', SHA_A), false],
    [make('CHECKS_RED', 'store', SHA_A), false], [make('CLOSING_COMMENT_MISSING', 'store'), false], [make('CLOSING_COMMENT_MISSING', 'pr'), true]]) {
    assert.equal(state.validateParent(doc(entry)).length === 0, taken, `${entry.code} ${entry.kind}`);
    assert.equal(validate(doc(entry)), taken, `schema: ${entry.code} ${entry.kind}`);
  }
});

// ---- runnable programme.cjs hints (#1373) ---------------------------------------------------------

// A session read "Run programme.cjs attention for the list", looked where most Toolkit scripts are
// (repo/scripts) and said the script was missing. Every hint a session on this computer reads names
// the runnable command, from where the script really is.
const userState = require('../scripts/toolkit-user-state.cjs');
const TOOLKIT_ROOT = path.join(__dirname, '..', '..');

test('programme.cjs hints name the runnable command: the managed checkout\'s copy when recorded, else this copy\'s', () => {
  const home = fs.realpathSync.native(tmp());
  const own = path.join(TOOLKIT_ROOT, ...userState.PROGRAMME_SCRIPT.split('/'));
  assert.ok(fs.existsSync(own), 'the named script is there');
  assert.equal(userState.programmeCommand('attention', { userHome: home }), `node "${own}" attention`, 'no recorded checkout: this copy');
  const checkout = path.join(home, 'GitHub', 'ai-agent-toolkit');
  fs.mkdirSync(path.join(home, '.ai-agent-toolkit', 'current'), { recursive: true });
  fs.writeFileSync(path.join(home, '.ai-agent-toolkit', 'current', 'state.json'), JSON.stringify({ repo_path: checkout }));
  assert.equal(userState.programmeCommand('attention', { userHome: home }), `node "${own}" attention`, 'a recorded checkout without the script: this copy');
  const managed = path.join(checkout, ...userState.PROGRAMME_SCRIPT.split('/'));
  fs.mkdirSync(path.dirname(managed), { recursive: true });
  fs.writeFileSync(managed, '');
  const expected = `node "${checkout.replace(/\\/g, '/')}/skills/github-program-reconciler/scripts/programme.cjs" attention`;
  assert.equal(userState.programmeCommand('attention', { userHome: home }), expected);
});

// Text kept on GitHub or in the evidence store is read on other computers, so it keeps a portable
// name; every other `programme.cjs <command>` in Toolkit's scripts is built by programmeCommand.
test('every programme.cjs hint a session on this computer reads is built by the shared helper', () => {
  const allowed = [
    [/^toolkit-programme-sweep-(?:action|gate)\.cjs$/, /./, 'the cloud sweep runs in GitHub Actions'],
    [/./, /Usage: programme\.cjs|finding id that programme\.cjs attention lists/, 'usage text of the script itself'],
    [/^programme-state\.cjs$/, /every programme\.cjs command refuses|Only programme\.cjs migrate-state --apply creates it/, 'says which command may act, not what to run'],
    [/^programme-state\.cjs$/, /`programme\.cjs (?:trace|attention)\b|INVENTORY_INCOMPLETE: /, 'GitHub page and stored finding text'],
    [/^programme-handover\.cjs$/, /Generated by `programme\.cjs handover`|`programme\.cjs trace \$\{issue\}\\?`/, 'the handover file in the evidence store'],
  ];
  const folders = [path.join(TOOLKIT_ROOT, 'repo', 'scripts'), ...fs.readdirSync(path.join(TOOLKIT_ROOT, 'skills')).map(name => path.join(TOOLKIT_ROOT, 'skills', name, 'scripts'))];
  const bare = [];
  let kept = 0;
  for (const folder of folders.filter(dir => fs.existsSync(dir))) {
    for (const name of fs.readdirSync(folder).filter(file => file.endsWith('.cjs'))) {
      fs.readFileSync(path.join(folder, name), 'utf8').split('\n').forEach((line, index) => {
        if (/^\s*(?:\/\/|\*)/.test(line) || !/programme\.cjs [a-z<-]/.test(line)) return;
        if (allowed.some(([file, text]) => file.test(name) && text.test(line))) { kept += 1; return; }
        bare.push(`${name}:${index + 1}`);
      });
    }
  }
  assert.deepEqual(bare, [], 'a bare programme.cjs hint: build it with programmeCommand');
  assert.ok(kept > 0, 'the scan reads the scripts');
  const handover = fs.readFileSync(path.join(TOOLKIT_ROOT, 'skills', 'github-program-reconciler', 'scripts', 'programme-handover.cjs'), 'utf8');
  assert.match(handover, /answer attention \(\\`node <Toolkit>\/\$\{[^}]*PROGRAMME_SCRIPT\} attention\\`\)/, 'the stored handover names the script from the Toolkit root');
});

// A cloud session whose GitHub link cannot reach the evidence store: the advice is to wait for the
// owner's computer, never to pick another store; on a computer the store check keeps its advice.
test('red: in a cloud session a store that answers 403 or 404 says the check waits for the computer, not to choose another store', () => {
  for (const status of [401, 403, 404]) {
    const fx = fixture({ parents: [421] });
    const refused = Object.assign(Object.create(fx.github), {
      request: (method, endpoint, ...rest) => (method === 'GET' && endpoint === 'repos/acme/state-store' ? { status, json: { message: 'Resource not accessible by integration' } } : fx.github.request(method, endpoint, ...rest)),
    });
    const cloud = fx.run(['attention'], { transport: refused, environment: { CLAUDE_CODE_REMOTE: 'true' } }, { json: false });
    assert.equal(cloud.code, 1, `${status}: unknown, never clear`);
    assert.match(cloud.result, new RegExp(`^Attention: unknown \\(STATE_STORE_UNVERIFIED: The state store acme/state-store is not reachable from this cloud session \\(${status}\\), so nothing was read or written\\. The check waits for the owner's computer: the next refresh there reads the store\\.\\)\\n$`), status);
    assert.doesNotMatch(cloud.result, /Choose a private repository/);
    const computer = fx.run(['attention'], { transport: refused, environment: {} }, { json: false });
    assert.match(computer.result, new RegExp(`could not be read \\(${status}\\)\\. Choose a private repository you can write to`), `${status}: a computer keeps the store advice`);
  }
  // A cloud session that reaches a public store is still refused with the store advice.
  const fx = fixture({ parents: [421] });
  const open = Object.assign(Object.create(fx.github), {
    request: (method, endpoint, ...rest) => (method === 'GET' && endpoint === 'repos/acme/state-store' ? { status: 200, json: { private: false, permissions: { push: true } } } : fx.github.request(method, endpoint, ...rest)),
  });
  assert.match(fx.run(['attention'], { transport: open, environment: { CLAUDE_CODE_REMOTE: 'true' } }, { json: false }).result, /because it is not private\. Choose a private repository/);
});
