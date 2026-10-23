#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { resolvePathExecutable } = require('./claude-process-launch.cjs');
const { TOOLKIT_VERSION } = require('./toolkit-version.cjs');

const TOOLKIT_PLUGIN_NAME = 'ai-agent-toolkit';
const TOOLKIT_MARKETPLACE_NAME = 'ai-agent-toolkit-local';
const EXPECTED_TOOLKIT_VERSION = TOOLKIT_VERSION;
const MARKETPLACE_REL_PATH = '.agents/plugins/marketplace.json';
const SESSION_START_LAUNCHER_REL_PATH = 'repo/scripts/toolkit-codex-session-start.cjs';
const SESSION_START_POWERSHELL_REL_PATH = 'repo/scripts/toolkit-codex-session-start.ps1';
const SESSION_START_RUNTIME_REL_PATH = '.codex-plugin/session-start-runtime.json';
const HELPER_HOOK_REL_PATH = 'repo/scripts/toolkit-codex-helper-hook.cjs';
const HELPER_HOOK_POWERSHELL_REL_PATH = 'repo/scripts/toolkit-codex-helper-hook.ps1';
const SESSION_START_ARGS = ['--hook', '--sync-enabled', '--write', '--sync-source', 'codex-plugin'];
// Real `codex plugin list --json --available` catalogues exceed spawnSync's 1 MiB default (~3 MiB observed).
const CODEX_JSON_MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const CACHE_FINGERPRINT_PATHS = [
  "repo/contracts/toolkit-local-bridge/version.json",
  "repo/scripts/toolkit-version.cjs",
  "repo/scripts/toolkit-antigravity-project-skills.cjs",
  "repo/scripts/toolkit-stack-selection.cjs",
  "repo/scripts/toolkit-claude-task-session.cjs",
  "repo/scripts/toolkit-v3-native-helper-adapter.cjs",
  "repo/scripts/toolkit-v3-helper-guard.cjs",
  "repo/scripts/toolkit-codex-helper-hook.cjs",
  "repo/scripts/toolkit-attribution-guard.cjs",
  "repo/scripts/toolkit-claude-agent-hook.cjs",
  "repo/scripts/toolkit-gate-contract-compiler.cjs",
  "repo/scripts/toolkit-capability-registry.cjs",
  "repo/CONTROLLER.md",
  "repo/ARCHITECTURE.md",
  '.codex-plugin/plugin.json',
  '.codex-plugin/hooks/hooks.json',
  'repo/scripts/codex-delegation-backup.cjs',
  'repo/scripts/codex-delegation-common.cjs',
  'repo/scripts/codex-delegation-config.cjs',
  'repo/scripts/codex-delegation-layout.cjs',
  'repo/scripts/codex-delegation-state.cjs',
  'repo/scripts/setup-toolkit-core.cjs',
  'repo/scripts/setup-toolkit.cjs',
  'repo/scripts/setup-codex-toolkit-plugin.cjs',
  'repo/scripts/repo-ignore-hygiene.cjs',
  'repo/scripts/repo-local-backup.cjs',
  'repo/scripts/toolkit-agent-control.cjs',
  'repo/scripts/claude-process-launch.cjs',
  SESSION_START_LAUNCHER_REL_PATH,
  SESSION_START_POWERSHELL_REL_PATH,
  HELPER_HOOK_POWERSHELL_REL_PATH,
  'repo/scripts/toolkit-local-bridge.cjs',
  'repo/scripts/toolkit-global-rules.cjs',
  'repo/scripts/toolkit-managed-block.cjs',
  'repo/contracts/agent-rules/global-rules.md',
  'repo/contracts/agent-rules/n8n-safety-router-adapter.md',
  'repo/scripts/toolkit-staging-generations.cjs',
  'repo/tests/toolkit-local-bridge-hook-light.test.cjs'
];
const CACHE_FINGERPRINT_DIRS = [
  "repo/contracts/control-plane-kernel",
  "repo/contracts/repository-capability-registry",
  "repo/scripts/toolkit-control-plane",
  "repo/contracts/controller-kernel",
  '.codex-plugin/assets',
  'skills'
];
const WINDOWS_USERPROFILE_CLI_HINT = path.join('%USERPROFILE%', '.codex', 'plugins', '.plugin-appserver', 'codex.exe');
const CODEX_PLUGIN_ICON_SPECS = [
  {
    field: 'composerIcon',
    manifestPath: './.codex-plugin/assets/composer-icon.png',
    relPath: '.codex-plugin/assets/composer-icon.png',
    width: 128,
    height: 128
  },
  {
    field: 'logo',
    manifestPath: './.codex-plugin/assets/logo.png',
    relPath: '.codex-plugin/assets/logo.png',
    width: 512,
    height: 512
  }
];

function slash(value) {
  return String(value || '').replace(/\\/g, '/');
}

