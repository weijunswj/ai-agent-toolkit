'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const Ajv2020 = require('ajv/dist/2020');
const {
  SUPPORTED_MACROS,
  compileGateContract,
  hashCanonical,
  renderG3ExecutionPacket,
  validateG3ExecutionPacket,
} = require('../scripts/toolkit-gate-contract-compiler.cjs');

const MACRO_NAMES = [...SUPPORTED_MACROS];

function validParams(name) {
  const expected = { outcome: 'ACCEPT' };
  switch (name) {
    case 'EXACT_ALLOWLIST':
      return { field: 'action', allow: ['LAUNCH_G3_DIRECT'], reject_values: ['G3_EXECUTE'], accept: expected, reject: { outcome: 'REJECT' } };
    case 'SPELLING_VARIANTS_REJECT':
      return { field: 'action', allow: ['LAUNCH_G3_DIRECT'], expected: { outcome: 'REJECT' } };
    case 'ALIAS_CLOSURE':
      return { aliases: ['launchOutcome', 'launch_outcome'], value: 'BOUND', expected: { outcome: 'ACCEPT' } };
    case 'TRISTATE_UNKNOWN_AMBIGUOUS':
      return { field: 'state', states: ['UNKNOWN', 'AMBIGUOUS'], expected: { outcome: 'RECONCILE' } };
    case 'CONTRADICTORY_EVIDENCE':
      return { pairs: [{ left: { bound: true }, right: { bound: false } }], expected: { outcome: 'REJECT' } };
    case 'OWN_VS_INHERITED_PROPERTY':
      return { field: 'binding', value: 'BOUND', expected: { outcome: 'SAME' } };
    case 'NULLISH_DEFAULT_MATRIX':
      return { field: 'route', expected: { outcome: 'FAIL_CLOSED' } };
    case 'DESCRIPTOR_ZERO_READ':
      return { fields: ['authority'], expected: { accessor_calls: 0, outcome: 'REJECT' } };
    case 'ROUNDTRIP_STATE_STABILITY':
      return { sequence: ['create', 'derive', 'transition'], fixture: { state: 'BOUND' }, expected: { state_before: { state: 'BOUND' }, state_after: { state: 'BOUND' } } };
    case 'STRUCTURAL_REVALIDATION':
      return { surfaces: ['surface-a'], malformed: { invalid: true }, expected: { outcome: 'REJECT' } };
    case 'SECRET_PATTERN_PARITY':
      return { patterns: ['token-SYNTHETIC'], surfaces: ['surface-a'], expected: { outcome: 'REJECT' } };
    case 'PUBLIC_ALIAS_SURFACE_PARITY':
      return { surfaces: ['surface-a'], input: {}, expected: { outcome: 'SAME' } };
    default:
      throw new Error(`Unknown test macro ${name}`);
  }
}

function requirement(id, macros, overrides = {}) {
  return {
    id,
    invariant: 'The accepted invariant is enforced at every declared surface.',
    surfaces: ['surface-a', 'surface-b'],
    macros,
    ...overrides,
  };
}

function ir(overrides = {}) {
  return {
    schema: 'toolkit.gate-contract-ir.v1',
    run: 'toolkit-c1-compiled-contract-g2-reclosure-20260921-058',
    lock: 'DL-C1-COMPILED-CONTRACT-G2-RECLOSURE-058',
    source_stage: 'G2',
    target_stage: 'G3',
    mutation: {
      allow_paths: ['repo/CONTROLLER.md', 'repo/scripts/toolkit-gate-contract-compiler.cjs'],
      forbid_extra_paths: true,
    },
    requirements: [
      requirement('REQ_A', [{ name: 'EXACT_ALLOWLIST', params: validParams('EXACT_ALLOWLIST') }]),
    ],
    required_validation: ['node --test repo/tests/toolkit-gate-contract-compiler.test.cjs'],
    required_evidence: ['exact generated oracle results'],
    ...overrides,
  };
}

function allMacroIr() {
  return ir({
    requirements: [requirement('ALL_MACROS', MACRO_NAMES.map((name) => ({ name, params: validParams(name) })))],
  });
}

function singleMacro(name, params = validParams(name), surfaces = ['surface-a']) {
  return ir({
    requirements: [{
      id: 'REQ_SINGLE',
      invariant: 'One exact macro is compiled without semantic defaults.',
      surfaces,
      macros: [{ name, params }],
    }],
  });
}

