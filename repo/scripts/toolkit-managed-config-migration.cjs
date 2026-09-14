#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const {
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
} = require('./codex-delegation-common.cjs');

const CONTRACT_VERSION = 'toolkit.local-bridge.managed-config-migration.v1';
const LEGACY_MARKER = /AI[-_ ]AGENT[-_ ]TOOLKIT|toolkit-agent-control|helper-capacity|MultiAgentV2|reservation[-_ ]queue/i;
const MARKER_PREFIX = '# AI-AGENT-TOOLKIT:';
const BLOCK_DEFINITIONS = Object.freeze([
  { kind: 'legacy-limits', begin: CODEX_DELEGATION_BEGIN, end: CODEX_DELEGATION_END },
  { kind: 'enablement', begin: CODEX_V2_ENABLEMENT_BEGIN, end: CODEX_V2_ENABLEMENT_END },
  { kind: 'helper-capacity', begin: CODEX_HELPER_CAPACITY_BEGIN, end: CODEX_HELPER_CAPACITY_END },
  { kind: 'root-guidance', begin: CODEX_ROOT_GUIDANCE_BEGIN, end: CODEX_ROOT_GUIDANCE_END },
  { kind: 'helper-guidance', begin: CODEX_HELPER_GUIDANCE_BEGIN, end: CODEX_HELPER_GUIDANCE_END },
]);
const BY_BEGIN = new Map(BLOCK_DEFINITIONS.map((definition) => [definition.begin, definition]));
const BY_END = new Map(BLOCK_DEFINITIONS.map((definition) => [definition.end, definition]));

