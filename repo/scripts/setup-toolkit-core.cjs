#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const readline = require('node:readline/promises');
const delegation = require('./codex-delegation-config.cjs');
const { runtimeLabel } = require('./codex-delegation-state.cjs');
const agentControl = require('./toolkit-agent-control.cjs');
const processLaunch = require('./claude-process-launch.cjs');
const { ClaudeSubagentDepthSetting, STATES: SUBAGENT_DEPTH_STATES } = require('./toolkit-claude-subagent-depth.cjs');
const { ClaudeUserSettings, SETTINGS: CLAUDE_SETTINGS, STATES: CLAUDE_SETTINGS_STATES } = require('./toolkit-claude-user-settings.cjs');
const { ClaudePluginRegistry } = require('./toolkit-claude-plugin-registry.cjs');
const { OfficialN8nSkills, installSummary: n8nSkillsSummary } = require('./toolkit-n8n-official-skills.cjs');
const { disableUserPlugin } = require('./setup-claude-toolkit-plugin.cjs');
const { AntigravityGlobalSkills, globalCopySummary } = require('./toolkit-antigravity-project-skills.cjs');
const { CodexHelperDefinitions, describeSetupResult: describeCodexHelpers } = require('./toolkit-codex-helper-agents.cjs');
const { STATUS: INSTALL_CHECK_STATUS, claudeAccountToolkitVersion } = require('./toolkit-install-health.cjs');
const { claudeAccountPluginFolders, claudeAppCopyLine } = require('./toolkit-claude-account-copy.cjs');
const { CodexToolkitInstall, hookGaps } = require('./toolkit-codex-install-state.cjs');
const { GlobalRules } = require('./toolkit-global-rules.cjs');
const { HOST_LABELS, detectAgentHost } = require('./agent-host-markers.cjs');
const { TaskAutoMergePreferences } = require('./toolkit-task-auto-merge-preferences.cjs');
const { taskAutoMerge } = require('./toolkit-governance-state.cjs');
const { defineCodexSetup } = require('./setup-core-codex.cjs');
const { defineClaudeSetup, claudeSettingKey, CLAUDE_SETTING_KEYS } = require('./setup-core-claude.cjs');

const DEFAULT_REPO_BRANCH = 'main';
const DEFAULT_REPO_REMOTE = 'https://github.com/weijunswj/ai-agent-toolkit';
const DEFAULT_UPDATE_REPORT_RETENTION_DAYS = 7;
const { CODEX_AGENT_MAX_THREADS, CODEX_AGENT_MAX_DEPTH, CODEX_V2_RAM_SAFE_HELPERS, RUNTIMES, RESTORE_FLAG } = delegation;
const CODEX_CONFIG_CLIENT_SCOPE = 'Codex effective runtime inspected through app-server experimentalFeature/list; writes target only the Codex user config';
const SUPPORTED_HOSTS = ['codex', 'claude-code'];
const SETUP_PAUSED_FOR_QUESTION_BANK = 23;
// The folder setup was started from, passed to the managed child for the local clone step.
const SETUP_START_FOLDER_ENV = 'AI_AGENT_TOOLKIT_SETUP_START_FOLDER';
// Setup finished its steps, but the install check found something a person must fix.
const SETUP_ACTION_REQUIRED = 24;
// Setup was started from one app but asked for the other app's questions; nothing was read or written.
const SETUP_HOST_MISMATCH = 2;
const QUESTION_BANK_BEGIN = '<!-- setup-toolkit-question-bank:begin -->';
const QUESTION_BANK_COMPLETE = '<!-- setup-toolkit-question-bank:complete -->';
const MANAGED_QUESTION_BANK_PROTOCOL = 'setup-toolkit-managed-question-bank-v2';
const MANAGED_PROTOCOL_PROBE_FLAG = '--managed-question-bank-protocol-probe';
const REMOVE_TOOLKIT_TASKS_FLAG = '--remove-toolkit-tasks';
const MANAGED_PROTOCOL_ENV = 'AI_AGENT_TOOLKIT_MANAGED_QUESTION_BANK_PROTOCOL';
const MANAGED_DELEGATION_DEPTH_ENV = 'AI_AGENT_TOOLKIT_MANAGED_DELEGATION_DEPTH';
const MANAGED_CHILD_TIMEOUT_MS = 300000;
const MANAGED_STDIN_MAX_BYTES = 64 * 1024;
const MANAGED_BANK_MAX_BYTES = 1024 * 1024;
const MANAGED_STDOUT_MAX_BYTES = MANAGED_BANK_MAX_BYTES + (256 * 1024);
const MANAGED_STDERR_MAX_BYTES = 256 * 1024;
const MANAGED_CONTROL_MAX_BYTES = 4096;
const BANK_REFERENCE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const BANK_REFERENCE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{4}(?:-[0-9A-HJKMNP-TV-Z]{4}){3}$/;

function repoRootFromScript() {
  return path.resolve(__dirname, '..', '..');
}

function defaultManagedSourcePath() {
  return path.join(os.homedir(), '.ai-agent-toolkit', 'source', 'ai-agent-toolkit');
}

function defaultManagedSetupScriptPath() {
  return path.join(defaultManagedSourcePath(), 'repo', 'scripts', 'setup-toolkit.cjs');
}

function quote(value) {
  return JSON.stringify(String(value));
}

function slash(value) {
  return String(value || '').replace(/\\/g, '/');
}

function isInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function samePath(left, right) {
  const leftResolved = path.resolve(left);
  const rightResolved = path.resolve(right);
  if (process.platform === 'win32') return leftResolved.toLowerCase() === rightResolved.toLowerCase();
  return leftResolved === rightResolved;
}

function isRunningFromStandardManagedCheckout() {
  return samePath(repoRootFromScript(), defaultManagedSourcePath());
}

function isStandardManagedPath(value) {
  return samePath(value, defaultManagedSourcePath());
}

function normalizeRemote(value) {
  let remote = String(value || '').trim();
  if (/^git@github\.com:/i.test(remote)) {
    remote = remote.replace(/^git@github\.com:/i, 'https://github.com/');
  }
  remote = remote.replace(/\.git$/i, '');
  remote = remote.replace(/\/+$/g, '');
  return remote.toLowerCase();
}

function parsePositiveInteger(value, flagName) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${flagName} requires a positive integer`);
  return number;
}

function parseNonNegativeInteger(value, flagName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`${flagName} requires a non-negative integer`);
  return number;
}

function emptySetupChoices() {
  return {
    taskAutoMerge: '',
    managedCheckout: '',
    repoAutoUpdate: '',
    updateReports: '',
    updateReportRetention: '',
    codexDocLimit: '',
    codexPluginAutoRefresh: '',
    codexHelperCapacity: '',
    codexPluginBehavior: '',
    claudeTopology: '',
    claudePluginBehavior: '',
    ...Object.fromEntries(CLAUDE_SETTING_KEYS.map((key) => [key, ''])),
    antigravitySkills: ''
  };
}

function parseArgs(argv = process.argv.slice(2)) {
  const repoRootDefault = defaultManagedSourcePath();
  const args = {
    argv,
    plan: false,
    execute: false,
    json: false,
    autoMain: false,
    repoRoot: repoRootDefault,
    repoRootExplicit: false,
    repoBranch: DEFAULT_REPO_BRANCH,
    repoRemote: DEFAULT_REPO_REMOTE,
    host: 'codex',
    codexCli: '',
    hub: '',
    verifyClaudePlugin: false,
    repoAutoUpdate: true,
    updateReports: true,
    updateReportRetentionDays: DEFAULT_UPDATE_REPORT_RETENTION_DAYS,
    updateReportRetentionDaysExplicit: false,
    updateReportOpen: false,
    codexDocLimit: true,
    codexDocLimitMode: '',
    codexPluginAutoRefresh: true,
    antigravityGlobalRules: false,
    explain: '',
    yesRecommended: false,
    codexHelperCount: null,
    approveHighHelperCapacity: false,
    approveCodexConfigProposal: false,
    codexRuntime: RUNTIMES.UNKNOWN,
    setupChoices: emptySetupChoices()
  };

  // --claude-settings answers all four Claude Code setting rows; --claude-setting <name>=<choice> wins for its row.
  let claudeSettingsAll = '';
  const claudeSettingOne = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index] || '';
    if (arg === '--plan') args.plan = true;
    else if (arg === '--explain') { args.explain = next(); args.plan = true; }
    else if (arg.startsWith('--explain=')) { args.explain = arg.slice('--explain='.length); args.plan = true; }
    else if (arg === '--execute') args.execute = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--auto-main') args.autoMain = true;
    else if (arg === '--profile') {
      const profile = next();
      if (profile !== 'auto-main') throw new Error(`Unsupported profile: ${profile}`);
      args.autoMain = true;
    } else if (arg.startsWith('--profile=')) {
      const profile = arg.slice('--profile='.length);
      if (profile !== 'auto-main') throw new Error(`Unsupported profile: ${profile}`);
      args.autoMain = true;
    } else if (arg === '--repo-root') {
      args.repoRoot = next();
      args.repoRootExplicit = true;
      args.setupChoices.managedCheckout = 'custom';
    } else if (arg.startsWith('--repo-root=')) {
      args.repoRoot = arg.slice('--repo-root='.length);
      args.repoRootExplicit = true;
      args.setupChoices.managedCheckout = 'custom';
    } else if (arg === '--managed-checkout') {
      const choice = next().toLowerCase();
      if (!['keep', 'default', 'custom'].includes(choice)) throw new Error(`Unsupported --managed-checkout choice: ${choice}`);
      args.setupChoices.managedCheckout = choice;
    } else if (arg.startsWith('--managed-checkout=')) {
      const choice = arg.slice('--managed-checkout='.length).toLowerCase();
      if (!['keep', 'default', 'custom'].includes(choice)) throw new Error(`Unsupported --managed-checkout choice: ${choice}`);
      args.setupChoices.managedCheckout = choice;
    } else if (arg === '--keep-managed-checkout') args.setupChoices.managedCheckout = 'keep';
    else if (arg === '--use-default-managed-checkout') args.setupChoices.managedCheckout = 'default';
    else if (arg === '--repo-branch') args.repoBranch = next();
    else if (arg.startsWith('--repo-branch=')) args.repoBranch = arg.slice('--repo-branch='.length);
    else if (arg === '--repo-remote') args.repoRemote = next();
    else if (arg.startsWith('--repo-remote=')) args.repoRemote = arg.slice('--repo-remote='.length);
    else if (arg === '--host') args.host = next();
    else if (arg.startsWith('--host=')) args.host = arg.slice('--host='.length);
    else if (arg === '--codex-cli') args.codexCli = next();
    else if (arg.startsWith('--codex-cli=')) args.codexCli = arg.slice('--codex-cli='.length);
    else if (arg === '--claude-cli') args.claudeCli = next();
    else if (arg.startsWith('--claude-cli=')) args.claudeCli = arg.slice('--claude-cli='.length);
    else if (arg === '--hub') args.hub = next();
    else if (arg.startsWith('--hub=')) args.hub = arg.slice('--hub='.length);
    else if (arg === '--verify-claude-plugin') args.verifyClaudePlugin = true;
    else if (arg === '--task-auto-merge' || arg.startsWith('--task-auto-merge=')) {
      const choice = (arg.includes('=') ? arg.slice('--task-auto-merge='.length) : next()).toLowerCase();
      if (!['keep', 'off', 'after-gates'].includes(choice)) throw new Error(`Unsupported --task-auto-merge choice: ${choice}`);
      args.setupChoices.taskAutoMerge = choice;
    }
    else if (arg === '--yes-recommended') args.yesRecommended = true;
    else if (arg === '--codex-helper-capacity') {
      const choice = next().toLowerCase();
      // Legacy Skip answers write nothing, exactly like Keep current.
      const normalized = { 'ram-safe': 'one-helper', advanced: 'custom', skip: 'keep' }[choice] || choice;
      if (!['keep', 'one-helper', 'root-only', 'custom', 'migrate', 'remove'].includes(normalized)) throw new Error(`Unsupported --codex-helper-capacity choice: ${choice}`);
      args.setupChoices.codexHelperCapacity = normalized;
    } else if (arg === '--codex-delegation-control') {
      const legacyChoice = String(argv[++index] || '').toLowerCase();
      const choice = { limit: 'one-helper', keep: 'keep', skip: 'keep' }[legacyChoice];
      if (!choice) throw new Error(`Unsupported --codex-delegation-control choice: ${legacyChoice}`);
      args.setupChoices.codexHelperCapacity = choice;
    } else if (arg.startsWith('--codex-helper-capacity=')) {
      const choice = arg.slice('--codex-helper-capacity='.length).toLowerCase();
      const normalized = { 'ram-safe': 'one-helper', advanced: 'custom', skip: 'keep' }[choice] || choice;
      if (!['keep', 'one-helper', 'root-only', 'custom', 'migrate', 'remove'].includes(normalized)) throw new Error(`Unsupported --codex-helper-capacity choice: ${choice}`);
      args.setupChoices.codexHelperCapacity = normalized;
    } else if (arg === '--codex-helper-count') {
      args.codexHelperCount = parseNonNegativeInteger(next(), arg);
      args.setupChoices.codexHelperCapacity = 'custom';
    } else if (arg.startsWith('--codex-helper-count=')) {
      args.codexHelperCount = parseNonNegativeInteger(arg.slice('--codex-helper-count='.length), '--codex-helper-count');
      args.setupChoices.codexHelperCapacity = 'custom';
    } else if (arg === '--approve-high-helper-capacity') {
      args.approveHighHelperCapacity = true;
    } else if (arg === '--approve-codex-config-proposal') {
      args.approveCodexConfigProposal = true;
    }
    else if (arg === '--write-repo-auto-update' || arg === '--enable-repo-auto-update') {
      args.repoAutoUpdate = true;
      args.setupChoices.repoAutoUpdate = 'enable';
    } else if (arg === '--skip-repo-auto-update' || arg === '--disable-repo-auto-update') {
      args.repoAutoUpdate = false;
      args.setupChoices.repoAutoUpdate = 'disable';
    } else if (arg === '--keep-repo-auto-update') args.setupChoices.repoAutoUpdate = 'keep';
    else if (arg === '--enable-update-reports') {
      args.updateReports = true;
      args.setupChoices.updateReports = 'enable';
    } else if (arg === '--disable-update-reports' || arg === '--skip-update-reports') {
      args.updateReports = false;
      args.setupChoices.updateReports = 'disable';
    } else if (arg === '--keep-update-reports') args.setupChoices.updateReports = 'keep';
    else if (arg === '--enable-codex-doc-limit') {
      args.codexDocLimit = true;
      args.setupChoices.codexDocLimit = 'enable';
    } else if (arg === '--disable-codex-doc-limit') {
      args.codexDocLimit = false;
      args.setupChoices.codexDocLimit = 'disable';
    } else if (arg === '--keep-codex-doc-limit') args.setupChoices.codexDocLimit = 'keep';
    else if (arg === '--antigravity-global-rules') args.antigravityGlobalRules = true;
    else if (arg === '--update-report-retention-days') {
      args.updateReportRetentionDays = parsePositiveInteger(next(), arg);
      args.updateReportRetentionDaysExplicit = true;
      args.setupChoices.updateReportRetention = 'custom';
    }
    else if (arg.startsWith('--update-report-retention-days=')) {
      args.updateReportRetentionDays = parsePositiveInteger(arg.slice('--update-report-retention-days='.length), '--update-report-retention-days');
      args.updateReportRetentionDaysExplicit = true;
      args.setupChoices.updateReportRetention = 'custom';
    } else if (arg === '--default-update-report-retention-days') {
      args.updateReportRetentionDays = DEFAULT_UPDATE_REPORT_RETENTION_DAYS;
      args.setupChoices.updateReportRetention = 'default';
    } else if (arg === '--keep-update-report-retention-days') args.setupChoices.updateReportRetention = 'keep';
    else if (arg === '--enable-update-report-open') {
      args.updateReportOpen = false;
    } else if (arg === '--skip-update-report-open' || arg === '--disable-update-report-open') {
      args.updateReportOpen = false;
    } else if (arg === '--keep-update-report-open') args.updateReportOpen = false;
    else if (arg === '--enable-codex-plugin-auto-refresh') {
      args.codexPluginAutoRefresh = true;
      args.setupChoices.codexPluginAutoRefresh = 'enable';
    } else if (arg === '--skip-codex-plugin-auto-refresh' || arg === '--disable-codex-plugin-auto-refresh') {
      args.codexPluginAutoRefresh = false;
      args.setupChoices.codexPluginAutoRefresh = 'disable';
    } else if (arg === '--keep-codex-plugin-auto-refresh') args.setupChoices.codexPluginAutoRefresh = 'keep';
    else if (arg === '--claude-topology' || arg.startsWith('--claude-topology=')) {
      const choice = (arg === '--claude-topology' ? next() : arg.slice('--claude-topology='.length)).toLowerCase();
      if (!['root-only', 'broader-native', 'keep'].includes(choice)) throw new Error(`Unsupported --claude-topology choice: ${choice}`);
      args.setupChoices.claudeTopology = choice;
    }
    else if (arg === '--codex-plugin-behavior' || arg.startsWith('--codex-plugin-behavior=')) {
      const choice = (arg === '--codex-plugin-behavior' ? next() : arg.slice('--codex-plugin-behavior='.length)).toLowerCase();
      if (!['keep', 'instructions', 'install'].includes(choice)) throw new Error(`Unsupported --codex-plugin-behavior choice: ${choice}`);
      args.setupChoices.codexPluginBehavior = choice;
    } else if (arg === '--claude-plugin-behavior') {
      const choice = next().toLowerCase();
      if (!['keep', 'instructions', 'install'].includes(choice)) throw new Error(`Unsupported --claude-plugin-behavior choice: ${choice}`);
      args.setupChoices.claudePluginBehavior = choice;
    } else if (arg.startsWith('--claude-plugin-behavior=')) {
      const choice = arg.slice('--claude-plugin-behavior='.length).toLowerCase();
      if (!['keep', 'instructions', 'install'].includes(choice)) throw new Error(`Unsupported --claude-plugin-behavior choice: ${choice}`);
      args.setupChoices.claudePluginBehavior = choice;
    } else if (arg === '--claude-settings' || arg.startsWith('--claude-settings=')) {
      const choice = (arg === '--claude-settings' ? next() : arg.slice('--claude-settings='.length)).toLowerCase();
      if (!['enable', 'disable', 'keep'].includes(choice)) throw new Error(`Unsupported --claude-settings choice: ${choice}`);
      claudeSettingsAll = choice;
    } else if (arg === '--claude-setting' || arg.startsWith('--claude-setting=')) {
      const pair = (arg === '--claude-setting' ? next() : arg.slice('--claude-setting='.length)).toLowerCase();
      const [id, choice, ...rest] = pair.split('=');
      if (rest.length) throw new Error(`Unsupported --claude-setting value: ${pair}`);
      if (!CLAUDE_SETTINGS.some((spec) => spec.id === id)) throw new Error(`Unsupported --claude-setting name: ${id}`);
      if (!['enable', 'disable', 'keep'].includes(choice)) throw new Error(`Unsupported --claude-setting choice: ${choice}`);
      claudeSettingOne[id] = choice;
    } else if (arg === '--antigravity-skills' || arg.startsWith('--antigravity-skills=')) {
      const choice = (arg === '--antigravity-skills' ? next() : arg.slice('--antigravity-skills='.length)).toLowerCase();
      if (!['copy', 'remove', 'keep'].includes(choice)) throw new Error(`Unsupported --antigravity-skills choice: ${choice}`);
      args.setupChoices.antigravitySkills = choice;
    } else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  for (const spec of CLAUDE_SETTINGS) {
    const choice = claudeSettingOne[spec.id] || claudeSettingsAll;
    if (choice) args.setupChoices[claudeSettingKey(spec.id)] = choice;
  }
  if (args.plan && args.execute) throw new Error('--plan and --execute cannot be used together');
  if (argv.some((arg) => arg === '--explain' || arg.startsWith('--explain=')) && !args.explain) throw new Error('--explain needs a question number, for example --explain 1.2');
  if (!args.plan && !args.execute && !args.help && !args.verifyClaudePlugin) args.plan = true;
  args.repoRoot = path.resolve(args.repoRoot);
  args.repoBranch = args.repoBranch || DEFAULT_REPO_BRANCH;
  args.repoRemote = args.repoRemote || DEFAULT_REPO_REMOTE;
  if (!SUPPORTED_HOSTS.includes(args.host)) throw new Error(`Unsupported host: ${args.host}`);
  return args;
}

// The bank shown must match the app that started setup: a Codex chat never gets the Claude Code
// questions (and their Claude settings writes), and the reverse. Only a clear marker from one app
// decides; no markers, or both apps' markers, keep --host as given.
function hostMismatch(args, environment = process.env) {
  const detected = detectAgentHost(environment);
  if (detected === 'unknown' || detected === args.host) return null;
  const rest = [];
  for (let index = 0; index < args.argv.length; index += 1) {
    const arg = args.argv[index];
    if (arg === '--host') index += 1;
    else if (!arg.startsWith('--host=')) rest.push(arg);
  }
  const rerun = ['node', `"${path.join(__dirname, 'setup-toolkit.cjs')}"`, ...[...rest, ...(detected === 'codex' ? [] : ['--host', detected])]
    .map((part) => (/^[\w./:=-]+$/.test(part) ? part : `"${part}"`))].join(' ');
  // Names only the app that started setup: its chat never hears about the other app's questions.
  return [
    `SETUP STOPPED: setup was started from ${HOST_LABELS[detected]}, and this command is not the ${HOST_LABELS[detected]} setup. Nothing was changed.`,
    `Run it again as: ${rerun}`
  ].join('\n');
}

function relNodeCommand(relScript, extraArgs = []) {
  return ['node', slash(relScript), ...extraArgs].join(' ');
}

function preferenceSummary(options) {
  const choices = options.setupChoices || emptySetupChoices();
  return {
    task_auto_merge: choices.taskAutoMerge || 'question-required',
    repo_backed_auto_update: choices.repoAutoUpdate || 'question-required',
    host_native_plugin_cache_auto_refresh: options.host === 'codex'
      ? (choices.codexPluginAutoRefresh || 'question-required')
      : 'manual-verification-only',
    helper_capacity_backstop: options.host === 'codex'
      ? (choices.codexHelperCapacity || 'question-required')
      : 'root-only',
    selected_topology: options.host === 'codex'
      ? 'native-unintercepted-root-only'
      : (choices.claudeTopology || 'question-required'),
    claude_subagent_depth: options.host === 'claude-code'
      ? (claudeSubagentDepthChoice(options) || 'question-required')
      : 'not-applicable',
    helper_count: options.host === 'codex' && choices.codexHelperCapacity === 'custom'
      ? options.codexHelperCount
      : (options.host === 'codex' && choices.codexHelperCapacity === 'one-helper'
          ? CODEX_V2_RAM_SAFE_HELPERS
          : (options.host === 'codex' && choices.codexHelperCapacity === 'root-only' ? 0 : 'unchanged')),
    write_meaningful_update_reports: choices.updateReports || 'question-required',
    update_report_open_behavior: 'action-required-only; successful reports stay closed',
    update_report_retention_days: choices.updateReportRetention || 'question-required',
    raise_codex_instruction_limit: choices.codexDocLimit || (options.host === 'codex' ? 'question-required' : 'keep')
  };
}

function setupPlan(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || defaultManagedSourcePath());
  const repoBranch = options.repoBranch || DEFAULT_REPO_BRANCH;
  const host = options.host || 'codex';
  if (!SUPPORTED_HOSTS.includes(host)) throw new Error(`Unsupported host: ${host}`);
  const hubArgs = options.hub ? ['--hub', quote(path.resolve(options.hub))] : [];
  const codexCliArgs = options.codexCli ? ['--codex-cli', quote(options.codexCli)] : [];
  const claudeCliArgs = options.claudeCli ? ['--claude-cli', quote(options.claudeCli)] : [];
  const retentionDays = options.updateReportRetentionDays || DEFAULT_UPDATE_REPORT_RETENTION_DAYS;
  const choices = options.setupChoices || emptySetupChoices();
  const reportArgs = ['--disable-update-report-open'];
  if (choices.updateReports === 'enable') reportArgs.push('--enable-update-reports');
  else if (choices.updateReports === 'disable') reportArgs.push('--disable-update-reports');
  if (choices.codexDocLimit === 'enable') reportArgs.push('--enable-codex-doc-limit');
  else if (choices.codexDocLimit === 'disable') reportArgs.push('--disable-codex-doc-limit');
  if (choices.updateReportRetention === 'default' || choices.updateReportRetention === 'custom') {
    reportArgs.push('--update-report-retention-days', String(retentionDays));
  }
  if (reportArgs.length) reportArgs.push('--write', ...hubArgs);

  const repoAutoArgs = [];
  if (choices.repoAutoUpdate === 'enable') {
    repoAutoArgs.push(
      '--enable-repo-auto-update',
      '--repo-path',
      quote(repoRoot),
      '--repo-branch',
      repoBranch,
      '--repo-remote',
      quote(options.repoRemote || DEFAULT_REPO_REMOTE),
      '--enable-auto-sync',
      '--write',
      ...hubArgs
    );
  } else if (choices.repoAutoUpdate === 'disable') {
    repoAutoArgs.push('--disable-repo-auto-update', '--write', ...hubArgs);
  }

  return {
    name: 'setup toolkit',
    host,
    codex_helper_runtime: host === 'codex' ? (options.codexRuntime || RUNTIMES.UNKNOWN) : 'not-applicable',
    codex_helper_policy: host === 'codex' ? {
      routine: 'main agent only by default',
      ram_safe_helpers: CODEX_V2_RAM_SAFE_HELPERS,
      v2_total_threads: CODEX_V2_RAM_SAFE_HELPERS + 1,
      recursive_delegation: 'prohibited by policy; hard enforcement depends on detected runtime',
      security_capacity: 'no automatic elevation',
    } : { routine: 'portable policy only' },
    default_mode: 'plan-only; use --execute --auto-main or --execute --profile auto-main to run',
    managed_source: {
      required: true,
      path: repoRoot,
      branch: repoBranch,
      remote: options.repoRemote || DEFAULT_REPO_REMOTE,
      default_path: defaultManagedSourcePath(),
      custom_override: Boolean(options.repoRootExplicit),
      purpose: 'single clean main checkout used as the default update source'
    },
    checklist_explanation: '**Toolkit will use a dedicated clean `main` checkout as the single update source. Active Codex or Claude Code sessions may remain on PR branches, but plugin updates will not depend on those branches.**',
    preferences: preferenceSummary(options),
    question_bank: options.questionBank || [],
    steps: [
      {
        id: 'upfront_setup_checklist',
        title: 'Show one setup summary and collect all preferences before writes',
        preferences: preferenceSummary(options)
      },
      {
        id: 'managed_main_checkout',
        title: 'Create or verify the managed clean main checkout',
        commands: [
          `git clone --branch ${repoBranch} ${quote(options.repoRemote || DEFAULT_REPO_REMOTE)} ${quote(repoRoot)} # only if missing`,
          'git status --short',
          `git switch ${repoBranch}`,
          `git fetch origin ${repoBranch}`,
          'git merge --ff-only FETCH_HEAD',
          'node --test repo/tests/toolkit-local-bridge-hook-light.test.cjs'
        ],
        stop_if: 'the managed checkout is dirty, remote is unexpected, fetch fails, update is not fast-forward, or hook-light validation fails'
      },
      host === 'claude-code' ? (choices.claudePluginBehavior === 'install' ? {
        id: 'claude_native_plugin_install',
        title: 'Verify and install the Claude Code native plugin from this local marketplace when missing or disabled',
        commands: [
          relNodeCommand('repo/scripts/setup-claude-toolkit-plugin.cjs', ['--verify', '--json', '--repo-root', quote(repoRoot), ...claudeCliArgs]),
          relNodeCommand('repo/scripts/setup-claude-toolkit-plugin.cjs', ['--write', '--json', '--scope', 'user', '--repo-root', quote(repoRoot), ...claudeCliArgs]),
          relNodeCommand('repo/scripts/setup-claude-toolkit-plugin.cjs', ['--verify', '--json', '--repo-root', quote(repoRoot), ...claudeCliArgs])
        ],
        conditional_write: 'run --write --json only when --verify reports the plugin missing, disabled, wrong-version, or wrong-source'
      } : {
        id: 'claude_native_plugin_cache',
        title: 'Verify Claude Code native plugin metadata and report manual native refresh action if needed',
        commands: [relNodeCommand('repo/scripts/setup-toolkit.cjs', ['--verify-claude-plugin', '--host', 'claude-code', '--repo-root', quote(repoRoot)])]
      }) : ['keep', 'instructions'].includes(choices.codexPluginBehavior) ? {
        id: 'codex_native_plugin_cache',
        title: 'Leave the Codex native plugin as it is and report its state from the Codex files',
        commands: []
      } : {
        id: 'codex_native_plugin_cache',
        title: 'Verify and refresh only the Codex native plugin cache when stale',
        commands: [
          relNodeCommand('repo/scripts/setup-codex-toolkit-plugin.cjs', ['--verify', '--json', '--repo-root', quote(repoRoot), ...codexCliArgs]),
          relNodeCommand('repo/scripts/setup-codex-toolkit-plugin.cjs', ['--write', '--json', '--repo-root', quote(repoRoot), ...codexCliArgs]),
          relNodeCommand('repo/scripts/setup-codex-toolkit-plugin.cjs', ['--verify', '--json', '--repo-root', quote(repoRoot), ...codexCliArgs])
        ],
        conditional_write: 'run --write --json only when --verify reports missing, disabled, stale, wrong-source, or invalid installed cache state'
      },
      {
        id: 'lite_validation',
        title: 'Run setup validation from the managed checkout',
        commands: [
          'node repo/scripts/validate-toolkit.cjs',
          'node --test repo/tests/toolkit-local-bridge-hook-light.test.cjs'
        ]
      },
      {
        id: 'bridge_preferences',
        title: 'Persist repo update, update report, retention, and host cache preferences together',
        commands: [
          ...(repoAutoArgs.length ? [relNodeCommand('repo/scripts/toolkit-local-bridge.cjs', repoAutoArgs)] : []),
          ...(reportArgs.length ? [relNodeCommand('repo/scripts/toolkit-local-bridge.cjs', reportArgs)] : []),
          ...(host === 'codex'
            && ['enable', 'disable'].includes(choices.codexPluginAutoRefresh)
            ? [relNodeCommand('repo/scripts/toolkit-local-bridge.cjs', [
                options.codexPluginAutoRefresh === false ? '--disable-codex-plugin-auto-refresh' : '--enable-codex-plugin-auto-refresh',
                '--write',
                ...hubArgs
              ])]
            : [])
        ]
      },
      {
        id: 'final_bridge_audit',
        title: 'Run and parse the final bridge audit before any Codex config commitment',
        commands: [relNodeCommand('repo/scripts/toolkit-local-bridge.cjs', ['--audit', ...hubArgs])]
      },
      {
        id: 'host_delegation_control',
        title: host === 'codex'
          ? 'Apply the selected Codex helper-agent capacity as the final fallible setup operation'
          : 'Apply the selected Claude-only topology and admission profile as the final fallible setup operation',
        commands: host === 'codex' && ['migrate', 'one-helper', 'root-only', 'custom', 'remove'].includes(choices.codexHelperCapacity)
          ? [`manage only the Toolkit-owned ${runtimeLabel(options.codexRuntime || RUNTIMES.UNKNOWN)} helper-capacity block in ${delegation.codexConfigPath()}`]
          : (host === 'claude-code' ? [
              ...(choices.claudeTopology !== 'keep' ? ['write only the Claude Code profile under ~/.ai-agent-toolkit/agent-control/profiles/claude-code.json'] : []),
              ...(claudeSubagentDepthChoice(options) === 'enable' ? ['set the Toolkit-owned env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH = "1" in the Claude Code user settings unless you set that key yourself'] : []),
              ...(claudeSubagentDepthChoice(options) === 'disable' ? ['remove env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH from the Claude Code user settings only if Toolkit set it'] : []),
            ] : [])
      },
      {
        id: 'final_summary',
        title: 'Print the verified final setup summary including cleanup, cache, reports, and restart/trust actions',
        commands: []
      }
    ]
  };
}