function outcome(execute) {
  try {
    return { kind: 'ACCEPT', value: execute() };
  } catch (error) {
    return { kind: error.code === 'GATE_CONTRACT_IR_INVALID' ? 'REJECT' : 'ORACLE_FAILURE', error };
  }
}

function rejectedBy(execute) {
  const result = outcome(execute);
  assert.equal(result.kind, 'REJECT');
  assert.equal(result.error.code, 'GATE_CONTRACT_IR_INVALID');
  return result;
}

const gateOracleRows = [];
function gateRow(id, expected, execute) {
  gateOracleRows.push({ id, expected, execute });
}

gateRow('F1-01', 'ACCEPT', () => {
  const packet = compileGateContract(singleMacro('EXACT_ALLOWLIST'));
  assert.ok(packet.generated_cases.every((item) => item.assertions.length > 0 && item.assertion_count > 0));
  return packet;
});
gateRow('F1-02', 'REJECT', () => compileGateContract(singleMacro('SPELLING_VARIANTS_REJECT', { field: 'action', allow: ['ok'], expected: { outcome: 'REJECT' } })));
gateRow('F1-03', 'REJECT', () => compileGateContract(singleMacro('SPELLING_VARIANTS_REJECT', { field: 'action', allow: ['OK', 'ok'], expected: { outcome: 'REJECT' } })));
gateRow('F1-04', 'REJECT', () => compileGateContract(singleMacro('EXACT_ALLOWLIST', { ...validParams('EXACT_ALLOWLIST'), accept: {} })));
gateRow('F1-05', 'ACCEPT', () => compileGateContract(singleMacro('EXACT_ALLOWLIST', { ...validParams('EXACT_ALLOWLIST'), accept: { decision: 'REJECT' } })));
gateRow('F1-06', 'REJECT', () => {
  const value = singleMacro('SPELLING_VARIANTS_REJECT', { field: 'action', allow: ['ok'], expected: { outcome: 'REJECT' } }, ['surface-a']);
  value.requirements[0].cases = [{ id: 'VALID_CASE', input: {}, expected: { outcome: 'ACCEPT' } }];
  return compileGateContract(value);
});
gateRow('F1-07', 'REJECT', () => compileGateContract(singleMacro('PUBLIC_ALIAS_SURFACE_PARITY', { surfaces: ['surface-a'], input: {}, expected: {} })));
gateRow('F1-08', 'ACCEPT', () => {
  const packet = compileGateContract(singleMacro('EXACT_ALLOWLIST', { ...validParams('EXACT_ALLOWLIST'), accept: { items: [] } }));
  assert.deepEqual(packet.generated_cases[0].expected, { items: [] });
  return packet;
});
gateRow('F1-09', 'ORACLE_FAILURE', () => {
  const packet = compileGateContract(singleMacro('EXACT_ALLOWLIST'));
  const assertion = packet.generated_cases[0].assertions.find((item) => item.path[0] === 'outcome');
  const actual = {};
  return Object.hasOwn(actual, assertion.path[0]) ? { kind: 'ACCEPT' } : { kind: 'ORACLE_FAILURE' };
});

