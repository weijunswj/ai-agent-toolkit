'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const retention = require('./toolkit-custody-retention-v3.cjs');
const compiler = require('./toolkit-gate-contract-compiler.cjs');
const { digestValue, canonicalSerialize } = require('./toolkit-github-program-receipt.cjs');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const safeRelative = value => typeof value === 'string' && !!value && !path.isAbsolute(value)
  && value.split(/[\\/]/).every(part => part && part !== '..' && part !== '.' && part.toLowerCase() !== '.git');
// Same operation-identity predicate as the custody manager and the Git expiry adapter.
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:+/@#-]{0,511}$/.test(value);
const freeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const sensitive = /^(?:\.env(?:\..*)?|secrets?|credentials?|id_rsa|id_ed25519|.*\.pem|.*\.key)$/i;
class FilesystemCleanupAdapter {
  #root; #read; #accept; #powershell; #manifestRelative; #candidateDigest; #moduleDigest; #nativeHelperPath; #nativeHelperDigest; #proposals = new WeakSet();
  constructor({ task_root, powershell, read_manifest, accept_native_operation, manifest_relative, candidate_digest }) {
    if (!path.isAbsolute(task_root || '') || typeof read_manifest !== 'function'
      || typeof accept_native_operation !== 'function') throw new Error('CLEANUP_NATIVE_BINDING_REQUIRED');
    const root = path.resolve(task_root);
    if (fs.realpathSync(root) !== root || fs.lstatSync(root).isSymbolicLink() || fs.existsSync(path.join(root, '.git'))) {
      throw new Error('CLEANUP_TASK_ROOT_UNQUALIFIED');
    }
    if (manifest_relative !== undefined && !safeRelative(manifest_relative)) throw new Error('CLEANUP_MANIFEST_PATH_INVALID');
    if (candidate_digest !== undefined && !/^[a-f0-9]{64}$/.test(candidate_digest)) throw new Error('CLEANUP_CANDIDATE_BINDING_INVALID');
    this.#root = root; this.#read = read_manifest; this.#accept = accept_native_operation;
    this.#powershell = powershell; this.#manifestRelative = manifest_relative || '';
    this.#candidateDigest = candidate_digest || null;
    this.#moduleDigest = digest(fs.readFileSync(__filename));
    this.#nativeHelperPath = path.join(__dirname, 'toolkit-recoverable-cleanup-windows.ps1');
    this.#nativeHelperDigest = digest(fs.readFileSync(this.#nativeHelperPath));
    Object.defineProperties(this, {
      prepare: { value: this.#prepareDirectory.bind(this), enumerable: true },
      execute: { value: this.#execute.bind(this), enumerable: true },
      recover: { value: this.#recover.bind(this), enumerable: true },
      executeDirectoryDisposal: { value: this.#executeDirectory.bind(this), enumerable: true },
      recoverDirectoryDisposal: { value: this.#recoverDirectory.bind(this), enumerable: true }
    });
    Object.freeze(this);
  }
  #owned(relative) {
    const root = this.#root;
    if (!safeRelative(relative)) throw new Error('CLEANUP_TARGET_UNSAFE');
    const result = path.resolve(root, relative);
    if (!result.startsWith(root + path.sep)) throw new Error('CLEANUP_OUTSIDE_TASK_ROOT');
    let current = root;
    for (const part of path.relative(root, result).split(path.sep)) {
      current = path.join(current, part);
      if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('CLEANUP_TARGET_ALIAS');
    }
    return result;
  }
  #identity(stat) { return { volume_serial: String(stat.dev), file_id: String(stat.ino), links: stat.nlink }; }
  #inventory(target) {
    const rootStat = fs.lstatSync(target);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('CLEANUP_DIRECTORY_ROOT_UNQUALIFIED');
    const inventory = []; let files = 0, bytes = 0;
    const walk = (directory, relative, depth) => {
      if (depth > 8) throw new Error('CLEANUP_DIRECTORY_DEPTH_LIMIT');
      const children = fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
      for (const child of children) {
        if (sensitive.test(child.name)) throw new Error('CLEANUP_SENSITIVE_NAME_HOLD');
        const childRelative = relative ? `${relative}/${child.name}` : child.name;
        const full = path.join(directory, child.name), stat = fs.lstatSync(full);
        if (stat.isSymbolicLink() || child.isSymbolicLink()) throw new Error('CLEANUP_DIRECTORY_ALIAS');
        if (stat.isDirectory()) {
          inventory.push({ relative_path: childRelative, type: 'DIRECTORY', bytes: null, sha256: null, identity: this.#identity(stat) });
          walk(full, childRelative, depth + 1);
        } else if (stat.isFile()) {
          files++; bytes += stat.size;
          inventory.push({ relative_path: childRelative, type: 'FILE', bytes: stat.size, sha256: digest(fs.readFileSync(full)), identity: this.#identity(stat) });
        } else throw new Error('CLEANUP_SPECIAL_FILE_HOLD');
        if (inventory.length > 64 || files > 16 || bytes > 1024 * 1024) throw new Error('CLEANUP_DIRECTORY_INVENTORY_LIMIT');
      }
    };
    walk(target, '', 1);
    inventory.sort((a, b) => a.relative_path < b.relative_path ? -1 : a.relative_path > b.relative_path ? 1 : 0);
    return { root_identity: this.#identity(rootStat), inventory, inventory_digest: digestValue(inventory), files, bytes };
  }
  #prepareDirectory(input) {
    if (!input || input.operation_kind !== 'DISPOSAL_DELETE' || input.safety_class !== 'IRREVERSIBLE_DIRECTORY_DISPOSAL'
      || input.artifact?.disposal_target?.kind !== 'DIRECTORY_DISPOSAL' || !input.operation_id
      || !input.revision || !this.#manifestRelative || !/^[a-f0-9]{64}$/.test(this.#candidateDigest || '')) throw new Error('CLEANUP_DIRECTORY_REQUEST_INVALID');
    const targetRelative = input.artifact.disposal_target.root_relative;
    if (!safeRelative(targetRelative)) throw new Error('CLEANUP_DIRECTORY_TARGET_INVALID');
    const target = this.#owned(targetRelative), manifestFile = this.#owned(this.#manifestRelative);
     if (manifestFile === target || manifestFile.startsWith(target + path.sep)) throw new Error('CLEANUP_DIRECTORY_MANIFEST_INSIDE_TARGET');
    if (target === this.#root || target.startsWith(path.join(this.#root, '.git') + path.sep)
      || target === process.cwd() || target.startsWith(process.cwd() + path.sep) || process.cwd().startsWith(target + path.sep)) throw new Error('CLEANUP_DIRECTORY_TARGET_EXCLUDED');
    const plan = input.plan;
    if (!plan?.decisions?.some(item => item.artifact_id === input.artifact.artifact_id && item.disposition === 'ELIGIBLE_NOW')) {
      throw new Error('CLEANUP_NOT_ELIGIBLE');
    }
    const inventory = this.#inventory(target);
    const retained = input.artifact.disposal_target;
    if (inventory.inventory_digest !== retained.inventory_digest
      || digestValue(inventory.inventory) !== digestValue(retained.inventory)
      || retention.targetDigest(input.artifact.expected_target_identity) !== input.plan.decisions.find(item => item.artifact_id === input.artifact.artifact_id).target_digest) {
      throw new Error('CLEANUP_DIRECTORY_INVENTORY_DRIFT');
    }
    const manifestBytes = fs.readFileSync(manifestFile), manifest = this.#read();
    if (!Buffer.from(JSON.stringify(manifest)).equals(manifestBytes)) throw new Error('CLEANUP_MANIFEST_BINDING_DRIFT');
    const core = { operation_id: input.operation_id, artifact_id: input.artifact.artifact_id,
      operation_kind: input.operation_kind, safety_class: input.safety_class, target_digest: retention.targetDigest(input.artifact.expected_target_identity),
      source_digest: input.artifact.transfer_anchor.payload_digest, inventory_digest: inventory.inventory_digest,
      root_identity: inventory.root_identity, manifest_revision: input.revision, manifest_sha256: digest(manifestBytes),
      target_relative: targetRelative, manifest_relative: this.#manifestRelative, inventory: inventory.inventory,
      candidate_digest: this.#candidateDigest, module_digest: this.#moduleDigest, native_helper_digest: this.#nativeHelperDigest };
    const proposal = freeze({ schema: 'toolkit.directory-disposal.proposal.v1', ...core,
      resources: [{ path: targetRelative, inventory_digest: inventory.inventory_digest }],
      backend_revision: input.revision, effect_digest: digestValue(core) });
    this.#proposals.add(proposal);
    return proposal;
  }
  #recoverDirectory({ artifact, disposal_target, pending_operation, operation_history = [] }) {
    const targetRecord = disposal_target || artifact?.disposal_target;
    if (!pending_operation || !safeRelative(targetRecord?.root_relative) || targetRecord.kind !== 'DIRECTORY_DISPOSAL'
      || artifact?.disposal_target?.kind !== 'DIRECTORY_DISPOSAL' || !Array.isArray(operation_history)
      || !safeId(pending_operation.operation_id)
      || retention.targetDigest(artifact.expected_target_identity) !== pending_operation.target_digest
      || targetRecord.inventory_digest !== pending_operation.inventory_digest) {
      return { state: 'HOLD', code: 'CLEANUP_DIRECTORY_PENDING_INVALID', operation_attempted: false, mutation_authority: false };
    }
    const retainedOperations = operation_history.filter(item => item?.operation_id === pending_operation.operation_id);
    if (retainedOperations.length > 1) return { state: 'HOLD', code: 'CLEANUP_DIRECTORY_PENDING_HISTORY_AMBIGUOUS', operation_attempted: false, mutation_authority: false };
    let target;
    try { target = this.#owned(targetRecord.root_relative); } catch (error) { return { state: 'HOLD', code: error.message, operation_attempted: false, mutation_authority: false }; }
    const historyDigest = digestValue(operation_history);
    if (!fs.existsSync(target)) return freeze({ state: 'UNKNOWN_ABSENCE_OBSERVED', operation_id: pending_operation.operation_id,
      operation_attempted: false, target_digest: pending_operation.target_digest, inventory_digest: pending_operation.inventory_digest,
      operation_history_digest: historyDigest, attribution: 'REQUIRES_RETAINED_NATIVE_OPERATION_AND_INDEPENDENT_RESTORE', mutation_authority: false });
    try {
      const current = this.#inventory(target);
      const exact = current.inventory_digest === pending_operation.inventory_digest
        && current.inventory_digest === targetRecord.inventory_digest
        && canonicalSerialize(current.inventory) === canonicalSerialize(targetRecord.inventory);
      return freeze({ state: exact ? 'TARGET_PRESENT' : 'PARTIAL_OR_DRIFT', operation_id: pending_operation.operation_id,
        operation_attempted: false, target_digest: pending_operation.target_digest,
        inventory_digest: current.inventory_digest, inventory: current.inventory, root_identity: current.root_identity,
        operation_history_digest: historyDigest, mutation_authority: false, requires_independent_attribution: true });
    } catch (error) { return { state: 'HOLD', code: error.message, operation_attempted: false, mutation_authority: false }; }
  }
  #executeDirectory({ proposal, accepted_action }) {
    if (!proposal || !this.#proposals.has(proposal) || proposal.schema !== 'toolkit.directory-disposal.proposal.v1'
      || !accepted_action || accepted_action.operation_id !== proposal.operation_id
      || accepted_action.operation_kind !== 'DISPOSAL_DELETE' || accepted_action.safety_class !== 'IRREVERSIBLE_DIRECTORY_DISPOSAL'
      || accepted_action.target_digest !== proposal.target_digest || accepted_action.effect_digest !== proposal.effect_digest
      || accepted_action.manifest_revision !== proposal.manifest_revision || !accepted_action.evidence_reference_digest
      || proposal.candidate_digest !== this.#candidateDigest || proposal.module_digest !== this.#moduleDigest
      || proposal.native_helper_digest !== this.#nativeHelperDigest || digest(fs.readFileSync(__filename)) !== this.#moduleDigest
      || digest(fs.readFileSync(this.#nativeHelperPath)) !== this.#nativeHelperDigest) {
      return { state: 'HOLD', code: 'CLEANUP_DIRECTORY_ACTION_APPROVAL_REQUIRED', operation_attempted: false };
    }
    const target = this.#owned(proposal.target_relative), manifestFile = this.#owned(proposal.manifest_relative);
    const manifestBytes = fs.readFileSync(manifestFile), manifest = this.#read();
    if (digest(manifestBytes) !== proposal.manifest_sha256 || !Buffer.from(JSON.stringify(manifest)).equals(manifestBytes)) {
      return { state: 'HOLD', code: 'CLEANUP_MANIFEST_BINDING_DRIFT', operation_attempted: false };
    }
    const current = this.#inventory(target);
    if (current.inventory_digest !== proposal.inventory_digest
      || digestValue(current.inventory) !== digestValue(proposal.inventory)
      || digestValue(current.root_identity) !== digestValue(proposal.root_identity)) {
      return { state: 'HOLD', code: 'CLEANUP_DIRECTORY_IDENTITY_OR_INVENTORY_DRIFT', operation_attempted: false };
    }
    let native;
    try { native = this.#accept(Object.freeze({ operation_kind: 'DISPOSAL_DELETE', target_digest: proposal.target_digest,
      effect_digest: proposal.effect_digest, inventory_digest: proposal.inventory_digest, candidate_digest: proposal.candidate_digest,
      module_digest: proposal.module_digest, native_helper_digest: proposal.native_helper_digest, proposal, accepted_action })); }
    catch (_) { native = null; }
    if (!native || typeof native !== 'object' || Array.isArray(native) || native.accepted_action_digest !== digestValue(accepted_action)
      || native.operation_kind !== 'DISPOSAL_DELETE' || native.target_digest !== proposal.target_digest
      || native.effect_digest !== proposal.effect_digest || native.candidate_digest !== proposal.candidate_digest
      || native.module_digest !== proposal.module_digest || native.native_helper_digest !== proposal.native_helper_digest
      || !/^[a-f0-9]{64}$/.test(native.evidence_reference_digest || '')) {
      return { state: 'HOLD', code: 'CLEANUP_NATIVE_PERMISSION_REQUIRED', operation_attempted: false };
    }
    if (process.platform !== 'win32' || !path.isAbsolute(this.#powershell || '')) {
      return { state: 'HOLD', code: 'CLEANUP_NATIVE_PRIMITIVE_UNAVAILABLE', operation_attempted: false };
    }
    const encoded = Buffer.from(JSON.stringify(proposal.inventory), 'utf8').toString('base64');
    const result = spawnSync(this.#powershell, ['-NoProfile', '-NonInteractive', '-File', path.resolve(__dirname, 'toolkit-recoverable-cleanup-windows.ps1'),
      '-Mode', 'DIRECTORY_DISPOSAL', '-Root', this.#root, '-Target', target, '-Quarantine', target,
      '-Manifest', manifestFile, '-ManifestSha256', proposal.manifest_sha256, '-ContentSha256', proposal.source_digest,
       '-ExpectedRootVolume', proposal.root_identity.volume_serial, '-ExpectedInode', proposal.root_identity.file_id,
       '-ExpectedRootLinks', String(proposal.root_identity.links), '-InventoryJsonBase64', encoded,
      '-CandidateDigest', proposal.candidate_digest, '-ModuleDigest', proposal.module_digest,
      '-NativeHelperDigest', proposal.native_helper_digest, '-AcceptedActionDigest', native.accepted_action_digest,
      '-ApprovalReferenceDigest', native.evidence_reference_digest],
    { shell: false, windowsHide: true, encoding: 'utf8', timeout: 30000, maxBuffer: 65536 });
    if (result.error) return freeze({ state: 'UNKNOWN', code: 'CLEANUP_DIRECTORY_OUTCOME_UNKNOWN', operation_attempted: true,
      operation_id: proposal.operation_id, operation_kind: proposal.operation_kind, target_digest: proposal.target_digest,
      effect_digest: proposal.effect_digest, candidate_digest: proposal.candidate_digest,
      module_digest: proposal.module_digest, native_helper_digest: proposal.native_helper_digest,
      attempt_evidence_digest: digestValue({ operation_id: proposal.operation_id, effect_digest: proposal.effect_digest,
        accepted_action_digest: native.accepted_action_digest, native_approval_reference_digest: native.evidence_reference_digest,
        state: 'UNKNOWN', code: result.error.code || 'SPAWN_ERROR' }), mutation_authority: false });
    let output;
    try { output = JSON.parse(result.stdout); } catch (_) { return freeze({ state: 'UNKNOWN', code: 'CLEANUP_DIRECTORY_OUTCOME_UNKNOWN',
      operation_attempted: true, operation_id: proposal.operation_id, operation_kind: proposal.operation_kind,
      target_digest: proposal.target_digest, effect_digest: proposal.effect_digest, candidate_digest: proposal.candidate_digest,
      module_digest: proposal.module_digest, native_helper_digest: proposal.native_helper_digest,
      attempt_evidence_digest: digestValue({ operation_id: proposal.operation_id, effect_digest: proposal.effect_digest,
        accepted_action_digest: native.accepted_action_digest, native_approval_reference_digest: native.evidence_reference_digest,
        stdout_sha256: digest(Buffer.from(result.stdout || '', 'utf8')), exit_code: result.status, state: 'UNKNOWN' }), mutation_authority: false }); }
    if (output.candidate_digest !== proposal.candidate_digest || output.module_digest !== proposal.module_digest
      || output.native_helper_digest !== proposal.native_helper_digest || output.accepted_action_digest !== native.accepted_action_digest
      || output.approval_reference_digest !== native.evidence_reference_digest) {
      return freeze({ state: 'UNKNOWN', code: 'CLEANUP_NATIVE_IDENTITY_READBACK_MISMATCH', operation_attempted: true,
        operation_id: proposal.operation_id, operation_kind: proposal.operation_kind, target_digest: proposal.target_digest,
        effect_digest: proposal.effect_digest, candidate_digest: proposal.candidate_digest, module_digest: proposal.module_digest,
        native_helper_digest: proposal.native_helper_digest, attempt_evidence_digest: digestValue({ operation_id: proposal.operation_id,
          effect_digest: proposal.effect_digest, native_output: output, exit_code: result.status }), mutation_authority: false });
    }
    const reference = digestValue({ proposal: proposal.effect_digest, approval: native.evidence_reference_digest, output });
    return freeze({ state: output.state === 'IRREVERSIBLE_LOCAL_DISPOSAL' ? 'APPLIED' : output.state || 'UNKNOWN',
      operation_attempted: true, operation_id: proposal.operation_id, operation_kind: 'DISPOSAL_DELETE',
      target_digest: proposal.target_digest, effect_digest: proposal.effect_digest,
      candidate_digest: proposal.candidate_digest, module_digest: proposal.module_digest, native_helper_digest: proposal.native_helper_digest,
      accepted_action_digest: native.accepted_action_digest, approval_reference_digest: native.evidence_reference_digest,
      evidence_reference_digest: reference, native_output: output, exit_code: result.status,
      irreversible_deletion: true, mutation_authority: false });
  }
  #recover(request) {
    const read = this.#read;
    const target = this.#owned(request.target_relative), saved = this.#owned(request.quarantine_relative);
    const plan = retention.planRetention(read(), { now: request.now });
    if (plan.decisions.find(item => item.artifact_id === request.artifact_id)?.disposition !== 'ELIGIBLE_NOW') return { state: 'HOLD', code: 'CLEANUP_RECOVERY_NOT_ELIGIBLE' };
    if (!fs.existsSync(target) && fs.existsSync(saved) && !fs.lstatSync(saved).isSymbolicLink()
      && fs.lstatSync(saved).isFile() && fs.lstatSync(saved).nlink === 1 && digest(fs.readFileSync(saved)) === request.content_sha256) {
      return { state: 'QUARANTINE_OBSERVED', effect_attribution: 'REQUIRES_RETAINED_NATIVE_OPERATION_RECEIPT', irreversible_deletion: false,
        source_absent: true, recoverable_bytes_verified: true };
    }
    return { state: 'HOLD', code: 'CLEANUP_EFFECT_UNRESOLVED', irreversible_deletion: false,
      source_present: fs.existsSync(target), quarantine_present: fs.existsSync(saved),
      quarantine_links: fs.existsSync(saved) ? fs.lstatSync(saved).nlink : null,
      quarantine_digest: fs.existsSync(saved) && fs.lstatSync(saved).isFile() ? digest(fs.readFileSync(saved)) : null };
  }
  #execute(raw) {
    const root = this.#root, read = this.#read, accept = this.#accept, powershell = this.#powershell;
    const request = compiler.trustedJsonCopy(raw);
    const target = this.#owned(request.target_relative), saved = this.#owned(request.quarantine_relative), manifestFile = this.#owned(request.manifest_relative);
    if (!/^[a-f0-9]{64}$/.test(request.content_sha256 || '')) throw new Error('CLEANUP_CONTENT_BINDING_REQUIRED');
    const bytes = fs.readFileSync(manifestFile), manifest = read();
    if (!Buffer.from(JSON.stringify(manifest)).equals(bytes)) return { state: 'HOLD', code: 'CLEANUP_MANIFEST_BINDING_DRIFT' };
    const view = retention.planRetention(manifest, { now: request.now });
    const item = view.decisions.find(d => d.artifact_id === request.artifact_id);
    if (!item || item.disposition !== 'ELIGIBLE_NOW') return { state: 'HOLD', code: 'CLEANUP_NOT_ELIGIBLE' };
    const artifact = manifest.artifacts.find(a => a.artifact_id === request.artifact_id);
    if (artifact?.retention_class !== 'LOCAL_TEMP' || this.#owned(artifact.expected_target_identity.path.slice(1)) !== target
      || artifact.evidence_reference.content_digest !== request.content_sha256) return { state: 'HOLD', code: 'CLEANUP_TARGET_BINDING_DRIFT' };
    const expectedInode = fs.lstatSync(target, { bigint: true }).ino.toString();
    const native = accept(Object.freeze({ artifact_id: request.artifact_id, target, quarantine: saved,
      manifest_sha256: digest(bytes), plan_digest: view.plan_digest }));
    if (native !== true) return { state: 'HOLD', code: 'CLEANUP_NATIVE_PERMISSION_REQUIRED' };
    if (process.platform !== 'win32' || !path.isAbsolute(powershell || '')) return { state: 'HOLD', code: 'CLEANUP_NATIVE_PRIMITIVE_UNAVAILABLE' };
    const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-File', path.resolve(__dirname, 'toolkit-recoverable-cleanup-windows.ps1'),
      '-Root', root, '-Target', target, '-Quarantine', saved, '-Manifest', manifestFile, '-ManifestSha256', digest(bytes),
      '-ContentSha256', request.content_sha256, '-ExpectedInode', expectedInode],
    { shell: false, windowsHide: true, encoding: 'utf8', timeout: 30000, maxBuffer: 65536 });
    if (result.error) return { state: 'HOLD', code: 'CLEANUP_NATIVE_OUTCOME_UNKNOWN', irreversible_deletion: false };
    let output; try { output = JSON.parse(result.stdout); } catch (_) { return { state: 'HOLD', code: 'CLEANUP_NATIVE_OUTCOME_UNKNOWN', irreversible_deletion: false }; }
    if (output.state !== 'RECOVERABLY_QUARANTINED') return output;
    return { ...this.#recover(request), native_operation_state: output.state, native_readback: output };
  }
}
Object.freeze(FilesystemCleanupAdapter.prototype);
function createFilesystemCleanupAdapter(options) { return new FilesystemCleanupAdapter(options); }
module.exports = Object.freeze({ createFilesystemCleanupAdapter });
