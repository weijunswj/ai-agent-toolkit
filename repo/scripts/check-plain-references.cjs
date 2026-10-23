#!/usr/bin/env node
'use strict';

// Plain-English references in user-facing docs, skills and AI-facing instructions: no GitHub issue,
// pull request, discussion, commit or compare links, no `#123` references, no "PR 237" labels and
// no Codex mode class names. Links to repository files are fine. Write what the reference means
// instead, for example "the governance states work" rather than "#542".
//
// Pre-existing offenders are listed in the baseline and allowed up to their recorded count; any new
// one fails. The baseline only shrinks: `--prune-baseline` drops entries that no longer occur, and
// nothing here adds entries.
//
// Usage: node repo/scripts/check-plain-references.cjs [--root <dir>] [--prune-baseline]

const fs = require('node:fs');
const path = require('node:path');

const BASELINE_REL = 'repo/contracts/plain-references/baseline.json';
const BASELINE_SCHEMA = 'toolkit-plain-references-baseline/v1';

// History, frozen audits, vendored third-party copies, provenance and test fixtures keep their references.
const EXCLUDED_PREFIXES = Object.freeze([
  'repo/docs/CHANGELOG.md',
  'repo/docs/audits/',
  'repo/contracts/third-party/',
  'repo/source-watch/',
  'repo/tests/'
]);
const INCLUDED_ROOTS = Object.freeze(['.agents/', '.claude-plugin/', '.codex-plugin/', 'repo/', 'skills/']);
const IGNORED_DIRS = new Set(['.git', 'node_modules', '.tmp', '.n8n-local', '.claude', 'dist', '_dist', 'coverage']);

