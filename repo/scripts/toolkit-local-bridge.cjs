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
  N8N_SKILLS_COMPATIBILITY_ADAPTERS,
  N8N_SKILLS_TREE_LIMITS,
  classifyN8nSkillsCompatibility,
  reconcileN8nSkillsPlugin,
  renderN8nSkillsCompatibilityDecision,
  validateN8nSkillsCompatibilityContractParity
} = require('./repair-codex-plugin-windows-hooks.cjs');
const {
  RECORD_PREFIX,
  auditOwnedStaging,
  cleanupOwnedGeneration,
  createOwnedStagingGeneration,
  inspectOwnedGeneration,
  markOwnedStaging,
  reconcileOwnedStaging,
  writeOwnedStagingAuxiliary
} = require('./toolkit-staging-generations.cjs');
const {
  appendLogicalRetirement,
  appendN8nRepairJournalRecord,
  assertJournalAuthorityUnchanged,
  bindJournalAuthority,
  compactSupersededTransaction,
  discoverN8nRepairJournalsForTarget,
  journalPaths,
  logicalRetirementManifest,
  residueManifest,
  revalidateLogicalRetirement,
  targetJournalUsage,
  writeTerminalCheckpoint
} = require('./toolkit-n8n-repair-journal.cjs');

const ARCHITECTURE_VERSION = 2;
const BRIDGE_VERSION = '2.9.24';
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
const N8N_PRE_TRANSACTION_AUXILIARY_KINDS = Object.freeze([
  'n8n-pre-transaction',
  'n8n-pre-transaction-phase-10-copied',
  'n8n-pre-transaction-phase-15-transforming',
  'n8n-pre-transaction-phase-20-transformed'
]);
const N8N_REPLACEMENT_AUXILIARY_KINDS = Object.freeze([
  'n8n-replacement',
  'n8n-replacement-phase-10-displace',
  'n8n-replacement-phase-20-displaced',
  'n8n-replacement-phase-30-install',
  'n8n-replacement-phase-40-installed',
  'n8n-replacement-phase-50-verify',
  'n8n-replacement-phase-60-verified',
  'n8n-replacement-phase-70-cleanup'
]);
const N8N_TRANSACTION_AUXILIARY_KINDS = Object.freeze([
  ...N8N_PRE_TRANSACTION_AUXILIARY_KINDS,
  ...N8N_REPLACEMENT_AUXILIARY_KINDS
]);
const N8N_REPLACEMENT_RECORD_LIMIT = 16;
const N8N_REPLACEMENT_DIRECTORY_ENTRY_LIMIT = 4096;
const N8N_EVIDENCE_FILE_BYTE_LIMIT = 1024 * 1024;
const N8N_BACKUP_RESIDUE_MANIFEST_BYTE_LIMIT = 4 * 1024 * 1024;
const N8N_PHASE_70_EVIDENCE_FILE_BYTE_LIMIT = 5 * 1024 * 1024;
const N8N_LOGICAL_RETIREMENT_MAX_OBJECTS = 64;
const N8N_LOGICAL_RETIREMENT_MAX_BYTES = 512 * 1024 * 1024;
const N8N_RETENTION_CAPACITY_LOCK_ATTEMPTS = 4800;
const N8N_RETENTION_CAPACITY_LOCK_DELAY_MS = 25;
const N8N_LOGICAL_RETIREMENT_MAX_TREE_ENTRIES =
  N8N_SKILLS_TREE_LIMITS.max_files + N8N_SKILLS_TREE_LIMITS.max_directories + 1;
const N8N_EVIDENCE_CONTEXT = Symbol('n8n-evidence-context');
const N8N_EVIDENCE_LIFECYCLE_OWNER = Symbol('n8n-evidence-lifecycle-owner');
const N8N_JOURNAL_CONTEXT = Symbol('n8n-journal-context');
const N8N_TARGET_LOCK_AUTHORITY = Symbol('n8n-target-lock-authority');
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
    if (options.completeOwnedStaging) options.completeOwnedStaging(generation);
    else markOwnedStaging(generation, 'completed');
    return result;
  } catch (error) {
    operationError = error;
    try {
      if (options.failOwnedStaging) options.failOwnedStaging(generation);
      else markOwnedStaging(generation, 'failed');
    } catch (markerError) {
      error.stagingMarkerError = markerError;
    }
    throw error;
  } finally {
    if (!operationError?.preserveOwnedStaging) {
      const cleanup = options.cleanupOwnedStaging
        ? options.cleanupOwnedStaging(generation, operationError)
        : cleanupOwnedGeneration(generation, {
          currentOperation: true,
          beforeDelete: options.beforeDelete,
          auxiliaryKinds: options.auxiliaryKinds || []
        });
      if (
        cleanup.physicalCleanupError
        || cleanup.checkpointCleanupError
        || (!cleanup.cleaned && !cleanup.logicallyRetired)
      ) {
        const cleanupError = new Error(
          `Owned staging generation ${generation.record.generation_id} was preserved because cleanup could not prove ownership: ${cleanup.checkpointCleanupError?.message || cleanup.physicalCleanupCause?.message || cleanup.error?.message || cleanup.physicalCleanupError || cleanup.reason}`
        );
        cleanupError.code = cleanup.checkpointCleanupError?.code
          || cleanup.physicalCleanupCause?.code
          || cleanup.error?.code
          || cleanup.physicalCleanupError
          || 'physical-cleanup-pending';
        if (operationError) {
          operationError.stagingCleanupError = cleanupError;
          operationError.message = `${operationError.message}; ${cleanupError.message}`;
        }
        else throw cleanupError;
      }
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
const LOCK_ARTIFACT_FILE_BYTE_LIMIT = 16 * 1024;
const LOCK_ARTIFACT_ID_PATTERN = '[0-9a-f]{16}';
const LOCK_TOKEN_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

function isStrictN8nTargetLockName(lockName) {
  return /^\.ai-agent-toolkit-n8n-target-[0-9a-f]{64}\.lock$/.test(String(lockName));
}

function classifyLockArtifactName(entryName, lockName, allowRetirement = true) {
  const entry = String(entryName);
  const escapedLockName = lockNamePattern(lockName);
  if (allowRetirement) {
    const retirement = entry.match(new RegExp(
      `^(.+)\\.quarantine-(${LOCK_ARTIFACT_ID_PATTERN})$`
    ));
    if (retirement) {
      const sourceArtifact = classifyLockArtifactName(retirement[1], lockName, false);
      if (sourceArtifact) {
        return Object.freeze({
          artifact_identity: retirement[2],
          kind: 'retirement-quarantine',
          lock_name: lockName,
          source_artifact: sourceArtifact,
          source_name: retirement[1]
        });
      }
    }
  }
  if (entry === lockName) return Object.freeze({ kind: 'main-lock', lock_name: lockName });
  if (entry === `${lockName}${LOCK_RECOVERY_MARKER_SUFFIX}`) {
    return Object.freeze({ kind: 'recovery-marker', lock_name: lockName });
  }
  let match = entry.match(new RegExp(
    `^${escapedLockName}\\.recovery\\.claim-(${LOCK_ARTIFACT_ID_PATTERN})$`
  ));
  if (match) {
    return Object.freeze({
      artifact_identity: match[1],
      kind: 'recovery-claim',
      lock_name: lockName
    });
  }
  match = entry.match(new RegExp(
    `^${escapedLockName}\\.displaced\\.(${LOCK_TOKEN_PATTERN})\\.retired-(${LOCK_ARTIFACT_ID_PATTERN})$`
  ));
  if (match) {
    return Object.freeze({
      artifact_identity: match[2],
      displacement_token: match[1],
      kind: 'displaced-retirement',
      lock_name: lockName
    });
  }
  match = entry.match(new RegExp(
    `^${escapedLockName}\\.displaced\\.(${LOCK_TOKEN_PATTERN})$`
  ));
  if (match) {
    return Object.freeze({
      displacement_token: match[1],
      kind: 'displaced-lock',
      lock_name: lockName
    });
  }
  return null;
}

function classifyRetainedLockArtifactForParent(entryName, lockName = '') {
  const current = lockName
    ? classifyLockArtifactName(entryName, lockName)
    : null;
  if (current?.kind === 'retirement-quarantine') return current;
  const strictNamespace = String(entryName).match(
    /^(\.ai-agent-toolkit-n8n-target-[0-9a-f]{64}\.lock)/
  )?.[1];
  if (!strictNamespace || strictNamespace === lockName) return null;
  const strict = classifyLockArtifactName(entryName, strictNamespace);
  return strict?.kind === 'retirement-quarantine' ? strict : null;
}

function validLockArtifactPid(value) {
  return Number.isInteger(value) && value > 0;
}

function validLockArtifactToken(value) {
  return new RegExp(`^${LOCK_TOKEN_PATTERN}$`).test(String(value || ''));
}

function validateLockArtifactRecord(artifact, record, expectedSyncSource = '') {
  if (
    !record
    || typeof record !== 'object'
    || Array.isArray(record)
    || !validLockArtifactPid(record.pid)
    || !Number.isFinite(Date.parse(String(record.created_at || '')))
  ) {
    throw failClosedN8nRepair(
      'target-lock-artifact-invalid',
      'Target-lock artifact ownership fields are malformed'
    );
  }
  if (['main-lock', 'displaced-lock'].includes(artifact.kind)) {
    if (
      !validLockArtifactToken(record.token)
      || typeof record.bridge_version !== 'string'
      || !record.bridge_version
      || typeof record.sync_source !== 'string'
      || !record.sync_source
      || (expectedSyncSource && record.sync_source !== expectedSyncSource)
    ) {
      throw failClosedN8nRepair(
        'target-lock-artifact-invalid',
        'Target-lock owner evidence is malformed or source-mismatched'
      );
    }
  } else if (artifact.kind === 'recovery-marker') {
    if (!validLockArtifactToken(record.token)) {
      throw failClosedN8nRepair(
        'target-lock-artifact-invalid',
        'Target-lock recovery marker token is malformed'
      );
    }
  } else if (artifact.kind === 'recovery-claim') {
    if (
      !validLockArtifactToken(record.token)
      || record.reclaimed_marker_identity !== artifact.artifact_identity
    ) {
      throw failClosedN8nRepair(
        'target-lock-artifact-invalid',
        'Target-lock recovery claim is malformed or identity-mismatched'
      );
    }
  } else if (
    artifact.kind === 'displaced-retirement'
    && record.retired_identity !== artifact.artifact_identity
  ) {
    throw failClosedN8nRepair(
      'target-lock-artifact-invalid',
      'Target-lock displaced-evidence retirement is malformed or identity-mismatched'
    );
  }
  return record;
}

function readExactLockArtifact(hubRoot, entryName, lockName, options = {}) {
  const parent = path.resolve(hubRoot);
  const resolved = path.resolve(parent, entryName);
  const artifact = classifyLockArtifactName(entryName, lockName);
  if (
    !artifact
    || normalizedN8nTargetPath(path.dirname(resolved)) !== normalizedN8nTargetPath(parent)
  ) {
    throw failClosedN8nRepair(
      'target-lock-artifact-invalid',
      'Target-lock artifact is outside its exact direct-child namespace'
    );
  }
  const parentStat = requireOrdinaryN8nDirectory(parent, 'target-lock artifact parent');
  const parentIdentity = n8nDirectoryIdentity(parentStat);
  const parentRealPath = normalizedN8nTargetPath(fs.realpathSync.native(parent));
  let initialStat;
  let initialRealPath;
  try {
    initialStat = fs.lstatSync(resolved, { bigint: true });
    initialRealPath = normalizedN8nTargetPath(fs.realpathSync.native(resolved));
  } catch (error) {
    const failure = failClosedN8nRepair(
      'target-lock-artifact-invalid',
      'Target-lock artifact is absent or its pathname identity is unprovable'
    );
    failure.cause = error;
    throw failure;
  }
  if (
    !initialStat.isFile()
    || initialStat.isSymbolicLink()
    || initialStat.nlink !== 1n
    || initialRealPath !== normalizedN8nTargetPath(resolved)
    || initialStat.size < 1n
    || initialStat.size > BigInt(LOCK_ARTIFACT_FILE_BYTE_LIMIT)
  ) {
    throw failClosedN8nRepair(
      'target-lock-artifact-invalid',
      'Target-lock artifact is redirected, aliased, special, empty, or oversized'
    );
  }
  const initialIdentity = n8nEvidenceStatIdentity(initialStat);
  const noFollow = Number.isInteger(fs.constants.O_NOFOLLOW) ? fs.constants.O_NOFOLLOW : 0;
  let descriptor;
  try {
    descriptor = fs.openSync(resolved, fs.constants.O_RDONLY | noFollow);
  } catch (error) {
    const failure = failClosedN8nRepair(
      'target-lock-artifact-invalid',
      'Target-lock artifact could not be opened without redirect ambiguity'
    );
    failure.cause = error;
    throw failure;
  }
  let bytes;
  let descriptorIdentity;
  try {
    const descriptorStat = fs.fstatSync(descriptor, { bigint: true });
    descriptorIdentity = n8nEvidenceStatIdentity(descriptorStat);
    if (
      !descriptorStat.isFile()
      || descriptorStat.nlink !== 1n
      || !n8nEvidenceStatIdentitiesMatch(initialIdentity, descriptorIdentity)
    ) {
      throw failClosedN8nRepair(
        'target-lock-artifact-invalid',
        'Target-lock artifact changed before descriptor inspection'
      );
    }
    bytes = Buffer.alloc(Number(descriptorStat.size));
    let offset = 0;
    while (offset < bytes.length) {
      const read = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (read === 0) break;
      offset += read;
    }
    if (
      offset !== bytes.length
      || !n8nEvidenceStatIdentitiesMatch(
        descriptorIdentity,
        n8nEvidenceStatIdentity(fs.fstatSync(descriptor, { bigint: true }))
      )
    ) {
      throw failClosedN8nRepair(
        'target-lock-artifact-invalid',
        'Target-lock artifact changed during bounded descriptor inspection'
      );
    }
  } finally {
    fs.closeSync(descriptor);
  }
  const finalStat = fs.lstatSync(resolved, { bigint: true });
  const finalParentStat = requireOrdinaryN8nDirectory(parent, 'target-lock artifact parent');
  if (
    !finalStat.isFile()
    || finalStat.isSymbolicLink()
    || finalStat.nlink !== 1n
    || normalizedN8nTargetPath(fs.realpathSync.native(resolved)) !== normalizedN8nTargetPath(resolved)
    || normalizedN8nTargetPath(fs.realpathSync.native(parent)) !== parentRealPath
    || !n8nEvidenceStatIdentitiesMatch(initialIdentity, n8nEvidenceStatIdentity(finalStat))
    || !n8nDirectoryIdentitiesMatch(parentIdentity, n8nDirectoryIdentity(finalParentStat))
  ) {
    throw failClosedN8nRepair(
      'target-lock-artifact-invalid',
      'Target-lock artifact or its exact parent changed during inspection'
    );
  }
  const semanticArtifact = artifact.source_artifact || artifact;
  const allowUnusableArtifact = options.allowUnusableOwner && (
    ['main-lock', 'displaced-lock'].includes(semanticArtifact.kind)
    || options.allowLegacyToken
  );
  let record;
  let unusableOwner = false;
  try {
    record = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    if (
      allowUnusableArtifact
    ) {
      record = {};
      unusableOwner = true;
    } else {
      const failure = failClosedN8nRepair(
        'target-lock-artifact-invalid',
        'Target-lock artifact JSON is malformed'
      );
      failure.cause = error;
      throw failure;
    }
  }
  if (!unusableOwner) {
    try {
      validateLockArtifactRecord(
        semanticArtifact,
        record,
        options.expectedSyncSource || ''
      );
    } catch (error) {
      if (
        allowUnusableArtifact
      ) {
        unusableOwner = true;
      } else {
        throw error;
      }
    }
  }
  return Object.freeze({
    artifact,
    bytes_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    filesystem_identity: Object.freeze(descriptorIdentity),
    normalized_path: normalizedN8nTargetPath(resolved),
    parent_directory_identity: Object.freeze(parentIdentity),
    parsed_semantic_sha256: crypto.createHash('sha256')
      .update(n8nCanonicalJson(record), 'utf8')
      .digest('hex'),
    record: Object.freeze({ ...record }),
    legacy_token_authority: Boolean(options.allowLegacyToken),
    unusable_owner: unusableOwner
  });
}

function exactLockArtifactAuthoritiesMatch(left, right) {
  return Boolean(left && right)
    && left.bytes_sha256 === right.bytes_sha256
    && left.normalized_path === right.normalized_path
    && left.parsed_semantic_sha256 === right.parsed_semantic_sha256
    && n8nEvidenceStatIdentitiesMatch(left.filesystem_identity, right.filesystem_identity)
    && n8nDirectoryIdentitiesMatch(
      left.parent_directory_identity,
      right.parent_directory_identity
    );
}

function exactMovedLockArtifactMatches(moved, source) {
  const stableMovedIdentity = (left, right) => Boolean(left && right)
    && ['dev', 'ino', 'mode', 'nlink', 'size', 'birthtime_ns', 'mtime_ns']
      .every((field) => String(left[field]) === String(right[field]));
  return Boolean(moved && source)
    && moved.bytes_sha256 === source.bytes_sha256
    && moved.parsed_semantic_sha256 === source.parsed_semantic_sha256
    && stableMovedIdentity(moved.filesystem_identity, source.filesystem_identity)
    && n8nDirectoryIdentitiesMatch(
      moved.parent_directory_identity,
      source.parent_directory_identity
    );
}

// Logically retire one exact lock-artifact generation through a unique,
// bounded quarantine name. The source is re-proved immediately before rename,
// the moved generation is re-opened twice around the test-only interruption
// seam, and the moved object is retained as the durable retirement record.
// No pathname deletion is attempted. A source replacement, source reappearance,
// moved-object replacement, or simultaneous source/quarantine is preserved and
// fails closed. Exact retained quarantine is inert and restart-adjudicable.
function retireExactLockArtifact(
  hubRoot,
  entryName,
  lockName,
  expected,
  options = {}
) {
  const sourceArtifact = expected?.artifact?.kind === 'retirement-quarantine'
    ? expected.artifact.source_artifact
    : expected?.artifact;
  const sourceName = expected?.artifact?.kind === 'retirement-quarantine'
    ? expected.artifact.source_name
    : entryName;
  const identity = expected?.bytes_sha256?.slice(0, 16);
  const quarantineName = expected?.artifact?.kind === 'retirement-quarantine'
    ? entryName
    : `${entryName}.quarantine-${identity}`;
  const sourcePath = path.join(hubRoot, sourceName);
  const quarantinePath = path.join(hubRoot, quarantineName);
  if (
    !sourceArtifact
    || !new RegExp(`^${LOCK_ARTIFACT_ID_PATTERN}$`).test(String(identity || ''))
    || Buffer.byteLength(quarantineName, 'utf8') > 240
    || classifyLockArtifactName(quarantineName, lockName)?.kind !== 'retirement-quarantine'
  ) {
    return {
      retired: false,
      message: `Toolkit bridge lock artifact at ${sourcePath} lacks bounded exact retirement authority`
    };
  }

  if (
    isStrictN8nTargetLockName(lockName)
    && expected.artifact.kind !== 'retirement-quarantine'
    && options.retentionCapacityLockHeld !== true
  ) {
    return withN8nRetainedQuarantineAdmission(
      hubRoot,
      options.testHooks || {},
      () => retireExactLockArtifact(
        hubRoot,
        entryName,
        lockName,
        expected,
        {
          ...options,
          retentionCapacityLockHeld: true
        }
      )
    );
  }

  if (expected.artifact.kind !== 'retirement-quarantine') {
    let current;
    try {
      current = readExactLockArtifact(hubRoot, sourceName, lockName, {
        allowLegacyToken: Boolean(expected.legacy_token_authority),
        allowUnusableOwner: Boolean(expected.unusable_owner)
      });
    } catch {
      return {
        retired: false,
        message: `Toolkit bridge lock artifact at ${sourcePath} changed before quarantine retirement`
      };
    }
    if (!exactLockArtifactAuthoritiesMatch(current, expected)) {
      return {
        retired: false,
        message: `Toolkit bridge lock artifact at ${sourcePath} changed before quarantine retirement`
      };
    }
    if (options.testHooks?.beforeLockArtifactRetirementMove) {
      options.testHooks.beforeLockArtifactRetirementMove({
        artifact_kind: sourceArtifact.kind,
        quarantine_path: quarantinePath,
        source_path: sourcePath
      });
    }
    try {
      current = readExactLockArtifact(hubRoot, sourceName, lockName, {
        allowLegacyToken: Boolean(expected.legacy_token_authority),
        allowUnusableOwner: Boolean(expected.unusable_owner)
      });
    } catch {
      return {
        retired: false,
        message: `Toolkit bridge lock artifact at ${sourcePath} changed at its quarantine boundary`
      };
    }
    if (!exactLockArtifactAuthoritiesMatch(current, expected)) {
      return {
        retired: false,
        message: `Toolkit bridge lock artifact at ${sourcePath} changed at its quarantine boundary`
      };
    }
    try {
      requireN8nRetainedQuarantineCapacity(hubRoot, {
        additionalBytes: Number(current.filesystem_identity.size),
        additionalObjects: 1,
        lockName,
        testHooks: options.testHooks
      });
    } catch (error) {
      return {
        retired: false,
        message: error.message
      };
    }
    if (n8nPathExists(quarantinePath)) {
      return {
        retired: false,
        message: `Toolkit bridge lock artifact retirement at ${quarantinePath} conflicts with retained residue`
      };
    }
    try {
      const renameOperation =
        options.testHooks?.lockArtifactRetirementRenameOperation
        || fs.renameSync;
      renameOperation(sourcePath, quarantinePath);
    } catch (error) {
      return {
        retired: false,
        message: `Toolkit bridge lock artifact at ${sourcePath} could not be quarantined safely (${error?.code || 'unknown I/O error'})`
      };
    }
  }

  if (options.testHooks?.afterLockArtifactRetirementMove) {
    options.testHooks.afterLockArtifactRetirementMove({
      artifact_kind: sourceArtifact.kind,
      quarantine_path: quarantinePath,
      source_path: sourcePath
    });
  }
  if (n8nPathExists(sourcePath)) {
    return {
      retired: false,
      message: `Toolkit bridge lock artifact source at ${sourcePath} reappeared after quarantine`
    };
  }
  let moved;
  try {
    moved = readExactLockArtifact(hubRoot, quarantineName, lockName, {
      allowLegacyToken: Boolean(expected.legacy_token_authority),
      allowUnusableOwner: Boolean(expected.unusable_owner)
    });
  } catch {
    return {
      retired: false,
      message: `Toolkit bridge lock artifact quarantine at ${quarantinePath} is no longer exact`
    };
  }
  if (
    moved.artifact.artifact_identity !== identity
    || !exactMovedLockArtifactMatches(moved, expected)
  ) {
    return {
      retired: false,
      message: `Toolkit bridge lock artifact quarantine at ${quarantinePath} changed before logical retirement`
    };
  }
  if (options.testHooks?.afterLockArtifactRetirementVerification) {
    options.testHooks.afterLockArtifactRetirementVerification({
      artifact_kind: sourceArtifact.kind,
      quarantine_path: quarantinePath,
      source_path: sourcePath
    });
  }
  let finalMoved;
  try {
    finalMoved = readExactLockArtifact(hubRoot, quarantineName, lockName, {
      allowLegacyToken: Boolean(expected.legacy_token_authority),
      allowUnusableOwner: Boolean(expected.unusable_owner)
    });
  } catch {
    return {
      retired: false,
      message: `Toolkit bridge lock artifact quarantine at ${quarantinePath} changed at its logical-retirement boundary`
    };
  }
  if (!exactMovedLockArtifactMatches(finalMoved, expected)) {
    return {
      retired: false,
      message: `Toolkit bridge lock artifact quarantine at ${quarantinePath} changed at its logical-retirement boundary`
    };
  }
  try {
    fsyncN8nDirectoryIfSupported(hubRoot, {
      label: 'lock-artifact logical-retirement parent',
      testHooks: options.testHooks
    });
  } catch (error) {
    return {
      retired: false,
      message: error.message
    };
  }
  if (n8nPathExists(sourcePath) || !n8nPathExists(quarantinePath)) {
    return {
      retired: false,
      message: `Toolkit bridge lock artifact retirement at ${quarantinePath} lost its exact retained authority`
    };
  }
  return {
    retired: true,
    retained: true,
    retained_bytes: Number(finalMoved.filesystem_identity.size),
    retained_objects: 1
  };
}

// Decide whether an existing lock must be respected. A live recorded owner
// is always respected regardless of age; a provably dead owner is
// recoverable immediately; an indeterminate owner fails closed; only
// unusable/unknown owner data falls back to the age rule (created_at, or
// file mtime when the lock is unreadable).
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
  if (owner === 'indeterminate') {
    return {
      respected: true,
      message: `Toolkit bridge lock at ${lockPath} records process ${lock.pid} whose liveness cannot be verified; failing closed`
    };
  }
  if (owner !== 'dead') {
    const age = lockAgeMs(lockPath, lock);
    if (Number.isFinite(age) && age < LOCK_STALE_MS) {
      return { respected: true, message: `fresh Toolkit bridge lock exists at ${lockPath}` };
    }
  }
  return { respected: false, message: '' };
}

// Exact cleanup of spent claim tombstones (marker reclaim and
// displaced-evidence retirement tombstones). A live or indeterminate owner
// remains a hard barrier. A proven-dead owner is retired immediately so a
// process stop cannot wedge the lock namespace; unusable owner state retains
// the generous age floor.
// Displaced-lock evidence files are deliberately never age-collected here:
// they are a persistent fail-closed acquisition barrier while their owner
// is alive or unverifiable, and are removed only through the identity-safe
// retirement protocol once the owner is provably dead.
const LOCK_ARTIFACT_GC_MS = 24 * 60 * 60 * 1000;
function lockNamePattern(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanupSpentLockArtifacts(
  hubRoot,
  lockName = 'update.lock',
  liveness = lockOwnerLiveness,
  testHooks = {}
) {
  let entries = [];
  try {
    entries = readBoundedN8nDirectChildNames(
      hubRoot,
      'Toolkit bridge lock-artifact inventory'
    );
  } catch (error) {
    return {
      blocked: true,
      message: `Toolkit bridge lock artifacts cannot be enumerated safely (${error?.code || 'unknown I/O error'})`
    };
  }
  try {
    inspectN8nRetainedQuarantineUsage(hubRoot, { lockName, testHooks });
  } catch (error) {
    return {
      blocked: true,
      message: error.message
    };
  }
  for (const entry of entries) {
    const artifact = classifyLockArtifactName(entry, lockName);
    if (
      !artifact
      || !['recovery-claim', 'displaced-retirement', 'retirement-quarantine']
        .includes(artifact.kind)
    ) continue;
    const fullPath = path.join(hubRoot, entry);
    let exact;
    try {
      exact = readExactLockArtifact(hubRoot, entry, lockName, {
        allowLegacyToken: !isStrictN8nTargetLockName(lockName),
        allowUnusableOwner: !isStrictN8nTargetLockName(lockName)
          || (
            artifact.kind === 'retirement-quarantine'
            && ['main-lock', 'displaced-lock'].includes(artifact.source_artifact?.kind)
          )
      });
    } catch {
      return {
        blocked: true,
        message: `Toolkit bridge lock artifact at ${fullPath} is malformed or identity-ambiguous; failing closed`
      };
    }
    if (artifact.kind === 'retirement-quarantine') {
      continue;
    }
    const owner = liveness(exact.record.pid);
    if (owner === 'alive') {
      return {
        blocked: true,
        message: `Toolkit bridge lock artifact at ${fullPath} belongs to live process ${exact.record.pid}`
      };
    }
    if (owner === 'indeterminate') {
      return {
        blocked: true,
        message: `Toolkit bridge lock artifact at ${fullPath} records process ${exact.record.pid} whose liveness cannot be verified; failing closed`
      };
    }
    let removable = owner === 'dead';
    if (!removable) {
      let age = Number.POSITIVE_INFINITY;
      try {
        age = Date.now() - fs.statSync(fullPath).mtimeMs;
      } catch {
        continue;
      }
      removable = age > LOCK_ARTIFACT_GC_MS;
    }
    if (!removable) {
      return {
        blocked: true,
        message: `Toolkit bridge lock artifact at ${fullPath} has no safely recoverable owner; failing closed`
      };
    }
    const retirement = retireExactLockArtifact(
      hubRoot,
      entry,
      lockName,
      exact,
      { testHooks }
    );
    if (!retirement.retired) {
      return {
        blocked: true,
        message: retirement.message
      };
    }
  }
  return { blocked: false };
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

function inspectDisplacedEvidence(hubRoot, liveness = lockOwnerLiveness, testHooks = {}, phase = 'inspection', lockName = 'update.lock') {
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
  entries.sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  for (const entry of entries) {
    const artifact = classifyLockArtifactName(entry, lockName);
    if (artifact?.kind !== 'displaced-lock') continue;
    const fullPath = path.join(hubRoot, entry);
    const inspection = inspectDisplacedEvidenceFile(fullPath, liveness, testHooks, phase);
    if (inspection.gone) continue;
    if (inspection.blocked) return { blocked: true, retirable, message: inspection.message };
    let exact;
    try {
      exact = readExactLockArtifact(hubRoot, entry, lockName, {
        allowLegacyToken: !isStrictN8nTargetLockName(lockName),
        allowUnusableOwner: true
      });
    } catch {
      return {
        blocked: true,
        retirable,
        message: `Toolkit bridge displaced lock evidence at ${fullPath} is identity-ambiguous; failing closed`
      };
    }
    if (
      crypto.createHash('sha256').update(inspection.raw, 'utf8').digest('hex')
      !== exact.bytes_sha256
    ) {
      return {
        blocked: true,
        retirable,
        message: `Toolkit bridge displaced lock evidence at ${fullPath} changed during exact inspection`
      };
    }
    retirable.push({ entry, exact, fullPath, hubRoot, lockName, raw: inspection.raw });
  }
  return { blocked: false, retirable };
}

// Retire dead-owner displaced evidence with the same atomic identity-safe
// discipline as marker reclaim: exclusively create a tombstone named after
// the hash of the exact inspected bytes (one winner per generation), then
// re-read and remove the evidence only when it is still that generation. A
// changed generation is left untouched and this contender yields.
function retireDisplacedEvidence(retirable, testHooks = {}) {
  for (const { entry, exact, fullPath, hubRoot, lockName, raw } of retirable) {
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
    if (testHooks.afterDisplacedRetirementTombstoneCreated) {
      testHooks.afterDisplacedRetirementTombstoneCreated({
        evidence_path: fullPath,
        tombstone_path: tombstonePath
      });
    }
    if (testHooks.readDisplacedEvidence) {
      let boundaryRaw;
      try {
        boundaryRaw = testHooks.readDisplacedEvidence(
          fullPath,
          'retirement-verification'
        );
      } catch (error) {
        if (error?.code === 'ENOENT') continue;
        return {
          retired: false,
          message: `Toolkit bridge displaced lock evidence at ${fullPath} became unreadable during retirement verification (${error?.code || 'unknown I/O error'}); failing closed without removing it`
        };
      }
      if (boundaryRaw !== raw) {
        return {
          retired: false,
          message: `Toolkit bridge displaced lock evidence at ${fullPath} changed during retirement verification`
        };
      }
    }
    const retirement = retireExactLockArtifact(
      hubRoot,
      entry,
      lockName,
      exact,
      { testHooks }
    );
    if (!retirement.retired) return retirement;
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
  if (owner === 'indeterminate') {
    return {
      present: true,
      active: true,
      raw,
      marker,
      message: `Toolkit bridge lock recovery at ${markerPath} records process ${marker.pid} whose liveness cannot be verified; failing closed`
    };
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
// retained while its owner is live or indeterminate, so a loser acting on
// stale knowledge cannot reclaim that generation. A later contender may
// retire it only after exact file/record revalidation proves the owner dead.
// The winner then re-reads the marker under its tombstone and proceeds only
// when the bytes are still the inspected generation.
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
  const hubRoot = path.dirname(markerPath);
  const markerName = path.basename(markerPath);
  const lockName = markerName.slice(0, -LOCK_RECOVERY_MARKER_SUFFIX.length);
  let exactMarker;
  try {
    exactMarker = readExactLockArtifact(hubRoot, markerName, lockName, {
      allowLegacyToken: !isStrictN8nTargetLockName(lockName),
      allowUnusableOwner: !isStrictN8nTargetLockName(lockName)
    });
  } catch {
    return {
      claimed: false,
      message: `Toolkit bridge lock recovery marker at ${markerPath} is identity-ambiguous; failing closed`
    };
  }
  if (
    crypto.createHash('sha256').update(inspection.raw, 'utf8').digest('hex')
    !== exactMarker.bytes_sha256
  ) {
    return {
      claimed: false,
      message: `Toolkit bridge lock recovery marker at ${markerPath} changed during exact inspection`
    };
  }
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
  if (testHooks.afterMarkerClaimTombstoneCreated) {
    testHooks.afterMarkerClaimTombstoneCreated({
      marker_path: markerPath,
      tombstone_path: tombstonePath
    });
  }

  const retirement = retireExactLockArtifact(
    hubRoot,
    markerName,
    lockName,
    exactMarker,
    { testHooks }
  );
  if (!retirement.retired) {
    return { claimed: false, message: retirement.message };
  }

  if (tryCreateMarker()) return { claimed: true };
  return { claimed: false, message: `Toolkit bridge lock recovery marker at ${markerPath} was re-created by another process` };
}

function releaseRecoveryMarker(markerPath, token, testHooks = {}) {
  const hubRoot = path.dirname(markerPath);
  const markerName = path.basename(markerPath);
  const lockName = markerName.slice(0, -LOCK_RECOVERY_MARKER_SUFFIX.length);
  let exact;
  try {
    exact = readExactLockArtifact(hubRoot, markerName, lockName, {
      allowLegacyToken: !isStrictN8nTargetLockName(lockName),
      allowUnusableOwner: !isStrictN8nTargetLockName(lockName)
    });
  } catch {
    return {
      retired: false,
      message: `Toolkit bridge recovery marker at ${markerPath} is absent or identity-ambiguous`
    };
  }
  if (exact.record.token !== token) {
    return {
      retired: false,
      message: `Toolkit bridge recovery marker at ${markerPath} changed ownership before release`
    };
  }
  return retireExactLockArtifact(
    hubRoot,
    markerName,
    lockName,
    exact,
    { testHooks }
  );
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
  const lockName = args.lockName || 'update.lock';
  if (!/^[A-Za-z0-9._-]+$/.test(lockName) || lockName === '.' || lockName === '..') {
    throw new Error('Toolkit bridge lock name must be a simple filename');
  }
  const lockPath = path.join(hubRoot, lockName);
  const markerPath = `${lockPath}${LOCK_RECOVERY_MARKER_SUFFIX}`;
  const liveness = testHooks.liveness || lockOwnerLiveness;
  const token = crypto.randomUUID();
  const skipOrThrow = (message) => {
    if (args.hook) return { acquired: false, lockPath, skipReason: message };
    throw new Error(message);
  };
  const spentArtifacts = cleanupSpentLockArtifacts(hubRoot, lockName, liveness, testHooks);
  if (spentArtifacts.blocked) return skipOrThrow(spentArtifacts.message);
  let acquiredHandle = null;
  try {
    requireN8nRetainedQuarantineCapacity(hubRoot, {
      additionalBytes: 8 * LOCK_ARTIFACT_FILE_BYTE_LIMIT,
      additionalObjects: 8,
      lockName,
      testHooks
    });
  } catch (error) {
    return skipOrThrow(error.message);
  }

  const tryExclusiveCreate = () => {
    const lockRecord = {
      created_at: timestamp(),
      pid: process.pid,
      token,
      bridge_version: BRIDGE_VERSION,
      sync_source: args.syncSource
    };
    const lockBody = `${JSON.stringify(lockRecord, null, 2)}\n`;
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
  const initialEvidence = inspectDisplacedEvidence(hubRoot, liveness, testHooks, 'initial', lockName);
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
    const evidence = inspectDisplacedEvidence(hubRoot, liveness, testHooks, 'under-marker', lockName);
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
        if (!displacedInspection.gone) {
          const displacedName = path.basename(displacedPath);
          let exactDisplaced;
          try {
            exactDisplaced = readExactLockArtifact(hubRoot, displacedName, lockName, {
              allowLegacyToken: !isStrictN8nTargetLockName(lockName),
              allowUnusableOwner: true
            });
          } catch {
            return skipOrThrow(`Toolkit bridge displaced lock evidence at ${displacedPath} became identity-ambiguous; not acquiring`);
          }
          if (
            crypto.createHash('sha256')
              .update(displacedInspection.raw, 'utf8')
              .digest('hex') !== exactDisplaced.bytes_sha256
          ) {
            return skipOrThrow(`Toolkit bridge displaced lock evidence at ${displacedPath} changed during exact inspection; not acquiring`);
          }
          const retirement = retireExactLockArtifact(
            hubRoot,
            displacedName,
            lockName,
            exactDisplaced,
            { testHooks }
          );
          if (!retirement.retired) return skipOrThrow(retirement.message);
        }
      }
    }
    if (tryExclusiveCreate()) {
      acquiredHandle = { acquired: true, lockPath, token };
      return acquiredHandle;
    }
    return skipOrThrow(`Toolkit bridge lock at ${lockPath} was created by another process`);
  } finally {
    const markerRetirement = releaseRecoveryMarker(markerPath, token, testHooks);
    if (!markerRetirement.retired) {
      if (acquiredHandle) releaseLock(acquiredHandle, testHooks);
      throw new Error(
        `${markerRetirement.message}; lock acquisition failed closed before authority was returned`
      );
    }
  }
}

// Release only the exact lock this run created: the current lock file must
// still carry this run's ownership token. A lock replaced by another
// process is never deleted, even by the process that previously owned that
// path. The token check is stable because no other process may recover a
// lock whose recorded owner is alive, and this process is alive while
// releasing.
function releaseLock(lock, testHooks = {}) {
  if (!lock?.acquired || !lock.lockPath) {
    return { retired: false, message: 'No acquired lock authority was supplied' };
  }
  const hubRoot = path.dirname(lock.lockPath);
  const lockName = path.basename(lock.lockPath);
  let exact;
  try {
    exact = readExactLockArtifact(hubRoot, lockName, lockName, {
      allowLegacyToken: !isStrictN8nTargetLockName(lockName),
      allowUnusableOwner: !isStrictN8nTargetLockName(lockName)
    });
  } catch {
    return {
      retired: false,
      message: `Toolkit bridge lock at ${lock.lockPath} is absent or identity-ambiguous`
    };
  }
  if (exact.record.token !== lock.token) {
    return {
      retired: false,
      message: `Toolkit bridge lock at ${lock.lockPath} changed ownership before release`
    };
  }
  return retireExactLockArtifact(
    hubRoot,
    lockName,
    lockName,
    exact,
    { testHooks }
  );
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
  const renameOperation = options.renameOperation || fs.renameSync;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      if (options.beforeEachAttempt) {
        options.beforeEachAttempt({ attempt, sourcePath, targetPath });
      }
      renameOperation(sourcePath, targetPath);
      return;
    } catch (error) {
      lastError = error;
      if (!isTransientRenameError(error) || attempt === attempts) break;
      if (options.afterTransientFailure) {
        options.afterTransientFailure({ attempt, code: error.code });
      }
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
  let backupCreated = false;
  let targetInstalled = false;
  if (fs.existsSync(targetDir)) {
    renameSyncWithRetry(targetDir, backup, options);
    backupCreated = true;
  }
  try {
    try {
      renameSyncWithRetry(sourceDir, targetDir, options);
      targetInstalled = true;
    } catch (error) {
      if (!isTransientRenameError(error) || !fs.existsSync(sourceDir) || fs.existsSync(targetDir)) throw error;
      try {
        fs.cpSync(sourceDir, targetDir, { recursive: true, force: false, errorOnExist: true });
        targetInstalled = true;
        fs.rmSync(sourceDir, { recursive: true, force: true });
      } catch (copyError) {
        if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true });
        targetInstalled = false;
        const fallbackError = new Error(
          `Failed to replace ${targetDir}: rename failed with ${error.code || error.message}; copy fallback failed with ${copyError.code || copyError.message}`
        );
        fallbackError.code = copyError.code || error.code;
        fallbackError.cause = copyError;
        throw fallbackError;
      }
    }
    if (options.verifyTarget) options.verifyTarget(targetDir);
    if (backupCreated && fs.existsSync(backup)) fs.rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    try {
      if (targetInstalled && fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true });
      if (backupCreated && fs.existsSync(backup)) renameSyncWithRetry(backup, targetDir, options);
    } catch (rollbackError) {
      error.message = `${error.message}; rollback failed: ${rollbackError.message}`;
      error.rollbackError = rollbackError;
    }
    throw error;
  }
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

function n8nInventoryEntryIdentity(stat) {
  return {
    dev: String(stat.dev),
    ino: String(stat.ino),
    mode: String(stat.mode),
    nlink: String(stat.nlink),
    size: String(stat.size),
    birthtime_ms: String(stat.birthtimeMs),
    mtime_ms: String(stat.mtimeMs),
    ctime_ms: String(stat.ctimeMs)
  };
}

function n8nInventoryEntryIdentitiesMatch(left, right) {
  return Boolean(left && right)
    && Object.keys(left).every((key) => String(left[key]) === String(right[key]));
}

function n8nInventoryTransactions(options = {}) {
  return [
    ...(options.transactions || []),
    ...(options.transaction ? [options.transaction] : [])
  ].filter(Boolean);
}

function n8nInventoryOwnedEvidenceEntries(transactions) {
  const result = new Map();
  for (const transaction of transactions) {
    for (const entry of transaction?.evidenceAuthority?.entries || []) {
      if (result.has(entry.normalized_path)) {
        throw failClosedN8nRepair('ambiguous-target', 'Two transaction authorities claim the same n8n Skills evidence path');
      }
      result.set(entry.normalized_path, entry);
    }
  }
  return result;
}

function n8nInventoryOwnedDirectory(transactions, entryPath) {
  const normalized = normalizedN8nTargetPath(entryPath);
  for (const transaction of transactions) {
    const generation = transaction.generation;
    const preTransaction = transaction.preTransaction?.preTransaction || transaction.preTransaction;
    if (
      normalized === normalizedN8nTargetPath(generation.stagePath)
      && preTransaction?.creating_process?.lease_token === generation.record.ownership_token
      && preTransaction?.created_at === generation.record.created_at
    ) {
      return {
        kind: transaction[N8N_JOURNAL_CONTEXT]?.status === 'logically-retired'
          ? 'retired-stage'
          : 'owned-stage',
        generation_id: generation.record.generation_id,
        identity: preTransaction.stage_directory_identity,
        ownership_token: generation.record.ownership_token
      };
    }
    if (
      transaction.transaction
      && normalized === normalizedN8nTargetPath(transaction.validated.backupPath)
      && transaction.transaction.creating_process?.lease_token === generation.record.ownership_token
      && transaction.transaction.created_at === generation.record.created_at
    ) {
      return {
        kind: transaction[N8N_JOURNAL_CONTEXT]?.status === 'logically-retired'
          ? 'retired-backup'
          : 'owned-backup',
        generation_id: generation.record.generation_id,
        identity: transaction.transaction.original_target_directory_identity,
        ownership_token: generation.record.ownership_token
      };
    }
  }
  return null;
}

function n8nInventoryIsLockArtifact(entry) {
  return Boolean(entry?.lock_artifact_class)
    || ['owned-lock', 'target-lock-artifact', 'target-lock-evidence'].includes(entry?.kind);
}

function n8nInventoryIsLogicalRetirement(entry) {
  return entry?.kind === 'retained-logical-retirement'
    || entry?.lock_artifact_class === 'retirement-quarantine';
}

function n8nInventoryTargetLockNamespaces(parent, options, fallbackRoots) {
  const targetPaths = new Set();
  for (const targetPath of options.targetPaths || []) {
    if (targetPath) targetPaths.add(path.resolve(targetPath));
  }
  for (const transaction of n8nInventoryTransactions(options)) {
    if (transaction?.validated?.targetPath) {
      targetPaths.add(path.resolve(transaction.validated.targetPath));
    }
  }
  for (const fallbackRoot of fallbackRoots) {
    targetPaths.add(path.resolve(fallbackRoot));
  }
  const namespaces = new Map();
  for (const targetPath of targetPaths) {
    if (
      normalizedN8nTargetPath(path.dirname(targetPath))
      !== normalizedN8nTargetPath(parent)
    ) {
      throw failClosedN8nRepair(
        'ambiguous-target',
        'Target-lock inventory authority names a target outside the exact package parent'
      );
    }
    const identity = n8nSkillsTargetLockIdentity(targetPath);
    const existing = namespaces.get(identity.lockName);
    if (
      existing
      && normalizedN8nTargetPath(existing.target_path)
        !== normalizedN8nTargetPath(targetPath)
    ) {
      throw failClosedN8nRepair(
        'ambiguous-target',
        'Two target paths collide in one target-lock namespace'
      );
    }
    namespaces.set(identity.lockName, Object.freeze({
      lock_name: identity.lockName,
      target_identity: n8nReplacementTargetIdentity(targetPath),
      target_path: normalizedN8nTargetPath(targetPath)
    }));
  }
  return namespaces;
}

function n8nInventoryLockArtifactsByName(names, namespaces) {
  const result = new Map();
  for (const name of names) {
    for (const namespace of namespaces.values()) {
      const artifact = classifyLockArtifactName(name, namespace.lock_name);
      if (!artifact) continue;
      if (result.has(name)) {
        throw failClosedN8nRepair(
          'ambiguous-target',
          'One cache entry matches more than one target-lock namespace'
        );
      }
      result.set(name, Object.freeze({ artifact, namespace }));
    }
  }
  return result;
}

function inspectN8nRetiredBackupInventoryEntry(parent, name, namespaces) {
  const parts = n8nRetiredBackupNameParts(name);
  if (!parts) return null;
  const backupMatch = parts.backup_name.match(
    /^\.(.+)\.n8n-repair-backup-([0-9a-f-]{36})$/i
  );
  if (!backupMatch || backupMatch[2].toLowerCase() !== parts.generation_id) {
    throw failClosedN8nRepair(
      'ambiguous-target',
      'Retained n8n Skills backup name has conflicting generation authority'
    );
  }
  const targetPath = path.resolve(parent, backupMatch[1]);
  const namespace = namespaces.get(
    n8nSkillsTargetLockIdentity(targetPath).lockName
  );
  if (
    !namespace
    || normalizedN8nTargetPath(namespace.target_path)
      !== normalizedN8nTargetPath(targetPath)
  ) {
    throw failClosedN8nRepair(
      'ambiguous-target',
      'Retained n8n Skills backup belongs to a foreign target namespace'
    );
  }
  const retirementPath = path.resolve(parent, name);
  const backupPath = path.resolve(parent, parts.backup_name);
  const manifest = inspectN8nBackupCleanupTree(retirementPath, {
    authorityRootPath: backupPath
  });
  if (manifest.digest !== parts.manifest_digest) {
    throw failClosedN8nRepair(
      'ambiguous-target',
      'Retained n8n Skills backup tree does not match its exact name authority'
    );
  }
  return Object.freeze({
    bytes: manifest.counts.total_bytes,
    directory_identity: manifest.root_directory_identity,
    generation_id: parts.generation_id,
    manifest_digest: manifest.digest,
    normalized_path: normalizedN8nTargetPath(retirementPath),
    ownership_token: parts.ownership_token,
    target_identity: namespace.target_identity
  });
}

function n8nLockArtifactAuthority(entries) {
  const lockEntries = entries
    .filter(n8nInventoryIsLockArtifact)
    .map((entry) => ({
      artifact_class: entry.lock_artifact_class,
      artifact_identity: entry.lock_artifact_identity || '',
      artifact_token: entry.lock_artifact_token || '',
      bytes_sha256: entry.bytes_sha256,
      filesystem_identity: entry.identity,
      normalized_path: entry.normalized_path,
      parsed_semantic_sha256: entry.parsed_semantic_sha256,
      target_identity: entry.lock_target_identity
    }))
    .sort((left, right) => Buffer.compare(
      Buffer.from(left.normalized_path),
      Buffer.from(right.normalized_path)
    ));
  return Object.freeze({
    digest: crypto.createHash('sha256')
      .update(n8nCanonicalJson(lockEntries), 'utf8')
      .digest('hex'),
    entries: Object.freeze(lockEntries.map((entry) => Object.freeze(entry)))
  });
}

function n8nInventoryDigest(parentIdentity, entries, excludedOrdinaryRoots = []) {
  const excluded = new Set(excludedOrdinaryRoots.map((value) => normalizedN8nTargetPath(value)));
  const canonical = entries
    .filter((entry) => !n8nInventoryIsLockArtifact(entry))
    .filter((entry) => !n8nInventoryIsLogicalRetirement(entry))
    .filter((entry) => !(entry.kind === 'ordinary-directory' && excluded.has(entry.normalized_path)))
    .map((entry) => ({
      bytes_sha256: entry.bytes_sha256 || '',
      evidence_kind: entry.evidence_kind || '',
      expected_absence: Boolean(entry.expected_absence),
      generation_id: entry.generation_id || '',
      identity: entry.identity,
      kind: entry.kind,
      name: entry.name,
      normalized_path: entry.normalized_path,
      ownership_token: entry.ownership_token || '',
      parsed_semantic_sha256: entry.parsed_semantic_sha256 || ''
    }))
    .sort((left, right) => Buffer.compare(
      Buffer.from(`${left.normalized_path}\0${left.kind}`),
      Buffer.from(`${right.normalized_path}\0${right.kind}`)
    ));
  return crypto.createHash('sha256').update(n8nCanonicalJson({
    parent_identity: parentIdentity,
    entries: canonical
  }), 'utf8').digest('hex');
}

function discoverN8nSkillsCacheRoots(codexHome, options = {}) {
  const parent = path.resolve(codexHome, 'plugins', 'cache', 'n8n-io', 'n8n-skills');
  const roots = [];
  if (!n8nPathExists(parent)) {
    return {
      roots,
      skipped: [],
      entries: [],
      lock_artifact_authority: n8nLockArtifactAuthority([]),
      parent,
      parent_directory_identity: null,
      inventory_digest: n8nInventoryDigest(null, [])
    };
  }
  const parentStat = requireOrdinaryN8nDirectory(parent, 'n8n Skills package cache parent');
  const parentIdentity = n8nDirectoryIdentity(parentStat);
  const parentObservationIdentity = n8nInventoryEntryIdentity(parentStat);
  const parentRealPath = normalizedN8nTargetPath(fs.realpathSync.native(parent));
  const inventoryTransactions = n8nInventoryTransactions(options);
  for (const transaction of inventoryTransactions) {
    revalidateN8nEvidenceAuthority(transaction.evidenceAuthority, {
      boundary: 'canonical-cache-inventory',
      testHooks: options.testHooks
    });
    if (transaction[N8N_JOURNAL_CONTEXT]) {
      revalidateN8nJournalAuthority(transaction, 'canonical-cache-inventory', options.testHooks);
      if (transaction[N8N_JOURNAL_CONTEXT].status === 'logically-retired') {
        revalidateLogicalRetirement(transaction[N8N_JOURNAL_CONTEXT]);
      }
    }
  }
  const ownedEvidence = n8nInventoryOwnedEvidenceEntries(inventoryTransactions);
  const entries = [];
  const names = [];
  const directory = fs.opendirSync(parent);
  let entryCount = 0;
  try {
    for (;;) {
      const entry = directory.readSync();
      if (!entry) break;
      entryCount += 1;
      if (entryCount > N8N_REPLACEMENT_DIRECTORY_ENTRY_LIMIT) {
        throw failClosedN8nRepair('ambiguous-target', 'The n8n Skills package cache parent exceeds the bounded cache inventory');
      }
      names.push(entry.name);
    }
  } finally {
    directory.closeSync();
  }
  names.sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  const fallbackRoots = [];
  for (const name of names) {
    const candidatePath = path.resolve(parent, name);
    let candidateStat;
    try {
      candidateStat = fs.lstatSync(candidatePath);
    } catch {
      throw failClosedN8nRepair(
        'ambiguous-target',
        'An n8n Skills cache entry disappeared during target-lock namespace discovery'
      );
    }
    if (
      candidateStat.isDirectory()
      && !candidateStat.isSymbolicLink()
      && !name.startsWith('.')
      && normalizedN8nTargetPath(fs.realpathSync.native(candidatePath))
        === normalizedN8nTargetPath(candidatePath)
    ) {
      fallbackRoots.push(candidatePath);
    }
  }
  const targetLockNamespaces = n8nInventoryTargetLockNamespaces(
    parent,
    options,
    fallbackRoots
  );
  const targetLockArtifacts = n8nInventoryLockArtifactsByName(
    names,
    targetLockNamespaces
  );
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index];
    const entryPath = path.resolve(parent, name);
    const normalizedEntryPath = normalizedN8nTargetPath(entryPath);
    if (
      name.includes('.n8n-repair-backup-')
      && name.includes('.retired-')
      && !n8nRetiredBackupNameParts(name)
    ) {
      throw failClosedN8nRepair(
        'ambiguous-target',
        'The n8n Skills cache contains malformed retained logical-retirement authority'
      );
    }
    if (normalizedN8nTargetPath(path.dirname(entryPath)) !== normalizedN8nTargetPath(parent)) {
      throw failClosedN8nRepair('ambiguous-target', 'The n8n Skills cache inventory contains an entry outside the exact package parent');
    }
    let stat;
    try {
      stat = fs.lstatSync(entryPath);
    } catch {
      throw failClosedN8nRepair('ambiguous-target', 'An n8n Skills cache entry disappeared or could not be classified during inventory');
    }
    const identity = n8nInventoryEntryIdentity(stat);
    const targetLockArtifact = targetLockArtifacts.get(name) || null;
    const retainedBackup = n8nRetiredBackupNameParts(name)
      ? inspectN8nRetiredBackupInventoryEntry(
        parent,
        name,
        targetLockNamespaces
      )
      : null;
    if (targetLockArtifact && !stat.isFile()) {
      throw failClosedN8nRepair(
        'ambiguous-target',
        'An exact target-lock artifact name is not an ordinary file'
      );
    }
    if (options.testHooks?.afterN8nCacheInventoryEntryLstat) {
      options.testHooks.afterN8nCacheInventoryEntryLstat({
        entry_index: index,
        entry_name: name,
        entry_path: entryPath
      });
    }
    let kind = '';
    let fileEvidence = null;
    if (stat.isSymbolicLink()) {
      kind = 'redirect';
    } else if (stat.isDirectory()) {
      let realPath;
      try {
        realPath = normalizedN8nTargetPath(fs.realpathSync.native(entryPath));
      } catch {
        throw failClosedN8nRepair('ambiguous-target', 'An n8n Skills cache directory could not be proven during inventory');
      }
      if (realPath !== normalizedEntryPath) {
        kind = 'redirect';
      } else if (retainedBackup) {
        if (!n8nDirectoryIdentitiesMatch(
          retainedBackup.directory_identity,
          n8nDirectoryIdentity(stat)
        )) {
          throw failClosedN8nRepair(
            'ambiguous-target',
            'Retained n8n Skills backup directory identity changed during inventory'
          );
        }
        kind = 'retained-logical-retirement';
      } else {
        const ownedDirectory = n8nInventoryOwnedDirectory(inventoryTransactions, entryPath);
        if (ownedDirectory) {
          if (!n8nDirectoryIdentitiesMatch(ownedDirectory.identity, n8nDirectoryIdentity(stat))) {
            throw failClosedN8nRepair('ambiguous-target', 'Exact owned n8n Skills transaction directory identity changed during inventory');
          }
          kind = ownedDirectory.kind;
        } else {
          kind = 'ordinary-directory';
        }
      }
    } else if (stat.isFile()) {
      const ownedEvidenceEntry = ownedEvidence.get(normalizedEntryPath);
      if (ownedEvidenceEntry?.present) {
        const currentEvidence = n8nReadEvidenceDescriptor(entryPath, {
          generationId: ownedEvidenceEntry.generation_id,
          kind: ownedEvidenceEntry.evidence_kind,
          owner: ownedEvidenceEntry.owner,
          ownershipToken: ownedEvidenceEntry.ownership_token,
          parent,
          required: ownedEvidenceEntry.required,
          mustExist: true,
          schemaVersion: ownedEvidenceEntry.schema_version,
          state: ownedEvidenceEntry.state
        });
        if (
          JSON.stringify(n8nEvidenceEntryComparable(currentEvidence))
          !== JSON.stringify(n8nEvidenceEntryComparable(ownedEvidenceEntry))
        ) {
          throw failClosedN8nRepair('ambiguous-target', 'Exact owned n8n Skills evidence changed during cache inventory');
        }
        kind = 'owned-evidence';
      } else if (targetLockArtifact) {
        let exactArtifact;
        try {
          exactArtifact = readExactLockArtifact(parent, name, targetLockArtifact.namespace.lock_name, {
            allowUnusableOwner:
              targetLockArtifact.artifact.kind === 'retirement-quarantine'
              && ['main-lock', 'displaced-lock'].includes(
                targetLockArtifact.artifact.source_artifact?.kind
              ),
            expectedSyncSource: ['main-lock', 'displaced-lock'].includes(
              targetLockArtifact.artifact.kind
            )
              ? 'codex-plugin'
              : ''
          });
        } catch {
          throw failClosedN8nRepair(
            'ambiguous-target',
            'Exact n8n Skills target-lock artifact authority could not be proven during inventory'
          );
        }
        fileEvidence = {
          bytes_sha256: exactArtifact.bytes_sha256,
          evidence_kind: `target-lock-${exactArtifact.artifact.kind}`,
          parsed_semantic_sha256: exactArtifact.parsed_semantic_sha256
        };
        const activeAuthority = options.activeLock?.[N8N_TARGET_LOCK_AUTHORITY];
        const isActiveMainLock = Boolean(
          options.activeLock?.acquired
          && exactArtifact.artifact.kind === 'main-lock'
          && normalizedEntryPath === normalizedN8nTargetPath(options.activeLock.lockPath)
        );
        if (isActiveMainLock) {
          if (
            exactArtifact.record.token !== options.activeLock.token
            || exactArtifact.record.pid !== process.pid
            || !activeAuthority
            || exactArtifact.bytes_sha256 !== activeAuthority.bytes_sha256
            || !n8nEvidenceStatIdentitiesMatch(
              exactArtifact.filesystem_identity,
              activeAuthority.filesystem_identity
            )
          ) {
            throw failClosedN8nRepair(
              'ambiguous-target',
              'The exact active n8n Skills target-lock authority changed during inventory'
            );
          }
          kind = 'owned-lock';
        } else if (
          options.transaction
          && exactArtifact.artifact.kind === 'main-lock'
          && normalizedEntryPath === normalizedN8nTargetPath(path.join(
            path.dirname(options.transaction.validated.targetPath),
            n8nSkillsTargetLockIdentity(options.transaction.validated.targetPath).lockName
          ))
        ) {
          kind = 'target-lock-evidence';
        } else {
          kind = 'target-lock-artifact';
        }
      } else if (options.allowUnclassifiedRegularFiles) {
        kind = 'unclassified-file';
      } else {
        kind = 'regular-file';
      }
    } else {
      kind = 'special-entry';
    }
    let afterStat;
    try {
      afterStat = fs.lstatSync(entryPath);
    } catch {
      throw failClosedN8nRepair('ambiguous-target', 'An n8n Skills cache entry disappeared during inventory');
    }
    if (!n8nInventoryEntryIdentitiesMatch(identity, n8nInventoryEntryIdentity(afterStat))) {
      throw failClosedN8nRepair('ambiguous-target', 'An n8n Skills cache entry changed identity during inventory');
    }
    const inventoryEntry = {
      identity,
      kind,
      name,
      normalized_path: normalizedEntryPath,
      plugin_root: entryPath
    };
    const exactEvidence = ownedEvidence.get(normalizedEntryPath);
    if (kind === 'owned-evidence' && exactEvidence) {
      Object.assign(inventoryEntry, {
        bytes_sha256: exactEvidence.bytes_sha256,
        evidence_kind: exactEvidence.evidence_kind,
        generation_id: exactEvidence.generation_id,
        ownership_token: exactEvidence.ownership_token,
        parsed_semantic_sha256: exactEvidence.parsed_semantic_sha256
      });
    }
    if (fileEvidence) {
      Object.assign(inventoryEntry, {
        bytes_sha256: fileEvidence.bytes_sha256,
        evidence_kind: fileEvidence.evidence_kind,
        parsed_semantic_sha256: fileEvidence.parsed_semantic_sha256
      });
    }
    if (targetLockArtifact) {
      Object.assign(inventoryEntry, {
        lock_artifact_class: targetLockArtifact.artifact.kind,
        lock_artifact_identity: targetLockArtifact.artifact.artifact_identity || '',
        lock_artifact_token: targetLockArtifact.artifact.displacement_token || '',
        lock_target_identity: targetLockArtifact.namespace.target_identity
      });
    }
    if (retainedBackup) {
      Object.assign(inventoryEntry, {
        generation_id: retainedBackup.generation_id,
        ownership_token: retainedBackup.ownership_token,
        retirement_bytes: retainedBackup.bytes,
        retirement_manifest_digest: retainedBackup.manifest_digest,
        retirement_target_identity: retainedBackup.target_identity
      });
    }
    const ownedDirectory = ['owned-stage', 'owned-backup', 'retired-stage', 'retired-backup'].includes(kind)
      ? n8nInventoryOwnedDirectory(inventoryTransactions, entryPath)
      : null;
    if (ownedDirectory) {
      Object.assign(inventoryEntry, {
        generation_id: ownedDirectory.generation_id,
        ownership_token: ownedDirectory.ownership_token
      });
    }
    entries.push(inventoryEntry);
    if (kind === 'ordinary-directory') {
      roots.push({
        plugin_id: 'n8n-skills@n8n-io',
        version: name,
        plugin_root: entryPath,
        cache_directory_identity: n8nDirectoryIdentity(stat)
      });
    } else if (![
      'owned-stage',
      'owned-backup',
      'retired-stage',
      'retired-backup',
      'owned-evidence',
      'owned-lock',
      'target-lock-artifact',
      'target-lock-evidence',
      'retained-logical-retirement',
      'unclassified-file'
    ].includes(kind)) {
      throw failClosedN8nRepair(
        'ambiguous-target',
        'The n8n Skills package cache contains a non-owned redirected, file, special, or unprovable entry'
      );
    }
  }
  for (const evidence of ownedEvidence.values()) {
    if (
      evidence.present
      && evidence.parent_identity.normalized_path === normalizedN8nTargetPath(parent)
    ) {
      continue;
    }
    entries.push({
      bytes_sha256: evidence.bytes_sha256,
      evidence_kind: evidence.evidence_kind,
      expected_absence: evidence.expected_absence,
      generation_id: evidence.generation_id,
      identity: evidence.filesystem_identity || null,
      kind: evidence.present ? 'owned-nested-evidence' : 'absent-owned-evidence',
      name: path.basename(evidence.normalized_path),
      normalized_path: evidence.normalized_path,
      ownership_token: evidence.ownership_token,
      parsed_semantic_sha256: evidence.parsed_semantic_sha256,
      plugin_root: evidence.normalized_path
    });
  }
  if (options.testHooks?.beforeN8nCacheInventoryFinalRecheck) {
    options.testHooks.beforeN8nCacheInventoryFinalRecheck({ parent });
  }
  let finalNames;
  try {
    finalNames = fs.readdirSync(parent)
      .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  } catch {
    throw failClosedN8nRepair('ambiguous-target', 'The n8n Skills package cache parent changed during inventory');
  }
  const finalParentStat = requireOrdinaryN8nDirectory(parent, 'n8n Skills package cache parent');
  if (
    normalizedN8nTargetPath(fs.realpathSync.native(parent)) !== parentRealPath
    || !n8nInventoryEntryIdentitiesMatch(parentObservationIdentity, n8nInventoryEntryIdentity(finalParentStat))
    || JSON.stringify(finalNames) !== JSON.stringify(names)
  ) {
    throw failClosedN8nRepair('ambiguous-target', 'The n8n Skills package cache inventory changed before selection');
  }
  for (const transaction of inventoryTransactions) {
    revalidateN8nEvidenceAuthority(transaction.evidenceAuthority, {
      boundary: 'canonical-cache-inventory-final',
      testHooks: options.testHooks
    });
    if (transaction[N8N_JOURNAL_CONTEXT]) {
      revalidateN8nJournalAuthority(transaction, 'canonical-cache-inventory-final', options.testHooks);
    }
  }
  const inventoryDigest = n8nInventoryDigest(parentIdentity, entries);
  const lockArtifactAuthority = n8nLockArtifactAuthority(entries);
  if (options.activeLock?.acquired) {
    const activeAuthority = options.activeLock[N8N_TARGET_LOCK_AUTHORITY];
    const activeMainLocks = entries.filter((entry) =>
      entry.kind === 'owned-lock'
      && entry.lock_artifact_class === 'main-lock'
    );
    const unresolvedProtocolArtifacts = entries.filter((entry) =>
      ['recovery-marker', 'displaced-lock'].includes(entry.lock_artifact_class)
      && entry.lock_target_identity === activeAuthority?.target_identity
    );
    if (activeMainLocks.length !== 1 || unresolvedProtocolArtifacts.length !== 0) {
      throw failClosedN8nRepair(
        'ambiguous-target',
        'Post-acquisition target-lock inventory is missing its exact active lock or retains unresolved protocol evidence'
      );
    }
  }
  for (const root of roots) {
    root.parent_directory_identity = parentIdentity;
    root.inventory_digest = inventoryDigest;
    root.inventory_entries = entries.map((entry) => ({ ...entry }));
    root.inventory_parent = parent;
    root.lock_artifact_authority = lockArtifactAuthority;
  }
  roots.sort((left, right) => left.plugin_root.localeCompare(right.plugin_root));
  return {
    roots,
    skipped: [],
    entries,
    lock_artifact_authority: lockArtifactAuthority,
    parent,
    parent_directory_identity: parentIdentity,
    inventory_digest: inventoryDigest
  };
}

