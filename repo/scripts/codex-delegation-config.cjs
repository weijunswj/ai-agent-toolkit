'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { spawn, spawnSync } = require('node:child_process');
const {
  CODEX_AGENT_MAX_THREADS,
  CODEX_AGENT_MAX_DEPTH,
  CODEX_V2_RAM_SAFE_HELPERS,
  CODEX_DELEGATION_BEGIN,
  CODEX_DELEGATION_END,
  CODEX_V2_ENABLEMENT_BEGIN,
  CODEX_V2_ENABLEMENT_END,
  CODEX_HELPER_CAPACITY_BEGIN,
  CODEX_HELPER_CAPACITY_END,
  CODEX_ROOT_GUIDANCE_BEGIN,
  CODEX_ROOT_GUIDANCE_END,
  CODEX_HELPER_GUIDANCE_BEGIN,
  CODEX_HELPER_GUIDANCE_END,
  CODEX_V2_ROOT_GUIDANCE,
  CODEX_V2_HELPER_GUIDANCE,
  RESTORE_FLAG,
  cleanError,
  defaultCodexHome,
  codexConfigPath,
  backupRoot,
  parseTomlStructurally,
  helpersToTotalThreads,
} = require('./codex-delegation-common.cjs');
const { structuralLayout } = require('./codex-delegation-layout.cjs');
const {
  RUNTIMES,
  tomlString,
  managedAssignmentBlock,
  expectedLegacyBlock,
  expectedCodexDelegationBlock,
  expectedV2Block,
  codexDelegationConfigState,
} = require('./codex-delegation-state.cjs');
const {
  captureCodexConfigSnapshot,
  assertSnapshotCurrent,
  createCodexConfigBackup,
  restoreCodexDelegationBackup,
  writeRegularFileAtomically,
} = require('./codex-delegation-backup.cjs');

const TOOLKIT_CLIENT_VERSION = '2.7.3';
const TRANSIENT_CLEANUP_CODES = new Set(['EBUSY', 'ENOTEMPTY', 'EPERM']);
const APPROVAL_BINDING_SCHEMA = 'ai-agent-toolkit.codex-config-proposal-approval.v1';

function inspectCodexDelegationConfig(configPath = codexConfigPath(), runtime = RUNTIMES.UNKNOWN) {
  let stat;
  try {
    stat = fs.lstatSync(configPath);
  } catch (error) {
    if (error && error.code === 'ENOENT') return codexDelegationConfigState(Buffer.alloc(0), configPath, runtime);
    return { status: 'conflicting', runtime, config_path: configPath, detail: `Codex config could not be inspected safely: ${cleanError(error)}` };
  }
  if (stat.isSymbolicLink()) {
    let target = '';
    try { target = fs.readlinkSync(configPath); } catch {}
    return { status: 'unsupported', runtime, config_path: configPath, detail: 'Codex config is a symbolic link; Toolkit will not replace or follow it.', file_type: 'symlink', symlink_target: target };
  }
  if (!stat.isFile()) return { status: 'unsupported', runtime, config_path: configPath, detail: 'Codex config is not a regular file; Toolkit will not replace it.', file_type: 'special' };
  try {
    const state = codexDelegationConfigState(fs.readFileSync(configPath), configPath, runtime);
    return { ...state, file_type: 'regular', mode: stat.mode & 0o7777 };
  } catch (error) {
    return { status: 'conflicting', runtime, config_path: configPath, detail: `Codex config could not be read safely: ${cleanError(error)}` };
  }
}

function canReplaceUserOwnedRuntimeControls(state, runtime) {
  if (runtime === RUNTIMES.V2) {
    if (state.layout?.multiAgentV2Children?.length !== 0) return false;
    const enabled = state.parsed?.multi_agent_v2_values?.enabled;
    if (enabled?.present === true && (enabled.type !== 'bool' || enabled.value !== true)) return false;
  }
  if (String(state.ownership || '').startsWith('user-owned-compatible-')) return true;
  if (state.status !== 'conflicting' || !state.layout?.ok || !state.parsed?.ok) return false;
  if (runtime === RUNTIMES.V1) {
    return state.layout.agentsTables.length === 1
      && state.layout.beginMarkers.length === 0
      && state.layout.unsupportedAssignments.length === 0;
  }
  if (runtime === RUNTIMES.V2) {
    return state.layout.multiAgentV2Tables.length === 1
      && state.layout.multiAgentV2Children.length === 0
      && state.layout.enablementBeginMarkers.length === 0
      && state.layout.helperBeginMarkers.length === 0
      && state.layout.rootGuidanceBeginMarkers.length === 0
      && state.layout.helperGuidanceBeginMarkers.length === 0;
  }
  return false;
}

function userOwnedConfigurationMatchesSelection(state, runtime, helperCount) {
  if (state.status !== 'configured' || state.runtime !== runtime || state.helper_count !== helperCount) return false;
  if (runtime === RUNTIMES.V1) {
    return state.ownership === 'user-owned-compatible-v1'
      && state.recursive_hard_block === true;
  }
  if (runtime === RUNTIMES.V2) {
    return state.ownership === 'user-owned-compatible-v2'
      && state.enablement_ownership === 'user-owned-table'
      && state.capacity_ownership === 'user-owned'
      && state.root_guidance_ownership === 'user-owned'
      && state.helper_guidance_ownership === 'user-owned'
      && state.total_threads === helpersToTotalThreads(helperCount);
  }
  return false;
}

function cloneConfigSnapshot(snapshot) {
  return {
    ...snapshot,
    bytes: Buffer.from(snapshot.bytes),
    identity: snapshot.identity ? { ...snapshot.identity } : null,
  };
}

function approvalSnapshotDescriptor(snapshot) {
  return {
    config_path: snapshot.config_path,
    existed: snapshot.existed,
    file_type: snapshot.file_type,
    size_bytes: snapshot.size_bytes,
    sha256: snapshot.sha256,
    mode: snapshot.mode,
    identity: snapshot.identity ? { ...snapshot.identity } : null,
  };
}

function hashApprovalValue(value) {
  const input = Buffer.isBuffer(value) ? value : (typeof value === 'string' ? value : JSON.stringify(value));
  return crypto.createHash('sha256').update(input).digest('hex');
}

