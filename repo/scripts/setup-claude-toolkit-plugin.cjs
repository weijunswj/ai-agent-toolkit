#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const TOOLKIT_PLUGIN_NAME = 'ai-agent-toolkit';
const TOOLKIT_MARKETPLACE_NAME = 'ai-agent-toolkit-local';
const EXPECTED_TOOLKIT_VERSION = '2.3.0';
const MARKETPLACE_REL_PATH = '.claude-plugin/marketplace.json';
const DEFAULT_SCOPE = 'project';
const VALID_SCOPES = ['user', 'project', 'local'];

function slash(value) {
  return String(value || '').replace(/\\/g, '/');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function repoRootFromScript() {
  return path.resolve(__dirname, '..', '..');
}

function marketplacePath(repoRoot) {
  return path.join(repoRoot, ...MARKETPLACE_REL_PATH.split('/'));
}

function pluginId() {
  return `${TOOLKIT_PLUGIN_NAME}@${TOOLKIT_MARKETPLACE_NAME}`;
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
  if (!/--sync-source claude-plugin/.test(joined)) {
    errors.push('SessionStart command must use --sync-source claude-plugin');
  }
  if (/--enable-target|--disable-target|--force-downgrade/.test(joined)) {
    errors.push('SessionStart command must not enable, disable, or force-downgrade targets');
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
  if (plugin.source !== '.') {
    errors.push(`${TOOLKIT_PLUGIN_NAME} marketplace source must be local path ".": ${JSON.stringify(plugin.source)}`);
  }
  return errors;
}

function validateRepoPluginSource(repoRoot, expectedVersion = EXPECTED_TOOLKIT_VERSION) {
  const errors = [];
  const manifestPath = path.join(repoRoot, '.claude-plugin', 'plugin.json');
  const hooksPath = path.join(repoRoot, '.claude-plugin', 'hooks', 'hooks.json');
  const localMarketplacePath = marketplacePath(repoRoot);

  if (!fs.existsSync(manifestPath)) {
    errors.push(`Missing Claude Code plugin manifest: ${slash(path.relative(repoRoot, manifestPath))}`);
  } else {
    const manifest = readJson(manifestPath);
    if (manifest.name !== TOOLKIT_PLUGIN_NAME) {
      errors.push(`Claude Code plugin manifest name must be ${TOOLKIT_PLUGIN_NAME}: ${manifest.name || '<missing>'}`);
    }
    if (manifest.version !== expectedVersion) {
      errors.push(`Claude Code plugin manifest expected version ${expectedVersion}: ${manifest.version || '<missing>'}`);
    }
    if (manifest.hooks !== './.claude-plugin/hooks/hooks.json') {
      errors.push(`Claude Code plugin manifest must reference .claude-plugin hooks: ${manifest.hooks || '<missing>'}`);
    }
  }

  if (!fs.existsSync(hooksPath)) {
    errors.push(`Missing Claude Code plugin hooks: ${slash(path.relative(repoRoot, hooksPath))}`);
  } else {
    const hookErrors = verifySessionStartHook(hooksPath);
    errors.push(...hookErrors.map((error) => `${slash(path.relative(repoRoot, hooksPath))}: ${error}`));
  }

  if (!fs.existsSync(localMarketplacePath)) {
    errors.push(`Missing local Claude Code marketplace wrapper: ${MARKETPLACE_REL_PATH}`);
  } else {
    const marketplace = readJson(localMarketplacePath);
    errors.push(...validateMarketplaceWrapper(marketplace));
  }

  return errors;
}

function commandOutput(result) {
  return `${result?.stdout || ''}${result?.stderr || ''}${result?.error ? result.error.message : ''}`.trim();
}

// On Windows, a global npm install of the Claude Code CLI resolves the bare
// `claude` command only to `claude.cmd`/`claude.ps1` shims, which Node's
// spawnSync cannot execute directly (ENOENT/EINVAL) without going through a
// shell. `shell: true` fixes that, but Node only concatenates array args with
// spaces rather than quoting them, which silently truncates any argument
// containing a space (e.g. a repo path) at the first space. Quote manually,
// following the standard Windows CommandLineToArgvW quoting algorithm: a
// backslash only needs doubling when it directly precedes a quote (either an
// escaped literal quote, or the closing quote appended at the end), since an
// unescaped trailing backslash would otherwise escape that following quote
// instead of terminating the argument.
function quoteWindowsArg(value) {
  const str = String(value);
  if (str === '') return '""';
  if (!/[\s"&|<>^%]/.test(str)) return str;

  let result = '"';
  let backslashes = 0;
  for (const ch of str) {
    if (ch === '\\') {
      backslashes += 1;
      continue;
    }
    if (ch === '"') {
      result += '\\'.repeat(backslashes * 2 + 1) + '"';
      backslashes = 0;
      continue;
    }
    result += '\\'.repeat(backslashes) + ch;
    backslashes = 0;
  }
  result += '\\'.repeat(backslashes * 2) + '"';
  return result;
}

function claudeSpawnParts(command, args) {
  const isNodeScript = /\.(?:cjs|mjs|js)$/i.test(command);
  if (isNodeScript) {
    return { command: process.execPath, args: [command, ...args], shell: false };
  }
  if (process.platform === 'win32') {
    // Pass a single pre-quoted command line (no args array) so Node hands it
    // to the shell as-is, instead of the array+shell:true form that both
    // mis-concatenates spaces and triggers a DEP0190 warning on every call.
    return { command: [command, ...args.map(quoteWindowsArg)].join(' '), args: undefined, shell: true };
  }
  return { command, args, shell: false };
}

function spawnClaude(command, args, options = {}) {
  const parts = claudeSpawnParts(command, args);
  return spawnSync(parts.command, parts.args, {
    ...options,
    shell: parts.shell,
    windowsHide: true
  });
}

function positiveIntEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function commandTimeoutMs() {
  return positiveIntEnv('CLAUDE_TOOLKIT_CLAUDE_CLI_TIMEOUT_MS', 120000);
}

function commandCandidates(explicitCommand) {
  const candidates = [];
  if (explicitCommand) candidates.push(explicitCommand);
  if (process.env.CLAUDE_TOOLKIT_CLAUDE_CLI) candidates.push(process.env.CLAUDE_TOOLKIT_CLAUDE_CLI);
  if (process.env.CLAUDE_CLI_PATH) candidates.push(process.env.CLAUDE_CLI_PATH);
  candidates.push('claude');
  return [...new Set(candidates.filter(Boolean))];
}

function resolveClaudeCommand(explicitCommand) {
  const failures = [];
  for (const command of commandCandidates(explicitCommand)) {
    const result = spawnClaude(command, ['--version'], { encoding: 'utf8', timeout: 10000 });
    if (result.status === 0) return { command, failures };
    failures.push(`${command}: ${commandOutput(result) || `exit ${result.status}`}`);
  }
  return { command: '', failures };
}

function runClaudeJson(command, args) {
  const result = spawnClaude(command, args, { encoding: 'utf8', timeout: commandTimeoutMs() });
  if (result.status !== 0) {
    throw new Error(`claude ${args.join(' ')} failed: ${commandOutput(result)}`);
  }
  const output = (result.stdout || '').trim();
  try {
    return output ? JSON.parse(output) : {};
  } catch (error) {
    throw new Error(`claude ${args.join(' ')} returned invalid JSON: ${error.message}`);
  }
}

function runClaudeCommand(command, args, options = {}) {
  return spawnClaude(command, args, { encoding: 'utf8', timeout: commandTimeoutMs(), ...options });
}

// `claude plugin list --json` returns a flat array of entries shaped like
// { id: "ai-agent-toolkit@ai-agent-toolkit-local", version, scope, enabled,
//   installPath, projectPath }, confirmed against a real Claude Code 2.1.197
// install. Match on `id` first; fall back to name/marketplace-style fields
// too, since this isn't a documented/versioned schema and could vary.
function findPluginEntries(node, matches = []) {
  if (!node || typeof node !== 'object') return matches;
  if (Array.isArray(node)) {
    for (const item of node) findPluginEntries(item, matches);
    return matches;
  }
  const id = node.id || '';
  const name = node.name || node.pluginName || '';
  const marketplace = node.marketplace || node.marketplaceName || node.source?.marketplace || '';
  const idMatches = id === pluginId();
  const nameMatches = name === TOOLKIT_PLUGIN_NAME && (!marketplace || marketplace === TOOLKIT_MARKETPLACE_NAME);
  if (idMatches || nameMatches) {
    matches.push(node);
  }
  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') findPluginEntries(value, matches);
  }
  return matches;
}

function evaluateClaudeToolkitPluginState(pluginList, options = {}) {
  const repoRoot = path.resolve(options.repoRoot || repoRootFromScript());
  const expectedVersion = options.expectedVersion || EXPECTED_TOOLKIT_VERSION;
  const errors = [];
  const matches = findPluginEntries(pluginList);
  const installed = matches.find((entry) => entry.enabled !== false) || matches[0] || null;

  if (!installed) {
    errors.push(`${pluginId()} is not installed`);
    return { ok: false, installed: null, errors };
  }
  if (installed.enabled === false) {
    errors.push(`${pluginId()} is installed but not enabled`);
  }
  if (installed.version && installed.version !== expectedVersion) {
    errors.push(`${pluginId()} expected version ${expectedVersion}: ${installed.version}`);
  }
  const sourcePath = installed.projectPath || installed.source?.path || installed.path || '';
  if (sourcePath && path.resolve(sourcePath) !== repoRoot) {
    errors.push(`${pluginId()} source path does not match this local repo: ${sourcePath}`);
  }

  return { ok: errors.length === 0, installed, errors };
}

function claudeToolkitInstallCommands(repoRoot, scope = DEFAULT_SCOPE) {
  return [
    ['plugin', 'marketplace', 'add', repoRoot],
    ['plugin', 'install', pluginId(), '--scope', scope]
  ];
}

function nextSteps(scope) {
  return [
    '**Next Steps:**',
    '1. Restart Claude Code if the plugin install changed anything.',
    `2. If Claude Code prompts to trust this local marketplace/plugin, approve it (source is this repo, scope ${scope}).`,
    '',
    'Claude Code must not install or update Codex. Codex must not install or update Claude Code.'
  ];
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    repoRoot: repoRootFromScript(),
    claudeCommand: '',
    scope: DEFAULT_SCOPE,
    write: false,
    json: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index] || '';
    if (arg === '--repo-root') options.repoRoot = next();
    else if (arg.startsWith('--repo-root=')) options.repoRoot = arg.slice('--repo-root='.length);
    else if (arg === '--claude-cli') options.claudeCommand = next();
    else if (arg.startsWith('--claude-cli=')) options.claudeCommand = arg.slice('--claude-cli='.length);
    else if (arg === '--scope') options.scope = next();
    else if (arg.startsWith('--scope=')) options.scope = arg.slice('--scope='.length);
    else if (arg === '--write') options.write = true;
    else if (arg === '--verify') options.write = false;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!VALID_SCOPES.includes(options.scope)) {
    throw new Error(`--scope must be one of ${VALID_SCOPES.join(', ')}: ${options.scope}`);
  }
  options.repoRoot = path.resolve(options.repoRoot);
  return options;
}

function usage() {
  return [
    'Usage: node repo/scripts/setup-claude-toolkit-plugin.cjs [--verify] [--write] [--scope user|project|local] [--json]',
    '',
    'Verifies or installs the Toolkit Claude Code native plugin through supported Claude Code plugin commands.',
    'The supported install path is:',
    `  claude plugin marketplace add <local-ai-agent-toolkit-repo>`,
    `  claude plugin install ${pluginId()} --scope ${DEFAULT_SCOPE}`,
    '',
    'The local repo must expose .claude-plugin/marketplace.json and .claude-plugin/plugin.json.',
    'This script is Claude Code-only; it never installs or updates Codex.'
  ].join('\n');
}

async function main(argv = process.argv.slice(2)) {
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

  const resolved = resolveClaudeCommand(options.claudeCommand);
  if (!resolved.command) {
    console.error('FAIL: local Claude Code plugin install is unsupported in this environment.');
    console.error('No usable Claude Code CLI was found; setup toolkit cannot complete native plugin activation.');
    for (const failure of resolved.failures) console.error(`  ${failure}`);
    return 2;
  }

  const warnings = [];
  let state;

  try {
    const pluginList = runClaudeJson(resolved.command, ['plugin', 'list', '--json']);
    state = evaluateClaudeToolkitPluginState(pluginList, { repoRoot: options.repoRoot });
  } catch (error) {
    console.error(`FAIL: ${error.message}`);
    return 1;
  }

  if (!state.ok && options.write) {
    const marketplaceAdd = runClaudeCommand(resolved.command, ['plugin', 'marketplace', 'add', options.repoRoot]);
    if (marketplaceAdd.status !== 0) {
      warnings.push(`claude plugin marketplace add did not exit cleanly: ${commandOutput(marketplaceAdd)}`);
    }
    const install = runClaudeCommand(resolved.command, ['plugin', 'install', pluginId(), '--scope', options.scope]);
    if (install.status !== 0) {
      warnings.push(`claude plugin install did not exit cleanly: ${commandOutput(install)}`);
    }
    try {
      const pluginList = runClaudeJson(resolved.command, ['plugin', 'list', '--json']);
      state = evaluateClaudeToolkitPluginState(pluginList, { repoRoot: options.repoRoot });
    } catch (error) {
      console.error(`FAIL: ${error.message}`);
      return 1;
    }
  }

  if (!state.ok) {
    for (const error of state.errors) console.error(`FAIL: ${error}`);
    for (const warning of warnings) console.error(`WARN: ${warning}`);
    console.error('Run with --write to install or update through the supported Claude Code local marketplace path.');
    console.error(`Expected commands: ${claudeToolkitInstallCommands(options.repoRoot, options.scope).map((args) => `claude ${args.join(' ')}`).join(' ; ')}`);
    return 1;
  }

  const summary = {
    ok: true,
    plugin_id: pluginId(),
    version: EXPECTED_TOOLKIT_VERSION,
    enabled: true,
    scope: options.scope,
    install_path: claudeToolkitInstallCommands(options.repoRoot, options.scope),
    next_steps: nextSteps(options.scope),
    warnings
  };
  for (const warning of warnings) console.error(`WARN: ${warning}`);
  if (options.json) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(`OK: ${pluginId()} is installed and enabled, version ${EXPECTED_TOOLKIT_VERSION}, scope ${options.scope}.`);
    console.log('');
    console.log(nextSteps(options.scope).join('\n'));
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
  DEFAULT_SCOPE,
  VALID_SCOPES,
  claudeToolkitInstallCommands,
  claudeSpawnParts,
  evaluateClaudeToolkitPluginState,
  findPluginEntries,
  quoteWindowsArg,
  validateMarketplaceWrapper,
  validateRepoPluginSource,
  verifySessionStartHook,
  pluginId
};
