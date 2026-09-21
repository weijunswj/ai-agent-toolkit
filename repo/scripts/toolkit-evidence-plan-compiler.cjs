'use strict';

const crypto = require('node:crypto');

const PROVENANCE_FIELDS = Object.freeze([
  'REPOSITORY',
  'REVISION',
  'PATH',
  'BLOB_SHA1',
  'CONTENT_SHA256',
  'BYTE_RANGE',
]);

const EVIDENCE_MACRO_FACETS = Object.freeze({
  SYMBOL_CONSUMER_SEARCH: Object.freeze([
    'DEFINITIONS_EXPORTS',
    'DIRECT_CONSUMERS',
    'ALIASES_WRAPPERS_REEXPORTS',
    'GENERATED_CONSUMERS',
    'TEST_SCHEMA_DOC_COMPAT_CONSUMERS',
  ]),
  PUBLIC_SURFACE_INVENTORY: Object.freeze([
    'PUBLIC_EXPORTS_ALIASES',
    'IMPLEMENTATION_IDENTITIES',
    'CONSEQUENTIAL_BOUNDARIES',
  ]),
  STATE_ROUNDTRIP_INVENTORY: Object.freeze([
    'STATE_BOUNDARIES',
    'FIELDS_ALIASES_DEFAULTS_NORMALIZATION',
    'ROUNDTRIP_MEANING',
  ]),
  AUTHORITY_ALIAS_INVENTORY: Object.freeze([
    'ACCEPTED_ALIASES',
    'AUTHORITY_CLASSIFICATIONS',
    'CONFLICTS_PRECEDENCE',
  ]),
  DESCRIPTOR_BOUNDARY_INVENTORY: Object.freeze([
    'PRE_SCREEN_READS',
    'ACCESSOR_RISKS',
    'BOUNDARY_READ_ORDER',
  ]),
  SECRET_PATTERN_INVENTORY: Object.freeze([
    'PATTERN_SETS',
    'SURFACE_PATTERN_COMPARISON',
    'OMISSIONS_EXISTING_FLOORS',
  ]),
  CONFIG_PRECEDENCE_INVENTORY: Object.freeze([
    'CONFIG_SOURCES',
    'PRECEDENCE_FALSY_NULLISH',
    'MASKING_CONTRADICTIONS',
  ]),
});

const MACRO_INSTRUCTIONS = Object.freeze({
  DEFINITIONS_EXPORTS: 'Locate exact definitions and exports for each named target.',
  DIRECT_CONSUMERS: 'Search direct consumers/imports/call sites.',
  ALIASES_WRAPPERS_REEXPORTS: 'Search aliases/wrappers/re-exports and generated consumers.',
  GENERATED_CONSUMERS: 'Classify generated consumers and their exact source identity.',
  TEST_SCHEMA_DOC_COMPAT_CONSUMERS: 'Search tests, schemas, docs and compatibility/migration consumers where applicable.',
  PUBLIC_EXPORTS_ALIASES: 'Enumerate public exports and materially equivalent aliases for each target.',
  IMPLEMENTATION_IDENTITIES: 'Trace each public alias to its concrete implementation identity.',
  CONSEQUENTIAL_BOUNDARIES: 'Record whether all aliases share the same consequential boundary.',
  STATE_BOUNDARIES: 'Identify create/read/derive/transition/serialize boundaries for the named state.',
  FIELDS_ALIASES_DEFAULTS_NORMALIZATION: 'Record field names, aliases, defaults and normalization at each boundary.',
  ROUNDTRIP_MEANING: 'Identify any unchanged state that changes meaning across a round trip.',
  ACCEPTED_ALIASES: 'Enumerate every accepted authority/action/route alias in the named surfaces.',
  AUTHORITY_CLASSIFICATIONS: 'Classify each alias as authoritative, display-only, compatibility-only or forbidden.',
  CONFLICTS_PRECEDENCE: 'Return conflicts or precedence rules without choosing a new architecture.',
  PRE_SCREEN_READS: 'Identify reads/copies/spreads/destructuring performed before descriptor screening.',
  ACCESSOR_RISKS: 'Identify getter/accessor execution risk at each consequential boundary.',
  BOUNDARY_READ_ORDER: 'Return exact boundary and read order evidence.',
  PATTERN_SETS: 'Locate existing secret/private-data screening pattern sets.',
  SURFACE_PATTERN_COMPARISON: 'Compare pattern families across materially equivalent public surfaces.',
  OMISSIONS_EXISTING_FLOORS: 'Return omissions and stronger existing floors with exact source identity.',
  CONFIG_SOURCES: 'Enumerate explicit, inherited, defaulted and fallback configuration sources.',
  PRECEDENCE_FALSY_NULLISH: 'Record precedence and falsy/nullish behavior.',
  MASKING_CONTRADICTIONS: 'Return contradiction paths where one source can mask another.',
});

const MACRO_STEPS = Object.freeze(Object.fromEntries(
  Object.entries(EVIDENCE_MACRO_FACETS).map(([macro, facets]) => [
    macro,
    Object.freeze(facets.map((facet) => Object.freeze({
      facet,
      instruction: MACRO_INSTRUCTIONS[facet],
    }))),
  ]),
));

const PROVENANCE_SET = new Set(PROVENANCE_FIELDS);
const EVIDENCE_MACRO_NAMES = Object.freeze(Object.keys(EVIDENCE_MACRO_FACETS));
const EVIDENCE_ERROR_CODE = 'EVIDENCE_MANIFEST_INVALID';
const RESPONSE_SCHEMA = 'toolkit.g0b-evidence-response.v1';
const VERIFICATION_SCHEMA = 'toolkit.g0b-evidence-verification-context.v1';

function fail(message) {
  const error = new Error(message);
  error.code = EVIDENCE_ERROR_CODE;
  throw error;
}

