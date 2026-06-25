#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const readline = require('node:readline/promises');

const DEFAULT_REPO_BRANCH = 'main';
const DEFAULT_REPO_REMOTE = 'https://github.com/weijunswj/ai-agent-toolkit';
const DEFAULT_UPDATE_REPORT_RETENTION_DAYS = 7;
const SUPPORTED_TARGETS = ['opencode', 'ag2'];
const SUPPORTED_HOSTS = ['codex', 'claude-code'];
const SETUP_PAUSED_FOR_REPO_AUTO_UPDATE_APPROVAL = 20;
const SETUP_PAUSED_FOR_UPDATE_REPORT_OPEN_APPROVAL = 21;
const SETUP_PAUSED_FOR_CODEX_PLUGIN_AUTO_REFRESH_APPROVAL = 22;
const SETUP_PAUSED_FOR_QUESTION_BANK = 23;

function repoRootFromScript() {
  return path.resolve(__dirname, '..', '..');
}

function defaultManagedSourcePath() {
  return path.join(os.homedir(), '.ai-agent-toolkit', 'source', 'ai-agent-toolkit');
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

function emptySetupChoices() {
  return {
    managedCheckout: '',
    repoAutoUpdate: '',
    updateReports: '',
    updateReportOpen: '',
    updateReportRetention: '',
    codexPluginAutoRefresh: '',
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
    updateReportOpen: false,
    codexPluginAutoRefresh: true,
    enableTargets: [],
    disableTargets: [],
    skipTargets: [],
    keepTargets: [],
    yesRecommended: false,
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
    else if (arg === '--hub') args.hub = next();
    else if (arg.startsWith('--hub=')) args.hub = arg.slice('--hub='.length);
    else if (arg === '--verify-claude-plugin') args.verifyClaudePlugin = true;
    else if (arg === '--yes-recommended') args.yesRecommended = true;
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
      args.setupChoices.updateReportRetention = 'custom';
    }
    else if (arg.startsWith('--update-report-retention-days=')) {
      args.updateReportRetentionDays = parsePositiveInteger(arg.slice('--update-report-retention-days='.length), '--update-report-retention-days');
      args.setupChoices.updateReportRetention = 'custom';
    } else if (arg === '--default-update-report-retention-days') {
      args.updateReportRetentionDays = DEFAULT_UPDATE_REPORT_RETENTION_DAYS;
      args.setupChoices.updateReportRetention = 'default';
    } else if (arg === '--keep-update-report-retention-days') args.setupChoices.updateReportRetention = 'keep';
    else if (arg === '--enable-update-report-open') {
      args.updateReportOpen = true;
      args.setupChoices.updateReportOpen = 'enable';
    } else if (arg === '--skip-update-report-open' || arg === '--disable-update-report-open') {
      args.updateReportOpen = false;
      args.setupChoices.updateReportOpen = 'disable';
    } else if (arg === '--keep-update-report-open') args.setupChoices.updateReportOpen = 'keep';
    else if (arg === '--enable-codex-plugin-auto-refresh') {
      args.codexPluginAutoRefresh = true;
      args.setupChoices.codexPluginAutoRefresh = 'enable';
    } else if (arg === '--skip-codex-plugin-auto-refresh' || arg === '--disable-codex-plugin-auto-refresh') {
      args.codexPluginAutoRefresh = false;
      args.setupChoices.codexPluginAutoRefresh = 'disable';
    } else if (arg === '--keep-codex-plugin-auto-refresh') args.setupChoices.codexPluginAutoRefresh = 'keep';
    else if (arg === '--claude-plugin-behavior') {
      const choice = next().toLowerCase();
      if (!['keep', 'instructions'].includes(choice)) throw new Error(`Unsupported --claude-plugin-behavior choice: ${choice}`);
      args.setupChoices.claudePluginBehavior = choice;
    } else if (arg.startsWith('--claude-plugin-behavior=')) {
      const choice = arg.slice('--claude-plugin-behavior='.length).toLowerCase();
      if (!['keep', 'instructions'].includes(choice)) throw new Error(`Unsupported --claude-plugin-behavior choice: ${choice}`);
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
    write_meaningful_update_reports: choices.updateReports || 'question-required',
    open_update_reports_automatically: choices.updateReportOpen || 'question-required',
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
  const retentionDays = options.updateReportRetentionDays || DEFAULT_UPDATE_REPORT_RETENTION_DAYS;
  const choices = options.setupChoices || emptySetupChoices();
  const reportArgs = [];
  if (choices.updateReports === 'enable') reportArgs.push('--enable-update-reports');
  else if (choices.updateReports === 'disable') reportArgs.push('--disable-update-reports');
  if (choices.updateReportRetention === 'default' || choices.updateReportRetention === 'custom') {
    reportArgs.push('--update-report-retention-days', String(retentionDays));
  }
  if (choices.updateReportOpen === 'enable') reportArgs.push('--enable-update-report-open');
  else if (choices.updateReportOpen === 'disable') reportArgs.push('--disable-update-report-open');
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
      host === 'claude-code' ? {
        id: 'claude_native_plugin_cache',
        title: 'Verify Claude Code native plugin metadata and report manual native refresh action if needed',
        commands: [relNodeCommand('repo/scripts/setup-toolkit.cjs', ['--verify-claude-plugin', '--host', 'claude-code', '--repo-root', quote(repoRoot)])]
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
        id: 'final_summary',
        title: 'Print final setup summary including cleanup, cache, reports, targets, and restart/trust actions',
        commands: [relNodeCommand('repo/scripts/toolkit-local-bridge.cjs', ['--audit', ...hubArgs])]
      }
    ]
  };
}