class ManagedConfigMigrationError extends Error {
  constructor(code, evidence = {}) {
    super(code);
    this.name = 'ManagedConfigMigrationError';
    this.code = code;
    this.evidence = evidence;
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readConfig(input = {}) {
  if (typeof input.text === 'string') return input.text;
  if (typeof input.config_path === 'string') {
    try { return fs.readFileSync(input.config_path, 'utf8'); } catch (error) { throw new ManagedConfigMigrationError('CONFIG_READ_FAILED', { message: error.message }); }
  }
  return '';
}

function lineRecords(text) {
  const records = [];
  let start = 0;
  while (start < text.length) {
    const newline = text.indexOf('\n', start);
    const end = newline === -1 ? text.length : newline + 1;
    const raw = text.slice(start, end);
    const eol = raw.endsWith('\r\n') ? '\r\n' : (raw.endsWith('\n') ? '\n' : '');
    records.push({ start, end, text: eol ? raw.slice(0, -eol.length) : raw, eol });
    start = end;
  }
  if (text.length === 0) records.push({ start: 0, end: 0, text: '', eol: '' });
  return records;
}

function validBody(kind, body) {
  const lines = body.map((line) => line.text);
  if (kind === 'legacy-limits') {
    return lines.length === 2
      && /^max_threads = (?:0|[1-9][0-9]*)$/.test(lines[0])
      && lines[1] === 'max_depth = 1';
  }
  if (kind === 'enablement') return lines.length === 1 && lines[0] === 'enabled = true';
  if (kind === 'helper-capacity') return lines.length === 1 && /^max_concurrent_threads_per_session = [1-9][0-9]*$/.test(lines[0]);
  if (kind === 'root-guidance') return lines.length === 1 && lines[0] === `root_agent_usage_hint_text = ${JSON.stringify(CODEX_V2_ROOT_GUIDANCE)}`;
  if (kind === 'helper-guidance') return lines.length === 1 && lines[0] === `subagent_usage_hint_text = ${JSON.stringify(CODEX_V2_HELPER_GUIDANCE)}`;
  return false;
}

function parseManagedBlocks(text) {
  const blocks = [];
  const records = lineRecords(text);
  const seen = new Set();
  let open = null;
  let unsafe = false;
  for (const record of records) {
    const marker = record.text;
    const begin = BY_BEGIN.get(marker);
    const end = BY_END.get(marker);
    const isToolkitMarker = marker.includes(MARKER_PREFIX)
      || /^#\s*TOOLKIT[-_ ]HELPER[-_ ]CAPACITY[-_ ](?:BEGIN|END)\b/i.test(marker);
    if (isToolkitMarker && !begin && !end) {
      unsafe = true;
      continue;
    }
    if (begin) {
      if (open || seen.has(begin.kind)) unsafe = true;
      else open = { definition: begin, record, body: [] };
      continue;
    }
    if (end) {
      if (!open || open.definition.kind !== end.kind || !validBody(open.definition.kind, open.body)) {
        unsafe = true;
      } else {
        blocks.push({ kind: open.definition.kind, start: open.record.start, end: record.end, text: text.slice(open.record.start, record.end) });
        seen.add(end.kind);
      }
      open = null;
      continue;
    }
    if (open) open.body.push(record);
  }
  if (open) unsafe = true;
  return { blocks: unsafe ? [] : blocks, unsafe };
}

function managedBlocks(text) {
  if (typeof text !== 'string') return [];
  return parseManagedBlocks(text).blocks;
}

function inspectManagedConfiguration(input = {}) {
  const text = readConfig(input);
  const parsed = parseManagedBlocks(text);
  const stale = LEGACY_MARKER.test(text);
  const structural = stale && (parsed.unsafe || parsed.blocks.length === 0);
  return Object.freeze({
    contract_version: CONTRACT_VERSION,
    status: stale ? (structural ? 'BLOCKED' : 'MIGRATION_REQUIRED') : 'NOOP',
    changed: false,
    preserved_user_content: true,
    policy_authority_removed: false,
    reason_code: stale ? (structural ? 'STRUCTURAL_CONFIGURATION_UNSAFE' : 'MIGRATION_REQUIRED') : 'NO_LEGACY_POLICY',
    block_count: parsed.blocks.length
  });
}

function migratedText(text) {
  const blocks = managedBlocks(text);
  if (!blocks.length) return null;
  let output = text;
  for (const block of [...blocks].reverse()) output = output.slice(0, block.start) + output.slice(block.end);
  return output;
}

function migrateManagedConfiguration(input = {}) {
  const text = readConfig(input);
  const inspection = inspectManagedConfiguration({ text });
  if (inspection.status === 'NOOP') return Object.freeze({ ...inspection });
  if (inspection.status === 'BLOCKED') return Object.freeze({ ...inspection });
  if (input.write !== true) return Object.freeze({ ...inspection, status: 'MIGRATION_REQUIRED', reason_code: 'MIGRATION_PREVIEW' });
  const nextText = migratedText(text);
  if (typeof nextText !== 'string') return Object.freeze({ ...inspection, status: 'BLOCKED', reason_code: 'STRUCTURAL_CONFIGURATION_UNSAFE', block_count: 0 });
  if (typeof input.atomic_write !== 'function') throw new ManagedConfigMigrationError('ATOMIC_WRITE_REQUIRED');
  try {
    const result = input.atomic_write(nextText);
    if (result === false) throw new Error('atomic write returned false');
  } catch (error) {
    if (typeof input.rollback !== 'function') throw new ManagedConfigMigrationError('MIGRATION_WRITE_FAILED', { message: error.message });
    try {
      const rollback = input.rollback(Object.freeze({ original_text: text, attempted_text: nextText }));
      if (rollback === false) throw new Error('rollback returned false');
    } catch (rollbackError) {
      throw new ManagedConfigMigrationError('MIGRATION_ROLLBACK_FAILED', { message: rollbackError.message });
    }
    throw new ManagedConfigMigrationError('MIGRATION_WRITE_FAILED', { message: error.message });
  }
  return Object.freeze({
    contract_version: CONTRACT_VERSION,
    status: 'MIGRATED',
    changed: true,
    preserved_user_content: true,
    policy_authority_removed: true,
    reason_code: 'LEGACY_POLICY_REMOVED',
    block_count: inspection.block_count
  });
}

function planManagedConfigMigration(input = {}) {
  const inspection = inspectManagedConfiguration(input);
  return Object.freeze({
    ...inspection,
    action: inspection.status === 'MIGRATION_REQUIRED' ? 'remove-exact-toolkit-owned-policy-blocks' : 'none',
    scheduler_policy: false,
    resource_admission: false,
    queue_policy: false
  });
}

module.exports = Object.freeze({
  CONTRACT_VERSION,
  LEGACY_MARKER,
  ManagedConfigMigrationError,
  inspectManagedConfiguration,
  planManagedConfigMigration,
  migrateManagedConfiguration,
  managedBlocks,
  parseManagedBlocks
});
