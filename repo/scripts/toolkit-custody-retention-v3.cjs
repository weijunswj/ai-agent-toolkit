'use strict';

// Deterministic retention planning over Toolkit's existing manifest, evidence
// references, custody references, and consumer receipts. The only effect path
// here is an explicitly branded in-memory fixture; it never deletes a real
// resource or supplies native permission.

const { canonicalSerialize, digestValue, assertAuthenticAuthorityPacketStore,
  assertAuthenticSemanticGateAdmission } = require('./toolkit-github-program-receipt.cjs');

const LEGACY_RETENTION_VIEW_SCHEMA = 'toolkit.custody.retention-view.v1';
const RETENTION_VIEW_SCHEMA = 'toolkit.custody.retention-view.v2';
const DISPOSAL_RECEIPT_SCHEMA = 'toolkit.custody.disposal-receipt.v2';
const GIT_EXPIRY_RECEIPT_SCHEMA = 'toolkit.custody.git-expiry-receipt.v1';
const DISPOSAL_OBSERVATION_SCHEMA = 'toolkit.custody.disposal-observation.v1';
const REMOTE_BULK_RETENTION_MS = 21 * 24 * 60 * 60 * 1000;
const LEGACY_REMOTE_BULK_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const TRANSFER_RETENTION_MS = 21 * 24 * 60 * 60 * 1000;
const MAX_TRANSFER_STORAGE_ENTRIES = 64;
const MAX_TRANSFER_STORAGE_BYTES = 32 * 1024 * 1024;
const MAX_DISPOSAL_ENTRIES = 64;
const MAX_DISPOSAL_FILES = 16;
const MAX_DISPOSAL_BYTES = 1024 * 1024;
const MAX_GIT_DISPOSAL_BYTES = 8 * 1024 * 1024;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:+/@#-]{0,511}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const FIXTURE_BACKEND_ID = 'task-fixture-backend';
const FIXTURE_PATH_PREFIX = '/task59-fixture/';
const FIXTURE_BACKENDS = new WeakSet();
const FIXTURE_BACKEND_CONTROLS = new WeakMap();
const HOLD = Object.freeze({
  BACKEND_FACTS_UNKNOWN: 'BACKEND_FACTS_UNKNOWN',
  TARGET_OBSERVATION_UNKNOWN: 'TARGET_OBSERVATION_UNKNOWN',
  TARGET_DRIFT: 'TARGET_DRIFT',
  OWNERSHIP_UNKNOWN: 'OWNERSHIP_UNKNOWN',
  CUSTODY_UNVERIFIED: 'CUSTODY_UNVERIFIED',
  CONSUMER_READBACK_UNVERIFIED: 'CONSUMER_READBACK_UNVERIFIED',
  CONSUMER_INVENTORY_UNKNOWN: 'CONSUMER_INVENTORY_UNKNOWN',
  CONSUMER_ACTIVE: 'CONSUMER_ACTIVE',
  CONSUMER_STATE_UNKNOWN: 'CONSUMER_STATE_UNKNOWN',
  DEPENDENCY_UNKNOWN: 'DEPENDENCY_UNKNOWN',
  DEPENDENCY_TARGET_UNKNOWN: 'DEPENDENCY_TARGET_UNKNOWN',
  DEPENDENCY_OVERLAP: 'DEPENDENCY_OVERLAP',
  DEPENDENCY_RELEASE_UNVERIFIED: 'DEPENDENCY_RELEASE_UNVERIFIED',
  ALIAS_RESOLUTION_UNKNOWN: 'ALIAS_RESOLUTION_UNKNOWN',
  RETENTION_PIN_ACTIVE: 'RETENTION_PIN_ACTIVE',
  RETENTION_PIN_UNKNOWN: 'RETENTION_PIN_UNKNOWN',
  FACT_FROM_FUTURE: 'FACT_FROM_FUTURE',
  TRANSFER_ANCHOR_UNKNOWN: 'TRANSFER_ANCHOR_UNKNOWN',
  DISPOSAL_TARGET_UNKNOWN: 'DISPOSAL_TARGET_UNKNOWN',
  CLEANUP_OPERATION_PENDING: 'CLEANUP_OPERATION_PENDING',
  LEGACY_EFFECT_BLOCKED: 'LEGACY_EFFECT_BLOCKED'
});

class RetentionError extends Error {
  constructor(code) {
    super(code);
    this.name = 'RetentionError';
    this.code = code;
  }
}

function fail(code) {
  throw new RetentionError(code);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys, optional = []) {
  if (!isRecord(value)) return false;
  const allowed = new Set([...keys, ...optional]);
  return keys.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => allowed.has(key));
}

function safeId(value) {
  return typeof value === 'string' && SAFE_ID.test(value);
}

function digest(value) {
  return typeof value === 'string' && SHA256.test(value);
}

function compareCanonical(left, right) {
  const a = canonicalSerialize(left);
  const b = canonicalSerialize(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function timestamp(value) {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return ms;
}

function canonicalPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.includes('\\')
    || value.includes('\u0000') || value.includes('//') || (value.length > 1 && value.endsWith('/'))) {
    fail('RETENTION_TARGET_IDENTITY_INVALID');
  }
  if (value === '/') return value;
  const parts = value.slice(1).split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) fail('RETENTION_TARGET_IDENTITY_INVALID');
  return value;
}

function normalizeLeafIdentity(value) {
  if (!exactKeys(value, ['backend_id', 'resource_id', 'path'])) fail('RETENTION_TARGET_IDENTITY_INVALID');
  if (!safeId(value.backend_id) || !safeId(value.resource_id)) fail('RETENTION_TARGET_IDENTITY_INVALID');
  return { backend_id: value.backend_id, resource_id: value.resource_id, path: canonicalPath(value.path) };
}

function normalizeTargetIdentity(value) {
  if (!exactKeys(value, ['backend_id', 'resource_id', 'path'], ['mount_members'])) {
    fail('RETENTION_TARGET_IDENTITY_INVALID');
  }
  const base = normalizeLeafIdentity({ backend_id: value.backend_id, resource_id: value.resource_id, path: value.path });
  const members = value.mount_members === undefined ? [] : value.mount_members;
  if (!Array.isArray(members) || members.length > 128) fail('RETENTION_TARGET_IDENTITY_INVALID');
  const normalizedMembers = members.map(normalizeLeafIdentity)
    .sort(compareCanonical);
  if (new Set(normalizedMembers.map(canonicalSerialize)).size !== normalizedMembers.length) {
    fail('RETENTION_TARGET_IDENTITY_INVALID');
  }
  return { ...base, mount_members: normalizedMembers };
}

function targetDigest(value) {
  return digestValue(normalizeTargetIdentity(value));
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function backendFacts(manifest) {
  const facts = new Map();
  if (!Array.isArray(manifest.backend_facts)) return facts;
  for (const fact of manifest.backend_facts) {
    if (!exactKeys(fact, ['backend_id', 'path_case', 'observed_at', 'evidence_digest'])
      || !safeId(fact.backend_id) || !['SENSITIVE', 'INSENSITIVE'].includes(fact.path_case)
      || timestamp(fact.observed_at) === null
      || fact.evidence_digest !== digestValue({
        backend_id: fact.backend_id,
        path_case: fact.path_case,
        observed_at: fact.observed_at
      }) || facts.has(fact.backend_id)) continue;
    facts.set(fact.backend_id, fact);
  }
  return facts;
}

function identityParts(identity) {
  return [
    { backend_id: identity.backend_id, resource_id: identity.resource_id, path: identity.path },
    ...identity.mount_members
  ];
}

function foldedPath(pathValue, pathCase) {
  return pathCase === 'INSENSITIVE' ? pathValue.toLowerCase() : pathValue;
}

function isAncestorPath(parent, child) {
  if (parent === '/') return true;
  return child === parent || child.startsWith(`${parent}/`);
}

function identityOverlaps(left, right, facts) {
  for (const a of identityParts(left)) {
    for (const b of identityParts(right)) {
      if (a.backend_id !== b.backend_id || a.resource_id !== b.resource_id) continue;
      const fact = facts.get(a.backend_id);
      if (!fact) return null;
      const aPath = foldedPath(a.path, fact.path_case);
      const bPath = foldedPath(b.path, fact.path_case);
      if (isAncestorPath(aPath, bPath) || isAncestorPath(bPath, aPath)) return true;
    }
  }
  return false;
}

function validateTargetObservation(artifact, expected, observed, facts, now, reasons) {
  const fact = facts.get(expected.backend_id);
  if (!fact || !facts.has(observed.backend_id)
    || [...identityParts(expected), ...identityParts(observed)].some((part) => !facts.has(part.backend_id))) {
    reasons.add(HOLD.BACKEND_FACTS_UNKNOWN);
    return;
  }
  if (!exactKeys(artifact.target_observation, ['backend_id', 'observed_at', 'identity_digest', 'evidence_digest'])
    || artifact.target_observation.backend_id !== observed.backend_id
    || artifact.target_observation.identity_digest !== targetDigest(observed)
    || timestamp(artifact.target_observation.observed_at) === null
    || artifact.target_observation.evidence_digest !== digestValue({
      backend_id: artifact.target_observation.backend_id,
      observed_at: artifact.target_observation.observed_at,
      identity_digest: artifact.target_observation.identity_digest
    })) {
    reasons.add(HOLD.TARGET_OBSERVATION_UNKNOWN);
    return;
  }
  if (timestamp(fact.observed_at) > now || timestamp(artifact.target_observation.observed_at) > now) {
    reasons.add(HOLD.FACT_FROM_FUTURE);
  }
  if (canonicalSerialize(expected) !== canonicalSerialize(observed)
    && !targetAliasEquivalent(artifact, expected, observed, facts, now, reasons)) reasons.add(HOLD.TARGET_DRIFT);
}

function targetAliasEquivalent(artifact, expected, observed, facts, now, reasons) {
  const resolution = artifact.target_alias_resolution;
  if (resolution === undefined) return false;
  const aliasReasons = new Set();
  const candidates = identityResolution(observed, resolution, facts, now, aliasReasons);
  for (const reason of aliasReasons) reasons.add(reason);
  if (!candidates || !Object.hasOwn(resolution, 'equivalence_pairs')) return false;
  const expectedKey = canonicalSerialize(expected);
  const observedKey = canonicalSerialize(observed);
  if (candidates.length !== 2 || !candidates.some((item) => canonicalSerialize(item) === expectedKey)
    || !candidates.some((item) => canonicalSerialize(item) === observedKey)) return false;
  const leftDigest = targetDigest(expected) < targetDigest(observed) ? targetDigest(expected) : targetDigest(observed);
  const rightDigest = targetDigest(expected) < targetDigest(observed) ? targetDigest(observed) : targetDigest(expected);
  const exactPair = resolution.equivalence_pairs.some((pair) => pair.left_target_digest === leftDigest
    && pair.right_target_digest === rightDigest);
  if (!exactPair) return false;
  const descriptors = artifact.observer_descriptors;
  if (!Array.isArray(descriptors)) return false;
  const expectedObservers = descriptors.filter((item) => item.target_identity_digest === targetDigest(expected));
  const observedObservers = descriptors.filter((item) => item.target_identity_digest === targetDigest(observed));
  return expectedObservers.some((left) => observedObservers.some((right) => left.observer_id !== right.observer_id));
}

function identityResolution(baseIdentity, resolution, facts, now, reasons) {
  if (resolution === undefined || resolution === null) return [baseIdentity];
  if (!exactKeys(resolution, ['state'], ['candidates', 'observed_at', 'evidence_digest', 'equivalence_pairs'])) {
    reasons.add(HOLD.ALIAS_RESOLUTION_UNKNOWN);
    return null;
  }
  if (resolution.state === 'UNKNOWN') {
    reasons.add(HOLD.ALIAS_RESOLUTION_UNKNOWN);
    return null;
  }
  if (resolution.state !== 'FINITE' || !Array.isArray(resolution.candidates)
    || resolution.candidates.length === 0 || resolution.candidates.length > 128
    || timestamp(resolution.observed_at) === null) {
    reasons.add(HOLD.ALIAS_RESOLUTION_UNKNOWN);
    return null;
  }
  let candidates;
  try {
    candidates = resolution.candidates.map(normalizeTargetIdentity)
      .sort(compareCanonical);
  } catch (_) {
    reasons.add(HOLD.ALIAS_RESOLUTION_UNKNOWN);
    return null;
  }
  const uniqueCandidates = [...new Map(candidates.map((item) => [canonicalSerialize(item), item])).values()];
  const baseKey = canonicalSerialize(baseIdentity);
  const payload = {
    identity_digest: targetDigest(baseIdentity),
    candidates: uniqueCandidates,
    observed_at: resolution.observed_at
  };
  if (Object.hasOwn(resolution, 'equivalence_pairs')) {
    const pairs = resolution.equivalence_pairs;
    if (!Array.isArray(pairs) || pairs.length === 0 || pairs.length > 128) {
      reasons.add(HOLD.ALIAS_RESOLUTION_UNKNOWN);
      return null;
    }
    const candidateDigests = new Set(uniqueCandidates.map(targetDigest));
    const seenPairs = new Set();
    for (const pair of pairs) {
      if (!exactKeys(pair, ['left_target_digest', 'right_target_digest'])
        || !digest(pair.left_target_digest) || !digest(pair.right_target_digest)
        || pair.left_target_digest >= pair.right_target_digest
        || !candidateDigests.has(pair.left_target_digest) || !candidateDigests.has(pair.right_target_digest)) {
        reasons.add(HOLD.ALIAS_RESOLUTION_UNKNOWN);
        return null;
      }
      const key = canonicalSerialize(pair);
      if (seenPairs.has(key)) {
        reasons.add(HOLD.ALIAS_RESOLUTION_UNKNOWN);
        return null;
      }
      seenPairs.add(key);
    }
    const sortedPairs = [...pairs].sort(compareCanonical);
    if (canonicalSerialize(sortedPairs) !== canonicalSerialize(pairs)) {
      reasons.add(HOLD.ALIAS_RESOLUTION_UNKNOWN);
      return null;
    }
    payload.equivalence_pairs = pairs;
  }
  if (!uniqueCandidates.some((item) => canonicalSerialize(item) === baseKey)
    || resolution.evidence_digest !== digestValue(payload) || timestamp(resolution.observed_at) > now) {
    reasons.add(HOLD.ALIAS_RESOLUTION_UNKNOWN);
    return null;
  }
  if (uniqueCandidates.some((item) => identityParts(item).some((part) => !facts.has(part.backend_id)))) {
    reasons.add(HOLD.BACKEND_FACTS_UNKNOWN);
    return null;
  }
  return uniqueCandidates;
}

function expectedDigest(payload, supplied) {
  return digest(supplied) && supplied === digestValue(payload);
}

function verifyOwnership(artifact, artifactId, target, now, reasons) {
  const value = artifact.ownership;
  if (!exactKeys(value, ['owner_id', 'observed_at', 'evidence_digest']) || !safeId(value.owner_id)
    || timestamp(value.observed_at) === null
    || !expectedDigest({ artifact_id: artifactId, owner_id: value.owner_id, target_digest: targetDigest(target), observed_at: value.observed_at }, value.evidence_digest)) {
    reasons.add(HOLD.OWNERSHIP_UNKNOWN);
    return null;
  }
  if (timestamp(value.observed_at) > now) reasons.add(HOLD.FACT_FROM_FUTURE);
  return value.owner_id;
}

function verifyCustody(artifact, artifactId, now, reasons) {
  const evidence = artifact.evidence_reference;
  const custody = artifact.custody_reference;
  const verifiedAt = artifact.custody_verified_at;
  if (!exactKeys(evidence, ['evidence_id', 'content_digest']) || !safeId(evidence.evidence_id)
    || !digest(evidence.content_digest)
    || !exactKeys(custody, ['evidence_id', 'custody_id', 'custody_digest', 'retention_status'])
    || custody.evidence_id !== evidence.evidence_id || !safeId(custody.custody_id)
    || custody.retention_status !== 'HELD' || !digest(custody.custody_digest)
    || custody.custody_digest !== digestValue({
      evidence_id: custody.evidence_id,
      custody_id: custody.custody_id,
      retention_status: custody.retention_status
    }) || timestamp(verifiedAt) === null) {
    reasons.add(HOLD.CUSTODY_UNVERIFIED);
    return null;
  }
  if (timestamp(verifiedAt) > now) reasons.add(HOLD.FACT_FROM_FUTURE);
  const readback = artifact.consumer_readback;
  if (!exactKeys(readback, ['consumer_id', 'evidence_id', 'custody_id', 'content_digest', 'retrieved_at', 'readback_digest'])
    || !safeId(readback.consumer_id) || readback.evidence_id !== evidence.evidence_id
    || readback.custody_id !== custody.custody_id || readback.content_digest !== evidence.content_digest
    || timestamp(readback.retrieved_at) === null
    || !expectedDigest({
      consumer_id: readback.consumer_id,
      evidence_id: readback.evidence_id,
      custody_id: readback.custody_id,
      content_digest: readback.content_digest,
      retrieved_at: readback.retrieved_at
    }, readback.readback_digest)) {
    reasons.add(HOLD.CONSUMER_READBACK_UNVERIFIED);
    return null;
  }
  if (timestamp(readback.retrieved_at) > now) reasons.add(HOLD.FACT_FROM_FUTURE);
  return { verified_at: verifiedAt, retrieved_at: readback.retrieved_at, evidence_id: evidence.evidence_id,
    content_digest: evidence.content_digest, custody_id: custody.custody_id,
    readback_digest: readback.readback_digest, readback_consumer_id: readback.consumer_id };
}

function validateConsumerRelease(consumer, custodyFacts, now, reasons) {
  if (!isRecord(consumer) || !safeId(consumer.consumer_id)) {
    reasons.add(HOLD.CONSUMER_STATE_UNKNOWN);
    return null;
  }
  if (consumer.state === 'ACTIVE') {
    if (!exactKeys(consumer, ['consumer_id', 'state'])) reasons.add(HOLD.CONSUMER_STATE_UNKNOWN);
    reasons.add(HOLD.CONSUMER_ACTIVE);
    return null;
  }
  if (consumer.state === 'UNKNOWN') {
    if (!exactKeys(consumer, ['consumer_id', 'state'])) reasons.add(HOLD.CONSUMER_INVENTORY_UNKNOWN);
    reasons.add(HOLD.CONSUMER_STATE_UNKNOWN);
    return null;
  }
  if (consumer.state === 'RELEASED') {
    if (!exactKeys(consumer, ['consumer_id', 'state', 'released_at', 'release_evidence_digest'])
      || timestamp(consumer.released_at) === null
      || !expectedDigest({ consumer_id: consumer.consumer_id, state: 'RELEASED', released_at: consumer.released_at }, consumer.release_evidence_digest)) {
      reasons.add(HOLD.CONSUMER_STATE_UNKNOWN);
      return null;
    }
    if (timestamp(consumer.released_at) > now) reasons.add(HOLD.FACT_FROM_FUTURE);
    return timestamp(consumer.released_at);
  }
  if (consumer.state === 'TRANSFERRED') {
    if (!exactKeys(consumer, ['consumer_id', 'state', 'transferred_at', 'successor_id', 'successor_readback_digest',
      'evidence_id', 'custody_id', 'content_digest', 'transfer_evidence_digest'])
      || !safeId(consumer.successor_id) || consumer.successor_id !== custodyFacts.readback_consumer_id
      || consumer.evidence_id !== custodyFacts.evidence_id || consumer.custody_id !== custodyFacts.custody_id
      || consumer.content_digest !== custodyFacts.content_digest
      || timestamp(consumer.transferred_at) === null
      || !digest(consumer.successor_readback_digest)
      || consumer.successor_readback_digest !== custodyFacts.readback_digest
      || !expectedDigest({
        consumer_id: consumer.consumer_id,
        state: 'TRANSFERRED',
        transferred_at: consumer.transferred_at,
        successor_id: consumer.successor_id,
        successor_readback_digest: consumer.successor_readback_digest,
        evidence_id: custodyFacts.evidence_id,
        custody_id: custodyFacts.custody_id,
        content_digest: custodyFacts.content_digest
      }, consumer.transfer_evidence_digest)) {
      reasons.add(HOLD.CONSUMER_STATE_UNKNOWN);
      return null;
    }
    if (timestamp(consumer.transferred_at) > now) reasons.add(HOLD.FACT_FROM_FUTURE);
    return timestamp(consumer.transferred_at);
  }
  reasons.add(HOLD.CONSUMER_STATE_UNKNOWN);
  return null;
}

function verifyDependencies(artifact, facts, now, reasons) {
  if (!Array.isArray(artifact.dependencies)) {
    reasons.add(HOLD.DEPENDENCY_UNKNOWN);
    return;
  }
  for (const dependency of artifact.dependencies) {
    if (!isRecord(dependency) || !safeId(dependency.dependency_id)) {
      reasons.add(HOLD.DEPENDENCY_UNKNOWN);
      continue;
    }
    if (dependency.state === 'UNKNOWN') {
      reasons.add(HOLD.DEPENDENCY_UNKNOWN);
      continue;
    }
    if (dependency.state === 'RELEASED') {
      const target = dependency.target_identity === null ? null : (() => {
        try { return normalizeTargetIdentity(dependency.target_identity); } catch (_) { return null; }
      })();
      if (dependency.target_identity !== null && !target) {
        reasons.add(HOLD.DEPENDENCY_RELEASE_UNVERIFIED);
        continue;
      }
      if (timestamp(dependency.released_at) === null || !expectedDigest({
        dependency_id: dependency.dependency_id,
        state: 'RELEASED',
        released_at: dependency.released_at,
        target_digest: target ? targetDigest(target) : null
      }, dependency.release_evidence_digest)) reasons.add(HOLD.DEPENDENCY_RELEASE_UNVERIFIED);
      else if (timestamp(dependency.released_at) > now) reasons.add(HOLD.FACT_FROM_FUTURE);
      continue;
    }
    if (dependency.state !== 'ACTIVE') {
      reasons.add(HOLD.DEPENDENCY_UNKNOWN);
      continue;
    }
    let target;
    try { target = normalizeTargetIdentity(dependency.target_identity); }
    catch (_) { reasons.add(HOLD.DEPENDENCY_TARGET_UNKNOWN); continue; }
    const possibilities = identityResolution(target, dependency.alias_resolution, facts, now, reasons);
    if (!possibilities) continue;
    let unknown = false;
    let overlaps = false;
    for (const candidate of possibilities) {
      for (const part of identityParts(candidate)) if (!facts.has(part.backend_id)) unknown = true;
      if (unknown) break;
      if (!artifact._target_for_compare) {
        unknown = true;
        break;
      }
      const result = identityOverlaps(artifact._target_for_compare, candidate, facts);
      if (result === null) unknown = true;
      else if (result) overlaps = true;
    }
    if (unknown) reasons.add(HOLD.BACKEND_FACTS_UNKNOWN);
    else if (overlaps) reasons.add(HOLD.DEPENDENCY_OVERLAP);
  }
}

function verifyPins(artifact, now, reasons, strictV2 = false) {
  if (!Array.isArray(artifact.pins)) { reasons.add(HOLD.RETENTION_PIN_UNKNOWN); return; }
  const ids = new Set();
  const allowedReasons = new Set(['ACTIVE_CONSUMER', 'RECOVERY', 'AUDIT', 'ROLLBACK', 'LEGAL_HOLD', 'OWNER_HOLD']);
  for (const pin of artifact.pins) {
    const optional = strictV2 ? ['release', 'consumer_id'] : ['release'];
    if (!exactKeys(pin, ['pin_id', 'reason', 'owner_id', 'release_condition'], optional)
      || !safeId(pin.pin_id) || ids.has(pin.pin_id) || !safeId(pin.reason) || !safeId(pin.owner_id)
      || !safeId(pin.release_condition)
      || (strictV2 && (!allowedReasons.has(pin.reason) || pin.owner_id !== artifact.ownership?.owner_id
        || (pin.consumer_id !== undefined && (!safeId(pin.consumer_id)
          || !artifact.required_consumers?.some(consumer => consumer.consumer_id === pin.consumer_id)))))) {
      reasons.add(HOLD.RETENTION_PIN_UNKNOWN); continue;
    }
    ids.add(pin.pin_id);
    if (pin.release === undefined || pin.release === null) { reasons.add(HOLD.RETENTION_PIN_ACTIVE); continue; }
    const releaseCore = { pin_id: pin.pin_id, reason: pin.reason, owner_id: pin.owner_id,
      release_condition: pin.release_condition, released_at: pin.release.released_at };
    if (pin.consumer_id !== undefined) releaseCore.consumer_id = pin.consumer_id;
    if (!exactKeys(pin.release, ['released_at', 'evidence_digest']) || timestamp(pin.release.released_at) === null
      || !expectedDigest(releaseCore, pin.release.evidence_digest)) reasons.add(HOLD.RETENTION_PIN_UNKNOWN);
    else if (timestamp(pin.release.released_at) > now) reasons.add(HOLD.RETENTION_PIN_ACTIVE);
  }
}

function validateObserverDescriptors(value) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > 256) fail('RETENTION_INPUT_INVALID');
  const observerIds = new Set();
  for (const observer of value) {
    if (!exactKeys(observer, ['observer_id', 'observed_at', 'target_identity_digest', 'evidence_digest'])
      || !safeId(observer.observer_id) || timestamp(observer.observed_at) === null
      || !digest(observer.target_identity_digest)
      || observerIds.has(observer.observer_id)
      || !expectedDigest({
        observer_id: observer.observer_id,
        observed_at: observer.observed_at,
        target_identity_digest: observer.target_identity_digest
      }, observer.evidence_digest)) fail('RETENTION_OBSERVER_DESCRIPTOR_INVALID');
    observerIds.add(observer.observer_id);
  }
}


