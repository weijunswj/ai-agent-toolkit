#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const processLaunch = require('./claude-process-launch.cjs');

const TOOLKIT_PLUGIN_NAME = 'ai-agent-toolkit';
const TOOLKIT_MARKETPLACE_NAME = 'ai-agent-toolkit-local';
const PLUGIN_MANIFEST_REL_PATH = '.claude-plugin/plugin.json';
const MARKETPLACE_REL_PATH = '.claude-plugin/marketplace.json';
const DEFAULT_SCOPE = 'user';
const VALID_SCOPES = ['user', 'project', 'local'];
const N8N_ADMISSION_HOOK_COMMAND = 'node "${CLAUDE_PLUGIN_ROOT}/repo/scripts/toolkit-claude-n8n-admission-hook.cjs"';
const N8N_MUTATION_MATCHER = 'Write|Edit|MultiEdit|NotebookEdit|Bash|PowerShell|^mcp__[^\\s]*n8n[^\\s]*__[^\\s]+$';

function slash(value) {
  return String(value || '').replace(/\\/g, '/');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return readJson(filePath);
}

function repoRootFromScript() {
  return path.resolve(__dirname, '..', '..');
}

function marketplacePath(repoRoot) {
  return path.join(repoRoot, ...MARKETPLACE_REL_PATH.split('/'));
}

function pluginManifestPath(repoRoot) {
  return path.join(repoRoot, ...PLUGIN_MANIFEST_REL_PATH.split('/'));
}

function readExpectedToolkitVersion(repoRoot = repoRootFromScript()) {
  const manifest = readJson(pluginManifestPath(repoRoot));
  if (!manifest.version || typeof manifest.version !== 'string') {
    throw new Error(`Claude Code plugin manifest must declare a string version: ${PLUGIN_MANIFEST_REL_PATH}`);
  }
  return manifest.version;
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

function pluginId() {
  return `${TOOLKIT_PLUGIN_NAME}@${TOOLKIT_MARKETPLACE_NAME}`;
}

function claudeConfigDir(options = {}) {
  return path.resolve(options.claudeConfigDir || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'));
}

function repoCommit(repoRoot) {
  const result = spawnSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true
  });
  return result.status === 0 ? String(result.stdout || '').trim().toLowerCase() : '';
}

function readClaudePluginRegistryState(options = {}) {
  const configRoot = claudeConfigDir(options);
  return {
    knownMarketplaces: readJsonIfExists(path.join(configRoot, 'plugins', 'known_marketplaces.json')),
    installedPlugins: readJsonIfExists(path.join(configRoot, 'plugins', 'installed_plugins.json')),
    repoCommit: options.repoCommit || repoCommit(path.resolve(options.repoRoot || repoRootFromScript()))
  };
}

