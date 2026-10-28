#!/usr/bin/env node
'use strict';

// `toolkit governance`: see and decide whether Toolkit governs the repository you are in.
// Shown to people as `toolkit governance <command>`; run as
//   node <Toolkit checkout>/repo/scripts/toolkit-governance.cjs <command>
//
//   status      the repository's governance state and which rules apply
//   enable      record that you want Toolkit governance here (asks you to confirm)
//   disable     record that you do not (asks you to confirm); Toolkit stops asking.
//               `decline` is kept as the older word for it.
//   reopen      changes nothing: says what was decided and which command changes it
//   check       read-only conformance report; exit 0 conformant, 1 drift or pending, 2 error
//   catalogue   the skills offered in this repository's state
//   security    turns on this governed repository's free Dependabot and security settings and
//               writes its missing Dependabot files (on by default under governance, so it asks
//               nothing; never a GitHub feature that needs billing); exit 0 done, 1 not
//               governed, 2 failed or unverified
//   migrate     one pass over the repositories in --root folders (default: this folder): one
//               list, one typed yes, then offers to add missing no-force-push rulesets and
//               Toolkit's default-branch ruleset, each after its own typed yes, and turns on
//               each governed repository's dependency and security settings as `security` does
//   repair      when your governance decisions file cannot be read: moves it aside (kept next to
//               it) after you type yes, so Toolkit can ask about each repository again
//
// `--json` prints the machine-readable result instead. `check --offline` skips the network
// reads (the no-force-push ruleset and the default branch's protection, asked of GitHub through
// `gh`); the workflow files are still read. `security` writes the repository's GitHub settings and
// Dependabot files only for an ENABLED repository with a binding. Otherwise only `enable`, `disable`
// and `repair` write, only after you type yes in a terminal, and only to your own user-state file through
// toolkit-capability-registry.cjs. An agent running this without a terminal cannot record a
// decision. Enabling records consent only: the governed block and the programme binding still
// arrive in the repository through a pull request you approve.

const path = require('node:path');
const readline = require('node:readline');

const registry = require('./toolkit-capability-registry.cjs');
const governance = require('./toolkit-governance-state.cjs');
const conformance = require('./toolkit-governance-conformance.cjs');
const catalogue = require('./toolkit-governance-catalogue.cjs');
const gate = require('./toolkit-governance-gate.cjs');
const protection = require('./toolkit-governance-protection.cjs');
const security = require('./toolkit-governance-security.cjs');
const { GovernanceMigration, MigrationError, appendRunRecord } = require('./toolkit-governance-migration.cjs');

const CMD = subcommand => `\`${governance.governanceCommand(subcommand)}\``;

const CAPABILITY = governance.GOVERNANCE_CAPABILITY;
const COMMANDS = Object.freeze(['status', 'enable', 'disable', 'reopen', 'check', 'catalogue', 'migrate', 'repair', 'security']);
const ALIASES = Object.freeze({ decline: 'disable' });
const USAGE = `Usage: ${governance.governanceCommand('<status|enable|disable|reopen|catalogue|repair|security> [--json]')}\n`
  + `       ${governance.governanceCommand('check [--json] [--offline]')}\n`
  + `       ${governance.governanceCommand('migrate [--root <folder>]...')}\n`;

const RULES_TEXT = Object.freeze({
  ENABLED: 'Global rules and coding gates, plus GitHub governance: programme records, decision traces and evidence custody.',
  ENABLED_INCOMPLETE: 'Global rules and coding gates. GitHub governance starts once the governed block and the programme binding are both in the repository.',
  DISABLED: 'Global rules and coding gates, without GitHub governance. A governed block in AGENTS.md is not followed.',
  UNDECIDED: `GitHub governance is not decided yet. Toolkit asks in chat (yes, no or later) and records your reply; in your own terminal, ${CMD('enable')} or ${CMD('disable')} also works.`,
  NOT_GITHUB: `GitHub governance works only for github.com repositories, so it will be DISABLED here once you say ok. Toolkit asks in chat; in your own terminal, ${CMD('disable')} also works.`,
});

