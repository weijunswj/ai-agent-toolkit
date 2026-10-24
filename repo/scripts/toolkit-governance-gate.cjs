'use strict';

// The hook gate for per-repository governance (owner rule of 23 Oct: a hard stop, like the
// stale-Toolkit check, that keeps stopping until the state exists). Shared by the Claude Code and
// Codex hooks:
//
//   - GovernanceGate decides whether a working directory is held. UNDECIDED (including an unreadable
//     state) is held; a plain folder (no git) never is, and neither is a decided repository. The
//     gate keeps the copy (`.ai-agent-toolkit/governance.json`, in the repository or plain folder) in
//     step with the state, and a copy it cannot write never holds.
//   - PromptHold is the UserPromptSubmit core. In a held repository every prompt is blocked and kept
//     on this computer. On github.com the block asks a plain question: enable Toolkit's GitHub
//     governance, yes, no or later ("not now" also works). In a git repository that is not on
//     github.com it says GitHub governance is off there and asks for an ok. The user's own reply is
//     the answer (`toolkit governance enable` or `disable` also work, and `decline` is the older word
//     for disable); it is recorded, read back and then let through with the held prompts attached,
//     oldest first. An answer counts only in the run of the session that was shown the question
//     (SessionEpochs). Each session gets back only the messages it sent itself, and a session another
//     session or a Toolkit launcher started is refused in a held repository and nothing is kept.
//   - ToolGate is the PreToolUse core. A held repository runs no state-changing tool. In every
//     folder, an agent may not answer the question for the user: commands that run the governance
//     CLI or start a host session with the answer as its prompt are refused, and so are edits to
//     Toolkit's user-state files. A command that starts a host session in a held repository (after
//     `cd`, or with Codex's `-C`) is refused too.
//   - sessionLine is the one SessionStart line that states the effective state.
//
// Every failure inside a git repository holds (fail closed). Held prompts never leave this computer
// and are never printed to logs.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const governance = require('./toolkit-governance-state.cjs');
const repoState = require('./toolkit-governance-repo-state.cjs');

const CAPABILITY = governance.GOVERNANCE_CAPABILITY;
const HELD_BASENAME = 'held-prompts.v1.json';
const HELD_SCHEMA = 'toolkit.held-prompts.v1';
const NOT_NOW_BASENAME = 'governance-not-now.v1.json';
const NOT_NOW_SCHEMA = 'toolkit.governance-not-now.v1';
const NOT_GITHUB_BASENAME = governance.NOT_GITHUB_BASENAME;
const NOT_GITHUB_SCHEMA = governance.NOT_GITHUB_SCHEMA;
const MAX_NOT_GITHUB = 500;
const MAX_HELD = 20;
const MAX_HELD_CHARS = 4000;
const MAX_HELD_BYTES = 512 * 1024;
const MAX_NOT_NOW_SESSIONS = 8;
const SESSIONS_FOLDER = 'governance-sessions.v1';
const SESSION_SCHEMA = 'toolkit.governance-session.v1';
const MAX_SESSIONS = 256;
const EPOCH = /^[0-9a-f]{32}$/;
const LAUNCHER_MARKERS = Object.freeze(['TOOLKIT_GATE_ROLE', 'TOOLKIT_NATIVE_HELPER_BINDING', 'TOOLKIT_CLAUDE_TASK_PROFILE_SHA256']);
// Toolkit's Claude Code session-start hook exports the session's own id under this name for the shell
// commands that session runs. A host session an agent starts from one of those commands inherits it,
// sees an id that is not its own, and is treated as automation, not the user typing.
const HOST_SESSION_VARIABLE = 'TOOLKIT_HOST_SESSION';

