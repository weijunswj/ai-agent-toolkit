#!/usr/bin/env node
'use strict';

// Governance comes only from the programme file merged on origin's default branch.
// enable/disable capture a terminal answer and prepare the same proposal as the host gate.
// publish is available to the assigned agent only with a live pending owner-answer receipt.
const path = require('node:path');
const { detectAgentHost } = require('./agent-host-markers.cjs');
const readline = require('node:readline');
const ownerTerminal = require('./owner-terminal.cjs');
const { AGENT_SHELL_MARKERS } = require('./agent-shell-markers.cjs');

const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const util = require('node:util');
const { GovernanceProposals, GitHubProposalTransport, BANK_ONLY } = require('./toolkit-governance-proposal.cjs');
const governance = require('./toolkit-governance-state.cjs');
const { withoutRetiredKeys, withoutRetiredKeysText } = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');
const conformance = require('./toolkit-governance-conformance.cjs');
const gate = require('./toolkit-governance-gate.cjs');
const discovery = require('./toolkit-governance-discovery.cjs');
const bindingCache = require('./toolkit-governance-binding.cjs');
const protection = require('./toolkit-governance-protection.cjs');
const security = require('./toolkit-governance-security.cjs');
const hookCapability = require('./toolkit-hook-capability.cjs');
const governanceApp = require('./toolkit-governance-app.cjs');
const governanceBank = require('./toolkit-governance-bank.cjs');
const cleanupRoute = require('./toolkit-governance-cleanup.cjs');
const adopt = require('./toolkit-governance-adopt.cjs');
const { GovernanceMaintenance, appendRunRecord } = require('./toolkit-governance-migration.cjs');
const finishing = require('./toolkit-governance-finish.cjs');
const { FirstInstallSweep } = require('./toolkit-governance-first-sweep.cjs');
const { managedToolkitFile } = require('./toolkit-user-state.cjs');

const CMD = subcommand => `\`${governance.governanceCommand(subcommand)}\``;
const ADOPTION_NOT_READY = 'The turn-on pull request is not ready: it needs the programme file and the plain-text check. Run toolkit governance where GitHub can be read: its bank makes the missing parent issue and private evidence store and adds the CI checks to one setup pull request. Build none of it by hand.';
const PROPOSAL_ERRORS = Object.freeze({
  PROPOSAL_WRITE_REQUIRED: 'This GitHub account cannot write to this repository. Continue with global rules, without governance effects or standing task auto-merge. An owner with write access can publish the proposal.',
  PROPOSAL_CONFLICT: 'Conflicting governance proposals are open. Show their links and ask the owner which to keep before publishing again. None decides governance.',
  PROPOSAL_RECEIPT_REQUIRED: 'No live pending owner answer remains for this run. Check the existing decision pull request; if it closed, ask the owner again in this chat before preparing another.',
});
// Whether publishing stopped with the proposal code's own reason, and not with an unexpected error.
const publishStopped = error => /^PROPOSAL_[A-Z_]+$/.test(String(error.code));
// The one line for a decision pull request that was not published.
function publishError(error) {
  return PROPOSAL_ERRORS[error.code] || (error.code === 'PROPOSAL_ADOPTION_INCOMPLETE' ? ADOPTION_NOT_READY
    : `Proposal publication is unverified (${error.code || 'PROPOSAL_UNAVAILABLE'}). Check GitHub access and matching open proposals before retrying. No local governance decision was written.`);
}

const COMMANDS = Object.freeze(['status', 'discover', 'enable', 'disable', 'check', 'publish', 'security', 'migrate', 'setup', 'refresh', 'finish']);
// The exit code that means "the bank is shown; stop and wait for the owner's reply", as in setup toolkit.
// A shown bank is a finished step, not a failure: the app would label any other exit Failed.
const BANK_SHOWN = 0;
// How many replies the owner's own terminal reads for one bank before it stops with nothing written.
const TERMINAL_TRIES = 5;
// A bank asked for when the merged binding could not be read just now reads it once more, with a longer
// limit for each git step than the first read had (a slow fetch or a lock held by another git process).
const BANK_REREAD_TIMEOUT_MS = 3 * bindingCache.GIT_TIMEOUT_MS;
// When even that read fails: the owner gets a plain line to type the command again, never a status.
const BANK_UNREAD = 'The governance question bank could not be shown because GitHub could not be read just now, so this computer cannot confirm the settings merged for this repository. Nothing changed. Type toolkit governance again in a moment.';
const BANK_UNREAD_AGENTS = 'Agents: this line is for you alone. Show the owner the line above exactly as printed, leaving out this line, then stop. Run no other governance command, and never show a status, check or summary in place of the bank.';
const ANSWER_UNREAD = 'Nothing changed, and this answer was not used: GitHub could not be read just now, so this computer cannot confirm the settings merged for this repository. Type toolkit governance again in a moment to see the bank and answer it.';
// A read-only explain uses no answer, so it says only that the row cannot be shown yet.
const EXPLAIN_UNREAD = 'This row cannot be explained yet: GitHub could not be read just now, so this computer cannot confirm the settings merged for this repository. Nothing changed. Type toolkit governance again in a moment.';
// Causes that stay until someone changes this computer's or repository's settings: the unread line
// names them, so the owner is not told to retry something a retry cannot fix.
const LASTING_REFRESH_CAUSES = Object.freeze(['remote-redirected', 'hooks-unguarded', 'cache-unwritable']);
function bankUnreadLine(error) {
  if (!LASTING_REFRESH_CAUSES.includes(error)) return BANK_UNREAD;
  return `The governance question bank could not be shown because the settings merged for this repository could not be read: ${bindingCache.refreshReason(error)}. Nothing changed. This does not clear on its own: fix that, then type toolkit governance again.`;
}
const CLOUD_BANK = `This is a cloud session, where Toolkit cannot check that a reply is the owner's own, so an answer in this chat cannot be recorded. Answer this bank from a Remote Control session on your computer, or run ${CMD('setup')} in your own terminal.`;
const ALIASES = Object.freeze({ decline: 'disable' });
const USAGE = `Usage: ${governance.governanceCommand('<status|discover|enable|disable|publish|security> [--json]')}\n`
  + `       ${governance.governanceCommand('check [--json] [--offline]')}\n`
  + `       ${governance.governanceCommand('publish --run <pending receipt>')}\n`
  + `       ${governance.governanceCommand('<setup|refresh> [--json]')} (the governance question bank; refresh is the same)\n`
  + `       ${governance.governanceCommand('setup --answers "[<bank reference>: ]explain <row>"')} (one row's full text; no ticket, writes nothing)\n`
  + `       ${governance.governanceCommand('setup --answers "<bank reference>: <answer>" --ticket <owner reply ticket>')}\n`
  + `       ${governance.governanceCommand('migrate [--root <folder>]...')} (protection/security maintenance only; no local decisions)\n`
  + `       ${governance.governanceCommand('finish')} (the session start runs it once after a bank turn-on merges)\n`;

const RULES_TEXT = Object.freeze({
  ENABLED: 'Global rules and coding gates, plus GitHub governance: programme records, decision traces and evidence custody.',
  UNAVAILABLE: "Couldn't check governance. Continue with global rules and coding gates; no governance effects or standing task auto-merge until it can be checked.",
  ERROR: 'Global rules and coding gates. The binding merged on the default branch cannot be used, so governed records, gate admission and finality hold until a pull request fixes it.',
  DISABLED: 'Global rules and coding gates, without GitHub governance. Any governed block in AGENTS.md is an old copy and is not followed.',
  UNDECIDED: `GitHub governance is not decided yet, so it counts as off: work continues under the global rules, without governance effects or standing task auto-merge, and nothing waits on the answer. Toolkit asks once per session. An account that can write decides by answering yes, no or later when Toolkit asks, or by saying toolkit governance and answering its question bank.`,
});

