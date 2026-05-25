#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const beginMarker = '<!-- BEGIN N8N-AGENT-RULES-ADAPTER -->';
const endMarker = '<!-- END N8N-AGENT-RULES-ADAPTER -->';

const targetDefinitions = {
  agents: {
    activeFile: 'AGENTS.md',
    adapter: 'AGENTS.n8n-brief.template.md'
  },
  claude: {
    activeFile: 'CLAUDE.md',
    adapter: 'CLAUDE.n8n-brief.template.md'
  },
  gemini: {
    activeFile: 'GEMINI.md',
    adapter: 'GEMINI.n8n-brief.template.md'
  }
};

function usage() {
  return [
    'Usage: node install-n8n-agent-adapter.cjs --dry-run|--write [--target auto|all|agents|claude|gemini] [--workspace <path>]',
    '',
    'Use --dry-run to preview changes. Use --write only after explicit approval to patch active instruction files.'
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    dryRun: argv.includes('--dry-run'),
    write: argv.includes('--write'),
    target: 'auto',
    workspace: process.cwd()
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--target') {
      args.target = argv[index + 1] || '';
      index += 1;
    } else if (arg.startsWith('--target=')) {
      args.target = arg.slice('--target='.length);
    } else if (arg === '--workspace') {
      args.workspace = argv[index + 1] || '';
      index += 1;
    } else if (arg.startsWith('--workspace=')) {
      args.workspace = arg.slice('--workspace='.length);
    }
  }

  if (args.dryRun === args.write) {
    throw new Error('Choose exactly one of --dry-run or --write.');
  }
  if (!['auto', 'all', 'agents', 'claude', 'gemini'].includes(args.target)) {
    throw new Error(`Unsupported --target value: ${args.target}`);
  }
  if (!args.workspace) {
    throw new Error('--workspace must not be empty.');
  }
  return args;
}

