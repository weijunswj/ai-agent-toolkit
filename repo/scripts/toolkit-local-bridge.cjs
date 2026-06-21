#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ARCHITECTURE_VERSION = 2;
const BRIDGE_VERSION = '2.0.0';
const STATE_SCHEMA_VERSION = 1;
const TOOLKIT_NAME = 'ai-agent-toolkit';
const SUPPORTED_TARGETS = ['opencode', 'ag2'];
const LOCK_STALE_MS = 10 * 60 * 1000;

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
    syncSource: 'repo',
    hub: '',
    opencodeConfigDir: '',
    opencodeTarget: '',
    opencodeCommand: 'opencode',
    pythonCommand: process.platform === 'win32' ? 'python' : 'python3'
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
    '  --audit',
    '  --force-downgrade',
    '  --sync-source repo|codex-plugin|claude-plugin',
    '  --hub <path>                  test override; defaults to ~/.ai-agent-toolkit/current',
    '  --opencode-config-dir <path>  test or explicit setup override',
    '  --opencode-target <path>      test override for the managed OpenCode skill path',
    '  --python-command <command>    test override for AG2 detection'
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

function commandProbe(command, commandArgs) {
  if (!command) return { ok: false, output: '', error: 'missing command' };
  try {
    const result = spawnSync(command, commandArgs, {
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
  return state;
}

function applyRequestedState(state, args) {
  const next = normalizedState(state);
  if (args.enableAutoSync) next.auto_sync_enabled = true;
  if (args.disableAutoSync) next.auto_sync_enabled = false;
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
  const configuredTarget = args.opencodeTarget || path.join(configDir, 'skills', TOOLKIT_NAME);
  const command = commandProbe(args.opencodeCommand, ['--version']);
  const configExists = fs.existsSync(configDir);
  const targetExists = fs.existsSync(configuredTarget);
  const explicitlyEnabled = targetState.enabled === true;
  const detected = command.ok || Boolean(envConfig) || configExists || targetExists || explicitlyEnabled;
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
      explicitly_enabled: explicitlyEnabled
    }
  };
}

function discoverAg2(args, targetState, hubPath) {
  const python = commandProbe(args.pythonCommand, ['--version']);
  const ag2Package = python.ok ? commandProbe(args.pythonCommand, ['-m', 'pip', 'show', 'ag2']) : { ok: false, output: '' };
  const targetPath = path.join(hubPath, 'adapters', 'ag2');
  const explicitlyEnabled = targetState.enabled === true;
  return {
    target: 'ag2',
    detected: python.ok && ag2Package.ok || explicitlyEnabled,
    target_path: targetPath,
    signals: {
      python_ok: python.ok,
      python_output: python.output,
      ag2_package_ok: ag2Package.ok,
      ag2_package_output: ag2Package.output,
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

function writePayloadTree(rootDir, payload) {
  for (const [rel, text] of Object.entries(payload)) {
    const target = path.join(rootDir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text, 'utf8');
  }
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
    checksum,
    targets: Object.fromEntries(SUPPORTED_TARGETS.map((target) => {
      const targetState = state.targets[target];
      return [target, {
        detected: discoveries[target].detected,
        enabled: targetState.enabled,
        explicitly_disabled: targetState.explicitly_disabled,
        target_path: discoveries[target].target_path,
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
  if (!existingState.auto_sync_enabled) return true;
  return !SUPPORTED_TARGETS.some((target) => existingState.targets[target]?.enabled);
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
  if (
    args.syncEnabled &&
    !args.enableTargets.length &&
    !args.disableTargets.length &&
    !args.enableAutoSync &&
    !args.disableAutoSync &&
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
    nextState.schema_version = STATE_SCHEMA_VERSION;
    nextState.architecture_version = ARCHITECTURE_VERSION;
    nextState.hub_version = BRIDGE_VERSION;
    nextState.created_at = nextState.created_at || timestamp();
    nextState.updated_at = timestamp();
    nextState.last_sync_source = args.syncSource;

    const stagePath = path.join(path.dirname(hubPath), `.staging-${process.pid}-${Date.now()}`);
    if (fs.existsSync(stagePath)) fs.rmSync(stagePath, { recursive: true, force: true });
    fs.mkdirSync(stagePath, { recursive: true });
    writePayloadTree(path.join(stagePath, 'adapters', 'opencode'), payloads.opencode);
    writePayloadTree(path.join(stagePath, 'adapters', 'ag2'), payloads.ag2);

    const manifest = buildManifest({
      state: nextState,
      discoveries,
      checksum,
      syncSource: args.syncSource,
      hubPath
    });
    writeJson(path.join(stagePath, 'manifest.json'), manifest);
    writeJson(path.join(stagePath, 'state.json'), nextState);
    validateStagedHub(stagePath, checksum);
    replaceDirectoryAtomically(stagePath, hubPath);

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
