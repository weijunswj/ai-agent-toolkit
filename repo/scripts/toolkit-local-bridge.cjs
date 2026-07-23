#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const {
  findInstalledPluginEntries,
  inspectCodexConfiguredPluginState,
  inspectCodexPluginList,
  verifyInstalledCacheFreshness
} = require('./setup-codex-toolkit-plugin.cjs');
const {
  reconcileN8nSkillsPlugin
} = require('./repair-codex-plugin-windows-hooks.cjs');
const {
  auditOwnedStaging,
  cleanupOwnedGeneration,
  createOwnedStagingGeneration,
  markOwnedStaging,
  reconcileOwnedStaging
} = require('./toolkit-staging-generations.cjs');

const ARCHITECTURE_VERSION = 2;
const BRIDGE_VERSION = '2.8.5';
const STATE_SCHEMA_VERSION = 1;
const TOOLKIT_NAME = 'ai-agent-toolkit';
const SUPPORTED_TARGETS = ['opencode', 'ag2'];
const SYNC_SOURCES = ['repo', 'codex-plugin', 'claude-plugin'];
const LOCK_STALE_MS = 10 * 60 * 1000;
const DEFAULT_REPO_BRANCH = 'main';
const DEFAULT_REPO_REMOTE = 'https://github.com/weijunswj/ai-agent-toolkit';
const TARGET_MANIFEST_FILE = '.ai-agent-toolkit-managed.json';
const TARGET_MANIFEST_MARKER = 'ai-agent-toolkit-local-bridge';
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UPDATE_REPORT_ROOT = path.join('ai-agent-toolkit', 'update-reports');
const DEFAULT_UPDATE_REPORT_RETENTION_DAYS = 7;
const DEFAULT_UPDATE_REPORT_MAX_FILES = 200;
const FULL_VALIDATION_TEST = path.join('repo', 'tests', 'toolkit-local-bridge.test.cjs');
const HOOK_LIGHT_VALIDATION_TEST = path.join('repo', 'tests', 'toolkit-local-bridge-hook-light.test.cjs');
const VALIDATE_TOOLKIT_TIMEOUT_MS = 120000;
const HOOK_LIGHT_VALIDATION_TIMEOUT_MS = 30000;
const NATIVE_PLUGIN_CACHE_REPORT_ERROR_LIMIT = 5;
const THIRD_PARTY_HOOK_REPAIR_ERROR_LIMIT = 5;
const GIT_CREDENTIAL_HELPERS = ['manager', 'manager-core'];
const AGENT_RULES_TEMPLATE_DIR = path.join('skills', 'ai-coding-agent-rules', 'repo-local');
const AGENT_RULES_PREFLIGHT_MAX_FINDINGS = 8;
const AGENT_RULES_PREFLIGHT_FILES = {
  'codex-plugin': [
    { target: 'AGENTS.md', template: 'AGENTS.managed.template.md' }
  ],
  'claude-plugin': [
    { target: 'AGENTS.md', template: 'AGENTS.managed.template.md' },
    { target: 'CLAUDE.md', template: 'CLAUDE.shim.template.md' }
  ]
};
const RECONCILIATION_ALLOWED_FLAGS = new Set([
  '--reconcile-staging',
  '--write',
  '--hub',
  '--sync-source',
  '--force-downgrade',
  '--opencode-config-dir',
  '--opencode-target'
]);

function slash(value) {
  return value.split(path.sep).join('/');
}

function timestamp() {
  return new Date().toISOString();
}

function reportTimestampSgt(value) {
  const date = new Date(value || timestamp());
  if (Number.isNaN(date.getTime())) return `${value} (SGT unavailable)`;
  const sgt = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const pad = (number) => String(number).padStart(2, '0');
  return [
    sgt.getUTCFullYear(),
    '-',
    pad(sgt.getUTCMonth() + 1),
    '-',
    pad(sgt.getUTCDate()),
    ' ',
    pad(sgt.getUTCHours()),
    ':',
    pad(sgt.getUTCMinutes()),
    ':',
    pad(sgt.getUTCSeconds()),
    ' SGT'
  ].join('');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function parseListValue(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    argv,
    write: false,
    audit: false,
    hook: false,
    syncEnabled: false,
    forceDowngrade: false,
    enableTargets: [],
    disableTargets: [],
    enableAutoSync: false,
    disableAutoSync: false,
    enableRepoAutoUpdate: false,
    disableRepoAutoUpdate: false,
    repoPath: '',
    repoBranch: '',
    repoRemote: '',
    repoUpdateNow: false,
    skipRepoAutoUpdate: false,
    openUpdateReport: false,
    enableUpdateReports: false,
    disableUpdateReports: false,
    updateReportRetentionDays: 0,
    updateReportRetentionDaysExplicit: false,
    enableUpdateReportOpen: false,
    disableUpdateReportOpen: false,
    enableCodexPluginAutoRefresh: false,
    disableCodexPluginAutoRefresh: false,
    suppressUpdateReport: false,
    reconcileStaging: '',
    syncSource: 'repo',
    hub: '',
    opencodeConfigDir: '',
    opencodeTarget: '',
    opencodeCommand: 'opencode',
    pythonCommand: '',
    setAg2PythonCommand: ''
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index] || '';
    if (arg === '--write') args.write = true;
    else if (arg === '--audit') args.audit = true;
    else if (arg === '--hook') args.hook = true;
    else if (arg === '--sync-enabled') args.syncEnabled = true;
    else if (arg === '--force-downgrade') args.forceDowngrade = true;
    else if (arg === '--enable-auto-sync') args.enableAutoSync = true;
    else if (arg === '--disable-auto-sync') args.disableAutoSync = true;
    else if (arg === '--enable-repo-auto-update') args.enableRepoAutoUpdate = true;
    else if (arg === '--disable-repo-auto-update') args.disableRepoAutoUpdate = true;
    else if (arg === '--repo-path') args.repoPath = next();
    else if (arg.startsWith('--repo-path=')) args.repoPath = arg.slice('--repo-path='.length);
    else if (arg === '--repo-branch') args.repoBranch = next();
    else if (arg.startsWith('--repo-branch=')) args.repoBranch = arg.slice('--repo-branch='.length);
    else if (arg === '--repo-remote') args.repoRemote = next();
    else if (arg.startsWith('--repo-remote=')) args.repoRemote = arg.slice('--repo-remote='.length);
    else if (arg === '--repo-update-now') args.repoUpdateNow = true;
    else if (arg === '--skip-repo-auto-update') args.skipRepoAutoUpdate = true;
    else if (arg === '--open-update-report') args.openUpdateReport = true;
    else if (arg === '--enable-update-reports') args.enableUpdateReports = true;
    else if (arg === '--disable-update-reports') args.disableUpdateReports = true;
    else if (arg === '--update-report-retention-days') {
      args.updateReportRetentionDays = Number(next());
      args.updateReportRetentionDaysExplicit = true;
    }
    else if (arg.startsWith('--update-report-retention-days=')) {
      args.updateReportRetentionDays = Number(arg.slice('--update-report-retention-days='.length));
      args.updateReportRetentionDaysExplicit = true;
    }
    else if (arg === '--enable-update-report-open') args.enableUpdateReportOpen = true;
    else if (arg === '--disable-update-report-open') args.disableUpdateReportOpen = true;
    else if (arg === '--enable-codex-plugin-auto-refresh') args.enableCodexPluginAutoRefresh = true;
    else if (arg === '--disable-codex-plugin-auto-refresh') args.disableCodexPluginAutoRefresh = true;
    else if (arg === '--suppress-update-report') args.suppressUpdateReport = true;
    else if (arg === '--reconcile-staging') args.reconcileStaging = next();
    else if (arg.startsWith('--reconcile-staging=')) args.reconcileStaging = arg.slice('--reconcile-staging='.length);
    else if (arg === '--enable-target') args.enableTargets.push(...parseListValue(next()));
    else if (arg.startsWith('--enable-target=')) args.enableTargets.push(...parseListValue(arg.slice('--enable-target='.length)));
    else if (arg === '--disable-target') args.disableTargets.push(...parseListValue(next()));
    else if (arg.startsWith('--disable-target=')) args.disableTargets.push(...parseListValue(arg.slice('--disable-target='.length)));
    else if (arg === '--hub') args.hub = next();
    else if (arg.startsWith('--hub=')) args.hub = arg.slice('--hub='.length);
    else if (arg === '--sync-source') args.syncSource = next();
    else if (arg.startsWith('--sync-source=')) args.syncSource = arg.slice('--sync-source='.length);
    else if (arg === '--opencode-config-dir') args.opencodeConfigDir = next();
    else if (arg.startsWith('--opencode-config-dir=')) args.opencodeConfigDir = arg.slice('--opencode-config-dir='.length);
    else if (arg === '--opencode-target') args.opencodeTarget = next();
    else if (arg.startsWith('--opencode-target=')) args.opencodeTarget = arg.slice('--opencode-target='.length);
    else if (arg === '--opencode-command') args.opencodeCommand = next();
    else if (arg.startsWith('--opencode-command=')) args.opencodeCommand = arg.slice('--opencode-command='.length);
    else if (arg === '--python-command') args.pythonCommand = next();
    else if (arg.startsWith('--python-command=')) args.pythonCommand = arg.slice('--python-command='.length);
    else if (arg === '--set-ag2-python-command') args.setAg2PythonCommand = next();
    else if (arg.startsWith('--set-ag2-python-command=')) args.setAg2PythonCommand = arg.slice('--set-ag2-python-command='.length);
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  for (const target of [...args.enableTargets, ...args.disableTargets]) {
    if (!SUPPORTED_TARGETS.includes(target)) throw new Error(`Unsupported target: ${target}`);
  }
  if (!SYNC_SOURCES.includes(args.syncSource)) {
    throw new Error(`--sync-source must be repo, codex-plugin, or claude-plugin: ${args.syncSource}`);
  }
  if (args.enableAutoSync && args.disableAutoSync) {
    throw new Error('--enable-auto-sync and --disable-auto-sync cannot be used together');
  }
  if (args.enableRepoAutoUpdate && args.disableRepoAutoUpdate) {
    throw new Error('--enable-repo-auto-update and --disable-repo-auto-update cannot be used together');
  }
  if (args.enableUpdateReportOpen && args.disableUpdateReportOpen) {
    throw new Error('--enable-update-report-open and --disable-update-report-open cannot be used together');
  }
  if (args.enableUpdateReports && args.disableUpdateReports) {
    throw new Error('--enable-update-reports and --disable-update-reports cannot be used together');
  }
  if (args.updateReportRetentionDays && !args.updateReportRetentionDaysExplicit) args.updateReportRetentionDaysExplicit = true;
  if (args.updateReportRetentionDaysExplicit && (!Number.isInteger(args.updateReportRetentionDays) || args.updateReportRetentionDays <= 0)) {
    throw new Error('--update-report-retention-days requires a positive integer');
  }
  if (args.enableCodexPluginAutoRefresh && args.disableCodexPluginAutoRefresh) {
    throw new Error('--enable-codex-plugin-auto-refresh and --disable-codex-plugin-auto-refresh cannot be used together');
  }
  if (args.reconcileStaging && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args.reconcileStaging)) {
    throw new Error('--reconcile-staging requires one exact generation ID from a prior audit');
  }
  return args;
}

function assertReconciliationCommandArgs(args) {
  if (!args.reconcileStaging) return;
  const incompatible = [...new Set(args.argv
    .filter((value) => String(value).startsWith('--'))
    .map((value) => String(value).split('=')[0])
    .filter((flag) => !RECONCILIATION_ALLOWED_FLAGS.has(flag)))];
  if (incompatible.length) {
    throw new Error(`--reconcile-staging cannot be combined with: ${incompatible.join(', ')}`);
  }
}

function printHelp() {
  console.log([
    'Toolkit Local Bridge updater',
    '',
    'Dry-run is the default. Add --write for local hub or target writes.',
    '',
    'Common commands:',
    '  node repo/scripts/toolkit-local-bridge.cjs --audit',
    '  node repo/scripts/toolkit-local-bridge.cjs --enable-target opencode',
    '  node repo/scripts/toolkit-local-bridge.cjs --enable-target opencode --write',
    '  node repo/scripts/toolkit-local-bridge.cjs --enable-target ag2',
    '  node repo/scripts/toolkit-local-bridge.cjs --enable-target ag2 --write',
    '  node repo/scripts/toolkit-local-bridge.cjs --sync-enabled --write',
    '  node repo/scripts/toolkit-local-bridge.cjs --reconcile-staging <generation-id>',
    '  node repo/scripts/toolkit-local-bridge.cjs --reconcile-staging <generation-id> --write',
    '  node repo/scripts/toolkit-local-bridge.cjs --disable-target opencode --write',
    '',
    'Options:',
    '  --enable-target opencode|ag2',
    '  --disable-target opencode|ag2',
    '  --sync-enabled',
    '  --enable-auto-sync',
    '  --disable-auto-sync',
    '  --enable-repo-auto-update',
    '  --disable-repo-auto-update',
    '  --repo-path <path>',
    '  --repo-branch <branch>',
    '  --repo-remote <url>',
    '  --repo-update-now',
    '  --skip-repo-auto-update     internal recursion guard for delegated repo sync',
    '  --open-update-report        open the generated update report for this run, when one is created',
    '  --enable-update-reports     persist meaningful update report writes',
    '  --disable-update-reports',
    '  --update-report-retention-days <days>',
    '                                positive integer, default: 7',
    '  --enable-update-report-open compatibility alias for failure-only opening; successful reports remain closed',
    '  --disable-update-report-open retain failure-only opening; successful reports remain closed',
    '  --enable-codex-plugin-auto-refresh',
    '                                persist opt-in Codex Toolkit cache refresh and Windows third-party hook repair',
    '  --disable-codex-plugin-auto-refresh',
    '  --audit',
    '  --reconcile-staging <generation-id>',
    '                                audit one new-format owned generation; add --write for exact cleanup',
    '  --force-downgrade',
    '  --sync-source repo|codex-plugin|claude-plugin',
    '  --hub <path>                  test override; defaults to ~/.ai-agent-toolkit/current',
    '  --opencode-config-dir <path>  test or explicit setup override',
    '  --opencode-target <path>      test override for the managed OpenCode skills root',
    '  --python-command <command>    one-run AG2 Python detection override',
    '  --set-ag2-python-command <command>',
    '                                persist an AG2 Python command for future audit and hook runs'
  ].join('\n'));
}

function defaultHubPath() {
  return path.join(os.homedir(), '.ai-agent-toolkit', 'current');
}

function defaultCodexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

function isInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function assertSafeWritePath(targetPath, label) {
  const resolved = path.resolve(targetPath);
  const home = path.resolve(os.homedir());
  const temp = path.resolve(os.tmpdir());
  if (!isInside(home, resolved) && !isInside(temp, resolved)) {
    throw new Error(`${label} must stay under the current user home or temp directory: ${resolved}`);
  }
  return resolved;
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function parseCommandSpec(commandSpec) {
  const raw = String(commandSpec || '').trim();
  if (!raw) return { command: '', args: [] };
  if (fs.existsSync(raw)) return { command: raw, args: [] };

  const parts = [];
  let current = '';
  let quote = '';
  for (const char of raw) {
    if (quote) {
      if (char === quote) quote = '';
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (/\s/.test(char)) {
      if (current) {
        parts.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }
  if (quote) throw new Error(`unterminated quote in command: ${raw}`);
  if (current) parts.push(current);
  return { command: parts[0] || '', args: parts.slice(1) };
}

function commandProbe(command, commandArgs) {
  if (!command) return { ok: false, output: '', error: 'missing command' };
  try {
    const parsed = parseCommandSpec(command);
    if (!parsed.command) return { ok: false, output: '', status: null, error: 'missing command' };
    if (/\.(?:cmd|bat)$/i.test(parsed.command)) {
      return {
        ok: false,
        output: '',
        status: null,
        error: 'shell command shims (.cmd/.bat) are not supported; use a direct executable path such as python.exe'
      };
    }
    const result = spawnSync(parsed.command, [...parsed.args, ...commandArgs], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true
    });
    return {
      ok: result.status === 0,
      output: `${result.stdout || ''}${result.stderr || ''}`.trim(),
      status: result.status,
      error: result.error ? result.error.message : ''
    };
  } catch (error) {
    return { ok: false, output: '', error: error.message };
  }
}

function runCommand(command, commandArgs, options = {}) {
  try {
    const result = spawnSync(command, commandArgs, {
      cwd: options.cwd,
      encoding: 'utf8',
      timeout: options.timeout || 30000,
      windowsHide: true,
      env: { ...process.env, ...(options.env || {}) }
    });
    return {
      ok: result.status === 0,
      status: result.status,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      error: result.error ? result.error.message : ''
    };
  } catch (error) {
    return { ok: false, status: null, stdout: '', stderr: '', error: error.message };
  }
}

function commandOutput(result) {
  return `${result.stdout || ''}${result.stderr || ''}${result.error || ''}`.trim();
}

function isCredentialError(message = '') {
  return /SEC_E_NO_CREDENTIALS|could not read Username|Authentication failed|Authentication|permission denied|terminal prompts disabled/i.test(
    String(message)
  );
}

function fetchWithCredentialFallback(repoPath, branch) {
  const defaultFetch = gitCommand(repoPath, ['fetch', 'origin', branch], { timeout: 120000 });
  if (defaultFetch.ok) return defaultFetch;

  let lastError = commandOutput(defaultFetch);
  if (!isCredentialError(lastError)) return defaultFetch;

  for (const helper of GIT_CREDENTIAL_HELPERS) {
    const fallback = gitCommand(
      repoPath,
      ['-c', `credential.helper=${helper}`, 'fetch', 'origin', branch],
      { timeout: 120000 }
    );
    if (fallback.ok) return fallback;
    const fallbackOutput = commandOutput(fallback);
    if (fallbackOutput) lastError = `${lastError}\n${fallbackOutput}`;
  }
  return {
    ok: false,
    status: defaultFetch.status,
    stdout: '',
    stderr: lastError,
    error: ''
  };
}

function gitCommand(repoPath, args, options = {}) {
  return runCommand('git', args, { cwd: repoPath, timeout: options.timeout || 30000 });
}

function requireGit(repoPath, args, label) {
  const result = gitCommand(repoPath, args);
  if (!result.ok) {
    throw new Error(`${label || `git ${args.join(' ')}`} failed: ${commandOutput(result)}`);
  }
  return result.stdout.trim();
}

function normalizeRemoteForCompare(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const slashValue = raw.replace(/\\/g, '/').replace(/\/+$/, '');
  const githubSsh = slashValue.match(/^git@github\.com:(.+?)(?:\.git)?$/i);
  if (githubSsh) return `https://github.com/${githubSsh[1].replace(/\/+$/, '')}`.toLowerCase();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(slashValue)) {
    try {
      const url = new URL(slashValue);
      url.hash = '';
      url.search = '';
      url.pathname = url.pathname.replace(/\/+$/, '').replace(/\.git$/i, '');
      url.protocol = url.protocol.toLowerCase();
      url.hostname = url.hostname.toLowerCase();
      return url.toString().replace(/\/$/, '');
    } catch {
      return slashValue.replace(/\.git$/i, '').toLowerCase();
    }
  }
  return path.resolve(raw).replace(/\\/g, '/').replace(/\/+$/, '').replace(/\.git$/i, '').toLowerCase();
}

function repoUpdateError(status, message, details = {}) {
  const error = new Error(message);
  error.repoUpdateStatus = status;
  error.repoUpdateDetails = details;
  return error;
}

function applyRepoUpdateStatus(state, status, details = {}) {
  const next = normalizedState(state);
  next.last_repo_update = timestamp();
  next.last_repo_update_status = status;
  next.last_repo_update_from_commit = details.fromCommit || '';
  next.last_repo_update_to_commit = details.toCommit || '';
  next.last_repo_update_error = details.error || '';
  return next;
}

function buildValidationSuite({ hookMode = false } = {}) {
  return [
    {
      label: 'node repo/scripts/validate-toolkit.cjs',
      args: [path.join('repo', 'scripts', 'validate-toolkit.cjs')],
      timeout: VALIDATE_TOOLKIT_TIMEOUT_MS
    },
    hookMode
      ? {
          label: 'node --test repo/tests/toolkit-local-bridge-hook-light.test.cjs',
          args: ['--test', HOOK_LIGHT_VALIDATION_TEST],
          timeout: HOOK_LIGHT_VALIDATION_TIMEOUT_MS
        }
      : {
          label: 'node --test repo/tests/toolkit-local-bridge.test.cjs',
          args: ['--test', FULL_VALIDATION_TEST],
          timeout: VALIDATE_TOOLKIT_TIMEOUT_MS
        }
  ];
}

function getRepoValidationLabels(options = {}) {
  return buildValidationSuite(options).map((entry) => entry.label);
}

function runRepoValidation(repoPath, options = {}) {
  const validations = buildValidationSuite(options);
  const commands = [];
  for (const validation of validations) {
    commands.push(validation.label);
    const result = runCommand(process.execPath, validation.args, {
      cwd: repoPath,
      timeout: validation.timeout
    });
    if (!result.ok) {
      throw repoUpdateError(
        'validation-failed',
        `${validation.label} failed: ${commandOutput(result)}`,
        {
          error: validation.label,
          validationStatus: 'failed',
          validationCommand: validation.label
        }
      );
    }
  }
  return {
    status: 'passed',
    commands
  };
}

function changedFilesBetween(repoPath, fromCommit, toCommit) {
  if (!fromCommit || !toCommit || fromCommit === toCommit) return [];
  const result = gitCommand(repoPath, ['diff', '--name-only', fromCommit, toCommit]);
  if (!result.ok) return [];
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

function validateAndUpdateRepo(state, args = {}) {
  const repoPath = path.resolve(state.repo_path || '');
  const branch = state.repo_branch || DEFAULT_REPO_BRANCH;
  const expectedRemote = state.repo_remote || DEFAULT_REPO_REMOTE;
  if (!state.repo_path) {
    throw repoUpdateError('skipped', 'repo auto-update enabled but repo_path is not configured', {
      error: 'repo_path not configured'
    });
  }
  if (!fs.existsSync(repoPath) || !fs.statSync(repoPath).isDirectory()) {
    throw repoUpdateError('skipped', `configured repo_path does not exist: ${repoPath}`, {
      error: 'repo_path does not exist'
    });
  }
  const inside = gitCommand(repoPath, ['rev-parse', '--is-inside-work-tree']);
  if (!inside.ok || inside.stdout.trim() !== 'true') {
    throw repoUpdateError('skipped', `configured repo_path is not a git worktree: ${repoPath}`, {
      error: 'not a git repo'
    });
  }
  const currentBranch = requireGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'], 'read current branch');
  const remoteResult = gitCommand(repoPath, ['remote', 'get-url', '--all', 'origin']);
  if (!remoteResult.ok) {
    throw repoUpdateError('skipped', `could not read origin remote: ${commandOutput(remoteResult)}`, {
      error: 'origin remote missing'
    });
  }
  const actualRemotes = remoteResult.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const expectedComparable = normalizeRemoteForCompare(expectedRemote);
  if (!actualRemotes.some((remote) => normalizeRemoteForCompare(remote) === expectedComparable)) {
    throw repoUpdateError('skipped', `origin remote does not match configured Toolkit repo remote: ${expectedRemote}`, {
      error: 'remote mismatch'
    });
  }
  const dirty = requireGit(repoPath, ['status', '--porcelain'], 'check working tree');
  if (dirty) {
    throw repoUpdateError('skipped', 'configured repo working tree is dirty; refusing auto-update', {
      error: 'dirty working tree'
    });
  }
  let branchSwitchedFrom = '';
  if (currentBranch !== branch) {
    const switchResult = gitCommand(repoPath, ['switch', branch], { timeout: 120000 });
    if (!switchResult.ok) {
      throw repoUpdateError('skipped', `git switch ${branch} failed: ${commandOutput(switchResult)}`, {
        error: 'branch switch failed'
      });
    }
    branchSwitchedFrom = currentBranch;
  }
  const fromCommit = requireGit(repoPath, ['rev-parse', 'HEAD'], 'read current commit');
  const fetchResult = fetchWithCredentialFallback(repoPath, branch);
  if (!fetchResult.ok) {
    const fetchError = commandOutput(fetchResult) || 'fetch failed';
    const credentialHint = isCredentialError(fetchError)
      ? `\nCredential hint: fetch failed in this environment. Run this command from the same shell/profile that already works for git fetch, or run \`gh auth login\` in this context, then rerun setup/refresh.`
      : '';
    throw repoUpdateError('skipped', `git fetch origin ${branch} failed: ${fetchError}${credentialHint}`, {
      fromCommit,
      branchSwitchedFrom,
      error: 'fetch failed'
    });
  }
  const fetchedCommit = requireGit(repoPath, ['rev-parse', 'FETCH_HEAD'], 'read fetched commit');
  const ancestor = gitCommand(repoPath, ['merge-base', '--is-ancestor', fromCommit, fetchedCommit]);
  if (!ancestor.ok) {
    throw repoUpdateError('skipped', 'fetched update is not a fast-forward from the current repo commit', {
      fromCommit,
      toCommit: fetchedCommit,
      branchSwitchedFrom,
      error: 'not fast-forward'
    });
  }
  if (fromCommit !== fetchedCommit) {
    const merge = gitCommand(repoPath, ['merge', '--ff-only', 'FETCH_HEAD'], { timeout: 120000 });
    if (!merge.ok) {
      throw repoUpdateError('skipped', `git merge --ff-only FETCH_HEAD failed: ${commandOutput(merge)}`, {
        fromCommit,
        toCommit: fetchedCommit,
        branchSwitchedFrom,
        error: 'fast-forward failed'
      });
    }
  }
  const toCommit = requireGit(repoPath, ['rev-parse', 'HEAD'], 'read updated commit');
  const changedFiles = changedFilesBetween(repoPath, fromCommit, toCommit);
  let validation = null;
  try {
    validation = runRepoValidation(repoPath, { hookMode: args.hook === true });
  } catch (error) {
    throw repoUpdateError(error.repoUpdateStatus || 'validation-failed', error.message, {
      fromCommit,
      toCommit,
      changedFiles,
      branchSwitchedFrom,
      error: error.repoUpdateDetails?.error || error.message,
      validationStatus: error.repoUpdateDetails?.validationStatus || 'failed',
      validationCommand: error.repoUpdateDetails?.validationCommand || ''
    });
  }
  return {
    repoPath,
    fromCommit,
    toCommit,
    changedFiles,
    branchSwitchedFrom,
    validation,
    status: fromCommit === toCommit ? 'up-to-date' : 'updated'
  };
}

function compareSemver(left, right) {
  const a = String(left || '0.0.0').split('.').map((part) => Number(part) || 0);
  const b = String(right || '0.0.0').split('.').map((part) => Number(part) || 0);
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] || 0) > (b[index] || 0)) return 1;
    if ((a[index] || 0) < (b[index] || 0)) return -1;
  }
  return 0;
}