function canonicalUtc(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value ? ms : null;
}

function relativeInventoryPath(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 1024
    && !value.startsWith('/') && !value.includes('\\') && !value.includes('\u0000')
    && value.split('/').every(part => part && part !== '.' && part !== '..' && !/^[A-Za-z]:$/.test(part));
}

function validateTransferAnchor(artifact, now, reasons) {
  const value = artifact.transfer_anchor;
  const keys = ['transfer_id', 'producer_id', 'owner_id', 'source_target_digest', 'storage_target_identity',
    'payload_digest', 'inventory_digest', 'storage_entries', 'verified_transfer_at_utc', 'expiry_at_utc',
    'transfer_evidence_reference_digest', 'independent_restore_reference_digest', 'anchor_digest'];
  if (!exactKeys(value, keys) || !safeId(value.transfer_id) || !safeId(value.producer_id) || !safeId(value.owner_id)
    || !digest(value.source_target_digest) || !digest(value.payload_digest) || !digest(value.inventory_digest)
    || !digest(value.transfer_evidence_reference_digest) || !digest(value.independent_restore_reference_digest)
    || !Array.isArray(value.storage_entries) || value.storage_entries.length > MAX_TRANSFER_STORAGE_ENTRIES) {
    reasons.add(HOLD.TRANSFER_ANCHOR_UNKNOWN); return null;
  }
  let storageTarget;
  try { storageTarget = normalizeTargetIdentity(value.storage_target_identity); }
  catch (_) { reasons.add(HOLD.TRANSFER_ANCHOR_UNKNOWN); return null; }
  let totalBytes = 0;
  const entries = [];
  for (const item of value.storage_entries) {
    if (!exactKeys(item, ['relative_path', 'git_blob_or_revision', 'bytes', 'sha256'])
      || !relativeInventoryPath(item.relative_path) || !safeId(item.git_blob_or_revision)
      || !Number.isSafeInteger(item.bytes) || item.bytes < 0 || !digest(item.sha256)) {
      reasons.add(HOLD.TRANSFER_ANCHOR_UNKNOWN); return null;
    }
    totalBytes += item.bytes;
    entries.push(item);
  }
  const ordered = [...entries].sort((a, b) => compareCanonical(a, b));
  if (totalBytes > MAX_TRANSFER_STORAGE_BYTES || canonicalSerialize(ordered) !== canonicalSerialize(entries)
    || new Set(entries.map(item => item.relative_path)).size !== entries.length) {
    reasons.add(HOLD.TRANSFER_ANCHOR_UNKNOWN); return null;
  }
  const transferAt = canonicalUtc(value.verified_transfer_at_utc), expiresAt = canonicalUtc(value.expiry_at_utc);
  const expectedExpiry = transferAt === null ? null : transferAt + TRANSFER_RETENTION_MS;
  if (transferAt === null || expiresAt === null || expectedExpiry !== expiresAt || transferAt > now
    || value.anchor_digest !== digestValue(unsigned(value, 'anchor_digest'))) {
    reasons.add(HOLD.TRANSFER_ANCHOR_UNKNOWN); return null;
  }
  try {
    const expected = normalizeTargetIdentity(artifact.expected_target_identity);
    if (artifact.retention_class === 'LOCAL_TEMP' && value.source_target_digest !== targetDigest(expected)) {
      reasons.add(HOLD.TRANSFER_ANCHOR_UNKNOWN); return null;
    }
    if (artifact.retention_class === 'REMOTE_TEMP_BULK' && targetDigest(storageTarget) !== targetDigest(expected)) {
      reasons.add(HOLD.TRANSFER_ANCHOR_UNKNOWN); return null;
    }
  } catch (_) { reasons.add(HOLD.TRANSFER_ANCHOR_UNKNOWN); return null; }
  return value;
}

function validateDisposalTarget(value, reasons) {
  if (value === undefined) return true;
  const kinds = ['FILE_QUARANTINE', 'DIRECTORY_DISPOSAL', 'GIT_CURRENT_TREE'];
  if (!exactKeys(value, ['kind', 'root_relative', 'inventory', 'inventory_digest'])
    || !kinds.includes(value.kind) || !relativeInventoryPath(value.root_relative)
    || /(^|\/)(\.git|\.env(?:\.|$)|secrets?|credentials?)(\/|$)/i.test(value.root_relative)
    || !Array.isArray(value.inventory) || value.inventory.length > MAX_DISPOSAL_ENTRIES
    || !digest(value.inventory_digest)) { reasons.add(HOLD.DISPOSAL_TARGET_UNKNOWN); return false; }
  const entries = [];
  let files = 0, bytes = 0;
  for (const item of value.inventory) {
    if (!exactKeys(item, ['relative_path', 'type', 'bytes', 'sha256', 'identity'])
      || !relativeInventoryPath(item.relative_path) || !['FILE', 'DIRECTORY'].includes(item.type)) {
      reasons.add(HOLD.DISPOSAL_TARGET_UNKNOWN); return false;
    }
    if (item.type === 'FILE') {
      if (!Number.isSafeInteger(item.bytes) || item.bytes < 0 || !digest(item.sha256)) {
        reasons.add(HOLD.DISPOSAL_TARGET_UNKNOWN); return false;
      }
      files++; bytes += item.bytes;
      if (value.kind === 'GIT_CURRENT_TREE') {
        if (!exactKeys(item.identity, ['mode', 'blob']) || !/^(100644|100755)$/.test(item.identity.mode)
          || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(item.identity.blob)) {
          reasons.add(HOLD.DISPOSAL_TARGET_UNKNOWN); return false;
        }
      } else if (!exactKeys(item.identity, ['volume_serial', 'file_id', 'links'])
        || !safeId(String(item.identity.volume_serial)) || !safeId(String(item.identity.file_id))
        || item.identity.links !== 1) { reasons.add(HOLD.DISPOSAL_TARGET_UNKNOWN); return false; }
    } else if (item.bytes !== null || item.sha256 !== null
      || value.kind === 'GIT_CURRENT_TREE'
      || !exactKeys(item.identity, ['volume_serial', 'file_id', 'links'])
      || !safeId(String(item.identity.volume_serial)) || !safeId(String(item.identity.file_id))
      || item.identity.links !== 1) { reasons.add(HOLD.DISPOSAL_TARGET_UNKNOWN); return false; }
    entries.push(item);
  }
  const ordered = [...entries].sort((a, b) => a.relative_path.localeCompare(b.relative_path));
  const cap = value.kind === 'GIT_CURRENT_TREE' ? MAX_GIT_DISPOSAL_BYTES : MAX_DISPOSAL_BYTES;
  if (files > MAX_DISPOSAL_FILES || bytes > cap || canonicalSerialize(ordered) !== canonicalSerialize(entries)
    || new Set(entries.map(item => item.relative_path)).size !== entries.length
    || value.inventory_digest !== digestValue(entries)) {
    reasons.add(HOLD.DISPOSAL_TARGET_UNKNOWN); return false;
  }
  return true;
}


