'use strict';

// Refused page redraws keep numeric evidence, never page text, until a full verified pass.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const state = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');
const cli = require('../../skills/github-program-reconciler/scripts/programme.cjs');
const { FakeGitHub } = require('./toolkit-programme-fake-github.cjs');

const writer = { session: 'controller-1', prefix: 'INT-APP-' };
const LARGE = '# Private heading\r\n' + 'Private prose \u{1f600}\r\n'.repeat(4200);

function fixture(t) {
  const github = new FakeGitHub();
  const binding = state.validateBinding({ schema: state.SCHEMA.bindingV2, repository: 'acme/app', governance: 'enabled',
    parents: [{ issue: 12, record_prefix: writer.prefix }],
    store: { kind: 'github', repository: 'acme/state-store', branch: 'main', path: 'state/acme/app/' }, required_checks: ['validate'] });
  github.addIssue(12, { body: '## CURRENT\n' });
  github.addIssue(13, { parent: 12 });
  const now = () => new Date(github.clock).toISOString();
  const store = new state.StateStore({ transport: github, store: binding.store, now, toolkitVersion: '3.9.0' });
  store.write('parent', 12, state.claimDocument(state.newParent({ repository: 'acme/app', parentIssue: 12,
    outcomes: [{ issue: 13, class: 'COMMITTED', parent: 12, order: 1 }] }), writer, {}), { sha: null, previous: null });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'redraw-hold-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const reconciler = new state.Reconciler({ binding, store, reader: new state.ProgrammeGraphReader({ transport: github, repository: binding.repository }),
    mutator: new state.GitHubMutator({ transport: github, repository: binding.repository }), writer, now, toolkitVersion: '3.9.0' });
  const parent = () => store.read('parent', 12).doc;
  const entry = (number = 12) => parent().attention?.find(item => item.code === 'BODY_TOO_LARGE' && item.issue === number);
  const run = args => {
    let text = '';
    const code = cli.main(args, { binding, transport: github, originUrl: 'https://github.com/acme/app.git', repoRoot: home,
      toolkitVersion: '3.9.0', now, environment: {}, attentionDir: home, stdout: { write: chunk => { text += chunk; } } });
    return { code, text };
  };
  return { github, store, reconciler, parent, entry, run };
}

function diagnostics(fx, entry, expected) {
  assert.ok(entry, 'a size hold must become a durable finding');
  const d = entry.diagnostics;
  assert.equal(d.projected_total, expected);
  assert.equal(d.threshold, 60000);
  assert.equal(d.required_reduction, expected - 60000 + 1);
  assert.ok(d.largest_sections.length > 0 && d.largest_sections.length <= 5);
  assert.equal(d.largest_sections.reduce((sum, part) => sum + part.size, d.remainder), expected, 'disjoint sections and remainder sum exactly');
  assert.ok(d.largest_sections.some(part => part.kind === 'hand_written'));
  assert.doesNotMatch(JSON.stringify(entry), /Private heading|Private prose/);
  assert.deepEqual(state.validateParent(fx.parent()), []);
  assert.doesNotThrow(() => state.publicView('parent', fx.parent()));
  const Ajv = require('ajv/dist/2020');
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '../contracts/programme-state/parent-state-v1.schema.json'), 'utf8'));
  const validate = new Ajv({ strict: false }).compile(schema);
  assert.equal(validate(fx.parent()), true, JSON.stringify(validate.errors));
}

