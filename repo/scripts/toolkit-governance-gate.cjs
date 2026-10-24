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
//     oldest first.
//   - ToolGate is the PreToolUse core. A held repository runs no state-changing tool. In every
//     folder, an agent may not answer the question for the user: commands that run the governance
//     CLI or start a host session with the answer as its prompt are refused, and so are edits to
//     Toolkit's user-state files.
//   - sessionLine is the one SessionStart line that states the effective state.
//
// Every failure inside a git repository holds (fail closed). Held prompts never leave this computer
// and are never printed to logs.

const crypto = require('node:crypto');
const fs = require('node:fs');
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
const LAUNCHER_MARKERS = Object.freeze(['TOOLKIT_GATE_ROLE', 'TOOLKIT_NATIVE_HELPER_BINDING', 'TOOLKIT_CLAUDE_TASK_PROFILE_SHA256']);

// The answer is the whole prompt, in any letter case, with surrounding spaces or one final full stop.
// `decline` is kept as the older word for `disable`.
const ANSWER = /^\s*toolkit governance (enable|disable|decline)\.?\s*$/i;
// The short replies to the question Toolkit asked. They count only once a prompt has been held for
// the repository in the same host session, so that session was shown the question; the whole
// message must be the reply.
const SHORT_ANSWER = /^\s*(yes|y|no|n|not now|later)[.!]?\s*$/i;
const SHORT_COMMANDS = Object.freeze({ yes: 'enable', y: 'enable', no: 'disable', n: 'disable', 'not now': 'not-now', later: 'not-now' });
// The replies that say ok to GitHub governance being off in a repository that is not on github.com.
// Every one of them has the same effect, so a plain "yes" or "no" works too.
const OK_ANSWER = /^\s*(ok|okay|yes|y|no|n|not now|later)[.!]?\s*$/i;
// An agent's command that would answer for the user: the CLI script with a decision, or a host
// session started, resumed or fed on stdin with an answer (long or short) as its prompt. This reads
// the command's text, so it is best effort; the same-session rule above is what really stops a
// fresh nested session.
const HOST_COMMAND = /(?:^|[\s;&|()`'"\\/])(?:claude|codex)(?:-code)?(?:\.exe|\.cmd|\.ps1)?(?=$|[\s;&|()`'"])/im;
const SHELL_WORD = /"((?:[^"\\]|\\.)*)"|'([^']*)'|([^\s;&|()<>"'=`]+)/g;
function shortAnswerWord(text) {
  const words = [...text.matchAll(SHELL_WORD)].map(match => match[1] ?? match[2] ?? match[3]);
  return [...words, ...text.split(/\r?\n/)]
    .some(word => OK_ANSWER.test(word.replace(/^\$/, '').replace(/(?:\\[nr])+$/, '')));
}
function answerCommand(text) {
  return /toolkit-governance\.cjs["']?\s+(?:enable|disable|decline|reopen|migrate)\b/i.test(text)
    || (/\b(?:claude|codex)\b/i.test(text) && /toolkit governance (?:enable|disable|decline)\b/i.test(text))
    || (HOST_COMMAND.test(text) && shortAnswerWord(text));
}
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
  #stateReader; #now; #notNow;

  constructor({ registryOptions = {}, stateReader = null, now = () => new Date() } = {}) {
    this.#stateReader = stateReader || (cwd => governance.governanceState(cwd, registryOptions));
    this.#now = now;
    this.#notNow = new NotNow({ registryOptions, now });
  }

  // { hold, reason, state, file } where reason is one of 'no-git' (a plain folder, DISABLED
  // automatically), 'decided', 'undecided' (the github.com question), 'not-github' (a git repository
  // not on github.com, waiting for the user's ok), 'not-now' (the user said later in this session)
  // or 'state-unreadable'. Only the user-state files decide whether a repository holds: a decided
  // repository never holds over its copy, and a copy that cannot be written is reported as file
  // 'unwritable' with its error_code. With write: false the copy is only checked.
  evaluate(cwd, { write = true, sessionId = null } = {}) {
    const state = this.#stateReader(cwd);
    const verdict = (hold, reason, extra = {}) => Object.freeze({ hold, reason, state, file: null, ...extra });
    if (state.state === 'UNDECIDED' && state.rule === 'ERROR') return verdict(true, 'state-unreadable');
    if (state.state === 'UNDECIDED' && state.rule === 'R9') return verdict(true, 'not-github');
    if (state.state === 'UNDECIDED') return this.#notNow.has(state.repository_id, sessionId) ? verdict(false, 'not-now') : verdict(true, 'undecided');
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

  // Keeps the prompt with the session that sent it (trimmed to a size cap; the oldest go first past
  // the count cap) and returns the number now held.
  add(repositoryId, prompt, sessionId = null) {
    const data = this.#read();
    const list = Array.isArray(data.repositories[repositoryId]) ? data.repositories[repositoryId] : [];
    const text = String(prompt || '').slice(0, MAX_HELD_CHARS);
    const entry = { at: this.#now().toISOString(), text };
    if (typeof sessionId === 'string' && sessionId !== '') entry.session_id = sessionId;
    data.repositories[repositoryId] = [...list, entry].slice(-MAX_HELD);
    this.#write(data);
    return data.repositories[repositoryId].length;
  }

  // Returns the held prompts, oldest first, and forgets them.
  take(repositoryId) {
    const data = this.#read();
    const list = Array.isArray(data.repositories[repositoryId]) ? data.repositories[repositoryId] : [];
    if (list.length === 0) return [];
    delete data.repositories[repositoryId];
    this.#write(data);
    return list.map(entry => String(entry.text || ''));
  }
}

// "Not now" answers, kept next to the registry: per repository, the sessions that gave one (the
// newest few, so another session's "not now" never re-holds this one). Nothing is decided; a new
// session asks again. A missing, unreadable or damaged file counts as no
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

  has(repositoryId, sessionId) {
    if (!repositoryId || typeof sessionId !== 'string' || sessionId === '') return false;
    return Object.hasOwn(NotNow.#sessions(this.#read().repositories[repositoryId]), sessionId);
  }

  set(repositoryId, sessionId) {
    const data = this.#read();
    const sessions = { ...NotNow.#sessions(data.repositories[repositoryId]), [sessionId]: this.#now().toISOString() };
    const newest = Object.entries(sessions).sort((a, b) => String(b[1]).localeCompare(String(a[1]))).slice(0, MAX_NOT_NOW_SESSIONS);
    data.repositories[repositoryId] = { sessions: Object.fromEntries(newest) };
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

function unreadableText(code) {
  return `Toolkit: the governance state of this repository could not be read (${code}), so your message was held and not sent. Run ${terminalCommand('check')} in a terminal to see why.`;
}

// What the agent does in an ENABLED repository whose setup is not finished (the governed block or the
// binding is missing): right after the user's yes, and at every session start until both land.
const SETUP_ASK = 'GitHub governance setup is not finished here. Before other work, ask the user in one message: (1) the private evidence store, an existing private repository or a new `TRANSPORT-<repository>` one, separate from this repository; (2) the parent issue, an existing number or a new one; (3) confirm the defaults: record and writer prefix `INT-<SHORT>-`, required checks from the default branch protection, store branch `main`. Then use `repository-agent-rules` to add the governed block and `.github/toolkit-programme.json` in one pull request for the user to merge. If the user says not now, carry on under the global rules and ask again next session.';

function replayContext(state, prompts, { notNow = false } = {}) {
  const label = state.state === 'ENABLED' && state.materials_complete === false ? 'ENABLED (materials incomplete)' : state.state;
  const lines = [notNow
    ? 'The user answered "later" to the Toolkit GitHub governance question. Nothing is decided: for the rest of this session follow the global rules (coding gates included) without GitHub governance, and Toolkit asks again next session. If the user wants to decide sooner, they can send `toolkit governance enable` or `toolkit governance disable` as a message.'
    : state.rule === 'R8'
      ? 'Toolkit GitHub governance is now DISABLED for this repository: it is not on github.com and the user said ok. Follow the global rules, coding gates included; any TOOLKIT-GOVERNED-RULES block in AGENTS.md does not apply.'
      : `Toolkit governance is now ${label} for this repository; the user just answered the governance question.`];
  if (!notNow && state.state === 'ENABLED' && state.materials_complete === false) lines.push(`${SETUP_ASK} Handle the held messages below after that question.`);
  if (prompts.length > 0) {
    lines.push('Messages the user sent while the repository was held, oldest first. Treat them as the user\'s requests:');
    prompts.forEach((text, index) => lines.push(`${index + 1}. ${text}`));
  }
  return lines.join('\n');
}

const LAUNCHED_TEXT = 'Toolkit: an automated session cannot answer the governance question. Answer it in your own chat, or run the command in your own terminal.';

// ---- prompt hold ------------------------------------------------------------------------------

// The host-neutral UserPromptSubmit decision: { action: 'pass' } | { action: 'pass', context } |
// { action: 'block', reason }.
class PromptHold {
  #gate; #held; #notNow; #registryOptions; #environment; #now;

  constructor({ registryOptions = {}, environment = process.env, now = () => new Date(), stateReader = null } = {}) {
    this.#registryOptions = registryOptions;
    this.#gate = new GovernanceGate({ registryOptions, stateReader, now });
    this.#held = new HeldPrompts({ registryOptions, now });
    this.#notNow = new NotNow({ registryOptions, now });
    this.#environment = environment || {};
    this.#now = now;
  }

  // sessionId is the host's session id; "not now" lasts for that session only.
  decide({ cwd, prompt, sessionId = null }) {
    const verdict = this.#gate.evaluate(cwd, { sessionId });
    const text = String(prompt || '');
    const answer = ANSWER.exec(text);
    // After "not now", the full answer still decides; a short reply is an ordinary message there,
    // since it may answer the agent's own question.
    if (verdict.reason === 'not-now') return answer ? this.#answer(cwd, answer[1].toLowerCase(), verdict, sessionId) : { action: 'pass' };
    if (!verdict.hold) return verdict.reason === 'no-git' ? { action: 'pass' } : this.#replayIfAny(verdict.state);
    if (verdict.reason === 'state-unreadable') return { action: 'block', reason: unreadableText(verdict.state.error_code) };
    if (verdict.reason === 'not-github') return this.#notGitHub(cwd, text, answer, verdict, sessionId);
    if (answer) return this.#answer(cwd, answer[1].toLowerCase(), verdict, sessionId);
    const short = SHORT_ANSWER.exec(text);
    if (short && this.#held.count(verdict.state.repository_id, sessionId) > 0) return this.#answer(cwd, SHORT_COMMANDS[short[1].toLowerCase()], verdict, sessionId);
    const held = this.#held.add(verdict.state.repository_id, prompt, sessionId);
    // A session sees the whole question on its first held message, even when another session is waiting too.
    const shown = typeof sessionId === 'string' && sessionId !== '' ? this.#held.count(verdict.state.repository_id, sessionId) : held;
    return { action: 'block', reason: questionText(verdict, shown) };
  }

  // A git repository not on github.com: the only outcome is DISABLED, once the user says ok.
  #notGitHub(cwd, text, answer, verdict, sessionId) {
    const id = verdict.state.repository_id;
    if (answer && answer[1].toLowerCase() === 'enable') {
      return { action: 'block', reason: `Toolkit: GitHub governance cannot be enabled here, because this repository ${whereText(verdict.state)}. ${OK_ASK}` };
    }
    if (answer || (OK_ANSWER.test(text) && this.#held.count(id, sessionId) > 0)) {
      if (this.#launched()) return { action: 'block', reason: LAUNCHED_TEXT };
      let decided;
      try { decided = writeNotGitHubOk(cwd, { registryOptions: this.#registryOptions, now: this.#now }); } catch (error) {
        return { action: 'block', reason: `Toolkit: your ok could not be recorded (${codeOf(error)}), so this repository is still held. Reply ok again, or run ${terminalCommand('disable')} in your own terminal.` };
      }
      return { action: 'pass', context: replayContext(decided.state, this.#held.take(id)) };
    }
    const held = this.#held.add(id, text, sessionId);
    const shown = typeof sessionId === 'string' && sessionId !== '' ? this.#held.count(id, sessionId) : held;
    return { action: 'block', reason: notGitHubText(verdict, shown) };
  }

  // A session a Toolkit launcher started is automation, not the user typing.
  #launched() {
    return LAUNCHER_MARKERS.some(name => typeof this.#environment[name] === 'string' && this.#environment[name] !== '');
  }

  // A decision made elsewhere (the terminal command, another clone) still hands back held prompts.
  #replayIfAny(state) {
    if (!state.repository_id) return { action: 'pass' };
    const prompts = this.#held.take(state.repository_id);
    return prompts.length === 0 ? { action: 'pass' } : { action: 'pass', context: replayContext(state, prompts) };
  }

  #answer(cwd, command, verdict, sessionId) {
    if (this.#launched()) return { action: 'block', reason: LAUNCHED_TEXT };
    if (command === 'not-now') {
      if (typeof sessionId !== 'string' || sessionId === '') {
        return { action: 'block', reason: `Toolkit: this app does not say which session this is, so "later" cannot be kept. ${ASK.replace(', no or later', ' or no')}` };
      }
      try { this.#notNow.set(verdict.state.repository_id, sessionId); } catch (error) {
        return { action: 'block', reason: `Toolkit: "later" could not be saved (${codeOf(error)}), so this repository is still held. Reply yes or no, or try again.` };
      }
      return { action: 'pass', context: replayContext(verdict.state, this.#held.take(verdict.state.repository_id), { notNow: true }) };
    }
    let decided;
    try {
      decided = writeGovernanceDecision(cwd, command, { registryOptions: this.#registryOptions, now: this.#now });
    } catch (error) {
      return { action: 'block', reason: `Toolkit: your answer could not be recorded (${codeOf(error)}), so nothing changed and this repository is still held. Reply again, or run ${terminalCommand(command)} in your own terminal.` };
    }
    const prompts = this.#held.take(verdict.state.repository_id);
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

// The host's session id from hook input (Claude Code and Codex both send session_id).
function sessionIdOf(input) {
  return input && typeof input.session_id === 'string' && input.session_id ? input.session_id : null;
}

// The host-neutral PreToolUse decision: null (no decision) or { deny: reason }.
class ToolGate {
  #gate;

  constructor({ registryOptions = {}, stateReader = null, now } = {}) {
    this.#gate = new GovernanceGate({ registryOptions, stateReader, now });
  }

  decide(input) {
    const tool = String(input && (input.tool_name || input.toolName) || '');
    if (SHELL_TOOLS.test(tool) && answerCommand(toolText(input))) {
      return { deny: `Toolkit: only the user answers the governance question. Ask them in chat instead: "${ASK}" Toolkit records their own reply.` };
    }
    if (EDIT_TOOLS.test(tool) && editTargets(input).some(target => USER_STATE_PATH.test(path.resolve(String(input.cwd || process.cwd()), target)))) {
      return { deny: 'Toolkit: its user-state files (governance decisions and held messages) are changed only by Toolkit itself.' };
    }
    if (READ_ONLY_TOOLS.test(tool)) return null;
    const verdict = this.#gate.evaluate(input && input.cwd, { sessionId: sessionIdOf(input) });
    if (!verdict.hold) return null;
    if (verdict.reason === 'state-unreadable') return { deny: `Toolkit: the governance state of this repository could not be read (${verdict.state.error_code}), so nothing runs here until it can.` };
    if (verdict.reason === 'not-github') return { deny: `Toolkit: this repository ${whereText(verdict.state)}, so GitHub governance will be off here, and nothing runs until the user says ok. Ask them in plain words to reply ok; Toolkit records their own reply, so never ask them to run a command, and do not try to work around it.` };
    return { deny: `Toolkit: this repository has no governance decision yet, so nothing runs here. Ask the user in plain words: "${ASK}" Toolkit records their own reply, so never ask them to run a command, and do not try to work around it.` };
  }
}

// ---- session line -----------------------------------------------------------------------------

function sessionLine(cwd, { registryOptions = {}, stateReader = null, now, sessionId = null } = {}) {
  const verdict = new GovernanceGate({ registryOptions, stateReader, now }).evaluate(cwd, { sessionId });
  const state = verdict.state;
  if (verdict.reason === 'not-now') return 'Toolkit governance: not decided yet; the user said "later" for this session. Follow the global rules (coding gates included) without GitHub governance; Toolkit asks again next session. If the user wants to decide sooner, they can send `toolkit governance enable` or `toolkit governance disable` as a message.';
  if (verdict.hold) {
    if (verdict.reason === 'state-unreadable') return `Toolkit governance: the state of this repository could not be read (${state.error_code}). Every user message is held until it can; do not try to work around it.`;
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
  NOT_NOW_BASENAME,
  NOT_GITHUB_BASENAME,
  OK_ANSWER,
  SHORT_ANSWER,
  sessionIdOf,
  answerCommand,
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
