'use strict';

const crypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const MACRO_NAMES = [
  'EXACT_ALLOWLIST',
  'SPELLING_VARIANTS_REJECT',
  'ALIAS_CLOSURE',
  'TRISTATE_UNKNOWN_AMBIGUOUS',
  'CONTRADICTORY_EVIDENCE',
  'OWN_VS_INHERITED_PROPERTY',
  'NULLISH_DEFAULT_MATRIX',
  'DESCRIPTOR_ZERO_READ',
  'ROUNDTRIP_STATE_STABILITY',
  'STRUCTURAL_REVALIDATION',
  'SECRET_PATTERN_PARITY',
  'PUBLIC_ALIAS_SURFACE_PARITY',
];

const SUPPORTED_MACROS = new Set(MACRO_NAMES);
const GATE_ERROR_CODE = 'GATE_CONTRACT_IR_INVALID';

function fail(message) {
  const error = new Error(message);
  error.code = GATE_ERROR_CODE;
  throw error;
}

function own(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function trustedJsonCopy(value, seen = new WeakSet(), location = 'value') {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) fail(`${location} contains a non-serializable number`);
    return value;
  }
  if (typeof value === 'function' || typeof value === 'object') {
    if (utilTypes.isProxy(value)) fail(`${location} is a Proxy`);
  }
  if (typeof value !== 'object') fail(`${location} contains a value that cannot be represented in JSON`);
  if (seen.has(value)) fail(`${location} contains a cycle`);
  seen.add(value);
  try {
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    const names = Object.getOwnPropertyNames(value);
    if (Object.getOwnPropertySymbols(value).length > 0) fail(`${location} contains symbol properties`);
    if (array) {
      if (prototype !== Array.prototype && prototype !== null) fail(`${location} has a custom prototype`);
      const length = Object.getOwnPropertyDescriptor(value, 'length');
      if (!length || !own(length, 'value') || length.enumerable || !Number.isSafeInteger(length.value) || length.value < 0) {
        fail(`${location} has an invalid array length descriptor`);
      }
      const result = new Array(length.value);
      for (const name of names) {
        if (name === 'length') continue;
        if (!/^(0|[1-9]\d*)$/.test(name) || Number(name) >= length.value) {
          fail(`${location} contains an array property that JSON would not preserve`);
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, name);
        if (!descriptor || !own(descriptor, 'value') || descriptor.enumerable !== true) fail(`${location}[${name}] is not an enumerable data property`);
      }
      for (let index = 0; index < length.value; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !own(descriptor, 'value') || descriptor.enumerable !== true) fail(`${location} is sparse or contains an accessor`);
        Object.defineProperty(result, String(index), {
          value: trustedJsonCopy(descriptor.value, seen, `${location}[${index}]`),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return result;
    }
    if (prototype !== Object.prototype && prototype !== null) fail(`${location} has a custom prototype`);
    const result = {};
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (!descriptor || !own(descriptor, 'value') || descriptor.enumerable !== true) fail(`${location}.${name} is not an enumerable data property`);
      Object.defineProperty(result, name, {
        value: trustedJsonCopy(descriptor.value, seen, `${location}.${name}`),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateJsonCompatible(value, seen = new WeakSet(), location = 'value') {
  if (seen === undefined || seen === null) fail(`${location} has invalid validation state`);
  trustedJsonCopy(value, new WeakSet(), location);
  return;
  /* istanbul ignore next */
  if (value === null) return;

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return;
    case 'number':
      if (!Number.isFinite(value) || Object.is(value, -0)) {
        fail(`${location} contains a non-serializable number`);
      }
      return;
    case 'undefined':
    case 'function':
    case 'symbol':
    case 'bigint':
      fail(`${location} contains a value that cannot be represented in JSON`);
      return;
    case 'object':
      break;
    default:
      fail(`${location} contains an unsupported value`);
  }

  if (seen.has(value)) fail(`${location} contains a cycle`);
  seen.add(value);

  let names;
  let symbols;
  try {
    names = Object.getOwnPropertyNames(value);
    symbols = Object.getOwnPropertySymbols(value);
  } catch (error) {
    fail(`${location} cannot be inspected safely`);
  }
  if (symbols.length > 0) fail(`${location} contains symbol properties`);

  if (Array.isArray(value)) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Array.prototype && prototype !== null) fail(`${location} has a custom prototype`);
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (!lengthDescriptor || lengthDescriptor.get || lengthDescriptor.set) {
      fail(`${location} has an invalid array length descriptor`);
    }
    for (const name of names) {
      if (name === 'length') continue;
      if (!/^(0|[1-9]\d*)$/.test(name) || Number(name) >= value.length) {
        fail(`${location} contains an array property that JSON would not preserve`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (!descriptor || descriptor.get || descriptor.set || descriptor.enumerable !== true) {
        fail(`${location}[${name}] is not an enumerable data property`);
      }
    }
    for (let index = 0; index < value.length; index += 1) {
      const name = String(index);
      if (!own(value, name)) fail(`${location} is sparse`);
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (!descriptor || descriptor.get || descriptor.set || descriptor.enumerable !== true) {
        fail(`${location}[${name}] is not an enumerable data property`);
      }
      validateJsonCompatible(descriptor.value, seen, `${location}[${name}]`);
    }
  } else {
    if (!isPlainObject(value)) fail(`${location} has a custom prototype`);
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (!descriptor || descriptor.get || descriptor.set || descriptor.enumerable !== true) {
        fail(`${location}.${name} is not an enumerable data property`);
      }
      validateJsonCompatible(descriptor.value, seen, `${location}.${name}`);
    }
  }

  seen.delete(value);
}

function cloneCanonical(value) {
  if (Array.isArray(value)) return value.map(cloneCanonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, cloneCanonical(value[key])]));
  }
  return value;
}

function canonicalize(value) {
  return cloneCanonical(trustedJsonCopy(value));
}

function stableStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function hashCanonical(value) {
  return crypto.createHash('sha256').update(stableStringify(value), 'utf8').digest('hex');
}

