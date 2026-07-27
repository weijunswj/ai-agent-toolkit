'use strict';

const AUTO_SYNC_POLICY = Object.freeze({
  rollout_stage: 'A',
  writeback_enabled: false,
  general_enabled: false
});

const SOURCE_WATCH_POLICY = Object.freeze({
  rollout_stage: 'A',
  publication_mode: 'dry-run',
  scheduled_write_enabled: false,
  manual_canary_enabled: false,
  general_publication_enabled: false
});

module.exports = Object.freeze({ AUTO_SYNC_POLICY, SOURCE_WATCH_POLICY });
