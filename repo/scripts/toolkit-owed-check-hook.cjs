#!/usr/bin/env node
'use strict';

// Turn-end (Stop) owed check for Claude Code: the controller's session in a governed repository is
// stopped once, with the exact steps, when this turn leaves owed work behind:
// - findings due: open programme findings new for 4 hours or more, or acknowledged past their due time,
//   from this computer's attention cache;
// - gate sessions due: open CLOSE_DUE findings (a finished gate whose session close is not recorded);
// - finished side sessions: sessions this one started in the Claude desktop app that are not archived,
//   not running, have every pull request merged or closed and no step waiting on the owner;
// - gate records owed: a gate this session launched with no `programme.cjs gate-session` record after
//   it, and an archived gate session whose close is not recorded.
// It reads only local files (no git, gh or network) and stops a turn only when the list has an entry it
// has not shown this session before.
//
// Who is stopped works the same in every Claude Code entry point (desktop app, CLI in a terminal, IDE
// extensions, headless): the decision rests only on this session's transcript (it acted as the
// controller; its first message is not a gate brief), Toolkit's own launcher marks (toolkit-governed-
// repo.cjs LAUNCHER_MARKERS) and the attention cache. No variable the host sets decides it. The Claude
// desktop app sets CLAUDE_CODE_CHILD_SESSION in every session, top-level chats included, so it says
// nothing about the session. CLAUDE_CODE_HOST_SESSION_ID and the desktop app's session files only add
// the finished side sessions section; without them that section is skipped and the rest still runs.
// It never stops a turn when the host says this stop already follows a hook block. Anything it cannot
// read is one visible note and never a block.
//
// Codex is not covered: it runs toolkit-programme-checkpoint-hook.cjs alone at turn end, which never
// prints.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPTS = path.join(__dirname, '..', '..', 'skills', 'github-program-reconciler', 'scripts');
const STATE_SCHEMA = 'toolkit.owed-check.v1';
const BINDING_FILE = path.join('.github', 'toolkit-programme.json');
const CLAUDE_SESSION = /^local_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PR_STATES = new Set(['OPEN', 'MERGED', 'CLOSED']);
// A transcript larger than this is not scanned (one note instead), so the hook stays inside its timeout.
const TRANSCRIPT_MAX_BYTES = 256 * 1024 * 1024;
// Desktop session files read per turn end, at most; past it the check says it stopped early.
const SESSION_FILES_MAX = 5000;
const GATES = new Set(['G0', 'G1', 'G2', 'DESIGN_CHALLENGE']);
const LIST_LIMIT = 12;
// A launch record is owed right after the launch, so launches older than LAUNCH_WINDOW_MS are not
// checked (an older one predates the check or was settled long ago); archives are checked for a week.
const LAUNCH_WINDOW_MS = 24 * 60 * 60 * 1000;
const ARCHIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const oneLine = (text, max = 80) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const sha = text => crypto.createHash('sha256').update(text).digest('hex');

function boundRepository(root) {
  try { return String(JSON.parse(fs.readFileSync(path.join(root, BINDING_FILE), 'utf8').replace(/^﻿/, '')).repository || ''); }
  catch { return ''; }
}

// ---- transcript ----------------------------------------------------------------------------------

function toolText(content) {
  if (typeof content === 'string') return content;
  return Array.isArray(content) ? content.map(part => (part && typeof part.text === 'string' ? part.text : '')).join('\n') : '';
}

function flagValue(command, flag) {
  const match = new RegExp(`(?:^|\\s)${flag}(?:=|\\s+)(?:"([^"]*)"|'([^']*)'|(\\S+))`).exec(command);
  return match ? (match[1] ?? match[2] ?? match[3]) : null;
}