// The answer is the whole prompt, in any letter case, with surrounding spaces or one final full stop.
// `decline` is kept as the older word for `disable`.
const ANSWER = /^\s*toolkit governance (enable|disable|decline)\.?\s*$/i;
// The short replies to the question Toolkit asked. Like the full answer above, they count only once a
// prompt has been held for the repository in the same run of the host session, so that run was shown
// the question (or, for the full answer, the run said "later"); the whole message must be the reply.
const SHORT_ANSWER = /^\s*(yes|y|no|n|not now|later)[.!]?\s*$/i;
const SHORT_COMMANDS = Object.freeze({ yes: 'enable', y: 'enable', no: 'disable', n: 'disable', 'not now': 'not-now', later: 'not-now' });
// The replies that say ok to GitHub governance being off in a repository that is not on github.com.
// Every one of them has the same effect, so a plain "yes" or "no" works too.
const OK_ANSWER = /^\s*(ok|okay|yes|y|no|n|not now|later)[.!]?\s*$/i;
// An agent's command that would answer for the user: the CLI script with a decision, or a host
// session started, resumed or fed on stdin with an answer (long or short) as its prompt. A host's
// own subcommands (`claude config`, `codex login` and the like) start no session and are not read.
// This reads the command's text, so it is best effort. What stops a fresh nested session is the
// same-run rule above (it has nothing held, so nothing it sends answers) together with the refusal
// of sessions another session started; a resumed session is a new run (SessionEpochs).
const HOST_COMMAND = /(?:^|[\s;&|()`'"\\/])(?:claude|codex)(?:-code)?(?:\.exe|\.cmd|\.ps1)?(?=$|[\s;&|()`'"])/im;
const SHELL_WORD = /"((?:[^"\\]|\\.)*)"|'([^']*)'|([^\s;&|()<>"'=`]+)/g;
function shortAnswerWord(text) {
  const words = [...text.matchAll(SHELL_WORD)].map(match => match[1] ?? match[2] ?? match[3]);
  return [...words, ...text.split(/\r?\n/)]
    .some(word => OK_ANSWER.test(word.replace(/^\$/, '').replace(/(?:\\[nr])+$/, '')));
}
const HOST_SUBCOMMAND = /^\s*(?:\S*[\\/])?(?:claude|codex)(?:-code)?(?:\.exe|\.cmd|\.ps1)?\s+(?:config|mcp|plugin|plugins|update|upgrade|doctor|install|migrate-installer|setup-token|login|logout|auth|completion|features|sandbox|debug|apply|app-server|help|--version|-v|--help|-h)(?=$|\s)/i;
function answerCommand(text) {
  return /toolkit-governance\.cjs["']?\s+(?:enable|disable|decline|reopen|migrate|repair)\b/i.test(text)
    || (/\b(?:claude|codex)\b/i.test(text) && /toolkit governance (?:enable|disable|decline)\b/i.test(text))
    || (text.split(/;|&&|\|\|/).some(part => HOST_COMMAND.test(part) && !HOST_SUBCOMMAND.test(part)) && shortAnswerWord(text));
}
// A command that resumes, continues or forks a host session (Claude Code `--resume`, `-r`,
// `--continue`, `-c`, `--session-id`; Codex `resume` or `fork`). While any message is held an agent
// may not resume one; a resume that gets past this text check is a new run and cannot answer anyway.
const HOST_RESUME = /(?:^|[\s;&|()`'"\\/])claude(?:-code)?(?:\.exe|\.cmd|\.ps1)?(?=\s)[^\n;&|]*?\s(?:--resume|-r|--continue|-c|--session-id|--fork-session)(?=$|[\s=])|(?:^|[\s;&|()`'"\\/])codex(?:\.exe|\.cmd|\.ps1)?\s+(?:exec\s+)?(?:resume|fork)(?=$|\s)/im;
const USER_STATE_PATH = /[\\/]\.ai-agent-toolkit[\\/]user-state(?:[\\/]|$)/i;
// Tools that read only; everything else changes something and is held.
const READ_ONLY_TOOLS = /^(?:Read|Glob|Grep|LS|WebFetch|WebSearch|TodoWrite|update_plan|view_image)$/;
const EDIT_TOOLS = /^(?:Edit|Write|MultiEdit|NotebookEdit|apply_patch)$/;
const SHELL_TOOLS = /^(?:Bash|PowerShell|Monitor|exec_command|shell|local_shell)$/;

class GovernanceGateError extends Error {
  constructor(code) {
    super(code);
    this.name = 'GovernanceGateError';
    this.code = code;
  }
}

function codeOf(error) {
  return error && typeof error.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(error.code) ? error.code : 'UNEXPECTED';
}

// The command a person types in a terminal; there is no `toolkit` executable.
function terminalCommand(subcommand) {
  return `node "${path.join(__dirname, 'toolkit-governance.cjs')}" ${subcommand}`;
}

// ---- gate -------------------------------------------------------------------------------------

class GovernanceGate {
  #stateReader; #now; #notNow; #epochs;

  constructor({ registryOptions = {}, stateReader = null, now = () => new Date() } = {}) {
    this.#stateReader = stateReader || (cwd => governance.governanceState(cwd, registryOptions));
    this.#now = now;
    this.#notNow = new NotNow({ registryOptions, now });
    this.#epochs = new SessionEpochs({ registryOptions, now });
  }

  // { hold, reason, state, file } where reason is one of 'no-git' (a plain folder, DISABLED
  // automatically), 'decided', 'undecided' (the github.com question), 'not-github' (a git repository
  // not on github.com, waiting for the user's ok), 'not-now' (the user said later in this run of the session)
  // or 'state-unreadable'. Only the user-state files decide whether a repository holds: a decided
  // repository never holds over its copy, and a copy that cannot be written is reported as file
  // 'unwritable' with its error_code. With write: false the copy is only checked. "Not now" lasts for
// the run of the session that said it (its session mark).
  evaluate(cwd, { write = true, sessionId = null } = {}) {
    const state = this.#stateReader(cwd);
    const verdict = (hold, reason, extra = {}) => Object.freeze({ hold, reason, state, file: null, ...extra });
    if (state.state === 'UNDECIDED' && state.rule === 'ERROR') return verdict(true, 'state-unreadable');
    if (state.state === 'UNDECIDED' && state.rule === 'R9') return verdict(true, 'not-github');
    if (state.state === 'UNDECIDED') return this.#notNow.has(state.repository_id, sessionId, this.#epochs.get(sessionId)) ? verdict(false, 'not-now') : verdict(true, 'undecided');
    const reason = state.rule === 'R1' ? 'no-git' : 'decided';
    if (!repoState.expectedRecord(state)) return verdict(false, reason, { file: 'not-applicable' });
    if (!write) return verdict(false, reason, { file: repoState.recordStatus(state) });
    try {
      const synced = repoState.syncRecord(state, { now: this.#now });
      return verdict(false, reason, { file: synced.written ? 'written' : 'agrees' });
    } catch (error) {
      return verdict(false, reason, { file: 'unwritable', error_code: codeOf(error) });
    }
  }
}

// ---- decision ---------------------------------------------------------------------------------

// Records the user's decision through the registry's owner-action path, then reads it back through
// the gate (which also writes the in-repository copy). Throws GovernanceGateError when the result
// is not the decided state.
function writeGovernanceDecision(cwd, command, { registryOptions = {}, registry = require('./toolkit-capability-registry.cjs'), now } = {}) {
  if (!['enable', 'disable', 'decline'].includes(command)) throw new GovernanceGateError('UNKNOWN_COMMAND');
  const status = registry.getRepositoryStatus({ cwd, ...registryOptions });
  if (status.actionable) throw new GovernanceGateError('REGISTRY_UNAVAILABLE');
  const current = status.capabilities[CAPABILITY].state;
  // The registry keeps its own operation names: a first "no" is 'decline', turning off an enabled one is 'disable'.
  const operation = command === 'enable' ? 'enable' : (current === 'enabled' ? 'disable' : 'decline');
  registry.writeCapabilityDecision({
    cwd,
    ...registryOptions,
    capabilityId: CAPABILITY,
    operation,
    ownerAction: {
      confirmed: true,
      category: 'explicit-owner',
      channel: 'capability-route',
      operation,
      choice_semantic_id: registry.capabilityDecisionSemanticId(CAPABILITY, operation),
      contract_digest: registry.CONTRACT_DIGEST,
      scope_digest: registry.capabilityScopeDigest(status.repository_id, CAPABILITY, operation, 'capability-route'),
    },
    expectedRevision: status.registry_revision,
    expectedHash: status.snapshot_hash,
  });
  const verdict = new GovernanceGate({ registryOptions, now }).evaluate(cwd);
  const expected = command === 'enable' ? 'ENABLED' : 'DISABLED';
  if (verdict.state.state !== expected || verdict.state.repository_id !== status.repository_id) throw new GovernanceGateError('READBACK_MISMATCH');
  return verdict;
}

// ---- session epochs ---------------------------------------------------------------------------

// A random mark per host session, written by the session-start hook (both hosts run it in headless
// runs too) and kept next to the registry, one small file per session. A session start or resume
// gets a new mark; /clear and compaction keep the one the session has. A held message carries the
// mark of the run that sent it, and an answer counts only when this run's mark matches, so a later
// process that resumes the session (such as an agent's `claude -p yes --resume <id>`) cannot answer
// for the user. A session with no mark (it started before the hook could record one) cannot answer
// in chat at all. Neither host's hook input says whether a run is headless, so this is the signal.
class SessionEpochs {
  #folder; #now;

  constructor({ registryOptions = {}, now = () => new Date() } = {}) {
    this.#folder = path.join(path.dirname(governance.registryPathFor(registryOptions)), SESSIONS_FOLDER);
    this.#now = now;
  }

  static #valid(sessionId) { return typeof sessionId === 'string' && sessionId !== ''; }

  #file(sessionId) {
    return path.join(this.#folder, `${crypto.createHash('sha256').update(sessionId).digest('hex').slice(0, 32)}.json`);
  }

  // This run's mark, or null when there is none or it cannot be read.
  get(sessionId) {
    if (!SessionEpochs.#valid(sessionId)) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.#file(sessionId), 'utf8'));
      return parsed && parsed.schema === SESSION_SCHEMA && EPOCH.test(parsed.epoch) ? parsed.epoch : null;
    } catch { return null; }
  }

  // Records the session start and returns its mark. source is the hook input's: startup, resume,
  // clear or compact (Codex sends the first three). Anything but clear or compact starts a new mark.
  start(sessionId, source) {
    if (!SessionEpochs.#valid(sessionId)) return null;
    if (source === 'clear' || source === 'compact') {
      const kept = this.get(sessionId);
      if (kept) return kept;
    }
    const epoch = crypto.randomBytes(16).toString('hex');
    fs.mkdirSync(this.#folder, { recursive: true });
    const file = this.#file(sessionId);
    const temp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    try {
      fs.writeFileSync(temp, `${JSON.stringify({ schema: SESSION_SCHEMA, epoch, at: this.#now().toISOString() })}\n`, { mode: 0o600 });
      fs.renameSync(temp, file);
    } finally {
      fs.rmSync(temp, { force: true });
    }
    this.#prune();
    return epoch;
  }

  // Keeps the newest few hundred sessions; older ones are long finished.
  #prune() {
    try {
      const names = fs.readdirSync(this.#folder).filter(name => /^[0-9a-f]{32}\.json$/.test(name));
      if (names.length <= MAX_SESSIONS) return;
      const aged = names.map(name => {
        const file = path.join(this.#folder, name);
        try { return { file, at: fs.statSync(file).mtimeMs }; } catch { return { file, at: 0 }; }
      }).sort((a, b) => b.at - a.at);
      for (const { file } of aged.slice(MAX_SESSIONS)) fs.rmSync(file, { force: true });
    } catch { /* pruning is housekeeping only */ }
  }
}

// The session-start hook's call on both hosts: records the session's mark. Never throws.
function startSession(input, { registryOptions = {}, now } = {}) {
  try { return new SessionEpochs({ registryOptions, now }).start(sessionIdOf(input), input && input.source); } catch { return null; }
}

// ---- held prompts -----------------------------------------------------------------------------

// Prompts held in undecided repositories, kept next to the registry, private to this computer.
class HeldPrompts {
  #file; #now;

  constructor({ registryOptions = {}, now = () => new Date() } = {}) {
    this.#file = path.join(path.dirname(governance.registryPathFor(registryOptions)), HELD_BASENAME);
    this.#now = now;
  }

  // A store that cannot be read holds (fail closed). A damaged or oversized one is moved aside, kept
  // on this computer next to the original, and a fresh store starts, so the question still works.
  #read() {
    const empty = () => ({ schema: HELD_SCHEMA, repositories: {} });
    let text;
    try { text = fs.readFileSync(this.#file, 'utf8'); } catch (error) {
      if (error && error.code === 'ENOENT') return empty();
      throw new GovernanceGateError('HELD_PROMPTS_UNREADABLE');
    }
    let parsed = null;
    if (Buffer.byteLength(text) <= MAX_HELD_BYTES) { try { parsed = JSON.parse(text); } catch { parsed = null; } }
    if (parsed && parsed.schema === HELD_SCHEMA && parsed.repositories && typeof parsed.repositories === 'object' && !Array.isArray(parsed.repositories)) return parsed;
    const aside = `${this.#file}.damaged-${this.#now().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(2).toString('hex')}`;
    try { fs.renameSync(this.#file, aside); } catch { throw new GovernanceGateError('HELD_PROMPTS_MALFORMED'); }
    return empty();
  }

  #write(data) {
    const empty = Object.keys(data.repositories).length === 0;
    if (empty) { fs.rmSync(this.#file, { force: true }); return; }
    fs.mkdirSync(path.dirname(this.#file), { recursive: true });
    const temp = `${this.#file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    try {
      fs.writeFileSync(temp, `${JSON.stringify(data)}\n`, { mode: 0o600 });
      fs.renameSync(temp, this.#file);
    } finally {
      fs.rmSync(temp, { force: true });
    }
  }

  // The number held for the repository, or with a session id, the number that session sent.
  count(repositoryId, sessionId = undefined) {
    const list = this.#read().repositories[repositoryId];
    if (!Array.isArray(list)) return 0;
    if (sessionId === undefined) return list.length;
    if (typeof sessionId !== 'string' || sessionId === '') return 0;
    return list.filter(entry => entry && entry.session_id === sessionId).length;
  }

  // Whether this session sent a held message in this run (the same session mark), so this run was
  // shown the question.
  asked(repositoryId, sessionId, epoch) {
    if (typeof sessionId !== 'string' || sessionId === '' || !EPOCH.test(String(epoch))) return false;
    const list = this.#read().repositories[repositoryId];
    return Array.isArray(list) && list.some(entry => entry && entry.session_id === sessionId && entry.epoch === epoch);
  }

  // Whether anything is held for any repository.
  any() {
    return Object.values(this.#read().repositories).some(list => Array.isArray(list) && list.length > 0);
  }

  // Keeps the prompt with the session and run that sent it (trimmed to a size cap; the oldest go
  // first past the count cap) and returns the number now held.
  add(repositoryId, prompt, sessionId = null, epoch = null) {
    const data = this.#read();
    const list = Array.isArray(data.repositories[repositoryId]) ? data.repositories[repositoryId] : [];
    const text = String(prompt || '').slice(0, MAX_HELD_CHARS);
    const entry = { at: this.#now().toISOString(), text };
    if (typeof sessionId === 'string' && sessionId !== '') entry.session_id = sessionId;
    if (entry.session_id && EPOCH.test(String(epoch))) entry.epoch = epoch;
    data.repositories[repositoryId] = [...list, entry].slice(-MAX_HELD);
    this.#write(data);
    return data.repositories[repositoryId].length;
  }

  // Returns the prompts this session sent, oldest first, and forgets them; other sessions' prompts
  // stay for those sessions. Without a session id, only prompts held without one are returned.
  take(repositoryId, sessionId = null) {
    const data = this.#read();
    const list = Array.isArray(data.repositories[repositoryId]) ? data.repositories[repositoryId] : [];
    const owner = typeof sessionId === 'string' && sessionId !== '' ? sessionId : null;
    const mine = entry => (entry && typeof entry.session_id === 'string' && entry.session_id !== '' ? entry.session_id : null) === owner;
    const taken = list.filter(mine);
    if (taken.length === 0) return [];
    const rest = list.filter(entry => !mine(entry));
    if (rest.length > 0) data.repositories[repositoryId] = rest; else delete data.repositories[repositoryId];
    this.#write(data);
    return taken.map(entry => String(entry.text || ''));
  }
}

// "Not now" answers, kept next to the registry: per repository, the sessions that gave one (the
// newest few, so another session's "not now" never re-holds this one) and each one's session mark.
// Nothing is decided; a new session, or the same one resumed, asks again. A missing, unreadable or damaged file counts as no
// "not now" (the repository stays held and the question still works), and the next "not now"
// replaces it.
class NotNow {
  #file; #now;

  constructor({ registryOptions = {}, now = () => new Date() } = {}) {
    this.#file = path.join(path.dirname(governance.registryPathFor(registryOptions)), NOT_NOW_BASENAME);
    this.#now = now;
  }

  #read() {
    let parsed = null;
    try { parsed = JSON.parse(fs.readFileSync(this.#file, 'utf8')); } catch { parsed = null; }
    const usable = parsed && parsed.schema === NOT_NOW_SCHEMA && parsed.repositories && typeof parsed.repositories === 'object' && !Array.isArray(parsed.repositories);
    return usable ? parsed : { schema: NOT_NOW_SCHEMA, repositories: {} };
  }

  // { sessionId: at } for one repository; an entry an earlier version wrote holds one session_id.
  static #sessions(entry) {
    if (!entry || typeof entry !== 'object') return {};
    const sessions = entry.sessions && typeof entry.sessions === 'object' && !Array.isArray(entry.sessions) ? { ...entry.sessions } : {};
    if (typeof entry.session_id === 'string' && entry.session_id !== '' && !(entry.session_id in sessions)) sessions[entry.session_id] = String(entry.at || '');
    return sessions;
  }

  static #epochs(entry) {
    return entry && entry.epochs && typeof entry.epochs === 'object' && !Array.isArray(entry.epochs) ? entry.epochs : {};
  }

  // Only the run that said "not now" (the same session mark); an entry without a mark never counts.
  has(repositoryId, sessionId, epoch) {
    if (!repositoryId || typeof sessionId !== 'string' || sessionId === '' || !EPOCH.test(String(epoch))) return false;
    const entry = this.#read().repositories[repositoryId];
    return Object.hasOwn(NotNow.#sessions(entry), sessionId) && NotNow.#epochs(entry)[sessionId] === epoch;
  }

  set(repositoryId, sessionId, epoch) {
    const data = this.#read();
    const entry = data.repositories[repositoryId];
    const sessions = { ...NotNow.#sessions(entry), [sessionId]: this.#now().toISOString() };
    const newest = Object.entries(sessions).sort((a, b) => String(b[1]).localeCompare(String(a[1]))).slice(0, MAX_NOT_NOW_SESSIONS);
    const epochs = { ...NotNow.#epochs(entry), [sessionId]: epoch };
    data.repositories[repositoryId] = { sessions: Object.fromEntries(newest), epochs: Object.fromEntries(newest.map(([id]) => [id, epochs[id]]).filter(([, value]) => EPOCH.test(String(value)))) };
    fs.mkdirSync(path.dirname(this.#file), { recursive: true });
    const temp = `${this.#file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    try {
      fs.writeFileSync(temp, `${JSON.stringify(data)}\n`, { mode: 0o600 });
      fs.renameSync(temp, this.#file);
    } finally {
      fs.rmSync(temp, { force: true });
    }
  }
}

// The user's ok that GitHub governance is off in a git repository that is not on github.com, kept
// next to the registry (the state module reads it). Only PromptHold, from the user's own reply, and
// the terminal command write it.
class NotGitHubOk {
  #file; #now;

  constructor({ registryOptions = {}, now = () => new Date() } = {}) {
    this.#file = path.join(path.dirname(governance.registryPathFor(registryOptions)), NOT_GITHUB_BASENAME);
    this.#now = now;
  }

  set(repositoryId) {
    let parsed = null;
    try { parsed = JSON.parse(fs.readFileSync(this.#file, 'utf8')); } catch { parsed = null; }
    const usable = parsed && parsed.schema === NOT_GITHUB_SCHEMA && parsed.repositories && typeof parsed.repositories === 'object' && !Array.isArray(parsed.repositories);
    const repositories = usable ? { ...parsed.repositories } : {};
    repositories[repositoryId] = { at: this.#now().toISOString() };
    const newest = Object.entries(repositories).sort((a, b) => String(b[1] && b[1].at).localeCompare(String(a[1] && a[1].at))).slice(0, MAX_NOT_GITHUB);
    fs.mkdirSync(path.dirname(this.#file), { recursive: true });
    const temp = `${this.#file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    try {
      fs.writeFileSync(temp, `${JSON.stringify({ schema: NOT_GITHUB_SCHEMA, repositories: Object.fromEntries(newest) })}\n`, { mode: 0o600 });
      fs.renameSync(temp, this.#file);
    } finally {
      fs.rmSync(temp, { force: true });
    }
  }
}

// Records the user's ok for a repository that is not on github.com and reads it back through the
// gate (which also writes the copy). Throws GovernanceGateError unless the result is DISABLED (R8).
function writeNotGitHubOk(cwd, { registryOptions = {}, now } = {}) {
  const gate = new GovernanceGate({ registryOptions, now });
  const before = gate.evaluate(cwd, { write: false });
  if (before.state.state === 'DISABLED' && ['R2', 'R8'].includes(before.state.rule)) return before;
  if (before.state.rule !== 'R9' || !before.state.repository_id) throw new GovernanceGateError('NOT_WAITING_FOR_OK');
  new NotGitHubOk({ registryOptions, now }).set(before.state.repository_id);
  const after = gate.evaluate(cwd);
  if (after.state.state !== 'DISABLED' || after.state.rule !== 'R8' || after.state.repository_id !== before.state.repository_id) throw new GovernanceGateError('READBACK_MISMATCH');
  return after;
}

// ---- messages ---------------------------------------------------------------------------------

const ASK = "Enable Toolkit's automated GitHub tracking governance for this repository? Reply yes, no or later.";
const QUESTION = [
  'Toolkit: this repository has no governance decision yet, so your message was held and not sent.',
  ASK,
  "Toolkit takes over this repository's task tracking on GitHub and adds the no-force-push ruleset:",
  '  1. Creates PARENT and CHILD GitHub issues for programme management.',
  '  2. Records plans, reviews and decisions.',
  '  3. Uses a private evidence store of your choice.',
  '  yes    Toolkit keeps those records here; setup helps add the governed block and programme file.',
  '  no     No GitHub records here, the coding rules still apply, and Toolkit will not ask again.',
  '  later  Nothing is recorded, and Toolkit asks again next session.',
  'Your held messages stay on this computer and are handed over, in order, after you answer.',
];

function questionText(verdict, held) {
  if (held > 1) return `Toolkit: still waiting for this repository's governance decision (${held} messages held). ${ASK}`;
  const lines = [...QUESTION];
  if (verdict.state.rule === 'R6') lines.splice(1, 0, 'It carries the Toolkit governed rules block but no programme binding.');
  return lines.join('\n');
}

// Where the repository lives, for the not-on-github.com notice.
function whereText(state) {
  if (state.host) return `is on ${state.host}`;
  return state.reason === 'origin-ambiguous' ? 'has more than one origin remote' : 'has no github.com origin remote';
}

const OK_ASK = 'Reply ok to continue.';

function notGitHubText(verdict, held) {
  if (held > 1) return `Toolkit: still waiting for your ok (${held} messages held). GitHub governance will be DISABLED for this repository because it ${whereText(verdict.state)}. ${OK_ASK}`;
  return [
    'Toolkit: this repository is not on github.com, so your message was held and not sent.',
    `Toolkit's GitHub governance (GitHub issues for programme tracking, records and a private evidence store) works only for github.com repositories, and this one ${whereText(verdict.state)}.`,
    'So GitHub governance will be DISABLED here. The global rules and coding gates still apply.',
    `${OK_ASK} Toolkit records DISABLED and hands over your held messages, in order.`,
    'If this repository moves to github.com later, Toolkit asks whether to enable GitHub governance there. If a similar repository host becomes available, it can be set up then.',
  ].join('\n');
}

function unreadableText(state, registryOptions) {
  const hint = governance.repairHint(state, registryOptions);
  return `Toolkit: the governance state of this repository could not be read (${state.error_code}), so your message was held and not sent. ${hint || `Run ${terminalCommand('check')} in a terminal to see why.`}`;
}

// What the agent does in an ENABLED repository whose setup is not finished (the governed block or the
// binding is missing): right after the user's yes, and at every session start until both land.
const SETUP_ASK = 'GitHub governance setup is not finished here. Before other work, ask the user in one message: (1) the private evidence store, an existing private repository or a new `TRANSPORT-<repository>` one, separate from this repository; (2) the parent issue, an existing number or a new one; (3) confirm the defaults: record and writer prefix `INT-<SHORT>-`, required checks from the default branch protection, store branch `main`. Then use `repository-agent-rules` to add the governed block and `.github/toolkit-programme.json` in one pull request for the user to merge. If the user says not now, carry on under the global rules and ask again next session.';

function replayContext(state, prompts, { notNow = false, elsewhere = false } = {}) {
  const label = state.state === 'ENABLED' && state.materials_complete === false ? 'ENABLED (materials incomplete)' : state.state;
  const lines = [notNow
    ? 'The user answered "later" to the Toolkit GitHub governance question. Nothing is decided: for the rest of this session follow the global rules (coding gates included) without GitHub governance, and Toolkit asks again next session. If the user wants to decide sooner, they can send `toolkit governance enable` or `toolkit governance disable` as a message.'
    : state.rule === 'R8'
      ? 'Toolkit GitHub governance is now DISABLED for this repository: it is not on github.com and the user said ok. Follow the global rules, coding gates included; any TOOLKIT-GOVERNED-RULES block in AGENTS.md does not apply.'
      : elsewhere
        ? `Toolkit governance is now ${label} for this repository; it was decided outside this session.`
        : `Toolkit governance is now ${label} for this repository; the user just answered the governance question.`];
  if (!notNow && state.state === 'ENABLED' && state.materials_complete === false) lines.push(`${SETUP_ASK} Handle the held messages below after that question.`);
  if (prompts.length > 0) {
    lines.push('Messages the user sent in this session while the repository was held, oldest first. Treat them as the user\'s requests:');
    prompts.forEach((text, index) => lines.push(`${index + 1}. ${text}`));
  }
  return lines.join('\n');
}

const LAUNCHED_TEXT = 'Toolkit: an automated session cannot answer the governance question. Answer it in your own chat, or run the command in your own terminal.';
function noMarkText(commands) {
  return `Toolkit: this session started before Toolkit could note it, so it cannot take the governance answer. Start a new session and answer there, or run ${commands.map(terminalCommand).join(' or ')} in your own terminal.`;
}
const RESUMED_LINE = 'Toolkit: this session was resumed, so Toolkit asks again in this run and your reply was held.';
const LAUNCHED_HOLD_TEXT = "Toolkit: this repository is waiting for the user's governance answer, and this session was started by another session or a Toolkit launcher, so its message was not sent and not kept. The user answers in their own chat; start this again after that.";

// ---- prompt hold ------------------------------------------------------------------------------

// The host-neutral UserPromptSubmit decision: { action: 'pass' } | { action: 'pass', context } |
// { action: 'block', reason }.
class PromptHold {
  #gate; #held; #notNow; #epochs; #registryOptions; #environment; #now;

  constructor({ registryOptions = {}, environment = process.env, now = () => new Date(), stateReader = null } = {}) {
    this.#registryOptions = registryOptions;
    this.#gate = new GovernanceGate({ registryOptions, stateReader, now });
    this.#held = new HeldPrompts({ registryOptions, now });
    this.#notNow = new NotNow({ registryOptions, now });
    this.#epochs = new SessionEpochs({ registryOptions, now });
    this.#environment = environment || {};
    this.#now = now;
  }

  // sessionId is the host's session id; "not now" lasts for that session's run only.
  decide({ cwd, prompt, sessionId = null }) {
    const verdict = this.#gate.evaluate(cwd, { sessionId });
    const text = String(prompt || '');
    const answer = ANSWER.exec(text);
    // After "not now", the full answer still decides; a short reply is an ordinary message there,
    // since it may answer the agent's own question.
    if (verdict.reason === 'not-now') return answer ? this.#answer(cwd, answer[1].toLowerCase(), verdict, sessionId, this.#epochs.get(sessionId)) : { action: 'pass' };
    if (!verdict.hold) return verdict.reason === 'no-git' ? { action: 'pass' } : this.#replayIfAny(verdict.state, sessionId);
    if (verdict.reason === 'state-unreadable') return { action: 'block', reason: unreadableText(verdict.state, this.#registryOptions) };
    // A session another session or a launcher started never answers and never adds to what is held.
    if (this.#launched(sessionId)) return { action: 'block', reason: answer || OK_ANSWER.test(text) ? LAUNCHED_TEXT : LAUNCHED_HOLD_TEXT };
    const epoch = this.#epochs.get(sessionId);
    if (verdict.reason === 'not-github') return this.#notGitHub(cwd, text, answer, verdict, sessionId, epoch);
    // Only the run of the session that was shown the question answers it, in either form.
    const id = verdict.state.repository_id;
    const asked = this.#held.asked(id, sessionId, epoch);
    if (answer && asked) return this.#answer(cwd, answer[1].toLowerCase(), verdict, sessionId, epoch);
    const short = SHORT_ANSWER.exec(text);
    if (short && asked) return this.#answer(cwd, SHORT_COMMANDS[short[1].toLowerCase()], verdict, sessionId, epoch);
    const unmarked = this.#unmarked(sessionId, epoch, answer || short);
    if (unmarked) return unmarked;
    const resumed = Boolean(answer || short) && this.#held.count(id, sessionId) > 0;
    const held = this.#held.add(id, prompt, sessionId, epoch);
    if (resumed) return { action: 'block', reason: `${RESUMED_LINE}\n${questionText(verdict, 1)}` };
    // A session sees the whole question on its first held message, even when another session is waiting too.
    const shown = typeof sessionId === 'string' && sessionId !== '' ? this.#held.count(id, sessionId) : held;
    return { action: 'block', reason: questionText(verdict, shown) };
  }

  // An answer from a session the session-start hook never marked cannot count, so it is refused
  // (and not kept) with the ways that still work.
  #unmarked(sessionId, epoch, isAnswer) {
    return isAnswer && typeof sessionId === 'string' && sessionId !== '' && epoch === null ? { action: 'block', reason: noMarkText(['enable', 'disable']) } : null;
  }

  // A git repository not on github.com: the only outcome is DISABLED, once the user says ok.
  #notGitHub(cwd, text, answer, verdict, sessionId, epoch) {
    const id = verdict.state.repository_id;
    if (answer && answer[1].toLowerCase() === 'enable') {
      return { action: 'block', reason: `Toolkit: GitHub governance cannot be enabled here, because this repository ${whereText(verdict.state)}. ${OK_ASK}` };
    }
    const ok = Boolean(answer) || OK_ANSWER.test(text);
    if (ok && this.#held.asked(id, sessionId, epoch)) {
      let decided;
      try { decided = writeNotGitHubOk(cwd, { registryOptions: this.#registryOptions, now: this.#now }); } catch (error) {
        return { action: 'block', reason: `Toolkit: your ok could not be recorded (${codeOf(error)}), so this repository is still held. Reply ok again, or run ${terminalCommand('disable')} in your own terminal.` };
      }
      return { action: 'pass', context: replayContext(decided.state, this.#held.take(id, sessionId)) };
    }
    const unmarked = this.#unmarked(sessionId, epoch, ok);
    if (unmarked) return { action: 'block', reason: noMarkText(['disable']) };
    const resumed = ok && this.#held.count(id, sessionId) > 0;
    const held = this.#held.add(id, text, sessionId, epoch);
    if (resumed) return { action: 'block', reason: `${RESUMED_LINE}\n${notGitHubText(verdict, 1)}` };
    const shown = typeof sessionId === 'string' && sessionId !== '' ? this.#held.count(id, sessionId) : held;
    return { action: 'block', reason: notGitHubText(verdict, shown) };
  }

  // A session a Toolkit launcher started, or one started from another session's shell command, is
  // automation, not the user typing.
  #launched(sessionId) {
    if (LAUNCHER_MARKERS.some(name => typeof this.#environment[name] === 'string' && this.#environment[name] !== '')) return true;
    const host = this.#environment[HOST_SESSION_VARIABLE];
    return typeof host === 'string' && host !== '' && host !== sessionId;
  }

  // A decision made elsewhere (the terminal command, another clone, another session) still hands
  // this session back the prompts it sent.
  #replayIfAny(state, sessionId) {
    if (!state.repository_id || this.#launched(sessionId)) return { action: 'pass' };
    const prompts = this.#held.take(state.repository_id, sessionId);
    return prompts.length === 0 ? { action: 'pass' } : { action: 'pass', context: replayContext(state, prompts, { elsewhere: true }) };
  }

  #answer(cwd, command, verdict, sessionId, epoch = null) {
    if (this.#launched(sessionId)) return { action: 'block', reason: LAUNCHED_TEXT };
    if (command === 'not-now') {
      if (typeof sessionId !== 'string' || sessionId === '') {
        return { action: 'block', reason: `Toolkit: this app does not say which session this is, so "later" cannot be kept. ${ASK.replace(', no or later', ' or no')}` };
      }
      try { this.#notNow.set(verdict.state.repository_id, sessionId, epoch || this.#epochs.get(sessionId)); } catch (error) {
        return { action: 'block', reason: `Toolkit: "later" could not be saved (${codeOf(error)}), so this repository is still held. Reply yes or no, or try again.` };
      }
      return { action: 'pass', context: replayContext(verdict.state, this.#held.take(verdict.state.repository_id, sessionId), { notNow: true }) };
    }
    let decided;
    try {
      decided = writeGovernanceDecision(cwd, command, { registryOptions: this.#registryOptions, now: this.#now });
    } catch (error) {
      return { action: 'block', reason: `Toolkit: your answer could not be recorded (${codeOf(error)}), so nothing changed and this repository is still held. Reply again, or run ${terminalCommand(command)} in your own terminal.` };
    }
    const prompts = this.#held.take(verdict.state.repository_id, sessionId);
    return { action: 'pass', context: replayContext(decided.state, prompts) };
  }
}

// ---- tool gate --------------------------------------------------------------------------------

function toolText(input) {
  const args = input && input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  return [args.command, args.cmd, args.input, args.patch, Array.isArray(args.command) ? args.command.join(' ') : null]
    .filter(value => typeof value === 'string').join('\n');
}

function editTargets(input) {
  const args = input && input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  const targets = [args.file_path, args.path, args.notebook_path].filter(value => typeof value === 'string');
  // apply_patch carries its paths inside the patch text, which a host may pass as input, patch or command.
  const patch = [args.input, args.patch, args.command].filter(value => typeof value === 'string').join('\n');
  for (const match of patch.matchAll(/^\*\*\* (?:(?:Add|Update|Delete) File|Move to): (.+)$/gm)) targets.push(match[1].trim());
  return targets;
}

// The folders a shell command moves into (`cd`, `pushd`, `Set-Location`) or points a host at (Codex's
// `-C` or `--cd`), resolved against the tool's working directory. Best effort, like answerCommand.
const CD_TARGET = /(?:^|[;&|({\n]\s*)(?:cd|pushd|chdir|set-location|sl)(?:\s+(?:\/d|-literalpath|-path))?\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|()<>]+))/gi;
const DIR_FLAG = /(?:^|\s)(?:-C|--cd)(?:\s+|=)(?:"([^"]+)"|'([^']+)'|([^\s;&|()<>]+))/g;
function commandTargets(text, cwd) {
  const targets = [];
  for (const pattern of [CD_TARGET, DIR_FLAG]) {
    for (const match of text.matchAll(pattern)) {
      const target = match[1] ?? match[2] ?? match[3];
      if (!target || target === '-') continue;
      const expanded = /^~(?=$|[\\/])/.test(target) ? path.join(os.homedir(), target.slice(1)) : target;
      targets.push(path.resolve(cwd, expanded));
    }
  }
  return targets;
}

// Absolute paths a shell command names (`/srv/repo/AGENTS.md`, `C:\\repo\\x`, `~/repo`), the first few.
const MAX_PATH_WORDS = 16;
function absoluteTargets(text) {
  const targets = [];
  for (const match of text.matchAll(SHELL_WORD)) {
    const word = match[1] ?? match[2] ?? match[3];
    if (!word || !/^(?:\/|~(?=$|[\\/])|[A-Za-z]:[\\/]|\\\\)/.test(word)) continue;
    targets.push(word.startsWith('~') ? path.join(os.homedir(), word.slice(1)) : path.resolve(word));
    if (targets.length >= MAX_PATH_WORDS) break;
  }
  return targets;
}

// An edit tool's target as an absolute path (a leading ~ is the home folder).
function resolveTarget(input, target) {
  const expanded = /^~(?=$|[\\/])/.test(target) ? path.join(os.homedir(), target.slice(1)) : target;
  return path.resolve(String(input && input.cwd || process.cwd()), expanded);
}

// The host's session id from hook input (Claude Code and Codex both send session_id).
function sessionIdOf(input) {
  return input && typeof input.session_id === 'string' && input.session_id ? input.session_id : null;
}

// The host-neutral PreToolUse decision: null (no decision) or { deny: reason }.
class ToolGate {
  #gate; #held; #registryOptions;

  constructor({ registryOptions = {}, stateReader = null, now } = {}) {
    this.#gate = new GovernanceGate({ registryOptions, stateReader, now });
    this.#held = new HeldPrompts({ registryOptions, now });
    this.#registryOptions = registryOptions;
  }

  decide(input) {
    const tool = String(input && (input.tool_name || input.toolName) || '');
    const sessionId = sessionIdOf(input);
    if (SHELL_TOOLS.test(tool)) {
      const text = toolText(input);
      const cwd = path.resolve(String(input.cwd || process.cwd()));
      if (answerCommand(text)) {
        const notGitHub = [cwd, ...commandTargets(text, cwd)].some(target => this.#verdict(target, sessionId)?.reason === 'not-github');
        return { deny: notGitHub
          ? 'Toolkit: only the user can say ok to GitHub governance being off in a repository that is not on github.com. Ask them in chat to reply ok; Toolkit records their own reply.'
          : `Toolkit: only the user answers the governance question. Ask them in chat instead: "${ASK}" Toolkit records their own reply.` };
      }
    }
    if (EDIT_TOOLS.test(tool) && editTargets(input).some(target => USER_STATE_PATH.test(resolveTarget(input, target)))) {
      return { deny: 'Toolkit: its user-state files (governance decisions and held messages) are changed only by Toolkit itself.' };
    }
    if (READ_ONLY_TOOLS.test(tool)) return null;
    const verdict = this.#gate.evaluate(input && input.cwd, { sessionId });
    if (verdict.hold) {
      if (verdict.reason === 'state-unreadable') return { deny: `Toolkit: the governance state of this repository could not be read (${verdict.state.error_code}), so nothing runs here until it can. ${governance.repairHint(verdict.state, this.#registryOptions)}`.trim() };
      if (verdict.reason === 'not-github') return { deny: `Toolkit: this repository ${whereText(verdict.state)}, so GitHub governance will be off here, and nothing runs until the user says ok. Ask them in plain words to reply ok; Toolkit records their own reply, so never ask them to run a command, and do not try to work around it.` };
      return { deny: `Toolkit: this repository has no governance decision yet, so nothing runs here. Ask the user in plain words: "${ASK}" Toolkit records their own reply, so never ask them to run a command, and do not try to work around it.` };
    }
    // From a folder that is not held, a command or edit may still reach into one that is.
    return this.#reachesHeld(tool, input, sessionId);
  }

  #reachesHeld(tool, input, sessionId) {
    if (SHELL_TOOLS.test(tool)) {
      const text = toolText(input);
      const cwd = path.resolve(String(input.cwd || process.cwd()));
      if (HOST_RESUME.test(text) && this.#anyHeld()) {
        return { deny: "Toolkit: a repository is waiting for the user's governance answer, so no Claude or Codex session may be resumed, continued or forked from here until the user answers in their own chat." };
      }
      const targets = [...new Set([...commandTargets(text, cwd), ...absoluteTargets(text)])];
      if (targets.some(target => this.#verdict(target, sessionId)?.hold)) {
        return { deny: HOST_COMMAND.test(text)
          ? "Toolkit: this command starts a Claude or Codex session in a repository that is waiting for the user's governance answer, so it is refused. Ask the user to answer in their own chat first; do not try to work around it."
          : "Toolkit: this command works in a repository that is waiting for the user's governance answer, so it is refused. Ask the user to answer in their own chat first; do not try to work around it." };
      }
    }
    if (EDIT_TOOLS.test(tool) && editTargets(input).some(target => this.#verdict(path.dirname(resolveTarget(input, target)), sessionId)?.hold)) {
      return { deny: "Toolkit: this edit is in a repository that is waiting for the user's governance answer, so it is refused. Ask the user to answer in their own chat first; do not try to work around it." };
    }
    return null;
  }

  // The gate's verdict for a folder a command names, or null when it cannot be told.
  #verdict(target, sessionId) {
    try { return this.#gate.evaluate(target, { write: false, sessionId }); } catch { return null; }
  }

  // Whether any message is held anywhere; a store that cannot be read counts as yes.
  #anyHeld() {
    try { return this.#held.any(); } catch { return true; }
  }
}

// ---- session line -----------------------------------------------------------------------------

function sessionLine(cwd, { registryOptions = {}, stateReader = null, now, sessionId = null } = {}) {
  const verdict = new GovernanceGate({ registryOptions, stateReader, now }).evaluate(cwd, { sessionId });
  const state = verdict.state;
  if (verdict.reason === 'not-now') return 'Toolkit governance: not decided yet; the user said "later" for this session. Follow the global rules (coding gates included) without GitHub governance; Toolkit asks again next session. If the user wants to decide sooner, they can send `toolkit governance enable` or `toolkit governance disable` as a message.';
  if (verdict.hold) {
    if (verdict.reason === 'state-unreadable') return `Toolkit governance: the state of this repository could not be read (${state.error_code}). Every user message is held until it can; do not try to work around it. ${governance.repairHint(state, registryOptions)}`.trim();
    if (verdict.reason === 'not-github') return `Toolkit governance: this repository ${whereText(state)}, so GitHub governance will be DISABLED here once the user says ok. Every user message is held until then. If you need to raise it, ask the user to reply ok; Toolkit records their own reply, so never ask them to run a command, and do not try to work around it.`;
    return `Toolkit governance: this repository has no GitHub governance decision yet. Every user message is held until the user answers Toolkit's question. If you need to raise it, ask "${ASK}"; Toolkit records their own reply, so never ask them to run a command, and do not try to work around it.`;
  }
  return decidedLine(state) + (verdict.file === 'unwritable'
    ? ` (Toolkit could not save its copy in the ${repoState.FOLDER} folder (${verdict.error_code}); nothing is held because of that.)`
    : '');
}

function decidedLine(state) {
  if (state.rule === 'R1') return 'Toolkit governance: DISABLED automatically (this folder is not a git repository, so there is no GitHub governance). Follow the global rules, coding gates included.';
  if (state.rule === 'R8') return `Toolkit governance: DISABLED for this repository (not on github.com: it ${whereText(state)}; the user said ok). Follow the global rules, coding gates included; any TOOLKIT-GOVERNED-RULES block in AGENTS.md does not apply.`;
  if (state.state === 'DISABLED') return 'Toolkit governance: DISABLED for this repository (no GitHub governance). Follow the global rules, coding gates included; any TOOLKIT-GOVERNED-RULES block in AGENTS.md does not apply.';
  if (state.materials_complete === false) return `Toolkit governance: ENABLED, setup not finished (the governed block or \`.github/toolkit-programme.json\` is missing). Follow the global rules, coding gates included; GitHub governance starts once both are in the repository. ${SETUP_ASK}`;
  return 'Toolkit governance: ENABLED for this repository. Follow the global rules, coding gates included, and the TOOLKIT-GOVERNED-RULES block in AGENTS.md (GitHub governance: records and evidence).';
}

// ---- fail-closed fallbacks --------------------------------------------------------------------

// Used when the gate itself failed: inside a git repository (or when that cannot be told) it holds.
function insideRepository(cwd) {
  try { return governance.findGitRoot(typeof cwd === 'string' && cwd ? cwd : process.cwd()) !== null; } catch { return true; }
}

module.exports = Object.freeze({
  ANSWER,
  ASK,
  HOST_SESSION_VARIABLE,
  NOT_NOW_BASENAME,
  NOT_GITHUB_BASENAME,
  OK_ANSWER,
  SHORT_ANSWER,
  sessionIdOf,
  startSession,
  SESSIONS_FOLDER,
  answerCommand,
  commandTargets,
  HELD_BASENAME,
  MAX_HELD,
  MAX_HELD_CHARS,
  GovernanceGate,
  GovernanceGateError,
  HeldPrompts,
  PromptHold,
  ToolGate,
  insideRepository,
  sessionLine,
  terminalCommand,
  writeGovernanceDecision,
  writeNotGitHubOk,
});
