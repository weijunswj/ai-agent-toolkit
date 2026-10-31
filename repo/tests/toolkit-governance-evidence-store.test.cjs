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

const state = (ctx, cwd) => governance.governanceState(cwd, ctx.options);
const enable = (ctx, cwd) => gate.writeGovernanceDecision(cwd, 'enable', { registryOptions: ctx.options });

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

test('S1 by name: a TRANSPORT-* repository under a bound repository\'s owner, never under another owner', (t) => {
  const ctx = scratch(t);
  governed(ctx);
  const byName = repo(path.join(ctx.root, 'TRANSPORT-app'), 'example-owner/TRANSPORT-app');
  assert.deepEqual([state(ctx, byName).rule, state(ctx, byName).reason], ['S1', 'evidence-store-by-name']);
  const foreign = repo(path.join(ctx.root, 'foreign'), 'someone-else/TRANSPORT-app');
  assert.deepEqual([state(ctx, foreign).state, state(ctx, foreign).rule], ['UNDECIDED', 'R7']);
  // With no binding cached at all, nothing is a store by name.
  const bare = scratch(t);
  const alone = repo(path.join(bare.root, 'TRANSPORT-app'), 'example-owner/TRANSPORT-app');
  assert.equal(state(bare, alone).rule, 'R7');
});

test('S1: a stored "enable" is ignored and shown; enable is refused and disable still records', (t) => {
  const ctx = scratch(t);
  const store = repo(path.join(ctx.root, 'evidence'), 'example-owner/evidence');
  enable(ctx, store);
  assert.equal(state(ctx, store).rule, 'R5');
  governed(ctx);
  const ignored = state(ctx, store);
  assert.deepEqual([ignored.state, ignored.rule, [...ignored.notes]], ['DISABLED', 'S1', ['stored-decision-ignored']]);
  assert.throws(() => enable(ctx, store), /NOT_GOVERNABLE/);
  gate.writeGovernanceDecision(store, 'disable', { registryOptions: ctx.options });
  const cleared = state(ctx, store);
  assert.deepEqual([cleared.rule, cleared.recorded_decision, [...cleared.notes]], ['S1', 'disabled', []]);
});

test('S1: a damaged or foreign cache file is skipped', (t) => {
  const ctx = scratch(t);
  governed(ctx);
  const folder = bindingCache.cacheDirFor(ctx.registryPath);
  fs.writeFileSync(path.join(folder, `${'a'.repeat(32)}.json`), '{not json');
  fs.writeFileSync(path.join(folder, `${'b'.repeat(32)}.json`), JSON.stringify({ schema: bindingCache.CACHE_SCHEMA, remote: 'https://github.com/example-owner/x.git' }));
  const store = repo(path.join(ctx.root, 'evidence'), 'example-owner/evidence');
  assert.equal(state(ctx, store).rule, 'S1');
  assert.equal(bindingCache.readAllBindingCaches(ctx.registryPath).length, 1);
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
  assert.throws(() => enable(ctx, clone), /NOT_GOVERNABLE/);
});

test('gate: no held prompt or refused tool inside an S1 or R1s repository, and no question when a command reaches one', (t) => {
  const ctx = scratch(t);
  const parent = governed(ctx);
  fs.writeFileSync(path.join(parent, '.gitignore'), '.tmp/\n');
  const store = repo(path.join(parent, '.tmp', 'tr'), 'example-owner/evidence');
  const clone = repo(path.join(parent, '.tmp', 'clone'), 'example-owner/library');
  const held = repo(path.join(ctx.root, 'held'), 'example-owner/undecided');
  const tools = new gate.ToolGate({ registryOptions: ctx.options, environment: {} });
  for (const cwd of [store, clone]) {
    assert.equal(new gate.GovernanceGate({ registryOptions: ctx.options }).evaluate(cwd).hold, false, cwd);
    assert.equal(tools.decide({ tool_name: 'Bash', cwd, session_id: 's1', tool_input: { command: 'git status' } }), null, cwd);
    assert.equal(tools.decide({ tool_name: 'Bash', cwd: parent, session_id: 's1', tool_input: { command: `cd "${cwd}" && git status` } }), null, `reach ${cwd}`);
    assert.equal(tools.decide({ tool_name: 'PowerShell', cwd: parent, session_id: 's1', tool_input: { command: `git -C "${cwd}" status` } }), null, `-C ${cwd}`);
    assert.match(gate.sessionLine(cwd, { registryOptions: ctx.options }), /DISABLED here/);
  }
  // A held repository still refuses tools, and still asks when a command reaches it.
  assert.match(tools.decide({ tool_name: 'Bash', cwd: held, session_id: 's1', tool_input: { command: 'git status' } })?.deny || '', /no governance decision yet/);
});

test('gate: a Projects thread can post in a held repository; its decision cards and other tools stay held', (t) => {
  const ctx = scratch(t);
  const held = repo(path.join(ctx.root, 'held'), 'example-owner/undecided');
  const tools = new gate.ToolGate({ registryOptions: ctx.options, environment: {} });
  const call = tool_name => tools.decide({ tool_name, cwd: held, session_id: 's1', tool_input: { text: 'Enable governance here? Reply yes, no or later.' } });
  for (const tool of ['mcp__hearthbot__post_message', 'mcp__hearthbot__react', 'mcp__hearthbot__update_progress_checklist', 'mcp__hearthbot__no_reply_needed', 'ToolSearch']) assert.equal(call(tool), null, tool);
  for (const tool of ['mcp__hearthbot__request_decision', 'mcp__hearthbot__post_widget', 'mcp__hearthbot__post_message_x', 'mcp__other__post_message', 'Read']) assert.match(call(tool)?.deny || '', /no governance decision yet/, tool);
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
    assert.equal(state(ctx, cwd).recorded_decision, 'unresolved');
  }
});
