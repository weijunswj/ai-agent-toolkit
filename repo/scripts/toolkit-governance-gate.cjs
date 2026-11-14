'use strict';

// The hook checks for per-repository governance, shared by the Claude Code and Codex hooks. Nothing
// is ever held for the governance question: an undecided repository counts as off, work carries on,
// and the user is asked once per run of a session until a decision is merged.
//
//   - GovernanceGate reads where a working directory stands: a plain folder, a decided repository,
//     an undecided one this run has or has not been asked about, a pending decision pull request,
//     or a state that could not be checked. The state lives only in the user-state files: nothing
//     is written into the repository or folder.
//   - PromptHold is the UserPromptSubmit core. The first own message of a run in an undecided
//     github.com repository is let through with the question attached once: Toolkit's tap-to-answer
//     card in Claude Code (AskUserQuestion), text for the agent to put to the user elsewhere. The
//     run is noted as asked (AskedRuns) and is not asked again; the next session is. The user
//     answers by tapping the card, by sending `toolkit governance enable` or `disable` as a whole
//     message (`decline` is the older word for disable), or in their own words: their next own
//     message after the question goes to the agent with a one-use reply ticket (ReplyTickets, owner
//     decision of 28 Oct), and the agent records what the user means with
//     toolkit-governance-answer.cjs, or, when unsure, has the user confirm one named answer, whose
//     reply can record only that answer. An answer counts only in the run that was asked
//     (SessionEpochs). A session another session or a Toolkit launcher started is never asked and
//     never answers. The only messages blocked are answers that cannot count.
//   - ToolGate is the PreToolUse core. It refuses no tool because a repository is undecided. In
//     every folder, exact checks stop an agent answering the question for the user: a command that
//     runs the governance CLI with a decision (or names a host next to the full answer phrase), an
//     edit to Toolkit's user-state files, Toolkit's card changed or pre-filled, and a prompt the
//     agent schedules for itself while the reply is awaited or that carries the full answer.
//     Reading free text for a host launch or a session resume or fork is not a hook: the written
//     rule (safety-gates playbook) covers it.
//   - sessionLine is the one SessionStart line that states the effective state.
//
// A failure of these checks is handled by the hook entry scripts, which keep their own fail-closed
// behaviour. Nothing here is printed to logs.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const governance = require('./toolkit-governance-state.cjs');
const { normaliseHost } = governance;
const { MAX_DELIVERIES, deliveryHash, currentReceipts, deliveryReceipt } = require('./toolkit-projects-delivery.cjs');
const { BankTickets, bankTicketContext, bankTicketCommand } = require('./toolkit-governance-bank.cjs');

