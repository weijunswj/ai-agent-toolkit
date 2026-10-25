'use strict';

// Default-branch protection (toolkit-governance-protection.cjs): required checks match the binding
// and are pinned (P1, P2), one workflow job produces each and cannot mask a failure (P3, P4), and
// merge commits only (P5); GitHub unreadable is unverified, never conformant; the ruleset Toolkit
// writes is the one the check accepts; and the check reads only.

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const scripts = path.join(__dirname, '..', 'scripts');
const protection = require(path.join(scripts, 'toolkit-governance-protection.cjs'));

const AGGREGATE = [
  'name: CI',
  'on:',
  '  pull_request:',
  '  push:',
  '    branches:',
  '      - main',
  'jobs:',
  '  tests:',
  '    runs-on: ubuntu-latest',
  '    strategy:',
  '      matrix:',
  '        shard: [1, 2]',
  '  validate:  # the required check',
  '    needs: [tests]',
  "    if: ${{ always() }}",
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - name: Verify',
  '        env:',
  '          TEST_LEGS: ${{ toJSON(needs) }}',
  '        run: node repo/scripts/run-tests.cjs --verify-ci summaries  # fails unless every leg passed',
  '',
].join('\n');

function repo(t, workflows = { 'ci.yml': AGGREGATE }, remote = 'https://github.com/example-owner/example-repo.git') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-protection-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  childProcess.execFileSync('git', ['init', '--quiet', root], { windowsHide: true });
  if (remote) childProcess.execFileSync('git', ['-C', root, 'remote', 'add', 'origin', remote], { windowsHide: true });
  fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
  for (const [name, text] of Object.entries(workflows)) fs.writeFileSync(path.join(root, '.github', 'workflows', name), text);
  return root;
}

function github({ checks = [{ context: 'validate', integration_id: 15368 }], methods = ['merge'], classic = null, settings = { allow_merge_commit: true, allow_squash_merge: true, allow_rebase_merge: true }, own = null } = {}) {
  const rules = [];
  if (methods !== null) rules.push({ type: 'pull_request', ruleset_id: 7, parameters: { allowed_merge_methods: methods } });
  if (checks.length) rules.push({ type: 'required_status_checks', ruleset_id: 7, parameters: { required_status_checks: checks } });
  return () => ({ ok: true, default_branch: 'main', repository: settings, rules, classic, toolkit_ruleset: own });
}

function check(root, reader = github(), extra = {}) {
  return protection.defaultBranchProtection(root, { requiredChecks: ['validate'], reader, ...extra });
}

function statuses(result) {
  return Object.fromEntries(Object.entries(result.checks).map(([id, entry]) => [id, entry.status]).sort());
}

test('P-01: binding checks required, pinned, one producer, aggregate reads its needs, merge only: conformant', (t) => {
  const result = check(repo(t));
  assert.equal(result.status, 'conformant');
  assert.deepEqual(statuses(result), { P1: 'ok', P2: 'ok', P3: 'ok', P4: 'ok', P5: 'ok' });
});

test('P-02: P1 drifts on a missing or an extra required check, from rulesets or classic protection', (t) => {
  const root = repo(t);
  assert.deepEqual(check(root, github({ checks: [] })).checks.P1.missing, ['validate']);
  const extra = check(root, github({ checks: [{ context: 'validate', integration_id: 15368 }, { context: 'lint', integration_id: 15368 }] }));
  assert.equal(extra.status, 'drift');
  assert.deepEqual(extra.checks.P1.extra, ['lint']);
  // Classic branch protection is read and merged with the rulesets.
  const classic = check(root, github({ checks: [], classic: { checks: [{ context: 'validate', app_id: 15368 }] } }));
  assert.equal(classic.checks.P1.status, 'ok');
  const classicExtra = check(root, github({ classic: { checks: [{ context: 'build', app_id: 15368 }] } }));
  assert.deepEqual(classicExtra.checks.P1.extra, ['build']);
});

test('P-03: P2 drifts on a required check that any source can satisfy', (t) => {
  const root = repo(t);
  const unpinned = check(root, github({ checks: [{ context: 'validate' }] }));
  assert.equal(unpinned.checks.P2.status, 'drift');
  assert.match(unpinned.checks.P2.details[0], /"validate" \(ruleset 7\) is not pinned/);
  // Pinned in a ruleset but unpinned in classic protection is still unpinned.
  const mixed = check(root, github({ classic: { checks: [{ context: 'validate', app_id: null }] } }));
  assert.equal(mixed.checks.P2.status, 'drift');
});

test('P-04: P3 drifts when no job or several jobs produce the required name', (t) => {
  const none = check(repo(t, { 'ci.yml': AGGREGATE.replace('  validate:  # the required check', '  verify:') }));
  assert.equal(none.checks.P3.status, 'drift');
  assert.match(none.checks.P3.details[0], /no workflow job is named "validate"/);
  const twice = check(repo(t, { 'ci.yml': AGGREGATE, 'other.yml': 'on: [pull_request]\njobs:\n  lint:\n    name: "validate"\n    runs-on: ubuntu-latest\n' }));
  assert.equal(twice.checks.P3.status, 'drift');
  assert.match(twice.checks.P3.details[0], /produced by 2 jobs/);
  // A job named by an expression, a matrix job or a reusable workflow call is not a producer of the plain name.
  const dynamic = check(repo(t, { 'ci.yml': 'on: pull_request\njobs:\n  a:\n    name: validate ${{ matrix.os }}\n  validate:\n    strategy:\n      matrix:\n        os: [x]\n  b:\n    name: validate\n    uses: ./.github/workflows/x.yml\n' }));
  assert.match(dynamic.checks.P3.details[0], /no workflow job is named "validate"/);
});

