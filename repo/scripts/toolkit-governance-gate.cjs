'use strict';

// The hook gate for per-repository governance (owner rule of 23 Oct: a hard stop, like the
// stale-Toolkit check, that keeps stopping until the state exists). Shared by the Claude Code and
// Codex hooks:
//
//   - GovernanceGate decides whether a working directory is held. UNDECIDED (including an unreadable
//     state) is held; a plain folder (no git) never is, and neither is a decided repository. The
//     state lives only in the user-state files: nothing is written into the repository or folder.
//   - PromptHold is the UserPromptSubmit core. In a held repository every prompt is blocked and kept
//     on this computer. On github.com the block asks a plain question: enable Toolkit's GitHub
//     governance, yes, no or later ("not now" also works). In a git repository that is not on
//     github.com it says GitHub governance is off there and asks for an ok. The user's own reply is
//     the answer (`toolkit governance enable` or `disable` also work, and `decline` is the older word
//     for disable); it is recorded, read back and then let through with the held prompts attached,
//     oldest first. An answer counts only in the run of the session that was shown the question
//     (SessionEpochs). Each session gets back only the messages it sent itself, and a session another
//     session or a Toolkit launcher started is refused in a held repository and nothing is kept.
//     In Claude Code a held github.com message is not blocked but kept, and the turn runs only to show
//     a tap-to-answer card (AskUserQuestion) next to the same short text; PromptHold.picked records
//     the tapped answer under the same checks as a typed one.
//   - ToolGate is the PreToolUse core. A held repository runs no tool but the card, which must be
//     exactly Toolkit's with no answer filled in by the caller. In every
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
// A held message older than this is dropped when the store is read: its session is long gone.
const MAX_HELD_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_NOT_NOW_SESSIONS = 8;
const SESSIONS_FOLDER = 'governance-sessions.v1';
const SESSION_SCHEMA = 'toolkit.governance-session.v1';
const MAX_SESSIONS = 256;
const EPOCH = /^[0-9a-f]{32}$/;
const RESUMED_SOURCES = Object.freeze(['resume', 'fork']);
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
const HOST_SUBCOMMAND = /^\s*(?:\S*[\\/])?(?:claude|codex)(?:-code)?(?:\.exe|\.cmd|\.ps1)?\s+(?:config|mcp|plugin|plugins|update|upgrade|doctor|install|migrate-installer|setup-token|login|logout|auth|completion|features|sandbox|debug|apply|help|--version|-v|--help|-h)(?=$|\s)/i;
function answerCommand(text) {
  return /toolkit-governance\.cjs["']?\s+(?:enable|disable|decline|reopen|migrate|repair)\b/i.test(text)
    || (/\b(?:claude|codex)\b/i.test(text) && /toolkit governance (?:enable|disable|decline)\b/i.test(text))
    || (text.split(/[;&|\r\n]+/).some(part => HOST_COMMAND.test(part) && !HOST_SUBCOMMAND.test(part)) && shortAnswerWord(text));
}
// A command that resumes, continues or forks a host session (Claude Code `--resume`, `-r`,
// `--continue`, `-c`, `--session-id`; Codex `resume` or `fork`). While any message is held an agent
// may not resume one; a resume that gets past this text check is a new run and cannot answer anyway.
const HOST_RESUME = /(?:^|[\s;&|()`'"\\/])claude(?:-code)?(?:\.exe|\.cmd|\.ps1)?(?=\s)[^\n;&|]*?\s(?:--resume|-r|--continue|-c|--session-id|--fork-session)(?=$|[\s=])|(?:^|[\s;&|()`'"\\/])codex(?:\.exe|\.cmd|\.ps1)?\s+(?:exec\s+)?(?:resume|fork)(?=$|\s)/im;
const USER_STATE_PATH = /[\\/]\.ai-agent-toolkit[\\/]user-state(?:[\\/]|$)/i;
// In a held repository every tool is refused but these: ToolSearch only loads tool definitions (the
// card's among them), and AskUserQuestion runs only as Toolkit's card (ToolGate).
const ALWAYS_TOOLS = /^ToolSearch$/;
const PICKER_TOOL = 'AskUserQuestion';
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
  #stateReader; #notNow; #epochs;

  constructor({ registryOptions = {}, stateReader = null, now = () => new Date() } = {}) {
    this.#stateReader = stateReader || (cwd => governance.governanceState(cwd, registryOptions));
    this.#notNow = new NotNow({ registryOptions, now });
    this.#epochs = new SessionEpochs({ registryOptions, now });
  }

  // { hold, reason, state } where reason is one of 'no-git' (a plain folder, DISABLED
  // automatically), 'decided', 'undecided' (the github.com question), 'not-github' (a git repository
  // not on github.com, waiting for the user's ok), 'not-now' (the user said later in this run of the session)
  // or 'state-unreadable'. Only the user-state files decide, and nothing is written into the repository or folder. "Not now"
  // lasts for the run of the session that said it (its session mark).
  evaluate(cwd, { sessionId = null } = {}) {
    const state = this.#stateReader(cwd);
    const verdict = (hold, reason) => Object.freeze({ hold, reason, state });
    if (state.state === 'UNDECIDED' && state.rule === 'ERROR') return verdict(true, 'state-unreadable');
    if (state.state === 'UNDECIDED' && state.rule === 'R9') return verdict(true, 'not-github');
    if (state.state === 'UNDECIDED') return this.#notNow.has(state.repository_id, sessionId, this.#epochs.get(sessionId)) ? verdict(false, 'not-now') : verdict(true, 'undecided');
    return verdict(false, state.rule === 'R1' ? 'no-git' : 'decided');
  }
}

// ---- decision ---------------------------------------------------------------------------------

// Records the user's decision through the registry's owner-action path, then reads it back through
// the gate. Throws GovernanceGateError when the result
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

// Random marks written by the session-start hook (both hosts run it in headless runs too) and kept
// next to the registry, one small file each: one per host session and one per repository. Starting,
// resuming or forking a session gives it a new mark and gives the repository it starts in a new
// mark; /clear and compaction keep both. A held message carries both marks of the run that sent it,
// and an answer counts only when both still match, so a later process (an agent's `claude -p yes
// --resume <id>`, or `claude -pc yes`, whatever session id it reports) cannot answer for the user.
// A session with no mark (it started before the hook could record one) cannot answer in chat at
// all. Neither host's hook input says whether a run is headless or who is typing, so this is the
// signal; one process an agent feeds several messages is the known limit.
class SessionEpochs {
  #folder; #now; #registryOptions;

  constructor({ registryOptions = {}, now = () => new Date() } = {}) {
    this.#folder = path.join(path.dirname(governance.registryPathFor(registryOptions)), SESSIONS_FOLDER);
    this.#now = now;
    this.#registryOptions = registryOptions;
  }

  static #valid(key) { return typeof key === 'string' && key !== ''; }

  #file(kind, key) {
    return path.join(this.#folder, `${kind}-${crypto.createHash('sha256').update(key).digest('hex').slice(0, 32)}.json`);
  }

  #record(kind, key) {
    if (!SessionEpochs.#valid(key)) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.#file(kind, key), 'utf8'));
      return parsed && parsed.schema === SESSION_SCHEMA && EPOCH.test(parsed.epoch) ? parsed : null;
    } catch { return null; }
  }

  #read(kind, key) { return this.#record(kind, key)?.epoch ?? null; }

  // A session mark notes whether the run was a resume or a fork, which another process may have started.
  #write(kind, key, source = null) {
    const epoch = crypto.randomBytes(16).toString('hex');
    fs.mkdirSync(this.#folder, { recursive: true });
    const file = this.#file(kind, key);
    const temp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    try {
      const resumed = kind === 's' && RESUMED_SOURCES.includes(source) ? { resumed: true } : {};
      fs.writeFileSync(temp, `${JSON.stringify({ schema: SESSION_SCHEMA, epoch, at: this.#now().toISOString(), ...resumed })}\n`, { mode: 0o600 });
      fs.renameSync(temp, file);
    } finally {
      fs.rmSync(temp, { force: true });
    }
    this.#prune(kind);
    return epoch;
  }

  // This run's session mark, or null when there is none or it cannot be read.
  get(sessionId) { return this.#read('s', sessionId); }

  // Whether this run's session mark was written by a resume or a fork.
  resumed(sessionId) { return this.#record('s', sessionId)?.resumed === true; }

  // The repository's current mark, or null when no session has started in it since this version.
  repository(repositoryId) { return this.#read('r', repositoryId); }

  // Removes a mark, read-only or not; true once it is gone. A link is removed, never followed.
  #drop(kind, key) {
    const file = this.#file(kind, key);
    try {
      const stat = fs.lstatSync(file);
      if (stat.isFile() || stat.isDirectory()) fs.chmodSync(file, stat.isDirectory() ? 0o700 : 0o600);
    } catch { /* removal below decides */ }
    try { fs.rmSync(file, { force: true, recursive: true }); } catch { /* checked below */ }
    return !fs.existsSync(file);
  }

  // Records a session start and returns the session's mark. source is the hook input's: startup,
  // resume, fork, clear or compact. Anything but clear or compact starts new marks. A mark that
  // cannot be replaced fails safe: the session's mark is written first and, if it cannot be, the old
  // one is removed, so the run has none and cannot answer; the repository's mark is handled either
  // way, and one that cannot be replaced is removed, so every answer held before it is asked again.
  // A mark that can be neither replaced nor removed (a locked file, a read-only folder) is left
  // behind, so the held messages and "later" answers that carry it forget their marks instead
  // (they are in another file): no run can match them, and the question is asked again.
  start(sessionId, source, repositoryId = null) {
    if (!SessionEpochs.#valid(sessionId)) return null;
    const kept = source === 'clear' || source === 'compact';
    if (kept) {
      const mark = this.get(sessionId);
      if (mark) return mark;
    }
    let epoch = null;
    const stuck = { session: null, repository: null };
    try { epoch = this.#write('s', sessionId, source); } catch { if (!this.#drop('s', sessionId)) stuck.session = sessionId; }
    if (!kept && SessionEpochs.#valid(repositoryId)) {
      try { this.#write('r', repositoryId); } catch {
        if (!this.#drop('r', repositoryId)) {
          stuck.repository = repositoryId;
          if (epoch !== null && !this.#drop('s', sessionId)) stuck.session = sessionId;
          epoch = null;
        }
      }
    }
    if (stuck.session || stuck.repository) this.#forget(stuck);
    return epoch;
  }

  // Clears the marks that held messages and "later" answers carry for a session or a repository
  // whose old mark stays in place. Best effort: a store that cannot be written is left as it is.
  #forget(stuck) {
    for (const store of [new HeldPrompts({ registryOptions: this.#registryOptions, now: this.#now }), new NotNow({ registryOptions: this.#registryOptions, now: this.#now })]) {
      try { store.forget(stuck); } catch { /* best effort */ }
    }
  }

  // Keeps the newest few hundred of each kind; older ones are long finished.
  #prune(kind) {
    try {
      const pattern = new RegExp(`^${kind}-[0-9a-f]{32}\\.json$`);
      const names = fs.readdirSync(this.#folder).filter(name => pattern.test(name));
      if (names.length <= MAX_SESSIONS) return;
      const aged = names.map(name => {
        const file = path.join(this.#folder, name);
        try { return { file, at: fs.statSync(file).mtimeMs }; } catch { return { file, at: 0 }; }
      }).sort((a, b) => b.at - a.at);
      for (const { file } of aged.slice(MAX_SESSIONS)) fs.rmSync(file, { force: true });
    } catch { /* pruning is housekeeping only */ }
  }
}

// The session-start hook's call on both hosts: records the session's mark and refreshes the mark of
// the repository it starts in. Never throws.
function startSession(input, { registryOptions = {}, now } = {}) {
  try {
    let repositoryId = null;
    if (input && typeof input.cwd === 'string' && input.cwd && input.source !== 'clear' && input.source !== 'compact') {
      try { repositoryId = governance.governanceState(input.cwd, registryOptions).repository_id || null; } catch { repositoryId = null; }
    }
    return new SessionEpochs({ registryOptions, now }).start(sessionIdOf(input), input && input.source, repositoryId);
  } catch { return null; }
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
    if (parsed && parsed.schema === HELD_SCHEMA && parsed.repositories && typeof parsed.repositories === 'object' && !Array.isArray(parsed.repositories)) return this.#fresh(parsed);
    const aside = `${this.#file}.damaged-${this.#now().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(2).toString('hex')}`;
    try { fs.renameSync(this.#file, aside); } catch { throw new GovernanceGateError('HELD_PROMPTS_MALFORMED'); }
    return empty();
  }

  // Drops messages past the age limit (an entry without a readable time counts as old).
  #fresh(data) {
    const oldest = this.#now().getTime() - MAX_HELD_AGE_MS;
    for (const [id, list] of Object.entries(data.repositories)) {
      const kept = Array.isArray(list) ? list.filter(entry => entry && Date.parse(entry.at) >= oldest) : [];
      if (kept.length > 0) data.repositories[id] = kept; else delete data.repositories[id];
    }
    return data;
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

  // Whether this session sent a held message in this run (the same session and repository marks),
  // so this run was shown the question. marks is { session, repository }.
  asked(repositoryId, sessionId, marks) {
    const { session = null, repository = null } = marks || {};
    if (typeof sessionId !== 'string' || sessionId === '' || !EPOCH.test(String(session))) return false;
    const list = this.#read().repositories[repositoryId];
    return Array.isArray(list) && list.some(entry => entry && entry.session_id === sessionId && entry.epoch === session && (entry.repository_mark || null) === repository);
  }

  // The folders of the repositories with something held: { repositoryId: root or null }.
  heldRoots() {
    const roots = {};
    for (const [id, list] of Object.entries(this.#read().repositories)) {
      if (!Array.isArray(list) || list.length === 0) continue;
      const root = list.map(entry => entry && entry.root).find(value => typeof value === 'string' && value !== '');
      roots[id] = root || null;
    }
    return roots;
  }

  // Keeps the prompt with the session and run that sent it and the repository's folder (trimmed to
  // a size cap; the oldest go first past the count cap) and returns the number now held.
  add(repositoryId, prompt, sessionId = null, marks = {}, root = null) {
    const data = this.#read();
    const list = Array.isArray(data.repositories[repositoryId]) ? data.repositories[repositoryId] : [];
    const text = String(prompt || '').slice(0, MAX_HELD_CHARS);
    const entry = { at: this.#now().toISOString(), text };
    if (typeof sessionId === 'string' && sessionId !== '') entry.session_id = sessionId;
    const { session = null, repository = null } = marks || {};
    if (entry.session_id && EPOCH.test(String(session))) entry.epoch = session;
    if (entry.session_id && EPOCH.test(String(repository))) entry.repository_mark = repository;
    if (entry.session_id && marks && marks.resumed === true) entry.resumed = true;
    if (typeof root === 'string' && root !== '') entry.root = root;
    data.repositories[repositoryId] = [...list, entry].slice(-MAX_HELD);
    this.#write(data);
    return data.repositories[repositoryId].length;
  }

  // Returns the prompts this session sent, oldest first, and forgets them; other sessions' prompts
  // stay for those sessions. Without a session id, only prompts held without one are returned.
  // `runs` is how many runs of the session (session marks) sent them, and `resumed` whether any was
  // sent from a resumed or forked run.
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
    return Object.assign(taken.map(entry => String(entry.text || '')), { runs: new Set(taken.map(entry => entry.epoch || null)).size, resumed: taken.some(entry => entry.resumed === true) });
  }

  // Clears the session mark on the messages held for a session (in any repository), or the repository
  // mark on those held for a repository, whose old mark could not be replaced, so no run can answer
  // with them, as a new mark would (SessionEpochs.start).
  forget({ session = null, repository = null } = {}) {
    const data = this.#read();
    let changed = false;
    for (const [id, list] of Object.entries(data.repositories)) {
      for (const entry of Array.isArray(list) ? list : []) {
        if (entry && id === repository && 'repository_mark' in entry) { delete entry.repository_mark; changed = true; }
        if (entry && session !== null && entry.session_id === session && 'epoch' in entry) { delete entry.epoch; changed = true; }
      }
    }
    if (changed) this.#write(data);
  }
}

// "Not now" answers, kept next to the registry: per repository, the sessions that gave one (the
// newest few, so another session's "not now" never re-holds this one) and each one's session and
// repository marks. Nothing is decided; a new session, or the same one resumed, asks again. A
// missing, unreadable or damaged file counts as no "not now" (the repository stays held and the
// question still works), and the next "not now" replaces it.
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

  static #map(entry, field) {
    return entry && entry[field] && typeof entry[field] === 'object' && !Array.isArray(entry[field]) ? entry[field] : {};
  }

  // Only the run that said "not now" (the same session mark); an entry without a mark never counts.
  has(repositoryId, sessionId, epoch) {
    if (!repositoryId || typeof sessionId !== 'string' || sessionId === '' || !EPOCH.test(String(epoch))) return false;
    const entry = this.#read().repositories[repositoryId];
    return Object.hasOwn(NotNow.#sessions(entry), sessionId) && NotNow.#map(entry, 'epochs')[sessionId] === epoch;
  }

  // The repository mark when the session said "not now", or null.
  repositoryMark(repositoryId, sessionId) {
    const value = NotNow.#map(this.#read().repositories[repositoryId], 'repository_marks')[sessionId];
    return EPOCH.test(String(value)) ? value : null;
  }

  // Clears what a "later" carries for a session (in any repository: "later" ends, as on a resume) or a
  // repository whose old mark could not be replaced (the full answer after it is asked again), as a
  // new mark would (SessionEpochs.start).
  forget({ session = null, repository = null } = {}) {
    const data = this.#read();
    let changed = false;
    for (const [id, entry] of Object.entries(data.repositories)) {
      const epochs = NotNow.#map(entry, 'epochs'), repositoryMarks = NotNow.#map(entry, 'repository_marks');
      if (id === repository) for (const key of Object.keys(repositoryMarks)) { delete repositoryMarks[key]; changed = true; }
      if (session !== null && Object.hasOwn(epochs, session)) { delete epochs[session]; changed = true; }
    }
    if (changed) this.#save(data);
  }

  #save(data) {
    fs.mkdirSync(path.dirname(this.#file), { recursive: true });
    const temp = `${this.#file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    try {
      fs.writeFileSync(temp, `${JSON.stringify(data)}\n`, { mode: 0o600 });
      fs.renameSync(temp, this.#file);
    } finally {
      fs.rmSync(temp, { force: true });
    }
  }

  // marks is { session, repository } of the run that said it; without marks the session is removed.
  set(repositoryId, sessionId, marks = null) {
    const data = this.#read();
    const entry = data.repositories[repositoryId];
    const sessions = { ...NotNow.#sessions(entry) };
    if (marks) sessions[sessionId] = this.#now().toISOString(); else delete sessions[sessionId];
    const newest = Object.entries(sessions).sort((a, b) => String(b[1]).localeCompare(String(a[1]))).slice(0, MAX_NOT_NOW_SESSIONS);
    const epochs = { ...NotNow.#map(entry, 'epochs'), [sessionId]: marks && marks.session };
    const repositoryMarks = { ...NotNow.#map(entry, 'repository_marks'), [sessionId]: marks && marks.repository };
    const keep = values => Object.fromEntries(newest.map(([id]) => [id, values[id]]).filter(([, value]) => EPOCH.test(String(value))));
    data.repositories[repositoryId] = { sessions: Object.fromEntries(newest), epochs: keep(epochs), repository_marks: keep(repositoryMarks) };
    this.#save(data);
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
// gate. Throws GovernanceGateError unless the result is DISABLED (R8).
function writeNotGitHubOk(cwd, { registryOptions = {}, now } = {}) {
  const gate = new GovernanceGate({ registryOptions, now });
  const before = gate.evaluate(cwd);
  if (before.state.state === 'DISABLED' && ['R2', 'R8'].includes(before.state.rule)) return before;
  if (before.state.rule !== 'R9' || !before.state.repository_id) throw new GovernanceGateError('NOT_WAITING_FOR_OK');
  new NotGitHubOk({ registryOptions, now }).set(before.state.repository_id);
  const after = gate.evaluate(cwd);
  if (after.state.state !== 'DISABLED' || after.state.rule !== 'R8' || after.state.repository_id !== before.state.repository_id) throw new GovernanceGateError('READBACK_MISMATCH');
  return after;
}

// ---- messages ---------------------------------------------------------------------------------

const ASK = "Enable Toolkit's automated GitHub tracking governance for this repository? Reply yes, no or later.";
// The held-message notice: two lines here, and PromptHold.decide adds the line for agents.
const QUESTION = [
  'Toolkit: message held. Turn on GitHub governance (issues, records, evidence store) for this repository?',
  'Reply yes, no (never ask again) or later (ask next session). Held messages follow your answer.',
];

function questionText(verdict, held) {
  if (held > 1) return `Toolkit: still waiting for the governance answer (${held} messages held). Reply yes, no or later.`;
  const lines = [...QUESTION];
  if (verdict.state.rule === 'R6') lines.splice(1, 0, 'It carries the Toolkit governed rules block but no programme binding.');
  if (verdict.state.rule === 'R4') lines.splice(1, 0, 'It carries the Toolkit governed rules block and programme binding, but files in a repository are not your answer.');
  return lines.join('\n');
}

// The tap-to-answer card in Claude Code: the one AskUserQuestion input the tool gate lets through
// while a repository waits, and the answer each option records.
const PICKER_QUESTION = 'Turn on GitHub governance (issues, records, evidence store) for this repository?';
const PICKER_HEADER = 'Governance';
const PICKER_OPTIONS = Object.freeze([
  Object.freeze({ label: 'Yes', description: 'Toolkit keeps issues, records and an evidence store here; setup questions follow.' }),
  Object.freeze({ label: 'No', description: 'No GitHub records here, the coding rules still apply, and Toolkit never asks again.' }),
  Object.freeze({ label: 'Later', description: 'Nothing is recorded, and Toolkit asks again next session.' }),
]);
const PICKER_COMMANDS = Object.freeze({ Yes: 'enable', No: 'disable', Later: 'not-now' });
const PICKER_INPUT = Object.freeze({ questions: [{ question: PICKER_QUESTION, header: PICKER_HEADER, multiSelect: false, options: PICKER_OPTIONS }] });
// The keys a model's own AskUserQuestion input may carry; an answer field set by the caller is refused.
const PICKER_KEYS = Object.freeze(['questions', 'metadata']);

// Whether a tool input is exactly the card, with no answer filled in by whoever called it.
function pickerInput(toolInput) {
  if (!toolInput || typeof toolInput !== 'object' || Array.isArray(toolInput)) return false;
  if (Object.keys(toolInput).some(key => !PICKER_KEYS.includes(key))) return false;
  const questions = toolInput.questions;
  if (!Array.isArray(questions) || questions.length !== 1) return false;
  const [question] = questions;
  if (!question || typeof question !== 'object' || question.question !== PICKER_QUESTION || question.header !== PICKER_HEADER) return false;
  if (question.multiSelect !== undefined && question.multiSelect !== false) return false;
  if (Object.keys(question).some(key => !['question', 'header', 'multiSelect', 'options'].includes(key))) return false;
  const options = question.options;
  return Array.isArray(options) && options.length === PICKER_OPTIONS.length
    && options.every((option, index) => option && typeof option === 'object' && Object.keys(option).every(key => ['label', 'description'].includes(key))
      && option.label === PICKER_OPTIONS[index].label && option.description === PICKER_OPTIONS[index].description);
}

// What Claude is told on a held turn in Claude Code: show the notice as text (so it is seen where the
// card is not drawn) and the card, and do nothing else.
function pickerContext(notice) {
  return [
    'Toolkit governance: this repository has no governance decision yet, so the user\'s message above is held. Do not act on it, answer it or use any other tool: Toolkit hands it back after the user answers.',
    'Do exactly this and nothing else:',
    `1. Reply with this text, word for word:\n${notice}`,
    `2. Then call AskUserQuestion once with exactly this input, adding no answers field: ${JSON.stringify(PICKER_INPUT)}`,
    '3. Then end your turn. If the card is refused or not answered, end your turn: the user can still reply yes, no or later as a message.',
    `For agents: ${NEVER_OWNER}`,
  ].join('\n');
}
const PICKER_NOTICE = 'Toolkit: pick an answer to the governance question; your message is kept until then.';

// Where the repository lives, for the not-on-github.com notice.
function whereText(state) {
  if (state.host) return `is on ${state.host}`;
  return state.reason === 'origin-ambiguous' ? 'has more than one origin remote' : 'has no github.com origin remote';
}

const OK_ASK = 'Reply ok to continue.';
// Said to the agent wherever it meets the question: only the user answers.
const NEVER_OWNER = 'Never act as the user: do not answer the governance question yourself, start a session or script to answer it, or click a confirmation through a UI or computer use.';
// The same rule in the short form the held-message notices end with.
const NEVER_OWNER_SHORT = 'only the user answers; never answer, script or click it for them.';

function notGitHubText(verdict, held) {
  if (held > 1) return `Toolkit: still waiting for your ok (${held} messages held). ${OK_ASK}`;
  return [
    `Toolkit: message held. This repository ${whereText(verdict.state)}, so GitHub governance will be off here; the coding rules still apply.`,
    `${OK_ASK} Held messages follow your answer.`,
  ].join('\n');
}

function unreadableText(state, registryOptions) {
  const hint = governance.repairHint(state, registryOptions);
  return `Toolkit: message held. The governance state of this repository could not be read (${state.error_code}). ${hint || `Run ${terminalCommand('check')} in a terminal to see why.`}`;
}

// What the agent does in an ENABLED repository whose setup is not finished (the governed block or the
// binding is missing): right after the user's yes, and at every session start until both land.
const SETUP_ASK = 'GitHub governance setup is not finished here. Before other work, ask the user in one message: (1) the private evidence store, an existing private repository or a new `TRANSPORT-<repository>` one, separate from this repository; (2) the parent issue, an existing number or a new one; (3) confirm the defaults: record and writer prefix `INT-<SHORT>-`, required checks from the default branch protection, store branch `main`. The free security settings need no question: they are on by default and `toolkit governance security` turns them on once governance is enabled; Toolkit never turns on a GitHub feature that needs billing. Then use `repository-agent-rules` to add the governed block and `.github/toolkit-programme.json` in one pull request for the user to merge. If the user says not now, carry on under the global rules and ask again next session. Never act as the user: do not answer any of these questions yourself.';

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
    // Runs of one session share its id, so when several sent messages, or one was a resume or fork, an
    // agent's process may be among them.
    lines.push(prompts.runs > 1 || prompts.resumed
      ? 'Messages sent in this session while the repository was held, oldest first. They came from more than one run of it, or from a resumed or forked run, so another process may have sent some: confirm with the user before acting on any they did not ask for.'
      : 'Messages the user sent in this session while the repository was held, oldest first. Treat them as the user\'s requests:');
    prompts.forEach((text, index) => lines.push(`${index + 1}. ${text}`));
  }
  return lines.join('\n');
}

const LAUNCHED_TEXT = `Toolkit: an automated session cannot answer the governance question. Answer it in your own chat, or run the command in your own terminal. ${NEVER_OWNER}`;
function noMarkText(commands) {
  return `Toolkit: this session started before Toolkit could note it, so it cannot take the governance answer. Start a new session and answer there (in Codex, trust Toolkit's SessionStart hook in /hooks first, or no session can be noted), or run ${commands.map(terminalCommand).join(' or ')} in your own terminal.`;
}
const RESUMED_LINE = 'Toolkit: this session was resumed, or another session started in this repository, so Toolkit asks again and your reply was held.';
const MOVED_LINE = 'Toolkit: another session started in this repository since you said "later", so Toolkit asks again and your reply was held.';
const LAUNCHED_HOLD_TEXT = `Toolkit: this repository is waiting for the user's governance answer, and this session was started by another session or a Toolkit launcher, so its message was not sent and not kept. The user answers in their own chat; start this again after that. ${NEVER_OWNER}`;
const PICKER_UNCOUNTED = `Toolkit governance: no answer was recorded from that card, and the repository is still waiting. End your turn now without using any other tool; the user can reply yes, no or later as a message. ${NEVER_OWNER}`;

function withAgentLine(text) { return `${text}\nFor agents: ${NEVER_OWNER_SHORT}`; }

// ---- picker notes -----------------------------------------------------------------------------

// The cards the tool gate let through, one small file each next to the session marks: the call's
// tool_use_id with the session and marks of the run that made it. The answer to a call counts only
// once, and only with its note; a note older than a day is never used.
const NOTE_SCHEMA = 'toolkit.governance-picker-note.v1';
const MAX_NOTE_AGE_MS = 24 * 60 * 60 * 1000;
class PickerNotes {
  #folder; #now;

  constructor({ registryOptions = {}, now = () => new Date() } = {}) {
    this.#folder = path.join(path.dirname(governance.registryPathFor(registryOptions)), SESSIONS_FOLDER);
    this.#now = now;
  }

  #file(toolUseId) {
    return path.join(this.#folder, `q-${crypto.createHash('sha256').update(toolUseId).digest('hex').slice(0, 32)}.json`);
  }

  // marks is { session_id, session, repository }. Throws when the note cannot be written.
  note(toolUseId, marks) {
    if (typeof toolUseId !== 'string' || toolUseId === '') throw new GovernanceGateError('NO_TOOL_USE_ID');
    fs.mkdirSync(this.#folder, { recursive: true });
    const file = this.#file(toolUseId);
    const temp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    try {
      fs.writeFileSync(temp, `${JSON.stringify({ schema: NOTE_SCHEMA, tool_use_id: toolUseId, session_id: marks.session_id, session: marks.session, repository: marks.repository || null, at: this.#now().toISOString() })}\n`, { mode: 0o600 });
      fs.renameSync(temp, file);
    } finally {
      fs.rmSync(temp, { force: true });
    }
    this.#prune();
  }

  // The note for a call, removed as it is read, or null.
  take(toolUseId) {
    if (typeof toolUseId !== 'string' || toolUseId === '') return null;
    const file = this.#file(toolUseId);
    let parsed = null;
    try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { parsed = null; }
    // A note that cannot be removed could be used again, so it is not used at all.
    try { fs.rmSync(file, { force: true }); } catch { /* checked below */ }
    if (fs.existsSync(file)) return null;
    const fresh = parsed && Date.parse(parsed.at) >= this.#now().getTime() - MAX_NOTE_AGE_MS;
    return fresh && parsed.schema === NOTE_SCHEMA && parsed.tool_use_id === toolUseId && EPOCH.test(String(parsed.session)) ? parsed : null;
  }

  #prune() {
    try {
      const names = fs.readdirSync(this.#folder).filter(name => /^q-[0-9a-f]{32}\.json$/.test(name));
      if (names.length <= MAX_SESSIONS) return;
      const aged = names.map(name => {
        const file = path.join(this.#folder, name);
        try { return { file, at: fs.statSync(file).mtimeMs }; } catch { return { file, at: 0 }; }
      }).sort((a, b) => b.at - a.at);
      for (const { file } of aged.slice(MAX_SESSIONS)) fs.rmSync(file, { force: true });
    } catch { /* pruning is housekeeping only */ }
  }
}

// ---- prompt hold ------------------------------------------------------------------------------

// The host-neutral UserPromptSubmit decision: { action: 'pass' } | { action: 'pass', context } |
// { action: 'block', reason }.
class PromptHold {
  #gate; #held; #notNow; #epochs; #notes; #registryOptions; #environment; #now; #picker;

  // picker: the host can show Toolkit's tap-to-answer card (Claude Code). Then a held message in a
  // github.com repository lets the turn run with an instruction to show the card, and only the card
  // runs (ToolGate); the message stays held and comes back after the answer, as with a typed one.
  constructor({ registryOptions = {}, environment = process.env, now = () => new Date(), stateReader = null, picker = false } = {}) {
    this.#registryOptions = registryOptions;
    this.#gate = new GovernanceGate({ registryOptions, stateReader, now });
    this.#held = new HeldPrompts({ registryOptions, now });
    this.#notNow = new NotNow({ registryOptions, now });
    this.#epochs = new SessionEpochs({ registryOptions, now });
    this.#notes = new PickerNotes({ registryOptions, now });
    this.#environment = environment || {};
    this.#now = now;
    this.#picker = picker === true;
  }

  // sessionId is the host's session id; "not now" lasts for that session's run only. Whoever reads a
  // hold, the user or an agent that started the run, is also told that only the user answers.
  decide(request) {
    const result = this.#decide(request);
    return result.action === 'block' && !result.reason.endsWith(NEVER_OWNER) ? { ...result, reason: withAgentLine(result.reason) } : result;
  }

  // The card's answer, from Claude Code's PostToolUse on AskUserQuestion: { context } for Claude, or
  // null when the call was not Toolkit's card. It counts only when the tool gate let this exact call
  // through as a clean card in this run of the session that was asked, as a typed answer would.
  picked({ cwd, sessionId = null, toolUseId = null, toolResponse = null }) {
    const answers = toolResponse && typeof toolResponse === 'object' && toolResponse.answers && typeof toolResponse.answers === 'object' ? toolResponse.answers : {};
    const questions = toolResponse && Array.isArray(toolResponse.questions) ? toolResponse.questions : [];
    if (!questions.some(question => question && question.question === PICKER_QUESTION)) return null;
    const noted = this.#notes.take(toolUseId);
    // The card shown must still be exactly Toolkit's: options changed after the tool gate's check
    // (relabelled, reordered) make the answer mean something else, so it counts for nothing.
    if (!pickerInput({ questions })) return { context: PICKER_UNCOUNTED };
    const verdict = this.#gate.evaluate(cwd, { sessionId });
    if (!verdict.hold || verdict.reason !== 'undecided') return null;
    const marks = this.#marks(verdict, sessionId);
    const counts = noted !== null && !this.#launched(sessionId) && noted.session_id === sessionId && noted.session === marks.session
      && noted.repository === marks.repository && this.#held.asked(verdict.state.repository_id, sessionId, marks);
    const label = Object.hasOwn(answers, PICKER_QUESTION) ? answers[PICKER_QUESTION] : null;
    const command = typeof label === 'string' && Object.hasOwn(PICKER_COMMANDS, label) ? PICKER_COMMANDS[label] : null;
    if (!counts || command === null) return { context: PICKER_UNCOUNTED };
    const result = this.#answer(cwd, command, verdict, sessionId, marks);
    return { context: result.action === 'pass' ? result.context : `Tell the user this, word for word, then end your turn: ${result.reason}${result.reason.endsWith(NEVER_OWNER) ? '' : `\n${NEVER_OWNER}`}` };
  }

  // The notice for a held message: the card where the host can show it to this run, else the text.
  #ask(text, sessionId, marks) {
    if (!this.#picker || typeof sessionId !== 'string' || sessionId === '' || !marks || !EPOCH.test(String(marks.session))) return { action: 'block', reason: text };
    return { action: 'pass', context: pickerContext(withAgentLine(text)), notice: PICKER_NOTICE };
  }

  #decide({ cwd, prompt, sessionId = null }) {
    const verdict = this.#gate.evaluate(cwd, { sessionId });
    const text = String(prompt || '');
    const answer = ANSWER.exec(text);
    // After "not now", the full answer still decides in the same run, unless a session has started in
    // the repository since; a short reply is an ordinary message there, since it may answer the
    // agent's own question.
    if (verdict.reason === 'not-now') return answer ? this.#afterNotNow(cwd, answer, verdict, sessionId) : { action: 'pass' };
    if (!verdict.hold) return verdict.reason === 'no-git' ? { action: 'pass' } : this.#replayIfAny(verdict.state, sessionId);
    if (verdict.reason === 'state-unreadable') return { action: 'block', reason: unreadableText(verdict.state, this.#registryOptions) };
    // A session another session or a launcher started never answers and never adds to what is held.
    if (this.#launched(sessionId)) return { action: 'block', reason: answer || OK_ANSWER.test(text) ? LAUNCHED_TEXT : LAUNCHED_HOLD_TEXT };
    const marks = this.#marks(verdict, sessionId);
    if (verdict.reason === 'not-github') return this.#notGitHub(cwd, text, answer, verdict, sessionId, marks);
    // Only the run of the session that was shown the question answers it, in either form.
    const id = verdict.state.repository_id;
    const asked = this.#held.asked(id, sessionId, marks);
    if (answer && asked) return this.#answer(cwd, answer[1].toLowerCase(), verdict, sessionId, marks);
    const short = SHORT_ANSWER.exec(text);
    if (short && asked) return this.#answer(cwd, SHORT_COMMANDS[short[1].toLowerCase()], verdict, sessionId, marks);
    const unmarked = this.#unmarked(sessionId, marks, answer || short);
    if (unmarked) return unmarked;
    const resumed = Boolean(answer || short) && this.#held.count(id, sessionId) > 0;
    const held = this.#held.add(id, prompt, sessionId, marks, verdict.state.root);
    if (resumed) return this.#ask(`${RESUMED_LINE}\n${questionText(verdict, 1)}`, sessionId, marks);
    // A session sees the whole question on its first held message, even when another session is waiting too.
    const shown = typeof sessionId === 'string' && sessionId !== '' ? this.#held.count(id, sessionId) : held;
    return this.#ask(questionText(verdict, shown), sessionId, marks);
  }

  // An answer from a session the session-start hook never marked cannot count, so it is refused
  // (and not kept) with the ways that still work.
  #unmarked(sessionId, marks, isAnswer) {
    return isAnswer && typeof sessionId === 'string' && sessionId !== '' && marks.session === null ? { action: 'block', reason: noMarkText(['enable', 'disable']) } : null;
  }

  // This run's marks: the session's own and the repository's, and whether the run was a resume or fork.
  #marks(verdict, sessionId) {
    return { session: this.#epochs.get(sessionId), repository: this.#epochs.repository(verdict.state.repository_id), resumed: this.#epochs.resumed(sessionId) };
  }

  // The full answer after "not now": it counts in the run that said it while no session has started
  // in the repository since; otherwise "not now" ends for this session and Toolkit asks again.
  #afterNotNow(cwd, answer, verdict, sessionId) {
    const marks = this.#marks(verdict, sessionId);
    const id = verdict.state.repository_id;
    if (this.#notNow.repositoryMark(id, sessionId) === marks.repository) return this.#answer(cwd, answer[1].toLowerCase(), verdict, sessionId, marks);
    try { this.#notNow.set(id, sessionId, null); } catch { /* the reply is held below either way */ }
    this.#held.add(id, answer[0], sessionId, marks, verdict.state.root);
    return this.#ask(`${MOVED_LINE}\n${questionText(verdict, 1)}`, sessionId, marks);
  }

  // A git repository not on github.com: the only outcome is DISABLED, once the user says ok.
  #notGitHub(cwd, text, answer, verdict, sessionId, marks) {
    const id = verdict.state.repository_id;
    if (answer && answer[1].toLowerCase() === 'enable') {
      return { action: 'block', reason: `Toolkit: GitHub governance cannot be enabled here, because this repository ${whereText(verdict.state)}. ${OK_ASK}` };
    }
    const ok = Boolean(answer) || OK_ANSWER.test(text);
    if (ok && this.#held.asked(id, sessionId, marks)) {
      let decided;
      try { decided = writeNotGitHubOk(cwd, { registryOptions: this.#registryOptions, now: this.#now }); } catch (error) {
        return { action: 'block', reason: `Toolkit: your ok could not be recorded (${codeOf(error)}), so this repository is still held. Reply ok again, or run ${terminalCommand('disable')} in your own terminal.` };
      }
      return { action: 'pass', context: replayContext(decided.state, this.#held.take(id, sessionId)) };
    }
    const unmarked = this.#unmarked(sessionId, marks, ok);
    if (unmarked) return { action: 'block', reason: noMarkText(['disable']) };
    const resumed = ok && this.#held.count(id, sessionId) > 0;
    const held = this.#held.add(id, text, sessionId, marks, verdict.state.root);
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

  #answer(cwd, command, verdict, sessionId, marks) {
    if (this.#launched(sessionId)) return { action: 'block', reason: LAUNCHED_TEXT };
    if (command === 'not-now') {
      if (typeof sessionId !== 'string' || sessionId === '') {
        return { action: 'block', reason: `Toolkit: this app does not say which session this is, so "later" cannot be kept. ${ASK.replace(', no or later', ' or no')}` };
      }
      try { this.#notNow.set(verdict.state.repository_id, sessionId, marks); } catch (error) {
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
  #gate; #held; #epochs; #notes; #registryOptions;

  constructor({ registryOptions = {}, stateReader = null, now } = {}) {
    this.#gate = new GovernanceGate({ registryOptions, stateReader, now });
    this.#held = new HeldPrompts({ registryOptions, now });
    this.#epochs = new SessionEpochs({ registryOptions, now });
    this.#notes = new PickerNotes({ registryOptions, now });
    this.#registryOptions = registryOptions;
  }

  // AskUserQuestion in a repository waiting for its github.com answer runs only as Toolkit's own
  // card, with no answer filled in by the caller, from a run that can answer; the call is noted so
  // the answer that comes back (PromptHold.picked) is known to come from that card.
  #picker(input, sessionId) {
    const verdict = this.#gate.evaluate(input && input.cwd, { sessionId });
    if (!verdict.hold) return null;
    const refused = { deny: `Toolkit: while this repository waits for the governance answer, AskUserQuestion runs only as Toolkit's own card, exactly as given and with no answer filled in. End your turn; the user can reply yes, no or later as a message. ${NEVER_OWNER}` };
    if (verdict.reason !== 'undecided' || !pickerInput(input.tool_input)) return refused;
    const toolUseId = input.tool_use_id;
    const marks = { session: this.#epochs.get(sessionId), repository: this.#epochs.repository(verdict.state.repository_id) };
    if (typeof sessionId !== 'string' || sessionId === '' || !EPOCH.test(String(marks.session))) return refused;
    try { this.#notes.note(toolUseId, { session_id: sessionId, ...marks }); } catch { return refused; }
    return null;
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
          ? `Toolkit: only the user can say ok to GitHub governance being off in a repository that is not on github.com. Ask them in chat to reply ok; Toolkit records their own reply. ${NEVER_OWNER}`
          : `Toolkit: only the user answers the governance question. Ask them in chat instead: "${ASK}" Toolkit records their own reply. ${NEVER_OWNER}` };
      }
    }
    if (EDIT_TOOLS.test(tool) && editTargets(input).some(target => USER_STATE_PATH.test(resolveTarget(input, target)))) {
      return { deny: `Toolkit: its user-state files (governance decisions and held messages) are changed only by Toolkit itself. ${NEVER_OWNER}` };
    }
    if (tool === PICKER_TOOL) return this.#picker(input, sessionId);
    if (ALWAYS_TOOLS.test(tool)) return null;
    // Read-only tools are held too: Claude Code lets a held turn run to show the card, with the held
    // message in front of Claude, and only the card runs on it.
    const verdict = this.#gate.evaluate(input && input.cwd, { sessionId });
    if (verdict.hold) {
      if (verdict.reason === 'state-unreadable') return { deny: [`Toolkit: the governance state of this repository could not be read (${verdict.state.error_code}), so nothing runs here until it can.`, governance.repairHint(verdict.state, this.#registryOptions), NEVER_OWNER].filter(Boolean).join(' ') };
      if (verdict.reason === 'not-github') return { deny: `Toolkit: this repository ${whereText(verdict.state)}, so GitHub governance will be off here, and nothing runs until the user says ok. Ask them in plain words to reply ok; Toolkit records their own reply, so never ask them to run a command, and do not try to work around it. ${NEVER_OWNER}` };
      return { deny: `Toolkit: this repository has no governance decision yet, so nothing runs here. Ask the user in plain words: "${ASK}" Toolkit records their own reply, so never ask them to run a command, and do not try to work around it. ${NEVER_OWNER}` };
    }
    // From a folder that is not held, a command or edit may still reach into one that is.
    return this.#reachesHeld(tool, input, sessionId);
  }

  #reachesHeld(tool, input, sessionId) {
    if (SHELL_TOOLS.test(tool)) {
      const text = toolText(input);
      const cwd = path.resolve(String(input.cwd || process.cwd()));
      if (HOST_RESUME.test(text) && this.#anyHeld()) {
        return { deny: `Toolkit: a message is held for a repository's governance answer, so no Claude or Codex session may be resumed, continued or forked from here until the user answers in their own chat. ${NEVER_OWNER}` };
      }
      const targets = [...new Set([...commandTargets(text, cwd), ...absoluteTargets(text)])];
      if (targets.some(target => this.#verdict(target, sessionId)?.hold)) {
        return { deny: `${HOST_COMMAND.test(text)
          ? "Toolkit: this command starts a Claude or Codex session in a repository that is waiting for the user's governance answer, so it is refused."
          : "Toolkit: this command works in a repository that is waiting for the user's governance answer, so it is refused."} Ask the user to answer in their own chat first; do not try to work around it. ${NEVER_OWNER}` };
      }
    }
    if (EDIT_TOOLS.test(tool) && editTargets(input).some(target => this.#verdict(path.dirname(resolveTarget(input, target)), sessionId)?.hold)) {
      return { deny: `Toolkit: this edit is in a repository that is waiting for the user's governance answer, so it is refused. Ask the user to answer in their own chat first; do not try to work around it. ${NEVER_OWNER}` };
    }
    return null;
  }

  // The gate's verdict for a folder a command names, or null when it cannot be told.
  #verdict(target, sessionId) {
    try { return this.#gate.evaluate(target, { sessionId }); } catch { return null; }
  }

  // Whether a message is held for a repository that is still waiting for its answer (one decided
  // since no longer counts); a store that cannot be read, or an entry without its folder, counts as yes.
  #anyHeld() {
    let roots;
    try { roots = this.#held.heldRoots(); } catch { return true; }
    return Object.values(roots).some(root => root === null || this.#verdict(root, null)?.hold !== false);
  }
}

// ---- session line -----------------------------------------------------------------------------

function sessionLine(cwd, { registryOptions = {}, stateReader = null, now, sessionId = null } = {}) {
  const verdict = new GovernanceGate({ registryOptions, stateReader, now }).evaluate(cwd, { sessionId });
  const state = verdict.state;
  if (verdict.reason === 'not-now') return 'Toolkit governance: not decided yet; the user said "later" for this session. Follow the global rules (coding gates included) without GitHub governance; Toolkit asks again next session. If the user wants to decide sooner, they can send `toolkit governance enable` or `toolkit governance disable` as a message.';
  if (verdict.hold) {
    if (verdict.reason === 'state-unreadable') return [`Toolkit governance: the state of this repository could not be read (${state.error_code}). Every user message is held until it can; do not try to work around it.`, governance.repairHint(state, registryOptions), NEVER_OWNER].filter(Boolean).join(' ');
    if (verdict.reason === 'not-github') return `Toolkit governance: this repository ${whereText(state)}, so GitHub governance will be DISABLED here once the user says ok. Every user message is held until then. If you need to raise it, ask the user to reply ok; Toolkit records their own reply, so never ask them to run a command, and do not try to work around it. ${NEVER_OWNER}`;
    return `Toolkit governance: this repository has no GitHub governance decision yet. Every user message is held until the user answers Toolkit's question. If you need to raise it, ask "${ASK}"; Toolkit records their own reply, so never ask them to run a command, and do not try to work around it. ${NEVER_OWNER}`;
  }
  return decidedLine(state);
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
  NEVER_OWNER,
  NEVER_OWNER_SHORT,
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
  PICKER_INPUT,
  PICKER_QUESTION,
  pickerInput,
});
