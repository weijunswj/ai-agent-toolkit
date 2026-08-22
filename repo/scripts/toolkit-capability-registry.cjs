'use strict';

const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const a1 = require('./toolkit-control-plane/control-plane-kernel.cjs');

const REGISTRY_SCHEMA = 'toolkit.repository-capability-registry.v2';
const IDENTITY_CONTRACT = 'toolkit.repository-identity.v1';
const CAPABILITY_CONTRACT = 'toolkit.repository-capability.v2';
const SCHEMA_VERSION = 2;
const LEGACY_REGISTRY_SCHEMA = 'toolkit.repository-capability-registry.v1';
const LEGACY_CAPABILITY_CONTRACT = 'toolkit.repository-capability.v1';
const LEGACY_SCHEMA_VERSION = 1;
const LEGACY_CONTRACT_DIGEST = '79f3b6fa812ffa6775d603ed66b2937e242745488f281d02c914f867fb491602';
const MIGRATION_SCHEMA = 'toolkit.repository-capability-registry.migration.v1';
const MIGRATION_ALGORITHM = 'v1-to-v2-local-atomic';
const MAX_REGISTRY_BYTES = 1024 * 1024;
const MAX_REPOSITORIES = 128;
const MAX_CAPABILITIES_PER_REPOSITORY = 3;
const MAX_LOCK_BYTES = 4096;
const LOCK_SCHEMA = 'toolkit.repository-capability-registry.lock.v1';
const TRANSACTION_SCHEMA = 'toolkit.repository-capability-registry.transaction.v1';
const REGISTRY_BASENAME = 'repository-governance.v1.json';
const MAX_TRANSACTION_BYTES = 4096;
const CAPABILITIES = Object.freeze(['repository.governance', 'execution_loop', 'repository.protection']);
const ENTRY_CAPABILITIES = Object.freeze(['repository.governance', 'execution_loop']);
const PROTECTION_SCOPES = Object.freeze([
  'inspect',
  'ci-enrolment',
  'publisher-enrolment',
  'required-check-activation',
  'protection-mutation',
  'drift-repair',
  'rollback',
]);
const DURABLE_STATES = Object.freeze(['enabled', 'disabled']);
const RUNTIME_STATES = Object.freeze(['unresolved', 'enabled', 'disabled']);
const DECISION_OPERATIONS = Object.freeze(['enable', 'decline', 'disable']);
const BINDING_OPERATIONS = Object.freeze(['enable', 'decline', 'disable', 'reopen']);
const COMBINED_OPERATIONS = Object.freeze(['enable', 'decline']);

const CAPABILITY_DEFINITIONS = Object.freeze({
  'repository.governance': Object.freeze({
    id: 'repository.governance',
    effect_id: 'repository-governance-local-managed-materials-only',
    boundary_id: 'no-github-provider-live-or-unrelated-capability-authority',
    question_id: 'repository.governance.question',
    choices: Object.freeze(['decline', 'enable']),
    decision_semantic_ids: Object.freeze([
      'repository.governance.decline',
      'repository.governance.enable',
      'repository.governance.disable',
      'repository.governance.reopen',
    ]),
  }),
  execution_loop: Object.freeze({
    id: 'execution_loop',
    effect_id: 'future-a3-supported-user-requested-loop-routing-only',
    boundary_id: 'no-governance-github-provider-live-or-unrelated-capability-authority',
    question_id: 'execution_loop.question',
    choices: Object.freeze(['decline', 'enable']),
    decision_semantic_ids: Object.freeze([
      'execution_loop.decline',
      'execution_loop.enable',
      'execution_loop.disable',
      'execution_loop.reopen',
    ]),
  }),
  'repository.protection': Object.freeze({
    id: 'repository.protection',
    effect_id: 'n6-repository-protection-reconciliation-consent-only',
    boundary_id: 'no-ci-gate-finality-or-live-provider-authority',
    question_id: 'repository.protection.question',
    choices: Object.freeze(['decline', 'enable']),
    decision_semantic_ids: Object.freeze([
      'repository.protection.decline',
      'repository.protection.enable',
      'repository.protection.disable',
      'repository.protection.reopen',
    ]),
    scopes: PROTECTION_SCOPES,
  }),
});

const CONTRACT_SEMANTICS = Object.freeze({
  registry_schema: { id: REGISTRY_SCHEMA, version: SCHEMA_VERSION },
  identity_contract: { id: IDENTITY_CONTRACT, version: 1 },
  capability_contract: { id: CAPABILITY_CONTRACT, version: 2 },
  states: ['disabled', 'enabled', 'unresolved'],
  transitions: [
    'disabled->enable->enabled',
    'enabled->disable->disabled',
    'enabled->enable->enabled',
    'disabled->disable->disabled',
    'unresolved->decline->disabled',
    'unresolved->enable->enabled',
  ],
  capabilities: {
    'repository.governance': {
      effect_id: CAPABILITY_DEFINITIONS['repository.governance'].effect_id,
      boundary_id: CAPABILITY_DEFINITIONS['repository.governance'].boundary_id,
      question_id: CAPABILITY_DEFINITIONS['repository.governance'].question_id,
      choice_semantic_ids: [
        'repository.governance.decline',
        'repository.governance.enable',
      ],
      decision_semantic_ids: [...CAPABILITY_DEFINITIONS['repository.governance'].decision_semantic_ids],
    },
    execution_loop: {
      effect_id: CAPABILITY_DEFINITIONS.execution_loop.effect_id,
      boundary_id: CAPABILITY_DEFINITIONS.execution_loop.boundary_id,
      question_id: CAPABILITY_DEFINITIONS.execution_loop.question_id,
      choice_semantic_ids: [
        'execution_loop.decline',
        'execution_loop.enable',
      ],
      decision_semantic_ids: [...CAPABILITY_DEFINITIONS.execution_loop.decision_semantic_ids],
    },
    'repository.protection': {
      effect_id: CAPABILITY_DEFINITIONS['repository.protection'].effect_id,
      boundary_id: CAPABILITY_DEFINITIONS['repository.protection'].boundary_id,
      question_id: CAPABILITY_DEFINITIONS['repository.protection'].question_id,
      choice_semantic_ids: [
        'repository.protection.decline',
        'repository.protection.enable',
      ],
      decision_semantic_ids: [...CAPABILITY_DEFINITIONS['repository.protection'].decision_semantic_ids],
      scopes: [...PROTECTION_SCOPES],
    },
  },
  receipt: {
    outcome_id: 'explicit-owner-decision-committed',
    authority_rule_id: 'receipt-is-evidence-not-authority',
  },
});

// This tuple is intentionally independent from the active v2 contract. It is
// the only legacy authority definition accepted by the migration dispatcher.
const LEGACY_V1_CONTRACT_SEMANTICS = Object.freeze({
  registry_schema: { id: LEGACY_REGISTRY_SCHEMA, version: LEGACY_SCHEMA_VERSION },
  identity_contract: { id: IDENTITY_CONTRACT, version: 1 },
  capability_contract: { id: LEGACY_CAPABILITY_CONTRACT, version: 1 },
  states: ['disabled', 'enabled', 'unresolved'],
  transitions: [
    'disabled->enable->enabled',
    'enabled->disable->disabled',
    'enabled->enable->enabled',
    'disabled->disable->disabled',
    'unresolved->decline->disabled',
    'unresolved->enable->enabled',
  ],
  capabilities: {
    'repository.governance': {
      effect_id: 'repository-governance-local-managed-materials-only',
      boundary_id: 'no-github-provider-live-or-unrelated-capability-authority',
      question_id: 'repository.governance.question',
      choice_semantic_ids: [
        'repository.governance.decline',
        'repository.governance.enable',
      ],
      decision_semantic_ids: [
        'repository.governance.decline',
        'repository.governance.enable',
        'repository.governance.disable',
        'repository.governance.reopen',
      ],
    },
    execution_loop: {
      effect_id: 'future-a3-supported-user-requested-loop-routing-only',
      boundary_id: 'no-governance-github-provider-live-or-unrelated-capability-authority',
      question_id: 'execution_loop.question',
      choice_semantic_ids: [
        'execution_loop.decline',
        'execution_loop.enable',
      ],
      decision_semantic_ids: [
        'execution_loop.decline',
        'execution_loop.enable',
        'execution_loop.disable',
        'execution_loop.reopen',
      ],
    },
  },
  receipt: {
    outcome_id: 'explicit-owner-decision-committed',
    authority_rule_id: 'receipt-is-evidence-not-authority',
  },
});

class RegistryError extends Error {
  constructor(code) {
    super(code);
    this.name = 'RegistryError';
    this.code = code;
  }
}

