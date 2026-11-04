'use strict';

// `toolkit governance migrate`: the one-time pass over the repositories already on this computer.
// It finds every repository in the given folders (each folder itself and the folders directly
// inside it), shows one list with a proposed answer per repository, and writes only after the
// user types yes in a terminal. Running it again changes nothing that is already decided.
//
// Proposals: a repository already decided stays as it is; a decision stored under an earlier
// key is carried over to the repository's own key; an evidence store named in another
// repository's programme binding is disabled; a repository carrying the governed block (with or
// without its binding, which then still arrives through a pull request) is enabled; any other undecided
// repository is disabled, which the user can change in the same answer. Repositories without an
// origin remote are skipped.
//
// Afterwards, ENABLED GitHub repositories without the no-force-push ruleset are listed and the
// ruleset is added only after a second typed yes in the same run; one whose merged binding keeps
// programme state on the public state branch is then offered a ruleset that stops that branch being
// deleted, after its own typed yes. Then ENABLED GitHub repositories
// whose default branch does not require the binding's checks, or allows squash or rebase merges,
// are listed, and Toolkit's own default-branch ruleset (toolkit-governance-protection.cjs) is
// created or updated only after a third typed yes. Toolkit never edits a ruleset or branch
// protection it did not create: what its own ruleset cannot fix (an extra or unpinned check in
// someone else's rule, a workflow that can mask its check) is reported to change by hand, and a
// refused write is reported once, never retried. Last, each ENABLED GitHub repository gets its free
// dependency and security settings turned on and its missing Dependabot files written
// (toolkit-governance-security.cjs) without another question, because they are on by default under
// governance; nothing that needs billing is turned on. Files land in the working
// tree for a normal pull request. Nothing is pushed to any
// repository and no pull request is opened: missing bindings and legacy markers are reported
// with what to do.

const fs = require('node:fs');
const path = require('node:path');

