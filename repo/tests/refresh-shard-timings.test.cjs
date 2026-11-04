'use strict';

// The shard timing refresh: it reads CI summaries, reports the refresh triggers, and rewrites the
// manifest only when one fired. These tests run the pure parts with no gh, git or network.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const shards = require('../scripts/ci-test-shards.cjs');
const refresh = require('../scripts/refresh-shard-timings.cjs');

const FILES = ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => `repo/tests/${name}.test.cjs`);

function manifest(durations, extra = {}) {
  return {
    schema: shards.MANIFEST_SCHEMA,
    systems: {
      linux: { shards: [{ id: 'linux-1', files: [FILES[0]] }, { id: 'linux-2', rest: true }] },
      windows: { shards: [{ id: 'windows-1', files: [FILES[0], FILES[1]] }, { id: 'windows-2', rest: true }] },
    },
    durations_seconds: { linux: { ...durations }, windows: { ...durations } },
    ...extra,
  };
}

function summary(system, times) {
  return { schema: shards.SUMMARY_SCHEMA, system, exit_code: 0, files: Object.entries(times).map(([file, seconds]) => ({ file, seconds })), missing: [] };
}

const even = Object.fromEntries(FILES.map((file) => [file, 10]));

test('arguments: report by default, --write or --open-pr but not both, numeric --run', () => {
  assert.deepEqual(refresh.parseArgs([]), { run: null, write: false, openPr: false });
  assert.equal(refresh.parseArgs(['--run', '123', '--write']).run, '123');
  assert.throws(() => refresh.parseArgs(['--write', '--open-pr']), /not both/);
  assert.throws(() => refresh.parseArgs(['--run', 'latest']), /numeric run id/);
  assert.throws(() => refresh.parseArgs(['--merge']), /Unknown argument/);
});

test('summaries give rounded times for discovered files only and refuse other files', () => {
  const fresh = refresh.timingsFromSummaries([summary('linux', { [FILES[0]]: 1.234, 'repo/tests/gone.test.cjs': 5 })], FILES);
  assert.deepEqual(fresh.linux, { [FILES[0]]: 1.2 });
  assert.deepEqual(fresh.windows, {});
  // A failed shard uploads its summary too, but its times come from a failing run.
  const failed = { ...summary('windows', { [FILES[0]]: 99 }), exit_code: 1 };
  assert.deepEqual(refresh.timingsFromSummaries([failed, summary('linux', { [FILES[0]]: 2 })], FILES), { linux: { [FILES[0]]: 2 }, windows: {} });
  assert.throws(() => refresh.timingsFromSummaries([{ schema: 'other', system: 'linux', files: [] }], FILES), /not a toolkit-test-summary/);
});

test('balanced and fully timed shards cross no trigger and leave the manifest as it was', () => {
  const current = manifest(even, { systems: {
    linux: { shards: [{ id: 'linux-1', files: FILES.slice(0, 3) }, { id: 'linux-2', rest: true }] },
    windows: { shards: [{ id: 'windows-1', files: FILES.slice(0, 3) }, { id: 'windows-2', rest: true }] },
  } });
  const plan = refresh.planRefresh(current, FILES, { linux: even, windows: even });
  assert.equal(plan.refresh, false);
  assert.deepEqual(plan.findings, []);
  assert.equal(plan.manifest, current);
});

test('more than 10% untimed files trigger a refresh that records the measured times', () => {
  const recorded = Object.fromEntries(FILES.slice(0, 5).map((file) => [file, 10]));
  const current = manifest(recorded, { systems: {
    linux: { shards: [{ id: 'linux-1', files: FILES.slice(0, 3) }, { id: 'linux-2', rest: true }] },
    windows: { shards: [{ id: 'windows-1', files: FILES.slice(0, 3) }, { id: 'windows-2', rest: true }] },
  } });
  const plan = refresh.planRefresh(current, FILES, { linux: even, windows: even });
  assert.equal(plan.refresh, true);
  assert.match(plan.findings.join('\n'), /linux: 1 of 6 test files have no recorded time/);
  assert.deepEqual(plan.manifest.durations_seconds.linux, even);
  assert.deepEqual(current.durations_seconds.linux, recorded, 'the input manifest is not changed');
});

test('an unbalanced system is rebalanced across the same shard ids, keeping the rest shard', () => {
  const fresh = { linux: { ...even, [FILES[0]]: 100 }, windows: even };
  const current = manifest(fresh.linux);
  current.systems.linux.shards = [{ id: 'linux-1', files: FILES.slice(1, 6) }, { id: 'linux-2', rest: true }];
  current.durations_seconds.linux[FILES[0]] = 1;
  const plan = refresh.planRefresh(current, FILES, fresh);
  assert.equal(plan.refresh, true);
  assert.match(plan.findings.join('\n'), /linux: slowest shard is .*x the fastest \(over 1\.3x\); rebalanced/);
  const after = plan.manifest.systems.linux.shards;
  assert.deepEqual(after.map((shard) => shard.id), ['linux-1', 'linux-2']);
  assert.equal(after[1].rest, true);
  assert.deepEqual(shards.manifestErrors(plan.manifest, FILES), []);
  const named = new Set(after[0].files);
  assert.ok(named.has(FILES[0]) !== named.has(FILES[1]), 'the long file and its neighbours are split across shards');
});

