'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const config = require('../scripts/codex-delegation-config.cjs');

// Every temp folder a test makes is removed after the file's tests, also when they fail.
const tempFolders = [];
test.after(() => { for (const dir of tempFolders) fs.rmSync(dir, { recursive: true, force: true }); });
function tempFolder(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempFolders.push(dir);
  return dir;
}

test('removal preview derives V2 affected keys from owned block when runtime is unknown', () => {
  const root = tempFolder('toolkit-review-regression-');
  const filePath = path.join(root, '.codex', 'config.toml');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `[features.multi_agent_v2]\n${config.expectedV2Block(1, '\n')}`);
  const preview = config.previewCodexDelegationRemoval(filePath, { runtime: config.RUNTIMES.UNKNOWN });
  assert.equal(preview.status, 'removal-preview');
  assert.match(preview.affected_keys.join('\n'), /features\.multi_agent_v2\.max_concurrent_threads_per_session/);
  assert.doesNotMatch(preview.affected_keys.join('\n'), /^agents\./m);
});

test('removal preview derives V2 affected keys from owned block when runtime is disabled', () => {
  const root = tempFolder('toolkit-review-regression-');
  const filePath = path.join(root, '.codex', 'config.toml');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `[features.multi_agent_v2]\n${config.expectedV2Block(1, '\n')}`);
  const preview = config.previewCodexDelegationRemoval(filePath, { runtime: config.RUNTIMES.DISABLED });
  assert.equal(preview.status, 'removal-preview');
  assert.match(preview.affected_keys.join('\n'), /features\.multi_agent_v2\.max_concurrent_threads_per_session/);
  assert.doesNotMatch(preview.affected_keys.join('\n'), /^agents\./m);
});

test('approved V2 removal executes under unknown and disabled runtime detection', () => {
  for (const runtime of [config.RUNTIMES.UNKNOWN, config.RUNTIMES.DISABLED]) {
    const root = tempFolder('toolkit-review-removal-execute-');
    const filePath = path.join(root, '.codex', 'config.toml');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `[features.multi_agent_v2]\n${config.expectedV2Block(1, '\n')}`);
    const preview = config.previewCodexDelegationRemoval(filePath, { runtime });
    const removed = config.removeCodexDelegation(filePath, {
      runtime,
      approveCapacityResetRisk: true,
      approvedProposal: preview.approval_binding,
      backupGenerationId: preview.backup_generation_id,
    });
    assert.equal(removed.status, 'removed');
    assert.equal(removed.changed, true);
    assert.doesNotMatch(fs.readFileSync(filePath, 'utf8'), /AI-AGENT-TOOLKIT:CODEX-DELEGATION/);
  }
});
