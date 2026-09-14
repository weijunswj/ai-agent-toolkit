#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ALLOWLIST_REL_PATH = 'repo/contracts/route-resolution/nonoperative-legacy-allowlist-v1.json';
const ALLOWED_CONTEXTS = new Set(['contract-definition', 'structured-history', 'historical-document', 'migration-document', 'migration-literal', 'migration-symbol', 'migration-state-field', 'test-source']);
const CANDIDATE_EXTENSIONS = new Set(['.cjs', '.js', '.mjs', '.json', '.md', '.yaml', '.yml', '.toml', '.ps1', '.cmd', '.sh', '.py']);

function slash(value) {
  return String(value).split(path.sep).join('/');
}

function readUtf8(filePath) {
  const bytes = fs.readFileSync(filePath);
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) throw new Error(`invalid UTF-8: ${filePath}`);
  return text.replace(/^\uFEFF/, '');
}

function loadAllowlist(workspace) {
  const filePath = path.join(workspace, ...ALLOWLIST_REL_PATH.split('/'));
  const document = JSON.parse(readUtf8(filePath));
  if (!document || typeof document !== 'object' || Array.isArray(document)
    || document.schema_version !== 2 || document.active_policy !== false || document.fallback !== false
    || !Array.isArray(document.entries) || document.entries.length === 0
    || document.entries.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry)
      || typeof entry.identifier !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(entry.identifier)
      || !Array.isArray(entry.rules) || entry.rules.length === 0
      || entry.rules.some((rule) => !rule || typeof rule !== 'object' || Array.isArray(rule)
        || !ALLOWED_CONTEXTS.has(rule.classification)
        || (['migration-symbol', 'migration-state-field'].includes(rule.classification) && typeof rule.line_pattern !== 'string')
        || (typeof rule.path !== 'string' && (typeof rule.path_prefix !== 'string' || typeof rule.path_suffix !== 'string'))))) {
    throw new Error(`${ALLOWLIST_REL_PATH} is malformed or enables active policy`);
  }
  return Object.freeze({
    entries: Object.freeze(document.entries.map((entry) => Object.freeze({ identifier: entry.identifier, rules: Object.freeze(entry.rules.map((rule) => Object.freeze({ ...rule }))) }))),
    identifiers: Object.freeze(document.entries.map((entry) => entry.identifier)),
    contexts: Object.freeze([...ALLOWED_CONTEXTS])
  });
}

function trackedFiles(workspace) {
  const result = spawnSync('git', ['-C', workspace, 'ls-files', '-z'], { encoding: 'buffer', windowsHide: true });
  if (result.status !== 0) {
    // Explicit validation workspaces used by the Toolkit contract tests are
    // copied without .git. Scan their complete candidate tree so the audit is
    // still active; a real workspace with Git metadata remains fail-closed.
    if (fs.existsSync(path.join(workspace, '.git'))) {
      throw new Error('git ls-files failed; the tracked tree could not be proven');
    }
    const files = [];
    const ignoredDirectories = new Set(['.git', 'node_modules', '.tmp', '.n8n-local', '.n8n-workflow-backups', '_dist']);
    function visit(directory) {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(fullPath);
        else if (entry.isFile()) files.push(slash(path.relative(workspace, fullPath)));
      }
    }
    visit(workspace);
    return files;
  }
  return result.stdout.toString('utf8').split('\0').filter(Boolean).map(slash);
}

function identifierPattern(identifier) {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[-_ ]+/g, '[-_ ]+');
  const suffix = identifier === 'reservation' ? 's?' : '';
  return new RegExp(`(?<![A-Za-z0-9])${escaped}${suffix}(?![A-Za-z0-9])`, 'gi');
}

function lineForOffset(text, offset) {
  let line = 1;
  for (let index = 0; index < offset; index += 1) if (text[index] === '\n') line += 1;
  return line;
}

function lineText(text, lineNumber) {
  const lines = text.split(/\r?\n/);
  return lines[lineNumber - 1] || '';
}

