'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const retention=require('../scripts/toolkit-custody-retention-v3.cjs');
const {digestValue}=require('../scripts/toolkit-github-program-receipt.cjs');
const {createFilesystemCleanupAdapter}=require('../scripts/toolkit-filesystem-cleanup-adapter.cjs');
const NOW='2026-10-12T00:00:00Z',sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const shared=require('./toolkit-lifecycle-cleanup-integration.test.cjs');
// Fresh task-owned fixture root per run; no retained historical fixture is reused.
const FIXTURE_ROOT=()=>shared.FIXTURE_ROOT();
function fixture(t,accept=()=>true){
  if(fs.lstatSync(FIXTURE_ROOT()).isSymbolicLink())throw new Error('LIFECYCLE_FIXTURE_ROOT_ALIAS');
  const root=fs.mkdtempSync(path.join(FIXTURE_ROOT(),'quarantine-'));
  if(!fs.realpathSync(root).startsWith(fs.realpathSync(FIXTURE_ROOT())+path.sep))throw new Error('LIFECYCLE_FIXTURE_ROOT_MISMATCH');
  const bytes=Buffer.from('recoverable test bytes'),target=path.join(root,'local-copy');fs.writeFileSync(target,bytes);fs.mkdirSync(path.join(root,'quarantine'));
  const identity={backend_id:'owned-local',resource_id:'owned-copy',path:'/local-copy',mount_members:[]};
  const observation={backend_id:identity.backend_id,observed_at:NOW,identity_digest:retention.targetDigest(identity)};
  const ownership={artifact_id:'copy',owner_id:'task-owned-test',target_digest:retention.targetDigest(identity),observed_at:NOW};
  const fact={backend_id:identity.backend_id,path_case:'INSENSITIVE',observed_at:NOW};
  const custody={evidence_id:'copy-evidence',custody_id:'verified-store',retention_status:'HELD'};
  const readback={consumer_id:'successor',evidence_id:'copy-evidence',custody_id:'verified-store',content_digest:sha(bytes),retrieved_at:NOW};
  const released={consumer_id:'producer',state:'RELEASED',released_at:NOW};
  const manifest={schema:retention.LEGACY_RETENTION_VIEW_SCHEMA,backend_facts:[{...fact,evidence_digest:digestValue(fact)}],artifacts:[{
    artifact_id:'copy',retention_class:'LOCAL_TEMP',expected_target_identity:identity,observed_target_identity:identity,
    target_observation:{...observation,evidence_digest:digestValue(observation)},
    ownership:{owner_id:ownership.owner_id,observed_at:NOW,evidence_digest:digestValue(ownership)},
    evidence_reference:{evidence_id:'copy-evidence',content_digest:sha(bytes)},custody_reference:{...custody,custody_digest:digestValue(custody)},custody_verified_at:NOW,
    consumer_readback:{...readback,readback_digest:digestValue(readback)},required_consumers:[{...released,release_evidence_digest:digestValue(released)}],dependencies:[],pins:[]
  }]};
  const file=path.join(root,'manifest.json');fs.writeFileSync(file,JSON.stringify(manifest));
  const adapter=createFilesystemCleanupAdapter({task_root:root,powershell:process.env.TOOLKIT_TEST_POWERSHELL,read_manifest:()=>JSON.parse(fs.readFileSync(file)),accept_native_operation:()=>accept({root,file,manifest,target})});
  const request={artifact_id:'copy',target_relative:'local-copy',quarantine_relative:'quarantine/copy',manifest_relative:'manifest.json',content_sha256:sha(bytes),now:NOW};
  return {root,file,target,manifest,adapter,request,bytes};
}
test('actual Windows exclusive-handle quarantine and fresh-process recovery preserve all bytes', {skip:process.platform!=='win32'},t=>{
  const f=fixture(t),out=f.adapter.execute(f.request);assert.equal(out.state,'QUARANTINE_OBSERVED',JSON.stringify(out));assert.equal(out.native_operation_state,'RECOVERABLY_QUARANTINED');assert.equal(fs.existsSync(f.target),false);assert.deepEqual(fs.readFileSync(path.join(f.root,'quarantine/copy')),f.bytes);
  const script='const fs=require("fs"),a=require(process.argv[1]);const root=process.argv[2],request=JSON.parse(process.argv[3]);console.log(JSON.stringify(a.createFilesystemCleanupAdapter({task_root:root,read_manifest:()=>JSON.parse(fs.readFileSync(root+"/manifest.json")),accept_native_operation:()=>false}).recover(request)));';
  const successor=spawnSync(process.execPath,['-e',script,path.resolve(__dirname,'../scripts/toolkit-filesystem-cleanup-adapter.cjs'),f.root,JSON.stringify(f.request)],{encoding:'utf8',timeout:10000});
  assert.equal(successor.status,0,successor.stderr);assert.equal(JSON.parse(successor.stdout).state,'QUARANTINE_OBSERVED');
});
test('real final boundary rejects active-consumer manifest drift with zero prohibited removal',{skip:process.platform!=='win32'},t=>{
  const f=fixture(t,({file,manifest})=>{manifest.artifacts[0].required_consumers=[{consumer_id:'new-active',state:'ACTIVE'}];fs.writeFileSync(file,JSON.stringify(manifest));return true;});
  const out=f.adapter.execute(f.request);assert.equal(out.state,'HOLD');assert.match(out.code,/ELIGIBILITY_DRIFT/);assert.deepEqual(fs.readFileSync(f.target),f.bytes);assert.equal(fs.existsSync(path.join(f.root,'quarantine/copy')),false);
});
test('real final boundary rejects replacement identity even with identical content',{skip:process.platform!=='win32'},t=>{
  const f=fixture(t,({target})=>{fs.renameSync(target,target+'.retained');fs.writeFileSync(target,'recoverable test bytes');return true;});
  const out=f.adapter.execute(f.request);assert.equal(out.state,'HOLD');assert.match(out.code,/IDENTITY_DRIFT/);assert.equal(fs.existsSync(f.target),true);assert.equal(fs.existsSync(path.join(f.root,'quarantine/copy')),false);
});
test('cleanup native denial and active consumer hold before native mutation',t=>{
  const f=fixture(t,()=>false);assert.equal(f.adapter.execute(f.request).code,'CLEANUP_NATIVE_PERMISSION_REQUIRED');assert.equal(fs.existsSync(f.target),true);
  f.manifest.artifacts[0].required_consumers=[{consumer_id:'active',state:'ACTIVE'}];fs.writeFileSync(f.file,JSON.stringify(f.manifest));assert.equal(f.adapter.execute(f.request).code,'CLEANUP_NOT_ELIGIBLE');assert.equal(fs.existsSync(f.target),true);
});