function planOne(artifact, facts, now, nowIso, legacy) {
  const reasons = new Set();
  if (!isRecord(artifact) || !safeId(artifact.artifact_id)) fail('RETENTION_INPUT_INVALID');
  if (!['LOCAL_TEMP', 'REMOTE_TEMP_BULK', 'DURABLE_EVIDENCE'].includes(artifact.retention_class)) {
    fail('RETENTION_INPUT_INVALID');
  }
  const transferAnchor = legacy || artifact.retention_class === 'DURABLE_EVIDENCE'
    ? null : validateTransferAnchor(artifact, now, reasons);
  validateDisposalTarget(artifact.disposal_target, reasons);
  if (!legacy && artifact.pending_cleanup !== undefined) {
    const pending = artifact.pending_cleanup;
    if (!exactKeys(pending, ['operation_id', 'operation_kind', 'target_digest', 'source_digest', 'manifest_revision',
      'inventory_digest', 'expected_backend_revision', 'state', 'approval_evidence_reference',
      'outcome_evidence_reference', 'readback_evidence_reference'])
      || !safeId(pending.operation_id) || !['GIT_CURRENT_TREE_REMOVE', 'DISPOSAL_DELETE'].includes(pending.operation_kind)
      || !digest(pending.target_digest) || !digest(pending.source_digest) || !safeId(pending.manifest_revision)
      || !digest(pending.inventory_digest) || !safeId(pending.expected_backend_revision)
      || !['PREPARED', 'IN_FLIGHT', 'UNKNOWN', 'APPLIED', 'DENIED_NOT_APPLIED', 'READBACK_VERIFIED'].includes(pending.state)) {
      reasons.add(HOLD.CLEANUP_OPERATION_PENDING);
    } else if (pending.state !== 'READBACK_VERIFIED') reasons.add(HOLD.CLEANUP_OPERATION_PENDING);
  }
  if (artifact.retention_class === 'DURABLE_EVIDENCE') {
    return { artifact_id: artifact.artifact_id, disposition: 'KEEP', reason_codes: ['DURABLE_EVIDENCE'] };
  }
  let expected;
  let observed;
  try {
    expected = normalizeTargetIdentity(artifact.expected_target_identity);
    observed = normalizeTargetIdentity(artifact.observed_target_identity);
  } catch (_) {
    reasons.add(HOLD.TARGET_OBSERVATION_UNKNOWN);
  }
  if (expected && observed) {
    validateObserverDescriptors(artifact.observer_descriptors);
    validateTargetObservation(artifact, expected, observed, facts, now, reasons);
    verifyOwnership(artifact, artifact.artifact_id, expected, now, reasons);
  }
  const custodyFacts = verifyCustody(artifact, artifact.artifact_id, now, reasons);
  if (!Array.isArray(artifact.required_consumers)) reasons.add(HOLD.CONSUMER_INVENTORY_UNKNOWN);
  else {
    const seen = new Set();
    const releases = [];
    for (const consumer of artifact.required_consumers) {
      if (!isRecord(consumer) || !safeId(consumer.consumer_id) || seen.has(consumer.consumer_id)) {
        reasons.add(HOLD.CONSUMER_INVENTORY_UNKNOWN);
        continue;
      }
      seen.add(consumer.consumer_id);
      if (!custodyFacts) {
        if (consumer.state !== 'RELEASED' && consumer.state !== 'TRANSFERRED') reasons.add(HOLD.CONSUMER_STATE_UNKNOWN);
        continue;
      }
      const released = validateConsumerRelease(consumer, custodyFacts, now, reasons);
      if (released !== null) releases.push(released);
    }
    artifact._consumer_release_times = releases;
  }
  if (!expected || !observed) validateObserverDescriptors(artifact.observer_descriptors);
  if (expected) {
    artifact._target_for_compare = expected;
    const resolution = identityResolution(expected, artifact.alias_resolution, facts, now, reasons);
    if (resolution) artifact._target_candidates = resolution;
  } else artifact._target_candidates = null;
  if (expected && artifact._target_candidates) {
    verifyDependencies({ ...artifact, _target_for_compare: { ...expected, mount_members: artifact._target_candidates.flatMap((candidate) => identityParts(candidate)) } }, facts, now, reasons);
  } else verifyDependencies(artifact, facts, now, reasons);
  verifyPins(artifact, now, reasons, !legacy);

  const reasonCodes = [...reasons].sort();
  if (reasonCodes.length > 0) {
    return { artifact_id: artifact.artifact_id, disposition: 'HOLD', reason_codes: reasonCodes,
      target_digest: expected ? targetDigest(expected) : null };
  }
  const completedAt = [
    timestamp(custodyFacts.verified_at),
    timestamp(custodyFacts.retrieved_at),
    ...(artifact._consumer_release_times || [])
  ].reduce((latest, value) => Math.max(latest, value), 0);
  if (artifact.retention_class === 'LOCAL_TEMP') {
    return { artifact_id: artifact.artifact_id, disposition: 'ELIGIBLE_NOW', eligible_at: nowIso,
      reason_codes: [], target_digest: targetDigest(expected) };
  }
  const eligibleAt = legacy ? completedAt + LEGACY_REMOTE_BULK_RETENTION_MS : Date.parse(transferAnchor.expiry_at_utc);
  return {
    artifact_id: artifact.artifact_id,
    disposition: eligibleAt <= now ? 'ELIGIBLE_NOW' : 'WAIT_UNTIL',
    eligible_at: new Date(eligibleAt).toISOString(),
    reason_codes: eligibleAt <= now ? [] : [legacy ? 'LEGACY_30_DAY_RETENTION' : 'TRANSFER_ANCHOR_21_DAY_RETENTION'],
    ...(legacy ? { latest_required_consumer_release_at: new Date(completedAt).toISOString() } : {
      verified_transfer_at_utc: transferAnchor.verified_transfer_at_utc,
      immutable_expiry_at_utc: transferAnchor.expiry_at_utc
    }),
    target_digest: targetDigest(expected)
  };
}

function planRetention(manifest, options = {}) {
  if (!exactKeys(manifest, ['schema', 'artifacts'], ['backend_facts'])
    || ![LEGACY_RETENTION_VIEW_SCHEMA, RETENTION_VIEW_SCHEMA].includes(manifest.schema)
    || !Array.isArray(manifest.artifacts) || manifest.artifacts.length > 4096 || !isRecord(options)
    || !exactKeys(options, [], ['now', 'fixture_clock', 'trusted_clock'])) fail('RETENTION_INPUT_INVALID');
  const legacy = manifest.schema === LEGACY_RETENTION_VIEW_SCHEMA;
  if (!legacy && options.now !== undefined && options.fixture_clock !== true && options.trusted_clock !== true) {
    fail('RETENTION_CLOCK_UNTRUSTED');
  }
  if (options.fixture_clock !== undefined && typeof options.fixture_clock !== 'boolean') fail('RETENTION_CLOCK_UNTRUSTED');
  if (options.trusted_clock !== undefined && typeof options.trusted_clock !== 'boolean') fail('RETENTION_CLOCK_UNTRUSTED');
  const nowMs = options.now === undefined ? Date.now() : timestamp(options.now);
  if (!Number.isFinite(nowMs)) fail('RETENTION_TIME_INVALID');
  const nowIso = new Date(nowMs).toISOString();
  const facts = backendFacts(manifest), artifactIds = new Set(), decisions = [];
  for (const artifact of manifest.artifacts) {
    if (!isRecord(artifact) || !safeId(artifact.artifact_id) || artifactIds.has(artifact.artifact_id)) fail('RETENTION_INPUT_INVALID');
    artifactIds.add(artifact.artifact_id);
    decisions.push(planOne({ ...artifact }, facts, nowMs, nowIso, legacy));
  }
  decisions.sort((left, right) => left.artifact_id < right.artifact_id ? -1 : left.artifact_id > right.artifact_id ? 1 : 0);
  const unsigned = { schema: 'toolkit.custody.retention-plan.v2', manifest_schema: manifest.schema,
    policy: legacy ? 'LEGACY_V1_30_DAY_READ_ONLY' : 'V2_IMMUTABLE_TRANSFER_PLUS_21_DAYS',
    as_of: nowIso, decisions, mutation_authority: false };
  return deepFreeze({ ...unsigned, plan_digest: digestValue(unsigned) });
}

