'use strict';

// An evidence store a programme binding names (rule S1) and a scratch clone in a decided
// repository's ignored .tmp folder (rule R1s) are never governed: no question, no held prompt or
// tool, no recorded "enable", and discovery reports them as not applicable. Both hosts share the
// state module and the gate, so the gate is checked in process here and the Codex entry point in
// toolkit-codex-helper-hook.test.cjs.

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { recordMerged } = require('./toolkit-governed-fixture-support.cjs');

const scripts = path.join(__dirname, '..', 'scripts');
const governance = require(path.join(scripts, 'toolkit-governance-state.cjs'));
const gate = require(path.join(scripts, 'toolkit-governance-gate.cjs'));
const bindingCache = require(path.join(scripts, 'toolkit-governance-binding.cjs'));
const discovery = require(path.join(scripts, 'toolkit-governance-discovery.cjs'));
const { ToolkitGovernanceCli } = require(path.join(scripts, 'toolkit-governance.cjs'));

function git(cwd, args) {
  return childProcess.execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }).trim();
}

function scratch(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-evidence-store-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const registryPath = path.join(root, 'home', '.ai-agent-toolkit', 'user-state', 'repository-governance.v1.json');
  return { root, registryPath, options: { registryPath, testOnly: true } };
}

function repo(at, slug) {
  fs.mkdirSync(at, { recursive: true });
  git(path.dirname(at), ['init', '--quiet', at]);
  git(at, ['remote', 'add', 'origin', `https://github.com/${slug}.git`]);
  require('./toolkit-governed-fixture-support.cjs').recordAbsent(at, { home: path.join(path.dirname(at), 'home') });
  return at;
}

function binding(repository, store) {
  return JSON.stringify({ schema: 'toolkit.programme-binding.v2', repository, governance: 'enabled', parents: [{ issue: 1, record_prefix: 'INT-EX-', writer_prefix: 'INT-EX-' }], store: { kind: 'github', repository: store, branch: 'main', path: 'state/' }, required_checks: ['validate'] });
}

// A governed repository whose merged binding (cached on this computer) names `store`.
function governed(ctx, slug = 'example-owner/app', store = 'example-owner/evidence') {
  const at = repo(path.join(ctx.root, slug.split('/')[1]), slug);
  recordMerged(at, { registryPath: ctx.registryPath, text: binding(slug, store) });
  return at;
}

const state = (ctx, cwd) => {
  const identity = governance.readIdentity(cwd);
  if (!bindingCache.readBindingCache(identity, path.dirname(ctx.registryPath))) require('./toolkit-governed-fixture-support.cjs').recordAbsent(cwd, { registryPath: ctx.registryPath });
  return governance.governanceState(cwd, ctx.options);
};
const enable = (ctx, cwd) => require('./support/governance-observations.cjs').seedMerged(cwd, 'enable', { registryOptions: ctx.options });

test('S1: a store a cached binding names is DISABLED and never held; a merged binding in the store itself still wins', (t) => {
  const ctx = scratch(t);
  governed(ctx);
  const store = repo(path.join(ctx.root, 'evidence'), 'example-owner/evidence');
  const result = state(ctx, store);
  assert.deepEqual([result.state, result.rule, result.reason, result.hold], ['DISABLED', 'S1', 'evidence-store', false]);
  assert.match(gate.sessionLine(store, { registryOptions: ctx.options }), /DISABLED here: this repository is an evidence store/);
  // An owner-merged binding in the store's own repository decides instead.
  recordMerged(store, { registryPath: ctx.registryPath, text: binding('example-owner/evidence', 'example-owner/other-store') });
  assert.equal(state(ctx, store).rule, 'M1');
});

