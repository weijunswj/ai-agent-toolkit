#!/usr/bin/env node
'use strict';

const { AUTO_SYNC_POLICY } = require('../writeback-policy.cjs');
const { result, fail, opaque } = require('../protocol.cjs');

if (process.argv.length !== 6) fail('TW_AUTOSYNC_PREFLIGHT_ARGUMENTS');
const [eventName, repository, baseRef, prNumber] = process.argv.slice(2);
if (!/^[1-9][0-9]*$/.test(prNumber)) fail('TW_AUTOSYNC_PREFLIGHT_PR');
const sameRepository = repository === process.env.GITHUB_REPOSITORY;
const eligibleEvent = ['pull_request_target', 'workflow_dispatch'].includes(eventName);
const approved = sameRepository && eligibleEvent && baseRef === 'main' && AUTO_SYNC_POLICY.rollout_stage === 'A';
result({
  approved,
  writeback_allowed: false,
  target: opaque(prNumber),
  policy: AUTO_SYNC_POLICY
});