function fail(code) {
  throw new RegistryError(code);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function exactKeys(value, keys) {
  if (!isRecord(value)) return false;
  const expected = new Set(keys);
  const actual = Object.keys(value);
  return actual.length === expected.size && actual.every((key) => expected.has(key));
}

function canonicalSerialize(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('CANONICAL_VALUE_INVALID');
    return Object.is(value, -0) ? '0' : String(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalSerialize).join(',') + ']';
  if (isRecord(value)) {
    return '{' + Object.keys(value).sort().map((key) => (
      canonicalSerialize(key) + ':' + canonicalSerialize(value[key])
    )).join(',') + '}';
  }
  fail('CANONICAL_VALUE_INVALID');
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function digestValue(value) {
  return sha256Hex(canonicalSerialize(value));
}

function authorityProjection(value = CONTRACT_SEMANTICS) {
  const source = isRecord(value) ? value : CONTRACT_SEMANTICS;
  const sourceCapabilities = isRecord(source.capabilities) ? source.capabilities : {};
  const capabilities = {};
  for (const capabilityId of CAPABILITIES) {
    const definition = isRecord(sourceCapabilities[capabilityId])
      ? sourceCapabilities[capabilityId]
      : CAPABILITY_DEFINITIONS[capabilityId];
    capabilities[capabilityId] = {
      effect_id: definition.effect_id,
      boundary_id: definition.boundary_id,
      question_id: definition.question_id,
      choice_semantic_ids: Array.isArray(definition.choice_semantic_ids)
        ? [...definition.choice_semantic_ids].sort()
        : [...CAPABILITY_DEFINITIONS[capabilityId].choices]
          .map((choice) => capabilityId + '.' + choice)
          .sort(),
      decision_semantic_ids: Array.isArray(definition.decision_semantic_ids)
        ? [...definition.decision_semantic_ids].sort()
        : [...CAPABILITY_DEFINITIONS[capabilityId].decision_semantic_ids].sort(),
    };
  }
  const transitions = Array.isArray(source.transitions)
    ? [...source.transitions].sort()
    : [...CONTRACT_SEMANTICS.transitions].sort();
  return {
    registry_schema: source.registry_schema || CONTRACT_SEMANTICS.registry_schema,
    identity_contract: source.identity_contract || CONTRACT_SEMANTICS.identity_contract,
    capability_contract: source.capability_contract || CONTRACT_SEMANTICS.capability_contract,
    states: [...(Array.isArray(source.states) ? source.states : RUNTIME_STATES)].sort(),
    transitions,
    capabilities,
    receipt: source.receipt || CONTRACT_SEMANTICS.receipt,
  };
}

function contractDigest(value = CONTRACT_SEMANTICS) {
  return digestValue(authorityProjection(value));
}

const CONTRACT_DIGEST = contractDigest();

function authoritySemanticsForTest(overrides = {}) {
  const result = JSON.parse(JSON.stringify(CONTRACT_SEMANTICS));
  if (isRecord(overrides.effect_id_override)) {
    for (const capabilityId of CAPABILITIES) {
      if (typeof overrides.effect_id_override[capabilityId] === 'string') {
        result.capabilities[capabilityId].effect_id = overrides.effect_id_override[capabilityId];
      }
    }
  }
  if (hasOwn(overrides, 'cosmetic_question_text')) {
    result.cosmetic_question_text = overrides.cosmetic_question_text;
  }
  if (Array.isArray(overrides.display_order)) {
    result.display_order = [...overrides.display_order];
  }
  return result;
}

function isDigest(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function isSafeRevision(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isIsoTimestamp(value) {
  if (typeof value !== 'string' || value.length !== 24 || !value.endsWith('Z')) return false;
  try {
    return new Date(value).toISOString() === value;
  } catch (_error) {
    return false;
  }
}

function decisionSemanticId(capabilityId, operation) {
  if (!CAPABILITIES.includes(capabilityId) || !BINDING_OPERATIONS.includes(operation)) {
    fail('DECISION_BINDING_INVALID');
  }
  const semanticId = capabilityId + '.' + operation;
  if (!CAPABILITY_DEFINITIONS[capabilityId].decision_semantic_ids.includes(semanticId)) {
    fail('DECISION_BINDING_INVALID');
  }
  return semanticId;
}

function scopeDigest(repositoryId, capabilityId, operation, channel) {
  if (!isDigest(repositoryId)
    || !CAPABILITIES.includes(capabilityId)
    || !BINDING_OPERATIONS.includes(operation)
    || !['capability-route', 'combined-bank'].includes(channel)) {
    fail('SCOPE_INPUT_INVALID');
  }
  const choiceSemanticId = decisionSemanticId(capabilityId, operation);
  return digestValue({
    identity_contract: IDENTITY_CONTRACT,
    repository_id: repositoryId,
    capability_id: capabilityId,
    operation,
    choice_semantic_id: choiceSemanticId,
    provenance_channel: channel,
    contract_digest: CONTRACT_DIGEST,
  });
}

function receiptPayload(receipt) {
  return {
    repository_id: receipt.repository_id,
    capability_id: receipt.capability_id,
    prior_state: receipt.prior_state,
    resulting_state: receipt.resulting_state,
    decision_kind: receipt.decision_kind,
    provenance_category: receipt.provenance_category,
    provenance_channel: receipt.provenance_channel,
    scope_digest: receipt.scope_digest,
    registry_schema: receipt.registry_schema,
    identity_contract: receipt.identity_contract,
    capability_contract: receipt.capability_contract,
    contract_digest: receipt.contract_digest,
    registry_revision: receipt.registry_revision,
    outcome: receipt.outcome,
    decided_at: receipt.decided_at,
  };
}

const RECEIPT_KEYS = Object.freeze([
  'receipt_id',
  'repository_id',
  'capability_id',
  'prior_state',
  'resulting_state',
  'decision_kind',
  'provenance_category',
  'provenance_channel',
  'scope_digest',
  'registry_schema',
  'identity_contract',
  'capability_contract',
  'contract_digest',
  'registry_revision',
  'outcome',
  'decided_at',
]);

function legacyAuthorityProjection() {
  const source = LEGACY_V1_CONTRACT_SEMANTICS;
  const capabilities = {};
  for (const capabilityId of ENTRY_CAPABILITIES) {
    const definition = source.capabilities[capabilityId];
    capabilities[capabilityId] = {
      effect_id: definition.effect_id,
      boundary_id: definition.boundary_id,
      question_id: definition.question_id,
      choice_semantic_ids: [...definition.choice_semantic_ids].sort(),
      decision_semantic_ids: [...definition.decision_semantic_ids].sort(),
    };
  }
  return {
    registry_schema: source.registry_schema,
    identity_contract: source.identity_contract,
    capability_contract: source.capability_contract,
    states: [...source.states].sort(),
    transitions: [...source.transitions].sort(),
    capabilities,
    receipt: source.receipt,
  };
}

function legacyDecisionSemanticId(capabilityId, operation) {
  if (!ENTRY_CAPABILITIES.includes(capabilityId)
    || !['enable', 'decline', 'disable', 'reopen'].includes(operation)) {
    fail('LEGACY_RECEIPT_INVALID');
  }
  const semanticId = capabilityId + '.' + operation;
  if (!LEGACY_V1_CONTRACT_SEMANTICS.capabilities[capabilityId].decision_semantic_ids.includes(semanticId)) {
    fail('LEGACY_RECEIPT_INVALID');
  }
  return semanticId;
}

function legacyScopeDigest(repositoryId, capabilityId, operation, channel) {
  if (!isDigest(repositoryId)
    || !ENTRY_CAPABILITIES.includes(capabilityId)
    || !['enable', 'decline', 'disable'].includes(operation)
    || !['capability-route', 'combined-bank'].includes(channel)) {
    fail('LEGACY_RECEIPT_INVALID');
  }
  return digestValue({
    identity_contract: IDENTITY_CONTRACT,
    repository_id: repositoryId,
    capability_id: capabilityId,
    operation,
    choice_semantic_id: legacyDecisionSemanticId(capabilityId, operation),
    provenance_channel: channel,
    contract_digest: LEGACY_CONTRACT_DIGEST,
  });
}

function validateLegacyReceipt(receipt, repositoryId, capabilityId, state, decisionKind, provenance, registryRevision) {
  if (!exactKeys(receipt, RECEIPT_KEYS)
    || !ENTRY_CAPABILITIES.includes(capabilityId)
    || receipt.repository_id !== repositoryId
    || receipt.capability_id !== capabilityId
    || !RUNTIME_STATES.includes(receipt.prior_state)
    || receipt.resulting_state !== state
    || receipt.decision_kind !== decisionKind
    || receipt.provenance_category !== provenance.category
    || receipt.provenance_channel !== provenance.channel
    || receipt.scope_digest !== provenance.scope_digest
    || receipt.scope_digest !== legacyScopeDigest(repositoryId, capabilityId, decisionKind, provenance.channel)
    || receipt.registry_schema !== LEGACY_REGISTRY_SCHEMA
    || receipt.identity_contract !== IDENTITY_CONTRACT
    || receipt.capability_contract !== LEGACY_CAPABILITY_CONTRACT
    || receipt.contract_digest !== LEGACY_CONTRACT_DIGEST
    || !isSafeRevision(receipt.registry_revision)
    || receipt.registry_revision === 0
    || receipt.registry_revision > registryRevision
    || receipt.outcome !== 'committed'
    || !isIsoTimestamp(receipt.decided_at)
    || !isDigest(receipt.receipt_id)
    || receipt.receipt_id !== digestValue(receiptPayload(receipt))) {
    fail('LEGACY_RECEIPT_INVALID');
  }
  if (decisionKind === 'decline' && receipt.prior_state !== 'unresolved') fail('LEGACY_RECEIPT_INVALID');
  if (decisionKind === 'disable' && receipt.prior_state === 'unresolved') fail('LEGACY_RECEIPT_INVALID');
}

function validateCurrentReceipt(receipt, repositoryId, capabilityId, state, decisionKind, provenance, registryRevision) {
  if (!exactKeys(receipt, RECEIPT_KEYS)) fail('REGISTRY_RECEIPT_INVALID');
  if (receipt.repository_id !== repositoryId || receipt.capability_id !== capabilityId) fail('REGISTRY_RECEIPT_INVALID');
  if (!RUNTIME_STATES.includes(receipt.prior_state)) fail('REGISTRY_RECEIPT_INVALID');
  if (receipt.resulting_state !== state || receipt.decision_kind !== decisionKind) fail('REGISTRY_RECEIPT_INVALID');
  if (receipt.provenance_category !== provenance.category || receipt.provenance_channel !== provenance.channel) fail('REGISTRY_RECEIPT_INVALID');
  if (receipt.scope_digest !== provenance.scope_digest || receipt.scope_digest !== scopeDigest(repositoryId, capabilityId, decisionKind, provenance.channel)) fail('REGISTRY_RECEIPT_INVALID');
  if (receipt.registry_schema !== REGISTRY_SCHEMA || receipt.identity_contract !== IDENTITY_CONTRACT || receipt.capability_contract !== CAPABILITY_CONTRACT) fail('REGISTRY_RECEIPT_INVALID');
  if (receipt.contract_digest !== CONTRACT_DIGEST || !isSafeRevision(receipt.registry_revision) || receipt.registry_revision === 0 || receipt.registry_revision > registryRevision) fail('REGISTRY_RECEIPT_INVALID');
  if (receipt.outcome !== 'committed' || !isIsoTimestamp(receipt.decided_at) || !isDigest(receipt.receipt_id)) fail('REGISTRY_RECEIPT_INVALID');
  if (receipt.receipt_id !== digestValue(receiptPayload(receipt))) fail('REGISTRY_RECEIPT_INVALID');
}

function validateCapabilityEntry(capability, repositoryId, registryRevision, legacyOnly, allowLegacyReceipt = legacyOnly) {
  const capabilityKeys = ['capability_id', 'state', 'decision_kind', 'provenance', 'receipt'];
  if (!exactKeys(capability, capabilityKeys)) fail('REGISTRY_MALFORMED');
  if (!CAPABILITIES.includes(capability.capability_id)) fail('REGISTRY_UNKNOWN_CAPABILITY');
  if (capability.capability_id === 'repository.protection' && legacyOnly) fail('LEGACY_SCHEMA_INVALID');
  if (capability.capability_id !== 'repository.protection' && !ENTRY_CAPABILITIES.includes(capability.capability_id)) {
    fail('REGISTRY_UNKNOWN_CAPABILITY');
  }
  if (!DURABLE_STATES.includes(capability.state)) fail('REGISTRY_STATE_INVALID');
  if (!DECISION_OPERATIONS.includes(capability.decision_kind)) fail('REGISTRY_DECISION_INVALID');
  if (capability.decision_kind === 'enable' && capability.state !== 'enabled') fail('REGISTRY_DECISION_INVALID');
  if (capability.decision_kind !== 'enable' && capability.state !== 'disabled') fail('REGISTRY_DECISION_INVALID');
  const provenance = capability.provenance;
  if (!exactKeys(provenance, ['category', 'channel', 'scope_digest'])
    || provenance.category !== 'explicit-owner'
    || !['combined-bank', 'capability-route'].includes(provenance.channel)
    || !isDigest(provenance.scope_digest)) fail(legacyOnly ? 'LEGACY_SCHEMA_INVALID' : 'REGISTRY_PROVENANCE_INVALID');

  const isLegacyReceipt = capability.receipt && capability.receipt.registry_schema === LEGACY_REGISTRY_SCHEMA;
  if (isLegacyReceipt) {
    if (!allowLegacyReceipt || !ENTRY_CAPABILITIES.includes(capability.capability_id)) fail('LEGACY_RECEIPT_INVALID');
    if (provenance.scope_digest !== legacyScopeDigest(repositoryId, capability.capability_id, capability.decision_kind, provenance.channel)) {
      fail('LEGACY_RECEIPT_INVALID');
    }
    validateLegacyReceipt(
      capability.receipt,
      repositoryId,
      capability.capability_id,
      capability.state,
      capability.decision_kind,
      provenance,
      registryRevision,
    );
  } else {
    if (provenance.scope_digest !== scopeDigest(repositoryId, capability.capability_id, capability.decision_kind, provenance.channel)) {
      fail('REGISTRY_PROVENANCE_INVALID');
    }
    validateCurrentReceipt(
      capability.receipt,
      repositoryId,
      capability.capability_id,
      capability.state,
      capability.decision_kind,
      provenance,
      registryRevision,
    );
  }
  if (capability.decision_kind === 'decline' && capability.receipt.prior_state !== 'unresolved') fail('REGISTRY_DECISION_INVALID');
  if (capability.decision_kind === 'disable' && capability.receipt.prior_state === 'unresolved') fail('REGISTRY_DECISION_INVALID');
}

function validateMigrationMetadata(migration) {
  if (!isRecord(migration)) fail('REGISTRY_MALFORMED');
  if (exactKeys(migration, ['state']) && migration.state === 'none') return;
  if (isRecord(migration) && migration.state === 'in_progress') fail('REGISTRY_INTERRUPTED_MIGRATION');
  const keys = [
    'schema',
    'state',
    'algorithm',
    'source_registry_schema',
    'source_schema_version',
    'source_identity_contract',
    'source_capability_contract',
    'source_contract_digest',
    'source_registry_revision',
    'source_snapshot_hash',
    'target_registry_schema',
    'target_schema_version',
    'target_identity_contract',
    'target_capability_contract',
    'target_contract_digest',
    'legacy_receipt_ids',
    'legacy_receipt_digests',
  ];
  if (!exactKeys(migration, keys)
    || migration.schema !== MIGRATION_SCHEMA
    || migration.state !== 'completed'
    || migration.algorithm !== MIGRATION_ALGORITHM
    || migration.source_registry_schema !== LEGACY_REGISTRY_SCHEMA
    || migration.source_schema_version !== LEGACY_SCHEMA_VERSION
    || migration.source_identity_contract !== IDENTITY_CONTRACT
    || migration.source_capability_contract !== LEGACY_CAPABILITY_CONTRACT
    || migration.source_contract_digest !== LEGACY_CONTRACT_DIGEST
    || !isSafeRevision(migration.source_registry_revision)
    || !isDigest(migration.source_snapshot_hash)
    || migration.target_registry_schema !== REGISTRY_SCHEMA
    || migration.target_schema_version !== SCHEMA_VERSION
    || migration.target_identity_contract !== IDENTITY_CONTRACT
    || migration.target_capability_contract !== CAPABILITY_CONTRACT
    || migration.target_contract_digest !== CONTRACT_DIGEST
    || !Array.isArray(migration.legacy_receipt_ids)
    || !Array.isArray(migration.legacy_receipt_digests)
    || migration.legacy_receipt_ids.length !== migration.legacy_receipt_digests.length
    || migration.legacy_receipt_ids.length > MAX_CAPABILITIES_PER_REPOSITORY
    || migration.legacy_receipt_ids.some((value) => !isDigest(value))
    || migration.legacy_receipt_digests.some((value) => !isDigest(value))
    || new Set(migration.legacy_receipt_ids).size !== migration.legacy_receipt_ids.length
    || new Set(migration.legacy_receipt_digests).size !== migration.legacy_receipt_digests.length
    || [...migration.legacy_receipt_ids].sort().join(',') !== migration.legacy_receipt_ids.join(',')
    || [...migration.legacy_receipt_digests].sort().join(',') !== migration.legacy_receipt_digests.join(',')) {
    fail('REGISTRY_MIGRATION_INVALID');
  }
}

function validateLegacyRegistry(registry) {
  if (!isRecord(registry)) fail('LEGACY_SCHEMA_INVALID');
  if (registry.schema === LEGACY_REGISTRY_SCHEMA && isSafeRevision(registry.schema_version)
    && registry.schema_version > LEGACY_SCHEMA_VERSION) fail('REGISTRY_FUTURE_SCHEMA');
  const rootKeys = [
    'schema',
    'schema_version',
    'identity_contract',
    'capability_contract',
    'contract_digest',
    'registry_revision',
    'migration',
    'repositories',
  ];
  if (!exactKeys(registry, rootKeys)
    || registry.schema !== LEGACY_REGISTRY_SCHEMA
    || registry.schema_version !== LEGACY_SCHEMA_VERSION
    || registry.identity_contract !== IDENTITY_CONTRACT
    || registry.capability_contract !== LEGACY_CAPABILITY_CONTRACT) fail('LEGACY_SCHEMA_INVALID');
  if (digestValue(legacyAuthorityProjection()) !== LEGACY_CONTRACT_DIGEST
    || registry.contract_digest !== LEGACY_CONTRACT_DIGEST) fail('LEGACY_CONTRACT_INVALID');
  if (!isSafeRevision(registry.registry_revision)) fail('LEGACY_SCHEMA_INVALID');
  if (!exactKeys(registry.migration, ['state']) || registry.migration.state !== 'none') fail('REGISTRY_INTERRUPTED_MIGRATION');
  if (!Array.isArray(registry.repositories) || registry.repositories.length > MAX_REPOSITORIES) fail('LEGACY_SCHEMA_INVALID');
  const repositoryIds = new Set();
  for (const repository of registry.repositories) {
    if (!exactKeys(repository, ['repository_id', 'capabilities'])
      || !isDigest(repository.repository_id)
      || repositoryIds.has(repository.repository_id)
      || !Array.isArray(repository.capabilities)
      || repository.capabilities.length > ENTRY_CAPABILITIES.length) fail('LEGACY_SCHEMA_INVALID');
    repositoryIds.add(repository.repository_id);
    const capabilityIds = new Set();
    for (const capability of repository.capabilities) {
      if (!ENTRY_CAPABILITIES.includes(capability?.capability_id) || capabilityIds.has(capability.capability_id)) {
        fail(capability?.capability_id === 'repository.protection' ? 'LEGACY_SCHEMA_INVALID' : 'REGISTRY_DUPLICATE_CAPABILITY');
      }
      capabilityIds.add(capability.capability_id);
      validateCapabilityEntry(capability, repository.repository_id, registry.registry_revision, true, true);
    }
  }
  return registry;
}

function validateRegistry(registry) {
  if (!isRecord(registry)) fail('REGISTRY_MALFORMED');
  if (registry.schema === REGISTRY_SCHEMA && isSafeRevision(registry.schema_version) && registry.schema_version > SCHEMA_VERSION) {
    fail('REGISTRY_FUTURE_SCHEMA');
  }
  const rootKeys = [
    'schema',
    'schema_version',
    'identity_contract',
    'capability_contract',
    'contract_digest',
    'registry_revision',
    'migration',
    'repositories',
  ];
  if (!exactKeys(registry, rootKeys)) fail('REGISTRY_MALFORMED');
  if (registry.schema !== REGISTRY_SCHEMA || registry.schema_version !== SCHEMA_VERSION) fail('REGISTRY_INCOMPATIBLE');
  if (registry.identity_contract !== IDENTITY_CONTRACT || registry.capability_contract !== CAPABILITY_CONTRACT) fail('REGISTRY_INCOMPATIBLE');
  if (registry.contract_digest !== CONTRACT_DIGEST) fail('REGISTRY_STALE_CONTRACT');
  if (!isSafeRevision(registry.registry_revision)) fail('REGISTRY_REVISION_INVALID');
  validateMigrationMetadata(registry.migration);
  if (!Array.isArray(registry.repositories) || registry.repositories.length > MAX_REPOSITORIES) fail('REGISTRY_MALFORMED');

  const repositoryIds = new Set();
  for (const repository of registry.repositories) {
    if (!exactKeys(repository, ['repository_id', 'capabilities'])) fail('REGISTRY_MALFORMED');
    if (!isDigest(repository.repository_id)) fail('REGISTRY_REPOSITORY_ID_INVALID');
    if (repositoryIds.has(repository.repository_id)) fail('REGISTRY_DUPLICATE_REPOSITORY');
    repositoryIds.add(repository.repository_id);
    if (!Array.isArray(repository.capabilities) || repository.capabilities.length > MAX_CAPABILITIES_PER_REPOSITORY) {
      fail('REGISTRY_MALFORMED');
    }
    const capabilityIds = new Set();
    for (const capability of repository.capabilities) {
      const capabilityKeys = ['capability_id', 'state', 'decision_kind', 'provenance', 'receipt'];
      if (!exactKeys(capability, capabilityKeys)) fail('REGISTRY_MALFORMED');
      if (!CAPABILITIES.includes(capability.capability_id)) fail('REGISTRY_UNKNOWN_CAPABILITY');
      if (capabilityIds.has(capability.capability_id)) fail('REGISTRY_DUPLICATE_CAPABILITY');
      capabilityIds.add(capability.capability_id);
      validateCapabilityEntry(capability, repository.repository_id, registry.registry_revision, false, true);
      if (capability.receipt.registry_schema === LEGACY_REGISTRY_SCHEMA) {
        if (registry.migration.state !== 'completed'
          || !registry.migration.legacy_receipt_ids.includes(capability.receipt.receipt_id)
          || !registry.migration.legacy_receipt_digests.includes(digestValue(capability.receipt))) {
          fail('LEGACY_RECEIPT_INVALID');
        }
      }
    }
  }
  return registry;
}

function emptyRegistry() {
  return {
    schema: REGISTRY_SCHEMA,
    schema_version: SCHEMA_VERSION,
    identity_contract: IDENTITY_CONTRACT,
    capability_contract: CAPABILITY_CONTRACT,
    contract_digest: CONTRACT_DIGEST,
    registry_revision: 0,
    migration: { state: 'none' },
    repositories: [],
  };
}

function scanJsonKeys(text) {
  let index = 0;

  function skipWhitespace() {
    while (index < text.length && /\s/.test(text[index])) index += 1;
  }

  function parseString() {
    const start = index;
    if (text[index] !== '"') fail('REGISTRY_MALFORMED');
    index += 1;
    while (index < text.length) {
      const character = text[index];
      if (character === '\\') {
        index += 2;
        continue;
      }
      if (character === '"') {
        index += 1;
        try {
          return JSON.parse(text.slice(start, index));
        } catch (_error) {
          fail('REGISTRY_MALFORMED');
        }
      }
      if (character < ' ') fail('REGISTRY_MALFORMED');
      index += 1;
    }
    fail('REGISTRY_MALFORMED');
  }

  function parsePrimitive() {
    const start = index;
    while (index < text.length && !/[,\]}:\s]/.test(text[index])) index += 1;
    if (start === index) fail('REGISTRY_MALFORMED');
  }

  function parseValue() {
    skipWhitespace();
    if (index >= text.length) fail('REGISTRY_MALFORMED');
    if (text[index] === '"') {
      parseString();
      return;
    }
    if (text[index] === '{') {
      parseObject();
      return;
    }
    if (text[index] === '[') {
      parseArray();
      return;
    }
    parsePrimitive();
  }

  function parseObject() {
    index += 1;
    skipWhitespace();
    const keys = new Set();
    if (text[index] === '}') {
      index += 1;
      return;
    }
    while (index < text.length) {
      skipWhitespace();
      const key = parseString();
      if (keys.has(key)) fail('REGISTRY_DUPLICATE_KEY');
      keys.add(key);
      skipWhitespace();
      if (text[index] !== ':') fail('REGISTRY_MALFORMED');
      index += 1;
      parseValue();
      skipWhitespace();
      if (text[index] === '}') {
        index += 1;
        return;
      }
      if (text[index] !== ',') fail('REGISTRY_MALFORMED');
      index += 1;
    }
    fail('REGISTRY_MALFORMED');
  }

  function parseArray() {
    index += 1;
    skipWhitespace();
    if (text[index] === ']') {
      index += 1;
      return;
    }
    while (index < text.length) {
      parseValue();
      skipWhitespace();
      if (text[index] === ']') {
        index += 1;
        return;
      }
      if (text[index] !== ',') fail('REGISTRY_MALFORMED');
      index += 1;
    }
    fail('REGISTRY_MALFORMED');
  }

  parseValue();
  skipWhitespace();
  if (index !== text.length) fail('REGISTRY_MALFORMED');
}

function parseRegistryBytes(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_REGISTRY_BYTES) fail('REGISTRY_OVERSIZED');
  let text;
  try {
    text = bytes.toString('utf8');
    scanJsonKeys(text);
    const parsed = JSON.parse(text);
    if (parsed && parsed.schema === LEGACY_REGISTRY_SCHEMA) return validateLegacyRegistry(parsed);
    if (parsed && parsed.schema === REGISTRY_SCHEMA) return validateRegistry(parsed);
    if (parsed && typeof parsed.schema_version === 'number' && parsed.schema_version > SCHEMA_VERSION) {
      fail('FUTURE_REGISTRY_SCHEMA');
    }
    fail('REGISTRY_INCOMPATIBLE');
  } catch (error) {
    if (error instanceof RegistryError) throw error;
    fail('REGISTRY_MALFORMED');
  }
}

function normalizeAbsolute(value, code) {
  if (typeof value !== 'string' || value.length === 0 || !path.isAbsolute(value)) fail(code);
  return path.normalize(path.resolve(value));
}

function registryPathForOptions(options = {}) {
  const testOnly = options.testOnly === true;
  if (hasOwn(options, 'userHome') && !testOnly) fail('USER_HOME_OVERRIDE_FORBIDDEN');
  let registryPath;
  if (hasOwn(options, 'registryPath')) {
    if (!testOnly) fail('REGISTRY_PATH_OVERRIDE_FORBIDDEN');
    registryPath = normalizeAbsolute(options.registryPath, 'REGISTRY_PATH_INVALID');
    if (path.basename(registryPath).toLowerCase() !== REGISTRY_BASENAME.toLowerCase()) fail('REGISTRY_PATH_INVALID');
  } else {
    const home = normalizeAbsolute(options.userHome || os.homedir(), 'USER_HOME_INVALID');
    registryPath = path.join(home, '.ai-agent-toolkit', 'user-state', REGISTRY_BASENAME);
  }
  return registryPath;
}

function lockPathForRegistry(registryPath) {
  return registryPath + '.lock';
}

function transactionPathForRegistry(registryPath, token) {
  return registryPath + '.transaction-' + token.replaceAll('-', '');
}

function isRecognizedArtifact(name) {
  const prefix = REGISTRY_BASENAME + '.';
  if (!name.startsWith(prefix)) return false;
  const suffix = name.slice(prefix.length);
  return /^(tmp|migration|transaction)-[a-f0-9]{16,}$/.test(suffix);
}

function ensureSafeAncestors(directory) {
  const parsed = path.parse(directory);
  let current = parsed.root;
  const parts = directory.slice(parsed.root.length).split(path.sep).filter(Boolean);
  for (const part of parts) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) break;
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (_error) {
      fail('REGISTRY_STORAGE_UNAVAILABLE');
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('REGISTRY_STORAGE_INDETERMINATE');
  }
}

