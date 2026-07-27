#!/usr/bin/env node
'use strict';

const { AUTO_SYNC_POLICY } = require('../writeback-policy.cjs');
const { result } = require('../protocol.cjs');

result({
  approved: false,
  reason_code: 'TW_AUTOSYNC_STAGE_A_WRITE_DISABLED',
  commit_attempts: 0,
  push_attempts: 0,
  policy: AUTO_SYNC_POLICY
});
