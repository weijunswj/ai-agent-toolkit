#!/usr/bin/env node
'use strict';

// Plain-text check: user-facing docs say what they mean in plain English. It fails on
//   - references people outside the project cannot follow: GitHub issue, pull request, discussion,
//     commit and compare links, `#123`, "PR 12" or "issue 4" labels (repository file links are fine);
//   - the repository's own shorthand codes, listed in its settings file as banned terms (for example
//     a release code such as "N5"), each with the reason and the plain wording to use instead.
// Ordinary jargon is left to people and reviewers: a script cannot tell it from a normal word.
//
// Zero dependencies (Node and git only), so a repository can carry a copy of this one file.
// It reads one settings file (default .github/plain-text.json) and one shrink-only baseline of what
// was already there when the check was added. It never rewrites text: it points, a person rewrites.
//
// A repository may switch the check off only with a recorded reason (`off_reason` in its settings).
//
// Usage: node plain-text-check.cjs [--repo <dir>] [--config <file>] [--files <path>...]
//          [--init-baseline] [--prune-baseline] [--explain]
//   --files          check only these files (paths relative to the repository; out-of-scope ones are skipped)
//   --init-baseline  write the baseline from what is there now, only when no baseline exists yet
//   --prune-baseline lower baseline counts to what still occurs; never adds or raises anything
// Exit codes: 0 clean, 1 findings, 2 could not check (bad settings, unreadable file).

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CHECK_VERSION = 1;
const CONFIG_SCHEMA = 'toolkit-plain-text-config/v1';
const BASELINE_SCHEMA = 'toolkit-plain-references-baseline/v1';
const DEFAULT_CONFIG = path.join('.github', 'plain-text.json');

const DEFAULTS = Object.freeze({
  include: [''],
  exclude: ['CHANGELOG.md', 'docs/CHANGELOG.md', 'docs/archive/', 'docs/audits/', 'vendor/', 'third_party/', 'node_modules/',
    '.github/ISSUE_TEMPLATE/', '.github/PULL_REQUEST_TEMPLATE/', '.github/pull_request_template.md', '.github/PULL_REQUEST_TEMPLATE.md'],
  text_extensions: ['.md', '.mdc'],
  field_extensions: [],
  rules: { 'github-link': true, 'number-reference': true, 'pr-number-label': true, 'codex-mode-name': false },
  banned_terms: [],
  explained_terms: [],
  kept_terms: [],
  baseline: path.posix.join('.github', 'plain-text-baseline.json')
});

