#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');

const REDACTED = '[REDACTED]';
const SECRET_FIELDS = new Set(['api_key', 'apikey', 'authorization', 'cookie', 'credential', 'password', 'private_key', 'secret', 'token']);
const SAFE_METADATA_FIELDS = new Set(['host', 'login', 'account', 'token_present', 'token_scopes', 'masked_token', 'authentication_method', 'scope']);
const SECRET_PATTERNS = Object.freeze([
  { type: 'openai-key', pattern: /sk-[A-Za-z0-9_-]{20,}/i },
  { type: 'google-api-key', pattern: /AIza[0-9A-Za-z_-]{20,}/ },
  { type: 'bearer-token', pattern: /Bearer\s+[A-Za-z0-9._-]{20,}/i },
  { type: 'jwt', pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { type: 'private-key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ }
]);
const PLACEHOLDER_PATTERN = /^(?:\[REDACTED\]|\*{3,}|x{3,}|<redacted>|masked|unset|not[-_ ]?set|null|undefined)$/i;
const GENERIC_CREDENTIAL_PATTERN = /^(?:gh[pousr]_[A-Za-z0-9]{20,}|glpat-[A-Za-z0-9_-]{20,}|npm_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|(?:pk|sk)_(?:live|test)_[A-Za-z0-9]{16,})$/i;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeField(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function safeRef(value, fallback = 'unknown') {
  const candidate = String(value || fallback).replace(/[^A-Za-z0-9._:/-]+/g, '-').slice(0, 128);
  return candidate || fallback;
}

function finding(type, name, place, action) {
  return Object.freeze({ type: safeRef(type), name: safeRef(name), place: safeRef(place), action: safeRef(action) });
}

function secretPattern(value) {
  if (typeof value !== 'string') return null;
  return SECRET_PATTERNS.find((entry) => entry.pattern.test(value)) || null;
}

function isPlaceholder(value) {
  return typeof value !== 'string' || value.length === 0 || PLACEHOLDER_PATTERN.test(value.trim());
}

function classifyExposure({ value, name = 'payload', place = 'unknown', action = 'publish', type = 'value', metadata = false, confirmed = false, secret_context = false } = {}) {
  const normalizedName = normalizeField(name);
  if (confirmed === true) return Object.freeze({ classification: 'confirmed', finding: finding(type || 'confirmed-secret', name, place, action), code: 'SECRET_EXPOSURE_DETECTED' });
  if (typeof value === 'string' && isPlaceholder(value)) return Object.freeze({ classification: 'none', finding: null });
  const pattern = secretPattern(value);
  if (pattern) return Object.freeze({ classification: 'confirmed', finding: finding(pattern.type, name, place, action), code: 'SECRET_EXPOSURE_DETECTED' });
  if (Array.isArray(value) || isRecord(value)) return Object.freeze({ classification: 'none', finding: null });
  if (typeof value === 'string' && /(?:secret|credential|password|token|api[-_ ]?key|authorization)\s*[:=]\s*\S+/i.test(value)) {
    return Object.freeze({ classification: 'possible', finding: finding(type || 'credential-like-assignment', name, place, action) });
  }
  if (SECRET_FIELDS.has(normalizedName) || secret_context === true) {
    return Object.freeze({ classification: 'possible', finding: finding(type || 'credential-like-value', name, place, action) });
  }
  if (typeof value === 'string' && GENERIC_CREDENTIAL_PATTERN.test(value.trim())) {
    return Object.freeze({ classification: 'possible', finding: finding('credential-like-token', name, place, action) });
  }
  if (typeof value === 'string' && /(?:secret|credential|password|token|api[-_ ]?key|authorization)/i.test(value)) {
    return Object.freeze({ classification: 'possible', finding: finding(type || 'credential-like-text', name, place, action) });
  }
  if (metadata || SAFE_METADATA_FIELDS.has(normalizedName)) return Object.freeze({ classification: 'none', finding: null });
  return Object.freeze({ classification: 'none', finding: null });
}

function redactValue(value, name, place, findings, pathValue = '', secretContext = false) {
  const normalizedName = normalizeField(name);
  const nextSecretContext = secretContext || SECRET_FIELDS.has(normalizedName);
  const classification = classifyExposure({ value, name, place, action: 'publish', secret_context: secretContext });
  if (classification.finding) findings.push(classification.finding);
  if (classification.classification !== 'none') return REDACTED;
  if (Array.isArray(value)) return value.map((child, index) => redactValue(child, name, place, findings, `${pathValue}[${index}]`, nextSecretContext));
  if (isRecord(value)) {
    const result = {};
    for (const [key, child] of Object.entries(value)) {
      const childPlace = pathValue ? `${place}.${pathValue}.${key}` : `${place}.${key}`;
      result[key] = redactValue(child, key, childPlace, findings, key, nextSecretContext);
    }
    return result;
  }
  return value;
}

function preparePublicPayload(payload, { place = 'public-surface', name = 'payload' } = {}) {
  const findings = [];
  const redacted = redactValue(payload, name, place, findings);
  const unique = [...new Map(findings.map((item) => [`${item.type}|${item.name}|${item.place}|${item.action}`, item])).values()];
  const confirmed = unique.some((item) => ['openai-key', 'google-api-key', 'bearer-token', 'jwt', 'private-key'].includes(item.type));
  const possible = unique.length > 0 && !confirmed;
  return Object.freeze({
    classification: confirmed ? 'confirmed' : (possible ? 'possible' : 'none'),
    action: confirmed ? 'stop' : (possible ? 'pause' : 'none'),
    code: confirmed ? 'SECRET_EXPOSURE_DETECTED' : null,
    payload: redacted,
    findings: unique
  });
}

function assertSafePublicPayload(payload, options = {}) {
  const result = preparePublicPayload(payload, options);
  if (result.classification === 'confirmed') {
    const error = new Error('SECRET_EXPOSURE_DETECTED');
    error.code = 'SECRET_EXPOSURE_DETECTED';
    error.result = result;
    throw error;
  }
  return result;
}

function requireDeploymentConfiguration(config, requiredNames) {
  const source = isRecord(config) ? config : {};
  const names = Array.isArray(requiredNames) ? requiredNames : [];
  const missing = names.filter((name) => typeof source[name] !== 'string' || source[name].trim() === '');
  if (missing.length) return Object.freeze({ ok: false, code: 'REQUIRED_CONFIGURATION_MISSING', missing: missing.map((name) => safeRef(name)) });
  return Object.freeze({ ok: true, code: null, configured: names.map((name) => safeRef(name)) });
}

function publicError(code, reference = '') {
  const ref = reference || crypto.createHash('sha256').update(String(code), 'utf8').digest('hex').slice(0, 16);
  return Object.freeze({ code: safeRef(code), reference: safeRef(ref), message: 'The requested operation could not be completed. Contact support if this keeps happening.' });
}

module.exports = Object.freeze({
  REDACTED,
  SECRET_FIELDS,
  SECRET_PATTERNS,
  GENERIC_CREDENTIAL_PATTERN,
  classifyExposure,
  preparePublicPayload,
  assertSafePublicPayload,
  requireDeploymentConfiguration,
  publicError,
  isPlaceholder
});