test('P-05: P4 drifts on path filters, a branch filter leaving out the default branch, no pull request trigger, or needs without always()', (t) => {
  const cases = [
    [AGGREGATE.replace('  pull_request:', '  pull_request:\n    paths:\n      - src/**'), /path filter/],
    [AGGREGATE.replace('  pull_request:', '  pull_request:\n    paths-ignore: [docs/**]'), /path filter/],
    [AGGREGATE.replace('  pull_request:', '  pull_request:\n    branches: [release/*]'), /branch filter leaves out main/],
    [AGGREGATE.replace('  pull_request:', '  pull_request:\n    branches-ignore: [main]'), /ignores main/],
    [AGGREGATE.replace('  pull_request:\n', ''), /does not run on pull requests/],
    [AGGREGATE.replace("    if: ${{ always() }}\n", ''), /without `if: always\(\)`/],
    [AGGREGATE.replace("    if: ${{ always() }}", "    if: success()"), /job condition other than/],
  ];
  for (const [text, pattern] of cases) {
    const result = check(repo(t, { 'ci.yml': text }));
    assert.equal(result.checks.P4.status, 'drift', String(pattern));
    assert.match(result.checks.P4.details.join('\n'), pattern);
  }
  // A branch filter that includes the default branch, inline event lists and !cancelled() are fine.
  for (const text of [
    AGGREGATE.replace('  pull_request:', '  pull_request:\n    branches: [main, "release/**"]'),
    AGGREGATE.replace('  pull_request:', '  pull_request:\n    branches: ["**"]'),
    AGGREGATE.replace("${{ always() }}", '${{ !cancelled() }}'),
    'on: [push, pull_request]\njobs:\n  validate:\n    runs-on: ubuntu-latest\n',
  ]) assert.equal(check(repo(t, { 'ci.yml': text })).checks.P4.status, 'ok', text);
});

test('P-06: an aggregate is verified only when a step passes toJSON(needs) to a declared aggregate command', (t) => {
  const unverified = [
    AGGREGATE.replace('${{ toJSON(needs) }}', 'fixed'),
    // Reading one result is not proof that the job fails on it.
    AGGREGATE.replace('${{ toJSON(needs) }}', '${{ needs.tests.result }}'),
    // Another command, or the aggregate command only echoed or in a comment.
    AGGREGATE.replace('node repo/scripts/run-tests.cjs --verify-ci summaries  # fails unless every leg passed', 'node verify.cjs'),
    AGGREGATE.replace('node repo/scripts/run-tests.cjs --verify-ci summaries', 'echo node run-tests.cjs --verify-ci'),
    AGGREGATE.replace('node repo/scripts/run-tests.cjs --verify-ci summaries  # fails unless every leg passed', 'echo ok  # node run-tests.cjs --verify-ci'),
  ];
  for (const text of unverified) {
    const result = check(repo(t, { 'ci.yml': text }));
    assert.equal(result.checks.P4.status, 'unverified', text);
    assert.equal(result.status, 'unverified', text);
  }
  // Job-level env and a multi-line run script both count.
  const jobEnv = AGGREGATE.replace("    runs-on: ubuntu-latest\n    steps:\n      - name: Verify\n        env:\n          TEST_LEGS: ${{ toJSON(needs) }}\n        run: node repo/scripts/run-tests.cjs --verify-ci summaries  # fails unless every leg passed",
    "    runs-on: ubuntu-latest\n    env:\n      TEST_LEGS: ${{ toJSON(needs) }}\n    steps:\n      - run: |\n          node repo/scripts/validate-toolkit.cjs\n          node repo/scripts/run-tests.cjs --verify-ci \"$RUNNER_TEMP/s\"");
  assert.notEqual(jobEnv, AGGREGATE);
  assert.equal(check(repo(t, { 'ci.yml': jobEnv })).checks.P4.status, 'ok');
});

