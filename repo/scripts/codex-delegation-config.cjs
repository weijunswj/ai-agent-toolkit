#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { spawn, spawnSync } = require('node:child_process');

const CODEX_AGENT_MAX_THREADS = 1;
const CODEX_AGENT_MAX_DEPTH = 1;
const BACKUP_KIND = 'ai-agent-toolkit-codex-config-backup';
const TOML_INSPECTOR = path.join(__dirname, 'inspect-codex-config-toml.py');

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function pythonCandidates(explicit = '') {
  return [...new Set([
    explicit,
    process.env.PYTHON,
    process.platform === 'win32' ? 'python' : 'python3',
    process.platform === 'win32' ? 'python3' : 'python'
  ].filter(Boolean))];
}

function parseTomlBytes(bytes, options = {}) {
  const failures = [];
  for (const command of pythonCandidates(options.pythonCommand)) {
    const result = spawnSync(command, [TOML_INSPECTOR], {
      input: bytes,
      encoding: 'utf8',
      timeout: 15000,
      windowsHide: true
    });
    if (result.status !== 0) {
      failures.push(`${command}: ${(result.stderr || result.error?.message || `exit ${result.status}`).trim()}`);
      continue;
    }
    try {
      return { ...JSON.parse(result.stdout), parser: `${command} tomllib` };
    } catch (error) {
      failures.push(`${command}: invalid parser output: ${error.message}`);
    }
  }
  return {
    ok: false,
    parser_unavailable: true,
    error: `Python 3.11+ tomllib parser unavailable: ${failures.join('; ') || 'no Python command found'}`
  };
}

function fileTopology(configPath) {
  try {
    const stat = fs.lstatSync(configPath);
    if (stat.isSymbolicLink()) {
      return {
        supported: false,
        existed: true,
        file_type: 'symlink',
        symlink_target: fs.readlinkSync(configPath),
        detail: 'Codex config is a symlink; Toolkit refuses to replace or follow it'
      };
    }
    if (!stat.isFile()) {
      return {
        supported: false,
        existed: true,
        file_type: stat.isDirectory() ? 'directory' : 'special',
        detail: 'Codex config is not a regular file; Toolkit refuses to replace it'
      };
    }
    return {
      supported: true,
      existed: true,
      file_type: 'regular',
      mode: stat.mode & 0o777,
      bytes: fs.readFileSync(configPath)
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { supported: true, existed: false, file_type: 'missing', bytes: Buffer.alloc(0) };
    }
    return { supported: false, existed: false, file_type: 'unreadable', detail: error.message };
  }
}

function stateFromParsed(parsed, configPath, topology) {
  const base = {
    config_path: configPath,
    parser: parsed.parser || 'unknown',
    topology: {
      existed: topology.existed,
      file_type: topology.file_type,
      mode: topology.mode,
      symlink_target: topology.symlink_target
    }
  };
  if (!parsed.ok) {
    return { ...base, status: 'conflicting', detail: `Codex config TOML could not be validated safely: ${parsed.error}` };
  }
  if (parsed.agents_present && !parsed.agents_is_table) {
    return { ...base, status: 'conflicting', detail: 'Codex agents value is not a TOML table' };
  }
  const threads = parsed.max_threads || { present: false };
  const depth = parsed.max_depth || { present: false };
  for (const [name, value] of [['max_threads', threads], ['max_depth', depth]]) {
    if (value.present && value.type !== 'integer') {
      return { ...base, status: 'conflicting', detail: `agents.${name} must be an integer; found ${value.type}` };
    }
  }
  if ((threads.present && threads.value !== CODEX_AGENT_MAX_THREADS) || (depth.present && depth.value !== CODEX_AGENT_MAX_DEPTH)) {
    return { ...base, status: 'conflicting', detail: 'Existing Codex agent limits differ from Toolkit values and were not overwritten' };
  }
  if (threads.present && depth.present) {
    return {
      ...base,
      status: 'configured',
      max_threads: CODEX_AGENT_MAX_THREADS,
      max_depth: CODEX_AGENT_MAX_DEPTH,
      detail: 'Codex TOML parser confirms the exact integer agent limits'
    };
  }
  return { ...base, status: 'unconfigured', detail: 'Codex agent limits are not fully configured' };
}

function inspectCodexDelegationConfig(configPath, options = {}) {
  const topology = fileTopology(configPath);
  if (!topology.supported) {
    return {
      status: 'conflicting',
      config_path: configPath,
      topology,
      detail: topology.detail
    };
  }
  return stateFromParsed(parseTomlBytes(topology.bytes, options), configPath, topology);
}

