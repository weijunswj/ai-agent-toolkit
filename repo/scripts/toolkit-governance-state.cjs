'use strict';

// The one answer to "which Toolkit governance state applies in this working directory?".
// Every hook, setup step, conformance check and catalogue call asks this module, and nothing else
// reads the inputs it combines:
//
//   identity   the origin-remote repository identity (toolkit.repository-identity.v1), read
//              from the repository's own git config file, never from the path;
//   merged     the programme binding `.github/toolkit-programme.json` as merged on the origin's
//              default branch, from this computer's cache (toolkit-governance-binding.cjs). It is
//              the repository's own setting and decides on every computer;
//   materials  the governed block in the git root's AGENTS.md and the working tree's binding,
//              shown only (a working-tree binding is "pending: merge it"), never deciding;
//   registry   the user's own decision for that identity in
//              ~/.ai-agent-toolkit/user-state/repository-governance.v1.json (U), stored and
//              written only by toolkit-capability-registry.cjs. It decides only where nothing is
//              merged, and is never deleted or rewritten here;
//   ok         the user's ok that GitHub governance is off in a git repository that is not on
//              github.com (K), in governance-not-github.v1.json next to the registry, written only
//              by the hook gate from the user's own reply.
//
// GitHub governance (programme records, decision traces, evidence custody, the governed block)
// works only for github.com repositories. States, first matching rule wins:
//   R1 no git root                                  DISABLED       automatically, never held
//   not GitHub (no usable origin, or another host):
//     R2 U declined or disabled                     DISABLED
//     R8 K present                                  DISABLED       the user said ok; nothing to enable here
//     R9 K absent                                   UNDECIDED      held until the user says ok
//   github.com, by the merged binding:
//     M0 merged binding malformed or unknown schema ERROR          not held; governed effects hold (A2)
//     M2 merged v2 binding says disabled            DISABLED       only an owner-merged PR changes it (A3)
//     M1 merged binding enabled (v2, or v1)         ENABLED        on every computer; a local "no" is only a
//                                                                  suggestion preference
//   github.com, nothing merged for this repository (none, a fork's, or not read yet):
//     S1 an evidence store                          DISABLED       never held or asked: a merged binding in
//                                                                  this computer's cache names it as its store,
//                                                                  or it is named TRANSPORT-* under the owner of
//                                                                  such a binding's repository; U is ignored
//     R1s a scratch clone                           DISABLED       never held or asked: a clone of another
//                                                                  repository inside the ignored top-level .tmp/
//                                                                  folder of a repository that is ENABLED or
//                                                                  DISABLED; U is ignored
//     R2 U declined or disabled                    DISABLED       not asked again on this computer
//     R5 U enabled                                  ENABLED        not held; materials incomplete until the
//                                                                  setup PR with the binding merges
//     R7 U not recorded                             UNDECIDED      held until the owner's own reply
// ENABLED by M1 keeps routine work going on a stale or offline cache; gate admission, finality and
// governed writes (programme_records_bind) need a read of the merged binding no older than 24
// hours, else governed_effects_hold (A4). A read error after a git root is found gives UNDECIDED
// (rule ERROR): the state cannot be shown not to be UNDECIDED, so callers that hold must hold (fail
// closed). A folder with no git root is never held.
//
// Reads local files only: no network, no git or gh subprocess, no writes (refreshMergedBinding,
// called only by `status` and the session-start hook, is the one exception). Node built-ins
// plus the existing registry (with its remote-identity check), managed-block, binding-cache and
// programme-binding modules.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const registry = require('./toolkit-capability-registry.cjs');
const bindingCache = require('./toolkit-governance-binding.cjs');
const managedBlock = require('./toolkit-managed-block.cjs');
const { validateRemoteIdentity } = registry;
const programmeState = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');

