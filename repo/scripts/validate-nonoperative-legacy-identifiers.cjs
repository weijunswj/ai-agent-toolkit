#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const toml = require('./toolkit-toml-structural.cjs');

const ALLOWLIST_REL_PATH = 'repo/contracts/route-resolution/nonoperative-legacy-allowlist-v1.json';
const ALLOWED_CONTEXTS = new Set(['contract-definition', 'structured-history', 'historical-document', 'migration-document', 'migration-literal', 'migration-symbol', 'migration-state-field', 'test-source']);
const OCCURRENCE_KINDS = new Set([
  'javascript-comment', 'javascript-string', 'javascript-template-quasi', 'javascript-regex-literal', 'javascript-executable',
  'json-key', 'json-string-value', 'json-structural', 'toml-comment', 'toml-string', 'toml-table', 'toml-structural',
  'markdown-comment', 'markdown-inline-code', 'markdown-fenced-code', 'markdown-prose',
  'yaml-comment', 'yaml-string', 'yaml-block', 'yaml-scalar', 'source-comment', 'source-string', 'source-executable', 'unknown',
]);
const CANDIDATE_EXTENSIONS = new Set(['.cjs', '.js', '.mjs', '.json', '.md', '.yaml', '.yml', '.toml', '.ps1', '.cmd', '.sh', '.py']);