function printHelp() {
  console.log([
    'AI Agent Toolkit setup orchestrator',
    '',
    'Default mode is --plan. The recommended setup entrypoint is:',
    '  node "<home folder>/.ai-agent-toolkit/source/ai-agent-toolkit/repo/scripts/setup-toolkit.cjs" --execute --profile auto-main',
    'Write <home folder> as the resolved path in forward slashes, with no environment variables and no cd,',
    'so the line starts the same way in PowerShell and cmd.exe. Run it from the folder you are working in.',
    '  node repo/scripts/setup-toolkit.cjs --execute --profile auto-main  # bootstrap/fallback only when managed script is missing',
    '',
    'Common commands:',
    '  node repo/scripts/setup-toolkit.cjs --plan --json',
    '  node repo/scripts/setup-toolkit.cjs --execute --auto-main',
    '  node repo/scripts/setup-toolkit.cjs --execute --profile auto-main --yes-recommended',
    '  node "<home folder>/.ai-agent-toolkit/source/ai-agent-toolkit/repo/scripts/setup-toolkit.cjs" --execute --profile auto-main --host claude-code',
    '',
    'Options:',
    '  --repo-root <path>           advanced override for managed Toolkit checkout source',
    '  --remove-toolkit-tasks       on its own: remove only Toolkit\'s own Windows scheduled tasks and their records',
    '  --repo-branch <branch>       default: main',
    '  --repo-remote <url>          default: https://github.com/weijunswj/ai-agent-toolkit',
    '  --host codex|claude-code     default: codex',
    '  --codex-cli <path>           explicit Codex CLI for native plugin setup',
    '  --claude-cli <path>          explicit Claude Code CLI for native plugin setup',
    '  --hub <path>                 test override for Toolkit bridge hub',
    '  --yes-recommended           print and apply recommended choices for unanswered setup questions',
    '  --codex-helper-capacity one-helper|root-only|keep|custom',
    '                               Codex only; choose one helper, no helpers, keep current, or a custom count',
    '  --codex-delegation-control limit',
    '                               backward-compatible alias for --codex-helper-capacity one-helper; no other legacy alias writes config',
    '  --codex-helper-count <count>',
    '                               number of helpers, not total agents; the main agent counts as one additional V2 session thread',
    '  --approve-high-helper-capacity',
    '                               explicit RAM-risk approval required when custom helper count is above one',
    '  --approve-codex-config-proposal',
    '                               approve an exact technical proposal that replaces user-owned effective helper controls',
    '  --managed-checkout keep|default|custom',
    '                               choose the managed checkout answer non-interactively',
    '  --enable-repo-auto-update   enable repo-backed auto-update from the managed checkout',
    '  --skip-repo-auto-update     disable repo-backed auto-update',
    '  --keep-repo-auto-update     preserve repo-backed auto-update preference',
    '  --enable-update-reports     write meaningful update reports',
    '  --disable-update-reports    disable future meaningful update report writes',
    '  --keep-update-reports       preserve meaningful update report write preference',
    '  --enable-codex-doc-limit    raise Codex project_doc_max_bytes to 65536 and keep it raised',
    '  --disable-codex-doc-limit   leave Codex project_doc_max_bytes alone; put back a value Toolkit raised',
    '  --keep-codex-doc-limit      preserve the Codex instruction limit choice',
    '  --antigravity-global-rules   also install the Toolkit global rules in ~/.gemini/GEMINI.md',
    '  --enable-update-report-open compatibility alias for failure-only opening; successful reports remain closed',
    '  --skip-update-report-open   retain failure-only opening; successful reports remain closed',
    '  --keep-update-report-open   compatibility alias; legacy success-report auto-open is not preserved',
    '  --update-report-retention-days <days>',
    '                               custom positive integer retention days',
    '  --default-update-report-retention-days',
    '                               explicitly set retention to 7 days',
    '  --keep-update-report-retention-days',
    '                               preserve current retention days',
    '  --enable-codex-plugin-auto-refresh',
    '                               let Codex hooks refresh stale Codex Toolkit cache',
    '  --skip-codex-plugin-auto-refresh',
    '                               leave stale Codex plugin cache refresh manual',
    '  --keep-codex-plugin-auto-refresh',
    '                               preserve Codex plugin cache auto-refresh preference',
    '  --codex-plugin-behavior keep|instructions|install',
    '                               Codex only; leave the Codex Toolkit plugin as it is, show the refresh commands, or verify and refresh it',
    '  --claude-topology root-only|broader-native|keep',
    '                               Claude-only topology; root-only admits only the Toolkit planning (G0) and build (G1) helpers in Toolkit repos and sets the one-layer CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1 elsewhere',
    '  --claude-plugin-behavior keep|instructions|install',
    '                               Claude Code only; verify/report, show native refresh instructions, or install/enable via claude plugin marketplace add + install --scope user',
    '  --explain <ref>              print the full text of one setup question, for example --explain 1.2',
    '  --claude-settings enable|disable|keep',
    '                               Claude Code only; answer all four Claude Code user setting rows (hide AI credit, let other sessions wake this one, switch models without asking on a flag, read AGENTS.md) at once with Turn on (enable), Turn off (disable) or Keep current (keep); Turn off removes the line whoever added it, except the model-switch row, which writes false',
    `  --claude-setting <name>=enable|disable|keep   answer one of those rows, overriding --claude-settings; names: ${CLAUDE_SETTINGS.map((spec) => spec.id).join(', ')}`,
    '  --antigravity-skills copy|remove|keep   copy Toolkit\'s portable skills into Antigravity\'s global skills folder',
    '  Antigravity uses portable workspace skills only; copy with toolkit-local-bridge.cjs --copy-antigravity-skills --antigravity-project-root <path> [--write]'
  ].join('\n'));
}

function assertRepoRoot(repoRoot) {
  const required = [
    path.join(repoRoot, 'AGENTS.md'),
    path.join(repoRoot, 'repo', 'scripts', 'setup-codex-toolkit-plugin.cjs'),
    path.join(repoRoot, 'repo', 'scripts', 'setup-claude-toolkit-plugin.cjs'),
    path.join(repoRoot, 'repo', 'scripts', 'toolkit-local-bridge.cjs'),
    path.join(repoRoot, 'repo', 'scripts', 'validate-toolkit.cjs'),
    path.join(repoRoot, 'repo', 'tests', 'toolkit-local-bridge-hook-light.test.cjs')
  ];
  for (const filePath of required) {
    if (!fs.existsSync(filePath)) throw new Error(`Missing setup prerequisite under repo root: ${filePath}`);
  }
}

function runCommand(label, command, args, options = {}) {
  if (!options.quiet) {
    console.log(`\n==> ${label}`);
    console.log('Command arguments: withheld from routine output; see the named checklist step.');
  }
  // git comes from PATH by full path: Windows would otherwise run a git.exe in the working folder.
  const result = spawnSync(command === 'git' ? processLaunch.resolvePathExecutable('git') : command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: options.capture ? 'utf8' : undefined,
    timeout: options.timeout || 120000,
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    const stderr = options.capture ? result.stderr || '' : '';
    const stdout = options.capture ? result.stdout || '' : '';
    throw new Error(`${label} failed with exit code ${result.status}${stderr || stdout ? `: ${(stderr || stdout).trim()}` : ''}${gitFailureHint(command, result.status)}`);
  }
  return result;
}

// Git exits 128 when it cannot use a repository, which is what a Codex chat sandbox causes: setup
// writes the managed checkout, ~/.codex and ~/.ai-agent-toolkit, all outside the chat's folder.
function gitFailureHint(command, status) {
  return command === 'git' && status === 128
    ? ' If setup is running inside the Codex sandbox, git cannot use the Toolkit copy there: run setup outside the Codex sandbox (approve running the setup command outside it).'
    : '';
}

function recordValidation(validationResults, command, status) {
  if (!validationResults) return;
  validationResults.push({ command, status });
}

function isCredentialError(message = '') {
  return /SEC_E_NO_CREDENTIALS|Authentication failed|could not read Username|Authentication|permission denied|terminal prompts disabled/i.test(message);
}

function fetchWithCredentialFallback(repoRoot, branch) {
  const fetchLabel = `git fetch origin ${branch}`;
  const fetchArgs = ['fetch', 'origin', branch];
  let lastError = '';
  const fetchResult = runCommand(fetchLabel, 'git', fetchArgs, { cwd: repoRoot, capture: true, timeout: 120000, allowFailure: true });
  if (fetchResult.status === 0) return;
  lastError = fetchResult.stderr || fetchResult.stdout || '';
  if (isCredentialError(lastError)) {
    const helpers = ['manager', 'manager-core'];
    for (const helper of helpers) {
      const fallbackResult = runCommand(
        `git -c credential.helper=${helper} fetch origin ${branch}`,
        'git',
        ['-c', `credential.helper=${helper}`, 'fetch', 'origin', branch],
        {
          cwd: repoRoot,
          capture: true,
          timeout: 120000,
          allowFailure: true
        }
      );
      if (fallbackResult.status === 0) return;
      if (fallbackResult.stderr || fallbackResult.stdout) {
        lastError = `${lastError}\n${fallbackResult.stderr || fallbackResult.stdout}`;
      }
    }
  }
  throw new Error(`${fetchLabel} failed with exit code ${fetchResult.status}: ${String(lastError || '').trim()}`);
}

function runGitCapture(repoRoot, args, label, allowFailure = false, quiet = false) {
  const result = runCommand(label, 'git', args, { cwd: repoRoot, capture: true, timeout: 60000, allowFailure: true, quiet });
  if (result.status !== 0 && !allowFailure) throw new Error(`${label} failed with exit code ${result.status}: ${(result.stderr || result.stdout || '').trim()}`);
  return (result.stdout || '').trim();
}

function commitForSummary(repoPath) {
  if (!repoPath || !fs.existsSync(repoPath)) return 'unknown';
  return runGitCapture(repoPath, ['rev-parse', 'HEAD'], 'git rev-parse HEAD', true, true) || 'unknown';
}

function branchForSummary(repoPath) {
  if (!repoPath || !fs.existsSync(repoPath)) return 'unknown';
  return runGitCapture(repoPath, ['branch', '--show-current'], 'git branch --show-current', true, true) || 'unknown';
}

function statusForSummary(repoPath) {
  if (!repoPath || !fs.existsSync(repoPath)) return 'unknown';
  const status = runGitCapture(repoPath, ['status', '--short'], 'git status --short', true, true);
  return status ? 'dirty' : 'clean';
}

function managedProtocolProbe() {
  return {
    protocol: MANAGED_QUESTION_BANK_PROTOCOL,
    question_bank_stream: 'stdout',
    control_fd: 3,
    acknowledgement_fd: 4,
    pause_status: SETUP_PAUSED_FOR_QUESTION_BANK,
  };
}

function countOccurrences(text, token) {
  return String(text || '').split(token).length - 1;
}

function inspectManagedBankOutput(stdout, stderr, receiptText) {
  const outBuffer = Buffer.isBuffer(stdout) ? stdout : Buffer.from(String(stdout || ''), 'utf8');
  const errBuffer = Buffer.isBuffer(stderr) ? stderr : Buffer.from(String(stderr || ''), 'utf8');
  const controlBuffer = Buffer.isBuffer(receiptText) ? receiptText : Buffer.from(String(receiptText || ''), 'utf8');
  if (outBuffer.length > MANAGED_STDOUT_MAX_BYTES) return { ok: false, classification: 'bank-payload-too-large' };
  if (errBuffer.length > MANAGED_STDERR_MAX_BYTES) return { ok: false, classification: 'child-output-too-large' };
  if (controlBuffer.length > MANAGED_CONTROL_MAX_BYTES) return { ok: false, classification: 'control-receipt-too-large' };
  const out = outBuffer.toString('utf8');
  const err = errBuffer.toString('utf8');
  const beginCount = countOccurrences(out, QUESTION_BANK_BEGIN);
  const completeCount = countOccurrences(out, QUESTION_BANK_COMPLETE);
  const stderrBeginCount = countOccurrences(err, QUESTION_BANK_BEGIN);
  const stderrCompleteCount = countOccurrences(err, QUESTION_BANK_COMPLETE);
  let receipt = null;
  try { receipt = JSON.parse(controlBuffer.toString('utf8').trim()); } catch { /* classified below */ }
  if (stderrBeginCount || stderrCompleteCount) return { ok: false, classification: 'bank-on-unexpected-stream' };
  if (beginCount === 0 && completeCount === 0 && controlBuffer.toString('utf8').trim() === '') {
    return { ok: false, classification: 'no-bank-output' };
  }
  if (beginCount === 0 && completeCount > 0) return { ok: false, classification: 'complete-without-begin' };
  if (beginCount > 1) return { ok: false, classification: 'duplicate-begin-marker' };
  if (completeCount > 1) return { ok: false, classification: 'duplicate-complete-marker' };
  if (beginCount === 1 && completeCount === 0 && controlBuffer.toString('utf8').trim() === '') {
    return { ok: false, classification: 'partial-bank' };
  }
  if (!receipt || receipt.protocol !== MANAGED_QUESTION_BANK_PROTOCOL || receipt.event !== 'question-bank-complete'
      || receipt.stream !== 'stdout' || receipt.begin_markers !== 1 || receipt.complete_markers !== 1) {
    return { ok: false, classification: 'invalid-control-receipt' };
  }
  if (!Number.isSafeInteger(receipt.question_count) || receipt.question_count < 1) {
    return { ok: false, classification: 'invalid-control-receipt' };
  }
  if (!Number.isSafeInteger(receipt.bank_byte_length) || receipt.bank_byte_length < 1) {
    return { ok: false, classification: 'invalid-control-receipt' };
  }
  if (receipt.bank_byte_length > MANAGED_BANK_MAX_BYTES) return { ok: false, classification: 'bank-payload-too-large' };
  if (!/^[a-f0-9]{64}$/.test(String(receipt.bank_sha256 || ''))) return { ok: false, classification: 'invalid-control-receipt' };
  const beginBytes = Buffer.from(QUESTION_BANK_BEGIN, 'utf8');
  const begin = outBuffer.indexOf(beginBytes);
  if (begin < 0) {
    return outBuffer.length < receipt.bank_byte_length
      ? { ok: false, pending: true, classification: 'no-bank-output' }
      : { ok: false, classification: completeCount ? 'complete-without-begin' : 'no-bank-output' };
  }
  const end = begin + receipt.bank_byte_length;
  if (outBuffer.length < end) return { ok: false, pending: true, classification: 'bank-length-mismatch' };
  const bank = outBuffer.subarray(begin, end);
  const bankText = bank.toString('utf8');
  const bankBeginCount = countOccurrences(bankText, QUESTION_BANK_BEGIN);
  const bankCompleteCount = countOccurrences(bankText, QUESTION_BANK_COMPLETE);
  if (beginCount > 1 || bankBeginCount > 1) return { ok: false, classification: 'duplicate-begin-marker' };
  if (completeCount > 1 || bankCompleteCount > 1) return { ok: false, classification: 'duplicate-complete-marker' };
  if (bankBeginCount === 0 && bankCompleteCount > 0) return { ok: false, classification: 'complete-without-begin' };
  if (bankBeginCount === 1 && bankCompleteCount === 0) return { ok: false, classification: 'partial-bank' };
  const completeIndex = bankText.indexOf(QUESTION_BANK_COMPLETE);
  if (completeIndex < bankText.indexOf(QUESTION_BANK_BEGIN)) return { ok: false, classification: 'complete-before-begin' };
  if (crypto.createHash('sha256').update(bank).digest('hex') !== receipt.bank_sha256) {
    return { ok: false, classification: 'bank-digest-mismatch' };
  }
  return { ok: true, begin, end, bank };
}

function managedFailureMessage(classification) {
  const messages = {
    'no-bank-output': 'Managed setup returned no question-bank output.',
    'partial-bank': 'Managed setup returned a partial question bank without its complete marker.',
    'complete-without-begin': 'Managed setup returned a complete marker without a begin marker.',
    'complete-before-begin': 'Managed setup returned question-bank markers out of order.',
    'duplicate-begin-marker': 'Managed setup returned duplicate question-bank begin markers.',
    'duplicate-complete-marker': 'Managed setup returned duplicate question-bank complete markers.',
    'bank-on-unexpected-stream': 'Managed setup returned question-bank markers on stderr instead of documented stdout.',
    'invalid-control-receipt': 'Managed setup did not provide the matching question-bank control receipt.',
    'control-receipt-too-large': 'Managed setup returned an oversized question-bank control receipt.',
    'bank-payload-too-large': 'Managed setup returned an oversized question-bank payload.',
    'child-output-too-large': 'Managed setup returned oversized diagnostic output.',
    'bank-length-mismatch': 'Managed setup question-bank length did not match its control receipt.',
    'bank-digest-mismatch': 'Managed setup question-bank digest did not match its control receipt.',
    timeout: 'Managed setup timed out before the question-bank protocol completed.',
    signal: 'Managed setup was terminated by a signal before the question-bank protocol completed.',
    'invalid-managed-script-identity': 'Managed setup script identity does not support the required question-bank protocol.',
    'recursive-delegation': 'Managed setup refused recursive active-to-managed delegation.',
    'stdin-transport-failure': 'Managed setup could not receive the delegated question-bank input.',
    'stdin-input-too-large': 'Managed setup input exceeded the bounded transport limit.',
    'child-failure': 'Managed setup failed before completing the question-bank protocol.',
  };
  return `${messages[classification] || messages['child-failure']} No approval shortcut or setup write is allowed.`;
}

function verifyManagedProtocolIdentity(managedScript, managedRoot) {
  const result = spawnSync(process.execPath, [managedScript, MANAGED_PROTOCOL_PROBE_FLAG], {
    cwd: managedRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0 || result.stderr) return false;
  try {
    const probe = JSON.parse(String(result.stdout || '').trim());
    return probe.protocol === MANAGED_QUESTION_BANK_PROTOCOL
      && probe.question_bank_stream === 'stdout'
      && probe.control_fd === 3
      && probe.acknowledgement_fd === 4
      && probe.pause_status === SETUP_PAUSED_FOR_QUESTION_BANK;
  } catch {
    return false;
  }
}

async function runManagedQuestionBankChild(managedScript, managedRoot, argv, options = {}) {
  const timeoutMs = options.timeoutMs || MANAGED_CHILD_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const hasStdinInput = Object.prototype.hasOwnProperty.call(options, 'stdinInput');
    const stdinSource = options.stdinSource || null;
    const pipeStdin = hasStdinInput || Boolean(stdinSource);
    const child = spawn(process.execPath, [managedScript, ...argv], {
      cwd: managedRoot,
      env: {
        ...process.env,
        [MANAGED_PROTOCOL_ENV]: MANAGED_QUESTION_BANK_PROTOCOL,
        [MANAGED_DELEGATION_DEPTH_ENV]: '1',
        // The child runs in the managed checkout; it fast-forwards the user's clone from here.
        [SETUP_START_FOLDER_ENV]: process.env[SETUP_START_FOLDER_ENV] || process.cwd(),
      },
      stdio: [pipeStdin ? 'pipe' : 'inherit', 'pipe', 'pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let control = Buffer.alloc(0);
    let forwarded = false;
    let forwardOffset = 0;
    let timedOut = false;
    let earlyClassification = '';
    let settled = false;
    let stdinBytes = 0;
    let stdinPausedForBackpressure = false;
    const stopStdinTransport = () => {
      if (!stdinSource) return;
      stdinSource.removeListener('data', onStdinData);
      stdinSource.removeListener('end', onStdinEnd);
      stdinSource.removeListener('error', onStdinError);
      if (stdinPausedForBackpressure || typeof stdinSource.pause === 'function') stdinSource.pause();
    };
    const failEarly = (classification) => {
      earlyClassification = earlyClassification || classification;
      stopStdinTransport();
      try { child.kill(); } catch { /* child may already be gone */ }
    };
    const onStdinData = (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stdinBytes += bytes.length;
      if (stdinBytes > MANAGED_STDIN_MAX_BYTES) return failEarly('stdin-input-too-large');
      if (!child.stdin.write(bytes) && typeof stdinSource.pause === 'function') {
        stdinPausedForBackpressure = true;
        stdinSource.pause();
      }
    };
    const onStdinEnd = () => child.stdin.end();
    const onStdinError = () => failEarly('stdin-transport-failure');
    if (hasStdinInput) {
      const bytes = Buffer.isBuffer(options.stdinInput) ? options.stdinInput : Buffer.from(String(options.stdinInput || ''), 'utf8');
      if (bytes.length > MANAGED_STDIN_MAX_BYTES) failEarly('stdin-input-too-large');
      else child.stdin.end(bytes);
    } else if (stdinSource) {
      stdinSource.on('data', onStdinData);
      stdinSource.once('end', onStdinEnd);
      stdinSource.once('error', onStdinError);
      child.stdin.on('drain', () => {
        if (stdinPausedForBackpressure && !settled) {
          stdinPausedForBackpressure = false;
          stdinSource.resume();
        }
      });
      stdinSource.resume();
    }
    if (pipeStdin) {
      child.stdin.on('error', () => {
        if (!settled && !forwarded) failEarly('stdin-transport-failure');
      });
    }
    child.stdio[4].on('error', () => {
      // Once the exact bank has been synchronously forwarded, the managed
      // child may consume the acknowledgement and close fd 4 before Node
      // reports the local pipe close. That post-forward close is not evidence
      // that acknowledgement delivery failed. Pre-forward pipe failure is.
      if (!forwarded) failEarly('child-failure');
    });

    const acknowledgeIfComplete = () => {
      if (forwarded || !control.includes(0x0a)) return;
      const inspected = inspectManagedBankOutput(stdout, stderr, control);
      if (!inspected.ok) {
        if (!inspected.pending) failEarly(inspected.classification);
        return;
      }
      fs.writeSync(1, inspected.bank);
      forwarded = true;
      forwardOffset = inspected.end;
      child.stdio[4].end('question-bank-visible\n');
    };
    child.stdout.on('data', (chunk) => {
      stdout = Buffer.concat([stdout, Buffer.from(chunk)]);
      if (stdout.length > MANAGED_STDOUT_MAX_BYTES) return failEarly('bank-payload-too-large');
      if (forwarded) {
        process.stdout.write(stdout.subarray(forwardOffset));
        forwardOffset = stdout.length;
      } else acknowledgeIfComplete();
    });
    child.stderr.on('data', (chunk) => {
      stderr = Buffer.concat([stderr, Buffer.from(chunk)]);
      if (stderr.length > MANAGED_STDERR_MAX_BYTES) return failEarly('child-output-too-large');
      acknowledgeIfComplete();
    });
    child.stdio[3].on('data', (chunk) => {
      control = Buffer.concat([control, Buffer.from(chunk)]);
      if (control.length > MANAGED_CONTROL_MAX_BYTES) return failEarly('control-receipt-too-large');
      if (!control.includes(0x0a)) return;
      acknowledgeIfComplete();
    });
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill(); } catch { /* child may already be gone */ }
    }, timeoutMs);
    const signalTimer = options.terminateAfterMs ? setTimeout(() => {
      try { child.kill(); } catch { /* child may already be gone */ }
    }, options.terminateAfterMs) : null;
    child.on('error', () => {
      clearTimeout(timer);
      if (signalTimer) clearTimeout(signalTimer);
      stopStdinTransport();
      if (!settled) { settled = true; reject(new Error(managedFailureMessage('child-failure'))); }
    });
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      if (signalTimer) clearTimeout(signalTimer);
      stopStdinTransport();
      if (settled) return;
      settled = true;
      const inspected = inspectManagedBankOutput(stdout, stderr, control);
      if (!forwarded && inspected.ok) {
        fs.writeSync(1, inspected.bank);
        forwarded = true;
      }
      if (timedOut) return reject(new Error(managedFailureMessage('timeout')));
      if (earlyClassification) return reject(new Error(managedFailureMessage(earlyClassification)));
      if (signal) return reject(new Error(managedFailureMessage('signal')));
      if (!inspected.ok) {
        const inspectedClassification = inspected.pending ? 'bank-length-mismatch' : inspected.classification;
        const classification = status !== SETUP_PAUSED_FOR_QUESTION_BANK && inspected.classification === 'no-bank-output'
          ? 'child-failure'
          : inspectedClassification;
        return reject(new Error(managedFailureMessage(classification)));
      }
      if (status === SETUP_PAUSED_FOR_QUESTION_BANK) {
        process.stderr.write('SETUP PAUSED: Managed setup displayed the complete question bank and requires additional approved answers.\n');
      } else if (status !== 0 && status !== SETUP_ACTION_REQUIRED) {
        return reject(new Error(managedFailureMessage('child-failure')));
      }
      resolve(status);
    });
  });
}

async function delegateToManagedSetupIfAvailable(args) {
  if (!args.execute || args.repoRootExplicit) return null;
  const managedScript = defaultManagedSetupScriptPath();
  const currentScript = path.resolve(__dirname, 'setup-toolkit.cjs');
  if (!fs.existsSync(managedScript) || samePath(managedScript, currentScript)) return null;
  if (Number(process.env[MANAGED_DELEGATION_DEPTH_ENV] || 0) > 0) {
    throw new Error(managedFailureMessage('recursive-delegation'));
  }

  const activeRoot = repoRootFromScript();
  const managedRoot = defaultManagedSourcePath();
  if (!verifyManagedProtocolIdentity(managedScript, managedRoot)) {
    throw new Error(managedFailureMessage('invalid-managed-script-identity'));
  }
  console.log('# setup toolkit managed route');
  console.log(`Active worktree branch: ${branchForSummary(activeRoot)}`);
  console.log(`Active worktree commit: ${commitForSummary(activeRoot)}`);
  console.log(`Active worktree status: ${statusForSummary(activeRoot)}`);
  console.log('Active worktree role: delegated to managed checkout');
  console.log(`Managed checkout commit: ${commitForSummary(managedRoot)}`);
  console.log('Managed setup script identity: verified question-bank protocol');
  console.log('Active worktree setup is bootstrap/fallback only; delegating to the managed checkout setup script.');
  console.log('');

  return runManagedQuestionBankChild(managedScript, managedRoot, args.argv,
    process.stdin.isTTY ? {} : { stdinSource: process.stdin });
}

function scriptRootForReadOnlyProbe(args) {
  if (args.repoRoot && fs.existsSync(path.join(args.repoRoot, 'repo', 'scripts', 'toolkit-local-bridge.cjs'))) return args.repoRoot;
  return repoRootFromScript();
}

function parseFirstJsonObject(stdout) {
  const text = String(stdout || '');
  const start = text.indexOf('{');
  if (start < 0) return null;
  try {
    return JSON.parse(text.slice(start));
  } catch {
    return null;
  }
}

function runBridgeAuditReadOnly(args) {
  const probeRoot = scriptRootForReadOnlyProbe(args);
  const result = runCommand(
    'node repo/scripts/toolkit-local-bridge.cjs --audit',
    process.execPath,
    bridgeArgs(args, ['--audit']),
    { cwd: probeRoot, capture: true, timeout: 120000, allowFailure: true, quiet: true }
  );
  if (result.status !== 0) {
    return {
      error: (result.stderr || result.stdout || '').trim(),
      repo_auto_update: {}
    };
  }
  return parseFirstJsonObject(result.stdout) || {
    error: 'bridge audit did not return JSON',
    repo_auto_update: {}
  };
}

function inspectManagedCheckout(args, audit) {
  const defaultPath = defaultManagedSourcePath();
  const configuredPath = audit?.repo_auto_update?.repo_path || '';
  const currentPath = configuredPath;
  const selectedPath = args.repoRootExplicit ? args.repoRoot : (configuredPath || args.repoRoot || defaultPath);
  const inspectionPath = currentPath || selectedPath;
  const exists = fs.existsSync(inspectionPath);
  const gitDir = exists ? runGitCapture(inspectionPath, ['rev-parse', '--git-dir'], 'git rev-parse --git-dir', true, true) : '';
  const branch = gitDir ? runGitCapture(inspectionPath, ['branch', '--show-current'], 'git branch --show-current', true, true) : '';
  const remote = gitDir ? runGitCapture(inspectionPath, ['remote', 'get-url', 'origin'], 'git remote get-url origin', true, true) : '';
  const status = gitDir ? runGitCapture(inspectionPath, ['status', '--short'], 'git status --short', true, true) : '';
  const commit = gitDir ? runGitCapture(inspectionPath, ['rev-parse', 'HEAD'], 'git rev-parse HEAD', true, true) : '';
  return {
    currentPath,
    selectedPath,
    defaultPath,
    exists,
    git: Boolean(gitDir),
    branch,
    remote,
    dirty: Boolean(status),
    status,
    commit
  };
}