// What this session's transcript shows: whether it acted as the controller (a gate launch, or a
// programme command with --controller), the gate sessions it launched, the gate-session records and
// closes it ran, and the sessions it archived. Calls the host refused (is_error) do not count.
function scanTranscript(file, nowMs = Date.now()) {
  const out = { controller: false, launches: [], recorded: new Map(), closed: new Set(), archived: [] };
  const size = fs.statSync(file).size;
  if (size > TRANSCRIPT_MAX_BYTES) throw Object.assign(new Error('too large'), { note: 'this session\'s transcript is too large to scan' });
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const errors = new Set();
  const calls = [];
  const results = new Map();
  for (const line of lines) {
    if (!/start_session|Started session|archive_session|gate-session|--controller|"is_error":true/.test(line)) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (row && row.isSidechain) continue;
    const content = row?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      if (part.type === 'tool_use') calls.push({ ...part, at: Date.parse(row.timestamp) });
      else if (part.type === 'tool_result') {
        if (part.is_error === true) errors.add(part.tool_use_id);
        results.set(part.tool_use_id, toolText(part.content));
      }
    }
  }
  const { parseBrief } = require('./toolkit-gate-route.cjs');
  for (const call of calls) {
    if (errors.has(call.id)) continue;
    const name = String(call.name || '');
    const input = call.input && typeof call.input === 'object' ? call.input : {};
    const age = Number.isFinite(call.at) ? nowMs - call.at : Infinity;
    if (/(?:^|__)start_session$/.test(name)) {
      const gate = parseBrief(typeof input.prompt === 'string' ? input.prompt : '').gate;
      if (!GATES.has(gate)) continue;
      out.controller = true;
      const started = /\(session_id: (local_[0-9a-f-]{36})\b/.exec(results.get(call.id) || '');
      if (age <= LAUNCH_WINDOW_MS && started && CLAUDE_SESSION.test(started[1])) out.launches.push({ session: started[1], gate, title: oneLine(input.title) });
    } else if (/(?:^|__)archive_session$/.test(name)) {
      if (age <= ARCHIVE_WINDOW_MS && CLAUDE_SESSION.test(String(input.session_id))) out.archived.push(input.session_id);
    } else if (/^(?:Bash|PowerShell)$/.test(name) && typeof input.command === 'string' && /programme\.cjs/.test(input.command)) {
      const command = input.command;
      if (/\s--controller\b/.test(command)) out.controller = true;
      if (!/\sgate-session\b/.test(command)) continue;
      const assignment = flagValue(command, '--assignment');
      const session = flagValue(command, '--host-session');
      if (assignment && session) out.recorded.set(session, assignment);
      if (assignment && /\s--closed\b/.test(command)) out.closed.add(assignment);
    }
  }
  return out;
}

// ---- desktop session files ---------------------------------------------------------------------

// The Claude desktop app's session files: <LOCALAPPDATA>/Claude-Data/claude_<account>/claude-code-sessions/<a>/<b>/local_<id>.json.
function sessionFiles(env, deps) {
  const base = path.join(deps.localAppData || env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Claude-Data');
  const files = [];
  const list = dir => { try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; } };
  for (const account of list(base)) {
    if (!account.isDirectory() || !/^claude_/.test(account.name)) continue;
    const sessions = path.join(base, account.name, 'claude-code-sessions');
    for (const a of list(sessions)) {
      if (!a.isDirectory()) continue;
      for (const b of list(path.join(sessions, a.name))) {
        if (!b.isDirectory()) continue;
        for (const entry of list(path.join(sessions, a.name, b.name))) {
          if (entry.isFile() && /^local_.*\.json$/.test(entry.name)) files.push(path.join(sessions, a.name, b.name, entry.name));
        }
      }
    }
  }
  return files;
}

const FORMAT_NOTE = 'the Claude desktop app\'s session files are not in the format this check knows, so finished side sessions were not checked';

// Sessions this one started that look finished: not archived, every pull request merged or closed, the
// last turn's summary current, and nothing waiting on the owner. A session with no pull request is left
// to the programme's CLOSE_DUE finding and never guessed.
function finishedSideSessions(self, env, deps) {
  const files = sessionFiles(env, deps);
  const none = note => ({ due: [], archived: new Set(), note });
  if (files.length > SESSION_FILES_MAX) return none(`there are over ${SESSION_FILES_MAX} desktop session files, so finished side sessions were not checked`);
  const ownFile = files.find(file => path.basename(file) === `${self}.json`);
  if (!ownFile) return none('this session\'s own file was not found among the Claude desktop app\'s session files, so finished side sessions were not checked');
  let own;
  try { own = JSON.parse(fs.readFileSync(ownFile, 'utf8')); } catch { return none(FORMAT_NOTE); }
  if (own?.sessionId !== self || typeof own.isArchived !== 'boolean' || !Number.isFinite(own.createdAt)) return none(FORMAT_NOTE);
  const due = [];
  const archived = new Set();
  for (const file of files) {
    if (file === ownFile) continue;
    // A file last written before this session started cannot be a session it started.
    try { if (fs.statSync(file).mtimeMs < own.createdAt) continue; } catch { continue; }
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    if (!text.includes(self)) continue;
    let doc;
    try { doc = JSON.parse(text); } catch { continue; }
    if (doc?.spawnedFrom?.sessionId !== self) continue;
    if (typeof doc.isArchived !== 'boolean' || (doc.prs !== undefined && !Array.isArray(doc.prs)) || !CLAUDE_SESSION.test(String(doc.sessionId))) return none(FORMAT_NOTE);
    if (doc.isArchived) archived.add(doc.sessionId);
    // autoArchiveExempt: the owner asked the app to keep this session.
    if (doc.isArchived || doc.autoArchiveExempt === true || !Array.isArray(doc.prs) || !doc.prs.length) continue;
    if (doc.prs.some(pr => !PR_STATES.has(pr?.state))) return none(FORMAT_NOTE);
    if (doc.prs.some(pr => pr.state === 'OPEN')) continue;
    const summary = doc.postTurnSummary;
    if (!summary || typeof summary !== 'object' || doc.postTurnSummaryFor !== doc.lastAssistantUuid) continue;
    if (summary.status_category === 'blocked' || String(summary.needs_action || '').trim()) continue;
    if (doc.turnWrapUp?.needsUser === true || doc.interruptedAwaitingPerson) continue;
    // Running: a user message arrived after the last turn ended.
    if (!(Number(doc.lastTurnEdgeAt) >= Number(doc.latestUserFrameAt || 0))) continue;
    due.push({ session: doc.sessionId, title: oneLine(doc.spawnedFrom.title || doc.title), prs: doc.prs.map(pr => Number(pr.prNumber)).filter(Number.isInteger) });
  }
  return { due, archived, note: null };
}