function unsigned(value, key) {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

function validateDisposalReceipt(value, expected, priorOperations, trustedBindings) {
  // priorOperations must be translated from trusted existing operation
  // history. trustedBindings must be assembled by the caller from supported
  // native approval and controller/effect readers. These opaque evidence
  // references bind the returned receipt; this helper cannot authenticate
  // native evidence or grant permission. No self-reported `accepted` or
  // `verified` flag is treated as proof here.
  if (!exactKeys(value, ['schema', 'artifact_id', 'operation_receipt', 'absence_readback'])
    || value.schema !== DISPOSAL_RECEIPT_SCHEMA || !safeId(value.artifact_id)
    || !exactKeys(expected, ['artifact_id', 'target_identity', 'content_digest', 'safety_class'])
    || value.artifact_id !== expected.artifact_id || !safeId(expected.artifact_id)
    || !digest(expected.content_digest) || !safeId(expected.safety_class) || !Array.isArray(priorOperations)
    || !exactKeys(trustedBindings, ['current_native_acceptance', 'prior_nonapplication'])) {
    fail('RETENTION_DISPOSAL_RECEIPT_INVALID');
  }
  const target = normalizeTargetIdentity(expected.target_identity);
  const expectedTargetDigest = targetDigest(target);
  const scope = [expectedTargetDigest];
  const currentAcceptance = trustedBindings.current_native_acceptance;
  if (!exactKeys(currentAcceptance, ['evidence_digest', 'operation_kind', 'target_digest', 'scope_target_digests', 'source_digest', 'safety_class'])
    || !digest(currentAcceptance.evidence_digest) || currentAcceptance.operation_kind !== 'DISPOSAL_DELETE'
    || currentAcceptance.target_digest !== expectedTargetDigest
    || canonicalSerialize(currentAcceptance.scope_target_digests) !== canonicalSerialize(scope)
    || currentAcceptance.source_digest !== expected.content_digest
    || currentAcceptance.safety_class !== expected.safety_class) fail('RETENTION_NATIVE_APPROVAL_BINDING_INVALID');

  const operation = value.operation_receipt;
  const opKeys = ['operation_id', 'operation_kind', 'target_identity', 'target_digest', 'scope_target_digests',
    'source_digest', 'safety_class', 'classification', 'attempt_number', 'retry_of_operation_id',
    'native_approval_evidence_digest', 'outcome_evidence_digest', 'no_effect_observation_digest',
    'executor_id', 'receipt_digest'];
  if (!exactKeys(operation, opKeys) || !safeId(operation.operation_id) || operation.operation_kind !== 'DISPOSAL_DELETE'
    || operation.target_digest !== expectedTargetDigest || canonicalSerialize(normalizeTargetIdentity(operation.target_identity)) !== canonicalSerialize(target)
    || !Array.isArray(operation.scope_target_digests) || canonicalSerialize(operation.scope_target_digests) !== canonicalSerialize(scope)
    || operation.source_digest !== expected.content_digest || operation.safety_class !== expected.safety_class
    || !safeId(operation.executor_id) || operation.native_approval_evidence_digest !== currentAcceptance.evidence_digest
    || !digest(operation.outcome_evidence_digest) || operation.no_effect_observation_digest !== null
    || !digest(operation.receipt_digest)
    || operation.receipt_digest !== digestValue(unsigned(operation, 'receipt_digest'))) fail('RETENTION_DISPOSAL_RECEIPT_INVALID');
  if (operation.classification !== 'APPLIED') fail('RETENTION_DISPOSAL_NOT_APPLIED');

  const priorIds = new Set();
  const validatedPrior = priorOperations.map((prior) => {
    if (isRecord(prior) && prior.operation_id === operation.operation_id) fail('RETENTION_DISPOSAL_DUPLICATE');
    if (!exactKeys(prior, opKeys) || !safeId(prior.operation_id) || priorIds.has(prior.operation_id)
      || prior.operation_kind !== 'DISPOSAL_DELETE'
      || !digest(prior.target_digest) || !Array.isArray(prior.scope_target_digests)
      || !digest(prior.source_digest) || !safeId(prior.safety_class)
      || !Number.isInteger(prior.attempt_number) || ![1, 2].includes(prior.attempt_number)
      || !(prior.retry_of_operation_id === null || safeId(prior.retry_of_operation_id))
      || !(prior.native_approval_evidence_digest === null || digest(prior.native_approval_evidence_digest))
      || !digest(prior.outcome_evidence_digest)
      || !(prior.no_effect_observation_digest === null || digest(prior.no_effect_observation_digest))
      || !safeId(prior.executor_id) || !digest(prior.receipt_digest)
      || prior.receipt_digest !== digestValue(unsigned(prior, 'receipt_digest'))) {
      fail('RETENTION_DISPOSAL_HISTORY_INVALID');
    }
    priorIds.add(prior.operation_id);
    const priorTarget = normalizeTargetIdentity(prior.target_identity);
    if (prior.target_digest !== targetDigest(priorTarget)
      || prior.scope_target_digests.length !== 1
      || prior.scope_target_digests[0] !== prior.target_digest) fail('RETENTION_DISPOSAL_HISTORY_INVALID');
    return { operation: prior, target: priorTarget };
  });

  const operationHistory = validatedPrior.filter(({ operation: prior }) => prior.target_digest === expectedTargetDigest
    || prior.operation_id === operation.retry_of_operation_id);
  if (operation.attempt_number === 1) {
    if (operation.retry_of_operation_id !== null || trustedBindings.prior_nonapplication !== null) {
      fail('RETENTION_DISPOSAL_RECEIPT_INVALID');
    }
    if (operationHistory.length > 0) fail('RETENTION_DISPOSAL_DUPLICATE');
  } else if (operation.attempt_number === 2) {
    const prior = operationHistory.length === 1 ? operationHistory[0].operation : null;
    const observation = trustedBindings.prior_nonapplication;
    if (!prior || !safeId(operation.retry_of_operation_id) || prior.operation_id !== operation.retry_of_operation_id
      || prior.attempt_number !== 1 || prior.retry_of_operation_id !== null
      || prior.operation_kind !== operation.operation_kind || prior.target_digest !== expectedTargetDigest
      || canonicalSerialize(operationHistory[0].target) !== canonicalSerialize(target)
      || canonicalSerialize(prior.scope_target_digests) !== canonicalSerialize(scope)
      || prior.source_digest !== expected.content_digest || prior.safety_class !== expected.safety_class
      || prior.classification !== 'DENIED_NOT_APPLIED' || !digest(prior.no_effect_observation_digest)
      || !exactKeys(observation, ['operation_id', 'operation_kind', 'target_digest', 'scope_target_digests',
        'source_digest', 'safety_class', 'outcome_evidence_digest', 'no_effect_observation_digest'])
      || observation.operation_id !== prior.operation_id || observation.operation_kind !== prior.operation_kind
      || observation.target_digest !== expectedTargetDigest
      || canonicalSerialize(observation.scope_target_digests) !== canonicalSerialize(scope)
      || observation.source_digest !== expected.content_digest || observation.safety_class !== expected.safety_class
      || observation.outcome_evidence_digest !== prior.outcome_evidence_digest
      || observation.no_effect_observation_digest !== prior.no_effect_observation_digest) {
      fail('RETENTION_DISPOSAL_RETRY_NOT_PERMITTED');
    }
  } else {
    fail('RETENTION_DISPOSAL_RETRY_NOT_PERMITTED');
  }
  const readback = value.absence_readback;
  const readKeys = ['readback_id', 'reader_id', 'target_identity', 'target_digest', 'state', 'observed_at',
    'operation_receipt_digest', 'evidence_digest'];
  if (!exactKeys(readback, readKeys) || !safeId(readback.readback_id) || !safeId(readback.reader_id)
    || readback.reader_id === operation.executor_id || readback.target_digest !== expectedTargetDigest
    || canonicalSerialize(normalizeTargetIdentity(readback.target_identity)) !== canonicalSerialize(target)
    || readback.state !== 'ABSENT' || timestamp(readback.observed_at) === null
    || readback.operation_receipt_digest !== operation.receipt_digest || !digest(readback.evidence_digest)
    || readback.evidence_digest !== digestValue(unsigned(readback, 'evidence_digest'))) fail('RETENTION_ABSENCE_READBACK_INVALID');
  return deepFreeze({
    ok: true,
    artifact_id: value.artifact_id,
    target_digest: expectedTargetDigest,
    operation_id: operation.operation_id,
    absence_readback_id: readback.readback_id,
    absence_observed_at: readback.observed_at
  });
}

function fixtureClone(value) {
  return structuredClone(value);
}

function fixtureArtifact(manifest, artifactId) {
  if (!isRecord(manifest) || !Array.isArray(manifest.artifacts)) fail('RETENTION_FIXTURE_STATE_INVALID');
  const matches = manifest.artifacts.filter((item) => item?.artifact_id === artifactId);
  if (matches.length !== 1) fail('RETENTION_FIXTURE_STATE_INVALID');
  return matches[0];
}

function fixtureTargetIsNarrow(identity, artifactId) {
  const normalized = normalizeTargetIdentity(identity);
  return normalized.backend_id === FIXTURE_BACKEND_ID
    && normalized.resource_id === `fixture-${artifactId}`
    && normalized.path === `${FIXTURE_PATH_PREFIX}${artifactId}`
    && normalized.mount_members.length === 0;
}

function fixtureRetentionStateDigest(manifest, artifact) {
  return digestValue({ artifact, backend_facts: manifest.backend_facts || [] });
}

function fixtureRetainedReferenceDigest(artifact, contentDigest) {
  return digestValue({
    evidence_reference: artifact.evidence_reference,
    custody_reference: artifact.custody_reference,
    content_digest: contentDigest
  });
}

function validateCurrentAcceptance(acceptance, expected) {
  const target = normalizeTargetIdentity(expected.target_identity);
  const expectedTargetDigest = targetDigest(target);
  const scope = [expectedTargetDigest];
  if (!exactKeys(acceptance, ['evidence_digest', 'operation_kind', 'target_digest', 'scope_target_digests', 'source_digest', 'safety_class'])
    || !digest(acceptance.evidence_digest) || acceptance.operation_kind !== 'DISPOSAL_DELETE'
    || acceptance.target_digest !== expectedTargetDigest
    || canonicalSerialize(acceptance.scope_target_digests) !== canonicalSerialize(scope)
    || acceptance.source_digest !== expected.content_digest || acceptance.safety_class !== expected.safety_class) {
    fail('RETENTION_NATIVE_APPROVAL_BINDING_INVALID');
  }
  return { target, target_digest: expectedTargetDigest, scope };
}

function validateTargetAuthorization(authorization, expected, manifest, plan, artifact) {
  const target = normalizeTargetIdentity(expected.target_identity);
  const targetHash = targetDigest(target);
  const keys = ['artifact_id', 'target_identity', 'target_digest', 'scope_target_digests', 'source_digest',
    'safety_class', 'owner_id', 'retained_reference_digest', 'retention_state_digest',
    'eligibility_plan_digest', 'evidence_digest'];
  if (!exactKeys(authorization, keys) || !safeId(authorization.evidence_digest)
    || authorization.evidence_digest !== digestValue(unsigned(authorization, 'evidence_digest'))
    || authorization.artifact_id !== expected.artifact_id
    || canonicalSerialize(normalizeTargetIdentity(authorization.target_identity)) !== canonicalSerialize(target)
    || authorization.target_digest !== targetHash
    || canonicalSerialize(authorization.scope_target_digests) !== canonicalSerialize([targetHash])
    || authorization.source_digest !== expected.content_digest || authorization.safety_class !== expected.safety_class
    || authorization.owner_id !== artifact.ownership?.owner_id
    || authorization.retained_reference_digest !== fixtureRetainedReferenceDigest(artifact, expected.content_digest)
    || authorization.retention_state_digest !== fixtureRetentionStateDigest(manifest, artifact)
    || authorization.eligibility_plan_digest !== plan.plan_digest) {
    fail('RETENTION_TARGET_AUTHORIZATION_BINDING_INVALID');
  }
}

function fixtureTargetObservation(identity, observedAt) {
  const normalized = normalizeTargetIdentity(identity);
  const core = { backend_id: normalized.backend_id, observed_at: observedAt, identity_digest: targetDigest(normalized) };
  return { ...core, evidence_digest: digestValue(core) };
}

function fixtureOwnership(artifactId, identity, ownerId, observedAt) {
  const core = { artifact_id: artifactId, owner_id: ownerId, target_digest: targetDigest(identity), observed_at: observedAt };
  return { owner_id: ownerId, observed_at: observedAt, evidence_digest: digestValue(core) };
}

function fixtureBackendFact(backendId, observedAt) {
  const core = { backend_id: backendId, path_case: 'SENSITIVE', observed_at: observedAt };
  return { ...core, evidence_digest: digestValue(core) };
}

function replaceFixtureArtifact(manifest, artifactId, update) {
  const copy = fixtureClone(manifest);
  const index = copy.artifacts.findIndex((item) => item?.artifact_id === artifactId);
  if (index < 0 || copy.artifacts.findIndex((item, position) => position !== index && item?.artifact_id === artifactId) >= 0) {
    fail('RETENTION_FIXTURE_STATE_INVALID');
  }
  copy.artifacts[index] = update(copy.artifacts[index]);
  return copy;
}

function appendFixtureDisposalEvent(manifest, artifactId, event) {
  return replaceFixtureArtifact(manifest, artifactId, (artifact) => {
    const existing = artifact.disposal_observations === undefined ? [] : artifact.disposal_observations;
    if (!Array.isArray(existing) || existing.length >= 512) fail('RETENTION_DISPOSAL_HISTORY_INVALID');
    return { ...artifact, disposal_observations: [...existing, fixtureClone(event)] };
  });
}

function fixtureOperationEvent(operation) {
  const core = { schema: DISPOSAL_OBSERVATION_SCHEMA, kind: 'OPERATION', operation_receipt: operation };
  return { ...core, event_digest: digestValue(core) };
}

function fixtureReadbackEvent(operationId, readback) {
  const core = { schema: DISPOSAL_OBSERVATION_SCHEMA, kind: 'READBACK', operation_id: operationId, readback };
  return { ...core, event_digest: digestValue(core) };
}

function validateFixtureOperation(operation, expected) {
  const keys = ['operation_id', 'operation_kind', 'target_identity', 'target_digest', 'scope_target_digests',
    'source_digest', 'safety_class', 'classification', 'attempt_number', 'retry_of_operation_id',
    'native_approval_evidence_digest', 'outcome_evidence_digest', 'no_effect_observation_digest',
    'executor_id', 'receipt_digest'];
  const target = normalizeTargetIdentity(expected.target_identity);
  const targetHash = targetDigest(target);
  if (!exactKeys(operation, keys) || !safeId(operation.operation_id)
    || !['DISPOSAL_DELETE', 'GIT_CURRENT_TREE_REMOVE'].includes(operation.operation_kind)
    || canonicalSerialize(normalizeTargetIdentity(operation.target_identity)) !== canonicalSerialize(target)
    || operation.target_digest !== targetHash || canonicalSerialize(operation.scope_target_digests) !== canonicalSerialize([targetHash])
    || operation.source_digest !== expected.content_digest || operation.safety_class !== expected.safety_class
    || !['APPLIED', 'UNKNOWN', 'DENIED_NOT_APPLIED'].includes(operation.classification)
    || !Number.isInteger(operation.attempt_number) || ![1, 2].includes(operation.attempt_number)
    || !(operation.retry_of_operation_id === null || safeId(operation.retry_of_operation_id))
    || !(operation.native_approval_evidence_digest === null || digest(operation.native_approval_evidence_digest))
    || !digest(operation.outcome_evidence_digest)
    || !(operation.no_effect_observation_digest === null || digest(operation.no_effect_observation_digest))
    || !safeId(operation.executor_id) || !digest(operation.receipt_digest)
    || operation.receipt_digest !== digestValue(unsigned(operation, 'receipt_digest'))
    || operation.attempt_number === 1 && operation.retry_of_operation_id !== null
    || operation.attempt_number === 2 && operation.retry_of_operation_id === null
    || operation.classification === 'DENIED_NOT_APPLIED' && !digest(operation.no_effect_observation_digest)
    || operation.classification !== 'DENIED_NOT_APPLIED' && operation.no_effect_observation_digest !== null) {
    fail('RETENTION_DISPOSAL_HISTORY_INVALID');
  }
  return operation;
}

function validateFixtureReadback(readback, operation, expected) {
  const keys = ['readback_id', 'reader_id', 'target_identity', 'target_digest', 'state', 'observed_at',
    'operation_receipt_digest', 'evidence_digest'];
  const target = normalizeTargetIdentity(expected.target_identity);
  const targetHash = targetDigest(target);
  if (!exactKeys(readback, keys) || !safeId(readback.readback_id) || !safeId(readback.reader_id)
    || readback.reader_id === operation.executor_id
    || canonicalSerialize(normalizeTargetIdentity(readback.target_identity)) !== canonicalSerialize(target)
    || readback.target_digest !== targetHash || !['ABSENT', 'PRESENT', 'UNKNOWN'].includes(readback.state)
    || timestamp(readback.observed_at) === null || readback.operation_receipt_digest !== operation.receipt_digest
    || !digest(readback.evidence_digest) || readback.evidence_digest !== digestValue(unsigned(readback, 'evidence_digest'))) {
    fail('RETENTION_ABSENCE_READBACK_INVALID');
  }
  return readback;
}

function readFixtureDisposalHistory(artifact, expected) {
  const events = artifact.disposal_observations === undefined ? [] : artifact.disposal_observations;
  if (!Array.isArray(events) || events.length > 512) fail('RETENTION_DISPOSAL_HISTORY_INVALID');
  const operations = [];
  const operationIds = new Set();
  for (const event of events) {
    if (!isRecord(event)) fail('RETENTION_DISPOSAL_HISTORY_INVALID');
    if (event.kind === 'OPERATION') {
      if (!exactKeys(event, ['schema', 'kind', 'operation_receipt', 'event_digest'])
        || event.schema !== DISPOSAL_OBSERVATION_SCHEMA) fail('RETENTION_DISPOSAL_HISTORY_INVALID');
      const operation = validateFixtureOperation(event.operation_receipt, expected);
      if (operationIds.has(operation.operation_id)
        || event.event_digest !== digestValue({ schema: DISPOSAL_OBSERVATION_SCHEMA, kind: 'OPERATION', operation_receipt: operation })) {
        fail('RETENTION_DISPOSAL_HISTORY_INVALID');
      }
      const previous = operations.at(-1);
      if (operation.attempt_number === 1 && previous) fail('RETENTION_DISPOSAL_HISTORY_INVALID');
      if (operation.attempt_number === 2 && (!previous || previous.attempt_number !== 1
        || previous.operation_id !== operation.retry_of_operation_id || previous.classification !== 'DENIED_NOT_APPLIED'
        || previous.target_digest !== operation.target_digest || previous.source_digest !== operation.source_digest
        || previous.safety_class !== operation.safety_class)) fail('RETENTION_DISPOSAL_HISTORY_INVALID');
      operations.push(operation);
      operationIds.add(operation.operation_id);
    } else if (event.kind === 'READBACK') {
      if (!exactKeys(event, ['schema', 'kind', 'operation_id', 'readback', 'event_digest'])
        || event.schema !== DISPOSAL_OBSERVATION_SCHEMA || !operationIds.has(event.operation_id)) {
        fail('RETENTION_DISPOSAL_HISTORY_INVALID');
      }
      const operation = operations.find((item) => item.operation_id === event.operation_id);
      validateFixtureReadback(event.readback, operation, expected);
      if (event.event_digest !== digestValue({ schema: DISPOSAL_OBSERVATION_SCHEMA, kind: 'READBACK',
        operation_id: event.operation_id, readback: event.readback })) {
        fail('RETENTION_DISPOSAL_HISTORY_INVALID');
      }
    } else fail('RETENTION_DISPOSAL_HISTORY_INVALID');
  }
  return { events, operations };
}

function createTaskOwnedFixtureCleanupBackend(options) {
  if (!exactKeys(options, ['manifest', 'artifact_id'], ['target_present'])) fail('RETENTION_FIXTURE_STATE_INVALID');
  const manifest = fixtureClone(options.manifest);
  if (!exactKeys(manifest, ['schema', 'artifacts'], ['backend_facts']) || manifest.schema !== RETENTION_VIEW_SCHEMA
    || !Array.isArray(manifest.artifacts) || !safeId(options.artifact_id)
    || !(options.target_present === undefined || typeof options.target_present === 'boolean')) {
    fail('RETENTION_FIXTURE_STATE_INVALID');
  }
  const artifact = fixtureArtifact(manifest, options.artifact_id);
  const boundTarget = normalizeTargetIdentity(artifact.expected_target_identity);
  if (!fixtureTargetIsNarrow(boundTarget, options.artifact_id)) fail('RETENTION_FIXTURE_TARGET_UNSUPPORTED');
  const state = {
    artifact_id: options.artifact_id,
    target_digest: targetDigest(boundTarget),
    manifest,
    target_present: options.target_present !== false,
    generation: 0,
    pending_boundary_change: null,
    ambiguous_next_outcome: false,
    reader_override: null,
    readback_sequence: 0,
    effect_trace: []
  };

  function assertExpected(expected) {
    if (!exactKeys(expected, ['artifact_id', 'target_identity', 'content_digest', 'safety_class'])
      || expected.artifact_id !== state.artifact_id || !digest(expected.content_digest) || !safeId(expected.safety_class)
      || targetDigest(expected.target_identity) !== state.target_digest) fail('RETENTION_FIXTURE_TARGET_UNSUPPORTED');
    return normalizeTargetIdentity(expected.target_identity);
  }

  function boundaryToken() {
    const currentArtifact = fixtureArtifact(state.manifest, state.artifact_id);
    return digestValue({
      generation: state.generation,
      target_digest: state.target_digest,
      target_present: state.target_present,
      artifact_digest: digestValue(currentArtifact),
      backend_facts_digest: digestValue(state.manifest.backend_facts || [])
    });
  }

  function applyFixtureChange(change, observedAt = OLD) {
    const current = fixtureArtifact(state.manifest, state.artifact_id);
    let next;
    if (isRecord(change) && change.kind === 'ACTIVATE_CONSUMER' && exactKeys(change, ['kind', 'consumer_id'])
      && safeId(change.consumer_id)) {
      const consumers = Array.isArray(current.required_consumers) ? current.required_consumers : [];
      next = { ...current, required_consumers: [
        ...consumers.filter((consumer) => consumer?.consumer_id !== change.consumer_id),
        { consumer_id: change.consumer_id, state: 'ACTIVE' }
      ] };
    } else if (isRecord(change) && change.kind === 'CHANGE_OBSERVED_IDENTITY'
      && exactKeys(change, ['kind', 'identity']) && isRecord(change.identity)) {
      const identity = normalizeTargetIdentity(change.identity);
      next = { ...current, observed_target_identity: identity,
        target_observation: fixtureTargetObservation(identity, observedAt) };
      const facts = state.manifest.backend_facts || [];
      if (!facts.some((fact) => fact.backend_id === identity.backend_id)) {
        state.manifest = { ...state.manifest, backend_facts: [...facts, fixtureBackendFact(identity.backend_id, observedAt)] };
      }
    } else if (isRecord(change) && change.kind === 'CHANGE_EXPECTED_TARGET_IDENTITY'
      && exactKeys(change, ['kind', 'identity']) && isRecord(change.identity)) {
      const identity = normalizeTargetIdentity(change.identity);
      next = { ...current, expected_target_identity: identity };
      const facts = state.manifest.backend_facts || [];
      if (!facts.some((fact) => fact.backend_id === identity.backend_id)) {
        state.manifest = { ...state.manifest, backend_facts: [...facts, fixtureBackendFact(identity.backend_id, observedAt)] };
      }
    } else if (isRecord(change) && change.kind === 'CHANGE_TARGET_ALIAS_RESOLUTION'
      && exactKeys(change, ['kind', 'resolution', 'observer_descriptors'])) {
      next = { ...current, target_alias_resolution: fixtureClone(change.resolution),
        observer_descriptors: fixtureClone(change.observer_descriptors) };
    } else if (isRecord(change) && change.kind === 'CHANGE_OWNER'
      && exactKeys(change, ['kind', 'owner_id']) && safeId(change.owner_id)) {
      const identity = normalizeTargetIdentity(current.expected_target_identity);
      next = { ...current, ownership: fixtureOwnership(state.artifact_id, identity, change.owner_id, observedAt) };
    } else if (isRecord(change) && change.kind === 'CHANGE_RETAINED_REFERENCES'
      && exactKeys(change, ['kind', 'evidence_reference', 'custody_reference', 'consumer_readback'])
      && isRecord(change.evidence_reference) && isRecord(change.custody_reference) && isRecord(change.consumer_readback)) {
      next = { ...current, evidence_reference: fixtureClone(change.evidence_reference),
        custody_reference: fixtureClone(change.custody_reference), consumer_readback: fixtureClone(change.consumer_readback) };
    } else if (isRecord(change) && change.kind === 'SET_REQUIRED_CONSUMERS'
      && exactKeys(change, ['kind', 'required_consumers']) && Array.isArray(change.required_consumers)) {
      next = { ...current, required_consumers: fixtureClone(change.required_consumers) };
    } else fail('RETENTION_FIXTURE_CHANGE_UNSUPPORTED');
    state.manifest = replaceFixtureArtifact(state.manifest, state.artifact_id, () => next);
    state.generation += 1;
  }

  function makeOperationReceipt(args, classification, noEffectDigest = null) {
    const identity = assertExpected(args.expected);
    const targetHash = targetDigest(identity);
    const core = {
      operation_id: args.operation_id,
      operation_kind: 'DISPOSAL_DELETE',
      target_identity: identity,
      target_digest: targetHash,
      scope_target_digests: [targetHash],
      source_digest: args.expected.content_digest,
      safety_class: args.expected.safety_class,
      classification,
      attempt_number: args.attempt_number,
      retry_of_operation_id: args.retry_of_operation_id,
      native_approval_evidence_digest: args.current_native_acceptance.evidence_digest,
      outcome_evidence_digest: digestValue({
        operation_id: args.operation_id,
        target_digest: targetHash,
        boundary_token: args.boundary_token,
        classification,
        observed_at: args.now
      }),
      no_effect_observation_digest: noEffectDigest,
      executor_id: args.executor_id
    };
    return { ...core, receipt_digest: digestValue(core) };
  }

  function newSession() {
    const backend = Object.freeze({
      readBoundary(expected) {
        assertExpected(expected);
        return deepFreeze({ manifest: fixtureClone(state.manifest), boundary_token: boundaryToken(), target_present: state.target_present });
      },
      attemptDisposal(args) {
        if (!exactKeys(args, ['expected', 'boundary_token', 'target_authorization', 'current_native_acceptance',
          'operation_id', 'executor_id', 'attempt_number', 'retry_of_operation_id', 'now'])
          || !safeId(args.operation_id) || !safeId(args.executor_id) || !digest(args.boundary_token)
          || !Number.isInteger(args.attempt_number) || ![1, 2].includes(args.attempt_number)
          || !(args.retry_of_operation_id === null || safeId(args.retry_of_operation_id))
          || timestamp(args.now) === null) fail('RETENTION_FIXTURE_REQUEST_INVALID');
        const identity = assertExpected(args.expected);
        validateCurrentAcceptance(args.current_native_acceptance, args.expected);
        if (state.pending_boundary_change) {
          const change = state.pending_boundary_change;
          state.pending_boundary_change = null;
          applyFixtureChange(change, args.now);
        }
        const currentToken = boundaryToken();
        if (currentToken !== args.boundary_token) {
          const noEffectDigest = digestValue({
            reader_id: 'fixture-independent-reader',
            target_digest: state.target_digest,
            observed_state: state.target_present ? 'PRESENT' : 'ABSENT',
            observed_at: args.now,
            attempted_boundary_token: args.boundary_token,
            current_boundary_token: currentToken
          });
          const operation = makeOperationReceipt({ ...args, boundary_token: currentToken }, 'DENIED_NOT_APPLIED', noEffectDigest);
          state.manifest = appendFixtureDisposalEvent(state.manifest, state.artifact_id, fixtureOperationEvent(operation));
          state.generation += 1;
          state.effect_trace.push({ kind: 'ATTEMPT_DENIED', operation_id: args.operation_id,
            target_digest: state.target_digest, reason: 'BOUNDARY_CHANGED' });
          return deepFreeze({ classification: 'DENIED_NOT_APPLIED', operation_receipt: operation });
        }
        const currentManifest = state.manifest;
        const currentArtifact = fixtureArtifact(currentManifest, state.artifact_id);
        // The branded fixture backend runs only on its injected, fixture-labelled clock.
        const currentPlan = planRetention(currentManifest, { now: args.now, fixture_clock: true });
        const decision = currentPlan.decisions.find((item) => item.artifact_id === state.artifact_id);
        if (!decision || decision.disposition !== 'ELIGIBLE_NOW' || decision.target_digest !== state.target_digest) {
          fail('RETENTION_FIXTURE_BOUNDARY_NOT_ELIGIBLE');
        }
        validateTargetAuthorization(args.target_authorization, args.expected, currentManifest, currentPlan, currentArtifact);
        if (!state.target_present) return deepFreeze({ classification: 'TARGET_ALREADY_ABSENT', operation_receipt: null });
        const classification = state.ambiguous_next_outcome ? 'UNKNOWN' : 'APPLIED';
        state.ambiguous_next_outcome = false;
        state.target_present = false;
        const operation = makeOperationReceipt(args, classification);
        state.manifest = appendFixtureDisposalEvent(state.manifest, state.artifact_id, fixtureOperationEvent(operation));
        state.generation += 1;
        state.effect_trace.push({ kind: 'FIXTURE_TARGET_REMOVED', operation_id: args.operation_id,
          target_digest: state.target_digest, classification });
        return deepFreeze({ classification, operation_receipt: operation });
      },
      observeTarget(args) {
        if (!exactKeys(args, ['expected', 'operation_receipt', 'now']) || timestamp(args.now) === null) {
          fail('RETENTION_FIXTURE_REQUEST_INVALID');
        }
        const identity = assertExpected(args.expected);
        const operation = validateFixtureOperation(args.operation_receipt, args.expected);
        const stateValue = state.reader_override || (state.target_present ? 'PRESENT' : 'ABSENT');
        const core = {
          readback_id: `fixture-readback-${digestValue({ operation_id: operation.operation_id, state: stateValue, observed_at: args.now }).slice(0, 24)}`,
          reader_id: 'fixture-independent-reader',
          target_identity: identity,
          target_digest: state.target_digest,
          state: stateValue,
          observed_at: args.now,
          operation_receipt_digest: operation.receipt_digest
        };
        return deepFreeze({ ...core, evidence_digest: digestValue(core) });
      },
      recordReadback(args) {
        if (!exactKeys(args, ['expected', 'operation_receipt', 'readback'])) fail('RETENTION_FIXTURE_REQUEST_INVALID');
        assertExpected(args.expected);
        const operation = validateFixtureOperation(args.operation_receipt, args.expected);
        const readback = validateFixtureReadback(args.readback, operation, args.expected);
        const event = fixtureReadbackEvent(operation.operation_id, readback);
        const events = fixtureArtifact(state.manifest, state.artifact_id).disposal_observations || [];
        if (events.some((item) => item?.event_digest === event.event_digest)) return false;
        state.manifest = appendFixtureDisposalEvent(state.manifest, state.artifact_id, event);
        state.generation += 1;
        return true;
      }
    });
    const controls = Object.freeze({
      snapshot() {
        return deepFreeze({ manifest: fixtureClone(state.manifest), target_present: state.target_present,
          generation: state.generation, effect_trace: fixtureClone(state.effect_trace) });
      },
      scheduleBoundaryChange(change) {
        if (state.pending_boundary_change) fail('RETENTION_FIXTURE_CHANGE_PENDING');
        state.pending_boundary_change = fixtureClone(change);
        return true;
      },
      applyChange(change, observedAt = OLD) {
        applyFixtureChange(fixtureClone(change), observedAt);
        return true;
      },
      scheduleAmbiguousOutcome() {
        state.ambiguous_next_outcome = true;
        return true;
      },
      setReaderOverride(value) {
        if (!(value === null || ['PRESENT', 'ABSENT', 'UNKNOWN'].includes(value))) fail('RETENTION_FIXTURE_CHANGE_UNSUPPORTED');
        state.reader_override = value;
        return true;
      },
      newSession
    });
    FIXTURE_BACKENDS.add(backend);
    FIXTURE_BACKEND_CONTROLS.set(backend, controls);
    return { backend, controls };
  }

  return newSession();
}

function fixturePriorNonapplicationMatches(prior, observation, expected) {
  const targetHash = targetDigest(expected.target_identity);
  const keys = ['operation_id', 'operation_kind', 'target_digest', 'scope_target_digests', 'source_digest',
    'safety_class', 'outcome_evidence_digest', 'no_effect_observation_digest'];
  return prior && prior.classification === 'DENIED_NOT_APPLIED' && prior.attempt_number === 1
    && prior.retry_of_operation_id === null && prior.target_digest === targetHash
    && prior.scope_target_digests.length === 1 && prior.scope_target_digests[0] === targetHash
    && prior.source_digest === expected.content_digest && prior.safety_class === expected.safety_class
    && digest(prior.no_effect_observation_digest)
    && exactKeys(observation, keys)
    && observation.operation_id === prior.operation_id && observation.operation_kind === prior.operation_kind
    && observation.target_digest === prior.target_digest
    && canonicalSerialize(observation.scope_target_digests) === canonicalSerialize(prior.scope_target_digests)
    && observation.source_digest === prior.source_digest && observation.safety_class === prior.safety_class
    && observation.outcome_evidence_digest === prior.outcome_evidence_digest
    && observation.no_effect_observation_digest === prior.no_effect_observation_digest;
}

function reconcileFixtureDisposal(backend, expected, operation, now) {
  const readback = backend.observeTarget({ expected, operation_receipt: operation, now });
  backend.recordReadback({ expected, operation_receipt: operation, readback });
  const absent = readback.state === 'ABSENT';
  return deepFreeze({
    status: operation.classification === 'UNKNOWN'
      ? (absent ? 'UNKNOWN_ABSENCE_OBSERVED' : 'HOLD')
      : (absent ? 'RECONCILED_ABSENT' : 'HOLD'),
    fixture_only: true,
    mutation_authority: false,
    operation_attempted: false,
    operation_id: operation.operation_id,
    operation_classification: operation.classification,
    observed_target_state: readback.state,
    absence_readback_id: readback.readback_id,
    absence_observed_at: readback.observed_at
  });
}

function executeFixtureDisposal(request) {
  if (!isRecord(request) || !exactKeys(request, ['backend', 'expected', 'now'],
    ['target_authorization', 'trusted_bindings', 'operation_id', 'executor_id'])) fail('RETENTION_FIXTURE_REQUEST_INVALID');
  const { backend, expected, now } = request;
  if (!backend || !FIXTURE_BACKENDS.has(backend)) fail('RETENTION_FIXTURE_BACKEND_UNSUPPORTED');
  if (timestamp(now) === null) fail('RETENTION_TIME_INVALID');
  const target = normalizeTargetIdentity(expected.target_identity);
  const boundary = backend.readBoundary(expected);
  const artifact = fixtureArtifact(boundary.manifest, expected.artifact_id);
  const history = readFixtureDisposalHistory(artifact, expected);
  const previous = history.operations.at(-1);
  if (previous && ['APPLIED', 'UNKNOWN'].includes(previous.classification)) {
    return reconcileFixtureDisposal(backend, expected, previous, now);
  }
  if (previous && (previous.attempt_number !== 1 || previous.classification !== 'DENIED_NOT_APPLIED')) {
    return deepFreeze({ status: 'HOLD', fixture_only: true, mutation_authority: false,
      operation_attempted: false, reason_codes: ['RETENTION_DISPOSAL_RETRY_NOT_PERMITTED'],
      operation_id: previous.operation_id, operation_classification: previous.classification });
  }
  const plan = planRetention(boundary.manifest, { now, fixture_clock: true });
  const decision = plan.decisions.find((item) => item.artifact_id === expected.artifact_id);
  if (!decision || decision.disposition !== 'ELIGIBLE_NOW' || decision.target_digest !== targetDigest(target)) {
    return deepFreeze({ status: 'HOLD', fixture_only: true, mutation_authority: false,
      operation_attempted: false, reason_codes: decision?.reason_codes || ['RETENTION_TARGET_NOT_ELIGIBLE'],
      plan_digest: plan.plan_digest });
  }
  if (!stateTargetMatches(artifact, expected)) fail('RETENTION_TARGET_BINDING_INVALID');
  const trustedBindings = request.trusted_bindings;
  if (!exactKeys(trustedBindings, ['current_native_acceptance', 'prior_nonapplication'])) {
    fail('RETENTION_NATIVE_APPROVAL_BINDING_INVALID');
  }
  validateCurrentAcceptance(trustedBindings.current_native_acceptance, expected);
  if (previous) {
    if (!fixturePriorNonapplicationMatches(previous, trustedBindings.prior_nonapplication, expected)) {
      fail('RETENTION_DISPOSAL_RETRY_NOT_PERMITTED');
    }
  } else if (trustedBindings.prior_nonapplication !== null) fail('RETENTION_DISPOSAL_RECEIPT_INVALID');
  validateTargetAuthorization(request.target_authorization, expected, boundary.manifest, plan, artifact);
  if (!boundary.target_present) {
    return deepFreeze({ status: 'UNKNOWN_ABSENCE_OBSERVED', fixture_only: true, mutation_authority: false,
      operation_attempted: false, reason_codes: ['RETENTION_ABSENCE_WITHOUT_OPERATION_HISTORY'],
      plan_digest: plan.plan_digest });
  }
  if (!safeId(request.operation_id) || !safeId(request.executor_id || 'task-fixture-cleanup-writer')
    || history.operations.some((item) => item.operation_id === request.operation_id)) fail('RETENTION_DISPOSAL_DUPLICATE');
  const attemptNumber = previous ? 2 : 1;
  const accepted = backend.attemptDisposal({
    expected,
    boundary_token: boundary.boundary_token,
    target_authorization: request.target_authorization,
    current_native_acceptance: trustedBindings.current_native_acceptance,
    operation_id: request.operation_id,
    executor_id: request.executor_id || 'task-fixture-cleanup-writer',
    attempt_number: attemptNumber,
    retry_of_operation_id: previous ? previous.operation_id : null,
    now
  });
  if (accepted.classification === 'TARGET_ALREADY_ABSENT') {
    return deepFreeze({ status: 'UNKNOWN_ABSENCE_OBSERVED', fixture_only: true, mutation_authority: false,
      operation_attempted: false, reason_codes: ['RETENTION_ABSENCE_WITHOUT_OPERATION_HISTORY'] });
  }
  const operation = accepted.operation_receipt;
  const readback = backend.observeTarget({ expected, operation_receipt: operation, now });
  backend.recordReadback({ expected, operation_receipt: operation, readback });
  if (accepted.classification === 'DENIED_NOT_APPLIED') {
    return deepFreeze({ status: 'HOLD', fixture_only: true, mutation_authority: false,
      operation_attempted: true, effect_applied: false,
      reason_codes: ['DISPOSAL_BOUNDARY_CHANGED'], operation_id: operation.operation_id,
      operation_classification: operation.classification, observed_target_state: readback.state });
  }
  if (accepted.classification === 'UNKNOWN') {
    return deepFreeze({ status: readback.state === 'ABSENT' ? 'UNKNOWN_ABSENCE_OBSERVED' : 'HOLD',
      fixture_only: true, mutation_authority: false, operation_attempted: true, effect_applied: true,
      operation_id: operation.operation_id, operation_classification: operation.classification,
      observed_target_state: readback.state, absence_readback_id: readback.readback_id });
  }
  if (readback.state !== 'ABSENT') {
    return deepFreeze({ status: 'HOLD', fixture_only: true, mutation_authority: false,
      operation_attempted: true, effect_applied: true, reason_codes: ['RETENTION_ABSENCE_READBACK_INVALID'],
      operation_id: operation.operation_id, operation_classification: operation.classification,
      observed_target_state: readback.state });
  }
  const receiptValue = { schema: DISPOSAL_RECEIPT_SCHEMA, artifact_id: expected.artifact_id,
    operation_receipt: operation, absence_readback: readback };
  const validated = validateDisposalReceipt(receiptValue, expected, history.operations, trustedBindings);
  return deepFreeze({ status: 'COMPLETED', fixture_only: true, mutation_authority: false,
    operation_attempted: true, effect_applied: true, plan_digest: plan.plan_digest,
    target_authorization_digest: request.target_authorization.evidence_digest,
    native_acceptance_digest: trustedBindings.current_native_acceptance.evidence_digest,
    receipt: validated, retained_manifest: fixtureClone(FIXTURE_BACKEND_CONTROLS.get(backend).snapshot().manifest) });
}

function stateTargetMatches(artifact, expected) {
  return artifact.artifact_id === expected.artifact_id
    && digestValue(artifact.evidence_reference) === digestValue({
      evidence_id: artifact.evidence_reference?.evidence_id,
      content_digest: expected.content_digest
    })
    && artifact.evidence_reference?.content_digest === expected.content_digest;
}


function validateGitExpiryReceipt(value, expected, priorOperations = []) {
  const keys = ['schema', 'candidate_digest', 'module_digest', 'operation_id', 'repository_identity', 'ref',
    'before_head', 'before_tree', 'after_commit', 'after_parent', 'after_tree', 'removed_entries',
    'manifest_before_blob', 'manifest_after_blob', 'unchanged_tree_digest', 'approval_reference_digest',
    'effect_reference_digest', 'readback_reference_digest', 'classification', 'receipt_digest'];
  if (!exactKeys(value, keys) || value.schema !== GIT_EXPIRY_RECEIPT_SCHEMA
    || !exactKeys(expected, ['candidate_digest', 'module_digest', 'operation_id', 'repository_identity', 'ref',
      'before_head', 'before_tree', 'removed_entries', 'manifest_before_blob', 'unchanged_tree_digest'])
    || !digest(value.candidate_digest) || !digest(value.module_digest) || !safeId(value.operation_id)
    || typeof value.repository_identity !== 'string' || !value.repository_identity || value.repository_identity.includes('\u0000') || !safeId(value.ref) || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.before_head)
    || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.before_tree)
    || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.after_commit)
    || value.after_parent !== value.before_head || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.after_tree)
    || !Array.isArray(value.removed_entries) || !digest(value.manifest_before_blob) || !digest(value.manifest_after_blob)
    || !digest(value.unchanged_tree_digest) || !digest(value.approval_reference_digest)
    || !digest(value.effect_reference_digest) || !digest(value.readback_reference_digest)
    || value.classification !== 'READBACK_VERIFIED' || !digest(value.receipt_digest)
    || value.receipt_digest !== digestValue(unsigned(value, 'receipt_digest')) || !Array.isArray(priorOperations)) {
    fail('RETENTION_GIT_EXPIRY_RECEIPT_INVALID');
  }
  for (const key of ['candidate_digest', 'module_digest', 'operation_id', 'repository_identity', 'ref', 'before_head', 'before_tree', 'manifest_before_blob', 'unchanged_tree_digest']) {
    if (value[key] !== expected[key]) fail('RETENTION_GIT_EXPIRY_BINDING_INVALID');
  }
  if (canonicalSerialize(value.removed_entries) !== canonicalSerialize(expected.removed_entries)
    || priorOperations.some(item => item?.operation_id === value.operation_id)) fail('RETENTION_GIT_EXPIRY_DUPLICATE_OR_SCOPE');
  let previous = '';
  for (const item of value.removed_entries) {
    if (!exactKeys(item, ['path', 'mode', 'blob']) || !relativeInventoryPath(item.path)
      || !/^(100644|100755)$/.test(item.mode) || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(item.blob)
      || item.path <= previous) fail('RETENTION_GIT_EXPIRY_INVENTORY_INVALID');
    previous = item.path;
  }
  return deepFreeze({ ...value });
}

