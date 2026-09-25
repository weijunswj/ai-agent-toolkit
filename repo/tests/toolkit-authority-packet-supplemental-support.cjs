'use strict';

const fs = require('node:fs');
const path = require('node:path');
const runtime = require('../scripts/toolkit-github-program-receipt.cjs');
const compiler = require('../scripts/toolkit-gate-contract-compiler.cjs');
const packetSupport = require('./toolkit-authority-packet-test-support.cjs');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'authority-packet-reclosure-supplemental-v1.json');
const REQUIRED_CASE_IDS = Object.freeze([
  'R090-F1-SETUP-FLAG-NEG',
  'R090-F1-SETUP-FLAG-POS',
  'R090-F2-PROXY-RECIPE-NEG',
  'R090-F2-CLEAN-RECIPE-POS',
]);
const CASE_VARIANTS = Object.freeze({
  'R090-F1-SETUP-FLAG-NEG': 'missing-decision',
  'R090-F1-SETUP-FLAG-POS': 'clean-packet',
  'R090-F2-PROXY-RECIPE-NEG': 'hostile-proxy-recipe',
  'R090-F2-CLEAN-RECIPE-POS': 'clean-packet',
});
const COMPILED = new WeakMap();
const REGISTERED = new WeakMap();
const CASE_RECEIPTS = new WeakMap();
const COMPLETION_RECEIPTS = new WeakMap();
const TRUSTED_RECIPES = new Map();

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function caseIdentity(item) {
  return [item.requirement_id, item.id, item.input && item.input.variant, item.surface].join('\u0000');
}

function declaredCaseId(item) {
  let identity;
  try { identity = JSON.parse(item.id); } catch (_) { fail('SUPPLEMENTAL_COMPILED_ID_INVALID'); }
  if (!Array.isArray(identity) || identity.length !== 4 || identity[1] !== 'EXPLICIT'
    || typeof identity[2] !== 'string') fail('SUPPLEMENTAL_COMPILED_ID_INVALID');
  return identity[2];
}

function caseIdentitiesFromIr(ir) {
  if (!ir || !Array.isArray(ir.requirements)) fail('SUPPLEMENTAL_DECLARATION_INVALID');
  const ids = [];
  const seen = new Set();
  for (const requirement of ir.requirements) {
    if (!requirement || !Array.isArray(requirement.cases)) fail('SUPPLEMENTAL_DECLARATION_INVALID');
    for (const item of requirement.cases) {
      if (!item || typeof item.id !== 'string') fail('SUPPLEMENTAL_DECLARATION_INVALID');
      if (seen.has(item.id)) fail(`SUPPLEMENTAL_DECLARATION_DUPLICATE:${item.id}`);
      seen.add(item.id);
      ids.push(item.id);
    }
  }
  const expected = [...REQUIRED_CASE_IDS].sort();
  const actual = [...ids].sort();
  if (actual.length !== expected.length || actual.some((id, index) => id !== expected[index])) {
    fail(`SUPPLEMENTAL_DECLARATION_SET_MISMATCH:expected=${expected.join(',')}:actual=${actual.join(',')}`);
  }
  return ids;
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Object.keys(value)) deepFreeze(value[key], seen);
  return Object.freeze(value);
}

function loadFixture() {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
}

function compileSupplementalFixture(ir = loadFixture()) {
  const declarationIds = caseIdentitiesFromIr(ir);
  if (ir.run !== 'toolkit-c1-run090-combined-f1-f2-f3-correction-g3-20260925-091'
    || ir.lock !== 'DL-C1-RUN090-COMBINED-F1-F2-F3-CORRECTION-G3-091') {
    fail('SUPPLEMENTAL_RUN_LOCK_MISMATCH');
  }
  const packet = compiler.compileGateContract(ir);
  const byId = new Map(packet.generated_cases.map((item) => [declaredCaseId(item), item]));
  if (byId.size !== REQUIRED_CASE_IDS.length || REQUIRED_CASE_IDS.some((id) => !byId.has(id))) {
    fail('SUPPLEMENTAL_COMPILED_CASE_SET_MISMATCH');
  }
  for (const id of REQUIRED_CASE_IDS) {
    const item = byId.get(id);
    if (item.surface !== 'validateAuthorityPacket' || item.input.variant !== CASE_VARIANTS[id]) {
      fail(`SUPPLEMENTAL_CASE_CONTRACT_MISMATCH:${id}`);
    }
  }
  if (declarationIds.length !== packet.generated_cases.length) fail('SUPPLEMENTAL_COMPILED_CASE_COUNT_MISMATCH');
  const token = Object.freeze({});
  COMPILED.set(token, {
    ir: deepFreeze(JSON.parse(JSON.stringify(ir))),
    cases: REQUIRED_CASE_IDS.map((id) => byId.get(id)),
  });
  return token;
}

