'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const Ajv2020 = require('ajv/dist/2020');
const {
  PROVENANCE_FIELDS,
  EVIDENCE_MACRO_FACETS,
  MACRO_STEPS,
  compileEvidenceManifest,
  hashCanonical,
  mergeEvidenceResponses,
  validateJsonCompatible,
} = require('../scripts/toolkit-evidence-plan-compiler.cjs');

const ALL_EVIDENCE_MACROS = Object.keys(EVIDENCE_MACRO_FACETS);

function source(text = 'export const target = true;\n') {
  const bytes = Buffer.from(text, 'utf8');
  const header = Buffer.from(`blob ${bytes.length}\0`, 'utf8');
  return {
    binding: {
      id: 'SRC_MAIN',
      repository: 'weijunswj/ai-agent-toolkit',
      revision: 'a'.repeat(40),
      path: 'repo/example.cjs',
      blob_sha1: crypto.createHash('sha1').update(Buffer.concat([header, bytes])).digest('hex'),
      content_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    },
    bytes,
  };
}

function question(id, options = {}) {
  const targets = options.targets || ['target-a'];
  const surfaces = options.surfaces || ['surface-a'];
  const applicability = options.applicability || targets.flatMap((target) => surfaces.map((surface) => ({ target, surface })));
  return {
    id,
    question: options.question || `Collect bounded evidence for ${id}.`,
    targets,
    surfaces,
    applicability,
    source_ids: ['SRC_MAIN'],
    macros: options.macros || ALL_EVIDENCE_MACROS,
    stop_when: {
      rule: 'ALL_REQUIRED_EVIDENCE_VERIFIED_NO_OPEN_ISSUES',
      description: 'Every required observation is independently verified and no issue remains open.',
    },
    ...(options.operations ? { operations: options.operations } : {}),
    ...(options.required_provenance ? { required_provenance: options.required_provenance } : {}),
    ...(options.parallelizable !== undefined ? { parallelizable: options.parallelizable } : {}),
  };
}

function manifest(options = {}) {
  const fixture = source();
  return {
    schema: 'toolkit.evidence-manifest.v1',
    id: options.id || 'MANIFEST_1',
    required_provenance: [...PROVENANCE_FIELDS],
    sources: [fixture.binding],
    questions: options.questions || [question('Q-A', { parallelizable: options.parallelizable === true })],
  };
}