function selectCurrentN8nSkillsCache({ codexHome, pluginList, discovered, allowMissingRoot = false }) {
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
  if (installed.installed === false || installed.enabled === false) {
    return {
      status: 'disabled',
      entry: null,
      reason: 'Codex explicitly reports n8n-skills@n8n-io disabled or not installed'
    };
  }
  if (installed.installed !== true || installed.enabled !== true) {
    return {
      status: 'identity-unverified',
      entry: null,
      reason: 'Codex does not positively report n8n-skills@n8n-io as installed and enabled'
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
    if (allowMissingRoot) {
      return {
        status: 'selected',
        entry: {
          plugin_id: 'n8n-skills@n8n-io',
          version,
          plugin_root: expectedRoot,
          selection_source: 'codex-installed-list-recovery',
          selected_version: version,
          directory_version: version,
          parent_directory_identity: discovered.parent_directory_identity,
          inventory_digest: discovered.inventory_digest,
          inventory_entries: discovered.entries.map((inventoryEntry) => ({ ...inventoryEntry })),
          inventory_parent: discovered.parent
        },
        reason: 'Selected by positive Codex installed/enabled version binding during interrupted recovery'
      };
    }
    return {
      status: 'missing',
      entry: null,
      reason: `Codex reports current n8n-skills@n8n-io version ${version}, but its installed cache root is missing`
    };
  }
  return {
    status: 'selected',
    entry: {
      ...entry,
      selection_source: 'codex-installed-list',
      selected_version: version,
      directory_version: entry.version
    },
    reason: ''
  };
}

function n8nTargetPathsFromPluginInspection(codexHome, pluginInspection) {
  if (!pluginInspection?.ok) return [];
  const matches = findInstalledPluginEntries(pluginInspection.pluginList, {
    pluginId: 'n8n-skills@n8n-io',
    name: 'n8n-skills',
    marketplaceName: 'n8n-io'
  });
  if (matches.length !== 1) return [];
  const installed = matches[0];
  const version = typeof installed.version === 'string' ? installed.version.trim() : '';
  if (
    installed.installed !== true
    || installed.enabled !== true
    || !version
    || version === '.'
    || version === '..'
    || /[\\/\0]/.test(version)
  ) {
    return [];
  }
  return [
    path.resolve(codexHome, 'plugins', 'cache', 'n8n-io', 'n8n-skills', version)
  ];
}

function selectCurrentN8nSkillsCacheFromConfig({ codexHome, discovered }) {
  const configured = inspectCodexConfiguredPluginState({
    codexHome,
    identity: 'n8n-skills@n8n-io'
  });
  if (configured.status === 'disabled') {
    return {
      status: 'disabled',
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
    entry: {
      ...candidates[0],
      selection_source: 'codex-config-cache-fallback',
      selected_version: candidates[0].version,
      directory_version: candidates[0].version
    },
    reason: 'Selected by explicit Codex config enablement plus one exact n8n Skills cache candidate'
  };
}

function selectCurrentN8nSkillsCacheIdentity({
  codexHome,
  pluginInspection,
  discovered,
  allowMissingCliRoot = false
}) {
  const cliMatches = pluginInspection.ok
    ? findInstalledPluginEntries(pluginInspection.pluginList, {
      pluginId: 'n8n-skills@n8n-io',
      name: 'n8n-skills',
      marketplaceName: 'n8n-io'
    })
    : [];
  if (pluginInspection.ok && cliMatches.length > 0) {
    return selectCurrentN8nSkillsCache({
      codexHome,
      pluginList: pluginInspection.pluginList,
      discovered,
      allowMissingRoot: allowMissingCliRoot
    });
  }
  return selectCurrentN8nSkillsCacheFromConfig({ codexHome, discovered });
}

function sameN8nCompatibilityEvidence(left, right) {
  return Boolean(left && right)
    && left.adapter_id === right.adapter_id
    && left.version === right.version
    && left.status === right.status
    && left.contract_digest === right.contract_digest
    && left.tree_digest === right.tree_digest;
}

function failClosedN8nRepair(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requireSelectedN8nVersionAgreement(entry, compatibility) {
  const selectedVersion = String(entry.selected_version || entry.version || '').trim();
  const directoryVersion = String(entry.directory_version || entry.version || '').trim();
  const manifestVersion = String(compatibility?.version || '').trim();
  const adapterVersion = String(N8N_SKILLS_COMPATIBILITY_ADAPTERS[manifestVersion]?.version || '').trim();
  const identityVersions = [selectedVersion, directoryVersion, manifestVersion];
  const recognizedAdapterMismatch = adapterVersion && adapterVersion !== selectedVersion;
  const missingRecognizedAdapter = !adapterVersion && compatibility?.status !== 'unsupported-version';
  if (identityVersions.some((version) => !version) || new Set(identityVersions).size !== 1 || recognizedAdapterMismatch || missingRecognizedAdapter) {
    throw failClosedN8nRepair(
      'selected-version-mismatch',
      'n8n Skills selected identity, cache directory, package manifest, and compatibility adapter versions do not agree exactly'
    );
  }
  return selectedVersion;
}

function n8nSkillsTargetLockIdentity(pluginRoot) {
  const resolved = path.resolve(pluginRoot);
  const identityInput = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  const identity = crypto.createHash('sha256').update(identityInput, 'utf8').digest('hex');
  return {
    hubRoot: path.dirname(resolved),
    lockName: `.ai-agent-toolkit-n8n-target-${identity}.lock`
  };
}

function acquireN8nSkillsTargetLock(pluginRoot, options = {}) {
  const identity = n8nSkillsTargetLockIdentity(pluginRoot);
  const attempts = options.attempts || 400;
  const delayMs = options.delayMs || 25;
  let lastLock = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    lastLock = acquireLock(identity.hubRoot, {
      hook: true,
      syncSource: 'codex-plugin',
      lockName: identity.lockName
    }, options.lockTestHooks || {});
    if (lastLock.acquired) {
      Object.defineProperty(lastLock, N8N_TARGET_LOCK_AUTHORITY, {
        configurable: false,
        enumerable: false,
        value: captureN8nTargetLockAuthority(lastLock, pluginRoot),
        writable: false
      });
      return lastLock;
    }
    if (attempt < attempts) sleepSync(delayMs);
  }
  throw failClosedN8nRepair(
    'target-lock-contended',
    'n8n Skills selected cache repair is already in progress; the target was not changed'
  );
}

function releaseN8nSkillsTargetLock(lock, testHooks = {}, operationError = null) {
  let retirement;
  try {
    retirement = releaseLock(lock, testHooks);
  } catch (error) {
    if (operationError) {
      Object.defineProperty(operationError, 'targetLockRetirementError', {
        configurable: false,
        enumerable: false,
        value: error,
        writable: false
      });
      return {
        retired: false,
        message: 'Exact target-lock retirement threw after the primary n8n Skills failure'
      };
    }
    const failure = failClosedN8nRepair(
      'target-lock-retirement-failed',
      'Exact target-lock retirement threw before a successful n8n Skills result could be returned'
    );
    failure.cause = error;
    throw failure;
  }
  if (!retirement.retired && !operationError) {
    throw failClosedN8nRepair(
      'target-lock-retirement-failed',
      `${retirement.message}; the n8n Skills result is not successful until exact lock retirement completes`
    );
  }
  return retirement;
}

function normalizedN8nTargetPath(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function n8nReplacementTargetIdentity(value) {
  return crypto.createHash('sha256').update(normalizedN8nTargetPath(value), 'utf8').digest('hex');
}

function readN8nTargetLockDescriptor(lockPath) {
  const resolved = path.resolve(lockPath);
  const parent = path.dirname(resolved);
  const parentStat = requireOrdinaryN8nDirectory(parent, 'n8n Skills target-lock parent');
  let initialStat;
  try {
    initialStat = fs.lstatSync(resolved, { bigint: true });
  } catch (error) {
    const failure = failClosedN8nRepair(
      'target-lock-authority-lost',
      'The exact n8n Skills target lock is missing before a protected mutation'
    );
    failure.cause = error;
    throw failure;
  }
  if (
    !initialStat.isFile()
    || initialStat.isSymbolicLink()
    || initialStat.nlink !== 1n
    || normalizedN8nTargetPath(fs.realpathSync.native(resolved)) !== normalizedN8nTargetPath(resolved)
  ) {
    throw failClosedN8nRepair(
      'target-lock-authority-lost',
      'The n8n Skills target lock was redirected or is not an exact ordinary single-link file'
    );
  }
  if (initialStat.size < 1n || initialStat.size > 16n * 1024n) {
    throw failClosedN8nRepair(
      'target-lock-authority-lost',
      'The n8n Skills target lock exceeds its bounded authority size'
    );
  }
  const bytes = fs.readFileSync(resolved);
  const finalStat = fs.lstatSync(resolved, { bigint: true });
  if (
    !n8nEvidenceStatIdentitiesMatch(
      n8nEvidenceStatIdentity(initialStat),
      n8nEvidenceStatIdentity(finalStat)
    )
    || BigInt(bytes.length) !== initialStat.size
  ) {
    throw failClosedN8nRepair(
      'target-lock-authority-lost',
      'The n8n Skills target lock changed while its authority was being proved'
    );
  }
  let record;
  try {
    record = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    const failure = failClosedN8nRepair(
      'target-lock-authority-lost',
      'The n8n Skills target lock is not valid exact JSON authority'
    );
    failure.cause = error;
    throw failure;
  }
  return Object.freeze({
    bytes_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    filesystem_identity: Object.freeze(n8nEvidenceStatIdentity(finalStat)),
    lock_path: normalizedN8nTargetPath(resolved),
    parent_directory_identity: Object.freeze(n8nDirectoryIdentity(parentStat)),
    parent_path: normalizedN8nTargetPath(parent),
    record: Object.freeze({ ...record })
  });
}

function captureN8nTargetLockAuthority(lock, targetPath) {
  if (!lock?.acquired || !lock.lockPath || !lock.token) {
    throw failClosedN8nRepair(
      'target-lock-authority-lost',
      'The n8n Skills repair did not acquire exact target-lock authority'
    );
  }
  const identity = n8nSkillsTargetLockIdentity(targetPath);
  const descriptor = readN8nTargetLockDescriptor(lock.lockPath);
  if (
    descriptor.lock_path !== normalizedN8nTargetPath(path.join(identity.hubRoot, identity.lockName))
    || descriptor.record.token !== lock.token
    || descriptor.record.pid !== process.pid
    || descriptor.record.sync_source !== 'codex-plugin'
  ) {
    throw failClosedN8nRepair(
      'target-lock-authority-lost',
      'The acquired n8n Skills target lock is not bound to this process, token, source, and target'
    );
  }
  return Object.freeze({
    ...descriptor,
    owner_pid: process.pid,
    target_identity: n8nReplacementTargetIdentity(targetPath),
    token: lock.token
  });
}

function bindN8nTargetLockAuthority(context, lock) {
  const authority = lock?.[N8N_TARGET_LOCK_AUTHORITY] || lock;
  if (!context || !authority?.token) {
    throw failClosedN8nRepair(
      'target-lock-authority-lost',
      'The n8n Skills transaction cannot bind missing target-lock authority'
    );
  }
  if (
    context.validated?.targetPath
    && authority.target_identity !== n8nReplacementTargetIdentity(context.validated.targetPath)
  ) {
    throw failClosedN8nRepair(
      'target-lock-authority-lost',
      'The n8n Skills target lock is bound to a different transaction target'
    );
  }
  Object.defineProperty(context, N8N_TARGET_LOCK_AUTHORITY, {
    configurable: true,
    enumerable: false,
    value: authority,
    writable: true
  });
  return context;
}

function requireExactN8nTargetLockAuthority(subject, boundary, testHooks = {}) {
  const authority = subject?.[N8N_TARGET_LOCK_AUTHORITY] || subject;
  if (!authority?.token || !authority.lock_path) {
    throw failClosedN8nRepair(
      'target-lock-authority-lost',
      `Exact n8n Skills target-lock authority is missing at ${boundary}`
    );
  }
  if (testHooks.beforeN8nTargetLockAuthorityRevalidation) {
    testHooks.beforeN8nTargetLockAuthorityRevalidation({
      boundary,
      lock_path: authority.lock_path,
      target_identity: authority.target_identity
    });
  }
  const current = readN8nTargetLockDescriptor(authority.lock_path);
  if (
    current.bytes_sha256 !== authority.bytes_sha256
    || current.lock_path !== authority.lock_path
    || !n8nEvidenceStatIdentitiesMatch(
      current.filesystem_identity,
      authority.filesystem_identity
    )
    || !n8nDirectoryIdentitiesMatch(
      current.parent_directory_identity,
      authority.parent_directory_identity
    )
    || current.parent_path !== authority.parent_path
    || current.record.token !== authority.token
    || current.record.pid !== authority.owner_pid
    || current.record.sync_source !== 'codex-plugin'
  ) {
    throw failClosedN8nRepair(
      'target-lock-authority-lost',
      `The exact n8n Skills target lock changed before protected mutation ${boundary}`
    );
  }
  return authority;
}

function n8nPathExists(value) {
  try {
    fs.lstatSync(value);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function fsyncN8nDirectoryIfSupported(directoryPath, options = {}) {
  if (process.platform === 'win32') return;
  const resolved = path.resolve(directoryPath);
  const before = requireOrdinaryN8nDirectory(
    resolved,
    options.label || 'n8n Skills durability parent'
  );
  const beforeIdentity = n8nDirectoryIdentity(before);
  const beforeRealPath = normalizedN8nTargetPath(fs.realpathSync.native(resolved));
  if (options.testHooks?.beforeN8nLogicalRetirementParentDurability) {
    options.testHooks.beforeN8nLogicalRetirementParentDurability({
      path: resolved
    });
  }
  let descriptor;
  try {
    descriptor = fs.openSync(resolved, fs.constants.O_RDONLY);
    fs.fsyncSync(descriptor);
  } catch (error) {
    const failure = failClosedN8nRepair(
      'retirement-durability-unavailable',
      'Logical-retirement parent durability could not be established'
    );
    failure.cause = error;
    throw failure;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  const after = requireOrdinaryN8nDirectory(
    resolved,
    options.label || 'n8n Skills durability parent'
  );
  if (
    normalizedN8nTargetPath(fs.realpathSync.native(resolved)) !== beforeRealPath
    || !n8nDirectoryIdentitiesMatch(beforeIdentity, n8nDirectoryIdentity(after))
  ) {
    throw failClosedN8nRepair(
      'retirement-durability-unavailable',
      'Logical-retirement parent identity changed during durability admission'
    );
  }
  if (options.testHooks?.afterN8nLogicalRetirementParentDurability) {
    options.testHooks.afterN8nLogicalRetirementParentDurability({
      path: resolved
    });
  }
}

function n8nRetiredBackupNameParts(name) {
  const match = String(name).match(
    /^(\..+\.n8n-repair-backup-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))\.retired-([0-9a-f]{48})-([0-9a-f]{64})$/i
  );
  if (!match) return null;
  return Object.freeze({
    backup_name: match[1],
    generation_id: match[2].toLowerCase(),
    ownership_token: match[3].toLowerCase(),
    manifest_digest: match[4].toLowerCase()
  });
}

function measureN8nRetainedDirectoryBytes(rootPath) {
  const pending = [path.resolve(rootPath)];
  let bytes = 0;
  let entries = 0;
  while (pending.length) {
    const current = pending.pop();
    const stat = fs.lstatSync(current, { bigint: true });
    if (stat.isSymbolicLink()) {
      throw failClosedN8nRepair(
        'offline-cleanup-required',
        'Retained logical-retirement authority contains a redirected entry'
      );
    }
    if (stat.isFile()) {
      bytes += Number(stat.size);
      if (
        !Number.isSafeInteger(bytes)
        || bytes > N8N_LOGICAL_RETIREMENT_MAX_BYTES
      ) {
        throw failClosedN8nRepair(
          'offline-cleanup-required',
          'Retained logical-retirement authority exceeds its cumulative byte ceiling'
        );
      }
      continue;
    }
    if (
      !stat.isDirectory()
      || normalizedN8nTargetPath(fs.realpathSync.native(current))
        !== normalizedN8nTargetPath(current)
    ) {
      throw failClosedN8nRepair(
        'offline-cleanup-required',
        'Retained logical-retirement authority contains a special or redirected entry'
      );
    }
    const directory = fs.opendirSync(current);
    try {
      for (;;) {
        const entry = directory.readSync();
        if (!entry) break;
        entries += 1;
        if (entries > N8N_LOGICAL_RETIREMENT_MAX_TREE_ENTRIES) {
          throw failClosedN8nRepair(
            'offline-cleanup-required',
            'Retained logical-retirement authority exceeds its bounded tree-entry ceiling'
          );
        }
        pending.push(path.join(current, entry.name));
      }
    } finally {
      directory.closeSync();
    }
  }
  return bytes;
}

function readBoundedN8nDirectChildNames(parentPath, label) {
  const parent = path.resolve(parentPath);
  const directory = fs.opendirSync(parent);
  const names = [];
  try {
    for (;;) {
      const entry = directory.readSync();
      if (!entry) break;
      names.push(entry.name);
      if (names.length > N8N_REPLACEMENT_DIRECTORY_ENTRY_LIMIT) {
        throw failClosedN8nRepair(
          'offline-cleanup-required',
          `${label} exceeds the bounded direct-child ceiling`
        );
      }
    }
  } finally {
    directory.closeSync();
  }
  names.sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  return names;
}

function inspectN8nRetainedQuarantineUsage(parentPath, options = {}) {
  const parent = path.resolve(parentPath);
  requireOrdinaryN8nDirectory(parent, 'logical-retirement package parent');
  const names = readBoundedN8nDirectChildNames(
    parent,
    'Logical-retirement inventory'
  );
  let objects = 0;
  let bytes = 0;
  for (const name of names) {
      const lockArtifact = classifyRetainedLockArtifactForParent(
        name,
        options.lockName
      );
      const retained = lockArtifact?.kind === 'retirement-quarantine'
        || Boolean(n8nRetiredBackupNameParts(name));
      if (!retained) continue;
      objects += 1;
      if (objects > N8N_LOGICAL_RETIREMENT_MAX_OBJECTS) {
        throw failClosedN8nRepair(
          'offline-cleanup-required',
          'Retained logical-retirement object count reached its locked ceiling'
        );
      }
      const fullPath = path.join(parent, name);
      const stat = fs.lstatSync(fullPath, { bigint: true });
      if (stat.isSymbolicLink()) {
        throw failClosedN8nRepair(
          'offline-cleanup-required',
          'Retained logical-retirement authority is redirected'
        );
      }
      if (stat.isFile()) {
        bytes += Number(stat.size);
      } else if (stat.isDirectory()) {
        bytes += measureN8nRetainedDirectoryBytes(fullPath);
      } else {
        throw failClosedN8nRepair(
          'offline-cleanup-required',
          'Retained logical-retirement authority has an unsupported type'
        );
      }
      if (
        !Number.isSafeInteger(bytes)
        || bytes > N8N_LOGICAL_RETIREMENT_MAX_BYTES
      ) {
        throw failClosedN8nRepair(
          'offline-cleanup-required',
          'Retained logical-retirement bytes reached the locked ceiling'
        );
      }
  }
  if (options.testHooks?.afterN8nRetainedQuarantineInventory) {
    options.testHooks.afterN8nRetainedQuarantineInventory({
      bytes,
      objects,
      observed: names.length
    });
  }
  return Object.freeze({ bytes, objects, observed: names.length });
}

function requireN8nRetainedQuarantineCapacity(parentPath, options = {}) {
  const usage = inspectN8nRetainedQuarantineUsage(parentPath, options);
  const additionalObjects = Number(options.additionalObjects || 0);
  const additionalBytes = Number(options.additionalBytes || 0);
  if (
    !Number.isSafeInteger(additionalObjects)
    || additionalObjects < 0
    || !Number.isSafeInteger(additionalBytes)
    || additionalBytes < 0
    || usage.objects + additionalObjects > N8N_LOGICAL_RETIREMENT_MAX_OBJECTS
    || usage.bytes + additionalBytes > N8N_LOGICAL_RETIREMENT_MAX_BYTES
  ) {
    throw failClosedN8nRepair(
      'offline-cleanup-required',
      'Retained logical-retirement capacity is exhausted; stop all Toolkit and Codex maintenance before separately authorised offline cleanup'
    );
  }
  return usage;
}

function n8nRetentionCapacityLockIdentity(parentPath) {
  const parent = path.resolve(parentPath);
  const codexHome = path.resolve(parent, '..', '..', '..', '..');
  const parentIdentity = crypto.createHash('sha256')
    .update(normalizedN8nTargetPath(parent), 'utf8')
    .digest('hex');
  return Object.freeze({
    hubRoot: path.join(
      codexHome,
      '.ai-agent-toolkit-n8n-repair',
      'v2',
      'retention-capacity',
      parentIdentity
    ),
    lockName: 'retention-capacity.lock',
    parent_identity: parentIdentity
  });
}

function acquireN8nRetentionCapacityLock(parentPath, testHooks = {}) {
  const identity = n8nRetentionCapacityLockIdentity(parentPath);
  const mutexTestHooks = testHooks.n8nRetentionCapacityLockTestHooks || {};
  for (
    let attempt = 1;
    attempt <= N8N_RETENTION_CAPACITY_LOCK_ATTEMPTS;
    attempt += 1
  ) {
    const lock = acquireLock(identity.hubRoot, {
      hook: true,
      lockName: identity.lockName,
      syncSource: 'codex-plugin'
    }, mutexTestHooks);
    if (lock.acquired) return Object.freeze({ ...lock, identity });
    if (attempt < N8N_RETENTION_CAPACITY_LOCK_ATTEMPTS) {
      sleepSync(N8N_RETENTION_CAPACITY_LOCK_DELAY_MS);
    }
  }
  throw failClosedN8nRepair(
    'offline-cleanup-required',
    'Retained logical-retirement capacity is busy or unprovable; no retirement mutation was attempted'
  );
}

function withN8nRetainedQuarantineAdmission(parentPath, testHooks, callback) {
  const parent = path.resolve(parentPath);
  const lock = acquireN8nRetentionCapacityLock(parent, testHooks);
  let operationError = null;
  try {
    if (testHooks.afterN8nRetentionCapacityLockAcquired) {
      testHooks.afterN8nRetentionCapacityLockAcquired({
        parent_identity: lock.identity.parent_identity,
        parent_path: parent
      });
    }
    return callback();
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    let retirement;
    try {
      retirement = releaseLock(
        lock,
        testHooks.n8nRetentionCapacityLockTestHooks || {}
      );
    } catch (error) {
      if (!operationError) {
        const failure = failClosedN8nRepair(
          'offline-cleanup-required',
          'Retained logical-retirement capacity lock could not be retired safely'
        );
        failure.cause = error;
        throw failure;
      }
      Object.defineProperty(operationError, 'retentionCapacityLockError', {
        configurable: false,
        enumerable: false,
        value: error,
        writable: false
      });
      retirement = { retired: false };
    }
    if (!retirement.retired && !operationError) {
      throw failClosedN8nRepair(
        'offline-cleanup-required',
        'Retained logical-retirement capacity lock could not be retired safely'
      );
    }
  }
}

function requireOrdinaryN8nDirectory(value, label) {
  const resolved = path.resolve(value);
  const stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw failClosedN8nRepair('recovery-evidence-invalid', `${label} is not an ordinary direct directory`);
  }
  if (normalizedN8nTargetPath(fs.realpathSync.native(resolved)) !== normalizedN8nTargetPath(resolved)) {
    throw failClosedN8nRepair('recovery-evidence-invalid', `${label} is redirected outside its exact recorded identity`);
  }
  return stat;
}

function n8nDirectoryIdentity(stat) {
  return {
    dev: String(stat.dev),
    ino: String(stat.ino),
    birthtime_ms: String(stat.birthtimeMs)
  };
}

function n8nDirectoryIdentitiesMatch(left, right) {
  return Boolean(left && right)
    && String(left.dev) === String(right.dev)
    && String(left.ino) === String(right.ino)
    && String(left.birthtime_ms) === String(right.birthtime_ms);
}

function n8nCanonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => n8nCanonicalJson(entry)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
      .map((key) => `${JSON.stringify(key)}:${n8nCanonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function n8nEvidenceStatIdentity(stat) {
  const field = (name, fallback = 0n) => {
    const value = stat[name];
    return String(value === undefined ? fallback : value);
  };
  return {
    dev: field('dev'),
    ino: field('ino'),
    mode: field('mode'),
    nlink: field('nlink'),
    size: field('size'),
    birthtime_ns: field('birthtimeNs', BigInt(Math.trunc(Number(stat.birthtimeMs || 0) * 1e6))),
    mtime_ns: field('mtimeNs', BigInt(Math.trunc(Number(stat.mtimeMs || 0) * 1e6))),
    ctime_ns: field('ctimeNs', BigInt(Math.trunc(Number(stat.ctimeMs || 0) * 1e6)))
  };
}

function n8nEvidenceStatIdentitiesMatch(left, right) {
  return Boolean(left && right)
    && Object.keys(left).every((key) => String(left[key]) === String(right[key]));
}

function n8nEvidenceParentIdentity(parentPath) {
  const stat = requireOrdinaryN8nDirectory(parentPath, 'n8n Skills evidence parent');
  return {
    normalized_path: normalizedN8nTargetPath(parentPath),
    real_path: normalizedN8nTargetPath(fs.realpathSync.native(parentPath)),
    directory_identity: n8nDirectoryIdentity(stat)
  };
}

function n8nReadEvidenceDescriptor(filePath, specification = {}) {
  const resolved = path.resolve(filePath);
  const normalizedPath = normalizedN8nTargetPath(resolved);
  const parent = path.resolve(specification.parent || path.dirname(resolved));
  if (
    normalizedN8nTargetPath(path.dirname(resolved)) !== normalizedN8nTargetPath(parent)
    || normalizedN8nTargetPath(fs.realpathSync.native(parent)) !== normalizedN8nTargetPath(parent)
  ) {
    throw failClosedN8nRepair('recovery-evidence-invalid', 'n8n Skills evidence escaped or redirected from its exact parent');
  }
  const parentIdentity = n8nEvidenceParentIdentity(parent);
  let initialStat;
  try {
    initialStat = fs.lstatSync(resolved, { bigint: true });
  } catch (error) {
    if (error?.code === 'ENOENT' && !specification.required && !specification.mustExist) {
      return Object.freeze({
        bytes_sha256: '',
        evidence_kind: specification.kind,
        expected_absence: true,
        generation_id: specification.generationId || '',
        normalized_path: normalizedPath,
        owner: specification.owner || '',
        ownership_token: specification.ownershipToken || '',
        parent_identity: parentIdentity,
        parsed_semantic_sha256: '',
        present: false,
        required: false,
        schema_version: specification.schemaVersion ?? null,
        state: specification.state || ''
      });
    }
    throw failClosedN8nRepair('recovery-evidence-invalid', 'Required n8n Skills transaction evidence is absent or unprovable');
  }
  if (!initialStat.isFile() || initialStat.isSymbolicLink()) {
    throw failClosedN8nRepair('recovery-evidence-invalid', 'n8n Skills transaction evidence is not an ordinary non-link file');
  }
  const initialIdentity = n8nEvidenceStatIdentity(initialStat);
  const evidenceByteLimit = specification.kind === 'n8n-replacement-phase-70-cleanup'
    ? N8N_PHASE_70_EVIDENCE_FILE_BYTE_LIMIT
    : N8N_EVIDENCE_FILE_BYTE_LIMIT;
  if (BigInt(initialIdentity.size) > BigInt(evidenceByteLimit)) {
    throw failClosedN8nRepair('recovery-evidence-invalid', 'n8n Skills transaction evidence exceeds the bounded byte limit');
  }
  let initialRealPath;
  try {
    initialRealPath = normalizedN8nTargetPath(fs.realpathSync.native(resolved));
  } catch {
    throw failClosedN8nRepair('recovery-evidence-invalid', 'n8n Skills transaction evidence real path is unprovable');
  }
  if (initialRealPath !== normalizedPath) {
    throw failClosedN8nRepair('recovery-evidence-invalid', 'n8n Skills transaction evidence is redirected or aliased');
  }
  const noFollow = Number.isInteger(fs.constants.O_NOFOLLOW) ? fs.constants.O_NOFOLLOW : 0;
  let descriptor;
  try {
    descriptor = fs.openSync(resolved, fs.constants.O_RDONLY | noFollow);
  } catch {
    throw failClosedN8nRepair('recovery-evidence-invalid', 'n8n Skills transaction evidence could not be opened without redirect ambiguity');
  }
  let bytes;
  let descriptorIdentity;
  try {
    const beforeDescriptorStat = fs.fstatSync(descriptor, { bigint: true });
    descriptorIdentity = n8nEvidenceStatIdentity(beforeDescriptorStat);
    if (!beforeDescriptorStat.isFile() || !n8nEvidenceStatIdentitiesMatch(initialIdentity, descriptorIdentity)) {
      throw failClosedN8nRepair('recovery-evidence-invalid', 'n8n Skills transaction evidence changed before descriptor inspection');
    }
    const expectedSize = Number(beforeDescriptorStat.size);
    bytes = Buffer.alloc(expectedSize);
    let offset = 0;
    while (offset < expectedSize) {
      const read = fs.readSync(descriptor, bytes, offset, expectedSize - offset, offset);
      if (read === 0) break;
      offset += read;
    }
    if (offset !== expectedSize) {
      throw failClosedN8nRepair('recovery-evidence-invalid', 'n8n Skills transaction evidence changed during bounded descriptor read');
    }
    const afterDescriptorIdentity = n8nEvidenceStatIdentity(fs.fstatSync(descriptor, { bigint: true }));
    if (!n8nEvidenceStatIdentitiesMatch(descriptorIdentity, afterDescriptorIdentity)) {
      throw failClosedN8nRepair('recovery-evidence-invalid', 'n8n Skills transaction evidence descriptor identity changed during read');
    }
  } finally {
    fs.closeSync(descriptor);
  }
  let finalStat;
  let finalRealPath;
  try {
    finalStat = fs.lstatSync(resolved, { bigint: true });
    finalRealPath = normalizedN8nTargetPath(fs.realpathSync.native(resolved));
  } catch {
    throw failClosedN8nRepair('recovery-evidence-invalid', 'n8n Skills transaction evidence disappeared after descriptor inspection');
  }
  if (
    !finalStat.isFile()
    || finalStat.isSymbolicLink()
    || finalRealPath !== normalizedPath
    || !n8nEvidenceStatIdentitiesMatch(initialIdentity, n8nEvidenceStatIdentity(finalStat))
  ) {
    throw failClosedN8nRepair('recovery-evidence-invalid', 'n8n Skills transaction evidence pathname identity changed during inspection');
  }
  const finalParentIdentity = n8nEvidenceParentIdentity(parent);
  if (
    finalParentIdentity.real_path !== parentIdentity.real_path
    || !n8nDirectoryIdentitiesMatch(
      finalParentIdentity.directory_identity,
      parentIdentity.directory_identity
    )
  ) {
    throw failClosedN8nRepair('recovery-evidence-invalid', 'n8n Skills transaction evidence parent changed during descriptor inspection');
  }
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw failClosedN8nRepair('recovery-evidence-invalid', 'n8n Skills transaction evidence contains malformed JSON');
  }
  const entry = {
    bytes_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    evidence_kind: specification.kind,
    expected_absence: false,
    filesystem_identity: descriptorIdentity,
    generation_id: String(parsed?.generation_id || ''),
    normalized_path: normalizedPath,
    owner: String(parsed?.owner || ''),
    ownership_token: String(parsed?.ownership_token || ''),
    parent_identity: parentIdentity,
    parsed_semantic_sha256: crypto.createHash('sha256').update(n8nCanonicalJson(parsed), 'utf8').digest('hex'),
    parsed_value: parsed,
    present: true,
    real_path: finalRealPath,
    required: Boolean(specification.required),
    schema_version: parsed?.schema_version ?? null,
    state: String(parsed?.state || '')
  };
  return Object.freeze(entry);
}

function n8nEvidenceAuxiliaryPath(recordPath, kind) {
  return recordPath.replace(/\.json$/, `.${kind}.json`);
}

function n8nEvidenceSpecifications(generation) {
  const stageExists = n8nPathExists(generation.stagePath);
  const parent = path.resolve(generation.record.expected_parent);
  const specifications = [
    {
      kind: 'generation-record',
      path: generation.recordPath,
      parent,
      required: true,
      state: 'registered'
    },
    ...['ready', 'completed', 'failed', ...N8N_TRANSACTION_AUXILIARY_KINDS].map((kind) => ({
      kind,
      path: n8nEvidenceAuxiliaryPath(generation.recordPath, kind),
      parent,
      required: kind === 'ready' && stageExists,
      state: kind
    }))
  ];
  if (stageExists) {
    specifications.push({
      kind: 'stage-owner',
      path: path.join(generation.stagePath, '.toolkit-staging-owner.json'),
      parent: generation.stagePath,
      required: true,
      state: 'ready'
    });
  }
  return specifications.map((specification) => ({
    ...specification,
    generationId: generation.record.generation_id,
    owner: 'ai-agent-toolkit-local-bridge',
    ownershipToken: generation.record.ownership_token,
    schemaVersion: 1
  }));
}

function requireN8nProvisionalGenerationRecord(record, recordPath, expectedParent) {
  if (
    !record
    || record.owner !== 'ai-agent-toolkit-local-bridge'
    || record.schema_version !== 1
    || !/^[0-9a-f-]{36}$/i.test(String(record.generation_id || ''))
    || !/^[0-9a-f]{48}$/i.test(String(record.ownership_token || ''))
    || record.state !== 'registered'
    || record.operation !== 'n8n-skills-plugin-repair'
    || record.creating_process?.lease_token !== record.ownership_token
    || normalizedN8nTargetPath(record.expected_parent || '') !== normalizedN8nTargetPath(expectedParent)
    || normalizedN8nTargetPath(path.dirname(record.expected_staging_path || '')) !== normalizedN8nTargetPath(expectedParent)
    || normalizedN8nTargetPath(path.dirname(record.expected_final_target || '')) !== normalizedN8nTargetPath(expectedParent)
    || normalizedN8nTargetPath(path.dirname(recordPath)) !== normalizedN8nTargetPath(expectedParent)
  ) {
    throw failClosedN8nRepair('recovery-evidence-invalid', 'An owned n8n Skills transaction record is malformed or identity-mismatched');
  }
}

function n8nEvidenceEntryComparable(entry) {
  return {
    bytes_sha256: entry.bytes_sha256,
    evidence_kind: entry.evidence_kind,
    expected_absence: entry.expected_absence,
    filesystem_identity: entry.filesystem_identity || null,
    generation_id: entry.generation_id,
    normalized_path: entry.normalized_path,
    owner: entry.owner,
    ownership_token: entry.ownership_token,
    parent_identity: entry.parent_identity,
    parsed_semantic_sha256: entry.parsed_semantic_sha256,
    present: entry.present,
    real_path: entry.real_path || '',
    retired: Boolean(entry.retired),
    required: entry.required,
    schema_version: entry.schema_version,
    state: entry.state
  };
}

function n8nEvidenceAuthorityDigest(entries) {
  const comparable = entries
    .map((entry) => n8nEvidenceEntryComparable(entry))
    .sort((left, right) => Buffer.compare(Buffer.from(left.normalized_path), Buffer.from(right.normalized_path)));
  return crypto.createHash('sha256').update(n8nCanonicalJson(comparable), 'utf8').digest('hex');
}

function n8nBuildEvidenceAuthority(generation) {
  const entries = n8nEvidenceSpecifications(generation).map((specification) =>
    n8nReadEvidenceDescriptor(specification.path, specification)
  );
  for (const entry of entries) {
    if (!entry.present) continue;
    if (
      entry.owner !== 'ai-agent-toolkit-local-bridge'
      || entry.schema_version !== 1
      || entry.generation_id !== generation.record.generation_id
      || entry.ownership_token !== generation.record.ownership_token
      || entry.state !== (entry.evidence_kind === 'generation-record' ? 'registered' : entry.evidence_kind === 'stage-owner' ? 'ready' : entry.evidence_kind)
    ) {
      throw failClosedN8nRepair('recovery-evidence-invalid', 'n8n Skills transaction evidence identity fields are mismatched');
    }
  }
  return Object.freeze({
    digest: n8nEvidenceAuthorityDigest(entries),
    entries: Object.freeze(entries),
    generation_id: generation.record.generation_id,
    ownership_token: generation.record.ownership_token,
    parent_identity: n8nEvidenceParentIdentity(generation.record.expected_parent)
  });
}

function n8nBuildRetiredEvidenceAuthority(generation, journal) {
  if (!['C10_CLEANUP_PENDING', 'C20_CLEANUP_COMPLETE'].includes(journal.state)) {
    throw failClosedN8nRepair(
      'journal-retired-residue-drift',
      'Missing v1 evidence is not authorised before durable physical-cleanup intent'
    );
  }
  const manifest = logicalRetirementManifest(journal);
  if (!manifest) {
    throw failClosedN8nRepair(
      'journal-retirement-corrupt',
      'The physical-cleanup journal lacks its exact logical-retirement manifest'
    );
  }
  const manifestByPath = new Map(manifest.entries.map((entry) => [
    normalizedN8nTargetPath(entry.normalized_path),
    entry
  ]));
  const entries = n8nEvidenceSpecifications(generation).map((specification) => {
    if (n8nPathExists(specification.path)) {
      return n8nReadEvidenceDescriptor(specification.path, specification);
    }
    const expected = manifestByPath.get(normalizedN8nTargetPath(specification.path));
    if (!expected?.present) {
      return n8nReadEvidenceDescriptor(specification.path, {
        ...specification,
        required: false,
        mustExist: false
      });
    }
    return Object.freeze({
      bytes_sha256: '',
      evidence_kind: specification.kind,
      expected_absence: true,
      generation_id: generation.record.generation_id,
      normalized_path: normalizedN8nTargetPath(specification.path),
      owner: 'ai-agent-toolkit-local-bridge',
      ownership_token: generation.record.ownership_token,
      parent_identity: n8nEvidenceParentIdentity(specification.parent),
      parsed_semantic_sha256: '',
      present: false,
      required: false,
      retired: true,
      schema_version: 1,
      state: specification.state
    });
  });
  return Object.freeze({
    digest: n8nEvidenceAuthorityDigest(entries),
    entries: Object.freeze(entries),
    generation_id: generation.record.generation_id,
    ownership_token: generation.record.ownership_token,
    parent_identity: n8nEvidenceParentIdentity(generation.record.expected_parent)
  });
}

function n8nEvidenceEntry(authority, kind) {
  return authority.entries.find((entry) => entry.evidence_kind === kind) || null;
}

function n8nEvidenceValue(authority, kind) {
  const entry = n8nEvidenceEntry(authority, kind);
  return entry?.present ? entry.parsed_value : null;
}

const N8N_V1_TO_V2_JOURNAL_KIND = Object.freeze({
  'n8n-pre-transaction': 'P00_PREPARED',
  'n8n-pre-transaction-phase-10-copied': 'P10_COPIED',
  'n8n-pre-transaction-phase-15-transforming': 'P15_TRANSFORMING',
  'n8n-pre-transaction-phase-20-transformed': 'P20_TRANSFORMED',
  'n8n-replacement': 'T00_REGISTERED',
  'n8n-replacement-phase-10-displace': 'T10_DISPLACE_INTENT',
  'n8n-replacement-phase-20-displaced': 'T20_DISPLACED',
  'n8n-replacement-phase-30-install': 'T30_INSTALL_INTENT',
  'n8n-replacement-phase-40-installed': 'T40_INSTALLED',
  'n8n-replacement-phase-50-verify': 'T50_VERIFY_INTENT',
  'n8n-replacement-phase-60-verified': 'T60_VERIFIED',
  'n8n-replacement-phase-70-cleanup': 'T70_CLEANUP_AUTHORIZED'
});

function n8nJournalCodexHome(context) {
  return path.resolve(context.generation.record.expected_parent, '..', '..', '..', '..');
}

function n8nJournalEvidencePayload(entry) {
  return {
    evidence_bytes_sha256: entry.bytes_sha256,
    evidence_filesystem_identity: entry.filesystem_identity || null,
    evidence_kind: entry.evidence_kind,
    evidence_semantic_sha256: entry.parsed_semantic_sha256,
    v1_authority_entry_sha256: crypto.createHash('sha256')
      .update(n8nCanonicalJson(n8nEvidenceEntryComparable(entry)), 'utf8')
      .digest('hex')
  };
}

function n8nRequireJournalMirrorEntry(journal, entry, journalKind) {
  const mirrored = journal.records.find((record) =>
    record.kind === journalKind && record.payload.evidence_kind === entry.evidence_kind
  );
  if (!mirrored) return false;
  if (
    mirrored.payload.evidence_bytes_sha256 !== entry.bytes_sha256
    || mirrored.payload.evidence_semantic_sha256 !== entry.parsed_semantic_sha256
    || mirrored.payload.v1_authority_entry_sha256 !== crypto.createHash('sha256')
      .update(n8nCanonicalJson(n8nEvidenceEntryComparable(entry)), 'utf8')
      .digest('hex')
  ) {
    throw failClosedN8nRepair(
      'journal-v1-drift',
      `The schema-2 journal no longer matches exact ${entry.evidence_kind} v1 authority`
    );
  }
  return true;
}

function bindAndSynchronizeN8nJournal(context, options = {}) {
  const write = Boolean(options.write);
  if (write) {
    requireExactN8nTargetLockAuthority(
      context,
      'schema-2-journal-bind-and-synchronize',
      options.testHooks
    );
  }
  let journal = bindJournalAuthority({
    codexHome: n8nJournalCodexHome(context),
    generationId: context.generation.record.generation_id,
    ownershipToken: context.generation.record.ownership_token,
    targetPath: context.validated.targetPath,
    testHooks: options.testHooks,
    write
  });
  if (!journal.exists) {
    context[N8N_JOURNAL_CONTEXT] = null;
    return context;
  }
  const generationEntry = n8nEvidenceEntry(context.evidenceAuthority, 'generation-record');
  const readyEntry = n8nEvidenceEntry(context.evidenceAuthority, 'ready');
  const stageOwnerEntry = n8nEvidenceEntry(context.evidenceAuthority, 'stage-owner');
  if (journal.records.length === 0) {
    if (!write) {
      context[N8N_JOURNAL_CONTEXT] = journal;
      return context;
    }
    journal = appendN8nRepairJournalRecord(journal, 'M00_V1_MIGRATION', {
      generation_record: n8nJournalEvidencePayload(generationEntry),
      ownership_token: context.generation.record.ownership_token,
      ready_record: readyEntry?.present ? n8nJournalEvidencePayload(readyEntry) : null,
      stage_owner_record: stageOwnerEntry?.present ? n8nJournalEvidencePayload(stageOwnerEntry) : null,
      v1_authority_digest_at_migration: context.evidenceAuthority.digest
    }, options);
  } else {
    const migration = journal.records[0];
    if (
      migration.kind !== 'M00_V1_MIGRATION'
      || migration.payload.generation_record?.evidence_bytes_sha256 !== generationEntry.bytes_sha256
      || migration.payload.generation_record?.evidence_semantic_sha256 !== generationEntry.parsed_semantic_sha256
    ) {
      throw failClosedN8nRepair(
        'journal-v1-drift',
        'The schema-2 journal migration record does not match the exact v1 generation authority'
      );
    }
  }
  const orderedEvidenceKinds = [
    'n8n-pre-transaction',
    'n8n-pre-transaction-phase-10-copied',
    'n8n-pre-transaction-phase-15-transforming',
    'n8n-pre-transaction-phase-20-transformed',
    'n8n-replacement',
    'n8n-replacement-phase-10-displace',
    'n8n-replacement-phase-20-displaced',
    'n8n-replacement-phase-30-install',
    'n8n-replacement-phase-40-installed',
    'n8n-replacement-phase-50-verify',
    'n8n-replacement-phase-60-verified',
    'n8n-replacement-phase-70-cleanup'
  ];
  for (const evidenceKind of orderedEvidenceKinds) {
    const entry = n8nEvidenceEntry(context.evidenceAuthority, evidenceKind);
    if (!entry?.present) continue;
    const journalKind = N8N_V1_TO_V2_JOURNAL_KIND[evidenceKind];
    if (n8nRequireJournalMirrorEntry(journal, entry, journalKind)) continue;
    if (!write) {
      context[N8N_JOURNAL_CONTEXT] = journal;
      return context;
    }
    journal = appendN8nRepairJournalRecord(
      journal,
      journalKind,
      n8nJournalEvidencePayload(entry),
      options
    );
  }
  context[N8N_JOURNAL_CONTEXT] = journal;
  return context;
}

function revalidateN8nJournalAuthority(context, boundary, testHooks = {}) {
  const journal = context?.[N8N_JOURNAL_CONTEXT];
  if (!journal?.exists) {
    throw failClosedN8nRepair(
      'journal-authority-missing',
      `Schema-2 journal authority is missing at ${boundary}`
    );
  }
  if (testHooks.beforeN8nJournalAuthorityRevalidation) {
    testHooks.beforeN8nJournalAuthorityRevalidation({
      boundary,
      generation_id: context.generation.record.generation_id,
      journal_digest: journal.digest
    });
  }
  const current = assertJournalAuthorityUnchanged(journal);
  context[N8N_JOURNAL_CONTEXT] = Object.freeze({
    ...current,
    ownership_token: journal.ownership_token,
    target_path: journal.target_path
  });
  return context[N8N_JOURNAL_CONTEXT];
}

function n8nRetirementResidueManifest(context) {
  return residueManifest(context.evidenceAuthority.entries
    .filter((entry) => entry.present)
    .map((entry) => ({
      bytes_sha256: entry.bytes_sha256,
      evidence_kind: entry.evidence_kind,
      filesystem_identity: entry.filesystem_identity,
      maximum_bytes: entry.evidence_kind === 'n8n-replacement-phase-70-cleanup'
        ? N8N_PHASE_70_EVIDENCE_FILE_BYTE_LIMIT
        : N8N_EVIDENCE_FILE_BYTE_LIMIT,
      normalized_path: entry.normalized_path,
      present: true
    })));
}

function logicallyRetireN8nEvidence(context, options = {}) {
  requireExactN8nTargetLockAuthority(
    context,
    'logical-evidence-retirement',
    options.testHooks
  );
  bindAndSynchronizeN8nJournal(context, {
    write: true,
    testHooks: options.testHooks
  });
  revalidateN8nEvidenceAuthority(context.evidenceAuthority, {
    boundary: 'before-logical-retirement',
    testHooks: options.testHooks
  });
  revalidateN8nJournalAuthority(context, 'before-logical-retirement', options.testHooks);
  let journal = context[N8N_JOURNAL_CONTEXT];
  let manifest;
  if (['L20_LOGICALLY_RETIRED', 'C10_CLEANUP_PENDING', 'C20_CLEANUP_COMPLETE'].includes(journal.state)) {
    const rebound = revalidateLogicalRetirement(journal);
    journal = Object.freeze({
      ...rebound,
      ownership_token: journal.ownership_token,
      target_path: journal.target_path
    });
    manifest = logicalRetirementManifest(journal);
  } else {
    manifest = n8nRetirementResidueManifest(context);
    requireExactN8nTargetLockAuthority(context, 'journal-logical-retirement-transition', options.testHooks);
    journal = appendLogicalRetirement(
      journal,
      manifest,
      {
        outcome: options.outcome || 'committed',
        rollbackDigest: options.rollbackDigest || '',
        testHooks: options.testHooks,
        winnerDigest: options.winnerDigest || ''
      }
    );
  }
  context[N8N_JOURNAL_CONTEXT] = journal;
  requireExactN8nTargetLockAuthority(context, 'terminal-checkpoint-logical-retirement', options.testHooks);
  const checkpoint = writeTerminalCheckpoint(journal, { testHooks: options.testHooks });
  let checkpointCleanupError = null;
  try {
    requireExactN8nTargetLockAuthority(context, 'transaction-compaction-logical-retirement', options.testHooks);
    compactSupersededTransaction(journal, checkpoint, { testHooks: options.testHooks });
  } catch (error) {
    checkpointCleanupError = error;
  }
  journal = assertJournalAuthorityUnchanged(journal);
  context[N8N_JOURNAL_CONTEXT] = Object.freeze({
    ...journal,
    ownership_token: context.generation.record.ownership_token,
    target_path: context.validated.targetPath
  });
  return {
    checkpoint,
    checkpointCleanupError,
    cleaned: false,
    evidence_authority_digest: context.evidenceAuthority.digest,
    journal_authority_digest: journal.digest,
    logicallyRetired: true,
    physicalCleanupPending: true,
    preserved: true,
    reason: 'physical-cleanup-pending'
  };
}

function revalidateN8nEvidenceAuthority(authority, options = {}) {
  if (!authority?.entries?.length) {
    throw failClosedN8nRepair('recovery-evidence-invalid', 'n8n Skills transaction evidence authority is missing');
  }
  if (options.testHooks?.beforeN8nEvidenceAuthorityRevalidation) {
    options.testHooks.beforeN8nEvidenceAuthorityRevalidation({
      boundary: options.boundary || 'unspecified',
      evidence_kinds: authority.entries.map((entry) => entry.evidence_kind)
    });
  }
  const currentEntries = authority.entries.map((expected) => {
    if (expected.retired) {
      if (n8nPathExists(expected.normalized_path)) {
        throw failClosedN8nRepair('recovery-evidence-invalid', 'Retired n8n Skills transaction evidence reappeared during cleanup');
      }
      return expected;
    }
    return n8nReadEvidenceDescriptor(expected.normalized_path, {
      generationId: authority.generation_id,
      kind: expected.evidence_kind,
      owner: 'ai-agent-toolkit-local-bridge',
      ownershipToken: authority.ownership_token,
      parent: expected.parent_identity.normalized_path,
      required: expected.required,
      mustExist: expected.present,
      schemaVersion: 1,
      state: expected.state
    });
  });
  const currentDigest = n8nEvidenceAuthorityDigest(currentEntries);
  if (currentDigest !== authority.digest) {
    const changedEntry = authority.entries.find((expected) => {
      const current = currentEntries.find((entry) => entry.evidence_kind === expected.evidence_kind);
      return JSON.stringify(n8nEvidenceEntryComparable(expected))
        !== JSON.stringify(n8nEvidenceEntryComparable(current));
    });
    const currentChangedEntry = currentEntries.find((entry) =>
      entry.evidence_kind === changedEntry?.evidence_kind
    );
    const expectedComparable = n8nEvidenceEntryComparable(changedEntry || {});
    const currentComparable = n8nEvidenceEntryComparable(currentChangedEntry || {});
    const changedFields = Object.keys(expectedComparable)
      .filter((field) => JSON.stringify(expectedComparable[field]) !== JSON.stringify(currentComparable[field]))
      .join(',');
    throw failClosedN8nRepair(
      'recovery-evidence-invalid',
      `n8n Skills transaction evidence changed after exact validation (${options.boundary || 'unspecified'}:${changedEntry?.evidence_kind || 'unknown'}:${changedFields || 'identity'})`
    );
  }
  const parentIdentity = n8nEvidenceParentIdentity(authority.parent_identity.normalized_path);
  if (
    parentIdentity.real_path !== authority.parent_identity.real_path
    || !n8nDirectoryIdentitiesMatch(parentIdentity.directory_identity, authority.parent_identity.directory_identity)
  ) {
    throw failClosedN8nRepair('recovery-evidence-invalid', 'n8n Skills transaction evidence parent identity changed');
  }
  const recordEntry = n8nEvidenceEntry(authority, 'generation-record');
  const recordName = path.basename(recordEntry.normalized_path, '.json');
  const allowedDirectNames = new Set(authority.entries
    .filter((entry) => entry.parent_identity.normalized_path === authority.parent_identity.normalized_path)
    .map((entry) => path.basename(entry.normalized_path)));
  const unexpected = fs.readdirSync(authority.parent_identity.normalized_path)
    .filter((name) => name.startsWith(`${recordName}.`) && name.endsWith('.json') && !allowedDirectNames.has(name));
  if (unexpected.length) {
    throw failClosedN8nRepair('recovery-evidence-invalid', 'n8n Skills transaction evidence contains an unexpected phase-shaped file');
  }
  return authority;
}

function requireN8nEvidenceAuthorityTransition(previous, current, allowedKind) {
  revalidateN8nEvidenceAuthority(current, { boundary: `advance-${allowedKind}` });
  if (
    previous.generation_id !== current.generation_id
    || previous.ownership_token !== current.ownership_token
    || previous.entries.length !== current.entries.length
  ) {
    throw failClosedN8nRepair('recovery-evidence-invalid', 'n8n Skills transaction evidence authority changed outside its generation');
  }
  let changes = 0;
  for (const priorEntry of previous.entries) {
    const nextEntry = current.entries.find((entry) => entry.evidence_kind === priorEntry.evidence_kind);
    if (!nextEntry) {
      throw failClosedN8nRepair('recovery-evidence-invalid', 'n8n Skills transaction evidence authority lost an expected path');
    }
    if (priorEntry.evidence_kind === allowedKind) {
      if (priorEntry.present || !nextEntry.present) {
        throw failClosedN8nRepair('recovery-evidence-invalid', 'n8n Skills transaction evidence phase was overwritten or not created');
      }
      changes += 1;
    } else if (JSON.stringify(n8nEvidenceEntryComparable(priorEntry)) !== JSON.stringify(n8nEvidenceEntryComparable(nextEntry))) {
      throw failClosedN8nRepair('recovery-evidence-invalid', 'Previously authorised n8n Skills transaction evidence changed during phase progression');
    }
  }
  if (changes !== 1) {
    throw failClosedN8nRepair('recovery-evidence-invalid', 'n8n Skills transaction evidence progression did not advance exactly one phase');
  }
  return current;
}

function requireN8nEvidenceAuthoritiesEqual(expected, current, boundary, testHooks = {}) {
  revalidateN8nEvidenceAuthority(expected, { boundary: `${boundary}-expected`, testHooks });
  revalidateN8nEvidenceAuthority(current, { boundary: `${boundary}-current`, testHooks });
  if (expected.digest !== current.digest) {
    throw failClosedN8nRepair('recovery-evidence-invalid', 'n8n Skills transaction evidence authority changed across a recovery boundary');
  }
  return current;
}

function n8nCompatibilityEvidenceMatches(expected, actual, status) {
  return Boolean(expected && actual)
    && actual.status === status
    && actual.adapter_id === expected.adapter_id
    && actual.version === expected.version
    && actual.contract_digest === expected.contract_digest
    && actual.tree_digest === expected.tree_digest
    && actual.preserved_tree_digest === expected.preserved_tree_digest;
}

function n8nCompatibilityParityIdentity(parity) {
  return {
    compatibility_contract_sha256: crypto.createHash('sha256').update(fs.readFileSync(parity.contractPath)).digest('hex'),
    source_lock_sha256: crypto.createHash('sha256').update(fs.readFileSync(parity.sourceLockPath)).digest('hex'),
    source_watch_identity: {
      source_repo: parity.sourceLock.source_repo,
      source_ref: parity.sourceLock.source_ref,
      source_commit: parity.sourceLock.source_commit,
      source_update_policy: parity.sourceLock.source_update_policy
    }
  };
}

function n8nReplacementBackupPathFor(targetPath, generationId) {
  return path.join(
    path.dirname(path.resolve(targetPath)),
    `.${path.basename(path.resolve(targetPath))}.n8n-repair-backup-${generationId}`
  );
}

function n8nReplacementBackupPath(generation) {
  return n8nReplacementBackupPathFor(
    generation.record.expected_final_target,
    generation.record.generation_id
  );
}

function n8nBackupRetirementPath(backupPath, ownershipToken, manifestDigest) {
  const token = String(ownershipToken);
  if (!/^[0-9a-f]{48}$/i.test(token)) {
    throw failClosedN8nRepair(
      'recovery-evidence-invalid',
      'Backup logical retirement lacks an exact ownership token'
    );
  }
  return path.join(
    path.dirname(path.resolve(backupPath)),
    `${path.basename(backupPath)}.retired-${token.toLowerCase()}-${manifestDigest}`
  );
}

function n8nCleanupManifestPathBytes(manifest) {
  return manifest.entries.reduce(
    (total, entry) => total + Buffer.byteLength(entry.relative_path, 'utf8'),
    0
  );
}

function requireN8nCleanupManifestByteAdmission(
  manifestSerializedBytes,
  retirementNameUtf8Bytes
) {
  if (
    !Number.isSafeInteger(manifestSerializedBytes)
    || manifestSerializedBytes < 0
    || !Number.isSafeInteger(retirementNameUtf8Bytes)
    || retirementNameUtf8Bytes < 0
    || manifestSerializedBytes > N8N_BACKUP_RESIDUE_MANIFEST_BYTE_LIMIT
    || retirementNameUtf8Bytes > 240
  ) {
    throw failClosedN8nRepair(
      'cleanup-manifest-admission-failed',
      'The exact eventual n8n Skills cleanup authority exceeds its locked pre-displacement byte ceiling'
    );
  }
  return Object.freeze({
    manifest_serialized_bytes: manifestSerializedBytes,
    retirement_name_utf8_bytes: retirementNameUtf8Bytes
  });
}

function preflightN8nCleanupManifestAdmission(targetPath, testHooks = {}) {
  const resolvedTarget = path.resolve(targetPath);
  const placeholderGeneration = '00000000-0000-0000-0000-000000000000';
  const placeholderOwnership = '0'.repeat(48);
  const placeholderBackup = n8nReplacementBackupPathFor(
    resolvedTarget,
    placeholderGeneration
  );
  const manifest = inspectN8nBackupCleanupTree(resolvedTarget, {
    authorityRootPath: placeholderBackup
  });
  const manifestBytes = n8nBackupResidueManifestBytes(manifest);
  const placeholderRetirement = n8nBackupRetirementPath(
    placeholderBackup,
    placeholderOwnership,
    manifest.digest
  );
  const retirementNameBytes = Buffer.byteLength(
    path.basename(placeholderRetirement),
    'utf8'
  );
  requireN8nCleanupManifestByteAdmission(manifestBytes, retirementNameBytes);
  const lockName = n8nSkillsTargetLockIdentity(resolvedTarget).lockName;
  requireN8nRetainedQuarantineCapacity(path.dirname(resolvedTarget), {
    additionalBytes:
      manifest.counts.total_bytes
      + LOCK_ARTIFACT_FILE_BYTE_LIMIT,
    additionalObjects: 2,
    lockName,
    testHooks
  });
  const admission = Object.freeze({
    schema_version: 1,
    tree_authority_digest: n8nBackupResidueTreeDigest(manifest),
    manifest_serialized_bytes: manifestBytes,
    retirement_name_utf8_bytes: retirementNameBytes,
    relative_path_utf8_bytes: n8nCleanupManifestPathBytes(manifest),
    counts: Object.freeze({ ...manifest.counts })
  });
  if (testHooks.afterN8nCleanupManifestPreflight) {
    testHooks.afterN8nCleanupManifestPreflight({ ...admission });
  }
  return admission;
}

function exactN8nCleanupManifestAdmission(generation, preflight) {
  const targetPath = path.resolve(generation.record.expected_final_target);
  const backupPath = n8nReplacementBackupPath(generation);
  const manifest = inspectN8nBackupCleanupTree(targetPath, {
    authorityRootPath: backupPath
  });
  const retirementPath = n8nBackupRetirementPath(
    backupPath,
    generation.record.ownership_token,
    manifest.digest
  );
  const exact = {
    schema_version: 1,
    manifest_digest: manifest.digest,
    tree_authority_digest: n8nBackupResidueTreeDigest(manifest),
    manifest_serialized_bytes: n8nBackupResidueManifestBytes(manifest),
    retirement_name_utf8_bytes: Buffer.byteLength(
      path.basename(retirementPath),
      'utf8'
    ),
    relative_path_utf8_bytes: n8nCleanupManifestPathBytes(manifest),
    counts: { ...manifest.counts },
    retirement_path: retirementPath
  };
  if (
    !preflight
    || preflight.schema_version !== 1
    || exact.tree_authority_digest !== preflight.tree_authority_digest
    || exact.manifest_serialized_bytes !== preflight.manifest_serialized_bytes
    || exact.retirement_name_utf8_bytes
      !== preflight.retirement_name_utf8_bytes
    || exact.relative_path_utf8_bytes !== preflight.relative_path_utf8_bytes
    || JSON.stringify(exact.counts) !== JSON.stringify(preflight.counts)
  ) {
    throw failClosedN8nRepair(
      'cleanup-manifest-admission-failed',
      'The exact cleanup-manifest authority changed after pre-displacement admission'
    );
  }
  return Object.freeze(exact);
}

function validN8nCleanupManifestAdmission(admission, generation, backupPath) {
  const expectedRetirementPath = admission?.manifest_digest
    ? n8nBackupRetirementPath(
      backupPath,
      generation.record.ownership_token,
      admission.manifest_digest
    )
    : '';
  return Boolean(admission)
    && admission.schema_version === 1
    && /^[0-9a-f]{64}$/.test(String(admission.manifest_digest || ''))
    && /^[0-9a-f]{64}$/.test(String(admission.tree_authority_digest || ''))
    && Number.isSafeInteger(admission.manifest_serialized_bytes)
    && admission.manifest_serialized_bytes > 0
    && admission.manifest_serialized_bytes
      <= N8N_BACKUP_RESIDUE_MANIFEST_BYTE_LIMIT
    && Number.isSafeInteger(admission.retirement_name_utf8_bytes)
    && admission.retirement_name_utf8_bytes > 0
    && admission.retirement_name_utf8_bytes <= 240
    && Number.isSafeInteger(admission.relative_path_utf8_bytes)
    && admission.relative_path_utf8_bytes >= 0
    && admission.counts
    && Number.isSafeInteger(admission.counts.files)
    && Number.isSafeInteger(admission.counts.directories)
    && Number.isSafeInteger(admission.counts.total_bytes)
    && admission.counts.files >= 0
    && admission.counts.files <= N8N_SKILLS_TREE_LIMITS.max_files
    && admission.counts.directories >= 0
    && admission.counts.directories <= N8N_SKILLS_TREE_LIMITS.max_directories
    && admission.counts.total_bytes >= 0
    && admission.counts.total_bytes <= N8N_SKILLS_TREE_LIMITS.max_total_bytes
    && normalizedN8nTargetPath(admission.retirement_path || '')
      === normalizedN8nTargetPath(expectedRetirementPath);
}

function requireExactN8nCleanupAdmissionTree(
  targetPath,
  backupPath,
  admission
) {
  const current = inspectN8nBackupCleanupTree(targetPath, {
    authorityRootPath: backupPath
  });
  if (
    current.digest !== admission.manifest_digest
    || n8nBackupResidueTreeDigest(current) !== admission.tree_authority_digest
    || n8nBackupResidueManifestBytes(current)
      !== admission.manifest_serialized_bytes
    || n8nCleanupManifestPathBytes(current)
      !== admission.relative_path_utf8_bytes
    || JSON.stringify(current.counts) !== JSON.stringify(admission.counts)
  ) {
    throw failClosedN8nRepair(
      'cleanup-manifest-admission-failed',
      'The exact cleanup-manifest tree changed before canonical displacement'
    );
  }
  return current;
}

function n8nPlannedRepairedContractDigests(adapter) {
  return [...new Set((adapter.repaired_sha256_variants || [adapter.repaired_sha256]).map((fingerprints) => {
    const canonical = Object.entries(fingerprints)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([relPath, sha256]) => `${relPath}\0${sha256 || 'missing'}\n`)
      .join('');
    return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
  }))].sort();
}

function registerN8nPreTransaction(
  generation,
  entry,
  proposal,
  parityIdentity,
  cleanupManifestPreflight
) {
  const targetPath = path.resolve(generation.record.expected_final_target);
  const stagePath = path.resolve(generation.stagePath);
  const stagedPluginPath = path.join(stagePath, 'plugin');
  const backupPath = n8nReplacementBackupPath(generation);
  const adapter = N8N_SKILLS_COMPATIBILITY_ADAPTERS[proposal.version];
  const targetDirectoryIdentity = n8nDirectoryIdentity(requireOrdinaryN8nDirectory(targetPath, 'selected n8n Skills target'));
  const stageDirectoryIdentity = n8nDirectoryIdentity(requireOrdinaryN8nDirectory(stagePath, 'owned n8n Skills staging generation'));
  const cleanupManifestAdmission = exactN8nCleanupManifestAdmission(
    generation,
    cleanupManifestPreflight
  );
  return writeOwnedStagingAuxiliary(generation, 'n8n-pre-transaction', {
    pre_transaction_schema_version: 1,
    pre_transaction_phase: 'target-untouched',
    target_identity: n8nReplacementTargetIdentity(targetPath),
    target_path: targetPath,
    selected_version: String(entry.selected_version || entry.version || ''),
    directory_version: String(entry.directory_version || entry.version || ''),
    manifest_version: proposal.version,
    adapter_id: proposal.adapter_id,
    repair_profile: adapter?.repair_profile || '',
    upstream_commit: adapter?.upstream_commit || '',
    compatibility_contract_sha256: parityIdentity.compatibility_contract_sha256,
    source_lock_sha256: parityIdentity.source_lock_sha256,
    source_watch_identity: parityIdentity.source_watch_identity,
    approval_evidence: {
      status: proposal.status,
      adapter_id: proposal.adapter_id,
      version: proposal.version,
      contract_digest: proposal.contract_digest,
      tree_digest: proposal.tree_digest,
      preserved_tree_digest: proposal.preserved_tree_digest
    },
    planned_staged_evidence: {
      status: 'healthy',
      adapter_id: proposal.adapter_id,
      version: proposal.version,
      preserved_tree_digest: proposal.preserved_tree_digest,
      contract_digests: n8nPlannedRepairedContractDigests(adapter)
    },
    stage_path: stagePath,
    staged_plugin_path: stagedPluginPath,
    stage_directory_identity: stageDirectoryIdentity,
    original_target_directory_identity: targetDirectoryIdentity,
    backup_path: backupPath,
    cleanup_manifest_admission: cleanupManifestAdmission,
    creating_process: {
      pid: process.pid,
      lease_token: generation.record.ownership_token,
      started_at: generation.record.creating_process.started_at
    },
    created_at: generation.record.created_at
  }).value;
}

function validateN8nPreTransaction(generation, preTransaction, parityIdentity) {
  const targetPath = path.resolve(generation.record.expected_final_target);
  const parent = path.resolve(generation.record.expected_parent);
  const stagePath = path.resolve(generation.stagePath);
  const expectedStagePlugin = path.join(stagePath, 'plugin');
  const expectedBackup = n8nReplacementBackupPath(generation);
  const version = String(preTransaction?.selected_version || '');
  const adapter = N8N_SKILLS_COMPATIBILITY_ADAPTERS[version];
  const exactVersion = version
    && version === preTransaction.directory_version
    && version === preTransaction.manifest_version
    && version === adapter?.version;
  const evidence = preTransaction?.approval_evidence;
  const planned = preTransaction?.planned_staged_evidence;
  const validDirectoryIdentity = (identity) => Boolean(identity)
    && /^\d+$/.test(String(identity.dev || ''))
    && /^\d+$/.test(String(identity.ino || ''))
    && /^\d+(?:\.\d+)?$/.test(String(identity.birthtime_ms || ''));
  if (
    preTransaction.pre_transaction_schema_version !== 1
    || preTransaction.pre_transaction_phase !== 'target-untouched'
    || preTransaction.target_identity !== n8nReplacementTargetIdentity(targetPath)
    || normalizedN8nTargetPath(preTransaction.target_path || '') !== normalizedN8nTargetPath(targetPath)
    || normalizedN8nTargetPath(path.dirname(targetPath)) !== normalizedN8nTargetPath(parent)
    || path.basename(targetPath) !== version
    || normalizedN8nTargetPath(preTransaction.stage_path || '') !== normalizedN8nTargetPath(stagePath)
    || normalizedN8nTargetPath(preTransaction.staged_plugin_path || '') !== normalizedN8nTargetPath(expectedStagePlugin)
    || normalizedN8nTargetPath(preTransaction.backup_path || '') !== normalizedN8nTargetPath(expectedBackup)
    || normalizedN8nTargetPath(path.dirname(expectedBackup)) !== normalizedN8nTargetPath(parent)
    || !exactVersion
    || preTransaction.adapter_id !== adapter.adapter_id
    || preTransaction.repair_profile !== adapter.repair_profile
    || preTransaction.upstream_commit !== adapter.upstream_commit
    || preTransaction.compatibility_contract_sha256 !== parityIdentity.compatibility_contract_sha256
    || preTransaction.source_lock_sha256 !== parityIdentity.source_lock_sha256
    || JSON.stringify(preTransaction.source_watch_identity) !== JSON.stringify(parityIdentity.source_watch_identity)
    || preTransaction.creating_process?.pid !== generation.record.creating_process.pid
    || preTransaction.creating_process?.lease_token !== generation.record.ownership_token
    || preTransaction.created_at !== generation.record.created_at
    || !validDirectoryIdentity(preTransaction.original_target_directory_identity)
    || !validDirectoryIdentity(preTransaction.stage_directory_identity)
    || !validN8nCleanupManifestAdmission(
      preTransaction.cleanup_manifest_admission,
      generation,
      expectedBackup
    )
    || evidence?.status !== 'repair-required'
    || evidence?.adapter_id !== adapter.adapter_id
    || evidence?.version !== version
    || !/^[0-9a-f]{64}$/.test(String(evidence?.contract_digest || ''))
    || !/^[0-9a-f]{64}$/.test(String(evidence?.tree_digest || ''))
    || !/^[0-9a-f]{64}$/.test(String(evidence?.preserved_tree_digest || ''))
    || planned?.status !== 'healthy'
    || planned?.adapter_id !== adapter.adapter_id
    || planned?.version !== version
    || planned?.preserved_tree_digest !== evidence.preserved_tree_digest
    || JSON.stringify(planned?.contract_digests) !== JSON.stringify(n8nPlannedRepairedContractDigests(adapter))
  ) {
    throw failClosedN8nRepair(
      'recovery-evidence-invalid',
      'Target-untouched n8n Skills staging evidence is malformed, mismatched, redirected, or unsupported'
    );
  }
  return {
    adapter,
    backupPath: expectedBackup,
    parent,
    stagePath,
    stagePluginPath: expectedStagePlugin,
    targetPath,
    version
  };
}

function registerN8nReplacementTransaction(
  generation,
  entry,
  proposal,
  stagedState,
  parityIdentity,
  cleanupManifestAdmission
) {
  const targetPath = path.resolve(generation.record.expected_final_target);
  const stagedPluginPath = path.join(generation.stagePath, 'plugin');
  const backupPath = n8nReplacementBackupPath(generation);
  const adapter = N8N_SKILLS_COMPATIBILITY_ADAPTERS[proposal.version];
  const targetDirectoryIdentity = n8nDirectoryIdentity(requireOrdinaryN8nDirectory(targetPath, 'selected n8n Skills target'));
  const stagedDirectoryIdentity = n8nDirectoryIdentity(requireOrdinaryN8nDirectory(stagedPluginPath, 'staged n8n Skills winner'));
  return writeOwnedStagingAuxiliary(generation, 'n8n-replacement', {
    transaction_schema_version: 1,
    transaction_phase: 'registered',
    target_identity: n8nReplacementTargetIdentity(targetPath),
    target_path: targetPath,
    selected_version: String(entry.selected_version || entry.version || ''),
    directory_version: String(entry.directory_version || entry.version || ''),
    manifest_version: proposal.version,
    adapter_id: proposal.adapter_id,
    repair_profile: adapter?.repair_profile || '',
    upstream_commit: adapter?.upstream_commit || '',
    compatibility_contract_sha256: parityIdentity.compatibility_contract_sha256,
    source_lock_sha256: parityIdentity.source_lock_sha256,
    source_watch_identity: parityIdentity.source_watch_identity,
    approval_evidence: {
      status: proposal.status,
      adapter_id: proposal.adapter_id,
      version: proposal.version,
      contract_digest: proposal.contract_digest,
      tree_digest: proposal.tree_digest,
      preserved_tree_digest: proposal.preserved_tree_digest
    },
    staged_evidence: {
      status: stagedState.status,
      adapter_id: stagedState.adapter_id,
      version: stagedState.version,
      contract_digest: stagedState.contract_digest,
      tree_digest: stagedState.tree_digest,
      preserved_tree_digest: stagedState.preserved_tree_digest
    },
    staged_plugin_path: stagedPluginPath,
    original_target_directory_identity: targetDirectoryIdentity,
    staged_plugin_directory_identity: stagedDirectoryIdentity,
    backup_path: backupPath,
    cleanup_manifest_admission: cleanupManifestAdmission,
    creating_process: {
      pid: process.pid,
      lease_token: generation.record.ownership_token,
      started_at: generation.record.creating_process.started_at
    },
    created_at: generation.record.created_at
  }).value;
}

function validateN8nReplacementTransaction(generation, transaction, parityIdentity) {
  const targetPath = path.resolve(generation.record.expected_final_target);
  const parent = path.resolve(generation.record.expected_parent);
  const expectedStagePlugin = path.join(generation.stagePath, 'plugin');
  const expectedBackup = n8nReplacementBackupPath(generation);
  const version = String(transaction?.selected_version || '');
  const adapter = N8N_SKILLS_COMPATIBILITY_ADAPTERS[version];
  const exactVersion = version
    && version === transaction.directory_version
    && version === transaction.manifest_version
    && version === adapter?.version;
  const validEvidence = (evidence, expectedStatus) => Boolean(evidence)
    && evidence.status === expectedStatus
    && evidence.adapter_id === adapter?.adapter_id
    && evidence.version === version
    && /^[0-9a-f]{64}$/.test(String(evidence.contract_digest || ''))
    && /^[0-9a-f]{64}$/.test(String(evidence.tree_digest || ''))
    && /^[0-9a-f]{64}$/.test(String(evidence.preserved_tree_digest || ''));
  const validDirectoryIdentity = (identity) => Boolean(identity)
    && /^\d+$/.test(String(identity.dev || ''))
    && /^\d+$/.test(String(identity.ino || ''))
    && /^\d+(?:\.\d+)?$/.test(String(identity.birthtime_ms || ''));
  if (
    transaction.transaction_schema_version !== 1
    || transaction.transaction_phase !== 'registered'
    || transaction.target_identity !== n8nReplacementTargetIdentity(targetPath)
    || normalizedN8nTargetPath(transaction.target_path || '') !== normalizedN8nTargetPath(targetPath)
    || normalizedN8nTargetPath(path.dirname(targetPath)) !== normalizedN8nTargetPath(parent)
    || path.basename(targetPath) !== version
    || normalizedN8nTargetPath(transaction.staged_plugin_path || '') !== normalizedN8nTargetPath(expectedStagePlugin)
    || normalizedN8nTargetPath(transaction.backup_path || '') !== normalizedN8nTargetPath(expectedBackup)
    || normalizedN8nTargetPath(path.dirname(expectedBackup)) !== normalizedN8nTargetPath(parent)
    || !exactVersion
    || transaction.adapter_id !== adapter.adapter_id
    || transaction.repair_profile !== adapter.repair_profile
    || transaction.upstream_commit !== adapter.upstream_commit
    || transaction.compatibility_contract_sha256 !== parityIdentity.compatibility_contract_sha256
    || transaction.source_lock_sha256 !== parityIdentity.source_lock_sha256
    || JSON.stringify(transaction.source_watch_identity) !== JSON.stringify(parityIdentity.source_watch_identity)
    || transaction.creating_process?.pid !== generation.record.creating_process.pid
    || transaction.creating_process?.lease_token !== generation.record.ownership_token
    || transaction.created_at !== generation.record.created_at
    || !validDirectoryIdentity(transaction.original_target_directory_identity)
    || !validDirectoryIdentity(transaction.staged_plugin_directory_identity)
    || !validN8nCleanupManifestAdmission(
      transaction.cleanup_manifest_admission,
      generation,
      expectedBackup
    )
    || !validEvidence(transaction.approval_evidence, 'repair-required')
    || !validEvidence(transaction.staged_evidence, 'healthy')
  ) {
    throw failClosedN8nRepair(
      'recovery-evidence-invalid',
      'Interrupted n8n Skills repair evidence is malformed, mismatched, redirected, or unsupported'
    );
  }
  return {
    adapter,
    backupPath: expectedBackup,
    parent,
    stagePluginPath: expectedStagePlugin,
    targetPath,
    version
  };
}

function inspectN8nPreTransactionPhases(generation, preTransaction, validated, evidenceAuthority) {
  let encounteredGap = false;
  let latestPhase = 'target-untouched';
  let copied = null;
  let transforming = null;
  let transformed = null;
  for (const kind of N8N_PRE_TRANSACTION_AUXILIARY_KINDS.slice(1)) {
    const phaseValue = n8nEvidenceValue(evidenceAuthority, kind);
    const phaseMarker = phaseValue ? { value: phaseValue } : null;
    if (!phaseMarker) {
      encounteredGap = true;
      continue;
    }
    if (
      encounteredGap
      || phaseMarker.value.pre_transaction_phase !== kind.replace('n8n-pre-transaction-phase-', '')
    ) {
      throw failClosedN8nRepair('recovery-evidence-invalid', 'Owned n8n Skills pre-transaction phase sequence is malformed or ambiguous');
    }
    const directoryIdentity = phaseMarker.value.staged_plugin_directory_identity;
    if (
      !directoryIdentity
      || !/^\d+$/.test(String(directoryIdentity.dev || ''))
      || !/^\d+$/.test(String(directoryIdentity.ino || ''))
      || !/^\d+(?:\.\d+)?$/.test(String(directoryIdentity.birthtime_ms || ''))
    ) {
      throw failClosedN8nRepair('recovery-evidence-invalid', 'Owned n8n Skills staged plugin directory identity is malformed');
    }
    if (kind.endsWith('10-copied')) {
      if (!n8nCompatibilityEvidenceMatches(preTransaction.approval_evidence, phaseMarker.value.copied_evidence, 'repair-required')) {
        throw failClosedN8nRepair('recovery-evidence-invalid', 'Owned n8n Skills copied tree evidence does not match the approved original');
      }
      copied = phaseMarker.value;
    } else if (kind.endsWith('15-transforming')) {
      if (!copied || !n8nDirectoryIdentitiesMatch(copied.staged_plugin_directory_identity, directoryIdentity)) {
        throw failClosedN8nRepair('recovery-evidence-invalid', 'Owned n8n Skills transformation phase directory identity is inconsistent');
      }
      transforming = phaseMarker.value;
    } else {
      const staged = phaseMarker.value.staged_evidence;
      if (
        !staged
        || staged.status !== 'healthy'
        || staged.adapter_id !== validated.adapter.adapter_id
        || staged.version !== validated.version
        || staged.preserved_tree_digest !== preTransaction.planned_staged_evidence.preserved_tree_digest
        || !preTransaction.planned_staged_evidence.contract_digests.includes(staged.contract_digest)
        || !/^[0-9a-f]{64}$/.test(String(staged.tree_digest || ''))
      ) {
        throw failClosedN8nRepair('recovery-evidence-invalid', 'Owned n8n Skills transformed tree evidence does not match the planned repaired identity');
      }
      if (!transforming || !n8nDirectoryIdentitiesMatch(transforming.staged_plugin_directory_identity, directoryIdentity)) {
        throw failClosedN8nRepair('recovery-evidence-invalid', 'Owned n8n Skills transformed tree directory identity is inconsistent');
      }
      transformed = phaseMarker.value;
    }
    latestPhase = phaseMarker.value.pre_transaction_phase;
  }
  return { copied, latestPhase, transformed, transforming };
}

function requireKnownN8nGenerationAuxiliaries(recordPath, directoryNames) {
  const recordBase = path.basename(recordPath, '.json');
  const prefix = `${recordBase}.`;
  const allowed = new Set([
    'ready',
    'completed',
    'failed',
    ...N8N_TRANSACTION_AUXILIARY_KINDS
  ].map((kind) => `${prefix}${kind}.json`));
  const unexpected = directoryNames
    .filter((name) => name !== path.basename(recordPath) && name.startsWith(prefix) && name.endsWith('.json') && !allowed.has(name));
  if (unexpected.length) {
    throw failClosedN8nRepair('recovery-evidence-invalid', 'Owned n8n Skills staging evidence contains an unknown or conflicting auxiliary record');
  }
}

function n8nTerminalFailureInspection(inspected, evidenceAuthority) {
  const failed = n8nEvidenceEntry(evidenceAuthority, 'failed');
  if (inspected.classification !== 'live-owned' || !failed?.present) return inspected;
  return {
    ...inspected,
    classification: 'failed-owned',
    failed: true,
    safe_to_reconcile: true
  };
}

function inspectN8nReplacementRecords(codexHome, parityIdentity, options = {}) {
  const parent = path.resolve(codexHome, 'plugins', 'cache', 'n8n-io', 'n8n-skills');
  if (!n8nPathExists(parent)) {
    return { parent, preTransactions: [], retiredTransactions: [], transactions: [] };
  }
  requireOrdinaryN8nDirectory(parent, 'n8n Skills package cache parent');
  const recordPattern = new RegExp(`^${RECORD_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\\.json$`, 'i');
  const directoryNames = [];
  const names = [];
  const directory = fs.opendirSync(parent);
  let entryCount = 0;
  try {
    for (;;) {
      const entry = directory.readSync();
      if (!entry) break;
      entryCount += 1;
      if (entryCount > N8N_REPLACEMENT_DIRECTORY_ENTRY_LIMIT) {
        throw failClosedN8nRepair('ambiguous-recovery', 'The n8n Skills package cache parent exceeds the bounded recovery inventory');
      }
      directoryNames.push(entry.name);
      if (recordPattern.test(entry.name)) names.push(entry.name);
      if (names.length > N8N_REPLACEMENT_RECORD_LIMIT) {
        throw failClosedN8nRepair('ambiguous-recovery', 'Too many owned transaction records exist to adjudicate n8n Skills recovery safely');
      }
    }
  } finally {
    directory.closeSync();
  }
  names.sort();
  const preTransactions = [];
  const retiredTransactions = [];
  const transactions = [];
  for (const name of names) {
    const recordPath = path.join(parent, name);
    const provisionalRecordEntry = n8nReadEvidenceDescriptor(recordPath, {
      kind: 'generation-record',
      parent,
      required: true,
      state: 'registered'
    });
    const record = provisionalRecordEntry.parsed_value;
    requireN8nProvisionalGenerationRecord(record, recordPath, parent);
    const generation = { record, recordPath, stagePath: record?.expected_staging_path };
    let preliminaryJournal = bindJournalAuthority({
      codexHome,
      generationId: record.generation_id,
      ownershipToken: record.ownership_token,
      targetPath: record.expected_final_target,
      write: false
    });
    if (preliminaryJournal.exists) {
      preliminaryJournal = Object.freeze({
        ...preliminaryJournal,
        ownership_token: record.ownership_token,
        target_path: path.resolve(record.expected_final_target)
      });
    }
    const preliminaryMigration = preliminaryJournal.records?.[0] || null;
    if (
      preliminaryJournal.exists
      && preliminaryJournal.records.length > 0
      && (
        preliminaryMigration?.kind !== 'M00_V1_MIGRATION'
        || preliminaryMigration.payload.generation_record?.evidence_bytes_sha256
          !== provisionalRecordEntry.bytes_sha256
        || preliminaryMigration.payload.generation_record?.evidence_semantic_sha256
          !== provisionalRecordEntry.parsed_semantic_sha256
        || preliminaryMigration.payload.ownership_token !== record.ownership_token
      )
    ) {
      throw failClosedN8nRepair(
        'journal-v1-drift',
        'The schema-2 journal does not match the exact surviving v1 generation authority'
      );
    }
    if (preliminaryJournal.status === 'logically-retired') {
      revalidateLogicalRetirement(preliminaryJournal);
    }
    const evidenceAuthority = ['C10_CLEANUP_PENDING', 'C20_CLEANUP_COMPLETE'].includes(
      preliminaryJournal.state
    )
      ? n8nBuildRetiredEvidenceAuthority(generation, preliminaryJournal)
      : n8nBuildEvidenceAuthority(generation);
    const authoritativeRecordEntry = n8nEvidenceEntry(evidenceAuthority, 'generation-record');
    if (
      JSON.stringify(n8nEvidenceEntryComparable(provisionalRecordEntry))
      !== JSON.stringify(n8nEvidenceEntryComparable(authoritativeRecordEntry))
    ) {
      throw failClosedN8nRepair('recovery-evidence-invalid', 'An owned n8n Skills transaction record changed during authority construction');
    }
    const inspected = n8nTerminalFailureInspection(
      inspectOwnedGeneration(recordPath, {
        expectedParent: parent,
        liveness: options.liveness
      }),
      evidenceAuthority
    );
    if (record.operation !== 'n8n-skills-plugin-repair') {
      throw failClosedN8nRepair('conflicting-recovery', 'A conflicting owned transaction targets the n8n Skills package cache');
    }
    requireKnownN8nGenerationAuxiliaries(recordPath, directoryNames);
    if (['C10_CLEANUP_PENDING', 'C20_CLEANUP_COMPLETE'].includes(preliminaryJournal.state)) {
      const retiredContext = {
        evidenceAuthority,
        generation,
        inspected,
        latestPhase: 'logically-retired',
        preTransaction: null,
        transaction: null,
        validated: {
          backupPath: n8nReplacementBackupPath(generation),
          stagePath: path.resolve(generation.stagePath),
          stagePluginPath: path.join(path.resolve(generation.stagePath), 'plugin'),
          targetPath: path.resolve(generation.record.expected_final_target)
        }
      };
      retiredContext[N8N_JOURNAL_CONTEXT] = preliminaryJournal;
      retiredTransactions.push(retiredContext);
      continue;
    }
    const preTransactionValue = n8nEvidenceValue(evidenceAuthority, 'n8n-pre-transaction');
    const transactionValue = n8nEvidenceValue(evidenceAuthority, 'n8n-replacement');
    const preTransactionMarker = preTransactionValue ? { value: preTransactionValue } : null;
    const transactionMarker = transactionValue ? { value: transactionValue } : null;
    if (!transactionMarker && !preTransactionMarker) {
      throw failClosedN8nRepair('recovery-evidence-invalid', 'Owned n8n Skills replacement evidence is incomplete');
    }
    let preTransaction = null;
    if (preTransactionMarker) {
      const validated = validateN8nPreTransaction(generation, preTransactionMarker.value, parityIdentity);
      const phases = inspectN8nPreTransactionPhases(
        generation,
        preTransactionMarker.value,
        validated,
        evidenceAuthority
      );
      preTransaction = {
        evidenceAuthority,
        generation,
        inspected,
        latestPhase: phases.latestPhase,
        phases,
        preTransaction: preTransactionMarker.value,
        validated
      };
      bindAndSynchronizeN8nJournal(preTransaction, { write: false });
      if (preTransaction[N8N_JOURNAL_CONTEXT]?.status === 'logically-retired') {
        revalidateLogicalRetirement(preTransaction[N8N_JOURNAL_CONTEXT]);
        retiredTransactions.push(preTransaction);
        continue;
      }
    }
    if (!transactionMarker) {
      for (const kind of N8N_REPLACEMENT_AUXILIARY_KINDS.slice(1)) {
        const phaseValue = n8nEvidenceValue(evidenceAuthority, kind);
        const phaseMarker = phaseValue ? { value: phaseValue } : null;
        if (phaseMarker) {
          throw failClosedN8nRepair('recovery-evidence-invalid', 'Target-untouched n8n Skills staging conflicts with replacement transition evidence');
        }
      }
      if (options.testHooks?.afterN8nEvidenceParsed) {
        options.testHooks.afterN8nEvidenceParsed({
          evidence_authority_digest: evidenceAuthority.digest,
          generation_id: generation.record.generation_id,
          transaction_kind: 'pre-transaction'
        });
      }
      revalidateN8nEvidenceAuthority(evidenceAuthority, {
        boundary: 'after-transaction-parsing',
        testHooks: options.testHooks
      });
      preTransactions.push(preTransaction);
      continue;
    }
    const validated = validateN8nReplacementTransaction(generation, transactionMarker.value, parityIdentity);
    let encounteredGap = false;
    let latestPhase = 'registered';
    for (const kind of N8N_REPLACEMENT_AUXILIARY_KINDS.slice(1)) {
      const phaseValue = n8nEvidenceValue(evidenceAuthority, kind);
      const phaseMarker = phaseValue ? { value: phaseValue } : null;
      if (!phaseMarker) {
        encounteredGap = true;
        continue;
      }
      if (
        encounteredGap
        || phaseMarker.value.transaction_phase !== kind.replace('n8n-replacement-phase-', '')
      ) {
        throw failClosedN8nRepair('recovery-evidence-invalid', 'Owned n8n Skills transaction phase sequence is malformed or ambiguous');
      }
      const expectedDirectoryIdentity = kind.endsWith('10-displace') || kind.endsWith('20-displaced')
        ? transactionMarker.value.original_target_directory_identity
        : kind.endsWith('30-install') || kind.endsWith('40-installed')
          ? transactionMarker.value.staged_plugin_directory_identity
          : null;
      const recordedDirectoryIdentity = kind.endsWith('10-displace')
        ? phaseMarker.value.original_target_directory_identity
        : kind.endsWith('20-displaced')
          ? phaseMarker.value.backup_directory_identity
          : kind.endsWith('30-install')
            ? phaseMarker.value.staged_plugin_directory_identity
            : kind.endsWith('40-installed')
              ? phaseMarker.value.installed_directory_identity
              : null;
      if (expectedDirectoryIdentity && !n8nDirectoryIdentitiesMatch(expectedDirectoryIdentity, recordedDirectoryIdentity)) {
        throw failClosedN8nRepair('recovery-evidence-invalid', 'Owned n8n Skills transaction phase directory identity is mismatched');
      }
      if (
        kind.endsWith('70-cleanup')
        && (
          phaseMarker.value.cleanup_authorized !== true
          || !n8nDirectoryIdentitiesMatch(
            transactionMarker.value.original_target_directory_identity,
            phaseMarker.value.backup_directory_identity
          )
          || !n8nDirectoryIdentitiesMatch(
            transactionMarker.value.staged_plugin_directory_identity,
            phaseMarker.value.installed_directory_identity
          )
          || normalizedN8nTargetPath(
            phaseMarker.value.backup_retirement_path || ''
          ) !== normalizedN8nTargetPath(
            transactionMarker.value.cleanup_manifest_admission.retirement_path
          )
        )
      ) {
        throw failClosedN8nRepair('recovery-evidence-invalid', 'Owned n8n Skills backup cleanup authorization is malformed or identity-mismatched');
      }
      if (kind.endsWith('70-cleanup')) {
        requireValidN8nBackupResidueManifest(
          phaseMarker.value.backup_residue_manifest,
          validated.backupPath,
          transactionMarker.value.original_target_directory_identity
        );
      }
      latestPhase = phaseMarker.value.transaction_phase;
    }
    if (preTransaction?.phases.transformed) {
      const transformed = preTransaction.phases.transformed;
      if (
        !n8nCompatibilityEvidenceMatches(transformed.staged_evidence, transactionMarker.value.staged_evidence, 'healthy')
        || !n8nDirectoryIdentitiesMatch(
          transformed.staged_plugin_directory_identity,
          transactionMarker.value.staged_plugin_directory_identity
        )
        || JSON.stringify(preTransaction.preTransaction.cleanup_manifest_admission)
          !== JSON.stringify(transactionMarker.value.cleanup_manifest_admission)
      ) {
        throw failClosedN8nRepair('recovery-evidence-invalid', 'Registered n8n Skills transaction does not match its target-untouched staged evidence');
      }
    } else if (preTransaction) {
      throw failClosedN8nRepair('recovery-evidence-invalid', 'Registered n8n Skills transaction is missing its completed staged-tree evidence');
    }
    const context = {
      evidenceAuthority,
      generation,
      inspected,
      latestPhase,
      preTransaction,
      transaction: transactionMarker.value,
      validated
    };
    bindAndSynchronizeN8nJournal(context, { write: false });
    if (context[N8N_JOURNAL_CONTEXT]?.status === 'logically-retired') {
      revalidateLogicalRetirement(context[N8N_JOURNAL_CONTEXT]);
      retiredTransactions.push(context);
      continue;
    }
    if (options.testHooks?.afterN8nEvidenceParsed) {
      options.testHooks.afterN8nEvidenceParsed({
        evidence_authority_digest: evidenceAuthority.digest,
        generation_id: generation.record.generation_id,
        transaction_kind: 'replacement'
      });
    }
    revalidateN8nEvidenceAuthority(evidenceAuthority, {
      boundary: 'after-transaction-parsing',
      testHooks: options.testHooks
    });
    transactions.push(context);
  }
  if (transactions.length + preTransactions.length > 1) {
    throw failClosedN8nRepair('ambiguous-recovery', 'Multiple interrupted n8n Skills transactions are ambiguous and require review');
  }
  return { parent, preTransactions, retiredTransactions, transactions };
}

function n8nEvidenceContextCodexHome(context) {
  return path.resolve(context.generation.record.expected_parent, '..', '..', '..', '..');
}

function retainN8nEvidenceContext(context, previous = null) {
  const lifecycleOwner = previous?.[N8N_EVIDENCE_LIFECYCLE_OWNER]
    || context[N8N_EVIDENCE_LIFECYCLE_OWNER]
    || context.generation;
  context[N8N_EVIDENCE_LIFECYCLE_OWNER] = lifecycleOwner;
  if (previous?.[N8N_JOURNAL_CONTEXT] && !context[N8N_JOURNAL_CONTEXT]) {
    context[N8N_JOURNAL_CONTEXT] = previous[N8N_JOURNAL_CONTEXT];
  }
  if (previous?.[N8N_TARGET_LOCK_AUTHORITY] && !context[N8N_TARGET_LOCK_AUTHORITY]) {
    bindN8nTargetLockAuthority(context, previous[N8N_TARGET_LOCK_AUTHORITY]);
  }
  lifecycleOwner[N8N_EVIDENCE_CONTEXT] = context;
  return context;
}

function n8nExpectedNextEvidenceKind(context) {
  if (!context.transaction) {
    if (context.latestPhase === 'target-untouched') return 'n8n-pre-transaction-phase-10-copied';
    if (context.latestPhase === '10-copied') return 'n8n-pre-transaction-phase-15-transforming';
    if (context.latestPhase === '15-transforming') return 'n8n-pre-transaction-phase-20-transformed';
    if (context.latestPhase === '20-transformed') return 'n8n-replacement';
    return '';
  }
  const sequence = ['registered', ...N8N_REPLACEMENT_AUXILIARY_KINDS.slice(1).map((kind) =>
    kind.replace('n8n-replacement-phase-', '')
  )];
  const index = sequence.indexOf(context.latestPhase);
  return index >= 0 && index < sequence.length - 1
    ? N8N_REPLACEMENT_AUXILIARY_KINDS.slice(1)[index]
    : '';
}

function refreshN8nEvidenceContext(previous, parityIdentity, allowedKind, testHooks = {}) {
  const refreshed = inspectN8nReplacementRecords(
    n8nEvidenceContextCodexHome(previous),
    parityIdentity,
    {
      liveness: () => 'dead',
      testHooks
    }
  );
  const candidates = [...refreshed.preTransactions, ...refreshed.transactions]
    .filter((candidate) =>
      candidate.generation.record.generation_id === previous.generation.record.generation_id
      && candidate.generation.record.ownership_token === previous.generation.record.ownership_token
    );
  if (candidates.length !== 1) {
    throw failClosedN8nRepair('recovery-evidence-invalid', 'n8n Skills transaction evidence progression lost its exact generation');
  }
  const current = candidates[0];
  requireN8nEvidenceAuthorityTransition(previous.evidenceAuthority, current.evidenceAuthority, allowedKind);
  retainN8nEvidenceContext(current, previous);
  bindAndSynchronizeN8nJournal(current, {
    write: true,
    testHooks
  });
  return current;
}

function advanceN8nEvidenceContext(context, kind, payload, parityIdentity, testHooks = {}) {
  requireExactN8nTargetLockAuthority(context, `evidence-transition-${kind}`, testHooks);
  revalidateN8nEvidenceAuthority(context.evidenceAuthority, {
    boundary: `before-${kind}`,
    testHooks
  });
  revalidateN8nJournalAuthority(context, `before-${kind}`, testHooks);
  const existing = n8nEvidenceEntry(context.evidenceAuthority, kind);
  if (!existing) {
    throw failClosedN8nRepair('recovery-evidence-invalid', 'n8n Skills transaction evidence progression targeted an unknown phase');
  }
  if (existing.present) {
    return retainN8nEvidenceContext(context);
  }
  if (n8nExpectedNextEvidenceKind(context) !== kind) {
    throw failClosedN8nRepair('recovery-evidence-invalid', 'n8n Skills transaction evidence progression attempted to skip a phase');
  }
  const phasePayload = kind.startsWith('n8n-pre-transaction-phase-')
    ? { ...payload, pre_transaction_phase: kind.replace('n8n-pre-transaction-phase-', '') }
    : kind.startsWith('n8n-replacement-phase-')
      ? { ...payload, transaction_phase: kind.replace('n8n-replacement-phase-', '') }
      : payload;
  writeOwnedStagingAuxiliary(context.generation, kind, phasePayload);
  if (testHooks.afterN8nEvidencePhaseCreated) {
    testHooks.afterN8nEvidencePhaseCreated({
      evidence_kind: kind,
      generation_id: context.generation.record.generation_id
    });
  }
  return refreshN8nEvidenceContext(context, parityIdentity, kind, testHooks);
}

function advanceN8nTerminalEvidenceContext(context, state, parityIdentity, testHooks = {}) {
  if (!['completed', 'failed'].includes(state)) {
    throw failClosedN8nRepair('recovery-evidence-invalid', 'n8n Skills transaction attempted an unsupported terminal evidence transition');
  }
  requireExactN8nTargetLockAuthority(context, `terminal-evidence-transition-${state}`, testHooks);
  revalidateN8nEvidenceAuthority(context.evidenceAuthority, {
    boundary: `before-${state}`,
    testHooks
  });
  revalidateN8nJournalAuthority(context, `before-${state}`, testHooks);
  const existing = n8nEvidenceEntry(context.evidenceAuthority, state);
  if (!existing) {
    throw failClosedN8nRepair('recovery-evidence-invalid', 'n8n Skills transaction terminal evidence path is missing from its authority');
  }
  if (existing.present) {
    return retainN8nEvidenceContext(context);
  }
  markOwnedStaging(context.generation, state);
  if (testHooks.afterN8nEvidencePhaseCreated) {
    testHooks.afterN8nEvidencePhaseCreated({
      evidence_kind: state,
      generation_id: context.generation.record.generation_id
    });
  }
  return refreshN8nEvidenceContext(context, parityIdentity, state, testHooks);
}

function retireN8nEvidenceAuthorityEntry(authority, kind) {
  const previous = n8nEvidenceEntry(authority, kind);
  if (!previous?.present) {
    throw failClosedN8nRepair('recovery-evidence-invalid', 'n8n Skills cleanup attempted to retire absent or unknown evidence');
  }
  const entries = authority.entries.map((entry) => {
    if (entry.evidence_kind !== kind) return entry;
    return Object.freeze({
      bytes_sha256: '',
      evidence_kind: entry.evidence_kind,
      expected_absence: true,
      generation_id: authority.generation_id,
      normalized_path: entry.normalized_path,
      owner: 'ai-agent-toolkit-local-bridge',
      ownership_token: authority.ownership_token,
      parent_identity: entry.parent_identity,
      parsed_semantic_sha256: '',
      present: false,
      required: false,
      retired: true,
      schema_version: 1,
      state: entry.state
    });
  });
  return Object.freeze({
    ...authority,
    digest: n8nEvidenceAuthorityDigest(entries),
    entries: Object.freeze(entries)
  });
}

function n8nMovedEvidenceMatchesAuthority(moved, expected) {
  const stableObjectIdentityMatches = [
    'dev',
    'ino',
    'mode',
    'nlink',
    'size',
    'birthtime_ns',
    'mtime_ns'
  ].every((field) =>
    String(moved.filesystem_identity?.[field]) === String(expected.filesystem_identity?.[field])
  );
  return moved.present
    && moved.bytes_sha256 === expected.bytes_sha256
    && moved.parsed_semantic_sha256 === expected.parsed_semantic_sha256
    && moved.generation_id === expected.generation_id
    && moved.ownership_token === expected.ownership_token
    && moved.owner === expected.owner
    && moved.schema_version === expected.schema_version
    && moved.state === expected.state
    && stableObjectIdentityMatches;
}

function moveAuthorizedN8nEvidenceToQuarantine(expected, quarantinePath, testHooks = {}, revalidateAll = null) {
  const current = n8nReadEvidenceDescriptor(expected.normalized_path, {
    generationId: expected.generation_id,
    kind: expected.evidence_kind,
    owner: expected.owner,
    ownershipToken: expected.ownership_token,
    parent: expected.parent_identity.normalized_path,
    required: expected.required,
    mustExist: true,
    schemaVersion: expected.schema_version,
    state: expected.state
  });
  if (
    JSON.stringify(n8nEvidenceEntryComparable(current))
    !== JSON.stringify(n8nEvidenceEntryComparable(expected))
  ) {
    throw failClosedN8nRepair('recovery-evidence-invalid', 'n8n Skills cleanup evidence changed before identity-bound retirement');
  }
  if (testHooks.beforeN8nEvidenceCleanupDelete) {
    testHooks.beforeN8nEvidenceCleanupDelete({
      evidence_kind: expected.evidence_kind,
      generation_id: expected.generation_id
    });
  }
  if (revalidateAll) revalidateAll();
  const finalCurrent = n8nReadEvidenceDescriptor(expected.normalized_path, {
    generationId: expected.generation_id,
    kind: expected.evidence_kind,
    owner: expected.owner,
    ownershipToken: expected.ownership_token,
    parent: expected.parent_identity.normalized_path,
    required: expected.required,
    mustExist: true,
    schemaVersion: expected.schema_version,
    state: expected.state
  });
  if (
    JSON.stringify(n8nEvidenceEntryComparable(finalCurrent))
    !== JSON.stringify(n8nEvidenceEntryComparable(expected))
  ) {
    throw failClosedN8nRepair('recovery-evidence-invalid', 'n8n Skills cleanup evidence changed at its destructive boundary');
  }
  fs.renameSync(expected.normalized_path, quarantinePath);
  const moved = n8nReadEvidenceDescriptor(quarantinePath, {
    generationId: expected.generation_id,
    kind: expected.evidence_kind,
    owner: expected.owner,
    ownershipToken: expected.ownership_token,
    parent: path.dirname(quarantinePath),
    required: expected.required,
    mustExist: true,
    schemaVersion: expected.schema_version,
    state: expected.state
  });
  if (!n8nMovedEvidenceMatchesAuthority(moved, expected)) {
    if (!n8nPathExists(expected.normalized_path)) {
      fs.renameSync(quarantinePath, expected.normalized_path);
    }
    throw failClosedN8nRepair('recovery-evidence-invalid', 'Quarantined n8n Skills cleanup evidence did not match its prior authority');
  }
  fs.unlinkSync(quarantinePath);
  if (testHooks.afterN8nEvidenceCleanupDelete) {
    testHooks.afterN8nEvidenceCleanupDelete({
      evidence_kind: expected.evidence_kind,
      generation_id: expected.generation_id
    });
  }
}

function legacyPhysicalCleanupN8nEvidenceAuthority(context, testHooks = {}) {
  let authority = context.evidenceAuthority;
  const revalidateCleanupAuthority = (boundary) => {
    requireExactN8nTargetLockAuthority(context, boundary, testHooks);
    return revalidateN8nEvidenceAuthority(authority, { boundary, testHooks });
  };
  requireExactN8nTargetLockAuthority(context, 'before-transaction-evidence-cleanup', testHooks);
  revalidateN8nEvidenceAuthority(authority, {
    boundary: 'before-transaction-evidence-cleanup',
    testHooks
  });
  if (testHooks.beforeN8nEvidenceCleanup) {
    testHooks.beforeN8nEvidenceCleanup({
      evidence_kinds: authority.entries.map((entry) => entry.evidence_kind),
      generation_id: authority.generation_id
    });
  }
  revalidateN8nEvidenceAuthority(authority, {
    boundary: 'at-transaction-evidence-cleanup',
    testHooks
  });
  const parent = authority.parent_identity.normalized_path;
  const quarantineRoot = path.join(
    parent,
    `.ai-agent-toolkit-evidence-quarantine-${crypto.randomUUID()}`
  );
  requireExactN8nTargetLockAuthority(context, 'before-evidence-quarantine-creation', testHooks);
  fs.mkdirSync(quarantineRoot);
  try {
    const recordEntry = n8nEvidenceEntry(authority, 'generation-record');
    const directEvidence = authority.entries
      .filter((entry) =>
        entry.present
        && entry.evidence_kind !== 'generation-record'
        && entry.evidence_kind !== 'stage-owner'
      )
      .sort((left, right) => Buffer.compare(
        Buffer.from(left.normalized_path),
        Buffer.from(right.normalized_path)
      ));
    for (const expected of directEvidence) {
      revalidateCleanupAuthority('before-each-transaction-evidence-cleanup-operation');
      moveAuthorizedN8nEvidenceToQuarantine(
        expected,
        path.join(quarantineRoot, `${crypto.randomUUID()}.json`),
        testHooks,
        () => revalidateCleanupAuthority('at-each-transaction-evidence-cleanup-operation')
      );
      authority = retireN8nEvidenceAuthorityEntry(authority, expected.evidence_kind);
      revalidateN8nEvidenceAuthority(authority, {
        boundary: 'after-each-transaction-evidence-cleanup-operation',
        testHooks
      });
    }

    const stageOwner = n8nEvidenceEntry(authority, 'stage-owner');
    if (stageOwner?.present) {
      requireExactN8nTargetLockAuthority(context, 'before-owned-stage-cleanup', testHooks);
      revalidateN8nEvidenceAuthority(authority, {
        boundary: 'before-owned-stage-cleanup',
        testHooks
      });
      const stagePath = context.generation.stagePath;
      const expectedStageIdentity = context.preTransaction?.stage_directory_identity
        || context.preTransaction?.preTransaction?.stage_directory_identity
        || context[N8N_JOURNAL_CONTEXT]?.records
          ?.find((record) => record.kind === 'C10_CLEANUP_PENDING')
          ?.payload?.stage_residue?.directory_identity;
      const stageStat = requireOrdinaryN8nDirectory(stagePath, 'owned n8n Skills staging generation');
      if (
        !expectedStageIdentity
        || !n8nDirectoryIdentitiesMatch(expectedStageIdentity, n8nDirectoryIdentity(stageStat))
      ) {
        throw failClosedN8nRepair('recovery-evidence-invalid', 'Owned n8n Skills staging directory changed before cleanup');
      }
      if (testHooks.beforeN8nEvidenceCleanupDelete) {
        testHooks.beforeN8nEvidenceCleanupDelete({
          evidence_kind: 'stage-owner',
          generation_id: authority.generation_id
        });
      }
      requireExactN8nTargetLockAuthority(context, 'at-owned-stage-cleanup', testHooks);
      revalidateN8nEvidenceAuthority(authority, {
        boundary: 'at-owned-stage-cleanup',
        testHooks
      });
      const quarantinedStage = path.join(quarantineRoot, 'stage');
      fs.renameSync(stagePath, quarantinedStage);
      const movedStageStat = requireOrdinaryN8nDirectory(quarantinedStage, 'quarantined owned n8n Skills staging generation');
      if (!n8nDirectoryIdentitiesMatch(expectedStageIdentity, n8nDirectoryIdentity(movedStageStat))) {
        if (!n8nPathExists(stagePath)) fs.renameSync(quarantinedStage, stagePath);
        throw failClosedN8nRepair('recovery-evidence-invalid', 'Quarantined n8n Skills staging directory did not match its prior authority');
      }
      const movedOwner = n8nReadEvidenceDescriptor(
        path.join(quarantinedStage, path.basename(stageOwner.normalized_path)),
        {
          generationId: authority.generation_id,
          kind: 'stage-owner',
          owner: stageOwner.owner,
          ownershipToken: authority.ownership_token,
          parent: quarantinedStage,
          required: true,
          schemaVersion: stageOwner.schema_version,
          state: stageOwner.state
        }
      );
      if (!n8nMovedEvidenceMatchesAuthority(movedOwner, stageOwner)) {
        if (!n8nPathExists(stagePath)) fs.renameSync(quarantinedStage, stagePath);
        throw failClosedN8nRepair('recovery-evidence-invalid', 'Quarantined n8n Skills stage ownership evidence did not match its prior authority');
      }
      fs.rmSync(quarantinedStage, { recursive: true });
      if (testHooks.afterN8nEvidenceCleanupDelete) {
        testHooks.afterN8nEvidenceCleanupDelete({
          evidence_kind: 'stage-owner',
          generation_id: authority.generation_id
        });
      }
      authority = retireN8nEvidenceAuthorityEntry(authority, 'stage-owner');
      revalidateN8nEvidenceAuthority(authority, {
        boundary: 'after-owned-stage-cleanup',
        testHooks
      });
    }

    revalidateN8nEvidenceAuthority(authority, {
      boundary: 'before-generation-record-cleanup',
      testHooks
    });
    requireExactN8nTargetLockAuthority(context, 'before-generation-record-cleanup', testHooks);
    moveAuthorizedN8nEvidenceToQuarantine(
      recordEntry,
      path.join(quarantineRoot, `${crypto.randomUUID()}.json`),
      testHooks,
      () => revalidateCleanupAuthority('at-generation-record-cleanup')
    );
    authority = retireN8nEvidenceAuthorityEntry(authority, 'generation-record');
    revalidateN8nEvidenceAuthority(authority, {
      boundary: 'before-transaction-completion-claim',
      testHooks
    });
    return {
      cleaned: true,
      preserved: false,
      reason: '',
      evidence_authority_digest: authority.digest,
      inspection: null
    };
  } finally {
    if (n8nPathExists(quarantineRoot)) {
      requireExactN8nTargetLockAuthority(context, 'evidence-quarantine-removal', testHooks);
      try {
        fs.rmdirSync(quarantineRoot);
      } catch {
        // A non-empty quarantine is intentional residue when identity-bound cleanup stops.
      }
    }
  }
}

function cleanupN8nEvidenceAuthority(context, testHooks = {}, retirement = {}) {
  const logical = logicallyRetireN8nEvidence(context, {
    outcome: retirement.outcome
      || (context.transaction ? 'winner-or-original-committed' : 'target-untouched-preserved'),
    rollbackDigest: retirement.rollbackDigest
      ?? context.transaction?.approval_evidence?.tree_digest
      ?? '',
    testHooks,
    winnerDigest: retirement.winnerDigest
      ?? context.transaction?.staged_evidence?.tree_digest
      ?? ''
  });
  if (testHooks.preventN8nPhysicalCleanup) return logical;
  try {
    revalidateN8nJournalAuthority(context, 'before-physical-cleanup', testHooks);
    if (context[N8N_JOURNAL_CONTEXT].state === 'L20_LOGICALLY_RETIRED') {
      requireExactN8nTargetLockAuthority(context, 'journal-cleanup-pending-transition', testHooks);
      const stageOwner = n8nEvidenceEntry(context.evidenceAuthority, 'stage-owner');
      const stageIdentity = context.preTransaction?.stage_directory_identity
        || context.preTransaction?.preTransaction?.stage_directory_identity
        || null;
      context[N8N_JOURNAL_CONTEXT] = appendN8nRepairJournalRecord(
        context[N8N_JOURNAL_CONTEXT],
        'C10_CLEANUP_PENDING',
        {
          checkpoint_digest: logical.checkpoint.digest,
          stage_residue: stageOwner?.present && stageIdentity
            ? {
              directory_identity: stageIdentity,
              normalized_path: path.resolve(context.generation.stagePath),
              owner_bytes_sha256: stageOwner.bytes_sha256,
              owner_filesystem_identity: stageOwner.filesystem_identity
            }
            : null,
          residue_manifest_digest: logicalRetirementManifest(
            context[N8N_JOURNAL_CONTEXT]
          ).digest
        },
        { testHooks }
      );
    }
    revalidateLogicalRetirement(context[N8N_JOURNAL_CONTEXT]);
    const physical = legacyPhysicalCleanupN8nEvidenceAuthority(context, testHooks);
    if (!physical.cleaned) return { ...logical, physicalCleanupError: physical.reason };
    requireExactN8nTargetLockAuthority(context, 'journal-cleanup-complete-transition', testHooks);
    context[N8N_JOURNAL_CONTEXT] = appendN8nRepairJournalRecord(
      context[N8N_JOURNAL_CONTEXT],
      'C20_CLEANUP_COMPLETE',
      {
        checkpoint_digest: logical.checkpoint.digest,
        residue_manifest_digest: n8nRetirementResidueManifest(context).digest
      },
      { testHooks }
    );
    requireExactN8nTargetLockAuthority(context, 'terminal-checkpoint-completion', testHooks);
    const completionCheckpoint = writeTerminalCheckpoint(
      context[N8N_JOURNAL_CONTEXT],
      { testHooks }
    );
    let checkpointCleanupError = null;
    try {
      requireExactN8nTargetLockAuthority(context, 'transaction-compaction-completion', testHooks);
      compactSupersededTransaction(
        context[N8N_JOURNAL_CONTEXT],
        completionCheckpoint,
        { testHooks }
      );
    } catch (error) {
      checkpointCleanupError = checkpointCleanupError || error;
    }
    return {
      ...physical,
      checkpoint: completionCheckpoint,
      checkpointCleanupError,
      journal_authority_digest: context[N8N_JOURNAL_CONTEXT].digest,
      logicallyRetired: true,
      physicalCleanupPending: false
    };
  } catch (error) {
    return {
      ...logical,
      physicalCleanupCause: error,
      physicalCleanupError: error?.code || 'physical-cleanup-failed'
    };
  }
}

function finalizeOrphanedN8nPhysicalCleanup(codexHome, targetPath, testHooks = {}) {
  const lock = acquireN8nSkillsTargetLock(targetPath);
  let operationError = null;
  try {
    requireExactN8nTargetLockAuthority(lock, 'orphaned-journal-discovery', testHooks);
    const journals = discoverN8nRepairJournalsForTarget({
      codexHome,
      testHooks,
      targetPath,
      write: true
    });
    for (let journal of journals) {
      if (!['C10_CLEANUP_PENDING', 'C20_CLEANUP_COMPLETE'].includes(journal.state)) {
        throw failClosedN8nRepair(
          'journal-authority-missing',
          'A retained transaction journal lacks surviving v1 recovery authority'
        );
      }
      journal = Object.freeze({
        ...revalidateLogicalRetirement(journal),
        ownership_token: journal.ownership_token,
        target_path: path.resolve(targetPath)
      });
      const manifest = logicalRetirementManifest(journal);
      if (manifest.entries.some((entry) => entry.present && n8nPathExists(entry.normalized_path))) {
        throw failClosedN8nRepair(
          'physical-cleanup-pending',
          'A retained terminal journal still has exact v1 residue requiring controlled cleanup'
        );
      }
      const cleanupIntent = journal.records.find((record) => record.kind === 'C10_CLEANUP_PENDING');
      if (
        cleanupIntent?.payload?.stage_residue?.normalized_path
        && n8nPathExists(cleanupIntent.payload.stage_residue.normalized_path)
      ) {
        throw failClosedN8nRepair(
          'physical-cleanup-pending',
          'A retained terminal journal still has exact stage residue requiring controlled cleanup'
        );
      }
      if (journal.state === 'C10_CLEANUP_PENDING') {
      requireExactN8nTargetLockAuthority(lock, 'orphaned-journal-cleanup-complete', testHooks);
      journal = appendN8nRepairJournalRecord(
          journal,
          'C20_CLEANUP_COMPLETE',
          {
            checkpoint_digest: cleanupIntent?.payload?.checkpoint_digest || '',
            residue_manifest_digest: manifest.digest
          },
          { testHooks }
        );
      }
      requireExactN8nTargetLockAuthority(lock, 'orphaned-terminal-checkpoint', testHooks);
      const checkpoint = writeTerminalCheckpoint(journal, { testHooks });
      requireExactN8nTargetLockAuthority(lock, 'orphaned-transaction-compaction', testHooks);
      compactSupersededTransaction(journal, checkpoint, { testHooks });
    }
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    releaseN8nSkillsTargetLock(lock, testHooks, operationError);
  }
}

function requireExactN8nOriginalBackup(backupPath, transaction) {
  const backupStat = requireOrdinaryN8nDirectory(backupPath, 'recorded n8n Skills backup');
  if (!n8nDirectoryIdentitiesMatch(
    transaction.original_target_directory_identity,
    n8nDirectoryIdentity(backupStat)
  )) {
    throw failClosedN8nRepair('recovery-evidence-invalid', 'Recorded n8n Skills backup directory identity no longer matches its owned transaction');
  }
  const backupState = classifyN8nSkillsCompatibility(backupPath);
  if (!n8nCompatibilityEvidenceMatches(transaction.approval_evidence, backupState, 'repair-required')) {
    throw failClosedN8nRepair('recovery-evidence-invalid', 'Recorded n8n Skills backup no longer matches the exact approved original tree');
  }
  return backupState;
}

function n8nBackupCleanupEntryOrder(left, right) {
  const leftDepth = left.relative_path ? left.relative_path.split('/').length : 0;
  const rightDepth = right.relative_path ? right.relative_path.split('/').length : 0;
  return rightDepth - leftDepth
    || Buffer.compare(Buffer.from(left.relative_path), Buffer.from(right.relative_path));
}

function n8nHashBackupCleanupFile(filePath, expectedStat) {
  const expectedIdentity = n8nEvidenceStatIdentity(expectedStat);
  const size = Number(expectedStat.size);
  if (
    !Number.isSafeInteger(size)
    || size < 0
    || size > N8N_SKILLS_TREE_LIMITS.max_file_bytes
  ) {
    throw failClosedN8nRepair('recovery-evidence-invalid', 'Recorded n8n Skills backup cleanup contains an unsupported file size');
  }
  const noFollow = Number.isInteger(fs.constants.O_NOFOLLOW) ? fs.constants.O_NOFOLLOW : 0;
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow);
  const hashPass = () => {
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let offset = 0;
    while (offset < size) {
      const bytesRead = fs.readSync(
        descriptor,
        buffer,
        0,
        Math.min(buffer.length, size - offset),
        offset
      );
      if (bytesRead <= 0) {
        throw failClosedN8nRepair('recovery-evidence-invalid', 'Recorded n8n Skills backup file changed during cleanup inspection');
      }
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    return hash.digest('hex');
  };
  try {
    const descriptorStat = fs.fstatSync(descriptor, { bigint: true });
    if (
      !descriptorStat.isFile()
      || !n8nEvidenceStatIdentitiesMatch(expectedIdentity, n8nEvidenceStatIdentity(descriptorStat))
    ) {
      throw failClosedN8nRepair('recovery-evidence-invalid', 'Recorded n8n Skills backup file changed before cleanup inspection');
    }
    const firstDigest = hashPass();
    const secondDigest = hashPass();
    const finalDescriptorIdentity = n8nEvidenceStatIdentity(fs.fstatSync(descriptor, { bigint: true }));
    const finalStat = fs.lstatSync(filePath, { bigint: true });
    if (
      firstDigest !== secondDigest
      || finalStat.isSymbolicLink()
      || !finalStat.isFile()
      || !n8nEvidenceStatIdentitiesMatch(expectedIdentity, finalDescriptorIdentity)
      || !n8nEvidenceStatIdentitiesMatch(expectedIdentity, n8nEvidenceStatIdentity(finalStat))
      || normalizedN8nTargetPath(fs.realpathSync.native(filePath)) !== normalizedN8nTargetPath(filePath)
    ) {
      throw failClosedN8nRepair('recovery-evidence-invalid', 'Recorded n8n Skills backup file changed during cleanup inspection');
    }
    return firstDigest;
  } finally {
    fs.closeSync(descriptor);
  }
}

function n8nBackupResidueManifestComparable(manifest) {
  return {
    schema_version: manifest.schema_version,
    root_normalized_path: manifest.root_normalized_path,
    root_directory_identity: manifest.root_directory_identity,
    entries: manifest.entries,
    counts: manifest.counts
  };
}

function n8nBackupResidueManifestDigest(manifest) {
  return crypto.createHash('sha256')
    .update(n8nCanonicalJson(n8nBackupResidueManifestComparable(manifest)), 'utf8')
    .digest('hex');
}

function n8nBackupResidueTreeDigest(manifest) {
  return crypto.createHash('sha256')
    .update(n8nCanonicalJson({
      counts: manifest.counts,
      entries: manifest.entries,
      root_directory_identity: manifest.root_directory_identity,
      schema_version: manifest.schema_version
    }), 'utf8')
    .digest('hex');
}

function n8nBackupResidueManifestBytes(manifest) {
  return Buffer.byteLength(JSON.stringify(manifest, null, 2), 'utf8');
}

function readBoundedN8nBackupChildNames(directoryPath, observeEntry) {
  const directory = fs.opendirSync(directoryPath);
  const names = [];
  try {
    for (;;) {
      const entry = directory.readSync();
      if (!entry) break;
      observeEntry();
      names.push(entry.name);
    }
  } finally {
    directory.closeSync();
  }
  names.sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  return names;
}

function inspectN8nBackupCleanupTree(backupPath, options = {}) {
  const resolvedBackupPath = path.resolve(backupPath);
  const authorityRootPath = path.resolve(options.authorityRootPath || resolvedBackupPath);
  const rootStat = requireOrdinaryN8nDirectory(
    resolvedBackupPath,
    'recorded n8n Skills backup'
  );
  const entries = [];
  const directoryAuthorities = [];
  const pending = [{
    depth: 0,
    fullPath: resolvedBackupPath,
    relativePath: ''
  }];
  let directories = 0;
  let files = 0;
  let totalBytes = 0;
  let observedEntries = 0;
  const observeEntry = () => {
    observedEntries += 1;
    if (
      observedEntries
      > N8N_SKILLS_TREE_LIMITS.max_files + N8N_SKILLS_TREE_LIMITS.max_directories
    ) {
      throw failClosedN8nRepair(
        'recovery-evidence-invalid',
        'Recorded n8n Skills backup cleanup exceeds the bounded cumulative entry count'
      );
    }
  };
  while (pending.length) {
    const current = pending.pop();
    const stat = fs.lstatSync(current.fullPath, { bigint: true });
    if (stat.isSymbolicLink()) {
      throw failClosedN8nRepair('recovery-evidence-invalid', 'Recorded n8n Skills backup cleanup contains a redirected entry');
    }
    if (stat.isDirectory()) {
      if (normalizedN8nTargetPath(fs.realpathSync.native(current.fullPath)) !== normalizedN8nTargetPath(current.fullPath)) {
        throw failClosedN8nRepair('recovery-evidence-invalid', 'Recorded n8n Skills backup cleanup contains an aliased directory');
      }
      if (current.depth > N8N_SKILLS_TREE_LIMITS.max_depth) {
        throw failClosedN8nRepair('recovery-evidence-invalid', 'Recorded n8n Skills backup cleanup exceeds the bounded directory depth');
      }
      if (current.relativePath) {
        directories += 1;
        if (directories > N8N_SKILLS_TREE_LIMITS.max_directories) {
          throw failClosedN8nRepair('recovery-evidence-invalid', 'Recorded n8n Skills backup cleanup exceeds the bounded directory count');
        }
      }
      const children = readBoundedN8nBackupChildNames(
        current.fullPath,
        observeEntry
      );
      const directoryIdentity = n8nDirectoryIdentity(fs.lstatSync(current.fullPath));
      entries.push({
        type: 'directory',
        relative_path: current.relativePath,
        directory_identity: directoryIdentity
      });
      directoryAuthorities.push({
        child_names: children,
        directory_identity: directoryIdentity,
        full_path: current.fullPath,
        relative_path: current.relativePath
      });
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const name = children[index];
        pending.push({
          depth: current.depth + 1,
          fullPath: path.join(current.fullPath, name),
          relativePath: current.relativePath ? `${current.relativePath}/${name}` : name
        });
      }
      continue;
    }
    if (!stat.isFile()) {
      throw failClosedN8nRepair('recovery-evidence-invalid', 'Recorded n8n Skills backup cleanup contains a special filesystem entry');
    }
    const size = Number(stat.size);
    files += 1;
    totalBytes += size;
    if (
      !Number.isSafeInteger(size)
      || size < 0
      || files > N8N_SKILLS_TREE_LIMITS.max_files
      || size > N8N_SKILLS_TREE_LIMITS.max_file_bytes
      || totalBytes > N8N_SKILLS_TREE_LIMITS.max_total_bytes
    ) {
      throw failClosedN8nRepair('recovery-evidence-invalid', 'Recorded n8n Skills backup cleanup exceeds the bounded file or byte limits');
    }
    entries.push({
      type: 'file',
      relative_path: current.relativePath,
      filesystem_identity: n8nEvidenceStatIdentity(stat),
      bytes_sha256: n8nHashBackupCleanupFile(current.fullPath, stat)
    });
  }
  for (const entry of entries.filter((candidate) => candidate.type === 'file')) {
    const fullPath = path.join(resolvedBackupPath, ...entry.relative_path.split('/'));
    const stat = fs.lstatSync(fullPath, { bigint: true });
    if (
      !n8nEvidenceStatIdentitiesMatch(entry.filesystem_identity, n8nEvidenceStatIdentity(stat))
      || n8nHashBackupCleanupFile(fullPath, stat) !== entry.bytes_sha256
    ) {
      throw failClosedN8nRepair('recovery-evidence-invalid', 'Recorded n8n Skills backup file changed before cleanup authorization completed');
    }
  }
  let revalidatedEntries = 0;
  const observeRevalidatedEntry = () => {
    revalidatedEntries += 1;
    if (
      revalidatedEntries
      > N8N_SKILLS_TREE_LIMITS.max_files + N8N_SKILLS_TREE_LIMITS.max_directories
    ) {
      throw failClosedN8nRepair(
        'recovery-evidence-invalid',
        'Recorded n8n Skills backup cleanup changed beyond its bounded cumulative entry count'
      );
    }
  };
  for (const authority of directoryAuthorities) {
    const stat = fs.lstatSync(authority.full_path);
    const childNames = readBoundedN8nBackupChildNames(
      authority.full_path,
      observeRevalidatedEntry
    );
    if (
      stat.isSymbolicLink()
      || !stat.isDirectory()
      || !n8nDirectoryIdentitiesMatch(authority.directory_identity, n8nDirectoryIdentity(stat))
      || normalizedN8nTargetPath(fs.realpathSync.native(authority.full_path))
        !== normalizedN8nTargetPath(authority.full_path)
      || JSON.stringify(childNames) !== JSON.stringify(authority.child_names)
    ) {
      throw failClosedN8nRepair('recovery-evidence-invalid', 'Recorded n8n Skills backup directory changed before cleanup authorization completed');
    }
  }
  entries.sort(n8nBackupCleanupEntryOrder);
  const manifest = {
    schema_version: 1,
    root_normalized_path: normalizedN8nTargetPath(authorityRootPath),
    root_directory_identity: n8nDirectoryIdentity(rootStat),
    entries,
    counts: {
      files,
      directories,
      total_bytes: totalBytes
    }
  };
  manifest.digest = n8nBackupResidueManifestDigest(manifest);
  if (
    n8nBackupResidueManifestBytes(manifest)
    > N8N_BACKUP_RESIDUE_MANIFEST_BYTE_LIMIT
  ) {
    throw failClosedN8nRepair('recovery-evidence-invalid', 'Recorded n8n Skills backup cleanup manifest exceeds its bounded byte limit');
  }
  return manifest;
}

function requireValidN8nBackupResidueManifest(manifest, backupPath, expectedRootIdentity) {
  const expectedManifestKeys = [
    'counts',
    'digest',
    'entries',
    'root_directory_identity',
    'root_normalized_path',
    'schema_version'
  ];
  const validIdentity = (identity, keys) => Boolean(identity)
    && JSON.stringify(Object.keys(identity).sort()) === JSON.stringify([...keys].sort())
    && keys.every((key) => (
      key === 'birthtime_ms'
        ? /^-?\d+(?:\.\d+)?$/
        : /^-?\d+$/
    ).test(String(identity[key] || '')));
  if (
    !manifest
    || typeof manifest !== 'object'
    || Array.isArray(manifest)
    || JSON.stringify(Object.keys(manifest).sort()) !== JSON.stringify(expectedManifestKeys)
    || manifest.schema_version !== 1
    || manifest.root_normalized_path !== normalizedN8nTargetPath(backupPath)
    || !n8nDirectoryIdentitiesMatch(expectedRootIdentity, manifest.root_directory_identity)
    || !validIdentity(manifest.root_directory_identity, ['dev', 'ino', 'birthtime_ms'])
    || !Array.isArray(manifest.entries)
    || !/^[0-9a-f]{64}$/.test(String(manifest.digest || ''))
    || manifest.digest !== n8nBackupResidueManifestDigest(manifest)
    || !manifest.counts
    || JSON.stringify(Object.keys(manifest.counts).sort())
      !== JSON.stringify(['directories', 'files', 'total_bytes'])
    || !Number.isSafeInteger(manifest.counts.files)
    || !Number.isSafeInteger(manifest.counts.directories)
    || !Number.isSafeInteger(manifest.counts.total_bytes)
    || manifest.counts.files < 0
    || manifest.counts.files > N8N_SKILLS_TREE_LIMITS.max_files
    || manifest.counts.directories < 0
    || manifest.counts.directories > N8N_SKILLS_TREE_LIMITS.max_directories
    || manifest.counts.total_bytes < 0
    || manifest.counts.total_bytes > N8N_SKILLS_TREE_LIMITS.max_total_bytes
    || Buffer.byteLength(JSON.stringify(manifest, null, 2), 'utf8')
      > N8N_BACKUP_RESIDUE_MANIFEST_BYTE_LIMIT
  ) {
    throw failClosedN8nRepair('recovery-evidence-invalid', 'Owned n8n Skills backup cleanup manifest is malformed or mismatched');
  }
  const paths = new Set();
  let files = 0;
  let directories = 0;
  let totalBytes = 0;
  const indexByPath = new Map();
  for (let index = 0; index < manifest.entries.length; index += 1) {
    const entry = manifest.entries[index];
    const relativePath = String(entry?.relative_path ?? '');
    const segments = relativePath ? relativePath.split('/') : [];
    if (
      !entry
      || typeof entry !== 'object'
      || Array.isArray(entry)
      || paths.has(relativePath)
      || relativePath.includes('\\')
      || path.isAbsolute(relativePath)
      || segments.some((segment) => !segment || segment === '.' || segment === '..')
    ) {
      throw failClosedN8nRepair('recovery-evidence-invalid', 'Owned n8n Skills backup cleanup manifest contains an invalid path');
    }
    paths.add(relativePath);
    indexByPath.set(relativePath, index);
    if (entry.type === 'file') {
      const fileIdentityKeys = [
        'dev',
        'ino',
        'mode',
        'nlink',
        'size',
        'birthtime_ns',
        'mtime_ns',
        'ctime_ns'
      ];
      if (
        JSON.stringify(Object.keys(entry).sort())
          !== JSON.stringify(['bytes_sha256', 'filesystem_identity', 'relative_path', 'type'])
        || !relativePath
        || !validIdentity(entry.filesystem_identity, fileIdentityKeys)
        || !/^[0-9a-f]{64}$/.test(String(entry.bytes_sha256 || ''))
      ) {
        throw failClosedN8nRepair('recovery-evidence-invalid', 'Owned n8n Skills backup cleanup manifest contains malformed file authority');
      }
      const size = Number(entry.filesystem_identity.size);
      if (!Number.isSafeInteger(size) || size < 0 || size > N8N_SKILLS_TREE_LIMITS.max_file_bytes) {
        throw failClosedN8nRepair('recovery-evidence-invalid', 'Owned n8n Skills backup cleanup manifest contains an invalid file size');
      }
      files += 1;
      totalBytes += size;
    } else if (entry.type === 'directory') {
      if (
        JSON.stringify(Object.keys(entry).sort())
          !== JSON.stringify(['directory_identity', 'relative_path', 'type'])
        || !validIdentity(entry.directory_identity, ['dev', 'ino', 'birthtime_ms'])
      ) {
        throw failClosedN8nRepair('recovery-evidence-invalid', 'Owned n8n Skills backup cleanup manifest contains malformed directory authority');
      }
      if (relativePath) directories += 1;
    } else {
      throw failClosedN8nRepair('recovery-evidence-invalid', 'Owned n8n Skills backup cleanup manifest contains an unsupported entry');
    }
  }
  const canonicalEntries = [...manifest.entries].sort(n8nBackupCleanupEntryOrder);
  if (
    JSON.stringify(canonicalEntries) !== JSON.stringify(manifest.entries)
    || manifest.entries.at(-1)?.type !== 'directory'
    || manifest.entries.at(-1)?.relative_path !== ''
    || !n8nDirectoryIdentitiesMatch(
      manifest.root_directory_identity,
      manifest.entries.at(-1)?.directory_identity
    )
    || files !== manifest.counts.files
    || directories !== manifest.counts.directories
    || totalBytes !== manifest.counts.total_bytes
  ) {
    throw failClosedN8nRepair('recovery-evidence-invalid', 'Owned n8n Skills backup cleanup manifest is not canonical or count-bound');
  }
  for (let index = 0; index < manifest.entries.length; index += 1) {
    const entry = manifest.entries[index];
    if (!entry.relative_path) continue;
    const parentPath = entry.relative_path.includes('/')
      ? entry.relative_path.slice(0, entry.relative_path.lastIndexOf('/'))
      : '';
    const parentIndex = indexByPath.get(parentPath);
    if (
      parentIndex === undefined
      || parentIndex <= index
      || manifest.entries[parentIndex].type !== 'directory'
    ) {
      throw failClosedN8nRepair('recovery-evidence-invalid', 'Owned n8n Skills backup cleanup manifest violates child-before-parent order');
    }
  }
  return manifest;
}

function requireExactN8nBackupRetirement(
  retirementPath,
  backupPath,
  transaction,
  manifest
) {
  const parts = n8nRetiredBackupNameParts(path.basename(retirementPath));
  if (
    !parts
    || parts.backup_name !== path.basename(backupPath)
    || parts.ownership_token
      !== String(transaction.creating_process?.lease_token || '').toLowerCase()
    || parts.manifest_digest !== manifest.digest
    || normalizedN8nTargetPath(path.dirname(retirementPath))
      !== normalizedN8nTargetPath(path.dirname(backupPath))
  ) {
    throw failClosedN8nRepair(
      'recovery-evidence-invalid',
      'Retained n8n Skills backup retirement name is malformed or transaction-mismatched'
    );
  }
  const current = inspectN8nBackupCleanupTree(retirementPath, {
    authorityRootPath: backupPath
  });
  if (
    current.digest !== manifest.digest
    || n8nBackupResidueTreeDigest(current)
      !== n8nBackupResidueTreeDigest(manifest)
    || JSON.stringify(current) !== JSON.stringify(manifest)
  ) {
    throw failClosedN8nRepair(
      'recovery-evidence-invalid',
      'Retained n8n Skills backup retirement changed from its exact manifest authority'
    );
  }
  return current;
}

function logicallyRetireExactN8nBackup(
  backupPath,
  transaction,
  manifest,
  options = {}
) {
  requireValidN8nBackupResidueManifest(
    manifest,
    backupPath,
    transaction.original_target_directory_identity
  );
  if (options.beforeCleanupInspection) options.beforeCleanupInspection();
  if (
    transaction.cleanup_manifest_admission?.manifest_digest !== manifest.digest
    || transaction.cleanup_manifest_admission?.tree_authority_digest
      !== n8nBackupResidueTreeDigest(manifest)
  ) {
    throw failClosedN8nRepair(
      'recovery-evidence-invalid',
      'Backup logical retirement is not bound to the exact pre-displacement admission'
    );
  }
  const retirementPath = path.resolve(
    transaction.cleanup_manifest_admission.retirement_path
  );
  const expectedRetirementPath = n8nBackupRetirementPath(
    backupPath,
    transaction.creating_process.lease_token,
    manifest.digest
  );
  if (
    normalizedN8nTargetPath(retirementPath)
      !== normalizedN8nTargetPath(expectedRetirementPath)
  ) {
    throw failClosedN8nRepair(
      'recovery-evidence-invalid',
      'Backup logical-retirement path is not mechanically bound to the transaction'
    );
  }

  const sourcePresent = n8nPathExists(backupPath);
  const retirementPresent = n8nPathExists(retirementPath);
  if (sourcePresent && retirementPresent) {
    throw failClosedN8nRepair(
      'recovery-evidence-invalid',
      'Backup source and retained logical-retirement destination conflict'
    );
  }
  if (!sourcePresent && !retirementPresent) {
    throw failClosedN8nRepair(
      'recovery-evidence-invalid',
      'Backup logical-retirement authority is absent from both exact namespaces'
    );
  }

  if (sourcePresent) {
    // Fence the active transaction before capacity admission mutates the
    // coordination namespace. The same authority is re-proved inside the
    // capacity mutex immediately before the backup-root rename.
    if (options.beforeEachCleanupOperation) {
      options.beforeEachCleanupOperation({
        admission: true,
        entry: manifest.entries.at(-1),
        index: 0
      });
    }
    withN8nRetainedQuarantineAdmission(
      path.dirname(backupPath),
      options.testHooks || {},
      () => {
    const sourceManifest = inspectN8nBackupCleanupTree(backupPath);
    if (JSON.stringify(sourceManifest) !== JSON.stringify(manifest)) {
      throw failClosedN8nRepair(
        'recovery-evidence-invalid',
        'Backup source changed before whole-root logical retirement'
      );
    }
    requireN8nRetainedQuarantineCapacity(path.dirname(backupPath), {
      additionalBytes: manifest.counts.total_bytes,
      additionalObjects: 1,
      lockName: n8nSkillsTargetLockIdentity(transaction.target_path).lockName,
      testHooks: options.testHooks
    });
    if (options.beforeFinalCleanupOperation) {
      options.beforeFinalCleanupOperation({
        entry: manifest.entries.at(-1),
        index: manifest.entries.length - 1
      });
    }
    if (options.beforeEachCleanupOperation) {
      options.beforeEachCleanupOperation({
        entry: manifest.entries.at(-1),
        index: 0
      });
    }
    if (options.testHooks?.beforeN8nBackupLogicalRetirementMove) {
      options.testHooks.beforeN8nBackupLogicalRetirementMove({
        backup_path: backupPath,
        retirement_path: retirementPath
      });
    }
    renameSyncWithRetry(backupPath, retirementPath, {
      renameAttempts: options.testHooks?.backupRetirementRenameAttempts,
      retryDelayMs: options.testHooks?.backupRetirementRetryDelayMs,
      renameOperation: options.testHooks?.backupRetirementRenameOperation,
      beforeEachAttempt({ attempt }) {
        if (options.beforeEachCleanupOperation) {
          options.beforeEachCleanupOperation({
            attempt,
            entry: manifest.entries.at(-1),
            index: 0
          });
        }
        if (n8nPathExists(retirementPath)) {
          throw failClosedN8nRepair(
            'recovery-evidence-invalid',
            'Backup logical-retirement destination appeared before exact rename'
          );
        }
        const exactSource = inspectN8nBackupCleanupTree(backupPath);
        if (JSON.stringify(exactSource) !== JSON.stringify(manifest)) {
          throw failClosedN8nRepair(
            'recovery-evidence-invalid',
            'Backup source changed at its whole-root logical-retirement boundary'
          );
        }
      }
    });
    if (options.testHooks?.afterN8nBackupLogicalRetirementMove) {
      options.testHooks.afterN8nBackupLogicalRetirementMove({
        backup_path: backupPath,
        retirement_path: retirementPath
      });
    }
      }
    );
  }

  if (n8nPathExists(backupPath)) {
    throw failClosedN8nRepair(
      'recovery-evidence-invalid',
      'Backup source path reappeared after whole-root logical retirement'
    );
  }
  requireExactN8nBackupRetirement(
    retirementPath,
    backupPath,
    transaction,
    manifest
  );
  if (options.testHooks?.afterN8nBackupLogicalRetirementVerification) {
    options.testHooks.afterN8nBackupLogicalRetirementVerification({
      backup_path: backupPath,
      retirement_path: retirementPath
    });
  }
  requireExactN8nBackupRetirement(
    retirementPath,
    backupPath,
    transaction,
    manifest
  );
  fsyncN8nDirectoryIfSupported(path.dirname(backupPath), {
    label: 'backup logical-retirement parent',
    testHooks: options.testHooks
  });
  if (
    n8nPathExists(backupPath)
    || !n8nPathExists(retirementPath)
  ) {
    throw failClosedN8nRepair(
      'recovery-evidence-invalid',
      'Backup logical retirement lost its exact retained namespace authority'
    );
  }
  if (options.testHooks?.afterN8nBackupLogicalRetirementPublished) {
    options.testHooks.afterN8nBackupLogicalRetirementPublished({
      backup_path: backupPath,
      retirement_path: retirementPath
    });
  }
  if (options.testHooks?.afterN8nBackupCleanupEntry) {
    options.testHooks.afterN8nBackupCleanupEntry({
      entry_type: 'directory',
      relative_path: '',
      removed: 0,
      retired: 1,
      retirement_path: retirementPath
    });
  }
  if (options.afterCleanup) options.afterCleanup();
  return {
    retained_bytes: manifest.counts.total_bytes,
    retained_objects: 1,
    retirement_path: retirementPath
  };
}

function authorizeN8nWinnerBackupCleanup(
  generation,
  transaction,
  backupPath,
  targetPath,
  testHooks = {}
) {
  requireExactN8nOriginalBackup(backupPath, transaction);
  if (testHooks.beforeN8nBackupCleanupManifestInspection) {
    testHooks.beforeN8nBackupCleanupManifestInspection({
      backupPath,
      generation,
      targetPath
    });
  }
  const backupResidueManifest = inspectN8nBackupCleanupTree(backupPath);
  const admission = transaction.cleanup_manifest_admission;
  if (
    !validN8nCleanupManifestAdmission(
      admission,
      generation,
      backupPath
    )
    || backupResidueManifest.digest !== admission.manifest_digest
    || n8nBackupResidueTreeDigest(backupResidueManifest)
      !== admission.tree_authority_digest
    || n8nBackupResidueManifestBytes(backupResidueManifest)
      !== admission.manifest_serialized_bytes
    || n8nCleanupManifestPathBytes(backupResidueManifest)
      !== admission.relative_path_utf8_bytes
    || JSON.stringify(backupResidueManifest.counts)
      !== JSON.stringify(admission.counts)
  ) {
    throw failClosedN8nRepair(
      'recovery-evidence-invalid',
      'Recorded n8n Skills backup cleanup authority does not match its pre-displacement admission'
    );
  }
  if (!n8nDirectoryIdentitiesMatch(
    transaction.original_target_directory_identity,
    backupResidueManifest.root_directory_identity
  )) {
    throw failClosedN8nRepair(
      'recovery-evidence-invalid',
      'Recorded n8n Skills backup identity changed before cleanup authorization'
    );
  }
  const approvedBackup = classifyN8nSkillsCompatibility(backupPath);
  if (!n8nCompatibilityEvidenceMatches(
    transaction.approval_evidence,
    approvedBackup,
    'repair-required'
  )) {
    throw failClosedN8nRepair(
      'recovery-evidence-invalid',
      'Recorded n8n Skills backup changed after its approval proof and before cleanup authorization'
    );
  }
  const targetStat = requireOrdinaryN8nDirectory(targetPath, 'verified n8n Skills winner');
  if (!n8nDirectoryIdentitiesMatch(
    transaction.staged_plugin_directory_identity,
    n8nDirectoryIdentity(targetStat)
  )) {
    throw failClosedN8nRepair('recovery-evidence-invalid', 'Verified n8n Skills winner directory identity changed before backup cleanup');
  }
  return {
    cleanup_authorized: true,
    backup_directory_identity: transaction.original_target_directory_identity,
    installed_directory_identity: transaction.staged_plugin_directory_identity,
    backup_retirement_path: admission.retirement_path,
    backup_residue_manifest: backupResidueManifest
  };
}

function n8nRecoveryPhaseOrdinal(transaction) {
  if (!transaction?.transaction) return -1;
  return transaction.latestPhase === 'registered'
    ? 0
    : Number.parseInt(String(transaction.latestPhase).split('-')[0], 10);
}

function requireExactN8nTreeBoundary(pluginRoot, expectedEvidence, expectedStatus, expectedIdentity, label) {
  const stat = requireOrdinaryN8nDirectory(pluginRoot, label);
  if (!n8nDirectoryIdentitiesMatch(expectedIdentity, n8nDirectoryIdentity(stat))) {
    throw failClosedN8nRepair(
      'destructive-boundary-drift',
      `${label} filesystem identity changed at the destructive boundary`
    );
  }
  const classified = classifyN8nSkillsCompatibility(pluginRoot);
  if (!n8nCompatibilityEvidenceMatches(expectedEvidence, classified, expectedStatus)) {
    throw failClosedN8nRepair(
      'destructive-boundary-drift',
      `${label} bytes changed at the destructive boundary`
    );
  }
  return classified;
}

function requireExactN8nFinalWinner(entry, transaction, targetPath, label, testHooks = {}, boundary = '') {
  try {
    if (testHooks.beforeN8nFinalWinnerProof) {
      testHooks.beforeN8nFinalWinnerProof({
        boundary: boundary || 'exact-final-winner-proof',
        targetPath
      });
    }
    const classified = requireExactN8nTreeBoundary(
      targetPath,
      transaction.staged_evidence,
      'healthy',
      transaction.staged_plugin_directory_identity,
      label
    );
    requireSelectedN8nVersionAgreement(entry, classified);
    if (testHooks.afterN8nCompleteClassification) {
      testHooks.afterN8nCompleteClassification({
        boundary: boundary || 'exact-final-winner-proof',
        status: classified.status
      });
    }
    return {
      classification: classified,
      directory_identity: transaction.staged_plugin_directory_identity
    };
  } catch (error) {
    const drift = failClosedN8nRepair(
      'final-winner-drift',
      `${label} is no longer the exact identity-bound healthy n8n Skills winner`
    );
    drift.cause = error;
    throw drift;
  }
}

function requireExactN8nFinalWinnerIdentity(transaction, targetPath, label) {
  try {
    const targetStat = requireOrdinaryN8nDirectory(targetPath, label);
    if (!n8nDirectoryIdentitiesMatch(
      transaction.staged_plugin_directory_identity,
      n8nDirectoryIdentity(targetStat)
    )) {
      throw failClosedN8nRepair(
        'final-winner-drift',
        `${label} directory identity changed`
      );
    }
    return targetStat;
  } catch (error) {
    if (error?.code === 'final-winner-drift') throw error;
    const drift = failClosedN8nRepair(
      'final-winner-drift',
      `${label} is missing, redirected, or no longer the installed winner identity`
    );
    drift.cause = error;
    throw drift;
  }
}

function requireExactN8nParentBoundary(parentPath, expectedIdentity, label) {
  const stat = requireOrdinaryN8nDirectory(parentPath, label);
  if (!n8nDirectoryIdentitiesMatch(expectedIdentity, n8nDirectoryIdentity(stat))) {
    throw failClosedN8nRepair(
      'destructive-boundary-drift',
      `${label} identity changed at the destructive boundary`
    );
  }
  return stat;
}

function n8nDestructiveRenameOptions(context, specification, testHooks = {}, baseOptions = {}) {
  return {
    ...baseOptions,
    beforeEachAttempt({ attempt, sourcePath, targetPath }) {
      if (testHooks.beforeN8nDestructiveOperation) {
        testHooks.beforeN8nDestructiveOperation({
          attempt,
          boundary: specification.boundary,
          generation_id: context.generation.record.generation_id
        });
      }
      requireExactN8nTargetLockAuthority(
        context,
        `${specification.boundary}-attempt-${attempt}`,
        testHooks
      );
      revalidateN8nEvidenceAuthority(context.evidenceAuthority, {
        boundary: `${specification.boundary}-attempt-${attempt}`,
        testHooks
      });
      revalidateN8nJournalAuthority(
        context,
        `${specification.boundary}-attempt-${attempt}`,
        testHooks
      );
      for (const parent of specification.parents || []) {
        requireExactN8nParentBoundary(parent.path, parent.identity, parent.label);
      }
      for (const tree of specification.trees || []) {
        requireExactN8nTreeBoundary(
          tree.path,
          tree.evidence,
          tree.status,
          tree.identity,
          tree.label
        );
      }
      if (specification.revalidateExactAuthority) {
        specification.revalidateExactAuthority({
          attempt,
          sourcePath,
          targetPath
        });
      }
      for (const absentPath of specification.absent || []) {
        if (n8nPathExists(absentPath)) {
          throw failClosedN8nRepair(
            'destructive-boundary-drift',
            'A destructive rename destination appeared before the exact rename operation'
          );
        }
      }
    }
  };
}

function n8nBackupRestoreRenameOptions(context, hostIdentity, backupPath, targetPath, testHooks = {}) {
  return n8nDestructiveRenameOptions(
    context,
    {
      absent: [targetPath],
      boundary: 'original-backup-restoration',
      parents: [{
        identity: hostIdentity.selection.parent_directory_identity,
        label: 'n8n Skills package parent',
        path: path.dirname(targetPath)
      }],
      trees: [{
        evidence: context.transaction.approval_evidence,
        identity: context.transaction.original_target_directory_identity,
        label: 'recorded n8n Skills backup',
        path: backupPath,
        status: 'repair-required'
      }]
    },
    testHooks
  );
}

function requireN8nDestructiveDeleteBoundary(context, specification, testHooks = {}) {
  if (testHooks.beforeN8nDestructiveOperation) {
    testHooks.beforeN8nDestructiveOperation({
      attempt: 1,
      boundary: specification.boundary,
      generation_id: context.generation.record.generation_id
    });
  }
  requireExactN8nTargetLockAuthority(context, specification.boundary, testHooks);
  revalidateN8nEvidenceAuthority(context.evidenceAuthority, {
    boundary: specification.boundary,
    testHooks
  });
  revalidateN8nJournalAuthority(context, specification.boundary, testHooks);
  for (const parent of specification.parents || []) {
    requireExactN8nParentBoundary(parent.path, parent.identity, parent.label);
  }
  for (const tree of specification.trees || []) {
    if (tree.fresh && (!tree.evidence || typeof tree.status !== 'string' || !tree.status)) {
      throw failClosedN8nRepair(
        'destructive-boundary-configuration',
        `${tree.label || 'Fresh destructive-delete tree'} lacks exact expected evidence and status`
      );
    }
    requireExactN8nTreeBoundary(
      tree.path,
      tree.evidence,
      tree.status,
      tree.identity,
      tree.label
    );
  }
}

function requireN8nInventorySelectionBinding(selection, inventory, options = {}) {
  const selectedRoot = normalizedN8nTargetPath(selection.plugin_root);
  const candidate = inventory.roots.find((entry) =>
    normalizedN8nTargetPath(entry.plugin_root) === selectedRoot
    && entry.version === selection.selected_version
  );
  if (!candidate) {
    throw failClosedN8nRepair('ambiguous-target', 'The exact selected n8n Skills cache disappeared during inventory revalidation');
  }
  if (
    !n8nDirectoryIdentitiesMatch(selection.cache_directory_identity, candidate.cache_directory_identity)
    || !n8nDirectoryIdentitiesMatch(selection.parent_directory_identity, inventory.parent_directory_identity)
  ) {
    throw failClosedN8nRepair('ambiguous-target', 'The exact selected n8n Skills cache or package parent identity changed during inventory revalidation');
  }
  const expectedEntries = selection.inventory_entries || [];
  const expectedHasOwnedTransaction = expectedEntries.some((entry) => [
    'owned-stage',
    'owned-backup',
    'owned-evidence',
    'owned-nested-evidence',
    'absent-owned-evidence'
  ].includes(entry.kind));
  const transactionOwnedKinds = new Set([
    'owned-stage',
    'owned-backup',
    'owned-evidence',
    'owned-nested-evidence',
    'absent-owned-evidence'
  ]);
  const expectedComparableEntries = expectedEntries.filter((entry) =>
    !n8nInventoryIsLockArtifact(entry)
    && !(options.allowRetiredTransactionEvidence && transactionOwnedKinds.has(entry.kind))
  );
  const comparisonEntries = inventory.entries.filter((entry) => {
    if (n8nInventoryIsLockArtifact(entry)) return false;
    if (
      (!expectedHasOwnedTransaction || options.allowRetiredTransactionEvidence)
      && transactionOwnedKinds.has(entry.kind)
    ) {
      return false;
    }
    return true;
  });
  const comparisonDigest = n8nInventoryDigest(
    inventory.parent_directory_identity,
    comparisonEntries,
    options.excludedOrdinaryRoots || []
  );
  const expectedDigest = expectedEntries.length
    ? n8nInventoryDigest(
      selection.parent_directory_identity,
      expectedComparableEntries,
      options.excludedOrdinaryRoots || []
    )
    : selection.inventory_digest;
  if (expectedDigest !== comparisonDigest) {
    throw failClosedN8nRepair('ambiguous-target', 'The bounded n8n Skills cache inventory changed after current-cache selection');
  }
  return candidate;
}

function requireN8nRecoveryHostIdentity(codexHome, pluginInspection, transaction, options = {}) {
  revalidateN8nEvidenceAuthority(transaction.evidenceAuthority, {
    boundary: options.activeLock ? 'after-target-lock-before-host-identity' : 'before-host-identity',
    testHooks: options.testHooks
  });
  if (transaction[N8N_JOURNAL_CONTEXT]) {
    revalidateN8nJournalAuthority(
      transaction,
      options.activeLock ? 'after-target-lock-before-host-identity' : 'before-host-identity',
      options.testHooks
    );
  }
  const discovered = discoverN8nSkillsCacheRoots(codexHome, {
    activeLock: options.activeLock,
    testHooks: options.testHooks,
    transaction
  });
  const selection = selectCurrentN8nSkillsCacheIdentity({
    codexHome,
    pluginInspection,
    discovered,
    allowMissingCliRoot: true
  });
  if (selection.status === 'disabled') {
    throw failClosedN8nRepair('disabled', 'Codex explicitly reports the n8n Skills plugin disabled or not installed; recovery did not mutate it');
  }
  if (selection.status !== 'selected') {
    const code = selection.status === 'ambiguous' ? 'ambiguous-target' : 'identity-unverified';
    throw failClosedN8nRepair(
      code,
      selection.reason || 'Current n8n Skills host identity cannot be proven for interrupted transaction recovery'
    );
  }
  const currentVersion = String(selection.entry.selected_version || '').trim();
  const directoryVersion = String(selection.entry.directory_version || '').trim();
  const currentRoot = normalizedN8nTargetPath(selection.entry.plugin_root);
  const expectedCurrentRoot = normalizedN8nTargetPath(
    path.join(path.dirname(transaction.validated.targetPath), currentVersion)
  );
  if (
    !currentVersion
    || currentVersion !== directoryVersion
    || currentRoot !== expectedCurrentRoot
  ) {
    throw failClosedN8nRepair(
      'identity-unverified',
      'Selected n8n Skills recovery identity is not bound to one exact canonical cache path and version'
    );
  }
  const currentRootStat = n8nPathExists(selection.entry.plugin_root)
    ? requireOrdinaryN8nDirectory(selection.entry.plugin_root, 'selected current n8n Skills cache')
    : null;
  const boundSelection = {
    ...selection.entry,
    ...(currentRootStat ? { cache_directory_identity: n8nDirectoryIdentity(currentRootStat) } : {}),
    parent_directory_identity: discovered.parent_directory_identity,
    inventory_digest: discovered.inventory_digest,
    inventory_entries: discovered.entries.map((inventoryEntry) => ({ ...inventoryEntry })),
    inventory_parent: discovered.parent
  };
  if (options.expectedSelection?.cache_directory_identity) {
    requireN8nInventorySelectionBinding(options.expectedSelection, discovered);
  } else if (
    options.expectedSelection
    && (
      n8nInventoryDigest(
        options.expectedSelection.parent_directory_identity,
        (options.expectedSelection.inventory_entries || []).filter((entry) =>
          !n8nInventoryIsLockArtifact(entry)
        )
      ) !== n8nInventoryDigest(
        discovered.parent_directory_identity,
        discovered.entries.filter((entry) =>
          !n8nInventoryIsLockArtifact(entry)
        )
      )
      || !n8nDirectoryIdentitiesMatch(
        options.expectedSelection.parent_directory_identity,
        discovered.parent_directory_identity
      )
    )
  ) {
    throw failClosedN8nRepair('ambiguous-target', 'The bounded n8n Skills cache inventory changed before recovery mutation');
  }
  const transactionRoot = normalizedN8nTargetPath(transaction.validated.targetPath);
  if (currentVersion === transaction.validated.version && currentRoot === transactionRoot) {
    revalidateN8nEvidenceAuthority(transaction.evidenceAuthority, {
      boundary: 'before-current-transaction-status',
      testHooks: options.testHooks
    });
    return { status: 'current', currentVersion, currentRoot, selection: boundSelection };
  }
  if (
    options.allowObsolete
    && currentVersion !== transaction.validated.version
    && currentRoot !== transactionRoot
    && currentRootStat
  ) {
    revalidateN8nEvidenceAuthority(transaction.evidenceAuthority, {
      boundary: 'before-obsolete-transaction-status',
      testHooks: options.testHooks
    });
    return {
      status: 'obsolete',
      currentVersion,
      currentRoot,
      selection: {
        ...boundSelection,
        recovery_historical_root: transaction.validated.targetPath
      }
    };
  }
  throw failClosedN8nRepair(
    'selected-version-mismatch',
    'Codex current cache identity does not match the interrupted n8n Skills transaction'
  );
}

function revalidateN8nRecoverySelection(codexHome, selection, options = {}) {
  const configured = inspectCodexConfiguredPluginState({
    codexHome,
    identity: 'n8n-skills@n8n-io'
  });
  if (configured.status !== 'enabled') {
    return {
      status: configured.status === 'disabled' ? 'disabled' : 'ambiguous',
      entry: null,
      reason: 'Codex config fallback changed after obsolete n8n Skills recovery'
    };
  }
  let discovered;
  let candidate;
  try {
    discovered = discoverN8nSkillsCacheRoots(codexHome, {
      targetPaths: [selection.plugin_root],
      testHooks: options.testHooks
    });
    candidate = requireN8nInventorySelectionBinding(selection, discovered, {
      allowRetiredTransactionEvidence: true,
      excludedOrdinaryRoots: selection.recovery_historical_root
        ? [selection.recovery_historical_root]
        : []
    });
  } catch (error) {
    return {
      status: 'ambiguous',
      entry: null,
      reason: error.message || 'The exact config-selected n8n Skills cache inventory changed during obsolete transaction recovery'
    };
  }
  return {
    status: 'selected',
    entry: {
      ...candidate,
      selection_source: 'codex-config-cache-fallback-revalidated',
      selected_version: selection.selected_version,
      directory_version: selection.directory_version,
      cache_directory_identity: candidate.cache_directory_identity,
      parent_directory_identity: discovered.parent_directory_identity,
      inventory_digest: discovered.inventory_digest,
      inventory_entries: discovered.entries.map((inventoryEntry) => ({ ...inventoryEntry })),
      inventory_parent: discovered.parent
    },
    reason: 'Revalidated the exact config-selected current cache after obsolete transaction recovery'
  };
}

function cleanupN8nReplacementTransaction(initialTransaction, options = {}) {
  let transaction = initialTransaction;
  const { generation, validated } = transaction;
  const parityIdentity = options.parityIdentity;
  const winnerEntry = options.winnerEntry || null;
  let finalWinnerProved = false;
  if (!parityIdentity) {
    throw failClosedN8nRepair('recovery-evidence-invalid', 'n8n Skills cleanup is missing its compatibility evidence authority');
  }
  requireExactN8nTargetLockAuthority(
    transaction,
    'replacement-transaction-cleanup',
    options.testHooks
  );
  revalidateN8nEvidenceAuthority(transaction.evidenceAuthority, {
    boundary: 'before-replacement-transaction-cleanup',
    testHooks: options.testHooks
  });
  revalidateN8nJournalAuthority(
    transaction,
    'before-replacement-transaction-cleanup',
    options.testHooks
  );
  const retainedBackupPath =
    transaction.transaction.cleanup_manifest_admission.retirement_path;
  if (
    n8nPathExists(validated.backupPath)
    || n8nPathExists(retainedBackupPath)
  ) {
    if (n8nRecoveryPhaseOrdinal(transaction) < 50) {
      transaction = advanceN8nEvidenceContext(
        transaction,
        'n8n-replacement-phase-50-verify',
        {},
        parityIdentity,
        options.testHooks
      );
    }
    const verifiedTarget = classifyN8nSkillsCompatibility(validated.targetPath);
    if (!n8nCompatibilityEvidenceMatches(
      transaction.transaction.staged_evidence,
      verifiedTarget,
      'healthy'
    )) {
      throw failClosedN8nRepair('verification-failed', 'n8n Skills winner changed before transaction cleanup');
    }
    if (n8nRecoveryPhaseOrdinal(transaction) < 60) {
      transaction = advanceN8nEvidenceContext(
        transaction,
        'n8n-replacement-phase-60-verified',
        {},
        parityIdentity,
        options.testHooks
      );
    }
    if (n8nRecoveryPhaseOrdinal(transaction) < 70) {
      revalidateN8nEvidenceAuthority(transaction.evidenceAuthority, {
        boundary: 'before-backup-cleanup-authorization',
        testHooks: options.testHooks
      });
      const cleanupAuthorization = authorizeN8nWinnerBackupCleanup(
        generation,
        transaction.transaction,
        validated.backupPath,
        validated.targetPath,
        options.testHooks
      );
      transaction = advanceN8nEvidenceContext(
        transaction,
        'n8n-replacement-phase-70-cleanup',
        cleanupAuthorization,
        parityIdentity,
        options.testHooks
      );
    }
    const cleanupPhase = n8nEvidenceValue(
      transaction.evidenceAuthority,
      'n8n-replacement-phase-70-cleanup'
    );
    if (winnerEntry) {
      requireExactN8nFinalWinner(
        winnerEntry,
        transaction.transaction,
        validated.targetPath,
        'Verified recovered n8n Skills winner before backup retirement',
        options.testHooks,
        'phase-70-before-cleanup'
      );
    }
    logicallyRetireExactN8nBackup(
      validated.backupPath,
      transaction.transaction,
      cleanupPhase.backup_residue_manifest,
      {
        resuming: true,
        testHooks: options.testHooks,
        beforeCleanupInspection() {
          requireExactN8nTargetLockAuthority(
            transaction,
            'before-resumable-backup-cleanup-inspection',
            options.testHooks
          );
          revalidateN8nEvidenceAuthority(transaction.evidenceAuthority, {
            boundary: 'before-resumable-backup-cleanup-inspection',
            testHooks: options.testHooks
          });
          revalidateN8nJournalAuthority(
            transaction,
            'before-resumable-backup-cleanup-inspection',
            options.testHooks
          );
        },
        beforeEachCleanupOperation() {
          requireExactN8nTargetLockAuthority(
            transaction,
            'before-each-resumable-backup-cleanup-operation',
            options.testHooks
          );
          revalidateN8nEvidenceAuthority(transaction.evidenceAuthority, {
            boundary: 'before-each-resumable-backup-cleanup-operation',
            testHooks: options.testHooks
          });
          revalidateN8nJournalAuthority(
            transaction,
            'before-each-resumable-backup-cleanup-operation',
            options.testHooks
          );
        },
        beforeFinalCleanupOperation() {
          if (!winnerEntry) return;
          requireExactN8nFinalWinner(
            winnerEntry,
            transaction.transaction,
            validated.targetPath,
            'Verified recovered n8n Skills winner before final backup-root retirement',
            options.testHooks,
            'phase-70-before-final-root-removal'
          );
        },
        afterCleanup() {
          if (!winnerEntry) return;
          requireExactN8nFinalWinner(
            winnerEntry,
            transaction.transaction,
            validated.targetPath,
            'Verified recovered n8n Skills winner after backup retirement',
            options.testHooks,
            'phase-70-after-cleanup'
          );
          finalWinnerProved = true;
        }
      }
    );
  }
  if (winnerEntry && !finalWinnerProved) {
    requireExactN8nFinalWinner(
      winnerEntry,
      transaction.transaction,
      validated.targetPath,
      'Verified recovered n8n Skills winner before terminal completion',
      options.testHooks,
      'terminal-before-completion'
    );
  }
  transaction = advanceN8nTerminalEvidenceContext(
    transaction,
    'completed',
    parityIdentity,
    options.testHooks
  );
  const cleanup = cleanupOwnedGeneration(generation, {
    evidenceAuthority: transaction.evidenceAuthority,
    revalidateEvidenceAuthority(authority, boundary) {
      requireExactN8nTargetLockAuthority(transaction, boundary, options.testHooks);
      return revalidateN8nEvidenceAuthority(authority, {
        boundary,
        testHooks: options.testHooks
      });
    },
    cleanupEvidenceAuthority() {
      return cleanupN8nEvidenceAuthority(transaction, options.testHooks);
    }
  });
  if (cleanup.physicalCleanupError || cleanup.checkpointCleanupError) {
    if (cleanup.checkpointCleanupError) throw cleanup.checkpointCleanupError;
    throw cleanup.physicalCleanupCause || failClosedN8nRepair(
      cleanup.physicalCleanupError,
      'Logically retired n8n Skills transaction has exact physical cleanup pending'
    );
  }
  if (!cleanup.cleaned && !cleanup.logicallyRetired) {
    if (cleanup.error) throw cleanup.error;
    throw failClosedN8nRepair('recovery-cleanup-failed', 'Verified n8n Skills transaction residue could not be removed safely');
  }
  return transaction;
}

function retireFailedN8nWinnerDriftTransaction(transaction, options = {}) {
  requireExactN8nTargetLockAuthority(
    transaction,
    'failed-phase-70-audit-retirement',
    options.testHooks
  );
  const failed = n8nEvidenceEntry(transaction.evidenceAuthority, 'failed');
  const completed = n8nEvidenceEntry(transaction.evidenceAuthority, 'completed');
  if (!failed?.present || completed?.present) {
    throw failClosedN8nRepair(
      'recovery-evidence-invalid',
      'Drifted phase-70 n8n Skills winner lacks exact failed terminal authority'
    );
  }
  revalidateN8nEvidenceAuthority(transaction.evidenceAuthority, {
    boundary: 'before-failed-phase-70-audit-retirement',
    testHooks: options.testHooks
  });
  revalidateN8nJournalAuthority(
    transaction,
    'before-failed-phase-70-audit-retirement',
    options.testHooks
  );
  const cleanup = cleanupOwnedGeneration(transaction.generation, {
    evidenceAuthority: transaction.evidenceAuthority,
    revalidateEvidenceAuthority(authority, boundary) {
      requireExactN8nTargetLockAuthority(transaction, boundary, options.testHooks);
      return revalidateN8nEvidenceAuthority(authority, {
        boundary,
        testHooks: options.testHooks
      });
    },
    cleanupEvidenceAuthority() {
      return cleanupN8nEvidenceAuthority(
        transaction,
        options.testHooks,
        {
          outcome: 'failed-winner-drift-preserved',
          rollbackDigest: transaction.transaction.approval_evidence.tree_digest,
          winnerDigest: ''
        }
      );
    }
  });
  if (cleanup.physicalCleanupError || cleanup.checkpointCleanupError) {
    if (cleanup.checkpointCleanupError) throw cleanup.checkpointCleanupError;
    throw cleanup.physicalCleanupCause || failClosedN8nRepair(
      cleanup.physicalCleanupError,
      'Failed phase-70 n8n Skills audit has exact physical cleanup pending'
    );
  }
  if (!cleanup.cleaned && !cleanup.logicallyRetired) {
    if (cleanup.error) throw cleanup.error;
    throw failClosedN8nRepair(
      'recovery-cleanup-failed',
      'Failed phase-70 n8n Skills audit could not be retired safely'
    );
  }
}

function retireFailedN8nWinnerDriftBackup(transaction, options = {}) {
  requireExactN8nTargetLockAuthority(
    transaction,
    'failed-phase-70-backup-retirement',
    options.testHooks
  );
  const failed = n8nEvidenceEntry(transaction.evidenceAuthority, 'failed');
  const completed = n8nEvidenceEntry(transaction.evidenceAuthority, 'completed');
  const cleanupPhase = n8nEvidenceValue(
    transaction.evidenceAuthority,
    'n8n-replacement-phase-70-cleanup'
  );
  if (
    !failed?.present
    || completed?.present
    || !cleanupPhase?.backup_residue_manifest
  ) {
    throw failClosedN8nRepair(
      'recovery-evidence-invalid',
      'Drifted phase-70 n8n Skills winner lacks exact failed backup-retirement authority'
    );
  }
  const { backupPath } = transaction.validated;
  logicallyRetireExactN8nBackup(
    backupPath,
    transaction.transaction,
    cleanupPhase.backup_residue_manifest,
    {
      resuming: true,
      testHooks: options.testHooks,
      beforeCleanupInspection() {
        requireExactN8nTargetLockAuthority(
          transaction,
          'before-failed-phase-70-backup-inspection',
          options.testHooks
        );
        revalidateN8nEvidenceAuthority(transaction.evidenceAuthority, {
          boundary: 'before-failed-phase-70-backup-inspection',
          testHooks: options.testHooks
        });
        revalidateN8nJournalAuthority(
          transaction,
          'before-failed-phase-70-backup-inspection',
          options.testHooks
        );
      },
      beforeEachCleanupOperation({ index }) {
        requireExactN8nTargetLockAuthority(
          transaction,
          `before-failed-phase-70-backup-operation-${index}`,
          options.testHooks
        );
        revalidateN8nEvidenceAuthority(transaction.evidenceAuthority, {
          boundary: `before-failed-phase-70-backup-operation-${index}`,
          testHooks: options.testHooks
        });
        revalidateN8nJournalAuthority(
          transaction,
          `before-failed-phase-70-backup-operation-${index}`,
          options.testHooks
        );
      },
      afterCleanup() {
        requireExactN8nTargetLockAuthority(
          transaction,
          'after-failed-phase-70-backup-retirement',
          options.testHooks
        );
        revalidateN8nEvidenceAuthority(transaction.evidenceAuthority, {
          boundary: 'after-failed-phase-70-backup-retirement',
          testHooks: options.testHooks
        });
        revalidateN8nJournalAuthority(
          transaction,
          'after-failed-phase-70-backup-retirement',
          options.testHooks
        );
      }
    }
  );
}

function recoverTargetUntouchedN8nPreTransaction({
  codexHome,
  initial,
  parityIdentity,
  pluginInspection,
  stagingLiveness,
  write,
  testHooks
}) {
  const initialHostIdentity = requireN8nRecoveryHostIdentity(codexHome, pluginInspection, initial, {
    allowObsolete: true,
    testHooks
  });
  if (!write) {
    throw failClosedN8nRepair('recovery-required', 'An interrupted owned n8n Skills staging generation requires approved recovery before inspection can continue');
  }
  if (initial.inspected.classification === 'live-owned') {
    throw failClosedN8nRepair('target-lock-contended', 'An owned n8n Skills staging generation is still active; recovery did not mutate it');
  }
  if (!initial.inspected.safe_to_reconcile) {
    throw failClosedN8nRepair('recovery-evidence-invalid', 'Target-untouched n8n Skills ownership evidence is not safe to reconcile');
  }
  const lock = acquireN8nSkillsTargetLock(initial.validated.targetPath);
  let operationError = null;
  try {
    const discovered = inspectN8nReplacementRecords(codexHome, parityIdentity, {
      liveness: stagingLiveness,
      testHooks
    });
    if (discovered.transactions.length !== 0 || discovered.preTransactions.length !== 1) {
      throw failClosedN8nRepair('ambiguous-recovery', 'Target-untouched n8n Skills staging identity changed before recovery');
    }
    let preTransaction = discovered.preTransactions[0];
    if (
      preTransaction.generation.record.generation_id !== initial.generation.record.generation_id
      || preTransaction.generation.record.ownership_token !== initial.generation.record.ownership_token
    ) {
      throw failClosedN8nRepair('recovery-evidence-invalid', 'Target-untouched n8n Skills staging ownership changed before recovery');
    }
    requireN8nEvidenceAuthoritiesEqual(
      initial.evidenceAuthority,
      preTransaction.evidenceAuthority,
      'after-target-lock',
      testHooks
    );
    bindN8nTargetLockAuthority(preTransaction, lock);
    bindAndSynchronizeN8nJournal(preTransaction, {
      write: true,
      testHooks
    });
    requireN8nRecoveryHostIdentity(codexHome, pluginInspection, preTransaction, {
      activeLock: lock,
      allowObsolete: true,
      expectedSelection: initialHostIdentity.selection,
      testHooks
    });
    if (!preTransaction.inspected.safe_to_reconcile) {
      throw failClosedN8nRepair('recovery-evidence-invalid', 'Target-untouched n8n Skills owner is live or indeterminate');
    }
    const { backupPath, stagePath, stagePluginPath, targetPath } = preTransaction.validated;
    if (n8nPathExists(backupPath)) {
      throw failClosedN8nRepair('recovery-evidence-invalid', 'Target-untouched n8n Skills staging conflicts with an exact replacement backup');
    }
    const requireCanonicalTargetUntouched = () => {
      const targetStat = requireOrdinaryN8nDirectory(targetPath, 'canonical n8n Skills target');
      if (!n8nDirectoryIdentitiesMatch(
        preTransaction.preTransaction.original_target_directory_identity,
        n8nDirectoryIdentity(targetStat)
      )) {
        throw failClosedN8nRepair('recovery-evidence-invalid', 'Target-untouched n8n Skills target directory identity changed');
      }
      const targetState = classifyN8nSkillsCompatibility(targetPath);
      if (!n8nCompatibilityEvidenceMatches(
        preTransaction.preTransaction.approval_evidence,
        targetState,
        'repair-required'
      )) {
        throw failClosedN8nRepair('recovery-evidence-invalid', 'Canonical n8n Skills target changed after target-untouched staging began');
      }
      return targetState;
    };
    requireCanonicalTargetUntouched();
    const stageStat = requireOrdinaryN8nDirectory(stagePath, 'owned n8n Skills staging generation');
    if (
      !n8nDirectoryIdentitiesMatch(
        preTransaction.preTransaction.stage_directory_identity,
        n8nDirectoryIdentity(stageStat)
      )
    ) {
      throw failClosedN8nRepair('recovery-evidence-invalid', 'Target-untouched n8n Skills stage directory identity changed');
    }
    if (preTransaction.phases.copied) {
      const stagePluginStat = requireOrdinaryN8nDirectory(stagePluginPath, 'copied n8n Skills staging tree');
      if (!n8nDirectoryIdentitiesMatch(
        preTransaction.phases.copied.staged_plugin_directory_identity,
        n8nDirectoryIdentity(stagePluginStat)
      )) {
        throw failClosedN8nRepair('recovery-evidence-invalid', 'Copied n8n Skills staging tree directory identity changed');
      }
      if (preTransaction.phases.transformed || !preTransaction.phases.transforming) {
        const stagedState = classifyN8nSkillsCompatibility(stagePluginPath);
        const expectedEvidence = preTransaction.phases.transformed
          ? preTransaction.phases.transformed.staged_evidence
          : preTransaction.phases.copied.copied_evidence;
        const expectedStatus = preTransaction.phases.transformed ? 'healthy' : 'repair-required';
        if (!n8nCompatibilityEvidenceMatches(expectedEvidence, stagedState, expectedStatus)) {
          throw failClosedN8nRepair('recovery-evidence-invalid', 'Owned n8n Skills staging tree changed after its durable phase evidence was recorded');
        }
      }
    } else if (preTransaction.phases.transformed || !n8nPathExists(stagePath)) {
      throw failClosedN8nRepair('recovery-evidence-invalid', 'Target-untouched n8n Skills staged-tree evidence is incomplete');
    }
    preTransaction = advanceN8nTerminalEvidenceContext(
      preTransaction,
      'completed',
      parityIdentity,
      testHooks
    );
    const cleanup = cleanupOwnedGeneration(preTransaction.generation, {
      beforeDelete() {
        requireExactN8nTargetLockAuthority(
          preTransaction,
          'target-untouched-owned-stage-cleanup',
          testHooks
        );
        requireCanonicalTargetUntouched();
      },
      evidenceAuthority: preTransaction.evidenceAuthority,
      revalidateEvidenceAuthority(authority, boundary) {
        requireExactN8nTargetLockAuthority(preTransaction, boundary, testHooks);
        return revalidateN8nEvidenceAuthority(authority, { boundary, testHooks });
      },
      cleanupEvidenceAuthority() {
        return cleanupN8nEvidenceAuthority(preTransaction, testHooks);
      }
    });
    if (cleanup.physicalCleanupError || cleanup.checkpointCleanupError) {
      if (cleanup.checkpointCleanupError) throw cleanup.checkpointCleanupError;
      throw cleanup.physicalCleanupCause || failClosedN8nRepair(
        cleanup.physicalCleanupError,
        'Logically retired n8n Skills transaction has exact physical cleanup pending'
      );
    }
    if (!cleanup.cleaned && !cleanup.logicallyRetired) {
      if (cleanup.error) throw cleanup.error;
      throw failClosedN8nRepair('recovery-cleanup-failed', 'Target-untouched n8n Skills staging residue could not be removed safely');
    }
    const reclassified = classifyN8nSkillsCompatibility(targetPath);
    if (!n8nCompatibilityEvidenceMatches(
      preTransaction.preTransaction.approval_evidence,
      reclassified,
      'repair-required'
    )) {
      throw failClosedN8nRepair('verification-failed', 'Canonical n8n Skills target changed while target-untouched staging was cleaned');
    }
    return { status: 'pre-transaction-cleaned' };
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    releaseN8nSkillsTargetLock(lock, testHooks, operationError);
  }
}

function recoverInterruptedN8nReplacement({
  codexHome,
  pluginInspection,
  write,
  compatibilityContract = {},
  stagingLiveness,
  testHooks = {}
}) {
  const parityIdentity = n8nCompatibilityParityIdentity(
    validateN8nSkillsCompatibilityContractParity(compatibilityContract)
  );
  discoverN8nSkillsCacheRoots(codexHome, {
    allowUnclassifiedRegularFiles: true,
    testHooks
  });
  let discovered = inspectN8nReplacementRecords(codexHome, parityIdentity, {
    liveness: stagingLiveness,
    testHooks
  });
  if (
    discovered.retiredTransactions.length > 0
    && discovered.preTransactions.length === 0
    && discovered.transactions.length === 0
  ) {
    if (write) {
      for (const retired of discovered.retiredTransactions) {
        const retiredLock = acquireN8nSkillsTargetLock(retired.validated.targetPath);
        let retiredOperationError = null;
        try {
          bindN8nTargetLockAuthority(retired, retiredLock);
          const cleanup = cleanupN8nEvidenceAuthority(retired, testHooks);
          if (cleanup.physicalCleanupError || cleanup.checkpointCleanupError) {
            if (cleanup.checkpointCleanupError) throw cleanup.checkpointCleanupError;
            throw cleanup.physicalCleanupCause || failClosedN8nRepair(
              cleanup.physicalCleanupError,
              'Logically retired n8n Skills transaction has exact physical cleanup pending'
            );
          }
        } catch (error) {
          retiredOperationError = error;
          throw error;
        } finally {
          releaseN8nSkillsTargetLock(
            retiredLock,
            testHooks,
            retiredOperationError
          );
        }
      }
      discovered = inspectN8nReplacementRecords(codexHome, parityIdentity, {
        liveness: stagingLiveness,
        testHooks
      });
    }
    return {
      status: discovered.retiredTransactions.length
        ? 'physical-cleanup-pending'
        : 'physical-cleanup-complete',
      retiredTransactions: discovered.retiredTransactions
    };
  }
  if (discovered.preTransactions.length === 1) {
    return recoverTargetUntouchedN8nPreTransaction({
      codexHome,
      initial: discovered.preTransactions[0],
      parityIdentity,
      pluginInspection,
      stagingLiveness,
      write,
      testHooks
    });
  }
  if (discovered.transactions.length === 0) return { status: 'none' };
  const initial = discovered.transactions[0];
  const initialHostIdentity = requireN8nRecoveryHostIdentity(codexHome, pluginInspection, initial, {
    allowObsolete: true,
    testHooks
  });
  if (!write) {
    throw failClosedN8nRepair('recovery-required', 'An interrupted owned n8n Skills transaction requires approved recovery before inspection can continue');
  }
  if (initial.inspected.classification === 'live-owned') {
    throw failClosedN8nRepair('target-lock-contended', 'An owned n8n Skills transaction is still active; recovery did not mutate it');
  }
  if (!initial.inspected.safe_to_reconcile) {
    throw failClosedN8nRepair('recovery-evidence-invalid', 'Interrupted n8n Skills ownership evidence is not safe to reconcile');
  }
  const lock = acquireN8nSkillsTargetLock(initial.validated.targetPath);
  let operationError = null;
  try {
    discovered = inspectN8nReplacementRecords(codexHome, parityIdentity, {
      liveness: stagingLiveness,
      testHooks
    });
    if (discovered.transactions.length !== 1) {
      throw failClosedN8nRepair('ambiguous-recovery', 'Interrupted n8n Skills transaction identity changed before recovery');
    }
    let transaction = discovered.transactions[0];
    if (
      transaction.generation.record.generation_id !== initial.generation.record.generation_id
      || transaction.generation.record.ownership_token !== initial.generation.record.ownership_token
    ) {
      throw failClosedN8nRepair('recovery-evidence-invalid', 'Interrupted n8n Skills transaction ownership changed before recovery');
    }
    requireN8nEvidenceAuthoritiesEqual(
      initial.evidenceAuthority,
      transaction.evidenceAuthority,
      'after-target-lock',
      testHooks
    );
    bindN8nTargetLockAuthority(transaction, lock);
    bindAndSynchronizeN8nJournal(transaction, {
      write: true,
      testHooks
    });
    const hostIdentity = requireN8nRecoveryHostIdentity(
      codexHome,
      pluginInspection,
      transaction,
      {
        activeLock: lock,
        allowObsolete: true,
        expectedSelection: initialHostIdentity.selection,
        testHooks
      }
    );
    const { backupPath, stagePluginPath, targetPath } = transaction.validated;
    const targetExists = n8nPathExists(targetPath);
    const backupExists = n8nPathExists(backupPath);
    const stageExists = n8nPathExists(stagePluginPath);
    const targetStat = targetExists ? requireOrdinaryN8nDirectory(targetPath, 'canonical n8n Skills target') : null;
    const backupStat = backupExists ? requireOrdinaryN8nDirectory(backupPath, 'recorded n8n Skills backup') : null;
    const stageStat = stageExists ? requireOrdinaryN8nDirectory(stagePluginPath, 'recorded n8n Skills stage') : null;
    const targetState = targetExists ? classifyN8nSkillsCompatibility(targetPath) : null;
    const backupState = backupExists ? classifyN8nSkillsCompatibility(backupPath) : null;
    const stageState = stageExists ? classifyN8nSkillsCompatibility(stagePluginPath) : null;
    const targetIsOriginal = n8nCompatibilityEvidenceMatches(transaction.transaction.approval_evidence, targetState, 'repair-required');
    const targetIsWinner = n8nCompatibilityEvidenceMatches(transaction.transaction.staged_evidence, targetState, 'healthy');
    const backupIsOriginal = n8nCompatibilityEvidenceMatches(transaction.transaction.approval_evidence, backupState, 'repair-required');
    const stageIsWinner = n8nCompatibilityEvidenceMatches(transaction.transaction.staged_evidence, stageState, 'healthy');
    const targetIsOwnedInstalledDirectory = targetStat && n8nDirectoryIdentitiesMatch(
      transaction.transaction.staged_plugin_directory_identity,
      n8nDirectoryIdentity(targetStat)
    );
    const phaseOrdinal = n8nRecoveryPhaseOrdinal(transaction);
    const isFailedPhase70OwnedWinnerDrift = (
      !targetIsWinner
      && targetIsOwnedInstalledDirectory
      && phaseOrdinal >= 70
    );
    const revalidateBeforeMutation = (boundary) => {
      requireExactN8nTargetLockAuthority(transaction, boundary, testHooks);
      return revalidateN8nEvidenceAuthority(
        transaction.evidenceAuthority,
        { boundary, testHooks }
      );
    };
    const cleanupTransaction = (cleanupOptions = {}) => cleanupN8nReplacementTransaction(transaction, {
      parityIdentity,
      testHooks,
      ...cleanupOptions
    });
    if (
      (
        targetIsOriginal
        && !isFailedPhase70OwnedWinnerDrift
        && !n8nDirectoryIdentitiesMatch(
          transaction.transaction.original_target_directory_identity,
          n8nDirectoryIdentity(targetStat)
        )
      )
      || (backupIsOriginal && !n8nDirectoryIdentitiesMatch(transaction.transaction.original_target_directory_identity, n8nDirectoryIdentity(backupStat)))
      || (targetIsWinner && !n8nDirectoryIdentitiesMatch(transaction.transaction.staged_plugin_directory_identity, n8nDirectoryIdentity(targetStat)))
      || (stageIsWinner && !n8nDirectoryIdentitiesMatch(transaction.transaction.staged_plugin_directory_identity, n8nDirectoryIdentity(stageStat)))
    ) {
      throw failClosedN8nRepair('recovery-evidence-invalid', 'Interrupted n8n Skills directory identity no longer matches the exact owned transaction');
    }

    if (hostIdentity.status === 'obsolete') {
      if (targetIsOriginal && !backupExists) {
        cleanupTransaction();
        return { status: 'obsolete-original-preserved', currentSelection: hostIdentity.selection };
      }
      if (backupIsOriginal && !targetExists) {
        revalidateBeforeMutation('before-obsolete-backup-restoration');
        renameSyncWithRetry(
          backupPath,
          targetPath,
          n8nBackupRestoreRenameOptions(transaction, hostIdentity, backupPath, targetPath, testHooks)
        );
      } else if (
        backupIsOriginal
        && targetIsOwnedInstalledDirectory
        && phaseOrdinal >= 40
      ) {
        revalidateBeforeMutation('before-obsolete-winner-deletion');
        requireN8nDestructiveDeleteBoundary(
          transaction,
          {
            boundary: 'before-obsolete-winner-deletion',
            parents: [{
              identity: hostIdentity.selection.parent_directory_identity,
              label: 'n8n Skills package parent',
              path: path.dirname(targetPath)
            }],
            trees: [{
              evidence: transaction.transaction.staged_evidence,
              fresh: true,
              identity: transaction.transaction.staged_plugin_directory_identity,
              label: 'obsolete installed n8n Skills winner',
              path: targetPath,
              status: 'healthy'
            }]
          },
          testHooks
        );
        fs.rmSync(targetPath, { recursive: true });
        revalidateBeforeMutation('before-obsolete-backup-restoration');
        renameSyncWithRetry(
          backupPath,
          targetPath,
          n8nBackupRestoreRenameOptions(transaction, hostIdentity, backupPath, targetPath, testHooks)
        );
      } else {
        throw failClosedN8nRepair('conflicting-recovery', 'Obsolete n8n Skills transaction cannot be restored without changing an unrelated canonical target');
      }
      const restored = classifyN8nSkillsCompatibility(targetPath);
      if (!n8nCompatibilityEvidenceMatches(transaction.transaction.approval_evidence, restored, 'repair-required')) {
        throw failClosedN8nRepair('verification-failed', 'Obsolete n8n Skills transaction failed exact original restoration verification');
      }
      revalidateBeforeMutation('after-obsolete-original-restoration');
      cleanupTransaction();
      return { status: 'obsolete-original-restored', currentSelection: hostIdentity.selection };
    }

    if (targetIsWinner) {
      if (phaseOrdinal < 30) {
        throw failClosedN8nRepair('recovery-evidence-invalid', 'Installed n8n Skills winner conflicts with the recorded transaction phase');
      }
      if (phaseOrdinal === 30) {
        const installedStat = requireOrdinaryN8nDirectory(
          targetPath,
          'recovered installed n8n Skills winner'
        );
        if (!n8nDirectoryIdentitiesMatch(
          transaction.transaction.staged_plugin_directory_identity,
          n8nDirectoryIdentity(installedStat)
        )) {
          throw failClosedN8nRepair(
            'recovery-evidence-invalid',
            'Recovered installed n8n Skills winner does not match the exact staged identity'
          );
        }
        revalidateN8nJournalAuthority(
          transaction,
          'before-recovered-phase-40-installed',
          testHooks
        );
        transaction = advanceN8nEvidenceContext(
          transaction,
          'n8n-replacement-phase-40-installed',
          {
            installed_directory_identity:
              transaction.transaction.staged_plugin_directory_identity
          },
          parityIdentity,
          testHooks
        );
      }
      if (backupExists && !backupIsOriginal && phaseOrdinal < 70) {
        throw failClosedN8nRepair('recovery-evidence-invalid', 'Recorded n8n Skills backup does not match the approved original tree');
      }
      cleanupTransaction({ winnerEntry: hostIdentity.selection });
      return { status: 'winner-preserved' };
    }
    if (isFailedPhase70OwnedWinnerDrift) {
      if (backupExists) {
        retireFailedN8nWinnerDriftBackup(transaction, { testHooks });
      }
      retireFailedN8nWinnerDriftTransaction(transaction, { testHooks });
      if (backupExists) {
        return {
          status: 'failed-winner-drift-retired',
          currentSelection: hostIdentity.selection
        };
      }
      throw failClosedN8nRepair(
        'final-winner-drift',
        'Failed phase-70 n8n Skills winner audit was retired; drifted canonical bytes were preserved and require a fresh repair'
      );
    }
    if (targetIsOriginal && !backupExists) {
      cleanupTransaction();
      return { status: 'original-preserved' };
    }
    if (!targetIsWinner && targetIsOwnedInstalledDirectory && backupIsOriginal && phaseOrdinal >= 40) {
      requireExactN8nOriginalBackup(backupPath, transaction.transaction);
      revalidateBeforeMutation('before-recovery-failed-winner-deletion');
      requireN8nDestructiveDeleteBoundary(
        transaction,
        {
          boundary: 'before-recovery-failed-winner-deletion',
          parents: [{
            identity: hostIdentity.selection.parent_directory_identity,
            label: 'n8n Skills package parent',
            path: path.dirname(targetPath)
          }],
          trees: [{
            evidence: transaction.transaction.staged_evidence,
            fresh: true,
            identity: transaction.transaction.staged_plugin_directory_identity,
            label: 'failed installed n8n Skills winner',
            path: targetPath,
            status: 'healthy'
          }]
        },
        testHooks
      );
      fs.rmSync(targetPath, { recursive: true });
      revalidateBeforeMutation('before-recovery-backup-restoration');
      renameSyncWithRetry(
        backupPath,
        targetPath,
        n8nBackupRestoreRenameOptions(transaction, hostIdentity, backupPath, targetPath, testHooks)
      );
      const restored = classifyN8nSkillsCompatibility(targetPath);
      if (!n8nCompatibilityEvidenceMatches(transaction.transaction.approval_evidence, restored, 'repair-required')) {
        throw failClosedN8nRepair('verification-failed', 'Recovered n8n Skills original failed exact restoration verification');
      }
      revalidateBeforeMutation('after-recovery-original-restoration');
      cleanupTransaction();
      return { status: 'original-restored' };
    }
    if (targetExists) {
      throw failClosedN8nRepair('conflicting-recovery', 'Canonical n8n Skills target conflicts with the interrupted owned transaction');
    }
    if (!backupIsOriginal) {
      throw failClosedN8nRepair('recovery-evidence-invalid', 'A missing canonical n8n Skills target has no exact verified owned backup');
    }
    if (phaseOrdinal < 10 || phaseOrdinal > 70) {
      throw failClosedN8nRepair('recovery-evidence-invalid', 'Missing canonical n8n Skills target conflicts with the recorded transaction phase');
    }
    if (stageIsWinner && phaseOrdinal <= 30) {
      if (n8nRecoveryPhaseOrdinal(transaction) < 20) {
        transaction = advanceN8nEvidenceContext(
          transaction,
          'n8n-replacement-phase-20-displaced',
          { backup_directory_identity: transaction.transaction.original_target_directory_identity },
          parityIdentity,
          testHooks
        );
      }
      if (n8nRecoveryPhaseOrdinal(transaction) < 30) {
        transaction = advanceN8nEvidenceContext(
          transaction,
          'n8n-replacement-phase-30-install',
          { staged_plugin_directory_identity: transaction.transaction.staged_plugin_directory_identity },
          parityIdentity,
          testHooks
        );
      }
      revalidateBeforeMutation('before-recovered-staged-winner-installation');
      renameSyncWithRetry(
        stagePluginPath,
        targetPath,
        n8nDestructiveRenameOptions(
          transaction,
          {
            absent: [targetPath],
            boundary: 'recovered-staged-winner-installation',
            parents: [
              {
                identity: hostIdentity.selection.parent_directory_identity,
                label: 'n8n Skills package parent',
                path: path.dirname(targetPath)
              },
              {
                identity: transaction.preTransaction.preTransaction.stage_directory_identity,
                label: 'owned n8n Skills stage parent',
                path: transaction.generation.stagePath
              }
            ],
            trees: [
              {
                evidence: transaction.transaction.approval_evidence,
                identity: transaction.transaction.original_target_directory_identity,
                label: 'recorded n8n Skills backup',
                path: backupPath,
                status: 'repair-required'
              },
              {
                evidence: transaction.transaction.staged_evidence,
                identity: transaction.transaction.staged_plugin_directory_identity,
                label: 'recorded n8n Skills stage',
                path: stagePluginPath,
                status: 'healthy'
              }
            ]
          },
          testHooks
        )
      );
      transaction = advanceN8nEvidenceContext(
        transaction,
        'n8n-replacement-phase-40-installed',
        { installed_directory_identity: transaction.transaction.staged_plugin_directory_identity },
        parityIdentity,
        testHooks
      );
      transaction = advanceN8nEvidenceContext(
        transaction,
        'n8n-replacement-phase-50-verify',
        {},
        parityIdentity,
        testHooks
      );
      const installed = classifyN8nSkillsCompatibility(targetPath);
      if (!n8nCompatibilityEvidenceMatches(transaction.transaction.staged_evidence, installed, 'healthy')) {
        requireExactN8nOriginalBackup(backupPath, transaction.transaction);
        const installedStat = requireOrdinaryN8nDirectory(targetPath, 'failed recovered n8n Skills replacement');
        if (!n8nDirectoryIdentitiesMatch(
          transaction.transaction.staged_plugin_directory_identity,
          n8nDirectoryIdentity(installedStat)
        )) {
          throw failClosedN8nRepair('recovery-evidence-invalid', 'Failed recovered n8n Skills target no longer matches the exact staged directory identity');
        }
        revalidateBeforeMutation('before-failed-recovered-target-deletion');
        requireN8nDestructiveDeleteBoundary(
          transaction,
          {
            boundary: 'before-failed-recovered-target-deletion',
            parents: [{
              identity: hostIdentity.selection.parent_directory_identity,
              label: 'n8n Skills package parent',
              path: path.dirname(targetPath)
            }],
            trees: [{
              evidence: transaction.transaction.staged_evidence,
              fresh: true,
              identity: transaction.transaction.staged_plugin_directory_identity,
              label: 'failed recovered n8n Skills winner',
              path: targetPath,
              status: 'healthy'
            }]
          },
          testHooks
        );
        fs.rmSync(targetPath, { recursive: true });
        revalidateBeforeMutation('before-failed-recovered-backup-restoration');
        renameSyncWithRetry(
          backupPath,
          targetPath,
          n8nBackupRestoreRenameOptions(transaction, hostIdentity, backupPath, targetPath, testHooks)
        );
        throw failClosedN8nRepair('verification-failed', 'Recovered n8n Skills winner failed exact installed verification; the original was restored');
      }
      transaction = advanceN8nEvidenceContext(
        transaction,
        'n8n-replacement-phase-60-verified',
        {},
        parityIdentity,
        testHooks
      );
      cleanupTransaction({ winnerEntry: hostIdentity.selection });
      return { status: 'replacement-completed' };
    }
    revalidateBeforeMutation('before-recovery-backup-restoration');
    renameSyncWithRetry(
      backupPath,
      targetPath,
      n8nBackupRestoreRenameOptions(transaction, hostIdentity, backupPath, targetPath, testHooks)
    );
    const restored = classifyN8nSkillsCompatibility(targetPath);
    if (!n8nCompatibilityEvidenceMatches(transaction.transaction.approval_evidence, restored, 'repair-required')) {
      throw failClosedN8nRepair('verification-failed', 'Recovered n8n Skills original failed exact restoration verification');
    }
    revalidateBeforeMutation('after-recovery-original-restoration');
    cleanupTransaction();
    return { status: 'original-restored' };
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    releaseN8nSkillsTargetLock(lock, testHooks, operationError);
  }
}

function revalidateN8nSelectedCacheInventory(entry, options = {}) {
  if (!entry.inventory_digest || !entry.inventory_parent) return null;
  const codexHome = path.resolve(entry.inventory_parent, '..', '..', '..', '..');
  const inventory = discoverN8nSkillsCacheRoots(codexHome, {
    activeLock: options.activeLock,
    targetPaths: [entry.plugin_root],
    testHooks: options.testHooks,
    transaction: options.transaction,
    transactions: entry.retired_transactions || []
  });
  requireN8nInventorySelectionBinding(entry, inventory);
  return inventory;
}

function replaceSelectedN8nSkillsCache(
  generation,
  entry,
  proposal,
  stagedState,
  parityIdentity,
  testHooks = {},
  inventoryOptions = {}
) {
  const targetPath = path.resolve(generation.record.expected_final_target);
  const stagePluginPath = path.join(generation.stagePath, 'plugin');
  const backupPath = n8nReplacementBackupPath(generation);
  if (n8nPathExists(backupPath)) {
    throw failClosedN8nRepair('conflicting-recovery', 'The exact n8n Skills transaction backup target already exists');
  }
  revalidateN8nEvidenceAuthority(inventoryOptions.preTransactionContext.evidenceAuthority, {
    boundary: 'before-replacement-registration',
    testHooks
  });
  revalidateN8nJournalAuthority(
    inventoryOptions.preTransactionContext,
    'before-replacement-registration',
    testHooks
  );
  if (n8nExpectedNextEvidenceKind(inventoryOptions.preTransactionContext) !== 'n8n-replacement') {
    throw failClosedN8nRepair('recovery-evidence-invalid', 'n8n Skills replacement registration attempted to skip staged evidence phases');
  }
  requireExactN8nTargetLockAuthority(
    inventoryOptions.preTransactionContext,
    'replacement-transaction-registration',
    testHooks
  );
  const registeredTransaction = registerN8nReplacementTransaction(
    generation,
    entry,
    proposal,
    stagedState,
    parityIdentity,
    inventoryOptions.preTransactionContext.preTransaction
      .cleanup_manifest_admission
  );
  if (testHooks.afterN8nRepairTransactionRegistration) {
    testHooks.afterN8nRepairTransactionRegistration({ generation, transaction: registeredTransaction });
  }
  let transactionContext = refreshN8nEvidenceContext(
    inventoryOptions.preTransactionContext,
    parityIdentity,
    'n8n-replacement',
    testHooks
  );
  const transaction = transactionContext.transaction;
  revalidateN8nSelectedCacheInventory(entry, {
    activeLock: inventoryOptions.activeLock,
    testHooks,
    transaction: transactionContext
  });
  let backupCreated = false;
  let targetInstalled = false;
  let installedVerified = false;
  try {
    transactionContext = advanceN8nEvidenceContext(transactionContext, 'n8n-replacement-phase-10-displace', {
      original_target_directory_identity: transaction.original_target_directory_identity
    }, parityIdentity, testHooks);
    revalidateN8nEvidenceAuthority(transactionContext.evidenceAuthority, {
      boundary: 'before-canonical-target-displacement',
      testHooks
    });
    renameSyncWithRetry(
      targetPath,
      backupPath,
      n8nDestructiveRenameOptions(
        transactionContext,
        {
          absent: [backupPath],
          boundary: 'canonical-target-displacement',
          parents: [
            {
              identity: entry.parent_directory_identity,
              label: 'n8n Skills package parent',
              path: path.dirname(targetPath)
            },
            {
              identity: transactionContext.preTransaction.preTransaction.stage_directory_identity,
              label: 'owned n8n Skills stage parent',
              path: generation.stagePath
            }
          ],
          trees: [
            {
              evidence: transaction.approval_evidence,
              identity: transaction.original_target_directory_identity,
              label: 'canonical n8n Skills target',
              path: targetPath,
              status: 'repair-required'
            },
            {
              evidence: transaction.staged_evidence,
              identity: transaction.staged_plugin_directory_identity,
              label: 'staged n8n Skills winner',
              path: stagePluginPath,
              status: 'healthy'
            }
          ],
          revalidateExactAuthority() {
            requireExactN8nCleanupAdmissionTree(
              targetPath,
              backupPath,
              transaction.cleanup_manifest_admission
            );
          }
        },
        testHooks,
        testHooks.replaceDirectoryOptions || {}
      )
    );
    backupCreated = true;
    transactionContext = advanceN8nEvidenceContext(transactionContext, 'n8n-replacement-phase-20-displaced', {
      backup_directory_identity: transaction.original_target_directory_identity
    }, parityIdentity, testHooks);
    if (testHooks.afterN8nRepairTargetDisplaced) testHooks.afterN8nRepairTargetDisplaced({ generation });
    transactionContext = advanceN8nEvidenceContext(transactionContext, 'n8n-replacement-phase-30-install', {
      staged_plugin_directory_identity: transaction.staged_plugin_directory_identity
    }, parityIdentity, testHooks);
    revalidateN8nEvidenceAuthority(transactionContext.evidenceAuthority, {
      boundary: 'before-staged-winner-installation',
      testHooks
    });
    renameSyncWithRetry(
      stagePluginPath,
      targetPath,
      n8nDestructiveRenameOptions(
        transactionContext,
        {
          absent: [targetPath],
          boundary: 'staged-winner-installation',
          parents: [
            {
              identity: entry.parent_directory_identity,
              label: 'n8n Skills package parent',
              path: path.dirname(targetPath)
            },
            {
              identity: transactionContext.preTransaction.preTransaction.stage_directory_identity,
              label: 'owned n8n Skills stage parent',
              path: generation.stagePath
            }
          ],
          trees: [
            {
              evidence: transaction.approval_evidence,
              identity: transaction.original_target_directory_identity,
              label: 'recorded n8n Skills backup',
              path: backupPath,
              status: 'repair-required'
            },
            {
              evidence: transaction.staged_evidence,
              identity: transaction.staged_plugin_directory_identity,
              label: 'staged n8n Skills winner',
              path: stagePluginPath,
              status: 'healthy'
            }
          ]
        },
        testHooks,
        testHooks.replaceDirectoryOptions || {}
      )
    );
    if (testHooks.afterN8nRepairStageRenameBeforeInstalledPhase) {
      testHooks.afterN8nRepairStageRenameBeforeInstalledPhase({ generation });
    }
    targetInstalled = true;
    transactionContext = advanceN8nEvidenceContext(transactionContext, 'n8n-replacement-phase-40-installed', {
      installed_directory_identity: transaction.staged_plugin_directory_identity
    }, parityIdentity, testHooks);
    if (testHooks.afterN8nRepairStageInstalled) testHooks.afterN8nRepairStageInstalled({ generation });
    transactionContext = advanceN8nEvidenceContext(
      transactionContext,
      'n8n-replacement-phase-50-verify',
      {},
      parityIdentity,
      testHooks
    );
    if (testHooks.beforeN8nRepairVerification) {
      testHooks.beforeN8nRepairVerification({ pluginRoot: targetPath, proposal: { ...proposal } });
    }
    const verified = classifyN8nSkillsCompatibility(targetPath);
    requireSelectedN8nVersionAgreement(entry, verified);
    if (!n8nCompatibilityEvidenceMatches(transaction.staged_evidence, verified, 'healthy')) {
      throw failClosedN8nRepair(
        'verification-failed',
        `n8n Skills repair verification failed: ${verified.reason || verified.status}`
      );
    }
    transactionContext = advanceN8nEvidenceContext(
      transactionContext,
      'n8n-replacement-phase-60-verified',
      {},
      parityIdentity,
      testHooks
    );
    installedVerified = true;
    if (testHooks.afterN8nRepairVerification) testHooks.afterN8nRepairVerification({ generation });
    requireExactN8nFinalWinnerIdentity(
      transaction,
      targetPath,
      'Verified n8n Skills winner before backup-cleanup authorization'
    );
    revalidateN8nEvidenceAuthority(transactionContext.evidenceAuthority, {
      boundary: 'before-backup-cleanup-authorization',
      testHooks
    });
    const cleanupAuthorization = authorizeN8nWinnerBackupCleanup(
      generation,
      transaction,
      backupPath,
      targetPath,
      testHooks
    );
    transactionContext = advanceN8nEvidenceContext(
      transactionContext,
      'n8n-replacement-phase-70-cleanup',
      cleanupAuthorization,
      parityIdentity,
      testHooks
    );
    if (testHooks.afterN8nBackupCleanupAuthorization) {
      testHooks.afterN8nBackupCleanupAuthorization({ generation });
    }
    requireExactN8nFinalWinner(
      entry,
      transaction,
      targetPath,
      'Verified n8n Skills winner after durable backup-cleanup authorization',
      testHooks,
      'phase-70-before-cleanup'
    );
    const cleanupPhase = n8nEvidenceValue(
      transactionContext.evidenceAuthority,
      'n8n-replacement-phase-70-cleanup'
    );
    let finalWinner = null;
    logicallyRetireExactN8nBackup(
      backupPath,
      transaction,
      cleanupPhase.backup_residue_manifest,
      {
        resuming: true,
        testHooks,
        beforeCleanupInspection() {
          requireExactN8nTargetLockAuthority(
            transactionContext,
            'before-resumable-backup-cleanup-inspection',
            testHooks
          );
          revalidateN8nEvidenceAuthority(transactionContext.evidenceAuthority, {
            boundary: 'before-resumable-backup-cleanup-inspection',
            testHooks
          });
          revalidateN8nJournalAuthority(
            transactionContext,
            'before-resumable-backup-cleanup-inspection',
            testHooks
          );
        },
        beforeEachCleanupOperation() {
          requireExactN8nTargetLockAuthority(
            transactionContext,
            'before-resumable-backup-cleanup-operation',
            testHooks
          );
          revalidateN8nEvidenceAuthority(transactionContext.evidenceAuthority, {
            boundary: 'before-resumable-backup-cleanup-operation',
            testHooks
          });
          revalidateN8nJournalAuthority(
            transactionContext,
            'before-resumable-backup-cleanup-operation',
            testHooks
          );
        },
        beforeFinalCleanupOperation() {
          requireExactN8nFinalWinner(
            entry,
            transaction,
            targetPath,
            'Verified n8n Skills winner before final backup-root retirement',
            testHooks,
            'phase-70-before-final-root-removal'
          );
        },
        afterCleanup() {
          finalWinner = requireExactN8nFinalWinner(
            entry,
            transaction,
            targetPath,
            'Verified n8n Skills winner after backup retirement',
            testHooks,
            'phase-70-after-cleanup'
          );
        }
      }
    );
    if (!finalWinner) {
      throw failClosedN8nRepair(
        'final-winner-drift',
        'n8n Skills backup retirement completed without a final exact winner proof'
      );
    }
    return finalWinner;
  } catch (error) {
    if (installedVerified) {
      error.preserveOwnedStaging = true;
      throw error;
    }
    try {
      const backupAvailable = backupCreated && n8nPathExists(backupPath);
      if (backupCreated && !backupAvailable && targetInstalled) {
        throw failClosedN8nRepair(
          'recovery-evidence-invalid',
          'Failed n8n Skills replacement retained its installed target because the exact original backup is unavailable'
        );
      }
      if (backupAvailable) requireExactN8nOriginalBackup(backupPath, transaction);
      if (targetInstalled && n8nPathExists(targetPath)) {
        revalidateN8nEvidenceAuthority(transactionContext.evidenceAuthority, {
          boundary: 'before-failed-target-deletion',
          testHooks
        });
        const failedTargetStat = requireOrdinaryN8nDirectory(targetPath, 'failed n8n Skills replacement');
        if (!n8nDirectoryIdentitiesMatch(
          transaction.staged_plugin_directory_identity,
          n8nDirectoryIdentity(failedTargetStat)
        )) {
          throw failClosedN8nRepair('recovery-evidence-invalid', 'Failed n8n Skills replacement no longer matches the exact staged directory identity');
        }
        requireN8nDestructiveDeleteBoundary(
          transactionContext,
          {
            boundary: 'before-failed-target-deletion',
            parents: [{
              identity: entry.parent_directory_identity,
              label: 'n8n Skills package parent',
              path: path.dirname(targetPath)
            }],
            trees: [{
              evidence: transaction.staged_evidence,
              fresh: true,
              identity: transaction.staged_plugin_directory_identity,
              label: 'failed n8n Skills replacement',
              path: targetPath,
              status: 'healthy'
            }]
          },
          testHooks
        );
        fs.rmSync(targetPath, { recursive: true });
        if (testHooks.afterN8nRepairFailedTargetRemoved) {
          testHooks.afterN8nRepairFailedTargetRemoved({ generation, transaction });
        }
      }
      if (backupAvailable) {
        revalidateN8nEvidenceAuthority(transactionContext.evidenceAuthority, {
          boundary: 'before-rollback-backup-restoration',
          testHooks
        });
        renameSyncWithRetry(
          backupPath,
          targetPath,
          n8nDestructiveRenameOptions(
            transactionContext,
            {
              absent: [targetPath],
              boundary: 'rollback-backup-restoration',
              parents: [{
                identity: entry.parent_directory_identity,
                label: 'n8n Skills package parent',
                path: path.dirname(targetPath)
              }],
              trees: [{
                evidence: transaction.approval_evidence,
                identity: transaction.original_target_directory_identity,
                label: 'recorded n8n Skills backup',
                path: backupPath,
                status: 'repair-required'
              }]
            },
            testHooks,
            testHooks.replaceDirectoryOptions || {}
          )
        );
        if (testHooks.afterN8nRepairBackupRestored) {
          testHooks.afterN8nRepairBackupRestored({ generation, transaction });
        }
      }
    } catch (rollbackError) {
      error.preserveOwnedStaging = true;
      error.message = `${error.message}; exact rollback could not be completed safely`;
      error.rollbackError = rollbackError;
    }
    throw error;
  }
}

function reconcileSelectedN8nSkillsCache(entry, options = {}) {
  const pluginRoot = path.resolve(entry.plugin_root);
  const write = Boolean(options.write);
  const testHooks = options.testHooks || {};
  const parityIdentity = n8nCompatibilityParityIdentity(
    validateN8nSkillsCompatibilityContractParity(options.compatibilityContract || {})
  );
  const proposal = classifyN8nSkillsCompatibility(pluginRoot);
  if (testHooks.afterN8nCompleteClassification) {
    testHooks.afterN8nCompleteClassification({
      boundary: 'initial-proposal',
      status: proposal.status
    });
  }
  requireSelectedN8nVersionAgreement(entry, proposal);
  const healthyDecision = renderN8nSkillsCompatibilityDecision(proposal, { windows: true });
  if (healthyDecision) return healthyDecision;
  const preview = reconcileN8nSkillsPlugin(pluginRoot, {
    classification: proposal,
    windows: true,
    write: false
  });
  if (!write || proposal.status === 'healthy') return preview;
  if (proposal.status !== 'repair-required') {
    throw new Error(proposal.reason || `n8n Skills compatibility state is ${proposal.status}`);
  }

  const lock = acquireN8nSkillsTargetLock(pluginRoot, testHooks.targetLockOptions || {});
  let operationError = null;
  try {
    if (!entry.parent_directory_identity) {
      entry = {
        ...entry,
        parent_directory_identity: n8nDirectoryIdentity(
          requireOrdinaryN8nDirectory(path.dirname(pluginRoot), 'n8n Skills package parent')
        )
      };
    }
    if (testHooks.afterN8nRepairLockAcquired) {
      testHooks.afterN8nRepairLockAcquired({ pluginRoot, proposal: { ...proposal } });
    }
    if (testHooks.beforeN8nRepairRevalidation) {
      testHooks.beforeN8nRepairRevalidation({ pluginRoot, proposal: { ...proposal } });
    }
    const revalidated = classifyN8nSkillsCompatibility(pluginRoot);
    requireSelectedN8nVersionAgreement(entry, revalidated);
    if (revalidated.status === 'healthy') {
      return renderN8nSkillsCompatibilityDecision(revalidated, { windows: true });
    }
    if (!sameN8nCompatibilityEvidence(proposal, revalidated)) {
      throw failClosedN8nRepair(
        'stale-repair-approval',
        'n8n Skills repair approval is stale because the selected cache changed after inspection'
      );
    }
    revalidateN8nSelectedCacheInventory(entry, {
      activeLock: lock,
      testHooks
    });
    const journalAdmissionPaths = journalPaths(
      entry.inventory_parent
        ? path.resolve(entry.inventory_parent, '..', '..', '..', '..')
        : path.resolve(pluginRoot, '..', '..', '..', '..', '..'),
      pluginRoot,
      '00000000-0000-0000-0000-000000000000'
    );
    if (n8nPathExists(journalAdmissionPaths.target)) {
      const usage = targetJournalUsage(journalAdmissionPaths, { testHooks });
      if (usage.hard_limit) {
        throw failClosedN8nRepair(
          'journal-hard-limit',
          'The target repair journal reached its locked hard storage limit; new staging is blocked'
        );
      }
    }

    const cleanupManifestPreflight = preflightN8nCleanupManifestAdmission(
      pluginRoot,
      testHooks
    );
    requireExactN8nTargetLockAuthority(lock, 'owned-staging-registration', testHooks);
    return withOwnedStaging({
      target: pluginRoot,
      stagePrefix: `.${path.basename(pluginRoot)}.staging-`,
      operation: 'n8n-skills-plugin-repair',
      sourceType: 'codex-plugin',
      completeOwnedStaging(generation) {
        const context = generation[N8N_EVIDENCE_CONTEXT];
        if (!context) {
          throw failClosedN8nRepair('recovery-evidence-invalid', 'Completed n8n Skills repair lost its exact evidence authority');
        }
        generation[N8N_EVIDENCE_CONTEXT] = advanceN8nTerminalEvidenceContext(
          context,
          'completed',
          parityIdentity,
          testHooks
        );
      },
      failOwnedStaging(generation) {
        const context = generation[N8N_EVIDENCE_CONTEXT];
        if (context) {
          generation[N8N_EVIDENCE_CONTEXT] = advanceN8nTerminalEvidenceContext(
            context,
            'failed',
            parityIdentity,
            testHooks
          );
        } else {
          requireExactN8nTargetLockAuthority(lock, 'unbound-staging-failure-transition', testHooks);
          markOwnedStaging(generation, 'failed');
        }
      },
      cleanupOwnedStaging(generation) {
        const context = generation[N8N_EVIDENCE_CONTEXT];
        if (!context) {
          return cleanupOwnedGeneration(generation, {
            beforeDelete() {
              requireExactN8nTargetLockAuthority(lock, 'unbound-owned-staging-cleanup', testHooks);
            },
            currentOperation: true,
            auxiliaryKinds: N8N_TRANSACTION_AUXILIARY_KINDS
          });
        }
        return cleanupOwnedGeneration(generation, {
          evidenceAuthority: context.evidenceAuthority,
          revalidateEvidenceAuthority(authority, boundary) {
            requireExactN8nTargetLockAuthority(context, boundary, testHooks);
            return revalidateN8nEvidenceAuthority(authority, { boundary, testHooks });
          },
          cleanupEvidenceAuthority() {
            return cleanupN8nEvidenceAuthority(context, testHooks);
          }
        });
      }
    }, (stagePath, generation) => {
      const stagedPluginRoot = path.join(stagePath, 'plugin');
      requireExactN8nTargetLockAuthority(lock, 'pre-transaction-registration', testHooks);
      const preTransaction = registerN8nPreTransaction(
        generation,
        entry,
        proposal,
        parityIdentity,
        cleanupManifestPreflight
      );
      if (testHooks.afterN8nPreTransactionEvidenceWritten) {
        testHooks.afterN8nPreTransactionEvidenceWritten({ generation, preTransaction });
      }
      let preTransactionContext = inspectN8nReplacementRecords(
        path.resolve(generation.record.expected_parent, '..', '..', '..', '..'),
        parityIdentity,
        {
          liveness: () => 'dead',
          testHooks
        }
      ).preTransactions[0];
      if (!preTransactionContext) {
        throw failClosedN8nRepair('recovery-evidence-invalid', 'New n8n Skills pre-transaction evidence could not be bound');
      }
      bindN8nTargetLockAuthority(preTransactionContext, lock);
      bindAndSynchronizeN8nJournal(preTransactionContext, {
        write: true,
        testHooks
      });
      preTransactionContext[N8N_EVIDENCE_LIFECYCLE_OWNER] = generation;
      retainN8nEvidenceContext(preTransactionContext);
      if (testHooks.afterN8nPreTransactionRegistration) {
        testHooks.afterN8nPreTransactionRegistration({ generation, preTransaction });
      }
      revalidateN8nSelectedCacheInventory(entry, {
        activeLock: lock,
        testHooks,
        transaction: preTransactionContext
      });
      revalidateN8nEvidenceAuthority(preTransactionContext.evidenceAuthority, {
        boundary: 'before-candidate-staging',
        testHooks
      });
      revalidateN8nJournalAuthority(
        preTransactionContext,
        'before-candidate-staging',
        testHooks
      );
      if (testHooks.duringN8nRepairStageCopy) {
        testHooks.duringN8nRepairStageCopy({ generation, pluginRoot, stagedPluginRoot });
      }
      requireExactN8nTargetLockAuthority(preTransactionContext, 'candidate-staging-copy', testHooks);
      fs.cpSync(pluginRoot, stagedPluginRoot, { recursive: true });
      const copiedState = classifyN8nSkillsCompatibility(stagedPluginRoot);
      if (!sameN8nCompatibilityEvidence(proposal, copiedState)) {
        throw failClosedN8nRepair('verification-failed', 'n8n Skills staged copy does not match the exact approved original tree');
      }
      const stagedPluginDirectoryIdentity = n8nDirectoryIdentity(
        requireOrdinaryN8nDirectory(stagedPluginRoot, 'copied n8n Skills staging tree')
      );
      preTransactionContext = advanceN8nEvidenceContext(preTransactionContext, 'n8n-pre-transaction-phase-10-copied', {
        copied_evidence: {
          status: copiedState.status,
          adapter_id: copiedState.adapter_id,
          version: copiedState.version,
          contract_digest: copiedState.contract_digest,
          tree_digest: copiedState.tree_digest,
          preserved_tree_digest: copiedState.preserved_tree_digest
        },
        staged_plugin_directory_identity: stagedPluginDirectoryIdentity
      }, parityIdentity, testHooks);
      preTransactionContext = advanceN8nEvidenceContext(preTransactionContext, 'n8n-pre-transaction-phase-15-transforming', {
        staged_plugin_directory_identity: stagedPluginDirectoryIdentity
      }, parityIdentity, testHooks);
      if (testHooks.duringN8nRepairStageTransformation) {
        testHooks.duringN8nRepairStageTransformation({ generation, pluginRoot, stagedPluginRoot });
      }
      requireExactN8nTargetLockAuthority(preTransactionContext, 'staged-tree-transformation', testHooks);
      revalidateN8nEvidenceAuthority(preTransactionContext.evidenceAuthority, {
        boundary: 'before-staged-tree-transformation',
        testHooks
      });
      revalidateN8nJournalAuthority(
        preTransactionContext,
        'before-staged-tree-transformation',
        testHooks
      );
      const stagedRepair = reconcileN8nSkillsPlugin(stagedPluginRoot, { windows: true, write: true });
      const stagedState = classifyN8nSkillsCompatibility(stagedPluginRoot);
      if (
        stagedState.status !== 'healthy'
        || stagedState.adapter_id !== proposal.adapter_id
        || stagedState.version !== proposal.version
        || stagedState.preserved_tree_digest !== proposal.preserved_tree_digest
      ) {
        throw failClosedN8nRepair('verification-failed', 'n8n Skills staged repair verification failed');
      }
      preTransactionContext = advanceN8nEvidenceContext(preTransactionContext, 'n8n-pre-transaction-phase-20-transformed', {
        staged_evidence: {
          status: stagedState.status,
          adapter_id: stagedState.adapter_id,
          version: stagedState.version,
          contract_digest: stagedState.contract_digest,
          tree_digest: stagedState.tree_digest,
          preserved_tree_digest: stagedState.preserved_tree_digest
        },
        staged_plugin_directory_identity: stagedPluginDirectoryIdentity
      }, parityIdentity, testHooks);

      if (testHooks.beforeN8nRepairReplacement) {
        testHooks.beforeN8nRepairReplacement({ pluginRoot, stagedPluginRoot, proposal: { ...proposal } });
      }
      const immediatelyBeforeWrite = classifyN8nSkillsCompatibility(pluginRoot);
      requireSelectedN8nVersionAgreement(entry, immediatelyBeforeWrite);
      if (!sameN8nCompatibilityEvidence(proposal, immediatelyBeforeWrite)) {
        throw failClosedN8nRepair(
          'stale-repair-approval',
          'n8n Skills repair approval is stale because the selected cache changed before replacement'
        );
      }

      if (testHooks.beforeN8nRepairTransactionRegistration) {
        testHooks.beforeN8nRepairTransactionRegistration({ generation, pluginRoot, stagedPluginRoot });
      }
      const replacement = replaceSelectedN8nSkillsCache(
        generation,
        entry,
        proposal,
        stagedState,
        parityIdentity,
        testHooks,
        { activeLock: lock, preTransactionContext }
      );
      try {
        if (testHooks.beforeN8nRepairSuccessReturn) {
          testHooks.beforeN8nRepairSuccessReturn({ generation, pluginRoot });
        }
        const finalStat = requireOrdinaryN8nDirectory(
          pluginRoot,
          'verified n8n Skills winner at the success return boundary'
        );
        if (!n8nDirectoryIdentitiesMatch(
          replacement.directory_identity,
          n8nDirectoryIdentity(finalStat)
        )) {
          throw failClosedN8nRepair(
            'final-winner-drift',
            'Verified n8n Skills winner identity changed at the success return boundary'
          );
        }
        const finalState = classifyN8nSkillsCompatibility(pluginRoot);
        requireSelectedN8nVersionAgreement(entry, finalState);
        if (!n8nCompatibilityEvidenceMatches(stagedState, finalState, 'healthy')) {
          throw failClosedN8nRepair(
            'final-winner-drift',
            `Verified n8n Skills winner changed at the success return boundary: ${finalState.reason || finalState.status}`
          );
        }
        return {
          ...finalState,
          status: 'repaired',
          repaired: true,
          actions: stagedRepair.actions || []
        };
      } catch (error) {
        error.preserveOwnedStaging = true;
        if (error.code === 'final-winner-drift') throw error;
        const drift = failClosedN8nRepair(
          'final-winner-drift',
          'Verified n8n Skills winner could not be proven at the success return boundary'
        );
        drift.cause = error;
        drift.preserveOwnedStaging = true;
        throw drift;
      }
    });
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    releaseN8nSkillsTargetLock(lock, testHooks, operationError);
  }
}

function repairThirdPartyCodexPluginHooks(options = {}) {
  const codexHome = path.resolve(options.codexHome || defaultCodexHome());
  const platform = options.platform || process.platform;
  const windows = options.windows ?? platform === 'win32';
  const write = Boolean(options.write);
  if (!windows) {
    return {
      status: 'not-supported',
      code: 'not-supported',
      codex_home: codexHome,
      write,
      scanned: 0,
      skipped: [],
      repaired: [],
      unchanged: [],
      errors: []
    };
  }
  const currentPluginRoot = options.currentPluginRoot || runtimeCodexPluginRoot();
  const pluginInspection = Object.prototype.hasOwnProperty.call(options, 'pluginList')
    ? { ok: true, pluginList: options.pluginList, errors: [] }
    : inspectCodexPluginList({ codexCommand: options.codexCommand || '' });
  let recoveryResult = { status: 'none' };
  try {
    recoveryResult = recoverInterruptedN8nReplacement({
      codexHome,
      pluginInspection,
      write,
      compatibilityContract: options.compatibilityContract || {},
      testHooks: options.testHooks || {}
    });
  } catch (error) {
    return {
      status: error.code === 'disabled' ? 'not-needed' : 'repair-failed',
      code: error.code || 'recovery-failed',
      codex_home: codexHome,
      write,
      scanned: 0,
      skipped: [],
      repaired: [],
      unchanged: [],
      errors: error.code === 'disabled' ? [] : [error.message],
      selection_status: error.code === 'disabled' ? 'disabled' : (error.code || 'recovery-failed')
    };
  }
  let n8nDiscovery;
  try {
    n8nDiscovery = discoverN8nSkillsCacheRoots(codexHome, {
      targetPaths: [
        ...n8nTargetPathsFromPluginInspection(codexHome, pluginInspection),
        ...(recoveryResult.currentSelection?.plugin_root
          ? [recoveryResult.currentSelection.plugin_root]
          : [])
      ],
      transactions: recoveryResult.retiredTransactions || [],
      testHooks: options.testHooks || {}
    });
  } catch (error) {
    return {
      status: 'repair-failed',
      code: error.code || 'ambiguous-target',
      codex_home: codexHome,
      write,
      scanned: 0,
      skipped: [],
      repaired: [],
      unchanged: [],
      errors: [error.message],
      selection_status: error.code || 'ambiguous-target'
    };
  }
  const broadDiscovery = discoverCodexPluginHookRoots({ codexHome, currentPluginRoot });
  const discovered = {
    roots: [
      ...broadDiscovery.roots.filter((entry) => entry.plugin_id !== 'n8n-skills@n8n-io'),
      ...n8nDiscovery.roots
    ],
    skipped: broadDiscovery.skipped
  };
  const result = {
    status: 'not-needed',
    code: 'not-needed',
    codex_home: codexHome,
    write,
    scanned: 0,
    skipped: discovered.skipped,
    repaired: [],
    unchanged: [],
    errors: []
  };

  const n8nCandidates = [...n8nDiscovery.roots];
  for (const entry of discovered.roots) {
    if (entry.plugin_id === 'n8n-skills@n8n-io') continue;
    else result.skipped.push({ ...entry, reason: 'unrelated plugin; n8n Skills reconciliation is target-specific' });
  }
  if (n8nCandidates.length === 0) {
    result.skipped.sort((left, right) => left.plugin_root.localeCompare(right.plugin_root));
    return result;
  }

  const selection = recoveryResult.currentSelection?.selection_source === 'codex-config-cache-fallback'
    ? revalidateN8nRecoverySelection(codexHome, recoveryResult.currentSelection, {
      testHooks: options.testHooks || {}
    })
    : selectCurrentN8nSkillsCacheIdentity({
      codexHome,
      pluginInspection,
      discovered: n8nDiscovery
    });
  result.selection_status = selection.status === 'ambiguous'
    ? 'ambiguous-target'
    : selection.status === 'missing'
      ? 'identity-unverified'
      : selection.status;
  result.code = result.selection_status;
  if (selection.status !== 'selected') {
    for (const entry of n8nCandidates) {
      result.skipped.push({ ...entry, reason: 'historical or unverified n8n Skills cache; not current according to Codex installed state' });
    }
    result.skipped.sort((left, right) => left.plugin_root.localeCompare(right.plugin_root));
    if (selection.status === 'not-installed' || selection.status === 'disabled') return result;
    result.status = 'repair-failed';
    result.code = result.selection_status;
    result.errors = [
      selection.reason,
      ...(!pluginInspection.ok ? (pluginInspection.errors || []) : [])
    ].slice(0, THIRD_PARTY_HOOK_REPAIR_ERROR_LIMIT);
    return result;
  }

  Object.defineProperty(selection.entry, 'retired_transactions', {
    configurable: false,
    enumerable: false,
    value: recoveryResult.retiredTransactions || [],
    writable: false
  });
  const targets = [selection.entry];
  for (const entry of n8nCandidates) {
    if (path.resolve(entry.plugin_root) === path.resolve(selection.entry.plugin_root)) continue;
    result.skipped.push({ ...entry, reason: 'historical n8n Skills cache; not current according to Codex installed state' });
  }
  result.scanned = 1;
  result.skipped.sort((left, right) => left.plugin_root.localeCompare(right.plugin_root));

  for (const entry of targets) {
    try {
      if (write) {
        finalizeOrphanedN8nPhysicalCleanup(
          codexHome,
          entry.plugin_root,
          options.testHooks || {}
        );
      }
      const repair = reconcileSelectedN8nSkillsCache(entry, {
        write,
        testHooks: options.testHooks || {}
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
      if (error.code) result.code = error.code;
      result.errors.push(`${entry.plugin_id}: ${error.message}`);
    }
  }

  if (result.errors.length && result.repaired.length) result.status = 'partial-failed';
  else if (result.errors.length) result.status = 'repair-failed';
  else if (result.repaired.length) result.status = 'repaired';
  else result.status = 'not-needed';
  if (!result.errors.length) result.code = result.status;
  else if (result.code === result.selection_status) {
    result.code = result.errors.some((message) => /verification failed/i.test(message))
      ? 'verification-failed'
      : result.status;
  }
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
  discoverN8nSkillsCacheRoots,
  finalizeOrphanedN8nPhysicalCleanup,
  repairThirdPartyCodexPluginHooks,
  recoverInterruptedN8nReplacement,
  reconcileSelectedN8nSkillsCache,
  n8nSkillsTargetLockIdentity,
  requireN8nCleanupManifestByteAdmission,
  requireN8nRetainedQuarantineCapacity
};
