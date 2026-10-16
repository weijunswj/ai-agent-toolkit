'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const retention = require('../scripts/toolkit-custody-retention-v3.cjs');
const receipt = require('../scripts/toolkit-github-program-receipt.cjs');
const { createFilesystemCleanupAdapter } = require('../scripts/toolkit-filesystem-cleanup-adapter.cjs');
const { OwnedReceiptCarrier, lifecycleFixtureRoot } = require('./support/owned-receipt-carrier.cjs');
const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');
// Every run provisions its own task-owned fixture root and receipt carrier; no
// retained historical fixture, carrier or effect identity is reused.
let ownerRoot, ownedCarrier;
function OWNER_ROOT() { ownerRoot ||= lifecycleFixtureRoot(REPOSITORY_ROOT); return ownerRoot.root(); }
function FIXTURE_ROOT() {
  const root = path.join(OWNER_ROOT(), 'filesystem-fixtures');
  fs.mkdirSync(root, { recursive: true });
  return root;
}
// Lifecycle source closure whose loaded bytes are bound into every evidence packet.
const SOURCE_PATHS = [
  '.claude-plugin/plugin.json', '.codex-plugin/plugin.json',
  'repo/contracts/toolkit-local-bridge/claude-plugin/plugin.json', 'repo/contracts/toolkit-local-bridge/codex-plugin/plugin.json',
  'repo/contracts/toolkit-local-bridge/version.json', 'repo/docs/CLEANUP-POLICY.md', 'repo/docs/TOOLKIT-V3.md',
  'repo/docs/published-surface-audit-baseline.json', 'repo/scripts/codex-delegation-config.cjs',
  'repo/scripts/setup-claude-toolkit-plugin.cjs', 'repo/scripts/setup-codex-toolkit-plugin.cjs',
  'repo/scripts/toolkit-agent-control.cjs', 'repo/scripts/toolkit-custody-retention-v3.cjs',
  'repo/scripts/toolkit-filesystem-cleanup-adapter.cjs', 'repo/scripts/toolkit-git-current-tree-expiry-adapter.cjs',
  'repo/scripts/toolkit-github-program-receipt.cjs', 'repo/scripts/toolkit-local-bridge.cjs',
  'repo/scripts/toolkit-recoverable-cleanup-windows.ps1', 'repo/tests/toolkit-custody-retention-v3.test.cjs',
  'repo/tests/toolkit-filesystem-cleanup-adapter.test.cjs', 'repo/tests/toolkit-git-current-tree-expiry-adapter.test.cjs',
  'repo/tests/toolkit-lifecycle-cleanup-integration.test.cjs', 'repo/tests/toolkit-v3-store-lifecycle.test.cjs'
];
const NOW = '2026-10-13T00:00:00.000Z', TRANSFER = '2026-09-01T00:00:00.000Z';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const compareCanonical = (a, b) => {
  const left = receipt.canonicalSerialize(a), right = receipt.canonicalSerialize(b);
  return left < right ? -1 : left > right ? 1 : 0;
};

function git(args) {
  const sourceRoot = path.resolve(__dirname, '..', '..');
  const result = spawnSync('git', args[0] === '-C' ? args : ['-C', sourceRoot, ...args], { encoding: 'utf8', shell: false,
    windowsHide: true, timeout: 30000, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || 'GIT_CANDIDATE_BINDING_FAILED');
  return result.stdout.trim();
}

// Binds evidence to the checkout that actually ran: HEAD, its tree, whether the
// lifecycle closure differs from HEAD, and the digest of the loaded bytes.
function candidateBinding() {
  const head = git(['rev-parse', 'HEAD']);
  const entries = SOURCE_PATHS.map(file => {
    const stat = fs.lstatSync(path.resolve(__dirname, '..', '..', file));
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), `source entry must be a regular file: ${file}`);
    return { path: file, sha256: sha(fs.readFileSync(path.resolve(__dirname, '..', '..', file))) };
  });
  const candidateDigest = sha(Buffer.from(`toolkit-post-trial-source-package.v2\\0${head}\\0${JSON.stringify(entries)}`, 'utf8'));
  const tree = git(['rev-parse', 'HEAD^{tree}']);
  const closureDirty = git(['status', '--porcelain=v1', '--', ...SOURCE_PATHS]) !== '';
  return { source_head: head, source_tree: tree, candidate_head: head, candidate_tree: tree,
    candidate_digest: candidateDigest, closure_dirty: closureDirty, phase: closureDirty ? 'WORKING_TREE' : 'COMMITTED' };
}

