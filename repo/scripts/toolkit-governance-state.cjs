'use strict';

// The one answer to "which Toolkit governance state applies in this working directory?".
// Every hook, setup step, conformance check and catalogue call asks this module, and nothing else
// reads the inputs it combines:
//
//   identity   the origin-remote repository identity (toolkit.repository-identity.v1), read
//              from the repository's own git config file, never from the path;
//   materials  the governed block in the git root's AGENTS.md (B) and a valid programme binding
//              `.github/toolkit-programme.json` (P);
//   registry   the user's own decision for that identity in
//              ~/.ai-agent-toolkit/user-state/repository-governance.v1.json (U), stored and
//              written only by toolkit-capability-registry.cjs;
//   ok         the user's ok that GitHub governance is off in a git repository that is not on
//              github.com (K), in governance-not-github.v1.json next to the registry, written only
//              by the hook gate from the user's own reply.
//
// GitHub governance (programme records, decision traces, evidence custody, the governed block)
// works only for github.com repositories. States, first matching rule wins:
//   R1 no git root                                  DISABLED       automatically, never held; the folder gets a copy
//   R2 U declined or disabled                       DISABLED       global rules only; a governed block is ignored
//   R8 not GitHub (no usable origin, or another host), K present
//                                                   DISABLED       the user said ok; nothing to enable here
//   R9 not GitHub, K absent                         UNDECIDED      held until the user says ok
//   R3 U enabled, B and P present                   ENABLED        global rules plus the governed block
//   R4 U not recorded, B and P present              ENABLED        as R3 (the repository opted in, the user did not disable it)
//   R5 U enabled, B or P missing                    ENABLED        materials incomplete: no GitHub governance yet
//   R6 U not recorded, B present, P absent          UNDECIDED      held until the one-time migration or the user answers
//   R7 anything else                                UNDECIDED      held until the user answers
// A read error after a git root is found gives UNDECIDED (rule ERROR): the state cannot be shown
// not to be UNDECIDED, so callers that hold must hold (fail closed). A folder with no git root is
// never held.
//
// Reads local files only: no network, no git or gh subprocess, no writes. Node built-ins plus the
// existing registry, managed-block, remote-identity and programme-binding modules.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const registry = require('./toolkit-capability-registry.cjs');
const managedBlock = require('./toolkit-managed-block.cjs');
const { validateRemoteIdentity } = require('./toolkit-control-plane/control-plane-kernel.cjs');
const programmeState = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');

const SCHEMA = 'toolkit.governance-state.v1';
// GitHub governance (the reconciler and its records) supports github.com. A host whose name
// mentions github (ssh.github.com, or an SSH alias such as github-work) is treated as GitHub too,
// since an alias cannot be resolved from the repository alone.
const TRACKING_HOST = 'github.com';
const trackingHost = host => /github/i.test(host);
const STATES = Object.freeze(['ENABLED', 'DISABLED', 'UNDECIDED']);
const NOT_GITHUB_BASENAME = 'governance-not-github.v1.json';
const NOT_GITHUB_SCHEMA = 'toolkit.governance-not-github.v1';
const NOT_GITHUB_READ_LIMIT = 256 * 1024;
// Folders that never get a copy: they hold the user's own things, not a project.
const PERSONAL_FOLDERS = Object.freeze(['desktop', 'documents', 'downloads']);
const GOVERNANCE_CAPABILITY = 'repository.governance';
const GOVERNED_BLOCK = 'TOOLKIT-GOVERNED-RULES';
const LEGACY_GOVERNED_BLOCK = 'GLOBAL-AGENTS.MD-TEMPLATE';
const GOVERNED_BLOCK_LINE = /^<!-- AI-AGENT-TOOLKIT:[^\r\n]*:BEGIN (TOOLKIT-GOVERNED-RULES|GLOBAL-AGENTS\.MD-TEMPLATE) v\d+(?: [^\r\n]*)? -->\r?$/m;
const BINDING_FILE = Object.freeze(['.github', 'toolkit-programme.json']);
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
// repo/contracts/programme-state/binding-v1.schema.json), plus the rule that the binding agrees
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
  return { present: true, valid: problems.length === 0, problems, store_repository: problems.length === 0 ? parsed.store.repository : null };
}

