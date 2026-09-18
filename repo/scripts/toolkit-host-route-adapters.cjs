#!/usr/bin/env node
'use strict';

const route = require('./toolkit-route-resolution.cjs');

const PROOF_CONTRACT_VERSION = 'toolkit.route-resolution.host-capability-proof.v1';
const ADAPTERS = Object.freeze({
  codex: 'toolkit-host-adapter.codex.v1',
  'claude-code': 'toolkit-host-adapter.claude-code.v1',
  opencode: 'toolkit-host-adapter.opencode.v1'
});
const CAPABILITY_ROUTE_FIELDS = Object.freeze([
  'launch_id',
  'role',
  'provider',
  'model',
  'reasoning',
  'service_tier',
  'speed',
  'host',
  'backend',
  'launch_record_digest',
]);
const EXECUTION_ACKNOWLEDGEMENT_FIELDS = Object.freeze([
  'accepted',
  'acknowledged',
  'launch_id',
  'role',
  'provider',
  'model',
  'reasoning',
  'service_tier',
  'speed',
  'host',
  'backend',
  'launch_record_digest',
  'capability_proof_digest',
  'completed',
]);

class HostAdapterError extends Error {
  constructor(code, evidence = {}) {
    super(code);
    this.name = 'HostAdapterError';
    this.code = code;
    this.evidence = evidence;
  }
}

