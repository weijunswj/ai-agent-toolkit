'use strict';

// The one answer to "which Toolkit governance state applies in this working directory?".
// Every hook, setup step, conformance check and catalogue call asks this module, and nothing else
// reads the three inputs it combines (#542):
//
//   identity   the origin-remote repository identity (toolkit.repository-identity.v1), read
//              from the repository's own git config file, never from the path;
//   materials  the governed block in the git root's AGENTS.md (B) and a valid programme binding
//              `.github/toolkit-programme.json` (P);
//   registry   the user's own decision for that identity in
//              ~/.ai-agent-toolkit/user-state/repository-governance.v1.json (U), stored and
//              written only by toolkit-capability-registry.cjs.
//
// States, first matching rule wins:
//   R1 no git root, or no usable origin identity    PORTABLE  global rules only, never held
//   R2 U declined or disabled                       DECLINED  global rules only; a governed block is ignored
//   R3 U enabled, B and P present                   ENABLED   global rules plus the governed block
//   R4 U not recorded, B and P present              ENABLED   as R3 (the repository opted in, the user did not decline)
//   R5 U enabled, B or P missing                    ENABLED   materials incomplete: gates, subagents, portable skills only
//   R6 U not recorded, B present, P absent          UNKNOWN   held until the one-time migration or the user answers
//   R7 anything else                                UNKNOWN   held until the user answers
// A read error after a git root and identity are found gives UNKNOWN (rule ERROR): the state
// cannot be shown not to be UNKNOWN, so callers that hold must hold (fail closed). A folder with
// no git root or no identity is never held.
//
// Reads local files only: no network, no git or gh subprocess, no writes. Node built-ins plus the
// existing registry, managed-block and remote-identity modules.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const registry = require('./toolkit-capability-registry.cjs');
const managedBlock = require('./toolkit-managed-block.cjs');
const { validateRemoteIdentity } = require('./toolkit-control-plane/control-plane-kernel.cjs');

const SCHEMA = 'toolkit.governance-state.v1';
const STATES = Object.freeze(['ENABLED', 'DECLINED', 'UNKNOWN', 'PORTABLE']);
const GOVERNANCE_CAPABILITY = 'repository.governance';
const GOVERNED_BLOCK = 'TOOLKIT-GOVERNED-RULES';
const LEGACY_GOVERNED_BLOCK = 'GLOBAL-AGENTS.MD-TEMPLATE';
const GOVERNED_BLOCK_LINE = /^<!-- AI-AGENT-TOOLKIT:[^\r\n]*:BEGIN (TOOLKIT-GOVERNED-RULES|GLOBAL-AGENTS\.MD-TEMPLATE) v\d+(?: [^\r\n]*)? -->\r?$/m;
const BINDING_FILE = Object.freeze(['.github', 'toolkit-programme.json']);
const BINDING_SCHEMA = 'toolkit.programme-binding.v1';
const REGISTRY_BASENAME = 'repository-governance.v1.json';
const AGENTS_READ_LIMIT = 1024 * 1024;
const BINDING_READ_LIMIT = 64 * 1024;
const GIT_FILE_READ_LIMIT = 4096;
const GIT_CONFIG_READ_LIMIT = 1024 * 1024;

class GovernanceStateError extends Error {
  constructor(code) {
    super(code);
    this.name = 'GovernanceStateError';
    this.code = code;
  }
}

function fail(code) { throw new GovernanceStateError(code); }

// Reads a regular file (not a link) up to `limit` bytes; null when it does not exist.
function readSmallFile(file, limit, tooLargeCode) {
  let stat;
  try { stat = fs.lstatSync(file); } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return null;
    fail('FILE_UNREADABLE');
  }
  if (stat.isSymbolicLink() || !stat.isFile()) fail('FILE_NOT_REGULAR');
  if (stat.size > limit) fail(tooLargeCode);
  try { return fs.readFileSync(file); } catch { fail('FILE_UNREADABLE'); }
}

// ---- identity ---------------------------------------------------------------------------------