test('a file over its budget is reported, not hidden, and refreshing does not claim to fix it', () => {
  const fresh = { linux: { ...even, [FILES[2]]: 95 }, windows: even };
  const current = manifest(fresh.linux, { budgets: { seconds_per_file: { linux: 90, windows: 120 } } });
  current.systems.linux.shards = [{ id: 'linux-1', files: [FILES[2]] }, { id: 'linux-2', rest: true }];
  current.systems.windows.shards = [{ id: 'windows-1', files: FILES.slice(0, 3) }, { id: 'windows-2', rest: true }];
  const plan = refresh.planRefresh(current, FILES, fresh);
  assert.match(plan.findings.join('\n'), /c\.test\.cjs took 95 s, over its 90 s budget; split it by area or make it faster/);
});

test('the refreshed manifest keeps the file format', () => {
  assert.equal(refresh.manifestText({ a: [1] }), '{\n  "a": [\n    1\n  ]\n}\n');
});

test('an explicit repository root must be absolute and complete', () => {
  const root = path.resolve(os.tmpdir(), 'selected-checkout');
  assert.equal(refresh.parseArgs(['--repo-root', root]).root, root);
  for (const argv of [['--repo-root'], ['--repo-root', '--write'], ['--repo-root', 'relative']]) {
    assert.throws(() => refresh.parseArgs(argv), /absolute checkout path/, JSON.stringify(argv));
  }
});

function checkout(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-refresh-root-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'repo', 'tests'), { recursive: true });
  fs.mkdirSync(path.join(root, 'repo', 'contracts', 'ci'), { recursive: true });
  for (const file of FILES) fs.writeFileSync(path.join(root, ...file.split('/')), '// fixture\n');
  fs.writeFileSync(path.join(root, ...shards.MANIFEST_REL.split('/')), refresh.manifestText(manifest({})));
  return root;
}

test('report and write discover, measure and update only the selected repository', (t) => {
  const fallback = checkout(t);
  const selected = checkout(t);
  const target = path.join(selected, ...shards.MANIFEST_REL.split('/'));
  const other = path.join(fallback, ...shards.MANIFEST_REL.split('/'));
  const before = fs.readFileSync(target);
  const toolkitManifest = fs.readFileSync(path.join(shards.ROOT, ...shards.MANIFEST_REL.split('/')));
  const calls = [];
  const deps = {
    root: fallback,
    readRun(root, run) { calls.push(['run', root, run]); return { databaseId: 123, headBranch: 'main', headSha: 'a'.repeat(40) }; },
    readSummaries(root, run) { calls.push(['summaries', root, run]); return shards.SYSTEMS.map(system => summary(system, even)); },
    publish() { assert.fail('report/write must not publish'); },
    out: { write() {} }, err: { write(text) { assert.fail(text); } },
  };
  assert.equal(refresh.main(['--repo-root', selected, '--run', '123'], deps), 0);
  assert.deepEqual(fs.readFileSync(target), before, 'report is read-only');
  assert.equal(refresh.main(['--repo-root', selected, '--run', '123', '--write'], deps), 0);
  const updated = JSON.parse(fs.readFileSync(target, 'utf8'));
  assert.deepEqual(updated.durations_seconds, { linux: even, windows: even });
  assert.deepEqual(shards.manifestErrors(updated, FILES), []);
  assert.deepEqual(fs.readFileSync(other), before, 'injected default repository stays untouched');
  assert.deepEqual(fs.readFileSync(path.join(shards.ROOT, ...shards.MANIFEST_REL.split('/'))), toolkitManifest, 'Toolkit stays untouched');
  assert.deepEqual(calls, [
    ['run', selected, '123'], ['summaries', selected, 123],
    ['run', selected, '123'], ['summaries', selected, 123],
  ]);
});

test('--open-pr forwards the selected root and keeps the main-only guard; default root still works', (t) => {
  const selected = checkout(t);
  const run = { databaseId: 123, headBranch: 'main', headSha: 'a'.repeat(40) };
  const published = [];
  const errors = [];
  const deps = {
    out: { write() {} }, err: { write(text) { errors.push(text); } },
    readRun: () => run,
    readSummaries() { assert.fail('publish owns summary reads'); },
    publish(root, actualRun) { published.push([root, actualRun]); return 0; },
  };
  assert.equal(refresh.main(['--repo-root', selected, '--open-pr'], deps), 0);
  assert.equal(refresh.main(['--open-pr'], deps), 0);
  assert.deepEqual(published, [[selected, run], [shards.ROOT, run]]);
  run.headBranch = 'feature';
  assert.equal(refresh.main(['--repo-root', selected, '--open-pr'], deps), 2);
  assert.match(errors.join(''), /--open-pr reads main runs only/);
  assert.equal(published.length, 2);
});
