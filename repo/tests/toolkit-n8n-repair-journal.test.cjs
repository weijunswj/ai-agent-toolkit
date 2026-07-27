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

function bind(fixtureValue, write = true, testHooks) {
  return journal.bindJournalAuthority({
    codexHome: fixtureValue.codexHome,
    generationId: fixtureValue.generationId,
    ownershipToken: TOKEN,
    targetPath: fixtureValue.targetPath,
    testHooks,
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
    ownership_token: TOKEN,
    v1_authority_digest_at_migration: 'e'.repeat(64)
  });
}

function completeForCheckpoint(value) {
  let authority = migrated(bind(value, true));
  authority = append(authority, 'P00_PREPARED', { evidence_kind: 'n8n-pre-transaction' });
  authority = journal.appendLogicalRetirement(authority, journal.residueManifest([]));
  return authority;
}

function checkpointNames(authority) {
  return fs.readdirSync(authority.paths.checkpoints)
    .filter((name) => /^checkpoint-[ab]-[0-9]{16}\.jseg$/.test(name))
    .sort();
}

function rewriteCheckpoint(authority, name, modify) {
  const checkpointPath = path.join(authority.paths.checkpoints, name);
  const decoded = journal.decodeFrame(fs.readFileSync(checkpointPath));
  const frame = {
    attempt: 0,
    family: decoded.family,
    generationId: decoded.payload.generation_id,
    kind: 'K10_CHECKPOINT_ACTIVE',
    ownershipToken: authority.ownership_token,
    payload: { ...decoded.payload },
    previousDigest: decoded.previous_digest,
    targetId: decoded.target_id
  };
  modify(frame, decoded);
  const replacement = journal.encodeFrame(frame);
  fs.rmSync(checkpointPath);
  fs.writeFileSync(checkpointPath, replacement.bytes, { flag: 'wx' });
  return replacement;
}

function completedCompactionPair(root) {
  const firstValue = fixture(root, '44444444-4444-4444-8444-444444444441');
  let first = completeForCheckpoint(firstValue);
  journal.writeTerminalCheckpoint(first);
  first = append(first, 'C10_CLEANUP_PENDING', {
    residue_manifest_digest: journal.residueManifest([]).digest
  });
  first = append(first, 'C20_CLEANUP_COMPLETE', {
    residue_manifest_digest: journal.residueManifest([]).digest
  });
  journal.writeTerminalCheckpoint(first);

  const secondValue = fixture(root, '44444444-4444-4444-8444-444444444442');
  let second = completeForCheckpoint(secondValue);
  journal.writeTerminalCheckpoint(second);
  second = append(second, 'C10_CLEANUP_PENDING', {
    residue_manifest_digest: journal.residueManifest([]).digest
  });
  second = append(second, 'C20_CLEANUP_COMPLETE', {
    residue_manifest_digest: journal.residueManifest([]).digest
  });
  const checkpoint = journal.writeTerminalCheckpoint(second);
  return { checkpoint, first, second };
}

function interruptCompactionAfterSegments(root) {
  const pair = completedCompactionPair(root);
  assert.throws(
    () => journal.compactSupersededTransaction(pair.second, pair.checkpoint, {
      testHooks: {
        afterN8nTransactionCompactionSegmentsRemoved() {
          const error = new Error('synthetic stop after segments directory removal');
          error.code = 'SYNTHETIC_STOP';
          throw error;
        }
      }
    }),
    { code: 'SYNTHETIC_STOP' }
  );
  const quarantineName = fs.readdirSync(pair.second.paths.transactions)
    .find((name) => name.startsWith(
      `retired-transaction-${pair.first.generation_id}-by-`
    ));
  const quarantinePath = path.join(pair.second.paths.transactions, quarantineName);
  assert.deepEqual(fs.readdirSync(quarantinePath), []);
  return { ...pair, quarantineName, quarantinePath };
}