// In structured files (JSON, YAML) only the lines people read are checked: names, titles,
// descriptions and prompts. Keys, IDs and stored values keep whatever form their readers need.
const FIELD_LINE = /^\s*(?:-\s*)?["']?(?:name|title|description|display_name|short_description|default_prompt|shortDescription|longDescription|summary|run-name)["']?\s*:/;
const IGNORED_DIRS = new Set(['.git', 'node_modules', '.tmp', '.n8n-local', '.claude', 'dist', '_dist', 'coverage']);

const REFERENCE_RULES = Object.freeze([
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

class CheckError extends Error {
  constructor(message) { super(message); this.name = 'CheckError'; }
}

const slash = (value) => value.split(path.sep).join('/');
const normalise = (text) => text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A banned term is literal text in which `#` stands for one or more digits ("N#" matches N5 and N12).
// It matches only as a whole token: "N5" in "N5," but not in "N5x" or "AN5".
function termPattern(term, caseSensitive = true) {
  const body = term.split('#').map(escapeRegExp).join('\\d+');
  return new RegExp(`(?<![A-Za-z0-9_])${body}(?![A-Za-z0-9_])`, caseSensitive ? 'g' : 'gi');
}

function isStringList(value) { return Array.isArray(value) && value.every((item) => typeof item === 'string'); }

// Settings with defaults filled in. Anything malformed is an error, never "allow everything".
function resolveConfig(raw = {}, where = 'settings') {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new CheckError(`${where} is not a JSON object`);
  if (raw.schema !== undefined && raw.schema !== CONFIG_SCHEMA) throw new CheckError(`${where} is not a ${CONFIG_SCHEMA} file`);
  const config = { ...DEFAULTS, ...raw, rules: { ...DEFAULTS.rules, ...(raw.rules || {}) } };
  for (const key of ['include', 'exclude', 'text_extensions', 'field_extensions']) {
    if (!isStringList(config[key])) throw new CheckError(`${where}: ${key} must be a list of strings`);
  }
  for (const [id, on] of Object.entries(config.rules)) {
    if (!REFERENCE_RULES.some((rule) => rule.id === id)) throw new CheckError(`${where}: unknown rule ${id}`);
    if (typeof on !== 'boolean') throw new CheckError(`${where}: rule ${id} must be true or false`);
  }
  if (!Array.isArray(config.banned_terms)) throw new CheckError(`${where}: banned_terms must be a list`);
  for (const entry of config.banned_terms) {
    if (!entry || typeof entry.term !== 'string' || !/[A-Za-z]/.test(entry.term) || typeof entry.reason !== 'string' || typeof entry.fix !== 'string') {
      throw new CheckError(`${where}: each banned term needs a term (with a letter in it), a reason and a fix`);
    }
    if (entry.case_sensitive !== undefined && typeof entry.case_sensitive !== 'boolean') throw new CheckError(`${where}: case_sensitive must be true or false (${entry.term})`);
  }
  for (const [key, fields] of [['explained_terms', ['term', 'reason']], ['kept_terms', ['file', 'text', 'reason']]]) {
    if (!Array.isArray(config[key])) throw new CheckError(`${where}: ${key} must be a list`);
    for (const entry of config[key]) {
      if (!entry || fields.some((field) => typeof entry[field] !== 'string' || !entry[field])) throw new CheckError(`${where}: each of ${key} needs ${fields.join(', ')}`);
    }
  }
  if (typeof config.baseline !== 'string' || !config.baseline) throw new CheckError(`${where}: baseline must be a path`);
  if (config.off_reason !== undefined && (typeof config.off_reason !== 'string' || !config.off_reason.trim())) throw new CheckError(`${where}: off_reason must be a non-empty reason when present`);
  return Object.freeze(config);
}

function readConfigFile(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (error) { throw new CheckError(`${file} could not be read (${error.code || 'error'})`); }
  try { return resolveConfig(JSON.parse(normalise(text)), file); }
  catch (error) { throw error instanceof CheckError ? error : new CheckError(`${file} is not valid JSON`); }
}

const matchesPrefix = (rel, prefix) => prefix === '' || rel === prefix || (prefix.endsWith('/') && rel.startsWith(prefix));

// 'text' (every line), 'fields' (human-readable lines of a structured file) or null (not checked).
function scopeOf(rel, config) {
  if (config.exclude.some((prefix) => matchesPrefix(rel, prefix))) return null;
  if (rel.includes('/') && !config.include.some((prefix) => matchesPrefix(rel, prefix))) return null;
  const ext = path.posix.extname(rel).toLowerCase();
  if (config.text_extensions.includes(ext)) return 'text';
  if (config.field_extensions.includes(ext)) return 'fields';
  return null;
}

// Tracked files plus new files git does not ignore; a folder walk when git is not available.
function listFiles(root, { spawn = spawnSync } = {}) {
  const result = spawn('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (!result.error && result.status === 0 && typeof result.stdout === 'string') {
    const top = spawn('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8', windowsHide: true });
    if (!top.error && top.status === 0 && path.resolve(top.stdout.trim()) === path.resolve(root)) {
      return [...new Set(result.stdout.split('\0').filter(Boolean))].filter((rel) => fs.existsSync(path.join(root, rel))).sort();
    }
  }
  const files = [];
  const visit = (dir) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (item.isDirectory()) { if (!IGNORED_DIRS.has(item.name)) visit(path.join(dir, item.name)); continue; }
      if (item.isFile()) files.push(slash(path.relative(root, path.join(dir, item.name))));
    }
  };
  visit(root);
  return files.sort();
}

function listScopedFiles(root, config, options) {
  return listFiles(root, options).filter((rel) => scopeOf(rel, config));
}

// A listed term counts as explained in a file once one of its uses there sits next to a bracketed
// explanation: "V1 (`multi_agent`)" or "the planning step (G0)".
function explainedIn(text, config) {
  const explained = new Set();
  for (const entry of config.explained_terms) {
    const term = escapeRegExp(entry.term);
    if (new RegExp(`(?<![A-Za-z0-9_])${term}\\s*\\(|\\(\\s*${term}\\s*\\)`).test(text)) explained.add(entry.term);
  }
  return explained;
}

function keptFor(rel, config) {
  return new Set(config.kept_terms.filter((entry) => matchesPrefix(rel, entry.file)).map((entry) => entry.text));
}

function findInText(text, file, config, scope = 'text') {
  const findings = [];
  const body = normalise(text);
  const explained = explainedIn(body, config);
  const kept = keptFor(file, config);
  const rules = REFERENCE_RULES.filter((rule) => config.rules[rule.id]);
  const terms = config.banned_terms.map((entry) => ({ entry, pattern: termPattern(entry.term, entry.case_sensitive !== false) }));
  body.split('\n').forEach((line, index) => {
    if (scope === 'fields' && !FIELD_LINE.test(line)) return;
    for (const rule of rules) {
      for (const match of line.matchAll(rule.pattern)) findings.push({ file, line: index + 1, rule: rule.id, text: match[0] });
    }
    for (const { entry, pattern } of terms) {
      for (const match of line.matchAll(pattern)) {
        if (explained.has(match[0]) || kept.has(match[0])) continue;
        findings.push({ file, line: index + 1, rule: 'banned-term', text: match[0], term: entry.term });
      }
    }
  });
  return findings;
}

