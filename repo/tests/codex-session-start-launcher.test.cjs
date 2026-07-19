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
  const pluginRoot = path.join(root, "plugin root with spaces & brackets [safe] (quoted 'path') $dollar `tick", 'ai-agent-toolkit');
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

function createRealBridgePluginFixture(root) {
  const pluginRoot = path.join(root, 'real bridge plugin');
  for (const relPath of [
    setup.SESSION_START_LAUNCHER_REL_PATH,
    setup.SESSION_START_POWERSHELL_REL_PATH,
    'repo/scripts/toolkit-local-bridge.cjs',
    'repo/scripts/setup-codex-toolkit-plugin.cjs',
    'repo/scripts/repair-codex-plugin-windows-hooks.cjs',
    'repo/scripts/audit-n8n-skills-plugin-hooks.cjs',
    'repo/scripts/toolkit-staging-generations.cjs',
  ]) copyFile(relPath, pluginRoot);
  writeFile(path.join(pluginRoot, '.codex-plugin', 'hooks', 'hooks.json'), `${JSON.stringify({
    hooks: {
      SessionStart: [{
        matcher: 'startup|resume|clear|compact',
        hooks: [{ type: 'command', command: setup.sourceSessionStartCommand() }]
      }]
    }
  }, null, 2)}\n`);
  setup.prepareInstalledSessionStart(pluginRoot);
  return pluginRoot;
}

function runWindowsHook(pluginRoot, input = '', extraEnv = {}) {
  const powershellPath = path.join(
    process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows',
    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'
  );
  const command = setup.windowsSessionStartCommand(powershellPath);
  return spawnSync(powershellPath, ['-NoProfile', '-NonInteractive', '-Command', command], {
    cwd: repoRoot,
    env: { ...process.env, PATH: '', PLUGIN_ROOT: pluginRoot, ...extraEnv },
    input,
    encoding: 'utf8',
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

test('hook-safe Node launcher suppresses prior bridge output when maintenance later fails', () => {
  const output = captureLauncherWarning({
    run() {
      console.log('private preflight path C:\\Users\\Example\\project');
      console.error('private diagnostic');
      throw new Error('later failure');
    }
  });
  assert.equal(output, launcher.WARNING);
  assert.doesNotMatch(output, /private|Users|diagnostic|later failure/i);
});

test('hook-safe Node launcher captures dependency-load output before a load failure', () => {
  const dependencies = {};
  Object.defineProperty(dependencies, 'bridge', {
    get() {
      console.error('private module-load diagnostic');
      throw new Error('module load failed');
    }
  });
  const lines = [];
  const original = console.log;
  console.log = (line) => lines.push(String(line));
  try {
    assert.equal(launcher.main(launcher.HOOK_ARGS, dependencies), 0);
  } finally {
    console.log = original;
  }
  const output = lines.join('\n');
  assert.equal(output, launcher.WARNING);
  assert.doesNotMatch(output, /private|module-load|load failed/i);
});

test('hook-safe Node launcher replays bridge stdout and stderr only after success', () => {
  const stdout = [];
  const stderr = [];
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  process.stdout.write = (chunk) => { stdout.push(String(chunk)); return true; };
  process.stderr.write = (chunk) => { stderr.push(String(chunk)); return true; };
  try {
    assert.equal(launcher.main(launcher.HOOK_ARGS, {
      bridge: {
        run() {
          console.log('bridge success');
          console.error('bridge warning');
          return { status: 0 };
        }
      }
    }), 0);
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }
  assert.equal(stdout.join(''), 'bridge success\n');
  assert.equal(stderr.join(''), 'bridge warning\n');
});

test('hook-safe Node launcher fails closed when bridge output exceeds the capture ceiling', () => {
  const output = captureLauncherWarning({
    run() {
      process.stdout.write('x'.repeat(launcher.MAX_CAPTURE_BYTES + 1));
      return { status: 0 };
    }
  });
  assert.equal(output, launcher.WARNING);
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

test('Windows installed command uses a direct script-file boundary without nested command text', () => {
  const command = setup.windowsSessionStartCommand("C:\\Program Files\\Power's $hell `tick\\powershell.exe");
  assert.equal(command, "& 'C:\\Program Files\\Power''s $hell `tick\\powershell.exe' -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"$env:PLUGIN_ROOT/repo/scripts/toolkit-codex-session-start.ps1\"");
  assert.doesNotMatch(command, /\$\{PLUGIN_ROOT\}|(?:^|\s)-Command(?:\s|$)|&\s*\{/i);
  assert.doesNotMatch(command, /\.sh(?:["\s]|$)|(?:^|[\\/])code(?:\.exe)?(?:["\s]|$)/i);
});

test('Codex Desktop Windows host shape reaches the wrapper and Node launcher without file association', { skip: process.platform !== 'win32' }, () => {
  const root = tmpRoot();
  const sentinelDir = path.join(root, 'sentinel commands');
  const codeSentinel = path.join(root, 'code-launched.txt');
  writeFile(path.join(sentinelDir, 'code.cmd'), '@echo launched>"%CODE_SENTINEL%"\r\n');
  const pluginRoot = createPluginFixture(root, [
    "'use strict';",
    "const fs = require('node:fs');",
    "exports.run = (args) => { console.log('node launcher entered; payload=' + JSON.stringify({ argv: process.argv.slice(1), args, stdin: fs.readFileSync(0, 'utf8') })); return { status: 0 }; };",
    '',
  ].join('\n'));
  const result = runWindowsHook(pluginRoot, '{"source":"codex-desktop"}', {
    PATH: sentinelDir,
    CODE_SENTINEL: codeSentinel,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout.match(/node launcher entered; payload=(\{.*\})/)[1]);
  assert.equal(payload.argv[0], path.join(pluginRoot, setup.SESSION_START_LAUNCHER_REL_PATH));
  assert.deepEqual(payload.argv.slice(1), ['--hook', '--sync-enabled', '--write', '--sync-source', 'codex-plugin']);
  assert.deepEqual(payload.args, ['--hook', '--sync-enabled', '--write', '--sync-source', 'codex-plugin']);
  assert.equal(payload.stdin, '{"source":"codex-desktop"}');
  assert.equal(fs.existsSync(codeSentinel), false, 'Toolkit SessionStart must not launch VS Code');
});

test('Codex Desktop Windows host shape preserves optional-maintenance non-fatal exit behavior', { skip: process.platform !== 'win32' }, () => {
  const root = tmpRoot();
  const pluginRoot = createPluginFixture(root, "'use strict';\nexports.run = () => ({ status: 9 });\n");
  const result = runWindowsHook(pluginRoot, '{"source":"startup"}');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), launcher.WARNING);
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

test('near-concurrent launchers execute the real bridge safely in an isolated home', async () => {
  const root = tmpRoot();
  const pluginRoot = createRealBridgePluginFixture(root);
  const scriptPath = path.join(pluginRoot, ...setup.SESSION_START_LAUNCHER_REL_PATH.split('/'));
  const runOne = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...launcher.HOOK_ARGS], {
      cwd: root,
      env: { ...process.env, HOME: root, USERPROFILE: root, PLUGIN_ROOT: pluginRoot },
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
  for (const result of results) {
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /SessionStart skipped optional maintenance/i);
  }
  const toolkitHome = path.join(root, '.ai-agent-toolkit');
  if (fs.existsSync(toolkitHome)) {
    assert.deepEqual(fs.readdirSync(toolkitHome).filter((name) => /update\.lock|recovery|staging|displaced/i.test(name)), []);
  }
});