// ---- the owed list ---------------------------------------------------------------------------------

// A controller's turn end keeps this computer's attention cache fresh: with no cache, or one over an
// hour old, it starts `programme.cjs refresh` in the background, at most once per 15 minutes per
// repository. Never in a cloud session (its GitHub link may not reach the programme store, and its
// machine is thrown away), and never where governance reads are switched off (a test run) unless a
// starter is given. True when a refresh started.
function startRefresh({ root, repository, cache, cacheModule, env, deps }) {
  const nowMs = deps.nowMs ?? Date.now();
  if (cache && nowMs - Date.parse(cache.as_of) <= cacheModule.STALE_MS) return false;
  if (env.CLAUDE_CODE_REMOTE === 'true') return false;
  if (!deps.startRefresh && env.TOOLKIT_GOVERNANCE_OFFLINE === '1') return false;
  if (!cacheModule.claimBackgroundStart(repository, { ...deps, now: () => new Date(nowMs).toISOString() })) return false;
  try {
    (deps.startRefresh || require(path.join(SCRIPTS, 'programme-refresh-trigger.cjs')).startRefresh)(root, deps);
    return true;
  } catch { return false; }
}

function owedList({ repository, transcript, cache, refreshing = false, self, env, deps }) {
  const state = require(path.join(SCRIPTS, 'programme-state.cjs'));
  const command = args => require('./toolkit-user-state.cjs').programmeCommand(args, { userHome: deps.home });
  const attention = command('attention');
  const nowMs = deps.nowMs ?? Date.now();
  const items = [];
  const notes = [];
  if (!cache || !Array.isArray(cache.net)) {
    notes.push(`the attention cache for ${repository} is missing or older than this check, so findings due were not checked (${refreshing ? 'a refresh has started in the background' : `run ${attention} to refresh it`})`);
  } else {
    const callout = state.netCallout(cache.net.filter(entry => entry.code !== 'CLOSE_DUE'), nowMs);
    for (const entry of callout.entries) {
      items.push({ key: `finding:${entry.id}:${entry.state}`, section: 'findings',
        text: `${entry.code} on ${entry.ref} (${entry.id}), ${entry.state === 'overdue' ? `acknowledged and ${entry.hours} h past its due time` : `new for ${entry.hours} h`}` });
    }
    for (const entry of cache.net) {
      if (entry.code !== 'CLOSE_DUE') continue;
      const overdue = entry.state === 'acknowledged' && state.netCallout([entry], nowMs).count > 0;
      if (entry.state !== 'new' && !overdue) continue;
      items.push({ key: `close:${entry.id}`, section: 'close',
        text: `assignment ${entry.kind || '(unknown)'} on #${entry.issue} (finding ${entry.id})` });
    }
  }
  let archived = new Set();
  if (self) {
    const side = finishedSideSessions(self, env, deps);
    archived = side.archived;
    if (side.note) notes.push(side.note);
    for (const entry of side.due) {
      items.push({ key: `side:${entry.session}`, section: 'side',
        text: `${entry.title || '(no title)'}: session_id ${entry.session}${entry.prs.length ? `, PR ${entry.prs.map(n => `#${n}`).join(', ')} merged or closed` : ''}` });
    }
  }
  if (transcript) {
    for (const launch of transcript.launches) {
      // A launch whose session is already archived owes no launch record any more.
      if (transcript.recorded.has(launch.session) || archived.has(launch.session)) continue;
      items.push({ key: `record:${launch.session}`, section: 'record', text: `${launch.gate} "${launch.title || '(no title)'}": session_id ${launch.session}` });
    }
    for (const session of transcript.archived) {
      const assignment = transcript.recorded.get(session);
      if (!assignment || transcript.closed.has(assignment)) continue;
      items.push({ key: `closed:${assignment}`, section: 'closed', text: `assignment ${assignment} (its session was archived)` });
    }
  }
  return { items, notes, command };
}

