'use strict';

// Owns pending owner answers and decision proposals. Neither a receipt nor a PR is governance.
// Startup/status discover PRs; prompts recheck a published PR before repeating its merge request.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolvePathExecutable } = require('./claude-process-launch.cjs');
const { userStateDirectory } = require('./toolkit-user-state.cjs');
const cache = require('./toolkit-governance-binding.cjs');
const SCHEMA = 'toolkit.governance-proposals.v1';
const MARKER = '<!-- toolkit-governance-decision -->';
const LIMIT = 256 * 1024;
const GITHUB_LIMIT = 8 * 1024 * 1024;
const PROMPT_BUDGET_MS = 3000;
const PROMPT_INTERVAL_MS = 60000;
const SHA = /^[a-f0-9]{40}$/;
const EPOCH = /^[a-f0-9]{32}$/;
function fail(code) { throw Object.assign(new Error(code), { code }); }
// The branch a programme file update is prepared on (publishProgrammeUpdate).
const UPDATE_BRANCH = /^toolkit\/programme-update-[0-9a-f]{32}$/;
const cloudFiles = () => require('./toolkit-cloud-workflows.cjs').DEFAULT_FILES;
// The Dependabot settings the turn-on adds where missing (toolkit-governance-adopt.cjs).
const securityFiles = () => require('./toolkit-governance-security.cjs').DEPENDABOT_NAMES;
const ownerFiles = () => require('./toolkit-governance-owner-files.cjs');
const READBACK_TRIES = 4, READBACK_WAIT_MS = 500;
function key(value) { return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 32); }
// A yes is published only by the governance question bank, whose script makes every piece itself.
const BANK_ONLY = 'A yes is published only from the guided governance setup, which makes the store, parent issue, programme file and CI checks itself.';
// The files every turn-on pull request carries: the programme file and the plain-text check. A yes
// missing any of them is refused. The installed Toolkit delivers the governed rules and playbooks,
// so no instruction file is required or added.
const PLAIN_TEXT_FILES = Object.freeze(['.github/plain-text.json', '.github/scripts/plain-text-check.cjs', '.github/workflows/plain-text.yml']);
const REQUIRED_FILES = Object.freeze([cache.BINDING_PATH, ...PLAIN_TEXT_FILES]);
function missingFiles(files) { return REQUIRED_FILES.filter(name => typeof files[name] !== 'string'); }

// Every default cloud workflow a governed repository needs (DEFAULT_CLOUD_WORKFLOWS), made from this
// Toolkit checkout's own commit, which must be on its main branch:
// { files: { path: text }, warning, notes, added }. Turning governance on carries them in the same pull
// request as the binding, so a repository never gets one without the other. A Toolkit source checkout
// runs its own workflow files, so it gets nothing and no warning. When the copies cannot be made, the
// existing ones (if any) still travel and the warning names the reason and the fix. `notes` names a
// workflow left out because a file Toolkit did not write is in its place, or because this repository
// lacks what it needs, and `added` the workflows this repository did not have.
const CLOUD_FIX = 'run node repo/scripts/toolkit-cloud-workflows.cjs --repo <this repository> from a Toolkit checkout on main, commit the copies to the governance pull request, then run the governance check (toolkit-governance.cjs check) in this repository';
// `root` and `commit` (the Toolkit checkout and the commit to pin) are only for tests.
// `source` is the Toolkit git checkout to render from (by default this copy, or the managed checkout
// from a plugin copy).
function cloudWorkflowFiles(cwd, { root = null, commit = null, source: chosen = undefined } = {}) {
  // From a plugin copy the copies come from the managed checkout, rendered by that checkout's own
  // installer, so the render logic always matches the commit the copies are pinned to. Its rows are read
  // with this copy's own helpers, since that checkout may be another Toolkit version.
  const own = require('./toolkit-cloud-workflows.cjs');
  const source = root ? null : chosen === undefined ? own.sourceRoot() : chosen;
  const workflows = own.installerAt(source);
  if (workflows.isToolkitCheckout(cwd)) return { files: {}, warning: null };
  try {
    const result = workflows.plan({ repo: cwd, ...(root ? { root } : {}), ...(commit ? { commit } : {}) });
    const missing = new Set(result.rows.filter(row => row.state === 'missing' && !row.held).map(row => row.file));
    return {
      files: Object.fromEntries(own.writableRows(result.rows).map(row => [row.file, row.expected])), warning: null,
      notes: own.leftOutNotes(result),
      added: own.DEFAULT_CLOUD_WORKFLOWS.filter(entry => missing.has(entry.file)).map(entry => entry.id),
    };
  } catch (error) {
    if (!(error instanceof workflows.InstallError || error instanceof own.InstallError)) throw error;
    return { files: {}, warning: `Toolkit: the cloud workflow copies were not refreshed in this pull request (${String(error.message).replace(/\.$/, '')}). To fix it, ${CLOUD_FIX}.` };
  }
}

// A version 1 binding moved to version 2 with the same meaning: enabled, its one parent in `parents`.
const BINDING_V2 = 'toolkit.programme-binding.v2';
function bindingV2(binding) {
  if (!binding || binding.schema !== 'toolkit.programme-binding.v1') return binding;
  const { schema, repository, parent_issue: issue, record_prefix, writer_prefix, ...rest } = binding;
  return { schema: BINDING_V2, repository, governance: 'enabled', parents: [{ issue, record_prefix, ...(writer_prefix === undefined ? {} : { writer_prefix }) }], ...rest };
}

// The turn-on file set: the programme file, the CI files (each read from `rendered`, the folder outside
// the checkout the bank rendered the missing plain-text check and Dependabot settings into, else from
// the checkout, which already has it) and the cloud workflows. Instruction files, product files and
// backups never join it. A link or folder in a cloud workflow's place is never read: the plan already
// leaves that workflow out and names it, so it does not stop the turn-on.
function adoptionFiles(cwd, text, cloud = { files: {} }, rendered = null) {
  const names = [...PLAIN_TEXT_FILES, '.github/plain-text-baseline.json', ...cloudFiles(), ...securityFiles()];
  const files = { [cache.BINDING_PATH]: text };
  for (const name of names) {
    const base = rendered && fs.existsSync(path.join(rendered, name)) ? rendered : cwd;
    const file = path.join(base, name);
    if (!fs.existsSync(file)) continue;
    let current = base;
    const linked = name.split('/').some(part => { current = path.join(current, part); return fs.lstatSync(current).isSymbolicLink(); });
    const stat = fs.lstatSync(file);
    if (linked || !stat.isFile() || stat.size > LIMIT) {
      if (cloudFiles().includes(name)) continue;
      fail('PROPOSAL_ADOPTION_INCOMPLETE');
    }
    files[name] = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  }
  const all = { ...files, ...cloud.files };
  if (missingFiles(all).length) fail('PROPOSAL_ADOPTION_INCOMPLETE');
  return all;
}
function proposalText(proposals) {
  if (proposals.length > 1) return `Toolkit: conflicting governance proposals are waiting: ${proposals.map(item => item.url).join(', ')}. Ask the owner which proposal to keep. None decides governance.`;
  return `Toolkit: governance decision pending. ${proposals[0].url} changes the repository's governance to ${proposals[0].answer === 'yes' ? 'enabled' : 'disabled'} on every computer once merged. Show the owner its external effects and current checks, then run its merge in the same turn: Toolkit's merge hold asks the owner, so ask no merge question of your own first. This answer grants no merge permission.`;
}

