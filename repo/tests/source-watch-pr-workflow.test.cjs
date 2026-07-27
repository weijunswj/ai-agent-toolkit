'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const YAML = require('yaml');

const repoRoot = path.resolve(__dirname, '..', '..');
const workflowPath = path.join(repoRoot, '.github', 'workflows', 'source-watch-pr.yml');
const text = fs.readFileSync(workflowPath, 'utf8');
const workflow = YAML.parse(text);

test('source-watch Stage A has schedule and manual dry-run triggers only', function() {
  assert.ok(workflow.on.schedule);
  assert.ok(Object.hasOwn(workflow.on, 'workflow_dispatch'));
  for (const trigger of ['pull_request', 'pull_request_target', 'push', 'repository_dispatch', 'workflow_call']) {
    assert.equal(Object.hasOwn(workflow.on, trigger), false);
  }
});

test('source-watch Stage A permissions and policy are read-only', function() {
  assert.deepEqual(workflow.permissions, { contents: 'read', 'pull-requests': 'read' });
  assert.equal(workflow.env.ROLLOUT_STAGE, 'A');
  assert.equal(workflow.env.PUBLICATION_MODE, 'dry-run');
  assert.equal(workflow.env.SCHEDULED_WRITE_ENABLED, 'false');
  assert.equal(workflow.env.MANUAL_CANARY_ENABLED, 'false');
  assert.equal(workflow.env.GENERAL_PUBLICATION_ENABLED, 'false');
});

test('source-watch Stage A has no branch, commit, push or PR mutation command', function() {
  for (const pattern of [
    /\bgit\s+(?:switch|checkout|branch|commit|push|reset|rebase)\b/i,
    /\bgh\s+pr\s+(?:create|edit|close|reopen|merge)\b/i,
    /force(?:-with-lease)?/i
  ]) assert.doesNotMatch(text, pattern);
});

test('source-watch trusted main is verified before its dry-run helper executes', function() {
  const steps = workflow.jobs.notify.steps;
  const checkout = steps.findIndex(function(step) { return step.id === 'checkout_trusted_main'; });
  const bootstrap = steps.findIndex(function(step) { return step.name === 'Bootstrap trusted helper bytes'; });
  const capture = steps.findIndex(function(step) { return step.name === 'Capture setup-node executable identity'; });
  const verify = steps.findIndex(function(step) { return step.name === 'Verify trusted execution closure'; });
  const dryRun = steps.findIndex(function(step) { return step.name === 'Emit deterministic dry-run proposal'; });
  assert.ok(checkout < bootstrap && bootstrap < capture && capture < verify && verify < dryRun);
  assert.equal(steps[checkout].with['persist-credentials'], false);
});