test('S1: a TRANSPORT name supplies no exemption under any owner', (t) => {
  const ctx = scratch(t);
  governed(ctx);
  const byName = repo(path.join(ctx.root, 'TRANSPORT-app'), 'example-owner/TRANSPORT-app');
  assert.deepEqual([state(ctx, byName).rule, state(ctx, byName).reason], ['R7', 'no-decision']);
  const foreign = repo(path.join(ctx.root, 'foreign'), 'someone-else/TRANSPORT-app');
  assert.deepEqual([state(ctx, foreign).state, state(ctx, foreign).rule], ['UNDECIDED', 'R7']);
  // With no binding cached at all, nothing is a store by name.
  const bare = scratch(t);
  const alone = repo(path.join(bare.root, 'TRANSPORT-app'), 'example-owner/TRANSPORT-app');
  assert.equal(state(bare, alone).rule, 'R7');
});

test('S1: historical laptop data cannot enable a named evidence store', t => {
  const ctx = scratch(t);
  governed(ctx);
  const store = repo(path.join(ctx.root, 'evidence'), 'example-owner/evidence');
  fs.writeFileSync(ctx.registryPath, '{damaged');
  assert.equal(state(ctx, store).rule, 'S1');
  assert.equal(fs.readFileSync(ctx.registryPath, 'utf8'), '{damaged');
});

test('S1: a damaged or foreign cache file is skipped', (t) => {
  const ctx = scratch(t);
  governed(ctx);
  const folder = bindingCache.cacheDirFor(path.dirname(ctx.registryPath));
  fs.writeFileSync(path.join(folder, `${'a'.repeat(32)}.json`), '{not json');
  fs.writeFileSync(path.join(folder, `${'b'.repeat(32)}.json`), JSON.stringify({ schema: bindingCache.CACHE_SCHEMA, remote: 'https://github.com/example-owner/x.git' }));
  const store = repo(path.join(ctx.root, 'evidence'), 'example-owner/evidence');
  assert.equal(state(ctx, store).rule, 'S1');
  assert.equal(bindingCache.readAllBindingCaches(path.dirname(ctx.registryPath)).filter(item => item.entry.status === 'present').length, 1);
});

test('never-governed store classification alone grants no merge; fresh exact binding and live facts do', t => {
  const ctx = scratch(t);
  const parent = governed(ctx);
  const store = repo(path.join(ctx.root, 'evidence'), 'example-owner/evidence');
  const text = binding('example-owner/app', 'example-owner/evidence');
  const hold = require(path.join(scripts, 'toolkit-merge-hold.cjs'));
  const sha = 'a'.repeat(40);
  const input = { cwd: store, tool_name: 'mcp__github__merge_pull_request', tool_input: {
    owner: 'example-owner', repo: 'evidence', pullNumber: 17, expectedHeadSha: sha, merge_method: 'merge' } };
  let reads = 0;
  const options = { registryOptions: { ...ctx.options, home: path.join(ctx.root, 'home') }, environment: {},
    transport: { request(method, apiPath) {
      assert.equal(method, 'GET');
      if (apiPath === 'repos/example-owner/evidence/pulls/17') return { status: 200, json: {
        number: 17, title: 'Evidence update', body: 'Refs only', head: { sha }, commits: 0 } };
      if (apiPath === 'repos/example-owner/evidence/pulls/17/commits?per_page=100&page=1') return { status: 200, json: [] };
      throw new Error(`Unexpected closure read: ${apiPath}`);
    } },
    readEvidenceGitHub(apiPath) {
      reads += 1;
      return { status: 200, json: apiPath.endsWith('/pulls/17')
        ? { number: 17, base: { repo: { full_name: 'example-owner/evidence' }, ref: 'main' }, head: { sha } }
        : { full_name: 'example-owner/evidence', private: true, permissions: { push: true }, default_branch: 'main' } };
    } };
  recordMerged(parent, { registryPath: ctx.registryPath, text, now: new Date(Date.now() - 25 * 60 * 60 * 1000) });
  assert.equal(state(ctx, store).rule, 'S1');
  const refusal = hold.decide(input, options).deny;
  assert.match(refusal, /parent binding is not fresh.*`toolkit governance status` in the parent example-owner\/app folder/);
  assert.doesNotMatch(refusal, /Ask the user to type/);
  assert.equal(reads, 0);
  recordMerged(parent, { registryPath: ctx.registryPath, text });
  assert.equal(state(ctx, store).rule, 'S1');
  assert.equal(hold.decide(input, options), null);
  assert.equal(reads, 2);
});