// The checks the turn-on pull request's own workflows run, by job name: Toolkit requires them itself,
// so the owner never edits required_checks or runs a command for them. A job counts only where the file
// the pull request carries defines it (read with LF line ends).
const OWN_CHECKS = Object.freeze([
  { check: 'plain-text', file: '.github/workflows/plain-text.yml', job: /^jobs:[ \t]*\n(?:[^\n]*\n)*? {2}plain-text:[ \t]*$/m },
  { check: 'personal-data', file: '.github/workflows/personal-data-guard.yml', job: /^jobs:[ \t]*\n(?:[^\n]*\n)*? {2}personal-data:[ \t]*$/m },
]);
// `required` plus the own checks `files` produce that it lacks, sorted; `required` as it is when it has them all.
function withOwnChecks(required, files) {
  const kept = Array.isArray(required) ? required : [];
  const own = OWN_CHECKS.filter(entry => typeof files[entry.file] === 'string' && entry.job.test(files[entry.file].replace(/\r\n/g, '\n'))).map(entry => entry.check);
  const missing = own.filter(check => !kept.includes(check));
  return missing.length ? [...kept, ...missing].sort() : required;
}

class GovernanceProposals {
  #directory; #now; #transport; #identityReader; #cloudWorkflows;
  constructor({ registryOptions = {}, now = () => new Date(), transport = null, identityReader = null, cloudWorkflows = cloudWorkflowFiles } = {}) {
    this.#cloudWorkflows = cloudWorkflows;
    this.#directory = userStateDirectory(registryOptions);
    this.#now = now;
    this.#transport = transport;
    this.#identityReader = identityReader || (cwd => require('./toolkit-governance-state.cjs').readIdentity(cwd));
  }
  #identity(cwd) {
    const identity = this.#identityReader(cwd);
    const governance = require('./toolkit-governance-state.cjs');
    if (!identity.valid || !governance.isGitHubHost(identity.remote.host) || !governance.remoteSlug(identity.remote)) fail('PROPOSAL_IDENTITY_INVALID');
    return identity;
  }
  #file(id) { return path.join(this.#directory, 'governance-proposals', `${key(id)}.json`); }
  #read(id) {
    try {
      const file = this.#file(id), stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > LIMIT) return null;
      const value = JSON.parse(fs.readFileSync(file, 'utf8'));
      return value?.schema === SCHEMA && value.repository_id === id && Array.isArray(value.requests) && Array.isArray(value.proposals) ? value : null;
    } catch { return null; }
  }
  #write(id, value) {
    const file = this.#file(id);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try { fs.writeFileSync(temp, `${JSON.stringify(value)}\n`, { mode: 0o600 }); fs.renameSync(temp, file); }
    finally { fs.rmSync(temp, { force: true }); }
    const back = this.#read(id);
    if (!back || JSON.stringify(back) !== JSON.stringify(value)) fail('PROPOSAL_READBACK_FAILED');
    return back;
  }
  #update(id, change) {
    const file = this.#file(id), lock = `${file}.lock`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let descriptor;
    try { descriptor = fs.openSync(lock, 'wx', 0o600); }
    catch { fail('PROPOSAL_BUSY'); }
    try {
      const value = this.#read(id) || { schema: SCHEMA, repository_id: id, requests: [], proposals: [] };
      change(value);
      return this.#write(id, value);
    } finally { fs.closeSync(descriptor); fs.rmSync(lock, { force: true }); }
  }
  // The answer a run's live receipt carries ('yes' or 'no'), or null.
  answerFor(cwd, run) {
    const identity = this.#identity(cwd), value = this.#read(identity.repository_id);
    const request = value?.requests.find(item => item.run === run);
    return request && ['yes', 'no'].includes(request.answer) ? request.answer : null;
  }
  // Called only after the host gate or interactive terminal has accepted the owner's answer.
  // There is deliberately no confirmed:true bypass. The receipt is bound to that run, never global.
  request(cwd, answer, { sessionId, epoch }) {
    if (!['yes', 'no'].includes(answer) || typeof sessionId !== 'string' || !sessionId || !EPOCH.test(epoch)) fail('PROPOSAL_RUN_INVALID');
    const identity = this.#identity(cwd);
    const run = key(`${sessionId}:${epoch}`);
    this.#update(identity.repository_id, value => {
      const prior = value.requests.find(item => item.run === run);
      if (prior && prior.answer !== answer) fail('PROPOSAL_ANSWER_CONFLICT');
      if (!prior) value.requests = [...value.requests.slice(-63), { run, answer, at: this.#now().toISOString() }];
    });
    return { run, answer };
  }
  pending(cwd, { sessionId = null, epoch = null } = {}) {
    const identity = this.#identity(cwd), value = this.#read(identity.repository_id);
    if (!value) return null;
    if (value.error) return { kind: 'unavailable', text: "Toolkit: couldn't check governance proposals. Continue with global rules; no governance effects or standing task auto-merge until it can be checked." };
    const fresh = cache.isFresh({ fetched_at: value.checked_at }, this.#now()) && !value.error;
    if (fresh && value.can_write === false) return { kind: 'read-only', text: 'Toolkit: this GitHub account cannot write to this repository. Continue with global rules, without governance effects or standing task auto-merge.' };
    const proposals = fresh ? value.proposals.filter(item => validProposal(item, require('./toolkit-governance-state.cjs').remoteSlug(identity.remote))) : [];
    if (proposals.length) return { kind: proposals.length > 1 ? 'conflict' : 'published', proposals, text: proposalText(proposals) };
    const run = sessionId && EPOCH.test(epoch) ? key(`${sessionId}:${epoch}`) : null;
    const request = value.requests.find(item => item.run === run && ['yes', 'no'].includes(item.answer) && this.#now() - new Date(item.at) >= 0 && this.#now() - new Date(item.at) <= cache.FRESH_MS);
    if (!request) return null;
    return { kind: 'preparing', ...request, text: `Toolkit: the owner's ${request.answer} is pending for this run. ${request.answer === 'yes' ? `${BANK_ONLY} Show the owner the setup questions again with node "${path.join(__dirname, 'toolkit-governance.cjs')}" setup and build nothing by hand.` : `Prepare and publish one governance decision pull request with node "${path.join(__dirname, 'toolkit-governance.cjs')}" publish --run ${request.run}. Then show its external effects and run its merge in the same turn: Toolkit's merge hold asks the owner.`} Governance stays as merged on the default branch.` };
  }
  // A failed query is unknown, never "there are no proposals". Closed unmerged PRs end requests.
  // One PR-state read per minute across chats. Claim before I/O, so even a killed hook is throttled.
  refreshPrompt(cwd, deadline) {
    const identity = this.#identity(cwd), slug = require('./toolkit-governance-state.cjs').remoteSlug(identity.remote);
    const prior = this.#read(identity.repository_id);
    if (prior?.proposals.length !== 1) return { ok: true, closed: false };
    let proposal = null;
    this.#update(identity.repository_id, value => {
      if (value.proposals.length !== 1 || !validProposal(value.proposals[0], slug)) return;
      const age = this.#now() - new Date(value.prompt_checked_at);
      if (age >= 0 && age < PROMPT_INTERVAL_MS) return;
      value.prompt_checked_at = this.#now().toISOString();
      proposal = value.proposals[0];
    });
    if (!proposal) return { ok: true, closed: false };
    try {
      const state = this.#transport.state(slug, proposal.number, { deadline });
      if (Date.now() >= deadline || !['open', 'closed'].includes(state)) fail('PROPOSAL_GITHUB_UNAVAILABLE');
      this.#update(identity.repository_id, value => {
        value.error = null;
        if (state === 'closed') {
          value.proposals = value.proposals.filter(item => item.number !== proposal.number);
          value.requests = value.requests.filter(item => item.proposal !== proposal.number);
        }
      });
      return { ok: true, closed: state === 'closed' };
    } catch {
      this.#update(identity.repository_id, value => { value.error = 'could-not-check-proposals'; });
      return { ok: false, closed: false };
    }
  }
  refresh(cwd) {
    const identity = this.#identity(cwd), governance = require('./toolkit-governance-state.cjs');
    const slug = governance.remoteSlug(identity.remote);
    try {
      if (!this.#transport) fail('PROPOSAL_TRANSPORT_UNAVAILABLE');
      const canWrite = this.#transport.canWrite ? this.#transport.canWrite(slug) : null;
      if (canWrite === false) {
        this.#update(identity.repository_id, value => { value.can_write = false; value.checked_at = this.#now().toISOString(); value.error = null; value.proposals = []; });
        return { ok: true, proposals: [], canWrite: false };
      }
      const proposals = this.#transport.list(slug);
      if (!Array.isArray(proposals) || proposals.some(item => !validProposal(item, slug))) fail('PROPOSAL_RESPONSE_INVALID');
      this.#update(identity.repository_id, value => {
        value.requests = value.requests.filter(item => !item.proposal || proposals.some(proposal => proposal.number === item.proposal));
        value.proposals = proposals;
        value.checked_at = this.#now().toISOString();
        value.can_write = canWrite;
        value.error = null;
      });
      return { ok: true, proposals };
    } catch (error) {
      this.#update(identity.repository_id, value => { value.error = 'could-not-check-proposals'; });
      return { ok: false, error: 'could-not-check-proposals' };
    }
  }
  settle(cwd, state) {
    const identity = this.#identity(cwd);
    if (!state?.merged?.fresh || !['M1', 'M2'].includes(state.rule) || !this.#read(identity.repository_id)) return;
    const answer = state.rule === 'M1' ? 'yes' : 'no';
    this.#update(identity.repository_id, value => {
      const completed = value.requests.filter(item => item.answer === answer && Date.parse(state.merged.fetched_at) >= Date.parse(item.at));
      value.requests = value.requests.filter(item => !completed.includes(item));
      value.proposals = value.proposals.filter(item => !completed.some(request => request.proposal === item.number));
    });
  }
  prepare(cwd, run, binding = null) {
    const identity = this.#identity(cwd), governance = require('./toolkit-governance-state.cjs');
    const value = this.#read(identity.repository_id), request = value?.requests.find(item => item.run === run);
    if (!request || !['yes', 'no'].includes(request.answer) || !cache.isFresh({ fetched_at: request.at }, this.#now())) fail('PROPOSAL_RECEIPT_REQUIRED');
    const repository = governance.remoteSlug(identity.remote);
    // A retired key (nothing reads it) is left out, so a turn-on or refresh never carries it forward.
    const { withoutRetiredKeys } = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');
    const proposal = request.answer === 'no' ? { schema: BINDING_V2, repository, governance: 'disabled' } : withoutRetiredKeys(bindingV2(binding));
    if (!proposal || governance.bindingProblems(proposal, identity).length || (request.answer === 'yes' && proposal.governance === 'disabled')) fail('PROPOSAL_ADOPTION_INCOMPLETE');
    return { identity, request, repository, binding: proposal, text: `${JSON.stringify(proposal, null, 2)}\n` };
  }
  // `bank` is true only for the governance question bank's own answer, and `rendered` is the folder
  // outside the checkout its turn-on rendered the missing CI files into (null: none).
  publish(cwd, run, binding = null, bank = false, rendered = null) {
    this.prepare(cwd, run, binding);
    if (!this.#transport) fail('PROPOSAL_TRANSPORT_UNAVAILABLE');
    const checked = this.refresh(cwd);
    if (!checked.ok) fail('PROPOSAL_DISCOVERY_UNAVAILABLE');
    // Refresh can end a receipt when its PR closed or merged. Never reuse the earlier copy.
    let prepared = this.prepare(cwd, run, binding);
    if (checked.canWrite === false) fail('PROPOSAL_WRITE_REQUIRED');
    const matches = checked.proposals.filter(item => item.answer === prepared.request.answer);
    if (checked.proposals.some(item => item.answer !== prepared.request.answer) || matches.length > 1) fail('PROPOSAL_CONFLICT');
    const yes = prepared.request.answer === 'yes';
    // The bank's own answer also refreshes an open turn-on pull request; any other caller reuses the
    // open one as it is.
    const refresh = Boolean(yes && matches[0] && bank && this.#transport.update);
    const cloud = yes && (!matches[0] || refresh) ? this.#cloudWorkflows(cwd) : { files: {}, warning: null };
    const files = matches[0] && !refresh ? null : yes ? adoptionFiles(cwd, prepared.text, cloud, rendered) : { [cache.BINDING_PATH]: prepared.text };
    // A bank turn-on requires the checks its own workflows add, next to any the default branch already
    // requires, so default-branch protection has them from the merge on.
    if (bank && yes && files) {
      const required = withOwnChecks(prepared.binding.required_checks, files);
      if (required !== prepared.binding.required_checks) {
        prepared = this.prepare(cwd, run, { ...prepared.binding, required_checks: required });
        files[cache.BINDING_PATH] = prepared.text;
      }
    }
    const proposal = refresh ? this.#transport.update(prepared.repository, matches[0].number, prepared.binding, files)
      : matches[0] || this.#transport.publish(prepared.repository, prepared.binding, files);
    let readback = this.#transport.read(prepared.repository, proposal.number);
    // Right after its branch moves, GitHub can still show the pull request's earlier head for a moment,
    // so an update is read again briefly before it counts as unverified.
    for (let tries = 0; proposal.updated === true && readback.head !== proposal.head && tries < READBACK_TRIES; tries += 1) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, READBACK_WAIT_MS);
      readback = this.#transport.read(prepared.repository, proposal.number);
    }
    if (!validProposal(readback, prepared.repository) || readback.head !== proposal.head || readback.answer !== prepared.request.answer) fail('PROPOSAL_PUBLISH_READBACK_FAILED');
    this.#update(prepared.identity.repository_id, value => {
      value.requests = value.requests.map(item => item.run === run ? { ...item, proposal: readback.number, head: readback.head } : item);
      value.proposals = [readback]; value.checked_at = this.#now().toISOString(); value.error = null;
    });
    // What GitHub already holds decides what was written (toolkit-governance-owner-files.cjs), so a checkout
    // that is behind never counts a file it kept, or one already there, as added.
    const left = new Set(proposal.left || []), there = new Set([...left, ...(proposal.onBase || [])]);
    const notes = [...new Set([...(cloud.notes || []), ...(proposal.notes || [])])];
    const entryFile = id => require('./toolkit-cloud-workflows.cjs').DEFAULT_CLOUD_WORKFLOWS.find(entry => entry.id === id)?.file;
    return { proposal: readback, text: proposalText([readback]), files: files ? Object.keys(files).filter(name => !left.has(name)) : null, reused: Boolean(matches[0]), updated: proposal.updated === true, ...(bank && yes && files ? { requiredChecks: prepared.binding.required_checks } : {}), ...(cloud.warning ? { warning: cloud.warning } : {}), ...(notes.length ? { notes } : {}), ...(cloud.added ? { added: cloud.added.filter(id => !there.has(entryFile(id))) } : {}) };
  }
}