function codexCommandParts(command, args) {
  if (/\.(?:cjs|mjs|js)$/i.test(command)) return { command: process.execPath, args: [command, ...args] };
  return { command, args };
}

function appServerCandidates(explicit = '', codexHome = '') {
  return [...new Set([
    explicit,
    process.env.CODEX_TOOLKIT_CODEX_CLI,
    process.env.CODEX_CLI_PATH,
    codexHome ? path.join(codexHome, 'plugins', '.plugin-appserver', process.platform === 'win32' ? 'codex.exe' : 'codex') : '',
    'codex'
  ].filter(Boolean))];
}

function runAppServerBatchWrite(command, codexHome) {
  return new Promise((resolve, reject) => {
    const parts = codexCommandParts(command, ['app-server', '--listen', 'stdio://']);
    const child = spawn(parts.command, parts.args, {
      env: { ...process.env, CODEX_HOME: codexHome },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    let stderr = '';
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rl.close();
      if (!child.killed) child.kill();
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => finish(new Error(`${command} app-server config/batchWrite timed out`)), 15000);
    const rl = readline.createInterface({ input: child.stdout });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => finish(error));
    child.on('exit', (code) => {
      if (!settled) finish(new Error(`${command} app-server exited ${code}: ${stderr.trim()}`));
    });
    rl.on('line', (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.id === 1) {
        child.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`);
        child.stdin.write(`${JSON.stringify({
          method: 'config/batchWrite',
          id: 2,
          params: {
            edits: [
              { keyPath: 'agents.max_threads', value: CODEX_AGENT_MAX_THREADS, mergeStrategy: 'upsert' },
              { keyPath: 'agents.max_depth', value: CODEX_AGENT_MAX_DEPTH, mergeStrategy: 'upsert' }
            ]
          }
        })}\n`);
      } else if (message.id === 2) {
        if (message.error) finish(new Error(`config/batchWrite failed: ${message.error.message || JSON.stringify(message.error)}`));
        else finish();
      }
    });
    child.stdin.write(`${JSON.stringify({
      method: 'initialize',
      id: 1,
      params: { clientInfo: { name: 'ai_agent_toolkit', title: 'AI Agent Toolkit', version: '2.4.1' } }
    })}\n`);
  });
}

async function editWithCodexAppServer(originalBytes, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-codex-config-edit-'));
  const isolatedHome = path.join(root, 'codex-home');
  const isolatedConfig = path.join(isolatedHome, 'config.toml');
  fs.mkdirSync(isolatedHome, { recursive: true });
  if (originalBytes.length) fs.writeFileSync(isolatedConfig, originalBytes);
  const failures = [];
  try {
    for (const command of appServerCandidates(options.codexCommand, options.codexHome)) {
      try {
        await runAppServerBatchWrite(command, isolatedHome);
        if (!fs.existsSync(isolatedConfig)) throw new Error('config/batchWrite did not create config.toml');
        return { bytes: fs.readFileSync(isolatedConfig), editor: `${command} app-server config/batchWrite` };
      } catch (error) {
        failures.push(`${command}: ${error.message}`);
      }
    }
    throw new Error(`No supported Codex app-server config editor succeeded: ${failures.join('; ')}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function prepareCodexDelegationChange(configPath, options = {}) {
  const topology = fileTopology(configPath);
  if (!topology.supported) return { state: inspectCodexDelegationConfig(configPath, options), changed: false };
  const current = stateFromParsed(parseTomlBytes(topology.bytes, options), configPath, topology);
  if (current.status !== 'unconfigured') return { state: current, changed: false };
  const edit = options.editor
    ? await options.editor({ originalBytes: topology.bytes, configPath })
    : await editWithCodexAppServer(topology.bytes, options);
  const proposedBytes = Buffer.from(edit.bytes);
  const proposedTopology = { ...topology, existed: true, file_type: 'regular', bytes: proposedBytes };
  const proposed = stateFromParsed(parseTomlBytes(proposedBytes, options), configPath, proposedTopology);
  if (proposed.status !== 'configured') {
    return {
      state: { ...proposed, status: 'conflicting', detail: `Proposed Codex edit failed validation: ${proposed.detail}` },
      changed: false
    };
  }
  return {
    state: current,
    proposed,
    changed: !topology.bytes.equals(proposedBytes),
    config_path: configPath,
    originalBytes: topology.bytes,
    proposedBytes,
    topology,
    editor: edit.editor || 'injected test editor',
    backup_root: backupRootFor(configPath),
    preview: ['[agents]', `max_threads = ${CODEX_AGENT_MAX_THREADS}`, `max_depth = ${CODEX_AGENT_MAX_DEPTH}`].join('\n')
  };
}

function writeRegularFileAtomically(filePath, bytes, mode) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`);
  try {
    fs.writeFileSync(tempPath, bytes, { mode: mode ?? 0o600 });
    if (mode !== undefined) fs.chmodSync(tempPath, mode);
    fs.renameSync(tempPath, filePath);
  } finally {
    if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
  }
}

function backupRootFor(configPath) {
  return path.join(path.dirname(configPath), '.ai-agent-toolkit-backups', 'codex-config');
}

function createConfigBackup(prepared) {
  const backupRoot = backupRootFor(prepared.config_path);
  const backupDir = path.join(backupRoot, `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  const dataPath = path.join(backupDir, 'original.bin');
  const metadataPath = path.join(backupDir, 'metadata.json');
  fs.mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
  fs.mkdirSync(backupDir, { recursive: false, mode: 0o700 });
  try {
    if (prepared.topology.existed) fs.writeFileSync(dataPath, prepared.originalBytes, { mode: 0o600 });
    const metadata = {
      schema_version: 1,
      kind: BACKUP_KIND,
      target_path: prepared.config_path,
      created_at: new Date().toISOString(),
      original: {
        existed: prepared.topology.existed,
        file_type: prepared.topology.file_type,
        mode: prepared.topology.mode ?? null,
        symlink_target: prepared.topology.symlink_target ?? null,
        byte_length: prepared.originalBytes.length,
        sha256: sha256(prepared.originalBytes),
        data_file: prepared.topology.existed ? 'original.bin' : null
      },
      proposed_sha256: sha256(prepared.proposedBytes)
    };
    fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });
    return { backupDir, metadataPath, metadata };
  } catch (error) {
    fs.rmSync(backupDir, { recursive: true, force: true });
    throw error;
  }
}

function readBackupMetadata(metadataPath) {
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  if (metadata.kind !== BACKUP_KIND || metadata.schema_version !== 1) throw new Error('Unsupported Codex config backup metadata');
  return metadata;
}

function restoreCodexConfigBackup(metadataPath) {
  const metadata = readBackupMetadata(metadataPath);
  const targetPath = path.resolve(metadata.target_path);
  const current = fileTopology(targetPath);
  if (current.existed && !current.supported) throw new Error(`Cannot restore over unsupported target topology: ${current.detail}`);
  if (!metadata.original.existed) {
    if (current.existed) fs.rmSync(targetPath);
    return { restored: true, removed: true, target_path: targetPath };
  }
  if (metadata.original.file_type !== 'regular') throw new Error(`Unsupported original file type: ${metadata.original.file_type}`);
  const dataPath = path.join(path.dirname(metadataPath), metadata.original.data_file);
  const bytes = fs.readFileSync(dataPath);
  if (sha256(bytes) !== metadata.original.sha256 || bytes.length !== metadata.original.byte_length) {
    throw new Error('Codex config backup bytes failed integrity validation');
  }
  writeRegularFileAtomically(targetPath, bytes, metadata.original.mode ?? undefined);
  return { restored: true, removed: false, target_path: targetPath };
}

async function commitCodexDelegationChange(prepared, options = {}) {
  if (!prepared.changed) return { ...prepared.state, changed: false };
  const backup = createConfigBackup(prepared);
  try {
    writeRegularFileAtomically(prepared.config_path, prepared.proposedBytes, prepared.topology.mode);
    const verified = inspectCodexDelegationConfig(prepared.config_path, options);
    if (verified.status !== 'configured') throw new Error(`Committed Codex config failed TOML verification: ${verified.detail}`);
    const downstream = options.afterCommit ? await options.afterCommit() : undefined;
    return {
      ...verified,
      changed: true,
      editor: prepared.editor,
      backup_path: backup.metadataPath,
      restore_command: `node ${JSON.stringify(path.join(__dirname, 'setup-toolkit.cjs'))} --restore-codex-config-backup ${JSON.stringify(backup.metadataPath)}`,
      downstream
    };
  } catch (error) {
    restoreCodexConfigBackup(backup.metadataPath);
    throw new Error(`${error.message}; exact prior Codex config was restored from ${backup.metadataPath}`);
  }
}

module.exports = {
  CODEX_AGENT_MAX_THREADS,
  CODEX_AGENT_MAX_DEPTH,
  parseTomlBytes,
  fileTopology,
  inspectCodexDelegationConfig,
  editWithCodexAppServer,
  prepareCodexDelegationChange,
  createConfigBackup,
  restoreCodexConfigBackup,
  commitCodexDelegationChange
};
