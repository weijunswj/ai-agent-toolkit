'use strict';

// The real OS stores with throwaway dummy values only, each under a test-only prefix or keychain
// that is removed afterwards. Windows runs on Windows, macOS on macOS; the Linux "no keyring" stop
// runs everywhere. Every call is recorded so the tests can check no value is ever an argument.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  LinuxSecretServiceStore, MacKeychainStore, WindowsCredentialStore, storeForPlatform,
} = require('../scripts/toolkit-env-store.cjs');

const STORE_SCRIPT = path.resolve(__dirname, '..', 'scripts', 'toolkit-env-store.cjs');
// The variables Codex leaves for an MCP header helper on Windows (its core list).
// (codex-rs/protocol/src/shell_environment.rs WINDOWS_CORE_ENV_VARS at rust-v0.163.0)
const CODEX_WINDOWS_CORE = ['PATH', 'PATHEXT', 'SHELL', 'COMSPEC', 'SYSTEMROOT', 'WINDIR', 'SYSTEMDRIVE', 'USERNAME', 'USERDOMAIN', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMW6432', 'PROGRAMDATA', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP', 'TMPDIR', 'POWERSHELL', 'PWSH'];

function dummy() { return `dummy-${crypto.randomBytes(9).toString('hex')}`; }

// spawnSync that records every argument list.
function recordingSpawn(calls) {
  return (command, args, options) => {
    calls.push([command, ...args].join(' '));
    return spawnSync(command, args, options);
  };
}

function exercise(store, calls) {
  const one = dummy();
  const two = `ünïcode "quoted" back\\slash ${dummy()}`;
  const three = `two\nlines ${dummy()}`;
  store.writeAll(new Map([['X1_TEST_STORE_ONE', one], ['X1_TEST_STORE_TWO', two], ['X1_TEST_STORE_THREE', three]]));
  const back = store.readAll(['X1_TEST_STORE_ONE', 'X1_TEST_STORE_TWO', 'X1_TEST_STORE_THREE', 'X1_TEST_STORE_ABSENT']);
  assert.equal(back.get('X1_TEST_STORE_ONE'), one);
  assert.equal(back.get('X1_TEST_STORE_TWO'), two);
  assert.equal(back.get('X1_TEST_STORE_THREE'), three);
  assert.equal(store.remove('X1_TEST_STORE_THREE'), true);
  assert.equal(back.has('X1_TEST_STORE_ABSENT'), false);
  assert.deepEqual(store.list(), ['X1_TEST_STORE_ONE', 'X1_TEST_STORE_TWO']);
  const longest = 'x'.repeat(2560);
  store.writeAll(new Map([['X1_TEST_STORE_LONG', longest]]));
  assert.equal(store.read('X1_TEST_STORE_LONG'), longest);
  assert.throws(() => store.writeAll(new Map([['X1_TEST_STORE_LONG', 'x'.repeat(2561)]])), /value too long \(max 2560 bytes\)/);
  for (const name of ['X1_TEST_STORE_ONE', 'X1_TEST_STORE_TWO', 'X1_TEST_STORE_LONG']) assert.equal(store.remove(name), true);
  assert.equal(store.remove('X1_TEST_STORE_ONE'), false);
  assert.equal(store.read('X1_TEST_STORE_ONE'), undefined);
  assert.deepEqual(store.list(), []);
  for (const call of calls) {
    assert.ok(!call.includes(one.slice(6)) && !call.includes(three.slice(10)), 'a value was passed as an argument');
    assert.ok(!call.includes(Buffer.from(one).toString('hex')), 'a value was passed as an argument (hex)');
  }
}

test('Windows Credential Manager: write, read, list, size limit, delete, nothing left behind', { skip: process.platform !== 'win32' && 'Windows only' }, (t) => {
  const prefix = `ai-agent-toolkit-test/${crypto.randomBytes(6).toString('hex')}`;
  const calls = [];
  const store = new WindowsCredentialStore({ prefix, spawn: recordingSpawn(calls) });
  t.after(() => { for (const name of store.list()) store.remove(name); });
  assert.equal(store.backend, 'Windows Credential Manager');
  exercise(store, calls);
  const listed = spawnSync('cmdkey', ['/list'], { encoding: 'utf8' });
  assert.doesNotMatch(String(listed.stdout), new RegExp(prefix.replace('/', '\\/')));
});

