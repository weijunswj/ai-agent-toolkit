#!/usr/bin/env node
'use strict';

// Governance comes only from the programme file merged on origin's default branch.
// enable/disable capture a terminal answer and prepare the same proposal as the host gate.
// publish is available to the assigned agent only with a live pending owner-answer receipt.
const path = require('node:path');
const { detectAgentHost } = require('./agent-host-markers.cjs');
const readline = require('node:readline');
const ownerTerminal = require('./owner-terminal.cjs');

const fs = require('node:fs');
const crypto = require('node:crypto');
const util = require('node:util');
const { GovernanceProposals, GitHubProposalTransport, BANK_ONLY } = require('./toolkit-governance-proposal.cjs');
const governance = require('./toolkit-governance-state.cjs');
const conformance = require('./toolkit-governance-conformance.cjs');
const gate = require('./toolkit-governance-gate.cjs');
const discovery = require('./toolkit-governance-discovery.cjs');
const bindingCache = require('./toolkit-governance-binding.cjs');
const protection = require('./toolkit-governance-protection.cjs');
const security = require('./toolkit-governance-security.cjs');
const hookCapability = require('./toolkit-hook-capability.cjs');
const governanceApp = require('./toolkit-governance-app.cjs');
const governanceBank = require('./toolkit-governance-bank.cjs');
const adopt = require('./toolkit-governance-adopt.cjs');
const ciOffer = require('./toolkit-ci-shards-offer.cjs');
const governedShards = require('./governed-test-shards.cjs');
const { GovernanceMaintenance, appendRunRecord } = require('./toolkit-governance-migration.cjs');
const finishing = require('./toolkit-governance-finish.cjs');

const CMD = subcommand => `\`${governance.governanceCommand(subcommand)}\``;
const ADOPTION_NOT_READY = 'The turn-on pull request is not ready: it needs the programme file and the plain-text check. Run toolkit governance where GitHub can be read: its bank makes the missing parent issue and private evidence store and adds the CI checks to one setup pull request. Build none of it by hand.';
const PROPOSAL_ERRORS = Object.freeze({
  PROPOSAL_WRITE_REQUIRED: 'This GitHub account cannot write to this repository. Continue with global rules, without governance effects or standing task auto-merge. An owner with write access can publish the proposal.',
  PROPOSAL_CONFLICT: 'Conflicting governance proposals are open. Show their links and ask the owner which to keep before publishing again. None decides governance.',
  PROPOSAL_RECEIPT_REQUIRED: 'No live pending owner answer remains for this run. Check the existing decision pull request; if it closed, ask the owner again in this chat before preparing another.',
});

const COMMANDS = Object.freeze(['status', 'discover', 'enable', 'disable', 'check', 'publish', 'security', 'migrate', 'setup', 'refresh', 'finish']);
// The exit code that means "the bank is shown; stop and wait for the owner's reply", as in setup toolkit.
// A shown bank is a finished step, not a failure: the app would label any other exit Failed.
const BANK_SHOWN = 0;
// How many replies the owner's own terminal reads for one bank before it stops with nothing written.
const TERMINAL_TRIES = 5;
const CLOUD_BANK = `This is a cloud session, where Toolkit cannot check that a reply is the owner's own, so an answer in this chat cannot be recorded. Answer this bank from a Remote Control session on your computer, or run ${CMD('setup')} in your own terminal.`;
const ALIASES = Object.freeze({ decline: 'disable' });
const USAGE = `Usage: ${governance.governanceCommand('<status|discover|enable|disable|publish|security> [--json]')}\n`
  + `       ${governance.governanceCommand('check [--json] [--offline]')}\n`
  + `       ${governance.governanceCommand('publish --run <pending receipt>')}\n`
  + `       ${governance.governanceCommand('<setup|refresh> [--json]')} (the governance question bank; refresh is the same)\n`
  + `       ${governance.governanceCommand('setup --answers "<bank reference>: <answer>" --ticket <owner reply ticket>')}\n`
  + `       ${governance.governanceCommand('migrate [--root <folder>]...')} (protection/security maintenance only; no local decisions)\n`
  + `       ${governance.governanceCommand('finish')} (the session start runs it once after a bank turn-on merges)\n`;

