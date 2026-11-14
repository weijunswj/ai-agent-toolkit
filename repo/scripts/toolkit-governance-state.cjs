'use strict';

// Effective governance comes only from origin's default-branch programme file.
// Working files, pending proposals and historical local answers grant no authority.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const repositoryIdentity = require('./toolkit-repository-identity.cjs');
const { userStateDirectory } = require('./toolkit-user-state.cjs');
const bindingCache = require('./toolkit-governance-binding.cjs');
const managedBlock = require('./toolkit-managed-block.cjs');
const { validateRemoteIdentity } = repositoryIdentity;
const programmeState = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');

const SCHEMA = 'toolkit.governance-state.v1';
// GitHub governance (the reconciler and its records) supports github.com: github.com itself, its
// subdomains (ssh.github.com), and an SSH alias with no dot whose name mentions github (github-work),
// since an alias cannot be resolved from the repository alone. Any other dotted host, a GitHub
// Enterprise server included, is not github.com. The reconciler uses the same test.
const TRACKING_HOST = 'github.com';
const trackingHost = programmeState.isGitHubHost;
const STATES = Object.freeze(['ENABLED', 'DISABLED', 'UNDECIDED', 'UNAVAILABLE', 'ERROR']);
const GOVERNED_BLOCK = 'TOOLKIT-GOVERNED-RULES';
const LEGACY_GOVERNED_BLOCK = 'GLOBAL-AGENTS.MD-TEMPLATE';
const GOVERNED_BLOCK_LINE = /^<!-- AI-AGENT-TOOLKIT:[^\r\n]*:BEGIN (TOOLKIT-GOVERNED-RULES|GLOBAL-AGENTS\.MD-TEMPLATE) v\d+(?: [^\r\n]*)? -->\r?$/m;
const BINDING_FILE = Object.freeze(['.github', 'toolkit-programme.json']);
// The version 1 schema name; a v1 binding reads as enabled with one parent.
const BINDING_SCHEMA = 'toolkit.programme-binding.v1';
// An early name for the binding; reported for the owner, never read or rewritten.
const LEGACY_BINDING_FILE = Object.freeze(['.github', 'ai-agent-toolkit-programme.json']);
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
// Reads the origin from Git's own config, without a subprocess or a local decision store.
function readIdentity(cwd) {
  const root = findGitRoot(typeof cwd === 'string' && cwd ? cwd : process.cwd());
  if (!root) return { root: null, valid: false, reason: 'no-git-root' };
  const configBytes = readSmallFile(gitConfigPath(root), GIT_CONFIG_READ_LIMIT, 'GIT_CONFIG_TOO_LARGE');
  const origins = configBytes ? gitConfigValues(configBytes.toString('utf8'), 'remote', 'origin', 'url') : [];
  if (origins.length === 0 || (origins.length === 1 && origins[0].trim() === '')) return { root, valid: false, reason: 'origin-missing' };
  if (origins.length !== 1) return { root, valid: false, reason: 'origin-ambiguous' };
  const remote = validateRemoteIdentity(origins[0]);
  if (!remote.valid) return { root, valid: false, reason: 'origin-unsupported' };
  return {
    root, valid: true, reason: null, remote,
    repository_id: repositoryIdentity.repositoryIdForCanonicalRemote(remote.canonical),
    legacy_repository_ids: repositoryIdentity.legacyRepositoryIdsForCanonicalRemote(remote.canonical),
  };
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

// The problems with a parsed binding, as the reconciler that consumes it judges them
// (validateBinding in skills/github-program-reconciler/scripts/programme-state.cjs, schema
// binding-v1.schema.json and binding-v2.schema.json under repo/contracts/programme-state/), plus the rule that the binding agrees
// with the origin identity and cannot override it. Empty when valid.
function bindingProblems(binding, identity) {
  try {
    programmeState.validateBinding(binding);
  } catch (error) {
    const errors = error && error.details && Array.isArray(error.details.errors) ? error.details.errors : [];
    return errors.length ? errors.map(String) : ['binding is invalid'];
  }
  const slug = remoteSlug(identity && identity.remote);
  return slug && slug.toLowerCase() === binding.repository.toLowerCase() ? [] : ['repository does not match the origin remote'];
}

function readBinding(root, identity) {
  const bytes = readSmallFile(path.join(root, ...BINDING_FILE), BINDING_READ_LIMIT, 'BINDING_TOO_LARGE');
  if (!bytes) return { present: false, valid: false, problems: [] };
  let parsed;
  try { parsed = JSON.parse(bytes.toString('utf8').replace(/^﻿/, '')); } catch { return { present: true, valid: false, problems: ['not valid JSON'] }; }
  const problems = bindingProblems(parsed, identity);
  const valid = problems.length === 0;
  return { present: true, valid, problems };
}

// The valid binding merged on the default branch for the repository at root, from this computer's
// cache, or null. Only this binding names the evidence store and required checks: a working tree
// any agent can edit does not.
function mergedBinding(root, options = {}) {
  try {
    const identity = readIdentity(root);
    if (!identity.valid) return null;
    const judged = judgeMerged(bindingCache.readBindingCache(identity, userStateDirectory(options)), identity, new Date());
    return judged.status === 'enabled' ? judged.binding : null;
  } catch { return null; }
}

// The evidence store the merged binding names ("owner/name"), or null. Kept out of the state result,
// which never carries repository names.
function bindingStoreRepository(root, options = {}) {
  const binding = mergedBinding(root, options);
  return binding ? binding.store.repository : null;
}

// The evidence store the working tree's binding names, or null. Only for proposals the owner
// confirms (migration marks such a store as an evidence store); it never decides governance.
function workingBindingStoreRepository(root) {
  try {
    const bytes = readSmallFile(path.join(root, ...BINDING_FILE), BINDING_READ_LIMIT, 'BINDING_TOO_LARGE');
    if (!bytes) return null;
    const parsed = JSON.parse(bytes.toString('utf8').replace(/^﻿/, ''));
    return bindingProblems(parsed, readIdentity(root)).length === 0 && parsed.store ? parsed.store.repository : null;
  } catch { return null; }
}

// The check names the working tree's binding requires, or null. Compared with the merged binding's
// only; it never decides anything on its own.
function workingBindingRequiredChecks(root) {
  try {
    const bytes = readSmallFile(path.join(root, ...BINDING_FILE), BINDING_READ_LIMIT, 'BINDING_TOO_LARGE');
    if (!bytes) return null;
    const result = committedBindingPolicy(bytes.toString('utf8'), readIdentity(root));
    return result.valid ? result.required_checks : null;
  } catch { return null; }
}

// The check names the merged binding requires at the head ("CI green"), or null.
function bindingRequiredChecks(root, options = {}) {
  const binding = mergedBinding(root, options);
  return binding ? [...binding.required_checks] : null;
}

// One resolver for setup, reporting and enforcement. The selected app's local answer is
// the only switch. A fresh enabled v2 merged binding still bounds its repository scope.
// Setup passes no root and displays `preference`; that never grants a repository merge.
function taskAutoMerge(root, options = {}) {
  const { TaskAutoMergePreferences } = require('./toolkit-task-auto-merge-preferences.cjs');
  const preference = new TaskAutoMergePreferences({ host: options.host, ...(options.home ? { home: options.home } : {}) }).inspect();
  const off = { auto_merge: 'off', answered: preference.status === 'saved', fresh: false,
    source: preference.host ? `machine:${preference.host}` : 'unavailable', preference };
  if (preference.status === 'blocked') return { ...off, reason: preference.host ? 'preference-blocked' : 'unknown-host' };
  if (!root) return { ...off, reason: 'repository-required' };
  try {
    const identity = readIdentity(root);
    if (!identity.valid) return { ...off, reason: 'repository-invalid' };
    const now = typeof options.now === 'function' ? options.now() : new Date();
    const judged = judgeMerged(bindingCache.readBindingCache(identity, userStateDirectory(options)), identity, now);
    if (judged.status !== 'enabled' || judged.binding.schema !== 'toolkit.programme-binding.v2' || judged.fresh !== true) return { ...off, reason: 'fresh-enabled-binding-required' };
    return { ...off, fresh: true, auto_merge: preference.value,
      reason: preference.status === 'missing' ? 'no-answer-saved' : preference.value === 'off' ? 'machine-off' : 'machine-on' };
  } catch { return { ...off, reason: 'binding-unreadable' }; }
}

// The dependency policy of a parsed binding: { auto_merge, github_actions }. Missing keys take the
// safe defaults: auto-merge off and GitHub Actions updates kept for the owner. A binding's
// deprecated `paid_security` key is accepted and ignored when it is "off" or "on"; any other value
// makes the binding invalid.
function policyOf(binding) {
  const updates = binding && typeof binding.dependency_updates === 'object' && binding.dependency_updates ? binding.dependency_updates : {};
  return {
    auto_merge: updates.auto_merge === 'patch-minor' ? 'patch-minor' : 'off',
    github_actions: updates.github_actions === 'auto-merge' ? 'auto-merge' : 'owner',
  };
}

// The policy of binding `text` as committed on the default branch (read from GitHub by the caller,
// since this module never runs git or gh). Only a merged binding is the owner's answer: a working
// tree any agent can edit is not. { valid, policy, required_checks, problems }; an invalid binding
// has the safe defaults and no required checks.
function committedBindingPolicy(text, identity) {
  let parsed;
  try { parsed = JSON.parse(String(text).replace(/^\uFEFF/, '')); } catch { return { valid: false, policy: policyOf(null), required_checks: null, problems: ['not valid JSON'] }; }
  const problems = bindingProblems(parsed, identity);
  return problems.length ? { valid: false, policy: policyOf(null), required_checks: null, problems }
    : { valid: true, policy: policyOf(parsed), required_checks: Array.isArray(parsed.required_checks) ? [...parsed.required_checks] : [], problems: [] };
}

// The policy the working-tree binding asks for, or null when it is missing or invalid. Shown only
// to say what still has to be merged; it never turns anything on.
function workingBindingPolicy(root) {
  try {
    const bytes = readSmallFile(path.join(root, ...BINDING_FILE), BINDING_READ_LIMIT, 'BINDING_TOO_LARGE');
    if (!bytes) return null;
    const result = committedBindingPolicy(bytes.toString('utf8'), readIdentity(root));
    return result.valid ? result.policy : null;
  } catch { return null; }
}

function readMaterials(root, identity) {
  let legacyBinding = false;
  try { legacyBinding = fs.lstatSync(path.join(root, ...LEGACY_BINDING_FILE)).isFile(); } catch { legacyBinding = false; }
  return { governed_block: readGovernedBlock(root), binding: readBinding(root, identity), legacy_binding_file: legacyBinding };
}

// The key a git repository without a usable origin is known by on this computer: its real path.
function localRepositoryId(root) {
  let real = root;
  try { real = fs.realpathSync.native(root); } catch { real = path.resolve(root); }
  return `path:${crypto.createHash('sha256').update(process.platform === 'win32' ? real.toLowerCase() : real).digest('hex')}`;
}

// ---- evidence stores and scratch clones -------------------------------------------------------

const SCRATCH_FOLDER = '.tmp';
const SCRATCH_IGNORE_LINES = Object.freeze(['.tmp', '.tmp/', '/.tmp', '/.tmp/']);
const GITIGNORE_READ_LIMIT = 1024 * 1024;
// Exact evidence-store relationships in validated cached bindings, as lowercase owner/name values.
// Only valid, enabled bindings with a github store count, and a damaged cache file is skipped.
function evidenceStoreRepositories(options = {}, now = new Date()) {
  const stores = new Set();
  for (const { identity, entry } of bindingCache.readAllBindingCaches(userStateDirectory(options))) {
    const judged = judgeMerged(entry, identity, now);
    if (judged.status !== 'enabled' || !judged.binding.store || judged.binding.store.kind !== 'github') continue;
    stores.add(judged.binding.store.repository.toLowerCase());
  }
  return Object.freeze({ stores });
}

// The repositories ("owner/name") whose cached merged binding has governance on, sorted. Only a hint
// for the governance App removal steps; this computer may not know every governed repository.
function enabledRepositories(options = {}, now = new Date()) {
  const found = [];
  for (const { identity, entry } of bindingCache.readAllBindingCaches(userStateDirectory(options))) {
    const judged = judgeMerged(entry, identity, now);
    if (judged.status === 'enabled') found.push(judged.binding.repository);
  }
  return found.sort();
}

// A name or shared owner supplies no exemption.
function evidenceStoreOf(identity, scan) {
  const slug = remoteSlug(identity && identity.remote);
  if (!slug || !scan) return null;
  const lower = slug.toLowerCase();
  if (scan.stores.has(lower)) return 'evidence-store';
  return null;
}

// Whether the parent repository's root .gitignore ignores the top-level scratch folder, by an exact
// line (no git check-ignore).
function ignoresScratch(parentRoot) {
  let bytes;
  try { bytes = readSmallFile(path.join(parentRoot, '.gitignore'), GITIGNORE_READ_LIMIT, 'GITIGNORE_TOO_LARGE'); } catch { return false; }
  if (!bytes) return false;
  return bytes.toString('utf8').replace(/^﻿/, '').split(/\r?\n/).some(line => SCRATCH_IGNORE_LINES.includes(line.trim()));
}

// The git root of the repository that holds `root` in its ignored top-level `.tmp/` folder, or null.
function scratchParentOf(root) {
  const parent = findGitRootQuietly(path.dirname(root));
  if (!parent) return null;
  const inside = path.relative(parent, root).split(path.sep);
  return inside.length >= 2 && inside[0] === SCRATCH_FOLDER && ignoresScratch(parent) ? parent : null;
}

// ---- derivation -------------------------------------------------------------------------------

function result(fields) {
  const state = fields.state;
  const complete = state === 'ENABLED' && fields.materials_complete === true;
  const effectsHold = state === 'ERROR' || state === 'UNAVAILABLE' || state === 'UNDECIDED' || (complete && fields.merged_fresh !== true);
  // The canonical slug stays local to the advisory; serialised status and diagnostics stay unchanged.
  return Object.freeze(Object.defineProperty({
    schema: SCHEMA,
    state,
    rule: fields.rule,
    reason: fields.reason,
    materials_complete: state === 'ENABLED' ? complete : null,
    governed_rules_bind: complete,
    // Gate admission, finality and governed writes (programme records): only on a fresh read of
    // the merged binding (A4). Routine work follows governed_rules_bind.
    programme_records_bind: complete && !effectsHold,
    governed_effects_hold: effectsHold,
    repository_id: fields.repository_id || null,
    root: fields.root || null,
    materials: fields.materials ? Object.freeze({
      governed_block: fields.materials.governed_block.present === true,
      governed_block_legacy: fields.materials.governed_block.legacy === true,
      binding: fields.merged_binding_valid === true,
      binding_present: fields.materials.binding.present === true,
      binding_problems: Object.freeze([...(fields.materials.binding.problems || [])]),
      legacy_binding_file: fields.materials.legacy_binding_file === true,
    }) : null,
    merged: fields.merged ? Object.freeze({ ...fields.merged }) : null,
    notes: Object.freeze([...(fields.notes || [])]),
    error_code: fields.error_code || null,
    host: fields.host || null,
    folder: fields.folder || null,
  }, 'repository', { value: fields.repository || null }));
}

// What the cached default-branch binding says: { status: 'none' | 'unknown' | 'invalid' | 'foreign'
// | 'enabled' | 'disabled', version, problems, foreign_repository, commit, fetched_at, fresh }.
function judgeMerged(entry, identity, now) {
  if (!entry) return { status: 'unknown', fresh: false };
  const base = { commit: entry.commit, fetched_at: entry.fetched_at, fresh: !entry.refresh_error && bindingCache.isFresh(entry, now), unavailable: Boolean(entry.refresh_error) };
  if (entry.status === 'absent') return { ...base, status: 'none' };
  if (typeof entry.text !== 'string') return { ...base, status: 'invalid', problems: [entry.problem || 'unreadable'] };
  let parsed;
  try { parsed = JSON.parse(entry.text.replace(/^﻿/, '')); } catch { return { ...base, status: 'invalid', problems: ['not valid JSON'] }; }
  let valid;
  try { valid = programmeState.validateBinding(parsed); } catch (error) {
    const errors = error && error.details && Array.isArray(error.details.errors) ? error.details.errors.map(String) : ['binding is invalid'];
    return { ...base, status: 'invalid', problems: errors };
  }
  const slug = remoteSlug(identity.remote);
  if (!slug || slug.toLowerCase() !== valid.repository.toLowerCase()) return { ...base, status: 'foreign', foreign_repository: valid.repository };
  return { ...base, status: programmeState.bindingEnabled(valid) ? 'enabled' : 'disabled', version: valid.schema === BINDING_SCHEMA ? 1 : 2, binding: valid };
}

class GovernanceState {
  #readIdentity; #readMaterials; #readMerged; #readStores; #now;

  // Readers are injectable so the derivation can be tested on its own; the defaults read the
  // real repository, the real user-state files and this computer's cache of the merged binding.
  constructor({ identityReader = readIdentity, materialsReader = readMaterials, mergedReader = null, storeReader = null, registryOptions = {}, now = () => new Date() } = {}) {
    this.#readIdentity = identityReader;
    this.#readMaterials = materialsReader;
    this.#readMerged = mergedReader || (identity => bindingCache.readBindingCache(identity, userStateDirectory(registryOptions)));
    this.#readStores = storeReader || (() => evidenceStoreRepositories(registryOptions, now()));
    this.#now = now;
  }

  // The pure rule table over already-read inputs. `merged` is judgeMerged's view of the
  // default-branch binding (read only for a github.com repository).
  // `store` is evidenceStoreOf's answer and `scratch` whether the repository is a clone of another
  // repository in a decided repository's ignored `.tmp/` folder (both read only for github.com).
  static derive({ identity, materials, merged = { status: 'unknown', fresh: false }, store = null, scratch = false }) {
    const base = { root: identity.root, repository_id: identity.repository_id, repository: remoteSlug(identity.remote), materials };
    const notGitHub = notGitHubOf(identity);
    if (notGitHub) {
      const fields = { ...base, host: notGitHub.host, reason: notGitHub.reason };
      return result({ ...fields, state: 'DISABLED', rule: 'R8' });
    }
    const view = { status: merged.status, version: merged.version || null, commit: merged.commit || null, fetched_at: merged.fetched_at || null, fresh: merged.fresh === true, foreign_repository: merged.foreign_repository || null, problems: merged.problems || [] };
    const withMerged = { ...base, merged: view, merged_fresh: view.fresh };
    // The repository's merged binding decides, on every computer (A1, A3).
    if (merged.status === 'invalid') return result({ ...withMerged, state: 'ERROR', rule: 'M0', reason: 'merged-binding-invalid' });
    if (merged.status === 'disabled') return result({ ...withMerged, state: 'DISABLED', rule: 'M2', reason: 'repository-disabled',
      notes: merged.unavailable ? ['could-not-check-governance'] : !view.fresh ? ['merged-binding-stale'] : [] });
    if (merged.status === 'enabled') {
      const notes = [];
      if (merged.version === 1) notes.push('binding-v2-migration-offered');
      if (merged.unavailable) notes.push('could-not-check-governance');
      else if (!view.fresh) notes.push('merged-binding-stale');
      return result({ ...withMerged, state: 'ENABLED', rule: 'M1', reason: 'repository-enabled', materials_complete: true, merged_binding_valid: true, notes });
    }
    // Exact evidence relationships and scratch clones need no governance question.
    if (store || scratch) {
      const notes = [];
      return store
        ? result({ ...withMerged, state: 'DISABLED', rule: 'S1', reason: store, notes })
        : result({ ...withMerged, state: 'DISABLED', rule: 'R1s', reason: 'scratch-clone', notes });
    }
    const notes = [];
    if (merged.status === 'foreign') notes.push('binding-belongs-to-other-repository');
    if (materials.binding.present === true) notes.push('pending-binding-merge');
    if (merged.status === 'unknown' || !view.fresh) return result({ ...withMerged, state: 'UNAVAILABLE', rule: 'U1', reason: 'governance-unavailable', notes: [...notes, 'could-not-check-governance'] });
    return result({ ...withMerged, state: 'UNDECIDED', rule: 'R7', reason: 'no-decision', notes });
  }

  evaluate(cwd, depth = 0) {
    let identity;
    try {
      identity = this.#readIdentity(cwd);
    } catch (error) {
      // Unreadable identity supplies no authority and does not stop ordinary work.
      return result({ state: 'UNAVAILABLE', rule: 'ERROR', reason: 'identity-unreadable', error_code: codeOf(error), root: findGitRootQuietly(cwd) });
    }
    if (!identity.root) {
      return result({ state: 'DISABLED', rule: 'R1', reason: 'no-git', folder: path.resolve(typeof cwd === 'string' && cwd ? cwd : process.cwd()) });
    }
    if (!identity.valid) {
      // No usable origin: the repository is known on this computer by its path, and never by a remote.
      const local = { ...identity, repository_id: localRepositoryId(identity.root), legacy_repository_ids: [] };
      return GovernanceState.derive({ identity: local, materials: EMPTY_MATERIALS });
    }
    // GitHub-only decisions, materials and binding caches cannot affect an unsupported host.
    if (notGitHubOf(identity)) return GovernanceState.derive({ identity, materials: EMPTY_MATERIALS });
    let materials;
    try { materials = this.#readMaterials(identity.root, identity); }
    catch { materials = EMPTY_MATERIALS; } // Instruction damage never erases a repository decision.
    let store = null;
    let scratch = false;
    let entry = null;
    try { entry = this.#readMerged(identity); } catch { entry = null; }
    const merged = judgeMerged(entry, identity, this.#now());
    if (!['invalid', 'disabled', 'enabled'].includes(merged.status)) {
      try { store = evidenceStoreOf(identity, this.#readStores()); } catch { store = null; }
      if (!store) scratch = this.#scratchClone(identity, depth);
    }
    return GovernanceState.derive({ identity, materials, merged, store, scratch });
  }

  // Whether `identity` is a clone of a different repository inside the ignored top-level `.tmp/`
  // folder of a repository whose own state is decided (ENABLED or DISABLED). A worktree of the
  // parent itself has the parent's identity and keeps the parent's state.
  #scratchClone(identity, depth) {
    if (depth >= SCRATCH_DEPTH_LIMIT) return false;
    const parent = scratchParentOf(identity.root);
    if (!parent) return false;
    const outer = this.evaluate(parent, depth + 1);
    return ['ENABLED', 'DISABLED'].includes(outer.state) && outer.repository_id !== identity.repository_id;
  }
}

// How many enclosing repositories a scratch-clone check reads at most.
const SCRATCH_DEPTH_LIMIT = 4;

const EMPTY_MATERIALS = Object.freeze({ governed_block: Object.freeze({ present: false }), binding: Object.freeze({ present: false, valid: false, problems: [] }), legacy_binding_file: false });

// { host, reason } when the repository is not a github.com repository, else null. reason is
// 'origin-missing', 'origin-ambiguous', 'origin-unsupported' or 'other-host'.
function notGitHubOf(identity) {
  if (identity.valid === false) return { host: null, reason: identity.reason || 'origin-missing' };
  const host = identity.remote && typeof identity.remote.host === 'string' ? identity.remote.host.toLowerCase() : TRACKING_HOST;
  return trackingHost(host) ? null : { host, reason: 'other-host' };
}

function codeOf(error) {
  return error && typeof error.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(error.code) ? error.code : 'UNEXPECTED';
}

function findGitRootQuietly(cwd) {
  try { return findGitRoot(typeof cwd === 'string' && cwd ? cwd : process.cwd()); } catch { return null; }
}

// The single exported entry point other lanes consume (hooks, setup, conformance, catalogue, R6).
// The command a person types to run the governance CLI from this Toolkit copy. There is no
// `toolkit` executable, so messages show the real path.
function governanceCommand(subcommand) {
  return `node "${path.join(__dirname, 'toolkit-governance.cjs')}" ${subcommand}`;
}

function governanceState(cwd, options = {}) {
  return new GovernanceState({ registryOptions: options }).evaluate(cwd);
}

// Refreshes this computer's cache of the merged binding for the repository at cwd (`toolkit
// governance status`, session start, or a prompt after a known proposal closes). Never throws; returns
// { refreshed, error }. Nothing to refresh outside a github.com repository.
// With TOOLKIT_GOVERNANCE_OFFLINE=1 (set for test runs), or for a test registry, nothing reads the
// network unless a git runner is passed in: the last read stays, so governed effects hold once it is
// over 24 hours old.
function refreshMergedBinding(cwd, options = {}, { runGit, timeout, deadline, now, environment = process.env } = {}) {
  if (!runGit && (environment.TOOLKIT_GOVERNANCE_OFFLINE === '1' || options.testOnly === true)) return { refreshed: false, error: 'offline' };
  try {
    const identity = readIdentity(cwd);
    if (!identity.root || !identity.valid || notGitHubOf(identity)) return { refreshed: false, error: 'not-applicable' };
    const outcome = bindingCache.refreshBindingCache(identity, userStateDirectory(options), { runGit, timeout, deadline, now, environment });
    return { refreshed: outcome.refreshed, error: outcome.error };
  } catch (error) { return { refreshed: false, error: codeOf(error) }; }
}

module.exports = Object.freeze({
  SCHEMA,
  STATES,
  TRACKING_HOST,
  localRepositoryId,
  evidenceStoreRepositories,
  enabledRepositories,
  evidenceStoreOf,
  GOVERNED_BLOCK,
  LEGACY_GOVERNED_BLOCK,
  BINDING_FILE: BINDING_FILE.join('/'),
  BINDING_SCHEMA,
  GovernanceState,
  GovernanceStateError,
  governanceState,
  refreshMergedBinding,
  judgeMerged,
  mergedBinding,
  governanceCommand,
  isGitHubHost: trackingHost,
  readIdentity,
  readMaterials,
  readGovernedBlock,
  bindingStoreRepository,
  workingBindingStoreRepository,
  bindingRequiredChecks,
  workingBindingRequiredChecks,
  taskAutoMerge,
  committedBindingPolicy,
  workingBindingPolicy,
  userStateDirectory,
  bindingProblems,
  gitConfigValues,
  findGitRoot,
  remoteSlug,
});
