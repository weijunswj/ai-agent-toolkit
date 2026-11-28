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
const { BY_HAND } = require('./toolkit-governance-first-sweep.cjs');
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


// What Toolkit's own ruleset fixes on the default branch (a defaultBranchProtection verdict): a
// binding check that is not required, squash or rebase allowed, branches not required up to date, or
// an unpinned check in Toolkit's own ruleset.
function rulesetFixes(result) {
  if (!result || result.status !== 'drift') return false;
  const { P1, P2, P5, P6 } = result.checks;
  const own = result.toolkit_ruleset ? `ruleset ${result.toolkit_ruleset.id}` : null;
  return Boolean((P1 && P1.status === 'drift' && P1.missing.length > 0) || (P5 && P5.status === 'drift') || (P6 && P6.status === 'drift')
    || (own && P2 && P2.status === 'drift' && P2.details.some(detail => detail.includes(own))));
}

// Whether Toolkit's ruleset is offered for a default-branch verdict, read only: { fixes, offered,
// unproduced, silent }. A required check that no job produces would wait forever, and with no bypass
// that blocks every merge, so it is not offered until the workflow is fixed; the same goes for a check
// whose workflow does not report on every pull request. migrate, the post-merge finish and the
// governance summary's offer all decide here.
function protectionOffer(result) {
  const fixes = rulesetFixes(result);
  const checks = (result && result.checks) || {};
  const unproduced = checks.P3 && Array.isArray(checks.P3.missing) ? checks.P3.missing : [];
  const silent = checks.P4 && Array.isArray(checks.P4.never_reports) ? checks.P4.never_reports.filter(check => !unproduced.includes(check)) : [];
  return { fixes, offered: fixes && unproduced.length === 0 && silent.length === 0, unproduced, silent };
}

// The problems in the repository's own workflow files that a required check depends on (P3: a check
// no job produces; P4: a job that can be skipped or never reports), each one line naming the check
// and its file, said once (an unreadable workflow file is named under both). They are fixed in a pull
// request by the repository's controller, never on GitHub.
const workflowChecks = result => ['P3', 'P4'].map(id => result?.checks?.[id]).filter(check => check && ['drift', 'unverified'].includes(check.status));
function workflowNotes(result) {
  return [...new Set(workflowChecks(result).flatMap(check => check.details))];
}
// The same, each with what it is about ({ kind, check, file, detail }: producerVerdict in
// toolkit-governance-protection.cjs), for filing as the controller's task.
function workflowFindings(result) {
  const found = new Map();
  for (const finding of workflowChecks(result).flatMap(check => check.findings)) if (!found.has(finding.detail)) found.set(finding.detail, finding);
  return [...found.values()];
}

// What a protection candidate needs changed, for the run's own log: the settings that drift, then the
// workflow problems the ruleset does not fix.
function protectionNotes(result) {
  return [
    ...protection.SETTINGS_CHECKS.flatMap(id => (result.checks[id] && result.checks[id].status === 'drift' ? result.checks[id].details : [])),
    ...workflowNotes(result).map(detail => `workflow, for the controller: ${detail}`),
  ];
}

// The historical migrate command retains its separately approved protection/security work.
// It never reads, copies, repairs or writes a historical local governance answer. Keep the command
// name for existing operators until the explicit migration route separates inventory and maintenance.
class GovernanceMaintenance {
  #stdout; #confirm; #interactive; #registryOptions; #rulesetReader; #rulesetCreator; #stateRulesetCreator; #protectionReader; #protectionWriter; #securityReader; #securityWriter; #securityFileWriter; #ownRulesetWriter; #firstSweep; #weaknessTasks; #now;
  // Every step line this run said, kept in its private run record. The owner never sees this log:
  // the finish's outcome is what they read (SQAG, 28 November 2026: about 20 raw lines after a yes,
  // the same CI line three times).
  #log = [];

  // `firstSweep` runs the first-install sweep (toolkit-governance-first-sweep.cjs), or null where it cannot run here.
  constructor({ stdout, confirm, interactive, registryOptions = {}, rulesetReader = null, rulesetCreator = null, stateRulesetCreator = null, protectionReader = null, protectionWriter = null, securityReader = null, securityWriter = null, securityFileWriter = null, ownRulesetWriter = null, firstSweep = null, weaknessTasks = null, now = () => new Date() }) {
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
    this.#ownRulesetWriter = ownRulesetWriter || protection.ghOwnRulesetWriter;
    this.#firstSweep = firstSweep;
    this.#weaknessTasks = weaknessTasks;
    this.#now = now;
  }

