#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DEFAULT_REPO_BRANCH = 'main';
const DEFAULT_REPO_REMOTE = 'https://github.com/weijunswj/ai-agent-toolkit';
const DEFAULT_UPDATE_REPORT_RETENTION_DAYS = 7;
const SUPPORTED_TARGETS = ['opencode', 'ag2'];
const SUPPORTED_HOSTS = ['codex', 'claude-code'];
const SETUP_PAUSED_FOR_REPO_AUTO_UPDATE_APPROVAL = 20;
const SETUP_PAUSED_FOR_UPDATE_REPORT_OPEN_APPROVAL = 21;
const SETUP_PAUSED_FOR_CODEX_PLUGIN_AUTO_REFRESH_APPROVAL = 22;

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
    enableTargets: []
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
    } else if (arg.startsWith('--repo-root=')) {
      args.repoRoot = arg.slice('--repo-root='.length);
      args.repoRootExplicit = true;
    } else if (arg === '--repo-branch') args.repoBranch = next();
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
    else if (arg === '--write-repo-auto-update' || arg === '--enable-repo-auto-update') args.repoAutoUpdate = true;
    else if (arg === '--skip-repo-auto-update' || arg === '--disable-repo-auto-update') args.repoAutoUpdate = false;
    else if (arg === '--enable-update-reports') args.updateReports = true;
    else if (arg === '--disable-update-reports' || arg === '--skip-update-reports') args.updateReports = false;
    else if (arg === '--update-report-retention-days') args.updateReportRetentionDays = parsePositiveInteger(next(), arg);
    else if (arg.startsWith('--update-report-retention-days=')) {
      args.updateReportRetentionDays = parsePositiveInteger(arg.slice('--update-report-retention-days='.length), '--update-report-retention-days');
    } else if (arg === '--enable-update-report-open') args.updateReportOpen = true;
    else if (arg === '--skip-update-report-open' || arg === '--disable-update-report-open') args.updateReportOpen = false;
    else if (arg === '--enable-codex-plugin-auto-refresh') args.codexPluginAutoRefresh = true;
    else if (arg === '--skip-codex-plugin-auto-refresh' || arg === '--disable-codex-plugin-auto-refresh') args.codexPluginAutoRefresh = false;
    else if (arg === '--enable-target') args.enableTargets.push(...parseTargetList(next()));
    else if (arg.startsWith('--enable-target=')) args.enableTargets.push(...parseTargetList(arg.slice('--enable-target='.length)));
    else if (arg === '--help' || arg === '-h') args.help = true;
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
  args.enableTargets = [...new Set(args.enableTargets)];
  return args;
}

function relNodeCommand(relScript, extraArgs = []) {
  return ['node', slash(relScript), ...extraArgs].join(' ');
}

