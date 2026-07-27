#!/usr/bin/env node
'use strict';

const { result, fail, opaque } = require('../protocol.cjs');

if (process.argv.length !== 3) fail('TW_SOURCE_WATCH_PLAN_ARGUMENTS');
result({ proposal_ready: true, input_identity: opaque(process.argv[2]), writes_allowed: false });
