'use strict';

const fs = require('node:fs');
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
  CODEX_HELPER_CAPACITY_BEGIN,
  CODEX_HELPER_CAPACITY_END,
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

const TOOLKIT_CLIENT_VERSION = '2.4.5';
const TRANSIENT_CLEANUP_CODES = new Set(['EBUSY', 'ENOTEMPTY', 'EPERM']);

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

function previewCodexDelegation(configPath = codexConfigPath(), options = {}) {
  const runtime = options.runtime || RUNTIMES.UNKNOWN;
  const helperCount = options.helperCount ?? CODEX_V2_RAM_SAFE_HELPERS;
  const state = inspectCodexDelegationConfig(configPath, runtime);
  const configurable = state.status === 'unconfigured'
    || state.status === 'migration-required'
    || state.status === 'enablement-migration-required'
    || (state.status === 'configured' && String(state.ownership || '').startsWith('toolkit-managed'));
  if (!configurable) return { ...state, changed: false };
  return {
    ...state,
    status: 'preview',
    changed: false,
    helper_count: helperCount,
    total_threads: runtime === RUNTIMES.V2 ? helpersToTotalThreads(helperCount) : null,
    backup_root: backupRoot(configPath),
    proposed_block: runtime === RUNTIMES.V2 ? expectedV2Block(helperCount, state.eol || '\n') : expectedLegacyBlock(helperCount, state.eol || '\n'),
    proposed_action: 'isolated Codex app-server config/batchWrite with exact full-proposal delta validation',
    detail: runtime === RUNTIMES.V2
      ? `The proposal allows ${helperCount} helper(s) plus the main agent (${helpersToTotalThreads(helperCount)} total session threads).`
      : `The proposal allows ${helperCount} direct helper(s) and keeps nested helper spawning blocked at depth 1.`,
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
      const features = Array.isArray(result?.data) ? result.data : [];
      const v2 = features.find((feature) => feature?.name === 'multi_agent_v2');
      const v1 = features.find((feature) => feature?.name === 'multi_agent');
      if (!v2 || !v1 || typeof v2.enabled !== 'boolean' || typeof v1.enabled !== 'boolean') {
        throw new Error('experimentalFeature/list did not report both multi_agent_v2 and multi_agent');
      }
      const runtime = v2.enabled ? RUNTIMES.V2 : (v1.enabled ? RUNTIMES.V1 : RUNTIMES.DISABLED);
      return {
        runtime,
        detector: `${command} app-server experimentalFeature/list`,
        multi_agent_v2_enabled: v2.enabled,
        multi_agent_v1_enabled: v1.enabled,
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
  if (assignments.length !== target.lines.length
    || assignments.some((assignment, index) => assignment.key !== target.keys[index] || lineText(proposalLayout, assignment.index) !== target.lines[index])) {
    throw new Error('Official Codex editor proposal does not contain exactly the approved helper-capacity assignments in canonical order.');
  }

  if (target.originalTables.length === 1) {
    const originalAssignments = assignmentsInsideTable(originalLayout, target.originalTables[0], target.keys);
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

function markToolkitProposal(configBytes, configPath, runtime, helperCount, originalBytes) {
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
  const first = assignments[0];
  const last = assignments[assignments.length - 1];
  const lastLine = layout.lines[last.index];
  const block = runtime === RUNTIMES.V2 ? expectedV2Block(helperCount, eol) : expectedLegacyBlock(helperCount, eol);
  const marked = Buffer.from(`${proposed.text.slice(0, first.start)}${block}${lastLine.eol ? eol : ''}${proposed.text.slice(last.end)}`, 'utf8');
  const verified = codexDelegationConfigState(marked, configPath, runtime);
  const managedOwnership = runtime === RUNTIMES.V2 ? 'toolkit-managed-v2' : 'toolkit-managed-v1';
  if (verified.status !== 'configured' || verified.ownership !== managedOwnership || verified.helper_count !== helperCount) {
    throw new Error(`Final Toolkit-marked Codex proposal failed structural validation: ${verified.detail || verified.status}`);
  }
  return { bytes: marked, state: verified };
}

function managedMarkerSpan(state) {
  const layout = state.layout;
  if (state.ownership === 'toolkit-managed-v2') return { begin: layout.helperBeginMarkers[0], end: layout.helperEndMarkers[0] };
  if (state.ownership === 'toolkit-managed-v1' || state.ownership === 'toolkit-managed-v1-legacy') return { begin: layout.beginMarkers[0], end: layout.endMarkers[0] };
  return null;
}

function removeManagedBlockBytes(state) {
  const span = managedMarkerSpan(state);
  if (!span) throw new Error('No exact Toolkit-managed helper-capacity block is available for migration or removal.');
  return Buffer.from(`${state.text.slice(0, span.begin.start)}${state.text.slice(span.end.end)}`, 'utf8');
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
  return Buffer.from(`${state.text.slice(0, assignment.start)}${state.text.slice(assignment.end)}`, 'utf8');
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

function restoreCommands(metadataPath) {
  return {
    powershell: `node repo/scripts/setup-toolkit.cjs ${RESTORE_FLAG} ${quotePowerShellArgument(metadataPath)}`,
    posix: `node repo/scripts/setup-toolkit.cjs ${RESTORE_FLAG} ${quotePosixArgument(metadataPath)}`,
  };
}

function commitProposal(configPath, initialSnapshot, initial, proposedBytes, verify, options = {}) {
  if (typeof options.beforeBackup === 'function') options.beforeBackup({ configPath, initialSnapshot, proposedBytes });
  try {
    assertSnapshotCurrent(configPath, initialSnapshot);
  } catch (error) {
    return concurrentEditResult(initial, error);
  }
  const backup = createCodexConfigBackup(configPath, { snapshot: initialSnapshot, replacementBytes: proposedBytes, backupRoot: options.backupRoot });
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
      restore_commands: restoreCommands(backup.metadata_path),
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
  try {
    initialSnapshot = captureCodexConfigSnapshot(configPath);
  } catch (error) {
    return { status: 'unsupported', runtime, config_path: configPath, changed: false, detail: cleanError(error) };
  }
  const initial = initialStateFromSnapshot(initialSnapshot, configPath, runtime);
  if (![RUNTIMES.V2, RUNTIMES.V1].includes(runtime)) return { ...initial, changed: false };
  if (initial.status === 'configured' && initial.helper_count === helperCount) return { ...initial, changed: false };
  const toolkitOwned = String(initial.ownership || '').startsWith('toolkit-managed');
  if (!['unconfigured', 'migration-required', 'enablement-migration-required'].includes(initial.status) && !toolkitOwned) return { ...initial, changed: false };

  const stagedBytes = initial.status === 'enablement-migration-required'
    ? migrateV2BooleanEnablement(initial)
    : (toolkitOwned || initial.status === 'migration-required' ? removeManagedBlockBytes(initial) : initialSnapshot.bytes);
  const stagedState = codexDelegationConfigState(stagedBytes, configPath, runtime);
  if (stagedState.status !== 'unconfigured') {
    return { ...initial, status: 'conflicting', changed: false, detail: `Toolkit-owned block removal did not produce an unconfigured ${runtime} proposal base: ${stagedState.detail}` };
  }
  const edit = options.editor
    ? await options.editor({ originalBytes: stagedBytes, configPath, runtime, helperCount })
    : await editWithCodexAppServer(stagedBytes, { ...options, runtime, helperCount });
  let marked;
  try {
    marked = markToolkitProposal(Buffer.from(edit.bytes), configPath, runtime, helperCount, stagedBytes);
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
    options
  );
  return {
    ...result,
    editor: edit.editor || 'injected test editor',
    proposed_block: runtime === RUNTIMES.V2 ? expectedV2Block(helperCount, initial.eol || '\n') : expectedLegacyBlock(helperCount, initial.eol || '\n'),
    migrated_legacy_block: initial.status === 'migration-required',
    migrated_v2_boolean_enablement: initial.status === 'enablement-migration-required',
    temporary_cleanup: edit.temporary_cleanup || 'test editor did not create a temporary app-server directory',
  };
}

function removeCodexDelegation(configPath = codexConfigPath(), options = {}) {
  const runtime = options.runtime || RUNTIMES.UNKNOWN;
  let initialSnapshot;
  try {
    initialSnapshot = captureCodexConfigSnapshot(configPath);
  } catch (error) {
    return { status: 'unsupported', runtime, config_path: configPath, changed: false, detail: cleanError(error) };
  }
  const initial = initialStateFromSnapshot(initialSnapshot, configPath, runtime);
  const toolkitOwned = String(initial.ownership || '').startsWith('toolkit-managed');
  if (!toolkitOwned && initial.status !== 'migration-required') {
    return { ...initial, changed: false, detail: `${initial.detail} No Toolkit-managed helper-capacity block was removed.` };
  }
  const proposedBytes = removeManagedBlockBytes(initial);
  return commitProposal(
    configPath,
    initialSnapshot,
    initial,
    proposedBytes,
    () => {
      const verified = inspectCodexDelegationConfig(configPath, runtime);
      if (verified.status !== 'unconfigured') throw new Error(`Post-removal verification failed: ${verified.detail || verified.status}`);
      return { ...verified, status: 'removed', detail: 'Toolkit-managed helper capacity was removed; user-owned settings were preserved.' };
    },
    options
  );
}

async function delegationResultForChoice(choice, configPath = codexConfigPath(), options = {}) {
  const runtime = options.runtime || RUNTIMES.UNKNOWN;
  const current = inspectCodexDelegationConfig(configPath, runtime);
  if (choice === 'skip') return { ...current, status: 'skipped', changed: false, detail: 'Codex helper-capacity configuration was explicitly skipped.' };
  if (choice === 'remove') return removeCodexDelegation(configPath, options);
  if (choice === 'keep') {
    if (runtime === RUNTIMES.V2 && current.status === 'migration-required') {
      return configureCodexDelegation(configPath, { ...options, helperCount: current.helper_count });
    }
    return { ...current, status: current.status === 'configured' ? 'configured' : 'kept', changed: false, detail: current.status === 'configured' ? current.detail : `${current.detail} Current helper capacity was kept unchanged.` };
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
  CODEX_HELPER_CAPACITY_BEGIN,
  CODEX_HELPER_CAPACITY_END,
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
  cleanupTemporaryEditorDirectory,
  editWithCodexAppServer,
  assertProposalTextDelta,
  markToolkitDelegationProposal: markToolkitProposal,
  removeManagedBlockBytes,
  quotePowerShellArgument,
  quotePosixArgument,
  restoreCommands,
  createCodexConfigBackup,
  restoreCodexDelegationBackup,
  configureCodexDelegation,
  removeCodexDelegation,
  delegationResultForChoice,
};