// A cloud container clones each project repository into its own subfolder and starts the session in
// their shared parent folder, so session start caches no parent binding. The merge hold reads the
// clones' merged bindings on demand, in cloud sessions only, and the usual checks then decide.
function cloudStoreMerge(t, { cloud = true, refreshed = true, parentStore = 'example-owner/evidence', withParent = true } = {}) {
  const ctx = scratch(t);
  const parent = withParent ? repo(path.join(ctx.root, 'app'), 'example-owner/app') : null;
  repo(path.join(ctx.root, 'evidence'), 'example-owner/evidence');
  const hold = require(path.join(scripts, 'toolkit-merge-hold.cjs'));
  const sha = 'b'.repeat(40);
  const refreshes = [];
  const options = { registryOptions: { ...ctx.options, home: path.join(ctx.root, 'home') },
    environment: cloud ? { CLAUDE_CODE_REMOTE: 'true' } : {},
    transport: { request(method, apiPath) {
      if (apiPath === 'repos/example-owner/evidence/pulls/251') return { status: 200, json: { number: 251, title: 'Evidence', body: 'Refs only', head: { sha }, commits: 0 } };
      if (apiPath.startsWith('repos/example-owner/evidence/pulls/251/commits')) return { status: 200, json: [] };
      throw new Error(`Unexpected closure read: ${apiPath}`);
    } },
    readEvidenceGitHub(apiPath) {
      return { status: 200, json: apiPath.endsWith('/pulls/251')
        ? { number: 251, base: { repo: { full_name: 'example-owner/evidence' }, ref: 'main' }, head: { sha } }
        : { full_name: 'example-owner/evidence', private: true, permissions: { push: true }, default_branch: 'main' } };
    },
    refreshEvidenceBinding(folder, budget) {
      refreshes.push(folder);
      assert.ok(Number.isFinite(budget.deadline));
      if (!refreshed || folder !== parent) return { refreshed: false, error: 'remote-unreachable' };
      recordMerged(parent, { registryPath: ctx.registryPath, text: binding('example-owner/app', parentStore) });
      return { refreshed: true, error: null };
    } };
  const input = { cwd: ctx.root, tool_name: 'mcp__github__merge_pull_request', tool_input: {
    owner: 'example-owner', repo: 'evidence', pullNumber: 251, expectedHeadSha: sha, merge_method: 'merge' } };
  return { ctx, hold, input, options, refreshes, parent, sha };
}

test('cloud: a store merge from the clones folder reads the parent binding on demand and passes', t => {
  const { hold, input, options, refreshes, parent } = cloudStoreMerge(t);
  assert.equal(hold.decide(input, options), null);
  assert.deepEqual(refreshes, [parent]);
  // The fresh read is cached, so a second merge does not read again.
  assert.equal(hold.decide(input, options), null);
  assert.deepEqual(refreshes, [parent]);
});

test('cloud: a store merge from the parent clone itself reads that binding on demand', t => {
  const { hold, input, options, refreshes, parent } = cloudStoreMerge(t);
  assert.equal(hold.decide({ ...input, cwd: parent }, options), null);
  assert.deepEqual(refreshes, [parent]);
});

test('cloud: the exemption still needs a fresh binding that names this store, and a plain merge commit', t => {
  {
    const { hold, input, options } = cloudStoreMerge(t, { refreshed: false });
    assert.match(hold.decide(input, options).deny, /no unused approval/);
  }
  {
    const { hold, input, options } = cloudStoreMerge(t, { parentStore: 'example-owner/other-store' });
    assert.match(hold.decide(input, options).deny, /no unused approval/);
  }
  {
    const { hold, input, options } = cloudStoreMerge(t);
    assert.match(hold.decide({ ...input, tool_input: { ...input.tool_input, merge_method: 'squash' } }, options).deny, /Evidence-store verification failed/);
  }
  {
    // Only the store is cloned here: no parent clone, so nothing to read and no folder match.
    const { hold, input, options, refreshes } = cloudStoreMerge(t, { withParent: false });
    assert.match(hold.decide(input, options).deny, /no unused approval/);
    assert.deepEqual(refreshes, []);
  }
});