function ensureSafeDirectory(directory, create) {
  ensureSafeAncestors(directory);
  if (!fs.existsSync(directory)) {
    if (!create) return false;
    fs.mkdirSync(directory, { recursive: true });
  }
  let stat;
  try {
    stat = fs.lstatSync(directory);
  } catch (_error) {
    fail('REGISTRY_STORAGE_UNAVAILABLE');
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('REGISTRY_STORAGE_INDETERMINATE');
  try {
    const real = fs.realpathSync(directory);
    if (path.normalize(real) !== path.normalize(directory)) fail('REGISTRY_STORAGE_INDETERMINATE');
  } catch (_error) {
    fail('REGISTRY_STORAGE_INDETERMINATE');
  }
  return true;
}

function inspectArtifacts(registryPath, ownedTransaction = null) {
  const directory = path.dirname(registryPath);
  if (!ensureSafeDirectory(directory, false)) return;
  let names;
  try {
    names = fs.readdirSync(directory);
  } catch (_error) {
    fail('REGISTRY_STORAGE_UNAVAILABLE');
  }
  const recognized = names.filter(isRecognizedArtifact);
  if (recognized.length === 0) return;
  if (!ownedTransaction
    || recognized.length !== 1
    || path.normalize(path.join(directory, recognized[0])) !== path.normalize(ownedTransaction.markerPath)) {
    fail('REGISTRY_INTERRUPTED_TRANSACTION');
  }
  validateTransactionMarker(ownedTransaction);
}

function ensureSafeRegistryFile(registryPath) {
  if (!fs.existsSync(registryPath)) return;
  let stat;
  try {
    stat = fs.lstatSync(registryPath);
  } catch (_error) {
    fail('REGISTRY_STORAGE_UNAVAILABLE');
  }
  if (!stat.isFile() || stat.isSymbolicLink()) fail('REGISTRY_STORAGE_INDETERMINATE');
  try {
    if (path.normalize(fs.realpathSync(registryPath)) !== path.normalize(registryPath)) fail('REGISTRY_STORAGE_INDETERMINATE');
  } catch (_error) {
    fail('REGISTRY_STORAGE_INDETERMINATE');
  }
}

function snapshotHashForBytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function serializeRegistry(registry) {
  return JSON.stringify(registry);
}

function snapshotHashForRegistry(registry) {
  return snapshotHashForBytes(Buffer.from(serializeRegistry(registry), 'utf8'));
}

function readSnapshot(options = {}, ownedTransaction = null) {
  const registryPath = registryPathForOptions(options);
  inspectArtifacts(registryPath, ownedTransaction);
  const directory = path.dirname(registryPath);
  if (!ensureSafeDirectory(directory, false)) {
    return {
      present: false,
      registry: null,
      registry_revision: 0,
      snapshot_hash: null,
      registry_path: registryPath,
      legacy: false,
    };
  }
  ensureSafeRegistryFile(registryPath);
  if (!fs.existsSync(registryPath)) {
    return {
      present: false,
      registry: null,
      registry_revision: 0,
      snapshot_hash: null,
      registry_path: registryPath,
      legacy: false,
    };
  }
  let bytes;
  try {
    bytes = fs.readFileSync(registryPath);
  } catch (_error) {
    fail('REGISTRY_STORAGE_UNAVAILABLE');
  }
  const registry = parseRegistryBytes(bytes);
  return {
    present: true,
    registry,
    registry_revision: registry.registry_revision,
    snapshot_hash: snapshotHashForBytes(bytes),
    registry_path: registryPath,
    legacy: registry.schema === LEGACY_REGISTRY_SCHEMA,
  };
}

function assertNoCallerIdentityOverride(options) {
  if (hasOwn(options, 'repositoryId') || hasOwn(options, 'remote') || hasOwn(options, 'canonicalRemote')) {
    fail('REPOSITORY_ID_SPOOF_ATTEMPT');
  }
}

function runGit(cwd, args, options = {}) {
  let result;
  try {
    result = childProcess.spawnSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      timeout: 3000,
      maxBuffer: 65536,
      windowsHide: true,
      shell: false,
    });
  } catch (_error) {
    fail('GIT_IDENTITY_UNAVAILABLE');
  }
  if (!result || result.error || result.signal || typeof result.stdout !== 'string'
    || (result.status !== 0 && !(options.allowStatusOne && result.status === 1))) {
    fail('GIT_IDENTITY_UNAVAILABLE');
  }
  if (Buffer.byteLength(result.stdout, 'utf8') > 65536) fail('GIT_IDENTITY_UNAVAILABLE');
  return result.stdout;
}

