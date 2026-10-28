'use strict';

// The programme binding as merged on the repository's default branch, which is what decides
// Toolkit's GitHub governance on every computer. A working tree, another branch or a fork's copy
// never does.
//
//   refresh   asks the origin remote for its default branch (`git ls-remote --symref origin HEAD`),
//             fetches that one branch (bounded), reads `.github/toolkit-programme.json` at its tip
//             and writes the result to this computer's cache. Only `toolkit governance status`
//             and the session-start hook refresh.
//   read      returns the cached result for one repository identity, or null. Every other caller,
//             every hook on every tool call included, reads only the cache: no network per tool use.
//
// The cache lives next to the user's governance decisions, in
// ~/.ai-agent-toolkit/user-state/governance-binding-cache/, one file per repository identity, so the
// hook gate's refusal of agent edits to user-state files covers it too. A cache entry names the
// identity it was read for; an entry for another identity is ignored. A damaged entry reads as no
// entry (governed effects then hold until the next refresh), never as a binding.
//
// No model calls, no gh, no writes outside the cache (the fetch updates only the remote-tracking
// ref of the default branch, and a lock that fetch left when its timeout stopped it is removed).

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { validateRemoteIdentity, repositoryIdForCanonicalRemote } = require('./toolkit-capability-registry.cjs');

const CACHE_SCHEMA = 'toolkit.governance-binding-cache.v1';
const CACHE_DIR = 'governance-binding-cache';
const BINDING_PATH = '.github/toolkit-programme.json';
const BINDING_READ_LIMIT = 64 * 1024;
const CACHE_READ_LIMIT = 256 * 1024;
const GIT_TIMEOUT_MS = 5000;
// Gate admission, finality and governed writes need a read no older than this.
const FRESH_MS = 24 * 60 * 60 * 1000;
const BRANCH = /^[A-Za-z0-9._\/-]{1,200}$/;
const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
// Settings in the repository's own config that change where or how git fetches without changing the
// URL --get-url reports: a transport command (core.sshCommand, core.gitProxy, the origin's
// uploadpack, vcs or proxy) or an HTTP proxy, TLS or name-resolution override. git lowercases section
// and key names; an http.<url>.* subsection keeps its case, so the URL part matches anything.
const TRANSPORT_OVERRIDES = '^(core\\.sshcommand|core\\.gitproxy|remote\\.origin\\.(uploadpack|vcs|proxy)|http\\..*(proxy|sslverify|curloptresolve))$';
// The repository's own config, and command-scope config (git -c, GIT_CONFIG_COUNT/KEY/VALUE,
// GIT_CONFIG_PARAMETERS) that whoever runs the refresh can set. The user's global and system config
// are not held here.
const HELD_SCOPES = Object.freeze(['local', 'worktree', 'command']);
// Environment that changes the config for every git call of the refresh, and, for an ssh origin only,
// the ssh command (GIT_SSH and GIT_SSH_COMMAND do nothing for https, and Plink or TortoiseGit setups
// set them for good). The rest of the user's environment is trusted.
const HELD_CONFIG_ENVIRONMENT = Object.freeze(['GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT']);
const HELD_SSH_ENVIRONMENT = Object.freeze(['GIT_SSH', 'GIT_SSH_COMMAND']);
const NO_HOOKS_DIR = 'no-hooks';

// A branch name git would accept, kept to plain characters: no empty, dot-led or .lock part.
function validBranch(name) {
  return typeof name === 'string' && BRANCH.test(name) && !name.split('/').some(part => part === '' || part.startsWith('.') || part.endsWith('.lock'));
}

function cacheDirFor(registryPath) {
  return path.join(path.dirname(registryPath), CACHE_DIR);
}

function cacheFileFor(registryPath, repositoryId) {
  const name = crypto.createHash('sha256').update(String(repositoryId)).digest('hex').slice(0, 32);
  return path.join(cacheDirFor(registryPath), `${name}.json`);
}