test('outside the cloud nothing is read on demand: a missing cached binding still refuses', t => {
  const { hold, input, options, refreshes } = cloudStoreMerge(t, { cloud: false });
  assert.match(hold.decide(input, options).deny, /no unused approval/);
  assert.deepEqual(refreshes, []);
  // Only the exact value "true" marks a cloud session.
  assert.match(hold.decide(input, { ...options, environment: { CLAUDE_CODE_REMOTE: '1' } }).deny, /no unused approval/);
  assert.deepEqual(refreshes, []);
});

test('cloud: lookalike targets, an unrelated folder, a symlinked clone and an unnamed target stay gated', t => {
  {
    // A name that only starts like the store, and the parent repository itself.
    const { hold, input, options } = cloudStoreMerge(t);
    assert.ok(hold.decide({ ...input, tool_input: { ...input.tool_input, repo: 'evidence-x' } }, options).deny);
    assert.match(hold.decide({ ...input, tool_input: { ...input.tool_input, repo: 'app' } }, options).deny, /no unused approval/);
  }
  {
    // A session folder inside an unrelated repository reads only that repository's binding.
    const { ctx, hold, input, options, refreshes } = cloudStoreMerge(t);
    const other = repo(path.join(ctx.root, 'zz-other'), 'example-owner/other');
    assert.ok(hold.decide({ ...input, cwd: other }, options).deny);
    assert.deepEqual(refreshes, [other]);
  }
  {
    // A symlink to the parent clone is not a clone in that folder.
    const { ctx, hold, input, options, refreshes } = cloudStoreMerge(t);
    const box = path.join(ctx.root, 'box');
    fs.mkdirSync(box);
    fs.symlinkSync(path.join(ctx.root, 'app'), path.join(box, 'app'), 'junction');
    assert.ok(hold.decide({ ...input, cwd: box }, options).deny);
    assert.deepEqual(refreshes, []);
  }
  {
    // A shell merge from the clones folder must name the store; a named one passes.
    const { ctx, hold, options, sha } = cloudStoreMerge(t);
    const shell = rest => ({ cwd: ctx.root, tool_name: 'Bash', tool_input: { command: `${['g', 'h'].join('')} pr merge 251 ${rest}` } });
    assert.ok(hold.decide(shell(`--merge --match-head-commit ${sha}`), options).deny);
    assert.ok(hold.decide(shell(`--repo example-owner/evidence --squash --match-head-commit ${sha}`), options).deny);
    assert.equal(hold.decide(shell(`--repo example-owner/evidence --merge --match-head-commit ${sha}`), options), null);
  }
});

test('cloud: a failing or unaffordable on-demand read fails closed', t => {
  {
    const { hold, input, options } = cloudStoreMerge(t);
    assert.match(hold.decide(input, { ...options, refreshEvidenceBinding() { throw new Error('read failed'); } }).deny, /no unused approval/);
  }
  {
    // Too little of the hook's time left: no read is started.
    const { hold, input, options, refreshes } = cloudStoreMerge(t);
    assert.ok(hold.decide(input, { ...options, deadline: globalThis.performance.now() + 2000 }).deny);
    assert.deepEqual(refreshes, []);
  }
  {
    // The parent clone beyond the eight-folder cap is never read.
    const { ctx, hold, input, options } = cloudStoreMerge(t);
    for (let index = 0; index < 9; index += 1) repo(path.join(ctx.root, `a${index}`), `example-owner/x${index}`);
    assert.ok(hold.decide(input, options).deny);
  }
});

