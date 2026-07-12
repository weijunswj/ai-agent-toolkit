'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const {
  CODEX_AGENT_MAX_THREADS,
  CODEX_AGENT_MAX_DEPTH,
  CODEX_DELEGATION_BEGIN,
  CODEX_DELEGATION_END,
  RESTORE_FLAG,
  cleanError,
  defaultCodexHome,
  codexConfigPath,
  backupRoot,
  parseTomlStructurally,
} = require('./codex-delegation-common.cjs');
const { structuralLayout } = require('./codex-delegation-layout.cjs');
const { expectedCodexDelegationBlock, codexDelegationConfigState } = require('./codex-delegation-state.cjs');
const { createCodexConfigBackup, restoreCodexDelegationBackup, writeRegularFileAtomically } = require('./codex-delegation-backup.cjs');

function inspectCodexDelegationConfig(configPath = codexConfigPath()) {
  let stat;
  try {
    stat = fs.lstatSync(configPath);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return codexDelegationConfigState(Buffer.alloc(0), configPath);
    }
    return { status: 'conflicting', config_path: configPath, detail: `Codex config could not be inspected safely: ${cleanError(error)}` };
  }
  if (stat.isSymbolicLink()) {
    let target = '';
    try { target = fs.readlinkSync(configPath); } catch {}
    return { status: 'unsupported', config_path: configPath, detail: 'Codex config is a symbolic link; Toolkit will not replace or follow it.', file_type: 'symlink', symlink_target: target };
  }
  if (!stat.isFile()) {
    return { status: 'unsupported', config_path: configPath, detail: 'Codex config is not a regular file; Toolkit will not replace it.', file_type: 'special' };
  }
  try {
    const state = codexDelegationConfigState(fs.readFileSync(configPath), configPath);
    return { ...state, file_type: 'regular', mode: stat.mode & 0o7777 };
  } catch (error) {
    return { status: 'conflicting', config_path: configPath, detail: `Codex config could not be read safely: ${cleanError(error)}` };
  }
}

function previewCodexDelegation(configPath = codexConfigPath()) {
  const state = inspectCodexDelegationConfig(configPath);
  if (state.status !== 'unconfigured') return { ...state, changed: false };
  return {
    ...state,
    status: 'preview',
    changed: false,
    backup_root: backupRoot(),
    proposed_block: expectedCodexDelegationBlock(state.eol || '\n'),
    proposed_action: 'isolated Codex app-server config/batchWrite',
    detail: 'Explicit limit approval may prepare the shown values through the official Codex config editor.',
  };
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
    'codex',
  ].filter(Boolean))];
}

function runAppServerBatchWrite(command, codexHome) {
  return new Promise((resolve, reject) => {
    const parts = codexCommandParts(command, ['app-server', '--listen', 'stdio://']);
    const child = spawn(parts.command, parts.args, {
      env: { ...process.env, CODEX_HOME: codexHome },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stderr = '';
    let settled = false;
    const rl = readline.createInterface({ input: child.stdout });
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rl.close();
      try { child.stdin.end(); } catch {}
      if (!child.killed) child.kill();
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => finish(new Error(`${command} app-server config/batchWrite timed out`)), 15000);
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => finish(error));
    child.on('exit', (code) => {
      if (!settled) finish(new Error(`${command} app-server exited ${code}: ${stderr.trim()}`));
    });
    rl.on('line', (line) => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.id === 1) {
        child.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`);
        child.stdin.write(`${JSON.stringify({
          method: 'config/batchWrite',
          id: 2,
          params: {
            edits: [
              { keyPath: 'agents.max_threads', value: CODEX_AGENT_MAX_THREADS, mergeStrategy: 'upsert' },
              { keyPath: 'agents.max_depth', value: CODEX_AGENT_MAX_DEPTH, mergeStrategy: 'upsert' },
            ],
          },
        })}\n`);
      } else if (message.id === 2) {
        if (message.error) finish(new Error(`config/batchWrite failed: ${message.error.message || JSON.stringify(message.error)}`));
        else finish();
      }
    });
    child.stdin.write(`${JSON.stringify({
      method: 'initialize',
      id: 1,
      params: { clientInfo: { name: 'ai_agent_toolkit', title: 'AI Agent Toolkit', version: '2.4.1' } },
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
        failures.push(`${command}: ${cleanError(error)}`);
      }
    }
    throw new Error(`No supported Codex app-server config editor succeeded: ${failures.join('; ')}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function configureCodexDelegation(configPath = codexConfigPath(), options = {}) {
  const preview = previewCodexDelegation(configPath);
  if (preview.status !== 'preview') return { ...preview, changed: false };
  const edit = options.editor
    ? await options.editor({ originalBytes: preview.bytes, configPath })
    : await editWithCodexAppServer(preview.bytes, options);
  const nextBytes = Buffer.from(edit.bytes);
  const proposed = codexDelegationConfigState(nextBytes, configPath);
  if (proposed.status !== 'configured') {
    return { ...proposed, status: 'conflicting', changed: false, detail: `Proposed Codex config failed TOML validation: ${proposed.detail}` };
  }
  const backup = createCodexConfigBackup(configPath);
  let wrote = false;
  try {
    writeRegularFileAtomically(configPath, nextBytes, backup.existed ? backup.original_mode : 0o600);
    wrote = true;
    const verified = inspectCodexDelegationConfig(configPath);
    if (verified.status !== 'configured' || verified.max_threads !== 1 || verified.max_depth !== 1) {
      throw new Error(`Post-write Codex config verification failed: ${verified.detail || verified.status}`);
    }
    if (typeof options.afterWrite === 'function') options.afterWrite({ configPath, backup, verified });
    return {
      ...verified,
      changed: true,
      editor: edit.editor || 'injected test editor',
      backup_metadata_path: backup.metadata_path,
      restore_command: `node repo/scripts/setup-toolkit.cjs ${RESTORE_FLAG} ${JSON.stringify(backup.metadata_path)}`,
      proposed_block: preview.proposed_block,
    };
  } catch (error) {
    if (wrote) {
      try { restoreCodexDelegationBackup(backup.metadata_path); }
      catch (restoreError) {
        const combined = new Error(`Codex delegation configuration failed and exact restoration also failed: ${cleanError(restoreError)}`);
        combined.cause = error;
        throw combined;
      }
    }
    throw error;
  }
}

async function delegationResultForChoice(choice, configPath = codexConfigPath(), options = {}) {
  const current = inspectCodexDelegationConfig(configPath);
  if (choice === 'skip') return { ...current, status: 'skipped', changed: false, detail: 'Codex delegation configuration was explicitly skipped.' };
  if (choice !== 'limit') return { ...current, status: current.status === 'configured' ? 'configured' : 'kept', changed: false, detail: current.status === 'configured' ? current.detail : 'Codex delegation configuration was kept unchanged pending native UAT.' };
  return await configureCodexDelegation(configPath, options);
}

module.exports = {
  CODEX_AGENT_MAX_THREADS,
  CODEX_AGENT_MAX_DEPTH,
  CODEX_DELEGATION_BEGIN,
  CODEX_DELEGATION_END,
  RESTORE_FLAG,
  defaultCodexHome,
  codexConfigPath,
  parseTomlStructurally,
  structuralLayout,
  expectedCodexDelegationBlock,
  codexDelegationConfigState,
  inspectCodexDelegationConfig,
  previewCodexDelegation,
  editWithCodexAppServer,
  createCodexConfigBackup,
  restoreCodexDelegationBackup,
  configureCodexDelegation,
  delegationResultForChoice,
};