// The fixed summary of a bank turn-on pull request: what merging it does, what it holds, the checks it
// requires and what Toolkit finishes after the merge. The closing line follows the owner's commands
// (#applyBank). It gives the owner no step of their own: Toolkit sets the required checks, and the
// checkout holds nothing the merge brings in, so the session-start catch-up moves it.
// `binding` is the binding the pull request proposes, and `storeNote` says how the store was chosen
// (found, created or named), or null.
function turnOnSummary(result, binding, storeNote = null) {
  const url = result.proposal.url;
  return [
    result.reused ? (result.updated ? `Toolkit: updated the open governance turn-on pull request with these answers: ${url}.` : `Toolkit: the open governance turn-on pull request already holds these answers: ${url}.`)
      : `Toolkit: prepared the governance turn-on pull request: ${url}.`,
    'Merging it turns governance on for this repository on every computer. It changes no credentials or deployment. Anything listed above as made on GitHub was made now; everything else applies only after you merge it.',
    ...(binding?.store?.repository ? [`Store: ${binding.store.repository}, a private GitHub repository${storeNote ? ` (${storeNote})` : ''}, for programme records and evidence.`] : []),
    ...(result.files?.length ? [`It holds: ${result.files.join(', ')}.`] : []),
    ...(result.requiredChecks?.length ? [`Required checks: ${result.requiredChecks.join(', ')}. Toolkit sets them in the programme file, so every pull request passes them before it lands.`] : []),
    ...(result.added?.includes('personal-data-guard') ? ['Personal data guard: checks each pull request and push on GitHub (on a private repository that uses Actions minutes), with no hooks on any computer. It never scans commit author or committer addresses, and it passes images and fonts unread and names each one.'] : []),
    ...(result.notes || []),
    `After the merge, the next session here finishes on its own: ${finishing.WHAT}. On a private repository on GitHub Free, GitHub cannot enforce the protection or the rulesets; that session says so and the local guards stay the fallback.`,
    'Nothing was written to your checkout, so after the merge the next session here can bring your local default branch up to date on its own.',
  ];
}

class GovernanceCliError extends Error {
  constructor(message, exitCode = 2) {
    super(message);
    this.name = 'GovernanceCliError';
    this.exitCode = exitCode;
  }
}

class ToolkitGovernanceCli {
  #proposals; #proposalsLive; #pullOutcome; #stdout; #stderr; #ask; #confirm; #interactive; #cwd; #registryOptions; #discoveryGh; #refresh; #rulesetReader; #rulesetCreator; #stateRulesetCreator; #protectionReader; #protectionWriter; #securityReader; #securityWriter; #securityFileWriter; #hookReader; #queueReader; #appReader; #switchTransport; #permissionsChecker; #environment; #adoptionWriter; #plainTextInstaller; #firstSweep;

  // `ask(question)` resolves to the typed line; `interactive` says whether a person is at a
  // terminal. `registryOptions` ({ registryPath, testOnly: true }), `rulesetReader`,
  // `rulesetCreator`, `stateRulesetCreator`, `protectionReader`, `protectionWriter`, `securityReader`, `securityWriter` and
  // `securityFileWriter` are only for tests, as are `discoveryGh` (discovery's GitHub reader) and
  // `refresh` (the merged-binding refresh `status` runs first), `hookReader` (the Hooks: lines) and
  // `queueReader` (the offline queue count for a repository root) and `appReader` (the governance App
  // presence reads) and `cloudWorkflows` (the cloud sweep copy render a yes proposal carries).
  // `permissionsChecker` (root => { checked, missing }) and `environment` (the host session id the bank
  // ticket is bound to) are for tests too, as is `firstSweep` (the finish's first-install sweep).
  constructor({ stdout = process.stdout, stderr = process.stderr, ask = terminalAsk, confirm = null, interactive = isInteractiveTerminal(), cwd = process.cwd(), registryOptions = {}, discoveryGh = null, refresh = null, rulesetReader = null, rulesetCreator = null, stateRulesetCreator = null, protectionReader = null, protectionWriter = null, securityReader = null, securityWriter = null, securityFileWriter = null, hookReader = null, queueReader = null, proposalTransport = null, appReader = null , cloudWorkflows = null, switchTransport = null, permissionsChecker = null, environment = process.env, adoptionWriter = null, plainTextInstaller = null, firstSweep = null } = {}) {
    const pulls = proposalTransport || (registryOptions.testOnly || process.env.TOOLKIT_GOVERNANCE_OFFLINE === '1' ? null : new GitHubProposalTransport());
    this.#proposals = new GovernanceProposals({ registryOptions, ...(cloudWorkflows ? { cloudWorkflows } : {}), transport: pulls });
    // The turn-on pull request's outcome, read before a post-merge finish (offline and in tests: unread).
    this.#pullOutcome = pulls && typeof pulls.outcome === 'function' ? (repository, number) => pulls.outcome(repository, number) : null;
    // Whether the open governance pull requests can be read again (a test passes its own transport).
    this.#proposalsLive = Boolean(proposalTransport) || !(registryOptions.testOnly || process.env.TOOLKIT_GOVERNANCE_OFFLINE === '1');
    this.#stdout = stdout;
    this.#stderr = stderr;
    this.#ask = ask;
    // `confirm(effect)` resolves true only on the owner's fresh Enter (owner-terminal.cjs).
    this.#confirm = confirm || (effect => ownerTerminal.pressEnter(effect, { environment }));
    this.#interactive = interactive === true;
    this.#cwd = cwd;
    this.#registryOptions = registryOptions;
    this.#discoveryGh = discoveryGh;
    this.#refresh = refresh || ((cwd, budget) => governance.refreshMergedBinding(cwd, registryOptions, budget));
    this.#rulesetReader = rulesetReader;
    this.#rulesetCreator = rulesetCreator;
    this.#stateRulesetCreator = stateRulesetCreator;
    this.#protectionReader = protectionReader;
    this.#protectionWriter = protectionWriter;
    this.#securityReader = securityReader;
    this.#securityWriter = securityWriter;
    this.#securityFileWriter = securityFileWriter;
    this.#firstSweep = firstSweep;
    this.#hookReader = hookReader || (() => hookCapability.hookCapability());
    this.#appReader = appReader;
    this.#switchTransport = switchTransport || (registryOptions.testOnly || process.env.TOOLKIT_GOVERNANCE_OFFLINE === '1' ? null : new GitHubProposalTransport());
    this.#permissionsChecker = permissionsChecker || (root => require('./toolkit-permissions-cli.cjs').permissionsWithReview(root));
    this.#environment = environment || {};
    this.#adoptionWriter = adoptionWriter || (registryOptions.testOnly || process.env.TOOLKIT_GOVERNANCE_OFFLINE === '1' ? null : new adopt.GitHubAdoptionWriter());
    this.#plainTextInstaller = plainTextInstaller;
    this.#queueReader = queueReader || (root => require('../../skills/github-program-reconciler/scripts/programme-checkpoint.cjs').queueSummary(root));
  }