function printDelegationPreview(preview) {
  console.log('');
  console.log('# Codex helper-agent config preview');
  console.log(`Codex config path: ${preview.config_path}`);
  console.log(`Effective runtime: ${runtimeLabel(preview.runtime)}`);
  console.log(`Before semantics: ${preview.before_semantics || preview.detail}`);
  console.log(`After semantics: ${preview.detail}`);
  console.log(`Requested helper agents: ${preview.helper_count}`);
  if (preview.total_threads != null) console.log(`Total session threads including the main agent: ${preview.total_threads}`);
  console.log(`Exact affected keys: ${(preview.affected_keys || []).join(', ') || 'none; marker-only cleanup preserves compatible user-owned assignments'}`);
  if (preview.repair) {
    console.log('Historical Toolkit marker repair required: yes');
    console.log(`Malformed marker classes: ${(preview.repair.kinds || []).join(', ')}`);
    console.log(`Marker/assignment categories to remove or replace: ${(preview.repair.marker_categories || []).join(', ')}`);
    console.log(`Exact affected line ranges: ${(preview.repair.affected_ranges || []).map((range) => `${range.line_start}-${range.line_end}`).join(', ')}`);
    console.log(`Legacy Toolkit material removed: ${preview.repair.remove_legacy_material ? 'yes' : 'no'}`);
    console.log(`Current Toolkit material replaced: ${preview.repair.remove_current_material ? 'yes' : 'no'}`);
    console.log(`Supported current representation written: ${preview.repair.write_current_representation ? 'yes' : 'no'}`);
    console.log('Unrelated configuration bytes remain unchanged: yes');
  }
  if (preview.proposed_block) {
    console.log('Proposed Toolkit-managed TOML block:');
    console.log('```toml');
    console.log(preview.proposed_block);
    console.log('```');
  } else if (preview.preserve_compatible_user_values) {
    console.log('Compatible user-owned assignments preserved byte-for-byte: yes');
    console.log('New Toolkit ownership markers written: no');
  }
  console.log(`Proposed edit: ${preview.proposed_action}`);
  console.log(`Proposal digest (SHA-256): ${preview.proposal_digest}`);
  console.log(`Codex backup directory: ${preview.backup_root}`);
  console.log(`Planned exact backup metadata: ${preview.backup_metadata_path}`);
  console.log(`Restore command setup script: ${preview.restore_commands.setup_script_path}`);
  console.log(`Exact restore command after the approved write (PowerShell): ${preview.restore_commands.powershell}`);
}

function printDelegationRemovalPreview(preview) {
  console.log('');
  console.log('# Codex helper-limit removal preview');
  console.log(`Codex config path: ${preview.config_path}`);
  console.log(`Effective runtime: ${runtimeLabel(preview.runtime)}`);
  console.log(`Before semantics: ${preview.before_semantics || preview.detail}`);
  console.log(`After semantics: ${preview.detail}`);
  console.log(`Exact affected keys: ${(preview.affected_keys || []).join(', ')}`);
  console.log(`Proposed edit: ${preview.proposed_action}`);
  console.log(`Codex backup directory: ${preview.backup_root}`);
  console.log(`Planned exact backup metadata: ${preview.backup_metadata_path}`);
  console.log(`Exact restore command after the approved write (PowerShell): ${preview.restore_commands.powershell}`);
}

async function applyHostDelegationControl(args, current, nativeCache = {}) {
  if (args.host === 'claude-code') return applyClaudeAgentControl(args, current, nativeCache);
  if (args.host !== 'codex') {
    return { status: 'unsupported', detail: 'No enforceable host topology profile is available; portable root-first launch gates still apply', client_scope: 'not applicable', changed: false };
  }
  return applyCodexDelegationControl(args, current);
}

// Codex's helper runtime as the form of Toolkit's own block in config.toml says: the V1 or V2 form
// Toolkit wrote for that runtime, else unknown. Read from the file only, so the plan never starts
// Codex; Codex itself is checked after the owner answers, and only for a helper change.
function codexRuntimeFromConfig() {
  const block = delegation.inspectCodexDelegationConfig(delegation.codexConfigPath(), RUNTIMES.UNKNOWN);
  const runtime = { 'toolkit-managed-v1': RUNTIMES.V1, 'toolkit-managed-v2': RUNTIMES.V2 }[block.ownership] || RUNTIMES.UNKNOWN;
  return {
    runtime,
    detector: "the form of Toolkit's helper block in config.toml",
    from_config: true,
    detail: runtime === RUNTIMES.UNKNOWN
      ? 'No Toolkit helper block shows which helper feature Codex runs; setup checks with Codex after you answer.'
      : `Toolkit's helper block in config.toml is the ${runtimeLabel(runtime)} form; setup checks with Codex after you answer.`,
  };
}

// The helper settings in config.toml for that runtime. With no Toolkit block to show the runtime,
// the reading is the form that has helper settings (V2 when both or neither do), and Codex is
// checked after the answers.
function codexDelegationFromConfig(runtime) {
  const configPath = delegation.codexConfigPath();
  if (runtime !== RUNTIMES.UNKNOWN) return delegation.inspectCodexDelegationConfig(configPath, runtime);
  const [v1, v2] = [RUNTIMES.V1, RUNTIMES.V2].map((form) => delegation.inspectCodexDelegationConfig(configPath, form));
  const reading = v1.status !== 'unconfigured' && v2.status === 'unconfigured' ? v1 : v2;
  const detail = v1.status === 'unconfigured' && v2.status === 'unconfigured' ? 'No helper limit is set in config.toml.' : reading.detail;
  return { ...reading, runtime, detail: `${detail} Setup checks which helper feature Codex runs after you answer.` };
}

function collectCurrentState(args) {
  const audit = runBridgeAuditReadOnly(args);
  const runtime = args.host === 'codex'
    ? codexRuntimeFromConfig()
    : { runtime: RUNTIMES.UNKNOWN, detector: 'not applicable', detail: 'Codex runtime detection is not applicable to this host.' };
  const delegationState = args.host === 'codex'
    ? codexDelegationFromConfig(runtime.runtime)
    : { status: 'unsupported', detail: 'No enforceable host topology profile is available; portable root-first launch gates still apply', client_scope: 'not applicable' };
  const delegationMigrationPreview = args.host === 'codex' && delegationState.status === 'migration-required'
    ? delegation.previewCodexDelegation(delegationState.config_path, {
        runtime: runtime.runtime,
        helperCount: delegationState.helper_count,
        setupScriptPath: path.resolve(__dirname, 'setup-toolkit.cjs'),
      })
    : null;
  const agentProfile = args.host === 'claude-code' ? agentControl.readProfile('claude-code') : agentControl.readProfile('codex');
  const managed = inspectManagedCheckout(args, audit);
  return {
    audit,
    runtime,
    managed,
    delegation: delegationState,
    delegationMigrationPreview,
    agentProfile,
    taskAutoMerge: taskAutoMerge(null, { host: args.host }).preference,
    ...(args.host === 'claude-code' ? { claudeSubagentDepth: new ClaudeSubagentDepthSetting().inspect(), claudeSettings: new ClaudeUserSettings().inspect() } : {}),
    antigravity: antigravityState(args),
    nativePlugin: args.host === 'claude-code'
      ? inspectClaudeNativePluginStatePreApproval(args)
      : { status: 'verification-deferred', detail: 'Read from the Codex files; the Codex plugin commands run only after you choose Install or refresh.' },
    // Read from Claude Code's plugin registry files only; no Claude session is launched before approval.
    ...(args.host === 'claude-code' ? { claudePluginInstall: claudePluginInstallState(new ClaudePluginRegistry()) } : {}),
    // Read from the Codex files only, against the update source 1.1 recommends; Codex is not started.
    ...(args.host === 'codex' ? { codexInstall: new CodexToolkitInstall({ managedRoot: recommendedUpdateSource({ managed }, args) }).read({ freshness: true }) } : {}),
  };
}

function currentReportRetentionDays(current) {
  return current?.audit?.update_report_retention_days || DEFAULT_UPDATE_REPORT_RETENTION_DAYS;
}

function hasUnsafeManagedPathMarker(value) {
  const normalized = slash(path.resolve(value || '')).toLowerCase();
  return ['/.tmp/', '/.codex/plugins/cache/', '/.claude/plugins/cache/', '/.codex/.tmp/marketplaces/']
    .some((marker) => normalized.includes(marker));
}

function isStandardManagedCheckout(current) {
  if (!current?.managed?.currentPath) return false;
  return samePath(current.managed.currentPath, current.managed.defaultPath);
}

function canPreserveManagedCheckout(current, args) {
  const managed = current?.managed || {};
  if (!managed.currentPath) return false;
  const resolved = path.resolve(managed.currentPath);
  if (isInside(repoRootFromScript(), resolved) && !(isRunningFromStandardManagedCheckout() && isStandardManagedPath(resolved))) return false;
  if (hasUnsafeManagedPathMarker(resolved)) return false;
  if (!managed.exists || !managed.git || managed.dirty) return false;
  if (managed.branch !== args.repoBranch) return false;
  return normalizeRemote(managed.remote) === normalizeRemote(args.repoRemote);
}

function recommendedChoice(key, current, args) {
  if (key === 'managedCheckout') {
    return canPreserveManagedCheckout(current, args) && isStandardManagedCheckout(current) ? 'keep' : 'default';
  }
  if (key === 'taskAutoMerge') return 'after-gates';
  if (key === 'repoAutoUpdate') return 'enable';
  if (key === 'updateReports') return 'enable';
  if (key === 'codexDocLimit') return 'enable';
  if (key === 'updateReportRetention') return currentReportRetentionDays(current) === DEFAULT_UPDATE_REPORT_RETENTION_DAYS ? 'keep' : 'default';
  if (key === 'codexPluginAutoRefresh') return 'enable';
  if (key === 'codexHelperCapacity') {
    if (current.delegation?.status === 'migration-required') return 'keep';
    // With no Toolkit block the file cannot show the runtime, but one helper suits V1 and V2 alike;
    // Codex is checked after the answers.
    const runtimeRead = current.runtime?.from_config === true || [RUNTIMES.V1, RUNTIMES.V2].includes(current.runtime?.runtime);
    return runtimeRead && !['migration-required', 'unsupported'].includes(current.delegation?.status) && !/enablement is false or non-boolean/.test(current.delegation?.detail || '') ? 'one-helper' : 'keep';
  }
  if (key === 'claudeTopology') return 'root-only';
  if (key === 'claudePluginBehavior') return 'install';
  if (key === 'codexPluginBehavior') return codexPluginUnchanged(current, args) ? 'keep' : 'install';
  if (key === 'antigravitySkills') return current.antigravity?.copies ? 'copy' : 'keep';
  return 'keep';
}

function wizardChoice(value, label, consequence) {
  return { value, label, consequence };
}

// currentChoice names the choice that would change nothing in the verified current state. It does the
// same as keep, so the bank shows the two as one Keep current, whatever is recommended, and the other
// choices are only the ones that change something. Usually keep stays and its twin is hidden. With keepAs
// (the twin also re-checks or follows another answer, which keep would skip), the twin stays under the
// Keep current label with keepAs as its effect, and keep is hidden. Either way the hidden choice's
// canonical name (a flag or a typed word) still works and applies as the shown one.
function foldedTwin(definition) {
  const twin = definition.currentChoice;
  const has = (value) => definition.choices?.some((choice) => choice.value === value);
  return twin && twin !== 'keep' && has(twin) && has('keep') ? twin : '';
}

function foldDefinition(definition, twin) {
  const keep = definition.choices.find((choice) => choice.value === 'keep');
  const [hidden, shown] = definition.keepAs ? ['keep', twin] : [twin, 'keep'];
  const choices = definition.choices.filter((choice) => choice.value !== hidden)
    .map((choice) => (definition.keepAs && choice.value === twin ? { ...choice, label: keep.label, consequence: definition.keepAs } : choice));
  const recommendation = definition.recommendation.value !== hidden && !definition.keepAs ? definition.recommendation
    : { ...definition.recommendation, value: shown, outcome: choices.find((choice) => choice.value === shown).consequence };
  return {
    definition: { ...definition, choices, recommendation, selected: definition.selected === hidden ? shown : definition.selected },
    fold: { folded_value: hidden, folded_into: shown },
  };
}

function resolvedQuestion(definition) {
  const twin = foldedTwin(definition);
  let fold = null;
  if (twin) ({ definition, fold } = foldDefinition(definition, twin));
  const recommendation = definition.recommendation;
  if (!definition.id || !definition.key || !definition.title) throw new Error('Setup question metadata is incomplete.');
  if (!definition.whatThisControls || !definition.current || !recommendation?.value
      || !recommendation.outcome || !recommendation.reason) {
    throw new Error(`Setup question ${definition.id} is missing required semantic metadata.`);
  }
  if (!Array.isArray(definition.choices) || !definition.choices.length
      || definition.choices.some((choice) => !choice.value || !choice.label || !choice.consequence)) {
    throw new Error(`Setup question ${definition.id} has a choice without a consequence.`);
  }
  if (!definition.choices.some((choice) => choice.value === recommendation.value)) {
    throw new Error(`Setup question ${definition.id} recommends an unavailable choice.`);
  }
  // Order after folding so Keep current is always A, including keepAs rows.
  const keepValue = fold?.folded_value === 'keep' ? fold.folded_into : 'keep';
  const choices = [
    ...definition.choices.filter((choice) => choice.value === keepValue),
    ...definition.choices.filter((choice) => choice.value !== keepValue),
  ];
  return {
    id: definition.id,
    key: definition.key,
    section: definition.section,
    title: definition.title,
    prompt: definition.prompt,
    whatThisControls: definition.whatThisControls,
    currentState: {
      effectiveBehavior: definition.current,
      verification: definition.currentVerification || 'verified',
      ...(definition.recordDigest ? { record_digest: definition.recordDigest } : {}),
    },
    recommendation: { ...recommendation },
    choices: choices.map((choice) => ({ ...choice })),
    afterApplying: definition.afterApplying || '',
    availability: definition.availability || { status: 'available', condition: 'Available for the detected setup state.' },
    privacySafeFallback: definition.privacySafeFallback || 'The effective state could not be verified safely; setup will not guess or expose private configuration.',
    selected: definition.selected,
    ...(fold || {}),
    // Compatibility aliases for existing consumers. Every alias is derived from
    // the structured semantic fields above rather than maintained separately.
    description: definition.whatThisControls,
    current: definition.current,
    current_short: definition.currentShort || definition.current,
    recommended: recommendation.value,
    recommended_outcome: recommendation.outcome,
    recommendation_reason: recommendation.reason,
  };
}

function choiceValues(spec) {
  return spec.choices.map((choice) => choice.value);
}

function choiceLabel(spec, value) {
  return spec.choices.find((choice) => choice.value === value)?.label || value || '(answer required)';
}

function selectedChoice(spec, value) {
  return spec.choices.find((choice) => choice.value === value) || null;
}

function spreadsheetChoiceReference(index) {
  if (!Number.isSafeInteger(index) || index < 1 || index > 702) {
    throw new Error('Setup question choices exceed the supported A-ZZ presentation range.');
  }
  let value = index;
  let reference = '';
  while (value > 0) {
    value -= 1;
    reference = String.fromCharCode(65 + (value % 26)) + reference;
    value = Math.floor(value / 26);
  }
  return reference;
}

function questionBankApprovalPayload(specs) {
  const sectionMap = new Map();
  for (const spec of specs) {
    const sectionKey = `${spec.presentation.section_index}:${spec.presentation.section_id}`;
    if (!sectionMap.has(sectionKey)) {
      sectionMap.set(sectionKey, {
        section_id: spec.presentation.section_id,
        section_index: spec.presentation.section_index,
        title: spec.section,
        question_count: spec.presentation.question_count
          || answerable(specs).filter((candidate) => candidate.section === spec.section).length,
      });
    }
  }
  return {
    schema: 'ai-agent-toolkit.setup-question-bank-approval.v2',
    host: specs[0]?.presentation?.host || 'unknown',
    total_visible_section_count: specs[0]?.presentation?.total_visible_section_count || sectionMap.size,
    total_visible_question_count: specs[0]?.presentation?.total_visible_question_count || specs.length,
    sections: [...sectionMap.values()],
    questions: specs.map((spec) => {
      const recommendedChoice = selectedChoice(spec, spec.recommended);
      const displayedSelection = spec.selected || spec.empty_input || '';
      const displayedChoice = selectedChoice(spec, displayedSelection);
      return {
        id: spec.id,
        key: spec.key,
        section_id: spec.presentation.section_id,
        section_index: spec.presentation.section_index,
        question_index: spec.presentation.question_index,
        question_ref: spec.presentation.question_ref,
        section_title: spec.section,
        title: spec.title,
        ...(spec.report_only ? { report_only: true } : {}),
        what_this_controls: spec.whatThisControls,
        current: {
          effective_behavior: spec.currentState?.effectiveBehavior || spec.current,
          displayed_text: spec.current,
          table_text: spec.current_short || spec.current,
          verification: spec.currentState?.verification || 'unverified',
          ...(spec.currentState?.record_digest ? { record_digest: spec.currentState.record_digest } : {}),
        },
        availability: {
          status: spec.availability?.status || 'available',
          condition: spec.availability?.condition || '',
        },
        recommendation: {
          canonical_value: spec.recommended,
          choice_ref: spec.presentation.recommended_choice_ref,
          label: recommendedChoice?.label || '',
          outcome: spec.recommended_outcome,
          reason: spec.recommendation_reason,
        },
        choices: spec.choices.map((choice) => ({
          presentation_ref: choice.presentation_ref,
          canonical_value: choice.value,
          label: choice.label,
          consequence: choice.consequence,
        })),
        after_applying: spec.afterApplying,
        displayed_selection: {
          canonical_value: displayedSelection,
          choice_ref: displayedChoice?.presentation_ref || '',
          label: displayedChoice?.label || '',
        },
      };
    }),
  };
}

function questionBankSemanticIdentity(specs) {
  return crypto.createHash('sha256').update(JSON.stringify(questionBankApprovalPayload(specs))).digest('hex');
}

function bankReferenceFromIdentity(identity) {
  const bytes = Buffer.from(String(identity || ''), 'hex');
  if (bytes.length !== 32) throw new Error('Setup question bank identity must be a SHA-256 digest.');
  let bits = 0;
  let bitCount = 0;
  let compact = '';
  for (const byte of bytes.subarray(0, 10)) {
    bits = (bits << 8) | byte;
    bitCount += 8;
    while (bitCount >= 5) {
      bitCount -= 5;
      compact += BANK_REFERENCE_ALPHABET[(bits >>> bitCount) & 31];
      bits &= (1 << bitCount) - 1;
    }
  }
  return compact.match(/.{4}/g).join('-');
}

// Accepts any case, optional hyphens and the look-alike letters the alphabet leaves out
// (O for 0, I or L for 1). The result must still equal the displayed reference exactly.
function normalizeBankReference(value) {
  const compact = String(value || '').trim().toUpperCase().replace(/-/g, '')
    .replace(/O/g, '0').replace(/[IL]/g, '1');
  if (compact.length !== 16) return '';
  const normalized = compact.match(/.{4}/g).join('-');
  return BANK_REFERENCE_PATTERN.test(normalized) ? normalized : '';
}

function withPresentationMetadata(specs, host = specs[0]?.presentation?.host || 'unknown') {
  const sections = [];
  const sectionByName = new Map();
  for (const spec of specs) {
    if (!sectionByName.has(spec.section)) {
      const section = {
        id: spec.section.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        index: sections.length + 1,
        title: spec.section,
        question_count: 0,
      };
      sections.push(section);
      sectionByName.set(spec.section, section);
    }
    if (!spec.report_only) sectionByName.get(spec.section).question_count += 1;
  }
  // A report-only row is an unnumbered status line at the end of its section, so the numbered
  // questions stay contiguous and every number has letters.
  specs = [...specs].sort((left, right) => sectionByName.get(left.section).index - sectionByName.get(right.section).index
    || Number(Boolean(left.report_only)) - Number(Boolean(right.report_only)));
  const questionCount = answerable(specs).length;
  const seenBySection = new Map();
  const presented = specs.map((spec) => {
    const section = sectionByName.get(spec.section);
    const questionIndex = spec.report_only ? null : (seenBySection.get(spec.section) || 0) + 1;
    if (questionIndex) seenBySection.set(spec.section, questionIndex);
    const choices = spec.choices.map((choice, index) => ({
      ...choice,
      presentation_ref: spreadsheetChoiceReference(index + 1),
    }));
    const recommendedChoice = choices.find((choice) => choice.value === spec.recommended);
    return {
      ...spec,
      choices,
      presentation: {
        host,
        section_id: section.id,
        section_index: section.index,
        question_index: questionIndex,
        question_ref: questionIndex ? `${section.index}.${questionIndex}` : '',
        // A report-only row has no choices, so no recommended letter.
        recommended_choice_ref: recommendedChoice?.presentation_ref || '',
        total_visible_section_count: sections.length,
        total_visible_question_count: questionCount,
      },
    };
  });
  const bankIdentity = questionBankSemanticIdentity(presented);
  const bankReference = bankReferenceFromIdentity(bankIdentity);
  return presented.map((spec) => ({
    ...spec,
    presentation: { ...spec.presentation, bank_identity: bankIdentity, bank_reference: bankReference },
  }));
}

function ensurePresentationMetadata(specs) {
  // Presentation references are derived from the exact visible array. Always
  // rebuild them so a caller that filters an already-presented bank cannot
  // retain gaps or a stale bank identity.
  return withPresentationMetadata(specs);
}

function choiceByPresentationReference(spec, reference) {
  const normalized = String(reference || '').trim().toUpperCase();
  return spec.choices.find((choice) => choice.presentation_ref === normalized) || null;
}

function choiceReference(spec, value) {
  return selectedChoice(spec, value)?.presentation_ref || '';
}

function assertManagedCheckoutChoiceAvailable(args, specs) {
  const spec = specs.find((candidate) => candidate.key === 'managedCheckout');
  const selected = spec ? choiceForKey(args, spec.key) : '';
  if (selected && !choiceValues(spec).includes(selected)) {
    throw new Error(`${spec.title} must be one of: ${choiceValues(spec).join(', ')}`);
  }
}

function currentManagedSourceOutcome(current, args) {
  const managed = current?.managed || {};
  if (!managed.currentPath) return 'No Toolkit update source is configured yet.';
  if (canPreserveManagedCheckout(current, args)) {
    if (isStandardManagedCheckout(current)) return 'Toolkit uses the dedicated clean managed copy for updates.';
    return 'Toolkit uses a separate clean custom checkout for updates; the active project checkout is not the update source.';
  }
  if (!managed.exists) return 'The saved update source cannot be found, so Toolkit cannot use it until setup repairs or replaces that source.';
  if (!managed.git) return 'The saved update source exists but is not a verified Toolkit Git checkout.';
  if (managed.dirty) return 'The configured update source has local changes, so automatic updates will leave it untouched.';
  const resolved = path.resolve(managed.currentPath);
  if ((isInside(repoRootFromScript(), resolved) && !(isRunningFromStandardManagedCheckout() && isStandardManagedPath(resolved)))
      || hasUnsafeManagedPathMarker(resolved)) {
    return 'The configured update source is in a location Toolkit cannot safely preserve, so a safe source must be selected.';
  }
  if (managed.branch && managed.branch !== args.repoBranch) return 'The configured update source is on a different branch, so it is not currently ready for managed updates.';
  if (managed.remote && normalizeRemote(managed.remote) !== normalizeRemote(args.repoRemote)) {
    return 'The configured update source points at an unexpected remote, so Toolkit will not fetch from it.';
  }
  return 'The configured update source could not be verified safely, so a safe source must be selected.';
}

// Root-only sets the one-layer depth outside Toolkit repos; broader-native returns to Claude
// Code's own limit by removing only Toolkit's value; keep changes nothing.
const SUBAGENT_DEPTH_FOR_TOPOLOGY = Object.freeze({ 'root-only': 'enable', 'broader-native': 'disable', keep: 'keep' });

function claudeSubagentDepthChoice(options) {
  return options.claudeSubagentDepthChoice || SUBAGENT_DEPTH_FOR_TOPOLOGY[options.setupChoices?.claudeTopology] || '';
}

const N8N_SKILLS_PLUGIN = 'n8n-skills@n8n-io';

// A file-system error names its code only, so no private path reaches the summary.
const copyFailure = (error) => (error?.code ? `file error ${error.code}` : error.message);

// Keeps Toolkit's copies of the official n8n skills current in this app's skills folder (and Antigravity's).
// The n8n Skills plugin would load the same skills twice: after a good copy, Claude Code's user-scope
// plugin is turned off; Codex has no supported switch, so the summary says how.
function installOfficialN8nSkills(args, owner = new OfficialN8nSkills({ toolkitRoot: args.repoRoot, host: args.host, antigravity: antigravityState(args).copies }),
  disablePlugin = (id) => disableUserPlugin(id, { claudeCli: args.claudeCli })) {
  let summary;
  try { summary = n8nSkillsSummary(owner.install()); }
  catch (error) { return `not copied (${copyFailure(error)}).`; }
  if (args.host !== 'claude-code') return `${summary}. If the n8n Skills plugin is installed, turn it off in the Codex app's plugin settings so the skills do not load twice.`;
  try { return disablePlugin(N8N_SKILLS_PLUGIN) ? `${summary}. Turned off the n8n Skills plugin so the skills do not load twice.` : `${summary}.`; }
  catch (error) { return `${summary}. Could not turn off the n8n Skills plugin (${error.message}); run \`claude plugin disable ${N8N_SKILLS_PLUGIN}\` so the skills do not load twice.`; }
}

// Whether Antigravity is installed and whether Toolkit's copies of its skills are already there.
function antigravityState(args, owner = new AntigravityGlobalSkills({ toolkitRoot: args.repoRoot })) {
  try { return { installed: owner.installed(), copies: owner.hasCopies() }; }
  catch { return { installed: false, copies: false }; }
}

function antigravitySkillsOutcome(state) {
  if (state?.copies) return "Toolkit's skills are in Antigravity's global skills folder.";
  return "Toolkit's skills are not in Antigravity's global skills folder.";
}

function antigravitySkillsQuestion(args, current) {
  const outcome = antigravitySkillsOutcome(current.antigravity);
  return resolvedQuestion({
    id: 'antigravity-skills',
    key: 'antigravitySkills',
    section: 'Toolkit in your coding apps',
    title: "Copy Toolkit's skills into Antigravity?",
    prompt: 'Antigravity skills choice',
    whatThisControls: "Whether setup copies Toolkit's portable skills, and the official n8n skills Toolkit ships, into Antigravity's global skills folder (~/.gemini/config/skills) and keeps them current on each setup. Toolkit-only skills (setup, env, controller and programme tools) stay out. Folders you copied yourself are never changed.",
    choices: [
      wizardChoice('copy', 'Copy and keep updated', "Copy Toolkit's portable skills and the official n8n skills into ~/.gemini/config/skills, update Toolkit's copies when they are out of date, and record them."),
      ...(current.antigravity?.copies ? [wizardChoice('remove', "Remove Toolkit's copies", 'Delete only the skill folders Toolkit recorded there.')] : []),
      wizardChoice('keep', 'Keep current', `Preserve this effective behavior: ${outcome}`),
    ],
    recommendation: current.antigravity?.copies
      ? { value: 'copy', outcome: "Keep Toolkit's skills in Antigravity current.", reason: 'You chose to copy them before, so setup keeps those copies up to date.' }
      : { value: 'keep', outcome: 'Leave Antigravity unchanged.', reason: 'The copy is opt-in: choose it if you use Toolkit skills in Antigravity.' },
    selected: args.setupChoices.antigravitySkills,
    current: outcome,
    currentShort: current.antigravity?.copies ? 'Copied' : 'Not copied',
    currentVerification: 'state-derived',
    afterApplying: 'Start a new Antigravity session to load changed skills.',
  });
}

// Applies the owner's answer for Toolkit's skills in Antigravity; keep changes nothing.
function applyAntigravitySkills(args, owner = new AntigravityGlobalSkills({ toolkitRoot: args.repoRoot }),
  n8n = new OfficialN8nSkills({ toolkitRoot: args.repoRoot, host: args.host, antigravity: true })) {
  const choice = args.setupChoices.antigravitySkills || 'keep';
  try {
    if (choice === 'copy') return `${globalCopySummary(owner.install())}.`;
    if (choice === 'remove') {
      // Toolkit's n8n skill copies in Antigravity go with them.
      return `removed ${owner.remove().length + n8n.remove(n8n.antigravityTarget()).length} Toolkit skill folders.`;
    }
  } catch (error) { return `not changed (${copyFailure(error)}).`; }
  return '';
}

function claudeSubagentDepthOutcome(depth) {
  if (depth?.state === SUBAGENT_DEPTH_STATES.TOOLKIT) return 'Your Claude Code user settings set CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1 (set by Toolkit). In Claude Code 2.1.217 or later this allows one layer: the main session may start subagents; subagents never start another. Project, local or managed Claude settings can override it in a folder.';
  if (depth?.state === SUBAGENT_DEPTH_STATES.OWNER) return `You set CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=${depth.value} in your Claude Code user settings yourself; Toolkit leaves it unchanged.`;
  if (depth?.state === SUBAGENT_DEPTH_STATES.DEFAULT) return 'CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH is not set in your Claude Code user settings, so Claude Code\'s own default applies.';
  if (depth?.state === SUBAGENT_DEPTH_STATES.UNREADABLE) return `${depth.detail} Toolkit will not change it.`;
  return 'The Claude Code subagent setting could not be verified; setup will not claim a limit is active.';
}

// What the Toolkit hook does in normal folders for a stored topology. Activation is not
// checked before approval, so this states the rule the installed hook applies.
function claudeHookNormalFolderOutcome(topology) {
  return topology === agentControl.TOPOLOGIES.BROADER_NATIVE
    ? 'The Toolkit hook does not refuse nested launches in normal folders.'
    : 'The Toolkit hook refuses nested launches in normal folders once this Toolkit version\'s plugin is installed and active.';
}

