#!/usr/bin/env node
'use strict';

// Writes (--write) or checks the Source-of-Truth Contract block in README.md from
// repo/contracts/source-of-truth-contract.md, inside versioned, hashed Toolkit markers.

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
const partialPath = 'repo/contracts/source-of-truth-contract.md';
const versionPath = 'repo/contracts/toolkit-local-bridge/version.json';
const targets = ['README.md'];
const BLOCK_NAME = 'SOURCE-OF-TRUTH-CONTRACT';
const mode = process.argv.includes('--write') ? 'write' : 'check';

function resolveRel(relPath) {
  return path.join(root, relPath);
}

function normalize(text) {
  return text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
}

function readText(relPath, errors, label) {
  const full = resolveRel(relPath);
  if (!fs.existsSync(full)) {
    errors.push(`Missing source-of-truth contract ${label}: ${relPath}`);
    return null;
  }
  return normalize(fs.readFileSync(full, 'utf8'));
}

function replaceBlock(relPath, text, block, errors) {
  const { blocks, errors: markerErrors } = findBlocks(text);
  if (markerErrors.length) {
    errors.push(`Malformed Toolkit markers in ${relPath}: ${markerErrors[0]}`);
    return null;
  }
  const found = blocks.filter(entry => entry.name === BLOCK_NAME);
  if (found.length !== 1) {
    errors.push(found.length ? `Duplicate source-of-truth contract markers: ${relPath}` : `Missing source-of-truth contract markers: ${relPath}`);
    return null;
  }
  return `${text.slice(0, found[0].start)}${renderBlock(block)}${text.slice(found[0].end)}`.replace(/\n*$/, '\n');
}

function validateAndSync(options = {}) {
  const runMode = options.mode || mode;
  const errors = [];
  const partial = readText(partialPath, errors, 'partial');
  const versionText = readText(versionPath, errors, 'version');
  if (partial === null || versionText === null) return { errors };
  const block = { source: partialPath, name: BLOCK_NAME, version: JSON.parse(versionText).version, body: partial };

  for (const target of targets) {
    const current = readText(target, errors, 'target');
    if (current === null) continue;
    const expected = replaceBlock(target, current, block, errors);
    if (expected === null) continue;

    if (runMode === 'write') {
      fs.writeFileSync(resolveRel(target), expected, 'utf8');
    } else if (current !== expected) {
      errors.push(`Stale source-of-truth contract block: ${target}`);
    }
  }

  return { errors };
}

if (require.main === module) {
  const { errors } = validateAndSync();
  if (errors.length) {
    for (const error of errors) console.error(`FAIL: ${error}`);
    console.error(`\nSummary: ${errors.length} source-of-truth contract error(s).`);
    process.exit(1);
  }
  console.log(`Source-of-truth contract ${mode === 'write' ? 'sync' : 'check'} passed for ${targets.length} file(s).`);
}

module.exports = {
  validateAndSync
};
