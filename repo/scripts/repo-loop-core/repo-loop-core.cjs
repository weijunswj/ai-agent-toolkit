'use strict';

const crypto = require('node:crypto');

const AUTHORITY_VERSION = 'repo-loop-core.authority.v1';
const PACKET_VERSION = 'repo-loop-core.terminal-packet.v1';
const DEFAULT_OFF = true;
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const ROLES = new Set(['executor-root', 'implementation-worker', 'amendment-worker', 'technical-g4-reviewer', 'review-auditor']);
const IDENTITY_KEYS = ['repository_id', 'remote_url', 'child', 'pull_request', 'branch', 'base', 'merge_base', 'head', 'tree'];
const FINALITY_KEY = /(?:eligible|green|passed|valid|certified|approved|finality|checks?)/i;
const WEB_RUNTIME_KEY = /(?:web|controller).*(?:model|provider|reasoning|runtime)|(?:model|provider|reasoning|runtime).*(?:web|controller)/i;
const AUTHORITY_INPUT_KEYS = ['local', 'remote', 'design_lock', 'risk_tier', 'current_operation_time'];

class ContractError extends Error {
  constructor(code, message = code) { super(message); this.name = 'ContractError'; this.code = code; }
}
const fail = (code, message) => { throw new ContractError(code, message || code); };
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const text = (value) => typeof value === 'string' && value.length > 0 && value.trim() === value;
const nonBlankIdentifier = (value) => { if (!text(value)) fail('EXECUTION_ASSIGNMENT_IDENTIFIER_INVALID'); return value; };
function credentialFreeRemoteUrl(value) {
  if (!text(value)) fail('IDENTITY_INVALID');
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)) return value;
  if (value.includes('?') || value.includes('#')) fail('CREDENTIAL_BEARING_REMOTE_URL');
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) fail('CREDENTIAL_BEARING_REMOTE_URL');
  } catch (error) {
    if (error instanceof ContractError) throw error;
  }
  return value;
}
function keys(value, allowed, required = []) {
  if (!object(value)) fail('OBJECT_REQUIRED');
  for (const key of required) if (!has(value, key)) fail('REQUIRED_FIELD_MISSING', key);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail('UNEXPECTED_FIELD', key);
}
function freeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value); for (const child of Object.values(value)) freeze(child, seen); return Object.freeze(value);
}
function stable(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') { if (!Number.isFinite(value) || Object.is(value, -0)) fail('CANONICAL_DATA_INVALID'); return value; }
  if (Array.isArray(value)) {
    if (seen.has(value)) fail('CANONICAL_DATA_CYCLE'); seen.add(value);
    const result = value.map((child) => stable(child, seen)); seen.delete(value); return result;
  }
  if (!object(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || seen.has(value)) fail('CANONICAL_DATA_INVALID');
  seen.add(value); const result = Object.create(null);
  for (const key of Object.keys(value).sort()) { if (key === '__proto__') fail('CANONICAL_DATA_INVALID'); result[key] = stable(value[key], seen); }
  seen.delete(value); return result;
}
function cloneValue(value, seen = new Set()) {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) fail('OPERATION_INVALID');
  seen.add(value);
  const result = Array.isArray(value) ? [] : {};
  for (const key of Object.keys(value)) result[key] = cloneValue(value[key], seen);
  seen.delete(value);
  return result;
}
const canonicalJson = (value) => JSON.stringify(stable(value));
const digest = (value) => crypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');

