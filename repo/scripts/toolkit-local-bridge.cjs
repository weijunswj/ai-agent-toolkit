#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ARCHITECTURE_VERSION = 2;
const BRIDGE_VERSION = '2.2.0';
const STATE_SCHEMA_VERSION = 1;
const TOOLKIT_NAME = 'ai-agent-toolkit';
const SUPPORTED_TARGETS = ['opencode', 'ag2'];
const LOCK_STALE_MS = 10 * 60 * 1000;
const DEFAULT_REPO_BRANCH = 'main';
const DEFAULT_REPO_REMOTE = 'https://github.com/weijunswj/ai-agent-toolkit';

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
    '  --audit',
    '  --force-downgrade',
    '  --sync-source repo|codex-plugin|claude-plugin',
    '  --hub <path>                  test override; defaults to ~/.ai-agent-toolkit/current',
    '  --opencode-config-dir <path>  test or explicit setup override',
    '  --opencode-target <path>      test override for the managed OpenCode skill path',
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

function runRepoValidation(repoPath) {
  const validations = [
    {
      label: 'node repo/scripts/validate-toolkit.cjs',
      args: [path.join('repo', 'scripts', 'validate-toolkit.cjs')]
    },
    {
      label: 'node --test repo/tests/toolkit-local-bridge.test.cjs',
      args: ['--test', path.join('repo', 'tests', 'toolkit-local-bridge.test.cjs')]
    }
  ];
  for (const validation of validations) {
    const result = runCommand(process.execPath, validation.args, { cwd: repoPath, timeout: 120000 });
    if (!result.ok) {
      throw repoUpdateError(
        'validation-failed',
        `${validation.label} failed: ${commandOutput(result)}`,
        { error: validation.label }
      );
    }
  }
}