// A proposal that also sets the repository's task auto-merge switch says so, and warns that older
// Toolkit copies read a binding with that key as invalid until they update.
function switchNote(binding) {
  if (!binding?.task_prs) return '';
  const set = Object.entries(binding.task_prs).map(([name, value]) => `\`task_prs.${name}\` to \`${value}\``).join(' and ');
  return ` It sets this repository's switches: ${set}.\n\n${require('./toolkit-governance-state.cjs').taskSwitchVersionLine()}`;
}

// The owner-facing words for a switch change ({ auto_merge, merge_train }).
function switchWords(changes) {
  return [
    ...(changes.auto_merge ? [`task auto-merge ${changes.auto_merge === 'after-gates' ? 'on' : 'off'}`] : []),
    ...(changes.merge_train ? [`merge trains ${changes.merge_train}`] : []),
  ].join(' and ');
}
// The owner-facing words for a programme file update (toolkit-governance-summary.cjs programmeUpdate),
// for the summary's question and the pull request alike.
function updateWords(update) {
  const listed = items => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : items[0] || '');
  return [
    update.min_toolkit ? `sets min_toolkit to ${update.min_toolkit.to}${update.min_toolkit.from ? ` (now ${update.min_toolkit.from})` : ''}, so governance waits while a setup part is missing` : '',
    update.added.length ? `adds ${listed(update.added)} to the required checks${update.required_checks.length > update.added.length ? ', keeping the ones already listed' : ''}` : '',
  ].filter(Boolean).join(', and ');
}
// The retired binding keys (programme-state.cjs) the merged text holds and the new text leaves out,
// named as one phrase for the pull request text, or null when none goes.
function retiredDropped(mergedText, text) {
  const { RETIRED_BINDING_KEYS } = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');
  const parse = value => { try { const parsed = JSON.parse(String(value).replace(/^\uFEFF/, '')); return parsed && typeof parsed === 'object' ? parsed : {}; } catch { return {}; } };
  const before = parse(mergedText), after = parse(text);
  const dropped = RETIRED_BINDING_KEYS.filter(key => Object.hasOwn(before, key) && !Object.hasOwn(after, key));
  return dropped.length ? `the retired ${dropped.map(key => `\`${key}\``).join(' and ')}, which nothing reads any more` : null;
}

const SWITCH_MEANING = Object.freeze({
  auto_merge: { 'after-gates': 'Task auto-merge on: a finished task pull request may merge once its review, required checks and testing pass. Governance, hooks, setup and merge-rule changes still wait for a typed merge.', off: 'Task auto-merge off: every pull request waits for a typed merge.' },
  merge_train: { on: 'Merge trains on: reviewed pull requests that are ready together land as one merge train with one version bump.', off: 'Merge trains off: each pull request lands on its own.' },
});

function validProposal(value, repository) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && typeof value.repository === 'string' && value.repository.toLowerCase() === repository.toLowerCase() && Number.isSafeInteger(value.number) && value.number > 0
    && SHA.test(value.head) && ['yes', 'no'].includes(value.answer) && value.state === 'open'
    && typeof value.url === 'string' && value.url.toLowerCase() === `https://github.com/${repository}/pull/${value.number}`.toLowerCase());
}

