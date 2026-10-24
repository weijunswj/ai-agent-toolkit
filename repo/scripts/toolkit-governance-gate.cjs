'use strict';

// The hook gate for per-repository governance (owner rule of 23 Oct: a hard stop, like the
// stale-Toolkit check, that keeps stopping until the state exists). Shared by the Claude Code and
// Codex hooks:
//
//   - GovernanceGate decides whether a working directory is held. UNKNOWN (including an unreadable
//     state) is held; PORTABLE never is. A decided repository is held until its in-repository copy
//     (`.ai-agent-toolkit/governance.json`) exists and agrees with the registry; the gate writes it.
//   - PromptHold is the UserPromptSubmit core. In a held repository every prompt is blocked and kept
//     on this computer, except the user's own answer, `toolkit governance enable` or
//     `toolkit governance decline`, which is recorded, read back and then let through with the held
//     prompts attached, oldest first.
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
const MAX_HELD = 20;
const MAX_HELD_CHARS = 4000;
const MAX_HELD_BYTES = 512 * 1024;
const LAUNCHER_MARKERS = Object.freeze(['TOOLKIT_GATE_ROLE', 'TOOLKIT_NATIVE_HELPER_BINDING', 'TOOLKIT_CLAUDE_TASK_PROFILE_SHA256']);