function without(value, key) {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

function finalizeResponse(response) {
  response.response_digest = hashCanonical(without(response, 'response_digest'));
  return response;
}

function responseFor(plan, questionId) {
  const packet = [...plan.leaf_packets, ...plan.serial_packets].find((item) => item.question_id === questionId);
  const bytes = source().bytes;
  const provenance = {
    id: `P-${questionId}`,
    source_id: 'SRC_MAIN',
    scope: 'WHOLE_SOURCE',
    start_byte: 0,
    end_byte: bytes.length,
    excerpt_base64: bytes.toString('base64'),
    excerpt_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
  const observations = packet.steps.map((step) => ({
    id: step.obligation_id,
    macro: step.macro,
    facet: step.facet,
    target: step.target,
    surface: step.surface,
    finding: { kind: 'PRESENT', summary: `Verified ${step.obligation_id}.` },
    provenance_ids: [provenance.id],
  }));
  return finalizeResponse({
    schema: 'toolkit.g0b-evidence-response.v1',
    manifest_id: packet.manifest_id,
    source_manifest_digest: packet.source_manifest_digest,
    plan_digest: plan.plan_digest,
    question_id: packet.question_id,
    question_digest: packet.question_digest,
    packet_id: packet.packet_id,
    packet_digest: packet.packet_digest,
    targets: [...packet.targets],
    surfaces: [...packet.surfaces],
    applicability: packet.applicability.map((pair) => ({ ...pair })),
    source_ids: [...packet.source_ids],
    evidence_status: 'COMPLETE',
    observations,
    inspected_targets: packet.targets,
    inspected_surfaces: packet.surfaces,
    inspected_source_ids: packet.source_ids,
    provenance: [provenance],
    contradictions: [],
    gaps: [],
    stop_condition_status: 'SATISFIED',
    response_digest: '',
  });
}

function reviewFor(response) {
  return {
    question_id: response.question_id,
    question_digest: response.question_digest,
    packet_id: response.packet_id,
    packet_digest: response.packet_digest,
    response_digest: response.response_digest,
    observation_reviews: response.observations.map((observation) => ({
      observation_id: observation.id,
      verdict: 'SUPPORTED',
      reason: 'The parent independently verified the observation.',
    })),
    issue_reviews: [],
    stop_condition_review: {
      verdict: 'SATISFIED',
      reason: 'The parent independently verified the stop rule.',
    },
  };
}

function bundle(options = {}) {
  const fixture = source();
  const input = manifest({
    questions: options.questions || [question('Q-A', options.questionOptions || {})],
  });
  const plan = compileEvidenceManifest(input);
  const responses = plan.leaf_packets.concat(plan.serial_packets).map((packet) => responseFor(plan, packet.question_id));
  const context = {
    schema: 'toolkit.g0b-evidence-verification-context.v1',
    manifest_id: plan.manifest_id,
    source_manifest_digest: plan.source_manifest_digest,
    plan_digest: plan.plan_digest,
    source_contents: [{ source_id: fixture.binding.id, content_base64: fixture.bytes.toString('base64') }],
    reviews: responses.map(reviewFor),
  };
  return { input, plan, responses, context, fixture };
}

function reasonCodes(result) {
  return new Set(result.reasons.map((item) => item.code).concat(result.questions.flatMap((questionResult) => questionResult.reasons.map((item) => item.code))));
}

function mergeWith(modify, options = {}) {
  const value = bundle(options);
  const originalDigests = new Map(value.responses.map((response) => [response.question_id, response.response_digest]));
  modify(value);
  for (const response of value.responses) {
    const review = value.context.reviews.find((item) => item.question_id === response.question_id);
    if (review && review.response_digest === originalDigests.get(response.question_id) && review.response_digest !== response.response_digest) {
      review.response_digest = response.response_digest;
    }
  }
  return mergeEvidenceResponses(value.input, value.responses, value.context);
}

const evidenceOracleRows = [];
function evidenceRow(id, expected, execute) {
  evidenceOracleRows.push({ id, expected, execute });
}

evidenceRow('F4-01', 'COMPLETE', () => {
  const value = bundle();
  return mergeEvidenceResponses(value.input, value.responses, value.context);
});
evidenceRow('F4-02', 'COMPLETE', () => {
  const value = bundle({ questions: [question('Q-B'), question('Q-A')] });
  const normal = mergeEvidenceResponses(value.input, value.responses, value.context);
  const reversed = mergeEvidenceResponses(value.input, [...value.responses].reverse(), value.context);
  assert.equal(normal.merge_digest, reversed.merge_digest);
  return reversed;
});
evidenceRow('F4-03', 'REJECTED', () => mergeWith(({ responses }) => {
  responses[0].observations = [];
  finalizeResponse(responses[0]);
}));
evidenceRow('F4-04', 'REJECTED', () => mergeWith(({ responses }) => {
  responses[0].inspected_surfaces = [];
  finalizeResponse(responses[0]);
}));
evidenceRow('F4-05', 'REJECTED', () => mergeWith(({ responses }) => {
  responses[0].provenance = [];
  finalizeResponse(responses[0]);
}));
evidenceRow('F4-06', 'REJECTED', () => mergeWith(({ responses }) => {
  responses[0].source_manifest_digest = '0'.repeat(64);
  finalizeResponse(responses[0]);
}));
evidenceRow('F4-07', 'REJECTED', () => mergeWith(({ responses }) => {
  responses[0].manifest_id = 'STALE_MANIFEST';
  finalizeResponse(responses[0]);
}));
evidenceRow('F4-08', 'REJECTED', () => mergeWith(({ responses }) => {
  responses[0].plan_digest = '0'.repeat(64);
  finalizeResponse(responses[0]);
}));
evidenceRow('F4-09', 'REJECTED', () => mergeWith(({ responses }) => {
  responses[0].packet_id = 'STALE_PACKET';
  finalizeResponse(responses[0]);
}));
evidenceRow('F4-10', 'REJECTED', () => mergeWith(({ responses }) => {
  responses[0].question_digest = '0'.repeat(64);
  finalizeResponse(responses[0]);
}));
evidenceRow('F4-11', 'REJECTED', () => {
  const value = bundle();
  value.responses.push(structuredClone(value.responses[0]));
  return mergeEvidenceResponses(value.input, value.responses, value.context);
});
evidenceRow('F4-12', 'EVIDENCE_INCOMPLETE', () => {
  const value = bundle();
  value.responses = [];
  return mergeEvidenceResponses(value.input, value.responses, value.context);
});
evidenceRow('F4-13', 'EVIDENCE_INCOMPLETE', () => mergeWith(({ context }) => {
  context.source_contents = [];
}, {}));
evidenceRow('F4-14', 'REJECTED', () => mergeWith(({ responses }) => {
  responses[0].provenance[0].excerpt_sha256 = '0'.repeat(64);
  finalizeResponse(responses[0]);
}));
evidenceRow('F4-15', 'REJECTED', () => mergeWith(({ responses }) => {
  responses[0].provenance[0].excerpt_base64 = Buffer.from('different', 'utf8').toString('base64');
  finalizeResponse(responses[0]);
}));
evidenceRow('F4-16', 'EVIDENCE_INCOMPLETE', () => mergeWith(({ context }) => {
  context.reviews = [];
}));
evidenceRow('F4-17', 'EVIDENCE_INCOMPLETE', () => mergeWith(({ context }) => {
  context.reviews[0].observation_reviews[0].verdict = 'UNSUPPORTED';
}));
evidenceRow('F4-18', 'REJECTED', () => mergeWith(({ context }) => {
  context.reviews[0].response_digest = '0'.repeat(64);
}));
evidenceRow('F4-19', 'REJECTED', () => mergeWith(({ responses }) => {
  responses[0].verified = true;
  finalizeResponse(responses[0]);
}));
evidenceRow('F4-20', 'EVIDENCE_INCOMPLETE', () => mergeWith(({ responses }) => {
  responses[0].contradictions.push({ id: 'ISSUE_OPEN', applicability: responses[0].applicability, description: 'Contradiction remains.', state: 'OPEN', resolution_observation_ids: [] });
  finalizeResponse(responses[0]);
}));
evidenceRow('F4-21', 'EVIDENCE_INCOMPLETE', () => mergeWith(({ responses }) => {
  responses[0].gaps.push({ id: 'GAP_OPEN', applicability: responses[0].applicability, description: 'Gap remains.', state: 'OPEN', resolution_observation_ids: [] });
  finalizeResponse(responses[0]);
}));
evidenceRow('F4-22', 'EVIDENCE_INCOMPLETE', () => mergeWith(({ responses }) => {
  const observationId = responses[0].observations[0].id;
  responses[0].contradictions.push({ id: 'ISSUE_RESOLUTION_UNSUPPORTED', applicability: responses[0].applicability, description: 'Resolution lacks parent support.', state: 'RESOLVED', resolution_observation_ids: [observationId] });
  finalizeResponse(responses[0]);
}));
evidenceRow('F4-23', 'COMPLETE', () => mergeWith(({ responses, context }) => {
  const observationId = responses[0].observations[0].id;
  responses[0].contradictions.push({ id: 'ISSUE_RESOLVED', applicability: responses[0].applicability, description: 'Resolution is supported.', state: 'RESOLVED', resolution_observation_ids: [observationId] });
  finalizeResponse(responses[0]);
  context.reviews[0].response_digest = responses[0].response_digest;
  context.reviews[0].issue_reviews.push({ issue_id: 'ISSUE_RESOLVED', verdict: 'RESOLVED', reason: 'The parent verified the resolving observation.' });
}));
evidenceRow('F4-24', 'EVIDENCE_INCOMPLETE', () => mergeWith(({ responses, context }) => {
  const removed = responses[0].observations.pop();
  context.reviews[0].observation_reviews = context.reviews[0].observation_reviews.filter((item) => item.observation_id !== removed.id);
  finalizeResponse(responses[0]);
  context.reviews[0].response_digest = responses[0].response_digest;
}));
evidenceRow('F4-25', 'EVIDENCE_INCOMPLETE', () => mergeWith(({ context }) => {
  context.reviews[0].stop_condition_review.verdict = 'UNSATISFIED';
}));
evidenceRow('F4-26', 'EVIDENCE_INCOMPLETE', () => mergeWith(({ responses, context }) => {
  const removed = responses[0].observations.filter((item) => item.surface === 'surface-b');
  responses[0].observations = responses[0].observations.filter((item) => item.surface !== 'surface-b');
  context.reviews[0].observation_reviews = context.reviews[0].observation_reviews.filter((item) => !removed.some((observation) => observation.id === item.observation_id));
  finalizeResponse(responses[0]);
  context.reviews[0].response_digest = responses[0].response_digest;
}, { questionOptions: { surfaces: ['surface-a', 'surface-b'] } }));
evidenceRow('F4-27', 'EVIDENCE_INCOMPLETE', () => mergeWith(({ responses, context }) => {
  const removed = responses[0].observations.filter((item) => item.surface === 'surface-b');
  responses[0].observations = responses[0].observations.filter((item) => item.surface !== 'surface-b');
  context.reviews[0].observation_reviews = context.reviews[0].observation_reviews.filter((item) => !removed.some((observation) => observation.id === item.observation_id));
  finalizeResponse(responses[0]);
  context.reviews[0].response_digest = responses[0].response_digest;
}, { questionOptions: { surfaces: ['surface-a', 'surface-b'] } }));
evidenceRow('F4-28:unknown', 'REJECTED', () => mergeWith(({ responses }) => {
  responses[0].observations.push({ id: 'UNKNOWN_OBSERVATION', macro: 'EXPLICIT', facet: 'unknown', target: 'target-a', surface: 'surface-a', finding: { kind: 'PRESENT', summary: 'Unknown.' }, provenance_ids: [responses[0].provenance[0].id] });
  finalizeResponse(responses[0]);
}));
evidenceRow('F4-28:duplicate', 'REJECTED', () => mergeWith(({ responses }) => {
  responses[0].observations.push(structuredClone(responses[0].observations[0]));
  finalizeResponse(responses[0]);
}));
evidenceRow('F4-29', 'COMPLETE', () => mergeWith(({ responses }) => {
  for (const observation of responses[0].observations) observation.finding.kind = 'ABSENT';
  finalizeResponse(responses[0]);
}));
evidenceRow('F4-30', 'EVIDENCE_INCOMPLETE', () => mergeWith(({ responses }) => {
  responses[0].inspected_surfaces.push('surface-extra');
  finalizeResponse(responses[0]);
}));
evidenceRow('F4-31', 'EVIDENCE_INCOMPLETE', () => mergeWith(({ responses }) => {
  responses[0].evidence_status = 'INCOMPLETE';
  finalizeResponse(responses[0]);
}));
evidenceRow('F4-32', 'COMPLETE', () => mergeWith(() => {}, { parallelizable: false }));

test('Run-058 F4 oracle matrix uses production plan compiler and pure merge', () => {
  for (const row of evidenceOracleRows) {
    const result = row.execute();
    assert.equal(result.status, row.expected, `${row.id} ${JSON.stringify(result)}`);
    if (row.expected === 'EVIDENCE_INCOMPLETE' || row.expected === 'REJECTED') assert.ok(result.reasons.length > 0 || result.questions.some((item) => item.reasons.length > 0), row.id);
  }
  assert.ok(reasonCodes(evidenceOracleRows.find((row) => row.id === 'F4-13').execute()).has('EVIDENCE_NOT_RETRIEVABLE'));
  assert.ok(reasonCodes(evidenceOracleRows.find((row) => row.id === 'F4-31').execute()).has('LEAF_REPORTED_INCOMPLETE'));
});

test('Run-058 evidence oracle expansion count is explicit and stable', () => {
  assert.equal(evidenceOracleRows.length, 33);
});

test('evidence schema is Draft 2020-12 and macro facets exactly match compiler output', () => {
  const schema = require('../contracts/controller-kernel/evidence-manifest-v1.schema.json');
  const ajv = new Ajv2020({ strict: false, coerceTypes: false, useDefaults: false, removeAdditional: false });
  const validateManifest = ajv.compile(schema);
  const value = bundle();
  assert.equal(validateManifest(value.input), true);
  const before = structuredClone(value.input);
  assert.deepEqual(value.input, before);
  const extra = structuredClone(value.input);
  extra.questions[0].unsupported = true;
  assert.equal(validateManifest(extra), false);
  assert.equal(Object.hasOwn(extra.questions[0], 'unsupported'), true);
  assert.throws(() => compileEvidenceManifest(extra), /not allowed/);
  const responseSchema = ajv.compile({ $ref: `${schema.$id}#/$defs/EvidenceResponse` });
  const contextSchema = ajv.compile({ $ref: `${schema.$id}#/$defs/VerificationContext` });
  assert.equal(responseSchema(value.responses[0]), true);
  assert.equal(contextSchema(value.context), true);
  assert.deepEqual(Object.keys(MACRO_STEPS).sort(), ALL_EVIDENCE_MACROS.sort());
  for (const macro of ALL_EVIDENCE_MACROS) assert.deepEqual(MACRO_STEPS[macro].map((item) => item.facet), EVIDENCE_MACRO_FACETS[macro]);
});

test('explicit evidence operations materialize one exact facet per applicability pair', () => {
  const input = manifest({
    questions: [question('Q-EXPLICIT', {
      operations: [{ id: 'READ_CUSTOM_BOUNDARY', instruction: 'Inspect the named boundary without redesign.' }],
      macros: ['PUBLIC_SURFACE_INVENTORY'],
    })],
  });
  const plan = compileEvidenceManifest(input);
  const packet = plan.serial_packets[0];
  const explicit = packet.steps.filter((step) => step.macro === 'EXPLICIT');
  assert.equal(explicit.length, 1);
  assert.equal(explicit[0].facet, 'READ_CUSTOM_BOUNDARY');
  assert.equal(explicit[0].obligation_id, JSON.stringify(['Q-EXPLICIT', 'EXPLICIT', 'READ_CUSTOM_BOUNDARY', 'target-a', 'surface-a']));
});

test('evidence packet and merge digests are deterministic and non-recursive', () => {
  const first = bundle();
  const second = bundle();
  assert.equal(first.plan.plan_digest, second.plan.plan_digest);
  assert.equal(first.plan.serial_packets[0].packet_digest, second.plan.serial_packets[0].packet_digest);
  const resultA = mergeEvidenceResponses(first.input, first.responses, first.context);
  const resultB = mergeEvidenceResponses(second.input, second.responses, second.context);
  assert.equal(resultA.merge_digest, resultB.merge_digest);
  const before = {
    input: structuredClone(first.input),
    responses: structuredClone(first.responses),
    context: structuredClone(first.context),
  };
  mergeEvidenceResponses(first.input, first.responses, first.context);
  assert.deepEqual(first.input, before.input);
  assert.deepEqual(first.responses, before.responses);
  assert.deepEqual(first.context, before.context);
  const packet = first.plan.serial_packets[0];
  const withoutPlanDigest = { ...packet };
  delete withoutPlanDigest.plan_digest;
  assert.equal(packet.packet_digest, hashCanonical(Object.fromEntries(Object.entries(withoutPlanDigest).filter(([key]) => key !== 'packet_digest'))));
});

test('evidence compiler rejects top-level and nested Proxies before caller traps', () => {
  const counters = { get: 0, ownKeys: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0 };
  const handler = {
    get(target, key, receiver) { counters.get += 1; return Reflect.get(target, key, receiver); },
    ownKeys(target) { counters.ownKeys += 1; return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor(target, key) { counters.getOwnPropertyDescriptor += 1; return Reflect.getOwnPropertyDescriptor(target, key); },
    getPrototypeOf(target) { counters.getPrototypeOf += 1; return Reflect.getPrototypeOf(target); },
  };
  const makeCrossRealm = vm.runInNewContext('(target, traps) => new Proxy(target, traps)');
  assert.throws(() => validateJsonCompatible(makeCrossRealm(manifest(), handler)),
    (error) => error && error.code === 'EVIDENCE_MANIFEST_INVALID');
  assert.deepEqual(counters, { get: 0, ownKeys: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0 });

  const nestedCounters = { get: 0, ownKeys: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0 };
  const nested = manifest();
  nested.questions[0].applicability = new Proxy(nested.questions[0].applicability, {
    get(target, key, receiver) { nestedCounters.get += 1; return Reflect.get(target, key, receiver); },
    ownKeys(target) { nestedCounters.ownKeys += 1; return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor(target, key) { nestedCounters.getOwnPropertyDescriptor += 1; return Reflect.getOwnPropertyDescriptor(target, key); },
    getPrototypeOf(target) { nestedCounters.getPrototypeOf += 1; return Reflect.getPrototypeOf(target); },
  });
  assert.throws(() => compileEvidenceManifest(nested), (error) => error && error.code === 'EVIDENCE_MANIFEST_INVALID');
  assert.deepEqual(nestedCounters, { get: 0, ownKeys: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0 });
});

test('unavailable source verification can never become COMPLETE', () => {
  const value = bundle();
  value.context.source_contents = [];
  const result = mergeEvidenceResponses(value.input, value.responses, value.context);
  assert.notEqual(result.status, 'COMPLETE');
  assert.ok(reasonCodes(result).has('EVIDENCE_NOT_RETRIEVABLE'));
});

test('source-byte tampering is rejected by the independent SHA-256 content binding', () => {
  const value = bundle();
  const originalSha256 = value.input.sources[0].content_sha256;
  const tamperedBytes = Buffer.from(value.context.source_contents[0].content_base64, 'base64');
  tamperedBytes[0] ^= 1;
  value.context.source_contents[0].content_base64 = tamperedBytes.toString('base64');

  const result = mergeEvidenceResponses(value.input, value.responses, value.context);
  assert.equal(result.status, 'REJECTED');
  assert.equal(value.input.sources[0].content_sha256, originalSha256);
  assert.ok(reasonCodes(result).has('VERIFICATION_CONTEXT_INVALID'));
});

test('evidence inputs remain unchanged and current binding sources stay explicit', () => {
  const value = bundle();
  const beforeManifest = structuredClone(value.input);
  const beforeResponses = structuredClone(value.responses);
  const beforeContext = structuredClone(value.context);
  compileEvidenceManifest(value.input);
  mergeEvidenceResponses(value.input, value.responses, value.context);
  assert.deepEqual(value.input, beforeManifest);
  assert.deepEqual(value.responses, beforeResponses);
  assert.deepEqual(value.context, beforeContext);
  const root = path.resolve(__dirname, '..', '..');
  const controller = fs.readFileSync(path.join(root, 'repo', 'CONTROLLER.md'), 'utf8');
  const architecture = fs.readFileSync(path.join(root, 'repo', 'ARCHITECTURE.md'), 'utf8');
  assert.match(controller, /Before consequential mutation or integration, revalidate live base\/main and the candidate\/authority binding/i);
  assert.match(architecture, /root model\/route selection is an out-of-band User\/Web\/controller\/harness act performed before root launch\/adoption/i);
});
