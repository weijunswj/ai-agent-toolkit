'use strict';

const fs = require('node:fs');
const {
  CODEX_AGENT_MAX_THREADS,
  CODEX_AGENT_MAX_DEPTH,
  CODEX_DELEGATION_BEGIN,
  CODEX_DELEGATION_END,
  RESTORE_FLAG,
  cleanError,
  defaultCodexHome,
  codexConfigPath,
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

function insertionForState(state) {
  if (state.status !== 'unconfigured' || !state.layout) return { ok: false, detail: 'Codex config is not safely editable.' };
  const eol = state.eol || '\n';
  const block = expectedCodexDelegationBlock(eol);
  const agents = state.layout.agentsTables[0];
  if (agents) {
    const insertion = agents.end;
    const headerEol = state.layout.lines[agents.index]?.eol || '';
    const prefix = headerEol ? '' : eol;
    return {
      ok: true,
      block,
      nextText: `${state.text.slice(0, insertion)}${prefix}${block}${eol}${state.text.slice(insertion)}`,
      action: 'insert-into-agents-table',
    };
  }
  if (state.layout.agentsChildren.length) return { ok: false, detail: 'An implicit agents table cannot be edited surgically.' };
  const separator = state.text.length === 0 ? '' : (state.text.endsWith('\n') ? eol : `${eol}${eol}`);
  return {
    ok: true,
    block,
    nextText: `${state.text}${separator}[agents]${eol}${block}${eol}`,
    action: 'append-agents-table',
  };
}

function previewCodexDelegation(configPath = codexConfigPath()) {
  const state = inspectCodexDelegationConfig(configPath);
  if (state.status !== 'unconfigured') return { ...state, changed: false };
  const insertion = insertionForState(state);
  if (!insertion.ok) return { ...state, status: 'conflicting', detail: insertion.detail, changed: false };
  const parsed = parseTomlStructurally(Buffer.from(insertion.nextText, 'utf8'));
  if (!parsed.ok) return { ...state, status: 'conflicting', detail: `Proposed Codex config does not parse safely: ${parsed.detail}`, changed: false };
  const verified = codexDelegationConfigState(Buffer.from(insertion.nextText, 'utf8'), configPath);
  if (verified.status !== 'configured') return { ...verified, changed: false };
  return {
    ...state,
    status: 'preview',
    changed: false,
    proposed_block: insertion.block,
    proposed_text: insertion.nextText,
    proposed_action: insertion.action,
    detail: 'Explicit limit approval may write the shown Toolkit-managed block.',
  };
}

function configureCodexDelegation(configPath = codexConfigPath(), options = {}) {
  const preview = previewCodexDelegation(configPath);
  if (preview.status !== 'preview') return { ...preview, changed: false };
  const backup = createCodexConfigBackup(configPath);
  let wrote = false;
  try {
    const nextBytes = Buffer.from(preview.proposed_text, 'utf8');
    const parsed = parseTomlStructurally(nextBytes);
    if (!parsed.ok) throw new Error(`Proposed Codex config failed TOML validation: ${parsed.detail}`);
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

function delegationResultForChoice(choice, configPath = codexConfigPath(), options = {}) {
  const current = inspectCodexDelegationConfig(configPath);
  if (choice === 'skip') return { ...current, status: 'skipped', changed: false, detail: 'Codex delegation configuration was explicitly skipped.' };
  if (choice !== 'limit') return { ...current, status: current.status === 'configured' ? 'configured' : 'kept', changed: false, detail: current.status === 'configured' ? current.detail : 'Codex delegation configuration was kept unchanged pending native UAT.' };
  return configureCodexDelegation(configPath, options);
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
  createCodexConfigBackup,
  restoreCodexDelegationBackup,
  configureCodexDelegation,
  delegationResultForChoice,
};