test('write admission re-fsyncs every pre-existing journal level after each mkdir crash prefix', () => {
  const labels = [
    'base',
    'v2',
    'targets',
    'target',
    'transactions',
    'checkpoints',
    'transaction',
    'segments'
  ];
  for (const label of labels) {
    const root = temporaryRoot();
    try {
      const value = fixture(root);
      const paths = journal.journalPaths(value.codexHome, value.targetPath, value.generationId);
      const interruptedDirectory = paths[label];
      assert.throws(
        () => bind(value, true, {
          afterN8nJournalDirectoryCreatedBeforeParentFsync({ directory }) {
            if (path.resolve(directory) !== path.resolve(interruptedDirectory)) return;
            const error = new Error('synthetic process exit before parent fsync');
            error.code = 'SYNTHETIC_STOP';
            throw error;
          },
          fsyncN8nJournalDirectory() {},
          n8nJournalPlatform: 'linux'
        }),
        { code: 'SYNTHETIC_STOP' },
        label
      );
      assert.equal(fs.lstatSync(interruptedDirectory).isDirectory(), true, label);
      const durableParents = [];
      const resumed = bind(value, true, {
        fsyncN8nJournalDirectory({ path: durableParent }) {
          durableParents.push(path.resolve(durableParent));
        },
        n8nJournalPlatform: 'linux'
      });
      assert.equal(resumed.exists, true, label);
      assert.ok(
        durableParents.includes(path.resolve(path.dirname(interruptedDirectory))),
        label
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('existing journal directory admission fails closed on fsync failure or parent identity change', () => {
  const failureRoot = temporaryRoot();
  try {
    const value = fixture(failureRoot);
    const initial = bind(value, true);
    const targetBytes = Buffer.from('canonical-target-bytes');
    const sentinel = path.join(value.targetPath, 'sentinel.txt');
    fs.writeFileSync(sentinel, targetBytes);
    assert.throws(
      () => bind(value, true, {
        fsyncN8nJournalDirectory({ path: durableParent }) {
          if (path.resolve(durableParent) !== path.resolve(initial.paths.transaction)) return;
          const error = new Error('synthetic fsync failure');
          error.code = 'EIO';
          throw error;
        },
        n8nJournalPlatform: 'linux'
      }),
      { code: 'journal-durability-unavailable' }
    );
    assert.deepEqual(fs.readFileSync(sentinel), targetBytes);
  } finally {
    fs.rmSync(failureRoot, { recursive: true, force: true });
  }

  const identityRoot = temporaryRoot();
  try {
    const value = fixture(identityRoot);
    const initial = bind(value, true);
    const displacedParent = `${initial.paths.transaction}-changed-parent`;
    let changed = false;
    assert.throws(
      () => bind(value, true, {
        beforeN8nJournalDirectoryParentFsync({ directory, parent }) {
          if (
            changed
            || path.resolve(directory) !== path.resolve(initial.paths.segments)
          ) return;
          changed = true;
          fs.renameSync(parent, displacedParent);
          fs.mkdirSync(parent);
        },
        fsyncN8nJournalDirectory() {},
        n8nJournalPlatform: 'linux'
      }),
      { code: 'journal-topology-invalid' }
    );
    assert.equal(changed, true);
  } finally {
    fs.rmSync(identityRoot, { recursive: true, force: true });
  }
});

test('read-only inspection performs no directory durability mutation and Windows keeps its honest boundary', () => {
  const root = temporaryRoot();
  try {
    const value = fixture(root);
    bind(value, true);
    let readOnlyFsyncs = 0;
    const inspected = bind(value, false, {
      fsyncN8nJournalDirectory() {
        readOnlyFsyncs += 1;
      },
      n8nJournalPlatform: 'linux'
    });
    assert.equal(inspected.exists, true);
    assert.equal(readOnlyFsyncs, 0);

    let platformFsyncs = 0;
    bind(value, true, {
      fsyncN8nJournalDirectory() {
        platformFsyncs += 1;
      }
    });
    assert.equal(platformFsyncs, process.platform === 'win32' ? 0 : 8);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('existing redirected journal directory is rejected without changing the redirect target', (t) => {
  const root = temporaryRoot();
  try {
    const value = fixture(root);
    const authority = bind(value, true);
    const decoy = path.join(root, 'redirect-decoy');
    fs.mkdirSync(decoy);
    fs.writeFileSync(path.join(decoy, 'preserved.txt'), 'preserved');
    fs.rmdirSync(authority.paths.checkpoints);
    try {
      fs.symlinkSync(
        decoy,
        authority.paths.checkpoints,
        process.platform === 'win32' ? 'junction' : 'dir'
      );
    } catch (error) {
      t.skip(`environment cannot create the platform directory redirect: ${error.code || 'unsupported'}`);
      return;
    }
    assert.throws(() => bind(value, true), { code: 'journal-topology-invalid' });
    assert.equal(fs.readFileSync(path.join(decoy, 'preserved.txt'), 'utf8'), 'preserved');
    assert.equal(fs.lstatSync(authority.paths.checkpoints).isSymbolicLink(), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

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

test('checkpoint inventory binds valid authority to the exact target, filename, family, slot, epoch, and generation', () => {
  const mutations = [
    {
      label: 'wrong frame target',
      mutate(frame) {
        frame.targetId = 'f'.repeat(64);
      }
    },
    {
      label: 'wrong frame family',
      mutate(frame) {
        frame.family += 1;
      }
    },
    {
      label: 'wrong payload slot',
      mutate(frame) {
        frame.payload.slot = frame.payload.slot === 'a' ? 'b' : 'a';
      }
    },
    {
      label: 'payload generation differs from frame generation',
      mutate(frame) {
        frame.payload.generation_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      }
    },
    {
      label: 'ownership-token digest mismatch',
      mutate(frame) {
        frame.payload.ownership_token_digest = 'f'.repeat(64);
      }
    }
  ];
  for (const { label, mutate } of mutations) {
    const root = temporaryRoot();
    try {
      const value = fixture(root);
      const authority = completeForCheckpoint(value);
      journal.writeTerminalCheckpoint(authority);
      const name = checkpointNames(authority)[0];
      rewriteCheckpoint(authority, name, mutate);
      const before = fs.readdirSync(authority.paths.checkpoints).sort();
      assert.throws(
        () => journal.writeTerminalCheckpoint(authority),
        { code: 'journal-checkpoint-corrupt' },
        label
      );
      assert.deepEqual(fs.readdirSync(authority.paths.checkpoints).sort(), before, label);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  for (const renamed of [
    'checkpoint-b-0000000000000001.jseg',
    'checkpoint-a-0000000000000002.jseg',
    'checkpoint-a-0000000000000000.jseg',
    'checkpoint-a-9999999999999999.jseg'
  ]) {
    const root = temporaryRoot();
    try {
      const value = fixture(root);
      const authority = completeForCheckpoint(value);
      journal.writeTerminalCheckpoint(authority);
      const original = checkpointNames(authority)[0];
      fs.renameSync(
        path.join(authority.paths.checkpoints, original),
        path.join(authority.paths.checkpoints, renamed)
      );
      const before = fs.readdirSync(authority.paths.checkpoints).sort();
      assert.throws(
        () => journal.writeTerminalCheckpoint(authority),
        { code: 'journal-checkpoint-corrupt' },
        renamed
      );
      assert.deepEqual(fs.readdirSync(authority.paths.checkpoints).sort(), before);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('checkpoint bytes copied from another target namespace are rejected without publication or compaction', () => {
  const root = temporaryRoot();
  try {
    const localValue = fixture(root, '55555555-5555-4555-8555-555555555551');
    const local = completeForCheckpoint(localValue);
    const foreignValue = {
      ...fixture(root, '55555555-5555-4555-8555-555555555552'),
      targetPath: path.join(root, 'foreign-target', '1.0.1')
    };
    fs.mkdirSync(foreignValue.targetPath, { recursive: true });
    const foreign = completeForCheckpoint(foreignValue);
    journal.writeTerminalCheckpoint(foreign);
    const foreignName = checkpointNames(foreign)[0];
    const foreignBytes = fs.readFileSync(path.join(foreign.paths.checkpoints, foreignName));
    fs.writeFileSync(
      path.join(local.paths.checkpoints, foreignName),
      foreignBytes,
      { flag: 'wx' }
    );
    const beforeCheckpoints = fs.readdirSync(local.paths.checkpoints).sort();
    const beforeTransactions = fs.readdirSync(local.paths.transactions).sort();
    assert.throws(
      () => journal.writeTerminalCheckpoint(local),
      { code: 'journal-checkpoint-corrupt' }
    );
    assert.deepEqual(fs.readdirSync(local.paths.checkpoints).sort(), beforeCheckpoints);
    assert.deepEqual(fs.readdirSync(local.paths.transactions).sort(), beforeTransactions);
    assert.deepEqual(
      fs.readFileSync(path.join(local.paths.checkpoints, foreignName)),
      foreignBytes
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('checkpoint chains reject foreign previous authority and foreign superseded authority', () => {
  const previousRoot = temporaryRoot();
  try {
    const first = completeForCheckpoint(
      fixture(previousRoot, '66666666-6666-4666-8666-666666666661')
    );
    journal.writeTerminalCheckpoint(first);
    const second = completeForCheckpoint(
      fixture(previousRoot, '66666666-6666-4666-8666-666666666662')
    );
    journal.writeTerminalCheckpoint(second);
    const foreignValue = {
      ...fixture(previousRoot, '66666666-6666-4666-8666-666666666663'),
      targetPath: path.join(previousRoot, 'foreign-previous-target')
    };
    fs.mkdirSync(foreignValue.targetPath, { recursive: true });
    const foreign = completeForCheckpoint(foreignValue);
    const foreignCheckpoint = journal.writeTerminalCheckpoint(foreign);
    const latestName = checkpointNames(second).at(-1);
    rewriteCheckpoint(second, latestName, (frame) => {
      frame.previousDigest = foreignCheckpoint.digest;
      frame.payload.previous_checkpoint_digest = foreignCheckpoint.digest;
    });
    assert.throws(
      () => journal.writeTerminalCheckpoint(second),
      { code: 'journal-checkpoint-corrupt' }
    );
  } finally {
    fs.rmSync(previousRoot, { recursive: true, force: true });
  }

  const supersededRoot = temporaryRoot();
  try {
    const authorities = [1, 2, 3].map((index) => completeForCheckpoint(
      fixture(
        supersededRoot,
        `77777777-7777-4777-8777-${String(index).padStart(12, '0')}`
      )
    ));
    journal.writeTerminalCheckpoint(authorities[0]);
    journal.writeTerminalCheckpoint(authorities[1]);
    assert.throws(
      () => journal.writeTerminalCheckpoint(authorities[2], {
        testHooks: {
          afterN8nCheckpointPublished() {
            const error = new Error('synthetic stop before checkpoint retirement');
            error.code = 'SYNTHETIC_STOP';
            throw error;
          }
        }
      }),
      { code: 'SYNTHETIC_STOP' }
    );
    const latestName = checkpointNames(authorities[2]).at(-1);
    rewriteCheckpoint(authorities[2], latestName, (frame) => {
      frame.payload.superseded_checkpoint = {
        ...frame.payload.superseded_checkpoint,
        target_id: 'f'.repeat(64)
      };
    });
    const before = fs.readdirSync(authorities[2].paths.checkpoints).sort();
    assert.throws(
      () => journal.writeTerminalCheckpoint(authorities[2]),
      { code: 'journal-checkpoint-corrupt' }
    );
    assert.deepEqual(fs.readdirSync(authorities[2].paths.checkpoints).sort(), before);
  } finally {
    fs.rmSync(supersededRoot, { recursive: true, force: true });
  }
});

test('retired checkpoint filenames bind the exact source filename and activating digest', () => {
  for (const variant of ['source', 'activation']) {
    const root = temporaryRoot();
    try {
      const authorities = [1, 2, 3].map((index) => completeForCheckpoint(
        fixture(root, `88888888-8888-4888-8888-${String(index).padStart(12, '0')}`)
      ));
      journal.writeTerminalCheckpoint(authorities[0]);
      journal.writeTerminalCheckpoint(authorities[1]);
      assert.throws(
        () => journal.writeTerminalCheckpoint(authorities[2], {
          testHooks: {
            afterN8nCheckpointRetirementMove() {
              const error = new Error('synthetic stop with retired checkpoint');
              error.code = 'SYNTHETIC_STOP';
              throw error;
            }
          }
        }),
        { code: 'SYNTHETIC_STOP' }
      );
      const retired = fs.readdirSync(authorities[2].paths.checkpoints)
        .find((name) => /^retired-checkpoint-/.test(name));
      const match = /^retired-(checkpoint-[ab]-[0-9]{16}\.jseg)-by-([0-9a-f]{64})\.jseg$/
        .exec(retired);
      const changed = variant === 'source'
        ? `retired-checkpoint-b-9999999999999999.jseg-by-${match[2]}.jseg`
        : `retired-${match[1]}-by-${'f'.repeat(64)}.jseg`;
      fs.renameSync(
        path.join(authorities[2].paths.checkpoints, retired),
        path.join(authorities[2].paths.checkpoints, changed)
      );
      const before = fs.readdirSync(authorities[2].paths.checkpoints).sort();
      assert.throws(
        () => journal.writeTerminalCheckpoint(authorities[2]),
        { code: variant === 'source' ? 'journal-checkpoint-corrupt' : 'journal-checkpoint-drift' }
      );
      assert.deepEqual(fs.readdirSync(authorities[2].paths.checkpoints).sort(), before);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
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

test('checkpoint compaction resumes after the final segment deletion and after segments-directory removal', () => {
  const finalSegmentRoot = temporaryRoot();
  try {
    const pair = completedCompactionPair(finalSegmentRoot);
    const expectedSegments = pair.first.records.length;
    let deleted = 0;
    assert.throws(
      () => journal.compactSupersededTransaction(pair.second, pair.checkpoint, {
        testHooks: {
          afterN8nTransactionCompactionDelete() {
            deleted += 1;
            if (deleted !== expectedSegments) return;
            const error = new Error('synthetic stop after final segment deletion');
            error.code = 'SYNTHETIC_STOP';
            throw error;
          }
        }
      }),
      { code: 'SYNTHETIC_STOP' }
    );
    assert.equal(deleted, expectedSegments);
    const resumed = journal.compactSupersededTransaction(pair.second, pair.checkpoint);
    assert.deepEqual(resumed, {
      compacted: true,
      reason: 'checkpointed-transaction-removed'
    });
  } finally {
    fs.rmSync(finalSegmentRoot, { recursive: true, force: true });
  }

  const removedSegmentsRoot = temporaryRoot();
  try {
    const prefix = interruptCompactionAfterSegments(removedSegmentsRoot);
    const resumed = journal.compactSupersededTransaction(prefix.second, prefix.checkpoint);
    assert.deepEqual(resumed, {
      compacted: true,
      reason: 'checkpointed-transaction-removed'
    });
    assert.equal(fs.existsSync(prefix.quarantinePath), false);
    assert.equal(fs.existsSync(prefix.first.paths.transaction), false);
    const repeatedFsyncs = [];
    assert.deepEqual(
      journal.compactSupersededTransaction(prefix.second, prefix.checkpoint, {
        testHooks: {
          fsyncN8nJournalDirectory({ path: durableParent }) {
            repeatedFsyncs.push(path.resolve(durableParent));
          },
          n8nJournalPlatform: 'linux'
        }
      }),
      { compacted: true, reason: 'already-absent' }
    );
    assert.ok(repeatedFsyncs.includes(path.resolve(prefix.second.paths.transactions)));
    const discovered = journal.discoverN8nRepairJournalsForTarget({
      codexHome: prefix.second.paths.codex_home,
      targetPath: prefix.second.target_path,
      write: true
    });
    assert.ok(discovered.some((entry) => entry.generation_id === prefix.second.generation_id));
  } finally {
    fs.rmSync(removedSegmentsRoot, { recursive: true, force: true });
  }
});

test('final compaction root-removal failure remains an exact resumable prefix', () => {
  const root = temporaryRoot();
  const originalRmdirSync = fs.rmdirSync;
  try {
    const prefix = interruptCompactionAfterSegments(root);
    let injected = false;
    fs.rmdirSync = function rmdirWithInjectedSharingFailure(directoryPath, ...args) {
      if (path.resolve(directoryPath) === path.resolve(prefix.quarantinePath)) {
        injected = true;
        const error = new Error('synthetic quarantine root removal failure');
        error.code = 'EBUSY';
        throw error;
      }
      return originalRmdirSync.call(fs, directoryPath, ...args);
    };
    assert.throws(
      () => journal.compactSupersededTransaction(prefix.second, prefix.checkpoint),
      { code: 'EBUSY' }
    );
    fs.rmdirSync = originalRmdirSync;
    assert.equal(injected, true);
    assert.deepEqual(fs.readdirSync(prefix.quarantinePath), []);
    assert.deepEqual(
      journal.compactSupersededTransaction(prefix.second, prefix.checkpoint),
      { compacted: true, reason: 'checkpointed-transaction-removed' }
    );
  } finally {
    fs.rmdirSync = originalRmdirSync;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('final compaction prefix rejects unexpected, redirected, reappeared, or renamed authority', (t) => {
  const unexpectedRoot = temporaryRoot();
  try {
    const prefix = interruptCompactionAfterSegments(unexpectedRoot);
    const unexpected = path.join(prefix.quarantinePath, 'unexpected');
    fs.writeFileSync(unexpected, 'preserve');
    assert.throws(
      () => journal.compactSupersededTransaction(prefix.second, prefix.checkpoint),
      { code: 'journal-compaction-drift' }
    );
    assert.equal(fs.readFileSync(unexpected, 'utf8'), 'preserve');
  } finally {
    fs.rmSync(unexpectedRoot, { recursive: true, force: true });
  }

  const redirectedRoot = temporaryRoot();
  try {
    const prefix = interruptCompactionAfterSegments(redirectedRoot);
    const decoy = path.join(redirectedRoot, 'redirect-target');
    fs.mkdirSync(decoy);
    const redirected = path.join(prefix.quarantinePath, 'redirected');
    try {
      fs.symlinkSync(
        decoy,
        redirected,
        process.platform === 'win32' ? 'junction' : 'dir'
      );
    } catch (error) {
      t.skip(`environment cannot create the platform directory redirect: ${error.code || 'unsupported'}`);
      return;
    }
    if (fs.existsSync(redirected)) {
      assert.throws(
        () => journal.compactSupersededTransaction(prefix.second, prefix.checkpoint),
        { code: 'journal-compaction-drift' }
      );
      assert.equal(fs.lstatSync(redirected).isSymbolicLink(), true);
    }
  } finally {
    fs.rmSync(redirectedRoot, { recursive: true, force: true });
  }

  const reappearedRoot = temporaryRoot();
  try {
    const prefix = interruptCompactionAfterSegments(reappearedRoot);
    fs.mkdirSync(prefix.first.paths.transaction);
    assert.throws(
      () => journal.compactSupersededTransaction(prefix.second, prefix.checkpoint),
      { code: 'journal-compaction-drift' }
    );
    assert.equal(fs.lstatSync(prefix.first.paths.transaction).isDirectory(), true);
  } finally {
    fs.rmSync(reappearedRoot, { recursive: true, force: true });
  }

  const renamedRoot = temporaryRoot();
  try {
    const prefix = interruptCompactionAfterSegments(renamedRoot);
    const wrongPath = `${prefix.quarantinePath}-wrong`;
    fs.renameSync(prefix.quarantinePath, wrongPath);
    assert.throws(
      () => journal.compactSupersededTransaction(prefix.second, prefix.checkpoint),
      { code: 'journal-compaction-drift' }
    );
    assert.equal(fs.lstatSync(wrongPath).isDirectory(), true);
  } finally {
    fs.rmSync(renamedRoot, { recursive: true, force: true });
  }
});

test('final compaction prefix rejects activating-checkpoint drift and preserves unrelated transactions', () => {
  const root = temporaryRoot();
  try {
    const prefix = interruptCompactionAfterSegments(root);
    const unrelated = path.join(
      prefix.second.paths.transactions,
      '99999999-9999-4999-8999-999999999999'
    );
    fs.mkdirSync(unrelated);
    fs.writeFileSync(path.join(unrelated, 'preserved'), 'unrelated');
    const checkpointName = checkpointNames(prefix.second)
      .find((name) => {
        const decoded = journal.decodeFrame(
          fs.readFileSync(path.join(prefix.second.paths.checkpoints, name))
        );
        return decoded.complete_digest === prefix.checkpoint.digest;
      });
    rewriteCheckpoint(prefix.second, checkpointName, (frame) => {
      frame.payload.cumulative_terminal_root = 'f'.repeat(64);
    });
    assert.throws(
      () => journal.compactSupersededTransaction(prefix.second, prefix.checkpoint),
      { code: 'journal-checkpoint-drift' }
    );
    assert.equal(fs.readFileSync(path.join(unrelated, 'preserved'), 'utf8'), 'unrelated');
    assert.equal(fs.lstatSync(prefix.quarantinePath).isDirectory(), true);
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
