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
const guided = require('./toolkit-governance-guided.cjs');
const { GuidedAnswerError } = guided;
const summary = require('./toolkit-governance-summary.cjs');
const cleanupRoute = require('./toolkit-governance-cleanup.cjs');
const adopt = require('./toolkit-governance-adopt.cjs');
const ciOffer = require('./toolkit-ci-shards-offer.cjs');
const governedShards = require('./governed-test-shards.cjs');
const { GovernanceMaintenance, appendRunRecord } = require('./toolkit-governance-migration.cjs');
const finishing = require('./toolkit-governance-finish.cjs');
const { FirstInstallSweep } = require('./toolkit-governance-first-sweep.cjs');
const { managedToolkitFile } = require('./toolkit-user-state.cjs');

const CMD = subcommand => `\`${governance.governanceCommand(subcommand)}\``;
const ADOPTION_NOT_READY = 'The turn-on pull request is not ready: it needs the programme file and the plain-text check. Run toolkit governance where GitHub can be read: its guided setup makes the missing parent issue and private evidence store and adds the CI checks to one setup pull request. Build none of it by hand.';
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
// The exit code that means "the questions or summary are shown; stop and wait for the owner's reply",
// as in setup toolkit. A shown step is finished, not a failure: the app would label any other exit Failed.
const BANK_SHOWN = 0;
// How many replies the owner's own terminal reads for one set of questions before it stops with nothing written.
const TERMINAL_TRIES = 5;
// Setup asked for when the merged binding could not be read just now reads it once more, with a longer
// limit for each git step than the first read had (a slow fetch or a lock held by another git process).
const BANK_REREAD_TIMEOUT_MS = 3 * bindingCache.GIT_TIMEOUT_MS;
// When even that read fails: the owner gets a plain line to type the command again, never a status.
const BANK_UNREAD = 'Toolkit governance could not be shown because GitHub could not be read just now, so this computer cannot confirm the settings merged for this repository. Nothing changed. Type toolkit governance again in a moment.';
const BANK_UNREAD_AGENTS = 'Agents: this line is for you alone. Show the owner the line above exactly as printed, leaving out this line, then stop. Run no other governance command, and never show a status or check in place of it.';
const ANSWER_UNREAD = 'Nothing changed, and this answer was not used: GitHub could not be read just now, so this computer cannot confirm the settings merged for this repository. Type toolkit governance again in a moment.';
// Causes that stay until someone changes this computer's or repository's settings: the unread line
// names them, so the owner is not told to retry something a retry cannot fix.
const LASTING_REFRESH_CAUSES = Object.freeze(['remote-redirected', 'hooks-unguarded', 'cache-unwritable']);
function bankUnreadLine(error) {
  if (!LASTING_REFRESH_CAUSES.includes(error)) return BANK_UNREAD;
  return `Toolkit governance could not be shown because the settings merged for this repository could not be read: ${bindingCache.refreshReason(error)}. Nothing changed. This does not clear on its own: fix that, then type toolkit governance again.`;
}
const CLOUD_BANK = `This is a cloud session, where Toolkit cannot check that a reply is the owner's own, so an answer in this chat cannot be recorded. Answer from a Remote Control session on your computer, or run ${CMD('setup')} in your own terminal.`;
// The line after a reply that could not be used, asking for the reply again.
const REPLY_AGAIN = 'Reply again in your own words, or with the letters, such as 1A 2A 3A.';
// After an answer that was already used, a reply that is not one (a bare ok or thanks) loses nothing.
const ANSWER_USED = 'Your earlier answer was already used, and this reply changes nothing. Nothing more was written.';
const CHANGE_ANOTHER = 'To change something, say turn off governance, task auto-merge on, task auto-merge off or change store.';
// The reference the agent puts in front of the owner's answer, read off before the answer is parsed.
const REFERENCE_PREFIX = /^\s*[0-9A-Za-z-]{16,19}\s*:\s*/;
const ALIASES = Object.freeze({ decline: 'disable' });
const USAGE = `Usage: ${governance.governanceCommand('<status|discover|enable|disable|publish|security> [--json]')}\n`
  + `       ${governance.governanceCommand('check [--json] [--offline]')}\n`
  + `       ${governance.governanceCommand('publish --run <pending receipt>')}\n`
  + `       ${governance.governanceCommand('<setup|refresh> [--json]')} (the guided setup, or the summary where governance is on; refresh is the same)\n`
  + `       ${governance.governanceCommand('setup --answers "<reference>: <answer>" --ticket <owner reply ticket>')}\n`
  + `       ${governance.governanceCommand('migrate [--root <folder>]...')} (protection/security maintenance only; no local decisions)\n`
  + `       ${governance.governanceCommand('finish')} (right after the setup pull request merges; a later session start runs it otherwise)\n`;

const RULES_TEXT = Object.freeze({
  ENABLED: 'Global rules and coding gates, plus GitHub governance: programme records, decision traces and evidence custody.',
  UNAVAILABLE: "Couldn't check governance. Continue with global rules and coding gates; no governance effects or standing task auto-merge until it can be checked.",
  ERROR: 'Global rules and coding gates. The binding merged on the default branch cannot be used, so governed records, gate admission and finality hold until a pull request fixes it.',
  DISABLED: 'Global rules and coding gates, without GitHub governance. Any governed block in AGENTS.md is an old copy and is not followed.',
  UNDECIDED: `GitHub governance is not decided yet, so it counts as off: work continues under the global rules, without governance effects or standing task auto-merge, and nothing waits on the answer. Toolkit asks once per session. An account that can write decides by answering yes, no or later when Toolkit asks, or by saying toolkit governance and answering its three setup questions.`,
});

