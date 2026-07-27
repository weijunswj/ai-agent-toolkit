#!/usr/bin/env node
'use strict';

const { SOURCE_WATCH_POLICY } = require('../writeback-policy.cjs');
const { fail } = require('../protocol.cjs');

function chooseNotificationPR(records, digest) {
  if (!Array.isArray(records) || !/^[0-9a-f]{12,64}$/.test(digest)) throw new Error('TW_SOURCE_WATCH_PR_INPUT');
  const branch = 'source-watch/' + digest.slice(0, 12);
  const matching = records.filter((record) => record && record.head === branch && record.state === 'open');
  if (matching.length > 1) throw new Error('TW_SOURCE_WATCH_PR_AMBIGUOUS');
  return matching.length === 1 ? { action: 'update-existing', number: matching[0].number, branch } : { action: 'create-one', branch };
}

if (require.main === module) {
  if (!SOURCE_WATCH_POLICY.general_publication_enabled) fail('TW_SOURCE_WATCH_PR_MUTATION_DISABLED');
  fail('TW_SOURCE_WATCH_ACTIVATION_NOT_IMPLEMENTED');
}

module.exports = Object.freeze({ chooseNotificationPR });