const CLEANUP_CONTEXT_FIELDS = Object.freeze(['read_current_manifest', 'persist_manifest_compare_and_swap',
  'read_operation_history', 'read_current_approval', 'read_independent_transfer_restore', 'read_independent_effect']);

function cleanupHold(code, details = {}) {
  return deepFreeze({ state: 'HOLD', code, mutation_authority: false, operation_attempted: false, ...details });
}

function validateCleanupRestore(value, artifact, now) {
  const anchor = artifact.transfer_anchor;
  const keys = ['artifact_id', 'transfer_id', 'transfer_evidence_reference_digest', 'independent_restore_reference_digest',
    'payload_digest', 'inventory_digest', 'restored_inventory', 'reader_id', 'restored_at_utc', 'evidence_digest'];
  if (!exactKeys(value, keys) || value.artifact_id !== artifact.artifact_id || value.transfer_id !== anchor.transfer_id
    || value.transfer_evidence_reference_digest !== anchor.transfer_evidence_reference_digest
    || value.independent_restore_reference_digest !== anchor.independent_restore_reference_digest
    || value.payload_digest !== anchor.payload_digest || value.inventory_digest !== anchor.inventory_digest
    || !Array.isArray(value.restored_inventory) || digestValue(value.restored_inventory) !== anchor.inventory_digest
    || !safeId(value.reader_id) || value.reader_id === anchor.producer_id
    || canonicalUtc(value.restored_at_utc) === null || canonicalUtc(value.restored_at_utc) > now
    || !digest(value.evidence_digest) || value.evidence_digest !== digestValue(unsigned(value, 'evidence_digest'))) return false;
  return true;
}