class GovernanceCliError extends Error {
  constructor(message, exitCode = 2) {
    super(message);
    this.name = 'GovernanceCliError';
    this.exitCode = exitCode;
  }
}

class ToolkitGovernanceCli {
  #stdout; #stderr; #ask; #interactive; #cwd; #registryOptions; #rulesetReader; #rulesetCreator; #protectionReader; #protectionWriter; #securityReader; #securityWriter; #securityFileWriter;

  // `ask(question)` resolves to the typed line; `interactive` says whether a person is at a
  // terminal. `registryOptions` ({ registryPath, testOnly: true }), `rulesetReader`,
  // `rulesetCreator`, `protectionReader`, `protectionWriter`, `securityReader`, `securityWriter` and
  // `securityFileWriter` are only for tests.
  constructor({ stdout = process.stdout, stderr = process.stderr, ask = terminalAsk, interactive = isInteractiveTerminal(), cwd = process.cwd(), registryOptions = {}, rulesetReader = null, rulesetCreator = null, protectionReader = null, protectionWriter = null, securityReader = null, securityWriter = null, securityFileWriter = null } = {}) {
    this.#stdout = stdout;
    this.#stderr = stderr;
    this.#ask = ask;
    this.#interactive = interactive === true;
    this.#cwd = cwd;
    this.#registryOptions = registryOptions;
    this.#rulesetReader = rulesetReader;
    this.#rulesetCreator = rulesetCreator;
    this.#protectionReader = protectionReader;
    this.#protectionWriter = protectionWriter;
    this.#securityReader = securityReader;
    this.#securityWriter = securityWriter;
    this.#securityFileWriter = securityFileWriter;
  }