function preferenceSummary(options) {
  return {
    repo_backed_auto_update: options.repoAutoUpdate !== false,
    host_native_plugin_cache_auto_refresh: options.host === 'codex'
      ? options.codexPluginAutoRefresh !== false
      : 'manual-verification-only',
    write_meaningful_update_reports: options.updateReports !== false,
    open_update_reports_automatically: options.updateReportOpen === true,
    update_report_retention_days: options.updateReportRetentionDays || DEFAULT_UPDATE_REPORT_RETENTION_DAYS,
    opencode_sync: options.enableTargets?.includes('opencode') ? 'enabled' : 'disabled',
    ag2_antigravity_sync: options.enableTargets?.includes('ag2') ? 'enabled' : 'disabled'
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
  const reportArgs = [
    options.updateReports === false ? '--disable-update-reports' : '--enable-update-reports',
    '--update-report-retention-days',
    String(retentionDays),
    options.updateReportOpen ? '--enable-update-report-open' : '--disable-update-report-open',
    '--write',
    ...hubArgs
  ];
  const repoAutoArgs = [
    options.repoAutoUpdate === false ? '--disable-repo-auto-update' : '--enable-repo-auto-update',
    '--repo-path',
    quote(repoRoot),
    '--repo-branch',
    repoBranch,
    '--repo-remote',
    quote(options.repoRemote || DEFAULT_REPO_REMOTE),
    '--enable-auto-sync',
    '--write',
    ...hubArgs
  ];
  const targetArgs = [];
  for (const target of options.enableTargets || []) targetArgs.push('--enable-target', target);
  targetArgs.push('--write', ...hubArgs);

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
          relNodeCommand('repo/scripts/toolkit-local-bridge.cjs', repoAutoArgs),
          relNodeCommand('repo/scripts/toolkit-local-bridge.cjs', reportArgs),
          ...(host === 'codex'
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
        commands: (options.enableTargets || []).length ? [
          relNodeCommand('repo/scripts/toolkit-local-bridge.cjs', targetArgs),
          relNodeCommand('repo/scripts/toolkit-local-bridge.cjs', ['--sync-enabled', '--write', ...hubArgs])
        ] : []
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
    '  --enable-repo-auto-update   enable repo-backed auto-update from the managed checkout, default',
    '  --skip-repo-auto-update     leave repo-backed auto-update disabled',
    '  --enable-update-reports     write meaningful update reports, default',
    '  --disable-update-reports    disable future meaningful update report writes',
    '  --enable-update-report-open open meaningful update reports automatically',
    '  --skip-update-report-open   leave generated update reports closed by default, default',
    '  --update-report-retention-days <days>',
    '                               positive integer, default: 7',
    '  --enable-codex-plugin-auto-refresh',
    '                               let Codex hooks refresh stale Codex Toolkit cache from managed main, default',
    '  --skip-codex-plugin-auto-refresh',
    '                               leave stale Codex plugin cache refresh manual',
    '  --enable-target opencode|ag2 enable approved non-native bridge target'
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
  const normalized = slash(resolved).toLowerCase();
  if (isInside(activeRoot, resolved)) {
    throw new Error(`Default managed source checkout must not live inside the active Toolkit worktree: ${resolved}`);
  }
  for (const marker of ['/.tmp/', '/.codex/plugins/cache/', '/.claude/plugins/cache/', '/.codex/.tmp/marketplaces/']) {
    if (normalized.includes(marker)) throw new Error(`Managed source checkout must not live inside plugin cache or temporary marketplace paths: ${resolved}`);
  }
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
  runBridgeWrite(
    args,
    'node repo/scripts/toolkit-local-bridge.cjs repo/update preferences --write',
    [
      args.repoAutoUpdate ? '--enable-repo-auto-update' : '--disable-repo-auto-update',
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
  runBridgeWrite(
    args,
    'node repo/scripts/toolkit-local-bridge.cjs update report preferences --write',
    [
      args.updateReports ? '--enable-update-reports' : '--disable-update-reports',
      '--update-report-retention-days',
      String(args.updateReportRetentionDays),
      args.updateReportOpen ? '--enable-update-report-open' : '--disable-update-report-open',
      '--write'
    ]
  );
  if (args.host === 'codex') {
    runBridgeWrite(
      args,
      'node repo/scripts/toolkit-local-bridge.cjs Codex cache preference --write',
      [args.codexPluginAutoRefresh ? '--enable-codex-plugin-auto-refresh' : '--disable-codex-plugin-auto-refresh', '--write']
    );
  }
}

function runApprovedTargetSync(args) {
  if (!args.enableTargets.length) return;
  const enableArgs = [];
  for (const target of args.enableTargets) enableArgs.push('--enable-target', target);
  enableArgs.push('--write');
  runBridgeWrite(args, `node repo/scripts/toolkit-local-bridge.cjs ${enableArgs.join(' ')}`, enableArgs);
  runBridgeWrite(args, 'node repo/scripts/toolkit-local-bridge.cjs --sync-enabled --write', ['--sync-enabled', '--write']);
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

function printFinalSummary({ args, managed, nativeCache, audit }) {
  const repo = audit?.repo_auto_update || {};
  const cleanup = audit?.update_report_cleanup || {};
  const targets = audit?.targets || {};
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
  console.log(`AG2/Antigravity sync status: ${targets.ag2?.enabled ? (targets.ag2?.status || 'enabled') : 'disabled'}`);
  console.log(`Restart required: ${nativeCache.restart_required ? 'yes' : 'no'}`);
  console.log(`Hook trust action required: ${nativeCache.hook_trust_action || 'none'}`);
  const skippedTargets = [];
  if (!args.enableTargets.includes('opencode')) skippedTargets.push('OpenCode');
  if (!args.enableTargets.includes('ag2')) skippedTargets.push('AG2/Antigravity');
  if (skippedTargets.length) console.log(`Skipped target writes: ${skippedTargets.join(', ')} were not selected.`);
}

function execute(args) {
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

function main(argv = process.argv.slice(2)) {
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
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_REPO_BRANCH,
  DEFAULT_REPO_REMOTE,
  DEFAULT_UPDATE_REPORT_RETENTION_DAYS,
  SETUP_PAUSED_FOR_REPO_AUTO_UPDATE_APPROVAL,
  SETUP_PAUSED_FOR_UPDATE_REPORT_OPEN_APPROVAL,
  SETUP_PAUSED_FOR_CODEX_PLUGIN_AUTO_REFRESH_APPROVAL,
  defaultManagedSourcePath,
  parseArgs,
  setupPlan,
  normalizeRemote,
  main
};
