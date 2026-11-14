'use strict';
require('./toolkit-test-temp-guard.cjs');

// The shard timing refresh: it reads CI summaries, reports the refresh triggers, and rewrites the
// manifest only when one fired. Fetch tests use local Git only; no gh or network runs.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
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

test('arguments: report by default, one of --write, --open-pr or --fail-if-due, numeric --run', () => {
  assert.deepEqual(refresh.parseArgs([]), { run: null, write: false, openPr: false, failIfDue: false });
  assert.equal(refresh.parseArgs(['--run', '123', '--write']).run, '123');
  assert.equal(refresh.parseArgs(['--fail-if-due']).failIfDue, true);
  for (const pair of [['--write', '--open-pr'], ['--write', '--fail-if-due'], ['--open-pr', '--fail-if-due']]) assert.throws(() => refresh.parseArgs(pair), /Use one of --write, --open-pr or --fail-if-due/);
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
    findOpen: () => [],
  };
  assert.equal(refresh.main(['--repo-root', selected, '--open-pr'], deps), 0);
  assert.equal(refresh.main(['--open-pr'], deps), 0);
  assert.deepEqual(published, [[selected, run], [shards.ROOT, run]]);
  run.headBranch = 'feature';
  assert.equal(refresh.main(['--repo-root', selected, '--open-pr'], deps), 2);
  assert.match(errors.join(''), /--open-pr reads main runs only/);
  assert.equal(published.length, 2);
});

test('--fail-if-due: a report run that cannot publish fails when a refresh is due, and passes when none is', (t) => {
  const selected = checkout(t);
  const before = fs.readFileSync(path.join(selected, ...shards.MANIFEST_REL.split('/')));
  const errors = [];
  const deps = {
    readRun: () => ({ databaseId: 123, headBranch: 'main', headSha: 'a'.repeat(40) }),
    readSummaries: () => shards.SYSTEMS.map(system => summary(system, even)),
    publish() { assert.fail('a report run never publishes'); },
    out: { write() {} }, err: { write(text) { errors.push(text); } },
  };
  assert.equal(refresh.main(['--repo-root', selected, '--fail-if-due'], deps), 1);
  assert.match(errors.join(''), /A refresh trigger crossed and this run cannot publish\. Owner: set up the governance App .+ or run node repo\/scripts\/refresh-shard-timings\.cjs --write and open the pull request by hand/);
  assert.deepEqual(fs.readFileSync(path.join(selected, ...shards.MANIFEST_REL.split('/'))), before, 'it changes nothing');
  assert.equal(refresh.main(['--repo-root', selected, '--write'], { ...deps, err: { write(text) { assert.fail(text); } } }), 0);
  errors.length = 0;
  assert.equal(refresh.main(['--repo-root', selected, '--fail-if-due'], deps), 0, 'once refreshed, nothing is due');
  assert.deepEqual(errors, []);
});

