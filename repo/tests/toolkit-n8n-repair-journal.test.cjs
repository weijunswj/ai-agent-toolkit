'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const journal = require('../scripts/toolkit-n8n-repair-journal.cjs');

const GENERATION = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'a'.repeat(48);
const TARGET_ID = 'b'.repeat(64);
const PREVIOUS = '0'.repeat(64);

function temporaryRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-n8n-journal-'));
}

function fixture(root, generationId = GENERATION) {
  const codexHome = path.join(root, 'codex-home');
  const targetPath = path.join(
    codexHome,
    'plugins',
    'cache',
    'n8n-io',
    'n8n-skills',
    '1.0.1'
  );
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.mkdirSync(targetPath, { recursive: true });
  return { codexHome, generationId, targetPath };
}

function bind(fixtureValue, write = true) {
  return journal.bindJournalAuthority({
    codexHome: fixtureValue.codexHome,
    generationId: fixtureValue.generationId,
    ownershipToken: TOKEN,
    targetPath: fixtureValue.targetPath,
    write
  });
}

function append(authority, kind, payload = {}, testHooks = {}) {
  return journal.appendN8nRepairJournalRecord(authority, kind, payload, { testHooks });
}

function migrated(authority) {
  return append(authority, 'M00_V1_MIGRATION', {
    generation_record: {
      evidence_bytes_sha256: 'c'.repeat(64),
      evidence_semantic_sha256: 'd'.repeat(64)
    },
    v1_authority_digest_at_migration: 'e'.repeat(64)
  });
}

test('schema-2 frame rejects every torn byte boundary and accepts only the exact commit trailer', () => {
  const encoded = journal.encodeFrame({
    attempt: 0,
    family: 1,
    generationId: GENERATION,
    kind: 'M00_V1_MIGRATION',
    ownershipToken: TOKEN,
    payload: { boundary: 'all-bytes', nested: { stable: true } },
    previousDigest: PREVIOUS,
    targetId: TARGET_ID
  });
  for (let cut = 0; cut < encoded.bytes.length; cut += 1) {
    const decoded = journal.decodeFrame(encoded.bytes.subarray(0, cut));
    assert.equal(decoded.classification, 'incomplete', `cut ${cut}`);
    assert.equal(decoded.size, cut, `cut ${cut}`);
  }
  const complete = journal.decodeFrame(encoded.bytes);
  assert.equal(complete.classification, 'complete');
  assert.equal(complete.kind, 'M00_V1_MIGRATION');
  assert.equal(complete.complete_digest, encoded.complete_digest);
});

test('schema-2 frame treats complete-length header, payload, digest, and trailer changes as corruption', () => {
  const encoded = journal.encodeFrame({
    attempt: 0,
    family: 1,
    generationId: GENERATION,
    kind: 'M00_V1_MIGRATION',
    ownershipToken: TOKEN,
    payload: { exact: 'bytes' },
    previousDigest: PREVIOUS,
    targetId: TARGET_ID
  });
  for (const offset of [0, 16, 20, 28, 88, 120, 152, 184, 256, encoded.bytes.length - 96, encoded.bytes.length - 48, encoded.bytes.length - 1]) {
    const changed = Buffer.from(encoded.bytes);
    changed[offset] ^= 1;
    assert.throws(() => journal.decodeFrame(changed), { code: 'journal-corrupt' }, `offset ${offset}`);
  }
  assert.throws(
    () => journal.decodeFrame(Buffer.concat([encoded.bytes, Buffer.from([0])])),
    { code: 'journal-corrupt' }
  );
});