const SCHEMA = 'toolkit.governance-state.v1';
// GitHub governance (the reconciler and its records) supports github.com: github.com itself, its
// subdomains (ssh.github.com), and an SSH alias with no dot whose name mentions github (github-work),
// since an alias cannot be resolved from the repository alone. Any other dotted host, a GitHub
// Enterprise server included, is not github.com. The reconciler uses the same test.
const TRACKING_HOST = 'github.com';
const trackingHost = programmeState.isGitHubHost;
const STATES = Object.freeze(['ENABLED', 'DISABLED', 'UNDECIDED', 'ERROR']);
const NOT_GITHUB_BASENAME = 'governance-not-github.v1.json';
const NOT_GITHUB_SCHEMA = 'toolkit.governance-not-github.v1';
const NOT_GITHUB_READ_LIMIT = 256 * 1024;
const GOVERNANCE_CAPABILITY = 'repository.governance';
const GOVERNED_BLOCK = 'TOOLKIT-GOVERNED-RULES';
const LEGACY_GOVERNED_BLOCK = 'GLOBAL-AGENTS.MD-TEMPLATE';
const GOVERNED_BLOCK_LINE = /^<!-- AI-AGENT-TOOLKIT:[^\r\n]*:BEGIN (TOOLKIT-GOVERNED-RULES|GLOBAL-AGENTS\.MD-TEMPLATE) v\d+(?: [^\r\n]*)? -->\r?$/m;
const BINDING_FILE = Object.freeze(['.github', 'toolkit-programme.json']);
// The version 1 schema name; a v1 binding reads as enabled with one parent.
const BINDING_SCHEMA = 'toolkit.programme-binding.v1';
// An early name for the binding; reported for the owner, never read or rewritten.
const LEGACY_BINDING_FILE = Object.freeze(['.github', 'ai-agent-toolkit-programme.json']);
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
  return {
    root, valid: true, reason: null, remote,
    repository_id: registry.repositoryIdForCanonicalRemote(remote.canonical),
    legacy_repository_ids: registry.legacyRepositoryIdsForCanonicalRemote(remote.canonical),
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
    const judged = judgeMerged(bindingCache.readBindingCache(identity, registryPathFor(options)), identity, new Date());
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
// 'unresolved' (nothing recorded), with its decision kind. Keys earlier versions stored for the
// same repository count when the repository's own key has no entry and they agree. A missing
// file is 'unresolved'; a file that cannot be read or does not validate throws.
function readDecision(repositoryId, options = {}, legacyIds = []) {
  const bytes = readSmallFile(registryPathFor(options), registry.MAX_REGISTRY_BYTES, 'REGISTRY_TOO_LARGE');
  if (!bytes) return { state: 'unresolved', decision_kind: null };
  let parsed;
  try { parsed = registry.parseRegistryBytes(bytes); } catch (error) { fail(/^[A-Z][A-Z0-9_]{1,63}$/.test(error && error.code) ? error.code : 'REGISTRY_MALFORMED'); }
  const entry = registry.readCapabilityMap(parsed, repositoryId, legacyIds)[GOVERNANCE_CAPABILITY];
  const own = registry.readCapabilityMap(parsed, repositoryId, [])[GOVERNANCE_CAPABILITY];
  return { state: entry.state, decision_kind: entry.decision_kind, legacy_key: entry.state !== 'unresolved' && own.state === 'unresolved' };
}

// The key a git repository without a usable origin is known by on this computer: its real path.
function localRepositoryId(root) {
  let real = root;
  try { real = fs.realpathSync.native(root); } catch { real = path.resolve(root); }
  return `path:${crypto.createHash('sha256').update(process.platform === 'win32' ? real.toLowerCase() : real).digest('hex')}`;
}

// Whether the user said ok to GitHub governance being off for this key. A missing, unreadable or
// damaged file counts as no ok: the repository stays held and asks again, which is safe.
function readNotGitHubOk(key, options = {}) {
  let parsed = null;
  try {
    const file = path.join(path.dirname(registryPathFor(options)), NOT_GITHUB_BASENAME);
    const stat = fs.lstatSync(file);
    if (stat.isFile() && stat.size <= NOT_GITHUB_READ_LIMIT) parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error && error.code === 'REGISTRY_PATH_OVERRIDE_FORBIDDEN') throw error;
    parsed = null;
  }
  const entries = parsed && parsed.schema === NOT_GITHUB_SCHEMA && parsed.repositories && typeof parsed.repositories === 'object' && !Array.isArray(parsed.repositories) ? parsed.repositories : {};
  return Object.hasOwn(entries, key) && entries[key] !== null && typeof entries[key] === 'object';
}

// ---- evidence stores and scratch clones -------------------------------------------------------

// An evidence store by name: `TRANSPORT-<name>`, as the attribution guard and merge hold read it.
const STORE_NAME = /^transport-[\w.-]+$/i;
const SCRATCH_FOLDER = '.tmp';
const SCRATCH_IGNORE_LINES = Object.freeze(['.tmp', '.tmp/', '/.tmp', '/.tmp/']);
const GITIGNORE_READ_LIMIT = 1024 * 1024;
const storeScans = new Map();

