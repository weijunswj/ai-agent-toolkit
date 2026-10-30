'use strict';

// CI and local runs share one test shard manifest. These tests prove the manifest covers every test
// file once per system, the CI aggregate check refuses every way a shard can drop tests, the
// workflow drift guard catches the known ways to narrow or mask a test step, and the runner's temp
// folder is under the user profile and removed after every run, including failed and interrupted ones.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const shards = require('../scripts/ci-test-shards.cjs');
const runner = require('../scripts/run-tests.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const WORKFLOW = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'validate.yml'), 'utf8').replace(/\r\n/g, '\n');
const MANIFEST = shards.loadManifest(ROOT);
const DISCOVERED = shards.discoverTestFiles(ROOT);
const clone = (value) => JSON.parse(JSON.stringify(value));

function sink() {
  const chunks = [];
  return { write: (chunk) => { chunks.push(String(chunk)); return true; }, text: () => chunks.join('') };
}

test('the checked-in manifest runs every discovered test file exactly once on each system', () => {
  assert.deepEqual(shards.manifestErrors(MANIFEST, DISCOVERED), []);
  assert.ok(DISCOVERED.length > 0);
  for (const system of shards.SYSTEMS) {
    const all = shards.systemShards(MANIFEST, system, DISCOVERED).flatMap((shard) => shard.files);
    assert.deepEqual([...all].sort(), DISCOVERED, `${system} union`);
    assert.equal(new Set(all).size, all.length, `${system} has no file twice`);
  }
});

test('the manifest check refuses overlaps, unknown files, missing or extra rest shards and bad ids', () => {
  const files = ['repo/tests/a.test.cjs', 'repo/tests/b.test.cjs', 'repo/tests/c.test.cjs'];
  const base = {
    schema: shards.MANIFEST_SCHEMA,
    systems: {
      linux: { shards: [{ id: 'linux-1', files: ['repo/tests/a.test.cjs'] }, { id: 'linux-2', rest: true }] },
      windows: { shards: [{ id: 'windows-1', files: ['repo/tests/b.test.cjs'] }, { id: 'windows-2', rest: true }] },
    },
  };
  assert.deepEqual(shards.manifestErrors(base, files), []);
  const cases = [
    ['a file in two shards', (m) => m.systems.linux.shards.splice(1, 0, { id: 'linux-3', files: ['repo/tests/a.test.cjs'] }), /in both linux-1 and linux-3/],
    ['an unknown file', (m) => m.systems.linux.shards[0].files.push('repo/tests/gone.test.cjs'), /not a discovered test file/],
    ['no rest shard', (m) => { m.systems.windows.shards[1] = { id: 'windows-2', files: ['repo/tests/c.test.cjs'] }; }, /exactly one shard must be the rest shard \(found 0\)/],
    ['two rest shards', (m) => m.systems.windows.shards.push({ id: 'windows-3', rest: true }), /found 2/],
    ['an empty rest shard', (m) => { m.systems.linux.shards[0].files = [...files]; }, /rest shard is empty/],
    ['an empty named shard', (m) => { m.systems.linux.shards[0].files = []; }, /files must be a non-empty list/],
    ['a wrong system prefix', (m) => { m.systems.linux.shards[0].id = 'windows-9'; }, /id must look like linux-<n>/],
    ['a repeated id', (m) => { m.systems.linux.shards[1].id = 'linux-1'; }, /appears twice/],
    ['an extra key', (m) => { m.systems.linux.shards[0].filter = 'x'; }, /only id and files/],
    ['a rest shard with files', (m) => { m.systems.linux.shards[1].files = ['repo/tests/c.test.cjs']; }, /only id and rest/],
    ['a missing system', (m) => { delete m.systems.windows; }, /exactly linux and windows/],
    ['a wrong schema', (m) => { m.schema = 'v0'; }, /schema must be/],
  ];
  for (const [label, mutate, pattern] of cases) {
    const manifest = clone(base);
    mutate(manifest);
    assert.match(shards.manifestErrors(manifest, files).join('\n'), pattern, label);
  }
  assert.deepEqual(shards.resolveShard(base, 'linux', 'linux-2', files), ['repo/tests/b.test.cjs', 'repo/tests/c.test.cjs']);
  assert.throws(() => shards.resolveShard(base, 'linux', 'linux-9', files), /Unknown shard "linux-9"/);
  assert.throws(() => shards.resolveShard(base, 'macos', 'linux-1', files), /Unknown system/);
});

test('discovery finds every *.test.cjs entry and every runner mode refuses one that would not run', (t) => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-test-names-'));
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const tests = path.join(work, 'repo', 'tests');
  fs.mkdirSync(tests, { recursive: true });
  fs.writeFileSync(path.join(tests, 'good.test.cjs'), '');
  fs.writeFileSync(path.join(tests, 'helper.cjs'), '');
  assert.deepEqual(shards.discoverTestFiles(work), ['repo/tests/good.test.cjs']);
  assert.deepEqual(shards.testFileErrors(work), []);

  fs.writeFileSync(path.join(tests, '_x.test.cjs'), '');
  fs.writeFileSync(path.join(tests, 'a b.test.cjs'), '');
  fs.mkdirSync(path.join(tests, 'folder.test.cjs'));
  // A junction on Windows (no admin right needed), a directory symlink elsewhere.
  fs.symlinkSync(path.join(work, 'repo'), path.join(tests, 'link.test.cjs'), 'junction');
  assert.deepEqual(shards.discoverTestFiles(work), ['repo/tests/_x.test.cjs', 'repo/tests/a b.test.cjs', 'repo/tests/good.test.cjs']);
  const errors = shards.testFileErrors(work);
  assert.equal(errors.length, 4);
  assert.match(errors.join('\n'), /repo\/tests\/_x\.test\.cjs needs a name/);
  assert.match(errors.join('\n'), /repo\/tests\/a b\.test\.cjs needs a name/);
  assert.match(errors.join('\n'), /repo\/tests\/folder\.test\.cjs is not a regular file/);
  assert.match(errors.join('\n'), /repo\/tests\/link\.test\.cjs is not a regular file/);

  for (const args of [['--plan'], ['--all'], ['--changed'], ['--shard', 'linux-1', '--os', 'linux'], ['repo/tests/good.test.cjs']]) {
    const out = sink();
    const err = sink();
    assert.equal(runner.main(args, { root: work, out, err }), 1, args.join(' '));
    assert.match(err.text(), /Rename or remove these entries in repo\/tests[\s\S]*_x\.test\.cjs/, args.join(' '));
  }
  // The CI aggregate check reports them too, next to its other errors.
  const err = sink();
  const previous = process.env.TEST_LEGS;
  fs.mkdirSync(path.join(work, 'repo', 'contracts', 'ci'), { recursive: true });
  fs.mkdirSync(path.join(work, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(work, 'repo', 'contracts', 'ci', 'test-shards.json'), JSON.stringify(MANIFEST));
  fs.writeFileSync(path.join(work, '.github', 'workflows', 'validate.yml'), WORKFLOW);
  try {
    process.env.TEST_LEGS = '{}';
    assert.equal(runner.main(['--verify-ci', path.join(work, 'none')], { root: work, out: sink(), err }), 1);
  } finally {
    if (previous === undefined) delete process.env.TEST_LEGS;
    else process.env.TEST_LEGS = previous;
  }
  assert.match(err.text(), /link\.test\.cjs is not a regular file/);
});

// A tiny manifest and passing leg summaries for it, to mutate one fault at a time.
function ciFixture() {
  const files = ['repo/tests/a.test.cjs', 'repo/tests/b.test.cjs', 'repo/tests/c.test.cjs'];
  const manifest = {
    schema: shards.MANIFEST_SCHEMA,
    systems: {
      linux: { shards: [{ id: 'linux-1', files: ['repo/tests/a.test.cjs'] }, { id: 'linux-2', rest: true }] },
      windows: { shards: [{ id: 'windows-1', rest: true }] },
    },
  };
  const entry = (file) => ({ file, tests: 2, passed: 2, failed: 0, skipped: 0, todo: 0, cancelled: 0, seconds: 1 });
  const summary = (system, shard, list) => ({ schema: shards.SUMMARY_SCHEMA, system, shard, exit_code: 0, files: list.map(entry), missing: [] });
  return {
    files,
    manifest,
    summaries: [
      summary('linux', 'linux-1', ['repo/tests/a.test.cjs']),
      summary('linux', 'linux-2', ['repo/tests/b.test.cjs', 'repo/tests/c.test.cjs']),
      summary('windows', 'windows-1', files),
    ],
    needs: { 'tests-linux': { result: 'success', outputs: {} }, 'tests-windows': { result: 'success', outputs: {} } },
  };
}

test('the CI aggregate check passes only when every leg succeeded and covered every file once', () => {
  const good = ciFixture();
  const ok = shards.verifyCiSummaries({ manifest: good.manifest, discovered: good.files, summaries: good.summaries, needs: good.needs });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.totals.linux.tests, 6);
  assert.equal(ok.totals.windows.files, 3);
  const cases = [
    ['a failed leg', (f) => { f.needs['tests-windows'].result = 'failure'; }, /tests-windows finished as failure/],
    ['a cancelled leg', (f) => { f.needs['tests-linux'].result = 'cancelled'; }, /finished as cancelled/],
    ['a skipped leg', (f) => { f.needs['tests-linux'].result = 'skipped'; }, /finished as skipped/],
    ['no leg results', (f) => { f.needs = null; }, /results \(needs\) are missing/],
    ['a missing summary', (f) => { f.summaries.splice(1, 1); }, /linux shard linux-2 has no summary/],
    ['a summary reported twice', (f) => { f.summaries.push(clone(f.summaries[0])); }, /reported twice/],
    ['an unknown shard', (f) => { f.summaries.push({ ...clone(f.summaries[0]), shard: 'linux-7' }); }, /linux-7 is not in the manifest/],
    ['a dropped file', (f) => { f.summaries[1].files.pop(); }, /no result for repo\/tests\/c\.test\.cjs/],
    ['a file run by the wrong shard', (f) => { f.summaries[0].files.push(clone(f.summaries[1].files[0])); }, /which the manifest gives to another shard/],
    ['a file with no tests', (f) => { f.summaries[2].files[0].tests = 0; }, /a\.test\.cjs ran no tests/],
    ['a failing test', (f) => { f.summaries[2].files[1].failed = 1; }, /1 failed and 0 cancelled/],
    ['a cancelled test', (f) => { f.summaries[2].files[1].cancelled = 1; }, /0 failed and 1 cancelled/],
    ['a non-zero leg exit', (f) => { f.summaries[0].exit_code = 1; }, /exited with 1/],
    ['an unknown summary schema', (f) => { f.summaries[0].schema = 'other'; }, /does not use toolkit-test-summary\/v1/],
    ['a new test file nobody ran', (f) => { f.files.push('repo/tests/d.test.cjs'); }, /d\.test\.cjs/],
  ];
  for (const [label, mutate, pattern] of cases) {
    const fixture = ciFixture();
    mutate(fixture);
    const { errors } = shards.verifyCiSummaries({ manifest: fixture.manifest, discovered: fixture.files, summaries: fixture.summaries, needs: fixture.needs });
    assert.match(errors.join('\n'), pattern, label);
  }
});

