#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const TOOLKIT_PLUGIN_NAME = 'ai-agent-toolkit';
const TOOLKIT_MARKETPLACE_NAME = 'ai-agent-toolkit-local';
const EXPECTED_TOOLKIT_VERSION = '2.2.0';
const MARKETPLACE_REL_PATH = '.agents/plugins/marketplace.json';

function slash(value) {
  return String(value || '').replace(/\\/g, '/');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
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

function verifySessionStartHook(hooksPath) {
  const errors = [];
  const hooks = readJson(hooksPath);
  const sessionStart = hooks?.hooks?.SessionStart;
  if (!Array.isArray(sessionStart) || sessionStart.length === 0) {
    return ['must include a SessionStart hook'];
  }
  const commands = [];
  for (const group of sessionStart) {
    for (const hook of group?.hooks || []) {
      if (hook?.type === 'command' && typeof hook.command === 'string') commands.push(hook.command);
    }
  }
  if (commands.length === 0) errors.push('SessionStart must include a command hook');
  const joined = commands.join('\n');
  if (!/toolkit-local-bridge\.cjs/.test(joined)) {
    errors.push('SessionStart command must call toolkit-local-bridge.cjs');
  }
  if (!/--sync-source codex-plugin/.test(joined)) {
    errors.push('SessionStart command must use --sync-source codex-plugin');
  }
  return errors;
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

function findInstalledEntry(pluginList) {
  const installed = Array.isArray(pluginList?.installed) ? pluginList.installed : [];
  return installed.find((entry) =>
    entry &&
    (entry.pluginId === pluginId() ||
      (entry.name === TOOLKIT_PLUGIN_NAME && entry.marketplaceName === TOOLKIT_MARKETPLACE_NAME))
  ) || null;
}

function evaluateCodexToolkitPluginState(pluginList, options = {}) {
  const codexHome = path.resolve(options.codexHome || defaultCodexHome());
  const repoRoot = path.resolve(options.repoRoot || repoRootFromScript());
  const expectedVersion = options.expectedVersion || EXPECTED_TOOLKIT_VERSION;
  const errors = [];
  const installed = findInstalledEntry(pluginList);

  if (!installed) {
    errors.push(`${pluginId()} is not installed`);
    return { ok: false, installed: null, cacheRoot: cacheRootFor(codexHome, expectedVersion), errors };
  }
  if (!installed.enabled) errors.push(`${pluginId()} is installed but not enabled`);
  if (installed.version !== expectedVersion) {
    errors.push(`${pluginId()} expected version ${expectedVersion}: ${installed.version || '<missing>'}`);
  }
  if (installed.authPolicy !== 'ON_USE') {
    errors.push(`${pluginId()} expected authPolicy ON_USE for headless local install: ${installed.authPolicy || '<missing>'}`);
  }
  if (installed.source?.path && path.resolve(installed.source.path) !== repoRoot) {
    errors.push(`${pluginId()} source path does not match this local repo: ${installed.source.path}`);
  }

  const cacheRoot = cacheRootFor(codexHome, expectedVersion);
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
    errors.push(...verifySessionStartHook(cacheHooksPath).map((error) => `${pluginId()} cache ${error}`));
  }

  return { ok: errors.length === 0, installed, cacheRoot, errors };
}

function commandOutput(result) {
  return `${result.stdout || ''}${result.stderr || ''}${result.error ? result.error.message : ''}`.trim();
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

function pluginAddTimeoutMs() {
  if (process.env.CODEX_TOOLKIT_CODEX_CLI_ADD_TIMEOUT_MS) {
    return positiveIntEnv('CODEX_TOOLKIT_CODEX_CLI_ADD_TIMEOUT_MS', 15000);
  }
  if (process.env.CODEX_TOOLKIT_CODEX_CLI_TIMEOUT_MS) {
    return positiveIntEnv('CODEX_TOOLKIT_CODEX_CLI_TIMEOUT_MS', 15000);
  }
  return 15000;
}

function spawnCodex(command, args, options = {}) {
  const isNodeScript = /\.(?:cjs|mjs|js)$/i.test(command);
  return spawnSync(isNodeScript ? process.execPath : command, isNodeScript ? [command, ...args] : args, {
    ...options,
    windowsHide: true
  });
}

function commandTimedOut(result) {
  return result?.error?.code === 'ETIMEDOUT';
}

function commandCandidates(explicitCommand) {
  const candidates = [];
  if (explicitCommand) candidates.push(explicitCommand);
  if (process.env.CODEX_TOOLKIT_CODEX_CLI) candidates.push(process.env.CODEX_TOOLKIT_CODEX_CLI);
  if (process.env.CODEX_CLI_PATH) candidates.push(process.env.CODEX_CLI_PATH);
  if (process.platform === 'win32') {
    candidates.push(path.join(defaultCodexHome(), 'plugins', '.plugin-appserver', 'codex.exe'));
  } else {
    candidates.push(path.join(defaultCodexHome(), 'plugins', '.plugin-appserver', 'codex'));
  }
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
    failures.push(`${command}: ${commandOutput(result) || `exit ${result.status}`}`);
  }
  return { command: '', failures };
}

function runCodexJsonResult(command, args, options = {}) {
  const result = spawnCodex(command, args, {
    encoding: 'utf8',
    timeout: options.timeoutMs || commandTimeoutMs()
  });
  if (result.status !== 0) {
    return {
      ok: false,
      timedOut: commandTimedOut(result),
      error: `codex ${args.join(' ')} failed: ${commandOutput(result)}`,
      result
    };
  }
  const output = (result.stdout || '').trim();
  try {
    return {
      ok: true,
      json: output ? JSON.parse(output) : {},
      result
    };
  } catch (error) {
    return {
      ok: false,
      timedOut: false,
      error: `codex ${args.join(' ')} returned invalid JSON: ${error.message}`,
      result
    };
  }
}

function runCodexJson(command, args) {
  const outcome = runCodexJsonResult(command, args);
  if (!outcome.ok) throw new Error(outcome.error);
  return outcome.json;
}

function codexAddTimeoutWarning(args) {
  return `codex ${args.join(' ')} did not exit cleanly, but installed-state verification passed`;
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
    'The local repo must expose .agents/plugins/marketplace.json and .codex-plugin/plugin.json.',
    'This script is Codex-only; it never installs or updates Claude Code.'
  ].join('\n');
}