const registry = require('./toolkit-capability-registry.cjs');
const governance = require('./toolkit-governance-state.cjs');
const ruleset = require('./toolkit-governance-ruleset.cjs');
const protection = require('./toolkit-governance-protection.cjs');
const security = require('./toolkit-governance-security.cjs');

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
  if (state.rule === 'R8') return { action: 'skip', reason: 'not on github.com, so GitHub governance is DISABLED automatically here' };
  if (state.state === 'ERROR') return { action: 'skip', reason: 'the programme binding merged on its default branch is invalid; fix it through a pull request' };
  if (state.rule === 'S1') return { action: 'skip', reason: 'evidence store named in a programme binding (agent-managed, not governed)' };
  if (state.rule === 'R1s') return { action: 'skip', reason: "a scratch clone in another repository's ignored .tmp folder (not governed)" };
  if (['M1', 'M2'].includes(state.rule)) return { action: 'keep', reason: `${state.state === 'ENABLED' ? 'enabled' : 'disabled'} by the programme binding merged on its default branch` };
  if (state.recorded_under_legacy_key) return { action: 'carry-over', reason: `already ${state.recorded_decision === 'enabled' ? 'enabled' : 'disabled'} under an earlier key; kept under its own key` };
  if (state.state !== 'UNDECIDED') return { action: 'keep', reason: `already ${state.state === 'ENABLED' ? 'enabled' : 'disabled'}` };
  if (slug && transportSlugs.has(slug.toLowerCase())) return { action: 'disable', reason: 'evidence store named in a programme binding (agent-managed, not governed)' };
  if (state.notes.includes('pending-binding-merge')) return { action: 'enable', reason: 'its working tree carries a programme binding that still has to be merged' };
  if (state.materials && state.materials.governed_block) return { action: 'enable', reason: 'carries the governed block; its programme binding still has to be added' };
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
  #stdout; #ask; #interactive; #registryOptions; #rulesetReader; #rulesetCreator; #stateRulesetCreator; #protectionReader; #protectionWriter; #securityReader; #securityWriter; #securityFileWriter; #now;

  constructor({ stdout, ask, interactive, registryOptions = {}, rulesetReader = null, rulesetCreator = null, stateRulesetCreator = null, protectionReader = null, protectionWriter = null, securityReader = null, securityWriter = null, securityFileWriter = null, now = () => new Date() }) {
    this.#stdout = stdout;
    this.#ask = ask;
    this.#interactive = interactive === true;
    this.#registryOptions = registryOptions;
    this.#rulesetReader = rulesetReader;
    this.#rulesetCreator = rulesetCreator || ruleset.ghRulesetCreator;
    this.#stateRulesetCreator = stateRulesetCreator || ruleset.ghKeepStateRulesetCreator;
    this.#protectionReader = protectionReader;
    this.#protectionWriter = protectionWriter || protection.ghProtectionRulesetWriter;
    this.#securityReader = securityReader;
    this.#securityWriter = securityWriter || security.ghSecurityWriter;
    this.#securityFileWriter = securityFileWriter || security.writeSecurityFiles;
    this.#now = now;
  }

  #say(lines) { this.#stdout.write(`${[].concat(lines).join('\n')}\n`); }

  plan(roots) {
    const repositories = discoverRepositories(roots).map(root => ({ root, state: governance.governanceState(root, this.#registryOptions), slug: slugFor(root) }));
    const transportSlugs = new Set(repositories
      .flatMap(entry => [governance.bindingStoreRepository(entry.root, this.#registryOptions), governance.workingBindingStoreRepository(entry.root)])
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
    const rulesets = [...await this.#offerRulesets(after), ...await this.#offerStateRulesets(after)];
    const protections = await this.#offerProtection(after);
    const securities = await this.#applySecurity(after);
    if (written.length || rulesets.length || protections.length || securities.length) this.#writeRecord(written, rulesets, protections, securities);
    const failed = written.some(entry => entry.result !== 'written') || [...rulesets, ...protections, ...securities].some(entry => ['failed', 'unverified'].includes(entry.result));
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
      if (state.state === 'ENABLED' && state.materials && !state.materials.binding && state.notes.includes('pending-binding-merge')) {
        notes.push(`${row.root}: governance is on and the working tree carries the programme binding, but it is not merged on the default branch yet; it applies once its pull request merges.`);
      } else if (state.state === 'ENABLED' && state.materials && !state.materials.binding) {
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

  // Repositories whose merged binding keeps programme state on the public state branch get a second
  // ruleset that stops anyone deleting that branch, after its own typed yes.
  async #offerStateRulesets(rows) {
    const reader = this.#rulesetReader ? { reader: this.#rulesetReader } : {};
    const missing = [];
    for (const row of rows.filter(entry => entry.state.state === 'ENABLED')) {
      const binding = governance.mergedBinding(row.root, this.#registryOptions);
      if (!binding || !binding.state) continue;
      const result = ruleset.keepStateRuleset(row.root, reader);
      if (result.status === 'missing') missing.push(row);
      else if (result.status === 'not-enforceable') this.#say(`${row.root}: GitHub cannot enforce a ruleset that keeps the programme state branch here (private repository on GitHub Free); the branch's checkpoint and restore are the fallback.`);
      else if (result.status === 'unverified') this.#say(`${row.root}: the ruleset that keeps the programme state branch could not be checked (${result.reason}).`);
    }
    if (missing.length === 0) return [];
    this.#say(['These governed GitHub repositories keep programme state on the branch ' + ruleset.STATE_BRANCH + ', and nothing stops it being deleted:', ...missing.map(row => `- ${row.slug} (${row.root})`)]);
    const answer = String(await this.#ask(`Add a "${ruleset.KEEP_STATE_RULESET_NAME}" ruleset (that branch only, no deletion, no bypass) to these ${missing.length} repositories on GitHub? Type yes to confirm: `) || '').trim().toLowerCase();
    if (answer !== 'yes') {
      this.#say('Programme state rulesets not added.');
      return [];
    }
    const results = [];
    for (const row of missing) {
      const created = this.#stateRulesetCreator(row.slug);
      const verified = created && created.ok ? ruleset.keepStateRuleset(row.root, reader) : null;
      const ok = verified && verified.status === 'present';
      this.#say(`- ${row.slug}: ${ok ? 'programme state ruleset added and read back' : `not added (${created && created.reason ? created.reason : 'read-back did not find it'})`}.`);
      results.push({ repository_id: row.state.repository_id, ruleset: 'keep-programme-state', result: ok ? 'added' : 'failed' });
    }
    return results;
  }

  #protectionFor(row) {
    const requiredChecks = governance.bindingRequiredChecks(row.root, this.#registryOptions);
    if (!requiredChecks) return null;
    return { requiredChecks, result: protection.defaultBranchProtection(row.root, { requiredChecks, ...(this.#protectionReader ? { reader: this.#protectionReader } : {}) }) };
  }

  // What Toolkit's own ruleset fixes: a binding check that is not required, squash or rebase
  // allowed, or an unpinned check in Toolkit's own ruleset.
  static #rulesetFixes(result) {
    if (result.status !== 'drift') return false;
    const { P1, P2, P5 } = result.checks;
    const own = result.toolkit_ruleset ? `ruleset ${result.toolkit_ruleset.id}` : null;
    return (P1 && P1.status === 'drift' && P1.missing.length > 0) || (P5 && P5.status === 'drift')
      || Boolean(own && P2 && P2.status === 'drift' && P2.details.some(detail => detail.includes(own)));
  }

  #byHand(row, result) {
    const notes = [];
    for (const id of ['P1', 'P2', 'P3', 'P4', 'P5']) {
      const check = result.checks[id];
      if (check && check.status === 'drift') notes.push(...check.details);
    }
    if (notes.length) this.#say([`${row.slug}: change by hand (Toolkit edits only its own ruleset):`, ...notes.map(note => `  - ${note}`)]);
  }

  async #offerProtection(rows) {
    const candidates = [];
    for (const row of rows.filter(entry => entry.state.state === 'ENABLED' && entry.slug)) {
      const read = this.#protectionFor(row);
      if (!read) continue;
      const { result } = read;
      if (result.status === 'not-enforceable') this.#say(`${row.root}: GitHub cannot protect the default branch here (private repository on GitHub Free).`);
      else {
        const unread = ['P1', 'P2', 'P5'].map(id => result.checks[id]).find(check => check && check.status === 'unverified');
        if (unread) this.#say(`${row.root}: default-branch protection could not be checked on GitHub (${unread.details.join('; ')}).`);
      }
      // A required check that no job produces would wait forever, and with no bypass that blocks
      // every merge, so such a repository is not offered the ruleset until its workflow is fixed.
      // The same goes for a check whose workflow does not report on every pull request.
      const unproduced = result.checks.P3 && Array.isArray(result.checks.P3.missing) ? result.checks.P3.missing : [];
      const silent = result.checks.P4 && Array.isArray(result.checks.P4.never_reports) ? result.checks.P4.never_reports.filter(check => !unproduced.includes(check)) : [];
      if (GovernanceMigration.#rulesetFixes(result) && unproduced.length === 0 && silent.length === 0) candidates.push({ row, ...read });
      else {
        if (GovernanceMigration.#rulesetFixes(result) && unproduced.length) this.#say(`${row.slug}: Toolkit ruleset not offered: no workflow job produces ${unproduced.map(check => `"${check}"`).join(', ')}, so requiring it would block every merge. Add the job, then run migrate again.`);
        if (GovernanceMigration.#rulesetFixes(result) && silent.length) this.#say(`${row.slug}: Toolkit ruleset not offered: ${silent.map(check => `"${check}"`).join(', ')} does not report on every pull request to the default branch, so requiring it would block those merges. Fix its workflow trigger, then run migrate again.`);
        this.#byHand(row, result);
      }
    }
    if (candidates.length === 0) return [];
    this.#say(['These governed GitHub repositories need default-branch protection:', ...candidates.flatMap(({ row, result }) => [
      `- ${row.slug} (${row.root})`,
      ...['P1', 'P2', 'P5'].flatMap(id => (result.checks[id] && result.checks[id].status === 'drift' ? result.checks[id].details : [])).map(detail => `  - ${detail}`),
      // Workflow problems the ruleset does not fix, shown before the question.
      ...['P3', 'P4'].flatMap(id => (result.checks[id] && ['drift', 'unverified'].includes(result.checks[id].status) ? result.checks[id].details.map(detail => `  - workflow (${result.checks[id].status}, fix by hand): ${detail}`) : [])),
    ])]);
    const answer = String(await this.#ask(`Add or update a "${protection.RULESET_NAME}" ruleset on these ${candidates.length} repositories? It covers the default branch: every change needs a pull request, the binding's required checks must pass (pinned to GitHub Actions), merge commits only, and nobody can bypass it. Updating it replaces any rules already in that ruleset. Type yes to confirm: `) || '').trim().toLowerCase();
    if (answer !== 'yes') {
      this.#say('Default-branch rulesets not added.');
      return [];
    }
    const results = [];
    for (const { row, requiredChecks, result } of candidates) {
      const existing = result.toolkit_ruleset ? result.toolkit_ruleset.id : null;
      let written;
      try { written = this.#protectionWriter(row.slug, requiredChecks, existing); } catch { written = { ok: false, reason: 'writer-failed' }; }
      if (!written || !written.ok) {
        this.#say(`- ${row.slug}: not ${existing ? 'updated' : 'added'} (${written && written.reason ? written.reason : 'unknown'}).`);
        results.push({ repository_id: row.state.repository_id, result: 'failed' });
        continue;
      }
      const after = this.#protectionFor(row).result;
      const fixed = !GovernanceMigration.#rulesetFixes(after) && ['P1', 'P5'].every(id => after.checks[id] && after.checks[id].status !== 'unverified');
      this.#say(`- ${row.slug}: ruleset ${existing ? 'updated' : 'added'}${fixed ? ' and read back' : ', but reading it back still shows drift'}.`);
      if (after.status === 'drift') this.#byHand(row, after);
      results.push({ repository_id: row.state.repository_id, result: fixed ? (existing ? 'updated' : 'added') : 'failed' });
    }
    return results;
  }

  #securityFor(row) {
    const read = this.#protectionFor(row);
    return security.dependencySecurity(row.root, {
      protectionResult: read ? read.result : null,
      ...(this.#securityReader ? { reader: this.#securityReader } : {}),
    });
  }

  // The free dependency and security settings are on by default for every governed repository, so
  // they are turned on without another question (the owner's yes to governance covers them); nothing
  // that needs billing is turned on. Nothing here asks.
  async #applySecurity(rows) {
    const results = [];
    for (const row of rows.filter(entry => entry.state.state === 'ENABLED' && entry.slug && entry.state.materials && entry.state.materials.binding)) {
      const result = this.#securityFor(row);
      if (result.status === 'not-applicable') continue;
      const outcome = security.applySecurity(row.root, result, {
        writer: this.#securityWriter, fileWriter: this.#securityFileWriter, reread: () => this.#securityFor(row),
      });
      for (const line of security.describeOutcome(row.slug, row.root, result, outcome)) this.#say(line);
      if (outcome.result !== 'nothing') results.push({ repository_id: row.state.repository_id, prior: outcome.prior, settings: outcome.settings, files: outcome.files, result: outcome.result });
    }
    return results;
  }

  // One private record per run that changed something, next to the decision file.
  #writeRecord(decisions, rulesets, protections = [], securities = []) {
    appendRunRecord(this.#registryOptions, { at: this.#now().toISOString(), decisions, rulesets, protections, securities });
  }
}

// Appends `run` to the private record next to the decision file (the last 20 runs are kept). Used by
// migrate and by `toolkit governance security`, so every settings change has a record of what GitHub
// showed before.
function appendRunRecord(registryOptions, run) {
  const directory = path.dirname(governance.registryPathFor(registryOptions));
  const file = path.join(directory, RECORD_BASENAME);
  let previous = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && parsed.schema === RECORD_SCHEMA && Array.isArray(parsed.runs)) previous = parsed.runs;
  } catch { previous = []; }
  const record = { schema: RECORD_SCHEMA, runs: [...previous, run].slice(-20) };
  fs.mkdirSync(directory, { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
  return file;
}

module.exports = Object.freeze({ GovernanceMigration, MigrationError, discoverRepositories, proposalFor, parseAnswer, appendRunRecord, RECORD_BASENAME, BINDING_TEMPLATE });
