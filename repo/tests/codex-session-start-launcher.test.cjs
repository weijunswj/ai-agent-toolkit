'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const setup = require('../scripts/setup-codex-toolkit-plugin.cjs');
const launcher = require('../scripts/toolkit-codex-session-start.cjs');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-session-start-'));
}

function writeFile(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, 'utf8');
}

function copyFile(relPath, pluginRoot) {
  const target = path.join(pluginRoot, ...relPath.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, ...relPath.split('/')), target);
}

function createPluginFixture(root, bridgeText) {
  const pluginRoot = path.join(root, 'plugin root with spaces & brackets [safe]', 'ai-agent-toolkit');
  copyFile(setup.SESSION_START_LAUNCHER_REL_PATH, pluginRoot);
  copyFile(setup.SESSION_START_POWERSHELL_REL_PATH, pluginRoot);
  writeFile(path.join(pluginRoot, '.codex-plugin', 'hooks', 'hooks.json'), `${JSON.stringify({
    hooks: {
      SessionStart: [{
        matcher: 'startup|resume|clear|compact',
        hooks: [{ type: 'command', command: setup.sourceSessionStartCommand() }]
      }]
    }
  }, null, 2)}\n`);
  writeFile(path.join(pluginRoot, 'repo', 'scripts', 'toolkit-local-bridge.cjs'), bridgeText);
  setup.prepareInstalledSessionStart(pluginRoot);
  return pluginRoot;
}

function runWindowsHook(pluginRoot, input = '') {
  return spawnSync(setup.windowsSessionStartCommand(), [], {
    cwd: repoRoot,
    env: { ...process.env, PATH: '', PLUGIN_ROOT: pluginRoot },
    input,
    encoding: 'utf8',
    shell: true,
    timeout: 30000,
    windowsHide: true,
  });
}

function captureLauncherWarning(bridge) {
  const lines = [];
  const original = console.log;
  console.log = (line) => lines.push(String(line));
  try {
    assert.equal(launcher.main(launcher.HOOK_ARGS, { bridge }), 0);
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}

test('hook-safe Node launcher converts thrown and returned non-zero outcomes to one visible skip', () => {
  const thrown = captureLauncherWarning({ run() { throw new Error('private path must not escape'); } });
  const returned = captureLauncherWarning({ run() { return { status: 9 }; } });
  for (const output of [thrown, returned]) {
    assert.equal(output, launcher.WARNING);
    assert.doesNotMatch(output, /private path|Users[\\/]|\.env|token/i);
  }
});

test('manual bridge command retains a non-zero exit for an equivalent explicit configuration failure', () => {
  const root = tmpRoot();
  const result = spawnSync(process.execPath, [
    path.join(repoRoot, 'repo', 'scripts', 'toolkit-local-bridge.cjs'),
    '--enable-repo-auto-update', '--write', '--hub', path.join(root, 'hub', 'current')
  ], {
    env: { ...process.env, HOME: root, USERPROFILE: root },
    encoding: 'utf8',
    timeout: 30000,
    windowsHide: true,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires --repo-path/);
});

test('Windows launcher uses exact Node metadata, preserves stdin and output, and handles metacharacter paths', { skip: process.platform !== 'win32' }, () => {
  const root = tmpRoot();
  const pluginRoot = createPluginFixture(root, [
    "'use strict';",
    "const fs = require('node:fs');",
    "exports.run = (args) => { console.log('bridge args=' + args.join(' ') + '; stdin=' + fs.readFileSync(0, 'utf8')); return { status: 0 }; };",
    '',
  ].join('\n'));
  const result = runWindowsHook(pluginRoot, '{"source":"startup"}');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /bridge args=--hook --sync-enabled --write --sync-source codex-plugin; stdin=\{"source":"startup"\}/);
  assert.equal(result.stderr, '');
});

test('Windows launcher reports an unavailable Node runtime without a red exit or private path', { skip: process.platform !== 'win32' }, () => {
  const root = tmpRoot();
  const pluginRoot = createPluginFixture(root, "'use strict';\nexports.run = () => ({ status: 0 });\n");
  const runtimePath = path.join(pluginRoot, ...setup.SESSION_START_RUNTIME_REL_PATH.split('/'));
  fs.writeFileSync(runtimePath, `${JSON.stringify({ schema: 1, node_path: path.join(root, 'missing-node.exe') }, null, 2)}\n`);
  const result = runWindowsHook(pluginRoot);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), launcher.WARNING);
  assert.doesNotMatch(result.stdout, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
});

test('Windows launcher rejects unsupported runtime metadata and relative Node paths safely', { skip: process.platform !== 'win32' }, () => {
  const root = tmpRoot();
  const pluginRoot = createPluginFixture(root, "'use strict';\nexports.run = () => ({ status: 0 });\n");
  const runtimePath = path.join(pluginRoot, ...setup.SESSION_START_RUNTIME_REL_PATH.split('/'));
  for (const runtime of [
    { schema: 2, node_path: process.execPath },
    { schema: 1, node_path: 'node.exe' },
  ]) {
    fs.writeFileSync(runtimePath, `${JSON.stringify(runtime, null, 2)}\n`);
    const result = runWindowsHook(pluginRoot);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stdout.trim(), launcher.WARNING);
  }
});

test('old bare-node command reproduces a pre-JavaScript red exit when Node is absent from PATH', { skip: process.platform !== 'win32' }, () => {
  const oldCommand = 'node "${PLUGIN_ROOT}/repo/scripts/toolkit-local-bridge.cjs" --hook --sync-enabled --write --sync-source codex-plugin';
  const result = spawnSync(oldCommand, [], {
    cwd: repoRoot,
    env: { ...process.env, PATH: '', PLUGIN_ROOT: repoRoot },
    encoding: 'utf8',
    shell: true,
    timeout: 30000,
    windowsHide: true,
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /node.*not recognized/i);
});

test('near-concurrent hook launchers permit at most one protected mutation and leave no lock residue', async () => {
  const root = tmpRoot();
  const pluginRoot = createPluginFixture(root, [
    "'use strict';",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    'exports.run = () => {',
    '  const lock = path.join(process.env.TEST_HUB, "update.lock");',
    '  const mutation = path.join(process.env.TEST_HUB, "mutation.log");',
    '  fs.mkdirSync(process.env.TEST_HUB, { recursive: true });',
    '  let fd;',
    '  try { fd = fs.openSync(lock, "wx"); } catch (error) { if (error.code === "EEXIST") { console.log("safe live-lock skip"); return { status: 0 }; } throw error; }',
    '  try { fs.appendFileSync(mutation, "write\\n"); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400); }',
    '  finally { fs.closeSync(fd); fs.rmSync(lock, { force: true }); }',
    '  return { status: 0 };',
    '};',
    '',
  ].join('\n'));
  const scriptPath = path.join(pluginRoot, ...setup.SESSION_START_LAUNCHER_REL_PATH.split('/'));
  const hub = path.join(root, 'hub');
  const runOne = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...launcher.HOOK_ARGS], {
      env: { ...process.env, TEST_HUB: hub, PLUGIN_ROOT: pluginRoot },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (status) => resolve({ status, stdout, stderr }));
  });
  const results = await Promise.all([runOne(), runOne()]);
  for (const result of results) assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.readFileSync(path.join(hub, 'mutation.log'), 'utf8'), 'write\n');
  assert.equal(fs.existsSync(path.join(hub, 'update.lock')), false);
  assert.deepEqual(fs.readdirSync(hub).filter((name) => /recovery|staging|displaced/i.test(name)), []);
});