function proposalAffectedKeys(state, runtime, options = {}) {
  const ownership = String(state.ownership || '');
  const ownsV2 = ownership === 'toolkit-managed-v2';
  const useV2 = options.preferOwnedBlock ? ownsV2 : runtime === RUNTIMES.V2;
  if (useV2) {
    const manageEnablement = !String(state.enablement_ownership || '').startsWith('user-owned');
    return [
      ...(manageEnablement ? ['features.multi_agent_v2.enabled'] : []),
      'features.multi_agent_v2.max_concurrent_threads_per_session',
      'features.multi_agent_v2.root_agent_usage_hint_text',
      'features.multi_agent_v2.subagent_usage_hint_text',
    ];
  }
  return ['agents.max_threads', 'agents.max_depth'];
}

function removalAffectedKeys(state, runtime) {
  return proposalAffectedKeys(state, runtime, { preferOwnedBlock: true });
}

function approvalBindingPayload(binding) {

  return {
    schema: binding.schema,
    config_path: binding.config_path,
    runtime: binding.runtime,
    helper_count: binding.helper_count,
    affected_keys: binding.affected_keys,
    backup_generation_id: binding.backup_generation_id,
    proposal_sha256: binding.proposal_sha256,
    snapshot: approvalSnapshotDescriptor(binding.snapshot),
  };
}

function createApprovalBinding({ snapshot, runtime, helperCount, affectedKeys, backupGenerationId, proposedBlock }) {
  const snapshotCopy = cloneConfigSnapshot(snapshot);
  const binding = {
    schema: APPROVAL_BINDING_SCHEMA,
    config_path: snapshotCopy.config_path,
    runtime,
    helper_count: helperCount,
    affected_keys: Object.freeze([...affectedKeys]),
    backup_generation_id: backupGenerationId,
    proposal_sha256: hashApprovalValue(proposedBlock),
    snapshot: Object.freeze(snapshotCopy),
  };
  binding.approval_sha256 = hashApprovalValue(approvalBindingPayload(binding));
  return Object.freeze(binding);
}

function approvedSnapshotForConfiguration(binding, configPath, runtime, helperCount, backupGenerationId) {
  if (!binding || binding.schema !== APPROVAL_BINDING_SCHEMA || !binding.snapshot || !Buffer.isBuffer(binding.snapshot.bytes)) {
    throw new Error('Approved Codex proposal binding is missing or malformed.');
  }
  const snapshot = cloneConfigSnapshot(binding.snapshot);
  const resolvedPath = path.resolve(configPath);
  const bytesHash = snapshot.existed ? hashApprovalValue(snapshot.bytes) : null;
  if (binding.config_path !== resolvedPath
    || snapshot.config_path !== resolvedPath
    || binding.runtime !== runtime
    || binding.helper_count !== helperCount
    || binding.backup_generation_id !== backupGenerationId
    || snapshot.bytes.length !== snapshot.size_bytes
    || snapshot.sha256 !== bytesHash
    || binding.approval_sha256 !== hashApprovalValue(approvalBindingPayload(binding))) {
    throw new Error('Approved Codex proposal binding does not match the requested transaction.');
  }
  if (!snapshot.existed && (snapshot.file_type !== 'missing' || snapshot.size_bytes !== 0 || snapshot.sha256 !== null || snapshot.mode !== null || snapshot.identity !== null)) {
    throw new Error('Approved Codex proposal binding has invalid missing-file semantics.');
  }
  if (snapshot.existed && snapshot.file_type !== 'regular') throw new Error('Approved Codex proposal binding does not describe a regular file.');
  return snapshot;
}

function approvalFailureResult(runtime, configPath, status, technicalDetail) {
  const changedAfterApproval = status === 'approval-stale';
  return {
    status,
    runtime,
    config_path: path.resolve(configPath),
    changed: false,
    detail: changedAfterApproval
      ? 'Selected helper setting remains unapplied. The Codex configuration changed after you approved the proposal, so Toolkit did not apply the helper setting. Review the updated configuration and rerun setup to receive a fresh proposal. Other setup operations may already have completed; Toolkit did not roll them back.'
      : 'Selected helper setting remains unapplied. Toolkit could not verify the approved Codex proposal, so it did not apply the helper setting. Rerun setup to receive a fresh proposal.',
    approval_error: cleanError(technicalDetail),
  };
}

function previewCodexDelegation(configPath = codexConfigPath(), options = {}) {
  const runtime = options.runtime || RUNTIMES.UNKNOWN;
  const helperCount = options.helperCount ?? CODEX_V2_RAM_SAFE_HELPERS;
  let snapshot;
  try {
    snapshot = captureCodexConfigSnapshot(configPath);
  } catch {
    return { ...inspectCodexDelegationConfig(configPath, runtime), changed: false };
  }
  const state = initialStateFromSnapshot(snapshot, snapshot.config_path, runtime);
  if (userOwnedConfigurationMatchesSelection(state, runtime, helperCount)) {
    return {
      ...state,
      changed: false,
      selected_outcome_matches: true,
      requires_user_confirmation: false,
      detail: `${state.detail} The selected helper outcome already matches, so Toolkit will preserve this user-owned file without replacement.`,
    };
  }
  const configurable = state.status === 'unconfigured'
    || state.status === 'migration-required'
    || state.status === 'enablement-migration-required'
    || (state.status === 'configured' && String(state.ownership || '').startsWith('toolkit-managed'))
    || (options.allowUserOwnedReplacement && canReplaceUserOwnedRuntimeControls(state, runtime));
  if (!configurable) return { ...state, changed: false };
  const manageEnablement = runtime === RUNTIMES.V2 && !String(state.enablement_ownership || '').startsWith('user-owned');
  const backupGenerationId = `planned-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(6).toString('hex')}`;
  const backupMetadataPath = path.join(backupRoot(snapshot.config_path), backupGenerationId, 'restore.json');
  const proposedBlock = runtime === RUNTIMES.V2
    ? expectedV2Block(helperCount, state.eol || '\n', { manageEnablement })
    : expectedLegacyBlock(helperCount, state.eol || '\n');
  const affectedKeys = proposalAffectedKeys(state, runtime);
  return {
    ...state,
    status: 'preview',
    changed: false,
    helper_count: helperCount,
    total_threads: runtime === RUNTIMES.V2 ? helpersToTotalThreads(helperCount) : null,
    backup_root: backupRoot(snapshot.config_path),
    backup_generation_id: backupGenerationId,
    backup_metadata_path: backupMetadataPath,
    restore_commands: restoreCommands(backupMetadataPath, options.setupScriptPath),
    proposed_block: proposedBlock,
    proposed_action: 'isolated Codex app-server config/batchWrite with exact full-proposal delta validation',
    affected_keys: affectedKeys,
    approval_binding: createApprovalBinding({
      snapshot,
      runtime,
      helperCount,
      affectedKeys,
      backupGenerationId,
      proposedBlock,
    }),
    requires_user_confirmation: Boolean(state.legacy_values_ignored || canReplaceUserOwnedRuntimeControls(state, runtime)),
    detail: runtime === RUNTIMES.V2
      ? `The proposal allows ${helperCount} helper(s) plus the main agent (${helpersToTotalThreads(helperCount)} total session threads).`
      : `The proposal allows ${helperCount} direct helper(s) and keeps nested helper spawning blocked at depth 1.`,
  };
}