// The pinned uses: text of an action as it stands in a workflow. Found at run time, so the tests
// keep working on the live validate.yml after a Dependabot update changes its pins.
function pinOf(workflow, action) {
  const match = workflow.match(new RegExp(`${action}@[0-9a-f]{40} # v\\d+\\.\\d+\\.\\d+`));
  assert.ok(match, `${action} is pinned in the workflow`);
  return match[0];
}

// A stand-in commit SHA that differs from the one in a pin.
function otherSha(pin) {
  return pin.includes('@0123456789abcdef') ? 'fedcba9876543210fedcba9876543210fedcba98' : '0123456789abcdef0123456789abcdef01234567';
}

// Every pinned action of a workflow, in order of first use.
function pinnedActions(workflow) {
  return [...new Set([...workflow.matchAll(/^ {8}uses: ([^@\s]+)@/gm)].map((match) => match[1]))];
}

// The drift cases, run against the live workflow and against copies with updated pins.
function assertDriftGuard(WORKFLOW) {
  assert.deepEqual(shards.workflowErrors(WORKFLOW, MANIFEST), []);
  const shardStep = 'node repo/scripts/run-tests.cjs --shard ${{ matrix.shard }} --os windows';
  const verify = `          ${shards.VERIFY_COMMAND}`;
  const mutations = [
    ['a narrowed file list', WORKFLOW.replace(shardStep, 'node repo/scripts/run-tests.cjs repo/tests/skill-routing.test.cjs')],
    ['the runner replaced by node --test', WORKFLOW.replace(shardStep, 'node --test repo/tests/a.test.cjs')],
    ['a shard step that runs everything', WORKFLOW.replace(shardStep, 'node repo/scripts/run-tests.cjs --all')],
    ['a name filter', WORKFLOW.replace('--os linux', '--os linux --test-name-pattern=fast')],
    ['if: false on a step', WORKFLOW.replace('      - name: Run test shard\n', '      - name: Run test shard\n        if: false\n')],
    ['; exit 0', WORKFLOW.replace('test-summary-${{ matrix.shard }}.json"\n', 'test-summary-${{ matrix.shard }}.json"; exit 0\n')],
    ['|| true', WORKFLOW.replace('test-summary-${{ matrix.shard }}.json"\n', 'test-summary-${{ matrix.shard }}.json" || true\n')],
    ['continue-on-error', WORKFLOW.replace('    timeout-minutes: 30\n', '    timeout-minutes: 30\n    continue-on-error: true\n')],
    ['a matrix include', WORKFLOW.replace('        shard: [linux-1, linux-2]\n', '        shard: [linux-1, linux-2]\n        include:\n          - shard: linux-1\n')],
    ['a matrix exclude', WORKFLOW.replace('        shard: [linux-1, linux-2]\n', '        shard: [linux-1, linux-2]\n        exclude:\n          - shard: linux-2\n')],
    ['a shard dropped from the matrix', WORKFLOW.replace('[windows-1, windows-2, windows-3, windows-4]', '[windows-1, windows-2, windows-3]')],
    ['fail-fast turned on', WORKFLOW.replace('fail-fast: false', 'fail-fast: true')],
    ['the leg timeout removed', WORKFLOW.replace('    timeout-minutes: 30\n', '')],
    ['the aggregate no longer always runs', WORKFLOW.replace('    if: ${{ always() }}\n', '')],
    ['the aggregate skipped on failure', WORKFLOW.replace('if: ${{ always() }}', 'if: ${{ success() }}')],
    ['the aggregate not waiting for Windows', WORKFLOW.replace('needs: [tests-linux, tests-windows, hook-pack, personal-data]', 'needs: [tests-linux, hook-pack, personal-data]')],
    ['the aggregate not waiting for the personal-data check', WORKFLOW.replace('needs: [tests-linux, tests-windows, hook-pack, personal-data]', 'needs: [tests-linux, tests-windows, hook-pack]')],
    ['the personal-data check narrowed to one mode', WORKFLOW.replace('personal-data-guard.cjs ci', 'personal-data-guard.cjs pr')],
    ['the personal-data check on a shallow clone', WORKFLOW.replace(/(\n  personal-data:\n[\s\S]*?)fetch-depth: 0/, '$1fetch-depth: 1')],
    ['the personal-data job removed', WORKFLOW.replace(/\n  personal-data:\n[\s\S]*?(?=\n  validate:\n)/, '')],
    ['the hook pack job removed', WORKFLOW.replace(/\n  hook-pack:\n[\s\S]*?(?=\n  personal-data:\n)/, '')],
    ['the hook pack dropped on Windows', WORKFLOW.replace('os: [ubuntu-latest, windows-latest]', 'os: [ubuntu-latest]')],
    ['the hook pack budget removed', WORKFLOW.replace(' run --budget-seconds 360', ' run')],
    ['the aggregate not waiting for the hook pack', WORKFLOW.replace('needs: [tests-linux, tests-windows, hook-pack, personal-data]', 'needs: [tests-linux, tests-windows, personal-data]')],
    ['the summary check removed', WORKFLOW.replace(`\n${verify}`, '')],
    ['the summary check not last', WORKFLOW.replace(`\n${verify}`, '').replace('          node repo/scripts/validate-toolkit.cjs\n', `          node repo/scripts/validate-toolkit.cjs\n${verify}\n`)],
    ['the leg results not passed in', WORKFLOW.replace('          TEST_LEGS: ${{ toJSON(needs) }}\n', '')],
    ['a step before Run validation', WORKFLOW.replace('          python-version: \'3.12\'\n\n      # The one', '          python-version: \'3.12\'\n\n      - name: Extra\n        run: echo hi\n\n      # The one')],
    ['a condition on the gate step', WORKFLOW.replace('      - name: Run validation\n', '      - name: Run validation\n        if: ${{ github.event_name == \'push\' }}\n')],
    ['an extra job', `${WORKFLOW}\n  extra:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n`],
    ['a test job removed', WORKFLOW.replace(/\n  tests-windows:\n[\s\S]*?(?=\n  validate:\n)/, '')],
  ];
  for (const [label, mutated] of mutations) {
    assert.notEqual(mutated, WORKFLOW, `${label} must change the workflow`);
    assert.notDeepEqual(shards.workflowErrors(mutated, MANIFEST), [], `the drift guard must reject ${label}`);
  }
  // The whole file is pinned, with only the gate command list read from it. Each of these is refused
  // by the whole-file comparison or the plain command check, not only by the forbidden-pattern list.
  const gateStep = '      - name: Run validation\n';
  const firstCommand = '        run: |\n          node repo/scripts/sync-repo-doc-contract.cjs --check\n';
  const validateMutations = [
    ['a custom shell that drops bash -e', WORKFLOW.replace(gateStep, `${gateStep}        shell: bash {0}\n`)],
    ['set +e before the gate commands', WORKFLOW.replace(firstCommand, firstCommand.replace('run: |\n', 'run: |\n          set +e\n'))],
    ['|| echo on a gate command', WORKFLOW.replace('          node repo/scripts/validate-toolkit.cjs\n', '          node repo/scripts/validate-toolkit.cjs || echo skipped\n')],
    ['; : after a gate command', WORKFLOW.replace('          node repo/scripts/audit-fallback-risk.cjs\n', '          node repo/scripts/audit-fallback-risk.cjs; :\n')],
    ['two commands on one line', WORKFLOW.replace('          node repo/scripts/audit-fallback-risk.cjs\n', '          node repo/scripts/audit-fallback-risk.cjs; node repo/scripts/validate-toolkit.cjs\n')],
    ['a gate command that is not a repository script', WORKFLOW.replace('          node repo/scripts/audit-fallback-risk.cjs\n', '          npx some-tool\n')],
    ['a gate command with a shell expansion', WORKFLOW.replace('          node repo/scripts/audit-fallback-risk.cjs\n', '          node repo/scripts/audit-fallback-risk.cjs $(echo --skip)\n')],
    ['the summary check run earlier as well', WORKFLOW.replace('          node repo/scripts/validate-toolkit.cjs\n', `          node repo/scripts/validate-toolkit.cjs\n${verify}\n`)],
    ['an unnamed step before Run validation', WORKFLOW.replace(`      # The one gate list`, '      - run: echo hi\n\n      # The one gate list')],
    ['the summaries not merged', WORKFLOW.replace('          merge-multiple: true', '          merge-multiple: false')],
    ['the summaries downloaded elsewhere', WORKFLOW.replace('          path: ${{ runner.temp }}/test-summaries', '          path: ${{ runner.temp }}/other')],
    ['a different download action', WORKFLOW.replace(pinOf(WORKFLOW, 'actions/download-artifact'), 'actions/download-artifact@v8')],
    ['the diff base removed', WORKFLOW.replace('          DIFF_BASE: ${{ github.event.pull_request.base.sha || github.event.before }}\n', '')],
    ['a shallow checkout in validate', WORKFLOW.replace(/(\n  validate:\n[\s\S]*?)fetch-depth: 0/, '$1fetch-depth: 1')],
    ['an extra env value on the gate step', WORKFLOW.replace('          TEST_LEGS: ${{ toJSON(needs) }}\n', '          TEST_LEGS: ${{ toJSON(needs) }}\n          NODE_OPTIONS: --require ./x.cjs\n')],
    // A column-0 comment does not end a job in YAML, so lines after it still belong to the step or job.
    ['a comment, then a condition that skips the gate step', `${WORKFLOW}#\n        if: github.run_attempt == 0\n`],
    ['a comment, then a quoted shell key', `${WORKFLOW}#\n        "shell": bash {0}\n`],
    ['a comment, then an escaped shell key', `${WORKFLOW}#\n        "\\x73hell": bash {0}\n`],
    ['a comment, then a job-level env value', `${WORKFLOW}#\n    env:\n      NODE_OPTIONS: --require ./x.cjs\n`],
    ['a comment line between gate commands', WORKFLOW.replace('          node repo/scripts/validate-toolkit.cjs\n', '          node repo/scripts/validate-toolkit.cjs\n# note\n')],
    ['a flow-style workflow default shell', WORKFLOW.replace('\njobs:\n', '\ndefaults: { run: { shell: "bash {0}" } }\njobs:\n')],
    ['a block-style workflow default shell with a quoted key', WORKFLOW.replace('\njobs:\n', '\ndefaults:\n  run:\n    "shell": bash {0}\njobs:\n')],
    ['a block-style workflow default shell', WORKFLOW.replace('\njobs:\n', '\ndefaults:\n  run:\n    shell: bash {0}\n\njobs:\n')],
    ['a workflow-wide env value', WORKFLOW.replace('\njobs:\n', '\nenv:\n  NODE_OPTIONS: --require ./x.cjs\njobs:\n')],
    ['wider permissions', WORKFLOW.replace('  contents: read\n', '  contents: write\n')],
    ['another trigger', WORKFLOW.replace('  pull_request:\n', '  pull_request:\n  workflow_dispatch:\n')],
  ];
  for (const [label, mutated] of validateMutations) {
    assert.notEqual(mutated, WORKFLOW, `${label} must change the workflow`);
    const errors = shards.workflowErrors(mutated, MANIFEST);
    assert.ok(errors.some((error) => !error.startsWith('validate.yml must not contain')), `the whole-file pin or the plain command check must reject ${label} (got: ${errors.join('; ') || 'nothing'})`);
  }
  // The forbidden-pattern list is a second line of defence and catches the usual spellings by itself.
  for (const text of ['shell: bash {0}', '"shell": bash {0}', "{ 'shell': bash }"]) {
    assert.match(shards.workflowErrors(`${WORKFLOW}# ${text}\n`, MANIFEST).join('\n'), /must not contain a shell: setting/, text);
  }
  for (const [label, text] of [['set +e', 'set +e'], ['|| echo', 'x || echo ok']]) {
    assert.match(shards.workflowErrors(`${WORKFLOW}# ${text}\n`, MANIFEST).join('\n'), /must not contain/, label);
  }
  // A new gate check is one plain line in validate.yml and needs no change to the guard.
  const added = WORKFLOW.replace('          node repo/scripts/check-diff-whitespace.cjs\n', '          node repo/scripts/check-diff-whitespace.cjs\n          node repo/scripts/new-check.cjs --check --root=repo/docs\n');
  assert.notEqual(added, WORKFLOW);
  assert.deepEqual(shards.workflowErrors(added, MANIFEST), []);
  assert.deepEqual(shards.workflowErrors(WORKFLOW.replace(/\n/g, '\r\n'), MANIFEST), [], 'a CRLF checkout still matches');
  // A manifest shard that the workflow matrix does not run is drift too.
  const manifest = clone(MANIFEST);
  manifest.systems.linux.shards.splice(1, 0, { id: 'linux-9', files: [manifest.systems.linux.shards[0].files.pop()] });
  assert.match(shards.workflowErrors(WORKFLOW, manifest).join('\n'), /tests-linux job differs/);
}