function defaultRunGit(args, { cwd, timeout }) {
  const run = spawnSync('git', args, {
    cwd, timeout, windowsHide: true, maxBuffer: 1024 * 1024,
    // Replace refs would make rev-parse, ls-tree and cat-file read other objects than the fetched ones.
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_ASKPASS: '', SSH_ASKPASS: '', GIT_NO_REPLACE_OBJECTS: '1' },
  });
  return { status: run.error ? null : run.status, stdout: run.stdout || Buffer.alloc(0), stderr: run.stderr || Buffer.alloc(0) };
}

// The remote's default branch name, from `ref: refs/heads/<name>\tHEAD`.
function parseSymref(text) {
  const match = /^ref: refs\/heads\/(\S+)\tHEAD$/m.exec(String(text));
  if (!match || !validBranch(match[1])) return null;
  return match[1];
}

// Reads the default-branch binding through git. { status: 'present', default_branch, commit, text }
// or { status: 'absent', default_branch, commit } or { status: 'unknown', error } when the remote,
// the fetch or the read failed (offline included). Never throws.
//
// `expectedRemote` is the canonical origin the identity was read from (the literal
// remote.origin.url). git's own origin also follows url.<x>.insteadOf, [include] files and
// config.worktree, so the URL git will actually use is checked first, and neither the repository's
// own config nor command-scope config may carry a transport override (TRANSPORT_OVERRIDES) that would
// fetch from somewhere else behind the same URL, nor may the environment (HELD_CONFIG_ENVIRONMENT, and HELD_SSH_ENVIRONMENT for an ssh origin): any of
// these is held as 'remote-redirected' and nothing is fetched (A1). The fetch runs with hooks pointed
// at `hooksDir`, an empty folder the refresh owns, so no repository hook can move the tracking ref,
// and the ref must then be the commit the remote itself reported.
function readDefaultBranchBinding(root, { runGit = defaultRunGit, timeout = GIT_TIMEOUT_MS, expectedRemote = null, hooksDir = null, environment = process.env } = {}) {
  const git = args => {
    try { return runGit(args, { cwd: root, timeout }); } catch { return { status: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }; }
  };
  const set = name => typeof environment[name] === 'string' && environment[name] !== '' && !(name === 'GIT_CONFIG_COUNT' && environment[name] === '0');
  if (HELD_CONFIG_ENVIRONMENT.some(set)) return { status: 'unknown', error: 'remote-redirected' };
  if (!emptyFolder(hooksDir)) return { status: 'unknown', error: 'hooks-unguarded' };
  const effective = git(['ls-remote', '--get-url', 'origin']);
  if (effective.status !== 0) return { status: 'unknown', error: 'remote-unreachable' };
  const resolved = validateRemoteIdentity(effective.stdout.toString('utf8').trim());
  // The same repository spelt another way (https, ssh, with or without .git) is the same origin.
  if (!expectedRemote || !resolved.valid || repositoryIdForCanonicalRemote(resolved.canonical) !== repositoryIdForCanonicalRemote(expectedRemote)) return { status: 'unknown', error: 'remote-redirected' };
  if (/^(?:ssh|scp):\/\//.test(resolved.canonical) && HELD_SSH_ENVIRONMENT.some(set)) return { status: 'unknown', error: 'remote-redirected' };
  // Exit 1 is "no such setting"; anything else that is not a clean 0 cannot be shown safe.
  const overrides = git(['config', '--show-scope', '--get-regexp', TRANSPORT_OVERRIDES]);
  if (overrides.status !== 0 && overrides.status !== 1) return { status: 'unknown', error: 'remote-redirected' };
  if (overrides.status === 0 && overrides.stdout.toString('utf8').split(/\r?\n/).some(line => HELD_SCOPES.includes(line.split('\t')[0]))) return { status: 'unknown', error: 'remote-redirected' };
  const symref = git(['ls-remote', '--symref', 'origin', 'HEAD']);
  if (symref.status !== 0) return { status: 'unknown', error: 'remote-unreachable' };
  const branch = parseSymref(symref.stdout.toString('utf8'));
  if (!branch) return { status: 'unknown', error: 'default-branch-unknown' };
  const advertised = /^([0-9a-f]{40}(?:[0-9a-f]{24})?)\tHEAD$/m.exec(symref.stdout.toString('utf8'));
  if (!advertised) return { status: 'unknown', error: 'default-branch-unknown' };
  const tracking = `refs/remotes/origin/${branch}`;
  const started = Date.now();
  const fetched = git(['-c', `core.hooksPath=${hooksDir}`, 'fetch', '--no-tags', '--no-recurse-submodules', 'origin', `+refs/heads/${branch}:${tracking}`]);
  if (fetched.status === null) removeKilledFetchLock(git, root, tracking, started);
  if (fetched.status !== 0) return { status: 'unknown', error: 'fetch-failed' };
  const head = git(['rev-parse', '--verify', '--quiet', `${tracking}^{commit}`]);
  const commit = head.status === 0 ? head.stdout.toString('utf8').trim() : '';
  if (!SHA.test(commit)) return { status: 'unknown', error: 'commit-unreadable' };
  // The remote's HEAD moved between the two reads, or something rewrote the ref: read again later.
  if (commit !== advertised[1]) return { status: 'unknown', error: 'ref-moved' };
  const tree = git(['ls-tree', '-l', commit, '--', BINDING_PATH]);
  if (tree.status !== 0) return { status: 'unknown', error: 'tree-unreadable' };
  const line = tree.stdout.toString('utf8').trim();
  if (!line) return { status: 'absent', default_branch: branch, commit };
  const entry = /^100(?:644|755) blob ([0-9a-f]{40,64})\s+(\d+)\t/.exec(line);
  if (!entry) return { status: 'present', default_branch: branch, commit, text: null, problem: 'not a regular file' };
  if (Number(entry[2]) > BINDING_READ_LIMIT) return { status: 'present', default_branch: branch, commit, text: null, problem: 'too large' };
  const blob = git(['cat-file', 'blob', entry[1]]);
  if (blob.status !== 0) return { status: 'unknown', error: 'blob-unreadable' };
  return { status: 'present', default_branch: branch, commit, text: blob.stdout.toString('utf8') };
}

// Whether `folder` is an existing, empty, real folder.
function emptyFolder(folder) {
  try { return typeof folder === 'string' && path.isAbsolute(folder) && fs.lstatSync(folder).isDirectory() && fs.readdirSync(folder).length === 0; } catch { return false; }
}

// A fetch stopped by the timeout can leave the tracking ref's lock behind, which would make every
// later fetch of that branch fail. Only a lock written since this fetch started is removed: an older
// one belongs to someone else.
function removeKilledFetchLock(git, root, tracking, started) {
  try {
    const common = git(['rev-parse', '--git-common-dir']);
    if (common.status !== 0) return;
    const lock = path.join(path.resolve(root, common.stdout.toString('utf8').trim()), ...tracking.split('/')) + '.lock';
    const stat = fs.lstatSync(lock);
    if (stat.isFile() && stat.mtimeMs >= started - 1000) fs.rmSync(lock, { force: true });
  } catch { /* nothing to remove */ }
}

// Why a refresh kept the last read, in plain words for `status`, or null when there is nothing to say.
const REFRESH_REASONS = Object.freeze({
  'remote-redirected': 'git would fetch origin from somewhere else (a URL rewrite, or a transport, proxy or TLS override in this repository\'s git config, git -c or GIT_CONFIG_* variables, or GIT_SSH for an ssh origin), so the merged binding was not read',
  'remote-unreachable': 'GitHub could not be reached (offline?)',
  'fetch-failed': 'the default branch could not be fetched',
  'default-branch-unknown': 'the remote did not say which branch is its default',
  'ref-moved': 'the default branch moved while it was read; it is read again next time',
  'hooks-unguarded': 'Toolkit could not prepare its empty hooks folder, so it did not fetch',
  'commit-unreadable': 'the fetched commit could not be read',
  'tree-unreadable': 'the fetched commit could not be read',
  'blob-unreadable': 'the binding file could not be read',
  'cache-unwritable': 'this computer\'s cache of the read could not be written',
  offline: 'governance reads are switched off here (a test run or TOOLKIT_GOVERNANCE_OFFLINE=1)',
});
function refreshReason(error) { return Object.hasOwn(REFRESH_REASONS, error) ? REFRESH_REASONS[error] : null; }

// Atomic write of one cache entry; returns the entry. Throws on a write failure.
function writeCache(registryPath, entry) {
  const file = cacheFileFor(registryPath, entry.repository_id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  fs.renameSync(temp, file);
  return entry;
}

// Refreshes the cache for one identity (from toolkit-governance-state readIdentity). A failed read
// keeps the existing entry: offline narrows (see freshness), it never erases what was merged.
// Returns { refreshed, entry, error }.
function refreshBindingCache(identity, registryPath, { runGit, timeout, now = () => new Date(), environment = process.env } = {}) {
  if (!identity || !identity.valid || !identity.root || !identity.repository_id) return { refreshed: false, entry: null, error: 'identity-invalid' };
  const hooksDir = path.join(cacheDirFor(registryPath), NO_HOOKS_DIR);
  try { fs.mkdirSync(hooksDir, { recursive: true }); } catch { /* emptyFolder holds the read */ }
  const read = readDefaultBranchBinding(identity.root, { runGit, timeout, expectedRemote: identity.remote.canonical, hooksDir, environment });
  if (read.status === 'unknown') return { refreshed: false, entry: readBindingCache(identity, registryPath), error: read.error };
  const entry = {
    schema: CACHE_SCHEMA,
    repository_id: identity.repository_id,
    remote: identity.remote.canonical,
    default_branch: read.default_branch,
    commit: read.commit,
    fetched_at: now().toISOString(),
    status: read.status,
    bytes_sha256: typeof read.text === 'string' ? crypto.createHash('sha256').update(read.text, 'utf8').digest('hex') : null,
    text: typeof read.text === 'string' ? read.text : null,
    problem: read.problem || null,
  };
  try { writeCache(registryPath, entry); } catch { return { refreshed: false, entry: readBindingCache(identity, registryPath), error: 'cache-unwritable' }; }
  return { refreshed: true, entry, error: null };
}

// The cached entry for this identity, or null (none, damaged, or written for another identity).
function readBindingCache(identity, registryPath) {
  if (!identity || !identity.repository_id) return null;
  let parsed;
  try {
    const file = cacheFileFor(registryPath, identity.repository_id);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > CACHE_READ_LIMIT) return null;
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || parsed.schema !== CACHE_SCHEMA) return null;
  // Another spelling of the same origin (https or ssh) is the same repository.
  let remoteId = null;
  try { remoteId = typeof parsed.remote === 'string' ? repositoryIdForCanonicalRemote(parsed.remote) : null; } catch { remoteId = null; }
  if (parsed.repository_id !== identity.repository_id || !identity.remote || remoteId !== identity.repository_id) return null;
  if (!['present', 'absent'].includes(parsed.status) || !SHA.test(String(parsed.commit)) || !validBranch(parsed.default_branch)) return null;
  const fetched = Date.parse(parsed.fetched_at);
  if (!Number.isFinite(fetched)) return null;
  if (parsed.status === 'present') {
    if (parsed.text !== null && typeof parsed.text !== 'string') return null;
    if (typeof parsed.text === 'string' && crypto.createHash('sha256').update(parsed.text, 'utf8').digest('hex') !== parsed.bytes_sha256) return null;
  }
  return Object.freeze({ ...parsed });
}

// Whether a cache entry is fresh enough for gate admission, finality and governed writes.
function isFresh(entry, now = new Date()) {
  if (!entry) return false;
  const age = now.getTime() - Date.parse(entry.fetched_at);
  return age >= -5 * 60 * 1000 && age <= FRESH_MS;
}

module.exports = Object.freeze({
  CACHE_SCHEMA,
  CACHE_DIR,
  FRESH_MS,
  GIT_TIMEOUT_MS,
  BINDING_PATH,
  cacheDirFor,
  cacheFileFor,
  parseSymref,
  readDefaultBranchBinding,
  refreshBindingCache,
  readBindingCache,
  writeCache,
  isFresh,
  refreshReason,
  defaultRunGit,
});
