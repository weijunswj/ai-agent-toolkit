#!/usr/bin/env node
'use strict';

// `toolkit governance`: see and decide whether Toolkit governs the repository you are in.
// Shown to people as `toolkit governance <command>`; run as
//   node <Toolkit checkout>/repo/scripts/toolkit-governance.cjs <command>
//
//   status      the repository's governance state and which rules apply
//   enable      record that you want Toolkit governance here (asks you to confirm)
//   decline     record that you do not (asks you to confirm); Toolkit stops asking
//   reopen      changes nothing: says what was decided and which command changes it
//   check       read-only conformance report; exit 0 conformant, 1 drift or pending, 2 error
//   catalogue   the skills offered in this repository's state
//   migrate     one pass over the repositories in --root folders (default: this folder): one
//               list, one typed yes, then an offer to add missing no-force-push rulesets
//
// `--json` prints the machine-readable result instead. `check --offline` skips the one network
// read (the repository's no-force-push ruleset, asked of GitHub through `gh`). Only `enable` and `decline` write, only
// after you type yes in a terminal, and only to your own user-state file through
// toolkit-capability-registry.cjs. An agent running this without a terminal cannot record a
// decision. Enabling records consent only: the governed block and the programme binding still
// arrive in the repository through a pull request you approve.

const path = require('node:path');
const readline = require('node:readline');

const registry = require('./toolkit-capability-registry.cjs');
const governance = require('./toolkit-governance-state.cjs');
const conformance = require('./toolkit-governance-conformance.cjs');
const catalogue = require('./toolkit-governance-catalogue.cjs');
const { GovernanceMigration, MigrationError } = require('./toolkit-governance-migration.cjs');

const CMD = subcommand => `\`${governance.governanceCommand(subcommand)}\``;

const CAPABILITY = governance.GOVERNANCE_CAPABILITY;
const COMMANDS = Object.freeze(['status', 'enable', 'decline', 'reopen', 'check', 'catalogue', 'migrate']);
const USAGE = `Usage: ${governance.governanceCommand('<status|enable|decline|reopen|catalogue> [--json]')}\n`
  + `       ${governance.governanceCommand('check [--json] [--offline]')}\n`
  + `       ${governance.governanceCommand('migrate [--root <folder>]...')}\n`;

const RULES_TEXT = Object.freeze({
  ENABLED: 'Global rules plus the Toolkit governed rules (gates, records and evidence custody).',
  ENABLED_INCOMPLETE: 'Global rules, coding gates, subagents and portable skills. The governed rules start once the governed block and the programme binding are both in the repository.',
  DECLINED: 'Global rules only. A governed block in AGENTS.md is not followed.',
  PORTABLE: 'Global rules only.',
  UNKNOWN: `Nothing yet: decide with ${CMD('enable')} or ${CMD('decline')}.`,
});

class GovernanceCliError extends Error {
  constructor(message, exitCode = 2) {
    super(message);
    this.name = 'GovernanceCliError';
    this.exitCode = exitCode;
  }
}

class ToolkitGovernanceCli {
  #stdout; #stderr; #ask; #interactive; #cwd; #registryOptions; #rulesetReader; #rulesetCreator;

  // `ask(question)` resolves to the typed line; `interactive` says whether a person is at a
  // terminal. `registryOptions` ({ registryPath, testOnly: true }), `rulesetReader` and
  // `rulesetCreator` are only for tests.
  constructor({ stdout = process.stdout, stderr = process.stderr, ask = terminalAsk, interactive = isInteractiveTerminal(), cwd = process.cwd(), registryOptions = {}, rulesetReader = null, rulesetCreator = null } = {}) {
    this.#stdout = stdout;
    this.#stderr = stderr;
    this.#ask = ask;
    this.#interactive = interactive === true;
    this.#cwd = cwd;
    this.#registryOptions = registryOptions;
    this.#rulesetReader = rulesetReader;
    this.#rulesetCreator = rulesetCreator;
  }

  async main(argv) {
    const args = [...argv];
    const json = args.includes('--json');
    const offline = args.includes('--offline');
    const rest = args.filter(arg => arg !== '--json' && arg !== '--offline');
    const command = rest[0];
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
      if (command === 'migrate') {
        return await new GovernanceMigration({
          stdout: this.#stdout, ask: this.#ask, interactive: this.#interactive, registryOptions: this.#registryOptions,
          rulesetReader: this.#rulesetReader, rulesetCreator: this.#rulesetCreator,
        }).run(roots.length ? roots : [this.#cwd]);
      }
      if (command === 'status') return this.#status(json);
      if (command === 'check') return this.#check(json, offline);
      if (command === 'catalogue') return this.#catalogue(json);
      if (command === 'reopen') return this.#reopen(json);
      return await this.#decide(command, json);
    } catch (error) {
      if (error instanceof GovernanceCliError || error instanceof MigrationError) {
        this.#stderr.write(`${error.message}\n`);
        return error.exitCode;
      }
      this.#stderr.write(`Toolkit governance stopped because of an unexpected problem (${error?.name || 'Error'}${error?.code ? ` ${error.code}` : ''}). Nothing was written.\n`);
      return 2;
    }
  }

  #state() { return governance.governanceState(this.#cwd, this.#registryOptions); }

  #print(json, value, lines) {
    this.#stdout.write(json ? `${JSON.stringify(value, null, 2)}\n` : `${lines.join('\n')}\n`);
  }