// The evidence stores this computer's merged bindings name: { stores, owners }, lowercase sets of
// "owner/name" store repositories and of the owners of the repositories whose bindings name them.
// Only valid, enabled bindings with a github store count, and a damaged cache file is skipped.
// Read once per process for each state of the cache folder.
function evidenceStoreRepositories(options = {}, now = new Date()) {
  const registryPath = registryPathFor(options);
  let stamp = 'none';
  try { stamp = String(fs.statSync(bindingCache.cacheDirFor(registryPath)).mtimeMs); } catch { stamp = 'none'; }
  const known = storeScans.get(registryPath);
  if (known && known.stamp === stamp) return known.scan;
  const stores = new Set();
  const owners = new Set();
  for (const { identity, entry } of bindingCache.readAllBindingCaches(registryPath)) {
    const judged = judgeMerged(entry, identity, now);
    if (judged.status !== 'enabled' || !judged.binding.store || judged.binding.store.kind !== 'github') continue;
    stores.add(judged.binding.store.repository.toLowerCase());
    owners.add(judged.binding.repository.split('/')[0].toLowerCase());
  }
  const scan = Object.freeze({ stores, owners });
  storeScans.set(registryPath, { stamp, scan });
  return scan;
}

// 'evidence-store' when a cached binding names this repository as its evidence store,
// 'evidence-store-by-name' for a `TRANSPORT-*` repository under the owner of a cached binding's
// repository, else null.
function evidenceStoreOf(identity, scan) {
  const slug = remoteSlug(identity && identity.remote);
  if (!slug || !scan) return null;
  const lower = slug.toLowerCase();
  if (scan.stores.has(lower)) return 'evidence-store';
  const [owner, name] = lower.split('/');
  return STORE_NAME.test(name) && scan.owners.has(owner) ? 'evidence-store-by-name' : null;
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
  const effectsHold = state === 'ERROR' || (complete && fields.merged_fresh !== true);
  return Object.freeze({
    schema: SCHEMA,
    state,
    rule: fields.rule,
    reason: fields.reason,
    hold: state === 'UNDECIDED',
    persistable: fields.persistable === true,
    materials_complete: state === 'ENABLED' ? complete : null,
    governed_rules_bind: complete,
    // Gate admission, finality and governed writes (programme records): only on a fresh read of
    // the merged binding (A4). Routine work follows governed_rules_bind.
    programme_records_bind: complete && !effectsHold,
    governed_effects_hold: effectsHold,
    recorded_decision: fields.recorded_decision || null,
    recorded_under_legacy_key: fields.legacy_key === true,
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
  });
}

