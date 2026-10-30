'use strict';

// Claude Code lane of setup: topology and agent profile, user settings and subagent depth, the
// native plugin setup run and metadata check, and the closing install check.
// setup-toolkit-core.cjs composes it and passes in the core helpers it uses, so this file
// never requires the core back.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const delegation = require('./codex-delegation-config.cjs');
const agentControl = require('./toolkit-agent-control.cjs');
const processLaunch = require('./claude-process-launch.cjs');
const { ClaudeSubagentDepthSetting } = require('./toolkit-claude-subagent-depth.cjs');
const { ClaudeUserSettings, STATES: CLAUDE_SETTINGS_STATES } = require('./toolkit-claude-user-settings.cjs');
const { ClaudeHelperDefinitions } = require('./toolkit-claude-helper-agents.cjs');
const { ToolkitInstallHealthCheck } = require('./toolkit-install-health.cjs');
const { claudeAccountPluginFolders } = require('./toolkit-claude-account-copy.cjs');
const { ToolkitEnv } = require('./toolkit-env.cjs');
const { CodexToolkitInstall } = require('./toolkit-codex-install-state.cjs');

function defineClaudeSetup({ CLAUDE_HOOK_TRUST_ACTION, SUBAGENT_DEPTH_FOR_TOPOLOGY, claudeSetupBudgets, expectedToolkitVersion, nodeScriptArgs, readJsonFile, runNativePluginJsonPhase, scriptRootForReadOnlyProbe, setupGlobalRules, unknown }) {
  function inspectClaudeNativePluginStatePreApproval(args) {
    const probeRoot = scriptRootForReadOnlyProbe(args);
    try {
      const manifest = readJsonFile(path.join(probeRoot, '.claude-plugin', 'plugin.json'));
      return {
        status: 'verification-deferred', current: false, enforcement_verified: false, strict_enforcement_verified: false,
        manifest_version: manifest.version || 'unknown', expected_version: manifest.version || 'unknown',
        detail: 'Source metadata inspected without launching Claude; installed/current/trust/hook/activation state is deferred until approval.',
      };
    } catch (error) {
      return { status: 'invalid-source-metadata', current: false, enforcement_verified: false, strict_enforcement_verified: false, detail: error.message };
    }
  }

  // `keep` preserves only a supported current profile. A stale, unverifiable or retired
  // (Toolkit direct) profile reads as unsupported, so keep resolves it to root-only.
  function resolveClaudeTopology(args, current) {
    const profile = current.agentProfile || agentControl.readProfile('claude-code');
    const choice = args.setupChoices.claudeTopology || 'keep';
    // Resolution rewrites keep to a concrete topology, so the depth effect is taken from the
    // first (unresolved) answer only: keep leaves the depth setting as it is.
    if (!args.claudeSubagentDepthChoice) args.claudeSubagentDepthChoice = SUBAGENT_DEPTH_FOR_TOPOLOGY[choice] || 'keep';
    const kept = profile.supported === true
      && [agentControl.TOPOLOGIES.ROOT_ONLY, agentControl.TOPOLOGIES.BROADER_NATIVE].includes(profile.topology);
    const topology = choice === 'keep'
      ? (kept ? profile.topology : agentControl.TOPOLOGIES.ROOT_ONLY)
      : (choice === 'broader-native' ? agentControl.TOPOLOGIES.BROADER_NATIVE : agentControl.TOPOLOGIES.ROOT_ONLY);
    args.setupChoices.claudeTopology = topology;
    return topology;
  }

  // True when every managed Claude Code setting already has a value (yours or Toolkit's).
  function claudeSettingsAllSet(current) {
    const entries = current?.claudeSettings;
    return Array.isArray(entries) && entries.length > 0
      && entries.every((entry) => entry.state === CLAUDE_SETTINGS_STATES.TOOLKIT || entry.state === CLAUDE_SETTINGS_STATES.OWNER);
  }

  // One line per managed Claude Code setting: set by Toolkit, set by you (kept), or not set.
  function claudeSettingsOutcome(entries) {
    if (!Array.isArray(entries) || entries.length === 0) return 'The Claude Code user settings have not been read yet.';
    if (entries.some((entry) => entry.state === CLAUDE_SETTINGS_STATES.UNREADABLE)) return `${entries[0].detail || 'The Claude Code user settings file could not be read.'} Toolkit will not change it.`;
    const describe = (entry) => {
      if (entry.state === CLAUDE_SETTINGS_STATES.TOOLKIT) return `${entry.label}: on (set by Toolkit).`;
      if (entry.state === CLAUDE_SETTINGS_STATES.OWNER) return `${entry.label}: your own value is kept.`;
      return `${entry.label}: not set.`;
    };
    return entries.map(describe).join(' ');
  }

  // Applies the owner's answer to the Toolkit-recommended Claude Code user settings; no answer changes nothing.
  function applyClaudeUserSettings(args, settings = new ClaudeUserSettings()) {
    return settings.apply(args.setupChoices.claudeSettings || 'keep');
  }

  // Applies the depth effect of the owner's topology answer to the Claude Code user settings.
  // Root-only writes, broader-native removes only Toolkit's value; keep or no answer changes nothing.
  function applyClaudeSubagentDepth(args, setting = new ClaudeSubagentDepthSetting()) {
    return setting.apply(args.claudeSubagentDepthChoice || 'keep');
  }

  // The Claude Code half of applyHostDelegationControl: the Toolkit agent profile for the chosen topology.
  function applyClaudeAgentControl(args, current, nativeCache = {}) {
    const topology = resolveClaudeTopology(args, current);
    const strict = topology === agentControl.TOPOLOGIES.ROOT_ONLY;
    const installedEnforcement = nativeCache.restart_required !== true
      && nativeCache.strict_enforcement_verified === true && nativeCache.trusted === true
      && nativeCache.hook_active === true && agentControl.validActivationProof(nativeCache.activation_proof, {
        pluginVersion: nativeCache.installed_version || nativeCache.version,
        cachePath: nativeCache.cache_path,
      });
    if (strict && !installedEnforcement) {
      const invalidated = agentControl.invalidateProfile('claude-code', 'Root-only remains the safe fallback while current native hook trust/activation or installed Toolkit bytes are unverified.');
      return { ...invalidated, status: 'safe-root-only', changed: true, selected_strict_state_applied: false, client_scope: 'Claude-only Toolkit profile' };
    }
    const configured = agentControl.configureProfile('claude-code', {
      topology,
      capacity_mode: agentControl.CAPACITY_MODES.ROOT_ONLY,
      enforcement_verified: strict,
      activation_proof: nativeCache.activation_proof,
      claude_cli: processLaunch.resolveClaudeCommandInput({
        explicit: args.claudeCli,
        persisted: current.agentProfile?.claude_cli,
      }),
    });
    return { status: 'configured', ...configured, changed: true, selected_strict_state_applied: true, client_scope: 'Claude-only Toolkit profile' };
  }

  function setupClaudeArgs(args, mode) {
    const extra = [mode, '--json', '--repo-root', args.repoRoot];
    if (mode === '--write') extra.push('--scope', 'user');
    if (args.claudeCli) extra.push('--claude-cli', args.claudeCli);
    return nodeScriptArgs('repo/scripts/setup-claude-toolkit-plugin.cjs', extra);
  }

  function runClaudeNativePluginSetup(args) {
    const budgets = claudeSetupBudgets(args.claudeCli);
    const verifySummary = runNativePluginJsonPhase({
      platform: 'Claude',
      phase: 'verification',
      label: 'node repo/scripts/setup-claude-toolkit-plugin.cjs --verify --json',
      args: setupClaudeArgs(args, '--verify'),
      cwd: args.repoRoot,
      timeout: budgets.verify,
      allowRefreshRequired: true
    });
    const expectedVersion = expectedToolkitVersion(args.repoRoot, 'claude-code');
    const manifestPath = path.join(args.repoRoot, '.claude-plugin', 'plugin.json');
    if (verifySummary) {
      const summary = verifySummary;
      return {
        status: 'already fresh',
        manifest_path: manifestPath,
        expected_version: expectedVersion,
        manifest_version: summary.version || expectedVersion,
        installed_version: summary.version || expectedVersion,
        scope: summary.scope || 'user',
        current: summary.current === true,
        enforcement_verified: summary.enforcement_verified === true,
        strict_enforcement_verified: summary.strict_enforcement_verified === true,
        installed_current: summary.installed_current === true,
        enabled: summary.enabled === true,
        source_path: summary.source_path || '',
        cache_path: summary.cache_path || '',
        trusted: summary.trusted === true,
        hook_active: summary.hook_active === true,
        activation_proof: summary.activation_proof || null,
        updated_this_run: false,
        restart_required: false,
        hook_trust_action: CLAUDE_HOOK_TRUST_ACTION
      };
    }
    runNativePluginJsonPhase({
      platform: 'Claude',
      phase: 'mutation',
      label: 'node repo/scripts/setup-claude-toolkit-plugin.cjs --write --json --scope user',
      args: setupClaudeArgs(args, '--write'),
      cwd: args.repoRoot,
      timeout: budgets.write
    });
    const summary = runNativePluginJsonPhase({
      platform: 'Claude post-mutation',
      phase: 'verification',
      label: 'node repo/scripts/setup-claude-toolkit-plugin.cjs --verify --json',
      args: setupClaudeArgs(args, '--verify'),
      cwd: args.repoRoot,
      timeout: budgets.verify
    });
    return {
      status: summary.current === true ? 'installed this run' : 'install not verified',
      manifest_path: manifestPath,
      expected_version: expectedVersion,
      manifest_version: summary.version || expectedVersion,
      installed_version: summary.version || expectedVersion,
      scope: summary.scope || 'user',
      current: summary.current === true,
      enforcement_verified: summary.enforcement_verified === true,
      strict_enforcement_verified: summary.strict_enforcement_verified === true,
      installed_current: summary.installed_current === true,
      enabled: summary.enabled === true,
      source_path: summary.source_path || '',
      cache_path: summary.cache_path || '',
      trusted: summary.trusted === true,
      hook_active: summary.hook_active === true,
      activation_proof: summary.activation_proof || null,
      updated_this_run: true,
      restart_required: true,
      hook_trust_action: CLAUDE_HOOK_TRUST_ACTION
    };
  }

  function verifyClaudeNativePluginMetadata(args) {
    const pluginPath = path.join(args.repoRoot, '.claude-plugin', 'plugin.json');
    const hooksPath = path.join(args.repoRoot, '.claude-plugin', 'hooks', 'hooks.json');
    if (!fs.existsSync(pluginPath)) throw new Error(`Missing Claude Code native plugin manifest: ${pluginPath}`);
    if (!fs.existsSync(hooksPath)) throw new Error(`Missing Claude Code native plugin hooks: ${hooksPath}`);

    const plugin = readJsonFile(pluginPath);
    const hooks = readJsonFile(hooksPath);
    if (plugin.name !== 'ai-agent-toolkit') throw new Error(`Unexpected Claude Code plugin name: ${plugin.name || '<missing>'}`);
    if (plugin.skills !== './skills') throw new Error('Claude Code plugin manifest must load Toolkit skills from ./skills');
    if (plugin.hooks !== './.claude-plugin/hooks/hooks.json') {
      throw new Error('Claude Code plugin manifest must point hooks to ./.claude-plugin/hooks/hooks.json');
    }

    const sessionStart = hooks?.hooks?.SessionStart;
    if (!Array.isArray(sessionStart) || !sessionStart.length) {
      throw new Error('Claude Code plugin hooks must include a SessionStart hook');
    }
    const commands = sessionStart
      .flatMap((entry) => Array.isArray(entry.hooks) ? entry.hooks : [])
      .map((entry) => String(entry.command || ''));
    const command = commands.find((value) => value.includes('toolkit-local-bridge.cjs')) || '';
    if (!command) throw new Error('Claude Code SessionStart hook must call toolkit-local-bridge.cjs');
    for (const required of ['${CLAUDE_PLUGIN_ROOT}', '--hook', '--sync-enabled', '--write', '--sync-source claude-plugin']) {
      if (!command.includes(required)) throw new Error(`Claude Code SessionStart hook command is missing ${required}`);
    }
    if (/--force-downgrade/.test(command)) {
      throw new Error('Claude Code SessionStart hook must not force a downgrade');
    }
    const agentHookCommands = (hooks?.hooks?.PreToolUse || [])
      .filter((entry) => /(?:^|\|)(?:Agent|Task)(?:\||$)/.test(String(entry?.matcher || '')))
      .flatMap((entry) => Array.isArray(entry.hooks) ? entry.hooks : [])
      .map((entry) => String(entry.command || ''));
    if (!agentHookCommands.some((value) => value.includes('${CLAUDE_PLUGIN_ROOT}/repo/scripts/toolkit-claude-agent-hook.cjs'))) {
      throw new Error('Claude Code plugin hooks must block native Agent launches through toolkit-claude-agent-hook.cjs');
    }
    console.log('Claude Code native plugin metadata verified.');
    console.log('If Claude Code reports the Toolkit plugin is missing, stale or disabled, refresh it through Claude Code native plugin UI/flow. Codex will not mutate Claude Code plugin cache.');
    return {
      status: 'metadata present',
      manifest_path: pluginPath,
      expected_version: expectedToolkitVersion(args.repoRoot, 'claude-code'),
      manifest_version: plugin.version || 'unknown',
      updated_this_run: false,
      restart_required: false,
      hook_trust_action: CLAUDE_HOOK_TRUST_ACTION
    };
  }

  // The last setup step on Claude Code: checks what this run installed, refreshing stale Toolkit
  // helper definitions, and returns the result the summary and exit code report.
  function runClaudeInstallCheck(args, nativeCache, delegation) {
    const check = new ToolkitInstallHealthCheck({
      toolkitRoot: args.repoRoot,
      expectedVersion: expectedToolkitVersion(args.repoRoot, 'claude-code'),
      hubPath: path.resolve(args.hub || path.join(os.homedir(), '.ai-agent-toolkit', 'current')),
      helperDefinitions: new ClaudeHelperDefinitions({ repositoryRoot: args.repoRoot, retentionDays: args.updateReportRetentionDays }),
      globalRules: setupGlobalRules(args),
      depthSetting: new ClaudeSubagentDepthSetting(),
      envHealth: ToolkitEnv.forUser(),
      syncedSkillsDir: path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'skills', 'synced'),
      accountPluginFolders: claudeAccountPluginFolders(),
      codexInstall: new CodexToolkitInstall({ managedRoot: args.repoRoot }),
    });
    const installed = ['already fresh', 'installed this run'].includes(nativeCache.status);
    return check.run({
      plugin: {
        installed,
        current: installed && nativeCache.current === true,
        running_copy: nativeCache.source_path || '',
        updated_this_run: nativeCache.updated_this_run === true,
      },
      topology: delegation.topology || null,
      projectDirectories: [path.join(process.cwd(), '.claude', 'agents')],
    });
  }
  return { inspectClaudeNativePluginStatePreApproval, resolveClaudeTopology, claudeSettingsOutcome, claudeSettingsAllSet, applyClaudeUserSettings, applyClaudeSubagentDepth, applyClaudeAgentControl, setupClaudeArgs, runClaudeNativePluginSetup, verifyClaudeNativePluginMetadata, runClaudeInstallCheck };
}

module.exports = { defineClaudeSetup };
