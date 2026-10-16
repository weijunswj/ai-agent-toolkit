#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { digestValue, canonicalSerialize } = require('./toolkit-github-program-receipt.cjs');

const HEX40_OR_64 = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:+/@#-]{0,511}$/.test(value);
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const freeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
function fail(code) { throw Object.assign(new Error(code), { code }); }

class GitCurrentTreeExpiryAdapter {
  #mode; #remote; #repoIdentity; #ref; #prefix; #manifestPath; #gitExe; #timeout; #maxOutput; #candidateDigest; #moduleDigest;
  constructor(options) {
    const required = ['mode', 'remote_path', 'repository_identity', 'ref', 'owned_prefix', 'manifest_path', 'candidate_digest'];
    if (!options || Array.isArray(options) || typeof options !== 'object'
      || required.some(key => !Object.hasOwn(options, key))
      || Object.keys(options).some(key => ![...required, 'git_executable', 'watchdog_ms', 'max_output_bytes'].includes(key))
      || options.mode !== 'ORDINARY_GIT_REMOTE' || !path.isAbsolute(options.remote_path || '')
      || typeof options.repository_identity !== 'string' || !path.isAbsolute(options.repository_identity)
      || path.resolve(options.repository_identity) !== path.resolve(options.remote_path)
      || options.ref !== 'refs/heads/trial-lifecycle-proof'
      || typeof options.owned_prefix !== 'string' || !options.owned_prefix || options.owned_prefix.startsWith('/')
      || options.owned_prefix.includes('..') || options.owned_prefix.includes('\\')
      || !options.manifest_path || options.manifest_path.includes('..') || options.manifest_path.includes('\\')
      || !/^[a-f0-9]{64}$/.test(options.candidate_digest)
      || !Number.isInteger(options.watchdog_ms || 30000) || (options.watchdog_ms || 30000) > 30000
      || !Number.isInteger(options.max_output_bytes || 2097152) || (options.max_output_bytes || 2097152) > 2097152) {
      fail('GIT_CURRENT_TREE_BACKEND_UNQUALIFIED');
    }
    const remote = fs.realpathSync(options.remote_path);
    const stat = fs.lstatSync(remote);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('GIT_CURRENT_TREE_REMOTE_IDENTITY_INVALID');
    this.#mode = options.mode; this.#remote = remote; this.#repoIdentity = options.repository_identity;
    this.#ref = options.ref; this.#prefix = options.owned_prefix.replace(/\/+$/, '') + '/';
    this.#manifestPath = options.manifest_path; this.#gitExe = options.git_executable || 'git';
    this.#timeout = options.watchdog_ms || 30000; this.#maxOutput = options.max_output_bytes || 2097152;
    this.#candidateDigest = options.candidate_digest;
    this.#moduleDigest = sha256(fs.readFileSync(__filename));
    const bare = this.#git(['rev-parse', '--is-bare-repository']);
    if (!bare.ok || bare.stdout.toString('utf8').trim() !== 'true') fail('GIT_CURRENT_TREE_REMOTE_NOT_BARE');
    Object.defineProperties(this, {
      prepare: { value: this.prepare.bind(this), enumerable: true },
      execute: { value: this.execute.bind(this), enumerable: true },
      recover: { value: this.recover.bind(this), enumerable: true }
    });
    Object.freeze(this);
  }
  #run(args, input) {
    const result = spawnSync(this.#gitExe, args, { input, encoding: null, shell: false, windowsHide: true,
      timeout: this.#timeout, maxBuffer: this.#maxOutput, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    if (result.error) fail(result.error.code === 'ETIMEDOUT' ? 'GIT_CURRENT_TREE_OUTCOME_UNKNOWN' : 'GIT_CURRENT_TREE_COMMAND_FAILED');
    if (result.stdout.length > this.#maxOutput || result.stderr.length > this.#maxOutput) fail('GIT_CURRENT_TREE_OUTPUT_LIMIT');
    if (result.status !== 0) return { ok: false, code: result.status, stdout: result.stdout, stderr: result.stderr };
    return { ok: true, stdout: result.stdout, stderr: result.stderr };
  }
  #git(args, input) { return this.#run(['--git-dir', this.#remote, ...args], input); }
  #refHead() {
    const result = this.#run(['ls-remote', '--refs', this.#remote, this.#ref]);
    if (!result.ok) fail('GIT_CURRENT_TREE_REF_READ_FAILED');
    const lines = result.stdout.toString('utf8').trim().split(/\r?\n/).filter(Boolean);
    if (lines.length !== 1) fail('GIT_CURRENT_TREE_REF_UNKNOWN');
    const match = lines[0].match(/^([a-f0-9]{40}|[a-f0-9]{64})\s+(.+)$/);
    if (!match || match[2] !== this.#ref) fail('GIT_CURRENT_TREE_REF_UNKNOWN');
    return match[1];
  }
  #treeEntries(commit) {
    const result = this.#git(['ls-tree', '-rz', '-r', '--full-tree', commit]);
    if (!result.ok) fail('GIT_CURRENT_TREE_READ_FAILED');
    const records = result.stdout.toString('utf8').split('\0').filter(Boolean);
    if (records.length > 65536) fail('GIT_CURRENT_TREE_INVENTORY_LIMIT');
    return records.map(record => {
      const m = record.match(/^(\d{6}) (blob|tree) ([a-f0-9]{40}|[a-f0-9]{64})\t(.+)$/);
      if (!m || /[\u0000-\u001f]/.test(m[4])) fail('GIT_CURRENT_TREE_ENTRY_INVALID');
      return { mode: m[1], type: m[2], oid: m[3], path: m[4] };
    }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  }
  #buildTree(entries) {
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
      const result = this.#git(['mktree', '-z'], input);
      if (!result.ok) fail('GIT_CURRENT_TREE_CREATE_FAILED');
      const oid = result.stdout.toString('utf8').trim();
      if (!HEX40_OR_64.test(oid)) fail('GIT_CURRENT_TREE_CREATE_FAILED');
      return oid;
    };
    return build(root);
  }
  #readBlob(commit, filePath) {
    const result = this.#git(['show', `${commit}:${filePath}`]);
    if (!result.ok) fail('GIT_CURRENT_TREE_MANIFEST_READ_FAILED');
    return result.stdout;
  }
  prepare(input) {
    if (!input || input.operation_kind !== 'GIT_CURRENT_TREE_REMOVE' || !safeId(input.operation_id)
      || !input.artifact || input.artifact.disposal_target?.kind !== 'GIT_CURRENT_TREE'
      || !input.plan?.decisions?.some(item => item.artifact_id === input.artifact.artifact_id && item.disposition === 'ELIGIBLE_NOW')
      || !input.current_manifest || !input.current_manifest.artifacts?.some(a => a.artifact_id === input.artifact.artifact_id)) {
      fail('GIT_CURRENT_TREE_REQUEST_INVALID');
    }
    const head = this.#refHead();
    if (input.revision !== digestValue({ repository_identity: this.#repoIdentity, ref: this.#ref, head })) {
      fail('GIT_CURRENT_TREE_MANIFEST_REVISION_DRIFT');
    }
    const entries = this.#treeEntries(head);
    const tree = this.#git(['rev-parse', `${head}^{tree}`]);
    if (!tree.ok) fail('GIT_CURRENT_TREE_READ_FAILED');
    const manifestBytes = this.#readBlob(head, this.#manifestPath);
    let manifest;
    try { manifest = JSON.parse(manifestBytes.toString('utf8')); } catch (_) { fail('GIT_CURRENT_TREE_MANIFEST_INVALID'); }
    const stableManifest = value => ({ schema: value.schema, backend_facts: value.backend_facts || [],
      artifacts: value.artifacts.map(item => { const copy = { ...item }; delete copy.pending_cleanup; delete copy.disposal_observations; return copy; }) });
    if (!input.current_manifest || digestValue(stableManifest(manifest)) !== digestValue(stableManifest(input.current_manifest))) {
      fail('GIT_CURRENT_TREE_MANIFEST_DRIFT');
    }
    if (input.revision === undefined || !input.artifact.transfer_anchor || !input.artifact.disposal_target) fail('GIT_CURRENT_TREE_MANIFEST_BINDING_INVALID');
    const target = input.artifact.disposal_target;
    const removed = target.inventory.filter(item => item.type === 'FILE').map(item => {
      const gitPath = `${target.root_relative.replace(/\/+$/, '')}/${item.relative_path}`;
      if (!gitPath.startsWith(this.#prefix) || gitPath.startsWith('repo/') || gitPath.startsWith('.git/')) fail('GIT_CURRENT_TREE_SCOPE_INVALID');
      const found = entries.find(entry => entry.path === gitPath && entry.type === 'blob');
      if (!found || found.mode !== item.identity.mode || found.oid !== item.identity.blob) fail('GIT_CURRENT_TREE_OWNED_BLOB_DRIFT');
      const bytes = this.#git(['cat-file', 'blob', found.oid]);
      if (!bytes.ok || bytes.stdout.length !== item.bytes || sha256(bytes.stdout) !== item.sha256) fail('GIT_CURRENT_TREE_OWNED_BLOB_DRIFT');
      return { path: gitPath, mode: found.mode, blob: found.oid };
    }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    if (!removed.length || removed.length > 64 || new Set(removed.map(item => item.path)).size !== removed.length) fail('GIT_CURRENT_TREE_EMPTY_OR_DUPLICATE_SCOPE');
    const manifestBlobSha256 = sha256(manifestBytes);
    const targetDigest = digestValue({ repository_identity: this.#repoIdentity, ref: this.#ref,
      root_relative: target.root_relative, inventory_digest: target.inventory_digest });
    const unchanged = entries.filter(item => item.type === 'blob' && item.path !== this.#manifestPath
      && !removed.some(targetItem => targetItem.path === item.path)).map(item => [item.path, item.mode, item.oid]);
    const effectCore = { operation_id: input.operation_id, repository_identity: this.#repoIdentity, ref: this.#ref,
      before_head: head, before_tree: tree.stdout.toString('utf8').trim(), removed_entries: removed,
      manifest_blob_sha256: manifestBlobSha256, unchanged_tree_digest: digestValue(unchanged),
      operation_kind: input.operation_kind, safety_class: input.safety_class };
    const effectDigest = digestValue(effectCore);
    return freeze({ schema: 'toolkit.git-current-tree.proposal.v1', operation_id: input.operation_id,
      operation_kind: input.operation_kind, repository_identity: this.#repoIdentity, ref: this.#ref,
      before_head: head, before_tree: effectCore.before_tree, target_digest: targetDigest,
      inventory_digest: target.inventory_digest, effect_digest: effectDigest, backend_revision: head,
      manifest_path: this.#manifestPath, manifest_before_blob: manifestBlobSha256,
      removed_entries: removed, unchanged_tree_digest: effectCore.unchanged_tree_digest,
      candidate_digest: this.#candidateDigest, module_digest: this.#moduleDigest,
       manifest_revision: input.revision, manifest_digest: digestValue(input.current_manifest), safety_class: input.safety_class,
       resources: [{ kind: 'GIT_CURRENT_TREE', repository_identity: this.#repoIdentity, ref: this.#ref, removed_entries: removed }],
       current_manifest: input.current_manifest, expected_manifest: manifest });
  }
  execute({ proposal, accepted_action }) {
    if (!proposal || proposal.operation_kind !== 'GIT_CURRENT_TREE_REMOVE' || !accepted_action
      || accepted_action.operation_id !== proposal.operation_id || accepted_action.operation_kind !== proposal.operation_kind
      || accepted_action.target_digest !== proposal.target_digest || accepted_action.effect_digest !== proposal.effect_digest
      || accepted_action.manifest_revision !== proposal.manifest_revision || accepted_action.owner_id === undefined
       || proposal.safety_class !== 'RECOVERABLE_GIT_TREE_CHANGE' || !Array.isArray(proposal.resources)) {
      fail('GIT_CURRENT_TREE_APPROVAL_BINDING_INVALID');
    }
    const beforeExecutionHead = this.#refHead();
    if (beforeExecutionHead !== proposal.before_head) return freeze({ state: 'UNKNOWN', code: 'GIT_CURRENT_TREE_REF_DRIFT',
      operation_id: proposal.operation_id, operation_kind: proposal.operation_kind, operation_attempted: false,
      preparatory_objects_created: false, current_head: beforeExecutionHead,
      attempt_evidence_digest: digestValue({ operation_id: proposal.operation_id, effect_digest: proposal.effect_digest,
        expected_head: proposal.before_head, current_head: beforeExecutionHead, operation_attempted: false }) });
    const currentTree = this.#treeEntries(proposal.before_head);
    const manifestBytes = this.#readBlob(proposal.before_head, this.#manifestPath);
    if (sha256(manifestBytes) !== proposal.manifest_before_blob) return freeze({ state: 'UNKNOWN', code: 'GIT_CURRENT_TREE_MANIFEST_DRIFT',
      operation_id: proposal.operation_id, operation_kind: proposal.operation_kind, operation_attempted: false,
      preparatory_objects_created: false, current_head: beforeExecutionHead,
      attempt_evidence_digest: digestValue({ operation_id: proposal.operation_id, effect_digest: proposal.effect_digest,
        current_head: beforeExecutionHead, manifest_sha256: sha256(manifestBytes), operation_attempted: false }) });
    const removePaths = new Set(proposal.removed_entries.map(item => item.path));
    for (const item of proposal.removed_entries) {
      const found = currentTree.find(entry => entry.path === item.path);
      if (!found || found.mode !== item.mode || found.oid !== item.blob) return freeze({ state: 'UNKNOWN', code: 'GIT_CURRENT_TREE_OWNED_BLOB_DRIFT',
        operation_id: proposal.operation_id, operation_kind: proposal.operation_kind, operation_attempted: false,
        preparatory_objects_created: false, current_head: beforeExecutionHead,
        attempt_evidence_digest: digestValue({ operation_id: proposal.operation_id, effect_digest: proposal.effect_digest,
          current_head: beforeExecutionHead, path: item.path, observed_mode: found?.mode || null, observed_blob: found?.oid || null,
          operation_attempted: false }) });
      const bytes = this.#git(['cat-file', 'blob', found.oid]);
      if (!bytes.ok) fail('GIT_CURRENT_TREE_OWNED_BLOB_READ_FAILED');
    }
    const manifestEntry = currentTree.find(entry => entry.path === this.#manifestPath && entry.type === 'blob');
    if (!manifestEntry) fail('GIT_CURRENT_TREE_MANIFEST_MISSING');
    const nextManifest = structuredClone(proposal.current_manifest);
    const nextArtifact = nextManifest.artifacts.find(item => item.pending_cleanup?.operation_id === proposal.operation_id);
    if (!nextArtifact || nextArtifact.pending_cleanup.state !== 'PREPARED') fail('GIT_CURRENT_TREE_PREPARED_STATE_MISSING');
    nextArtifact.pending_cleanup = { ...nextArtifact.pending_cleanup, state: 'IN_FLIGHT',
      approval_evidence_reference: accepted_action.evidence_reference_digest };
    let nextManifestOid = null, treeOid = null, commitOid = null;
    try {
      const nextManifestBytes = Buffer.from(JSON.stringify(nextManifest), 'utf8');
      const manifestObject = this.#git(['hash-object', '-w', '--stdin'], nextManifestBytes);
      if (!manifestObject.ok) fail('GIT_CURRENT_TREE_MANIFEST_UPDATE_FAILED');
      nextManifestOid = manifestObject.stdout.toString('utf8').trim();
      if (!HEX40_OR_64.test(nextManifestOid)) fail('GIT_CURRENT_TREE_MANIFEST_UPDATE_FAILED');
      const remain = currentTree.filter(item => !removePaths.has(item.path) && item.path !== this.#manifestPath);
      remain.push({ mode: manifestEntry.mode, type: 'blob', oid: nextManifestOid, path: this.#manifestPath });
      treeOid = this.#buildTree(remain);
      const commit = this.#git(['commit-tree', treeOid, '-p', proposal.before_head], Buffer.from(`Toolkit current-tree expiry ${proposal.operation_id}\n`));
      if (!commit.ok) fail('GIT_CURRENT_TREE_COMMIT_FAILED');
      commitOid = commit.stdout.toString('utf8').trim();
      if (!HEX40_OR_64.test(commitOid)) fail('GIT_CURRENT_TREE_COMMIT_FAILED');
    } catch (error) {
      return freeze({ state: 'UNKNOWN', code: error.code || 'GIT_CURRENT_TREE_PREPARATION_UNKNOWN',
        operation_id: proposal.operation_id, operation_kind: proposal.operation_kind, operation_attempted: false,
        preparatory_objects_created: !!nextManifestOid, preparatory_objects_may_exist: true,
        candidate_manifest_blob: nextManifestOid, candidate_tree: treeOid, candidate_commit: commitOid,
        attempt_evidence_digest: digestValue({ operation_id: proposal.operation_id, effect_digest: proposal.effect_digest,
          candidate_manifest_blob: nextManifestOid, candidate_tree: treeOid, candidate_commit: commitOid,
          code: error.code || 'GIT_CURRENT_TREE_PREPARATION_UNKNOWN' }) });
    }
    let pushed;
    try { pushed = this.#git(['update-ref', '-m', `Toolkit current-tree expiry ${proposal.operation_id}`,
      this.#ref, commitOid, proposal.before_head]); }
    catch (error) {
      return freeze({ state: 'UNKNOWN', code: error.code || 'GIT_CURRENT_TREE_REF_CAS_UNKNOWN',
        operation_id: proposal.operation_id, operation_kind: proposal.operation_kind, operation_attempted: true,
        preparatory_objects_created: true, candidate_commit: commitOid,
        attempt_evidence_digest: digestValue({ operation_id: proposal.operation_id, effect_digest: proposal.effect_digest,
          expected_head: proposal.before_head, candidate_commit: commitOid, ref_write: 'CAS_OUTCOME_UNKNOWN',
          code: error.code || 'GIT_CURRENT_TREE_REF_CAS_UNKNOWN' }) });
    }
    if (!pushed.ok) return freeze({ state: 'UNKNOWN', code: 'GIT_CURRENT_TREE_REF_CAS_UNKNOWN',
      operation_id: proposal.operation_id, operation_kind: proposal.operation_kind, operation_attempted: true,
      preparatory_objects_created: true, candidate_commit: commitOid,
      attempt_evidence_digest: digestValue({ operation_id: proposal.operation_id, effect_digest: proposal.effect_digest,
        expected_head: proposal.before_head, candidate_commit: commitOid, ref_write: 'CAS_REJECTED_OR_UNKNOWN' }) });
    let observedHead = null;
    try {
    observedHead = this.#refHead();
    const actualCommit = this.#git(['cat-file', '-p', observedHead]);
    if (!actualCommit.ok) fail('GIT_CURRENT_TREE_READBACK_FAILED');
    const firstLine = actualCommit.stdout.toString('utf8').split(/\r?\n/).find(line => line.startsWith('parent '));
    const afterParent = firstLine?.slice(7) || '';
    const afterTree = this.#git(['rev-parse', `${observedHead}^{tree}`]);
    if (observedHead !== commitOid || afterParent !== proposal.before_head || !afterTree.ok) fail('GIT_CURRENT_TREE_READBACK_UNKNOWN');
    const afterEntries = this.#treeEntries(observedHead);
    if (proposal.removed_entries.some(item => afterEntries.some(entry => entry.path === item.path))) fail('GIT_CURRENT_TREE_READBACK_INVALID');
    const unchangedAfter = afterEntries.filter(item => item.type === 'blob' && item.path !== this.#manifestPath)
      .map(item => [item.path, item.mode, item.oid]);
    if (digestValue(unchangedAfter) !== proposal.unchanged_tree_digest) fail('GIT_CURRENT_TREE_UNRELATED_DRIFT');
    for (const item of proposal.removed_entries) {
      const prior = this.#readBlob(proposal.before_head, item.path);
      if (sha256(prior) !== sha256(this.#git(['cat-file', 'blob', item.blob]).stdout)) fail('GIT_CURRENT_TREE_HISTORY_READBACK_FAILED');
    }
    const afterTreeId = afterTree.stdout.toString('utf8').trim();
     const afterManifestBytes = this.#readBlob(observedHead, this.#manifestPath);
     let afterManifest;
     try { afterManifest = JSON.parse(afterManifestBytes.toString('utf8')); } catch (_) { fail('GIT_CURRENT_TREE_MANIFEST_READBACK_INVALID'); }
     const pending = afterManifest.artifacts?.find(item => item.pending_cleanup?.operation_id === proposal.operation_id)?.pending_cleanup;
     if (!pending || pending.state !== 'IN_FLIGHT' || pending.approval_evidence_reference !== accepted_action.evidence_reference_digest) {
       fail('GIT_CURRENT_TREE_MANIFEST_READBACK_INVALID');
     }
     const afterManifestBlob = sha256(afterManifestBytes);
    const referenceDigest = digestValue({ operation_id: proposal.operation_id, commit: observedHead, tree: afterTreeId,
      parent: afterParent, removed_entries: proposal.removed_entries, manifest_after_blob: afterManifestBlob,
       approval: accepted_action.evidence_reference_digest });
    const core = { schema: 'toolkit.custody.git-expiry-receipt.v1', candidate_digest: this.#candidateDigest,
      module_digest: this.#moduleDigest, operation_id: proposal.operation_id, repository_identity: this.#repoIdentity,
      ref: this.#ref, before_head: proposal.before_head, before_tree: proposal.before_tree, after_commit: observedHead,
      after_parent: afterParent, after_tree: afterTreeId, removed_entries: proposal.removed_entries,
      manifest_before_blob: proposal.manifest_before_blob, manifest_after_blob: afterManifestBlob,
      unchanged_tree_digest: proposal.unchanged_tree_digest, approval_reference_digest: accepted_action.evidence_reference_digest,
      effect_reference_digest: proposal.effect_digest, readback_reference_digest: referenceDigest, classification: 'READBACK_VERIFIED' };
    return freeze({ state: 'READBACK_VERIFIED', operation_id: proposal.operation_id, operation_kind: proposal.operation_kind,
      classification: 'READBACK_VERIFIED', evidence_reference_digest: digestValue(core), receipt: { ...core, receipt_digest: digestValue(core) },
      readback: { ref: this.#ref, head: observedHead, parent: afterParent, tree: afterTreeId,
        removed_entries_absent: true, unrelated_tree_digest: digestValue(unchangedAfter), historical_bytes_verified: true,
         manifest_pending_inflight: true, manifest_after_blob: afterManifestBlob } });
    } catch (error) {
      return freeze({ state: 'UNKNOWN', code: error.code || 'GIT_CURRENT_TREE_READBACK_UNKNOWN',
        operation_id: proposal.operation_id, operation_kind: proposal.operation_kind, operation_attempted: true,
        preparatory_objects_created: true, candidate_commit: commitOid, observed_head: observedHead,
        attempt_evidence_digest: digestValue({ operation_id: proposal.operation_id, effect_digest: proposal.effect_digest,
          candidate_commit: commitOid, observed_head: observedHead, code: error.code || 'GIT_CURRENT_TREE_READBACK_UNKNOWN' }) });
    }
  }
  recover({ artifact, disposal_target, pending_operation, operation_history = [] }) {
    const target = disposal_target || artifact?.disposal_target;
    if (!pending_operation || !safeId(pending_operation.operation_id) || artifact?.disposal_target?.kind !== 'GIT_CURRENT_TREE'
      || target?.kind !== 'GIT_CURRENT_TREE' || !Array.isArray(operation_history)
      || !/^[a-f0-9]{64}$/.test(pending_operation.target_digest || '')
      || target.inventory_digest !== pending_operation.inventory_digest) {
      return { state: 'HOLD', code: 'GIT_CURRENT_TREE_PENDING_INVALID', operation_attempted: false, mutation_authority: false };
    }
    const retainedOperations = operation_history.filter(item => item?.operation_id === pending_operation.operation_id);
    if (retainedOperations.length > 1) return { state: 'HOLD', code: 'GIT_CURRENT_TREE_PENDING_HISTORY_AMBIGUOUS', operation_attempted: false, mutation_authority: false };
    try {
      const head = this.#refHead();
      const entries = this.#treeEntries(head);
      const commit = this.#git(['cat-file', '-p', head]);
      if (!commit.ok) fail('GIT_CURRENT_TREE_RECOVERY_COMMIT_UNKNOWN');
      const parent = commit.stdout.toString('utf8').split(/\r?\n/).find(line => line.startsWith('parent '))?.slice(7) || null;
      const manifestBytes = this.#readBlob(head, this.#manifestPath);
      let manifest;
      try { manifest = JSON.parse(manifestBytes.toString('utf8')); } catch (_) { fail('GIT_CURRENT_TREE_RECOVERY_MANIFEST_INVALID'); }
      const pending = manifest.artifacts?.find(item => item.artifact_id === artifact.artifact_id)?.pending_cleanup;
      const tree = this.#git(['rev-parse', `${head}^{tree}`]);
      if (!tree.ok) fail('GIT_CURRENT_TREE_RECOVERY_TREE_UNKNOWN');
      const targetPaths = target.inventory.filter(item => item.type === 'FILE')
        .map(item => `${target.root_relative.replace(/\/+$/, '')}/${item.relative_path}`);
      const present = targetPaths.map(pathValue => entries.some(item => item.path === pathValue && item.type === 'blob'));
      const original = retainedOperations.find(item => item.schema === 'toolkit.custody.git-expiry-receipt.v1');
      if (original) {
        const core = { ...original }; delete core.receipt_digest;
        const expectedRemoved = target.inventory.filter(item => item.type === 'FILE').map(item => ({
          path: target.root_relative.replace(/\/+$/, '') + '/' + item.relative_path,
          mode: item.identity.mode, blob: item.identity.blob
        })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
        const beforeBytes = this.#readBlob(original.before_head, this.#manifestPath);
        const beforeManifest = JSON.parse(beforeBytes.toString('utf8'));
        const beforePending = beforeManifest.artifacts?.find(item => item.artifact_id === artifact.artifact_id)?.pending_cleanup;
        const beforeCommit = this.#git(['cat-file', '-p', original.before_head]);
        const beforeParents = beforeCommit.stdout.toString('utf8').split(/\r?\n/).filter(line => line.startsWith('parent '));
        const immutablePendingKeys = ['operation_id', 'operation_kind', 'target_digest', 'source_digest', 'inventory_digest', 'expected_backend_revision'];
        const unchanged = entries.filter(item => item.type === 'blob' && item.path !== this.#manifestPath)
          .map(item => [item.path, item.mode, item.oid]);
        const historicalBytes = expectedRemoved.every(item => {
          const stored = target.inventory.find(row => target.root_relative.replace(/\/+$/, '') + '/' + row.relative_path === item.path);
          const bytes = this.#readBlob(original.before_head, item.path);
          return bytes.length === stored.bytes && sha256(bytes) === stored.sha256;
        });
        if (original.receipt_digest === digestValue(core) && original.classification === 'READBACK_VERIFIED'
          && original.candidate_digest === this.#candidateDigest && original.module_digest === this.#moduleDigest
          && original.repository_identity === this.#repoIdentity && original.ref === this.#ref
          && original.after_commit === head && original.after_parent === parent && parent === original.before_head
          && original.after_tree === tree.stdout.toString('utf8').trim()
          && original.manifest_before_blob === sha256(beforeBytes) && original.manifest_after_blob === sha256(manifestBytes)
          && original.unchanged_tree_digest === digestValue(unchanged)
          && canonicalSerialize(original.removed_entries) === canonicalSerialize(expectedRemoved)
          && beforePending?.state === 'PREPARED' && pending?.state === 'IN_FLIGHT'
          && immutablePendingKeys.every(key => beforePending[key] === pending_operation[key] && pending[key] === pending_operation[key])
          && beforeParents.length === 1 && beforeParents[0].slice(7) === pending_operation.expected_backend_revision
          && present.every(value => value === false) && historicalBytes) {
          return freeze({ state: 'ATTRIBUTABLE_COMPLETION', operation_id: pending_operation.operation_id,
            operation_attempted: false, mutation_authority: false, candidate_digest: this.#candidateDigest,
            module_digest: this.#moduleDigest, repository_identity: this.#repoIdentity, ref: this.#ref,
            current_head: head, current_parent: parent, current_tree: original.after_tree,
            target_digest: pending_operation.target_digest, inventory_digest: target.inventory_digest,
            original_receipt: original, retained_manifest_sha256: sha256(manifestBytes),
            target_paths_present: present, historical_bytes_verified: true,
            readback_reference_digest: digestValue({ operation_id: pending_operation.operation_id,
              head, parent, tree: original.after_tree, receipt_digest: original.receipt_digest, target_paths_present: present }) });
        }
      }
      return freeze({ state: 'OBSERVED', operation_id: pending_operation.operation_id, operation_attempted: false,
        repository_identity: this.#repoIdentity, ref: this.#ref, current_head: head, current_parent: parent,
        current_tree: tree.stdout.toString('utf8').trim(),
        manifest_blob_sha256: sha256(manifestBytes), manifest_pending_state: pending?.operation_id === pending_operation.operation_id ? pending.state : null,
        target_digest: pending_operation.target_digest, inventory_digest: target.inventory_digest,
        target_paths_present: present, operation_history_digest: digestValue(operation_history),
        mutation_authority: false, requires_independent_attribution: true });
    } catch (error) { return { state: 'HOLD', code: error.code || 'GIT_CURRENT_TREE_RECOVERY_UNKNOWN', operation_attempted: false }; }
  }
}
Object.freeze(GitCurrentTreeExpiryAdapter.prototype);
function createTaskOwnedGitCurrentTreeExpiryAdapter(options) { return new GitCurrentTreeExpiryAdapter(options); }
module.exports = Object.freeze({ GitCurrentTreeExpiryAdapter, createTaskOwnedGitCurrentTreeExpiryAdapter });