function main(argv = process.argv.slice(2)) {
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

  const resolved = resolveCodexCommand(options.codexCommand);
  if (!resolved.command) {
    console.error('FAIL: local Codex plugin install is unsupported in this environment.');
    console.error('No usable Codex CLI with plugin marketplace commands was found; setup toolkit cannot complete native plugin activation.');
    for (const failure of resolved.failures) console.error(`  ${failure}`);
    return 2;
  }

  const warnings = [];
  let pluginList;
  let state;

  try {
    pluginList = runCodexJson(resolved.command, ['plugin', 'list', '--json', '--available']);
    state = evaluateCodexToolkitPluginState(pluginList, {
      codexHome: options.codexHome,
      repoRoot: options.repoRoot
    });
  } catch (error) {
    console.error(`FAIL: ${error.message}`);
    return 1;
  }

  if (!state.ok && options.write) {
    try {
      runCodexJson(resolved.command, ['plugin', 'marketplace', 'add', options.repoRoot, '--json']);
      pluginList = runCodexJson(resolved.command, ['plugin', 'list', '--json', '--available']);
      state = evaluateCodexToolkitPluginState(pluginList, {
        codexHome: options.codexHome,
        repoRoot: options.repoRoot
      });

      if (!state.ok) {
        const addArgs = ['plugin', 'add', pluginId(), '--json'];
        const addOutcome = runCodexJsonResult(resolved.command, addArgs, { timeoutMs: pluginAddTimeoutMs() });
        if (!addOutcome.ok && !addOutcome.timedOut) throw new Error(addOutcome.error);

        pluginList = runCodexJson(resolved.command, ['plugin', 'list', '--json', '--available']);
        state = evaluateCodexToolkitPluginState(pluginList, {
          codexHome: options.codexHome,
          repoRoot: options.repoRoot
        });

        if (!addOutcome.ok && addOutcome.timedOut) {
          if (state.ok) warnings.push(codexAddTimeoutWarning(addArgs));
          else throw new Error(`${addOutcome.error}; installed-state verification failed: ${state.errors.join('; ')}`);
        }
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

  const summary = {
    ok: true,
    plugin_id: pluginId(),
    version: EXPECTED_TOOLKIT_VERSION,
    enabled: true,
    cache_root: state.cacheRoot,
    install_path: codexToolkitInstallCommands(options.repoRoot),
    warnings
  };
  for (const warning of warnings) console.error(`WARN: ${warning}`);
  if (options.json) console.log(JSON.stringify(summary, null, 2));
  else console.log(`OK: ${pluginId()} is installed, enabled, version ${EXPECTED_TOOLKIT_VERSION}, and has a SessionStart hook in ${state.cacheRoot}`);
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  TOOLKIT_PLUGIN_NAME,
  TOOLKIT_MARKETPLACE_NAME,
  EXPECTED_TOOLKIT_VERSION,
  MARKETPLACE_REL_PATH,
  codexToolkitInstallCommands,
  evaluateCodexToolkitPluginState,
  validateMarketplaceWrapper,
  validateRepoPluginSource,
  verifySessionStartHook
};