test('P-13: a passing required check can never hide a failed, skipped or missing job', (t) => {
  const Q = "'";
  const two = (validate) => ['on:', '  pull_request:', 'jobs:', '  tests:', '    runs-on: ubuntu-latest', '  validate:', ...validate, '    runs-on: ubuntu-latest', ''].join('\n');
  const steps = (run) => ['    steps:', `      - run: ${run}`];
  const verdict = text => protection.producerVerdict(['validate'], [{ file: 'ci.yml', workflow: protection.readWorkflow(text) }], 'main');
  const cases = [
    // A: needs plus a longer condition: a failed test leg skips validate, which reports success.
    ['A', two(['    needs: [tests]', `    if: always() && needs.tests.result == ${Q}success${Q}`, ...steps('echo ok')]), 'P4', 'drift'],
    // B: always() and reads the needs, but nothing fails on them.
    ['B', two(['    needs: [tests]', '    if: ${{ always() }}', ...steps('echo "${{ toJSON(needs) }}"')]), 'P4', 'unverified'],
    // C: no needs, but skipped on every pull request.
    ['C', two([`    if: github.event_name == ${Q}push${Q}`, ...steps('echo ok')]), 'P4', 'drift'],
    // D: always() inside a longer condition that skips pull requests.
    ['D', two(['    needs: [tests]', `    if: always() && github.event_name == ${Q}push${Q}`, ...steps('node run-tests.cjs --verify-ci')]), 'P4', 'drift'],
    // E: the aggregate only named in a comment.
    ['E', two(['    needs: [tests]', '    if: always()', ...steps('echo done  # needs.tests.result')]), 'P4', 'unverified'],
    // F: a block-scalar condition is read, not mistaken for a missing always().
    ['F', two(['    needs: [tests]', '    if: |', '      always()', '    env:', '      TEST_LEGS: ${{ toJSON(needs) }}', ...steps('node repo/scripts/run-tests.cjs --verify-ci s')]), 'P4', 'ok'],
    ['F2', two(['    if: >', `      github.event_name == ${Q}push${Q}`, ...steps('echo ok')]), 'P4', 'drift'],
  ];
  for (const [id, text, check, status] of cases) assert.equal(verdict(text)[check].status, status, id);
  // G: a job named by an expression elsewhere could post the same check: P3 unverified, never ok.
  const one = 'on: [pull_request]\njobs:\n  validate:\n    runs-on: ubuntu-latest\n';
  const dispatch = 'on:\n  workflow_dispatch:\n    inputs:\n      check:\n        type: string\njobs:\n  post:\n    name: ${{ inputs.check }}\n    runs-on: ubuntu-latest\n';
  const g = protection.producerVerdict(['validate'], [{ file: 'a.yml', workflow: protection.readWorkflow(one) }, { file: 'b.yml', workflow: protection.readWorkflow(dispatch) }], 'main');
  assert.equal(g.P3.status, 'unverified');
  assert.match(g.P3.details[0], /b\.yml post is named by an expression that could produce "validate"/);
  // An expression name that cannot produce the check is not counted.
  const shard = 'on: [pull_request]\njobs:\n  t:\n    name: tests-linux (${{ matrix.shard }})\n    strategy:\n      matrix:\n        shard: [1]\n';
  assert.equal(protection.producerVerdict(['validate'], [{ file: 'a.yml', workflow: protection.readWorkflow(one) }, { file: 'c.yml', workflow: protection.readWorkflow(shard) }], 'main').P3.status, 'ok');
  // Positive: plain job, always() and !cancelled() in either spelling, with the aggregate.
  for (const condition of ['always()', '${{ always() }}', '${{ !cancelled() }}', '"!cancelled()"']) {
    const text = two(['    needs: [tests]', `    if: ${condition}`, '    env:', '      TEST_LEGS: ${{ toJSON(needs) }}', ...steps('node repo/scripts/run-tests.cjs --verify-ci s')]);
    assert.equal(verdict(text).P4.status, 'ok', condition);
  }
  // Unquoted `!cancelled()` is a YAML tag, not the expression: outside the subset, so unverified.
  assert.equal(verdict(two(['    needs: [tests]', '    if: !cancelled()', '    env:', '      TEST_LEGS: ${{ toJSON(needs) }}', ...steps('node repo/scripts/run-tests.cjs --verify-ci s')])).P4.status, 'unverified');
  assert.equal(verdict(one).P4.status, 'ok');
});