function isValidBridgeVersion(value) {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(String(value || ''));
}

function compareBridgeVersions(left, right) {
  const leftParts = String(left).split('.').map((part) => BigInt(part));
  const rightParts = String(right).split('.').map((part) => BigInt(part));
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }
  return 0;
}

function assertRecognizedSyncSource(syncSource) {
  if (!SYNC_SOURCES.includes(syncSource)) {
    throw new Error(`Unsupported bridge sync source: ${syncSource || '<missing>'}`);
  }
}

function normalizeBridgeVersionsBySource(rawMap, legacyHubVersion, legacyLastSyncSource) {
  const normalized = {};
  const plainMap = rawMap && typeof rawMap === 'object' && !Array.isArray(rawMap) ? rawMap : null;
  if (plainMap) {
    for (const source of SYNC_SOURCES) {
      if (!Object.prototype.hasOwnProperty.call(plainMap, source)) continue;
      const version = plainMap[source];
      if (!isValidBridgeVersion(version)) {
        throw new Error(`Invalid bridge_versions_by_source.${source}: expected MAJOR.MINOR.PATCH`);
      }
      normalized[source] = version;
    }
  }

  if (
    !Object.keys(normalized).length &&
    SYNC_SOURCES.includes(legacyLastSyncSource) &&
    isValidBridgeVersion(legacyHubVersion)
  ) {
    normalized[legacyLastSyncSource] = legacyHubVersion;
  }
  return normalized;
}

function maximumBridgeVersion(existingHubVersion, versionsBySource) {
  let maximum = isValidBridgeVersion(existingHubVersion) ? existingHubVersion : '';
  for (const source of SYNC_SOURCES) {
    const version = versionsBySource?.[source];
    if (isValidBridgeVersion(version) && (!maximum || compareBridgeVersions(version, maximum) > 0)) maximum = version;
  }
  return maximum;
}

function defaultTargetState() {
  return {
    enabled: false,
    explicitly_disabled: false,
    detected: false,
    target_path: '',
    synced_version: '',
    synced_checksum: '',
    last_sync: '',
    skip_reason: 'not enabled'
  };
}

function defaultState() {
  return {
    schema_version: STATE_SCHEMA_VERSION,
    architecture_version: ARCHITECTURE_VERSION,
    hub_version: '',
    bridge_versions_by_source: {},
    auto_sync_enabled: false,
    repo_auto_update_enabled: false,
    repo_path: '',
    repo_branch: DEFAULT_REPO_BRANCH,
    repo_remote: DEFAULT_REPO_REMOTE,
    last_repo_update: '',
    last_repo_update_status: '',
    last_repo_update_from_commit: '',
    last_repo_update_to_commit: '',
    last_repo_update_error: '',
    last_update_report_path: '',
    last_update_report_signature: '',
    update_report_enabled: true,
    update_report_open_enabled: false,
    update_report_open_behavior: 'action-required-only',
    legacy_update_report_open_migrated: false,
    update_report_retention_days: DEFAULT_UPDATE_REPORT_RETENTION_DAYS,
    last_update_report_cleanup: null,
    codex_plugin_auto_refresh_enabled: false,
    created_at: '',
    updated_at: '',
    last_sync_source: '',
    targets: {
      opencode: defaultTargetState(),
      ag2: defaultTargetState()
    }
  };
}

function normalizedState(raw) {
  const state = { ...defaultState(), ...(raw || {}) };
  state.bridge_versions_by_source = normalizeBridgeVersionsBySource(
    raw?.bridge_versions_by_source,
    raw?.hub_version,
    raw?.last_sync_source
  );
  state.hub_version = isValidBridgeVersion(raw?.hub_version) ? raw.hub_version : '';
  state.targets = state.targets && typeof state.targets === 'object' ? state.targets : {};
  for (const target of SUPPORTED_TARGETS) {
    state.targets[target] = { ...defaultTargetState(), ...(state.targets[target] || {}) };
  }
  state.targets.ag2.python_command = state.targets.ag2.python_command || '';
  state.repo_branch = state.repo_branch || DEFAULT_REPO_BRANCH;
  state.repo_remote = state.repo_remote || DEFAULT_REPO_REMOTE;
  state.repo_path = state.repo_path || '';
  state.last_repo_update = state.last_repo_update || '';
  state.last_repo_update_status = state.last_repo_update_status || '';
  state.last_repo_update_from_commit = state.last_repo_update_from_commit || '';
  state.last_repo_update_to_commit = state.last_repo_update_to_commit || '';
  state.last_repo_update_error = state.last_repo_update_error || '';
  state.last_update_report_path = state.last_update_report_path || '';
  state.last_update_report_signature = state.last_update_report_signature || '';
  state.update_report_enabled = state.update_report_enabled !== false;
  state.legacy_update_report_open_migrated = raw?.update_report_open_enabled === true
    || raw?.legacy_update_report_open_migrated === true;
  state.update_report_open_enabled = false;
  state.update_report_open_behavior = 'action-required-only';
  state.update_report_retention_days = Number.isInteger(state.update_report_retention_days) && state.update_report_retention_days > 0
    ? state.update_report_retention_days
    : DEFAULT_UPDATE_REPORT_RETENTION_DAYS;
  state.last_update_report_cleanup = state.last_update_report_cleanup && typeof state.last_update_report_cleanup === 'object'
    ? state.last_update_report_cleanup
    : null;
  state.codex_plugin_auto_refresh_enabled = state.codex_plugin_auto_refresh_enabled === true;
  return state;
}

function applyRequestedState(state, args) {
  const next = normalizedState(state);
  if (args.enableAutoSync) next.auto_sync_enabled = true;
  if (args.disableAutoSync) next.auto_sync_enabled = false;
  if (args.repoPath) next.repo_path = path.resolve(args.repoPath);
  if (args.repoBranch) next.repo_branch = args.repoBranch;
  if (args.repoRemote) next.repo_remote = args.repoRemote;
  if (args.enableRepoAutoUpdate) {
    next.repo_auto_update_enabled = true;
    next.last_repo_update_status = 'configured';
    next.last_repo_update_error = '';
  }
  if (args.disableRepoAutoUpdate) {
    next.repo_auto_update_enabled = false;
    next.last_repo_update_status = 'disabled';
    next.last_repo_update_error = '';
  }
  if (args.enableUpdateReportOpen || args.disableUpdateReportOpen) next.update_report_open_enabled = false;
  if (args.enableUpdateReports) next.update_report_enabled = true;
  if (args.disableUpdateReports) next.update_report_enabled = false;
  if (args.updateReportRetentionDaysExplicit) next.update_report_retention_days = args.updateReportRetentionDays;
  if (args.enableCodexPluginAutoRefresh) next.codex_plugin_auto_refresh_enabled = true;
  if (args.disableCodexPluginAutoRefresh) next.codex_plugin_auto_refresh_enabled = false;
  if (args.setAg2PythonCommand) {
    next.targets.ag2.python_command = args.setAg2PythonCommand;
  }
  for (const target of args.enableTargets) {
    next.targets[target].enabled = true;
    next.targets[target].explicitly_disabled = false;
  }
  for (const target of args.disableTargets) {
    next.targets[target].enabled = false;
    next.targets[target].explicitly_disabled = true;
    next.targets[target].skip_reason = 'explicitly disabled';
  }
  return next;
}

function discoverOpenCode(args, targetState, hubPath) {
  const envConfig = args.opencodeConfigDir || process.env.OPENCODE_CONFIG_DIR || '';
  const homeConfig = path.join(os.homedir(), '.config', 'opencode');
  const configDir = envConfig || homeConfig;
  const internalAdapterPath = path.join(hubPath, 'adapters', 'opencode');
  const persistedState = Boolean(
    targetState.detected ||
    targetState.target_path ||
    targetState.synced_version ||
    targetState.synced_checksum ||
    targetState.last_sync
  );
  const defaultTarget = path.join(configDir, 'skills');
  const requestedTarget = args.opencodeTarget || targetState.target_path || defaultTarget;
  const configuredTarget = normalizeOpenCodeTargetPath(requestedTarget, defaultTarget);
  const command = commandProbe(args.opencodeCommand, ['--version']);
  const configExists = fs.existsSync(configDir);
  const targetExists = fs.existsSync(configuredTarget);
  const migratedTargetPath = path.resolve(configuredTarget) !== path.resolve(requestedTarget);
  const explicitlyEnabled = targetState.enabled === true;
  const detected = command.ok || Boolean(envConfig) || configExists || targetExists || explicitlyEnabled || persistedState;
  return {
    target: 'opencode',
    detected,
    target_path: configuredTarget,
    internal_adapter_path: internalAdapterPath,
    signals: {
      command_ok: command.ok,
      command_output: command.output,
      env_config_dir: Boolean(envConfig),
      config_dir: configDir,
      config_dir_exists: configExists,
      target_exists: targetExists,
      migrated_target_path: migratedTargetPath,
      requested_target_path: requestedTarget,
      persisted_state: persistedState,
      explicitly_enabled: explicitlyEnabled
    }
  };
}

function normalizeOpenCodeTargetPath(targetPath, defaultTarget) {
  const raw = String(targetPath || '').trim();
  if (!raw) return defaultTarget;
  const resolved = path.resolve(raw);
  if (
    path.basename(resolved) === TOOLKIT_NAME &&
    path.basename(path.dirname(resolved)) === 'skills'
  ) {
    return path.dirname(resolved);
  }
  return raw;
}

function readDirectoryNames(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function readDirectoryFileNames(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function isValidSkillName(name) {
  return SKILL_NAME_PATTERN.test(String(name || ''));
}

function ag2EnvPythonCandidates() {
  const candidates = [];
  if (process.env.UV_PYTHON) candidates.push(process.env.UV_PYTHON);
  if (process.env.VIRTUAL_ENV) {
    candidates.push(path.join(process.env.VIRTUAL_ENV, process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'python.exe' : 'python'));
  }
  if (process.env.CONDA_PREFIX) {
    candidates.push(path.join(process.env.CONDA_PREFIX, process.platform === 'win32' ? 'python.exe' : 'bin/python'));
  }
  return candidates;
}

function windowsUserPythonCandidates() {
  if (process.platform !== 'win32') return [];
  const candidates = [];
  const home = os.homedir();
  if (home) {
    const localBin = path.join(home, '.local', 'bin');
    for (const fileName of readDirectoryFileNames(localBin)
      .filter((name) => /^python.*\.exe$/i.test(name))
      .sort((left, right) => left.localeCompare(right))) {
      candidates.push(path.join(localBin, fileName));
    }
    const pyenvRoot = path.join(home, '.pyenv', 'pyenv-win', 'versions');
    for (const version of readDirectoryNames(pyenvRoot)) {
      candidates.push(path.join(pyenvRoot, version, 'python.exe'));
    }
  }
  const localAppData = process.env.LOCALAPPDATA || (home ? path.join(home, 'AppData', 'Local') : '');
  if (localAppData) {
    const pythonRoot = path.join(localAppData, 'Programs', 'Python');
    for (const version of readDirectoryNames(pythonRoot)) {
      candidates.push(path.join(pythonRoot, version, 'python.exe'));
    }
  }
  return candidates.filter((candidate) => fs.existsSync(candidate));
}

function uniqueCommandCandidates(commands) {
  const seen = new Set();
  const result = [];
  for (const command of commands.map((item) => String(item || '').trim()).filter(Boolean)) {
    const key = process.platform === 'win32' ? command.toLowerCase() : command;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(command);
  }
  return result;
}

function ag2PythonCandidates(args, targetState) {
  return uniqueCommandCandidates([
    targetState.python_command,
    args.pythonCommand,
    'python',
    'python3',
    'py',
    ...ag2EnvPythonCandidates(),
    ...windowsUserPythonCandidates()
  ]);
}

function probeAg2Python(command) {
  const python = commandProbe(command, ['--version']);
  const ag2Package = python.ok ? commandProbe(command, ['-m', 'pip', 'show', 'ag2']) : {
    ok: false,
    output: '',
    status: null,
    error: 'python command did not run'
  };
  return {
    command,
    python_ok: python.ok,
    python_output: python.output,
    python_status: python.status,
    python_error: python.error || '',
    ag2_package_ok: ag2Package.ok,
    ag2_package_output: ag2Package.output,
    ag2_package_status: ag2Package.status,
    ag2_package_error: ag2Package.error || ''
  };
}

function discoverAg2(args, targetState, hubPath) {
  const candidates = ag2PythonCandidates(args, targetState);
  const tried = [];
  let selected = null;
  for (const candidate of candidates) {
    const attempt = probeAg2Python(candidate);
    tried.push(attempt);
    if (attempt.python_ok && attempt.ag2_package_ok) {
      selected = attempt;
      break;
    }
  }
  const internalAdapterPath = path.join(hubPath, 'adapters', 'ag2');
  const home = os.homedir();
  const antigravityConfigDir = home ? path.join(home, '.antigravity') : '';
  const geminiConfigDir = home ? path.join(home, '.gemini', 'config') : '';
  const geminiPluginsDir = geminiConfigDir ? path.join(geminiConfigDir, 'plugins') : '';
  const defaultTargetPath = geminiPluginsDir ? path.join(geminiPluginsDir, TOOLKIT_NAME) : '';
  const savedTargetPath = String(targetState.target_path || '');
  const targetPath = savedTargetPath && path.resolve(savedTargetPath) !== path.resolve(internalAdapterPath)
    ? savedTargetPath
    : defaultTargetPath;
  const antigravityConfigExists = Boolean(antigravityConfigDir && fs.existsSync(antigravityConfigDir));
  const geminiConfigExists = Boolean(geminiConfigDir && fs.existsSync(geminiConfigDir));
  const geminiPluginsDirExists = Boolean(geminiPluginsDir && fs.existsSync(geminiPluginsDir));
  const managedAdapterExists = fs.existsSync(internalAdapterPath);
  const appTargetExists = Boolean(targetPath && fs.existsSync(targetPath));
  const persistedState = Boolean(
    targetState.detected ||
    targetState.target_path ||
    targetState.synced_version ||
    targetState.synced_checksum ||
    targetState.last_sync
  );
  const explicitlyEnabled = targetState.enabled === true;
  const ag2PackageDetected = Boolean(selected);
  const detected = (
    ag2PackageDetected ||
    antigravityConfigExists ||
    geminiConfigExists ||
    geminiPluginsDirExists ||
    managedAdapterExists ||
    appTargetExists ||
    persistedState ||
    explicitlyEnabled
  );
  return {
    target: 'ag2',
    detected,
    target_path: targetPath,
    internal_adapter_path: internalAdapterPath,
    python_command: selected?.command || '',
    ag2_package_detected: ag2PackageDetected,
    signals: {
      selected_python_command: selected?.command || '',
      tried_python_commands: tried,
      antigravity_config_dir: antigravityConfigDir,
      antigravity_config_exists: antigravityConfigExists,
      gemini_config_dir: geminiConfigDir,
      gemini_config_exists: geminiConfigExists,
      gemini_plugins_dir: geminiPluginsDir,
      gemini_plugins_dir_exists: geminiPluginsDirExists,
      managed_adapter_exists: managedAdapterExists,
      app_target_exists: appTargetExists,
      persisted_state: persistedState,
      explicitly_enabled: explicitlyEnabled
    }
  };
}

function hasToolkitSkillSource(sourceRoot) {
  const skillsRoot = path.join(sourceRoot, 'skills');
  return fs.existsSync(skillsRoot) && fs.statSync(skillsRoot).isDirectory();
}

function hasGitMetadata(sourceRoot) {
  return fs.existsSync(path.join(sourceRoot, '.git'));
}

function isTrustedGitWorktree(sourceRoot) {
  if (hasGitMetadata(sourceRoot)) return true;
  const result = gitCommand(sourceRoot, ['rev-parse', '--is-inside-work-tree'], { timeout: 5000 });
  return result.ok && result.stdout.trim() === 'true';
}

function resolveToolkitSourceRoot(state = {}) {
  if (state.repo_path) {
    const repoPath = path.resolve(state.repo_path);
    if (!hasToolkitSkillSource(repoPath)) {
      throw new Error(`configured Toolkit repo_path does not contain skills/: ${repoPath}`);
    }
    if (!isTrustedGitWorktree(repoPath)) {
      throw new Error(`configured Toolkit repo_path is not a git worktree: ${repoPath}`);
    }
    return repoPath;
  }

  const scriptRoot = pluginRootFromCwd() || path.resolve(__dirname, '..', '..');
  if (hasToolkitSkillSource(scriptRoot) && isTrustedGitWorktree(scriptRoot)) return scriptRoot;

  throw new Error(
    'Toolkit full skill sync requires a trusted local Toolkit git repo source; run the bridge from the repo or configure repo auto-update with --repo-path.'
  );
}

function collectFilesRecursively(rootDir) {
  const files = {};

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const relPath = slash(path.relative(rootDir, fullPath));
      files[relPath] = fs.readFileSync(fullPath);
    }
  }

  walk(rootDir);
  return files;
}