  #status(json) {
    const state = this.#state();
    this.#print(json, state, describe(state));
    return state.rule === 'ERROR' ? 2 : 0;
  }

  #check(json, offline) {
    const options = { ...this.#registryOptions, offline };
    if (this.#rulesetReader) options.rulesetReader = this.#rulesetReader;
    const result = conformance.checkConformance(this.#cwd, options);
    const lines = [`Conformance: ${result.status}`];
    if (result.state) lines.push(`State: ${label(result.state)}`);
    for (const entry of result.findings) lines.push(`- ${entry.severity}: ${entry.message}`);
    if (result.no_force_push_ruleset) lines.push(`No-force-push ruleset: ${result.no_force_push_ruleset.status}`);
    lines.push('Prompt-hold enforcement:');
    for (const [host, status] of Object.entries(result.enforcement)) lines.push(`- ${host}: ${status.status} (${status.reason})`);
    this.#print(json, result, lines);
    return result.exit_code;
  }

  #catalogue(json) {
    const state = this.#state();
    const skills = catalogue.catalogueForState(state);
    const lines = [`Skills offered in this repository (${label(state)}):`];
    if (skills.length === 0) lines.push(`- none until you decide with ${CMD('enable')} or ${CMD('decline')}`);
    for (const entry of skills) lines.push(`- ${entry.skill}${entry.tier === 'governed' ? ' (governed)' : ''}`);
    this.#print(json, { state: state.state, materials_complete: state.materials_complete, skills }, lines);
    return 0;
  }

  #reopen(json) {
    const state = this.#state();
    if (state.rule === 'ERROR') throw new GovernanceCliError(`The governance state could not be read (${state.error_code}).`);
    const lines = state.state === 'DECLINED'
      ? ['Nothing changed. You declined Toolkit governance for this repository, so Toolkit does not ask about it.', `To turn it on, run ${CMD('enable')}. To keep it off, do nothing.`]
      : [`Nothing changed. This repository is ${label(state)}, so there is no declined decision to reopen.`, state.state === 'ENABLED'
        ? `To turn governance off, run ${CMD('decline')}.`
        : `To decide, run ${CMD('enable')} or ${CMD('decline')}.`];
    this.#print(json, { state: state.state, writes: 0 }, lines);
    return 0;
  }

  async #decide(command, json) {
    const before = this.#state();
    if (before.state === 'PORTABLE') {
      throw new GovernanceCliError(before.reason === 'no-git-root'
        ? 'This folder is not inside a git repository, so there is nothing to decide.'
        : 'This repository has no usable origin remote, so a decision cannot be stored for it. Only the global rules apply.');
    }
    if (!this.#interactive) {
      throw new GovernanceCliError('Run this yourself in a terminal: a governance decision is recorded only when you type it. Nothing was written.');
    }
    const status = registry.getRepositoryStatus({ cwd: this.#cwd, ...this.#registryOptions });
    if (status.status === 'actionable') throw new GovernanceCliError(`Your governance decisions could not be read (${status.reason_code}). Nothing was written.`);
    const current = status.capabilities[CAPABILITY].state;
    const operation = command === 'enable' ? 'enable' : current === 'enabled' ? 'disable' : 'decline';
    if ((command === 'enable' && current === 'enabled') || (command === 'decline' && current === 'disabled')) {
      this.#print(json, { state: before.state, writes: 0 }, [`Already ${command === 'enable' ? 'enabled' : 'declined'} for this repository. Nothing was written.`]);
      return 0;
    }
    const question = command === 'enable'
      ? `Turn on Toolkit governance for ${before.root}?\nToolkit's governed rules apply once the repository also carries the governed block and the programme binding, which arrive only through a pull request you approve.\nType yes to confirm: `
      : `Decline Toolkit governance for ${before.root}?\nOnly the global rules will apply here, and Toolkit will not ask again unless you run ${CMD('enable')}.\nType yes to confirm: `;
    const answer = String(await this.#ask(question) || '').trim().toLowerCase();
    if (answer !== 'yes') {
      this.#print(json, { state: before.state, writes: 0 }, ['Not confirmed. Nothing was written.']);
      return 1;
    }
    registry.writeCapabilityDecision({
      cwd: this.#cwd,
      ...this.#registryOptions,
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
    // Read the decision back through the same reader every hook uses.
    const after = this.#state();
    const expected = command === 'enable' ? 'ENABLED' : 'DECLINED';
    if (after.state !== expected || after.repository_id !== status.repository_id) {
      throw new GovernanceCliError(`Your decision was written, but reading it back gave ${label(after)} instead of ${expected}. Run ${CMD('check')}.`);
    }
    this.#print(json, after, [`Recorded. ${describe(after).join('\n')}`]);
    return 0;
  }
}

function label(state) {
  if (state.state === 'ENABLED' && state.materials_complete === false) return 'ENABLED (materials incomplete)';
  return state.state;
}

function describe(state) {
  if (state.rule === 'ERROR') return [`State: UNKNOWN (the state could not be read: ${state.error_code}). Prompts in this repository are held until it can.`];
  const key = state.state === 'ENABLED' && state.materials_complete === false ? 'ENABLED_INCOMPLETE' : state.state;
  const lines = [`State: ${label(state)}`, `Rules: ${RULES_TEXT[key]}`];
  if (state.root) lines.push(`Repository: ${state.root}`);
  if (state.state === 'UNKNOWN' && state.rule === 'R6') lines.push('This repository carries the governed block but no programme binding yet.');
  if (state.state === 'ENABLED' && state.rule === 'R4') lines.push('The repository opted in and you have not declined.');
  if (state.state === 'PORTABLE' && state.reason !== 'no-git-root') lines.push('There is no usable origin remote, so no decision can be stored for this repository.');
  return lines;
}

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
