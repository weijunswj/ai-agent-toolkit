'use strict';
require('./toolkit-test-temp-guard.cjs');

// Named-build and bounded-shutdown checks own isolated fake homes; no live Codex is started.
// Split from the install-state suite to keep the Windows file within its measured time budget.
const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CodexToolkitInstall, pluginBundleFingerprint, expectedToolkitHooks, launchCheck } = require('../scripts/toolkit-codex-install-state.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');
const HOOKS = fs.readFileSync(path.join(repoRoot, '.codex-plugin', 'hooks', 'hooks.json'), 'utf8');
const ID = 'ai-agent-toolkit@ai-agent-toolkit-local';
const KEYS = ['session_start:0:0', 'user_prompt_submit:0:0', 'pre_tool_use:0:0', 'pre_tool_use:1:0', 'post_tool_use:0:0', 'stop:0:0'];
const FAKE = path.join(__dirname, 'support/fake-codex-hooks-list.cjs');
const SCRIPT = path.join(repoRoot, 'repo/scripts/toolkit-codex-install-state.cjs');
const cacheRoot = f => path.join(f.codexHome, 'plugins/cache/ai-agent-toolkit-local/ai-agent-toolkit', f.read().version);
const calls = f => {
  const log = path.join(f.codexHome, 'fake-hooks-list.log');
  return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split(/\r?\n/) : [];
};
function trustedReply(f, edit = () => {}) {
  const fingerprint = pluginBundleFingerprint(cacheRoot(f));
  const result = { data: [{ hooks: expectedToolkitHooks(cacheRoot(f)).map(hook => ({
    key: hook.key, pluginId: ID, enabled: true, trustStatus: 'trusted',
    currentHash: `sha256:${'b'.repeat(64)}/${fingerprint}`,
  })) }] };
  edit(result, result.data[0].hooks);
  return result;
}
function runCheck(f, spec = { result: trustedReply(f) }, { unavailable = false, args = ['--check'], env: overrides = {} } = {}) {
  write(path.join(f.codexHome, 'fake-hooks-list.json'), JSON.stringify(spec));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(path|codex_home|codex_cli_path|codex_toolkit_codex_cli)$/i.test(key)));
  const emptyPath = path.join(f.root, 'empty-path');
  fs.mkdirSync(emptyPath, { recursive: true });
  Object.assign(env, { PATH: emptyPath, CODEX_HOME: f.codexHome,
    CODEX_TOOLKIT_CODEX_CLI: unavailable ? path.join(emptyPath, 'no-codex.exe') : FAKE, ...overrides });
  const result = childProcess.spawnSync(process.execPath, [SCRIPT, ...args], { env, encoding: 'utf8', timeout: 30000, windowsHide: true });
  assert.ifError(result.error);
  return { ...result, calls: calls(f) };
}
const passed = r => r.status === 0 && r.stdout.replace(/\r?\n$/, '') === `All ${KEYS.length} Toolkit hooks are on in Codex.`;

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

// This suite needs only the all-approved file state; other install states stay in the reader suite.
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-codex-launch-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const codexHome = path.join(root, '.codex');
  const cache = path.join(codexHome, 'plugins/cache/ai-agent-toolkit-local/ai-agent-toolkit/3.19.3');
  write(path.join(cache, '.codex-plugin/plugin.json'), JSON.stringify({ name: 'ai-agent-toolkit', version: '3.19.3' }));
  write(path.join(cache, '.codex-plugin/hooks/hooks.json'), HOOKS);
  const fingerprint = pluginBundleFingerprint(cache);
  const hooks = KEYS.map(key => `[hooks.state."${ID}:.codex-plugin/hooks/hooks.json:${key}"]\ntrusted_hash = "sha256:${'b'.repeat(64)}"\ntrusted_content_hash = "${fingerprint}"\n`).join('\n');
  write(path.join(codexHome, 'config.toml'), `[plugins."${ID}"]\nenabled = true\n\n[hooks.state]\n\n${hooks}`);
  return { root, codexHome, read: () => new CodexToolkitInstall({ codexHome }).read() };
}

