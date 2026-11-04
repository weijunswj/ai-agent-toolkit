#!/usr/bin/env node
'use strict';

// Governance comes only from the programme file merged on origin's default branch.
// enable/disable capture a terminal answer and prepare the same proposal as the host gate.
// publish is available to the assigned agent only with a live pending owner-answer receipt.
const path = require('node:path');
const { detectAgentHost } = require('./agent-host-markers.cjs');
const readline = require('node:readline');

const fs = require('node:fs');
const crypto = require('node:crypto');
const { GovernanceProposals, GitHubProposalTransport } = require('./toolkit-governance-proposal.cjs');
const governance = require('./toolkit-governance-state.cjs');
const conformance = require('./toolkit-governance-conformance.cjs');
const catalogue = require('./toolkit-governance-catalogue.cjs');
const gate = require('./toolkit-governance-gate.cjs');
const discovery = require('./toolkit-governance-discovery.cjs');
const bindingCache = require('./toolkit-governance-binding.cjs');
const protection = require('./toolkit-governance-protection.cjs');
const security = require('./toolkit-governance-security.cjs');
const hookCapability = require('./toolkit-hook-capability.cjs');
const { GovernanceMaintenance, appendRunRecord } = require('./toolkit-governance-migration.cjs');

const CMD = subcommand => `\`${governance.governanceCommand(subcommand)}\``;
const ADOPTION_NOT_READY = 'The adoption proposal is not ready. Run toolkit governance discover, resolve missing parent, separate private evidence store or checks, then use repository-agent-rules to prepare the binding and governed rules. Publish them together in one setup pull request.';
const PROPOSAL_ERRORS = Object.freeze({
  PROPOSAL_WRITE_REQUIRED: 'This GitHub account cannot write to this repository. Continue with global rules, without governance effects or standing task auto-merge. An owner with write access can publish the proposal.',
  PROPOSAL_CONFLICT: 'Conflicting governance proposals are open. Show their links and ask the owner which to keep before publishing again. None decides governance.',
  PROPOSAL_RECEIPT_REQUIRED: 'No live pending owner answer remains for this run. Check the existing decision pull request; if it closed, ask the owner again in this chat before preparing another.',
});

const COMMANDS = Object.freeze(['status', 'discover', 'enable', 'disable', 'reopen', 'check', 'catalogue', 'publish', 'security', 'migrate']);
const ALIASES = Object.freeze({ decline: 'disable' });
const USAGE = `Usage: ${governance.governanceCommand('<status|discover|enable|disable|reopen|catalogue|publish|security> [--json]')}\n`
  + `       ${governance.governanceCommand('check [--json] [--offline]')}\n`
  + `       ${governance.governanceCommand('publish --run <pending receipt>')}\n`
  + `       ${governance.governanceCommand('migrate [--root <folder>]...')} (protection/security maintenance only; no local decisions)\n`;

const RULES_TEXT = Object.freeze({
  ENABLED: 'Global rules and coding gates, plus GitHub governance: programme records, decision traces and evidence custody.',
  UNAVAILABLE: "Couldn't check governance. Continue with global rules and coding gates; no governance effects or standing task auto-merge until it can be checked.",
  ERROR: 'Global rules and coding gates. The binding merged on the default branch cannot be used, so governed records, gate admission and finality hold until a pull request fixes it.',
  DISABLED: 'Global rules and coding gates, without GitHub governance. A governed block in AGENTS.md is not followed.',
  UNDECIDED: `GitHub governance is not decided yet. A verified read-only account continues with global rules, without governance effects or standing task auto-merge. If this account can write, answer yes, no or later after Toolkit shows the question in this chat run. Other wording uses a one-use reply ticket; in your own terminal, ${CMD('enable')} or ${CMD('disable')} also works.`,
});

class GovernanceCliError extends Error {
  constructor(message, exitCode = 2) {
    super(message);
    this.name = 'GovernanceCliError';
    this.exitCode = exitCode;
  }
}