function collectToolkitSkills(sourceRoot) {
  const skillsRoot = path.join(sourceRoot, 'skills');
  const skills = {};
  for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter((item) => item.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))) {
    if (!isValidSkillName(entry.name)) continue;
    const skillRoot = path.join(skillsRoot, entry.name);
    if (!fs.existsSync(path.join(skillRoot, 'SKILL.md'))) continue;
    if (entry.name === TOOLKIT_NAME) {
      throw new Error(`Toolkit repo skills/ contains reserved bridge adapter skill name: ${TOOLKIT_NAME}`);
    }
    skills[entry.name] = collectFilesRecursively(skillRoot);
  }
  return skills;
}

function textPayload(text) {
  return Buffer.from(text, 'utf8');
}

function targetManifestPayload(targetName, skillNames) {
  return textPayload(`${JSON.stringify({
    managed_by: TARGET_MANIFEST_MARKER,
    schema_version: 1,
    target: targetName,
    architecture_version: ARCHITECTURE_VERSION,
    bridge_version: BRIDGE_VERSION,
    managed_skill_names: [...skillNames].sort()
  }, null, 2)}\n`);
}

function addSkillToPayload(payload, skillName, files, prefix = 'skills') {
  for (const [relPath, content] of Object.entries(files)) {
    payload[`${prefix}/${skillName}/${relPath}`] = Buffer.isBuffer(content) ? content : textPayload(String(content));
  }
}

function adapterPayloads(state = {}, sourceRoot = resolveToolkitSourceRoot(state)) {
  const toolkitSkills = collectToolkitSkills(sourceRoot);
  const toolkitSkillNames = Object.keys(toolkitSkills).sort();
  const opencodeSkill = [
    '---',
    'name: ai-agent-toolkit',
    'description: Use when working in OpenCode with the AI Agent Toolkit local bridge. Applies source-first policy, opt-in bridge setup, and audit/sync commands without using Codex or Claude private plugin caches.',
    '---',
    '',
    '# AI Agent Toolkit Bridge',
    '',
    'Use this skill when OpenCode needs Toolkit policy, bridge audit, or enabled-target sync guidance.',
    '',
    'Core rules:',
    '',
    '- Treat AGENTS.md and Toolkit skills/docs as portable policy. Hooks are optional automation only.',
    '- Do not install or update Codex or Claude Code from OpenCode.',
    '- Do not read Codex or Claude private plugin cache paths as bridge source.',
    '- Do not install npm, pip, Python, AG2, OpenCode, or any package by default.',
    '- Do not mutate project repos by default.',
    '- Use the Toolkit Local Bridge Hub manifest and state files under the user-local hub.',
    '',
    'Useful commands:',
    '',
    '```powershell',
    'node repo/scripts/toolkit-local-bridge.cjs --audit',
    'node repo/scripts/toolkit-local-bridge.cjs --sync-enabled --write',
    '```',
    ''
  ].join('\n');

  const opencodeReadme = [
    '# AI Agent Toolkit OpenCode Adapter',
    '',
    'Generated by the Toolkit Local Bridge Hub after the user explicitly enables the OpenCode target.',
    '',
    'This folder is safe to load from the OpenCode global skills directory. It is not source of truth. Update Toolkit through the native Codex or Claude Code plugin package and let the bridge sync enabled targets.',
    ''
  ].join('\n');

  const ag2Plugin = {
    name: TOOLKIT_NAME,
    version: BRIDGE_VERSION,
    description: 'AI Agent Toolkit local bridge adapter for Antigravity 2.',
    author: {
      name: 'AI Agent Toolkit'
    },
    repository: DEFAULT_REPO_REMOTE,
    license: 'UNLICENSED'
  };

  const ag2Readme = [
    '# AI Agent Toolkit Antigravity 2 Adapter',
    '',
    'Generated by the Toolkit Local Bridge Hub after the user explicitly enables the Antigravity 2 target.',
    '',
    'This plugin-scoped skill folder is safe to load from the Antigravity/Gemini user plugin config. It is not source of truth. Update Toolkit through the native Codex or Claude Code plugin package and let the bridge sync enabled targets.',
    ''
  ].join('\n');

  const ag2Skill = [
    '---',
    `name: ${TOOLKIT_NAME}`,
    'description: Use when working in Antigravity 2 with the AI Agent Toolkit local bridge. Applies source-first policy, opt-in bridge setup, and audit/sync commands without using Codex or Claude private plugin caches.',
    '---',
    '',
    '# AI Agent Toolkit AG2 Adapter',
    '',
    'Use this skill when Antigravity 2 needs Toolkit policy, bridge audit, or enabled-target sync guidance.',
    '',
    'Core rules:',
    '',
    '- Treat AGENTS.md and Toolkit skills/docs as portable policy. Hooks are optional automation only.',
    '- Do not install or update Codex or Claude Code from Antigravity 2.',
    '- Do not read Codex or Claude private plugin cache paths as bridge source.',
    '- Do not install npm, pip, Python, AG2, Antigravity 2, OpenCode, or any package by default.',
    '- Do not mutate project repos by default.',
    '- Use the Toolkit Local Bridge Hub manifest and state files under the user-local hub.',
    '',
    'Useful commands:',
    '',
    '```powershell',
    'node repo/scripts/toolkit-local-bridge.cjs --audit',
    'node repo/scripts/toolkit-local-bridge.cjs --sync-enabled --write',
    '```',
    ''
  ].join('\n');

  const ag2Metadata = {
    name: 'ai-agent-toolkit-ag2-adapter',
    architecture_version: ARCHITECTURE_VERSION,
    toolkit_bridge_version: BRIDGE_VERSION,
    description: 'Local AG2 adapter metadata generated by the Toolkit Local Bridge Hub after explicit AG2 enablement.',
    policy: {
      source_of_truth: 'Toolkit source, skills, docs, validators, and native plugin package state',
      no_package_install_by_default: true,
      no_project_repo_mutation_by_default: true,
      no_codex_or_claude_cross_update: true,
      hooks_are_optional_automation_only: true
    }
  };

  const adapterFiles = {
    'SKILL.md': textPayload(opencodeSkill),
    'README.md': textPayload(opencodeReadme)
  };
  const ag2AdapterFiles = {
    'SKILL.md': textPayload(ag2Skill),
    'README.md': textPayload(ag2Readme)
  };
  const managedSkillNames = [TOOLKIT_NAME, ...toolkitSkillNames].sort();
  const opencodePayload = {
    [TARGET_MANIFEST_FILE]: targetManifestPayload('opencode', managedSkillNames)
  };
  const ag2Payload = {
    'plugin.json': textPayload(`${JSON.stringify(ag2Plugin, null, 2)}\n`),
    'installed_version.json': textPayload(`${JSON.stringify({ version: BRIDGE_VERSION }, null, 2)}\n`),
    'README.md': textPayload(ag2Readme),
    'ai-agent-toolkit-ag2-adapter.json': textPayload(`${JSON.stringify(ag2Metadata, null, 2)}\n`),
    [TARGET_MANIFEST_FILE]: targetManifestPayload('ag2', managedSkillNames)
  };

  for (const [skillName, files] of Object.entries(toolkitSkills)) {
    addSkillToPayload(opencodePayload, skillName, files);
    addSkillToPayload(ag2Payload, skillName, files);
  }
  addSkillToPayload(opencodePayload, TOOLKIT_NAME, adapterFiles);
  addSkillToPayload(ag2Payload, TOOLKIT_NAME, ag2AdapterFiles);

  return {
    opencode: opencodePayload,
    ag2: ag2Payload
  };
}

function payloadBytes(value) {
  return Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
}

function payloadChecksum(payloads) {
  const hash = crypto.createHash('sha256');
  for (const target of Object.keys(payloads).sort()) {
    for (const rel of Object.keys(payloads[target]).sort()) {
      hash.update(target);
      hash.update('\0');
      hash.update(rel);
      hash.update('\0');
      hash.update(payloadBytes(payloads[target][rel]));
      hash.update('\0');
    }
  }
  return hash.digest('hex');
}

function filePayloadChecksum(payload) {
  const hash = crypto.createHash('sha256');
  for (const rel of Object.keys(payload).sort()) {
    hash.update(rel);
    hash.update('\0');
    hash.update(payloadBytes(payload[rel]));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function appTargetPayload(targetName, payloads) {
  if (targetName === 'opencode') {
    const prefix = 'skills/';
    return Object.fromEntries(Object.entries(payloads.opencode)
      .map(([rel, text]) => [rel.startsWith(prefix) ? rel.slice(prefix.length) : rel, text]));
  }
  if (targetName === 'ag2') return payloads.ag2;
  throw new Error(`Unsupported target: ${targetName}`);
}

function targetSkillNames(targetName, payloads) {
  const names = new Set();
  const payload = appTargetPayload(targetName, payloads);
  for (const rel of Object.keys(payload)) {
    const normalized = slash(rel);
    if (targetName === 'ag2') {
      const match = normalized.match(/^skills\/([^/]+)\//);
      if (match && isValidSkillName(match[1])) names.add(match[1]);
      continue;
    }
    const first = normalized.split('/')[0];
    if (first && isValidSkillName(first)) names.add(first);
  }
  return [...names].sort();
}

function readManagedTargetManifest(targetPath) {
  const manifest = readJsonIfExists(path.join(targetPath, TARGET_MANIFEST_FILE));
  if (!manifest || manifest.managed_by !== TARGET_MANIFEST_MARKER) return null;
  return manifest;
}

function previousManagedSkillNames(targetPath) {
  const manifest = readManagedTargetManifest(targetPath);
  if (!manifest || !Array.isArray(manifest.managed_skill_names)) return [];
  return manifest.managed_skill_names
    .map((name) => String(name || '').trim())
    .filter(isValidSkillName)
    .sort();
}

function targetHasNoStaleManagedSkills(targetName, targetPath, payloads) {
  if (!targetPath) return false;
  const previous = previousManagedSkillNames(targetPath);
  if (!previous.length) return true;
  const current = new Set(targetSkillNames(targetName, payloads));
  return previous.every((name) => current.has(name));
}

function targetOutputChecksum(targetPath, payload) {
  if (!targetPath) return '';
  const actual = {};
  for (const rel of Object.keys(payload)) {
    const filePath = path.join(targetPath, rel);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return '';
    actual[rel] = fs.readFileSync(filePath);
  }
  return filePayloadChecksum(actual);
}

function targetOutputIsCurrent(targetName, discovery, payloads) {
  const payload = appTargetPayload(targetName, payloads);
  return (
    targetOutputChecksum(discovery.target_path, payload) === filePayloadChecksum(payload) &&
    targetHasNoStaleManagedSkills(targetName, discovery.target_path, payloads)
  );
}

function targetOutputExists(targetName, discovery, payloads) {
  const payload = appTargetPayload(targetName, payloads);
  if (!discovery.target_path) return false;
  return Object.keys(payload).every((rel) => fs.existsSync(path.join(discovery.target_path, rel)));
}

function pluginRootFromCwd() {
  let current = __dirname;
  for (let index = 0; index < 6; index += 1) {
    if (fs.existsSync(path.join(current, '.codex-plugin'))) return current;
    if (fs.existsSync(path.join(current, '.claude-plugin'))) return current;
    current = path.dirname(current);
  }
  return '';
}

function currentToolkitCommit(state = {}) {
  const root = state.repo_path ? path.resolve(state.repo_path) : (pluginRootFromCwd() || path.resolve(__dirname, '..', '..'));
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 3000, windowsHide: true });
  return result.status === 0 ? result.stdout.trim() : 'unknown';
}

function updateReportDir() {
  return path.join(os.tmpdir(), ...UPDATE_REPORT_ROOT.split('/'));
}

function cleanupUpdateReports(options = {}) {
  const reportDir = path.resolve(options.reportDir || updateReportDir());
  const expectedDir = path.resolve(options.expectedDir || updateReportDir());
  const retentionDays = Number.isInteger(options.retentionDays) && options.retentionDays > 0
    ? options.retentionDays
    : DEFAULT_UPDATE_REPORT_RETENTION_DAYS;
  const maxReports = Number.isInteger(options.maxReports) && options.maxReports > 0
    ? options.maxReports
    : DEFAULT_UPDATE_REPORT_MAX_FILES;
  const nowMs = options.nowMs || Date.now();
  const cutoffMs = nowMs - (retentionDays * 24 * 60 * 60 * 1000);
  const currentRunPath = options.currentRunPath ? path.resolve(options.currentRunPath) : '';
  const result = {
    retention_days: retentionDays,
    report_log_directory: reportDir,
    max_report_files: maxReports,
    deleted_count: 0,
    skipped_count: 0,
    error_count: 0,
    errors: []
  };

  if (reportDir !== expectedDir || !isInside(expectedDir, reportDir)) {
    result.error_count += 1;
    result.errors.push(`refusing cleanup outside Toolkit report directory: ${reportDir}`);
    return result;
  }
  if (!fs.existsSync(reportDir)) return result;

  let entries = [];
  try {
    entries = fs.readdirSync(reportDir, { withFileTypes: true });
  } catch (error) {
    result.error_count += 1;
    result.errors.push(error.message);
    return result;
  }

  const retainedReports = [];
  for (const entry of entries) {
    const filePath = path.join(reportDir, entry.name);
    if (!entry.isFile() || !/^toolkit-update-\d{8}-\d{6}(?:-\d+)?\.md$/.test(entry.name)) {
      result.skipped_count += 1;
      continue;
    }
    if (currentRunPath && path.resolve(filePath) === currentRunPath) {
      result.skipped_count += 1;
      continue;
    }
    try {
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs >= cutoffMs) retainedReports.push({ filePath, mtimeMs: stat.mtimeMs });
      else {
        fs.rmSync(filePath);
        result.deleted_count += 1;
      }
    } catch (error) {
      result.error_count += 1;
      result.errors.push(`${filePath}: ${error.message}`);
    }
  }

  retainedReports.sort((left, right) => (
    right.mtimeMs - left.mtimeMs ||
    right.filePath.localeCompare(left.filePath)
  ));
  retainedReports.forEach((entry, index) => {
    if (index < maxReports) {
      result.skipped_count += 1;
      return;
    }
    try {
      fs.rmSync(entry.filePath);
      result.deleted_count += 1;
    } catch (error) {
      result.error_count += 1;
      result.errors.push(`${entry.filePath}: ${error.message}`);
    }
  });

  return result;
}

function updateReportTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join('');
}

function nextUpdateReportPath(date = new Date()) {
  const reportDir = updateReportDir();
  const baseName = `toolkit-update-${updateReportTimestamp(date)}`;
  let candidate = path.join(reportDir, `${baseName}.md`);
  let index = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(reportDir, `${baseName}-${index}.md`);
    index += 1;
  }
  return candidate;
}

function isUpdateReportPath(reportPath, options = {}) {
  const resolved = path.resolve(reportPath || '');
  const reportDir = path.resolve(options.reportDir || updateReportDir());
  const fileName = path.basename(resolved);
  return (
    isInside(reportDir, resolved) &&
    /^toolkit-update-\d{8}-\d{6}(?:-\d+)?\.md$/.test(fileName) &&
    fs.existsSync(resolved) &&
    fs.statSync(resolved).isFile()
  );
}

function openUpdateReport(reportPath, options = {}) {
  const platform = options.platform || process.platform;
  const spawnImpl = options.spawnImpl || spawn;
  const resolved = path.resolve(reportPath || '');
  if (platform !== 'win32') return { ok: false, skipped: 'not-windows' };
  if (!isUpdateReportPath(resolved, { reportDir: options.reportDir })) return { ok: false, skipped: 'unsafe-report-path' };
  try {
    const child = spawnImpl('notepad.exe', [resolved], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    });
    if (child && typeof child.unref === 'function') child.unref();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function inlineCode(value) {
  return `\`${String(value || '').replace(/`/g, "'")}\``;
}

function normalizeManagedBlockText(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .trim();
}

function markerIdentity(source, label) {
  return `${source}::${label}`;
}

function parseManagedMarkerBlocks(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const markerPattern = /^\s*<!--\s*AI-AGENT-TOOLKIT:(.+?):(BEGIN|END)\s+(.+?)\s*-->\s*$/;
  const blocks = new Map();
  const errors = [];
  let current = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/^\s*<!--\s*AI-AGENT-TOOLKIT:/.test(line)) continue;
    const match = line.match(markerPattern);
    if (!match) {
      errors.push(`line ${index + 1}: malformed AI-AGENT-TOOLKIT managed marker`);
      continue;
    }
    const source = match[1].trim();
    const action = match[2];
    const rawLabel = match[3].trim();
    const label = action === 'BEGIN' ? rawLabel.replace(/\s+v\d+$/i, '').trim() : rawLabel;
    const key = markerIdentity(source, label);

    if (action === 'BEGIN') {
      if (current) {
        errors.push(`line ${index + 1}: nested managed marker before END for ${current.label}`);
        continue;
      }
      current = {
        source,
        label,
        key,
        startLine: index
      };
      continue;
    }

    if (!current) {
      errors.push(`line ${index + 1}: END marker without matching BEGIN for ${label}`);
      continue;
    }
    if (current.source !== source || current.label !== label) {
      errors.push(`line ${index + 1}: END marker ${label} does not match BEGIN ${current.label}`);
      current = null;
      continue;
    }
    if (blocks.has(key)) {
      errors.push(`line ${index + 1}: duplicate managed block ${label}`);
      current = null;
      continue;
    }
    const blockText = lines.slice(current.startLine, index + 1).join('\n');
    blocks.set(key, {
      source,
      label,
      key,
      startLine: current.startLine + 1,
      endLine: index + 1,
      text: normalizeManagedBlockText(blockText)
    });
    current = null;
  }

  if (current) errors.push(`line ${current.startLine + 1}: BEGIN marker without matching END for ${current.label}`);
  return { blocks, errors };
}

function agentRulesPreflightSpecs(syncSource) {
  return AGENT_RULES_PREFLIGHT_FILES[syncSource] || [];
}

function nearestGitRoot(startPath) {
  let current = path.resolve(startPath || process.cwd());
  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return '';
    current = parent;
  }
}

function agentRulesPluginRoot(args, options = {}) {
  if (options.pluginRoot) return path.resolve(options.pluginRoot);
  if (args.syncSource === 'claude-plugin') return runtimeClaudePluginRoot();
  return runtimeCodexPluginRoot();
}

function compareAgentRuleFile({ targetRoot, templateRoot, spec }) {
  const targetPath = path.join(targetRoot, spec.target);
  const templatePath = path.join(templateRoot, spec.template);
  if (!fs.existsSync(templatePath)) {
    return [{
      file: spec.target,
      kind: 'template-missing',
      detail: `bundled template missing: ${slash(templatePath)}`
    }];
  }
  const template = parseManagedMarkerBlocks(fs.readFileSync(templatePath, 'utf8'));
  if (template.errors.length) {
    return template.errors.map((error) => ({
      file: spec.target,
      kind: 'template-broken',
      detail: error
    }));
  }
  if (!fs.existsSync(targetPath)) {
    return [{
      file: spec.target,
      kind: 'missing',
      detail: 'required instruction file is missing'
    }];
  }
  if (!fs.statSync(targetPath).isFile()) {
    return [{
      file: spec.target,
      kind: 'not-file',
      detail: 'required instruction path is not a file'
    }];
  }
  const target = parseManagedMarkerBlocks(fs.readFileSync(targetPath, 'utf8'));
  if (target.errors.length) {
    return target.errors.map((error) => ({
      file: spec.target,
      kind: 'broken-marker',
      detail: error
    }));
  }
  if (target.blocks.size === 0) {
    return [{
      file: spec.target,
      kind: 'unmanaged',
      detail: 'no complete AI-AGENT-TOOLKIT managed marker pair found'
    }];
  }

  const findings = [];
  for (const [key, templateBlock] of template.blocks) {
    const targetBlock = target.blocks.get(key);
    if (!targetBlock) {
      findings.push({
        file: spec.target,
        kind: 'missing-block',
        block: templateBlock.label,
        detail: `missing managed block ${templateBlock.label}`
      });
      continue;
    }
    if (targetBlock.text !== templateBlock.text) {
      findings.push({
        file: spec.target,
        kind: 'stale-block',
        block: templateBlock.label,
        detail: `managed block ${templateBlock.label} differs from the bundled template`
      });
    }
  }
  return findings;
}

