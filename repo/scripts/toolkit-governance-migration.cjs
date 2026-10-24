'use strict';

// `toolkit governance migrate`: the one-time pass over the repositories already on this computer.
// It finds every repository in the given folders (each folder itself and the folders directly
// inside it), shows one list with a proposed answer per repository, and writes only after the
// user types yes in a terminal. Running it again changes nothing that is already decided.
//
// Proposals: a repository already decided stays as it is; a decision stored under an earlier
// key is carried over to the repository's own key; an evidence store named in another
// repository's programme binding is disabled; a repository carrying the governed block without
// a binding is enabled (its binding still arrives through a pull request); any other undecided
// repository is disabled, which the user can change in the same answer. Repositories without an
// origin remote are skipped.
//
// Afterwards, ENABLED GitHub repositories without the no-force-push ruleset are listed and the
// ruleset is added only after a second typed yes in the same run. Nothing is pushed to any
// repository and no pull request is opened: missing bindings and legacy markers are reported
// with what to do.

const fs = require('node:fs');
const path = require('node:path');

const registry = require('./toolkit-capability-registry.cjs');
const governance = require('./toolkit-governance-state.cjs');
const ruleset = require('./toolkit-governance-ruleset.cjs');

const CAPABILITY = governance.GOVERNANCE_CAPABILITY;
const RECORD_SCHEMA = 'toolkit.governance-migration.v1';
const RECORD_BASENAME = 'governance-migration.v1.json';
const BINDING_TEMPLATE = 'skills/repository-agent-rules/repo-local/toolkit-programme.template.json';

class MigrationError extends Error {
  constructor(message, exitCode = 2) {
    super(message);
    this.name = 'MigrationError';
    this.exitCode = exitCode;
  }
}

// Every git repository at `root` or directly inside it, sorted, each listed once.
function discoverRepositories(roots) {
  const found = new Map();
  const add = (dir) => {
    try {
      fs.lstatSync(path.join(dir, '.git'));
    } catch { return; }
    let key;
    try { key = fs.realpathSync(dir); } catch { key = path.resolve(dir); }
    if (!found.has(key)) found.set(key, path.resolve(dir));
  };
  for (const root of roots) {
    const resolved = path.resolve(root);
    add(resolved);
    let entries = [];
    try { entries = fs.readdirSync(resolved, { withFileTypes: true }); } catch { entries = []; }
    for (const entry of entries) if (entry.isDirectory() && entry.name !== '.git') add(path.join(resolved, entry.name));
  }
  return [...found.values()].sort((left, right) => left.localeCompare(right));
}

function slugFor(root) {
  try {
    const identity = governance.readIdentity(root);
    return identity.valid && governance.isGitHubHost(identity.remote.host) ? governance.remoteSlug(identity.remote) : null;
  } catch { return null; }
}

// The proposal for one repository: { action, reason } where action is keep, skip, carry-over,
// enable or disable.
function proposalFor(state, slug, transportSlugs) {
  if (state.rule === 'ERROR') return { action: 'skip', reason: `its state could not be read (${state.error_code})` };
  if (state.rule === 'R1') return { action: 'skip', reason: 'not a git repository, so GitHub governance is DISABLED automatically' };
  if (state.rule === 'R9') return { action: 'skip', reason: 'not on github.com, so GitHub governance is off here once the user says ok in chat' };
  if (state.recorded_under_legacy_key) return { action: 'carry-over', reason: `already ${state.recorded_decision === 'enabled' ? 'enabled' : 'disabled'} under an earlier key; kept under its own key` };
  if (state.state !== 'UNDECIDED') return { action: 'keep', reason: state.rule === 'R4' ? 'enabled by its governed block and binding' : `already ${state.state === 'ENABLED' ? 'enabled' : 'disabled'}` };
  if (slug && transportSlugs.has(slug.toLowerCase())) return { action: 'disable', reason: 'evidence store named in a programme binding (agent-managed, not governed)' };
  if (state.rule === 'R6') return { action: 'enable', reason: 'carries the governed block; its programme binding still has to be added' };
  return { action: 'disable', reason: 'no Toolkit materials' };
}

