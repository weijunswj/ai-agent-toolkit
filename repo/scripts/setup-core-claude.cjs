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
const { ClaudeUserSettings, SETTINGS: CLAUDE_SETTINGS, STATES: CLAUDE_SETTINGS_STATES } = require('./toolkit-claude-user-settings.cjs');
const { ClaudeHelperDefinitions } = require('./toolkit-claude-helper-agents.cjs');
const { ToolkitInstallHealthCheck } = require('./toolkit-install-health.cjs');
const { claudeAccountPluginFolders } = require('./toolkit-claude-account-copy.cjs');
const { ToolkitEnv } = require('./toolkit-env.cjs');
const { CodexToolkitInstall } = require('./toolkit-codex-install-state.cjs');

// The setup-choice key of one managed Claude Code setting row, for example claudeSettingAgentsMd.
const claudeSettingKey = (id) => `claudeSetting${id.replace(/(^|-)([a-z])/g, (match, dash, letter) => letter.toUpperCase())}`;
const CLAUDE_SETTING_KEYS = Object.freeze(CLAUDE_SETTINGS.map((spec) => claudeSettingKey(spec.id)));

function defineClaudeSetup({ CLAUDE_HOOK_TRUST_ACTION, SUBAGENT_DEPTH_FOR_TOPOLOGY, claudeSetupBudgets, expectedToolkitVersion, nodeScriptArgs, readJsonFile, resolvedQuestion, runNativePluginJsonPhase, scriptRootForReadOnlyProbe, setupGlobalRules, unknown, wizardChoice }) {
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

  // True when any managed Claude Code setting already has a value (yours or Toolkit's). Once any is set the
  // owner has chosen, so every row recommends Keep current and a setting still missing counts as left out on purpose.
  const hasValue = (entry) => [CLAUDE_SETTINGS_STATES.TOOLKIT, CLAUDE_SETTINGS_STATES.OWNER, CLAUDE_SETTINGS_STATES.OFF].includes(entry?.state);
  const specOf = (entry) => CLAUDE_SETTINGS.find((spec) => spec.id === entry?.id);
  // A missing key is on for a setting whose Claude Code default is on, and off otherwise.
  const defaultWord = (entry) => (specOf(entry)?.defaultOn ? 'On' : 'Off');
  const offSource = (entry) => (entry.toolkit ? 'set by setup' : 'in your settings');

  function claudeSettingsAnySet(current) {
    const entries = current?.claudeSettings;
    return Array.isArray(entries) && entries.some(hasValue);
  }

  // One setting's state: on (added by setup, or already in your settings), off, a different value, or missing.
  function claudeSettingOutcome(entry) {
    if (!entry) return 'The Claude Code user settings have not been read yet.';
    if (entry.state === CLAUDE_SETTINGS_STATES.UNREADABLE) return `${entry.detail || 'The Claude Code user settings file could not be read.'} Toolkit will not change it.`;
    if (entry.state === CLAUDE_SETTINGS_STATES.TOOLKIT) return `${entry.label}: on (added by setup).`;
    if (entry.blocked) return `${entry.label}: setup cannot change it because ${entry.detail}.`;
    if (entry.state === CLAUDE_SETTINGS_STATES.OFF) return `${entry.label}: off (${offSource(entry)}).`;
    if (entry.state === CLAUDE_SETTINGS_STATES.OWNER && entry.matches === true) return `${entry.label}: on (already in your settings).`;
    if (entry.state === CLAUDE_SETTINGS_STATES.OWNER) {
      const spec = specOf(entry);
      return `${entry.label}: different value in your settings: ${settingValue(entry.value)}${spec ? ` (Turn on sets ${settingValue(spec.value)})` : ''}.`;
    }
    return `${entry.label}: ${defaultWord(entry).toLowerCase()} (Claude Code default).`;
  }

  // Every setting, one sentence each, for the closing summary.
  function claudeSettingsOutcome(entries) {
    if (!Array.isArray(entries) || entries.length === 0) return claudeSettingOutcome(null);
    const unreadable = entries.find((entry) => entry.state === CLAUDE_SETTINGS_STATES.UNREADABLE);
    return unreadable ? claudeSettingOutcome(unreadable) : entries.map(claudeSettingOutcome).join(' ');
  }

  // One setting's state for the Current column; the row title names the setting.
  function claudeSettingShort(entry) {
    if (!entry) return 'Not read yet';
    if (entry.state === CLAUDE_SETTINGS_STATES.UNREADABLE) return 'Could not read';
    if (entry.state === CLAUDE_SETTINGS_STATES.TOOLKIT) return 'On (added by setup)';
    if (entry.blocked) return `Cannot change: ${entry.detail}`;
    if (entry.state === CLAUDE_SETTINGS_STATES.OFF) return `Off (${offSource(entry)})`;
    if (entry.state === CLAUDE_SETTINGS_STATES.OWNER && entry.matches === true) return 'On (already in your settings)';
    if (entry.state === CLAUDE_SETTINGS_STATES.OWNER) return `Different value in your settings: ${settingValue(entry.value)}`;
    return `${defaultWord(entry)} (Claude Code default)`;
  }

  // The choice that changes nothing for this setting: enable when it is on, disable when it is off.
  function claudeSettingCurrentChoice(entry) {
    if (!entry || entry.blocked) return '';
    if (entry.state === CLAUDE_SETTINGS_STATES.TOOLKIT || (entry.state === CLAUDE_SETTINGS_STATES.OWNER && entry.matches === true)) return 'enable';
    if (entry.state === CLAUDE_SETTINGS_STATES.OFF) return 'disable';
    if (entry.state === CLAUDE_SETTINGS_STATES.DEFAULT) return specOf(entry)?.defaultOn ? 'enable' : 'disable';
    return '';
  }

  const settingKeyName = (spec) => `"${spec.keyPath[spec.keyPath.length - 1]}"`;
  const blockedOutcome = (entry) => `Nothing changes: setup cannot change this setting because ${entry.detail} in settings.json.`;

  // What Turn on changes for this one setting.
  function claudeSettingOnOutcome(spec, entry) {
    if (entry?.blocked) return blockedOutcome(entry);
    if (entry?.state === CLAUDE_SETTINGS_STATES.OWNER && entry.matches !== true) return `Replaces your ${settingValue(entry.value)} with ${settingValue(spec.value)}.`;
    return `Sets ${settingKeyName(spec)}: ${settingValue(spec.value)} in settings.json.`;
  }

  // What Turn off changes for this one setting.
  function claudeSettingOffOutcome(spec, entry) {
    if (entry?.blocked) return blockedOutcome(entry);
    if (Object.hasOwn(spec, 'offValue')) return `Sets ${settingKeyName(spec)}: ${settingValue(spec.offValue)} in settings.json.${settingEffect(spec).off ? ` ${settingEffect(spec).off}` : ''}`;
    const trailers = spec.id === 'attribution' ? ' Claude Code then adds its Co-Authored-By trailer, Generated with Claude Code line and session link to your commits and pull requests again.' : '';
    return `Removes ${settingKeyName(spec)} from settings.json, whoever added it, so Claude Code uses its default.${trailers}`;
  }

  // Why to pick the setting's recommended choice (none of the four set yet) or Keep current (some already
  // set, so the owner has chosen).
  function claudeSettingRecommendation(spec, entry, current) {
    const pick = spec.recommend || 'enable';
    if (!claudeSettingsAnySet(current)) {
      const outcome = pick === 'disable' ? claudeSettingOffOutcome(spec, entry) : claudeSettingOnOutcome(spec, entry);
      return { value: pick, outcome, reason: `${pick === 'disable' ? 'Turning it off' : 'It'} ${settingEffect(spec).benefit}.` };
    }
    const entries = current.claudeSettings;
    const set = entries.filter(hasValue).length;
    const label = pick === 'disable' ? 'Turn off' : 'Turn on';
    const reason = entry?.state === CLAUDE_SETTINGS_STATES.DEFAULT
      ? `${set} of the ${entries.length} recommended settings already have a value and this one does not, so it counts as left out on purpose. Pick ${label} to turn it ${pick === 'disable' ? 'off' : 'on'}.`
      : 'This setting already has a value, so Keep current leaves it as it is.';
    return { value: 'keep', outcome: 'Keep this setting as it is.', reason };
  }

  const CLAUDE_SETTING_EFFECTS = Object.freeze({
    attribution: {
      short: 'Hide AI credit in commits/PRs', benefit: 'keeps AI attribution out of your commits and pull requests',
      controls: '"attribution": false, so Claude Code adds no Co-Authored-By trailer, "Generated with Claude Code" line or claude.ai session link to your commits and pull requests (Claude Code 2.1.281 or later; earlier versions skip a settings file that holds it). If you set {"commit": "", "pr": "", "sessionUrl": false} yourself, that hides the same and counts as on.',
    },
    'cross-session-inbound': {
      short: 'Let other sessions wake this one', benefit: 'lets a Projects coordinator wake Remote Control sessions on your computer',
      controls: '"crossSessionInbound": "accept", so messages from your other Claude sessions, such as a Claude Projects coordinator, wake this one. Messages still cannot approve actions or change settings.',
    },
    'switch-models-on-flag': {
      short: 'Switch models without asking on a flag', benefit: 'keeps a flagged request on the model you chose until you say otherwise',
      controls: '"switchModelsOnFlag": true (Claude Code\'s default when the line is missing) lets Claude Code switch models without asking when a request is flagged; false makes it pause and ask first.',
      off: 'Claude Code then pauses and asks before switching models when a request is flagged.',
    },
    'agents-md': {
      short: 'Read AGENTS.md too', benefit: "makes Claude Code read the repository's AGENTS.md",
      controls: 'Project instructions set to "claude-md-and-agents-md" (in pluginConfigs), so Claude Code reads AGENTS.md as well as CLAUDE.md (Claude Code 2.1.285 or later).',
    },
  });
  const settingEffect = (entry) => CLAUDE_SETTING_EFFECTS[entry.id] || { short: entry.label || entry.id, benefit: `sets ${entry.label || entry.id}`, controls: entry.label || entry.id };
  // A JSON value as it appears in settings.json, cut short so one table cell stays readable.
  const settingValue = (value) => { const text = JSON.stringify(value); return text.length > 40 ? `${text.slice(0, 37)}...` : text; };

  // One setup row per managed Claude Code user setting, in SETTINGS order, so each is turned on, off or kept on its own.
  function claudeSettingQuestions(args, current) {
    const entries = Array.isArray(current.claudeSettings) ? current.claudeSettings : [];
    return CLAUDE_SETTINGS.map((spec) => {
      const entry = entries.find((candidate) => candidate.id === spec.id);
      const effect = settingEffect(spec);
      const key = claudeSettingKey(spec.id);
      return resolvedQuestion({
        id: `claude-setting-${spec.id}`,
        key,
        section: 'Other coding apps',
        title: `Claude Code setting: ${effect.short}?`,
        prompt: `Claude Code setting choice: ${effect.short}`,
        whatThisControls: `One value in your Claude Code user settings (settings.json in your Claude Code config folder): ${effect.controls} ${Object.hasOwn(spec, 'offValue') ? 'Turn on and Turn off each write this one value' : 'Turn off removes this one setting whoever added it'}; the other settings are not touched.`,
        choices: [
          wizardChoice('enable', 'Turn on', claudeSettingOnOutcome(spec, entry)),
          wizardChoice('disable', 'Turn off', claudeSettingOffOutcome(spec, entry)),
          wizardChoice('keep', 'Keep current', `Preserve this effective behavior: ${claudeSettingOutcome(entry)}`),
        ],
        // A row already on hides Turn on, and one already off hides Turn off: Keep current does the same.
        // A different value, a blocked parent or an unreadable file keeps all three.
        currentChoice: claudeSettingCurrentChoice(entry),
        foldAlways: true,
        recommendation: claudeSettingRecommendation(spec, entry, current),
        selected: args.setupChoices[key],
        current: claudeSettingOutcome(entry),
        currentShort: claudeSettingShort(entry),
        currentVerification: entry && entry.state !== CLAUDE_SETTINGS_STATES.UNREADABLE ? 'state-derived' : 'unverified',
        afterApplying: 'Start a new Claude Code session so it reads the changed settings.',
      });
    });
  }

  // Applies the owner's answer on each setting row; a row with no answer changes nothing.
  function applyClaudeUserSettings(args, settings = new ClaudeUserSettings()) {
    return settings.apply(Object.fromEntries(CLAUDE_SETTINGS.map((spec) => [spec.id, args.setupChoices[claudeSettingKey(spec.id)] || 'keep'])));
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
  return { inspectClaudeNativePluginStatePreApproval, resolveClaudeTopology, claudeSettingsOutcome, claudeSettingsAnySet, claudeSettingQuestions, applyClaudeUserSettings, applyClaudeSubagentDepth, applyClaudeAgentControl, setupClaudeArgs, runClaudeNativePluginSetup, verifyClaudeNativePluginMetadata, runClaudeInstallCheck };
}

module.exports = { defineClaudeSetup, claudeSettingKey, CLAUDE_SETTING_KEYS };
