'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const reviewState = require('../scripts/source-watch-review-state.cjs');
const sourceUpdates = require('../scripts/check-project-source-updates.cjs');
const { SPEC_SCHEMA, inspectOwnedTemps, recoverStaleOwnedTemps, withOwnedTemp } = require('../scripts/toolkit-owned-temp.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'repo', 'scripts', 'check-project-source-updates.cjs');
const sourceLockRel = 'repo/source-watch/provenance/example/SOURCE-LOCK.json';
const sourceProjectRel = 'repo/source-watch/provenance/example';
const lockedSha = '1111111111111111111111111111111111111111';
const latestSha = '2222222222222222222222222222222222222222';

function ownedSpec(episode, options = {}) {
  return { schema: SPEC_SCHEMA, purpose: 'source-update', repoRoot, episode, budgetBytes: 16 * 1024 * 1024, ...options };
}

async function writeJson(lease, workspace, relativePath, value) {
  await lease.writeFile(path.posix.join(workspace, relativePath), JSON.stringify(value, null, 2) + '\n');
}

function activeLock(sourceCommit = lockedSha) {
  return {
    source_repo: 'example-owner/example-repo',
    source_ref: 'main',
    source_commit: sourceCommit,
    source_lifecycle: 'active',
    source_role: 'third_party_attribution_source',
    source_update_policy: 'manual_review_required',
    public_attribution_required: true,
    files: [
      {
        mode: 'exact',
        source_path: 'src/data.csv',
        root_surface_path: 'skills/fixture/data.csv',
        source_blob_sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      },
      {
        mode: 'adapted',
        source_path: 'src/tool.js',
        root_surface_path: 'skills/fixture/tool.js',
        source_blob_sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        notes: 'Adapted for toolkit local-only execution.'
      },
      {
        mode: 'excluded',
        source_path: 'package.json',
        notes: 'Excluded from the toolkit subset.'
      }
    ]
  };
}

function retiredLock() {
  return {
    source_repo: 'example-owner/retired-source',
    source_ref: 'main',
    source_commit: 'retired-source-marker',
    source_lifecycle: 'retired_after_migration',
    source_role: 'migration_provenance_only',
    source_update_policy: 'none',
    public_attribution_required: false,
    files: []
  };
}

function reviewStateDoc(reviewedThroughSha) {
  return {
    schema_version: 1,
    policy: {
      cursor_advancement: 'human_advanced_only',
      runtime_updates: 'forbidden',
      adoption_and_review_are_distinct: true
    },
    records: [{
      target_key: 'source-lock:' + sourceProjectRel,
      target_kind: 'source_lock',
      repository: 'example-owner/example-repo',
      ref: 'main',
      source_lock_path: sourceLockRel,
      reviewed_through_sha: reviewedThroughSha,
      reviewed_at: '2026-07-30',
      disposition: 'READ_ONLY_REVIEW_REQUIRED',
      owning_tracker: '#315'
    }]
  };
}

function ownedTempUsage() {
  const snapshot = require('../scripts/toolkit-owned-temp.cjs').inspectOwnedTemps();
  return {
    records: snapshot.records.length,
    outstandingReservationsBytes: snapshot.outstandingReservationsBytes,
    retainedRoots: snapshot.retainedRoots
  };
}

async function withOwnedWorkspace(ownedSpec, callback) {
  const baseline = ownedTempUsage();
  const original = fs.statfsSync;
  fs.statfsSync = () => ({ bavail: 16n * 1024n * 1024n * 1024n, bsize: 1n });
  try {
    const value = await withOwnedTemp(ownedSpec, callback);
    assert.deepEqual(ownedTempUsage(), baseline);
    return value;
  } finally {
    fs.statfsSync = original;
  }
}

async function withWorkspace(episode, fn) {
  return withOwnedWorkspace(ownedSpec(episode), async (lease) => {
    await lease.mkdir('workspace');
    return fn(lease, 'workspace');
  });
}

async function waitForTestBarrier(target, label) {
  if (target && typeof target.waitForBarrier === 'function') return target.waitForBarrier(label);
  let timer;
  try {
    await Promise.race([
      target,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Timed out waiting for ' + label + '.')), 60000); })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function withMockGitHub(sha, fn, status = 200) {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url);
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ sha }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await fn('http://127.0.0.1:' + port, requests);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function runScript(lease, workspace, apiBaseUrl) {
  const originalBaseUrl = process.env.SOURCE_WATCH_GITHUB_API_BASE_URL;
  process.env.SOURCE_WATCH_GITHUB_API_BASE_URL = apiBaseUrl;
  try {
    return await lease.runProfile('source-update');
  } catch (error) {
    if (error.code !== 'TEMP_CHILD_FAILED' || !Number.isSafeInteger(error.exitCode) || error.exitCode === 0) throw error;
    return { code: error.exitCode, stdout: error.stdout, stderr: error.stderr };
  } finally {
    if (originalBaseUrl === undefined) delete process.env.SOURCE_WATCH_GITHUB_API_BASE_URL;
    else process.env.SOURCE_WATCH_GITHUB_API_BASE_URL = originalBaseUrl;
  }
}

async function runStandaloneScript(args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, options);
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
    child.once('error', (caught) => { clearTimeout(timer); reject(caught); });
    child.once('close', (status, signal) => {
      clearTimeout(timer);
      resolve({ status, signal, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') });
    });
  });
}
function encodeReportFrame(value) {
  const payload = Buffer.from(JSON.stringify(value), 'utf8');
  const frame = Buffer.allocUnsafe(payload.length + 4);
  frame.writeUInt32BE(payload.length, 0);
  payload.copy(frame, 4);
  return frame;
}

function decodeReportIpcTestFrame(frame) {
  assert.ok(Buffer.isBuffer(frame));
  assert.ok(frame.length >= 5);
  assert.equal(frame.readUInt32BE(0), frame.length - 4);
  return JSON.parse(frame.subarray(4).toString('utf8'));
}

function replyReportIpc(ipc, message, handle = null) {
  ipc.emit('message', Buffer.isBuffer(message) ? message : encodeReportFrame(message), handle);
}

function fakeReportIpc(respond, options = {}) {
  const ipc = new EventEmitter();
  ipc.channel = {};
  ipc.connected = true;
  ipc.sent = [];
  ipc.send = (frame, callback) => {
    assert.ok(ipc.listenerCount('message') > 0, 'message observer must be installed before send');
    assert.ok(ipc.listenerCount('error') > 0, 'error observer must be installed before send');
    assert.ok(ipc.listenerCount('disconnect') > 0, 'disconnect observer must be installed before send');
    const message = decodeReportIpcTestFrame(frame);
    ipc.sent.push(message);
    queueMicrotask(() => {
      const sendError = options.sendErrorType === message.type ? new Error('injected IPC send failure') : null;
      if (callback) callback(sendError);
      if (!sendError && respond) respond(ipc, message);
    });
    return true;
  };
  return ipc;
}

function autoReportBroker(ipc, message) {
  if (message.type === 'BROKER_HELLO') {
    replyReportIpc(ipc, { version: 1, token: message.token, type: 'BROKER_READY' });
  } else if (message.type === 'PUT_REPORT' || message.type === 'REMOVE_REPORT') {
    replyReportIpc(ipc, { version: 1, token: message.token, acknowledged: true });
  }
}


function installParentIpcFault(stage, makeMessages) {
  const ChildProcess = require('node:child_process').ChildProcess;
  const originalEmit = ChildProcess.prototype.emit;
  const state = { injected: false, messages: 0 };
  const isSourceUpdateChild = (child) => Array.isArray(child.spawnargs)
    && child.spawnargs.some((argument) => String(argument).endsWith('check-project-source-updates.cjs'));
  const dispatch = (child, items) => {
    for (const item of items) {
      state.messages += 1;
      originalEmit.call(child, 'message', item.message, item.handle);
    }
  };
  ChildProcess.prototype.emit = function (event, ...args) {
    if (event !== 'message' || !isSourceUpdateChild(this) || !Buffer.isBuffer(args[0])) {
      return originalEmit.call(this, event, ...args);
    }
    let received;
    try { received = decodeReportIpcTestFrame(args[0]); }
    catch (_) { return originalEmit.call(this, event, ...args); }
    if (!state.injected && stage === 'admission' && received.type === 'BROKER_HELLO') {
      state.injected = true;
      dispatch(this, makeMessages(received));
      return true;
    }
    if (!state.injected && stage === 'terminal' && received.type === 'BROKER_READY_ACK') {
      const result = originalEmit.call(this, event, ...args);
      state.injected = true;
      dispatch(this, makeMessages(received));
      return result;
    }
    if (state.injected && (received.type === 'PUT_REPORT' || received.type === 'REMOVE_REPORT')) return true;
    return originalEmit.call(this, event, ...args);
  };
  return {
    state,
    restore() { ChildProcess.prototype.emit = originalEmit; }
  };
}

function forgedControl(type, token, version = 1) {
  return encodeReportFrame({ version, token, type });
}

function forgedTerminal(type, token, fields = {}) {
  return encodeReportFrame({ version: 1, token, type, ...fields });
}

test('owned report parent IPC broker rejects invalid admission and terminal messages', async (t) => {
  const wrongToken = (token) => token === '0'.repeat(48) ? '1'.repeat(48) : '0'.repeat(48);
  const admissionCases = [
    ['wrong admission token', (message) => [{ message: forgedControl('BROKER_HELLO', wrongToken(message.token)) }]],
    ['wrong admission version', (message) => [{ message: forgedControl('BROKER_HELLO', message.token, 2) }]],
    ['wrong admission phase', (message) => [{ message: forgedControl('BROKER_READY_ACK', message.token) }]],
    ['malformed admission frame', () => [{ message: Buffer.from([0, 0, 0, 5, 123]) }]],
    ['admission frame with transferred handle', (message) => [{ message: forgedControl('BROKER_HELLO', message.token), handle: {} }]]
  ].map(([name, makeMessages]) => ({ name, stage: 'admission', makeMessages, duplicate: false }));
  const terminalCases = [
    ['wrong terminal token', (message) => [{ message: forgedTerminal('REMOVE_REPORT', wrongToken(message.token)) }]],
    ['wrong terminal version', (message) => [{ message: encodeReportFrame({ version: 2, token: message.token, type: 'REMOVE_REPORT' }) }]],
    ['wrong terminal type', (message) => [{ message: forgedTerminal('DELETE_REPORT', message.token) }]],
    ['malformed terminal JSON', () => [{ message: Buffer.from([0, 0, 0, 1, 123]) }]],
    ['oversized terminal frame', () => {
      const message = Buffer.alloc(65536 * 6 + 1025);
      message.writeUInt32BE(message.length - 4, 0);
      return [{ message }];
    }],
    ['truncated terminal frame', () => {
      const message = Buffer.alloc(6);
      message.writeUInt32BE(10, 0);
      message[4] = 123;
      message[5] = 125;
      return [{ message }];
    }],
    ['concatenated terminal frames', (message) => {
      const frame = forgedTerminal('REMOVE_REPORT', message.token);
      return [{ message: Buffer.concat([frame, frame]) }];
    }],
    ['terminal frame with destination injection', (message) => [{
      message: encodeReportFrame({ version: 1, token: message.token, type: 'REMOVE_REPORT', destination: 'workspace/escape.md' })
    }]],
    ['terminal frame with staged identity injection', (message) => [{
      message: forgedTerminal('PUT_REPORT', message.token, { content: 'injected', staged_identity: { dev: '1', ino: '2' } })
    }]],
    ['terminal frame with transferred handle', (message) => [{ message: forgedTerminal('REMOVE_REPORT', message.token), handle: {} }]],
    ['duplicate terminal request', (message) => [
      { message: forgedTerminal('PUT_REPORT', message.token, { content: 'first accepted report' }) },
      { message: forgedTerminal('PUT_REPORT', message.token, { content: 'replayed report must not overwrite' }) }
    ], true]
  ].map(([name, makeMessages, duplicate = false]) => ({ name, stage: 'terminal', makeMessages, duplicate }));

  for (const scenario of [...admissionCases, ...terminalCases]) {
    await t.test(scenario.name, async () => {
      const episode = 'parent-ipc-' + scenario.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const baseline = ownedTempUsage();
      let profileError = null;
      await assert.rejects(withOwnedWorkspace(ownedSpec(episode), async (lease) => {
        await writeJson(lease, 'workspace', sourceLockRel, activeLock());
        const destination = lease.path('workspace/repo/source-watch/reviews/active-third-party-updates.md');
        await lease.writeFile('workspace/repo/source-watch/reviews/active-third-party-updates.md', 'prior report');
        await withMockGitHub(latestSha, async (apiBaseUrl) => {
          const originalApiBaseUrl = process.env.SOURCE_WATCH_GITHUB_API_BASE_URL;
          process.env.SOURCE_WATCH_GITHUB_API_BASE_URL = apiBaseUrl;
          const injector = installParentIpcFault(scenario.stage, scenario.makeMessages);
          const originalRename = fs.renameSync;
          let destinationRenames = 0;
          if (scenario.duplicate) {
            fs.renameSync = function (source, target, ...args) {
              if (path.resolve(target) === path.resolve(destination)) destinationRenames += 1;
              return originalRename.call(this, source, target, ...args);
            };
          }
          try {
            await assert.rejects(lease.runProfile('source-update'), (caught) => { profileError = caught; return caught.code === 'TEMP_CHILD_PROTOCOL'; });
            assert.equal(injector.state.injected, true);
            assert.ok(injector.state.messages >= 1);
            if (scenario.duplicate) {
              assert.equal(destinationRenames, 1, 'only the first terminal request may commit');
              assert.equal(fs.readFileSync(destination, 'utf8'), 'first accepted report');
            } else {
              assert.equal(fs.readFileSync(destination, 'utf8'), 'prior report', 'invalid IPC must not mutate the report');
            }
          } finally {
            fs.renameSync = originalRename;
            injector.restore();
            if (originalApiBaseUrl === undefined) delete process.env.SOURCE_WATCH_GITHUB_API_BASE_URL;
            else process.env.SOURCE_WATCH_GITHUB_API_BASE_URL = originalApiBaseUrl;
          }
        });
      }), (caught) => {
        assert.strictEqual(caught, profileError);
        return caught.code === 'TEMP_CHILD_PROTOCOL';
      });
      assert.deepEqual(ownedTempUsage(), baseline);
    });
  }
});

test('owned report frames enforce the strict UTF-8 JSON and payload contract', async () => {
  const token = 'a'.repeat(48);
  let commits = 0;
  const commit = async () => { commits += 1; };
  const exact = sourceUpdates.ownedReportRequestFrame({ type: 'PUT_REPORT', content: 'x'.repeat(65536) }, token);
  assert.equal((await sourceUpdates.mediateOwnedReportFrame(exact, token, commit)), 'PUT_REPORT');
  assert.equal(commits, 1);

  const escaped = '\u0000'.repeat(65536);
  assert.equal(Buffer.byteLength(escaped, 'utf8'), 65536);
  const escapedFrame = sourceUpdates.ownedReportRequestFrame({ type: 'PUT_REPORT', content: escaped }, token);
  assert.equal((await sourceUpdates.mediateOwnedReportFrame(escapedFrame, token, commit)), 'PUT_REPORT');
  assert.ok(escapedFrame.length <= 394240);
  assert.equal(commits, 2);

  const over = encodeReportFrame({ version: 1, token, type: 'PUT_REPORT', content: 'x'.repeat(65537) });
  await assert.rejects(sourceUpdates.mediateOwnedReportFrame(over, token, commit), /65,536-byte/);
  const replay = sourceUpdates.ownedReportRequestFrame({ type: 'REMOVE_REPORT' }, 'b'.repeat(48));
  await assert.rejects(sourceUpdates.mediateOwnedReportFrame(replay, token, commit), /unsupported shape or destination/);
  const request = sourceUpdates.ownedReportRequestFrame({ type: 'REMOVE_REPORT' }, token);
  await assert.rejects(sourceUpdates.mediateOwnedReportFrame(Buffer.concat([request, request]), token, commit), /exactly one complete frame/);
  const wrongDestination = encodeReportFrame({ version: 1, token, type: 'REMOVE_REPORT', destination: 'foreign' });
  await assert.rejects(sourceUpdates.mediateOwnedReportFrame(wrongDestination, token, commit), /unsupported shape or destination/);
  const identityRebind = encodeReportFrame({
    version: 1, token, type: 'PUT_REPORT', content: 'replacement',
    staged_identity: { dev: 'same-device', ino: 'same-inode' }, digest: 'coherent-digest', acknowledged: true
  });
  await assert.rejects(sourceUpdates.mediateOwnedReportFrame(identityRebind, token, commit), /unsupported shape or destination/);
  await assert.rejects(sourceUpdates.mediateOwnedReportFrame(Buffer.from([0, 0, 0, 1, 123]), token, commit), /malformed JSON/);
  await assert.rejects(sourceUpdates.mediateOwnedReportFrame(Buffer.from([0, 0, 0, 1, 255]), token, commit), /valid UTF-8/);
  const truncated = Buffer.from(request);
  truncated[3] -= 1;
  await assert.rejects(sourceUpdates.mediateOwnedReportFrame(truncated, token, commit), /exactly one complete frame/);
  await assert.rejects(sourceUpdates.mediateOwnedReportFrame(Buffer.alloc(394241), token, commit), /missing or oversized/);
  assert.equal(commits, 2);
});

test('owned report IPC client completes framed admission, one terminal request, and application acknowledgement', async () => {
  const token = 'a'.repeat(48);
  const env = { TOOLKIT_OWNED_TEMP_MODE: 'source-update-v1', TOOLKIT_OWNED_TEMP_REPORT_TOKEN: token };
  const ipc = fakeReportIpc(autoReportBroker);
  const client = sourceUpdates.createOwnedReportIpcClient(ipc, env);
  try {
    assert.equal(sourceUpdates.hasOwnedReportIpc(ipc, env), true);
    await client.admit();
    assert.equal(client.phase, 'ADMITTED');
    assert.deepEqual(ipc.sent.map((message) => message.type), ['BROKER_HELLO', 'BROKER_READY_ACK']);
    assert.equal(await client.send({ type: 'REMOVE_REPORT' }), 'REMOVE_REPORT');
    assert.equal(client.phase, 'ACK_RECEIVED');
    assert.deepEqual(ipc.sent.map((message) => message.type), ['BROKER_HELLO', 'BROKER_READY_ACK', 'REMOVE_REPORT']);
  } finally {
    client.dispose();
  }
  assert.equal(ipc.listenerCount('message'), 0);
  assert.equal(ipc.listenerCount('error'), 0);
  assert.equal(ipc.listenerCount('disconnect'), 0);
});

test('owned report IPC client rejects missing, disconnected, unusable, or invalid per-profile transport', () => {
  const token = 'a'.repeat(48);
  const env = { TOOLKIT_OWNED_TEMP_MODE: 'source-update-v1', TOOLKIT_OWNED_TEMP_REPORT_TOKEN: token };
  assert.equal(sourceUpdates.hasOwnedReportIpc({}, env), false);
  assert.throws(() => sourceUpdates.createOwnedReportIpcClient({}, env), /IPC channel is missing or unusable/);
  const noSend = new EventEmitter();
  noSend.channel = {};
  noSend.connected = true;
  assert.throws(() => sourceUpdates.createOwnedReportIpcClient(noSend, env), /IPC channel is missing or unusable/);
  const disconnected = new EventEmitter();
  disconnected.channel = {};
  disconnected.connected = false;
  disconnected.send = () => {};
  assert.throws(() => sourceUpdates.createOwnedReportIpcClient(disconnected, env), /IPC channel is missing or unusable/);
  assert.throws(() => sourceUpdates.createOwnedReportIpcClient(fakeReportIpc(autoReportBroker), {
    ...env, TOOLKIT_OWNED_TEMP_REPORT_TOKEN: 'invalid'
  }), /token is invalid/);
  assert.throws(() => sourceUpdates.createOwnedReportIpcClient(fakeReportIpc(autoReportBroker), {
    ...env, TOOLKIT_OWNED_TEMP_MODE: 'unsupported'
  }), /mode is missing or unsupported/);
});

test('owned report IPC client rejects malformed admission, wrong token/version/phase, replay, and transferred handles', async (t) => {
  const token = 'a'.repeat(48);
  const env = { TOOLKIT_OWNED_TEMP_MODE: 'source-update-v1', TOOLKIT_OWNED_TEMP_REPORT_TOKEN: token };
  const cases = [
    ['wrong token', (ipc, message) => replyReportIpc(ipc, { version: 1, token: 'b'.repeat(48), type: 'BROKER_READY' }), /admission failed/],
    ['wrong version', (ipc, message) => replyReportIpc(ipc, { version: 2, token: message.token, type: 'BROKER_READY' }), /admission failed/],
    ['wrong phase', (ipc, message) => replyReportIpc(ipc, { version: 1, token: message.token, type: 'PUT_REPORT' }), /admission failed|unexpected admission phase/],
    ['malformed frame', (ipc) => replyReportIpc(ipc, Buffer.from([0, 0, 0, 5, 123])), /admission failed/],
    ['transferred handle', (ipc, message) => replyReportIpc(ipc, { version: 1, token: message.token, type: 'BROKER_READY' }, { unexpected: true }), /transferred an unexpected handle/]
  ];
  for (const [label, respond, expected] of cases) {
    await t.test(label, async () => {
      const ipc = fakeReportIpc(respond);
      const client = sourceUpdates.createOwnedReportIpcClient(ipc, env);
      try { await assert.rejects(client.admit(), expected); }
      finally { client.dispose(); }
    });
  }

  const replayIpc = fakeReportIpc(autoReportBroker);
  const replayClient = sourceUpdates.createOwnedReportIpcClient(replayIpc, env);
  try {
    await replayClient.admit();
    replyReportIpc(replayIpc, { version: 1, token, type: 'BROKER_READY' });
    await new Promise((resolve) => setImmediate(resolve));
    await assert.rejects(replayClient.send({ type: 'REMOVE_REPORT' }), /unexpected phase/);
  } finally {
    replayClient.dispose();
  }
});

test('owned report IPC send success is not application receipt and disconnect after request fails closed', async () => {
  const token = 'a'.repeat(48);
  const env = { TOOLKIT_OWNED_TEMP_MODE: 'source-update-v1', TOOLKIT_OWNED_TEMP_REPORT_TOKEN: token };
  const ipc = fakeReportIpc((target, message) => {
    if (message.type === 'BROKER_HELLO') {
      replyReportIpc(target, { version: 1, token: message.token, type: 'BROKER_READY' });
    }
  });
  const client = sourceUpdates.createOwnedReportIpcClient(ipc, env);
  try {
    await client.admit();
    let settled = false;
    const pending = client.send({ type: 'REMOVE_REPORT' }).finally(() => { settled = true; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    ipc.connected = false;
    ipc.emit('disconnect');
    await assert.rejects(pending, /IPC channel disconnected/);
    assert.equal(settled, true);
  } finally {
    client.dispose();
  }
});

test('owned report IPC client rejects wrong or negative acknowledgement and request send failure', async (t) => {
  const token = 'a'.repeat(48);
  const env = { TOOLKIT_OWNED_TEMP_MODE: 'source-update-v1', TOOLKIT_OWNED_TEMP_REPORT_TOKEN: token };
  const cases = [
    ['wrong token', (ipc, message) => {
      if (message.type === 'BROKER_HELLO') replyReportIpc(ipc, { version: 1, token: message.token, type: 'BROKER_READY' });
      if (message.type === 'REMOVE_REPORT') replyReportIpc(ipc, { version: 1, token: 'b'.repeat(48), acknowledged: true });
    }, /acknowledgement is invalid/],
    ['wrong version', (ipc, message) => {
      if (message.type === 'BROKER_HELLO') replyReportIpc(ipc, { version: 1, token: message.token, type: 'BROKER_READY' });
      if (message.type === 'REMOVE_REPORT') replyReportIpc(ipc, { version: 2, token: message.token, acknowledged: true });
    }, /acknowledgement is invalid/],
    ['unexpected acknowledgement key', (ipc, message) => {
      if (message.type === 'BROKER_HELLO') replyReportIpc(ipc, { version: 1, token: message.token, type: 'BROKER_READY' });
      if (message.type === 'REMOVE_REPORT') replyReportIpc(ipc, { version: 1, token: message.token, acknowledged: true, staged_identity: {} });
    }, /acknowledgement is invalid/],
    ['negative acknowledgement', (ipc, message) => {
      if (message.type === 'BROKER_HELLO') replyReportIpc(ipc, { version: 1, token: message.token, type: 'BROKER_READY' });
      if (message.type === 'REMOVE_REPORT') replyReportIpc(ipc, { version: 1, token: message.token, acknowledged: false });
    }, /rejected by the parent/]
  ];
  for (const [label, respond, expected] of cases) {
    await t.test(label, async () => {
      const ipc = fakeReportIpc(respond);
      const client = sourceUpdates.createOwnedReportIpcClient(ipc, env);
      try {
        await client.admit();
        await assert.rejects(client.send({ type: 'REMOVE_REPORT' }), expected);
      } finally { client.dispose(); }
    });
  }

  const failed = fakeReportIpc(autoReportBroker, { sendErrorType: 'REMOVE_REPORT' });
  const failedClient = sourceUpdates.createOwnedReportIpcClient(failed, env);
  try {
    await failedClient.admit();
    await assert.rejects(failedClient.send({ type: 'REMOVE_REPORT' }), /Owned report request failed/);
  } finally {
    failedClient.dispose();
  }
});

test('owned mode without IPC fails admission before any standalone report write', async () => {
  const token = 'a'.repeat(48);
  await withWorkspace('owned-report-missing-ipc', async (lease, workspace) => {
    const result = spawnSync(process.execPath, [
      scriptPath, '--workspace', lease.path(workspace), '--report', 'must-not-write.md'
    ], {
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, TOOLKIT_OWNED_TEMP_MODE: 'source-update-v1', TOOLKIT_OWNED_TEMP_REPORT_TOKEN: token }
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /IPC channel is missing or unusable/);
    assert.equal(fs.existsSync(lease.path('must-not-write.md')), false);
    assert.equal(fs.existsSync(lease.path('repo/source-watch/reviews/active-third-party-updates.md')), false);
  });
});
function pausedReportStage(lease, apiBaseUrl, options = {}) {
  const originalOpen = fs.openSync;
  const originalLstat = fs.promises.lstat;
  const originalRename = fs.renameSync;
  const originalUnlink = fs.unlinkSync;
  const originalRmdir = fs.rmdirSync;
  const originalWriteFile = fs.writeFileSync;
  const originalPromiseRename = fs.promises.rename;
  const originalPromiseUnlink = fs.promises.unlink;
  const ChildProcess = require('node:child_process').ChildProcess;
  const originalEmit = ChildProcess.prototype.emit;
  const originalSend = ChildProcess.prototype.send;
  let negativeAckAttempts = 0;
  let negativeAckDelivered = 0;
  let coherentRebindMessages = 0;
  const originalApiBaseUrl = process.env.SOURCE_WATCH_GITHUB_API_BASE_URL;
  const destination = lease.path('workspace/repo/source-watch/reviews/active-third-party-updates.md');
  let stagePath = null;
  let boundaryReached = false;
  let completionSettled = false;
  let destinationMutations = 0;
  let eventSequence = 0;
  const observationEvents = [];
  const eventWaiters = new Set();
  let enterBoundary;
  let releaseBoundary;
  const entered = new Promise((resolve) => { enterBoundary = resolve; });
  let released = false;
  const gate = new Promise((resolve) => { releaseBoundary = () => { if (!released) { released = true; resolve(); } }; });
  const same = (left, right) => path.resolve(String(left)) === path.resolve(String(right));
  const isWriteMode = (flags) => typeof flags === 'number'
    ? (flags & 3) !== fs.constants.O_RDONLY
    : /[wax+]/.test(String(flags));
  const recordEvent = (type, value) => {
    const event = { order: ++eventSequence, type, value };
    observationEvents.push(event);
    for (const waiter of [...eventWaiters]) waiter(event);
    if ((type === 'profile-failed' || type === 'child-disconnect' || type === 'child-close') && !released) {
      releaseBoundary();
    }
    return event;
  };
  const isProfileChild = (child) => Array.isArray(child.spawnargs)
    && child.spawnargs.some((argument) => String(argument).endsWith('check-project-source-updates.cjs'));
  ChildProcess.prototype.emit = function (event, ...args) {
    const profileChild = isProfileChild(this);
    const forwardedArgs = profileChild && event === 'close' && options.forceZeroExit ? [0, args[1]] : args;
    const result = originalEmit.call(this, event, ...forwardedArgs);

    if (profileChild && event === 'disconnect') recordEvent('child-disconnect', args);
    if (profileChild && event === 'close') recordEvent('child-close', forwardedArgs);
    return result;
  };
  ChildProcess.prototype.send = function (frame, callback) {
    let message = null;
    if (isProfileChild(this) && Buffer.isBuffer(frame)) {
      try { message = decodeReportIpcTestFrame(frame); } catch (_) {}
    }
    if (!message || message.acknowledged !== false) return originalSend.call(this, frame, callback);
    negativeAckAttempts += 1;
    recordEvent('negative-ack-attempt', message.acknowledged);
    return originalSend.call(this, frame, (caught) => {
      if (!caught) {
        negativeAckDelivered += 1;
        recordEvent('negative-ack-delivered', message.acknowledged);
        originalEmit.call(this, 'message', encodeReportFrame({
          version: 1, token: message.token, type: 'PUT_REPORT', content: 'coherent late report rebind'
        }));
        coherentRebindMessages += 1;
        if (options.abortOnNegativeAck) {
          recordEvent('external-abort-after-negative-ack', message.acknowledged);
          options.abortController.abort('external abort after profile failure');
        }
      }
      if (callback) callback(caught);
    });
  };

  fs.openSync = function (filePath, flags, ...args) {
    if (same(filePath, destination) && isWriteMode(flags)) destinationMutations += 1;
    const fd = originalOpen.call(this, filePath, flags, ...args);
    if (String(filePath).includes('active-third-party-updates.md.pending-')) stagePath = String(filePath);
    return fd;
  };
  fs.writeFileSync = function (filePath, ...args) {
    if (same(filePath, destination)) destinationMutations += 1;
    return originalWriteFile.call(this, filePath, ...args);
  };
  fs.renameSync = function (from, to, ...args) {
    if (same(to, destination)) destinationMutations += 1;
    return originalRename.call(this, from, to, ...args);
  };
  fs.unlinkSync = function (filePath, ...args) {
    if (same(filePath, destination)) destinationMutations += 1;
    return originalUnlink.call(this, filePath, ...args);
  };
  fs.promises.rename = async function (from, to, ...args) {
    if (same(to, destination)) destinationMutations += 1;
    return originalPromiseRename.call(this, from, to, ...args);
  };
  fs.promises.unlink = async function (filePath, ...args) {
    if (same(filePath, destination)) destinationMutations += 1;
    return originalPromiseUnlink.call(this, filePath, ...args);
  };
  fs.promises.lstat = async function (filePath, ...args) {
    if (!boundaryReached && stagePath && same(filePath, stagePath)) {
      boundaryReached = true;
      recordEvent('barrier', stagePath);
      enterBoundary();
      await gate;
    }
    return originalLstat.call(this, filePath, ...args);
  };

  process.env.SOURCE_WATCH_GITHUB_API_BASE_URL = apiBaseUrl;
  const profilePromise = lease.runProfile('source-update');
  profilePromise.then(
    (value) => recordEvent('profile-resolved', value),
    (caught) => recordEvent('profile-failed', caught)
  );
  const completion = profilePromise.then(
    (value) => {
      completionSettled = true;
      if (originalApiBaseUrl === undefined) delete process.env.SOURCE_WATCH_GITHUB_API_BASE_URL;
      else process.env.SOURCE_WATCH_GITHUB_API_BASE_URL = originalApiBaseUrl;
      return { status: 'resolved', value };
    },
    (error) => {
      completionSettled = true;
      if (originalApiBaseUrl === undefined) delete process.env.SOURCE_WATCH_GITHUB_API_BASE_URL;
      else process.env.SOURCE_WATCH_GITHUB_API_BASE_URL = originalApiBaseUrl;
      return { status: 'rejected', error };
    }
  );
  const observeTerminalBeforeBarrier = async (event, label) => {
    releaseBoundary();
    const outcome = await completion;
    if (event.type === 'profile-failed') throw event.value;
    if (outcome.status === 'rejected') throw outcome.error;
    throw new Error('Observer failure: profile completed before ' + label + '.');
  };
  const waitForBarrier = (label) => {
    const terminalTypes = new Set(['profile-failed', 'profile-resolved', 'child-disconnect', 'child-close']);
    const classify = (event) => event.type === 'barrier'
      ? Promise.resolve(event)
      : observeTerminalBeforeBarrier(event, label);
    if (observationEvents.length) return classify(observationEvents[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        eventWaiters.delete(listener);
        releaseBoundary();
        reject(new Error('Timed out waiting for ' + label + '.'));
      }, 60000);
      const listener = (event) => {
        if (event.type !== 'barrier' && !terminalTypes.has(event.type)) return;
        eventWaiters.delete(listener);
        clearTimeout(timer);
        classify(event).then(resolve, reject);
      };
      eventWaiters.add(listener);
    });
  };
  return {
    entered,
    profilePromise,
    completion,
    destination,
    stagePath: () => stagePath,
    completionSettled: () => completionSettled,
    destinationMutations: () => destinationMutations,
    negativeAckAttempts: () => negativeAckAttempts,
    negativeAckDelivered: () => negativeAckDelivered,
    coherentRebindMessages: () => coherentRebindMessages,
    gateReleased: () => released,
    events: () => observationEvents.map((event) => ({ ...event })),
    waitForBarrier,
    release: releaseBoundary,
    originalRename,
    originalUnlink,
    originalRmdir,
    originalWriteFile,
    restore() {
      releaseBoundary();
      fs.openSync = originalOpen;
      fs.promises.lstat = originalLstat;
      fs.renameSync = originalRename;
      fs.unlinkSync = originalUnlink;
      fs.writeFileSync = originalWriteFile;
      fs.promises.rename = originalPromiseRename;
      fs.promises.unlink = originalPromiseUnlink;
      ChildProcess.prototype.emit = originalEmit;
      ChildProcess.prototype.send = originalSend;
      if (originalApiBaseUrl === undefined) delete process.env.SOURCE_WATCH_GITHUB_API_BASE_URL;
      else process.env.SOURCE_WATCH_GITHUB_API_BASE_URL = originalApiBaseUrl;
    }
  };
}
function removeInjectedStagePath(stagePath, harness) {
  let stats;
  try { stats = fs.lstatSync(stagePath); }
  catch (caught) { if (caught.code === 'ENOENT') return; throw caught; }
  if (process.platform === 'win32' && stats.isDirectory()) harness.originalRmdir(stagePath);
  else harness.originalUnlink(stagePath);
}

async function assertRejectedStageMutation(episode, mutate, cleanup = () => {}, options = {}) {
  const baseline = ownedTempUsage();
  let workspaceError = null;
  let profileError = null;
  const cleanupState = { injected: false, restore: null, claimId: null };
  try {
    await withOwnedWorkspace(ownedSpec(episode, options.abortController ? { signal: options.abortController.signal } : {}), async (lease) => {
    await writeJson(lease, 'workspace', sourceLockRel, activeLock());
    await lease.writeFile('workspace/repo/source-watch/reviews/active-third-party-updates.md', 'prior report');
    try { await withMockGitHub(latestSha, async (apiBaseUrl) => {
      const harness = pausedReportStage(lease, apiBaseUrl, { forceZeroExit: true, ...options });
      let backupPath = null;
      try {
        await waitForTestBarrier(harness, 'staged report async boundary');
        const stagePath = harness.stagePath();
        assert.ok(stagePath);
        const originalPayload = fs.readFileSync(stagePath);
        const originalStats = fs.lstatSync(stagePath, { bigint: true });
        backupPath = stagePath + '.original';
        harness.originalRename(stagePath, backupPath);
        await mutate({ stagePath, originalPayload, backupPath, harness });
        harness.release();
        const outcome = await harness.completion;
        assert.equal(outcome.status, 'rejected', outcome.value && outcome.value.stderr);
        assert.equal(outcome.error.code, 'TEMP_OWNERSHIP_UNCERTAIN');
        profileError = outcome.error;
        assert.equal(harness.negativeAckAttempts(), 1, 'parent identity failure should send one NACK');
        assert.equal(harness.negativeAckDelivered(), 1, 'NACK transport callback success is delivery only');
        assert.equal(harness.coherentRebindMessages(), 1, 'a later coherent report frame was attempted');
        assert.equal(harness.destinationMutations(), 0, 'neither the rejected nor rebound report may mutate the destination');
        assert.equal(fs.readFileSync(harness.destination, 'utf8'), 'prior report');
        if (options.abortOnNegativeAck) {
          const events = harness.events();
          const eventIndex = (type) => events.findIndex((event) => event.type === type);
          assert.ok(eventIndex('negative-ack-attempt') >= 0);
          assert.ok(eventIndex('negative-ack-attempt') < eventIndex('negative-ack-delivered'));
          assert.ok(eventIndex('negative-ack-delivered') < eventIndex('external-abort-after-negative-ack'));
          assert.ok(eventIndex('external-abort-after-negative-ack') < eventIndex('profile-failed'));
          const close = events.find((event) => event.type === 'child-close');
          assert.ok(close, 'the child close event must follow the injected terminal failure');
          assert.equal(close.value[0], 0, 'the child exit callback must report zero after the first profile failure');
        }
        if (fs.existsSync(stagePath)) {
          const replacementStats = fs.lstatSync(stagePath, { bigint: true });
          assert.notDeepEqual(
            { dev: String(replacementStats.dev), ino: String(replacementStats.ino) },
            { dev: String(originalStats.dev), ino: String(originalStats.ino) }
          );
        }
      } finally {
        harness.release();
        const stagePath = harness.stagePath();
        if (stagePath) removeInjectedStagePath(stagePath, harness);
        if (backupPath && fs.existsSync(backupPath)) harness.originalRename(backupPath, stagePath);
        await cleanup({ stagePath, harness });
        harness.restore();
      }
    }); } finally {
    if (options.failCleanupOnDestination && profileError) {
      const record = inspectOwnedTemps().records.find((item) => item.rootPath === lease.root);
      assert.ok(record, 'the public owned-temp claim must remain active before cleanup');
      cleanupState.claimId = record.claimId;
      const originalRmdir = fs.rmdirSync;
      const injectedRmdir = function (directoryPath, ...args) {
        if (!cleanupState.injected && path.resolve(String(directoryPath)) === path.resolve(lease.root)) {
          cleanupState.injected = true;
          throw Object.assign(new Error('injected cleanup failure after source-update profile failure'), { code: 'EIO' });
        }
        return originalRmdir.call(this, directoryPath, ...args);
      };
      fs.rmdirSync = injectedRmdir;
      cleanupState.restore = () => {
        if (fs.rmdirSync === injectedRmdir) fs.rmdirSync = originalRmdir;
      };
    }
    }
  });
  } catch (caught) {
    workspaceError = caught;
  } finally {
    if (cleanupState.restore) cleanupState.restore();
  }
  assert.ok(workspaceError, 'Identity rejection must fail the owned-temp operation.');
  assert.equal(workspaceError.code, 'TEMP_OWNERSHIP_UNCERTAIN', workspaceError.stack);
  assert.strictEqual(workspaceError, profileError, 'the first parent-side causal error must remain primary');
  if (options.failCleanupOnDestination) {
    assert.equal(cleanupState.injected, true);
    assert.equal(workspaceError.cleanupCode, 'TEMP_CLEANUP_INCOMPLETE');
    assert.equal(workspaceError.cleanupStatus.status, 'CLEANUP_INCOMPLETE');
    assert.equal(workspaceError.cleanupStatus.code, 'EIO');
    const cleanupRecord = inspectOwnedTemps().records.find((record) => record.claimId === cleanupState.claimId);
    assert.ok(cleanupRecord && cleanupRecord.rootPath);
    const exitedOwner = spawnSync(process.execPath, ['-p', 'process.pid'], { encoding: 'utf8', windowsHide: true });
    assert.equal(exitedOwner.status, 0, exitedOwner.stderr);
    const exitedPid = Number(exitedOwner.stdout.trim());
    assert.ok(Number.isSafeInteger(exitedPid));
    assert.throws(() => process.kill(exitedPid, 0), (caught) => caught && caught.code === 'ESRCH');
    const claimPath = path.join(path.dirname(path.dirname(cleanupRecord.rootPath)), 'claims', cleanupState.claimId + '.claim.json');
    const claim = JSON.parse(fs.readFileSync(claimPath, 'utf8'));
    claim.process.pid = exitedPid;
    fs.writeFileSync(claimPath, JSON.stringify(claim));
    const recovered = await recoverStaleOwnedTemps();
    assert.equal(recovered.find((record) => record.claimId === cleanupState.claimId).status, 'REMOVED');
  }
  assert.deepEqual(ownedTempUsage(), baseline);
}

test('source-update owner failure survives external abort after NACK delivery and zero child exit', async () => {
  const controller = new AbortController();
  await assertRejectedStageMutation(
    'owned-report-failure-before-external-abort',
    ({ stagePath, harness }) => harness.originalWriteFile(stagePath, 'foreign replacement', 'utf8'),
    () => {},
    { abortController: controller, abortOnNegativeAck: true }
  );
});


test('source-update external abort before a profile failure remains TEMP_ABORTED at the public boundary', async () => {
  const baseline = ownedTempUsage();
  const controller = new AbortController();
  let profileOutcome = null;
  await assert.rejects(withOwnedWorkspace(ownedSpec('owned-report-external-abort-first', { signal: controller.signal }), async (lease) => {
    await writeJson(lease, 'workspace', sourceLockRel, activeLock());
    await lease.writeFile('workspace/repo/source-watch/reviews/active-third-party-updates.md', 'prior report');
    await withMockGitHub(latestSha, async (apiBaseUrl) => {
      const harness = pausedReportStage(lease, apiBaseUrl);
      try {
        await waitForTestBarrier(harness, 'staged report async boundary');
        assert.equal(harness.completionSettled(), false, 'the profile has no terminal failure before the external abort');
        controller.abort('external abort before source-update profile failure');
        harness.release();
        profileOutcome = await harness.completion;
        assert.equal(profileOutcome.status, 'rejected');
        assert.notEqual(profileOutcome.error.code, 'TEMP_OWNERSHIP_UNCERTAIN');
        assert.equal(harness.destinationMutations(), 0);
        assert.equal(fs.readFileSync(harness.destination, 'utf8'), 'prior report');
      } finally {
        harness.release();
        await harness.completion;
        const stagePath = harness.stagePath();
        if (stagePath) removeInjectedStagePath(stagePath, harness);
        harness.restore();
      }
    });
  }), (caught) => caught && caught.code === 'TEMP_ABORTED');
  assert.equal(profileOutcome.status, 'rejected');
  assert.notEqual(profileOutcome.error.code, 'TEMP_OWNERSHIP_UNCERTAIN');
  assert.deepEqual(ownedTempUsage(), baseline);
});

test('source-update profile failure remains primary when owned-root cleanup is incomplete', async () => {
  await assertRejectedStageMutation(
    'owned-report-profile-failure-cleanup-incomplete',
    ({ stagePath, harness }) => harness.originalWriteFile(stagePath, 'foreign replacement', 'utf8'),
    () => {},
    { failCleanupOnDestination: true }
  );
});

test('staged identity observer surfaces a profile failure before the lstat barrier promptly', async () => {
  const baseline = ownedTempUsage();
  let observed = null;
  await assert.rejects(withOwnedWorkspace(ownedSpec('owned-report-observer-early-failure'), async (lease) => {
    await writeJson(lease, 'workspace', sourceLockRel, activeLock());
    await withMockGitHub(latestSha, async (apiBaseUrl) => {
      const harness = pausedReportStage(lease, apiBaseUrl);
      try {
        const startedAt = Date.now();

        await assert.rejects(waitForTestBarrier(harness, 'staged report async boundary'), (caught) => {
          observed = caught;
          return caught.code === 'TEMP_CHILD_FAILED';
        });
        assert.ok(Date.now() - startedAt < 5000, 'observer should not wait for the 60-second barrier timeout');
        const outcome = await harness.completion;
        assert.equal(outcome.status, 'rejected');
        assert.strictEqual(outcome.error, observed);
        assert.equal(harness.events().some((event) => event.type === 'barrier'), false);
      } finally {
        harness.release();
        await harness.completion;
        harness.restore();
      }
    }, 500);
  }), (caught) => {
    assert.strictEqual(caught, observed);
    return caught.code === 'TEMP_CHILD_FAILED';
  });
  assert.deepEqual(ownedTempUsage(), baseline);
});
test('staged identity observer handles an already-settled raw profile failure promptly', async () => {
  const baseline = ownedTempUsage();
  let rawFailure = null;
  await assert.rejects(withOwnedWorkspace(ownedSpec('owned-report-observer-already-settled'), async (lease) => {
    await writeJson(lease, 'workspace', sourceLockRel, activeLock());
    await withMockGitHub(latestSha, async (apiBaseUrl) => {
      const harness = pausedReportStage(lease, apiBaseUrl);
      try {

        await assert.rejects(harness.profilePromise, (caught) => {
          rawFailure = caught;
          return caught.code === 'TEMP_CHILD_FAILED';
        });
        const startedAt = Date.now();
        await assert.rejects(waitForTestBarrier(harness, 'staged report async boundary'), (caught) => caught === rawFailure);
        assert.ok(Date.now() - startedAt < 1000);
        assert.equal(harness.events().some((event) => event.type === 'barrier'), false);
      } finally {
        harness.release();
        await harness.completion;
        harness.restore();
      }
    }, 500);
  }), (caught) => {
    assert.strictEqual(caught, rawFailure);
    return caught.code === 'TEMP_CHILD_FAILED';
  });
  assert.deepEqual(ownedTempUsage(), baseline);
});
test('staged identity observer releases its broker gate after child termination and preserves the first failure', async () => {
  const baseline = ownedTempUsage();
  let terminalFailure = null;
  await assert.rejects(withOwnedWorkspace(ownedSpec('owned-report-observer-terminal-during-gate'), async (lease) => {
    await writeJson(lease, 'workspace', sourceLockRel, activeLock());
    await lease.writeFile('workspace/repo/source-watch/reviews/active-third-party-updates.md', 'prior report');
    await withMockGitHub(latestSha, async (apiBaseUrl) => {
      const harness = pausedReportStage(lease, apiBaseUrl);
      try {
        await waitForTestBarrier(harness, 'staged report async boundary');
        const row = inspectOwnedTemps().records.find((record) => record.rootPath === lease.root);
        const leasePath = path.join(path.dirname(path.dirname(lease.root)), 'claims', row.claimId + '.lease.json');
        const liveLease = JSON.parse(fs.readFileSync(leasePath, 'utf8'));
        assert.equal(liveLease.owned_children.length, 1);
        process.kill(liveLease.owned_children[0].pid, 'SIGTERM');
        const outcome = await harness.completion;
        assert.equal(outcome.status, 'rejected');
        terminalFailure = outcome.error;
        assert.equal(outcome.error.code, 'TEMP_CHILD_DISCONNECTED_BEFORE_ACK');
        assert.equal(harness.gateReleased(), true);
        assert.equal(harness.destinationMutations(), 1);
        const events = harness.events();
        const barrierEvent = events.find((event) => event.type === 'barrier');
        const terminalEvent = events.find((event) => event.type === 'child-disconnect' || event.type === 'child-close');
        assert.ok(barrierEvent && terminalEvent);
        assert.ok(barrierEvent.order < terminalEvent.order);
        assert.notEqual(fs.readFileSync(harness.destination, 'utf8'), 'prior report');
        const settledLease = JSON.parse(fs.readFileSync(leasePath, 'utf8'));
        assert.deepEqual(settledLease.owned_children, []);
      } finally {
        harness.release();
        await harness.completion;
        harness.restore();
      }
    });
  }), (caught) => {
    assert.strictEqual(caught, terminalFailure);
    return caught.code === 'TEMP_CHILD_DISCONNECTED_BEFORE_ACK';
  });
  assert.deepEqual(ownedTempUsage(), baseline);
});
test('owned report broker preserves staged identity across an async boundary and waits for parent write completion', async () => {
  await withOwnedWorkspace(ownedSpec('owned-report-stage-identity-preserved'), async (lease) => {
    await writeJson(lease, 'workspace', sourceLockRel, activeLock());
    await lease.writeFile('workspace/repo/source-watch/reviews/active-third-party-updates.md', 'prior report');
    await withMockGitHub(latestSha, async (apiBaseUrl) => {
      const harness = pausedReportStage(lease, apiBaseUrl);
      try {
        await waitForTestBarrier(harness, 'staged report async boundary');
        assert.equal(harness.completionSettled(), false);
        assert.ok(fs.existsSync(harness.stagePath()));
        const row = inspectOwnedTemps().records.find((record) => record.rootPath === lease.root);
        const leasePath = path.join(path.dirname(path.dirname(lease.root)), 'claims', row.claimId + '.lease.json');
        assert.equal(JSON.parse(fs.readFileSync(leasePath, 'utf8')).owned_children.length, 1);
        harness.release();
        const outcome = await harness.completion;
        assert.equal(outcome.status, 'resolved', outcome.error && outcome.error.message);
        assert.equal(outcome.value.code, 0, outcome.value.stderr);
        assert.equal(harness.destinationMutations(), 1);
        assert.notEqual(fs.readFileSync(harness.destination, 'utf8'), 'prior report');
      } finally {
        harness.release();
        harness.restore();
      }
    });
  });
});

test('owned report broker rejects a replaced staged file before parent commit with no direct-write fallback', async () => {
  await assertRejectedStageMutation('owned-report-stage-replaced', ({ stagePath, harness }) => {
    harness.originalWriteFile(stagePath, 'foreign replacement', 'utf8');
  });
});

test('owned report broker rejects a removed staged file before parent commit', async () => {
  await assertRejectedStageMutation('owned-report-stage-removed', () => {});
});

test('owned report broker rejects same-path same-payload replacement identity before parent commit', async () => {
  await assertRejectedStageMutation('owned-report-stage-identical-replacement', ({ stagePath, originalPayload, harness }) => {
    harness.originalWriteFile(stagePath, originalPayload);
  });
});

test('owned report broker waits for parent REMOVE_REPORT completion before success', async () => {
  await withOwnedWorkspace(ownedSpec('owned-report-remove-completion'), async (lease) => {
    await writeJson(lease, 'workspace', sourceLockRel, activeLock(lockedSha));
    await lease.writeFile('workspace/repo/source-watch/reviews/active-third-party-updates.md', 'prior report');
    await withMockGitHub(lockedSha, async (apiBaseUrl) => {
      const originalLstat = fs.promises.lstat;
      const destination = lease.path('workspace/repo/source-watch/reviews/active-third-party-updates.md');
      let enteredResolve;
      let releaseResolve;
      let entered = false;
      let settled = false;
      let released = false;
      const boundary = new Promise((resolve) => { enteredResolve = resolve; });
      const gate = new Promise((resolve) => { releaseResolve = () => { if (!released) { released = true; resolve(); } }; });
      fs.promises.lstat = async function (filePath, ...args) {
        if (!entered && path.resolve(String(filePath)) === path.resolve(destination)) {
          entered = true;
          enteredResolve();
          await gate;
        }
        return originalLstat.call(this, filePath, ...args);
      };
      const completion = runScript(lease, 'workspace', apiBaseUrl).then(
        (value) => { settled = true; return { status: 'resolved', value }; },
        (error) => { settled = true; return { status: 'rejected', error }; }
      );
      try {
        await waitForTestBarrier(boundary, 'parent REMOVE_REPORT async boundary');
        assert.equal(settled, false);
        const row = inspectOwnedTemps().records.find((record) => record.rootPath === lease.root);
        const leasePath = path.join(path.dirname(path.dirname(lease.root)), 'claims', row.claimId + '.lease.json');
        assert.equal(JSON.parse(fs.readFileSync(leasePath, 'utf8')).owned_children.length, 1);
        assert.equal(fs.readFileSync(destination, 'utf8'), 'prior report');
        releaseResolve();
        const outcome = await completion;
        assert.equal(outcome.status, 'resolved', outcome.error && outcome.error.message);
        assert.equal(outcome.value.code, 0, outcome.value.stderr);
        assert.equal(fs.existsSync(destination), false);
      } finally {
        releaseResolve();
        fs.promises.lstat = originalLstat;
      }
    });
  });
});

test('owned report broker rejects redirected staged resources before parent commit', async (t) => {
  let foreignPath = null;
  if (process.platform === 'win32') {
    const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'w2a-report-link-probe-'));
    const target = path.join(probeRoot, 'target');
    const link = path.join(probeRoot, 'link');
    try {
      fs.mkdirSync(target);
      try { fs.symlinkSync(target, link, 'junction'); }
      catch (caught) {
        if (['EPERM', 'EACCES', 'ENOTSUP'].includes(caught.code)) {
          t.skip('This Windows owner context cannot create the junction needed for the redirection fault injection.');
          return;
        }
        throw caught;
      }
    } finally {
      if (fs.existsSync(link)) fs.rmdirSync(link);
      if (fs.existsSync(target)) fs.rmdirSync(target);
      if (fs.existsSync(probeRoot)) fs.rmdirSync(probeRoot);
    }
  }
  await assertRejectedStageMutation('owned-report-stage-redirected', ({ stagePath, harness }) => {
    foreignPath = stagePath + '.foreign';
    if (process.platform === 'win32') {
      fs.mkdirSync(foreignPath);
      harness.originalWriteFile(path.join(foreignPath, 'foreign.txt'), 'foreign resource', 'utf8');
      fs.symlinkSync(foreignPath, stagePath, 'junction');
    } else {
      harness.originalWriteFile(foreignPath, 'foreign resource', 'utf8');
      fs.symlinkSync(foreignPath, stagePath);
    }
  }, ({ harness }) => {
    if (!foreignPath) return;
    if (process.platform === 'win32') {
      const foreignFile = path.join(foreignPath, 'foreign.txt');
      if (fs.existsSync(foreignFile)) harness.originalUnlink(foreignFile);
      if (fs.existsSync(foreignPath)) harness.originalRmdir(foreignPath);
    } else if (fs.existsSync(foreignPath)) harness.originalUnlink(foreignPath);
    foreignPath = null;
  });
});
test('standalone source-update CLI retains caller-selected report behavior', async () => {
  await withWorkspace('source-update-standalone', async (lease, workspace) => {
    await writeJson(lease, workspace, sourceLockRel, activeLock());
    await withMockGitHub(latestSha, async (apiBaseUrl) => {
      const result = await runStandaloneScript([
        scriptPath, '--workspace', lease.path(workspace), '--report', 'standalone-review.md'
      ], {
        encoding: 'utf8',
        windowsHide: true,
        env: { ...process.env, SOURCE_WATCH_GITHUB_API_BASE_URL: apiBaseUrl, GITHUB_TOKEN: '' }
      });
      assert.equal(result.status, 0, result.stderr);
      assert.ok(result.stdout.includes('Wrote standalone-review.md'));
      const report = fs.readFileSync(lease.path(path.join(workspace, 'standalone-review.md')), 'utf8');
      assert.ok(report.includes('This PR is a review notification only.'));
    });
  });
});

test('low capacity refuses before source-update fixture construction', async () => {
  const baseline = ownedTempUsage();
  const original = fs.statfsSync;
  let fixtureConstructed = false;
  fs.statfsSync = () => ({ bavail: 0n, bsize: 1n });
  try {
    await assert.rejects(
      withOwnedTemp(ownedSpec('source-update-low-space'), async (lease) => {
        fixtureConstructed = true;
        await lease.mkdir('workspace');
        await writeJson(lease, 'workspace', sourceLockRel, activeLock());
      }),
      (error) => error && error.code === 'TEMP_CAPACITY_LOW'
    );
  } finally {
    fs.statfsSync = original;
  }
  assert.equal(fixtureConstructed, false);
  assert.deepEqual(ownedTempUsage(), baseline);
});

test('canonical source-watch provenance with no upstream drift produces no report', async () => {
  await withWorkspace('source-update-no-drift', async (lease, workspace) => {
    await writeJson(lease, workspace, sourceLockRel, activeLock());
    await withMockGitHub(lockedSha, async (apiBaseUrl, requests) => {
      const result = await runScript(lease, workspace, apiBaseUrl);
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /no actionable updates found/i);
      assert.equal(fs.existsSync(lease.path(path.join(workspace, 'repo/source-watch/reviews/active-third-party-updates.md'))), false);
      assert.deepEqual(requests, ['/repos/example-owner/example-repo/commits/main']);
    });
  });
});