// "yes", optionally followed by changes such as "3=enable 5=disable" (`decline` is the older word
// for disable). null when not confirmed.
function parseAnswer(answer, rows) {
  const words = String(answer || '').trim().toLowerCase().split(/[\s,]+/).filter(Boolean);
  if (words[0] !== 'yes') return null;
  const changes = new Map();
  for (const word of words.slice(1)) {
    const match = /^(\d+)=(enable|disable|decline)$/.exec(word);
    if (!match) return null;
    const row = rows.find(entry => entry.number === Number(match[1]));
    if (!row || !['enable', 'disable', 'carry-over'].includes(row.action)) return null;
    changes.set(row.number, match[2] === 'enable' ? 'enable' : 'disable');
  }
  return changes;
}

class GovernanceMigration {
  #stdout; #ask; #interactive; #registryOptions; #rulesetReader; #rulesetCreator; #now;

  constructor({ stdout, ask, interactive, registryOptions = {}, rulesetReader = null, rulesetCreator = null, now = () => new Date() }) {
    this.#stdout = stdout;
    this.#ask = ask;
    this.#interactive = interactive === true;
    this.#registryOptions = registryOptions;
    this.#rulesetReader = rulesetReader;
    this.#rulesetCreator = rulesetCreator || ruleset.ghRulesetCreator;
    this.#now = now;
  }

  #say(lines) { this.#stdout.write(`${[].concat(lines).join('\n')}\n`); }