// A pin update of the same action passes; nothing else on that line does.
function assertPinUpdates(WORKFLOW) {
  const pin = pinOf(WORKFLOW, 'actions/setup-python');
  const newer = `actions/setup-python@${otherSha(pin)} # v7.2.0`;
  const everywhere = WORKFLOW.split(pin).join(newer);
  assert.deepEqual(shards.workflowErrors(everywhere, MANIFEST), [], 'every copy of the pin updated');
  assert.deepEqual(shards.workflowErrors(WORKFLOW.replace(pin, newer), MANIFEST), [], 'one copy of the pin updated');
  assert.deepEqual(shards.workflowErrors(everywhere.replace(/\n/g, '\r\n'), MANIFEST), [], 'a CRLF checkout with an update');
  const rejected = [
    ['a different action', 'evil/setup-python@0123456789abcdef0123456789abcdef01234567 # v7.2.0'],
    ['a renamed action', 'actions/setup-pythons@0123456789abcdef0123456789abcdef01234567 # v7.2.0'],
    ['a short SHA', 'actions/setup-python@0123456 # v7.2.0'],
    ['a ref that is not hex', 'actions/setup-python@0123456789abcdef0123456789abcdef0123456z # v7.2.0'],
    ['an upper-case SHA', 'actions/setup-python@0123456789ABCDEF0123456789ABCDEF01234567 # v7.2.0'],
    ['a tag ref', 'actions/setup-python@v7 # v7.2.0'],
    ['a branch ref', 'actions/setup-python@main'],
    ['a removed version comment', 'actions/setup-python@0123456789abcdef0123456789abcdef01234567'],
    ['a version comment that is not a version', 'actions/setup-python@0123456789abcdef0123456789abcdef01234567 # latest'],
    ['text after the version comment', 'actions/setup-python@0123456789abcdef0123456789abcdef01234567 # v7.2.0 with: x'],
  ];
  for (const [label, line] of rejected) {
    assert.match(shards.workflowErrors(WORKFLOW.replace(pin, line), MANIFEST).join('\n'), /differs from its pinned text/, label);
  }
  // A pin update does not excuse another edit beside it.
  const unmerged = everywhere.replace('          merge-multiple: true', '          merge-multiple: false');
  assert.match(shards.workflowErrors(unmerged, MANIFEST).join('\n'), /differs from its pinned text/, 'a pin update beside another edit');
  const moved = WORKFLOW.replace(`        uses: ${pin}\n`, `          uses: ${newer}\n`);
  assert.match(shards.workflowErrors(moved, MANIFEST).join('\n'), /differs from its pinned text/, 'a re-indented pin line');
  const swapped = WORKFLOW.replace(`uses: ${pin}`, 'uses: actions/checkout@0123456789abcdef0123456789abcdef01234567 # v7.2.0');
  assert.match(shards.workflowErrors(swapped, MANIFEST).join('\n'), /differs from its pinned text/, 'another action in place of a pinned one');
}