function runAgentRulesPreflight(args, options = {}) {
  if (!args.hook) return { status: 'not-applicable', targetRoot: '', findings: [] };
  const specs = agentRulesPreflightSpecs(args.syncSource);
  if (!specs.length) return { status: 'not-applicable', targetRoot: '', findings: [] };

  const startRoot = path.resolve(options.targetRoot || process.cwd());
  const gitRoot = nearestGitRoot(startRoot);
  const targetRoot = gitRoot || startRoot;
  const pluginRoot = agentRulesPluginRoot(args, options);
  const templateRoot = path.join(pluginRoot, AGENT_RULES_TEMPLATE_DIR);
  const findings = [];
  for (const spec of specs) {
    findings.push(...compareAgentRuleFile({ targetRoot, templateRoot, spec }));
  }
  return {
    status: findings.length ? 'needs-attention' : 'ok',
    targetRoot,
    gitRoot,
    gitRepoDetected: Boolean(gitRoot),
    pluginRoot,
    templateRoot,
    findings
  };
}

function formatAgentRulesPreflight(result) {
  const findings = result.findings || [];
  if (!findings.length) return '';
  const shown = findings.slice(0, AGENT_RULES_PREFLIGHT_MAX_FINDINGS);
  const missingRootAgents = Boolean(result.gitRepoDetected) &&
    findings.some((finding) => finding.file === 'AGENTS.md' && finding.kind === 'missing');
  const staleOrBrokenManagedContent = findings.some((finding) => [
    'broken-marker',
    'missing-block',
    'stale-block',
    'template-broken',
    'unmanaged'
  ].includes(finding.kind));
  const lines = [
    'Toolkit agent-rules preflight: repo-local instructions need attention in the current repository.',
    ...shown.map((finding) => `- ${finding.file}: ${finding.detail}`)
  ];
  if (missingRootAgents) {
    lines.unshift("STOP: Root AGENTS.md is missing. Toolkit repo-local ai-coding-agent-rules are not installed in this Git repository. Stop before repository work. Ask the user whether to install/repair Toolkit repo-local rules now or proceed without Toolkit repo-local rules. Do not install, repair, create, or write anything without the user's decision.");
  } else if (staleOrBrokenManagedContent) {
    lines.unshift("STOP: Toolkit-managed repo-local instruction blocks are stale or broken. Stop before repository work. Ask the user whether to repair/refresh Toolkit repo-local rules now or proceed without current Toolkit repo-local rules. Do not repair, refresh, create backups, or write anything without the user's decision.");
  } else {
    lines.unshift("STOP: Toolkit repo-local instructions need attention. Stop before repository work. Ask the user whether to install/repair Toolkit repo-local rules now or proceed without current Toolkit repo-local rules. Do not install, repair, create backups, or write anything without the user's decision.");
  }
  if (findings.length > shown.length) {
    lines.push(`- ${findings.length - shown.length} more issue(s) omitted.`);
  }
  lines.push('No files were changed by this hook.');
  return lines.join('\n');
}

function maybePrintAgentRulesPreflight(args) {
  const result = runAgentRulesPreflight(args);
  const message = formatAgentRulesPreflight(result);
  if (message) console.log(message);
  return result;
}

function targetDisplayName(targetName) {
  if (targetName === 'ag2') return 'Antigravity 2';
  if (targetName === 'opencode') return 'OpenCode';
  return targetName;
}

function targetSyncPlan(targetName, discovery, payloads) {
  const skillNames = targetSkillNames(targetName, payloads);
  const previousNames = previousManagedSkillNames(discovery.target_path);
  const current = new Set(skillNames);
  return {
    target: targetName,
    targetPath: discovery.target_path,
    skillNames,
    removedSkillNames: previousNames.filter((name) => !current.has(name)).sort((left, right) => left.localeCompare(right))
  };
}

function isLegacyDelegatedRepoSync(args) {
  return Boolean(
    args.skipRepoAutoUpdate &&
    args.syncSource === 'repo' &&
    args.syncEnabled &&
    args.write &&
    !args.hook &&
    !args.repoUpdateNow
  );
}

function repoReportContextFromState(state, args) {
  if (!isLegacyDelegatedRepoSync(args)) {
    return {
      status: '',
      fromCommit: '',
      toCommit: '',
      changedFiles: [],
      validationStatus: 'not run',
      error: ''
    };
  }
  const status = state.last_repo_update_status || '';
  const fromCommit = state.last_repo_update_from_commit || '';
  const toCommit = state.last_repo_update_to_commit || '';
  const changedFiles = state.repo_path && fromCommit && toCommit
    ? changedFilesBetween(state.repo_path, fromCommit, toCommit)
    : [];
  const validationStatus = status === 'validation-failed'
    ? 'failed'
    : (status && !state.last_repo_update_error ? 'passed' : 'not run');
  return {
    status,
    fromCommit,
    toCommit,
    changedFiles,
    validationStatus,
    error: state.last_repo_update_error || ''
  };
}

function repoReportContextFromUpdate(state, updateResult, previousObservedCommit = '') {
  const branch = state.repo_branch || DEFAULT_REPO_BRANCH;
  const remote = state.repo_remote || DEFAULT_REPO_REMOTE;
  const toCommit = updateResult.toCommit || '';
  const externalAdvanceDetected = Boolean(
    updateResult.status === 'up-to-date' &&
    previousObservedCommit &&
    toCommit &&
    previousObservedCommit !== toCommit
  );
  const externalChangedFiles = externalAdvanceDetected
    ? changedFilesBetween(updateResult.repoPath, previousObservedCommit, toCommit)
    : [];
  return {
    status: updateResult.status,
    repoPath: updateResult.repoPath || state.repo_path || '',
    fromCommit: updateResult.fromCommit,
    toCommit,
    changedFiles: externalAdvanceDetected ? externalChangedFiles : (updateResult.changedFiles || []),
    validationStatus: updateResult.validation?.status || 'passed',
    branch,
    branchSwitchedFrom: updateResult.branchSwitchedFrom || '',
    remote,
    externalAdvanceDetected,
    externalAdvanceFromCommit: externalAdvanceDetected ? previousObservedCommit : '',
    externalAdvanceToCommit: externalAdvanceDetected ? toCommit : ''
  };
}

function shouldConsiderUpdateReport(args, state) {
  return Boolean(
    state.update_report_enabled !== false &&
    !args.suppressUpdateReport &&
    (
      args.hook ||
      args.repoUpdateNow ||
      args.openUpdateReport ||
      isLegacyDelegatedRepoSync(args)
    )
  );
}

function classifyUpdateReport(context) {
  const repoStatus = context.repo?.status || '';
  const cacheStatus = context.nativePluginCache?.status || '';
  const repairStatus = context.thirdPartyHookRepair?.status || '';
  const targetStatus = context.targetSyncStatus || '';
  const actionable = repoStatus === 'validation-failed'
    || repoStatus === 'sync-delegation-failed'
    || (repoStatus === 'skipped' && Boolean(context.repo?.error))
    || ['stale', 'refresh-failed'].includes(cacheStatus)
    || ['repair-failed', 'partial-failed'].includes(repairStatus)
    || ['failed', 'not confirmed'].includes(targetStatus)
    || Boolean(context.warning);
  const successfulActivity = Boolean(context.repo?.branchSwitchedFrom)
    || repoStatus === 'updated'
    || Boolean(context.repo?.externalAdvanceDetected)
    || cacheStatus === 'refreshed'
    || repairStatus === 'repaired'
    || (context.targetSyncs || []).length > 0
    || (context.targetSyncs || []).some((entry) => (entry.removedSkillNames || []).length > 0);
  return {
    meaningful: actionable || successfulActivity,
    actionable,
    kind: actionable ? 'action-required' : (successfulActivity ? 'successful-activity' : 'no-op'),
  };
}

function updateReportIsMeaningful(context) {
  return classifyUpdateReport(context).meaningful;
}

function shortCommit(value) {
  const text = String(value || '');
  if (!text || text === 'none') return 'none';
  return text.slice(0, 8);
}

function repoTldr(repo, previousCommit, commit, warning) {
  if (repo.branchSwitchedFrom && repo.status === 'up-to-date') return `auto-switched to ${inlineCode(repo.branch || 'configured branch')}; already up to date`;
  if (repo.branchSwitchedFrom && repo.status === 'updated') return `auto-switched to ${inlineCode(repo.branch || 'configured branch')}; updated from ${shortCommit(previousCommit)} to ${shortCommit(commit)}`;
  if (repo.status === 'updated') return `updated from ${shortCommit(previousCommit)} to ${shortCommit(commit)}`;
  if (repo.externalAdvanceDetected) return 'already updated before this hook run';
  if (repo.status === 'validation-failed') return `updated to ${shortCommit(commit)}, but validation failed`;
  if (repo.status === 'sync-delegation-failed') return 'updated, but target sync failed';
  if (repo.status === 'skipped' && isDirtyWorkingTreeWarning(warning)) return 'skipped (configured Toolkit source checkout is dirty)';
  if (repo.status === 'skipped') return warning ? `skipped (${warning})` : 'skipped safely';
  if (repo.status === 'up-to-date') return 'already up to date';
  return 'not updated in this run';
}
function targetsTldr(targetSyncs, targetSyncStatus) {
  if (targetSyncs.length) {
    return targetSyncs
      .map((sync) => `${targetDisplayName(sync.target)} (${sync.skillNames.length} skills)`)
      .join(', ')
      .replace(/^/, 'synced ');
  }
  if (targetSyncStatus === 'skipped') return 'sync skipped';
  return 'nothing to sync';
}

function branchMismatchSuggestion(warning) {
  return /branch mismatch/i.test(String(warning || ''))
    ? 'switch the Toolkit repo back to `main`, then restart Codex or rerun setup/sync'
    : '';
}

function isDirtyWorkingTreeWarning(warning) {
  return /dirty working tree/i.test(String(warning || ''));
}

function dirtyWorkingTreeSuggestion(warning) {
  return isDirtyWorkingTreeWarning(warning)
    ? 'finish or stash changes in the configured Toolkit source checkout, or run `setup toolkit` to use a dedicated clean `main` checkout for startup updates'
    : '';
}

function warningSuggestion(warning) {
  return branchMismatchSuggestion(warning) || dirtyWorkingTreeSuggestion(warning);
}

function actionTldr({ repo, nativePluginCache, thirdPartyHookRepair, warning, state }) {
  if (nativePluginCache.status === 'stale') {
    if (state.codex_plugin_auto_refresh_enabled) {
      return 'Codex auto-refresh is enabled and will retry on the next hook run';
    }
    return 'enable Codex plugin auto-refresh in setup, or run `setup toolkit`';
  }
  if (nativePluginCache.status === 'refresh-failed') return 'run `setup toolkit` to refresh the Codex plugin cache manually';
  if (['repair-failed', 'partial-failed'].includes(thirdPartyHookRepair.status)) return 'check n8n Skills plugin compatibility drift';
  if (repo.status === 'validation-failed') return 'check hook-light validation';
  if (repo.status === 'sync-delegation-failed') return 'check target sync';
  const suggestion = warningSuggestion(warning);
  if (suggestion) return suggestion;
  if (warning) return `check: ${warning}`;
  return 'none';
}

function triggeredFromTldr(syncSource) {
  if (syncSource === 'claude-plugin') return `Claude Code plugin hook (${inlineCode('claude-plugin')})`;
  if (syncSource === 'codex-plugin') return `Codex plugin hook (${inlineCode('codex-plugin')})`;
  return `manual or repo run (${inlineCode(syncSource || 'repo')})`;
}

function buildUpdateReport({ args, state, checksum, context }) {
  const repo = context.repo || {};
  const targetSyncs = context.targetSyncs || [];
  const skippedTargets = context.skippedTargets || [];
  const nativePluginCache = context.nativePluginCache || {};
  const thirdPartyHookRepair = context.thirdPartyHookRepair || {};
  const cleanup = context.cleanup || state.last_update_report_cleanup || {};
  const warning = repo.error || context.warning || '';
  const suggestion = warningSuggestion(warning);
  const commit = repo.externalAdvanceToCommit || repo.toCommit || currentToolkitCommit(state);
  const previousCommit = repo.externalAdvanceFromCommit || repo.fromCommit || 'none';
  const validationStatus = repo.validationStatus || repo.validation?.status || (repo.status ? 'not run' : 'not run');
  const targetSyncStatus = context.targetSyncStatus || (targetSyncs.length ? 'synced' : 'not needed');
  const lines = [
    '# AI Agent Toolkit Update',
    '',
    '## TL;DR',
    '',
    `- Triggered from: ${triggeredFromTldr(args.syncSource)}.`,
    `- Repo: ${repoTldr(repo, previousCommit, commit, warning)}.`,
    `- Targets: ${targetsTldr(targetSyncs, targetSyncStatus)}.`,
    `- Action needed: ${actionTldr({ repo, nativePluginCache, thirdPartyHookRepair, warning, state })}.`,
    '',
    '## Details',
    '',
    `- Time (SGT): ${inlineCode(reportTimestampSgt(context.timestamp || timestamp()))}`,
    `- Running bridge source: ${inlineCode(args.syncSource)}`,
    `- Running bridge version: ${inlineCode(BRIDGE_VERSION)}`,
    `- Recorded repo version: ${inlineCode(state.bridge_versions_by_source.repo || 'not recorded')}`,
    `- Recorded Codex plugin version: ${inlineCode(state.bridge_versions_by_source['codex-plugin'] || 'not recorded')}`,
    `- Recorded Claude plugin version: ${inlineCode(state.bridge_versions_by_source['claude-plugin'] || 'not recorded')}`,
    `- Hub reporting version: ${inlineCode(state.hub_version || 'not recorded')}`,
    `- Downgrade enforcement scope: ${inlineCode(`${args.syncSource} only`)}`,
    `- Toolkit updated to commit: ${inlineCode(commit)}`,
    `- Previous commit: ${inlineCode(previousCommit)}`,
    `- Report/log retention days: ${inlineCode(cleanup.retention_days || state.update_report_retention_days || DEFAULT_UPDATE_REPORT_RETENTION_DAYS)}`,
    '',
    'Changed files:'
  ];

  if ((repo.changedFiles || []).length) {
    for (const file of repo.changedFiles) lines.push(`- ${inlineCode(slash(file))}`);
  } else if (repo.externalAdvanceDetected) {
    lines.push('- Local repo was already advanced before this hook run.');
  } else if (targetSyncs.length && (!repo.fromCommit || repo.fromCommit === repo.toCommit)) {
    lines.push('- No repo commit change; local bridge target state was stale.');
  } else if (repo.branchSwitchedFrom) {
    lines.push('- No repo commit change; clean branch auto-switch completed.');
  } else if (repo.status && repo.status !== 'updated') {
    lines.push('- No repo commit change; repo auto-update skipped safely.');
  } else {
    lines.push('- No repo commit change.');
  }

  lines.push('', '## Repo Update', '');
  if (repo.repoPath) lines.push(`- Configured repo path: ${inlineCode(repo.repoPath)}`);
  if (repo.branch) lines.push(`- Configured branch: ${inlineCode(repo.branch)}`);
  if (repo.remote) lines.push(`- Configured remote: ${inlineCode(repo.remote)}`);
  lines.push(`- Previous observed commit: ${inlineCode(previousCommit)}`);
  lines.push(`- Current commit: ${inlineCode(commit)}`);
  if (repo.branchSwitchedFrom) {
    lines.push(`- Bridge action: auto-switched clean Toolkit repo from ${inlineCode(repo.branchSwitchedFrom)} to ${inlineCode(repo.branch || 'configured branch')}.`);
  }
  if (repo.status === 'updated') {
    lines.push('- Bridge action: fast-forwarded the configured local repo during this hook run.');
  } else if (repo.externalAdvanceDetected) {
    lines.push('- Bridge action: Local repo was already advanced before this hook run.');
    lines.push('- Inference: Likely from a manual pull or another local Git update.');
  } else if (repo.status === 'up-to-date') {
    lines.push('- Bridge action: local repo stayed on the same commit during this hook run.');
  } else if (repo.status) {
    lines.push(`- Bridge action: ${inlineCode(repo.status)}.`);
  } else {
    lines.push('- Bridge action: repo update was not run.');
  }

  lines.push('', '## What Has Been Done', '');
  for (const sync of targetSyncs) {
    lines.push(`- Synced Toolkit skills to ${targetDisplayName(sync.target)}:`);
    lines.push(`  ${inlineCode(sync.targetPath)}`);
    lines.push(`- Copied/updated ${inlineCode(sync.skillNames.length)} Toolkit skills.`);
    if ((sync.removedSkillNames || []).length) {
      lines.push('- Removed stale managed skill folders:');
      for (const name of sync.removedSkillNames) lines.push(`  - ${inlineCode(name)}`);
    }
  }
  for (const target of skippedTargets) {
    lines.push(`- Skipped ${targetDisplayName(target)} because target is disabled.`);
  }
  if (!targetSyncs.length && !skippedTargets.length && repo.status) {
    lines.push('- No enabled target sync was completed.');
  }
  if (nativePluginCache.status === 'refreshed') {
    lines.push('- Codex native plugin cache was auto-refreshed from the trusted local Toolkit repo.');
  } else if (nativePluginCache.status === 'refresh-failed') {
    lines.push('- Codex native plugin cache auto-refresh failed. Run `setup toolkit` to refresh Codex plugin skills, hooks, and metadata manually.');
  } else if (nativePluginCache.status === 'stale') {
    if (state.codex_plugin_auto_refresh_enabled) {
      lines.push('- Codex native plugin cache is stale even though auto-refresh is enabled. The hook will retry automatic refresh on the next run; use `setup toolkit` only if this persists.');
    } else {
      lines.push('- Codex native plugin cache is stale. Enable Codex plugin auto-refresh during setup or run `setup toolkit` to refresh Codex plugin skills, hooks, and metadata.');
    }
  } else if (nativePluginCache.status === 'check-only' && nativePluginCache.manual_action) {
    lines.push(`- Claude Code native plugin cache: ${nativePluginCache.manual_action}`);
  }
  if (thirdPartyHookRepair.status === 'repaired' || thirdPartyHookRepair.status === 'partial-failed') {
    lines.push(`- Repaired ${inlineCode((thirdPartyHookRepair.repaired || []).length)} supported n8n Skills Codex plugin hook cache(s).`);
    for (const entry of thirdPartyHookRepair.repaired || []) {
      lines.push(`  - ${inlineCode(entry.plugin_id || entry.plugin_root)}`);
    }
  } else if (thirdPartyHookRepair.status === 'repair-failed') {
    lines.push('- n8n Skills plugin hook reconciliation failed closed.');
  } else if (thirdPartyHookRepair.status === 'not-needed') {
    lines.push('- Supported n8n Skills plugin hooks were already Windows-safe, or no supported target was installed.');
  }
  lines.push('- Skipped live n8n systems; not touched.');

  lines.push('', '## Update Report And Log Cleanup', '');
  lines.push(`- directory: ${inlineCode(cleanup.report_log_directory || updateReportDir())}`);
  lines.push(`- retention days: ${inlineCode(cleanup.retention_days || state.update_report_retention_days || DEFAULT_UPDATE_REPORT_RETENTION_DAYS)}`);
  lines.push(`- max retained reports: ${inlineCode(cleanup.max_report_files || DEFAULT_UPDATE_REPORT_MAX_FILES)}`);
  lines.push(`- deleted: ${inlineCode(cleanup.deleted_count || 0)}`);
  lines.push(`- skipped: ${inlineCode(cleanup.skipped_count || 0)}`);
  lines.push(`- errors: ${inlineCode(cleanup.error_count || 0)}`);
  for (const error of cleanup.errors || []) lines.push(`  - ${inlineCode(error)}`);

  lines.push('', '## Validation', '');
  lines.push(`- repo update status: ${inlineCode(repo.status || 'not run')}`);
  lines.push(`- hook-light validation: ${inlineCode(validationStatus)}`);
  lines.push(`- target sync status: ${inlineCode(targetSyncStatus)}`);
  if (nativePluginCache.status) {
    const cacheLabel = nativePluginCache.host === 'claude-code' ? 'Claude Code native plugin cache' : 'Codex native plugin cache';
    lines.push(`- ${cacheLabel}: ${inlineCode(nativePluginCache.status)}`);
    for (const error of nativePluginCache.errors || []) lines.push(`  - ${inlineCode(error)}`);
  }
  if (thirdPartyHookRepair.status) {
    lines.push(`- n8n Skills plugin hook reconciliation: ${inlineCode(thirdPartyHookRepair.status)}`);
    for (const error of thirdPartyHookRepair.errors || []) lines.push(`  - ${inlineCode(error)}`);
  }
  lines.push(`- checksum: ${inlineCode(checksum)}`);
  if (warning) {
    lines.push(`- warning/error: ${inlineCode(warning)}`);
    if (suggestion) lines.push(`- Suggested fix: ${suggestion}.`);
  }
  return `${lines.join('\n')}\n`;
}

function writeUpdateReportFile(markdown) {
  const reportPath = nextUpdateReportPath();
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, markdown, 'utf8');
  return reportPath;
}