  plan(roots) {
    const repositories = discoverRepositories(roots).map(root => ({ root, state: governance.governanceState(root, this.#registryOptions), slug: slugFor(root) }));
    const transportSlugs = new Set(repositories
      .map(entry => governance.bindingStoreRepository(entry.root))
      .filter(Boolean).map(slug => slug.toLowerCase()));
    return repositories.map((entry, index) => ({ number: index + 1, ...entry, ...proposalFor(entry.state, entry.slug, transportSlugs) }));
  }

  async run(roots) {
    if (!this.#interactive) throw new MigrationError('Run this yourself in a terminal: the migration records decisions only when you type them. Nothing was written.');
    const rows = this.plan(roots);
    if (rows.length === 0) {
      this.#say('No git repositories were found in the given folders. Nothing was written.');
      return 0;
    }
    this.#say(['Repositories found:', ...rows.map(row => `${row.number}. ${row.root}: ${row.action} (${row.reason})`)]);
    const pending = rows.filter(row => ['carry-over', 'enable', 'disable'].includes(row.action));
    const written = [];
    if (pending.length === 0) {
      this.#say('Every repository is already decided or skipped. Nothing to migrate.');
    } else {
      const changes = parseAnswer(await this.#ask('Type yes to apply the proposed answers, or yes followed by changes such as "3=enable 5=disable": '), rows);
      if (changes === null) {
        this.#say('Not confirmed. Nothing was written.');
        return 1;
      }
      for (const row of pending) {
        const target = changes.get(row.number) || (row.action === 'carry-over' ? (row.state.recorded_decision === 'enabled' ? 'enable' : 'disable') : row.action);
        written.push(this.#decide(row, target));
      }
    }
    const after = rows.map(row => ({ ...row, state: governance.governanceState(row.root, this.#registryOptions) }));
    this.#reportMaterials(after);
    const rulesets = await this.#offerRulesets(after);
    if (written.length || rulesets.length) this.#writeRecord(written, rulesets);
    const failed = written.some(entry => entry.result !== 'written') || rulesets.some(entry => entry.result === 'failed');
    return failed ? 2 : 0;
  }

  #decide(row, target) {
    const status = registry.getRepositoryStatus({ cwd: row.root, ...this.#registryOptions });
    if (status.status === 'actionable') return { repository_id: row.state.repository_id, action: target, result: `not-written (${status.reason_code})` };
    const current = status.capabilities[CAPABILITY].state;
    // The registry keeps its own operation names: a first "no" is 'decline', turning off an enabled one is 'disable'.
    const operation = target === 'enable' ? 'enable' : current === 'unresolved' ? 'decline' : 'disable';
    try {
      registry.writeCapabilityDecision({
        cwd: row.root,
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
    } catch (error) {
      this.#say(`${row.number}. ${row.root}: not written (${error && error.code ? error.code : 'unexpected error'}).`);
      return { repository_id: status.repository_id, action: target, result: 'failed' };
    }
    const readBack = governance.governanceState(row.root, this.#registryOptions);
    const expected = target === 'enable' ? 'ENABLED' : 'DISABLED';
    const ok = readBack.state === expected && readBack.recorded_under_legacy_key === false;
    this.#say(`${row.number}. ${row.root}: ${ok ? `recorded ${expected}` : `written, but reading it back gave ${readBack.state}`}.`);
    return { repository_id: status.repository_id, action: target, result: ok ? 'written' : 'read-back-mismatch' };
  }

  #reportMaterials(rows) {
    const notes = [];
    for (const row of rows) {
      const state = row.state;
      if (state.state === 'ENABLED' && state.materials && !state.materials.binding) {
        notes.push(`${row.root}: governance is on but the programme binding is missing. Copy ${BINDING_TEMPLATE} to .github/toolkit-programme.json, fill in the parent issue and the evidence store${row.slug ? ` (repository: ${row.slug})` : ''}, and add it through a pull request.`);
      }
      if (state.state === 'ENABLED' && state.materials && !state.materials.governed_block) {
        notes.push(`${row.root}: governance is on but AGENTS.md has no governed block; install it with the repository-agent-rules skill, through a pull request.`);
      }
      if (state.materials && state.materials.governed_block_legacy) notes.push(`${row.root}: AGENTS.md carries the old GLOBAL-AGENTS.MD-TEMPLATE block; refresh it to the governed block through a pull request.`);
      if (state.materials && state.materials.legacy_binding_file) notes.push(`${row.root}: .github/ai-agent-toolkit-programme.json is an early binding name and is not read; move its values to .github/toolkit-programme.json through a pull request.`);
    }
    if (notes.length) this.#say(['To finish by hand:', ...notes.map(note => `- ${note}`)]);
  }

  async #offerRulesets(rows) {
    const enabled = rows.filter(row => row.state.state === 'ENABLED');
    const missing = [];
    for (const row of enabled) {
      const result = ruleset.noForcePushRuleset(row.root, this.#rulesetReader ? { reader: this.#rulesetReader } : {});
      if (result.status === 'missing') missing.push(row);
      else if (result.status === 'not-enforceable') this.#say(`${row.root}: GitHub cannot enforce a no-force-push ruleset here (private repository on GitHub Free); the local force-push guard is the fallback.`);
      else if (result.status === 'unverified') this.#say(`${row.root}: the no-force-push ruleset could not be checked (${result.reason}).`);
    }
    if (missing.length === 0) return [];
    this.#say(['These governed GitHub repositories have no ruleset blocking force pushes:', ...missing.map(row => `- ${row.slug} (${row.root})`)]);
    const answer = String(await this.#ask(`Add a "${ruleset.RULESET_NAME}" ruleset (every branch, no bypass) to these ${missing.length} repositories on GitHub? Type yes to confirm: `) || '').trim().toLowerCase();
    if (answer !== 'yes') {
      this.#say('Rulesets not added.');
      return [];
    }
    const results = [];
    for (const row of missing) {
      const created = this.#rulesetCreator(row.slug);
      const verified = created && created.ok ? ruleset.noForcePushRuleset(row.root, this.#rulesetReader ? { reader: this.#rulesetReader } : {}) : null;
      const ok = verified && verified.status === 'present';
      this.#say(`- ${row.slug}: ${ok ? 'ruleset added and read back' : `not added (${created && created.reason ? created.reason : 'read-back did not find it'})`}.`);
      results.push({ repository_id: row.state.repository_id, result: ok ? 'added' : 'failed' });
    }
    return results;
  }

  // One private record per run that changed something, next to the decision file.
  #writeRecord(decisions, rulesets) {
    const directory = path.dirname(governance.registryPathFor(this.#registryOptions));
    const file = path.join(directory, RECORD_BASENAME);
    let previous = [];
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && parsed.schema === RECORD_SCHEMA && Array.isArray(parsed.runs)) previous = parsed.runs;
    } catch { previous = []; }
    const record = { schema: RECORD_SCHEMA, runs: [...previous, { at: this.#now().toISOString(), decisions, rulesets }].slice(-20) };
    fs.mkdirSync(directory, { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, file);
  }
}

module.exports = Object.freeze({ GovernanceMigration, MigrationError, discoverRepositories, proposalFor, parseAnswer, RECORD_BASENAME, BINDING_TEMPLATE });