function fileIdentity(stat) { return { volume_serial: String(stat.dev), file_id: String(stat.ino), links: stat.nlink }; }
function custodyManifest(resource, directoryRoot, fileRows, proof = null) {
  const targetIdentity = { backend_id: 'task-local', resource_id: resource, path: '/disposal-target', mount_members: [] };
  const transferInventory = fileRows.map(row => ({ relative_path: row.relative_path, type: 'FILE', bytes: row.bytes.length, sha256: sha(row.bytes) }))
    .sort((a, b) => a.relative_path.localeCompare(b.relative_path));
  const inventory = fileRows.map((row, index) => ({ relative_path: row.relative_path, type: 'FILE', bytes: row.bytes.length,
    sha256: sha(row.bytes), identity: directoryRoot ? fileIdentity(fs.lstatSync(path.join(directoryRoot, ...row.relative_path.split('/'))))
      : { volume_serial: '1', file_id: String(index + 2), links: 1 } }));
  const nested = directoryRoot ? path.join(directoryRoot, 'nested') : null;
  inventory.push({ relative_path: 'nested', type: 'DIRECTORY', bytes: null, sha256: null, identity: nested ? fileIdentity(fs.lstatSync(nested)) : { volume_serial: '1', file_id: '4', links: 1 } });
  inventory.sort((a, b) => a.relative_path.localeCompare(b.relative_path));
  const payloadDigest = receipt.digestValue(transferInventory), evidence = { evidence_id: `evidence-${resource}`, content_digest: payloadDigest };
  const custodyCore = { evidence_id: evidence.evidence_id, custody_id: `custody-${resource}`, retention_status: 'HELD' };
  const readbackCore = { consumer_id: 'successor-reader', evidence_id: evidence.evidence_id, custody_id: custodyCore.custody_id,
    content_digest: payloadDigest, retrieved_at: TRANSFER };
  const ownershipCore = { artifact_id: resource, owner_id: 'trial-owner', target_digest: retention.targetDigest(targetIdentity), observed_at: TRANSFER };
  const targetObservationCore = { backend_id: targetIdentity.backend_id, observed_at: TRANSFER, identity_digest: retention.targetDigest(targetIdentity) };
  const anchorCore = { transfer_id: `transfer-${resource}`, producer_id: 'trial-producer', owner_id: 'trial-owner',
    source_target_digest: retention.targetDigest(targetIdentity),
    storage_target_identity: { backend_id: 'retained-store', resource_id: resource, path: '/verified-bundle', mount_members: [] },
    payload_digest: payloadDigest, inventory_digest: receipt.digestValue(transferInventory),
    storage_entries: transferInventory.map(row => ({ relative_path: `bundle/${row.relative_path}`, git_blob_or_revision: `sha256-${row.sha256}`,
      bytes: row.bytes, sha256: row.sha256 })).sort(compareCanonical),
    verified_transfer_at_utc: TRANSFER, expiry_at_utc: new Date(Date.parse(TRANSFER) + retention.TRANSFER_RETENTION_MS).toISOString(),
    transfer_evidence_reference_digest: receipt.digestValue({ fixture_only: true, phase: 'transfer', inventory: transferInventory }),
    independent_restore_reference_digest: receipt.digestValue({ fixture_only: true, phase: 'restore', inventory: transferInventory }) };
  if (proof) {
    anchorCore.storage_entries = structuredClone(proof.storage_entries).sort(compareCanonical);
    anchorCore.transfer_evidence_reference_digest = proof.transfer_digest;
    anchorCore.independent_restore_reference_digest = proof.restore_digest;
  }
  const releasedCore = { consumer_id: 'trial-builder', state: 'RELEASED', released_at: TRANSFER };
  const backendCore = { backend_id: targetIdentity.backend_id, path_case: 'SENSITIVE', observed_at: TRANSFER };
  const artifact = { artifact_id: resource, retention_class: 'LOCAL_TEMP', expected_target_identity: targetIdentity,
    observed_target_identity: structuredClone(targetIdentity), target_observation: { ...targetObservationCore, evidence_digest: receipt.digestValue(targetObservationCore) },
    ownership: { owner_id: ownershipCore.owner_id, observed_at: TRANSFER, evidence_digest: receipt.digestValue(ownershipCore) },
    evidence_reference: evidence, custody_reference: { ...custodyCore, custody_digest: receipt.digestValue(custodyCore) },
    custody_verified_at: TRANSFER, consumer_readback: { ...readbackCore, readback_digest: receipt.digestValue(readbackCore) },
    required_consumers: [{ ...releasedCore, release_evidence_digest: receipt.digestValue(releasedCore) }], dependencies: [], pins: [],
    transfer_anchor: { ...anchorCore, anchor_digest: receipt.digestValue(anchorCore) },
    disposal_target: { kind: 'DIRECTORY_DISPOSAL', root_relative: 'disposal-target', inventory, inventory_digest: receipt.digestValue(inventory) } };
  const manifest = { schema: retention.RETENTION_VIEW_SCHEMA,
    backend_facts: [{ ...backendCore, evidence_digest: receipt.digestValue(backendCore) }], artifacts: [artifact] };
  return { manifest, transferInventory, inventory, targetIdentity };
}