// The normal-folder result of this run: the topology actually applied, the depth setting
// actually in the settings file, and whether the hook's activation was verified this run.
function normalFolderOutcomeSummary(delegation, depth) {
  const native = claudeSubagentDepthOutcome(depth).replace(/\.$/, '');
  if (delegation.topology === agentControl.TOPOLOGIES.BROADER_NATIVE) {
    return `Claude Code's own limit; Toolkit does not refuse nested launches. ${native}.`;
  }
  const nativeOneLayer = depth?.state === SUBAGENT_DEPTH_STATES.TOOLKIT
    || (depth?.state === SUBAGENT_DEPTH_STATES.OWNER && depth.value === '1');
  const hookVerified = delegation.status === 'configured' && delegation.selected_strict_state_applied === true;
  const oneLayer = 'one layer; the main session may start subagents; subagents never start another';
  const pending = 'The Toolkit hook also refuses nested launches once the plugin is installed and active.';
  if (nativeOneLayer) {
    return hookVerified
      ? `${oneLayer} (the Claude Code user setting CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1, read by Claude Code 2.1.217 or later, and the installed Toolkit hook, verified this run).`
      : `${oneLayer} (the Claude Code user setting CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1, read by Claude Code 2.1.217 or later). ${pending}`;
  }
  return hookVerified
    ? `one layer, refused at the installed Toolkit hook (verified this run). ${native}.`
    : `${native}. ${pending}`;
}

function currentBooleanOutcome(value, enabledText, disabledText, unknownText) {
  if (value === true) return enabledText;
  if (value === false) return disabledText;
  return unknownText;
}

// Short current states for the bank's Current column; the full text stays in --explain and the reference.
function shortOnOff(value, on = 'On', off = 'Off') {
  if (value === true) return on;
  if (value === false) return off;
  return 'Unknown';
}

function shortUpdateSource(current, args) {
  if (!current?.managed?.currentPath) return 'None yet';
  if (!canPreserveManagedCheckout(current, args)) return 'Not usable';
  return isStandardManagedCheckout(current) ? 'Dedicated update copy' : 'Custom copy';
}

function shortCodexHelpers(delegation) {
  if (delegation?.status === 'configured' && Number.isInteger(delegation.helper_count)) {
    const form = { 'toolkit-managed-v1': ' (V1 setting)', 'toolkit-managed-v2': ' (V2 setting)' }[delegation.ownership] || '';
    return `${delegation.helper_count === 0 ? 'No helpers' : `${delegation.helper_count} helper${delegation.helper_count === 1 ? '' : 's'}`}${form}`;
  }
  if (delegation?.status === 'unconfigured') return 'Not set';
  if (delegation?.status === 'migration-required') return 'Old Toolkit setting';
  return 'Not verified';
}

function shortClaudeTopology(profile, depth) {
  const topology = profile?.topology === agentControl.TOPOLOGIES.BROADER_NATIVE ? 'Broader native' : 'Root only';
  if (depth?.state === SUBAGENT_DEPTH_STATES.TOOLKIT) return `${topology}; subagent limit 1`;
  if (depth?.state === SUBAGENT_DEPTH_STATES.OWNER) return `${topology}; subagent limit ${depth.value} (yours)`;
  if (depth?.state === SUBAGENT_DEPTH_STATES.DEFAULT) return `${topology}; no subagent limit set`;
  return `${topology}; subagent limit unknown`;
}

function shortClaudePlugin(current) {
  if (current.nativePlugin.status === 'fresh') return 'Current';
  const install = current.claudePluginInstall;
  if (install?.installed !== true) return 'Checked after you answer';
  const state = install.enabled === false ? 'Off' : install.enabled === true ? 'On' : 'Installed';
  const latest = current.nativePlugin.manifest_version;
  const notes = [latest && latest !== install.version ? `${latest} available` : '', claudePluginRecordLag(install)].filter(Boolean);
  return `${state}, ${install.version || 'version unknown'}${notes.length ? ` (${notes.join('; ')})` : ''}`;
}

// The on/off choice that reproduces a verified stored boolean; none when it is unverified.
function booleanCurrentChoice(value) {
  if (value === true) return 'enable';
  if (value === false) return 'disable';
  return '';
}

// A selection of a hidden choice (see foldedTwin) is applied as the shown one, which does the same thing.
function foldTwinSelections(args, specs) {
  for (const spec of specs) {
    if (spec.folded_value && choiceForKey(args, spec.key) === spec.folded_value) assignChoice(args, spec.key, spec.folded_into);
  }
  return specs;
}

// The update source 1.1 recommends: the current one when it is kept, else the standard managed copy.
function recommendedUpdateSource(current, args) {
  return recommendedChoice('managedCheckout', current, args) === 'keep' ? current.managed.currentPath : defaultManagedSourcePath();
}

// Automatic updates are on, with startup sync, and already check the source 1.1 recommends, so
// Turn on would write the same values again.
function automaticUpdatesUnchanged(current, args) {
  const saved = current.audit?.repo_auto_update || {};
  return saved.enabled === true && current.audit?.auto_sync_enabled === true && Boolean(saved.repo_path)
    && samePath(saved.repo_path, recommendedUpdateSource(current, args))
    && saved.repo_branch === args.repoBranch && normalizeRemote(saved.repo_remote) === normalizeRemote(args.repoRemote);
}

// Root-only is stored and the one-layer depth setting is already in place (set by Toolkit, or 1 set
// by you), so choosing root-only would change nothing. Keep resolves to root-only here too, whether or
// not the stored profile still verifies.
function claudeRootOnlyUnchanged(profile, depth) {
  return profile?.topology === agentControl.TOPOLOGIES.ROOT_ONLY
    && (depth?.state === SUBAGENT_DEPTH_STATES.TOOLKIT || (depth?.state === SUBAGENT_DEPTH_STATES.OWNER && depth.value === '1'));
}

// What Claude Code's plugin registry and user settings say about Toolkit: installed, where it runs
// from, the version of that folder, whether it is turned on, and whether Claude Code holds exactly
// one install record. Claude Code runs Toolkit in place from the folder, so its manifest is the
// version that runs; the record keeps the version and commit of its first install, which change
// nothing (measured on Claude Code 2.1.310), so only a missing or duplicate record counts as a
// change. Reads files only; no Claude session is launched.
function claudePluginInstallState(registry) {
  const install = registry.toolkitInstall();
  let version = '';
  if (install.installed) {
    try { version = JSON.parse(fs.readFileSync(path.join(install.runningRoot, '.claude-plugin', 'plugin.json'), 'utf8').replace(/^﻿/, '')).version || ''; }
    catch { version = ''; }
  }
  return {
    installed: install.installed,
    runningRoot: install.runningRoot,
    version,
    recordCurrent: Boolean(install.installed && install.records.length === 1),
    enabled: registry.toolkitEnabled(),
  };
}

// Toolkit is installed, turned on, runs in place from the update source 1.1 recommends, that folder is
// at the version of the Toolkit copy setup reads, and Claude Code holds one install record for it, so
// Install or refresh would find nothing to do.
function claudePluginUnchanged(current, args) {
  const install = current.claudePluginInstall;
  return install?.installed === true && install.enabled === true && install.recordCurrent === true
    && Boolean(install.version) && install.version === current.nativePlugin.manifest_version
    && samePath(install.runningRoot, recommendedUpdateSource(current, args));
}

// Why Claude Code's install records need rewriting, in a few words.
function claudePluginRecordLag(install) {
  if (install.recordCurrent !== false) return '';
  return 'Claude Code holds more than one install record for it';
}

function claudePluginCurrent(current, args) {
  if (current.nativePlugin.status === 'fresh') return 'The Claude Code Toolkit plugin is current.';
  if (current.nativePlugin.status === 'invalid-source-metadata') return 'Setup could not read the Claude Code plugin details in the Toolkit copy.';
  const install = current.claudePluginInstall;
  if (install?.installed === true) {
    const state = install.enabled === false ? 'turned off' : install.enabled === true ? 'turned on' : 'on or off unknown';
    const lag = claudePluginRecordLag(install);
    return `Claude Code runs Toolkit ${install.version || '(version unknown)'} (${state}); this Toolkit copy is ${current.nativePlugin.manifest_version || 'unknown'}.${lag ? ` ${lag}, so Install or refresh rewrites it.` : ''}`;
  }
  return 'Setup checks the Claude Code Toolkit plugin after you answer, and installs or refreshes it only if needed.';
}

// Toolkit in Codex is turned on, exactly one version is installed, it is the version of the update
// source 1.1 recommends and its files match that copy, Codex's marketplace runs from that source and
// no earlier setup step is unfinished, so Install or refresh would find nothing to do.
function codexPluginUnchanged(current, args) {
  const install = current.codexInstall;
  return install?.config === 'read' && install.plugin === 'on' && install.versions?.length === 1
    && Boolean(install.version) && install.version === install.sourceVersion && install.cacheFresh === true
    && !install.journalPending && Boolean(install.marketplacePath)
    && samePath(install.marketplacePath, recommendedUpdateSource(current, args));
}

// Why Install or refresh is recommended, in a few words each.
function codexPluginNotes(current, args) {
  const install = current.codexInstall;
  const notes = [];
  if (install.older) notes.push(`${install.sourceVersion} available`);
  else if (install.cacheFresh === false) notes.push('files differ from the update copy');
  if (!install.marketplacePath) notes.push('no Toolkit marketplace in Codex');
  else if (!samePath(install.marketplacePath, recommendedUpdateSource(current, args))) notes.push('runs from another folder');
  if (install.journalPending) notes.push('an earlier setup step did not finish');
  return notes;
}

const codexPluginWord = (install) => (install.plugin === 'on' ? 'On' : install.plugin === 'off' ? 'Off' : 'Installed');

function shortCodexPlugin(current, args) {
  const install = current.codexInstall;
  if (install.config === 'unreadable') return 'Could not read';
  if (!install.versions?.length) return 'Not installed';
  if (install.versions.length > 1) return `${codexPluginWord(install)}, ${install.versions.length} versions installed`;
  const notes = codexPluginNotes(current, args);
  return `${codexPluginWord(install)}, ${install.version}${notes.length ? ` (${notes.join('; ')})` : ''}`;
}

function codexPluginCurrent(current, args) {
  const install = current.codexInstall;
  if (install.config === 'unreadable') return 'Setup could not read the Codex config.toml, so it cannot tell whether Codex has Toolkit turned on.';
  if (!install.versions?.length) return 'Codex has no Toolkit plugin installed.';
  const state = install.plugin === 'on' ? 'turned on' : install.plugin === 'off' ? 'turned off' : 'on or off unknown';
  const runs = install.versions.length > 1
    ? `Codex has ${install.versions.length} Toolkit versions installed (${install.versions.join(', ')}); the newest is ${install.version}`
    : `Codex runs Toolkit ${install.version}`;
  const notes = codexPluginNotes(current, args);
  return `${runs} (${state}); the update copy has ${install.sourceVersion || 'no readable version'}.${notes.length ? ` Install or refresh is recommended: ${notes.join('; ')}.` : ''}`;
}

// The Toolkit hooks in Codex, from config.toml [hooks.state]; the owner turns them on in Codex.
function codexHookCells(current, args) {
  const install = current.codexInstall;
  const refresh = recommendedChoice('codexPluginBehavior', current, args) === 'install'
    ? ' Codex may ask you to review the hooks again after a refresh; check /hooks afterwards.' : '';
  const keep = { short: '', full: '', recommended: `Nothing to do.${refresh}`.replace(/\.$/, '') };
  if (install.config === 'unreadable') return { ...keep, short: 'Could not read', full: 'Setup could not read the Codex config.toml, so the Toolkit hook state is unknown.' };
  if (!install.versions?.length) return { ...keep, short: 'Not installed', full: 'Codex has no Toolkit plugin installed, so no Toolkit hook runs.' };
  if (install.plugin === 'off') return { ...keep, short: 'Plugin off', full: 'The Toolkit plugin is turned off in Codex, so no Toolkit hook runs.' };
  if (install.hooks?.status !== 'read' || !install.hooks.entries.length) return { ...keep, short: 'No hooks file', full: 'The installed Toolkit plugin has no readable hooks file.' };
  const { off, notReviewed, total } = hookGaps(install.hooks);
  const full = `Toolkit hooks in Codex: ${install.hooks.entries.map((entry) => `${entry.name} ${entry.state === 'not-reviewed' ? 'not reviewed' : entry.state}`).join('; ')}.`;
  if (!off.length && !notReviewed.length) return { ...keep, short: `All ${total} on`, full };
  const short = off.length === total ? `All ${total} off`
    : notReviewed.length === total ? `All ${total} not reviewed`
      : [off.length ? `Off: ${off.join(', ')}` : '', notReviewed.length ? `Not reviewed: ${notReviewed.join(', ')}` : ''].filter(Boolean).join('; ');
  const names = [...off, ...notReviewed];
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
  return { short, full, recommended: `Turn them on in Codex: open /hooks and turn on ${list}.${refresh}`.replace(/\.$/, '') };
}

// Codex's project_doc_max_bytes as config.toml has it, against Toolkit's recorded answer, and the
// answer that would change nothing: Raise it only when the record says raise and Toolkit's markers
// hold 65536 or more; Leave it only when the record says leave and Toolkit has no block there.
function codexDocLimitCells(current) {
  const record = current.audit?.codex_doc_limit_enabled;
  const install = current.codexInstall;
  if (install?.config === 'unreadable') return { short: 'Could not read', currentChoice: '' };
  const { value, toolkit } = install?.docLimit || { value: null, toolkit: false };
  const leave = record === false && !toolkit ? 'disable' : '';
  if (record === true && value !== 0 && (value === null || value < 65536)) return { short: `Record says raised; config has ${value ?? 32768}`, currentChoice: '' };
  if (value === null) return { short: 'Left alone (32 KiB default)', currentChoice: leave };
  if (value === 0) return { short: 'Project docs off (0)', currentChoice: leave };
  if (toolkit) return { short: `Raised (${value})`, currentChoice: record === true && value >= 65536 ? 'enable' : '' };
  return { short: `Yours (${value})`, currentChoice: leave };
}

// A report-only row: it shows Codex state the owner changes in Codex itself, takes no answer, has
// no number or letters and shows as a status line; its Current text is still bound into the bank identity.
function reportOnlyRow({ id, key, section, title, whatThisControls, current, currentShort, recommendedText }) {
  return {
    id, key, section, title, whatThisControls, report_only: true,
    currentState: { effectiveBehavior: current, verification: 'state-derived' },
    recommendation: null, choices: [], recommended_text: recommendedText,
    afterApplying: '', availability: { status: 'available', condition: 'Shown when Codex has a Toolkit home on this PC.' },
    description: whatThisControls, current, current_short: currentShort,
    recommended: '', recommended_outcome: recommendedText, recommendation_reason: 'Setup never edits this; you change it in Codex.',
  };
}

const answerable = (specs) => specs.filter((spec) => !spec.report_only);
const statusLine = (spec) => `Status (nothing to answer): ${spec.title}: ${spec.current_short || spec.current}. ${spec.recommended_text}.`;
const unanswered = (specs, args) => answerable(specs).filter((spec) => !choiceForKey(args, spec.key));

function taskAutoMergeQuestion(args, current) {
  const saved = current.taskAutoMerge || { status: 'missing', value: 'off', digest: null };
  const blocked = saved.status === 'blocked';
  const on = saved.value === 'after-gates' && saved.status === 'saved';
  const label = args.host === 'codex' ? 'Codex' : 'Claude Code';
  const state = blocked ? 'Could not read; automatic merging is blocked' : on ? 'On' : saved.status === 'missing' ? 'Off (no answer saved)' : 'Off';
  return resolvedQuestion({
    id: 'task-auto-merge', key: 'taskAutoMerge', section: 'Toolkit settings',
    title: `May ${label} merge finished task pull requests without you typing merge?`,
    prompt: `${label} task auto-merge choice`,
    whatThisControls: "Sets this app's answer on this computer, only for repositories with Toolkit governance enabled, after review, required checks and your testing pass. Governance, hooks, setup and merge-rule changes still need your typed merge.",
    choices: [
      wizardChoice('after-gates', 'On', 'Allow finished task pull requests to merge after the required gates pass.'),
      wizardChoice('off', 'Off', 'Wait for your typed merge for every task pull request.'),
      wizardChoice('keep', 'Keep current', `Keep ${state}; do not rewrite the saved answer.`),
    ],
    currentChoice: blocked ? '' : on ? 'after-gates' : 'off',
    recommendation: { value: recommendedChoice('taskAutoMerge', current, args), outcome: 'On: merge finished tasks after their gates pass.', reason: 'Finished tasks have passed review, checks and your testing; protected changes still wait for your typed merge.' },
    selected: args.setupChoices.taskAutoMerge,
    current: state, currentShort: state,
    currentVerification: blocked ? 'unverified' : 'verified',
    recordDigest: saved.digest || saved.status,
    availability: { status: blocked ? 'blocked' : 'available', condition: blocked ? 'Repair the unreadable answer before setup writes anything.' : 'Available for this app on this computer.' },
    afterApplying: 'The app-local answer is saved separately from app settings. Rule-refresh pull requests always wait for your typed merge.',
  });
}