function resolveRepositoryIdentity(options = {}) {
  assertNoCallerIdentityOverride(options);
  if (typeof options.cwd !== 'string' || options.cwd.length === 0) fail('GIT_ROOT_INVALID');
  const cwd = normalizeAbsolute(options.cwd, 'GIT_ROOT_INVALID');
  const worktree = runGit(cwd, ['rev-parse', '--show-toplevel']).trim();
  if (!worktree || !fs.existsSync(worktree)) fail('GIT_ROOT_INVALID');
  const inside = runGit(cwd, ['rev-parse', '--is-inside-work-tree']).trim();
  if (inside !== 'true') fail('GIT_ROOT_INVALID');
  let worktreeStat;
  try {
    worktreeStat = fs.statSync(worktree);
  } catch (_error) {
    fail('GIT_ROOT_INVALID');
  }
  if (!worktreeStat.isDirectory()) fail('GIT_ROOT_INVALID');
  const originOutput = runGit(cwd, ['config', '--local', '--get-all', 'remote.origin.url'], { allowStatusOne: true });
  if (originOutput.length === 0 || originOutput.trim().length === 0) fail('ORIGIN_IDENTITY_MISSING');
  const origins = originOutput.trim().split(/\r?\n/);
  if (origins.length !== 1 || origins[0].length === 0) fail('ORIGIN_IDENTITY_AMBIGUOUS');
  const remote = a1.validateRemoteIdentity(origins[0]);
  if (!remote.valid) fail('REMOTE_IDENTITY_INVALID');
  const repositoryId = repositoryIdForCanonicalRemote(remote.canonical);
  return {
    valid: true,
    repository_id: repositoryId,
    canonical_remote: remote.canonical,
    identity_contract: IDENTITY_CONTRACT,
    remote_contract: a1.REMOTE_IDENTITY_CONTRACT_VERSION,
    persisted_fields: ['repository_id'],
  };
}

