'use strict';

// No silent skips. Every skipped or todo test in Toolkit's own suite must be listed, with the system
// it skips on and a reason, in repo/contracts/ci/test-skips.json. The shard summaries name each
// skipped test, and the CI check fails on a skip the list does not hold, on a listed skip that no
// longer skips, and on a summary that counts skips without naming them.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const shards = require('../scripts/ci-test-shards.cjs');
const runner = require('../scripts/run-tests.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const clone = (value) => JSON.parse(JSON.stringify(value));
const sink = () => ({ write: () => true });

const A = 'repo/tests/a.test.cjs';
const B = 'repo/tests/b.test.cjs';

// Two files, one shard per system. a.test.cjs skips one test on Linux only and has one todo test on
// both systems; the list holds exactly those.
function fixture() {
  const files = [A, B];
  const manifest = {
    schema: shards.MANIFEST_SCHEMA,
    systems: { linux: { shards: [{ id: 'linux-1', rest: true }] }, windows: { shards: [{ id: 'windows-1', rest: true }] } },
  };
  const entry = (file, skipped = []) => ({
    file, tests: 3, passed: 3 - skipped.length,
    failed: 0, skipped: skipped.filter((item) => item.kind === 'skip').length, todo: skipped.filter((item) => item.kind === 'todo').length,
    cancelled: 0, seconds: 1, skipped_tests: skipped,
  });
  const summary = (system, list) => ({ schema: shards.SUMMARY_SCHEMA, system, shard: `${system}-1`, exit_code: 0, files: list, missing: [] });
  return {
    files,
    manifest,
    summaries: [
      summary('linux', [entry(A, [{ name: 'needs cmd.exe', kind: 'skip' }, { name: 'later', kind: 'todo' }]), entry(B)]),
      summary('windows', [entry(A, [{ name: 'later', kind: 'todo' }]), entry(B)]),
    ],
    needs: Object.fromEntries(shards.TEST_JOBS.map((job) => [job, { result: 'success' }])),
    skipList: {
      schema: shards.SKIPS_SCHEMA,
      skips: [
        { file: A, test: 'needs cmd.exe', systems: ['linux'], reason: 'cmd.exe exists only on Windows' },
        { file: A, test: 'later', systems: ['linux', 'windows'], reason: 'kept as a todo until the fake host lands' },
      ],
    },
  };
}

const verify = (f) => shards.verifyCiSummaries({ manifest: f.manifest, discovered: f.files, summaries: f.summaries, needs: f.needs, requiredJobs: shards.TEST_JOBS, skipList: f.skipList });

test('E4-3: a listed skip passes, an unlisted skip fails, a stale entry is named', () => {
  assert.deepEqual(verify(fixture()).errors, []);
  const cases = [
    ['an unlisted skip', (f) => { f.skipList.skips.shift(); }, /linux: repo\/tests\/a\.test\.cjs skipped "needs cmd\.exe", which repo\/contracts\/ci\/test-skips\.json does not list/],
    ['an unlisted todo', (f) => { f.skipList.skips.pop(); }, /windows: repo\/tests\/a\.test\.cjs left "later" as todo, which repo\/contracts\/ci\/test-skips\.json does not list/],
    ['a skip on a system the entry does not name', (f) => { f.skipList.skips[1].systems = ['linux']; }, /windows: repo\/tests\/a\.test\.cjs left "later" as todo/],
    ['a stale entry', (f) => { f.skipList.skips.push({ file: B, test: 'fixed now', systems: ['windows'], reason: 'was waiting for a runner fix' }); }, /windows: "fixed now" in repo\/tests\/b\.test\.cjs is listed in repo\/contracts\/ci\/test-skips\.json but did not skip; remove it from the list/],
    ['an entry for a system where the test ran', (f) => { f.skipList.skips[0].systems = ['linux', 'windows']; }, /windows: "needs cmd\.exe" in repo\/tests\/a\.test\.cjs is listed .* but did not skip/],
    ['a name that differs by one character', (f) => { f.summaries[0].files[0].skipped_tests[0].name = 'needs cmd.exe '; }, /skipped "needs cmd\.exe ", which/],
    ['skips counted but not named', (f) => { delete f.summaries[0].files[0].skipped_tests; }, /linux: repo\/tests\/a\.test\.cjs counted 1 skipped and 1 todo tests but its summary names 0/],
    ['fewer names than skips', (f) => { f.summaries[0].files[0].skipped_tests.pop(); }, /counted 1 skipped and 1 todo tests but its summary names 1/],
    ['a malformed name entry', (f) => { f.summaries[1].files[0].skipped_tests[0] = { name: '', kind: 'todo' }; }, /windows: repo\/tests\/a\.test\.cjs has a skipped test entry that is not \{ name, kind \}/],
    ['no list at all', (f) => { f.skipList = undefined; }, /skipped "needs cmd\.exe", which/],
  ];
  for (const [label, mutate, pattern] of cases) {
    const f = fixture();
    mutate(f);
    assert.match(verify(f).errors.join('\n'), pattern, label);
  }
});

test('the skip list reader refuses every shape it does not know', () => {
  const base = fixture().skipList;
  assert.deepEqual(shards.skipListErrors(base, [A, B]), []);
  const cases = [
    ['not an object', () => [], /the skip list is not a JSON object/],
    ['wrong schema', (l) => { l.schema = 'toolkit-test-skips/v0'; }, /schema must be toolkit-test-skips\/v1/],
    ['an unknown top key', (l) => { l.allow_all = true; }, /unknown key allow_all/],
    ['skips not a list', (l) => { l.skips = {}; }, /skips must be a list/],
    ['an unknown entry key', (l) => { l.skips[0].wildcard = '*'; }, /skip 1: needs exactly file, test, systems and reason/],
    ['a missing reason', (l) => { delete l.skips[0].reason; }, /skip 1: needs exactly file, test, systems and reason/],
    ['a short reason', (l) => { l.skips[0].reason = 'flaky'; }, /skip 1: reason must be 12 to 300 characters/],
    ['a file that is not a test file', (l) => { l.skips[0].file = 'repo/tests/gone.test.cjs'; }, /skip 1: repo\/tests\/gone\.test\.cjs is not a discovered test file/],
    ['an empty test name', (l) => { l.skips[0].test = ''; }, /skip 1: test must be the test's name, 1 to 300 characters on one line/],
    ['a test name over two lines', (l) => { l.skips[0].test = 'a\nb'; }, /skip 1: test must be the test's name/],
    ['an unknown system', (l) => { l.skips[0].systems = ['macos']; }, /skip 1: systems must name linux and\/or windows once each/],
    ['a repeated system', (l) => { l.skips[0].systems = ['linux', 'linux']; }, /skip 1: systems must name linux and\/or windows once each/],
    ['no systems', (l) => { l.skips[0].systems = []; }, /skip 1: systems must name linux and\/or windows once each/],
    ['a repeated entry', (l) => { l.skips.push(clone(l.skips[0])); }, /skip 3: "needs cmd\.exe" in repo\/tests\/a\.test\.cjs is listed twice/],
  ];
  for (const [label, mutate, pattern] of cases) {
    let list = clone(base);
    const replaced = mutate(list);
    if (replaced !== undefined) list = replaced;
    assert.match(shards.skipListErrors(list, [A, B]).join('\n'), pattern, label);
  }
  // An invalid list allows nothing: its errors are reported and every skip counts as unlisted.
  const f = fixture();
  f.skipList.schema = 'other';
  const errors = verify(f).errors.join('\n');
  assert.match(errors, /schema must be toolkit-test-skips\/v1/);
  assert.match(errors, /skipped "needs cmd\.exe", which/);
});

test('a real run names each skipped and todo test in its summary', (t) => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-test-skips-'));
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const file = path.join(work, 'skips.test.cjs');
  fs.writeFileSync(file, [
    "const test = require('node:test');",
    "test('runs', () => {});",
    "test('option skip', { skip: 'not here' }, () => {});",
    "test('skipped from inside', (t) => { t.skip('no tool'); });",
    "test('a todo', { todo: true }, () => { throw new Error('not yet'); });",
    "test('parent', async (t) => { await t.test('child skip', { skip: true }, () => {}); });",
    "test.describe.skip('skipped suite', () => { test.it('inner', () => {}); });",
  ].join('\n'));
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // the inner node --test is a fresh run, not a file of this one
  const run = new runner.TestRun({ root: ROOT, system: shards.platformSystem(), tempRoot: path.join(os.homedir(), 't'), env, stdio: 'ignore', out: sink(), err: sink() });
  const { exitCode, summary } = run.run([file], { concurrency: 1 });
  assert.equal(exitCode, 0);
  const [entry] = summary.files;
  assert.equal(entry.skipped, 3);
  assert.equal(entry.todo, 1);
  const named = entry.skipped_tests.map((item) => `${item.kind}:${item.name}`).sort();
  assert.deepEqual(named, ['skip:child skip', 'skip:option skip', 'skip:skipped from inside', 'skip:skipped suite', 'todo:a todo']);
});

test('the checked-in skip list is valid and every entry names a discovered test file', () => {
  const list = shards.loadSkipList(ROOT);
  assert.deepEqual(shards.skipListErrors(list, shards.discoverTestFiles(ROOT)), []);
});