// Builds a task-owned transfer store holding the two payload objects that the
// directory fixture must be restored from independently.
function transferStore(root) {
  const remote = path.join(root, 'directory-transfer.git');
  const git = (args, input) => { const r = spawnSync('git', args, { input, windowsHide: true, timeout: 10000, maxBuffer: 1048576,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'Toolkit Lifecycle Test', GIT_AUTHOR_EMAIL: 'toolkit-lifecycle@example.invalid',
      GIT_COMMITTER_NAME: 'Toolkit Lifecycle Test', GIT_COMMITTER_EMAIL: 'toolkit-lifecycle@example.invalid' } });
    assert.equal(r.error, undefined); assert.equal(r.status, 0, String(r.stderr)); return r.stdout.toString('utf8').trim(); };
  git(['init', '--quiet', '--bare', remote]);
  const files = [{ git_path: 'owned/directory-a.bin', bytes: Buffer.from('directory payload A') },
    { git_path: 'owned/directory-b.bin', bytes: Buffer.from('directory payload B, longer') }];
  const owned = files.map(file => `100644 blob ${git(['--git-dir', remote, 'hash-object', '-w', '--stdin'], file.bytes)}\t${path.posix.basename(file.git_path)}\0`).join('');
  const ownedTree = git(['--git-dir', remote, 'mktree', '-z'], Buffer.from(owned));
  const tree = git(['--git-dir', remote, 'mktree', '-z'], Buffer.from(`040000 tree ${ownedTree}\towned\0`));
  const head = git(['--git-dir', remote, 'commit-tree', tree], Buffer.from('task-owned directory transfer\n'));
  return { remote, transfer_head: head, files };
}