// Each fake owns its pids. Always stop keepers before the fixture's working folder is removed,
// including on a failed assertion or a deliberately simulated failed production shutdown.
function stopFakes(f) {
  for (const line of calls(f).filter(line => /^(pid|keeper) \d+$/.test(line))) {
    try { process.kill(Number(line.split(' ')[1]), 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
}
const keeperPid = f => Number(calls(f).find(line => line.startsWith('keeper '))?.split(' ')[1]);

test('AT16c: an answer already received is kept when Codex cannot be stopped; no answer still holds', async t => {
  for (const mode of ['answer-orphan', 'answer-stay', 'hang-orphan', 'write-caller']) await t.test(mode, async t => {
    const f = fixture(t);
    write(path.join(f.codexHome, 'fake-hooks-list.json'), JSON.stringify({ mode: mode === 'write-caller' ? 'answer-orphan' : mode, result: trustedReply(f) }));
    const started = Date.now();
    try {
      if (mode === 'write-caller') {
        const { runAppServerRequest } = require('../scripts/codex-app-server.cjs');
        await assert.rejects(runAppServerRequest(FAKE, f.codexHome, { method: 'hooks/list', params: {} },
          { cwd: f.codexHome, timeoutMs: 5000, closeTimeoutMs: 200, forceExitTimeoutMs: 200, direct: true }),
        error => error.reason === 'stuck' && /did not exit after bounded process-tree termination/.test(error.message));
      } else {
        const r = await launchCheck({ codexHome: f.codexHome, codex: FAKE, timeoutMs: 500 });
        assert.equal(r.code, mode === 'hang-orphan' ? 1 : 0, r.line);
        assert.match(r.line, mode === 'hang-orphan' ? /\(timeout\)/ : /^All 6 Toolkit hooks are on in Codex\.$/);
      }
      assert.ok(Date.now() - started < 10000, mode);
      if (mode !== 'answer-stay') { assert.ok(keeperPid(f)); assert.doesNotThrow(() => process.kill(keeperPid(f), 0)); }
    } finally { stopFakes(f); }
  });
});

function npmShim(f, folder = 'npm bin') {
  const bin = path.join(f.root, folder);
  const script = path.join(bin, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  write(script, `require(${JSON.stringify(FAKE)});\n`);
  write(path.join(bin, 'node_modules', '@openai', 'codex', 'package.json'), '{"type":"commonjs"}');
  const shim = path.join(bin, 'codex.cmd');
  write(shim, '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n');
  return shim;
}

test('AT21: --check asks only the named Codex (--codex, else CODEX_TOOLKIT_CODEX_CLI) and holds when none is named', t => {
  const f = fixture(t);
  const bin = path.join(f.root, 'npm bin');
  if (process.platform === 'win32') npmShim(f);
  else { const script = path.join(bin, 'codex'); write(script, `#!${process.execPath}\nrequire(${JSON.stringify(FAKE)});\n`); fs.chmodSync(script, 0o755); }
  let r = runCheck(f, undefined, { env: { CODEX_TOOLKIT_CODEX_CLI: '', CODEX_CLI_PATH: FAKE, PATH: bin } });
  assert.equal(r.status, 1); assert.match(r.stdout, /No Codex was named/);
  assert.match(r.stdout, /--codex/); assert.match(r.stdout, /CODEX_TOOLKIT_CODEX_CLI/); assert.deepEqual(r.calls, []);
  const missing = path.join(f.root, 'missing', 'codex.exe');
  for (const [codex, reason] of [[missing, '(not found)'], ['codex', '(not a full path)']]) {
    r = runCheck(f, undefined, { args: ['--check', '--codex', codex] });
    assert.equal(r.status, 1); assert.ok(r.stdout.includes(reason), r.stdout); assert.deepEqual(r.calls, []);
  }
  const unsupported = path.join(f.root, process.platform === 'win32' ? 'other.cmd' : 'not-executable');
  write(unsupported, process.platform === 'win32' ? '@echo off\r\nset\r\n' : '#!/bin/sh\nexit 0\n');
  if (process.platform !== 'win32') fs.chmodSync(unsupported, 0o644);
  r = runCheck(f, undefined, { args: ['--check', '--codex', unsupported] });
  assert.equal(r.status, 1); assert.match(r.stdout, /\(cannot be started directly\)/); assert.deepEqual(r.calls, []);
  assert.equal(passed(runCheck(f, undefined, { args: ['--check', '--codex', FAKE], env: { CODEX_TOOLKIT_CODEX_CLI: missing } })), true);
  // Two builds share one home but disagree on trust. The chosen build alone decides the hold.
  const builds = ['a', 'b'].map(name => {
    const spec = path.join(f.root, `${name}.json`); const log = path.join(f.root, `${name}.log`); const script = path.join(f.root, `${name}.cjs`);
    write(spec, JSON.stringify({ result: trustedReply(f, (r, hooks) => { if (name === 'b') hooks.forEach(hook => { hook.trustStatus = 'modified'; }); }) }));
    write(script, `process.env.FAKE_HOOKS_LIST_SPEC=${JSON.stringify(spec)};\nprocess.env.FAKE_HOOKS_LIST_LOG=${JSON.stringify(log)};\nrequire(${JSON.stringify(FAKE)});\n`);
    return { script, log };
  });
  assert.equal(passed(runCheck(f, undefined, { args: ['--check', '--codex', builds[0].script] })), true);
  r = runCheck(f, undefined, { args: ['--check', '--codex', builds[1].script] });
  assert.equal(r.status, 1); assert.match(r.stdout, /does not trust/);
  write(builds[0].log, ''); write(builds[1].log, '');
  r = runCheck(f, undefined, { args: ['--check', '--codex', builds[1].script], env: { CODEX_TOOLKIT_CODEX_CLI: builds[0].script } });
  assert.equal(r.status, 1); assert.match(r.stdout, /does not trust/);
  assert.equal(fs.readFileSync(builds[0].log, 'utf8'), ''); assert.match(fs.readFileSync(builds[1].log, 'utf8'), /method hooks\/list/);
  const contract = fs.readFileSync(path.join(repoRoot, 'repo/docs/HOST-CONTRACT.md'), 'utf8');
  for (const text of ['--check --codex "<codex>"', 'CODEX_TOOLKIT_CODEX_CLI', 'it never picks a Codex by itself']) assert.ok(contract.includes(text), text);
});

// An async guard kills a stalled check rather than letting its inherited pipes stall the suite.
function boundedCheck(f, args) {
  return new Promise((resolve, reject) => {
    const started = Date.now(); let stdout = ''; let stderr = ''; let guarded = false;
    const child = childProcess.spawn(process.execPath, args, { env: { ...process.env, CODEX_HOME: f.codexHome, CODEX_TOOLKIT_CODEX_CLI: FAKE }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    const timer = setTimeout(() => { guarded = true; child.kill('SIGKILL'); child.stdout.destroy(); child.stderr.destroy(); }, 45000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', status => { clearTimeout(timer); resolve({ status, stdout, stderr, guarded, seconds: (Date.now() - started) / 1000 }); });
  });
}

test('AT22: --check ends within its bound when Codex cannot be stopped, with or without an answer', async t => {
  const results = await Promise.allSettled(['answer-orphan', 'hang-orphan'].map(async mode => {
    const f = fixture(t);
    write(path.join(f.codexHome, 'fake-hooks-list.json'), JSON.stringify({ mode, result: trustedReply(f) }));
    const harness = `require(${JSON.stringify(SCRIPT)}).launchCheck({codexHome:process.env.CODEX_HOME,codex:process.env.CODEX_TOOLKIT_CODEX_CLI,timeoutMs:500}).then(r=>{console.log(r.line);process.exitCode=r.code;});`;
    try {
      const r = await boundedCheck(f, mode === 'answer-orphan' ? [SCRIPT, '--check'] : ['-e', harness]);
      assert.equal(r.guarded, false, `${mode}: 45 s guard fired`);
      assert.equal(r.status, mode === 'answer-orphan' ? 0 : 1, r.stdout + r.stderr);
      assert.ok(r.seconds < 10, `${mode}: ${r.seconds} s`);
      assert.match(r.stdout, mode === 'answer-orphan' ? /^All 6 Toolkit hooks are on in Codex\.\r?\n$/ : /\(timeout\)/);
      assert.ok(keeperPid(f)); assert.doesNotThrow(() => process.kill(keeperPid(f), 0));
    } finally { stopFakes(f); }
  }));
  // Even a failed control must wait for the other guarded command and its cleanup before t.after.
  for (const result of results) if (result.status === 'rejected') throw result.reason;
});

test('AT23: --check takes only --check, optionally followed by --codex <path>', t => {
  const f = fixture(t);
  for (const args of [[], ['--codex', FAKE, '--check'], ['--check', '--codex'], ['--check', '--codex', ''],
    ['--check', '--codex', FAKE, '--codex', FAKE], ['--check', 'extra'], ['--check', '--codex=' + FAKE]]) {
    const r = runCheck(f, undefined, { args });
    assert.equal(r.status, 2, JSON.stringify(args)); assert.equal(r.stdout, ''); assert.match(r.stderr, /^Usage:/); assert.deepEqual(r.calls, []);
  }
  for (const args of [['--check'], ['--check', '--codex', FAKE]]) assert.equal(passed(runCheck(f, undefined, { args })), true, JSON.stringify(args));
});

test('AT24: a named npm codex.cmd runs the script it wraps with no shell, even in a folder whose name holds cmd characters', { skip: process.platform !== 'win32' && 'Windows only' }, t => {
  const f = fixture(t);
  const shim = npmShim(f, 'npm & %PATH% (x86) bin');
  const r = runCheck(f, undefined, { args: ['--check', '--codex', shim] });
  assert.equal(passed(r), true, r.stdout + r.stderr);
  assert.equal(r.calls.filter(line => !line.startsWith('pid '))[0], 'argv app-server --listen stdio://');
});
