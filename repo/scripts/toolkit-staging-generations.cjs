'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const OWNER = 'ai-agent-toolkit-local-bridge';
const SCHEMA_VERSION = 1;
const RECORD_PREFIX = '.toolkit-staging-generation-';
const OWNER_MARKER = '.toolkit-staging-owner.json';
const MAX_AUDIT_ENTRIES = 200;

function recordPathFor(parent, generationId) {
  return path.join(parent, `${RECORD_PREFIX}${generationId}.json`);
}

function auxiliaryPath(recordPath, kind) {
  return recordPath.replace(/\.json$/, `.${kind}.json`);
}

function writeExclusiveJson(filePath, value) {
  const handle = fs.openSync(filePath, 'wx', 0o600);
  try {
    fs.writeFileSync(handle, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  } finally {
    fs.closeSync(handle);
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function directoryIdentity(stat) {
  return {
    dev: String(stat.dev),
    ino: String(stat.ino),
    birthtime_ms: String(stat.birthtimeMs)
  };
}

function identitiesMatch(left, right) {
  return Boolean(left && right)
    && String(left.dev) === String(right.dev)
    && String(left.ino) === String(right.ino)
    && String(left.birthtime_ms) === String(right.birthtime_ms);
}

function samePath(left, right) {
  return path.resolve(left) === path.resolve(right);
}

function isDirectChild(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative) && !relative.includes(path.sep);
}

function ordinaryDirectory(pathToCheck) {
  const stat = fs.lstatSync(pathToCheck);
  if (!stat.isDirectory() || stat.isSymbolicLink()) return { safe: false, reason: 'special-filesystem-object' };
  const real = fs.realpathSync.native(pathToCheck);
  if (!samePath(real, pathToCheck)) return { safe: false, reason: 'reparse-or-path-redirect' };
  return { safe: true, stat };
}

function cleanDiagnostic(error) {
  return String(error && error.message ? error.message : error || 'unknown error').replace(/[\r\n]+/g, ' ').slice(0, 240);
}

function pathExistsLstat(filePath) {
  try {
    fs.lstatSync(filePath);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
}

function validGenerationId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function stagingOwnerLiveness(pid, killFn = process.kill) {
  const parsed = Number(pid);
  if (!Number.isInteger(parsed) || parsed <= 0) return 'indeterminate';
  try {
    killFn(parsed, 0);
    return 'alive';
  } catch (error) {
    if (error && error.code === 'ESRCH') return 'dead';
    return 'indeterminate';
  }
}

function createOwnedStagingGeneration(options) {
  const parent = path.resolve(options.parent);
  const target = path.resolve(options.target);
  if (!samePath(path.dirname(target), parent)) throw new Error('owned staging target must be an immediate child of its expected parent');
  fs.mkdirSync(parent, { recursive: true });
  const parentCheck = ordinaryDirectory(parent);
  if (!parentCheck.safe) throw new Error(`owned staging parent is unsafe: ${parentCheck.reason}`);

  const generationId = options.generationId || crypto.randomUUID();
  const token = options.token || crypto.randomBytes(24).toString('hex');
  const stagePrefix = options.stagePrefix || '.staging-';
  const stagePath = path.join(parent, `${stagePrefix}${generationId}`);
  if (!isDirectChild(parent, stagePath)) throw new Error('owned staging path escaped its expected parent');
  const recordPath = recordPathFor(parent, generationId);
  const createdAt = options.createdAt || new Date().toISOString();
  const record = {
    owner: OWNER,
    schema_version: SCHEMA_VERSION,
    generation_id: generationId,
    ownership_token: token,
    expected_staging_path: stagePath,
    expected_parent: parent,
    expected_final_target: target,
    operation: options.operation,
    source_type: options.sourceType,
    creating_process: {
      pid: options.pid || process.pid,
      lease_token: token,
      started_at: options.processStartedAt || createdAt
    },
    created_at: createdAt,
    bridge_version: options.bridgeVersion,
    state: 'registered'
  };

  writeExclusiveJson(recordPath, record);
  let stageCreatedByThisInvocation = false;
  let createdDirectoryIdentity = null;
  try {
    if (options.afterRegistration) options.afterRegistration({ record, recordPath, stagePath });

    fs.mkdirSync(stagePath);
    stageCreatedByThisInvocation = true;
    const stageCheck = ordinaryDirectory(stagePath);
    if (!stageCheck.safe) throw new Error(`owned staging directory is unsafe: ${stageCheck.reason}`);
    createdDirectoryIdentity = directoryIdentity(stageCheck.stat);
    if (options.afterDirectoryCreated) options.afterDirectoryCreated({ record, recordPath, stagePath, directoryIdentity: createdDirectoryIdentity });
    const ready = {
      owner: OWNER,
      schema_version: SCHEMA_VERSION,
      generation_id: generationId,
      ownership_token: token,
      directory_identity: createdDirectoryIdentity,
      ready_at: new Date().toISOString(),
      state: 'ready'
    };
    writeExclusiveJson(path.join(stagePath, OWNER_MARKER), ready);
    writeExclusiveJson(auxiliaryPath(recordPath, 'ready'), ready);
    return { record, recordPath, stagePath, ready };
  } catch (error) {
    if (options.preserveOnInitializationError) throw error;
    let stageRemoved = !pathExistsLstat(stagePath);
    if (!stageRemoved) {
      try {
        const check = ordinaryDirectory(stagePath);
        if (
          stageCreatedByThisInvocation &&
          createdDirectoryIdentity &&
          check.safe &&
          identitiesMatch(createdDirectoryIdentity, directoryIdentity(check.stat)) &&
          fs.readFileSync(recordPath, 'utf8') === `${JSON.stringify(record, null, 2)}\n`
        ) {
          fs.rmSync(stagePath, { recursive: true });
          stageRemoved = true;
        }
      } catch {
        stageRemoved = false;
      }
    }
    if (stageRemoved) {
      fs.rmSync(auxiliaryPath(recordPath, 'ready'), { force: true });
      fs.rmSync(recordPath, { force: true });
    } else {
      error.stagingCleanupError = new Error(`Owned staging generation ${generationId} was preserved because initialization cleanup was indeterminate`);
      error.message = `${error.message}; ${error.stagingCleanupError.message}`;
    }
    throw error;
  }
}

function markOwnedStaging(generation, state) {
  if (!['completed', 'failed'].includes(state)) throw new Error(`unsupported owned staging state: ${state}`);
  const markerPath = auxiliaryPath(generation.recordPath, state);
  if (fs.existsSync(markerPath)) return;
  writeExclusiveJson(markerPath, {
    owner: OWNER,
    schema_version: SCHEMA_VERSION,
    generation_id: generation.record.generation_id,
    ownership_token: generation.record.ownership_token,
    state,
    recorded_at: new Date().toISOString()
  });
}

function validateRecordShape(record, recordPath, expectedParent) {
  if (!record || typeof record !== 'object') return 'record-not-an-object';
  if (record.owner !== OWNER || record.schema_version !== SCHEMA_VERSION) return 'owner-or-schema-mismatch';
  if (!/^[0-9a-f-]{36}$/i.test(String(record.generation_id || ''))) return 'invalid-generation-id';
  if (!/^[0-9a-f]{48}$/i.test(String(record.ownership_token || ''))) return 'invalid-ownership-token';
  if (record.creating_process?.lease_token !== record.ownership_token) return 'process-lease-mismatch';
  if (!Number.isInteger(Number(record.creating_process?.pid)) || Number(record.creating_process.pid) <= 0) return 'invalid-process-identity';
  if (!samePath(record.expected_parent || '', expectedParent)) return 'expected-parent-mismatch';
  if (!samePath(path.dirname(record.expected_staging_path || ''), expectedParent)) return 'staging-parent-mismatch';
  if (!samePath(path.dirname(record.expected_final_target || ''), expectedParent)) return 'target-parent-mismatch';
  if (!isDirectChild(expectedParent, record.expected_staging_path || '')) return 'staging-path-escape';
  if (!isDirectChild(expectedParent, record.expected_final_target || '')) return 'target-path-escape';
  if (!samePath(recordPathFor(expectedParent, record.generation_id), recordPath)) return 'record-path-mismatch';
  if (!['repo', 'codex-plugin', 'claude-plugin'].includes(record.source_type)) return 'source-type-mismatch';
  const expectedStageName = record.operation === 'hub-snapshot-replacement'
    ? `.staging-${record.generation_id}`
    : `.${path.basename(record.expected_final_target)}.staging-${record.generation_id}`;
  if (!['hub-snapshot-replacement', 'target-directory-copy', 'target-skill-replacement'].includes(record.operation)) return 'operation-mismatch';
  if (path.basename(record.expected_staging_path) !== expectedStageName) return 'staging-name-mismatch';
  if (!/^\d+\.\d+\.\d+$/.test(String(record.bridge_version || ''))) return 'bridge-version-mismatch';
  if (record.state !== 'registered' || !Number.isFinite(Date.parse(record.created_at || '')) || !Number.isFinite(Date.parse(record.creating_process?.started_at || ''))) return 'generation-state-or-time-mismatch';
  return '';
}

function readAuxiliary(recordPath, kind) {
  const filePath = auxiliaryPath(recordPath, kind);
  if (!fs.existsSync(filePath)) return null;
  return readJson(filePath);
}

function auxiliaryMatches(value, record, expectedState) {
  return Boolean(value)
    && value.owner === OWNER
    && value.schema_version === SCHEMA_VERSION
    && value.generation_id === record.generation_id
    && value.ownership_token === record.ownership_token
    && (!expectedState || value.state === expectedState);
}

function inspectOwnedGeneration(recordPath, options = {}) {
  const expectedParent = path.resolve(options.expectedParent || path.dirname(recordPath));
  try {
    const recordStat = fs.lstatSync(recordPath);
    if (!recordStat.isFile() || recordStat.isSymbolicLink() || !samePath(fs.realpathSync.native(recordPath), recordPath)) {
      return { classification: 'special-filesystem-object', generation_id: '', record_path: recordPath, reason: 'ownership-record-is-special', safe_to_reconcile: false };
    }
  } catch (error) {
    return { classification: 'indeterminate', generation_id: '', record_path: recordPath, reason: cleanDiagnostic(error), safe_to_reconcile: false };
  }
  let record;
  try {
    record = readJson(recordPath);
  } catch (error) {
    return { classification: 'malformed', generation_id: '', record_path: recordPath, reason: cleanDiagnostic(error), safe_to_reconcile: false };
  }
  const shapeError = validateRecordShape(record, recordPath, expectedParent);
  if (shapeError) {
    return { classification: 'ownership-mismatched', generation_id: String(record.generation_id || ''), record_path: recordPath, reason: shapeError, safe_to_reconcile: false };
  }

  let ready;
  let completed;
  let failed;
  try {
    ready = readAuxiliary(recordPath, 'ready');
    completed = readAuxiliary(recordPath, 'completed');
    failed = readAuxiliary(recordPath, 'failed');
  } catch (error) {
    return { classification: 'malformed', generation_id: record.generation_id, record_path: recordPath, staging_path: record.expected_staging_path, reason: cleanDiagnostic(error), safe_to_reconcile: false };
  }
  if ((completed && !auxiliaryMatches(completed, record, 'completed')) || (failed && !auxiliaryMatches(failed, record, 'failed'))) {
    return { classification: 'ownership-mismatched', generation_id: record.generation_id, record_path: recordPath, staging_path: record.expected_staging_path, reason: 'state-marker-mismatch', safe_to_reconcile: false };
  }

  let stageExists;
  try {
    stageExists = pathExistsLstat(record.expected_staging_path);
  } catch (error) {
    return { classification: 'indeterminate', generation_id: record.generation_id, record_path: recordPath, staging_path: record.expected_staging_path, reason: cleanDiagnostic(error), safe_to_reconcile: false };
  }
  if (stageExists) {
    if (!ready || !auxiliaryMatches(ready, record, 'ready')) {
      return {
        classification: ready ? 'ownership-mismatched' : 'indeterminate',
        generation_id: record.generation_id,
        record_path: recordPath,
        staging_path: record.expected_staging_path,
        reason: ready ? 'ready-identity-mismatched' : 'ready-identity-missing',
        safe_to_reconcile: false
      };
    }
    let stageCheck;
    let ownerMarker;
    try {
      stageCheck = ordinaryDirectory(record.expected_staging_path);
      if (!stageCheck.safe) {
        return { classification: 'special-filesystem-object', generation_id: record.generation_id, record_path: recordPath, staging_path: record.expected_staging_path, reason: stageCheck.reason, safe_to_reconcile: false };
      }
      const markerPath = path.join(record.expected_staging_path, OWNER_MARKER);
      const markerStat = fs.lstatSync(markerPath);
      if (!markerStat.isFile() || markerStat.isSymbolicLink()) throw new Error('ownership marker is not an ordinary file');
      ownerMarker = readJson(markerPath);
    } catch (error) {
      return { classification: 'indeterminate', generation_id: record.generation_id, record_path: recordPath, staging_path: record.expected_staging_path, reason: cleanDiagnostic(error), safe_to_reconcile: false };
    }
    if (!auxiliaryMatches(ownerMarker, record, 'ready') || !identitiesMatch(ready.directory_identity, directoryIdentity(stageCheck.stat)) || !identitiesMatch(ownerMarker.directory_identity, ready.directory_identity)) {
      return { classification: 'ownership-mismatched', generation_id: record.generation_id, record_path: recordPath, staging_path: record.expected_staging_path, reason: 'directory-identity-or-token-mismatch', safe_to_reconcile: false };
    }
  } else if (ready && !auxiliaryMatches(ready, record, 'ready')) {
    return { classification: 'ownership-mismatched', generation_id: record.generation_id, record_path: recordPath, staging_path: record.expected_staging_path, reason: 'ready-marker-mismatch', safe_to_reconcile: false };
  }

  if (completed && !stageExists) {
    return { classification: 'completed-awaiting-cleanup', generation_id: record.generation_id, record_path: recordPath, staging_path: record.expected_staging_path, target_path: record.expected_final_target, safe_to_reconcile: true };
  }
  const liveness = (options.liveness || stagingOwnerLiveness)(record.creating_process.pid);
  if (liveness === 'alive') {
    return { classification: 'live-owned', generation_id: record.generation_id, record_path: recordPath, staging_path: record.expected_staging_path, target_path: record.expected_final_target, safe_to_reconcile: false };
  }
  if (liveness !== 'dead') {
    return { classification: 'indeterminate', generation_id: record.generation_id, record_path: recordPath, staging_path: record.expected_staging_path, target_path: record.expected_final_target, reason: 'owner-liveness-indeterminate', safe_to_reconcile: false };
  }
  return { classification: 'dead-owned', generation_id: record.generation_id, record_path: recordPath, staging_path: record.expected_staging_path, target_path: record.expected_final_target, failed: Boolean(failed), safe_to_reconcile: true };
}

function cleanupOwnedGeneration(generation, options = {}) {
  const inspected = inspectOwnedGeneration(generation.recordPath, {
    expectedParent: generation.record.expected_parent,
    liveness: options.currentOperation ? () => 'dead' : options.liveness
  });
  if (!inspected.safe_to_reconcile) return { cleaned: false, preserved: true, reason: inspected.classification, inspection: inspected };
  const expectedRecordBytes = fs.readFileSync(generation.recordPath);
  if (options.beforeDelete) options.beforeDelete({ generation, inspection: inspected });
  if (!fs.readFileSync(generation.recordPath).equals(expectedRecordBytes)) {
    return { cleaned: false, preserved: true, reason: 'ownership-record-changed', inspection: inspected };
  }
  const rechecked = inspectOwnedGeneration(generation.recordPath, {
    expectedParent: generation.record.expected_parent,
    liveness: options.currentOperation ? () => 'dead' : options.liveness
  });
  if (!rechecked.safe_to_reconcile || rechecked.classification !== inspected.classification) {
    return { cleaned: false, preserved: true, reason: 'ownership-changed-before-delete', inspection: rechecked };
  }
  if (pathExistsLstat(generation.stagePath)) fs.rmSync(generation.stagePath, { recursive: true });
  for (const kind of ['ready', 'completed', 'failed']) fs.rmSync(auxiliaryPath(generation.recordPath, kind), { force: true });
  fs.rmSync(generation.recordPath, { force: true });
  return { cleaned: true, preserved: false, reason: '', inspection: rechecked };
}

function auditOwnedStaging(parents, options = {}) {
  const results = [];
  const seenStages = new Set();
  let truncated = false;
  for (const rawParent of [...new Set(parents.filter(Boolean).map((value) => path.resolve(value)))]) {
    let parentExists;
    try {
      parentExists = pathExistsLstat(rawParent);
    } catch (error) {
      results.push({ classification: 'indeterminate', parent: rawParent, reason: cleanDiagnostic(error), safe_to_reconcile: false });
      continue;
    }
    if (!parentExists) continue;
    try {
      const parentCheck = ordinaryDirectory(rawParent);
      if (!parentCheck.safe) {
        results.push({ classification: 'special-filesystem-object', parent: rawParent, reason: parentCheck.reason, safe_to_reconcile: false });
        continue;
      }
    } catch (error) {
      results.push({ classification: 'indeterminate', parent: rawParent, reason: cleanDiagnostic(error), safe_to_reconcile: false });
      continue;
    }
    let entries;
    try {
      entries = fs.readdirSync(rawParent, { withFileTypes: true });
    } catch (error) {
      results.push({ classification: 'indeterminate', parent: rawParent, reason: cleanDiagnostic(error), safe_to_reconcile: false });
      continue;
    }
    for (const entry of entries) {
      if (results.length >= (options.limit || MAX_AUDIT_ENTRIES)) {
        truncated = true;
        break;
      }
      if (entry.name.startsWith(RECORD_PREFIX) && entry.name.endsWith('.json') && !/\.(?:ready|completed|failed)\.json$/.test(entry.name)) {
        const inspected = inspectOwnedGeneration(path.join(rawParent, entry.name), { expectedParent: rawParent, liveness: options.liveness });
        results.push({ parent: rawParent, ...inspected });
        if (inspected.staging_path) seenStages.add(path.resolve(inspected.staging_path));
      }
    }
    if (truncated) break;
    for (const entry of entries) {
      if (results.length >= (options.limit || MAX_AUDIT_ENTRIES)) {
        truncated = true;
        break;
      }
      if (!entry.name.startsWith('.staging-') && !/^\..+\.staging-/.test(entry.name)) continue;
      const fullPath = path.join(rawParent, entry.name);
      if (seenStages.has(path.resolve(fullPath))) continue;
      let classification = entry.name.startsWith('.staging-') ? 'historical-unmarked' : 'unrelated-matching';
      try {
        const stat = fs.lstatSync(fullPath);
        if (!stat.isDirectory() || stat.isSymbolicLink() || !samePath(fs.realpathSync.native(fullPath), fullPath)) classification = 'special-filesystem-object';
      } catch {
        classification = 'indeterminate';
      }
      results.push({ classification, parent: rawParent, staging_path: fullPath, safe_to_reconcile: false });
    }
    if (truncated) break;
  }
  const counts = {};
  for (const result of results) counts[result.classification] = (counts[result.classification] || 0) + 1;
  return { schema_version: SCHEMA_VERSION, entries: results, counts, truncated };
}

function lookupExactOwnedGeneration(parents, generationId, options = {}) {
  if (!validGenerationId(generationId)) {
    return { complete: false, reason: 'invalid-generation-id', candidates: [], checked_parents: [] };
  }
  const approvedParents = [...new Set(parents.filter(Boolean).map((value) => path.resolve(value)))];
  if (!approvedParents.length) {
    return { complete: false, reason: 'no-approved-parents', candidates: [], checked_parents: [] };
  }
  const candidates = [];
  const checkedParents = [];
  for (const parent of approvedParents) {
    let parentExists;
    try {
      parentExists = pathExistsLstat(parent);
    } catch (error) {
      return { complete: false, reason: 'approved-parent-indeterminate', detail: cleanDiagnostic(error), candidates, checked_parents: checkedParents };
    }
    if (!parentExists) {
      checkedParents.push(parent);
      continue;
    }
    try {
      const parentCheck = ordinaryDirectory(parent);
      if (!parentCheck.safe) {
        return { complete: false, reason: 'approved-parent-special', detail: parentCheck.reason, candidates, checked_parents: checkedParents };
      }
    } catch (error) {
      return { complete: false, reason: 'approved-parent-indeterminate', detail: cleanDiagnostic(error), candidates, checked_parents: checkedParents };
    }
    const exactRecordPath = recordPathFor(parent, generationId);
    let recordExists;
    try {
      recordExists = pathExistsLstat(exactRecordPath);
    } catch (error) {
      return { complete: false, reason: 'exact-record-indeterminate', detail: cleanDiagnostic(error), candidates, checked_parents: checkedParents };
    }
    checkedParents.push(parent);
    if (!recordExists) continue;
    candidates.push(inspectOwnedGeneration(exactRecordPath, { expectedParent: parent, liveness: options.liveness }));
  }
  return { complete: true, reason: '', candidates, checked_parents: checkedParents };
}

function reconcileOwnedStaging(parents, generationId, options = {}) {
  let exact = lookupExactOwnedGeneration(parents, generationId, options);
  const audit = auditOwnedStaging(parents, { ...options, limit: options.auditLimit || options.limit });
  if (options.afterSupplementalAudit) options.afterSupplementalAudit({ audit, exact });
  if (!exact.complete) return { reconciled: false, reason: exact.reason, exact_lookup: exact, audit };
  if (exact.candidates.length !== 1) {
    return {
      reconciled: false,
      reason: exact.candidates.length ? 'generation-id-ambiguous' : 'generation-id-not-found',
      exact_lookup: exact,
      audit
    };
  }
  let match = exact.candidates[0];
  if (!match.safe_to_reconcile) return { reconciled: false, reason: `generation-not-safe:${match.classification}`, generation: match, audit };
  if (!options.write) return { reconciled: false, dry_run: true, would_reconcile: true, generation: match, audit };
  exact = lookupExactOwnedGeneration(parents, generationId, options);
  if (!exact.complete) return { reconciled: false, reason: exact.reason, exact_lookup: exact, audit };
  if (exact.candidates.length !== 1) {
    return {
      reconciled: false,
      reason: exact.candidates.length ? 'generation-id-ambiguous' : 'exact-record-changed',
      exact_lookup: exact,
      audit
    };
  }
  match = exact.candidates[0];
  if (!match.safe_to_reconcile) return { reconciled: false, reason: `generation-not-safe:${match.classification}`, generation: match, exact_lookup: exact, audit };
  let record;
  try {
    record = readJson(match.record_path);
  } catch (error) {
    return { reconciled: false, reason: 'exact-record-changed', detail: cleanDiagnostic(error), generation: match, audit };
  }
  const generation = { record, recordPath: match.record_path, stagePath: record.expected_staging_path };
  const cleanup = cleanupOwnedGeneration(generation, { liveness: options.liveness, beforeDelete: options.beforeDelete });
  return { reconciled: cleanup.cleaned, reason: cleanup.reason, generation: cleanup.inspection || match, audit };
}

module.exports = {
  OWNER,
  OWNER_MARKER,
  RECORD_PREFIX,
  SCHEMA_VERSION,
  auditOwnedStaging,
  cleanupOwnedGeneration,
  createOwnedStagingGeneration,
  inspectOwnedGeneration,
  lookupExactOwnedGeneration,
  markOwnedStaging,
  reconcileOwnedStaging,
  stagingOwnerLiveness
};