test('post-trial native preparation: D02 B01 B02 E01 E02 authentic custody restore and exact proposal preserve the bounded directory', () => {
  const gitProof = require('./toolkit-git-current-tree-expiry-adapter.test.cjs');
  const support = require('./toolkit-v3-store-test-support.cjs');
  const source = shared.candidateBinding();
  const PROOF_ROOT = path.join(shared.FIXTURE_ROOT(), 'directory-proposal');
  assert.equal(fs.realpathSync(shared.FIXTURE_ROOT()), path.join(fs.realpathSync(shared.OWNER_ROOT()), 'filesystem-fixtures'));
  assert.equal(fs.existsSync(PROOF_ROOT), false, 'the task-owned proof root must be fresh');
  fs.mkdirSync(PROOF_ROOT);
  const positive = transferStore(shared.OWNER_ROOT());
  const target = path.join(PROOF_ROOT, 'disposal-target');
  fs.mkdirSync(target); fs.mkdirSync(path.join(target, 'nested'));
  const rows = positive.files.map((entry, index) => {
    const result = spawnSync('git', ['--git-dir', positive.remote, 'show', positive.transfer_head + ':' + entry.git_path],
      { windowsHide: true, timeout: 10000, maxBuffer: 1048576 });
    assert.equal(result.error, undefined); assert.equal(result.status, 0);
    assert.deepEqual(result.stdout, entry.bytes);
    return { name: index === 0 ? 'root.bin' : 'nested/owned.bin', relative_path: index === 0 ? 'root.bin' : 'nested/owned.bin',
      git_path: entry.git_path, bytes: result.stdout };
  });
  assert.equal(rows.length, 2);
  for (const row of rows) fs.writeFileSync(path.join(target, ...row.relative_path.split('/')), row.bytes, { flag: 'wx' });
  const sentinel = path.join(PROOF_ROOT, 'unrelated-sentinel.bin'), sentinelBytes = Buffer.from('retain-unrelated-sentinel');
  fs.writeFileSync(sentinel, sentinelBytes, { flag: 'wx' });
  const restored = gitProof.independentRestore(positive.remote, positive.transfer_head, rows, 'directory',
    path.join(PROOF_ROOT, 'independent-restore'));
  const built = shared.custodyManifest('directory-core-correction-01', target, rows, restored);
  const manifestPath = path.join(PROOF_ROOT, 'manifest.json'), manifestBytes = Buffer.from(JSON.stringify(built.manifest));
  fs.writeFileSync(manifestPath, manifestBytes, { flag: 'wx' });
  const revision = sha(manifestBytes), view = { reference: support.evidenceReference('native-directory-retention', manifestBytes), bytes: manifestBytes };
  let corruptRestore = false, nativeCalls = 0, manifestWrites = 0;
  const readers = {
    readV3RetentionObservation({ reference_digest }) { return { reference_digest, as_of: shared.NOW, manifest: structuredClone(built.manifest),
      revision, bytes_digest: require('../scripts/toolkit-github-program-receipt.cjs').digestValue(built.manifest) }; },
    readV3CleanupManifest({ expected_revision, expected_bytes_digest }) {
      assert.equal(expected_revision, revision); assert.equal(expected_bytes_digest, digestValue(built.manifest));
      assert.deepEqual(fs.readFileSync(manifestPath), manifestBytes);
      return { manifest: structuredClone(built.manifest), revision, bytes_digest: digestValue(built.manifest) };
    },
    persistV3CleanupManifestCompareAndSwap() { manifestWrites++; throw Error('V15_MANIFEST_EFFECT_FORBIDDEN'); },
    readV3CleanupOperationHistory() { return []; },
    readV3CleanupCurrentApproval() { return null; },
    readV3CleanupIndependentEffect() { return null; },
    readV3IndependentTransferRestore({ artifact }) {
      const a = artifact.transfer_anchor;
      const restoredInventory = restored.report.restored_inventory.map(row => {
        const bytes = fs.readFileSync(path.join(restored.restore_root, ...row.relative_path.split('/')));
        assert.equal(sha(bytes), row.sha256); return structuredClone(row);
      });
      const core = { artifact_id: artifact.artifact_id, transfer_id: a.transfer_id,
        transfer_evidence_reference_digest: a.transfer_evidence_reference_digest,
        independent_restore_reference_digest: a.independent_restore_reference_digest, payload_digest: a.payload_digest,
        inventory_digest: a.inventory_digest, restored_inventory: corruptRestore ? restoredInventory.slice(0,1) : restoredInventory,
        reader_id: 'fresh-complete-restore-reader', restored_at_utc: shared.NOW };
      return { ...core, evidence_digest: digestValue(core) };
    }
  };
  const candidate = { ...support.CANDIDATE, head_sha: source.candidate_head, tree_sha: source.candidate_tree };
  const stored = support.createV3StoreFixture({ controllerConsumer: true, candidate, extraEvidence: [view],
    retention_view_evidence_id: view.reference.id, additionalTrustedReaders: readers });
  const adapter = createFilesystemCleanupAdapter({ task_root: PROOF_ROOT, manifest_relative: 'manifest.json',
    candidate_digest: source.candidate_digest, read_manifest: () => JSON.parse(fs.readFileSync(manifestPath, 'utf8')),
    accept_native_operation() { nativeCalls++; throw Error('V15_NATIVE_DISPOSAL_FORBIDDEN'); } });
  const context = stored.store.createV3CleanupExecutionContext(stored.admission);
  const controller = retention.createLifecycleCleanupController({ store: stored.store, admission: stored.admission, ...context,
    filesystem_backend: adapter, git_backend: null, clock: () => shared.NOW, limits: { max_artifacts: 1, max_paths: 64, max_bytes: 1048576 } });
  const request = { artifact_ids: [built.manifest.artifacts[0].artifact_id], max_artifacts: 1 };
  assert.equal(controller.planOnUse(request).decisions[0].disposition, 'ELIGIBLE_NOW');
  corruptRestore = true;
  assert.equal(controller.planOnUse(request).decisions[0].reason_codes[0], 'TRANSFER_RESTORE_UNVERIFIED');
  corruptRestore = false;
  const plan = retention.planRetention(built.manifest, { now: shared.NOW, trusted_clock: true });
  const input = { artifact: built.manifest.artifacts[0], current_manifest: built.manifest, revision, plan,
    limits: { max_artifacts: 1, max_paths: 64, max_bytes: 1048576 }, operation_id: 'directory-core-correction-owner-native-pending',
    operation_kind: 'DISPOSAL_DELETE', safety_class: 'IRREVERSIBLE_DIRECTORY_DISPOSAL' };
  const proposal = adapter.prepare(input);
  const pinned = structuredClone(built.manifest);
  pinned.artifacts[0].pins = [{ pin_id: 'active-recovery-pin', reason: 'RECOVERY',
    owner_id: pinned.artifacts[0].ownership.owner_id, release_condition: 'explicit-root-release' }];
  assert.throws(() => adapter.prepare({ ...input, artifact: pinned.artifacts[0], current_manifest: pinned,
    plan: retention.planRetention(pinned, { now: shared.NOW, trusted_clock: true }) }), /CLEANUP_NOT_ELIGIBLE/);
  assert.equal(proposal.candidate_digest, source.candidate_digest);
  assert.equal(proposal.module_digest, sha(fs.readFileSync(require.resolve('../scripts/toolkit-filesystem-cleanup-adapter.cjs'))));
  assert.equal(proposal.native_helper_digest, sha(fs.readFileSync(path.resolve(__dirname, '../scripts/toolkit-recoverable-cleanup-windows.ps1'))));
  assert.equal(proposal.safety_class, 'IRREVERSIBLE_DIRECTORY_DISPOSAL');
  assert.equal(proposal.manifest_sha256, sha(manifestBytes));
  assert.deepEqual(proposal.inventory, built.inventory);
  for (const row of rows) assert.deepEqual(fs.readFileSync(path.join(target, ...row.relative_path.split('/'))), row.bytes);
  assert.deepEqual(fs.readFileSync(sentinel), sentinelBytes);
  assert.equal(nativeCalls, 0); assert.equal(manifestWrites, 0);
  // The proposal is retained as a packet and must verify against its own digest and candidate.
  const packet = shared.savePacket('directory-proposal', { proposed_operation: proposal, manifest: built.manifest,
    transfer: restored, independent_restore: restored.report, authentic_store_admission: true,
    native_calls: nativeCalls, manifest_effect_calls: manifestWrites, deletion_executed: false,
    approval_state: 'PENDING_EXACT_OWNER_NATIVE_ACTION_APPROVAL', source_store_root: stored.storeRoot,
    retained_recovery_exclusion: restored.restore_root, sentinel_sha256: sha(sentinelBytes),
    fixture_bounds: { max_files: 16, max_entries: 64, max_depth: 8, max_content_bytes: 1048576 } });
  assert.equal(shared.readPacket('directory-proposal').packet_digest, packet.packet_digest);
});
