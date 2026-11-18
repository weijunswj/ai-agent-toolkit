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
const cloudFiles = () => require('./toolkit-cloud-workflows.cjs').WORKFLOWS.map(workflow => workflow.file);
// The dependency security files the turn-on adds where missing (toolkit-governance-adopt.cjs).
const securityFiles = () => { const security = require('./toolkit-governance-security.cjs'); return [security.DEPENDABOT_REL, '.github/dependabot.yaml', security.WORKFLOW_REL]; };
const READBACK_TRIES = 4, READBACK_WAIT_MS = 500;
function key(value) { return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 32); }
// A yes is published only by the governance question bank, whose script makes every piece itself.
const BANK_ONLY = 'A yes is published only from the governance question bank, which makes the store, parent issue, programme file and CI checks itself.';
// The files every turn-on pull request carries: the programme file and the plain-text check. A yes
// missing any of them is refused. The installed Toolkit delivers the governed rules and playbooks,
// so no instruction file is required or added.
const PLAIN_TEXT_FILES = Object.freeze(['.github/plain-text.json', '.github/scripts/plain-text-check.cjs', '.github/workflows/plain-text.yml']);
const REQUIRED_FILES = Object.freeze([cache.BINDING_PATH, ...PLAIN_TEXT_FILES]);
function missingFiles(files) { return REQUIRED_FILES.filter(name => typeof files[name] !== 'string'); }

// The cloud sweep copies a governed repository needs, pinned to this Toolkit checkout's own commit,
// which must be on its main branch:
// { files: { path: text }, warning }. Turning governance on carries them in the same pull request as
// the binding, so a repository never gets one without the other. A Toolkit source checkout runs its
// own workflow files, so it gets nothing and no warning. When the copies cannot be rendered, the
// existing ones (if any) still travel and the warning names the reason and the fix.
const CLOUD_FIX = 'run node repo/scripts/toolkit-cloud-workflows.cjs --repo <this repository> from a Toolkit checkout on main, commit the copies to the governance pull request, then run toolkit governance check';
// `ciShards` is the proposed binding's ci_shards answer, so the shard copies follow the pull request's
// own answer rather than this computer's last read of the merged binding. `root` and `commit` (the
// Toolkit checkout and the commit to pin) are only for tests.
// `source` is the Toolkit git checkout to render from (by default this copy, or the managed checkout
// from a plugin copy).
function cloudWorkflowFiles(cwd, { root = null, commit = null, ciShards = null, source: chosen = undefined } = {}) {
  // From a plugin copy the copies come from the managed checkout, rendered by that checkout's own
  // installer, so the render logic always matches the commit the copies are pinned to.
  const own = require('./toolkit-cloud-workflows.cjs');
  const source = root ? null : chosen === undefined ? own.sourceRoot() : chosen;
  const workflows = own.installerAt(source);
  if (workflows.isToolkitCheckout(cwd)) return { files: {}, warning: null };
  try {
    const result = workflows.plan({ repo: cwd, ciShards, ...(root ? { root } : {}), ...(commit ? { commit } : {}) });
    const unmanaged = result.rows.find(row => row.state === 'unmanaged');
    if (unmanaged) throw new workflows.InstallError(`${unmanaged.file} exists and is not a Toolkit copy; move it aside first`);
    return { files: Object.fromEntries(result.rows.map(row => [row.file, row.expected])), warning: null };
  } catch (error) {
    if (!(error instanceof workflows.InstallError)) throw error;
    return { files: {}, warning: `Toolkit: the cloud sweep copies were not refreshed in this pull request (${String(error.message).replace(/\.$/, '')}). To fix it, ${CLOUD_FIX}.` };
  }
}

// A version 1 binding moved to version 2 with the same meaning: enabled, its one parent in `parents`.
const BINDING_V2 = 'toolkit.programme-binding.v2';
function bindingV2(binding) {
  if (!binding || binding.schema !== 'toolkit.programme-binding.v1') return binding;
  const { schema, repository, parent_issue: issue, record_prefix, writer_prefix, ...rest } = binding;
  return { schema: BINDING_V2, repository, governance: 'enabled', parents: [{ issue, record_prefix, ...(writer_prefix === undefined ? {} : { writer_prefix }) }], ...rest };
}

