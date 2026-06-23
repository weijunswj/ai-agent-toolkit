#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { verifyInstalledCacheFreshness } = require('./setup-codex-toolkit-plugin.cjs');

const ARCHITECTURE_VERSION = 2;
const BRIDGE_VERSION = '2.2.0';
const STATE_SCHEMA_VERSION = 1;
const TOOLKIT_NAME = 'ai-agent-toolkit';
const SUPPORTED_TARGETS = ['opencode', 'ag2'];
const LOCK_STALE_MS = 10 * 60 * 1000;
const DEFAULT_REPO_BRANCH = 'main';
const DEFAULT_REPO_REMOTE = 'https://github.com/weijunswj/ai-agent-toolkit';
const TARGET_MANIFEST_FILE = '.ai-agent-toolkit-managed.json';
const TARGET_MANIFEST_MARKER = 'ai-agent-toolkit-local-bridge';
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UPDATE_REPORT_ROOT = path.join('ai-agent-toolkit', 'update-reports');
const FULL_VALIDATION_TEST = path.join('repo', 'tests', 'toolkit-local-bridge.test.cjs');
const HOOK_LIGHT_VALIDATION_TEST = path.join('repo', 'tests', 'toolkit-local-bridge-hook-light.test.cjs');
const VALIDATE_TOOLKIT_TIMEOUT_MS = 120000;
const HOOK_LIGHT_VALIDATION_TIMEOUT_MS = 30000;
const NATIVE_PLUGIN_CACHE_REPORT_ERROR_LIMIT = 5;

function slash(value) {
  return value.split(path.sep).join('/');
}

