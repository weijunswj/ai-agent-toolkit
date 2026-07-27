#!/usr/bin/env node
'use strict';

const { result, fail, opaque } = require('../protocol.cjs');

if (process.argv.length !== 4 || !/^[0-9a-f]{40}$/.test(process.argv[2]) || !/^[0-9a-f]{40}$/.test(process.argv[3])) {
  fail('TW_AUTOSYNC_HEAD_ARGUMENTS');
}
result({ matches: process.argv[2] === process.argv[3], expected: opaque(process.argv[2]), observed: opaque(process.argv[3]) });