function parseCanonicalJson(source) {
  if (typeof source !== 'string') fail('CANONICAL_JSON_INVALID');
  let parsed; try { parsed = JSON.parse(source); } catch { fail('CANONICAL_JSON_INVALID'); }
  let index = 0;
  const skip = () => { while (/\s/.test(source[index] || '')) index += 1; };
  const string = () => {
    const start = index++;
    while (index < source.length) { if (source[index] === '\\') index += 2; else if (source[index++] === '"') return JSON.parse(source.slice(start, index)); }
    fail('CANONICAL_JSON_INVALID');
  };
  const value = () => {
    skip();
    if (source[index] === '{') {
      index += 1; const names = new Set(); skip(); if (source[index] === '}') { index += 1; return; }
      while (true) {
        skip(); if (source[index] !== '"') fail('CANONICAL_JSON_INVALID'); const name = string();
        if (names.has(name)) fail('DUPLICATE_CANONICAL_KEY', name); names.add(name); skip();
        if (source[index++] !== ':') fail('CANONICAL_JSON_INVALID'); value(); skip();
        if (source[index] === '}') { index += 1; return; } if (source[index++] !== ',') fail('CANONICAL_JSON_INVALID');
      }
    }
    if (source[index] === '[') {
      index += 1; skip(); if (source[index] === ']') { index += 1; return; }
      while (true) { value(); skip(); if (source[index] === ']') { index += 1; return; } if (source[index++] !== ',') fail('CANONICAL_JSON_INVALID'); }
    }
    if (source[index] === '"') { string(); return; }
    const start = index; while (index < source.length && !/[\s,\]}]/.test(source[index])) index += 1;
    if (start === index) fail('CANONICAL_JSON_INVALID');
  };
  value(); skip(); if (index !== source.length) fail('CANONICAL_JSON_INVALID'); return parsed;
}

