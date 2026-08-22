'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const runtimePath = path.join(repoRoot, 'repo', 'scripts', 'toolkit-trusted-ci-repository-protection.cjs');
const workflowPath = path.join(repoRoot, 'repo', 'scripts', 'toolkit-trusted-ci-repository-protection-workflow.cjs');

test('N6 deterministic runtime and protected workflow validator exist', () => {
  assert.equal(fs.existsSync(runtimePath), true);
  assert.equal(fs.existsSync(workflowPath), true);
  const runtime = require(runtimePath);
  const workflow = require(workflowPath);
  assert.equal(runtime.CONTRACT_VERSION, 'toolkit.n6.trusted-ci-repository-protection.v1');
  assert.equal(workflow.CONTRACT_VERSION, 'toolkit.n6.protected-ci-gate-workflow.v1');
});

test('N6 rejects counterfeit publisher and ambiguous protection ownership', () => {
  const runtime = require(runtimePath);
  assert.equal(runtime.validatePublisher({ integration_id: 'actions', publisher: 'GitHub Actions' }).ok, false);
  assert.equal(runtime.classifyProtectionOwnership({ rulesets: [{ name: 'protect-main', source: 'unknown' }] }).code, 'OWNERSHIP_AMBIGUOUS');
});
