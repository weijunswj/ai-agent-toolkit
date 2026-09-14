#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ALLOWLIST_REL_PATH = 'repo/contracts/route-resolution/nonoperative-legacy-allowlist-v1.json';
const ALLOWED_CONTEXTS = new Set(['migration-detection', 'historical-evidence', 'repair-diagnostic']);
const CANDIDATE_EXTENSIONS = new Set(['.cjs', '.js', '.mjs', '.json', '.md', '.yaml', '.yml', '.toml', '.ps1', '.cmd', '.sh', '.py']);
const HISTORICAL_AUDIT = 'repo/docs/audits/2026-07-15-native-codex-uat-remediation-audit.md';
const VALIDATOR_REL_PATH = 'repo/scripts/validate-nonoperative-legacy-identifiers.cjs';
const EXACT_MIGRATION_FILES = new Map([
  ['repo/scripts/toolkit-managed-config-migration.cjs', 'migration-detection'],
  ['repo/tests/toolkit-managed-config-migration.test.cjs', 'repair-diagnostic'],
]);

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
    || document.active_policy !== false || document.fallback !== false
    || !Array.isArray(document.legacy_identifiers)
    || !Array.isArray(document.allowed_contexts)
    || document.legacy_identifiers.length === 0
    || new Set(document.legacy_identifiers).size !== document.legacy_identifiers.length
    || document.legacy_identifiers.some((value) => typeof value !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(value))
    || document.allowed_contexts.some((value) => !ALLOWED_CONTEXTS.has(value))) {
    throw new Error(`${ALLOWLIST_REL_PATH} is malformed or enables active policy`);
  }
  return Object.freeze({
    identifiers: Object.freeze([...document.legacy_identifiers]),
    contexts: Object.freeze([...document.allowed_contexts])
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

function explicitContexts(text) {
  const lines = text.split(/\r?\n/);
  const contexts = [];
  const malformed = [];
  let open = null;
  for (let index = 0; index < lines.length; index += 1) {
    const begin = lines[index].match(/^\s*NONOPERATIVE-LEGACY-CONTEXT:\s*(migration-detection|historical-evidence|repair-diagnostic)\s*$/i);
    const end = /^\s*NONOPERATIVE-LEGACY-CONTEXT:END\s*$/.test(lines[index]);
    if (begin) {
      if (open) malformed.push(index + 1);
      else open = { context: begin[1].toLowerCase(), start: index + 1 };
    } else if (end) {
      if (!open) malformed.push(index + 1);
      else {
        contexts.push({ ...open, end: index + 1 });
        open = null;
      }
    }
  }
  if (open) malformed.push(open.start);
  return { contexts, malformed };
}

function jsonArraySectionContains(text, offset, field) {
  const fieldStart = text.lastIndexOf(`"${field}"`, offset);
  if (fieldStart < 0) return false;
  const opening = text.indexOf('[', fieldStart);
  const closing = text.indexOf(']', opening + 1);
  return opening >= 0 && closing >= offset;
}

function specialContext(relPath, text, offset, line) {
  if (relPath === ALLOWLIST_REL_PATH) return 'migration-detection';
  if (relPath === VALIDATOR_REL_PATH) return 'migration-detection';
  if (relPath === 'repo/contracts/route-resolution/g3-implementation-allowlist-v1.json'
    && jsonArraySectionContains(text, offset, 'delete_paths')) return 'historical-evidence';
  if (relPath === 'repo/contracts/route-resolution/route-resolution-policy-v1.json'
    && jsonArraySectionContains(text, offset, 'forbidden_active_authority')) return 'historical-evidence';
  if (EXACT_MIGRATION_FILES.has(relPath)) return EXACT_MIGRATION_FILES.get(relPath);
  if (relPath === HISTORICAL_AUDIT) return 'historical-evidence';
  if (relPath === 'repo/scripts/codex-delegation-common.cjs' && /CODEX_HELPER_CAPACITY_(?:BEGIN|END)/.test(line)) return 'migration-detection';
  if (relPath === 'repo/scripts/codex-delegation-layout.cjs' && /CODEX_HELPER_CAPACITY_(?:BEGIN|END)/.test(line)) return 'migration-detection';
  if (relPath === 'repo/scripts/codex-delegation-state.cjs'
    && /helper[-_ ]capacity/i.test(line)
    && /(CODEX_HELPER_CAPACITY|Object\.freeze|markerCategories|assignmentsByCategory|malformed|official|approved|migrat)/i.test(line)) return 'migration-detection';
  if (relPath === 'repo/scripts/setup-toolkit-core.cjs'
    && /codex-helper-(?:capacity|count)|approve-high-helper-capacity|helper[-_ ]capacity/i.test(line)
    && /--|owner_question_id|activation_key|detail_type|backward-compatible|Unsupported|Custom Codex helper capacity/i.test(line)) return 'migration-detection';
  if (relPath === 'repo/scripts/codex-delegation-config.cjs'
    && /helper[-_ ]capacity/i.test(line)
    && /CODEX_HELPER_CAPACITY|marker|assignment|proposal|approved|migrat|legacy|unmarked|exact/i.test(line)) return 'migration-detection';
  if (relPath === 'repo/tests/codex-delegation-malformed-repair.test.cjs') return 'repair-diagnostic';
  if (relPath === 'repo/tests/codex-delegation-v2.test.cjs' && /CODEX-HELPER-CAPACITY/i.test(line)) return 'repair-diagnostic';
  if (/^repo\/tests\/toolkit-setup-[^/]+\.test\.cjs$/.test(relPath)
    && /--codex-helper-(?:capacity|count)|approve-high-helper-capacity|helper[-_ ]capacity/i.test(line)) return 'repair-diagnostic';
  if (relPath === 'repo/tests/toolkit-setup-orchestrator-3.test.cjs'
    && /assert\.match/.test(line)
    && /reservations?/i.test(line)) return 'repair-diagnostic';
  if (relPath === 'repo/tests/toolkit-local-bridge.test.cjs' && /toolkit-agent-control\.cjs/.test(line)) return 'repair-diagnostic';
  return null;
}

function contextFor(relPath, text, offset, lineNumber, line, contexts) {
  const explicit = contexts.find((entry) => lineNumber > entry.start && lineNumber < entry.end);
  if (explicit) return explicit.context;
  const special = specialContext(relPath, text, offset, line);
  if (special) return special;

  const activeAuthority = /\b(?:route|routing|scheduler|schedule|admission|admit|policy|authority|launch|execution|execute|provider|model|speed|queue|reservation)\b/i.test(line);
  const explicitNonoperative = /\b(?:not|never|cannot|without|forbidden|retired|historical|diagnostic|repair|deprecated|obsolete|unsupported|unverifiable|unverified|stale|malformed|excluded|outside|bypass|false|failed|failure|removed|remove|preserv\w*|doesNotMatch|does\s+not|do\s+not|no)\b/i.test(line)
    || /NONOPERATIVE|NON-OPERATIVE|migration-only|compatibility-only|legacy-only/i.test(line);
  if (activeAuthority && !explicitNonoperative) return null;
  if (explicitNonoperative || /\b(?:legacy|migration|old)\b/i.test(line)) return 'historical-evidence';
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
    const contexts = explicitContexts(text);
    for (const line of contexts.malformed) findings.push({ code: 'CONTEXT_MARKER_MALFORMED', path: relPath, line });
    for (const identifier of allowlist.identifiers) {
      const pattern = identifierPattern(identifier);
      for (const match of text.matchAll(pattern)) {
        occurrences += 1;
        const offset = match.index || 0;
        const lineNumber = lineForOffset(text, offset);
        const context = contextFor(relPath, text, offset, lineNumber, lineText(text, lineNumber), contexts.contexts);
        if (!context || !allowlist.contexts.includes(context)) {
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