function identity(value) {
  keys(value, IDENTITY_KEYS, IDENTITY_KEYS);
  const valid = /^\S+\/\S+$/.test(value.repository_id) && text(value.remote_url) && credentialFreeRemoteUrl(value.remote_url) === value.remote_url && Number.isInteger(value.child) && value.child > 0 && Number.isInteger(value.pull_request) && value.pull_request > 0 && text(value.branch) && !value.branch.includes('\\') && ['base', 'merge_base', 'head', 'tree'].every((key) => SHA.test(value[key]));
  if (!valid) fail('IDENTITY_INVALID'); return { ...value };
}
function operationTime(value) {
  keys(value, ['source', 'observed_at', 'evidence_id'], ['source', 'observed_at', 'evidence_id']);
  if (value.source !== 'trusted-controller' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.observed_at) || !text(value.evidence_id)) fail('TRUSTED_OPERATION_TIME_INVALID');
  const parsed = new Date(value.observed_at);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value.observed_at) fail('TRUSTED_OPERATION_TIME_INVALID');
  return { ...value };
}
function authorityBody(input, options = {}) {
  if (!object(input)) fail('OBJECT_REQUIRED');
  if (Object.keys(input).some((key) => WEB_RUNTIME_KEY.test(key))) fail('WEB_RUNTIME_OPAQUE');
  if (options.time_sensitive === true && input.current_operation_time === undefined) fail('TRUSTED_OPERATION_TIME_REQUIRED');
  keys(input, AUTHORITY_INPUT_KEYS, ['local', 'remote', 'design_lock', 'risk_tier']);
  if (!input.remote) fail('REMOTE_AUTHORITY_REQUIRED'); if (input.remote.available !== true) fail('REMOTE_AUTHORITY_UNAVAILABLE');
  const local = identity(input.local); const remote = identity(Object.fromEntries(Object.entries(input.remote).filter(([key]) => key !== 'available')));
  if (canonicalJson(local) !== canonicalJson(remote)) fail('AUTHORITY_IDENTITY_MISMATCH');
  keys(input.design_lock, ['id', 'scope_id'], ['id', 'scope_id']); if (!text(input.design_lock.id) || !text(input.design_lock.scope_id)) fail('DESIGN_LOCK_INVALID');
  if (!/^T[0-3]$/.test(input.risk_tier)) fail('RISK_TIER_INVALID');
  const time = input.current_operation_time === undefined ? undefined : operationTime(input.current_operation_time);
  return { schema_version: AUTHORITY_VERSION, repository: { id: local.repository_id, remote_url: local.remote_url }, candidate: local, design_lock: { ...input.design_lock }, risk_tier: input.risk_tier, local_evidence: { available: true, ...local }, remote_evidence: { available: true, ...remote }, ...(time ? { current_operation_time: time } : {}) };
}
function admitAuthority(input, options = {}) { const body = authorityBody(input, options); return freeze({ ...body, authority_digest: digest(body) }); }
function snapshot(value) {
  const normalized = stable(value);
  keys(normalized, ['schema_version', 'repository', 'candidate', 'design_lock', 'risk_tier', 'local_evidence', 'remote_evidence', 'current_operation_time', 'authority_digest'], ['schema_version', 'repository', 'candidate', 'design_lock', 'risk_tier', 'local_evidence', 'remote_evidence', 'authority_digest']);
  if (normalized.schema_version !== AUTHORITY_VERSION || !DIGEST.test(normalized.authority_digest)) fail('AUTHORITY_SNAPSHOT_INVALID');
  const candidate = identity(normalized.candidate); keys(normalized.repository, ['id', 'remote_url'], ['id', 'remote_url']);
  if (normalized.repository.id !== candidate.repository_id || normalized.repository.remote_url !== candidate.remote_url) fail('AUTHORITY_SNAPSHOT_INVALID');
  for (const field of ['local_evidence', 'remote_evidence']) {
    if (normalized[field].available !== true) fail('AUTHORITY_SNAPSHOT_INVALID');
    const evidence = identity(Object.fromEntries(Object.entries(normalized[field]).filter(([key]) => key !== 'available')));
    if (canonicalJson(evidence) !== canonicalJson(candidate)) fail('AUTHORITY_SNAPSHOT_INVALID');
  }
  keys(normalized.design_lock, ['id', 'scope_id'], ['id', 'scope_id']); if (!text(normalized.design_lock.id) || !text(normalized.design_lock.scope_id) || !/^T[0-3]$/.test(normalized.risk_tier)) fail('AUTHORITY_SNAPSHOT_INVALID');
  if (normalized.current_operation_time !== undefined) operationTime(normalized.current_operation_time);
  const body = { ...normalized }; delete body.authority_digest; if (digest(body) !== normalized.authority_digest) fail('AUTHORITY_SNAPSHOT_DIGEST_MISMATCH'); return freeze(normalized);
}
function validateAuthoritySnapshot(value) { try { return { valid: true, value: snapshot(value) }; } catch (error) { return { valid: false, error: { code: error.code || 'AUTHORITY_SNAPSHOT_INVALID' } }; } }
function validateExecutionAssignment(value) {
  try {
    if (!object(value)) fail('OBJECT_REQUIRED'); if (Object.keys(value).some((key) => WEB_RUNTIME_KEY.test(key))) fail('WEB_RUNTIME_OPAQUE');
    keys(value, ['role', 'provider', 'model', 'reasoning', 'assignment_id', 'evidence_ref'], ['role']); if (!ROLES.has(value.role)) fail(/web|controller/i.test(value.role) ? 'WEB_ROLE_FORBIDDEN' : 'EXECUTION_ROLE_INVALID');
    const explicit = ['provider', 'model', 'reasoning'].some((key) => has(value, key)); if (explicit && !['provider', 'model', 'reasoning'].every((key) => text(value[key]))) fail('EXECUTION_ASSIGNMENT_INCOMPLETE');
    const normalized = { role: value.role };
    if (explicit) for (const key of ['provider', 'model', 'reasoning']) normalized[key] = value[key];
    if (has(value, 'assignment_id')) normalized.assignment_id = nonBlankIdentifier(value.assignment_id);
    if (has(value, 'evidence_ref')) normalized.evidence_ref = nonBlankIdentifier(value.evidence_ref);
    return { valid: true, value: freeze(normalized) };
  } catch (error) { return { valid: false, error: { code: error.code || 'EXECUTION_ASSIGNMENT_INVALID' } }; }
}
function normalizedExecutionAssignment(value) {
  const result = validateExecutionAssignment(value);
  if (!result.valid) fail(result.error.code);
  return result.value;
}
function validateCurrentOperationTime(value) { try { return { valid: true, value: freeze(operationTime(value)) }; } catch (error) { return { valid: false, error: { code: error.code || 'TRUSTED_OPERATION_TIME_INVALID' } }; } }
function canonicalGitPath(value) {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.includes('\\') || value.includes('\0') || /%[0-9a-f]{2}/i.test(value) || /^[A-Za-z]:/.test(value) || value.startsWith('/')) fail('CANONICAL_GIT_PATH_INVALID');
  if (value.split('/').some((part) => !part || part === '.' || part === '..')) fail('CANONICAL_GIT_PATH_INVALID'); return value;
}
function canonicalGitPaths(values) { if (!Array.isArray(values)) fail('CANONICAL_GIT_PATH_INVALID'); const result = values.map(canonicalGitPath); if (new Set(result).size !== result.length) fail('DUPLICATE_CANONICAL_GIT_PATH'); return freeze(result); }
function recoverAuthority(state) { return freeze(object(state) && ['known-live', 'known-dead'].includes(state.owner_state) ? { status: 'blocked', code: 'AUTHORITY_RECOVERY_RESERVED', side_effects: 'none' } : { status: 'blocked', code: 'AUTHORITY_LIVENESS_UNCERTAIN', side_effects: 'none' }); }
function callerFinality(value) { if (Array.isArray(value)) return value.forEach(callerFinality); if (object(value)) for (const [key, child] of Object.entries(value)) { if (typeof child === 'boolean' && FINALITY_KEY.test(key)) fail('CALLER_FINALITY_FIELD_FORBIDDEN', key); callerFinality(child); } }
function textArray(value, code) { if (!Array.isArray(value) || value.some((entry) => !text(entry))) fail(code); }
function evidenceList(value) {
  if (!Array.isArray(value)) fail('EVIDENCE_ENVELOPE_INVALID');
  for (const item of value) { keys(item, ['name', 'status', 'evidence_ref'], ['name', 'status', 'evidence_ref']); if (!text(item.name) || !['pass', 'fail', 'pending', 'unavailable', 'not_run'].includes(item.status) || !text(item.evidence_ref)) fail('EVIDENCE_ENVELOPE_INVALID'); }
}
function findingsEnvelope(value) {
  const fields = ['id', 'kind', 'disposition', 'evidence_ref', 'summary'];
  keys(value, ['state', 'records'], ['state', 'records']);
  if (!['none', 'present', 'deferred', 'unavailable'].includes(value.state) || !Array.isArray(value.records)) fail('FINDING_ENVELOPE_INVALID');
  const count = value.records.length;
  if ((value.state === 'none' || value.state === 'unavailable') && count !== 0) fail('FINDING_ENVELOPE_INVALID');
  if ((value.state === 'present' || value.state === 'deferred') && count < 1) fail('FINDING_ENVELOPE_INVALID');
  for (const record of value.records) {
    keys(record, fields);
    if (fields.some((field) => !text(record[field]))) fail('FINDING_ENVELOPE_INVALID');
  }
}
function validateSecretClassificationState(secretClassification, blockerState) {
  const classificationRequiresHold = ['possible', 'confirmed'].includes(secretClassification);
  const hasClassificationHold = blockerState === 'classification_hold';
  if (classificationRequiresHold !== hasClassificationHold) fail('SECRET_CLASSIFICATION_BLOCKER_MISMATCH');
}
function validateTerminalState(input) {
  const validationItems = [...input.validation.local, ...input.validation.hosted];
  const validationUnavailable = input.validation.hosted.length === 0 || validationItems.some((item) => ['unavailable', 'not_run'].includes(item.status));
  const validationNonPassing = validationItems.some((item) => item.status !== 'pass');
  const hasUnavailableEvidence = input.unavailable_evidence.length > 0;
  if (validationUnavailable && !hasUnavailableEvidence) fail('MISSING_UNDERLYING_EVIDENCE');
  if (input.findings.state === 'unavailable' && !hasUnavailableEvidence) fail('FINDING_EVIDENCE_UNAVAILABLE');
  if (input.reconciliation.state === 'unavailable' && !hasUnavailableEvidence) fail('RECONCILIATION_EVIDENCE_UNAVAILABLE');
  if (input.contradictions.length && input.blocker_state === 'none') fail('CONTRADICTION_UNBLOCKED');
  if (input.blocker_state === 'none' && (validationNonPassing || input.findings.state === 'unavailable' || input.reconciliation.state !== 'complete' || input.contradictions.length || hasUnavailableEvidence)) fail('UNAVAILABLE_EVIDENCE_UNBLOCKED');
}
function packetInput(input) {
  callerFinality(input); if (Object.keys(input).some((key) => WEB_RUNTIME_KEY.test(key))) fail('WEB_RUNTIME_OPAQUE');
  keys(input, ['authority', 'execution_assignment', 'identity', 'scope', 'review_surface', 'validation', 'findings', 'blocker_state', 'convergence', 'reconciliation', 'contradictions', 'unavailable_evidence', 'finality_actions', 'secret_classification'], ['authority', 'identity', 'scope', 'review_surface', 'validation', 'findings', 'blocker_state', 'convergence', 'reconciliation', 'contradictions', 'unavailable_evidence', 'finality_actions', 'secret_classification']);
  const authority = snapshot(input.authority); if (canonicalJson(identity(input.identity)) !== canonicalJson(authority.candidate)) fail('PACKET_AUTHORITY_MISMATCH');
  keys(input.scope, ['design_lock_id', 'scope_id', 'risk_tier'], ['design_lock_id', 'scope_id', 'risk_tier']); if (input.scope.design_lock_id !== authority.design_lock.id || input.scope.scope_id !== authority.design_lock.scope_id || input.scope.risk_tier !== authority.risk_tier) fail('PACKET_AUTHORITY_MISMATCH');
  keys(input.review_surface, ['manual_lines', 'files', 'risk_tier'], ['manual_lines', 'files', 'risk_tier']); if (!Number.isInteger(input.review_surface.manual_lines) || input.review_surface.manual_lines < 0 || !Number.isInteger(input.review_surface.files) || input.review_surface.files < 0 || input.review_surface.risk_tier !== authority.risk_tier) fail('REVIEW_SURFACE_INVALID');
  keys(input.validation, ['local', 'hosted'], ['local', 'hosted']); evidenceList(input.validation.local); evidenceList(input.validation.hosted);
  findingsEnvelope(input.findings);
  for (const record of input.findings.records) { keys(record, ['id', 'kind', 'disposition', 'evidence_ref', 'summary']); if (Object.values(record).some((entry) => !text(entry))) fail('FINDING_ENVELOPE_INVALID'); }
  if (!['none', 'blocked', 'deferred', 'classification_hold', 'unavailable'].includes(input.blocker_state)) fail('BLOCKER_STATE_INVALID'); keys(input.convergence, ['generation', 'reservation'], ['generation', 'reservation']); if (!Number.isInteger(input.convergence.generation) || input.convergence.generation < 1 || !text(input.convergence.reservation)) fail('CONVERGENCE_RESERVATION_INVALID');
  keys(input.reconciliation, ['state', 'evidence'], ['state', 'evidence']); if (!['complete', 'incomplete', 'unavailable'].includes(input.reconciliation.state)) fail('RECONCILIATION_INVALID'); textArray(input.reconciliation.evidence, 'RECONCILIATION_INVALID');
  for (const key of ['contradictions', 'unavailable_evidence', 'finality_actions']) textArray(input[key], 'PACKET_ENVELOPE_INVALID'); if (!input.finality_actions.length) fail('PACKET_ENVELOPE_INVALID'); if (!['none', 'redacted', 'possible', 'confirmed'].includes(input.secret_classification)) fail('SECRET_CLASSIFICATION_INVALID');
  validateSecretClassificationState(input.secret_classification, input.blocker_state);
  validateTerminalState(input);
  if (has(input, 'execution_assignment') && input.execution_assignment !== undefined) normalizedExecutionAssignment(input.execution_assignment); return authority;
}
function buildTerminalPacket(input) {
  const authority = packetInput(input); const assignment = input.execution_assignment === undefined ? undefined : normalizedExecutionAssignment(input.execution_assignment); const body = { schema_version: PACKET_VERSION, authority_snapshot: authority, ...(assignment === undefined ? {} : { execution_assignment: assignment }), identity: { ...input.identity }, scope: { ...input.scope }, review_surface: { ...input.review_surface }, validation: { local: input.validation.local.map((item) => ({ ...item })), hosted: input.validation.hosted.map((item) => ({ ...item })) }, findings: { state: input.findings.state, records: input.findings.records.map((item) => ({ ...item })) }, blocker_state: input.blocker_state, convergence: { ...input.convergence }, reconciliation: { state: input.reconciliation.state, evidence: [...input.reconciliation.evidence] }, contradictions: [...input.contradictions], unavailable_evidence: [...input.unavailable_evidence], finality_actions: [...input.finality_actions], secret_classification: input.secret_classification };
  const packet_digest = digest(body); return freeze({ ...body, packet_id: `repo-loop-core.packet.v1:${packet_digest.slice(0, 16)}`, packet_digest });
}
function verifyTerminalPacket(packet, expectedAuthority) {
  try {
    const normalized = stable(packet); if (!object(normalized)) fail('PACKET_INVALID'); const body = { ...normalized }; delete body.packet_id; delete body.packet_digest;
    const input = { ...body, authority: body.authority_snapshot }; delete input.authority_snapshot; delete input.schema_version; const authority = packetInput(input);
    if (normalized.schema_version !== PACKET_VERSION || !DIGEST.test(normalized.packet_digest) || normalized.packet_id !== `repo-loop-core.packet.v1:${normalized.packet_digest.slice(0, 16)}`) fail('PACKET_ID_INVALID');
    if (digest(body) !== normalized.packet_digest) fail('PACKET_DIGEST_MISMATCH'); if (expectedAuthority && snapshot(expectedAuthority).authority_digest !== authority.authority_digest) fail('PACKET_AUTHORITY_MISMATCH');
    return { valid: true, value: freeze(normalized) };
  } catch (error) { return { valid: false, error: { code: error.code || 'PACKET_INVALID' } }; }
}
function parseTerminalPacket(source, expectedAuthority) { try { return verifyTerminalPacket(parseCanonicalJson(source), expectedAuthority); } catch (error) { return { valid: false, error: { code: error.code || 'PACKET_INVALID' } }; } }
function execute(operation) { const normalizedOperation = operation !== null && typeof operation === 'object' ? cloneValue(operation) : operation; return freeze({ status: 'refused', code: 'DEFAULT_OFF_MUTATION_REFUSED', operation: normalizedOperation, side_effects: 'none' }); }
module.exports = { AUTHORITY_VERSION, PACKET_VERSION, DEFAULT_OFF, ContractError, canonicalJson, parseCanonicalJson, admitAuthority, validateAuthoritySnapshot, validateExecutionAssignment, validateCurrentOperationTime, canonicalGitPath, canonicalGitPaths, recoverAuthority, buildTerminalPacket, verifyTerminalPacket, parseTerminalPacket, execute };