test('the workflow drift guard accepts validate.yml and rejects each way to narrow or mask a test step', () => {
  assertDriftGuard(WORKFLOW);
});

test('the workflow drift guard accepts a Dependabot pin update of the same action and nothing else on that line', () => {
  assertPinUpdates(WORKFLOW);
});

test('after a Dependabot update of any pinned action in validate.yml, the whole drift set still holds', () => {
  const actions = pinnedActions(WORKFLOW);
  for (const action of ['actions/checkout', 'actions/setup-node', 'actions/setup-python', 'actions/upload-artifact', 'actions/download-artifact']) {
    assert.ok(actions.includes(action), `${action} is one of the pinned actions`);
  }
  const updated = (workflow, action) => {
    const pin = pinOf(workflow, action);
    return workflow.split(pin).join(`${action}@${otherSha(pin)} # v99.1.0`);
  };
  const variants = actions.map((action) => [action, updated(WORKFLOW, action)]);
  variants.push(['every pinned action', actions.reduce(updated, WORKFLOW)]);
  for (const [label, workflow] of variants) {
    assert.notEqual(workflow, WORKFLOW, `${label} must change the workflow`);
    assert.deepEqual(shards.workflowErrors(workflow, MANIFEST), [], label);
    assertDriftGuard(workflow);
    assertPinUpdates(workflow);
  }
});

