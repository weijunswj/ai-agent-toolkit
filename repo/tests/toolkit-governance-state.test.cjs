'use strict';

// GovernanceState (#542): the rule table, the git-free identity reader against the registry's own
// git-based identity, materials, the user's decision, fail-closed reads and the no-subprocess,
// no-write guarantees. Closure rows S-01 to S-10 and the unit parts of H-09, H-15 and H-16.

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const scripts = path.join(repoRoot, 'repo', 'scripts');
const governance = require(path.join(scripts, 'toolkit-governance-state.cjs'));
const registry = require(path.join(scripts, 'toolkit-capability-registry.cjs'));
const managedBlock = require(path.join(scripts, 'toolkit-managed-block.cjs'));

const REMOTE = 'https://github.com/example-owner/example-repo.git';
const BLOCK_SOURCE = 'repo/contracts/agent-rules/toolkit-governed-rules.md';

function git(cwd, args) {
  return childProcess.execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }).trim();
}

function scratch(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-governance-state-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, registryPath: path.join(root, 'state', 'repository-governance.v1.json') };
}

// A repository made without git: .git/config written by hand, as git would write it.
function fakeRepo(root, name, { remote = REMOTE, block = false, binding = false, configText = null } = {}) {
  const repo = path.join(root, name);
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  const config = configText !== null ? configText
    : `[core]\n\trepositoryformatversion = 0\n${remote === null ? '' : `[remote "origin"]\n\turl = ${remote}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`}`;
  fs.writeFileSync(path.join(repo, '.git', 'config'), config);
  if (block) writeBlock(repo);
  if (binding) writeBinding(repo, typeof binding === 'object' ? binding : {});
  return repo;
}

function writeBlock(repo, name = 'TOOLKIT-GOVERNED-RULES') {
  const rendered = managedBlock.renderBlock({ source: BLOCK_SOURCE, name, version: '3.8.0', body: '# Rules\n\nFixture body.' });
  fs.writeFileSync(path.join(repo, 'AGENTS.md'), `# Repo\n\n${rendered}\n`);
}

function validBinding(overrides = {}) {
  return {
    schema: 'toolkit.programme-binding.v1',
    repository: 'example-owner/example-repo',
    parent_issue: 1,
    record_prefix: 'INT-EX',
    writer_prefix: 'EX',
    store: { kind: 'github', repository: 'example-owner/example-store', branch: 'main', path: 'state/' },
    required_checks: ['validate'],
    ...overrides,
  };
}