function timestamp() {
  return new Date().toISOString();
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
    enableUpdateReportOpen: false,
    disableUpdateReportOpen: false,
    suppressUpdateReport: false,
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
    else if (arg === '--enable-update-report-open') args.enableUpdateReportOpen = true;
    else if (arg === '--disable-update-report-open') args.disableUpdateReportOpen = true;
    else if (arg === '--suppress-update-report') args.suppressUpdateReport = true;
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
  if (!['repo', 'codex-plugin', 'claude-plugin'].includes(args.syncSource)) {
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
  return args;
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
    '  --enable-update-report-open persist opt-in opening of generated update reports',
    '  --disable-update-report-open',
    '  --audit',
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
  if (currentBranch !== branch) {
    throw repoUpdateError('skipped', `configured repo branch mismatch: expected ${branch}, got ${currentBranch}`, {
      error: 'branch mismatch'
    });
  }
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
  const fromCommit = requireGit(repoPath, ['rev-parse', 'HEAD'], 'read current commit');
  const fetchResult = gitCommand(repoPath, ['fetch', 'origin', branch], { timeout: 120000 });
  if (!fetchResult.ok) {
    throw repoUpdateError('skipped', `git fetch origin ${branch} failed: ${commandOutput(fetchResult)}`, {
      fromCommit,
      error: 'fetch failed'
    });
  }
  const fetchedCommit = requireGit(repoPath, ['rev-parse', 'FETCH_HEAD'], 'read fetched commit');
  const ancestor = gitCommand(repoPath, ['merge-base', '--is-ancestor', fromCommit, fetchedCommit]);
  if (!ancestor.ok) {
    throw repoUpdateError('skipped', 'fetched update is not a fast-forward from the current repo commit', {
      fromCommit,
      toCommit: fetchedCommit,
      error: 'not fast-forward'
    });
  }
  if (fromCommit !== fetchedCommit) {
    const merge = gitCommand(repoPath, ['merge', '--ff-only', 'FETCH_HEAD'], { timeout: 120000 });
    if (!merge.ok) {
      throw repoUpdateError('skipped', `git merge --ff-only FETCH_HEAD failed: ${commandOutput(merge)}`, {
        fromCommit,
        toCommit: fetchedCommit,
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
    update_report_open_enabled: false,
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
  state.update_report_open_enabled = state.update_report_open_enabled === true;
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
  if (args.enableUpdateReportOpen) next.update_report_open_enabled = true;
  if (args.disableUpdateReportOpen) next.update_report_open_enabled = false;
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

function adapterPayloads(state = {}) {
  const sourceRoot = resolveToolkitSourceRoot(state);
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

function sourceCommit() {
  const root = pluginRootFromCwd() || path.resolve(__dirname, '..', '..');
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 3000, windowsHide: true });
  return result.status === 0 ? result.stdout.trim() : 'unknown';
}

function currentToolkitCommit(state = {}) {
  const root = state.repo_path ? path.resolve(state.repo_path) : (pluginRootFromCwd() || path.resolve(__dirname, '..', '..'));
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 3000, windowsHide: true });
  return result.status === 0 ? result.stdout.trim() : 'unknown';
}

function updateReportDir() {
  return path.join(os.tmpdir(), ...UPDATE_REPORT_ROOT.split('/'));
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

function isUpdateReportPath(reportPath) {
  const resolved = path.resolve(reportPath || '');
  const reportDir = path.resolve(updateReportDir());
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
  if (!isUpdateReportPath(resolved)) return { ok: false, skipped: 'unsafe-report-path' };
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

function shouldConsiderUpdateReport(args, state) {
  return Boolean(
    !args.suppressUpdateReport &&
    (
      args.hook ||
      args.repoUpdateNow ||
      args.openUpdateReport ||
      state.update_report_open_enabled ||
      isLegacyDelegatedRepoSync(args)
    )
  );
}

function updateReportIsMeaningful(context) {
  const repoStatus = context.repo?.status || '';
  if (repoStatus === 'updated') return true;
  if (repoStatus === 'validation-failed') return true;
  if (repoStatus === 'sync-delegation-failed') return true;
  if (repoStatus === 'skipped' && context.repo?.error) return true;
  if (context.nativePluginCache?.status === 'stale') return true;
  if ((context.targetSyncs || []).length) return true;
  return (context.targetSyncs || []).some((entry) => (entry.removedSkillNames || []).length);
}

function buildUpdateReport({ args, state, checksum, context }) {
  const repo = context.repo || {};
  const targetSyncs = context.targetSyncs || [];
  const skippedTargets = context.skippedTargets || [];
  const nativePluginCache = context.nativePluginCache || {};
  const warning = repo.error || context.warning || '';
  const commit = repo.toCommit || currentToolkitCommit(state);
  const previousCommit = repo.fromCommit || 'none';
  const validationStatus = repo.validationStatus || repo.validation?.status || (repo.status ? 'not run' : 'not run');
  const targetSyncStatus = context.targetSyncStatus || (targetSyncs.length ? 'synced' : 'not needed');
  const lines = [
    '# AI Agent Toolkit Update',
    '',
    `Toolkit updated to commit: ${inlineCode(commit)}`,
    `Previous commit: ${inlineCode(previousCommit)}`,
    `Source: ${inlineCode(args.syncSource)}`,
    `Timestamp: ${inlineCode(context.timestamp || timestamp())}`,
    '',
    "## What's Updated",
    ''
  ];

  if ((repo.changedFiles || []).length) {
    for (const file of repo.changedFiles) lines.push(`- ${inlineCode(slash(file))}`);
  } else if (targetSyncs.length && (!repo.fromCommit || repo.fromCommit === repo.toCommit)) {
    lines.push('- No repo commit change; local bridge target state was stale.');
  } else if (repo.status && repo.status !== 'updated') {
    lines.push('- No repo commit change; repo auto-update skipped safely.');
  } else {
    lines.push('- No repo commit change.');
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
  if (nativePluginCache.status === 'stale') {
    lines.push('- Codex native plugin cache is stale. Run `setup toolkit` to refresh Codex plugin skills, hooks, and metadata.');
  }
  lines.push('- Skipped n8n/live systems; not touched.');

  lines.push('', '## Validation', '');
  lines.push(`- repo update status: ${inlineCode(repo.status || 'not run')}`);
  lines.push(`- hook-light validation: ${inlineCode(validationStatus)}`);
  lines.push(`- target sync status: ${inlineCode(targetSyncStatus)}`);
  if (nativePluginCache.status) {
    lines.push(`- Codex native plugin cache: ${inlineCode(nativePluginCache.status)}`);
    for (const error of nativePluginCache.errors || []) lines.push(`  - ${inlineCode(error)}`);
  }
  lines.push(`- checksum: ${inlineCode(checksum)}`);
  if (warning) lines.push(`- warning/error: ${inlineCode(warning)}`);
  return `${lines.join('\n')}\n`;
}

function writeUpdateReportFile(markdown) {
  const reportPath = nextUpdateReportPath();
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, markdown, 'utf8');
  return reportPath;
}

function maybeWriteUpdateReport({ args, hubPath, state, checksum, context }) {
  if (!shouldConsiderUpdateReport(args, state) || !updateReportIsMeaningful(context)) {
    return { state, reportPath: '' };
  }
  const reportContext = { ...context, timestamp: context.timestamp || timestamp() };
  const markdown = buildUpdateReport({ args, state, checksum, context: reportContext });
  const reportPath = writeUpdateReportFile(markdown);
  state.last_update_report_path = reportPath;
  writeJson(path.join(hubPath, 'state.json'), state);
  if (args.openUpdateReport || state.update_report_open_enabled) {
    openUpdateReport(reportPath);
  }
  return { state, reportPath };
}

function printUpdateReportLine(args, reportPath) {
  if (!reportPath) return;
  if (args.hook) console.log(`Toolkit updated: ${reportPath}`);
  else console.log(`Toolkit update report: ${reportPath}`);
}

function buildManifest({ state, discoveries, checksum, syncSource, hubPath }) {
  return {
    name: 'ai-agent-toolkit-local-bridge',
    architecture_version: ARCHITECTURE_VERSION,
    bridge_version: BRIDGE_VERSION,
    checksum,
    source_commit: sourceCommit(),
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
  const next = normalizedState(state);
  next.schema_version = STATE_SCHEMA_VERSION;
  next.architecture_version = ARCHITECTURE_VERSION;
  next.hub_version = BRIDGE_VERSION;
  next.created_at = next.created_at || timestamp();
  next.updated_at = timestamp();
  next.last_sync_source = args.syncSource;
  return next;
}

function writePayloadTree(rootDir, payload) {
  for (const [rel, text] of Object.entries(payload)) {
    const target = path.join(rootDir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, payloadBytes(text));
  }
}

function writeHubSnapshot({ hubPath, args, state, discoveries, checksum, payloads }) {
  const stagePath = path.join(path.dirname(hubPath), `.staging-${process.pid}-${Date.now()}`);
  if (fs.existsSync(stagePath)) fs.rmSync(stagePath, { recursive: true, force: true });
  fs.mkdirSync(stagePath, { recursive: true });
  writePayloadTree(path.join(stagePath, 'adapters', 'opencode'), payloads.opencode);
  writePayloadTree(path.join(stagePath, 'adapters', 'ag2'), payloads.ag2);
  writeJson(path.join(stagePath, 'manifest.json'), buildManifest({
    state,
    discoveries,
    checksum,
    syncSource: args.syncSource,
    hubPath
  }));
  writeJson(path.join(stagePath, 'state.json'), state);
  validateStagedHub(stagePath, checksum);
  replaceDirectoryAtomically(stagePath, hubPath);
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

function acquireLock(hubRoot, args) {
  fs.mkdirSync(hubRoot, { recursive: true });
  const lockPath = path.join(hubRoot, 'update.lock');
  if (fs.existsSync(lockPath)) {
    const lock = readJsonIfExists(lockPath) || {};
    const age = Date.now() - Date.parse(lock.created_at || 0);
    if (Number.isFinite(age) && age < LOCK_STALE_MS) {
      const message = `fresh Toolkit bridge lock exists at ${lockPath}`;
      if (args.hook) return { acquired: false, lockPath, skipReason: message };
      throw new Error(message);
    }
    fs.rmSync(lockPath, { force: true });
  }
  writeJson(lockPath, {
    created_at: timestamp(),
    pid: process.pid,
    bridge_version: BRIDGE_VERSION,
    sync_source: args.syncSource
  });
  return { acquired: true, lockPath };
}

function releaseLock(lock) {
  if (lock?.acquired && lock.lockPath) fs.rmSync(lock.lockPath, { force: true });
}

function replaceDirectoryAtomically(sourceDir, targetDir) {
  const parent = path.dirname(targetDir);
  fs.mkdirSync(parent, { recursive: true });
  const backup = path.join(parent, `.${path.basename(targetDir)}.backup-${process.pid}-${Date.now()}`);
  if (fs.existsSync(backup)) fs.rmSync(backup, { recursive: true, force: true });
  if (fs.existsSync(targetDir)) fs.renameSync(targetDir, backup);
  try {
    fs.renameSync(sourceDir, targetDir);
  } catch (error) {
    if (fs.existsSync(backup) && !fs.existsSync(targetDir)) fs.renameSync(backup, targetDir);
    throw error;
  }
  if (fs.existsSync(backup)) fs.rmSync(backup, { recursive: true, force: true });
}

function copyDirectoryAtomically(sourceDir, targetDir, requiredRelPath = 'SKILL.md') {
  const parent = path.dirname(targetDir);
  fs.mkdirSync(parent, { recursive: true });
  const staging = path.join(parent, `.${path.basename(targetDir)}.staging-${process.pid}-${Date.now()}`);
  if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
  fs.cpSync(sourceDir, staging, { recursive: true });
  if (requiredRelPath && !fs.existsSync(path.join(staging, requiredRelPath))) {
    throw new Error(`staged target missing ${requiredRelPath}: ${staging}`);
  }
  replaceDirectoryAtomically(staging, targetDir);
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

function writeSkillPayloadAtomically(targetPath, baseRel, payload) {
  const targetDir = path.join(targetPath, ...slash(baseRel).split('/'));
  const parent = path.dirname(targetDir);
  fs.mkdirSync(parent, { recursive: true });
  const staging = path.join(parent, `.${path.basename(targetDir)}.staging-${process.pid}-${Date.now()}`);
  if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  writePayloadTree(staging, payload);
  if (!fs.existsSync(path.join(staging, 'SKILL.md'))) {
    throw new Error(`staged target skill missing SKILL.md: ${staging}`);
  }
  replaceDirectoryAtomically(staging, targetDir);
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

function syncTargetPayload(targetName, targetPath, payloads) {
  const payload = appTargetPayload(targetName, payloads);
  const skillNames = targetSkillNames(targetName, payloads);
  const previousNames = previousManagedSkillNames(targetPath);
  fs.mkdirSync(targetPath, { recursive: true });

  for (const skillName of skillNames) {
    writeSkillPayloadAtomically(
      targetPath,
      skillBaseRel(targetName, skillName),
      skillPayloadForTarget(targetName, payload, skillName)
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

function buildAudit({ args, hubPath, state, discoveries, checksum, payloads }) {
  const dryRun = !args.write;
  return {
    architecture_version: ARCHITECTURE_VERSION,
    bridge_version: BRIDGE_VERSION,
    dry_run: dryRun,
    hub_path: hubPath,
    lock_path: path.join(path.dirname(hubPath), 'update.lock'),
    sync_source: args.syncSource,
    auto_sync_enabled: state.auto_sync_enabled,
    update_report_open_enabled: state.update_report_open_enabled,
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

function hookSafeWarning(args, message) {
  if (args.hook) {
    console.error(`Toolkit local bridge hook skipped: ${message}`);
  }
}

function runtimeCodexPluginRoot() {
  return path.resolve(process.env.PLUGIN_ROOT || path.resolve(__dirname, '..', '..'));
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

function runRepoAutoUpdate({ args, hubPath, state, discoveries, checksum, payloads }) {
  const lock = acquireLock(path.dirname(hubPath), args);
  if (!lock.acquired) {
    console.log(`Toolkit local bridge: ${lock.skipReason}; skipping repo auto-update.`);
    return { status: 0, audit: buildAudit({ args, hubPath, state, discoveries, checksum, payloads }) };
  }

  let statusState = state;
  let updateResult = null;
  let updatedDiscoveries = discoveries;
  let updatedPayloads = payloads;
  let updatedChecksum = checksum;
  let plannedTargetSyncs = [];
  let skippedTargets = [];
  try {
    try {
      updateResult = validateAndUpdateRepo(state, args);
      statusState = prepareStateForWrite(applyRepoUpdateStatus(state, updateResult.status, {
        fromCommit: updateResult.fromCommit,
        toCommit: updateResult.toCommit
      }), args);
      writeHubSnapshot({ hubPath, args, state: statusState, discoveries, checksum, payloads });
    } catch (error) {
      const details = error.repoUpdateDetails || {};
      statusState = prepareStateForWrite(applyRepoUpdateStatus(state, error.repoUpdateStatus || 'skipped', {
        fromCommit: details.fromCommit || '',
        toCommit: details.toCommit || '',
        error: details.error || error.message
      }), args);
      writeHubSnapshot({ hubPath, args, state: statusState, discoveries, checksum, payloads });
      const report = maybeWriteUpdateReport({
        args,
        hubPath,
        state: statusState,
        checksum,
        context: {
          repo: {
            status: error.repoUpdateStatus || 'skipped',
            fromCommit: details.fromCommit || '',
            toCommit: details.toCommit || '',
            changedFiles: details.changedFiles || [],
            validationStatus: details.validationStatus || (error.repoUpdateStatus === 'validation-failed' ? 'failed' : 'not run'),
            error: details.error || error.message
          },
          nativePluginCache: codexNativePluginCacheStatus(args, statusState),
          targetSyncStatus: 'skipped'
        }
      });
      statusState = report.state;
      printUpdateReportLine(args, report.reportPath);
      if (args.hook) {
        hookSafeWarning(args, error.message);
        return { status: 0, audit: buildAudit({ args, hubPath, state: statusState, discoveries, checksum, payloads }) };
      }
      throw error;
    }
  } finally {
    releaseLock(lock);
  }

  updatedPayloads = adapterPayloads(statusState);
  updatedChecksum = payloadChecksum(updatedPayloads);
  updatedDiscoveries = {
    opencode: discoverOpenCode(args, statusState.targets.opencode, hubPath),
    ag2: discoverAg2(args, statusState.targets.ag2, hubPath)
  };
  plannedTargetSyncs = SUPPORTED_TARGETS
    .filter((target) => targetWouldSync(target, statusState, updatedChecksum, updatedDiscoveries[target], updatedPayloads))
    .map((target) => targetSyncPlan(target, updatedDiscoveries[target], updatedPayloads));
  skippedTargets = SUPPORTED_TARGETS.filter((target) => !statusState.targets[target].enabled || statusState.targets[target].explicitly_disabled);
  const refreshLock = acquireLock(path.dirname(hubPath), args);
  try {
    if (refreshLock.acquired) {
      writeHubSnapshot({
        hubPath,
        args,
        state: statusState,
        discoveries: updatedDiscoveries,
        checksum: updatedChecksum,
        payloads: updatedPayloads
      });
    }
  } finally {
    releaseLock(refreshLock);
  }

  try {
    runDelegatedRepoSync({ args, hubPath, repoPath: updateResult.repoPath });
  } catch (error) {
    const failedState = prepareStateForWrite(applyRepoUpdateStatus(statusState, 'sync-delegation-failed', {
      fromCommit: updateResult.fromCommit,
      toCommit: updateResult.toCommit,
      error: error.message
    }), args);
    const relock = acquireLock(path.dirname(hubPath), args);
    try {
      if (relock.acquired) {
        writeHubSnapshot({ hubPath, args, state: failedState, discoveries: updatedDiscoveries, checksum: updatedChecksum, payloads: updatedPayloads });
      }
    } finally {
      releaseLock(relock);
    }
    const report = maybeWriteUpdateReport({
      args,
      hubPath,
      state: failedState,
      checksum: updatedChecksum,
      context: {
        repo: {
          status: 'sync-delegation-failed',
          fromCommit: updateResult.fromCommit,
          toCommit: updateResult.toCommit,
          changedFiles: updateResult.changedFiles || [],
          validationStatus: updateResult.validation?.status || 'passed',
          error: error.message
        },
        skippedTargets,
        nativePluginCache: codexNativePluginCacheStatus(args, failedState),
        targetSyncStatus: 'failed'
      }
    });
    printUpdateReportLine(args, report.reportPath);
    if (args.hook) {
      hookSafeWarning(args, error.message);
      return { status: 0, audit: buildAudit({ args, hubPath, state: report.state, discoveries: updatedDiscoveries, checksum: updatedChecksum, payloads: updatedPayloads }) };
    }
    throw error;
  }

  const finalState = normalizedState(readJsonIfExists(path.join(hubPath, 'state.json')) || statusState);
  const completedTargetSyncs = plannedTargetSyncs.filter((sync) => (
    targetIsSynced(sync.target, finalState.targets[sync.target], updatedChecksum, updatedDiscoveries[sync.target], updatedPayloads)
  ));
  const report = maybeWriteUpdateReport({
    args,
    hubPath,
    state: finalState,
    checksum: updatedChecksum,
    context: {
      repo: {
        status: updateResult.status,
        fromCommit: updateResult.fromCommit,
        toCommit: updateResult.toCommit,
        changedFiles: updateResult.changedFiles || [],
        validationStatus: updateResult.validation?.status || 'passed'
      },
      targetSyncs: completedTargetSyncs,
      skippedTargets,
      nativePluginCache: codexNativePluginCacheStatus(args, finalState),
      targetSyncStatus: plannedTargetSyncs.length
        ? (completedTargetSyncs.length === plannedTargetSyncs.length ? 'synced' : 'not confirmed')
        : 'not needed'
    }
  });
  printUpdateReportLine(args, report.reportPath);
  const finalAudit = buildAudit({ args, hubPath, state: report.state, discoveries: updatedDiscoveries, checksum: updatedChecksum, payloads: updatedPayloads });
  if (args.audit) console.log(JSON.stringify(finalAudit, null, 2));
  return { status: 0, audit: finalAudit };
}

function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const hubPath = assertSafeWritePath(args.hub || defaultHubPath(), 'hub path');
  const existingState = normalizedState(readJsonIfExists(path.join(hubPath, 'state.json')));

  if (isHookNoop(args, existingState)) {
    if (existingState?.hub_version && !existingState.auto_sync_enabled) {
      console.log('Toolkit local bridge: auto-sync disabled; run node repo/scripts/toolkit-local-bridge.cjs --audit for status.');
    }
    return { status: 0, audit: null };
  }

  if (existingState.hub_version && compareSemver(BRIDGE_VERSION, existingState.hub_version) < 0 && !args.forceDowngrade) {
    throw new Error(`Refusing downgrade: current bridge ${BRIDGE_VERSION} is older than hub state ${existingState.hub_version}`);
  }

  let nextState = applyRequestedState(existingState, args);
  if (args.enableRepoAutoUpdate && !nextState.repo_path) {
    throw new Error('--enable-repo-auto-update requires --repo-path or an existing repo_path in hub state');
  }
  const discoveries = {
    opencode: discoverOpenCode(args, nextState.targets.opencode, hubPath),
    ag2: discoverAg2(args, nextState.targets.ag2, hubPath)
  };
  const payloads = adapterPayloads(nextState);
  const checksum = payloadChecksum(payloads);

  updateTargetState(nextState, 'opencode', discoveries.opencode, checksum, false, nextState.targets.opencode.enabled ? '' : 'not enabled');
  updateTargetState(nextState, 'ag2', discoveries.ag2, checksum, false, nextState.targets.ag2.enabled ? '' : 'not enabled');

  const audit = buildAudit({ args, hubPath, state: nextState, discoveries, checksum, payloads });
  if (args.audit || !args.write) {
    console.log(JSON.stringify(audit, null, 2));
  }
  if (!args.write) return { status: 0, audit };
  if (shouldRunRepoAutoUpdate(args, nextState)) {
    return runRepoAutoUpdate({ args, hubPath, state: nextState, discoveries, checksum, payloads });
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
    const report = maybeWriteUpdateReport({
      args,
      hubPath,
      state: nextState,
      checksum,
      context: {
        repo: repoReportContextFromState(nextState, args),
        nativePluginCache: codexNativePluginCacheStatus(args, nextState),
        targetSyncStatus: 'not needed'
      }
    });
    nextState = report.state;
    const finalAudit = buildAudit({ args, hubPath, state: nextState, discoveries, checksum, payloads });
    if (report.reportPath) printUpdateReportLine(args, report.reportPath);
    else if (!args.hook) console.log('Toolkit local bridge: no enabled stale targets to sync.');
    return { status: 0, audit: finalAudit };
  }
  if (args.hook && !hasTargetSync) {
    const report = maybeWriteUpdateReport({
      args,
      hubPath,
      state: nextState,
      checksum,
      context: {
        repo: repoReportContextFromState(nextState, args),
        nativePluginCache: codexNativePluginCacheStatus(args, nextState),
        targetSyncStatus: 'not needed'
      }
    });
    nextState = report.state;
    const finalAudit = buildAudit({ args, hubPath, state: nextState, discoveries, checksum, payloads });
    if (report.reportPath) printUpdateReportLine(args, report.reportPath);
    return { status: 0, audit: finalAudit };
  }

  const lock = acquireLock(path.dirname(hubPath), args);
  if (!lock.acquired) {
    console.log(`Toolkit local bridge: ${lock.skipReason}; skipping sync.`);
    return { status: 0, audit };
  }

  try {
    nextState = applyRequestedState(existingState, args);
    updateTargetState(nextState, 'opencode', discoveries.opencode, checksum, false, nextState.targets.opencode.enabled ? '' : 'not enabled');
    updateTargetState(nextState, 'ag2', discoveries.ag2, checksum, false, nextState.targets.ag2.enabled ? '' : 'not enabled');
    nextState = prepareStateForWrite(nextState, args);
    writeHubSnapshot({ hubPath, args, state: nextState, discoveries, checksum, payloads });

    const targetSyncs = [];
    if (targetWouldSync('opencode', nextState, checksum, discoveries.opencode, payloads)) {
      const targetPath = assertSafeWritePath(discoveries.opencode.target_path, 'OpenCode target path');
      targetSyncs.push(syncTargetPayload('opencode', targetPath, payloads));
      updateTargetState(nextState, 'opencode', discoveries.opencode, checksum, true, '');
    }
    if (targetWouldSync('ag2', nextState, checksum, discoveries.ag2, payloads)) {
      const targetPath = assertSafeWritePath(discoveries.ag2.target_path, 'Antigravity 2 target path');
      targetSyncs.push(syncTargetPayload('ag2', targetPath, payloads));
      updateTargetState(nextState, 'ag2', discoveries.ag2, checksum, true, '');
    }

    nextState.updated_at = timestamp();
    writeJson(path.join(hubPath, 'state.json'), nextState);
    writeJson(path.join(hubPath, 'manifest.json'), buildManifest({
      state: nextState,
      discoveries,
      checksum,
      syncSource: args.syncSource,
      hubPath
    }));

    const report = maybeWriteUpdateReport({
      args,
      hubPath,
      state: nextState,
      checksum,
      context: {
        repo: repoReportContextFromState(nextState, args),
        targetSyncs,
        skippedTargets: SUPPORTED_TARGETS.filter((target) => !nextState.targets[target].enabled || nextState.targets[target].explicitly_disabled),
        nativePluginCache: codexNativePluginCacheStatus(args, nextState),
        targetSyncStatus: targetSyncs.length ? 'synced' : 'not needed'
      }
    });
    nextState = report.state;

    const finalAudit = buildAudit({ args, hubPath, state: nextState, discoveries, checksum, payloads });
    if (args.audit) console.log(JSON.stringify(finalAudit, null, 2));
    else if (report.reportPath) printUpdateReportLine(args, report.reportPath);
    else if (!args.hook) console.log(`Toolkit local bridge sync complete: ${hubPath}`);
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
    if (process.argv.includes('--hook')) {
      console.error(`Toolkit local bridge hook skipped: ${error.message}`);
      process.exit(0);
    }
    console.error(`FAIL: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  ARCHITECTURE_VERSION,
  BRIDGE_VERSION,
  defaultHubPath,
  parseArgs,
  run,
  adapterPayloads,
  payloadChecksum,
  compareSemver,
  getRepoValidationLabels,
  runRepoValidation,
  updateReportDir,
  openUpdateReport
};