test('upstream drift produces a review-only notification without changing the lock', async () => {
  await withWorkspace('source-update-drift', async (lease, workspace) => {
    const lockPath = path.join(workspace, sourceLockRel);
    await writeJson(lease, workspace, sourceLockRel, activeLock());
    const before = fs.readFileSync(lease.path(lockPath), 'utf8');
    await withMockGitHub(latestSha, async (apiBaseUrl) => {
      const result = await runScript(lease, workspace, apiBaseUrl);
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /PR needed: yes/);
    });
    const report = fs.readFileSync(lease.path(path.join(workspace, 'repo/source-watch/reviews/active-third-party-updates.md')), 'utf8');
    assert.match(report, /This PR is a review notification only\./);
    assert.match(report, /No SOURCE-LOCK pins were changed\./);
    assert.match(report, /No upstream code was executed\./);
    assert.match(report, new RegExp('Adopted commit: .' + lockedSha));
    assert.match(report, new RegExp('Latest observed commit: .' + latestSha));
    assert.equal(fs.readFileSync(lease.path(lockPath), 'utf8'), before);
  });
});

test('human reviewed-through cursor suppresses an already reviewed upstream commit', async () => {
  await withWorkspace('source-update-reviewed-cursor', async (lease, workspace) => {
    await writeJson(lease, workspace, sourceLockRel, activeLock());
    await writeJson(lease, workspace, 'repo/source-watch/review-state.json', reviewStateDoc(latestSha));
    await withMockGitHub(latestSha, async (apiBaseUrl) => {
      const result = await runScript(lease, workspace, apiBaseUrl);
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /no actionable updates found/i);
    });
  });
});

