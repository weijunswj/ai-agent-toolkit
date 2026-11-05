'use strict';
require('./toolkit-test-temp-guard.cjs');

// The shard timing refresh: it reads CI summaries, reports the refresh triggers, and rewrites the
// manifest only when one fired. Fetch tests use local Git only; no gh or network runs.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { fetchFixture, foreignFetch, loadWithCommands } = require('./support/toolkit-fetch-race-fixture.cjs');
const { git } = require('./support/toolkit-local-bridge-fixture.cjs');
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
  assert.match(plan.findings.join('\n'), /linux: slowest shard is .*x the fastest \(over 1\.5x\); rebalanced/);
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

for (const [system, ratio, expected] of [['linux', 1.38, false], ['linux', 1.50, false], ['linux', 1.51, true], ['windows', 1.30, false], ['windows', 1.31, true]]) {
  test(`fully timed ${system} balance ${ratio} triggers=${expected}`, () => {
    const current = manifest(even);
    for (const name of shards.SYSTEMS) current.systems[name].shards[0].files = FILES.slice(0, 3);
    const measured = { linux: { ...even }, windows: { ...even } };
    for (const file of FILES.slice(0, 3)) measured[system][file] = 10 * ratio;
    const plan = refresh.planRefresh(current, FILES, measured);
    assert.equal(plan.refresh, expected);
    assert.equal(plan.findings.length, expected ? 1 : 0);
    if (expected) assert.match(plan.findings[0], new RegExp(`^${system}: slowest shard`));
    else assert.equal(plan.manifest, current);
  });
}

test('generated candidate body requires gates and names pending evidence without claiming completion', () => {
  const { prBody } = loadWithCommands('refresh-shard-timings.cjs', ['prBody'], spawnSync, __dirname);
  const body = prBody({ databaseId: 123, headSha: 'a'.repeat(40) }, { findings: ['linux: trigger crossed'] });
  assert.match(body, /G0.*pending.*source run.*trigger.*unchanged budgets/i);
  assert.match(body, /fresh G1.*pending.*classifier.*RISKY/i);
  assert.match(body, /Agent UAT.*pending.*exact-head CI coverage.*Linux and Windows/i);
  assert.match(body, /Owner UAT: NOT_REQUIRED.*manifest-only redistribution.*entire changed surface/i);
  assert.match(body, /Full G2.*pending.*before merge/i);
  assert.match(body, /Budget or generator changes.*impact assessment/);
  assert.doesNotMatch(body, /\b(passed|approved|verified)\b/i);
});

for (const mode of ['after-fetch', 'before-worktree', 'fetch-failure', 'resolution-failure', 'worktree-failure', 'cleanup-failure']) {
  test(`refresh worktree owns its fetched commit: ${mode}`, () => {
    const fixture = fetchFixture();
    try {
      let injected = false;
      let tree;
      let target;
      let fetchRef;
      let fetchArgs;
      const output = [];
      const branch = `toolkit/shard-timings-${fixture.intended.slice(0, 7)}`;
      const invoke = (program, args, options) => {
        if (program === 'gh') throw new Error('stop after inspecting candidate');
        assert.equal(program, 'git');
        if (args[0] === 'fetch') {
          fetchArgs = args;
          fetchRef = args.at(-1);
          if (mode === 'fetch-failure') return spawnSync(program, ['fetch', 'origin', 'refs/heads/missing'], options);
        }
        if (mode === 'cleanup-failure' && args[0] === 'update-ref' && args[1] === '-d') return { status: 1, stdout: '', stderr: 'injected cleanup failure' };
        if (mode === 'resolution-failure' && args[0] === 'rev-parse') return { status: 1, stdout: '', stderr: 'injected resolution failure' };
        if (args[0] === 'worktree' && args[1] === 'add') {
          target = args.at(-1);
          tree = args.at(-2);
          if (mode === 'before-worktree') { foreignFetch(fixture); injected = true; }
          if (mode === 'worktree-failure' || mode === 'cleanup-failure') return { status: 1, stdout: '', stderr: 'injected worktree failure' };
        }
        const result = spawnSync(program, args, options);
        // Stop before reading manifests or publishing; the real candidate is now inspectable.
        if (args[0] === 'worktree' && args[1] === 'add' && result.status === 0) throw new Error('stop after inspecting candidate');
        if (args[0] === 'fetch' && result.status === 0 && mode !== 'before-worktree') { foreignFetch(fixture); injected = true; }
        return result;
      };
      const { openPr } = loadWithCommands('refresh-shard-timings.cjs', ['openPr'], invoke, fixture.root);
      assert.throws(() => openPr(fixture.repo, { headSha: fixture.intended, databaseId: 123 }, { write(text) { output.push(text); } }), mode === 'cleanup-failure' ? /git worktree failed: injected worktree failure/ : mode.endsWith('failure') ? /failed/ : /stop after inspecting candidate/);
      assert.equal(git(fixture.repo, ['rev-parse', 'HEAD']), fixture.initialCommit, 'caller HEAD stays unchanged');
      if (!mode.endsWith('failure')) {
        assert.equal(git(tree, ['rev-parse', 'HEAD']), fixture.intended);
        assert.equal(git(fixture.repo, ['rev-parse', branch]), fixture.intended);
        assert.equal(target, fixture.intended, 'worktree uses the resolved SHA');
        assert.equal(git(fixture.repo, ['rev-parse', 'FETCH_HEAD']), fixture.foreign);
      } else {
        assert.equal(git(fixture.repo, ['branch', '--list', branch]), '', 'failure must not create the candidate branch');
      }
      assert.match(fetchRef, /^main:refs\/toolkit\/fetch\/\d+-[a-f0-9]+$/);
      assert.equal(git(fixture.repo, ['rev-parse', 'refs/toolkit/fetch/foreign-owner']), injected ? fixture.foreign : fixture.initialCommit);
      const ownedRef = fetchRef.slice('main:'.length);
      const remaining = ['refs/toolkit/fetch/foreign-owner'];
      if (mode === 'cleanup-failure') {
        remaining.push(ownedRef);
        assert.match(output.join(''), /warning.*owned fetch ref/i);
        assert.ok(output.join('').includes(ownedRef));
      }
      assert.deepEqual(git(fixture.repo, ['for-each-ref', '--format=%(refname)', 'refs/toolkit/fetch/']).split('\n').sort(), remaining.sort());
      assert.ok(fetchArgs.includes('--no-tags'), 'owned fetch does not follow tags');
      assert.equal(git(fixture.repo, ['status', '--porcelain']), '');
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });
}
