'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const config = require('../scripts/codex-delegation-config.cjs');

test('removal preview derives V2 affected keys from owned block when runtime is unknown', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-review-regression-'));
  const filePath = path.join(root, '.codex', 'config.toml');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `[features.multi_agent_v2]\n${config.expectedV2Block(1, '\n')}`);
  const preview = config.previewCodexDelegationRemoval(filePath, { runtime: config.RUNTIMES.UNKNOWN });
  assert.equal(preview.status, 'removal-preview');
  assert.match(preview.affected_keys.join('\n'), /features\.multi_agent_v2\.max_concurrent_threads_per_session/);
  assert.doesNotMatch(preview.affected_keys.join('\n'), /^agents\./m);
});

test('removal preview derives V2 affected keys from owned block when runtime is disabled', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-review-regression-'));
  const filePath = path.join(root, '.codex', 'config.toml');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `[features.multi_agent_v2]\n${config.expectedV2Block(1, '\n')}`);
  const preview = config.previewCodexDelegationRemoval(filePath, { runtime: config.RUNTIMES.DISABLED });
  assert.equal(preview.status, 'removal-preview');
  assert.match(preview.affected_keys.join('\n'), /features\.multi_agent_v2\.max_concurrent_threads_per_session/);
  assert.doesNotMatch(preview.affected_keys.join('\n'), /^agents\./m);
});
