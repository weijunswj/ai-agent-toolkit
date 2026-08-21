'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const runtime = require('../scripts/toolkit-assurance-web-finality.cjs');

function report(overrides = {}) {
  return {
    verdict: 'PASS_AND_STOP',
    material_blocker: false,
    verified_result: 'required-evidence-and-g4-pass',
    mutation_state: { attempted: false, performed: false },
    unchanged_scope: ['A1', 'A2', 'A3'],
    next_action: 'WEB_PROCEED_TO_FINALITY_REVALIDATION',
    ...overrides,
  };
}

test('absolute and parent-traversal scope identifiers are rejected', () => {
  for (const relative_scope_ids of [['../private'], ['/absolute'], ['C:/private']]) {
    const result = runtime.createReport(report({ relative_scope_ids }));
    assert.equal(result.code, 'REPORT_CONTRACT_INVALID');
  }
});

test('optional report fields remain bounded typed evidence', () => {
  assert.equal(runtime.createReport(report({ counts: { findings: 0 } })).accepted, true);
  assert.equal(runtime.createReport(report({ counts: { findings: 'zero' } })).code, 'REPORT_CONTRACT_INVALID');
  assert.equal(runtime.createReport(report({ model_class: 'GPT-5.6 Sol High' })).accepted, true);
});