test('--open-pr: a refresh pull request open over 7 days fails the run naming it; a newer one stays a quiet skip', () => {
  const run = { databaseId: 123, headBranch: 'main', headSha: 'a'.repeat(40) };
  const now = Date.parse('2026-11-14T00:00:00Z');
  const errors = [];
  const at = days => new Date(now - days * 86400000).toISOString();
  const deps = open => ({ now, out: { write() {} }, err: { write(text) { errors.push(text); } }, readRun: () => run,
    publish() { assert.fail('an open refresh pull request blocks a second one'); }, findOpen: () => open });
  assert.equal(refresh.main(['--open-pr'], deps([{ number: 41, headRefName: `${refresh.REFRESH_BRANCH_PREFIX}1`, createdAt: at(7) }])), 0, 'seven days is still within its time');
  assert.deepEqual(errors, []);
  assert.equal(refresh.main(['--open-pr'], deps([{ number: 41, headRefName: `${refresh.REFRESH_BRANCH_PREFIX}1`, createdAt: at(8) }])), 1);
  assert.match(errors.join(''), /open over 7 days: #41 \(open since 2026-11-06\)\. Owner or controller: merge or close it/);
});

test('--open-pr opens nothing while an earlier shard timing pull request is open', () => {
  const run = { databaseId: 123, headBranch: 'main', headSha: 'a'.repeat(40) };
  const out = [];
  const asked = [];
  const deps = {
    out: { write(text) { out.push(text); } }, err: { write(text) { assert.fail(text); } },
    readRun: () => run,
    publish() { assert.fail('an open refresh pull request blocks a second one'); },
    findOpen(root) { asked.push(root); return [{ number: 41, headRefName: `${refresh.REFRESH_BRANCH_PREFIX}1234567` }]; },
  };
  assert.equal(refresh.main(['--open-pr'], deps), 0);
  assert.equal(asked.length, 1);
  assert.match(out.join(''), /already open \(#41\); no new pull request/);
  // Only --open-pr asks: a report run never lists pull requests.
  assert.equal(refresh.main([], { ...deps, readSummaries: () => [], findOpen() { assert.fail('report runs do not list pull requests'); } }), 0);
});

test('publish token: the push and pull request use the App token through environment-only git config', () => {
  assert.equal(refresh.publishEnv({ PATH: '/bin' }), undefined, 'no App token, no change: gh and git use their own sign-in');
  const token = ['example', 'publish', 'token'].join('-');
  const env = refresh.publishEnv({ PATH: '/bin', TOOLKIT_SHARD_PUBLISH_TOKEN: token, GITHUB_TOKEN: 'built-in', GH_TOKEN: 'reader' });
  assert.equal(env.GH_TOKEN, token);
  assert.equal(env.GITHUB_TOKEN, undefined, 'the built-in token never reaches the publish step');
  assert.equal(env.TOOLKIT_SHARD_PUBLISH_TOKEN, undefined);
  assert.equal(env.GIT_CONFIG_COUNT, '1');
  assert.equal(env.GIT_CONFIG_KEY_0, 'http.https://github.com/.extraheader');
  assert.equal(env.GIT_CONFIG_VALUE_0, `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`);
  const appended = refresh.publishEnv({ TOOLKIT_SHARD_PUBLISH_TOKEN: token, GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'a.b', GIT_CONFIG_VALUE_0: 'c' });
  assert.equal(appended.GIT_CONFIG_COUNT, '3');
  assert.equal(appended.GIT_CONFIG_KEY_2, 'http.https://github.com/.extraheader');
  assert.equal(appended.GIT_CONFIG_KEY_0, 'a.b', 'existing entries are kept');
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
  assert.ok(body.includes('node <Toolkit>/repo/scripts/refresh-shard-timings.cjs --repo-root <checkout> --open-pr'));
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

// A governed repository with a v2 shard list: Linux only, its own test layout and workflow name.
const governed = require('../scripts/governed-test-shards.cjs');
const GOVERNED_FILES = ['tests/a_test.py', 'tests/b_test.py', 'tests/deep/c_test.py', 'tests/d_test.py'];

function governedCheckout(t, extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-refresh-v2-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const file of GOVERNED_FILES) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), '# fixture\n');
  }
  fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
  const list = {
    schema: governed.MANIFEST_SCHEMA,
    systems: { linux: { command: ['python', '-m', 'pytest', '{files}'], discover: 'tests/**/*_test.py', shards: [{ id: 'linux-1', files: [GOVERNED_FILES[0]] }, { id: 'linux-2', rest: true }] } },
    ...extra,
  };
  fs.writeFileSync(path.join(root, ...governed.MANIFEST_REL.split('/')), refresh.manifestText(list));
  fs.writeFileSync(path.join(root, '.github', 'workflows', extra.workflow || governed.DEFAULT_WORKFLOW), 'name: Toolkit Test Shards\non: push\n');
  return root;
}

// What a governed shard writes: command mode, one test per file.
function commandSummary(times, exitCode = 0) {
  return { schema: shards.SUMMARY_SCHEMA, system: 'linux', shard: 'linux-1', exit_code: exitCode, command_mode: true, files: Object.entries(times).map(([file, seconds]) => ({ file, tests: 1, passed: exitCode ? 0 : 1, failed: exitCode ? 1 : 0, skipped: 0, todo: 0, cancelled: 0, seconds })), missing: [] };
}

test('v2: a governed list reads the workflow it names, takes command mode summaries and writes durations and rebalanced shards back', (t) => {
  const root = governedCheckout(t);
  const target = path.join(root, ...governed.MANIFEST_REL.split('/'));
  const seen = [];
  const out = [];
  const times = { [GOVERNED_FILES[0]]: 2, [GOVERNED_FILES[1]]: 40, [GOVERNED_FILES[2]]: 50, [GOVERNED_FILES[3]]: 60 };
  const deps = {
    readRun(dir, run, profile) { seen.push([dir, run, profile.kind, profile.workflowFile, profile.workflowName]); return { databaseId: 9, headBranch: 'main', headSha: 'b'.repeat(40) }; },
    readSummaries: () => [commandSummary(times), commandSummary({ [GOVERNED_FILES[0]]: 999 }, 1)],
    publish() { assert.fail('a write never publishes'); },
    out: { write(text) { out.push(text); } }, err: { write(text) { assert.fail(text); } },
  };
  assert.equal(refresh.main(['--repo-root', root, '--write'], deps), 0);
  assert.deepEqual(seen, [[root, null, 'v2', 'toolkit-test-shards.yml', 'Toolkit Test Shards']]);
  assert.match(out.join(''), /^Toolkit Test Shards run 9 on main/);
  assert.match(out.join(''), /Updated \.github\/toolkit-test-shards\.json\./);
  const updated = JSON.parse(fs.readFileSync(target, 'utf8'));
  assert.deepEqual(updated.durations_seconds, { linux: times }, 'only the systems the list names, and never a failed shard\'s times');
  assert.equal(updated.systems.linux.command.join(' '), 'python -m pytest {files}', 'the command and glob stay');
  assert.deepEqual(updated.systems.linux.shards.map((shard) => shard.id), ['linux-1', 'linux-2'], 'the same shard ids and rest shard');
  assert.equal(updated.systems.linux.shards[1].rest, true);
  assert.notDeepEqual(updated.systems.linux.shards[0].files, [GOVERNED_FILES[0]], 'the named shard was rebalanced');
  const discovered = governed.discoverAll(root, updated);
  assert.deepEqual(governed.manifestErrors(updated, discovered), [], 'the written list is still usable');
  assert.ok(!fs.existsSync(path.join(root, 'repo')), 'no v1 manifest is written');
});

test('v2: the list\'s workflow field picks the run; a missing workflow file or a named run of another workflow is refused', (t) => {
  const root = governedCheckout(t, { workflow: 'shards.yml' });
  const profile = refresh.profileFor(root);
  assert.equal(profile.workflowFile, 'shards.yml');
  assert.equal(profile.manifestRel, governed.MANIFEST_REL);
  const { latestGreenRun } = loadWithCommands('refresh-shard-timings.cjs', ['latestGreenRun'], (program, args) => {
    if (args[1] === 'list') return { status: 0, stdout: JSON.stringify([{ databaseId: 1, workflowName: 'Toolkit Test Shards' }]) };
    return { status: 0, stdout: JSON.stringify({ databaseId: 2, conclusion: 'success', workflowName: 'Validate' }) };
  }, os.tmpdir());
  assert.equal(latestGreenRun(root, null, profile).databaseId, 1);
  assert.throws(() => latestGreenRun(root, '2', profile), /run 2 is not a finished Toolkit Test Shards run/);
  fs.rmSync(path.join(root, '.github', 'workflows', 'shards.yml'));
  const errors = [];
  assert.equal(refresh.main(['--repo-root', root], { readRun() { assert.fail('no run is read'); }, out: { write() {} }, err: { write(text) { errors.push(text); } } }), 2);
  assert.match(errors.join(''), /\.github\/workflows\/shards\.yml, the workflow the shard list names, is missing/);
});

test('v2: per-system budgets are reported, and --fail-if-due names the governed command', (t) => {
  const root = governedCheckout(t, { budgets: { linux: { seconds_per_file: 30, raised: { [GOVERNED_FILES[3]]: { seconds: 90 } } } } });
  const errors = [];
  const out = [];
  const deps = {
    readRun: () => ({ databaseId: 9, headBranch: 'main', headSha: 'b'.repeat(40) }),
    readSummaries: () => [commandSummary({ [GOVERNED_FILES[0]]: 2, [GOVERNED_FILES[1]]: 40, [GOVERNED_FILES[2]]: 5, [GOVERNED_FILES[3]]: 60 })],
    out: { write(text) { out.push(text); } }, err: { write(text) { errors.push(text); } },
  };
  assert.equal(refresh.main(['--repo-root', root, '--fail-if-due'], deps), 1);
  assert.match(out.join(''), /linux: tests\/b_test\.py took 40 s, over its 30 s budget/);
  assert.doesNotMatch(out.join(''), /d_test\.py took/, 'a raised budget holds');
  assert.match(errors.join(''), /node <Toolkit>\/repo\/scripts\/refresh-shard-timings\.cjs --repo-root <checkout> --write/);
});

test('v1 stays as it was: the Toolkit root reads validate.yml and Validate runs and writes the v1 manifest', () => {
  assert.equal(refresh.profileFor(shards.ROOT), refresh.V1);
  assert.equal(refresh.V1.workflowFile, 'validate.yml');
  assert.equal(refresh.V1.workflowName, 'Validate');
  assert.equal(refresh.V1.manifestRel, 'repo/contracts/ci/test-shards.json');
  const calls = [];
  const { latestGreenRun, prBody } = loadWithCommands('refresh-shard-timings.cjs', ['latestGreenRun', 'prBody'], (program, args) => {
    calls.push([program, ...args]);
    if (args[1] === 'list') return { status: 0, stdout: JSON.stringify([{ databaseId: 1 }]) };
    return { status: 0, stdout: JSON.stringify({ databaseId: 2, conclusion: 'success', workflowName: 'Toolkit Test Shards' }) };
  }, os.tmpdir());
  latestGreenRun(shards.ROOT, null);
  assert.deepEqual(calls[0], ['gh', 'run', 'list', '--workflow', 'validate.yml', '--branch', 'main', '--event', 'push', '--status', 'success', '--limit', '1', '--json', 'databaseId,headSha,conclusion,headBranch,workflowName']);
  assert.throws(() => latestGreenRun(shards.ROOT, '2'), /^Error: run 2 is not a finished Validate run$/);
  assert.equal(prBody({ databaseId: 123, headSha: 'a'.repeat(40) }, { findings: [] }).split('\n')[0], 'Refreshes the measured test times in `repo/contracts/ci/test-shards.json` from the test summaries of Validate run 123 on main (aaaaaaa).');
  // The v1 plan is the same with the default profile and with V1 named.
  const current = manifest(even);
  assert.deepEqual(refresh.planRefresh(current, FILES, { linux: even, windows: even }), refresh.planRefresh(current, FILES, { linux: even, windows: even }, refresh.V1));
});
