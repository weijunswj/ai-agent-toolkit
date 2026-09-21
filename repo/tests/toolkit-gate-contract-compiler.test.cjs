'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  SUPPORTED_MACROS,
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


test('schema macro vocabulary exactly matches compiler macro vocabulary', () => {
  const schema = require('../contracts/controller-kernel/gate-contract-ir-v1.schema.json');
  const schemaMacros = schema.properties.requirements.items.properties.macros.items.properties.name.enum;
  assert.deepEqual([...schemaMacros].sort(), [...SUPPORTED_MACROS].sort());
});

test('every adversarial macro family compiles into at least one concrete G3 oracle', () => {
  const macros = [
    { name: 'EXACT_ALLOWLIST', params: { field: 'action', allow: ['LAUNCH_G3_DIRECT'], reject_values: ['G3_EXECUTE'] } },
    { name: 'SPELLING_VARIANTS_REJECT', params: { field: 'action', allow: ['LAUNCH_G3_DIRECT'] } },
    { name: 'ALIAS_CLOSURE', params: { aliases: ['launchOutcome', 'launch_outcome'], value: 'AMBIGUOUS' } },
    { name: 'TRISTATE_UNKNOWN_AMBIGUOUS', params: { field: 'state', states: ['UNKNOWN', 'AMBIGUOUS'] } },
    { name: 'CONTRADICTORY_EVIDENCE', params: { pairs: [{ route_available: false, verifier: true }, { bound_route: 'expected', runtime_route: 'different' }] } },
    { name: 'OWN_VS_INHERITED_PROPERTY', params: { field: 'binding', value: 'historical' } },
    { name: 'NULLISH_DEFAULT_MATRIX', params: { field: 'registry' } },
    { name: 'DESCRIPTOR_ZERO_READ', params: { fields: ['authority'] } },
    { name: 'ROUNDTRIP_STATE_STABILITY', params: { sequence: ['create', 'derive', 'transition'] } },
    { name: 'STRUCTURAL_REVALIDATION', params: { surfaces: ['reconcile'], malformed: { parent_registry: { Q: { lifecycle: 'CURRENT' } } } } },
    { name: 'SECRET_PATTERN_PARITY', params: { patterns: ['sk-SYNTHETIC', 'passwd=SYNTHETIC'], surfaces: ['render', 'reconcile'] } },
    { name: 'PUBLIC_ALIAS_SURFACE_PARITY', params: { surfaces: ['direct', 'v5'], input: { marker: 'same' } } },
  ];
  const ir = sample({
    requirements: [{
      id: 'ALL_MACROS',
      invariant: 'All selected macro families are materialised deterministically.',
      surfaces: ['surface-a', 'surface-b'],
      macros,
    }],
  });
  const packet = compileGateContract(ir);
  const emitted = new Set(packet.generated_cases.map((item) => item.macro));
  assert.deepEqual([...emitted].sort(), [...SUPPORTED_MACROS].sort());
  for (const macro of SUPPORTED_MACROS) {
    assert.ok(packet.generated_cases.some((item) => item.macro === macro), `missing generated cases for ${macro}`);
  }
});

test('human-bound routing law forbids executor self-attestation while preserving no-silent-fallback', () => {
  const root = path.resolve(__dirname, '..', '..');
  const controller = fs.readFileSync(path.join(root, 'repo', 'CONTROLLER.md'), 'utf8');
  const architecture = fs.readFileSync(path.join(root, 'repo', 'ARCHITECTURE.md'), 'utf8');
  for (const text of [controller, architecture]) {
    assert.match(text, /human|launcher/i);
    assert.match(text, /missing runtime model metadata is (?:never|not) a HOLD/i);
    assert.match(text, /silent (?:route\/model )?fallback/i);
  }
  assert.match(controller, /executor\/LLM must never inspect, prove, attest, infer, reject, or block on its own provider\/model\/reasoning identity/i);
  assert.doesNotMatch(controller, /cannot launch and verify it/i);
  assert.doesNotMatch(controller, /launcher\/runtime must verify the resolved route/i);
});


test('compiler fails closed on missing oracle coverage, validation, evidence, and malformed explicit cases', () => {
  const noOracle = sample();
  noOracle.requirements[0].macros = [];
  assert.throws(() => compileGateContract(noOracle), /at least one macro or explicit case/);

  assert.throws(() => compileGateContract(sample({ required_validation: [] })), /required_validation/);
  assert.throws(() => compileGateContract(sample({ required_evidence: [] })), /required_evidence/);

  const explicit = sample();
  explicit.requirements[0].macros = [];
  explicit.requirements[0].cases = [{ id: 'BAD', input: {}, expected: null }];
  assert.throws(() => compileGateContract(explicit), /case.expected must be an object/);
});