function validateCleanupApproval(value, proposal, artifact, current, nowIso) {
  const keys = ['schema', 'operation_id', 'artifact_id', 'operation_kind', 'safety_class', 'owner_id', 'target_digest',
    'effect_digest', 'manifest_revision', 'resources', 'expires_at_utc', 'revoked_at_utc',
    'native_binding', 'evidence_reference_digest', 'evidence_digest'];
  if (!exactKeys(value, keys) || value.schema !== 'toolkit.cleanup.action-approval.v1'
    || value.operation_id !== proposal.operation_id || value.artifact_id !== artifact.artifact_id
    || value.operation_kind !== proposal.operation_kind || value.safety_class !== proposal.safety_class || value.owner_id !== artifact.transfer_anchor.owner_id
    || value.target_digest !== proposal.target_digest || value.effect_digest !== proposal.effect_digest
    || value.manifest_revision !== current.revision || !Array.isArray(value.resources)
    || (proposal.resources && canonicalSerialize(value.resources) !== canonicalSerialize(proposal.resources))
    || canonicalUtc(value.expires_at_utc) === null || value.expires_at_utc <= nowIso
    || value.revoked_at_utc !== null
    || !digest(value.evidence_reference_digest) || !digest(value.evidence_digest)
    || value.evidence_digest !== digestValue(unsigned(value, 'evidence_digest'))
    || !exactKeys(value.native_binding, ['evidence_reference_digest', 'operation_kind', 'target_digest', 'effect_digest'])
    || !digest(value.native_binding.evidence_reference_digest)
    || value.native_binding.operation_kind !== proposal.operation_kind
    || value.native_binding.target_digest !== proposal.target_digest
    || value.native_binding.effect_digest !== proposal.effect_digest) return false;
  return true;
}

function cleanupProposalIdentity(proposal) {
  const keys = ['operation_id', 'operation_kind', 'target_digest', 'inventory_digest', 'source_digest',
    'target_relative', 'manifest_relative', 'inventory', 'candidate_digest', 'module_digest', 'native_helper_digest',
    'repository_identity', 'ref', 'manifest_path', 'removed_entries', 'unchanged_tree_digest'];
  return Object.fromEntries(keys.filter(key => proposal?.[key] !== undefined).map(key => [key, proposal[key]]));
}

function sameCleanupProposalIdentity(left, right) {
  return canonicalSerialize(cleanupProposalIdentity(left)) === canonicalSerialize(cleanupProposalIdentity(right));
}

function sameCleanupPending(left, right) {
  if (!isRecord(left) || !isRecord(right)) return false;
  return ['operation_id', 'operation_kind', 'target_digest', 'source_digest', 'inventory_digest', 'expected_backend_revision']
    .every(key => left[key] === right[key]);
}

function cleanupManifestRecord(value) {
  if (!exactKeys(value, ['manifest', 'revision', 'bytes_digest']) || !isRecord(value.manifest)
    || !safeId(value.revision) || !digest(value.bytes_digest) || digestValue(value.manifest) !== value.bytes_digest
    || ![LEGACY_RETENTION_VIEW_SCHEMA, RETENTION_VIEW_SCHEMA].includes(value.manifest.schema)
    || !Array.isArray(value.manifest.artifacts)) fail('CLEANUP_CURRENT_MANIFEST_INVALID');
  return value;
}

