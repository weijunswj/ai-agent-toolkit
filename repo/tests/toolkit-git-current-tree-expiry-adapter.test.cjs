'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const receipt = require('../scripts/toolkit-github-program-receipt.cjs');
const retention = require('../scripts/toolkit-custody-retention-v3.cjs');
const support = require('./toolkit-v3-store-test-support.cjs');
const { createTaskOwnedGitCurrentTreeExpiryAdapter } = require('../scripts/toolkit-git-current-tree-expiry-adapter.cjs');

const REF = 'refs/heads/trial-lifecycle-proof';
const TRANSFER = '2026-09-01T00:00:00.000Z';
const NOW = '2026-10-13T00:00:00.000Z';
const MANIFEST_PATH = 'lifecycle-manifest.json';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const compareCanonical = (a, b) => {
  const left = receipt.canonicalSerialize(a), right = receipt.canonicalSerialize(b);
  return left < right ? -1 : left > right ? 1 : 0;
};
const gitBlob = bytes => crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])).digest('hex');
const clone = value => structuredClone(value);

function record(value) {
  const ledger = path.join(fixtureRoot(), 'git-proof-ledger.ndjson');
  const entry = Buffer.from(JSON.stringify({ recorded_at_utc: new Date().toISOString(), ...value }) + '\n', 'utf8');
  const existingBytes = fs.existsSync(ledger) ? fs.statSync(ledger).size : 0;
  if (existingBytes + entry.length > 32 * 1024 * 1024) throw new Error('GIT_FIXTURE_EVIDENCE_LIMIT');
  fs.appendFileSync(ledger, entry);
}

function run(args, options = {}) {
  const result = spawnSync('git', args, { cwd: options.cwd, input: options.input, encoding: null, shell: false,
    windowsHide: true, timeout: 30000, maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'Toolkit Lifecycle Trial',
      GIT_AUTHOR_EMAIL: 'toolkit-lifecycle@example.invalid', GIT_COMMITTER_NAME: 'Toolkit Lifecycle Trial',
      GIT_COMMITTER_EMAIL: 'toolkit-lifecycle@example.invalid' } });
  if (result.error) throw result.error;
  if (result.stdout.length > 2 * 1024 * 1024 || result.stderr.length > 2 * 1024 * 1024) throw new Error('GIT_FIXTURE_OUTPUT_LIMIT');
  const expected = options.expected === undefined ? 0 : options.expected;
  assert.equal(result.status, expected, result.stderr.toString('utf8'));
  return result.stdout;
}

function targetIdentity(resourceId) {
  return { backend_id: 'ordinary-git', resource_id: resourceId, path: '/owned', mount_members: [] };
}

function makeManifest(resourceId, files, proof) {
  const target = targetIdentity(resourceId), observedAt = TRANSFER;
  const payloadInventory = files.map(item => ({ relative_path: item.name, type: 'FILE', bytes: item.bytes.length,
    sha256: sha(item.bytes) })).sort((a, b) => a.relative_path.localeCompare(b.relative_path));
  const disposalInventory = files.map(item => ({ relative_path: item.name, type: 'FILE', bytes: item.bytes.length,
    sha256: sha(item.bytes), identity: { mode: '100644', blob: gitBlob(item.bytes) } }))
    .sort((a, b) => a.relative_path.localeCompare(b.relative_path));
  const payloadDigest = receipt.digestValue(payloadInventory);
  const evidence = { evidence_id: `evidence-${resourceId}`, content_digest: payloadDigest };
  const custodyCore = { evidence_id: evidence.evidence_id, custody_id: `custody-${resourceId}`, retention_status: 'HELD' };
  const readbackCore = { consumer_id: 'successor-reader', evidence_id: evidence.evidence_id,
    custody_id: custodyCore.custody_id, content_digest: payloadDigest, retrieved_at: observedAt };
  const ownershipCore = { artifact_id: resourceId, owner_id: 'trial-owner', target_digest: retention.targetDigest(target), observed_at: observedAt };
  const observationCore = { backend_id: target.backend_id, observed_at: observedAt, identity_digest: retention.targetDigest(target) };
  const sourceIdentity = { backend_id: 'local-source', resource_id: resourceId, path: '/trial-source', mount_members: [] };
  const anchorCore = { transfer_id: `transfer-${resourceId}`, producer_id: 'trial-producer', owner_id: 'trial-owner',
    source_target_digest: retention.targetDigest(sourceIdentity), storage_target_identity: target,
    payload_digest: payloadDigest, inventory_digest: receipt.digestValue(payloadInventory),
    storage_entries: files.map(item => ({ relative_path: `bundle/${item.name}`, git_blob_or_revision: gitBlob(item.bytes),
      bytes: item.bytes.length, sha256: sha(item.bytes) })).sort(compareCanonical),
    verified_transfer_at_utc: TRANSFER,
    expiry_at_utc: new Date(Date.parse(TRANSFER) + retention.TRANSFER_RETENTION_MS).toISOString(),
    transfer_evidence_reference_digest: proof.transfer_digest, independent_restore_reference_digest: proof.restore_digest };
  anchorCore.storage_entries = structuredClone(proof.storage_entries).sort(compareCanonical);
  const anchor = { ...anchorCore, anchor_digest: receipt.digestValue(anchorCore) };
  const releasedCore = { consumer_id: 'trial-builder', state: 'RELEASED', released_at: observedAt };
  const artifact = { artifact_id: resourceId, retention_class: 'REMOTE_TEMP_BULK', expected_target_identity: target,
    observed_target_identity: clone(target), target_observation: { ...observationCore, evidence_digest: receipt.digestValue(observationCore) },
    ownership: { owner_id: ownershipCore.owner_id, observed_at: observedAt, evidence_digest: receipt.digestValue(ownershipCore) },
    evidence_reference: evidence, custody_reference: { ...custodyCore, custody_digest: receipt.digestValue(custodyCore) },
    custody_verified_at: observedAt, consumer_readback: { ...readbackCore, readback_digest: receipt.digestValue(readbackCore) },
    required_consumers: [{ ...releasedCore, release_evidence_digest: receipt.digestValue(releasedCore) }],
    dependencies: [], pins: [], transfer_anchor: anchor,
    disposal_target: { kind: 'GIT_CURRENT_TREE', root_relative: 'owned', inventory: disposalInventory,
      inventory_digest: receipt.digestValue(disposalInventory) } };
  const factCore = { backend_id: target.backend_id, path_case: 'SENSITIVE', observed_at: observedAt };
  return { manifest: { schema: retention.RETENTION_VIEW_SCHEMA,
    backend_facts: [{ ...factCore, evidence_digest: receipt.digestValue(factCore) }], artifacts: [artifact] }, payloadInventory };
}