function validateAndUpdateRepo(state) {
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
  try {
    runRepoValidation(repoPath);
  } catch (error) {
    throw repoUpdateError(error.repoUpdateStatus || 'validation-failed', error.message, {
      fromCommit,
      toCommit,
      error: error.repoUpdateDetails?.error || error.message
    });
  }
  return {
    repoPath,
    fromCommit,
    toCommit,
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

function discoverOpenCode(args, targetState) {
  const envConfig = args.opencodeConfigDir || process.env.OPENCODE_CONFIG_DIR || '';
  const homeConfig = path.join(os.homedir(), '.config', 'opencode');
  const configDir = envConfig || homeConfig;
  const persistedState = Boolean(
    targetState.detected ||
    targetState.target_path ||
    targetState.synced_version ||
    targetState.synced_checksum ||
    targetState.last_sync
  );
  const configuredTarget = args.opencodeTarget || targetState.target_path || path.join(configDir, 'skills', TOOLKIT_NAME);
  const command = commandProbe(args.opencodeCommand, ['--version']);
  const configExists = fs.existsSync(configDir);
  const targetExists = fs.existsSync(configuredTarget);
  const explicitlyEnabled = targetState.enabled === true;
  const detected = command.ok || Boolean(envConfig) || configExists || targetExists || explicitlyEnabled || persistedState;
  return {
    target: 'opencode',
    detected,
    target_path: configuredTarget,
    signals: {
      command_ok: command.ok,
      command_output: command.output,
      env_config_dir: Boolean(envConfig),
      config_dir: configDir,
      config_dir_exists: configExists,
      target_exists: targetExists,
      persisted_state: persistedState,
      explicitly_enabled: explicitlyEnabled
    }
  };
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
    candidates.push(path.join(home, '.local', 'bin', 'python.exe'));
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
  const targetPath = path.join(hubPath, 'adapters', 'ag2');
  const explicitlyEnabled = targetState.enabled === true;
  return {
    target: 'ag2',
    detected: Boolean(selected) || explicitlyEnabled,
    target_path: targetPath,
    python_command: selected?.command || '',
    ag2_package_detected: Boolean(selected),
    signals: {
      selected_python_command: selected?.command || '',
      tried_python_commands: tried,
      explicitly_enabled: explicitlyEnabled
    }
  };
}

function adapterPayloads() {
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

  const ag2Skill = [
    '# AI Agent Toolkit AG2 Adapter',
    '',
    'This generated adapter metadata is for local AG2-style consumers only.',
    '',
    'It does not install AG2 or Python packages. It does not update Codex or Claude Code. It does not mutate project repositories by default.',
    ''
  ].join('\n');

  return {
    opencode: {
      'skills/ai-agent-toolkit/SKILL.md': opencodeSkill,
      'skills/ai-agent-toolkit/README.md': opencodeReadme
    },
    ag2: {
      'ai-agent-toolkit-ag2-adapter.json': `${JSON.stringify(ag2Metadata, null, 2)}\n`,
      'README.md': ag2Skill
    }
  };
}

function payloadChecksum(payloads) {
  const hash = crypto.createHash('sha256');
  for (const target of Object.keys(payloads).sort()) {
    for (const rel of Object.keys(payloads[target]).sort()) {
      hash.update(target);
      hash.update('\0');
      hash.update(rel);
      hash.update('\0');
      hash.update(payloads[target][rel]);
      hash.update('\0');
    }
  }
  return hash.digest('hex');
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
    fs.writeFileSync(target, text, 'utf8');
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
  if (!fs.existsSync(path.join(stagePath, 'adapters', 'ag2', 'ai-agent-toolkit-ag2-adapter.json'))) {
    throw new Error('staged AG2 adapter metadata missing');
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

function copyDirectoryAtomically(sourceDir, targetDir) {
  const parent = path.dirname(targetDir);
  fs.mkdirSync(parent, { recursive: true });
  const staging = path.join(parent, `.${path.basename(targetDir)}.staging-${process.pid}-${Date.now()}`);
  if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
  fs.cpSync(sourceDir, staging, { recursive: true });
  if (!fs.existsSync(path.join(staging, 'SKILL.md'))) throw new Error(`staged target missing SKILL.md: ${staging}`);
  replaceDirectoryAtomically(staging, targetDir);
}

function targetWouldSync(targetName, state, checksum) {
  const target = state.targets[targetName];
  if (!target.enabled) return false;
  if (target.explicitly_disabled) return false;
  return target.synced_version !== BRIDGE_VERSION || target.synced_checksum !== checksum;
}

function targetIsSynced(targetState, checksum) {
  return targetState.synced_version === BRIDGE_VERSION && targetState.synced_checksum === checksum;
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

function buildAudit({ args, hubPath, state, discoveries, checksum }) {
  const dryRun = !args.write;
  return {
    architecture_version: ARCHITECTURE_VERSION,
    bridge_version: BRIDGE_VERSION,
    dry_run: dryRun,
    hub_path: hubPath,
    lock_path: path.join(path.dirname(hubPath), 'update.lock'),
    sync_source: args.syncSource,
    auto_sync_enabled: state.auto_sync_enabled,
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
      return [target, {
        status: targetStatus(targetState, discoveries[target], checksum),
        detected: discoveries[target].detected,
        enabled: targetState.enabled,
        explicitly_disabled: targetState.explicitly_disabled,
        target_path: discoveries[target].target_path,
        synced: targetIsSynced(targetState, checksum),
        synced_version: targetState.synced_version,
        synced_at: targetState.last_sync,
        python_command: target === 'ag2' ? discoveries[target].python_command || '' : undefined,
        would_write: targetWouldSync(target, state, checksum),
        skip_reason: targetState.enabled ? targetState.skip_reason : 'not enabled',
        signals: discoveries[target].signals
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
    '--skip-repo-auto-update'
  ];
  const result = runCommand(process.execPath, delegateArgs, {
    cwd: repoPath,
    timeout: 120000
  });
  if (result.stdout.trim()) console.log(result.stdout.trim());
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
    return { status: 0, audit: buildAudit({ args, hubPath, state, discoveries, checksum }) };
  }

  let statusState = state;
  let updateResult = null;
  try {
    try {
      updateResult = validateAndUpdateRepo(state);
      statusState = prepareStateForWrite(applyRepoUpdateStatus(state, updateResult.status, {
        fromCommit: updateResult.fromCommit,
        toCommit: updateResult.toCommit
      }), args);
      writeHubSnapshot({ hubPath, args, state: statusState, discoveries, checksum, payloads });
    } catch (error) {
      statusState = prepareStateForWrite(applyRepoUpdateStatus(state, error.repoUpdateStatus || 'skipped', {
        fromCommit: error.repoUpdateDetails?.fromCommit || '',
        toCommit: error.repoUpdateDetails?.toCommit || '',
        error: error.repoUpdateDetails?.error || error.message
      }), args);
      writeHubSnapshot({ hubPath, args, state: statusState, discoveries, checksum, payloads });
      if (args.hook) {
        hookSafeWarning(args, error.message);
        return { status: 0, audit: buildAudit({ args, hubPath, state: statusState, discoveries, checksum }) };
      }
      throw error;
    }
  } finally {
    releaseLock(lock);
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
        writeHubSnapshot({ hubPath, args, state: failedState, discoveries, checksum, payloads });
      }
    } finally {
      releaseLock(relock);
    }
    if (args.hook) {
      hookSafeWarning(args, error.message);
      return { status: 0, audit: buildAudit({ args, hubPath, state: failedState, discoveries, checksum }) };
    }
    throw error;
  }

  const finalAudit = buildAudit({ args, hubPath, state: statusState, discoveries, checksum });
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
    opencode: discoverOpenCode(args, nextState.targets.opencode),
    ag2: discoverAg2(args, nextState.targets.ag2, hubPath)
  };
  const payloads = adapterPayloads();
  const checksum = payloadChecksum(payloads);

  updateTargetState(nextState, 'opencode', discoveries.opencode, checksum, false, nextState.targets.opencode.enabled ? '' : 'not enabled');
  updateTargetState(nextState, 'ag2', discoveries.ag2, checksum, false, nextState.targets.ag2.enabled ? '' : 'not enabled');

  const audit = buildAudit({ args, hubPath, state: nextState, discoveries, checksum });
  if (args.audit || !args.write) {
    console.log(JSON.stringify(audit, null, 2));
  }
  if (!args.write) return { status: 0, audit };
  if (shouldRunRepoAutoUpdate(args, nextState)) {
    return runRepoAutoUpdate({ args, hubPath, state: nextState, discoveries, checksum, payloads });
  }
  if (
    args.syncEnabled &&
    !args.enableTargets.length &&
    !args.disableTargets.length &&
    !args.enableAutoSync &&
    !args.disableAutoSync &&
    !args.enableRepoAutoUpdate &&
    !args.disableRepoAutoUpdate &&
    !SUPPORTED_TARGETS.some((target) => targetWouldSync(target, nextState, checksum))
  ) {
    console.log('Toolkit local bridge: no enabled stale targets to sync.');
    return { status: 0, audit };
  }
  if (args.hook && !SUPPORTED_TARGETS.some((target) => targetWouldSync(target, nextState, checksum))) {
    return { status: 0, audit };
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

    if (targetWouldSync('opencode', nextState, checksum)) {
      const targetPath = assertSafeWritePath(discoveries.opencode.target_path, 'OpenCode target path');
      const sourceDir = path.join(hubPath, 'adapters', 'opencode', 'skills', TOOLKIT_NAME);
      copyDirectoryAtomically(sourceDir, targetPath);
      updateTargetState(nextState, 'opencode', discoveries.opencode, checksum, true, '');
    }
    if (targetWouldSync('ag2', nextState, checksum)) {
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

    const finalAudit = buildAudit({ args, hubPath, state: nextState, discoveries, checksum });
    if (args.audit) console.log(JSON.stringify(finalAudit, null, 2));
    else console.log(`Toolkit local bridge sync complete: ${hubPath}`);
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
  compareSemver
};