function repositoryIdForCanonicalRemote(remoteValue) {
  let remote = a1.validateRemoteIdentity(remoteValue);
  if (!remote.valid && typeof remoteValue === 'string' && remoteValue.startsWith('scp://git@')) {
    const separator = remoteValue.indexOf('/', 'scp://git@'.length);
    if (separator > 'scp://git@'.length) {
      const host = remoteValue.slice('scp://git@'.length, separator);
      const scpPath = remoteValue.slice(separator + 1);
      remote = a1.validateRemoteIdentity('git@' + host + ':' + scpPath);
      if (remote.valid && remote.canonical !== remoteValue) remote = { valid: false };
    }
  }
  if (!remote.valid) fail('REMOTE_IDENTITY_INVALID');
  return digestValue({
    identity_contract: IDENTITY_CONTRACT,
    remote_contract: a1.REMOTE_IDENTITY_CONTRACT_VERSION,
    remote: remote.canonical,
  });
}

function readCapabilityMap(registry, repositoryId) {
  const record = registry && registry.repositories.find((entry) => entry.repository_id === repositoryId);
  const result = {};
  for (const capabilityId of CAPABILITIES) {
    const entry = record && record.capabilities.find((candidate) => candidate.capability_id === capabilityId);
    result[capabilityId] = {
      capability_id: capabilityId,
      state: entry ? entry.state : 'unresolved',
      decision_kind: entry ? entry.decision_kind : null,
      receipt_id: entry ? entry.receipt.receipt_id : null,
    };
  }
  return result;
}

function safeActionable(error) {
  return {
    status: 'actionable',
    actionable: true,
    reason_code: error.code || 'REGISTRY_UNAVAILABLE',
    repository_id: null,
    registry_revision: 0,
    snapshot_hash: null,
    capabilities: null,
    question_bank: null,
    visible_output: false,
    policy_prose: false,
  };
}

function getRepositoryStatus(options = {}) {
  assertNoCallerIdentityOverride(options);
  let identity;
  try {
    identity = resolveRepositoryIdentity(options);
    let snapshot = readSnapshot(options);
    if (snapshot.legacy === true) snapshot = migrateLegacyRegistry(options, identity, snapshot);
    const capabilities = readCapabilityMap(snapshot.registry, identity.repository_id);
    return {
      status: ENTRY_CAPABILITIES.every((capabilityId) => capabilities[capabilityId].state !== 'unresolved') ? 'healthy' : 'unresolved',
      actionable: false,
      repository_id: identity.repository_id,
      canonical_remote: identity.canonical_remote,
      registry_revision: snapshot.registry_revision,
      snapshot_hash: snapshot.snapshot_hash,
      capabilities,
      question_bank: null,
      visible_output: false,
      policy_prose: false,
    };
  } catch (error) {
    if (error.code === 'REPOSITORY_ID_SPOOF_ATTEMPT') throw error;
    return safeActionable(error);
  }
}

function questionForCapability(capabilityId, currentState = 'unresolved') {
  const definition = CAPABILITY_DEFINITIONS[capabilityId];
  return {
    capability_id: capabilityId,
    question_id: definition.question_id,
    state: currentState,
    effect_id: definition.effect_id,
    boundary_id: definition.boundary_id,
    choices: definition.choices.map((choice) => ({
      semantic_id: capabilityId + '.' + choice,
      value: choice,
    })),
  };
}

function buildQuestionBank(repositoryId, capabilityIds, currentStates = {}) {
  const unique = [...new Set(capabilityIds)].filter((capabilityId) => CAPABILITIES.includes(capabilityId));
  const questions = CAPABILITIES.filter((capabilityId) => unique.includes(capabilityId))
    .map((capabilityId) => questionForCapability(capabilityId, currentStates[capabilityId] || 'unresolved'));
  return {
    kind: 'repository-capability-question-bank',
    identity_contract: IDENTITY_CONTRACT,
    capability_contract: CAPABILITY_CONTRACT,
    contract_digest: CONTRACT_DIGEST,
    repository_id: repositoryId,
    questions,
  };
}

function probeRepository(options = {}) {
  const result = getRepositoryStatus(options);
  if (result.status === 'actionable') return result;
  const requestedCapabilities = options.includeProtection === true
    ? [...CAPABILITIES]
    : [...ENTRY_CAPABILITIES];
  const unresolved = requestedCapabilities.filter((capabilityId) => result.capabilities[capabilityId].state === 'unresolved');
  if (unresolved.length === 0) {
    return {
      ...result,
      question_bank: null,
      visible_output: false,
      policy_prose: false,
    };
  }
  const bank = buildQuestionBank(result.repository_id, unresolved);
  const sessionMemo = options.sessionMemo;
  const suppressionKey = result.repository_id + ':' + unresolved.join(',');
  if (sessionMemo instanceof Set && sessionMemo.has(suppressionKey)) {
    return {
      ...result,
      question_bank: null,
      suppressed: true,
      visible_output: false,
      policy_prose: false,
    };
  }
  if (sessionMemo instanceof Set) sessionMemo.add(suppressionKey);
  return {
    ...result,
    question_bank: bank,
    visible_output: false,
    policy_prose: false,
  };
}

function assertExpected(expectedRevision, expectedHash) {
  if (!isSafeRevision(expectedRevision)) fail('REGISTRY_CAS_EXPECTATION_REQUIRED');
  if (expectedHash !== null && !isDigest(expectedHash)) fail('REGISTRY_CAS_EXPECTATION_REQUIRED');
}

function assertOwnerAction(ownerAction, repositoryId, capabilityId, channel, operation) {
  if (!isRecord(ownerAction)
    || ownerAction.confirmed !== true
    || ownerAction.category !== 'explicit-owner'
    || ownerAction.channel !== channel
    || !hasOwn(ownerAction, 'operation')
    || !hasOwn(ownerAction, 'choice_semantic_id')
    || !hasOwn(ownerAction, 'contract_digest')
    || !hasOwn(ownerAction, 'scope_digest')) {
    fail('OWNER_ACTION_REQUIRED');
  }
  const expectedChoiceSemanticId = decisionSemanticId(capabilityId, operation);
  if (ownerAction.operation !== operation || ownerAction.choice_semantic_id !== expectedChoiceSemanticId) {
    fail('OWNER_DECISION_BINDING_MISMATCH');
  }
  if (ownerAction.contract_digest !== CONTRACT_DIGEST) fail('OWNER_CONTRACT_MISMATCH');
  if (ownerAction.scope_digest !== scopeDigest(repositoryId, capabilityId, operation, channel)) {
    fail('OWNER_SCOPE_MISMATCH');
  }
}

function operationState(operation) {
  if (operation === 'enable') return { state: 'enabled', decision_kind: 'enable' };
  if (operation === 'decline') return { state: 'disabled', decision_kind: 'decline' };
  if (operation === 'disable') return { state: 'disabled', decision_kind: 'disable' };
  fail('OPERATION_INVALID');
}

function assertTransition(priorState, operation) {
  if (!DECISION_OPERATIONS.includes(operation)) fail('OPERATION_INVALID');
  if (operation === 'decline' && priorState !== 'unresolved') fail('CAPABILITY_TRANSITION_INVALID');
  if (operation === 'disable' && priorState === 'unresolved') fail('CAPABILITY_TRANSITION_INVALID');
}