function setupQuestionSpecs(args, current) {
  const managedRecommendation = recommendedChoice('managedCheckout', current, args);
  const managedCurrent = currentManagedSourceOutcome(current, args);
  const retentionRaw = current?.audit?.update_report_retention_days;
  const retentionCurrent = Number.isSafeInteger(retentionRaw) && retentionRaw > 0
    ? `Toolkit maintenance reports are currently kept for ${retentionRaw} day(s).`
    : `The saved retention duration could not be verified; the effective safe fallback is ${DEFAULT_UPDATE_REPORT_RETENTION_DAYS} days.`;
  const docLimit = codexDocLimitCells(current);
  const docLimitCurrent = `${currentBooleanOutcome(current.audit?.codex_doc_limit_enabled, "Toolkit's record says keep Codex's instruction limit raised.", "Toolkit's record says leave Codex's instruction limit alone.", "No choice is recorded, so Toolkit leaves Codex's instruction limit alone.")} Codex's config.toml: ${docLimit.short}.`;
  const specs = [
    resolvedQuestion({
      id: 'update-source',
      key: 'managedCheckout',
      section: 'Updates and reports',
      title: 'Update source',
      prompt: 'Toolkit update source choice',
      whatThisControls: 'Where Toolkit fetches and prepares future updates. A dedicated clean managed copy stays separate from active project repositories, so setup never pulls into or modifies the dirty project checkout you are working in.',
      choices: [
        wizardChoice('default', 'Use the dedicated clean update copy', 'Create or reuse the standard managed checkout, verify its clean main branch, and make it the update source without moving or deleting another checkout.'),
        ...(canPreserveManagedCheckout(current, args)
          ? [wizardChoice('keep', 'Keep current', `Preserve this effective behavior: ${managedCurrent}`)]
          : []),
        wizardChoice('custom', 'Choose another location', 'Create or reuse a clean Toolkit checkout at the approved location and make that location the managed update source; existing managed copies are not migrated or deleted.'),
      ],
      currentChoice: canPreserveManagedCheckout(current, args) && isStandardManagedCheckout(current) ? 'default' : '',
      recommendation: {
        value: managedRecommendation,
        outcome: managedRecommendation === 'keep'
          ? 'Keep using the verified dedicated clean managed copy.'
          : 'Use the standard dedicated clean managed copy.',
        reason: 'Separating update operations from active branches and uncommitted project work makes fetch, verification, and safe activation predictable.',
      },
      selected: args.setupChoices.managedCheckout,
      current: managedCurrent,
      currentShort: shortUpdateSource(current, args),
      currentVerification: current?.managed?.currentPath && current?.managed?.exists ? 'state-derived' : 'unverified-or-absent',
      afterApplying: 'After final approval, setup will create or verify only the selected managed checkout and store it as Toolkit update state. The active project checkout is unchanged; no existing managed copy is moved or removed.',
      availability: {
        status: canPreserveManagedCheckout(current, args) ? 'available' : 'current-source-unavailable',
        condition: canPreserveManagedCheckout(current, args)
          ? 'The current source is offered only because its configured path, Git state, cleanliness, branch, remote, and safe location all verify.'
          : 'Keep current is omitted because no configured source can be preserved safely; the default and custom choices remain available.',
      },
    }),
    resolvedQuestion({
      id: 'automatic-updates',
      key: 'repoAutoUpdate',
      section: 'Updates and reports',
      title: 'Automatic updates',
      prompt: 'Automatic Toolkit updates choice',
      whatThisControls: 'Whether Toolkit checks the managed update source when a supported coding app starts. Any update still has to be fetched, fast-forwarded, validated, and safely activated before enabled integrations use it.',
      choices: [
        wizardChoice('enable', 'Turn on', 'Store automatic maintenance as enabled so trusted startup maintenance checks for, verifies, and safely activates clean updates, and point automatic updates at the update source chosen above.'),
        wizardChoice('disable', 'Turn off', 'Disable startup update checks and automatic hub synchronization; manual `setup toolkit` or explicit maintenance remains available.'),
        wizardChoice('keep', 'Keep current', `Preserve this effective behavior: ${currentBooleanOutcome(current.audit?.repo_auto_update?.enabled, 'Automatic startup update checks are on.', 'Automatic startup update checks are off; manual setup remains available.', 'The automatic-update state could not be verified; setup will not claim that startup updates are active.')} The update source it checks stays as it is.`),
      ],
      // Turn on also points updates at the update source chosen in 1.1, which keep does not, so it is
      // the one kept under the Keep current label.
      currentChoice: automaticUpdatesUnchanged(current, args) ? 'enable' : '',
      keepAs: 'Keep automatic updates on. They check the update source chosen in 1.1; if you choose another source there, they follow it.',
      recommendation: {
        value: recommendedChoice('repoAutoUpdate', current, args),
        outcome: 'Turn on clean, verified automatic updates.',
        reason: 'Startup checks keep Toolkit current while the clean-checkout, expected-remote, fast-forward, and validation gates protect active work.',
      },
      selected: args.setupChoices.repoAutoUpdate,
      currentShort: shortOnOff(current.audit?.repo_auto_update?.enabled),
      current: currentBooleanOutcome(current.audit?.repo_auto_update?.enabled, 'Automatic startup update checks are on.', 'Automatic startup update checks are off; manual setup remains available.', 'The automatic-update state could not be verified; setup will not claim that startup updates are active.'),
      currentVerification: typeof current.audit?.repo_auto_update?.enabled === 'boolean' ? 'verified' : 'unverified',
      afterApplying: 'This changes Toolkit maintenance state and future trusted SessionStart behavior; it does not directly edit native host configuration and does not require a restart by itself.',
    }),
    resolvedQuestion({
      id: 'update-reports',
      key: 'updateReports',
      section: 'Updates and reports',
      title: 'Update reports',
      prompt: 'Update report choice',
      whatThisControls: 'Whether Toolkit keeps a privacy-safe maintenance report when an update, cache refresh, or safety stop produced meaningful information. Routine successful maintenance stays quiet; failures needing action may open automatically, and routine output does not print private absolute paths.',
      choices: [
        wizardChoice('enable', 'Keep reports', 'Create deduplicated reports for meaningful maintenance, keep successful reports closed, and automatically open only reports classified as requiring action.'),
        wizardChoice('disable', 'Do not keep reports', 'Stop creating normal Toolkit maintenance reports; concise failure or safety status still appears when action is required.'),
        wizardChoice('keep', 'Keep current', `Preserve this effective behavior: ${currentBooleanOutcome(current.audit?.update_report_enabled, 'Meaningful maintenance reports are kept; only action-required reports open automatically.', 'Maintenance reports are disabled.', 'The saved report setting could not be verified; the effective default is to keep meaningful reports.')}`),
      ],
      currentChoice: booleanCurrentChoice(current.audit?.update_report_enabled),
      recommendation: {
        value: recommendedChoice('updateReports', current, args),
        outcome: 'Keep meaningful reports; open only reports that require action.',
        reason: 'A short-lived, privacy-safe record makes failed or safety-blocked maintenance diagnosable without making routine success noisy.',
      },
      selected: args.setupChoices.updateReports,
      currentShort: shortOnOff(current.audit?.update_report_enabled),
      current: currentBooleanOutcome(current.audit?.update_report_enabled, 'Meaningful maintenance reports are kept; only action-required reports open automatically.', 'Maintenance reports are disabled.', 'The saved report setting could not be verified; the effective default is to keep meaningful reports.'),
      currentVerification: typeof current.audit?.update_report_enabled === 'boolean' ? 'verified' : 'defaulted',
      afterApplying: 'This changes Toolkit report state only. It does not change native host configuration, and no restart is required.',
    }),
    resolvedQuestion({
      id: 'report-retention',
      key: 'updateReportRetention',
      section: 'Updates and reports',
      title: 'Report retention',
      prompt: 'Update report retention choice',
      whatThisControls: 'How long Toolkit keeps only its own maintenance reports before best-effort cleanup. It does not modify project files, application logs, or unrelated operational logs.',
      choices: [
        wizardChoice('default', '7 days', 'Use the seven-day retention window and remove only eligible Toolkit maintenance reports older than that window.'),
        wizardChoice('custom', 'Choose another duration', 'Use the approved positive day count for future Toolkit report cleanup; no unrelated logs or project files are considered.'),
        wizardChoice('keep', 'Keep current', `Preserve this effective behavior: ${retentionCurrent}`),
      ],
      currentChoice: retentionRaw === DEFAULT_UPDATE_REPORT_RETENTION_DAYS ? 'default' : '',
      recommendation: {
        value: recommendedChoice('updateReportRetention', current, args),
        outcome: currentReportRetentionDays(current) === DEFAULT_UPDATE_REPORT_RETENTION_DAYS
          ? 'Keep the effective seven-day retention window.'
          : 'Use a seven-day retention window.',
        reason: 'Seven days normally preserves enough troubleshooting context while limiting accumulation of maintenance-only reports.',
      },
      selected: args.setupChoices.updateReportRetention,
      current: retentionCurrent,
      currentShort: Number.isSafeInteger(retentionRaw) && retentionRaw > 0 ? `${retentionRaw} days` : `Unknown (${DEFAULT_UPDATE_REPORT_RETENTION_DAYS} days)`,
      currentVerification: Number.isSafeInteger(retentionRaw) && retentionRaw > 0 ? 'verified' : 'defaulted',
      afterApplying: 'The approved duration is stored in Toolkit state. Eligible Toolkit maintenance-report cleanup runs during the approved setup and future maintenance; unrelated files are never included.',
    }),
    resolvedQuestion({
      id: 'codex-instruction-limit',
      key: 'codexDocLimit',
      section: 'Updates and reports',
      title: "Raise Codex's instruction limit",
      prompt: 'Codex instruction limit choice',
      whatThisControls: "Whether Toolkit keeps Codex's `project_doc_max_bytes` in `~/.codex/config.toml` at 65536, because Codex desktop has cut off the end of a repository's AGENTS.md at the 32 KiB default once the Toolkit global rules are installed. Toolkit edits only that one top-level line, inside its own markers, after a backup and a TOML parse check; it never changes 0 (project docs off) or a value of 65536 or more, and `toolkit-global-rules.cjs --remove` puts the previous value back.",
      choices: [
        wizardChoice('enable', 'Raise it', 'Raise a lower value to 65536 now and keep it there at later Codex session starts; every change prints a line and writes an update report.'),
        wizardChoice('disable', 'Leave it', 'Do not raise it; if Toolkit raised it earlier, put the previous value back. Setup still reports the combined size.'),
        wizardChoice('keep', 'Keep current', `Preserve this effective behavior: ${docLimitCurrent}`),
      ],
      // Read from config.toml: the record alone can disagree with the file Codex reads.
      currentChoice: docLimit.currentChoice,
      recommendation: {
        value: recommendedChoice('codexDocLimit', current, args),
        outcome: "Raise Codex's instruction limit to 65536.",
        reason: 'Repository rules reach Codex whole; the change is one marked line that is backed up and reversible.',
      },
      selected: args.setupChoices.codexDocLimit,
      currentShort: docLimit.short,
      current: docLimitCurrent,
      currentVerification: current.codexInstall?.config === 'unreadable' ? 'unverified' : 'state-derived',
      afterApplying: 'This stores your choice in Toolkit state and, on a yes, edits `~/.codex/config.toml` at the end of setup. Start a new Codex session to use the new limit.',
    }),
  ];

  if (args.host === 'codex') {
    const v1 = current.runtime?.runtime === RUNTIMES.V1;
    // Toolkit's V1 block on a Codex that now runs V2 needs migrating; the plan reads only the block,
    // so migration is offered and checked with Codex after the answers.
    const migrateAfterCheck = current.runtime?.from_config === true && current.delegation?.ownership === 'toolkit-managed-v1';
    if (args.setupChoices.codexHelperCapacity === 'migrate' && current.delegation?.status !== 'migration-required' && !migrateAfterCheck) throw new Error('Selected helper setting remains unapplied. No exact Toolkit-managed legacy setting is available to migrate; choose an ordinary helper setting or keep.');
    if (v1 && (args.setupChoices.codexHelperCapacity === 'root-only' || (args.setupChoices.codexHelperCapacity === 'custom' && args.codexHelperCount !== null && args.codexHelperCount < 1))) throw new Error('Codex cannot limit helpers to zero; choose one helper or a custom number of at least 1. Setup wrote nothing.');
    specs.push(resolvedQuestion({
      id: 'codex-helper-capacity', key: 'codexHelperCapacity', section: 'Computer performance',
      title: 'Codex helper capacity', prompt: 'Codex helper capacity choice',
      whatThisControls: 'How many helpers the main Codex session can open; helpers cannot start helpers under Toolkit rules. ' + (v1 ? 'Codex cannot limit helpers to zero; choose one helper or a custom number.' : 'Root-only is an explicit opt-out.'),
      choices: [
        wizardChoice('one-helper', 'One helper', 'Allow one helper for planning (G0) and build (G1) evidence gathering and validation.'),
        ...(!v1 ? [wizardChoice('root-only', 'No helpers', current.runtime?.runtime === RUNTIMES.UNKNOWN
          ? 'Explicitly opt out of helpers. Checked with Codex after you answer: Codex V1 (multi_agent) cannot limit helpers to zero, and then setup writes nothing.'
          : 'Explicitly opt out of helpers.')] : []),
        wizardChoice('custom', 'Choose a number', v1 ? 'Choose a whole helper count of at least 1; more than one needs RAM-risk approval.' : 'Choose a non-negative helper count; more than one needs RAM-risk approval.'),
        wizardChoice('keep', 'Keep current', `Preserve this effective behavior: ${current.delegation?.detail || 'Helper capacity has not been verified.'}`),
        ...(current.delegation?.status === 'migration-required' ? [wizardChoice('migrate', 'Migrate legacy setting', 'Preview and approve migration of the exact Toolkit legacy block.')] : []),
        ...(migrateAfterCheck ? [wizardChoice('migrate', 'Migrate legacy setting', 'If Codex now runs the V2 (multi_agent_v2) helper feature, checked with Codex after you answer, preview and approve moving the V1 Toolkit block to it; otherwise setup stops before writing.')] : []),
        ...(String(current.delegation?.ownership || '').startsWith('toolkit-') ? [wizardChoice('remove', 'Remove Toolkit setting', 'Remove only the owned block after approval.')] : []),
      ],
      // One helper is already configured for the known runtime, so setup would leave config.toml as
      // it is either way. With the runtime unknown, the same file can still need a change.
      currentChoice: current.runtime?.runtime !== RUNTIMES.UNKNOWN && current.delegation?.status === 'configured' && current.delegation?.helper_count === 1 ? 'one-helper' : '',
      recommendation: { value: recommendedChoice('codexHelperCapacity', current, args), outcome: recommendedChoice('codexHelperCapacity', current, args) === 'one-helper' ? 'Allow one helper.' : 'Keep the current configuration.', reason: recommendedChoice('codexHelperCapacity', current, args) === 'one-helper' ? 'G0 and G1 leads need helpers for independent work.' : 'This state needs an explicit compatibility or repair choice before helper settings can change.' },
      selected: args.setupChoices.codexHelperCapacity,
      current: current.delegation?.detail || 'Helper capacity has not been verified.',
      currentShort: shortCodexHelpers(current.delegation),
      currentVerification: current.runtime?.runtime === RUNTIMES.UNKNOWN ? 'unverified' : (current.runtime?.from_config ? 'state-derived' : 'verified'),
      afterApplying: 'Setup presents any required replacement proposal before writing, backs up config.toml, and asks Codex to load it. Fully restart Codex and complete one successful turn.',
    }));
    specs.push(resolvedQuestion({
      id: 'codex-toolkit-maintenance',
      key: 'codexPluginAutoRefresh',
      section: 'Computer performance',
      title: 'Codex Toolkit maintenance',
      prompt: 'Codex plugin maintenance choice',
      whatThisControls: 'Whether trusted Codex startup maintenance may refresh the installed Toolkit plugin cache from the verified managed source.',
      choices: [
        wizardChoice('enable', 'Turn on', 'Enable future native Toolkit cache refresh when maintenance detects stale or incompatible files.'),
        wizardChoice('disable', 'Turn off', 'Disable future automatic cache refresh; the installed Toolkit plugin is not uninstalled, and manual `setup toolkit` repair or refresh remains available.'),
        wizardChoice('keep', 'Keep current', `Preserve this effective behavior: ${currentBooleanOutcome(current.audit?.codex_plugin_auto_refresh_enabled, 'Automatic Codex Toolkit maintenance is on.', 'Automatic Codex Toolkit maintenance is off; the installed plugin remains in place.', 'The automatic Codex maintenance preference could not be verified; setup will not claim that it is active.')}`),
      ],
      currentChoice: booleanCurrentChoice(current.audit?.codex_plugin_auto_refresh_enabled),
      recommendation: {
        value: recommendedChoice('codexPluginAutoRefresh', current, args),
        outcome: 'Turn on native Toolkit cache refresh and safe Windows hook maintenance.',
        reason: 'Keeping the installed cache aligned with the verified managed source avoids stale setup behavior after Toolkit updates.',
      },
      selected: args.setupChoices.codexPluginAutoRefresh,
      currentShort: shortOnOff(current.audit?.codex_plugin_auto_refresh_enabled),
      current: currentBooleanOutcome(current.audit?.codex_plugin_auto_refresh_enabled, 'Automatic Codex Toolkit maintenance is on.', 'Automatic Codex Toolkit maintenance is off; the installed plugin remains in place.', 'The automatic Codex maintenance preference could not be verified; setup will not claim that it is active.'),
      currentVerification: typeof current.audit?.codex_plugin_auto_refresh_enabled === 'boolean' ? 'verified' : 'unverified',
      afterApplying: 'This is about later Codex session starts; "Keep Toolkit available in Codex?" decides what this run does to the plugin. If maintenance refreshes the plugin cache and Windows hook launchers, open `/hooks` in the Codex app and turn the updated Toolkit hooks on. Turning maintenance off only changes future Toolkit state and does not uninstall the plugin.',
    }));
    if (current.codexInstall?.present) {
      const unchanged = codexPluginUnchanged(current, args);
      const notes = codexPluginNotes(current, args);
      specs.push(resolvedQuestion({
        id: 'codex-toolkit-plugin',
        key: 'codexPluginBehavior',
        section: 'Toolkit in your coding apps',
        title: 'Keep Toolkit available in Codex?',
        prompt: 'Codex Toolkit choice',
        whatThisControls: 'Whether setup verifies and refreshes the Toolkit plugin in Codex this run, only shows the commands, or leaves it as it is. This row is read from the Codex files; any plugin checks run only after you answer, including when Keep current retains the install check.',
        choices: [
          wizardChoice('install', 'Install or refresh', 'Run the Codex plugin commands to verify Toolkit in Codex, and refresh its cache from the update copy when it is missing, off, older or different.'),
          wizardChoice('instructions', 'Show instructions only', 'Make no plugin change and show the Codex plugin commands to run yourself.'),
          wizardChoice('keep', 'Keep current', `Make no plugin change and run no Codex command this run: ${codexPluginCurrent(current, args)}`),
        ],
        // Keep the install action under Keep current: a later update-source answer can change the
        // required marketplace binding, so the plugin and source must still be checked after answers.
        currentChoice: unchanged ? 'install' : '',
        keepAs: 'Keep it installed. Setup checks it against the update source chosen above after you answer, and refreshes it or corrects its marketplace binding only if needed.',
        recommendation: unchanged
          ? { value: 'keep', outcome: 'Leave the Codex plugin as it is.', reason: 'Codex already runs the current Toolkit from the update copy, so a refresh would change nothing.' }
          : { value: 'install', outcome: 'Verify and refresh the Toolkit plugin in Codex.', reason: notes.length ? `Codex does not run the current Toolkit from the update copy: ${notes.join('; ')}.` : 'Codex does not run the current Toolkit from the update copy.' },
        selected: args.setupChoices.codexPluginBehavior,
        current: codexPluginCurrent(current, args),
        currentShort: shortCodexPlugin(current, args),
        currentVerification: current.codexInstall.config === 'unreadable' ? 'unverified' : 'state-derived',
        afterApplying: 'If the plugin files change, fully restart Codex, then open `/hooks` and turn the Toolkit hooks on; Codex may ask you to review them again.',
      }));
      const hooks = codexHookCells(current, args);
      specs.push(reportOnlyRow({
        id: 'codex-toolkit-hooks',
        key: 'codexHooks',
        section: 'Toolkit in your coding apps',
        title: 'Toolkit hooks in Codex',
        whatThisControls: "Whether Codex runs each Toolkit hook. Codex keeps this in ~/.codex/config.toml ([hooks.state]) and you change it in Codex's /hooks; setup only reports it and never edits it. A hook that is off or not reviewed does not run, so its check is skipped.",
        current: hooks.full,
        currentShort: hooks.short,
        recommendedText: hooks.recommended,
      }));
    }
  } else {
    const activeProfile = current.agentProfile || agentControl.readProfile('claude-code');
    const topologyCurrent = `Current topology: ${activeProfile.topology || 'root-only'}. ${claudeSubagentDepthOutcome(current.claudeSubagentDepth)} ${claudeHookNormalFolderOutcome(activeProfile.topology)}`;
    specs.push(resolvedQuestion({
      id: 'claude-agent-topology',
      key: 'claudeTopology',
      section: 'Computer performance',
      title: 'How should Claude Code use agents?',
      prompt: 'Claude Code agent topology choice',
      whatThisControls: 'How Claude Code may use agents. In Toolkit-governed repositories the installed Toolkit hook admits only the main session and the Toolkit planning (G0) and build (G1) leaf helpers. Elsewhere the limit is one layer: the main session may start subagents; subagents never start another. For this Toolkit sets `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1` in your Claude Code user settings (read by Claude Code 2.1.217 or later; project, local or managed settings can override it in a folder) and records that it owns that value. Broader native behaviour permits native agent behavior outside Toolkit control. Governed workers use only the Toolkit worker launcher pinned in the stack registry.',
      choices: [
        wizardChoice('root-only', 'Toolkit repos: main session + Toolkit planning and build helpers only. Elsewhere: one layer of subagents.', 'In Toolkit-governed repositories admit only the Toolkit planning (G0) and build (G1) leaf helpers. Also set the Toolkit-owned `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1` in the Claude Code user settings, which holds Claude Code 2.1.217 or later to one layer of subagents unless project, local or managed Claude settings override it in a folder; a value you set yourself is kept as it is.'),
        wizardChoice('broader-native', 'Broader native behaviour', 'Permit native Claude agent behavior outside Toolkit control and its resource guarantees. Outside Toolkit repos Claude Code\'s own defaults apply: a Toolkit-set `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` is removed (a value you set yourself is kept), and the Toolkit hook no longer refuses a subagent that starts another.'),
        wizardChoice('keep', 'Keep current', `Preserve this effective behavior: ${topologyCurrent} Stale, unverifiable or retired topology state falls back safely to root-only, and the subagent depth setting is left as it is.`),
      ],
      // Root-only and its depth setting are already in place. Setup resolves keep to root-only after the
      // answers anyway, so root-only is the one kept under the Keep current label.
      currentChoice: claudeRootOnlyUnchanged(activeProfile, current.claudeSubagentDepth) ? 'root-only' : '',
      keepAs: 'Keep root-only: Toolkit repos admit only the main session and the Toolkit planning and build helpers; elsewhere one layer of subagents. Both settings are already in place, so nothing changes.',
      recommendation: {
        value: recommendedChoice('claudeTopology', current, args),
        outcome: 'Toolkit repos: main session + Toolkit planning and build helpers only. Elsewhere: one layer of subagents.',
        reason: 'Root-only is the verified default: outside Toolkit repos the Claude Code user setting CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1 holds Claude Code 2.1.217 or later to one layer, the Toolkit hook refuses the same nested launches as a backstop, and governed workers use the Toolkit worker launcher pinned in the stack registry.',
      },
      selected: args.setupChoices.claudeTopology,
      current: topologyCurrent,
      currentShort: shortClaudeTopology(activeProfile, current.claudeSubagentDepth),
      // Read from the stored profile and the Claude Code user settings; setup does not test the hook itself.
      currentVerification: current.claudeSubagentDepth && current.claudeSubagentDepth.state !== SUBAGENT_DEPTH_STATES.UNREADABLE ? 'state-derived' : 'unverified',
      afterApplying: 'A changed choice updates the Claude Toolkit profile and the one Toolkit-owned `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` key in the Claude Code user settings (`settings.json` in your Claude Code config folder). Start a new Claude Code session before relying on it. Claude Code 2.1.217 or later reads the depth setting; earlier versions ignore it.',
    }));
    specs.push(resolvedQuestion({
      id: 'claude-toolkit-plugin',
      key: 'claudePluginBehavior',
      section: 'Toolkit in your coding apps',
      title: 'Keep Toolkit available in Claude Code?',
      prompt: 'Claude Code Toolkit choice',
      whatThisControls: 'Whether Claude Code installs or refreshes its own Toolkit plugin, shows manual instructions, or preserves current plugin state.',
      choices: [wizardChoice('install', 'Install or refresh', 'Use Claude Code native plugin commands to verify and refresh its Toolkit cache when needed.'), wizardChoice('instructions', 'Show instructions only', 'Make no native plugin change and report the manual Claude Code action required.'), wizardChoice('keep', 'Keep current', 'Preserve the currently detected Claude Code plugin behavior and state.')],
      // Toolkit is installed, turned on and current, running in place from the update copy. Install or
      // refresh then only checks it, and re-enables or refreshes it if that check still finds a gap keep
      // would leave, so it is the one kept under the Keep current label.
      currentChoice: claudePluginUnchanged(current, args) ? 'install' : '',
      keepAs: 'Keep it installed. Setup checks it after you answer and changes something only if that check finds it disabled or out of date.',
      recommendation: { value: recommendedChoice('claudePluginBehavior', current, args), outcome: 'Let Claude Code install or refresh its own Toolkit plugin.', reason: 'Native host commands keep cache identity, version, and hooks aligned without cross-host mutation.' },
      selected: args.setupChoices.claudePluginBehavior,
      current: claudePluginCurrent(current, args),
      currentShort: shortClaudePlugin(current),
      afterApplying: 'If native plugin files change, start a new Claude Code session (close sessions opened before the update) and complete any native trust or activation steps reported by setup.',
    }));
    specs.push(...claudeSettingQuestions(args, current));
  }
  if (args.host === 'codex' && (current.antigravity?.installed || current.antigravity?.copies)) specs.push(antigravitySkillsQuestion(args, current));
  specs.push(taskAutoMergeQuestion(args, current));
  foldTwinSelections(args, answerable(specs));

  return withPresentationMetadata(specs.filter((spec) => args.host === 'codex' || spec.key !== 'codexDocLimit').map((spec) => ({
    ...spec,
    recommended_value: spec.recommended,
    selected_value: spec.selected,
    empty_input_behavior: spec.recommended,
  })), args.host);
}

function clonedSetupArgs(args) {
  return {
    ...args,
    setupChoices: { ...args.setupChoices },
  };
}

function plannedQuestionBank(args, current) {
  const planned = clonedSetupArgs(args);
  const initialSpecs = setupQuestionSpecs(planned, current);
  assertManagedCheckoutChoiceAvailable(planned, initialSpecs);
  for (const spec of unanswered(initialSpecs, planned)) assignChoice(planned, spec.key, spec.recommended);
  if (planned.host === 'claude-code') resolveClaudeTopology(planned, current);
  const resolvedSpecs = setupQuestionSpecs(planned, current);
  assertManagedCheckoutChoiceAvailable(planned, resolvedSpecs);
  return {
    args: planned,
    specs: resolvedSpecs.map((spec) => ({ ...spec, empty_input: spec.recommended })),
  };
}

// The full text of each question; `onlyRef` limits it to one question, numbered as in the whole bank.
function renderQuestionRows(specs, onlyRef = '') {
  specs = ensurePresentationMetadata(specs);
  const lines = [];
  let section = '';
  for (const spec of specs) {
    if (onlyRef && spec.presentation.question_ref !== onlyRef) continue;
    if (spec.section !== section) {
      if (lines.length) lines.push('');
      section = spec.section;
      lines.push(`## ${spec.presentation.section_index}. ${section}`, '');
    }
    lines.push(spec.report_only ? `### Status (nothing to answer): ${spec.title}` : `### ${spec.presentation.question_ref} ${spec.title}`);
    lines.push('');
    lines.push(`**What this controls:** ${spec.whatThisControls}`);
    lines.push('');
    lines.push(`**Current:** ${spec.current}`);
    lines.push('');
    lines.push(`**Verification:** ${spec.currentState?.verification || 'unverified'}`);
    lines.push('');
    if (spec.report_only) {
      lines.push(`**What to do:** ${spec.recommended_text}`, '', `**Why:** ${spec.recommendation_reason}`, '', '---', '');
      continue;
    }
    lines.push(`**Recommended:** ${spec.presentation.recommended_choice_ref} - ${choiceLabel(spec, spec.recommended)}`);
    lines.push('');
    lines.push(`**Recommended outcome:** ${spec.recommended_outcome}`);
    lines.push('');
    lines.push(`**Why:** ${spec.recommendation_reason}`);
    lines.push('');
    lines.push('**Choices:**', '');
    for (const choice of spec.choices) lines.push(`- **${choice.presentation_ref}. ${choice.label}** - ${choice.consequence}`);
    if (spec.afterApplying) lines.push('', `**After applying:** ${spec.afterApplying}`);
    const selectedValue = spec.selected || spec.empty_input || '';
    lines.push('');
    lines.push(`**Selected:** ${selectedValue
      ? `${choiceReference(spec, selectedValue)} - ${choiceLabel(spec, selectedValue)}`
      : '(answer required)'}`);
    lines.push('', '---', '');
  }
  return lines.join('\n').trimEnd();
}

// Table cells hold one line: backslashes and pipes are escaped and line breaks become spaces.
const tableCell = (text) => String(text || '').replace(/\r?\n/g, ' ').replace(/\\/g, '\\\\').replace(/\|/g, '\\|');

// The bank as one compact table: the question, a short current state, the recommended choice and its
// effect, and the other choices. The full text of a question is shown only on request.
function renderCompactQuestionTable(specs, markdown = true) {
  specs = ensurePresentationMetadata(specs);
  // Keeping things as they are needs no outcome: the Current column already says what stays.
  // An outcome that only repeats the label is left out too.
  const keepsCurrent = (spec) => spec.recommended === 'keep' || spec.folded_into === spec.recommended;
  const recommended = (spec) => {
    const label = choiceLabel(spec, spec.recommended);
    const effect = keepsCurrent(spec) || spec.recommended_outcome === label ? '' : `: ${spec.recommended_outcome}`;
    return `${spec.presentation.recommended_choice_ref}. ${label}${effect}`;
  };
  const others = (spec) => spec.choices.filter((choice) => choice.value !== spec.recommended).map((choice) => `${choice.presentation_ref}. ${choice.label}`);
  const selected = (spec) => (spec.selected ? `${choiceReference(spec, spec.selected)}. ${choiceLabel(spec, spec.selected)}` : '');
  const lines = [];
  let section = '';
  let tableOpen = false;
  for (const spec of specs) {
    if (spec.section !== section) {
      section = spec.section;
      tableOpen = false;
      const heading = `${spec.presentation.section_index}. ${section}`;
      lines.push('', ...(markdown ? [`## ${heading}`] : [heading, '='.repeat(heading.length)]));
    }
    // Status lines come after the section's numbered questions (withPresentationMetadata orders them).
    if (spec.report_only) {
      lines.push('', statusLine(spec));
      continue;
    }
    if (markdown && !tableOpen) {
      lines.push('', '| # | Question | Current | Recommended | Other choices |', '|---|---|---|---|---|');
      tableOpen = true;
    }
    if (!markdown) {
      lines.push('', `${spec.presentation.question_ref} ${spec.title}`, `  Current: ${spec.current_short || spec.current}`, `  Recommended: ${recommended(spec)}`);
      const rest = others(spec);
      // One choice per line, so each alternative reads on its own.
      if (rest.length) lines.push('  Other choices:', ...rest.map((choice) => `    ${choice}`));
      if (spec.selected) lines.push(`  Selected: ${selected(spec)}`);
      continue;
    }
    const rest = others(spec).map(tableCell).join('<br>') || '-';
    const chosen = spec.selected ? `<br>Selected: ${tableCell(selected(spec))}` : '';
    lines.push(`| ${spec.presentation.question_ref} | ${tableCell(spec.title)} | ${tableCell(spec.current_short || spec.current)} | ${tableCell(recommended(spec))}${chosen} | ${rest} |`);
  }
  return lines;
}

const EXPLAIN_HINT = 'For the full text of a question, say "explain 1.2" (or run setup with --explain 1.2).';

// The bank's heading and reference; the reference documentation also lists a quick index (the bank's
// own table already shows every question).
function renderQuestionBankHeader(specs, markdown = true, quickIndex = true) {
  const questionCount = specs[0]?.presentation.total_visible_question_count || 0;
  const sectionCount = specs[0]?.presentation.total_visible_section_count || 0;
  const heading = `Toolkit setup choices - ${questionCount} questions across ${sectionCount} sections`;
  const bankReference = specs[0]?.presentation.bank_reference || '';
  const lines = [markdown ? `# ${heading}` : heading, '', `Bank reference: ${bankReference}`, ''];
  if (!quickIndex) return lines;
  lines.push('Quick index', '');
  for (const spec of specs) {
    lines.push(spec.report_only ? statusLine(spec)
      : `${spec.presentation.question_ref} ${spec.title} - Recommended: ${spec.presentation.recommended_choice_ref} - ${choiceLabel(spec, spec.recommended)}`);
  }
  lines.push('');
  return lines;
}

function changedOnlyExample(specs) {
  const preferred = ['automatic-updates', 'update-reports'];
  const picked = preferred.map((id) => specs.find((spec) => spec.id === id)).filter(Boolean);
  for (const spec of answerable(specs)) {
    if (picked.length >= 2) break;
    if (!picked.includes(spec)) picked.push(spec);
  }
  picked.sort((left, right) => specs.indexOf(left) - specs.indexOf(right));
  return picked.map((spec) => {
    const replacement = spec.choices.find((choice) => choice.value !== spec.recommended) || spec.choices[0];
    return `${spec.presentation.question_ref}=${replacement.presentation_ref}`;
  }).join(', ');
}

function buildNonTtyAnswerPlan(specs, args) {
  const unresolved = unanswered(specs, args);
  const unresolvedIds = new Set(unresolved.map((spec) => spec.id));
  const byId = new Map(specs.map((spec) => [spec.id, spec]));
  const questions = unresolved.map((spec, index) => ({
    kind: 'question',
    order: index + 1,
    question_id: spec.id,
    question_ref: spec.presentation.question_ref,
    title: spec.title,
    choice_range: `${spec.choices[0].presentation_ref}-${spec.choices.at(-1).presentation_ref}`,
    canonical_values: spec.choices.map((choice) => choice.value),
  }));
  const detailDefinitions = [
    {
      owner_question_id: 'update-source', detail_type: 'managed-checkout-path',
      activation_key: 'managedCheckout', activation_value: 'custom',
      supplied: () => args.repoRootExplicit,
      validation_contract: 'non-empty path',
      description: 'custom managed-checkout path',
      missing_message: 'Setup question bank requires the 1.1 Update source custom path detail after the question-answer lines.',
    },
    {
      owner_question_id: 'report-retention', detail_type: 'report-retention-days',
      activation_key: 'updateReportRetention', activation_value: 'custom',
      supplied: () => args.updateReportRetentionDaysExplicit,
      validation_contract: 'positive integer day count',
      description: 'positive report-retention duration in days',
      missing_message: 'Setup question bank requires the 1.4 Report retention custom duration detail as a positive day-count line.',
    },
    {
      owner_question_id: 'codex-helper-capacity', detail_type: 'codex-helper-count',
      activation_key: 'codexHelperCapacity', activation_value: 'custom',
      supplied: () => args.codexHelperCount !== null,
      validation_contract: byId.get('codex-helper-capacity')?.choices.some(choice => choice.value === 'root-only') ? 'non-negative integer helper count' : 'positive integer helper count',
      description: 'bounded Codex helper count',
      missing_message: 'Setup question bank requires the custom Codex helper-count detail line.',
    },
    {
      owner_question_id: 'codex-helper-capacity', detail_type: 'codex-helper-risk-approval',
      activation_key: 'codexHelperCapacity', activation_value: 'custom',
      supplied: () => args.approveHighHelperCapacity || (args.codexHelperCount !== null && args.codexHelperCount <= 1),
      validation_contract: 'exact approve when the helper count is greater than one',
      description: 'exact `approve` RAM-risk acknowledgement; More than one helper may exhaust RAM, slow or freeze this PC, and stop useful work',
      missing_message: 'Setup question bank requires an `approve` detail line for custom Codex helper counts above one.',
      secondary_condition: 'helper-count-above-one',
    },
  ];
  const details = [];
  for (const definition of detailDefinitions) {
    const owner = byId.get(definition.owner_question_id);
    const ownerUnresolved = unresolvedIds.has(definition.owner_question_id);
    const selected = args.setupChoices[definition.activation_key];
    const choice = owner?.choices.find((candidate) => candidate.value === definition.activation_value);
    const conditionallySelectable = Boolean(ownerUnresolved && choice);
    const alreadyRequired = selected === definition.activation_value && !definition.supplied();
    if (!conditionallySelectable && !alreadyRequired) continue;
    details.push({
      kind: 'detail',
      order: details.length + 1,
      owner_question_id: definition.owner_question_id,
      question_ref: owner?.presentation.question_ref || null,
      question_title: owner?.title || null,
      detail_type: definition.detail_type,
      activation_key: definition.activation_key,
      activation_value: definition.activation_value,
      activation_choice_ref: choice?.presentation_ref || null,
      validation_contract: definition.validation_contract,
      description: definition.description,
      missing_message: definition.missing_message,
      secondary_condition: definition.secondary_condition || null,
      requirement: alreadyRequired ? 'required' : 'conditional',
    });
  }
  return {
    schema: 'ai-agent-toolkit.setup-question-answer-plan.v1',
    mode: 'non-tty-line-by-line',
    questions,
    details,
    entries: [...questions, ...details],
  };
}

function detailPlanEntryApplies(entry, args) {
  if (args.setupChoices[entry.activation_key] !== entry.activation_value) return false;
  if (entry.detail_type === 'managed-checkout-path') return !args.repoRootExplicit;
  if (entry.detail_type === 'report-retention-days') return !args.updateReportRetentionDaysExplicit;
  if (entry.detail_type === 'codex-helper-count') return args.codexHelperCount === null;
  if (entry.detail_type === 'codex-helper-risk-approval') return args.codexHelperCount > 1 && !args.approveHighHelperCapacity;
  throw new Error(`Unsupported setup answer-plan detail type: ${entry.detail_type}`);
}

function detailPlanEntrySelected(entry, args) {
  if (args.setupChoices[entry.activation_key] !== entry.activation_value) return false;
  if (entry.detail_type === 'codex-helper-risk-approval') return args.codexHelperCount > 1;
  return true;
}

function approvedDetailSummary(entry, args) {
  if (entry.detail_type === 'managed-checkout-path') return 'custom path supplied (value remains private)';
  if (entry.detail_type === 'report-retention-days') return `${args.updateReportRetentionDays} days`;
  if (entry.detail_type === 'codex-helper-count') return `${args.codexHelperCount} helper(s)`;
  if (entry.detail_type === 'codex-helper-risk-approval') return 'approved';
  throw new Error(`Unsupported setup answer-plan detail type: ${entry.detail_type}`);
}

function renderAnswerGuide(specs, markdown = true, mode = 'non-tty', options = {}) {
  const example = changedOnlyExample(specs);
  if (mode === 'tty') {
    return [
      'After this complete bank, enter either:',
      '',
      markdown ? '- `all recommended`' : '  - all recommended',
      markdown ? `- only your changes, for example: \`${example}\`` : `  - only your changes, for example: ${example}`,
      markdown ? '- press Enter to answer questions one at a time' : '  - press Enter to answer questions one at a time',
      '',
      'Anything you do not list takes its recommendation.',
    ];
  }
  if (mode === 'tty-one-at-a-time') {
    return [
      'Answer each question below: Enter takes its recommendation, and "all recommended" takes it for every remaining question.',
    ];
  }
  if (mode === 'non-tty-line-by-line') {
    const answerPlan = options.answerPlan || { questions: [], details: [] };
    const lines = [
      'Some visible questions are already resolved by explicit setup flags, so concise bank-reference answers are not accepted for this bank.',
    ];
    if (answerPlan.questions.length) {
      lines.push('', 'Reply with one line for each unresolved question in this exact order:', '');
      for (const entry of answerPlan.questions) {
        const values = entry.canonical_values.join(', ');
        lines.push(markdown
          ? `- **${entry.question_ref}** ${entry.title} [${entry.choice_range}] - enter a displayed letter or canonical value: ${values}`
          : `  - ${entry.question_ref} ${entry.title} [${entry.choice_range}] - enter a displayed letter or canonical value: ${values}`);
      }
    }
    if (answerPlan.details.length) {
      lines.push('', 'After those question-answer lines, append detail lines in this exact canonical order only when the stated condition applies:', '');
      for (const entry of answerPlan.details) {
        const owner = entry.question_ref ? `${entry.question_ref} ${entry.question_title}` : 'Advanced compatibility selection';
        const condition = entry.requirement === 'required'
          ? `required by the explicit ${entry.activation_value} selection`
          : `when ${entry.question_ref} is ${entry.activation_choice_ref}/${entry.activation_value}`;
        const secondary = entry.secondary_condition === 'helper-count-above-one' ? ' and the entered helper count is greater than one' : '';
        const rendered = `${entry.order}. ${owner}: ${entry.description} (${condition}${secondary}; ${entry.validation_contract}).`;
        lines.push(markdown ? `- ${rendered}` : `  - ${rendered}`);
      }
    }
    lines.push('', 'Do not repeat questions already selected by explicit flags. A bank-reference all-recommended or indexed changed-only reply is rejected in this mixed mode.',
      'The complete ordered answer set must be accepted before any setup write.');
    return lines;
  }
  if (mode === 'non-tty-resolved') {
    return [
      'All visible setup questions are already resolved by explicit inputs.',
      'No setup-question stdin is required or read before setup continues to the approval summary.',
    ];
  }
  return [
    'Reply with either:',
    '',
    markdown ? '- `all recommended`' : '  - all recommended',
    markdown ? `- only your changes, for example: \`${example}\`` : `  - only your changes, for example: ${example}`,
    '',
    'Anything you do not list takes its recommendation.',
  ];
}

function renderSetupQuestionBankTerminal(specs, options = {}) {
  specs = ensurePresentationMetadata(specs);
  const lines = [
    QUESTION_BANK_BEGIN,
    ...renderQuestionBankHeader(specs, false, false),
    'Review every visible choice before setup changes any settings.',
    ...renderCompactQuestionTable(specs, false),
    '',
    EXPLAIN_HINT,
  ];
  const guideMode = options.answerMode
    || (options.conciseCommands === false ? 'tty-one-at-a-time' : 'tty');
  lines.push('', ...renderAnswerGuide(specs, false, guideMode), '', QUESTION_BANK_COMPLETE, '');
  return lines.join('\n');
}

