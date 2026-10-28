'use strict';

// The programme binding as merged on the repository's default branch, which is what decides
// Toolkit's GitHub governance on every computer. A working tree, another branch or a fork's copy
// never does.
//
//   refresh   asks the origin remote for its default branch (`git ls-remote --symref origin HEAD`),
//             fetches that one branch (bounded), reads `.github/toolkit-programme.json` at its tip
//             and writes the result to this computer's cache. Only setup, `toolkit governance
//             status` and the session-start hook refresh.
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
// ref of the default branch).

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

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
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_ASKPASS: '', SSH_ASKPASS: '' },
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
function readDefaultBranchBinding(root, { runGit = defaultRunGit, timeout = GIT_TIMEOUT_MS } = {}) {
  const git = args => {
    try { return runGit(args, { cwd: root, timeout }); } catch { return { status: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }; }
  };
  const symref = git(['ls-remote', '--symref', 'origin', 'HEAD']);
  if (symref.status !== 0) return { status: 'unknown', error: 'remote-unreachable' };
  const branch = parseSymref(symref.stdout.toString('utf8'));
  if (!branch) return { status: 'unknown', error: 'default-branch-unknown' };
  const tracking = `refs/remotes/origin/${branch}`;
  const fetched = git(['fetch', '--no-tags', '--no-recurse-submodules', 'origin', `+refs/heads/${branch}:${tracking}`]);
  if (fetched.status !== 0) return { status: 'unknown', error: 'fetch-failed' };
  const head = git(['rev-parse', '--verify', '--quiet', `${tracking}^{commit}`]);
  const commit = head.status === 0 ? head.stdout.toString('utf8').trim() : '';
  if (!SHA.test(commit)) return { status: 'unknown', error: 'commit-unreadable' };
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
function refreshBindingCache(identity, registryPath, { runGit, timeout, now = () => new Date() } = {}) {
  if (!identity || !identity.valid || !identity.root || !identity.repository_id) return { refreshed: false, entry: null, error: 'identity-invalid' };
  const read = readDefaultBranchBinding(identity.root, { runGit, timeout });
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
  if (parsed.repository_id !== identity.repository_id || !identity.remote || parsed.remote !== identity.remote.canonical) return null;
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
});