function createReceipt(repositoryId, capabilityId, priorState, result, revision, provenance, timestamp) {
  const receipt = {
    receipt_id: '',
    repository_id: repositoryId,
    capability_id: capabilityId,
    prior_state: priorState,
    resulting_state: result.state,
    decision_kind: result.decision_kind,
    provenance_category: provenance.category,
    provenance_channel: provenance.channel,
    scope_digest: provenance.scope_digest,
    registry_schema: REGISTRY_SCHEMA,
    identity_contract: IDENTITY_CONTRACT,
    capability_contract: CAPABILITY_CONTRACT,
    contract_digest: CONTRACT_DIGEST,
    registry_revision: revision,
    outcome: 'committed',
    decided_at: timestamp || new Date().toISOString(),
  };
  if (!isIsoTimestamp(receipt.decided_at)) fail('DECISION_TIMESTAMP_INVALID');
  receipt.receipt_id = digestValue(receiptPayload(receipt));
  return receipt;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function registryRecord(registry, repositoryId) {
  let record = registry.repositories.find((entry) => entry.repository_id === repositoryId);
  if (!record) {
    record = { repository_id: repositoryId, capabilities: [] };
    registry.repositories.push(record);
  }
  return record;
}

function applyDecision(registry, repositoryId, capabilityId, operation, provenance, revision, timestamp) {
  const record = registryRecord(registry, repositoryId);
  const existing = record.capabilities.find((entry) => entry.capability_id === capabilityId);
  const priorState = existing ? existing.state : 'unresolved';
  assertTransition(priorState, operation);
  const result = operationState(operation);
  const receipt = createReceipt(repositoryId, capabilityId, priorState, result, revision, provenance, timestamp);
  const nextEntry = {
    capability_id: capabilityId,
    state: result.state,
    decision_kind: result.decision_kind,
    provenance: {
      category: provenance.category,
      channel: provenance.channel,
      scope_digest: provenance.scope_digest,
    },
    receipt,
  };
  const index = record.capabilities.findIndex((entry) => entry.capability_id === capabilityId);
  if (index === -1) record.capabilities.push(nextEntry);
  else record.capabilities[index] = nextEntry;
  record.capabilities.sort((left, right) => CAPABILITIES.indexOf(left.capability_id) - CAPABILITIES.indexOf(right.capability_id));
  registry.repositories.sort((left, right) => left.repository_id.localeCompare(right.repository_id));
}

function ensureStateDirectoryForWrite(registryPath) {
  const directory = path.dirname(registryPath);
  ensureSafeDirectory(directory, true);
}

function readForeignLock(lockPath) {
  let stat;
  try {
    stat = fs.lstatSync(lockPath);
  } catch (_error) {
    fail('REGISTRY_LOCK_INDETERMINATE');
  }
  if (!stat.isFile() || stat.isSymbolicLink()) fail('REGISTRY_LOCK_INDETERMINATE');
  let bytes;
  try {
    bytes = fs.readFileSync(lockPath);
  } catch (_error) {
    fail('REGISTRY_LOCK_INDETERMINATE');
  }
  if (bytes.length > MAX_LOCK_BYTES) fail('REGISTRY_LOCK_INDETERMINATE');
  try {
    const lock = JSON.parse(bytes.toString('utf8'));
    if (!isRecord(lock) || lock.schema !== LOCK_SCHEMA || typeof lock.token !== 'string' || lock.token.length < 16) {
      fail('REGISTRY_LOCK_INDETERMINATE');
    }
  } catch (error) {
    if (error instanceof RegistryError) throw error;
    fail('REGISTRY_LOCK_INDETERMINATE');
  }
  fail('REGISTRY_LOCK_BUSY');
}

function acquireLock(registryPath) {
  const lockPath = lockPathForRegistry(registryPath);
  const token = crypto.randomUUID();
  const payload = JSON.stringify({
    schema: LOCK_SCHEMA,
    token,
    created_at: new Date().toISOString(),
  });
  let descriptor;
  try {
    descriptor = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
  } catch (error) {
    if (error && error.code === 'EEXIST') readForeignLock(lockPath);
    fail('REGISTRY_LOCK_INDETERMINATE');
  }
  try {
    fs.writeFileSync(descriptor, payload, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
  } catch (_error) {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch (_ignored) {}
    }
    fail('REGISTRY_LOCK_INDETERMINATE');
  }
  return { lockPath, token };
}

function injectTestFailure(options, point, code) {
  if (options && options.testOnly === true && options.faultInjection === point) fail(code);
}

function createTransaction(registryPath, lock, registry, expectedHashOverride = null) {
  const expectedHash = expectedHashOverride || snapshotHashForRegistry(registry);
  const markerPath = transactionPathForRegistry(registryPath, lock.token);
  const marker = {
    schema: TRANSACTION_SCHEMA,
    token: lock.token,
    expected_revision: registry.registry_revision,
    expected_hash: expectedHash,
  };
  return {
    markerPath,
    token: lock.token,
    expectedRevision: registry.registry_revision,
    expectedHash,
    markerBytes: Buffer.from(JSON.stringify(marker), 'utf8'),
  };
}

function writeTransactionMarker(transaction) {
  let descriptor = null;
  try {
    descriptor = fs.openSync(
      transaction.markerPath,
      fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY,
      0o600,
    );
    fs.writeSync(descriptor, transaction.markerBytes, 0, transaction.markerBytes.length);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
  } catch (_error) {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch (_ignored) {}
    }
    fail('REGISTRY_TRANSACTION_STAGE_FAILED');
  }
}

function preserveTransactionMarker(transaction) {
  try {
    if (!fs.existsSync(transaction.markerPath)) writeTransactionMarker(transaction);
  } catch (_error) {}
}

function finalizeTransaction(transaction, options) {
  try {
    validateTransactionMarker(transaction);
    injectTestFailure(options, 'transaction-finalize', 'REGISTRY_TRANSACTION_FINALIZE_FAILED');
    fs.unlinkSync(transaction.markerPath);
    if (fs.existsSync(transaction.markerPath)) fail('REGISTRY_TRANSACTION_FINALIZE_FAILED');
  } catch (_error) {
    preserveTransactionMarker(transaction);
    fail('REGISTRY_TRANSACTION_FINALIZE_FAILED');
  }
}

function releaseLock(lock, options = {}) {
  if (!lock) return;
  injectTestFailure(options, 'lock-release', 'REGISTRY_LOCK_RELEASE_FAILED');
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(lock.lockPath, 'utf8'));
  } catch (_error) {
    fail('REGISTRY_LOCK_RELEASE_FAILED');
  }
  if (!isRecord(parsed) || parsed.token !== lock.token) fail('REGISTRY_LOCK_RELEASE_FAILED');
  try {
    fs.unlinkSync(lock.lockPath);
  } catch (_error) {
    fail('REGISTRY_LOCK_RELEASE_FAILED');
  }
}

function fsyncDirectory(directory, options = {}, failurePoint = 'post-rename-durability') {
  injectTestFailure(options, failurePoint, 'REGISTRY_ATOMIC_REPLACE_FAILED');
  if (process.platform === 'win32') return;
  let descriptor;
  try {
    descriptor = fs.openSync(directory, 'r');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
  } catch (_error) {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch (_ignored) {}
    }
    fail('REGISTRY_ATOMIC_REPLACE_FAILED');
  }
}

function atomicCommit(registryPath, registry, options, transaction) {
  const directory = path.dirname(registryPath);
  const tempPath = registryPath + '.tmp-' + crypto.randomUUID().replaceAll('-', '');
  const bytes = Buffer.from(serializeRegistry(registry), 'utf8');
  let descriptor = null;
  try {
    descriptor = fs.openSync(tempPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
    fs.writeSync(descriptor, bytes, 0, bytes.length);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
  } catch (_error) {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch (_ignored) {}
    }
    fail('REGISTRY_STAGE_FAILED');
  }
  writeTransactionMarker(transaction);
  try {
    fsyncDirectory(directory, options, 'pre-rename-marker-durability');
    fs.renameSync(tempPath, registryPath);
    fsyncDirectory(directory, options, 'post-rename-durability');
  } catch (_error) {
    fail('REGISTRY_ATOMIC_REPLACE_FAILED');
  }
  const committed = readSnapshot({ registryPath, testOnly: true }, transaction);
  const readbackFailure = options && options.migrationMode
    ? 'MIGRATION_READBACK_MISMATCH'
    : 'REGISTRY_COMMIT_VERIFY_FAILED';
  injectTestFailure(options, 'post-rename-readback', readbackFailure);
  if (!committed.present
    || committed.registry_revision !== registry.registry_revision
    || committed.snapshot_hash !== snapshotHashForRegistry(registry)) {
    fail(readbackFailure);
  }
  return committed;
}

function commitRegistryWithFinality(registryPath, registry, options, lock, expectedHashOverride = null) {
  let transaction = null;
  let lockReleased = false;
  try {
    transaction = createTransaction(registryPath, lock, registry, expectedHashOverride);
    const committed = atomicCommit(registryPath, registry, options, transaction);
    releaseLock(lock, options);
    lockReleased = true;
    finalizeTransaction(transaction, options);
    return committed;
  } catch (error) {
    if (!lockReleased) {
      try { releaseLock(lock, options); } catch (_ignored) {}
    }
    throw error;
  }
}

function migrationMetadata(source, sourceSnapshotHash, legacyReceipts) {
  const receiptIds = legacyReceipts.map((receipt) => receipt.receipt_id).sort();
  const receiptDigests = legacyReceipts.map((receipt) => digestValue(receipt)).sort();
  return {
    schema: MIGRATION_SCHEMA,
    state: 'completed',
    algorithm: MIGRATION_ALGORITHM,
    source_registry_schema: LEGACY_REGISTRY_SCHEMA,
    source_schema_version: LEGACY_SCHEMA_VERSION,
    source_identity_contract: IDENTITY_CONTRACT,
    source_capability_contract: LEGACY_CAPABILITY_CONTRACT,
    source_contract_digest: LEGACY_CONTRACT_DIGEST,
    source_registry_revision: source.registry_revision,
    source_snapshot_hash: sourceSnapshotHash,
    target_registry_schema: REGISTRY_SCHEMA,
    target_schema_version: SCHEMA_VERSION,
    target_identity_contract: IDENTITY_CONTRACT,
    target_capability_contract: CAPABILITY_CONTRACT,
    target_contract_digest: CONTRACT_DIGEST,
    legacy_receipt_ids: receiptIds,
    legacy_receipt_digests: receiptDigests,
  };
}