function compiledSummary(token) {
  const record = token && COMPILED.get(token);
  if (!record) return null;
  return Object.freeze({
    state: 'DECLARED_COMPILED',
    case_count: record.cases.length,
    case_ids: Object.freeze(record.cases.map(declaredCaseId)),
    identities: Object.freeze(record.cases.map(caseIdentity)),
  });
}

function expectedRegistration(item) {
  const identity = caseIdentity(item);
  const caseId = declaredCaseId(item);
  const seed = `r090-${caseId}`;
  const binding = {
    case_id: caseId,
    case_identity: identity,
    surface: item.surface,
    target: 'toolkit-github-program-receipt',
    method: 'validateAuthorityPacket',
    recipe_variant: CASE_VARIANTS[caseId],
    clean_seed: seed,
    expected: item.expected,
  };
  return Object.freeze({ ...binding, binding_digest: runtime.digestValue(binding) });
}

function registrationCandidates(compiledToken) {
  const record = compiledToken && COMPILED.get(compiledToken);
  if (!record) fail('SUPPLEMENTAL_COMPILED_TOKEN_INVALID');
  return record.cases.map((item) => ({ ...expectedRegistration(item) }));
}

function validateRegistrationSet(compiledToken, candidates) {
  const compiled = compiledToken && COMPILED.get(compiledToken);
  if (!compiled) fail('SUPPLEMENTAL_COMPILED_TOKEN_INVALID');
  if (!Array.isArray(candidates)) fail('SUPPLEMENTAL_REGISTRATION_INVALID');
  const expected = new Map(compiled.cases.map((item) => [caseIdentity(item), item]));
  const observed = new Map();
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object' || typeof candidate.case_identity !== 'string') {
      fail('SUPPLEMENTAL_REGISTRATION_INVALID');
    }
    if (observed.has(candidate.case_identity)) fail(`SUPPLEMENTAL_REGISTRATION_DUPLICATE:${candidate.case_identity}`);
    const item = expected.get(candidate.case_identity);
    if (!item) fail(`SUPPLEMENTAL_REGISTRATION_UNKNOWN:${candidate.case_identity}`);
    const required = expectedRegistration(item);
    if (runtime.canonicalSerialize(candidate) !== runtime.canonicalSerialize(required)) {
      fail(`SUPPLEMENTAL_REGISTRATION_SUBSTITUTED:${item.id}`);
    }
    observed.set(candidate.case_identity, item);
  }
  for (const item of compiled.cases) {
    const identity = caseIdentity(item);
    if (!observed.has(identity)) fail(`SUPPLEMENTAL_REGISTRATION_MISSING:${item.id}`);
  }
  if (observed.size !== compiled.cases.length) fail('SUPPLEMENTAL_REGISTRATION_SET_MISMATCH');
  return observed;
}

function registerSupplementalCases(compiledToken, candidates = registrationCandidates(compiledToken)) {
  const compiled = compiledToken && COMPILED.get(compiledToken);
  const registered = validateRegistrationSet(compiledToken, candidates);
  const plans = new Map();
  for (const [index, item] of compiled.cases.entries()) {
    const identity = caseIdentity(item);
    const registration = expectedRegistration(item);
    const plan = Object.freeze({
      identity,
      role: 'required',
      order: index + 1,
      multiplicity: 1,
      target_id: 'toolkit-github-program-receipt',
      target: runtime,
      method_name: 'validateAuthorityPacket',
      method: runtime.validateAuthorityPacket,
      recipe_variant: registration.recipe_variant,
      clean_seed: registration.clean_seed,
      expected: item.expected,
      evidence_responsibility: 'observe actual awaited production outcome and zero recipe-binding hooks',
    });
    plans.set(identity, Object.freeze({ item, registration, plan }));
  }
  const token = Object.freeze({});
  REGISTERED.set(token, { compiled, registered, plans });
  return token;
}

function registeredSummary(token) {
  const state = token && REGISTERED.get(token);
  if (!state) return null;
  return Object.freeze({
    state: 'REGISTERED',
    case_count: state.registered.size,
    case_ids: Object.freeze([...state.plans.values()].map((entry) => entry.item.id)),
    identities: Object.freeze([...state.registered.keys()]),
  });
}