test('P-14: the aggregate step counts only when its exit code is the step result and it gets the needs results', () => {
  const Q = "'";
  const verdict = text => protection.producerVerdict(['validate'], [{ file: 'ci.yml', workflow: protection.readWorkflow(text) }], 'main').P4;
  const job = ({ jobLines = [], stepLines = [], env = ['        env:', '          TEST_LEGS: ${{ toJSON(needs) }}'], run = ['        run: node repo/scripts/run-tests.cjs --verify-ci "$RUNNER_TEMP/s"'], top = [] } = {}) => [
    ...top, 'on:', '  pull_request:', 'jobs:', '  tests:', '    runs-on: ubuntu-latest', '  validate:', '    needs: [tests]', '    if: ${{ always() }}', '    runs-on: ubuntu-latest', ...jobLines,
    '    steps:', '      - uses: actions/checkout@v4', '      - name: Verify', ...stepLines, ...env, ...run, ''].join('\n');
  // The real shape passes: several plain node lines, the aggregate last.
  assert.equal(verdict(job({ run: ['        run: |', '          node repo/scripts/validate-toolkit.cjs', '          node repo/scripts/sync-repo-doc-contract.cjs --check', '          node repo/scripts/run-tests.cjs --verify-ci "$RUNNER_TEMP/s"'] })).status, 'ok');
  assert.equal(verdict(job({ jobLines: ['    env:', '      TEST_LEGS: ${{ toJSON(needs) }}'], env: [] })).status, 'ok');
  assert.equal(verdict(job({ stepLines: ['        shell: bash', '        continue-on-error: false'] })).status, 'ok');
  // Every route below can let the step pass while a needed job failed, so none is verified.
  const mustFail = {
    'or true': job({ run: ['        run: node repo/scripts/run-tests.cjs --verify-ci s || true'] }),
    'semicolon exit': job({ run: ['        run: node repo/scripts/run-tests.cjs --verify-ci s; exit 0'] }),
    'not last': job({ run: ['        run: |', '          node repo/scripts/run-tests.cjs --verify-ci s', '          node repo/scripts/validate-toolkit.cjs'] }),
    'exit after': job({ run: ['        run: |', '          node repo/scripts/run-tests.cjs --verify-ci s', '          exit 0'] }),
    'heredoc': job({ run: ['        run: |', '          cat <<EOF', '          node repo/scripts/run-tests.cjs --verify-ci s'] }),
    'set +e': job({ run: ['        run: |', '          set +e', '          node repo/scripts/run-tests.cjs --verify-ci s'] }),
    'trap': job({ run: ['        run: |', `          trap ${Q}exit 0${Q} EXIT`, '          node repo/scripts/run-tests.cjs --verify-ci s'] }),
    'function': job({ run: ['        run: |', '          node() { true; }', '          node repo/scripts/run-tests.cjs --verify-ci s'] }),
    'path export': job({ run: ['        run: |', '          export PATH=/tmp/fake:$PATH', '          node repo/scripts/run-tests.cjs --verify-ci s'] }),
    'continuation': job({ run: ['        run: |', '          true || \\', '          node repo/scripts/run-tests.cjs --verify-ci s'] }),
    'folded block': job({ run: ['        run: >', '          node repo/scripts/run-tests.cjs --verify-ci s', '          || true'] }),
    'folded plain scalar': job({ run: ['        run: node repo/scripts/run-tests.cjs --verify-ci s', '          || true'] }),
    'expression in script': job({ run: ['        run: node repo/scripts/run-tests.cjs --verify-ci ${{ inputs.dir }}'] }),
    'any path': job({ run: ['        run: node /tmp/run-tests.cjs --verify-ci s'] }),
    'relative path': job({ run: ['        run: node ../repo/scripts/run-tests.cjs --verify-ci s'] }),
    'echoed': job({ run: ['        run: echo node repo/scripts/run-tests.cjs --verify-ci s'] }),
    'step if': job({ stepLines: [`        if: github.event_name == ${Q}push${Q}`] }),
    'step if always': job({ stepLines: ['        if: always()'] }),
    'step continue-on-error': job({ stepLines: ['        continue-on-error: true'] }),
    'step continue-on-error expression': job({ stepLines: ['        continue-on-error: ${{ true }}'] }),
    'job continue-on-error': job({ jobLines: ['    continue-on-error: true'] }),
    'custom shell': job({ stepLines: ['        shell: bash {0}'] }),
    'python shell': job({ stepLines: ['        shell: python {0}'] }),
    'job default shell': job({ jobLines: ['    defaults:', '      run:', `        shell: sh -c ${Q}exit 0${Q} {0}`] }),
    'workflow default shell': job({ top: ['defaults:', '  run:', '    shell: cmd'] }),
    'working-directory': job({ stepLines: ['        working-directory: elsewhere'] }),
    'default working-directory': job({ jobLines: ['    defaults:', '      run:', '        working-directory: elsewhere'] }),
    'hard-coded legs': job({ env: ['        env:', `          TEST_LEGS: ${Q}{}${Q}`, '          OTHER: ${{ toJSON(needs) }}'] }),
    'legs under another name': job({ env: ['        env:', '          LEGS: ${{ toJSON(needs) }}'] }),
    'step overrides job legs': job({ jobLines: ['    env:', '      TEST_LEGS: ${{ toJSON(needs) }}'], env: ['        env:', '          TEST_LEGS: x'] }),
    'legs in a longer expression': job({ env: ['        env:', `          TEST_LEGS: \${{ toJSON(needs) }}x`] }),
    'no legs': job({ env: [] }),
    'node options': job({ env: ['        env:', '          TEST_LEGS: ${{ toJSON(needs) }}', '          NODE_OPTIONS: --require ./x.cjs'] }),
    'workflow path env': job({ top: ['env:', '  PATH: /tmp/fake'] }),
    'bash env': job({ jobLines: ['    env:', '      BASH_ENV: ./x.sh'] }),
    'github env write': job({ stepLines: [], run: ['        run: node repo/scripts/run-tests.cjs --verify-ci s'] }).replace('      - uses: actions/checkout@v4', '      - uses: actions/checkout@v4\n      - run: echo "NODE_OPTIONS=--require ./x.cjs" >> "$GITHUB_ENV"'),
    'aggregate in a uses step': job({ stepLines: ['        uses: ./x'] }),
    'flow env': job({ env: ['        env: {TEST_LEGS: "${{ toJSON(needs) }}"}'] }),
  };
  // Each route fails for its own reason, not by accident.
  const reasons = {
    'or true': /no step ends with/, 'semicolon exit': /no step ends with/, 'not last': /no step ends with/, 'exit after': /no step ends with/,
    'heredoc': /not a plain node command/, 'set +e': /not a plain node command/, 'trap': /not a plain node command/, 'function': /not a plain node command/,
    'path export': /not a plain node command/, 'continuation': /not a plain node command/, 'folded block': /no step ends with/,
    'folded plain scalar': /continues the value above it/, 'expression in script': /no step ends with/, 'any path': /no step ends with/,
    'relative path': /no step ends with/, 'echoed': /no step ends with/, 'step if': /has its own `if`/, 'step if always': /has its own `if`/,
    'step continue-on-error': /aggregate step has continue-on-error/, 'step continue-on-error expression': /aggregate step has continue-on-error/,
    'job continue-on-error': /job has continue-on-error/, 'custom shell': /shell "bash \{0\}"/, 'python shell': /shell "python \{0\}"/,
    'job default shell': /shell "sh -c/, 'workflow default shell': /shell "cmd"/, 'working-directory': /sets working-directory/,
    'default working-directory': /working-directory default/, 'hard-coded legs': /does not get TEST_LEGS/, 'legs under another name': /does not get TEST_LEGS/,
    'step overrides job legs': /does not get TEST_LEGS/, 'legs in a longer expression': /does not get TEST_LEGS/, 'no legs': /does not get TEST_LEGS/,
    'node options': /NODE_OPTIONS is set/, 'workflow path env': /PATH is set/, 'bash env': /BASH_ENV is set/, 'github env write': /writes GITHUB_ENV/,
    'aggregate in a uses step': /no step ends with/, 'flow env': /outside the YAML subset/,
  };
  assert.deepEqual(Object.keys(reasons).sort(), Object.keys(mustFail).sort());
  for (const [name, text] of Object.entries(mustFail)) {
    const result = verdict(text);
    assert.equal(result.status, 'unverified', name);
    assert.match(result.details.join('\n'), reasons[name], name);
  }
});