function deepEqual(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function checkKeys(value, required, optional, location) {
  if (!isPlainObject(value)) fail(`${location} must be an object`);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${location}.${key} is not allowed`);
  }
  for (const key of required) {
    if (!own(value, key)) fail(`${location}.${key} is required`);
  }
}

function string(value, location) {
  if (typeof value !== 'string' || value.trim().length === 0) fail(`${location} must be a non-whitespace string`);
}

function stringSet(value, location, allowEmpty = false) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    fail(`${location} must be ${allowEmpty ? 'a' : 'a non-empty'} string array`);
  }
  const seen = new Set();
  for (const item of value) {
    string(item, `${location}[]`);
    if (seen.has(item)) fail(`${location} must not contain duplicates`);
    seen.add(item);
  }
}

function object(value, location) {
  if (!isPlainObject(value)) fail(`${location} must be an object`);
}

function expectedObject(value, location) {
  object(value, location);
  if (Object.keys(value).length === 0) fail(`${location} must contain a concrete assertion`);
}

function assertionList(expected) {
  return Object.keys(expected).sort().map((key) => ({
    op: 'OWN_DEEP_EQUAL',
    path: [key],
    expected: cloneCanonical(expected[key]),
  }));
}

function variants(token) {
  const values = new Set([
    token.toLowerCase(),
    token.replaceAll('_', '-'),
    token.replace(/^LAUNCH_/, ''),
    token.replace(/^LAUNCH_/, 'EXECUTE_'),
  ]);
  const match = /^LAUNCH_(.+)_DIRECT$/.exec(token);
  if (match) {
    values.add(`${match[1]}_EXECUTE`);
    values.add(`EXECUTE_${match[1]}`);
    values.add(match[1]);
  }
  values.delete(token);
  return values;
}

function validateExactAllowlist(params, location) {
  checkKeys(params, ['field', 'allow', 'reject_values', 'accept', 'reject'], [], location);
  string(params.field, `${location}.field`);
  stringSet(params.allow, `${location}.allow`);
  stringSet(params.reject_values, `${location}.reject_values`);
  expectedObject(params.accept, `${location}.accept`);
  expectedObject(params.reject, `${location}.reject`);
  if (params.allow.some((value) => params.reject_values.includes(value))) {
    fail(`${location}.allow and reject_values must be disjoint`);
  }
}

function validateMacroParams(macro, location) {
  if (!isPlainObject(macro) || !own(macro, 'name') || !own(macro, 'params')) {
    fail(`${location} must contain name and params`);
  }
  checkKeys(macro, ['name', 'params'], [], location);
  string(macro.name, `${location}.name`);
  if (!SUPPORTED_MACROS.has(macro.name)) fail(`unsupported macro ${macro.name}`);
  object(macro.params, `${location}.params`);
  const params = macro.params;
  switch (macro.name) {
    case 'EXACT_ALLOWLIST':
      validateExactAllowlist(params, `${location}.params`);
      break;
    case 'SPELLING_VARIANTS_REJECT':
      checkKeys(params, ['field', 'allow', 'expected'], [], `${location}.params`);
      string(params.field, `${location}.params.field`);
      stringSet(params.allow, `${location}.params.allow`);
      expectedObject(params.expected, `${location}.params.expected`);
      break;
    case 'ALIAS_CLOSURE':
      checkKeys(params, ['aliases', 'value', 'expected'], [], `${location}.params`);
      stringSet(params.aliases, `${location}.params.aliases`);
      if (params.aliases.length < 2) fail(`${location}.params.aliases must contain at least two items`);
      expectedObject(params.expected, `${location}.params.expected`);
      break;
    case 'TRISTATE_UNKNOWN_AMBIGUOUS':
      checkKeys(params, ['field', 'states', 'expected'], [], `${location}.params`);
      string(params.field, `${location}.params.field`);
      stringSet(params.states, `${location}.params.states`);
      if (params.states.length !== 2 || !params.states.includes('UNKNOWN') || !params.states.includes('AMBIGUOUS')) {
        fail(`${location}.params.states must contain exactly UNKNOWN and AMBIGUOUS`);
      }
      expectedObject(params.expected, `${location}.params.expected`);
      break;
    case 'CONTRADICTORY_EVIDENCE': {
      checkKeys(params, ['pairs', 'expected'], [], `${location}.params`);
      if (!Array.isArray(params.pairs) || params.pairs.length === 0) fail(`${location}.params.pairs must be non-empty`);
      const seen = new Set();
      params.pairs.forEach((pair, index) => {
        checkKeys(pair, ['left', 'right'], [], `${location}.params.pairs[${index}]`);
        object(pair.left, `${location}.params.pairs[${index}].left`);
        object(pair.right, `${location}.params.pairs[${index}].right`);
        if (Object.keys(pair.left).length === 0 || Object.keys(pair.right).length === 0) {
          fail(`${location}.params.pairs[${index}] objects must be non-empty`);
        }
        const sharedDifference = Object.keys(pair.left).some((key) => (
          own(pair.right, key) && !deepEqual(pair.left[key], pair.right[key])
        ));
        if (!sharedDifference) fail(`${location}.params.pairs[${index}] must share a differing property`);
        const identity = stableStringify(pair);
        if (seen.has(identity)) fail(`${location}.params.pairs must be unique`);
        seen.add(identity);
      });
      expectedObject(params.expected, `${location}.params.expected`);
      break;
    }
    case 'OWN_VS_INHERITED_PROPERTY':
      checkKeys(params, ['field', 'value', 'expected'], [], `${location}.params`);
      string(params.field, `${location}.params.field`);
      expectedObject(params.expected, `${location}.params.expected`);
      break;
    case 'NULLISH_DEFAULT_MATRIX':
      checkKeys(params, ['field', 'expected'], [], `${location}.params`);
      string(params.field, `${location}.params.field`);
      expectedObject(params.expected, `${location}.params.expected`);
      break;
    case 'DESCRIPTOR_ZERO_READ':
      checkKeys(params, ['fields', 'expected'], [], `${location}.params`);
      stringSet(params.fields, `${location}.params.fields`);
      expectedObject(params.expected, `${location}.params.expected`);
      if (!own(params.expected, 'accessor_calls') || params.expected.accessor_calls !== 0) {
        fail(`${location}.params.expected must contain own accessor_calls:0`);
      }
      break;
    case 'ROUNDTRIP_STATE_STABILITY':
      checkKeys(params, ['sequence', 'fixture', 'expected'], [], `${location}.params`);
      if (!Array.isArray(params.sequence) || params.sequence.length < 2) {
        fail(`${location}.params.sequence must contain at least two entries`);
      }
      params.sequence.forEach((item, index) => string(item, `${location}.params.sequence[${index}]`));
      object(params.fixture, `${location}.params.fixture`);
      expectedObject(params.expected, `${location}.params.expected`);
      if (!own(params.expected, 'state_before') || !own(params.expected, 'state_after')) {
        fail(`${location}.params.expected must contain state_before and state_after`);
      }
      object(params.expected.state_before, `${location}.params.expected.state_before`);
      object(params.expected.state_after, `${location}.params.expected.state_after`);
      if (!deepEqual(params.expected.state_before, params.fixture) || !deepEqual(params.expected.state_after, params.fixture)) {
        fail(`${location}.params.expected state snapshots must equal fixture`);
      }
      break;
    case 'STRUCTURAL_REVALIDATION':
      checkKeys(params, ['surfaces', 'malformed', 'expected'], [], `${location}.params`);
      stringSet(params.surfaces, `${location}.params.surfaces`);
      object(params.malformed, `${location}.params.malformed`);
      if (Object.keys(params.malformed).length === 0) fail(`${location}.params.malformed must be non-empty`);
      expectedObject(params.expected, `${location}.params.expected`);
      break;
    case 'SECRET_PATTERN_PARITY':
      checkKeys(params, ['patterns', 'surfaces', 'expected'], [], `${location}.params`);
      stringSet(params.patterns, `${location}.params.patterns`);
      stringSet(params.surfaces, `${location}.params.surfaces`);
      params.patterns.forEach((pattern, index) => {
        if (!pattern.includes('SYNTHETIC')) fail(`${location}.params.patterns[${index}] must contain SYNTHETIC`);
      });
      expectedObject(params.expected, `${location}.params.expected`);
      break;
    case 'PUBLIC_ALIAS_SURFACE_PARITY':
      checkKeys(params, ['surfaces', 'input', 'expected'], [], `${location}.params`);
      stringSet(params.surfaces, `${location}.params.surfaces`);
      object(params.input, `${location}.params.input`);
      expectedObject(params.expected, `${location}.params.expected`);
      break;
    default:
      fail(`unsupported macro ${macro.name}`);
  }
}

function validateExclusions(requirement, exclusions, ir) {
  const excluded = new Map();
  if (!Array.isArray(exclusions)) fail(`${requirement.id}.exclusions must be an array`);
  exclusions.forEach((exclusion, index) => {
    const location = `${requirement.id}.exclusions[${index}]`;
    checkKeys(exclusion, ['surface', 'author_stage', 'run', 'lock', 'reason_code', 'reason', 'authority_ref'], [], location);
    string(exclusion.surface, `${location}.surface`);
    string(exclusion.run, `${location}.run`);
    string(exclusion.lock, `${location}.lock`);
    string(exclusion.reason, `${location}.reason`);
    string(exclusion.authority_ref, `${location}.authority_ref`);
    if (exclusion.author_stage !== 'G2') fail(`${location}.author_stage must be G2`);
    if (exclusion.reason_code !== 'G2_EXPLICIT_EXCLUSION') fail(`${location}.reason_code is invalid`);
    if (exclusion.run !== ir.run || exclusion.lock !== ir.lock) fail(`${location} is not bound to the enclosing IR`);
    if (!requirement.surfaces.includes(exclusion.surface)) fail(`${location}.surface is not declared`);
    if (excluded.has(exclusion.surface)) fail(`${location}.surface is duplicated`);
    excluded.set(exclusion.surface, cloneCanonical(exclusion));
  });
  return excluded;
}

function validateRequirement(requirement, ir) {
  object(requirement, 'requirement');
  checkKeys(
    requirement,
    ['id', 'invariant', 'surfaces', 'macros'],
    ['cases', 'exclusions', 'forbidden_behaviour'],
    `requirement ${requirement.id || '<unknown>'}`,
  );
  string(requirement.id, 'requirement.id');
  string(requirement.invariant, `${requirement.id}.invariant`);
  stringSet(requirement.surfaces, `${requirement.id}.surfaces`);
  if (!Array.isArray(requirement.macros)) fail(`${requirement.id}.macros must be an array`);
  if (requirement.cases !== undefined && !Array.isArray(requirement.cases)) fail(`${requirement.id}.cases must be an array`);
  if (requirement.exclusions !== undefined && !Array.isArray(requirement.exclusions)) fail(`${requirement.id}.exclusions must be an array`);
  if (requirement.forbidden_behaviour !== undefined) stringSet(requirement.forbidden_behaviour, `${requirement.id}.forbidden_behaviour`, true);

  const excluded = validateExclusions(requirement, requirement.exclusions || [], ir);
  requirement.macros.forEach((macro, index) => {
    validateMacroParams(macro, `${requirement.id}.macros[${index}]`);
    const localSurfaces = macro.params.surfaces;
    if (localSurfaces !== undefined) {
      stringSet(localSurfaces, `${requirement.id}.macros[${index}].params.surfaces`);
      for (const surface of localSurfaces) {
        if (!requirement.surfaces.includes(surface)) fail(`${requirement.id}.macros[${index}] names an undeclared surface`);
        if (excluded.has(surface)) fail(`${requirement.id}.macros[${index}] targets an excluded surface`);
      }
    }
  });

  const caseIds = new Set();
  for (const item of requirement.cases || []) {
    const location = `${requirement.id}.cases`;
    checkKeys(item, ['id', 'input', 'expected'], ['surface'], `${location}[${item.id || '<unknown>'}]`);
    string(item.id, `${location}.id`);
    if (caseIds.has(item.id)) fail(`${requirement.id}.cases contains duplicate ids`);
    caseIds.add(item.id);
    object(item.input, `${requirement.id}.cases[${item.id}].input`);
    expectedObject(item.expected, `${requirement.id}.cases[${item.id}].expected`);
    if (item.surface !== undefined) {
      string(item.surface, `${requirement.id}.cases[${item.id}].surface`);
      if (!requirement.surfaces.includes(item.surface)) fail(`${requirement.id}.cases[${item.id}].surface is not declared`);
      if (excluded.has(item.surface)) fail(`${requirement.id}.cases[${item.id}].surface is excluded`);
    }
  }
  if (requirement.macros.length === 0 && (requirement.cases || []).length === 0) {
    fail(`${requirement.id} requires at least one macro or explicit case`);
  }
  return excluded;
}

function createCase(requirement, macro, macroIndex, recipeLabel, input, expected, surface) {
  const assertions = assertionList(expected);
  if (assertions.length === 0) fail(`${requirement.id} generated a case without assertions`);
  return {
    id: JSON.stringify([requirement.id, 'MACRO', macroIndex, recipeLabel, surface]),
    requirement_id: requirement.id,
    macro: macro.name,
    surface,
    input: cloneCanonical(input),
    expected: cloneCanonical(expected),
    assertions,
    assertion_count: assertions.length,
  };
}

function expandMacro(requirement, macro, macroIndex, excluded) {
  const surfaces = requirement.surfaces.filter((surface) => !excluded.has(surface)).sort();
  const output = [];
  const params = macro.params;
  const emit = (recipeLabel, input, expected, localSurface) => {
    const targetSurfaces = localSurface === undefined ? surfaces : [localSurface];
    for (const surface of targetSurfaces) {
      output.push(createCase(requirement, macro, macroIndex, recipeLabel, input, expected, surface));
    }
  };

  switch (macro.name) {
    case 'EXACT_ALLOWLIST':
      for (const value of params.allow) emit(`accept:${value}`, { [params.field]: value }, params.accept);
      for (const value of params.reject_values) emit(`reject:${value}`, { [params.field]: value }, params.reject);
      break;
    case 'SPELLING_VARIANTS_REJECT': {
      const allow = new Set(params.allow);
      const generated = new Set();
      for (const token of params.allow) {
        for (const variant of variants(token)) {
          if (!allow.has(variant)) generated.add(variant);
        }
      }
      for (const variant of [...generated].sort()) {
        emit(variant, { [params.field]: variant }, params.expected);
      }
      break;
    }
    case 'ALIAS_CLOSURE':
      for (const alias of params.aliases) emit(alias, { alias, value: params.value }, params.expected);
      break;
    case 'TRISTATE_UNKNOWN_AMBIGUOUS':
      for (const state of params.states) emit(state, { [params.field]: state }, params.expected);
      break;
    case 'CONTRADICTORY_EVIDENCE':
      params.pairs.forEach((pair, index) => emit(String(index + 1).padStart(3, '0'), pair, params.expected));
      break;
    case 'OWN_VS_INHERITED_PROPERTY':
      for (const placement of ['inherited', 'own']) {
        emit(placement, { placement, field: params.field, value: params.value }, params.expected);
      }
      break;
    case 'NULLISH_DEFAULT_MATRIX':
      for (const [label, value] of [
        ['empty-string', ''],
        ['false', false],
        ['null', null],
        ['undefined', { $kind: 'undefined' }],
      ]) {
        emit(label, { field: params.field, value }, params.expected);
      }
      break;
    case 'DESCRIPTOR_ZERO_READ':
      for (const field of params.fields) {
        for (const descriptor of ['inherited-getter', 'own-getter']) {
          emit(`${field}:${descriptor}`, { field, descriptor }, params.expected);
        }
      }
      break;
    case 'ROUNDTRIP_STATE_STABILITY':
      emit('roundtrip', { sequence: params.sequence, fixture: params.fixture }, params.expected);
      break;
    case 'STRUCTURAL_REVALIDATION':
      for (const surface of params.surfaces) emit(surface, params.malformed, params.expected, surface);
      break;
    case 'SECRET_PATTERN_PARITY':
      for (const surface of params.surfaces) {
        for (const pattern of params.patterns) {
          emit(`${surface}:${pattern}`, { synthetic_canary: pattern }, params.expected, surface);
        }
      }
      break;
    case 'PUBLIC_ALIAS_SURFACE_PARITY':
      for (const surface of params.surfaces) emit(surface, params.input, params.expected, surface);
      break;
    default:
      fail(`unsupported macro ${macro.name}`);
  }
  if (output.length === 0) fail(`${requirement.id}.macros[${macroIndex}] expands to zero concrete cases`);
  return output;
}

function expandExplicitCase(requirement, item, excluded) {
  const surfaces = item.surface === undefined
    ? requirement.surfaces.filter((surface) => !excluded.has(surface)).sort()
    : [item.surface];
  return surfaces.map((surface) => {
    const assertions = assertionList(item.expected);
    if (assertions.length === 0) fail(`${requirement.id}.cases[${item.id}] has no assertions`);
    return {
      id: JSON.stringify([requirement.id, 'EXPLICIT', item.id, surface]),
      requirement_id: requirement.id,
      macro: 'EXPLICIT',
      surface,
      input: cloneCanonical(item.input),
      expected: cloneCanonical(item.expected),
      assertions,
      assertion_count: assertions.length,
    };
  });
}

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validateG3ExecutionPacket(packet) {
  packet = trustedJsonCopy(packet, new WeakSet(), 'packet');
  if (['toolkit.g3-execution-packet.v2','toolkit.g3-execution-packet.v3'].includes(packet.schema)) return validateControllerExecutionPacket(packet);
  object(packet, 'packet');
  checkKeys(packet, [
    'schema',
    'source_contract_digest',
    'run',
    'lock',
    'source_stage',
    'target_stage',
    'mutation',
    'requirements',
    'generated_cases',
    'coverage_map',
    'required_validation',
    'required_evidence',
    'prohibited_inference',
    'stop_conditions',
    'packet_digest',
  ], [], 'packet');
  if (packet.schema !== 'toolkit.g3-execution-packet.v1') fail('packet.schema is invalid');
  const withoutDigest = { ...packet };
  delete withoutDigest.packet_digest;
  if (hashCanonical(withoutDigest) !== packet.packet_digest) fail('packet_digest does not match packet contents');
  if (!Array.isArray(packet.generated_cases) || !Array.isArray(packet.coverage_map) || !Array.isArray(packet.requirements)) fail('packet collections are invalid');
  const cases = new Map();
  for (const item of packet.generated_cases) {
    checkKeys(item, ['id', 'requirement_id', 'macro', 'surface', 'input', 'expected', 'assertions', 'assertion_count'], [], 'packet.generated_cases[]');
    string(item.id, 'packet.generated_cases[].id');
    string(item.requirement_id, 'packet.generated_cases[].requirement_id');
    string(item.macro, 'packet.generated_cases[].macro');
    string(item.surface, 'packet.generated_cases[].surface');
    object(item.input, 'packet.generated_cases[].input');
    expectedObject(item.expected, 'packet.generated_cases[].expected');
    if (!Array.isArray(item.assertions) || item.assertions.length === 0 || item.assertion_count !== item.assertions.length) fail('packet case assertions are invalid');
    for (const assertion of item.assertions) {
      checkKeys(assertion, ['op', 'path', 'expected'], [], 'packet.generated_cases[].assertions[]');
      if (assertion.op !== 'OWN_DEEP_EQUAL' || !Array.isArray(assertion.path) || assertion.path.length !== 1 || typeof assertion.path[0] !== 'string' || !own(item.expected, assertion.path[0]) || !deepEqual(assertion.expected, item.expected[assertion.path[0]])) fail('packet assertion is not derived from expected');
    }
    if (cases.has(item.id)) fail('packet contains duplicate case ids');
    cases.set(item.id, item);
  }
  const requirements = new Map();
  for (const requirement of packet.requirements) {
    checkKeys(requirement, ['id', 'invariant', 'surfaces', 'forbidden_behaviour', 'generated_oracle_ids', 'concrete_assertion_count', 'status'], [], 'packet.requirements[]');
    string(requirement.id, 'packet.requirements[].id');
    string(requirement.invariant, 'packet.requirements[].invariant');
    stringSet(requirement.surfaces, 'packet.requirements[].surfaces');
    stringSet(requirement.forbidden_behaviour, 'packet.requirements[].forbidden_behaviour', true);
    stringSet(requirement.generated_oracle_ids, 'packet.requirements[].generated_oracle_ids');
    if (requirement.status !== 'COMPLETE' || !Number.isInteger(requirement.concrete_assertion_count) || requirement.concrete_assertion_count <= 0) fail('packet requirement is incomplete');
    if (requirements.has(requirement.id)) fail('packet contains duplicate requirement ids');
    requirements.set(requirement.id, requirement);
  }
  if (requirements.size !== packet.coverage_map.length) fail('packet coverage has foreign or missing requirements');
  const mappedCases = new Set();
  for (const entry of packet.coverage_map) {
    checkKeys(entry, ['requirement_id', 'declared_surfaces', 'concrete_assertion_count', 'surfaces', 'status'], [], 'packet.coverage_map[]');
    const requirement = requirements.get(entry.requirement_id);
    if (!requirement || entry.status !== 'COMPLETE') fail('packet coverage has a foreign requirement');
    if (!deepEqual([...entry.declared_surfaces].sort(compareCodeUnits), [...requirement.surfaces].sort(compareCodeUnits))) fail('packet coverage declared surfaces do not match requirement');
    if (!Array.isArray(entry.surfaces) || entry.surfaces.length !== entry.declared_surfaces.length) fail('packet coverage surface count is invalid');
    const surfaces = new Set();
    let assertionCount = 0;
    for (const surfaceEntry of entry.surfaces) {
      checkKeys(surfaceEntry, ['surface', 'oracle_ids', 'exclusion', 'status'], [], 'packet.coverage_map[].surfaces[]');
      string(surfaceEntry.surface, 'packet.coverage_map[].surfaces[].surface');
      stringSet(surfaceEntry.oracle_ids, 'packet.coverage_map[].surfaces[].oracle_ids', true);
      if (surfaces.has(surfaceEntry.surface) || !entry.declared_surfaces.includes(surfaceEntry.surface)) fail('packet coverage has duplicate or foreign surfaces');
      surfaces.add(surfaceEntry.surface);
      if (surfaceEntry.status === 'COVERED') {
        if (surfaceEntry.exclusion !== null || surfaceEntry.oracle_ids.length === 0) fail('covered surface is not backed by an oracle');
      } else if (surfaceEntry.status === 'EXCLUDED') {
        if (surfaceEntry.exclusion === null || surfaceEntry.oracle_ids.length !== 0) fail('excluded surface has an oracle or no exclusion');
      } else {
        fail('packet surface status is invalid');
      }
      for (const oracleId of surfaceEntry.oracle_ids) {
        const item = cases.get(oracleId);
        if (!item || item.requirement_id !== entry.requirement_id || item.surface !== surfaceEntry.surface || mappedCases.has(oracleId)) fail('packet coverage has an orphan, foreign, or duplicate oracle id');
        mappedCases.add(oracleId);
        assertionCount += item.assertion_count;
      }
    }
    if (surfaces.size !== entry.declared_surfaces.length || assertionCount !== entry.concrete_assertion_count) fail('packet coverage count is invalid');
    const requirementCaseIds = [...cases.values()].filter((item) => item.requirement_id === entry.requirement_id).map((item) => item.id).sort(compareCodeUnits);
    if (!deepEqual(requirementCaseIds, [...requirements.get(entry.requirement_id).generated_oracle_ids].sort(compareCodeUnits))) fail('packet requirement oracle ids are invalid');
  }
  if (mappedCases.size !== cases.size) fail('packet contains an orphan generated case');
  return packet;
}

function compileGateContract(ir) {
  ir = trustedJsonCopy(ir, new WeakSet(), 'ir');
  if (['toolkit.gate-contract-ir.v2','toolkit.gate-contract-ir.v3'].includes(ir.schema)) return compileControllerGateContract(ir);
  object(ir, 'ir');
  checkKeys(
    ir,
    ['schema', 'run', 'lock', 'source_stage', 'target_stage', 'mutation', 'requirements', 'required_validation', 'required_evidence'],
    [],
    'ir',
  );
  if (ir.schema !== 'toolkit.gate-contract-ir.v1') fail('schema must be toolkit.gate-contract-ir.v1');
  string(ir.run, 'run');
  string(ir.lock, 'lock');
  if (ir.source_stage !== 'G2' || ir.target_stage !== 'G3') fail('source_stage/target_stage must be G2/G3');
  object(ir.mutation, 'mutation');
  checkKeys(ir.mutation, ['allow_paths', 'forbid_extra_paths'], [], 'mutation');
  stringSet(ir.mutation.allow_paths, 'mutation.allow_paths');
  if (ir.mutation.forbid_extra_paths !== true) fail('mutation.forbid_extra_paths must be true');
  stringSet(ir.required_validation, 'required_validation');
  stringSet(ir.required_evidence, 'required_evidence');
  if (!Array.isArray(ir.requirements) || ir.requirements.length === 0) fail('requirements must be non-empty');

  const requirementIds = new Set();
  const allCases = [];
  const compiledRequirements = [];
  const coverageByRequirement = new Map();

  for (const requirement of ir.requirements) {
    if (requirementIds.has(requirement.id)) fail(`duplicate requirement id ${requirement.id}`);
    requirementIds.add(requirement.id);
    const excluded = validateRequirement(requirement, ir);
    const coverage = new Map(requirement.surfaces.map((surface) => [surface, {
      surface,
      oracle_ids: [],
      exclusion: excluded.get(surface) || null,
      status: excluded.has(surface) ? 'EXCLUDED' : 'COVERED',
    }]));
    const cases = [];
    requirement.macros.forEach((macro, index) => cases.push(...expandMacro(requirement, macro, index, excluded)));
    for (const item of requirement.cases || []) cases.push(...expandExplicitCase(requirement, item, excluded));
    if (cases.length === 0) fail(`${requirement.id} has zero concrete cases`);
    for (const item of cases) {
      if (!coverage.has(item.surface)) fail(`${item.id} targets an unknown surface`);
      if (coverage.get(item.surface).exclusion) fail(`${item.id} targets an excluded surface`);
      coverage.get(item.surface).oracle_ids.push(item.id);
      allCases.push(item);
    }
    const concreteAssertionCount = cases.reduce((sum, item) => sum + item.assertion_count, 0);
    if (concreteAssertionCount === 0) fail(`${requirement.id} has zero concrete assertions`);
    for (const entry of coverage.values()) {
      entry.oracle_ids.sort(compareCodeUnits);
      if (entry.status === 'COVERED' && entry.oracle_ids.length === 0) {
        fail(`${requirement.id}.${entry.surface} is uncovered`);
      }
      if (entry.status === 'EXCLUDED' && entry.oracle_ids.length !== 0) {
        fail(`${requirement.id}.${entry.surface} is both covered and excluded`);
      }
    }
    coverageByRequirement.set(requirement.id, {
      requirement_id: requirement.id,
      declared_surfaces: [...requirement.surfaces].sort(compareCodeUnits),
      concrete_assertion_count: concreteAssertionCount,
      surfaces: [...coverage.values()].sort((left, right) => compareCodeUnits(left.surface, right.surface)),
      status: 'COMPLETE',
    });
    compiledRequirements.push({
      id: requirement.id,
      invariant: requirement.invariant,
      surfaces: [...requirement.surfaces].sort(compareCodeUnits),
      forbidden_behaviour: [...(requirement.forbidden_behaviour || [])].sort(compareCodeUnits),
      generated_oracle_ids: cases.map((item) => item.id).sort(compareCodeUnits),
      concrete_assertion_count: concreteAssertionCount,
      status: 'COMPLETE',
    });
  }

  allCases.sort((left, right) => compareCodeUnits(left.id, right.id));
  if (new Set(allCases.map((item) => item.id)).size !== allCases.length) fail('duplicate generated case id');
  const packetCore = {
    schema: 'toolkit.g3-execution-packet.v1',
    source_contract_digest: hashCanonical(ir),
    run: ir.run,
    lock: ir.lock,
    source_stage: ir.source_stage,
    target_stage: ir.target_stage,
    mutation: {
      allow_paths: [...ir.mutation.allow_paths],
      forbid_extra_paths: true,
    },
    requirements: compiledRequirements.sort((left, right) => compareCodeUnits(left.id, right.id)),
    generated_cases: allCases,
    coverage_map: [...coverageByRequirement.values()].sort((left, right) => compareCodeUnits(left.requirement_id, right.requirement_id)),
    required_validation: [...ir.required_validation],
    required_evidence: [...ir.required_evidence],
    prohibited_inference: [
      'Do not invent aliases, compatibility, fallback behaviour, equivalent surfaces, or missing cases.',
      'Do not reinterpret macro semantics or weaken an oracle.',
      'Do not expand the mutation allowlist or add a subsystem.',
    ],
    stop_conditions: [
      'G2_CONTRACT_INCOMPLETE',
      'G3_CONTRACT_BLOCK',
      'GATE_REENTRY_REQUIRED',
      'EVIDENCE_INCOMPLETE',
    ],
  };
  const packet = {
    ...packetCore,
    packet_digest: hashCanonical(packetCore),
  };
  return validateG3ExecutionPacket(packet);
}

function renderG3ExecutionPacket(ir) {
  return JSON.stringify(compileGateContract(ir), null, 2);
}


// Continuous profiles are prospective. Historical registry files remain unchanged.
const CONTINUOUS_ROLES = Object.freeze(['DISCOVERY', 'BUILDER', 'REVIEW', 'DESIGN_CHALLENGE']);
const HELPER_ROLES = Object.freeze(['DISCOVERY_HELPER', 'BUILDER_HELPER']);
const CHEAP_QUALIFIERS = Object.freeze(['bounded_scope', 'understood_interfaces', 'settled_product_trust', 'understood_effects', 'bounded_recovery', 'inspectable_acceptance', 'qualified_realization']);

function contractSchema(name) {
  if (!['controller-decision-v1.schema.json','controller-decision-v2.schema.json','stack-registry-v3.json','stack-registry-v3.schema.json','gate-contract-ir-v2.schema.json','gate-contract-ir-v3.schema.json','codex-host-adapter-v1.schema.json','codex-host-adapter-v2.schema.json'].includes(name)) fail('unknown core contract');
  const fs = require('node:fs');
  const path = require('node:path');
  return JSON.parse(fs.readFileSync(path.join(__dirname, '../contracts/controller-kernel', name), 'utf8'));
}

// This restricted evaluator is only for the closed schemas authored for this core.
// Unsupported schema constructs are an error, never a skipped check.
class RestrictedContractSchema {
  #schema; #root;
  constructor(schema,rootSchema=schema) {
    this.#schema=trustedJsonCopy(schema);this.#root=rootSchema===schema?this.#schema:trustedJsonCopy(rootSchema);
    this.#prepare(this.#root,new Set());this.#prepare(this.#schema,new Set());
  }
  #prepare(schema,seen) {
    const supported=new Set(['$ref','$schema','$id','$defs','title','description','type','anyOf','const','enum','required','properties','additionalProperties','items','minItems','maxItems','uniqueItems','minimum','maximum','minLength','maxLength','pattern']);
    if(!schema||typeof schema!=='object'||Array.isArray(schema)||Object.keys(schema).some(key=>!supported.has(key)))fail('unsupported core schema construct');
    if(seen.has(schema))return;seen.add(schema);
    if(schema.$ref){
      if(typeof schema.$ref!=='string'||!schema.$ref.startsWith('#/'))fail('external core schema reference');
      const target=schema.$ref.slice(2).split('/').reduce((node,part)=>node&&node[part],this.#root);if(!target)fail('missing core schema reference');this.#prepare(target,seen);
    }
    if(schema.anyOf){if(!Array.isArray(schema.anyOf)||!schema.anyOf.length)fail('invalid core schema alternatives');for(const branch of schema.anyOf)this.#prepare(branch,seen);}
    if(schema.type==='object'){
      if(schema.additionalProperties!==false||!schema.properties||!Array.isArray(schema.required)
        ||schema.required.some(key=>!Object.hasOwn(schema.properties,key)))fail('core object schema must be closed with explicit required fields');
    }
    for(const definitions of [schema.$defs,schema.properties])if(definitions)for(const value of Object.values(definitions))this.#prepare(value,seen);
    if(schema.items)this.#prepare(schema.items,seen);
  }
  validate(value,location='value') {this.#validate(trustedJsonCopy(value),this.#schema,this.#root,location);return true;}
  #validate(value, schema, rootSchema, location, depth = 0) {
    if(depth > 64) fail('core value/schema depth exceeded');
  const supported = new Set(['$ref','$schema','$id','$defs','title','description','type','anyOf','const','enum','required','properties','additionalProperties','items','minItems','maxItems','uniqueItems','minimum','maximum','minLength','maxLength','pattern']);
  if (!schema || typeof schema !== 'object' || Array.isArray(schema) || Object.keys(schema).some(key => !supported.has(key))) fail('unsupported core schema construct');
  if (schema.$ref) {
    if (!schema.$ref.startsWith('#/')) fail('external core schema reference');
    const target = schema.$ref.slice(2).split('/').reduce((node, part) => node[part], rootSchema);
    if (!target) fail('missing core schema reference');
    this.#validate(value, target, rootSchema, location, depth + 1);
  }
  if (schema.anyOf) {
    let accepted = false;
    for (const branch of schema.anyOf) {
      try { this.#validate(value, branch, rootSchema, location, depth + 1); accepted = true; break; } catch (error) {
        if (error.code !== GATE_ERROR_CODE) throw error;
      }
    }
    if (!accepted) fail(location + ' matches no schema branch');
  }
  if (own(schema, 'const') && !deepEqual(value, schema.const)) fail(location + ' has a wrong constant');
  if (schema.enum && !schema.enum.some(item => deepEqual(value, item))) fail(location + ' has an unknown value');
  if (schema.type === 'null' && value !== null) fail(location + ' must be null');
  if (schema.type === 'boolean' && typeof value !== 'boolean') fail(location + ' must be boolean');
  if (schema.type === 'integer') {
    if (!Number.isSafeInteger(value) || value < schema.minimum || value > schema.maximum) fail(location + ' has an invalid integer');
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string' || schema.minLength !== undefined && value.length < schema.minLength
      || schema.maxLength !== undefined && value.length > schema.maxLength
      || schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) fail(location + ' has an invalid string');
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value) || schema.minItems !== undefined && value.length < schema.minItems
      || schema.maxItems !== undefined && value.length > schema.maxItems) fail(location + ' has an invalid array');
    if (schema.uniqueItems && new Set(value.map(stableStringify)).size !== value.length) fail(location + ' has duplicates');
    value.forEach((item, index) => this.#validate(item, schema.items, rootSchema, location + '[' + index + ']', depth + 1));
  }
  if (schema.type === 'object') {
    checkKeys(value, schema.required || [], [], location);
    if (schema.additionalProperties !== false || !schema.properties) fail('core object schema must be closed');
    for (const key of Object.keys(value)) this.#validate(value[key], schema.properties[key], rootSchema, location + '.' + key, depth + 1);
  }
}

}
function checkCoreSchema(value,schema,rootSchema=schema,location='value') {
  return new RestrictedContractSchema(schema,rootSchema).validate(value,location);
}

function corePath(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(value)) fail('invalid core path');
  for (const part of value.split('/')) {
    if (part === '.' || part === '..' || part.endsWith('.') || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part)) fail('unsafe core path');
  }
  return value;
}

function resolveContinuousProfile(profileId, qualification, registrySnapshot, options = {}) {
  const { StackRegistrySnapshot } = require('./toolkit-stack-selection.cjs');
  if (!(registrySnapshot instanceof StackRegistrySnapshot)) fail('pinned registry source required');
  const qualified = trustedJsonCopy(qualification);
  checkCoreSchema(qualified, contractSchema('controller-decision-v1.schema.json').properties.selection.properties.builder_qualification);
  const selection = registrySnapshot.resolve(profileId, { historical: options.historical === true });
  return { profile_id: selection.profile_id, requested_profile_id: selection.requested_profile_id, registry_version: 3,
    routes: selection.routes, reviewers: selection.reviewers, registry_digest: selection.registry_digest,
    registry_reference: selection.registry_reference };
}
function resolveControllerRole(compiled, role, reviewerId = null) {
  const selection = compiled.selection || compiled.decision?.selection;
  if (!selection) fail('pinned controller selection required');
  if (role === 'REVIEW') {
    if (!Array.isArray(selection.reviewers) || typeof reviewerId !== 'string' || !reviewerId) fail('reviewer identity required');
    const member = selection.reviewers.find(item => item.reviewer_id === reviewerId);
    if (!member) fail('unadmitted review member');
    const { reviewer_id, ...route } = member;
    return { role, reviewer_id, route };
  }
  if (reviewerId !== null || !selection.routes?.[role]) fail('unadmitted role');
  if (compiled.decision?.schema === 'toolkit.controller-decision.v2' && ['REVIEW_SCOPE','REVIEW_EXECUTION'].includes(role)) fail('historical review role');
  return { role, reviewer_id: null, route: selection.routes[role] };
}

function validateControllerDecision(input, registrySnapshot = null) {
  const decision = trustedJsonCopy(input, new WeakSet(), 'controller_decision');
  checkCoreSchema(decision, contractSchema(decision.schema === 'toolkit.controller-decision.v2' ? 'controller-decision-v2.schema.json' : 'controller-decision-v1.schema.json'));
  if (decision.identity.stable_root !== decision.accounting.stable_root) fail('decision root/accounting mismatch');
  if (!deepEqual(decision.sources.base, decision.construction.base)) fail('decision integration base mismatch');
  const paths = decision.construction.allow_paths.map(corePath);
  if (new Set(paths.map(item => item.toLowerCase())).size !== paths.length) fail('case-colliding decision paths');
  decision.authority.targets.forEach(corePath);
  if (decision.authority.targets.some(item => !paths.includes(item))) fail('authority target outside construction');
  if (paths.some(item => !decision.construction.restrictions.some(rule => rule.path === item))
    || decision.construction.restrictions.some(rule => !paths.includes(rule.path))) fail('incomplete per-path restrictions');
  let resolved = { routes: decision.selection.routes, reviewers: decision.selection.reviewers };
  if (registrySnapshot !== null) {
    if (!deepEqual(registrySnapshot.reference, decision.sources.registry)) fail('registry source reference mismatch');
    resolved = resolveContinuousProfile(decision.selection.profile_id, decision.selection.builder_qualification, registrySnapshot,
      { historical: decision.schema === 'toolkit.controller-decision.v1' });
    if (!deepEqual(resolved.routes, decision.selection.routes)
      || decision.schema === 'toolkit.controller-decision.v2' && (!deepEqual(resolved.reviewers, decision.selection.reviewers)
        || resolved.registry_digest !== decision.selection.registry_digest)) fail('selected role/member is not registry-derived');
  }
  // No bundled-registry lookup here. Structural validation is not source
  // admission; compileControllerDecision always supplies captured source bytes.
  if (decision.selection.helper_bound > decision.accounting.remaining.helpers
    || decision.authority.effect_ceiling.helper_launches > decision.accounting.remaining.helpers
    || decision.authority.effect_ceiling.native_turns > decision.accounting.remaining.native_turns
    || decision.authority.effect_ceiling.candidate_submissions > decision.construction.candidate_ceiling
    || decision.construction.candidate_ceiling > decision.accounting.remaining.candidates) fail('decision bound exceeds grant');
  if (decision.authority.lifetime === 'EXPLICIT_EXPIRY' && decision.authority.expires_at === null) fail('explicit lifetime has no expiry');
  for (const at of [decision.authority.issued_at, decision.authority.expires_at].filter(item => item !== null)) {
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(at) || !Number.isFinite(Date.parse(at))) fail('invalid authority timestamp');
  }
  if (decision.authority.expires_at !== null && Date.parse(decision.authority.expires_at) <= Date.parse(decision.authority.issued_at)) fail('authority expiry precedes issuance');
  if (decision.accounting.debt.unknown_additional && decision.accounting.debt.kind === 'EXACT') fail('unknown debt cannot be exact');
  if (decision.assurance.design_challenge_required
    && (decision.assurance.design_challenge === null || resolved.routes.DESIGN_CHALLENGE === null)) fail('required design challenge route missing');
  const ids = new Set(), commands = new Map();
  for (const item of decision.verification.cases) {
    if (ids.has(item.id) || !decision.verification.requirements.includes(item.requirement)) fail('duplicate or foreign decision case');
    ids.add(item.id);
    const command={runner:item.runner,max_invocations:item.max_invocations,timeout_ms:item.timeout_ms,output_paths:item.output_paths,source:item.source};
    if(commands.has(item.runner.id)&&!deepEqual(commands.get(item.runner.id),command))fail('conflicting finite validation command');
    commands.set(item.runner.id,command);
    if (item.runner.argv.some(arg => arg.includes('\0')) || item.runner.executable.includes('\0')) fail('invalid validation argv');
    item.output_paths.forEach(corePath);
  }
  for (const requirement of decision.verification.requirements) {
    const cases=decision.verification.cases.filter(item=>item.requirement===requirement);
    for(const boundary of new Set(cases.map(item=>item.boundary))) {
      for(const kind of ['NEGATIVE','POSITIVE'])if(!cases.some(item=>item.boundary===boundary&&item.kind===kind))fail('missing same-boundary case pair');
    }
    if(!cases.length)fail('missing requirement cases');
  }
  return canonicalize(decision);
}

function decisionReferences(value, result = new Map()) {
  if (Array.isArray(value)) value.forEach(item => decisionReferences(item, result));
  else if (value && typeof value === 'object') {
    if (own(value, 'content_sha256') && own(value, 'repository') && own(value, 'revision')) {
      const previous = result.get(value.id);
      if (previous && !deepEqual(previous, value)) fail('conflicting source reference identity');
      result.set(value.id, value);
    } else Object.values(value).forEach(item => decisionReferences(item, result));
  }
  return result;
}

// This controller decision is a coordination plan, never worker admission.
// Suitability remains strong-lead judgment; substantial direct work records why.
function planV3Delegation(input, decisionInput) {
  const value = trustedJsonCopy(input);
  checkKeys(value, ['stage', 'substantial', 'tasks', 'exception'], [], 'delegation');
  if (!['G0', 'G1', 'G2'].includes(value.stage) || typeof value.substantial !== 'boolean'
    || !Array.isArray(value.tasks)) fail('invalid V3 delegation decision');
  const decision = validateControllerDecision(decisionInput);
  if (value.stage === 'G2') {
    if (value.tasks.length || value.exception !== null) fail('G2 cannot delegate');
    return canonicalize({ stage: 'G2', action: 'INDEPENDENT_REVIEW', helpers: [], exception: null });
  }
  const role = value.stage === 'G0' ? 'DISCOVERY_HELPER' : 'BUILDER_HELPER';
  const ids = new Set();
  for (const task of value.tasks) {
    checkKeys(task, ['id', 'instruction', 'paths'], [], 'delegation.tasks[]');
    if (typeof task.id !== 'string' || !task.id.trim() || ids.has(task.id)
      || typeof task.instruction !== 'string' || !task.instruction.trim()
      || !Array.isArray(task.paths) || !task.paths.length
      || new Set(task.paths).size !== task.paths.length) fail('invalid separable task');
    ids.add(task.id);
    for (const p of task.paths) if (!decision.construction.allow_paths.includes(corePath(p))) fail('helper path outside assignment');
  }
  const exceptions = ['TRIVIAL_OR_INSEPARABLE', 'OVERHEAD_EXCEEDS_BENEFIT', 'TIGHTLY_COUPLED_REASONING_OR_INTEGRATION', 'EXACT_MODEL_EFFORT_ROUTE_UNAVAILABLE', 'AUTHORITY_OR_SAFETY_BOUNDARY'];
  if (value.exception !== null) {
    checkKeys(value.exception, ['kind', 'reason'], [], 'delegation.exception');
    if (!exceptions.includes(value.exception.kind) || typeof value.exception.reason !== 'string'
      || !value.exception.reason.trim() || value.exception.reason.length > 2048) fail('invalid substantial-work exception');
  }
  if (!value.tasks.length && value.substantial && value.exception === null) fail('substantial direct work requires a brief exception');
  if (value.tasks.length && value.exception !== null) fail('delegation and whole-work exception conflict');
  return canonicalize({ stage: value.stage, action: value.tasks.length ? 'DELEGATE_SUITABLE_LEAVES' : 'DIRECT_WORK',
    helpers: value.tasks.map(task => ({ ...task, role, route: decision.selection.routes[role], depth: 1, may_delegate: false })),
    exception: value.exception, authority: 'PLAN_ONLY_NATIVE_PERMISSION_REQUIRED', lead_owns: ['reasoning', 'architecture', 'decisive_proof', 'integration', 'uat_readiness', 'final_quality'] });
}

function compileControllerDecision(input, observations) {
  let decision = validateControllerDecision(input);
  const evidence = trustedJsonCopy(observations, new WeakSet(), 'decision_evidence');
  if (!Array.isArray(evidence)) fail('independent source observations required');
  const refs = decisionReferences(decision), seen = new Set();
  for (const item of evidence) {
    checkKeys(item, ['reference', 'content_base64'], [], 'decision_evidence[]');
    const expected = refs.get(item.reference.id);
    if (!expected || !deepEqual(expected, item.reference) || seen.has(expected.id)) fail('foreign or conflicting evidence');
    if (typeof item.content_base64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.content_base64)) fail('invalid evidence bytes');
    const bytes = Buffer.from(item.content_base64, 'base64');
    if (!bytes.length || bytes.toString('base64') !== item.content_base64
      || crypto.createHash('sha256').update(bytes).digest('hex') !== expected.content_sha256) fail('source byte digest mismatch');
    if (expected.blob_sha1 !== null && crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob ' + bytes.length + '\0'), bytes])).digest('hex') !== expected.blob_sha1) fail('source blob mismatch');
    seen.add(expected.id);
  }
  if (seen.size !== refs.size) fail('incomplete decision source evidence');
  const registrySource = evidence.find(item => item.reference.id === decision.sources.registry.id);
  let registry;
  try { registry = JSON.parse(Buffer.from(registrySource.content_base64, 'base64').toString('utf8')); } catch (_) { fail('invalid observed registry'); }
  const { StackRegistrySnapshot } = require('./toolkit-stack-selection.cjs');
  const captured = new StackRegistrySnapshot({ reference: registrySource.reference, content_base64: registrySource.content_base64,
    historical: decision.schema === 'toolkit.controller-decision.v1' });
  decision = validateControllerDecision(decision, captured);
  const resolution = resolveContinuousProfile(decision.selection.profile_id, decision.selection.builder_qualification, captured,
    { historical: decision.schema === 'toolkit.controller-decision.v1' });
  return canonicalize({
    schema: 'toolkit.compiled-controller-decision.v1',
    decision, decision_digest: hashCanonical(decision), selection: resolution,
    source_observation_digest: hashCanonical(evidence),
    authority_status: 'PLAN_ONLY_REQUIRES_FRESH_AUTHENTIC_ADMISSION',
  });
}

function compileControllerGateContract(ir) {
  const copy = trustedJsonCopy(ir);
  checkKeys(copy, ['schema','run','lock','source_stage','target_stage','mutation','requirements','required_validation','required_evidence','controller_decision'], [], 'ir');
  const current=copy.schema==='toolkit.gate-contract-ir.v3';
  // IR fixture inputs/results intentionally retain arbitrary JSON values from
  // the legacy contract. The bounded IR/macro compiler below validates their
  // envelope, known macro parameters and JSON compatibility. The restricted
  // Core evaluator validates the embedded closed controller decision; it
  // rejects open object schemas and must not be used as the IR validator.
  const decision = validateControllerDecision(copy.controller_decision);
  if(current !== (decision.schema==='toolkit.controller-decision.v2'))fail('IR controller schema/version mismatch');
  if (decision.identity.run !== copy.run || decision.identity.lock !== copy.lock
    || !deepEqual(decision.construction.allow_paths, copy.mutation.allow_paths)) fail('IR decision binding mismatch');
  if(!deepEqual([...decision.verification.requirements].sort(compareCodeUnits),copy.requirements.map(r=>r.id).sort(compareCodeUnits))
    ||!deepEqual([...new Set(decision.verification.cases.map(c=>c.runner.id))].sort(compareCodeUnits),[...copy.required_validation].sort(compareCodeUnits)))fail('IR validation/requirement decision divergence');
  const legacy = { ...copy, schema: 'toolkit.gate-contract-ir.v1' };
  delete legacy.controller_decision;
  const packet = compileGateContract(legacy);
  const output = { ...packet, schema: current?'toolkit.g3-execution-packet.v3':'toolkit.g3-execution-packet.v2', controller_decision: decision,
    controller_decision_digest: hashCanonical(decision), source_contract_digest: hashCanonical(copy) };
  delete output.packet_digest;
  output.packet_digest = hashCanonical(output);
  return validateG3ExecutionPacket(output);
}

function validateControllerExecutionPacket(input) {
  const packet = trustedJsonCopy(input);
  const decision = validateControllerDecision(packet.controller_decision);
  if((packet.schema==='toolkit.g3-execution-packet.v3') !== (decision.schema==='toolkit.controller-decision.v2'))fail('execution controller schema/version mismatch');
  if (packet.controller_decision_digest !== hashCanonical(decision)
    || decision.identity.run !== packet.run || decision.identity.lock !== packet.lock
    || !deepEqual(decision.construction.allow_paths, packet.mutation.allow_paths)) fail('packet decision binding mismatch');
  const digestInput = { ...packet }; delete digestInput.packet_digest;
  if (hashCanonical(digestInput) !== packet.packet_digest) fail('v2 packet digest mismatch');
  if(!deepEqual([...decision.verification.requirements].sort(compareCodeUnits),packet.requirements.map(r=>r.id).sort(compareCodeUnits))
    ||!deepEqual([...new Set(decision.verification.cases.map(c=>c.runner.id))].sort(compareCodeUnits),[...packet.required_validation].sort(compareCodeUnits)))fail('packet validation/requirement decision divergence');
  const legacy = { ...packet, schema: 'toolkit.g3-execution-packet.v1' };
  delete legacy.controller_decision; delete legacy.controller_decision_digest;
  delete legacy.packet_digest; legacy.packet_digest = hashCanonical(legacy);
  validateG3ExecutionPacket(legacy);
  return canonicalize(packet);
}

module.exports = {
  planV3Delegation,
  trustedJsonCopy, RestrictedContractSchema, checkCoreSchema, contractSchema, CONTINUOUS_ROLES, HELPER_ROLES, CHEAP_QUALIFIERS, corePath, validateControllerDecision, resolveContinuousProfile, resolveControllerRole, compileControllerDecision, decisionReferences,
  SUPPORTED_MACROS,
  MACRO_NAMES,
  canonicalize,
  hashCanonical,
  validateJsonCompatible,
  validateG3ExecutionPacket,
  compileGateContract,
  renderG3ExecutionPacket,
};

if (require.main === module) {
  const fs = require('node:fs');
  const filename = process.argv[2];
  if (!filename) {
    process.stderr.write('usage: node toolkit-gate-contract-compiler.cjs <contract-ir.json>\n');
    process.exitCode = 2;
  } else {
    process.stdout.write(`${JSON.stringify(compileGateContract(JSON.parse(fs.readFileSync(filename, 'utf8'))), null, 2)}\n`);
  }
}