test('the runner refuses unknown shards, a shard for another system, mixed modes and a drive-root temp folder', () => {
  const system = shards.platformSystem();
  const other = system === 'windows' ? 'linux' : 'windows';
  const run = (args) => {
    const out = sink();
    const err = sink();
    return { code: runner.main(args, { root: ROOT, out, err }), text: out.text() + err.text() };
  };
  let result = run(['--shard', `${system}-99`, '--os', system]);
  assert.equal(result.code, 2);
  assert.match(result.text, /Unknown shard/);
  result = run(['--shard', `${other}-1`, '--os', other]);
  assert.equal(result.code, 2);
  assert.match(result.text, /does not match this machine/);
  result = run(['--shard', `${system}-1`]);
  assert.equal(result.code, 2);
  assert.match(result.text, /needs --os/);
  result = run(['--all', '--changed']);
  assert.equal(result.code, 2);
  result = run(['repo/tests/not-a-test.cjs']);
  assert.equal(result.code, 2);
  assert.match(result.text, /Not a test file/);
  const fsRoot = path.parse(os.homedir()).root;
  assert.match(runner.tempRootError(fsRoot), /drive root/);
  assert.match(runner.tempRootError(path.join(fsRoot, 't')), /drive root/);
  assert.equal(runner.tempRootError(path.join(os.homedir(), 't')), null);
  assert.deepEqual(runner.parseArgs([]).mode, 'changed');
});