function scanFiles(root, files, config) {
  const findings = [];
  for (const rel of files) {
    const scope = scopeOf(rel, config);
    if (!scope) continue;
    let text;
    try { text = fs.readFileSync(path.join(root, rel), 'utf8'); }
    catch (error) {
      if (error.code === 'ENOENT') continue;
      throw new CheckError(`${rel} could not be read (${error.code || 'error'})`);
    }
    findings.push(...findInText(text, rel, config, scope));
  }
  return findings;
}

const keyOf = (entry) => `${entry.file}\u0000${entry.rule}\u0000${entry.text}`;

function readBaseline(root, config) {
  const file = path.join(root, config.baseline);
  if (!fs.existsSync(file)) return { schema: BASELINE_SCHEMA, allowed: [], missing: true };
  let baseline;
  try { baseline = JSON.parse(normalise(fs.readFileSync(file, 'utf8'))); }
  catch { throw new CheckError(`${config.baseline} is not valid JSON`); }
  if (baseline.schema !== BASELINE_SCHEMA || !Array.isArray(baseline.allowed)) throw new CheckError(`${config.baseline} is not a ${BASELINE_SCHEMA} file`);
  for (const entry of baseline.allowed) {
    if (typeof entry.file !== 'string' || typeof entry.rule !== 'string' || typeof entry.text !== 'string' || !Number.isInteger(entry.count) || entry.count < 1) {
      throw new CheckError(`${config.baseline} has an entry without file, rule, text and a positive count`);
    }
  }
  return baseline;
}

// Findings beyond the baseline count fail (every occurrence of that text in that file is listed, so
// the line to fix is among them). Baseline entries that occur less often than recorded are stale.
// With `files`, only those files are read and staleness is not judged.
function check(root, config, { files = null, spawn } = {}) {
  const baseline = readBaseline(root, config);
  const allowed = new Map(baseline.allowed.map((entry) => [keyOf(entry), entry.count]));
  const scoped = files ? files.map((rel) => slash(rel)).filter((rel) => scopeOf(rel, config)) : listScopedFiles(root, config, { spawn });
  const findings = scanFiles(root, scoped, config);
  const groups = new Map();
  for (const finding of findings) {
    const key = keyOf(finding);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(finding);
  }
  const failures = [];
  for (const [key, group] of groups) if (group.length > (allowed.get(key) || 0)) failures.push(...group);
  const stale = files ? [] : baseline.allowed.filter((entry) => (groups.get(keyOf(entry)) || []).length < entry.count)
    .map((entry) => ({ ...entry, found: (groups.get(keyOf(entry)) || []).length }));
  return { failures, stale, findings, baseline };
}

function describeFailure(finding, config) {
  if (finding.rule === 'banned-term') {
    const entry = config.banned_terms.find((item) => item.term === finding.term) || { reason: 'a banned term', fix: 'say what it means in plain English' };
    return `${finding.file}:${finding.line}: banned-term "${finding.text}": ${entry.reason}; ${entry.fix}`;
  }
  const rule = REFERENCE_RULES.find((item) => item.id === finding.rule);
  return `${finding.file}:${finding.line}: ${finding.rule} "${finding.text}": ${rule.fix}`;
}