function compareSemver(left, right) {
  const leftParts = String(left || '').split('.').map((part) => Number.parseInt(part, 10));
  const rightParts = String(right || '').split('.').map((part) => Number.parseInt(part, 10));
  for (let index = 0; index < 3; index += 1) {
    const leftPart = Number.isFinite(leftParts[index]) ? leftParts[index] : 0;
    const rightPart = Number.isFinite(rightParts[index]) ? rightParts[index] : 0;
    if (leftPart > rightPart) return 1;
    if (leftPart < rightPart) return -1;
  }
  return 0;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function sourceSessionStartCommand() {
  return `node "\${PLUGIN_ROOT}/${SESSION_START_LAUNCHER_REL_PATH}" ${SESSION_START_ARGS.join(' ')}`;
}

function defaultWindowsPowerShellPath() {
  const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows';
  return path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

function sourceHelperHookCommand() {
  return `node "\${PLUGIN_ROOT}/${HELPER_HOOK_REL_PATH}"`;
}

// The Windows-only hook command (Codex's commandWindows). The full powershell.exe path is written without
// quotes and the script runs through -File, so the same text works in cmd.exe and PowerShell and neither
// shell looks for node or powershell in the opened folder. Codex replaces ${PLUGIN_ROOT} before the shell
// sees the command. A PowerShell path with spaces or quotes cannot be written this way, so setup stops.
function windowsHookCommand(scriptRelPath, powershellPath = defaultWindowsPowerShellPath()) {
  const value = String(powershellPath);
  if (!path.win32.isAbsolute(value) || /[\s"'&|<>^%]/.test(value)) {
    throw new Error(`Toolkit can only write a Windows hook command for a PowerShell path without spaces or special characters: ${value}`);
  }
  return `${value} -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "\${PLUGIN_ROOT}/${scriptRelPath}"`;
}

function windowsSessionStartCommand(powershellPath = defaultWindowsPowerShellPath()) {
  return windowsHookCommand(SESSION_START_POWERSHELL_REL_PATH, powershellPath);
}

function windowsHelperHookCommand(powershellPath = defaultWindowsPowerShellPath()) {
  return windowsHookCommand(HELPER_HOOK_POWERSHELL_REL_PATH, powershellPath);
}

// The installed copy keeps the portable command and adds commandWindows to both Toolkit hooks.
function renderInstalledWindowsHooks(hooks, powershellPath) {
  const rendered = structuredClone(hooks);
  rendered.hooks.SessionStart[0].hooks[0].commandWindows = windowsSessionStartCommand(powershellPath);
  rendered.hooks.PreToolUse[0].hooks[0].commandWindows = windowsHelperHookCommand(powershellPath);
  return rendered;
}

// The source shape of the installed hooks: the same file with every commandWindows removed.
function withoutWindowsCommands(hooks) {
  const plain = structuredClone(hooks);
  for (const groups of Object.values(plain.hooks || {})) {
    for (const group of Array.isArray(groups) ? groups : []) {
      for (const hook of group?.hooks || []) delete hook.commandWindows;
    }
  }
  return plain;
}

function writeFileAtomically(filePath, bytes) {
  const tempPath = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    fs.writeFileSync(tempPath, bytes, { mode: 0o600 });
    fs.renameSync(tempPath, filePath);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

function pngSize(filePath) {
  const buffer = fs.readFileSync(filePath);
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const validSignature = signature.every((byte, index) => buffer[index] === byte);
  if (!validSignature || buffer.toString('ascii', 12, 16) !== 'IHDR') return null;
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function repoRootFromScript() {
  return path.resolve(__dirname, '..', '..');
}

function defaultCodexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

function marketplacePath(repoRoot) {
  return path.join(repoRoot, ...MARKETPLACE_REL_PATH.split('/'));
}

function validateRepoPluginSource(repoRoot, expectedVersion = EXPECTED_TOOLKIT_VERSION) {
  const errors = [];
  const manifestPath = path.join(repoRoot, '.codex-plugin', 'plugin.json');
  const hooksPath = path.join(repoRoot, '.codex-plugin', 'hooks', 'hooks.json');
  const localMarketplacePath = marketplacePath(repoRoot);

  if (!fs.existsSync(manifestPath)) {
    errors.push(`Missing Codex plugin manifest: ${slash(path.relative(repoRoot, manifestPath))}`);
  } else {
    const manifest = readJson(manifestPath);
    if (manifest.name !== TOOLKIT_PLUGIN_NAME) {
      errors.push(`Codex plugin manifest name must be ${TOOLKIT_PLUGIN_NAME}: ${manifest.name || '<missing>'}`);
    }
    if (manifest.version !== expectedVersion) {
      errors.push(`Codex plugin manifest expected version ${expectedVersion}: ${manifest.version || '<missing>'}`);
    }
    if (manifest.hooks !== './.codex-plugin/hooks/hooks.json') {
      errors.push(`Codex plugin manifest must reference .codex-plugin hooks: ${manifest.hooks || '<missing>'}`);
    }
    for (const icon of CODEX_PLUGIN_ICON_SPECS) {
      const actualPath = manifest.interface?.[icon.field] || '';
      if (actualPath !== icon.manifestPath) {
        errors.push(`Codex plugin manifest interface.${icon.field} must be ${icon.manifestPath}: ${actualPath || '<missing>'}`);
        continue;
      }
      const assetPath = path.join(repoRoot, ...icon.relPath.split('/'));
      if (!fs.existsSync(assetPath)) {
        errors.push(`Codex plugin manifest interface.${icon.field} references missing asset: ${icon.manifestPath}`);
        continue;
      }
      const size = pngSize(assetPath);
      if (!size) {
        errors.push(`Codex plugin icon asset must be a valid PNG: ${icon.relPath}`);
      } else if (size.width !== icon.width || size.height !== icon.height) {
        errors.push(`Codex plugin icon asset ${icon.relPath} must be ${icon.width}x${icon.height}, found ${size.width}x${size.height}`);
      }
    }
  }

  if (!fs.existsSync(hooksPath)) {
    errors.push(`Missing Codex plugin hooks: ${slash(path.relative(repoRoot, hooksPath))}`);
  } else {
    const hookErrors = verifySessionStartHook(hooksPath);
    errors.push(...hookErrors.map((error) => `${slash(path.relative(repoRoot, hooksPath))}: ${error}`));
  }

  if (!fs.existsSync(localMarketplacePath)) {
    errors.push(`Missing local Codex marketplace wrapper: ${MARKETPLACE_REL_PATH}`);
  } else {
    const marketplace = readJson(localMarketplacePath);
    errors.push(...validateMarketplaceWrapper(marketplace));
  }

  return errors;
}

function validateMarketplaceWrapper(marketplace) {
  const errors = [];
  if (!marketplace || typeof marketplace !== 'object') {
    return ['local marketplace wrapper is not an object'];
  }
  if (marketplace.name !== TOOLKIT_MARKETPLACE_NAME) {
    errors.push(`local marketplace name must be ${TOOLKIT_MARKETPLACE_NAME}: ${marketplace.name || '<missing>'}`);
  }
  const plugins = Array.isArray(marketplace.plugins) ? marketplace.plugins : [];
  const plugin = plugins.find((entry) => entry && entry.name === TOOLKIT_PLUGIN_NAME);
  if (!plugin) {
    errors.push(`local marketplace must expose ${TOOLKIT_PLUGIN_NAME}`);
    return errors;
  }
  if (plugin.source?.source !== 'local' || plugin.source?.path !== '.') {
    errors.push(`${TOOLKIT_PLUGIN_NAME} marketplace source must be local path "."`);
  }
  if (plugin.policy?.installation !== 'AVAILABLE') {
    errors.push(`${TOOLKIT_PLUGIN_NAME} marketplace installation policy must be AVAILABLE`);
  }
  if (plugin.policy?.authentication !== 'ON_USE') {
    errors.push(`${TOOLKIT_PLUGIN_NAME} marketplace policy must use ON_USE authentication`);
  }
  return errors;
}

function verifySessionStartHook(hooksPath, options = {}) {
  const errors = [];
  const hooks = options.hooks || readJson(hooksPath);
  const sessionStart = hooks?.hooks?.SessionStart;
  if (!Array.isArray(sessionStart) || sessionStart.length !== 1) {
    return ['must include a SessionStart hook'];
  }
  if (sessionStart[0]?.matcher !== 'startup|resume|clear|compact') {
    errors.push('SessionStart matcher must support startup, resume, clear, and compact');
  }
  const commands = [];
  for (const group of sessionStart) {
    for (const hook of group?.hooks || []) {
      if (hook?.type === 'command' && typeof hook.command === 'string') commands.push(hook.command);
    }
  }
  if (commands.length !== 1) errors.push('SessionStart must include exactly one command hook');
  const command = commands[0] || '';
  if (command !== sourceSessionStartCommand()) errors.push('SessionStart command must use the exact portable Toolkit launcher shape');
  if (/toolkit-local-bridge\.cjs/.test(command)) errors.push('SessionStart command must not call toolkit-local-bridge.cjs directly');
  const helperHook = hooks?.hooks?.PreToolUse?.[0]?.hooks?.[0];
  if (helperHook?.command !== sourceHelperHookCommand()) errors.push('PreToolUse helper hook must use the exact portable Toolkit command');
  const sessionWindows = sessionStart[0]?.hooks?.[0]?.commandWindows;
  const helperWindows = helperHook?.commandWindows;
  if (options.windows) {
    let expectedSession = '';
    let expectedHelper = '';
    try {
      expectedSession = windowsSessionStartCommand(options.powershellPath);
      expectedHelper = windowsHelperHookCommand(options.powershellPath);
    } catch (error) {
      errors.push(error.message);
    }
    if (sessionWindows !== expectedSession) errors.push('SessionStart commandWindows must use the exact installed Windows launcher shape');
    if (helperWindows !== expectedHelper) errors.push('PreToolUse helper hook commandWindows must use the exact installed Windows launcher shape');
  } else if (sessionWindows !== undefined || helperWindows !== undefined) {
    errors.push('the source hooks must not carry commandWindows; setup adds it to the installed copy only');
  }
  return errors;
}

function verifySessionStartRuntime(cacheRoot, options = {}) {
  if (!(options.platform || process.platform).startsWith('win')) return [];
  const runtimePath = path.join(cacheRoot, ...SESSION_START_RUNTIME_REL_PATH.split('/'));
  if (!fs.existsSync(runtimePath)) return ['installed Windows SessionStart runtime metadata is missing'];
  let runtime;
  try {
    runtime = readJson(runtimePath);
  } catch (error) {
    return [`installed Windows SessionStart runtime metadata is invalid: ${error.message}`];
  }
  const nodePath = String(runtime?.node_path || '');
  if (runtime?.schema !== 1 || !path.isAbsolute(nodePath)) return ['installed Windows SessionStart runtime metadata must contain one absolute Node executable path'];
  try {
    const stat = fs.lstatSync(nodePath);
    if (stat.isSymbolicLink() || !stat.isFile()) return ['installed Windows SessionStart Node executable must be a regular file'];
  } catch {
    return ['installed Windows SessionStart Node executable is unavailable; rerun setup toolkit'];
  }
  const expectedNodePath = options.nodePath || process.execPath;
  if (comparablePath(nodePath) !== comparablePath(expectedNodePath)) {
    return ['installed Windows SessionStart Node executable differs from the current setup runtime; rerun setup toolkit'];
  }
  return [];
}

function prepareInstalledSessionStartIfPresent(options = {}) {
  const cacheRoot = cacheRootFor(options.codexHome || defaultCodexHome(), options.expectedVersion || EXPECTED_TOOLKIT_VERSION);
  const hooksPath = path.join(cacheRoot, '.codex-plugin', 'hooks', 'hooks.json');
  if (!fs.existsSync(hooksPath)) return { changed: false, hooksChanged: false, runtimeChanged: false };
  return prepareInstalledSessionStart(cacheRoot, options);
}

function prepareInstalledSessionStart(cacheRoot, options = {}) {
  if (!(options.platform || process.platform).startsWith('win')) return { changed: false };
  // Codex puts the cache path inside double quotes in commandWindows; $ and ` expand in PowerShell and % in cmd.exe.
  if (/[$`%"]/.test(path.resolve(cacheRoot))) {
    throw new Error('The Codex plugin cache path contains $, `, % or ", which a Windows hook command cannot carry safely; move CODEX_HOME to a plain path.');
  }
  const hooksPath = path.join(cacheRoot, '.codex-plugin', 'hooks', 'hooks.json');
  const nodePath = path.resolve(options.nodePath || process.execPath);
  const powershellPath = path.resolve(options.powershellPath || defaultWindowsPowerShellPath());
  for (const [filePath, label] of [[nodePath, 'Node executable'], [powershellPath, 'Windows PowerShell executable']]) {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label} must be a regular file for Toolkit SessionStart setup.`);
  }
  const plain = withoutWindowsCommands(readJson(hooksPath));
  const sourceErrors = verifySessionStartHook(null, { hooks: plain });
  if (sourceErrors.length) {
    throw new Error(`Installed Toolkit hooks do not match the supported source shape: ${sourceErrors.join('; ')}`);
  }
  const hooks = renderInstalledWindowsHooks(plain, powershellPath);
  const hooksBytes = Buffer.from(`${JSON.stringify(hooks, null, 2)}\n`, 'utf8');
  const runtimePath = path.join(cacheRoot, ...SESSION_START_RUNTIME_REL_PATH.split('/'));
  const runtimeBytes = Buffer.from(`${JSON.stringify({ schema: 1, node_path: nodePath }, null, 2)}\n`, 'utf8');
  const hooksChanged = !fs.readFileSync(hooksPath).equals(hooksBytes);
  const runtimeChanged = !fs.existsSync(runtimePath) || !fs.readFileSync(runtimePath).equals(runtimeBytes);
  const writeAtomic = options.writeFileAtomically || writeFileAtomically;
  if (runtimeChanged) writeAtomic(runtimePath, runtimeBytes);
  const runtimeErrors = verifySessionStartRuntime(cacheRoot, { ...options, platform: 'win32', nodePath });
  if (runtimeErrors.length) throw new Error(runtimeErrors.join('; '));
  if (hooksChanged) writeAtomic(hooksPath, hooksBytes);
  return { changed: hooksChanged || runtimeChanged, hooksChanged, runtimeChanged };
}

function pluginId() {
  return `${TOOLKIT_PLUGIN_NAME}@${TOOLKIT_MARKETPLACE_NAME}`;
}

function codexToolkitInstallCommands(repoRoot) {
  return [
    ['plugin', 'marketplace', 'add', repoRoot, '--json'],
    ['plugin', 'add', pluginId(), '--json']
  ];
}

function cacheRootFor(codexHome, version = EXPECTED_TOOLKIT_VERSION) {
  return path.join(codexHome, 'plugins', 'cache', TOOLKIT_MARKETPLACE_NAME, TOOLKIT_PLUGIN_NAME, version);
}

function listFingerprintFiles(root) {
  const files = [];
  for (const relPath of CACHE_FINGERPRINT_PATHS) {
    files.push(relPath);
  }
  for (const relDir of CACHE_FINGERPRINT_DIRS) {
    const absDir = path.join(root, ...relDir.split('/'));
    if (!fs.existsSync(absDir)) {
      files.push(`${relDir}/`);
      continue;
    }
    const stack = [absDir];
    while (stack.length) {
      const current = stack.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const absPath = path.join(current, entry.name);
        const relPath = slash(path.relative(root, absPath));
        if (entry.isDirectory()) stack.push(absPath);
        else if (entry.isFile()) files.push(relPath);
      }
    }
  }
  return [...new Set(files)].sort((left, right) => left.localeCompare(right));
}

function fileFingerprint(filePath) {
  if (!fs.existsSync(filePath)) return { exists: false, size: 0, hash: '' };
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) return { exists: false, size: 0, hash: '' };
  return {
    exists: true,
    size: stat.size,
    hash: crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
  };
}

function verifyInstalledCacheFreshness(cacheRoot, repoRoot, options = {}) {
  const errors = [];
  if (!repoRoot) return errors;
  const sourceRoot = path.resolve(repoRoot);
  const installedRoot = path.resolve(cacheRoot);
  const relFiles = new Set([
    ...listFingerprintFiles(sourceRoot),
    ...listFingerprintFiles(installedRoot)
  ]);
  for (const relPath of [...relFiles].sort((left, right) => left.localeCompare(right))) {
    if (relPath.endsWith('/')) {
      const sourceDir = path.join(sourceRoot, ...relPath.slice(0, -1).split('/'));
      const cacheDir = path.join(installedRoot, ...relPath.slice(0, -1).split('/'));
      if (!fs.existsSync(sourceDir)) errors.push(`${pluginId()} cache contains stale directory absent from repo: ${relPath}`);
      if (!fs.existsSync(cacheDir)) errors.push(`${pluginId()} installed plugin cache is missing directory from repo: ${relPath}`);
      continue;
    }
    const sourceFile = path.join(sourceRoot, ...relPath.split('/'));
    const cacheFile = path.join(installedRoot, ...relPath.split('/'));
    if (relPath === '.codex-plugin/hooks/hooks.json' && (options.platform || process.platform).startsWith('win')) {
      let sourceHookErrors = [];
      let cacheHookErrors = [];
      if (!fs.existsSync(sourceFile)) errors.push(`${pluginId()} repo is missing file: ${relPath}`);
      else {
        sourceHookErrors = verifySessionStartHook(sourceFile);
        errors.push(...sourceHookErrors.map((error) => `${pluginId()} repo ${error}`));
      }
      if (!fs.existsSync(cacheFile)) errors.push(`${pluginId()} installed plugin cache is missing repo file: ${relPath}`);
      else {
        cacheHookErrors = verifySessionStartHook(cacheFile, { windows: true, powershellPath: options.powershellPath });
        errors.push(...cacheHookErrors.map((error) => `${pluginId()} cache ${error}`));
      }
      if (!sourceHookErrors.length && !cacheHookErrors.length && fs.existsSync(sourceFile) && fs.existsSync(cacheFile)) {
        const normalizedCacheBytes = Buffer.from(`${JSON.stringify(withoutWindowsCommands(readJson(cacheFile)), null, 2)}\n`, 'utf8');
        if (!fs.readFileSync(sourceFile).equals(normalizedCacheBytes)) {
          errors.push(`${pluginId()} installed plugin cache is stale for repo file after removing the Windows hook commands: ${relPath}`);
        }
      }
      continue;
    }
    const source = fileFingerprint(sourceFile);
    const cache = fileFingerprint(cacheFile);
    if (!source.exists) {
      errors.push(`${pluginId()} cache contains stale file absent from repo: ${relPath}`);
    } else if (!cache.exists) {
      errors.push(`${pluginId()} installed plugin cache is missing repo file: ${relPath}`);
    } else if (source.hash !== cache.hash || source.size !== cache.size) {
      errors.push(`${pluginId()} installed plugin cache is stale for repo file: ${relPath}`);
    }
  }
  return errors;
}

function codexConfigPath(codexHome) {
  return path.join(codexHome, 'config.toml');
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findTomlSection(text, sectionPattern) {
  const lines = String(text || '').split(/\r?\n/);
  let matched = false;
  const body = [];
  for (const line of lines) {
    const section = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/);
    if (section) {
      if (matched) break;
      matched = sectionPattern.test(section[1].trim());
      continue;
    }
    if (matched) body.push(line);
  }
  return matched ? body.join('\n') : null;
}

function parseTomlStringValue(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return '';
  const jsonString = raw.match(/^"((?:\\.|[^"\\])*)"\s*(?:#.*)?$/);
  if (jsonString) return JSON.parse(`"${jsonString[1]}"`);
  const literalString = raw.match(/^'([^']*)'\s*(?:#.*)?$/);
  if (literalString) return literalString[1];
  return raw.replace(/\s+#.*$/, '').trim();
}

function parseTomlSectionValues(sectionText) {
  const values = {};
  for (const line of String(sectionText || '').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*(.+?)\s*$/);
    if (!match) continue;
    values[match[1]] = parseTomlStringValue(match[2]);
  }
  return values;
}

function configHasEnabledPlugin(configText) {
  return inspectConfiguredPluginState(configText, pluginId()).status === 'enabled';
}

function inspectConfiguredPluginState(configText, identity) {
  const id = escapeRegex(identity);
  const sectionPattern = new RegExp(`^plugins\\.(?:"${id}"|'${id}')$`);
  const lines = String(configText || '').split(/\r?\n/);
  const sections = [];
  let body = null;
  for (const line of lines) {
    const section = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/);
    if (section) {
      if (body) sections.push(body);
      body = sectionPattern.test(section[1].trim()) ? [] : null;
      continue;
    }
    if (body) body.push(line);
  }
  if (body) sections.push(body);

  if (sections.length !== 1) {
    return {
      status: 'unprovable',
      reason: sections.length === 0
        ? `Codex config has no explicit [plugins."${identity}"] state`
        : `Codex config has multiple [plugins."${identity}"] sections`
    };
  }
  const enabledValues = sections[0]
    .map((line) => line.match(/^\s*enabled\s*=\s*(true|false)\s*(?:#.*)?$/))
    .filter(Boolean)
    .map((match) => match[1].toLowerCase());
  if (enabledValues.length !== 1) {
    return {
      status: 'unprovable',
      reason: `Codex config does not contain one explicit boolean enabled value for [plugins."${identity}"]`
    };
  }
  return {
    status: enabledValues[0] === 'true' ? 'enabled' : 'disabled',
    reason: `Codex config explicitly reports [plugins."${identity}"] as ${enabledValues[0]}`
  };
}

function inspectCodexConfiguredPluginState(options = {}) {
  const codexHome = path.resolve(options.codexHome || defaultCodexHome());
  const identity = String(options.identity || '').trim();
  if (!identity) return { status: 'unprovable', reason: 'Plugin identity is required for Codex config inspection' };
  const configPath = codexConfigPath(codexHome);
  if (!fs.existsSync(configPath)) {
    return { status: 'unprovable', reason: `Codex config is unavailable for ${identity}` };
  }
  try {
    return inspectConfiguredPluginState(fs.readFileSync(configPath, 'utf8'), identity);
  } catch {
    return { status: 'unprovable', reason: `Codex config state for ${identity} could not be read` };
  }
}

function localMarketplaceSection(configText) {
  const name = escapeRegex(TOOLKIT_MARKETPLACE_NAME);
  return findTomlSection(
    configText,
    new RegExp(`^marketplaces\\.(?:${name}|"${name}"|'${name}')$`)
  );
}

function stripWindowsVerbatimPrefix(value) {
  return String(value || '').replace(/^\\\\\?\\/, '').replace(/^\/\/\?\//, '/');
}

function comparablePath(value) {
  const resolved = path.resolve(stripWindowsVerbatimPrefix(value));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function verifyLocalMarketplaceConfig(configText, repoRoot) {
  const section = localMarketplaceSection(configText);
  if (section === null) {
    return {
      sourcePath: '',
      errors: [`Codex config must include [marketplaces.${TOOLKIT_MARKETPLACE_NAME}]`]
    };
  }

  const values = parseTomlSectionValues(section);
  const sourceType = String(values.source_type || values.type || '').trim().toLowerCase();
  const sourcePath = values.path || values.source || '';
  const errors = [];
  if (sourceType && sourceType !== 'local') {
    errors.push(`Codex config [marketplaces.${TOOLKIT_MARKETPLACE_NAME}] must use local source type: ${sourceType}`);
  }
  if (!sourcePath) {
    errors.push(`Codex config [marketplaces.${TOOLKIT_MARKETPLACE_NAME}] marketplace source path must set path or source to this local repo`);
  } else if (comparablePath(sourcePath) !== comparablePath(repoRoot)) {
    errors.push(`Codex config [marketplaces.${TOOLKIT_MARKETPLACE_NAME}] marketplace source path does not match this local repo: ${sourcePath}`);
  }
  return { sourcePath, errors };
}

function detectHookTrustStatus() {
  return {
    status: 'verification-unavailable',
    message: 'Hook trust verification is unavailable from supported non-interactive Codex inspection. Open `/hooks` in Codex, review and trust the current Toolkit `SessionStart` hook. Until it is trusted, Codex skips the hook.'
  };
}

function verifyInstalledCache(codexHome, expectedVersion = EXPECTED_TOOLKIT_VERSION, options = {}) {
  const cacheRoot = cacheRootFor(codexHome, expectedVersion);
  const errors = [];
  const cacheManifestPath = path.join(cacheRoot, '.codex-plugin', 'plugin.json');
  const cacheHooksPath = path.join(cacheRoot, '.codex-plugin', 'hooks', 'hooks.json');
  if (!fs.existsSync(cacheManifestPath)) {
    errors.push(`${pluginId()} installed plugin cache is missing .codex-plugin/plugin.json at ${cacheRoot}`);
  } else {
    const manifest = readJson(cacheManifestPath);
    if (manifest.name !== TOOLKIT_PLUGIN_NAME) {
      errors.push(`${pluginId()} cache manifest has wrong plugin name: ${manifest.name || '<missing>'}`);
    }
    if (manifest.version !== expectedVersion) {
      errors.push(`${pluginId()} cache manifest expected version ${expectedVersion}: ${manifest.version || '<missing>'}`);
    }
  }
  if (!fs.existsSync(cacheHooksPath)) {
    errors.push(`${pluginId()} installed plugin cache is missing SessionStart hook config at ${cacheHooksPath}`);
  } else {
    errors.push(...verifySessionStartHook(cacheHooksPath, {
      windows: (options.platform || process.platform).startsWith('win'),
      powershellPath: options.powershellPath
    }).map((error) => `${pluginId()} cache ${error}`));
  }
  errors.push(...verifySessionStartRuntime(cacheRoot, { platform: options.platform, nodePath: options.nodePath }));
  errors.push(...verifyInstalledCacheFreshness(cacheRoot, options.repoRoot || '', options));
  return { cacheRoot, errors };
}

function findInstalledPluginEntries(pluginList, identity) {
  const installed = Array.isArray(pluginList?.installed) ? pluginList.installed : [];
  return installed.filter((entry) =>
    entry &&
    (entry.pluginId === identity.pluginId ||
      (entry.name === identity.name && entry.marketplaceName === identity.marketplaceName))
  );
}

function findInstalledEntry(pluginList) {
  return findInstalledPluginEntries(pluginList, {
    pluginId: pluginId(),
    name: TOOLKIT_PLUGIN_NAME,
    marketplaceName: TOOLKIT_MARKETPLACE_NAME
  })[0] || null;
}

function evaluateConfigCacheFallback(options = {}) {
  const codexHome = path.resolve(options.codexHome || defaultCodexHome());
  const repoRoot = path.resolve(options.repoRoot || repoRootFromScript());
  const expectedVersion = options.expectedVersion || EXPECTED_TOOLKIT_VERSION;
  const errors = [];
  const configPath = codexConfigPath(codexHome);
  let configText = '';

  if (!fs.existsSync(configPath)) {
    errors.push(`Codex config/cache fallback requires Codex config at ${configPath}`);
  } else {
    configText = fs.readFileSync(configPath, 'utf8');
    if (!configHasEnabledPlugin(configText)) {
      errors.push(`Codex config must enable [plugins."${pluginId()}"]`);
    }
    errors.push(...verifyLocalMarketplaceConfig(configText, repoRoot).errors);
  }

  const cache = verifyInstalledCache(codexHome, expectedVersion, { repoRoot });
  errors.push(...cache.errors);
  const hookTrust = detectHookTrustStatus(codexHome, cache.cacheRoot);
  const installed = errors.length === 0 ? {
    pluginId: pluginId(),
    name: TOOLKIT_PLUGIN_NAME,
    marketplaceName: TOOLKIT_MARKETPLACE_NAME,
    version: expectedVersion,
    installed: true,
    enabled: true,
    authPolicy: 'ON_USE',
    source: {
      source: 'local',
      path: repoRoot
    },
    verificationSource: 'config-cache-fallback'
  } : null;

  return {
    ok: errors.length === 0,
    installed,
    cacheRoot: cache.cacheRoot,
    errors,
    verificationMethod: 'config-cache-fallback',
    hookTrustStatus: hookTrust.status,
    hookTrustMessage: hookTrust.message
  };
}

function evaluateCodexToolkitPluginState(pluginList, options = {}) {
  const codexHome = path.resolve(options.codexHome || defaultCodexHome());
  const repoRoot = path.resolve(options.repoRoot || repoRootFromScript());
  const expectedVersion = options.expectedVersion || EXPECTED_TOOLKIT_VERSION;
  const errors = [];
  const installed = findInstalledEntry(pluginList);
  const cacheRoot = cacheRootFor(codexHome, expectedVersion);
  const hookTrust = detectHookTrustStatus(codexHome, cacheRoot);
  let refusesDowngrade = false;

  if (!installed) {
    if (options.allowConfigCacheFallback) {
      return evaluateConfigCacheFallback({ codexHome, repoRoot, expectedVersion });
    }
    errors.push(`${pluginId()} is not installed`);
    return {
      ok: false,
      installed: null,
      cacheRoot,
      errors,
      verificationMethod: 'codex-cli-list',
      hookTrustStatus: hookTrust.status,
      hookTrustMessage: hookTrust.message,
      refusesDowngrade
    };
  }
  if (!installed.enabled) errors.push(`${pluginId()} is installed but not enabled`);
  if (installed.version !== expectedVersion) {
    if (compareSemver(installed.version, expectedVersion) > 0) {
      refusesDowngrade = true;
      errors.push(`Refusing downgrade: installed ${pluginId()} version ${installed.version} is newer than source version ${expectedVersion}. Update the managed source checkout or remove the newer plugin explicitly before retrying.`);
    } else {
      errors.push(`${pluginId()} expected version ${expectedVersion}: ${installed.version || '<missing>'}`);
    }
  }
  if (installed.authPolicy !== 'ON_USE') {
    errors.push(`${pluginId()} expected authPolicy ON_USE for headless local install: ${installed.authPolicy || '<missing>'}`);
  }
  if (installed.source?.path && path.resolve(installed.source.path) !== repoRoot) {
    errors.push(`${pluginId()} source path does not match this local repo: ${installed.source.path}`);
  }

  errors.push(...verifyInstalledCache(codexHome, expectedVersion, { repoRoot }).errors);

  return {
    ok: errors.length === 0,
    installed,
    cacheRoot,
    errors,
    verificationMethod: 'codex-cli-list',
    hookTrustStatus: hookTrust.status,
    hookTrustMessage: hookTrust.message,
    refusesDowngrade
  };
}

function commandOutput(result) {
  return `${result.stdout || ''}${result.stderr || ''}${result.error ? result.error.message : ''}`.trim();
}

function windowsAliasCliCandidate() {
  return path.join(defaultCodexHome(), 'plugins', '.plugin-appserver', process.platform === 'win32' ? 'codex.exe' : 'codex');
}

function isWindowsAppsAliasAccessDenied(command, output) {
  const text = String(output || '');
  return process.platform === 'win32' &&
    (command === 'codex' || /[\\/]WindowsApps[\\/]codex\.exe$/i.test(command)) &&
    /(access is denied|eperm|eacces)/i.test(text);
}

function formatWindowsAliasFailure(command, output) {
  const detail = String(output || '').trim() || 'failed before startup';
  if (isWindowsAppsAliasAccessDenied(command, output)) {
    return [
      `${command}: ${detail}`,
      '  Known condition: `codex` likely resolved to a non-runnable WindowsApps alias.',
      `  Use the app-managed CLI at ${WINDOWS_USERPROFILE_CLI_HINT} or pass --codex-cli "${windowsAliasCliCandidate()}".`
    ].join('\n');
  }
  return `${command}: ${detail}`;
}

function positiveIntEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function commandTimeoutMs() {
  return positiveIntEnv('CODEX_TOOLKIT_CODEX_CLI_TIMEOUT_MS', 120000);
}

function pluginAddDeadlineMs() {
  if (process.env.CODEX_TOOLKIT_CODEX_PLUGIN_ADD_DEADLINE_MS) {
    return positiveIntEnv('CODEX_TOOLKIT_CODEX_PLUGIN_ADD_DEADLINE_MS', 120000);
  }
  if (process.env.CODEX_TOOLKIT_CODEX_CLI_ADD_TIMEOUT_MS) {
    return positiveIntEnv('CODEX_TOOLKIT_CODEX_CLI_ADD_TIMEOUT_MS', 120000);
  }
  return 120000;
}

function pluginAddPollMs() {
  return positiveIntEnv('CODEX_TOOLKIT_CODEX_PLUGIN_ADD_POLL_MS', 500);
}

function codexSpawnParts(command, args) {
  const isNodeScript = /\.(?:cjs|mjs|js)$/i.test(command);
  return {
    command: isNodeScript ? process.execPath : command,
    args: isNodeScript ? [command, ...args] : args
  };
}

function spawnCodex(command, args, options = {}) {
  const parts = codexSpawnParts(command, args);
  return spawnSync(parts.command, parts.args, {
    ...options,
    windowsHide: true
  });
}

function spawnCodexProcess(command, args, options = {}) {
  const parts = codexSpawnParts(command, args);
  return spawn(parts.command, parts.args, {
    stdio: 'ignore',
    ...options,
    windowsHide: true
  });
}

function commandCandidates(explicitCommand) {
  const candidates = [];
  if (explicitCommand) candidates.push(explicitCommand);
  if (process.env.CODEX_TOOLKIT_CODEX_CLI) candidates.push(process.env.CODEX_TOOLKIT_CODEX_CLI);
  if (process.env.CODEX_CLI_PATH) candidates.push(process.env.CODEX_CLI_PATH);
  candidates.push(windowsAliasCliCandidate());
  try { candidates.push(resolvePathExecutable('codex', { label: 'Codex CLI' })); } catch {}
  return [...new Set(candidates.filter(Boolean))];
}

function resolveCodexCommand(explicitCommand) {
  const failures = [];
  for (const command of commandCandidates(explicitCommand)) {
    const result = spawnCodex(command, ['plugin', '--help'], {
      encoding: 'utf8',
      timeout: 10000
    });
    if (result.status === 0 && /Manage Codex plugins/.test(`${result.stdout}${result.stderr}`)) {
      return { command, failures };
    }
    failures.push(formatWindowsAliasFailure(command, commandOutput(result) || `exit ${result.status}`));
  }
  return { command: '', failures };
}

function runCodexJson(command, args) {
  const result = spawnCodex(command, args, {
    encoding: 'utf8',
    timeout: commandTimeoutMs(),
    maxBuffer: CODEX_JSON_MAX_OUTPUT_BYTES
  });
  if (result.error && result.error.code === 'ENOBUFS') {
    // Report the bound without echoing the truncated catalogue into the error.
    throw new Error(`codex ${args.join(' ')} output exceeded the ${CODEX_JSON_MAX_OUTPUT_BYTES / (1024 * 1024)} MiB limit`);
  }
  if (result.status !== 0) {
    throw new Error(`codex ${args.join(' ')} failed: ${commandOutput(result)}`);
  }
  const output = (result.stdout || '').trim();
  try {
    return output ? JSON.parse(output) : {};
  } catch (error) {
    throw new Error(`codex ${args.join(' ')} returned invalid JSON: ${error.message}`);
  }
}

function inspectCodexPluginList(options = {}) {
  const resolved = (options.resolveCodexCommand || resolveCodexCommand)(options.codexCommand || '');
  if (!resolved.command) {
    return {
      ok: false,
      pluginList: null,
      errors: ['Codex CLI plugin inspection is unavailable; current installed plugin state cannot be proven']
    };
  }
  try {
    return {
      ok: true,
      pluginList: (options.runCodexJson || runCodexJson)(resolved.command, ['plugin', 'list', '--json', '--available']),
      errors: []
    };
  } catch {
    return {
      ok: false,
      pluginList: null,
      errors: ['Codex CLI plugin inspection failed; current installed plugin state cannot be proven']
    };
  }
}

function codexAddTimeoutWarning(args) {
  return `codex ${args.join(' ')} did not exit cleanly, but installed-state verification passed`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function terminateChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null || child.killed) return;
  try {
    child.kill();
  } catch {
    // The child may already be gone; verification state is the source of truth here.
  }
}

function formatStateErrors(state, listError) {
  if (state?.errors?.length) return state.errors.join('; ');
  if (listError) return listError.message;
  return 'no installed-state verification was available';
}

// Plugin removal destroys the installed cache, so it is only permitted under a positively verified
// marketplace-source binding, never on installed state alone.
function shouldRemoveBeforeInstall(state, binding) {
  return binding?.status === 'bound' && Boolean(state?.installed);
}

function sha256Hex(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function readConfigSnapshot(codexHome) {
  const configPath = codexConfigPath(codexHome);
  if (!fs.existsSync(configPath)) return { exists: false, text: '', sha256: '' };
  const bytes = fs.readFileSync(configPath);
  return { exists: true, text: bytes.toString('utf8'), sha256: sha256Hex(bytes) };
}

function localMarketplaceSectionCount(configText) {
  const name = escapeRegex(TOOLKIT_MARKETPLACE_NAME);
  const pattern = new RegExp(`^marketplaces\\.(?:${name}|"${name}"|'${name}')$`);
  return String(configText || '').split(/\r?\n/).filter((line) => {
    const section = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/);
    return Boolean(section) && pattern.test(section[1].trim());
  }).length;
}

// Positive marketplace-source binding. The native marketplace list, the Codex config readback and
// any installed plugin's marketplaceSource must all name one local source. An installed plugin's
// own `source.path` follows the current marketplace mapping, so it is never treated as provenance.
// Statuses: bound | absent | mismatch | ambiguous | unsupported | unverifiable.
function evaluateMarketplaceBinding(marketplaceList, config, repoRoot, pluginList = null) {
  const configSha256 = config?.sha256 || '';
  const result = (status, reason, root = '') => ({ status, reason, root, configSha256 });
  const label = `marketplace ${TOOLKIT_MARKETPLACE_NAME}`;
  const section = `[marketplaces.${TOOLKIT_MARKETPLACE_NAME}]`;
  const listed = marketplaceList?.marketplaces;
  if (!marketplaceList || typeof marketplaceList !== 'object' || Object.keys(marketplaceList).join(',') !== 'marketplaces' ||
    !Array.isArray(listed) || listed.some((entry) => !entry || typeof entry.name !== 'string')) {
    return result('unverifiable', 'codex plugin marketplace list --json returned unexpected native metadata');
  }
  const entries = listed.filter((entry) => entry.name === TOOLKIT_MARKETPLACE_NAME);
  const sections = localMarketplaceSectionCount(config?.text);
  if (entries.length > 1 || sections > 1) {
    return result('ambiguous', `${label} identity is ambiguous: the native list reports ${entries.length} entries and Codex config has ${sections} ${section} sections`);
  }
  if (entries.length === 0) {
    if (sections !== 0) return result('unverifiable', `Codex config readback has ${section} but the native marketplace list does not report it`);
    return result('absent', `${label} is not configured`);
  }
  const entry = entries[0];
  if (Object.keys(entry).sort().join(',') !== 'name,root' || typeof entry.root !== 'string' || !entry.root.trim()) {
    return result('unverifiable', `the native ${label} entry has unexpected native metadata`);
  }
  if (sections !== 1) return result('unverifiable', `the native list reports ${label} but Codex config readback has no ${section} section`, entry.root);
  const values = parseTomlSectionValues(localMarketplaceSection(config.text));
  if (values.source_type !== 'local') {
    return result('unsupported', `Codex config ${section} uses an unsupported source type: ${values.source_type || '<missing>'}`, entry.root);
  }
  if (Object.keys(values).sort().join(',') !== 'source,source_type') {
    return result('unverifiable', `Codex config ${section} has unexpected keys: ${Object.keys(values).sort().join(', ')}`, entry.root);
  }
  if (!values.source || comparablePath(values.source) !== comparablePath(entry.root)) {
    return result('unverifiable', `Codex config readback source ${values.source || '<missing>'} does not match the native marketplace root ${entry.root}`, entry.root);
  }
  const installedEntries = pluginList ? findInstalledPluginEntries(pluginList, {
    pluginId: pluginId(),
    name: TOOLKIT_PLUGIN_NAME,
    marketplaceName: TOOLKIT_MARKETPLACE_NAME
  }) : [];
  for (const installed of installedEntries) {
    if (installed.marketplaceSource === undefined) continue;
    const source = installed.marketplaceSource;
    if (!source || source.sourceType !== 'local' || typeof source.source !== 'string' || comparablePath(source.source) !== comparablePath(entry.root)) {
      return result('unverifiable', `the installed plugin marketplace source does not match the native marketplace root ${entry.root}`, entry.root);
    }
  }
  if (comparablePath(entry.root) !== comparablePath(repoRoot)) {
    return result('mismatch', `${label} is already bound to a different source: ${entry.root} (requested ${repoRoot})`, entry.root);
  }
  return result('bound', `${label} is bound to ${entry.root}`, entry.root);
}

function marketplaceAddOutputError(output, root) {
  if (!output || Object.keys(output).sort().join(',') !== 'alreadyAdded,installedRoot,marketplaceName') {
    return 'marketplace add returned unexpected native metadata';
  }
  if (output.marketplaceName !== TOOLKIT_MARKETPLACE_NAME) return `marketplace add reported marketplace ${output.marketplaceName}`;
  if (typeof output.installedRoot !== 'string' || comparablePath(output.installedRoot) !== comparablePath(root)) {
    return `marketplace add reported root ${output.installedRoot}`;
  }
  if (output.alreadyAdded !== false) return 'marketplace add reported an existing registration instead of a new one';
  return '';
}

function marketplaceRemoveOutputError(output) {
  if (!output || Object.keys(output).sort().join(',') !== 'installedRoot,marketplaceName' ||
    output.marketplaceName !== TOOLKIT_MARKETPLACE_NAME || output.installedRoot !== null) {
    return 'marketplace remove returned unexpected native metadata';
  }
  return '';
}

function rollbackTargetError(root) {
  const wrapper = marketplacePath(root);
  if (!fs.existsSync(wrapper)) return `${MARKETPLACE_REL_PATH} is missing`;
  try {
    const name = readJson(wrapper)?.name;
    return name === TOOLKIT_MARKETPLACE_NAME ? '' : `${MARKETPLACE_REL_PATH} names marketplace ${name || '<missing>'}`;
  } catch (error) {
    return `${MARKETPLACE_REL_PATH} is unreadable: ${error.message}`;
  }
}

function toolkitCacheBase(codexHome) {
  return path.join(codexHome, 'plugins', 'cache', TOOLKIT_MARKETPLACE_NAME);
}

// Structural listing (path, type, size) of the Toolkit marketplace cache that never follows links.
function listToolkitCacheTree(base) {
  const entries = [];
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    for (const entry of fs.readdirSync(path.join(base, rel), { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        entries.push(`${relPath}/`);
        stack.push(relPath);
      } else if (entry.isSymbolicLink()) {
        entries.push(`${relPath}->${fs.readlinkSync(path.join(base, relPath))}`);
      } else {
        entries.push(`${relPath}:${entry.isFile() ? fs.lstatSync(path.join(base, relPath)).size : 'special'}`);
      }
    }
  }
  return entries.sort();
}

// Toolkit state proving that a Codex home already held an install: config naming the Toolkit
// marketplace or plugin (enabled or disabled), an installed Toolkit entry in the native list, or
// anything under the Toolkit marketplace cache. The native list hides a plugin whose marketplace is
// gone, so config and cache are read directly. A cache layout that cannot be read counts as leftover
// state. `sha256` fingerprints the plugin config state and cache layout for the rebind's own check.
function inspectResidualToolkitState(codexHome, pluginList = null) {
  const evidence = [];
  const configText = readConfigSnapshot(codexHome).text;
  const pluginConfig = inspectConfiguredPluginState(configText, pluginId());
  if (pluginConfig.status === 'enabled' || pluginConfig.status === 'disabled') {
    evidence.push(`Codex config still has [plugins."${pluginId()}"] (${pluginConfig.status})`);
  } else if (configText.includes(TOOLKIT_MARKETPLACE_NAME)) {
    evidence.push(`Codex config still names ${TOOLKIT_MARKETPLACE_NAME}`);
  }
  if (findInstalledEntry(pluginList)) evidence.push(`codex plugin list still reports ${pluginId()} as installed`);
  const base = toolkitCacheBase(codexHome);
  let cache = [];
  try {
    const stat = fs.lstatSync(base);
    if (!stat.isDirectory()) {
      cache = [stat.isSymbolicLink() ? `<link ${fs.readlinkSync(base)}>` : '<not a directory>'];
      evidence.push(`the Toolkit plugin cache path ${base} is not a plain directory`);
    } else {
      cache = listToolkitCacheTree(base);
      const generations = cache.filter((entry) => /^[^/]+\/[^/]+\/$/.test(entry)).map((entry) => entry.slice(0, -1));
      if (cache.length) {
        evidence.push(`the Toolkit plugin cache ${base} still holds ${generations.length ? generations.join(', ') : `${cache.length} entries`}`);
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      cache = [`<unreadable ${error.code || 'error'}>`];
      evidence.push(`the Toolkit plugin cache ${base} cannot be read (${error.code || error.message})`);
    }
  }
  return { evidence, sha256: sha256Hex(JSON.stringify({ pluginConfig: pluginConfig.status, cache })) };
}

function orphanedToolkitStateMessage(evidence) {
  return [
    `Marketplace ${TOOLKIT_MARKETPLACE_NAME} is not configured, but this Codex home still holds Toolkit state from an earlier install: ${evidence.join('; ')}.`,
    '  This is not a fresh install, so setup will not add the marketplace, remove the plugin or replace its cache. No marketplace, plugin or cache changes were made.',
    '  If the marketplace was removed outside setup, or a setup journal recorded an interrupted rebind, restore it with `codex plugin marketplace add <previous-source>` and rerun. A previous source other than this repo then needs the separately approved --rebind-marketplace-from transition.',
    '  Deleting leftover Toolkit plugin config or cache by hand is a separate owner decision for this Codex home; setup never does it from this state.'
  ].join('\n');
}

const SETUP_JOURNAL_FILE = 'ai-agent-toolkit-setup-journal.json';
const SETUP_JOURNAL_RESOLVED = new Set(['completed', 'failed-no-effect', 'rolled-back']);

function setupJournalPath(codexHome) {
  return path.join(codexHome, SETUP_JOURNAL_FILE);
}

// Records each native mutation before it starts so an interrupted or ambiguous outcome is never
// retried blindly. Holds identities, versions and digests only, never Codex config contents.
class CodexSetupJournal {
  #path; #entry = null;

  constructor(codexHome) { this.#path = setupJournalPath(codexHome); }

  get path() { return this.#path; }
  get isOpen() { return this.#entry?.status === 'in-progress'; }

  unresolved() {
    if (!fs.existsSync(this.#path)) return null;
    let entry;
    try {
      entry = readJson(this.#path);
    } catch {
      return { status: 'unreadable', step: 'unknown' };
    }
    return SETUP_JOURNAL_RESOLVED.has(entry?.status) ? null : entry;
  }

  begin(step, fields) {
    this.#entry = { schema: 1, status: 'in-progress', step, steps: [step], started_at: new Date().toISOString(), ...fields };
    this.#flush();
  }

  step(step, fields = {}) {
    Object.assign(this.#entry, fields, { step });
    this.#entry.steps.push(step);
    this.#flush();
  }

  finish(status, fields = {}) {
    if (!this.isOpen) return;
    Object.assign(this.#entry, fields, { status, finished_at: new Date().toISOString() });
    this.#flush();
  }

  resolveByReadback(previous) {
    this.#entry = { ...previous, status: 'completed', resolved_by: 'verified-readback', resolved_at: new Date().toISOString() };
    this.#flush();
  }

  #flush() {
    writeFileAtomically(this.#path, Buffer.from(`${JSON.stringify(this.#entry, null, 2)}\n`, 'utf8'));
  }
}

function pendingJournalMessage(pending, journalPath) {
  const previous = pending?.rollback?.marketplace_root;
  const restore = previous
    ? ` The previous marketplace source was ${previous}; if readback no longer shows it, restore it with \`codex plugin marketplace add ${previous} --json\`.`
    : '';
  return [
    `A previous Toolkit Codex setup step (${pending.step || 'unknown'}, status ${pending.status || 'unknown'}) did not finish with verified readback. Not retrying any native marketplace or plugin operation.${restore}`,
    `  Review \`codex plugin marketplace list --json\`, \`codex plugin list --json\` and the Toolkit plugin cache. The journal at ${journalPath} records what was attempted; keep it as recovery evidence.`,
    '  Deleting or moving the journal does not authorise replaying the step: a later --write rechecks everything and still refuses a missing marketplace with leftover Toolkit state. Move the journal aside only after the Codex home is back in a verified state.'
  ].join('\n');
}

function marketplaceMismatchMessage(binding) {
  return [
    `${binding.reason}. No marketplace, plugin or cache changes were made.`,
    `  Codex refuses a same-name marketplace add from a different source; the supported transition is \`codex plugin marketplace remove ${TOOLKIT_MARKETPLACE_NAME}\` followed by \`codex plugin marketplace add <source>\`.`,
    `  That transition needs separate owner approval for this Codex home. With that approval, rerun with --rebind-marketplace-from "${binding.root}" to run it as one journaled, readback-verified step with rollback.`
  ].join('\n');
}

// One `setup --write` run. Order of effects: read-only inspection, then one marketplace transition
// (add when absent, or the gated rebind), then cache preparation, then at most one plugin replacement.
// Every destructive step requires a positive marketplace binding read back from native list + config.
class CodexToolkitWriteTransaction {
  #command; #options; #journal;
  #pluginChanged = false; #transition = 'none'; #warnings = [];

  constructor(command, options) {
    this.#command = command;
    this.#options = options;
    this.#journal = new CodexSetupJournal(options.codexHome);
  }

  #listPlugins() {
    return runCodexJson(this.#command, ['plugin', 'list', '--json', '--available']);
  }

  #evaluate(pluginList) {
    return evaluateCodexToolkitPluginState(pluginList, {
      codexHome: this.#options.codexHome,
      repoRoot: this.#options.repoRoot,
      allowConfigCacheFallback: true
    });
  }

  #inspectBinding(pluginList) {
    let listed;
    try {
      listed = runCodexJson(this.#command, ['plugin', 'marketplace', 'list', '--json']);
    } catch (error) {
      return { status: 'unverifiable', reason: `codex plugin marketplace list --json failed: ${error.message}`, root: '', configSha256: '' };
    }
    return evaluateMarketplaceBinding(listed, readConfigSnapshot(this.#options.codexHome), this.#options.repoRoot, pluginList);
  }

  #record(step, binding, state, extra = {}) {
    if (this.#journal.isOpen) return this.#journal.step(step);
    return this.#journal.begin(step, {
      requested: { marketplace_root: this.#options.repoRoot, version: EXPECTED_TOOLKIT_VERSION },
      preimage: {
        marketplace_status: binding.status,
        marketplace_root: binding.root || null,
        config_sha256: binding.configSha256 || null,
        installed_version: state?.installed?.version || null
      },
      ...extra
    });
  }

  #result(state) {
    return { state, pluginChanged: this.#pluginChanged, transition: this.#transition, warnings: this.#warnings };
  }

  async run() {
    try {
      return await this.#run();
    } catch (error) {
      this.#journal.finish('failed-unverified');
      throw error;
    }
  }

  async #run() {
    const pending = this.#journal.unresolved();
    let pluginList = this.#listPlugins();
    let state = this.#evaluate(pluginList);
    if (pending) {
      if (state.ok && this.#inspectBinding(pluginList).status === 'bound') {
        this.#journal.resolveByReadback(pending);
        return this.#result(state);
      }
      throw new Error(pendingJournalMessage(pending, this.#journal.path));
    }
    if (state.ok && !this.#options.rebindFrom) return this.#result(state);
    if (state.refusesDowngrade) return this.#result(state);

    const binding = this.#establishBinding(this.#inspectBinding(pluginList), state, pluginList);

    try {
      const prepared = prepareInstalledSessionStartIfPresent({ codexHome: this.#options.codexHome });
      this.#pluginChanged = this.#pluginChanged || prepared.hooksChanged;
    } catch {
      // Verification decides whether replacement is required.
    }
    pluginList = this.#listPlugins();
    state = this.#evaluate(pluginList);
    if (state.ok || state.refusesDowngrade) {
      this.#journal.finish('completed');
      return this.#result(state);
    }

    const current = this.#inspectBinding(pluginList);
    if (current.status !== 'bound' || current.configSha256 !== binding.configSha256 || comparablePath(current.root) !== comparablePath(binding.root)) {
      throw new Error(`Marketplace binding changed after verification (${current.reason}). Not replacing the plugin; no plugin or cache removal was made.`);
    }
    this.#record('plugin-replacement', current, state);
    this.#pluginChanged = true;
    if (shouldRemoveBeforeInstall(state, current)) {
      runCodexJson(this.#command, ['plugin', 'remove', pluginId(), '--json']);
      if (findInstalledEntry(this.#listPlugins())) {
        throw new Error(`codex plugin remove ${pluginId()} --json did not remove the installed plugin according to readback`);
      }
    }
    const addOutcome = await runCodexAddAndVerify(this.#command, ['plugin', 'add', pluginId(), '--json'], {
      codexHome: this.#options.codexHome,
      repoRoot: this.#options.repoRoot
    });
    this.#pluginChanged = this.#pluginChanged || addOutcome.hookChanged;
    if (addOutcome.warning) this.#warnings.push(addOutcome.warning);
    this.#journal.finish('completed', { installed_version: addOutcome.state.installed?.version || null });
    return this.#result(addOutcome.state);
  }

  // Runs on the state found at the start of this run, before any native mutation or journal entry.
  // An absent marketplace found here is a fresh install only without leftover Toolkit state; the
  // rebind's own intermediate absence is checked separately inside #rebindMarketplace.
  #establishBinding(binding, state, pluginList) {
    if (this.#options.rebindFrom && binding.status !== 'mismatch') {
      throw new Error(`--rebind-marketplace-from only applies when the marketplace is bound to a different source; current binding is ${binding.status} (${binding.reason}). No marketplace, plugin or cache changes were made.`);
    }
    if (binding.status === 'bound') return binding;
    if (binding.status === 'absent') {
      const residue = inspectResidualToolkitState(this.#options.codexHome, pluginList);
      if (residue.evidence.length) throw new Error(orphanedToolkitStateMessage(residue.evidence));
      return this.#addMarketplace(binding, state);
    }
    if (binding.status === 'mismatch') {
      if (!this.#options.rebindFrom) throw new Error(marketplaceMismatchMessage(binding));
      return this.#rebindMarketplace(binding, state);
    }
    throw new Error(`${binding.reason}. The marketplace-source binding cannot be verified. No marketplace, plugin or cache changes were made.`);
  }

  // Runs one native marketplace add and returns the read-back binding, or null when it did not bind.
  #nativeAdd(root) {
    let error = null;
    try {
      const outputError = marketplaceAddOutputError(runCodexJson(this.#command, ['plugin', 'marketplace', 'add', root, '--json']), root);
      if (outputError) error = new Error(outputError);
    } catch (caught) {
      error = caught;
    }
    return { error, after: this.#inspectBinding(null) };
  }

  #addMarketplace(before, state) {
    const repoRoot = this.#options.repoRoot;
    this.#record('marketplace-add', before, state);
    const { error, after } = this.#nativeAdd(repoRoot);
    if (!error && after.status === 'bound') {
      this.#transition = 'added';
      this.#journal.step('marketplace-added');
      return after;
    }
    const noEffect = after.status === before.status && after.configSha256 === before.configSha256;
    this.#journal.finish(noEffect ? 'failed-no-effect' : 'failed-unverified', { readback: { marketplace_status: after.status, marketplace_root: after.root || null } });
    const outcome = noEffect
      ? 'Readback shows no change was made.'
      : `Readback is ${after.status} (${after.reason}); not retrying.`;
    throw new Error(`codex plugin marketplace add ${repoRoot} --json did not produce a verified binding: ${error ? error.message : after.reason}. ${outcome} No plugin or cache changes were made.`);
  }

  #rebindMarketplace(before, state) {
    const repoRoot = this.#options.repoRoot;
    const previousRoot = before.root;
    if (comparablePath(this.#options.rebindFrom) !== comparablePath(previousRoot)) {
      throw new Error(`--rebind-marketplace-from ${this.#options.rebindFrom} does not match the current marketplace source ${previousRoot}. No marketplace, plugin or cache changes were made.`);
    }
    const rollbackError = rollbackTargetError(previousRoot);
    if (rollbackError) {
      throw new Error(`Current marketplace source ${previousRoot} cannot serve as a rollback target: ${rollbackError}. No marketplace, plugin or cache changes were made.`);
    }
    const restoreCommand = `codex plugin marketplace add ${previousRoot} --json`;
    // The plugin config and cache must survive the remove unchanged: that exact intermediate state,
    // not any absent marketplace, is what this transaction may continue from.
    const residue = inspectResidualToolkitState(this.#options.codexHome);
    this.#record('marketplace-remove', before, state, { rollback: { marketplace_root: previousRoot, residue_sha256: residue.sha256 } });

    let removeError = null;
    try {
      const outputError = marketplaceRemoveOutputError(runCodexJson(this.#command, ['plugin', 'marketplace', 'remove', TOOLKIT_MARKETPLACE_NAME, '--json']));
      if (outputError) removeError = new Error(outputError);
    } catch (caught) {
      removeError = caught;
    }
    const removed = this.#inspectBinding(null);
    if (removeError || removed.status !== 'absent') {
      const unchanged = removed.status === before.status && comparablePath(removed.root) === comparablePath(previousRoot) && removed.configSha256 === before.configSha256;
      this.#journal.finish(unchanged ? 'failed-no-effect' : 'failed-unverified', { readback: { marketplace_status: removed.status, marketplace_root: removed.root || null } });
      const outcome = unchanged
        ? 'Readback shows the previous source is still bound; no change was made.'
        : `Readback is ${removed.status}; not retrying or rolling back automatically. After reviewing the Codex home, restore the previous source with \`${restoreCommand}\`.`;
      throw new Error(`codex plugin marketplace remove ${TOOLKIT_MARKETPLACE_NAME} --json did not produce a verified removal: ${removeError ? removeError.message : removed.reason}. ${outcome} No plugin or cache changes were made.`);
    }
    const intermediate = inspectResidualToolkitState(this.#options.codexHome);
    if (intermediate.sha256 !== residue.sha256) {
      this.#journal.finish('failed-unverified', { readback: { marketplace_status: removed.status, marketplace_root: null, residue_sha256: intermediate.sha256 } });
      throw new Error(`codex plugin marketplace remove ${TOOLKIT_MARKETPLACE_NAME} --json changed the Toolkit plugin config or cache as well as the marketplace, so this is not the intermediate state the rebind continues from. Not adding, retrying or rolling back automatically. After reviewing the Codex home, restore the previous source with \`${restoreCommand}\`. Setup made no plugin add or removal.`);
    }
    this.#journal.step('marketplace-add');

    const { error: addError, after: added } = this.#nativeAdd(repoRoot);
    if (!addError && added.status === 'bound') {
      this.#transition = 'rebound';
      this.#journal.step('marketplace-rebound');
      return added;
    }
    const addFailure = addError ? addError.message : added.reason;
    if (added.status !== 'absent') {
      this.#journal.finish('failed-unverified', { readback: { marketplace_status: added.status, marketplace_root: added.root || null } });
      throw new Error(`codex plugin marketplace add ${repoRoot} --json did not produce a verified binding: ${addFailure}. Readback is ${added.status}; not retrying or rolling back automatically. After reviewing the Codex home, restore the previous source with \`${restoreCommand}\`. No plugin or cache changes were made.`);
    }

    this.#journal.step('rollback-add');
    const { error: rollbackAddError, after: restored } = this.#nativeAdd(previousRoot);
    const exact = !rollbackAddError && restored.status === 'mismatch' &&
      comparablePath(restored.root) === comparablePath(previousRoot) && restored.configSha256 === before.configSha256 &&
      inspectResidualToolkitState(this.#options.codexHome).sha256 === residue.sha256;
    this.#journal.finish(exact ? 'rolled-back' : 'failed-unverified', { readback: { marketplace_status: restored.status, marketplace_root: restored.root || null } });
    if (exact) {
      throw new Error(`Marketplace rebind failed: ${addFailure}. Rolled back: restored the previous marketplace source ${previousRoot} with byte-identical Codex config. No plugin or cache changes were made.`);
    }
    throw new Error(`Marketplace rebind failed: ${addFailure}. Rollback to ${previousRoot} did not verify (${rollbackAddError ? rollbackAddError.message : restored.reason}); not retrying. After reviewing the Codex home, restore the previous source with \`${restoreCommand}\`. No plugin or cache changes were made.`);
  }
}

function nextStepsForState(state) {
  return [
    '**Next Steps:**',
    '1. If the plugin install changed anything, open `/hooks` in the Codex app and trust the updated Toolkit hooks.',
    '2. Open `/hooks` in Codex.',
    `3. Verify the enabled Toolkit \`SessionStart\` hook belongs to the installed \`ai-agent-toolkit\` plugin at version \`${EXPECTED_TOOLKIT_VERSION}\`.`,
    `4. The supported hook normally runs from the installed plugin-cache copy${state.cacheRoot ? ` at \`${state.cacheRoot}\`` : ''}, not the managed Git checkout.`,
    `5. ${state.hookTrustMessage}`,
    '',
    'This hook approval step applies to Codex only. Claude Code does not need Codex hook approval.',
    'Codex must not install or update Claude Code. Claude Code must not install or update Codex.'
  ];
}

// One `codex plugin add` run: start the add command detached, then poll the installed
// plugin list until the Toolkit install verifies, the add command fails, or the deadline
// passes. Verified installed state is the source of truth, not the child's exit.
class CodexPluginInstallOperation {
  #command; #addArgs; #options;
  #deadlineMs = pluginAddDeadlineMs(); #pollMs = pluginAddPollMs(); #startedAt = Date.now();
  #child; #childExit = null; #childError = null; #lastState = null; #lastListError = null; #hookChanged = false;

  constructor(command, addArgs, options) { this.#command = command; this.#addArgs = addArgs; this.#options = options; }

  get #label() { return `codex ${this.#addArgs.join(' ')}`; }
  get #verificationErrors() { return formatStateErrors(this.#lastState, this.#lastListError); }

  #start() {
    try {
      this.#child = spawnCodexProcess(this.#command, this.#addArgs, { env: process.env });
      this.#child.on('exit', (code, signal) => { this.#childExit = { code, signal }; });
      this.#child.on('error', (error) => { this.#childError = error; });
      this.#child.unref();
    } catch (error) {
      throw new Error(`${this.#label} failed to start: ${error.message}`);
    }
  }

  // One verification pass; returns the verified result or null to keep polling.
  #pollOnce() {
    const options = this.#options;
    try {
      const pluginList = runCodexJson(this.#command, ['plugin', 'list', '--json', '--available']);
      this.#lastListError = null;
      try {
        const prepared = prepareInstalledSessionStartIfPresent(options);
        this.#hookChanged = this.#hookChanged || prepared.hooksChanged;
      } catch {
        // Installed-state verification below reports an unsafe or incomplete cache.
      }
      this.#lastState = evaluateCodexToolkitPluginState(pluginList, {
        codexHome: options.codexHome,
        repoRoot: options.repoRoot,
        allowConfigCacheFallback: true
      });
      if (!this.#lastState.ok) return null;
      const addDidNotExitCleanly = !this.#childExit || this.#childExit.code !== 0;
      terminateChild(this.#child);
      return {
        state: this.#lastState,
        hookChanged: this.#hookChanged,
        warning: addDidNotExitCleanly ? codexAddTimeoutWarning(this.#addArgs) : ''
      };
    } catch (error) {
      this.#lastListError = error;
      return null;
    }
  }

  #failIfChildFailed() {
    if (this.#childError) {
      terminateChild(this.#child);
      throw new Error(`${this.#label} failed: ${this.#childError.message}; installed-state verification failed: ${this.#verificationErrors}`);
    }
    if (this.#childExit && this.#childExit.code !== 0) {
      terminateChild(this.#child);
      throw new Error(`${this.#label} exited with ${this.#childExit.code}${this.#childExit.signal ? ` signal ${this.#childExit.signal}` : ''}; installed-state verification failed: ${this.#verificationErrors}`);
    }
  }

  async run() {
    this.#start();
    while (Date.now() - this.#startedAt <= this.#deadlineMs) {
      const verified = this.#pollOnce();
      if (verified) return verified;
      this.#failIfChildFailed();
      await sleep(this.#pollMs);
    }
    terminateChild(this.#child);
    throw new Error(`${this.#label} did not produce a verified install within ${this.#deadlineMs}ms; installed-state verification failed: ${this.#verificationErrors}`);
  }
}
async function runCodexAddAndVerify(command, addArgs, options) {
  return new CodexPluginInstallOperation(command,addArgs,options).run();
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    repoRoot: repoRootFromScript(),
    codexHome: defaultCodexHome(),
    codexCommand: '',
    rebindFrom: '',
    write: false,
    json: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index] || '';
    if (arg === '--repo-root') options.repoRoot = next();
    else if (arg.startsWith('--repo-root=')) options.repoRoot = arg.slice('--repo-root='.length);
    else if (arg === '--codex-home') options.codexHome = next();
    else if (arg.startsWith('--codex-home=')) options.codexHome = arg.slice('--codex-home='.length);
    else if (arg === '--codex-cli') options.codexCommand = next();
    else if (arg.startsWith('--codex-cli=')) options.codexCommand = arg.slice('--codex-cli='.length);
    else if (arg === '--rebind-marketplace-from') options.rebindFrom = next();
    else if (arg.startsWith('--rebind-marketplace-from=')) options.rebindFrom = arg.slice('--rebind-marketplace-from='.length);
    else if (arg === '--write') options.write = true;
    else if (arg === '--verify') options.write = false;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  options.repoRoot = path.resolve(options.repoRoot);
  options.codexHome = path.resolve(options.codexHome);
  if (options.rebindFrom) {
    if (!options.write) throw new Error('--rebind-marketplace-from requires --write');
    options.rebindFrom = path.resolve(options.rebindFrom);
  }
  return options;
}

function usage() {
  return [
    'Usage: node repo/scripts/setup-codex-toolkit-plugin.cjs [--verify] [--write] [--json]',
    '',
    'Verifies or installs the Toolkit Codex native plugin through supported Codex plugin commands.',
    'The supported install path is:',
    `  codex plugin marketplace add <local-ai-agent-toolkit-repo> --json`,
    `  codex plugin add ${pluginId()} --json`,
    '',
    `--write never removes the plugin or its cache unless ${TOOLKIT_MARKETPLACE_NAME} is read back as bound to this repo.`,
    'If the marketplace is missing but Toolkit plugin config or cache remains, --write stops with no changes.',
    'If it is bound to a different source, --write stops with no changes. With separate owner approval,',
    '  --write --rebind-marketplace-from <current-source> runs the native marketplace remove + add once,',
    '  journaled, read back and rolled back on failure. An unresolved journal blocks every later retry.',
    '',
    'On Windows, pass the app-managed Codex CLI directly if bare `codex` resolves to WindowsApps:',
    `  node repo/scripts/setup-codex-toolkit-plugin.cjs --write --codex-cli "${windowsAliasCliCandidate()}"`,
    '',
    'The local repo must expose .agents/plugins/marketplace.json and .codex-plugin/plugin.json.',
    'This script is Codex-only; it never installs or updates Claude Code.'
  ].join('\n');
}

async function main(argv = process.argv.slice(2), dependencies = {}) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    return 2;
  }
  if (options.help) {
    console.log(usage());
    return 0;
  }

  const repoErrors = validateRepoPluginSource(options.repoRoot);
  if (repoErrors.length > 0) {
    for (const error of repoErrors) console.error(`FAIL: ${error}`);
    return 1;
  }

  const resolved = (dependencies.resolveCodexCommand || resolveCodexCommand)(options.codexCommand);
  if (!resolved.command) {
    console.error('FAIL: local Codex plugin install is unsupported in this environment.');
    console.error('No usable Codex CLI with plugin marketplace commands was found; setup toolkit cannot complete native plugin activation.');
    for (const failure of resolved.failures) console.error(`  ${failure}`);
    return 2;
  }

  const warnings = [];
  let state;
  let pluginChanged = false;
  let transition = 'none';

  try {
    if (options.write) {
      const outcome = await new CodexToolkitWriteTransaction(resolved.command, options).run();
      ({ state, pluginChanged, transition } = outcome);
      warnings.push(...outcome.warnings);
    } else {
      state = evaluateCodexToolkitPluginState(runCodexJson(resolved.command, ['plugin', 'list', '--json', '--available']), {
        codexHome: options.codexHome,
        repoRoot: options.repoRoot,
        allowConfigCacheFallback: true
      });
      const pending = new CodexSetupJournal(options.codexHome).unresolved();
      if (pending) warnings.push(pendingJournalMessage(pending, setupJournalPath(options.codexHome)));
    }
  } catch (error) {
    console.error(`FAIL: ${error.message}`);
    return 1;
  }

  if (!state.ok) {
    for (const error of state.errors) console.error(`FAIL: ${error}`);
    console.error('Run with --write to install or update through the supported Codex local marketplace path.');
    console.error(`Expected commands: ${codexToolkitInstallCommands(options.repoRoot).map((args) => `codex ${args.join(' ')}`).join(' ; ')}`);
    return 1;
  }

  const hookTrustStatus = pluginChanged ? 'pending-review' : state.hookTrustStatus;
  const hookTrustMessage = pluginChanged
    ? 'The exact current Toolkit `SessionStart` hook changed and is pending review. Open `/hooks` in Codex; the exact current Toolkit `SessionStart` hook must be reviewed and trusted. Codex skips the hook until it is trusted.'
    : state.hookTrustMessage;
  const reportedState = { ...state, hookTrustStatus, hookTrustMessage };
  const summary = {
    ok: true,
    plugin_id: pluginId(),
    version: EXPECTED_TOOLKIT_VERSION,
    installed: true,
    enabled: true,
    current: true,
    cache_root: state.cacheRoot,
    verification_method: state.verificationMethod,
    hook_trust_status: hookTrustStatus,
    hook_trust_message: hookTrustMessage,
    hook_execution_status: pluginChanged ? 'skipped until the current hook is reviewed and trusted' : 'verification unavailable; open `/hooks` in Codex',
    marketplace_transition: transition,
    install_path: codexToolkitInstallCommands(options.repoRoot),
    next_steps: nextStepsForState(reportedState, options),
    warnings
  };
  for (const warning of warnings) console.error(`WARN: ${warning}`);
  if (options.json) console.log(JSON.stringify(summary, null, 2));
  else {
    const method = state.verificationMethod === 'config-cache-fallback'
      ? 'verified by config/cache fallback because Codex CLI list did not report the plugin'
      : 'verified by Codex CLI plugin list and cache';
    console.log(`OK: ${pluginId()} is installed, enabled, version ${EXPECTED_TOOLKIT_VERSION}, and has a SessionStart hook in ${state.cacheRoot} (${method}).`);
    console.log(`Hook trust status: ${summary.hook_trust_status}`);
    console.log(`Hook execution status: ${summary.hook_execution_status}`);
    console.log('');
    console.log(nextStepsForState(reportedState, options).join('\n'));
  }
  return 0;
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  }, (error) => {
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 1;
  });
}


module.exports = {
  TOOLKIT_PLUGIN_NAME,
  TOOLKIT_MARKETPLACE_NAME,
  EXPECTED_TOOLKIT_VERSION,
  CODEX_JSON_MAX_OUTPUT_BYTES,
  MARKETPLACE_REL_PATH,
  CACHE_FINGERPRINT_PATHS,
  CACHE_FINGERPRINT_DIRS,
  SESSION_START_LAUNCHER_REL_PATH,
  SESSION_START_POWERSHELL_REL_PATH,
  SESSION_START_RUNTIME_REL_PATH,
  codexToolkitInstallCommands,
  defaultWindowsPowerShellPath,
  evaluateCodexToolkitPluginState,
  evaluateMarketplaceBinding,
  findInstalledPluginEntries,
  inspectCodexConfiguredPluginState,
  inspectCodexPluginList,
  prepareInstalledSessionStart,
  runCodexJson,
  setupJournalPath,
  shouldRemoveBeforeInstall,
  sourceSessionStartCommand,
  validateMarketplaceWrapper,
  validateRepoPluginSource,
  verifyInstalledCacheFreshness,
  verifySessionStartHook,
  verifySessionStartRuntime,
  windowsSessionStartCommand,
  windowsHelperHookCommand,
  renderInstalledWindowsHooks,
  sourceHelperHookCommand,
  HELPER_HOOK_POWERSHELL_REL_PATH,
  formatWindowsAliasFailure,
  isWindowsAppsAliasAccessDenied,
  main
};
