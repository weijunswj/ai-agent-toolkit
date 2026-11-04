'use strict';

// Owns pending owner answers and decision proposals. Neither a receipt nor a PR is governance.
// Only startup/status discover PRs; tool hooks read the observation, without network calls.
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
const SHA = /^[a-f0-9]{40}$/;
const EPOCH = /^[a-f0-9]{32}$/;
function fail(code) { throw Object.assign(new Error(code), { code }); }
function key(value) { return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 32); }
function proposalText(proposals) {
  if (proposals.length > 1) return `Toolkit: conflicting governance proposals are waiting: ${proposals.map(item => item.url).join(', ')}. Ask the owner which proposal to keep. None decides governance.`;
  return `Toolkit: governance decision pending. ${proposals[0].url} changes the repository's governance to ${proposals[0].answer === 'yes' ? 'enabled' : 'disabled'} on every computer once merged. Ask the owner to merge this pull request now, with its external effects and current checks. This answer grants no merge permission.`;
}

class GovernanceProposals {
  #directory; #now; #transport; #identityReader;
  constructor({ registryOptions = {}, now = () => new Date(), transport = null, identityReader = null } = {}) {
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
    const proposals = fresh ? value.proposals.filter(item => validProposal(item, require('./toolkit-governance-state.cjs').remoteSlug(identity.remote))) : [];
    if (proposals.length) return { kind: proposals.length > 1 ? 'conflict' : 'published', proposals, text: proposalText(proposals) };
    const run = sessionId && EPOCH.test(epoch) ? key(`${sessionId}:${epoch}`) : null;
    const request = value.requests.find(item => item.run === run && ['yes', 'no'].includes(item.answer) && this.#now() - new Date(item.at) >= 0 && this.#now() - new Date(item.at) <= cache.FRESH_MS);
    if (!request) return null;
    return { kind: 'preparing', ...request, text: `Toolkit: the owner's ${request.answer} is pending for this run. Prepare and publish one governance decision pull request with node "${path.join(__dirname, 'toolkit-governance.cjs')}" publish --run ${request.run}. ${request.answer === 'yes' ? 'Reuse the adoption proposal; ask only for missing parent, separate evidence store or required checks. ' : ''}Then show its external effects and ask the owner to merge it now. Governance stays as merged on the default branch.` };
  }
  // A failed query is unknown, never "there are no proposals". Closed unmerged PRs end requests.
  refresh(cwd) {
    const identity = this.#identity(cwd), governance = require('./toolkit-governance-state.cjs');
    const slug = governance.remoteSlug(identity.remote);
    try {
      if (!this.#transport) fail('PROPOSAL_TRANSPORT_UNAVAILABLE');
      const proposals = this.#transport.list(slug);
      if (!Array.isArray(proposals) || proposals.some(item => !validProposal(item, slug))) fail('PROPOSAL_RESPONSE_INVALID');
      this.#update(identity.repository_id, value => {
        value.requests = value.requests.filter(item => !item.proposal || proposals.some(proposal => proposal.number === item.proposal));
        value.proposals = proposals;
        value.checked_at = this.#now().toISOString();
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
    const proposal = request.answer === 'no' ? { schema: 'toolkit.programme-binding.v2', repository, governance: 'disabled' } : binding;
    if (!proposal || governance.bindingProblems(proposal, identity).length || (request.answer === 'yes' && proposal.governance === 'disabled')) fail('PROPOSAL_ADOPTION_INCOMPLETE');
    return { identity, request, repository, binding: proposal, text: `${JSON.stringify(proposal, null, 2)}\n` };
  }
  publish(cwd, run, binding = null) {
    const prepared = this.prepare(cwd, run, binding);
    if (!this.#transport) fail('PROPOSAL_TRANSPORT_UNAVAILABLE');
    const checked = this.refresh(cwd);
    if (!checked.ok) fail('PROPOSAL_DISCOVERY_UNAVAILABLE');
    const matches = checked.proposals.filter(item => item.answer === prepared.request.answer);
    if (checked.proposals.some(item => item.answer !== prepared.request.answer) || matches.length > 1) fail('PROPOSAL_CONFLICT');
    const proposal = matches[0] || this.#transport.publish(prepared.repository, prepared.binding, MARKER);
    const readback = this.#transport.read(prepared.repository, proposal.number);
    if (!validProposal(readback, prepared.repository) || readback.head !== proposal.head || readback.answer !== prepared.request.answer) fail('PROPOSAL_PUBLISH_READBACK_FAILED');
    this.#update(prepared.identity.repository_id, value => {
      value.requests = value.requests.map(item => item.run === run ? { ...item, proposal: readback.number, head: readback.head } : item);
      value.proposals = [readback]; value.checked_at = this.#now().toISOString(); value.error = null;
    });
    return { proposal: readback, text: proposalText([readback]) };
  }
}

function validProposal(value, repository) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && typeof value.repository === 'string' && value.repository.toLowerCase() === repository.toLowerCase() && Number.isSafeInteger(value.number) && value.number > 0
    && SHA.test(value.head) && ['yes', 'no'].includes(value.answer) && value.state === 'open'
    && typeof value.url === 'string' && value.url.toLowerCase() === `https://github.com/${repository}/pull/${value.number}`.toLowerCase());
}