function renderSetupQuestionBank(specs, options = {}) {
  specs = ensurePresentationMetadata(specs);
  return [
    QUESTION_BANK_BEGIN,
    ...renderQuestionBankHeader(specs, true, false),
    'Review every visible choice before setup changes any settings.',
    '',
    ...renderCompactQuestionTable(specs, true),
    '',
    EXPLAIN_HINT,
    '',
    ...renderAnswerGuide(specs, true, options.answerMode || 'non-tty', options),
    QUESTION_BANK_COMPLETE,
    '',
  ].join('\n');
}

function setupQuestionDocumentationSpecs() {
  return plannedQuestionBank(parseArgs(['--plan', '--host', 'codex']), documentationFixtureState()).specs;
}

// The Claude Code bank for the same representative state, with a supported root-only
// profile and no subagent depth setting yet; nothing is read from this computer.
function setupQuestionClaudeDocumentationSpecs() {
  const current = {
    ...documentationFixtureState(),
    agentProfile: { supported: true, topology: agentControl.TOPOLOGIES.ROOT_ONLY },
    claudeSubagentDepth: { state: SUBAGENT_DEPTH_STATES.DEFAULT },
    claudeSettings: CLAUDE_SETTINGS.map((spec) => ({ id: spec.id, label: spec.label, state: CLAUDE_SETTINGS_STATES.DEFAULT })),
  };
  return plannedQuestionBank(parseArgs(['--plan', '--host', 'claude-code']), current).specs;
}

function documentationFixtureState() {
  const managedPath = defaultManagedSourcePath();
  return {
    managed: {
      currentPath: managedPath,
      selectedPath: managedPath,
      defaultPath: managedPath,
      exists: true,
      git: true,
      dirty: false,
      branch: DEFAULT_REPO_BRANCH,
      remote: DEFAULT_REPO_REMOTE,
    },
    audit: {
      repo_auto_update: { enabled: true },
      update_report_enabled: true,
      update_report_retention_days: DEFAULT_UPDATE_REPORT_RETENTION_DAYS,
      codex_doc_limit_enabled: true,
      codex_plugin_auto_refresh_enabled: true,
    },
    runtime: { runtime: RUNTIMES.V2, detector: 'documentation fixture' },
    antigravity: { installed: true, copies: false },
    delegation: { status: 'configured', ownership: 'toolkit-managed-v2', helper_count: 0, detail: 'documentation fixture' },
    nativePlugin: { status: 'fresh' },
    // Codex runs the update copy's Toolkit (an example version) with every hook on.
    codexInstall: {
      present: true, config: 'read', plugin: 'on', versions: ['1.0.0'], version: '1.0.0', sourceVersion: '1.0.0', older: false,
      marketplacePath: managedPath, cacheFresh: true, journalPending: false, docLimit: { value: 65536, toolkit: true },
      hooks: { status: 'read', entries: ['Session start updates', 'Prompt check', 'Shell and agent check', 'File edit check', 'Checkpoint after tool use', 'Checkpoint at stop'].map((name) => ({ name, state: 'on' })) },
    },
  };
}

function renderSetupQuestionDocumentation(specs = setupQuestionDocumentationSpecs(), claudeSpecs = setupQuestionClaudeDocumentationSpecs()) {
  specs = ensurePresentationMetadata(specs);
  claudeSpecs = ensurePresentationMetadata(claudeSpecs);
  return [
    '<!-- Generated by repo/scripts/generate-setup-question-docs.cjs from setup-toolkit-core.cjs. Do not edit directly. -->',
    '# Toolkit setup question reference',
    '',
    'This reference uses a privacy-safe representative Codex state in which all current ordinary questions are available. Runtime output resolves Current, Recommended, Why, available choices, and After applying from the same canonical metadata and the actual inspected state.',
    '',
    ...renderQuestionBankHeader(specs, false),
    '',
    renderQuestionRows(specs),
    '',
    ...renderAnswerGuide(specs, true),
    '',
    '# Claude Code setup questions',
    '',
    'Setup run with `--host claude-code` shows this bank instead, for the same representative state with a supported root-only Claude profile and no subagent depth setting yet. Answers use the same format as above.',
    '',
    ...renderQuestionBankHeader(claudeSpecs, false),
    '',
    renderQuestionRows(claudeSpecs),
    '',
  ].join('\n');
}

function emitCompleteQuestionBank(specs, options = {}) {
  specs = ensurePresentationMetadata(specs);
  const write = options.write || ((text) => {
    if (process.env[MANAGED_PROTOCOL_ENV] === MANAGED_QUESTION_BANK_PROTOCOL) fs.writeSync(1, text);
    else process.stdout.write(text);
    return true;
  });
  const render = options.render || renderSetupQuestionBank;
  const text = render(specs);
  const bank = Buffer.from(text, 'utf8');
  const complete = text.includes(QUESTION_BANK_BEGIN)
    && text.includes(QUESTION_BANK_COMPLETE)
    && specs.every((spec) => text.includes(spec.title))
    && bank.length <= MANAGED_BANK_MAX_BYTES;
  if (complete && write(process.env[MANAGED_PROTOCOL_ENV] === MANAGED_QUESTION_BANK_PROTOCOL ? bank : text) !== false) {
    if (process.env[MANAGED_PROTOCOL_ENV] === MANAGED_QUESTION_BANK_PROTOCOL) {
      fs.writeSync(3, `${JSON.stringify({
        protocol: MANAGED_QUESTION_BANK_PROTOCOL,
        event: 'question-bank-complete',
        stream: 'stdout',
        begin_markers: 1,
        complete_markers: 1,
        question_count: specs.length,
        bank_byte_length: bank.length,
        bank_sha256: crypto.createHash('sha256').update(bank).digest('hex'),
      })}\n`);
      const acknowledgement = fs.readFileSync(4, 'utf8').trim();
      if (acknowledgement !== 'question-bank-visible') {
        throw new Error('Managed question-bank visibility acknowledgement was not received.');
      }
    }
    return {
      appeared: true,
      attempts: 1,
      text,
      bank_identity: specs[0]?.presentation.bank_identity || questionBankSemanticIdentity(specs),
    };
  }
  throw new Error('Complete setup question bank could not be rendered visibly; no approval prompt or write is allowed.');
}

function assignChoice(args, key, choice) {
  if (key === 'taskAutoMerge') args.setupChoices.taskAutoMerge = choice;
  else if (key === 'managedCheckout') args.setupChoices.managedCheckout = choice;
  else if (key === 'repoAutoUpdate') args.setupChoices.repoAutoUpdate = choice;
  else if (key === 'updateReports') args.setupChoices.updateReports = choice;
  else if (key === 'updateReportRetention') args.setupChoices.updateReportRetention = choice;
  else if (key === 'codexDocLimit') args.setupChoices.codexDocLimit = choice;
  else if (key === 'codexPluginAutoRefresh') args.setupChoices.codexPluginAutoRefresh = choice;
  else if (key === 'codexHelperCapacity') args.setupChoices.codexHelperCapacity = choice;
  else if (key === 'codexPluginBehavior') args.setupChoices.codexPluginBehavior = choice;
  else if (key === 'claudeTopology') args.setupChoices.claudeTopology = choice;
  else if (key === 'claudePluginBehavior') args.setupChoices.claudePluginBehavior = choice;
  else if (CLAUDE_SETTING_KEYS.includes(key)) args.setupChoices[key] = choice;
  else if (key === 'antigravitySkills') args.setupChoices.antigravitySkills = choice;
}

function choiceForKey(args, key) {
  if (key === 'taskAutoMerge') return args.setupChoices.taskAutoMerge;
  if (key === 'managedCheckout') return args.setupChoices.managedCheckout;
  if (key === 'repoAutoUpdate') return args.setupChoices.repoAutoUpdate;
  if (key === 'updateReports') return args.setupChoices.updateReports;
  if (key === 'updateReportRetention') return args.setupChoices.updateReportRetention;
  if (key === 'codexDocLimit') return args.setupChoices.codexDocLimit;
  if (key === 'codexPluginAutoRefresh') return args.setupChoices.codexPluginAutoRefresh;
  if (key === 'codexHelperCapacity') return args.setupChoices.codexHelperCapacity;
  if (key === 'codexPluginBehavior') return args.setupChoices.codexPluginBehavior;
  if (key === 'claudeTopology') return args.setupChoices.claudeTopology;
  if (key === 'claudePluginBehavior') return args.setupChoices.claudePluginBehavior;
  if (CLAUDE_SETTING_KEYS.includes(key)) return args.setupChoices[key];
  if (key === 'antigravitySkills') return args.setupChoices.antigravitySkills;
  return '';
}

function nextNonEmptyLine(lines) {
  while (lines.length) {
    const line = String(lines.shift() || '').trim();
    if (line) return line;
  }
  return '';
}

async function readNonInteractiveStdin() {
  const chunks = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (process.env[MANAGED_PROTOCOL_ENV] === MANAGED_QUESTION_BANK_PROTOCOL && total > MANAGED_STDIN_MAX_BYTES) {
      throw new Error(managedFailureMessage('stdin-input-too-large'));
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, total).toString('utf8');
}

// One shared reading of concise answers: "all recommended" in any case, with spaces, hyphens,
// underscores or nothing between the words and one optional final full stop; changed-only items
// separated by commas, semicolons or spaces; and a reference followed by a colon or spaces.
const ALL_RECOMMENDED_ANSWER = /^all[\s_-]*recommended\.?$/i;
const ALL_RECOMMENDED_MENTION = /\ball[\s_-]*recommended/i;
const CHANGED_ONLY_ITEM = /^(\d+\.\d+)=([A-Za-z]{1,2})$/;

function isAllRecommendedAnswer(value) {
  return ALL_RECOMMENDED_ANSWER.test(String(value || '').trim());
}

function startsLikeConciseAnswer(value) {
  const text = String(value || '').trim();
  return /^all[\s_-]*recommended\.?(?:\s*$|\s*[,;])/i.test(text) || /^\d+\.\d+\s*=/.test(text);
}

function splitConciseEnvelope(text) {
  const colon = text.match(/^([^:\s]+)\s*:\s*([\s\S]+)$/);
  if (colon) return { reference: colon[1], payload: colon[2].trim() };
  // A space separator counts only when the first word reads as a complete reference,
  // so "all recommended" and "1.2=B 3.1=D" are never split into a reference.
  const spaced = text.match(/^(\S+)\s+([\s\S]+)$/);
  if (spaced && normalizeBankReference(spaced[1])) return { reference: spaced[1], payload: spaced[2].trim() };
  return null;
}

function changedOnlyItems(value) {
  // Collapse whitespace first so no pattern below can backtrack over a long run of spaces.
  const tokens = String(value || '').trim().replace(/\s+/g, ' ').replace(/ ?= ?/g, '=').split(/ ?[,;] ?| /);
  if (!tokens.length || tokens.some((token) => !CHANGED_ONLY_ITEM.test(token))) return null;
  return tokens.map((token) => token.match(CHANGED_ONLY_ITEM).slice(1));
}

function looksLikeConciseQuestionBankAnswer(value) {
  const text = String(value || '').trim();
  return ALL_RECOMMENDED_MENTION.test(text) || /^\d+\.\d+\s*=/.test(text);
}

function looksLikeConciseSubmission(value) {
  const text = String(value || '').trim();
  if (startsLikeConciseAnswer(text)) return true;
  const envelope = splitConciseEnvelope(text);
  return Boolean(envelope && startsLikeConciseAnswer(envelope.payload));
}

function parseConciseQuestionBankAnswer(input, specs, options = {}) {
  const text = String(input || '').trim();
  if (!text) return null;
  const expectedReference = specs[0]?.presentation.bank_reference || '';
  const requireBankReference = options.requireBankReference !== false;
  let suppliedReference = expectedReference;
  let answerText = text;
  if (requireBankReference) {
    const envelope = splitConciseEnvelope(text);
    if (!envelope) {
      // Only the first line can start a concise answer; later lines of a line-by-line reply,
      // such as a custom path containing "all-recommended", are never read as one.
      if (looksLikeConciseQuestionBankAnswer(text.split(/\r?\n/, 1)[0])) {
        throw new Error(`Concise setup answers require the displayed bank reference. Reply with ${expectedReference}: followed by all recommended or indexed changes.`);
      }
      return null;
    }
    // A drive-letter path or another canonical line-by-line value may contain
    // a colon. Treat it as an approval envelope only when the payload is
    // recognizably one of the bounded concise answer modes.
    if (!looksLikeConciseQuestionBankAnswer(envelope.payload)) return null;
    suppliedReference = normalizeBankReference(envelope.reference);
    if (!suppliedReference) throw new Error('Setup question bank reference is malformed or truncated; copy the complete displayed reference and retry before any setup write.');
    if (suppliedReference !== expectedReference) throw new Error('Setup question bank reference is stale or belongs to a different rendered bank; review the current bank and answer with its displayed reference.');
    answerText = envelope.payload;
  } else {
    const optionalEnvelope = splitConciseEnvelope(text);
    if (optionalEnvelope) {
      const normalized = normalizeBankReference(optionalEnvelope.reference);
      if (!normalized || normalized !== expectedReference) {
        throw new Error('Setup question bank reference does not match this live rendered bank.');
      }
      suppliedReference = normalized;
      answerText = optionalEnvelope.payload;
    }
  }
  const identity = specs[0]?.presentation.bank_identity || questionBankSemanticIdentity(specs);
  // A report-only row takes no answer, so it has no selection and no changed-only reference.
  specs = answerable(specs);
  if (isAllRecommendedAnswer(answerText)) {
    return {
      mode: 'all-recommended',
      binding_mode: requireBankReference ? 'displayed-reference' : 'same-process',
      bank_reference: suppliedReference,
      bank_identity: identity,
      selections: specs.map((spec) => ({
        question_id: spec.id,
        question_ref: spec.presentation.question_ref,
        choice_ref: spec.presentation.recommended_choice_ref,
        canonical_value: spec.recommended,
      })),
    };
  }
  if (ALL_RECOMMENDED_MENTION.test(answerText)) {
    throw new Error('Setup question bank answer mixes or malforms the all recommended mode.');
  }
  const items = changedOnlyItems(answerText);
  if (!items) {
    if (/\d+\.\d+\s*=/.test(answerText)) {
      throw new Error('Setup question bank changed-only answer has malformed separators or mixed answer modes.');
    }
    return null;
  }
  const byReference = new Map(specs.map((spec) => [spec.presentation.question_ref, spec]));
  const seen = new Set();
  const overrides = [];
  for (const [questionRef, rawChoiceRef] of items) {
    if (seen.has(questionRef)) throw new Error(`Setup question bank answer repeats question reference ${questionRef}.`);
    seen.add(questionRef);
    const spec = byReference.get(questionRef);
    if (!spec) throw new Error(`Setup question bank answer references unavailable question ${questionRef}.`);
    const choice = choiceByPresentationReference(spec, rawChoiceRef);
    if (!choice) throw new Error(`Setup question bank answer references unavailable choice ${rawChoiceRef.toUpperCase()} for ${questionRef}.`);
    overrides.push({
      question_id: spec.id,
      question_ref: questionRef,
      choice_ref: choice.presentation_ref,
      canonical_value: choice.value,
    });
  }
  const byQuestionId = new Map(overrides.map((selection) => [selection.question_id, selection]));
  return {
    mode: 'recommended-except',
    binding_mode: requireBankReference ? 'displayed-reference' : 'same-process',
    bank_reference: suppliedReference,
    bank_identity: identity,
    selections: specs.map((spec) => byQuestionId.get(spec.id) || ({
      question_id: spec.id,
      question_ref: spec.presentation.question_ref,
      choice_ref: spec.presentation.recommended_choice_ref,
      canonical_value: spec.recommended,
    })),
  };
}

function assertQuestionBankAnswerBinding(parsed, specs) {
  const currentIdentity = specs[0]?.presentation.bank_identity || questionBankSemanticIdentity(specs);
  const currentReference = specs[0]?.presentation.bank_reference || bankReferenceFromIdentity(currentIdentity);
  if (!parsed || parsed.bank_identity !== currentIdentity || parsed.bank_reference !== currentReference) {
    throw new Error('Setup question bank answer does not match the exact rendered bank.');
  }
  specs = answerable(specs);
  if (parsed.selections.length !== specs.length) {
    throw new Error('Setup question bank answer does not cover the exact rendered bank.');
  }
  for (let index = 0; index < specs.length; index += 1) {
    const spec = specs[index];
    const selection = parsed.selections[index];
    const choice = selectedChoice(spec, selection.canonical_value);
    if (selection.question_id !== spec.id
        || selection.question_ref !== spec.presentation.question_ref
        || !choice
        || choice.presentation_ref !== selection.choice_ref) {
      throw new Error('Setup question bank answer contains stale or inconsistent presentation references.');
    }
  }
}

function resolveDisplayedChoiceAnswer(spec, answer) {
  const normalized = String(answer || '').trim();
  if (!normalized) return spec.recommended;
  // Preserve old typed Skip answers after removing the duplicate helper choice.
  if (spec.key === 'codexHelperCapacity' && normalized.toLowerCase() === 'skip') return 'keep';
  const presented = choiceByPresentationReference(spec, normalized);
  if (presented) return presented.value;
  const canonical = spec.choices.find((choice) => choice.value.toLowerCase() === normalized.toLowerCase());
  if (!canonical && spec.folded_value === normalized.toLowerCase()) return spec.folded_into;
  return canonical?.value || normalized.toLowerCase();
}

// Typed at a one-at-a-time prompt, "all recommended" applies the displayed recommendation to that
// question and every remaining one. Piped and line-by-line answers keep their exact per-line meaning.
const ALL_RECOMMENDED_REST = Symbol('all-recommended-rest');

async function promptForChoice(spec, lines, rl) {
  if (lines) {
    if (!lines.length) throw new Error(`Setup question bank requires an answer for ${spec.title}`);
    return resolveDisplayedChoiceAnswer(spec, lines.shift());
  }
  for (;;) {
    const range = `${spec.choices[0].presentation_ref}-${spec.choices.at(-1).presentation_ref}`;
    const answer = await rl.question(`${spec.presentation.question_ref} ${spec.title} [${range}] (letter or canonical value; Enter=${spec.presentation.recommended_choice_ref}; "all recommended" for the rest): `);
    if (isAllRecommendedAnswer(answer)) return ALL_RECOMMENDED_REST;
    const resolved = resolveDisplayedChoiceAnswer(spec, answer);
    if (choiceValues(spec).includes(resolved)) return resolved;
    console.log(`${spec.title} must be one of: ${choiceValues(spec).join(', ')}. Enter a displayed letter or canonical value.`);
  }
}

async function promptForTTYCommand(specs, rl) {
  for (;;) {
    const answer = await rl.question('Enter "all recommended", enter indexed changes, or press Enter to answer questions one at a time: ');
    if (!String(answer).trim()) return null;
    try {
      const parsed = parseConciseQuestionBankAnswer(answer, specs, { requireBankReference: false });
      if (parsed) return parsed;
      console.log('Enter "all recommended", indexed changes such as 1.2=B, 3.1=D, or press Enter for one-at-a-time questions.');
    } catch (error) {
      console.log(`${error.message} Correct the concise answer or press Enter for one-at-a-time questions.`);
    }
  }
}

async function promptForCustomPath(lines, rl) {
  if (lines) {
    const value = nextNonEmptyLine(lines);
    if (!value) throw new Error('Managed checkout custom path requires a path answer');
    return value;
  }
  for (;;) {
    const answer = (await rl.question('Custom managed checkout path: ')).trim();
    if (answer) return answer;
    console.log('Please enter a custom managed checkout path.');
  }
}

async function promptForHelperCount(lines, rl) {
  if (lines) {
    const value = nextNonEmptyLine(lines);
    if (!value) throw new Error('Custom Codex helper capacity requires a helper-count answer');
    return parseNonNegativeInteger(value, 'Custom Codex helper count');
  }
  for (;;) {
    const answer = (await rl.question('How many helper agents may Codex use? Enter a non-negative integer: ')).trim();
    try {
      return parseNonNegativeInteger(answer, 'Custom Codex helper count');
    } catch (error) {
      console.log(error.message);
    }
  }
}

async function requireHighHelperCapacityApproval(args, lines, rl) {
  if (args.codexHelperCount <= 1 || args.approveHighHelperCapacity) return;
  console.log('WARNING: More than one helper may exhaust RAM, slow or freeze this PC, and stop useful work.');
  if (lines) {
    const answer = nextNonEmptyLine(lines).toLowerCase();
    if (answer !== 'approve') throw new Error('Custom helper counts above one require the exact approval answer `approve`');
  } else {
    const answer = (await rl.question('Type approve to accept the RAM risk for this persistent capacity change: ')).trim().toLowerCase();
    if (answer !== 'approve') throw new Error('Custom helper counts above one require the exact approval answer `approve`');
  }
  args.approveHighHelperCapacity = true;
}

async function promptForReportRetentionDays(lines, rl) {
  if (lines) {
    const value = nextNonEmptyLine(lines);
    if (!value) throw new Error('Choose another report-retention duration requires a positive day-count answer');
    return parsePositiveInteger(value, 'Report retention day count');
  }
  for (;;) {
    const answer = (await rl.question('Report retention duration in days: ')).trim();
    try { return parsePositiveInteger(answer, 'Report retention day count'); }
    catch (error) { console.log(error.message); }
  }
}

async function consumeNonTtyAnswerPlan(answerPlan, specs, args, lines) {
  const specsById = new Map(specs.map((spec) => [spec.id, spec]));
  for (const entry of answerPlan.questions) {
    const spec = specsById.get(entry.question_id);
    if (!spec) throw new Error(`Setup answer plan references unavailable question ${entry.question_id}.`);
    if (!lines.length || (lines.length === 1 && !String(lines[0]).trim())) {
      throw new Error(`Setup question bank requires an answer line for ${entry.question_ref} ${entry.title} in the displayed order.`);
    }
    const answer = await promptForChoice(spec, lines, null);
    if (!choiceValues(spec).includes(answer)) {
      throw new Error(`${entry.question_ref} ${entry.title} must be one of: ${choiceValues(spec).join(', ')}`);
    }
    assignChoice(args, spec.key, answer);
  }
  for (const entry of answerPlan.details) {
    if (!detailPlanEntryApplies(entry, args)) continue;
    if (!lines.some((line) => String(line).trim())) throw new Error(entry.missing_message);
    if (entry.detail_type === 'managed-checkout-path') {
      args.repoRoot = await promptForCustomPath(lines, null);
      args.repoRootExplicit = true;
    } else if (entry.detail_type === 'report-retention-days') {
      args.updateReportRetentionDays = await promptForReportRetentionDays(lines, null);
      args.updateReportRetentionDaysExplicit = true;
    } else if (entry.detail_type === 'codex-helper-count') {
      args.codexHelperCount = await promptForHelperCount(lines, null);
    } else if (entry.detail_type === 'codex-helper-risk-approval') {
      await requireHighHelperCapacityApproval(args, lines, null);
    } else {
      throw new Error(`Unsupported setup answer-plan detail type: ${entry.detail_type}`);
    }
  }
}

function effectiveChoiceSummary(args, current, spec, value) {
  if (spec.key === 'taskAutoMerge') return args.taskAutoMerge;
  if (spec.key === 'repoAutoUpdate') return args.repoAutoUpdate ? 'enable' : 'disable';
  if (spec.key === 'updateReports') return args.updateReports ? 'enable' : 'disable';
  if (spec.key === 'updateReportRetention') return `${args.updateReportRetentionDays} days`;
  if (spec.key === 'codexDocLimit') return args.codexDocLimit ? 'enable' : 'disable';
  if (spec.key === 'codexPluginAutoRefresh') return args.codexPluginAutoRefresh ? 'enable' : 'disable';
  return value;
}

async function answerSetupQuestionBank(args, current, options = {}) {
  const isTTY = options.isTTY === undefined ? process.stdin.isTTY === true : options.isTTY === true;
  const initialSpecs = setupQuestionSpecs(args, current);
  assertManagedCheckoutChoiceAvailable(args, initialSpecs);
  const initialMissingCount = unanswered(initialSpecs, args).length;
  let answerSource = initialMissingCount ? (isTTY ? 'interactive' : 'stdin') : 'explicit flags';
  let completeStdinConsumed = false;

  if (args.yesRecommended) {
    answerSource = 'user-approved yes-recommended';
    for (const spec of unanswered(initialSpecs, args)) assignChoice(args, spec.key, spec.recommended);
  }

  let specs = setupQuestionSpecs(args, current);
  let missing = unanswered(specs, args);
  let needsCustomPath = args.setupChoices.managedCheckout === 'custom' && !args.repoRootExplicit;
  let needsRetentionDetails = args.setupChoices.updateReportRetention === 'custom' && !args.updateReportRetentionDaysExplicit;
  let needsHelperDetails = args.setupChoices.codexHelperCapacity === 'custom'
    && (args.codexHelperCount === null || (args.codexHelperCount > 1 && !args.approveHighHelperCapacity));
  const needsPromptedAnswers = missing.length > 0 || needsCustomPath || needsRetentionDetails || needsHelperDetails;
  const needsCodexProposalInput = !isTTY && needsPipedCodexProposalApproval(args, current);
  const conciseAllowed = !args.yesRecommended
    && initialMissingCount > 0
    && initialMissingCount === answerable(initialSpecs).length;
  const nonTtyAnswerMode = !needsPromptedAnswers
    ? 'non-tty-resolved'
    : (conciseAllowed ? 'non-tty' : 'non-tty-line-by-line');
  const nonTtyAnswerPlan = !isTTY && needsPromptedAnswers ? buildNonTtyAnswerPlan(specs, args) : null;
  const displayedSpecs = specs;

  // The complete canonical bank is the first input-dependent protocol event.
  // In particular, an open non-TTY pipe can never suppress bank visibility:
  // unresolved answers are consumed only after the parent validates, forwards,
  // and acknowledges this exact bank payload.
  const rendered = emitCompleteQuestionBank(specs, {
    render: isTTY
      ? (rows) => renderSetupQuestionBankTerminal(rows, {
        conciseCommands: conciseAllowed,
        answerMode: !needsPromptedAnswers ? 'non-tty-resolved' : undefined,
      })
      : (rows) => renderSetupQuestionBank(rows, {
        answerMode: nonTtyAnswerMode,
        answerPlan: nonTtyAnswerPlan,
      }),
    ...(options.write ? { write: options.write } : {}),
  });

  const rawStdin = (needsPromptedAnswers || needsCodexProposalInput) && !isTTY
    ? await readNonInteractiveStdin()
    : null;
  let lines = rawStdin === null ? null : rawStdin.split(/\r?\n/);
  let approvedBankAnswer = null;
  let rl = null;

  if (isTTY && missing.length && initialMissingCount === answerable(initialSpecs).length) {
    rl = options.createReadlineInterface
      ? options.createReadlineInterface()
      : readline.createInterface({ input: process.stdin, output: process.stdout });
    const conciseAnswer = await promptForTTYCommand(specs, rl);
    if (conciseAnswer) {
      assertQuestionBankAnswerBinding(conciseAnswer, specs);
      for (const selection of conciseAnswer.selections) {
        const spec = specs.find((candidate) => candidate.id === selection.question_id);
        assignChoice(args, spec.key, selection.canonical_value);
      }
      approvedBankAnswer = conciseAnswer;
      answerSource = conciseAnswer.mode === 'all-recommended'
        ? 'interactive all recommended'
        : 'interactive recommended except listed changes';
      specs = setupQuestionSpecs(args, current);
      missing = unanswered(specs, args);
      needsCustomPath = args.setupChoices.managedCheckout === 'custom' && !args.repoRootExplicit;
      needsRetentionDetails = args.setupChoices.updateReportRetention === 'custom' && !args.updateReportRetentionDaysExplicit;
      needsHelperDetails = args.setupChoices.codexHelperCapacity === 'custom'
        && (args.codexHelperCount === null || (args.codexHelperCount > 1 && !args.approveHighHelperCapacity));
    }
  }

  if (rawStdin !== null) {
    if (!conciseAllowed && looksLikeConciseSubmission(rawStdin)) {
      throw new Error('Concise bank-reference answers are not accepted when explicit setup flags already resolved part of the bank. Provide one line per unresolved question in the displayed order.');
    }
    const conciseAnswer = conciseAllowed ? parseConciseQuestionBankAnswer(rawStdin, specs) : null;
    if (conciseAnswer) {
      assertQuestionBankAnswerBinding(conciseAnswer, specs);
      for (const selection of conciseAnswer.selections) {
        const spec = specs.find((candidate) => candidate.id === selection.question_id);
        assignChoice(args, spec.key, selection.canonical_value);
      }
      approvedBankAnswer = conciseAnswer;
      answerSource = conciseAnswer.mode === 'all-recommended'
        ? 'user-approved all recommended'
        : 'user-approved recommended except listed changes';
      completeStdinConsumed = true;
      lines = [];
      specs = setupQuestionSpecs(args, current);
      missing = unanswered(specs, args);
      needsCustomPath = args.setupChoices.managedCheckout === 'custom' && !args.repoRootExplicit;
      needsRetentionDetails = args.setupChoices.updateReportRetention === 'custom' && !args.updateReportRetentionDaysExplicit;
      needsHelperDetails = args.setupChoices.codexHelperCapacity === 'custom'
        && (args.codexHelperCount === null || (args.codexHelperCount > 1 && !args.approveHighHelperCapacity));
      const detailInstructions = [];
      if (needsCustomPath) detailInstructions.push('Choose another update location requires `--repo-root <path>` or complete line-by-line input.');
      if (needsRetentionDetails) detailInstructions.push('Choose another report-retention duration requires `--update-report-retention-days <positive-days>` or complete line-by-line input.');
      if (needsHelperDetails) detailInstructions.push('The selected helper compatibility choice requires its explicit bounded helper details.');
      if (detailInstructions.length) {
        throw new Error(`Concise non-interactive setup answer requires additional values: ${detailInstructions.join(' ')}`);
      }
    }
  }

  // The same canonical plan that rendered the non-TTY grammar consumes it.
  // Question answers always precede the conditionally applicable detail block.
  if (!approvedBankAnswer && lines && nonTtyAnswerPlan) {
    await consumeNonTtyAnswerPlan(nonTtyAnswerPlan, displayedSpecs, args, lines);
    completeStdinConsumed = true;
    specs = setupQuestionSpecs(args, current);
    missing = unanswered(specs, args);
    needsCustomPath = args.setupChoices.managedCheckout === 'custom' && !args.repoRootExplicit;
    needsRetentionDetails = args.setupChoices.updateReportRetention === 'custom' && !args.updateReportRetentionDaysExplicit;
    needsHelperDetails = args.setupChoices.codexHelperCapacity === 'custom'
      && (args.codexHelperCount === null || (args.codexHelperCount > 1 && !args.approveHighHelperCapacity));
  }

  if (args.yesRecommended) {
    console.log('--yes-recommended selected; setup will apply these choices before writing.');
    console.log('');
  }
  if (missing.length) {
    console.log('');
    console.log('Answer the remaining setup choices now. Setup will not write preferences before these answers are complete.');
  }

  const remainingPromptedAnswers = missing.length > 0 || needsCustomPath || needsRetentionDetails || needsHelperDetails;
  if (remainingPromptedAnswers && !lines && !rl) {
    rl = options.createReadlineInterface
      ? options.createReadlineInterface()
      : readline.createInterface({ input: process.stdin, output: process.stdout });
  }
  try {
    for (const [position, spec] of missing.entries()) {
      const answer = await promptForChoice(spec, lines, rl);
      if (answer === ALL_RECOMMENDED_REST) {
        for (const rest of missing.slice(position)) assignChoice(args, rest.key, rest.recommended);
        console.log(`Applying the displayed recommendation to the remaining ${missing.length - position} question(s).`);
        break;
      }
      if (!choiceValues(spec).includes(answer)) {
        throw new Error(`${spec.title} must be one of: ${choiceValues(spec).join(', ')}`);
      }
      assignChoice(args, spec.key, answer);
    }
    if (args.setupChoices.updateReportRetention === 'custom' && !args.updateReportRetentionDaysExplicit) {
      args.updateReportRetentionDays = await promptForReportRetentionDays(lines, rl);
      args.updateReportRetentionDaysExplicit = true;
    }
    if (args.setupChoices.codexHelperCapacity === 'custom') {
      if (args.codexHelperCount === null) args.codexHelperCount = await promptForHelperCount(lines, rl);
      await requireHighHelperCapacityApproval(args, lines, rl);
    }
    if (args.setupChoices.managedCheckout === 'custom' && !args.repoRootExplicit) {
      args.repoRoot = await promptForCustomPath(lines, rl);
      args.repoRootExplicit = true;
    }
  } finally {
    if (rl) rl.close();
  }

  if (lines) completeStdinConsumed = true;

  if (args.host === 'claude-code') resolveClaudeTopology(args, current);
  const confirmedSpecs = setupQuestionSpecs(args, current);
  assertManagedCheckoutChoiceAvailable(args, confirmedSpecs);
  const displayedById = new Map(displayedSpecs.map((spec) => [spec.id, spec]));
  const confirmedAsDisplayed = withPresentationMetadata(confirmedSpecs.map((spec) => {
    const displayed = displayedById.get(spec.id);
    return { ...spec, selected: displayed?.selected, empty_input: displayed?.empty_input, presentation: undefined };
  }), displayedSpecs[0]?.presentation?.host || args.host);
  if (approvedBankAnswer) assertQuestionBankAnswerBinding(approvedBankAnswer, displayedSpecs);
  if (rendered.bank_identity !== confirmedAsDisplayed[0]?.presentation.bank_identity) {
    throw new Error('Setup question bank changed between rendering and approval.');
  }
  applySetupChoices(args, current);
  console.log('');
  console.log('Setup choices confirmed before writes:');
  for (const spec of answerable(confirmedSpecs)) {
    const value = choiceForKey(args, spec.key);
    const choice = selectedChoice(spec, value);
    if (!choice || choice.value !== value) throw new Error(`Setup question bank canonical value is inconsistent for ${spec.id}.`);
    const effective = effectiveChoiceSummary(args, current, spec, value);
    console.log(`- ${spec.presentation.question_ref} ${spec.title}: ${choice.presentation_ref} - ${choice.label} (canonical: ${choice.value}; effective: ${effective}) - ${choice.consequence}`);
    if (spec.afterApplying) console.log(`  After applying: ${spec.afterApplying}`);
  }
  const approvedPlanDetails = nonTtyAnswerPlan?.details.filter((entry) => detailPlanEntrySelected(entry, args)) || [];
  for (const entry of approvedPlanDetails) {
    const owner = entry.question_ref ? `${entry.question_ref} ${entry.question_title}` : 'Advanced compatibility selection';
    console.log(`- Detail ${entry.order} ${owner}: ${entry.description} - ${approvedDetailSummary(entry, args)}`);
  }
  if (!nonTtyAnswerPlan && args.setupChoices.codexHelperCapacity === 'custom') {
    console.log(`- Custom Codex helper count: ${args.codexHelperCount}`);
    console.log(`- Total Codex V2 (multi_agent_v2) session threads including the main agent: ${args.codexHelperCount + 1}`);
    console.log(`- RAM-risk approval for more than one helper: ${args.codexHelperCount > 1 ? (args.approveHighHelperCapacity ? 'approved' : 'missing') : 'not required'}`);
  }
  return {
    appeared: true,
    answers_initially_required: initialMissingCount > 0 || needsCustomPath || needsRetentionDetails || needsHelperDetails,
    answers_supplied_by_complete_stdin: completeStdinConsumed,
    answers_prompted_interactively: Boolean(rl),
    stopped_for_answers: false,
    answer_source: answerSource || 'none',
    remaining_input: lines ? lines.filter((line) => String(line).trim()) : [],
    render_attempts: rendered.attempts,
  };
}