function writeBaseline(root, config, baseline) {
  const file = path.join(root, config.baseline);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(baseline, null, 2)}\n`);
}

// Lowers each baseline count to what still occurs and drops entries that no longer occur. Never raises a count.
function pruneBaseline(root, config, options = {}) {
  const { baseline, findings } = check(root, config, options);
  const counts = new Map();
  for (const finding of findings) counts.set(keyOf(finding), (counts.get(keyOf(finding)) || 0) + 1);
  const allowed = baseline.allowed
    .map((entry) => ({ ...entry, count: Math.min(entry.count, counts.get(keyOf(entry)) || 0) }))
    .filter((entry) => entry.count > 0);
  const { missing, ...rest } = baseline;
  if (!missing) writeBaseline(root, config, { ...rest, allowed });
  return { removed: baseline.allowed.length - allowed.length, kept: allowed.length };
}

// Writes the starting baseline once, from what is there now. Refuses when a baseline already exists,
// so nothing can be added to a list that only shrinks.
function initBaseline(root, config, options = {}) {
  if (fs.existsSync(path.join(root, config.baseline))) throw new CheckError(`${config.baseline} already exists; it only shrinks, so it was not rewritten`);
  const { findings } = check(root, config, options);
  const counts = new Map();
  for (const finding of findings) {
    const key = keyOf(finding);
    if (!counts.has(key)) counts.set(key, { file: finding.file, rule: finding.rule, text: finding.text, count: 0 });
    counts.get(key).count += 1;
  }
  const allowed = [...counts.values()].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
  writeBaseline(root, config, {
    schema: BASELINE_SCHEMA,
    description: 'What was already there when the plain-text check was added. Each entry is allowed up to its count until it is rewritten; new ones fail. This list only shrinks: rewrite an entry, then run the check with --prune-baseline. Never add entries.',
    allowed
  });
  return { entries: allowed.length };
}

function explain(config) {
  const lines = [`Plain-text check v${CHECK_VERSION}.`, 'Reference rules:'];
  for (const rule of REFERENCE_RULES) lines.push(`  ${rule.id}: ${config.rules[rule.id] ? 'on' : 'off'}`);
  lines.push(`Banned terms (${config.banned_terms.length}):`);
  for (const entry of config.banned_terms) lines.push(`  ${entry.term}: ${entry.reason}. Instead: ${entry.fix}`);
  for (const entry of config.explained_terms) lines.push(`  allowed once explained in the same file: ${entry.term} (${entry.reason})`);
  for (const entry of config.kept_terms) lines.push(`  kept in ${entry.file}: ${entry.text} (${entry.reason})`);
  lines.push(`Checked: ${config.text_extensions.join(', ') || 'no'} files in full${config.field_extensions.length ? `; names, titles and descriptions in ${config.field_extensions.join(', ')} files` : ''}.`);
  lines.push(`Not checked: ${config.exclude.join(', ') || 'nothing excluded'}.`);
  return lines.join('\n');
}

function parseArgs(argv) {
  const args = { repo: process.cwd(), config: null, files: null, init: false, prune: false, explain: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--repo' || arg === '--config') {
      const value = argv[index + 1];
      if (value === undefined) throw new CheckError(`${arg} needs a value`);
      args[arg.slice(2)] = value;
      index += 1;
    } else if (arg === '--files') { args.files = argv.slice(index + 1); break; }
    else if (arg === '--init-baseline') args.init = true;
    else if (arg === '--prune-baseline') args.prune = true;
    else if (arg === '--explain') args.explain = true;
    else throw new CheckError(`unknown option ${arg}`);
  }
  args.repo = path.resolve(args.repo);
  args.config = args.config ? path.resolve(args.config) : path.join(args.repo, DEFAULT_CONFIG);
  return args;
}

function report({ failures, stale }, config, out, err) {
  for (const entry of stale) out.write(`NOTE: ${entry.file}: ${entry.rule} "${entry.text}" is in the baseline ${entry.count} time(s) but occurs ${entry.found}; run with --prune-baseline.\n`);
  if (failures.length) {
    for (const finding of failures) err.write(`FAIL: ${describeFailure(finding, config)}\n`);
    err.write(`\n${failures.length} item(s) to rewrite in plain English. Repository file links are fine.\n`);
    return 1;
  }
  out.write('Plain-text check passed.\n');
  return 0;
}

function main(argv = process.argv.slice(2), { out = process.stdout, err = process.stderr } = {}) {
  try {
    const args = parseArgs(argv);
    const config = readConfigFile(args.config);
    if (args.explain) { out.write(`${explain(config)}\n`); return 0; }
    if (config.off_reason) { out.write(`Plain-text check is switched off in this repository: ${config.off_reason.trim()}\n`); return 0; }
    if (args.init) {
      const result = initBaseline(args.repo, config);
      out.write(`Plain-text baseline written: ${config.baseline} (${result.entries} entr${result.entries === 1 ? 'y' : 'ies'}).\n`);
      return 0;
    }
    if (args.prune) {
      const result = pruneBaseline(args.repo, config);
      out.write(`Plain-text baseline pruned: ${result.removed} entr${result.removed === 1 ? 'y' : 'ies'} removed, ${result.kept} kept.\n`);
      return 0;
    }
    return report(check(args.repo, config, { files: args.files }), config, out, err);
  } catch (error) {
    err.write(`Could not check: ${error instanceof CheckError ? error.message : `internal error (${error && error.name ? error.name : 'unknown'})`}\n`);
    return 2;
  }
}

module.exports = Object.freeze({
  CHECK_VERSION, CONFIG_SCHEMA, BASELINE_SCHEMA, DEFAULT_CONFIG, DEFAULTS, REFERENCE_RULES, CheckError,
  termPattern, resolveConfig, readConfigFile, scopeOf, listFiles, listScopedFiles, findInText, scanFiles,
  check, describeFailure, pruneBaseline, initBaseline, explain, report, main
});

if (require.main === module) process.exitCode = main();