test('a run uses its own temp folder under the user profile, for every child, and removes it even when tests fail', (t) => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-run-tests-'));
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const record = path.join(work, 'record.json');
  const passing = path.join(work, 'pass.test.cjs');
  const failing = path.join(work, 'fail.test.cjs');
  const broken = path.join(work, 'broken.test.cjs');
  fs.writeFileSync(passing, [
    "const test = require('node:test');",
    "const fs = require('node:fs');",
    "const os = require('node:os');",
    "const { spawnSync } = require('node:child_process');",
    "test('records its temp folder', () => {",
    "  const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(require(\"node:os\").tmpdir())'], { encoding: 'utf8' });",
    "  fs.writeFileSync(process.env.RUN_TESTS_RECORD, JSON.stringify({ tmpdir: os.tmpdir(), TEMP: process.env.TEMP, TMP: process.env.TMP, child: child.stdout, real: process.env.TOOLKIT_TEST_REAL_TEMP }));",
    '});',
  ].join('\n'));
  fs.writeFileSync(failing, "require('node:test')('fails', () => { throw new Error('expected failure'); });\n");
  fs.writeFileSync(broken, "throw new Error('does not load');\n");
  const home = fs.realpathSync.native(os.homedir());
  const env = { ...process.env, RUN_TESTS_RECORD: record };
  delete env.TOOLKIT_TEST_REAL_TEMP;
  delete env.NODE_TEST_CONTEXT; // the inner node --test is a fresh run, not a file of this one
  const make = () => new runner.TestRun({ root: ROOT, system: shards.platformSystem(), tempRoot: path.join(os.homedir(), 't'), env, stdio: 'ignore', out: sink(), err: sink() });

  const pass = make();
  const passed = pass.run([passing], { concurrency: 1 });
  assert.equal(passed.exitCode, 0);
  assert.equal(passed.summary.files[0].tests, 1);
  const seen = JSON.parse(fs.readFileSync(record, 'utf8'));
  assert.equal(seen.tmpdir, pass.folder);
  assert.equal(seen.TEMP, pass.folder);
  assert.equal(seen.TMP, pass.folder);
  assert.equal(seen.child, pass.folder, 'a grandchild process inherits the run folder');
  assert.equal(seen.real, os.tmpdir(), 'the temp guard is told the real temp folder');
  assert.ok(pass.folder.startsWith(path.join(home, 't') + path.sep), `${pass.folder} is under ${path.join(home, 't')}`);
  assert.doesNotMatch(pass.folder, /~\d/, 'never an 8.3 short name');
  assert.equal(fs.existsSync(pass.folder), false, 'the run folder is gone after the run');

  const fail = make();
  const failed = fail.run([failing, broken], { concurrency: 1 });
  assert.notEqual(failed.exitCode, 0);
  assert.equal(failed.summary.files.find((entry) => entry.file.endsWith('fail.test.cjs')).failed, 1);
  assert.equal(failed.summary.missing.length, 1, 'a file that does not load has no result');
  assert.equal(fs.existsSync(fail.folder), false, 'the run folder is gone after a failing run');
});