function writeBinding(repo, overrides = {}) {
  fs.mkdirSync(path.join(repo, '.github'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.github', 'toolkit-programme.json'), JSON.stringify(validBinding(overrides), null, 2));
}

function opts(ctx) { return { registryPath: ctx.registryPath, testOnly: true }; }

function state(ctx, cwd) { return governance.governanceState(cwd, opts(ctx)); }

// A real git repository, for the decision writer and the identity parity checks.
function gitRepo(root, name, remote = REMOTE) {
  const repo = path.join(root, name);
  fs.mkdirSync(repo, { recursive: true });
  git(root, ['init', '--quiet', repo]);
  if (remote !== null) git(repo, ['remote', 'add', 'origin', remote]);
  return repo;
}

function decide(ctx, repo, operation) {
  const current = registry.getRepositoryStatus({ cwd: repo, ...opts(ctx) });
  return registry.writeCapabilityDecision({
    cwd: repo,
    ...opts(ctx),
    capabilityId: 'repository.governance',
    operation,
    ownerAction: {
      confirmed: true,
      category: 'explicit-owner',
      channel: 'capability-route',
      operation,
      choice_semantic_id: registry.capabilityDecisionSemanticId('repository.governance', operation),
      contract_digest: registry.CONTRACT_DIGEST,
      scope_digest: registry.capabilityScopeDigest(current.repository_id, 'repository.governance', operation, 'capability-route'),
    },
    expectedRevision: current.registry_revision,
    expectedHash: current.snapshot_hash,
  });
}

test('derive: the rule table, first match wins', () => {
  const identity = { root: '/r', repository_id: 'a'.repeat(64) };
  const materials = (block, binding) => ({ governed_block: { present: block }, binding: { present: binding, valid: binding, problems: [] } });
  const cases = [
    ['disabled', true, true, 'DECLINED', 'R2'],
    ['disabled', false, false, 'DECLINED', 'R2'],
    ['enabled', true, true, 'ENABLED', 'R3'],
    ['unresolved', true, true, 'ENABLED', 'R4'],
    ['enabled', true, false, 'ENABLED', 'R5'],
    ['enabled', false, true, 'ENABLED', 'R5'],
    ['unresolved', true, false, 'UNKNOWN', 'R6'],
    ['unresolved', false, true, 'UNKNOWN', 'R7'],
    ['unresolved', false, false, 'UNKNOWN', 'R7'],
  ];
  for (const [decision, block, binding, expectedState, rule] of cases) {
    const result = governance.GovernanceState.derive({ identity, materials: materials(block, binding), decision: { state: decision, decision_kind: null } });
    assert.equal(result.state, expectedState, `${decision}/${block}/${binding}`);
    assert.equal(result.rule, rule, `${decision}/${block}/${binding}`);
    assert.equal(result.hold, expectedState === 'UNKNOWN');
    const complete = rule === 'R3' || rule === 'R4';
    assert.equal(result.governed_rules_bind, complete);
    assert.equal(result.programme_records_bind, complete);
    assert.equal(result.materials_complete, expectedState === 'ENABLED' ? complete : null);
    assert.ok(Object.isFrozen(result));
  }
});

test('S-01, S-02: no git root or no usable origin is PORTABLE, never held, never persisted', (t) => {
  const ctx = scratch(t);
  const plain = path.join(ctx.root, 'plain');
  fs.mkdirSync(plain);
  const outside = state(ctx, plain);
  // The scratch folder may sit inside some git checkout on a developer machine; only check the
  // no-root case when that is not so.
  if (governance.findGitRoot(plain) === null) {
    assert.equal(outside.state, 'PORTABLE');
    assert.equal(outside.reason, 'no-git-root');
  }
  for (const [name, remote, reason] of [
    ['none', null, 'origin-missing'],
    ['local-path', '/srv/git/repo.git', 'origin-unsupported'],
    ['http', 'http://example.invalid/a/b.git', 'origin-unsupported'],
    ['file', 'file:///srv/git/repo.git', 'origin-unsupported'],
  ]) {
    const repo = fakeRepo(ctx.root, name, { remote, block: true, binding: true });
    const result = state(ctx, repo);
    assert.equal(result.state, 'PORTABLE', name);
    assert.equal(result.reason, reason, name);
    assert.equal(result.hold, false);
    assert.equal(result.persistable, false);
    assert.equal(result.repository_id, null);
  }
  const twoOrigins = fakeRepo(ctx.root, 'ambiguous', { configText: `[remote "origin"]\n\turl = ${REMOTE}\n\turl = git@github.com:x/y.git\n` });
  assert.equal(state(ctx, twoOrigins).reason, 'origin-ambiguous');
  assert.equal(fs.existsSync(ctx.registryPath), false, 'nothing is written');
});

test('S-03, S-06, S-07: materials without a decision', (t) => {
  const ctx = scratch(t);
  const optIn = state(ctx, fakeRepo(ctx.root, 'opt-in', { block: true, binding: true }));
  assert.deepEqual([optIn.state, optIn.rule, optIn.reason, optIn.governed_rules_bind], ['ENABLED', 'R4', 'repository-opt-in', true]);
  const blockOnly = state(ctx, fakeRepo(ctx.root, 'block-only', { block: true }));
  assert.deepEqual([blockOnly.state, blockOnly.rule, blockOnly.hold], ['UNKNOWN', 'R6', true]);
  const plain = state(ctx, fakeRepo(ctx.root, 'plain'));
  assert.deepEqual([plain.state, plain.rule, plain.hold], ['UNKNOWN', 'R7', true]);
  const bindingOnly = state(ctx, fakeRepo(ctx.root, 'binding-only', { binding: true }));
  assert.deepEqual([bindingOnly.state, bindingOnly.rule], ['UNKNOWN', 'R7']);
  const legacy = fakeRepo(ctx.root, 'legacy', { binding: true });
  writeBlock(legacy, 'GLOBAL-AGENTS.MD-TEMPLATE');
  const legacyState = state(ctx, legacy);
  assert.deepEqual([legacyState.state, legacyState.materials.governed_block_legacy], ['ENABLED', true]);
  assert.equal(fs.existsSync(ctx.registryPath), false, 'R4 derives ENABLED without writing a decision');
});

test('S-04, S-05: recorded decisions decide, a decline beats the repository opt-in', (t) => {
  const ctx = scratch(t);
  const declined = gitRepo(ctx.root, 'declined', 'https://github.com/example-owner/declined.git');
  writeBlock(declined);
  writeBinding(declined, { repository: 'example-owner/declined' });
  assert.equal(state(ctx, declined).state, 'ENABLED');
  decide(ctx, declined, 'decline');
  const afterDecline = state(ctx, declined);
  assert.deepEqual([afterDecline.state, afterDecline.rule, afterDecline.reason, afterDecline.governed_rules_bind], ['DECLINED', 'R2', 'user-declined', false]);

  const incomplete = gitRepo(ctx.root, 'incomplete', 'https://github.com/example-owner/incomplete.git');
  decide(ctx, incomplete, 'enable');
  const enabled = state(ctx, incomplete);
  assert.deepEqual([enabled.state, enabled.rule, enabled.materials_complete, enabled.programme_records_bind], ['ENABLED', 'R5', false, false]);
  decide(ctx, incomplete, 'disable');
  assert.deepEqual([state(ctx, incomplete).state, state(ctx, incomplete).reason], ['DECLINED', 'user-disabled']);
  decide(ctx, incomplete, 'enable');
  assert.equal(state(ctx, incomplete).state, 'ENABLED');
});

test('S-08, S-09: state follows the origin identity, not the path; clones and worktrees share it', (t) => {
  const ctx = scratch(t);
  const first = gitRepo(ctx.root, 'first');
  const second = gitRepo(ctx.root, 'second');
  git(first, ['-c', 'user.email=f@example.invalid', '-c', 'user.name=F', 'commit', '--allow-empty', '--quiet', '-m', 'init']);
  const worktree = path.join(ctx.root, 'first-worktree');
  git(first, ['worktree', 'add', '--quiet', '--detach', worktree]);
  const nested = path.join(worktree, 'deep', 'folder');
  fs.mkdirSync(nested, { recursive: true });
  for (const cwd of [first, second, worktree, nested]) assert.equal(state(ctx, cwd).state, 'UNKNOWN');
  decide(ctx, second, 'decline');
  for (const cwd of [first, second, worktree, nested]) assert.equal(state(ctx, cwd).state, 'DECLINED', cwd);
  const ids = new Set([first, second, worktree, nested].map(cwd => state(ctx, cwd).repository_id));
  assert.equal(ids.size, 1);
  // The same path pointed at another repository gets that repository's state.
  git(first, ['remote', 'set-url', 'origin', 'https://github.com/example-owner/other-repo.git']);
  const moved = state(ctx, first);
  assert.equal(moved.state, 'UNKNOWN');
  assert.notEqual(moved.repository_id, [...ids][0]);
  assert.equal(state(ctx, worktree).repository_id, moved.repository_id, 'a worktree reads the shared config');
});

test('identity: the git-free reader agrees with the registry\'s git-based identity', (t) => {
  const ctx = scratch(t);
  const remotes = [
    'https://github.com/example-owner/example-repo.git',
    'https://github.com/example-owner/example-repo',
    'git@github.com:example-owner/example-repo.git',
    'ssh://git@github.com:2222/example-owner/example-repo.git',
    'https://GitHub.com/Example-Owner/Example-Repo.git',
  ];
  remotes.forEach((remote, index) => {
    const repo = gitRepo(ctx.root, `parity-${index}`, remote);
    const expected = registry.resolveRepositoryIdentity({ cwd: repo }).repository_id;
    assert.equal(governance.readIdentity(repo).repository_id, expected, remote);
  });
  // Quoting, comments, case, continuation lines and other sections as git writes or accepts them.
  const configs = [
    `[remote "origin"]\n\turl = "${REMOTE}" ; comment\n`,
    `[REMOTE "origin"]\n\tURL=${REMOTE}   # trailing comment\n`,
    `[remote.origin]\n\turl = ${REMOTE}\n`,
    `[remote "upstream"]\n\turl = https://github.com/a/b.git\n[remote "origin"]\n\turl = ${REMOTE.slice(0, 20)}\\\n${REMOTE.slice(20)}\n`,
    `[remote "origin"] url = ${REMOTE}\n`,
  ];
  const expected = registry.repositoryIdForCanonicalRemote(REMOTE);
  configs.forEach((configText, index) => {
    const repo = fakeRepo(ctx.root, `config-${index}`, { configText });
    assert.equal(governance.readIdentity(repo).repository_id, expected, configText);
  });
  assert.deepEqual(governance.gitConfigValues(`[remote "Origin"]\n\turl = ${REMOTE}\n`, 'remote', 'origin', 'url'), [], 'subsections keep their case');
});

test('binding: schema shape and agreement with the origin identity', (t) => {
  const ctx = scratch(t);
  const identity = governance.readIdentity(fakeRepo(ctx.root, 'identity'));
  assert.deepEqual(governance.bindingProblems(validBinding(), identity), []);
  assert.deepEqual(governance.bindingProblems(validBinding({ repository: 'Example-Owner/Example-Repo' }), identity), []);
  const problem = (overrides) => governance.bindingProblems(validBinding(overrides), identity).join('\n');
  assert.match(problem({ repository: 'someone/else' }), /does not match the origin remote/);
  assert.match(problem({ schema: 'x' }), /schema must be/);
  assert.match(problem({ parent_issue: 0 }), /parent_issue/);
  assert.match(problem({ store: { kind: 'drive', repository: 'a/b', branch: 'main', path: 's/' } }), /store\.kind/);
  assert.match(problem({ store: { kind: 'github', repository: 'example-owner/example-repo', branch: 'main', path: 's/' } }), /separate repository/);
  assert.match(problem({ required_checks: [''] }), /required_checks/);
  assert.deepEqual(governance.bindingProblems(null, identity).length > 0, true);
  const invalid = fakeRepo(ctx.root, 'invalid-binding', { block: true });
  fs.mkdirSync(path.join(invalid, '.github'));
  fs.writeFileSync(path.join(invalid, '.github', 'toolkit-programme.json'), '{not json');
  const result = state(ctx, invalid);
  assert.deepEqual([result.state, result.rule, result.materials.binding_present, result.materials.binding_problems], ['UNKNOWN', 'R6', true, ['not valid JSON']]);
  // This repository's own binding is valid for its own origin.
  const own = path.join(repoRoot, '.github', 'toolkit-programme.json');
  const ownIdentity = { remote: { path: '/weijunswj/ai-agent-toolkit.git' } };
  assert.deepEqual(governance.bindingProblems(JSON.parse(fs.readFileSync(own, 'utf8')), ownIdentity), []);
});

test('H-09 (unit): unreadable inputs hold inside a repository and never outside one', (t) => {
  const ctx = scratch(t);
  const repo = fakeRepo(ctx.root, 'corrupt', { block: true, binding: true });
  fs.mkdirSync(path.dirname(ctx.registryPath), { recursive: true });
  fs.writeFileSync(ctx.registryPath, '{"schema": "not-a-registry"');
  const corrupt = state(ctx, repo);
  assert.deepEqual([corrupt.state, corrupt.rule, corrupt.reason, corrupt.hold], ['UNKNOWN', 'ERROR', 'registry-unreadable', true]);
  assert.match(corrupt.error_code, /^[A-Z_]+$/);
  // The same broken registry does not hold a repository without an identity.
  assert.equal(state(ctx, fakeRepo(ctx.root, 'no-origin', { remote: null })).hold, false);

  fs.rmSync(ctx.registryPath);
  const worktreeFile = path.join(ctx.root, 'dangling');
  fs.mkdirSync(worktreeFile);
  fs.writeFileSync(path.join(worktreeFile, '.git'), 'not a gitdir pointer');
  const dangling = state(ctx, worktreeFile);
  assert.deepEqual([dangling.state, dangling.rule, dangling.reason, dangling.hold], ['UNKNOWN', 'ERROR', 'identity-unreadable', true]);

  const thrower = new governance.GovernanceState({
    identityReader: () => ({ root: '/r', valid: true, repository_id: 'b'.repeat(64) }),
    materialsReader: () => { throw new Error('boom'); },
    decisionReader: () => ({ state: 'unresolved', decision_kind: null }),
  });
  const materialsError = thrower.evaluate('/r');
  assert.deepEqual([materialsError.state, materialsError.reason, materialsError.error_code], ['UNKNOWN', 'materials-unreadable', 'UNEXPECTED']);

  assert.throws(() => governance.registryPathFor({ registryPath: ctx.registryPath }), /REGISTRY_PATH_OVERRIDE_FORBIDDEN/);
});

test('H-15, H-16 (unit): no subprocess, no writes, no raw remote in the result', (t) => {
  const ctx = scratch(t);
  const repo = fakeRepo(ctx.root, 'quiet', { block: true, binding: true });
  const names = ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'];
  const saved = Object.fromEntries(names.map(name => [name, childProcess[name]]));
  const writes = ['writeFileSync', 'writeSync', 'mkdirSync', 'renameSync', 'rmSync', 'unlinkSync', 'openSync'];
  const savedFs = Object.fromEntries(writes.map(name => [name, fs[name]]));
  for (const name of names) childProcess[name] = () => { throw new Error(`subprocess ${name} used`); };
  for (const name of writes) {
    fs[name] = (...args) => {
      if (name === 'openSync' && (args[1] === undefined || args[1] === 'r')) return savedFs.openSync(...args);
      throw new Error(`fs.${name} used`);
    };
  }
  let result;
  const started = process.hrtime.bigint();
  try {
    for (let run = 0; run < 20; run += 1) result = state(ctx, repo);
  } finally {
    Object.assign(childProcess, saved);
    Object.assign(fs, savedFs);
  }
  const perRunMs = Number(process.hrtime.bigint() - started) / 1e6 / 20;
  assert.equal(result.state, 'ENABLED');
  assert.ok(perRunMs < 250, `one evaluation took ${perRunMs} ms`);
  const text = JSON.stringify(result);
  assert.doesNotMatch(text, /example-owner/, 'the raw remote is not in the result');
  assert.doesNotMatch(text, /github\.com/);
});
