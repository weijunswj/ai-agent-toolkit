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
//     governance, yes, no or later ("not now" also works). Outside github.com governance is off
//     automatically. For the github.com question, the user's own reply is
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
//     the session's live reply ticket. In every folder, two exact checks stop an agent answering the
//     question for the user: a command that runs the governance CLI with a decision (or names a host
//     next to the full answer phrase), and an edit to Toolkit's user-state files. From a plain folder
//     or a decided repository, a command or edit that works in a held repository (after `cd`, with
//     Codex's `-C`, or by its full path) is refused. Reading free text for a host launch with a short
//     answer, or for a session resume or fork, is not a hook: it refused ordinary commands, and the
//     written rule (safety-gates playbook) covers it. A session another session started never
//     answers (SessionEpochs and the launched-session check), so a nested session cannot answer.
//   - sessionLine is the one SessionStart line that states the effective state.
//
// Every failure inside a git repository holds (fail closed). Held prompts never leave this computer
// and are never printed to logs.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const governance = require('./toolkit-governance-state.cjs');
const { MAX_DELIVERIES, deliveryHash, currentReceipts, deliveryReceipt } = require('./toolkit-projects-delivery.cjs');

const CAPABILITY = governance.GOVERNANCE_CAPABILITY;
const HELD_BASENAME = 'held-prompts.v1.json';
const HELD_SCHEMA = 'toolkit.held-prompts.v1';
const NOT_NOW_BASENAME = 'governance-not-now.v1.json';
const NOT_NOW_SCHEMA = 'toolkit.governance-not-now.v1';
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
// The reply the answers above are read from. Claude Code and Codex hand the hook what the user typed,
// bare. A Claude Projects thread hands a Remote Control session each message the user sends there
// wrapped in one `<wake>` envelope; the user's own words are the one message in it marked as the
// trigger, from a human the session works for. Anything else in an envelope (a coordinator's relay
// of the user's words, a scheduled task, another person, extra text, a broken envelope) reads as
// no reply at all, so it never answers.
const WAKE = /^\s*<wake((?:\s+[\w-]+="[^"<>]*")*)\s*>([\s\S]*)<\/wake>\s*$/;
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
const WAKE_MESSAGE = new RegExp(`<message(${WAKE_ATTRIBUTES})\\s*>(${WAKE_INNER})<\\/message>`, 'g');
function frameBody(body, name) {
  const text = body.trim();
  const open = new RegExp(`^<${name}${WAKE_ATTRIBUTES}\\s*>`).exec(text);
  const close = `</${name}>`;
  return open && text.endsWith(close) ? text.slice(open[0].length, -close.length).trim() : null;
}
function ownerReply(prompt) { return ownerMessage(prompt).text; }
// The reply with where it came from: { text, id, wrapped, markup, approvalEligible, sentAt }.
// approvalEligible is true only for a well-formed direct Projects mention with no decoded markup;
// sentAt lets the approval store reject old deliveries after their replay markers expire.
// id is the thread message's id, or
// null for bare text; wrapped says the text came from a Projects envelope, and markup that bare text
// carries tags (a relay, a reminder or another wrapped message), so it is not the user typing.
const ANY_TAG = /<\/?[A-Za-z][\w-]*(?:\s[^<>]*)?\/?>/;
// Decode only to detect frame markup, never to create an approval. Repeated encoding must not
// hide a wrapper beside a valid approval line. Four passes bound the work on plain prompts.
function hasFrameMarkup(text) {
  let decoded = text;
  for (let pass = 0; pass < 4; pass += 1) {
    const next = decoded.replace(/&(amp|lt|gt|#\d+|#x[0-9a-f]+);/gi, (entity, name) => {
      if (!name.startsWith('#')) return ({ amp: '&', lt: '<', gt: '>' })[name.toLowerCase()];
      const point = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : entity;
    });
    if (next === decoded) break;
    decoded = next;
  }
  return /<\/?(?:wake\b|[A-Za-z][\w-]*(?=[\s/>]|$))|&(?:lt|#0*60|#x0*3c);\/?[A-Za-z]/i.test(decoded);
}
// Whether a message is the user's own words that a reply ticket may be given for: the trigger
// message of a Projects envelope from the person the session works for, or bare text with no tags
// (a coordinator's relay, a reminder or a scheduled task is never one).
function ownTyped(message) { return message.text.trim() !== '' && (message.wrapped ? message.approvalEligible === true : !message.markup && !hasFrameMarkup(message.text)); }
function ownerMessage(prompt) {
  const text = String(prompt || '');
  const wake = WAKE.exec(text);
  if (!wake) return { text, id: null, wrapped: false, markup: ANY_TAG.test(text), approvalEligible: false };
  const none = { text: '', id: null, wrapped: true, markup: false };
  if (text.length > 256 * 1024) return none;
  // Check every frame attribute too: conflicting wake, project or thread attributes are ambiguous.
  for (const tag of text.matchAll(/<[\w-]+((?:\s+[\w-]+="[^"<>]*")*)\s*\/?>/g)) {
    const names = [...tag[1].matchAll(/([\w-]+)="/g)].map(match => match[1]);
    if (new Set(names).size !== names.length) return none;
  }
  const body = withoutNotes(wake[2]);
  let frame = frameBody(body, 'project');
  if (frame === null) return none;
  if (frame.startsWith('<thread')) frame = frameBody(frame, 'thread');
  if (frame === null) return none;
  // Scan messages once and check the gaps. A repeated whole-frame regexp can backtrack over long
  // malformed whitespace; explicit frame boundaries keep that failure path bounded too.
  const matches = [...frame.matchAll(WAKE_MESSAGE)];
  let end = 0;
  for (const match of matches) {
    if (frame.slice(end, match.index).trim() !== '') return none;
    end = match.index + match[0].length;
  }
  if (!matches.length || frame.slice(end).trim() !== '') return none;
  const messages = matches.map(([, attributes, inner]) => ({
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
  const reply = triggers[0].inner.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-f]+);/gi, (entity, name) => {
    if (!name.startsWith('#')) return ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' })[name] || entity;
    const point = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : entity;
  });
  const id = typeof triggers[0].attributes.id === 'string' && triggers[0].attributes.id !== '' ? triggers[0].attributes.id : null;
  // Merge and governance authority use only a fresh direct mention with a bounded message id.
  // Their independent state owners check time and replay; decoded markup grants neither.
  const wakeAttributes = Object.fromEntries([...wake[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(([, name, value]) => [name, value]));
  const approvalEligible = wakeAttributes.reason === 'mention' && triggers[0].attributes.mention === 'true'
    && id !== null && /^[A-Za-z0-9_.:-]{1,256}$/.test(id)
    && !messages.some(message => message.attributes['has-attachments'] !== undefined)
    // Remaining non-tag entities are rejected per line by approvalsIn, preserving other lines.
    && !body.includes('<attachment') && !/[<>]/.test(reply) && !hasFrameMarkup(reply);
  return { text: reply, id, sentAt: triggers[0].attributes['sent-at'] || null, wrapped: true, markup: false, approvalEligible };
}
// An agent's command that would answer for the user: the governance CLI script with a decision, or a
// host name next to the full answer phrase. Both are exact matches. A command that only names Claude
// or Codex next to a bare yes, no or ok (a metadata save, a report, a commit message) is data and
// passes: what stops a nested session answering is the same-run rule above (it has nothing held, so
// nothing it sends answers) together with the refusal of sessions another session started.
function answerCommand(text) {
  return /toolkit-governance\.cjs["']?\s+(?:enable|disable|decline|reopen|migrate|repair)\b/i.test(text)
    || (/\b(?:claude|codex)\b/i.test(text) && /toolkit governance (?:enable|disable|decline)\b/i.test(text));
}
const USER_STATE_PATH = /[\\/]\.ai-agent-toolkit[\\/]user-state(?:[\\/]|$)/i;
// In a held repository every tool is refused but these: ToolSearch only loads tool definitions (the
// card's among them), and AskUserQuestion runs only as Toolkit's card (ToolGate). A Claude Projects
// thread can reach the owner only through its posting tools, which post text in the thread and change
// nothing on the computer or in any repository, so the thread can still ask the question; its decision
// cards stay held, so a card never stands in for the owner's typed answer.
const ALWAYS_TOOLS = /^(?:ToolSearch|mcp__hearthbot__(?:post_message|react|update_progress_checklist|no_reply_needed))$/;
const PICKER_TOOL = 'AskUserQuestion';
// States that are never governed: an evidence store (S1) and a scratch clone (R1s).
const NEVER_GOVERNED = Object.freeze(['S1', 'R1s']);
const EDIT_TOOLS = /^(?:Edit|Write|MultiEdit|NotebookEdit|apply_patch)$/;
const { SHELL_TOOLS, ShellCall, shellPath } = require('./toolkit-shell-call.cjs');
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
  // automatically), 'decided', 'undecided' (the github.com question), 'not-now' (the user said later in this run of the session)
  // or 'state-unreadable'. Identity and the state module decide; nothing is written into the
  // repository or folder. "Not now" lasts for the run of the session that said it (its session mark).
  evaluate(cwd, { sessionId = null } = {}) {
    const state = this.#stateReader(cwd);
    const verdict = (hold, reason) => Object.freeze({ hold, reason, state });
    if (state.state === 'UNDECIDED' && state.rule === 'ERROR') return verdict(true, 'state-unreadable');
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
  // An evidence store or a scratch clone is never governed, so "enable" is never recorded for one.
  if (command === 'enable' && NEVER_GOVERNED.includes(new GovernanceGate({ registryOptions, now }).evaluate(cwd).state.rule)) throw new GovernanceGateError('NOT_GOVERNABLE');
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
// the repository it starts in, after refreshing this computer's read of the binding merged on that
// repository's default branch (bounded; offline keeps the last read). Never throws. `refreshBinding`
// is for tests; a test registry or test run never reaches the network (refreshMergedBinding).
function startSession(input, { registryOptions = {}, now, refreshBinding = null, programmeDeps = {} } = {}) {
  try {
    let repositoryId = null;
    if (input && typeof input.cwd === 'string' && input.cwd && input.source !== 'clear' && input.source !== 'compact') {
      // The one place a hook reads the network: the merged binding, bounded, into this computer's cache.
      try { (refreshBinding || governance.refreshMergedBinding)(input.cwd, registryOptions); } catch { /* offline keeps the last read */ }
      let current = null;
      try { current = governance.governanceState(input.cwd, registryOptions); repositoryId = current.repository_id || null; } catch { repositoryId = null; }
      // Governance confirmed off (the merged binding disables it, or the user's no): turns queued
      // offline for this repository on this computer are never written, so they are deleted now.
      if (current && current.state === 'DISABLED' && ['M2', 'R2'].includes(current.rule) && current.root) {
        try { require('../../skills/github-program-reconciler/scripts/programme-checkpoint.cjs').discardQueuesFor(current.root, programmeDeps); } catch { /* the next turn end discards it */ }
      }
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

  // The first held message in this run shows the question. Its existing timestamp is the
  // freshness boundary for Projects replies; no separate question store is needed.
  askedAt(repositoryId, sessionId, marks) {
    const { session = null, repository = null } = marks || {};
    if (typeof sessionId !== 'string' || sessionId === '' || !EPOCH.test(String(session))) return null;
    const list = this.#read().repositories[repositoryId];
    const entry = Array.isArray(list) && list.find(item => item && item.session_id === sessionId
      && item.epoch === session && (item.repository_mark || null) === repository);
    const at = entry ? Date.parse(entry.at) : NaN;
    return Number.isFinite(at) ? at : null;
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

  // Held text is returned after "later". Its existing answer time fences subsequent full answers.
  answeredAt(repositoryId, sessionId) {
    return Date.parse(NotNow.#sessions(this.#read().repositories[repositoryId])[sessionId]);
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

// Reply tickets (owner decision of 28 Oct: the agent reads what the user means, Toolkit only checks
// it is the user's own reply). When the user's own message arrives in a run that was shown the
// question and is not one of the exact answers, Toolkit hands that message to the agent with a
// one-use ticket bound to the session, the run, the message and the one folder asked about. The
// agent records the answer it read with toolkit-governance-answer.cjs and the ticket; the ticket is
// spent on first use, only the newest one per session counts, it lapses after half an hour, and one
// thread message never gets a second ticket. Kept next to the registry, the ticket itself hashed.
//
// A confirmation is the same store's other kind of entry: when the agent records `confirm-<answer>`
// with a ticket (because it is unsure), the session gets a pending
// confirmation of exactly one answer, and any live ticket of the session is dropped. The user's next
// own message in that run is then read only as a reply to that question: its ticket records that
// one answer or nothing, and the pending confirmation ends with it. A pending confirmation is kept
// for its run, up to the seven days held messages are kept, and never pushed out by other sessions'
// tickets. Unreadable or damaged state holds; delivery receipts are never discarded for recovery.
// The filename stays fixed so the old schema is explicitly converted once, in place.
const TICKETS_BASENAME = 'governance-reply-tickets.v1.json';
const TICKETS_SCHEMA = 'toolkit.governance-reply-tickets.v2';
const TICKET = /^[0-9a-f]{32}$/;
const MAX_TICKET_AGE_MS = 30 * 60 * 1000;
const MAX_TICKET_SESSIONS = 32;
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

  // Unreadable or damaged state holds. Never discard spent delivery ids to recover authority.
  #read() {
    let text;
    try { text = fs.readFileSync(this.#file, 'utf8'); } catch (error) {
      if (error && error.code === 'ENOENT') return { schema: TICKETS_SCHEMA, sessions: {}, deliveries: [] };
      throw new GovernanceGateError('REPLY_TICKETS_UNREADABLE');
    }
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    const sessions = parsed && parsed.sessions && typeof parsed.sessions === 'object' && !Array.isArray(parsed.sessions);
    if (sessions && parsed.schema === 'toolkit.governance-reply-tickets.v1' && Array.isArray(parsed.used)
      && parsed.used.every(id => typeof id === 'string')) {
      // Convert raw spent ids to timed hashes without changing existing tickets or confirmations.
      // Fence older wrapped deliveries too, since the old capped list may have evicted their ids.
      const kept = Object.fromEntries(Object.entries(parsed.sessions).map(([id, { message, ...entry }]) => [id, entry]));
      parsed = { schema: TICKETS_SCHEMA, sessions: kept, converted_at: this.#now().toISOString(),
        deliveries: [...new Set(parsed.used)].map(id => ({ id: deliveryHash(id), at: this.#now().toISOString() })) };
      this.#save(parsed);
    }
    if (!sessions || parsed.schema !== TICKETS_SCHEMA || !Array.isArray(parsed.deliveries)
      || parsed.deliveries.some(entry => !entry || !/^[0-9a-f]{64}$/.test(entry.id) || !Number.isFinite(Date.parse(entry.at)))) {
      throw new GovernanceGateError('REPLY_TICKETS_MALFORMED');
    }
    return { ...parsed, deliveries: currentReceipts(parsed.deliveries, this.#now()) };
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
      const converted = typeof data.converted_at === 'string' ? { converted_at: data.converted_at } : {};
      const text = `${JSON.stringify({ schema: TICKETS_SCHEMA, sessions: Object.fromEntries(sessions), deliveries: data.deliveries, ...converted })}\n`;
      fs.writeFileSync(temp, text, { mode: 0o600 });
      fs.renameSync(temp, this.#file);
      if (fs.readFileSync(this.#file, 'utf8') !== text) throw new GovernanceGateError('REPLY_TICKETS_READBACK');
    } finally {
      fs.rmSync(temp, { force: true });
    }
  }

  // A new ticket after acceptDelivery checked this message, replacing any earlier ticket or pending
  // confirmation of the session. With command, the ticket is bound to
  // that answer: it records only it (the reply to a confirmation). Throws when the file cannot be
  // read or written.
  issue(sessionId, epoch, repositories, command = null) {
    const data = this.#read();
    const ticket = crypto.randomBytes(16).toString('hex');
    data.sessions[sessionId] = { hash: ticketHash(ticket), epoch, at: this.#now().toISOString(), repositories, ...(command ? { command } : {}) };
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

  // Claims a wrapped reply before any effect or ticket. Bare replies keep their existing route.
  acceptDelivery(message, notBefore) {
    if (!message.wrapped) return true;
    const data = this.#read();
    if (!message.approvalEligible) return false;
    // Legacy stores capped spent ids. No pre-conversion delivery may become fresh authority even
    // if its id had already fallen out of that cap.
    const converted = Date.parse(data.converted_at);
    if (Number.isFinite(converted) && Date.parse(message.sentAt) <= converted) return false;
    const receipt = deliveryReceipt(message, data.deliveries, this.#now(), notBefore);
    if (!receipt) {
      if (data.deliveries.length >= MAX_DELIVERIES) throw new GovernanceGateError('REPLY_DELIVERY_CAPACITY');
      return false;
    }
    data.deliveries.push(receipt);
    this.#save(data);
    return true;
  }

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
    return { command: entry.pending, repositories: entry.repositories, at: entry.at };
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
  return [
    `Toolkit governance: the user's message above came after Toolkit asked them whether to turn on GitHub governance for the repository ${repositoryNames(repositories)}. Read what they mean before anything else.`,
    `- If it clearly answers yes, no or later (in any words, such as "ur rec" after your recommendation of no), record it by running exactly this once, with yes, no or later in place of ANSWER:\n  node "${ANSWER_SCRIPT}" ANSWER ${ticket}\n  Then tell the user in plain words what Toolkit recorded.`,
    `- If you think they mean one answer but are not sure, record nothing yet: run exactly this once, with yes, no or later in place of ANSWER:\n  node "${ANSWER_SCRIPT}" confirm-ANSWER ${ticket}\n  Toolkit then gives you the question to ask, naming exactly what it would record; their reply to it comes with a ticket that can record only that answer.`,
    `- If it is unclear, a question, or about something else, record nothing: ask again in plain words, "${listedQuestion(repositories).replace(/^Toolkit: t/, 'T')}", and end your turn.`,
    `The ticket works once, only in this session, and only for this message. ${NEVER_OWNER}`,
  ].join('\n');
}

// The confirmation question for one answer: what Toolkit would record, for which repositories.
const ANSWER_EFFECTS = Object.freeze({ enable: 'turn on GitHub governance', disable: 'keep GitHub governance off (never ask again)', 'not-now': 'leave GitHub governance undecided until next session' });
function confirmQuestion(repositories, command) {
  return `Toolkit will ${ANSWER_EFFECTS[command]} for ${repositoryNames(repositories)}. Is that right?`;
}

// What the agent is told when a bare yes, no or later arrives for a question asked from a folder
// that is not held: it may answer the agent's own question, so nothing is recorded yet.
function confirmTicketContext(repositories, command, ticket) {
  return [
    `Toolkit governance: the user's message above is their reply to the question "${confirmQuestion(repositories, command)}". Nothing is recorded yet.`,
    `- If it says yes to that question, run exactly this once:\n  node "${ANSWER_SCRIPT}" ${COMMAND_WORDS[command]} ${ticket}\n  Then tell the user in plain words what Toolkit recorded. This ticket records "${COMMAND_WORDS[command]}" and nothing else.`,
    `- If it says no, is unclear, or is about something else, record nothing. To ask about governance again, ask in plain words, "${listedQuestion(repositories).replace(/^Toolkit: t/, 'T')}", and end your turn.`,
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

// Said to the agent wherever it meets the question: only the user answers.
const NEVER_OWNER = 'Never act as the user: do not answer the governance question yourself, start a session or script to answer it, or click a confirmation through a UI or computer use.';
// The same rule in the short form the held-message notices end with.
const NEVER_OWNER_SHORT = 'only the user answers; never answer, script or click it for them.';

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

// The one folder a reply ticket covers, named so the user knows which.
function repositoryNames(repositories) { return repositories.map(item => path.basename(item.root) || item.root).join(', '); }
function listedQuestion(repositories) {
  return `Toolkit: turn on GitHub governance (issues, records, evidence store) for the repository ${repositoryNames(repositories)}? Reply yes, no or later.`;
}
const LAUNCHED_TEXT = `Toolkit: an automated session cannot answer the governance question. Answer it in your own chat, or run the command in your own terminal. ${NEVER_OWNER}`;
function noMarkText(commands) {
  return `Toolkit: this session started before Toolkit could note it, so it cannot take the governance answer. Start a new session and answer there (in Codex, trust Toolkit's SessionStart hook in /hooks first, or no session can be noted), or run ${commands.map(terminalCommand).join(' or ')} in your own terminal.`;
}
const RESUMED_LINE = 'Toolkit: this session was resumed, or another session started in this repository, so Toolkit asks again and your reply was held.';
const REPEAT_TEXT = 'Toolkit: this Projects reply is repeated, too old, from before this question, or has an invalid delivery time. Nothing was recorded. Send a fresh reply after the question.';
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
  #gate; #held; #notNow; #epochs; #notes; #tickets; #registryOptions; #environment; #now; #picker;

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
    if (verdict.reason === 'not-now') {
      if (!answer || !ownTyped(message)) return { action: 'pass' };
      if (this.#launched(sessionId)) return { action: 'block', reason: LAUNCHED_TEXT };
      const marks = this.#marks(verdict, sessionId);
      const claim = this.#claim(message, verdict.state.repository_id, sessionId, marks, this.#notNow.answeredAt(verdict.state.repository_id, sessionId));
      return claim || this.#afterNotNow(cwd, text, answer, verdict, sessionId);
    }
    if (!verdict.hold) return verdict.reason === 'no-git' ? { action: 'pass' } : this.#replayIfAny(verdict.state, sessionId);
    if (verdict.reason === 'state-unreadable') return { action: 'block', reason: unreadableText(verdict.state, this.#registryOptions) };
    // A session another session or a launcher started never answers and never adds to what is held.
    if (this.#launched(sessionId)) return { action: 'block', reason: answer || SHORT_ANSWER.test(reply) ? LAUNCHED_TEXT : LAUNCHED_HOLD_TEXT };
    const marks = this.#marks(verdict, sessionId);
    // Only the run of the session that was shown the question answers it, in either form.
    const id = verdict.state.repository_id;
    const asked = this.#held.asked(id, sessionId, marks);
    if (asked && ownTyped(message)) {
      const claim = this.#claim(message, id, sessionId, marks);
      if (claim) return claim;
    }
    if (answer && asked && ownTyped(message)) { this.#dropTicket(sessionId); return this.#answer(cwd, answer[1].toLowerCase(), verdict, sessionId, marks); }
    // After the agent asked the user to confirm one answer, their next own message, a bare yes
    // included, is read only as the reply to that question.
    if (asked && ownTyped(message)) {
      const confirmed = this.#confirmReply(sessionId, marks.session);
      if (confirmed && !(confirmed.lost && !message.wrapped && SHORT_ANSWER.test(reply))) {
        this.#held.add(id, prompt, sessionId, marks, verdict.state.root);
        return confirmed.hold ? { action: 'block', reason: PromptHold.reask(confirmed) } : confirmed;
      }
    }
    const short = SHORT_ANSWER.exec(reply);
    if (short && asked && ownTyped(message)) { this.#dropTicket(sessionId); return this.#answer(cwd, SHORT_COMMANDS[short[1].toLowerCase()], verdict, sessionId, marks); }
    const unmarked = this.#unmarked(sessionId, marks, answer || short);
    if (unmarked) return unmarked;
    // Any other message of the user's own in the run that was asked may be their reply in other
    // words: it is kept like any held message and handed to the agent with a reply ticket.
    if (asked && !answer && !short && ownTyped(message)) {
      const ticketed = this.#ticket(sessionId, marks.session, [{ id, root: verdict.state.root, mark: marks.repository || null }]);
      if (ticketed) { this.#held.add(id, prompt, sessionId, marks, verdict.state.root); return ticketed; }
    }
    const resumed = Boolean(answer || short) && this.#held.count(id, sessionId) > 0;
    const held = this.#held.add(id, prompt, sessionId, marks, verdict.state.root);
    const question = count => questionText(verdict, count);
    const ask = notice => this.#ask(notice, sessionId, marks);
    // Even a first, pre-question delivery must stay spent if the host delivers it again. It cannot
    // answer now; keeping its id also covers hosts whose timestamps have only second precision.
    if (!asked && message.wrapped && ownTyped(message)) {
      const claim = this.#claim(message, null, sessionId, marks);
      if (claim && !claim.reason.startsWith(REPEAT_TEXT)) return ask(`${claim.reason}\n${question(1)}`);
    }
    if (resumed) return ask(`${RESUMED_LINE}\n${question(1)}`);
    // A session sees the whole question on its first held message, even when another session is waiting too.
    // Each run sees the whole question on its own first held message: a resumed run is a new run.
    const shown = typeof sessionId === 'string' && sessionId !== '' ? this.#held.countRun(id, sessionId, marks.session) : held;
    const earlier = shown === 1 && typeof sessionId === 'string' && sessionId !== '' && this.#held.count(id, sessionId) > 1;
    return ask(earlier ? `${RESUMED_LINE}\n${question(1)}` : question(shown));
  }

  // A wrapped delivery must be fresh, after the question, and unused across every run. Persist the
  // receipt before any decision or ticket; a failure leaves the repository held and grants nothing.
  #claim(message, repositoryId, sessionId, marks, notBefore = null) {
    if (!message.wrapped) return null;
    try {
      let after = notBefore === null && repositoryId ? this.#held.askedAt(repositoryId, sessionId, marks) : notBefore;
      const pending = this.#tickets.pending(sessionId, marks.session);
      if (pending && pending.repositories.some(item => item.id === repositoryId)) {
        after = Math.max(after, Date.parse(pending.at));
      }
      if (!this.#tickets.acceptDelivery(message, after)) return { action: 'block', reason: REPEAT_TEXT };
    } catch (error) {
      if (codeOf(error) === 'REPLY_DELIVERY_CAPACITY') return { action: 'block', reason: 'Toolkit: the local Projects delivery-receipt store is full, so nothing was recorded. Keep its spent receipts; wait for receipts to expire within 24 hours and 2 minutes, then send a fresh reply.' };
      return { action: 'block', reason: `Toolkit: the reply could not be checked or kept (${codeOf(error)}), so nothing was recorded. Restore the local reply-ticket state, then reply again, or run ${terminalCommand('disable')} in your own terminal. Do not delete delivery receipts.` };
    }
    return null;
  }

  // The user's reply to a pending confirmation of this run: a ticket that records only the answer
  // that question named, which ends the confirmation. null when none is pending; { hold: true } when
  // one may be pending but no ticket can be given (the store cannot be read or written, or this
  // thread message already had a ticket), so the reply is never read another way.
  #confirmReply(sessionId, epoch) {
    let pending = null;
    try {
      pending = this.#tickets.pending(sessionId, epoch);
    } catch { return { hold: true, lost: true }; }
    if (!pending) return null;
    let ticket = null;
    try { ticket = this.#tickets.issue(sessionId, epoch, pending.repositories, pending.command); } catch { ticket = null; }
    return ticket ? { action: 'pass', context: confirmTicketContext(pending.repositories, pending.command, ticket) } : { hold: true, pending };
  }

  // The re-ask when a reply cannot be matched to the confirmation: the same confirmation question
  // word for word while it is known, else only the full answer, since the question may be lost.
  static reask(hold) {
    return hold.pending
      ? `${REASK_LINE} The question is still: "${confirmQuestion(hold.pending.repositories, hold.pending.command)}"`
      : `${REASK_LINE} The reply state could not be read. Restore its read/write access or an intact local copy, keep spent delivery receipts, then answer again.`;
  }

  // An answer recorded another way ends any ticket or confirmation the session still holds.
  // Bare exact answers do not use receipts. Cleanup must not make them depend on ticket state.
  #dropTicket(sessionId) {
    try { this.#tickets.drop(sessionId); } catch { /* keep damaged receipts intact */ }
  }

  // A reply ticket for this message and these repositories, with what the agent is told; null when
  // this thread message already had one or no ticket can be kept.
  #ticket(sessionId, epoch, repositories) {
    if (typeof sessionId !== 'string' || sessionId === '' || !EPOCH.test(String(epoch))) return null;
    let ticket;
    try { ticket = this.#tickets.issue(sessionId, epoch, repositories); } catch { ticket = null; }
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
    // A ticket for the reply to a confirmation records only the answer that question named.
    if (found.command && (asking || found.command !== command)) {
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

  // The ticket answers only the repository identity and marks shown in this run.
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
    if (failed.length > 0) {
      const recorded = done.length > 0 ? ` It was recorded for ${repositoryNames(done.map(({ item }) => item))}.` : '';
      return { action: 'block', reason: `${failed.map(({ item, result }) => `${repositoryNames([item])}: ${result.reason}`).join('\n')}${recorded}` };
    }
    const lines = [`The user's message is their answer (${command === 'not-now' ? 'later' : command === 'enable' ? 'yes' : 'no'}) to Toolkit's GitHub governance question for ${repositoryNames(asked)}; it is not a reply to anything else.`];
    for (const { item, result } of done) lines.push(`${repositoryNames([item])} (${item.root}): ${result.context}`);
    if (moved.length > 0) lines.push(`Nothing was recorded for ${repositoryNames(moved)}: it was decided elsewhere, its origin changed, or a session started there since the question, so Toolkit asks again there.`);
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

// A shell call's text as every check reads it (toolkit-shell-call.cjs), with an apply_patch-style
// input or patch a host may send alongside it. An argument list is read both ways: quoted word for
// word, and its words joined unquoted, so a word that holds shell syntax is still screened as syntax.
function toolText(input) {
  const args = input && input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  const call = ShellCall.from(input);
  // Read twice only when the two readings differ: a repeated command reads as two commands.
  const joined = call.joinedWords !== call.text ? call.joinedWords : '';
  return [call.text, joined, args.input, args.patch].filter(value => typeof value === 'string' && value).join('\n');
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
      targets.push(shellPath(cwd, expanded));
    }
  }
  return targets;
}

// Absolute paths a shell command names (`/srv/repo/AGENTS.md`, `C:\\repo\\x`, `~/repo`), the first few.
const SHELL_WORD = /"((?:[^"\\]|\\.)*)"|'([^']*)'|([^\s;&|()<>"'=`]+)/g;
const MAX_PATH_WORDS = 16;
function absoluteTargets(text) {
  const targets = [];
  for (const match of text.matchAll(SHELL_WORD)) {
    const word = match[1] ?? match[2] ?? match[3];
    if (!word || !/^(?:\/|~(?=$|[\\/])|[A-Za-z]:[\\/]|\\\\)/.test(word)) continue;
    targets.push(word.startsWith('~') ? path.join(os.homedir(), word.slice(1)) : shellPath(process.cwd(), word));
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
  #gate; #epochs; #notes; #tickets; #notNow; #registryOptions;

  // host is set by the hook entry point ('claude' or 'codex'), never read from the payload.
  constructor({ registryOptions = {}, stateReader = null, now } = {}) {
    this.#gate = new GovernanceGate({ registryOptions, stateReader, now });
    this.#epochs = new SessionEpochs({ registryOptions, now });
    this.#notes = new PickerNotes({ registryOptions, now });
    this.#tickets = new ReplyTickets({ registryOptions, now });
    this.#notNow = new NotNow({ registryOptions, now });
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
      // Recording the answer the agent read from the user's own reply, with this session's live
      // ticket, runs wherever the session is; the script checks the ticket again as it records.
      if (tool !== 'Monitor' && ticketCommand(text, sessionId, this.#tickets)) return null;
      if (answerCommand(text)) {
        return { deny: `Toolkit: only the user answers the governance question. Ask them in chat instead: "${ASK}" Toolkit records their own reply. ${NEVER_OWNER}` };
      }
    }
    if (EDIT_TOOLS.test(tool) && editTargets(input).some(target => USER_STATE_PATH.test(resolveTarget(input, target)))) {
      return { deny: `Toolkit: its user-state files (governance decisions and held messages) are changed only by Toolkit itself. ${NEVER_OWNER}` };
    }
    if (tool === PICKER_TOOL) return this.#picker(input, sessionId);
    // A prompt the agent schedules for itself could arrive as bare text and read as the user's reply,
    // so none is scheduled while this run has a reply ticket, confirmation or "later" answer open.
    if (SCHEDULE_TOOLS.test(tool) && this.#questionOpen(sessionId)) {
      return { deny: `Toolkit: this session has Toolkit's governance question open (or the user said "later" to it), so no prompt is scheduled for the rest of this run, unless the user answers it; after "later", only the full \`toolkit governance enable\` or \`disable\` sent as a message does. ${NEVER_OWNER}` };
    }
    if (ALWAYS_TOOLS.test(tool)) return null;
    // Read-only tools are held too: Claude Code lets a held turn run to show the card, with the held
    // message in front of Claude, and only the card runs on it.
    const verdict = this.#gate.evaluate(input && input.cwd, { sessionId });
    if (verdict.hold) {
      if (verdict.reason === 'state-unreadable') return { deny: [`Toolkit: the governance state of this repository could not be read (${verdict.state.error_code}), so nothing runs here until it can.`, governance.repairHint(verdict.state, this.#registryOptions), NEVER_OWNER].filter(Boolean).join(' ') };
      return { deny: `Toolkit: this repository has no governance decision yet, so nothing runs here. Ask the user in plain words: "${ASK}" Toolkit records their own reply, so never ask them to run a command, and do not try to work around it. ${NEVER_OWNER}` };
    }
    // From a folder that is not held, a command or edit may still reach into one that is.
    return this.#reachesHeld(tool, input, sessionId);
  }

  // A command or edit from a folder that is not held that works in one that is: refused, and the
  // user answers in that repository's own chat. The folders a shell call names (Codex's workdir, the
  // tool's cwd, a `cd` or `-C` target, a full path) are its targets.
  #reachesHeld(tool, input, sessionId) {
    let targets = [];
    if (SHELL_TOOLS.test(tool)) {
      const text = toolText(input);
      const call = ShellCall.from(input);
      targets = [...new Set([...call.folders, ...commandTargets(text, call.folder), ...absoluteTargets(text)])];
    } else if (EDIT_TOOLS.test(tool)) {
      targets = editTargets(input).map(target => path.dirname(resolveTarget(input, target)));
    }
    if (!targets.some(target => this.#verdict(target, sessionId)?.hold)) return null;
    return { deny: `Toolkit: this ${SHELL_TOOLS.test(tool) ? 'command works' : 'edit is'} in a repository that is waiting for the user's governance answer, so it is refused. Ask the user to answer in that repository's own chat first; do not try to work around it. ${NEVER_OWNER}` };
  }

  // Whether this run has a live reply ticket or confirmation, or a "later" answer (after which the
  // full answer still decides in the same run).
  // When that cannot be read it counts as open.
  #questionOpen(sessionId) {
    if (typeof sessionId !== 'string' || sessionId === '') return false;
    try {
      const epoch = this.#epochs.get(sessionId);
      // A confirmation whose repositories were all decided elsewhere is over.
      const pending = this.#tickets.pending(sessionId, epoch);
      if (pending && pending.repositories.every(item => this.#verdict(item.root, sessionId)?.reason === 'decided')) this.#tickets.drop(sessionId);
      return this.#tickets.live(sessionId, epoch) || this.#notNow.anyFor(sessionId, epoch);
    } catch { return true; }
  }

  // The gate's verdict for a folder a command names, or null when it cannot be told.
  #verdict(target, sessionId) {
    try { return this.#gate.evaluate(target, { sessionId }); } catch { return null; }
  }

}

// ---- session line -----------------------------------------------------------------------------

function sessionLine(cwd, { registryOptions = {}, stateReader = null, now, sessionId = null, programmeDeps = {} } = {}) {
  const verdict = new GovernanceGate({ registryOptions, stateReader, now }).evaluate(cwd, { sessionId });
  const state = verdict.state;
  if (verdict.reason === 'not-now') return 'Toolkit governance: not decided yet; the user said "later" for this session. Follow the global rules (coding gates included) without GitHub governance; Toolkit asks again next session. If the user wants to decide sooner, they can send `toolkit governance enable` or `toolkit governance disable` as a message.';
  if (verdict.hold) {
    if (verdict.reason === 'state-unreadable') return [`Toolkit governance: the state of this repository could not be read (${state.error_code}). Every user message is held until it can; do not try to work around it.`, governance.repairHint(state, registryOptions), NEVER_OWNER].filter(Boolean).join(' ');
    return `Toolkit governance: this repository has no GitHub governance decision yet. Every user message is held until the user answers Toolkit's question. If you need to raise it, ask "${ASK}"; Toolkit records their own reply, so never ask them to run a command, and do not try to work around it. ${NEVER_OWNER}`;
  }
  const decided = decidedLine(state);
  const programme = state.state === 'ENABLED' && state.materials_complete !== false ? programmeLines(state, registryOptions, programmeDeps) : [];
  return [decided, ...programme].join(' ');
}

// For an ENABLED repository: the attention line from this computer's cache, a Programme sweep line
// when this computer's hourly sweep is not running well, and a Checkpoint line for
// each session here whose last turn-end record failed. Reads local files only (no git, gh or network
// call); a missing or old cache starts `programme.cjs refresh` in the background. Any failure only
// drops these lines.
function programmeLines(state, registryOptions = {}, deps = {}) {
  const lines = [];
  try {
    const binding = (deps.mergedBinding || governance.mergedBinding)(state.root, registryOptions);
    if (!binding || !binding.repository) return lines;
    const cache = require('../../skills/github-program-reconciler/scripts/programme-attention-cache.cjs');
    const attention = cache.sessionAttention(binding.repository, deps);
    // Not where governance reads are switched off (a test run, TOOLKIT_GOVERNANCE_OFFLINE=1, a test
    // registry), and at most one start per 15 minutes per repository on this computer.
    const offline = (deps.environment || process.env).TOOLKIT_GOVERNANCE_OFFLINE === '1' || registryOptions.testOnly === true;
    let started = false;
    if (attention.refresh && (deps.startRefresh || !offline) && cache.claimBackgroundStart(binding.repository, deps)) {
      try { (deps.startRefresh || require('../../skills/github-program-reconciler/scripts/programme-refresh-trigger.cjs').startRefresh)(state.root, deps); started = true; } catch { /* the hourly sweep covers it */ }
    }
    if (attention.line) lines.push(`${attention.line}${started ? '; a refresh has started in the background' : ''}.`);
    // This computer's hourly sweep, when it skipped, failed or has not run for over 2 hours. A test
    // registry without its own home reads nothing.
    if (deps.home || registryOptions.testOnly !== true) {
      const now = deps.now ? new Date(deps.now()) : new Date();
      const sweep = require('./toolkit-tasks.cjs').sweepLine(binding.repository, { home: deps.home, now });
      if (sweep) lines.push(sweep);
    }
  } catch { /* no attention line */ }
  try {
    const checkpoint = require('../../skills/github-program-reconciler/scripts/programme-checkpoint.cjs');
    for (const session of checkpoint.localSessionsFor(state.root, deps)) {
      if (session.errors.pending) lines.push(`Checkpoint: last turn's record failed (${session.errors.pending.code}); see programme.cjs show --session <that session's id> (session ${session.hash.slice(0, 8)}).`);
    }
  } catch { /* no checkpoint line */ }
  return lines;
}

function decidedLine(state) {
  if (state.rule === 'S1') return "Toolkit governance: DISABLED here: this repository is an evidence store (agent-managed, not governed). Follow the global rules; the evidence-store rules in the governed repository's AGENTS.md apply.";
  if (state.rule === 'R1s') return "Toolkit governance: DISABLED here: this repository is a scratch clone in another repository's ignored .tmp folder (not governed). Follow the global rules, coding gates included.";
  if (state.rule === 'R1') return 'Toolkit governance: DISABLED automatically (this folder is not a git repository, so there is no GitHub governance). Follow the global rules, coding gates included.';
  if (state.rule === 'R8') return `Toolkit governance: DISABLED automatically (it ${whereText(state)}, so GitHub governance cannot run here). Follow the global rules, coding gates included; any TOOLKIT-GOVERNED-RULES block in AGENTS.md does not apply.`;
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
  HOST_SESSION_VARIABLE,
  LAUNCHER_MARKERS,
  SessionEpochs,
  NOT_NOW_BASENAME,
  ReplyTickets,
  TICKETS_BASENAME,
  ANSWER_SCRIPT,
  ownerReply,
  ownerMessage,
  hasFrameMarkup,
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
  PICKER_INPUT,
  PICKER_QUESTION,
  pickerInput,
});