function migratedRegistry(source, sourceSnapshotHash) {
  const legacyReceipts = [];
  for (const repository of source.repositories) {
    for (const capability of repository.capabilities) legacyReceipts.push(capability.receipt);
  }
  const target = emptyRegistry();
  target.registry_revision = source.registry_revision;
  target.repositories = clone(source.repositories);
  target.migration = migrationMetadata(source, sourceSnapshotHash, legacyReceipts);
  validateRegistry(target);
  return target;
}

function migrationLockConflict(registryPath) {
  if (!fs.existsSync(lockPathForRegistry(registryPath))) return;
  try {
    readForeignLock(lockPathForRegistry(registryPath));
  } catch (_error) {
    fail('MIGRATION_LOCK_CONFLICT');
  }
  fail('MIGRATION_LOCK_CONFLICT');
}

function migrateLegacyRegistry(options = {}, identity = null, sourceSnapshot = null) {
  const currentIdentity = identity || resolveRepositoryIdentity(options);
  const initial = sourceSnapshot || readSnapshot(options);
  if (!initial.present || initial.legacy !== true) return initial;
  const registryPath = registryPathForOptions(options);
  migrationLockConflict(registryPath);
  let lock;
  try {
    lock = acquireLock(registryPath);
  } catch (error) {
    if (error.code === 'REGISTRY_LOCK_BUSY' || error.code === 'REGISTRY_LOCK_INDETERMINATE') fail('MIGRATION_LOCK_CONFLICT');
    throw error;
  }
  let finalityHandled = false;
  try {
    const current = readSnapshot(options);
    if (!current.present || current.legacy !== true
      || current.registry_revision !== initial.registry_revision
      || current.snapshot_hash !== initial.snapshot_hash) {
      fail('MIGRATION_SOURCE_CHANGED');
    }
    const record = current.registry.repositories.find((entry) => entry.repository_id === currentIdentity.repository_id);
    if (record && record.capabilities.some((capability) => capability.capability_id === 'repository.protection')) {
      fail('LEGACY_SCHEMA_INVALID');
    }
    injectTestFailure(options, 'migration-before-target', 'MIGRATION_INTERRUPTED');
    const target = migratedRegistry(current.registry, current.snapshot_hash);
    injectTestFailure(options, 'migration-before-replace', 'MIGRATION_INTERRUPTED');
    const committed = commitRegistryWithFinality(
      registryPath,
      target,
      { ...options, migrationMode: true },
      lock,
      current.snapshot_hash,
    );
    finalityHandled = true;
    return committed;
  } catch (error) {
    if (error.code === 'REGISTRY_COMMIT_VERIFY_FAILED') error.code = 'MIGRATION_READBACK_MISMATCH';
    if (error.code === 'REGISTRY_TRANSACTION_FINALIZE_FAILED') error.code = 'MIGRATION_INTERRUPTED';
    throw error;
  } finally {
    if (!finalityHandled) {
      try { releaseLock(lock, options); } catch (_ignored) {}
    }
  }
}

function assertRollbackProof(current, beforeBytes, repositoryId) {
  if (!Buffer.isBuffer(beforeBytes) || beforeBytes.length > MAX_REGISTRY_BYTES) fail('ROLLBACK_UNSAFE');
  const before = parseRegistryBytes(beforeBytes);
  if (!before || before.schema !== LEGACY_REGISTRY_SCHEMA) fail('ROLLBACK_UNSAFE');
  const migration = current.registry.migration;
  if (!isRecord(migration) || migration.state !== 'completed'
    || snapshotHashForBytes(beforeBytes) !== migration.source_snapshot_hash
    || before.registry_revision !== migration.source_registry_revision
    || current.registry_revision !== migration.source_registry_revision) fail('ROLLBACK_UNSAFE');
  if (canonicalSerialize(before.repositories) !== canonicalSerialize(current.registry.repositories)) fail('ROLLBACK_UNSAFE');
  if (!before.repositories.some((entry) => entry.repository_id === repositoryId)
    && current.registry.repositories.some((entry) => entry.repository_id === repositoryId)) fail('ROLLBACK_UNSAFE');
  return before;
}

function atomicCommitBytes(registryPath, bytes, options, transaction) {
  const directory = path.dirname(registryPath);
  const tempPath = registryPath + '.tmp-' + crypto.randomUUID().replaceAll('-', '');
  let descriptor = null;
  try {
    descriptor = fs.openSync(tempPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
    fs.writeSync(descriptor, bytes, 0, bytes.length);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
  } catch (_error) {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch (_ignored) {}
    }
    fail('REGISTRY_STAGE_FAILED');
  }
  writeTransactionMarker(transaction);
  try {
    fsyncDirectory(directory, options, 'pre-rename-marker-durability');
    fs.renameSync(tempPath, registryPath);
    fsyncDirectory(directory, options, 'post-rename-durability');
  } catch (_error) {
    fail('REGISTRY_ATOMIC_REPLACE_FAILED');
  }
  const committed = readSnapshot({ registryPath, testOnly: true }, transaction);
  injectTestFailure(options, 'rollback-readback', 'ROLLBACK_UNSAFE');
  if (!committed.present || committed.snapshot_hash !== snapshotHashForBytes(bytes)) fail('ROLLBACK_UNSAFE');
  return committed;
}

function rollbackMigration(options = {}) {
  assertNoCallerIdentityOverride(options);
  const identity = resolveRepositoryIdentity(options);
  const beforeBytes = options.beforeBytes;
  const initial = readSnapshot(options);
  if (!initial.present || initial.legacy === true) fail('ROLLBACK_UNSAFE');
  assertRollbackProof(initial, beforeBytes, identity.repository_id);
  const registryPath = registryPathForOptions(options);
  migrationLockConflict(registryPath);
  let lock;
  try {
    lock = acquireLock(registryPath);
  } catch (error) {
    if (error.code === 'REGISTRY_LOCK_BUSY' || error.code === 'REGISTRY_LOCK_INDETERMINATE') fail('ROLLBACK_UNSAFE');
    throw error;
  }
  let lockReleased = false;
  try {
    const current = readSnapshot(options);
    assertRollbackProof(current, beforeBytes, identity.repository_id);
    injectTestFailure(options, 'rollback-before-replace', 'ROLLBACK_UNSAFE');
    const transaction = createTransaction(registryPath, lock, current.registry, current.snapshot_hash);
    const committed = atomicCommitBytes(registryPath, beforeBytes, options, transaction);
    releaseLock(lock, options);
    lockReleased = true;
    finalizeTransaction(transaction, options);
    return {
      status: 'rolled_back',
      repository_id: identity.repository_id,
      registry_revision: committed.registry_revision,
      snapshot_hash: committed.snapshot_hash,
    };
  } finally {
    if (!lockReleased) {
      try { releaseLock(lock, options); } catch (_ignored) {}
    }
  }
}

function previewMigrationRollback(options = {}) {
  try {
    const identity = resolveRepositoryIdentity(options);
    const current = readSnapshot(options);
    assertRollbackProof(current, options.beforeBytes, identity.repository_id);
    return { status: 'safe', repository_id: identity.repository_id, reason_code: null };
  } catch (error) {
    return { status: 'blocked', repository_id: null, reason_code: error.code || 'ROLLBACK_UNSAFE' };
  }
}

function currentSnapshotForMutation(options) {
  const snapshot = readSnapshot(options);
  if (snapshot.legacy === true) fail('MIGRATION_REQUIRED');
  assertExpected(options.expectedRevision, options.expectedHash);
  if (snapshot.registry_revision !== options.expectedRevision || snapshot.snapshot_hash !== options.expectedHash) {
    fail('REGISTRY_CAS_MISMATCH');
  }
  return snapshot;
}

function writeCapabilityDecision(options = {}) {
  assertNoCallerIdentityOverride(options);
  const capabilityId = options.capabilityId;
  if (!CAPABILITIES.includes(capabilityId)) fail('CAPABILITY_INVALID');
  if (!DECISION_OPERATIONS.includes(options.operation)) fail('OPERATION_INVALID');
  const identity = resolveRepositoryIdentity(options);
  assertOwnerAction(options.ownerAction, identity.repository_id, capabilityId, 'capability-route', options.operation);
  assertExpected(options.expectedRevision, options.expectedHash);
  const registryPath = registryPathForOptions(options);
  const before = readSnapshot(options);
  if (before.registry_revision !== options.expectedRevision || before.snapshot_hash !== options.expectedHash) fail('REGISTRY_CAS_MISMATCH');
  ensureStateDirectoryForWrite(registryPath);
  const lock = acquireLock(registryPath);
  let finalityHandled = false;
  try {
    const current = currentSnapshotForMutation(options);
    const registry = current.present ? clone(current.registry) : emptyRegistry();
    const nextRevision = current.registry_revision + 1;
    if (!isSafeRevision(nextRevision)) fail('REGISTRY_REVISION_INVALID');
    applyDecision(registry, identity.repository_id, capabilityId, options.operation, {
      category: 'explicit-owner',
      channel: 'capability-route',
      scope_digest: options.ownerAction.scope_digest,
    }, nextRevision, options.decisionTimestamp);
    registry.registry_revision = nextRevision;
    validateRegistry(registry);
    const committed = commitRegistryWithFinality(registryPath, registry, options, lock);
    finalityHandled = true;
    const record = committed.registry.repositories.find((entry) => entry.repository_id === identity.repository_id);
    const entry = record.capabilities.find((candidate) => candidate.capability_id === capabilityId);
    return {
      status: 'committed',
      repository_id: identity.repository_id,
      capability_id: capabilityId,
      state: entry.state,
      registry_revision: committed.registry_revision,
      receipt_id: entry.receipt.receipt_id,
    };
  } finally {
    if (!finalityHandled) {
      try { releaseLock(lock, options); } catch (_ignored) {}
    }
  }
}