function applySetupChoices(args, current) {
  const choices = args.setupChoices;
  if (current.taskAutoMerge?.status === 'blocked') throw new Error('Task auto-merge answer is unreadable; setup is blocked before writing.');
  args.taskAutoMerge = choices.taskAutoMerge === 'keep' ? current.taskAutoMerge?.value || 'off' : choices.taskAutoMerge || 'off';
  if (choices.managedCheckout === 'keep') {
    if (!canPreserveManagedCheckout(current, args)) {
      throw new Error('The current Toolkit update source cannot be preserved safely. Choose the dedicated clean update copy or another location.');
    }
    args.repoRoot = path.resolve(current.managed.currentPath);
  } else if (choices.managedCheckout === 'default') {
    args.repoRoot = defaultManagedSourcePath();
    args.repoRootExplicit = false;
  } else if (choices.managedCheckout === 'custom') {
    args.repoRoot = path.resolve(args.repoRoot);
    args.repoRootExplicit = true;
  }

  if (choices.repoAutoUpdate === 'keep') args.repoAutoUpdate = current.audit?.repo_auto_update?.enabled === true;
  else args.repoAutoUpdate = choices.repoAutoUpdate === 'enable';

  if (choices.updateReports === 'keep') args.updateReports = current.audit?.update_report_enabled !== false;
  else args.updateReports = choices.updateReports === 'enable';

  // Raise Codex's limit only on a yes (or a kept yes); a no puts back a value Toolkit raised.
  // Only Codex setup asks about Codex's limit; other hosts keep the stored choice.
  if (choices.codexDocLimit === 'keep' || (!choices.codexDocLimit && args.host !== 'codex')) args.codexDocLimit = current.audit?.codex_doc_limit_enabled === true;
  else args.codexDocLimit = choices.codexDocLimit === 'enable';
  args.codexDocLimitMode = choices.codexDocLimit === 'disable' ? 'restore' : args.codexDocLimit ? 'raise' : 'report';

  args.updateReportOpen = false;

  if (choices.updateReportRetention === 'keep') args.updateReportRetentionDays = currentReportRetentionDays(current);
  else if (choices.updateReportRetention === 'default') args.updateReportRetentionDays = DEFAULT_UPDATE_REPORT_RETENTION_DAYS;

  if (args.host === 'codex') {
    if (choices.codexPluginAutoRefresh === 'keep') args.codexPluginAutoRefresh = current.audit?.codex_plugin_auto_refresh_enabled === true;
    else args.codexPluginAutoRefresh = choices.codexPluginAutoRefresh === 'enable';
  }

  args.repoRoot = path.resolve(args.repoRoot);
}

// Setup that runs from the checkout it just fast-forwarded keeps executing the scripts it loaded
// before the update, and the Toolkit version it read when it started. When the update changed setup's
// own scripts or the version source, this run stops before any plugin, settings or config step and
// asks for one more run, which starts with the updated code and version.
const SETUP_SELF_PATHS = Object.freeze(['repo/scripts', 'repo/contracts/toolkit-local-bridge/version.json']);
function toolkitVersionAt(repoRoot, commit) {
  const text = runGitCapture(repoRoot, ['show', `${commit}:repo/contracts/toolkit-local-bridge/version.json`], 'read the Toolkit version', true, true);
  try {
    const version = JSON.parse(text).version;
    return /^\d+\.\d+\.\d+$/.test(version) ? version : '';
  } catch {
    return '';
  }
}

function setupSelfUpdateRerun(args, managed, { beforeChoices = false } = {}) {
  if (managed.update_action !== 'fast-forwarded' || !samePath(repoRootFromScript(), args.repoRoot)) return null;
  const changed = runGitCapture(args.repoRoot, ['diff', '--name-only', managed.commit_before, managed.commit_after, '--', ...SETUP_SELF_PATHS],
    'git diff --name-only (setup scripts)', false, true);
  if (!changed) return null;
  const from = toolkitVersionAt(args.repoRoot, managed.commit_before);
  const to = toolkitVersionAt(args.repoRoot, managed.commit_after);
  const when = beforeChoices ? 'before showing the choices' : 'after you answered the choices';
  const plain = from && to && from !== to
    ? `Setup updated itself from Toolkit ${from} to ${to} ${when}.`
    : `Setup updated its own scripts${to ? ` (Toolkit ${to})` : ''} ${when}.`;
  return [
    '## Setup updated itself',
    `Setup updated its Toolkit copy from ${managed.commit_before.slice(0, 7)} to ${managed.commit_after.slice(0, 7)}, and the update changed setup's own scripts.`,
    plain,
    ...(beforeChoices ? [
      'This run stopped there, before showing the choices or changing anything else.',
      'Run the same setup command again: it starts with the updated setup and shows the choices once.',
    ] : [
      'This run stopped there, before any plugin, settings or config step, so the older setup code changed nothing else.',
      'Your earlier answers were for the older setup, so the next run shows the choices again.',
      'Run the same setup command again: it starts with the updated setup and asks the setup questions again.',
    ]),
  ].join('\n');
}

// When automatic updates are recorded on for this managed copy and setup runs straight from it,
// setup makes the same clean fast-forward the session start makes before it shows the choices, so
// the choices come from the newest setup and the owner is not asked a second time after answering.
// A delegated child, a plan or explain run, a missing copy, a copy on another branch, and automatic
// updates that are off, undecided or recorded for another folder keep the update after the answers.
function updateBeforeChoices(args) {
  if (!args.execute || Number(process.env[MANAGED_DELEGATION_DEPTH_ENV] || 0) > 0) return null;
  if (!fs.existsSync(args.repoRoot) || !samePath(repoRootFromScript(), args.repoRoot)) return null;
  const saved = runBridgeAuditReadOnly(args).repo_auto_update || {};
  if (saved.enabled !== true || !saved.repo_path || !samePath(saved.repo_path, args.repoRoot)) return null;
  if (runGitCapture(args.repoRoot, ['branch', '--show-current'], 'git branch --show-current', true, true) !== args.repoBranch) return null;
  const managed = verifyAndUpdateTrustedRepo(args, null);
  return { managed, rerun: setupSelfUpdateRerun(args, managed, { beforeChoices: true }) };
}

// The user's own clone of Toolkit (the folder setup was started from), when it is not the managed
// checkout: fast-forward it to the default branch if it is clean and on that branch, else skip with the
// reason. It never resets, forces, stashes or switches branches.
function fastForwardLocalClone(args, startFolder = process.env[SETUP_START_FOLDER_ENV] || process.cwd()) {
  const top = runGitCapture(startFolder, ['rev-parse', '--show-toplevel'], 'find the local Toolkit clone', true, true);
  if (!top) return null;
  const clone = path.resolve(top);
  if (samePath(clone, args.repoRoot)) return null;
  if (!fs.existsSync(path.join(clone, 'repo', 'scripts', 'setup-toolkit.cjs'))) return null;
  const remote = runGitCapture(clone, ['remote', 'get-url', 'origin'], 'read the local clone remote', true, true);
  if (!remote || normalizeRemote(remote) !== normalizeRemote(args.repoRemote)) return null;
  const branch = runGitCapture(clone, ['branch', '--show-current'], 'read the local clone branch', true, true);
  if (branch !== args.repoBranch) return { status: 'skipped', reason: `your local clone is on ${branch || 'a detached head'}, not ${args.repoBranch}` };
  if (runGitCapture(clone, ['status', '--porcelain'], 'read the local clone status', true, true)) return { status: 'skipped', reason: 'your local clone has uncommitted changes' };
  const fetched = runCommand('fetch the local clone', 'git', ['fetch', 'origin', args.repoBranch], { cwd: clone, capture: true, timeout: 120000, allowFailure: true, quiet: true });
  if (fetched.status !== 0) return { status: 'skipped', reason: 'git fetch failed' };
  const before = runGitCapture(clone, ['rev-parse', 'HEAD'], 'read the local clone head', true, true);
  const merged = runCommand('fast-forward the local clone', 'git', ['merge', '--ff-only', `origin/${args.repoBranch}`], { cwd: clone, capture: true, timeout: 120000, allowFailure: true, quiet: true });
  if (merged.status !== 0) return { status: 'skipped', reason: `your local ${args.repoBranch} has commits that are not on origin, so it cannot fast-forward` };
  const after = runGitCapture(clone, ['rev-parse', 'HEAD'], 'read the local clone head', true, true);
  return before === after ? { status: 'current' } : { status: 'fast-forwarded', commit: after };
}

function localCloneSummary(result) {
  if (!result) return '';
  if (result.status === 'fast-forwarded') return `fast-forwarded to ${result.commit.slice(0, 7)}`;
  if (result.status === 'current') return 'already current';
  return `not updated: ${result.reason}`;
}

function activeToolkitWarning(args) {
  const activeRoot = repoRootFromScript();
  if (path.resolve(activeRoot) === path.resolve(args.repoRoot)) return '';
  if (!fs.existsSync(path.join(activeRoot, 'AGENTS.md')) || !fs.existsSync(path.join(activeRoot, 'repo', 'scripts', 'setup-toolkit.cjs'))) return '';
  const branch = runGitCapture(activeRoot, ['branch', '--show-current'], 'read active repo branch', true, true);
  if (!branch || branch === args.repoBranch) return '';
  return [
    `Active Toolkit worktree is on ${branch}, not ${args.repoBranch}.`,
    'This is okay: the active Codex or Claude Code session may be on a PR branch.',
    `Toolkit updates will use the managed clean ${args.repoBranch} checkout instead: ${args.repoRoot}`
  ].join(' ');
}

function validateManagedSourcePath(args) {
  if (args.repoRootExplicit) return;
  const activeRoot = repoRootFromScript();
  const resolved = path.resolve(args.repoRoot);
  const allowedSelfManagedPath = isRunningFromStandardManagedCheckout() && isStandardManagedPath(resolved);
  if (isInside(activeRoot, resolved) && !allowedSelfManagedPath) {
    throw new Error(`Default managed source checkout must not live inside the active Toolkit worktree: ${resolved}`);
  }
  if (hasUnsafeManagedPathMarker(resolved)) throw new Error(`Managed source checkout must not live inside plugin cache or temporary marketplace paths: ${resolved}`);
}

function cloneManagedCheckoutIfMissing(args) {
  if (fs.existsSync(args.repoRoot)) return false;
  fs.mkdirSync(path.dirname(args.repoRoot), { recursive: true });
  runCommand(
    `git clone --branch ${args.repoBranch} ${args.repoRemote} ${args.repoRoot}`,
    'git',
    ['clone', '--branch', args.repoBranch, args.repoRemote, args.repoRoot],
    { timeout: 180000 }
  );
  return true;
}

function verifyAndUpdateTrustedRepo(args, validationResults) {
  validateManagedSourcePath(args);
  const cloned = cloneManagedCheckoutIfMissing(args);
  assertRepoRoot(args.repoRoot);
  const status = runGitCapture(args.repoRoot, ['status', '--short'], 'git status --short');
  if (status) throw new Error(`managed Toolkit source checkout must be clean before setup can continue:\n${status}`);

  const remote = runGitCapture(args.repoRoot, ['remote', 'get-url', 'origin'], 'git remote get-url origin');
  if (normalizeRemote(remote) !== normalizeRemote(args.repoRemote)) {
    throw new Error(`Unexpected origin remote for managed Toolkit source checkout: ${remote}`);
  }

  runCommand(`git switch ${args.repoBranch}`, 'git', ['switch', args.repoBranch], { cwd: args.repoRoot, timeout: 60000 });
  const branch = runGitCapture(args.repoRoot, ['branch', '--show-current'], 'git branch --show-current');
  if (branch !== args.repoBranch) throw new Error(`Expected managed source branch ${args.repoBranch}, found ${branch || '<detached>'}`);

  try {
    fetchWithCredentialFallback(args.repoRoot, args.repoBranch);
  } catch (error) {
    if (isCredentialError(error.message)) {
      throw new Error(
        `${error.message}\n` +
        `Credential hint: this process could not authenticate to ${args.repoRemote}.\n` +
        'Run this command from the same shell/profile that already works for git fetch,\n' +
        'or run `gh auth login` in this context, then rerun setup toolkit.'
      );
    }
    throw error;
  }
  const fetchedCommit = runGitCapture(args.repoRoot, ['rev-parse', 'FETCH_HEAD'], 'git rev-parse FETCH_HEAD');
  const headBefore = runGitCapture(args.repoRoot, ['rev-parse', 'HEAD'], 'git rev-parse HEAD');
  const ancestor = runCommand('git merge-base --is-ancestor HEAD FETCH_HEAD', 'git', ['merge-base', '--is-ancestor', 'HEAD', 'FETCH_HEAD'], {
    cwd: args.repoRoot,
    capture: true,
    allowFailure: true
  });
  if (ancestor.status !== 0) throw new Error(`Managed source checkout cannot fast-forward from ${headBefore} to ${fetchedCommit}`);
  runCommand('git merge --ff-only FETCH_HEAD', 'git', ['merge', '--ff-only', 'FETCH_HEAD'], { cwd: args.repoRoot, timeout: 120000 });
  runManagedHookLightValidation(args, validationResults);
  const headAfter = runGitCapture(args.repoRoot, ['rev-parse', 'HEAD'], 'git rev-parse HEAD');
  return {
    cloned,
    branch,
    remote,
    commit_before: cloned ? 'unknown' : headBefore,
    commit_after: headAfter,
    commit: headAfter,
    update_action: cloned ? 'cloned' : (headBefore === headAfter ? 'already up to date' : 'fast-forwarded')
  };
}

function nodeScriptArgs(relScript, extraArgs = []) {
  return [path.join(...relScript.split('/')), ...extraArgs];
}

function parseJsonFromOutput(text) {
  return parseFirstJsonObject(text) || {};
}

function nativePluginPhaseFailure(platform, phase, result = {}, error = null) {
  const timedOut = error?.code === 'ETIMEDOUT' || result?.error?.code === 'ETIMEDOUT';
  if (phase === 'mutation' && timedOut) {
    return new Error(`${platform} native plugin mutation timed out before completion. Captured helper diagnostics were withheld from routine output.`);
  }
  const status = Number.isInteger(result?.status) ? ` (exit code ${result.status})` : '';
  const action = phase === 'mutation' ? 'mutation' : 'verification';
  return new Error(`${platform} native plugin ${action} failed${status}. Captured helper diagnostics were withheld from routine output.`);
}

// Codex refuses to repoint its Toolkit marketplace without the owner's separate approval. Say so,
// and give the one command that approves it, instead of withholding the helper's diagnostics.
function nativePluginRebindFailure(platform, phase, result, helperArgs) {
  if (platform !== 'Codex' || phase !== 'mutation') return null;
  const status = parseFirstJsonObject(result?.stdout || '');
  const version = /^\d+\.\d+\.\d+$/;
  if (status?.reason_code === 'downgrade-refused' && version.test(status.installed_version || '') && version.test(status.source_version || '')) {
    return new Error([
      `Codex already has Toolkit ${status.installed_version}, which is newer than this Toolkit copy (${status.source_version}), so setup refused to downgrade it. Codex's Toolkit plugin was not changed.`,
      'Run setup from a Toolkit copy at that version or newer, or keep the newer version as it is.',
    ].join('\n'));
  }
  if (status?.reason_code !== 'marketplace-rebind-required' || typeof status.current_source !== 'string' || !status.current_source) return null;
  const repoRoot = helperArgs[helperArgs.indexOf('--repo-root') + 1];
  return new Error([
    `Codex's Toolkit plugin is registered to a different Toolkit copy (${status.current_source}). Codex's Toolkit plugin was not changed.`,
    'To use this copy instead, approve the switch by running:',
    `  node "${path.join(repoRoot, 'repo', 'scripts', 'setup-codex-toolkit-plugin.cjs')}" --write --repo-root "${repoRoot}" --rebind-marketplace-from "${status.current_source}"`,
    'then run setup again.',
  ].join('\n'));
}

function runNativePluginJsonPhase({ platform, phase, label, args, cwd, timeout, allowRefreshRequired = false }) {
  let result;
  try {
    result = runCommand(label, process.execPath, args, {
      cwd,
      capture: true,
      timeout,
      allowFailure: true
    });
  } catch (error) {
    throw nativePluginPhaseFailure(platform, phase, {}, error);
  }
  if (result.status !== 0) {
    if (allowRefreshRequired) {
      console.log(`${platform} native plugin verification: current source identity was not established; approved refresh is required.`);
      return null;
    }
    throw nativePluginRebindFailure(platform, phase, result, args) || nativePluginPhaseFailure(platform, phase, result);
  }
  const summary = parseFirstJsonObject(result.stdout);
  if (!summary || summary.ok !== true) {
    const action = phase === 'mutation' ? 'mutation' : 'verification';
    throw new Error(`${platform} native plugin ${action} returned invalid structured status. Captured helper diagnostics were withheld from routine output.`);
  }
  return summary;
}

function expectedToolkitVersion(repoRoot, platform = 'codex') {
  const rel = platform === 'claude-code'
    ? ['.claude-plugin', 'plugin.json']
    : ['.codex-plugin', 'plugin.json'];
  try {
    return readJsonFile(path.join(repoRoot, ...rel)).version || 'unknown';
  } catch {
    return 'unknown';
  }
}