function createHostileRecipe(counters) {
  const target = {};
  Object.defineProperty(target, 'schema', {
    enumerable: true,
    get() { counters.getters += 1; return 'hostile'; },
  });
  Object.defineProperty(target, 'toJSON', {
    enumerable: true,
    value() { counters.toJSON += 1; return {}; },
  });
  return new Proxy(target, {
    get(object, key, receiver) { counters.proxy_traps += 1; return Reflect.get(object, key, receiver); },
    ownKeys(object) { counters.proxy_traps += 1; return Reflect.ownKeys(object); },
    getOwnPropertyDescriptor(object, key) { counters.proxy_traps += 1; return Reflect.getOwnPropertyDescriptor(object, key); },
    getPrototypeOf(object) { counters.proxy_traps += 1; return Reflect.getPrototypeOf(object); },
  });
}

function createTrustedRecipe(entry) {
  const { item, plan, registration } = entry;
  const counters = { getters: 0, proxy_traps: 0, toJSON: 0 };
  let argument;
  if (plan.recipe_variant === 'hostile-proxy-recipe') {
    argument = createHostileRecipe(counters);
  } else {
    argument = packetSupport.packet({ seed: registration.clean_seed });
    if (plan.recipe_variant === 'missing-decision') delete argument.body.decision;
  }
  const recipe = Object.freeze({
    recipe_id: runtime.digestValue({ schema: 'toolkit.github-program.r090-recipe.v1', identity: plan.identity, variant: plan.recipe_variant }),
    identity: plan.identity,
    argument,
    counters,
    expected: plan.expected,
  });
  TRUSTED_RECIPES.set(plan.identity, recipe);
  return recipe;
}

function bindTrustedRecipe(plan, recipe, suppliedArgument) {
  const registeredRecipe = TRUSTED_RECIPES.get(plan.identity);
  if (!registeredRecipe || registeredRecipe !== recipe || recipe.identity !== plan.identity
    || plan.target !== runtime || plan.method !== runtime.validateAuthorityPacket
    || suppliedArgument !== recipe.argument) {
    fail(`SUPPLEMENTAL_RECIPE_BINDING_MISMATCH:${plan.identity}`);
  }
  return runtime.digestValue({
    schema: 'toolkit.github-program.r090-recipe-binding.v1',
    identity: plan.identity,
    recipe_id: recipe.recipe_id,
    target_id: plan.target_id,
    method_name: plan.method_name,
    argument_reference: 'exact',
  });
}

async function executeOne(entry, ledger, options) {
  const { item, plan } = entry;
  const recipe = createTrustedRecipe(entry);
  const argument = recipe.argument;
  const argumentBindingDigest = bindTrustedRecipe(plan, recipe, argument);
  if (recipe.counters.getters !== 0 || recipe.counters.proxy_traps !== 0 || recipe.counters.toJSON !== 0) {
    fail(`SUPPLEMENTAL_RECIPE_BINDING_EXECUTED_HOOK:${item.id}`);
  }
  const bindingHookCounts = Object.freeze({ ...recipe.counters });
  const attempt = {
    sequence: ledger.attempts.length + 1,
    case_identity: plan.identity,
    role: plan.role,
    target_id: plan.target_id,
    method_name: plan.method_name,
    recipe_id: recipe.recipe_id,
    argument_binding_digest: argumentBindingDigest,
    outcome: 'PENDING',
    reason_code: null,
  };
  ledger.attempts.push(attempt);
  let value;
  let error = null;
  try {
    value = await Promise.resolve().then(() => plan.method.call(plan.target, argument));
  } catch (caught) {
    error = caught;
  }
  attempt.outcome = error ? 'REJECT' : 'ACCEPT';
  attempt.reason_code = error ? (error.reason_code || error.code || 'GPR_PACKET_VALUE_INVALID') : null;
  if (typeof options.afterProduction === 'function') {
        await options.afterProduction(Object.freeze({ case_id: declaredCaseId(item), outcome: attempt.outcome }));
  }
  const expected = plan.expected;
  if (attempt.outcome !== expected.outcome || (expected.reason_code && attempt.reason_code !== expected.reason_code)) {
    fail(`SUPPLEMENTAL_PRODUCTION_OUTCOME_MISMATCH:${item.id}`);
  }
  if (recipe.counters.getters !== 0 || recipe.counters.toJSON !== 0) fail(`SUPPLEMENTAL_RECIPE_HOOK_EXECUTED:${item.id}`);
  if (plan.role !== 'required' || attempt.sequence !== plan.order || attempt.target_id !== plan.target_id
    || attempt.method_name !== plan.method_name || ledger.attempts.filter((row) => row.case_identity === plan.identity).length !== 1) {
    fail(`SUPPLEMENTAL_PLAN_TRACE_MISMATCH:${item.id}`);
  }
  const receipt = Object.freeze({});
  CASE_RECEIPTS.set(receipt, Object.freeze({
    case_id: declaredCaseId(item),
    case_identity: plan.identity,
    role: plan.role,
    target_id: attempt.target_id,
    method_name: attempt.method_name,
    outcome: attempt.outcome,
    reason_code: attempt.reason_code,
    positive_control: expected.positive_control === true,
    recipe_id: recipe.recipe_id,
    argument_binding_digest: argumentBindingDigest,
    binding_hook_counts: bindingHookCounts,
    production_hook_counts: Object.freeze({ ...recipe.counters }),
    value_observed: !error,
    exception_observed: Boolean(error),
  }));
  ledger.case_receipts.push(receipt);
  return receipt;
}

