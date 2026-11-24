#!/usr/bin/env node
'use strict';

// Projects the canonical agent-rule sources into every instruction surface this repository owns,
// writing them (--write) or checking them (default), and reports every error in one run:
//   - the CLAUDE.md shim, which is exactly the import line `@AGENTS.md` with no markers, into its
//     portable copy and this repository's root CLAUDE.md;
//   - the n8n safety rules into the three portable n8n skill derivatives.
// Neither the global nor the governed rules are projected here: setup installs the global rules into each
// harness's user-level file, and the installed Toolkit delivers the governed rules at session start,
// this repository included, so root AGENTS.md is all hand-written. The check refuses a Toolkit block
// in it, or any file under Antigravity's .agents/rules/ folder, so a stale branch cannot bring a copy
// back.

const fs = require('node:fs');
const path = require('node:path');
const { findBlocks } = require('./toolkit-managed-block.cjs');

function workspaceRootFromArgs(args = process.argv.slice(2)) {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--workspace') return args[i + 1] || '';
    if (arg.startsWith('--workspace=')) return arg.slice('--workspace='.length);
  }
  return '';
}

const workspaceRoot = workspaceRootFromArgs();
const root = path.resolve(workspaceRoot || process.env.TOOLKIT_WORKSPACE_ROOT || process.cwd());
const rootReal = fs.realpathSync.native(root);
const mode = process.argv.includes('--write') ? 'write' : 'check';

const fixCommand = 'node repo/scripts/sync-agent-instruction-shims.cjs --write';
const globalPath = 'repo/contracts/agent-rules/global-rules.md';
const n8nRulesPath = 'repo/contracts/agent-rules/n8n-safety-rules.md';
const n8nDerivativePaths = Object.freeze([
  'skills/n8n-safety-router/n8n-safety-rules.md',
  'skills/n8n-environment-setup/references/n8n-safety-rules.md',
  'skills/n8n-workflow-transport/references/n8n-safety-rules.md'
]);
const templateRoot = 'repo/contracts/agent-rules/repo-local';
const publishedRoot = 'skills/repository-agent-rules/repo-local';
// Root files that must stay free of Toolkit copies. Antigravity reads AGENTS.md itself.
const ROOT_AGENTS = 'AGENTS.md';
// Antigravity's workspace rule folder: this repository keeps nothing there. Matched in any letter
// case, since a case-insensitive checkout reads .Agents/Rules as the same folder.
const RULES_FOLDER = Object.freeze(['.agents', 'rules']);
// The CLAUDE.md shim is recognised by exact content, so it carries no markers. Claude Code reads
// the import natively; Antigravity reads AGENTS.md itself, so no GEMINI.md shim exists.
const CLAUDE_SHIM = Object.freeze({ file: 'CLAUDE.shim.template.md', target: 'CLAUDE.md', text: '@AGENTS.md\n' });

function normalizeWorkspaceRel(value) {
  return path.posix.normalize(String(value).replace(/\\/g, '/'));
}

function hasPathTraversal(value) {
  const slashValue = String(value).replace(/\\/g, '/');
  const normalized = normalizeWorkspaceRel(value);
  return slashValue.split('/').includes('..') || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../');
}

function isAbsolutePathLike(value) {
  return path.isAbsolute(value) || path.posix.isAbsolute(value) || path.win32.isAbsolute(value);
}

function isInsideRoot(realPath) {
  const relative = path.relative(rootReal, realPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

// Every file or link under the rule folder, in any letter case, as workspace-relative paths. Links
// are reported, never followed.
function ruleFolderEntries() {
  const found = [];
  const walk = (abs, rel, depth) => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (depth < RULES_FOLDER.length && entry.name.toLowerCase() !== RULES_FOLDER[depth]) continue;
      if (entry.isDirectory()) walk(path.join(abs, entry.name), childRel, depth + 1);
      else if (depth >= RULES_FOLDER.length || entry.isSymbolicLink()) found.push(childRel);
    }
  };
  walk(root, '', 0);
  return found.sort();
}

function safeWorkspacePath(relPath, label, options = {}) {
  if (typeof relPath !== 'string' || !relPath.trim()) {
    throw new Error(`${label} must be a non-empty workspace-relative path`);
  }
  if (isAbsolutePathLike(relPath) || hasPathTraversal(relPath)) {
    throw new Error(`Unsafe workspace path for ${label}: ${relPath}`);
  }

  const normalized = normalizeWorkspaceRel(relPath);
  const parts = normalized.split('/').filter(Boolean);
  let current = root;
  let existing = root;
  for (const part of parts) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) {
      if (options.allowMissing) break;
      throw new Error(`${label} does not exist: ${normalized}`);
    }
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new Error(`Unsafe symlink in ${label}: ${normalized}`);
    }
    existing = current;
  }

  const real = fs.realpathSync.native(existing);
  if (!isInsideRoot(real)) {
    throw new Error(`Unsafe path outside workspace for ${label}: ${normalized}`);
  }
  return path.join(root, normalized);
}