function fail(code, evidence = {}) {
  throw new HostAdapterError(code, evidence);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isDigest(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function exactKeys(value, keys) {
  return isRecord(value) && Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function proofBase(record, host, adapterId) {
  return {
    contract_version: PROOF_CONTRACT_VERSION,
    proof_id: `proof-${route.digestValue({ launch_record_digest: record.route_digest, host, adapter_id: adapterId }).slice(0, 24)}`,
    host,
    backend: record.backend,
    adapter_id: adapterId,
    launch_record_digest: record.route_digest,
    launch_id: record.launch_id,
    role: record.role,
    provider: record.provider,
    model: record.model,
    reasoning: record.reasoning,
    service_tier: record.service_tier,
    speed: record.speed,
    status: 'available',
    trusted: true,
    metadata_verified: true
  };
}

function validateCapabilityProof(proof) {
  const keys = ['contract_version', 'proof_id', 'host', 'backend', 'adapter_id', 'launch_record_digest', 'launch_id', 'role', 'provider', 'model', 'reasoning', 'service_tier', 'speed', 'status', 'trusted', 'metadata_verified'];
  if (isRecord(proof) && proof.status === 'unsupported') fail('HOST_CAPABILITY_UNAVAILABLE', { reason: 'proof-status-unsupported' });
  if (isRecord(proof) && proof.status === 'contradictory') fail('HOST_CAPABILITY_CONTRADICTION', { reason: 'proof-status-contradictory' });
  if (!exactKeys(proof, keys)
    || proof.contract_version !== PROOF_CONTRACT_VERSION
    || !route.HOSTS.includes(proof.host)
    || proof.backend !== proof.host
    || typeof proof.proof_id !== 'string'
    || typeof proof.adapter_id !== 'string'
    || !isDigest(proof.launch_record_digest)
    || typeof proof.launch_id !== 'string'
    || !/^[a-z][a-z0-9-]{0,63}$/.test(proof.role)
    || proof.provider !== 'openai'
    || !['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-luna'].includes(proof.model)
    || !['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(proof.reasoning)
    || proof.service_tier !== 'standard'
    || !['standard', 'priority'].includes(proof.speed)
    || proof.status !== 'available'
    || proof.trusted !== true
    || proof.metadata_verified !== true) {
    fail('HOST_CAPABILITY_CONTRADICTION', { reason: 'proof-shape' });
  }
  return Object.freeze(clone(proof));
}

function observedCapability(record, capability) {
  if (!isRecord(capability)) fail('HOST_CAPABILITY_UNAVAILABLE', { reason: 'capability-evidence-missing' });
  if (capability.available !== true || capability.trusted !== true || capability.metadata_verified !== true) {
    fail('HOST_CAPABILITY_UNAVAILABLE', { reason: 'host-reported-unavailable' });
  }
  for (const field of CAPABILITY_ROUTE_FIELDS) {
    const expected = field === 'launch_record_digest' ? record.route_digest : record[field];
    if (capability[field] !== expected) {
      fail('HOST_CAPABILITY_CONTRADICTION', { field, expected, observed: capability[field] });
    }
  }
  return capability;
}

function proveHostCapability({ launch_record, capability, host, adapter_id } = {}) {
  const record = launch_record || arguments[0]?.launchRecord;
  if (!record) fail('EXACT_LAUNCH_REQUIRED');
  route.validateResolvedLaunchRecord(record);
  const selectedHost = host || record.host;
  if (selectedHost !== record.host || !route.HOSTS.includes(selectedHost)) fail('HOST_CAPABILITY_CONTRADICTION', { reason: 'host-mismatch' });
  const selectedAdapter = adapter_id || ADAPTERS[selectedHost];
  if (selectedAdapter !== ADAPTERS[selectedHost]) fail('HOST_CAPABILITY_CONTRADICTION', { reason: 'adapter-mismatch' });
  observedCapability(record, capability);
  const proof = validateCapabilityProof(proofBase(record, selectedHost, selectedAdapter));
  return Object.freeze({
    status: 'available',
    proof,
    proof_digest: route.digestValue(proof),
    host: selectedHost,
    adapter_id: selectedAdapter
  });
}

function verifyProofForRecord(record, proof) {
  route.validateResolvedLaunchRecord(record);
  const checked = validateCapabilityProof(proof);
  if (checked.launch_record_digest !== record.route_digest || checked.launch_id !== record.launch_id || checked.role !== record.role
    || checked.host !== record.host || checked.backend !== record.backend || checked.provider !== record.provider
    || checked.model !== record.model || checked.reasoning !== record.reasoning || checked.service_tier !== record.service_tier
    || checked.speed !== record.speed || checked.adapter_id !== ADAPTERS[record.host]) {
    fail('HOST_CAPABILITY_CONTRADICTION', { reason: 'exact-record-mismatch' });
  }
  return checked;
}

function validateExecutionAcknowledgement(acknowledgement, record, proof) {
  if (!exactKeys(acknowledgement, EXECUTION_ACKNOWLEDGEMENT_FIELDS)
    || acknowledgement.accepted !== true
    || acknowledgement.acknowledged !== true
    || acknowledgement.launch_id !== record.launch_id
    || acknowledgement.role !== record.role
    || acknowledgement.provider !== record.provider
    || acknowledgement.model !== record.model
    || acknowledgement.reasoning !== record.reasoning
    || acknowledgement.service_tier !== record.service_tier
    || acknowledgement.speed !== record.speed
    || acknowledgement.host !== record.host
    || acknowledgement.backend !== record.backend
    || acknowledgement.launch_record_digest !== record.route_digest
    || acknowledgement.capability_proof_digest !== route.digestValue(proof)
    || typeof acknowledgement.completed !== 'boolean') {
    return null;
  }
  return Object.freeze(clone(acknowledgement));
}

function executeExactLaunch({ launch_record, capability_proof, executor } = {}) {
  const record = launch_record || arguments[0]?.launchRecord;
  const proof = capability_proof || arguments[0]?.capabilityProof;
  if (!record || !proof) fail('EXACT_LAUNCH_REQUIRED');
  const checkedProof = verifyProofForRecord(record, proof);
  if (typeof executor !== 'function') fail('HOST_CAPABILITY_UNAVAILABLE', { reason: 'execution_adapter_missing' });
  let result;
  try {
    result = executor(Object.freeze({ launch_record: record, capability_proof: checkedProof }));
  } catch (_error) {
    return route.createExactLaunchReceipt({ launch_record: record, capability_proof_digest: route.digestValue(checkedProof), status: 'rejected', started: false, completed: false });
  }
  if (result && typeof result.then === 'function') fail('HOST_CAPABILITY_CONTRADICTION', { reason: 'async-adapter-not-supported' });
  const acknowledgement = isRecord(result) ? validateExecutionAcknowledgement(result, record, checkedProof) : null;
  if (!acknowledgement) {
    return route.createExactLaunchReceipt({ launch_record: record, capability_proof_digest: route.digestValue(checkedProof), status: 'rejected', started: false, completed: false });
  }
  return route.createExactLaunchReceipt({ launch_record: record, capability_proof_digest: route.digestValue(checkedProof), status: 'accepted', started: true, completed: acknowledgement.completed === true });
}

function getHostAdapter(host) {
  if (!route.HOSTS.includes(host)) fail('HOST_CAPABILITY_UNAVAILABLE', { reason: 'unsupported-host', host });
  const adapterId = ADAPTERS[host];
  return Object.freeze({
    host,
    adapter_id: adapterId,
    prove: (options) => proveHostCapability({ ...options, host, adapter_id: adapterId }),
    execute: (options) => executeExactLaunch(options)
  });
}

function assertCapabilityForExactRecord(record, proof) {
  return verifyProofForRecord(record, proof);
}

module.exports = Object.freeze({
  PROOF_CONTRACT_VERSION,
  ADAPTERS,
  HostAdapterError,
  proveHostCapability,
  verifyProofForRecord,
  assertCapabilityForExactRecord,
  executeExactLaunch,
  getHostAdapter,
  validateCapabilityProof,
  validateExecutionAcknowledgement,
});