  #say(lines) {
    this.#log.push(...[].concat(lines));
    this.#stdout.write(`${[].concat(lines).join('\n')}\n`);
  }


  async run(roots) {
    if (!this.#interactive) throw Object.assign(new Error('Repository protection maintenance runs only in the owner\'s interactive terminal. No local decisions were read or written.'), { code: 'OWNER_TERMINAL_REQUIRED' });
    this.#say('Repository protection and security maintenance only. Historical local answers are inert; no decision migration is performed.');
    const rows = discoverRepositories(roots).map(root => ({ root, state: governance.governanceState(root, this.#registryOptions), slug: slugFor(root) }))
      .filter(row => row.state.programme_records_bind === true && row.slug);
    if (!rows.length) { this.#say('No fresh merged enabled repository was found. No governance or settings changes were made.'); return 0; }
    // Every change is read first; the owner's one answer then covers the rulesets and protection, and none is
    // written before it. The free dependency and security settings follow either way, as the question says.
    const plans = { noForcePush: this.#planRulesets(rows), keepState: this.#planStateRulesets(rows), protectionCandidates: this.#planProtection(rows) };
    const approved = await this.#approve(plans);
    const rulesets = approved ? [...this.#applyRulesets(plans.noForcePush), ...this.#applyStateRulesets(plans.keepState)] : [];
    const protections = approved ? this.#applyProtection(plans.protectionCandidates) : [];
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
  // `sweep` is whether the turn-on added the personal data guard, so its first-install sweep runs too.
  // `ownRulesets` is the repository's own ruleset changes the owner said yes to, exactly as shown
  // (toolkit-governance-summary.cjs settingsRows, owner decision INT-TK421-1398); a turn-on's finish
  // passes none, so it never touches a repository's own ruleset.
  // { result: 'not-ready' } or { result: 'done' | 'failed', reason, on, unavailable, held, reports, files }.
  async finish(root, { sweep = false, ownRulesets = null } = {}) {
    const state = governance.governanceState(root, this.#registryOptions);
    const slug = slugFor(root);
    if (state.state !== 'ENABLED' || state.programme_records_bind !== true || !slug) return { result: 'not-ready' };
    const rows = [{ root: path.resolve(root), state, slug }];
    const rulesets = [...this.#finishRulesets(rows), ...this.#finishStateRulesets(rows)];
    // The owner's own ruleset changes go first, so the protection plan, its by-hand notes and Toolkit's
    // read-back all see them: nothing the yes changes is ever listed to change by hand.
    const owned = Array.isArray(ownRulesets) ? this.#applyOwnRulesets(rows[0], ownRulesets) : [];
    const protections = this.#finishProtection(rows);
    const securities = await this.#applySecurity(rows);
    if (rulesets.length || owned.length || protections.length || securities.length) this.#writeRecord([], [...rulesets, ...owned], protections, securities);
    const on = [], unavailable = [], held = [], retry = [], reports = [], controller = [];
    const { changed, unconfirmed } = GovernanceMaintenance.#changed({ rulesets, owned, protections, securities });
    const reader = this.#rulesetReader ? { reader: this.#rulesetReader } : {};
    // GitHub's own answer to a refused write goes into the reason, so a refusal that repeats is not
    // hidden behind "not read back". A refusal for this account (forbidden: not an admin) does not
    // change on its own, so it is held with the step instead of retried.
    const answered = entries => [...new Set(entries.filter(entry => entry.result === 'failed' && entry.reason).map(entry => entry.reason))];
    const because = reasons => (reasons.length ? ` (GitHub answered: ${reasons.join(', ')})` : '');
    const forbidden = reasons => reasons.length > 0 && reasons.every(reason => reason === 'forbidden');
    // What only the owner can change is said as GitHub settings steps, never a command to run: the
    // agent runs Toolkit's own check again when the owner says refresh governance.
    const admin = `GitHub refused the write for the account this computer's GitHub sign-in uses (forbidden): that account needs admin rights on ${slug}. On GitHub, an admin of the repository gives it the Admin role under Settings, then Collaborators and teams (Collaborators on a personal account); then say refresh governance and answer yes again.`;
    const rulesetEnd = (name, read, entries) => {
      if (read.status === 'present') on.push(name);
      else if (read.status === 'not-enforceable') unavailable.push(name);
      else if (forbidden(answered(entries))) held.push({ name, step: admin });
      else retry.push(`${name} is not read back${because(answered(entries))}`);
    };
    const noForcePush = ruleset.noForcePushRuleset(rows[0].root, reader);
    rulesetEnd('the no-force-push ruleset', noForcePush, rulesets.filter(entry => !entry.ruleset));
    if (governance.mergedBinding(rows[0].root, this.#registryOptions)?.state) rulesetEnd('the ruleset that keeps the programme state branch', ruleset.keepStateRuleset(rows[0].root, reader), rulesets.filter(entry => entry.ruleset === 'keep-programme-state'));
    // The repository's own rulesets: changed and read back, held when the account may not write them
    // or the ruleset changed on GitHub after it was shown (the yes covered only what it saw), else retried.
    for (const entry of owned) {
      const name = `the repository's own ruleset "${entry.name}"`;
      if (entry.result === 'changed') on.push(name);
      else if (entry.reason === 'forbidden') held.push({ name, step: admin });
      else if (entry.reason === 'ruleset-changed') held.push({ name, step: 'it changed on GitHub after it was shown, so nothing was written to it. Say refresh governance to see it as it is now.' });
      else retry.push(`${name} did not read back after the write${because([entry.reason].filter(Boolean))}`);
    }
    // A write that did not read back is retried; only what is left after a clean write is held.
    if (forbidden(answered(protections))) held.push({ name: 'default-branch protection', step: admin });
    else if (protections.some(entry => ['failed', 'unverified'].includes(entry.result))) retry.push(`default-branch protection did not read back after the write${because(answered(protections))}`);
    else this.#protectionEnd(rows[0], { on, unavailable, held, retry, controller }, { rulesetsUnavailable: noForcePush.status === 'not-enforceable' });
    this.#securityEnd(rows[0], securities, { on, held, retry, because, controller });
    const owed = sweep ? this.#sweepEnd(slug, { held, reports }) : null;
    // Security files written into this working tree still need a pull request; the result says so.
    const files = securities.flatMap(entry => (entry.files || []).filter(file => file.result === 'written').map(file => file.file));
    return { result: retry.length ? 'failed' : 'done', reason: [...new Set(retry)].join('; '), changed, unconfirmed, on, unavailable, held, controller: this.#fileWeaknesses(rows[0], controller), reports, files, ...(owed ? { sweep_owed: owed } : {}) };
  }

  // Each workflow weakness for the controller, filed once as a child task under the programme parent
  // (toolkit-governance-weakness.cjs, owner decision of 28 November 2026): [{ note, task }], where
  // task says whether it was filed, is already open, or why it was not filed.
  #fileWeaknesses(row, findings) {
    if (!findings.length) return [];
    const parent = governance.mergedBinding(row.root, this.#registryOptions)?.parents?.[0]?.issue ?? null;
    let tasks;
    try { tasks = this.#weaknessTasks ? this.#weaknessTasks.file(row.slug, parent, findings) : null; } catch { tasks = null; }
    const why = this.#weaknessTasks ? 'the GitHub request failed' : 'this run does not write to GitHub';
    return findings.map(finding => ({ note: finding.detail, task: tasks?.find(entry => entry.finding.detail === finding.detail) || { state: 'not-filed', parent, why } }));
  }

  // What this run wrote, each once, in plain words: { changed } (written and read back: the rulesets
  // added, the repository's own rulesets changed, Toolkit's default-branch ruleset added or updated, each
  // free security setting turned on and read back on) and { unconfirmed } (GitHub accepted the write,
  // but reading it back does not show it yet). A write GitHub accepted is never left out.
  // The failure this prevents: after a yes whose write did not read back, the result said "Nothing
  // was changed on GitHub" (G2 round 1, M1).
  static #changed({ rulesets, owned, protections, securities }) {
    const changed = [], unconfirmed = [];
    for (const entry of rulesets) {
      const name = `the "${entry.ruleset === 'keep-programme-state' ? ruleset.KEEP_STATE_RULESET_NAME : ruleset.RULESET_NAME}" ruleset`;
      if (entry.result === 'added') changed.push(`${name}, added`);
      else if (entry.written) unconfirmed.push(`${name}: GitHub accepted it, but it was not found when read back`);
    }
    for (const entry of owned) {
      if (entry.result === 'changed') changed.push(`the repository's own ruleset "${entry.name}", changed`);
      else if (entry.written) unconfirmed.push(`the repository's own ruleset "${entry.name}": GitHub accepted the change, but reading it back does not show it as shown`);
    }
    for (const entry of protections) {
      if (['added', 'updated'].includes(entry.result)) changed.push(`the "${protection.RULESET_NAME}" ruleset on the default branch, ${entry.result}`);
      else if (entry.written) unconfirmed.push(`the "${protection.RULESET_NAME}" ruleset on the default branch: GitHub accepted it, but reading it back still shows drift`);
    }
    const label = setting => security.SETTING_LABELS[setting] || setting;
    for (const entry of securities) {
      const notBack = new Set([...(entry.still_off || []), ...(entry.unconfirmed || [])]);
      const turned = (entry.settings || []).filter(item => item.ok && !notBack.has(item.setting)).map(item => label(item.setting));
      if (turned.length) changed.push(`${turned.join(', ')}, turned on`);
      for (const setting of entry.still_off || []) unconfirmed.push(`${label(setting)}: GitHub accepted it, but it still reads off`);
      for (const setting of entry.unconfirmed || []) unconfirmed.push(`${label(setting)}: GitHub accepted it, but it could not be read back`);
    }
    return { changed: [...new Set(changed)], unconfirmed: [...new Set(unconfirmed)] };
  }

  // Where the first-install sweep ended: its report line or an owner step, never a reason to run the
  // finish again. A run still going returns { run } (its id, or null when not seen yet): its result is
  // owed to a later session (toolkit-governance-finish.cjs).
  #sweepEnd(slug, { held, reports }) {
    let end;
    try { end = this.#firstSweep ? this.#firstSweep.run(slug) : null; } catch { end = null; }
    if (end?.end === 'report') reports.push(end.text);
    else held.push({ name: 'the first personal data sweep', step: end?.step || `it was not started from here; ${BY_HAND}.` });
    return end?.end === 'report' && end.owed ? { run: Number.isSafeInteger(end.owed.run) ? end.owed.run : null } : null;
  }

  // Where the security settings ended. A read or write GitHub did not confirm is retried, and so is a
  // free setting Toolkit would still turn on itself. Drift Toolkit does not fix, a check only a person
  // can make (by_hand) and dependency auto-merge waiting only for held protection are held with the
  // step: reading again would show the same thing.
  // A file in the repository Toolkit did not write (a Dependabot file missing an ecosystem, a workflow at
  // Toolkit's auto-merge path) goes to the controller like a workflow weakness, never by hand.
  #securityEnd(row, securities, { on, held, retry, because, controller = [] }) {
    const result = this.#securityFor(row);
    if (result.status === 'conformant') { on.push('the free dependency and security settings'); return; }
    if (result.status === 'not-applicable') return;
    const protectionLeft = controller.length > 0;
    const files = security.repositoryFileFindings(result);
    const fileDetails = new Set(files.map(finding => finding.detail));
    controller.push(...files);
    // Settings GitHub refused as not available here (plan or policy) are not failures and never retried.
    const unavailable = new Set(securities.flatMap(entry => entry.unavailable || []));
    const refused = securities.flatMap(entry => (entry.result === 'failed' ? (entry.settings || []).filter(item => !item.ok && item.reason && !unavailable.has(item.setting)).map(item => item.reason) : []));
    if (securities.some(entry => entry.result === 'failed')) { retry.push(`a security setting did not read back after the write${because([...new Set(refused)])}`); return; }
    if (securities.some(entry => entry.result === 'unverified')) { retry.push('the security settings could not be read back'); return; }
    if (Object.entries(result.fixes || {}).some(([setting, wanted]) => wanted && !unavailable.has(setting))) { retry.push('a free security setting Toolkit turns on is still off'); return; }
    const protectionHeld = held.some(entry => entry.name === 'default-branch protection');
    // S7 waits only on protection when the auto-merge policy is known and allow auto-merge was read:
    // on the owner's protection step, or on the controller's workflow fix when that is all protection
    // still needs (then it is neither retried nor the owner's by hand).
    const waitsOnProtection = (protectionHeld || protectionLeft) && ['default-branch', 'not-merged'].includes(result.policy_source)
      && typeof result.settings?.allow_auto_merge === 'boolean';
    const wait = protectionHeld ? 'dependency auto-merge waits until default-branch protection is set (its step is above)' : 'dependency auto-merge waits until your controller\'s workflow fix above has landed';
    const onlyProtection = check => check.details.length > 0 && check.details.every(detail => detail.startsWith('the default branch is not protected the way auto-merge needs'));
    const steps = [], waits = [];
    for (const [id, check] of Object.entries(result.checks || {})) {
      if (id === 'S7' && waitsOnProtection && !protectionHeld && check.status === 'drift' && onlyProtection(check)) waits.push(wait);
      else if (check.status === 'drift' || (check.status === 'unverified' && check.by_hand === true)) steps.push(...check.details.filter(detail => !fileDetails.has(detail)));
      else if (check.status === 'unverified' && id === 'S7' && waitsOnProtection) (protectionHeld ? steps : waits).push(wait);
      else if (check.status === 'unverified') { retry.push('the security settings could not be read back'); return; }
    }
    if (!steps.length && !waits.length) {
      if (!files.length) retry.push('the security settings could not be read back');
      return;
    }
    held.push({ name: 'some dependency and security settings', step: [steps.length ? `change by hand: ${steps.join('; ')}.` : '', waits.length ? `${waits.join('; ')}.` : ''].filter(Boolean).join(' ') });
  }

  // Where default-branch protection ended after the finish's write. A binding with no required checks
  // has nothing to require yet, and drift Toolkit's own ruleset cannot fix (or a required check no
  // workflow produces) needs the owner: both are held with the step, never retried in the background.
  // Where GitHub cannot enforce rulesets at all (rulesetsUnavailable), protection is named with them,
  // never as a step that cannot work there. A problem in the repository's own workflow files (a
  // required check no job produces, or a job that can be skipped) is work for the repository's
  // controller in a pull request (`controller`), never a by-hand step for the owner: only GitHub
  // settings the owner alone can change are by hand (SQAG, 28 November 2026).
  #protectionEnd(row, { on, unavailable, held, retry, controller }, { rulesetsUnavailable = false } = {}) {
    const name = 'default-branch protection';
    const read = this.#protectionFor(row);
    if (!read) { retry.push('the binding\'s required checks could not be read'); return; }
    const { result } = read;
    if (result.status === 'conformant') on.push(name);
    else if (result.status === 'not-enforceable' || (rulesetsUnavailable && result.reason === 'binding-has-no-required-checks')) unavailable.push(name);
    else if (result.reason === 'binding-has-no-required-checks') {
      held.push({ name, step: 'the programme file lists no required checks yet, so there is nothing for it to require. Say refresh governance: it offers one pull request that adds the checks the default branch already requires and Toolkit\'s own. Once that is merged, refresh governance offers to add the protection.' });
    } else if (protection.SETTINGS_CHECKS.some(id => result.checks[id]?.status === 'unverified')) retry.push(`${name} could not be read back`);
    else {
      // A required check no job produces (or one that does not report on every pull request) waits for
      // the controller's fix: requiring it now would block every merge, so it is never a by-hand step.
      const offer = protectionOffer(result);
      const waiting = [...offer.unproduced, ...offer.silent];
      const settings = protection.SETTINGS_CHECKS.flatMap(id => (result.checks[id]?.status === 'drift' ? result.checks[id].details : []))
        .filter(detail => !waiting.some(check => detail.startsWith(`"${check}" `)));
      const workflows = workflowFindings(result);
      controller.push(...workflows);
      const wait = waiting.length ? `it waits until your controller's workflow fix above has landed, since requiring ${waiting.map(check => `"${check}"`).join(', ')} before a job reports it on every pull request would block every merge.` : '';
      if (settings.length) held.push({ name, step: `change by hand: ${settings.join('; ')}. ${require('./toolkit-governance-summary.cjs').WHERE.protection}.${wait ? ` Then ${wait}` : ''} Then say refresh governance, and your agent checks it again.` });
      else if (wait) held.push({ name, step: `${wait} Then say refresh governance, and Toolkit offers its ruleset.` });
      else if (workflows.length) on.push(name);
      else held.push({ name, step: 'change by hand: reading it back still shows drift. Then say refresh governance, and your agent checks it again.' });
    }
  }

  // The one question for every change the reads found. Nothing is written before a yes; a no writes
  // nothing and says so once. Asked only when there is a change, and it names each ruleset it covers.
  async #approve({ noForcePush, keepState, protectionCandidates }) {
    if (noForcePush.length + keepState.length + protectionCandidates.length === 0) return false;
    const changes = [];
    if (noForcePush.length) changes.push(`- Add the "${ruleset.RULESET_NAME}" ruleset (every branch, no bypass) to:`, ...noForcePush.map(row => `  - ${row.slug} (${row.root})`));
    if (keepState.length) changes.push(`- Add the "${ruleset.KEEP_STATE_RULESET_NAME}" ruleset (that branch only, no deletion, no bypass) to:`, ...keepState.map(row => `  - ${row.slug} (${row.root})`));
    if (protectionCandidates.length) changes.push(`- Add or update default-branch protection (the "${protection.RULESET_NAME}" ruleset) on:`, ...protectionCandidates.flatMap(({ row, result }) => [`  - ${row.slug} (${row.root})`, ...protectionNotes(result).map(note => `    - ${note}`)]), ...GovernanceMaintenance.#protectionTerms());
    this.#say(['These governed GitHub repositories would change on GitHub. No ruleset or default-branch protection is written until you answer once; the free dependency and security settings are turned on either way:', ...changes]);
    if (await this.#confirm(GovernanceMaintenance.#question({ noForcePush, keepState, protectionCandidates })) === true) return true;
    this.#say('No rulesets or default-branch protection were added.');
    return false;
  }

  static #question({ noForcePush, keepState, protectionCandidates }) {
    const names = [noForcePush.length && ruleset.RULESET_NAME, keepState.length && ruleset.KEEP_STATE_RULESET_NAME, protectionCandidates.length && protection.RULESET_NAME].filter(Boolean);
    const what = [noForcePush.length || keepState.length ? 'the rulesets' : null, protectionCandidates.length ? 'default-branch protection' : null].filter(Boolean).join(' and ');
    return `add or update ${what} listed above to these repositories on GitHub: ${names.map(name => `"${name}"`).join(', ')}`;
  }

  static #protectionTerms() {
    return [`The "${protection.RULESET_NAME}" ruleset covers the default branch:`, '- every change needs a pull request, and the binding\'s required checks must pass (pinned to GitHub Actions) at a head that holds the branch\'s latest commit;', '- merge commits only, and nobody can bypass it;', '- updating it replaces any rules already in that ruleset.'];
  }

  // Reads only: the enabled repositories that lack the no-force-push ruleset.
  #planRulesets(rows) {
    const enabled = rows.filter(row => row.state.state === 'ENABLED');
    const missing = [];
    for (const row of enabled) {
      const result = ruleset.noForcePushRuleset(row.root, this.#rulesetReader ? { reader: this.#rulesetReader } : {});
      if (result.status === 'missing') missing.push(row);
      else if (result.status === 'not-enforceable') this.#say(`${row.root}: GitHub cannot enforce a no-force-push ruleset here (private repository on GitHub Free); the local force-push guard is the fallback.`);
      else if (result.status === 'unverified') this.#say(`${row.root}: the no-force-push ruleset could not be checked (${result.reason}).`);
    }
    return missing;
  }

  // Adds the no-force-push ruleset to each planned repository, read back after each write.
  #applyRulesets(missing) {
    const results = [];
    for (const row of missing) {
      const created = this.#rulesetCreator(row.slug);
      const verified = created && created.ok ? ruleset.noForcePushRuleset(row.root, this.#rulesetReader ? { reader: this.#rulesetReader } : {}) : null;
      const ok = verified && verified.status === 'present';
      this.#say(`- ${row.slug}: ${ok ? 'ruleset added and read back' : `not added (${created && created.reason ? created.reason : 'read-back did not find it'})`}.`);
      results.push({ repository_id: row.state.repository_id, result: ok ? 'added' : 'failed', ...(ok ? {} : { reason: created && created.reason ? created.reason : 'not-read-back', written: Boolean(created && created.ok) }) });
    }
    return results;
  }

  // The finish path: the same list and writes as before, with no question (finish gives its yes).
  #finishRulesets(rows) {
    const missing = this.#planRulesets(rows);
    if (missing.length === 0) return [];
    this.#say(['These governed GitHub repositories have no ruleset blocking force pushes:', ...missing.map(row => `- ${row.slug} (${row.root})`)]);
    return this.#applyRulesets(missing);
  }

  // Repositories whose merged binding keeps programme state on the public state branch get a second
  // ruleset that stops anyone deleting that branch, asked in the same one question as the others.
  // Reads only.
  #planStateRulesets(rows) {
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
    return missing;
  }

  #applyStateRulesets(missing) {
    const reader = this.#rulesetReader ? { reader: this.#rulesetReader } : {};
    const results = [];
    for (const row of missing) {
      const created = this.#stateRulesetCreator(row.slug);
      const verified = created && created.ok ? ruleset.keepStateRuleset(row.root, reader) : null;
      const ok = verified && verified.status === 'present';
      this.#say(`- ${row.slug}: ${ok ? 'programme state ruleset added and read back' : `not added (${created && created.reason ? created.reason : 'read-back did not find it'})`}.`);
      results.push({ repository_id: row.state.repository_id, ruleset: 'keep-programme-state', result: ok ? 'added' : 'failed', ...(ok ? {} : { reason: created && created.reason ? created.reason : 'not-read-back', written: Boolean(created && created.ok) }) });
    }
    return results;
  }

  // The finish path: the same list and writes as before, with no question (finish gives its yes).
  #finishStateRulesets(rows) {
    const missing = this.#planStateRulesets(rows);
    if (missing.length === 0) return [];
    this.#say(['These governed GitHub repositories keep programme state on the branch ' + ruleset.STATE_BRANCH + ', and nothing stops it being deleted:', ...missing.map(row => `- ${row.slug} (${row.root})`)]);
    return this.#applyStateRulesets(missing);
  }

  #protectionFor(row) {
    const requiredChecks = governance.bindingRequiredChecks(row.root, this.#registryOptions);
    if (!requiredChecks) return null;
    return { requiredChecks, result: protection.defaultBranchProtection(row.root, { requiredChecks, commit: row.state.merged?.commit, ...(this.#protectionReader ? { reader: this.#protectionReader } : {}) }) };
  }

  // What is left after a read: GitHub settings by hand, workflow files for the repository's controller.
  #byHand(row, result) {
    const settings = protection.SETTINGS_CHECKS.flatMap(id => (result.checks[id]?.status === 'drift' ? result.checks[id].details : []));
    const workflows = ['P3', 'P4'].flatMap(id => (result.checks[id]?.status === 'drift' ? result.checks[id].details : []));
    if (settings.length) this.#say([`${row.slug}: change by hand on GitHub:`, ...settings.map(note => `  - ${note}`)]);
    if (workflows.length) this.#say([`${row.slug}: for the repository's controller, in a pull request:`, ...workflows.map(note => `  - ${note}`)]);
  }

  // Reads only: the repositories whose default branch the Toolkit ruleset would fix, and notes on the
  // ones it cannot be offered to (those are checked by hand, not written).
  #planProtection(rows) {
    const candidates = [];
    for (const row of rows.filter(entry => entry.state.state === 'ENABLED' && entry.slug)) {
      const read = this.#protectionFor(row);
      if (!read) continue;
      const { result } = read;
      if (result.status === 'not-enforceable') this.#say(`${row.root}: GitHub cannot protect the default branch here (private repository on GitHub Free).`);
      else {
        const unread = protection.SETTINGS_CHECKS.map(id => result.checks[id]).find(check => check && check.status === 'unverified');
        if (unread) this.#say(`${row.root}: default-branch protection could not be checked on GitHub (${unread.details.join('; ')}).`);
      }
      const { fixes, offered, unproduced, silent } = protectionOffer(result);
      if (offered) candidates.push({ row, ...read });
      else {
        if (fixes && unproduced.length) this.#say(`${row.slug}: Toolkit ruleset not offered: no workflow job produces ${unproduced.map(check => `"${check}"`).join(', ')}, so requiring it would block every merge. Add the job, then say refresh governance to check again.`);
        if (fixes && silent.length) this.#say(`${row.slug}: Toolkit ruleset not offered: ${silent.map(check => `"${check}"`).join(', ')} does not report on every pull request to the default branch, so requiring it would block those merges. Fix its workflow trigger, then say refresh governance to check again.`);
        this.#byHand(row, result);
      }
    }
    return candidates;
  }

  // Adds or updates the Toolkit ruleset on each planned repository, read back after each write.
  #applyProtection(candidates) {
    const results = [];
    for (const { row, requiredChecks, result } of candidates) {
      const existing = result.toolkit_ruleset ? result.toolkit_ruleset.id : null;
      let written;
      try { written = this.#protectionWriter(row.slug, requiredChecks, existing); } catch { written = { ok: false, reason: 'writer-failed' }; }
      if (!written || !written.ok) {
        this.#say(`- ${row.slug}: not ${existing ? 'updated' : 'added'} (${written && written.reason ? written.reason : 'unknown'}).`);
        results.push({ repository_id: row.state.repository_id, result: 'failed', reason: written && written.reason ? written.reason : 'unknown' });
        continue;
      }
      const after = this.#protectionFor(row).result;
      const fixed = !rulesetFixes(after) && ['P1', 'P5'].every(id => after.checks[id] && after.checks[id].status !== 'unverified');
      this.#say(`- ${row.slug}: ruleset ${existing ? 'updated' : 'added'}${fixed ? ' and read back' : ', but reading it back still shows drift'}.`);
      if (after.status === 'drift') this.#byHand(row, after);
      results.push({ repository_id: row.state.repository_id, result: fixed ? (existing ? 'updated' : 'added') : 'failed', ...(fixed ? {} : { written: true }) });
    }
    return results;
  }

  // The finish path: the same list and writes as before, with no question (finish gives its yes).
  #finishProtection(rows) {
    const candidates = this.#planProtection(rows);
    if (candidates.length === 0) return [];
    this.#say(['These governed GitHub repositories need default-branch protection:', ...candidates.flatMap(({ row, result }) => [
      `- ${row.slug} (${row.root})`,
      ...protectionNotes(result).map(note => `  - ${note}`),
    ])]);
    this.#say(GovernanceMaintenance.#protectionTerms());
    return this.#applyProtection(candidates);
  }

  #securityFor(row) {
    const read = this.#protectionFor(row);
    return security.dependencySecurity(row.root, {
      protectionResult: read ? read.result : null,
      ...(this.#securityReader ? { reader: this.#securityReader } : {}),
    });
  }

  // Writes each own ruleset change the owner said yes to, through the writer that refuses a ruleset
  // that changed since it was shown and reads each change back. Nothing else is written to it.
  #applyOwnRulesets(row, entries) {
    const results = [];
    for (const entry of entries) {
      let written;
      try { written = this.#ownRulesetWriter(row.slug, entry); } catch { written = { ok: false, reason: 'writer-failed' }; }
      const ok = Boolean(written && written.ok);
      this.#say(`- ${row.slug}: the repository's own ruleset "${entry.name}" ${ok ? 'changed and read back' : `not changed (${written && written.reason ? written.reason : 'unknown'})`}.`);
      results.push({ repository_id: row.state.repository_id, ruleset: `own:${entry.id}`, name: entry.name, result: ok ? 'changed' : 'failed', ...(ok ? {} : { reason: written && written.reason ? written.reason : 'unknown', written: written?.reason === 'not-read-back' }) });
    }
    return results;
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
      if (outcome.result !== 'nothing') results.push({ repository_id: row.state.repository_id, prior: outcome.prior, settings: outcome.settings, files: outcome.files, unavailable: outcome.unavailable, still_off: outcome.still_off, unconfirmed: outcome.unconfirmed, result: outcome.result });
    }
    return results;
  }

  // One private record per run that changed something, next to the decision file.
  #writeRecord(decisions, rulesets, protections = [], securities = []) {
    appendRunRecord(this.#registryOptions, { at: this.#now().toISOString(), decisions, rulesets, protections, securities, log: GovernanceMaintenance.#logTail(this.#log) });
  }

  // The run's step log for its record, capped by size so the record (kept to 1 MiB with its last 20
  // runs) never grows past what it can read back: each line at most 500 characters, the newest lines
  // up to 32 KiB in all.
  static #logTail(log) {
    const kept = [];
    let size = 0;
    for (const line of [...log].reverse()) {
      const short = String(line).slice(0, 500);
      size += Buffer.byteLength(short, 'utf8') + 1;
      if (size > 32 * 1024) break;
      kept.unshift(short);
    }
    return kept;
  }
}



module.exports = Object.freeze({ GovernanceMaintenance, appendRunRecord, protectionOffer, workflowNotes, SettingsOperationHistory, RECORD_BASENAME });