gateRow('F2-01', 'ACCEPT', () => {
  const packet = compileGateContract(allMacroIr());
  assert.deepEqual([...new Set(packet.generated_cases.map((item) => item.macro))].sort(), [...SUPPORTED_MACROS].sort());
  return packet;
});
for (const name of MACRO_NAMES) {
  gateRow(`F2-02:${name}:unknown`, 'REJECT', () => {
    const params = { ...validParams(name), unsupported_parameter: true };
    return compileGateContract(singleMacro(name, params));
  });
  for (const field of Object.keys(validParams(name))) {
    gateRow(`F2-03:${name}:${field}:missing`, 'REJECT', () => {
      const params = { ...validParams(name) };
      delete params[field];
      return compileGateContract(singleMacro(name, params));
    });
    gateRow(`F2-04:${name}:${field}:wrong-type`, 'REJECT', () => {
      const params = { ...validParams(name) };
      if (field === 'value') params[field] = () => 'not-json';
      else if (field === 'input' || field === 'fixture' || field === 'accept' || field === 'reject' || field === 'expected' || field === 'malformed') params[field] = [];
      else if (field === 'allow' || field === 'reject_values' || field === 'aliases' || field === 'states' || field === 'pairs' || field === 'fields' || field === 'sequence' || field === 'patterns' || field === 'surfaces') params[field] = {};
      else params[field] = 7;
      return compileGateContract(singleMacro(name, params));
    });
  }
}
gateRow('F2-05', 'REJECT', () => compileGateContract(singleMacro('ALIAS_CLOSURE', { aliases: ['one', 'two'], expected: { outcome: 'SAME' } })));
gateRow('F2-06', 'REJECT', () => compileGateContract(singleMacro('ALIAS_CLOSURE', { aliases: ['one', 'two'], value: undefined, expected: { outcome: 'SAME' } })));
for (const value of [null, false, 0, '']) {
  gateRow(`F2-07:${JSON.stringify(value)}`, 'ACCEPT', () => {
    const packet = compileGateContract(singleMacro('ALIAS_CLOSURE', { aliases: ['one', 'two'], value, expected: { outcome: 'SAME' } }));
    assert.deepEqual(packet.generated_cases[0].input.value, value);
    assert.deepEqual(JSON.parse(JSON.stringify(packet.generated_cases[0].input.value)), value);
    return packet;
  });
}
gateRow('F2-08', 'REJECT', () => compileGateContract(singleMacro('EXACT_ALLOWLIST', { ...validParams('EXACT_ALLOWLIST'), expected: { outcome: 'REJECT' } })));
gateRow('F2-09', 'REJECT', () => compileGateContract(singleMacro('EXACT_ALLOWLIST', { ...validParams('EXACT_ALLOWLIST'), expected: { outcome: 'REJECT' } })));
gateRow('F2-10', 'REJECT', () => compileGateContract(singleMacro('EXACT_ALLOWLIST', { ...validParams('EXACT_ALLOWLIST'), reject_values: ['LAUNCH_G3_DIRECT'] })));
gateRow('F2-11', 'REJECT', () => compileGateContract(singleMacro('CONTRADICTORY_EVIDENCE', { pairs: [{ left: { a: 1 }, right: { a: 1 } }], expected: { outcome: 'REJECT' } })));
gateRow('F2-12', 'REJECT', () => compileGateContract(singleMacro('DESCRIPTOR_ZERO_READ', { fields: ['authority'], expected: { outcome: 'REJECT' } })));
for (const mutation of [
  ['fixture-missing', (params) => { delete params.fixture; }],
  ['sequence-short', (params) => { params.sequence = ['create']; }],
  ['snapshots-differ', (params) => { params.expected.state_after = { state: 'DIFFERENT' }; }],
]) {
  gateRow(`F2-13:${mutation[0]}`, 'REJECT', () => {
    const params = validParams('ROUNDTRIP_STATE_STABILITY');
    mutation[1](params);
    return compileGateContract(singleMacro('ROUNDTRIP_STATE_STABILITY', params));
  });
}
for (const invalid of [
  ['function', () => () => true],
  ['symbol', () => Symbol('invalid')],
  ['undefined', () => undefined],
  ['accessor', () => { const value = {}; Object.defineProperty(value, 'read', { enumerable: true, get() { return 1; } }); return value; }],
  ['non-enumerable', () => { const value = {}; Object.defineProperty(value, 'hidden', { enumerable: false, value: 1 }); return value; }],
  ['symbol-property', () => { const value = {}; value[Symbol('hidden')] = 1; return value; }],
  ['custom-prototype', () => Object.create({ inherited: true })],
  ['sparse-array', () => { const value = []; value.length = 1; return value; }],
  ['non-finite', () => Infinity],
  ['negative-zero', () => -0],
  ['cycle', () => { const value = {}; value.self = value; return value; }],
]) {
  gateRow(`F2-14:${invalid[0]}`, 'REJECT', () => compileGateContract(singleMacro('ALIAS_CLOSURE', { aliases: ['one', 'two'], value: invalid[1](), expected: { outcome: 'SAME' } })));
}

function exclusion(surface, overrides = {}) {
  return {
    surface,
    author_stage: 'G2',
    run: 'toolkit-c1-compiled-contract-g2-reclosure-20260921-058',
    lock: 'DL-C1-COMPILED-CONTRACT-G2-RECLOSURE-058',
    reason_code: 'G2_EXPLICIT_EXCLUSION',
    reason: 'The accepted G2 contract explicitly excludes this surface.',
    authority_ref: '#435 comment 5763255507',
    ...overrides,
  };
}

