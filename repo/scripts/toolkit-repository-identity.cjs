'use strict';

// Remote identity only. No decisions, user-state reads or writes.
const crypto = require('node:crypto');
const MAX_REMOTE_LENGTH = 4096;
const REMOTE_IDENTITY_CONTRACT_VERSION = 'toolkit.control-plane.remote-identity.v1';
const IDENTITY_CONTRACT = 'toolkit.repository-identity.v1';
function fail(code) { const error = new Error(code); error.code = code; throw error; }
function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
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


function validateRemoteIdentity(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_REMOTE_LENGTH) return { valid: false, reason_code: 'REMOTE_IDENTITY_INVALID' };
  if (value.startsWith('git@')) {
    const separator = value.indexOf(':', 4);
    const hostValue = separator > 4 ? value.slice(4, separator) : '';
    const scpPath = separator > 4 ? value.slice(separator + 1) : '';
    if (!scpPath || scpPath.startsWith('/') || scpPath.includes('?') || scpPath.includes('#') || !/^[A-Za-z0-9.-]+$/.test(hostValue) || !/^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(hostValue) || hostValue.includes('..')) return { valid: false, reason_code: 'REMOTE_IDENTITY_INVALID' };
    const host = hostValue.toLowerCase();
    const pathValue = `/${scpPath}`;
    return { valid: true, contract_version: REMOTE_IDENTITY_CONTRACT_VERSION, kind: 'scp', scheme: 'scp', host, port: null, path: pathValue, user: 'git', canonical: `scp://git@${host}${pathValue}` };
  }
  if (!value.startsWith('https://') && !value.startsWith('ssh://')) return { valid: false, reason_code: 'REMOTE_IDENTITY_INVALID' };
  let parsed;
  try { parsed = new URL(value); } catch (_error) { return { valid: false, reason_code: 'REMOTE_IDENTITY_INVALID' }; }
  if (!['https:', 'ssh:'].includes(parsed.protocol) || parsed.search || parsed.hash || parsed.password || !parsed.hostname || parsed.hostname.includes(':') || parsed.pathname === '/' || parsed.pathname.length < 2) return { valid: false, reason_code: 'REMOTE_IDENTITY_INVALID' };
  const port = parsed.port ? Number(parsed.port) : null;
  if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) return { valid: false, reason_code: 'REMOTE_IDENTITY_INVALID' };
  const host = parsed.hostname.toLowerCase();
  if (host.includes('..') || host.startsWith('.') || host.endsWith('.')) return { valid: false, reason_code: 'REMOTE_IDENTITY_INVALID' };
  const scheme = parsed.protocol.slice(0, -1);
  const user = parsed.username || null;
  if (scheme === 'https' && user) return { valid: false, reason_code: 'REMOTE_IDENTITY_INVALID' };
  let decodedUser = null;
  try { decodedUser = user ? decodeURIComponent(user) : null; } catch (_error) { return { valid: false, reason_code: 'REMOTE_IDENTITY_INVALID' }; }
  const userPart = decodedUser ? decodedUser + '@' : '';
  const canonicalPort = port === null || (scheme === 'ssh' && port === 22) || (scheme === 'https' && port === 443) ? '' : ':' + port;
  const canonical = scheme + '://' + userPart + host + canonicalPort + parsed.pathname;
  const result = { valid: true, contract_version: REMOTE_IDENTITY_CONTRACT_VERSION, kind: 'url', scheme, host, port, path: parsed.pathname, canonical };
  if (decodedUser) result.user = decodedUser;
  return result;
}

// The validated remote for a canonical remote string, accepting the scp:// form that
// validateRemoteIdentity itself produces for git@host:path remotes.
function validatedCanonicalRemote(remoteValue) {
  let remote = validateRemoteIdentity(remoteValue);
  if (!remote.valid && typeof remoteValue === 'string' && remoteValue.startsWith('scp://git@')) {
    const separator = remoteValue.indexOf('/', 'scp://git@'.length);
    if (separator > 'scp://git@'.length) {
      const host = remoteValue.slice('scp://git@'.length, separator);
      const scpPath = remoteValue.slice(separator + 1);
      remote = validateRemoteIdentity('git@' + host + ':' + scpPath);
      if (remote.valid && remote.canonical !== remoteValue) remote = { valid: false };
    }
  }
  if (!remote.valid) fail('REMOTE_IDENTITY_INVALID');
  return remote;
}

// One repository, one identity, whichever way it was cloned: scheme, user, port, a trailing
// slash and a trailing .git are dropped, and github.com paths (case-insensitive there) are
// lowercased. https://github.com/Owner/Repo.git, git@github.com:owner/repo and
// ssh://git@github.com/owner/repo all give https://github.com/owner/repo.
function normalizedRemote(remote) {
  let repositoryPath = remote.path.replace(/\/+$/, '').replace(/\.git$/i, '');
  if (remote.host === 'github.com') repositoryPath = repositoryPath.toLowerCase();
  if (repositoryPath.length < 2) fail('REMOTE_IDENTITY_INVALID');
  return 'https://' + remote.host + repositoryPath;
}

function digestForRemote(canonical) {
  return digestValue({
    identity_contract: IDENTITY_CONTRACT,
    remote_contract: REMOTE_IDENTITY_CONTRACT_VERSION,
    remote: canonical,
  });
}

function repositoryIdForCanonicalRemote(remoteValue) {
  return digestForRemote(normalizedRemote(validatedCanonicalRemote(remoteValue)));
}

// The keys earlier Toolkit versions stored for the same repository, before clone forms were
// folded into one identity: the remote exactly as cloned, and the usual https, scp and ssh forms
// with and without .git, in the path's own case and lowercased. Decisions under these keys are
// still honoured; a new decision is written under the normalised key.
function legacyRepositoryIdsForCanonicalRemote(remoteValue) {
  const remote = validatedCanonicalRemote(remoteValue);
  const base = remote.path.replace(/\/+$/, '').replace(/\.git$/i, '');
  const candidates = [remote.canonical];
  for (const repositoryPath of [...new Set([base, base.toLowerCase()])]) {
    for (const suffix of ['', '.git']) {
      candidates.push('https://' + remote.host + repositoryPath + suffix);
      candidates.push('scp://git@' + remote.host + repositoryPath + suffix);
      candidates.push('ssh://git@' + remote.host + repositoryPath + suffix);
    }
  }
  const primary = repositoryIdForCanonicalRemote(remoteValue);
  return [...new Set(candidates.map(digestForRemote))].filter((id) => id !== primary);
}


module.exports = Object.freeze({ validateRemoteIdentity, repositoryIdForCanonicalRemote, legacyRepositoryIdsForCanonicalRemote });