// Authenticated CLI transport. No merge, setup, issue, evidence-store or security-setting writes.
// Git data API keeps the user's worktree/index untouched and writes only a proposal branch.
class GitHubProposalTransport {
  #run;
  constructor({ run = null } = {}) {
    this.#run = run || ((args, input) => {
      const result = spawnSync(resolvePathExecutable('gh'), args, { input: input === undefined ? undefined : JSON.stringify(input), encoding: 'utf8', timeout: 15000, windowsHide: true, maxBuffer: LIMIT });
      if (result.error || result.status !== 0) fail(/\(HTTP 404\)/.test(result.stderr || '') ? 'PROPOSAL_NOT_FOUND' : 'PROPOSAL_GITHUB_UNAVAILABLE');
      return result.stdout;
    });
  }
  #api(endpoint, input, method = null) { return JSON.parse(this.#run(['api', endpoint, ...(method ? ['--method', method] : []), ...(input === undefined ? [] : ['--input', '-'])], input)); }
  #optional(endpoint) {
    try { return this.#api(endpoint); }
    catch (error) { if (error.code === 'PROPOSAL_NOT_FOUND') return null; throw error; }
  }
  #auth() {
    this.#run(['auth', 'status']);
    const account = this.#api('user');
    if (!/^[A-Za-z0-9-]+$/.test(account?.login || '')) fail('PROPOSAL_ACCOUNT_UNAVAILABLE');
  }
  read(repository, number) {
    const pr = this.#api(`repos/${repository}/pulls/${number}`);
    if (pr.state !== 'open' || !pr.body?.includes(MARKER) || pr.head?.repo?.full_name?.toLowerCase() !== repository.toLowerCase() || !SHA.test(pr.head.sha)) fail('PROPOSAL_PR_INVALID');
    const repo = this.#api(`repos/${repository}`);
    if (pr.base?.ref !== repo.default_branch) fail('PROPOSAL_BASE_INVALID');
    const commit = this.#api(`repos/${repository}/git/commits/${pr.head.sha}`);
    const tree = this.#api(`repos/${repository}/git/trees/${commit.tree?.sha}?recursive=1`);
    const entry = Array.isArray(tree.tree) ? tree.tree.find(item => item.path === cache.BINDING_PATH) : null;
    if (tree.truncated || !entry || entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode)) fail('PROPOSAL_BINDING_INVALID');
    const file = this.#api(`repos/${repository}/contents/${cache.BINDING_PATH}?ref=${pr.head.sha}`);
    if (file.type !== 'file' || file.sha !== entry.sha || file.encoding !== 'base64' || typeof file.content !== 'string' || !Number.isSafeInteger(file.size) || file.size > 65536) fail('PROPOSAL_BINDING_INVALID');
    const binding = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
    require('../../skills/github-program-reconciler/scripts/programme-state.cjs').validateBinding(binding);
    if (binding.repository.toLowerCase() !== repository.toLowerCase()) fail('PROPOSAL_BINDING_INVALID');
    // Off needs only its programme file. An enabled adoption PR may also prepare governed rules;
    // its complete external effects and checks still need the owner's merge approval.
    if (binding.governance === 'disabled') {
      const files = this.#api(`repos/${repository}/pulls/${number}/files?per_page=100`);
      if (pr.changed_files !== 1 || !Array.isArray(files) || files.length !== 1 || files[0].filename !== cache.BINDING_PATH || !['added', 'modified'].includes(files[0].status)) fail('PROPOSAL_SCOPE_INVALID');
    }
    return { repository, number: pr.number, head: pr.head.sha, url: pr.html_url, answer: binding.governance === 'disabled' ? 'no' : 'yes', state: pr.state };
  }
  list(repository) {
    const prs = this.#api(`repos/${repository}/pulls?state=open&per_page=100`);
    if (!Array.isArray(prs) || prs.length === 100) fail('PROPOSAL_LIST_INCOMPLETE');
    return prs.filter(pr => pr.body?.includes(MARKER)).map(pr => this.read(repository, pr.number));
  }
  publish(repository, binding) {
    this.#auth();
    const repo = this.#api(`repos/${repository}`), branch = repo.default_branch;
    if (!cache.parseSymref(`ref: refs/heads/${branch}\tHEAD`)) fail('PROPOSAL_BASE_INVALID');
    const base = this.#api(`repos/${repository}/git/ref/heads/${branch}`);
    if (!SHA.test(base.object?.sha)) fail('PROPOSAL_BASE_INVALID');
    const text = `${JSON.stringify(binding, null, 2)}\n`;
    const head = `toolkit/governance-${binding.governance === 'disabled' ? 'off' : 'on'}-${key(text + base.object.sha)}`;
    let existing;
    // Query the tree rather than treating an unreadable contents endpoint as absence.
    const commit = this.#api(`repos/${repository}/git/commits/${base.object.sha}`);
    const tree = this.#api(`repos/${repository}/git/trees/${commit.tree.sha}?recursive=1`);
    if (tree.truncated || !Array.isArray(tree.tree)) fail('PROPOSAL_TREE_UNREADABLE');
    existing = tree.tree.find(item => item.path === cache.BINDING_PATH);
    if (existing && (existing.type !== 'blob' || !['100644', '100755'].includes(existing.mode))) fail('PROPOSAL_BINDING_NOT_REGULAR');
    const previous = this.#optional(`repos/${repository}/git/ref/heads/${head}`);
    if (previous && !SHA.test(previous.object?.sha)) fail('PROPOSAL_BRANCH_CHANGED');
    let headSha = previous?.object.sha || base.object.sha;
    if (!previous) this.#api(`repos/${repository}/git/refs`, { ref: `refs/heads/${head}`, sha: base.object.sha });
    if (headSha !== base.object.sha) {
      // Recover only our exact one-file commit. A branch someone changed is never overwritten.
      const diff = this.#api(`repos/${repository}/compare/${base.object.sha}...${headSha}`);
      const file = this.#api(`repos/${repository}/contents/${cache.BINDING_PATH}?ref=${headSha}`);
      if (diff.total_commits !== 1 || diff.merge_base_commit?.sha !== base.object.sha || diff.files?.length !== 1 || diff.files[0].filename !== cache.BINDING_PATH
        || file.type !== 'file' || file.encoding !== 'base64' || typeof file.content !== 'string' || Buffer.from(file.content, 'base64').toString('utf8') !== text) fail('PROPOSAL_BRANCH_CHANGED');
    } else {
      const result = this.#api(`repos/${repository}/contents/${cache.BINDING_PATH}`, { message: `Set repository governance ${binding.governance === 'disabled' ? 'off' : 'on'}`, content: Buffer.from(text).toString('base64'), branch: head, ...(existing ? { sha: existing.sha } : {}) }, 'PUT');
      headSha = result.commit?.sha;
      if (!SHA.test(headSha)) fail('PROPOSAL_COMMIT_INVALID');
    }
    const pr = this.#api(`repos/${repository}/pulls`, { title: `Set repository governance ${binding.governance === 'disabled' ? 'off' : 'on'}`, head, base: branch, body: `${MARKER}\n\nThe programme file on the default branch decides governance on every computer. This proposal sets it to ${binding.governance === 'disabled' ? 'disabled' : 'enabled'}. Global coding rules still apply. It does not change credentials, deployment or app task merge preferences.\n\nPlease merge this decision now after checking its effects and required checks. Owner merge permission is still required.` });
    return { number: pr.number, head: headSha };
  }
}
module.exports = Object.freeze({ GovernanceProposals, GitHubProposalTransport, validProposal, proposalText, SCHEMA, MARKER });