function CARRIER() {
  ownedCarrier ||= new OwnedReceiptCarrier({ repositoryRoot: REPOSITORY_ROOT, guard: root => receipt.resolveDatabasePath({
    repository: 'weijunswj/ai-agent-toolkit', parent_issue: 421, child_issue: 461, repositoryRoot: REPOSITORY_ROOT, stateRoot: root }) });
  return ownedCarrier.carrier();
}
function carrierFile(name) {
  const carrier = CARRIER();
  assert.match(name, /^[a-z0-9-]+\.json$/);
  const marker = JSON.parse(fs.readFileSync(path.join(carrier, 'toolkit-fixture-owner.json'), 'utf8'));
  assert.equal(marker.invocation_id, process.env.TOOLKIT_TEST_INVOCATION_ID);
  assert.equal(marker.owner_pid, Number(process.env.TOOLKIT_TEST_OWNER_PID));
  assert.equal(marker.repository_root, REPOSITORY_ROOT);
  process.kill(marker.owner_pid, 0);
  return path.join(carrier, name);
}
function savePacket(kind, core) {
  const value = { schema: 'toolkit.post-trial.fixed-case-evidence.v1', fixture_clock: NOW,
    actual_recorded_at_utc: new Date().toISOString(), source: candidateBinding(), ...core };
  const packet = { ...value, packet_digest: receipt.digestValue(value) };
  fs.writeFileSync(carrierFile('post-trial-' + kind + '.json'), JSON.stringify(packet), { flag: 'wx' });
  return packet;
}
function verifyPacket(packet) {
  const core = { ...packet }; delete core.packet_digest;
  assert.equal(receipt.digestValue(core), packet.packet_digest, 'EVIDENCE_PACKET_DIGEST_MISMATCH');
  assert.deepEqual(packet.source, candidateBinding(), 'EVIDENCE_CANDIDATE_BINDING_MISMATCH');
  return packet;
}
function readPacket(kind) {
  return verifyPacket(JSON.parse(fs.readFileSync(carrierFile('post-trial-' + kind + '.json'), 'utf8')));
}
function signAnchor(anchor) {
  const core = { ...anchor }; delete core.anchor_digest;
  anchor.anchor_digest = receipt.digestValue(core);
}
function pureManifest() {
  return custodyManifest('pure-logic-only', null, [
    { relative_path: 'root.bin', bytes: Buffer.from('short') },
    { relative_path: 'nested/owned.bin', bytes: Buffer.from('longer-fixture-payload') }
  ]).manifest;
}
function planFixture(manifest, now = NOW) {
  return retention.planRetention(manifest, { now, fixture_clock: true }).decisions[0];
}
function pureCases() {
  test('post-trial lifecycle pure: T01 transfer expiry is exact and does not restart after late release', () => {
    const m = pureManifest(), a = m.artifacts[0];
    a.retention_class = 'REMOTE_TEMP_BULK';
    a.transfer_anchor.storage_target_identity = structuredClone(a.expected_target_identity);
    signAnchor(a.transfer_anchor);
    const expiry = a.transfer_anchor.expiry_at_utc;
    assert.equal(planFixture(m, new Date(Date.parse(expiry) - 1).toISOString()).disposition, 'WAIT_UNTIL');
    assert.equal(planFixture(m, expiry).disposition, 'ELIGIBLE_NOW');
    const released = { consumer_id: 'late-consumer', state: 'RELEASED',
      released_at: new Date(Date.parse(expiry) + 86400000).toISOString() };
    a.required_consumers = [{ ...released, release_evidence_digest: receipt.digestValue(released) }];
    assert.equal(planFixture(m, released.released_at).disposition, 'ELIGIBLE_NOW');
    assert.equal(planFixture(m, released.released_at).immutable_expiry_at_utc, expiry);
  });
  test('post-trial lifecycle pure: T02 unequal-length canonical anchors reject order duplicates tampering and future clocks', () => {
    const original = pureManifest();
    assert.equal(planFixture(original).disposition, 'ELIGIBLE_NOW');
    const storage = original.artifacts[0].transfer_anchor.storage_entries;
    assert.deepEqual(storage, [...storage].sort(compareCanonical));
    assert.notEqual(storage[0].bytes, storage[1].bytes);
    for (const mutate of [
      a => a.storage_entries.reverse(),
      a => a.storage_entries.push(structuredClone(a.storage_entries[0])),
      a => { a.expiry_at_utc = new Date(Date.parse(a.expiry_at_utc) + 1).toISOString(); },
      a => { a.verified_transfer_at_utc = '2099-01-01T00:00:00.000Z'; },
      a => { a.independent_restore_reference_digest = null; }
    ]) {
      const m = structuredClone(original); mutate(m.artifacts[0].transfer_anchor);
      signAnchor(m.artifacts[0].transfer_anchor);
      assert.equal(planFixture(m).disposition, 'HOLD');
      assert.ok(planFixture(m).reason_codes.includes(retention.HOLD.TRANSFER_ANCHOR_UNKNOWN));
    }
  });
  test('post-trial lifecycle pure: P01 P02 each pin binds its owner reason condition and original expiry', () => {
    const m = pureManifest(), a = m.artifacts[0], expiry = a.transfer_anchor.expiry_at_utc;
    for (const reason of ['ACTIVE_CONSUMER', 'RECOVERY', 'AUDIT']) {
      const pin = { pin_id: 'pin-' + reason, reason, owner_id: a.ownership.owner_id, release_condition: 'root-explicit-release' };
      a.pins = [pin];
      assert.equal(planFixture(m).disposition, 'HOLD');
      const releaseCore = { ...pin, released_at: NOW };
      pin.release = { released_at: NOW, evidence_digest: receipt.digestValue(releaseCore) };
      assert.equal(planFixture(m).disposition, 'ELIGIBLE_NOW');
      assert.equal(a.transfer_anchor.expiry_at_utc, expiry);
      const forged = structuredClone(m); forged.artifacts[0].pins[0].owner_id = 'different-owner';
      assert.equal(planFixture(forged).disposition, 'HOLD');
      const future = structuredClone(m); future.artifacts[0].pins[0].release.released_at = '2099-01-01T00:00:00.000Z';
      const futurePin = future.artifacts[0].pins[0];
      futurePin.release.evidence_digest = receipt.digestValue({ pin_id: futurePin.pin_id, reason: futurePin.reason,
        owner_id: futurePin.owner_id, release_condition: futurePin.release_condition, released_at: futurePin.release.released_at });
      assert.equal(planFixture(future).disposition, 'HOLD');
    }
  });
  test('post-trial lifecycle pure: D02 B02 partial custody remains held without any effect authority', () => {
    const m = pureManifest(), snapshot = receipt.canonicalSerialize(m);
    const partial = structuredClone(m); partial.artifacts[0].consumer_readback.content_digest = sha(Buffer.from('wrong-restore'));
    assert.equal(planFixture(partial).disposition, 'HOLD');
    assert.equal(receipt.canonicalSerialize(m), snapshot);
    assert.equal(planFixture(m).disposition, 'ELIGIBLE_NOW');
  });
  test('post-trial lifecycle pure: B02 a complete forged facade cannot impersonate native store ownership', () => {
    let facadeCalls = 0;
    const noOp = () => { facadeCalls++; return null; };
    const store = { readV3RetentionPlan: noOp, createV3CleanupExecutionContext: noOp };
    assert.throws(() => retention.createLifecycleCleanupController({ store, admission: {},
      read_current_manifest: noOp, persist_manifest_compare_and_swap: noOp, read_operation_history: noOp,
      read_current_approval: noOp, read_independent_transfer_restore: noOp, read_independent_effect: noOp,
      filesystem_backend: null, git_backend: null, clock: () => NOW,
      limits: { max_artifacts: 4, max_paths: 64, max_bytes: 8388608 } }),
    error => error.code === 'GPR_PACKET_ADMISSION_REQUIRED');
    assert.equal(facadeCalls, 0);
  });
}
function integrationCases() {
  test('post-trial lifecycle integration: I01 I02 the real store advances only the eligible independent artifact', () => {
    const p = readPacket('positive');
    assert.equal(p.authentic_store_admission, true);
    assert.equal(p.original_family_preserved, true);
    assert.equal(p.worktree_unchanged, true);
    assert.equal(p.unrelated_tree_unchanged, true);
    assert.equal(p.batch_overrun_effect_calls, 0);
    assert.equal(p.independent_artifact_progressed, true);
    assert.equal(p.completed_state, 'READBACK_VERIFIED');
    assert.ok(p.phases.includes('PREPARED') && p.phases.includes('IN_FLIGHT') && p.phases.includes('READBACK_VERIFIED'));
  });
  test('post-trial successor recovery: R01 a fresh authentic successor reconciles the retained Git effect without replay', () => {
    const p = readPacket('positive');
    assert.ok(p.successor.pid > 0 && p.successor.pid !== p.producer_pid);
    assert.equal(p.successor.effect_calls, 0);
    assert.equal(p.successor.classification, 'READBACK_VERIFIED');
    assert.equal(p.successor.readback_state, 'READBACK_VERIFIED');
    assert.equal(p.independent_restore.complete, true);
    assert.notEqual(p.independent_restore.pid, p.producer_pid);
  });
  test('post-trial successor recovery: R02 unexplained drift and missing operation receipt remain UNKNOWN with no replay', () => {
    const p = readPacket('drift');
    assert.equal(p.pending_state, 'UNKNOWN');
    assert.equal(p.denial_receipts, 0);
    assert.equal(p.successor.effect_calls, 0);
    assert.equal(p.successor.code, 'CLEANUP_PENDING_RECONCILIATION_NO_REPLAY');
    assert.equal(p.expiry_attempts, 1);
    assert.equal(p.target_paths_survive, true);
  });
  test('post-trial evidence binding: E01 E02 raw candidate receipts and loaded bytes reject stale or altered evidence', () => {
    const p = readPacket('positive'), r = p.effect_receipt;
    const expected = { candidate_digest: p.source.candidate_digest, module_digest: sha(fs.readFileSync(require.resolve('../scripts/toolkit-git-current-tree-expiry-adapter.cjs'))),
      operation_id: r.operation_id, repository_identity: r.repository_identity, ref: r.ref, before_head: r.before_head,
      before_tree: r.before_tree, removed_entries: r.removed_entries, manifest_before_blob: r.manifest_before_blob,
      unchanged_tree_digest: r.unchanged_tree_digest };
    assert.equal(retention.validateGitExpiryReceipt(r, expected, []).classification, 'READBACK_VERIFIED');
    for (const key of ['candidate_digest', 'module_digest']) {
      assert.throws(() => retention.validateGitExpiryReceipt(r, { ...expected, [key]: sha(Buffer.from('stale-copy')) }, []));
    }
    const tampered = structuredClone(p); tampered.successor.effect_calls = 1;
    assert.throws(() => verifyPacket(tampered), /EVIDENCE_PACKET_DIGEST_MISMATCH/);
  });
}
function packageCases() {
  test('post-trial package/cache control: E01 E02 one frozen source closure supplies the aligned package and both caches', () => {
    const binding = candidateBinding();
    assert.match(binding.candidate_head, /^[0-9a-f]{40}$/);
    const root = REPOSITORY_ROOT;
    const version = JSON.parse(fs.readFileSync(path.join(root, 'repo/contracts/toolkit-local-bridge/version.json'), 'utf8')).version;
    assert.match(version, /^\d+\.\d+\.\d+$/);
    for (const file of ['.codex-plugin/plugin.json', '.claude-plugin/plugin.json',
      'repo/contracts/toolkit-local-bridge/codex-plugin/plugin.json', 'repo/contracts/toolkit-local-bridge/claude-plugin/plugin.json']) {
      assert.equal(JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')).version, version);
    }
    // Codex cache freshness (also consumed by the local bridge) fingerprints the exported list;
    // the Claude installer declares its packaged runtime inline.
    const adapterPath = 'repo/scripts/toolkit-git-current-tree-expiry-adapter.cjs';
    assert.ok(require('../scripts/setup-codex-toolkit-plugin.cjs').CACHE_FINGERPRINT_PATHS.includes(adapterPath),
      'Codex package fingerprint must include the actual adapter');
    assert.ok(fs.readFileSync(path.join(root, 'repo/scripts/setup-claude-toolkit-plugin.cjs'), 'utf8').includes(`["${adapterPath}",`),
      'Claude package must include the actual adapter');
    assert.match(fs.readFileSync(path.join(root, 'repo/scripts/toolkit-local-bridge.cjs'), 'utf8'),
      /verifyInstalledCacheFreshness[\s\S]*require\('\.\/setup-codex-toolkit-plugin\.cjs'\)/, 'bridge must reuse the Codex fingerprint verifier');
    const packet = { candidate: binding.candidate_head, tree: binding.candidate_tree, version,
      adapter_sha256: sha(fs.readFileSync(require.resolve('../scripts/toolkit-git-current-tree-expiry-adapter.cjs'))), installed: false };
    const digest = receipt.digestValue(packet);
    assert.notEqual(receipt.digestValue({ ...packet, adapter_sha256: sha(Buffer.from('stale-cache')) }), digest);
    assert.equal(packet.installed, false);
  });
}
module.exports = { OWNER_ROOT, FIXTURE_ROOT, CARRIER, SOURCE_PATHS, NOW, TRANSFER,
  sha, compareCanonical, candidateBinding, custodyManifest, carrierFile, savePacket, readPacket, verifyPacket, integrationCases };
// The integration cases read packets produced in-process by the Git expiry test,
// which registers them after its producers; here only pure and package cases run.
if (require.main === module) { pureCases(); packageCases(); }