  async main(argv) {
    const args = [...argv];
    const json = args.includes('--json');
    const offline = args.includes('--offline');
    const rest = args.filter(arg => arg !== '--json' && arg !== '--offline');
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
      if (command === 'migrate') {
        return await new GovernanceMigration({
          stdout: this.#stdout, ask: this.#ask, interactive: this.#interactive, registryOptions: this.#registryOptions,
          rulesetReader: this.#rulesetReader, rulesetCreator: this.#rulesetCreator,
          protectionReader: this.#protectionReader, protectionWriter: this.#protectionWriter,
          securityReader: this.#securityReader, securityWriter: this.#securityWriter, securityFileWriter: this.#securityFileWriter,
        }).run(roots.length ? roots : [this.#cwd]);
      }
      if (command === 'status') return this.#status(json);
      if (command === 'check') return this.#check(json, offline);
      if (command === 'catalogue') return this.#catalogue(json);
      if (command === 'security') return this.#security(json);
      if (command === 'reopen') return this.#reopen(json);
      if (command === 'repair') return await this.#repair(json);
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
    this.#print(json, state, describe(state, this.#registryOptions));
    return state.rule === 'ERROR' ? 2 : 0;
  }

  #check(json, offline) {
    const options = { ...this.#registryOptions, offline };
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
    if (state.rule === 'ERROR') throw new GovernanceCliError(`The governance state could not be read (${state.error_code}). ${governance.repairHint(state, this.#registryOptions)}`.trim());
    if (state.state !== 'ENABLED' || !state.materials || !state.materials.binding) {
      this.#print(json, { state: state.state, writes: 0 }, [`Nothing changed. Toolkit turns on dependency and security settings only in a governed repository with a programme binding; this one is ${label(state)}.`]);
      return 1;
    }
    const protectionOptions = this.#protectionReader ? { reader: this.#protectionReader } : {};
    const requiredChecks = governance.bindingRequiredChecks(state.root);
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
    if (state.rule === 'ERROR') throw new GovernanceCliError(`The governance state could not be read (${state.error_code}). ${governance.repairHint(state, this.#registryOptions)}`.trim());
    const lines = state.state === 'DISABLED'
      ? ['Nothing changed. You disabled Toolkit governance for this repository, so Toolkit does not ask about it.', `To turn it on, run ${CMD('enable')}. To keep it off, do nothing.`]
      : [`Nothing changed. This repository is ${label(state)}, so there is no disabled decision to reopen.`, state.state === 'ENABLED'
        ? `To turn governance off, run ${CMD('disable')}.`
        : `To decide, answer Toolkit's question in chat, or run ${CMD('enable')} or ${CMD('disable')} in your own terminal.`];
    this.#print(json, { state: state.state, writes: 0 }, lines);
    return 0;
  }

  // The terminal-only way out of a decisions file that cannot be read: it is moved aside, never
  // deleted, and only after the user types yes.
  async #repair(json) {
    const { file, problem } = governance.registryProblem(this.#registryOptions);
    if (!problem) {
      this.#print(json, { file, problem: null, writes: 0 }, [`Your governance decisions file reads fine (${file}); nothing to repair.`]);
      return 0;
    }
    if (!this.#interactive) throw new GovernanceCliError(`Nothing was moved: the repair runs only when you type yes in your own terminal. Your governance decisions file (${file}) could not be read (${problem}).`);
    const answer = String(await this.#ask(`Your governance decisions file could not be read (${problem}):\n  ${file}\nMove it aside (kept next to it, nothing deleted)? Toolkit then asks about each repository again.\nType yes to confirm: `) || '').trim().toLowerCase();
    if (answer !== 'yes') {
      this.#print(json, { file, problem, writes: 0 }, ['Not confirmed. Nothing was moved.']);
      return 1;
    }
    const aside = governance.moveRegistryAside(this.#registryOptions);
    this.#print(json, { file, problem, moved_to: aside, writes: 1 }, [`Moved aside to ${aside}. Toolkit asks about each repository again; the old file stays there if you need it.`]);
    return 0;
  }

  async #decide(command, json) {
    const before = this.#state();
    if (before.rule === 'R1') throw new GovernanceCliError('This folder is not inside a git repository, so GitHub governance is DISABLED automatically and there is nothing to decide.');
    const notGitHub = before.rule === 'R8' || before.rule === 'R9';
    if (notGitHub && command === 'enable') {
      throw new GovernanceCliError('GitHub governance works only for github.com repositories, and this one is not on github.com, so it cannot be enabled here. Nothing was written.');
    }
    if (!this.#interactive) {
      throw new GovernanceCliError(`Nothing was written: a governance decision is recorded only when you make it yourself. If you are an agent, ask the user in chat instead: "${notGitHub ? 'Reply ok to turn GitHub governance off for this repository.' : gate.ASK}" Toolkit records their own reply. If you are the user, run this in your own terminal.`);
    }
    if (notGitHub) return this.#notGitHubOk(before, json);
    const status = registry.getRepositoryStatus({ cwd: this.#cwd, ...this.#registryOptions });
    if (status.status === 'actionable') throw new GovernanceCliError(`Your governance decisions could not be read (${status.reason_code}). Nothing was written. ${governance.repairHint({ reason: 'registry-unreadable' }, this.#registryOptions)}`);
    const current = status.capabilities[CAPABILITY].state;
    // The registry keeps its own operation names: a first "no" is 'decline', turning off an enabled one is 'disable'.
    const operation = command === 'enable' ? 'enable' : current === 'enabled' ? 'disable' : 'decline';
    if ((command === 'enable' && current === 'enabled') || (command === 'disable' && current === 'disabled')) {
      this.#print(json, { state: before.state, writes: 0 }, [`Already ${command === 'enable' ? 'enabled' : 'disabled'} for this repository; no new decision was written.`]);
      return 0;
    }
    const question = command === 'enable'
      ? `Enable Toolkit's GitHub governance for ${before.root}?\nIt starts once the repository also carries the governed block and the programme binding, which arrive only through a pull request you approve.\nGitHub's free security settings (Dependabot alerts and updates, and on a public repository secret scanning, push protection, code scanning and private vulnerability reporting) are then turned on by default (on a private repository the update pull requests they open use your Actions minutes).\nType yes to confirm: `
      : `Turn off Toolkit's GitHub governance for ${before.root}?\nThe global rules and coding gates still apply here, and Toolkit will not ask again unless you run ${CMD('enable')}.\nType yes to confirm: `;
    const answer = String(await this.#ask(question) || '').trim().toLowerCase();
    if (answer !== 'yes') {
      this.#print(json, { state: before.state, writes: 0 }, ['Not confirmed. Nothing was written.']);
      return 1;
    }
    // One writer for the CLI and the prompt hold: the registry decision, read back through the same
    // gate every hook uses.
    let after;
    try {
      after = gate.writeGovernanceDecision(this.#cwd, command, { registryOptions: this.#registryOptions }).state;
    } catch (error) {
      throw new GovernanceCliError(`Your decision could not be recorded and read back (${error && error.code ? error.code : 'UNEXPECTED'}). Run ${CMD('check')}.`);
    }
    this.#print(json, after, [`Recorded. ${describe(after).join('\n')}`]);
    return 0;
  }
  // A repository not on github.com: the user's own ok, at their terminal, records DISABLED.
  async #notGitHubOk(before, json) {
    if (before.rule === 'R8') {
      this.#print(json, { state: before.state, writes: 0 }, ['Already disabled for this repository; nothing new was written.']);
      return 0;
    }
    const answer = String(await this.#ask(`Turn off Toolkit's GitHub governance for ${before.root}?\nIt works only for github.com repositories. The global rules and coding gates still apply here.\nType yes to confirm: `) || '').trim().toLowerCase();
    if (answer !== 'yes') {
      this.#print(json, { state: before.state, writes: 0 }, ['Not confirmed. Nothing was written.']);
      return 1;
    }
    let after;
    try {
      after = gate.writeNotGitHubOk(this.#cwd, { registryOptions: this.#registryOptions }).state;
    } catch (error) {
      throw new GovernanceCliError(`Your decision could not be recorded and read back (${error && error.code ? error.code : 'UNEXPECTED'}). Run ${CMD('check')}.`);
    }
    this.#print(json, after, [`Recorded. ${describe(after).join('\n')}`]);
    return 0;
  }
}

function label(state) {
  if (state.state === 'ENABLED' && state.materials_complete === false) return 'ENABLED (materials incomplete)';
  return state.state.replace(/_/g, ' ');
}

function describe(state, registryOptions = {}) {
  const hint = governance.repairHint(state, registryOptions);
  if (state.rule === 'ERROR') return [`State: UNDECIDED (the state could not be read: ${state.error_code}). Prompts in this repository are held until it can.`, ...(hint ? [hint] : [])];
  const key = state.rule === 'R9' ? 'NOT_GITHUB' : state.state === 'ENABLED' && state.materials_complete === false ? 'ENABLED_INCOMPLETE' : state.state;
  const lines = [`State: ${label(state)}`, `Rules: ${RULES_TEXT[key]}`];
  if (state.root) lines.push(`Repository: ${state.root}`);
  if (state.rule === 'R1') lines.push(`Folder: ${state.folder} (not a git repository, so DISABLED automatically).`);
  if (state.state === 'UNDECIDED' && state.rule === 'R6') lines.push('This repository carries the governed block but no programme binding yet.');
  if (state.state === 'UNDECIDED' && state.rule === 'R4') lines.push('This repository carries the governed block and programme binding; Toolkit still asks you, because files in a repository are not your answer.');
  if (state.rule === 'R8' || state.rule === 'R9') lines.push(`Not on github.com: ${state.host ? `this repository is on ${state.host}` : 'there is no single github.com origin remote'}. Toolkit asks about GitHub governance if the repository moves to github.com.`);
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