function defaultCodexPluginCachePath(version) {
  if (!version || version === 'unknown') return 'unknown';
  return path.join(os.homedir(), '.codex', 'plugins', 'cache', 'ai-agent-toolkit-local', 'ai-agent-toolkit', version);
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to read JSON ${filePath}: ${error.message}`);
  }
}

// Claude Code installs show no hook trust prompt (seen on 2.1.304 to 2.1.309), so setup asks for none.
const CLAUDE_HOOK_TRUST_ACTION = 'none: Claude Code has no separate trust step for plugin hooks; an enabled plugin\'s hooks run in sessions started after it is installed';

function verifyCurrentClaudeNativeEnforcement(args) {
  const metadata = verifyClaudeNativePluginMetadata(args);
  const result = runCommand(
    'node repo/scripts/setup-claude-toolkit-plugin.cjs --verify --json',
    process.execPath,
    setupClaudeArgs(args, '--verify'),
    { cwd: args.repoRoot, capture: true, timeout: claudeSetupBudgets(args.claudeCli).verify, allowFailure: true, quiet: true }
  );
  if (result.status !== 0) {
    return { ...metadata, status: 'needs-review', current: false, enforcement_verified: false, detail: (result.stderr || result.stdout || '').trim() };
  }
  try {
    const summary = parseJsonFromOutput(result.stdout);
    return { ...metadata, ...summary, status: 'already fresh' };
  } catch (error) {
    return { ...metadata, status: 'invalid', current: false, enforcement_verified: false, detail: error.message };
  }
}

// Static fallbacks match the helper's one precedence-selected CLI probe and
// are used only when the sibling helper cannot be loaded for derived budgets.
const CLAUDE_SETUP_VERIFY_TIMEOUT_FALLBACK_MS = 145000;
const CLAUDE_SETUP_WRITE_TIMEOUT_FALLBACK_MS = 865000;

// Derive the outer spawnSync timeouts for the Claude native plugin helper
// from the helper's own exported budgets so this orchestrator can never kill
// the helper while it is still inside its own supported verification
// deadlines. The budgets are computed with the exact explicit CLI argument
// the child helper receives, in the same environment it inherits, so the
// selected CLI resolution is accounted identically on both sides. The
// helper bounds itself (CLI probes, per-command
// timeouts, mutation deadlines); these outer timeouts are only a backstop
// against a truly hung helper.
function claudeSetupBudgets(claudeCli = '') {
  try {
    const helper = require(path.join(__dirname, 'setup-claude-toolkit-plugin.cjs'));
    if (typeof helper.verifyBudgetMs === 'function' && typeof helper.writeBudgetMs === 'function') {
      return { verify: helper.verifyBudgetMs(claudeCli), write: helper.writeBudgetMs(claudeCli) };
    }
  } catch {
    // Fall through to the static fallback budgets below.
  }
  return { verify: CLAUDE_SETUP_VERIFY_TIMEOUT_FALLBACK_MS, write: CLAUDE_SETUP_WRITE_TIMEOUT_FALLBACK_MS };
}

function runClaudeNativePluginVerify(args) {
  const result = runCommand(
    'node repo/scripts/setup-claude-toolkit-plugin.cjs --verify --json',
    process.execPath,
    setupClaudeArgs(args, '--verify'),
    { cwd: args.repoRoot, capture: true, timeout: claudeSetupBudgets(args.claudeCli).verify }
  );
  return parseJsonFromOutput(result.stdout);
}

function bridgeArgs(args, extraArgs = []) {
  const result = nodeScriptArgs('repo/scripts/toolkit-local-bridge.cjs', extraArgs);
  if (args.hub) result.push('--hub', args.hub);
  return result;
}

function runManagedHookLightValidation(args, validationResults) {
  const command = 'node --test repo/tests/toolkit-local-bridge-hook-light.test.cjs';
  runCommand(
    command,
    process.execPath,
    ['--test', path.join('repo', 'tests', 'toolkit-local-bridge-hook-light.test.cjs')],
    { cwd: args.repoRoot, timeout: 60000 }
  );
  recordValidation(validationResults, command, 'passed');
}

function runLiteValidation(args, validationResults) {
  const validateCommand = 'node repo/scripts/validate-toolkit.cjs';
  runCommand(validateCommand, process.execPath, nodeScriptArgs('repo/scripts/validate-toolkit.cjs'), {
    cwd: args.repoRoot,
    timeout: 120000
  });
  recordValidation(validationResults, validateCommand, 'passed');
  runManagedHookLightValidation(args, validationResults);
}

function runBridgeWrite(args, label, extraArgs) {
  runCommand(label, process.execPath, bridgeArgs(args, extraArgs), {
    cwd: args.repoRoot,
    timeout: 120000
  });
}

function writeBridgePreferences(args) {
  const choices = args.setupChoices || emptySetupChoices();
  if (choices.repoAutoUpdate === 'enable') {
    runBridgeWrite(
      args,
      'node repo/scripts/toolkit-local-bridge.cjs repo/update preferences --write',
      [
        '--enable-repo-auto-update',
        '--repo-path',
        args.repoRoot,
        '--repo-branch',
        args.repoBranch,
        '--repo-remote',
        args.repoRemote,
        '--enable-auto-sync',
        '--write'
      ]
    );
  } else if (choices.repoAutoUpdate === 'disable') {
    runBridgeWrite(
      args,
      'node repo/scripts/toolkit-local-bridge.cjs repo/update preferences --write',
      ['--disable-repo-auto-update', '--write']
    );
  }

  const reportArgs = ['--disable-update-report-open'];
  if (choices.updateReports === 'enable') reportArgs.push('--enable-update-reports');
  else if (choices.updateReports === 'disable') reportArgs.push('--disable-update-reports');
  if (choices.codexDocLimit === 'enable') reportArgs.push('--enable-codex-doc-limit');
  else if (choices.codexDocLimit === 'disable') reportArgs.push('--disable-codex-doc-limit');
  if (choices.updateReportRetention === 'default' || choices.updateReportRetention === 'custom') {
    reportArgs.push('--update-report-retention-days', String(args.updateReportRetentionDays));
  }
  if (reportArgs.length) {
    runBridgeWrite(
      args,
      'node repo/scripts/toolkit-local-bridge.cjs update report preferences --write',
      [...reportArgs, '--write']
    );
  }

  if (args.host === 'codex' && ['enable', 'disable'].includes(choices.codexPluginAutoRefresh)) {
    runBridgeWrite(
      args,
      'node repo/scripts/toolkit-local-bridge.cjs Codex cache preference --write',
      [args.codexPluginAutoRefresh ? '--enable-codex-plugin-auto-refresh' : '--disable-codex-plugin-auto-refresh', '--write']
    );
  }
}

function runBridgeAudit(args) {
  const result = runCommand('node repo/scripts/toolkit-local-bridge.cjs --audit', process.execPath, bridgeArgs(args, ['--audit']), {
    cwd: args.repoRoot,
    capture: true,
    timeout: 120000
  });
  const stdout = result.stdout || '';
  // Captured audit JSON remains internal to avoid routine path disclosure.
  const jsonStart = stdout.indexOf('{');
  if (jsonStart < 0) throw new Error('Final bridge audit did not return valid JSON.');
  const audit = JSON.parse(stdout.slice(jsonStart));
  if (!audit || typeof audit !== 'object' || Array.isArray(audit)) {
    throw new Error('Final bridge audit did not return a JSON object.');
  }
  return audit;
}

function printSetupChecklist(plan) {
  console.log('# setup toolkit checklist');
  console.log('');
  console.log(plan.checklist_explanation);
  console.log('');
  console.log(`Host: ${plan.host}`);
  console.log('Managed checkout path: <managed-toolkit-checkout>');
  console.log(`Managed checkout branch: ${plan.managed_source.branch}`);
  console.log(`Managed checkout remote: ${plan.managed_source.remote}`);
  console.log('');
  console.log('Preferences selected up front:');
  for (const [key, value] of Object.entries(plan.preferences)) {
    console.log(`- ${key}: ${value}`);
  }
}

function printPlan(plan, asJson) {
  if (asJson) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  if (plan.question_bank.length) {
    process.stdout.write(renderSetupQuestionBank(plan.question_bank));
  }
  printSetupChecklist(plan);
  for (const step of plan.steps) {
    console.log('');
    console.log(`${step.id}: ${step.title}`);
    for (const command of step.commands || []) console.log(`  ${command}`);
  }
}

function unknown(value) {
  if (value === undefined || value === null || value === '') return 'unknown';
  return value;
}

function yesNo(value) {
  return value ? 'yes' : 'no';
}

function delegationOutcomeSummary(args, result) {
  if (result.migrated_legacy_block === true) return 'migrated';
  if (args.setupChoices?.codexHelperCapacity === 'keep' || result.status === 'kept') return 'kept';
  if (result.status === 'configured' && result.changed === false) return 'already configured';
  if (result.status === 'configured') return 'configured';
  return result.status || 'unchanged';
}

function activeWorktreeSummary(args) {
  const activeRoot = repoRootFromScript();
  let role = 'bootstrap/fallback only';
  if (samePath(activeRoot, args.repoRoot)) role = 'managed checkout itself';
  else if (args.repoRootExplicit) role = 'not used for writes';
  return {
    path: activeRoot,
    branch: branchForSummary(activeRoot),
    commit: commitForSummary(activeRoot),
    status: statusForSummary(activeRoot),
    role
  };
}

function printValidationSummary(validationResults) {
  if (!validationResults || !validationResults.length) {
    console.log('Validation command: none');
    console.log('Validation status: skipped');
    return;
  }
  for (const entry of validationResults) {
    console.log(`Validation command: ${entry.command}`);
    console.log(`Validation status: ${entry.status}`);
  }
}

// safe-root-only is Toolkit's safe default whenever setup could not verify the installed hook this
// run; it is not a failure and is never called verified.
function profileOutcomeSummary(delegation) {
  if (delegation.status === 'safe-root-only') {
    return 'safe-root-only: root-only, Toolkit\'s safe default. Setup could not verify the installed Toolkit hook this run (it was just installed, a setting turns hooks off, or its agent hook did not answer a test launch), so the Toolkit hook keeps root-only. This is safe; to verify it, run `setup toolkit` again in a new Claude Code session.';
  }
  return delegation.status || 'unchanged';
}

function subagentDepthOutcomeSummary(result) {
  if (!result) return 'unchanged';
  if (result.status === 'held') return `held; ${result.detail} Toolkit did not change it.`;
  const effect = claudeSubagentDepthOutcome(result);
  return result.changed ? `changed; ${effect}` : `unchanged; ${effect}`;
}

function printFinalSummary({ args, current, managed, localClone, nativeCache, delegation, subagentDepth, claudeSettings, n8nSkills, antigravitySkills, audit, questionBank, validationResults, installCheck }) {
  const repo = audit?.repo_auto_update || {};
  const cleanup = audit?.update_report_cleanup || {};
  const active = activeWorktreeSummary(args);
  console.log('');
  console.log('# setup toolkit final summary');
  console.log('');
  console.log('## Active worktree');
  console.log('Active worktree path: <active-worktree>');
  console.log(`Active worktree branch: ${active.branch}`);
  console.log(`Active worktree commit: ${active.commit}`);
  console.log(`Active worktree status: ${active.status}`);
  console.log(`Active worktree role: ${active.role}`);
  console.log('');
  console.log('## Managed main checkout');
  console.log('Managed checkout path: <managed-toolkit-checkout>');
  console.log('Managed checkout default path: %USERPROFILE%\\.ai-agent-toolkit\\source\\ai-agent-toolkit');
  console.log(`Managed checkout branch: ${args.repoBranch}`);
  console.log(`Managed checkout remote: ${unknown(managed.remote || args.repoRemote)}`);
  console.log(`Managed checkout commit before: ${unknown(managed.commit_before || current?.managed?.commit)}`);
  console.log(`Managed checkout commit after: ${unknown(managed.commit_after || managed.commit)}`);
  console.log(`Managed checkout update action: ${unknown(managed.update_action)}`);
  console.log('Setup script path executed: <managed-toolkit-checkout>/repo/scripts/setup-toolkit.cjs');
  console.log('');
  console.log('## Question bank');
  console.log(`Question bank appeared: ${yesNo(questionBank?.appeared)}`);
  console.log(`Question answers initially required: ${yesNo(questionBank?.answers_initially_required)}`);
  console.log(`Question answers supplied by complete stdin: ${yesNo(questionBank?.answers_supplied_by_complete_stdin)}`);
  console.log(`Question answers prompted interactively: ${yesNo(questionBank?.answers_prompted_interactively)}`);
  console.log(`Question bank stopped for answers: ${yesNo(questionBank?.stopped_for_answers)}`);
  console.log(`Question answer source: ${unknown(questionBank?.answer_source || 'none')}`);
  console.log(`Question bank render attempts: ${unknown(questionBank?.render_attempts)}`);
  console.log(`Helper-agent capacity questions shown: ${yesNo(args.host === 'codex')}`);
  console.log('Preference writes before answers: no');
  console.log('');
  if (args.host === 'codex') {
  console.log('## Codex helper agents');
  console.log(`Codex helper-agent runtime: ${unknown(runtimeLabel(current?.runtime?.runtime || delegation.runtime))}`);
  console.log(`Runtime detection: ${unknown(current?.runtime?.detector)}`);
  console.log(`Normal helper capacity: ${Number.isSafeInteger(delegation.helper_count)
    ? `${delegation.helper_count} helper agent${delegation.helper_count === 1 ? '' : 's'}; ${delegation.total_threads || delegation.helper_count + 1} total session threads including the main agent (the root counts toward the total)`
    : 'unchanged or not configured'}`);
  console.log('Routine policy: Main agent only by default');
  console.log('Ordinary helper limit: At most one directly justified helper');
  console.log('Helper use for speed alone: Not allowed by Toolkit policy');
  console.log('Defined multi-worker workflow exception: Only when the user invoked that workflow, its worker count is stated, and higher persistent or temporary capacity was explicitly approved');
  console.log('Worker topology policy: Direct children of the root with no needless scope overlap; helpers must not spawn helpers; root retains coordination and final judgment');
  console.log('Helpers creating helpers: Prohibited by Toolkit policy');
  console.log(`Recursive delegation enforcement: ${unknown(delegation.recursive_helper_control || (delegation.runtime === RUNTIMES.V2 ? 'policy-only; no native hard block verified' : 'unverified'))}`);
  console.log('Runtime resource admission: Toolkit-controlled child paths reserve memory atomically before launch and fail closed when live state is unprovable.');
  const technicalSetting = delegation.runtime === RUNTIMES.V2 && Number.isSafeInteger(delegation.total_threads)
    ? `features.multi_agent_v2.max_concurrent_threads_per_session = ${delegation.total_threads}`
    : (delegation.runtime === RUNTIMES.V1 && Number.isSafeInteger(delegation.helper_count)
        ? `agents.max_threads = ${delegation.helper_count}; agents.max_depth = 1`
        : 'not changed');
  console.log(`Technical setting: ${technicalSetting}`);
  console.log(`Helper-capacity outcome this run: ${delegationOutcomeSummary(args, delegation)}`);
  console.log(`Configuration changed this run: ${yesNo(delegation.changed === true)}`);
  if (delegation.load_check) console.log(delegation.load_check.detail);
  console.log(`Old Toolkit helper block migrated: ${yesNo(delegation.migrated_legacy_block === true)}`);
  console.log(`Malformed historical Toolkit marker material repaired: ${yesNo(delegation.repaired_malformed_toolkit_material === true)}`);
  console.log(`Official V2 boolean enablement migrated to configured table: ${yesNo(delegation.migrated_v2_boolean_enablement === true)}`);
  console.log('Codex config path: <Codex user configuration>');
  console.log(`Configuration scope: ${unknown(delegation.client_scope || CODEX_CONFIG_CLIENT_SCOPE)}`);
  console.log(`Helper-capacity detail: ${unknown(delegation.detail)}`);
  console.log(`Temporary editor cleanup: ${unknown(delegation.temporary_cleanup || 'no temporary editor directory created')}`);
  if (delegation.backup_metadata_path) console.log(`Exact backup metadata: ${delegation.backup_metadata_path}`);
  if (delegation.restore_commands?.setup_script_path) console.log(`Restore command setup script: ${delegation.restore_commands.setup_script_path}`);
  if (delegation.restore_commands?.powershell) console.log(`Exact restore command (PowerShell): ${delegation.restore_commands.powershell}`);
  console.log('');
  console.log('## Codex Security capacity');
  console.log('Security capacity behavior: normal global capacity is never raised automatically');
  console.log('Isolated Security exception: unsupported by the currently documented Codex Security plugin and app-server interfaces');
  console.log('If a selected Security workflow requires more workers, raising global capacity may exhaust RAM. Never imply that an official Deep Scan can run with insufficient capacity. Use a lower-capacity ordinary or sequential review, run Deep Scan on another sufficiently provisioned machine, or explicitly make a temporary global increase with exact backup, restart, restoration, and another restart. A sequential custom review is not an official Deep Security Scan.');
  console.log('');
  } else {
    console.log('## Claude Code agent topology');
    console.log(`Selected topology: ${unknown(delegation.topology)}`);
    console.log('Governed workers: launched only by the Toolkit worker launcher pinned in the stack registry, under an authorised controller');
    console.log('Native, built-in, team, plugin, user-created, and third-party workers: blocked at the installed hook in Toolkit-governed repositories when root-only (only the Toolkit planning (G0) and build (G1) leaf helpers are admitted); outside Toolkit control when broader-native');
    console.log(`Profile outcome this run: ${profileOutcomeSummary(delegation)}`);
    console.log(`One-layer subagent setting this run: ${subagentDepthOutcomeSummary(subagentDepth)}`);
    if (claudeSettings) console.log(`Claude Code settings this run: ${claudeSettingsOutcome(claudeSettings)}${claudeSettings.some((entry) => entry.changed) ? ' Start a new Claude Code session to use them.' : ''}`);
    console.log(`Normal folders: ${normalFolderOutcomeSummary(delegation, subagentDepth)}`);
    console.log('');
  }
  if (n8nSkills) console.log(`Official n8n skills: ${n8nSkills}\n`);
  if (antigravitySkills) console.log(`Toolkit skills in Antigravity: ${antigravitySkills}\n`);
  if (localClone) console.log(`Your local Toolkit clone: ${localCloneSummary(localClone)}\n`);
  // Each host's summary reports only its own native plugin.
  if (args.host === 'codex') {
    console.log('## Codex native plugin');
    console.log('Codex plugin cache path: <Codex Toolkit cache>');
    console.log(`Codex expected Toolkit version: ${unknown(nativeCache.expected_version)}`);
    console.log(`Codex installed Toolkit version: ${unknown(nativeCache.installed_version)}`);
    console.log(`Codex plugin installed: ${yesNo(nativeCache.installed === true)}`);
    console.log(`Codex plugin enabled: ${yesNo(nativeCache.enabled === true)}`);
    console.log(`Codex plugin current: ${yesNo(nativeCache.current === true)}`);
    console.log(`Codex plugin status: ${unknown(nativeCache.status)}`);
    console.log(`Codex plugin updated this run: ${yesNo(nativeCache.updated_this_run === true)}`);
    console.log(`Codex: open /hooks and trust the updated Toolkit hooks: ${yesNo(nativeCache.restart_required === true)}`);
    if (nativeCache.status === 'instructions only') {
      console.log('Codex plugin instructions: no plugin change was made. To refresh it, say "refresh toolkit" in Codex, or run node "<managed-toolkit-checkout>/repo/scripts/setup-codex-toolkit-plugin.cjs" --write --json --repo-root "<managed-toolkit-checkout>".');
    }
    // Read from config.toml [hooks.state]; setup never edits it.
    console.log(`Codex hook trust status: ${unknown(nativeCache.hook_trust_status)}`);
    console.log(`Codex hook execution status: ${unknown(nativeCache.hook_execution_status)}`);
    console.log(`Codex hook trust action: ${unknown(nativeCache.hook_trust_action)}`);
    console.log('');
  }
  if (args.host === 'claude-code') {
    console.log('## Claude Code native plugin');
    console.log('Claude plugin manifest path: <managed-toolkit-checkout>/.claude-plugin/plugin.json');
    console.log(`Claude expected Toolkit version: ${unknown(nativeCache.expected_version)}`);
    console.log(`Claude manifest Toolkit version: ${unknown(nativeCache.manifest_version)}`);
    console.log(`Claude plugin status: ${unknown(nativeCache.status)}`);
    if (nativeCache.scope) console.log(`Claude plugin install scope: ${nativeCache.scope}`);
    console.log(`Claude Code in a terminal: ${unknown(nativeCache.manifest_version)} (runs from this PC's Toolkit folder)`);
    console.log(`Claude app: ${claudeAppCopyLine(claudeAccountToolkitVersion(claudeAccountPluginFolders()), nativeCache.manifest_version)}`);
    console.log(`Claude new session needed: ${yesNo(nativeCache.restart_required === true)}`);
    console.log(`Claude hook trust action: ${unknown(nativeCache.hook_trust_action || 'none')}`);
    console.log('');
  }
  console.log('## Bridge state');
  console.log(`Repo auto-update enabled: ${yesNo(repo.enabled === true || args.repoAutoUpdate === true)}`);
  console.log('Repo auto-update path: <managed-toolkit-checkout>');
  console.log(`Repo auto-update status: ${args.repoAutoUpdate ? unknown(repo.last_status || 'configured') : 'disabled'}`);
  console.log(`Update report writes enabled: ${args.updateReports}`);
  if (args.host === 'codex') console.log(`Codex instruction limit kept raised: ${yesNo(args.codexDocLimit === true)}`);
  console.log('Update report opening behavior: action-required reports open automatically; successful reports stay closed');
  console.log(`Update report/log retention days: ${args.updateReportRetentionDays}`);
  console.log('Update report/log directory: <Toolkit update-report directory>');
  console.log(`Update report cleanup deleted count: ${cleanup.deleted_count ?? 0}`);
  console.log(`Update report cleanup error count: ${cleanup.error_count ?? 0}`);
  console.log('');
  if (args.host === 'codex') {
    console.log('## Antigravity portable skills');
    console.log('Setup question "Copy Toolkit\'s skills into Antigravity?" manages the global copy in ~/.gemini/config/skills. For one project only, copy into <project>/.agents/skills:');
    console.log('Command: node repo/scripts/toolkit-local-bridge.cjs --copy-antigravity-skills --antigravity-project-root <project> [--write]');
    console.log('');
  }
  console.log('## Validation');
  printValidationSummary(validationResults);
  if (installCheck) printInstallCheck(installCheck);
}

const INSTALL_CHECK_WORDS = Object.freeze({ 'passed': 'passed', 'restart-required': 'new session needed', 'action-required': 'action required' });

function printInstallCheck(result) {
  console.log('');
  console.log('## Install check');
  console.log(`Install check: ${INSTALL_CHECK_WORDS[result.status]}`);
  for (const check of result.checks) console.log(`${check.label}: ${check.summary}`);
  if (result.actions.length) {
    console.log(result.status === INSTALL_CHECK_STATUS.ACTION ? 'What to do:' : 'Next step:');
    result.actions.forEach((action, index) => console.log(`${index + 1}. ${action}`));
  }
}

// The Toolkit global rules for every harness setup manages, rendered from the managed checkout.
// Codex's instruction limit follows the owner's answer to the setup question.
function setupGlobalRules(args) {
  return new GlobalRules({ toolkitRoot: args.repoRoot, retentionDays: args.updateReportRetentionDays,
    harnesses: GlobalRules.setupHarnesses({ antigravity: args.antigravityGlobalRules }), codexDocLimit: args.codexDocLimitMode || 'report',
    workingFolder: process.env[SETUP_START_FOLDER_ENV] || process.cwd() });
}

// Codex setup refreshes installed Toolkit helper agents to the stack each names and reports them.
function runCodexHelperAgents(args) {
  let result;
  try { result = new CodexHelperDefinitions({ repositoryRoot: args.repoRoot }).refresh(); }
  catch (error) { result = { status: 'held', detail: error.message }; }
  console.log('');
  console.log('## Toolkit helpers');
  for (const line of describeCodexHelpers(result, '<managed-toolkit-checkout>')) console.log(line);
  return result;
}

// One approved setup execution: collects current state and answers, verifies the
// managed checkout and native plugin, refreshes direct-agent capability, then runs
// validation, bridge sync/audit and delegation control in that order.
class ToolkitSetupExecution {
  #args; #current = null; #questionBank = null; #validationResults = [];
  constructor(args) { this.#args = args; }

  async #collectAndAnswer() {
    const args = this.#args;
    this.#current = await collectCurrentState(args);
    args.codexRuntime = this.#current.runtime.runtime;
    this.#questionBank = await answerSetupQuestionBank(args, this.#current);
    if (args.host === 'codex') this.#current = await detectCodexRuntimeAfterApproval(args, this.#current);
    await confirmSelectedDelegationProposal(args, this.#current, this.#questionBank);
    new TaskAutoMergePreferences({ host: args.host }).verify(this.#current.taskAutoMerge);
  }

  #announcePlan() {
    printSetupChecklist(setupPlan(this.#args));
    const warning = activeToolkitWarning(this.#args);
    if (warning) console.warn(`WARNING: ${warning}`);
  }

  #nativePluginSetup() {
    const args = this.#args;
    if (args.host !== 'claude-code') {
      // With no Codex home the question is not shown, and setup installs as before.
      const choice = args.setupChoices.codexPluginBehavior || 'install';
      if (choice === 'install') return runCodexNativePluginSetup(args);
      return codexPluginFromFiles(args, choice === 'keep' ? 'kept' : 'instructions only');
    }
    return args.setupChoices.claudePluginBehavior === 'install' ? runClaudeNativePluginSetup(args) : verifyCurrentClaudeNativeEnforcement(args);
  }

  async execute() {
    const args = this.#args;
    const mergePreference = taskAutoMerge(null, { host: args.host }).preference;
    if (mergePreference.status === 'blocked') throw new Error(mergePreference.detail);
    const early = updateBeforeChoices(args);
    if (early?.rerun) {
      console.log(early.rerun);
      return SETUP_ACTION_REQUIRED;
    }
    await this.#collectAndAnswer();
    this.#announcePlan();
    let managed = verifyAndUpdateTrustedRepo(args, this.#validationResults);
    const rerun = setupSelfUpdateRerun(args, managed);
    if (rerun) {
      console.log(rerun);
      return SETUP_ACTION_REQUIRED;
    }
    // The summary reports the update made before the choices, not the later "already up to date".
    if (early?.managed.update_action === 'fast-forwarded' && managed.update_action === 'already up to date') {
      managed = { ...managed, commit_before: early.managed.commit_before, update_action: 'fast-forwarded' };
    }
    const taskMerge = new TaskAutoMergePreferences({ host: args.host }).apply(args.setupChoices.taskAutoMerge, this.#current.taskAutoMerge);
    console.log(`${HOST_LABELS[args.host] || args.host} task auto-merge: ${taskMerge.value === 'after-gates' ? 'On' : 'Off'} (${taskMerge.changed ? 'saved and read back' : 'kept'}).`);
    const localClone = fastForwardLocalClone(args);
    // The owned V1 zero cap prevents Codex's plugin CLI from loading config.
    // Apply only this already-approved repair before invoking that CLI; ordinary
    // capacity changes retain their existing final-step order.
    const zeroRepair = args.host === 'codex' && this.#current.runtime.runtime === RUNTIMES.V1
      && this.#current.delegation.status === 'repair-required'
      && this.#current.delegation.ownership === 'toolkit-managed-v1'
      && this.#current.delegation.helper_count === 0
      && ['one-helper', 'custom', 'remove'].includes(args.setupChoices.codexHelperCapacity);
    const repairedDelegation = zeroRepair ? await applyHostDelegationControl(args, this.#current) : null;
    if (repairedDelegation?.changed) console.log(`The approved zero-helper repair was applied before Codex plugin setup. Backup: ${repairedDelegation.backup_metadata_path}`);
    const nativeCache = this.#nativePluginSetup();
    runLiteValidation(args, this.#validationResults);
    writeBridgePreferences(args);
    const audit = runBridgeAudit(args);
    const delegation = repairedDelegation || await applyHostDelegationControl(args, this.#current, nativeCache);
    const subagentDepth = args.host === 'claude-code' ? applyClaudeSubagentDepth(args) : null;
    const claudeSettings = args.host === 'claude-code' ? applyClaudeUserSettings(args) : null;
    // The Antigravity answer first: the n8n skills reach Antigravity only when Toolkit's skills are there.
    const antigravitySkills = applyAntigravitySkills(args);
    const n8nSkills = installOfficialN8nSkills(args);
    const installCheck = args.host === 'claude-code' ? runClaudeInstallCheck(args, nativeCache, delegation) : null;
    printFinalSummary({ args, current: this.#current, managed, localClone, nativeCache, delegation, subagentDepth, claudeSettings, n8nSkills, antigravitySkills, audit,
      questionBank: this.#questionBank, validationResults: this.#validationResults, installCheck });
    printWindowsTasks(args);
    const globalRules = args.host === 'claude-code' ? null : runCodexGlobalRules(args);
    const codexHelpers = args.host === 'claude-code' ? null : runCodexHelperAgents(args);
    return installCheck?.status === INSTALL_CHECK_STATUS.ACTION || globalRules?.status === 'held' || codexHelpers?.status === 'held' ? SETUP_ACTION_REQUIRED : 0;
  }
}

async function execute(args){return new ToolkitSetupExecution(args).execute();}

// The Windows scheduled tasks Toolkit keeps for the managed checkout's repository
// (toolkit-windows-tasks.cjs): each with its folder, name, schedule, purpose and state. Setup only
// reports them: agents do not create scheduled tasks, so when one needs creating or updating the
// report ends with the one PowerShell line the owner pastes. A failure here never stops setup.
// Tests pass a fake scheduler, checkout reads, home and log.
function printWindowsTasks(args, { platform = process.platform, scheduler = null, checkoutDeps = {}, home = os.homedir(), log = console.log } = {}) {
  if (platform !== 'win32') return null;
  log('');
  log('## Windows scheduled tasks');
  try {
    const windowsTasks = require('./toolkit-windows-tasks.cjs');
    const toolkitRoot = path.resolve(args.repoRoot);
    const desired = windowsTasks.desiredTasks({ checkout: toolkitRoot, toolkitRoot, deps: checkoutDeps });
    const plan = windowsTasks.planTasks(desired, { scheduler: scheduler || windowsTasks.powerShellScheduler(), home });
    const command = windowsTasks.applyCommand(desired, { toolkitRoot, home });
    for (const line of windowsTasks.describePlan(plan, { command })) log(line);
    return plan;
  } catch (error) {
    log(`Windows scheduled tasks could not be checked: ${error.message}`);
    return null;
  }
}

// Toolkit supports Windows computers only. Linux stays a build machine: CI runners set CI=true, and the
// setup tests run there. Every other platform stops here, before any host install or settings write.
function assertSupportedComputer({ platform = process.platform, environment = process.env } = {}) {
  if (platform === 'win32') return;
  if (platform === 'linux' && environment.CI === 'true') return;
  throw new Error(`Toolkit setup supports Windows 10 and 11 only; this computer runs ${platform}. macOS and Linux computers are not supported (Linux is used only for CI).`);
}

async function main(argv = process.argv.slice(2), options = {}) {
  if (argv.length === 1 && argv[0] === MANAGED_PROTOCOL_PROBE_FLAG) {
    process.stdout.write(`${JSON.stringify(managedProtocolProbe())}\n`);
    return 0;
  }
  if (argv.includes(REMOVE_TOOLKIT_TASKS_FLAG)) {
    if (argv.length !== 1) throw new Error(`${REMOVE_TOOLKIT_TASKS_FLAG} runs on its own`);
    assertSupportedComputer(options);
    return require('./toolkit-windows-tasks.cjs').main(['remove'], options.windowsTasksDeps || {});
  }
  const restoreIndex = argv.indexOf(RESTORE_FLAG);
  const restoreInline = argv.find((arg) => arg.startsWith(`${RESTORE_FLAG}=`));
  if (restoreIndex >= 0 || restoreInline) {
    const metadataPath = restoreInline
      ? restoreInline.slice(`${RESTORE_FLAG}=`.length)
      : String(argv[restoreIndex + 1] || '');
    if (!metadataPath) throw new Error(`${RESTORE_FLAG} requires a backup metadata path`);
    console.log(JSON.stringify(delegation.restoreCodexDelegationBackup(metadataPath), null, 2));
    return 0;
  }
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }
  assertSupportedComputer(options);
  if (args.verifyClaudePlugin) {
    runClaudeNativePluginVerify(args);
    return 0;
  }
  const mismatch = hostMismatch(args, options.environment || process.env);
  if (mismatch) {
    console.error(mismatch);
    return SETUP_HOST_MISMATCH;
  }
  const delegatedCode = await delegateToManagedSetupIfAvailable(args);
  if (delegatedCode !== null) return delegatedCode;
  if (args.plan) {
    const current = await collectCurrentState(args);
    args.codexRuntime = current.runtime.runtime;
    const planned = plannedQuestionBank(args, current);
    if (args.explain) {
      const text = renderQuestionRows(planned.specs, args.explain);
      if (!text) throw new Error(`No setup question ${args.explain} in this bank.`);
      console.log(`Bank reference: ${ensurePresentationMetadata(planned.specs)[0]?.presentation.bank_reference || ''} (${args.host})\n\n${text}`);
      return 0;
    }
    printPlan(setupPlan({ ...planned.args, questionBank: planned.specs }), args.json);
    return 0;
  }
  return execute(args);
}

if (require.main === module) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      if (/Setup question bank requires|must be one of|requires a path answer|requires a helper-count answer|require the exact approval answer|Selected helper setting remains unapplied/.test(error.message)) {
        process.exitCode = SETUP_PAUSED_FOR_QUESTION_BANK;
        console.error(`SETUP PAUSED: ${error.message}`);
        console.error('Question bank pause is intentional. Ask the user for the missing setup answers; do not rerun with --yes-recommended unless the user explicitly requested recommended defaults.');
      } else {
        process.exitCode = 1;
        console.error(`FAIL: ${error.message}`);
      }
    });
}

// Host lanes (setup-core-codex.cjs, setup-core-claude.cjs) receive the core helpers they use.
const {
  selectedHelperCount, needsPipedCodexProposalApproval, confirmSelectedDelegationProposal,
  applyCodexDelegationControl, detectCodexRuntimeAfterApproval, codexPluginFromFiles,
  runCodexNativePluginSetup, runCodexGlobalRules
} = defineCodexSetup({
  RUNTIMES, defaultCodexPluginCachePath, expectedToolkitVersion, nodeScriptArgs,
  printDelegationPreview, printDelegationRemovalPreview, runNativePluginJsonPhase, setupGlobalRules
});
const {
  inspectClaudeNativePluginStatePreApproval, resolveClaudeTopology, claudeSettingsOutcome,
  claudeSettingQuestions, applyClaudeUserSettings, applyClaudeSubagentDepth, applyClaudeAgentControl, setupClaudeArgs,
  runClaudeNativePluginSetup, verifyClaudeNativePluginMetadata, runClaudeInstallCheck
} = defineClaudeSetup({
  CLAUDE_HOOK_TRUST_ACTION, SUBAGENT_DEPTH_FOR_TOPOLOGY, claudeSetupBudgets,
  expectedToolkitVersion, nodeScriptArgs, readJsonFile, resolvedQuestion, runNativePluginJsonPhase,
  scriptRootForReadOnlyProbe, setupGlobalRules, unknown, wizardChoice
});

module.exports = {
  assertSupportedComputer,
  printWindowsTasks,
  gitFailureHint,
  nativePluginRebindFailure,
  installOfficialN8nSkills,
  applyAntigravitySkills,
  antigravityState,
  fastForwardLocalClone,
  DEFAULT_REPO_BRANCH,
  DEFAULT_REPO_REMOTE,
  DEFAULT_UPDATE_REPORT_RETENTION_DAYS,
  CODEX_AGENT_MAX_THREADS,
  CODEX_AGENT_MAX_DEPTH,
  SETUP_PAUSED_FOR_QUESTION_BANK,
  SETUP_ACTION_REQUIRED,
  SETUP_HOST_MISMATCH,
  hostMismatch,
  QUESTION_BANK_BEGIN,
  QUESTION_BANK_COMPLETE,
  MANAGED_QUESTION_BANK_PROTOCOL,
  CLAUDE_SETUP_VERIFY_TIMEOUT_FALLBACK_MS,
  CLAUDE_SETUP_WRITE_TIMEOUT_FALLBACK_MS,
  claudeSetupBudgets,
  defaultManagedSourcePath,
  codexDelegationConfigState: delegation.codexDelegationConfigState,
  inspectCodexDelegationConfig: delegation.inspectCodexDelegationConfig,
  configureCodexDelegation: delegation.configureCodexDelegation,
  applyHostDelegationControl,
  applyClaudeSubagentDepth,
  applyClaudeUserSettings,
  parseArgs,
  setupQuestionSpecs,
  documentationFixtureState,
  withPresentationMetadata,
  buildNonTtyAnswerPlan,
  questionBankApprovalPayload,
  spreadsheetChoiceReference,
  parseConciseQuestionBankAnswer,
  assertQuestionBankAnswerBinding,
  answerSetupQuestionBank,
  resolveDisplayedChoiceAnswer,
  renderSetupQuestionBank,
  renderQuestionRows,
  resolveClaudeTopology,
  renderSetupQuestionBankTerminal,
  renderSetupQuestionDocumentation,
  setupQuestionDocumentationSpecs,
  setupQuestionClaudeDocumentationSpecs,
  emitCompleteQuestionBank,
  runManagedQuestionBankChild,
  plannedQuestionBank,
  applySetupChoices,
  claudePluginInstallState,
  setupPlan,
  canPreserveManagedCheckout,
  main
};