test('P-17: the reader is default-deny: YAML outside its plain subset is unverified, and present-but-unreadable fields count as set', () => {
  const Q = "'";
  const verdicts = text => protection.producerVerdict(['validate'], [{ file: 'ci.yml', workflow: protection.readWorkflow(text) }], 'main');
  const head = ['on:', '  pull_request:', 'jobs:', '  tests:', '    runs-on: ubuntu-latest', '  validate:', '    needs: [tests]', '    if: ${{ always() }}', '    runs-on: ubuntu-latest'];
  const aggregate = (stepLines = [], jobLines = []) => [...head, ...jobLines, '    steps:', '      - name: Verify', ...stepLines, '        env:', '          TEST_LEGS: ${{ toJSON(needs) }}', '        run: node repo/scripts/run-tests.cjs --verify-ci s', ''].join('\n');
  assert.equal(verdicts(aggregate()).P4.status, 'ok');
  assert.equal(verdicts(`---\n${aggregate()}`).P4.status, 'ok', 'a single leading document marker');
  assert.equal(verdicts(aggregate().replace(/\n/g, '\r\n')).P4.status, 'ok', 'CRLF line ends');
  const outside = {
    // s1-s5: the value on the next line, or folded onto it.
    s1: aggregate(['        continue-on-error:', '          true']),
    s2: aggregate(['        shell: sh -c', '          true {0}']),
    s3: aggregate(['        continue-on-error:', '          ${{ true }}']),
    s4: aggregate([], ['    defaults:', '      run:', '        shell: sh -c', '          true {0}']),
    s5: aggregate([], ['    continue-on-error:', '      true']),
    // Anchors, tags and explicit keys.
    k1: aggregate([`        &a if: github.event_name == ${Q}push${Q}`]),
    k2: aggregate(['        &a continue-on-error: true']),
    k3: aggregate([`        !!str if: github.event_name == ${Q}push${Q}`]),
    k4: aggregate(['        !!str continue-on-error: true']),
    k5: aggregate(['        ? if', `        : github.event_name == ${Q}push${Q}`]),
    k6: aggregate(['        ? continue-on-error', '        : true']),
    k8: aggregate([], ['    &a continue-on-error: true']),
    k9: aggregate([`        &s shell: sh -c ${Q}exit 0${Q} {0}`]),
    alias: [...head.slice(0, 7), '    if: *cond', '    runs-on: ubuntu-latest', ''].join('\n'),
    'dotted anchor': ['x: &f.1', '  paths: [docs/**]', 'on:', '  pull_request: *f.1', 'jobs:', '  validate:', '    runs-on: ubuntu-latest', ''].join('\n'),
    'merge key': aggregate(['        <<: *base']),
    // A lone CR joins a line onto the one before it.
    c1: aggregate(['        name: x\r        continue-on-error: true']),
    c2: aggregate([`        name: x\r        if: github.event_name == ${Q}push${Q}`]),
    // Flow style.
    fl1: ['on:', '  pull_request: {paths: [src/**]}', 'jobs:', '  validate:', '    runs-on: ubuntu-latest', ''].join('\n'),
    fl2: aggregate().replace('      - name: Verify', '      - {run: "echo NODE_OPTIONS=--require ./x.cjs >> $GITHUB_ENV"}\n      - name: Verify'),
    // Duplicate keys and more than one document.
    d1: aggregate([], [`    if: github.event_name == ${Q}push${Q}`]),
    d2: aggregate(['        run: echo ok']),
    d3: aggregate(['        continue-on-error: false', '        continue-on-error: true']),
    d6: `${aggregate()}jobs:\n  other:\n    runs-on: ubuntu-latest\n`,
    m1: `${aggregate()}---\non: [push]\n`,
    // Lines the old reader skipped.
    o1: aggregate().replace('      - name: Verify', '      -   name: Verify'),
    o3: aggregate().replace('      - name: Verify', '      -\n        name: Verify'),
    n9b: aggregate().replace('--verify-ci s', '--verify-ci s\t|| true'),
    n9c: aggregate(['        \tcontinue-on-error: true']),
    'multi-line quoted': aggregate(['        shell: "sh -c', '          true {0}"']),
    'flow list with a mapping': ['on: [pull_request]', 'jobs:', '  validate:', '    needs: [{a: b}]', '    runs-on: ubuntu-latest', ''].join('\n'),
    'directive': `%YAML 1.2\n${aggregate()}`,
    'unicode line break': aggregate(['        name: x\u2028        continue-on-error: true']),
  };
  for (const [name, text] of Object.entries(outside)) {
    const result = verdicts(text);
    assert.notEqual(result.P4.status, 'ok', name);
    assert.notEqual(result.P3.status, 'ok', name);
    assert.match([...result.P3.details, ...result.P4.details].join('\n'), /outside the YAML subset/, name);
  }
  // p3: a hidden second producer through an explicit key leaves P3 unverified, never ok.
  const hidden = ['on: [pull_request]', 'jobs:', '  validate:', '    runs-on: ubuntu-latest', '  other:', '    ? name', '    : validate', ''].join('\n');
  assert.equal(verdicts(hidden).P3.status, 'unverified');
  // An unreadable workflow never turns "no producer" into drift: it is unverified.
  assert.equal(verdicts('on: [pull_request]\njobs:\n  validate: {runs-on: x}\n').P3.status, 'unverified');
  // A field present with no value counts as set.
  assert.equal(verdicts(aggregate(['        continue-on-error:'])).P4.status, 'unverified', 'null step continue-on-error');
  assert.equal(verdicts(aggregate([], ['    continue-on-error:'])).P4.status, 'unverified', 'null job continue-on-error');
  assert.equal(verdicts(aggregate(['        shell:'])).P4.status, 'unverified', 'null shell');
  assert.equal(verdicts(aggregate([], ['    defaults:', '      run:', '        shell:'])).P4.status, 'unverified', 'null default shell');
  // b1: a "!" branch pattern is not evaluated, so the trigger is unverified.
  const negated = ['on:', '  pull_request:', '    branches: ["**", "!main"]', 'jobs:', '  validate:', '    runs-on: ubuntu-latest', ''].join('\n');
  assert.equal(verdicts(negated).P4.status, 'unverified');
  // A space other than ASCII space before "#" is not a comment in YAML, so bash runs what follows.
  for (const space of [' ', '　', '﻿', ' ', ' ', '​', '\v']) {
    const forms = {
      plain: aggregate().replace('--verify-ci s', `--verify-ci s${space}#|| true`),
      literal: aggregate().replace('        run: node repo/scripts/run-tests.cjs --verify-ci s', `        run: |\n          node repo/scripts/run-tests.cjs --verify-ci s${space}#|| true`),
      name: aggregate().replace('      - name: Verify', `      - name: Verify${space}#x`),
    };
    for (const [form, text] of Object.entries(forms)) {
      const result = verdicts(text);
      assert.equal(result.P4.status, 'unverified', `${JSON.stringify(space)} ${form}`);
      assert.match(result.P4.details.join('\n'), /other than printable ASCII/, `${JSON.stringify(space)} ${form}`);
    }
  }
  // Non-ASCII text on a full-line comment is fine.
  assert.equal(verdicts(`# Café — checks\n${aggregate()}`).P4.status, 'ok');
  // A byte order mark is removed before both checking and reading: a sole workflow reads in full,
  // and a second workflow that also produces the check is seen (two producers: drift).
  const bom = '﻿';
  assert.equal(verdicts(`${bom}${aggregate()}`).P4.status, 'ok', 'BOM, sole workflow');
  const two = (first, second) => protection.producerVerdict(['validate'], [{ file: 'a.yml', workflow: protection.readWorkflow(first) }, { file: 'b.yml', workflow: protection.readWorkflow(second) }], 'main');
  const plain = ['on: [pull_request]', 'jobs:', '  validate:', '    runs-on: ubuntu-latest', ''].join('\n');
  assert.equal(two(plain, `${bom}name: Fast\n${plain}`).P3.status, 'drift', 'BOM, second producer');
  // Block scalars are read only for run, if, shell and continue-on-error; a block or empty job name is never a guess.
  const blockName = ['on: [pull_request]', 'jobs:', '  fast:', '    name: >-', '      validate', '    runs-on: ubuntu-latest', ''].join('\n');
  assert.equal(two(plain, blockName).P3.status, 'unverified', 'block-scalar name');
  assert.match(two(plain, blockName).P3.details.join('\n'), /gives "name" a block scalar/);
  const emptyName = ['on: [pull_request]', 'jobs:', '  fast:', '    name: ""', '    runs-on: ubuntu-latest', ''].join('\n');
  assert.equal(two(plain, emptyName).P3.status, 'unverified', 'empty name');
  for (const [name, text] of Object.entries({
    'steps as a block scalar': aggregate().replace('    steps:\n', '    steps: |\n'),
    'branch filter as a block scalar': ['on:', '  pull_request:', '    branches-ignore: >-', '      main', 'jobs:', '  validate:', '    runs-on: ubuntu-latest', ''].join('\n'),
    'key between indents': aggregate().replace('          TEST_LEGS: ${{ toJSON(needs) }}', '          TEST_LEGS: ${{ toJSON(needs) }}\n       continue-on-error: true'),
    'key deeper than its mapping': aggregate(['          continue-on-error: true']),
    'item outside a list': aggregate().replace('    runs-on: ubuntu-latest\n    steps:', '    runs-on: ubuntu-latest\n      - x\n    steps:'),
    'alias in a flow list': ['on: [pull_request]', 'jobs:', '  validate:', '    needs: [*x]', '    runs-on: ubuntu-latest', ''].join('\n'),
    'reserved character in a flow list': ['on: [pull_request]', 'jobs:', '  validate:', '    needs: [@x]', '    runs-on: ubuntu-latest', ''].join('\n'),
    'dash item in a flow list': ['on: [pull_request]', 'jobs:', '  validate:', '    needs: [- tests]', '    runs-on: ubuntu-latest', ''].join('\n'),
  })) assert.notEqual(verdicts(text).P4.status, 'ok', name);
  // A plain scalar steps value is not a list.
  assert.equal(verdicts(aggregate().replace(/    steps:\n[\s\S]*$/, '    steps: none\n')).P4.status, 'unverified', 'steps as a scalar');
  // Activity types can leave ordinary pull requests out: unverified.
  assert.equal(verdicts(['on:', '  pull_request:', '    types: [labeled]', 'jobs:', '  validate:', '    runs-on: ubuntu-latest', ''].join('\n')).P4.status, 'unverified', 'types');
  // An indentless list of events is read, so a pull request trigger there is seen.
  assert.equal(verdicts(['on:', '- pull_request', 'jobs:', '  validate:', '    runs-on: ubuntu-latest', ''].join('\n')).P4.status, 'ok', 'indentless on');
  // continue-on-error is off only as the plain false; a quoted or block false is a string, so set.
  assert.equal(verdicts(aggregate(['        continue-on-error: false'])).P4.status, 'ok', 'plain false');
  for (const lines of [["        continue-on-error: 'false'"], ['        continue-on-error: "false"'], ['        continue-on-error: |', '          false'], ['        continue-on-error: >-', '          false']]) {
    assert.equal(verdicts(aggregate(lines)).P4.status, 'unverified', lines.join(' '));
  }
  assert.equal(verdicts(aggregate([], ["    continue-on-error: 'false'"])).P4.status, 'unverified', 'quoted false on the job');
  // Long runs of spaces are read in linear time.
  const spaces = ' '.repeat(200000);
  const started = Date.now();
  verdicts(`on: [pull_request]${spaces}\njobs:\n  validate:\n    name: a${spaces}b\n    runs-on: x${spaces}#${spaces}\n`);
  verdicts(aggregate().replace('--verify-ci s', `--verify-ci${spaces}s${spaces}!`));
  assert.ok(Date.now() - started < 2000, `long lines took ${Date.now() - started} ms`);
  // This repository's own workflows are inside the subset.
  const root = path.join(__dirname, '..', '..', '.github', 'workflows');
  for (const name of fs.readdirSync(root).filter(file => /\.ya?ml$/.test(file))) assert.deepEqual(protection.readWorkflow(fs.readFileSync(path.join(root, name), 'utf8')).problems, [], name);
  // So are the workflow templates the skills ship.
  for (const file of ['skills/secure-ci-cd/templates/github-actions/personal-data-guard.yml', 'skills/skill-product-review/templates/ci/generated-surface-check.template.yml', 'skills/skill-product-review/templates/ci/read-only-publication-validation.template.yml']) {
    assert.deepEqual(protection.readWorkflow(fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8')).problems, [], file);
  }
});

test('P-15: YAML the reader cannot follow is unverified, never ok', () => {
  const Q = "'";
  const verdicts = text => protection.producerVerdict(['validate'], [{ file: 'ci.yml', workflow: protection.readWorkflow(text) }], 'main');
  // An indentless needs list is read, so the job is held to the aggregate rule (no aggregate here).
  const indentless = ['on: [pull_request]', 'jobs:', '  tests:', '    runs-on: ubuntu-latest', '  validate:', '    needs:', '    - tests', '    if: always()', '    steps:', '      - run: echo ok', ''].join('\n');
  assert.deepEqual(protection.readWorkflow(indentless).jobs[1].needs, ['tests']);
  assert.equal(verdicts(indentless).P4.status, 'unverified');
  const unread = {
    'flow-style job': `on: [pull_request]\njobs:\n  tests:\n    runs-on: ubuntu-latest\n  validate: {needs: [tests], if: "github.event_name == ${Q}push${Q}", runs-on: ubuntu-latest}\n`,
    'empty needs': 'on: [pull_request]\njobs:\n  validate:\n    needs:\n    runs-on: ubuntu-latest\n',
    'folded if': 'on: [pull_request]\njobs:\n  validate:\n    if: always()\n      && false\n    runs-on: ubuntu-latest\n',
    'anchor and merge key': `on: [pull_request]\nx: &base\n  if: github.event_name == ${Q}push${Q}\njobs:\n  validate:\n    <<: *base\n    runs-on: ubuntu-latest\n`,
    'flow jobs': 'on: [pull_request]\njobs: {validate: {runs-on: ubuntu-latest}}\n',
  };
  for (const [name, text] of Object.entries(unread)) {
    const result = verdicts(text);
    assert.notEqual(result.P4.status, 'ok', name);
    assert.notEqual(result.P3.status === 'ok' && result.P4.status === 'ok', true, name);
  }
  // A flow-style job anywhere could produce the check under another name: P3 is unverified.
  const other = `on: [pull_request]\njobs:\n  validate:\n    runs-on: ubuntu-latest\n  post: {name: validate, runs-on: ubuntu-latest}\n`;
  assert.equal(verdicts(other).P3.status, 'unverified');
});

test('P-07: P5 drifts when squash or rebase is allowed; rulesets intersect, else repository settings decide', (t) => {
  const root = repo(t);
  const squash = check(root, github({ methods: ['merge', 'squash'] }));
  assert.equal(squash.checks.P5.status, 'drift');
  assert.match(squash.checks.P5.details[0], /main allows merge, squash \(rulesets\)/);
  const settings = check(root, github({ methods: null }));
  assert.match(settings.checks.P5.details[0], /merge, squash, rebase \(repository settings\)/);
  assert.equal(check(root, github({ methods: null, settings: { allow_merge_commit: true, allow_squash_merge: false, allow_rebase_merge: false } })).checks.P5.status, 'ok');
  const twoRulesets = github({ methods: ['merge', 'squash'] });
  const intersect = () => { const read = twoRulesets(); read.rules.push({ type: 'pull_request', ruleset_id: 8, parameters: { allowed_merge_methods: ['merge'] } }); return read; };
  assert.equal(check(root, intersect).checks.P5.status, 'ok');
});

test('P-08: GitHub unreadable is unverified, a Free private repository is not-enforceable, offline checks the workflows only', (t) => {
  const root = repo(t);
  for (const reason of ['gh-unavailable', 'classic-protection-not-visible', 'not-visible']) {
    const result = check(root, () => ({ ok: false, reason }));
    assert.equal(result.status, 'unverified', reason);
    assert.deepEqual(statuses(result), { P1: 'unverified', P2: 'unverified', P3: 'ok', P4: 'ok', P5: 'unverified' });
  }
  assert.equal(check(root, () => { throw new Error('boom'); }).status, 'unverified');
  assert.equal(check(root, () => ({ ok: false, reason: 'plan-has-no-protection' })).status, 'not-enforceable');
  let called = false;
  const offline = check(root, () => { called = true; return github()(); }, { offline: true });
  assert.equal(called, false);
  assert.deepEqual(statuses(offline), { P1: 'not-checked', P2: 'not-checked', P3: 'ok', P4: 'ok', P5: 'not-checked' });
  assert.equal(offline.status, 'unverified');
  // Offline with a branch filter: the default branch comes from origin/HEAD, else the filter is unverified.
  const filtered = repo(t, { 'ci.yml': AGGREGATE.replace('  pull_request:', '  pull_request:\n    branches: [trunk]') });
  const unknown = check(filtered, github(), { offline: true });
  assert.equal(unknown.checks.P4.status, 'unverified');
  assert.match(unknown.checks.P4.details[0], /default branch is unknown/);
  childProcess.execFileSync('git', ['-C', filtered, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk'], { windowsHide: true });
  assert.equal(check(filtered, github(), { offline: true }).checks.P4.status, 'ok');
});

test('P-09: another host or no origin is not-applicable; a binding without checks is unverified', (t) => {
  assert.equal(check(repo(t, {}, 'https://gitlab.example.com/a/b.git')).status, 'not-applicable');
  assert.equal(check(repo(t, {}, null)).status, 'not-applicable');
  assert.equal(protection.defaultBranchProtection(repo(t), { requiredChecks: [], reader: github() }).reason, 'binding-has-no-required-checks');
});

test('P-10: the ruleset Toolkit writes is the one the check accepts, and the writer only creates or updates it', (t) => {
  const body = protection.protectionRulesetBody(['validate']);
  assert.equal(body.name, protection.RULESET_NAME);
  assert.deepEqual(body.conditions.ref_name.include, ['~DEFAULT_BRANCH']);
  assert.deepEqual(body.bypass_actors, []);
  const rules = body.rules.map(rule => ({ ...rule, ruleset_id: 9 }));
  const result = check(repo(t), () => ({ ok: true, default_branch: 'main', repository: {}, rules, classic: null, toolkit_ruleset: { id: 9 } }));
  assert.equal(result.status, 'conformant');
  const calls = [];
  const spawn = (command, args, options) => { calls.push({ args, input: options.input }); return { status: 0, stdout: '{"id":9}', stderr: '' }; };
  assert.deepEqual(protection.ghProtectionRulesetWriter('o/r', ['validate'], null, { spawn }), { ok: true, id: 9 });
  assert.deepEqual(protection.ghProtectionRulesetWriter('o/r', ['validate'], 9, { spawn }), { ok: true, id: 9 });
  assert.deepEqual(calls.map(call => call.args.slice(0, 4)), [['api', '-X', 'POST', 'repos/o/r/rulesets'], ['api', '-X', 'PUT', 'repos/o/r/rulesets/9']]);
  assert.deepEqual(JSON.parse(calls[0].input), body);
});

test('P-11: the reader asks GitHub only with GETs and maps classic protection and errors', () => {
  const calls = [];
  const answers = {
    'repos/o/r': { default_branch: 'trunk', allow_merge_commit: true, allow_squash_merge: false, allow_rebase_merge: false },
    'repos/o/r/rules/branches/trunk?per_page=100': [],
    'repos/o/r/branches/trunk/protection': { required_status_checks: { checks: [{ context: 'validate', app_id: 15368 }] } },
    'repos/o/r/rulesets?targets=branch&per_page=100': [{ id: 3, name: protection.RULESET_NAME, source_type: 'Repository' }],
  };
  const spawn = (command, args) => {
    calls.push(args);
    const key = args[1];
    return key in answers ? { status: 0, stdout: JSON.stringify(answers[key]), stderr: '' } : { status: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' };
  };
  const read = protection.ghProtectionReader('o/r', { spawn });
  assert.equal(read.ok, true);
  assert.equal(read.default_branch, 'trunk');
  assert.deepEqual(read.classic, { checks: [{ context: 'validate', app_id: 15368 }] });
  assert.deepEqual(read.toolkit_ruleset, { id: 3 });
  assert.ok(calls.every(args => args[0] === 'api' && !args.includes('-X')), 'only GET requests');
  delete answers['repos/o/r/branches/trunk/protection'];
  assert.deepEqual(protection.ghProtectionReader('o/r', { spawn }), { ok: false, reason: 'classic-protection-not-visible' });
  const unprotected = (command, args) => (args[1].endsWith('/protection') ? { status: 1, stdout: '', stderr: 'gh: Branch not protected (HTTP 404)' } : spawn(command, args));
  assert.equal(protection.ghProtectionReader('o/r', { spawn: unprotected }).classic, null);
  assert.deepEqual(protection.ghProtectionReader('o/r', { spawn: () => { throw new Error('ENOENT'); } }), { ok: false, reason: 'gh-unavailable' });
  // A private repository on GitHub Free answers 403 with an upgrade hint: not-enforceable, not unverified.
  const free = (command, args) => (args[1].startsWith('repos/o/r/rules/') ? { status: 1, stdout: '', stderr: 'gh: Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)' } : spawn(command, args));
  assert.deepEqual(protection.ghProtectionReader('o/r', { spawn: free }), { ok: false, reason: 'plan-has-no-protection' });
  const forbidden = (command, args) => (args[1].startsWith('repos/o/r/rules/') ? { status: 1, stdout: '', stderr: 'gh: Resource not accessible (HTTP 403)' } : spawn(command, args));
  assert.deepEqual(protection.ghProtectionReader('o/r', { spawn: forbidden }), { ok: false, reason: 'gh-request-failed' });
});

test('P-16: nothing still points at the removed CI Gate machinery or control-plane kernel', () => {
  const root = path.join(__dirname, '..', '..');
  const removed = [
    'repo/scripts/toolkit-trusted-ci-repository-protection.cjs', 'repo/scripts/toolkit-trusted-ci-repository-protection-workflow.cjs',
    'repo/scripts/toolkit-control-plane', 'repo/contracts/trusted-ci-repository-protection', 'repo/contracts/control-plane-kernel',
  ];
  for (const entry of removed) assert.equal(fs.existsSync(path.join(root, entry)), false, entry);
  const names = ['toolkit-trusted-ci-repository-protection', 'toolkit-control-plane/', 'control-plane-kernel', 'trusted-ci-repository-protection/'];
  const listed = childProcess.execFileSync('git', ['-C', root, 'ls-files', '-z', 'repo', 'skills', '.github', 'package.json'], { encoding: 'utf8', windowsHide: true }).split('\0').filter(Boolean);
  const self = path.relative(root, __filename).split(path.sep).join('/');
  const hits = listed.filter(file => file !== self && file !== 'repo/docs/CHANGELOG.md' && fs.existsSync(path.join(root, file)))
    .filter(file => { const text = fs.readFileSync(path.join(root, file), 'utf8'); return names.some(name => text.includes(name)); });
  assert.deepEqual(hits, []);
});

test('P-12: the check writes nothing in the repository', (t) => {
  const root = repo(t);
  const snapshot = () => fs.readdirSync(root, { recursive: true }).sort().map(name => {
    const full = path.join(root, name);
    return fs.statSync(full).isFile() ? `${name}:${fs.readFileSync(full).toString('base64')}` : name;
  });
  const before = snapshot();
  check(root);
  check(root, github(), { offline: true });
  assert.deepEqual(snapshot(), before);
});