// The evidence store a valid binding names ("owner/name"), or null. Kept out of the state result,
// which never carries repository names.
function bindingStoreRepository(root) {
  try {
    const binding = readBinding(root, readIdentity(root));
    return binding.valid ? binding.store_repository : null;
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

// The folder a plain (non-git) working directory records its DISABLED copy in, or null where no copy
// belongs: a drive or filesystem root, the user's home folder or anything above it, Toolkit's own
// state folder, the system temporary folder itself, and the Desktop, Documents and Downloads folders
// themselves.
function recordFolderFor(cwd, options = {}) {
  const folder = path.resolve(typeof cwd === 'string' && cwd ? cwd : process.cwd());
  let home;
  try { home = path.dirname(path.dirname(path.dirname(registryPathFor(options)))); } catch { return null; }
  const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
  const within = (child, parent) => { const rel = path.relative(parent, child); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };
  if (path.parse(folder).root === folder) return null;
  if (within(home, folder)) return null;
  if (within(folder, path.join(home, '.ai-agent-toolkit'))) return null;
  if (same(folder, path.resolve(os.tmpdir()))) return null;
  const parent = path.dirname(folder);
  if (PERSONAL_FOLDERS.includes(path.basename(folder).toLowerCase()) && (same(parent, home) || /^onedrive/i.test(path.basename(parent)))) return null;
  return folder;
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
    hold: state === 'UNDECIDED',
    persistable: fields.persistable === true,
    materials_complete: state === 'ENABLED' ? complete : null,
    governed_rules_bind: complete,
    programme_records_bind: complete,
    recorded_decision: fields.recorded_decision || null,
    recorded_under_legacy_key: fields.legacy_key === true,
    repository_id: fields.repository_id || null,
    root: fields.root || null,
    materials: fields.materials ? Object.freeze({
      governed_block: fields.materials.governed_block.present === true,
      governed_block_legacy: fields.materials.governed_block.legacy === true,
      binding: fields.materials.binding.valid === true,
      binding_present: fields.materials.binding.present === true,
      binding_problems: Object.freeze([...(fields.materials.binding.problems || [])]),
      legacy_binding_file: fields.materials.legacy_binding_file === true,
    }) : null,
    error_code: fields.error_code || null,
    host: fields.host || null,
    folder: fields.folder || null,
  });
}

class GovernanceState {
  #readIdentity; #readMaterials; #readDecision; #readOk; #recordFolder;

  // Readers are injectable so the derivation can be tested on its own; the defaults read the
  // real repository and the real user-state files.
  constructor({ identityReader = readIdentity, materialsReader = readMaterials, decisionReader = readDecision, okReader = readNotGitHubOk, registryOptions = {} } = {}) {
    this.#readIdentity = identityReader;
    this.#readMaterials = materialsReader;
    this.#readDecision = (identity) => decisionReader(identity.repository_id, registryOptions, identity.legacy_repository_ids || []);
    this.#readOk = key => okReader(key, registryOptions);
    this.#recordFolder = cwd => recordFolderFor(cwd, registryOptions);
  }

  // The pure rule table over already-read inputs. `ok` is whether the user said ok to GitHub
  // governance being off (read only for a repository that is not on GitHub).
  static derive({ identity, materials, decision, ok = false }) {
    const base = { root: identity.root, repository_id: identity.repository_id, persistable: true, recorded_decision: decision.state, legacy_key: decision.legacy_key === true, materials };
    const block = materials.governed_block.present === true;
    const binding = materials.binding.valid === true;
    if (decision.state === 'disabled') return result({ ...base, state: 'DISABLED', rule: 'R2', reason: decision.decision_kind === 'disable' ? 'user-disabled' : 'user-declined' });
    const notGitHub = notGitHubOf(identity);
    if (notGitHub) {
      const fields = { ...base, host: notGitHub.host, reason: notGitHub.reason };
      return ok ? result({ ...fields, state: 'DISABLED', rule: 'R8' }) : result({ ...fields, state: 'UNDECIDED', rule: 'R9' });
    }
    if (block && binding) {
      return decision.state === 'enabled'
        ? result({ ...base, state: 'ENABLED', rule: 'R3', reason: 'user-enabled', materials_complete: true })
        : result({ ...base, state: 'ENABLED', rule: 'R4', reason: 'repository-opt-in', materials_complete: true });
    }
    if (decision.state === 'enabled') return result({ ...base, state: 'ENABLED', rule: 'R5', reason: block ? 'binding-missing' : 'governed-block-missing', materials_complete: false });
    if (block) return result({ ...base, state: 'UNDECIDED', rule: 'R6', reason: 'governed-block-without-binding' });
    return result({ ...base, state: 'UNDECIDED', rule: 'R7', reason: 'no-decision' });
  }

  evaluate(cwd) {
    let identity;
    try {
      identity = this.#readIdentity(cwd);
    } catch (error) {
      // A git root exists (identity reading only throws after finding one) but its config could
      // not be read: the state cannot be shown not to be UNDECIDED.
      return result({ state: 'UNDECIDED', rule: 'ERROR', reason: 'identity-unreadable', error_code: codeOf(error), root: findGitRootQuietly(cwd) });
    }
    if (!identity.root) {
      const folder = this.#recordFolder(cwd);
      return result({ state: 'DISABLED', rule: 'R1', reason: 'no-git', folder, repository_id: folder ? localRepositoryId(folder) : null });
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
    return GovernanceState.derive({ identity, materials, decision, ok });
  }
}

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

module.exports = Object.freeze({
  SCHEMA,
  STATES,
  TRACKING_HOST,
  NOT_GITHUB_BASENAME,
  NOT_GITHUB_SCHEMA,
  localRepositoryId,
  readNotGitHubOk,
  recordFolderFor,
  GOVERNANCE_CAPABILITY,
  GOVERNED_BLOCK,
  LEGACY_GOVERNED_BLOCK,
  BINDING_FILE: BINDING_FILE.join('/'),
  BINDING_SCHEMA,
  GovernanceState,
  GovernanceStateError,
  governanceState,
  governanceCommand,
  readIdentity,
  readMaterials,
  readGovernedBlock,
  bindingStoreRepository,
  readDecision,
  registryPathFor,
  bindingProblems,
  gitConfigValues,
  findGitRoot,
  remoteSlug,
});
