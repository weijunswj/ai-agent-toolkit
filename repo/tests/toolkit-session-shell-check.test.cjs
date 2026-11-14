'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const hold = require('../scripts/toolkit-merge-hold.cjs');
const gate = require('../scripts/toolkit-governance-gate.cjs');
const { makeGoverned, recordAbsent } = require('./toolkit-governed-fixture-support.cjs');

const script = path.resolve(__dirname, '../scripts/toolkit-session-shell-check.cjs');
const source = fs.readFileSync(script, 'utf8');

for (const [name, env, present, equal] of [
  ['absent', {}, false, false],
  ['absent Toolkit entry with comparison id', { CLAUDE_CODE_SESSION_ID: 'fixture-comparison-only' }, false, false],
  ['empty Toolkit entry', { TOOLKIT_HOST_SESSION: '', CLAUDE_CODE_SESSION_ID: 'fixture-comparison' }, true, false],
  ['both entries empty', { TOOLKIT_HOST_SESSION: '', CLAUDE_CODE_SESSION_ID: '' }, true, false],
  ['matching', { TOOLKIT_HOST_SESSION: 'fixture-match', CLAUDE_CODE_SESSION_ID: 'fixture-match' }, true, true],
  ['mismatching', { TOOLKIT_HOST_SESSION: 'fixture-toolkit', CLAUDE_CODE_SESSION_ID: 'fixture-comparison' }, true, false],
  ['missing comparison id', { TOOLKIT_HOST_SESSION: 'fixture-toolkit-only' }, true, false],
  ['empty comparison id', { TOOLKIT_HOST_SESSION: 'fixture-toolkit', CLAUDE_CODE_SESSION_ID: '' }, true, false],
]) test(`shell check: ${name} prints exactly two booleans without leaking values`, () => {
  const result = spawnSync(process.execPath, [script], { env, encoding: 'utf8', timeout: 5000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, `${JSON.stringify({ present, equal })}\n`);
  for (const value of Object.values(env).filter(Boolean)) assert.ok(!result.stdout.includes(value));
});

test('extra arguments exit unsuccessfully before even accessing the environment', () => {
  for (const args of [['--help'], ['fixture-id'], [''], ['one', 'two']]) {
    const exited = new Error('fixture exit');
    let reads = 0;
    const writes = [];
    const processStub = {
      argv: ['node', script, ...args],
      get env() { reads += 1; throw new Error('environment must not be accessed'); },
      exit(code) { assert.equal(code, 1); throw exited; },
      stdout: { write: text => writes.push(text) },
    };
    assert.throws(() => vm.runInNewContext(source, { process: processStub }), error => error === exited);
    assert.equal(reads, 0);
    assert.deepEqual(writes, []);
    const result = spawnSync(process.execPath, [script, ...args], { env: {}, encoding: 'utf8', timeout: 5000, windowsHide: true });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  }
});

test('the check reads only the two allowed environment entries', () => {
  const keys = ['TOOLKIT_HOST_SESSION', 'CLAUDE_CODE_SESSION_ID'];
  const reads = [];
  const writes = [];
  const env = new Proxy({ TOOLKIT_HOST_SESSION: 'fixture', CLAUDE_CODE_SESSION_ID: 'fixture' }, {
    get(target, key) { assert.ok(keys.includes(key)); reads.push(key); return target[key]; },
    getOwnPropertyDescriptor(target, key) { assert.equal(key, keys[0]); return Object.getOwnPropertyDescriptor(target, key); },
    ownKeys() { assert.fail('the check must not enumerate the environment'); },
  });
  vm.runInNewContext(source, { process: { argv: ['node', script], env, stdout: { write: text => writes.push(text) } } });
  assert.deepEqual(reads, keys);
  assert.deepEqual(writes, ['{"present":true,"equal":true}\n']);
});

test('the shell check has zero imports and explains that it grants nothing', () => {
  assert.doesNotMatch(source, /\brequire\b|\bimport\b/);
  assert.match(source, /This check grants no permission or authority/);
});

test('the exact absolute shell check passes existing merge and governance decisions on both hosts and shells', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-shell-check-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const cwd = makeGoverned(path.join(root, 'repo'), 'shell-check', { home });
  const registryOptions = { registryPath: path.join(home, '.ai-agent-toolkit/user-state/repository-governance.v1.json'), testOnly: true, home };
  const environment = {};
  gate.startSession({ cwd, session_id: 'fixture-session', source: 'startup' }, { registryOptions, environment });
  // Model an installed root in the governed fixture, without naming this checkout's real state.
  const installedScript = path.join(cwd, 'repo/scripts/toolkit-session-shell-check.cjs');
  const command = `node "${installedScript.replace(/\\/g, '/')}"`;
  for (const host of ['claude', 'codex']) for (const tool_name of ['Bash', 'PowerShell']) {
    const input = { cwd, session_id: 'fixture-session', tool_name, tool_input: { command } };
    assert.equal(hold.decide(input, { registryOptions, environment, host }), null, `${host} ${tool_name}: merge hold`);
    assert.equal(new gate.ToolGate({ registryOptions }).decide(input), null, `${host} ${tool_name}: governance gate`);
  }
});

test('the absolute shell check in a separate installed repository runs whether that repository is enabled or undecided', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-installed-shell-check-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const cwd = makeGoverned(path.join(root, 'work'), 'shell-check-work', { home });
  const registryOptions = { registryPath: path.join(home, '.ai-agent-toolkit/user-state/repository-governance.v1.json'), testOnly: true, home };
  const environment = {};
  gate.startSession({ cwd, session_id: 'fixture-session', source: 'startup' }, { registryOptions, environment });
  for (const enabled of [true, false]) {
    const installed = makeGoverned(path.join(root, enabled ? 'installed-enabled' : 'installed-undecided'), `shell-check-installed-${enabled}`, { home, enable: enabled });
    if (!enabled) recordAbsent(installed, { home });
    const installedScript = path.join(installed, 'repo/scripts/toolkit-session-shell-check.cjs');
    fs.mkdirSync(path.dirname(installedScript), { recursive: true });
    fs.copyFileSync(script, installedScript);
    const command = `node "${installedScript.replace(/\\/g, '/')}"`;
    for (const host of ['claude', 'codex']) for (const tool_name of ['Bash', 'PowerShell']) {
      const input = { cwd, session_id: 'fixture-session', tool_name, tool_input: { command } };
      assert.equal(hold.decide(input, { registryOptions, environment, host }), null, `${host} ${tool_name}: merge hold`);
      const result = new gate.ToolGate({ registryOptions }).decide(input);
      assert.equal(result, null, `${host} ${tool_name}: ${enabled ? 'enabled' : 'undecided'} installed repository`);
    }
  }
});
