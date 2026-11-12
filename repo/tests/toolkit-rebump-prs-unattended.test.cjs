'use strict';

// The unattended (GitHub Action) run of the re-bump command: only listed authors' pull requests
// are prepared, and the pull request branch's own scripts never see a sign-in.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { parseArgs, scrubbedEnv } = require('../scripts/toolkit-rebump-prs.cjs');
const { fixture } = require('./support/toolkit-rebump-fixture.cjs');

test('token variables are removed from the environment and ordinary ones kept', () => {
  const env = scrubbedEnv({ PATH: '/bin', HOME: '/home/x', GH_TOKEN: 'a', GITHUB_TOKEN: 'b', PUSH_TOKEN: 'c', GH_ENTERPRISE_TOKEN: 'd',
    ACTIONS_RUNTIME_TOKEN: 'e', ACTIONS_ID_TOKEN_REQUEST_URL: 'f', NPM_TOKEN: 'g', MY_PAT: 'h', DEPLOY_KEY: 'i', DB_PASSWORD: 'j', CLIENT_SECRET: 'k', DIFF_BASE: 'main',
    GITHUB_OUTPUT: 'l', GITHUB_ENV: 'm', GITHUB_PATH: 'n', GITHUB_STATE: 'o', GITHUB_STEP_SUMMARY: 'p', GITHUB_SHA: 'q' });
  // The Actions file-command paths go too; plain run facts such as the commit stay.
  assert.deepEqual(env, { PATH: '/bin', HOME: '/home/x', DIFF_BASE: 'main', GITHUB_SHA: 'q' });
});

test('--authors takes GitHub logins and refuses anything else', () => {
  assert.deepEqual(parseArgs([]).authors, []);
  assert.deepEqual(parseArgs(['--authors', 'Owner-1, release-test']).authors, ['owner-1', 'release-test']);
  for (const value of ['', ',', 'a b', 'a/b', '../x', 'a;b', '$(id)']) assert.throws(() => parseArgs(['--authors', value]), /--authors|usage/, value);
  assert.throws(() => parseArgs(['--authors']), /usage/);
});

test('a pull request by an unlisted author is skipped before any of its code runs', t => {
  const f = fixture(t);
  const head = f.pr().head.sha;
  let ran = 0;
  const count = () => { ran += 1; };
  const operation = (authors, login) => {
    const op = f.operation(true, { generate: count, validate: count });
    op.authors = authors;
    return op.process({ ...f.pr(), user: { login } });
  };
  for (const login of ['dependabot[bot]', 'someone-else', undefined]) {
    const result = operation(['release-test'], login);
    assert.deepEqual(result, { number: 7, status: 'skipped', reason: 'author not listed' }, String(login));
  }
  assert.equal(ran, 0);
  assert.equal(f.pr().head.sha, head);
  // A listed author, in any letter case, is prepared and pushed as before; no list means everyone.
  const authored = () => ({ ...f.pr(), user: { login: 'Release-Test' } });
  const listed = f.operation(true, { github: () => JSON.stringify(authored()) }); listed.authors = ['release-test'];
  assert.equal(listed.process(authored()).status, 'verified');
  assert.equal(f.operation().process({ ...f.pr(), user: { login: 'someone-else' } }).status, 'unchanged');
});

test('the branch\'s bump and validation scripts run with no token in their environment', t => {
  const f = fixture(t);
  const names = ['GH_TOKEN', 'GITHUB_TOKEN', 'PUSH_TOKEN', 'GITHUB_OUTPUT', 'GITHUB_ENV', 'GITHUB_PATH', 'GITHUB_STEP_SUMMARY'];
  const before = names.map(name => process.env[name]);
  t.after(() => names.forEach((name, i) => { if (before[i] === undefined) delete process.env[name]; else process.env[name] = before[i]; }));
  for (const name of names) process.env[name] = 'fixture-value';
  const calls = [];
  const start = (command, args, cwd, env) => {
    calls.push({ script: String(args[0]).replace(/\\/g, '/'), env });
    return spawnSync(command, args, { cwd, env, encoding: 'utf8', windowsHide: true });
  };
  // The default generator and validator, started through the injected runner.
  const result = f.operation(true, { start, generate: undefined, validate: undefined }).process(f.pr());
  // The fixture has no full validation script, so the run holds there; nothing was pushed.
  assert.equal(result.status, 'held', JSON.stringify(result));
  assert.match(result.reason, /Toolkit validation failed/);
  assert.ok(calls.some(call => call.script.endsWith('repo/scripts/bump-version.cjs')), 'the bump script ran');
  const validation = calls.find(call => call.script.endsWith('repo/scripts/validate-toolkit.cjs'));
  assert.ok(validation, 'the validation script was started');
  assert.match(validation.env.DIFF_BASE, /^[0-9a-f]{40}$/);
  for (const call of calls) for (const name of names) assert.equal(Object.hasOwn(call.env, name), false, `${name} reached ${call.script}`);
});