function own(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateJsonCompatible(value, seen = new WeakSet(), location = 'value') {
  if (value === null) return;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return;
    case 'number':
      if (!Number.isFinite(value) || Object.is(value, -0)) fail(`${location} contains a non-serializable number`);
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
    if (!lengthDescriptor || lengthDescriptor.get || lengthDescriptor.set) fail(`${location} has an invalid array length descriptor`);
    for (const name of names) {
      if (name === 'length') continue;
      if (!/^(0|[1-9]\d*)$/.test(name) || Number(name) >= value.length) fail(`${location} contains a non-serializable array property`);
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (!descriptor || descriptor.get || descriptor.set || descriptor.enumerable !== true) fail(`${location}[${name}] is not an enumerable data property`);
    }
    for (let index = 0; index < value.length; index += 1) {
      const name = String(index);
      if (!own(value, name)) fail(`${location} is sparse`);
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      validateJsonCompatible(descriptor.value, seen, `${location}[${name}]`);
    }
  } else {
    if (!isPlainObject(value)) fail(`${location} has a custom prototype`);
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (!descriptor || descriptor.get || descriptor.set || descriptor.enumerable !== true) fail(`${location}.${name} is not an enumerable data property`);
      validateJsonCompatible(descriptor.value, seen, `${location}.${name}`);
    }
  }
  seen.delete(value);
}

function cloneCanonical(value) {
  if (Array.isArray(value)) return value.map(cloneCanonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, cloneCanonical(value[key])]));
  return value;
}