function codeOccurrenceIsLiteral(line, column) {
  const prefix = line.slice(0, column);
  if (/^\s*(?:\/\/|\*)/.test(line) || prefix.includes('//')) return true;
  for (const delimiter of ['"', "'", '`']) {
    let open = false;
    for (let index = 0; index < column; index += 1) {
      if (line[index] === '\\') { index += 1; continue; }
      if (line[index] === delimiter) open = !open;
    }
    if (open) return true;
  }
  const beforeSlash = prefix.lastIndexOf('/');
  return beforeSlash >= 0 && line.indexOf('/', column) > column;
}

function ruleMatchesPath(rule, relPath) {
  if (typeof rule.path === 'string') return relPath === rule.path;
  return relPath.startsWith(rule.path_prefix) && relPath.endsWith(rule.path_suffix);
}

function contextFor(entry, relPath, line, column) {
  for (const rule of entry.rules) {
    if (!ruleMatchesPath(rule, relPath)) continue;
    if (rule.classification === 'migration-literal' && !codeOccurrenceIsLiteral(line, column)) continue;
    if (typeof rule.line_pattern === 'string' && !new RegExp(rule.line_pattern).test(line)) continue;
    return rule.classification;
  }
  return null;
}

function validateTrackedTree(workspace = process.cwd()) {
  const root = path.resolve(workspace);
  const findings = [];
  let allowlist;
  try { allowlist = loadAllowlist(root); }
  catch (error) { return { ok: false, findings: [{ code: 'ALLOWLIST_INVALID', message: error.message }], files_scanned: 0, occurrences: 0 }; }

  let files;
  try { files = trackedFiles(root); }
  catch (error) { return { ok: false, findings: [{ code: 'TRACKED_TREE_UNAVAILABLE', message: error.message }], files_scanned: 0, occurrences: 0 }; }

  let filesScanned = 0;
  let occurrences = 0;
  for (const relPath of files) {
    if (!CANDIDATE_EXTENSIONS.has(path.extname(relPath).toLowerCase())) continue;
    const fullPath = path.join(root, ...relPath.split('/'));
    let text;
    try { text = readUtf8(fullPath); }
    catch (error) {
      findings.push({ code: 'CONTENT_UNREADABLE', path: relPath, message: error.message });
      continue;
    }
    filesScanned += 1;
    for (const entry of allowlist.entries) {
      const identifier = entry.identifier;
      const pattern = identifierPattern(identifier);
      for (const match of text.matchAll(pattern)) {
        occurrences += 1;
        const offset = match.index || 0;
        const lineNumber = lineForOffset(text, offset);
        const line = lineText(text, lineNumber);
        const column = offset - text.lastIndexOf('\n', Math.max(0, offset - 1)) - 1;
        const context = contextFor(entry, relPath, line, column);
        if (!context) {
          findings.push({ code: 'LEGACY_IDENTIFIER_UNCLASSIFIED', path: relPath, line: lineNumber, identifier, context: context || 'unknown' });
        }
      }
    }
  }
  return { ok: findings.length === 0, findings, files_scanned: filesScanned, occurrences };
}

function main() {
  const workspace = process.argv.includes('--workspace')
    ? process.argv[process.argv.indexOf('--workspace') + 1]
    : process.cwd();
  const result = validateTrackedTree(workspace || process.cwd());
  if (!result.ok) {
    for (const finding of result.findings) console.error(`FAIL: ${finding.code} ${finding.path || ''}${finding.line ? `:${finding.line}` : ''}`.trim());
    process.exitCode = 1;
    return;
  }
  console.log(`Nonoperative legacy identifier validation passed (${result.occurrences} classified occurrence(s)).`);
}

if (require.main === module) main();

module.exports = Object.freeze({
  ALLOWLIST_REL_PATH,
  ALLOWED_CONTEXTS,
  loadAllowlist,
  validateTrackedTree,
});