test('one primary plus eight rescue attempts are exact and the tenth attempt is forbidden', () => {
  const root = temporaryRoot();
  try {
    const value = fixture(root);
    for (let attempt = 0; attempt <= journal.JOURNAL_MAX_RESCUE_ATTEMPTS; attempt += 1) {
      const authority = bind(value, true);
      assert.throws(
        () => append(authority, 'M00_V1_MIGRATION', { attempt }, {
          n8nJournalWriteByteLimit({ size }) {
            return size - 1;
          }
        }),
        { code: 'journal-incomplete-tail' },
        `attempt ${attempt}`
      );
    }
    const exhausted = bind(value, false);
    assert.equal(exhausted.status, 'rescue-exhausted');
    assert.equal(exhausted.pending.attempts.length, 9);
    assert.throws(
      () => append(exhausted, 'M00_V1_MIGRATION', { attempt: 9 }),
      { code: 'journal-rescue-exhausted' }
    );
    assert.equal(fs.readdirSync(exhausted.paths.segments).length, 9);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('TAIL_SEAL binds every incomplete raw predecessor and continues without rewriting it', () => {
  const root = temporaryRoot();
  try {
    const value = fixture(root);
    let authority = bind(value, true);
    assert.throws(
      () => append(authority, 'M00_V1_MIGRATION', { durable: true }, {
        n8nJournalWriteByteLimit({ size }) {
          return journal.JOURNAL_HEADER_BYTES + Math.floor((size - journal.JOURNAL_HEADER_BYTES) / 2);
        }
      }),
      { code: 'journal-incomplete-tail' }
    );
    authority = bind(value, true);
    const tornPath = authority.pending.attempts[0].file.normalized_path;
    const tornBytes = fs.readFileSync(tornPath);
    authority = append(authority, 'M00_V1_MIGRATION', { durable: true });
    assert.equal(authority.records.length, 1);
    assert.equal(authority.records[0].frame_kind, 'TAIL_SEAL');
    assert.equal(authority.records[0].attempt, 1);
    assert.equal(fs.readFileSync(tornPath).equals(tornBytes), true);
    const accepted = journal.decodeFrame(fs.readFileSync(authority.records[0].segment_path));
    assert.deepEqual(accepted.payload.sealed_tails, [{
      attempt: 0,
      name: path.basename(tornPath),
      raw_sha256: journal.sha256(tornBytes),
      size: tornBytes.length
    }]);
    assert.equal(accepted.payload.continued_kind, 'M00_V1_MIGRATION');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an incomplete family is accepted only at the physical end and later bytes are never interpreted', () => {
  const root = temporaryRoot();
  try {
    const value = fixture(root);
    let authority = migrated(bind(value, true));
    assert.throws(
      () => append(authority, 'P00_PREPARED', { evidence_kind: 'n8n-pre-transaction' }, {
        n8nJournalWriteByteLimit() {
          return 24;
        }
      }),
      { code: 'journal-incomplete-tail' }
    );
    authority = bind(value, false);
    const later = journal.encodeFrame({
      attempt: 0,
      family: 3,
      generationId: GENERATION,
      kind: 'P10_COPIED',
      ownershipToken: TOKEN,
      payload: { hostile: true },
      previousDigest: authority.previous_digest,
      targetId: authority.paths.target_id
    });
    fs.writeFileSync(path.join(authority.paths.segments, 'r-0000000000000003-a0.jseg'), later.bytes, { flag: 'wx' });
    assert.throws(() => bind(value, false), { code: 'journal-corrupt' });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('state transitions cannot skip phase 40 or let cleanup substitute for installed authority', () => {
  const root = temporaryRoot();
  try {
    const value = fixture(root);
    let authority = migrated(bind(value, true));
    authority = append(authority, 'P00_PREPARED', { evidence_kind: 'n8n-pre-transaction' });
    authority = append(authority, 'P10_COPIED', { evidence_kind: 'n8n-pre-transaction-phase-10-copied' });
    authority = append(authority, 'P15_TRANSFORMING', { evidence_kind: 'n8n-pre-transaction-phase-15-transforming' });
    authority = append(authority, 'P20_TRANSFORMED', { evidence_kind: 'n8n-pre-transaction-phase-20-transformed' });
    authority = append(authority, 'T00_REGISTERED', { evidence_kind: 'n8n-replacement' });
    authority = append(authority, 'T10_DISPLACE_INTENT', { evidence_kind: 'n8n-replacement-phase-10-displace' });
    authority = append(authority, 'T20_DISPLACED', { evidence_kind: 'n8n-replacement-phase-20-displaced' });
    authority = append(authority, 'T30_INSTALL_INTENT', { evidence_kind: 'n8n-replacement-phase-30-install' });
    assert.throws(
      () => append(authority, 'T50_VERIFY_INTENT', { evidence_kind: 'n8n-replacement-phase-50-verify' }),
      { code: 'journal-state-invalid' }
    );
    assert.throws(
      () => append(authority, 'T70_CLEANUP_AUTHORIZED', { evidence_kind: 'n8n-replacement-phase-70-cleanup' }),
      { code: 'journal-state-invalid' }
    );
    authority = append(authority, 'T40_INSTALLED', { evidence_kind: 'n8n-replacement-phase-40-installed' });
    authority = append(authority, 'T50_VERIFY_INTENT', { evidence_kind: 'n8n-replacement-phase-50-verify' });
    assert.equal(authority.state, 'T50_VERIFY_INTENT');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('durable append uses exclusive creation and stale concurrent authority cannot append', () => {
  const root = temporaryRoot();
  try {
    const value = fixture(root);
    const first = bind(value, true);
    const second = bind(value, false);
    const accepted = migrated(first);
    assert.equal(accepted.state, 'M00_V1_MIGRATION');
    assert.throws(
      () => migrated(second),
      { code: 'journal-drift' }
    );
    assert.equal(fs.readdirSync(accepted.paths.segments).length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('same-path segment replacement is detected by complete journal authority revalidation', () => {
  const root = temporaryRoot();
  try {
    const value = fixture(root);
    const authority = migrated(bind(value, true));
    const segmentPath = authority.records[0].segment_path;
    const bytes = fs.readFileSync(segmentPath);
    fs.rmSync(segmentPath);
    fs.writeFileSync(segmentPath, bytes, { flag: 'wx' });
    assert.throws(
      () => journal.assertJournalAuthorityUnchanged(authority),
      { code: 'journal-drift' }
    );
    assert.equal(fs.readFileSync(segmentPath).equals(bytes), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('logical retirement is terminal truth while exact physical residue remains visible', () => {
  const root = temporaryRoot();
  try {
    const value = fixture(root);
    const residuePath = path.join(root, 'v1-evidence.json');
    fs.writeFileSync(residuePath, '{"exact":true}\n');
    const residueStat = fs.statSync(residuePath, { bigint: true });
    let authority = migrated(bind(value, true));
    authority = append(authority, 'P00_PREPARED', { evidence_kind: 'n8n-pre-transaction' });
    const manifest = journal.residueManifest([{
      bytes_sha256: journal.sha256(fs.readFileSync(residuePath)),
      evidence_kind: 'v1-generation-record',
      filesystem_identity: {
        dev: String(residueStat.dev),
        ino: String(residueStat.ino),
        mode: String(residueStat.mode),
        nlink: String(residueStat.nlink),
        size: String(residueStat.size),
        birthtime_ns: String(residueStat.birthtimeNs),
        mtime_ns: String(residueStat.mtimeNs),
        ctime_ns: String(residueStat.ctimeNs)
      },
      maximum_bytes: 1024,
      normalized_path: residuePath,
      present: true
    }]);
    authority = journal.appendLogicalRetirement(authority, manifest, {
      outcome: 'winner-committed'
    });
    assert.equal(authority.state, 'L20_LOGICALLY_RETIRED');
    assert.equal(authority.status, 'logically-retired');
    assert.equal(fs.existsSync(residuePath), true);
    journal.revalidateLogicalRetirement(authority);
    fs.appendFileSync(residuePath, ' ');
    assert.throws(
      () => journal.revalidateLogicalRetirement(authority),
      { code: 'journal-retired-residue-drift' }
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('alternating checkpoints preserve cumulative terminal roots with at most two exact slots', () => {
  const root = temporaryRoot();
  try {
    let previousRoot = '';
    let targetPath = '';
    for (let index = 1; index <= 4; index += 1) {
      const generationId = `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`;
      const value = fixture(root, generationId);
      targetPath = value.targetPath;
      let authority = migrated(bind(value, true));
      authority = append(authority, 'P00_PREPARED', { evidence_kind: 'n8n-pre-transaction' });
      authority = journal.appendLogicalRetirement(authority, journal.residueManifest([]));
      const checkpoint = journal.writeTerminalCheckpoint(authority);
      assert.notEqual(checkpoint.cumulative_terminal_root, previousRoot);
      previousRoot = checkpoint.cumulative_terminal_root;
      const names = fs.readdirSync(authority.paths.checkpoints)
        .filter((name) => /^checkpoint-[ab]-/.test(name));
      assert.ok(names.length <= 2);
    }
    assert.equal(journal.targetIdFor(targetPath).length, 64);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('checkpoint activation and superseded-retirement crash prefixes resume without a third authority', () => {
  const root = temporaryRoot();
  try {
    const authorities = [];
    for (let index = 1; index <= 4; index += 1) {
      const generationId = `22222222-2222-4222-8222-${String(index).padStart(12, '0')}`;
      const value = fixture(root, generationId);
      let authority = migrated(bind(value, true));
      authority = append(authority, 'P00_PREPARED', { evidence_kind: 'n8n-pre-transaction' });
      authorities.push(journal.appendLogicalRetirement(authority, journal.residueManifest([])));
    }
    journal.writeTerminalCheckpoint(authorities[0]);
    journal.writeTerminalCheckpoint(authorities[1]);
    assert.throws(
      () => journal.writeTerminalCheckpoint(authorities[2], {
        testHooks: {
          afterN8nCheckpointPublished() {
            const error = new Error('synthetic stop after checkpoint publication');
            error.code = 'SYNTHETIC_STOP';
            throw error;
          }
        }
      }),
      { code: 'SYNTHETIC_STOP' }
    );
    assert.equal(
      fs.readdirSync(authorities[2].paths.checkpoints)
        .filter((name) => /^checkpoint-[ab]-/.test(name)).length,
      3
    );
    const resumedPublished = journal.writeTerminalCheckpoint(authorities[2]);
    assert.equal(resumedPublished.epoch, 3);
    assert.equal(fs.readdirSync(authorities[2].paths.checkpoints).length, 2);

    assert.throws(
      () => journal.writeTerminalCheckpoint(authorities[3], {
        testHooks: {
          afterN8nCheckpointRetirementMove() {
            const error = new Error('synthetic stop after checkpoint retirement move');
            error.code = 'SYNTHETIC_STOP';
            throw error;
          }
        }
      }),
      { code: 'SYNTHETIC_STOP' }
    );
    const interruptedNames = fs.readdirSync(authorities[3].paths.checkpoints);
    assert.equal(
      interruptedNames.filter((name) => /^checkpoint-[ab]-/.test(name)).length,
      2
    );
    assert.equal(
      interruptedNames.filter((name) => /^retired-checkpoint-/.test(name)).length,
      1
    );
    const resumedMoved = journal.writeTerminalCheckpoint(authorities[3]);
    assert.equal(resumedMoved.epoch, 4);
    assert.equal(fs.readdirSync(authorities[3].paths.checkpoints).length, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('changed checkpoint retirement residue fails closed and is never deleted', () => {
  const root = temporaryRoot();
  try {
    const authorities = [];
    for (let index = 1; index <= 3; index += 1) {
      const generationId = `33333333-3333-4333-8333-${String(index).padStart(12, '0')}`;
      const value = fixture(root, generationId);
      let authority = migrated(bind(value, true));
      authority = append(authority, 'P00_PREPARED', { evidence_kind: 'n8n-pre-transaction' });
      authorities.push(journal.appendLogicalRetirement(authority, journal.residueManifest([])));
    }
    journal.writeTerminalCheckpoint(authorities[0]);
    journal.writeTerminalCheckpoint(authorities[1]);
    assert.throws(
      () => journal.writeTerminalCheckpoint(authorities[2], {
        testHooks: {
          afterN8nCheckpointRetirementMove() {
            const error = new Error('synthetic stop');
            error.code = 'SYNTHETIC_STOP';
            throw error;
          }
        }
      }),
      { code: 'SYNTHETIC_STOP' }
    );
    const residueName = fs.readdirSync(authorities[2].paths.checkpoints)
      .find((name) => /^retired-checkpoint-/.test(name));
    const residuePath = path.join(authorities[2].paths.checkpoints, residueName);
    fs.appendFileSync(residuePath, 'changed');
    const changed = fs.readFileSync(residuePath);
    assert.throws(
      () => journal.writeTerminalCheckpoint(authorities[2]),
      { code: 'journal-checkpoint-corrupt' }
    );
    assert.deepEqual(fs.readFileSync(residuePath), changed);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('checkpointed terminal transaction compaction resumes after move and partial deletion', () => {
  const root = temporaryRoot();
  try {
    const firstValue = fixture(root, '44444444-4444-4444-8444-444444444441');
    let first = migrated(bind(firstValue, true));
    first = append(first, 'P00_PREPARED', { evidence_kind: 'n8n-pre-transaction' });
    first = journal.appendLogicalRetirement(first, journal.residueManifest([]));
    journal.writeTerminalCheckpoint(first);
    first = append(first, 'C10_CLEANUP_PENDING', { residue_manifest_digest: journal.residueManifest([]).digest });
    first = append(first, 'C20_CLEANUP_COMPLETE', { residue_manifest_digest: journal.residueManifest([]).digest });
    journal.writeTerminalCheckpoint(first);

    const secondValue = fixture(root, '44444444-4444-4444-8444-444444444442');
    let second = migrated(bind(secondValue, true));
    second = append(second, 'P00_PREPARED', { evidence_kind: 'n8n-pre-transaction' });
    second = journal.appendLogicalRetirement(second, journal.residueManifest([]));
    journal.writeTerminalCheckpoint(second);
    second = append(second, 'C10_CLEANUP_PENDING', { residue_manifest_digest: journal.residueManifest([]).digest });
    second = append(second, 'C20_CLEANUP_COMPLETE', { residue_manifest_digest: journal.residueManifest([]).digest });
    const checkpoint = journal.writeTerminalCheckpoint(second);

    let interrupted = false;
    assert.throws(
      () => journal.compactSupersededTransaction(second, checkpoint, {
        testHooks: {
          afterN8nTransactionCompactionDelete() {
            if (interrupted) return;
            interrupted = true;
            const error = new Error('synthetic stop after one compacted segment');
            error.code = 'SYNTHETIC_STOP';
            throw error;
          }
        }
      }),
      { code: 'SYNTHETIC_STOP' }
    );
    assert.equal(interrupted, true);
    assert.equal(fs.existsSync(first.paths.transaction), false);
    assert.ok(
      fs.readdirSync(first.paths.transactions)
        .some((name) => name.startsWith(`retired-transaction-${first.generation_id}-by-`))
    );
    const resumed = journal.compactSupersededTransaction(second, checkpoint);
    assert.equal(resumed.compacted, true);
    assert.equal(
      fs.readdirSync(first.paths.transactions)
        .some((name) => name.includes(first.generation_id)),
      false
    );
    assert.equal(fs.existsSync(second.paths.transaction), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('checkpoint compaction never removes superseded authority before exact C20 cleanup completion', () => {
  const root = temporaryRoot();
  const firstFixture = fixture(root, '22222222-2222-4222-8222-222222222222');
  let first = bind(firstFixture);
  first = append(first, 'M00_V1_MIGRATION', { ownership_token: first.ownership_token });
  first = append(first, 'P00_PREPARED');
  first = append(first, 'B80_BUSINESS_COMMITTED');
  first = append(first, 'L10_RETIRE_INTENT');
  first = append(first, 'L20_LOGICALLY_RETIRED', {
    residue_manifest: journal.residueManifest([]),
    terminal_root: 'retained'
  });
  journal.writeTerminalCheckpoint(first);
  first = append(first, 'C10_CLEANUP_PENDING', {
    residue_manifest_digest: journal.residueManifest([]).digest
  });
  journal.writeTerminalCheckpoint(first);

  const secondFixture = {
    ...firstFixture,
    generationId: '33333333-3333-4333-8333-333333333333'
  };
  let second = bind(secondFixture);
  second = append(second, 'M00_V1_MIGRATION', { ownership_token: second.ownership_token });
  second = append(second, 'P00_PREPARED');
  second = append(second, 'B80_BUSINESS_COMMITTED');
  second = append(second, 'L10_RETIRE_INTENT');
  second = append(second, 'L20_LOGICALLY_RETIRED', {
    residue_manifest: journal.residueManifest([]),
    terminal_root: 'second'
  });
  second = append(second, 'C10_CLEANUP_PENDING', {
    residue_manifest_digest: journal.residueManifest([]).digest
  });
  second = append(second, 'C20_CLEANUP_COMPLETE', {
    residue_manifest_digest: journal.residueManifest([]).digest
  });
  const checkpoint = journal.writeTerminalCheckpoint(second);
  const firstTransaction = first.paths.transaction;
  const result = journal.compactSupersededTransaction(second, checkpoint);
  assert.deepEqual(result, { compacted: false, reason: 'cleanup-incomplete' });
  assert.equal(fs.statSync(firstTransaction).isDirectory(), true);
});

test('locked limits and stable target-scoped placement are explicit and non-regressing', () => {
  assert.equal(journal.JOURNAL_MAX_RESCUE_ATTEMPTS, 8);
  assert.equal(journal.JOURNAL_MAX_ACTIVE_SEGMENTS, 128);
  assert.equal(journal.JOURNAL_MAX_ACTIVE_BYTES, 64 * 1024 * 1024);
  assert.equal(journal.JOURNAL_SOFT_RESIDUE_ENTRIES, 512);
  assert.equal(journal.JOURNAL_SOFT_RESIDUE_BYTES, 512 * 1024 * 1024);
  assert.equal(journal.JOURNAL_HARD_RESIDUE_ENTRIES, 2048);
  assert.equal(journal.JOURNAL_HARD_RESIDUE_BYTES, 1024 * 1024 * 1024);
  assert.equal(journal.JOURNAL_MAX_TARGET_ENTRIES, 2200);
  assert.equal(journal.JOURNAL_MAX_TARGET_BYTES, 1024 * 1024 * 1024);
  assert.equal(journal.JOURNAL_MAX_TERMINAL_ENTRIES, 16);
  assert.equal(journal.JOURNAL_MAX_TERMINAL_BYTES, 4 * 1024 * 1024);
  assert.deepEqual(journal.JOURNAL_SUPPORTED_NODE_MAJORS, [22, 24]);
  const root = temporaryRoot();
  try {
    const value = fixture(root);
    const paths = journal.journalPaths(value.codexHome, value.targetPath, value.generationId);
    assert.equal(
      paths.target,
      path.join(
        value.codexHome,
        '.ai-agent-toolkit-n8n-repair',
        'v2',
        'targets',
        journal.targetIdFor(value.targetPath)
      )
    );
    assert.equal(paths.target.startsWith(value.targetPath), false);
    assert.equal(value.targetPath.startsWith(paths.target), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('target journal soft and hard entry and byte boundaries are exact', () => {
  const entryRoot = temporaryRoot();
  try {
    const value = fixture(entryRoot);
    const authority = bind(value, true);
    const limitRoot = path.join(authority.paths.target, 'limit-fixtures');
    fs.mkdirSync(limitRoot);
    for (let index = 0; index < journal.JOURNAL_SOFT_RESIDUE_ENTRIES; index += 1) {
      fs.writeFileSync(path.join(limitRoot, `entry-${String(index).padStart(4, '0')}`), '');
    }
    let usage = journal.targetJournalUsage(authority.paths);
    assert.equal(usage.soft_limit, true);
    assert.equal(usage.hard_limit, false);
    for (
      let index = journal.JOURNAL_SOFT_RESIDUE_ENTRIES;
      index < journal.JOURNAL_HARD_RESIDUE_ENTRIES;
      index += 1
    ) {
      fs.writeFileSync(path.join(limitRoot, `entry-${String(index).padStart(4, '0')}`), '');
    }
    usage = journal.targetJournalUsage(authority.paths);
    assert.equal(usage.hard_limit, true);
    for (
      let index = journal.JOURNAL_HARD_RESIDUE_ENTRIES;
      index <= journal.JOURNAL_MAX_TARGET_ENTRIES;
      index += 1
    ) {
      fs.writeFileSync(path.join(limitRoot, `entry-${String(index).padStart(4, '0')}`), '');
    }
    assert.throws(
      () => journal.targetJournalUsage(authority.paths),
      { code: 'journal-hard-limit' }
    );
  } finally {
    fs.rmSync(entryRoot, { recursive: true, force: true });
  }

  const byteRoot = temporaryRoot();
  try {
    const value = fixture(byteRoot);
    const authority = bind(value, true);
    const sparse = path.join(authority.paths.target, 'bounded-sparse-residue');
    fs.writeFileSync(sparse, '');
    fs.truncateSync(sparse, journal.JOURNAL_SOFT_RESIDUE_BYTES);
    let usage = journal.targetJournalUsage(authority.paths);
    assert.equal(usage.soft_limit, true);
    assert.equal(usage.hard_limit, false);
    fs.truncateSync(sparse, journal.JOURNAL_HARD_RESIDUE_BYTES);
    usage = journal.targetJournalUsage(authority.paths);
    assert.equal(usage.hard_limit, true);
    fs.truncateSync(sparse, journal.JOURNAL_MAX_TARGET_BYTES + 1);
    assert.throws(
      () => journal.targetJournalUsage(authority.paths),
      { code: 'journal-hard-limit' }
    );
  } finally {
    fs.rmSync(byteRoot, { recursive: true, force: true });
  }
});

test('target journal inventory rejects a child that appears during final name-set revalidation', () => {
  const root = temporaryRoot();
  const value = fixture(root);
  const authority = bind(value, true);
  const originalReaddirSync = fs.readdirSync;
  let targetReads = 0;
  try {
    fs.readdirSync = function readdirWithDrift(directoryPath, ...args) {
      if (path.resolve(directoryPath) === path.resolve(authority.paths.target)) {
        targetReads += 1;
        if (targetReads === 2) {
          fs.writeFileSync(path.join(authority.paths.target, 'appeared-during-inventory'), '');
        }
      }
      return originalReaddirSync.call(fs, directoryPath, ...args);
    };
    assert.throws(
      () => journal.targetJournalUsage(authority.paths),
      { code: 'journal-topology-invalid' }
    );
    assert.equal(targetReads, 2);
  } finally {
    fs.readdirSync = originalReaddirSync;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