function createLifecycleCleanupController(options) {
  const optionKeys = ['store', 'admission', ...CLEANUP_CONTEXT_FIELDS, 'filesystem_backend', 'git_backend', 'clock', 'limits'];
  if (!exactKeys(options, optionKeys) || !options.store || !options.admission
    || typeof options.store.readV3RetentionPlan !== 'function'
    || CLEANUP_CONTEXT_FIELDS.some(name => typeof options[name] !== 'function')
    || typeof options.clock !== 'function' || !isRecord(options.limits)
    || !exactKeys(options.limits, ['max_artifacts', 'max_paths', 'max_bytes'])
    || !Number.isInteger(options.limits.max_artifacts) || options.limits.max_artifacts < 1 || options.limits.max_artifacts > 4
    || !Number.isInteger(options.limits.max_paths) || options.limits.max_paths < 1 || options.limits.max_paths > 64
    || !Number.isSafeInteger(options.limits.max_bytes) || options.limits.max_bytes < 1 || options.limits.max_bytes > MAX_GIT_DISPOSAL_BYTES) {
    fail('CLEANUP_CONTEXT_UNAVAILABLE');
  }
  assertAuthenticAuthorityPacketStore(options.store);
  assertAuthenticSemanticGateAdmission(options.store, options.admission);
  if (typeof options.store.createV3CleanupExecutionContext !== 'function') fail('CLEANUP_CONTEXT_UNAVAILABLE');
  const trustedContext = options.store.createV3CleanupExecutionContext(options.admission);
  if (!trustedContext || CLEANUP_CONTEXT_FIELDS.some(name => options[name] !== trustedContext[name])) fail('CLEANUP_CONTEXT_UNAVAILABLE');
  const captured = Object.freeze({ ...options });
  const readCurrent = () => cleanupManifestRecord(captured.read_current_manifest());
  const currentTime = () => {
    const raw = captured.clock();
    const ms = canonicalUtc(raw);
    if (ms === null) fail('CLEANUP_TRUSTED_CLOCK_INVALID');
    return { raw, ms };
  };
  function readVerifiedPlan(ownOperationId = null, expectedPendingState = null, ownArtifactId = null) {
    const retained = captured.store.readV3RetentionPlan(captured.admission);
    if (!isRecord(retained) || retained.mutation_authority !== false || !digest(retained.plan_digest)) fail('CLEANUP_STORE_ADMISSION_UNVERIFIED');
    const current = readCurrent();
    if (!digest(retained.current_manifest_revision) || !digest(retained.current_manifest_bytes_digest)
      || retained.current_manifest_revision !== current.revision || retained.current_manifest_bytes_digest !== current.bytes_digest) {
      fail('CLEANUP_MANIFEST_SNAPSHOT_DRIFT');
    }
    const time = currentTime();
    let manifestForPlan = current.manifest;
    if (ownOperationId !== null) {
      if (!safeId(ownOperationId) || !safeId(ownArtifactId) || !['PREPARED', 'IN_FLIGHT', 'UNKNOWN', 'PARTIAL'].includes(expectedPendingState)) {
        fail('CLEANUP_PENDING_OPERATION_INVALID');
      }
      manifestForPlan = structuredClone(current.manifest);
      const artifact = manifestForPlan.artifacts.find(item => item.artifact_id === ownArtifactId);
      if (!artifact?.pending_cleanup || artifact.pending_cleanup.operation_id !== ownOperationId
        || artifact.pending_cleanup.state !== expectedPendingState) fail('CLEANUP_PENDING_OPERATION_DRIFT');
      delete artifact.pending_cleanup;
    }
    const plan = planRetention(manifestForPlan, { now: time.raw, trusted_clock: true });
    const ids = new Set(current.manifest.artifacts.map(item => item.artifact_id));
    if (ids.size !== current.manifest.artifacts.length) fail('CLEANUP_CURRENT_MANIFEST_INVALID');
    return { retained, current, plan, time };
  }
  function planOnUse(request) {
    if (!exactKeys(request, ['artifact_ids', 'max_artifacts']) || !Array.isArray(request.artifact_ids)
      || request.artifact_ids.length > captured.limits.max_artifacts || !Number.isInteger(request.max_artifacts)
      || request.max_artifacts < 1 || request.max_artifacts > captured.limits.max_artifacts
      || request.artifact_ids.length > request.max_artifacts || new Set(request.artifact_ids).size !== request.artifact_ids.length
      || request.artifact_ids.some(id => !safeId(id))) return cleanupHold('CLEANUP_BATCH_LIMIT');
    let snapshot;
    try { snapshot = readVerifiedPlan(); } catch (error) { return cleanupHold(error.code || 'CLEANUP_PLAN_UNAVAILABLE'); }
    if (snapshot.current.manifest.schema !== RETENTION_VIEW_SCHEMA) {
      return deepFreeze({ state: 'PLANNED', plan: snapshot.plan, decisions: request.artifact_ids.map(artifact_id => ({
        artifact_id, disposition: 'HOLD', reason_codes: [HOLD.LEGACY_EFFECT_BLOCKED]
      })), mutation_authority: false });
    }
    const byId = new Map(snapshot.current.manifest.artifacts.map(item => [item.artifact_id, item]));
    const decisions = [];
    for (const artifactId of request.artifact_ids) {
      const artifact = byId.get(artifactId);
      const planned = snapshot.plan.decisions.find(item => item.artifact_id === artifactId);
      if (!artifact || !planned) { decisions.push({ artifact_id: artifactId, disposition: 'HOLD', reason_codes: ['CLEANUP_ARTIFACT_UNKNOWN'] }); continue; }
      if (artifact.retention_class !== 'DURABLE_EVIDENCE') {
        let restored = false;
        try { restored = validateCleanupRestore(captured.read_independent_transfer_restore({ artifact, current_manifest: snapshot.current, revision: snapshot.current.revision }), artifact, snapshot.time.ms); }
        catch (_) { restored = false; }
        if (!restored) { decisions.push({ artifact_id: artifactId, disposition: 'HOLD', reason_codes: ['TRANSFER_RESTORE_UNVERIFIED'] }); continue; }
      }
      decisions.push(planned);
    }
    return deepFreeze({ state: 'PLANNED', plan: snapshot.plan, decisions, manifest_revision: snapshot.current.revision,
      mutation_authority: false });
  }
  function executeOnUse(request) {
    if (!exactKeys(request, ['artifact_ids', 'operation_ids']) || !Array.isArray(request.artifact_ids)
      || !Array.isArray(request.operation_ids) || request.artifact_ids.length > captured.limits.max_artifacts
      || request.artifact_ids.length !== request.operation_ids.length) return cleanupHold('CLEANUP_BATCH_LIMIT');
    const results = [];
    for (let i = 0; i < request.artifact_ids.length; i++) {
      const artifactId = request.artifact_ids[i], operationId = request.operation_ids[i];
      if (!safeId(operationId)) { results.push(cleanupHold('CLEANUP_OPERATION_ID_INVALID', { artifact_id: artifactId })); continue; }
      let snapshot;
      try { snapshot = readVerifiedPlan(); } catch (error) { results.push(cleanupHold(error.code || 'CLEANUP_PLAN_UNAVAILABLE', { artifact_id: artifactId })); continue; }
      const artifact = snapshot.current.manifest.artifacts.find(item => item.artifact_id === artifactId);
      const decision = snapshot.plan.decisions.find(item => item.artifact_id === artifactId);
      if (artifact?.pending_cleanup && artifact.pending_cleanup.state !== 'READBACK_VERIFIED') {
        const pending = artifact.pending_cleanup;
        const isGitPending = pending.operation_kind === 'GIT_CURRENT_TREE_REMOVE'
          && artifact.disposal_target?.kind === 'GIT_CURRENT_TREE';
        const isDirectoryPending = pending.operation_kind === 'DISPOSAL_DELETE'
          && artifact.disposal_target?.kind === 'DIRECTORY_DISPOSAL';
        const backend = isGitPending ? captured.git_backend : isDirectoryPending ? captured.filesystem_backend : null;
        const recover = isGitPending ? backend?.recover : isDirectoryPending ? backend?.recoverDirectoryDisposal : null;
        let recovery = null, history = null, independent = null;
        try {
          if (!backend || typeof recover !== 'function' || !safeId(pending.operation_id)) throw new Error('CLEANUP_PENDING_TARGET_UNRESOLVED');
          const pendingSnapshot = readVerifiedPlan(pending.operation_id, pending.state, artifactId);
          const currentArtifact = pendingSnapshot.current.manifest.artifacts.find(item => item.artifact_id === artifactId);
          if (!currentArtifact || currentArtifact.disposal_target?.kind !== artifact.disposal_target?.kind
            || !sameCleanupPending(currentArtifact.pending_cleanup, pending)) throw new Error('CLEANUP_PENDING_OPERATION_DRIFT');
          history = captured.read_operation_history({ artifact_id: artifactId, operation_id: pending.operation_id,
            current_manifest: pendingSnapshot.current, revision: pendingSnapshot.current.revision,
            pending_operation: pending, disposal_target: currentArtifact.disposal_target });
          if (!Array.isArray(history)) throw new Error('CLEANUP_OPERATION_HISTORY_UNAVAILABLE');
          recovery = recover.call(backend, { artifact: currentArtifact, pending_operation: pending,
            disposal_target: currentArtifact.disposal_target, operation_history: history });
          independent = captured.read_independent_effect({ artifact_id: artifactId, operation_id: pending.operation_id,
            operation_kind: pending.operation_kind, pending_operation: pending, disposal_target: currentArtifact.disposal_target,
            operation_history: history, recovery, revision: pendingSnapshot.current.revision });
        } catch (error) {
          recovery = recovery || { state: 'UNKNOWN', code: error.code || 'CLEANUP_PENDING_RECONCILIATION_UNKNOWN', operation_attempted: false };
        }
        if (isGitPending && recovery?.state === 'ATTRIBUTABLE_COMPLETION') {
          try {
            const original = recovery.original_receipt;
            const expected = { candidate_digest: recovery.candidate_digest, module_digest: recovery.module_digest,
              operation_id: pending.operation_id, repository_identity: recovery.repository_identity, ref: recovery.ref,
              before_head: original?.before_head, before_tree: original?.before_tree, removed_entries: original?.removed_entries,
              manifest_before_blob: original?.manifest_before_blob, unchanged_tree_digest: original?.unchanged_tree_digest };
            const raw = validateGitExpiryReceipt(original, expected, []);
            if (!isRecord(independent) || independent.classification !== 'READBACK_VERIFIED'
              || independent.operation_attempted !== false || independent.operation_id !== pending.operation_id
              || independent.operation_kind !== pending.operation_kind || independent.target_digest !== pending.target_digest
              || independent.inventory_digest !== pending.inventory_digest || independent.after_commit !== raw.after_commit
              || independent.after_parent !== raw.after_parent || independent.after_tree !== raw.after_tree
              || independent.historical_bytes_verified !== true || independent.removed_entries_absent !== true
              || !digest(independent.readback_reference_digest)
              || independent.evidence_digest !== digestValue(unsigned(independent, 'evidence_digest'))) {
              fail('CLEANUP_PENDING_ATTRIBUTION_UNVERIFIED');
            }
            const current = readVerifiedPlan(pending.operation_id, 'IN_FLIGHT', artifactId);
            const revision = digestValue({ repository_identity: raw.repository_identity, ref: raw.ref, head: raw.after_commit });
            const currentArtifact = current.current.manifest.artifacts.find(item => item.artifact_id === artifactId);
            if (current.current.revision !== revision || current.plan.decisions.find(item => item.artifact_id === artifactId)?.disposition !== 'ELIGIBLE_NOW'
              || !sameCleanupPending(currentArtifact?.pending_cleanup, pending)) fail('CLEANUP_PENDING_RECONCILIATION_DRIFT');
            const terminal = structuredClone(current.current.manifest);
            const targetArtifact = terminal.artifacts.find(item => item.artifact_id === artifactId);
            targetArtifact.pending_cleanup = { ...targetArtifact.pending_cleanup, state: 'READBACK_VERIFIED',
              approval_evidence_reference: raw.approval_reference_digest,
              outcome_evidence_reference: raw.receipt_digest, readback_evidence_reference: independent.readback_reference_digest };
            const targetIdentity = normalizeTargetIdentity(targetArtifact.expected_target_identity);
            const targetHash = targetDigest(targetIdentity);
            const operationCore = { operation_id: pending.operation_id, operation_kind: pending.operation_kind,
              target_identity: targetIdentity, target_digest: targetHash, scope_target_digests: [targetHash],
              source_digest: pending.source_digest, safety_class: 'RECOVERABLE_GIT_TREE_CHANGE',
              classification: 'APPLIED', attempt_number: 1, retry_of_operation_id: null,
              native_approval_evidence_digest: raw.approval_reference_digest, outcome_evidence_digest: raw.receipt_digest,
              no_effect_observation_digest: null, executor_id: 'toolkit-git-current-tree-expiry-adapter' };
            const operationReceipt = { ...operationCore, receipt_digest: digestValue(operationCore) };
            const operationEvent = { schema: DISPOSAL_OBSERVATION_SCHEMA, kind: 'OPERATION', operation_receipt: operationReceipt };
            const readbackCore = { readback_id: pending.operation_id + '-readback', reader_id: 'toolkit-git-current-tree-independent-reader',
              target_identity: targetIdentity, target_digest: targetHash, state: 'ABSENT', observed_at: current.time.raw,
              operation_receipt_digest: operationReceipt.receipt_digest };
            const readback = { ...readbackCore, evidence_digest: digestValue(readbackCore) };
            const readbackEvent = { schema: DISPOSAL_OBSERVATION_SCHEMA, kind: 'READBACK', operation_id: pending.operation_id, readback };
            const priorEvents = targetArtifact.disposal_observations || [];
            if (priorEvents.length > 510) fail('CLEANUP_DISPOSAL_HISTORY_LIMIT');
            targetArtifact.disposal_observations = [...priorEvents,
              { ...operationEvent, event_digest: digestValue(operationEvent) },
              { ...readbackEvent, event_digest: digestValue(readbackEvent) }];
            const persisted = captured.persist_manifest_compare_and_swap(current.current.revision, terminal);
            const reread = readCurrent();
            const rereadPending = reread.manifest.artifacts.find(item => item.artifact_id === artifactId)?.pending_cleanup;
            if (persisted?.state !== 'APPLIED' || reread.revision !== persisted.revision
              || reread.bytes_digest !== persisted.bytes_digest || rereadPending?.state !== 'READBACK_VERIFIED'
              || rereadPending.operation_id !== pending.operation_id || rereadPending.outcome_evidence_reference !== raw.receipt_digest) {
              fail('CLEANUP_PENDING_TERMINAL_READBACK_UNVERIFIED');
            }
            results.push(deepFreeze({ state: 'READBACK_VERIFIED', artifact_id: artifactId, operation_id: pending.operation_id,
              operation_kind: pending.operation_kind, reconciled: true, operation_attempted: false, mutation_authority: false,
              receipt: { state: 'READBACK_VERIFIED', receipt: raw }, independent_observation: independent,
              terminal_revision: reread.revision }));
            continue;
          } catch (error) {
            results.push(cleanupHold(error.code || 'CLEANUP_PENDING_RECONCILIATION_UNKNOWN', { artifact_id: artifactId,
              operation_id: pending.operation_id, recovery, independent_observation: independent || null }));
            continue;
          }
        }
        results.push(cleanupHold('CLEANUP_PENDING_RECONCILIATION_NO_REPLAY', { artifact_id: artifactId,
          operation_id: pending.operation_id, recovery, independent_observation: independent || null }));
        continue;
      }
      if (!artifact || !decision || decision.disposition !== 'ELIGIBLE_NOW' || !artifact.disposal_target) {
        results.push(cleanupHold('CLEANUP_NOT_ELIGIBLE', { artifact_id: artifactId, reason_codes: decision?.reason_codes || [] })); continue;
      }
      if (snapshot.current.manifest.schema !== RETENTION_VIEW_SCHEMA) { results.push(cleanupHold(HOLD.LEGACY_EFFECT_BLOCKED, { artifact_id: artifactId })); continue; }
      const history = captured.read_operation_history({ artifact_id: artifactId, current_manifest: snapshot.current, revision: snapshot.current.revision });
      if (!Array.isArray(history) || history.some(item => item?.operation_id === operationId)) {
        results.push(cleanupHold('CLEANUP_OPERATION_DUPLICATE', { artifact_id: artifactId, operation_id: operationId })); continue;
      }
      let restored;
      try { restored = captured.read_independent_transfer_restore({ artifact_id: artifactId, artifact,
        anchor: artifact.transfer_anchor, revision: snapshot.current.revision }); }
      catch (error) { results.push(cleanupHold(error.code || 'CLEANUP_TRANSFER_RESTORE_UNAVAILABLE', { artifact_id: artifactId })); continue; }
      if (!validateCleanupRestore(restored, artifact, snapshot.time.ms)) {
        results.push(cleanupHold('CLEANUP_TRANSFER_RESTORE_UNVERIFIED', { artifact_id: artifactId })); continue;
      }
      const isGit = artifact.disposal_target.kind === 'GIT_CURRENT_TREE';
      const isDirectory = artifact.disposal_target.kind === 'DIRECTORY_DISPOSAL';
      const backend = isGit ? captured.git_backend : captured.filesystem_backend;
      const operationKind = isGit ? 'GIT_CURRENT_TREE_REMOVE' : 'DISPOSAL_DELETE';
      const safetyClass = isGit ? 'RECOVERABLE_GIT_TREE_CHANGE' : 'IRREVERSIBLE_DIRECTORY_DISPOSAL';
      const executeEffect = isDirectory ? backend?.executeDirectoryDisposal : backend?.execute;
      const recoverEffect = isDirectory ? backend?.recoverDirectoryDisposal : backend?.recover;
      if ((!isGit && !isDirectory) || !backend || typeof backend.prepare !== 'function'
        || typeof executeEffect !== 'function' || typeof recoverEffect !== 'function') {
        results.push(cleanupHold('CLEANUP_BACKEND_UNAVAILABLE', { artifact_id: artifactId })); continue;
      }
      let proposal;
      try { proposal = backend.prepare({ artifact, current_manifest: snapshot.current.manifest, revision: snapshot.current.revision,
        plan: snapshot.plan, limits: captured.limits, operation_id: operationId, operation_kind: operationKind, safety_class: safetyClass }); }
      catch (error) { results.push(cleanupHold(error.code || 'CLEANUP_PREPARE_FAILED', { artifact_id: artifactId })); continue; }
      if (!isRecord(proposal) || proposal.operation_id !== operationId || proposal.operation_kind !== operationKind
        || !digest(proposal.effect_digest) || !digest(proposal.target_digest) || !digest(proposal.inventory_digest)
        || !safeId(proposal.backend_revision)) { results.push(cleanupHold('CLEANUP_PROPOSAL_INVALID', { artifact_id: artifactId })); continue; }
      const prepared = { operation_id: operationId, operation_kind: operationKind, target_digest: proposal.target_digest,
        source_digest: artifact.transfer_anchor.payload_digest, manifest_revision: snapshot.current.revision,
        inventory_digest: proposal.inventory_digest, expected_backend_revision: proposal.backend_revision,
        state: 'PREPARED', approval_evidence_reference: null, outcome_evidence_reference: null, readback_evidence_reference: null };
      const preparedProposal = cleanupProposalIdentity(proposal);
      const preparedManifest = { ...snapshot.current.manifest, artifacts: snapshot.current.manifest.artifacts.map(item =>
        item.artifact_id === artifactId ? { ...item, pending_cleanup: prepared } : item) };
      let persisted;
      try { persisted = captured.persist_manifest_compare_and_swap(snapshot.current.revision, preparedManifest); }
      catch (_) { persisted = null; }
      if (!isRecord(persisted) || persisted.state !== 'APPLIED' || !safeId(persisted.revision) || !digest(persisted.bytes_digest)) {
        results.push(cleanupHold('CLEANUP_PREPARED_CAS_FAILED', { artifact_id: artifactId, operation_id: operationId })); continue;
      }
      let actionSnapshot, approval, preparedArtifact;
      try {
        actionSnapshot = readVerifiedPlan(operationId, 'PREPARED', artifactId);
        if (actionSnapshot.current.revision !== persisted.revision) fail('CLEANUP_PREPARED_READBACK_MISMATCH');
        preparedArtifact = actionSnapshot.current.manifest.artifacts.find(item => item.artifact_id === artifactId);
        if (!preparedArtifact || !sameCleanupPending(preparedArtifact.pending_cleanup, prepared)) fail('CLEANUP_PREPARED_READBACK_MISMATCH');
        proposal = backend.prepare({ artifact: preparedArtifact,
          current_manifest: actionSnapshot.current.manifest, revision: actionSnapshot.current.revision, plan: actionSnapshot.plan,
          limits: captured.limits, operation_id: operationId, operation_kind: operationKind, safety_class: safetyClass });
        approval = captured.read_current_approval({ artifact_id: artifactId, operation_id: operationId,
          operation_kind: operationKind, proposal, current_manifest: actionSnapshot.current, revision: actionSnapshot.current.revision });
      } catch (error) { results.push(cleanupHold(error.code || 'CLEANUP_APPROVAL_UNAVAILABLE', { artifact_id: artifactId, operation_id: operationId })); continue; }
      if (actionSnapshot.plan.decisions.find(item => item.artifact_id === artifactId)?.disposition !== 'ELIGIBLE_NOW'
        || preparedArtifact.pending_cleanup.state !== 'PREPARED'
        || !validateCleanupApproval(approval, proposal, actionSnapshot.current.manifest.artifacts.find(item => item.artifact_id === artifactId),
          actionSnapshot.current, currentTime().raw)) {
        results.push(cleanupHold('CLEANUP_CURRENT_APPROVAL_INVALID', { artifact_id: artifactId, operation_id: operationId })); continue;
      }
      if (!sameCleanupProposalIdentity(proposal, preparedProposal)) {
        results.push(cleanupHold('CLEANUP_PROPOSAL_DRIFT', { artifact_id: artifactId, operation_id: operationId })); continue;
      }
      let executionSnapshot = actionSnapshot.current;
      if (isDirectory) {
        const inflightManifest = { ...actionSnapshot.current.manifest, artifacts: actionSnapshot.current.manifest.artifacts.map(item =>
          item.artifact_id === artifactId ? { ...item, pending_cleanup: { ...prepared, manifest_revision: actionSnapshot.current.revision,
            state: 'IN_FLIGHT', approval_evidence_reference: approval.evidence_reference_digest } } : item) };
        let inflight;
        try { inflight = captured.persist_manifest_compare_and_swap(actionSnapshot.current.revision, inflightManifest); } catch (_) { inflight = null; }
        if (!isRecord(inflight) || inflight.state !== 'APPLIED' || !safeId(inflight.revision)) {
          results.push(cleanupHold('CLEANUP_IN_FLIGHT_CAS_FAILED', { artifact_id: artifactId, operation_id: operationId })); continue;
        }
        try {
          const inflightSnapshot = readVerifiedPlan(operationId, 'IN_FLIGHT', artifactId);
          executionSnapshot = inflightSnapshot.current;
          if (executionSnapshot.revision !== inflight.revision) fail('CLEANUP_IN_FLIGHT_READBACK_MISMATCH');
          const currentArtifact = executionSnapshot.manifest.artifacts.find(item => item.artifact_id === artifactId);
          if (!currentArtifact || currentArtifact.pending_cleanup?.state !== 'IN_FLIGHT' || !sameCleanupPending(currentArtifact.pending_cleanup,
            { ...prepared, state: 'IN_FLIGHT', approval_evidence_reference: approval.evidence_reference_digest })) {
            fail('CLEANUP_IN_FLIGHT_READBACK_MISMATCH');
          }
          if (inflightSnapshot.plan.decisions.find(item => item.artifact_id === artifactId)?.disposition !== 'ELIGIBLE_NOW') {
            fail('CLEANUP_NOT_ELIGIBLE');
          }
          proposal = backend.prepare({ artifact: currentArtifact, current_manifest: executionSnapshot.manifest,
            revision: executionSnapshot.revision, plan: inflightSnapshot.plan, limits: captured.limits, operation_id: operationId,
            operation_kind: operationKind, safety_class: safetyClass });
          approval = captured.read_current_approval({ artifact_id: artifactId, operation_id: operationId,
            operation_kind: operationKind, proposal, current_manifest: executionSnapshot, revision: executionSnapshot.revision });
        } catch (error) { results.push(cleanupHold(error.code || 'CLEANUP_APPROVAL_UNAVAILABLE', { artifact_id: artifactId, operation_id: operationId })); continue; }
        if (!validateCleanupApproval(approval, proposal, executionSnapshot.manifest.artifacts.find(item => item.artifact_id === artifactId),
          executionSnapshot, currentTime().raw)) {
          results.push(cleanupHold('CLEANUP_CURRENT_APPROVAL_INVALID', { artifact_id: artifactId, operation_id: operationId })); continue;
        }
      }
      let finalSnapshot;
      try {
        finalSnapshot = readVerifiedPlan(operationId, isDirectory ? 'IN_FLIGHT' : 'PREPARED', artifactId);
        if (finalSnapshot.current.revision !== executionSnapshot.revision
          || finalSnapshot.current.bytes_digest !== executionSnapshot.bytes_digest
          || finalSnapshot.plan.decisions.find(item => item.artifact_id === artifactId)?.disposition !== 'ELIGIBLE_NOW') {
          fail('CLEANUP_ACTION_SNAPSHOT_DRIFT');
        }
        const finalArtifact = finalSnapshot.current.manifest.artifacts.find(item => item.artifact_id === artifactId);
        const expectedPhaseState = isDirectory ? 'IN_FLIGHT' : 'PREPARED';
        if (!finalArtifact || finalArtifact.pending_cleanup?.state !== expectedPhaseState
          || finalArtifact.pending_cleanup.operation_id !== operationId
          || !sameCleanupPending(finalArtifact.pending_cleanup, prepared)) fail('CLEANUP_ACTION_SNAPSHOT_DRIFT');
        const finalProposal = backend.prepare({ artifact: finalArtifact, current_manifest: finalSnapshot.current.manifest,
          revision: finalSnapshot.current.revision, plan: finalSnapshot.plan, limits: captured.limits,
          operation_id: operationId, operation_kind: operationKind, safety_class: safetyClass });
        const finalApproval = captured.read_current_approval({ artifact_id: artifactId, operation_id: operationId,
          operation_kind: operationKind, proposal: finalProposal, current_manifest: finalSnapshot.current, revision: finalSnapshot.current.revision });
        if (canonicalSerialize(finalProposal) !== canonicalSerialize(proposal)
          || !validateCleanupApproval(finalApproval, finalProposal, finalArtifact, finalSnapshot.current, currentTime().raw)) {
          fail('CLEANUP_ACTION_APPROVAL_STALE');
        }
        proposal = finalProposal;
        approval = finalApproval;
      } catch (error) { results.push(cleanupHold(error.code || 'CLEANUP_ACTION_REVALIDATION_FAILED', { artifact_id: artifactId, operation_id: operationId })); continue; }
      let receipt, observed;
      try {
        receipt = executeEffect.call(backend, { proposal, accepted_action: approval });
        observed = captured.read_independent_effect({ artifact_id: artifactId, operation_id: operationId,
          operation_kind: operationKind, proposal, receipt, revision: executionSnapshot.revision });
      } catch (error) {
        results.push(cleanupHold(error.code || 'CLEANUP_EFFECT_UNKNOWN', { artifact_id: artifactId, operation_id: operationId })); continue;
      }
      let verifiedGitReceipt = null;
      if (isGit && isRecord(receipt?.receipt)) {
        const expectedGit = { candidate_digest: proposal.candidate_digest, module_digest: proposal.module_digest,
          operation_id: operationId, repository_identity: proposal.repository_identity, ref: proposal.ref,
          before_head: proposal.before_head, before_tree: proposal.before_tree, removed_entries: proposal.removed_entries,
          manifest_before_blob: proposal.manifest_before_blob, unchanged_tree_digest: proposal.unchanged_tree_digest };
        try { verifiedGitReceipt = validateGitExpiryReceipt(receipt.receipt, expectedGit, history); } catch (_) { verifiedGitReceipt = null; }
      }
      const commonObservationValid = isRecord(observed) && observed.operation_id === operationId && observed.operation_kind === operationKind
        && observed.effect_digest === proposal.effect_digest && canonicalUtc(observed.observed_at_utc) !== null
        && digest(observed.readback_reference_digest) && digest(observed.evidence_digest)
        && observed.evidence_digest === digestValue(unsigned(observed, 'evidence_digest'));
      const verified = commonObservationValid && (isGit
        ? receipt?.state === 'READBACK_VERIFIED' && verifiedGitReceipt && observed.classification === 'READBACK_VERIFIED'
          && observed.after_commit === verifiedGitReceipt.after_commit && observed.after_parent === proposal.before_head
          && observed.after_tree === verifiedGitReceipt.after_tree && observed.removed_entries_absent === true
          && observed.unrelated_tree_digest === proposal.unchanged_tree_digest
          && observed.manifest_after_blob === verifiedGitReceipt.manifest_after_blob && observed.historical_bytes_verified === true
        : observed.classification === 'READBACK_VERIFIED');
      const deniedNotApplied = commonObservationValid && isGit && receipt?.state === 'DENIED_NOT_APPLIED'
        && receipt.operation_attempted === false && observed.classification === 'DENIED_NOT_APPLIED'
        && observed.operation_attempted === false && observed.current_head === proposal.before_head
        && observed.before_tree === proposal.before_tree && observed.target_inventory_present === true
        && observed.no_effect_observation?.operation_id === operationId
        && observed.no_effect_observation?.operation_kind === operationKind
        && observed.no_effect_observation?.before_head === proposal.before_head
        && observed.no_effect_observation?.before_tree === proposal.before_tree
        && observed.no_effect_observation?.target_digest === proposal.target_digest
        && observed.no_effect_observation?.effect_digest === proposal.effect_digest
        && observed.no_effect_observation?.operation_attempted === false
        && observed.no_effect_observation?.target_inventory_present === true
        && digest(observed.no_effect_observation_digest)
        && observed.no_effect_observation_digest === digestValue(unsigned(observed.no_effect_observation, 'evidence_digest'))
        && digest(observed.no_effect_observation.evidence_digest);
      const terminalState = verified ? 'READBACK_VERIFIED' : deniedNotApplied ? 'DENIED_NOT_APPLIED' : 'UNKNOWN';
      const terminalSnapshot = readCurrent();
      if (terminalState === 'UNKNOWN') {
        let unknownPersisted = null;
        const expectedPriorState = isDirectory ? 'IN_FLIGHT' : 'PREPARED';
        const unknownManifest = structuredClone(terminalSnapshot.manifest);
        const unknownArtifact = unknownManifest.artifacts.find(item => item.artifact_id === artifactId);
        const pendingEvidenceRef = digest(receipt?.evidence_reference_digest) ? receipt.evidence_reference_digest
          : digest(receipt?.attempt_evidence_digest) ? receipt.attempt_evidence_digest : null;
        if (unknownArtifact?.pending_cleanup?.operation_id === operationId
          && unknownArtifact.pending_cleanup.state === expectedPriorState
          && sameCleanupPending(unknownArtifact.pending_cleanup, prepared)) {
          unknownArtifact.pending_cleanup = { ...unknownArtifact.pending_cleanup, state: 'UNKNOWN',
            ...(pendingEvidenceRef ? { outcome_evidence_reference: pendingEvidenceRef } : {}),
            ...(commonObservationValid ? { readback_evidence_reference: observed.readback_reference_digest } : {}) };
          try { unknownPersisted = captured.persist_manifest_compare_and_swap(terminalSnapshot.revision, unknownManifest); }
          catch (_) { unknownPersisted = null; }
        }
        results.push(cleanupHold('CLEANUP_OUTCOME_UNKNOWN', { artifact_id: artifactId, operation_id: operationId,
          operation_attempted: receipt?.operation_attempted === true, receipt: receipt || null,
          independent_observation: observed || null, observed_revision: terminalSnapshot.revision,
          pending_state_persisted: unknownPersisted?.state === 'APPLIED', pending_revision: unknownPersisted?.revision || null })); continue;
      }
      const expectedTerminalRevision = verified && isGit ? digestValue({ repository_identity: proposal.repository_identity,
        ref: proposal.ref, head: verifiedGitReceipt.after_commit }) : executionSnapshot.revision;
      if (terminalSnapshot.revision !== expectedTerminalRevision) {
        results.push(cleanupHold('CLEANUP_TERMINAL_SNAPSHOT_DRIFT', { artifact_id: artifactId, operation_id: operationId,
          expected_revision: expectedTerminalRevision, observed_revision: terminalSnapshot.revision,
          receipt: receipt || null, independent_observation: observed || null })); continue;
      }
      let terminalManifest = structuredClone(terminalSnapshot.manifest);
      const terminalArtifact = terminalManifest.artifacts.find(item => item.artifact_id === artifactId);
      const allowedPriorState = verified ? 'IN_FLIGHT' : isDirectory ? 'IN_FLIGHT' : 'PREPARED';
      if (!terminalArtifact?.pending_cleanup || terminalArtifact.pending_cleanup.operation_id !== operationId
        || terminalArtifact.pending_cleanup.state !== allowedPriorState
        || !sameCleanupPending(terminalArtifact.pending_cleanup, prepared)) {
        results.push(cleanupHold('CLEANUP_PENDING_OPERATION_DRIFT', { artifact_id: artifactId, operation_id: operationId })); continue;
      }
      terminalArtifact.pending_cleanup = { ...prepared, manifest_revision: executionSnapshot.revision, state: terminalState,
        approval_evidence_reference: approval.evidence_reference_digest,
        outcome_evidence_reference: verifiedGitReceipt?.receipt_digest || (isRecord(receipt) && digest(receipt.evidence_reference_digest)
          ? receipt.evidence_reference_digest : digestValue(receipt)),
        readback_evidence_reference: commonObservationValid ? observed.readback_reference_digest : null };
      if (isGit) {
        const targetIdentity = normalizeTargetIdentity(artifact.expected_target_identity), targetHash = targetDigest(targetIdentity);
        const operationCore = { operation_id: operationId, operation_kind: 'GIT_CURRENT_TREE_REMOVE',
          target_identity: targetIdentity, target_digest: targetHash, scope_target_digests: [targetHash],
          source_digest: artifact.transfer_anchor.payload_digest, safety_class: safetyClass,
          classification: verified ? 'APPLIED' : 'DENIED_NOT_APPLIED', attempt_number: 1, retry_of_operation_id: null,
          native_approval_evidence_digest: approval.evidence_reference_digest,
          outcome_evidence_digest: verifiedGitReceipt?.receipt_digest || observed.evidence_digest,
          no_effect_observation_digest: deniedNotApplied ? observed.no_effect_observation_digest : null,
          executor_id: 'toolkit-git-current-tree-expiry-adapter' };
        const operationReceipt = { ...operationCore, receipt_digest: digestValue(operationCore) };
        const operationEventCore = { schema: DISPOSAL_OBSERVATION_SCHEMA, kind: 'OPERATION', operation_receipt: operationReceipt };
        const operationEvent = { ...operationEventCore, event_digest: digestValue(operationEventCore) };
        const appendedEvents = [operationEvent];
        if (commonObservationValid && (verified || deniedNotApplied)) {
          const readbackCore = { readback_id: `${operationId}-readback`, reader_id: 'toolkit-git-current-tree-independent-reader',
            target_identity: targetIdentity, target_digest: targetHash, state: verified ? 'ABSENT' : 'PRESENT', observed_at: observed.observed_at_utc,
            operation_receipt_digest: operationReceipt.receipt_digest };
          const readback = { ...readbackCore, evidence_digest: digestValue(readbackCore) };
          const readbackEventCore = { schema: DISPOSAL_OBSERVATION_SCHEMA, kind: 'READBACK', operation_id: operationId, readback };
          appendedEvents.push({ ...readbackEventCore, event_digest: digestValue(readbackEventCore) });
        }
        const existing = Array.isArray(terminalArtifact.disposal_observations) ? terminalArtifact.disposal_observations : [];
        if (existing.length > 512 - appendedEvents.length) { results.push(cleanupHold('CLEANUP_DISPOSAL_HISTORY_LIMIT', { artifact_id: artifactId })); continue; }
        terminalArtifact.disposal_observations = [...existing, ...appendedEvents];
      }
      let finalWrite;
      try { finalWrite = captured.persist_manifest_compare_and_swap(terminalSnapshot.revision, terminalManifest); } catch (_) { finalWrite = null; }
      let terminalReadbackVerified = false;
      try {
        const reread = readCurrent();
        const pendingReadback = reread.manifest.artifacts.find(item => item.artifact_id === artifactId)?.pending_cleanup;
        terminalReadbackVerified = isRecord(finalWrite) && finalWrite.state === 'APPLIED'
          && reread.revision === finalWrite.revision && reread.bytes_digest === finalWrite.bytes_digest
          && pendingReadback?.state === terminalState && pendingReadback.operation_id === operationId
          && sameCleanupPending(pendingReadback, prepared);
      } catch (_) { terminalReadbackVerified = false; }
      results.push(verified && terminalReadbackVerified
        ? deepFreeze({ state: 'READBACK_VERIFIED', artifact_id: artifactId, operation_id: operationId,
          operation_kind: operationKind, receipt, independent_observation: observed, mutation_authority: false })
        : deniedNotApplied && terminalReadbackVerified
          ? cleanupHold('CLEANUP_EFFECT_NOT_APPLIED', { artifact_id: artifactId, operation_id: operationId, operation_attempted: false })
          : cleanupHold('CLEANUP_OUTCOME_UNVERIFIED', { artifact_id: artifactId, operation_id: operationId, receipt: receipt || null }));
    }
    return deepFreeze({ state: 'COMPLETED_WITH_HOLDS', results, mutation_authority: false });
  }
  return Object.freeze({ planOnUse, executeOnUse });
}