  async main(argv) {
    const args = [...argv];
    const json = args.includes('--json');
    const offline = args.includes('--offline');
    let rest = args.filter(arg => arg !== '--json' && arg !== '--offline');
    let requestedRun = null;
    let answers = null;
    let ticket = null;
    let explain = null;
    // `setup --answers "explain 1.4"` with no ticket: the full text of one row, read-only.
    if (['setup', 'refresh'].includes(rest[0]) && rest.length === 3 && rest[1] === '--answers') {
      explain = governanceBank.explainParts(rest[2]);
      if (!explain || json) { this.#stderr.write(USAGE); return 2; }
      rest = [rest[0]];
    }
    if (['setup', 'refresh'].includes(rest[0]) && rest.length === 5 && rest[1] === '--answers' && rest[3] === '--ticket') {
      answers = String(rest[2]);
      ticket = String(rest[4]);
      if (!/^[a-f0-9]{32}$/.test(ticket) || json) { this.#stderr.write(USAGE); return 2; }
      rest = [rest[0]];
    }
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
        stdout: this.#stdout, confirm: this.#confirm, interactive: this.#interactive, registryOptions: this.#registryOptions,
        rulesetReader: this.#rulesetReader, rulesetCreator: this.#rulesetCreator, stateRulesetCreator: this.#stateRulesetCreator,
        protectionReader: this.#protectionReader, protectionWriter: this.#protectionWriter,
        securityReader: this.#securityReader, securityWriter: this.#securityWriter, securityFileWriter: this.#securityFileWriter,
      }).run(roots.length ? roots : [this.#cwd]);
      if (command === 'status') return this.#status(json);
      if (command === 'discover') return this.#discover(json);
      if (command === 'check') return this.#check(json, offline);
      if (command === 'security') return this.#security(json);
      if (command === 'finish') return await this.#finish(json);
      if (command === 'publish') return this.#publishPending(json, requestedRun);
      if (command === 'setup' || command === 'refresh') {
        const code = await this.#bank(json, answers, ticket, explain);
        // Every output that follows an answer or an explain ends with the one Agents line (the bank's own has its own).
        if (answers !== null || explain) this.#stdout.write(`\n${governanceBank.agentsAfterAnswer()}\n`);
        return code;
      }
      return await this.#decide(command, json);
    } catch (error) {
      const [text, code] = PROPOSAL_ERRORS[error.code] ? [PROPOSAL_ERRORS[error.code], 2]
        : error.code === 'PROPOSAL_ADOPTION_INCOMPLETE' ? [ADOPTION_NOT_READY, 2]
          : error instanceof GovernanceCliError ? [error.message, error.exitCode]
            : [`Toolkit governance stopped because of an unexpected problem (${error?.name || 'Error'}${error?.code ? ` ${error.code}` : ''}). The operation did not finish or could not be verified. Read back its result before retrying.`, 2];
      this.#stderr.write(`${text}\n${answers !== null || explain ? `\n${governanceBank.agentsAfterAnswer()}\n` : ''}`);
      return code;
    }
  }

  #state() { return governance.governanceState(this.#cwd, this.#registryOptions); }

  #print(json, value, lines) {
    this.#stdout.write(json ? `${JSON.stringify(value, null, 2)}\n` : `${lines.join('\n')}\n`);
  }