function previewCodexDelegationRemoval(configPath = codexConfigPath(), options = {}) {
  const runtime = options.runtime || RUNTIMES.UNKNOWN;
  let snapshot;
  try {
    snapshot = captureCodexConfigSnapshot(configPath);
  } catch {
    return { ...inspectCodexDelegationConfig(configPath, runtime), changed: false };
  }
  const state = initialStateFromSnapshot(snapshot, snapshot.config_path, runtime);
  if (!String(state.ownership || '').startsWith('toolkit-managed')) return { ...state, changed: false };
  const proposedBytes = removeManagedBlockBytes(state);
  const affectedKeys = removalAffectedKeys(state, runtime);
  const backupGenerationId = `planned-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(6).toString('hex')}`;
  const backupMetadataPath = path.join(backupRoot(snapshot.config_path), backupGenerationId, 'restore.json');
  return {
    ...state,
    status: 'removal-preview',
    changed: false,
    backup_root: backupRoot(snapshot.config_path),
    backup_generation_id: backupGenerationId,
    backup_metadata_path: backupMetadataPath,
    restore_commands: restoreCommands(backupMetadataPath, options.setupScriptPath),
    proposed_action: 'remove only the exact Toolkit-owned helper controls and preserve user-owned settings',
    affected_keys: affectedKeys,
    approval_binding: createApprovalBinding({
      snapshot,
      runtime,
      helperCount: 'remove',
      affectedKeys,
      backupGenerationId,
      proposedBlock: proposedBytes,
    }),
    requires_user_confirmation: true,
    detail: 'Toolkit will remove its helper limit. Codex may then use a higher host default, which can increase memory use.',
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

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function cleanupTemporaryEditorDirectory(root, options = {}) {
  const delays = options.delays || [0, 50, 150, 300, 600, 1200, 2400];
  const remove = options.remove || ((target) => fs.rmSync(target, { recursive: true, force: true }));
  let lastError = null;
  for (let index = 0; index < delays.length; index += 1) {
    const delay = delays[index];
    if (delay) await wait(delay);
    try {
      remove(root);
      return { status: 'removed', attempts: index + 1, path: root };
    } catch (error) {
      lastError = error;
      if (!TRANSIENT_CLEANUP_CODES.has(error?.code)) break;
    }
  }
  const error = new Error(`Temporary Codex editor directory could not be removed after bounded retries and was preserved for safe manual inspection: ${root}: ${cleanError(lastError)}`);
  error.cleanupPath = root;
  error.cause = lastError;
  throw error;
}

function terminateChildTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      timeout: 10000,
      stdio: 'ignore',
    });
  } else if (!child.killed) {
    child.kill('SIGTERM');
  }
}

