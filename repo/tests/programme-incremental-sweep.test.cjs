'use strict';

// The queued sweep (plan closure rows 1 to 9, 15 and 17, and delta rows R8 and R18): what a pass
// reads, in which order, what it leaves queued, its request budget and the board's freshness line.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ROOT = process.env.A2A_SOURCE_ROOT || path.resolve(__dirname, '../..');
const state = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme-state.cjs'));
const cli = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme.cjs'));
const { SweepRequests } = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme-sweep.cjs'));
const { FakeGitHub } = require('./toolkit-programme-fake-github.cjs');

const NOW = '2026-11-12T01:00:00.000Z';
const HOUR = 60 * 60 * 1000;
const controller = { session: 'fixture-controller', prefix: 'TEST-' };

// `count` tasks natively under #421, their pages drawn once by a full pass, `prs` merged PRs
// linked from the tasks' timelines and a parent discussion of `discussion` comments.
function fixture(t, { count = 6, prs = 0, discussion = 0, cached = true } = {}) {
  const github = new FakeGitHub({ repository: 'example.test/app', store: 'example.test/store' });
  github.commentsMoveIssue = true;
  const binding = { schema: state.SCHEMA.binding, repository: github.repository, parent_issue: 421, record_prefix: 'TEST-', writer_prefix: 'TEST-',
    store: { kind: 'github', repository: github.storeRepository, branch: 'main', path: 'state/' }, required_checks: [] };
  github.addIssue(421, { body: '# Programme\n' });
  const outcomes = Array.from({ length: count }, (_, i) => ({ issue: 500 + i, class: 'COMMITTED', parent: 421, order: i + 1 }));
  for (const outcome of outcomes) github.addIssue(outcome.issue, { parent: 421 });
  for (let i = 0; i < prs; i += 1) {
    const task = outcomes[i % count].issue;
    github.addPr(2000 + i, { head: 'a'.repeat(40), merged: true, body: `Refs #${task}` });
    const links = github.issuePrLinks.get(task) || { timeline: [] }; links.timeline.push(2000 + i); github.issuePrLinks.set(task, links);
  }
  for (let i = 0; i < discussion; i += 1) github.addComment(421, { body: `Discussion ${i}` });
  let clock = Date.parse(NOW);
  const now = () => new Date(clock).toISOString();
  const store = new state.StateStore({ transport: github, store: binding.store, now, toolkitVersion: '3.66.0' });
  store.write('parent', 421, state.claimDocument(state.newParent({ repository: github.repository, parentIssue: 421, outcomes }), controller), { sha: null, previous: null });
  // The pages as a full pass leaves them, before the sweep has a queue.
  const full = new state.Reconciler({ store, binding, writer: state.refreshWriter(store.read('parent', 421).doc), refreshFacts: true, toolkitVersion: '3.66.0', now,
    reader: new state.ProgrammeGraphReader({ transport: github, repository: github.repository }), mutator: new state.GitHubMutator({ transport: github, repository: github.repository }) });
  // A long discussion moves its comments into archive parts first, which settles over two passes.
  let holds;
  for (let pass = 0; pass < 3 && holds?.length !== 0; pass += 1) holds = full.run({ apply: true }).holds;
  assert.deepEqual(holds, []);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'programme-sweep-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // One hourly sweep: an hour passes on GitHub and on the computer first.
  const run = (extra = {}) => {
    clock += HOUR; github.clock += HOUR;
    const start = github.calls.length;
    let output = '';
    const code = cli.main(['refresh', '--json'], { transport: github, binding, originUrl: 'https://github.com/example.test/app.git', repoRoot: '.', toolkitVersion: '3.66.0',
      now, passClock: () => clock, lockFile: cached ? path.join(dir, 'pass.lock') : null, environment: {}, stdout: { write: text => { output += text; } }, ...extra });
    const report = JSON.parse(output.slice(output.lastIndexOf('\n{') + 1));
    return { code, report, requests: github.calls.length - start, calls: github.calls.slice(start) };
  };
  const parent = () => store.read('parent', 421).doc;
  const page = number => github.issues.get(number).body;
  return { github, store, binding, run, parent, page, outcomes, tick: () => github.tick() };
}

