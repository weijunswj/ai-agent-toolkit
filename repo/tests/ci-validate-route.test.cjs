'use strict';

// The Validate route: a pull request title or body edit reuses an earlier run's test and hook-pack
// results only when that run tested exactly the same code, and every doubt runs in full.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const route = require('../scripts/ci-validate-route.cjs');
const shards = require('../scripts/ci-test-shards.cjs');

const MANIFEST = shards.loadManifest();
const HEAD = '1111111111111111111111111111111111111111';
const TESTED = '2222222222222222222222222222222222222222';
const OTHER = '3333333333333333333333333333333333333333';
const REPO = 'example/toolkit';
const clone = (value) => JSON.parse(JSON.stringify(value));

function sink() {
  const chunks = [];
  return { write: (chunk) => { chunks.push(String(chunk)); return true; }, text: () => chunks.join('') };
}

function editEvent(changes = { body: { from: 'old' } }) {
  return { action: 'edited', changes, pull_request: { head: { sha: HEAD, repo: { full_name: REPO } } } };
}

function env(extra = {}) {
  return { GITHUB_EVENT_NAME: 'pull_request', GITHUB_SHA: TESTED, GITHUB_REPOSITORY: REPO, GITHUB_RUN_ID: '900', GH_TOKEN: 'token', GITHUB_API_URL: 'https://api.example.test', ...extra };
}

// A completed full run at the head whose every test job passed and whose summaries name the commit.
function fullRun(id, { createdAt = '2026-11-13T10:00:00Z', tested = TESTED } = {}) {
  const jobs = Object.values(shards.testJobCheckNames(MANIFEST)).flat().map((name) => ({ name, status: 'completed', conclusion: 'success' }));
  jobs.push({ name: 'personal-data', status: 'completed', conclusion: 'failure' }, { name: 'validate', status: 'completed', conclusion: 'failure' });
  const artifacts = shards.SYSTEMS.flatMap((system) => shards.shardIds(MANIFEST, system))
    .map((shard) => ({ name: `test-summary-${shard}-attempt-1-${tested}`, expired: false }));
  return {
    run: { id, event: 'pull_request', path: route.WORKFLOW_PATH, status: 'completed', conclusion: 'failure', head_sha: HEAD, head_repository: { full_name: REPO }, created_at: createdAt },
    jobs,
    artifacts,
  };
}