function worktreeInventory(worktree) {
  const rows = [];
  const visit = (directory, relative = '') => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) throw new Error('GIT_FIXTURE_LINK_NOT_ALLOWED');
      const next = relative ? `${relative}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute, next);
      else if (entry.isFile()) { const bytes = fs.readFileSync(absolute); rows.push({ path: next, mode: '100644', bytes: bytes.length, sha256: sha(bytes), blob: gitBlob(bytes) }); }
      else throw new Error('GIT_FIXTURE_ENTRY_TYPE_UNSUPPORTED');
    }
  };
  visit(worktree);
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

function treeEntries(remote, head) {
  const raw = run(['--git-dir', remote, 'ls-tree', '-rz', '-r', '--full-tree', head]).toString('utf8');
  return raw.split('\0').filter(Boolean).map(recordValue => {
    const match = recordValue.match(/^(\d{6}) (blob|tree) ([a-f0-9]{40}|[a-f0-9]{64})\t(.+)$/);
    if (!match) throw new Error('GIT_FIXTURE_TREE_ENTRY_INVALID');
    return { mode: match[1], type: match[2], oid: match[3], path: match[4] };
  }).sort((a, b) => a.path.localeCompare(b.path));
}

function headOf(remote) {
  const output = run(['ls-remote', '--refs', remote, REF]).toString('utf8').trim();
  if (!output) return null;
  const pieces = output.split(/\s+/);
  if (pieces.length !== 2 || pieces[1] !== REF) throw new Error('GIT_FIXTURE_REF_UNKNOWN');
  return pieces[0];
}

function manifestAt(remote, revision = headOf(remote)) {
  const bytes = run(['--git-dir', remote, 'show', `${revision}:${MANIFEST_PATH}`]);
  return { head: revision, revision: refRevision(remote, revision), manifest: JSON.parse(bytes.toString('utf8')) };
}

function buildTree(remote, entries) {
  const root = { files: [], dirs: new Map() };
  for (const entry of entries) {
    const parts = entry.path.split('/');
    let node = root;
    for (const part of parts.slice(0, -1)) {
      if (!node.dirs.has(part)) node.dirs.set(part, { files: [], dirs: new Map() });
      node = node.dirs.get(part);
    }
    node.files.push({ name: parts[parts.length - 1], mode: entry.mode, type: entry.type, oid: entry.oid });
  }
  const build = node => {
    const rows = [...node.files];
    for (const [name, child] of node.dirs) rows.push({ name, mode: '040000', type: 'tree', oid: build(child) });
    rows.sort((a, b) => {
      const left = a.name + (a.type === 'tree' ? '/' : ''), right = b.name + (b.type === 'tree' ? '/' : '');
      return left < right ? -1 : left > right ? 1 : 0;
    });
    const input = Buffer.concat(rows.map(row => Buffer.from(`${row.mode} ${row.type} ${row.oid}\t${row.name}\0`, 'utf8')));
    return run(['--git-dir', remote, 'mktree', '-z'], { input }).toString('utf8').trim();
  };
  return build(root);
}

function persistManifestSameRef(family, expectedRevision, manifest) {
  const observed = headOf(family.remote);
  if (refRevision(family.remote, observed) !== expectedRevision) {
    return { state: 'CONFLICT', revision: refRevision(family.remote, observed), bytes_digest: receipt.digestValue(manifestAt(family.remote, observed).manifest) };
  }
  const manifestBytes = Buffer.from(receipt.canonicalSerialize(manifest), 'utf8');
  assert.ok(familyBounds(family).commits < 12);
  record({ operation: 'manifest-cas-before-objects', remote: family.remote, expected_head: observed, expected_revision: expectedRevision, manifest_sha256: sha(manifestBytes) });
  const object = run(['--git-dir', family.remote, 'hash-object', '-w', '--stdin'], { input: manifestBytes }).toString('utf8').trim();
  const entries = treeEntries(family.remote, observed).filter(item => item.path !== MANIFEST_PATH);
  entries.push({ mode: '100644', type: 'blob', oid: object, path: MANIFEST_PATH });
  const tree = buildTree(family.remote, entries);
  const commit = run(['--git-dir', family.remote, 'commit-tree', tree, '-p', observed], {
    input: Buffer.from('Toolkit lifecycle manifest CAS\n', 'utf8')
  }).toString('utf8').trim();
  record({ operation: 'manifest-nonforce-ref-cas', remote: family.remote, expected_head: observed, expected_revision: expectedRevision, commit, tree });
  try {
    run(['--git-dir', family.remote, 'update-ref', '-m', 'Toolkit lifecycle manifest CAS', REF, commit, observed]);
  } catch (_) {
    const latest = headOf(family.remote);
    const latestManifest = manifestAt(family.remote, latest).manifest;
    return { state: latest === observed ? 'CONFLICT' : 'UNKNOWN', revision: refRevision(family.remote, latest),
      bytes_digest: receipt.digestValue(latestManifest) };
  }
  const latest = headOf(family.remote);
  const latestManifest = manifestAt(family.remote, latest).manifest;
  familyBounds(family);
  return { state: latest === commit ? 'APPLIED' : 'UNKNOWN', revision: refRevision(family.remote, latest),
    bytes_digest: receipt.digestValue(latestManifest) };
}

function sourceCandidateDigest() { return shared.candidateBinding().candidate_digest; }

const shared = require('./toolkit-lifecycle-cleanup-integration.test.cjs');
function fixtureRoot() { return shared.OWNER_ROOT(); }
// Creates a fresh task-owned bare remote whose seed commit carries an unrelated
// sibling, an unrelated owned leaf and a prior manifest, plus a plain unrelated
// worktree; every later assertion proves these stay byte-identical.
function seedFamily(family) {
  assert.equal(fs.existsSync(family.remote) || fs.existsSync(family.work), false, 'family paths must be fresh');
  const ledger = path.join(fixtureRoot(), 'git-proof-ledger.ndjson');
  if (!fs.existsSync(ledger)) fs.writeFileSync(ledger, '', { flag: 'wx' });
  run(['init', '--quiet', '--bare', family.remote]);
  const seed = [
    { path: 'sibling.txt', bytes: Buffer.from('unrelated sibling ' + family.id + '\n') },
    { path: 'owned/unrelated-retained.bin', bytes: Buffer.from('unrelated owned leaf') },
    { path: MANIFEST_PATH, bytes: Buffer.from(receipt.canonicalSerialize({ schema: 'toolkit.lifecycle-seed-manifest.v1', family: family.id, artifacts: [] })) },
  ];
  const entries = seed.map(item => ({ path: item.path, mode: '100644', type: 'blob',
    oid: run(['--git-dir', family.remote, 'hash-object', '-w', '--stdin'], { input: item.bytes }).toString('utf8').trim() }));
  const commit = run(['--git-dir', family.remote, 'commit-tree', buildTree(family.remote, entries)],
    { input: Buffer.from('Toolkit lifecycle task-owned seed\n') }).toString('utf8').trim();
  run(['--git-dir', family.remote, 'update-ref', REF, commit, '0'.repeat(40)]);
  for (const item of seed.filter(row => row.path !== MANIFEST_PATH)) {
    const target = path.join(family.work, ...item.path.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, item.bytes, { flag: 'wx' });
  }
  record({ operation: 'seed-commit', remote: family.remote, commit, entries });
  return commit;
}
function refRevision(remote, head = headOf(remote)) {
  return receipt.digestValue({ repository_identity: fs.realpathSync(remote), ref: REF, head });
}
function familyBounds(family) {
  const count = Number(run(['--git-dir', family.remote, 'rev-list', '--count', REF]).toString('utf8').trim());
  assert.ok(count <= 12, 'retained plus new family commits must fit the exact cap');
  const size = directory => fs.readdirSync(directory, { withFileTypes: true }).reduce((n, entry) => {
    assert.equal(entry.isSymbolicLink(), false);
    const file = path.join(directory, entry.name);
    return n + (entry.isDirectory() ? size(file) : fs.statSync(file).size);
  }, 0);
  const bytes = size(family.remote) + size(family.work);
  assert.ok(bytes <= 8388608, 'family retained bytes exceeded 8 MiB');
  return { commits: count, bytes };
}
function appendCommit(family, expectedHead, additions, purpose) {
  assert.equal(headOf(family.remote), expectedHead, 'exact governing ref changed before append');
  assert.ok(familyBounds(family).commits < 12);
  const beforeEntries = treeEntries(family.remote, expectedHead);
  const intent = additions.map(item => ({ path: item.path, mode: '100644', bytes: item.bytes.length,
    sha256: sha(item.bytes), blob: gitBlob(item.bytes) }));
  record({ operation: 'core-correction-append-before-objects', purpose, remote: family.remote,
    expected_head: expectedHead, inventory: beforeEntries, additions: intent });
  const entries = beforeEntries.filter(item => !additions.some(next => next.path === item.path));
  for (const item of additions) {
    const oid = run(['--git-dir', family.remote, 'hash-object', '-w', '--stdin'], { input: item.bytes }).toString('utf8').trim();
    assert.equal(oid, gitBlob(item.bytes));
    entries.push({ path: item.path, mode: '100644', type: 'blob', oid });
  }
  const tree = buildTree(family.remote, entries);
  const commit = run(['--git-dir', family.remote, 'commit-tree', tree, '-p', expectedHead],
    { input: Buffer.from('Toolkit Core correction ' + purpose + '\n') }).toString('utf8').trim();
  record({ operation: 'core-correction-nonforce-ref-cas', purpose, remote: family.remote,
    expected_head: expectedHead, commit, tree, additions: intent });
  run(['--git-dir', family.remote, 'update-ref', '-m', 'Toolkit Core correction ' + purpose, REF, commit, expectedHead]);
  assert.equal(headOf(family.remote), commit);
  familyBounds(family);
  return commit;
}
const RESTORE_SCRIPT = String.raw`
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),cp=require("node:child_process");
const hash=b=>crypto.createHash("sha256").update(b).digest("hex");
const inputBytes=fs.readFileSync(process.argv[1]),d=JSON.parse(inputBytes),out=process.argv[2],report=process.argv[3];
if(fs.existsSync(out)||fs.existsSync(report))throw Error("RESTORE_PATH_NOT_ABSENT");
fs.mkdirSync(out);
const rows=[];
for(const row of d.files){
 if(!/^[a-zA-Z0-9._/-]+$/.test(row.relative_path)||row.relative_path.split("/").some(x=>!x||x==="."||x===".."))throw Error("RESTORE_PATH_INVALID");
 const r=cp.spawnSync("git",["--git-dir",d.remote,"show",d.transfer_head+":"+row.git_path],{windowsHide:true,timeout:5000,maxBuffer:1048576,env:{...process.env,GIT_TERMINAL_PROMPT:"0"}});
 if(r.error||r.status!==0||r.stdout.length!==row.bytes||hash(r.stdout)!==row.sha256)throw Error("RESTORE_OBJECT_MISMATCH");
 const target=path.join(out,...row.relative_path.split("/"));fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,r.stdout,{flag:"wx"});
 const b=fs.readFileSync(target);rows.push({relative_path:row.relative_path,type:"FILE",bytes:b.length,sha256:hash(b)});
}
rows.sort((a,b)=>a.relative_path.localeCompare(b.relative_path));
const result={schema:"toolkit.post-trial.independent-git-restore.v1",pid:process.pid,parent_pid:process.ppid,
 actual_restored_at_utc:new Date().toISOString(),input_sha256:hash(inputBytes),remote:d.remote,transfer_head:d.transfer_head,
 complete:true,restored_inventory:rows,restored_root:out};
