'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  compileEvidenceManifest,
} = require('../scripts/toolkit-evidence-plan-compiler.cjs');

function manifest() {
  return {
    schema: 'toolkit.evidence-manifest.v1',
    id: 'evidence-1',
    required_provenance: ['exact path', 'symbol or line identity'],
    questions: [
      {
        id: 'Q-ACTIONS',
        question: 'What materially equivalent action consumers exist?',
        targets: ['deriveAction', 'admitLaunch'],
        macros: ['SYMBOL_CONSUMER_SEARCH', 'AUTHORITY_ALIAS_INVENTORY'],
        stop_when: 'All direct, aliased, schema and test consumers are classified.',
        parallelizable: true,
      },
      {
        id: 'Q-ROUNDTRIP',
        question: 'Does CURRENT state preserve liveness meaning through restart?',
        targets: ['createCurrentProjection', 'deriveNextAdmissibleAction', 'transitionCurrent'],
        macros: ['STATE_ROUNDTRIP_INVENTORY'],
        stop_when: 'Create/derive/transition/serialize field semantics are mapped.',
        parallelizable: false,
      },
    ],
  };
}

test('evidence compiler creates leaf-ready bounded packets and deterministic merge order', () => {
  const plan = compileEvidenceManifest(manifest());
  assert.equal(plan.leaf_packets.length, 1);
  assert.equal(plan.serial_packets.length, 1);
  assert.deepEqual(plan.deterministic_merge.order, ['Q-ACTIONS', 'Q-ROUNDTRIP']);
  const leaf = plan.leaf_packets[0];
  assert.equal(leaf.mutation_allowed, false);
  assert.equal(leaf.architecture_decision_allowed, false);
  assert.equal(leaf.delegation_depth_remaining, 0);
  assert.ok(leaf.steps.some((step) => step.instruction.includes('direct consumers/imports/call sites')));
});

test('evidence plan is deterministic and preserves explicit stopping conditions', () => {
  const a = compileEvidenceManifest(manifest());
  const b = compileEvidenceManifest(manifest());
  assert.equal(a.plan_digest, b.plan_digest);
  assert.equal(a.source_manifest_digest, b.source_manifest_digest);
  assert.equal(a.leaf_packets[0].stop_when, 'All direct, aliased, schema and test consumers are classified.');
});

test('unknown evidence macro fails closed', () => {
  const input = manifest();
  input.questions[0].macros.push('PLEASE_IMPROVISE');
  assert.throws(() => compileEvidenceManifest(input), /unsupported evidence macro/);
});