function canonicalize(value) {
  validateJsonCompatible(value);
  return cloneCanonical(value);
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
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${location}.${key} is not allowed`);
  for (const key of required) if (!own(value, key)) fail(`${location}.${key} is required`);
}

function string(value, location) {
  if (typeof value !== 'string' || value.trim().length === 0) fail(`${location} must be a non-whitespace string`);
}

function stringSet(value, location, allowEmpty = false) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) fail(`${location} must be ${allowEmpty ? 'a' : 'a non-empty'} string array`);
  const seen = new Set();
  for (const item of value) {
    string(item, `${location}[]`);
    if (seen.has(item)) fail(`${location} must not contain duplicates`);
    seen.add(item);
  }
}

function digest(value, location) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) fail(`${location} must be a lowercase SHA-256 digest`);
}

function sha1(value, location) {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/.test(value)) fail(`${location} must be a lowercase Git SHA-1`);
}

function object(value, location) {
  if (!isPlainObject(value)) fail(`${location} must be an object`);
}

function sortCodeUnits(values) {
  return [...values].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function sortApplicability(values) {
  return [...values].sort((left, right) => {
    if (left.target !== right.target) return left.target < right.target ? -1 : 1;
    if (left.surface !== right.surface) return left.surface < right.surface ? -1 : 1;
    return 0;
  });
}

function exactSet(left, right) {
  return deepEqual(sortCodeUnits(left), sortCodeUnits(right));
}

function exactApplicability(left, right) {
  return deepEqual(sortApplicability(left), sortApplicability(right));
}

function requiredProvenance(value, location, allowEmpty = false) {
  stringSet(value, location, allowEmpty);
  for (const item of value) if (!PROVENANCE_SET.has(item)) fail(`${location} contains an unknown provenance facet`);
}

function normalizedRepositoryPath(value, location) {
  string(value, location);
  if (value.startsWith('/') || value.includes('\\') || value.includes('//') || value.endsWith('/')) fail(`${location} must be normalized and repository-relative`);
  const parts = value.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) fail(`${location} must be normalized and repository-relative`);
}

function validateSource(source, index) {
  const location = `sources[${index}]`;
  checkKeys(source, ['id', 'repository', 'revision', 'path', 'blob_sha1', 'content_sha256'], [], location);
  string(source.id, `${location}.id`);
  string(source.repository, `${location}.repository`);
  if (!/^[0-9a-f]{40}$/.test(source.revision)) fail(`${location}.revision must be lowercase 40-hex`);
  normalizedRepositoryPath(source.path, `${location}.path`);
  sha1(source.blob_sha1, `${location}.blob_sha1`);
  digest(source.content_sha256, `${location}.content_sha256`);
}

function validateStopRule(value, location) {
  checkKeys(value, ['rule', 'description'], [], location);
  if (value.rule !== 'ALL_REQUIRED_EVIDENCE_VERIFIED_NO_OPEN_ISSUES') fail(`${location}.rule is invalid`);
  string(value.description, `${location}.description`);
}

function validateManifest(manifest) {
  validateJsonCompatible(manifest);
  object(manifest, 'manifest');
  checkKeys(manifest, ['schema', 'id', 'required_provenance', 'sources', 'questions'], [], 'manifest');
  if (manifest.schema !== 'toolkit.evidence-manifest.v1') fail('schema must be toolkit.evidence-manifest.v1');
  string(manifest.id, 'id');
  requiredProvenance(manifest.required_provenance, 'required_provenance');
  if (manifest.required_provenance.length !== PROVENANCE_FIELDS.length || !exactSet(manifest.required_provenance, PROVENANCE_FIELDS)) {
    fail('required_provenance must contain exactly all six provenance facets');
  }
  if (!Array.isArray(manifest.sources) || manifest.sources.length === 0) fail('sources must be non-empty');
  const sourceIds = new Set();
  manifest.sources.forEach((source, index) => {
    validateSource(source, index);
    if (sourceIds.has(source.id)) fail('sources must have unique ids');
    sourceIds.add(source.id);
  });
  if (!Array.isArray(manifest.questions) || manifest.questions.length === 0) fail('questions must be non-empty');
  const questionIds = new Set();
  for (const question of manifest.questions) {
    const location = `question ${question.id || '<unknown>'}`;
    checkKeys(question, ['id', 'question', 'targets', 'surfaces', 'applicability', 'source_ids', 'macros', 'stop_when'], ['operations', 'required_provenance', 'parallelizable'], location);
    string(question.id, `${location}.id`);
    if (questionIds.has(question.id)) fail(`duplicate question id ${question.id}`);
    questionIds.add(question.id);
    string(question.question, `${location}.question`);
    stringSet(question.targets, `${location}.targets`);
    stringSet(question.surfaces, `${location}.surfaces`);
    if (!Array.isArray(question.applicability) || question.applicability.length === 0) fail(`${location}.applicability must be non-empty`);
    const applicabilityIds = new Set();
    for (const pair of question.applicability) {
      checkKeys(pair, ['target', 'surface'], [], `${location}.applicability`);
      string(pair.target, `${location}.applicability.target`);
      string(pair.surface, `${location}.applicability.surface`);
      if (!question.targets.includes(pair.target) || !question.surfaces.includes(pair.surface)) fail(`${location}.applicability names an undeclared target or surface`);
      const pairId = stableStringify(pair);
      if (applicabilityIds.has(pairId)) fail(`${location}.applicability must not contain duplicates`);
      applicabilityIds.add(pairId);
    }
    for (const target of question.targets) if (!question.applicability.some((pair) => pair.target === target)) fail(`${location} has an uncovered target`);
    for (const surface of question.surfaces) if (!question.applicability.some((pair) => pair.surface === surface)) fail(`${location} has an uncovered surface`);
    stringSet(question.source_ids, `${location}.source_ids`);
    for (const sourceId of question.source_ids) if (!sourceIds.has(sourceId)) fail(`${location}.source_ids names an unknown source`);
    stringSet(question.macros, `${location}.macros`);
    for (const macro of question.macros) if (!Object.hasOwn(MACRO_STEPS, macro)) fail(`unsupported evidence macro ${macro}`);
    validateStopRule(question.stop_when, `${location}.stop_when`);
    if (question.required_provenance !== undefined) requiredProvenance(question.required_provenance, `${location}.required_provenance`, true);
    if (question.parallelizable !== undefined && typeof question.parallelizable !== 'boolean') fail(`${location}.parallelizable must be boolean`);
    if (question.operations !== undefined) {
      if (!Array.isArray(question.operations)) fail(`${location}.operations must be an array`);
      const operationIds = new Set();
      question.operations.forEach((operation, index) => {
        checkKeys(operation, ['id', 'instruction'], [], `${location}.operations[${index}]`);
        string(operation.id, `${location}.operations[${index}].id`);
        string(operation.instruction, `${location}.operations[${index}].instruction`);
        if (operationIds.has(operation.id)) fail(`${location}.operations must have unique ids`);
        operationIds.add(operation.id);
      });
    }
  }
}

function obligationId(questionId, macro, facet, target, surface) {
  return JSON.stringify([questionId, macro, facet, target, surface]);
}

function buildQuestionPacket(question, manifest, sourceManifestDigest) {
  const applicability = sortApplicability(question.applicability).map((pair) => ({ ...pair }));
  const steps = [];
  for (const macro of question.macros) {
    for (const entry of MACRO_STEPS[macro]) {
      for (const pair of applicability) {
        const id = obligationId(question.id, macro, entry.facet, pair.target, pair.surface);
        steps.push({
          obligation_id: id,
          macro,
          facet: entry.facet,
          target: pair.target,
          surface: pair.surface,
          instruction: entry.instruction,
        });
      }
    }
  }
  for (const operation of question.operations || []) {
    for (const pair of applicability) {
      const id = obligationId(question.id, 'EXPLICIT', operation.id, pair.target, pair.surface);
      steps.push({
        obligation_id: id,
        macro: 'EXPLICIT',
        facet: operation.id,
        target: pair.target,
        surface: pair.surface,
        instruction: operation.instruction,
      });
    }
  }
  const requiredObligations = sortCodeUnits(steps.map((step) => step.obligation_id));
  const packetCore = {
    schema: 'toolkit.g0b-leaf-evidence-packet.v1',
    manifest_id: manifest.id,
    source_manifest_digest: sourceManifestDigest,
    question_id: question.id,
    question_digest: hashCanonical(question),
    packet_id: JSON.stringify([manifest.id, question.id]),
    question: question.question,
    targets: sortCodeUnits(question.targets),
    surfaces: sortCodeUnits(question.surfaces),
    applicability,
    source_ids: sortCodeUnits(question.source_ids),
    macros: [...question.macros],
    operations: [...(question.operations || [])],
    required_obligations: requiredObligations,
    steps,
    required_provenance: sortCodeUnits([...new Set([
      ...manifest.required_provenance,
      ...(question.required_provenance || []),
    ])]),
    read_only: true,
    mutation_allowed: false,
    architecture_decision_allowed: false,
    delegation_depth_remaining: 0,
    must_return: [
      'QUESTION_ID',
      'EVIDENCE_STATUS',
      'OBSERVATIONS_WITH_EXACT_SOURCE_IDENTITY',
      'MATERIALLY_EQUIVALENT_SURFACES_CHECKED',
      'CONTRADICTIONS_OR_GAPS',
      'STOP_CONDITION_STATUS',
    ],
    stop_when: question.stop_when,
    out_of_scope: [
      'No implementation.',
      'No architecture redesign.',
      'No authority change.',
      'No mutation.',
      'Do not answer a different evidence question merely because it appears related.',
    ],
    parallelizable: question.parallelizable === true,
  };
  return {
    ...packetCore,
    packet_digest: hashCanonical(packetCore),
  };
}

function compileEvidenceManifest(manifest) {
  validateManifest(manifest);
  const sourceManifestDigest = hashCanonical(manifest);
  const packets = manifest.questions
    .map((question) => buildQuestionPacket(question, manifest, sourceManifestDigest))
    .sort((left, right) => (left.question_id < right.question_id ? -1 : left.question_id > right.question_id ? 1 : 0));
  const questionIds = packets.map((packet) => packet.question_id);
  const packetCores = packets.map(({ plan_digest, ...packet }) => packet);
  const planCore = {
    schema: 'toolkit.g0b-evidence-plan.v1',
    manifest_id: manifest.id,
    source_manifest_digest: sourceManifestDigest,
    leaf_packets: packetCores.filter((packet) => packet.parallelizable),
    serial_packets: packetCores.filter((packet) => !packet.parallelizable),
    deterministic_merge: {
      key: 'QUESTION_ID',
      order: questionIds,
      required_fields: [
        'EVIDENCE_STATUS',
        'OBSERVATIONS_WITH_EXACT_SOURCE_IDENTITY',
        'MATERIALLY_EQUIVALENT_SURFACES_CHECKED',
        'CONTRADICTIONS_OR_GAPS',
        'STOP_CONDITION_STATUS',
      ],
      missing_packet_disposition: 'EVIDENCE_INCOMPLETE',
    },
  };
  const planDigest = hashCanonical(planCore);
  const withPlanDigest = (packet) => ({ ...packet, plan_digest: planDigest });
  return {
    ...planCore,
    leaf_packets: planCore.leaf_packets.map(withPlanDigest),
    serial_packets: planCore.serial_packets.map(withPlanDigest),
    plan_digest: planDigest,
  };
}

function isLowerHex(value, length) {
  return typeof value === 'string' && new RegExp(`^[0-9a-f]{${length}}$`).test(value);
}

function validateBase64(value, location) {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) fail(`${location} must be canonical base64`);
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value) fail(`${location} must be canonical base64`);
  return decoded;
}

function validateObservation(value, location) {
  checkKeys(value, ['id', 'macro', 'facet', 'target', 'surface', 'finding', 'provenance_ids'], [], location);
  string(value.id, `${location}.id`);
  if (value.macro !== 'EXPLICIT' && !Object.hasOwn(MACRO_STEPS, value.macro)) fail(`${location}.macro is invalid`);
  string(value.facet, `${location}.facet`);
  string(value.target, `${location}.target`);
  string(value.surface, `${location}.surface`);
  checkKeys(value.finding, ['kind', 'summary'], [], `${location}.finding`);
  if (value.finding.kind !== 'PRESENT' && value.finding.kind !== 'ABSENT') fail(`${location}.finding.kind is invalid`);
  string(value.finding.summary, `${location}.finding.summary`);
  stringSet(value.provenance_ids, `${location}.provenance_ids`);
}

function validateProvenance(value, location) {
  checkKeys(value, ['id', 'source_id', 'scope', 'start_byte', 'end_byte', 'excerpt_base64', 'excerpt_sha256'], [], location);
  string(value.id, `${location}.id`);
  string(value.source_id, `${location}.source_id`);
  if (value.scope !== 'EXCERPT' && value.scope !== 'WHOLE_SOURCE') fail(`${location}.scope is invalid`);
  if (!Number.isInteger(value.start_byte) || value.start_byte < 0 || Object.is(value.start_byte, -0)) fail(`${location}.start_byte must be nonnegative integer`);
  if (!Number.isInteger(value.end_byte) || value.end_byte < 0 || Object.is(value.end_byte, -0)) fail(`${location}.end_byte must be nonnegative integer`);
  validateBase64(value.excerpt_base64, `${location}.excerpt_base64`);
  digest(value.excerpt_sha256, `${location}.excerpt_sha256`);
}

function validateIssue(value, location) {
  checkKeys(value, ['id', 'applicability', 'description', 'state', 'resolution_observation_ids'], [], location);
  string(value.id, `${location}.id`);
  if (!Array.isArray(value.applicability) || value.applicability.length === 0) fail(`${location}.applicability must be non-empty`);
  const seen = new Set();
  value.applicability.forEach((pair, index) => {
    checkKeys(pair, ['target', 'surface'], [], `${location}.applicability[${index}]`);
    string(pair.target, `${location}.applicability[${index}].target`);
    string(pair.surface, `${location}.applicability[${index}].surface`);
    const id = stableStringify(pair);
    if (seen.has(id)) fail(`${location}.applicability contains duplicates`);
    seen.add(id);
  });
  string(value.description, `${location}.description`);
  if (value.state !== 'OPEN' && value.state !== 'RESOLVED') fail(`${location}.state is invalid`);
  stringSet(value.resolution_observation_ids, `${location}.resolution_observation_ids`, true);
  if (value.state === 'OPEN' && value.resolution_observation_ids.length !== 0) fail(`${location} open issues cannot have resolutions`);
  if (value.state === 'RESOLVED' && value.resolution_observation_ids.length === 0) fail(`${location} resolved issues need resolutions`);
}

function validateResponseModel(response) {
  validateJsonCompatible(response);
  object(response, 'response');
  checkKeys(response, [
    'schema',
    'manifest_id',
    'source_manifest_digest',
    'plan_digest',
    'question_id',
    'question_digest',
    'packet_id',
    'packet_digest',
    'targets',
    'surfaces',
    'applicability',
    'source_ids',
    'evidence_status',
    'observations',
    'inspected_targets',
    'inspected_surfaces',
    'inspected_source_ids',
    'provenance',
    'contradictions',
    'gaps',
    'stop_condition_status',
    'response_digest',
  ], [], 'response');
  if (response.schema !== RESPONSE_SCHEMA) fail('response.schema is invalid');
  string(response.manifest_id, 'response.manifest_id');
  digest(response.source_manifest_digest, 'response.source_manifest_digest');
  digest(response.plan_digest, 'response.plan_digest');
  string(response.question_id, 'response.question_id');
  digest(response.question_digest, 'response.question_digest');
  string(response.packet_id, 'response.packet_id');
  digest(response.packet_digest, 'response.packet_digest');
  stringSet(response.targets, 'response.targets');
  stringSet(response.surfaces, 'response.surfaces');
  if (!Array.isArray(response.applicability) || response.applicability.length === 0) fail('response.applicability must be non-empty');
  const applicabilityIds = new Set();
  response.applicability.forEach((pair, index) => {
    checkKeys(pair, ['target', 'surface'], [], `response.applicability[${index}]`);
    string(pair.target, `response.applicability[${index}].target`);
    string(pair.surface, `response.applicability[${index}].surface`);
    const id = stableStringify(pair);
    if (applicabilityIds.has(id)) fail('response.applicability contains duplicates');
    applicabilityIds.add(id);
  });
  stringSet(response.source_ids, 'response.source_ids');
  if (response.evidence_status !== 'COMPLETE' && response.evidence_status !== 'INCOMPLETE') fail('response.evidence_status is invalid');
  if (!Array.isArray(response.observations) || !Array.isArray(response.provenance) || !Array.isArray(response.contradictions) || !Array.isArray(response.gaps)) fail('response evidence collections must be arrays');
  stringSet(response.inspected_targets, 'response.inspected_targets', true);
  stringSet(response.inspected_surfaces, 'response.inspected_surfaces', true);
  stringSet(response.inspected_source_ids, 'response.inspected_source_ids', true);
  const ids = { observations: new Set(), provenance: new Set(), contradictions: new Set(), gaps: new Set() };
  response.observations.forEach((item, index) => {
    validateObservation(item, `response.observations[${index}]`);
    ids.observations.add(item.id);
  });
  response.provenance.forEach((item, index) => {
    validateProvenance(item, `response.provenance[${index}]`);
    ids.provenance.add(item.id);
  });
  response.contradictions.forEach((item, index) => {
    validateIssue(item, `response.contradictions[${index}]`);
    ids.contradictions.add(item.id);
  });
  response.gaps.forEach((item, index) => {
    validateIssue(item, `response.gaps[${index}]`);
    ids.gaps.add(item.id);
  });
  if (response.stop_condition_status !== 'SATISFIED' && response.stop_condition_status !== 'UNSATISFIED' && response.stop_condition_status !== 'UNKNOWN') fail('response.stop_condition_status is invalid');
  digest(response.response_digest, 'response.response_digest');
  if (response.evidence_status === 'COMPLETE' && (
    response.observations.length === 0
    || response.provenance.length === 0
    || response.inspected_targets.length === 0
    || response.inspected_surfaces.length === 0
    || response.inspected_source_ids.length === 0
  )) fail('COMPLETE responses require evidence, provenance and inspected coverage');
}

function validateParentReview(review, location) {
  checkKeys(review, ['question_id', 'question_digest', 'packet_id', 'packet_digest', 'response_digest', 'observation_reviews', 'issue_reviews', 'stop_condition_review'], [], location);
  string(review.question_id, `${location}.question_id`);
  digest(review.question_digest, `${location}.question_digest`);
  string(review.packet_id, `${location}.packet_id`);
  digest(review.packet_digest, `${location}.packet_digest`);
  digest(review.response_digest, `${location}.response_digest`);
  if (!Array.isArray(review.observation_reviews) || !Array.isArray(review.issue_reviews)) fail(`${location} reviews must be arrays`);
  const observationIds = new Set();
  review.observation_reviews.forEach((item, index) => {
    checkKeys(item, ['observation_id', 'verdict', 'reason'], [], `${location}.observation_reviews[${index}]`);
    string(item.observation_id, `${location}.observation_reviews[${index}].observation_id`);
    if (item.verdict !== 'SUPPORTED' && item.verdict !== 'UNSUPPORTED') fail(`${location}.observation_reviews[${index}].verdict is invalid`);
    string(item.reason, `${location}.observation_reviews[${index}].reason`);
    if (observationIds.has(item.observation_id)) fail(`${location}.observation_reviews contains duplicates`);
    observationIds.add(item.observation_id);
  });
  const issueIds = new Set();
  review.issue_reviews.forEach((item, index) => {
    checkKeys(item, ['issue_id', 'verdict', 'reason'], [], `${location}.issue_reviews[${index}]`);
    string(item.issue_id, `${location}.issue_reviews[${index}].issue_id`);
    if (item.verdict !== 'RESOLVED' && item.verdict !== 'UNRESOLVED') fail(`${location}.issue_reviews[${index}].verdict is invalid`);
    string(item.reason, `${location}.issue_reviews[${index}].reason`);
    if (issueIds.has(item.issue_id)) fail(`${location}.issue_reviews contains duplicates`);
    issueIds.add(item.issue_id);
  });
  checkKeys(review.stop_condition_review, ['verdict', 'reason'], [], `${location}.stop_condition_review`);
  if (!['SATISFIED', 'UNSATISFIED', 'UNKNOWN'].includes(review.stop_condition_review.verdict)) fail(`${location}.stop_condition_review.verdict is invalid`);
  string(review.stop_condition_review.reason, `${location}.stop_condition_review.reason`);
}

function validateVerificationContext(context) {
  validateJsonCompatible(context);
  object(context, 'verificationContext');
  checkKeys(context, ['schema', 'manifest_id', 'source_manifest_digest', 'plan_digest', 'source_contents', 'reviews'], [], 'verificationContext');
  if (context.schema !== VERIFICATION_SCHEMA) fail('verificationContext.schema is invalid');
  string(context.manifest_id, 'verificationContext.manifest_id');
  digest(context.source_manifest_digest, 'verificationContext.source_manifest_digest');
  digest(context.plan_digest, 'verificationContext.plan_digest');
  if (!Array.isArray(context.source_contents) || !Array.isArray(context.reviews)) fail('verificationContext collections must be arrays');
  const sourceIds = new Set();
  context.source_contents.forEach((item, index) => {
    checkKeys(item, ['source_id', 'content_base64'], [], `verificationContext.source_contents[${index}]`);
    string(item.source_id, `verificationContext.source_contents[${index}].source_id`);
    validateBase64(item.content_base64, `verificationContext.source_contents[${index}].content_base64`);
    if (sourceIds.has(item.source_id)) fail('verificationContext.source_contents contains duplicates');
    sourceIds.add(item.source_id);
  });
  const reviewIds = new Set();
  context.reviews.forEach((review, index) => {
    validateParentReview(review, `verificationContext.reviews[${index}]`);
    if (reviewIds.has(review.question_id)) fail('verificationContext.reviews contains duplicate question ids');
    reviewIds.add(review.question_id);
  });
}

function reason(code, questionId = null, itemId = null) {
  return { code, question_id: questionId, item_id: itemId };
}

function addReason(list, item) {
  if (!list.some((existing) => deepEqual(existing, item))) list.push(item);
}

function sortReasons(reasons) {
  const unique = [];
  for (const item of reasons) addReason(unique, item);
  return unique.sort((left, right) => {
    const a = JSON.stringify([left.code, left.question_id, left.item_id]);
    const b = JSON.stringify([right.code, right.question_id, right.item_id]);
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

function responseWithoutDigest(response) {
  const { response_digest: ignored, ...withoutDigest } = response;
  return withoutDigest;
}

function gitBlobSha1(bytes) {
  const header = Buffer.from(`blob ${bytes.length}\0`, 'utf8');
  return crypto.createHash('sha1').update(Buffer.concat([header, bytes])).digest('hex');
}

function verifySourceContents(manifest, context) {
  const bindings = new Map(manifest.sources.map((source) => [source.id, source]));
  const contentMap = new Map();
  for (const content of context.source_contents) {
    if (!bindings.has(content.source_id)) return { invalid: true, unavailable: new Set(), contents: contentMap };
    const bytes = Buffer.from(content.content_base64, 'base64');
    const binding = bindings.get(content.source_id);
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== binding.content_sha256 || gitBlobSha1(bytes) !== binding.blob_sha1) {
      return { invalid: true, unavailable: new Set(), contents: contentMap };
    }
    contentMap.set(content.source_id, bytes);
  }
  const unavailable = new Set(bindings.keys());
  for (const sourceId of contentMap.keys()) unavailable.delete(sourceId);
  return { invalid: false, unavailable, contents: contentMap };
}

function verifyProvenance(response, manifest, sourceState) {
  const bindings = new Map(manifest.sources.map((source) => [source.id, source]));
  const provenanceMap = new Map(response.provenance.map((item) => [item.id, item]));
  const verified = new Set();
  const invalid = [];
  const unavailable = [];
  for (const provenance of response.provenance) {
    const binding = bindings.get(provenance.source_id);
    if (!binding) {
      invalid.push(provenance.id);
      continue;
    }
    const bytes = sourceState.contents.get(provenance.source_id);
    if (!bytes) {
      unavailable.push(provenance.id);
      continue;
    }
    const excerpt = Buffer.from(provenance.excerpt_base64, 'base64');
    if (provenance.end_byte < provenance.start_byte || provenance.end_byte > bytes.length) {
      invalid.push(provenance.id);
      continue;
    }
    const expectedExcerpt = bytes.subarray(provenance.start_byte, provenance.end_byte);
    if (!expectedExcerpt.equals(excerpt) || crypto.createHash('sha256').update(excerpt).digest('hex') !== provenance.excerpt_sha256) {
      invalid.push(provenance.id);
      continue;
    }
    if (provenance.scope === 'WHOLE_SOURCE' && (provenance.start_byte !== 0 || provenance.end_byte !== bytes.length)) {
      invalid.push(provenance.id);
      continue;
    }
    verified.add(provenance.id);
  }
  return { provenanceMap, verified, invalid, unavailable };
}

function addCoverageReasons(state, packet, response, verifiedObservationIds, provenanceMap, verifiedProvenanceIds) {
  const observedTargets = new Set();
  const observedSurfaces = new Set();
  const observedSources = new Set();
  for (const observation of response.observations) {
    if (!verifiedObservationIds.has(observation.id)) continue;
    observedTargets.add(observation.target);
    observedSurfaces.add(observation.surface);
    for (const provenanceId of observation.provenance_ids) {
      if (!verifiedProvenanceIds.has(provenanceId)) continue;
      observedSources.add(provenanceMap.get(provenanceId).source_id);
    }
  }
  for (const target of packet.targets) if (!observedTargets.has(target) || !response.inspected_targets.includes(target)) addReason(state.reasons, reason('TARGET_COVERAGE_INCOMPLETE', state.question_id, target));
  for (const surface of packet.surfaces) if (!observedSurfaces.has(surface) || !response.inspected_surfaces.includes(surface)) addReason(state.reasons, reason('SURFACE_COVERAGE_INCOMPLETE', state.question_id, surface));
  for (const sourceId of packet.source_ids) if (!observedSources.has(sourceId) || !response.inspected_source_ids.includes(sourceId)) addReason(state.reasons, reason('SOURCE_COVERAGE_INCOMPLETE', state.question_id, sourceId));
  for (const target of response.inspected_targets) if (!packet.targets.includes(target)) addReason(state.reasons, reason('UNRESOLVED_GAP', state.question_id, target));
  for (const surface of response.inspected_surfaces) if (!packet.surfaces.includes(surface)) addReason(state.reasons, reason('UNRESOLVED_GAP', state.question_id, surface));
  for (const sourceId of response.inspected_source_ids) if (!packet.source_ids.includes(sourceId)) addReason(state.reasons, reason('UNRESOLVED_GAP', state.question_id, sourceId));
}

function processQuestion(state, packet, response, review, manifest, sourceState) {
  state.response_digest = response.response_digest;
  if (hashCanonical(responseWithoutDigest(response)) !== response.response_digest) {
    addReason(state.reasons, reason('RESPONSE_DIGEST_MISMATCH', state.question_id));
    return;
  }
  const identityFields = [
    ['manifest_id', packet.manifest_id],
    ['source_manifest_digest', packet.source_manifest_digest],
    ['plan_digest', packet.plan_digest],
    ['question_id', packet.question_id],
    ['question_digest', packet.question_digest],
    ['packet_id', packet.packet_id],
    ['packet_digest', packet.packet_digest],
  ];
  for (const [field, expected] of identityFields) if (!deepEqual(response[field], expected)) addReason(state.reasons, reason('IDENTITY_MISMATCH', state.question_id, field));
  if (!exactSet(response.targets, packet.targets) || !exactSet(response.surfaces, packet.surfaces) || !exactSet(response.source_ids, packet.source_ids) || !exactApplicability(response.applicability, packet.applicability)) {
    addReason(state.reasons, reason('APPLICABILITY_MISMATCH', state.question_id));
  }
  const seenItemIds = new Set();
  for (const item of [...response.observations, ...response.provenance, ...response.contradictions, ...response.gaps]) {
    if (seenItemIds.has(item.id)) addReason(state.reasons, reason('DUPLICATE_ITEM', state.question_id, item.id));
    seenItemIds.add(item.id);
  }
  const provenanceState = verifyProvenance(response, manifest, sourceState);
  if (provenanceState.invalid.length > 0) addReason(state.reasons, reason('PROVENANCE_DIGEST_MISMATCH', state.question_id, provenanceState.invalid.sort()[0]));
  if (provenanceState.unavailable.length > 0) addReason(state.reasons, reason('EVIDENCE_NOT_RETRIEVABLE', state.question_id, provenanceState.unavailable.sort()[0]));
  const expectedObligations = new Map(packet.steps.map((step) => [step.obligation_id, step]));
  const observations = new Map();
  for (const observation of response.observations) {
    const expected = expectedObligations.get(observation.id);
    if (!expected) {
      addReason(state.reasons, reason('UNEXPECTED_OBSERVATION', state.question_id, observation.id));
      continue;
    }
    if (observation.macro !== expected.macro || observation.facet !== expected.facet || observation.target !== expected.target || observation.surface !== expected.surface) {
      addReason(state.reasons, reason('UNEXPECTED_OBSERVATION', state.question_id, observation.id));
      continue;
    }
    if (observation.provenance_ids.some((id) => !provenanceState.provenanceMap.has(id))) {
      addReason(state.reasons, reason('INVALID_PROVENANCE', state.question_id, observation.id));
      continue;
    }
    observations.set(observation.id, observation);
  }
  for (const obligation of packet.required_obligations) {
    if (!observations.has(obligation)) state.missing_obligation_ids.push(obligation);
  }
  const verifiedObservationIds = new Set();
  for (const [id, observation] of observations) {
    if (observation.provenance_ids.every((provenanceId) => provenanceState.verified.has(provenanceId))) verifiedObservationIds.add(id);
  }
  addCoverageReasons(state, packet, response, verifiedObservationIds, provenanceState.provenanceMap, provenanceState.verified);
  const issueReviews = new Map((review?.issue_reviews || []).map((item) => [item.issue_id, item]));
  const allIssues = [
    ...response.contradictions.map((issue) => ['UNRESOLVED_CONTRADICTION', issue]),
    ...response.gaps.map((issue) => ['UNRESOLVED_GAP', issue]),
  ];
  for (const [openCode, issue] of allIssues) {
    if (issue.state === 'OPEN') {
      addReason(state.reasons, reason(openCode, state.question_id, issue.id));
      continue;
    }
    const resolutionIds = new Set(issue.resolution_observation_ids);
    const resolutions = [...resolutionIds].map((id) => observations.get(id)).filter(Boolean);
    const coversApplicability = issue.applicability.every((pair) => resolutions.some((observation) => observation.target === pair.target && observation.surface === pair.surface));
    const supported = resolutions.every((observation) => verifiedObservationIds.has(observation.id));
    const reviewItem = issueReviews.get(issue.id);
    if (!coversApplicability || !supported || !reviewItem || reviewItem.verdict !== 'RESOLVED') addReason(state.reasons, reason(openCode, state.question_id, issue.id));
  }
  if (!review) {
    addReason(state.reasons, reason('EVIDENCE_REVIEW_REQUIRED', state.question_id));
  } else {
    const observationReviews = new Map((review.observation_reviews || []).map((item) => [item.observation_id, item]));
    for (const reviewItem of review.observation_reviews || []) {
      if (!observations.has(reviewItem.observation_id)) addReason(state.reasons, reason('VERIFICATION_CONTEXT_INVALID', state.question_id, reviewItem.observation_id));
    }
    for (const reviewItem of review.issue_reviews || []) {
      if (![...response.contradictions, ...response.gaps].some((issue) => issue.id === reviewItem.issue_id)) addReason(state.reasons, reason('VERIFICATION_CONTEXT_INVALID', state.question_id, reviewItem.issue_id));
    }
    for (const obligation of packet.required_obligations) {
      const observation = observations.get(obligation);
      const observationReview = observationReviews.get(obligation);
      if (!observation || !observationReview) {
        addReason(state.reasons, reason('EVIDENCE_REVIEW_REQUIRED', state.question_id, obligation));
      } else if (observationReview.verdict !== 'SUPPORTED') {
        addReason(state.reasons, reason('OBSERVATION_UNSUPPORTED', state.question_id, obligation));
      }
    }
    if (review.stop_condition_review.verdict !== 'SATISFIED') addReason(state.reasons, reason('STOP_CONDITION_UNSATISFIED', state.question_id));
  }
  if (response.evidence_status === 'INCOMPLETE') addReason(state.reasons, reason('LEAF_REPORTED_INCOMPLETE', state.question_id));
  if (response.stop_condition_status !== 'SATISFIED') addReason(state.reasons, reason('STOP_CONDITION_UNSATISFIED', state.question_id));
}

function mergeEvidenceResponses(manifest, responses, verificationContext) {
  const plan = compileEvidenceManifest(manifest);
  const packets = [...plan.leaf_packets, ...plan.serial_packets].sort((left, right) => (left.question_id < right.question_id ? -1 : left.question_id > right.question_id ? 1 : 0));
  const states = new Map(packets.map((packet) => [packet.question_id, {
    question_id: packet.question_id,
    response_digest: null,
    status: 'COMPLETE',
    missing_obligation_ids: [],
    reasons: [],
  }]));
  const globalReasons = [];
  const addGlobal = (item) => addReason(globalReasons, item);

  if (!Array.isArray(responses)) {
    addGlobal(reason('RESPONSE_SCHEMA_INVALID'));
  }
  let contextValid = true;
  try {
    validateVerificationContext(verificationContext);
  } catch (error) {
    contextValid = false;
    addGlobal(reason('VERIFICATION_CONTEXT_INVALID'));
  }
  const responseMap = new Map();
  if (Array.isArray(responses)) {
    for (const response of responses) {
      let valid = true;
      try {
        validateResponseModel(response);
      } catch (error) {
        valid = false;
        const questionId = response && typeof response === 'object' && typeof response.question_id === 'string' ? response.question_id : null;
        if (questionId && states.has(questionId)) addReason(states.get(questionId).reasons, reason('RESPONSE_SCHEMA_INVALID', questionId));
        else addGlobal(reason('RESPONSE_SCHEMA_INVALID', questionId));
      }
      if (!valid) continue;
      if (!states.has(response.question_id)) {
        addGlobal(reason('UNEXPECTED_QUESTION', response.question_id));
        continue;
      }
      if (responseMap.has(response.question_id)) {
        addReason(states.get(response.question_id).reasons, reason('DUPLICATE_RESPONSE', response.question_id));
        continue;
      }
      responseMap.set(response.question_id, response);
    }
  }

  let sourceState = { invalid: false, unavailable: new Set(), contents: new Map() };
  let reviews = new Map();
  if (contextValid) {
    if (verificationContext.manifest_id !== plan.manifest_id || verificationContext.source_manifest_digest !== plan.source_manifest_digest || verificationContext.plan_digest !== plan.plan_digest) {
      addGlobal(reason('VERIFICATION_IDENTITY_MISMATCH'));
    }
    sourceState = verifySourceContents(manifest, verificationContext);
    if (sourceState.invalid) addGlobal(reason('VERIFICATION_CONTEXT_INVALID'));
    reviews = new Map(verificationContext.reviews.map((review) => [review.question_id, review]));
    for (const review of verificationContext.reviews) {
      if (!states.has(review.question_id)) addGlobal(reason('VERIFICATION_CONTEXT_INVALID', review.question_id));
    }
  }

  for (const packet of packets) {
    const state = states.get(packet.question_id);
    const response = responseMap.get(packet.question_id);
    if (!response) {
      addReason(state.reasons, reason('MISSING_RESPONSE', packet.question_id));
      continue;
    }
    if (!contextValid) {
      addReason(state.reasons, reason('VERIFICATION_CONTEXT_INVALID', packet.question_id));
      continue;
    }
    const review = reviews.get(packet.question_id);
    if (review && (
      review.question_digest !== packet.question_digest
      || review.packet_id !== packet.packet_id
      || review.packet_digest !== packet.packet_digest
      || review.response_digest !== response.response_digest
    )) {
      addReason(state.reasons, reason('VERIFICATION_IDENTITY_MISMATCH', packet.question_id));
    }
    processQuestion(state, packet, response, review, manifest, sourceState);
  }

  for (const state of states.values()) {
    state.reasons = sortReasons(state.reasons);
    if (state.reasons.some((item) => [
      'RESPONSE_SCHEMA_INVALID',
      'RESPONSE_DIGEST_MISMATCH',
      'IDENTITY_MISMATCH',
      'APPLICABILITY_MISMATCH',
      'UNEXPECTED_OBSERVATION',
      'DUPLICATE_RESPONSE',
      'DUPLICATE_ITEM',
      'INVALID_PROVENANCE',
      'PROVENANCE_DIGEST_MISMATCH',
      'VERIFICATION_CONTEXT_INVALID',
      'VERIFICATION_IDENTITY_MISMATCH',
    ].includes(item.code))) {
      state.status = 'REJECTED';
    } else if (state.reasons.length > 0) {
      state.status = 'EVIDENCE_INCOMPLETE';
    }
    state.missing_obligation_ids = sortCodeUnits(state.missing_obligation_ids);
  }
  const questionResults = [...states.values()].sort((left, right) => (left.question_id < right.question_id ? -1 : left.question_id > right.question_id ? 1 : 0));
  const allReasons = sortReasons([...globalReasons, ...questionResults.flatMap((item) => item.reasons)]);
  let status = 'COMPLETE';
  if (allReasons.some((item) => [
    'RESPONSE_SCHEMA_INVALID',
    'RESPONSE_DIGEST_MISMATCH',
    'IDENTITY_MISMATCH',
    'APPLICABILITY_MISMATCH',
    'UNEXPECTED_QUESTION',
    'DUPLICATE_RESPONSE',
    'DUPLICATE_ITEM',
    'UNEXPECTED_OBSERVATION',
    'INVALID_PROVENANCE',
    'PROVENANCE_DIGEST_MISMATCH',
    'VERIFICATION_CONTEXT_INVALID',
    'VERIFICATION_IDENTITY_MISMATCH',
  ].includes(item.code))) status = 'REJECTED';
  else if (allReasons.length > 0) status = 'EVIDENCE_INCOMPLETE';
  const resultCore = {
    schema: 'toolkit.g0b-evidence-merge.v1',
    manifest_id: plan.manifest_id,
    source_manifest_digest: plan.source_manifest_digest,
    plan_digest: plan.plan_digest,
    status,
    questions: questionResults,
    reasons: allReasons,
  };
  return {
    ...resultCore,
    merge_digest: hashCanonical(resultCore),
  };
}

module.exports = {
  PROVENANCE_FIELDS,
  EVIDENCE_MACRO_FACETS,
  MACRO_STEPS,
  canonicalize,
  hashCanonical,
  compileEvidenceManifest,
  mergeEvidenceResponses,
  validateJsonCompatible,
  validateManifest,
  validateResponseModel,
  validateVerificationContext,
};

if (require.main === module) {
  const fs = require('node:fs');
  const filename = process.argv[2];
  if (!filename) {
    process.stderr.write('usage: node toolkit-evidence-plan-compiler.cjs <evidence-manifest.json>\n');
    process.exitCode = 2;
  } else {
    process.stdout.write(`${JSON.stringify(compileEvidenceManifest(JSON.parse(fs.readFileSync(filename, 'utf8'))), null, 2)}\n`);
  }
}