  #status(json) {
    let refresh = this.#refresh(this.#cwd) || {};
    // Each git call of the read gets GIT_TIMEOUT_MS, and the fetch of a large default branch can come
    // close to it on a busy computer: a read that ran out of time is read once more with the bank's
    // longer budget, so one slow fetch does not hold every programme command for a day.
    if (refresh.refreshed === false && refresh.error === 'read-timed-out') refresh = this.#refresh(this.#cwd, { timeout: BANK_REREAD_TIMEOUT_MS }) || {};
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
    const task = state.state === 'ENABLED' && state.root ? this.#taskSwitch(state.root) : null;
    if (task) lines.push(...task.lines);
    // A chat the session-start hook did not reach (hooks off or untrusted, a helper, a host without
    // hooks) has no other pointer to the governed rules than this line.
    const governedRules = state.state === 'ENABLED' ? managedToolkitFile('repo/contracts/agent-rules/toolkit-governed-rules.md') : null;
    if (governedRules) lines.push(`Governed rules: ${governedRules}. Each new chat gets them from the session-start hook; where no hook ran, read this file.`);
    let hooks = null;
    try { hooks = this.#hookReader(); } catch { hooks = null; }
    if (hooks) lines.push(...hookCapability.describeHooks(hooks));
    else lines.push('Hooks: could not be checked on this computer.');
    let queue = null;
    try { queue = state.root ? this.#queueReader(state.root) : null; } catch { queue = null; }
    if (queue && queue.count > 0) lines.push(`Queue: ${queue.count} turn${queue.count === 1 ? '' : 's'} waiting (oldest ${String(queue.oldest).slice(0, 10)}); they are written at the next turn end that can reach GitHub, and dropped unwritten after seven days.`);
    const extra = { ...(governedRules ? { governed_rules: governedRules } : {}), ...(task ? { task_auto_merge: task.value } : {}), ...(pending ? { pending } : {}), ...(reason ? { refresh: { refreshed: false, reason: refresh.error } } : {}), ...(hooks ? { hooks: hooks.hosts } : {}), ...(queue ? { queue } : {}) };
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
    if (result.next_step) lines.push(`Next step: ${result.next_step}`);
    if (result.no_force_push_ruleset) lines.push(`No-force-push ruleset: ${result.no_force_push_ruleset.status}`);
    if (result.default_branch_protection) lines.push(`Default-branch protection: ${result.default_branch_protection.status}`);
    if (result.dependency_security) lines.push(`Dependency and security settings: ${result.dependency_security.status}`);
    if (result.cloud_jobs) {
      lines.push(...require('./toolkit-cloud-jobs.cjs').guideLines(result.cloud_jobs));
    }
    lines.push('Governance question hook:');
    for (const [host, status] of Object.entries(result.enforcement)) lines.push(`- ${host}: ${status.status} (${status.reason})`);
    this.#print(json, result, lines);
    return result.exit_code;
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

  // The post-merge finish of a bank turn-on (toolkit-governance-finish.cjs). It acts only on a
  // repository the bank noted as finish pending, once its enabled binding is merged and read back;
  // otherwise it changes nothing.
  async #finish(json) {
    const state = this.#state();
    const entry = state.repository_id ? finishing.entryFor(this.#registryOptions, state.repository_id) : null;
    if (!entry || entry.status !== 'pending') {
      this.#print(json, { result: 'nothing' }, ['Nothing to finish here: no governance turn-on from the question bank is waiting for its post-merge setup.']);
      return 0;
    }
    // A mark whose turn-on pull request closed without merging is cleared, never finished: governance
    // turned on some other way did not come from that yes.
    if (Number.isInteger(entry.proposal) && state.repository && this.#pullOutcome) {
      let outcome = null;
      try { outcome = this.#pullOutcome(state.repository, entry.proposal); } catch { outcome = null; }
      if (outcome === 'closed') {
        finishing.clear(this.#registryOptions, state.repository_id);
        this.#print(json, { result: 'cleared' }, [`Nothing finished: the governance turn-on pull request #${entry.proposal} was closed without merging, so its post-merge setup was dropped. Run ${CMD('check')} to see this repository's settings.`]);
        return 0;
      }
    }
    const lock = finishing.claim(this.#registryOptions, state.repository_id);
    if (!lock) {
      finishing.touch(this.#registryOptions, state.repository_id);
      this.#print(json, { result: 'running' }, ['Another governance setup run is already working here. Nothing more was started.']);
      return 0;
    }
    try { return await this.#finishLocked(json, state); } finally { lock.release(); }
  }

  async #finishLocked(json, state) {
    let said = '';
    const out = { write: text => { said += text; return true; } };
    const outcome = await new GovernanceMaintenance({
      stdout: out, confirm: async () => false, interactive: true, registryOptions: this.#registryOptions,
      rulesetReader: this.#rulesetReader, rulesetCreator: this.#rulesetCreator, stateRulesetCreator: this.#stateRulesetCreator,
      protectionReader: this.#protectionReader, protectionWriter: this.#protectionWriter,
      securityReader: this.#securityReader, securityWriter: this.#securityWriter, securityFileWriter: this.#securityFileWriter,
      firstSweep: this.#firstSweep || (this.#registryOptions.testOnly === true || process.env.TOOLKIT_GOVERNANCE_OFFLINE === '1' ? null : new FirstInstallSweep()),
    }).finish(state.root || this.#cwd, { sweep: finishing.entryFor(this.#registryOptions, state.repository_id)?.first_sweep === true });
    const lines = said.split('\n').map(line => line.trim()).filter(Boolean);
    if (outcome.result === 'not-ready') {
      finishing.touch(this.#registryOptions, state.repository_id);
      this.#print(json, { result: 'not-ready' }, ['Not finished yet: the turn-on pull request is not merged and read back here. Nothing was changed; the next session tries again.']);
      return 0;
    }
    const recorded = finishing.record(this.#registryOptions, state.repository_id, outcome);
    this.#print(json, { result: outcome.result, on: outcome.on, unavailable: outcome.unavailable, held: outcome.held }, [...lines, recorded?.line || '', ...(recorded?.notes || [])]);
    return outcome.result === 'done' ? 0 : 2;
  }

  // `publish`: an agent publishes the answer the owner's card or message recorded, for the run named or
  // for this session. It records nothing itself. A recorded no goes the one off route.
  #publishPending(json, requestedRun) {
    const sessionId = this.#hostSession();
    const pending = this.#proposals.pending(this.#cwd, { sessionId, epoch: new gate.SessionEpochs({ registryOptions: this.#registryOptions }).get(sessionId) });
    const run = requestedRun || (pending?.kind === 'preparing' ? pending.run : null);
    if (!run) throw new GovernanceCliError(pending?.text || 'No pending owner answer for this run. Ask the owner in this chat; an agent cannot answer for them.');
    return this.#proposals.answerFor(this.#cwd, run) === 'no' ? this.#turnOff(json, run) : this.#publish(json, run);
  }

  // Publication uses only a live receipt from an accepted owner answer.
  // `switches` are the task_prs members the owner's answer sets ({ auto_merge, merge_train }), or null.
  // `bank` is true only when the governance question bank publishes its own answer: a yes from anywhere
  // else (an agent's publish --run) is refused, so no turn-on pull request is ever built by hand.
  // `app` is the bank's governance App answer ('setup' or 'keep'), or null outside the bank.
  #publish(json, run, switches = null, adopted = null, bank = false, app = null) {
    if (!bank && this.#proposals.answerFor(this.#cwd, run) === 'yes') throw new GovernanceCliError(`${BANK_ONLY} Run ${CMD('setup')} and show the owner its bank; build nothing by hand. Nothing was written.`);
    let binding = adopted ? adopted.binding : null;
    if (!adopted) try { binding = JSON.parse(fs.readFileSync(path.join(this.#cwd, governance.BINDING_FILE), 'utf8')); } catch { /* prepare explains missing adoption */ }
    // setup governance asks the switch with yes; it joins the same proposal, never a local file.
    if (switches && binding && typeof binding === 'object') binding = { ...binding, task_prs: { ...(binding.task_prs || {}), ...switches } };
    const result = this.#proposals.publish(this.#cwd, run, binding, bank, bank ? this.#rendered : null);
    // A bank turn-on is finished after its merge: protection, rulesets and security settings.
    if (bank && result.proposal?.answer === 'yes') {
      try { finishing.markPending(this.#registryOptions, this.#state().repository_id, { proposal: result.proposal.number, firstSweep: result.added ? result.added.includes('personal-data-guard') : null }); } catch { /* the owner can run migrate */ }
    }
    const turnOn = bank && result.proposal?.answer === 'yes';
    if (turnOn) this.#turnOnUrl = result.proposal.url;
    this.#print(json, result, [...(turnOn ? turnOnSummary(result, binding, this.#storeNote) : [result.text]), ...(result.warning ? [result.warning] : []), ...(switches ? [governance.taskSwitchVersionLine()] : []), ...this.#appLines(result.proposal, binding, app)]);
    return 0;
  }

  // How the governance App's variable and secret are read.
  #appRead() {
    return { reader: this.#appReader || governanceApp.ghReader,
      offline: !this.#appReader && (this.#registryOptions.testOnly === true || process.env.TOOLKIT_GOVERNANCE_OFFLINE === '1') };
  }

  // The governance App steps that follow a published decision: setup for yes, removal for no. A yes
  // from the bank already covered the App: its status row said what is set, and the owner's setup
  // command follows the bank's other steps when it is needed, so nothing more is said here.
  #appLines(proposal, binding, app = null) {
    if (proposal.answer === 'yes' && (app === 'setup' || app === 'keep')) return [];
    const slug = proposal.repository;
    const read = this.#appRead();
    const state = governanceApp.presence(slug, read);
    if (proposal.answer === 'yes') return governanceApp.setupLines(slug, binding?.store?.repository || null, state);
    const others = governance.enabledRepositories(this.#registryOptions).filter(name => name.toLowerCase() !== slug.toLowerCase());
    return governanceApp.removalLines(slug, state, others);
  }

  // The repository's task auto-merge switch, as merged and read back on this computer. Once it is
  // read back, the old per-app answers of earlier Toolkit versions are removed (never before).
  #taskSwitch(root) {
    const answer = governance.taskAutoMerge(root, this.#registryOptions);
    if (!answer.fresh) return { value: 'off', answer, removed: [], lines: ['Task auto-merge: off until the merged binding is read again online.'] };
    const removed = governance.retireLegacyTaskAnswers(root, this.#registryOptions);
    const lines = [answer.answered ? `Task auto-merge: ${answer.auto_merge === 'after-gates' ? 'on (finished task pull requests merge once their gates pass)' : 'off (every pull request waits for a typed merge)'}.` : governance.TASK_SWITCH_UPGRADE_LINE];
    if (removed.length) lines.push(`Removed the old per-app task auto-merge answers on this computer (${removed.join(', ')}); the repository's switch replaces them.`);
    return { value: answer.answered ? answer.auto_merge : 'unset', answer, removed, lines };
  }

  // One binding pull request that changes only the named task_prs members ({ auto_merge,
  // merge_train }), built from the exact merged text.
  #prepareSwitch(root, changes) {
    if (!this.#switchTransport) throw new GovernanceCliError('GitHub cannot be reached from here, so no pull request was prepared. Nothing was written.');
    const identity = governance.readIdentity(root);
    const entry = bindingCache.readBindingCache(identity, governance.userStateDirectory(this.#registryOptions));
    let parsed;
    try { parsed = JSON.parse(String(entry?.text).replace(/^\uFEFF/, '')); } catch { parsed = null; }
    if (!parsed || parsed.schema !== 'toolkit.programme-binding.v2' || parsed.governance !== 'enabled') throw new GovernanceCliError('The merged binding is not an enabled version 2 binding, so the switch cannot be set yet. Nothing was written.');
    const kept = withoutRetired(entry.text, parsed);
    const proposal = { ...kept.binding, task_prs: { ...(kept.binding.task_prs || {}), ...changes } };
    if (governance.bindingProblems(proposal, identity).length) throw new GovernanceCliError('The changed binding would not be valid, so no pull request was prepared. Nothing was written.');
    try {
      return this.#switchTransport.publishSwitch(proposal.repository, entry.text, switchText(kept.text, kept.binding, changes), changes);
    } catch (error) {
      throw new GovernanceCliError(error.code === 'SWITCH_BASE_CHANGED'
        ? `The binding on the default branch changed since this computer read it. Run ${CMD('status')}, then ask again. Nothing was written.`
        : `The switch pull request could not be prepared (${error.code || 'unavailable'}). Check GitHub access and open pull requests before retrying.`);
    }
  }

  // `toolkit governance` (`setup governance`, `refresh governance`): the question bank, in the same
  // format as setup toolkit. Shown, it notes the bank for this run so the owner's next own message
  // gets a one-use ticket (toolkit-governance-bank.cjs), and exits BANK_SHOWN. With --answers and that
  // ticket it applies the owner's answer: at most one governance pull request, and the permission
  // blocks. In the owner's own terminal it shows the bank and reads the reply there. `explain` (a row
  // number and the bank reference it names, explainParts) prints that row's full text of the bank the
  // owner was shown and nothing else: no ticket, no note, no write (#explainShown).
  async #bank(json, answers, ticket, explain = null) {
    let refreshed = this.#refresh(this.#cwd) || {};
    let state = this.#state();
    // Not read: an enabled binding read too long ago, or no read at all (UNAVAILABLE), where the bank
    // cannot know whether governance is decided. One failed read is often a moment's network or git
    // trouble: read once more.
    const unread = read => read.state === 'UNAVAILABLE' || (read.state === 'ENABLED' && !read.programme_records_bind);
    if (unread(state)) {
      refreshed = this.#refresh(this.#cwd, { timeout: BANK_REREAD_TIMEOUT_MS }) || {};
      state = this.#state();
    }
    if (state.rule === 'ERROR' || state.state === 'ERROR') throw new GovernanceCliError(`The governance state could not be read (${state.error_code || 'ERROR'}). Nothing was written.`);
    if (['R1', 'R8', 'S1', 'R1s'].includes(state.rule)) {
      this.#print(json, { state: state.state, writes: 0 }, ['GitHub governance is off automatically here; there is nothing to set up.', ...describe(state).slice(2)]);
      return 0;
    }
    // Still unread: no bank and no governed write from an old read. The bank's own line asks the owner
    // to type it again; an answer is refused with nothing written (main adds its Agents line).
    if (unread(state)) {
      const cause = refreshed.refreshed === false ? refreshed.error : null;
      this.#print(json, { state: state.state, writes: 0 }, explain || (answers !== null && governanceBank.explainRequest(answers)) ? [EXPLAIN_UNREAD] : answers === null ? [bankUnreadLine(cause), '', BANK_UNREAD_AGENTS] : [ANSWER_UNREAD]);
      return 1;
    }
    // The open governance pull requests are read again first, so one closed outside Toolkit no longer
    // reads as pending (it would hold the turn-on with a misleading "not ready" line).
    if (state.state === 'UNDECIDED' && this.#proposalsLive) this.#proposals.refresh(this.#cwd);
    // Every row that shows what the merged binding sets comes from this one read: other sessions
    // refresh the same cache, and a read of theirs that fails marks it stale between two reads of ours
    // (that once showed merge trains Off for a binding that has them on). The bank says when it is stale.
    const read = state.state === 'ENABLED' && state.root ? governance.mergedBindingRead(state.root, this.#registryOptions) : null;
    const merged = read ? read.binding : null;
    const switches = governance.mergedSwitches(merged);
    // #taskSwitch also retires the old per-app answers once the switch reads back fresh.
    const task = read ? { ...this.#taskSwitch(state.root), value: merged ? switches.task : 'off' } : null;
    let permissions = { checked: false, missing: 0 };
    try { permissions = this.#permissionsChecker(state.root) || permissions; } catch { /* shown as not checked */ }
    // A repository that is not on and not prepared: what turning on would make (store, parent, checks).
    let found = null;
    if (state.state !== 'ENABLED' && state.root && !adopt.adoptionPrepared(state.root)) {
      try { found = this.#discovery().discover(this.#cwd); } catch { found = { status: 'unavailable', reason: 'the search failed' }; }
    }
    const adoption = found ? adopt.adoptionPlan(found) : null;
    // The App row reads its variable and secret wherever governance is on or can be turned on (again) here.
    const app = state.repository ? governanceApp.presence(state.repository, this.#appRead()) : null;
    const copies = state.state === 'ENABLED' && state.root ? this.#cleanup(state.root, false) : null;
    // The store, read as the App is; where GitHub could not answer, its last background check. Both
    // reads GitHub answered are saved (toolkit-governance-parts.cjs), so a part the owner fixed and sees
    // here as ready no longer gets its session-start line.
    const storeCheck = merged?.store?.repository ? this.#storeCheck(state, merged.store.repository, app) : null;
    const specs = governanceBank.governanceBankSpecs({ state, task: task ? task.value : 'unset', train: switches.train, merged, mergedRead: read, permissions, adoption, app, copies: copiesRow(copies), storeCheck });
    const reference = governanceBank.bankReference(specs);
    if (explain) {
      this.#print(false, {}, this.#explainShown(state, specs, reference, explain));
      return 0;
    }
    if (answers === null) {
      if (json) { this.#print(true, { state: state.state, bank_reference: reference, questions: specs }, []); return BANK_SHOWN; }
      const refused = this.#interactive ? this.#agentShell() : null;
      // An agent's shell is never the owner's terminal, whatever terminal it has: the bank is shown as in
      // any chat, and only the owner's own message can answer it.
      if (refused) this.#stderr.write(`Toolkit: no answer is read in this terminal, because ${refused.stopped}\n`);
      else if (this.#interactive) {
        // In the owner's own terminal: the bank once, then a reply that cannot be used gets one line
        // and the question again, up to TERMINAL_TRIES replies; an empty reply ends it.
        this.#stdout.write(`${governanceBank.renderGovernanceBank(specs)}\n`);
        for (let tries = 1; ; tries += 1) {
          const reply = tries > TERMINAL_TRIES ? '' : String(await this.#ask('Your answer: ')).trim();
          if (!reply) { this.#print(false, {}, ['Nothing was written.']); return 1; }
          const explain = governanceBank.explainRequest(reply);
          if (explain) { this.#print(false, {}, [governanceBank.explainText(specs, explain) || `This bank has no row ${explain}.`, '']); continue; }
          let chosen;
          try { chosen = governanceBank.parseBankAnswer(reply, specs, { requireBankReference: false }); }
          catch (error) { this.#print(false, {}, [`${error.message} Nothing was written. ${governanceBank.REPLY_AGAIN}`]); continue; }
          const code = this.#applyBank(state, task, chosen, found, permissions);
          return code;
        }
      }
      return this.#showBank(specs, state);
    }
    if (this.#cloud()) throw new GovernanceCliError(`${CLOUD_BANK} Nothing was written.`);
    const sessionId = this.#hostSession();
    const epochs = new gate.SessionEpochs({ registryOptions: this.#registryOptions });
    const epoch = sessionId ? epochs.get(sessionId) : null;
    let entry = null;
    try { entry = sessionId ? new governanceBank.BankTickets({ registryOptions: this.#registryOptions }).take(ticket, sessionId, epoch) : null; } catch { entry = null; }
    if (!entry || entry.repository_id !== state.repository_id) {
      throw new GovernanceCliError('No live reply ticket from the owner for this session and repository, so nothing was written. The owner can type toolkit governance to see the bank again. An agent cannot answer for the owner.');
    }
    // The bank is shown once: a reply that cannot be used gets a short line, and the same run waits
    // for the owner's next own message (BankTickets.rearm), never a second bank.
    const again = (lines, reply) => this.#again(sessionId, entry, specs, lines, reply);
    if (entry.bank_reference !== reference) {
      const changed = governanceBank.changedRows(entry.rows, specs);
      if (!changed) {
        this.#print(false, {}, ['The governance bank changed since it was shown (rows were added, taken away or numbered differently), so the answer was not used and nothing was written. Type toolkit governance to see the new bank.']);
        return 0;
      }
      return again(['The governance state changed since that bank was shown, so the answer was not used and nothing was written.', ...changed]);
    }
    const row = governanceBank.explainRequest(answers);
    if (row) return again([governanceBank.explainText(specs, row) || `This bank has no row ${row}.`, '']);
    let chosen;
    // The card's plain words count only as the first answer to a bank: after one was used, a yes or a no
    // meant for something else is never read as another answer to it.
    try { chosen = governanceBank.parseBankAnswer(answers, specs, { plainWords: entry.used !== true }); }
    catch (error) {
      // After a used answer, a reply the bank cannot read (a bare ok) is not a lost answer.
      if (entry.used === true && error.code === 'BANK_ANSWER_UNREAD') return again([governanceBank.ANSWER_USED], governanceBank.CHANGE_ANOTHER);
      return again([`${error.message} Nothing was written.`]);
    }
    // The bank stays open after an answer too, so the owner's next own message (another change, or a
    // row that does not exist) gets a new one-use ticket and its own line, never a spent ticket. An
    // answer that did what it said is noted as used, so that next message is never told it was lost.
    let code = null;
    try {
      code = this.#applyBank(state, task, chosen, found, permissions);
      return code;
    } finally {
      try { new governanceBank.BankTickets({ registryOptions: this.#registryOptions }).rearm(sessionId, entry, { bankReference: reference, rows: governanceBank.rowDigests(specs), used: code === 0 }); } catch { /* the owner can type toolkit governance */ }
    }
  }

  // The ticketless "explain 1.4" reads row 1.4 of the bank the owner was shown: the one its command
  // names, else this session's noted bank (read only, never spent). When that bank is not this one, it
  // says what the ticket path says: the rows that changed, then the row, while every number still
  // means the same row; otherwise that the bank changed, so it never prints another row under a
  // number the owner saw.
  #explainShown(state, specs, reference, { reference: named, row }) {
    const text = governanceBank.explainText(specs, row) || `This bank has no row ${row}.`;
    const sessionId = this.#hostSession();
    let noted = null;
    try {
      const epoch = sessionId ? new gate.SessionEpochs({ registryOptions: this.#registryOptions }).get(sessionId) : null;
      noted = sessionId ? new governanceBank.BankTickets({ registryOptions: this.#registryOptions }).pendingFor(sessionId, epoch) : null;
    } catch { noted = null; }
    if (noted && noted.repository_id !== state.repository_id) noted = null;
    const shown = named || noted?.bank_reference || null;
    if (!shown || shown === reference) return [text];
    const changed = noted?.bank_reference === shown ? governanceBank.changedRows(noted.rows, specs) : null;
    if (!changed) return [`The governance bank changed since it was shown (rows were added, taken away or numbered differently), so row ${row} as shown is not explained here and nothing was written. Type toolkit governance to see the new bank.`];
    return ['The governance state changed since that bank was shown; the numbers still mean the same rows.', ...changed, '', text];
  }

  // A reply that could not be used: its lines and the one reply line, and the bank noted again for
  // this run so the owner's next own message answers it.
  #again(sessionId, entry, specs, lines, reply = governanceBank.REPLY_AGAIN) {
    let noted = false;
    try { noted = new governanceBank.BankTickets({ registryOptions: this.#registryOptions }).rearm(sessionId, entry, { bankReference: governanceBank.bankReference(specs), rows: governanceBank.rowDigests(specs) }); } catch { noted = false; }
    this.#print(false, {}, [...lines, noted ? reply : 'Toolkit could not keep this bank open for another reply (its user-state folder could not be written). Type toolkit governance to see it again.']);
    return BANK_SHOWN;
  }

  // How the turn-on answer chose its store, for the turn-on summary.
  #storeNote = null;
  // The turn-on pull request the bank published in this run, for its closing line.
  #turnOnUrl = null;
  // The scratch folder outside the checkout a bank turn-on renders its missing CI files into, for its
  // one pull request; removed when the answer is done. Never the owner's checkout.
  #rendered = null;

  // The cleanup route (toolkit-governance-cleanup.cjs), reading governance the way this command does.
  // A preview writes nothing; it never runs git. The catch is the last resort for a failure the route
  // does not report itself, such as a file it could not write.
  #cleanup(root, write) {
    try {
      return cleanupRoute.run({ root, write, governance: { readIdentity: governance.readIdentity, governanceState: dir => governance.governanceState(dir, this.#registryOptions) } });
    } catch (error) {
      return { ok: false, changes: [], lines: [write
        ? `The instruction copies could not be cleaned up (${error.code || error.message}). Check the working tree with git status before committing anything.`
        : `The instruction copies could not be checked (${error.code || error.message}).`] };
    }
  }

  // A cloud session skips the reply check, so the owner's chat answer there can never be recorded.
  #cloud() { return this.#environment.CLAUDE_CODE_REMOTE === 'true'; }

  #hostSession() {
    const id = this.#environment.TOOLKIT_HOST_SESSION || this.#environment.CODEX_THREAD_ID;
    return typeof id === 'string' && id !== '' ? id : null;
  }

  // Prints the bank and notes it for this run, so the owner's next own message can answer it.
  #showBank(specs, state) {
    if (this.#cloud()) {
      this.#stdout.write(`${governanceBank.renderGovernanceBank(specs)}\n\n${CLOUD_BANK}\n`);
      return BANK_SHOWN;
    }
    const sessionId = this.#hostSession();
    const epochs = new gate.SessionEpochs({ registryOptions: this.#registryOptions });
    const epoch = sessionId ? epochs.get(sessionId) : null;
    let noted = false;
    try {
      noted = Boolean(sessionId) && new governanceBank.BankTickets({ registryOptions: this.#registryOptions }).shown(sessionId, {
        epoch, repositoryMark: epochs.repository(state.repository_id), repositoryId: state.repository_id, root: state.root, bankReference: governanceBank.bankReference(specs), rows: governanceBank.rowDigests(specs),
      });
    } catch { noted = false; }
    this.#stdout.write(`${governanceBank.renderGovernanceBank(specs)}\n`);
    if (!noted) this.#stdout.write(`\nToolkit could not note this bank for this session (its session-start hook did not mark it, or its user-state folder could not be written), so a reply in chat cannot be recorded. Start a new session and say toolkit governance there, or run ${CMD('setup')} in your own terminal.\n`);
    return BANK_SHOWN;
  }

  #storeCheck(state, store, app) {
    const parts = require('./toolkit-governance-parts.cjs');
    const read = this.#appRead();
    let live = null;
    try { live = read.offline ? null : parts.storeState(store, { reader: read.reader }); } catch { live = null; }
    if (state.state === 'ENABLED') {
      try { parts.recordRead(this.#registryOptions, state.repository_id, { app, store: live, storeRepository: store }); } catch { /* not saved: the background check catches up */ }
    }
    return live && live.state !== 'unverified' ? live : parts.savedStore(this.#registryOptions, state.repository_id, store);
  }

  // The owner's answer: at most one governance pull request, then the permission blocks.
  #applyBank(state, task, chosen, found = null, permissions = { checked: false }) {
    let code = 0;
    let acted = false;
    let commanded = 0;
    this.#turnOnUrl = null;
    this.#storeNote = null;
    // No store wanted (or later): governance needs one, so nothing is made and governance stays off.
    if (chosen.noStore) {
      this.#print(false, {}, [chosen.later ? 'Later: nothing was written, and governance stays off. Toolkit asks again next session.'
        : 'Governance needs a store, so it stays off. Nothing was written: no pull request, store or parent issue was made. Toolkit asks again next session.']);
      return 0;
    }
    const switchTo = chosen.taskAutoMerge === 'on' ? 'after-gates' : chosen.taskAutoMerge === 'off' ? 'off' : null;
    // Turning governance on writes both switches: task auto-merge as answered, merge trains off (the
    // bank does not ask about them; a governed repository keeps its stored value).
    const enabling = { auto_merge: switchTo || 'off', merge_train: 'off' };
    const app = chosen.governanceApp === 'setup' ? 'setup' : 'keep';
    let store = state.state === 'ENABLED' ? governance.mergedBinding(state.root, this.#registryOptions)?.store?.repository || null : null;
    if (chosen.governance === 'on' && state.state !== 'ENABLED' && found?.status === 'pending') {
      // A governance pull request is already open: it is the one to merge or close, never a second.
      const open = this.#proposals.pending(this.#cwd)?.proposals || [];
      this.#print(false, {}, [open.length
        ? `A governance pull request is already open, so no second one was prepared: ${open.map(item => `${item.url} (turns governance ${item.answer === 'yes' ? 'on' : 'off'})`).join(', ')}. Merge it, or close it and type toolkit governance to answer again. Nothing was written, and the rest of this answer was not used.`
        : `${String(found.reason).replace(/^Toolkit: /, '')} Nothing was written.`]);
      return open.length ? 0 : 2;
    }
    if (chosen.governance === 'on' && state.state !== 'ENABLED') {
      const plan = found ? adopt.adoptionPlan(found, { store: chosen.store || null }) : null;
      if (chosen.store && !(plan && !plan.blocked)) {
        this.#print(false, {}, [`store=${chosen.store} was not used, because ${plan?.blocked ? `GitHub could not be read (${plan.blocked})` : 'the programme file in the working tree already names the store'}. Nothing was written.`]);
        return 2;
      }
      if (plan && plan.blocked) this.#print(false, {}, [`GitHub could not be read (${plan.blocked}), so the evidence store and parent issue could not be found or made.`]);
      if (plan && !plan.blocked) {
        store = plan.store.repository;
        this.#storeNote = plan.store.named ? 'the one you named' : plan.store.create ? 'created for this repository' : 'found';
      } else if (!found && adopt.adoptionPrepared(state.root)) {
        try { store = JSON.parse(fs.readFileSync(path.join(state.root, governance.BINDING_FILE), 'utf8')).store?.repository || null; } catch { /* no --store */ }
      }
      // A store that cannot be used is refused before anything is written here.
      const problem = plan && !plan.blocked ? adopt.storeProblem(plan) : null;
      if (problem) { this.#adoptStopped(problem, []); return 2; }
      this.#rendered = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-turn-on-'));
      try {
        code = plan && !plan.blocked ? this.#adoptAndPropose(state, plan, enabling, app)
          : !found && adopt.adoptionPrepared(state.root) ? this.#preparedAndPropose(state, enabling, app) : this.#prepareOn(enabling, null, app);
      } finally {
        fs.rmSync(this.#rendered, { recursive: true, force: true });
        this.#rendered = null;
      }
      acted = true;
    } else if (chosen.governance === 'off' && state.state !== 'DISABLED') {
      code = this.#prepareOff();
      acted = true;
    } else if (state.state === 'ENABLED') {
      const changes = {};
      if (switchTo && task && switchTo !== task.value) changes.auto_merge = switchTo;
      const said = changes.auto_merge ? `task auto-merge ${changes.auto_merge === 'after-gates' ? 'on' : 'off'}` : '';
      if (said) {
        const prepared = this.#prepareSwitch(state.root, changes);
        this.#print(false, {}, [`Prepared ${prepared.url}: it sets ${said} and changes nothing else. It applies only after you merge it.`, governance.taskSwitchVersionLine()]);
        acted = true;
      }
    }
    // The instruction copies: Clean up removes them in the working tree and sets min_toolkit; the owner
    // commits them and merges the one pull request. The row is asked only where governance is on.
    if (chosen.instructionCopies === 'clean') {
      const cleaned = state.state === 'ENABLED' ? this.#cleanup(state.root, true) : { ok: false, lines: ['Toolkit instruction copies: not cleaned, because governance is not on here.'] };
      this.#print(false, {}, ['', ...cleaned.lines]);
      if (!cleaned.ok && code === 0) code = 1;
      acted = true;
    }
    if (chosen.permissionBlocks !== 'keep') {
      const command = permissions.checked ? permissions[chosen.permissionBlocks] : null;
      if (command) commanded += 1;
      const app = governanceBank.APP_NAMES[permissions.host] || 'this app';
      // Claude Code's update prints the review list (house format), which ends with the one command.
      const reviewList = chosen.permissionBlocks === 'update' && command && typeof permissions.review === 'string' && permissions.review ? permissions.review : null;
      this.#print(false, {}, reviewList ? ['', ...reviewList.split('\n')] : command
        ? ['', `Toolkit permissions (${app}): run this once in your own PowerShell or terminal, outside any agent. It shows what changes, backs up the settings file and waits for you to press Enter.`, '', ...fenced(command)]
        : ['', 'Toolkit permissions: Toolkit could not read where this app keeps them, so there is no command to give. Run setup toolkit, then toolkit governance again.']);
      acted = true;
    }
    // The governance App command, next to the permissions command; only the owner runs it. It is the
    // Toolkit default while the App is not set up, and is given only when governance is on after this
    // answer; otherwise the answer says nothing about it.
    const governedAfter = chosen.governance === 'on' || (state.state === 'ENABLED' && chosen.governance !== 'off');
    if (chosen.governanceApp === 'setup' && governedAfter && code === 0 && state.repository) {
      this.#print(false, {}, ['', `Governance App: paste this one line into PowerShell and press Enter. It saves the App's Client ID and key on ${state.repository}. ${governanceApp.SETUP_STEPS}`, '',
        ...fenced(governanceApp.setupCommand(state.repository, store))]);
      acted = true;
      commanded += 1;
    }
    if (!acted) this.#print(false, {}, ['Nothing changed: every answer keeps things as they are.']);
    // The one closing line of a bank turn-on: merging is the owner's only step left.
    if (this.#turnOnUrl && code === 0) {
      this.#print(false, {}, ['', `${commanded ? `Run the command${commanded > 1 ? 's' : ''} above, then merge` : 'Merge'} ${this.#turnOnUrl}. Nothing else is needed from you.`]);
    }
    this.#turnOnUrl = null;
    return code;
  }

  // A fresh repository: make the store and parent issue that are missing, add the CI checks, then the
  // one turn-on pull request (toolkit-governance-adopt.cjs).
  #adoptAndPropose(state, plan, switches, app = null) {
    if (!this.#adoptionWriter) {
      this.#print(false, {}, ['GitHub cannot be written from here, so nothing was made. Run toolkit governance again where gh is signed in.']);
      return 2;
    }
    let adopted;
    try {
      adopted = adopt.adopt({ root: state.root, into: this.#rendered, plan, writer: this.#adoptionWriter, switches, ...(this.#plainTextInstaller ? { plainText: into => this.#plainTextInstaller(state.root, into) } : {}) });
    } catch (error) {
      if (!(error instanceof adopt.AdoptError)) throw error;
      this.#adoptStopped(error.message, error.made);
      return 2;
    }
    const lines = [...adopted.lines];
    if (adopted.made.length) lines.push(`Made on GitHub: ${adopted.made.join(', ')}.`);
    if (lines.length) this.#print(false, {}, lines);
    return this.#prepareOn(switches, adopted, app);
  }

  // Why the turn-on stopped, what it already made and how to answer again.
  #adoptStopped(message, made) {
    this.#print(false, {}, [`${message} No pull request was prepared.`,
      made.length ? `Already made, and reused when you answer again: ${made.join(', ')}.` : 'Nothing was made on GitHub.',
      'Once the cause is fixed, type toolkit governance and answer again.']);
  }

  // A repository whose programme file is prepared in the working tree: the same CI checks as a fresh
  // one, then the one turn-on pull request.
  #preparedAndPropose(state, switches, app = null) {
    let ready;
    try {
      ready = adopt.prepared({ root: state.root, into: this.#rendered, ...(this.#plainTextInstaller ? { plainText: into => this.#plainTextInstaller(state.root, into) } : {}) });
    } catch (error) {
      if (!(error instanceof adopt.AdoptError)) throw error;
      this.#print(false, {}, [`${error.message} No pull request was prepared.`]);
      return 2;
    }
    if (ready.lines.length) this.#print(false, {}, ready.lines);
    return this.#prepareOn(switches, ready, app);
  }

  // The turn-on pull request from the owner's bank answer (the ticket or the owner's own terminal is the
  // proof); it applies only after the owner merges it. `adopted` carries the binding for a fresh repository.
  #prepareOn(switches, adopted = null, app = null) {
    const before = this.#state();
    if (before.merged?.fresh && before.rule === 'M1') {
      this.#print(false, {}, ['Already ' + before.state.toLowerCase() + ' on the default branch. Nothing was written.']);
      return 0;
    }
    const sessionId = 'bank-' + crypto.randomBytes(16).toString('hex'), epoch = crypto.randomBytes(16).toString('hex');
    const request = this.#proposals.request(this.#cwd, 'yes', { sessionId, epoch });
    try { return this.#publish(false, request.run, switches, adopted, true, app); }
    catch (error) {
      this.#print(false, {}, [publishError(error)]);
      return 2;
    }
  }

  // The owner's no from the bank or their own terminal: recorded for one run of its own, then the one off
  // route. Governance already off on the default branch is said once, with nothing written; `heading` says
  // on stderr what is about to be turned off, only where something is.
  #prepareOff({ json = false, failures = this.#stdout, heading = '' } = {}) {
    const before = this.#state();
    if (before.merged?.fresh && before.rule === 'M2') {
      this.#print(json, { state: before.state, writes: 0 }, ['Already ' + before.state.toLowerCase() + ' on the default branch. Nothing was written.']);
      return 0;
    }
    if (heading) this.#stderr.write(`${heading}\n`);
    const sessionId = 'owner-' + crypto.randomBytes(16).toString('hex'), epoch = crypto.randomBytes(16).toString('hex');
    return this.#turnOff(json, this.#proposals.request(this.#cwd, 'no', { sessionId, epoch }).run, failures);
  }

  // The one route that turns governance off: the bank's Turn off, the owner's own terminal and the
  // card's No (its agent runs publish) all publish the owner's no through here, so each makes the same
  // one off pull request, says the same, and fails the same way. A failure is an error line on stderr, as
  // every other command's, but the bank's goes with its other lines on stdout, before its Agents line; an
  // unexpected error keeps its name (main).
  #turnOff(json, run, failures = this.#stderr) {
    try { return this.#publish(json, run); }
    catch (error) {
      if (!publishStopped(error)) throw error;
      // Only where GitHub could not be read or written is the same recorded no published later as it is.
      const retry = !PROPOSAL_ERRORS[error.code];
      const lines = [publishError(error), ...(retry ? [`The owner's no stays pending for this run: once GitHub can be read, run ${CMD(`publish --run ${run}`)} to publish it.`] : [])];
      if (json) this.#print(true, { pending: retry, run, error: error.code }, lines);
      else failures.write(`${lines.join('\n')}\n`);
      return 2;
    }
  }

  // Why an answer typed here would not be the owner's: a coding agent started this shell (the marker is
  // named), or null. Every terminal route that takes the owner's answer asks it first (#decide, #bank);
  // migrate's Enter reads only owner-terminal.cjs's own list, which has no mark of a Terminal panel tab
  // (agent-shell-markers.cjs says why an agent still cannot answer it there).
  #agentShell() {
    return ownerTerminal.refusal({ environment: this.#environment, tty: { stdin: true, stdout: true }, markers: AGENT_SHELL_MARKERS });
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
    const refused = this.#agentShell();
    if (refused) throw new GovernanceCliError(`No answer was recorded: ${refused.stopped} Next: ${refused.next}`);
    // Yes in the owner's own terminal opens the full governance question bank there, the one route
    // that turns governance on.
    if (command === 'enable') return this.#bank(json, null, null);
    // No in the owner's own terminal is the answer itself, as the card's No is: no second Enter, and the
    // same off pull request through the same route (#turnOff).
    const heading = ownerTerminal.facts([['Turns off', 'repository governance, on every computer'], ['Applies', 'only after the owner merges the pull request']]);
    return this.#prepareOff({ json, failures: this.#stderr, heading });
  }
}

// The merged binding (text and parsed) without its retired keys, in its own layout, so a switch pull
// request drops a carried key in the same diff and changes nothing else.
function withoutRetired(mergedText, parsed) {
  return { text: withoutRetiredKeysText(mergedText), binding: withoutRetiredKeys(parsed) };
}

// The merged binding text with only the switches changed, so the owner's diff shows only that: each
// existing value is replaced in place, or a task_prs member goes before the top-level closing brace.
// The result must parse to the merged binding plus the switches; anything else is rendered whole.
function switchText(mergedText, parsed, changes) {
  const text = String(mergedText).replace(/^\uFEFF/, '');
  const expected = { ...parsed, task_prs: { ...(parsed.task_prs || {}), ...changes } };
  const matches = (candidate) => { try { return util.isDeepStrictEqual(JSON.parse(candidate), expected); } catch { return false; } };
  let edited = null;
  if (parsed.task_prs !== undefined) {
    edited = text;
    for (const [name, value] of Object.entries(changes)) {
      const pattern = new RegExp(`("${name}"\\s*:\\s*)"[^"]*"`, 'g');
      const found = (text.match(pattern) || []).length;
      if (found === 1) { edited = edited.replace(pattern, `$1"${value}"`); continue; }
      // A switch task_prs does not hold yet goes in at the end of its (flat) object, in its layout.
      const open = /"task_prs"\s*:\s*\{([^{}]*)\}/g;
      const objects = [...edited.matchAll(open)];
      if (found !== 0 || Object.hasOwn(parsed.task_prs || {}, name) || objects.length !== 1) { edited = null; break; }
      const inner = objects[0][1];
      const trimmed = inner.replace(/\s+$/, '');
      const line = /(\r?\n)([ \t]+)"/.exec(inner);
      const member = line ? `,${line[1]}${line[2]}"${name}": "${value}"` : `${trimmed.trim() ? ',' : ''} "${name}": "${value}"`;
      const start = objects[0].index + objects[0][0].length - 1 - inner.length;
      edited = `${edited.slice(0, start)}${trimmed}${member}${inner.slice(trimmed.length)}${edited.slice(start + inner.length)}`;
    }
  } else {
    const close = text.lastIndexOf('}');
    const body = text.slice(0, close).replace(/\s+$/, '');
    const newline = text.includes('\r\n') ? '\r\n' : '\n';
    const indent = /\n([ \t]+)"/.exec(body)?.[1];
    const members = (colon) => Object.entries(changes).map(([name, value]) => `"${name}"${colon}"${value}"`).join(colon === ':' ? ',' : ', ');
    if (close > 0 && body.length && !body.endsWith('{')) edited = indent === undefined
      ? `${body},"task_prs":{${members(':')}}${text.slice(body.length)}`
      : `${body},${newline}${indent}"task_prs": { ${members(': ')} }${text.slice(body.length)}`;
  }
  return edited !== null && matches(edited) ? edited : `${JSON.stringify(expected, null, 2)}\n`;
}

// The bank's view of a cleanup preview: the files it would remove, why the pinned sweep copies hold
// it, or why the programme file stops it; null when there is nothing to say.
function copiesRow(copies) {
  if (!copies) return null;
  if (copies.ok) return { files: copies.changes.filter(change => change.action !== 'set-min-toolkit').length };
  if (copies.held) return { files: copies.files, held: copies.held, step: copies.step };
  if (copies.refused) return { files: copies.files, refused: copies.refused };
  return null;
}

// The owner's governance App setup command (it refuses under an agent).
// A command for the owner to run, in Toolkit's own PowerShell block: the app shows it as typed (straight
// quotes, never curly ones) with a copy button, and a Run button where it offers one.
const fenced = command => ['```powershell', command, '```'];

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

module.exports = Object.freeze({ ToolkitGovernanceCli, COMMANDS, BANK_SHOWN });