function updateReportSignature({ args, checksum, context }) {
  const repo = context.repo || {};
  const nativePluginCache = context.nativePluginCache || {};
  const thirdPartyHookRepair = context.thirdPartyHookRepair || {};
  const cleanup = context.cleanup || {};
  const targetSyncs = context.targetSyncs || [];
  const skippedTargets = context.skippedTargets || [];
  const payload = {
    syncSource: args.syncSource,
    checksum,
    repo: {
      status: repo.status || '',
      error: repo.error || '',
      branch: repo.branch || '',
      branchSwitchedFrom: repo.branchSwitchedFrom || '',
      remote: repo.remote || '',
      fromCommit: repo.fromCommit || '',
      toCommit: repo.toCommit || '',
      externalAdvanceDetected: repo.externalAdvanceDetected === true,
      externalAdvanceFromCommit: repo.externalAdvanceFromCommit || '',
      externalAdvanceToCommit: repo.externalAdvanceToCommit || '',
      changedFiles: repo.changedFiles || [],
      validationStatus: repo.validationStatus || repo.validation?.status || ''
    },
    nativePluginCache: {
      status: nativePluginCache.status || '',
      errors: nativePluginCache.errors || []
    },
    thirdPartyHookRepair: {
      status: thirdPartyHookRepair.status || '',
      repaired: (thirdPartyHookRepair.repaired || []).map((entry) => ({
        plugin_id: entry.plugin_id || '',
        plugin_root: entry.plugin_root || '',
        actions: entry.actions || []
      })),
      errors: thirdPartyHookRepair.errors || []
    },
    cleanup: {
      retentionDays: cleanup.retention_days || '',
      maxReportFiles: cleanup.max_report_files || DEFAULT_UPDATE_REPORT_MAX_FILES,
      errorCount: cleanup.error_count || 0
    },
    targetSyncStatus: context.targetSyncStatus || '',
    targetSyncs: targetSyncs.map((sync) => ({
      target: sync.target || '',
      targetPath: sync.targetPath || '',
      skillNames: sync.skillNames || [],
      removedSkillNames: sync.removedSkillNames || []
    })),
    skippedTargets
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function maybeWriteUpdateReport({ args, hubPath, state, checksum, context, writeReport = writeUpdateReportFile, openReport = openUpdateReport }) {
  const classification = classifyUpdateReport(context);
  if (!shouldConsiderUpdateReport(args, state) || !classification.meaningful) {
    return { state, reportPath: '' };
  }
  const reportContext = {
    cleanup: state.last_update_report_cleanup || {},
    ...context,
    timestamp: context.timestamp || timestamp()
  };
  const signature = updateReportSignature({ args, checksum, context: reportContext });
  if (!args.openUpdateReport && state.last_update_report_signature === signature) {
    return { state, reportPath: '' };
  }
  const markdown = buildUpdateReport({ args, state, checksum, context: reportContext });
  const reportPath = writeReport(markdown);
  state.last_update_report_path = reportPath;
  state.last_update_report_signature = signature;
  if (args.openUpdateReport || classification.actionable) {
    openReport(reportPath);
  }
  return { state, reportPath };
}

const OUTPUT_PATH_PLACEHOLDER = '<private-path>';
const OUTPUT_PATH_TRAILING_TEXT_BOUNDARIES = [
  ' is ',
  ' was ',
  ' has ',
  ' cannot ',
  ' could ',
  ' does ',
  ' failed ',
  ' became ',
  ' changed ',
  ' while ',
  ' when ',
  ' because ',
  ' due to ',
  ' before ',
  ' after '
];

function isOutputPathBoundary(message, index) {
  return index === 0 || /[\s([{:;,=]/.test(message[index - 1]);
}

function hasUriSchemeBefore(message, index) {
  return /[A-Za-z][A-Za-z0-9+.-]*:$/.test(message.slice(0, index));
}

function outputPathKindAt(message, index, requireBoundary = true) {
  if (index >= message.length || (requireBoundary && !isOutputPathBoundary(message, index))) return '';
  const tail = message.slice(index);
  if (/^file:\/\//i.test(tail)) return 'file-uri';
  if (/^[A-Za-z]:[\\/]/.test(tail)) return 'drive';
  if (tail.startsWith('\\\\')) return 'unc-backslash';
  if (tail.startsWith('//') && !hasUriSchemeBefore(message, index)) return 'unc-forward';
  if (tail.startsWith('/') && !tail.startsWith('//')) return 'posix';
  return '';
}

function isValidOutputPath(candidate, kind) {
  if (!candidate || /[\r\n\t\0]/.test(candidate)) return false;
  if (kind === 'drive') return /^[A-Za-z]:[\\/][^\\/]+/.test(candidate);
  if (kind === 'posix') return candidate.startsWith('/') && candidate.indexOf('/', 1) > 1;
  if (kind === 'unc-backslash') {
    return candidate.slice(2).split('\\').filter(Boolean).length >= 2;
  }
  if (kind === 'unc-forward') {
    return candidate.slice(2).split('/').filter(Boolean).length >= 2;
  }
  if (kind === 'file-uri') {
    if (!/^file:\/\//i.test(candidate)) return false;
    const target = candidate.slice('file://'.length);
    if (/^\/[A-Za-z]:\//.test(target)) return target.slice(3).includes('/');
    if (target.startsWith('/')) return target.indexOf('/', 1) > 1;
    return target.split('/').filter(Boolean).length >= 2;
  }
  return false;
}

function isInternalOutputPathColon(message, start, index, kind) {
  if (kind === 'drive') return index === start + 1;
  if (kind !== 'file-uri') return false;
  if (index === start + 'file'.length) return true;
  return index >= start + 'file:///C'.length
    && /[A-Za-z]/.test(message[index - 1])
    && message[index - 2] === '/';
}

function unquotedOutputPathEnd(message, start, kind) {
  let end = start;
  while (end < message.length) {
    const character = message[end];
    if (/[\r\n\t'"`<>|,;)\]}!?#]/.test(character)) break;
    if (character === ':' && !isInternalOutputPathColon(message, start, end, kind)) break;
    end += 1;
  }

  while (end > start && message[end - 1] === ' ') end -= 1;
  const candidate = message.slice(start, end);
  for (const boundary of OUTPUT_PATH_TRAILING_TEXT_BOUNDARIES) {
    let offset = candidate.indexOf(boundary);
    while (offset !== -1) {
      const trailingText = candidate.slice(offset + boundary.length);
      if (!/[\\/]/.test(trailingText)) {
        end = Math.min(end, start + offset);
        break;
      }
      offset = candidate.indexOf(boundary, offset + boundary.length);
    }
  }

  while (end > start && message[end - 1] === ' ') end -= 1;
  if (end > start && message[end - 1] === '.') end -= 1;
  return end;
}

function sanitizeOutputMessage(message) {
  const input = String(message || '');
  let output = '';
  let copyFrom = 0;
  let index = 0;

  while (index < input.length) {
    const quote = input[index] === "'" || input[index] === '"' ? input[index] : '';
    if (quote && isOutputPathBoundary(input, index)) {
      const close = input.indexOf(quote, index + 1);
      const kind = outputPathKindAt(input, index + 1, false);
      if (close > index + 1 && kind) {
        const candidate = input.slice(index + 1, close);
        if (isValidOutputPath(candidate, kind)) {
          output += input.slice(copyFrom, index) + OUTPUT_PATH_PLACEHOLDER;
          index = close + 1;
          copyFrom = index;
          continue;
        }
      }
    }

    const kind = outputPathKindAt(input, index);
    if (kind) {
      const end = unquotedOutputPathEnd(input, index, kind);
      const candidate = input.slice(index, end);
      if (isValidOutputPath(candidate, kind)) {
        output += input.slice(copyFrom, index) + OUTPUT_PATH_PLACEHOLDER;
        index = end;
        copyFrom = index;
        continue;
      }
    }
    index += 1;
  }

  return output + input.slice(copyFrom);
}

function printUpdateReportLine(args, reportPath) {
  if (!reportPath) return;
  console.log('Toolkit local bridge sync complete.');
}

function buildManifest({ state, discoveries, checksum, sourceCommit, syncSource, hubPath }) {
  return {
    name: 'ai-agent-toolkit-local-bridge',
    architecture_version: ARCHITECTURE_VERSION,
    bridge_version: BRIDGE_VERSION,
    checksum,
    source_commit: sourceCommit,
    sync_source: syncSource,
    sync_timestamp: timestamp(),
    hub_path: hubPath,
    targets: {
      opencode: {
        detected: discoveries.opencode.detected,
        enabled: state.targets.opencode.enabled,
        explicitly_disabled: state.targets.opencode.explicitly_disabled,
        target_path: discoveries.opencode.target_path
      },
      ag2: {
        detected: discoveries.ag2.detected,
        enabled: state.targets.ag2.enabled,
        explicitly_disabled: state.targets.ag2.explicitly_disabled,
        target_path: discoveries.ag2.target_path
      }
    }
  };
}

function prepareStateForWrite(state, args) {
  assertRecognizedSyncSource(args.syncSource);
  const next = normalizedState(state);
  next.schema_version = STATE_SCHEMA_VERSION;
  next.architecture_version = ARCHITECTURE_VERSION;
  next.bridge_versions_by_source[args.syncSource] = BRIDGE_VERSION;
  next.hub_version = maximumBridgeVersion(next.hub_version, next.bridge_versions_by_source);
  next.created_at = next.created_at || timestamp();
  next.updated_at = timestamp();
  next.last_sync_source = args.syncSource;
  return next;
}

function deriveSnapshotGeneration({ args, hubPath, state, prepareForWrite = false }) {
  let nextState = normalizedState(state);
  const sourceRoot = resolveToolkitSourceRoot(nextState);
  const payloads = adapterPayloads(nextState, sourceRoot);
  const checksum = payloadChecksum(payloads);
  const discoveries = {
    opencode: discoverOpenCode(args, nextState.targets.opencode, hubPath),
    ag2: discoverAg2(args, nextState.targets.ag2, hubPath)
  };
  updateTargetState(nextState, 'opencode', discoveries.opencode, checksum, false, nextState.targets.opencode.enabled ? '' : 'not enabled');
  updateTargetState(nextState, 'ag2', discoveries.ag2, checksum, false, nextState.targets.ag2.enabled ? '' : 'not enabled');
  const plannedTargetSyncs = SUPPORTED_TARGETS
    .filter((target) => targetWouldSync(target, nextState, checksum, discoveries[target], payloads))
    .map((target) => targetSyncPlan(target, discoveries[target], payloads));
  const skippedTargets = SUPPORTED_TARGETS
    .filter((target) => !nextState.targets[target].enabled || nextState.targets[target].explicitly_disabled);
  if (prepareForWrite) nextState = prepareStateForWrite(nextState, args);
  return {
    state: nextState,
    sourceRoot,
    sourceCommit: currentToolkitCommit({ repo_path: sourceRoot }),
    discoveries,
    payloads,
    checksum,
    plannedTargetSyncs,
    skippedTargets
  };
}

function writePayloadTree(rootDir, payload) {
  for (const [rel, text] of Object.entries(payload)) {
    const target = path.join(rootDir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, payloadBytes(text));
  }
}

function withOwnedStaging(options, callback) {
  const generation = createOwnedStagingGeneration({
    parent: path.dirname(options.target),
    target: options.target,
    stagePrefix: options.stagePrefix,
    operation: options.operation,
    sourceType: options.sourceType,
    bridgeVersion: BRIDGE_VERSION,
    afterRegistration: options.afterRegistration
  });
  let operationError = null;
  try {
    const result = callback(generation.stagePath, generation);
    markOwnedStaging(generation, 'completed');
    return result;
  } catch (error) {
    operationError = error;
    try {
      markOwnedStaging(generation, 'failed');
    } catch (markerError) {
      error.stagingMarkerError = markerError;
    }
    throw error;
  } finally {
    const cleanup = cleanupOwnedGeneration(generation, {
      currentOperation: true,
      beforeDelete: options.beforeDelete
    });
    if (!cleanup.cleaned) {
      const cleanupError = new Error(
        `Owned staging generation ${generation.record.generation_id} was preserved because cleanup could not prove ownership: ${cleanup.reason}`
      );
      if (operationError) {
        operationError.stagingCleanupError = cleanupError;
        operationError.message = `${operationError.message}; ${cleanupError.message}`;
      }
      else throw cleanupError;
    }
  }
}

function writeHubSnapshot({ hubPath, args, state, discoveries, checksum, payloads, sourceCommit }, testHooks = {}) {
  return withOwnedStaging({
    target: hubPath,
    stagePrefix: '.staging-',
    operation: 'hub-snapshot-replacement',
    sourceType: args.syncSource,
    afterRegistration: testHooks.afterHubStagingRegistration,
    beforeDelete: testHooks.beforeHubStagingCleanup
  }, (stagePath, generation) => {
    if (testHooks.afterHubStagingReady) testHooks.afterHubStagingReady({ stagePath, generation });
    if (testHooks.beforeHubPayloadWrite) testHooks.beforeHubPayloadWrite({ stagePath, generation });
    writePayloadTree(path.join(stagePath, 'adapters', 'opencode'), payloads.opencode);
    writePayloadTree(path.join(stagePath, 'adapters', 'ag2'), payloads.ag2);
    writeJson(path.join(stagePath, 'manifest.json'), buildManifest({
      state,
      discoveries,
      checksum,
      sourceCommit,
      syncSource: args.syncSource,
      hubPath
    }));
    writeJson(path.join(stagePath, 'state.json'), state);
    if (testHooks.afterHubPayloadWrite) testHooks.afterHubPayloadWrite({ stagePath, generation });
    validateStagedHub(stagePath, checksum);
    if (testHooks.afterHubValidation) testHooks.afterHubValidation({ stagePath, generation });
    if (testHooks.beforeHubReplacement) testHooks.beforeHubReplacement({ stagePath, generation });
    replaceDirectoryAtomically(stagePath, hubPath, testHooks.replaceDirectoryOptions || {});
  });
}

function validateStagedHub(stagePath, checksum) {
  const manifest = readJsonIfExists(path.join(stagePath, 'manifest.json'));
  const state = readJsonIfExists(path.join(stagePath, 'state.json'));
  if (!manifest || manifest.checksum !== checksum) throw new Error('staged manifest checksum mismatch');
  if (!state || state.schema_version !== STATE_SCHEMA_VERSION) throw new Error('staged state schema mismatch');
  if (!fs.existsSync(path.join(stagePath, 'adapters', 'opencode', 'skills', 'ai-agent-toolkit', 'SKILL.md'))) {
    throw new Error('staged OpenCode adapter SKILL.md missing');
  }
  if (!fs.existsSync(path.join(stagePath, 'adapters', 'ag2', 'plugin.json'))) {
    throw new Error('staged AG2 adapter plugin metadata missing');
  }
  if (!fs.existsSync(path.join(stagePath, 'adapters', 'ag2', 'skills', 'ai-agent-toolkit', 'SKILL.md'))) {
    throw new Error('staged AG2 adapter SKILL.md missing');
  }
}

// Classify the recorded lock owner without ever signalling it for real.
// `alive` is proof a process with that PID exists and must be respected.
// `dead` is proof no such process exists, so the lock is recoverable even
// while fresh. `indeterminate` (for example EPERM) is not proof of death and
// falls back to the age rule. `unknown` covers missing or malformed PIDs.
function lockOwnerLiveness(pid, killFn = process.kill) {
  const parsed = Number(pid);
  if (!Number.isInteger(parsed) || parsed <= 0) return 'unknown';
  // A lock recording this process's own PID cannot belong to a concurrent
  // run of this single-threaded process; treat it as recoverable leftover.
  if (parsed === process.pid) return 'dead';
  try {
    killFn(parsed, 0);
    return 'alive';
  } catch (error) {
    if (error && error.code === 'ESRCH') return 'dead';
    return 'indeterminate';
  }
}

// Age of the lock for the stale-age fallback. A malformed or partially
// written lock file (unreadable JSON, unparsable created_at) falls back to
// the file mtime so a mid-write lock from another process is not treated as
// instantly stale and recklessly removed.
function lockAgeMs(lockPath, lock) {
  const created = Date.parse(lock?.created_at || '');
  if (Number.isFinite(created)) return Date.now() - created;
  try {
    return Date.now() - fs.statSync(lockPath).mtimeMs;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

const LOCK_RECOVERY_MARKER_SUFFIX = '.recovery';

// Decide whether an existing lock must be respected. A live recorded owner
// is always respected regardless of age; a provably dead owner is
// recoverable immediately; unknown or indeterminate owners fall back to the
// age rule (created_at, or file mtime when the lock is unreadable).
function inspectLockForRecovery(lockPath, liveness = lockOwnerLiveness) {
  let lock = {};
  try {
    lock = readJsonIfExists(lockPath) || {};
  } catch {
    // Malformed lock JSON: no owner can be determined; the mtime-based age
    // fallback decides freshness.
  }
  const owner = liveness(lock.pid);
  if (owner === 'alive') {
    return { respected: true, message: `Toolkit bridge lock at ${lockPath} is held by live process ${lock.pid}` };
  }
  if (owner !== 'dead') {
    const age = lockAgeMs(lockPath, lock);
    if (Number.isFinite(age) && age < LOCK_STALE_MS) {
      return { respected: true, message: `fresh Toolkit bridge lock exists at ${lockPath}` };
    }
  }
  return { respected: false, message: '' };
}

// Best-effort cleanup of long-spent claim tombstones (marker reclaim and
// displaced-evidence retirement tombstones). A generous age floor keeps
// cleanup far away from any live acquisition: a contender's
// inspect-to-claim window is one acquireLock call, and tombstones only need
// to outlive stale knowledge of a generation, not accumulate forever.
// Displaced-lock evidence files are deliberately never age-collected here:
// they are a persistent fail-closed acquisition barrier while their owner
// is alive or unverifiable, and are removed only through the identity-safe
// retirement protocol once the owner is provably dead.
const LOCK_ARTIFACT_GC_MS = 24 * 60 * 60 * 1000;
const RECOVERY_CLAIM_TOMBSTONE_PATTERN = /^update\.lock\.recovery\.claim-[0-9a-f]{16}$/;
const DISPLACED_RETIREMENT_TOMBSTONE_PATTERN = /^update\.lock\.displaced\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.retired-[0-9a-f]{16}$/;

function cleanupSpentLockArtifacts(hubRoot) {
  let entries = [];
  try {
    entries = fs.readdirSync(hubRoot);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!RECOVERY_CLAIM_TOMBSTONE_PATTERN.test(entry) && !DISPLACED_RETIREMENT_TOMBSTONE_PATTERN.test(entry)) continue;
    const fullPath = path.join(hubRoot, entry);
    try {
      const artifact = fs.lstatSync(fullPath);
      if (artifact.isFile() && Date.now() - artifact.mtimeMs > LOCK_ARTIFACT_GC_MS) {
        fs.rmSync(fullPath, { force: true });
      }
    } catch {
      // Best-effort only; a busy or vanished artifact is left alone.
    }
  }
}

// Displaced-lock evidence is a persistent acquisition barrier. A previous
// recovery that displaced a live owner's lock and could not restore it
// preserves that lock as update.lock.displaced.<token>; until the recorded
// owner is provably dead, no later acquisition may create a new main lock,
// because the displaced owner may still be running as a writer.
//
// Classification per evidence file:
// - live owner: blocked, and the evidence must never be deleted;
// - indeterminate owner (for example EPERM): fail closed, blocked;
// - unusable owner data: age fallback (fresh blocks, stale is retirable);
// - provably dead owner: retirable through the identity-safe protocol.
function inspectDisplacedEvidenceFile(fullPath, liveness, testHooks = {}, phase = 'inspection') {
  let raw = null;
  try {
    raw = testHooks.readDisplacedEvidence
      ? testHooks.readDisplacedEvidence(fullPath, phase)
      : fs.readFileSync(fullPath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return { gone: true };
    const code = error?.code || 'unknown I/O error';
    return {
      blocked: true,
      message: `Toolkit bridge acquisition blocked: displaced lock evidence at ${fullPath} is unreadable (${code}); failing closed because its owner state cannot be safely established`
    };
  }
  let displaced = {};
  try {
    displaced = JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch {
    // Malformed evidence: owner is unusable; the age fallback decides.
  }
  const owner = liveness(displaced.pid);
  if (owner === 'alive') {
    return {
      blocked: true,
      owner,
      pid: displaced.pid,
      raw,
      message: `Toolkit bridge acquisition blocked: displaced lock evidence at ${fullPath} belongs to live process ${displaced.pid}; a previous recovery could not restore it, and no new lock may be created while the displaced owner is alive`
    };
  }
  if (owner === 'indeterminate') {
    return {
      blocked: true,
      owner,
      pid: displaced.pid,
      raw,
      message: `Toolkit bridge acquisition blocked: displaced lock evidence at ${fullPath} records owner process ${displaced.pid} whose liveness cannot be verified; failing closed until the owner can be proved dead (verify the process before considering manual review of the evidence)`
    };
  }
  if (owner === 'unknown') {
    let age = Date.now() - Date.parse(displaced.created_at || '');
    if (!Number.isFinite(age)) {
      try {
        age = Date.now() - fs.statSync(fullPath).mtimeMs;
      } catch (error) {
        if (error && error.code === 'ENOENT') return { gone: true };
        const code = error?.code || 'unknown I/O error';
        return {
          blocked: true,
          owner,
          pid: displaced.pid,
          raw,
          message: `Toolkit bridge acquisition blocked: displaced lock evidence at ${fullPath} cannot be dated safely (${code}); failing closed because its owner state cannot be safely established`
        };
      }
    }
    if (age < LOCK_STALE_MS) {
      return {
        blocked: true,
        owner,
        pid: displaced.pid,
        raw,
        message: `Toolkit bridge acquisition blocked: fresh displaced lock evidence at ${fullPath} has no verifiable owner; failing closed`
      };
    }
  }
  return { blocked: false, owner, pid: displaced.pid, raw };
}

function inspectDisplacedEvidence(hubRoot, liveness = lockOwnerLiveness, testHooks = {}, phase = 'inspection') {
  let entries = [];
  try {
    entries = testHooks.listDisplacedEvidence
      ? testHooks.listDisplacedEvidence(hubRoot, phase)
      : fs.readdirSync(hubRoot);
  } catch (error) {
    const code = error?.code || 'unknown I/O error';
    return {
      blocked: true,
      retirable: [],
      message: `Toolkit bridge acquisition blocked: displaced lock evidence cannot be enumerated in ${hubRoot} (${code}); failing closed because absence of evidence cannot be established`
    };
  }
  const retirable = [];
  for (const entry of entries) {
    if (!/^update\.lock\.displaced\.[0-9a-f-]+$/i.test(entry)) continue;
    const fullPath = path.join(hubRoot, entry);
    const inspection = inspectDisplacedEvidenceFile(fullPath, liveness, testHooks, phase);
    if (inspection.gone) continue;
    if (inspection.blocked) return { blocked: true, retirable, message: inspection.message };
    retirable.push({ fullPath, raw: inspection.raw });
  }
  return { blocked: false, retirable };
}

// Retire dead-owner displaced evidence with the same atomic identity-safe
// discipline as marker reclaim: exclusively create a tombstone named after
// the hash of the exact inspected bytes (one winner per generation), then
// re-read and remove the evidence only when it is still that generation. A
// changed generation is left untouched and this contender yields.
function retireDisplacedEvidence(retirable, testHooks = {}) {
  for (const { fullPath, raw } of retirable) {
    if (testHooks.afterEvidenceInspect) testHooks.afterEvidenceInspect();
    const identity = lockGenerationIdentity(raw);
    const tombstonePath = `${fullPath}.retired-${identity}`;
    try {
      fs.writeFileSync(
        tombstonePath,
        `${JSON.stringify({ created_at: timestamp(), pid: process.pid, retired_identity: identity }, null, 2)}\n`,
        { encoding: 'utf8', flag: 'wx' }
      );
    } catch (error) {
      if (error && error.code === 'EEXIST') {
        return { retired: false, message: `Toolkit bridge displaced lock evidence at ${fullPath} is being retired by another process` };
      }
      throw error;
    }
    let current = null;
    try {
      current = testHooks.readDisplacedEvidence
        ? testHooks.readDisplacedEvidence(fullPath, 'retirement-verification')
        : fs.readFileSync(fullPath, 'utf8');
    } catch (error) {
      if (error && error.code === 'ENOENT') continue;
      const code = error?.code || 'unknown I/O error';
      return {
        retired: false,
        message: `Toolkit bridge displaced lock evidence at ${fullPath} became unreadable during retirement verification (${code}); failing closed without removing it`
      };
    }
    if (current !== raw) {
      return { retired: false, message: `Toolkit bridge displaced lock evidence at ${fullPath} changed while being retired` };
    }
    fs.rmSync(fullPath, { force: true });
  }
  return { retired: true };
}

function lockGenerationIdentity(rawBytes) {
  return crypto.createHash('sha256').update(rawBytes, 'utf8').digest('hex').slice(0, 16);
}

// Inspect the recovery marker without mutating anything during marker claim
// or identity-safe reclaim.
function inspectRecoveryMarker(markerPath, liveness = lockOwnerLiveness) {
  let raw = null;
  try {
    raw = fs.readFileSync(markerPath, 'utf8');
  } catch {
    return { present: false };
  }
  let marker = {};
  try {
    marker = JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch {
    // Malformed marker content: liveness is unknown and the age fallback
    // (file mtime) decides below.
  }
  const owner = liveness(marker.pid);
  if (owner === 'alive') {
    return { present: true, active: true, raw, marker, message: `Toolkit bridge lock recovery at ${markerPath} is in progress by live process ${marker.pid}` };
  }
  if (owner !== 'dead') {
    const age = lockAgeMs(markerPath, marker);
    if (Number.isFinite(age) && age < LOCK_STALE_MS) {
      return { present: true, active: true, raw, marker, message: `fresh Toolkit bridge lock recovery marker exists at ${markerPath}` };
    }
  }
  return { present: true, active: false, raw, marker };
}

// Atomic recovery claim: only the process that exclusively created the
// recovery marker may displace a recoverable lock and write a replacement.
// The exclusive create is the atomic ownership primitive; the loser of the
// race never deletes anything.
//
// Reclaiming a marker left by a dead or stale recovery is itself atomic and
// identity-safe: the reclaimer must first exclusively create a tombstone
// whose name is derived from a hash of the exact marker bytes it inspected.
// Contenders that inspected the same marker generation compute the same
// tombstone path, so exactly one wins the exclusive create; the tombstone is
// never deleted by the protocol (only aged out long after any contender's
// knowledge of that generation could survive), so a loser acting on stale
// knowledge can never reclaim that generation later. The winner then
// re-reads the marker under its tombstone and proceeds only when the bytes
// are still the inspected generation.
function claimRecoveryMarker(markerPath, token, liveness = lockOwnerLiveness, testHooks = {}) {
  const markerBody = `${JSON.stringify({ created_at: timestamp(), pid: process.pid, token }, null, 2)}\n`;
  const tryCreateMarker = () => {
    try {
      fs.writeFileSync(markerPath, markerBody, { encoding: 'utf8', flag: 'wx' });
      return true;
    } catch (error) {
      if (error && error.code === 'EEXIST') return false;
      throw error;
    }
  };

  if (tryCreateMarker()) return { claimed: true };

  const inspection = inspectRecoveryMarker(markerPath, liveness);
  if (!inspection.present) {
    // The marker vanished between the exclusive create and the read; one
    // bounded retry decides ownership without any deletion.
    if (tryCreateMarker()) return { claimed: true };
    return { claimed: false, message: `Toolkit bridge lock recovery marker at ${markerPath} was re-created by another process` };
  }
  if (inspection.active) return { claimed: false, message: inspection.message };
  if (testHooks.afterMarkerInspect) testHooks.afterMarkerInspect();

  const identity = lockGenerationIdentity(inspection.raw);
  const tombstonePath = `${markerPath}.claim-${identity}`;
  try {
    fs.writeFileSync(
      tombstonePath,
      `${JSON.stringify({ created_at: timestamp(), pid: process.pid, token, reclaimed_marker_identity: identity }, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx' }
    );
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      return { claimed: false, message: `Toolkit bridge lock recovery marker at ${markerPath} was already reclaimed by another process` };
    }
    throw error;
  }

  // Verify under the tombstone: only the inspected generation may be
  // removed. A different generation means another process already cycled
  // the marker; it is left untouched and this contender yields.
  let current = null;
  try {
    current = fs.readFileSync(markerPath, 'utf8');
  } catch {
    // Marker gone: fall through to the exclusive create below.
  }
  if (current !== null && current !== inspection.raw) {
    return { claimed: false, message: `Toolkit bridge lock recovery marker at ${markerPath} changed while being reclaimed` };
  }
  if (current !== null) fs.rmSync(markerPath, { force: true });

  if (tryCreateMarker()) return { claimed: true };
  return { claimed: false, message: `Toolkit bridge lock recovery marker at ${markerPath} was re-created by another process` };
}

function releaseRecoveryMarker(markerPath, token) {
  let marker = null;
  try {
    marker = readJsonIfExists(markerPath);
  } catch {
    return;
  }
  if (marker && marker.token === token) fs.rmSync(markerPath, { force: true });
}

// acquireLock protocol:
// 0. An initial displaced-evidence inspection may fail fast but never retires
//    evidence or authorizes creation. Every acquisition then owns the
//    recovery marker while it authoritatively re-inspects/retire evidence,
//    rechecks or recovers the main lock, and exclusively creates its lock.
//    This makes evidence validation and no-lock ownership commitment one
//    serialized protocol with no check-to-create gap.
// 1. No lock present: the recovery marker is still claimed before the
//    authoritative evidence inspection and exclusive main-lock creation.
// 2. Lock present and respected (live owner, or fresh with unknown owner):
//    hook runs skip, manual runs fail. Nothing is deleted.
// 3. Recoverable lock: claim the exclusive recovery marker (reclaiming a
//    dead or stale marker is atomic and identity-safe via a tombstone on
//    the inspected marker generation), re-inspect the lock under the marker
//    (a replacement written in the interim has a live owner and is
//    respected), displace the recoverable lock by rename and verify the
//    displaced file's owner is not alive before discarding it, then
//    exclusively create the replacement carrying a unique ownership token.
//    A displaced generation that cannot be proved safe to discard is never
//    renamed back over the main path: it remains evidence and this contender
//    yields without writing, eliminating destination-clobber races.
// testHooks is a test-only seam for deterministic interleaving; production
// call sites never pass it.
function acquireLock(hubRoot, args, testHooks = {}) {
  fs.mkdirSync(hubRoot, { recursive: true });
  cleanupSpentLockArtifacts(hubRoot);
  const lockPath = path.join(hubRoot, 'update.lock');
  const markerPath = `${lockPath}${LOCK_RECOVERY_MARKER_SUFFIX}`;
  const liveness = testHooks.liveness || lockOwnerLiveness;
  const token = crypto.randomUUID();

  const skipOrThrow = (message) => {
    if (args.hook) return { acquired: false, lockPath, skipReason: message };
    throw new Error(message);
  };

  const tryExclusiveCreate = () => {
    const lockBody = `${JSON.stringify({
      created_at: timestamp(),
      pid: process.pid,
      token,
      bridge_version: BRIDGE_VERSION,
      sync_source: args.syncSource
    }, null, 2)}\n`;
    try {
      fs.writeFileSync(lockPath, lockBody, { encoding: 'utf8', flag: 'wx' });
      return true;
    } catch (error) {
      if (error && error.code === 'EEXIST') return false;
      throw error;
    }
  };

  // The initial scan is fail-fast only. A contender may pause after this
  // scan while another recovery creates evidence, so no retirement or lock
  // creation is permitted until the same checks repeat under marker ownership.
  const initialEvidence = inspectDisplacedEvidence(hubRoot, liveness, testHooks, 'initial');
  if (initialEvidence.blocked) return skipOrThrow(initialEvidence.message);
  if (testHooks.afterInitialEvidenceInspect) testHooks.afterInitialEvidenceInspect();

  if (fs.existsSync(lockPath)) {
    const inspection = inspectLockForRecovery(lockPath, liveness);
    if (inspection.respected) return skipOrThrow(inspection.message);
    if (testHooks.afterInspect) testHooks.afterInspect();
  }

  const marker = claimRecoveryMarker(markerPath, token, liveness, testHooks);
  if (!marker.claimed) return skipOrThrow(marker.message);

  try {
    if (testHooks.afterMarkerClaim) testHooks.afterMarkerClaim();
    // This is the authoritative barrier check. The marker remains owned
    // through retirement, main-lock recovery, and exclusive creation, so no
    // compliant recoverer can create evidence in a check-to-create gap.
    const evidence = inspectDisplacedEvidence(hubRoot, liveness, testHooks, 'under-marker');
    if (evidence.blocked) return skipOrThrow(evidence.message);
    if (evidence.retirable.length) {
      const retirement = retireDisplacedEvidence(evidence.retirable, testHooks);
      if (!retirement.retired) return skipOrThrow(retirement.message);
    }

    if (fs.existsSync(lockPath)) {
      const recheck = inspectLockForRecovery(lockPath, liveness);
      if (recheck.respected) return skipOrThrow(recheck.message);
      if (testHooks.beforeDisplace) testHooks.beforeDisplace();
      // Displace by rename instead of deleting in place, then verify the
      // displaced file. A generation that cannot be proved safe to discard
      // remains at this unique evidence path and this contender yields.
      const displacedPath = `${lockPath}.displaced.${token}`;
      let displaced = false;
      try {
        fs.renameSync(lockPath, displacedPath);
        displaced = true;
      } catch {
        // The lock disappeared between the recheck and the rename; continue
        // to the exclusive create, which remains the final arbiter.
      }
      if (testHooks.afterDisplace) testHooks.afterDisplace();
      if (displaced) {
        const displacedInspection = inspectDisplacedEvidenceFile(
          displacedPath,
          liveness,
          testHooks,
          'post-displacement'
        );
        if (!displacedInspection.gone && displacedInspection.blocked) {
          if (testHooks.beforeRestorationCommit) testHooks.beforeRestorationCommit();
          if (displacedInspection.owner === 'alive') {
            return skipOrThrow(`Toolkit bridge lock recovery displaced a lock held by live process ${displacedInspection.pid}; no-clobber restoration is not guaranteed, so the displaced lock is preserved at ${displacedPath}; not acquiring`);
          }
          return skipOrThrow(`${displacedInspection.message}; no-clobber restoration is not guaranteed, so the displaced lock is preserved; not acquiring`);
        }
        if (!displacedInspection.gone) fs.rmSync(displacedPath, { force: true });
      }
    }
    if (tryExclusiveCreate()) return { acquired: true, lockPath, token };
    return skipOrThrow(`Toolkit bridge lock at ${lockPath} was created by another process`);
  } finally {
    releaseRecoveryMarker(markerPath, token);
  }
}

// Release only the exact lock this run created: the current lock file must
// still carry this run's ownership token. A lock replaced by another
// process is never deleted, even by the process that previously owned that
// path. The token check is stable because no other process may recover a
// lock whose recorded owner is alive, and this process is alive while
// releasing.
function releaseLock(lock) {
  if (!lock?.acquired || !lock.lockPath) return;
  let current = null;
  try {
    current = readJsonIfExists(lock.lockPath);
  } catch {
    return;
  }
  if (!current || current.token !== lock.token) return;
  fs.rmSync(lock.lockPath, { force: true });
}

function isTransientRenameError(error) {
  return ['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error?.code);
}

function sleepSync(ms) {
  if (!ms) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function renameSyncWithRetry(sourcePath, targetPath, options = {}) {
  const attempts = options.renameAttempts || 6;
  const delayMs = options.retryDelayMs || 75;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      fs.renameSync(sourcePath, targetPath);
      return;
    } catch (error) {
      lastError = error;
      if (!isTransientRenameError(error) || attempt === attempts) break;
      sleepSync(delayMs);
    }
  }
  throw lastError;
}

function replaceDirectoryAtomically(sourceDir, targetDir, options = {}) {
  const parent = path.dirname(targetDir);
  fs.mkdirSync(parent, { recursive: true });
  const backup = path.join(parent, `.${path.basename(targetDir)}.backup-${process.pid}-${Date.now()}`);
  if (fs.existsSync(backup)) fs.rmSync(backup, { recursive: true, force: true });
  if (fs.existsSync(targetDir)) renameSyncWithRetry(targetDir, backup, options);
  try {
    renameSyncWithRetry(sourceDir, targetDir, options);
  } catch (error) {
    if (isTransientRenameError(error) && fs.existsSync(sourceDir) && !fs.existsSync(targetDir)) {
      try {
        fs.cpSync(sourceDir, targetDir, { recursive: true, force: false, errorOnExist: true });
        fs.rmSync(sourceDir, { recursive: true, force: true });
        if (fs.existsSync(backup)) fs.rmSync(backup, { recursive: true, force: true });
        return;
      } catch (copyError) {
        if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true });
        const fallbackError = new Error(
          `Failed to replace ${targetDir}: rename failed with ${error.code || error.message}; copy fallback failed with ${copyError.code || copyError.message}`
        );
        fallbackError.code = copyError.code || error.code;
        fallbackError.cause = copyError;
        error = fallbackError;
      }
    }
    if (fs.existsSync(backup) && !fs.existsSync(targetDir)) renameSyncWithRetry(backup, targetDir, options);
    throw error;
  }
  if (fs.existsSync(backup)) fs.rmSync(backup, { recursive: true, force: true });
}

function copyDirectoryAtomically(sourceDir, targetDir, requiredRelPath = 'SKILL.md', options = {}) {
  return withOwnedStaging({
    target: targetDir,
    stagePrefix: `.${path.basename(targetDir)}.staging-`,
    operation: options.operation || 'target-directory-copy',
    sourceType: options.sourceType || 'repo'
  }, (staging) => {
    fs.cpSync(sourceDir, staging, { recursive: true });
    if (requiredRelPath && !fs.existsSync(path.join(staging, requiredRelPath))) {
      throw new Error(`staged target missing ${requiredRelPath}: ${staging}`);
    }
    replaceDirectoryAtomically(staging, targetDir);
  });
}

function writeFileAtomically(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`);
  fs.writeFileSync(tempPath, payloadBytes(content));
  fs.renameSync(tempPath, filePath);
}

function skillBaseRel(targetName, skillName) {
  if (targetName === 'opencode') return skillName;
  if (targetName === 'ag2') return path.join('skills', skillName);
  throw new Error(`Unsupported target: ${targetName}`);
}

function skillPayloadForTarget(targetName, payload, skillName) {
  const prefix = slash(skillBaseRel(targetName, skillName));
  const skillPayload = {};
  for (const [rel, content] of Object.entries(payload)) {
    const normalized = slash(rel);
    if (normalized === prefix) continue;
    if (!normalized.startsWith(`${prefix}/`)) continue;
    skillPayload[normalized.slice(prefix.length + 1)] = content;
  }
  return skillPayload;
}

function rootPayloadForTarget(targetName, payload) {
  const rootPayload = {};
  for (const [rel, content] of Object.entries(payload)) {
    const normalized = slash(rel);
    if (targetName === 'ag2' && normalized.startsWith('skills/')) continue;
    if (targetName === 'opencode' && isValidSkillName(normalized.split('/')[0]) && normalized.includes('/')) continue;
    rootPayload[normalized] = content;
  }
  return rootPayload;
}

function writeSkillPayloadAtomically(targetPath, baseRel, payload, sourceType) {
  const targetDir = path.join(targetPath, ...slash(baseRel).split('/'));
  return withOwnedStaging({
    target: targetDir,
    stagePrefix: `.${path.basename(targetDir)}.staging-`,
    operation: 'target-skill-replacement',
    sourceType
  }, (staging) => {
    writePayloadTree(staging, payload);
    if (!fs.existsSync(path.join(staging, 'SKILL.md'))) {
      throw new Error(`staged target skill missing SKILL.md: ${staging}`);
    }
    replaceDirectoryAtomically(staging, targetDir);
  });
}

function removeStaleManagedSkills(targetName, targetPath, previousNames, currentNames) {
  const current = new Set(currentNames);
  const removed = [];
  for (const name of previousNames) {
    if (current.has(name)) continue;
    const targetDir = path.join(targetPath, ...slash(skillBaseRel(targetName, name)).split('/'));
    if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true });
    removed.push(name);
  }
  return removed.sort((left, right) => left.localeCompare(right));
}

function syncTargetPayload(targetName, targetPath, payloads, sourceType) {
  const payload = appTargetPayload(targetName, payloads);
  const skillNames = targetSkillNames(targetName, payloads);
  const previousNames = previousManagedSkillNames(targetPath);
  fs.mkdirSync(targetPath, { recursive: true });

  for (const skillName of skillNames) {
    writeSkillPayloadAtomically(
      targetPath,
      skillBaseRel(targetName, skillName),
      skillPayloadForTarget(targetName, payload, skillName),
      sourceType
    );
  }

  const removedSkillNames = removeStaleManagedSkills(targetName, targetPath, previousNames, skillNames);

  for (const [rel, content] of Object.entries(rootPayloadForTarget(targetName, payload))) {
    writeFileAtomically(path.join(targetPath, ...slash(rel).split('/')), content);
  }

  return {
    target: targetName,
    targetPath,
    skillNames,
    removedSkillNames
  };
}

function targetWouldSync(targetName, state, checksum, discovery, payloads) {
  const target = state.targets[targetName];
  if (!target.enabled) return false;
  if (target.explicitly_disabled) return false;
  const targetCurrent = discovery && payloads ? targetOutputIsCurrent(targetName, discovery, payloads) : true;
  return target.synced_version !== BRIDGE_VERSION || target.synced_checksum !== checksum || !targetCurrent;
}

function targetIsSynced(targetName, targetState, checksum, discovery, payloads) {
  return (
    targetState.synced_version === BRIDGE_VERSION &&
    targetState.synced_checksum === checksum &&
    targetOutputIsCurrent(targetName, discovery, payloads)
  );
}

function targetStatus(targetState, discovery, checksum) {
  if (targetState.explicitly_disabled) return 'disabled';
  if (targetState.enabled) return 'enabled';
  if (discovery.detected) return 'detected';
  return 'not detected';
}

function updateTargetState(state, targetName, discovery, checksum, synced, skipReason) {
  const target = state.targets[targetName];
  target.detected = discovery.detected;
  target.target_path = discovery.target_path;
  target.skip_reason = skipReason || '';
  if (synced) {
    target.synced_version = BRIDGE_VERSION;
    target.synced_checksum = checksum;
    target.last_sync = timestamp();
  }
}

function stagingAuditParents(hubPath, discoveries) {
  const parents = [path.dirname(hubPath)];
  const opencodeTarget = discoveries?.opencode?.target_path;
  const ag2Target = discoveries?.ag2?.target_path;
  if (opencodeTarget) parents.push(opencodeTarget);
  if (ag2Target) parents.push(path.join(ag2Target, 'skills'));
  return [...new Set(parents.map((value) => path.resolve(value)))];
}

function stagingReconciliationParents(args, hubPath, state) {
  const parents = [path.dirname(hubPath)];
  const openCodeConfig = args.opencodeConfigDir || process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), '.config', 'opencode');
  const openCodeDefaultTarget = path.join(openCodeConfig, 'skills');
  const openCodeTarget = normalizeOpenCodeTargetPath(
    args.opencodeTarget || state.targets.opencode.target_path || openCodeDefaultTarget,
    openCodeDefaultTarget
  );
  parents.push(assertSafeWritePath(openCodeTarget, 'OpenCode staging reconciliation parent'));

  const internalAg2Adapter = path.join(hubPath, 'adapters', 'ag2');
  const savedAg2Target = String(state.targets.ag2.target_path || '');
  const defaultAg2Target = path.join(os.homedir(), '.gemini', 'config', 'plugins', TOOLKIT_NAME);
  const ag2Target = savedAg2Target && path.resolve(savedAg2Target) !== path.resolve(internalAg2Adapter)
    ? savedAg2Target
    : defaultAg2Target;
  parents.push(assertSafeWritePath(path.join(ag2Target, 'skills'), 'Antigravity 2 staging reconciliation parent'));
  return [...new Set(parents.map((value) => path.resolve(value)))];
}

function stagingReconciliationOutput({ args, hubPath, reconciliation }) {
  const alreadyAbsent = reconciliation.reason === 'generation-id-not-found';
  return {
    architecture_version: ARCHITECTURE_VERSION,
    bridge_version: BRIDGE_VERSION,
    dry_run: !args.write,
    hub_path: hubPath,
    sync_source: args.syncSource,
    staging_generations: reconciliation.audit,
    staging_reconciliation: {
      generation_id: args.reconcileStaging,
      reconciled: reconciliation.reconciled,
      status: reconciliation.reconciled
        ? 'cleaned'
        : (alreadyAbsent ? 'already-absent' : (reconciliation.would_reconcile ? 'would-clean' : 'refused')),
      checked_parent_count: reconciliation.exact_lookup?.checked_parents?.length || 0,
      reason: reconciliation.reason || ''
    }
  };
}

function runStagingReconciliation({ args, hubPath, state, testHooks = {} }) {
  const parents = stagingReconciliationParents(args, hubPath, state);
  if (!args.write) {
    const reconciliation = reconcileOwnedStaging(parents, args.reconcileStaging, {
      write: false,
      liveness: testHooks.stagingLiveness
    });
    if (!reconciliation.would_reconcile && reconciliation.reason !== 'generation-id-not-found') {
      throw new Error(`staging reconciliation refused: ${reconciliation.reason}`);
    }
    const output = stagingReconciliationOutput({ args, hubPath, reconciliation });
    console.log(JSON.stringify(output, null, 2));
    return { status: 0, audit: reconciliation.audit, reconciliation };
  }

  const reconciliationLock = acquireLock(path.dirname(hubPath), args);
  if (!reconciliationLock.acquired) {
    throw new Error(`staging reconciliation blocked: ${reconciliationLock.skipReason}`);
  }
  try {
    const reconciliation = reconcileOwnedStaging(parents, args.reconcileStaging, {
      write: true,
      liveness: testHooks.stagingLiveness,
      beforeDelete: testHooks.beforeStagingReconciliationDelete
    });
    if (!reconciliation.reconciled && reconciliation.reason !== 'generation-id-not-found') {
      throw new Error(`staging reconciliation refused: ${reconciliation.reason}`);
    }
    const output = stagingReconciliationOutput({ args, hubPath, reconciliation });
    console.log(JSON.stringify(output, null, 2));
    return { status: 0, audit: reconciliation.audit, reconciliation };
  } finally {
    releaseLock(reconciliationLock);
  }
}

function buildAudit({ args, hubPath, state, discoveries, checksum, payloads }) {
  const dryRun = !args.write;
  return {
    architecture_version: ARCHITECTURE_VERSION,
    bridge_version: BRIDGE_VERSION,
    running_bridge_source: args.syncSource,
    running_bridge_version: BRIDGE_VERSION,
    bridge_versions_by_source: { ...state.bridge_versions_by_source },
    hub_reporting_version: state.hub_version,
    downgrade_enforcement_source: args.syncSource,
    dry_run: dryRun,
    hub_path: hubPath,
    lock_path: path.join(path.dirname(hubPath), 'update.lock'),
    sync_source: args.syncSource,
    auto_sync_enabled: state.auto_sync_enabled,
    update_report_enabled: state.update_report_enabled,
    update_report_open_enabled: state.update_report_open_enabled,
    update_report_open_behavior: state.update_report_open_behavior,
    legacy_update_report_open_migrated: state.legacy_update_report_open_migrated,
    update_report_retention_days: state.update_report_retention_days,
    update_report_cleanup: state.last_update_report_cleanup || {
      retention_days: state.update_report_retention_days,
      report_log_directory: updateReportDir(),
      max_report_files: DEFAULT_UPDATE_REPORT_MAX_FILES,
      deleted_count: 0,
      skipped_count: 0,
      error_count: 0,
      errors: []
    },
    codex_plugin_auto_refresh_enabled: state.codex_plugin_auto_refresh_enabled,
    last_update_report_path: state.last_update_report_path,
    repo_auto_update: {
      enabled: state.repo_auto_update_enabled,
      repo_path: state.repo_path,
      repo_branch: state.repo_branch,
      repo_remote: state.repo_remote,
      last_update: state.last_repo_update,
      last_status: state.last_repo_update_status,
      from_commit: state.last_repo_update_from_commit,
      to_commit: state.last_repo_update_to_commit,
      error: state.last_repo_update_error
    },
    checksum,
    staging_generations: auditOwnedStaging(stagingAuditParents(hubPath, discoveries)),
    targets: Object.fromEntries(SUPPORTED_TARGETS.map((target) => {
      const targetState = state.targets[target];
      const discovery = discoveries[target];
      return [target, {
        status: targetStatus(targetState, discovery, checksum),
        detected: discovery.detected,
        enabled: targetState.enabled,
        explicitly_disabled: targetState.explicitly_disabled,
        target_path: discovery.target_path,
        target_exists: targetOutputExists(target, discovery, payloads),
        internal_adapter_path: discovery.internal_adapter_path,
        internal_adapter_exists: fs.existsSync(discovery.internal_adapter_path),
        synced: targetIsSynced(target, targetState, checksum, discovery, payloads),
        synced_version: targetState.synced_version,
        synced_at: targetState.last_sync,
        ag2_package_detected: target === 'ag2' ? discovery.ag2_package_detected : undefined,
        python_command: target === 'ag2' ? discovery.python_command || '' : undefined,
        would_write: targetWouldSync(target, state, checksum, discovery, payloads),
        skip_reason: targetState.enabled ? targetState.skip_reason : 'not enabled',
        signals: discovery.signals
      }];
    }))
  };
}

function isHookNoop(args, existingState) {
  if (!args.hook) return false;
  if (!existingState || !existingState.hub_version) return true;
  const repoAutoUpdateActive = existingState.repo_auto_update_enabled && !args.skipRepoAutoUpdate;
  if (!repoAutoUpdateActive && !existingState.auto_sync_enabled) return true;
  if (repoAutoUpdateActive) return false;
  return !SUPPORTED_TARGETS.some((target) => existingState.targets[target]?.enabled);
}

function shouldRunRepoAutoUpdate(args, state) {
  if (!args.write) return false;
  if (args.skipRepoAutoUpdate) return false;
  if (!state.repo_auto_update_enabled) return false;
  return args.hook || args.repoUpdateNow;
}

function downgradeRemediation(syncSource) {
  if (syncSource === 'claude-plugin') {
    return 'the installed Claude Code plugin cache is stale; run `setup toolkit --host claude-code` (or `setup toolkit` from Claude Code), then restart Claude Code. If using the raw native command, run `claude plugin update ai-agent-toolkit@ai-agent-toolkit-local --scope user`; if it still reports stale, rerun setup so it can reinstall through the supported Claude Code marketplace path';
  }
  if (syncSource === 'codex-plugin') {
    return 'the installed Codex plugin cache is stale; run `setup toolkit` in Codex to refresh it';
  }
  return 'update or restore the managed Toolkit source checkout, or rerun `setup toolkit`';
}

function recordedBridgeVersionForSource(state, syncSource) {
  assertRecognizedSyncSource(syncSource);
  const version = state?.bridge_versions_by_source?.[syncSource] || '';
  return isValidBridgeVersion(version) ? version : '';
}

function assertSourceDowngradeAllowed(state, args) {
  assertRecognizedSyncSource(args.syncSource);
  const recordedVersion = recordedBridgeVersionForSource(state, args.syncSource);
  if (!recordedVersion || compareBridgeVersions(BRIDGE_VERSION, recordedVersion) >= 0 || args.forceDowngrade) return;
  const forceGuidance = args.hook ? '' : '; use `--force-downgrade` only for explicit manual same-source recovery';
  throw new Error(
    `Refusing downgrade for sync source ${args.syncSource}: running bridge ${BRIDGE_VERSION} is older than recorded ${args.syncSource} bridge ${recordedVersion}; ${downgradeRemediation(args.syncSource)}${forceGuidance}`
  );
}

function hookSafeWarning(args, message) {
  if (args.hook) {
    console.log(`Toolkit local bridge hook skipped: ${sanitizeOutputMessage(message)}`);
  }
}

function runtimeCodexPluginRoot() {
  return path.resolve(process.env.PLUGIN_ROOT || path.resolve(__dirname, '..', '..'));
}

function runtimeClaudePluginRoot() {
  return path.resolve(process.env.CLAUDE_PLUGIN_ROOT || process.env.PLUGIN_ROOT || path.resolve(__dirname, '..', '..'));
}

function codexNativePluginCacheStatus(args, state) {
  if (!args.hook || args.syncSource !== 'codex-plugin') return { status: '' };
  if (!state.repo_path) return { status: '' };
  const repoPath = path.resolve(state.repo_path);
  if (!fs.existsSync(repoPath)) return { status: '' };
  const pluginRoot = runtimeCodexPluginRoot();
  const errors = verifyInstalledCacheFreshness(pluginRoot, repoPath);
  return {
    status: errors.length ? 'stale' : 'fresh',
    plugin_root: pluginRoot,
    repo_path: repoPath,
    errors: errors.slice(0, NATIVE_PLUGIN_CACHE_REPORT_ERROR_LIMIT)
  };
}

function claudeNativePluginCacheStatus(args, state) {
  if (!args.hook || args.syncSource !== 'claude-plugin') return { status: '' };
  return {
    status: 'check-only',
    host: 'claude-code',
    plugin_root: runtimeClaudePluginRoot(),
    repo_path: state.repo_path ? path.resolve(state.repo_path) : '',
    manual_action: 'If Claude Code reports the Toolkit plugin is stale, missing, disabled, or untrusted, refresh it through Claude Code native plugin flow. Codex does not mutate Claude Code cache.'
  };
}

function nativePluginCacheStatus(args, state) {
  if (args.syncSource === 'codex-plugin') return codexNativePluginCacheStatus(args, state);
  if (args.syncSource === 'claude-plugin') return claudeNativePluginCacheStatus(args, state);
  return { status: '' };
}

function isToolkitCodexCacheRoot(cacheRoot, currentPluginRoot) {
  const normalized = path.resolve(cacheRoot);
  if (currentPluginRoot && path.resolve(currentPluginRoot) === normalized) return true;
  const parts = normalized.split(path.sep).map((part) => part.toLowerCase());
  for (let index = 0; index < parts.length - 2; index += 1) {
    if (
      parts[index] === 'ai-agent-toolkit-local' &&
      parts[index + 1] === 'ai-agent-toolkit'
    ) {
      return true;
    }
  }
  return false;
}

function discoverCodexPluginHookRoots({ codexHome = defaultCodexHome(), currentPluginRoot = '' } = {}) {
  const cacheBase = path.join(codexHome, 'plugins', 'cache');
  const roots = [];
  const skipped = [];
  if (!fs.existsSync(cacheBase)) return { roots, skipped };

  for (const marketplace of fs.readdirSync(cacheBase, { withFileTypes: true })) {
    if (!marketplace.isDirectory()) continue;
    const marketplacePath = path.join(cacheBase, marketplace.name);
    for (const plugin of fs.readdirSync(marketplacePath, { withFileTypes: true })) {
      if (!plugin.isDirectory()) continue;
      const pluginPath = path.join(marketplacePath, plugin.name);
      for (const version of fs.readdirSync(pluginPath, { withFileTypes: true })) {
        if (!version.isDirectory()) continue;
        const cacheRoot = path.join(pluginPath, version.name);
        const entry = {
          plugin_id: `${plugin.name}@${marketplace.name}`,
          version: version.name,
          plugin_root: cacheRoot
        };
        if (isToolkitCodexCacheRoot(cacheRoot, currentPluginRoot)) {
          skipped.push({ ...entry, reason: 'toolkit native plugin cache' });
          continue;
        }
        roots.push(entry);
      }
    }
  }
  roots.sort((left, right) => left.plugin_root.localeCompare(right.plugin_root));
  skipped.sort((left, right) => left.plugin_root.localeCompare(right.plugin_root));
  return { roots, skipped };
}

function selectCurrentN8nSkillsCache({ codexHome, pluginList, discovered }) {
  const matches = findInstalledPluginEntries(pluginList, {
    pluginId: 'n8n-skills@n8n-io',
    name: 'n8n-skills',
    marketplaceName: 'n8n-io'
  });
  if (matches.length === 0) {
    return { status: 'not-installed', entry: null, reason: 'Codex reports no installed n8n-skills@n8n-io plugin' };
  }
  if (matches.length !== 1) {
    return {
      status: 'ambiguous',
      entry: null,
      reason: 'Codex reports multiple installed n8n-skills@n8n-io entries; current cache is ambiguous'
    };
  }

  const installed = matches[0];
  if (installed.installed !== true || installed.enabled !== true) {
    return {
      status: 'not-installed',
      entry: null,
      reason: 'Codex does not report n8n-skills@n8n-io as installed and enabled'
    };
  }
  const version = typeof installed.version === 'string' ? installed.version.trim() : '';
  if (!version || version === '.' || version === '..' || /[\\/\0]/.test(version)) {
    return {
      status: 'ambiguous',
      entry: null,
      reason: 'Codex reported an invalid n8n-skills@n8n-io version; current cache cannot be proven'
    };
  }

  const expectedRoot = path.resolve(codexHome, 'plugins', 'cache', 'n8n-io', 'n8n-skills', version);
  const entry = discovered.roots.find((candidate) =>
    candidate.plugin_id === 'n8n-skills@n8n-io' && path.resolve(candidate.plugin_root) === expectedRoot
  ) || null;
  if (!entry) {
    return {
      status: 'missing',
      entry: null,
      reason: `Codex reports current n8n-skills@n8n-io version ${version}, but its installed cache root is missing`
    };
  }
  return { status: 'selected', entry, reason: '' };
}

function selectCurrentN8nSkillsCacheFromConfig({ codexHome, discovered }) {
  const configured = inspectCodexConfiguredPluginState({
    codexHome,
    identity: 'n8n-skills@n8n-io'
  });
  if (configured.status === 'disabled') {
    return {
      status: 'not-installed',
      entry: null,
      reason: 'Codex config explicitly reports n8n-skills@n8n-io disabled'
    };
  }
  if (configured.status !== 'enabled') {
    return {
      status: 'ambiguous',
      entry: null,
      reason: `Codex CLI omitted n8n-skills@n8n-io and current installed/enabled state cannot be proven: ${configured.reason}`
    };
  }

  const candidates = discovered.roots.filter((entry) => entry.plugin_id === 'n8n-skills@n8n-io');
  if (candidates.length !== 1) {
    return {
      status: 'ambiguous',
      entry: null,
      reason: `Codex config explicitly enables n8n-skills@n8n-io, but ${candidates.length} cache candidates exist; the current cache cannot be proven without arbitrary selection`
    };
  }
  return {
    status: 'selected',
    entry: candidates[0],
    reason: 'Selected by explicit Codex config enablement plus one exact n8n Skills cache candidate'
  };
}

function repairThirdPartyCodexPluginHooks(options = {}) {
  const codexHome = path.resolve(options.codexHome || defaultCodexHome());
  const windows = options.windows ?? process.platform === 'win32';
  const write = Boolean(options.write);
  const currentPluginRoot = options.currentPluginRoot || runtimeCodexPluginRoot();
  const discovered = discoverCodexPluginHookRoots({ codexHome, currentPluginRoot });
  const result = {
    status: windows ? 'not-needed' : 'not-supported',
    codex_home: codexHome,
    write,
    scanned: 0,
    skipped: discovered.skipped,
    repaired: [],
    unchanged: [],
    errors: []
  };

  if (!windows) return result;

  const n8nCandidates = [];
  for (const entry of discovered.roots) {
    if (entry.plugin_id === 'n8n-skills@n8n-io') n8nCandidates.push(entry);
    else result.skipped.push({ ...entry, reason: 'unrelated plugin; n8n Skills reconciliation is target-specific' });
  }
  if (n8nCandidates.length === 0) {
    result.skipped.sort((left, right) => left.plugin_root.localeCompare(right.plugin_root));
    return result;
  }

  const pluginInspection = Object.prototype.hasOwnProperty.call(options, 'pluginList')
    ? { ok: true, pluginList: options.pluginList, errors: [] }
    : inspectCodexPluginList({ codexCommand: options.codexCommand || '' });
  const cliMatches = pluginInspection.ok
    ? findInstalledPluginEntries(pluginInspection.pluginList, {
      pluginId: 'n8n-skills@n8n-io',
      name: 'n8n-skills',
      marketplaceName: 'n8n-io'
    })
    : [];
  const selection = pluginInspection.ok && cliMatches.length > 0
    ? selectCurrentN8nSkillsCache({
      codexHome,
      pluginList: pluginInspection.pluginList,
      discovered
    })
    : selectCurrentN8nSkillsCacheFromConfig({ codexHome, discovered });
  if (selection.status !== 'selected') {
    for (const entry of n8nCandidates) {
      result.skipped.push({ ...entry, reason: 'historical or unverified n8n Skills cache; not current according to Codex installed state' });
    }
    result.skipped.sort((left, right) => left.plugin_root.localeCompare(right.plugin_root));
    if (selection.status === 'not-installed') return result;
    result.status = 'repair-failed';
    result.errors = [
      selection.reason,
      ...(!pluginInspection.ok ? (pluginInspection.errors || []) : [])
    ].slice(0, THIRD_PARTY_HOOK_REPAIR_ERROR_LIMIT);
    return result;
  }

  const targets = [selection.entry];
  for (const entry of n8nCandidates) {
    if (path.resolve(entry.plugin_root) === path.resolve(selection.entry.plugin_root)) continue;
    result.skipped.push({ ...entry, reason: 'historical n8n Skills cache; not current according to Codex installed state' });
  }
  result.scanned = 1;
  result.skipped.sort((left, right) => left.plugin_root.localeCompare(right.plugin_root));

  for (const entry of targets) {
    try {
      const repair = reconcileN8nSkillsPlugin(entry.plugin_root, {
        windows: true,
        write
      });
      if (repair.repaired) {
        result.repaired.push({
          ...entry,
          actions: repair.actions || []
        });
      } else {
        result.unchanged.push({ ...entry, classification: repair.status });
      }
    } catch (error) {
      result.errors.push(`${entry.plugin_id}: ${error.message}`);
    }
  }

  if (result.errors.length && result.repaired.length) result.status = 'partial-failed';
  else if (result.errors.length) result.status = 'repair-failed';
  else if (result.repaired.length) result.status = 'repaired';
  else result.status = 'not-needed';
  result.errors = result.errors.slice(0, THIRD_PARTY_HOOK_REPAIR_ERROR_LIMIT);
  return result;
}

function maybeRepairThirdPartyCodexPluginHooks(args, state) {
  if (!args.hook || args.syncSource !== 'codex-plugin') return { status: '' };
  if (!state.codex_plugin_auto_refresh_enabled) return { status: '' };
  return repairThirdPartyCodexPluginHooks({
    write: true,
    currentPluginRoot: runtimeCodexPluginRoot()
  });
}

function refreshCodexNativePluginCacheFromRepo({ args, state, repoPath, validateRepo = false }) {
  const before = codexNativePluginCacheStatus(args, state);
  if (before.status !== 'stale') return before;
  if (!state.codex_plugin_auto_refresh_enabled) return before;
  const resolvedRepoPath = path.resolve(repoPath || state.repo_path || '');
  if (validateRepo) {
    try {
      runRepoValidation(resolvedRepoPath, { hookMode: true });
    } catch (error) {
      return {
        ...before,
        status: 'refresh-failed',
        errors: [`Codex plugin cache auto-refresh skipped because trusted repo validation failed: ${error.message}`]
      };
    }
  }
  const setupScript = path.join(resolvedRepoPath, 'repo', 'scripts', 'setup-codex-toolkit-plugin.cjs');
  if (!fs.existsSync(setupScript)) {
    return {
      ...before,
      status: 'refresh-failed',
      errors: [`Codex plugin setup helper not found in trusted repo: ${setupScript}`]
    };
  }

  const result = runCommand(process.execPath, [
    setupScript,
    '--write',
    '--json',
    '--repo-root',
    resolvedRepoPath
  ], {
    cwd: resolvedRepoPath,
    timeout: 180000
  });
  if (!result.ok) {
    return {
      ...before,
      status: 'refresh-failed',
      errors: [`Codex plugin cache auto-refresh failed: ${commandOutput(result)}`]
    };
  }

  const afterErrors = verifyInstalledCacheFreshness(before.plugin_root, resolvedRepoPath);
  if (afterErrors.length) {
    return {
      ...before,
      status: 'refresh-failed',
      errors: afterErrors.slice(0, NATIVE_PLUGIN_CACHE_REPORT_ERROR_LIMIT)
    };
  }
  return {
    ...before,
    status: 'refreshed',
    errors: []
  };
}

function nativePluginCacheStatusForReport(args, state, options = {}) {
  if (args.syncSource === 'codex-plugin') {
    return refreshCodexNativePluginCacheFromRepo({
      args,
      state,
      repoPath: options.repoPath || state.repo_path,
      validateRepo: options.validateRepo === true
    });
  }
  return nativePluginCacheStatus(args, state);
}

function runDelegatedRepoSync({ args, hubPath, repoPath }) {
  const scriptPath = path.join(repoPath, 'repo', 'scripts', 'toolkit-local-bridge.cjs');
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`updated repo bridge script not found: ${scriptPath}`);
  }
  const delegateArgs = [
    scriptPath,
    '--sync-enabled',
    '--write',
    '--sync-source',
    'repo',
    '--hub',
    hubPath,
    '--skip-repo-auto-update',
    '--suppress-update-report'
  ];
  const result = runCommand(process.execPath, delegateArgs, {
    cwd: repoPath,
    timeout: 120000
  });
  if (result.stdout.trim() && !args.hook) console.log(result.stdout.trim());
  if (result.stderr.trim()) console.error(result.stderr.trim());
  if (!result.ok) {
    throw new Error(`delegated repo sync failed: ${commandOutput(result)}`);
  }
  return { status: 0 };
}

function runRepoAutoUpdate({ args, hubPath, state, discoveries, checksum, payloads, testHooks = {} }) {
  const lock = acquireLock(path.dirname(hubPath), args);
  if (!lock.acquired) {
    console.log(`Toolkit local bridge: ${sanitizeOutputMessage(lock.skipReason)}; skipping repo auto-update.`);
    return { status: 0, audit: buildAudit({ args, hubPath, state, discoveries, checksum, payloads }) };
  }

  state = applyRequestedState(normalizedState(readJsonIfExists(path.join(hubPath, 'state.json'))), args);
  assertSourceDowngradeAllowed(state, args);

  let statusState = state;
  let updateResult = null;
  let snapshot = null;
  let plannedTargetSyncs = [];
  let nativePluginCache = { status: '' };
  let thirdPartyHookRepair = { status: '' };
  const previousObservedRepoCommit = state.last_repo_update_to_commit || '';
  try {
    try {
      updateResult = validateAndUpdateRepo(state, args);
      statusState = applyRepoUpdateStatus(state, updateResult.status, {
        fromCommit: updateResult.fromCommit,
        toCommit: updateResult.toCommit
      });
      snapshot = deriveSnapshotGeneration({ args, hubPath, state: statusState, prepareForWrite: true });
      statusState = snapshot.state;
      writeHubSnapshot({ hubPath, args, ...snapshot }, testHooks);
    } catch (error) {
      const details = error.repoUpdateDetails || {};
      statusState = applyRepoUpdateStatus(state, error.repoUpdateStatus || 'skipped', {
        fromCommit: details.fromCommit || '',
        toCommit: details.toCommit || '',
        error: details.error || error.message
      });
      snapshot = deriveSnapshotGeneration({ args, hubPath, state: statusState, prepareForWrite: true });
      statusState = snapshot.state;
      writeHubSnapshot({ hubPath, args, ...snapshot }, testHooks);
      const report = maybeWriteUpdateReport({
        args,
        hubPath,
        state: statusState,
        checksum: snapshot.checksum,
        context: {
          repo: {
            status: error.repoUpdateStatus || 'skipped',
            repoPath: state.repo_path ? path.resolve(state.repo_path) : '',
            fromCommit: details.fromCommit || '',
            toCommit: details.toCommit || '',
            changedFiles: details.changedFiles || [],
            validationStatus: details.validationStatus || (error.repoUpdateStatus === 'validation-failed' ? 'failed' : 'not run'),
            branchSwitchedFrom: details.branchSwitchedFrom || '',
            error: details.error || error.message
          },
          skippedTargets: snapshot.skippedTargets,
          nativePluginCache: nativePluginCacheStatus(args, statusState),
          targetSyncStatus: 'skipped'
        }
      });
      statusState = report.state;
      if (report.reportPath) {
        snapshot = { ...snapshot, state: statusState };
        writeHubSnapshot({ hubPath, args, ...snapshot }, testHooks);
      }
      printUpdateReportLine(args, report.reportPath);
      if (args.hook) {
        hookSafeWarning(args, error.message);
        return { status: 0, audit: buildAudit({ args, hubPath, ...snapshot, state: statusState }) };
      }
      throw error;
    }
  } finally {
    releaseLock(lock);
  }

  const refreshLock = acquireLock(path.dirname(hubPath), args);
  try {
    if (refreshLock.acquired) {
      statusState = normalizedState(readJsonIfExists(path.join(hubPath, 'state.json')) || statusState);
      assertSourceDowngradeAllowed(statusState, args);
      snapshot = deriveSnapshotGeneration({ args, hubPath, state: statusState, prepareForWrite: true });
      statusState = snapshot.state;
      plannedTargetSyncs = snapshot.plannedTargetSyncs;
      writeHubSnapshot({ hubPath, args, ...snapshot }, testHooks);
    }
  } finally {
    releaseLock(refreshLock);
  }

  nativePluginCache = nativePluginCacheStatusForReport(args, statusState, {
    repoPath: updateResult.repoPath
  });
  thirdPartyHookRepair = maybeRepairThirdPartyCodexPluginHooks(args, statusState);

  try {
    runDelegatedRepoSync({ args, hubPath, repoPath: updateResult.repoPath });
  } catch (error) {
    const relock = acquireLock(path.dirname(hubPath), args);
    let failedState = statusState;
    let report = { state: failedState, reportPath: '' };
    try {
      if (relock.acquired) {
        const latestState = normalizedState(readJsonIfExists(path.join(hubPath, 'state.json')) || statusState);
        assertSourceDowngradeAllowed(latestState, args);
        failedState = applyRepoUpdateStatus(latestState, 'sync-delegation-failed', {
          fromCommit: updateResult.fromCommit,
          toCommit: updateResult.toCommit,
          error: error.message
        });
        let failedSnapshot = deriveSnapshotGeneration({ args, hubPath, state: failedState, prepareForWrite: true });
        failedState = failedSnapshot.state;
        writeHubSnapshot({ hubPath, args, ...failedSnapshot }, testHooks);
        report = maybeWriteUpdateReport({
          args,
          hubPath,
          state: failedState,
          checksum: failedSnapshot.checksum,
          context: {
            repo: {
              status: 'sync-delegation-failed',
              repoPath: updateResult.repoPath || state.repo_path || '',
              fromCommit: updateResult.fromCommit,
              toCommit: updateResult.toCommit,
              changedFiles: updateResult.changedFiles || [],
              validationStatus: updateResult.validation?.status || 'passed',
              error: error.message
            },
            skippedTargets: failedSnapshot.skippedTargets,
            nativePluginCache,
            thirdPartyHookRepair,
            targetSyncStatus: 'failed'
          }
        });
        failedState = report.state;
        if (report.reportPath) {
          failedSnapshot = { ...failedSnapshot, state: failedState };
          writeHubSnapshot({ hubPath, args, ...failedSnapshot }, testHooks);
        }
        snapshot = failedSnapshot;
      }
    } finally {
      releaseLock(relock);
    }
    printUpdateReportLine(args, report.reportPath);
    if (args.hook) {
      hookSafeWarning(args, error.message);
      return { status: 0, audit: buildAudit({ args, hubPath, ...snapshot, state: report.state }) };
    }
    throw error;
  }

  const finalState = normalizedState(readJsonIfExists(path.join(hubPath, 'state.json')) || statusState);
  const plannedChecksum = snapshot.checksum;
  if (testHooks.beforeFinalReportLock) testHooks.beforeFinalReportLock({ hubPath, statusState, snapshot });
  const reportLock = acquireLock(path.dirname(hubPath), args);
  let report = { state: finalState, reportPath: '' };
  try {
    if (reportLock.acquired) {
      const latestState = normalizedState(readJsonIfExists(path.join(hubPath, 'state.json')) || finalState);
      assertSourceDowngradeAllowed(latestState, args);
      let reportSnapshot = deriveSnapshotGeneration({ args, hubPath, state: latestState, prepareForWrite: true });
      const reportState = reportSnapshot.state;
      const completedTargetSyncs = plannedTargetSyncs.filter((sync) => (
        reportSnapshot.checksum === plannedChecksum &&
        targetIsSynced(sync.target, reportState.targets[sync.target], reportSnapshot.checksum, reportSnapshot.discoveries[sync.target], reportSnapshot.payloads)
      ));
      const reportContext = {
        repo: repoReportContextFromUpdate(reportState, updateResult, previousObservedRepoCommit),
        targetSyncs: completedTargetSyncs,
        skippedTargets: reportSnapshot.skippedTargets,
        nativePluginCache,
        thirdPartyHookRepair,
        targetSyncStatus: plannedTargetSyncs.length
          ? (completedTargetSyncs.length === plannedTargetSyncs.length ? 'synced' : 'not confirmed')
          : 'not needed'
      };
      report = maybeWriteUpdateReport({
        args,
        hubPath,
        state: reportState,
        checksum: reportSnapshot.checksum,
        context: reportContext
      });
      if (testHooks.afterFinalReportBuild) {
        testHooks.afterFinalReportBuild({ args, report, reportContext, reportSnapshot });
      }
      if (report.reportPath) {
        reportSnapshot = { ...reportSnapshot, state: report.state };
        writeHubSnapshot({ hubPath, args, ...reportSnapshot }, testHooks);
      }
      snapshot = reportSnapshot;
    }
  } finally {
    releaseLock(reportLock);
  }
  printUpdateReportLine(args, report.reportPath);
  if (!report.reportPath && !args.hook && updateResult.status === 'up-to-date' && !plannedTargetSyncs.length) {
    console.log('Toolkit already up to date.');
  }
  const finalAudit = buildAudit({ args, hubPath, ...snapshot, state: report.state });
  if (args.audit) console.log(JSON.stringify(finalAudit, null, 2));
  return { status: 0, audit: finalAudit };
}

function persistActiveNoTargetWrite({
  args,
  hubPath,
  cleanupResult,
  buildReportContext,
  testHooks = {}
}) {
  const lock = acquireLock(path.dirname(hubPath), args);
  if (!lock.acquired) {
    console.log(`Toolkit local bridge: ${sanitizeOutputMessage(lock.skipReason)}; skipping sync.`);
    return {
      state: normalizedState(readJsonIfExists(path.join(hubPath, 'state.json'))),
      reportPath: '',
      persisted: false
    };
  }

  try {
    const latestState = normalizedState(readJsonIfExists(path.join(hubPath, 'state.json')));
    assertSourceDowngradeAllowed(latestState, args);
    let state = applyRequestedState(latestState, args);
    state.last_update_report_cleanup = cleanupResult;
    let snapshot = deriveSnapshotGeneration({ args, hubPath, state, prepareForWrite: true });
    state = snapshot.state;

    // Source-version persistence is independent of optional report creation.
    writeHubSnapshot({ hubPath, args, ...snapshot }, testHooks);
    const targetSyncs = [];
    for (const plan of snapshot.plannedTargetSyncs) {
      const targetPath = assertSafeWritePath(plan.targetPath, `${targetDisplayName(plan.target)} target path`);
      targetSyncs.push(syncTargetPayload(plan.target, targetPath, snapshot.payloads, args.syncSource));
      updateTargetState(state, plan.target, snapshot.discoveries[plan.target], snapshot.checksum, true, '');
    }
    if (targetSyncs.length) {
      state.updated_at = timestamp();
      snapshot = { ...snapshot, state };
      writeHubSnapshot({ hubPath, args, ...snapshot }, testHooks);
    }
    const report = maybeWriteUpdateReport({
      args,
      hubPath,
      state,
      checksum: snapshot.checksum,
      context: buildReportContext(state, snapshot, targetSyncs)
    });
    if (report.reportPath) {
      snapshot = { ...snapshot, state: report.state };
      writeHubSnapshot({ hubPath, args, ...snapshot }, testHooks);
    }
    return { ...report, snapshot, persisted: true };
  } finally {
    releaseLock(lock);
  }
}

function run(argv = process.argv.slice(2), testHooks = {}) {
  if (process.env.AI_AGENT_TOOLKIT_CAPABILITY_PROBE === '1' && argv.includes('--hook')) {
    return { status: 0, audit: null, capability_probe_noop: true };
  }
  if (process.env.AI_AGENT_TOOLKIT_CHECKER === '1' && argv.includes('--hook')) {
    return { status: 0, audit: null, checker_session_noop: true };
  }
  const args = parseArgs(argv);
  assertReconciliationCommandArgs(args);
  const hubPath = assertSafeWritePath(args.hub || defaultHubPath(), 'hub path');
  const existingState = normalizedState(readJsonIfExists(path.join(hubPath, 'state.json')));
  if (args.reconcileStaging) {
    assertSourceDowngradeAllowed(existingState, args);
    return runStagingReconciliation({ args, hubPath, state: existingState, testHooks });
  }
  maybePrintAgentRulesPreflight(args);

  assertSourceDowngradeAllowed(existingState, args);

  if (isHookNoop(args, existingState)) {
    if (existingState?.hub_version && !existingState.auto_sync_enabled) {
      console.log('Toolkit local bridge: auto-sync disabled; run node repo/scripts/toolkit-local-bridge.cjs --audit for status.');
    }
    return { status: 0, audit: null };
  }

  let nextState = applyRequestedState(existingState, args);
  const cleanupResult = args.write
    ? cleanupUpdateReports({ retentionDays: nextState.update_report_retention_days })
    : (nextState.last_update_report_cleanup || {
        retention_days: nextState.update_report_retention_days,
        report_log_directory: updateReportDir(),
        max_report_files: DEFAULT_UPDATE_REPORT_MAX_FILES,
        deleted_count: 0,
        skipped_count: 0,
        error_count: 0,
        errors: []
      });
  nextState.last_update_report_cleanup = cleanupResult;
  if (args.write && cleanupResult.error_count && !args.hook) {
    console.warn(`Toolkit update report cleanup warning: ${cleanupResult.errors.map(sanitizeOutputMessage).join('; ')}`);
  }
  if (args.enableRepoAutoUpdate && !nextState.repo_path) {
    throw new Error('--enable-repo-auto-update requires --repo-path or an existing repo_path in hub state');
  }
  const initialSnapshot = deriveSnapshotGeneration({ args, hubPath, state: nextState });
  nextState = initialSnapshot.state;
  let { discoveries, payloads, checksum } = initialSnapshot;
  if (testHooks.afterInitialSnapshotDerivation) testHooks.afterInitialSnapshotDerivation(initialSnapshot);

  const audit = buildAudit({ args, hubPath, state: nextState, discoveries, checksum, payloads });
  if (args.audit || !args.write) {
    console.log(JSON.stringify(audit, null, 2));
  }
  if (!args.write) return { status: 0, audit };
  if (shouldRunRepoAutoUpdate(args, nextState)) {
    return runRepoAutoUpdate({ args, hubPath, state: nextState, discoveries, checksum, payloads, testHooks });
  }
  const hasTargetSync = SUPPORTED_TARGETS.some((target) => targetWouldSync(target, nextState, checksum, discoveries[target], payloads));
  if (
    args.syncEnabled &&
    !args.enableTargets.length &&
    !args.disableTargets.length &&
    !args.enableAutoSync &&
    !args.disableAutoSync &&
    !args.enableRepoAutoUpdate &&
    !args.disableRepoAutoUpdate &&
    !hasTargetSync
  ) {
    const hasConfiguredState = Boolean(
      existingState.hub_version ||
      Object.keys(existingState.bridge_versions_by_source || {}).length ||
      existingState.auto_sync_enabled ||
      existingState.repo_auto_update_enabled ||
      SUPPORTED_TARGETS.some((target) => existingState.targets[target]?.enabled)
    );
    if (!hasConfiguredState) {
      if (!args.hook) console.log('Toolkit local bridge: no enabled stale targets to sync.');
      return { status: 0, audit };
    }
    const report = persistActiveNoTargetWrite({
      args,
      hubPath,
      cleanupResult,
      testHooks,
      buildReportContext: (state, snapshot, targetSyncs) => ({
        repo: repoReportContextFromState(state, args),
        targetSyncs,
        skippedTargets: snapshot.skippedTargets,
        nativePluginCache: nativePluginCacheStatusForReport(args, state, {
          repoPath: state.repo_path,
          validateRepo: true
        }),
        thirdPartyHookRepair: maybeRepairThirdPartyCodexPluginHooks(args, state),
        targetSyncStatus: targetSyncs.length ? 'synced' : 'not needed'
      })
    });
    nextState = report.state;
    if (report.snapshot) ({ discoveries, payloads, checksum } = report.snapshot);
    const finalAudit = buildAudit({ args, hubPath, state: nextState, discoveries, checksum, payloads });
    if (report.reportPath) printUpdateReportLine(args, report.reportPath);
    else if (!args.hook) console.log('Toolkit local bridge: no enabled stale targets to sync.');
    return { status: 0, audit: finalAudit };
  }
  if (args.hook && !hasTargetSync) {
    const report = persistActiveNoTargetWrite({
      args,
      hubPath,
      cleanupResult,
      testHooks,
      buildReportContext: (state, snapshot, targetSyncs) => ({
        repo: repoReportContextFromState(state, args),
        targetSyncs,
        skippedTargets: snapshot.skippedTargets,
        nativePluginCache: nativePluginCacheStatusForReport(args, state, {
          repoPath: state.repo_path,
          validateRepo: true
        }),
        thirdPartyHookRepair: maybeRepairThirdPartyCodexPluginHooks(args, state),
        targetSyncStatus: targetSyncs.length ? 'synced' : 'not needed'
      })
    });
    nextState = report.state;
    if (report.snapshot) ({ discoveries, payloads, checksum } = report.snapshot);
    const finalAudit = buildAudit({ args, hubPath, state: nextState, discoveries, checksum, payloads });
    if (report.reportPath) printUpdateReportLine(args, report.reportPath);
    return { status: 0, audit: finalAudit };
  }

  const lock = acquireLock(path.dirname(hubPath), args);
  if (!lock.acquired) {
    console.log(`Toolkit local bridge: ${sanitizeOutputMessage(lock.skipReason)}; skipping sync.`);
    return { status: 0, audit };
  }

  try {
    const lockedState = normalizedState(readJsonIfExists(path.join(hubPath, 'state.json')));
    assertSourceDowngradeAllowed(lockedState, args);
    nextState = applyRequestedState(lockedState, args);
    nextState.last_update_report_cleanup = cleanupResult;
    let snapshot = deriveSnapshotGeneration({ args, hubPath, state: nextState, prepareForWrite: true });
    nextState = snapshot.state;
    ({ discoveries, payloads, checksum } = snapshot);
    writeHubSnapshot({ hubPath, args, ...snapshot }, testHooks);

    const targetSyncs = [];
    for (const plan of snapshot.plannedTargetSyncs) {
      const targetPath = assertSafeWritePath(plan.targetPath, `${targetDisplayName(plan.target)} target path`);
      targetSyncs.push(syncTargetPayload(plan.target, targetPath, payloads, args.syncSource));
      updateTargetState(nextState, plan.target, discoveries[plan.target], checksum, true, '');
    }

    nextState.updated_at = timestamp();
    snapshot = { ...snapshot, state: nextState };
    writeHubSnapshot({ hubPath, args, ...snapshot }, testHooks);

    const report = maybeWriteUpdateReport({
      args,
      hubPath,
      state: nextState,
      checksum,
      context: {
        repo: repoReportContextFromState(nextState, args),
        targetSyncs,
        skippedTargets: snapshot.skippedTargets,
        nativePluginCache: nativePluginCacheStatusForReport(args, nextState, {
          repoPath: nextState.repo_path,
          validateRepo: true
        }),
        thirdPartyHookRepair: maybeRepairThirdPartyCodexPluginHooks(args, nextState),
        targetSyncStatus: targetSyncs.length ? 'synced' : 'not needed'
      }
    });
    nextState = report.state;
    if (report.reportPath) {
      snapshot = { ...snapshot, state: nextState };
      writeHubSnapshot({ hubPath, args, ...snapshot }, testHooks);
    }

    const finalAudit = buildAudit({ args, hubPath, state: nextState, discoveries, checksum, payloads });
    if (args.audit) console.log(JSON.stringify(finalAudit, null, 2));
    else if (report.reportPath) printUpdateReportLine(args, report.reportPath);
    else if (!args.hook) console.log('Toolkit local bridge sync complete.');
    return { status: 0, audit: finalAudit };
  } finally {
    releaseLock(lock);
  }
}

if (require.main === module) {
  try {
    const result = run();
    process.exit(result.status || 0);
  } catch (error) {
    const reconciliationRequested = process.argv.some((arg) => arg === '--reconcile-staging' || arg.startsWith('--reconcile-staging='));
    if (process.argv.includes('--hook') && !reconciliationRequested) {
      console.log(`Toolkit local bridge hook skipped: ${sanitizeOutputMessage(error.message)}`);
      process.exit(0);
    }
    console.error(`FAIL: ${sanitizeOutputMessage(error.message)}`);
    process.exit(1);
  }
}

module.exports = {
  ARCHITECTURE_VERSION,
  BRIDGE_VERSION,
  acquireLock,
  defaultHubPath,
  inspectDisplacedEvidence,
  inspectLockForRecovery,
  inspectRecoveryMarker,
  lockOwnerLiveness,
  parseArgs,
  releaseLock,
  releaseRecoveryMarker,
  run,
  adapterPayloads,
  payloadChecksum,
  compareSemver,
  getRepoValidationLabels,
  runRepoValidation,
  updateReportSignature,
  classifyUpdateReport,
  maybeWriteUpdateReport,
  updateReportDir,
  cleanupUpdateReports,
  sanitizeOutputMessage,
  openUpdateReport,
  replaceDirectoryAtomically,
  parseManagedMarkerBlocks,
  nearestGitRoot,
  runAgentRulesPreflight,
  formatAgentRulesPreflight,
  discoverCodexPluginHookRoots,
  repairThirdPartyCodexPluginHooks
};