// Each section's step; `command` builds a runnable programme.cjs line (the shared helper).
const CLOSED = '--issue <n> --assignment <id> --closed';
const SECTIONS = Object.freeze({
  findings: { title: 'Findings due', step: command => `Answer each as the parent's holder: fix it, or run ${command('ack --finding <id> --next "<step>"')} or ${command('dispose --finding <id> --reason "<why>"')} (${command('attention')} lists them).` },
  close: { title: 'Gate sessions due to close', step: command => `Run ${command('attention')} for each session, archive it with the app's archive_session tool (never this session), then run ${command(`gate-session ${CLOSED}`)}.` },
  side: { title: 'Finished side sessions, not archived', step: () => 'Archive each with the app\'s archive_session tool once its report is stored, or say in your reply why it stays open.' },
  record: { title: 'Gate launches with no gate-session record', step: command => `Record each: ${command('gate-session --issue <n> --assignment <id> --host claude-code --host-session <session_id>')}. If it answers STALE_ASSIGNMENT, the assignment predates session records: say so in your reply.` },
  closed: { title: 'Archived gate sessions with no close record', step: command => `Record each: ${command(`gate-session ${CLOSED}`)}.` },
});

function reasonText(items, notes, command, cacheAge = null) {
  const lines = ['Toolkit owed check: this turn leaves work owed. Do it now, or say in your reply why it waits.'];
  for (const [section, spec] of Object.entries(SECTIONS)) {
    const rows = items.filter(item => item.section === section);
    if (!rows.length) continue;
    // Findings come from the attention cache; an old cache may list findings already answered.
    const asOf = cacheAge && (section === 'findings' || section === 'close') ? `, from the attention cache as of ${cacheAge} ago` : '';
    lines.push('', `${spec.title} (${rows.length}${asOf}):`, ...rows.slice(0, LIST_LIMIT).map(item => `- ${item.text}`));
    if (rows.length > LIST_LIMIT) lines.push(`- and ${rows.length - LIST_LIMIT} more`);
    lines.push(spec.step(command));
  }
  if (notes.length) lines.push('', ...notes.map(note => `Toolkit could not read everything: ${note}.`));
  lines.push('', 'This check stops a turn again only when an entry is added to this list.');
  return lines.join('\n');
}

// ---- per-session memory --------------------------------------------------------------------------

function stateFile(sessionId, deps) {
  const hash = require(path.join(SCRIPTS, 'programme-checkpoint.cjs')).sessionHash(sessionId);
  return path.join(deps.home || os.homedir(), '.ai-agent-toolkit', 'user-state', 'owed-check', `${hash}.json`);
}

function readState(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && value.schema === STATE_SCHEMA ? value : null;
  } catch { return null; }
}