function slash(value) { return String(value).split(path.sep).join('/'); }
function readUtf8(filePath) {
  const bytes = fs.readFileSync(filePath);
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) throw new Error(`invalid UTF-8: ${filePath}`);
  return text.replace(/^\uFEFF/, '');
}
function anchoredPattern(value) {
  if (typeof value !== 'string' || !value.startsWith('^') || !value.endsWith('$')) return false;
  try { new RegExp(value); return true; } catch { return false; }
}
function loadAllowlist(workspace) {
  const filePath = path.join(workspace, ...ALLOWLIST_REL_PATH.split('/'));
  const document = JSON.parse(readUtf8(filePath));
  if (!document || typeof document !== 'object' || Array.isArray(document)
    || document.schema_version !== 3 || document.active_policy !== false || document.fallback !== false
    || !Array.isArray(document.entries) || document.entries.length === 0
    || document.entries.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry)
      || typeof entry.identifier !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(entry.identifier)
      || !Array.isArray(entry.rules) || entry.rules.length === 0
      || entry.rules.some((rule) => !rule || typeof rule !== 'object' || Array.isArray(rule)
        || !ALLOWED_CONTEXTS.has(rule.classification)
        || !Array.isArray(rule.occurrence_kinds) || rule.occurrence_kinds.length === 0
        || rule.occurrence_kinds.some((kind) => !OCCURRENCE_KINDS.has(kind))
        || (['migration-symbol', 'migration-state-field'].includes(rule.classification) && !anchoredPattern(rule.token_pattern))
        || (rule.token_pattern !== undefined && !anchoredPattern(rule.token_pattern))
        || (typeof rule.path !== 'string' && (typeof rule.path_prefix !== 'string' || typeof rule.path_suffix !== 'string'))))) {
    throw new Error(`${ALLOWLIST_REL_PATH} is malformed or enables active policy`);
  }
  return Object.freeze({
    entries: Object.freeze(document.entries.map((entry) => Object.freeze({ identifier: entry.identifier, rules: Object.freeze(entry.rules.map((rule) => Object.freeze({ ...rule }))) }))),
    identifiers: Object.freeze(document.entries.map((entry) => entry.identifier)), contexts: Object.freeze([...ALLOWED_CONTEXTS]),
  });
}
function trackedFiles(workspace) {
  const result = spawnSync('git', ['-C', workspace, 'ls-files', '-z'], { encoding: 'buffer', windowsHide: true });
  if (result.status !== 0) {
    if (fs.existsSync(path.join(workspace, '.git'))) throw new Error('git ls-files failed; the tracked tree could not be proven');
    const files = [];
    const ignored = new Set(['.git', 'node_modules', '.tmp', '.n8n-local', '.n8n-workflow-backups', '_dist']);
    function visit(directory) {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory() && ignored.has(entry.name)) continue;
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(fullPath); else if (entry.isFile()) files.push(slash(path.relative(workspace, fullPath)));
      }
    }
    visit(workspace); return files;
  }
  return result.stdout.toString('utf8').split('\0').filter(Boolean).map(slash);
}
function identifierPattern(identifier) {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[-_ ]+/g, '[-_ ]+');
  return new RegExp(`(?<![A-Za-z0-9])${escaped}${identifier === 'reservation' ? 's?' : ''}(?![A-Za-z0-9])`, 'gi');
}
function lineForOffset(text, offset) { let line = 1; for (let index = 0; index < offset; index += 1) if (text[index] === '\n') line += 1; return line; }
function executableToken(text, offset) {
  let start = offset; let end = offset;
  while (start > 0 && /[A-Za-z0-9_$-]/.test(text[start - 1])) start -= 1;
  while (end < text.length && /[A-Za-z0-9_$-]/.test(text[end])) end += 1;
  return text.slice(start, end);
}
function javascriptSpans(text) {
  const spans = []; let state = 'code'; let start = -1; let templateDepth = 0; let index = 0; let previous = '';
  const add = (kind, end) => { spans.push({ kind, start, end, token: text.slice(start, end) }); start = -1; };
  const regexAllowed = () => previous === '' || /[=([{,:;!?&|+*%^~<>]/.test(previous);
  while (index < text.length) {
    const char = text[index];
    if (state === 'line-comment') { if (char === '\n') { add('javascript-comment', index); state = 'code'; } index += 1; continue; }
    if (state === 'block-comment') { if (text.startsWith('*/', index)) { index += 2; add('javascript-comment', index); state = 'code'; continue; } index += 1; continue; }
    if (state === 'string') { if (char === '\\') { index += Math.min(2, text.length - index); continue; } if (char === text[start]) { index += 1; add('javascript-string', index); state = 'code'; continue; } index += 1; continue; }
    if (state === 'regex') {
      let inClass = false; index = start + 1; let closed = false;
      while (index < text.length) {
        if (text[index] === '\\') { index += 2; continue; }
        if (text[index] === '[') inClass = true; else if (text[index] === ']') inClass = false;
        else if (text[index] === '/' && !inClass) { index += 1; while (/[A-Za-z]/.test(text[index] || '')) index += 1; add('javascript-regex-literal', index); state = 'code'; previous = '/'; closed = true; break; }
        else if (text[index] === '\n') break;
        index += 1;
      }
      if (!closed) { state = 'code'; start = -1; }
      continue;
    }
    if (state === 'template') {
      if (char === '\\') { index += Math.min(2, text.length - index); continue; }
      if (char === '`') { add('javascript-template-quasi', index); index += 1; state = 'code'; previous = '`'; continue; }
      if (text.startsWith('${', index)) { add('javascript-template-quasi', index); index += 2; state = 'code'; templateDepth = 1; previous = '{'; continue; }
      index += 1; continue;
    }
    if (text.startsWith('//', index)) { state = 'line-comment'; start = index; index += 2; continue; }
    if (text.startsWith('/*', index)) { state = 'block-comment'; start = index; index += 2; continue; }
    if (char === '"' || char === "'") { state = 'string'; start = index; index += 1; continue; }
    if (char === '`') { state = 'template'; start = index + 1; index += 1; continue; }
    if (templateDepth > 0) {
      if (char === '{') templateDepth += 1;
      else if (char === '}') { templateDepth -= 1; if (templateDepth === 0) { state = 'template'; start = index + 1; index += 1; continue; } }
    }
    if (char === '/' && regexAllowed()) { state = 'regex'; start = index; continue; }
    if (!/\s/.test(char)) previous = char;
    index += 1;
  }
  if (state === 'line-comment' || state === 'block-comment') add('javascript-comment', text.length);
  if (state === 'string') add('javascript-string', text.length);
  if (state === 'template' && start >= 0) add('javascript-template-quasi', text.length);
  return spans;
}
function jsonStrings(text) {
  try { JSON.parse(text); } catch { return null; }
  const spans = []; let index = 0;
  while (index < text.length) {
    if (text[index] !== '"') { index += 1; continue; }
    const start = index; index += 1;
    while (index < text.length) { if (text[index] === '\\') { index += 2; continue; } if (text[index] === '"') { index += 1; break; } index += 1; }
    let lookahead = index; while (/\s/.test(text[lookahead] || '')) lookahead += 1;
    spans.push({ kind: text[lookahead] === ':' ? 'json-key' : 'json-string-value', start, end: index, token: text.slice(start + 1, index - 1) });
  }
  return spans;
}
function markdownKind(text, offset) {
  const before = text.slice(0, offset); const lineStart = before.lastIndexOf('\n') + 1; const next = text.indexOf('\n', offset); const line = text.slice(lineStart, next === -1 ? text.length : next);
  if ((before.match(/^\s*```/gm) || []).length % 2 === 1) return { kind: 'markdown-fenced-code', token: line.trim() };
  if (before.lastIndexOf('<!--') > before.lastIndexOf('-->')) return { kind: 'markdown-comment', token: line.trim() };
  const ticks = (line.slice(0, offset - lineStart).match(/`/g) || []).length;
  return { kind: ticks % 2 === 1 ? 'markdown-inline-code' : 'markdown-prose', token: line.trim() };
}
function yamlKind(text, offset) {
  const before = text.slice(0, offset); const lines = text.split(/\r?\n/); const lineNumber = lineForOffset(text, offset); const line = lines[lineNumber - 1] || ''; const column = offset - (before.lastIndexOf('\n') + 1);
  if (/^\s*#/.test(line) || line.slice(0, column).includes('#')) return { kind: 'yaml-comment', token: line.trim() };
  if ((line.slice(0, column).match(/["']/g) || []).length % 2 === 1) return { kind: 'yaml-string', token: line.trim() };
  for (let index = lineNumber - 2; index >= 0; index -= 1) { if (!lines[index].trim()) continue; if (/[:>-]\s*[|>]\s*(?:#.*)?$/.test(lines[index])) return { kind: 'yaml-block', token: line.trim() }; break; }
  return { kind: 'yaml-scalar', token: executableToken(text, offset) };
}
function genericSourceKind(text, offset) {
  const before = text.slice(0, offset); const lineStart = before.lastIndexOf('\n') + 1; const next = text.indexOf('\n', offset); const line = text.slice(lineStart, next === -1 ? text.length : next); const column = offset - lineStart;
  if (/^\s*(?:#|REM\b)/i.test(line) || line.slice(0, column).includes('#')) return { kind: 'source-comment', token: line.trim() };
  if ((line.slice(0, column).match(/["']/g) || []).length % 2 === 1) return { kind: 'source-string', token: line.trim() };
  return { kind: 'source-executable', token: executableToken(text, offset) };
}
function occurrenceAt(text, relPath, offset, cache) {
  const extension = path.extname(relPath).toLowerCase();
  if (['.js', '.cjs', '.mjs'].includes(extension)) {
    if (!cache.javascript) cache.javascript = javascriptSpans(text);
    const span = cache.javascript.find((candidate) => candidate.start <= offset && offset < candidate.end);
    return span || { kind: 'javascript-executable', token: executableToken(text, offset) };
  }
  if (extension === '.json') { if (cache.json === undefined) cache.json = jsonStrings(text); if (cache.json === null) return { kind: 'unknown', token: executableToken(text, offset) }; return cache.json.find((candidate) => candidate.start <= offset && offset < candidate.end) || { kind: 'json-structural', token: executableToken(text, offset) }; }
  if (extension === '.toml') { if (!cache.toml) cache.toml = toml.analyseToml(text); if (cache.toml.validity.ok !== true) return { kind: 'unknown', token: executableToken(text, offset) }; return { kind: toml.classifyOffset(cache.toml, offset), token: executableToken(text, offset) }; }
  if (extension === '.md') return markdownKind(text, offset);
  if (['.yaml', '.yml'].includes(extension)) return yamlKind(text, offset);
  return genericSourceKind(text, offset);
}
function ruleMatchesPath(rule, relPath) { return typeof rule.path === 'string' ? relPath === rule.path : relPath.startsWith(rule.path_prefix) && relPath.endsWith(rule.path_suffix); }
function contextFor(entry, relPath, occurrence) {
  for (const rule of entry.rules) {
    if (!ruleMatchesPath(rule, relPath) || !rule.occurrence_kinds.includes(occurrence.kind)) continue;
    if (typeof rule.token_pattern === 'string' && !new RegExp(rule.token_pattern).test(occurrence.token)) continue;
    return rule.classification;
  }
  return null;
}
function validateTrackedTree(workspace = process.cwd()) {
  const root = path.resolve(workspace); const findings = []; let allowlist;
  try { allowlist = loadAllowlist(root); } catch (error) { return { ok: false, findings: [{ code: 'ALLOWLIST_INVALID', message: error.message }], files_scanned: 0, occurrences: 0 }; }
  let files; try { files = trackedFiles(root); } catch (error) { return { ok: false, findings: [{ code: 'TRACKED_TREE_UNAVAILABLE', message: error.message }], files_scanned: 0, occurrences: 0 }; }
  let filesScanned = 0; let occurrences = 0;
  for (const relPath of files) {
    if (!CANDIDATE_EXTENSIONS.has(path.extname(relPath).toLowerCase())) continue;
    let text; try { text = readUtf8(path.join(root, ...relPath.split('/'))); } catch (error) { findings.push({ code: 'CONTENT_UNREADABLE', path: relPath, message: error.message }); continue; }
    filesScanned += 1; const cache = {};
    for (const entry of allowlist.entries) for (const match of text.matchAll(identifierPattern(entry.identifier))) {
      occurrences += 1; const offset = match.index || 0; const occurrence = occurrenceAt(text, relPath, offset, cache); const context = contextFor(entry, relPath, occurrence);
      if (!context) findings.push({ code: 'LEGACY_IDENTIFIER_UNCLASSIFIED', path: relPath, line: lineForOffset(text, offset), identifier: entry.identifier, occurrence_kind: occurrence.kind, context: 'unknown' });
    }
  }
  return { ok: findings.length === 0, findings, files_scanned: filesScanned, occurrences };
}
function main() {
  const workspace = process.argv.includes('--workspace') ? process.argv[process.argv.indexOf('--workspace') + 1] : process.cwd(); const result = validateTrackedTree(workspace || process.cwd());
  if (!result.ok) { for (const finding of result.findings) console.error(`FAIL: ${finding.code} ${finding.path || ''}${finding.line ? `:${finding.line}` : ''}`.trim()); process.exitCode = 1; return; }
  console.log(`Nonoperative legacy identifier validation passed (${result.occurrences} classified occurrence(s)).`);
}
if (require.main === module) main();
module.exports = Object.freeze({ ALLOWLIST_REL_PATH, ALLOWED_CONTEXTS, OCCURRENCE_KINDS, loadAllowlist, validateTrackedTree });