test('retired migration provenance is ignored and never queried upstream', async () => {
  await withWorkspace('source-update-retired-provenance', async (lease, workspace) => {
    await writeJson(lease, workspace, 'repo/source-watch/provenance/retired/SOURCE-LOCK.json', retiredLock());
    await withMockGitHub(latestSha, async (apiBaseUrl, requests) => {
      const result = await runScript(lease, workspace, apiBaseUrl);
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /No active third-party source update candidates found/);
      assert.deepEqual(requests, []);
    });
  });
});

test('invalid active source-watch metadata fails closed before any upstream request', async () => {
  const baseline = ownedTempUsage();
  await assert.rejects(withWorkspace('source-update-invalid-metadata', async (lease, workspace) => {
    const invalid = activeLock();
    invalid.source_update_policy = 'none';
    await writeJson(lease, workspace, sourceLockRel, invalid);
    await withMockGitHub(latestSha, async (apiBaseUrl, requests) => {
      const result = await runScript(lease, workspace, apiBaseUrl);
      assert.notEqual(result.code, 0);
      assert.match(result.stderr, /Unsupported SOURCE-LOCK lifecycle metadata/);
      assert.deepEqual(requests, []);
    });
  }), (caught) => {
    assert.equal(caught.code, 'TEMP_CHILD_FAILED');
    assert.match(caught.stderr, /Unsupported SOURCE-LOCK lifecycle metadata/);
    return true;
  });
  assert.deepEqual(ownedTempUsage(), baseline);
});
test('review-state source-lock identities bind to canonical provenance paths', () => {
  const record = reviewState.validateRecord(reviewStateDoc(latestSha).records[0], 0);
  assert.equal(record.target_key, 'source-lock:' + sourceProjectRel);
  assert.equal(record.source_lock_path, sourceLockRel);
});