test('request cap / I4: reading stops at the reserve, saving stops at the cap', () => {
  const calls = [];
  const budget = new SweepRequests({ transport: { request: (...args) => { calls.push(args); return { status: 200, json: {} }; } }, cap: 6, reserve: 3 });
  for (let i = 0; i < 3; i += 1) budget.request('GET', 'read');
  assert.throws(() => budget.request('GET', 'read'), error => error.code === 'PASS_STOPPED' && error.reason === 'request cap');
  budget.reading = false;
  budget.request('POST', 'save'); budget.request('POST', 'save'); budget.request('POST', 'save');
  assert.throws(() => budget.request('POST', 'save'), { code: 'PASS_STOPPED' });
  assert.equal(calls.length, 6, 'never more than the cap');
});

test('requests are serial: a request inside a request is refused', () => {
  let budget;
  budget = new SweepRequests({ transport: { request: () => budget.request('GET', 'nested') } });
  assert.throws(() => budget.request('GET', 'outer'), { code: 'SERIAL_REQUEST_REQUIRED' });
});

for (const [label, headers] of [['remaining low', { 'x-ratelimit-remaining': '199' }], ['retry-after', { 'retry-after': '2' }]]) test(`rate-limit ${label} / I4`, () => {
  const waits = []; let now = 0;
  const response = Object.defineProperty({ status: 200, json: {} }, 'headers', { value: headers, enumerable: false });
  const budget = new SweepRequests({ transport: { request: () => response }, nowMs: () => now, wait: ms => { waits.push(ms); now += ms; } });
  budget.request('GET', 'one');
  assert.throws(() => budget.request('GET', 'two'), error => error.code === 'PASS_STOPPED' && error.reason === 'GitHub rate limit');
  if (headers['retry-after']) { budget.reading = false; budget.request('POST', 'save'); assert.deepEqual(waits, [2000]); }
});

test('the rate-limit headers ride along without changing the parsed answer', () => {
  const result = state.GitHubTransport.parse('HTTP/2.0 200 OK\r\nX-RateLimit-Remaining: 199\r\nRetry-After: 2\r\nDate: Thu, 12 Nov 2026 01:00:00 GMT\r\n\r\n{}');
  assert.deepEqual(result, { status: 200, json: {} });
  assert.equal(result.headers['x-ratelimit-remaining'], '199');
  assert.equal(result.headers['retry-after'], '2');
  assert.equal(result.headers.date, 'Thu, 12 Nov 2026 01:00:00 GMT');
});

test('GraphQL batches never exceed twenty aliases; a refusal reads the same facts over REST', () => {
  const sizes = [];
  const reader = new state.ProgrammeGraphReader({ repository: 'example.test/app', transport: { request(method, endpoint, body) {
    const numbers = [...body.query.matchAll(/p(\d+): pullRequest/g)].map(match => Number(match[1])); sizes.push(numbers.length);
    return { status: 200, json: { data: { repository: { defaultBranchRef: { name: 'main' }, ...Object.fromEntries(numbers.map(number => [`p${number}`, { number, title: 'Example', state: 'OPEN', headRefOid: 'a'.repeat(40) }])) } } } };
  } } });
  assert.equal(reader.pullRequests(Array.from({ length: 45 }, (_, i) => i + 1)).size, 45);
  assert.deepEqual(sizes, [20, 20, 5]);
  const rest = new state.ProgrammeGraphReader({ repository: 'example.test/app', transport: { request(method, endpoint) {
    if (endpoint === 'graphql') return { status: 403, json: {} };
    if (endpoint.includes('check-runs')) return { status: 200, json: { total_count: 0, check_runs: [] } };
    if (endpoint.endsWith('/status')) return { status: 200, json: { total_count: 0, statuses: [] } };
    return { status: 200, json: { number: 42, title: 'Example task', state: 'open', head: { sha: 'a'.repeat(40) }, base: { ref: 'main', repo: { default_branch: 'main' } } } };
  } } });
  const facts = rest.pullRequests([42]).get(42);
  assert.deepEqual([facts.state, facts.head, facts.title], ['OPEN', 'a'.repeat(40), 'Example task']);
});

