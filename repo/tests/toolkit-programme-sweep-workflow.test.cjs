'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = process.env.A2A_SOURCE_ROOT || path.resolve(__dirname, '../..');
const workflowPath = path.join(root, '.github/workflows/toolkit-programme-sweep.yml');
const fakeSecret = 'example-test-token-not-a-credential';

function action() {
  return require(path.join(root, 'repo/scripts/toolkit-programme-sweep-action.cjs'));
}

function makeEnabled(options = {}) {
  const notices = [];
  const failures = [];
  const summaries = [];
  const calls = [];
  const env = {
    DEFAULT_BRANCH: 'main',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_REPOSITORY: 'owner/repository',
    GH_TOKEN: fakeSecret,
    ...options.env,
  };
  const verification = Object.hasOwn(options, 'verification') ? options.verification : {
    status: 'enabled',
    merged: true,
    repository: 'owner/repository',
    default_branch: 'main',
  };
  const runner = action().createProgrammeSweepAction({
    env,
    root,
    verifyMergedGovernance: async () => verification,
    runProgrammeCli: async input => {
      calls.push(input);
      if (options.runProgrammeCli) return options.runProgrammeCli(input);
      return { status: 0, report: { metrics: 'requests=10, phase-read=1.2s, phase-write=0.3s', queue_left: 2, holds: [] } };
    },
    writeNotice: message => notices.push(message),
    writeFailure: message => failures.push(message),
    writeSummary: line => summaries.push(line),
  });
  return { runner, env, notices, failures, summaries, calls };
}

test('workflow uses only an off-peak hourly schedule and manual dispatch', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /^on:\r?\n  schedule:\r?\n    - cron: ['"]?\d+ \* \* \* \*['"]?\r?\n  workflow_dispatch:\s*$/m);
  assert.doesNotMatch(workflow, /^\s+(pull_request|pull_request_target|push):/m);
});

test('workflow grants the built-in token contents read only and disables persisted checkout credentials', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /^permissions:\r?\n  contents: read\s*$/m);
  assert.match(workflow, /^        uses: actions\/checkout@[0-9a-f]{40} # v[^\r\n]+\r?\n        with:\r?\n          ref: \$\{\{ github\.event\.repository\.default_branch \}\}\r?\n          persist-credentials: false$/m);
  assert.match(workflow, /GH_TOKEN:\s*\$\{\{\s*secrets\.TOOLKIT_GOVERNANCE_TOKEN\s*\}\}/);
  assert.doesNotMatch(workflow, /secrets\.(?!TOOLKIT_GOVERNANCE_TOKEN)[A-Z0-9_]+/);
  assert.doesNotMatch(workflow, /administration:\s*(?:read|write)|secrets:\s*(?:read|write)|workflows:\s*(?:read|write)/i);
});

test('workflow serialises this repository without cancelling and has a fifteen-minute timeout', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /concurrency:\r?\n  group: toolkit-programme-sweep-\$\{\{\s*github\.repository\s*\}\}\r?\n  cancel-in-progress: false/);
  assert.match(workflow, /timeout-minutes: 15/);
  assert.match(workflow, /ref: \$\{\{\s*github\.event\.repository\.default_branch\s*\}\}/);
});

test('unverified, disabled, mismatched or malformed governance never invokes refresh', async () => {
  for (const verification of [
    { status: 'disabled', merged: true },
    { status: 'enabled', merged: false },
    { status: 'enabled', merged: true, repository: 'other/repository' },
    { status: 'enabled', merged: true, default_branch: 'other' },
    null,
  ]) {
    const { runner, calls, notices, summaries } = makeEnabled({ verification });
    assert.equal(await runner.run(), 0);
    assert.deepEqual(calls, []);
    assert.equal(notices.length, 1);
    assert.deepEqual(summaries, []);
  }
});

test('missing shared secret gives a notice and exits successfully without invoking refresh', async () => {
  const { runner, calls, notices, failures, summaries } = makeEnabled({ env: { GH_TOKEN: '' } });

  assert.equal(await runner.run(), 0);
  assert.deepEqual(calls, []);
  assert.match(notices[0], /TOOLKIT_GOVERNANCE_TOKEN/);
  assert.deepEqual(failures, []);
  assert.deepEqual(summaries, []);
});

test('notice output uses the GitHub Actions notice command', () => {
  const lines = [];
  action().writeNoticeAnnotation('Programme Sweep skipped: test notice.', { write: line => lines.push(line) });
  assert.deepEqual(lines, ['::notice::Programme Sweep skipped: test notice.\n']);
});

test('enabled run passes the secret only to the injected CLI and writes the returned metrics summary', async () => {
  const { runner, calls, summaries, failures, notices } = makeEnabled();

  assert.equal(await runner.run(), 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].token, fakeSecret);
  assert.equal(calls[0].args.join(' '), 'refresh --json');
  assert.deepEqual(summaries, ['Programme Sweep metrics: requests=10, phase-read=1.2s, phase-write=0.3s; queue left: 2']);
  assert.deepEqual(failures, []);
  assert.deepEqual(notices, []);
});

