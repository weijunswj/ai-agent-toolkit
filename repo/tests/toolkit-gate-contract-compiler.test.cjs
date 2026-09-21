'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  compileGateContract,
} = require('../scripts/toolkit-gate-contract-compiler.cjs');

function sample(overrides = {}) {
  return {
    schema: 'toolkit.gate-contract-ir.v1',
    run: 'run-1',
    lock: 'lock-1',
    source_stage: 'G2',
    target_stage: 'G3',
    mutation: {
      allow_paths: ['repo/a.cjs', 'repo/a.test.cjs'],
      forbid_extra_paths: true,
    },
    requirements: [
      {
        id: 'ACTION_AUTHORITY',
        invariant: 'Only exact launch tokens are executable.',
        surfaces: ['deriveAction', 'admitLaunch', 'schema'],
        macros: [
          {
            name: 'EXACT_ALLOWLIST',
            params: {
              field: 'next_admissible_action',
              allow: ['LAUNCH_G3_DIRECT'],
              accept: { launch_allowed: true },
              reject: { launch_allowed: false },
            },
          },
          {
            name: 'SPELLING_VARIANTS_REJECT',
            params: {
              field: 'next_admissible_action',
              allow: ['LAUNCH_G3_DIRECT'],
              expected: { launch_allowed: false },
            },
          },
        ],
      },
    ],
    required_validation: ['node --test repo/tests/a.test.cjs'],
    required_evidence: ['exact-head generated oracle results'],
    ...overrides,
  };
}

test('compiler expands exact action authority into forbidden spelling regressions', () => {
  const packet = compileGateContract(sample());
  const byValue = new Map(packet.generated_cases.map((item) => [item.input.next_admissible_action, item]));
  assert.equal(byValue.get('LAUNCH_G3_DIRECT').expected.launch_allowed, true);
  assert.equal(byValue.get('G3_EXECUTE').expected.launch_allowed, false);
  assert.equal(byValue.get('EXECUTE_G3').expected.launch_allowed, false);
  assert.equal(byValue.get('launch_g3_direct').expected.launch_allowed, false);
  assert.equal(packet.mutation.forbid_extra_paths, true);
  assert.deepEqual(packet.mutation.allow_paths, ['repo/a.cjs', 'repo/a.test.cjs']);
});

test('compiler output is deterministic and carries zero-inference stop rules', () => {
  const a = compileGateContract(sample());
  const b = compileGateContract(sample());
  assert.equal(a.packet_digest, b.packet_digest);
  assert.equal(a.source_contract_digest, b.source_contract_digest);
  assert.ok(a.prohibited_inference.some((item) => item.includes('Do not invent compatibility aliases')));
  assert.ok(a.stop_conditions.some((item) => item.includes('G2_CONTRACT_INCOMPLETE')));
});

test('compiler expands descriptor and roundtrip macros without asking G3 to invent cases', () => {
  const ir = sample({
    requirements: [
      {
        id: 'BOUNDARY',
        invariant: 'Rejected authority must execute zero accessors and roundtrip unchanged.',
        surfaces: ['create', 'transition'],
        macros: [
          { name: 'DESCRIPTOR_ZERO_READ', params: { fields: ['authority'], expected: { accessor_calls: 0 } } },
          { name: 'ROUNDTRIP_STATE_STABILITY', params: { sequence: ['create', 'derive', 'transition'], expected: { decision: 'STATE_STABLE' } } },
        ],
      },
    ],
  });
  const packet = compileGateContract(ir);
  assert.ok(packet.generated_cases.some((item) => item.id.includes('authority:own-getter')));
  assert.ok(packet.generated_cases.some((item) => item.id.endsWith('::roundtrip')));
});

test('unknown macros and scope-without-fail-closed are rejected', () => {
  assert.throws(() => compileGateContract(sample({ mutation: { allow_paths: ['repo/a.cjs'], forbid_extra_paths: false } })), /forbid_extra_paths/);
  const ir = sample();
  ir.requirements[0].macros = [{ name: 'MODEL_SHOULD_GUESS', params: {} }];
  assert.throws(() => compileGateContract(ir), /unsupported macro/);
});