async function executeSupplementalOracle(registeredToken, options = {}) {
  const state = registeredToken && REGISTERED.get(registeredToken);
  if (!state) fail('SUPPLEMENTAL_REGISTERED_TOKEN_INVALID');
  if (options === null || typeof options !== 'object' || Array.isArray(options)) fail('SUPPLEMENTAL_EXECUTION_OPTIONS_INVALID');
  const ledger = { attempts: [], case_receipts: [] };
  for (const entry of state.plans.values()) {
    if (options.skip_case_identity === entry.plan.identity) continue;
    await executeOne(entry, ledger, options);
  }
  const expectedIdentities = [...state.plans.keys()];
  const executedIdentities = ledger.case_receipts.map((receipt) => CASE_RECEIPTS.get(receipt)?.case_identity);
  if (executedIdentities.length !== expectedIdentities.length
    || new Set(executedIdentities).size !== expectedIdentities.length
    || expectedIdentities.some((identity) => !executedIdentities.includes(identity))) {
    fail('SUPPLEMENTAL_CASE_UNEXECUTED');
  }
  if (ledger.attempts.length !== expectedIdentities.length || ledger.attempts.some((attempt) => attempt.outcome === 'PENDING')) {
    fail('SUPPLEMENTAL_AWAITED_BOUNDARY_INCOMPLETE');
  }
  for (let index = 0; index < ledger.attempts.length; index += 1) {
    if (ledger.attempts[index].case_identity !== expectedIdentities[index]
      || ledger.attempts[index].sequence !== index + 1) fail('SUPPLEMENTAL_TRACE_ORDER_MISMATCH');
  }
  const completion = Object.freeze({});
  COMPLETION_RECEIPTS.set(completion, Object.freeze({
    registered_count: state.registered.size,
    executed_count: ledger.case_receipts.length,
    case_ids: Object.freeze(ledger.case_receipts.map((receipt) => CASE_RECEIPTS.get(receipt).case_id)),
    attempts: Object.freeze(ledger.attempts.map((attempt) => Object.freeze({ ...attempt }))),
    cases: Object.freeze(ledger.case_receipts.map((receipt) => CASE_RECEIPTS.get(receipt))),
    positive_controls: ledger.case_receipts.map((receipt) => CASE_RECEIPTS.get(receipt)).filter((item) => item.positive_control).length,
  }));
  return completion;
}

function verifySupplementalCompletion(receipt) {
  const record = receipt && COMPLETION_RECEIPTS.get(receipt);
  if (!record || record.registered_count !== REQUIRED_CASE_IDS.length || record.executed_count !== REQUIRED_CASE_IDS.length
    || record.attempts.length !== REQUIRED_CASE_IDS.length || record.cases.length !== REQUIRED_CASE_IDS.length
    || record.attempts.some((item) => item.outcome === 'PENDING' || item.role !== 'required')) return null;
  return Object.freeze({
    state: 'ACTUALLY_EXECUTED',
    registered_count: record.registered_count,
    executed_count: record.executed_count,
    case_ids: record.case_ids,
    attempts: record.attempts,
    cases: record.cases,
    positive_controls: record.positive_controls,
  });
}

module.exports = Object.freeze({
  REQUIRED_CASE_IDS,
  CASE_VARIANTS,
  loadFixture,
  caseIdentity,
  compileSupplementalFixture,
  compiledSummary,
  registrationCandidates,
  registerSupplementalCases,
  registeredSummary,
  executeSupplementalOracle,
  verifySupplementalCompletion,
});
