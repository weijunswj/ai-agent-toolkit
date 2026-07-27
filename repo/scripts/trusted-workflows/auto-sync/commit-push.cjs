#!/usr/bin/env node
'use strict';

const { AUTO_SYNC_POLICY } = require('../writeback-policy.cjs');
const { fail } = require('../protocol.cjs');

if (!AUTO_SYNC_POLICY.writeback_enabled || !AUTO_SYNC_POLICY.general_enabled) {
  fail('TW_AUTOSYNC_WRITE_DISABLED');
}
fail('TW_AUTOSYNC_ACTIVATION_NOT_IMPLEMENTED');
