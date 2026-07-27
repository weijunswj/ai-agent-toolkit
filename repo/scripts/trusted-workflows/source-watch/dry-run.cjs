#!/usr/bin/env node
'use strict';

const { SOURCE_WATCH_POLICY } = require('../writeback-policy.cjs');
const { result } = require('../protocol.cjs');

result({
  mode: 'dry-run',
  proposal_ready: true,
  branch_attempts: 0,
  commit_attempts: 0,
  push_attempts: 0,
  pr_mutation_attempts: 0,
  issue_mutation_attempts: 0,
  policy: SOURCE_WATCH_POLICY
});
