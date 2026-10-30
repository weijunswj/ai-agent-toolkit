'use strict';

// Acquisition before projection, at the Windows Credential Manager boundary. Listing key names
// runs CredEnumerate in a PowerShell child, which loads whole credential records (value included)
// inside that child and returns only TargetName. These tests prove a synthetic marker value never
// crosses the child's output boundary: not on stdout or stderr, not in an error message, not in
// the returned names, also when the child answers with a malformed, partial or failing response.
// The claim stops at the subprocess output; it says nothing about Credential Manager internals.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { WindowsCredentialStore } = require('../scripts/toolkit-env-store.cjs');

function marker() { return `x4-marker-${crypto.randomBytes(12).toString('hex')}`; }

function assertAbsent(text, value, context) {
  for (const piece of [value, value.slice(10), Buffer.from(value).toString('base64'), Buffer.from(value).toString('hex')]) {
    assert.ok(!String(text).includes(piece), `${context}: the marker value crossed the boundary`);
  }
}

// A spawn stand-in that answers like a child process.
function answering(stdout, { status = 0, stderr = '', error } = {}) {
  return () => ({ status, stdout, stderr, error });
}

function thrown(fn) {
  try { fn(); } catch (error) { return error; }
  assert.fail('expected an error');
}

test('names-only listing: the names-only listing returns names only, through a real Credential Manager child', { skip: process.platform !== 'win32' && 'Windows only' }, (t) => {
  const prefix = `ai-agent-toolkit-test/${crypto.randomBytes(6).toString('hex')}`;
  const value = marker();
  const outputs = [];
  // A loaded CI runner can start the child slower than the store's 30 s limit: the test allows 120 s; the store keeps 30 s.
  const slow = (command, args, options) => spawnSync(command, args, { ...options, timeout: 120000 });
  const recording = (command, args, options) => {
    const result = slow(command, args, options);
    outputs.push({ ops: String(options.input || ''), stdout: String(result.stdout || ''), stderr: String(result.stderr || '') });
    return result;
  };
  const store = new WindowsCredentialStore({ prefix, spawn: slow });
  t.after(() => { for (const name of store.list()) store.remove(name); });
  store.writeAll(new Map([['X4_TEST_MARKER', value]]));
  const listing = new WindowsCredentialStore({ prefix, spawn: recording });
  const names = listing.list();
  assert.deepEqual(names, ['X4_TEST_MARKER']);
  assert.equal(outputs.length, 1);
  assert.match(outputs[0].ops, /"op":"list"/);
  assertAbsent(outputs[0].stdout, value, 'child stdout');
  assertAbsent(outputs[0].stderr, value, 'child stderr');
  assertAbsent(JSON.stringify(names), value, 'returned names');
});

test('names-only listing: malformed, partial and failing child answers never carry the value onward', () => {
  const value = marker();
  const store = (spawn) => new WindowsCredentialStore({ prefix: 'ai-agent-toolkit-test/x4', spawn });
  const cases = [
    ['malformed stdout quoting the value', answering(`{"ok":true,"answers":[{"code":0,"targets":["${value}"`)],
    ['failing child with the value on stderr', answering('{"ok":false}', { status: 3, stderr: `CredEnumerate failed near ${value}` })],
    ['wrong answer count', answering(JSON.stringify({ ok: true, answers: [] }))],
    ['child not found', answering('', { status: null, error: Object.assign(new Error(`spawn ${value} ENOENT`), { code: 'ENOENT' }) })],
    ['error code with the value in a field', answering(JSON.stringify({ ok: true, answers: [{ code: 5, detail: value }] }))],
  ];
  for (const [label, spawn] of cases) {
    const error = thrown(() => store(spawn).list());
    assertAbsent(`${error.message} ${error.code} ${error.stack}`, value, label);
  }
});

test('names-only listing: whole records or extra fields in a child answer are dropped, never returned', () => {
  const value = marker();
  const prefix = 'ai-agent-toolkit-test/x4';
  const answer = {
    ok: true,
    answers: [{
      code: 0,
      targets: [
        `${prefix}/X4_TEST_KEPT`,
        { TargetName: `${prefix}/X4_TEST_RECORD`, CredentialBlob: value },
        `${prefix}/${value}`,
        `other-prefix/X4_TEST_OTHER`,
      ],
      blob: value,
    }],
  };
  const names = new WindowsCredentialStore({ prefix, spawn: answering(JSON.stringify(answer)) }).list();
  assert.deepEqual(names, ['X4_TEST_KEPT']);
  assertAbsent(JSON.stringify(names), value, 'returned names');
  const missing = new WindowsCredentialStore({ prefix, spawn: answering(JSON.stringify({ ok: true, answers: [{ code: 0 }] })) }).list();
  assert.deepEqual(missing, [], 'a missing targets field lists nothing');
});