// Authenticated CLI transport. No merge, setup, issue, evidence-store or security-setting writes.
// Git data API keeps the user's worktree/index untouched and writes only a proposal branch.
class GitHubProposalTransport {
  #run;
  constructor({ run = null, command = null } = {}) {
    // A command dependency lets offline tests exercise the actual child-process runner.
    this.#run = run || ((args, input, { deadline } = {}) => {
      const timeout = deadline === undefined ? 15000 : Math.min(15000, deadline - Date.now());
      if (timeout <= 0) fail('PROPOSAL_GITHUB_UNAVAILABLE');
      const result = spawnSync(command ? command[0] : resolvePathExecutable('gh'), [...(command ? command.slice(1) : []), ...args], { input: input === undefined ? undefined : JSON.stringify(input), encoding: 'utf8', timeout, windowsHide: true, maxBuffer: GITHUB_LIMIT });
      if (result.error || result.status !== 0) fail(/\(HTTP 404\)/.test(result.stderr || '') ? 'PROPOSAL_NOT_FOUND' : 'PROPOSAL_GITHUB_UNAVAILABLE');
      return result.stdout;
    });
  }
  #api(endpoint, input, method = null, jq = null) { return JSON.parse(this.#run(['api', endpoint, ...(method ? ['--method', method] : []), ...(input === undefined ? [] : ['--input', '-']), ...(jq ? ['--jq', jq] : [])], input)); }
  #optional(endpoint) {
    try { return this.#api(endpoint); }
    catch (error) { if (error.code === 'PROPOSAL_NOT_FOUND') return null; throw error; }
  }
  // The Toolkit's cloud workflow copies on the default branch at `ref`: each workflow file that starts
  // with the rendered-copy marker of a copy that may sit at its path (the sweep, its gate, and the
  // retired Shard Timings and test shards copies, the latter at whatever name its shard list chose).
  #cloudCopies(repository, ref) {
    const workflows = require('./toolkit-cloud-workflows.cjs');
    const listing = this.#optional(`repos/${repository}/contents/.github/workflows?ref=${ref}`);
    const names = Array.isArray(listing) ? listing.filter(entry => entry && entry.type === 'file' && typeof entry.name === 'string').map(entry => entry.name) : null;
    return workflows.copyCandidates(names).filter(name => {
      const file = this.#optional(`repos/${repository}/contents/${name}?ref=${ref}`);
      return Boolean(file && file.type === 'file' && file.encoding === 'base64' && typeof file.content === 'string' && workflows.copyIdAt(name, Buffer.from(file.content, 'base64').toString('utf8')));
    });
  }
  // The text of a path at a commit for toolkit-governance-owner-files.cjs: null when nothing is there.
  #held(repository, name, ref) {
    const file = this.#optional(`repos/${repository}/contents/${name}?ref=${ref}`);
    if (file === null) return null;
    return file.type === 'file' && file.encoding === 'base64' && typeof file.content === 'string' ? Buffer.from(file.content, 'base64').toString('utf8') : ownerFiles().UNREADABLE;
  }
  #auth() {
    this.#run(['auth', 'status']);
    const account = this.#api('user');
    if (!/^[A-Za-z0-9-]+$/.test(account?.login || '')) fail('PROPOSAL_ACCOUNT_UNAVAILABLE');
  }
  canWrite(repository) {
    const permissions = this.#api(`repos/${repository}`, undefined, null, '.permissions');
    if (typeof permissions?.push !== 'boolean') fail('PROPOSAL_PERMISSION_UNAVAILABLE');
    return permissions.push;
  }
  state(repository, number, { deadline }) {
    const state = this.#run(['api', `repos/${repository}/pulls/${number}`, '--jq', '.state'], undefined, { deadline }).trim();
    if (!['open', 'closed'].includes(state)) fail('PROPOSAL_GITHUB_UNAVAILABLE');
    return state;
  }
  // Whether a pull request is open, merged or closed without merging (the post-merge finish reads it).
  outcome(repository, number) {
    const value = this.#run(['api', `repos/${repository}/pulls/${number}`, '--jq', '.state + " " + (.merged | tostring)']).trim();
    if (value === 'open false') return 'open';
    if (value === 'closed true') return 'merged';
    if (value === 'closed false') return 'closed';
    return fail('PROPOSAL_GITHUB_UNAVAILABLE');
  }
  // Walk only the root and .github trees, retaining the regular-file check without enumerating the repository.
  #bindingEntry(repository, treeSha) {
    const tree = sha => {
      const value = this.#api(`repos/${repository}/git/trees/${sha}`);
      if (value.truncated || !Array.isArray(value.tree)) fail('PROPOSAL_TREE_UNREADABLE');
      return value.tree;
    };
    const directory = tree(treeSha).find(item => item.path === '.github');
    if (!directory) return null;
    if (directory.type !== 'tree' || directory.mode !== '040000' || !SHA.test(directory.sha)) fail('PROPOSAL_BINDING_NOT_REGULAR');
    const file = tree(directory.sha).find(item => item.path === 'toolkit-programme.json');
    if (file && (file.type !== 'blob' || !['100644', '100755'].includes(file.mode))) fail('PROPOSAL_BINDING_NOT_REGULAR');
    return file || null;
  }
  read(repository, number) {
    const pr = this.#api(`repos/${repository}/pulls/${number}`);
    if (pr.state !== 'open' || !pr.body?.includes(MARKER) || pr.head?.repo?.full_name?.toLowerCase() !== repository.toLowerCase() || !SHA.test(pr.head.sha)) fail('PROPOSAL_PR_INVALID');
    const repo = this.#api(`repos/${repository}`);
    if (pr.base?.ref !== repo.default_branch) fail('PROPOSAL_BASE_INVALID');
    const commit = this.#api(`repos/${repository}/git/commits/${pr.head.sha}`);
    const entry = this.#bindingEntry(repository, commit.tree?.sha);
    if (!entry) fail('PROPOSAL_BINDING_INVALID');
    const file = this.#api(`repos/${repository}/contents/${cache.BINDING_PATH}?ref=${pr.head.sha}`);
    if (file.type !== 'file' || file.sha !== entry.sha || file.encoding !== 'base64' || typeof file.content !== 'string' || !Number.isSafeInteger(file.size) || file.size > 65536) fail('PROPOSAL_BINDING_INVALID');
    const binding = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
    require('../../skills/github-program-reconciler/scripts/programme-state.cjs').validateBinding(binding);
    if (binding.repository.toLowerCase() !== repository.toLowerCase()) fail('PROPOSAL_BINDING_INVALID');
    // Off needs only its programme file, plus removing the Toolkit's cloud sweep copies. An enabled
    // adoption PR may also prepare governed rules; its complete external effects and checks still
    // need the owner's merge approval.
    if (binding.governance === 'disabled') {
      const files = this.#api(`repos/${repository}/pulls/${number}/files?per_page=100`);
      // Removals are workflow files only; each must also be a marked copy where the PR started (below).
      const valid = Array.isArray(files) && pr.changed_files === files.length
        && files.filter(file => file.filename === cache.BINDING_PATH && ['added', 'modified'].includes(file.status)).length === 1
        && files.every(file => file.filename === cache.BINDING_PATH || (/^\.github\/workflows\/[A-Za-z0-9][A-Za-z0-9._-]*\.ya?ml$/.test(file.filename) && file.status === 'removed'));
      if (!valid) fail('PROPOSAL_SCOPE_INVALID');
      // A removed sweep path must have been the Toolkit's own marked copy where the PR started.
      const removed = files.filter(file => file.status === 'removed').map(file => file.filename);
      if (removed.length) {
        const marked = SHA.test(pr.base?.sha || '') ? this.#cloudCopies(repository, pr.base.sha) : [];
        if (removed.some(name => !marked.includes(name))) fail('PROPOSAL_SCOPE_INVALID');
      }
    }
    return { repository, number: pr.number, head: pr.head.sha, url: pr.html_url, answer: binding.governance === 'disabled' ? 'no' : 'yes', state: pr.state };
  }
  list(repository) {
    const prs = this.#api(`repos/${repository}/pulls?state=open&per_page=100`, undefined, null, `map({number, marked: ((.body // "") | contains("${MARKER}"))})`);
    if (!Array.isArray(prs) || prs.length === 100) fail('PROPOSAL_LIST_INCOMPLETE');
    return prs.filter(pr => pr.marked === true).map(pr => this.read(repository, pr.number));
  }
  // One pull request that changes only the binding's switches (`changes`: { auto_merge, merge_train }). `mergedText` is the
  // binding this computer read from the default branch; a default branch that has moved since is
  // refused rather than overwritten. It carries no governance proposal marker, so it is never read
  // as a governance decision, and it merges only by the owner (bindings are never auto-merge eligible).
  // The default branch and the binding on it, refused when the binding is not `mergedText`: the text
  // this computer read, which a switch or a programme file update is built from, is never overwritten.
  #bindingBase(repository, mergedText) {
    this.#auth();
    const repo = this.#api(`repos/${repository}`), branch = repo.default_branch;
    if (!cache.parseSymref(`ref: refs/heads/${branch}\tHEAD`)) fail('PROPOSAL_BASE_INVALID');
    const base = this.#api(`repos/${repository}/git/ref/heads/${branch}`);
    if (!SHA.test(base.object?.sha)) fail('PROPOSAL_BASE_INVALID');
    const current = this.#api(`repos/${repository}/contents/${cache.BINDING_PATH}?ref=${base.object.sha}`);
    if (current.type !== 'file' || current.encoding !== 'base64' || typeof current.content !== 'string') fail('PROPOSAL_BINDING_INVALID');
    if (Buffer.from(current.content, 'base64').toString('utf8').replace(/\r\n/g, '\n') !== String(mergedText).replace(/\r\n/g, '\n')) fail('SWITCH_BASE_CHANGED');
    return { branch, base, current };
  }
  publishSwitch(repository, mergedText, text, changes) {
    const { branch, base, current } = this.#bindingBase(repository, mergedText);
    const words = switchWords(changes);
    const head = `toolkit/switches-${words.replace(/[^a-z0-9]+/g, '-')}-${key(text + base.object.sha)}`;
    const owner = repository.split('/')[0];
    const open = this.#api(`repos/${repository}/pulls?state=open&head=${encodeURIComponent(`${owner}:${head}`)}`);
    if (Array.isArray(open) && open[0]?.number) return { number: open[0].number, url: open[0].html_url, head: open[0].head?.sha || null };
    if (this.#optional(`repos/${repository}/git/ref/heads/${head}`)) fail('SWITCH_BRANCH_EXISTS');
    this.#api(`repos/${repository}/git/refs`, { ref: `refs/heads/${head}`, sha: base.object.sha });
    const result = this.#api(`repos/${repository}/contents/${cache.BINDING_PATH}`, { message: `Set ${words} for this repository`, content: Buffer.from(text).toString('base64'), branch: head, sha: current.sha }, 'PUT');
    if (!SHA.test(result.commit?.sha || '')) fail('PROPOSAL_COMMIT_INVALID');
    const changed = Object.keys(changes).map(name => `\`task_prs.${name}\``).join(' and ');
    const meaning = Object.entries(changes).map(([name, value]) => SWITCH_MEANING[name]?.[value]).filter(Boolean).join('\n\n');
    const retired = retiredDropped(mergedText, text);
    const pr = this.#api(`repos/${repository}/pulls`, { title: `Set ${words} for this repository`, head, base: branch, body: `This changes only ${changed} in \`${cache.BINDING_PATH}\`${retired ? `, and deletes ${retired}` : ''}. These are this repository's own switches, read the same way by every app and the Projects controller.\n\n${meaning}\n\nIt applies only after the owner merges it. After the merge, \`refresh governance\` reads it back on each computer.\n\n${require('./toolkit-governance-state.cjs').taskSwitchVersionLine()}` });
    return { number: pr.number, url: pr.html_url, head: result.commit.sha };
  }
  // The open programme file update of this repository's own (publishProgrammeUpdate), or null.
  openProgrammeUpdate(repository) {
    this.#auth();
    const prs = this.#api(`repos/${repository}/pulls?state=open&per_page=100`, undefined, null, 'map({number, url: .html_url, ref: .head.ref, repo: .head.repo.full_name})');
    if (!Array.isArray(prs) || prs.length === 100) fail('PROPOSAL_LIST_INCOMPLETE');
    const found = prs.find(pr => String(pr.repo).toLowerCase() === repository.toLowerCase() && UPDATE_BRANCH.test(String(pr.ref)));
    return found ? { number: found.number, url: found.url } : null;
  }
  // One pull request that brings an older governed programme file up to date (`update`, from
  // toolkit-governance-summary.cjs programmeUpdate): min_toolkit and required_checks only, from the
  // exact merged text. Like a switch it carries no governance proposal marker and merges only by the owner.
  publishProgrammeUpdate(repository, mergedText, text, update) {
    const { branch, base, current } = this.#bindingBase(repository, mergedText);
    const head = `toolkit/programme-update-${key(text + base.object.sha)}`;
    const owner = repository.split('/')[0];
    const same = this.#api(`repos/${repository}/pulls?state=open&head=${encodeURIComponent(`${owner}:${head}`)}`);
    if (Array.isArray(same) && same[0]?.number) return { number: same[0].number, url: same[0].html_url, head: same[0].head?.sha || null };
    // Another update still open is the one to merge or close, never a second beside it.
    const waiting = this.openProgrammeUpdate(repository);
    if (waiting) throw Object.assign(new Error('UPDATE_PR_OPEN'), { code: 'UPDATE_PR_OPEN', url: waiting.url });
    if (this.#optional(`repos/${repository}/git/ref/heads/${head}`)) fail('SWITCH_BRANCH_EXISTS');
    this.#api(`repos/${repository}/git/refs`, { ref: `refs/heads/${head}`, sha: base.object.sha });
    const title = 'Bring the programme file up to date';
    const result = this.#api(`repos/${repository}/contents/${cache.BINDING_PATH}`, { message: title, content: Buffer.from(text).toString('base64'), branch: head, sha: current.sha }, 'PUT');
    if (!SHA.test(result.commit?.sha || '')) fail('PROPOSAL_COMMIT_INVALID');
    const words = updateWords(update);
    const why = [
      update.min_toolkit ? `min_toolkit ${update.min_toolkit.to}: governance holds programme records, gate records and task auto-merge while a part of the setup is missing (no Governance App, an evidence store that cannot be used, or Toolkit permissions never set up on a computer), and every Toolkit copy older than ${update.min_toolkit.to} is asked to update first.` : '',
      update.added.length ? `Required checks: ${update.added.map(check => `\`${check}\``).join(', ')} ${update.added.length === 1 ? 'is' : 'are'} already required on the default branch or run by Toolkit's own checks; the checks already listed stay. After the merge, Toolkit's default-branch protection requires the whole list.` : '',
    ].filter(Boolean).join('\n\n');
    const retired = retiredDropped(mergedText, text);
    const pr = this.#api(`repos/${repository}/pulls`, { title, head, base: branch, body: `This ${words} in \`${cache.BINDING_PATH}\`${retired ? `, and deletes ${retired}` : ''}. Nothing else changes.\n\n${why}\n\nIt applies only after the owner merges it. After the merge, \`refresh governance\` reads it back on each computer.` });
    return { number: pr.number, url: pr.html_url, head: result.commit.sha };
  }
  publish(repository, binding, wanted = { [cache.BINDING_PATH]: `${JSON.stringify(binding, null, 2)}\n` }) {
    if (binding.governance !== 'disabled' && missingFiles(wanted).length) fail('PROPOSAL_ADOPTION_INCOMPLETE');
    this.#auth();
    const repo = this.#api(`repos/${repository}`), branch = repo.default_branch;
    if (!cache.parseSymref(`ref: refs/heads/${branch}\tHEAD`)) fail('PROPOSAL_BASE_INVALID');
    const base = this.#api(`repos/${repository}/git/ref/heads/${branch}`);
    if (!SHA.test(base.object?.sha)) fail('PROPOSAL_BASE_INVALID');
    const text = `${JSON.stringify(binding, null, 2)}\n`;
    const { files, ...judged } = binding.governance === 'disabled' ? { files: wanted } : new (ownerFiles().OwnerFiles)(wanted, { held: name => this.#held(repository, name, base.object.sha) }).judge();
    // Turning governance off also removes the Toolkit's cloud sweep copies that the default branch
    // holds. Only a file carrying the Toolkit's rendered-copy marker is removed; anything else stays.
    const removals = binding.governance === 'disabled' ? this.#cloudCopies(repository, base.object.sha) : [];
    const head = `toolkit/governance-${binding.governance === 'disabled' ? 'off' : 'on'}-${key(JSON.stringify(files) + JSON.stringify(removals) + base.object.sha)}`;
    const commit = this.#api(`repos/${repository}/git/commits/${base.object.sha}`);
    const existing = this.#bindingEntry(repository, commit.tree.sha);
    const previous = this.#optional(`repos/${repository}/git/ref/heads/${head}`);
    if (previous && !SHA.test(previous.object?.sha)) fail('PROPOSAL_BRANCH_CHANGED');
    let headSha = previous?.object.sha || base.object.sha;
    if (!previous) this.#api(`repos/${repository}/git/refs`, { ref: `refs/heads/${head}`, sha: base.object.sha });
    if (headSha !== base.object.sha) {
      // Recover only our exact prepared commit. A branch someone changed is never overwritten.
      const diff = this.#api(`repos/${repository}/compare/${base.object.sha}...${headSha}`);
      // The branch must hold exactly this proposal: its files, and every removal it lists, done.
      if (diff.total_commits !== 1 || diff.merge_base_commit?.sha !== base.object.sha || !diff.files?.length
        || diff.files.some(file => !Object.hasOwn(files, file.filename) && !(removals.includes(file.filename) && file.status === 'removed'))
        || removals.some(name => !diff.files.some(file => file.filename === name && file.status === 'removed'))) fail('PROPOSAL_BRANCH_CHANGED');
      for (const [name, content] of Object.entries(files)) {
        const file = this.#api(`repos/${repository}/contents/${name}?ref=${headSha}`);
        if (file.type !== 'file' || file.encoding !== 'base64' || typeof file.content !== 'string' || Buffer.from(file.content, 'base64').toString('utf8') !== content) fail('PROPOSAL_BRANCH_CHANGED');
      }
    } else {
      if (binding.governance === 'disabled' && !removals.length) {
        const result = this.#api(`repos/${repository}/contents/${cache.BINDING_PATH}`, { message: 'Set repository governance off', content: Buffer.from(text).toString('base64'), branch: head, ...(existing ? { sha: existing.sha } : {}) }, 'PUT');
        headSha = result.commit?.sha;
      } else {
        const tree = this.#api(`repos/${repository}/git/trees`, { base_tree: commit.tree.sha, tree: [
          ...Object.entries(files).map(([name, content]) => ({ path: name, mode: '100644', type: 'blob', content })),
          ...removals.map(name => ({ path: name, mode: '100644', type: 'blob', sha: null })),
        ] });
        const result = this.#api(`repos/${repository}/git/commits`, { message: binding.governance === 'disabled' ? 'Set repository governance off' : 'Prepare repository governance and checks', tree: tree.sha, parents: [base.object.sha] });
        headSha = result.sha;
        if (!SHA.test(headSha)) fail('PROPOSAL_COMMIT_INVALID');
        this.#api(`repos/${repository}/git/refs/heads/${head}`, { sha: headSha, force: false }, 'PATCH');
      }
      if (!SHA.test(headSha)) fail('PROPOSAL_COMMIT_INVALID');
    }
    const pr = this.#api(`repos/${repository}/pulls`, { title: `Set repository governance ${binding.governance === 'disabled' ? 'off' : 'on'}`, head, base: branch, body: proposalBody(binding, files, removals, [], judged.notes) });
    return { number: pr.number, head: headSha, ...judged };
  }
  // A re-run while the turn-on pull request is still open: the owner's new answer goes onto that same
  // branch as one more commit, never a second pull request. Only a branch this transport made is
  // updated (a governance-on branch in this repository, holding only turn-on files); anything else is
  // refused. The same files already there change nothing.
  update(repository, number, binding, wanted) {
    if (binding.governance === 'disabled' || missingFiles(wanted).length) fail('PROPOSAL_ADOPTION_INCOMPLETE');
    this.#auth();
    const read = this.read(repository, number);
    const pr = this.#api(`repos/${repository}/pulls/${number}`);
    const head = pr.head?.ref;
    if (read.answer !== 'yes' || typeof head !== 'string' || !head.startsWith('toolkit/governance-on-') || pr.head.sha !== read.head) fail('PROPOSAL_BRANCH_CHANGED');
    const diff = this.#api(`repos/${repository}/compare/${pr.base.sha}...${read.head}`);
    if (!Array.isArray(diff.files) || diff.files.some(file => !Object.hasOwn(wanted, file.filename) && !TURN_ON_NAMES.some(test => test(file.filename)))) fail('PROPOSAL_BRANCH_CHANGED');
    // A path on the branch that the pull request did not add is the default branch's.
    const own = new Set(diff.files.filter(file => ['added', 'renamed', 'copied'].includes(file.status)).map(file => file.filename));
    const { files, ...judged } = new (ownerFiles().OwnerFiles)(wanted, { held: name => this.#held(repository, name, read.head), onBase: name => !own.has(name) }).judge();
    const changed = Object.entries(files).filter(([name, content]) => this.#held(repository, name, read.head) !== content);
    // A file an earlier answer added that the new answers no longer make (a workflow copy this run
    // leaves out) leaves the pull request: one it added is deleted, and one it changed goes back to the
    // default branch's copy. Only a workflow carrying the Toolkit's rendered-copy marker on the branch
    // is Toolkit's to drop; a workflow someone else pushed there stays as it is.
    const workflows = require('./toolkit-cloud-workflows.cjs');
    const ours = name => {
      const file = this.#optional(`repos/${repository}/contents/${name}?ref=${read.head}`);
      return Boolean(file && file.type === 'file' && file.encoding === 'base64' && typeof file.content === 'string' && workflows.copyIdAt(name, Buffer.from(file.content, 'base64').toString('utf8')));
    };
    const dropped = diff.files.filter(file => !Object.hasOwn(wanted, file.filename) && file.status !== 'removed' && ours(file.filename));
    const restore = dropped.map(file => {
      if (file.status === 'added') return { path: file.filename, mode: '100644', type: 'blob', sha: null };
      const original = this.#optional(`repos/${repository}/contents/${file.filename}?ref=${diff.merge_base_commit?.sha || pr.base.sha}`);
      if (!original || original.type !== 'file' || !/^[0-9a-f]{40}$/.test(original.sha || '')) fail('PROPOSAL_BRANCH_CHANGED');
      return { path: file.filename, mode: '100644', type: 'blob', sha: original.sha };
    });
    if (!changed.length && !restore.length) return { number, head: read.head, updated: false, ...judged };
    const commit = this.#api(`repos/${repository}/git/commits/${read.head}`);
    const tree = this.#api(`repos/${repository}/git/trees`, { base_tree: commit.tree.sha, tree: [...changed.map(([name, content]) => ({ path: name, mode: '100644', type: 'blob', content })), ...restore] });
    const result = this.#api(`repos/${repository}/git/commits`, { message: 'Update repository governance from the owner\'s new answers', tree: tree.sha, parents: [read.head] });
    if (!SHA.test(result.sha || '')) fail('PROPOSAL_COMMIT_INVALID');
    // Not forced: a branch someone moved since it was read is refused by GitHub.
    this.#api(`repos/${repository}/git/refs/heads/${head}`, { sha: result.sha, force: false }, 'PATCH');
    this.#api(`repos/${repository}/pulls/${number}`, { body: proposalBody(binding, files, [], dropped.map(file => file.filename), judged.notes) }, 'PATCH');
    return { number, head: result.sha, updated: true, ...judged };
  }
}

// Files a turn-on branch may hold beyond the current set: an earlier answer may have added a workflow
// copy that the new answer no longer renders, and a default cloud workflow's own files stay when this
// run could not make the copies.
const TURN_ON_NAMES = [name => /^\.github\/workflows\/[A-Za-z0-9][A-Za-z0-9._-]*\.ya?ml$/.test(name), name => cloudFiles().includes(name)];

function proposalBody(binding, files, removals, dropped = [], notes = []) {
  return `${MARKER}\n\nThe programme file on the default branch decides governance on every computer. This proposal sets it to ${binding.governance === 'disabled' ? 'disabled' : 'enabled, with its CI checks; the installed Toolkit gives sessions the governed rules'}. Global coding rules still apply. It does not change credentials or deployment.${switchNote(binding)}\n\nPrepared files:\n${Object.keys(files).map(name => `- ${name}`).join('\n')}\n\n${removals.length ? `Removed files (the Toolkit's cloud workflow copies):\n${removals.map(name => `- ${name}`).join('\n')}\n\n` : ''}${dropped.length ? `No longer in this pull request (the latest answers do not make them):\n${dropped.map(name => `- ${name}`).join('\n')}\n\n` : ''}${notes.length ? `Already on GitHub:\n${notes.map(note => `- ${note}`).join('\n')}\n\n` : ''}Please merge this decision now after checking its effects and required checks. Owner merge permission is still required.`;
}
module.exports = Object.freeze({ GovernanceProposals, GitHubProposalTransport, validProposal, switchNote, proposalText, bindingV2, cloudWorkflowFiles, missingFiles, withOwnChecks, OWN_CHECKS, updateWords, REQUIRED_FILES, BANK_ONLY, SCHEMA, MARKER, PROMPT_BUDGET_MS });