// The values of `<section> "<subsection>"` `<key>` in one git config file, as `git config --local
// --get-all` returns them: section and key names ignore case, the quoted subsection does not;
// include directives are not followed (git does not follow them for --local either).
function gitConfigValues(text, section, subsection, key) {
  const values = [];
  const wantSection = section.toLowerCase();
  const wantKey = key.toLowerCase();
  let inTarget = false;
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index];
    const header = /^\s*\[([^\]"\s]+)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\](.*)$/.exec(line);
    if (header) {
      let name = header[1];
      let sub = header[2] === undefined ? null : header[2].replace(/\\(.)/g, '$1');
      const dot = name.indexOf('.');
      if (sub === null && dot !== -1) { sub = name.slice(dot + 1).toLowerCase(); name = name.slice(0, dot); }
      inTarget = name.toLowerCase() === wantSection && sub === subsection;
      line = header[3];
      if (!line.trim()) continue;
    } else if (/^\s*\[/.test(line)) {
      inTarget = false;
      continue;
    }
    const variable = /^\s*([A-Za-z][A-Za-z0-9-]*)\s*(=?)(.*)$/.exec(line);
    if (!variable) continue;
    // Continuation lines belong to this variable whether or not it is the one wanted.
    let raw = variable[3];
    while (/(^|[^\\])(\\\\)*\\$/.test(raw) && index + 1 < lines.length) {
      raw = raw.slice(0, -1) + lines[index + 1];
      index += 1;
    }
    if (!inTarget || variable[1].toLowerCase() !== wantKey) continue;
    values.push(variable[2] === '=' ? parseGitConfigValue(raw) : '');
  }
  return values;
}

function parseGitConfigValue(raw) {
  let out = '';
  let quoted = false;
  let pendingSpace = '';
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (!quoted && (char === '#' || char === ';')) break;
    if (char === '"') { out += pendingSpace; pendingSpace = ''; quoted = !quoted; continue; }
    if (char === '\\' && index + 1 < raw.length) {
      const next = raw[index + 1];
      index += 1;
      out += pendingSpace; pendingSpace = '';
      out += next === 'n' ? '\n' : next === 't' ? '\t' : next === 'b' ? '\b' : next;
      continue;
    }
    if (!quoted && (char === ' ' || char === '\t')) {
      if (out) pendingSpace += char;
      continue;
    }
    out += pendingSpace + char;
    pendingSpace = '';
  }
  return out;
}

