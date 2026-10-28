'use strict';

// Continuation through the Codex source hook entrypoint (shared body: support/governance-continuation-hook-uat.cjs).

const test = require('node:test');
const { sourceHookUat } = require('./support/governance-continuation-hook-uat.cjs');

test('Windows/source-hook UAT: the Codex entrypoint crosses both CLI families with isolated stdin and no state mutation', t => sourceHookUat(t, 'codex'));