test('Windows Credential Manager works with only the variables Codex gives a header helper', { skip: process.platform !== 'win32' && 'Windows only' }, (t) => {
  const prefix = `ai-agent-toolkit-test/${crypto.randomBytes(6).toString('hex')}`;
  const value = dummy();
  const driver = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-env-store-'));
  t.after(() => {
    for (const name of new WindowsCredentialStore({ prefix }).list()) new WindowsCredentialStore({ prefix }).remove(name);
    fs.rmSync(driver, { recursive: true, force: true });
  });
  new WindowsCredentialStore({ prefix }).writeAll(new Map([['X1_TEST_STORE_CORE', value]]));
  const script = path.join(driver, 'read.cjs');
  fs.writeFileSync(script, `const { WindowsCredentialStore } = require(${JSON.stringify(STORE_SCRIPT)});\nprocess.stdout.write(new WindowsCredentialStore({ prefix: ${JSON.stringify(prefix)} }).read('X1_TEST_STORE_CORE') === ${JSON.stringify(value)} ? 'same' : 'different');\n`);
  const env = {};
  for (const name of CODEX_WINDOWS_CORE) if (process.env[name]) env[name] = process.env[name];
  // Codex allows its helper 10 seconds; the time is reported, since shared CI hosts are slower
  // than a desktop. The check here is that the store works with only these variables.
  const started = Date.now();
  const result = spawnSync(process.execPath, [script], { env, encoding: 'utf8', timeout: 60000 });
  t.diagnostic(`read with only Codex's variables took ${Date.now() - started} ms`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'same');
});

test('macOS Keychain: a throwaway keychain, values only through stdin and stdout', { skip: process.platform !== 'darwin' && 'macOS only' }, (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-env-keychain-'));
  const keychain = path.join(folder, 'toolkit-env-test.keychain-db');
  const password = crypto.randomBytes(12).toString('hex');
  assert.equal(spawnSync('/usr/bin/security', ['create-keychain', '-p', password, keychain]).status, 0);
  t.after(() => {
    spawnSync('/usr/bin/security', ['delete-keychain', keychain]);
    fs.rmSync(folder, { recursive: true, force: true });
  });
  assert.equal(spawnSync('/usr/bin/security', ['unlock-keychain', '-p', password, keychain]).status, 0);
  const calls = [];
  const store = new MacKeychainStore({ keychain, spawn: recordingSpawn(calls) });
  assert.equal(store.backend, 'macOS Keychain');
  exercise(store, calls);
});

test('Linux without a keyring stops with a plain message and no fallback file', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-env-linux-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const store = new LinuxSecretServiceStore({ secretTool: path.join(home, 'no-such-secret-tool') });
  assert.equal(store.backend, 'Linux Secret Service');
  for (const action of [() => store.list(), () => store.read('X1_TEST_STORE_ONE'), () => store.writeAll(new Map([['X1_TEST_STORE_ONE', dummy()]]))]) {
    assert.throws(action, (error) => error.code === 'backend-unavailable' && /no desktop keyring \(Secret Service\).*does not fall back to a plain file/.test(error.message));
  }
  assert.deepEqual(fs.readdirSync(home), []);
  const noDbus = new LinuxSecretServiceStore({ spawn: () => ({ status: 1, stdout: '', stderr: 'Cannot autolaunch D-Bus without X11 $DISPLAY' }) });
  assert.throws(() => noDbus.list(), /no desktop keyring/);
});

test('each operating system gets exactly its own store', () => {
  assert.equal(storeForPlatform('win32').backend, 'Windows Credential Manager');
  assert.equal(storeForPlatform('darwin').backend, 'macOS Keychain');
  assert.equal(storeForPlatform('linux').backend, 'Linux Secret Service');
  assert.throws(() => storeForPlatform('aix'), /no store for aix/);
});
