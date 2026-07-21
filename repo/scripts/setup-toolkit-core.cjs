#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const readline = require('node:readline/promises');
const delegation = require('./codex-delegation-config.cjs');
const agentControl = require('./toolkit-agent-control.cjs');
const processLaunch = require('./claude-process-launch.cjs');

const DEFAULT_REPO_BRANCH = 'main';
const DEFAULT_REPO_REMOTE = 'https://github.com/weijunswj/ai-agent-toolkit';
const DEFAULT_UPDATE_REPORT_RETENTION_DAYS = 7;
const { CODEX_AGENT_MAX_THREADS, CODEX_AGENT_MAX_DEPTH, CODEX_V2_RAM_SAFE_HELPERS, RUNTIMES, RESTORE_FLAG } = delegation;
const CODEX_CONFIG_CLIENT_SCOPE = 'Codex effective runtime inspected through app-server experimentalFeature/list; writes target only the Codex user config';
const SUPPORTED_TARGETS = ['opencode', 'ag2'];
const SUPPORTED_HOSTS = ['codex', 'claude-code'];
const SETUP_PAUSED_FOR_REPO_AUTO_UPDATE_APPROVAL = 20;
const SETUP_PAUSED_FOR_UPDATE_REPORT_OPEN_APPROVAL = 21;
const SETUP_PAUSED_FOR_CODEX_PLUGIN_AUTO_REFRESH_APPROVAL = 22;
const SETUP_PAUSED_FOR_QUESTION_BANK = 23;
const QUESTION_BANK_BEGIN = '<!-- setup-toolkit-question-bank:begin -->';
const QUESTION_BANK_COMPLETE = '<!-- setup-toolkit-question-bank:complete -->';
const MANAGED_QUESTION_BANK_PROTOCOL = 'setup-toolkit-managed-question-bank-v2';
const MANAGED_PROTOCOL_PROBE_FLAG = '--managed-question-bank-protocol-probe';
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

function parseTargetList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
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
    managedCheckout: '',
    repoAutoUpdate: '',
    updateReports: '',
    updateReportRetention: '',
    codexPluginAutoRefresh: '',
    codexHelperCapacity: '',
    claudeTopology: '',
    claudeAgentCapacity: '',
    claudePluginBehavior: '',
    targets: {
      opencode: '',
      ag2: ''
    }
  };
}

function setTargetChoice(args, target, choice) {
  if (!SUPPORTED_TARGETS.includes(target)) throw new Error(`Unsupported target: ${target}`);
  args.setupChoices.targets[target] = choice;
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
    codexPluginAutoRefresh: true,
    enableTargets: [],
    disableTargets: [],
    skipTargets: [],
    keepTargets: [],
    yesRecommended: false,
    codexHelperCount: null,
    claudeManualMaximum: null,
    claudeTopologyRequested: '',
    claudeAgentCapacityExplicit: false,
    approveHighHelperCapacity: false,
    approveCodexConfigProposal: false,
    codexRuntime: RUNTIMES.UNKNOWN,
    setupChoices: emptySetupChoices()
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index] || '';
    if (arg === '--plan') args.plan = true;
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
    else if (arg === '--yes-recommended') args.yesRecommended = true;
    else if (arg === '--codex-helper-capacity') {
      const choice = next().toLowerCase();
      const normalized = { 'ram-safe': 'one-helper', advanced: 'custom' }[choice] || choice;
      if (!['keep', 'one-helper', 'root-only', 'custom', 'migrate', 'remove', 'skip'].includes(normalized)) throw new Error(`Unsupported --codex-helper-capacity choice: ${choice}`);
      args.setupChoices.codexHelperCapacity = normalized;
    } else if (arg === '--codex-delegation-control') {
      const legacyChoice = String(argv[++index] || '').toLowerCase();
      const choice = { limit: 'one-helper', keep: 'keep', skip: 'skip' }[legacyChoice];
      if (!choice) throw new Error(`Unsupported --codex-delegation-control choice: ${legacyChoice}`);
      args.setupChoices.codexHelperCapacity = choice;
    } else if (arg.startsWith('--codex-helper-capacity=')) {
      const choice = arg.slice('--codex-helper-capacity='.length).toLowerCase();
      const normalized = { 'ram-safe': 'one-helper', advanced: 'custom' }[choice] || choice;
      if (!['keep', 'one-helper', 'root-only', 'custom', 'migrate', 'remove', 'skip'].includes(normalized)) throw new Error(`Unsupported --codex-helper-capacity choice: ${choice}`);
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
    else if (arg === '--claude-topology') {
      const choice = next().toLowerCase();
      if (!['root-only', 'toolkit-direct', 'broader-native', 'keep'].includes(choice)) throw new Error(`Unsupported --claude-topology choice: ${choice}`);
      args.claudeTopologyRequested = choice;
      args.setupChoices.claudeTopology = choice;
    } else if (arg.startsWith('--claude-topology=')) {
      const choice = arg.slice('--claude-topology='.length).toLowerCase();
      if (!['root-only', 'toolkit-direct', 'broader-native', 'keep'].includes(choice)) throw new Error(`Unsupported --claude-topology choice: ${choice}`);
      args.claudeTopologyRequested = choice;
      args.setupChoices.claudeTopology = choice;
    } else if (arg === '--claude-agent-capacity') {
      const choice = next().toLowerCase();
      if (!['automatic', 'root-only', 'keep', 'manual'].includes(choice)) throw new Error(`Unsupported --claude-agent-capacity choice: ${choice}`);
      args.setupChoices.claudeAgentCapacity = choice;
      args.claudeAgentCapacityExplicit = true;
    } else if (arg.startsWith('--claude-agent-capacity=')) {
      const choice = arg.slice('--claude-agent-capacity='.length).toLowerCase();
      if (!['automatic', 'root-only', 'keep', 'manual'].includes(choice)) throw new Error(`Unsupported --claude-agent-capacity choice: ${choice}`);
      args.setupChoices.claudeAgentCapacity = choice;
      args.claudeAgentCapacityExplicit = true;
    } else if (arg === '--claude-agent-maximum') {
      args.claudeManualMaximum = parsePositiveInteger(next(), arg);
      args.setupChoices.claudeAgentCapacity = 'manual';
      args.claudeAgentCapacityExplicit = true;
    } else if (arg.startsWith('--claude-agent-maximum=')) {
      args.claudeManualMaximum = parsePositiveInteger(arg.slice('--claude-agent-maximum='.length), '--claude-agent-maximum');
      args.setupChoices.claudeAgentCapacity = 'manual';
      args.claudeAgentCapacityExplicit = true;
    }
    else if (arg === '--claude-plugin-behavior') {
      const choice = next().toLowerCase();
      if (!['keep', 'instructions', 'install'].includes(choice)) throw new Error(`Unsupported --claude-plugin-behavior choice: ${choice}`);
      args.setupChoices.claudePluginBehavior = choice;
    } else if (arg.startsWith('--claude-plugin-behavior=')) {
      const choice = arg.slice('--claude-plugin-behavior='.length).toLowerCase();
      if (!['keep', 'instructions', 'install'].includes(choice)) throw new Error(`Unsupported --claude-plugin-behavior choice: ${choice}`);
      args.setupChoices.claudePluginBehavior = choice;
    } else if (arg === '--enable-target') {
      for (const target of parseTargetList(next())) {
        args.enableTargets.push(target);
        setTargetChoice(args, target, 'enable-sync');
      }
    } else if (arg.startsWith('--enable-target=')) {
      for (const target of parseTargetList(arg.slice('--enable-target='.length))) {
        args.enableTargets.push(target);
        setTargetChoice(args, target, 'enable-sync');
      }
    } else if (arg === '--disable-target') {
      for (const target of parseTargetList(next())) {
        args.disableTargets.push(target);
        setTargetChoice(args, target, 'disable');
      }
    } else if (arg.startsWith('--disable-target=')) {
      for (const target of parseTargetList(arg.slice('--disable-target='.length))) {
        args.disableTargets.push(target);
        setTargetChoice(args, target, 'disable');
      }
    } else if (arg === '--skip-target') {
      for (const target of parseTargetList(next())) {
        args.skipTargets.push(target);
        setTargetChoice(args, target, 'skip');
      }
    } else if (arg.startsWith('--skip-target=')) {
      for (const target of parseTargetList(arg.slice('--skip-target='.length))) {
        args.skipTargets.push(target);
        setTargetChoice(args, target, 'skip');
      }
    } else if (arg === '--keep-target') {
      for (const target of parseTargetList(next())) {
        args.keepTargets.push(target);
        setTargetChoice(args, target, 'keep');
      }
    } else if (arg.startsWith('--keep-target=')) {
      for (const target of parseTargetList(arg.slice('--keep-target='.length))) {
        args.keepTargets.push(target);
        setTargetChoice(args, target, 'keep');
      }
    } else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (args.plan && args.execute) throw new Error('--plan and --execute cannot be used together');
  if (!args.plan && !args.execute && !args.help && !args.verifyClaudePlugin) args.plan = true;
  args.repoRoot = path.resolve(args.repoRoot);
  args.repoBranch = args.repoBranch || DEFAULT_REPO_BRANCH;
  args.repoRemote = args.repoRemote || DEFAULT_REPO_REMOTE;
  if (!SUPPORTED_HOSTS.includes(args.host)) throw new Error(`Unsupported host: ${args.host}`);
  for (const target of args.enableTargets) {
    if (!SUPPORTED_TARGETS.includes(target)) throw new Error(`Unsupported target: ${target}`);
  }
  for (const target of args.disableTargets) {
    if (!SUPPORTED_TARGETS.includes(target)) throw new Error(`Unsupported target: ${target}`);
  }
  args.enableTargets = [...new Set(args.enableTargets)];
  args.disableTargets = [...new Set(args.disableTargets)];
  args.skipTargets = [...new Set(args.skipTargets)];
  args.keepTargets = [...new Set(args.keepTargets)];
  return args;
}

function relNodeCommand(relScript, extraArgs = []) {
  return ['node', slash(relScript), ...extraArgs].join(' ');
}

