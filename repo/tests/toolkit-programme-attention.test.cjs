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
  assert.equal(fx.github.commits, commits, 'an unchanged run writes nothing');
  // ack by the holder: acknowledged, still listed and printed.
  assert.equal(fx.ctrl(['ack', '--finding', found.id]).result.state, 'acknowledged');
  const listed = fx.run(['attention'], {}, { json: false }).result;
  assert.match(listed, /^Attention: 1 new, 1 acknowledged/);
  assert.match(listed, new RegExp(`${found.id} acknowledged NEEDS_PLACEMENT #470`));
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
  assert.deepEqual(doc.private.attention_notes, { [other.id]: 'tracked in the other board' });
  assert.equal(JSON.stringify(doc.attention).includes('other board'), false, 'never in the public part');
  assert.equal(fx.run(['show', '--parent']).result.document.private, '(redacted; --include-private shows it)');
});

test('E2: only the parent holder answers a finding; refresh takes no answer at all', () => {
  const fx = fixture();
  fx.github.addIssue(470);
  fx.run(['refresh']);
  const { id } = fx.parentDoc().attention[0];
  for (const argv of [['ack', '--finding', id], ['dispose', '--finding', id, '--reason', 'x']]) {
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
  const entry = (n, entryState) => ({ id: state.findingId('inventory', 'NEEDS_PLACEMENT', n, ''), source: 'inventory', code: 'NEEDS_PLACEMENT', issue: n, head: null, state: entryState, first_seen: at(n), changed_at: at(n) });
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
  assert.match(fx.github.issues.get(421).body, /\*\*Attention: 1 new, 0 acknowledged\*\*\n- NEEDS_PLACEMENT #470: Controller: place the issue/);
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

test('E3: the session-start line shows open findings every time, clear once after each change, and never says clear unchecked', () => {
  const dir = tmp();
  let now = '2026-10-28T10:00:00.000Z';
  const deps = { attentionDir: dir, now: () => now };
  assert.deepEqual(cache.sessionAttention('acme/app', deps), { line: 'Attention: not checked on this computer yet', refresh: true, age: null });
  const write = list => cache.writeCache('acme/app', { line: state.attentionLine(list), counts: state.attentionCounts(list), digest: state.attentionDigest(list), complete: true }, deps);
  const finding = (issue, findingState = 'new') => ({ id: state.findingId('inventory', 'NEEDS_PLACEMENT', issue, ''), source: 'inventory', code: 'NEEDS_PLACEMENT', issue, head: null, state: findingState, first_seen: now, changed_at: now });
  write([finding(470)]);
  assert.match(cache.sessionAttention('acme/app', deps).line, /^Attention: 1 new, 0 acknowledged\. Run programme\.cjs attention/);
  write([finding(470, 'acknowledged')]);
  assert.match(cache.sessionAttention('acme/app', deps).line, /^Attention: 0 new, 1 acknowledged/, 'acknowledged never hides');
  assert.match(cache.sessionAttention('acme/app', deps).line, /1 acknowledged/, 'and again next session');
  write([finding(470, 'resolved')]);
  assert.deepEqual(cache.sessionAttention('acme/app', deps), { line: 'Attention: clear', refresh: false, age: null });
  assert.deepEqual(cache.sessionAttention('acme/app', deps), { line: null, refresh: false, age: null }, 'then silent');
  // A second finding comes and goes: clear shows again after that change too.
  write([finding(470, 'resolved'), finding(471)]);
  assert.match(cache.sessionAttention('acme/app', deps).line, /^Attention: 1 new/);
  write([finding(470, 'resolved'), finding(471, 'resolved')]);
  assert.equal(cache.sessionAttention('acme/app', deps).line, 'Attention: clear', 'clear after every change, not only the first');
  assert.equal(cache.sessionAttention('acme/app', deps).line, null);
  now = '2026-10-28T13:00:00.000Z';
  assert.deepEqual(cache.sessionAttention('acme/app', deps), { line: null, refresh: true, age: '3 h' }, 'an old cache asks for a refresh even when silent');
  write([finding(472)]);
  now = '2026-10-28T16:00:00.000Z';
  const stale = cache.sessionAttention('acme/app', deps);
  assert.match(stale.line, /^Attention: 1 new, 0 acknowledged \(as of 3 h ago\)\. Run programme\.cjs attention/);
  assert.doesNotMatch(stale.line, /started/, 'the cache never claims a refresh started');
  assert.equal(stale.refresh, true);
});

test('E3: sessionLine appends the cached line and Checkpoint lines for an ENABLED repository only, with no network call', () => {
  const root = tmp();
  const sessionsDir = tmp();
  const attentionDir = tmp();
  const started = [];
  let now = '2026-10-28T10:00:00.000Z';
  const enabled = { state: 'ENABLED', rule: 'M1', materials_complete: true, root };
  const programmeDeps = { attentionDir, sessionsDir, mergedBinding: () => ({ repository: 'acme/app' }), startRefresh: folder => started.push(folder), now: () => now };
  // The repository's state as decided, in place of reading it.
  const evaluate = (stateValue, deps = programmeDeps) => gate.sessionLine(root, { stateReader: () => stateValue, programmeDeps: deps });
  assert.match(evaluate(enabled), /Toolkit governance: ENABLED[^]*Attention: not checked on this computer yet; a refresh has started in the background\./);
  assert.deepEqual(started, [root], 'one background refresh, started by the trigger');
  // Within 15 minutes no second start, and the line does not claim one.
  now = '2026-10-28T10:10:00.000Z';
  const again = evaluate(enabled);
  assert.match(again, /Attention: not checked on this computer yet\./);
  assert.doesNotMatch(again, /refresh has started/);
  assert.deepEqual(started, [root], 'throttled');
  now = '2026-10-28T10:20:00.000Z';
  assert.match(evaluate(enabled), /refresh has started/);
  assert.equal(started.length, 2);
  // Offline (no injected starter): the refresh never starts and the line never says it did.
  const offline = evaluate(enabled, { ...programmeDeps, startRefresh: undefined, environment: { TOOLKIT_GOVERNANCE_OFFLINE: '1' } });
  assert.match(offline, /Attention: not checked on this computer yet\./);
  assert.doesNotMatch(offline, /refresh has started/);
  for (const off of [{ state: 'DISABLED', rule: 'M2', root }, { state: 'ENABLED', rule: 'R5', materials_complete: false, root }]) {
    assert.doesNotMatch(evaluate(off), /Attention:/, `${off.state} ${off.rule}: no line`);
  }
  // A session here whose last turn-end record failed.
  const hash = checkpoint.sessionHash('exec-a');
  checkpoint.writeLocalBinding({ session_hash: hash, repository: 'acme/app', issue: 423, assignment: 'g1-a1', repo_root: root, bound_at: 'x' }, { sessionsDir });
  checkpoint.recordError(hash, 'GH_AUTH', 'gh is not signed in', { sessionsDir });
  assert.match(evaluate(enabled), new RegExp(`Checkpoint: last turn's record failed \\(GH_AUTH\\); see programme\\.cjs show --session <that session's id> \\(session ${hash.slice(0, 8)}\\)`));
  fs.writeFileSync(checkpoint.errorsFile(hash, { sessionsDir }), JSON.stringify({ pending: null, recent: [] }));
  assert.doesNotMatch(evaluate(enabled), /Checkpoint:/, 'gone after a later good checkpoint');
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
  assert.equal(written.line, 'Attention: 1 new, 0 acknowledged');
  assert.equal(written.repository, 'acme/app');
  assert.equal(Object.keys(written).includes('findings'), false, 'no finding text in the cache');
  const block = fx.github.issues.get(421).body;
  assert.match(block, /AI-AGENT-TOOLKIT:programme-state:BEGIN CURRENT[^]*\*\*Attention: 1 new, 0 acknowledged\*\*[^]*END CURRENT/);
});

// ---- F. Hook capability -------------------------------------------------------------------------

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
    ['Codex, plugin enabled', { claudeRegistry: absent, codexInspect: () => ({ status: 'enabled' }) }, { codex: true }, ['Hooks: Claude Code plugin absent', 'Hooks: Codex present, trust unknown'], true],
    ['Projects synced copy', { claudeRegistry: absent }, { synced: true }, ['Hooks: Claude Code plugin absent', 'Hooks: Claude Projects no local hooks'], true],
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
    assert.equal(lines.includes(hooks.PORTABLE_PATH), portable, `${name}: portable path`);
  }
  const nothing = hooks.describeHooks(hooks.hookCapability({ environment: {}, homeDir: tmp(), readers: {} }));
  assert.deepEqual(nothing, ['Hooks: Toolkit plugin absent', hooks.PORTABLE_PATH]);
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
  assert.match(waiting, /Hooks: Claude Code plugin absent\nWithout hooks, run programme\.cjs refresh and programme\.cjs attention by hand/);
  assert.match(waiting, /Queue: 3 turns waiting \(oldest 2026-10-27\); they are written at the next turn end that can reach GitHub, and dropped unwritten after seven days\./);
  const broken = await run({ hookReader: () => { throw new Error('unreadable'); }, queueReader: () => { throw new Error('unreadable'); } });
  assert.match(broken, /Hooks: could not be checked on this computer\./);
});

test('status: a refresh held by an error code gets a plain reason line', () => {
  assert.equal(bindingCache.refreshReason('IDENTITY_UNREADABLE'), 'the identity read failed (IDENTITY_UNREADABLE)');
  assert.equal(bindingCache.refreshReason('not-applicable'), null);
  assert.equal(bindingCache.refreshReason('<script>'), null);
});

test('session start deletes this repository\'s offline queues once governance is confirmed off, and only then', () => {
  for (const decision of ['disable', null]) {
    const { repo, registryOptions } = githubRepo();
    const sessionsDir = tmp();
    const hash = checkpoint.sessionHash(`exec-${decision}`);
    checkpoint.writeLocalBinding({ session_hash: hash, repository: 'example-owner/example-repo', issue: 7, assignment: 'g1-a1', repo_root: repo, bound_at: 'x' }, { sessionsDir });
    fs.writeFileSync(checkpoint.queueFile(hash, { sessionsDir }), JSON.stringify({ schema: 'toolkit.programme-checkpoint-queue.v1', entries: [{ at: new Date().toISOString(), repository: 'example-owner/example-repo', issue: 7, assignment: 'g1-a1', facts: null, entry: null }] }));
    if (decision) gate.writeGovernanceDecision(repo, decision, { registryOptions });
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
  const entry = (n, entryState) => ({ id: state.findingId('inventory', 'NEEDS_PLACEMENT', n, ''), source: 'inventory', code: 'NEEDS_PLACEMENT', issue: n, head: null, state: entryState, first_seen: at(n), changed_at: at(n) });
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

test('a folder at the throttle path never stops session-start refreshes', () => {
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
  assert.ok(plan.effects.some(effect => effect.text === "Update the comment trace and CURRENT summary in #421's body" || effect.text === "Update the CURRENT summary in #421's body"), JSON.stringify(plan.effects.map(effect => effect.text)));
  assert.equal(plan.effects.some(effect => /comment trace in #421/.test(effect.text) && !/CURRENT/.test(effect.text)), false, 'never labelled as the comment trace alone');
});