// The turn-on file set: the programme file, plus the CI files the working tree carries (the bank
// installs the plain-text check and the dependency security files there first). Instruction files,
// product files and backups never join it.
function adoptionFiles(cwd, text, cloud = { files: {} }) {
  const names = [...['plain-text', 'personal-data-guard'].flatMap(name => [`.github/${name}.json`, `.github/scripts/${name === 'plain-text' ? 'plain-text-check' : name}.cjs`, `.github/workflows/${name}.yml`]), '.github/plain-text-baseline.json',
    ...cloudFiles(), require('./governed-test-shards.cjs').MANIFEST_REL, ...securityFiles()];
  const files = { [cache.BINDING_PATH]: text };
  for (const name of names) {
    const file = path.join(cwd, name);
    if (!fs.existsSync(file)) continue;
    let current = cwd;
    for (const part of name.split('/')) {
      current = path.join(current, part);
      if (fs.lstatSync(current).isSymbolicLink()) fail('PROPOSAL_ADOPTION_INCOMPLETE');
    }
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > LIMIT) fail('PROPOSAL_ADOPTION_INCOMPLETE');
    files[name] = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  }
  const all = { ...files, ...cloud.files };
  if (missingFiles(all).length) fail('PROPOSAL_ADOPTION_INCOMPLETE');
  return all;
}
function proposalText(proposals) {
  if (proposals.length > 1) return `Toolkit: conflicting governance proposals are waiting: ${proposals.map(item => item.url).join(', ')}. Ask the owner which proposal to keep. None decides governance.`;
  return `Toolkit: governance decision pending. ${proposals[0].url} changes the repository's governance to ${proposals[0].answer === 'yes' ? 'enabled' : 'disabled'} on every computer once merged. Ask the owner to merge this pull request now, with its external effects and current checks. This answer grants no merge permission.${proposals[0].answer === 'yes' ? ' Before pulling after merge, compare prepared untracked files with the merged copies. Preserve local differences and clear only verified duplicates with permission, so git pull can bring in the tracked files.' : ''}`;
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
    return { kind: 'preparing', ...request, text: `Toolkit: the owner's ${request.answer} is pending for this run. ${request.answer === 'yes' ? `${BANK_ONLY} Show the owner the bank again with node "${path.join(__dirname, 'toolkit-governance.cjs')}" setup and build nothing by hand.` : `Prepare and publish one governance decision pull request with node "${path.join(__dirname, 'toolkit-governance.cjs')}" publish --run ${request.run}. Then show its external effects and ask the owner to merge it now.`} Governance stays as merged on the default branch.` };
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
  // `bank` is true only for the governance question bank's own answer.
  publish(cwd, run, binding = null, bank = false) {
    this.prepare(cwd, run, binding);
    if (!this.#transport) fail('PROPOSAL_TRANSPORT_UNAVAILABLE');
    const checked = this.refresh(cwd);
    if (!checked.ok) fail('PROPOSAL_DISCOVERY_UNAVAILABLE');
    // Refresh can end a receipt when its PR closed or merged. Never reuse the earlier copy.
    const prepared = this.prepare(cwd, run, binding);
    if (checked.canWrite === false) fail('PROPOSAL_WRITE_REQUIRED');
    const matches = checked.proposals.filter(item => item.answer === prepared.request.answer);
    if (checked.proposals.some(item => item.answer !== prepared.request.answer) || matches.length > 1) fail('PROPOSAL_CONFLICT');
    const yes = prepared.request.answer === 'yes';
    // The bank's own answer also refreshes an open turn-on pull request; any other caller reuses the
    // open one as it is.
    const refresh = Boolean(yes && matches[0] && bank && this.#transport.update);
    const cloud = yes && (!matches[0] || refresh) ? this.#cloudWorkflows(cwd, { ciShards: prepared.binding.ci_shards?.answer || null }) : { files: {}, warning: null };
    const files = matches[0] && !refresh ? null : yes ? adoptionFiles(cwd, prepared.text, cloud) : { [cache.BINDING_PATH]: prepared.text };
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
    return { proposal: readback, text: proposalText([readback]), files: files ? Object.keys(files) : null, reused: Boolean(matches[0]), updated: proposal.updated === true, ...(cloud.warning ? { warning: cloud.warning } : {}) };
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
  // with the rendered-copy marker of a copy that may sit at its path (the sweep, its gate, Shard Timings,
  // and the test shards copy at whatever name its shard list chose).
  #cloudCopies(repository, ref) {
    const workflows = require('./toolkit-cloud-workflows.cjs');
    const listing = this.#optional(`repos/${repository}/contents/.github/workflows?ref=${ref}`);
    const names = Array.isArray(listing) ? listing.filter(entry => entry && entry.type === 'file' && typeof entry.name === 'string').map(entry => entry.name) : null;
    return workflows.copyCandidates(names).filter(name => {
      const file = this.#optional(`repos/${repository}/contents/${name}?ref=${ref}`);
      return Boolean(file && file.type === 'file' && file.encoding === 'base64' && typeof file.content === 'string' && workflows.copyIdAt(name, Buffer.from(file.content, 'base64').toString('utf8')));
    });
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
  publishSwitch(repository, mergedText, text, changes) {
    this.#auth();
    const repo = this.#api(`repos/${repository}`), branch = repo.default_branch;
    if (!cache.parseSymref(`ref: refs/heads/${branch}\tHEAD`)) fail('PROPOSAL_BASE_INVALID');
    const base = this.#api(`repos/${repository}/git/ref/heads/${branch}`);
    if (!SHA.test(base.object?.sha)) fail('PROPOSAL_BASE_INVALID');
    const current = this.#api(`repos/${repository}/contents/${cache.BINDING_PATH}?ref=${base.object.sha}`);
    if (current.type !== 'file' || current.encoding !== 'base64' || typeof current.content !== 'string') fail('PROPOSAL_BINDING_INVALID');
    if (Buffer.from(current.content, 'base64').toString('utf8').replace(/\r\n/g, '\n') !== String(mergedText).replace(/\r\n/g, '\n')) fail('SWITCH_BASE_CHANGED');
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
  // The owner's sharded CI answer: one pull request that changes only ci_shards in the binding, from the
  // exact merged text, and for yes adds a first shard list (`list`) when the default branch has none.
  // Switch `changes` from the same answer ({ auto_merge, merge_train }) join it, so the two never conflict.
  publishCiShards(repository, mergedText, text, answer, list = null, changes = {}) {
    this.#auth();
    const repo = this.#api(`repos/${repository}`), branch = repo.default_branch;
    if (!cache.parseSymref(`ref: refs/heads/${branch}\tHEAD`)) fail('PROPOSAL_BASE_INVALID');
    const base = this.#api(`repos/${repository}/git/ref/heads/${branch}`);
    if (!SHA.test(base.object?.sha)) fail('PROPOSAL_BASE_INVALID');
    const current = this.#api(`repos/${repository}/contents/${cache.BINDING_PATH}?ref=${base.object.sha}`);
    if (current.type !== 'file' || current.encoding !== 'base64' || typeof current.content !== 'string') fail('PROPOSAL_BINDING_INVALID');
    if (Buffer.from(current.content, 'base64').toString('utf8').replace(/\r\n/g, '\n') !== String(mergedText).replace(/\r\n/g, '\n')) fail('SWITCH_BASE_CHANGED');
    const LIST = '.github/toolkit-test-shards.json';
    const addList = typeof list === 'string' && !this.#optional(`repos/${repository}/contents/${LIST}?ref=${base.object.sha}`);
    const words = switchWords(changes);
    const head = `toolkit/${words ? `switches-${words.replace(/[^a-z0-9]+/g, '-')}-` : ''}ci-shards-${answer}-${key(text + (addList ? list : '') + base.object.sha)}`;
    const owner = repository.split('/')[0];
    const open = this.#api(`repos/${repository}/pulls?state=open&head=${encodeURIComponent(`${owner}:${head}`)}`);
    if (Array.isArray(open) && open[0]?.number) return { number: open[0].number, url: open[0].html_url, head: open[0].head?.sha || null };
    if (this.#optional(`repos/${repository}/git/ref/heads/${head}`)) fail('SWITCH_BRANCH_EXISTS');
    this.#api(`repos/${repository}/git/refs`, { ref: `refs/heads/${head}`, sha: base.object.sha });
    const title = words ? `Set ${words} and parallel CI shards ${answer === 'yes' ? 'yes' : 'never ask'} for this repository`
      : answer === 'yes' ? 'Split this repository\'s tests into parallel CI shards' : 'Stop offering parallel CI shards for this repository';
    let result = this.#api(`repos/${repository}/contents/${cache.BINDING_PATH}`, { message: title, content: Buffer.from(text).toString('base64'), branch: head, sha: current.sha }, 'PUT');
    if (!SHA.test(result.commit?.sha || '')) fail('PROPOSAL_COMMIT_INVALID');
    if (addList) {
      result = this.#api(`repos/${repository}/contents/${LIST}`, { message: 'Add a first test shard list', content: Buffer.from(list).toString('base64'), branch: head }, 'PUT');
      if (!SHA.test(result.commit?.sha || '')) fail('PROPOSAL_COMMIT_INVALID');
    }
    const what = answer === 'yes'
      ? `Yes: the next rules refresh copies the Toolkit test shards workflow (its gate job, \`Toolkit test shards\`, checks every test file ran once on each system) and Shard Timings, while \`${LIST}\` is a usable shard list.${addList ? ` This pull request adds a first \`${LIST}\`: Node tests run with node --test, split across Linux shards; Shard Timings rebalances them from measured times.` : ''}`
      : 'Never: Toolkit does not offer parallel CI shards here again. Nothing is copied.';
    const switched = words ? ` It also sets ${Object.keys(changes).map(name => `\`task_prs.${name}\``).join(' and ')}.` : '';
    const meaning = Object.entries(changes).map(([name, value]) => SWITCH_MEANING[name]?.[value]).filter(Boolean).map(line => `\n\n${line}`).join('');
    const retired = retiredDropped(mergedText, text);
    const pr = this.#api(`repos/${repository}/pulls`, { title, head, base: branch, body: `This sets \`ci_shards\` in \`${cache.BINDING_PATH}\` to \`${answer}\`, the owner's answer to the parallel CI shards question.${switched}${addList ? ` It also adds \`${LIST}\`.` : ''}${retired ? ` It also deletes ${retired}.` : ''} Nothing else changes.\n\n${what}${meaning}\n\nIt applies only after the owner merges it.\n\n${require('./toolkit-governance-state.cjs').taskSwitchVersionLine()}` });
    return { number: pr.number, url: pr.html_url, head: result.commit.sha };
  }
  publish(repository, binding, files = { [cache.BINDING_PATH]: `${JSON.stringify(binding, null, 2)}\n` }) {
    if (binding.governance !== 'disabled' && missingFiles(files).length) fail('PROPOSAL_ADOPTION_INCOMPLETE');
    this.#auth();
    const repo = this.#api(`repos/${repository}`), branch = repo.default_branch;
    if (!cache.parseSymref(`ref: refs/heads/${branch}\tHEAD`)) fail('PROPOSAL_BASE_INVALID');
    const base = this.#api(`repos/${repository}/git/ref/heads/${branch}`);
    if (!SHA.test(base.object?.sha)) fail('PROPOSAL_BASE_INVALID');
    const text = `${JSON.stringify(binding, null, 2)}\n`;
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
    const pr = this.#api(`repos/${repository}/pulls`, { title: `Set repository governance ${binding.governance === 'disabled' ? 'off' : 'on'}`, head, base: branch, body: proposalBody(binding, files, removals) });
    return { number: pr.number, head: headSha };
  }
  // A re-run while the turn-on pull request is still open: the owner's new answer goes onto that same
  // branch as one more commit, never a second pull request. Only a branch this transport made is
  // updated (a governance-on branch in this repository, holding only turn-on files); anything else is
  // refused. The same files already there change nothing.
  update(repository, number, binding, files) {
    if (binding.governance === 'disabled' || missingFiles(files).length) fail('PROPOSAL_ADOPTION_INCOMPLETE');
    this.#auth();
    const read = this.read(repository, number);
    const pr = this.#api(`repos/${repository}/pulls/${number}`);
    const head = pr.head?.ref;
    if (read.answer !== 'yes' || typeof head !== 'string' || !head.startsWith('toolkit/governance-on-') || pr.head.sha !== read.head) fail('PROPOSAL_BRANCH_CHANGED');
    const diff = this.#api(`repos/${repository}/compare/${pr.base.sha}...${read.head}`);
    if (!Array.isArray(diff.files) || diff.files.some(file => !Object.hasOwn(files, file.filename) && !TURN_ON_NAMES.some(test => test(file.filename)))) fail('PROPOSAL_BRANCH_CHANGED');
    const changed = Object.entries(files).filter(([name, content]) => {
      const file = this.#optional(`repos/${repository}/contents/${name}?ref=${read.head}`);
      return !file || file.type !== 'file' || file.encoding !== 'base64' || Buffer.from(String(file.content), 'base64').toString('utf8') !== content;
    });
    // A file an earlier answer added that the new answers no longer make (shard workflows and the
    // shard list after shards go from yes to not now) leaves the pull request: one it added is
    // deleted, and one it changed goes back to the default branch's copy. Only the shard list and a
    // workflow carrying the Toolkit's rendered-copy marker on the branch are Toolkit's to drop; a
    // workflow someone else pushed there stays as it is.
    const workflows = require('./toolkit-cloud-workflows.cjs');
    const ours = name => {
      if (name === require('./governed-test-shards.cjs').MANIFEST_REL) return true;
      const file = this.#optional(`repos/${repository}/contents/${name}?ref=${read.head}`);
      return Boolean(file && file.type === 'file' && file.encoding === 'base64' && typeof file.content === 'string' && workflows.copyIdAt(name, Buffer.from(file.content, 'base64').toString('utf8')));
    };
    const dropped = diff.files.filter(file => !Object.hasOwn(files, file.filename) && file.status !== 'removed' && ours(file.filename));
    const restore = dropped.map(file => {
      if (file.status === 'added') return { path: file.filename, mode: '100644', type: 'blob', sha: null };
      const original = this.#optional(`repos/${repository}/contents/${file.filename}?ref=${diff.merge_base_commit?.sha || pr.base.sha}`);
      if (!original || original.type !== 'file' || !/^[0-9a-f]{40}$/.test(original.sha || '')) fail('PROPOSAL_BRANCH_CHANGED');
      return { path: file.filename, mode: '100644', type: 'blob', sha: original.sha };
    });
    if (!changed.length && !restore.length) return { number, head: read.head, updated: false };
    const commit = this.#api(`repos/${repository}/git/commits/${read.head}`);
    const tree = this.#api(`repos/${repository}/git/trees`, { base_tree: commit.tree.sha, tree: [...changed.map(([name, content]) => ({ path: name, mode: '100644', type: 'blob', content })), ...restore] });
    const result = this.#api(`repos/${repository}/git/commits`, { message: 'Update repository governance from the owner\'s new answers', tree: tree.sha, parents: [read.head] });
    if (!SHA.test(result.sha || '')) fail('PROPOSAL_COMMIT_INVALID');
    // Not forced: a branch someone moved since it was read is refused by GitHub.
    this.#api(`repos/${repository}/git/refs/heads/${head}`, { sha: result.sha, force: false }, 'PATCH');
    this.#api(`repos/${repository}/pulls/${number}`, { body: proposalBody(binding, files, [], dropped.map(file => file.filename)) }, 'PATCH');
    return { number, head: result.sha, updated: true };
  }
}

// Files a turn-on branch may hold beyond the current set: an earlier answer may have added shard
// workflows or a shard list that the new answer no longer renders.
const TURN_ON_NAMES = [name => /^\.github\/workflows\/[A-Za-z0-9][A-Za-z0-9._-]*\.ya?ml$/.test(name), name => name === require('./governed-test-shards.cjs').MANIFEST_REL];

function proposalBody(binding, files, removals, dropped = []) {
  return `${MARKER}\n\nThe programme file on the default branch decides governance on every computer. This proposal sets it to ${binding.governance === 'disabled' ? 'disabled' : 'enabled, with its CI checks; the installed Toolkit gives sessions the governed rules'}. Global coding rules still apply. It does not change credentials or deployment.${switchNote(binding)}\n\nPrepared files:\n${Object.keys(files).map(name => `- ${name}`).join('\n')}\n\n${removals.length ? `Removed files (the Toolkit's cloud workflow copies):\n${removals.map(name => `- ${name}`).join('\n')}\n\n` : ''}${dropped.length ? `No longer in this pull request (the latest answers do not make them):\n${dropped.map(name => `- ${name}`).join('\n')}\n\n` : ''}Please merge this decision now after checking its effects and required checks. Owner merge permission is still required.`;
}
module.exports = Object.freeze({ GovernanceProposals, GitHubProposalTransport, validProposal, switchNote, proposalText, bindingV2, cloudWorkflowFiles, missingFiles, REQUIRED_FILES, BANK_ONLY, SCHEMA, MARKER, PROMPT_BUDGET_MS });
