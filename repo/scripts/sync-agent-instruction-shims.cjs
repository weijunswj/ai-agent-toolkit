#!/usr/bin/env node
'use strict';

// Projects the canonical agent-rule sources into every instruction surface this repository owns,
// writing them (--write) or checking them (default), and reports every error in one run:
//   - the governed rules (repo/contracts/agent-rules/toolkit-governed-rules.md) into the portable
//     managed AGENTS template and this repository's root AGENTS.md;
//   - the CLAUDE, GEMINI and Antigravity shim templates, whose source is the body between their
//     own markers, into their portable copies and this repository's root shims;
//   - the n8n safety rules into the three portable n8n skill derivatives, and the n8n adapter into
//     the n8n-safety-router adapter template.
// Every block uses the versioned, hashed marker format of toolkit-managed-block.cjs. The global
// rules are not projected here: setup installs them into each harness's user-level file.

const fs = require('node:fs');
const path = require('node:path');
const { findBlocks, renderBlock } = require('./toolkit-managed-block.cjs');

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
const governedPath = 'repo/contracts/agent-rules/toolkit-governed-rules.md';
const globalPath = 'repo/contracts/agent-rules/global-rules.md';
const versionPath = 'repo/contracts/toolkit-local-bridge/version.json';
const n8nRulesPath = 'repo/contracts/agent-rules/n8n-safety-rules.md';
const n8nDerivativePaths = Object.freeze([
  'skills/n8n-safety-router/n8n-safety-rules.md',
  'skills/n8n-environment-setup/references/n8n-safety-rules.md',
  'skills/n8n-workflow-transport/references/n8n-safety-rules.md'
]);
const n8nAdapterPath = 'repo/contracts/agent-rules/n8n-safety-router-adapter.md';
const n8nAdapterTemplatePath = 'skills/n8n-safety-router/adapters/AGENTS.n8n-brief.template.md';
const templateRoot = 'repo/contracts/agent-rules/repo-local';
const publishedRoot = 'skills/repository-agent-rules/repo-local';
const GOVERNED_BLOCK = 'TOOLKIT-GOVERNED-RULES';
// The block names the governed block replaces in root AGENTS.md.
const ROOT_REPLACED_BLOCKS = Object.freeze([GOVERNED_BLOCK]);
// Shim templates: file, block name and the root file each one is projected into.
const SHIMS = Object.freeze([
  { file: 'CLAUDE.shim.template.md', name: 'CLAUDE.SHIM', target: 'CLAUDE.md' },
  { file: 'GEMINI.shim.template.md', name: 'GEMINI.SHIM', target: 'GEMINI.md' },
  { file: 'antigravity-bootstrap.template.md', name: 'ANTIGRAVITY.BOOTSTRAP', target: '.agents/rules/00-agent-toolkit-bootstrap.md' }
]);
const MANAGED_TEMPLATE = 'AGENTS.managed.template.md';
const ROOT_HEADING = '# AI Agent Toolkit Repo Rules';

const safetyComment = [
  '<!--',
  'Curated AI-facing source.',
  'Source: repo/contracts/agent-rules/repo-local',
  'Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.',
  '-->'
].join('\n');

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
  #mode; #errors = []; #version = null;
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

  #blocksOf(relPath, text) {
    const { blocks, errors } = findBlocks(text);
    if (errors.length) {
      this.#fail(`Malformed managed agent instruction markers in ${relPath} (${errors[0]}).`);
      return null;
    }
    return blocks;
  }

  // Removes the named blocks and returns what is left, trimmed.
  #outside(relPath, text, names) {
    const blocks = this.#blocksOf(relPath, text);
    if (!blocks) return null;
    let rest = text;
    for (const block of [...blocks].reverse()) if (names.includes(block.name)) rest = rest.slice(0, block.start) + rest.slice(block.end);
    return rest.trim();
  }

  #block(source, name, body) { return renderBlock({ source, name, version: this.#version, body }); }

  #templateText(block) { return `${safetyComment}\n\n${block}\n`; }

  // A shim template's own body, read from between its markers.
  #shimBody(shim) {
    const relPath = `${templateRoot}/${shim.file}`;
    const text = this.#readRequired(relPath);
    if (text === null) return null;
    const blocks = this.#blocksOf(relPath, text);
    if (!blocks) return null;
    const own = blocks.find(block => block.name === shim.name);
    if (!own || blocks.length !== 1) {
      this.#fail(`Shim template ${relPath} must hold exactly one ${shim.name} block.`);
      return null;
    }
    return own.body;
  }

  #projectN8n() {
    const rules = this.#readRequired(n8nRulesPath);
    if (rules === null) return;
    const body = `${rules}\n`;
    this.#project(n8nDerivativePaths[0], body, 'n8n safety derivative');
    for (const relPath of n8nDerivativePaths.slice(1)) this.#project(relPath, `${n8nCrossSkillHeader()}${body}`, 'n8n safety derivative');
  }

  #projectN8nAdapter() {
    const body = this.#readRequired(n8nAdapterPath);
    if (body === null) return;
    const notice = ['<!--', `Generated from ${n8nAdapterPath}. Do not edit directly.`, `Repair: ${fixCommand}`, '-->'].join('\n');
    const block = this.#block(n8nAdapterPath, 'N8N-AGENT-RULES-ADAPTER', body);
    this.#project(n8nAdapterTemplatePath, `${notice}\n\n${block}\n`, 'n8n adapter template');
  }

  #projectTemplate(file, text) {
    this.#project(`${templateRoot}/${file}`, text, 'repo-local instruction template');
    this.#project(`${publishedRoot}/${file}`, text, 'portable instruction template');
  }

  #projectRootAgents(governedBlock) {
    const current = readOptional('AGENTS.md');
    let rest = this.#outside('AGENTS.md', current, ROOT_REPLACED_BLOCKS);
    if (rest === null) return;
    if (rest.startsWith(`${ROOT_HEADING}\n`) || rest === ROOT_HEADING) rest = rest.slice(ROOT_HEADING.length).trim();
    this.#project('AGENTS.md', `${ROOT_HEADING}\n\n${governedBlock}\n${rest ? `\n${rest}\n` : ''}`);
  }

  #projectShim(shim, block) {
    const rest = this.#outside(shim.target, readOptional(shim.target), [shim.name]);
    if (rest === null) return;
    this.#project(shim.target, `${block}\n${rest ? `\n${rest}\n` : ''}`);
  }

  run() {
    const versionText = this.#readRequired(versionPath);
    this.#version = versionText === null ? null : JSON.parse(versionText).version;
    const governed = this.#readRequired(governedPath);
    this.#readRequired(globalPath);
    this.#projectN8n();
    if (governed === null || !this.#version) return { errors: this.#errors };

    this.#projectN8nAdapter();
    const governedBlock = this.#block(governedPath, GOVERNED_BLOCK, governed);
    this.#projectTemplate(MANAGED_TEMPLATE, this.#templateText(governedBlock));
    this.#projectRootAgents(governedBlock);
    for (const shim of SHIMS) {
      const body = this.#shimBody(shim);
      if (body === null) continue;
      const block = this.#block(`${templateRoot}/${shim.file}`, shim.name, body);
      this.#projectTemplate(shim.file, this.#templateText(block));
      this.#projectShim(shim, block);
    }
    return { errors: this.#errors };
  }
}

function validateAndSync(options = {}) { return new InstructionProjectionOperation(options).run(); }

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
  validateAndSync
};
