'use strict';

// Retained settings-operation history. The historical filename/schema is consumed by the security
// command and kept to preserve its recovery record. It is never governance authority. Legacy local
// decision migration is a separate explicit operation, not a runtime or setup path.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const governance = require('./toolkit-governance-state.cjs');
const ruleset = require('./toolkit-governance-ruleset.cjs');
const protection = require('./toolkit-governance-protection.cjs');
const security = require('./toolkit-governance-security.cjs');
const { userStateDirectory } = require('./toolkit-user-state.cjs');
const RECORD_SCHEMA = 'toolkit.governance-migration.v1';
const RECORD_BASENAME = 'governance-migration.v1.json';
class SettingsOperationHistory {
  #file;
  constructor(options = {}) { this.#file = path.join(userStateDirectory(options), RECORD_BASENAME); }
  append(run) {
    let previous = [];
    try {
      const stat = fs.lstatSync(this.#file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw Error('history unavailable');
      const parsed = JSON.parse(fs.readFileSync(this.#file, 'utf8'));
      if (!parsed || parsed.schema !== RECORD_SCHEMA || !Array.isArray(parsed.runs)) throw Error('history invalid');
      previous = parsed.runs;
    } catch (error) {
      if (error.code !== 'ENOENT') throw Object.assign(new Error('OPERATION_HISTORY_UNREADABLE'), { code: 'OPERATION_HISTORY_UNREADABLE' });
    }
    const text = JSON.stringify({ schema: RECORD_SCHEMA, runs: [...previous, run].slice(-20) }, null, 2) + '\n';
    fs.mkdirSync(path.dirname(this.#file), { recursive: true });
    const temp = this.#file + '.' + process.pid + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
    try { fs.writeFileSync(temp, text, { mode: 0o600 }); fs.renameSync(temp, this.#file); }
    finally { fs.rmSync(temp, { force: true }); }
    if (fs.readFileSync(this.#file, 'utf8') !== text) throw Error('OPERATION_HISTORY_READBACK_FAILED');
    return this.#file;
  }
}
function appendRunRecord(options, run) { return new SettingsOperationHistory(options).append(run); }
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


// The historical migrate command retains its separately approved protection/security work.
// It never reads, copies, repairs or writes a historical local governance answer. Keep the command
// name for existing operators until the explicit migration route separates inventory and maintenance.
class GovernanceMaintenance {
  #stdout; #confirm; #interactive; #registryOptions; #rulesetReader; #rulesetCreator; #stateRulesetCreator; #protectionReader; #protectionWriter; #securityReader; #securityWriter; #securityFileWriter; #now;

  constructor({ stdout, confirm, interactive, registryOptions = {}, rulesetReader = null, rulesetCreator = null, stateRulesetCreator = null, protectionReader = null, protectionWriter = null, securityReader = null, securityWriter = null, securityFileWriter = null, now = () => new Date() }) {
    this.#stdout = stdout;
    this.#confirm = confirm;
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


  async run(roots) {
    if (!this.#interactive) throw Object.assign(new Error('Repository protection maintenance runs only in the owner\'s interactive terminal. No local decisions were read or written.'), { code: 'OWNER_TERMINAL_REQUIRED' });
    this.#say('Repository protection and security maintenance only. Historical local answers are inert; no decision migration is performed.');
    const rows = discoverRepositories(roots).map(root => ({ root, state: governance.governanceState(root, this.#registryOptions), slug: slugFor(root) }))
      .filter(row => row.state.programme_records_bind === true && row.slug);
    if (!rows.length) { this.#say('No fresh merged enabled repository was found. No governance or settings changes were made.'); return 0; }
    const rulesets = [...await this.#offerRulesets(rows), ...await this.#offerStateRulesets(rows)];
    const protections = await this.#offerProtection(rows);
    const securities = await this.#applySecurity(rows);
    if (rulesets.length || protections.length || securities.length) this.#writeRecord([], rulesets, protections, securities);
    return [...rulesets, ...protections, ...securities].some(entry => ['failed', 'unverified'].includes(entry.result)) ? 2 : 0;
  }

  // The post-merge finish of a bank turn-on (toolkit-governance-finish.cjs): the same rulesets,
  // default-branch protection and free security settings, for one freshly merged enabled repository,
  // without asking again, because the owner's yes in the governance bank covers them and the bank
  // listed them. Nothing that needs billing is turned on. Each setting ends as on (read back),
  // unavailable (GitHub cannot enforce it on this plan), held (an owner step Toolkit cannot take
  // itself, named in the result) or retry; only retry keeps the finish pending.
  // { result: 'not-ready' } or { result: 'done' | 'failed', reason, on, unavailable, held, files }.
  async finish(root) {
    const state = governance.governanceState(root, this.#registryOptions);
    const slug = slugFor(root);
    if (state.state !== 'ENABLED' || state.programme_records_bind !== true || !slug) return { result: 'not-ready' };
    const rows = [{ root: path.resolve(root), state, slug }];
    const ask = this.#ask;
    this.#ask = async () => 'yes';
    try {
      const rulesets = [...await this.#offerRulesets(rows), ...await this.#offerStateRulesets(rows)];
      const protections = await this.#offerProtection(rows);
      const securities = await this.#applySecurity(rows);
      if (rulesets.length || protections.length || securities.length) this.#writeRecord([], rulesets, protections, securities);
      const on = [], unavailable = [], held = [], retry = [];
      const reader = this.#rulesetReader ? { reader: this.#rulesetReader } : {};
      const rulesetEnd = (name, read) => {
        if (read.status === 'present') on.push(name);
        else if (read.status === 'not-enforceable') unavailable.push(name);
        else retry.push(`${name} is not read back`);
      };
      rulesetEnd('the no-force-push ruleset', ruleset.noForcePushRuleset(rows[0].root, reader));
      if (governance.mergedBinding(rows[0].root, this.#registryOptions)?.state) rulesetEnd('the ruleset that keeps the programme state branch', ruleset.keepStateRuleset(rows[0].root, reader));
      const failed = entries => entries.some(entry => ['failed', 'unverified'].includes(entry.result));
      // A write that did not read back is retried; only what is left after a clean write is held.
      if (failed(protections)) retry.push('default-branch protection did not read back after the write');
      else this.#protectionEnd(rows[0], { on, unavailable, held, retry });
      const sec = this.#securityFor(rows[0]);
      const unread = Object.values(sec.checks || {}).some(check => check.status === 'unverified');
      if (sec.status === 'conformant') on.push('the free dependency and security settings');
      else if (sec.status === 'drift' && !unread && !failed(securities)) held.push({ name: 'some dependency and security settings', step: `change by hand: ${Object.values(sec.checks || {}).filter(check => check.status === 'drift').flatMap(check => check.details).join('; ')}.` });
      else if (sec.status !== 'not-applicable') retry.push(securities.some(entry => entry.result === 'failed') ? 'a security setting did not read back after the write' : 'the security settings could not be read back');
      // Security files written into this working tree still need a pull request; the result says so.
      const files = securities.flatMap(entry => (entry.files || []).filter(file => file.result === 'written').map(file => file.file));
      return { result: retry.length ? 'failed' : 'done', reason: [...new Set(retry)].join('; '), on, unavailable, held, files };
    } finally { this.#ask = ask; }
  }

  // Where default-branch protection ended after the finish's write. A binding with no required checks
  // has nothing to require yet, and drift Toolkit's own ruleset cannot fix (or a required check no
  // workflow produces) needs the owner: both are held with the step, never retried in the background.
  #protectionEnd(row, { on, unavailable, held, retry }) {
    const name = 'default-branch protection';
    const read = this.#protectionFor(row);
    if (!read) { retry.push('the binding\'s required checks could not be read'); return; }
    const { result } = read;
    const then = `then run \`${governance.governanceCommand('migrate')}\` in your own terminal`;
    if (result.status === 'conformant') on.push(name);
    else if (result.status === 'not-enforceable') unavailable.push(name);
    else if (result.reason === 'binding-has-no-required-checks') {
      held.push({ name, step: `the programme file lists no required checks yet, so there is nothing for it to require. Add the check names every pull request must pass to required_checks in ${governance.BINDING_FILE} through a pull request, merge it, ${then} to add the protection.` });
    } else if (['P1', 'P2', 'P5'].some(id => result.checks[id]?.status === 'unverified')) retry.push(`${name} could not be read back`);
    else {
      const notes = ['P1', 'P2', 'P3', 'P4', 'P5'].flatMap(id => (result.checks[id] && ['drift', 'unverified'].includes(result.checks[id].status) ? result.checks[id].details : []));
      held.push({ name, step: `change by hand: ${notes.join('; ') || 'reading it back still shows drift'}; ${then} to check it again.` });
    }
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
    if (await this.#confirm(`add a "${ruleset.RULESET_NAME}" ruleset (every branch, no bypass) to these ${missing.length} repositories on GitHub`) !== true) {
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
  // ruleset that stops anyone deleting that branch, after its own Enter.
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
    if (await this.#confirm(`add a "${ruleset.KEEP_STATE_RULESET_NAME}" ruleset (that branch only, no deletion, no bypass) to these ${missing.length} repositories on GitHub`) !== true) {
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
      if (GovernanceMaintenance.#rulesetFixes(result) && unproduced.length === 0 && silent.length === 0) candidates.push({ row, ...read });
      else {
        if (GovernanceMaintenance.#rulesetFixes(result) && unproduced.length) this.#say(`${row.slug}: Toolkit ruleset not offered: no workflow job produces ${unproduced.map(check => `"${check}"`).join(', ')}, so requiring it would block every merge. Add the job, then run migrate again.`);
        if (GovernanceMaintenance.#rulesetFixes(result) && silent.length) this.#say(`${row.slug}: Toolkit ruleset not offered: ${silent.map(check => `"${check}"`).join(', ')} does not report on every pull request to the default branch, so requiring it would block those merges. Fix its workflow trigger, then run migrate again.`);
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
    this.#say([`The "${protection.RULESET_NAME}" ruleset covers the default branch:`, '- every change needs a pull request, and the binding\'s required checks must pass (pinned to GitHub Actions);', '- merge commits only, and nobody can bypass it;', '- updating it replaces any rules already in that ruleset.']);
    if (await this.#confirm(`add or update it on these ${candidates.length} repositories`) !== true) {
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
      const fixed = !GovernanceMaintenance.#rulesetFixes(after) && ['P1', 'P5'].every(id => after.checks[id] && after.checks[id].status !== 'unverified');
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



module.exports = Object.freeze({ GovernanceMaintenance, appendRunRecord, SettingsOperationHistory, RECORD_BASENAME });