// The fixed summary of a guided turn-on pull request: what merging it does, what it holds, the checks it
// requires and what Toolkit finishes after the merge. The closing line follows it (#applyBank). It
// gives the owner no step but the merge approval: Toolkit sets the required checks, and the
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
    `After the merge, Toolkit finishes the setup on its own: ${finishing.WHAT}. On a private repository on GitHub Free, GitHub cannot enforce the protection or the rulesets; Toolkit says so and the local guards stay the fallback.`,
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
  #proposals; #proposalsLive; #pullOutcome; #stdout; #stderr; #ask; #confirm; #interactive; #cwd; #registryOptions; #discoveryGh; #refresh; #rulesetReader; #rulesetCreator; #stateRulesetCreator; #protectionReader; #protectionWriter; #securityReader; #securityWriter; #securityFileWriter; #hookReader; #queueReader; #appReader; #switchTransport; #permissionsChecker; #environment; #adoptionWriter; #plainTextInstaller; #ciEstimator; #ciReaders; #firstSweep;

  // `ask(question)` resolves to the typed line; `interactive` says whether a person is at a
  // terminal. `registryOptions` ({ registryPath, testOnly: true }), `rulesetReader`,
  // `rulesetCreator`, `stateRulesetCreator`, `protectionReader`, `protectionWriter`, `securityReader`, `securityWriter` and
  // `securityFileWriter` are only for tests, as are `discoveryGh` (discovery's GitHub reader) and
  // `refresh` (the merged-binding refresh `status` runs first), `hookReader` (the Hooks: lines) and
  // `queueReader` (the offline queue count for a repository root) and `appReader` (the governance App
  // presence reads) and `cloudWorkflows` (the cloud sweep copy render a yes proposal carries).
  // `permissionsChecker` (root => { checked, missing }) and `environment` (the host session id the bank
  // ticket is bound to) are for tests too, as is `firstSweep` (the finish's first-install sweep).
  constructor({ stdout = process.stdout, stderr = process.stderr, ask = terminalAsk, confirm = null, interactive = isInteractiveTerminal(), cwd = process.cwd(), registryOptions = {}, discoveryGh = null, refresh = null, rulesetReader = null, rulesetCreator = null, stateRulesetCreator = null, protectionReader = null, protectionWriter = null, securityReader = null, securityWriter = null, securityFileWriter = null, hookReader = null, queueReader = null, proposalTransport = null, appReader = null , cloudWorkflows = null, switchTransport = null, permissionsChecker = null, environment = process.env, adoptionWriter = null, plainTextInstaller = null, ciEstimator = null, ciReaders = null, firstSweep = null } = {}) {
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
    // The sharded CI offer's minutes estimate (read-only gh) and the check that every pinned Toolkit copy
    // reads ci_shards; offline and in tests the estimate is unknown unless one is given.
    this.#ciEstimator = ciEstimator || (registryOptions.testOnly || process.env.TOOLKIT_GOVERNANCE_OFFLINE === '1' ? () => null : root => ciOffer.readEstimate(root));
    // The pinned copies are checked against the Toolkit git checkout (the managed one from a plugin copy).
    this.#ciReaders = ciReaders || (root => ciOffer.readersReady(root, require('./toolkit-cloud-workflows.cjs').sourceRoot()));
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
        this.#turnOnNumber = null;
        const code = await this.#bank(json, answers, ticket);
        // Every output that follows an answer ends with the one Agents line: after the answer that
        // prepared the setup pull request, the steps that carry the setup through.
        if (answers !== null) this.#stdout.write(`\n${this.#turnOnNumber ? governanceBank.agentsAfterTurnOn(this.#turnOnNumber) : governanceBank.agentsAfterAnswer()}\n`);
        return code;
      }
      return await this.#decide(command, json);
    } catch (error) {
      const [text, code] = PROPOSAL_ERRORS[error.code] ? [PROPOSAL_ERRORS[error.code], 2]
        : error.code === 'PROPOSAL_ADOPTION_INCOMPLETE' ? [ADOPTION_NOT_READY, 2]
          : error instanceof GovernanceCliError ? [error.message, error.exitCode]
            : [`Toolkit governance stopped because of an unexpected problem (${error?.name || 'Error'}${error?.code ? ` ${error.code}` : ''}). The operation did not finish or could not be verified. Read back its result before retrying.`, 2];
      this.#stderr.write(`${text}\n${answers !== null ? `\n${governanceBank.agentsAfterAnswer()}\n` : ''}`);
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
    // Run right after the setup pull request merges, so the merged programme file is read first.
    try { this.#refresh(this.#cwd); } catch { /* the state below says whether it was read back */ }
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
  // `bank` is true only when the guided setup publishes its own answer: a yes from anywhere else (an
  // agent's publish --run) is refused, so no turn-on pull request is ever built by hand.
  // `shards` is the ci_shards value a turn-on answer records ({ answer, offered_at }), or null, and
  // `app` 'keep' from the guided setup (the summary after the merge gives the App line), or null outside it.
  #publish(json, run, switches = null, adopted = null, bank = false, shards = null, app = null) {
    if (!bank && this.#proposals.answerFor(this.#cwd, run) === 'yes') throw new GovernanceCliError(`${BANK_ONLY} Run ${CMD('setup')} and show the owner its questions; build nothing by hand. Nothing was written.`);
    let binding = adopted ? adopted.binding : null;
    if (!adopted) try { binding = JSON.parse(fs.readFileSync(path.join(this.#cwd, governance.BINDING_FILE), 'utf8')); } catch { /* prepare explains missing adoption */ }
    // setup governance asks the switch with yes; it joins the same proposal, never a local file.
    if (switches && binding && typeof binding === 'object') binding = { ...binding, task_prs: { ...(binding.task_prs || {}), ...switches } };
    if (shards && binding && typeof binding === 'object') binding = { ...binding, ci_shards: shards };
    const result = this.#proposals.publish(this.#cwd, run, binding, bank, bank ? this.#rendered : null);
    // A bank turn-on is finished after its merge: protection, rulesets and security settings.
    if (bank && result.proposal?.answer === 'yes') {
      try { finishing.markPending(this.#registryOptions, this.#state().repository_id, { proposal: result.proposal.number, firstSweep: result.added ? result.added.includes('personal-data-guard') : null }); } catch { /* the owner can run migrate */ }
    }
    const turnOn = bank && result.proposal?.answer === 'yes';
    if (turnOn) {
      this.#turnOnUrl = result.proposal.url;
      this.#turnOnNumber = Number.isSafeInteger(result.proposal.number) ? result.proposal.number : null;
    }
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

  // `toolkit governance` (`setup governance`, `refresh governance`): the guided setup where governance
  // is not on (toolkit-governance-guided.cjs), the summary where it is (toolkit-governance-summary.cjs).
  // Shown, it notes them for this run so the owner's next own reply gets a one-use ticket
  // (toolkit-governance-bank.cjs), and exits BANK_SHOWN. With --answers and that ticket it applies the
  // owner's answer: at most one governance pull request. In the owner's own terminal it shows them and
  // reads the reply there.
  async #bank(json, answers, ticket) {
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
      this.#print(json, { state: state.state, writes: 0 }, answers === null ? [bankUnreadLine(cause), '', BANK_UNREAD_AGENTS] : [ANSWER_UNREAD]);
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
    // The sharded CI offer: where the merged binding turns governance on and has no final answer, and in
    // a repository not on yet, where an answer joins the turn-on pull request.
    const offered = state.state === 'ENABLED' ? Boolean(merged) && !['yes', 'never'].includes(merged.ci_shards?.answer) : Boolean(state.root);
    let estimate = null;
    if (offered) { try { estimate = this.#ciEstimator(state.root); } catch { estimate = { minutes: null, unread: 'the CI time read failed' }; } }
    // An answer already waiting in its own pull request shows as that pull request; GitHub that cannot
    // be read leaves the question asked, and publishing then still refuses a second one.
    let open = [];
    if (offered && state.state === 'ENABLED' && this.#switchTransport && state.repository) { try { open = this.#switchTransport.openCiShards(state.repository); } catch { open = []; } }
    // A split the owner closed without merging is asked about once. This computer's newest remembered
    // answer holds until a newer split is closed, even when GitHub no longer lists that close among the
    // newest closed pull requests or the list cannot be read. With nothing remembered, a list that
    // cannot be read counts as none, as the open list does.
    let closed = null;
    if (offered && state.state === 'ENABLED' && !open.length && this.#switchTransport && state.repository) {
      let remembered = null;
      try { remembered = ciOffer.latestClosedSplit(this.#registryOptions, state.repository_id); } catch { remembered = null; }
      let found = null;
      try { found = this.#switchTransport.closedCiShards(state.repository); } catch { found = null; }
      if (found && !(remembered && remembered.number >= found.number)) closed = { ...found, answered: false };
      else if (remembered) closed = { number: remembered.number, url: found?.number === remembered.number ? found.url : `https://github.com/${state.repository}/pull/${remembered.number}`, answered: true };
    }
    // A repository whose CI already runs its tests in parallel is never offered a shard list.
    let existing = null;
    if (offered) { try { existing = ciOffer.existingShards(state.root); } catch { existing = null; } }
    // Where Toolkit cannot make a usable first list (no Node tests, such as a Python suite), shards are
    // not applicable, with the reason, rather than a default that could not be built.
    let usable = null;
    if (offered && !existing) { try { const list = ciOffer.firstList(state.root, estimate); usable = list.ok ? { ok: true } : { ok: false, reason: list.reason }; } catch { usable = null; } }
    const ciShards = offered ? { measured: estimate, open, existing, usable, closed } : null;
    this.#lastCiEstimate = estimate;
    // The App row reads its variable and secret wherever governance is on or can be turned on (again) here.
    const app = state.repository ? governanceApp.presence(state.repository, this.#appRead()) : null;
    const copies = state.state === 'ENABLED' && state.root ? this.#cleanup(state.root, false) : null;
    // The store, read as the App is; where GitHub could not answer, its last background check. Both
    // reads GitHub answered are saved (toolkit-governance-parts.cjs), so a part the owner fixed and sees
    // here as ready no longer gets its session-start line.
    const storeCheck = merged?.store?.repository ? this.#storeCheck(state, merged.store.repository, app) : null;
    const specs = governanceBank.governanceBankSpecs({ state, task: task ? task.value : 'unset', train: switches.train, merged, mergedRead: read, permissions, adoption, ciShards, app, copies: copiesRow(copies), storeCheck });
    const reference = governanceBank.bankReference(specs);
    // What the owner sees: the guided questions where governance is not on, the summary where it is,
    // or one line where neither can be shown yet.
    const view = this.#view({ state, specs, adoption, found, merged, read, switches, permissions, app, storeCheck, copies });
    if (answers === null) {
      if (json) { this.#print(true, { state: state.state, bank_reference: reference, questions: specs }, []); return BANK_SHOWN; }
      if (view.kind === 'line') { this.#print(false, {}, [...view.lines, '', BANK_UNREAD_AGENTS]); return view.code; }
      const refused = this.#interactive ? this.#agentShell() : null;
      // An agent's shell is never the owner's terminal, whatever terminal it has: the questions are
      // shown as in any chat, and only the owner's own reply can answer them.
      if (refused) this.#stderr.write(`Toolkit: no answer is read in this terminal, because ${refused.stopped}\n`);
      else if (this.#interactive) {
        // In the owner's own terminal: shown once, then a reply that cannot be used gets one line, up
        // to TERMINAL_TRIES replies; an empty reply ends it.
        this.#stdout.write(`${view.text}\n`);
        for (let tries = 1; ; tries += 1) {
          const reply = tries > TERMINAL_TRIES ? '' : String(await this.#ask(view.kind === 'summary' ? 'A change, or Enter for none: ' : 'Your answer: ')).trim();
          if (!reply) { this.#print(false, {}, ['Nothing was written.']); return view.kind === 'summary' ? 0 : 1; }
          let chosen;
          try { chosen = view.parse(reply); }
          catch (error) {
            if (!(error instanceof GuidedAnswerError)) throw error;
            this.#print(false, {}, [`${error.message} Nothing was written. ${view.kind === 'summary' ? CHANGE_ANOTHER : REPLY_AGAIN}`]);
            continue;
          }
          return this.#applyView(view, state, task, chosen, found, specs);
        }
      }
      return this.#showBank(view, state, reference);
    }
    if (this.#cloud()) throw new GovernanceCliError(`${CLOUD_BANK} Nothing was written.`);
    const sessionId = this.#hostSession();
    const epochs = new gate.SessionEpochs({ registryOptions: this.#registryOptions });
    const epoch = sessionId ? epochs.get(sessionId) : null;
    let entry = null;
    try { entry = sessionId ? new governanceBank.BankTickets({ registryOptions: this.#registryOptions }).take(ticket, sessionId, epoch) : null; } catch { entry = null; }
    if (!entry || entry.repository_id !== state.repository_id) {
      throw new GovernanceCliError('No live reply ticket from the owner for this session and repository, so nothing was written. The owner can type toolkit governance to see the questions again. An agent cannot answer for the owner.');
    }
    // Shown once: a reply that cannot be used gets a short line, and the same run waits for the owner's
    // next own reply (BankTickets.rearm), never a second showing.
    const again = (lines, reply) => this.#again(sessionId, entry, reference, lines, reply);
    if (view.kind === 'line') {
      this.#print(false, {}, [...view.lines, 'The answer was not used.']);
      return 0;
    }
    if (entry.bank_reference !== reference) {
      // What was shown changed since (another session, or GitHub): the answer is not used, and what
      // stands now is shown in its place, open for the owner's next reply.
      return again(['What Toolkit showed has changed since, so the answer was not used and nothing was written. Here it is as it stands now:', '', view.text], view.kind === 'summary' ? CHANGE_ANOTHER : REPLY_AGAIN);
    }
    let chosen;
    try { chosen = view.parse(answers.replace(REFERENCE_PREFIX, '')); }
    catch (error) {
      if (!(error instanceof GuidedAnswerError)) throw error;
      // After a used answer, a reply that is not one (a bare ok) is not a lost answer.
      if (entry.used === true) return again([ANSWER_USED], CHANGE_ANOTHER);
      return again([`${error.message} Nothing was written.`], view.kind === 'summary' ? CHANGE_ANOTHER : REPLY_AGAIN);
    }
    // Open after an answer too, so the owner's next own reply (another change) gets a new one-use
    // ticket and its own line, never a spent ticket. An answer that did what it said is noted as used.
    let code = null;
    try {
      code = this.#applyView(view, state, task, chosen, found, specs);
      return code;
    } finally {
      try { new governanceBank.BankTickets({ registryOptions: this.#registryOptions }).rearm(sessionId, entry, { bankReference: reference, used: code === 0 }); } catch { /* the owner can type toolkit governance */ }
    }
  }

  // The guided questions, the summary, or one line: { kind, text, agents, parse } or { kind: 'line',
  // lines, code }.
  #view({ state, specs, adoption, found, merged, read, switches, permissions, app, storeCheck, copies }) {
    if (state.state === 'ENABLED') {
      const facts = this.#summaryFacts({ state, specs, merged, read, switches, permissions, app, storeCheck, copies });
      let held = false;
      try { const result = require('./toolkit-governance-ready.cjs').readiness(state, this.#registryOptions); held = result.applies && !result.ready; } catch { held = false; }
      const shards = specs.some(spec => spec.id === 'ci-shards' && spec.shards_default);
      const cleanable = Boolean(copies && copies.ok && copiesRow(copies)?.files > 0);
      return { kind: 'summary', text: summary.renderSummary(facts, { held }), agents: governanceBank.agentsSummary(), parse: reply => summary.parseChange(reply, { copies: cleanable, shards }) };
    }
    // The search's own reason is for the logs, not the owner: nothing can be set up until it works.
    if (adoption && adoption.blocked) return { kind: 'line', code: 1, lines: ['GitHub could not be read just now, so Toolkit cannot find or suggest the evidence store and parent issue yet, and the setup questions are not shown. Nothing changed. Type toolkit governance again in a moment.'] };
    if (found && found.status === 'pending') return { kind: 'line', code: 0, lines: [`${String(found.reason).replace(/^Toolkit: /, '')} Merge it, or close it and type toolkit governance to answer again. Nothing was written.`] };
    const [owner, name] = String(state.repository || '/').split('/');
    const store = adoption ? { repository: adoption.store.repository, path: `state/${owner}/${name}/`, exists: Boolean(adoption.found_store) } : null;
    const agreed = state.state === 'UNDECIDED' && this.#agreed(state);
    const questions = guided.guidedQuestions({ state, store, agreed, publicRepo: adoption?.visibility === 'public' });
    return { kind: 'guided', text: guided.renderGuided(questions, { state, agreed }), agents: governanceBank.agentsGuided(), parse: reply => guided.parseGuidedAnswer(reply, questions, { state }) };
  }

  // Whether the owner said yes to the session-start governance question in this run (PromptHold notes it).
  #agreed(state) {
    const sessionId = this.#hostSession();
    if (!sessionId) return false;
    try {
      const epochs = new gate.SessionEpochs({ registryOptions: this.#registryOptions });
      return new governanceBank.BankTickets({ registryOptions: this.#registryOptions }).agreedFor(sessionId, { epoch: epochs.get(sessionId), repositoryMark: epochs.repository(state.repository_id), repositoryId: state.repository_id });
    } catch { return false; }
  }

  // What the summary shows, from this one read of the merged programme file and the local records.
  #summaryFacts({ state, specs, merged, read, switches, permissions, app, storeCheck, copies }) {
    const shardsRow = specs.find(spec => spec.id === 'ci-shards');
    let finish = null;
    try { finish = finishing.entryFor(this.#registryOptions, state.repository_id)?.parts || null; } catch { finish = null; }
    let drift = null;
    try { drift = require('./toolkit-governance-parts.cjs').saved(this.#registryOptions, state.repository_id)?.settings?.drift || null; } catch { drift = null; }
    const store = merged?.store?.repository || null;
    return {
      repository: state.repository,
      defaultBranch: state.merged?.default_branch || null,
      store: store ? { repository: store, state: storeCheck?.state || null } : null,
      parents: (merged?.parents || []).map(parent => parent.issue),
      task: { auto_merge: switches.task, merge_train: switches.train },
      requiredChecks: merged?.required_checks || [],
      finish, drift,
      files: this.#mergedFiles(state),
      shards: shardsRow ? `${shardsRow.current_short || shardsRow.current}` : null,
      permissions: { ...permissions, app: permissions.app || governanceBank.APP_NAMES[permissions.host] },
      app,
      appCommand: state.repository ? governanceApp.setupCommand(state.repository, store) : null,
      copies: copiesRow(copies),
      stale: read && !read.fresh ? read.refresh_error || 'no fresh read' : null,
    };
  }

  // The answer applied: the guided setup's turn-on, off or later, or a change after setup.
  #applyView(view, state, task, chosen, found, specs) {
    if (view.kind === 'summary') return this.#applyChange(state, task, chosen, specs);
    // Parallel CI shards are no question: the turn-on takes Toolkit's default for them.
    const shards = specs.find(spec => spec.id === 'ci-shards' && spec.shards_default);
    return this.#applyBank(state, { ...chosen, ...(chosen.governance === 'on' && shards ? { ciShards: shards.shards_default } : {}) }, found);
  }

  // A reply that could not be used: its lines and the one reply line, and the same questions noted
  // again for this run so the owner's next own reply answers them.
  #again(sessionId, entry, reference, lines, reply = REPLY_AGAIN) {
    let noted = false;
    try { noted = new governanceBank.BankTickets({ registryOptions: this.#registryOptions }).rearm(sessionId, entry, { bankReference: reference }); } catch { noted = false; }
    this.#print(false, {}, [...lines, noted ? reply : 'Toolkit could not keep this open for another reply (its user-state folder could not be written). Type toolkit governance to see it again.']);
    return BANK_SHOWN;
  }

  #lastCiEstimate = null;
  // How the turn-on answer chose its store, for the turn-on summary.
  #storeNote = null;
  // The turn-on pull request the guided setup published in this run, for its closing line, and its
  // number, for the Agents line that carries the setup through its merge (main).
  #turnOnUrl = null;
  #turnOnNumber = null;
  // The scratch folder outside the checkout a turn-on renders its missing CI files and first shard
  // list into, for its one pull request; removed when the answer is done. Never the owner's checkout.
  #rendered = null;

  // The .github files at the merged commit this computer read the programme file from (summary rows).
  #mergedFiles(state) {
    return summary.mergedFiles(state.root, state.merged?.commit);
  }

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

  // One binding pull request for the owner's sharded CI answer, built from the exact merged text: it
  // sets ci_shards (answer, offered_at) and, for yes, adds a first shard list when the repository has
  // none. It waits while a pinned Toolkit copy here would read the key as invalid.
  // `changes` are switch changes from the same answer ({ auto_merge, merge_train }), which join this
  // one pull request, so the two never conflict.
  #prepareCiShards(root, answer, changes = {}) {
    if (!this.#switchTransport) throw new GovernanceCliError('GitHub cannot be reached from here, so no pull request was prepared. Nothing was written.');
    const ready = this.#ciReaders(root);
    if (!ready.ok) throw new GovernanceCliError(`The parallel CI shards answer was not prepared: ${ready.reason}. Nothing was written.`);
    const identity = governance.readIdentity(root);
    const entry = bindingCache.readBindingCache(identity, governance.userStateDirectory(this.#registryOptions));
    let parsed;
    try { parsed = JSON.parse(String(entry?.text).replace(/^\uFEFF/, '')); } catch { parsed = null; }
    if (!parsed || parsed.schema !== 'toolkit.programme-binding.v2' || parsed.governance !== 'enabled') throw new GovernanceCliError('The merged binding is not an enabled version 2 binding, so the answer cannot be recorded yet. Nothing was written.');
    const value = { answer, offered_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') };
    const kept = withoutRetired(entry.text, parsed);
    const switched = Object.keys(changes).length ? { ...kept.binding, task_prs: { ...(kept.binding.task_prs || {}), ...changes } } : kept.binding;
    const proposal = { ...switched, ci_shards: value };
    if (governance.bindingProblems(proposal, identity).length) throw new GovernanceCliError('The changed binding would not be valid, so no pull request was prepared. Nothing was written.');
    const lines = [];
    let list = null;
    if (answer === 'yes') {
      if (fs.existsSync(path.join(root, ...governedShards.MANIFEST_REL.split('/')))) lines.push(`${governedShards.MANIFEST_REL} is already here, so the pull request keeps it.`);
      else {
        const first = ciOffer.firstList(root, this.#lastCiEstimate);
        if (first.ok) { list = first.text; lines.push(`It adds a first ${governedShards.MANIFEST_REL} with ${first.shards} Linux shards running node --test; Shard Timings rebalances them from measured times.`); }
        else lines.push(`It adds no shard list: ${first.reason}. The shard workflows are copied only once a usable ${governedShards.MANIFEST_REL} is merged, and only Node tests are supported for now.`);
      }
    }
    let prepared;
    try {
      const base = Object.keys(changes).length ? switchText(kept.text, kept.binding, changes) : kept.text;
      prepared = this.#switchTransport.publishCiShards(proposal.repository, entry.text, ciOffer.ciShardsText(base, switched, value), answer, list, changes);
    } catch (error) {
      throw new GovernanceCliError(error.code === 'SWITCH_BASE_CHANGED'
        ? `The binding on the default branch changed since this computer read it. Run ${CMD('status')}, then ask again. Nothing was written.`
        : error.code === 'SHARDS_PR_OPEN'
          ? `A parallel CI shards pull request is already open, so no second one was prepared: ${error.url}. Merge it, or close it and answer again. Nothing was written.`
          : `The parallel CI shards pull request could not be prepared (${error.code || 'unavailable'}). Check GitHub access and open pull requests before retrying.`);
    }
    return { prepared, lines };
  }

  // A cloud session skips the reply check, so the owner's chat answer there can never be recorded.
  #cloud() { return this.#environment.CLAUDE_CODE_REMOTE === 'true'; }

  #hostSession() {
    const id = this.#environment.TOOLKIT_HOST_SESSION || this.#environment.CODEX_THREAD_ID;
    return typeof id === 'string' && id !== '' ? id : null;
  }

  // Prints the guided questions or the summary and notes them for this run, so the owner's next own
  // reply (typed, or tapped on a card the app chose to show) can answer them.
  #showBank(view, state, reference) {
    if (this.#cloud()) {
      this.#stdout.write(`${view.text}\n\n${CLOUD_BANK}\n`);
      return BANK_SHOWN;
    }
    const sessionId = this.#hostSession();
    const epochs = new gate.SessionEpochs({ registryOptions: this.#registryOptions });
    const epoch = sessionId ? epochs.get(sessionId) : null;
    let noted = false;
    try {
      noted = Boolean(sessionId) && new governanceBank.BankTickets({ registryOptions: this.#registryOptions }).shown(sessionId, {
        epoch, repositoryMark: epochs.repository(state.repository_id), repositoryId: state.repository_id, root: state.root, bankReference: reference,
      });
    } catch { noted = false; }
    this.#stdout.write(`${view.text}\n\n${view.agents}\n`);
    if (!noted) this.#stdout.write(`\nToolkit could not note this for this session (its session-start hook did not mark it, or its user-state folder could not be written), so a reply in chat cannot be recorded. Start a new session and say toolkit governance there, or run ${CMD('setup')} in your own terminal.\n`);
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

  // A used answer where the summary shows a closed, unmerged shard split: remembered on this computer
  // (shards=yes, shards=never, or not-now for any other change), so that close is not asked about again.
  #settleClosedSplit(state, specs, answer) {
    const row = specs.find(spec => spec.id === 'ci-shards' && Number.isInteger(spec.closed_split));
    if (!row) return;
    try { ciOffer.rememberClosedSplit(this.#registryOptions, state.repository_id, row.closed_split, ciOffer.ANSWERS.includes(answer) ? answer : 'not-now'); }
    catch { /* not remembered: asked once more */ }
  }

  // A change the owner asked for after setup, in words (toolkit-governance-summary.cjs parseChange): at
  // most one pull request, which applies only after the owner merges it.
  #applyChange(state, task, chosen, specs) {
    if (chosen.governance === 'off') return this.#prepareOff();
    if (chosen.changeStore) {
      this.#print(false, {}, ['A new evidence store is set up with the controller: say change store in your controller chat, and it sets up the new store with you. Nothing changed here.']);
      return 0;
    }
    if (chosen.cleanCopies) {
      const cleaned = this.#cleanup(state.root, true);
      this.#print(false, {}, cleaned.lines);
      return cleaned.ok ? 0 : 1;
    }
    if (chosen.taskAutoMerge) {
      const want = chosen.taskAutoMerge === 'on' ? 'after-gates' : 'off';
      // No key in the programme file is Off.
      if (task && (task.value === 'after-gates' ? 'after-gates' : 'off') === want) {
        this.#print(false, {}, [`Task auto-merge is already ${chosen.taskAutoMerge}. Nothing changed.`]);
        return 0;
      }
      // On comes with merge trains, as the guided setup asks it; off leaves the train switch as it is.
      const changes = want === 'after-gates' ? { auto_merge: 'after-gates', merge_train: 'on' } : { auto_merge: 'off' };
      const prepared = this.#prepareSwitch(state.root, changes);
      this.#print(false, {}, [`Prepared ${prepared.url}: it sets task auto-merge ${chosen.taskAutoMerge}${want === 'after-gates' ? ' with merge trains' : ''} and changes nothing else. It applies only after you merge it.`, governance.taskSwitchVersionLine()]);
      return 0;
    }
    if (chosen.shards) {
      this.#settleClosedSplit(state, specs, chosen.shards);
      if (chosen.shards === 'not-now') {
        this.#print(false, {}, ['Parallel CI shards: not now. Nothing changed.']);
        return 0;
      }
      const { prepared, lines } = this.#prepareCiShards(state.root, chosen.shards);
      this.#print(false, {}, [`Prepared ${prepared.url}: it records parallel CI shards as ${chosen.shards === 'yes' ? 'yes' : 'never ask'} (ci_shards) in the binding. It applies only after you merge it.`, ...lines, governance.taskSwitchVersionLine()]);
      return 0;
    }
    this.#print(false, {}, ['Nothing changed.']);
    return 0;
  }

  // The guided setup's answer where governance is not on: the one turn-on pull request, the one off
  // pull request, or nothing (later, no store, keep it off). The owner's commands (Toolkit permissions,
  // the Governance App) come in the summary after the merge, never here.
  #applyBank(state, chosen, found = null) {
    let code = 0;
    this.#turnOnUrl = null;
    this.#storeNote = null;
    // No store wanted (or later): governance needs one, so nothing is made and governance stays off.
    if (chosen.noStore) {
      this.#print(false, {}, [chosen.later ? 'Later: nothing was written, and governance stays off. Toolkit asks again next session.'
        : 'Governance needs a store, so it stays off. Nothing was written: no pull request, store or parent issue was made. Toolkit asks again next session.']);
      return 0;
    }
    if (chosen.governance === 'keep') {
      this.#print(false, {}, ['Nothing changed: governance stays off.']);
      return 0;
    }
    if (chosen.governance === 'off') return this.#prepareOff();
    // Task auto-merge with merge train, as answered; both switches go in the one turn-on pull request.
    const auto = chosen.taskAutoMerge === 'on';
    const enabling = { auto_merge: auto ? 'after-gates' : 'off', merge_train: auto ? 'on' : 'off' };
    if (found?.status === 'pending') {
      // A governance pull request is already open: it is the one to merge or close, never a second.
      const open = this.#proposals.pending(this.#cwd)?.proposals || [];
      this.#print(false, {}, [open.length
        ? `A governance pull request is already open, so no second one was prepared: ${open.map(item => `${item.url} (turns governance ${item.answer === 'yes' ? 'on' : 'off'})`).join(', ')}. Merge it, or close it and type toolkit governance to answer again. Nothing was written, and the rest of this answer was not used.`
        : `${String(found.reason).replace(/^Toolkit: /, '')} Nothing was written.`]);
      return open.length ? 0 : 2;
    }
    const plan = found ? adopt.adoptionPlan(found, { store: chosen.store || null }) : null;
    if (chosen.store && !(plan && !plan.blocked)) {
      this.#print(false, {}, [`The store ${chosen.store} was not used, because ${plan?.blocked ? 'GitHub could not be read just now' : 'the programme file in the working tree already names the store'}. Nothing was written.`]);
      return 2;
    }
    if (plan && plan.blocked) this.#print(false, {}, ['GitHub could not be read just now, so the evidence store and parent issue could not be found or made.']);
    if (plan && !plan.blocked) this.#storeNote = plan.store.named ? 'the one you named' : plan.store.create ? 'created for this repository' : 'found';
    // A store that cannot be used is refused before anything is written here, the shard list included.
    const problem = plan && !plan.blocked ? adopt.storeProblem(plan) : null;
    if (problem) { this.#adoptStopped(problem, []); return 2; }
    this.#rendered = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-turn-on-'));
    try {
      // A shards yes or never joins the one turn-on pull request.
      const shards = ['yes', 'never'].includes(chosen.ciShards) ? this.#turnOnShards(state.root, chosen.ciShards) : null;
      code = plan && !plan.blocked ? this.#adoptAndPropose(state, plan, enabling, shards, 'keep')
        : !found && adopt.adoptionPrepared(state.root) ? this.#preparedAndPropose(state, enabling, shards, 'keep') : this.#prepareOn(enabling, null, shards, 'keep');
    } finally {
      fs.rmSync(this.#rendered, { recursive: true, force: true });
      this.#rendered = null;
    }
    // The one closing line of a turn-on: the owner's merge approval is the next step.
    if (this.#turnOnUrl && code === 0) {
      this.#print(false, {}, ['', `Next: once its checks pass, approve merging ${this.#turnOnUrl} when Toolkit asks. Toolkit then finishes the setup and gives you two commands to run.`]);
    }
    this.#turnOnUrl = null;
    return code;
  }

  // The ci_shards value a turn-on answer records, or null when it is held. For yes it renders a first
  // shard list where the checkout has none, into the turn-on's scratch folder, so the list and the shard
  // workflows rendered from it travel in the same turn-on pull request (as the plain-text check files do).
  #turnOnShards(root, answer) {
    const ready = this.#ciReaders(root);
    if (!ready.ok) {
      this.#print(false, {}, [`Parallel CI shards: held, because ${ready.reason}. Nothing was written for them; answer them again at the next refresh.`]);
      return null;
    }
    const lines = [];
    if (answer === 'yes' && fs.existsSync(path.join(root, ...governedShards.MANIFEST_REL.split('/')))) lines.push(`Parallel CI shards: ${governedShards.MANIFEST_REL} is already here, so the turn-on pull request carries it.`);
    else if (answer === 'yes') {
      const first = ciOffer.firstList(root, this.#lastCiEstimate);
      if (first.ok) {
        const manifest = path.join(this.#rendered, ...governedShards.MANIFEST_REL.split('/'));
        fs.mkdirSync(path.dirname(manifest), { recursive: true });
        fs.writeFileSync(manifest, first.text);
        lines.push(`Parallel CI shards: a first ${governedShards.MANIFEST_REL} with ${first.shards} Linux shards running node --test travels in the turn-on pull request with the shard workflows; Shard Timings rebalances them from measured times.`);
      } else lines.push(`Parallel CI shards: yes is recorded, but no shard list was added: ${first.reason}. The shard workflows are copied only once a usable ${governedShards.MANIFEST_REL} is merged, and only Node tests are supported for now.`);
    } else lines.push('Parallel CI shards: never ask is recorded in the turn-on pull request.');
    this.#print(false, {}, lines);
    return { answer, offered_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') };
  }

  // A fresh repository: make the store and parent issue that are missing, add the CI checks, then the
  // one turn-on pull request (toolkit-governance-adopt.cjs).
  #adoptAndPropose(state, plan, switches, shards = null, app = null) {
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
    return this.#prepareOn(switches, adopted, shards, app);
  }

  // Why the turn-on stopped, what it already made and how to answer again.
  #adoptStopped(message, made) {
    this.#print(false, {}, [`${message} No pull request was prepared.`,
      made.length ? `Already made, and reused when you answer again: ${made.join(', ')}.` : 'Nothing was made on GitHub.',
      'Once the cause is fixed, type toolkit governance and answer again.']);
  }

  // A repository whose programme file is prepared in the working tree: the same CI checks as a fresh
  // one, then the one turn-on pull request.
  #preparedAndPropose(state, switches, shards = null, app = null) {
    let ready;
    try {
      ready = adopt.prepared({ root: state.root, into: this.#rendered, ...(this.#plainTextInstaller ? { plainText: into => this.#plainTextInstaller(state.root, into) } : {}) });
    } catch (error) {
      if (!(error instanceof adopt.AdoptError)) throw error;
      this.#print(false, {}, [`${error.message} No pull request was prepared.`]);
      return 2;
    }
    if (ready.lines.length) this.#print(false, {}, ready.lines);
    return this.#prepareOn(switches, ready, shards, app);
  }

  // The turn-on pull request from the owner's bank answer (the ticket or the owner's own terminal is the
  // proof); it applies only after the owner merges it. `adopted` carries the binding for a fresh repository.
  #prepareOn(switches, adopted = null, shards = null, app = null) {
    const before = this.#state();
    if (before.merged?.fresh && before.rule === 'M1') {
      this.#print(false, {}, ['Already ' + before.state.toLowerCase() + ' on the default branch. Nothing was written.']);
      return 0;
    }
    const sessionId = 'bank-' + crypto.randomBytes(16).toString('hex'), epoch = crypto.randomBytes(16).toString('hex');
    const request = this.#proposals.request(this.#cwd, 'yes', { sessionId, epoch });
    try { return this.#publish(false, request.run, switches, adopted, true, shards, app); }
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

// The merged binding (text and parsed) without its retired keys, in its own layout, so a switch or
// shards pull request drops a carried key in the same diff and changes nothing else.
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