function printHelp() {
  console.log([
    'AI Agent Toolkit setup orchestrator',
    '',
    'Default mode is --plan. The recommended setup entrypoint is:',
    '  node repo/scripts/setup-toolkit.cjs --execute --profile auto-main',
    '',
    'Common commands:',
    '  node repo/scripts/setup-toolkit.cjs --plan --json',
    '  node repo/scripts/setup-toolkit.cjs --execute --auto-main',
    '  node repo/scripts/setup-toolkit.cjs --execute --profile auto-main --yes-recommended',
    '  node repo/scripts/setup-toolkit.cjs --execute --profile auto-main --host claude-code',
    '  node repo/scripts/setup-toolkit.cjs --execute --auto-main --enable-target opencode',
    '  node repo/scripts/setup-toolkit.cjs --execute --auto-main --enable-target opencode --enable-target ag2',
    '',
    'Options:',
    '  --repo-root <path>           advanced override for managed Toolkit checkout source',
    '  --repo-branch <branch>       default: main',
    '  --repo-remote <url>          default: https://github.com/weijunswj/ai-agent-toolkit',
    '  --host codex|claude-code     default: codex',
    '  --codex-cli <path>           explicit Codex CLI for native plugin setup',
    '  --hub <path>                 test override for Toolkit bridge hub',
    '  --yes-recommended           print and apply recommended choices for unanswered setup questions',
    '  --managed-checkout keep|default|custom',
    '                               choose the managed checkout answer non-interactively',
    '  --enable-repo-auto-update   enable repo-backed auto-update from the managed checkout',
    '  --skip-repo-auto-update     disable repo-backed auto-update',
    '  --keep-repo-auto-update     preserve repo-backed auto-update preference',
    '  --enable-update-reports     write meaningful update reports',
    '  --disable-update-reports    disable future meaningful update report writes',
    '  --keep-update-reports       preserve meaningful update report write preference',
    '  --enable-update-report-open open meaningful update reports automatically',
    '  --skip-update-report-open   disable automatic opening of generated update reports',
    '  --keep-update-report-open   preserve update report auto-open preference',
    '  --update-report-retention-days <days>',
    '                               custom positive integer retention days',
    '  --default-update-report-retention-days',
    '                               explicitly set retention to 7 days',
    '  --keep-update-report-retention-days',
    '                               preserve current retention days',
    '  --enable-codex-plugin-auto-refresh',
    '                               let Codex hooks refresh stale Codex Toolkit cache from managed main',
    '  --skip-codex-plugin-auto-refresh',
    '                               leave stale Codex plugin cache refresh manual',
    '  --keep-codex-plugin-auto-refresh',
    '                               preserve Codex plugin cache auto-refresh preference',
    '  --claude-plugin-behavior keep|instructions',
    '                               Claude Code only; verify/report or show native refresh instructions',
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
    console.log([command, ...args].join(' '));
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
  const currentPath = configuredPath || (args.repoRootExplicit ? args.repoRoot : '');
  const selectedPath = args.repoRootExplicit ? args.repoRoot : (configuredPath || args.repoRoot || defaultPath);
  const exists = fs.existsSync(selectedPath);
  const gitDir = exists ? runGitCapture(selectedPath, ['rev-parse', '--git-dir'], 'git rev-parse --git-dir', true, true) : '';
  const branch = gitDir ? runGitCapture(selectedPath, ['branch', '--show-current'], 'git branch --show-current', true, true) : '';
  const remote = gitDir ? runGitCapture(selectedPath, ['remote', 'get-url', 'origin'], 'git remote get-url origin', true, true) : '';
  const status = gitDir ? runGitCapture(selectedPath, ['status', '--short'], 'git status --short', true, true) : '';
  const commit = gitDir ? runGitCapture(selectedPath, ['rev-parse', 'HEAD'], 'git rev-parse HEAD', true, true) : '';
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
  const pluginPath = path.join(probeRoot, '.claude-plugin', 'plugin.json');
  const hooksPath = path.join(probeRoot, '.claude-plugin', 'hooks', 'hooks.json');
  if (!fs.existsSync(pluginPath) || !fs.existsSync(hooksPath)) {
    return {
      status: 'missing',
      detail: `Expected ${pluginPath} and ${hooksPath}`
    };
  }
  try {
    const plugin = readJsonFile(pluginPath);
    const hooks = readJsonFile(hooksPath);
    const command = (hooks?.hooks?.SessionStart || [])
      .flatMap((entry) => Array.isArray(entry.hooks) ? entry.hooks : [])
      .map((entry) => String(entry.command || ''))
      .find((value) => value.includes('toolkit-local-bridge.cjs')) || '';
    return {
      status: command ? 'metadata-present' : 'hooks-need-review',
      version: plugin.version || '',
      detail: command || 'SessionStart hook command not found'
    };
  } catch (error) {
    return {
      status: 'invalid',
      detail: error.message
    };
  }
}

function collectCurrentState(args) {
  const audit = runBridgeAuditReadOnly(args);
  return {
    audit,
    managed: inspectManagedCheckout(args, audit),
    nativePlugin: args.host === 'claude-code'
      ? inspectClaudeNativePluginState(args)
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
  return path.resolve(current.managed.currentPath) === path.resolve(current.managed.defaultPath);
}

function canRecommendKeepingManagedCheckout(current, args) {
  const managed = current?.managed || {};
  if (!managed.currentPath) return false;
  if (!isStandardManagedCheckout(current)) return false;
  const resolved = path.resolve(managed.currentPath);
  if (isInside(repoRootFromScript(), resolved)) return false;
  if (hasUnsafeManagedPathMarker(resolved)) return false;
  if (!managed.exists || !managed.git || managed.dirty) return false;
  if (managed.branch !== args.repoBranch) return false;
  return normalizeRemote(managed.remote) === normalizeRemote(args.repoRemote);
}

function recommendedChoice(key, current, args) {
  if (key === 'managedCheckout') return canRecommendKeepingManagedCheckout(current, args) ? 'keep' : 'default';
  if (key === 'repoAutoUpdate') return 'enable';
  if (key === 'updateReports') return 'enable';
  if (key === 'updateReportOpen') return 'keep';
  if (key === 'updateReportRetention') return currentReportRetentionDays(current) === DEFAULT_UPDATE_REPORT_RETENTION_DAYS ? 'keep' : 'default';
  if (key === 'codexPluginAutoRefresh') return 'enable';
  if (key === 'claudePluginBehavior') return 'keep';
  if (key === 'opencodeTarget') return args.setupChoices.targets.opencode || 'keep';
  if (key === 'ag2Target') return args.setupChoices.targets.ag2 || 'keep';
  return 'keep';
}

function setupQuestionSpecs(args, current) {
  const specs = [
    {
      key: 'managedCheckout',
      title: 'Managed checkout',
      prompt: 'Managed checkout choice',
      choices: ['keep', 'default', 'custom'],
      recommended: recommendedChoice('managedCheckout', current, args),
      selected: args.setupChoices.managedCheckout,
      current: current.managed.currentPath || '(none configured)'
    },
    {
      key: 'repoAutoUpdate',
      title: 'Repo-backed auto-update',
      prompt: 'Repo-backed auto-update choice',
      choices: ['keep', 'enable', 'disable'],
      recommended: recommendedChoice('repoAutoUpdate', current, args),
      selected: args.setupChoices.repoAutoUpdate,
      current: formatBool(current.audit?.repo_auto_update?.enabled === true)
    },
    {
      key: 'updateReports',
      title: 'Update report writes',
      prompt: 'Update report writes choice',
      choices: ['keep', 'enable', 'disable'],
      recommended: recommendedChoice('updateReports', current, args),
      selected: args.setupChoices.updateReports,
      current: formatBool(current.audit?.update_report_enabled !== false)
    },
    {
      key: 'updateReportOpen',
      title: 'Update report auto-open',
      prompt: 'Update report auto-open choice',
      choices: ['keep', 'enable', 'disable'],
      recommended: recommendedChoice('updateReportOpen', current, args),
      selected: args.setupChoices.updateReportOpen,
      current: formatBool(current.audit?.update_report_open_enabled === true)
    },
    {
      key: 'updateReportRetention',
      title: 'Update report/log retention',
      prompt: 'Update report/log retention choice',
      choices: ['keep', 'default', 'custom'],
      recommended: recommendedChoice('updateReportRetention', current, args),
      selected: args.setupChoices.updateReportRetention,
      current: `${currentReportRetentionDays(current)} day(s)`
    }
  ];

  if (args.host === 'codex') {
    specs.push({
      key: 'codexPluginAutoRefresh',
      title: 'Codex plugin cache auto-refresh',
      prompt: 'Codex plugin cache auto-refresh choice',
      choices: ['keep', 'enable', 'disable'],
      recommended: recommendedChoice('codexPluginAutoRefresh', current, args),
      selected: args.setupChoices.codexPluginAutoRefresh,
      current: formatBool(current.audit?.codex_plugin_auto_refresh_enabled === true)
    });
  } else {
    specs.push({
      key: 'claudePluginBehavior',
      title: 'Claude Code plugin behavior',
      prompt: 'Claude Code plugin behavior choice',
      choices: ['keep', 'instructions'],
      recommended: recommendedChoice('claudePluginBehavior', current, args),
      selected: args.setupChoices.claudePluginBehavior,
      current: `${current.nativePlugin.status}; verify/report only, no Codex mutation`
    });
  }

  specs.push(
    {
      key: 'opencodeTarget',
      title: 'OpenCode bridge target',
      prompt: 'OpenCode bridge target choice',
      choices: ['keep', 'enable-sync', 'disable', 'skip'],
      recommended: recommendedChoice('opencodeTarget', current, args),
      selected: args.setupChoices.targets.opencode,
      current: formatTargetState(current.audit?.targets?.opencode)
    },
    {
      key: 'ag2Target',
      title: 'AG2/Antigravity bridge target',
      prompt: 'AG2/Antigravity bridge target choice',
      choices: ['keep', 'enable-sync', 'disable', 'skip'],
      recommended: recommendedChoice('ag2Target', current, args),
      selected: args.setupChoices.targets.ag2,
      current: formatTargetState(current.audit?.targets?.ag2)
    }
  );
  return specs;
}

function printSetupQuestionBank(args, current, specs) {
  console.log('# setup toolkit question bank');
  console.log('');
  console.log('Current state was discovered before setup writes. Answer every choice once before setup continues.');
  console.log('');
  console.log('Managed checkout:');
  console.log(`- detected/current path: ${current.managed.currentPath || '(none configured)'}`);
  console.log(`- selected path for inspection: ${current.managed.selectedPath}`);
  console.log(`- default path: ${current.managed.defaultPath}`);
  console.log(`- current git state: exists=${current.managed.exists ? 'yes' : 'no'}, git=${current.managed.git ? 'yes' : 'no'}, branch=${current.managed.branch || '(unknown)'}, dirty=${current.managed.dirty ? 'yes' : 'no'}`);
  if (current.managed.remote) console.log(`- current remote: ${current.managed.remote}`);
  console.log('');
  console.log(`Host: ${args.host}`);
  console.log(`Host-native plugin state: ${current.nativePlugin.status}${current.nativePlugin.version ? `, version=${current.nativePlugin.version}` : ''}`);
  if (current.audit?.error) console.log(`Bridge audit warning: ${current.audit.error}`);
  console.log('');
  for (const spec of specs) {
    const selected = spec.selected || '(answer required)';
    console.log(`${spec.title}:`);
    console.log(`- current: ${spec.current}`);
    console.log(`- recommended: ${spec.recommended}`);
    console.log(`- choices: ${spec.choices.join(' / ')}`);
    console.log(`- selected: ${selected}`);
  }
}

function assignChoice(args, key, choice) {
  if (key === 'managedCheckout') args.setupChoices.managedCheckout = choice;
  else if (key === 'repoAutoUpdate') args.setupChoices.repoAutoUpdate = choice;
  else if (key === 'updateReports') args.setupChoices.updateReports = choice;
  else if (key === 'updateReportOpen') args.setupChoices.updateReportOpen = choice;
  else if (key === 'updateReportRetention') args.setupChoices.updateReportRetention = choice;
  else if (key === 'codexPluginAutoRefresh') args.setupChoices.codexPluginAutoRefresh = choice;
  else if (key === 'claudePluginBehavior') args.setupChoices.claudePluginBehavior = choice;
  else if (key === 'opencodeTarget') args.setupChoices.targets.opencode = choice;
  else if (key === 'ag2Target') args.setupChoices.targets.ag2 = choice;
}

function choiceForKey(args, key) {
  if (key === 'managedCheckout') return args.setupChoices.managedCheckout;
  if (key === 'repoAutoUpdate') return args.setupChoices.repoAutoUpdate;
  if (key === 'updateReports') return args.setupChoices.updateReports;
  if (key === 'updateReportOpen') return args.setupChoices.updateReportOpen;
  if (key === 'updateReportRetention') return args.setupChoices.updateReportRetention;
  if (key === 'codexPluginAutoRefresh') return args.setupChoices.codexPluginAutoRefresh;
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

async function promptForChoice(spec, lines, rl) {
  if (lines) {
    const value = nextNonEmptyLine(lines).toLowerCase();
    if (!value) throw new Error(`Setup question bank requires an answer for ${spec.title}`);
    return value;
  }
  for (;;) {
    const answer = (await rl.question(`${spec.prompt} [${spec.choices.join('/')}]: `)).trim().toLowerCase();
    if (answer) return answer;
    console.log(`Please answer ${spec.prompt}.`);
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

async function answerSetupQuestionBank(args, current) {
  const specs = setupQuestionSpecs(args, current);
  printSetupQuestionBank(args, current, specs);

  if (args.yesRecommended) {
    console.log('');
    console.log('--yes-recommended selected; setup will apply these choices before writing:');
    for (const spec of specs) {
      if (!choiceForKey(args, spec.key)) assignChoice(args, spec.key, spec.recommended);
      console.log(`- ${spec.title}: ${choiceForKey(args, spec.key)}`);
    }
  }

  const missing = specs.filter((spec) => !choiceForKey(args, spec.key));
  if (missing.length) {
    console.log('');
    console.log('Answer the remaining setup choices now. Setup will not write preferences or targets before these answers are complete.');
  }

  const lines = !process.stdin.isTTY ? fs.readFileSync(0, 'utf8').split(/\r?\n/) : null;
  const rl = lines ? null : readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (const spec of missing) {
      const answer = await promptForChoice(spec, lines, rl);
      if (!spec.choices.includes(answer)) {
        throw new Error(`${spec.title} must be one of: ${spec.choices.join(', ')}`);
      }
      assignChoice(args, spec.key, answer);
    }
    if (args.setupChoices.managedCheckout === 'custom' && !args.repoRootExplicit) {
      args.repoRoot = await promptForCustomPath(lines, rl);
      args.repoRootExplicit = true;
    }
  } finally {
    if (rl) rl.close();
  }

  applySetupChoices(args, current);
  console.log('');
  console.log('Setup choices confirmed before writes:');
  for (const spec of specs) console.log(`- ${spec.title}: ${choiceForKey(args, spec.key)}`);
}

function applySetupChoices(args, current) {
  const choices = args.setupChoices;
  if (choices.managedCheckout === 'keep') {
    args.repoRoot = path.resolve(current.managed.currentPath || current.managed.selectedPath || args.repoRoot);
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

  if (choices.updateReportOpen === 'keep') args.updateReportOpen = current.audit?.update_report_open_enabled === true;
  else args.updateReportOpen = choices.updateReportOpen === 'enable';

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
  if (isInside(activeRoot, resolved)) {
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

function verifyAndUpdateTrustedRepo(args) {
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
  runManagedHookLightValidation(args);
  return {
    cloned,
    branch,
    commit: runGitCapture(args.repoRoot, ['rev-parse', 'HEAD'], 'git rev-parse HEAD')
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

function runCodexNativePluginSetup(args) {
  const verify = runCommand(
    'node repo/scripts/setup-codex-toolkit-plugin.cjs --verify --json',
    process.execPath,
    setupCodexArgs(args, '--verify'),
    { cwd: args.repoRoot, capture: true, timeout: 120000, allowFailure: true }
  );
  if (verify.status === 0) {
    process.stdout.write(verify.stdout || '');
    return { status: 'fresh', restart_required: false, hook_trust_action: 'review Codex hook trust if prompted' };
  }
  process.stderr.write(verify.stderr || '');

  runCommand(
    'node repo/scripts/setup-codex-toolkit-plugin.cjs --write --json',
    process.execPath,
    setupCodexArgs(args, '--write'),
    { cwd: args.repoRoot, timeout: 180000 }
  );
  runCommand(
    'node repo/scripts/setup-codex-toolkit-plugin.cjs --verify --json',
    process.execPath,
    setupCodexArgs(args, '--verify'),
    { cwd: args.repoRoot, timeout: 120000 }
  );
  return { status: 'refreshed', restart_required: true, hook_trust_action: 'approve the Codex SessionStart hook when Codex prompts' };
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
  console.log('Claude Code native plugin metadata verified.');
  console.log('If Claude Code reports the Toolkit plugin is missing, stale, disabled, or untrusted, refresh it through Claude Code native plugin UI/flow. Codex will not mutate Claude Code plugin cache.');
  return { status: 'verified-manual-refresh-if-needed', restart_required: false, hook_trust_action: 'follow Claude Code native plugin trust prompts if shown' };
}

function bridgeArgs(args, extraArgs = []) {
  const result = nodeScriptArgs('repo/scripts/toolkit-local-bridge.cjs', extraArgs);
  if (args.hub) result.push('--hub', args.hub);
  return result;
}

function runManagedHookLightValidation(args) {
  runCommand(
    'node --test repo/tests/toolkit-local-bridge-hook-light.test.cjs',
    process.execPath,
    ['--test', path.join('repo', 'tests', 'toolkit-local-bridge-hook-light.test.cjs')],
    { cwd: args.repoRoot, timeout: 60000 }
  );
}

function runLiteValidation(args) {
  runCommand('node repo/scripts/validate-toolkit.cjs', process.execPath, nodeScriptArgs('repo/scripts/validate-toolkit.cjs'), {
    cwd: args.repoRoot,
    timeout: 120000
  });
  runManagedHookLightValidation(args);
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

  const reportArgs = [];
  if (choices.updateReports === 'enable') reportArgs.push('--enable-update-reports');
  else if (choices.updateReports === 'disable') reportArgs.push('--disable-update-reports');
  if (choices.updateReportRetention === 'default' || choices.updateReportRetention === 'custom') {
    reportArgs.push('--update-report-retention-days', String(args.updateReportRetentionDays));
  }
  if (choices.updateReportOpen === 'enable') reportArgs.push('--enable-update-report-open');
  else if (choices.updateReportOpen === 'disable') reportArgs.push('--disable-update-report-open');
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
  process.stdout.write(stdout);
  const jsonStart = stdout.indexOf('{');
  return jsonStart >= 0 ? JSON.parse(stdout.slice(jsonStart)) : null;
}

function printSetupChecklist(plan) {
  console.log('# setup toolkit checklist');
  console.log('');
  console.log(plan.checklist_explanation);
  console.log('');
  console.log(`Host: ${plan.host}`);
  console.log(`Managed checkout path: ${plan.managed_source.path}`);
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
  printSetupChecklist(plan);
  for (const step of plan.steps) {
    console.log('');
    console.log(`${step.id}: ${step.title}`);
    for (const command of step.commands || []) console.log(`  ${command}`);
  }
}

function targetChoiceSummary(choice) {
  if (choice === 'keep') return 'kept current state';
  if (choice === 'skip') return 'skipped this run';
  if (choice === 'enable-sync') return 'enabled/synced';
  if (choice === 'disable') return 'disabled';
  return 'not selected';
}

function printFinalSummary({ args, managed, nativeCache, audit }) {
  const repo = audit?.repo_auto_update || {};
  const cleanup = audit?.update_report_cleanup || {};
  const targets = audit?.targets || {};
  const targetChoices = args.setupChoices?.targets || {};
  console.log('');
  console.log('# setup toolkit final summary');
  console.log(`Host: ${args.host}`);
  console.log(`Managed checkout path: ${args.repoRoot}`);
  console.log(`Managed checkout branch: ${args.repoBranch}`);
  console.log(`Managed checkout commit: ${managed.commit || 'unknown'}`);
  console.log(`Repo auto-update status: ${args.repoAutoUpdate ? (repo.last_status || 'configured') : 'disabled'}`);
  console.log(`Native plugin cache status: ${nativeCache.status || 'unknown'}`);
  console.log(`Current host cache auto-refresh enabled: ${args.host === 'codex' ? args.codexPluginAutoRefresh : 'manual via Claude Code native flow'}`);
  console.log(`Update report writes enabled: ${args.updateReports}`);
  console.log(`Update report auto-open enabled: ${args.updateReportOpen}`);
  console.log(`Update report/log retention days: ${args.updateReportRetentionDays}`);
  console.log(`Update report/log cleanup: deleted=${cleanup.deleted_count ?? 0}, errors=${cleanup.error_count ?? 0}, directory=${cleanup.report_log_directory || 'unknown'}`);
  console.log(`OpenCode sync status: ${targets.opencode?.enabled ? (targets.opencode?.status || 'enabled') : 'disabled'}`);
  console.log(`OpenCode target choice: ${targetChoiceSummary(targetChoices.opencode)}`);
  console.log(`AG2/Antigravity sync status: ${targets.ag2?.enabled ? (targets.ag2?.status || 'enabled') : 'disabled'}`);
  console.log(`AG2/Antigravity target choice: ${targetChoiceSummary(targetChoices.ag2)}`);
  console.log(`Restart required: ${nativeCache.restart_required ? 'yes' : 'no'}`);
  console.log(`Hook trust action required: ${nativeCache.hook_trust_action || 'none'}`);
}

async function execute(args) {
  const current = collectCurrentState(args);
  await answerSetupQuestionBank(args, current);
  const plan = setupPlan(args);
  printSetupChecklist(plan);
  const warning = activeToolkitWarning(args);
  if (warning) console.warn(`WARNING: ${warning}`);
  const managed = verifyAndUpdateTrustedRepo(args);
  const nativeCache = args.host === 'claude-code'
    ? verifyClaudeNativePluginMetadata(args)
    : runCodexNativePluginSetup(args);
  runLiteValidation(args);
  writeBridgePreferences(args);
  runApprovedTargetSync(args);
  const audit = runBridgeAudit(args);
  printFinalSummary({ args, managed, nativeCache, audit });
  return 0;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }
  if (args.verifyClaudePlugin) {
    verifyClaudeNativePluginMetadata(args);
    return 0;
  }
  const plan = setupPlan(args);
  if (args.plan) {
    printPlan(plan, args.json);
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
      if (/Setup question bank requires|must be one of|requires a path answer/.test(error.message)) {
        process.exitCode = SETUP_PAUSED_FOR_QUESTION_BANK;
      } else {
        process.exitCode = 1;
      }
    console.error(`FAIL: ${error.message}`);
    });
}

module.exports = {
  DEFAULT_REPO_BRANCH,
  DEFAULT_REPO_REMOTE,
  DEFAULT_UPDATE_REPORT_RETENTION_DAYS,
  SETUP_PAUSED_FOR_REPO_AUTO_UPDATE_APPROVAL,
  SETUP_PAUSED_FOR_UPDATE_REPORT_OPEN_APPROVAL,
  SETUP_PAUSED_FOR_CODEX_PLUGIN_AUTO_REFRESH_APPROVAL,
  SETUP_PAUSED_FOR_QUESTION_BANK,
  defaultManagedSourcePath,
  parseArgs,
  setupPlan,
  normalizeRemote,
  main
};