// Retained resources (processes, worktrees, directories, branches, issues and remote
// artifacts) kept beyond a task step. Each is registered when it is created with its
// purpose, owner, whether it must keep running or merely be preserved, its release
// condition and the supported event or scheduled check that reassesses it. The
// register lives in the existing custody manifest; it is not another ledger.
// Reassessment never deletes anything: it returns a disposition for the owner's
// existing cleanup path, and a due review triggers reassessment only.
const RESOURCE_REGISTER_SCHEMA = 'toolkit.custody.retained-resources.v1';
const RESOURCE_KINDS = Object.freeze(['PROCESS', 'WORKTREE', 'DIRECTORY', 'BRANCH', 'ISSUE', 'REMOTE_ARTIFACT']);
const RESOURCE_NEEDS = Object.freeze(['RUNNING', 'PRESERVED']);
const PROTECTING_HOLDS = Object.freeze(['ACTIVE_USE', 'UAT', 'REVIEW', 'SOLE_COPY', 'PERMISSION', 'RECOVERY']);

class RetainedResourceRegister {
  #value;
  constructor(value = { schema: RESOURCE_REGISTER_SCHEMA, resources: [] }) {
    const v = structuredClone(value);
    if (!isRecord(v) || v.schema !== RESOURCE_REGISTER_SCHEMA || !Array.isArray(v.resources)) fail('RESOURCE_REGISTER_INVALID');
    const ids = new Set();
    for (const r of v.resources) {
      RetainedResourceRegister.#check(r);
      if (ids.has(r.resource_id)) fail('RESOURCE_REGISTER_DUPLICATE');
      ids.add(r.resource_id);
    }
    this.#value = deepFreeze(v);
  }

  static #check(r) {
    if (!exactKeys(r, ['resource_id', 'kind', 'purpose', 'owner', 'need', 'release_condition', 'reassess', 'holds',
      'created_at', 'created_by', 'state', 'history'])
      || !safeId(r.resource_id) || !RESOURCE_KINDS.includes(r.kind) || typeof r.purpose !== 'string' || !r.purpose.trim()
      || !safeId(r.owner) || !RESOURCE_NEEDS.includes(r.need) || !safeId(r.release_condition)
      || !isRecord(r.reassess) || !['EVENT', 'SCHEDULE'].includes(r.reassess.trigger)
      || (r.reassess.trigger === 'EVENT' ? !safeId(r.reassess.event) : timestamp(r.reassess.next_review_at) === null)
      || !Array.isArray(r.holds) || r.holds.some(h => !PROTECTING_HOLDS.includes(h)) || new Set(r.holds).size !== r.holds.length
      || timestamp(r.created_at) === null || !safeId(r.created_by)
      || !['RETAINED', 'RELEASED'].includes(r.state) || !Array.isArray(r.history)) fail('RESOURCE_REGISTRATION_INVALID');
  }

  get value() { return structuredClone(this.#value); }
  get digest() { return digestValue(this.#value); }
  resource(resourceId) {
    const r = this.#value.resources.find(item => item.resource_id === resourceId);
    if (!r) fail('RESOURCE_UNREGISTERED');
    return structuredClone(r);
  }

  #with(mutate) { const v = structuredClone(this.#value); mutate(v); return new RetainedResourceRegister(v); }

  // Registration happens when the resource is created, by the session that created it.
  register(entry) {
    const r = { holds: [], state: 'RETAINED', history: [], ...structuredClone(entry) };
    RetainedResourceRegister.#check(r);
    if (this.#value.resources.some(item => item.resource_id === r.resource_id)) fail('RESOURCE_REGISTER_DUPLICATE');
    return this.#with(v => v.resources.push(r));
  }

  // Ownership moves to a verified successor at handoff; the record is never dropped.
  transfer(resourceId, { owner, at, evidence_digest }) {
    const r = this.resource(resourceId);
    if (r.state !== 'RETAINED' || !safeId(owner) || owner === r.owner || timestamp(at) === null || !/^[a-f0-9]{64}$/.test(evidence_digest || '')) fail('RESOURCE_TRANSFER_INVALID');
    return this.#with(v => { const x = v.resources.find(i => i.resource_id === resourceId);
      x.history.push({ event: 'TRANSFERRED', from: x.owner, to: owner, at, evidence_digest }); x.owner = owner; });
  }

  setHolds(resourceId, holds, { at, reason }) {
    const r = this.resource(resourceId);
    if (!Array.isArray(holds) || holds.some(h => !PROTECTING_HOLDS.includes(h)) || timestamp(at) === null || !safeId(reason)) fail('RESOURCE_HOLD_INVALID');
    return this.#with(v => { const x = v.resources.find(i => i.resource_id === r.resource_id);
      x.holds = [...new Set(holds)]; x.history.push({ event: 'HOLDS_SET', holds: x.holds, at, reason }); });
  }

  // Fresh observations: { observed_at, process_active, release_condition_met, custody_verified }.
  // Returns one disposition; it performs no effect and does not change the register.
  reassess(resourceId, observation) {
    const r = this.resource(resourceId);
    const now = timestamp(observation?.observed_at);
    if (now === null || typeof observation.release_condition_met !== 'boolean' || typeof observation.custody_verified !== 'boolean'
      || r.kind === 'PROCESS' && typeof observation.process_active !== 'boolean') fail('RESOURCE_OBSERVATION_INVALID');
    if (r.state === 'RELEASED') return deepFreeze({ resource_id: r.resource_id, disposition: 'ALREADY_RELEASED', effect_authority: false });
    const due = r.reassess.trigger === 'SCHEDULE' && now >= timestamp(r.reassess.next_review_at);
    const base = { resource_id: r.resource_id, owner: r.owner, review_due: due, effect_authority: false };
    if (r.holds.length) {
      // An idle process kept only for preservation need not keep running.
      const stopProcess = r.kind === 'PROCESS' && r.need === 'PRESERVED' && observation.process_active === true
        && !r.holds.includes('ACTIVE_USE');
      return deepFreeze({ ...base, disposition: stopProcess ? 'STOP_PROCESS_KEEP_PRESERVED' : 'HOLD', holds: [...r.holds] });
    }
    if (!observation.release_condition_met) {
      const stopProcess = r.kind === 'PROCESS' && r.need === 'PRESERVED' && observation.process_active === true;
      return deepFreeze({ ...base, disposition: stopProcess ? 'STOP_PROCESS_KEEP_PRESERVED' : due ? 'REASSESSED_STILL_REQUIRED' : 'RETAIN',
        next_action: 'RECORD_NEXT_REVIEW' });
    }
    if (!observation.custody_verified) return deepFreeze({ ...base, disposition: 'HOLD', holds: ['SOLE_COPY'] });
    return deepFreeze({ ...base, disposition: 'RELEASE_ELIGIBLE', next_action: 'OWNER_CLEANUP_PATH' });
  }

  // Records a release after the owner's cleanup path independently read back the outcome.
  release(resourceId, { at, readback_digest }) {
    const r = this.resource(resourceId);
    if (r.state !== 'RETAINED' || r.holds.length || timestamp(at) === null || !/^[a-f0-9]{64}$/.test(readback_digest || '')) fail('RESOURCE_RELEASE_REFUSED');
    return this.#with(v => { const x = v.resources.find(i => i.resource_id === resourceId);
      x.state = 'RELEASED'; x.history.push({ event: 'RELEASED', at, readback_digest }); });
  }

  // A reviewed resource records its next scheduled review rather than being kept open-ended.
  scheduleReview(resourceId, { next_review_at, at }) {
    const r = this.resource(resourceId);
    if (r.reassess.trigger !== 'SCHEDULE' || timestamp(next_review_at) === null || timestamp(at) === null
      || timestamp(next_review_at) <= timestamp(at)) fail('RESOURCE_REVIEW_INVALID');
    return this.#with(v => { const x = v.resources.find(i => i.resource_id === resourceId);
      x.reassess = { trigger: 'SCHEDULE', next_review_at }; x.history.push({ event: 'REVIEWED', at, next_review_at }); });
  }
}

module.exports = Object.freeze({
  RESOURCE_REGISTER_SCHEMA,
  RetainedResourceRegister,
  DISPOSAL_OBSERVATION_SCHEMA,
  DISPOSAL_RECEIPT_SCHEMA,
  GIT_EXPIRY_RECEIPT_SCHEMA,
  HOLD,
  LEGACY_REMOTE_BULK_RETENTION_MS,
  LEGACY_RETENTION_VIEW_SCHEMA,
  REMOTE_BULK_RETENTION_MS,
  RETENTION_VIEW_SCHEMA,
  TRANSFER_RETENTION_MS,
  RetentionError,
  createLifecycleCleanupController,
  createTaskOwnedFixtureCleanupBackend,
  createTaskOwnedFilesystemCleanupAdapter: options => require('./toolkit-filesystem-cleanup-adapter.cjs').createFilesystemCleanupAdapter(options),
  createTaskOwnedGitCurrentTreeExpiryAdapter: options => require('./toolkit-git-current-tree-expiry-adapter.cjs').createTaskOwnedGitCurrentTreeExpiryAdapter(options),
  executeFixtureDisposal,
  normalizeTargetIdentity,
  planRetention,
  targetDigest,
  validateDisposalReceipt,
  validateGitExpiryReceipt
});
