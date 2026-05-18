#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

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
const partialPath = 'repo/docs/partials/source-of-truth-contract.md';
const targets = ['README.md', 'AGENTS.md', 'for_ai/README.md'];
const beginMarker = '<!-- BEGIN SOURCE-OF-TRUTH-CONTRACT -->';
const endMarker = '<!-- END SOURCE-OF-TRUTH-CONTRACT -->';
const mode = process.argv.includes('--write') ? 'write' : 'check';

function resolveRel(relPath) {
  return path.join(root, relPath);
}

function normalize(text) {
  return text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

function readText(relPath, errors, label) {
  const full = resolveRel(relPath);
  if (!fs.existsSync(full)) {
    errors.push(`Missing source-of-truth contract ${label}: ${relPath}`);
    return null;
  }
  return normalize(fs.readFileSync(full, 'utf8'));
}

function markerCount(text, marker) {
  return text.split(marker).length - 1;
}

function expectedBlock(partial) {
  return `${beginMarker}\n${partial.trimEnd()}\n${endMarker}`;
}

function replaceBlock(relPath, text, partial, errors) {
  const beginCount = markerCount(text, beginMarker);
  const endCount = markerCount(text, endMarker);
  if (beginCount === 0 || endCount === 0) {
    errors.push(`Missing source-of-truth contract markers: ${relPath}`);
    return null;
  }
  if (beginCount !== 1 || endCount !== 1) {
    errors.push(`Duplicate source-of-truth contract markers: ${relPath}`);
    return null;
  }

  const start = text.indexOf(beginMarker);
  const end = text.indexOf(endMarker);
  if (start > end) {
    errors.push(`Source-of-truth contract markers out of order: ${relPath}`);
    return null;
  }

  const blockEnd = end + endMarker.length;
  return `${text.slice(0, start)}${expectedBlock(partial)}${text.slice(blockEnd)}`.replace(/\n*$/, '\n');
}

function validateAndSync(options = {}) {
  const runMode = options.mode || mode;
  const errors = [];
  const partial = readText(partialPath, errors, 'partial');
  if (partial === null) return { errors };

  for (const target of targets) {
    const current = readText(target, errors, 'target');
    if (current === null) continue;
    const expected = replaceBlock(target, current, partial, errors);
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