// The answer is the whole prompt, in any letter case, with surrounding spaces or one final full stop.
const ANSWER = /^\s*toolkit governance (enable|decline)\.?\s*$/i;
// An agent's command that would answer for the user: the CLI script with a decision, or a host
// session started (or fed on stdin) with the answer as its prompt.
function answerCommand(text) {
  return /toolkit-governance\.cjs["']?\s+(?:enable|decline|reopen|migrate)\b/i.test(text)
    || (/\b(?:claude|codex)\b/i.test(text) && /toolkit governance (?:enable|decline)\b/i.test(text));
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
  #stateReader; #now;

  constructor({ registryOptions = {}, stateReader = null, now = () => new Date() } = {}) {
    this.#stateReader = stateReader || (cwd => governance.governanceState(cwd, registryOptions));
    this.#now = now;
  }

  // { hold, reason, state, file } where reason is one of 'portable', 'decided', 'undecided' or
  // 'state-unreadable'. Only the registry decides whether a repository holds: a decided repository
  // never holds over its in-repository copy, and a copy that cannot be written is reported as
  // file 'unwritable' with its error_code. With write: false the copy is only checked.
  evaluate(cwd, { write = true } = {}) {
    const state = this.#stateReader(cwd);
    const verdict = (hold, reason, extra = {}) => Object.freeze({ hold, reason, state, file: null, ...extra });
    if (state.state === 'PORTABLE') return verdict(false, 'portable');
    if (state.state === 'UNKNOWN') return verdict(true, state.rule === 'ERROR' ? 'state-unreadable' : 'undecided');
    if (!write) {
      const status = repoState.recordStatus(state);
      return verdict(false, 'decided', { file: status });
    }
    try {
      const synced = repoState.syncRecord(state, { now: this.#now });
      return verdict(false, 'decided', { file: synced.written ? 'written' : 'agrees' });
    } catch (error) {
      return verdict(false, 'decided', { file: 'unwritable', error_code: codeOf(error) });
    }
  }
}

// ---- decision ---------------------------------------------------------------------------------

// Records the user's decision through the registry's owner-action path, then reads it back through
// the gate (which also writes the in-repository copy). Throws GovernanceGateError when the result
// is not the decided state.
function writeGovernanceDecision(cwd, command, { registryOptions = {}, registry = require('./toolkit-capability-registry.cjs'), now } = {}) {
  if (!['enable', 'decline'].includes(command)) throw new GovernanceGateError('UNKNOWN_COMMAND');
  const status = registry.getRepositoryStatus({ cwd, ...registryOptions });
  if (status.actionable) throw new GovernanceGateError('REGISTRY_UNAVAILABLE');
  const current = status.capabilities[CAPABILITY].state;
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
  const expected = command === 'enable' ? 'ENABLED' : 'DECLINED';
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

  #read() {
    let text;
    try { text = fs.readFileSync(this.#file, 'utf8'); } catch (error) {
      if (error && error.code === 'ENOENT') return { schema: HELD_SCHEMA, repositories: {} };
      throw new GovernanceGateError('HELD_PROMPTS_UNREADABLE');
    }
    if (Buffer.byteLength(text) > MAX_HELD_BYTES) throw new GovernanceGateError('HELD_PROMPTS_TOO_LARGE');
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw new GovernanceGateError('HELD_PROMPTS_MALFORMED'); }
    if (!parsed || parsed.schema !== HELD_SCHEMA || !parsed.repositories || typeof parsed.repositories !== 'object') throw new GovernanceGateError('HELD_PROMPTS_MALFORMED');
    return parsed;
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

  count(repositoryId) {
    const list = this.#read().repositories[repositoryId];
    return Array.isArray(list) ? list.length : 0;
  }

  // Keeps the prompt (trimmed to a size cap; the oldest go first past the count cap) and returns the
  // number now held.
  add(repositoryId, prompt) {
    const data = this.#read();
    const list = Array.isArray(data.repositories[repositoryId]) ? data.repositories[repositoryId] : [];
    const text = String(prompt || '').slice(0, MAX_HELD_CHARS);
    data.repositories[repositoryId] = [...list, { at: this.#now().toISOString(), text }].slice(-MAX_HELD);
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

// ---- messages ---------------------------------------------------------------------------------

const QUESTION = [
  'Toolkit: this repository has no governance decision yet, so your message was held and not sent.',
  'Reply with exactly one of these as your next message:',
  '  toolkit governance enable    Toolkit gates, records and programme rules apply here.',
  '  toolkit governance decline   Only the global rules apply, and Toolkit will not ask again.',
  'Every message until then is held too. Held messages stay on this computer and are handed over, in order, after you answer.',
];

function questionText(verdict, held) {
  if (held > 1) return `Toolkit: still waiting for this repository's governance decision (${held} messages held). Reply \`toolkit governance enable\` or \`toolkit governance decline\`.`;
  const lines = [...QUESTION];
  if (verdict.state.rule === 'R6') lines.splice(1, 0, 'It carries the Toolkit governed rules block but no programme binding.');
  return lines.join('\n');
}

function unreadableText(code) {
  return `Toolkit: the governance state of this repository could not be read (${code}), so your message was held and not sent. Run ${terminalCommand('check')} in a terminal to see why.`;
}

function replayContext(state, prompts) {
  const label = state.state === 'ENABLED' && state.materials_complete === false ? 'ENABLED (materials incomplete)' : state.state;
  const lines = [`Toolkit governance is now ${label} for this repository; the user just answered the governance question.`];
  if (prompts.length > 0) {
    lines.push('Messages the user sent while the repository was held, oldest first. Treat them as the user\'s requests:');
    prompts.forEach((text, index) => lines.push(`${index + 1}. ${text}`));
  }
  return lines.join('\n');
}

// ---- prompt hold ------------------------------------------------------------------------------

// The host-neutral UserPromptSubmit decision: { action: 'pass' } | { action: 'pass', context } |
// { action: 'block', reason }.
class PromptHold {
  #gate; #held; #registryOptions; #environment; #now;

  constructor({ registryOptions = {}, environment = process.env, now = () => new Date(), stateReader = null } = {}) {
    this.#registryOptions = registryOptions;
    this.#gate = new GovernanceGate({ registryOptions, stateReader, now });
    this.#held = new HeldPrompts({ registryOptions, now });
    this.#environment = environment || {};
    this.#now = now;
  }

  decide({ cwd, prompt }) {
    const verdict = this.#gate.evaluate(cwd);
    if (!verdict.hold) return verdict.reason === 'portable' ? { action: 'pass' } : this.#replayIfAny(verdict.state);
    if (verdict.reason === 'state-unreadable') return { action: 'block', reason: unreadableText(verdict.state.error_code) };
    const answer = ANSWER.exec(String(prompt || ''));
    if (answer) return this.#answer(cwd, answer[1].toLowerCase(), verdict);
    const held = this.#held.add(verdict.state.repository_id, prompt);
    return { action: 'block', reason: questionText(verdict, held) };
  }

  // A decision made elsewhere (the terminal command, another clone) still hands back held prompts.
  #replayIfAny(state) {
    if (!state.repository_id) return { action: 'pass' };
    const prompts = this.#held.take(state.repository_id);
    return prompts.length === 0 ? { action: 'pass' } : { action: 'pass', context: replayContext(state, prompts) };
  }

  #answer(cwd, command, verdict) {
    // A session a Toolkit launcher started is automation, not the user typing.
    if (LAUNCHER_MARKERS.some(name => typeof this.#environment[name] === 'string' && this.#environment[name] !== '')) {
      return { action: 'block', reason: 'Toolkit: an automated session cannot answer the governance question. Answer it in your own chat, or run the command in your own terminal.' };
    }
    let decided;
    try {
      decided = writeGovernanceDecision(cwd, command, { registryOptions: this.#registryOptions, now: this.#now });
    } catch (error) {
      return { action: 'block', reason: `Toolkit: your answer could not be recorded (${codeOf(error)}), so nothing changed and this repository is still held. Try again, or run ${terminalCommand(command)} in a terminal.` };
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

// The host-neutral PreToolUse decision: null (no decision) or { deny: reason }.
class ToolGate {
  #gate;

  constructor({ registryOptions = {}, stateReader = null, now } = {}) {
    this.#gate = new GovernanceGate({ registryOptions, stateReader, now });
  }

  decide(input) {
    const tool = String(input && (input.tool_name || input.toolName) || '');
    if (SHELL_TOOLS.test(tool) && answerCommand(toolText(input))) {
      return { deny: 'Toolkit: only the user answers the governance question. Ask the user to type it as their own message, or to run the command in their own terminal.' };
    }
    if (EDIT_TOOLS.test(tool) && editTargets(input).some(target => USER_STATE_PATH.test(path.resolve(String(input.cwd || process.cwd()), target)))) {
      return { deny: 'Toolkit: its user-state files (governance decisions and held messages) are changed only by Toolkit itself.' };
    }
    if (READ_ONLY_TOOLS.test(tool)) return null;
    const verdict = this.#gate.evaluate(input && input.cwd);
    if (!verdict.hold) return null;
    if (verdict.reason === 'state-unreadable') return { deny: `Toolkit: the governance state of this repository could not be read (${verdict.state.error_code}), so nothing runs here until it can.` };
    return { deny: 'Toolkit: this repository has no governance decision yet, so nothing runs here. Ask the user to reply `toolkit governance enable` or `toolkit governance decline`; do not try to work around it.' };
  }
}

// ---- session line -----------------------------------------------------------------------------

function sessionLine(cwd, { registryOptions = {}, stateReader = null, now } = {}) {
  const verdict = new GovernanceGate({ registryOptions, stateReader, now }).evaluate(cwd);
  const state = verdict.state;
  if (state.state === 'PORTABLE') return null;
  if (verdict.hold) {
    if (verdict.reason === 'state-unreadable') return `Toolkit governance: the state of this repository could not be read (${state.error_code}). Every user message is held until it can; do not try to work around it.`;
    return 'Toolkit governance: this repository has no decision yet. Every user message is held until the user replies `toolkit governance enable` or `toolkit governance decline`; do not try to work around it.';
  }
  return decidedLine(state) + (verdict.file === 'unwritable'
    ? ` (Toolkit could not save its copy in the ${repoState.FOLDER} folder (${verdict.error_code}); nothing is held because of that.)`
    : '');
}

function decidedLine(state) {
  if (state.state === 'DECLINED') return 'Toolkit governance: DECLINED for this repository. Follow only the global rules; any TOOLKIT-GOVERNED-RULES block in AGENTS.md does not apply.';
  if (state.materials_complete === false) return 'Toolkit governance: ENABLED, materials incomplete (the governed block or `.github/toolkit-programme.json` is missing). The global rules plus gates, subagents and portable skills apply; programme records do not.';
  return 'Toolkit governance: ENABLED for this repository. Follow the global rules and the TOOLKIT-GOVERNED-RULES block in AGENTS.md.';
}

// ---- fail-closed fallbacks --------------------------------------------------------------------

// Used when the gate itself failed: inside a git repository (or when that cannot be told) it holds.
function insideRepository(cwd) {
  try { return governance.findGitRoot(typeof cwd === 'string' && cwd ? cwd : process.cwd()) !== null; } catch { return true; }
}

module.exports = Object.freeze({
  ANSWER,
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
});