function registrySourceEvidence(installed, repoRoot, expectedVersion, options = {}) {
  let registry;
  try {
    registry = Object.prototype.hasOwnProperty.call(options, 'registryState')
      ? options.registryState
      : readClaudePluginRegistryState({ ...options, repoRoot });
  } catch {
    return { ok: false, reason: 'Claude plugin registry state could not be read safely' };
  }
  const marketplaces = registry?.knownMarketplaces || {};
  const marketplace = marketplaces[TOOLKIT_MARKETPLACE_NAME]
    || marketplaces.marketplaces?.[TOOLKIT_MARKETPLACE_NAME]
    || null;
  const sourcePath = marketplace?.source?.path || marketplace?.path || '';
  if (!sourcePath || path.resolve(sourcePath) !== repoRoot) {
    return { ok: false, reason: 'Claude local marketplace source identity does not match the managed Toolkit checkout' };
  }

  const pluginRecords = registry?.installedPlugins?.plugins?.[pluginId()]
    ?? registry?.installedPlugins?.[pluginId()]
    ?? [];
  const records = Array.isArray(pluginRecords) ? pluginRecords : [pluginRecords];
  const installPath = installed?.installPath ? path.resolve(installed.installPath) : '';
  const matching = records.filter((entry) => entry && entry.installPath
    && path.resolve(entry.installPath) === installPath
    && (!installed.scope || !entry.scope || entry.scope === installed.scope));
  if (matching.length !== 1) {
    return { ok: false, reason: 'Claude installed-plugin registry identity is missing or ambiguous' };
  }
  const record = matching[0];
  if (record.version !== expectedVersion || installed.version !== expectedVersion) {
    return { ok: false, reason: 'Claude installed-plugin registry version is not current' };
  }
  const expectedCommit = String(registry?.repoCommit || '').toLowerCase();
  const installedCommit = String(record.gitCommitSha || '').toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(expectedCommit) || installedCommit !== expectedCommit) {
    return { ok: false, reason: 'Claude installed-plugin source commit does not match the managed Toolkit checkout' };
  }
  return { ok: true, sourcePath: repoRoot, sourceIdentity: 'claude-plugin-registry' };
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
  const preToolUse = hooks?.hooks?.PreToolUse;
  const agentGroups = Array.isArray(preToolUse)
    ? preToolUse.filter((group) => /(?:^|\|)(?:Agent|Task)(?:\||$)/.test(String(group?.matcher || '')))
    : [];
  const agentCommands = agentGroups.flatMap((group) => group?.hooks || [])
    .filter((hook) => hook?.type === 'command')
    .map((hook) => String(hook.command || ''));
  if (!agentCommands.some((command) => command.includes('${CLAUDE_PLUGIN_ROOT}/repo/scripts/toolkit-claude-agent-hook.cjs'))) {
    errors.push('PreToolUse Agent hook must call toolkit-claude-agent-hook.cjs through CLAUDE_PLUGIN_ROOT');
  }
  const requiresExactHook = (eventName, matcher, label) => {
    const groups = hooks?.hooks?.[eventName];
    const exact = Array.isArray(groups) && groups.some((group) => (
      (matcher === null || group?.matcher === matcher)
      && Array.isArray(group?.hooks)
      && group.hooks.some((hook) => hook?.type === 'command' && hook.command === N8N_ADMISSION_HOOK_COMMAND)
    ));
    if (!exact) errors.push(`${label} must call the exact Toolkit n8n admission hook through CLAUDE_PLUGIN_ROOT`);
  };
  requiresExactHook('PreToolUse', N8N_MUTATION_MATCHER, 'PreToolUse governed-mutation hook');
  requiresExactHook('PostToolUse', 'Skill', 'PostToolUse Skill evidence hook');
  requiresExactHook('PostToolUse', 'Bash|PowerShell', 'PostToolUse non-Skill capability-receipt hook');
  requiresExactHook('UserPromptSubmit', null, 'UserPromptSubmit n8n intent hook');
  requiresExactHook('UserPromptExpansion', null, 'UserPromptExpansion direct-Skill disclosure hook');
  requiresExactHook('TaskCompleted', null, 'TaskCompleted n8n completion hook');
  requiresExactHook('Stop', null, 'Stop n8n completion hook');
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
  if (plugin.source !== './') {
    errors.push(`${TOOLKIT_PLUGIN_NAME} marketplace source must be local path "./": ${JSON.stringify(plugin.source)}`);
  }
  return errors;
}