test('legacy-state / I7: a parent without a queue reads every task once, then saves an empty queue', t => {
  const f = fixture(t);
  assert.equal(f.parent().sweep, undefined);
  assert.deepEqual(state.validateParent(f.parent()), []);
  const first = f.run();
  assert.equal(first.code, 0, JSON.stringify(first.report.holds));
  assert.equal(first.report.sweep.read, 6);
  assert.deepEqual(f.parent().sweep, { queue: [], failures: {} });
  assert.deepEqual(state.validateParent(f.parent()), []);
});

test('complete-pass / I1 I5: a warm pass empties the queue and says when the board was updated', t => {
  const f = fixture(t);
  f.run();
  const warm = f.run();
  assert.equal(warm.code, 0);
  assert.deepEqual(f.parent().sweep.queue, []);
  assert.match(f.page(421), new RegExp(`^Board updated: \\d+ \\w+ 2026, \\d\\d:\\d\\d SGT \\(state revision ${f.parent().revision}\\)$`, 'm'));
  assert.ok(warm.report.sweep.read < 6, 'only the rotation share and changed tasks are read');
});

test('cold-resume / I1: a capped pass saves what it read and its queue; the next pass continues', t => {
  const f = fixture(t, { count: 30 });
  f.run();
  // Thirty tasks changed on GitHub at once (each with a comment to read), and a pass that can
  // afford only some of them.
  for (const outcome of f.outcomes) {
    f.github.addComment(outcome.issue, { body: `Note on ${outcome.issue}` });
    Object.assign(f.github.issues.get(outcome.issue), { title: `Renamed ${outcome.issue}`, updated_at: f.tick() });
  }
  const capped = f.run({ requestCap: 100 });
  // It may also run out of budget while drawing task pages; those pages follow next pass.
  assert.ok(capped.code === 0 || capped.report.holds.every(hold => hold.code === 'PASS_STOPPED'), JSON.stringify(capped.report.holds));
  const left = f.parent().sweep.queue;
  assert.ok(left.length > 0 && capped.report.sweep.read > 0, JSON.stringify(capped.report.sweep));
  assert.ok(capped.requests <= 100, `never more than the cap: ${capped.requests}`);
  assert.match(f.page(421), new RegExp(`^⚠️ Board out of date since .*SGT: 1 pass stopped early \\((tasks still to check|request cap)\\)\\. ${left.length} tasks still to check\\.$`, 'm'));
  const read = new Set(capped.report.sweep.tasks);
  assert.ok(left.every(number => !read.has(number)), 'the tasks it read are not queued again');
  let passes = 1;
  while (f.parent().sweep.queue.length && passes < 6) { f.run({ requestCap: 100 }); passes += 1; }
  assert.deepEqual(f.parent().sweep.queue, []);
  // Pages a capped pass could not draw follow on the next full pass.
  assert.equal(f.run().code, 0);
  assert.deepEqual(f.outcomes.filter(outcome => !f.page(421).includes(`Renamed ${outcome.issue}`)).map(outcome => outcome.issue), []);
  assert.match(f.page(421), /^Board updated: /m);
});

test('change-priority / I2: a task GitHub changed is read first, newest change first', t => {
  const f = fixture(t, { count: 12 });
  f.run();
  f.github.issues.get(507).updated_at = f.tick();
  f.github.issues.get(503).updated_at = f.tick();
  const result = f.run();
  assert.deepEqual(result.report.sweep.tasks.slice(0, 2), [503, 507]);
  assert.equal(result.report.sweep.why.changed, 2);
});

