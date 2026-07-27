'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const verifier = path.join(repoRoot, 'repo', 'scripts', 'verify-existing-base-autosync-run.cjs');

function evidence() {
  const head = '1ec500712bdf043ab261cbbe2b4003713d3ebfee';
  return {
    pr_number: 310, h0: '0'.repeat(40), h1: head, remote_head: head,
    event: 'pull_request_target', action: 'synchronize', event_head: head,
    run_count: 1, conclusion: 'success',
    steps: {
      'Preflight guard': 'success',
      'Checkout trusted base revision': 'skipped',
      'Checkout PR head commit': 'skipped',
      'Commit generated surfaces': 'skipped',
      'Push generated surfaces': 'skipped'
    },
    commit_attempts: 0, push_attempts: 0, remote_head_after: head, unexplained_commits: 0
  };
}

function run(value) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'existing-base-proof-'));
  const file = path.join(root, 'evidence.json');
  fs.writeFileSync(file, JSON.stringify(value));
  const result = spawnSync(process.execPath, [verifier, '--input', file], { cwd: repoRoot, encoding: 'utf8', timeout: 5000 });
  fs.rmSync(root, { recursive: true, force: true });
  return result;
}

test('existing-base evidence verifier accepts exact non-write synchronize proof', function() {
  const result = run(evidence());
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^\{[^\r\n]*\}\n$/);
});

test('existing-base evidence verifier rejects any reached commit or push step', function() {
  const value = evidence();
  value.steps['Commit generated surfaces'] = 'success';
  assert.equal(run(value).status, 2);
  value.steps['Commit generated surfaces'] = 'skipped';
  value.push_attempts = 1;
  assert.equal(run(value).status, 2);
});

test('existing-base evidence verifier rejects missing, ambiguous or moved heads', function() {
  for (const mutate of [
    function(value) { value.run_count = 0; },
    function(value) { value.run_count = 2; },
    function(value) { value.remote_head_after = 'f'.repeat(40); }
  ]) {
    const value = evidence();
    mutate(value);
    assert.equal(run(value).status, 2);
  }
});
