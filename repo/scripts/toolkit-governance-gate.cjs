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
//     the tapped answer under the same checks as a typed one. Any other message of the user's own in
//     the run that was shown the question (a Projects thread reply, with the app's notes set aside,
//     or bare text with no tags) is kept too and goes to the agent with a one-use reply ticket
//     (ReplyTickets, owner decision of 28 Oct): the agent reads what the user means and records it
//     with toolkit-governance-answer.cjs, asks again when it is unclear, or, when unsure, has the user
//     confirm one named answer, whose reply can record only that answer.
//   - ToolGate is the PreToolUse core. A held repository runs no tool but the card, which must be
//     exactly Toolkit's with no answer filled in by the caller, and the exact answer command with
//     the session's live reply ticket. In every
//     folder, an agent may not answer the question for the user: commands that run the governance
//     CLI or start a host session with the answer as its prompt are refused, and so are edits to
//     Toolkit's user-state files. A command that starts a host session in a held repository (after
//     `cd`, or with Codex's `-C`) is refused too. From a plain folder or a decided repository, a
//     command or edit that reaches github.com repositories waiting for their answer is refused with
//     Toolkit's question naming them (ReachAsks), and the user's reply in that run answers for every
//     repository listed (PromptHold): the full answer at once, a bare yes, no or later only after the
//     agent asks once more naming what would be recorded, and the user's reply to that only through
//     a ticket for that one answer. While that question is open its list is fixed and no new prompt
//     can be scheduled for the session.
//   - sessionLine is the one SessionStart line that states the effective state.
//
// Every failure inside a git repository holds (fail closed). Held prompts never leave this computer
// and are never printed to logs.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const governance = require('./toolkit-governance-state.cjs');
const { ContinuationResolver } = require('./toolkit-governance-continuation.cjs');

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
// Any other message of the user's own in that run goes to the agent to read, with a reply ticket
// (ReplyTickets).
const SHORT_ANSWER = /^\s*(yes|y|no|n|not now|later)[.!]?\s*$/i;
const SHORT_COMMANDS = Object.freeze({ yes: 'enable', y: 'enable', no: 'disable', n: 'disable', 'not now': 'not-now', later: 'not-now' });
// The replies that say ok to GitHub governance being off in a repository that is not on github.com.
// Every one of them has the same effect, so a plain "yes" or "no" works too.
const OK_ANSWER = /^\s*(ok|okay|yes|y|no|n|not now|later)[.!]?\s*$/i;
// The reply the answers above are read from. Claude Code and Codex hand the hook what the user typed,
// bare. A Claude Projects thread hands a Remote Control session each message the user sends there
// wrapped in one `<wake>` envelope; the user's own words are the one message in it marked as the
// trigger, from a human the session works for. Anything else in an envelope (a coordinator's relay
// of the user's words, a scheduled task, another person, extra text, a broken envelope) reads as
// no reply at all, so it never answers.
const WAKE = /^\s*<wake(?:\s+[\w-]+="[^"<>]*")*\s*>([\s\S]*)<\/wake>\s*$/;
// The envelope's body is only `project` and `thread` tags and `message` elements whose text holds no
// markup but the host's `attachment` elements (a file or image the person sent); it is matched whole,
// as sent, so no other tag inside a message is ever read as part of the frame. The host may end the
// envelope with `system-note` elements of its own, after the frame and holding no markup: they are
// set aside first and never read as the reply.
const WAKE_ATTRIBUTES = '(?:\\s+[\\w-]+="[^"<>]*")*';
const WAKE_ATTACHMENT = `<attachment${WAKE_ATTRIBUTES}\\s*(?:\\/>|>\\s*<\\/attachment>)`;
const WAKE_INNER = `[^<]*(?:${WAKE_ATTACHMENT}[^<]*)*`;
const WAKE_NOTE = new RegExp(`^<system-note${WAKE_ATTRIBUTES}\\s*>[^<]*<\\/system-note>$`);
function withoutNotes(body) {
  let rest = body.trimEnd();
  while (rest.endsWith('</system-note>')) {
    const start = rest.lastIndexOf('<system-note');
    if (start < 0 || !WAKE_NOTE.test(rest.slice(start))) break;
    rest = rest.slice(0, start).trimEnd();
  }
  return rest;
}
const WAKE_BODY = new RegExp(`^\\s*(?:(?:<\\/?(?:project|thread)${WAKE_ATTRIBUTES}\\s*>|<message${WAKE_ATTRIBUTES}\\s*>${WAKE_INNER}<\\/message>)\\s*)+$`);
const WAKE_MESSAGE = new RegExp(`<message(${WAKE_ATTRIBUTES})\\s*>(${WAKE_INNER})<\\/message>`, 'g');
function ownerReply(prompt) { return ownerMessage(prompt).text; }
// The reply with where it came from: { text, id, wrapped, markup }. id is the thread message's id, or
// null for bare text; wrapped says the text came from a Projects envelope, and markup that bare text
// carries tags (a relay, a reminder or another wrapped message), so it is not the user typing.
const ANY_TAG = /<\/?[A-Za-z][\w-]*(?:\s[^<>]*)?\/?>/;
// Whether a message is the user's own words that a reply ticket may be given for: the trigger
// message of a Projects envelope from the person the session works for, or bare text with no tags
// (a coordinator's relay, a reminder or a scheduled task is never one).
function ownTyped(message) { return message.text.trim() !== '' && (message.wrapped || !message.markup); }
function ownerMessage(prompt) {
  const text = String(prompt || '');
  const wake = WAKE.exec(text);
  if (!wake) return { text, id: null, wrapped: false, markup: ANY_TAG.test(text) };
  const none = { text: '', id: null, wrapped: true, markup: false };
  const body = withoutNotes(wake[1]);
  if (!WAKE_BODY.test(body)) return none;
  const messages = [...body.matchAll(WAKE_MESSAGE)].map(([, attributes, inner]) => ({
    attributes: [...attributes.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, name, value]) => [name, value]),
    inner,
  }));
  // An attribute given twice could say two things; such a message is read as no reply.
  if (messages.some(message => new Set(message.attributes.map(([name]) => name)).size !== message.attributes.length)) return none;
  for (const message of messages) message.attributes = Object.fromEntries(message.attributes);
  const triggers = messages.filter(message => message.attributes.trigger === 'true');
  if (triggers.length !== 1 || triggers[0].attributes.from !== 'human' || triggers[0].attributes.trust !== 'principal') return none;
  // A message that carries a file or image is not a typed reply, whatever text is beside it.
  if (triggers[0].attributes['has-attachments'] !== undefined || triggers[0].inner.includes('<')) return none;
  const reply = triggers[0].inner.replace(/&(lt|gt|quot|#39|apos|amp);/g, (_, name) => ({ lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", amp: '&' })[name]);
  const id = typeof triggers[0].attributes.id === 'string' && triggers[0].attributes.id !== '' ? triggers[0].attributes.id : null;
  return { text: reply, id, wrapped: true, markup: false };
}
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
const USER_STATE_PATH = /[\\/]\.ai-agent-toolkit[\\/]user-state(?:[\\/]|$)/i;
// In a held repository every tool is refused but these: ToolSearch only loads tool definitions (the
// card's among them), and AskUserQuestion runs only as Toolkit's card (ToolGate).
const ALWAYS_TOOLS = /^ToolSearch$/;
const PICKER_TOOL = 'AskUserQuestion';
const EDIT_TOOLS = /^(?:Edit|Write|MultiEdit|NotebookEdit|apply_patch)$/;
const SHELL_TOOLS = /^(?:Bash|PowerShell|Monitor|exec_command|shell|local_shell)$/;
// Tools that schedule a prompt for the session itself.
const SCHEDULE_TOOLS = /^(?:CronCreate|ScheduleWakeup|RemoteTrigger)$/;

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

  // When this run began (its session mark was written), or null.
  startedAt(sessionId) {
    const at = Date.parse(this.#record('s', sessionId)?.at);
    return Number.isFinite(at) ? at : null;
  }

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
// the repository it starts in, after refreshing this computer's read of the binding merged on that
// repository's default branch (bounded; offline keeps the last read). Never throws. `refreshBinding`
// is for tests; a test registry or test run never reaches the network (refreshMergedBinding).
function startSession(input, { registryOptions = {}, now, refreshBinding = null } = {}) {
  try {
    let repositoryId = null;
    if (input && typeof input.cwd === 'string' && input.cwd && input.source !== 'clear' && input.source !== 'compact') {
      // The one place a hook reads the network: the merged binding, bounded, into this computer's cache.
      try { (refreshBinding || governance.refreshMergedBinding)(input.cwd, registryOptions); } catch { /* offline keeps the last read */ }
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

  // The number held for the repository that this run of the session sent (its session mark).
  countRun(repositoryId, sessionId, epoch) {
    const list = this.#read().repositories[repositoryId];
    if (!Array.isArray(list) || typeof sessionId !== 'string' || sessionId === '') return 0;
    return list.filter(entry => entry && entry.session_id === sessionId && (entry.epoch || null) === (EPOCH.test(String(epoch)) ? epoch : null)).length;
  }

  // Whether this session sent a held message in this run (the same session and repository marks),
  // so this run was shown the question. marks is { session, repository }.
  asked(repositoryId, sessionId, marks) {
    const { session = null, repository = null } = marks || {};
    if (typeof sessionId !== 'string' || sessionId === '' || !EPOCH.test(String(session))) return false;
    const list = this.#read().repositories[repositoryId];
    return Array.isArray(list) && list.some(entry => entry && entry.session_id === sessionId && entry.epoch === session && (entry.repository_mark || null) === repository);
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

  // Whether this run of the session said "not now" for any repository, so the question is still open
  // for it there.
  anyFor(sessionId, epoch) {
    if (typeof sessionId !== 'string' || sessionId === '' || !EPOCH.test(String(epoch))) return false;
    return Object.values(this.#read().repositories).some(entry => Object.hasOwn(NotNow.#sessions(entry), sessionId) && NotNow.#map(entry, 'epochs')[sessionId] === epoch);
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

// The governance question asked from a folder that is not held (a plain parent folder, or a decided
// repository) because a command or edit there reached repositories that are: per session, the run
// that was asked (its session mark) and each repository with its folder and its mark at the time.
// One question covers every repository listed, and the user's next exact reply in that run answers
// for all of them (PromptHold). Kept next to the registry; a missing, unreadable or damaged file
// counts as nothing asked, so the question is asked again.
const REACH_ASKS_BASENAME = 'governance-reach-asks.v1.json';
const REACH_ASKS_SCHEMA = 'toolkit.governance-reach-asks.v1';
const MAX_REACH_SESSIONS = 32;
const MAX_REACH_REPOSITORIES = 16;
const MAX_REACH_AGE_MS = 24 * 60 * 60 * 1000;
class ReachAsks {
  #file; #now;

  constructor({ registryOptions = {}, now = () => new Date() } = {}) {
    this.#file = path.join(path.dirname(governance.registryPathFor(registryOptions)), REACH_ASKS_BASENAME);
    this.#now = now;
  }

  #read() {
    let parsed = null;
    try { parsed = JSON.parse(fs.readFileSync(this.#file, 'utf8')); } catch { parsed = null; }
    const usable = parsed && parsed.schema === REACH_ASKS_SCHEMA && parsed.sessions && typeof parsed.sessions === 'object' && !Array.isArray(parsed.sessions);
    return usable ? parsed : { schema: REACH_ASKS_SCHEMA, sessions: {} };
  }

  #save(data) {
    const oldest = this.#now().getTime() - MAX_REACH_AGE_MS;
    const kept = Object.entries(data.sessions).filter(([, entry]) => entry && Date.parse(entry.at) >= oldest)
      .sort((a, b) => String(b[1].at).localeCompare(String(a[1].at))).slice(0, MAX_REACH_SESSIONS);
    if (kept.length === 0) { fs.rmSync(this.#file, { force: true }); return; }
    fs.mkdirSync(path.dirname(this.#file), { recursive: true });
    const temp = `${this.#file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    try {
      fs.writeFileSync(temp, `${JSON.stringify({ schema: REACH_ASKS_SCHEMA, sessions: Object.fromEntries(kept) })}\n`, { mode: 0o600 });
      fs.renameSync(temp, this.#file);
    } finally {
      fs.rmSync(temp, { force: true });
    }
  }

  // The repositories asked about in this run of the session, oldest first: [{ id, root, mark }].
  get(sessionId, epoch) {
    if (typeof sessionId !== 'string' || sessionId === '' || !EPOCH.test(String(epoch))) return [];
    const entry = this.#read().sessions[sessionId];
    if (!entry || entry.epoch !== epoch || Date.parse(entry.at) < this.#now().getTime() - MAX_REACH_AGE_MS || !Array.isArray(entry.repositories)) return [];
    return entry.repositories.filter(item => item && typeof item.id === 'string' && item.id !== '' && typeof item.root === 'string' && path.isAbsolute(item.root));
  }

  // Adds repositories to this run's question and returns the whole list now asked. Throws when the
  // file cannot be written.
  add(sessionId, epoch, repositories) {
    const data = this.#read();
    const list = [...this.get(sessionId, epoch)];
    for (const item of repositories) {
      if (!list.some(known => known.id === item.id)) list.push({ id: item.id, root: item.root, mark: EPOCH.test(String(item.mark)) ? item.mark : null });
    }
    data.sessions[sessionId] = { epoch, at: this.#now().toISOString(), repositories: list.slice(-MAX_REACH_REPOSITORIES) };
    this.#save(data);
    return data.sessions[sessionId].repositories;
  }

  // Forgets this session's question; true once it is gone.
  clear(sessionId) {
    const data = this.#read();
    if (!Object.hasOwn(data.sessions, sessionId)) return true;
    delete data.sessions[sessionId];
    this.#save(data);
    return !Object.hasOwn(this.#read().sessions, sessionId);
  }
}

// Reply tickets (owner decision of 28 Oct: the agent reads what the user means, Toolkit only checks
// it is the user's own reply). When the user's own message arrives in a run that was shown the
// question and is not one of the exact answers, Toolkit hands that message to the agent with a
// one-use ticket bound to the session, the run, the message and the repositories asked about. The
// agent records the answer it read with toolkit-governance-answer.cjs and the ticket; the ticket is
// spent on first use, only the newest one per session counts, it lapses after half an hour, and one
// thread message never gets a second ticket. Kept next to the registry, the ticket itself hashed.
//
// A confirmation is the same store's other kind of entry: when the agent records `confirm-<answer>`
// with a ticket (because it is unsure, or because a bare yes, no or later from a folder that is not
// held got a ticket that can only start the confirmation of that word), the session gets a pending
// confirmation of exactly one answer, and any live ticket of the session is dropped. The user's next
// own message in that run is then read only as a reply to that question: its ticket records that
// one answer or nothing, and the pending confirmation ends with it. A pending confirmation is kept
// for its run, up to the seven days held messages are kept, and never pushed out by other sessions'
// tickets. A damaged store is moved aside, and the new one notes when, so a run that began before
// then cannot rely on a confirmation it may have lost.
const TICKETS_BASENAME = 'governance-reply-tickets.v1.json';
const TICKETS_SCHEMA = 'toolkit.governance-reply-tickets.v1';
const TICKET = /^[0-9a-f]{32}$/;
const MAX_TICKET_AGE_MS = 30 * 60 * 1000;
const MAX_TICKET_SESSIONS = 32;
const MAX_USED_MESSAGES = 256;
const ANSWER_SCRIPT = path.join(__dirname, 'toolkit-governance-answer.cjs');
const ANSWER_WORDS = Object.freeze({ yes: 'enable', no: 'disable', later: 'not-now' });
const COMMAND_WORDS = Object.freeze({ enable: 'yes', disable: 'no', 'not-now': 'later' });
function ticketHash(ticket) { return crypto.createHash('sha256').update(String(ticket)).digest('hex'); }
class ReplyTickets {
  #file; #now;

  constructor({ registryOptions = {}, now = () => new Date() } = {}) {
    this.#file = path.join(path.dirname(governance.registryPathFor(registryOptions)), TICKETS_BASENAME);
    this.#now = now;
  }

  // A store that is missing is empty, and one that cannot be read throws, so a pending confirmation
  // is never silently lost (the callers hold). A damaged one is moved aside, kept on this computer
  // next to the original, and a fresh store notes the time (reset_at).
  #read() {
    let text;
    try { text = fs.readFileSync(this.#file, 'utf8'); } catch (error) {
      if (error && error.code === 'ENOENT') return { schema: TICKETS_SCHEMA, sessions: {}, used: [] };
      throw new GovernanceGateError('REPLY_TICKETS_UNREADABLE');
    }
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    const usable = parsed && parsed.schema === TICKETS_SCHEMA && parsed.sessions && typeof parsed.sessions === 'object' && !Array.isArray(parsed.sessions) && Array.isArray(parsed.used);
    return usable ? parsed : this.reset();
  }

  // Moves the store aside and starts a fresh one that notes when; returns the fresh store. Throws
  // when either step fails.
  reset() {
    const aside = `${this.#file}.damaged-${this.#now().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(2).toString('hex')}`;
    try { fs.renameSync(this.#file, aside); } catch (error) { if (!error || error.code !== 'ENOENT') throw new GovernanceGateError('REPLY_TICKETS_MALFORMED'); }
    const fresh = { schema: TICKETS_SCHEMA, sessions: {}, used: [], reset_at: this.#now().toISOString() };
    this.#save(fresh);
    return fresh;
  }

  // When the store was last moved aside, or null.
  resetAt() {
    const at = Date.parse(this.#read().reset_at);
    return Number.isFinite(at) ? at : null;
  }

  // Whether an entry is still kept: a ticket for half an hour, a pending confirmation for as long as
  // held messages are kept (it ends with its run, a reply or a full answer, not with time).
  #current(entry) {
    if (!entry || typeof entry !== 'object') return false;
    const age = this.#now().getTime() - Date.parse(entry.at);
    return age <= (Object.hasOwn(entry, 'pending') ? MAX_HELD_AGE_MS : MAX_TICKET_AGE_MS);
  }

  // Keeps every current pending confirmation, and the newest tickets up to the cap.
  #save(data) {
    const current = Object.entries(data.sessions).filter(([, entry]) => this.#current(entry));
    const pending = current.filter(([, entry]) => Object.hasOwn(entry, 'pending'));
    const tickets = current.filter(([, entry]) => !Object.hasOwn(entry, 'pending'))
      .sort((a, b) => String(b[1].at).localeCompare(String(a[1].at))).slice(0, MAX_TICKET_SESSIONS);
    const sessions = [...pending, ...tickets];
    fs.mkdirSync(path.dirname(this.#file), { recursive: true });
    const temp = `${this.#file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    try {
      const reset = typeof data.reset_at === 'string' ? { reset_at: data.reset_at } : {};
      fs.writeFileSync(temp, `${JSON.stringify({ schema: TICKETS_SCHEMA, sessions: Object.fromEntries(sessions), used: data.used.slice(-MAX_USED_MESSAGES), ...reset })}\n`, { mode: 0o600 });
      fs.renameSync(temp, this.#file);
    } finally {
      fs.rmSync(temp, { force: true });
    }
  }

  // A new ticket for this message, replacing any earlier ticket or pending confirmation of the
  // session, or null when this thread message already had one. With command, the ticket is bound to
  // that answer: it records only it (the reply to a confirmation), or with ask only starts the
  // confirmation of it (a bare word the agent has yet to ask about). Throws when the file cannot be
  // read or written.
  issue(sessionId, epoch, messageId, repositories, command = null, { ask = false } = {}) {
    const data = this.#read();
    if (messageId !== null && data.used.includes(messageId)) return null;
    const ticket = crypto.randomBytes(16).toString('hex');
    data.sessions[sessionId] = { hash: ticketHash(ticket), epoch, at: this.#now().toISOString(), message: messageId, repositories, ...(command ? { command } : {}), ...(command && ask ? { ask: true } : {}) };
    if (messageId !== null) data.used.push(messageId);
    this.#save(data);
    return ticket;
  }

  // Notes that the agent is asking this run to confirm exactly one answer for these repositories,
  // replacing (and so dropping) the session's live ticket. Throws when the file cannot be read or
  // written.
  confirm(sessionId, epoch, command, repositories) {
    const data = this.#read();
    data.sessions[sessionId] = { pending: command, epoch, at: this.#now().toISOString(), repositories };
    this.#save(data);
  }

  // Whether this thread message already got a ticket.
  used(messageId) { return this.#read().used.includes(messageId); }

  // Removes the session's ticket or pending confirmation, if any.
  drop(sessionId) {
    const data = this.#read();
    if (typeof sessionId !== 'string' || !Object.hasOwn(data.sessions, sessionId)) return;
    delete data.sessions[sessionId];
    this.#save(data);
  }

  // The pending confirmation of this run, { command, repositories }, or null.
  pending(sessionId, epoch) {
    const sessions = this.#read().sessions;
    const entry = typeof sessionId === 'string' && Object.hasOwn(sessions, sessionId) ? sessions[sessionId] : null;
    if (!entry || !Object.hasOwn(COMMAND_WORDS, String(entry.pending)) || entry.epoch !== epoch || !EPOCH.test(String(epoch))
      || !this.#current(entry) || !Array.isArray(entry.repositories)) return null;
    return { command: entry.pending, repositories: entry.repositories };
  }

  // The live entry for a ticket in this session, without spending it, or null.
  #find(data, ticket, sessionId) {
    if (!TICKET.test(String(ticket))) return null;
    const hash = ticketHash(ticket);
    const found = Object.entries(data.sessions).find(([, entry]) => entry && entry.hash === hash);
    if (!found || (sessionId !== undefined && found[0] !== sessionId)) return null;
    const [owner, entry] = found;
    if (!(Date.parse(entry.at) >= this.#now().getTime() - MAX_TICKET_AGE_MS) || !EPOCH.test(String(entry.epoch)) || !Array.isArray(entry.repositories)) return null;
    return { session_id: owner, ...entry };
  }

  peek(ticket, sessionId) { return this.#find(this.#read(), ticket, sessionId); }

  // Whether this run of the session holds a ticket that has not lapsed, or a pending confirmation.
  live(sessionId, epoch) {
    const sessions = this.#read().sessions;
    const entry = typeof sessionId === 'string' && Object.hasOwn(sessions, sessionId) ? sessions[sessionId] : null;
    return this.#current(entry) && EPOCH.test(String(epoch)) && entry.epoch === epoch;
  }

  // Spends the ticket and returns its entry, or null; a ticket that cannot be removed is not used.
  take(ticket) {
    const data = this.#read();
    const entry = this.#find(data, ticket, undefined);
    if (!entry) return null;
    delete data.sessions[entry.session_id];
    this.#save(data);
    return this.#find(this.#read(), ticket, undefined) === null ? entry : null;
  }
}

// What the agent is told when the user's own message may be their reply to the question.
function ticketContext(repositories, ticket) {
  const several = repositories.length > 1;
  return [
    `Toolkit governance: the user's message above came after Toolkit asked them whether to turn on GitHub governance for ${several ? `these repositories: ${reachNames(repositories)}` : `the repository ${reachNames(repositories)}`}. Read what they mean before anything else.`,
    `- If it clearly answers yes, no or later${several ? ' for all of them' : ''} (in any words, such as "no for both" or "yeah go ahead"), record it by running exactly this once, with yes, no or later in place of ANSWER:\n  node "${ANSWER_SCRIPT}" ANSWER ${ticket}\n  Then tell the user in plain words what Toolkit recorded${several ? ' for each repository' : ''}.`,
    `- If you think they mean one answer but are not sure, record nothing yet: run exactly this once, with yes, no or later in place of ANSWER:\n  node "${ANSWER_SCRIPT}" confirm-ANSWER ${ticket}\n  Toolkit then gives you the question to ask, naming exactly what it would record; their reply to it comes with a ticket that can record only that answer.`,
    `- If it is mixed (yes for one and no for another), a question, or about something else, record nothing: ask again in plain words, "${reachQuestion(repositories).replace(/^Toolkit: t/, 'T')}", and end your turn.`,
    `The ticket works once, only in this session, and only for this message. ${NEVER_OWNER}`,
  ].join('\n');
}

// The confirmation question for one answer: what Toolkit would record, for which repositories.
const ANSWER_EFFECTS = Object.freeze({ enable: 'turn on GitHub governance', disable: 'keep GitHub governance off (never ask again)', 'not-now': 'leave GitHub governance undecided until next session' });
function confirmQuestion(repositories, command) {
  return `Toolkit will ${ANSWER_EFFECTS[command]} for ${reachNames(repositories)}. Is that right?`;
}

// What the agent is told when a bare yes, no or later arrives for a question asked from a folder
// that is not held: it may answer the agent's own question, so nothing is recorded yet.
function confirmContext(repositories, command, ticket) {
  return [
    `Toolkit governance: the user's message above is a bare "${COMMAND_WORDS[command]}", and Toolkit has an open question for ${reachNames(repositories)}. Nothing was recorded, because it may answer something else you asked.`,
    `- If it answered your own question, carry on with that and run nothing for Toolkit: its question stays open.`,
    `- If it was meant for Toolkit's question, run exactly this once:\n  node "${ANSWER_SCRIPT}" confirm-${COMMAND_WORDS[command]} ${ticket}\n  Toolkit then gives you the question to ask, naming exactly what it would record; their reply to it comes with a ticket that can record only that answer. This ticket does nothing else.`,
    NEVER_OWNER,
  ].join('\n');
}

// What the agent is told when the user's message is their reply to a confirmation question: the
// ticket records only the answer that question named, or nothing.
function confirmTicketContext(repositories, command, ticket) {
  return [
    `Toolkit governance: the user's message above is their reply to the question "${confirmQuestion(repositories, command)}". Nothing is recorded yet.`,
    `- If it says yes to that question, run exactly this once:\n  node "${ANSWER_SCRIPT}" ${COMMAND_WORDS[command]} ${ticket}\n  Then tell the user in plain words what Toolkit recorded. This ticket records "${COMMAND_WORDS[command]}" and nothing else.`,
    `- If it says no, is unclear, or is about something else, record nothing. To ask about governance again, ask in plain words, "${reachQuestion(repositories).replace(/^Toolkit: t/, 'T')}", and end your turn.`,
    `The ticket works once, only in this session, and only for this message. ${NEVER_OWNER}`,
  ].join('\n');
}

// Whether a shell command is exactly the answer command with a live ticket of this session: the one
// command a held session may run, wherever it is. The script must be Toolkit's own path as written
// (on Windows any letter case and either slash), never a path the shell or path resolution would
// rewrite, and the line holds nothing a shell expands: no `$`, backtick or `%`, and only spaces or
// tabs between the words.
const ANSWER_COMMAND = /^[ \t]*(?:&[ \t]*)?node(?:\.exe)?[ \t]+(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s"']+))[ \t]+((?:confirm-)?(?:yes|no|later))[ \t]+([0-9a-f]{32})[ \t]*$/;
function sameScript(script) {
  return process.platform === 'win32'
    ? script.replace(/\//g, '\\').toLowerCase() === ANSWER_SCRIPT.replace(/\//g, '\\').toLowerCase()
    : script === ANSWER_SCRIPT;
}
function ticketCommand(text, sessionId, tickets) {
  const command = String(text || '');
  if (/[$`%]/.test(command)) return false;
  const match = ANSWER_COMMAND.exec(command);
  if (!match || typeof sessionId !== 'string' || sessionId === '') return false;
  if (!sameScript(match[1] ?? match[2] ?? match[3])) return false;
  try { return tickets.peek(match[5], sessionId) !== null; } catch { return false; }
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
  if (verdict.state.notes && verdict.state.notes.includes('pending-binding-merge')) lines.splice(1, 0, 'Its working tree has a programme binding that is not merged on the default branch yet.');
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
const SETUP_ASK = `GitHub governance setup is not finished here. Before other work, run ${terminalCommand('discover')} (it only reads, and asks nothing) and put its adoption proposal to the user in one message: the parent issue and private evidence store it recommends with their evidence (or the alternatives, or the create defaults when it found none), and what Toolkit would reuse, add, repair, keep and defer. A candidate is used only after the user confirms it; never pick one for them. The free security settings need no question: they are on by default and \`toolkit governance security\` turns them on once governance is enabled; Toolkit never turns on a GitHub feature that needs billing. One yes covers the whole list: then use \`repository-agent-rules\` to add the governed block and the version 2 \`.github/toolkit-programme.json\` in one pull request for the user to merge; the binding applies only once that pull request merges.`
  + ' If the user says not now, carry on under the global rules and ask again next session. Never act as the user: do not answer any of these questions yourself.';

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

// The question for repositories a command or edit reached from a folder that is not held (ReachAsks),
// named by folder so the user knows which; with several, one reply answers for all of them.
function reachNames(repositories) { return repositories.map(item => path.basename(item.root) || item.root).join(', '); }
function reachQuestion(repositories) {
  return repositories.length > 1
    ? `Toolkit: turn on GitHub governance (issues, records, evidence store) for these repositories: ${reachNames(repositories)}? Reply yes, no or later for all of these.`
    : `Toolkit: turn on GitHub governance (issues, records, evidence store) for the repository ${reachNames(repositories)}? Reply yes, no or later.`;
}
// The refusal for a reach (ToolGate's #askReach result): the question when it was asked, or, while
// another question is open, a wait for the user's reply to that one.
function reachDenial(what, { asked = null, waiting = null }) {
  if (waiting) return `Toolkit: ${what} a repository that has no governance decision yet, and Toolkit's question for ${reachNames(waiting)} is still open, so it is refused. Wait for the user's reply to that question and end your turn; never ask them to run a command. ${NEVER_OWNER}`;
  return `Toolkit: ${what} ${asked.length > 1 ? 'repositories that have' : 'a repository that has'} no governance decision yet, so it is refused. Send the user this, word for word, and end your turn; their own reply answers it, so never ask them to run a command:\n${reachQuestion(asked)}\n${NEVER_OWNER}`;
}

const LAUNCHED_TEXT = `Toolkit: an automated session cannot answer the governance question. Answer it in your own chat, or run the command in your own terminal. ${NEVER_OWNER}`;
function noMarkText(commands) {
  return `Toolkit: this session started before Toolkit could note it, so it cannot take the governance answer. Start a new session and answer there (in Codex, trust Toolkit's SessionStart hook in /hooks first, or no session can be noted), or run ${commands.map(terminalCommand).join(' or ')} in your own terminal.`;
}
const RESUMED_LINE = 'Toolkit: this session was resumed, or another session started in this repository, so Toolkit asks again and your reply was held.';
const REPEAT_TEXT = 'Toolkit: this message arrived again after it was already read, so it answers nothing and nothing was recorded. Reply again if you meant to answer.';
const REASK_LINE ='Toolkit: your reply could not be matched to the confirmation question, so nothing was recorded and Toolkit asks again.';
const MOVED_LINE ='Toolkit: another session started in this repository since you said "later", so Toolkit asks again and your reply was held.';
const LAUNCHED_HOLD_TEXT = `Toolkit: this repository is waiting for the user's governance answer, and this session was started by another session or a Toolkit launcher, so its message was not sent and not kept. The user answers in their own chat; start this again after that. ${NEVER_OWNER}`;
const PICKER_UNCOUNTED = `Toolkit governance: no answer was recorded from that card, and the repository is still waiting. End your turn now without using any other tool; the user can reply yes, no or later as a message. ${NEVER_OWNER}`;

function withAgentLine(text) { return `${text}\nFor agents: ${NEVER_OWNER_SHORT}`; }

// A session a Toolkit launcher started, or one started from another session's shell command, is
// automation, not the user typing.
function launchedSession(environment, sessionId) {
  const env = environment || {};
  if (LAUNCHER_MARKERS.some(name => typeof env[name] === 'string' && env[name] !== '')) return true;
  const host = env[HOST_SESSION_VARIABLE];
  return typeof host === 'string' && host !== '' && host !== sessionId;
}

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
  #gate; #held; #notNow; #epochs; #notes; #reach; #tickets; #registryOptions; #environment; #now; #picker;

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
    this.#reach = new ReachAsks({ registryOptions, now });
    this.#tickets = new ReplyTickets({ registryOptions, now });
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
    // Answers are read from the user's reply; what is held and handed back is the message as sent.
    const message = ownerMessage(text);
    const reply = message.text;
    const answer = ANSWER.exec(reply);
    // From a plain folder or a decided repository, a reply can answer the question Toolkit asked there
    // for repositories a command or edit reached.
    if (verdict.reason === 'no-git' || verdict.reason === 'decided') {
      const reached = this.#reachAnswer(message, answer, sessionId);
      if (reached) return reached;
    }
    // After "not now", the full answer still decides in the same run, unless a session has started in
    // the repository since; a short reply is an ordinary message there, since it may answer the
    // agent's own question.
    if (verdict.reason === 'not-now') return answer ? this.#afterNotNow(cwd, text, answer, verdict, sessionId) : { action: 'pass' };
    if (!verdict.hold) return verdict.reason === 'no-git' ? { action: 'pass' } : this.#replayIfAny(verdict.state, sessionId);
    if (verdict.reason === 'state-unreadable') return { action: 'block', reason: unreadableText(verdict.state, this.#registryOptions) };
    // A session another session or a launcher started never answers and never adds to what is held.
    if (this.#launched(sessionId)) return { action: 'block', reason: answer || OK_ANSWER.test(reply) ? LAUNCHED_TEXT : LAUNCHED_HOLD_TEXT };
    const marks = this.#marks(verdict, sessionId);
    if (verdict.reason === 'not-github') return this.#notGitHub(cwd, text, reply, answer, verdict, sessionId, marks);
    // Only the run of the session that was shown the question answers it, in either form.
    const id = verdict.state.repository_id;
    const asked = this.#held.asked(id, sessionId, marks);
    // A thread message that already got a ticket arriving again is the host delivering it twice: it
    // was read once, so it is held and answers nothing, in either form.
    if (asked && message.id !== null && this.#ticketed(message.id)) {
      this.#held.add(id, prompt, sessionId, marks, verdict.state.root);
      return { action: 'block', reason: REPEAT_TEXT };
    }
    if (answer && asked) { this.#dropTicket(sessionId); return this.#answer(cwd, answer[1].toLowerCase(), verdict, sessionId, marks); }
    // After the agent asked the user to confirm one answer, their next own message, a bare yes
    // included, is read only as the reply to that question.
    if (asked && ownTyped(message)) {
      const confirmed = this.#confirmReply(message, sessionId, marks.session);
      if (confirmed) {
        this.#held.add(id, prompt, sessionId, marks, verdict.state.root);
        return confirmed.hold ? { action: 'block', reason: PromptHold.reask(confirmed) } : confirmed;
      }
    }
    const short = SHORT_ANSWER.exec(reply);
    if (short && asked) { this.#dropTicket(sessionId); return this.#answer(cwd, SHORT_COMMANDS[short[1].toLowerCase()], verdict, sessionId, marks); }
    const unmarked = this.#unmarked(sessionId, marks, answer || short);
    if (unmarked) return unmarked;
    // Any other message of the user's own in the run that was asked may be their reply in other
    // words: it is kept like any held message and handed to the agent with a reply ticket.
    if (asked && !answer && !short && ownTyped(message)) {
      const ticketed = this.#ticket(message, sessionId, marks.session, [{ id, root: verdict.state.root, mark: marks.repository || null }]);
      if (ticketed) { this.#held.add(id, prompt, sessionId, marks, verdict.state.root); return ticketed; }
    }
    const resumed = Boolean(answer || short) && this.#held.count(id, sessionId) > 0;
    const held = this.#held.add(id, prompt, sessionId, marks, verdict.state.root);
    if (resumed) return this.#ask(`${RESUMED_LINE}\n${questionText(verdict, 1)}`, sessionId, marks);
    // A session sees the whole question on its first held message, even when another session is waiting too.
    // Each run sees the whole question on its own first held message: a resumed run is a new run.
    const shown = typeof sessionId === 'string' && sessionId !== '' ? this.#held.countRun(id, sessionId, marks.session) : held;
    const earlier = shown === 1 && typeof sessionId === 'string' && sessionId !== '' && this.#held.count(id, sessionId) > 1;
    return this.#ask(earlier ? `${RESUMED_LINE}\n${questionText(verdict, 1)}` : questionText(verdict, shown), sessionId, marks);
  }

  // The reply to the question asked for reached repositories (ReachAsks), only in the run that was
  // asked and only from the user's own session. The full `toolkit governance` answer applies at once
  // to every repository listed that is still waiting and that no session has started in since; a
  // bare yes, no or later has the agent confirm first; any other message of the user's own is
  // handed to the agent with a reply ticket, and the message passes either way.
  #reachAnswer(message, answer, sessionId) {
    const short = answer ? null : SHORT_ANSWER.exec(message.text);
    const epoch = this.#epochs.get(sessionId);
    const asked = this.#reach.get(sessionId, epoch);
    if (asked.length === 0) return null;
    if (this.#launched(sessionId)) return answer || short ? { action: 'block', reason: LAUNCHED_TEXT } : null;
    if (answer) { this.#dropTicket(sessionId); return this.#applyAll(answer[1].toLowerCase(), asked, sessionId, epoch); }
    if (!ownTyped(message)) return null;
    // The reply to a confirmation question, bare or not, is read only as that.
    const confirmed = this.#confirmReply(message, sessionId, epoch);
    if (confirmed?.hold) return { action: 'pass', context: `Toolkit governance: nothing was recorded. Tell the user this, word for word, and end your turn:\n${PromptHold.reask(confirmed)}\n${NEVER_OWNER}` };
    if (confirmed) return confirmed;
    // Here the agent keeps working, so a bare yes, no or later may answer its own question (owner
    // decision of 28 Oct): it records nothing, and the agent gets a ticket that can only start the
    // confirmation of that word, which it uses only if it asks the user.
    if (short) {
      const command = SHORT_COMMANDS[short[1].toLowerCase()];
      let ticket = null;
      try { ticket = this.#tickets.issue(sessionId, epoch, message.id, asked, command, { ask: true }); } catch { ticket = null; }
      return ticket ? { action: 'pass', context: confirmContext(asked, command, ticket) } : null;
    }
    return this.#ticket(message, sessionId, epoch, asked);
  }

  // The user's reply to a pending confirmation of this run: a ticket that records only the answer
  // that question named, which ends the confirmation. null when none is pending; { hold: true } when
  // one may be pending but no ticket can be given (the store cannot be read or written, or this
  // thread message already had a ticket), so the reply is never read another way.
  #confirmReply(message, sessionId, epoch) {
    let pending = null;
    try {
      pending = this.#tickets.pending(sessionId, epoch);
      // A store moved aside after this run began may have held its confirmation.
      const reset = this.#tickets.resetAt();
      const started = this.#epochs.startedAt(sessionId);
      if (!pending && reset !== null && (started === null || started <= reset)) return { hold: true, lost: true };
    } catch { return { hold: true, lost: true }; }
    if (!pending) return null;
    let ticket = null;
    try { ticket = this.#tickets.issue(sessionId, epoch, message.id, pending.repositories, pending.command); } catch { ticket = null; }
    return ticket ? { action: 'pass', context: confirmTicketContext(pending.repositories, pending.command, ticket) } : { hold: true, pending };
  }

  // The re-ask when a reply cannot be matched to the confirmation: the same confirmation question
  // word for word while it is known, else only the full answer, since the question may be lost.
  static reask(hold) {
    return hold.pending
      ? `${REASK_LINE} The question is still: "${confirmQuestion(hold.pending.repositories, hold.pending.command)}"`
      : `${REASK_LINE} Toolkit cannot tell what was asked, so only the full \`toolkit governance enable\` or \`toolkit governance disable\` sent as a message answers now.`;
  }

  // Whether a thread message already got a ticket. A store that cannot be read counts as no: the
  // confirmation check after this holds then, and the full answer still works.
  #ticketed(messageId) {
    try { return this.#tickets.used(messageId); } catch { return false; }
  }

  // An answer recorded another way ends any ticket or confirmation the session still holds; a store
  // that cannot be changed is moved aside (other runs that began before then are asked again).
  #dropTicket(sessionId) {
    try { this.#tickets.drop(sessionId); } catch { try { this.#tickets.reset(); } catch { /* the next confirmation re-asks */ } }
  }

  // A reply ticket for this message and these repositories, with what the agent is told; null when
  // this thread message already had one or no ticket can be kept.
  #ticket(message, sessionId, epoch, repositories) {
    if (typeof sessionId !== 'string' || sessionId === '' || !EPOCH.test(String(epoch))) return null;
    let ticket;
    try { ticket = this.#tickets.issue(sessionId, epoch, message.id, repositories); } catch { ticket = null; }
    return ticket ? { action: 'pass', context: ticketContext(repositories, ticket) } : null;
  }

  // The answer the agent read from the user's reply, recorded with its ticket (toolkit-governance-
  // answer.cjs): { ok, text } where text is for the agent to act on and tell the user. The ticket
  // counts once, in the run it was given to, and only for the repositories it names.
  // `confirm-<answer>` records nothing: it spends the ticket on a confirmation question for exactly
  // that answer, whose reply comes with a ticket that records only it.
  answerTicket(ticket, word) {
    const asking = /^confirm-/.test(String(word));
    const bare = String(word).replace(/^confirm-/, '');
    const command = Object.hasOwn(ANSWER_WORDS, bare) ? ANSWER_WORDS[bare] : null;
    if (command === null) return { ok: false, text: 'Toolkit: the answer must be yes, no or later (or confirm-yes, confirm-no or confirm-later to ask first). Nothing was recorded.' };
    const unusable = { ok: false, text: `Toolkit: that reply ticket is used, lapsed or unknown, so nothing was recorded. Ask the user the governance question again in plain words. ${NEVER_OWNER}` };
    let found = null;
    try { found = this.#tickets.peek(ticket, undefined); } catch { found = null; }
    if (!found) return unusable;
    // A ticket for a bare word only starts the confirmation of that word; a ticket for the reply to a
    // confirmation records only the answer that question named.
    if (found.ask && (!asking || found.command !== command)) {
      return { ok: false, text: `Toolkit: this ticket can only start the confirmation of "${COMMAND_WORDS[found.command]}" (confirm-${COMMAND_WORDS[found.command]}), so nothing was recorded.` };
    }
    if (found.command && !found.ask && (asking || found.command !== command)) {
      return { ok: false, text: `Toolkit: this ticket can record only "${COMMAND_WORDS[found.command]}", the answer the user was asked to confirm, so nothing was recorded. If they did not confirm it, record nothing.` };
    }
    // Checked before the ticket is spent, so a launched session or another run holding it cannot use
    // up the user's ticket.
    if (this.#launched(found.session_id) || this.#epochs.get(found.session_id) !== found.epoch) {
      return { ok: false, text: `Toolkit: that reply ticket belongs to another run of the session, so nothing was recorded. ${NEVER_OWNER}` };
    }
    let entry = null;
    try { entry = this.#tickets.take(ticket); } catch { entry = null; }
    if (!entry || entry.session_id !== found.session_id || entry.epoch !== found.epoch) return unusable;
    if (asking) {
      try { this.#tickets.confirm(entry.session_id, entry.epoch, command, entry.repositories); } catch {
        return { ok: false, text: 'Toolkit: the confirmation could not be kept, so nothing was recorded. Ask the user the governance question again in plain words.' };
      }
      return { ok: true, text: `Toolkit recorded nothing yet. Ask the user this, word for word, and end your turn: "${confirmQuestion(entry.repositories, command)}" Their reply comes with a ticket that can record only "${bare}".` };
    }
    const result = this.#applyAll(command, entry.repositories, entry.session_id, entry.epoch);
    if (result.action !== 'pass') return { ok: false, text: result.reason };
    return result.recorded > 0
      ? { ok: true, text: `${result.context}\nTell the user in plain words what Toolkit recorded.` }
      : { ok: false, text: `${result.context}\nNothing was recorded. Tell the user so in plain words.` };
  }

  // One answer for every repository listed: each one still waiting for its github.com answer, with the
  // same run and repository marks as when it was asked, is decided; the rest are left as they are.
  #applyAll(command, asked, sessionId, epoch) {
    const done = [], moved = [], failed = [];
    for (const item of asked) {
      let verdict;
      try { verdict = this.#gate.evaluate(item.root, { sessionId }); } catch { verdict = null; }
      if (!verdict || !verdict.hold || verdict.reason !== 'undecided' || verdict.state.repository_id !== item.id) { moved.push(item); continue; }
      const marks = this.#marks(verdict, sessionId);
      if (marks.session !== epoch || (marks.repository || null) !== item.mark) { moved.push(item); continue; }
      const result = this.#answer(item.root, command, verdict, sessionId, marks);
      (result.action === 'pass' ? done : failed).push({ item, result });
    }
    try {
      const settled = new Set([...done.map(({ item }) => item.id), ...moved.map(item => item.id)]);
      const open = this.#reach.get(sessionId, epoch).filter(item => !settled.has(item.id));
      this.#reach.clear(sessionId);
      if (open.length > 0) this.#reach.add(sessionId, epoch, open);
    } catch { /* an ask that stays is asked again */ }
    if (failed.length > 0) {
      const recorded = done.length > 0 ? ` It was recorded for ${reachNames(done.map(({ item }) => item))}.` : '';
      return { action: 'block', reason: `${failed.map(({ item, result }) => `${reachNames([item])}: ${result.reason}`).join('\n')}${recorded}` };
    }
    const lines = [`The user's message is their answer (${command === 'not-now' ? 'later' : command === 'enable' ? 'yes' : 'no'}) to Toolkit's GitHub governance question for ${reachNames(asked)}; it is not a reply to anything else.`];
    for (const { item, result } of done) lines.push(`${reachNames([item])} (${item.root}): ${result.context}`);
    if (moved.length > 0) lines.push(`Nothing was recorded for ${reachNames(moved)}: it was decided elsewhere, or a session started there since the question, so Toolkit asks again if a command reaches it.`);
    return { action: 'pass', context: lines.join('\n'), recorded: done.length };
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
  #afterNotNow(cwd, text, answer, verdict, sessionId) {
    const marks = this.#marks(verdict, sessionId);
    const id = verdict.state.repository_id;
    if (this.#notNow.repositoryMark(id, sessionId) === marks.repository) return this.#answer(cwd, answer[1].toLowerCase(), verdict, sessionId, marks);
    try { this.#notNow.set(id, sessionId, null); } catch { /* the reply is held below either way */ }
    this.#held.add(id, text, sessionId, marks, verdict.state.root);
    return this.#ask(`${MOVED_LINE}\n${questionText(verdict, 1)}`, sessionId, marks);
  }

  // A git repository not on github.com: the only outcome is DISABLED, once the user says ok.
  #notGitHub(cwd, text, reply, answer, verdict, sessionId, marks) {
    const id = verdict.state.repository_id;
    if (answer && answer[1].toLowerCase() === 'enable') {
      return { action: 'block', reason: `Toolkit: GitHub governance cannot be enabled here, because this repository ${whereText(verdict.state)}. ${OK_ASK}` };
    }
    const ok = Boolean(answer) || OK_ANSWER.test(reply);
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
  #launched(sessionId) { return launchedSession(this.#environment, sessionId); }

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
  #gate; #continuation; #epochs; #notes; #reach; #tickets; #notNow; #registryOptions; #environment;

  // host is set by the hook entry point ('claude' or 'codex'), never read from the payload.
  constructor({ registryOptions = {}, stateReader = null, now, environment = process.env, continuationResolver = null, host = null } = {}) {
    this.#gate = new GovernanceGate({ registryOptions, stateReader, now });
    this.#continuation = continuationResolver || new ContinuationResolver({ environment, host });
    this.#epochs = new SessionEpochs({ registryOptions, now });
    this.#notes = new PickerNotes({ registryOptions, now });
    this.#reach = new ReachAsks({ registryOptions, now });
    this.#tickets = new ReplyTickets({ registryOptions, now });
    this.#notNow = new NotNow({ registryOptions, now });
    this.#registryOptions = registryOptions;
    this.#environment = environment || {};
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
      // Recording the answer the agent read from the user's own reply, with this session's live
      // ticket, runs wherever the session is; the script checks the ticket again as it records.
      if (tool !== 'Monitor' && ticketCommand(text, sessionId, this.#tickets)) return null;
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
    // A prompt the agent schedules for itself could arrive as bare text and read as the user's reply,
    // so none is scheduled while this run has a governance question, reply ticket, confirmation or
    // "later" answer open.
    if (SCHEDULE_TOOLS.test(tool) && this.#questionOpen(sessionId)) {
      return { deny: `Toolkit: this session has Toolkit's governance question open (or the user said "later" to it), so no prompt is scheduled for the rest of this run, unless the user answers it; after "later", only the full \`toolkit governance enable\` or \`disable\` sent as a message does. ${NEVER_OWNER}` };
    }
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
      const args = input.tool_input || {};
      const workdirs = [args.workdir, args.cwd].filter(value => typeof value === 'string' && value);
      const resolvedWorkdirs = workdirs.map(value => path.resolve(cwd, value));
      const targets = [...new Set([...resolvedWorkdirs, ...commandTargets(text, resolvedWorkdirs[0] || cwd), ...absoluteTargets(text)])];
      const reached = targets.map(target => this.#verdict(target, sessionId)).filter(verdict => verdict?.hold);
      if (reached.length > 0) {
        const asked = this.#askReach(input, sessionId, reached);
        if (asked) return { deny: reachDenial(HOST_COMMAND.test(text) ? 'this command starts a Claude or Codex session in' : 'this command works in', asked) };
        return { deny: `${HOST_COMMAND.test(text)
          ? "Toolkit: this command starts a Claude or Codex session in a repository that is waiting for the user's governance answer, so it is refused."
          : "Toolkit: this command works in a repository that is waiting for the user's governance answer, so it is refused."} Ask the user to answer in their own chat first; do not try to work around it. ${NEVER_OWNER}` };
      }
      // Generic owner/state/current-folder/path guards above always run first. A continuation
      // starts a new run: the caller's session-specific 'later' never admits its targets.
      let continuation;
      try { continuation = this.#continuation.resolve(text, input); } catch { continuation = { status: 'UNKNOWN' }; }
      if (continuation?.status === 'UNKNOWN') return { deny: `Toolkit: the selected session's repository could not be verified, so this continuation is refused. Use a supported literal selector whose target can be verified. ${NEVER_OWNER}` };
      if (continuation?.status !== 'NOT_CONTINUATION') {
        if (continuation?.status !== 'VERIFIED' || !Array.isArray(continuation.targets) || continuation.targets.length === 0
          || continuation.targets.some(target => {
            if (typeof target !== 'string' || !path.isAbsolute(target)) return true;
            const targetVerdict = this.#verdict(target, null);
            return targetVerdict?.hold !== false || !['ENABLED', 'DISABLED'].includes(targetVerdict.state?.state);
          })) {
          return { deny: `Toolkit: a continuation target is waiting for its governance answer or its state could not be verified, so this continuation is refused. The user answers for that repository in their own chat. ${NEVER_OWNER}` };
        }
      }
    }
    const edited = EDIT_TOOLS.test(tool) ? editTargets(input).map(target => this.#verdict(path.dirname(resolveTarget(input, target)), sessionId)).filter(verdict => verdict?.hold) : [];
    if (edited.length > 0) {
      const asked = this.#askReach(input, sessionId, edited);
      if (asked) return { deny: reachDenial('this edit is in', asked) };
      return { deny: `Toolkit: this edit is in a repository that is waiting for the user's governance answer, so it is refused. Ask the user to answer in their own chat first; do not try to work around it. ${NEVER_OWNER}` };
    }
    return null;
  }

  // From a plain folder or a decided repository, a command or edit that reaches github.com
  // repositories waiting for their answer asks the question there and then (ReachAsks), so the user's
  // reply in this session answers for them. Returns every repository now asked in this run, or null
  // when it cannot ask: the folder itself is held or said "later", a repository reached is not on
  // github.com or could not be read, the session has no mark, or another session started it.
  // { asked } is every repository the question now names; { waiting } is the open question's list
  // when this reach adds another repository, which waits until that question is answered.
  #askReach(input, sessionId, verdicts) {
    const here = this.#verdict(path.resolve(String(input && input.cwd || process.cwd())), sessionId);
    if (!here || here.hold || !['no-git', 'decided'].includes(here.reason)) return null;
    if (verdicts.some(verdict => verdict.reason !== 'undecided' || !verdict.state.repository_id || typeof verdict.state.root !== 'string' || verdict.state.root === '')) return null;
    if (typeof sessionId !== 'string' || sessionId === '' || launchedSession(this.#environment, sessionId)) return null;
    const epoch = this.#epochs.get(sessionId);
    if (!EPOCH.test(String(epoch))) return null;
    const repositories = [...new Map(verdicts.map(verdict => [verdict.state.repository_id, { id: verdict.state.repository_id, root: verdict.state.root, mark: this.#epochs.repository(verdict.state.repository_id) }])).values()];
    // While a question is open its list is fixed, so the user's reply covers exactly what they were
    // shown: reaching another repository gets the plain refusal until that question is answered.
    let open;
    try { open = this.#reach.get(sessionId, epoch); } catch { return null; }
    if (open.length > 0) return repositories.every(item => open.some(known => known.id === item.id)) ? { asked: open } : { waiting: open };
    try { return { asked: this.#reach.add(sessionId, epoch, repositories) }; } catch { return null; }
  }

  // Whether this run has a question asked from a folder that is not held, a live reply ticket or
  // confirmation of this run, or a "later" answer (after which the full answer still decides in the
  // same run).
  // When that cannot be read it counts as open.
  #questionOpen(sessionId) {
    if (typeof sessionId !== 'string' || sessionId === '') return false;
    try {
      const epoch = this.#epochs.get(sessionId);
      // A confirmation whose repositories were all decided elsewhere is over.
      const pending = this.#tickets.pending(sessionId, epoch);
      if (pending && pending.repositories.every(item => this.#verdict(item.root, sessionId)?.reason === 'decided')) this.#tickets.drop(sessionId);
      return this.#reach.get(sessionId, epoch).length > 0 || this.#tickets.live(sessionId, epoch) || this.#notNow.anyFor(sessionId, epoch);
    } catch { return true; }
  }

  // The gate's verdict for a folder a command names, or null when it cannot be told.
  #verdict(target, sessionId) {
    try { return this.#gate.evaluate(target, { sessionId }); } catch { return null; }
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
  if (state.state === 'ERROR') return 'Toolkit governance: ERROR for this repository (the programme binding merged on the default branch cannot be used). Follow the global rules, coding gates included; ordinary work continues, but programme records, gate admission and finality hold until a pull request fixes the binding. Never treat this as ENABLED or as DISABLED.';
  if (state.state === 'DISABLED') return 'Toolkit governance: DISABLED for this repository (no GitHub governance). Follow the global rules, coding gates included; any TOOLKIT-GOVERNED-RULES block in AGENTS.md does not apply.';
  if (state.materials_complete === false) return `Toolkit governance: ENABLED, setup not finished (\`.github/toolkit-programme.json\` is not merged on the default branch yet). Follow the global rules, coding gates included; GitHub governance starts once the setup pull request with the binding merges. ${SETUP_ASK}`;
  const enabled = 'Toolkit governance: ENABLED for this repository. Follow the global rules, coding gates included, and the TOOLKIT-GOVERNED-RULES block in AGENTS.md (GitHub governance: records and evidence).';
  return state.governed_effects_hold ? `${enabled} The binding merged on the default branch was last read over 24 hours ago, so programme records, gate admission and finality hold until it is read again online.` : enabled;
}

// ---- fail-closed fallbacks --------------------------------------------------------------------

// Used when the gate itself failed: inside a git repository (or when that cannot be told) it holds.
function insideRepository(cwd) {
  try { return governance.findGitRoot(typeof cwd === 'string' && cwd ? cwd : process.cwd()) !== null; } catch { return true; }
}

module.exports = Object.freeze({
  ANSWER,
  ASK,
  HOST_COMMAND,
  HOST_SESSION_VARIABLE,
  LAUNCHER_MARKERS,
  SessionEpochs,
  NOT_NOW_BASENAME,
  REACH_ASKS_BASENAME,
  ReachAsks,
  ReplyTickets,
  TICKETS_BASENAME,
  ANSWER_SCRIPT,
  NOT_GITHUB_BASENAME,
  OK_ANSWER,
  ownerReply,
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