function preferenceSummary(options) {
  const choices = options.setupChoices || emptySetupChoices();
  const targetChoice = (target) => choices.targets?.[target] || 'question-required';
  return {
    repo_backed_auto_update: choices.repoAutoUpdate || 'question-required',
    host_native_plugin_cache_auto_refresh: options.host === 'codex'
      ? (choices.codexPluginAutoRefresh || 'question-required')
      : 'manual-verification-only',
    helper_capacity_backstop: options.host === 'codex'
      ? (choices.codexHelperCapacity || 'question-required')
      : (choices.claudeAgentCapacity || 'question-required'),
    selected_topology: options.host === 'codex'
      ? 'native-unintercepted-root-only'
      : (choices.claudeTopology || 'question-required'),
    helper_count: options.host === 'codex' && choices.codexHelperCapacity === 'custom'
      ? options.codexHelperCount
      : (options.host === 'codex' && choices.codexHelperCapacity === 'one-helper'
          ? CODEX_V2_RAM_SAFE_HELPERS
          : (options.host === 'codex' && choices.codexHelperCapacity === 'root-only' ? 0 : 'unchanged')),
    write_meaningful_update_reports: choices.updateReports || 'question-required',
    update_report_open_behavior: 'action-required-only; successful reports stay closed',
    update_report_retention_days: choices.updateReportRetention || 'question-required',
    opencode_sync: targetChoice('opencode'),
    ag2_antigravity_sync: targetChoice('ag2')
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

  const targetArgs = [];
  for (const target of options.enableTargets || []) targetArgs.push('--enable-target', target);
  targetArgs.push('--write', ...hubArgs);
  const disableTargetArgs = [];
  for (const target of options.disableTargets || []) disableTargetArgs.push('--disable-target', target);
  if (disableTargetArgs.length) disableTargetArgs.push('--write', ...hubArgs);

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
      }) : {
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
        id: 'approved_target_sync',
        title: 'Enable only selected OpenCode and AG2/Antigravity targets, then sync enabled targets',
        commands: [
          ...(disableTargetArgs.length ? [relNodeCommand('repo/scripts/toolkit-local-bridge.cjs', disableTargetArgs)] : []),
          ...((options.enableTargets || []).length ? [
            relNodeCommand('repo/scripts/toolkit-local-bridge.cjs', targetArgs),
            relNodeCommand('repo/scripts/toolkit-local-bridge.cjs', ['--sync-enabled', '--write', ...hubArgs])
          ] : [])
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
          ? [`manage only the Toolkit-owned ${options.codexRuntime || RUNTIMES.UNKNOWN} helper-capacity block in ${delegation.codexConfigPath()}`]
          : (host === 'claude-code' && (choices.claudeTopology !== 'keep' || choices.claudeAgentCapacity !== 'keep')
              ? ['write only the Claude Code profile under ~/.ai-agent-toolkit/agent-control/profiles/claude-code.json']
              : [])
      },
      {
        id: 'final_summary',
        title: 'Print the verified final setup summary including cleanup, cache, reports, targets, and restart/trust actions',
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
    '  node "%USERPROFILE%\\.ai-agent-toolkit\\source\\ai-agent-toolkit\\repo\\scripts\\setup-toolkit.cjs" --execute --profile auto-main',
    '  node "$HOME/.ai-agent-toolkit/source/ai-agent-toolkit/repo/scripts/setup-toolkit.cjs" --execute --profile auto-main',
    '  node repo/scripts/setup-toolkit.cjs --execute --profile auto-main  # bootstrap/fallback only when managed script is missing',
    '',
    'Common commands:',
    '  node repo/scripts/setup-toolkit.cjs --plan --json',
    '  node repo/scripts/setup-toolkit.cjs --execute --auto-main',
    '  node repo/scripts/setup-toolkit.cjs --execute --profile auto-main --yes-recommended',
    '  node "%USERPROFILE%\\.ai-agent-toolkit\\source\\ai-agent-toolkit\\repo\\scripts\\setup-toolkit.cjs" --execute --profile auto-main --host claude-code',
    '  node repo/scripts/setup-toolkit.cjs --execute --auto-main --enable-target opencode',
    '  node repo/scripts/setup-toolkit.cjs --execute --auto-main --enable-target opencode --enable-target ag2',
    '',
    'Options:',
    '  --repo-root <path>           advanced override for managed Toolkit checkout source',
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
    '                               let Codex hooks refresh stale Codex Toolkit cache and repair unsafe third-party hooks on Windows',
    '  --skip-codex-plugin-auto-refresh',
    '                               leave stale Codex plugin cache refresh manual',
    '  --keep-codex-plugin-auto-refresh',
    '                               preserve Codex plugin cache auto-refresh preference',
    '  --claude-topology root-only|toolkit-direct|broader-native|keep',
    '                               Claude-only topology; Toolkit direct is offered only when its launch controls verify',
    '  --claude-agent-capacity automatic|root-only|keep|manual',
    '                               canonical Claude admission mode; manual is still only a backstop',
    '  --claude-agent-maximum <count>',
    '                               positive manual maximum for Toolkit-managed Claude workers',
    '  --claude-plugin-behavior keep|instructions|install',
    '                               Claude Code only; verify/report, show native refresh instructions, or install/enable via claude plugin marketplace add + install --scope user',
    '  --enable-target opencode|ag2 enable and sync approved non-native bridge target',
    '  --disable-target opencode|ag2 disable target without deleting files',
    '  --keep-target opencode|ag2 preserve target state without refresh/sync',
    '  --skip-target opencode|ag2 skip target writes for this run'
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
  const result = spawnSync(command, args, {
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
    throw new Error(`${label} failed with exit code ${result.status}${stderr || stdout ? `: ${(stderr || stdout).trim()}` : ''}`);
  }
  return result;
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
      } else if (status !== 0) {
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
      repo_auto_update: {},
      targets: {}
    };
  }
  return parseFirstJsonObject(result.stdout) || {
    error: 'bridge audit did not return JSON',
    repo_auto_update: {},
    targets: {}
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

function inspectCodexNativePluginState(args) {
  const probeRoot = scriptRootForReadOnlyProbe(args);
  const result = runCommand(
    'node repo/scripts/setup-codex-toolkit-plugin.cjs --verify --json',
    process.execPath,
    setupCodexArgs({ ...args, repoRoot: probeRoot }, '--verify'),
    { cwd: probeRoot, capture: true, timeout: 120000, allowFailure: true, quiet: true }
  );
  return {
    status: result.status === 0 ? 'fresh' : 'needs-review',
    detail: (result.status === 0 ? result.stdout : (result.stderr || result.stdout || '')).trim()
  };
}

function inspectClaudeNativePluginState(args) {
  const probeRoot = scriptRootForReadOnlyProbe(args);
  const result = runCommand(
    'node repo/scripts/setup-claude-toolkit-plugin.cjs --verify --json',
    process.execPath,
    setupClaudeArgs({ ...args, repoRoot: probeRoot }, '--verify'),
    { cwd: probeRoot, capture: true, timeout: claudeSetupBudgets(args.claudeCli).verify, allowFailure: true, quiet: true }
  );
  if (result.status !== 0) {
    return { status: 'needs-review', current: false, enforcement_verified: false, detail: (result.stderr || result.stdout || '').trim() };
  }
  try {
    const summary = parseJsonFromOutput(result.stdout);
    return { ...summary, status: summary.enforcement_verified === true ? 'fresh' : 'needs-review', detail: 'Installed Claude plugin and enforcement bytes verified.' };
  } catch (error) {
    return { status: 'invalid', current: false, enforcement_verified: false, detail: error.message };
  }
}

function printDelegationPreview(preview) {
  console.log('');
  console.log('# Codex helper-agent config preview');
  console.log(`Codex config path: ${preview.config_path}`);
  console.log(`Effective runtime: ${preview.runtime}`);
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
  console.log(`Exact restore command after the approved write (POSIX shell): ${preview.restore_commands.posix}`);
}

function printDelegationRemovalPreview(preview) {
  console.log('');
  console.log('# Codex helper-limit removal preview');
  console.log(`Codex config path: ${preview.config_path}`);
  console.log(`Effective runtime: ${preview.runtime}`);
  console.log(`Before semantics: ${preview.before_semantics || preview.detail}`);
  console.log(`After semantics: ${preview.detail}`);
  console.log(`Exact affected keys: ${(preview.affected_keys || []).join(', ')}`);
  console.log(`Proposed edit: ${preview.proposed_action}`);
  console.log(`Codex backup directory: ${preview.backup_root}`);
  console.log(`Planned exact backup metadata: ${preview.backup_metadata_path}`);
  console.log(`Exact restore command after the approved write (PowerShell): ${preview.restore_commands.powershell}`);
  console.log(`Exact restore command after the approved write (POSIX shell): ${preview.restore_commands.posix}`);
}

function selectedHelperCount(args, current) {
  const choice = args.setupChoices.codexHelperCapacity;
  if (choice === 'one-helper') return 1;
  if (choice === 'root-only') return 0;
  if (choice === 'custom') return args.codexHelperCount;
  if (choice === 'migrate') return current.delegation.helper_count;
  return null;
}

function needsPipedCodexProposalApproval(args, current) {
  if (args.host !== 'codex' || args.approveCodexConfigProposal) return false;
  const choice = args.setupChoices.codexHelperCapacity;
  if (!['one-helper', 'root-only', 'custom', 'migrate', 'remove'].includes(choice)) return false;
  const helperCount = selectedHelperCount(args, current);
  if (choice === 'custom' && !Number.isSafeInteger(helperCount)) return false;
  const previewOptions = {
    runtime: current.runtime.runtime,
    setupScriptPath: path.resolve(__dirname, 'setup-toolkit.cjs'),
  };
  const preview = choice === 'remove'
    ? delegation.previewCodexDelegationRemoval(current.delegation.config_path || delegation.codexConfigPath(), previewOptions)
    : delegation.previewCodexDelegation(current.delegation.config_path || delegation.codexConfigPath(), {
        ...previewOptions,
        helperCount,
        allowUserOwnedReplacement: true,
      });
  return preview.selected_outcome_matches !== true
    && ['preview', 'removal-preview'].includes(preview.status)
    && preview.requires_user_confirmation === true;
}
async function confirmSelectedDelegationProposal(args, current, questionBank) {
  const assertQuestionBankConsumed = () => {
    if (questionBank.remaining_input.length) throw new Error('Setup question bank received unexpected extra non-empty input.');
  };
  if (args.host !== 'codex') {
    if (args.host === 'claude-code') {
      const selectedTopology = args.setupChoices.claudeTopology === 'keep' ? current.agentProfile.topology : args.setupChoices.claudeTopology;
      const managedCapacity = ['automatic', 'manual'].includes(args.setupChoices.claudeAgentCapacity);
      if (managedCapacity && !['toolkit-direct', agentControl.TOPOLOGIES.CLAUDE_DIRECT].includes(selectedTopology)) {
        throw new Error('Automatic or manual Toolkit admission requires the Direct Toolkit-managed subagents topology.');
      }
    }
    assertQuestionBankConsumed();
    return null;
  }
  const choice = args.setupChoices.codexHelperCapacity;
  if (!['one-helper', 'root-only', 'custom', 'migrate', 'remove'].includes(choice)) {
    assertQuestionBankConsumed();
    return null;
  }
  if (current.delegation.status === 'migration-required' && choice !== 'migrate') {
    throw new Error('Selected helper setting remains unapplied. The exact PR #237 legacy setting can only change through the explicit `migrate` choice; choose `migrate` or `keep`.');
  }
  if (choice === 'migrate' && (current.runtime.runtime !== RUNTIMES.V2 || current.delegation.status !== 'migration-required')) {
    throw new Error('Selected helper setting remains unapplied. No exact Toolkit-managed PR #237 legacy setting is available to migrate; choose an ordinary helper setting or `keep`.');
  }
  const helperCount = selectedHelperCount(args, current);
  const previewOptions = {
    runtime: current.runtime.runtime,
    setupScriptPath: path.resolve(__dirname, 'setup-toolkit.cjs'),
  };
  const preview = choice === 'remove'
    ? delegation.previewCodexDelegationRemoval(current.delegation.config_path || delegation.codexConfigPath(), previewOptions)
    : delegation.previewCodexDelegation(current.delegation.config_path || delegation.codexConfigPath(), {
        ...previewOptions,
        helperCount,
        allowUserOwnedReplacement: true,
      });
  if (preview.selected_outcome_matches === true) {
    assertQuestionBankConsumed();
    args.codexDelegationPreview = preview;
    return preview;
  }
  if (!['preview', 'removal-preview'].includes(preview.status)) {
    throw new Error(`Selected helper setting remains unapplied. Required action: resolve the reported Codex configuration or runtime detection problem, then rerun setup. ${preview.detail || preview.status}`);
  }
  preview.before_semantics = current.delegation.detail;
  if (choice === 'remove') printDelegationRemovalPreview(preview);
  else printDelegationPreview(preview);
  if (preview.requires_user_confirmation && !args.approveCodexConfigProposal) {
    let answer = '';
    if (questionBank.remaining_input.length) answer = String(questionBank.remaining_input.shift()).trim().toLowerCase();
    else if (process.stdin.isTTY) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      try { answer = (await rl.question('Type apply to approve this exact Codex configuration proposal: ')).trim().toLowerCase(); }
      finally { rl.close(); }
    }
    if (answer !== 'apply') {
      throw new Error('Selected helper setting remains unapplied. Required action: review the exact technical proposal and answer `apply`, or pass --approve-codex-config-proposal.');
    }
    args.approveCodexConfigProposal = true;
  }
  assertQuestionBankConsumed();
  args.codexDelegationPreview = preview;
  return preview;
}

async function applyHostDelegationControl(args, current, nativeCache = {}) {
  if (args.host === 'claude-code') {
    const resolved = resolveClaudeTopologyCapacity(args, current);
    const topology = resolved.topology;
    const capacityMode = resolved.capacity_mode;
    const strict = [agentControl.TOPOLOGIES.ROOT_ONLY, agentControl.TOPOLOGIES.CLAUDE_DIRECT].includes(topology);
    const installedEnforcement = nativeCache.restart_required !== true
      && nativeCache.strict_enforcement_verified === true && nativeCache.trusted === true
      && nativeCache.hook_active === true && agentControl.validActivationProof(nativeCache.activation_proof, {
        pluginVersion: nativeCache.installed_version || nativeCache.version,
        cachePath: nativeCache.cache_path,
      });
    const launchCapable = current.agentCapability?.launch_supported === true;
    const resourceCapable = current.agentCapability?.resource_counter_supported === true;
    const directEnforceable = launchCapable && installedEnforcement && resourceCapable;
    const enforceable = topology === agentControl.TOPOLOGIES.CLAUDE_DIRECT ? directEnforceable : installedEnforcement;
    if (topology === agentControl.TOPOLOGIES.CLAUDE_DIRECT && !directEnforceable) {
      const reason = nativeCache.restart_required === true
        ? 'Current Toolkit activation is restart-pending; direct Claude capability verification was deferred.'
        : 'Current Claude CLI controls, native hook trust/activation, installed Toolkit bytes, exact worker/checker launches, or required resource counters could not be verified.';
      const invalidated = agentControl.invalidateProfile('claude-code', reason);
      return { ...invalidated, status: nativeCache.restart_required === true ? 'restart-pending-root-only' : 'capability-lost-root-only', changed: true, selected_strict_state_applied: false, client_scope: 'Claude-only Toolkit profile' };
    }
    if (topology === agentControl.TOPOLOGIES.ROOT_ONLY && !installedEnforcement) {
      const invalidated = agentControl.invalidateProfile('claude-code', 'Root-only remains the safe fallback while current native hook trust/activation or installed Toolkit bytes are unverified.');
      return { ...invalidated, status: 'safe-root-only', changed: true, selected_strict_state_applied: false, client_scope: 'Claude-only Toolkit profile' };
    }
    const configured = agentControl.configureProfile('claude-code', {
      topology,
      capacity_mode: capacityMode,
      manual_maximum: resolved.manual_maximum,
      enforcement_verified: strict,
      activation_proof: nativeCache.activation_proof,
      claude_cli: current.agentCapability?.claude_command || processLaunch.resolveClaudeCommandInput({
        explicit: args.claudeCli,
        persisted: current.agentProfile?.claude_cli,
      }),
      resource_counter_supported: resourceCapable,
      resource_counter_source: current.agentCapability?.resource_counter_source,
    });
    return { status: 'configured', ...configured, changed: true, selected_strict_state_applied: !strict || enforceable, client_scope: 'Claude-only Toolkit profile' };
  }
  if (args.host !== 'codex') {
    return { status: 'unsupported', detail: 'No enforceable host topology profile is available; portable root-first launch gates still apply', client_scope: 'not applicable', changed: false };
  }
  const choice = args.setupChoices.codexHelperCapacity;
  const configPath = current.delegation.config_path || delegation.codexConfigPath();
  const options = {
    runtime: current.runtime.runtime,
    helperCount: selectedHelperCount(args, current),
    codexCommand: args.codexCli,
    codexHome: delegation.defaultCodexHome(),
    setupScriptPath: path.resolve(__dirname, 'setup-toolkit.cjs'),
    allowUserOwnedReplacement: args.approveCodexConfigProposal,
  };
  if (!['migrate', 'one-helper', 'root-only', 'custom', 'remove'].includes(choice)) return delegation.delegationResultForChoice(choice, configPath, options);
  if (choice === 'migrate') options.helperCount = current.delegation.helper_count;
  const preview = args.codexDelegationPreview;
  if (preview?.selected_outcome_matches === true) {
    const verifiedNoop = delegation.previewCodexDelegation(configPath, {
      runtime: current.runtime.runtime,
      helperCount: options.helperCount,
      setupScriptPath: path.resolve(__dirname, 'setup-toolkit.cjs'),
      allowUserOwnedReplacement: true,
    });
    if (verifiedNoop.selected_outcome_matches !== true) {
      throw new Error('Selected helper setting remains unapplied. The previously matching user-owned Codex configuration changed before final verification; rerun setup.');
    }
    return verifiedNoop;
  }
  if (!preview || !['preview', 'removal-preview'].includes(preview.status) || !preview.approval_binding) {
    throw new Error('Selected helper setting remains unapplied. Toolkit could not verify the approved Codex proposal. Rerun setup to receive a fresh proposal.');
  }
  options.backupGenerationId = preview.backup_generation_id;
  options.approvedProposal = preview.approval_binding;
  const effectiveChoice = ['one-helper', 'root-only', 'custom'].includes(choice) ? 'custom' : choice;
  const result = await delegation.delegationResultForChoice(effectiveChoice, configPath, options);
  if (result.status === 'approval-stale' || result.status === 'approval-invalid') throw new Error(result.detail);
  if (choice === 'remove') {
    if (result.status !== 'removed' || result.changed !== true) {
      throw new Error(`Selected helper setting remains unapplied. Required action: resolve the reported Codex configuration problem and rerun setup. ${result.detail || result.status}`);
    }
    return result;
  }
  if (result.status !== 'configured' || result.helper_count !== options.helperCount) {
    throw new Error(`Selected helper setting remains unapplied. Required action: resolve the reported Codex configuration problem and rerun setup. ${result.detail || result.status}`);
  }
  return result;
}

function inspectClaudeAgentCapability(args) {
  const env = Object.prototype.hasOwnProperty.call(args, 'env') ? args.env : process.env;
  const requestedCommand = processLaunch.resolveClaudeCommandInput({
    explicit: args.claudeCli,
    persisted: args.persistedClaudeCli,
    env,
  });
  let command;
  try { command = processLaunch.assertExecutableAvailable(requestedCommand, { env }); }
  catch (error) {
    const resourceCapability = agentControl.inspectResourceCapability();
    return {
      supported: false, launch_supported: false, executable_available: false,
      launch_verification: 'deferred-until-post-approval', resource_counter_supported: resourceCapability.supported,
      resource_counter_source: resourceCapability.source, detector: `Claude CLI unavailable: ${error.message}`,
      launch_probe_status: 'deferred', version: '', version_verification: 'deferred',
      direct_only: false, medium_effort: false, non_fast_environment_override: false,
    };
  }
  const resourceCapability = agentControl.inspectResourceCapability();
  return {
    supported: false, launch_supported: false, executable_available: true,
    launch_verification: 'deferred-until-post-approval', resource_counter_supported: resourceCapability.supported,
    resource_counter_source: resourceCapability.source,
    detector: 'Claude executable and resource counters inspected observationally; exact worker/checker launch capability is deferred until post-approval current-plugin verification',
    launch_probe_status: 'deferred', launch_probe_exit_status: null, checker_probe_exit_status: null,
    claude_command: command, version: '', version_verification: 'deferred',
    direct_only: false, medium_effort: false, non_fast_environment_override: false,
  };
}

function probeClaudeAgentCapability(args) {
  const env = Object.prototype.hasOwnProperty.call(args, 'env') ? args.env : process.env;
  const requestedCommand = processLaunch.resolveClaudeCommandInput({
    explicit: args.claudeCli,
    persisted: args.persistedClaudeCli,
    env,
  });
  const helper = require('./setup-claude-toolkit-plugin.cjs');
  let command;
  try { command = processLaunch.assertExecutableAvailable(requestedCommand, { env }); }
  catch (error) {
    const resourceCapability = agentControl.inspectResourceCapability();
    return {
      supported: false, launch_supported: false, resource_counter_supported: resourceCapability.supported,
      resource_counter_source: resourceCapability.source, detector: `Claude CLI unavailable: ${error.message}`,
      version: '', direct_only: false, medium_effort: false, non_fast_environment_override: false,
    };
  }
  const probeEnv = { ...env, CLAUDE_CODE_DISABLE_FAST_MODE: '1', CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1', AI_AGENT_TOOLKIT_CAPABILITY_PROBE: '1' };
  const versionResult = helper.runClaudeCommand(command, ['--version'], { timeout: 10000, env: probeEnv });
  const version = `${versionResult.stdout || ''}\n${versionResult.stderr || ''}`.trim();
  const probeSpecs = [
    { role: agentControl.ROLES.WORKER, model: agentControl.MODEL_CONTRACT[agentControl.HOSTS.CLAUDE].worker, effort: 'medium' },
    { role: agentControl.ROLES.CHECKER, model: agentControl.MODEL_CONTRACT[agentControl.HOSTS.CLAUDE].checker, effort: 'medium' },
  ];
  const probes = probeSpecs.map((spec) => helper.runClaudeCommand(command, agentControl.claudeInvocationArgs(spec), {
    timeout: 10000,
    input: '',
    env: probeEnv,
  }));
  const probeOutput = probes.map((probe) => `${probe.stdout || ''}\n${probe.stderr || ''}${probe.error ? `\n${probe.error.message}` : ''}`).join('\n').trim();
  const unsupportedSyntax = /unknown (?:option|argument)|unrecognized (?:option|argument)|unexpected argument|invalid (?:option|argument).*--|unknown model|model .*not (?:found|available|supported)/i.test(probeOutput);
  const launchSupported = versionResult.status === 0 && version.length > 0 && probes.every((probe) => probe.status === 0);
  const resourceCapability = agentControl.inspectResourceCapability();
  const probeStatus = launchSupported ? 'supported' : (unsupportedSyntax ? 'unsupported-syntax' : 'indeterminate-runtime-failure');
  return {
    supported: launchSupported && resourceCapability.supported,
    launch_supported: launchSupported,
    resource_counter_supported: resourceCapability.supported,
    resource_counter_source: resourceCapability.source,
    detector: launchSupported
      ? 'post-approval claude --version plus bounded empty-input exact-argv capability probe with maintenance isolation'
      : `Claude launch capability ${probeStatus}`,
    launch_probe_status: probeStatus,
    launch_probe_exit_status: Number.isInteger(probes[0]?.status) ? probes[0].status : null,
    checker_probe_exit_status: Number.isInteger(probes[1]?.status) ? probes[1].status : null,
    claude_command: command,
    version,
    direct_only: launchSupported,
    medium_effort: launchSupported,
    non_fast_environment_override: launchSupported,
  };
}

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

async function collectCurrentState(args) {
  const audit = runBridgeAuditReadOnly(args);
  const runtime = args.host === 'codex'
    ? await delegation.inspectCodexMultiAgentRuntime({
        codexCommand: args.codexCli,
        codexHome: delegation.defaultCodexHome(),
        cwd: repoRootFromScript(),
      })
    : { runtime: RUNTIMES.UNKNOWN, detector: 'not applicable', detail: 'Codex runtime detection is not applicable to this host.' };
  const delegationState = args.host === 'codex'
    ? delegation.inspectCodexDelegationConfig(delegation.codexConfigPath(), runtime.runtime)
    : { status: 'unsupported', detail: 'No enforceable host topology profile is available; portable root-first launch gates still apply', client_scope: 'not applicable' };
  const delegationMigrationPreview = args.host === 'codex' && delegationState.status === 'migration-required'
    ? delegation.previewCodexDelegation(delegationState.config_path, {
        runtime: runtime.runtime,
        helperCount: delegationState.helper_count,
        setupScriptPath: path.resolve(__dirname, 'setup-toolkit.cjs'),
      })
    : null;
  const agentProfile = args.host === 'claude-code' ? agentControl.readProfile('claude-code') : agentControl.readProfile('codex');
  return {
    audit,
    runtime,
    managed: inspectManagedCheckout(args, audit),
    delegation: delegationState,
    delegationMigrationPreview,
    agentCapability: args.host === 'claude-code' ? inspectClaudeAgentCapability({ ...args, persistedClaudeCli: agentProfile.claude_cli }) : { supported: false, detector: 'not applicable' },
    agentProfile,
    nativePlugin: args.host === 'claude-code'
      ? inspectClaudeNativePluginStatePreApproval(args)
      : inspectCodexNativePluginState(args)
  };
}

function formatBool(value) {
  return value ? 'enabled' : 'disabled';
}

function formatTargetState(target) {
  if (!target) return 'not detected';
  const parts = [
    `detected=${target.detected ? 'yes' : 'no'}`,
    `enabled=${target.enabled ? 'yes' : 'no'}`,
    `synced=${target.synced ? 'yes' : 'no'}`
  ];
  if (target.synced_version) parts.push(`version=${target.synced_version}`);
  if (target.status) parts.push(`status=${target.status}`);
  return parts.join(', ');
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
  if (key === 'repoAutoUpdate') return 'enable';
  if (key === 'updateReports') return 'enable';
  if (key === 'updateReportRetention') return currentReportRetentionDays(current) === DEFAULT_UPDATE_REPORT_RETENTION_DAYS ? 'keep' : 'default';
  if (key === 'codexPluginAutoRefresh') return 'enable';
  if (key === 'codexHelperCapacity') {
    if (current.delegation?.status === 'migration-required') return 'keep';
    return [RUNTIMES.V1, RUNTIMES.V2].includes(current.runtime?.runtime) ? 'root-only' : 'keep';
  }
  if (key === 'claudeTopology') return strictClaudeSetupCapability(current) ? 'toolkit-direct' : 'root-only';
  if (key === 'claudeAgentCapacity') return strictClaudeSetupCapability(current) ? 'automatic' : 'root-only';
  if (key === 'claudePluginBehavior') return 'install';
  if (key === 'opencodeTarget') return 'keep';
  if (key === 'ag2Target') return 'keep';
  return 'keep';
}

function strictClaudeSetupCapability(current) {
  return current.agentCapability?.launch_supported === true
    && current.agentCapability?.resource_counter_supported === true
    && current.nativePlugin?.strict_enforcement_verified === true
    && current.nativePlugin?.trusted === true
    && current.nativePlugin?.hook_active === true
    && agentControl.validActivationProof(current.nativePlugin?.activation_proof);
}

function wizardChoice(value, label, consequence) {
  return { value, label, consequence };
}

function resolvedQuestion(definition) {
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
    },
    recommendation: { ...recommendation },
    choices: definition.choices.map((choice) => ({ ...choice })),
    afterApplying: definition.afterApplying || '',
    availability: definition.availability || { status: 'available', condition: 'Available for the detected setup state.' },
    privacySafeFallback: definition.privacySafeFallback || 'The effective state could not be verified safely; setup will not guess or expose private configuration.',
    selected: definition.selected,
    // Compatibility aliases for existing consumers. Every alias is derived from
    // the structured semantic fields above rather than maintained separately.
    description: definition.whatThisControls,
    current: definition.current,
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
          || specs.filter((candidate) => candidate.section === spec.section).length,
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
        what_this_controls: spec.whatThisControls,
        current: {
          effective_behavior: spec.currentState?.effectiveBehavior || spec.current,
          displayed_text: spec.current,
          verification: spec.currentState?.verification || 'unverified',
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

function normalizeBankReference(value) {
  const normalized = String(value || '').trim().toUpperCase();
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
    sectionByName.get(spec.section).question_count += 1;
  }
  const seenBySection = new Map();
  const presented = specs.map((spec) => {
    const section = sectionByName.get(spec.section);
    const questionIndex = (seenBySection.get(spec.section) || 0) + 1;
    seenBySection.set(spec.section, questionIndex);
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
        question_ref: `${section.index}.${questionIndex}`,
        recommended_choice_ref: recommendedChoice.presentation_ref,
        total_visible_section_count: sections.length,
        total_visible_question_count: specs.length,
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

function reconcileClaudeQuestionChoices(args, current) {
  if (args.host !== 'claude-code') return;
  const choices = args.setupChoices;
  const currentProfile = current.agentProfile || agentControl.readProfile('claude-code');
  const requestedTopology = args.claudeTopologyRequested || choices.claudeTopology || 'keep';
  const explicitCapacity = args.claudeAgentCapacityExplicit === true;
  if (requestedTopology === 'keep' && currentProfile.supported === true) {
    choices.claudeTopology = currentProfile.topology === agentControl.TOPOLOGIES.CLAUDE_DIRECT ? 'toolkit-direct'
      : (currentProfile.topology === agentControl.TOPOLOGIES.BROADER_NATIVE ? 'broader-native' : 'root-only');
  }
  if (requestedTopology === 'keep' && currentProfile.supported !== true) {
    choices.claudeTopology = 'root-only';
  }
  if (explicitCapacity && choices.claudeAgentCapacity === 'root-only' && choices.claudeTopology !== 'broader-native') {
    choices.claudeTopology = 'root-only';
  }
  if (['root-only', 'broader-native'].includes(choices.claudeTopology)) {
    choices.claudeAgentCapacity = 'root-only';
  } else if (choices.claudeTopology === 'toolkit-direct' && requestedTopology === 'keep' && !explicitCapacity) {
    const compatibleKeep = currentProfile.supported === true && currentProfile.topology === agentControl.TOPOLOGIES.CLAUDE_DIRECT
      && [agentControl.CAPACITY_MODES.AUTO, agentControl.CAPACITY_MODES.MANUAL].includes(currentProfile.capacity_mode);
    choices.claudeAgentCapacity = compatibleKeep ? 'keep' : 'automatic';
  } else if (choices.claudeTopology === 'toolkit-direct' && (!explicitCapacity || choices.claudeAgentCapacity === 'keep')) {
    const compatibleKeep = currentProfile.supported === true && currentProfile.topology === agentControl.TOPOLOGIES.CLAUDE_DIRECT
      && [agentControl.CAPACITY_MODES.AUTO, agentControl.CAPACITY_MODES.MANUAL].includes(currentProfile.capacity_mode);
    choices.claudeAgentCapacity = explicitCapacity && choices.claudeAgentCapacity === 'keep' && compatibleKeep ? 'keep' : 'automatic';
  }
}

function resolveClaudeTopologyCapacity(args, current) {
  reconcileClaudeQuestionChoices(args, current);
  const profile = current.agentProfile || agentControl.readProfile('claude-code');
  const topologyChoice = args.setupChoices.claudeTopology || 'keep';
  const capacityChoice = args.setupChoices.claudeAgentCapacity || 'keep';
  // A direct selection authorizes post-approval verification; it never turns
  // an observational snapshot into an optimistic capability claim.
  let topology = topologyChoice === 'keep' && profile.supported === true ? profile.topology
    : ({ 'toolkit-direct': agentControl.TOPOLOGIES.CLAUDE_DIRECT, 'root-only': agentControl.TOPOLOGIES.ROOT_ONLY, 'broader-native': agentControl.TOPOLOGIES.BROADER_NATIVE }[topologyChoice] || agentControl.TOPOLOGIES.ROOT_ONLY);
  if (capacityChoice === 'root-only' && topology !== agentControl.TOPOLOGIES.BROADER_NATIVE) topology = agentControl.TOPOLOGIES.ROOT_ONLY;
  let capacityMode;
  if (topology !== agentControl.TOPOLOGIES.CLAUDE_DIRECT) capacityMode = agentControl.CAPACITY_MODES.ROOT_ONLY;
  else if (capacityChoice === 'keep' && profile.supported === true && profile.topology === topology
    && [agentControl.CAPACITY_MODES.AUTO, agentControl.CAPACITY_MODES.MANUAL].includes(profile.capacity_mode)) capacityMode = profile.capacity_mode;
  else capacityMode = capacityChoice === 'manual' ? agentControl.CAPACITY_MODES.MANUAL : agentControl.CAPACITY_MODES.AUTO;
  const manualMaximum = capacityMode === agentControl.CAPACITY_MODES.MANUAL ? (args.claudeManualMaximum ?? profile.manual_maximum) : 0;
  if (capacityMode === agentControl.CAPACITY_MODES.MANUAL && (!Number.isSafeInteger(manualMaximum) || manualMaximum < 1 || manualMaximum > agentControl.MAX_MANUAL_WORKERS)) {
    throw new Error('Manual Claude agent maximum is outside the supported bounds.');
  }
  if (capacityMode === agentControl.CAPACITY_MODES.MANUAL) args.claudeManualMaximum = manualMaximum;
  args.setupChoices.claudeTopology = topology === agentControl.TOPOLOGIES.CLAUDE_DIRECT ? 'toolkit-direct' : (topology === agentControl.TOPOLOGIES.BROADER_NATIVE ? 'broader-native' : 'root-only');
  args.setupChoices.claudeAgentCapacity = capacityMode === agentControl.CAPACITY_MODES.AUTO ? 'automatic' : (capacityMode === agentControl.CAPACITY_MODES.MANUAL ? 'manual' : 'root-only');
  return { topology, capacity_mode: capacityMode, manual_maximum: manualMaximum };
}

function currentHelperOutcome(current) {
  const helperCount = current.delegation?.helper_count;
  if (Number.isSafeInteger(helperCount)) {
    if (helperCount === 0) return 'Codex currently works without helper agents.';
    if (helperCount === 1) return 'Codex currently allows one helper at most.';
    return `Codex currently allows up to ${helperCount} helpers. Risk: this may use substantial memory or make the computer unresponsive.`;
  }
  if (current.runtime?.runtime === RUNTIMES.DISABLED) return 'Helper agents are currently unavailable.';
  if (current.runtime?.runtime === RUNTIMES.UNKNOWN) return 'The current helper limit could not be verified safely, so setup will not guess.';
  return 'No effective helper limit is currently configured.';
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

function currentBooleanOutcome(value, enabledText, disabledText, unknownText) {
  if (value === true) return enabledText;
  if (value === false) return disabledText;
  return unknownText;
}

function targetCurrentOutcome(target, appName) {
  if (!target || (target.detected !== true && target.enabled !== true)) {
    return `${appName} integration state could not be verified; setup will not assume that Toolkit is installed there.`;
  }
  if (target.enabled === true && target.synced === true) return `Toolkit synchronization is enabled and the managed ${appName} files are current.`;
  if (target.enabled === true) return `Toolkit synchronization is enabled, but the managed ${appName} files are stale or could not be verified as current.`;
  if (target.explicitly_disabled === true) return `Toolkit synchronization is turned off for ${appName}; existing files, if any, are left in place.`;
  return `${appName} was detected, but Toolkit synchronization is not enabled.`;
}

function helperRecommendationReason(current, runtimeSupported, migrationPending) {
  if (migrationPending) return 'Preserving the exact legacy setting avoids changing native Codex configuration until you explicitly approve its migration.';
  if (!runtimeSupported) return 'Toolkit cannot safely map a new limit to unavailable or unverifiable native helper controls.';
  return 'Codex cannot currently prove Toolkit-controlled admission or enforce medium, non-fast execution for every helper and nested-helper path.';
}

function setupQuestionSpecs(args, current) {
  const managedRecommendation = recommendedChoice('managedCheckout', current, args);
  const managedCurrent = currentManagedSourceOutcome(current, args);
  const retentionRaw = current?.audit?.update_report_retention_days;
  const retentionCurrent = Number.isSafeInteger(retentionRaw) && retentionRaw > 0
    ? `Toolkit maintenance reports are currently kept for ${retentionRaw} day(s).`
    : `The saved retention duration could not be verified; the effective safe fallback is ${DEFAULT_UPDATE_REPORT_RETENTION_DAYS} days.`;
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
          ? [wizardChoice('keep', 'Keep the current update source', `Preserve this effective behavior: ${managedCurrent}`)]
          : []),
        wizardChoice('custom', 'Choose another location', 'Create or reuse a clean Toolkit checkout at the approved location and make that location the managed update source; existing managed copies are not migrated or deleted.'),
      ],
      recommendation: {
        value: managedRecommendation,
        outcome: managedRecommendation === 'keep'
          ? 'Keep using the verified dedicated clean managed copy.'
          : 'Use the standard dedicated clean managed copy.',
        reason: 'Separating update operations from active branches and uncommitted project work makes fetch, verification, and safe activation predictable.',
      },
      selected: args.setupChoices.managedCheckout,
      current: managedCurrent,
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
        wizardChoice('enable', 'Turn on', 'Store automatic maintenance as enabled so trusted startup maintenance checks for, verifies, and safely activates clean updates.'),
        wizardChoice('disable', 'Turn off', 'Disable startup update checks and automatic enabled-target synchronization; manual `setup toolkit` or explicit maintenance remains available.'),
        wizardChoice('keep', 'Keep current', `Preserve this effective behavior: ${currentBooleanOutcome(current.audit?.repo_auto_update?.enabled, 'Automatic startup update checks are on.', 'Automatic startup update checks are off; manual setup remains available.', 'The automatic-update state could not be verified; setup will not claim that startup updates are active.')}`),
      ],
      recommendation: {
        value: recommendedChoice('repoAutoUpdate', current, args),
        outcome: 'Turn on clean, verified automatic updates.',
        reason: 'Startup checks keep Toolkit current while the clean-checkout, expected-remote, fast-forward, and validation gates protect active work.',
      },
      selected: args.setupChoices.repoAutoUpdate,
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
      whatThisControls: 'Whether Toolkit keeps a privacy-safe maintenance report when an update, cache refresh, hook repair, target sync, or safety stop produced meaningful information. Routine successful maintenance stays quiet; failures needing action may open automatically, and routine output does not print private absolute paths.',
      choices: [
        wizardChoice('enable', 'Keep reports', 'Create deduplicated reports for meaningful maintenance, keep successful reports closed, and automatically open only reports classified as requiring action.'),
        wizardChoice('disable', 'Do not keep reports', 'Stop creating normal Toolkit maintenance reports; concise failure or safety status still appears when action is required.'),
        wizardChoice('keep', 'Keep current', `Preserve this effective behavior: ${currentBooleanOutcome(current.audit?.update_report_enabled, 'Meaningful maintenance reports are kept; only action-required reports open automatically.', 'Maintenance reports are disabled.', 'The saved report setting could not be verified; the effective default is to keep meaningful reports.')}`),
      ],
      recommendation: {
        value: recommendedChoice('updateReports', current, args),
        outcome: 'Keep meaningful reports; open only reports that require action.',
        reason: 'A short-lived, privacy-safe record makes failed or safety-blocked maintenance diagnosable without making routine success noisy.',
      },
      selected: args.setupChoices.updateReports,
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
      recommendation: {
        value: recommendedChoice('updateReportRetention', current, args),
        outcome: currentReportRetentionDays(current) === DEFAULT_UPDATE_REPORT_RETENTION_DAYS
          ? 'Keep the effective seven-day retention window.'
          : 'Use a seven-day retention window.',
        reason: 'Seven days normally preserves enough troubleshooting context while limiting accumulation of maintenance-only reports.',
      },
      selected: args.setupChoices.updateReportRetention,
      current: retentionCurrent,
      currentVerification: Number.isSafeInteger(retentionRaw) && retentionRaw > 0 ? 'verified' : 'defaulted',
      afterApplying: 'The approved duration is stored in Toolkit state. Eligible Toolkit maintenance-report cleanup runs during the approved setup and future maintenance; unrelated files are never included.',
    })
  ];

  if (args.host === 'codex') {
    // Ordinary setup never asks users to choose helper quantities. Existing explicit
    // or saved state is preserved; otherwise fail closed to root-only until a
    // Toolkit-controlled launch path proves live memory admission.
    if (!args.setupChoices.codexHelperCapacity) {
      const unsafeV2Shape = current.delegation?.layout?.multiAgentV2Tables?.length > 1
        || current.delegation?.layout?.multiAgentV2Children?.length > 0;
      args.setupChoices.codexHelperCapacity = unsafeV2Shape
        || (current.delegation?.status === 'unconfigured' && [RUNTIMES.V1, RUNTIMES.V2].includes(current.runtime?.runtime))
        ? 'root-only'
        : 'keep';
    }
    specs.push(resolvedQuestion({
      id: 'codex-toolkit-maintenance',
      key: 'codexPluginAutoRefresh',
      section: 'Computer performance',
      title: 'Codex Toolkit maintenance',
      prompt: 'Codex plugin maintenance choice',
      whatThisControls: 'Whether trusted Codex startup maintenance may refresh the installed Toolkit plugin cache from the verified managed source and, on Windows, safely repair incompatible installed plugin SessionStart hook launchers. It does not give Codex permission to update Claude Code.',
      choices: [
        wizardChoice('enable', 'Turn on', 'Enable future native Toolkit cache refresh and safe Windows installed-hook repair when maintenance detects stale or incompatible files.'),
        wizardChoice('disable', 'Turn off', 'Disable future automatic cache refresh and Windows hook repair; the installed Toolkit plugin is not uninstalled, and manual `setup toolkit` repair or refresh remains available.'),
        wizardChoice('keep', 'Keep current', `Preserve this effective behavior: ${currentBooleanOutcome(current.audit?.codex_plugin_auto_refresh_enabled, 'Automatic Codex Toolkit maintenance is on.', 'Automatic Codex Toolkit maintenance is off; the installed plugin remains in place.', 'The automatic Codex maintenance preference could not be verified; setup will not claim that it is active.')}`),
      ],
      recommendation: {
        value: recommendedChoice('codexPluginAutoRefresh', current, args),
        outcome: 'Turn on native Toolkit cache refresh and safe Windows hook maintenance.',
        reason: 'Keeping the installed cache aligned with the verified managed source avoids stale setup behavior after Toolkit updates.',
      },
      selected: args.setupChoices.codexPluginAutoRefresh,
      current: currentBooleanOutcome(current.audit?.codex_plugin_auto_refresh_enabled, 'Automatic Codex Toolkit maintenance is on.', 'Automatic Codex Toolkit maintenance is off; the installed plugin remains in place.', 'The automatic Codex maintenance preference could not be verified; setup will not claim that it is active.'),
      currentVerification: typeof current.audit?.codex_plugin_auto_refresh_enabled === 'boolean' ? 'verified' : 'unverified',
      afterApplying: 'The approved setup always verifies the current native Toolkit plugin. If files change, setup may update the Codex plugin cache and Windows hook launchers; restart Codex, then review and trust the current SessionStart hook in `/hooks`. Turning maintenance off only changes future Toolkit state and does not uninstall the plugin.',
    }));
  } else {
    const capabilitySupported = strictClaudeSetupCapability(current);
    const activeProfile = current.agentProfile || agentControl.readProfile('claude-code');
    specs.push(resolvedQuestion({
      id: 'claude-agent-topology',
      key: 'claudeTopology',
      section: 'Computer performance',
      title: 'How should Claude Code use agents?',
      prompt: 'Claude Code agent topology choice',
      whatThisControls: 'Whether Claude Code remains root-only, uses only directly controlled Toolkit workers, or permits broader native agent behavior. Broader native agents remain outside Toolkit resource admission.',
      choices: [
        wizardChoice('toolkit-direct', 'Direct Toolkit-managed subagents only', capabilitySupported
          ? 'Allow only direct Toolkit-controlled workers with verified resource admission and native Agent/Task bypass blocked.'
          : 'Request direct Toolkit-controlled workers; setup verifies current active Toolkit bytes and exact worker/checker launches only after approval, and otherwise leaves root-only active.'),
        wizardChoice('root-only', 'Root agent only', 'Use no helper agents under the Toolkit profile.'),
        wizardChoice('broader-native', 'Broader native behaviour', 'Permit native Claude agent behavior outside Toolkit admission and its resource guarantees.'),
        wizardChoice('keep', 'Keep current', `Preserve the effective ${activeProfile.topology || 'root-only'} topology when it remains supported; stale or unverifiable strict state falls back safely to root-only.`),
      ],
      recommendation: {
        value: recommendedChoice('claudeTopology', current, args),
        outcome: capabilitySupported ? 'Use direct Toolkit-managed subagents with native Agent launches blocked.' : 'Use the root agent only until every strict launch control is verifiable.',
        reason: capabilitySupported ? 'The detected CLI, installed bytes, trust, active hook, and resource counters satisfy the strict direct-worker boundary.' : 'Unavailable or stale capability proof cannot safely support a strict direct-worker claim.',
      },
      selected: args.setupChoices.claudeTopology,
      current: `Current topology: ${activeProfile.topology || 'root-only'}.`,
      afterApplying: 'A changed choice updates only the Claude Toolkit profile. A fresh Claude Code session may be required before relying on changed native hook behavior.',
      availability: { status: capabilitySupported ? 'available' : 'post-approval-verification-required', condition: capabilitySupported ? 'Existing strict proof is present, but exact launch capability is reverified after approval.' : 'Direct mode is selectable as a request but remains inactive unless every post-approval gate verifies.' },
    }));
    // Capacity is derived only after the visible topology answer is known. Rendering
    // this bank cannot create hidden state that later overrides the user's choice.
    specs.push(resolvedQuestion({
      id: 'claude-toolkit-plugin',
      key: 'claudePluginBehavior',
      section: 'Other coding apps',
      title: 'Keep Toolkit available in Claude Code?',
      prompt: 'Claude Code Toolkit choice',
      whatThisControls: 'Whether Claude Code installs or refreshes its own Toolkit plugin, shows manual instructions, or preserves current plugin state. This never changes Codex.',
      choices: [wizardChoice('install', 'Install or refresh', 'Use Claude Code native plugin commands to verify and refresh its Toolkit cache when needed.'), wizardChoice('instructions', 'Show instructions only', 'Make no native plugin change and report the manual Claude Code action required.'), wizardChoice('keep', 'Keep current', 'Preserve the currently detected Claude Code plugin behavior and state.')],
      recommendation: { value: recommendedChoice('claudePluginBehavior', current, args), outcome: 'Let Claude Code install or refresh its own Toolkit plugin.', reason: 'Native host commands keep cache identity, version, and hooks aligned without cross-host mutation.' },
      selected: args.setupChoices.claudePluginBehavior,
      current: current.nativePlugin.status === 'fresh' ? 'The Claude Code Toolkit plugin is current.' : 'The Claude Code Toolkit plugin may need attention.',
      afterApplying: 'If native plugin files change, restart Claude Code and complete any native trust or activation steps reported by setup.',
    }));
  }

  if (current.audit?.targets?.opencode?.detected || current.audit?.targets?.opencode?.enabled) {
    const target = current.audit.targets.opencode;
    const targetCurrent = targetCurrentOutcome(target, 'OpenCode');
    specs.push(resolvedQuestion({
      id: 'opencode-integration',
      key: 'opencodeTarget',
      section: 'Other coding apps',
      title: 'OpenCode',
      prompt: 'OpenCode Toolkit choice',
      whatThisControls: "Whether Toolkit synchronizes its managed skill folders and OpenCode adapter into OpenCode's user-level skills area. This configures Toolkit integration files only; it does not install or update OpenCode itself.",
      choices: [
        wizardChoice('enable-sync', 'Keep synchronized', 'Enable the integration and immediately synchronize current Toolkit skill folders plus the OpenCode adapter after final approval.'),
        wizardChoice('disable', 'Turn off', 'Disable future Toolkit synchronization without uninstalling OpenCode or deleting already synchronized files.'),
        wizardChoice('keep', 'Keep current', `Preserve this effective behavior: ${targetCurrent}`),
        wizardChoice('skip', 'Skip this time', 'Make no OpenCode target-state or file change during this setup; any previously enabled future synchronization setting remains as it was.'),
      ],
      recommendation: {
        value: recommendedChoice('opencodeTarget', current, args),
        outcome: target.enabled ? 'Keep the current OpenCode integration setting.' : 'Keep OpenCode unchanged unless you intentionally enable Toolkit synchronization.',
        reason: target.enabled ? 'The existing opt-in remains the least surprising choice while preserving current managed behavior.' : 'Detection alone is not consent to write user-level OpenCode files.',
      },
      selected: args.setupChoices.targets.opencode,
      current: targetCurrent,
      currentVerification: target.detected === true || target.enabled === true ? 'state-derived' : 'unverified',
      afterApplying: 'Enable writes the managed OpenCode skill folders immediately after final approval; disable changes Toolkit target state but leaves existing files in place. Reopen or refresh OpenCode if it does not reload changed skills automatically.',
      availability: { status: target.detected === true ? 'available' : 'persisted-state-only', condition: 'This row appears only when OpenCode is detected or Toolkit already has enabled state for it.' },
    }));
  }
  if (current.audit?.targets?.ag2?.detected || current.audit?.targets?.ag2?.enabled) {
    const target = current.audit.targets.ag2;
    const targetCurrent = targetCurrentOutcome(target, 'Antigravity');
    specs.push(resolvedQuestion({
      id: 'antigravity-integration',
      key: 'ag2Target',
      section: 'Other coding apps',
      title: 'Antigravity',
      prompt: 'Antigravity Toolkit choice',
      whatThisControls: 'Whether Toolkit synchronizes an Antigravity plugin-scoped integration containing plugin metadata, installed-version metadata, the Toolkit adapter, and managed skill folders. This does not install Antigravity or the optional Python AG2 package.',
      choices: [
        wizardChoice('enable-sync', 'Keep synchronized', 'Enable the integration and immediately refresh Toolkit-owned Antigravity plugin metadata, adapter files, and managed skill folders after final approval.'),
        wizardChoice('disable', 'Turn off', 'Disable future Toolkit synchronization without uninstalling Antigravity or deleting already synchronized plugin files.'),
        wizardChoice('keep', 'Keep current', `Preserve this effective behavior: ${targetCurrent}`),
        wizardChoice('skip', 'Skip this time', 'Make no Antigravity target-state or plugin-file change during this setup; any previously enabled future synchronization setting remains as it was.'),
      ],
      recommendation: {
        value: recommendedChoice('ag2Target', current, args),
        outcome: target.enabled ? 'Keep the current Antigravity integration setting.' : 'Keep Antigravity unchanged unless you intentionally enable Toolkit synchronization.',
        reason: target.enabled ? 'The existing opt-in remains the least surprising choice while preserving current managed behavior.' : 'Detection alone is not consent to write an Antigravity plugin-scoped folder.',
      },
      selected: args.setupChoices.targets.ag2,
      current: targetCurrent,
      currentVerification: target.detected === true || target.enabled === true ? 'state-derived' : 'unverified',
      afterApplying: 'Enable writes the Toolkit-owned Antigravity plugin metadata and skill folders immediately after final approval; disable changes Toolkit target state but leaves existing files in place. Restart or reopen Antigravity if it does not reload plugin files automatically.',
      availability: { status: target.detected === true ? 'available' : 'persisted-state-only', condition: 'This row appears only when Antigravity is detected or Toolkit already has enabled state for it.' },
    }));
  }
  return withPresentationMetadata(specs.map((spec) => ({
    ...spec,
    recommended_value: spec.recommended,
    selected_value: spec.selected,
    empty_input_behavior: spec.recommended,
  })), args.host);
}