// A fake GitHub answering for the given runs; `calls` records every route asked.
function github(runs, { fail = null } = {}) {
  const calls = [];
  const byId = new Map(runs.map((entry) => [String(entry.run.id), entry]));
  const fetchImpl = async (url, options) => {
    assert.equal(options.headers.authorization, 'Bearer token');
    const route = url.replace(`https://api.example.test/repos/${REPO}/`, '');
    calls.push(route);
    if (fail && fail.test(route)) return { ok: false, status: 502, json: async () => ({}) };
    const answer = (body) => ({ ok: true, status: 200, json: async () => clone(body) });
    let match = route.match(/^actions\/workflows\/validate\.yml\/runs\?event=pull_request&status=completed&head_sha=([0-9a-f]{40})&per_page=20$/);
    if (match) return answer({ workflow_runs: runs.map((entry) => entry.run).filter((run) => run.head_sha === match[1]) });
    match = route.match(/^actions\/runs\/(\d+)(\/jobs\?filter=latest&per_page=100|\/artifacts\?per_page=100)?$/);
    if (match && byId.has(match[1])) {
      const entry = byId.get(match[1]);
      if (!match[2]) return answer(entry.run);
      return answer(match[2].startsWith('/jobs') ? { jobs: entry.jobs } : { artifacts: entry.artifacts });
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { fetchImpl, calls };
}

test('only a pull request title or body edit with no base change can be light', () => {
  assert.equal(route.eventVerdict(env(), editEvent()).light, true);
  assert.equal(route.eventVerdict(env(), editEvent({ title: { from: 'x' } })).light, true);
  assert.equal(route.eventVerdict(env(), editEvent({})).light, true, 'an edit with no named change is still an edit');
  const full = [
    ['a push', env({ GITHUB_EVENT_NAME: 'push' }), editEvent(), /push event always runs in full/],
    ['an open', env(), { ...editEvent(), action: 'opened' }, /opened event always runs in full/],
    ['a new commit', env(), { ...editEvent(), action: 'synchronize' }, /synchronize event/],
    ['a reopen', env(), { ...editEvent(), action: 'reopened' }, /reopened event/],
    ['a base change', env(), editEvent({ base: { ref: { from: 'old' } } }), /base branch changed/],
    ['a base change beside a body edit', env(), editEvent({ body: { from: 'x' }, base: { sha: { from: OTHER } } }), /base branch changed/],
    ['an unreadable event', env(), null, /could not be read/],
    ['no head commit', env(), { ...editEvent(), pull_request: { head: { repo: { full_name: REPO } } } }, /does not name the head/],
    ['no head repository', env(), { ...editEvent(), pull_request: { head: { sha: HEAD } } }, /does not name the head/],
    ['no tested commit', env({ GITHUB_SHA: 'main' }), editEvent(), /does not name the head/],
  ];
  for (const [label, environment, event, reason] of full) {
    const verdict = route.eventVerdict(environment, event);
    assert.equal(verdict.light, false, label);
    assert.match(verdict.reason, reason, label);
  }
});

test('an edit reuses the newest earlier run that tested exactly this code', async () => {
  const older = fullRun(101, { createdAt: '2026-11-13T09:00:00Z' });
  const newer = fullRun(102, { createdAt: '2026-11-13T10:00:00Z' });
  const { fetchImpl, calls } = github([older, newer]);
  const decision = await route.route({ env: env(), fetchImpl, manifest: MANIFEST, event: editEvent() });
  assert.deepEqual([decision.mode, decision.runId], ['light', '102']);
  assert.ok(calls.includes('actions/runs/102/jobs?filter=latest&per_page=100'), 'only the newest attempt\'s jobs count');
  assert.ok(!calls.some((call) => call.startsWith('actions/runs/101')), 'the newest reusable run is taken first');
  // A run whose personal-data failed (a footer in the body) still has reusable test results.
  assert.equal(newer.run.conclusion, 'failure');
});

test('every way an earlier run differs from this code runs in full', async () => {
  const cases = [
    ['a failed shard', (r) => { r.jobs.find((job) => job.name === 'tests-windows (windows-2)').conclusion = 'failure'; }, /tests-windows \(windows-2\) finished as failure/],
    ['a cancelled Windows pack group', (r) => { r.jobs.find((job) => job.name === 'hook-pack-windows (fault+merge+task-governance)').conclusion = 'cancelled'; }, /hook-pack-windows \(fault\+merge\+task-governance\) finished as cancelled/],
    ['a skipped clock-ahead run (an earlier light run)', (r) => { r.jobs.find((job) => job.name === 'tests-clock-ahead').conclusion = 'skipped'; }, /tests-clock-ahead finished as skipped/],
    ['a job still running', (r) => { Object.assign(r.jobs.find((job) => job.name === 'hook-pack (ubuntu-latest)'), { status: 'in_progress', conclusion: null }); }, /hook-pack \(ubuntu-latest\) finished as in_progress/],
    ['a missing shard job', (r) => { r.jobs = r.jobs.filter((job) => job.name !== 'tests-linux (linux-1)'); }, /no tests-linux \(linux-1\) job/],
    ['a duplicate job name with one failure', (r) => { r.jobs.push({ name: 'tests-linux (linux-1)', status: 'completed', conclusion: 'failure' }); }, /tests-linux \(linux-1\) finished as failure/],
    ['summaries of another merge commit (main moved)', (r) => { r.artifacts = fullRun(1, { tested: OTHER }).artifacts; }, /kept no linux-1 summary for the tested commit 222222222222/],
    ['an expired summary', (r) => { r.artifacts[0].expired = true; }, /kept no linux-1 summary/],
    ['a missing summary', (r) => { r.artifacts = r.artifacts.filter((artifact) => !artifact.name.includes('windows-3')); }, /kept no windows-3 summary/],
    ['a summary named without the commit', (r) => { r.artifacts = r.artifacts.map((artifact) => ({ ...artifact, name: artifact.name.replace(`-${TESTED}`, '') })); }, /kept no linux-1 summary/],
    ['another workflow file', (r) => { r.run.path = '.github/workflows/other.yml'; }, /ran \.github\/workflows\/other\.yml/],
    ['a push run', (r) => { r.run.event = 'push'; }, /ran for a push event/],
    ['another head repository (a fork with the same commit)', (r) => { r.run.head_repository.full_name = 'someone/fork'; }, /another head repository/],
    ['another head commit', (r) => { r.run.head_sha = OTHER; }, /another head commit/],
  ];
  for (const [label, mutate, reason] of cases) {
    const entry = fullRun(201);
    mutate(entry);
    // The listing filters by head, so a changed head is only seen when the run is read directly.
    const listed = entry.run.head_sha === HEAD ? [entry] : [];
    const { fetchImpl } = github(listed);
    const decision = await route.route({ env: env(), fetchImpl, manifest: MANIFEST, event: editEvent() });
    if (listed.length) {
      assert.equal(decision.mode, 'full', label);
      assert.match(decision.reason, reason, label);
    }
    assert.match(route.reuseProblem({ ...entry, want: { head: HEAD, headRepository: REPO, tested: TESTED, currentRunId: '900' }, manifest: MANIFEST }).problem || '', reason, `${label} (direct)`);
  }
  const { fetchImpl } = github([]);
  const none = await route.route({ env: env(), fetchImpl, manifest: MANIFEST, event: editEvent() });
  assert.deepEqual([none.mode, none.reason], ['full', 'no earlier completed run at this head']);
});

test('this run never reuses itself, and the route looks at a bounded number of runs', async () => {
  const self = fullRun(900);
  const { fetchImpl: selfOnly } = github([self]);
  assert.equal((await route.route({ env: env(), fetchImpl: selfOnly, manifest: MANIFEST, event: editEvent() })).mode, 'full');
  assert.match(route.reuseProblem({ ...self, want: { head: HEAD, headRepository: REPO, tested: TESTED, currentRunId: '900' }, manifest: MANIFEST }).problem, /it is this run/);
  const bad = Array.from({ length: route.MAX_CANDIDATES + 2 }, (_, index) => {
    const entry = fullRun(300 + index, { createdAt: `2026-11-13T1${index}:00:00Z` });
    entry.jobs[0].conclusion = 'failure';
    return entry;
  });
  const { fetchImpl, calls } = github(bad);
  const decision = await route.route({ env: env(), fetchImpl, manifest: MANIFEST, event: editEvent() });
  assert.equal(decision.mode, 'full');
  assert.equal(calls.filter((call) => /^actions\/runs\/\d+$/.test(call)).length, route.MAX_CANDIDATES);
});

async function withFiles(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-route-'));
  try { return await fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function outputs(file) {
  return Object.fromEntries(fs.readFileSync(file, 'utf8').trim().split('\n').map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
}

test('the route job always exits 0 and chooses full on any error', async () => {
  await withFiles(async (dir) => {
    const eventFile = path.join(dir, 'event.json');
    fs.writeFileSync(eventFile, JSON.stringify(editEvent()));
    const cases = [
      ['GitHub fails', env(), github([fullRun(102)], { fail: /artifacts/ }).fetchImpl, /could not read earlier runs \(GitHub answered 502/],
      ['no token', env({ GH_TOKEN: '' }), github([fullRun(102)]).fetchImpl, /could not read earlier runs \(GITHUB_REPOSITORY and GH_TOKEN/],
      ['fetch throws', env(), async () => { throw new TypeError('fetch failed'); }, /could not read earlier runs \(fetch failed/],
      ['a push', env({ GITHUB_EVENT_NAME: 'push' }), github([]).fetchImpl, /push event always runs in full/],
    ];
    for (const [label, environment, fetchImpl, reason] of cases) {
      const output = path.join(dir, `${label.replace(/\W+/g, '-')}.txt`);
      const out = sink();
      const code = await route.main(['route'], { env: { ...environment, GITHUB_EVENT_PATH: eventFile, GITHUB_OUTPUT: output }, fetchImpl, out, err: sink() });
      assert.equal(code, 0, label);
      assert.deepEqual(outputs(output), { mode: 'full', run_id: '' }, label);
      assert.match(out.text(), reason, label);
    }
    const output = path.join(dir, 'light.txt');
    const lightOut = sink();
    const code = await route.main(['route'], { env: { ...env(), GITHUB_EVENT_PATH: eventFile, GITHUB_OUTPUT: output }, fetchImpl: github([fullRun(102)]).fetchImpl, out: lightOut, err: sink() });
    assert.equal(code, 0);
    assert.equal(lightOut.text(), 'Validate runs light: the test and hook-pack jobs are reused because run 102 already tested this exact code.\n');
    assert.deepEqual(outputs(output), { mode: 'light', run_id: '102' });
    assert.equal(await route.main(['other'], { env: env(), out: sink(), err: sink() }), 2);
    assert.equal(await route.main([], { env: env(), out: sink(), err: sink() }), 2);
  });
});

test('the gate job takes its own results on a full run and checks the chosen run again on a light run', async () => {
  const needs = { route: { result: 'failure', outputs: {} }, ...Object.fromEntries(shards.TEST_JOBS.map((job) => [job, { result: 'success', outputs: {} }])) };
  const full = await route.legs({ env: env({ ROUTE_MODE: '', NEEDS: JSON.stringify(needs) }), event: editEvent(), manifest: MANIFEST });
  assert.deepEqual(Object.keys(full.legs), shards.TEST_JOBS, 'the route job\'s own result is left out');
  assert.deepEqual([full.runId, full.reused], ['900', false]);
  const skipped = { ...needs, 'tests-linux': { result: 'skipped', outputs: {} } };
  assert.equal((await route.legs({ env: env({ ROUTE_MODE: 'full', NEEDS: JSON.stringify(skipped) }), event: editEvent(), manifest: MANIFEST })).legs['tests-linux'].result, 'skipped', 'a skipped leg is passed on for the summary check to fail');
  await assert.rejects(route.legs({ env: env({ NEEDS: 'not json' }), event: editEvent(), manifest: MANIFEST }), /NEEDS is not/);

  const light = await route.legs({ env: env({ ROUTE_MODE: 'light', ROUTE_RUN_ID: '102' }), fetchImpl: github([fullRun(102)]).fetchImpl, event: editEvent(), manifest: MANIFEST });
  assert.deepEqual([light.runId, light.reused], ['102', true]);
  assert.deepEqual(Object.keys(light.legs), shards.TEST_JOBS);
  assert.ok(Object.values(light.legs).every((leg) => leg.result === 'success'));
  const changed = fullRun(102);
  changed.artifacts[0].expired = true;
  await assert.rejects(route.legs({ env: env({ ROUTE_MODE: 'light', ROUTE_RUN_ID: '102' }), fetchImpl: github([changed]).fetchImpl, event: editEvent(), manifest: MANIFEST }), /run 102 cannot be reused: it kept no linux-1 summary/);
  await assert.rejects(route.legs({ env: env({ ROUTE_MODE: 'light', ROUTE_RUN_ID: '' }), event: editEvent(), manifest: MANIFEST }), /without naming a run/);
  await assert.rejects(route.legs({ env: env({ ROUTE_MODE: 'light', ROUTE_RUN_ID: '102' }), event: { ...editEvent(), action: 'synchronize' }, manifest: MANIFEST }), /chose a light run, but a pull request synchronize event/);
  await assert.rejects(route.legs({ env: env({ ROUTE_MODE: 'light', ROUTE_RUN_ID: '102' }), fetchImpl: github([fullRun(102)], { fail: /jobs/ }).fetchImpl, event: editEvent(), manifest: MANIFEST }), /GitHub answered 502/);

  await withFiles(async (dir) => {
    const eventFile = path.join(dir, 'event.json');
    fs.writeFileSync(eventFile, JSON.stringify(editEvent()));
    const output = path.join(dir, 'out.txt');
    const ok = await route.main(['legs'], { env: { ...env({ ROUTE_MODE: 'light', ROUTE_RUN_ID: '102' }), GITHUB_EVENT_PATH: eventFile, GITHUB_OUTPUT: output }, fetchImpl: github([fullRun(102)]).fetchImpl, out: sink(), err: sink() });
    assert.equal(ok, 0);
    const written = outputs(output);
    assert.deepEqual([written.run_id, written.reused], ['102', 'true']);
    assert.deepEqual(Object.keys(JSON.parse(written.legs)), shards.TEST_JOBS);
    const err = sink();
    const failed = await route.main(['legs'], { env: { ...env({ ROUTE_MODE: 'light', ROUTE_RUN_ID: '102' }), GITHUB_EVENT_PATH: eventFile, GITHUB_OUTPUT: path.join(dir, 'failed.txt') }, fetchImpl: github([changed]).fetchImpl, out: sink(), err });
    assert.equal(failed, 1);
    assert.match(err.text(), /The test legs could not be found: run 102 cannot be reused/);
    assert.equal(fs.existsSync(path.join(dir, 'failed.txt')), false, 'no outputs on failure');
  });
});

test('the check run names the route expects are the ones validate.yml produces', () => {
  const workflow = fs.readFileSync(path.join(shards.ROOT, '.github', 'workflows', 'validate.yml'), 'utf8');
  const names = shards.testJobCheckNames(MANIFEST);
  assert.deepEqual(Object.keys(names), shards.TEST_JOBS);
  for (const system of shards.SYSTEMS) assert.match(workflow, new RegExp(`shard: \\[${shards.shardIds(MANIFEST, system).join(', ')}\\]`));
  assert.ok(workflow.includes(`families: [${shards.HOOK_PACK_WINDOWS_GROUPS.join(', ')}]`));
  assert.match(workflow, /os: \[ubuntu-latest\]/);
  assert.match(workflow, /name: test-summary-\$\{\{ matrix\.shard \}\}-attempt-\$\{\{ github\.run_attempt \}\}-\$\{\{ github\.sha \}\}/);
});