function validateRepoPluginSource(repoRoot, expectedVersion = '') {
  const errors = [];
  const manifestPath = pluginManifestPath(repoRoot);
  const hooksPath = path.join(repoRoot, '.claude-plugin', 'hooks', 'hooks.json');
  const localMarketplacePath = marketplacePath(repoRoot);

  if (!fs.existsSync(manifestPath)) {
    errors.push(`Missing Claude Code plugin manifest: ${slash(path.relative(repoRoot, manifestPath))}`);
  } else {
    const manifest = readJson(manifestPath);
    if (manifest.name !== TOOLKIT_PLUGIN_NAME) {
      errors.push(`Claude Code plugin manifest name must be ${TOOLKIT_PLUGIN_NAME}: ${manifest.name || '<missing>'}`);
    }
    if (!manifest.version || typeof manifest.version !== 'string') {
      errors.push('Claude Code plugin manifest must declare a string version');
    }
    if (expectedVersion && manifest.version !== expectedVersion) {
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

  for (const relPath of ['repo/scripts/repo-ignore-hygiene.cjs', 'repo/scripts/repo-local-backup.cjs']) {
    if (!fs.existsSync(path.join(repoRoot, ...relPath.split('/')))) errors.push(`Missing repo-local safety package file: ${relPath}`);
  }
  for (const relPath of [
    'repo/scripts/toolkit-agent-control.cjs',
    'repo/scripts/toolkit-claude-agent-hook.cjs',
    'repo/scripts/toolkit-claude-n8n-admission-hook.cjs',
    'repo/scripts/toolkit-local-bridge.cjs',
    'skills/external-system-router/scripts/external-system-router.cjs',
    'skills/external-system-router/scripts/n8n-domain-router.cjs',
  ]) {
    if (!fs.existsSync(path.join(repoRoot, ...relPath.split('/')))) errors.push(`Missing Claude agent-control package file: ${relPath}`);
  }

  if (!fs.existsSync(localMarketplacePath)) {
    errors.push(`Missing local Claude Code marketplace wrapper: ${MARKETPLACE_REL_PATH}`);
  } else {
    const marketplace = readJson(localMarketplacePath);
    errors.push(...validateMarketplaceWrapper(marketplace));
  }

  return errors;
}
function validateInstalledEnforcement(installed, repoRoot, expectedVersion) {
  const errors = [];
  const installPath = installed?.installPath ? path.resolve(installed.installPath) : '';
  if (!installPath) return ['installed plugin state does not expose an exact cache path'];
  const pairs = [
    ['.claude-plugin/plugin.json', true],
    ['.claude-plugin/hooks/hooks.json', true],
    ['repo/scripts/toolkit-agent-control.cjs', false],
    ['repo/scripts/claude-process-launch.cjs', false],
    ['repo/scripts/toolkit-claude-agent-hook.cjs', false],
    ['repo/scripts/toolkit-claude-n8n-admission-hook.cjs', false],
    ['repo/scripts/toolkit-local-bridge.cjs', false],
    ['skills/external-system-router/scripts/external-system-router.cjs', false],
    ['skills/external-system-router/scripts/n8n-domain-router.cjs', false],
    ['repo/scripts/repo-ignore-hygiene.cjs', false],
    ['repo/scripts/repo-local-backup.cjs', false],
  ];
  for (const [relPath, json] of pairs) {
    const source = path.join(repoRoot, ...relPath.split('/'));
    const installedFile = path.join(installPath, ...relPath.split('/'));
    if (!fs.existsSync(installedFile)) {
      errors.push(`installed plugin cache is missing ${relPath}`);
      continue;
    }
    if (!fs.lstatSync(installedFile).isFile()) {
      errors.push(`installed plugin cache entry is not a regular file: ${relPath}`);
      continue;
    }
    const sourceBytes = fs.readFileSync(source);
    const installedBytes = fs.readFileSync(installedFile);
    if (!sourceBytes.equals(installedBytes)) errors.push(`installed plugin cache is stale for ${relPath}`);
    if (json && relPath.endsWith('plugin.json')) {
      try {
        const manifest = JSON.parse(installedBytes.toString('utf8'));
        if (manifest.name !== TOOLKIT_PLUGIN_NAME || manifest.version !== expectedVersion) errors.push('installed plugin identity or version is not current');
      } catch { errors.push('installed plugin manifest is invalid'); }
    }
    if (json && relPath.endsWith('hooks.json')) {
      try {
        const hooks = JSON.parse(installedBytes.toString('utf8'));
        const hookErrors = verifySessionStartHook(installedFile);
        errors.push(...hookErrors.map((error) => `installed plugin cache ${error}`));
      } catch { errors.push('installed plugin hooks are invalid'); }
    }
  }
  return errors;
}

function installedActivationProof(installed, expectedVersion) {
  const cachePath = path.resolve(String(installed?.installPath || ''));
  const hookPath = path.join(cachePath, '.claude-plugin', 'hooks', 'hooks.json');
  const controllerPath = path.join(cachePath, 'repo', 'scripts', 'toolkit-agent-control.cjs');
  const processLaunchPath = path.join(cachePath, 'repo', 'scripts', 'claude-process-launch.cjs');
  const agentHookPath = path.join(cachePath, 'repo', 'scripts', 'toolkit-claude-agent-hook.cjs');
  const n8nAdmissionHookPath = path.join(cachePath, 'repo', 'scripts', 'toolkit-claude-n8n-admission-hook.cjs');
  const externalSystemRouterPath = path.join(cachePath, 'skills', 'external-system-router', 'scripts', 'external-system-router.cjs');
  const n8nDomainRouterPath = path.join(cachePath, 'skills', 'external-system-router', 'scripts', 'n8n-domain-router.cjs');
  for (const filePath of [hookPath, controllerPath, processLaunchPath, agentHookPath, n8nAdmissionHookPath, externalSystemRouterPath, n8nDomainRouterPath]) {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Installed Claude enforcement path is not a regular file.');
  }
  return {
    schema: 5,
    source: 'claude-plugin-list',
    plugin_version: expectedVersion,
    cache_identity: crypto.createHash('sha256').update(cachePath).digest('hex'),
    hook_sha256: crypto.createHash('sha256').update(fs.readFileSync(hookPath)).digest('hex'),
    controller_sha256: crypto.createHash('sha256').update(fs.readFileSync(controllerPath)).digest('hex'),
    process_launch_sha256: crypto.createHash('sha256').update(fs.readFileSync(processLaunchPath)).digest('hex'),
    agent_hook_sha256: crypto.createHash('sha256').update(fs.readFileSync(agentHookPath)).digest('hex'),
    n8n_admission_hook_sha256: crypto.createHash('sha256').update(fs.readFileSync(n8nAdmissionHookPath)).digest('hex'),
    external_system_router_sha256: crypto.createHash('sha256').update(fs.readFileSync(externalSystemRouterPath)).digest('hex'),
    n8n_domain_router_sha256: crypto.createHash('sha256').update(fs.readFileSync(n8nDomainRouterPath)).digest('hex'),
  };
}

function sameActivationProof(left, right) {
  return [
    'schema',
    'source',
    'plugin_version',
    'cache_identity',
    'hook_sha256',
    'controller_sha256',
    'process_launch_sha256',
    'agent_hook_sha256',
    'n8n_admission_hook_sha256',
    'external_system_router_sha256',
    'n8n_domain_router_sha256',
  ]
    .every((key) => left?.[key] === right?.[key]);
}

function verifyCurrentInstalledEnforcement(expectedProof, options = {}) {
  try {
    const requestedCommand = processLaunch.resolveClaudeCommandInput({
      explicit: options.claudeCommand,
      persisted: options.persistedCommand,
      env: Object.prototype.hasOwnProperty.call(options, 'env') ? options.env : process.env,
    });
    const command = processLaunch.assertExecutableAvailable(requestedCommand, options);
    const versionResult = spawnClaude(command, ['--version'], { encoding: 'utf8', timeout: probeTimeoutMs(), env: options.env });
    if (versionResult.status !== 0) throw new Error(commandOutput(versionResult) || 'Claude CLI version probe failed.');
    const matches = findPluginEntries(runClaudeJson(command, ['plugin', 'list', '--json'], { env: options.env }));
    const matching = matches.filter((entry) => {
      if (!entry?.installPath) return false;
      const identity = crypto.createHash('sha256').update(path.resolve(entry.installPath)).digest('hex');
      return identity === expectedProof?.cache_identity;
    });
    if (matching.length !== 1) throw new Error('Current Claude plugin cache identity is missing or ambiguous.');
    const installed = matching[0];
    if (installed.enabled !== true) throw new Error('Current Claude plugin enabled state is not verified.');
    if (installed.trusted !== true) throw new Error('Current Claude plugin trust state is not verified.');
    if (installed.hooksActive !== true && installed.hookExecutionActive !== true) throw new Error('Current Claude hook-active state is not verified.');
    if (installed.version !== expectedProof?.plugin_version) throw new Error('Current Claude plugin version does not match the activation proof.');
    const cachePath = path.resolve(installed.installPath);
    const cacheStat = fs.lstatSync(cachePath);
    if (!cacheStat.isDirectory() || cacheStat.isSymbolicLink()) throw new Error('Current Claude plugin cache is not a regular directory.');
    const hookErrors = verifySessionStartHook(path.join(cachePath, '.claude-plugin', 'hooks', 'hooks.json'));
    if (hookErrors.length) throw new Error(hookErrors.join('; '));
    const currentProof = installedActivationProof(installed, installed.version);
    if (!sameActivationProof(currentProof, expectedProof)) throw new Error('Current Claude enforcement identity does not match the activation proof.');
    return { verified: true, activation_proof: currentProof };
  } catch (error) {
    return { verified: false, reason: error.message };
  }
}

function commandOutput(result) {
  return `${result?.stdout || ''}${result?.stderr || ''}${result?.error ? result.error.message : ''}`.trim();
}

function claudeSpawnParts(command, args, options = {}) {
  return processLaunch.claudeSpawnParts(command, args, options);
}

function spawnClaude(command, args, options = {}) {
  const parts = claudeSpawnParts(command, args, options);
  // The executable is validated and argv remains separate; shell interpretation is never enabled.
  // codeql[js/shell-command-injection-from-environment]
  return spawnSync(parts.command, parts.args, {
    ...options,
    windowsVerbatimArguments: parts.windowsVerbatimArguments,
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

const MUTATION_DEADLINE_DEFAULT_MS = 120000;
const MUTATION_POLL_DEFAULT_MS = 500;
// Reject unreasonably large overrides (over one hour) so a typo cannot make
// setup wait effectively forever; reject sub-25ms polling so a typo cannot
// turn the verification loop into a busy loop.
const MUTATION_DEADLINE_MAX_MS = 60 * 60 * 1000;
const MUTATION_POLL_MIN_MS = 25;

// Strict decimal-integer override parsing: only a trimmed string of decimal
// digits within [min, max] is accepted. Partial-number forms that parseInt
// would silently truncate ('100junk', '100.5', '1e3'), signs, empty or
// whitespace-only input, zero/negative values (below min), and values above
// the documented maximum all fall back to the default.
function boundedIntEnv(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw === undefined || raw === null) return fallback;
  const trimmed = String(raw).trim();
  if (!/^\d+$/.test(trimmed)) return fallback;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

// One mutation helper owns both `plugin update` and `plugin install`, so the
// controls use the general MUTATION name rather than per-command names.
function mutationDeadlineMs() {
  return boundedIntEnv('CLAUDE_TOOLKIT_CLAUDE_PLUGIN_MUTATION_DEADLINE_MS', MUTATION_DEADLINE_DEFAULT_MS, 1, MUTATION_DEADLINE_MAX_MS);
}

function mutationPollMs() {
  return boundedIntEnv('CLAUDE_TOOLKIT_CLAUDE_PLUGIN_MUTATION_POLL_MS', MUTATION_POLL_DEFAULT_MS, MUTATION_POLL_MIN_MS, MUTATION_DEADLINE_MAX_MS);
}

const PROBE_TIMEOUT_DEFAULT_MS = 10000;
const PROBE_TIMEOUT_MAX_MS = 60000;

function probeTimeoutMs() {
  return boundedIntEnv('CLAUDE_TOOLKIT_CLAUDE_CLI_PROBE_TIMEOUT_MS', PROBE_TIMEOUT_DEFAULT_MS, 1, PROBE_TIMEOUT_MAX_MS);
}

// The canonical resolver selects exactly one effective command by precedence,
// so a current override cannot silently fall through to a different CLI.
function resolutionBudgetMs(explicitCommand = '') {
  return commandCandidates(explicitCommand).length * probeTimeoutMs();
}

// Worst-case wall-clock budget for one `--verify` run: the full CLI
// resolution sequence, one plugin list, plus spawn/report grace. The setup
// orchestrator derives its outer timeout from this (passing the exact same
// explicit CLI argument and environment the child helper receives) so it
// cannot kill a verify that is still within this helper's own supported
// per-command budgets.
function verifyBudgetMs(explicitCommand = '') {
  return resolutionBudgetMs(explicitCommand) + commandTimeoutMs() + 15000;
}

// Worst-case wall-clock budget for one full `--write` run. Each mutation
// phase may take its verification deadline plus one in-flight plugin list
// call that started just before the deadline expired. This is a ceiling for
// the orchestrator's outer timeout, not an expected duration.
function writeBudgetMs(explicitCommand = '') {
  const mutationPhase = mutationDeadlineMs() + commandTimeoutMs();
  return resolutionBudgetMs(explicitCommand) // full CLI candidate resolution
    + commandTimeoutMs() // initial plugin list
    + mutationPhase // in-place plugin update + state polling
    + commandTimeoutMs() // plugin uninstall fallback
    + commandTimeoutMs() // plugin marketplace add
    + mutationPhase // plugin install + state polling
    + 15000; // spawn/cleanup/JSON-report grace
}

function commandCandidates(explicitCommand, options = {}) {
  return [processLaunch.resolveClaudeCommandInput({
    explicit: explicitCommand,
    persisted: options.persistedCommand,
    env: Object.prototype.hasOwnProperty.call(options, 'env') ? options.env : process.env,
  })];
}

function resolveClaudeCommand(explicitCommand, options = {}) {
  const failures = [];
  for (const candidate of commandCandidates(explicitCommand, options)) {
    try {
      const env = Object.prototype.hasOwnProperty.call(options, 'env') ? options.env : process.env;
      const command = processLaunch.assertExecutableAvailable(candidate, { env });
      const result = spawnClaude(command, ['--version'], { encoding: 'utf8', timeout: probeTimeoutMs(), env });
      if (result.status === 0) return { command, failures };
      failures.push(`${candidate}: ${commandOutput(result) || `exit ${result.status}`}`);
    } catch (error) {
      failures.push(`${candidate}: ${error.message}`);
    }
  }
  return { command: '', failures };
}

function runClaudeJson(command, args, options = {}) {
  const result = spawnClaude(command, args, { encoding: 'utf8', timeout: commandTimeoutMs(), ...options });
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

function spawnClaudeProcess(command, args) {
  const parts = claudeSpawnParts(command, args);
  // stdio is ignored on purpose: the mutation's completion signal is the
  // supported plugin-state verification below, never captured output, and an
  // inherited or piped handle must not be able to keep this parent waiting
  // on a child that has already finished its real work.
  // The executable is validated and argv remains separate; shell interpretation is never enabled.
  // codeql[js/shell-command-injection-from-environment]
  return spawn(parts.command, parts.args, {
    windowsVerbatimArguments: parts.windowsVerbatimArguments,
    stdio: 'ignore',
    windowsHide: true
  });
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

function mutationLingerWarning(args) {
  return `claude ${args.join(' ')} did not exit cleanly, but installed-state verification passed`;
}

// Launch a mutating `claude plugin ...` command asynchronously and treat the
// supported installed-state verification (`claude plugin list --json` fed
// through evaluateClaudeToolkitPluginState) as the completion signal instead
// of the process exit. Waiting on process exit can report failure even after
// the mutation has landed -- for example when the CLI lingers after finishing
// its real work -- while the plugin list state is the authoritative success
// signal. A non-zero exit or a timeout is never treated as success unless the
// final supported state verification passes.
async function runClaudeMutationAndVerify(command, mutationArgs, options = {}) {
  const deadlineMs = options.deadlineMs || mutationDeadlineMs();
  const pollMs = options.pollMs || mutationPollMs();
  const expectedSourceCommit = options.repoCommit || repoCommit(path.resolve(options.repoRoot || repoRootFromScript()));
  const startedAt = Date.now();
  let child;
  let childExit = null;
  let childError = null;
  let lastState = null;
  let lastListError = null;

  try {
    child = spawnClaudeProcess(command, mutationArgs);
    child.on('exit', (code, signal) => {
      childExit = { code, signal };
    });
    child.on('error', (error) => {
      childError = error;
    });
    child.unref();
  } catch (error) {
    return {
      ok: false,
      state: null,
      warning: '',
      childFailed: true,
      failure: `claude ${mutationArgs.join(' ')} failed to start: ${error.message}`
    };
  }

  for (;;) {
    try {
      const pluginList = runClaudeJson(command, ['plugin', 'list', '--json']);
      lastListError = null;
      lastState = evaluateClaudeToolkitPluginState(pluginList, {
        repoRoot: options.repoRoot,
        expectedVersion: options.expectedVersion,
        repoCommit: expectedSourceCommit
      });
      if (lastState.ok) {
        // The synchronous state poll starves the event loop, so a child that
        // already exited cleanly may not have had its exit event processed
        // yet. Give it a short bounded settle window before deciding whether
        // to report it as lingering.
        const settleDeadline = Date.now() + 250;
        while (!childExit && !childError && Date.now() < settleDeadline) {
          await sleep(10);
        }
        const lingered = !childExit || childExit.code !== 0;
        terminateChild(child);
        return {
          ok: true,
          state: lastState,
          warning: lingered ? mutationLingerWarning(mutationArgs) : '',
          childFailed: false,
          failure: ''
        };
      }
    } catch (error) {
      // Transient plugin list failures are tolerated until the deadline; the
      // last one is preserved for the final failure report.
      lastListError = error;
    }

    if (childError) {
      terminateChild(child);
      return {
        ok: false,
        state: lastState,
        warning: '',
        childFailed: true,
        failure: `claude ${mutationArgs.join(' ')} failed: ${childError.message}; installed-state verification failed: ${formatStateErrors(lastState, lastListError)}`
      };
    }

    if (childExit && childExit.code !== 0) {
      terminateChild(child);
      return {
        ok: false,
        state: lastState,
        warning: '',
        childFailed: true,
        failure: `claude ${mutationArgs.join(' ')} exited with ${childExit.code}${childExit.signal ? ` signal ${childExit.signal}` : ''}; installed-state verification failed: ${formatStateErrors(lastState, lastListError)}`
      };
    }

    const remainingMs = deadlineMs - (Date.now() - startedAt);
    if (remainingMs <= 0) break;
    // Every wait is capped to the remaining deadline so an oversized poll
    // interval can never keep this helper asleep past its advertised
    // deadline; after the last partial wait the loop performs one final
    // verification poll at the deadline before giving up.
    await sleep(Math.min(pollMs, remainingMs));
  }

  terminateChild(child);
  return {
    ok: false,
    state: lastState,
    warning: '',
    childFailed: false,
    failure: `claude ${mutationArgs.join(' ')} did not produce a verified install within ${deadlineMs}ms; installed-state verification failed: ${formatStateErrors(lastState, lastListError)}`
  };
}

// Claude plugin-list output is not a documented/versioned schema. Older
// releases exposed projectPath; current releases can omit it while retaining
// installPath. Match on stable identity fields, then bind a path-less entry to
// the managed source only through Claude's marketplace/install registries,
// exact source commit, and exact installed-cache bytes.
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
  const expectedVersion = options.expectedVersion || readExpectedToolkitVersion(repoRoot);
  const errors = [];
  const matches = findPluginEntries(pluginList);
  const installed = matches.find((entry) => entry.enabled !== false) || matches[0] || null;

  if (!installed) {
    errors.push(`${pluginId()} is not installed`);
    return { ok: false, installed: null, errors, refusesDowngrade: false, staleVersion: false, canUpdateInPlace: false };
  }
  const enabled = installed.enabled !== false;
  if (!enabled) {
    errors.push(`${pluginId()} is installed but not enabled`);
  }
  let refusesDowngrade = false;
  let staleVersion = false;
  if (installed.version && installed.version !== expectedVersion) {
    if (compareSemver(installed.version, expectedVersion) > 0) {
      refusesDowngrade = true;
      errors.push(`Refusing downgrade: installed ${pluginId()} version ${installed.version} is newer than source version ${expectedVersion}. Update the managed source checkout or uninstall the newer plugin explicitly before retrying.`);
    } else {
      staleVersion = true;
      errors.push(`${pluginId()} expected version ${expectedVersion}: ${installed.version}`);
    }
  }
  const listedSourcePath = installed.projectPath || installed.source?.path || installed.path || '';
  let sourcePath = listedSourcePath;
  let sourceIdentity = 'plugin-list';
  let sourceMatches = Boolean(listedSourcePath) && path.resolve(listedSourcePath) === repoRoot;
  if (!listedSourcePath) {
    const registryEvidence = registrySourceEvidence(installed, repoRoot, expectedVersion, options);
    sourceMatches = registryEvidence.ok;
    sourcePath = registryEvidence.sourcePath || '';
    sourceIdentity = registryEvidence.sourceIdentity || 'unverified';
    if (!registryEvidence.ok) errors.push(registryEvidence.reason);
  }
  if (!sourceMatches) {
    if (listedSourcePath) errors.push(`${pluginId()} source identity does not match the managed Toolkit checkout`);
  }
  if (enabled && sourceMatches) {
    errors.push(...validateInstalledEnforcement(installed, repoRoot, expectedVersion));
  }

  // `claude plugin install` no-ops on an id that is already installed (it
  // just reports "already installed"), so it never refreshes a stale cache.
  // An in-place `claude plugin update` is only the right remediation when
  // version staleness is the *only* problem -- an install that is also
  // disabled or points at a different source path still needs the full
  // marketplace add + install path.
  const canUpdateInPlace = staleVersion && enabled && sourceMatches;

  return { ok: errors.length === 0, installed, errors, refusesDowngrade, staleVersion, canUpdateInPlace, sourcePath, sourceIdentity };
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
  let expectedVersion;
  try {
    expectedVersion = readExpectedToolkitVersion(options.repoRoot);
  } catch (error) {
    console.error(`FAIL: ${error.message}`);
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
    state = evaluateClaudeToolkitPluginState(pluginList, { repoRoot: options.repoRoot, expectedVersion });
  } catch (error) {
    console.error(`FAIL: ${error.message}`);
    return 1;
  }

  if (!state.ok && options.write && !state.refusesDowngrade) {
    if (state.canUpdateInPlace) {
      // Verification-driven update: success means the supported plugin list
      // state became current, not that the update process exited. A verified
      // update with a lingering process succeeds with a warning and must not
      // trigger an unnecessary uninstall + reinstall.
      const updateOutcome = await runClaudeMutationAndVerify(
        resolved.command,
        ['plugin', 'update', pluginId(), '--scope', options.scope],
        { repoRoot: options.repoRoot, expectedVersion }
      );
      if (updateOutcome.ok) {
        state = updateOutcome.state;
        if (updateOutcome.warning) warnings.push(updateOutcome.warning);
      } else if (updateOutcome.childFailed) {
        warnings.push(`claude plugin update did not exit cleanly, falling back to uninstall + reinstall: ${updateOutcome.failure}`);
      } else {
        warnings.push(`claude plugin update did not produce a verified current install before its deadline, falling back to uninstall + reinstall: ${updateOutcome.failure}`);
      }
    }

    if (!state.ok && !state.refusesDowngrade) {
      // A stale install can't be refreshed by `plugin install` alone (it
      // no-ops on an id that already exists), and this is also the recovery
      // path when `plugin update` itself failed above, so uninstall first.
      if (state.installed) {
        const uninstall = runClaudeCommand(resolved.command, [
          'plugin', 'uninstall', pluginId(), '--scope', options.scope, '--keep-data', '--yes'
        ]);
        if (uninstall.status !== 0) {
          warnings.push(`claude plugin uninstall did not exit cleanly: ${commandOutput(uninstall)}`);
        }
      }
      const marketplaceAdd = runClaudeCommand(resolved.command, ['plugin', 'marketplace', 'add', options.repoRoot]);
      if (marketplaceAdd.status !== 0) {
        warnings.push(`claude plugin marketplace add did not exit cleanly: ${commandOutput(marketplaceAdd)}`);
      }
      const installOutcome = await runClaudeMutationAndVerify(
        resolved.command,
        ['plugin', 'install', pluginId(), '--scope', options.scope],
        { repoRoot: options.repoRoot, expectedVersion }
      );
      if (installOutcome.ok) {
        state = installOutcome.state;
        if (installOutcome.warning) warnings.push(installOutcome.warning);
      } else {
        for (const warning of warnings) console.error(`WARN: ${warning}`);
        console.error(`FAIL: ${installOutcome.failure}`);
        console.error(`Expected commands: claude plugin marketplace add <managed-toolkit-checkout> ; claude plugin install ${pluginId()} --scope ${options.scope}`);
        return 1;
      }
    }
  }

  if (!state.ok) {
    for (const error of state.errors) console.error(`FAIL: ${error}`);
    for (const warning of warnings) console.error(`WARN: ${warning}`);
    console.error('Run with --write to install or update through the supported Claude Code local marketplace path.');
    console.error(`Expected commands: claude plugin marketplace add <managed-toolkit-checkout> ; claude plugin install ${pluginId()} --scope ${options.scope}`);
    return 1;
  }

  const trusted = state.installed.trusted === true;
  const active = state.installed.hooksActive === true || state.installed.hookExecutionActive === true;
  const cachePath = state.installed.installPath || '';
  const activationProof = trusted && active ? installedActivationProof(state.installed, expectedVersion) : null;
  const summary = {
    ok: true,
    plugin_id: pluginId(),
    version: expectedVersion,
    enabled: true,
    scope: options.scope,
    current: true,
    installed_current: true,
    trusted,
    hook_active: active,
    strict_enforcement_verified: Boolean(activationProof),
    enforcement_verified: Boolean(activationProof),
    activation_proof: activationProof,
    source_path: state.sourcePath || '',
    source_identity: state.sourceIdentity || 'unverified',
    cache_path: cachePath,
    installed_entry: state.installed,
    install_path: claudeToolkitInstallCommands(options.repoRoot, options.scope),
    next_steps: nextSteps(options.scope),
    warnings
  };
  for (const warning of warnings) console.error(`WARN: ${warning}`);
  if (options.json) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(`OK: ${pluginId()} is installed and enabled, version ${expectedVersion}, scope ${options.scope}.`);
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
  PLUGIN_MANIFEST_REL_PATH,
  MARKETPLACE_REL_PATH,
  DEFAULT_SCOPE,
  VALID_SCOPES,
  claudeToolkitInstallCommands,
  claudeSpawnParts,
  commandCandidates,
  evaluateClaudeToolkitPluginState,
  findPluginEntries,
  readClaudePluginRegistryState,
  registrySourceEvidence,
  mutationDeadlineMs,
  mutationPollMs,
  installedActivationProof,
  probeTimeoutMs,
  readExpectedToolkitVersion,
  resolutionBudgetMs,
  runClaudeCommand,
  spawnClaude,
  runClaudeMutationAndVerify,
  quoteWindowsArg: processLaunch.quoteWindowsArgument,
  validateMarketplaceWrapper,
  validateRepoPluginSource,
  verifyBudgetMs,
  validateInstalledEnforcement,
  verifyCurrentInstalledEnforcement,
  verifySessionStartHook,
  writeBudgetMs,
  pluginId
};
