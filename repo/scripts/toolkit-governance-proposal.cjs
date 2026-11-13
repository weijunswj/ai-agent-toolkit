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
function key(value) { return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 32); }
const ADOPTION_HELP = 'Run toolkit governance discover, reuse the adoption proposal and ask only for missing parent, separate evidence store or required checks. Verify the store is private. Use repository-agent-rules to prepare the binding, governed block and supporting rules before publishing them together.';

// The cloud sweep copies a governed repository needs, pinned to this Toolkit checkout's own commit,
// which must be on its main branch:
// { files: { path: text }, warning }. Turning governance on carries them in the same pull request as
// the binding, so a repository never gets one without the other. A Toolkit source checkout runs its
// own workflow files, so it gets nothing and no warning. When the copies cannot be rendered, the
// existing ones (if any) still travel and the warning names the reason and the fix.
const CLOUD_FIX = 'run node repo/scripts/toolkit-cloud-workflows.cjs --repo <this repository> from a Toolkit checkout on main, commit the copies to the governance pull request, then run toolkit governance check';
// `root` and `commit` (the Toolkit checkout and the commit to pin) are only for tests.
function cloudWorkflowFiles(cwd, { root = null, commit = null } = {}) {
  const workflows = require('./toolkit-cloud-workflows.cjs');
  if (workflows.isToolkitCheckout(cwd)) return { files: {}, warning: null };
  try {
    const result = workflows.plan({ repo: cwd, ...(root ? { root } : {}), ...(commit ? { commit } : {}) });
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

// Only the instruction skill's prepared surfaces join the binding. Product files and backups do not.
function adoptionFiles(cwd, text, cloud = { files: {} }) {
  const governance = require('./toolkit-governance-state.cjs');
  const block = governance.readGovernedBlock(cwd);
  if (!block.present || block.legacy || block.marker_errors) fail('PROPOSAL_ADOPTION_INCOMPLETE');
  const playbooks = fs.readdirSync(path.join(__dirname, '../../skills/repository-agent-rules/repo-local/docs/agent-playbooks')).filter(name => name.endsWith('.md'));
  const names = ['AGENTS.md', 'CLAUDE.md', '.agents/rules/00-agent-toolkit-bootstrap.md',
    ...playbooks.map(name => `docs/agent-playbooks/${name}`),
    ...['plain-text', 'personal-data-guard'].flatMap(name => [`.github/${name}.json`, `.github/scripts/${name === 'plain-text' ? 'plain-text-check' : name}.cjs`, `.github/workflows/${name}.yml`]), '.github/plain-text-baseline.json',
    ...cloudFiles()];
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
  return { ...files, ...cloud.files };
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
    return { kind: 'preparing', ...request, text: `Toolkit: the owner's ${request.answer} is pending for this run. ${request.answer === 'yes' ? `${ADOPTION_HELP} ` : ''}Prepare and publish one governance decision pull request with node "${path.join(__dirname, 'toolkit-governance.cjs')}" publish --run ${request.run}. Then show its external effects and ask the owner to merge it now. Governance stays as merged on the default branch.` };
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
    const proposal = request.answer === 'no' ? { schema: BINDING_V2, repository, governance: 'disabled' } : bindingV2(binding);
    if (!proposal || governance.bindingProblems(proposal, identity).length || (request.answer === 'yes' && proposal.governance === 'disabled')) fail('PROPOSAL_ADOPTION_INCOMPLETE');
    return { identity, request, repository, binding: proposal, text: `${JSON.stringify(proposal, null, 2)}\n` };
  }
  publish(cwd, run, binding = null) {
    this.prepare(cwd, run, binding);
    if (!this.#transport) fail('PROPOSAL_TRANSPORT_UNAVAILABLE');
    const checked = this.refresh(cwd);
    if (!checked.ok) fail('PROPOSAL_DISCOVERY_UNAVAILABLE');
    // Refresh can end a receipt when its PR closed or merged. Never reuse the earlier copy.
    const prepared = this.prepare(cwd, run, binding);
    if (checked.canWrite === false) fail('PROPOSAL_WRITE_REQUIRED');
    const matches = checked.proposals.filter(item => item.answer === prepared.request.answer);
    if (checked.proposals.some(item => item.answer !== prepared.request.answer) || matches.length > 1) fail('PROPOSAL_CONFLICT');
    const cloud = prepared.request.answer === 'yes' && !matches[0] ? this.#cloudWorkflows(cwd) : { files: {}, warning: null };
    const proposal = matches[0] || this.#transport.publish(prepared.repository, prepared.binding,
      prepared.request.answer === 'yes' ? adoptionFiles(cwd, prepared.text, cloud) : { [cache.BINDING_PATH]: prepared.text });
    const readback = this.#transport.read(prepared.repository, proposal.number);
    if (!validProposal(readback, prepared.repository) || readback.head !== proposal.head || readback.answer !== prepared.request.answer) fail('PROPOSAL_PUBLISH_READBACK_FAILED');
    this.#update(prepared.identity.repository_id, value => {
      value.requests = value.requests.map(item => item.run === run ? { ...item, proposal: readback.number, head: readback.head } : item);
      value.proposals = [readback]; value.checked_at = this.#now().toISOString(); value.error = null;
    });
    return { proposal: readback, text: proposalText([readback]), ...(cloud.warning ? { warning: cloud.warning } : {}) };
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
  // The cloud sweep copies on the default branch at `ref` that carry the Toolkit's rendered-copy marker.
  #cloudCopies(repository, ref) {
    const { MARKER: COPY } = require('./toolkit-cloud-workflows-render.cjs');
    return cloudFiles().filter(name => {
      const file = this.#optional(`repos/${repository}/contents/${name}?ref=${ref}`);
      return Boolean(file && file.type === 'file' && file.encoding === 'base64' && typeof file.content === 'string' && COPY.test(Buffer.from(file.content, 'base64').toString('utf8').replace(/\r\n/g, '\n')));
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
      const cloud = cloudFiles();
      const valid = Array.isArray(files) && pr.changed_files === files.length
        && files.filter(file => file.filename === cache.BINDING_PATH && ['added', 'modified'].includes(file.status)).length === 1
        && files.every(file => file.filename === cache.BINDING_PATH || (cloud.includes(file.filename) && file.status === 'removed'));
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
  // One pull request that changes only the binding's task auto-merge switch. `mergedText` is the
  // binding this computer read from the default branch; a default branch that has moved since is
  // refused rather than overwritten. It carries no governance proposal marker, so it is never read
  // as a governance decision, and it merges only by the owner (bindings are never auto-merge eligible).
  publishSwitch(repository, mergedText, text, value) {
    this.#auth();
    const repo = this.#api(`repos/${repository}`), branch = repo.default_branch;
    if (!cache.parseSymref(`ref: refs/heads/${branch}\tHEAD`)) fail('PROPOSAL_BASE_INVALID');
    const base = this.#api(`repos/${repository}/git/ref/heads/${branch}`);
    if (!SHA.test(base.object?.sha)) fail('PROPOSAL_BASE_INVALID');
    const current = this.#api(`repos/${repository}/contents/${cache.BINDING_PATH}?ref=${base.object.sha}`);
    if (current.type !== 'file' || current.encoding !== 'base64' || typeof current.content !== 'string') fail('PROPOSAL_BINDING_INVALID');
    if (Buffer.from(current.content, 'base64').toString('utf8').replace(/\r\n/g, '\n') !== String(mergedText).replace(/\r\n/g, '\n')) fail('SWITCH_BASE_CHANGED');
    const head = `toolkit/task-auto-merge-${value === 'after-gates' ? 'on' : 'off'}-${key(text + base.object.sha)}`;
    const owner = repository.split('/')[0];
    const open = this.#api(`repos/${repository}/pulls?state=open&head=${encodeURIComponent(`${owner}:${head}`)}`);
    if (Array.isArray(open) && open[0]?.number) return { number: open[0].number, url: open[0].html_url, head: open[0].head?.sha || null };
    if (this.#optional(`repos/${repository}/git/ref/heads/${head}`)) fail('SWITCH_BRANCH_EXISTS');
    this.#api(`repos/${repository}/git/refs`, { ref: `refs/heads/${head}`, sha: base.object.sha });
    const label = value === 'after-gates' ? 'on' : 'off';
    const result = this.#api(`repos/${repository}/contents/${cache.BINDING_PATH}`, { message: `Set task auto-merge ${label} for this repository`, content: Buffer.from(text).toString('base64'), branch: head, sha: current.sha }, 'PUT');
    if (!SHA.test(result.commit?.sha || '')) fail('PROPOSAL_COMMIT_INVALID');
    const pr = this.#api(`repos/${repository}/pulls`, { title: `Set task auto-merge ${label} for this repository`, head, base: branch, body: `This changes only \`task_prs.auto_merge\` in \`${cache.BINDING_PATH}\` to \`${value}\`. It is this repository's one task auto-merge switch, read the same way by every app and the Projects controller.\n\n${label === 'on' ? 'On: a finished task pull request may merge once its review, required checks and testing pass. Governance, hooks, setup and merge-rule changes still wait for a typed merge.' : 'Off: every pull request waits for a typed merge.'}\n\nIt applies only after the owner merges it. After the merge, \`refresh governance\` reads it back and removes the old per-app answers on each computer.` });
    return { number: pr.number, url: pr.html_url, head: result.commit.sha };
  }
  publish(repository, binding, files = { [cache.BINDING_PATH]: `${JSON.stringify(binding, null, 2)}\n` }) {
    if (binding.governance !== 'disabled' && !files['AGENTS.md']) fail('PROPOSAL_ADOPTION_INCOMPLETE');
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
        const result = this.#api(`repos/${repository}/git/commits`, { message: binding.governance === 'disabled' ? 'Set repository governance off' : 'Prepare repository governance and rules', tree: tree.sha, parents: [base.object.sha] });
        headSha = result.sha;
        if (!SHA.test(headSha)) fail('PROPOSAL_COMMIT_INVALID');
        this.#api(`repos/${repository}/git/refs/heads/${head}`, { sha: headSha, force: false }, 'PATCH');
      }
      if (!SHA.test(headSha)) fail('PROPOSAL_COMMIT_INVALID');
    }
    const pr = this.#api(`repos/${repository}/pulls`, { title: `Set repository governance ${binding.governance === 'disabled' ? 'off' : 'on'}`, head, base: branch, body: `${MARKER}\n\nThe programme file on the default branch decides governance on every computer. This proposal sets it to ${binding.governance === 'disabled' ? 'disabled' : 'enabled with the prepared governed rules'}. Global coding rules still apply. It does not change credentials, deployment or app task merge preferences.\n\nPrepared files:\n${Object.keys(files).map(name => `- ${name}`).join('\n')}\n\n${removals.length ? `Removed files (the Toolkit's cloud sweep copies):\n${removals.map(name => `- ${name}`).join('\n')}\n\n` : ''}Please merge this decision now after checking its effects and required checks. Owner merge permission is still required.` });
    return { number: pr.number, head: headSha };
  }
}
module.exports = Object.freeze({ GovernanceProposals, GitHubProposalTransport, validProposal, proposalText, bindingV2, cloudWorkflowFiles, SCHEMA, MARKER, PROMPT_BUDGET_MS });
