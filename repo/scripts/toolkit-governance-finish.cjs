'use strict';

// The post-merge finish of a governance turn-on. Some settings can only follow the merge: the
// default-branch protection ruleset (its required checks come from the merged binding), the
// no-force-push ruleset and the free dependency and security settings. When the governance bank
// publishes a turn-on pull request it notes the repository here as finish pending. Once that binding
// is merged and read back, the session-start line starts the finish once in the background
// (`toolkit-governance.cjs finish`, which asks nothing: the owner's yes in the bank covers these
// settings and the bank listed them) and the next session shows its result in one line. A failed
// finish stays pending and is tried again, at most once per FINISH_GAP_MS.
//
// The file holds only repository ids, proposal numbers, times and result lines, never a token.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { userStateDirectory } = require('./toolkit-user-state.cjs');

const SCHEMA = 'toolkit.governance-finish.v1';
const BASENAME = 'governance-finish.v1.json';
const FINISH_GAP_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 32;
const SCRIPT = path.join(__dirname, 'toolkit-governance.cjs');
// What the finish turns on, as the bank's end lines and the session line say it.
const WHAT = 'default-branch protection (pull requests only, the required checks, merge commits only), a ruleset that blocks force pushes, and the free dependency and security settings';

function fileOf(registryOptions = {}) { return path.join(userStateDirectory(registryOptions), BASENAME); }

function read(registryOptions) {
  try {
    const parsed = JSON.parse(fs.readFileSync(fileOf(registryOptions), 'utf8'));
    if (parsed && parsed.schema === SCHEMA && parsed.repositories && typeof parsed.repositories === 'object') return parsed;
  } catch { /* none yet, or unreadable: start empty */ }
  return { schema: SCHEMA, repositories: {} };
}

function write(registryOptions, value) {
  const file = fileOf(registryOptions);
  const entries = Object.entries(value.repositories).sort((a, b) => String(b[1].at).localeCompare(String(a[1].at))).slice(0, MAX_ENTRIES);
  const text = `${JSON.stringify({ schema: SCHEMA, repositories: Object.fromEntries(entries) }, null, 2)}\n`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try { fs.writeFileSync(temp, text, { mode: 0o600 }); fs.renameSync(temp, file); } finally { fs.rmSync(temp, { force: true }); }
}

function update(registryOptions, repositoryId, change) {
  const value = read(registryOptions);
  const next = change(value.repositories[repositoryId] || null);
  if (next) value.repositories[repositoryId] = next; else delete value.repositories[repositoryId];
  write(registryOptions, value);
  return next;
}

// Noted when the bank publishes a turn-on pull request.
function markPending(registryOptions, repositoryId, { proposal = null, now = new Date() } = {}) {
  if (typeof repositoryId !== 'string' || !repositoryId) return null;
  return update(registryOptions, repositoryId, () => ({ status: 'pending', proposal, at: now.toISOString(), started_at: null, line: null }));
}

function entryFor(registryOptions, repositoryId) { return read(registryOptions).repositories[repositoryId] || null; }

// The finish result: 'done' is shown once by the next session and then dropped; 'failed' stays pending.
function record(registryOptions, repositoryId, result, lines, { now = new Date() } = {}) {
  return update(registryOptions, repositoryId, entry => entry && ({
    ...entry, status: result === 'done' ? 'done' : 'pending', finished_at: now.toISOString(),
    line: result === 'done' ? `Toolkit: governance setup finished here: ${WHAT} are on and read back.`
      : `Toolkit: governance setup could not finish here yet (${lines.filter(Boolean).slice(-1)[0] || 'GitHub could not be written'}); it is tried again in a later session.`,
  }));
}

function startFinish(root) {
  const child = spawn(process.execPath, [SCRIPT, 'finish'], { cwd: root, detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {});
  child.unref();
}

// The session-start lines for an ENABLED repository whose binding is freshly read: the last result
// once, then a background start while the finish is pending (at most once per FINISH_GAP_MS).
// Offline and test runs start nothing unless deps.startFinish is given. Any failure drops the lines.
function sessionLines(state, registryOptions = {}, deps = {}) {
  try {
    if (state?.state !== 'ENABLED' || state.programme_records_bind !== true || !state.repository_id) return [];
    const entry = entryFor(registryOptions, state.repository_id);
    if (!entry) return [];
    const now = deps.now ? deps.now() : new Date();
    const lines = [];
    if (entry.line) lines.push(entry.line);
    if (entry.status === 'done') { update(registryOptions, state.repository_id, () => null); return lines; }
    const offline = (deps.environment || process.env).TOOLKIT_GOVERNANCE_OFFLINE === '1' || registryOptions.testOnly === true;
    const last = Date.parse(entry.started_at || '');
    if ((deps.startFinish || !offline) && !(Number.isFinite(last) && now.getTime() - last < FINISH_GAP_MS)) {
      update(registryOptions, state.repository_id, current => current && ({ ...current, started_at: now.toISOString() }));
      (deps.startFinish || startFinish)(state.root);
      lines.push(`Toolkit: the governance turn-on is merged, so Toolkit is finishing its setup in the background: ${WHAT}. The next session here shows the result.`);
    }
    return lines;
  } catch { return []; }
}

module.exports = Object.freeze({ BASENAME, FINISH_GAP_MS, SCHEMA, WHAT, entryFor, markPending, record, sessionLines, startFinish });