function validateQuestionBank(bank, repositoryId, unresolved) {
  if (!isRecord(bank)
    || !exactKeys(bank, ['kind', 'identity_contract', 'capability_contract', 'contract_digest', 'repository_id', 'questions'])
    || bank.kind !== 'repository-capability-question-bank'
    || bank.identity_contract !== IDENTITY_CONTRACT
    || bank.capability_contract !== CAPABILITY_CONTRACT
    || bank.repository_id !== repositoryId
    || bank.contract_digest !== CONTRACT_DIGEST
    || !Array.isArray(bank.questions)) {
    fail('COMBINED_ANSWER_INVALID');
  }
  const expectedIds = CAPABILITIES.filter((capabilityId) => unresolved.includes(capabilityId));
  if (bank.questions.length !== expectedIds.length) fail('COMBINED_ANSWER_STALE');
  const seen = new Set();
  const validatedQuestions = new Map();
  for (const question of bank.questions) {
    if (!isRecord(question) || !CAPABILITIES.includes(question.capability_id) || seen.has(question.capability_id)) {
      fail('COMBINED_ANSWER_INVALID');
    }
    seen.add(question.capability_id);
    const expected = questionForCapability(question.capability_id, 'unresolved');
    if (!exactKeys(question, ['capability_id', 'question_id', 'state', 'effect_id', 'boundary_id', 'choices'])
      || question.question_id !== expected.question_id
      || question.state !== expected.state
      || question.effect_id !== expected.effect_id
      || question.boundary_id !== expected.boundary_id
      || !Array.isArray(question.choices)
      || question.choices.length !== expected.choices.length) {
      fail('COMBINED_ANSWER_INVALID');
    }
    const actualChoices = question.choices.map((choice) => {
      if (!exactKeys(choice, ['semantic_id', 'value'])) fail('COMBINED_ANSWER_INVALID');
      return { semantic_id: choice.semantic_id, value: choice.value };
    }).sort((left, right) => left.semantic_id.localeCompare(right.semantic_id));
    const expectedChoices = expected.choices.map((choice) => ({
      semantic_id: choice.semantic_id,
      value: choice.value,
    })).sort((left, right) => left.semantic_id.localeCompare(right.semantic_id));
    if (canonicalSerialize(actualChoices) !== canonicalSerialize(expectedChoices)) {
      fail('COMBINED_ANSWER_INVALID');
    }
    validatedQuestions.set(question.capability_id, expected);
  }
  if (expectedIds.some((capabilityId) => !seen.has(capabilityId))) fail('COMBINED_ANSWER_STALE');
  return validatedQuestions;
}

function writeCombinedDecisions(options = {}) {
  assertNoCallerIdentityOverride(options);
  if (!Array.isArray(options.answers) || options.answers.length === 0) fail('COMBINED_ANSWER_ABANDONED');
  const identity = resolveRepositoryIdentity(options);
  assertExpected(options.expectedRevision, options.expectedHash);
  const before = readSnapshot(options);
  if (before.registry_revision !== options.expectedRevision || before.snapshot_hash !== options.expectedHash) fail('REGISTRY_CAS_MISMATCH');
  const states = readCapabilityMap(before.registry, identity.repository_id);
  const requestedIds = options.bank && Array.isArray(options.bank.questions)
    ? options.bank.questions.map((question) => question && question.capability_id)
    : [...ENTRY_CAPABILITIES];
  if (requestedIds.length === 0 || requestedIds.some((capabilityId) => !CAPABILITIES.includes(capabilityId))
    || new Set(requestedIds).size !== requestedIds.length) fail('COMBINED_ANSWER_INVALID');
  const unresolved = requestedIds.filter((capabilityId) => states[capabilityId].state === 'unresolved');
  const validatedQuestions = validateQuestionBank(options.bank, identity.repository_id, unresolved);
  if (options.answers.length !== unresolved.length) fail('COMBINED_ANSWER_PARTIAL');
  const answerIds = new Set();
  for (const answer of options.answers) {
    if (!isRecord(answer)
      || !exactKeys(answer, ['capability_id', 'operation', 'choice_semantic_id', 'ownerAction'])
      || !CAPABILITIES.includes(answer.capability_id)
      || answerIds.has(answer.capability_id)) fail('COMBINED_ANSWER_INVALID');
    answerIds.add(answer.capability_id);
    if (!unresolved.includes(answer.capability_id) || !COMBINED_OPERATIONS.includes(answer.operation)) fail('COMBINED_ANSWER_INVALID');
    const question = validatedQuestions.get(answer.capability_id);
    const selectedChoice = question.choices.find((choice) => choice.value === answer.operation);
    if (!selectedChoice || answer.choice_semantic_id !== selectedChoice.semantic_id) fail('COMBINED_ANSWER_INVALID');
    assertOwnerAction(answer.ownerAction, identity.repository_id, answer.capability_id, 'combined-bank', answer.operation);
  }
  if (answerIds.size !== unresolved.length || unresolved.some((capabilityId) => !answerIds.has(capabilityId))) fail('COMBINED_ANSWER_PARTIAL');

  const registryPath = registryPathForOptions(options);
  ensureStateDirectoryForWrite(registryPath);
  const lock = acquireLock(registryPath);
  let finalityHandled = false;
  try {
    const current = currentSnapshotForMutation(options);
    const currentStates = readCapabilityMap(current.registry, identity.repository_id);
    const currentUnresolved = requestedIds.filter((capabilityId) => currentStates[capabilityId].state === 'unresolved');
    if (currentUnresolved.join(',') !== unresolved.join(',')) fail('COMBINED_ANSWER_STALE');
    const registry = current.present ? clone(current.registry) : emptyRegistry();
    const nextRevision = current.registry_revision + 1;
    if (!isSafeRevision(nextRevision)) fail('REGISTRY_REVISION_INVALID');
    for (const answer of options.answers) {
      applyDecision(registry, identity.repository_id, answer.capability_id, answer.operation, {
        category: 'explicit-owner',
        channel: 'combined-bank',
        scope_digest: answer.ownerAction.scope_digest,
      }, nextRevision, options.decisionTimestamp);
    }
    registry.registry_revision = nextRevision;
    validateRegistry(registry);
    const committed = commitRegistryWithFinality(registryPath, registry, options, lock);
    finalityHandled = true;
    return {
      status: 'committed',
      repository_id: identity.repository_id,
      registry_revision: committed.registry_revision,
      capabilities: readCapabilityMap(committed.registry, identity.repository_id),
    };
  } finally {
    if (!finalityHandled) {
      try { releaseLock(lock, options); } catch (_ignored) {}
    }
  }
}

function setupCapability(options = {}) {
  assertNoCallerIdentityOverride(options);
  if (!CAPABILITIES.includes(options.capabilityId)) fail('CAPABILITY_INVALID');
  const result = getRepositoryStatus(options);
  if (result.status === 'actionable') return result;
  const currentState = result.capabilities[options.capabilityId].state;
  return {
    status: 'setup',
    repository_id: result.repository_id,
    registry_revision: result.registry_revision,
    snapshot_hash: result.snapshot_hash,
    writes: 0,
    question_bank: buildQuestionBank(result.repository_id, [options.capabilityId], {
      [options.capabilityId]: currentState,
    }),
    visible_output: false,
    policy_prose: false,
  };
}

function reopenCapability(options = {}) {
  assertNoCallerIdentityOverride(options);
  if (!CAPABILITIES.includes(options.capabilityId)) fail('CAPABILITY_INVALID');
  const result = getRepositoryStatus(options);
  if (result.status === 'actionable') return result;
  assertOwnerAction(options.ownerAction, result.repository_id, options.capabilityId, 'capability-route', 'reopen');
  return {
    status: 'reopen',
    repository_id: result.repository_id,
    capability_id: options.capabilityId,
    registry_revision: result.registry_revision,
    snapshot_hash: result.snapshot_hash,
    writes: 0,
    question_bank: buildQuestionBank(result.repository_id, [options.capabilityId], {
      [options.capabilityId]: result.capabilities[options.capabilityId].state,
    }),
    visible_output: false,
    policy_prose: false,
  };
}

module.exports = {
  REGISTRY_SCHEMA,
  LEGACY_REGISTRY_SCHEMA,
  LEGACY_CAPABILITY_CONTRACT,
  LEGACY_CONTRACT_DIGEST,
  MIGRATION_SCHEMA,
  REMOTE_IDENTITY_CONTRACT_VERSION: a1.REMOTE_IDENTITY_CONTRACT_VERSION,
  IDENTITY_CONTRACT,
  CAPABILITY_CONTRACT,
  SCHEMA_VERSION,
  MAX_REGISTRY_BYTES,
  MAX_REPOSITORIES,
  MAX_CAPABILITIES_PER_REPOSITORY,
  LOCK_SCHEMA,
  REGISTRY_BASENAME,
  CAPABILITIES,
  ENTRY_CAPABILITIES,
  PROTECTION_SCOPES,
  BINDING_OPERATIONS,
  DURABLE_STATES,
  RUNTIME_STATES,
  CONTRACT_SEMANTICS,
  CONTRACT_DIGEST,
  canonicalSerialize,
  contractDigest,
  authoritySemanticsForTest,
  capabilityDecisionSemanticId: decisionSemanticId,
  capabilityScopeDigest: scopeDigest,
  snapshotHashForTest: snapshotHashForRegistry,
  lockPathForTest: lockPathForRegistry,
  emptyRegistry,
  parseRegistryBytes,
  validateRegistry,
  validateLegacyRegistry,
  repositoryIdForCanonicalRemote,
  resolveRepositoryIdentity,
  getRepositoryStatus,
  status: getRepositoryStatus,
  probeRepository,
  setupCapability,
  reopenCapability,
  writeCapabilityDecision,
  writeCombinedDecisions,
  migrateLegacyRegistry,
  rollbackMigration,
  previewMigrationRollback,
};
function validateTransactionMarker(transaction) {
  let stat;
  try {
    stat = fs.lstatSync(transaction.markerPath);
  } catch (_error) {
    fail('REGISTRY_INTERRUPTED_TRANSACTION');
  }
  if (!stat.isFile() || stat.isSymbolicLink()) fail('REGISTRY_INTERRUPTED_TRANSACTION');
  let bytes;
  try {
    bytes = fs.readFileSync(transaction.markerPath);
  } catch (_error) {
    fail('REGISTRY_INTERRUPTED_TRANSACTION');
  }
  if (bytes.length > MAX_TRANSACTION_BYTES) fail('REGISTRY_INTERRUPTED_TRANSACTION');
  let marker;
  try {
    marker = JSON.parse(bytes.toString('utf8'));
  } catch (_error) {
    fail('REGISTRY_INTERRUPTED_TRANSACTION');
  }
  if (!exactKeys(marker, ['schema', 'token', 'expected_revision', 'expected_hash'])
    || marker.schema !== TRANSACTION_SCHEMA
    || marker.token !== transaction.token
    || marker.expected_revision !== transaction.expectedRevision
    || marker.expected_hash !== transaction.expectedHash) {
    fail('REGISTRY_INTERRUPTED_TRANSACTION');
  }
}
