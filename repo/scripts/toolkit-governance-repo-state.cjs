'use strict';

// The governance state a repository carries in its own working tree (#542, owner rule of
// 23 Oct: "STOP until the state is created in the repo's gitignored folder"). The file is
// `.ai-agent-toolkit/governance.json` at the git root. It is a required copy, never the authority:
// the decision itself stays in the user's registry (keyed by repository identity, with receipts),
// so every clone and worktree shares one answer. A file the registry does not back counts for
// nothing, which means repository content, a copied file or an agent's write can never grant
// consent. The hook gate opens only when this file exists and agrees with the registry, and it
// rewrites a missing or disagreeing file from the registry.
//
// The folder is kept out of git twice: a `.gitignore` inside it that ignores everything, and a
// `/.ai-agent-toolkit/` line in the repository's root `.gitignore`. No git subprocess, no network.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const FOLDER = '.ai-agent-toolkit';
const FILE = 'governance.json';
const SCHEMA = 'toolkit.repository-governance.v1';
const IGNORE_LINE = `/${FOLDER}/`;
const INNER_IGNORE = '# Toolkit keeps this folder out of git.\n*\n';
const MAX_BYTES = 64 * 1024;
const MAX_HISTORY = 50;
// The bases a recorded state can have; 'repository opt-in' is rule R4 (the binding and the governed
// block are present and the user has not declined).
const BASES = Object.freeze({ decision: 'your decision', optIn: 'repository opt-in' });

class RepoGovernanceFileError extends Error {
  constructor(code) {
    super(code);
    this.name = 'RepoGovernanceFileError';
    this.code = code;
  }
}

function fail(code) { throw new RepoGovernanceFileError(code); }

function filePath(root) { return path.join(root, FOLDER, FILE); }

// What the file must say for a decided state; null when nothing may be recorded (UNKNOWN, PORTABLE).
function expectedRecord(state) {
  if (!state || !state.repository_id || !['ENABLED', 'DECLINED'].includes(state.state)) return null;
  return { repository_id: state.repository_id, state: state.state, basis: state.rule === 'R4' ? BASES.optIn : BASES.decision };
}

function readRecord(root) {
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
    || typeof parsed.repository_id !== 'string' || !['ENABLED', 'DECLINED'].includes(parsed.state)
    || !Object.values(BASES).includes(parsed.basis) || !Array.isArray(parsed.history)) return { status: 'invalid', record: null };
  return { status: 'present', record: parsed };
}

function agrees(record, expected) {
  return Boolean(record && expected && record.repository_id === expected.repository_id
    && record.state === expected.state && record.basis === expected.basis);
}

function ignoredByRootGitignore(text) {
  return text.split(/\r?\n/).some(line => ['/.ai-agent-toolkit/', '.ai-agent-toolkit/', '/.ai-agent-toolkit', '.ai-agent-toolkit'].includes(line.trim()));
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

// Both ignore rules, added only where missing. A root `.gitignore` that is not a plain file is
// left alone and reported, because Toolkit cannot add the line safely.
function ensureIgnored(root) {
  const folder = path.join(root, FOLDER);
  fs.mkdirSync(folder, { recursive: true });
  const inner = path.join(folder, '.gitignore');
  let innerText = null;
  try { innerText = fs.readFileSync(inner, 'utf8'); } catch { innerText = null; }
  if (innerText !== INNER_IGNORE) writeAtomically(inner, INNER_IGNORE);
  const rootIgnore = path.join(root, '.gitignore');
  let stat = null;
  try { stat = fs.lstatSync(rootIgnore); } catch { stat = null; }
  if (stat && !stat.isFile()) fail('ROOT_GITIGNORE_NOT_A_FILE');
  const current = stat ? fs.readFileSync(rootIgnore, 'utf8') : '';
  if (ignoredByRootGitignore(current)) return false;
  const eol = /\r\n/.test(current) ? '\r\n' : '\n';
  const separator = current === '' || current.endsWith('\n') ? '' : eol;
  fs.writeFileSync(rootIgnore, `${current}${separator}# Toolkit governance state (local, never committed)${eol}${IGNORE_LINE}${eol}`);
  return true;
}

// Makes the repository's file match the decided state. Returns { written, gitignore_updated }.
// Throws RepoGovernanceFileError when it cannot, so callers fail closed.
function syncRecord(state, { now = () => new Date() } = {}) {
  const expected = expectedRecord(state);
  if (!expected || !state.root) fail('NOTHING_TO_RECORD');
  const current = readRecord(state.root);
  const gitignoreUpdated = ensureIgnored(state.root);
  if (current.status === 'present' && agrees(current.record, expected)) return Object.freeze({ written: false, gitignore_updated: gitignoreUpdated });
  const at = now().toISOString();
  // History carries on only for the same repository; a file from another repository starts over.
  const previous = current.status === 'present' && current.record.repository_id === expected.repository_id ? current.record.history : [];
  const history = [...previous, { at, state: expected.state, basis: expected.basis }].slice(-MAX_HISTORY);
  const record = { schema: SCHEMA, ...expected, updated_at: at, history };
  writeAtomically(filePath(state.root), `${JSON.stringify(record, null, 2)}\n`);
  const readBack = readRecord(state.root);
  if (readBack.status !== 'present' || !agrees(readBack.record, expected)) fail('REPO_STATE_READBACK_FAILED');
  return Object.freeze({ written: true, gitignore_updated: gitignoreUpdated });
}

// Read-only check: 'agrees', 'missing', 'invalid' or 'disagrees'.
function recordStatus(state) {
  const expected = expectedRecord(state);
  if (!expected || !state.root) return 'not-applicable';
  const current = readRecord(state.root);
  if (current.status !== 'present') return current.status;
  return agrees(current.record, expected) ? 'agrees' : 'disagrees';
}

module.exports = Object.freeze({
  FOLDER,
  FILE,
  SCHEMA,
  IGNORE_LINE,
  BASES,
  RepoGovernanceFileError,
  filePath,
  expectedRecord,
  readRecord,
  recordStatus,
  syncRecord,
  ensureIgnored,
});
