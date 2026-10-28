'use strict';

// Continuation through the Codex source hook entrypoint (shared body: support/governance-continuation-hook-uat.cjs).
// Sources it covers, named here so run-tests.cjs --changed selects this file: toolkit-governance-gate.cjs,
// toolkit-governance-continuation.cjs, toolkit-governance-hook.cjs, toolkit-codex-helper-hook.cjs,
// governance-continuation-matrix.json and governance-continuation-fixture.cjs.

const test = require('node:test');
const { sourceHookUat } = require('./support/governance-continuation-hook-uat.cjs');

test('Windows/source-hook UAT: the Codex entrypoint crosses both CLI families with isolated stdin and no state mutation', t => sourceHookUat(t, 'codex'));