test('the next run removes marked run folders an interrupted run left more than a day ago, and nothing else', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-run-cleanup-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-run-elsewhere-'));
  t.after(() => fs.rmSync(elsewhere, { recursive: true, force: true }));
  const now = Date.UTC(2026, 9, 23);
  const day = 24 * 60 * 60 * 1000;
  const old = path.join(tempRoot, 'run-old-xxxx');
  const recent = path.join(tempRoot, 'run-new-xxxx');
  const boundary = path.join(tempRoot, 'run-day-xxxx');
  const unmarked = path.join(tempRoot, 'run-someone-else');
  const markerFolder = path.join(tempRoot, 'run-marker-is-a-folder');
  const keep = path.join(tempRoot, 'keep-me');
  const review = path.join(tempRoot, 'g2-589-52b6318');
  const file = path.join(tempRoot, 'run-file.txt');
  const link = path.join(tempRoot, 'run-link-xxxx');
  for (const folder of [old, recent, boundary, unmarked, markerFolder, keep, review]) fs.mkdirSync(folder);
  for (const folder of [old, recent, boundary, elsewhere]) fs.writeFileSync(path.join(folder, runner.RUN_MARKER), '{}\n');
  fs.mkdirSync(path.join(markerFolder, runner.RUN_MARKER));
  fs.writeFileSync(path.join(elsewhere, 'precious.txt'), 'keep');
  fs.symlinkSync(elsewhere, link, process.platform === 'win32' ? 'junction' : 'dir');
  fs.writeFileSync(file, 'keep');
  const aged = new Date(now - day - 1000);
  for (const item of [old, unmarked, markerFolder, keep, review, file, elsewhere]) fs.utimesSync(item, aged, aged);
  fs.lutimesSync(link, aged, aged);
  fs.utimesSync(recent, new Date(now), new Date(now));
  fs.utimesSync(boundary, new Date(now - day), new Date(now - day));
  const err = sink();
  const run = new runner.TestRun({ root: ROOT, system: shards.platformSystem(), tempRoot, now: () => now, out: sink(), err });
  const folder = run.createFolder();
  assert.equal(fs.existsSync(old), false, 'a marked folder more than a day old is removed');
  const kept = [recent, boundary, unmarked, markerFolder, keep, review, file, link, path.join(elsewhere, 'precious.txt'), folder];
  for (const item of kept) assert.equal(fs.existsSync(item), true, item);
  assert.equal(fs.lstatSync(path.join(folder, runner.RUN_MARKER)).isFile(), true, 'the new run folder carries the marker');
  const reported = err.text();
  for (const item of [unmarked, markerFolder]) assert.ok(reported.includes(`Left ${item} alone: it has no test-runner marker`), reported);
  for (const item of [keep, review, file, link, recent, boundary]) assert.ok(!reported.includes(item), `${item} is not reported`);
  assert.equal(run.removeFolder(), true);
  assert.deepEqual(run.leftBehind, [], 'the marker and results file are not counted as left behind');
  assert.equal(fs.existsSync(folder), false);
  for (const item of kept.slice(0, -1)) assert.equal(fs.existsSync(item), true, item);
});

test('a run fails and names what its tests left behind, also when the tests failed', (t) => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-run-leftovers-'));
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const leaky = path.join(work, 'leaky.test.cjs');
  const leakyFail = path.join(work, 'leaky-fail.test.cjs');
  const tidy = path.join(work, 'tidy.test.cjs');
  const leak = (name, fail) => [
    "const test = require('node:test');",
    "const fs = require('node:fs');",
    "const os = require('node:os');",
    "const path = require('node:path');",
    `test('leaves ${name}', () => { fs.mkdtempSync(path.join(os.tmpdir(), '${name}-'));${fail ? " throw new Error('expected failure');" : ''} });`,
  ].join('\n');
  fs.writeFileSync(leaky, leak('leaky-item', false));
  fs.writeFileSync(leakyFail, leak('leaky-fail-item', true));
  fs.writeFileSync(tidy, [
    "const test = require('node:test');",
    "const fs = require('node:fs');",
    "const os = require('node:os');",
    "const path = require('node:path');",
    "test('cleans up', (t) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tidy-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); });",
  ].join('\n'));
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const make = (err) => new runner.TestRun({ root: ROOT, system: shards.platformSystem(), tempRoot: path.join(work, 'temp'), env, stdio: 'ignore', out: sink(), err });

  const clean = make(sink());
  assert.equal(clean.run([tidy], { concurrency: 1 }).exitCode, 0, 'nothing left: the run passes');
  assert.deepEqual(clean.leftBehind, []);

  const passErr = sink();
  const passing = make(passErr);
  const passed = passing.run([leaky], { concurrency: 1 });
  assert.equal(passed.summary.files[0].failed, 0, 'the test itself passed');
  assert.equal(passed.exitCode, 1, 'a passing run that left temp behind fails');
  assert.equal(passed.summary.exit_code, 1, 'the summary records the failed result');
  assert.equal(passing.leftBehind.length, 1);
  assert.match(passing.leftBehind[0], /^leaky-item-/);
  assert.match(passErr.text(), /Tests left 1 temp item\(s\) behind: leaky-item-/);
  assert.equal(fs.existsSync(passing.folder), false, 'the leftover goes with the run folder');

  const failErr = sink();
  const failing = make(failErr);
  const failed = failing.run([leakyFail], { concurrency: 1 });
  assert.notEqual(failed.exitCode, 0);
  assert.equal(failed.summary.files[0].failed, 1, 'the test failure is still reported');
  assert.match(failErr.text(), /Tests left 1 temp item\(s\) behind: leaky-fail-item-/);
  assert.equal(fs.existsSync(failing.folder), false);
});

test('a run folder that cannot be removed is reported without throwing', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-run-removal-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const err = sink();
  const run = new runner.TestRun({ root: ROOT, system: shards.platformSystem(), tempRoot, out: sink(), err });
  const folder = run.createFolder();
  const rmSync = fs.rmSync;
  try {
    fs.rmSync = (target, options) => {
      if (target === folder) throw Object.assign(new Error('held open'), { code: 'EBUSY' });
      return rmSync(target, options);
    };
    assert.doesNotThrow(() => assert.equal(run.removeFolder(), false));
  } finally {
    fs.rmSync = rmSync;
  }
  assert.equal(err.text(), `Could not remove the test temp folder ${folder}. The next run removes it once it is more than a day old and no longer held open.\n`);
});