gateRow('F3-01', 'REJECT', () => compileGateContract(ir({ requirements: [requirement('SURFACES', [{ name: 'PUBLIC_ALIAS_SURFACE_PARITY', params: { surfaces: ['surface-a'], input: {}, expected: { outcome: 'SAME' } } }])] })));
gateRow('F3-02', 'ACCEPT', () => {
  const packet = compileGateContract(ir({ requirements: [requirement('SURFACES', [{ name: 'PUBLIC_ALIAS_SURFACE_PARITY', params: { surfaces: ['surface-a'], input: {}, expected: { outcome: 'SAME' } } }], { exclusions: [exclusion('surface-b')] })] }));
  assert.equal(packet.coverage_map[0].surfaces.find((item) => item.surface === 'surface-b').status, 'EXCLUDED');
  return packet;
});
for (const mutation of [
  ['wrong-run', { run: 'wrong-run' }],
  ['wrong-lock', { lock: 'wrong-lock' }],
  ['blank-reason', { reason: ' ' }],
  ['missing-authority', { authority_ref: undefined }],
]) {
  gateRow(`F3-03:${mutation[0]}`, 'REJECT', () => {
    const item = exclusion('surface-b', mutation[1]);
    return compileGateContract(ir({ requirements: [requirement('SURFACES', [{ name: 'PUBLIC_ALIAS_SURFACE_PARITY', params: { surfaces: ['surface-a'], input: {}, expected: { outcome: 'SAME' } } }], { exclusions: [item] })] }));
  });
}
gateRow('F3-04', 'ACCEPT', () => compileGateContract(ir({ requirements: [requirement('SURFACES', [{ name: 'EXACT_ALLOWLIST', params: validParams('EXACT_ALLOWLIST') }])] })));
gateRow('F3-05', 'ORACLE_FAILURE', () => {
  const packet = compileGateContract(ir({ requirements: [{ id: 'SURFACES', invariant: 'Both surfaces must agree.', surfaces: ['surface-a', 'surface-b'], macros: [], cases: [
    { id: 'A', surface: 'surface-a', input: { action: 'x' }, expected: { outcome: 'REJECT' } },
    { id: 'B', surface: 'surface-b', input: { action: 'x' }, expected: { outcome: 'ALLOW' } },
  ] }] }));
  const b = packet.generated_cases.find((item) => item.surface === 'surface-b');
  return b.expected.outcome === 'ALLOW' ? { kind: 'ORACLE_FAILURE' } : { kind: 'ACCEPT' };
});
gateRow('F3-06', 'REJECT', () => compileGateContract(singleMacro('PUBLIC_ALIAS_SURFACE_PARITY', { surfaces: ['surface-c'], input: {}, expected: { outcome: 'SAME' } }, ['surface-a', 'surface-b'])));
gateRow('F3-07', 'REJECT', () => compileGateContract(ir({ requirements: [requirement('SURFACES', [{ name: 'PUBLIC_ALIAS_SURFACE_PARITY', params: { surfaces: ['surface-b'], input: {}, expected: { outcome: 'SAME' } } }], { exclusions: [exclusion('surface-b')] })] })));
gateRow('F3-08', 'REJECT', () => compileGateContract(ir({ requirements: [requirement('SURFACES', [{ name: 'EXACT_ALLOWLIST', params: validParams('EXACT_ALLOWLIST') }], { exclusions: [exclusion('surface-a'), exclusion('surface-b')] })] })));
for (const mutation of [
  ['orphan', (packet) => { packet.coverage_map[0].surfaces[0].oracle_ids.push('orphan'); }],
  ['foreign', (packet) => { packet.coverage_map.push({ requirement_id: 'FOREIGN', declared_surfaces: ['surface-a'], concrete_assertion_count: 1, surfaces: [{ surface: 'surface-a', oracle_ids: [packet.generated_cases[0].id], exclusion: null, status: 'COVERED' }], status: 'COMPLETE' }); }],
  ['duplicate', (packet) => { packet.coverage_map[0].surfaces.push(packet.coverage_map[0].surfaces[0]); }],
]) {
  gateRow(`F3-09:${mutation[0]}`, 'REJECT', () => {
    const packet = compileGateContract(singleMacro('EXACT_ALLOWLIST'));
    mutation[1](packet);
    const withoutDigest = { ...packet };
    delete withoutDigest.packet_digest;
    packet.packet_digest = hashCanonical(withoutDigest);
    return validateG3ExecutionPacket(packet);
  });
}
gateRow('F3-10', 'ACCEPT', () => {
  const packet = compileGateContract(ir({ requirements: [{ id: 'SURFACES', invariant: 'Both surfaces receive the explicit case.', surfaces: ['surface-a', 'surface-b'], macros: [], cases: [{ id: 'BOTH', input: {}, expected: { outcome: 'CHECK' } }] }] }));
  assert.equal(packet.generated_cases.length, 2);
  return packet;
});

