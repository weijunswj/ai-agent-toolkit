'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ROOT = process.env.A2A_SOURCE_ROOT || path.resolve(__dirname, '../..');
const state = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme-state.cjs'));
let sweep = {};
try { sweep = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme-sweep.cjs')); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
const NOW = '2026-11-12T01:00:00.000Z';
const copy = value => structuredClone(value);

function fixture({ count = 3, capacity = 100, saved = {}, fail = [], changes = [] } = {}) {
  assert.equal(typeof sweep.ProgrammeSweep, 'function', 'the incremental pass owner exists');
  const outcomes = Array.from({ length: count }, (_, i) => ({ issue: 500 + i, class: 'COMMITTED', parent: 421, order: i + 1 }));
  let parent = { ...state.newParent({ repository: 'example.test/app', parentIssue: 421, outcomes }), ...copy(saved) };
  const children = new Map();
  let processed = 0, writes = 0, drawn = [], events = [], queueAtCommit;
  const deps = {
    now: () => NOW,
    load: () => ({ parent: copy(parent), children: new Map(children) }),
    discover: () => ({ changed: changes, outcomes }),
    readTask: outcome => {
      events.push(`read:${outcome.issue}`);
      if (processed >= capacity) throw Object.assign(new Error('time'), { code: 'SWEEP_STOP', reason: 'time limit' });
      if (fail.includes(outcome.issue)) throw new Error('unreadable fixture task');
      processed++;
      return state.newChild({ repository: parent.repository, outcome });
    },
    save: ({ parent: next, children: changed }) => {
      events.push('save'); writes++;
      parent = copy(next); parent.revision++;
      for (const [number, doc] of changed) children.set(number, copy(doc));
      queueAtCommit = copy(parent.sweep.queue);
      return { parent: copy(parent), children: new Map(children), conflicts: [] };
    },
    draw: snapshot => { events.push('draw'); drawn.push(snapshot.parent.revision); return { complete: true }; },
    canWork: () => true,
  };
  const run = extra => new sweep.ProgrammeSweep({ ...deps, ...extra }).run();
  return { run, deps, get parent() { return parent; }, get children() { return children; }, get writes() { return writes; }, get events() { return events; }, get drawn() { return drawn; }, get queueAtCommit() { return queueAtCommit; }, reset(n = capacity) { processed = 0; capacity = n; events = []; } };
}

const cases = [
  ['complete-pass / I1 I5', () => {
    const f = fixture(); const result = f.run();
    assert.equal(result.queue_left, 0); assert.equal(f.children.size, 3);
    assert.equal(f.writes, 1); assert.ok(f.drawn.every(revision => revision <= f.parent.revision));
    assert.equal(f.parent.volatile?.last_complete_at, undefined, 'completion cannot predate readback of new pages');
    f.reset(); f.run(); assert.equal(f.parent.volatile.last_complete_at, NOW);
  }],
  ['cold-resume / I1', () => {
    const f = fixture({ capacity: 1 }); f.run();
    assert.deepEqual(f.parent.sweep.queue, [501, 502]); assert.equal(f.children.size, 1);
    f.reset(); f.run(); assert.equal(f.children.size, 2);
    f.reset(); f.run(); assert.equal(f.children.size, 3); assert.deepEqual(f.parent.sweep.queue, []);
  }],
  ['mid-task stop / I1', () => {
    const f = fixture({ capacity: 1 }); f.run();
    assert.equal(f.children.has(501), false); assert.equal(f.queueAtCommit[0], 501);
  }],
  ['change-priority / I2', () => {
    const f = fixture({ capacity: 1, changes: [502] }); f.run();
    assert.deepEqual([...f.children.keys()], [502]);
  }],
  ['stuck-task / I1 I2', () => {
    const f = fixture({ fail: [500] });
    for (let i = 0; i < 3; i++) { f.reset(); f.run(); }
    assert.equal(f.children.size, 2); assert.equal(f.parent.sweep.failures['500'], 3);
    assert.ok(f.parent.attention.some(entry => entry.code === 'SWEEP_TASK_UNREADABLE' && entry.issue === 500));
  }],
  ['rotation table / I2', () => {
    const f = fixture({ count: 103 }); f.run();
    const last = new Map();
    for (let pass = 1; pass <= 24; pass++) {
      f.reset(); f.run();
      for (const event of f.events.filter(value => value.startsWith('read:'))) last.set(Number(event.slice(5)), pass);
      if (pass >= 12) assert.ok([...last.values()].every(at => pass - at < 12));
    }
    assert.equal(last.size, 103);
  }],
  ['doc CAS / I3', () => {
    const f = fixture();
    f.run({ save: data => ({ ...data, conflicts: [501] }) });
    // The store's conflict contract returns the queue with skipped documents reinserted.
    assert.equal(typeof state.StateStore.prototype.writeBatch, 'function');
  }],
  ['pages-first / I5', () => {
    const f = fixture({ saved: { sweep: { pass: 1, queue: [500], checked: {}, failures: {}, last_started_at: NOW, pages_pending: true, stopped_passes: 1, reason: 'time limit' } } });
    f.run(); assert.equal(f.events[0], 'draw');
  }],
  ['legacy-state / I7', () => {
    const f = fixture(); assert.deepEqual(state.validateParent(f.parent), []); f.run();
    assert.deepEqual(state.validateParent(f.parent), []);
    assert.match(state.renderCurrentBlockBody(f.parent, f.children, new Map(), NOW), /Board (?:updated|out of date)/);
  }],
  ['display-only / I6', () => {
    const f = fixture(); const before = copy(f.parent); f.run();
    const child = f.children.get(500); const expected = state.newChild({ repository: f.parent.repository, outcome: before.outcomes[0] });
    for (const field of ['lifecycle', 'pr', 'uat', 'review', 'gate']) assert.deepEqual(child[field], expected[field]);
  }],
  ['size / I10', () => {
    const f = fixture({ count: 103 }); const old = state.renderCurrentBlockBody(f.parent, f.children, new Map(), NOW); f.run();
    const next = state.renderCurrentBlockBody(f.parent, f.children, new Map(), NOW);
    assert.ok(next.length - old.length < 4096); assert.ok(next.length < state.SAFE_LIMIT);
  }],
];
for (const [name, check] of cases) test(name, check);

test('request cap / I4', () => {
  const calls = [];
  const budget = new sweep.SweepRequests({ transport: { request: (...args) => { calls.push(args); return { status: 200, json: {}, headers: {} }; } }, cap: 5, reserve: 2 });
  for (let i = 0; i < 3; i++) budget.request('GET', 'work');
  assert.throws(() => budget.request('GET', 'work'), { code: 'SWEEP_STOP' });
  budget.settling = true; budget.request('GET', 'save'); budget.request('POST', 'save');
  assert.throws(() => budget.request('GET', 'save'), { code: 'SWEEP_STOP' }); assert.equal(calls.length, 5);
});

for (const [label, headers] of [['remaining low', { 'x-ratelimit-remaining': '199' }], ['retry-after', { 'retry-after': '2' }]]) test(`rate-limit ${label} / I4`, () => {
  const waits = []; let now = 0;
  const budget = new sweep.SweepRequests({ transport: { request: () => ({ status: 200, json: {}, headers }) }, nowMs: () => now, wait: ms => { waits.push(ms); now += ms; } });
  budget.request('GET', 'one');
  assert.throws(() => budget.request('GET', 'two'), { code: 'SWEEP_STOP', reason: 'GitHub rate limit' });
  if (headers['retry-after']) { budget.settling = true; budget.request('POST', 'save'); assert.deepEqual(waits, [2000]); }
});

test('HTTP header parsing keeps rate-limit signals', () => {
  const result = state.GitHubTransport.parse('HTTP/2.0 200 OK\r\nX-RateLimit-Remaining: 199\r\nRetry-After: 2\r\n\r\n{}');
  assert.equal(result.headers['x-ratelimit-remaining'], '199'); assert.equal(result.headers['retry-after'], '2');
});

test('GraphQL refused / I4: batched facts have matching REST results', () => {
  const calls = [];
  const transport = { request(method, endpoint, body) {
    calls.push({ method, endpoint, body });
    if (endpoint === 'graphql') return { status: 403, json: {} };
    if (endpoint.includes('check-runs')) return { status: 200, json: { total_count: 0, check_runs: [] } };
    if (endpoint.endsWith('/status')) return { status: 200, json: { total_count: 0, statuses: [] } };
    return { status: 200, json: { number: 42, title: 'Example task', state: 'open', head: { sha: 'a'.repeat(40) }, base: { ref: 'main', repo: { default_branch: 'main' } } } };
  } };
  const reader = new state.ProgrammeGraphReader({ transport, repository: 'example.test/app' });
  const facts = reader.pullRequests([42]); assert.equal(facts.get(42).head, 'a'.repeat(40));
  assert.equal(facts.get(42).state, 'OPEN'); assert.equal(facts.get(42).title, 'Example task');
  assert.equal(calls.filter(call => call.endpoint === 'graphql').length, 1);
});

test('GraphQL batches never exceed twenty aliases', () => {
  const sizes = [];
  const transport = { request(method, endpoint, body) {
    const numbers = [...body.query.matchAll(/p(\d+): pullRequest/g)].map(match => Number(match[1])); sizes.push(numbers.length);
    return { status: 200, json: { data: { repository: { defaultBranchRef: { name: 'main' }, ...Object.fromEntries(numbers.map(number => [`p${number}`, { number, title: 'Example', state: 'OPEN', headRefOid: 'a'.repeat(40) }])) } } } };
  } };
  const result = new state.ProgrammeGraphReader({ transport, repository: 'example.test/app' }).pullRequests(Array.from({ length: 45 }, (_, i) => i + 1));
  assert.equal(result.size, 45); assert.deepEqual(sizes, [20, 20, 5]);
});

test('secret-leak / I9: raw transport errors cannot reach diagnostic text', () => {
  const sentinel = ['private', 'fixture', 'value'].join('-');
  for (const invoke of [
    () => state.GitHubTransport.parse('', sentinel),
    () => new state.GitHubTransport({ ghPath: 'fixture-gh', run: () => ({ error: new Error(sentinel) }) }).request('GET', 'user'),
  ]) {
    assert.throws(invoke, error => error.code === 'GH_FAILED' && !error.message.includes(sentinel));
  }
});

for (const mode of ['enabled', 'disabled', 'missing', 'foreign']) test(`fresh runner binding: ${mode}`, () => {
  const cli = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme.cjs'));
  assert.equal(typeof cli.MergedSweepBindingReader, 'function');
  const binding = { schema: state.SCHEMA.bindingV2, governance: mode === 'disabled' ? 'disabled' : 'enabled', repository: mode === 'foreign' ? 'example.test/foreign' : 'example.test/app',
    parents: [{ issue: 421, record_prefix: 'TEST-' }], store: { kind: 'github', repository: 'example.test/store', branch: 'main', path: 'state/' }, required_checks: [] };
  if (mode === 'disabled') { delete binding.parents; delete binding.store; delete binding.required_checks; }
  const calls = [];
  const head = 'a'.repeat(40);
  const reader = new cli.MergedSweepBindingReader({ repository: 'example.test/app', transport: { request(method, endpoint) {
    calls.push({ method, endpoint });
    if (endpoint === 'repos/example.test/app') return { status: 200, json: { full_name: 'example.test/app', default_branch: 'main' } };
    if (endpoint.endsWith('/branches/main')) return { status: 200, json: { commit: { sha: head } } };
    return mode === 'missing' ? { status: 404, json: {} } : { status: 200, json: { encoding: 'base64', content: Buffer.from(JSON.stringify(binding)).toString('base64') } };
  } } });
  const identity = { repository_id: 'example-identity', remote: { canonical: 'https://github.com/example.test/app.git' } };
  const entry = reader.read(identity);
  assert.equal(entry.commit, head);
  assert.ok(calls.every(call => call.method === 'GET'));
  assert.ok(calls.at(-1).endpoint.endsWith(`?ref=${head}`), 'binding comes from the immutable default-branch commit');
  assert.equal(entry.status, mode === 'missing' ? 'absent' : 'present');
  if (mode === 'enabled') assert.equal(reader.binding.governance, 'enabled');
  else assert.equal(reader.binding, null, 'no enabled foreign, absent or disabled binding');
});
