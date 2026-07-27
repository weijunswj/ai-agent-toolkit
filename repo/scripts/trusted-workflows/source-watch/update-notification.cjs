#!/usr/bin/env node
'use strict';

const { SOURCE_WATCH_POLICY } = require('../writeback-policy.cjs');
const { fail } = require('../protocol.cjs');

function planAppendOnlyUpdate(input) {
  if (!input || !/^[0-9a-f]{40}$/.test(input.main_sha)) throw new Error('TW_SOURCE_WATCH_MAIN_SHA');
  if (!/^[0-9a-f]{12,64}$/.test(input.digest)) throw new Error('TW_SOURCE_WATCH_DIGEST');
  if (!input.branch_exists) {
    return { action: input.bytes_changed ? 'create-fast-forward' : 'no-change', base_sha: input.main_sha, branch: 'source-watch/' + input.digest.slice(0, 12) };
  }
  if (!/^[0-9a-f]{40}$/.test(input.old_sha) || !/^[0-9a-f]{40}$/.test(input.reread_sha)) throw new Error('TW_SOURCE_WATCH_BRANCH_SHA');
  if (input.old_sha !== input.reread_sha) return { action: 'retry-from-new-tip', observed_sha: input.reread_sha };
  if (!input.historical_safe) {
    return { action: 'supersede-and-create', old_sha: input.old_sha, branch: 'source-watch/' + input.digest.slice(0, 12) };
  }
  if (!input.bytes_changed) return { action: 'no-change', base_sha: input.old_sha };
  return { action: 'fast-forward', expected_old_sha: input.old_sha };
}

if (require.main === module) {
  if (SOURCE_WATCH_POLICY.publication_mode !== 'write' ||
      !SOURCE_WATCH_POLICY.scheduled_write_enabled ||
      !SOURCE_WATCH_POLICY.manual_canary_enabled) {
    fail('TW_SOURCE_WATCH_WRITE_DISABLED');
  }
  fail('TW_SOURCE_WATCH_ACTIVATION_NOT_IMPLEMENTED');
}

module.exports = Object.freeze({ planAppendOnlyUpdate });