test('Run-058 F1/F2/F3 oracle matrix uses the production gate compiler', () => {
  for (const row of gateOracleRows) {
    let actual;
    try {
      const raw = row.execute();
      actual = raw && typeof raw.kind === 'string' ? raw : { kind: 'ACCEPT', value: raw };
    } catch (error) {
      actual = { kind: error.code === 'GATE_CONTRACT_IR_INVALID' ? 'REJECT' : 'ORACLE_FAILURE', error };
    }
    if (row.expected === 'ORACLE_FAILURE') {
      assert.equal(actual.kind, 'ORACLE_FAILURE', row.id);
    } else {
      assert.equal(actual.kind, row.expected, row.id);
      if (row.expected === 'ACCEPT') assert.ok(actual.value.generated_cases.every((item) => item.assertion_count > 0), row.id);
      if (row.expected === 'REJECT') assert.equal(actual.error.code, 'GATE_CONTRACT_IR_INVALID', row.id);
    }
  }
});

test('Run-058 gate oracle expansion count is explicit and stable', () => {
  assert.equal(gateOracleRows.length, 132);
});

test('gate schema is Draft 2020-12, closed, and agrees with runtime vocabulary', () => {
  const schema = require('../contracts/controller-kernel/gate-contract-ir-v1.schema.json');
  const ajv = new Ajv2020({ strict: false, coerceTypes: false, useDefaults: false, removeAdditional: false });
  const validate = ajv.compile(schema);
  const input = allMacroIr();
  const before = structuredClone(input);
  assert.equal(validate(input), true);
  assert.deepEqual(input, before);
  const schemaMacros = schema.$defs.Macro.oneOf.map((branch) => branch.properties.name.const).sort();
  assert.deepEqual(schemaMacros, MACRO_NAMES.sort());
  const extra = structuredClone(input);
  extra.requirements[0].macros[0].params.unsupported = true;
  assert.equal(validate(extra), false);
  assert.equal(Object.hasOwn(extra.requirements[0].macros[0].params, 'unsupported'), true);
  assert.throws(() => compileGateContract(extra), /not allowed/);
});

test('gate compiler preserves admitted values through serialization and does not mutate input', () => {
  const input = singleMacro('ALIAS_CLOSURE', { aliases: ['one', 'two'], value: { empty: [], false_value: false, zero: 0, null_value: null }, expected: { outcome: 'SAME' } });
  const before = structuredClone(input);
  const packet = compileGateContract(input);
  assert.deepEqual(input, before);
  const roundTrip = JSON.parse(JSON.stringify(packet));
  assert.deepEqual(roundTrip.generated_cases[0].input.value, input.requirements[0].macros[0].params.value);
  assert.equal(packet.packet_digest, compileGateContract(input).packet_digest);
  const rendered = JSON.parse(renderG3ExecutionPacket(input));
  assert.equal(rendered.packet_digest, packet.packet_digest);
});

test('gate CLI enforces the same admission semantics as the compiler', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-gate-'));
  const filename = path.join(directory, 'contract.json');
  fs.writeFileSync(filename, JSON.stringify(singleMacro('SPELLING_VARIANTS_REJECT', { field: 'action', allow: ['ok'], expected: { outcome: 'REJECT' } })));
  const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'toolkit-gate-contract-compiler.cjs'), filename], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /GATE_CONTRACT_IR_INVALID|zero concrete cases/);
});

test('human-bound routing and remote-first source binding remain intact', () => {
  const root = path.resolve(__dirname, '..', '..');
  const controller = fs.readFileSync(path.join(root, 'repo', 'CONTROLLER.md'), 'utf8');
  const architecture = fs.readFileSync(path.join(root, 'repo', 'ARCHITECTURE.md'), 'utf8');
  for (const text of [controller, architecture]) {
    assert.match(text, /human|launcher/i);
    assert.match(text, /missing runtime model metadata is (?:never|not) a HOLD/i);
    assert.match(text, /silent (?:route\/model )?fallback/i);
  }
  assert.match(controller, /executor\/LLM must never inspect, prove, attest, infer, reject, or block on its own provider\/model\/reasoning identity/i);
  assert.match(controller, /canonical repository `weijunswj\/ai-agent-toolkit`/i);
  assert.match(controller, /local Toolkit repository.*never governance authority/i);
  assert.doesNotMatch(controller, /launcher\/runtime must verify the resolved route/i);
});