const RULES = Object.freeze([
  {
    id: 'github-link',
    pattern: /https?:\/\/(?:www\.)?github\.com\/[^/\s)]+\/[^/\s)]+\/(?:issues|pulls?|discussions|commits?|compare)\/[^\s)>\]`"']*/gi,
    fix: 'replace the GitHub link with a plain-English description; link a repository file instead if one helps'
  },
  {
    id: 'number-reference',
    pattern: /(?<![\w&/#-])#\d{1,5}(?!\w)/g,
    fix: 'replace the #number with what it refers to, in plain English'
  },
  {
    id: 'pr-number-label',
    pattern: /\b(?:PRs?|pull requests?|issues?)\s+\d+\b/gi,
    fix: 'replace the pull request or issue number with what it refers to, in plain English'
  },
  {
    id: 'codex-mode-name',
    pattern: /\bMultiAgentV[12]\b/g,
    fix: 'write Codex modes as V1 (`multi_agent`) or V2 (`multi_agent_v2`)'
  }
]);

function slash(value) {
  return value.split(path.sep).join('/');
}

function inScope(rel) {
  if (EXCLUDED_PREFIXES.some((prefix) => rel === prefix || (prefix.endsWith('/') && rel.startsWith(prefix)))) return false;
  if (rel.includes('/') && !INCLUDED_ROOTS.some((root) => rel.startsWith(root))) return false;
  const base = path.posix.basename(rel);
  return /\.(md|mdc)$/i.test(base) || base === 'plugin.json' || (base === 'openai.yaml' && rel.startsWith('skills/'));
}

function listScopedFiles(root) {
  const files = [];
  const visit = (dir) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (item.isDirectory()) {
        if (!IGNORED_DIRS.has(item.name)) visit(path.join(dir, item.name));
        continue;
      }
      if (!item.isFile()) continue;
      const rel = slash(path.relative(root, path.join(dir, item.name)));
      if (inScope(rel)) files.push(rel);
    }
  };
  visit(root);
  return files.sort();
}

function findReferences(text, file = '') {
  const findings = [];
  const lines = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').split('\n');
  lines.forEach((line, index) => {
    for (const rule of RULES) {
      for (const match of line.matchAll(rule.pattern)) findings.push({ file, line: index + 1, rule: rule.id, text: match[0] });
    }
  });
  return findings;
}

function scan(root) {
  const findings = [];
  for (const rel of listScopedFiles(root)) findings.push(...findReferences(fs.readFileSync(path.join(root, rel), 'utf8'), rel));
  return findings;
}

const keyOf = (entry) => `${entry.file}\u0000${entry.rule}\u0000${entry.text}`;

function readBaseline(root) {
  const file = path.join(root, BASELINE_REL);
  if (!fs.existsSync(file)) return { schema: BASELINE_SCHEMA, allowed: [] };
  const baseline = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  if (baseline.schema !== BASELINE_SCHEMA || !Array.isArray(baseline.allowed)) throw new Error(`${BASELINE_REL} is not a ${BASELINE_SCHEMA} file`);
  for (const entry of baseline.allowed) {
    if (typeof entry.file !== 'string' || typeof entry.rule !== 'string' || typeof entry.text !== 'string' || !Number.isInteger(entry.count) || entry.count < 1) {
      throw new Error(`${BASELINE_REL} has an entry without file, rule, text and a positive count`);
    }
  }
  return baseline;
}

// Findings beyond the baseline count are failures (every occurrence of that reference is listed, so
// the line to fix is among them). Baseline entries that occur less often than recorded are stale.
function check(root) {
  const baseline = readBaseline(root);
  const allowed = new Map(baseline.allowed.map((entry) => [keyOf(entry), entry.count]));
  const findings = scan(root);
  const groups = new Map();
  for (const finding of findings) {
    const key = keyOf(finding);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(finding);
  }
  const failures = [];
  for (const [key, group] of groups) if (group.length > (allowed.get(key) || 0)) failures.push(...group);
  const stale = baseline.allowed.filter((entry) => (groups.get(keyOf(entry)) || []).length < entry.count)
    .map((entry) => ({ ...entry, found: (groups.get(keyOf(entry)) || []).length }));
  return { failures, stale, findings, baseline };
}

function describeFailure(finding) {
  const rule = RULES.find((item) => item.id === finding.rule);
  return `${finding.file}:${finding.line}: ${finding.rule} "${finding.text}": ${rule.fix}`;
}

// Lowers each baseline count to what still occurs and drops entries that no longer occur. Never raises a count.
function pruneBaseline(root) {
  const { baseline, findings } = check(root);
  const counts = new Map();
  for (const finding of findings) counts.set(keyOf(finding), (counts.get(keyOf(finding)) || 0) + 1);
  const allowed = baseline.allowed
    .map((entry) => ({ ...entry, count: Math.min(entry.count, counts.get(keyOf(entry)) || 0) }))
    .filter((entry) => entry.count > 0);
  const next = { ...baseline, allowed };
  fs.writeFileSync(path.join(root, BASELINE_REL), `${JSON.stringify(next, null, 2)}\n`);
  return { removed: baseline.allowed.length - allowed.length, kept: allowed.length };
}

function parseArgs(argv) {
  const args = { root: process.cwd(), prune: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--root') args.root = argv[++index];
    else if (argv[index] === '--prune-baseline') args.prune = true;
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  args.root = path.resolve(args.root);
  return args;
}

function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.prune) {
    const result = pruneBaseline(args.root);
    console.log(`Plain-references baseline pruned: ${result.removed} entr${result.removed === 1 ? 'y' : 'ies'} removed, ${result.kept} kept.`);
    return 0;
  }
  const { failures, stale } = check(args.root);
  for (const entry of stale) console.log(`NOTE: ${entry.file}: ${entry.rule} "${entry.text}" is in the baseline ${entry.count} time(s) but occurs ${entry.found}; run with --prune-baseline.`);
  if (failures.length) {
    for (const finding of failures) console.error(`FAIL: ${describeFailure(finding)}`);
    console.error(`\n${failures.length} reference(s) to rewrite in plain English. Repository file links are fine.`);
    return 1;
  }
  console.log('Plain-references check passed.');
  return 0;
}

if (require.main === module) {
  try { process.exitCode = run(); } catch (error) { console.error(`FAIL: ${error.message}`); process.exitCode = 1; }
}

module.exports = Object.freeze({ BASELINE_REL, RULES, inScope, listScopedFiles, findReferences, scan, check, describeFailure, pruneBaseline });