test('R1s: a clone of another repository in a decided repository\'s ignored .tmp folder; never a worktree of the parent, an unignored .tmp or an undecided parent', (t) => {
  const ctx = scratch(t);
  const parent = governed(ctx);
  fs.writeFileSync(path.join(parent, '.gitignore'), 'node_modules/\r\n.tmp/\r\n');
  const clone = repo(path.join(parent, '.tmp', 'clone'), 'example-owner/library');
  const result = state(ctx, path.join(clone));
  assert.deepEqual([result.state, result.rule, result.reason, result.hold], ['DISABLED', 'R1s', 'scratch-clone', false]);
  // A second copy of the parent itself keeps the parent's state.
  const copy = repo(path.join(parent, '.tmp', 'worktrees', 'lane'), 'example-owner/app');
  assert.equal(state(ctx, copy).rule, 'M1');
  // An evidence store is reported as one, not as a scratch clone.
  const store = repo(path.join(parent, '.tmp', 'tr'), 'example-owner/evidence');
  assert.equal(state(ctx, store).rule, 'S1');
  // Not ignored: asked as usual.
  fs.writeFileSync(path.join(parent, '.gitignore'), 'node_modules/\n.tmp/*.log\n');
  assert.equal(state(ctx, clone).rule, 'R7');
  // Ignored, but the parent itself is undecided: asked as usual.
  const plain = repo(path.join(ctx.root, 'plain'), 'example-owner/plain');
  fs.writeFileSync(path.join(plain, '.gitignore'), '/.tmp\n');
  const inner = repo(path.join(plain, '.tmp', 'inner'), 'example-owner/library');
  assert.equal(state(ctx, plain).rule, 'R7');
  assert.equal(state(ctx, inner).rule, 'R7');
  // Enable is refused for a scratch clone too.
  fs.writeFileSync(path.join(parent, '.gitignore'), '.tmp\n');
  assert.equal(state(ctx, clone).rule, 'R1s');
});

test('gate: no question and no refused tool inside an S1 or R1s repository, or when a command reaches one', (t) => {
  const ctx = scratch(t);
  const parent = governed(ctx);
  fs.writeFileSync(path.join(parent, '.gitignore'), '.tmp/\n');
  const store = repo(path.join(parent, '.tmp', 'tr'), 'example-owner/evidence');
  const clone = repo(path.join(parent, '.tmp', 'clone'), 'example-owner/library');
  const held = repo(path.join(ctx.root, 'held'), 'example-owner/undecided');
  const tools = new gate.ToolGate({ registryOptions: ctx.options, environment: {} });
  for (const cwd of [store, clone]) {
    assert.equal(new gate.GovernanceGate({ registryOptions: ctx.options }).evaluate(cwd).open, false, cwd);
    assert.deepEqual(new gate.PromptHold({ registryOptions: ctx.options, environment: {} }).decide({ cwd, prompt: 'go', sessionId: 's1' }), { action: 'pass' }, cwd);
    assert.equal(tools.decide({ tool_name: 'Bash', cwd, session_id: 's1', tool_input: { command: 'git status' } }), null, cwd);
    assert.equal(tools.decide({ tool_name: 'Bash', cwd: parent, session_id: 's1', tool_input: { command: `cd "${cwd}" && git status` } }), null, `reach ${cwd}`);
    assert.equal(tools.decide({ tool_name: 'PowerShell', cwd: parent, session_id: 's1', tool_input: { command: `git -C "${cwd}" status` } }), null, `-C ${cwd}`);
    assert.match(gate.sessionLine(cwd, { registryOptions: ctx.options }), /DISABLED here/);
  }
  // An undecided repository is told apart: the question is open there, though no tool is refused for it.
  assert.equal(new gate.GovernanceGate({ registryOptions: ctx.options }).evaluate(held).open, true);
  assert.equal(tools.decide({ tool_name: 'Bash', cwd: held, session_id: 's1', tool_input: { command: 'git status' } }), null);
});

