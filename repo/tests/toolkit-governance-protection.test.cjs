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
  '          LEGS: ${{ toJSON(needs) }}',
  '        run: node verify.cjs',
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
    [AGGREGATE.replace("    if: ${{ always() }}", "    if: success()"), /without `if: always\(\)`/],
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

test('P-06: an aggregate that waits but never reads its needs results is unverified, never conformant', (t) => {
  const result = check(repo(t, { 'ci.yml': AGGREGATE.replace('${{ toJSON(needs) }}', 'fixed') }));
  assert.equal(result.checks.P4.status, 'unverified');
  assert.equal(result.status, 'unverified');
  const results = check(repo(t, { 'ci.yml': AGGREGATE.replace('${{ toJSON(needs) }}', "${{ needs.tests.result }}") }));
  assert.equal(results.checks.P4.status, 'ok');
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