class ToolkitGovernanceCli {
  #proposals; #stdout; #stderr; #ask; #interactive; #cwd; #registryOptions; #discoveryGh; #refresh; #rulesetReader; #rulesetCreator; #stateRulesetCreator; #protectionReader; #protectionWriter; #securityReader; #securityWriter; #securityFileWriter; #hookReader; #queueReader;

  // `ask(question)` resolves to the typed line; `interactive` says whether a person is at a
  // terminal. `registryOptions` ({ registryPath, testOnly: true }), `rulesetReader`,
  // `rulesetCreator`, `stateRulesetCreator`, `protectionReader`, `protectionWriter`, `securityReader`, `securityWriter` and
  // `securityFileWriter` are only for tests, as are `discoveryGh` (discovery's GitHub reader) and
  // `refresh` (the merged-binding refresh `status` runs first), `hookReader` (the Hooks: lines) and
  // `queueReader` (the offline queue count for a repository root).
  constructor({ stdout = process.stdout, stderr = process.stderr, ask = terminalAsk, interactive = isInteractiveTerminal(), cwd = process.cwd(), registryOptions = {}, discoveryGh = null, refresh = null, rulesetReader = null, rulesetCreator = null, stateRulesetCreator = null, protectionReader = null, protectionWriter = null, securityReader = null, securityWriter = null, securityFileWriter = null, hookReader = null, queueReader = null, proposalTransport = null } = {}) {
    this.#proposals = new GovernanceProposals({ registryOptions, transport: proposalTransport || (registryOptions.testOnly || process.env.TOOLKIT_GOVERNANCE_OFFLINE === '1' ? null : new GitHubProposalTransport()) });
    this.#stdout = stdout;
    this.#stderr = stderr;
    this.#ask = ask;
    this.#interactive = interactive === true;
    this.#cwd = cwd;
    this.#registryOptions = registryOptions;
    this.#discoveryGh = discoveryGh;
    this.#refresh = refresh || (cwd => governance.refreshMergedBinding(cwd, registryOptions));
    this.#rulesetReader = rulesetReader;
    this.#rulesetCreator = rulesetCreator;
    this.#stateRulesetCreator = stateRulesetCreator;
    this.#protectionReader = protectionReader;
    this.#protectionWriter = protectionWriter;
    this.#securityReader = securityReader;
    this.#securityWriter = securityWriter;
    this.#securityFileWriter = securityFileWriter;
    this.#hookReader = hookReader || (() => hookCapability.hookCapability());
    this.#queueReader = queueReader || (root => require('../../skills/github-program-reconciler/scripts/programme-checkpoint.cjs').queueSummary(root));
  }

