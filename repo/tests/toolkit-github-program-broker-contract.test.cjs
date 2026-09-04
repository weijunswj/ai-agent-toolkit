'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const contractRoot = path.join(__dirname, '..', 'contracts', 'github-program-receipt');
const scriptRoot = path.join(__dirname, '..', 'scripts');
const schemaPath = path.join(contractRoot, 'broker-ipc-v1.schema.json');
const schema = readJson(schemaPath);
const receiptSchema = readJson(path.join(contractRoot, 'run-receipt-v1.schema.json'));
const policy = readJson(path.join(contractRoot, 'github-program-receipt-policy.json'));
const fixture = readJson(path.join(scriptRoot, 'github-program-broker', 'tests', 'fixtures', 'source-slice-1-vectors.json'));
const runtime = require(path.join(scriptRoot, 'toolkit-github-program-receipt.cjs'));

const documents = new Map([
  [path.basename(schemaPath), schema],
  ['run-receipt-v1.schema.json', receiptSchema]
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function pointerValue(document, pointer) {
  let value = document;
  for (const part of pointer.slice(2).split('/')) {
    const key = part.replaceAll('~1', '/').replaceAll('~0', '~');
    if (value === null || typeof value !== 'object' || !(key in value)) return undefined;
    value = value[key];
  }
  return value;
}

function resolveSchema(root, reference) {
  const [documentName, pointer = ''] = reference.split('#');
  const document = documentName ? documents.get(path.basename(documentName)) : root;
  if (!document) throw new Error(`unknown schema document: ${documentName}`);
  return {
    document,
    definition: pointer ? pointerValue(document, `#${pointer}`) : document
  };
}

function equalValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function schemaErrors(value, definition, root = schema, location = '$') {
  if (!definition) return [`${location}: missing schema definition`];
  if (definition.$ref) {
    const resolved = resolveSchema(root, definition.$ref);
    return schemaErrors(value, resolved.definition, resolved.document, location);
  }
  const errors = [];
  if (Object.hasOwn(definition, 'const') && !equalValue(value, definition.const)) {
    errors.push(`${location}: const mismatch`);
  }
  if (definition.enum && !definition.enum.some((item) => equalValue(value, item))) {
    errors.push(`${location}: enum mismatch`);
  }
  if (definition.type === 'object' && (value === null || typeof value !== 'object' || Array.isArray(value))) {
    errors.push(`${location}: expected object`);
    return errors;
  }
  if (definition.type === 'array' && !Array.isArray(value)) {
    errors.push(`${location}: expected array`);
    return errors;
  }
  if (definition.type === 'string' && typeof value !== 'string') {
    errors.push(`${location}: expected string`);
    return errors;
  }
  if (definition.type === 'boolean' && typeof value !== 'boolean') {
    errors.push(`${location}: expected boolean`);
    return errors;
  }
  if (definition.type === 'integer' && (!Number.isSafeInteger(value))) {
    errors.push(`${location}: expected safe integer`);
    return errors;
  }
  if (definition.type === 'null' && value !== null) {
    errors.push(`${location}: expected null`);
    return errors;
  }
  if (typeof value === 'string') {
    if (definition.pattern && !(new RegExp(definition.pattern)).test(value)) errors.push(`${location}: pattern mismatch`);
    if (definition.minLength !== undefined && value.length < definition.minLength) errors.push(`${location}: too short`);
    if (definition.maxLength !== undefined && value.length > definition.maxLength) errors.push(`${location}: too long`);
  }
  if (typeof value === 'number') {
    if (definition.minimum !== undefined && value < definition.minimum) errors.push(`${location}: below minimum`);
    if (definition.maximum !== undefined && value > definition.maximum) errors.push(`${location}: above maximum`);
  }
  if (Array.isArray(value)) {
    if (definition.minItems !== undefined && value.length < definition.minItems) errors.push(`${location}: too few items`);
    if (definition.maxItems !== undefined && value.length > definition.maxItems) errors.push(`${location}: too many items`);
    if (definition.items) value.forEach((item, index) => errors.push(...schemaErrors(item, definition.items, root, `${location}[${index}]`)));
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    if (definition.required) {
      for (const key of definition.required) if (!Object.hasOwn(value, key)) errors.push(`${location}: missing ${key}`);
    }
    if (definition.additionalProperties === false) {
      const allowed = new Set(Object.keys(definition.properties || {}));
      for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${location}: unknown ${key}`);
    }
    for (const [key, child] of Object.entries(definition.properties || {})) {
      if (Object.hasOwn(value, key)) errors.push(...schemaErrors(value[key], child, root, `${location}.${key}`));
    }
  }
  for (const child of definition.anyOf || []) {
    if (schemaErrors(value, child, root, location).length === 0) return errors;
  }
  if (definition.anyOf && definition.anyOf.length > 0) errors.push(`${location}: anyOf mismatch`);
  if (definition.oneOf) {
    const branchErrors = definition.oneOf.map((child) => schemaErrors(value, child, root, location));
    const matches = branchErrors.filter((errorsForBranch) => errorsForBranch.length === 0).length;
    if (matches !== 1) errors.push(`${location}: oneOf matched ${matches} branches`);
    if (matches === 0 && location === '$.operation') {
      branchErrors.forEach((branch, index) => errors.push(`${location}[${index}]: ${branch.join(', ')}`));
    }
  }
  return errors;
}

function assertSchemaValid(value, definition = schema) {
  const errors = schemaErrors(value, definition);
  assert.deepEqual(errors, [], errors.join('\n') || JSON.stringify(value));
}

function assertSchemaInvalid(value) {
  assert.notDeepEqual(schemaErrors(value, schema), []);
}

function operationExamples() {
  const digest = 'a'.repeat(64);
  const targetIdentity = { resource_type: 'git_ref', resource_id: 'refs/heads/main' };
  const authority = {
    child_comment_id: 359,
    parent_comment_id: 240,
    node_id: 'node-id',
    author_login: 'owner',
    author_association: 'OWNER',
    body_digest: digest,
    updated_at: '2026-09-04T12:00:00.000Z',
    update_identity_digest: digest,
    scope_digest: digest
  };
  const start = {
    base_sha: '0'.repeat(40),
    head_sha: '1'.repeat(40),
    tree_sha: '2'.repeat(40),
    status_digest: digest,
    clean_worktree: true,
    ref: { detached: false, name: 'refs/heads/main' }
  };
  const descriptor = {
    operation_kind: 'GIT_REF_UPDATE',
    safety_class: 'CAS',
    target_identity: targetIdentity,
    target_digest: digest,
    expected_source_digest: digest,
    cas_digest: digest,
    expected_post_state_digest: digest,
    adapter_identity_digest: digest,
    retry_of_operation_id: null
  };
  const evidence = {
    operation_id: 'operation-test',
    logical_operation_digest: digest,
    adapter_identity_digest: digest,
    target_identity: targetIdentity,
    target_digest: digest,
    provider_operation_key: 'gpr:operation-test',
    cas_digest: digest,
    classification: 'APPLIED',
    observed_post_state_digest: digest,
    rejection_digest: null,
    delayed_completion_excluded: false,
    evidence_at: '2026-09-04T12:00:00.000Z',
    evidence_digest: digest
  };
  return [
    { kind: 'READBACK_INSPECTION', target: 'NAMESPACE' },
    { kind: 'ALLOCATE_RUN', authority, start, candidate: null, lease_ms: 1000 },
    { kind: 'START_RUN', allocation_id: 'allocation-test' },
    {
      kind: 'APPEND_RECEIPT',
      receipt: {
        receipt_type: 'TRANSITION_PREVIEW',
        candidate: null,
        payload: { classification: 'TRANSITION_PREVIEW' },
        created_at: '2026-09-04T12:00:00.000Z'
      }
    },
    { kind: 'INTERRUPT_RUN', reason: 'REQUESTED' },
    { kind: 'MUTATION_ADMIT', descriptor },
    { kind: 'MUTATION_DISPATCH', operation_id: 'operation-test' },
    { kind: 'MUTATION_OUTCOME', operation_id: 'operation-test', evidence },
    { kind: 'MUTATION_RECONCILE', operation_id: 'operation-test' },
    { kind: 'ORPHAN_RECOVERY', old_run_digest: digest, evidence_digest: digest },
    { kind: 'MIGRATE_V2_TO_V3', source_schema_fingerprint: digest }
  ];
}

test('canonical broker schema and policy are present and aligned with Node authorities', () => {
  assert.equal(schema.$id, 'toolkit.github-program.broker-ipc.v1');
  assert.equal(policy.broker_ipc.schema, schema.$id);
  assert.equal(policy.broker_ipc.contract_file, path.basename(schemaPath));
  assert.deepEqual(
    policy.broker_ipc.operations,
    schema.$defs.operation.oneOf.map((branch) => branch.properties.kind.const)
  );
  assert.deepEqual(policy.broker_ipc.mutation_operation_kinds, runtime.OPERATION_KINDS);
  assert.deepEqual(
    schema.$defs.operation_descriptor.properties.operation_kind.enum,
    runtime.OPERATION_KINDS
  );
  assert.deepEqual(policy.broker_ipc.error_codes, [
    'BROKER_MALFORMED_FRAME',
    'BROKER_MALFORMED_REQUEST',
    'BROKER_UNSUPPORTED_SCHEMA',
    'BROKER_UNSUPPORTED_OPERATION',
    'BROKER_INVALID_FIELD',
    'BROKER_LIMIT_VIOLATION',
    'BROKER_REQUEST_CONFLICT',
    'BROKER_BUSY',
    'BROKER_STALE_EXPECTED_STATE',
    'BROKER_UNVERIFIABLE_IDENTITY',
    'BROKER_UNSUPPORTED_PLATFORM',
    'BROKER_INTERNAL_INVARIANT'
  ]);
});

test('all locked operation shapes validate independently against the canonical schema', () => {
  const base = JSON.parse(fixture.request.serialized);
  for (const operation of operationExamples()) {
    assertSchemaValid({ ...base, operation });
  }
  assertSchemaValid({ resource_type: 'provider_resource', resource_id: 'x'.repeat(512) }, schema.$defs.target_identity);
  assert.notDeepEqual(
    schemaErrors({ resource_type: 'provider_resource', resource_id: 'x'.repeat(513) }, schema.$defs.target_identity),
    []
  );
  assert.equal(runtime.canonicalSerialize(base), fixture.request.serialized);
});

test('response readback and stable failure forms validate independently', () => {
  const namespace = { repository: 'weijunswj/ai-agent-toolkit', parent_issue: 240, child_issue: 359 };
  const readback = {
    kind: 'NAMESPACE',
    namespace,
    namespace_digest: runtime.namespaceDigest(namespace)
  };
  assertSchemaValid({
    schema: schema.$id,
    request_id: fixture.request.serialized.match(/"request_id":"([^"]+)"/)[1],
    ok: true,
    result: { result_digest: runtime.digestValue(readback), readback },
    error: null
  }, schema.$defs.response);
  assertSchemaValid({
    schema: schema.$id,
    request_id: null,
    ok: false,
    result: null,
    error: { code: 'BROKER_INVALID_FIELD' }
  }, schema.$defs.response);
});

test('pre-AMEND operation and unknown fields are rejected by the canonical schema', () => {
  const base = JSON.parse(fixture.request.serialized);
  const unknown = { ...base, database_path: 'C:/private.sqlite' };
  assertSchemaInvalid(unknown);
  const oldOutcome = {
    ...base,
    operation: { kind: 'MUTATION_OUTCOME', operation_id: 'operation-test', outcome: 'APPLIED' }
  };
  assertSchemaInvalid(oldOutcome);
});
