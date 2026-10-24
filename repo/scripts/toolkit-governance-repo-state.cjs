'use strict';

// The governance state a repository, or a plain folder Toolkit works in, carries in its own working
// tree (owner rules of 23 and 24 Oct: the state is created in every folder Toolkit touches). The
// file is `.ai-agent-toolkit/governance.json` at the git root, or in the plain folder itself. It is a required copy, never the authority:
// the decision itself stays in the user's registry (keyed by repository identity, with receipts),
// so every clone and worktree shares one answer. A file the registry does not back counts for
// nothing, which means repository content, a copied file or an agent's write can never grant
// consent. The hook gate rewrites a missing or disagreeing file from the registry; a write that
// fails never holds the repository, because the registry decision is the authority.
//
// The folder keeps itself out of git with a `.gitignore` inside it that ignores everything, so
// Toolkit never edits a tracked file such as the repository's root `.gitignore`. No git
// subprocess, no network.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const FOLDER = '.ai-agent-toolkit';
const FILE = 'governance.json';
const SCHEMA = 'toolkit.repository-governance.v1';
const INNER_IGNORE = '# Toolkit keeps this folder out of git.\n*\n';
const MAX_BYTES = 64 * 1024;
const MAX_HISTORY = 50;
// The bases a recorded state can have; 'repository opt-in' is read only from copies earlier versions
// wrote (the governed block and binding no longer decide anything on their own), 'no git' is rule R1 (a plain folder, DISABLED
// automatically) and 'not on github.com' is rule R8 (the user said ok to GitHub governance being off).
const BASES = Object.freeze({ decision: 'your decision', optIn: 'repository opt-in', noGit: 'no git', notGitHub: 'not on github.com' });
const BASIS_BY_RULE = Object.freeze({ R1: BASES.noGit, R8: BASES.notGitHub });
// Earlier copies wrote DECLINED for what is now DISABLED. Such a file is read, never agrees, and is
// rewritten as DISABLED with its history carried on.
const LEGACY_STATES = Object.freeze({ DECLINED: 'DISABLED' });

class RepoGovernanceFileError extends Error {
  constructor(code) {
    super(code);
    this.name = 'RepoGovernanceFileError';
    this.code = code;
  }
}

function fail(code) { throw new RepoGovernanceFileError(code); }

function filePath(root) { return path.join(root, FOLDER, FILE); }

// Where the copy lives: the git root, or for a plain folder the folder the state module allows (none
// at a root, the home folder or the personal folders).
function recordRoot(state) { return state ? state.root || state.folder || null : null; }

// What the file must say for a decided state; null when nothing may be recorded (UNDECIDED, or a
// folder that gets no copy).
function expectedRecord(state) {
  if (!state || !state.repository_id || !recordRoot(state) || !['ENABLED', 'DISABLED'].includes(state.state)) return null;
  return { repository_id: state.repository_id, state: state.state, basis: BASIS_BY_RULE[state.rule] || BASES.decision };
}

// 'directory', 'missing' or 'other' (a file, symlink or junction where the folder belongs).
function folderStatus(root) {
  let stat;
  try { stat = fs.lstatSync(path.join(root, FOLDER)); } catch (error) {
    if (error && error.code === 'ENOENT') return 'missing';
    fail('REPO_STATE_UNREADABLE');
  }
  return stat.isDirectory() && !stat.isSymbolicLink() ? 'directory' : 'other';
}

function readRecord(root) {
  const folder = folderStatus(root);
  if (folder === 'missing') return { status: 'missing', record: null };
  if (folder !== 'directory') return { status: 'invalid', record: null };
  const target = filePath(root);
  let stat;
  try { stat = fs.lstatSync(target); } catch (error) {
    if (error && error.code === 'ENOENT') return { status: 'missing', record: null };
    fail('REPO_STATE_UNREADABLE');
  }
  if (!stat.isFile()) return { status: 'invalid', record: null };
  if (stat.size > MAX_BYTES) return { status: 'invalid', record: null };
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(target, 'utf8')); } catch { return { status: 'invalid', record: null }; }
  if (!parsed || typeof parsed !== 'object' || parsed.schema !== SCHEMA
    || typeof parsed.repository_id !== 'string' || !['ENABLED', 'DISABLED', ...Object.keys(LEGACY_STATES)].includes(parsed.state)
    || !Object.values(BASES).includes(parsed.basis) || !Array.isArray(parsed.history)) return { status: 'invalid', record: null };
  return { status: 'present', record: parsed };
}

function agrees(record, expected) {
  return Boolean(record && expected && record.repository_id === expected.repository_id
    && record.state === expected.state && record.basis === expected.basis);
}

function writeAtomically(target, text) {
  const temp = `${target}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  try {
    fs.writeFileSync(temp, text, { mode: 0o600 });
    fs.renameSync(temp, target);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

// The folder and its own ignore-everything `.gitignore`, rewritten only when it differs. The folder
// must be a real directory: a symlink or junction in its place is never followed, so Toolkit cannot
// write into another directory through it.
function ensureIgnored(root) {
  const folder = path.join(root, FOLDER);
  if (folderStatus(root) === 'missing') fs.mkdirSync(folder);
  if (folderStatus(root) !== 'directory') fail('REPO_STATE_FOLDER_NOT_A_DIRECTORY');
  const inner = path.join(folder, '.gitignore');
  let innerText = null;
  try { innerText = fs.readFileSync(inner, 'utf8'); } catch { innerText = null; }
  if (innerText !== INNER_IGNORE) writeAtomically(inner, INNER_IGNORE);
}

// Makes the repository's file match the decided state. Returns { written }. Throws when it cannot;
// the gate reports that and carries on.
function syncRecord(state, { now = () => new Date() } = {}) {
  const expected = expectedRecord(state);
  if (!expected) fail('NOTHING_TO_RECORD');
  const root = recordRoot(state);
  const current = readRecord(root);
  ensureIgnored(root);
  if (current.status === 'present' && agrees(current.record, expected)) return Object.freeze({ written: false });
  const at = now().toISOString();
  // History carries on only for the same repository; a file from another repository starts over.
  const previous = current.status === 'present' && current.record.repository_id === expected.repository_id
    ? current.record.history.map(entry => (entry && LEGACY_STATES[entry.state] ? { ...entry, state: LEGACY_STATES[entry.state] } : entry))
    : [];
  const history = [...previous, { at, state: expected.state, basis: expected.basis }].slice(-MAX_HISTORY);
  const record = { schema: SCHEMA, ...expected, updated_at: at, history };
  writeAtomically(filePath(root), `${JSON.stringify(record, null, 2)}\n`);
  const readBack = readRecord(root);
  if (readBack.status !== 'present' || !agrees(readBack.record, expected)) fail('REPO_STATE_READBACK_FAILED');
  return Object.freeze({ written: true });
}

// Read-only check: 'agrees', 'missing', 'invalid' or 'disagrees'.
function recordStatus(state) {
  const expected = expectedRecord(state);
  if (!expected) return 'not-applicable';
  const current = readRecord(recordRoot(state));
  if (current.status !== 'present') return current.status;
  return agrees(current.record, expected) ? 'agrees' : 'disagrees';
}

module.exports = Object.freeze({
  FOLDER,
  FILE,
  SCHEMA,
  BASES,
  RepoGovernanceFileError,
  filePath,
  recordRoot,
  expectedRecord,
  readRecord,
  recordStatus,
  syncRecord,
  ensureIgnored,
});
