'use strict';

// One repository, one identity (#542, owner rule "ask once"): every clone form of a repository
// gives the same registry key, decisions stored under the keys earlier versions used still count,
// disagreeing old keys are asked about once, and the answer is written under the normalised key.
// Closure rows ID-01 to ID-05.

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const scripts = path.join(__dirname, '..', 'scripts');
const registry = require(path.join(scripts, 'toolkit-capability-registry.cjs'));
const governance = require(path.join(scripts, 'toolkit-governance-state.cjs'));
const a1 = require(path.join(scripts, 'toolkit-control-plane', 'control-plane-kernel.cjs'));

const CAPABILITY = 'repository.governance';

function git(cwd, args) {
  return childProcess.execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }).trim();
}

function scratch(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-governance-identity-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, registryPath: path.join(root, 'state', 'repository-governance.v1.json') };
}

function gitRepo(ctx, name, remote) {
  const repo = path.join(ctx.root, name);
  fs.mkdirSync(repo, { recursive: true });
  git(ctx.root, ['init', '--quiet', repo]);
  git(repo, ['remote', 'add', 'origin', remote]);
  return repo;
}

function opts(ctx) { return { registryPath: ctx.registryPath, testOnly: true }; }

function decide(ctx, repo, operation) {
  const current = registry.getRepositoryStatus({ cwd: repo, ...opts(ctx) });
  return registry.writeCapabilityDecision({
    cwd: repo, ...opts(ctx), capabilityId: CAPABILITY, operation,
    ownerAction: {
      confirmed: true, category: 'explicit-owner', channel: 'capability-route', operation,
      choice_semantic_id: registry.capabilityDecisionSemanticId(CAPABILITY, operation),
      contract_digest: registry.CONTRACT_DIGEST,
      scope_digest: registry.capabilityScopeDigest(current.repository_id, CAPABILITY, operation, 'capability-route'),
    },
    expectedRevision: current.registry_revision,
    expectedHash: current.snapshot_hash,
  });
}

// The key an earlier version stored: the digest of the remote exactly as cloned.
function oldKey(remote) {
  return crypto.createHash('sha256').update(registry.canonicalSerialize({
    identity_contract: registry.IDENTITY_CONTRACT,
    remote_contract: registry.REMOTE_IDENTITY_CONTRACT_VERSION,
    remote: a1.validateRemoteIdentity(remote).canonical,
  }), 'utf8').digest('hex');
}

// Moves one stored record to another key with valid receipts, as an earlier version wrote it.
function rekey(ctx, fromId, toId) {
  const stored = JSON.parse(fs.readFileSync(ctx.registryPath, 'utf8'));
  const record = stored.repositories.find(entry => entry.repository_id === fromId);
  record.repository_id = toId;
  for (const capability of record.capabilities) {
    const scope = registry.capabilityScopeDigest(toId, capability.capability_id, capability.decision_kind, capability.provenance.channel);
    capability.provenance.scope_digest = scope;
    const receipt = capability.receipt;
    receipt.repository_id = toId;
    receipt.scope_digest = scope;
    const { receipt_id: _old, ...payload } = receipt;
    receipt.receipt_id = crypto.createHash('sha256').update(registry.canonicalSerialize(payload), 'utf8').digest('hex');
  }
  stored.repositories.sort((left, right) => left.repository_id.localeCompare(right.repository_id));
  fs.writeFileSync(ctx.registryPath, JSON.stringify(stored, null, 2) + '\n');
  registry.parseRegistryBytes(fs.readFileSync(ctx.registryPath));
}

test('ID-01: every clone form of one repository is one identity; other repositories are not', () => {
  const forms = [
    'https://github.com/Example-Owner/Example-Repo.git',
    'https://github.com/example-owner/example-repo',
    'https://github.com/example-owner/example-repo/',
    'git@github.com:example-owner/example-repo.git',
    'git@github.com:Example-Owner/example-repo',
    'ssh://git@github.com/example-owner/example-repo.git',
    'ssh://git@github.com:22/example-owner/example-repo',
  ];
  const ids = new Set(forms.map(form => registry.repositoryIdForCanonicalRemote(a1.validateRemoteIdentity(form).canonical)));
  assert.equal(ids.size, 1);
  const other = registry.repositoryIdForCanonicalRemote('https://github.com/example-owner/other-repo.git');
  assert.equal(ids.has(other), false);
  // Off github.com the path keeps its case.
  assert.notEqual(registry.repositoryIdForCanonicalRemote('https://gitlab.example/Group/Repo.git'), registry.repositoryIdForCanonicalRemote('https://gitlab.example/group/repo.git'));
  assert.equal(registry.repositoryIdForCanonicalRemote('https://gitlab.example/Group/Repo.git'), registry.repositoryIdForCanonicalRemote('git@gitlab.example:Group/Repo'));
});