function normalizeNewlines(text) {
  return text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isReparsePoint(stats) {
  if (typeof stats.isReparsePoint === 'function') return stats.isReparsePoint();
  return stats.isReparsePoint === true;
}

function lstatIfExists(filePath) {
  try {
    return fs.lstatSync(filePath);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function assertSafeActiveInstructionPath(root, activePath, activeFile) {
  const activeParent = path.dirname(activePath);
  const activeRealParent = fs.existsSync(activeParent)
    ? fs.realpathSync.native(activeParent)
    : root;
  if (!isInside(root, activeRealParent)) {
    throw new Error(`Refusing target outside workspace: ${activeFile}`);
  }

  const activeStats = lstatIfExists(activePath);
  if (!activeStats) return false;

  if (activeStats.isSymbolicLink()) {
    throw new Error(`Refusing symlinked active instruction file: ${activeFile}`);
  }
  if (isReparsePoint(activeStats)) {
    throw new Error(`Refusing reparse-point active instruction file: ${activeFile}`);
  }

  const activeRealPath = fs.realpathSync.native(activePath);
  if (!isInside(root, activeRealPath)) {
    throw new Error(`Refusing target outside workspace: ${activeFile}`);
  }
  return true;
}

function safeWorkspace(rootInput) {
  const root = path.resolve(rootInput);
  const real = fs.realpathSync.native(root);
  if (!fs.statSync(real).isDirectory()) {
    throw new Error(`Workspace is not a directory: ${rootInput}`);
  }
  return real;
}

function walk(root, relativeDir = '', entries = []) {
  const fullDir = path.join(root, relativeDir);
  if (!fs.existsSync(fullDir)) return entries;
  for (const entry of fs.readdirSync(fullDir, { withFileTypes: true })) {
    if (['.git', 'node_modules', '_dist', 'dist', 'coverage'].includes(entry.name)) continue;
    const rel = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
    const full = path.join(root, rel);
    entries.push({ rel: rel.replace(/\\/g, '/'), full, entry });
    if (entry.isDirectory()) walk(root, rel, entries);
  }
  return entries;
}

function looksLikeWorkflowJson(filePath) {
  if (!/\.json$/i.test(filePath)) return false;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' && Array.isArray(parsed.nodes) && parsed.connections && typeof parsed.connections === 'object';
  } catch {
    return false;
  }
}

function detectN8nInvolvement(root) {
  const hits = [];
  for (const markerDir of ['.n8n-local', '.to-sanitise', '.sanitised']) {
    if (fs.existsSync(path.join(root, markerDir))) hits.push(markerDir);
  }

  for (const { rel, full, entry } of walk(root)) {
    if (hits.length >= 20) break;
    if (entry.isDirectory()) continue;
    const lower = rel.toLowerCase();
    if (lower.startsWith('n8n-workflows/') && lower.endsWith('.json')) {
      hits.push(rel);
      continue;
    }
    if (lower.endsWith('.workflow.json')) {
      hits.push(rel);
      continue;
    }
    if (looksLikeWorkflowJson(full)) {
      hits.push(rel);
      continue;
    }
    if (!/\.(md|txt|json|cjs|js|ps1|cmd|yml|yaml)$/i.test(lower)) continue;
    const text = fs.readFileSync(full, 'utf8');
    if (/\bn8n_docs\b|\bn8n_live\b|\bn8n\s+MCP\b|n8n import|n8n export|n8n-workflows|sanitis[ez]e|validate-n8n/i.test(text)) {
      hits.push(rel);
    }
  }

  return [...new Set(hits)];
}

function adapterBlock(adapterFile) {
  const template = normalizeNewlines(fs.readFileSync(adapterFile, 'utf8'));
  const start = template.indexOf(beginMarker);
  const finish = template.indexOf(endMarker);
  if (start === -1 || finish === -1 || finish < start) {
    throw new Error(`Adapter template is missing managed markers: ${adapterFile}`);
  }
  return template.slice(start, finish + endMarker.length).trimEnd();
}

function markerIndexes(text, marker) {
  const positions = [];
  let index = text.indexOf(marker);
  while (index !== -1) {
    positions.push(index);
    index = text.indexOf(marker, index + marker.length);
  }
  return positions;
}

function replaceManagedBlock(existing, block, activeFile = 'active instruction file') {
  const normalized = normalizeNewlines(existing);
  const starts = markerIndexes(normalized, beginMarker);
  const finishes = markerIndexes(normalized, endMarker);
  if (starts.length === 0 && finishes.length === 0) {
    return `${normalized.trimEnd()}\n\n${block}\n`;
  }
  if (starts.length !== 1 || finishes.length !== 1) {
    throw new Error(`Malformed managed adapter markers in ${activeFile}`);
  }
  const [start] = starts;
  const [finish] = finishes;
  if (finish < start) {
    throw new Error(`Malformed managed adapter markers in ${activeFile}`);
  }
  const before = normalized.slice(0, start).trimEnd();
  const after = normalized.slice(finish + endMarker.length).trimStart();
  return `${before}\n\n${block}\n${after ? `\n${after.trimEnd()}\n` : ''}`;
}

function targetList(root, target) {
  if (target === 'all') return Object.values(targetDefinitions);
  if (target !== 'auto') return [targetDefinitions[target]];
  return Object.values(targetDefinitions).filter((definition) => fs.existsSync(path.join(root, definition.activeFile)));
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    process.exit(2);
  }

  const root = safeWorkspace(args.workspace);
  const scriptDir = __dirname;
  const skillDir = path.resolve(scriptDir, '..');
  const adaptersDir = path.join(skillDir, 'adapters');
  const hits = detectN8nInvolvement(root);
  const targets = targetList(root, args.target);

  if (hits.length) {
    console.log(`Detected n8n involvement: ${hits.slice(0, 8).join(', ')}${hits.length > 8 ? ', ...' : ''}`);
  } else {
    console.log('No n8n involvement detected. Adapter installation is not recommended.');
  }

  if (!targets.length) {
    console.log('No existing active instruction files found for --target auto. No files would be created automatically.');
    console.log('Required next step: Ask the user which adapter target to create or propose: AGENTS.md, CLAUDE.md, GEMINI.md, all, or none.');
    console.log('Do this even during read-only or no-modify tasks. Do not run --write without explicit current-turn approval.');
    return;
  }

  for (const target of targets) {
    const activePath = path.join(root, target.activeFile);
    const activeExists = assertSafeActiveInstructionPath(root, activePath, target.activeFile);
    const block = adapterBlock(path.join(adaptersDir, target.adapter));
    const current = activeExists ? fs.readFileSync(activePath, 'utf8') : '';
    const next = replaceManagedBlock(current, block, target.activeFile);
    const action = activeExists ? 'update' : 'create';
    if (current === next) {
      console.log(`${args.write ? 'No change for' : 'Would leave unchanged'} ${target.activeFile}`);
      continue;
    }
    if (args.write) {
      assertSafeActiveInstructionPath(root, activePath, target.activeFile);
      fs.writeFileSync(activePath, next, 'utf8');
      console.log(`${action === 'create' ? 'Created' : 'Updated'} ${target.activeFile}`);
    } else {
      console.log(`Would ${action} ${target.activeFile}`);
    }
  }
}

if (require.main === module) main();

module.exports = {
  adapterBlock,
  assertSafeActiveInstructionPath,
  detectN8nInvolvement,
  replaceManagedBlock,
  targetList
};