  async main(argv) {
    const args = [...argv];
    const json = args.includes('--json');
    const offline = args.includes('--offline');
    let rest = args.filter(arg => arg !== '--json' && arg !== '--offline');
    let requestedRun = null;
    if (rest[0] === 'publish' && rest.length === 3 && rest[1] === '--run' && /^[a-f0-9]{32}$/.test(rest[2])) {
      requestedRun = rest[2]; rest = ['publish'];
    }
    const command = ALIASES[rest[0]] || rest[0];
    const roots = [];
    if (command === 'migrate') {
      for (let index = 1; index < rest.length; index += 2) {
        if (rest[index] !== '--root' || !rest[index + 1]) { this.#stderr.write(USAGE); return 2; }
        roots.push(path.resolve(this.#cwd, rest[index + 1]));
      }
    }
    if (!COMMANDS.includes(command) || (command !== 'migrate' && rest.length !== 1) || (offline && command !== 'check') || (json && command === 'migrate')) {
      this.#stderr.write(USAGE);
      return 2;
    }
    try {
      if (command === 'migrate') return await new GovernanceMaintenance({
        stdout: this.#stdout, ask: this.#ask, interactive: this.#interactive, registryOptions: this.#registryOptions,
        rulesetReader: this.#rulesetReader, rulesetCreator: this.#rulesetCreator, stateRulesetCreator: this.#stateRulesetCreator,
        protectionReader: this.#protectionReader, protectionWriter: this.#protectionWriter,
        securityReader: this.#securityReader, securityWriter: this.#securityWriter, securityFileWriter: this.#securityFileWriter,
      }).run(roots.length ? roots : [this.#cwd]);
      if (command === 'status') return this.#status(json);
      if (command === 'discover') return this.#discover(json);
      if (command === 'check') return this.#check(json, offline);
      if (command === 'catalogue') return this.#catalogue(json);
      if (command === 'security') return this.#security(json);
      if (command === 'reopen') return this.#reopen(json);
      if (command === 'publish') return this.#publish(json, requestedRun);
      return await this.#decide(command, json);
    } catch (error) {
      if (PROPOSAL_ERRORS[error.code]) {
        this.#stderr.write(`${PROPOSAL_ERRORS[error.code]}\n`);
        return 2;
      }
      if (error.code === 'PROPOSAL_ADOPTION_INCOMPLETE') {
        this.#stderr.write(`${ADOPTION_NOT_READY}\n`);
        return 2;
      }
      if (error instanceof GovernanceCliError) {
        this.#stderr.write(`${error.message}\n`);
        return error.exitCode;
      }
      this.#stderr.write(`Toolkit governance stopped because of an unexpected problem (${error?.name || 'Error'}${error?.code ? ` ${error.code}` : ''}). The operation did not finish or could not be verified. Read back its result before retrying.\n`);
      return 2;
    }
  }

  #state() { return governance.governanceState(this.#cwd, this.#registryOptions); }

  #print(json, value, lines) {
    this.#stdout.write(json ? `${JSON.stringify(value, null, 2)}\n` : `${lines.join('\n')}\n`);
  }

  #status(json) {
    const refresh = this.#refresh(this.#cwd) || {};
    const state = this.#state();
    if (state.state === 'UNDECIDED' && this.#registryOptions.testOnly !== true && process.env.TOOLKIT_GOVERNANCE_OFFLINE !== '1') this.#proposals.refresh(this.#cwd);
    if (state.merged?.fresh && ['M1', 'M2'].includes(state.rule)) this.#proposals.settle(this.#cwd, state);
    // Why the merged binding was not read just now, in plain words (nothing to say when it was, or
    // when the repository is not a github.com one).
    const reason = refresh.refreshed === false ? bindingCache.refreshReason(refresh.error) : null;
    const lines = describe(state);
    const pending = state.state === 'UNDECIDED' ? this.#proposals.pending(this.#cwd) : null;
    if (pending) lines.push(pending.text);
    if (reason) lines.push(`Refresh held: ${reason}. The last read on this computer is kept.`);
    let hooks = null;
    try { hooks = this.#hookReader(); } catch { hooks = null; }
    if (hooks) lines.push(...hookCapability.describeHooks(hooks));
    else lines.push('Hooks: could not be checked on this computer.');
    let queue = null;
    try { queue = state.root ? this.#queueReader(state.root) : null; } catch { queue = null; }
    if (queue && queue.count > 0) lines.push(`Queue: ${queue.count} turn${queue.count === 1 ? '' : 's'} waiting (oldest ${String(queue.oldest).slice(0, 10)}); they are written at the next turn end that can reach GitHub, and dropped unwritten after seven days.`);
    const extra = { ...(pending ? { pending } : {}), ...(reason ? { refresh: { refreshed: false, reason: refresh.error } } : {}), ...(hooks ? { hooks: hooks.hosts } : {}), ...(queue ? { queue } : {}) };
    this.#print(json, { ...state, ...extra }, lines);
    return state.rule === 'ERROR' || state.state === 'ERROR' ? 2 : 0;
  }

  #discovery() { return new discovery.GovernanceDiscovery({ registryOptions: this.#registryOptions, ...(this.#discoveryGh ? { gh: this.#discoveryGh } : {}) }); }

  #discover(json) {
    const result = this.#discovery().discover(this.#cwd);
    this.#print(json, result, discovery.describeDiscovery(result));
    return result.status === 'error' ? 2 : 0;
  }

  #check(json, offline) {
    const options = { host: detectAgentHost(), ...this.#registryOptions, offline };
    if (this.#rulesetReader) options.rulesetReader = this.#rulesetReader;
    if (this.#protectionReader) options.protectionReader = this.#protectionReader;
    if (this.#securityReader) options.securityReader = this.#securityReader;
    const result = conformance.checkConformance(this.#cwd, options);
    const unverified = result.findings.filter(entry => entry.severity === 'unverified').length;
    const lines = [`Conformance: ${result.status}${unverified ? ` (${unverified} item${unverified === 1 ? '' : 's'} unverified)` : ''}`];
    if (result.state) lines.push(`State: ${label(result.state)}`);
    for (const entry of result.findings) lines.push(`- ${entry.severity}: ${entry.message}`);
    if (result.no_force_push_ruleset) lines.push(`No-force-push ruleset: ${result.no_force_push_ruleset.status}`);
    if (result.default_branch_protection) lines.push(`Default-branch protection: ${result.default_branch_protection.status}`);
    if (result.dependency_security) lines.push(`Dependency and security settings: ${result.dependency_security.status}`);
    lines.push('Prompt-hold enforcement:');
    for (const [host, status] of Object.entries(result.enforcement)) lines.push(`- ${host}: ${status.status} (${status.reason})`);
    this.#print(json, result, lines);
    return result.exit_code;
  }

  #catalogue(json) {
    const state = this.#state();
    const skills = catalogue.catalogueForState(state);
    const lines = [`Skills offered in this repository (${label(state)}):`];
    if (skills.length === 0) lines.push(`- none until you answer Toolkit's question in chat, or run ${CMD('enable')} or ${CMD('disable')} in your own terminal`);
    for (const entry of skills) lines.push(`- ${entry.skill}${entry.tier === 'governed' ? ' (governed)' : ''}`);
    this.#print(json, { state: state.state, materials_complete: state.materials_complete, skills }, lines);
    return 0;
  }

  // The free settings are on by default for a governed repository, so this asks nothing; nothing
  // that needs billing is turned on. Auto-merge follows the binding merged on the default branch,
  // never the working tree.
  // GitHub unreadable, before or after, is exit 2, never "already on" or "read back". Every change
  // is recorded with what GitHub showed before.
  #security(json) {
    const state = this.#state();
    if (state.rule === 'ERROR') throw new GovernanceCliError(`The governance state could not be read (${state.error_code}).`);
    if (state.state !== 'ENABLED' || !state.materials || !state.materials.binding) {
      this.#print(json, { state: state.state, writes: 0 }, [`Nothing changed. Toolkit turns on dependency and security settings only in a governed repository with a programme binding; this one is ${label(state)}.`]);
      return 1;
    }
    if (!state.programme_records_bind) {
      this.#print(json, { state: state.state, writes: 0 }, [`Nothing changed. The binding merged on the default branch was last read over 24 hours ago; run ${CMD('status')} online first.`]);
      return 1;
    }
    const protectionOptions = this.#protectionReader ? { reader: this.#protectionReader } : {};
    const requiredChecks = governance.bindingRequiredChecks(state.root, this.#registryOptions);
    const read = () => security.dependencySecurity(state.root, {
      protectionResult: requiredChecks ? protection.defaultBranchProtection(state.root, { requiredChecks, ...protectionOptions }) : null,
      ...(this.#securityReader ? { reader: this.#securityReader } : {}),
    });
    const before = read();
    if (before.status === 'not-applicable') {
      this.#print(json, { state: state.state, writes: 0 }, ['Nothing changed. This repository is not on github.com.']);
      return 1;
    }
    const outcome = security.applySecurity(state.root, before, {
      ...(this.#securityWriter ? { writer: this.#securityWriter } : {}),
      ...(this.#securityFileWriter ? { fileWriter: this.#securityFileWriter } : {}),
      reread: read,
    });
    const lines = security.describeOutcome(before.slug, state.root, before, outcome);
    if (outcome.result === 'nothing' && before.status === 'conformant') lines.push(`${before.slug}: every dependency and security setting Toolkit manages is already on.`);
    if (outcome.result !== 'nothing') {
      appendRunRecord(this.#registryOptions, { at: new Date().toISOString(), command: 'security', securities: [{ repository_id: state.repository_id, prior: outcome.prior, settings: outcome.settings, files: outcome.files, result: outcome.result }] });
    }
    this.#print(json, { status: before.status, outcome }, lines);
    return ['failed', 'unverified'].includes(outcome.result) || before.status === 'unverified' ? 2 : 0;
  }

  #reopen(json) {
    const state = this.#state();
    if (state.rule === 'ERROR') throw new GovernanceCliError(`The governance state could not be read (${state.error_code}).`);
    if (['M0', 'M1', 'M2'].includes(state.rule)) {
      this.#print(json, { state: state.state, writes: 0 }, [`Nothing changed. This repository is ${label(state)} by the programme binding merged on its default branch, on every computer.`, 'To change it, merge a pull request that changes .github/toolkit-programme.json.']);
      return 0;
    }
    const lines = state.state === 'DISABLED'
      ? ['Nothing changed. You disabled Toolkit governance for this repository, so Toolkit does not ask about it.', `To turn it on, run ${CMD('enable')}. To keep it off, do nothing.`]
      : [`Nothing changed. This repository is ${label(state)}, so there is no disabled decision to reopen.`, state.state === 'ENABLED'
        ? `To turn governance off, run ${CMD('disable')}.`
        : `To decide, answer Toolkit's question in chat, or run ${CMD('enable')} or ${CMD('disable')} in your own terminal.`];
    this.#print(json, { state: state.state, writes: 0 }, lines);
    return 0;
  }

  // Publication uses only a live receipt from an accepted owner answer.
  #publish(json, suppliedRun = null) {
    const pending = this.#proposals.pending(this.#cwd, { sessionId: process.env.TOOLKIT_HOST_SESSION || process.env.CODEX_THREAD_ID,
      epoch: new gate.SessionEpochs({ registryOptions: this.#registryOptions }).get(process.env.TOOLKIT_HOST_SESSION || process.env.CODEX_THREAD_ID) });
    const run = suppliedRun || (pending?.kind === 'preparing' ? pending.run : null);
    if (!run) throw new GovernanceCliError(pending?.text || 'No pending owner answer for this run. Ask the owner in this chat; an agent cannot answer for them.');
    let binding = null;
    try { binding = JSON.parse(fs.readFileSync(path.join(this.#cwd, governance.BINDING_FILE), 'utf8')); } catch { /* prepare explains missing adoption */ }
    const result = this.#proposals.publish(this.#cwd, run, binding);
    this.#print(json, result, [result.text]);
    return 0;
  }

  async #decide(command, json) {
    const before = this.#state();
    if (before.rule === 'R1' && command === 'enable') throw new GovernanceCliError('This folder is not inside a git repository, so GitHub governance is DISABLED automatically. Nothing was written.');
    if (['R1', 'R8', 'S1', 'R1s'].includes(before.rule)) {
      if (command === 'enable') throw new GovernanceCliError(before.rule === 'S1' ? 'This repository is an evidence store named by a programme binding, so governance cannot be enabled here.' : before.rule === 'R1s' ? 'This repository is a scratch clone, so governance cannot be enabled here.' : 'GitHub governance works only for github.com repositories. Nothing was written.');
      this.#print(json, { state: before.state, writes: 0 }, ['GitHub governance is off automatically here; there is nothing to decide.']);
      return 0;
    }
    if (!this.#interactive) throw new GovernanceCliError('No answer was recorded. Ask the owner in this chat; an agent cannot answer for them.');
    const answer = command === 'enable' ? 'yes' : 'no';
    if (before.merged?.fresh && (before.rule === 'M1' && answer === 'yes' || before.rule === 'M2' && answer === 'no')) {
      this.#print(json, { state: before.state, writes: 0 }, ['Already ' + before.state.toLowerCase() + ' on the default branch. Nothing was written.']);
      return 0;
    }
    if (String(await this.#ask('Prepare a pull request setting repository governance ' + (answer === 'yes' ? 'on' : 'off') + ' on every computer? It applies only after the owner merges it. Type yes: ')).trim().toLowerCase() !== 'yes') {
      this.#print(json, { state: before.state, writes: 0 }, ['Not confirmed. Nothing was written.']);
      return 1;
    }
    const sessionId = 'terminal-' + crypto.randomBytes(16).toString('hex'), epoch = crypto.randomBytes(16).toString('hex');
    const request = this.#proposals.request(this.#cwd, answer, { sessionId, epoch });
    try { return this.#publish(json, request.run); }
    catch (error) {
      this.#print(json, { state: before.state, pending: true, run: request.run, error: error.code || 'PROPOSAL_UNAVAILABLE' }, [this.#proposals.pending(this.#cwd, { sessionId, epoch }).text,
        PROPOSAL_ERRORS[error.code] || (error.code === 'PROPOSAL_ADOPTION_INCOMPLETE' ? ADOPTION_NOT_READY : 'Proposal publication is unverified (' + (error.code || 'PROPOSAL_UNAVAILABLE') + '). Check GitHub access and matching open proposals before retrying. No local governance decision was written.')]);
      return 2;
    }
  }
}

function label(state) {
  return state.state.replace(/_/g, ' ');
}

function describe(state) {
  if (state.state === 'ERROR') return ['State: ERROR', `Rules: ${RULES_TEXT.ERROR}`, `Problem: ${(state.merged && state.merged.problems.join(', ')) || 'unreadable'}`, ...(state.root ? [`Repository: ${state.root}`] : [])];
  const key = state.state;
  const lines = [`State: ${label(state)}`, `Rules: ${RULES_TEXT[key]}`];
  if (state.root) lines.push(`Repository: ${state.root}`);
  if (state.rule === 'R1') lines.push(`Folder: ${state.folder} (not a git repository, so DISABLED automatically).`);
  if (state.rule === 'M1') lines.push('Decided by the programme binding merged on the default branch, so no computer asks.');
  if (state.rule === 'M2') lines.push('The programme binding merged on the default branch sets governance to disabled; only an owner-merged pull request turns it back on.');
  if (state.rule === 'S1') lines.push('An evidence store named by an exact programme binding: agent-managed, never governed and never asked about.');
  if (state.rule === 'R1s') lines.push("A scratch clone in another repository's ignored .tmp folder: never governed and never asked about.");
  for (const note of state.notes || []) if (NOTE_TEXT[note]) lines.push(NOTE_TEXT[note](state));
  if (state.rule === 'R8') lines.push(`DISABLED automatically, not on github.com: ${state.host ? `this repository is on ${state.host}` : state.reason === 'origin-ambiguous' ? 'there is more than one origin remote' : 'there is no github.com origin remote'}. Toolkit asks about GitHub governance if the repository moves to github.com.`);
  return lines;
}

const NOTE_TEXT = Object.freeze({
  'could-not-check-governance': () => "Couldn't check governance. Ordinary work continues without governance effects or standing task auto-merge until it can be checked.",
  'binding-v2-migration-offered': () => 'The merged binding is version 1; the next setup pull request moves it to version 2.',
  'merged-binding-stale': () => 'The last read of the merged binding is over 24 hours old, so governed records, gate admission and finality hold until it is read again online.',
  'binding-belongs-to-other-repository': state => `The default branch's binding belongs to ${state.merged.foreign_repository}, so it does not apply here.`,
  'pending-binding-merge': () => 'Pending: the working tree has a programme binding; merge it on the default branch to apply it.',
});

function isInteractiveTerminal() {
  return Boolean(process.stdin.isTTY && process.stderr.isTTY);
}

function terminalAsk(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

if (require.main === module) {
  new ToolkitGovernanceCli().main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}

module.exports = Object.freeze({ ToolkitGovernanceCli, COMMANDS });
