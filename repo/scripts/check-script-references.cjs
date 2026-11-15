#!/usr/bin/env node
'use strict';

// Flags commands and documents that point at a script that is missing or retired. Read-only, no
// network. Two sources are checked:
//   - every permission row (toolkit-permissions.cjs ROWS): its script must exist and not be retired;
//   - every Markdown file outside the changelog history: each script path it names
//     (repo/scripts/<name> or skills/<skill>/scripts/<name>) must exist, and a retired one may be
//     named only in its registry entry's allowed_in files.
// Retired scripts are listed in repo/contracts/retired-scripts.json (schema toolkit-retired-scripts/v1).
//
// Usage: node repo/scripts/check-script-references.cjs [--root <toolkit checkout>]
// Prints `SCRIPT REFERENCES: clear`, or `SCRIPT REFERENCES: <n> found` and one line per finding:
//   RETIRED permission row <id> runs <script>
//   MISSING permission row <id> runs <script>
//   RETIRED <file>:<line> names <script>
//   MISSING <file>:<line> names <script>
// Exit 0 clear, 1 findings, 2 bad arguments or an unreadable registry.

const fs = require('node:fs');
const path = require('node:path');

const REGISTRY_REL = 'repo/contracts/retired-scripts.json';
const SCHEMA = 'toolkit-retired-scripts/v1';
const SCRIPT_PATH = /(?:repo\/scripts|skills\/[A-Za-z0-9_-]+\/scripts)\/[A-Za-z0-9_.-]+\.(?:cjs|mjs|js|ps1|sh|py)\b/g;
// History records what was true when it was written, so it may name anything.
const HISTORY = [/^repo\/docs\/CHANGELOG\.md$/, /^repo\/docs\/changelog\.d\//];
const SKIP_DIRS = new Set(['.git', 'node_modules', '.tmp']);

function readRegistry(root) {
  const registry = JSON.parse(fs.readFileSync(path.join(root, REGISTRY_REL), 'utf8'));
  if (registry.schema !== SCHEMA || !Array.isArray(registry.scripts)) throw new Error(`${REGISTRY_REL} is not ${SCHEMA}`);
  for (const entry of registry.scripts) {
    if (typeof entry.path !== 'string' || typeof entry.reason !== 'string' || !entry.reason.trim() || !Array.isArray(entry.allowed_in)) throw new Error(`${REGISTRY_REL}: every entry needs path, reason and allowed_in`);
  }
  return new Map(registry.scripts.map(entry => [entry.path, entry]));
}

function markdownFiles(root, dir = '') {
  const out = [];
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) out.push(...markdownFiles(root, rel)); }
    else if (entry.isFile() && rel.endsWith('.md') && !HISTORY.some(pattern => pattern.test(rel))) out.push(rel);
  }
  return out;
}

function checkReferences(root, { rows } = {}) {
  const retired = readRegistry(root);
  const exists = rel => fs.existsSync(path.join(root, rel));
  const findings = [];
  const permissionRows = rows || require(path.join(root, 'repo/scripts/toolkit-permissions.cjs')).ROWS;
  for (const row of permissionRows) {
    if (!row.script) continue;
    if (retired.has(row.script)) findings.push(`RETIRED permission row ${row.id} runs ${row.script}`);
    else if (!exists(row.script)) findings.push(`MISSING permission row ${row.id} runs ${row.script}`);
  }
  for (const rel of markdownFiles(root)) {
    fs.readFileSync(path.join(root, rel), 'utf8').split(/\r?\n/).forEach((line, index) => {
      for (const script of new Set(line.match(SCRIPT_PATH) || [])) {
        const entry = retired.get(script);
        if (entry && !entry.allowed_in.includes(rel)) findings.push(`RETIRED ${rel}:${index + 1} names ${script}`);
        else if (!entry && !exists(script)) findings.push(`MISSING ${rel}:${index + 1} names ${script}`);
      }
    });
  }
  return findings;
}

function main(argv = process.argv.slice(2), deps = {}) {
  const out = deps.stdout || (text => process.stdout.write(text));
  const err = deps.stderr || (text => process.stderr.write(text));
  let root = path.resolve(__dirname, '..', '..');
  if (argv.length === 2 && argv[0] === '--root') root = path.resolve(argv[1]);
  else if (argv.length) { err('Usage: check-script-references.cjs [--root <toolkit checkout>]\n'); return 2; }
  let findings;
  try { findings = checkReferences(root, deps); } catch (error) { err(`Script references could not be checked: ${error.message}\n`); return 2; }
  out(findings.length ? `SCRIPT REFERENCES: ${findings.length} found\n${findings.join('\n')}\n` : 'SCRIPT REFERENCES: clear\n');
  return findings.length ? 1 : 0;
}

module.exports = { checkReferences, readRegistry, main, REGISTRY_REL };
if (require.main === module) process.exitCode = main();