function clonedSetupArgs(args) {
  return {
    ...args,
    setupChoices: {
      ...args.setupChoices,
      targets: { ...args.setupChoices.targets },
    },
  };
}

function plannedQuestionBank(args, current) {
  const planned = clonedSetupArgs(args);
  const initialSpecs = setupQuestionSpecs(planned, current);
  assertManagedCheckoutChoiceAvailable(planned, initialSpecs);
  for (const spec of initialSpecs) {
    if (!choiceForKey(planned, spec.key)) assignChoice(planned, spec.key, spec.recommended);
  }
  if (planned.host === 'claude-code') resolveClaudeTopologyCapacity(planned, current);
  const resolvedSpecs = setupQuestionSpecs(planned, current);
  assertManagedCheckoutChoiceAvailable(planned, resolvedSpecs);
  return {
    args: planned,
    specs: resolvedSpecs.map((spec) => ({ ...spec, empty_input: spec.recommended })),
  };
}

function renderQuestionRows(specs) {
  specs = ensurePresentationMetadata(specs);
  const lines = [];
  let section = '';
  for (const spec of specs) {
    if (spec.section !== section) {
      if (lines.length) lines.push('');
      section = spec.section;
      lines.push(`## ${spec.presentation.section_index}. ${section}`, '');
    }
    lines.push(`### ${spec.presentation.question_ref} ${spec.title}`);
    lines.push('');
    lines.push(`**What this controls:** ${spec.whatThisControls}`);
    lines.push('');
    lines.push(`**Current:** ${spec.current}`);
    lines.push('');
    lines.push(`**Verification:** ${spec.currentState?.verification || 'unverified'}`);
    lines.push('');
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

function renderQuestionBankHeader(specs, markdown = true) {
  const questionCount = specs[0]?.presentation.total_visible_question_count || 0;
  const sectionCount = specs[0]?.presentation.total_visible_section_count || 0;
  const heading = `Toolkit setup choices - ${questionCount} questions across ${sectionCount} sections`;
  const bankReference = specs[0]?.presentation.bank_reference || '';
  const lines = [markdown ? `# ${heading}` : heading, '', `Bank reference: ${bankReference}`, '', 'Quick index', ''];
  for (const spec of specs) {
    lines.push(`${spec.presentation.question_ref} ${spec.title} - Recommended: ${spec.presentation.recommended_choice_ref} - ${choiceLabel(spec, spec.recommended)}`);
  }
  lines.push('');
  return lines;
}

function changedOnlyExample(specs) {
  const preferred = ['automatic-updates', 'opencode-integration'];
  const picked = preferred.map((id) => specs.find((spec) => spec.id === id)).filter(Boolean);
  for (const spec of specs) {
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
  const unresolved = specs.filter((spec) => !choiceForKey(args, spec.key));
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
      validation_contract: 'non-negative integer helper count',
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
    {
      owner_question_id: 'claude-agent-capacity', detail_type: 'claude-manual-maximum',
      activation_key: 'claudeAgentCapacity', activation_value: 'manual',
      supplied: () => args.claudeManualMaximum !== null,
      validation_contract: 'positive integer worker maximum',
      description: 'positive manual Claude worker maximum',
      missing_message: 'Setup question bank requires the manual Claude capacity detail as a positive maximum line.',
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
  if (entry.detail_type === 'claude-manual-maximum') return args.claudeManualMaximum === null;
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
  if (entry.detail_type === 'claude-manual-maximum') return `${args.claudeManualMaximum} worker(s)`;
  throw new Error(`Unsupported setup answer-plan detail type: ${entry.detail_type}`);
}

function renderAnswerGuide(specs, markdown = true, mode = 'non-tty', options = {}) {
  const example = changedOnlyExample(specs);
  const bankReference = specs[0]?.presentation.bank_reference || '';
  if (mode === 'tty') {
    return [
      'After this complete bank, enter either:',
      '',
      markdown ? '- `all recommended`' : '  - all recommended',
      markdown ? `- only your changes, for example: \`${example}\`` : `  - only your changes, for example: ${example}`,
      markdown ? '- press Enter to answer questions one at a time' : '  - press Enter to answer questions one at a time',
      '',
      'Unspecified changed-only entries use the displayed recommendation for this in-memory bank.',
      'Malformed concise input is rejected and can be corrected before any setup write.',
      'Choice letters and existing canonical textual values remain supported in one-at-a-time mode.',
    ];
  }
  if (mode === 'tty-one-at-a-time') {
    return [
      'After this complete bank, answer unresolved questions one at a time.',
      'Displayed choice letters and existing canonical textual values are accepted; invalid input is re-prompted before any setup write.',
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
  const lines = [
    'Reply with the displayed bank reference and either:',
    '',
    markdown ? `- \`${bankReference}: all recommended\`` : `  - ${bankReference}: all recommended`,
    markdown ? `- only your changes, for example: \`${bankReference}: ${example}\`` : `  - only your changes, for example: ${bankReference}: ${example}`,
    '',
    'Unspecified entries in the changed-only form mean: apply the displayed recommendation for that exact rendered question.',
    'The bank reference binds indexed input to this exact displayed host, order, state, recommendations, and choices.',
    'Missing, stale, partial, malformed, timed-out, or EOF input never means all recommended and fails before setup writes.',
    'Existing canonical textual values, complete line-by-line answers, explicit setup flags, and explicit --yes-recommended remain supported.',
  ];
  return lines;
}

function renderSetupQuestionBankTerminal(specs, options = {}) {
  specs = ensurePresentationMetadata(specs);
  const lines = [
    QUESTION_BANK_BEGIN,
    ...renderQuestionBankHeader(specs, false),
    'Review every visible choice before setup writes anything.',
  ];
  let section = '';
  for (const spec of specs) {
    if (spec.section !== section) {
      section = spec.section;
      const heading = `${spec.presentation.section_index}. ${section}`;
      lines.push('', heading, '='.repeat(heading.length));
    }
    lines.push('', `${spec.presentation.question_ref} ${spec.title}`, '', `What this controls: ${spec.whatThisControls}`, '');
    lines.push(`Current: ${spec.current}`);
    lines.push('');
    lines.push(`Verification: ${spec.currentState?.verification || 'unverified'}`);
    lines.push('');
    lines.push(`Recommended: ${spec.presentation.recommended_choice_ref} - ${choiceLabel(spec, spec.recommended)}`);
    lines.push('');
    lines.push(`Recommended outcome: ${spec.recommended_outcome}`);
    lines.push('');
    lines.push(`Why: ${spec.recommendation_reason}`);
    lines.push('');
    lines.push('Choices:');
    for (const choice of spec.choices) lines.push(`  ${choice.presentation_ref}. ${choice.label} - ${choice.consequence}`);
    if (spec.afterApplying) lines.push('', `After applying: ${spec.afterApplying}`);
    const selectedValue = spec.selected || spec.empty_input || '';
    lines.push('');
    lines.push(`Selected: ${selectedValue
      ? `${choiceReference(spec, selectedValue)} - ${choiceLabel(spec, selectedValue)}`
      : '(answer required)'}`);
  }
  const guideMode = options.answerMode
    || (options.conciseCommands === false ? 'tty-one-at-a-time' : 'tty');
  lines.push('', ...renderAnswerGuide(specs, false, guideMode), '', QUESTION_BANK_COMPLETE, '');
  return lines.join('\n');
}

function renderSetupQuestionBank(specs, options = {}) {
  specs = ensurePresentationMetadata(specs);
  return [
    QUESTION_BANK_BEGIN,
    ...renderQuestionBankHeader(specs, true),
    'Review every visible choice before setup writes anything.',
    '',
    renderQuestionRows(specs),
    '',
    ...renderAnswerGuide(specs, true, options.answerMode || 'non-tty', options),
    QUESTION_BANK_COMPLETE,
    '',
  ].join('\n');
}

function setupQuestionDocumentationSpecs() {
  const args = parseArgs(['--plan', '--host', 'codex']);
  const managedPath = defaultManagedSourcePath();
  const current = {
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
      codex_plugin_auto_refresh_enabled: true,
      targets: {
        opencode: { detected: true, enabled: true, synced: true, explicitly_disabled: false },
        ag2: { detected: true, enabled: true, synced: true, explicitly_disabled: false },
      },
    },
    runtime: { runtime: RUNTIMES.V2, detector: 'documentation fixture' },
    delegation: { status: 'configured', ownership: 'toolkit-managed-v2', helper_count: 0, detail: 'documentation fixture' },
    nativePlugin: { status: 'fresh' },
  };
  return plannedQuestionBank(args, current).specs;
}

function renderSetupQuestionDocumentation(specs = setupQuestionDocumentationSpecs()) {
  specs = ensurePresentationMetadata(specs);
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
  if (key === 'managedCheckout') args.setupChoices.managedCheckout = choice;
  else if (key === 'repoAutoUpdate') args.setupChoices.repoAutoUpdate = choice;
  else if (key === 'updateReports') args.setupChoices.updateReports = choice;
  else if (key === 'updateReportRetention') args.setupChoices.updateReportRetention = choice;
  else if (key === 'codexPluginAutoRefresh') args.setupChoices.codexPluginAutoRefresh = choice;
  else if (key === 'codexHelperCapacity') args.setupChoices.codexHelperCapacity = choice;
  else if (key === 'claudeTopology') {
    args.setupChoices.claudeTopology = choice;
    args.claudeTopologyRequested = choice;
  }
  else if (key === 'claudeAgentCapacity') args.setupChoices.claudeAgentCapacity = choice;
  else if (key === 'claudePluginBehavior') args.setupChoices.claudePluginBehavior = choice;
  else if (key === 'opencodeTarget') args.setupChoices.targets.opencode = choice;
  else if (key === 'ag2Target') args.setupChoices.targets.ag2 = choice;
}

function choiceForKey(args, key) {
  if (key === 'managedCheckout') return args.setupChoices.managedCheckout;
  if (key === 'repoAutoUpdate') return args.setupChoices.repoAutoUpdate;
  if (key === 'updateReports') return args.setupChoices.updateReports;
  if (key === 'updateReportRetention') return args.setupChoices.updateReportRetention;
  if (key === 'codexPluginAutoRefresh') return args.setupChoices.codexPluginAutoRefresh;
  if (key === 'codexHelperCapacity') return args.setupChoices.codexHelperCapacity;
  if (key === 'claudeTopology') return args.setupChoices.claudeTopology;
  if (key === 'claudeAgentCapacity') return args.setupChoices.claudeAgentCapacity;
  if (key === 'claudePluginBehavior') return args.setupChoices.claudePluginBehavior;
  if (key === 'opencodeTarget') return args.setupChoices.targets.opencode;
  if (key === 'ag2Target') return args.setupChoices.targets.ag2;
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

function looksLikeConciseQuestionBankAnswer(value) {
  const text = String(value || '').trim();
  return /all\s+recommended/i.test(text) || /^\d+\.\d+\s*=/.test(text);
}

function looksLikeConciseSubmission(value) {
  const text = String(value || '').trim();
  if (/^all\s+recommended(?:\s*$|\s*,)/i.test(text) || /^\d+\.\d+\s*=/.test(text)) return true;
  const envelope = text.match(/^[^:\s]+\s*:\s*([\s\S]+)$/);
  return Boolean(envelope && (/^all\s+recommended(?:\s*$|\s*,)/i.test(envelope[1].trim())
    || /^\d+\.\d+\s*=/.test(envelope[1].trim())));
}

function parseConciseQuestionBankAnswer(input, specs, options = {}) {
  const text = String(input || '').trim();
  if (!text) return null;
  const expectedReference = specs[0]?.presentation.bank_reference || '';
  const requireBankReference = options.requireBankReference !== false;
  let suppliedReference = expectedReference;
  let answerText = text;
  if (requireBankReference) {
    const envelope = text.match(/^([^:\s]+)\s*:\s*([\s\S]+)$/);
    if (!envelope) {
      if (looksLikeConciseQuestionBankAnswer(text)) {
        throw new Error(`Concise setup answers require the displayed bank reference. Reply with ${expectedReference}: followed by all recommended or indexed changes.`);
      }
      return null;
    }
    // A drive-letter path or another canonical line-by-line value may contain
    // a colon. Treat it as an approval envelope only when the payload is
    // recognizably one of the bounded concise answer modes.
    if (!looksLikeConciseQuestionBankAnswer(envelope[2])) return null;
    suppliedReference = normalizeBankReference(envelope[1]);
    if (!suppliedReference) throw new Error('Setup question bank reference is malformed or truncated; copy the complete displayed reference and retry before any setup write.');
    if (suppliedReference !== expectedReference) throw new Error('Setup question bank reference is stale or belongs to a different rendered bank; review the current bank and answer with its displayed reference.');
    answerText = envelope[2].trim();
  } else {
    const optionalEnvelope = text.match(/^([^:\s]+)\s*:\s*([\s\S]+)$/);
    if (optionalEnvelope) {
      const normalized = normalizeBankReference(optionalEnvelope[1]);
      if (!normalized || normalized !== expectedReference) {
        throw new Error('Setup question bank reference does not match this live rendered bank.');
      }
      suppliedReference = normalized;
      answerText = optionalEnvelope[2].trim();
    }
  }
  if (/^all\s+recommended$/i.test(answerText)) {
    return {
      mode: 'all-recommended',
      binding_mode: requireBankReference ? 'displayed-reference' : 'same-process',
      bank_reference: suppliedReference,
      bank_identity: specs[0]?.presentation.bank_identity || questionBankSemanticIdentity(specs),
      selections: specs.map((spec) => ({
        question_id: spec.id,
        question_ref: spec.presentation.question_ref,
        choice_ref: spec.presentation.recommended_choice_ref,
        canonical_value: spec.recommended,
      })),
    };
  }
  if (/all\s+recommended/i.test(answerText)) {
    throw new Error('Setup question bank answer mixes or malforms the all recommended mode.');
  }
  if (!/^\d+\.\d+\s*=\s*[A-Za-z]{1,2}(?:\s*,\s*\d+\.\d+\s*=\s*[A-Za-z]{1,2})*$/.test(answerText)) {
    if (/\d+\.\d+\s*=/.test(answerText)) {
      throw new Error('Setup question bank changed-only answer has malformed separators or mixed answer modes.');
    }
    return null;
  }
  const byReference = new Map(specs.map((spec) => [spec.presentation.question_ref, spec]));
  const seen = new Set();
  const overrides = [];
  for (const token of answerText.split(',')) {
    const match = token.trim().match(/^(\d+\.\d+)\s*=\s*([A-Za-z]{1,2})$/);
    if (!match) throw new Error('Setup question bank changed-only answer has malformed separators.');
    const [, questionRef, rawChoiceRef] = match;
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
    bank_identity: specs[0]?.presentation.bank_identity || questionBankSemanticIdentity(specs),
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
  const presented = choiceByPresentationReference(spec, normalized);
  if (presented) return presented.value;
  const canonical = spec.choices.find((choice) => choice.value.toLowerCase() === normalized.toLowerCase());
  return canonical?.value || normalized.toLowerCase();
}

async function promptForChoice(spec, lines, rl) {
  if (lines) {
    if (!lines.length) throw new Error(`Setup question bank requires an answer for ${spec.title}`);
    return resolveDisplayedChoiceAnswer(spec, lines.shift());
  }
  for (;;) {
    const range = `${spec.choices[0].presentation_ref}-${spec.choices.at(-1).presentation_ref}`;
    const answer = await rl.question(`${spec.presentation.question_ref} ${spec.title} [${range}] (letter or canonical value; Enter=${spec.presentation.recommended_choice_ref}): `);
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
      console.log('Enter exactly "all recommended", indexed changes such as 1.2=B, or press Enter for one-at-a-time questions.');
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

async function promptForClaudeManualMaximum(lines, rl) {
  if (lines) {
    const value = nextNonEmptyLine(lines);
    if (!value) throw new Error('Manual Claude agent capacity requires a maximum answer');
    return parsePositiveInteger(value, 'Manual Claude agent maximum');
  }
  for (;;) {
    const answer = (await rl.question('Manual maximum for Toolkit-managed Claude workers: ')).trim();
    try { return parsePositiveInteger(answer, 'Manual Claude agent maximum'); }
    catch (error) { console.log(error.message); }
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
    } else if (entry.detail_type === 'claude-manual-maximum') {
      args.claudeManualMaximum = await promptForClaudeManualMaximum(lines, null);
    } else {
      throw new Error(`Unsupported setup answer-plan detail type: ${entry.detail_type}`);
    }
  }
}

function effectiveChoiceSummary(args, current, spec, value) {
  if (spec.key === 'repoAutoUpdate') return args.repoAutoUpdate ? 'enable' : 'disable';
  if (spec.key === 'updateReports') return args.updateReports ? 'enable' : 'disable';
  if (spec.key === 'updateReportRetention') return `${args.updateReportRetentionDays} days`;
  if (spec.key === 'codexPluginAutoRefresh') return args.codexPluginAutoRefresh ? 'enable' : 'disable';
  if (spec.key === 'claudeTopology' && value === 'toolkit-direct') {
    return strictClaudeSetupCapability(current)
      ? 'requested direct; exact launch and active-plugin verification still rerun after approval'
      : 'request only; root-only remains active unless post-approval verification passes';
  }
  if (spec.key === 'claudeAgentCapacity' && value === 'automatic') {
    return 'automatic requested; the final limit is derived post-approval from verified live capacity';
  }
  return value;
}

async function answerSetupQuestionBank(args, current, options = {}) {
  const isTTY = options.isTTY === undefined ? process.stdin.isTTY === true : options.isTTY === true;
  const initialSpecs = setupQuestionSpecs(args, current);
  assertManagedCheckoutChoiceAvailable(args, initialSpecs);
  const initialMissingCount = initialSpecs.filter((spec) => !choiceForKey(args, spec.key)).length;
  let answerSource = initialMissingCount ? (isTTY ? 'interactive' : 'stdin') : 'explicit flags';
  let completeStdinConsumed = false;

  if (args.yesRecommended) {
    answerSource = 'user-approved yes-recommended';
    for (const spec of initialSpecs) {
      if (!choiceForKey(args, spec.key)) assignChoice(args, spec.key, spec.recommended);
    }
  }

  let specs = setupQuestionSpecs(args, current);
  let missing = specs.filter((spec) => !choiceForKey(args, spec.key));
  let needsCustomPath = args.setupChoices.managedCheckout === 'custom' && !args.repoRootExplicit;
  let needsRetentionDetails = args.setupChoices.updateReportRetention === 'custom' && !args.updateReportRetentionDaysExplicit;
  let needsHelperDetails = args.setupChoices.codexHelperCapacity === 'custom'
    && (args.codexHelperCount === null || (args.codexHelperCount > 1 && !args.approveHighHelperCapacity));
  let needsClaudeManualDetails = args.setupChoices.claudeAgentCapacity === 'manual' && args.claudeManualMaximum === null;
  const needsPromptedAnswers = missing.length > 0 || needsCustomPath || needsRetentionDetails || needsHelperDetails || needsClaudeManualDetails;
  const needsCodexProposalInput = !isTTY && needsPipedCodexProposalApproval(args, current);
  const conciseAllowed = !args.yesRecommended
    && initialMissingCount > 0
    && initialMissingCount === initialSpecs.length;
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

  if (isTTY && missing.length && initialMissingCount === initialSpecs.length) {
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
      missing = specs.filter((spec) => !choiceForKey(args, spec.key));
      needsCustomPath = args.setupChoices.managedCheckout === 'custom' && !args.repoRootExplicit;
      needsRetentionDetails = args.setupChoices.updateReportRetention === 'custom' && !args.updateReportRetentionDaysExplicit;
      needsHelperDetails = args.setupChoices.codexHelperCapacity === 'custom'
        && (args.codexHelperCount === null || (args.codexHelperCount > 1 && !args.approveHighHelperCapacity));
      needsClaudeManualDetails = args.setupChoices.claudeAgentCapacity === 'manual' && args.claudeManualMaximum === null;
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
      missing = specs.filter((spec) => !choiceForKey(args, spec.key));
      needsCustomPath = args.setupChoices.managedCheckout === 'custom' && !args.repoRootExplicit;
      needsRetentionDetails = args.setupChoices.updateReportRetention === 'custom' && !args.updateReportRetentionDaysExplicit;
      needsHelperDetails = args.setupChoices.codexHelperCapacity === 'custom'
        && (args.codexHelperCount === null || (args.codexHelperCount > 1 && !args.approveHighHelperCapacity));
      needsClaudeManualDetails = args.setupChoices.claudeAgentCapacity === 'manual' && args.claudeManualMaximum === null;
      const detailInstructions = [];
      if (needsCustomPath) detailInstructions.push('Choose another update location requires `--repo-root <path>` or complete line-by-line input.');
      if (needsRetentionDetails) detailInstructions.push('Choose another report-retention duration requires `--update-report-retention-days <positive-days>` or complete line-by-line input.');
      if (needsHelperDetails) detailInstructions.push('The selected helper compatibility choice requires its explicit bounded helper details.');
      if (needsClaudeManualDetails) detailInstructions.push('Manual Claude capacity requires `--claude-agent-maximum <positive-number>`.');
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
    missing = specs.filter((spec) => !choiceForKey(args, spec.key));
    needsCustomPath = args.setupChoices.managedCheckout === 'custom' && !args.repoRootExplicit;
    needsRetentionDetails = args.setupChoices.updateReportRetention === 'custom' && !args.updateReportRetentionDaysExplicit;
    needsHelperDetails = args.setupChoices.codexHelperCapacity === 'custom'
      && (args.codexHelperCount === null || (args.codexHelperCount > 1 && !args.approveHighHelperCapacity));
    needsClaudeManualDetails = args.setupChoices.claudeAgentCapacity === 'manual' && args.claudeManualMaximum === null;
  }

  if (args.yesRecommended) {
    console.log('--yes-recommended selected; setup will apply these choices before writing.');
    console.log('');
  }
  if (missing.length) {
    console.log('');
    console.log('Answer the remaining setup choices now. Setup will not write preferences or targets before these answers are complete.');
  }

  const remainingPromptedAnswers = missing.length > 0 || needsCustomPath || needsRetentionDetails || needsHelperDetails || needsClaudeManualDetails;
  if (remainingPromptedAnswers && !lines && !rl) {
    rl = options.createReadlineInterface
      ? options.createReadlineInterface()
      : readline.createInterface({ input: process.stdin, output: process.stdout });
  }
  try {
    for (const spec of missing) {
      const answer = await promptForChoice(spec, lines, rl);
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
    if (args.setupChoices.claudeAgentCapacity === 'manual' && args.claudeManualMaximum === null) {
      args.claudeManualMaximum = await promptForClaudeManualMaximum(lines, rl);
    }
    if (args.setupChoices.managedCheckout === 'custom' && !args.repoRootExplicit) {
      args.repoRoot = await promptForCustomPath(lines, rl);
      args.repoRootExplicit = true;
    }
  } finally {
    if (rl) rl.close();
  }

  if (lines) completeStdinConsumed = true;

  if (args.host === 'claude-code') resolveClaudeTopologyCapacity(args, current);
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
  for (const spec of confirmedSpecs) {
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
  if (!nonTtyAnswerPlan && args.setupChoices.claudeAgentCapacity === 'manual') console.log(`- Manual Claude worker maximum: ${args.claudeManualMaximum}`);
  if (!nonTtyAnswerPlan && args.setupChoices.codexHelperCapacity === 'custom') {
    console.log(`- Custom Codex helper count: ${args.codexHelperCount}`);
    console.log(`- Total MultiAgentV2 session threads including the main agent: ${args.codexHelperCount + 1}`);
    console.log(`- RAM-risk approval for more than one helper: ${args.codexHelperCount > 1 ? (args.approveHighHelperCapacity ? 'approved' : 'missing') : 'not required'}`);
  }
  return {
    appeared: true,
    answers_initially_required: initialMissingCount > 0 || needsCustomPath || needsRetentionDetails || needsHelperDetails || needsClaudeManualDetails,
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

  args.updateReportOpen = false;

  if (choices.updateReportRetention === 'keep') args.updateReportRetentionDays = currentReportRetentionDays(current);
  else if (choices.updateReportRetention === 'default') args.updateReportRetentionDays = DEFAULT_UPDATE_REPORT_RETENTION_DAYS;

  if (args.host === 'codex') {
    if (choices.codexPluginAutoRefresh === 'keep') args.codexPluginAutoRefresh = current.audit?.codex_plugin_auto_refresh_enabled === true;
    else args.codexPluginAutoRefresh = choices.codexPluginAutoRefresh === 'enable';
  }

  args.enableTargets = [];
  args.disableTargets = [];
  for (const target of SUPPORTED_TARGETS) {
    const choice = choices.targets[target];
    if (choice === 'enable-sync') args.enableTargets.push(target);
    if (choice === 'disable') args.disableTargets.push(target);
  }
  args.repoRoot = path.resolve(args.repoRoot);
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

function setupCodexArgs(args, mode) {
  const extra = [mode, '--json', '--repo-root', args.repoRoot];
  if (args.codexCli) extra.push('--codex-cli', args.codexCli);
  return nodeScriptArgs('repo/scripts/setup-codex-toolkit-plugin.cjs', extra);
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
    throw nativePluginPhaseFailure(platform, phase, result);
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

function runCodexNativePluginSetup(args) {
  const verifySummary = runNativePluginJsonPhase({
    platform: 'Codex',
    phase: 'verification',
    label: 'node repo/scripts/setup-codex-toolkit-plugin.cjs --verify --json',
    args: setupCodexArgs(args, '--verify'),
    cwd: args.repoRoot,
    timeout: 120000,
    allowRefreshRequired: true
  });
  const expectedVersion = expectedToolkitVersion(args.repoRoot, 'codex');
  if (verifySummary) {
    const summary = verifySummary;
    return {
      status: 'already fresh',
      installed: summary.installed === true,
      enabled: summary.enabled === true,
      current: summary.current === true,
      cache_path: summary.cache_root || defaultCodexPluginCachePath(summary.version || expectedVersion),
      expected_version: expectedVersion,
      installed_version: summary.version || expectedVersion,
      updated_this_run: false,
      restart_required: false,
      hook_trust_status: summary.hook_trust_status || 'verification-unavailable',
      hook_execution_status: summary.hook_execution_status || 'verification unavailable; open `/hooks` in Codex',
      hook_trust_action: summary.hook_trust_message || 'Open `/hooks` in Codex and review the current Toolkit SessionStart hook'
    };
  }
  runNativePluginJsonPhase({
    platform: 'Codex',
    phase: 'mutation',
    label: 'node repo/scripts/setup-codex-toolkit-plugin.cjs --write --json',
    args: setupCodexArgs(args, '--write'),
    cwd: args.repoRoot,
    timeout: 180000
  });
  const summary = runNativePluginJsonPhase({
    platform: 'Codex post-mutation',
    phase: 'verification',
    label: 'node repo/scripts/setup-codex-toolkit-plugin.cjs --verify --json',
    args: setupCodexArgs(args, '--verify'),
    cwd: args.repoRoot,
    timeout: 120000
  });
  return {
    status: 'refreshed',
    installed: summary.installed === true,
    enabled: summary.enabled === true,
    current: summary.current === true,
    cache_path: summary.cache_root || defaultCodexPluginCachePath(summary.version || expectedVersion),
    expected_version: expectedVersion,
    installed_version: summary.version || expectedVersion,
    updated_this_run: true,
    restart_required: true,
    hook_trust_status: 'pending-review',
    hook_execution_status: 'skipped until the current hook is reviewed and trusted',
    hook_trust_action: 'Open `/hooks` in Codex, review and trust the current Toolkit SessionStart hook'
  };
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to read JSON ${filePath}: ${error.message}`);
  }
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
  if (/--enable-target|--disable-target|--force-downgrade/.test(command)) {
    throw new Error('Claude Code SessionStart hook must not enable, disable, or force-downgrade targets');
  }
  const agentHookCommands = (hooks?.hooks?.PreToolUse || [])
    .filter((entry) => /(?:^|\|)(?:Agent|Task)(?:\||$)/.test(String(entry?.matcher || '')))
    .flatMap((entry) => Array.isArray(entry.hooks) ? entry.hooks : [])
    .map((entry) => String(entry.command || ''));
  if (!agentHookCommands.some((value) => value.includes('${CLAUDE_PLUGIN_ROOT}/repo/scripts/toolkit-claude-agent-hook.cjs'))) {
    throw new Error('Claude Code plugin hooks must block native Agent launches through toolkit-claude-agent-hook.cjs');
  }
  console.log('Claude Code native plugin metadata verified.');
  console.log('If Claude Code reports the Toolkit plugin is missing, stale, disabled, or untrusted, refresh it through Claude Code native plugin UI/flow. Codex will not mutate Claude Code plugin cache.');
  return {
    status: 'metadata present',
    manifest_path: pluginPath,
    expected_version: expectedToolkitVersion(args.repoRoot, 'claude-code'),
    manifest_version: plugin.version || 'unknown',
    updated_this_run: false,
    restart_required: false,
    hook_trust_action: 'follow Claude Code native plugin trust prompts if shown'
  };
}


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
    return { ...metadata, ...summary, status: summary.enforcement_verified === true ? 'already fresh' : 'needs-review' };
  } catch (error) {
    return { ...metadata, status: 'invalid', current: false, enforcement_verified: false, detail: error.message };
  }
}
function setupClaudeArgs(args, mode) {
  const extra = [mode, '--json', '--repo-root', args.repoRoot];
  if (mode === '--write') extra.push('--scope', 'user');
  if (args.claudeCli) extra.push('--claude-cli', args.claudeCli);
  return nodeScriptArgs('repo/scripts/setup-claude-toolkit-plugin.cjs', extra);
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
      hook_trust_action: 'follow Claude Code native plugin trust prompts if shown'
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
    status: 'refreshed',
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
    hook_trust_action: 'approve the Claude Code plugin trust prompt when Claude Code prompts'
  };
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

function runApprovedTargetSync(args) {
  if (args.disableTargets.length) {
    const disableArgs = [];
    for (const target of args.disableTargets) disableArgs.push('--disable-target', target);
    disableArgs.push('--write');
    runBridgeWrite(args, `node repo/scripts/toolkit-local-bridge.cjs ${disableArgs.join(' ')}`, disableArgs);
  }
  if (args.enableTargets.length) {
    const enableArgs = [];
    for (const target of args.enableTargets) enableArgs.push('--enable-target', target);
    enableArgs.push('--write');
    runBridgeWrite(args, `node repo/scripts/toolkit-local-bridge.cjs ${enableArgs.join(' ')}`, enableArgs);
    runBridgeWrite(args, 'node repo/scripts/toolkit-local-bridge.cjs --sync-enabled --write', ['--sync-enabled', '--write']);
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

function targetChoiceSummary(choice) {
  if (choice === 'keep') return 'kept';
  if (choice === 'skip') return 'skipped';
  if (choice === 'enable-sync') return 'enabled/synced';
  if (choice === 'disable') return 'disabled';
  return 'not touched';
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

function targetActionSummary(choice) {
  return targetChoiceSummary(choice);
}

function printTargetSummary(label, target, choice) {
  console.log(`${label} detected: ${yesNo(target?.detected === true)}`);
  console.log(`${label} enabled: ${yesNo(target?.enabled === true)}`);
  console.log(`${label} synced: ${yesNo(target?.synced === true)}`);
  console.log(`${label} version: ${unknown(target?.synced_version)}`);
  console.log(`${label} path status: ${target?.path || target?.target_path || target?.sync_path ? 'configured' : 'not configured'}`);
  console.log(`${label} status: ${unknown(target?.status)}`);
  console.log(`${label} action this run: ${targetActionSummary(choice)}`);
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

function printFinalSummary({ args, current, managed, nativeCache, delegation, audit, questionBank, validationResults }) {
  const repo = audit?.repo_auto_update || {};
  const cleanup = audit?.update_report_cleanup || {};
  const targets = audit?.targets || {};
  const targetChoices = args.setupChoices?.targets || {};
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
  console.log('Managed checkout default path: %USERPROFILE%\\.ai-agent-toolkit\\source\\ai-agent-toolkit (Windows) or $HOME/.ai-agent-toolkit/source/ai-agent-toolkit (POSIX)');
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
  console.log('Helper-agent capacity questions shown: no; Toolkit automatically limits controlled children from verified available memory.');
  console.log('Preference/target writes before answers: no');
  console.log('');
  if (args.host === 'codex') {
  console.log('## Codex helper agents');
  console.log(`Codex helper-agent runtime: ${unknown(current?.runtime?.runtime || delegation.runtime)}`);
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
  console.log(`PR #237 legacy block migrated: ${yesNo(delegation.migrated_legacy_block === true)}`);
  console.log(`Malformed historical Toolkit marker material repaired: ${yesNo(delegation.repaired_malformed_toolkit_material === true)}`);
  console.log(`Official V2 boolean enablement migrated to configured table: ${yesNo(delegation.migrated_v2_boolean_enablement === true)}`);
  console.log('Codex config path: <Codex user configuration>');
  console.log(`Configuration scope: ${unknown(delegation.client_scope || CODEX_CONFIG_CLIENT_SCOPE)}`);
  console.log(`Helper-capacity detail: ${unknown(delegation.detail)}`);
  console.log(`Temporary editor cleanup: ${unknown(delegation.temporary_cleanup || 'no temporary editor directory created')}`);
  if (delegation.backup_metadata_path) console.log(`Exact backup metadata: ${delegation.backup_metadata_path}`);
  if (delegation.restore_commands?.setup_script_path) console.log(`Restore command setup script: ${delegation.restore_commands.setup_script_path}`);
  if (delegation.restore_commands?.powershell) console.log(`Exact restore command (PowerShell): ${delegation.restore_commands.powershell}`);
  if (delegation.restore_commands?.posix) console.log(`Exact restore command (POSIX shell): ${delegation.restore_commands.posix}`);
  console.log('');
  console.log('## Codex Security capacity');
  console.log('Security capacity behavior: normal global capacity is never raised automatically');
  console.log('Isolated Security exception: unsupported by the currently documented Codex Security plugin and app-server interfaces');
  console.log('If a selected Security workflow requires more workers, raising global capacity may exhaust RAM. Never imply that an official Deep Scan can run with insufficient capacity. Use a lower-capacity ordinary or sequential review, run Deep Scan on another sufficiently provisioned machine, or explicitly make a temporary global increase with exact backup, restart, restoration, and another restart. A sequential custom review is not an official Deep Security Scan.');
  console.log('');
  } else {
    console.log('## Claude Code agent topology');
    console.log(`Selected topology: ${unknown(delegation.topology)}`);
    console.log(`Capacity mode: ${unknown(delegation.capacity_mode)}`);
    console.log(`Manual maximum backstop: ${delegation.manual_maximum || 'not selected'}; restrictive only and never above the live memory ceiling`);
    console.log('Toolkit-controlled child effort: medium by default; higher effort requires one named difficult role and narrow justification');
    console.log('Toolkit-controlled child fast mode: disabled with CLAUDE_CODE_DISABLE_FAST_MODE=1');
    console.log('Nested Toolkit-controlled children: blocked by direct-only --disallowedTools Agent');
    console.log('Native, built-in, team, plugin, user-created, and third-party workers outside the launch script: not covered by Toolkit admission');
    console.log(`Profile outcome this run: ${delegation.status || 'unchanged'}`);
    console.log('');
  }
  console.log('## Codex native plugin');
  if (args.host === 'codex') {
    console.log('Codex plugin cache path: <Codex Toolkit cache>');
    console.log(`Codex expected Toolkit version: ${unknown(nativeCache.expected_version)}`);
    console.log(`Codex installed Toolkit version: ${unknown(nativeCache.installed_version)}`);
    console.log(`Codex plugin installed: ${yesNo(nativeCache.installed === true)}`);
    console.log(`Codex plugin enabled: ${yesNo(nativeCache.enabled === true)}`);
    console.log(`Codex plugin current: ${yesNo(nativeCache.current === true)}`);
    console.log(`Codex plugin status: ${unknown(nativeCache.status)}`);
    console.log(`Codex plugin updated this run: ${yesNo(nativeCache.updated_this_run === true)}`);
    console.log(`Codex restart required: ${yesNo(nativeCache.restart_required === true)}`);
    console.log(`Codex hook trust status: ${unknown(nativeCache.hook_trust_status || 'verification-unavailable')}`);
    console.log(`Codex hook execution status: ${unknown(nativeCache.hook_execution_status || 'verification unavailable; open /hooks in Codex')}`);
    console.log(`Codex hook trust action: Open /hooks and verify the enabled Toolkit SessionStart hook belongs to the installed ai-agent-toolkit plugin at version ${unknown(nativeCache.installed_version || nativeCache.expected_version)}. ${unknown(nativeCache.hook_trust_action || '')}`);
  } else {
    console.log('Codex plugin status: not checked for this host');
    console.log('Codex plugin mutation: no');
  }
  console.log('');
  console.log('## Claude Code native plugin');
  if (args.host === 'claude-code') {
    console.log('Claude plugin manifest path: <managed-toolkit-checkout>/.claude-plugin/plugin.json');
    console.log(`Claude expected Toolkit version: ${unknown(nativeCache.expected_version)}`);
    console.log(`Claude manifest Toolkit version: ${unknown(nativeCache.manifest_version)}`);
    console.log(`Claude plugin status: ${unknown(nativeCache.status)}`);
    if (nativeCache.scope) console.log(`Claude plugin install scope: ${nativeCache.scope}`);
    console.log(`Claude plugin updated this run: ${yesNo(nativeCache.updated_this_run === true)}`);
    console.log(`Claude restart required: ${yesNo(nativeCache.restart_required === true)}`);
    console.log(`Claude hook trust action: ${unknown(nativeCache.hook_trust_action || 'none')}`);
  } else {
    console.log('Claude plugin status: not checked for this host');
    console.log('Claude plugin mutation: no; Codex setup does not mutate Claude Code plugin cache.');
  }
  console.log('');
  console.log('## Bridge state');
  console.log(`Repo auto-update enabled: ${yesNo(repo.enabled === true || args.repoAutoUpdate === true)}`);
  console.log('Repo auto-update path: <managed-toolkit-checkout>');
  console.log(`Repo auto-update status: ${args.repoAutoUpdate ? unknown(repo.last_status || 'configured') : 'disabled'}`);
  console.log(`Update report writes enabled: ${args.updateReports}`);
  console.log('Update report opening behavior: action-required reports open automatically; successful reports stay closed');
  console.log(`Update report/log retention days: ${args.updateReportRetentionDays}`);
  console.log('Update report/log directory: <Toolkit update-report directory>');
  console.log(`Update report cleanup deleted count: ${cleanup.deleted_count ?? 0}`);
  console.log(`Update report cleanup error count: ${cleanup.error_count ?? 0}`);
  console.log('');
  console.log('## Targets');
  console.log('### OpenCode');
  printTargetSummary('OpenCode', targets.opencode || {}, targetChoices.opencode);
  console.log('');
  console.log('### AG2/Antigravity');
  printTargetSummary('AG2', targets.ag2 || {}, targetChoices.ag2);
  console.log('');
  console.log('## Validation');
  printValidationSummary(validationResults);
}

async function execute(args) {
  const current = await collectCurrentState(args);
  args.codexRuntime = current.runtime.runtime;
  const questionBank = await answerSetupQuestionBank(args, current);
  await confirmSelectedDelegationProposal(args, current, questionBank);
  const plan = setupPlan(args);
  printSetupChecklist(plan);
  const warning = activeToolkitWarning(args);
  if (warning) console.warn(`WARNING: ${warning}`);
  const validationResults = [];
  const managed = verifyAndUpdateTrustedRepo(args, validationResults);
  const nativeCache = args.host === 'claude-code'
    ? (args.setupChoices.claudePluginBehavior === 'install' ? runClaudeNativePluginSetup(args) : verifyCurrentClaudeNativeEnforcement(args))
    : runCodexNativePluginSetup(args);
  if (args.host === 'claude-code' && args.setupChoices.claudeTopology === 'toolkit-direct') {
    const activeCurrent = nativeCache.restart_required !== true
      && nativeCache.current === true
      && nativeCache.installed_current === true
      && nativeCache.strict_enforcement_verified === true
      && nativeCache.trusted === true
      && nativeCache.hook_active === true
      && agentControl.validActivationProof(nativeCache.activation_proof, {
        pluginVersion: nativeCache.installed_version || nativeCache.version,
        cachePath: nativeCache.cache_path,
      });
    current.agentCapability = activeCurrent
      ? probeClaudeAgentCapability({ ...args, persistedClaudeCli: current.agentProfile?.claude_cli })
      : { ...current.agentCapability, launch_supported: false, supported: false, launch_probe_status: nativeCache.restart_required === true ? 'restart-pending' : 'current-active-plugin-unverified' };
  }
  runLiteValidation(args, validationResults);
  writeBridgePreferences(args);
  runApprovedTargetSync(args);
  const audit = runBridgeAudit(args);
  const delegation = await applyHostDelegationControl(args, current, nativeCache);
  printFinalSummary({ args, current, managed, nativeCache, delegation, audit, questionBank, validationResults });
  return 0;
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === MANAGED_PROTOCOL_PROBE_FLAG) {
    process.stdout.write(`${JSON.stringify(managedProtocolProbe())}\n`);
    return 0;
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
  if (args.verifyClaudePlugin) {
    runClaudeNativePluginVerify(args);
    return 0;
  }
  const delegatedCode = await delegateToManagedSetupIfAvailable(args);
  if (delegatedCode !== null) return delegatedCode;
  if (args.plan) {
    const current = await collectCurrentState(args);
    args.codexRuntime = current.runtime.runtime;
    const planned = plannedQuestionBank(args, current);
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

module.exports = {
  DEFAULT_REPO_BRANCH,
  DEFAULT_REPO_REMOTE,
  DEFAULT_UPDATE_REPORT_RETENTION_DAYS,
  CODEX_AGENT_MAX_THREADS,
  CODEX_AGENT_MAX_DEPTH,
  SETUP_PAUSED_FOR_REPO_AUTO_UPDATE_APPROVAL,
  SETUP_PAUSED_FOR_UPDATE_REPORT_OPEN_APPROVAL,
  SETUP_PAUSED_FOR_CODEX_PLUGIN_AUTO_REFRESH_APPROVAL,
  SETUP_PAUSED_FOR_QUESTION_BANK,
  QUESTION_BANK_BEGIN,
  QUESTION_BANK_COMPLETE,
  MANAGED_QUESTION_BANK_PROTOCOL,
  MANAGED_PROTOCOL_PROBE_FLAG,
  CLAUDE_SETUP_VERIFY_TIMEOUT_FALLBACK_MS,
  CLAUDE_SETUP_WRITE_TIMEOUT_FALLBACK_MS,
  claudeSetupBudgets,
  defaultManagedSourcePath,
  codexDelegationConfigState: delegation.codexDelegationConfigState,
  inspectCodexDelegationConfig: delegation.inspectCodexDelegationConfig,
  inspectClaudeAgentCapability,
  probeClaudeAgentCapability,
  configureCodexDelegation: delegation.configureCodexDelegation,
  applyHostDelegationControl,
  parseArgs,
  setupQuestionSpecs,
  withPresentationMetadata,
  buildNonTtyAnswerPlan,
  questionBankApprovalPayload,
  questionBankSemanticIdentity,
  spreadsheetChoiceReference,
  parseConciseQuestionBankAnswer,
  assertQuestionBankAnswerBinding,
  answerSetupQuestionBank,
  resolveDisplayedChoiceAnswer,
  renderSetupQuestionBank,
  reconcileClaudeQuestionChoices,
  resolveClaudeTopologyCapacity,
  renderSetupQuestionBankTerminal,
  renderSetupQuestionDocumentation,
  setupQuestionDocumentationSpecs,
  emitCompleteQuestionBank,
  inspectManagedBankOutput,
  managedFailureMessage,
  verifyManagedProtocolIdentity,
  runManagedQuestionBankChild,
  plannedQuestionBank,
  setupPlan,
  normalizeRemote,
  canPreserveManagedCheckout,
  main
};