function runAppServerRequest(command, codexHome, request, options = {}) {
  return new Promise((resolve, reject) => {
    const parts = codexCommandParts(command, ['app-server', '--listen', 'stdio://']);
    const child = spawn(parts.command, parts.args, {
      env: { ...process.env, CODEX_HOME: codexHome },
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stderr = '';
    let response;
    let settled = false;
    let shutdownTimer = null;
    let forceTimer = null;
    let pendingError = null;
    const rl = readline.createInterface({ input: child.stdout });

    const settle = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(requestTimer);
      if (shutdownTimer) clearTimeout(shutdownTimer);
      if (forceTimer) clearTimeout(forceTimer);
      rl.close();
      if (error) reject(error);
      else resolve(response);
    };
    const beginShutdown = (error = null) => {
      if (shutdownTimer || forceTimer || settled) return;
      pendingError = error;
      try { child.stdin.end(); } catch {}
      shutdownTimer = setTimeout(() => {
        terminateChildTree(child);
        forceTimer = setTimeout(
          () => settle(pendingError || new Error(`${command} app-server did not exit after bounded process-tree termination`)),
          options.forceExitTimeoutMs || 2000
        );
      }, options.closeTimeoutMs || 2000);
    };
    const requestTimer = setTimeout(() => {
      beginShutdown(new Error(`${command} app-server ${request.method} timed out`));
    }, options.timeoutMs || 15000);

    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => settle(error));
    child.on('close', (code) => {
      if (pendingError) settle(pendingError);
      else if (response !== undefined) settle();
      else settle(new Error(`${command} app-server exited ${code}: ${stderr.trim()}`));
    });
    rl.on('line', (line) => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.id === 1) {
        if (message.error) {
          beginShutdown(new Error(`app-server initialize failed: ${message.error.message || JSON.stringify(message.error)}`));
          return;
        }
        child.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`);
        child.stdin.write(`${JSON.stringify({ ...request, id: 2 })}\n`);
      } else if (message.id === 2) {
        if (message.error) {
          beginShutdown(new Error(`${request.method} failed: ${message.error.message || JSON.stringify(message.error)}`));
          return;
        }
        response = message.result;
        beginShutdown();
      }
    });
    child.stdin.write(`${JSON.stringify({
      method: 'initialize',
      id: 1,
      params: {
        clientInfo: { name: 'ai_agent_toolkit', title: 'AI Agent Toolkit', version: TOOLKIT_CLIENT_VERSION },
        capabilities: { experimentalApi: true },
      },
    })}\n`);
  });
}

async function inspectCodexMultiAgentRuntime(options = {}) {
  const codexHome = options.codexHome || defaultCodexHome();
  const failures = [];
  for (const command of appServerCandidates(options.codexCommand, codexHome)) {
    try {
      const result = await runAppServerRequest(command, codexHome, {
        method: 'experimentalFeature/list',
        params: { cursor: null, limit: 500, threadId: null },
      }, {
        cwd: options.cwd,
        timeoutMs: options.timeoutMs,
        closeTimeoutMs: options.closeTimeoutMs,
        forceExitTimeoutMs: options.forceExitTimeoutMs,
      });
      if (!Array.isArray(result?.data)) throw new Error('experimentalFeature/list did not return a feature-row array');
      const relevant = result.data.filter((feature) => feature?.name === 'multi_agent_v2' || feature?.name === 'multi_agent');
      const rows = (name) => relevant.filter((feature) => feature.name === name);
      const v2Rows = rows('multi_agent_v2');
      const v1Rows = rows('multi_agent');
      if (!v2Rows.length && !v1Rows.length) throw new Error('experimentalFeature/list reported no supported multi-agent feature row');
      if (v2Rows.length > 1 || v1Rows.length > 1) throw new Error('experimentalFeature/list reported duplicate or contradictory multi-agent feature rows');
      const v2 = v2Rows[0];
      const v1 = v1Rows[0];
      if ((v2 && typeof v2.enabled !== 'boolean') || (v1 && typeof v1.enabled !== 'boolean')) {
        throw new Error('experimentalFeature/list reported a multi-agent feature without a boolean enabled value');
      }
      const runtime = v2?.enabled === true ? RUNTIMES.V2 : (v1?.enabled === true ? RUNTIMES.V1 : RUNTIMES.DISABLED);
      return {
        runtime,
        detector: `${command} app-server experimentalFeature/list`,
        multi_agent_v2_enabled: v2 ? v2.enabled : null,
        multi_agent_v1_enabled: v1 ? v1.enabled : null,
        detail: `${runtime} detected from effective app-server feature state.`,
      };
    } catch (error) {
      failures.push(`${command}: ${cleanError(error)}`);
    }
  }
  return {
    runtime: RUNTIMES.UNKNOWN,
    detector: 'Codex app-server experimentalFeature/list unavailable',
    multi_agent_v2_enabled: null,
    multi_agent_v1_enabled: null,
    detail: `Effective Codex multi-agent runtime could not be detected safely: ${failures.join('; ') || 'no usable Codex app-server candidate'}`,
  };
}

function configEdits(runtime, helperCount) {
  if (runtime === RUNTIMES.V2) {
    return [
      { keyPath: 'features.multi_agent_v2.enabled', value: true, mergeStrategy: 'upsert' },
      { keyPath: 'features.multi_agent_v2.max_concurrent_threads_per_session', value: helpersToTotalThreads(helperCount), mergeStrategy: 'upsert' },
      { keyPath: 'features.multi_agent_v2.root_agent_usage_hint_text', value: CODEX_V2_ROOT_GUIDANCE, mergeStrategy: 'upsert' },
      { keyPath: 'features.multi_agent_v2.subagent_usage_hint_text', value: CODEX_V2_HELPER_GUIDANCE, mergeStrategy: 'upsert' },
    ];
  }
  if (runtime === RUNTIMES.V1) {
    return [
      { keyPath: 'agents.max_threads', value: helperCount, mergeStrategy: 'upsert' },
      { keyPath: 'agents.max_depth', value: CODEX_AGENT_MAX_DEPTH, mergeStrategy: 'upsert' },
    ];
  }
  throw new Error(`Helper capacity cannot be configured for runtime ${runtime}.`);
}

async function editWithCodexAppServer(originalBytes, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-codex-config-edit-'));
  const isolatedHome = path.join(root, 'codex-home');
  const isolatedConfig = path.join(isolatedHome, 'config.toml');
  fs.mkdirSync(isolatedHome, { recursive: true });
  if (originalBytes.length) fs.writeFileSync(isolatedConfig, originalBytes);
  const failures = [];
  let primaryError = null;
  try {
    for (const command of appServerCandidates(options.codexCommand, options.codexHome)) {
      try {
        await runAppServerRequest(command, isolatedHome, {
          method: 'config/batchWrite',
          params: { edits: configEdits(options.runtime, options.helperCount) },
        }, {
          timeoutMs: options.timeoutMs,
          closeTimeoutMs: options.closeTimeoutMs,
          forceExitTimeoutMs: options.forceExitTimeoutMs,
        });
        if (!fs.existsSync(isolatedConfig)) throw new Error('config/batchWrite did not create config.toml');
        return { bytes: fs.readFileSync(isolatedConfig), editor: `${command} app-server config/batchWrite`, temporary_cleanup: 'removed after child exit' };
      } catch (error) {
        failures.push(`${command}: ${cleanError(error)}`);
      }
    }
    throw new Error(`No supported Codex app-server config editor succeeded: ${failures.join('; ')}`);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await cleanupTemporaryEditorDirectory(root, options.cleanupOptions);
    } catch (cleanupError) {
      if (!primaryError) throw cleanupError;
      const combined = new Error(`${cleanError(primaryError)} Cleanup also failed: ${cleanError(cleanupError)}`);
      combined.cause = primaryError;
      combined.cleanupCause = cleanupError;
      throw combined;
    }
  }
}

function lineText(layout, index) {
  const line = layout.lines[index];
  return line.raw.slice(0, line.eol ? -line.eol.length : undefined).trim();
}

function assignmentsInsideTable(layout, table, keys) {
  const nextTable = layout.tables.find((entry) => entry.index > table.index);
  return layout.assignments
    .filter((entry) => entry.index > table.index && (!nextTable || entry.index < nextTable.index))
    .filter((entry) => keys.includes(entry.key))
    .sort((left, right) => left.index - right.index);
}

function removeSpans(text, spans) {
  return [...spans]
    .sort((left, right) => right.start - left.start)
    .reduce((current, span) => `${current.slice(0, span.start)}${current.slice(span.end)}`, text);
}

function assertProposalTextDelta(originalBytes, proposalState, runtime, helperCount) {
  const originalText = Buffer.from(originalBytes).toString('utf8');
  const originalLayout = structuralLayout(originalText);
  const proposalLayout = proposalState.layout;
  const target = runtime === RUNTIMES.V2
    ? {
        tableName: 'features.multi_agent_v2',
        tables: proposalLayout.multiAgentV2Tables,
        originalTables: originalLayout.multiAgentV2Tables,
        keys: ['enabled', 'max_concurrent_threads_per_session', 'root_agent_usage_hint_text', 'subagent_usage_hint_text'],
        lines: [
          'enabled = true',
          `max_concurrent_threads_per_session = ${helpersToTotalThreads(helperCount)}`,
          `root_agent_usage_hint_text = ${tomlString(CODEX_V2_ROOT_GUIDANCE)}`,
          `subagent_usage_hint_text = ${tomlString(CODEX_V2_HELPER_GUIDANCE)}`,
        ],
      }
    : {
        tableName: 'agents',
        tables: proposalLayout.agentsTables,
        originalTables: originalLayout.agentsTables,
        keys: ['max_threads', 'max_depth'],
        lines: [`max_threads = ${helperCount}`, `max_depth = 1`],
      };
  if (!originalLayout.ok || target.tables.length !== 1 || target.originalTables.length > 1) {
    throw new Error(`Official Codex editor proposal has an unsupported ${target.tableName} table layout.`);
  }
  const table = target.tables[0];
  const assignments = assignmentsInsideTable(proposalLayout, table, target.keys);
  const originalAssignments = target.originalTables.length === 1
    ? assignmentsInsideTable(originalLayout, target.originalTables[0], target.keys)
    : [];
  const originalByKey = new Map(originalAssignments.map((assignment) => [assignment.key, assignment]));
  if (assignments.length !== target.lines.length
    || assignments.some((assignment, index) => {
      if (assignment.key !== target.keys[index]) return true;
      const original = originalByKey.get(assignment.key);
      if (runtime === RUNTIMES.V2 && assignment.key === 'enabled' && original) {
        return proposalState.text.slice(assignment.start, assignment.end) !== originalText.slice(original.start, original.end);
      }
      return lineText(proposalLayout, assignment.index) !== target.lines[index];
    })) {
    throw new Error('Official Codex editor proposal does not contain exactly the approved helper-capacity assignments in canonical order.');
  }

  if (target.originalTables.length === 1) {
    const strippedProposal = removeSpans(proposalState.text, assignments);
    const strippedOriginal = removeSpans(originalText, originalAssignments);
    if (strippedProposal !== strippedOriginal) throw new Error('Official Codex editor proposal changed text outside the approved helper-capacity assignments.');
    return;
  }

  const nextTable = proposalLayout.tables.find((entry) => entry.index > table.index);
  if (nextTable) throw new Error(`Official Codex editor created ${target.tableName} before unrelated tables instead of appending an isolated table.`);
  const regionEnd = assignments[assignments.length - 1].end;
  if (proposalState.text.slice(regionEnd).trim() !== '') throw new Error('Official Codex editor proposal added unapproved content after the helper-capacity table.');
  const prefix = proposalState.text.slice(0, table.start);
  if (!prefix.startsWith(originalText) || !/^[\r\n]*$/.test(prefix.slice(originalText.length))) {
    throw new Error('Official Codex editor proposal changed text before the newly created helper-capacity table.');
  }
}

function markToolkitProposal(configBytes, configPath, runtime, helperCount, originalBytes, options = {}) {
  const proposed = codexDelegationConfigState(configBytes, configPath, runtime);
  const expectedOwnership = runtime === RUNTIMES.V2 ? 'user-owned-compatible-v2' : 'user-owned-compatible-v1';
  if (proposed.status !== 'configured' || proposed.ownership !== expectedOwnership || proposed.helper_count !== helperCount) {
    throw new Error(`Official Codex editor proposal must contain exactly the approved unmarked ${runtime} helper capacity before Toolkit markers can be added.`);
  }
  assertProposalTextDelta(originalBytes, proposed, runtime, helperCount);
  const layout = proposed.layout;
  const table = runtime === RUNTIMES.V2 ? layout.multiAgentV2Tables[0] : layout.agentsTables[0];
  const keys = runtime === RUNTIMES.V2
    ? ['enabled', 'max_concurrent_threads_per_session', 'root_agent_usage_hint_text', 'subagent_usage_hint_text']
    : ['max_threads', 'max_depth'];
  const assignments = assignmentsInsideTable(layout, table, keys);
  if (assignments.some((entry, index) => index > 0 && entry.index !== assignments[index - 1].index + 1)) {
    throw new Error('Official Codex editor proposal does not place the approved helper-capacity assignments together.');
  }
  const eol = proposed.eol || '\n';
  let markedText = proposed.text;
  if (runtime === RUNTIMES.V2) {
    const manageEnablement = options.manageEnablement !== false;
    const replacements = [
      ...(manageEnablement ? [[assignments[0], managedAssignmentBlock(CODEX_V2_ENABLEMENT_BEGIN, 'enabled = true', CODEX_V2_ENABLEMENT_END, eol)]] : []),
      [assignments[1], managedAssignmentBlock(CODEX_HELPER_CAPACITY_BEGIN, `max_concurrent_threads_per_session = ${helpersToTotalThreads(helperCount)}`, CODEX_HELPER_CAPACITY_END, eol)],
      [assignments[2], managedAssignmentBlock(CODEX_ROOT_GUIDANCE_BEGIN, `root_agent_usage_hint_text = ${tomlString(CODEX_V2_ROOT_GUIDANCE)}`, CODEX_ROOT_GUIDANCE_END, eol)],
      [assignments[3], managedAssignmentBlock(CODEX_HELPER_GUIDANCE_BEGIN, `subagent_usage_hint_text = ${tomlString(CODEX_V2_HELPER_GUIDANCE)}`, CODEX_HELPER_GUIDANCE_END, eol)],
    ];
    for (const [assignment, block] of replacements.sort((left, right) => right[0].start - left[0].start)) {
      const line = layout.lines[assignment.index];
      markedText = `${markedText.slice(0, assignment.start)}${block}${line.eol ? eol : ''}${markedText.slice(assignment.end)}`;
    }
  } else {
    const first = assignments[0];
    const last = assignments[assignments.length - 1];
    const lastLine = layout.lines[last.index];
    const block = expectedLegacyBlock(helperCount, eol);
    markedText = `${proposed.text.slice(0, first.start)}${block}${lastLine.eol ? eol : ''}${proposed.text.slice(last.end)}`;
  }
  const marked = Buffer.from(markedText, 'utf8');
  const verified = codexDelegationConfigState(marked, configPath, runtime);
  const managedOwnership = runtime === RUNTIMES.V2 ? 'toolkit-managed-v2' : 'toolkit-managed-v1';
  if (verified.status !== 'configured' || verified.ownership !== managedOwnership || verified.helper_count !== helperCount) {
    throw new Error(`Final Toolkit-marked Codex proposal failed structural validation: ${verified.detail || verified.status}`);
  }
  return { bytes: marked, state: verified };
}

function managedMarkerSpans(state) {
  const layout = state.layout;
  if (state.ownership === 'toolkit-managed-v2') {
    return [
      ...(state.enablement_ownership === 'toolkit-managed' ? [{ begin: layout.enablementBeginMarkers[0], end: layout.enablementEndMarkers[0] }] : []),
      { begin: layout.helperBeginMarkers[0], end: layout.helperEndMarkers[0] },
      { begin: layout.rootGuidanceBeginMarkers[0], end: layout.rootGuidanceEndMarkers[0] },
      { begin: layout.helperGuidanceBeginMarkers[0], end: layout.helperGuidanceEndMarkers[0] },
    ];
  }
  if (state.ownership === 'toolkit-managed-v1' || state.ownership === 'toolkit-managed-v1-legacy') return [{ begin: layout.beginMarkers[0], end: layout.endMarkers[0] }];
  return [];
}

function removeManagedBlockBytes(state) {
  const spans = managedMarkerSpans(state);
  if (!spans.length) throw new Error('No exact Toolkit-managed helper-capacity block is available for migration or removal.');
  return Buffer.from(removeSpans(state.text, spans.map((span) => ({ start: span.begin.start, end: span.end.end }))), 'utf8');
}

function migrateV2BooleanEnablement(state) {
  if (state.ownership !== 'user-owned-compatible-v2-enable') throw new Error('No compatible MultiAgentV2 boolean enablement is available for migration.');
  const table = state.layout.featuresTables[0];
  const nextTable = state.layout.tables.find((entry) => entry.index > table.index);
  const assignment = state.layout.assignments.find((entry) => entry.index > table.index
    && (!nextTable || entry.index < nextTable.index)
    && entry.key.replace(/\s+/g, '') === 'multi_agent_v2'
    && entry.value.trim() === 'true');
  if (!assignment) throw new Error('The compatible MultiAgentV2 boolean enablement could not be located exactly.');
  const raw = state.text.slice(assignment.start, assignment.end);
  const eol = raw.endsWith('\r\n') ? '\r\n' : (raw.endsWith('\n') ? '\n' : '');
  const line = eol ? raw.slice(0, -eol.length) : raw;
  const indent = line.match(/^[ \t]*/)?.[0] || '';
  const commentStart = line.search(/[ \t]+#|#/);
  const replacement = commentStart >= 0 ? `${indent}${line.slice(commentStart)}${eol}` : '';
  return Buffer.from(`${state.text.slice(0, assignment.start)}${replacement}${state.text.slice(assignment.end)}`, 'utf8');
}

function initialStateFromSnapshot(snapshot, configPath, runtime) {
  const state = codexDelegationConfigState(snapshot.bytes, configPath, runtime);
  return { ...state, file_type: snapshot.file_type, mode: snapshot.mode };
}

function concurrentEditResult(current, error) {
  return { ...current, status: 'conflicting', changed: false, detail: `Codex helper capacity was not written because the target changed concurrently: ${cleanError(error)}` };
}

function quotePowerShellArgument(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function quotePosixArgument(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function verifiedSetupScriptPath(setupScriptPath = path.join(__dirname, 'setup-toolkit.cjs')) {
  const resolved = path.resolve(setupScriptPath);
  let stat;
  try { stat = fs.lstatSync(resolved); } catch (error) { throw new Error(`Exact restore command setup script is unavailable: ${resolved}: ${cleanError(error)}`); }
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Exact restore command setup script must be a verified regular file, not a symlink: ${resolved}`);
  return fs.realpathSync(resolved);
}

function restoreCommands(metadataPath, setupScriptPath) {
  const scriptPath = verifiedSetupScriptPath(setupScriptPath);
  return {
    setup_script_path: scriptPath,
    powershell: `node ${quotePowerShellArgument(scriptPath)} ${RESTORE_FLAG} ${quotePowerShellArgument(path.resolve(metadataPath))}`,
    posix: `node ${quotePosixArgument(scriptPath)} ${RESTORE_FLAG} ${quotePosixArgument(path.resolve(metadataPath))}`,
  };
}

function commitProposal(configPath, initialSnapshot, initial, proposedBytes, verify, options = {}) {
  if (typeof options.beforeBackup === 'function') options.beforeBackup({ configPath, initialSnapshot, proposedBytes });
  try {
    assertSnapshotCurrent(configPath, initialSnapshot);
  } catch (error) {
    return concurrentEditResult(initial, error);
  }
  const backup = createCodexConfigBackup(configPath, { snapshot: initialSnapshot, replacementBytes: proposedBytes, backupRoot: options.backupRoot, generationId: options.backupGenerationId });
  let wrote = false;
  try {
    if (typeof options.beforeCommit === 'function') options.beforeCommit({ configPath, initialSnapshot, backup, proposedBytes });
    const writeResult = writeRegularFileAtomically(configPath, proposedBytes, backup.existed ? backup.original_mode : 0o600, { expectedSnapshot: initialSnapshot, afterReplace: options.afterReplace });
    wrote = writeResult.committed;
    const verified = verify();
    if (typeof options.afterWrite === 'function') options.afterWrite({ configPath, backup, verified });
    return {
      ...verified,
      changed: true,
      backup_metadata_path: backup.metadata_path,
      restore_commands: restoreCommands(backup.metadata_path, options.setupScriptPath),
    };
  } catch (error) {
    const replacementCommitted = wrote || error.atomicReplacementCommitted === true;
    if (!replacementCommitted && /changed while the isolated proposal|changed concurrently/.test(cleanError(error))) return concurrentEditResult(initial, error);
    if (replacementCommitted) {
      try { restoreCodexDelegationBackup(backup.metadata_path, { configPath, backupRoot: options.backupRoot }); }
      catch (restoreError) {
        const combined = new Error(`Codex helper-capacity configuration failed and exact restoration also failed: ${cleanError(restoreError)}`);
        combined.cause = error;
        throw combined;
      }
    }
    throw error;
  }
}

async function configureCodexDelegation(configPath = codexConfigPath(), options = {}) {
  const runtime = options.runtime || RUNTIMES.UNKNOWN;
  const helperCount = options.helperCount ?? CODEX_V2_RAM_SAFE_HELPERS;
  if (!Number.isSafeInteger(helperCount) || helperCount < 0) throw new Error('Helper count must be a non-negative integer.');
  let initialSnapshot;
  const approvedProposal = options.approvedProposal || null;
  const backupGenerationId = options.backupGenerationId || approvedProposal?.backup_generation_id;
  if (approvedProposal) {
    try {
      initialSnapshot = approvedSnapshotForConfiguration(approvedProposal, configPath, runtime, helperCount, backupGenerationId);
    } catch (error) {
      return approvalFailureResult(runtime, configPath, 'approval-invalid', error);
    }
    try {
      assertSnapshotCurrent(configPath, initialSnapshot, 'Codex config changed after proposal approval.');
    } catch (error) {
      return approvalFailureResult(runtime, configPath, 'approval-stale', error);
    }
  } else {
    try {
      initialSnapshot = captureCodexConfigSnapshot(configPath);
    } catch (error) {
      return { status: 'unsupported', runtime, config_path: configPath, changed: false, detail: cleanError(error) };
    }
  }
  const initial = initialStateFromSnapshot(initialSnapshot, configPath, runtime);
  if (![RUNTIMES.V2, RUNTIMES.V1].includes(runtime)) return { ...initial, changed: false };
  const manageEnablement = runtime === RUNTIMES.V2 && !String(initial.enablement_ownership || '').startsWith('user-owned');
  if (approvedProposal) {
    const expectedBlock = runtime === RUNTIMES.V2
      ? expectedV2Block(helperCount, initial.eol || '\n', { manageEnablement })
      : expectedLegacyBlock(helperCount, initial.eol || '\n');
    const expectedKeys = proposalAffectedKeys(initial, runtime);
    if (approvedProposal.proposal_sha256 !== hashApprovalValue(expectedBlock)
      || JSON.stringify(approvedProposal.affected_keys) !== JSON.stringify(expectedKeys)) {
      return approvalFailureResult(runtime, configPath, 'approval-invalid', 'Approved Codex proposal identity does not match the approved snapshot.');
    }
  }
  if (initial.status === 'configured' && initial.helper_count === helperCount) return { ...initial, changed: false };
  const toolkitOwned = String(initial.ownership || '').startsWith('toolkit-managed');
  const replaceUserOwned = options.allowUserOwnedReplacement && canReplaceUserOwnedRuntimeControls(initial, runtime);
  if (!['unconfigured', 'migration-required', 'enablement-migration-required'].includes(initial.status) && !toolkitOwned && !replaceUserOwned) return { ...initial, changed: false };

  const stagedBytes = initial.status === 'enablement-migration-required'
    ? migrateV2BooleanEnablement(initial)
    : (toolkitOwned || initial.status === 'migration-required' ? removeManagedBlockBytes(initial) : initialSnapshot.bytes);
  const stagedState = codexDelegationConfigState(stagedBytes, configPath, runtime);
  if (stagedState.status !== 'unconfigured' && !replaceUserOwned) {
    return { ...initial, status: 'conflicting', changed: false, detail: `Toolkit-owned block removal did not produce an unconfigured ${runtime} proposal base: ${stagedState.detail}` };
  }
  if (approvedProposal) {
    try {
      assertSnapshotCurrent(configPath, initialSnapshot, 'Codex config changed after proposal approval and before editor invocation.');
    } catch (error) {
      return approvalFailureResult(runtime, configPath, 'approval-stale', error);
    }
  }
  const edit = options.editor
    ? await options.editor({ originalBytes: stagedBytes, configPath, runtime, helperCount })
    : await editWithCodexAppServer(stagedBytes, { ...options, runtime, helperCount });
  let marked;
  try {
    marked = markToolkitProposal(Buffer.from(edit.bytes), configPath, runtime, helperCount, stagedBytes, { manageEnablement });
  } catch (error) {
    return { ...initial, status: 'conflicting', changed: false, detail: `Proposed Codex config failed complete proposal validation: ${cleanError(error)}` };
  }
  const result = commitProposal(
    configPath,
    initialSnapshot,
    initial,
    marked.bytes,
    () => {
      const verified = inspectCodexDelegationConfig(configPath, runtime);
      const ownership = runtime === RUNTIMES.V2 ? 'toolkit-managed-v2' : 'toolkit-managed-v1';
      if (verified.status !== 'configured' || verified.ownership !== ownership || verified.helper_count !== helperCount) {
        throw new Error(`Post-write Codex config verification failed: ${verified.detail || verified.status}`);
      }
      return verified;
    },
    { ...options, backupGenerationId }
  );
  return {
    ...result,
    editor: edit.editor || 'injected test editor',
    proposed_block: runtime === RUNTIMES.V2 ? expectedV2Block(helperCount, initial.eol || '\n', { manageEnablement }) : expectedLegacyBlock(helperCount, initial.eol || '\n'),
    migrated_legacy_block: initial.status === 'migration-required',
    migrated_v2_boolean_enablement: initial.status === 'enablement-migration-required',
    temporary_cleanup: edit.temporary_cleanup || 'test editor did not create a temporary app-server directory',
  };
}

function removeCodexDelegation(configPath = codexConfigPath(), options = {}) {
  const runtime = options.runtime || RUNTIMES.UNKNOWN;
  let initialSnapshot;
  const approvedProposal = options.approvedProposal || null;
  const backupGenerationId = options.backupGenerationId || approvedProposal?.backup_generation_id;
  if (approvedProposal) {
    try {
      initialSnapshot = approvedSnapshotForConfiguration(approvedProposal, configPath, runtime, 'remove', backupGenerationId);
      assertSnapshotCurrent(configPath, initialSnapshot, 'Codex config changed after removal proposal approval.');
    } catch (error) {
      return approvalFailureResult(runtime, configPath, /changed after/.test(cleanError(error)) ? 'approval-stale' : 'approval-invalid', error);
    }
  } else {
    try {
      initialSnapshot = captureCodexConfigSnapshot(configPath);
    } catch (error) {
      return { status: 'unsupported', runtime, config_path: configPath, changed: false, detail: cleanError(error) };
    }
  }
  const initial = initialStateFromSnapshot(initialSnapshot, configPath, runtime);
  const toolkitOwned = String(initial.ownership || '').startsWith('toolkit-managed');
  if (!toolkitOwned && initial.status !== 'migration-required') {
    return { ...initial, changed: false, detail: `${initial.detail} No Toolkit-managed helper-capacity block was removed.` };
  }
  if (!options.approveCapacityResetRisk) {
    return { ...initial, status: 'approval-required', changed: false, detail: 'Removal may restore a higher host-default helper capacity. Review the warning and explicitly approve removal before Toolkit changes the file.' };
  }
  const proposedBytes = removeManagedBlockBytes(initial);
  if (approvedProposal && (
    approvedProposal.proposal_sha256 !== hashApprovalValue(proposedBytes)
    || JSON.stringify(approvedProposal.affected_keys) !== JSON.stringify(removalAffectedKeys(initial, runtime))
  )) {
    return approvalFailureResult(runtime, configPath, 'approval-invalid', 'Approved removal proposal does not match the current Toolkit-owned controls.');
  }
  return commitProposal(
    configPath,
    initialSnapshot,
    initial,
    proposedBytes,
    () => {
      const committedBytes = fs.readFileSync(configPath);
      const verified = inspectCodexDelegationConfig(configPath, runtime);
      const remainingLayout = structuralLayout(committedBytes.toString('utf8'));
      const markerCount = [
        'beginMarkers', 'endMarkers',
        'enablementBeginMarkers', 'enablementEndMarkers',
        'helperBeginMarkers', 'helperEndMarkers',
        'rootGuidanceBeginMarkers', 'rootGuidanceEndMarkers',
        'helperGuidanceBeginMarkers', 'helperGuidanceEndMarkers',
        'unknownToolkitDelegationMarkers',
      ]
        .reduce((count, key) => count + remainingLayout[key].length, 0);
      if (!committedBytes.equals(proposedBytes) || !remainingLayout.ok || markerCount) throw new Error(`Post-removal verification failed: ${verified.detail || verified.status}`);
      return { ...verified, status: 'removed', changed: true, detail: 'Exact Toolkit-managed helper capacity and any Toolkit-owned enablement were removed; user-owned enablement and settings were preserved.' };
    },
    { ...options, backupGenerationId }
  );
}

async function delegationResultForChoice(choice, configPath = codexConfigPath(), options = {}) {
  const runtime = options.runtime || RUNTIMES.UNKNOWN;
  const current = inspectCodexDelegationConfig(configPath, runtime);
  if (choice === 'skip') return { ...current, status: 'skipped', changed: false, detail: 'Codex helper-capacity configuration was explicitly skipped.' };
  if (choice === 'remove') return removeCodexDelegation(configPath, { ...options, approveCapacityResetRisk: true });
  if (choice === 'keep') {
    return { ...current, status: current.status === 'configured' ? 'configured' : 'kept', changed: false, detail: current.status === 'configured' ? current.detail : `${current.detail} Current helper capacity was kept unchanged.` };
  }
  if (choice === 'migrate') {
    if (runtime !== RUNTIMES.V2 || current.status !== 'migration-required') return { ...current, changed: false, detail: `${current.detail} No exact Toolkit-managed legacy setting is available to migrate.` };
    if (options.approvedProposal) return configureCodexDelegation(configPath, { ...options, helperCount: options.helperCount });
    return configureCodexDelegation(configPath, { ...options, helperCount: current.helper_count });
  }
  if (choice === 'ram-safe') return configureCodexDelegation(configPath, { ...options, helperCount: CODEX_V2_RAM_SAFE_HELPERS });
  if (choice === 'custom') return configureCodexDelegation(configPath, options);
  throw new Error(`Unsupported helper-capacity choice: ${choice}`);
}

module.exports = {
  CODEX_AGENT_MAX_THREADS,
  CODEX_AGENT_MAX_DEPTH,
  CODEX_V2_RAM_SAFE_HELPERS,
  CODEX_DELEGATION_BEGIN,
  CODEX_DELEGATION_END,
  CODEX_V2_ENABLEMENT_BEGIN,
  CODEX_V2_ENABLEMENT_END,
  CODEX_HELPER_CAPACITY_BEGIN,
  CODEX_HELPER_CAPACITY_END,
  CODEX_ROOT_GUIDANCE_BEGIN,
  CODEX_ROOT_GUIDANCE_END,
  CODEX_HELPER_GUIDANCE_BEGIN,
  CODEX_HELPER_GUIDANCE_END,
  CODEX_V2_ROOT_GUIDANCE,
  CODEX_V2_HELPER_GUIDANCE,
  RESTORE_FLAG,
  RUNTIMES,
  defaultCodexHome,
  codexConfigPath,
  parseTomlStructurally,
  structuralLayout,
  expectedCodexDelegationBlock,
  expectedLegacyBlock,
  expectedV2Block,
  codexDelegationConfigState,
  inspectCodexDelegationConfig,
  inspectCodexMultiAgentRuntime,
  previewCodexDelegation,
  previewCodexDelegationRemoval,
  cleanupTemporaryEditorDirectory,
  editWithCodexAppServer,
  assertProposalTextDelta,
  markToolkitDelegationProposal: markToolkitProposal,
  removeManagedBlockBytes,
  quotePowerShellArgument,
  quotePosixArgument,
  canReplaceUserOwnedRuntimeControls,
  verifiedSetupScriptPath,
  restoreCommands,
  createCodexConfigBackup,
  restoreCodexDelegationBackup,
  configureCodexDelegation,
  removeCodexDelegation,
  delegationResultForChoice,
};