// Earlier versions kept held messages in this file. Nothing is held now; the session-start hook
// removes the file, which is Toolkit's own, because its text is never delivered again.
const RETIRED_HELD_BASENAME = 'held-prompts.v1.json';
const NOT_NOW_BASENAME = 'governance-not-now.v1.json';
const NOT_NOW_SCHEMA = 'toolkit.governance-not-now.v1';
// A pending confirmation older than this is dropped: its session is long gone.
const MAX_CONFIRM_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ASKED_SESSIONS = 8;
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
// It counts only in a run of the host session that was asked the question. A bare yes, no or later is
// not read here: without a hold it may answer something else, so the user's next own message after
// the question goes to the agent to read, with a reply ticket (ReplyTickets).
// The reply the answer above is read from. Claude Code and Codex hand the hook what the user typed,
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
// passes: what stops a nested session answering is the same-run rule above (it was never asked, so
// nothing it sends answers) together with the refusal of sessions another session started.
function answerCommand(text) {
  return decisionAfterScript(text)
    || (/\b(?:claude|codex)\b/i.test(text) && /toolkit governance (?:enable|disable|decline)\b/i.test(text));
}
// The governance CLI given a decision word anywhere after it in the same command, so options before
// the decision (`--json enable`, `--repo . disable`) count too. Read word by word, in linear time.
// `--answers` and `--ticket` answer the governance bank; only the exact ticketed command passes (ToolGate).
const DECISION_WORDS = new Set(['enable', 'disable', 'decline', 'migrate', '--answers', '--ticket']);
function decisionAfterScript(text) {
  const pattern = /toolkit-governance\.cjs/gi;
  for (let found = pattern.exec(text); found; found = pattern.exec(text)) {
    const rest = text.slice(found.index + found[0].length).split(/[;&|\r\n]/, 1)[0];
    if (rest.split(/\s+/).some(word => DECISION_WORDS.has(word.replace(/^["']+|["']+$/g, '').toLowerCase()))) return true;
  }
  return false;
}

// The proposal code run from the shell: a runtime with the module named (its tests excepted).
function proposalRun(text) {
  return /\b(?:node|bun|deno)(?:\.exe)?\b/i.test(text) && /toolkit-governance-proposal(?!\.test)\b/i.test(text);
}
const TICKET_ARGUMENTS =/\b(?:confirm-)?(?:yes|no|later)\s+[0-9a-f]{32}\b/i;
const USER_STATE_PATH = /[\\/]\.ai-agent-toolkit[\\/]user-state(?:[\\/]|$)/i;
const PICKER_TOOL = 'AskUserQuestion';
const EDIT_TOOLS = /^(?:Edit|Write|MultiEdit|NotebookEdit|apply_patch)$/;
const { SHELL_TOOLS, ShellCall } = require('./toolkit-shell-call.cjs');
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
  #stateReader; #asked; #epochs; #proposals; #transport; #refreshBinding;

  constructor({ registryOptions = {}, stateReader = null, now = () => new Date(), environment = process.env, proposalTransport = null, refreshBinding = null } = {}) {
    const { GovernanceProposals, GitHubProposalTransport } = require('./toolkit-governance-proposal.cjs');
    this.#transport = proposalTransport || (registryOptions.testOnly || environment.TOOLKIT_GOVERNANCE_OFFLINE === '1' ? null : new GitHubProposalTransport());
    this.#proposals = new GovernanceProposals({ registryOptions, now, transport: this.#transport });
    this.#refreshBinding = refreshBinding || ((cwd, budget) => governance.refreshMergedBinding(cwd, registryOptions, budget));
    this.#stateReader = stateReader || (cwd => governance.governanceState(cwd, registryOptions));
    this.#asked = new AskedRuns({ registryOptions, now });
    this.#epochs = new SessionEpochs({ registryOptions, now });
  }

  // { open, reason, state } where reason is one of 'no-git' (a plain folder, DISABLED
  // automatically), 'decided', 'undecided' (the github.com question, not yet put to this run of the
  // session), 'asked' (this run was asked), 'pending' or 'unavailable'. `open` is true while the
  // question is open ('undecided' or 'asked'). Nothing is ever held for it: the repository counts as
  // off until a decision is merged. Identity and the state module decide; nothing is written into
  // the repository or folder. "Asked" lasts for the run of the session that was asked (its mark).
  evaluate(cwd, { sessionId = null, refreshPending = false } = {}) {
    let state = this.#stateReader(cwd);
    // Only a new prompt rechecks a known published proposal, never every tool call.
    if (refreshPending && this.#transport && state.state === 'UNDECIDED') {
      const deadline = Date.now() + require('./toolkit-governance-proposal.cjs').PROMPT_BUDGET_MS;
      try {
        const checked = this.#proposals.refreshPrompt(cwd, deadline);
        if (!checked.ok) return Object.freeze({ open: false, reason: 'unavailable', state });
        if (checked.closed) {
          const refreshed = this.#refreshBinding(cwd, { deadline });
          if (Date.now() >= deadline || refreshed?.refreshed === false) return Object.freeze({ open: false, reason: 'unavailable', state });
          state = this.#stateReader(cwd);
          this.#proposals.settle(cwd, state);
        }
      } catch { return Object.freeze({ open: false, reason: 'unavailable', state }); }
    }
    const verdict = (open, reason, pending = null) => Object.freeze({ open, reason, state, pending });
    if (state.state === 'UNAVAILABLE') return verdict(false, 'unavailable');
    if (state.state === 'UNDECIDED') {
      let pending;
      try { pending = this.#proposals.pending(cwd, { sessionId, epoch: this.#epochs.get(sessionId) }); } catch { pending = null; }
      if (pending) return verdict(false, pending.kind === 'unavailable' ? 'unavailable' : 'pending', pending);
    }
    if (state.state === 'UNDECIDED') return verdict(true, this.#asked.has(state.repository_id, sessionId, this.#epochs.get(sessionId)) ? 'asked' : 'undecided');
    return verdict(false, state.rule === 'R1' ? 'no-git' : 'decided');
  }
}

// ---- session epochs ---------------------------------------------------------------------------

// Random marks written by the session-start hook (both hosts run it in headless runs too) and kept
// in private operational state, one small file each: one per host session and one per repository. Starting,
// resuming or forking a session gives it a new session mark. The repository mark is created once,
// so another chat cannot invalidate this run; /clear and compaction keep both marks. A run that is asked is noted with both marks,
// and an answer counts only when both still match, so a later process (an agent's `claude -p yes
// --resume <id>`, or `claude -pc yes`, whatever session id it reports) cannot answer for the user.
// A session with no mark (it started before the hook could record one) cannot answer in chat at
// all. Neither host's hook input says whether a run is headless or who is typing, so this is the
// signal; one process an agent feeds several messages is the known limit.
class SessionEpochs {
  #folder; #now; #registryOptions; #environment; #host;

  constructor({ registryOptions = {}, now = () => new Date(), environment = process.env, host = null } = {}) {
    this.#folder = path.join(governance.userStateDirectory(registryOptions), SESSIONS_FOLDER);
    this.#now = now;
    this.#registryOptions = registryOptions;
    this.#environment = environment;
    this.#host = normaliseHost(host);
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

  #restricted(sessionId) {
    const mark = this.#record('s', sessionId);
    return mark && (mark.origin !== 'user-started' || mark.resumed === true || mark.forked === true
      || mark.resumedFromSessionShell === true || mark.resumeNeedsTypedMerge === true);
  }

  // A session mark notes whether the run was a resume or a fork, which another process may have started.
  #write(kind, key, source = null) {
    const epoch = crypto.randomBytes(16).toString('hex');
    fs.mkdirSync(this.#folder, { recursive: true });
    const file = this.#file(kind, key);
    const temp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    try {
      let provenance = {};
      if (kind === 's') {
        // Treat a resume carrying the host-session variable as a launch from a running session's shell.
        // Revoke origin for this id, across later starts too: clearing the variable or replaying
        // startup must never restore standing. Keep only presence, never the variable's value.
        const previous = this.#record(kind, key);
        const existing = fs.existsSync(file);
        const resumeHostSessionPresent = source === 'resume' && Object.hasOwn(this.#environment, HOST_SESSION_VARIABLE);
        const resumedFromSessionShell = resumeHostSessionPresent || previous?.resumedFromSessionShell === true;
        // Only Claude has the shell signal needed to distinguish a reconnect from an agent resume.
        // Host identity comes from the hook entry, never the event payload. Unknown hosts fail safe.
        const resumeNeedsTypedMerge = (source === 'resume' && this.#host !== 'claude-code') || previous?.resumeNeedsTypedMerge === true;
        const launched = LAUNCHER_MARKERS.some(name => typeof this.#environment[name] === 'string' && this.#environment[name] !== '');
        const host = this.#environment[HOST_SESSION_VARIABLE];
        const mismatch = typeof host === 'string' && host !== '' && host !== key;
        const priorOrigin = ['user-started', 'automation'].includes(previous?.origin) ? previous.origin : 'unknown';
        const origin = resumedFromSessionShell || launched || mismatch || priorOrigin === 'automation' ? 'automation'
          : source === 'startup' ? (existing ? priorOrigin : 'user-started')
          : source === 'resume' ? priorOrigin : 'unknown';
        provenance = { origin, resumeHostSessionPresent, resumedFromSessionShell, resumeNeedsTypedMerge,
          ...(RESUMED_SOURCES.includes(source) || previous?.resumed === true ? { resumed: true } : {}),
          ...(source === 'fork' || previous?.forked === true ? { forked: true } : {}) };
      }
      fs.writeFileSync(temp, `${JSON.stringify({ schema: SESSION_SCHEMA, epoch, at: this.#now().toISOString(), ...provenance })}\n`, { mode: 0o600 });
      fs.renameSync(temp, file);
    } finally {
      fs.rmSync(temp, { force: true });
    }
    this.#prune(kind);
    return epoch;
  }

  // This run's session mark, or null when there is none or it cannot be read.
  get(sessionId) { return this.#read('s', sessionId); }

  // Whether this session has resumed or forked; a later startup cannot clear that restriction.
  resumed(sessionId) { return this.#record('s', sessionId)?.resumed === true; }

  // Origin is authority only for standing merges, never for prompt or governance answers.
  origin(sessionId) {
    const origin = this.#record('s', sessionId)?.origin;
    return ['user-started', 'automation'].includes(origin) ? origin : 'unknown';
  }

  forked(sessionId) { return this.#record('s', sessionId)?.forked === true; }

  resumeHostSessionPresent(sessionId) { return this.#record('s', sessionId)?.resumeHostSessionPresent === true; }

  resumedFromSessionShell(sessionId) { return this.#record('s', sessionId)?.resumedFromSessionShell === true; }

  resumeNeedsTypedMerge(sessionId) { return this.#record('s', sessionId)?.resumeNeedsTypedMerge === true; }

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
  // one is removed, so the run has none and cannot answer. Restricted session marks are kept so a
  // later startup cannot turn revocation into fresh authority; asked runs forget their marks.
  // The repository's mark is handled either way, and one that cannot be replaced is removed,
  // so every run asked before it is asked again.
  // A mark that can be neither replaced nor removed (a locked file, a read-only folder) is left
  // behind, so the asked runs that carry it forget their marks instead
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
    try { epoch = this.#write('s', sessionId, source); } catch {
      if (this.#restricted(sessionId) || !this.#drop('s', sessionId)) stuck.session = sessionId;
    }
    if (!kept && SessionEpochs.#valid(repositoryId)) {
      try { if (!this.repository(repositoryId)) this.#write('r', repositoryId); } catch {
        if (!this.#drop('r', repositoryId)) {
          stuck.repository = repositoryId;
          if (epoch !== null && (this.#restricted(sessionId) || !this.#drop('s', sessionId))) stuck.session = sessionId;
          epoch = null;
        }
      }
    }
    if (stuck.session || stuck.repository) this.#forget(stuck);
    return epoch;
  }

  // Clears the marks that asked runs carry for a session or a repository
  // whose old mark stays in place. Best effort: a store that cannot be written is left as it is.
  #forget(stuck) {
    try { new AskedRuns({ registryOptions: this.#registryOptions, now: this.#now }).forget(stuck); } catch { /* best effort */ }
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
function startSession(input, { registryOptions = {}, now, environment = process.env, host = null, refreshBinding = null, proposalTransport = null, programmeDeps = {} } = {}) {
  try {
    let repositoryId = null;
    if (input && typeof input.cwd === 'string' && input.cwd && input.source !== 'clear' && input.source !== 'compact') {
      // Refresh the merged binding with bounded network reads into this computer's cache.
      try { (refreshBinding || governance.refreshMergedBinding)(input.cwd, registryOptions); } catch { /* offline keeps the last read */ }
      let current = null;
      try { current = governance.governanceState(input.cwd, registryOptions); repositoryId = current.repository_id || null; } catch { repositoryId = null; }
      if (current?.merged?.fresh && ['M1', 'M2'].includes(current.rule)) {
        try { new (require('./toolkit-governance-proposal.cjs').GovernanceProposals)({ registryOptions, now }).settle(input.cwd, current); } catch { /* repository decision still wins */ }
      }
      if (current?.state === 'UNDECIDED' && (proposalTransport || (registryOptions.testOnly !== true && environment.TOOLKIT_GOVERNANCE_OFFLINE !== '1'))) {
        try {
          const { GovernanceProposals, GitHubProposalTransport } = require('./toolkit-governance-proposal.cjs');
          new GovernanceProposals({ registryOptions, now, transport: proposalTransport || new GitHubProposalTransport() }).refresh(input.cwd);
        } catch { /* unavailable proposal discovery is reported by the gate */ }
      }
      // Governance confirmed off (the merged binding disables it, or the user's no): turns queued
      // offline for this repository on this computer are never written, so they are deleted now.
      if (current && current.state === 'DISABLED' && current.rule === 'M2' && current.root) {
        try { require('../../skills/github-program-reconciler/scripts/programme-checkpoint.cjs').discardQueuesFor(current.root, programmeDeps); } catch { /* the next turn end discards it */ }
      }
    }
    // Messages an earlier version held are never delivered again, so their file is removed.
    try { fs.rmSync(path.join(governance.userStateDirectory(registryOptions), RETIRED_HELD_BASENAME), { force: true }); } catch { /* housekeeping only */ }
    return new SessionEpochs({ registryOptions, now, environment, host }).start(sessionIdOf(input), input && input.source, repositoryId);
  } catch { return null; }
}

// ---- asked runs --------------------------------------------------------------------------------

// The runs that were asked the governance question, kept in private operational state: per
// repository, the sessions that were asked (the newest few) with each one's session and repository
// marks, and whether the reply window is still open (the user's next own message after the question
// may be their reply). Being asked decides nothing and holds nothing; a new session, or the same one
// resumed, is asked again. A missing, unreadable or damaged file counts as not asked, so the question
// is put again, and the next ask replaces it. The file keeps its earlier name: an earlier version
// wrote the runs that answered "later" there, which is the same state.
class AskedRuns {
  #file; #now;

  constructor({ registryOptions = {}, now = () => new Date() } = {}) {
    this.#file = path.join(governance.userStateDirectory(registryOptions), NOT_NOW_BASENAME);
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

  // Only the run that was asked (the same session mark); an entry without a mark never counts.
  has(repositoryId, sessionId, epoch) {
    if (!repositoryId || typeof sessionId !== 'string' || sessionId === '' || !EPOCH.test(String(epoch))) return false;
    const entry = this.#read().repositories[repositoryId];
    return Object.hasOwn(AskedRuns.#sessions(entry), sessionId) && AskedRuns.#map(entry, 'epochs')[sessionId] === epoch;
  }

  // Whether this run of the session was asked in any repository, so the full answer still decides there.
  anyFor(sessionId, epoch) {
    if (typeof sessionId !== 'string' || sessionId === '' || !EPOCH.test(String(epoch))) return false;
    return Object.values(this.#read().repositories).some(entry => Object.hasOwn(AskedRuns.#sessions(entry), sessionId) && AskedRuns.#map(entry, 'epochs')[sessionId] === epoch);
  }

  // Whether this run has its reply window open in any repository.
  windowFor(sessionId, epoch) {
    if (typeof sessionId !== 'string' || sessionId === '' || !EPOCH.test(String(epoch))) return false;
    return Object.values(this.#read().repositories).some(entry => AskedRuns.#map(entry, 'epochs')[sessionId] === epoch && AskedRuns.#map(entry, 'reply_windows')[sessionId] === true);
  }

  // The repository mark when the run was asked, or null.
  repositoryMark(repositoryId, sessionId) {
    const value = AskedRuns.#map(this.#read().repositories[repositoryId], 'repository_marks')[sessionId];
    return EPOCH.test(String(value)) ? value : null;
  }

  // When the run was asked. A Projects reply must be newer than this to count.
  answeredAt(repositoryId, sessionId) {
    return Date.parse(AskedRuns.#sessions(this.#read().repositories[repositoryId])[sessionId]);
  }

  // Clears what an asked run carries for a session (in any repository, as on a resume) or a
  // repository whose old mark could not be replaced (the full answer after it is asked again), as a
  // new mark would (SessionEpochs.start).
  forget({ session = null, repository = null } = {}) {
    const data = this.#read();
    let changed = false;
    for (const [id, entry] of Object.entries(data.repositories)) {
      const epochs = AskedRuns.#map(entry, 'epochs'), repositoryMarks = AskedRuns.#map(entry, 'repository_marks');
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

  // Whether the reply window of this asked run is open: its next own message may be the reply.
  window(repositoryId, sessionId) {
    return AskedRuns.#map(this.#read().repositories[repositoryId], 'reply_windows')[sessionId] === true;
  }

  // Closes the reply window; the run stays asked.
  closeWindow(repositoryId, sessionId) {
    const data = this.#read();
    const windows = AskedRuns.#map(data.repositories[repositoryId], 'reply_windows');
    if (windows[sessionId] !== true) return;
    delete windows[sessionId];
    this.#save(data);
  }

  // marks is { session, repository } of the run that was asked; without marks the session is removed.
  // window opens the reply window for the run's next own message.
  set(repositoryId, sessionId, marks = null, { window = false } = {}) {
    const data = this.#read();
    const entry = data.repositories[repositoryId];
    const sessions = { ...AskedRuns.#sessions(entry) };
    if (marks) sessions[sessionId] = this.#now().toISOString(); else delete sessions[sessionId];
    const newest = Object.entries(sessions).sort((a, b) => String(b[1]).localeCompare(String(a[1]))).slice(0, MAX_ASKED_SESSIONS);
    const epochs = { ...AskedRuns.#map(entry, 'epochs'), [sessionId]: marks && marks.session };
    const repositoryMarks = { ...AskedRuns.#map(entry, 'repository_marks'), [sessionId]: marks && marks.repository };
    const keep = values => Object.fromEntries(newest.map(([id]) => [id, values[id]]).filter(([, value]) => EPOCH.test(String(value))));
    const windows = { ...AskedRuns.#map(entry, 'reply_windows') };
    if (marks && window) windows[sessionId] = true; else delete windows[sessionId];
    const open = Object.fromEntries(newest.map(([id]) => [id, windows[id]]).filter(([, value]) => value === true));
    data.repositories[repositoryId] = { sessions: Object.fromEntries(newest), epochs: keep(epochs), repository_marks: keep(repositoryMarks), reply_windows: open };
    this.#save(data);
  }
}

// Reply tickets (owner decision of 28 Oct: the agent reads what the user means, Toolkit only checks
// it is the user's own reply). When the user's own message arrives in a run that was shown the
// question and is not one of the exact answers, Toolkit hands that message to the agent with a
// one-use ticket bound to the session, the run, the message and the one folder asked about. The
// agent records the answer it read with toolkit-governance-answer.cjs and the ticket; the ticket is
// spent on first use, only the newest one per session counts, it lapses after half an hour, and one
// thread message never gets a second ticket. Kept in private operational state, the ticket itself hashed.
//
// A confirmation is the same store's other kind of entry: when the agent records `confirm-<answer>`
// with a ticket (because it is unsure), the session gets a pending
// confirmation of exactly one answer, and any live ticket of the session is dropped. The user's next
// own message in that run is then read only as a reply to that question: its ticket records that
// one answer or nothing, and the pending confirmation ends with it. A pending confirmation is kept
// for its run, up to seven days, and never pushed out by other sessions'
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
  #file; #now; #gate;

  constructor({ registryOptions = {}, now = () => new Date(), gate = null } = {}) {
    this.#file = path.join(governance.userStateDirectory(registryOptions), TICKETS_BASENAME);
    this.#now = now;
    this.#gate = gate;
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

  // Whether an entry is still kept: a ticket for half an hour, a pending confirmation for up to
  // seven days (it ends with its run, a reply or a full answer, not with time).
  #current(entry) {
    if (!entry || typeof entry !== 'object') return false;
    const age = this.#now().getTime() - Date.parse(entry.at);
    return age <= (Object.hasOwn(entry, 'pending') ? MAX_CONFIRM_AGE_MS : MAX_TICKET_AGE_MS);
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

  // Old releases could ask about a folder now automatically DISABLED. Recheck every target before
  // using a ticket or confirmation; unreadable targets keep their entry. Lookups never save their snapshot:
  // stale entries stay on disk, ignored, until they lapse or a normal mutation replaces them.
  #refresh(sessionId, entry) {
    if (!this.#gate || !entry || !Array.isArray(entry.repositories)) return entry;
    const repositories = entry.repositories.filter(item => this.#gate.evaluate(item.root, { sessionId }).open);
    return repositories.length ? { ...entry, repositories } : null;
  }

  // The pending confirmation of this run, { command, repositories }, or null.
  pending(sessionId, epoch) {
    const data = this.#read();
    const entry = this.#refresh(sessionId, typeof sessionId === 'string' && Object.hasOwn(data.sessions, sessionId) ? data.sessions[sessionId] : null);
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
    const current = this.#refresh(owner, entry);
    return current ? { session_id: owner, ...current } : null;
  }

  peek(ticket, sessionId) { return this.#find(this.#read(), ticket, sessionId); }

  // Whether this run of the session holds a ticket that has not lapsed, or a pending confirmation.
  live(sessionId, epoch) {
    const data = this.#read();
    const entry = this.#refresh(sessionId, typeof sessionId === 'string' && Object.hasOwn(data.sessions, sessionId) ? data.sessions[sessionId] : null);
    return this.#current(entry) && EPOCH.test(String(epoch)) && entry.epoch === epoch;
  }

  // Spends the ticket and returns its entry, or null; a ticket that cannot be removed is not used.
  take(ticket) {
    const entry = this.#find(this.#read(), ticket, undefined);
    if (!entry) return null;
    const data = this.#read();
    if (data.sessions[entry.session_id]?.hash !== entry.hash) return null;
    delete data.sessions[entry.session_id];
    this.#save(data);
    return this.#find(this.#read(), ticket, undefined) === null ? entry : null;
  }
}

// What the agent is told when the user's own message may be their reply to the question.
function ticketContext(repositories, ticket) {
  return [
    `Toolkit governance: the user's message above is the first since Toolkit asked them whether to turn on GitHub governance for the repository ${repositoryNames(repositories)}. It may be their answer, or ordinary work. Read what they mean before anything else.`,
    `- If it clearly answers yes, no or later (in any words, such as "ur rec" after your recommendation of no), record it by running exactly this once, with yes, no or later in place of ANSWER:\n  node "${ANSWER_SCRIPT}" ANSWER ${ticket}\n  Then tell the user in plain words what Toolkit recorded.`,
    `- If you think they mean one answer but are not sure, record nothing yet: run exactly this once, with yes, no or later in place of ANSWER:\n  node "${ANSWER_SCRIPT}" confirm-ANSWER ${ticket}\n  Toolkit then gives you the question to ask, naming exactly what it would record; their reply to it comes with a ticket that can record only that answer.`,
    '- If it is about something else, a question, or unclear, record nothing and carry on with what they asked. Do not ask the governance question again; Toolkit asks next session, and they can send `toolkit governance enable` or `toolkit governance disable` as a message at any point in this one.',
    `The ticket works once, only in this session, and only for this message. ${NEVER_OWNER}`,
  ].join('\n');
}

// The confirmation question for one answer: what Toolkit would record, for which repositories.
const ANSWER_EFFECTS = Object.freeze({ enable: 'prepare a pull request to turn GitHub governance on', disable: 'prepare a pull request to turn GitHub governance off', 'not-now': 'leave GitHub governance undecided until next session' });
function confirmQuestion(repositories, command) {
  return `Toolkit will ${ANSWER_EFFECTS[command]} for ${repositoryNames(repositories)}. Is that right?`;
}

// What the agent is told when the user's reply to a confirmation question arrives: nothing is
// recorded until the agent has read it.
function confirmTicketContext(repositories, command, ticket) {
  return [
    `Toolkit governance: the user's message above is their reply to the question "${confirmQuestion(repositories, command)}". Nothing is recorded yet.`,
    `- If it says yes to that question, run exactly this once:\n  node "${ANSWER_SCRIPT}" ${COMMAND_WORDS[command]} ${ticket}\n  Then tell the user in plain words what Toolkit recorded. This ticket records "${COMMAND_WORDS[command]}" and nothing else.`,
    '- If it says no, is unclear, or is about something else, record nothing and carry on with what they asked.',
    `The ticket works once, only in this session, and only for this message. ${NEVER_OWNER}`,
  ].join('\n');
}

// Whether a shell command is exactly the answer command with a live ticket of this session: the one
// way an agent records the answer it read. The script must be Toolkit's own path as written
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

// The question as the user reads it. Nothing waits on the answer.
const QUESTION = [
  'Toolkit: this repository has no GitHub governance decision yet, so it counts as off. Turn on GitHub governance (issues, records, evidence store) for this repository?',
  'Reply `toolkit governance enable` or `toolkit governance disable` as a message, or just say yes, no or later. Nothing waits on your answer, and Toolkit asks again next session.',
];

function questionText(verdict) {
  const lines = [...QUESTION];
  if (verdict.state.notes && verdict.state.notes.includes('pending-binding-merge')) lines.splice(1, 0, 'Its working tree has a programme binding that is not merged on the default branch yet.');
  return lines.join('\n');
}

// The tap-to-answer card in Claude Code: the one AskUserQuestion input whose answer Toolkit records,
// and the answer each option records.
const PICKER_QUESTION = 'Turn on GitHub governance (issues, records, evidence store) for this repository?';
const PICKER_HEADER = 'Governance';
const PICKER_OPTIONS = Object.freeze([
  Object.freeze({ label: 'Yes', description: 'Prepare a repository on decision through a pull request; missing setup choices follow.' }),
  Object.freeze({ label: 'No', description: 'Prepare a repository off decision through a pull request; the coding rules still apply.' }),
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

// What Claude is told with the first message of a run in Claude Code: show the card once, then do
// what the user asked whatever they pick.
function pickerContext(notice) {
  return [
    'Toolkit governance: this repository has no governance decision yet, so it counts as off. Toolkit asks the user once per session, and nothing waits on the answer.',
    `1. First call AskUserQuestion once with exactly this input, adding no answers field: ${JSON.stringify(PICKER_INPUT)}`,
    '2. Then carry on with the user\'s message above, whatever they picked. If the card is refused or not answered, carry on the same way and do not show it again.',
    `If the card cannot be shown at all, put this to the user once instead, word for word:\n${notice}`,
    `For agents: ${NEVER_OWNER}`,
  ].join('\n');
}
// What the agent is told where the host has no card Toolkit can check (Codex): do the work, then put
// the question as the last lines of the reply.
function textContext(notice) {
  return [
    'Toolkit governance: this repository has no governance decision yet, so it counts as off. Toolkit asks the user once per session, and nothing waits on the answer.',
    '1. Do what the user asked in the message above.',
    `2. End your reply with this question, word for word, and ask nothing else in that reply:\n${notice}`,
    'Their next message comes to you with a way to record the answer if it is one.',
    `For agents: ${NEVER_OWNER}`,
  ].join('\n');
}
const PICKER_NOTICE = 'Toolkit: this repository has no governance decision yet. Pick an answer on the card, or carry on; nothing waits on it.';

// Where the repository lives, for the not-on-github.com notice.
function whereText(state) {
  if (state.host) return `is on ${state.host}`;
  return state.reason === 'origin-ambiguous' ? 'has more than one origin remote' : 'has no github.com origin remote';
}

// Said to the agent wherever it meets the question: only the user answers.
const NEVER_OWNER = 'Never act as the user: do not answer the governance question yourself, start a session or script to answer it, or click a confirmation through a UI or computer use.';
// The same rule in the short form the refusal notices end with.
const NEVER_OWNER_SHORT = 'only the user answers; never answer, script or click it for them.';

// What the agent is told once the user's own answer is on record, or once they said "later".
const LATER_CONTEXT = 'The user answered "later" to the Toolkit GitHub governance question. Nothing is decided: for the rest of this session follow the global rules (coding gates included) without GitHub governance, and Toolkit asks again next session. If the user wants to decide sooner, they can send `toolkit governance enable` or `toolkit governance disable` as a message.';
const ANSWERED_CONTEXT = 'Toolkit: the user answered the governance question. Its proposal is pending; governance stays as merged on the default branch.';

// The one folder a reply ticket covers, named so the user knows which.
function repositoryNames(repositories) { return repositories.map(item => path.basename(item.root) || item.root).join(', '); }
const LAUNCHED_TEXT = `Toolkit: an automated session cannot answer the governance question. Answer it in your own chat, or run the command in your own terminal. ${NEVER_OWNER}`;
function noMarkText(commands) {
  return `Toolkit: this session started before Toolkit could note it, so it cannot take the governance answer. Start a new session and answer there (in Codex, trust Toolkit's SessionStart hook in /hooks first, or no session can be noted), or run ${commands.map(terminalCommand).join(' or ')} in your own terminal.`;
}
const REPEAT_TEXT = 'Toolkit: this Projects reply is repeated, too old, from before this question, or has an invalid delivery time. Nothing was recorded. Send a fresh reply after the question.';
const REASK_LINE = 'Toolkit: your reply could not be matched to the confirmation question, so nothing was recorded.';
const REPLY_LOST = 'Toolkit: the local reply state could not be read, so nothing can be recorded from this message. Restore its read/write access or an intact local copy and keep spent delivery receipts; `toolkit governance enable` or `toolkit governance disable` as a message still works.';
// The note that this run was asked could not be saved, so no answer in chat can be matched to it.
const UNSAVED_LINE = `Toolkit could not note that it asked (its user-state folder could not be written), so an answer in chat cannot be recorded and this question comes with each message until that works. To decide now, run ${terminalCommand('enable')} or ${terminalCommand('disable')} in your own terminal.`;
const BANK_MOVED = 'Toolkit: this repository\'s session mark changed since the governance bank was shown, so this message cannot answer it. If it was meant as the answer, show the bank again (toolkit governance) and have the user reply to that one.';
const BANK_LOST = 'Toolkit: the reply to the governance bank could not be kept (its local state could not be written), so nothing can be recorded from this message. Show the bank again once that works.';
const MOVED_LINE = 'Toolkit: another session started in this repository since Toolkit asked, so nothing was recorded and Toolkit asks again.';
const PICKER_UNCOUNTED = `Toolkit governance: no answer was recorded from that card. Carry on with what the user asked; they can still send \`toolkit governance enable\` or \`toolkit governance disable\` as a message. ${NEVER_OWNER}`;
// A session the session-start hook never marked cannot be asked once or answer in chat.
const BARE_LINE = `Toolkit governance: this repository has no governance decision yet, so it counts as off. This session started before Toolkit could note it, so the user decides in a new session or by running ${terminalCommand('enable')} or ${terminalCommand('disable')} in their own terminal. ${NEVER_OWNER}`;

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
    this.#folder = path.join(governance.userStateDirectory(registryOptions), SESSIONS_FOLDER);
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

// ---- prompt decision --------------------------------------------------------------------------

// The host-neutral UserPromptSubmit decision: { action: 'pass' } | { action: 'pass', context } |
// { action: 'block', reason }.
class PromptHold {
  #gate; #asked; #epochs; #notes; #tickets; #bank; #registryOptions; #environment; #now; #picker;

  // The UserPromptSubmit core. It never holds a message for the question: the first own message of
  // a run in an undecided repository is let through with the question attached once, and the run is
  // noted as asked. picker: the host can show Toolkit's tap-to-answer card (Claude Code); elsewhere
  // the agent puts the question as text. The class keeps its name; the only messages it still blocks
  // are answers that cannot count (an automated or unnoted session, a repeated Projects delivery).
  constructor({ registryOptions = {}, environment = process.env, now = () => new Date(), stateReader = null, picker = false, proposalTransport = null, refreshBinding = null } = {}) {
    this.#registryOptions = registryOptions;
    this.#gate = new GovernanceGate({ registryOptions, stateReader, now, environment, proposalTransport, refreshBinding });
    this.#asked = new AskedRuns({ registryOptions, now });
    this.#epochs = new SessionEpochs({ registryOptions, now });
    this.#notes = new PickerNotes({ registryOptions, now });
    this.#tickets = new ReplyTickets({ registryOptions, now, gate: this.#gate });
    this.#bank = new BankTickets({ registryOptions, now });
    this.#environment = environment || {};
    this.#now = now;
    this.#picker = picker === true;
  }

  // sessionId is the host's session id; "asked" lasts for that session's run only. Whoever reads a
  // refusal, the user or an agent that started the run, is also told that only the user answers.
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
    if (!verdict.open) return null;
    const marks = this.#marks(verdict, sessionId);
    const id = verdict.state.repository_id;
    const counts = verdict.reason === 'asked' && noted !== null && !this.#launched(sessionId) && noted.session_id === sessionId && noted.session === marks.session
      && noted.repository === marks.repository && this.#asked.repositoryMark(id, sessionId) === marks.repository;
    const label = Object.hasOwn(answers, PICKER_QUESTION) ? answers[PICKER_QUESTION] : null;
    const command = typeof label === 'string' && Object.hasOwn(PICKER_COMMANDS, label) ? PICKER_COMMANDS[label] : null;
    if (!counts || command === null) return { context: PICKER_UNCOUNTED };
    try { this.#asked.closeWindow(id, sessionId); } catch { /* the window only offers a ticket */ }
    const result = this.#answer(cwd, command, verdict, sessionId, marks);
    return { context: result.action === 'pass' ? `${result.context}\nThen carry on with what the user asked.` : `Tell the user this, word for word, then carry on with what they asked: ${result.reason}${result.reason.endsWith(NEVER_OWNER) ? '' : `\n${NEVER_OWNER}`}` };
  }

  // The question, attached to a message that is let through: the card where the host can show it,
  // else text for the agent to put to the user. lead is an extra first line for the user.
  #ask(verdict, lead = null) {
    const notice = [lead, questionText(verdict)].filter(Boolean).join('\n');
    return this.#picker ? { action: 'pass', context: pickerContext(notice), notice: PICKER_NOTICE, question: true } : { action: 'pass', context: textContext(notice), question: true };
  }

  #decide({ cwd, prompt, sessionId = null }) {
    // The owner's reply to a governance bank shown in this run comes first, in any repository state.
    const banked = this.#bankReply(prompt, sessionId);
    if (banked) return banked;
    const verdict = this.#gate.evaluate(cwd, { sessionId, refreshPending: true });
    if (!verdict.open) {
      if (verdict.pending) return { action: 'pass', context: verdict.pending.text };
      return verdict.reason === 'unavailable' ? { action: 'pass', context: "Toolkit: couldn't check governance. Continue with the global rules; no governance effects or standing task auto-merge until it can be checked." } : { action: 'pass' };
    }
    // Answers are read from the user's own reply; every other message is ordinary work.
    const message = ownerMessage(String(prompt || ''));
    const answer = ownTyped(message) ? ANSWER.exec(message.text) : null;
    // A session another session or a launcher started is never asked and never answers.
    if (this.#launched(sessionId)) return answer ? { action: 'block', reason: LAUNCHED_TEXT } : { action: 'pass' };
    const marks = this.#marks(verdict, sessionId);
    // A session the session-start hook never marked cannot be noted as asked, so it is told each time.
    if (typeof sessionId !== 'string' || sessionId === '' || !EPOCH.test(String(marks.session))) {
      return answer ? { action: 'block', reason: noMarkText(['enable', 'disable']) } : { action: 'pass', context: BARE_LINE };
    }
    const id = verdict.state.repository_id;
    if (verdict.reason === 'undecided') {
      // The first message of the run: note the run as asked, open the reply window and let the
      // message through with the question. A first, pre-question Projects delivery stays spent, so
      // the host delivering it again cannot answer. A note that cannot be saved asks again next time.
      if (message.wrapped && ownTyped(message)) { try { this.#tickets.acceptDelivery(message, null); } catch { /* receipts are kept as they are */ } }
      let noted = true;
      try { this.#asked.set(id, sessionId, marks, { window: true }); } catch { noted = false; }
      return this.#ask(verdict, noted ? null : UNSAVED_LINE);
    }
    // This run was asked. The full answer decides at any point in it.
    if (answer) {
      const claim = this.#claim(message, id, sessionId);
      if (claim) return claim;
      this.#dropTicket(sessionId);
      // The full answer is the reply: no later message is read as one.
      try { this.#asked.closeWindow(id, sessionId); } catch { /* the next message gets a ticket that can record nothing new */ }
      return this.#afterAsked(cwd, answer, verdict, sessionId, marks);
    }
    if (!ownTyped(message)) return { action: 'pass' };
    // After the agent asked the user to confirm one answer, their next own message is read only as
    // the reply to that question. Otherwise the next own message after the question may be the
    // reply in any words, a bare yes included (without a hold, "yes" may also answer something the
    // agent asked): it goes to the agent with a one-use reply ticket. Later messages are ordinary work.
    let pending = null, lost = false, open = false;
    try { pending = this.#tickets.pending(sessionId, marks.session); } catch { lost = true; }
    try { open = this.#asked.window(id, sessionId); } catch { open = false; }
    if (!pending && !open) return { action: 'pass' };
    // A session that started in the repository since the question may have been shown it instead,
    // so the reply is not read: the question goes out again with this message.
    if (open && this.#asked.repositoryMark(id, sessionId) !== marks.repository) {
      try { this.#asked.set(id, sessionId, marks, { window: true }); } catch { /* asked again on the next message */ }
      return this.#ask(verdict, MOVED_LINE);
    }
    if (open) { try { this.#asked.closeWindow(id, sessionId); } catch { return { action: 'pass' }; } }
    if (lost) return PromptHold.#unclaimed({ reason: REPLY_LOST });
    // A Projects delivery is claimed before any ticket is given.
    const spent = this.#claim(message, id, sessionId);
    if (spent) return PromptHold.#unclaimed(spent);
    if (pending) {
      const confirmed = this.#confirmReply(sessionId, marks.session);
      if (confirmed) return confirmed.unmatched ? PromptHold.#unclaimed({ reason: PromptHold.reask(confirmed) }) : confirmed;
    }
    return this.#ticket(sessionId, marks.session, [{ id, root: verdict.state.root, mark: marks.repository || null }]) || { action: 'pass' };
  }

  // The first own message after this run was shown a governance bank (toolkit-governance-bank.cjs)
  // gets a one-use bank ticket; null when no bank waits in this run. A launched session, a message
  // that is not the user's own, a repeated Projects delivery or a reply after the repository's session
  // mark changed gets none, and the bank must be shown again.
  #bankReply(prompt, sessionId) {
    if (typeof sessionId !== 'string' || sessionId === '') return null;
    const epoch = this.#epochs.get(sessionId);
    if (!EPOCH.test(String(epoch))) return null;
    let shown = null;
    try { shown = this.#bank.pendingFor(sessionId, epoch); } catch { return null; }
    if (!shown) return null;
    const message = ownerMessage(String(prompt || ''));
    const drop = () => { try { this.#bank.drop(sessionId); } catch { /* the note lapses in half an hour */ } };
    if (this.#launched(sessionId)) { drop(); return { action: 'pass' }; }
    if (!ownTyped(message)) return null;
    if (this.#epochs.repository(shown.repository_id) !== shown.repository_mark) {
      drop();
      return { action: 'pass', context: `${BANK_MOVED}
${NEVER_OWNER}` };
    }
    if (message.wrapped) {
      let accepted = false;
      try { accepted = this.#tickets.acceptDelivery(message, Date.parse(shown.at)); } catch { accepted = false; }
      if (!accepted) { drop(); return PromptHold.#unclaimed({ reason: REPEAT_TEXT }); }
    }
    let ticket = null;
    try { ticket = this.#bank.issue(sessionId, epoch); } catch { ticket = null; }
    return { action: 'pass', context: ticket ? bankTicketContext(shown, ticket) : `${BANK_LOST}
${NEVER_OWNER}` };
  }

  // A Projects delivery that cannot count is still let through as ordinary work; the agent is told
  // why nothing can be recorded from it, in case it was meant as the answer.
  static #unclaimed(claim) {
    return { action: 'pass', context: `${claim.reason}\nIf the user's message above was their governance answer, tell them it was not recorded and why; otherwise carry on with what they asked. ${NEVER_OWNER}` };
  }

  // A wrapped delivery must be fresh, after the question, and unused across every run. Persist the
  // receipt before any decision or ticket; a failure records nothing and grants nothing.
  #claim(message, repositoryId, sessionId) {
    if (!message.wrapped) return null;
    try {
      let after = this.#asked.answeredAt(repositoryId, sessionId);
      const pending = this.#tickets.pending(sessionId, this.#epochs.get(sessionId));
      if (pending && pending.repositories.some(item => item.id === repositoryId)) {
        after = Math.max(after, Date.parse(pending.at));
      }
      if (!this.#tickets.acceptDelivery(message, after)) return { action: 'block', reason: REPEAT_TEXT };
    } catch (error) {
      if (codeOf(error) === 'REPLY_DELIVERY_CAPACITY') return { action: 'block', reason: 'Toolkit: the local Projects delivery-receipt store is full, so nothing was recorded. Keep its spent receipts; wait for receipts to expire within 24 hours and 2 minutes, then send a fresh reply.' };
      return { action: 'block', reason: `Toolkit: the reply could not be checked or kept (${codeOf(error)}), so nothing was recorded. Restore the local reply-ticket state, then reply again, or run ${terminalCommand('enable')} or ${terminalCommand('disable')} in your own terminal. Do not delete delivery receipts.` };
    }
    return null;
  }

  // The user's reply to a pending confirmation of this run: a ticket that records only the answer
  // that question named, which ends the confirmation. null when none is pending; { unmatched: true } when
  // one may be pending but no ticket can be given (the store cannot be read or written, or this
  // thread message already had a ticket), so the reply is never read another way.
  #confirmReply(sessionId, epoch) {
    let pending = null;
    try {
      pending = this.#tickets.pending(sessionId, epoch);
    } catch { return { unmatched: true, lost: true }; }
    if (!pending) return null;
    let ticket = null;
    try { ticket = this.#tickets.issue(sessionId, epoch, pending.repositories, pending.command); } catch { ticket = null; }
    return ticket ? { action: 'pass', context: confirmTicketContext(pending.repositories, pending.command, ticket) } : { unmatched: true, pending };
  }

  // What is said when a reply cannot be matched to the confirmation: the same confirmation question
  // word for word while it is known, else that the reply state could not be read.
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
    const unusable = { ok: false, text: `Toolkit: that reply ticket is used, lapsed, no longer needed or unknown. Nothing was recorded. ${NEVER_OWNER}` };
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
      if (!verdict || verdict.reason !== 'asked' || verdict.state.repository_id !== item.id) { moved.push(item); continue; }
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
    if (moved.length > 0) lines.push(`Nothing was recorded for ${repositoryNames(moved)}: it was decided elsewhere, its origin changed, or a session started there since the question.`);
    return { action: 'pass', context: lines.join('\n'), recorded: done.length };
  }

  // This run's marks: the session's own and the repository's, and whether the run was a resume or fork.
  #marks(verdict, sessionId) {
    return { session: this.#epochs.get(sessionId), repository: this.#epochs.repository(verdict.state.repository_id), resumed: this.#epochs.resumed(sessionId) };
  }

  // The full answer in an asked run: it counts while no session has started in the repository
  // since the question; otherwise nothing is recorded and Toolkit asks again.
  #afterAsked(cwd, answer, verdict, sessionId, marks) {
    const id = verdict.state.repository_id;
    if (this.#asked.repositoryMark(id, sessionId) === marks.repository) return this.#answer(cwd, answer[1].toLowerCase(), verdict, sessionId, marks);
    try { this.#asked.set(id, sessionId, marks, { window: true }); } catch { /* asked again on the next message */ }
    return this.#ask(verdict, MOVED_LINE);
  }

  // A session a Toolkit launcher started, or one started from another session's shell command, is
  // automation, not the user typing.
  #launched(sessionId) { return launchedSession(this.#environment, sessionId); }

  #answer(cwd, command, verdict, sessionId, marks) {
    if (this.#launched(sessionId)) return { action: 'block', reason: LAUNCHED_TEXT };
    // "Later" records nothing: the run is already noted as asked, and the next session asks again.
    if (command === 'not-now') return { action: 'pass', context: LATER_CONTEXT };
    let decided;
    try {
      const proposals = new (require('./toolkit-governance-proposal.cjs').GovernanceProposals)({ registryOptions: this.#registryOptions, now: this.#now });
      proposals.request(cwd, command === 'enable' ? 'yes' : 'no', { sessionId, epoch: marks.session });
      decided = proposals.pending(cwd, { sessionId, epoch: marks.session });
    } catch (error) {
      return { action: 'block', reason: `Toolkit: your answer could not be recorded (${codeOf(error)}), so nothing changed. Send it again, or run ${terminalCommand(command)} in your own terminal.` };
    }
    return { action: 'pass', context: [decided.text, ANSWERED_CONTEXT].join('\n') };
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
// The governance answer as text a scheduled prompt could carry.
const SCHEDULED_ANSWER = /toolkit\s+governance\s+(?:enable|disable|decline)/i;

class ToolGate {
  #gate; #epochs; #notes; #tickets; #asked; #bank;

  // The PreToolUse core. No tool is refused because a repository is undecided: it counts as off and
  // work carries on. What stays are the checks that stop an agent answering the question for the
  // user, in every folder: a command that runs the governance CLI with a decision, an edit to
  // Toolkit's user-state files, Toolkit's card changed or pre-filled, and a prompt the agent
  // schedules for itself that could arrive as the user's reply.
  constructor({ registryOptions = {}, stateReader = null, now } = {}) {
    this.#gate = new GovernanceGate({ registryOptions, stateReader, now });
    this.#epochs = new SessionEpochs({ registryOptions, now });
    this.#notes = new PickerNotes({ registryOptions, now });
    this.#tickets = new ReplyTickets({ registryOptions, now, gate: this.#gate });
    this.#asked = new AskedRuns({ registryOptions, now });
    this.#bank = new BankTickets({ registryOptions, now });
  }

  // AskUserQuestion is free for any other question. A call that carries Toolkit's own governance
  // question, in a repository where it is open, runs only as Toolkit's card, exactly as given and
  // with no answer filled in by the caller; the call is noted so the answer that comes back
  // (PromptHold.picked) is known to come from that card.
  #picker(input, sessionId) {
    const questions = input.tool_input && Array.isArray(input.tool_input.questions) ? input.tool_input.questions : [];
    if (!questions.some(question => question && question.question === PICKER_QUESTION)) return null;
    const verdict = this.#gate.evaluate(input && input.cwd, { sessionId });
    if (!verdict.open) return null;
    const refused = { deny: `Toolkit: its governance question is shown only as Toolkit's own card, exactly as given and with no answer filled in. Carry on with what the user asked; they can answer with \`toolkit governance enable\` or \`toolkit governance disable\` as a message. ${NEVER_OWNER}` };
    if (!pickerInput(input.tool_input)) return refused;
    const marks = { session: this.#epochs.get(sessionId), repository: this.#epochs.repository(verdict.state.repository_id) };
    if (typeof sessionId !== 'string' || sessionId === '' || !EPOCH.test(String(marks.session))) return refused;
    try { this.#notes.note(input.tool_use_id, { session_id: sessionId, ...marks }); } catch { return refused; }
    return null;
  }

  decide(input) {
    const tool = String(input && (input.tool_name || input.toolName) || '');
    const sessionId = sessionIdOf(input);
    if (SHELL_TOOLS.test(tool)) {
      const text = toolText(input);
      // Recording the answer the agent read from the user's own reply, with this session's live
      // ticket; the script checks the ticket again as it records.
      if (tool !== 'Monitor' && ticketCommand(text, sessionId, this.#tickets)) return null;
      // Sending the user's reply to a governance bank, with this session's live bank ticket; the
      // command spends the ticket again as it runs. Any other bank answer is refused below.
      if (tool !== 'Monitor' && bankTicketCommand(text, sessionId, this.#bank)) return null;
      // Any other run of the answer script with an answer and a ticket (joined to another command,
      // from another session, through another script path) is refused, so a ticket is spent only
      // by the session it was given to, on its own.
      if (/toolkit-governance-answer/i.test(text) && TICKET_ARGUMENTS.test(text)) {
        return { deny: `Toolkit: the answer script runs only as the exact command Toolkit gave this session with the user's reply, on its own line and with nothing added. Nothing was recorded. ${NEVER_OWNER}` };
      }
      if (answerCommand(text)) {
        return { deny: `Toolkit: only the user answers the governance question, on Toolkit's card or by sending \`toolkit governance enable\` or \`toolkit governance disable\` as their own message. If they asked you to decide it, tell them that in plain words. ${NEVER_OWNER}` };
      }
      if (proposalRun(text)) {
        return { deny: `Toolkit: its governance proposals are made only by Toolkit itself, from the user's own answer. ${NEVER_OWNER}` };
      }
    }
    if (EDIT_TOOLS.test(tool) && editTargets(input).some(target => USER_STATE_PATH.test(resolveTarget(input, target)))) {
      return { deny: `Toolkit: its user-state files (cached observations, pending proposals and asked sessions) are changed only by Toolkit itself. ${NEVER_OWNER}` };
    }
    if (tool === PICKER_TOOL) return this.#picker(input || {}, sessionId);
    // A prompt the agent schedules for itself arrives as bare text and could read as the user's
    // reply. None is scheduled while this run has a reply ticket, a confirmation or the reply window
    // open; after that, only one that carries the full answer is refused, in a run that was asked.
    if (SCHEDULE_TOOLS.test(tool)) {
      const open = this.#questionOpen(sessionId);
      if (open === 'reply') {
        return { deny: `Toolkit: this session has Toolkit's governance question waiting for the user's reply, so no prompt is scheduled until their next message. ${NEVER_OWNER}` };
      }
      let carried = '';
      try { carried = JSON.stringify(input.tool_input ?? {}); } catch { carried = 'toolkit governance enable'; }
      if (open === 'asked' && SCHEDULED_ANSWER.test(carried)) {
        return { deny: `Toolkit: a scheduled prompt cannot carry the governance answer. ${NEVER_OWNER}` };
      }
    }
    return null;
  }

  // 'reply' while this run has a live reply ticket, a pending confirmation or an open reply window;
  // 'asked' when it was asked in any repository (the full answer still decides in it); else null.
  // When that cannot be read it counts as 'reply'.
  #questionOpen(sessionId) {
    if (typeof sessionId !== 'string' || sessionId === '') return null;
    try {
      const epoch = this.#epochs.get(sessionId);
      if (this.#tickets.live(sessionId, epoch) || this.#asked.windowFor(sessionId, epoch) || this.#bank.live(sessionId, epoch)) return 'reply';
      return this.#asked.anyFor(sessionId, epoch) ? 'asked' : null;
    } catch { return 'reply'; }
  }
}

// ---- session line -----------------------------------------------------------------------------

function sessionLine(cwd, { registryOptions = {}, stateReader = null, now, sessionId = null, programmeDeps = {} } = {}) {
  const verdict = new GovernanceGate({ registryOptions, stateReader, now }).evaluate(cwd, { sessionId });
  let tasks;
  let registry;
  // A test registry without an isolated home must never read this computer's task registry.
  if (programmeDeps.home || registryOptions.testOnly !== true) {
    try { tasks = require('./toolkit-tasks.cjs'); registry = tasks.readRegistry(programmeDeps.home); } catch { /* retain original context */ }
  }
  const original = verdictLine(verdict, registryOptions, { ...programmeDeps, registry });
  try {
    const advisory = registry && tasks?.taskGovernanceLine(verdict.state, { ...programmeDeps, registry });
    return advisory ? `${original} ${advisory}` : original;
  } catch { return original; }
}

function verdictLine(verdict, registryOptions, programmeDeps) {
  const state = verdict.state;
  if (verdict.pending) return verdict.pending.text;
  if (verdict.reason === 'unavailable') return "Toolkit: couldn't check governance. Continue with the global rules; no governance effects or standing task auto-merge until it can be checked.";
  if (verdict.open) {
    return `Toolkit governance: not decided yet, so this repository counts as off. Follow the global rules (coding gates included) without GitHub governance. Toolkit asks the user once per session and work carries on; they can also send \`toolkit governance enable\` or \`toolkit governance disable\` as a message. ${NEVER_OWNER}`;
  }
  const decided = decidedLine(state);
  const programme = state.programme_records_bind === true ? programmeLines(state, registryOptions, programmeDeps) : [];
  return [decided, ...programme].join(' ');
}

// For an ENABLED repository: the attention line from this computer's cache, a Programme sweep line
// when this computer's hourly sweep is not running well, and a Checkpoint line for
// each session here whose last turn-end record failed. Each line that reports a problem ends with
// who acts and when (FINDING_ACTIONS), so it is never left as a bare warning. Reads local files only (no git, gh or network
// call); a missing or old cache starts `programme.cjs refresh` in the background. Any failure only
// drops these lines.
const FINDING_ACTIONS = Object.freeze({
  attention: 'Controller: answer each new or overdue finding this turn (fix it, ack it with --next and a due time, or dispose of it with a reason).',
  // Work-queue findings cannot be acknowledged (QUEUE_FINDING_NEEDS_ACTION), so a line with only those
  // never offers an ack.
  queue: 'Controller: take the next step named for each work-queue task this turn, or dispose of it with a reason; it clears by itself once the task moves.',
  tasks: 'Controller: fix the task this turn (toolkit tasks shows why), or tell the owner the exact step it needs.',
  checkpoint: 'Controller: check that session\'s work this turn and record it by hand if the record is lost; the session tells the controller if it is the one reading this.',
});

// A task line needs the controller only when it reports a fault: a failed, held or skipped run, no
// run for over 2 hours, a task-health flag, or a health file that is stale or not shared. An owner's stop, a plain deferral and another
// computer's jobs (whose line names the owner's step) get no controller action.
const TASK_FAULT = /(?:last run failed|held at|skipped|no run (?:since|recorded)|Task health: |Task health on other computers: |health file not shared|Task health file is over)/;
function taskAction(line) {
  if (TASK_FAULT.test(line)) return ` ${FINDING_ACTIONS.tasks}`;
  return /stopped by owner/.test(line) ? ' No action: the owner stopped it.' : '';
}

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
    if (attention.line) lines.push(`${attention.line}${started ? '; a refresh has started in the background' : ''}.${/Run programme\.cjs attention/.test(attention.line) ? ` ${attention.queueOnly ? FINDING_ACTIONS.queue : FINDING_ACTIONS.attention}` : ''}`);
    // This computer's hourly sweep, when it held, skipped, failed or has not run for over 2 hours. A test
    // registry without its own home reads nothing.
    if (deps.home || registryOptions.testOnly !== true) {
      const now = deps.now ? new Date(deps.now()) : new Date();
      const sweep = require('./toolkit-tasks.cjs').sweepLine(binding.repository, { home: deps.home, now, registry: deps.registry });
      if (sweep) lines.push(`${sweep}${taskAction(sweep)}`);
    }
  } catch { /* no attention line */ }
  try {
    const checkpoint = require('../../skills/github-program-reconciler/scripts/programme-checkpoint.cjs');
    for (const session of checkpoint.localSessionsFor(state.root, deps)) {
      if (session.errors.pending) lines.push(`Checkpoint: last turn's record failed (${session.errors.pending.code}); see programme.cjs show --session <that session's id> (session ${session.hash.slice(0, 8)}). ${FINDING_ACTIONS.checkpoint}`);
    }
  } catch { /* no checkpoint line */ }
  return lines;
}

function decidedLine(state) {
  if (state.notes?.includes('could-not-check-governance')) return `Toolkit: couldn't check governance. The last repository decision was ${state.state.toLowerCase()}. Ordinary work continues without governance effects or standing task auto-merge until it can be checked.`;
  if (state.rule === 'M2' && state.notes?.includes('merged-binding-stale')) return 'Toolkit: the last repository decision was disabled, read over 24 hours ago. Ordinary work continues without governance effects or standing task auto-merge until it can be checked.';
  if (state.rule === 'S1') return "Toolkit governance: DISABLED here: this repository is an evidence store (agent-managed, not governed). Follow the global rules; the evidence-store rules in the governed repository's AGENTS.md apply.";
  if (state.rule === 'R1s') return "Toolkit governance: DISABLED here: this repository is a scratch clone in another repository's ignored .tmp folder (not governed). Follow the global rules, coding gates included.";
  if (state.rule === 'R1') return 'Toolkit governance: DISABLED automatically (this folder is not a git repository, so there is no GitHub governance). Follow the global rules, coding gates included.';
  if (state.rule === 'R8') return `Toolkit governance: DISABLED automatically (it ${whereText(state)}, so GitHub governance cannot run here). Follow the global rules, coding gates included; any TOOLKIT-GOVERNED-RULES block in AGENTS.md does not apply.`;
  if (state.state === 'ERROR') return 'Toolkit governance: ERROR for this repository (the programme binding merged on the default branch cannot be used). Follow the global rules, coding gates included; ordinary work continues, but programme records, gate admission and finality hold until a pull request fixes the binding. Never treat this as ENABLED or as DISABLED.';
  if (state.state === 'DISABLED') return 'Toolkit governance: DISABLED for this repository (no GitHub governance). Follow the global rules, coding gates included; any TOOLKIT-GOVERNED-RULES block in AGENTS.md does not apply.';
  const enabled = state.materials?.governed_block
    ? 'Toolkit governance: ENABLED for this repository. Follow the global rules, coding gates included, and the TOOLKIT-GOVERNED-RULES block in AGENTS.md (GitHub governance: records and evidence).'
    : 'Toolkit governance: ENABLED by the default branch, but AGENTS.md has no governed rules block. Follow the global rules and use repository-agent-rules to prepare the missing block through a pull request.';
  return state.governed_effects_hold ? `${enabled} The binding merged on the default branch was last read over 24 hours ago, so programme records, gate admission and finality hold until it is read again online.` : enabled;
}

// ---- fail-closed fallbacks --------------------------------------------------------------------

// Used when the gate itself failed: inside a git repository (or when that cannot be told) it holds.
function insideRepository(cwd) {
  try { return governance.findGitRoot(typeof cwd === 'string' && cwd ? cwd : process.cwd()) !== null; } catch { return true; }
}

module.exports = Object.freeze({
  ANSWER,
  FINDING_ACTIONS,
  taskAction,
  HOST_SESSION_VARIABLE,
  LAUNCHER_MARKERS,
  normaliseHost,
  SessionEpochs,
  NOT_NOW_BASENAME,
  ReplyTickets,
  TICKETS_BASENAME,
  ANSWER_SCRIPT,
  ownerReply,
  ownerMessage,
  hasFrameMarkup,
  sessionIdOf,
  startSession,
  SESSIONS_FOLDER,
  answerCommand,
  RETIRED_HELD_BASENAME,
  AskedRuns,
  NEVER_OWNER,
  NEVER_OWNER_SHORT,
  GovernanceGate,
  GovernanceGateError,
  PromptHold,
  ToolGate,
  insideRepository,
  sessionLine,
  terminalCommand,
  PICKER_INPUT,
  PICKER_QUESTION, QUESTION,
  PickerNotes,
  pickerInput,
});