test('stuck-task / I1 I2: a task that cannot be read goes to the back; three in a row raise a finding', t => {
  const f = fixture(t, { count: 4 });
  f.github.addComment(501, { body: 'A note' });
  f.run();
  f.github.intercept(call => (call.method === 'GET' && /\/issues\/501\/comments/.test(call.path) ? { status: 500, json: {} } : undefined));
  for (let pass = 1; pass <= 3; pass += 1) {
    f.github.issues.get(501).updated_at = f.tick();
    f.github.issues.get(502).updated_at = f.tick();
    const result = f.run();
    assert.ok(result.report.sweep.tasks.includes(502), 'the others still progress');
    assert.equal(f.parent().sweep.failures['501'], pass);
    assert.equal(f.parent().sweep.queue.at(-1), 501);
  }
  assert.equal(f.parent().attention.find(entry => entry.code === 'SWEEP_TASK_UNREADABLE' && entry.issue === 501)?.state, 'new');
  f.github.hooks = [];
  f.run();
  assert.equal(f.parent().sweep.failures['501'], undefined, 'a successful read clears the count');
});

test('page queue: a changed blob id redraws the task and PR pages', t => {
  const f = fixture(t, { count: 4 });
  f.github.addPr(900, { head: 'b'.repeat(40), body: 'Refs #502' });
  f.run();
  // The controller writes the task's state; nothing changes on GitHub.
  const parent = f.parent();
  f.store.mutate('child', 502, { writer: controller, parentDoc: parent, change: doc => { doc.next_action = 'Controller: next step'; doc.pr = { ...doc.pr, number: 900, state: 'OPEN', head: 'b'.repeat(40) }; return doc; } });
  const result = f.run();
  const revision = f.store.read('child', 502).doc.revision;
  assert.equal(result.report.sweep.why.drifted >= 1, true);
  assert.ok(result.report.sweep.tasks.includes(502));
  assert.match(f.page(502), new RegExp(`State revision ${revision} \\(issue-502\\.json\\)`));
  assert.match(f.github.prs.get(900).body, /#502/, 'the PR page carries the task link');
});

test('stop phases: every sweep stop validates', t => {
  const Ajv = require('ajv/dist/2020');
  const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'repo/contracts/programme-state/parent-state-v1.schema.json'), 'utf8'));
  const validate = new Ajv({ strict: false }).compile(schema);
  const seen = new Set();
  for (const cap of [40, 60, 80, 120, 200]) {
    const f = fixture(t, { count: 8 });
    for (const outcome of f.outcomes) f.github.issues.get(outcome.issue).body = '';
    f.run({ requestCap: cap });
    f.run({ requestCap: 1000 });
    const parent = f.parent();
    assert.deepEqual(state.validateParent(parent), [], `cap ${cap}`);
    assert.equal(validate(parent), true, JSON.stringify(validate.errors));
    const stop = (parent.attention || []).find(entry => entry.code === 'PASS_STOPPED');
    if (stop) { assert.ok(state.PASS_PHASES.includes(stop.diagnostics.phase)); seen.add(stop.diagnostics.phase); }
  }
  assert.ok(seen.size >= 1, 'at least one capped pass stopped');
});

test('103 tasks and 645 PRs: request counts per pass, cold and warm, laptop and cloud', t => {
  const counts = {};
  for (const mode of ['laptop', 'cloud']) {
    const f = fixture(t, { count: 103, prs: 645, discussion: 874, cached: mode === 'laptop' });
    const before = f.page(421).length;
    const cold = []; let pass = 0;
    do { cold.push(f.run().requests); pass += 1; } while (f.parent().sweep.queue.length && pass < 5);
    const warm = [f.run().requests, f.run().requests];
    counts[mode] = { cold, warm };
    assert.ok(cold.every(count => count <= 300), `${mode} cold within the cap: ${cold}`);
    assert.ok(f.page(421).length < state.SAFE_LIMIT, 'the parent stays under its size threshold');
    assert.ok(f.page(421).length - before < 4096, 'the freshness line adds little');
  }
  t.diagnostic(JSON.stringify(counts));
  assert.ok(counts.laptop.warm.every(count => count < 80), `laptop warm: ${counts.laptop.warm}`);
  assert.ok(counts.cloud.warm.every(count => count < 120), `cloud warm: ${counts.cloud.warm}`);
});