test('planning refusals persist stable per-page findings with exact bounded diagnostics and no body write', t => {
  const fx = fixture(t);
  fx.github.issues.get(12).body += LARGE;
  fx.github.issues.get(13).body += LARGE;
  const plan = fx.reconciler.plan();
  assert.equal(plan.holds.filter(item => item.code === 'BODY_TOO_LARGE').length, 2);
  assert.equal(fx.entry(), undefined, 'preview writes nothing');
  const applied = fx.reconciler.run({ apply: true });
  for (const number of [12, 13]) {
    const hold = applied.holds.find(item => item.code === 'BODY_TOO_LARGE' && item.target === `#${number}`);
    diagnostics(fx, fx.entry(number), hold.diagnostics.projected_total);
    assert.equal(fx.entry(number).state, 'new');
  }
  assert.equal(fx.github.calls.some(call => call.method === 'PATCH' && /issues\/(12|13)$/.test(call.path)), false);
  const before = fx.entry();
  fx.reconciler.run({ apply: true });
  assert.deepEqual(fx.entry(), before, 'repeated refusal retains identity and timestamps');
  const shown = fx.run(['attention']).text;
  assert.match(shown, /projected \d+; threshold 60000; reduce by \d+/);
  assert.match(shown, /Hand-written section \d+: \d+/);
  assert.match(shown, /remainder: \d+/);
  const preview = fx.run(['reconcile']).text;
  assert.match(preview, /projected \d+; threshold 60000; reduce by \d+/);
  assert.doesNotMatch(preview, /undefined/);
  const apply = fx.run(['reconcile', '--apply', '--controller', '--session', writer.session]).text;
  assert.match(apply, /SKIPPED: Update the state block in #12's body/);
  assert.doesNotMatch(apply, /undefined/);
});

test('a current child with a size finding writes nothing while the parent is refused', t => {
  const fx = fixture(t);
  for (const number of [12, 13]) fx.github.issues.get(number).body += LARGE;
  fx.reconciler.run({ apply: true });
  assert.equal(fx.entry(13).state, 'new');
  fx.github.issues.get(13).body = '';
  fx.reconciler.run({ apply: true });
  assert.equal(fx.entry(13).state, 'new', 'the parent hold prevents resolution');
  const before = fx.github.calls.length;
  const report = fx.reconciler.run({ apply: true });
  assert.ok(report.holds.some(hold => hold.code === 'BODY_TOO_LARGE' && hold.target === '#12'));
  assert.deepEqual(report.writes, { state: 0, github: 0 });
  assert.ok(report.results.some(result => result.kind === 'replace_block' && result.target.issue === 13 && result.outcome === 'NOOP'));
  assert.equal(fx.github.calls.slice(before).some(call => call.method !== 'GET' && call.path !== 'graphql'), false);
});

test('attention shrink removes a pre-fold size refusal even on an incomplete pass', t => {
  const fx = fixture(t);
  fx.reconciler.run({ apply: true });
  fx.store.mutate('parent', 12, { writer, change: doc => {
    doc.attention = state.foldAttention([], { source: 'reconcile', complete: false,
      seen: Array.from({ length: 10 }, (_, i) => ({ code: 'ISSUE_MISSING', issue: 90 + i })),
      now: new Date(fx.github.clock).toISOString() });
    return doc;
  } });
  const inventory = { complete: false, findings: [{ code: 'INVENTORY_INCOMPLETE', issue: null }], issues: [], reason: 'deadline' };
  const lengths = [];
  const project = fx.reconciler.projectBody.bind(fx.reconciler);
  fx.reconciler.projectBody = (...args) => {
    const next = project(...args);
    if (args[0] === 12) lengths.push(next.body.length);
    return next;
  };
  fx.reconciler.plan({ inventory });
  assert.ok(lengths[0] > lengths.at(-1), 'resolving old findings shrinks CURRENT');
  fx.reconciler.threshold = lengths[0];
  const plan = fx.reconciler.plan({ inventory });
  assert.equal(plan.complete, false);
  assert.equal(plan.holds.some(hold => hold.code === 'BODY_TOO_LARGE'), false, 'the final redraw fits');
  assert.equal(plan.findings.some(finding => finding.code === 'BODY_TOO_LARGE'), false, 'discard the earlier measurement');
  const report = fx.reconciler.run({ apply: true, inventory });
  assert.equal(report.holds.some(hold => hold.code === 'BODY_TOO_LARGE'), false);
  assert.equal(fx.entry(), undefined, 'no stale size finding persists');
});

test('apply-time overflow persists before any refused page write, including a repeat', t => {
  const fx = fixture(t);
  const plan = fx.reconciler.plan();
  fx.github.issues.get(12).body += LARGE;
  const first = fx.reconciler.apply(plan);
  const hold = first.holds.find(item => item.code === 'BODY_TOO_LARGE');
  assert.ok(hold);
  diagnostics(fx, fx.entry(), hold.diagnostics.projected_total);
  const id = fx.entry().id;
  fx.reconciler.run({ apply: true });
  assert.equal(fx.entry().id, id);
  assert.equal(fx.github.calls.some(call => call.method === 'PATCH' && /issues\/12$/.test(call.path)), false);
});

test('apply-time topic preview and final directory read both persist newly oversized pages', t => {
  for (const mode of ['topic', 'directory']) {
    const fx = fixture(t);
    if (mode === 'topic') fx.reconciler.threshold = 6000;
    else fx.github.issues.get(12).body += 'Retained prose '.repeat(3500);
    for (let i = 0; i < 150; i += 1) fx.github.addComment(12, { body: `${mode === 'topic' ? 'Scope' : `Topic ${i}`}\n---\nDecision ${i}` });
    const plan = fx.reconciler.plan();
    assert.equal(plan.holds.length, 0, mode);
    assert.ok(plan.effects.some(effect => effect.kind === 'post_index_comment' && Boolean(effect.target.directory) === (mode === 'directory')), mode);
    if (mode === 'topic') fx.github.issues.get(12).body += LARGE;
    else fx.github.intercept(call => {
      if (call.method === 'POST' && call.path === 'repos/acme/app/issues/12/comments') fx.github.issues.get(12).body += LARGE;
      return undefined;
    });
    const report = fx.reconciler.apply(plan);
    const hold = report.holds.find(entry => entry.code === 'BODY_TOO_LARGE' && entry.target === '#12');
    assert.ok(hold, mode);
    assert.ok(fx.entry(), mode);
    assert.deepEqual(fx.entry().diagnostics, hold.diagnostics);
    assert.equal(fx.entry().state, 'new');
    assert.equal(fx.github.calls.some(call => call.method === 'PATCH' && /issues\/12$/.test(call.path)), false);
    if (mode === 'topic') assert.equal(fx.github.calls.some(call => call.method === 'POST' && /issues\/12\/comments$/.test(call.path)), false);
  }
});

test('closure matrix: partial, incomplete, newer-version and failed readback passes retain the finding; a full verified pass resolves', t => {
  for (const mode of ['partial', 'incomplete', 'newer', 'readback', 'broken-other', 'missing-other', 'discovery', 'success']) {
    const fx = fixture(t);
    if (mode === 'discovery') {
      fx.store.mutate('parent', 12, { writer, change: doc => { doc.outcomes[0].class = 'COMPLETED'; return doc; } });
      fx.github.issues.get(13).state = 'closed';
    }
    fx.github.issues.get(12).body += LARGE;
    fx.reconciler.run({ apply: true });
    assert.ok(fx.entry(), mode);
    const id = fx.entry().id;
    fx.github.issues.get(12).body = '## CURRENT\n';
    let options = {};
    if (mode === 'partial') options.issue = 13;
    if (mode === 'incomplete') options.inventory = { complete: false, findings: [], issues: [], reason: 'deadline' };
    if (mode === 'newer') fx.github.issues.get(12).body += state.renderBlock('new', '9.9.9');
    if (mode === 'broken-other') fx.github.issues.get(13).body = '<!-- AI-AGENT-TOOLKIT:programme-state:BEGIN STATE v2 toolkit=3.9.0 sha256=000000000000 -->';
    // The parent's list no longer shows the child as a usable issue, and its own read fails.
    if (mode === 'missing-other') fx.github.intercept(call => {
      if (call.method !== 'GET') return undefined;
      if (call.path === 'repos/acme/app/issues/13') return { status: 404, json: {} };
      if (!call.path.startsWith('repos/acme/app/issues/12/sub_issues')) return undefined;
      const listed = fx.github.route(call.method, call.path, call.body);
      return { status: listed.status, json: listed.json.map(row => row.number === 13 ? { number: row.number, id: row.id } : row) };
    });
    if (mode === 'discovery') fx.github.issuePrLinks.set(13, { timelineTruncated: true });
    if (mode === 'readback') fx.github.intercept(call => call.method === 'PATCH' && /issues\/12$/.test(call.path) ? { status: 500, json: {} } : undefined);
    const report = fx.reconciler.run({ apply: true, ...options });
    assert.equal(fx.entry().state, mode === 'success' ? 'resolved' : 'new', mode);
    assert.equal(report.attention, state.attentionLine(fx.parent().attention, fx.reconciler.now()), 'the report follows the applied state');
    assert.equal(fx.entry().id, id);
    if (mode === 'success') {
      assert.ok(fx.github.calls.some(call => call.method === 'PATCH' && /issues\/12$/.test(call.path)));
      assert.ok(fx.github.issues.get(12).body.includes(`**${state.attentionLine(fx.parent().attention)}**`), 'CURRENT agrees with the resolved state in the same pass');
    }
  }
});

test('holder answers and concurrent unrelated findings survive the redraw fold', t => {
  const fx = fixture(t);
  fx.github.issues.get(12).body += LARGE;
  fx.reconciler.run({ apply: true });
  const id = fx.entry().id;
  for (const command of ['ack', 'dispose']) {
    const args = [command, '--finding', id, '--session', 'executor', '--controller', ...(command === 'dispose' ? ['--reason', 'approved deferral'] : [])];
    assert.throws(() => fx.run(args), error => error.code === 'ROLE_REFUSED' || error.code === 'STALE_WRITER');
  }
  fx.run(['ack', '--finding', id, '--session', writer.session, '--controller']);
  const plan = fx.reconciler.plan();
  fx.store.mutate('parent', 12, { writer, change: doc => {
    doc.attention = state.foldAttention(doc.attention, { source: 'inventory', seen: [{ code: 'NEEDS_PLACEMENT', issue: 99 }], complete: false, now: new Date(fx.github.clock).toISOString() });
    doc.attention = state.foldAttention(doc.attention, { source: 'reconcile', seen: [{ code: 'ISSUE_MISSING', issue: 98 },
      { code: 'BODY_TOO_LARGE', issue: 97, diagnostics: fx.entry().diagnostics }], complete: false, now: new Date(fx.github.clock).toISOString() });
    return doc;
  } });
  fx.reconciler.apply(plan);
  assert.equal(fx.entry().state, 'acknowledged');
  assert.equal(fx.parent().attention.find(item => item.issue === 99).state, 'new');
  assert.equal(fx.parent().attention.find(item => item.issue === 98).state, 'new');
  assert.equal(fx.parent().attention.find(item => item.issue === 97).state, 'new');
  fx.run(['dispose', '--finding', id, '--reason', 'approved deferral', '--session', writer.session, '--controller']);
  fx.reconciler.run({ apply: true });
  assert.equal(fx.entry().state, 'disposed');
  assert.equal(fx.parent().private.attention_notes[id], 'approved deferral');
});

test('numeric spans count managed markers, headings, CRLF and surrogate pairs once, with an exact remainder', () => {
  const blocks = ['CURRENT', 'STATE', 'TRACE', 'NAV'].map(kind => state.renderBlock('Generated\r\ntext', '3.9.0', kind));
  const prose = Array.from({ length: 7 }, (_, i) => `## Private heading ${i}\r\n${'\u{1f600}'.repeat(20 + i)}\r\n`);
  const body = blocks.map((block, i) => block + '\r\n' + prose[i]).join('') + prose.slice(4).join('');
  const d = state.bodySizeDiagnostics(body, body.length);
  assert.equal(d.projected_total, body.length);
  assert.equal(d.required_reduction, 1, 'the size check is strictly below the threshold');
  assert.ok(Buffer.byteLength(body) > d.projected_total, 'UTF-8 bytes would be the wrong units');
  assert.equal(d.largest_sections.length, 5);
  assert.ok(d.remainder > 0);
  for (let i = 0; i < 4; i += 1) assert.equal(d.largest_sections.find(part => part.kind === ['CURRENT', 'STATE', 'TRACE', 'NAV'][i]).size, blocks[i].length);
  assert.equal(d.remainder + d.largest_sections.reduce((sum, part) => sum + part.size, 0), body.length);
  assert.equal(state.bodySizeDiagnostics(body, body.length + 1).required_reduction, 0);
  assert.doesNotMatch(JSON.stringify(d), /Private|Generated/);
});

test('diagnostic readers reject content, unbounded values and invalid accounting', t => {
  const fx = fixture(t);
  fx.github.issues.get(12).body += LARGE;
  fx.reconciler.run({ apply: true });
  assert.ok(fx.entry());
  const good = fx.entry();
  const Ajv = require('ajv/dist/2020');
  const validate = new Ajv({ strict: false }).compile(JSON.parse(fs.readFileSync(path.join(__dirname, '../contracts/programme-state/parent-state-v1.schema.json'), 'utf8')));
  for (const [change, schemaRejects] of [
    [d => { d.content = 'Private prose'; }, true],
    [d => { d.projected_total = Number.MAX_SAFE_INTEGER + 1; }, true],
    [d => { d.largest_sections[0].kind = 'Private heading'; }, true],
    [d => { d.largest_sections.push(...d.largest_sections); }, true],
    [d => { d.remainder += 1; }, false],
    [d => { d.required_reduction -= 1; }, false],
  ]) {
    const entry = structuredClone(good);
    change(entry.diagnostics);
    const doc = { ...fx.parent(), attention: [entry] };
    assert.ok(state.validateParent(doc).length, JSON.stringify(entry));
    if (schemaRejects) assert.equal(validate(doc), false);
  }
});

test('an already-current page after a partial pass needs a complete readback before resolution', t => {
  const fx = fixture(t);
  fx.github.issues.get(12).body += LARGE;
  fx.reconciler.run({ apply: true });
  assert.ok(fx.entry());
  fx.github.issues.get(12).body = '## CURRENT\n';
  fx.reconciler.run({ apply: true, issue: 13 });
  assert.equal(fx.entry().state, 'new');
  fx.reconciler.run({ apply: true });
  assert.equal(fx.entry().state, 'resolved');
});