const RULES_TEXT = Object.freeze({
  ENABLED: 'Global rules and coding gates, plus GitHub governance: programme records, decision traces and evidence custody.',
  UNAVAILABLE: "Couldn't check governance. Continue with global rules and coding gates; no governance effects or standing task auto-merge until it can be checked.",
  ERROR: 'Global rules and coding gates. The binding merged on the default branch cannot be used, so governed records, gate admission and finality hold until a pull request fixes it.',
  DISABLED: 'Global rules and coding gates, without GitHub governance. A governed block in AGENTS.md is not followed.',
  UNDECIDED: `GitHub governance is not decided yet, so it counts as off: work continues under the global rules, without governance effects or standing task auto-merge, and nothing waits on the answer. Toolkit asks once per session. An account that can write decides by saying \`toolkit governance\` and answering its question bank, by sending \`toolkit governance enable\` or \`toolkit governance disable\` as a message, or by running ${CMD('enable')} or ${CMD('disable')} in its own terminal.`,
});

// The fixed summary of a bank turn-on pull request: what merging it does, what it holds and what
// Toolkit finishes after the merge. The closing line follows the owner's commands (#applyBank).
// `binding` is the binding the pull request proposes: with no required checks, protection waits.
function turnOnSummary(result, binding) {
  const url = result.proposal.url;
  const noChecks = Array.isArray(binding?.required_checks) && binding.required_checks.length === 0;
  return [
    result.reused ? (result.updated ? `Toolkit: updated the open governance turn-on pull request with these answers: ${url}.` : `Toolkit: the open governance turn-on pull request already holds these answers: ${url}.`)
      : `Toolkit: prepared the governance turn-on pull request: ${url}.`,
    'Merging it turns governance on for this repository on every computer. It changes no credentials or deployment, and nothing applies before you merge it.',
    ...(result.files?.length ? [`It holds: ${result.files.join(', ')}.`] : []),
    `After the merge, the next session here finishes on its own: ${finishing.WHAT}. On a private repository on GitHub Free, GitHub cannot enforce the protection or the rulesets; that session says so and the local guards stay the fallback.`,
    ...(noChecks ? [`This repository has no required checks yet, so default-branch protection waits: once a pull request adds the check names to required_checks in ${governance.BINDING_FILE} and merges, run ${CMD('migrate')} in your own terminal to add it.`] : []),
    'After the merge, before pulling, compare any prepared untracked files with the merged copies; keep local differences and clear only verified duplicates.',
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
  #proposals; #proposalsLive; #stdout; #stderr; #ask; #confirm; #interactive; #cwd; #registryOptions; #discoveryGh; #refresh; #rulesetReader; #rulesetCreator; #stateRulesetCreator; #protectionReader; #protectionWriter; #securityReader; #securityWriter; #securityFileWriter; #hookReader; #queueReader; #appReader; #switchTransport; #permissionsChecker; #environment; #adoptionWriter; #plainTextInstaller; #ciEstimator; #ciReaders;

  // `ask(question)` resolves to the typed line; `interactive` says whether a person is at a
  // terminal. `registryOptions` ({ registryPath, testOnly: true }), `rulesetReader`,
  // `rulesetCreator`, `stateRulesetCreator`, `protectionReader`, `protectionWriter`, `securityReader`, `securityWriter` and
  // `securityFileWriter` are only for tests, as are `discoveryGh` (discovery's GitHub reader) and
  // `refresh` (the merged-binding refresh `status` runs first), `hookReader` (the Hooks: lines) and
  // `queueReader` (the offline queue count for a repository root) and `appReader` (the governance App
  // presence reads) and `cloudWorkflows` (the cloud sweep copy render a yes proposal carries).
  // `permissionsChecker` (root => { checked, missing }) and `environment` (the host session id the bank
  // ticket is bound to) are for tests too.
  constructor({ stdout = process.stdout, stderr = process.stderr, ask = terminalAsk, confirm = null, interactive = isInteractiveTerminal(), cwd = process.cwd(), registryOptions = {}, discoveryGh = null, refresh = null, rulesetReader = null, rulesetCreator = null, stateRulesetCreator = null, protectionReader = null, protectionWriter = null, securityReader = null, securityWriter = null, securityFileWriter = null, hookReader = null, queueReader = null, proposalTransport = null, appReader = null , cloudWorkflows = null, switchTransport = null, permissionsChecker = null, environment = process.env, adoptionWriter = null, plainTextInstaller = null, ciEstimator = null, ciReaders = null } = {}) {
    this.#proposals = new GovernanceProposals({ registryOptions, ...(cloudWorkflows ? { cloudWorkflows } : {}), transport: proposalTransport || (registryOptions.testOnly || process.env.TOOLKIT_GOVERNANCE_OFFLINE === '1' ? null : new GitHubProposalTransport()) });
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
    this.#appReader = appReader;
    this.#switchTransport = switchTransport || (registryOptions.testOnly || process.env.TOOLKIT_GOVERNANCE_OFFLINE === '1' ? null : new GitHubProposalTransport());
    // The sharded CI offer's minutes estimate (read-only gh) and the check that every pinned Toolkit copy
    // reads ci_shards; offline and in tests the estimate is unknown unless one is given.
    this.#ciEstimator = ciEstimator || (registryOptions.testOnly || process.env.TOOLKIT_GOVERNANCE_OFFLINE === '1' ? () => null : root => ciOffer.readEstimate(root));
    // The pinned copies are checked against the Toolkit git checkout (the managed one from a plugin copy).
    this.#ciReaders = ciReaders || (root => ciOffer.readersReady(root, require('./toolkit-cloud-workflows.cjs').sourceRoot()));
    this.#permissionsChecker = permissionsChecker || defaultPermissionsChecker;
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
      if (command === 'publish') return this.#publish(json, requestedRun);
      if (command === 'setup' || command === 'refresh') {
        const code = await this.#bank(json, answers, ticket);
        // Every output that follows an answer ends with the one Agents line (the bank's own has its own).
        if (answers !== null) this.#stdout.write(`\n${governanceBank.AGENTS_AFTER_ANSWER}\n`);
        return code;
      }
      return await this.#decide(command, json);
    } catch (error) {
      const [text, code] = PROPOSAL_ERRORS[error.code] ? [PROPOSAL_ERRORS[error.code], 2]
        : error.code === 'PROPOSAL_ADOPTION_INCOMPLETE' ? [ADOPTION_NOT_READY, 2]
          : error instanceof GovernanceCliError ? [error.message, error.exitCode]
            : [`Toolkit governance stopped because of an unexpected problem (${error?.name || 'Error'}${error?.code ? ` ${error.code}` : ''}). The operation did not finish or could not be verified. Read back its result before retrying.`, 2];
      this.#stderr.write(`${text}\n${answers !== null ? `\n${governanceBank.AGENTS_AFTER_ANSWER}\n` : ''}`);
      return code;
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
    const task = state.state === 'ENABLED' && state.root ? this.#taskSwitch(state.root) : null;
    if (task) lines.push(...task.lines);
    let hooks = null;
    try { hooks = this.#hookReader(); } catch { hooks = null; }
    if (hooks) lines.push(...hookCapability.describeHooks(hooks));
    else lines.push('Hooks: could not be checked on this computer.');
    let queue = null;
    try { queue = state.root ? this.#queueReader(state.root) : null; } catch { queue = null; }
    if (queue && queue.count > 0) lines.push(`Queue: ${queue.count} turn${queue.count === 1 ? '' : 's'} waiting (oldest ${String(queue.oldest).slice(0, 10)}); they are written at the next turn end that can reach GitHub, and dropped unwritten after seven days.`);
    const extra = { ...(task ? { task_auto_merge: task.value } : {}), ...(pending ? { pending } : {}), ...(reason ? { refresh: { refreshed: false, reason: refresh.error } } : {}), ...(hooks ? { hooks: hooks.hosts } : {}), ...(queue ? { queue } : {}) };
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
    }).finish(state.root || this.#cwd);
    const lines = said.split('\n').map(line => line.trim()).filter(Boolean);
    if (outcome.result === 'not-ready') {
      finishing.touch(this.#registryOptions, state.repository_id);
      this.#print(json, { result: 'not-ready' }, ['Not finished yet: the turn-on pull request is not merged and read back here. Nothing was changed; the next session tries again.']);
      return 0;
    }
    const recorded = finishing.record(this.#registryOptions, state.repository_id, outcome);
    this.#print(json, { result: outcome.result, on: outcome.on, unavailable: outcome.unavailable, held: outcome.held }, [...lines, recorded?.line || '']);
    return outcome.result === 'done' ? 0 : 2;
  }

  // Publication uses only a live receipt from an accepted owner answer.
  // `switches` are the task_prs members the owner's answer sets ({ auto_merge, merge_train }), or null.
  // `bank` is true only when the governance question bank publishes its own answer: a yes from anywhere
  // else (an agent's publish --run) is refused, so no turn-on pull request is ever built by hand.
  // `shards` is the ci_shards value a turn-on answer records ({ answer, offered_at }), or null, and
  // `app` the bank's governance App answer ('setup' or 'keep'), or null outside the bank.
  #publish(json, suppliedRun = null, switches = null, adopted = null, bank = false, shards = null, app = null) {
    const pending = this.#proposals.pending(this.#cwd, { sessionId: process.env.TOOLKIT_HOST_SESSION || process.env.CODEX_THREAD_ID,
      epoch: new gate.SessionEpochs({ registryOptions: this.#registryOptions }).get(process.env.TOOLKIT_HOST_SESSION || process.env.CODEX_THREAD_ID) });
    const run = suppliedRun || (pending?.kind === 'preparing' ? pending.run : null);
    if (!run) throw new GovernanceCliError(pending?.text || 'No pending owner answer for this run. Ask the owner in this chat; an agent cannot answer for them.');
    if (!bank && this.#proposals.answerFor(this.#cwd, run) === 'yes') throw new GovernanceCliError(`${BANK_ONLY} Run ${CMD('setup')} and show the owner its bank; build nothing by hand. Nothing was written.`);
    let binding = adopted ? adopted.binding : null;
    if (!adopted) try { binding = JSON.parse(fs.readFileSync(path.join(this.#cwd, governance.BINDING_FILE), 'utf8')); } catch { /* prepare explains missing adoption */ }
    // setup governance asks the switch with yes; it joins the same proposal, never a local file.
    if (switches && binding && typeof binding === 'object') binding = { ...binding, task_prs: { ...(binding.task_prs || {}), ...switches } };
    if (shards && binding && typeof binding === 'object') binding = { ...binding, ci_shards: shards };
    const result = this.#proposals.publish(this.#cwd, run, binding, bank);
    // A bank turn-on is finished after its merge: protection, rulesets and security settings.
    if (bank && result.proposal?.answer === 'yes') {
      try { finishing.markPending(this.#registryOptions, this.#state().repository_id, { proposal: result.proposal.number }); } catch { /* the owner can run migrate */ }
    }
    const turnOn = bank && result.proposal?.answer === 'yes';
    if (turnOn) this.#turnOnUrl = result.proposal.url;
    this.#print(json, result, [...(turnOn ? turnOnSummary(result, binding) : [result.text]), ...(result.warning ? [result.warning] : []), ...(switches ? [governance.taskSwitchVersionLine()] : []), ...this.#appLines(result.proposal, binding, app)]);
    return 0;
  }

  // How the governance App's variable and secret are read.
  #appRead() {
    return { reader: this.#appReader || governanceApp.ghReader,
      offline: !this.#appReader && (this.#registryOptions.testOnly === true || process.env.TOOLKIT_GOVERNANCE_OFFLINE === '1') };
  }

  // The governance App steps that follow a published decision: setup for yes, removal for no. A yes
  // from the bank answered the App row already: Set up prints the owner's command after the bank's
  // other steps, so only Keep current (not now) says anything here.
  #appLines(proposal, binding, app = null) {
    if (proposal.answer === 'yes' && app === 'setup') return [];
    if (proposal.answer === 'yes' && app === 'keep') return [`Governance GitHub App: not now. Governance works without it; run ${CMD('check')} to see how to add it later.`];
    const slug = proposal.repository;
    const read = this.#appRead();
    const state = governanceApp.presence(slug, read);
    // The owner type picks the App page, so it is read only when the setup steps will show.
    if (proposal.answer === 'yes') return governanceApp.setupLines(slug, binding?.store?.repository || null, state,
      state.variable === 'found' || state.secret === 'found' ? null : governanceApp.ownerType(slug, read));
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

  // The repository's merge-train switch, as merged and read back on this computer.
  #trainSwitch(root) {
    const train = governance.mergeTrain(root, this.#registryOptions);
    return { value: train.on ? 'on' : 'off', fresh: train.fresh };
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
    const proposal = { ...parsed, task_prs: { ...(parsed.task_prs || {}), ...changes } };
    if (governance.bindingProblems(proposal, identity).length) throw new GovernanceCliError('The changed binding would not be valid, so no pull request was prepared. Nothing was written.');
    try {
      return this.#switchTransport.publishSwitch(proposal.repository, entry.text, switchText(entry.text, parsed, changes), changes);
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
  // blocks. In the owner's own terminal it shows the bank and reads the reply there.
  async #bank(json, answers, ticket) {
    this.#refresh(this.#cwd);
    const state = this.#state();
    if (state.rule === 'ERROR' || state.state === 'ERROR') throw new GovernanceCliError(`The governance state could not be read (${state.error_code || 'ERROR'}). Nothing was written.`);
    if (['R1', 'R8', 'S1', 'R1s'].includes(state.rule)) {
      this.#print(json, { state: state.state, writes: 0 }, ['GitHub governance is off automatically here; there is nothing to set up.', ...describe(state).slice(2)]);
      return 0;
    }
    if (state.state === 'ENABLED' && !state.programme_records_bind) {
      this.#print(json, { state: state.state, writes: 0 }, [`Nothing changed. The binding merged on the default branch could not be read again just now; run ${CMD('status')} online first.`]);
      return 1;
    }
    // The open governance pull requests are read again first, so one closed outside Toolkit no longer
    // reads as pending (it would hold the turn-on with a misleading "not ready" line).
    if (state.state === 'UNDECIDED' && this.#proposalsLive) this.#proposals.refresh(this.#cwd);
    const merged = state.state === 'ENABLED' ? governance.mergedBinding(state.root, this.#registryOptions) : null;
    const task = state.state === 'ENABLED' && state.root ? this.#taskSwitch(state.root) : null;
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
    if (offered) { try { estimate = this.#ciEstimator(state.root); } catch { estimate = null; } }
    const ciShards = offered ? { estimate: ciOffer.estimateText(estimate), measured: estimate } : null;
    this.#lastCiEstimate = estimate;
    const train = state.state === 'ENABLED' && state.root ? this.#trainSwitch(state.root) : null;
    // The App row reads its variable and secret only where governance is on or can be turned on here.
    const app = state.state !== 'DISABLED' && state.repository ? governanceApp.presence(state.repository, this.#appRead()) : null;
    const specs = governanceBank.governanceBankSpecs({ state, task: task ? task.value : 'unset', train: train ? train.value : 'off', merged, permissions, adoption, ciShards, app });
    const reference = governanceBank.bankReference(specs);
    if (answers === null) {
      if (json) { this.#print(true, { state: state.state, bank_reference: reference, questions: specs }, []); return BANK_SHOWN; }
      if (this.#interactive) {
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
          return this.#applyBank(state, task, chosen, found, permissions, train);
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
    const again = lines => this.#again(sessionId, entry, specs, lines);
    if (entry.bank_reference !== reference) {
      const changed = governanceBank.changedRows(entry.rows, specs);
      if (!changed) {
        this.#print(false, {}, ['The governance bank changed since it was shown (rows were added or taken away), so the answer was not used and nothing was written. Type toolkit governance to see the new bank.']);
        return 0;
      }
      return again(['The governance state changed since that bank was shown, so the answer was not used and nothing was written.', ...changed]);
    }
    const explain = governanceBank.explainRequest(answers);
    if (explain) return again([governanceBank.explainText(specs, explain) || `This bank has no row ${explain}.`, '']);
    let chosen;
    try { chosen = governanceBank.parseBankAnswer(answers, specs); }
    catch (error) { return again([`${error.message} Nothing was written.`]); }
    return this.#applyBank(state, task, chosen, found, permissions, train);
  }

  // A reply that could not be used: its lines and the one reply line, and the bank noted again for
  // this run so the owner's next own message answers it.
  #again(sessionId, entry, specs, lines) {
    let noted = false;
    try { noted = new governanceBank.BankTickets({ registryOptions: this.#registryOptions }).rearm(sessionId, entry, { bankReference: governanceBank.bankReference(specs), rows: governanceBank.rowDigests(specs) }); } catch { noted = false; }
    this.#print(false, {}, [...lines, noted ? governanceBank.REPLY_AGAIN : 'Toolkit could not keep this bank open for another reply (its user-state folder could not be written). Type toolkit governance to see it again.']);
    return BANK_SHOWN;
  }

  #lastCiEstimate = null;
  // The turn-on pull request the bank published in this run, for its closing line.
  #turnOnUrl = null;

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
    const switched = Object.keys(changes).length ? { ...parsed, task_prs: { ...(parsed.task_prs || {}), ...changes } } : parsed;
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
      const base = Object.keys(changes).length ? switchText(entry.text, parsed, changes) : entry.text;
      prepared = this.#switchTransport.publishCiShards(proposal.repository, entry.text, ciOffer.ciShardsText(base, switched, value), answer, list, changes);
    } catch (error) {
      throw new GovernanceCliError(error.code === 'SWITCH_BASE_CHANGED'
        ? `The binding on the default branch changed since this computer read it. Run ${CMD('status')}, then ask again. Nothing was written.`
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

  // The owner's answer: at most one governance pull request, then the permission blocks.
  #applyBank(state, task, chosen, found = null, permissions = { checked: false }, train = null) {
    let code = 0;
    let acted = false;
    let commanded = 0;
    this.#turnOnUrl = null;
    const switchTo = chosen.taskAutoMerge === 'on' ? 'after-gates' : chosen.taskAutoMerge === 'off' ? 'off' : null;
    const trainTo = chosen.mergeTrain === 'on' || chosen.mergeTrain === 'off' ? chosen.mergeTrain : null;
    // Turning governance on writes both switches as the bank showed them: a sub-option is off until
    // the owner turns it on, so an unanswered one is written off rather than left to its default.
    const enabling = { auto_merge: switchTo || 'off', merge_train: trainTo || 'off' };
    let shardsDone = false;
    const app = chosen.governanceApp === 'setup' ? 'setup' : 'keep';
    let store = state.state === 'ENABLED' ? governance.mergedBinding(state.root, this.#registryOptions)?.store?.repository || null : null;
    if (chosen.governance === 'on' && state.state !== 'ENABLED' && found?.status === 'pending') {
      // A governance pull request is already open: it is the one to merge or close, never a second.
      const open = this.#proposals.pending(this.#cwd)?.proposals || [];
      this.#print(false, {}, [open.length
        ? `A governance pull request is already open, so no second one was prepared: ${open.map(item => `${item.url} (turns governance ${item.answer === 'yes' ? 'on' : 'off'})`).join(', ')}. Merge it, or close it and answer again. Nothing was written.`
        : `${String(found.reason).replace(/^Toolkit: /, '')} Nothing was written.`]);
      return open.length ? 0 : 2;
    }
    if (chosen.governance === 'on' && state.state !== 'ENABLED') {
      const plan = found ? adopt.adoptionPlan(found, { newStore: chosen.evidenceStore === 'new' }) : null;
      if (plan && plan.blocked) this.#print(false, {}, [`GitHub could not be read (${plan.blocked}), so the evidence store and parent issue could not be found or made.`]);
      if (plan && !plan.blocked) store = plan.store.repository;
      else if (!found && adopt.adoptionPrepared(state.root)) {
        try { store = JSON.parse(fs.readFileSync(path.join(state.root, governance.BINDING_FILE), 'utf8')).store?.repository || null; } catch { /* no --store */ }
      }
      // A shards yes or never joins the one turn-on pull request.
      const shards = ['yes', 'never'].includes(chosen.ciShards) ? this.#turnOnShards(state.root, chosen.ciShards) : null;
      shardsDone = Boolean(shards);
      code = plan && !plan.blocked ? this.#adoptAndPropose(state, plan, enabling, shards, app)
        : !found && adopt.adoptionPrepared(state.root) ? this.#preparedAndPropose(state, enabling, shards, app) : this.#prepareDecision('yes', enabling, null, shards, app);
      acted = true;
    } else if (chosen.governance === 'off' && state.state !== 'DISABLED') {
      code = this.#prepareDecision('no', null);
      acted = true;
    } else if (state.state === 'ENABLED') {
      const changes = {};
      if (switchTo && task && switchTo !== task.value) changes.auto_merge = switchTo;
      if (trainTo && train && trainTo !== train.value) changes.merge_train = trainTo;
      // A shards yes or never in the same answer joins the switch change: one binding pull request.
      if (Object.keys(changes).length && ['yes', 'never'].includes(chosen.ciShards)) {
        const { prepared, lines } = this.#prepareCiShards(state.root, chosen.ciShards, changes);
        this.#print(false, {}, [`Prepared ${prepared.url}: it sets ${[...(changes.auto_merge ? [`task auto-merge ${changes.auto_merge === 'after-gates' ? 'on' : 'off'}`] : []), ...(changes.merge_train ? [`merge trains ${changes.merge_train}`] : [])].join(' and ')} and records parallel CI shards as ${chosen.ciShards === 'yes' ? 'yes' : 'never ask'} (ci_shards) in the binding. It applies only after you merge it.`, ...lines, governance.taskSwitchVersionLine()]);
        acted = true;
        shardsDone = true;
      } else if (Object.keys(changes).length) {
        const prepared = this.#prepareSwitch(state.root, changes);
        const said = [
          ...(changes.auto_merge ? [`task auto-merge ${changes.auto_merge === 'after-gates' ? 'on' : 'off'}`] : []),
          ...(changes.merge_train ? [`merge trains ${changes.merge_train}`] : []),
        ];
        this.#print(false, {}, [`Prepared ${prepared.url}: it sets ${said.join(' and ')} and changes nothing else. It applies only after you merge it.`, governance.taskSwitchVersionLine()]);
        acted = true;
      }
    }
    // Parallel CI shards on their own: yes or never is one binding pull request; not now writes nothing
    // and says nothing (it is also what a reply that leaves the row out takes), and the question comes
    // back at the next refresh.
    if (!shardsDone && state.state === 'ENABLED' && chosen.governance !== 'off' && ['yes', 'never'].includes(chosen.ciShards)) {
      const { prepared, lines } = this.#prepareCiShards(state.root, chosen.ciShards);
      this.#print(false, {}, [`Prepared ${prepared.url}: it records parallel CI shards as ${chosen.ciShards === 'yes' ? 'yes' : 'never ask'} (ci_shards) in the binding. It applies only after you merge it.`, ...lines, governance.taskSwitchVersionLine()]);
      acted = true;
    }
    if (chosen.permissionBlocks !== 'keep') {
      const command = permissions.checked ? permissions[chosen.permissionBlocks] : null;
      if (command) commanded += 1;
      const app = governanceBank.APP_NAMES[permissions.host] || 'this app';
      this.#print(false, {}, command
        ? ['', `Toolkit permissions (${app}): run this once in your own PowerShell or terminal, outside any agent. It shows what changes, backs up the settings file and waits for you to press Enter.`, '', command]
        : ['', 'Toolkit permissions: Toolkit could not read where this app keeps them, so there is no command to give. Run setup toolkit, then toolkit governance again.']);
      acted = true;
    }
    // The governance App command, next to the permissions command; only the owner runs it. Set up is
    // recommended, so an answer that leaves governance off takes it too: it then gives no command.
    const governedAfter = chosen.governance === 'on' || (state.state === 'ENABLED' && chosen.governance !== 'off');
    if (chosen.governanceApp === 'setup' && !governedAfter) this.#print(false, {}, ['Governance App: not set up, because governance is not on after this answer.']);
    if (chosen.governanceApp === 'setup' && governedAfter && code === 0 && state.repository) {
      this.#print(false, {}, ['', `Governance App: run this once in your own PowerShell or terminal, outside any agent, with gh signed in. You click Create on GitHub; it saves the App's Client ID and key on ${state.repository}, opens the install page and checks the installation.`, '',
        `node "${APP_SETUP_SCRIPT}" --repo ${state.repository}${store ? ` --store ${store}` : ''}`]);
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

  // The ci_shards value a turn-on answer records, or null when it is held. For yes it adds a first shard
  // list to the working tree where there is none, so the list and the shard workflows rendered from it
  // travel in the same turn-on pull request (as the plain-text check files do).
  #turnOnShards(root, answer) {
    const ready = this.#ciReaders(root);
    if (!ready.ok) {
      this.#print(false, {}, [`Parallel CI shards: held, because ${ready.reason}. Nothing was written for them; answer them again at the next refresh.`]);
      return null;
    }
    const lines = [];
    const manifest = path.join(root, ...governedShards.MANIFEST_REL.split('/'));
    if (answer === 'yes' && fs.existsSync(manifest)) lines.push(`Parallel CI shards: ${governedShards.MANIFEST_REL} is already here, so the turn-on pull request carries it.`);
    else if (answer === 'yes') {
      const first = ciOffer.firstList(root, this.#lastCiEstimate);
      if (first.ok) {
        fs.mkdirSync(path.dirname(manifest), { recursive: true });
        fs.writeFileSync(manifest, first.text);
        lines.push(`Parallel CI shards: a first ${governedShards.MANIFEST_REL} with ${first.shards} Linux shards running node --test was added to the working tree and travels in the turn-on pull request with the shard workflows; Shard Timings rebalances them from measured times.`);
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
      adopted = adopt.adopt({ root: state.root, plan, writer: this.#adoptionWriter, switches, ...(this.#plainTextInstaller ? { plainText: () => this.#plainTextInstaller(state.root) } : {}) });
    } catch (error) {
      if (!(error instanceof adopt.AdoptError)) throw error;
      this.#print(false, {}, [`${error.message} No pull request was prepared.`,
        error.made.length ? `Already made, and reused when you answer again: ${error.made.join(', ')}.` : 'Nothing was made on GitHub.',
        'Show the bank again with toolkit governance and answer it once the cause is fixed.']);
      return 2;
    }
    const lines = [...adopted.lines];
    if (adopted.made.length) lines.push(`Made on GitHub: ${adopted.made.join(', ')}.`);
    if (lines.length) this.#print(false, {}, lines);
    return this.#prepareDecision('yes', switches, adopted, shards, app);
  }

  // A repository whose programme file is prepared in the working tree: the same CI checks as a fresh
  // one, then the one turn-on pull request.
  #preparedAndPropose(state, switches, shards = null, app = null) {
    let ready;
    try {
      ready = adopt.prepared({ root: state.root, ...(this.#plainTextInstaller ? { plainText: () => this.#plainTextInstaller(state.root) } : {}) });
    } catch (error) {
      if (!(error instanceof adopt.AdoptError)) throw error;
      this.#print(false, {}, [`${error.message} No pull request was prepared.`]);
      return 2;
    }
    if (ready.lines.length) this.#print(false, {}, ready.lines);
    return this.#prepareDecision('yes', switches, ready, shards, app);
  }

  // One governance decision pull request from the owner's bank answer (the ticket or the owner's own
  // terminal is the proof); it applies only after the owner merges it. `adopted` carries the binding
  // for a fresh repository.
  #prepareDecision(answer, switches, adopted = null, shards = null, app = null) {
    const before = this.#state();
    if (before.merged?.fresh && (before.rule === 'M1' && answer === 'yes' || before.rule === 'M2' && answer === 'no')) {
      this.#print(false, {}, ['Already ' + before.state.toLowerCase() + ' on the default branch. Nothing was written.']);
      return 0;
    }
    const sessionId = 'bank-' + crypto.randomBytes(16).toString('hex'), epoch = crypto.randomBytes(16).toString('hex');
    const request = this.#proposals.request(this.#cwd, answer, { sessionId, epoch });
    try { return this.#publish(false, request.run, switches, adopted, true, shards, app); }
    catch (error) {
      this.#print(false, {}, [
        PROPOSAL_ERRORS[error.code] || (error.code === 'PROPOSAL_ADOPTION_INCOMPLETE' ? ADOPTION_NOT_READY : 'Proposal publication is unverified (' + (error.code || 'PROPOSAL_UNAVAILABLE') + '). Check GitHub access and matching open proposals before retrying. No local governance decision was written.')]);
      return 2;
    }
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
    // Yes in the owner's own terminal opens the full governance question bank there, the one route
    // that turns governance on.
    if (command === 'enable') return this.#bank(json, null, null);
    const answer = 'no';
    if (before.merged?.fresh && before.rule === 'M2') {
      this.#print(json, { state: before.state, writes: 0 }, ['Already ' + before.state.toLowerCase() + ' on the default branch. Nothing was written.']);
      return 0;
    }
    this.#stderr.write(`${ownerTerminal.facts([['Turns off', 'repository governance, on every computer'], ['Applies', 'only after the owner merges the pull request']])}\n`);
    if (await this.#confirm('prepare that pull request') !== true) {
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

// The owner's governance App setup command (it refuses under an agent).
const APP_SETUP_SCRIPT = path.join(__dirname, 'toolkit-governance-app-setup.cjs');

// Command output can sit folded away in the app, so the agent repeats the command in its reply. Only
// the owner runs it (toolkit-permissions-apply.cjs refuses under an agent).

// This app's Toolkit permission lines, read from the settings files the blocks name: how many are
// missing or stale, and the owner's one command that brings them up to date or takes them out. Only
// the app the bank runs in is read; another app keeps its own lines.
function defaultPermissionsChecker(root) {
  const host = detectAgentHost() === 'codex' ? 'codex' : 'claude';
  const { PermissionBlocks, applyLine } = require('./toolkit-permissions.cjs');
  const owner = new PermissionBlocks();
  const built = owner.build({ host, scope: host === 'claude' ? 'all' : 'computer', repoRoot: root });
  let missing = 0;
  let stale = 0;
  for (const block of built.blocks) {
    if (host === 'codex') {
      const { ruleKeys } = require('./toolkit-permissions-apply.cjs');
      let text = null;
      try { text = fs.readFileSync(block.target, 'utf8'); } catch { text = null; }
      const have = ruleKeys(text);
      const want = ruleKeys(block.text);
      missing += want.filter(key => !have.includes(key)).length;
      stale += have.filter(key => !want.includes(key)).length;
    } else if (!fs.existsSync(block.target)) missing += block.allow.length + block.ask.length;
    else {
      const report = owner.check(block.target, { blocks: [block] })[0];
      missing += report.missing.length;
      stale += report.stale.length + report.stale_ask.length;
    }
  }
  return { checked: true, host, missing, stale, update: applyLine(built, '--apply', host).command, remove: applyLine(built, '--remove', host).command };
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