test('local runs pick the test files a change affects', () => {
  const discovered = ['repo/tests/a.test.cjs', 'repo/tests/b.test.cjs', 'repo/tests/c.test.cjs'];
  const texts = { 'repo/tests/a.test.cjs': "require('../scripts/tool.cjs')", 'repo/tests/b.test.cjs': '', 'repo/tests/c.test.cjs': 'reads docs/GUIDE.md' };
  const picked = shards.affectedTestFiles(['repo/scripts/tool.cjs', 'repo/tests/b.test.cjs', 'docs/GUIDE.md', 'README.md'], discovered, (file) => texts[file]);
  assert.deepEqual(picked, [
    { file: 'repo/tests/a.test.cjs', reason: 'names repo/scripts/tool.cjs' },
    { file: 'repo/tests/b.test.cjs', reason: 'changed' },
    { file: 'repo/tests/c.test.cjs', reason: 'names docs/GUIDE.md' },
  ]);
  assert.deepEqual(shards.affectedTestFiles(['README.md'], discovered, (file) => texts[file]), []);
});

test('the duration check reports without a budget and fails files over a declared or raised budget', () => {
  const { checkDurations, readReport } = require('../scripts/check-test-durations.cjs');
  const report = readReport({ schema: 'toolkit-test-durations/v1', system: 'windows', files: { 'repo/tests/a.test.cjs': 50, 'repo/tests/b.test.cjs': 5 } });
  const summary = readReport({ schema: shards.SUMMARY_SCHEMA, system: 'linux', files: [{ file: 'repo/tests/a.test.cjs', seconds: 12 }] });
  assert.deepEqual(summary.files, { 'repo/tests/a.test.cjs': 12 });
  assert.throws(() => readReport({ schema: 'other', system: 'linux', files: {} }), /not a run-tests\.cjs/);

  let result = checkDurations([report], undefined);
  assert.deepEqual(result.errors, []);
  assert.match(result.lines[0], /no budget set; slowest files: a\.test\.cjs 50 s/);
  result = checkDurations([report], { seconds_per_file: { windows: 30 } });
  assert.match(result.errors.join('\n'), /a\.test\.cjs took 50 s, over its 30 s budget/);
  result = checkDurations([report], { seconds_per_file: { windows: 30 }, raised: { 'windows:repo/tests/a.test.cjs': { seconds: 60, reason: 'copies a whole workspace per case' } } });
  assert.deepEqual(result.errors, []);
  result = checkDurations([report], { seconds_per_file: { windows: 30 }, raised: { 'windows:repo/tests/a.test.cjs': { seconds: 60, reason: '' } } });
  assert.match(result.errors.join('\n'), /needs a recorded reason/);
  result = checkDurations([report], { seconds_per_file: { windows: -1 } });
  assert.match(result.errors.join('\n'), /must be a positive number/);
});

test('the CI duration check reads the downloaded shard summaries and never passes on none', (t) => {
  const { ciReportFiles, main } = require('../scripts/check-test-durations.cjs');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'durations-ci-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const sink = () => { let text = ''; return { write: (chunk) => { text += chunk; }, text: () => text }; };
  assert.throws(() => ciReportFiles({}), /needs RUNNER_TEMP/);
  assert.throws(() => ciReportFiles({ RUNNER_TEMP: temp }), /no shard summaries/);
  let err = sink();
  assert.equal(main(['--ci'], { out: sink(), err, env: { RUNNER_TEMP: temp } }), 2);
  assert.match(err.text(), /could not run: no shard summaries/);
  assert.equal(main(['--ci', 'extra.json'], { out: sink(), err: sink(), env: { RUNNER_TEMP: temp } }), 2);
  const dir = path.join(temp, 'test-summaries');
  fs.mkdirSync(dir);
  const summary = (system, seconds) => ({ schema: shards.SUMMARY_SCHEMA, system, exit_code: 0, node: 'v22', files: [{ file: 'repo/tests/a.test.cjs', seconds }], missing: [] });
  fs.writeFileSync(path.join(dir, 'test-summary-linux-1.json'), JSON.stringify(summary('linux', 1)));
  fs.writeFileSync(path.join(dir, 'test-summary-windows-1.json'), JSON.stringify(summary('windows', 1)));
  assert.deepEqual(ciReportFiles({ RUNNER_TEMP: temp }).map((file) => path.basename(file)), ['test-summary-linux-1.json', 'test-summary-windows-1.json']);
  const out = sink();
  assert.equal(main(['--ci'], { out, err: sink(), env: { RUNNER_TEMP: temp } }), 0);
  assert.match(out.text(), /linux: 1 file\(s\) checked against \d+ s per file/);
  fs.writeFileSync(path.join(dir, 'test-summary-windows-1.json'), JSON.stringify(summary('windows', 100000)));
  err = sink();
  assert.equal(main(['--ci'], { out: sink(), err, env: { RUNNER_TEMP: temp } }), 1);
  assert.match(err.text(), /windows: repo\/tests\/a\.test\.cjs took 100000 s, over its \d+ s budget/);
});

test('this repository declares a valid per-file budget for every system', () => {
  // The CI duration check enforces it on each run's own times; recorded times can be from a slower run.
  const { checkDurations } = require('../scripts/check-test-durations.cjs');
  const manifest = shards.loadManifest(ROOT);
  for (const system of shards.SYSTEMS) assert.equal(typeof manifest.budgets.seconds_per_file[system], 'number', system);
  assert.deepEqual(checkDurations([], manifest.budgets).errors, []);
});

test('shard files run longest first and the estimate models the concurrency slots', () => {
  const durations = { 'x': 10, 'y': 30, 'z': 20 };
  assert.deepEqual(shards.runOrder(['x', 'y', 'w', 'z'], durations), ['y', 'z', 'x', 'w']);
  assert.equal(shards.estimateShardSeconds(['x', 'y', 'z'], durations, 3), 30);
  assert.equal(shards.estimateShardSeconds(['x', 'y', 'z'], durations, 1), 60);
  assert.equal(shards.estimateShardSeconds(['x', 'y', 'z'], durations, 2), 30);
});
