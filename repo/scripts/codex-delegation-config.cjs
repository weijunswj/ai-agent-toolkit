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
const {
  captureCodexConfigSnapshot,
  assertSnapshotCurrent,
  createCodexConfigBackup,
  restoreCodexDelegationBackup,
  writeRegularFileAtomically,
} = require('./codex-delegation-backup.cjs');

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
    backup_root: backupRoot(configPath),
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
      params: { clientInfo: { name: 'ai_agent_toolkit', title: 'AI Agent Toolkit', version: '2.4.3' } },
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

function markToolkitDelegationProposal(configBytes, configPath) {
  const proposed = codexDelegationConfigState(configBytes, configPath);
  if (proposed.status !== 'configured' || proposed.ownership !== 'user-owned-compatible') {
    throw new Error('Official Codex editor proposal must contain exactly the compatible unmarked integer limits before Toolkit ownership markers can be added.');
  }
  const layout = proposed.layout;
  const agents = layout.agentsTables[0];
  const nextTable = layout.tables.find((entry) => entry.index > agents.index);
  const limitAssignments = layout.assignments
    .filter((entry) => entry.index > agents.index && (!nextTable || entry.index < nextTable.index))
    .filter((entry) => entry.key === 'max_threads' || entry.key === 'max_depth')
    .sort((left, right) => left.index - right.index);
  if (limitAssignments.length !== 2
    || limitAssignments[0].key !== 'max_threads'
    || limitAssignments[1].key !== 'max_depth'
    || limitAssignments[1].index !== limitAssignments[0].index + 1) {
    throw new Error('Official Codex editor proposal does not place exactly the two limit assignments together inside the real [agents] table.');
  }
  const firstLine = layout.lines[limitAssignments[0].index];
  const secondLine = layout.lines[limitAssignments[1].index];
  const lineText = (line) => line.raw.slice(0, line.eol ? -line.eol.length : undefined).trim();
  if (lineText(firstLine) !== 'max_threads = 1' || lineText(secondLine) !== 'max_depth = 1') {
    throw new Error('Official Codex editor proposal contains unsupported limit-line formatting.');
  }
  const eol = proposed.eol || '\n';
  const text = proposed.text;
  const marked = Buffer.from(
    `${text.slice(0, limitAssignments[0].start)}${expectedCodexDelegationBlock(eol)}${secondLine.eol ? eol : ''}${text.slice(limitAssignments[1].end)}`,
    'utf8'
  );
  const verified = codexDelegationConfigState(marked, configPath);
  if (verified.status !== 'configured' || verified.ownership !== 'toolkit-managed') {
    throw new Error(`Final Toolkit-marked Codex proposal failed structural validation: ${verified.detail || verified.status}`);
  }
  return { bytes: marked, state: verified };
}

function initialStateFromSnapshot(snapshot, configPath) {
  const state = codexDelegationConfigState(snapshot.bytes, configPath);
  return {
    ...state,
    file_type: snapshot.file_type,
    mode: snapshot.mode,
  };
}

function concurrentEditResult(current, error) {
  return {
    ...current,
    status: 'conflicting',
    changed: false,
    detail: `Codex delegation configuration was not written because the target changed concurrently: ${cleanError(error)}`,
  };
}

async function configureCodexDelegation(configPath = codexConfigPath(), options = {}) {
  let initialSnapshot;
  try {
    initialSnapshot = captureCodexConfigSnapshot(configPath);
  } catch (error) {
    return { status: 'unsupported', config_path: configPath, changed: false, detail: cleanError(error) };
  }
  const initial = initialStateFromSnapshot(initialSnapshot, configPath);
  if (initial.status !== 'unconfigured') return { ...initial, changed: false };
  const preview = {
    ...initial,
    status: 'preview',
    changed: false,
    backup_root: backupRoot(configPath),
    proposed_block: expectedCodexDelegationBlock(initial.eol || '\n'),
    proposed_action: 'isolated Codex app-server config/batchWrite',
    detail: 'Explicit limit approval may prepare the shown values through the official Codex config editor.',
  };
  const edit = options.editor
    ? await options.editor({ originalBytes: initialSnapshot.bytes, configPath })
    : await editWithCodexAppServer(initialSnapshot.bytes, options);
  let marked;
  try {
    marked = markToolkitDelegationProposal(Buffer.from(edit.bytes), configPath);
  } catch (error) {
    return { ...initial, status: 'conflicting', changed: false, detail: `Proposed Codex config failed structural validation: ${cleanError(error)}` };
  }
  if (typeof options.beforeBackup === 'function') options.beforeBackup({ configPath, initialSnapshot, proposedBytes: marked.bytes });
  try {
    assertSnapshotCurrent(configPath, initialSnapshot);
  } catch (error) {
    return concurrentEditResult(initial, error);
  }
  const backup = createCodexConfigBackup(configPath, {
    snapshot: initialSnapshot,
    replacementBytes: marked.bytes,
    backupRoot: options.backupRoot,
  });
  let wrote = false;
  try {
    if (typeof options.beforeCommit === 'function') options.beforeCommit({ configPath, initialSnapshot, backup, proposedBytes: marked.bytes });
    const writeResult = writeRegularFileAtomically(configPath, marked.bytes, backup.existed ? backup.original_mode : 0o600, {
      expectedSnapshot: initialSnapshot,
      afterReplace: options.afterReplace,
    });
    wrote = writeResult.committed;
    const verified = inspectCodexDelegationConfig(configPath);
    if (verified.status !== 'configured' || verified.ownership !== 'toolkit-managed' || verified.max_threads !== 1 || verified.max_depth !== 1) {
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
    const replacementCommitted = wrote || error.atomicReplacementCommitted === true;
    if (!replacementCommitted && /changed while the isolated proposal|changed concurrently/.test(cleanError(error))) {
      return concurrentEditResult(initial, error);
    }
    if (replacementCommitted) {
      try { restoreCodexDelegationBackup(backup.metadata_path, { configPath, backupRoot: options.backupRoot }); }
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
  markToolkitDelegationProposal,
  codexDelegationConfigState,
  inspectCodexDelegationConfig,
  previewCodexDelegation,
  editWithCodexAppServer,
  createCodexConfigBackup,
  restoreCodexDelegationBackup,
  configureCodexDelegation,
  delegationResultForChoice,
};