function writeState(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify({ schema: STATE_SCHEMA, ...value })}\n`, { mode: 0o600 });
    fs.renameSync(temp, file);
    return true;
  } catch { return false; }
}

// ---- entry -----------------------------------------------------------------------------------------

// Returns { output } (the JSON the host reads, or null to stay silent) and an outcome for tests.
function check(input, deps = {}) {
  const env = deps.env || process.env;
  if (!input || typeof input !== 'object') return { outcome: 'NO_INPUT', output: null };
  if (input.hook_event_name !== undefined && input.hook_event_name !== 'Stop') return { outcome: 'NOT_STOP', output: null };
  if (input.stop_hook_active === true) return { outcome: 'ALREADY_BLOCKED', output: null };
  // A session a Toolkit launcher started (a gate, a pinned helper or task profile) is an executor.
  const { LAUNCHER_MARKERS } = require('./toolkit-governed-repo.cjs');
  if (LAUNCHER_MARKERS.some(name => String(env[name] || '').trim())) return { outcome: 'EXECUTOR', output: null };
  const sessionId = typeof input.session_id === 'string' && input.session_id.trim() ? input.session_id : null;
  if (!sessionId) return { outcome: 'NO_SESSION', output: null };
  const root = require(path.join(SCRIPTS, 'programme-refresh-trigger.cjs')).governedRoot(input.cwd);
  if (!root) return { outcome: 'NOT_GOVERNED', output: null };
  const repository = boundRepository(root);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) return { outcome: 'NOT_GOVERNED', output: null };
  if (!require(path.join(SCRIPTS, 'programme-checkpoint.cjs')).githubGovernanceOn(root, deps)) return { outcome: 'NOT_GOVERNED', output: null };
  const notes = [];
  let transcript = null;
  const transcriptPath = typeof input.transcript_path === 'string' && input.transcript_path ? input.transcript_path : null;
  if (transcriptPath) {
    const route = require('./toolkit-gate-route.cjs');
    // A gate session (its first message is a gate brief) is never stopped by this check.
    try {
      const brief = route.readTranscript(transcriptPath, { brief: true, served: false }).brief;
      const gate = route.parseBrief(brief).gate;
      if (gate && gate !== 'none') return { outcome: 'GATE', output: null };
    } catch { /* an unreadable brief is caught by the scan below */ }
    try { transcript = scanTranscript(transcriptPath, deps.nowMs ?? Date.now()); } catch (error) { notes.push(error.note || 'this session\'s transcript could not be read, so gate launches and records were not checked'); }
  } else {
    notes.push('the host gave no transcript, so gate launches and records were not checked');
  }
  // Only a session that acted as the controller is stopped; a transcript that could not be read is
  // reported once as a note, never a block.
  if (transcript && !transcript.controller) return { outcome: 'NOT_CONTROLLER', output: null };
  const hostSession = String(env.CLAUDE_CODE_HOST_SESSION_ID || '');
  const self = CLAUDE_SESSION.test(hostSession) ? hostSession : null;
  const cacheModule = require(path.join(SCRIPTS, 'programme-attention-cache.cjs'));
  const cache = cacheModule.readCache(repository, deps);
  const refreshing = startRefresh({ root, repository, cache, cacheModule, env, deps });
  const owed = transcript ? owedList({ repository, transcript, cache, refreshing, self, env, deps }) : { items: [], notes: [], command: null };
  owed.notes.unshift(...notes);
  const file = stateFile(sessionId, deps);
  const previous = readState(file);
  // Entries are remembered by hash only. A shorter list (owed work done) never stops the turn again.
  const keys = owed.items.map(item => sha(item.key).slice(0, 16)).sort();
  const shown = new Set(Array.isArray(previous?.keys) ? previous.keys : []);
  const noteDigest = sha(owed.notes.join('\n'));
  const added = keys.some(key => !shown.has(key));
  const notesChanged = owed.notes.length > 0 && previous?.notes !== noteDigest;
  const remembered = writeState(file, { keys, notes: noteDigest });
  // Without its memory this check would stop every later turn with the same list, so it only notes.
  if (added && !remembered) {
    return { outcome: 'NO_MEMORY', output: { systemMessage: `Toolkit owed check: ${owed.items.length} entries owed, but its memory file could not be saved, so the turn was not stopped. Run ${owed.command('attention')} for the findings.` } };
  }
  if (added) {
    const ageMs = cache ? (deps.nowMs ?? Date.now()) - Date.parse(cache.as_of) : 0;
    const cacheAge = ageMs > cacheModule.STALE_MS ? cacheModule.ageText(ageMs) : null;
    return { outcome: 'BLOCK', output: { decision: 'block', reason: reasonText(owed.items, owed.notes, owed.command, cacheAge) } };
  }
  if (notesChanged) {
    return { outcome: 'NOTE', output: { systemMessage: owed.notes.map(note => `Toolkit could not read everything for the owed check: ${note}.`).join('\n') } };
  }
  return { outcome: owed.items.length ? 'SHOWN' : 'NOTHING_OWED', output: null };
}

function main(deps = {}) {
  try {
    const raw = deps.stdin !== undefined ? deps.stdin : fs.readFileSync(0, 'utf8');
    const result = check(JSON.parse(raw || '{}'), deps);
    if (result.output) (deps.stdout || process.stdout).write(`${JSON.stringify(result.output)}\n`);
  } catch {
    // Unreadable input or a broken module: nothing to check against, and nothing may block.
  }
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = Object.freeze({ check, main, scanTranscript, finishedSideSessions, owedList, reasonText, STATE_SCHEMA });
