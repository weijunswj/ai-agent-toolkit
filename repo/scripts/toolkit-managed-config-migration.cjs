#!/usr/bin/env node
'use strict';

const fs = require('node:fs');

const CONTRACT_VERSION = 'toolkit.local-bridge.managed-config-migration.v1';
const LEGACY_MARKER = /AI[-_ ]AGENT[-_ ]TOOLKIT|toolkit-agent-control|helper-capacity|MultiAgentV2|reservation[-_ ]queue/i;

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

function managedBlocks(text) {
  const blocks = [];
  const patterns = [
    /(?:^|\n)[ \t]*(?:[#;]\s*)?AI[-_ ]AGENT[-_ ]TOOLKIT[^\n]*(?:BEGIN|START)[^\n]*\n[\s\S]*?(?:^|\n)[ \t]*(?:[#;]\s*)?AI[-_ ]AGENT[-_ ]TOOLKIT[^\n]*(?:END|STOP)[^\n]*/gi,
    /(?:^|\n)[ \t]*(?:[#;]\s*)?TOOLKIT[-_ ]HELPER[-_ ]CAPACITY[-_ ]BEGIN[^\n]*\n[\s\S]*?(?:^|\n)[ \t]*(?:[#;]\s*)?TOOLKIT[-_ ]HELPER[-_ ]CAPACITY[-_ ]END[^\n]*/gi
  ];
  for (const pattern of patterns) for (const match of text.matchAll(pattern)) blocks.push({ start: match.index, end: match.index + match[0].length, text: match[0] });
  return blocks.sort((left, right) => left.start - right.start);
}

function inspectManagedConfiguration(input = {}) {
  const text = readConfig(input);
  const blocks = managedBlocks(text);
  const stale = LEGACY_MARKER.test(text);
  const structural = stale && blocks.length === 0;
  return Object.freeze({
    contract_version: CONTRACT_VERSION,
    status: stale ? (structural ? 'BLOCKED' : 'MIGRATION_REQUIRED') : 'NOOP',
    changed: false,
    preserved_user_content: true,
    policy_authority_removed: false,
    reason_code: stale ? (structural ? 'STRUCTURAL_CONFIGURATION_UNSAFE' : 'MIGRATION_REQUIRED') : 'NO_LEGACY_POLICY',
    block_count: blocks.length
  });
}

function migratedText(text) {
  const blocks = managedBlocks(text);
  if (!blocks.length) return null;
  let output = text;
  for (const block of [...blocks].reverse()) output = output.slice(0, block.start) + output.slice(block.end);
  return output.replace(/\n{3,}/g, '\n\n');
}

function migrateManagedConfiguration(input = {}) {
  const text = readConfig(input);
  const inspection = inspectManagedConfiguration({ text });
  if (inspection.status === 'NOOP') return Object.freeze({ ...inspection, block_count: undefined });
  if (inspection.status === 'BLOCKED') return Object.freeze({ ...inspection, block_count: undefined });
  if (input.write !== true) return Object.freeze({ ...inspection, status: 'MIGRATION_REQUIRED', reason_code: 'MIGRATION_PREVIEW', block_count: undefined });
  const nextText = migratedText(text);
  if (typeof nextText !== 'string') return Object.freeze({ ...inspection, status: 'BLOCKED', reason_code: 'STRUCTURAL_CONFIGURATION_UNSAFE', block_count: undefined });
  if (typeof input.atomic_write !== 'function') throw new ManagedConfigMigrationError('ATOMIC_WRITE_REQUIRED');
  try { input.atomic_write(nextText); } catch (error) { throw new ManagedConfigMigrationError('MIGRATION_WRITE_FAILED', { message: error.message }); }
  return Object.freeze({
    contract_version: CONTRACT_VERSION,
    status: 'MIGRATED',
    changed: true,
    preserved_user_content: true,
    policy_authority_removed: true,
    reason_code: 'LEGACY_POLICY_REMOVED'
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
  managedBlocks
});