test('ID-02: a clone in another form sees the decision made in the first (asked once)', (t) => {
  const ctx = scratch(t);
  const https = gitRepo(ctx, 'https', 'https://github.com/example-owner/example-repo.git');
  const scp = gitRepo(ctx, 'scp', 'git@github.com:Example-Owner/example-repo');
  decide(ctx, https, 'decline');
  assert.equal(governance.governanceState(scp, opts(ctx)).state, 'DECLINED');
  assert.equal(registry.getRepositoryStatus({ cwd: scp, ...opts(ctx) }).capabilities[CAPABILITY].state, 'disabled');
});

test('ID-03: a decision stored under an earlier key still counts, and a new decision supersedes it', (t) => {
  const ctx = scratch(t);
  const remote = 'https://github.com/example-owner/example-repo.git';
  const repo = gitRepo(ctx, 'repo', remote);
  decide(ctx, repo, 'decline');
  const newKey = registry.repositoryIdForCanonicalRemote(remote);
  assert.notEqual(oldKey(remote), newKey);
  rekey(ctx, newKey, oldKey(remote));
  assert.equal(governance.governanceState(repo, opts(ctx)).state, 'DECLINED', 'the earlier key is honoured');
  // An scp clone of the same repository finds it too.
  const scp = gitRepo(ctx, 'scp', 'git@github.com:example-owner/example-repo.git');
  assert.equal(governance.governanceState(scp, opts(ctx)).state, 'DECLINED');
  // Enabling from a declined earlier key is a valid transition and lands under the new key.
  decide(ctx, scp, 'enable');
  const stored = JSON.parse(fs.readFileSync(ctx.registryPath, 'utf8'));
  assert.ok(stored.repositories.some(entry => entry.repository_id === newKey));
  assert.equal(governance.governanceState(repo, opts(ctx)).state, 'ENABLED');
  assert.equal(governance.governanceState(scp, opts(ctx)).state, 'ENABLED');
});

test('ID-04: earlier keys that disagree are unresolved until answered once', (t) => {
  const ctx = scratch(t);
  const first = gitRepo(ctx, 'first', 'https://github.com/example-owner/example-repo.git');
  const second = gitRepo(ctx, 'second', 'git@github.com:example-owner/example-repo.git');
  const newKey = registry.repositoryIdForCanonicalRemote('https://github.com/example-owner/example-repo');
  decide(ctx, first, 'decline');
  rekey(ctx, newKey, oldKey('https://github.com/example-owner/example-repo.git'));
  // A second record, enabled, under the scp form's earlier key.
  const third = gitRepo(ctx, 'third', 'https://github.com/example-owner/scratch-repo.git');
  decide(ctx, third, 'enable');
  rekey(ctx, registry.repositoryIdForCanonicalRemote('https://github.com/example-owner/scratch-repo.git'), oldKey('git@github.com:example-owner/example-repo.git'));
  for (const repo of [first, second]) {
    const result = governance.governanceState(repo, opts(ctx));
    assert.deepEqual([result.state, result.hold], ['UNKNOWN', true]);
  }
  decide(ctx, second, 'decline');
  for (const repo of [first, second]) assert.equal(governance.governanceState(repo, opts(ctx)).state, 'DECLINED');
});

test('ID-05: the git-free reader and the registry agree on the normalised key and the earlier keys', (t) => {
  const ctx = scratch(t);
  for (const [index, remote] of ['https://github.com/Example-Owner/Example-Repo.git', 'git@github.com:example-owner/example-repo', 'ssh://git@github.com:2222/example-owner/example-repo.git'].entries()) {
    const repo = gitRepo(ctx, `repo-${index}`, remote);
    const fromGit = registry.resolveRepositoryIdentity({ cwd: repo });
    const fromFile = governance.readIdentity(repo);
    assert.equal(fromFile.repository_id, fromGit.repository_id, remote);
    assert.deepEqual(fromFile.legacy_repository_ids, fromGit.legacy_repository_ids, remote);
    assert.ok(fromGit.legacy_repository_ids.includes(oldKey(remote)), remote);
    assert.equal(fromGit.legacy_repository_ids.includes(fromGit.repository_id), false);
  }
});