// What the cached default-branch binding says: { status: 'none' | 'unknown' | 'invalid' | 'foreign'
// | 'enabled' | 'disabled', version, problems, foreign_repository, commit, fetched_at, fresh }.
function judgeMerged(entry, identity, now) {
  if (!entry) return { status: 'unknown', fresh: false };
  const base = { commit: entry.commit, fetched_at: entry.fetched_at, fresh: bindingCache.isFresh(entry, now) };
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
  #readIdentity; #readMaterials; #readDecision; #readOk; #readMerged; #readStores; #now;

  // Readers are injectable so the derivation can be tested on its own; the defaults read the
  // real repository, the real user-state files and this computer's cache of the merged binding.
  constructor({ identityReader = readIdentity, materialsReader = readMaterials, decisionReader = readDecision, okReader = readNotGitHubOk, mergedReader = null, storeReader = null, registryOptions = {}, now = () => new Date() } = {}) {
    this.#readIdentity = identityReader;
    this.#readMaterials = materialsReader;
    this.#readDecision = (identity) => decisionReader(identity.repository_id, registryOptions, identity.legacy_repository_ids || []);
    this.#readOk = key => okReader(key, registryOptions);
    this.#readMerged = mergedReader || (identity => bindingCache.readBindingCache(identity, registryPathFor(registryOptions)));
    this.#readStores = storeReader || (() => evidenceStoreRepositories(registryOptions, now()));
    this.#now = now;
  }

  // The pure rule table over already-read inputs. `ok` is whether the user said ok to GitHub
  // governance being off (read only for a repository that is not on GitHub); `merged` is
  // judgeMerged's view of the default-branch binding (read only for a github.com repository).
  // `store` is evidenceStoreOf's answer and `scratch` whether the repository is a clone of another
  // repository in a decided repository's ignored `.tmp/` folder (both read only for github.com).
  static derive({ identity, materials, decision, ok = false, merged = { status: 'unknown', fresh: false }, store = null, scratch = false }) {
    const base = { root: identity.root, repository_id: identity.repository_id, persistable: true, recorded_decision: decision.state, legacy_key: decision.legacy_key === true, materials };
    const notGitHub = notGitHubOf(identity);
    if (notGitHub) {
      if (decision.state === 'disabled') return result({ ...base, state: 'DISABLED', rule: 'R2', reason: decision.decision_kind === 'disable' ? 'user-disabled' : 'user-declined' });
      const fields = { ...base, host: notGitHub.host, reason: notGitHub.reason };
      return ok ? result({ ...fields, state: 'DISABLED', rule: 'R8' }) : result({ ...fields, state: 'UNDECIDED', rule: 'R9' });
    }
    const view = { status: merged.status, version: merged.version || null, commit: merged.commit || null, fetched_at: merged.fetched_at || null, fresh: merged.fresh === true, foreign_repository: merged.foreign_repository || null, problems: merged.problems || [] };
    const withMerged = { ...base, merged: view, merged_fresh: view.fresh };
    // The repository's merged binding decides, on every computer (A1, A3).
    if (merged.status === 'invalid') return result({ ...withMerged, state: 'ERROR', rule: 'M0', reason: 'merged-binding-invalid' });
    if (merged.status === 'disabled') return result({ ...withMerged, state: 'DISABLED', rule: 'M2', reason: 'repository-disabled' });
    if (merged.status === 'enabled') {
      const notes = [];
      if (decision.state === 'disabled') notes.push('local-no-is-preference');
      if (merged.version === 1) notes.push('binding-v2-migration-offered');
      if (!view.fresh) notes.push('merged-binding-stale');
      return result({ ...withMerged, state: 'ENABLED', rule: 'M1', reason: 'repository-enabled', materials_complete: true, merged_binding_valid: true, notes });
    }
    // An evidence store, or a scratch clone, is never governed and never asked; a decision recorded
    // for it decides nothing (a stored "enable" is shown so the owner can clear it).
    if (store || scratch) {
      const notes = decision.state === 'enabled' ? ['stored-decision-ignored'] : [];
      return store
        ? result({ ...withMerged, state: 'DISABLED', rule: 'S1', reason: store, notes })
        : result({ ...withMerged, state: 'DISABLED', rule: 'R1s', reason: 'scratch-clone', notes });
    }
    // No merged binding (none, a fork's, or nothing read yet): this computer's answer decides.
    const notes = [];
    if (merged.status === 'foreign') notes.push('binding-belongs-to-other-repository');
    if (merged.status === 'unknown') notes.push('merged-binding-unknown');
    if (materials.binding.present === true) notes.push('pending-binding-merge');
    if (decision.state === 'disabled') return result({ ...withMerged, state: 'DISABLED', rule: 'R2', reason: decision.decision_kind === 'disable' ? 'user-disabled' : 'user-declined', notes });
    if (decision.state === 'enabled') return result({ ...withMerged, state: 'ENABLED', rule: 'R5', reason: 'binding-not-merged', materials_complete: false, notes: [...notes, 'setup-pr-offered'] });
    return result({ ...withMerged, state: 'UNDECIDED', rule: 'R7', reason: 'no-decision', notes });
  }

  evaluate(cwd, depth = 0) {
    let identity;
    try {
      identity = this.#readIdentity(cwd);
    } catch (error) {
      // A git root exists (identity reading only throws after finding one) but its config could
      // not be read: the state cannot be shown not to be UNDECIDED.
      return result({ state: 'UNDECIDED', rule: 'ERROR', reason: 'identity-unreadable', error_code: codeOf(error), root: findGitRootQuietly(cwd) });
    }
    if (!identity.root) {
      return result({ state: 'DISABLED', rule: 'R1', reason: 'no-git', folder: path.resolve(typeof cwd === 'string' && cwd ? cwd : process.cwd()) });
    }
    if (!identity.valid) {
      // No usable origin: the repository is known on this computer by its path, and never by a remote.
      const local = { ...identity, repository_id: localRepositoryId(identity.root), legacy_repository_ids: [] };
      let ok;
      try { ok = this.#readOk(local.repository_id); } catch (error) {
        return result({ root: identity.root, repository_id: local.repository_id, state: 'UNDECIDED', rule: 'ERROR', reason: 'registry-unreadable', error_code: codeOf(error) });
      }
      return GovernanceState.derive({ identity: local, materials: EMPTY_MATERIALS, decision: { state: 'unresolved', decision_kind: null }, ok });
    }
    const partial = { root: identity.root, repository_id: identity.repository_id, persistable: true };
    let decision;
    let materials;
    let ok = false;
    try {
      decision = this.#readDecision(identity);
      if (notGitHubOf(identity)) ok = this.#readOk(identity.repository_id);
    } catch (error) {
      return result({ ...partial, state: 'UNDECIDED', rule: 'ERROR', reason: 'registry-unreadable', error_code: codeOf(error) });
    }
    try {
      materials = this.#readMaterials(identity.root, identity);
    } catch (error) {
      return result({ ...partial, state: 'UNDECIDED', rule: 'ERROR', reason: 'materials-unreadable', error_code: codeOf(error), recorded_decision: decision.state });
    }
    let merged = { status: 'unknown', fresh: false };
    let store = null;
    let scratch = false;
    if (!notGitHubOf(identity)) {
      let entry = null;
      try { entry = this.#readMerged(identity); } catch { entry = null; }
      merged = judgeMerged(entry, identity, this.#now());
      if (!['invalid', 'disabled', 'enabled'].includes(merged.status)) {
        try { store = evidenceStoreOf(identity, this.#readStores()); } catch { store = null; }
        if (!store) scratch = this.#scratchClone(identity, depth);
      }
    }
    return GovernanceState.derive({ identity, materials, decision, ok, merged, store, scratch });
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
// governance status` and the session-start hook only). Never throws; returns
// { refreshed, error }. Nothing to refresh outside a github.com repository.
// With TOOLKIT_GOVERNANCE_OFFLINE=1 (set for test runs), or for a test registry, nothing reads the
// network unless a git runner is passed in: the last read stays, so governed effects hold once it is
// over 24 hours old.
function refreshMergedBinding(cwd, options = {}, { runGit, timeout, now, environment = process.env } = {}) {
  if (!runGit && (environment.TOOLKIT_GOVERNANCE_OFFLINE === '1' || options.testOnly === true)) return { refreshed: false, error: 'offline' };
  try {
    const identity = readIdentity(cwd);
    if (!identity.root || !identity.valid || notGitHubOf(identity)) return { refreshed: false, error: 'not-applicable' };
    const outcome = bindingCache.refreshBindingCache(identity, registryPathFor(options), { runGit, timeout, now, environment });
    return { refreshed: outcome.refreshed, error: outcome.error };
  } catch (error) { return { refreshed: false, error: codeOf(error) }; }
}

// ---- repair -----------------------------------------------------------------------------------

// For a state held because the user's decisions file cannot be read: one sentence naming the file
// and the terminal repair. Empty otherwise.
function repairHint(state, options = {}) {
  if (!state || state.reason !== 'registry-unreadable') return '';
  let file;
  try { file = registryPathFor(options); } catch { return ''; }
  return `Your governance decisions file (${file}) could not be read. To start it afresh, run ${governanceCommand('repair')} in your own terminal: after you type yes it moves the file aside (kept next to it), and Toolkit asks about each repository again.`;
}

// Whether the decisions file needs the repair: { file, problem } with problem null when it reads
// (or is missing), else the error code.
function registryProblem(options = {}) {
  const file = registryPathFor(options);
  try {
    const bytes = readSmallFile(file, registry.MAX_REGISTRY_BYTES, 'REGISTRY_TOO_LARGE');
    if (bytes) registry.parseRegistryBytes(bytes);
    return { file, problem: null };
  } catch (error) {
    return { file, problem: codeOf(error) };
  }
}

// Moves an unreadable decisions file aside, next to the original, and reads back that the file is
// gone. Only the terminal command calls this, after the user typed yes. Returns the new path.
function moveRegistryAside(options = {}, now = () => new Date()) {
  const { file, problem } = registryProblem(options);
  if (!problem) fail('REGISTRY_READABLE');
  const aside = `${file}.damaged-${now().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(2).toString('hex')}`;
  try { fs.renameSync(file, aside); } catch { fail('REGISTRY_NOT_MOVED'); }
  if (fs.existsSync(file) || !fs.existsSync(aside)) fail('REGISTRY_NOT_MOVED');
  return aside;
}

module.exports = Object.freeze({
  SCHEMA,
  STATES,
  TRACKING_HOST,
  NOT_GITHUB_BASENAME,
  NOT_GITHUB_SCHEMA,
  localRepositoryId,
  readNotGitHubOk,
  evidenceStoreRepositories,
  evidenceStoreOf,
  GOVERNANCE_CAPABILITY,
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
  repairHint,
  registryProblem,
  moveRegistryAside,
  readIdentity,
  readMaterials,
  readGovernedBlock,
  bindingStoreRepository,
  workingBindingStoreRepository,
  bindingRequiredChecks,
  workingBindingRequiredChecks,
  committedBindingPolicy,
  workingBindingPolicy,
  readDecision,
  registryPathFor,
  bindingProblems,
  gitConfigValues,
  findGitRoot,
  remoteSlug,
});