test('gate: a Projects thread works in an undecided repository: its messages, decision cards and other tools all run', (t) => {
  const ctx = scratch(t);
  const held = repo(path.join(ctx.root, 'held'), 'example-owner/undecided');
  const tools = new gate.ToolGate({ registryOptions: ctx.options, environment: {} });
  const call = tool_name => tools.decide({ tool_name, cwd: held, session_id: 's1', tool_input: { text: 'Enable governance here? Reply yes, no or later.' } });
  for (const tool of ['mcp__hearthbot__post_message', 'mcp__hearthbot__react', 'mcp__hearthbot__update_progress_checklist', 'mcp__hearthbot__no_reply_needed', 'ToolSearch',
    'mcp__hearthbot__request_decision', 'mcp__hearthbot__post_widget', 'mcp__hearthbot__post_message_x', 'mcp__other__post_message', 'Read']) assert.equal(call(tool), null, tool);
  // The answer still comes only from the user: the governance CLI with a decision stays refused there.
  assert.match(tools.decide({ tool_name: 'Bash', cwd: held, session_id: 's1', tool_input: { command: 'node repo/scripts/toolkit-governance.cjs enable' } })?.deny || '', /only the user answers the governance question/);
});

test('discover: not applicable for S1 and R1s, and a repository is never its own store candidate', (t) => {
  const ctx = scratch(t);
  const parent = governed(ctx);
  fs.writeFileSync(path.join(parent, '.gitignore'), '.tmp/\n');
  const noGh = () => { throw new Error('no GitHub read'); };
  const store = repo(path.join(ctx.root, 'evidence'), 'example-owner/evidence');
  const clone = repo(path.join(parent, '.tmp', 'clone'), 'example-owner/library');
  for (const [cwd, rule] of [[store, 'S1'], [clone, 'R1s']]) {
    const found = new discovery.GovernanceDiscovery({ registryOptions: ctx.options, gh: noGh }).discover(cwd);
    assert.deepEqual([found.status, found.rule], ['not-applicable', rule]);
  }
  // A repository another binding names as its store, discovered without that binding cached here.
  const fresh = scratch(t);
  const self = repo(path.join(fresh.root, 'TRANSPORT-app'), 'example-owner/TRANSPORT-app');
  const owned = name => ({ name, private: true, owner: { login: 'example-owner' }, fork: false, archived: false });
  const gh = (args) => {
    const url = args[0];
    if (url.startsWith('user/repos')) return { ok: true, value: [owned('TRANSPORT-app'), owned('app')] };
    if (url === 'repos/example-owner/app/contents/.github/toolkit-programme.json') return { ok: true, value: { content: Buffer.from(binding('example-owner/app', 'example-owner/TRANSPORT-app')).toString('base64') } };
    return { ok: false, reason: 'not-found' };
  };
  const found = new discovery.GovernanceDiscovery({ registryOptions: fresh.options, gh }).discover(self);
  assert.ok(Array.isArray(found.stores.rejected), JSON.stringify(found));
  const candidates = [found.stores.recommended, ...found.stores.alternatives, ...found.stores.rejected].filter(Boolean).map(entry => entry.repository.toLowerCase());
  assert.ok(!candidates.includes('example-owner/transport-app'), JSON.stringify(found.stores));
});

test('CLI: enable is refused for S1 and R1s with the reason; nothing is written', async (t) => {
  const ctx = scratch(t);
  const parent = governed(ctx);
  fs.writeFileSync(path.join(parent, '.gitignore'), '.tmp/\n');
  const store = repo(path.join(ctx.root, 'evidence'), 'example-owner/evidence');
  const clone = repo(path.join(parent, '.tmp', 'clone'), 'example-owner/library');
  for (const [cwd, message] of [[store, /evidence store/], [clone, /scratch clone/]]) {
    const out = []; const err = [];
    const cli = new ToolkitGovernanceCli({
      stdout: { write: text => out.push(text) }, stderr: { write: text => err.push(text) }, cwd, interactive: true,
      ask: async () => 'yes', registryOptions: ctx.options, discoveryGh: () => ({ ok: false, reason: 'offline' }), refresh: () => ({ refreshed: false, error: 'offline' }),
    });
    const code = await cli.main(['enable']);
    assert.notEqual(code, 0);
    assert.match(err.join('') + out.join(''), message);
    assert.equal(state(ctx, cwd).recorded_decision, undefined);
  }
});
