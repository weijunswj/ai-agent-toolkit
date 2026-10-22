'use strict';

const crypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

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

// Continuous profiles are prospective: only the current registry and controller-decision v2 are read.
const CONTINUOUS_ROLES = Object.freeze(['DISCOVERY', 'BUILDER', 'REVIEW', 'DESIGN_CHALLENGE']);
const HELPER_ROLES = Object.freeze(['DISCOVERY_HELPER', 'BUILDER_HELPER']);
const CHEAP_QUALIFIERS = Object.freeze(['bounded_scope', 'understood_interfaces', 'settled_product_trust', 'understood_effects', 'bounded_recovery', 'inspectable_acceptance', 'qualified_realization']);

function contractSchema(name) {
  if (!['controller-decision-v2.schema.json','stack-registry-v3.json','stack-registry-v3.schema.json','gate-contract-ir-v3.schema.json','codex-host-adapter-v2.schema.json'].includes(name)) fail('unknown core contract');
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

function resolveContinuousProfile(profileId, qualification, registrySnapshot) {
  const { StackRegistrySnapshot } = require('./toolkit-stack-selection.cjs');
  if (!(registrySnapshot instanceof StackRegistrySnapshot)) fail('pinned registry source required');
  const qualified = trustedJsonCopy(qualification);
  const decisionSchema = contractSchema('controller-decision-v2.schema.json');
  checkCoreSchema(qualified, decisionSchema.$defs.builder_qualification, decisionSchema);
  const selection = registrySnapshot.resolve(profileId);
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
  return { role, reviewer_id: null, route: selection.routes[role] };
}

function validateControllerDecision(input, registrySnapshot = null) {
  const decision = trustedJsonCopy(input, new WeakSet(), 'controller_decision');
  checkCoreSchema(decision, contractSchema('controller-decision-v2.schema.json'));
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
    resolved = resolveContinuousProfile(decision.selection.profile_id, decision.selection.builder_qualification, registrySnapshot);
    if (!deepEqual(resolved.routes, decision.selection.routes) || !deepEqual(resolved.reviewers, decision.selection.reviewers)
      || resolved.registry_digest !== decision.selection.registry_digest) fail('selected role/member is not registry-derived');
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
    // SHA-1 is required for Git blob object-ID compatibility;
    // SHA-256 independently verifies content integrity.
    // codeql[js/weak-cryptographic-algorithm]
    if (expected.blob_sha1 !== null && crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob ' + bytes.length + '\0'), bytes])).digest('hex') !== expected.blob_sha1) fail('source blob mismatch');
    seen.add(expected.id);
  }
  if (seen.size !== refs.size) fail('incomplete decision source evidence');
  const registrySource = evidence.find(item => item.reference.id === decision.sources.registry.id);
  let registry;
  try { registry = JSON.parse(Buffer.from(registrySource.content_base64, 'base64').toString('utf8')); } catch (_) { fail('invalid observed registry'); }
  const { StackRegistrySnapshot } = require('./toolkit-stack-selection.cjs');
  const captured = new StackRegistrySnapshot({ reference: registrySource.reference, content_base64: registrySource.content_base64 });
  decision = validateControllerDecision(decision, captured);
  const resolution = resolveContinuousProfile(decision.selection.profile_id, decision.selection.builder_qualification, captured);
  return canonicalize({
    schema: 'toolkit.compiled-controller-decision.v1',
    decision, decision_digest: hashCanonical(decision), selection: resolution,
    source_observation_digest: hashCanonical(evidence),
    authority_status: 'PLAN_ONLY_REQUIRES_FRESH_AUTHENTIC_ADMISSION',
  });
}

module.exports = {
  trustedJsonCopy, canonicalize, hashCanonical, checkCoreSchema, contractSchema, corePath,
  CONTINUOUS_ROLES, HELPER_ROLES, CHEAP_QUALIFIERS,
  validateControllerDecision, resolveContinuousProfile, resolveControllerRole, compileControllerDecision, decisionReferences, planV3Delegation,
};