function normalize(text) {
  return text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
}

function readOptional(relPath) {
  const full = safeWorkspacePath(relPath, `agent instruction file ${relPath}`, { allowMissing: true });
  if (!fs.existsSync(full)) return '';
  return normalize(fs.readFileSync(full, 'utf8'));
}

function n8nCrossSkillHeader() {
  return [
    '# n8n Safety Rules Cross-Product Reference',
    '',
    'Narrow managed n8n safety derivative for portable/local n8n safety context in the containing copied skill.',
    '',
    `- Direct canonical source: \`${n8nRulesPath}\``,
    `- Repair command: \`${fixCommand}\``,
    '- This file is a narrow managed n8n safety derivative. Do not edit it directly.',
    '',
    '---',
    ''
  ].join('\n');
}

// Writes or checks one projected file and collects every error of the run.
class InstructionProjectionOperation {
  #mode; #errors = [];
  constructor(options = {}) { this.#mode = options.mode || mode; }

  #fail(message) { this.#errors.push(`${message} Run ${fixCommand}.`); }

  #readRequired(relPath) {
    try {
      return normalize(fs.readFileSync(safeWorkspacePath(relPath, `agent instruction source ${relPath}`), 'utf8')).trimEnd();
    } catch (error) {
      this.#fail(`${error.message}.`);
      return null;
    }
  }

  #project(relPath, expected, label = 'managed agent instruction file') {
    if (expected === null) return;
    if (this.#mode === 'write') {
      const full = safeWorkspacePath(relPath, `agent instruction output ${relPath}`, { allowMissing: true });
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, expected, 'utf8');
      return;
    }
    if (readOptional(relPath) !== expected) this.#fail(`Stale ${label}: ${relPath}.`);
  }

  #projectN8n() {
    const rules = this.#readRequired(n8nRulesPath);
    if (rules === null) return;
    const body = `${rules}\n`;
    this.#project(n8nDerivativePaths[0], body, 'n8n safety derivative');
    for (const relPath of n8nDerivativePaths.slice(1)) this.#project(relPath, `${n8nCrossSkillHeader()}${body}`, 'n8n safety derivative');
  }

  // In both modes: these copies are removed by hand, never rewritten, so no fix command is named.
  #refuseRootCopies() {
    const { blocks, errors } = findBlocks(readOptional(ROOT_AGENTS));
    if (blocks.length || errors.length) {
      this.#errors.push(`Root ${ROOT_AGENTS} carries a Toolkit managed block; the installed Toolkit delivers the governed rules, so remove it by hand.`);
    }
    for (const rel of ruleFolderEntries()) {
      this.#errors.push(`${rel} is not allowed: Antigravity reads ${ROOT_AGENTS} itself, so this repository keeps no rule files under ${RULES_FOLDER.join('/')}/; remove it.`);
    }
  }

  #projectClaudeShim() {
    const relPath = `${templateRoot}/${CLAUDE_SHIM.file}`;
    const source = this.#readRequired(relPath);
    if (source === null) return;
    if (source !== CLAUDE_SHIM.text.trimEnd()) {
      this.#fail(`${relPath} must be exactly the line @AGENTS.md.`);
      return;
    }
    this.#project(`${publishedRoot}/${CLAUDE_SHIM.file}`, CLAUDE_SHIM.text, 'portable instruction template');
    this.#project(CLAUDE_SHIM.target, CLAUDE_SHIM.text);
  }

  run() {
    this.#refuseRootCopies();
    this.#readRequired(globalPath);
    this.#projectN8n();
    this.#projectClaudeShim();
    return { errors: this.#errors };
  }
}

function validateAndSync(options = {}) { return new InstructionProjectionOperation(options).run(); }

// Every file this sync writes, for the merge train finder's generated-sync check: `blocks: null`
// when the check above compares the whole file, else the block names it compares (the rest of the
// file is hand-written).
const PROJECTED_OUTPUTS = Object.freeze([
  ...n8nDerivativePaths.map(file => ({ path: file, blocks: null })),
  { path: `${publishedRoot}/${CLAUDE_SHIM.file}`, blocks: null },
  { path: CLAUDE_SHIM.target, blocks: null },
].map(Object.freeze));

if (require.main === module) {
  const { errors } = validateAndSync();
  if (errors.length) {
    for (const error of errors) console.error(`FAIL: ${error}`);
    console.error(`\nSummary: ${errors.length} managed agent instruction error(s).`);
    process.exit(1);
  }
  console.log(`Managed agent instruction ${mode === 'write' ? 'sync' : 'check'} passed.`);
}

module.exports = {
  PROJECTED_OUTPUTS,
  validateAndSync
};
