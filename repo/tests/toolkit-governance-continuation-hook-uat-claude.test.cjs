'use strict';

// Continuation through the Claude source hook entrypoint (shared body: support/governance-continuation-hook-uat.cjs).

const test = require('node:test');
const { sourceHookUat } = require('./support/governance-continuation-hook-uat.cjs');

test('Windows/source-hook UAT: the Claude entrypoint crosses both CLI families with isolated stdin and no state mutation', t => sourceHookUat(t, 'claude'));