test('rejected token failure is fixed text and never includes the key or error payload', async () => {
  const payload = `token rejected: ${fakeSecret}; private API response`;
  const { runner, failures, summaries } = makeEnabled({
    runProgrammeCli: async () => ({ status: 1, error_code: 'GH_AUTH', stderr: payload }),
  });

  assert.equal(await runner.run(), 1);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /TOOLKIT_GOVERNANCE_TOKEN/);
  assert.equal(failures[0].includes(fakeSecret), false);
  assert.equal(failures[0].includes('private API response'), false);
  assert.deepEqual(summaries, []);
});

test('refresh failure output and secret-bearing metrics are withheld', async () => {
  const failed = makeEnabled({ runProgrammeCli: async () => ({ status: 1, stderr: `failure ${fakeSecret}` }) });
  assert.equal(await failed.runner.run(), 1);
  assert.equal(failed.failures[0].includes(fakeSecret), false);

  const leaked = makeEnabled({ runProgrammeCli: async () => ({ status: 0, report: { metrics: `requests=1 ${fakeSecret}`, queue_left: 0 } }) });
  assert.equal(await leaked.runner.run(), 1);
  assert.equal(leaked.failures[0].includes(fakeSecret), false);
  assert.deepEqual(leaked.summaries, []);
});

test('a report with holds is resumable and an overlapping sweep gets a fixed queued summary', async () => {
  const held = makeEnabled({ runProgrammeCli: async () => ({
    status: 1,
    error_code: 'RESUMABLE_HOLD',
    report: { metrics: 'requests=4, phase-read=0.4s', queue_left: 2, holds: [{ code: 'PENDING' }] },
  }) });
  assert.equal(await held.runner.run(), 0);
  assert.match(held.summaries[0], /queue left: 2; pass held, next hourly run will retry/);
  assert.deepEqual(held.failures, []);

  const queued = makeEnabled({ runProgrammeCli: async () => ({ status: 0, report: { outcome: 'QUEUED', reason: `private ${fakeSecret}` } }) });
  assert.equal(await queued.runner.run(), 0);
  assert.deepEqual(queued.summaries, ['Programme Sweep queued: another refresh pass is still running; the next hourly run will retry.']);
  assert.deepEqual(queued.failures, []);
});

test('merged binding reader rejects a non-default ref before reading and validates repository identity', () => {
  const apiModule = action();
  let reads = 0;
  const base = { DEFAULT_BRANCH: 'main', GITHUB_REF: 'refs/heads/feature', GITHUB_REPOSITORY: 'owner/repository' };
  const unmerged = apiModule.readMergedGovernance({ root, env: base, readFile: () => { reads += 1; return '{}'; } });
  assert.notEqual(unmerged.status, 'enabled');
  assert.equal(reads, 0);

  const invalid = apiModule.readMergedGovernance({
    root,
    env: { ...base, GITHUB_REF: 'refs/heads/main' },
    readFile: () => JSON.stringify({ schema: 'toolkit.programme-binding.v2', repository: 'other/repository', governance: 'enabled' }),
    validateBinding: () => {},
  });
  assert.notEqual(invalid.status, 'enabled');
});

test('CLI execution uses an injected entry without a shell and never returns raw error text', () => {
  let call;
  const result = action().executeProgrammeCli({
    root,
    token: fakeSecret,
    cliEntry: path.join(root, 'fake-programme.cjs'),
    spawn: (...args) => {
      call = args;
      return { status: 1, stdout: '', stderr: `GH_AUTH: ${fakeSecret} private response` };
    },
    environment: { KEEP: 'yes', GITHUB_TOKEN: 'read-only-token', TOOLKIT_GOVERNANCE_TOKEN: 'not-injected', GH_TOKEN: 'parent-token' },
  });

  assert.equal(call[0], process.execPath);
  assert.deepEqual(call[1], [path.join(root, 'fake-programme.cjs'), 'refresh', '--json']);
  assert.equal(call[2].shell, undefined);
  assert.equal(call[2].env.GH_TOKEN, fakeSecret);
  assert.equal('GITHUB_TOKEN' in call[2].env, false);
  assert.equal('TOOLKIT_GOVERNANCE_TOKEN' in call[2].env, false);
  assert.equal(result.error_code, 'GH_AUTH');
  assert.equal(JSON.stringify(result).includes(fakeSecret), false);
  assert.equal(JSON.stringify(result).includes('private response'), false);
});

test('CLI preserves a held report on exit one and selects the last JSON report', () => {
  const first = { metrics: 'requests=1', queue_left: 3, holds: [] };
  const last = { metrics: 'requests=2, phase-read=0.3s', queue_left: 2, holds: [{ code: 'PENDING' }] };
  const result = action().executeProgrammeCli({
    root,
    token: fakeSecret,
    cliEntry: path.join(root, 'fake-programme.cjs'),
    spawn: () => ({ status: 1, stdout: `${JSON.stringify(first)}\n${JSON.stringify(last)}\n`, stderr: '' }),
    environment: {},
  });
  assert.equal(result.status, 1);
  assert.equal(result.error_code, 'RESUMABLE_HOLD');
  assert.deepEqual(result.report, last);
});

