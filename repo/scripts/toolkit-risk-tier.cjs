#!/usr/bin/env node
'use strict';

// Tags a change RISKY, NORMAL or LIGHT by the paths it touches, never by its size, so the tier is not
// a model's guess. Each changed path takes the first list it matches in the repository's
// .github/toolkit-risk-tiers.json (risky, then normal, then light), or NORMAL when it matches none.
// Inside a list a pattern starting with ! takes one file (its full path, no wildcards) back out, and
// the last matching pattern wins, as in .gitignore. Patterns match regardless of letter case, so a path typed in another case on
// Windows still counts, and a typed path is tidied first (separators, ./ and .. parts, a trailing
// space or dot Windows would drop).
// A file whose changed lines only bump the product version counts as LIGHT. A mixed change takes its
// highest tier. Reading from git, each path also takes the tier the list at the merge base gives it
// (the built-in default list when the merge base had none), so a change cannot lower its own tier by
// editing or adding the list.
// Without a repository list, a generic default list is used and the output says so.
//
// Usage: node repo/scripts/toolkit-risk-tier.cjs [--repo <dir>] [--base <ref>] [--json] [-- <path>...]
//   Without paths it reads the change from git: committed work since the merge base with --base
//   (default: the remote default branch, else origin/main), plus uncommitted and untracked files.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CONFIG_REL = '.github/toolkit-risk-tiers.json';
const SCHEMA = 'toolkit-risk-tiers/v1';
const TIERS = Object.freeze(['LIGHT', 'NORMAL', 'RISKY']);
const LISTS = Object.freeze([['risky', 'RISKY'], ['normal', 'NORMAL'], ['light', 'LIGHT']]);
const DEFAULT_CONFIG = Object.freeze({
  schema: SCHEMA,
  risky: ['.github/toolkit-risk-tiers.json', '.github/workflows/**', '**/AGENTS.md', '**/CLAUDE.md', '**/GEMINI.md', '.agents/rules/**',
    '**/*hook*', '**/*install*', '**/setup*', '**/*deploy*', '**/migrations/**', '**/*migration*', '**/.env*',
    '**/*secret*', '**/*credential*', '**/auth/**', '**/Dockerfile*', '**/docker-compose*', '.claude/**', '.codex/**'],
  normal: [],
  light: ['**/*.md', '**/*.txt', '**/*.rst', 'LICENSE*'],
});
// A changed line that only bumps the product version: a "version" key in a JSON file, a version or
// __version__ constant in a code file, or a Toolkit managed-block marker whose toolkit= version is the
// only thing a bump changes. Every removed line must pair with an added line at the same place in its
// hunk that differs only in that version, so a moved line is never a bump. Other version-like names, such as MIN_VERSION, can change behaviour, so they keep the
// path's tier, and a code constant never lowers a RISKY path (an installer's VERSION picks what it
// downloads). The Projects skill's own "Version: <date>.<counter>" line, which bump-version.cjs --next
// sets at merge time, counts too, in that one file only.
const SEMVER_VALUE = /v?\d+\.\d+\.\d+/;
const MARKER_VERSION = / toolkit=\d+\.\d+\.\d+ /;
const SKILL_VERSION = /^Version: \d{4}-\d{2}-\d{2}\.\d+$/;
const VERSION_LINES = Object.freeze([
  { files: /\.json$/i, line: /^\s*"version"\s*:\s*"v?\d+\.\d+\.\d+"\s*,?\s*$/, risky: true },
  { files: /\.(?:[cm]?js|ts|py)$/i, line: /^\s*(?:(?:export\s+)?(?:const|let|var)\s+)?(?:version|__version__)\s*=\s*["'`]v?\d+\.\d+\.\d+["'`]\s*;?\s*$/i, risky: false },
  { files: /./, line: /^\s*<!-- AI-AGENT-TOOLKIT:[^\s]+:BEGIN [A-Za-z0-9._-]+ v\d+ toolkit=\d+\.\d+\.\d+ sha256=[0-9a-f]{12} -->\s*$/, risky: true },
  { files: /^repo\/contracts\/claude-projects\/web-controller-projects\/SKILL\.md$/, line: SKILL_VERSION, risky: true },
]);

function fail(message) { throw Object.assign(new Error(message), { code: 'RISK_TIER_INPUT' }); }

// gitignore-style globs: `**` spans folders, `*` and `?` stay inside one name, and a pattern
// without a slash matches the name in any folder.
function globToRegExp(glob, { ignoreCase = false } = {}) {
  let source = '';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === '*' && glob[index + 1] === '*') {
      if (glob[index + 2] === '/') { source += '(?:.*/)?'; index += 2; } else { source += '.*'; index += 1; }
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(glob.includes('/') ? `^${source}$` : `(?:^|/)${source}$`, ignoreCase ? 'i' : '');
}

// The path as git would write it: forward slashes, no ./ or .. parts, no leading slash, and no
// trailing space or dot on a name (Windows drops them, so "AGENTS.md " is AGENTS.md).
function normalizePath(rel) {
  const parts = path.posix.normalize(String(rel).replace(/\\/g, '/')).split('/')
    .map(part => (part === '.' || part === '..' ? part : part.replace(/[. ]+$/, '')));
  return path.posix.normalize(parts.join('/')).replace(/^(?:\.\/)+/, '').replace(/^\/+/, '').replace(/\/+$/, '');
}

function parseConfig(text, where) {
  let config;
  try { config = JSON.parse(text); } catch (error) { fail(`${where} is not valid JSON: ${error.message}`); }
  if (!config || config.schema !== SCHEMA) fail(`${where} must have schema ${SCHEMA}.`);
  for (const [key] of LISTS) {
    if (!Array.isArray(config[key]) || config[key].some(entry => typeof entry !== 'string' || !entry.replace(/^!/, '').trim())) fail(`${where} "${key}" must be a list of path patterns.`);
    // An exception names one file by its full path, so it can never take a whole name or folder out.
    const loose = config[key].find(entry => entry.startsWith('!') && (!entry.includes('/') || /[*?[\]]/.test(entry) || normalizePath(entry.slice(1)) !== entry.slice(1)));
    if (loose) fail(`${where} "${key}" exception ${loose} must name one file by its full path, with no wildcards.`);
  }
  return config;
}

function loadConfig(repoRoot) {
  const file = path.join(repoRoot, CONFIG_REL);
  if (!fs.existsSync(file)) return { config: DEFAULT_CONFIG, source: 'built-in default list' };
  return { config: parseConfig(fs.readFileSync(file, 'utf8'), CONFIG_REL), source: CONFIG_REL };
}

// A version change is a removed line and an added line that differ only in the version (for a marker,
// only its toolkit= value). With hunks known (read from git), each hunk's removed lines pair in order
// with its added lines; with only the signs known, each removed line pairs with one added line; with
// bare changed lines, every line needs a partner. A pair of identical lines is a move, not a bump.
function versionOnly(rel, changes, { risky = false } = {}) {
  const rules = VERSION_LINES.filter(rule => rule.files.test(rel) && (!risky || rule.risky));
  const signed = !Array.isArray(changes);
  const lines = signed ? [...changes.removed, ...changes.added] : changes;
  if (!lines.length || !lines.every(line => rules.some(rule => rule.line.test(line)))) return false;
  const key = line => (SKILL_VERSION.test(line) ? 'Version: <version>'
    : MARKER_VERSION.test(line) ? line.replace(MARKER_VERSION, ' toolkit=<version> ') : line.replace(SEMVER_VALUE, '<version>'));
  const bump = (removed, added) => removed !== added && key(removed) === key(added);
  if (signed && Array.isArray(changes.hunks)) {
    return changes.hunks.every(hunk => hunk.removed.length === hunk.added.length && hunk.removed.every((line, index) => bump(line, hunk.added[index])));
  }
  if (signed && changes.removed.some(line => changes.added.includes(line))) return false;
  const count = (list, sign) => list.reduce((map, line) => map.set(key(line), (map.get(key(line)) || 0) + sign), new Map());
  if (signed) {
    const balance = count(changes.added, 1);
    for (const line of changes.removed) balance.set(key(line), (balance.get(key(line)) || 0) - 1);
    return [...balance.values()].every(value => value === 0);
  }
  const groups = new Map();
  for (const line of lines) groups.set(key(line), [...(groups.get(key(line)) || []), line]);
  return [...groups.values()].every(group => group.length % 2 === 0 && new Set(group).size > 1);
}

function pathTier(rel, config) {
  const clean = normalizePath(rel);
  for (const [key, tier] of LISTS) {
    let pattern = null;
    for (const entry of config[key]) {
      // An exception names one tracked file exactly, so it matches case-sensitively: a new file
      // that differs only in case keeps the folder's tier.
      const negated = entry.startsWith('!');
      if (globToRegExp(negated ? entry.slice(1) : entry, { ignoreCase: !negated }).test(clean)) pattern = negated ? null : entry;
    }
    if (pattern) return { tier, rule: `${key}: ${pattern}` };
  }
  return { tier: 'NORMAL', rule: 'no list matched' };
}

// One changed file: { path, changedLines } or { path, removed, added }; changedLines is null when the
// content is unknown (an added, deleted or binary file, or a path given on the command line). With
// several lists (the current one and the one at the merge base), the file takes the highest tier.
function classifyFile(file, configs) {
  const lists = Array.isArray(configs) ? configs : [configs];
  const byPath = lists.map(config => pathTier(file.path, config))
    .reduce((top, entry) => (TIERS.indexOf(entry.tier) > TIERS.indexOf(top.tier) ? entry : top));
  const changes = file.removed && file.added ? { removed: file.removed, added: file.added, ...(file.hunks ? { hunks: file.hunks } : {}) } : file.changedLines;
  if (changes && versionOnly(file.path, changes, { risky: byPath.tier === 'RISKY' })) return { path: file.path, tier: 'LIGHT', rule: 'version-only change' };
  return { path: file.path, ...byPath };
}

function classify(files, configs) {
  const results = files.map(file => classifyFile(file, configs));
  const tier = results.reduce((top, entry) => (TIERS.indexOf(entry.tier) > TIERS.indexOf(top) ? entry.tier : top), 'LIGHT');
  return { tier, files: results };
}

class GitChange {
  constructor(repoRoot, run = spawnSync) {
    this.repoRoot = repoRoot;
    this.run = run;
  }

  git(args) {
    const result = this.run('git', ['-C', this.repoRoot, '--literal-pathspecs', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (result.error || result.status !== 0) fail(`git ${args.join(' ')} failed: ${(result.stderr || result.error?.message || '').trim()}`);
    return result.stdout;
  }

  defaultBase() {
    const remoteHead = this.run('git', ['-C', this.repoRoot, 'symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], { encoding: 'utf8' });
    if (remoteHead.status === 0 && remoteHead.stdout.trim()) return remoteHead.stdout.trim().replace(/^refs\/remotes\//, '');
    return 'origin/main';
  }

  // -z keeps every path raw (no quoting of non-ASCII names); a rename or copy lists both paths.
  files(base) {
    const mergeBase = this.git(['merge-base', base || this.defaultBase(), 'HEAD']).trim();
    this.mergeBase = mergeBase;
    const changed = new Map();
    const fields = this.git(['diff', '--name-status', '-z', '-M', mergeBase]).split('\0').filter(Boolean);
    for (let index = 0; index < fields.length;) {
      const status = fields[index++];
      const paths = fields.slice(index, index += /^[RC]/.test(status) ? 2 : 1);
      for (const rel of paths) changed.set(rel, status.startsWith('M') && paths.length === 1 ? this.changes(mergeBase, rel) : null);
    }
    for (const rel of this.git(['ls-files', '-z', '--others', '--exclude-standard']).split('\0').filter(Boolean)) changed.set(rel, null);
    return [...changed].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([rel, changes]) => (changes ? { path: rel, changedLines: [...changes.removed, ...changes.added], ...changes } : { path: rel, changedLines: null }));
  }

  // Only lines inside hunks count, so a content line that starts with "-- " or "++ " is never
  // mistaken for a diff header. Paths are literal (--literal-pathspecs), so * or [ in a name is not a
  // pattern.
  changes(mergeBase, rel) {
    const diff = this.git(['diff', '-U0', '--no-color', mergeBase, '--', rel]);
    if (/^Binary files /m.test(diff)) return null;
    const hunks = [];
    for (const line of diff.split('\n')) {
      if (line.startsWith('@@')) hunks.push({ removed: [], added: [] });
      else if (hunks.length && line.startsWith('-')) hunks[hunks.length - 1].removed.push(line.slice(1));
      else if (hunks.length && line.startsWith('+')) hunks[hunks.length - 1].added.push(line.slice(1));
    }
    return { removed: hunks.flatMap(hunk => hunk.removed), added: hunks.flatMap(hunk => hunk.added), hunks };
  }

  // The list as it was at the merge base, or null when there was none.
  baseConfig() {
    const result = this.run('git', ['-C', this.repoRoot, '--literal-pathspecs', 'show', `${this.mergeBase}:${CONFIG_REL}`], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    return result.status === 0 ? parseConfig(result.stdout, `${CONFIG_REL} at ${this.mergeBase.slice(0, 7)}`) : null;
  }
}

function parseArgs(argv) {
  const args = { repo: process.cwd(), base: '', json: false, paths: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--repo') args.repo = argv[++index] || fail('--repo needs a folder.');
    else if (arg === '--base') args.base = argv[++index] || fail('--base needs a git ref.');
    else if (arg === '--json') args.json = true;
    else if (arg === '--') { args.paths = argv.slice(index + 1); args.typed = args.paths; break; }
    else fail(`Unknown argument: ${arg}`);
  }
  if (args.paths) args.paths = args.paths.map(normalizePath);
  return args;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  // The list lives at the top of the checkout, so a --repo subfolder still finds it.
  const top = spawnSync('git', ['-C', path.resolve(args.repo), 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  const repoRoot = top.status === 0 && top.stdout.trim() ? path.resolve(top.stdout.trim()) : path.resolve(args.repo);
  const { config, source } = loadConfig(repoRoot);
  const configs = [config];
  // A typed absolute path inside the checkout is read relative to its top.
  const inside = rel => path.isAbsolute(rel) && !path.relative(repoRoot, path.resolve(rel)).startsWith('..');
  let files;
  if (args.paths) files = args.typed.map((rel, index) => ({ path: inside(rel) ? normalizePath(path.relative(repoRoot, path.resolve(rel))) : args.paths[index], changedLines: null }));
  else {
    const change = new GitChange(repoRoot);
    files = change.files(args.base);
    configs.push(change.baseConfig() || DEFAULT_CONFIG);
  }
  const result = { ...classify(files, configs), list: source };
  if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else {
    const lines = [`${result.tier}${files.length ? '' : ' (no changed files)'}`, `List: ${source}`];
    for (const entry of result.files) lines.push(`${entry.tier.padEnd(6)} ${entry.path} (${entry.rule})`);
    process.stdout.write(`${lines.join('\n')}\n`);
  }
  return result;
}

if (require.main === module) {
  try { main(); } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}

module.exports = { DEFAULT_CONFIG, GitChange, classify, classifyFile, globToRegExp, loadConfig, main, normalizePath, parseArgs, parseConfig, versionOnly };