// The nearest directory at or above `start` holding `.git` (a directory, or the file a worktree
// or submodule uses), or null.
function findGitRoot(start) {
  let current = path.resolve(start);
  for (;;) {
    let present = false;
    try { fs.lstatSync(path.join(current, '.git')); present = true; } catch { present = false; }
    if (present) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

// The config file `git config --local` reads for this worktree.
function gitConfigPath(root) {
  const dotGit = path.join(root, '.git');
  let stat;
  try { stat = fs.lstatSync(dotGit); } catch { fail('GIT_DIR_UNREADABLE'); }
  let gitDir;
  if (stat.isDirectory()) gitDir = dotGit;
  else if (stat.isFile()) {
    const pointer = /^gitdir:[ \t]*(.+?)[ \t]*$/m.exec(readSmallFile(dotGit, GIT_FILE_READ_LIMIT, 'GIT_DIR_UNREADABLE').toString('utf8'));
    if (!pointer) fail('GIT_DIR_UNREADABLE');
    gitDir = path.resolve(root, pointer[1]);
  } else fail('GIT_DIR_UNREADABLE');
  const commonDir = readSmallFile(path.join(gitDir, 'commondir'), GIT_FILE_READ_LIMIT, 'GIT_DIR_UNREADABLE');
  const configDir = commonDir ? path.resolve(gitDir, commonDir.toString('utf8').trim()) : gitDir;
  return path.join(configDir, 'config');
}

// { root, valid, reason, repository_id, remote } where `remote` is the parsed remote identity.
// Matches toolkit-capability-registry.cjs resolveRepositoryIdentity without running git.
function readIdentity(cwd) {
  const root = findGitRoot(typeof cwd === 'string' && cwd ? cwd : process.cwd());
  if (!root) return { root: null, valid: false, reason: 'no-git-root' };
  const configBytes = readSmallFile(gitConfigPath(root), GIT_CONFIG_READ_LIMIT, 'GIT_CONFIG_TOO_LARGE');
  const origins = configBytes ? gitConfigValues(configBytes.toString('utf8'), 'remote', 'origin', 'url') : [];
  if (origins.length === 0 || (origins.length === 1 && origins[0].trim() === '')) return { root, valid: false, reason: 'origin-missing' };
  if (origins.length !== 1) return { root, valid: false, reason: 'origin-ambiguous' };
  const remote = validateRemoteIdentity(origins[0]);
  if (!remote.valid) return { root, valid: false, reason: 'origin-unsupported' };
  return { root, valid: true, reason: null, repository_id: registry.repositoryIdForCanonicalRemote(remote.canonical), remote };
}

// "owner/name" for a remote whose path has exactly two segments (a trailing .git dropped).
function remoteSlug(remote) {
  if (!remote || typeof remote.path !== 'string') return null;
  const parts = remote.path.replace(/^\/+/, '').replace(/\.git$/i, '').split('/');
  return parts.length === 2 && parts.every(Boolean) ? parts.join('/') : null;
}

// ---- materials --------------------------------------------------------------------------------

function readGovernedBlock(root) {
  const bytes = readSmallFile(path.join(root, 'AGENTS.md'), AGENTS_READ_LIMIT, 'AGENTS_TOO_LARGE');
  if (!bytes) return { present: false };
  const text = bytes.toString('utf8');
  const { blocks, errors } = managedBlock.findBlocks(text);
  const block = blocks.find(entry => entry.name === GOVERNED_BLOCK) || blocks.find(entry => entry.name === LEGACY_GOVERNED_BLOCK);
  if (block) {
    return {
      present: true, name: block.name, legacy: block.name === LEGACY_GOVERNED_BLOCK, marker_errors: errors.length,
      block: { source: block.source, name: block.name, format: block.format, version: block.version, digest: block.digest, body: block.body },
    };
  }
  const line = GOVERNED_BLOCK_LINE.exec(text);
  if (line) return { present: true, name: line[1], legacy: line[1] === LEGACY_GOVERNED_BLOCK, marker_errors: Math.max(errors.length, 1), block: null };
  return { present: false, marker_errors: errors.length };
}

const SLUG = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const PREFIX = /^[A-Za-z0-9._-]{1,40}$/;

function isPlainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function onlyKeys(value, allowed) { return Object.keys(value).every(key => allowed.includes(key)); }

// The problems with a parsed binding against toolkit.programme-binding.v1
// (repo/contracts/programme-state/binding-v1.schema.json), plus the rule that
// the binding agrees with the origin identity and cannot override it. Empty when valid.
function bindingProblems(binding, identity) {
  const problems = [];
  if (!isPlainObject(binding)) return ['not-an-object'];
  const required = ['schema', 'repository', 'parent_issue', 'record_prefix', 'writer_prefix', 'store', 'required_checks'];
  for (const key of required) if (!Object.prototype.hasOwnProperty.call(binding, key)) problems.push(`missing-${key}`);
  if (!onlyKeys(binding, required)) problems.push('unknown-key');
  if (binding.schema !== BINDING_SCHEMA) problems.push('schema');
  if (typeof binding.repository !== 'string' || !SLUG.test(binding.repository)) problems.push('repository');
  if (!Number.isInteger(binding.parent_issue) || binding.parent_issue < 1) problems.push('parent_issue');
  if (typeof binding.record_prefix !== 'string' || !PREFIX.test(binding.record_prefix)) problems.push('record_prefix');
  if (typeof binding.writer_prefix !== 'string' || !PREFIX.test(binding.writer_prefix)) problems.push('writer_prefix');
  const store = binding.store;
  const storeKeys = ['kind', 'repository', 'branch', 'path'];
  if (!isPlainObject(store) || !onlyKeys(store, storeKeys) || !storeKeys.every(key => Object.prototype.hasOwnProperty.call(store, key))
    || store.kind !== 'github' || typeof store.repository !== 'string' || !SLUG.test(store.repository)
    || typeof store.branch !== 'string' || store.branch.length === 0
    || typeof store.path !== 'string' || !/^([A-Za-z0-9_.-]+\/)+$/.test(store.path)) problems.push('store');
  if (!Array.isArray(binding.required_checks) || !binding.required_checks.every(item => typeof item === 'string' && item.length > 0)) problems.push('required_checks');
  if (!problems.includes('repository')) {
    const slug = remoteSlug(identity && identity.remote);
    if (!slug || slug.toLowerCase() !== binding.repository.toLowerCase()) problems.push('repository-disagrees-with-origin');
  }
  return problems;
}

function readBinding(root, identity) {
  const bytes = readSmallFile(path.join(root, ...BINDING_FILE), BINDING_READ_LIMIT, 'BINDING_TOO_LARGE');
  if (!bytes) return { present: false, valid: false, problems: [] };
  let parsed;
  try { parsed = JSON.parse(bytes.toString('utf8').replace(/^﻿/, '')); } catch { return { present: true, valid: false, problems: ['not-json'] }; }
  const problems = bindingProblems(parsed, identity);
  return { present: true, valid: problems.length === 0, problems };
}

function readMaterials(root, identity) {
  return { governed_block: readGovernedBlock(root), binding: readBinding(root, identity) };
}

// ---- registry ---------------------------------------------------------------------------------

function registryPathFor(options = {}) {
  const overridden = options.registryPath !== undefined || options.userHome !== undefined;
  if (overridden && options.testOnly !== true) fail('REGISTRY_PATH_OVERRIDE_FORBIDDEN');
  if (options.registryPath !== undefined) {
    if (typeof options.registryPath !== 'string' || !path.isAbsolute(options.registryPath)
      || path.basename(options.registryPath) !== REGISTRY_BASENAME) fail('REGISTRY_PATH_INVALID');
    return path.normalize(options.registryPath);
  }
  const home = options.userHome !== undefined ? options.userHome : os.homedir();
  if (typeof home !== 'string' || !path.isAbsolute(home)) fail('USER_HOME_INVALID');
  return path.join(home, '.ai-agent-toolkit', 'user-state', REGISTRY_BASENAME);
}

// The user's recorded governance decision for one identity: 'enabled', 'disabled' or
// 'unresolved' (nothing recorded), with its decision kind. A missing file is 'unresolved'; a
// file that cannot be read or does not validate throws.
function readDecision(repositoryId, options = {}) {
  const bytes = readSmallFile(registryPathFor(options), registry.MAX_REGISTRY_BYTES, 'REGISTRY_TOO_LARGE');
  if (!bytes) return { state: 'unresolved', decision_kind: null };
  let parsed;
  try { parsed = registry.parseRegistryBytes(bytes); } catch (error) { fail(/^[A-Z][A-Z0-9_]{1,63}$/.test(error && error.code) ? error.code : 'REGISTRY_MALFORMED'); }
  const record = parsed.repositories.find(entry => entry.repository_id === repositoryId);
  const entry = record && record.capabilities.find(candidate => candidate.capability_id === GOVERNANCE_CAPABILITY);
  return entry ? { state: entry.state, decision_kind: entry.decision_kind } : { state: 'unresolved', decision_kind: null };
}

// ---- derivation -------------------------------------------------------------------------------

function result(fields) {
  const state = fields.state;
  const complete = state === 'ENABLED' && fields.materials_complete === true;
  return Object.freeze({
    schema: SCHEMA,
    state,
    rule: fields.rule,
    reason: fields.reason,
    hold: state === 'UNKNOWN',
    persistable: fields.persistable === true,
    materials_complete: state === 'ENABLED' ? complete : null,
    governed_rules_bind: complete,
    programme_records_bind: complete,
    recorded_decision: fields.recorded_decision || null,
    repository_id: fields.repository_id || null,
    root: fields.root || null,
    materials: fields.materials ? Object.freeze({
      governed_block: fields.materials.governed_block.present === true,
      governed_block_legacy: fields.materials.governed_block.legacy === true,
      binding: fields.materials.binding.valid === true,
      binding_present: fields.materials.binding.present === true,
      binding_problems: Object.freeze([...(fields.materials.binding.problems || [])]),
    }) : null,
    error_code: fields.error_code || null,
  });
}

class GovernanceState {
  #readIdentity; #readMaterials; #readDecision;

  // Readers are injectable so the derivation can be tested on its own; the defaults read the
  // real repository and the real user-state file.
  constructor({ identityReader = readIdentity, materialsReader = readMaterials, decisionReader = readDecision, registryOptions = {} } = {}) {
    this.#readIdentity = identityReader;
    this.#readMaterials = materialsReader;
    this.#readDecision = (repositoryId) => decisionReader(repositoryId, registryOptions);
  }

  // The pure rule table over already-read inputs.
  static derive({ identity, materials, decision }) {
    const base = { root: identity.root, repository_id: identity.repository_id, persistable: true, recorded_decision: decision.state, materials };
    const block = materials.governed_block.present === true;
    const binding = materials.binding.valid === true;
    if (decision.state === 'disabled') return result({ ...base, state: 'DECLINED', rule: 'R2', reason: decision.decision_kind === 'disable' ? 'user-disabled' : 'user-declined' });
    if (block && binding) {
      return decision.state === 'enabled'
        ? result({ ...base, state: 'ENABLED', rule: 'R3', reason: 'user-enabled', materials_complete: true })
        : result({ ...base, state: 'ENABLED', rule: 'R4', reason: 'repository-opt-in', materials_complete: true });
    }
    if (decision.state === 'enabled') return result({ ...base, state: 'ENABLED', rule: 'R5', reason: block ? 'binding-missing' : 'governed-block-missing', materials_complete: false });
    if (block) return result({ ...base, state: 'UNKNOWN', rule: 'R6', reason: 'governed-block-without-binding' });
    return result({ ...base, state: 'UNKNOWN', rule: 'R7', reason: 'no-decision' });
  }

  evaluate(cwd) {
    let identity;
    try {
      identity = this.#readIdentity(cwd);
    } catch (error) {
      // A git root exists (identity reading only throws after finding one) but its config could
      // not be read: the state cannot be shown not to be UNKNOWN.
      return result({ state: 'UNKNOWN', rule: 'ERROR', reason: 'identity-unreadable', error_code: codeOf(error), root: findGitRootQuietly(cwd) });
    }
    if (!identity.root) return result({ state: 'PORTABLE', rule: 'R1', reason: 'no-git-root' });
    if (!identity.valid) return result({ state: 'PORTABLE', rule: 'R1', reason: identity.reason, root: identity.root });
    const partial = { root: identity.root, repository_id: identity.repository_id, persistable: true };
    let decision;
    let materials;
    try {
      decision = this.#readDecision(identity.repository_id);
    } catch (error) {
      return result({ ...partial, state: 'UNKNOWN', rule: 'ERROR', reason: 'registry-unreadable', error_code: codeOf(error) });
    }
    try {
      materials = this.#readMaterials(identity.root, identity);
    } catch (error) {
      return result({ ...partial, state: 'UNKNOWN', rule: 'ERROR', reason: 'materials-unreadable', error_code: codeOf(error), recorded_decision: decision.state });
    }
    return GovernanceState.derive({ identity, materials, decision });
  }
}

function codeOf(error) {
  return error && typeof error.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(error.code) ? error.code : 'UNEXPECTED';
}

function findGitRootQuietly(cwd) {
  try { return findGitRoot(typeof cwd === 'string' && cwd ? cwd : process.cwd()); } catch { return null; }
}

// The single exported entry point other lanes consume (hooks, setup, conformance, catalogue, R6).
function governanceState(cwd, options = {}) {
  return new GovernanceState({ registryOptions: options }).evaluate(cwd);
}

module.exports = Object.freeze({
  SCHEMA,
  STATES,
  GOVERNANCE_CAPABILITY,
  GOVERNED_BLOCK,
  LEGACY_GOVERNED_BLOCK,
  BINDING_FILE: BINDING_FILE.join('/'),
  BINDING_SCHEMA,
  GovernanceState,
  GovernanceStateError,
  governanceState,
  readIdentity,
  readMaterials,
  readGovernedBlock,
  readDecision,
  registryPathFor,
  bindingProblems,
  gitConfigValues,
  findGitRoot,
  remoteSlug,
});