const bytes=Buffer.from(JSON.stringify(result));fs.writeFileSync(report,bytes,{flag:"wx"});
if(!fs.readFileSync(report).equals(bytes)||!fs.readFileSync(process.argv[1]).equals(inputBytes))throw Error("RESTORE_READBACK_DRIFT");
console.log(JSON.stringify({pid:process.pid,complete:true,report_sha256:hash(bytes)}));
`;
function independentRestore(remote, transferHead, files, kind, outputRoot) {
  const transferPath = shared.carrierFile('post-trial-transfer-' + kind + '.json');
  const reportPath = shared.carrierFile('post-trial-restore-' + kind + '.json');
  const destination = outputRoot || path.join(path.dirname(transferPath), 'post-trial-restored-' + kind);
  const actualVerified = new Date().toISOString();
  const descriptor = { schema: 'toolkit.post-trial.verified-transfer.v1', fixture_clock: TRANSFER,
    actual_verified_at_utc: actualVerified, actual_expiry_at_utc: new Date(Date.parse(actualVerified) + retention.TRANSFER_RETENTION_MS).toISOString(),
    recovery_pin: { owner: 'Toolkit exclusive controller', release_condition: 'accepted supersession and explicit disposition' },
    remote, ref: REF, transfer_head: transferHead, files: files.map(item => ({
      relative_path: item.relative_path || item.name, git_path: item.git_path || 'owned/' + item.name,
      bytes: item.bytes.length, sha256: sha(item.bytes), blob: gitBlob(item.bytes)
    })) };
  const transferBytes = Buffer.from(JSON.stringify(descriptor));
  fs.writeFileSync(transferPath, transferBytes, { flag: 'wx' });
  const child = spawnSync(process.execPath, ['-e', RESTORE_SCRIPT, transferPath, destination, reportPath],
    { windowsHide: true, encoding: 'utf8', timeout: 10000, maxBuffer: 65536 });
  assert.equal(child.error, undefined); assert.equal(child.status, 0, child.stderr);
  const reportBytes = fs.readFileSync(reportPath), report = JSON.parse(reportBytes);
  assert.equal(report.complete, true); assert.notEqual(report.pid, process.pid);
  assert.equal(report.input_sha256, sha(transferBytes)); assert.deepEqual(fs.readFileSync(transferPath), transferBytes);
  const expected = descriptor.files.map(row => ({ relative_path: row.relative_path, type: 'FILE', bytes: row.bytes, sha256: row.sha256 }))
    .sort((a,b) => a.relative_path.localeCompare(b.relative_path));
  assert.deepEqual(report.restored_inventory, expected);
  return { transfer_digest: sha(transferBytes), restore_digest: sha(reportBytes), transfer_path: transferPath,
    restore_path: reportPath, restore_root: destination, report, descriptor,
    storage_entries: descriptor.files.map(row => ({ relative_path: row.git_path, git_blob_or_revision: row.blob,
      bytes: row.bytes, sha256: row.sha256 })).sort(compareCanonical) };
}
function addIndependentArtifacts(manifest) {
  const base = manifest.artifacts[0];
  for (const [id, state] of [['prior-unavailable', 'unavailable'], ['pinned-artifact', 'pin'], ['excluded-evidence', 'durable']]) {
    const a = clone(base), target = { backend_id: 'ordinary-git', resource_id: id, path: '/' + id, mount_members: [] };
    a.artifact_id = id; a.expected_target_identity = target; a.observed_target_identity = clone(target);
    const observation = { backend_id: target.backend_id, observed_at: TRANSFER, identity_digest: retention.targetDigest(target) };
    a.target_observation = { ...observation, evidence_digest: receipt.digestValue(observation) };
    const ownership = { artifact_id: id, owner_id: a.ownership.owner_id, target_digest: retention.targetDigest(target), observed_at: TRANSFER };
    a.ownership.evidence_digest = receipt.digestValue(ownership);
    a.transfer_anchor.storage_target_identity = clone(target);
    const anchor = { ...a.transfer_anchor }; delete anchor.anchor_digest;
    a.transfer_anchor.anchor_digest = receipt.digestValue(anchor);
    delete a.disposal_target;
    if (state === 'unavailable') a.consumer_readback.content_digest = sha(Buffer.from('unavailable-prior-evidence'));
    if (state === 'pin') a.pins = [{ pin_id: 'retained-pin', reason: 'RECOVERY', owner_id: a.ownership.owner_id, release_condition: 'explicit-root-release' }];
    if (state === 'durable') a.retention_class = 'DURABLE_EVIDENCE';
    manifest.artifacts.push(a);
  }
}
function setupFamily(number) {
  assert.ok(number === 1 || number === 2);
  const id = 'git-proof-0' + number;
  const family = { id, number, remote: path.join(fixtureRoot(), id + '.git'), work: path.join(fixtureRoot(), id + '-worktree') };
  family.retained = seedFamily(family);
  for (const directory of [fixtureRoot(), family.remote, family.work]) {
    assert.equal(fs.lstatSync(directory).isSymbolicLink(), false);
    assert.equal(fs.realpathSync(directory), path.resolve(directory));
  }
  assert.equal(headOf(family.remote), family.retained, 'family head must equal its task-owned seed');
  family.retained_worktree = worktreeInventory(family.work);
  family.retained_manifest = run(['--git-dir', family.remote, 'show', family.retained + ':' + MANIFEST_PATH]).toString('base64');
  const before = treeEntries(family.remote, family.retained);
  const word = number === 1 ? 'positive' : 'drift';
  family.word = word;
  family.files = [{ name: 'core-correction-' + word + '-a.bin', bytes: Buffer.from('core-correction-' + word + '-A') },
    { name: 'core-correction-' + word + '-b.bin', bytes: Buffer.from('core-correction-' + word + '-B-longer') }];
  for (const file of family.files) assert.equal(before.some(row => row.path === 'owned/' + file.name), false);
  const ledger = path.join(fixtureRoot(), 'git-proof-ledger.ndjson'), priorLedger = fs.readFileSync(ledger);
  family.ledger_prefix_bytes = priorLedger.length; family.ledger_prefix_sha256 = sha(priorLedger);
  record({ operation: 'seed-task-owned-family', remote: family.remote, expected_head: family.retained,
    retained_manifest_sha256: sha(Buffer.from(family.retained_manifest, 'base64')), worktree: family.retained_worktree,
    ledger_prefix_bytes: family.ledger_prefix_bytes, ledger_prefix_sha256: family.ledger_prefix_sha256, bounds: familyBounds(family) });
  family.transferHead = appendCommit(family, family.retained, family.files.map(file => ({ path: 'owned/' + file.name, bytes: file.bytes })), 'verified-payload-transfer');
  family.restore = independentRestore(family.remote, family.transferHead, family.files, word);
  const built = makeManifest(id, family.files, family.restore);
  if (number === 1) addIndependentArtifacts(built.manifest);
  family.manifest = built.manifest; family.payloadInventory = built.payloadInventory;
  family.initial = appendCommit(family, family.transferHead, [{ path: MANIFEST_PATH, bytes: Buffer.from(receipt.canonicalSerialize(family.manifest)) }], 'current-manifest');
  family.historyFile = shared.carrierFile('post-trial-effect-' + word + '.json');
  family.descriptorFile = shared.carrierFile('post-trial-family-' + word + '.json');
  fs.writeFileSync(family.descriptorFile, JSON.stringify({ ...family, files: family.files.map(file => ({ ...file, bytes: file.bytes.toString('base64') })) }), { flag: 'wx' });
  assert.deepEqual(worktreeInventory(family.work), family.retained_worktree);
  assert.equal(sha(fs.readFileSync(ledger).subarray(0, priorLedger.length)), family.ledger_prefix_sha256);
  return family;
}

function adapterFor(family, candidateDigest) {
  return createTaskOwnedGitCurrentTreeExpiryAdapter({ mode: 'ORDINARY_GIT_REMOTE', remote_path: family.remote,
    repository_identity: fs.realpathSync(family.remote), ref: REF, owned_prefix: 'owned/', manifest_path: MANIFEST_PATH,
    candidate_digest: candidateDigest, watchdog_ms: 30000, max_output_bytes: 2 * 1024 * 1024 });
}

function storeFor(family) {
  const viewBytes = Buffer.from(receipt.canonicalSerialize(family.manifest), 'utf8');
  const view = { reference: support.evidenceReference(`retention-${family.id}`, viewBytes), bytes: viewBytes };
  const trustedReaders = {
    readV3RetentionObservation({ reference_digest }) {
      const current = manifestAt(family.remote);
      return { reference_digest, as_of: NOW, manifest: current.manifest, revision: current.revision,
        bytes_digest: receipt.digestValue(current.manifest) };
    },
    readV3CleanupManifest({ expected_revision, expected_bytes_digest }) {
      const current = manifestAt(family.remote);
      const bytes_digest = receipt.digestValue(current.manifest);
      if (expected_revision !== current.revision || expected_bytes_digest !== bytes_digest) throw new Error('GPR_CLEANUP_CONTEXT_UNAVAILABLE');
      return { manifest: current.manifest, revision: current.revision, bytes_digest };
    },
    persistV3CleanupManifestCompareAndSwap({ expected_revision, manifest }) {
      return persistManifestSameRef(family, expected_revision, manifest);
    },
    readV3CleanupOperationHistory({ artifact_id }) {
      const currentManifest = manifestAt(family.remote).manifest;
      const artifact = currentManifest.artifacts.find(item => item.artifact_id === artifact_id);
      const operations = (artifact?.disposal_observations || []).filter(item => item.kind === 'OPERATION').map(item => clone(item.operation_receipt));
      if (fs.existsSync(family.historyFile)) operations.push(JSON.parse(fs.readFileSync(family.historyFile, 'utf8')).receipt);
      return operations;
    },
    readV3CleanupCurrentApproval({ artifact_id, operation_id, operation_kind, proposal, revision }) {
      const currentManifest = manifestAt(family.remote).manifest;
      const artifact = currentManifest.artifacts.find(item => item.artifact_id === artifact_id);
      const evidence_reference_digest = sha(Buffer.from(`owner-approved-fixture:${operation_id}:${proposal.effect_digest}`, 'utf8'));
      const native_binding = { evidence_reference_digest: sha(Buffer.from(`native-binding:${operation_id}`, 'utf8')),
        operation_kind, target_digest: proposal.target_digest, effect_digest: proposal.effect_digest };
      const core = { schema: 'toolkit.cleanup.action-approval.v1', operation_id, artifact_id, operation_kind,
        safety_class: proposal.safety_class, owner_id: artifact.transfer_anchor.owner_id, target_digest: proposal.target_digest,
        effect_digest: proposal.effect_digest, manifest_revision: revision, resources: clone(proposal.resources),
        expires_at_utc: new Date(Date.parse(NOW) + 10 * 60 * 1000).toISOString(), revoked_at_utc: null,
        native_binding, evidence_reference_digest };
      return { ...core, evidence_digest: receipt.digestValue(core) };
    },
    readV3IndependentTransferRestore({ artifact_id, artifact }) {
      const anchor = artifact.transfer_anchor;
      const core = { artifact_id: artifact.artifact_id, transfer_id: anchor.transfer_id,
        transfer_evidence_reference_digest: anchor.transfer_evidence_reference_digest,
        independent_restore_reference_digest: anchor.independent_restore_reference_digest,
        payload_digest: anchor.payload_digest, inventory_digest: anchor.inventory_digest,
        restored_inventory: family.restore.report.restored_inventory.map(row => {
          const bytes = fs.readFileSync(path.join(family.restore.restore_root, ...row.relative_path.split('/')));
          assert.equal(sha(bytes), row.sha256); assert.equal(bytes.length, row.bytes); return clone(row);
        }), reader_id: 'independent-restore-reader', restored_at_utc: NOW };
      return { ...core, evidence_digest: receipt.digestValue(core) };
    },
    readV3CleanupIndependentEffect({ operation_id, operation_kind, proposal, receipt: operationResult, pending_operation, recovery }) {
      if (!proposal) return independentRecoveryObservation(family, { operation_id, operation_kind, pending_operation, recovery });
      if (family.stopAfterEffect && operationResult?.state === 'READBACK_VERIFIED') {
        fs.writeFileSync(family.historyFile, JSON.stringify(operationResult), { flag: 'wx' });
        throw new Error('FIXTURE_INTERRUPTION_AFTER_GIT_EFFECT_BEFORE_TERMINAL_CAS');
      }
      const observedHead = headOf(family.remote);
      const entries = treeEntries(family.remote, observedHead);
      const removedPresent = proposal.removed_entries.map(item => entries.find(entry => entry.path === item.path && entry.mode === item.mode && entry.oid === item.blob));
      if (operationResult?.state === 'UNKNOWN') {
        const commitBytes = run(['--git-dir', family.remote, 'cat-file', '-p', observedHead]).toString('utf8');
        const parent = commitBytes.split(/\r?\n/).find(line => line.startsWith('parent '))?.slice(7) || null;
        const tree = run(['--git-dir', family.remote, 'rev-parse', `${observedHead}^{tree}`]).toString('utf8').trim();
        const manifestBytes = run(['--git-dir', family.remote, 'show', `${observedHead}:${MANIFEST_PATH}`]);
        const history = observedHead === proposal.before_head ? [] : run(['--git-dir', family.remote, 'rev-list', '--reverse', `${proposal.before_head}..${observedHead}`])
          .toString('utf8').split(/\r?\n/).filter(Boolean).map(commit => ({ commit,
            body: run(['--git-dir', family.remote, 'show', '-s', '--format=%B', commit]).toString('utf8').trim() }));
        const core = { operation_id, operation_kind, effect_digest: proposal.effect_digest, classification: 'UNKNOWN',
          observed_at_utc: NOW, readback_reference_digest: receipt.digestValue({ operation_id, current_head: observedHead, parent, tree,
            target_inventory_present: removedPresent.every(Boolean), history }), current_head: observedHead, before_head: proposal.before_head,
          before_tree: proposal.before_tree, current_parent: parent, current_tree: tree, manifest_after_blob: sha(manifestBytes),
          target_inventory_present: removedPresent.every(Boolean), target_paths_present: removedPresent.map(Boolean),
          history, operation_attempted: operationResult.operation_attempted === true,
          attempt_evidence_digest: operationResult.attempt_evidence_digest || null };
        return { ...core, evidence_digest: receipt.digestValue(core) };
      }
      const rawReceipt = operationResult?.receipt;
      const commitBytes = run(['--git-dir', family.remote, 'cat-file', '-p', observedHead]).toString('utf8');
      const parent = commitBytes.split(/\r?\n/).find(line => line.startsWith('parent '))?.slice(7) || '';
      const tree = run(['--git-dir', family.remote, 'rev-parse', `${observedHead}^{tree}`]).toString('utf8').trim();
      const unchanged = entries.filter(item => item.type === 'blob' && item.path !== MANIFEST_PATH)
        .map(item => [item.path, item.mode, item.oid]);
      const manifestBytes = run(['--git-dir', family.remote, 'show', `${observedHead}:${MANIFEST_PATH}`]);
      const historicalBytesVerified = proposal.removed_entries.every(item => {
        const oldBytes = run(['--git-dir', family.remote, 'show', `${proposal.before_head}:${item.path}`]);
        return sha(oldBytes) === sha(run(['--git-dir', family.remote, 'cat-file', 'blob', item.blob]));
      });
      const removedEntriesAbsent = proposal.removed_entries.every(item => !entries.some(entry => entry.path === item.path));
      const unrelatedTreeDigest = receipt.digestValue(unchanged), manifestAfterBlob = sha(manifestBytes);
      const readbackReference = receipt.digestValue({ operation_id, commit: observedHead, tree, parent,
        removed_entries: proposal.removed_entries, manifest_after_blob: manifestAfterBlob,
        approval: rawReceipt?.approval_reference_digest });
      const core = { operation_id, operation_kind, effect_digest: proposal.effect_digest, classification: 'READBACK_VERIFIED',
        observed_at_utc: NOW, readback_reference_digest: readbackReference, after_commit: observedHead,
        after_parent: parent, after_tree: tree, removed_entries_absent: removedEntriesAbsent,
        unrelated_tree_digest: unrelatedTreeDigest, manifest_after_blob: manifestAfterBlob, historical_bytes_verified: historicalBytesVerified };
      return { ...core, evidence_digest: receipt.digestValue(core) };
    }
  };
  const binding = shared.candidateBinding();
  const candidate = { ...support.CANDIDATE, head_sha: binding.candidate_head, tree_sha: binding.candidate_tree };
  const stored = support.createV3StoreFixture({ controllerConsumer: true, candidate, extraEvidence: [view],
    retention_view_evidence_id: view.reference.id, additionalTrustedReaders: trustedReaders });
  return { ...stored, getCurrentManifest: () => manifestAt(family.remote).manifest,
    getCurrentRevision: () => refRevision(family.remote) };
}

function controllerFor(stored, backend) {
  const context = stored.store.createV3CleanupExecutionContext(stored.admission);
  return retention.createLifecycleCleanupController({ store: stored.store, admission: stored.admission, ...context,
    filesystem_backend: null, git_backend: backend, clock: () => NOW,
    limits: { max_artifacts: 4, max_paths: 64, max_bytes: 8 * 1024 * 1024 } });
}

function independentRecoveryObservation(family, { operation_id, operation_kind, pending_operation, recovery }) {
  const head = headOf(family.remote), entries = treeEntries(family.remote, head);
  const body = run(['--git-dir', family.remote, 'cat-file', '-p', head]).toString('utf8');
  const parent = body.split(/\r?\n/).find(line => line.startsWith('parent '))?.slice(7) || null;
  const tree = run(['--git-dir', family.remote, 'rev-parse', head + '^{tree}']).toString('utf8').trim();
  const present = family.files.map(file => entries.some(entry => entry.path === 'owned/' + file.name));
  let original = null, verified = false;
  if (fs.existsSync(family.historyFile)) {
    original = JSON.parse(fs.readFileSync(family.historyFile, 'utf8')).receipt;
    const expected = { candidate_digest: sourceCandidateDigest(),
      module_digest: sha(fs.readFileSync(require.resolve('../scripts/toolkit-git-current-tree-expiry-adapter.cjs'))),
      operation_id, repository_identity: fs.realpathSync(family.remote), ref: REF, before_head: original.before_head,
      before_tree: original.before_tree, removed_entries: original.removed_entries,
      manifest_before_blob: original.manifest_before_blob, unchanged_tree_digest: original.unchanged_tree_digest };
    retention.validateGitExpiryReceipt(original, expected, []);
    const historical = family.files.every(file => run(['--git-dir', family.remote, 'show', original.before_head + ':owned/' + file.name]).equals(file.bytes));
    const manifestBytes = run(['--git-dir', family.remote, 'show', head + ':' + MANIFEST_PATH]);
    verified = head === original.after_commit && parent === original.after_parent && tree === original.after_tree
      && !present.some(Boolean) && historical && sha(manifestBytes) === original.manifest_after_blob
      && recovery?.original_receipt?.receipt_digest === original.receipt_digest;
  }
  const core = { operation_id, operation_kind, classification: verified ? 'READBACK_VERIFIED' : 'UNKNOWN',
    operation_attempted: false, observed_at_utc: NOW, target_digest: pending_operation.target_digest,
    inventory_digest: pending_operation.inventory_digest, after_commit: head, after_parent: parent, after_tree: tree,
    removed_entries_absent: !present.some(Boolean), historical_bytes_verified: verified,
    readback_reference_digest: receipt.digestValue({ operation_id, head, parent, tree, present,
      retained_receipt_digest: original?.receipt_digest || null }) };
  return { ...core, evidence_digest: receipt.digestValue(core) };
}

function resumeFamily(serialized) {
  const family = { ...serialized, files: serialized.files.map(file => ({ ...file, bytes: Buffer.from(file.bytes, 'base64') })) };
  const stored = storeFor(family), adapter = adapterFor(family, sourceCandidateDigest());
  let effectCalls = 0;
  const backend = { prepare: adapter.prepare, recover: adapter.recover, execute() { effectCalls++; throw Error('SUCCESSOR_REPLAY_FORBIDDEN'); } };
  const result = controllerFor(stored, backend).executeOnUse({ artifact_ids: [family.id],
    operation_ids: ['git-expiry-' + family.word + '-' + family.id] });
  const pending = stored.getCurrentManifest().artifacts.find(a => a.artifact_id === family.id).pending_cleanup;
  return { pid: process.pid, effect_calls: effectCalls, classification: result.results[0].state === 'READBACK_VERIFIED' ? 'READBACK_VERIFIED' : 'UNKNOWN',
    code: result.results[0].code || null, readback_state: pending.state, current_head: headOf(family.remote), result };
}
// Whole-successor watchdog: a fresh process repeats authenticated store admission, Git
// readback and native permission checks, which takes several seconds on Windows. This is
// a test-harness liveness bound, not a product latency requirement.
const SUCCESSOR_WATCHDOG_MS = 100000;
function freshSuccessor(family) {
  const output = shared.carrierFile('post-trial-successor-' + family.word + '.json');
  const script = 'const fs=require("node:fs");const helper=require(process.argv[1]);const input=fs.readFileSync(process.argv[2]);const result=helper.resumeFamily(JSON.parse(input));const bytes=Buffer.from(JSON.stringify(result));fs.writeFileSync(process.argv[3],bytes,{flag:"wx"});if(!fs.readFileSync(process.argv[3]).equals(bytes)||!fs.readFileSync(process.argv[2]).equals(input))throw Error("SUCCESSOR_INPUT_OR_RESULT_DRIFT");console.log(JSON.stringify({pid:process.pid,effect_calls:result.effect_calls,classification:result.classification}));';
  const child = spawnSync(process.execPath, ['-e', script, __filename, family.descriptorFile, output],
    { windowsHide: true, encoding: 'utf8', timeout: SUCCESSOR_WATCHDOG_MS, maxBuffer: 65536 });
  assert.equal(child.error, undefined); assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.notEqual(result.pid, process.pid); assert.equal(result.effect_calls, 0);
  return result;
}
function runControlledPositive(family, candidateDigest) {
  const stored = storeFor(family), adapter = adapterFor(family, candidateDigest);
  let effectCalls = 0;
  const backend = { prepare: adapter.prepare, recover: adapter.recover, execute(input) { effectCalls++; return adapter.execute(input); } };
  const controller = controllerFor(stored, backend);
  const ids = family.manifest.artifacts.map(a => a.artifact_id);
  const planned = controller.planOnUse({ artifact_ids: ids, max_artifacts: 4 });
  assert.equal(planned.state, 'PLANNED'); assert.equal(planned.decisions.filter(d => d.disposition === 'ELIGIBLE_NOW').length, 1);
  assert.equal(planned.decisions.find(d => d.artifact_id === family.id).disposition, 'ELIGIBLE_NOW');
  const extraIds = [...ids, 'overrun'];
  assert.equal(controller.planOnUse({ artifact_ids: extraIds, max_artifacts: 4 }).code, 'CLEANUP_BATCH_LIMIT');
  assert.equal(controller.executeOnUse({ artifact_ids: extraIds, operation_ids: extraIds.map((_,i) => 'overrun-' + i) }).code, 'CLEANUP_BATCH_LIMIT');
  assert.equal(effectCalls, 0);
  const context = stored.store.createV3CleanupExecutionContext(stored.admission);
  for (const [store, admission] of [[Object.create(stored.store), stored.admission], [stored.store, { ...stored.admission }]]) {
    assert.throws(() => retention.createLifecycleCleanupController({ store, admission, ...context,
      filesystem_backend: null, git_backend: backend, clock: () => NOW, limits: { max_artifacts: 4, max_paths: 64, max_bytes: 8388608 } }),
    error => error.code === 'GPR_PACKET_ADMISSION_REQUIRED');
  }
  family.stopAfterEffect = true;
  record({ operation: 'controller-git-positive-before-effect', remote: family.remote, expected_head: family.initial,
    inventory: treeEntries(family.remote, family.initial), candidate_digest: candidateDigest });
  const interrupted = controller.executeOnUse({ artifact_ids: [family.id], operation_ids: ['git-expiry-positive-' + family.id] });
  assert.equal(interrupted.results[0].state, 'HOLD');
  assert.equal(effectCalls, 1);
  const raw = JSON.parse(fs.readFileSync(family.historyFile, 'utf8')).receipt;
  assert.equal(raw.candidate_digest, candidateDigest);
  assert.equal(run(['--git-dir', family.remote, 'rev-parse', raw.before_head + '^']).toString('utf8').trim(), family.initial);
  assert.equal(headOf(family.remote), raw.after_commit);
  assert.equal(manifestAt(family.remote).manifest.artifacts[0].pending_cleanup.state, 'IN_FLIGHT');
  const successor = freshSuccessor(family);
  assert.equal(successor.classification, 'READBACK_VERIFIED', JSON.stringify(successor));
  assert.equal(successor.readback_state, 'READBACK_VERIFIED');
  const terminalHead = headOf(family.remote);
  assert.equal(run(['--git-dir', family.remote, 'rev-parse', terminalHead + '^']).toString('utf8').trim(), raw.after_commit);
  const latest = treeEntries(family.remote, terminalHead);
  for (const file of family.files) {
    assert.equal(latest.some(row => row.path === 'owned/' + file.name), false);
    assert.deepEqual(run(['--git-dir', family.remote, 'show', family.transferHead + ':owned/' + file.name]), file.bytes);
  }
  const beforeUnrelated = treeEntries(family.remote, family.initial).filter(row => row.path !== MANIFEST_PATH
    && !family.files.some(file => row.path === 'owned/' + file.name));
  const afterUnrelated = latest.filter(row => row.path !== MANIFEST_PATH);
  assert.deepEqual(afterUnrelated, beforeUnrelated);
  assert.deepEqual(worktreeInventory(family.work), family.retained_worktree);
  assert.deepEqual(run(['--git-dir', family.remote, 'show', family.retained + ':' + MANIFEST_PATH]), Buffer.from(family.retained_manifest, 'base64'));
  const ledger = fs.readFileSync(path.join(fixtureRoot(), 'git-proof-ledger.ndjson'));
  assert.equal(sha(ledger.subarray(0, family.ledger_prefix_bytes)), family.ledger_prefix_sha256);
  const pending = manifestAt(family.remote).manifest.artifacts[0].pending_cleanup;
  assert.equal(pending.state, 'READBACK_VERIFIED');
  shared.savePacket('positive', { producer_pid: process.pid, authentic_store_admission: true, fixture_only_authority: true,
    original_family_preserved: true, worktree_unchanged: true, unrelated_tree_unchanged: true, batch_overrun_effect_calls: 0,
    independent_artifact_progressed: true, completed_state: pending.state, phases: ['PREPARED','IN_FLIGHT','READBACK_VERIFIED'],
    effect_receipt: raw, successor, independent_restore: family.restore.report, transfer_proof: family.restore,
    remote: family.remote, retained_head: family.retained, transfer_head: family.transferHead, terminal_head: terminalHead,
    source_loaded_module: { path: require.resolve('../scripts/toolkit-git-current-tree-expiry-adapter.cjs'),
      sha256: sha(fs.readFileSync(require.resolve('../scripts/toolkit-git-current-tree-expiry-adapter.cjs'))) },
    bounds: familyBounds(family), effect_calls: effectCalls, interrupted_result: interrupted });
  return { receipt: raw, result: successor.result };
}
function runControlledDrift(family, candidateDigest) {
  const stored = storeFor(family), adapter = adapterFor(family, candidateDigest);
  let executeCalls = 0, externalHead;
  const backend = { prepare: adapter.prepare, recover: adapter.recover, execute(input) {
    executeCalls++;
    const file = family.files[0];
    externalHead = appendCommit(family, input.proposal.before_head, [
      { path: 'owned/' + file.name, bytes: Buffer.from('controlled-final-boundary-drift') }
    ], 'concurrent-owned-leaf-ref-drift');
    const result = adapter.execute(input);
    assert.equal(result.state, 'UNKNOWN'); assert.equal(result.operation_attempted, false);
    assert.equal(result.preparatory_objects_created, false);
    return result;
  } };
  const controller = controllerFor(stored, backend);
  const result = controller.executeOnUse({ artifact_ids: [family.id], operation_ids: ['git-expiry-drift-' + family.id] });
  assert.equal(result.results[0].state, 'HOLD'); assert.equal(result.results[0].code, 'CLEANUP_OUTCOME_UNKNOWN');
  assert.equal(executeCalls, 1);
  const pending = manifestAt(family.remote).manifest.artifacts[0].pending_cleanup;
  assert.equal(pending.state, 'UNKNOWN');
  const events = manifestAt(family.remote).manifest.artifacts[0].disposal_observations || [];
  assert.equal(events.filter(e => e.kind === 'OPERATION' && e.operation_receipt.classification === 'DENIED_NOT_APPLIED').length, 0);
  const current = headOf(family.remote), currentEntries = treeEntries(family.remote, current);
  assert.ok(family.files.every(file => currentEntries.some(row => row.path === 'owned/' + file.name)));
  const second = controller.executeOnUse({ artifact_ids: [family.id], operation_ids: ['git-expiry-drift-' + family.id] });
  assert.equal(second.results[0].code, 'CLEANUP_PENDING_RECONCILIATION_NO_REPLAY');
  assert.equal(executeCalls, 1); assert.equal(headOf(family.remote), current);
  const successor = freshSuccessor(family);
  assert.equal(successor.code, 'CLEANUP_PENDING_RECONCILIATION_NO_REPLAY');
  assert.equal(headOf(family.remote), current);
  assert.deepEqual(worktreeInventory(family.work), family.retained_worktree);
  shared.savePacket('drift', { producer_pid: process.pid, pending_state: pending.state, denial_receipts: 0,
    successor, expiry_attempts: executeCalls, target_paths_survive: true, external_head: externalHead,
    current_head: current, result, bounds: familyBounds(family), original_family_preserved: true });
  return { stored, result };
}
module.exports = { resumeFamily, independentRestore, refRevision };
if (require.main === module) {
  test('authenticated receipt-store controller executes one bound Git expiry and records independent history', () => {
    const proof = runControlledPositive(setupFamily(1), sourceCandidateDigest());
    assert.equal(proof.receipt.classification, 'READBACK_VERIFIED');
  });
  test('authenticated receipt-store controller records ref drift and refuses replay', () => {
    const proof = runControlledDrift(setupFamily(2), sourceCandidateDigest());
    assert.equal(proof.stored.getCurrentManifest().artifacts[0].pending_cleanup.state, 'UNKNOWN');
  });
  // Independent readers of the packets the producers above just persisted.
  shared.integrationCases();
}
