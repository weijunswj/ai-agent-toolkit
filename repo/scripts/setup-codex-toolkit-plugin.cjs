#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const TOOLKIT_PLUGIN_NAME = 'ai-agent-toolkit';
const TOOLKIT_MARKETPLACE_NAME = 'ai-agent-toolkit-local';
const EXPECTED_TOOLKIT_VERSION = '2.9.3';
const MARKETPLACE_REL_PATH = '.agents/plugins/marketplace.json';
const SESSION_START_LAUNCHER_REL_PATH = 'repo/scripts/toolkit-codex-session-start.cjs';
const SESSION_START_POWERSHELL_REL_PATH = 'repo/scripts/toolkit-codex-session-start.ps1';
const SESSION_START_RUNTIME_REL_PATH = '.codex-plugin/session-start-runtime.json';
const SESSION_START_ARGS = ['--hook', '--sync-enabled', '--write', '--sync-source', 'codex-plugin'];
const CACHE_FINGERPRINT_PATHS = [
  '.codex-plugin/plugin.json',
  '.codex-plugin/hooks/hooks.json',
  '_projects/n8n/skills-plugin-compatibility/SOURCE-LOCK.json',
  '_projects/n8n/skills-plugin-compatibility/_main/compatibility-contract.json',
  'repo/scripts/codex-delegation-backup.cjs',
  'repo/scripts/codex-delegation-common.cjs',
  'repo/scripts/codex-delegation-config.cjs',
  'repo/scripts/codex-delegation-layout.cjs',
  'repo/scripts/codex-delegation-state.cjs',
  'repo/scripts/setup-toolkit-core.cjs',
  'repo/scripts/setup-toolkit.cjs',
  'repo/scripts/setup-codex-toolkit-plugin.cjs',
  'repo/scripts/audit-n8n-skills-plugin-hooks.cjs',
  'repo/scripts/repo-ignore-hygiene.cjs',
  'repo/scripts/repo-local-backup.cjs',
  'repo/scripts/repair-codex-plugin-windows-hooks.cjs',
  'repo/scripts/toolkit-agent-control.cjs',
  'repo/scripts/claude-process-launch.cjs',
  SESSION_START_LAUNCHER_REL_PATH,
  SESSION_START_POWERSHELL_REL_PATH,
  'repo/scripts/toolkit-local-bridge.cjs',
  'repo/scripts/toolkit-staging-generations.cjs',
  'repo/tests/toolkit-local-bridge-hook-light.test.cjs'
];
const CACHE_FINGERPRINT_DIRS = [
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

function powershellSingleQuoted(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function windowsSessionStartCommand(powershellPath = defaultWindowsPowerShellPath()) {
  return `& ${powershellSingleQuoted(powershellPath)} -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$env:PLUGIN_ROOT/${SESSION_START_POWERSHELL_REL_PATH}"`;
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
  const hooks = readJson(hooksPath);
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
  const expected = options.windows
    ? windowsSessionStartCommand(options.powershellPath)
    : sourceSessionStartCommand();
  if (command !== expected) errors.push(`SessionStart command must use the exact ${options.windows ? 'installed Windows' : 'portable source'} Toolkit launcher shape`);
  if (!command.includes(SESSION_START_LAUNCHER_REL_PATH) && !command.includes(SESSION_START_POWERSHELL_REL_PATH)) {
    errors.push('SessionStart command must call the Toolkit hook-safe launcher');
  }
  if (/toolkit-local-bridge\.cjs/.test(command)) errors.push('SessionStart command must not call toolkit-local-bridge.cjs directly');
  if (!options.windows) {
    for (const arg of SESSION_START_ARGS) {
      if (!command.includes(arg)) errors.push(`SessionStart command must include ${arg}`);
    }
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
  const hooksPath = path.join(cacheRoot, '.codex-plugin', 'hooks', 'hooks.json');
  const nodePath = path.resolve(options.nodePath || process.execPath);
  const powershellPath = path.resolve(options.powershellPath || defaultWindowsPowerShellPath());
  for (const [filePath, label] of [[nodePath, 'Node executable'], [powershellPath, 'Windows PowerShell executable']]) {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label} must be a regular file for Toolkit SessionStart setup.`);
  }
  const hooks = readJson(hooksPath);
  const commandHook = hooks?.hooks?.SessionStart?.[0]?.hooks?.[0];
  const currentCommand = String(commandHook?.command || '');
  const installedCommand = windowsSessionStartCommand(powershellPath);
  if (currentCommand !== sourceSessionStartCommand() && currentCommand !== installedCommand) {
    throw new Error('Installed SessionStart hook does not match a supported Toolkit source or Windows launcher shape.');
  }
  commandHook.command = installedCommand;
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
        const normalizedCacheHooks = readJson(cacheFile);
        normalizedCacheHooks.hooks.SessionStart[0].hooks[0].command = sourceSessionStartCommand();
        const normalizedCacheBytes = Buffer.from(`${JSON.stringify(normalizedCacheHooks, null, 2)}\n`, 'utf8');
        if (!fs.readFileSync(sourceFile).equals(normalizedCacheBytes)) {
          errors.push(`${pluginId()} installed plugin cache is stale for repo file after normalizing the Windows SessionStart command: ${relPath}`);
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
    command === 'codex' &&
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
  candidates.push('codex');
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
    timeout: commandTimeoutMs()
  });
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

function shouldRemoveBeforeInstall(state) {
  return Boolean(state?.installed);
}

function nextStepsForState(state) {
  return [
    '**Next Steps:**',
    '1. Restart Codex if the plugin install changed anything.',
    '2. Open `/hooks` in Codex.',
    `3. Verify the enabled Toolkit \`SessionStart\` hook belongs to the installed \`ai-agent-toolkit\` plugin at version \`${EXPECTED_TOOLKIT_VERSION}\`.`,
    `4. The supported hook normally runs from the installed plugin-cache copy${state.cacheRoot ? ` at \`${state.cacheRoot}\`` : ''}, not the managed Git checkout.`,
    `5. ${state.hookTrustMessage}`,
    '',
    'This hook approval step applies to Codex only. Claude Code does not need Codex hook approval.',
    'Codex must not install or update Claude Code. Claude Code must not install or update Codex.'
  ];
}

async function runCodexAddAndVerify(command, addArgs, options) {
  const deadlineMs = pluginAddDeadlineMs();
  const pollMs = pluginAddPollMs();
  const startedAt = Date.now();
  let child;
  let childExit = null;
  let childError = null;
  let lastState = null;
  let lastListError = null;
  let hookChanged = false;

  try {
    child = spawnCodexProcess(command, addArgs, { env: process.env });
    child.on('exit', (code, signal) => {
      childExit = { code, signal };
    });
    child.on('error', (error) => {
      childError = error;
    });
    child.unref();
  } catch (error) {
    throw new Error(`codex ${addArgs.join(' ')} failed to start: ${error.message}`);
  }

  while (Date.now() - startedAt <= deadlineMs) {
    try {
      const pluginList = runCodexJson(command, ['plugin', 'list', '--json', '--available']);
      lastListError = null;
      try {
        const prepared = prepareInstalledSessionStartIfPresent(options);
        hookChanged = hookChanged || prepared.hooksChanged;
      } catch {
        // Installed-state verification below reports an unsafe or incomplete cache.
      }
      lastState = evaluateCodexToolkitPluginState(pluginList, {
        codexHome: options.codexHome,
        repoRoot: options.repoRoot,
        allowConfigCacheFallback: true
      });
      if (lastState.ok) {
        const addDidNotExitCleanly = !childExit || childExit.code !== 0;
        terminateChild(child);
        return {
          state: lastState,
          hookChanged,
          warning: addDidNotExitCleanly ? codexAddTimeoutWarning(addArgs) : ''
        };
      }
    } catch (error) {
      lastListError = error;
    }

    if (childError) {
      terminateChild(child);
      throw new Error(`codex ${addArgs.join(' ')} failed: ${childError.message}; installed-state verification failed: ${formatStateErrors(lastState, lastListError)}`);
    }

    if (childExit && childExit.code !== 0) {
      terminateChild(child);
      throw new Error(`codex ${addArgs.join(' ')} exited with ${childExit.code}${childExit.signal ? ` signal ${childExit.signal}` : ''}; installed-state verification failed: ${formatStateErrors(lastState, lastListError)}`);
    }

    await sleep(pollMs);
  }

  terminateChild(child);
  throw new Error(`codex ${addArgs.join(' ')} did not produce a verified install within ${deadlineMs}ms; installed-state verification failed: ${formatStateErrors(lastState, lastListError)}`);
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    repoRoot: repoRootFromScript(),
    codexHome: defaultCodexHome(),
    codexCommand: '',
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
    else if (arg === '--write') options.write = true;
    else if (arg === '--verify') options.write = false;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  options.repoRoot = path.resolve(options.repoRoot);
  options.codexHome = path.resolve(options.codexHome);
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
  let pluginList;
  let state;
  let pluginChanged = false;

  try {
    pluginList = runCodexJson(resolved.command, ['plugin', 'list', '--json', '--available']);
    if (options.write) {
      try {
        const prepared = prepareInstalledSessionStartIfPresent({ codexHome: options.codexHome });
        pluginChanged = pluginChanged || prepared.hooksChanged;
      } catch {
        // A stale unsupported cache is handled by the supported reinstall path.
      }
    }
    state = evaluateCodexToolkitPluginState(pluginList, {
      codexHome: options.codexHome,
      repoRoot: options.repoRoot,
      allowConfigCacheFallback: true
    });
  } catch (error) {
    console.error(`FAIL: ${error.message}`);
    return 1;
  }

  if (!state.ok && options.write && !state.refusesDowngrade) {
    try {
      runCodexJson(resolved.command, ['plugin', 'marketplace', 'add', options.repoRoot, '--json']);
      pluginList = runCodexJson(resolved.command, ['plugin', 'list', '--json', '--available']);
      try {
        const prepared = prepareInstalledSessionStartIfPresent({ codexHome: options.codexHome });
        pluginChanged = pluginChanged || prepared.hooksChanged;
      } catch {
        // Verification decides whether reinstall is required.
      }
      state = evaluateCodexToolkitPluginState(pluginList, {
        codexHome: options.codexHome,
        repoRoot: options.repoRoot,
        allowConfigCacheFallback: true
      });

      if (!state.ok) {
        pluginChanged = true;
        if (shouldRemoveBeforeInstall(state)) {
          runCodexJson(resolved.command, ['plugin', 'remove', pluginId(), '--json']);
        }
        const addArgs = ['plugin', 'add', pluginId(), '--json'];
        const addOutcome = await runCodexAddAndVerify(resolved.command, addArgs, {
          codexHome: options.codexHome,
          repoRoot: options.repoRoot
        });
        state = addOutcome.state;
        pluginChanged = pluginChanged || addOutcome.hookChanged;
        if (addOutcome.warning) warnings.push(addOutcome.warning);
      }
    } catch (error) {
      console.error(`FAIL: ${error.message}`);
      return 1;
    }
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
  MARKETPLACE_REL_PATH,
  CACHE_FINGERPRINT_PATHS,
  CACHE_FINGERPRINT_DIRS,
  SESSION_START_ARGS,
  SESSION_START_LAUNCHER_REL_PATH,
  SESSION_START_POWERSHELL_REL_PATH,
  SESSION_START_RUNTIME_REL_PATH,
  codexToolkitInstallCommands,
  defaultWindowsPowerShellPath,
  evaluateCodexToolkitPluginState,
  findInstalledPluginEntries,
  inspectCodexConfiguredPluginState,
  inspectCodexPluginList,
  inspectConfiguredPluginState,
  prepareInstalledSessionStart,
  prepareInstalledSessionStartIfPresent,
  sourceSessionStartCommand,
  validateMarketplaceWrapper,
  validateRepoPluginSource,
  verifyInstalledCacheFreshness,
  verifySessionStartHook,
  verifySessionStartRuntime,
  windowsSessionStartCommand,
  formatWindowsAliasFailure,
  isWindowsAppsAliasAccessDenied,
  windowsAliasCliCandidate,
  main
};
