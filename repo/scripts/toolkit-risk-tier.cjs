#!/usr/bin/env node
'use strict';

// Tags a change RISKY, NORMAL or LIGHT by the paths it touches, never by its size, so the tier is not
// a model's guess. Each changed path takes the first list it matches in the repository's
// .github/toolkit-risk-tiers.json (risky, then normal, then light), or NORMAL when it matches none.
// A file whose changed lines only set a version counts as LIGHT. A mixed change takes its highest tier.
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
// A changed line that only sets a version, such as "version": "1.2.3" or const VERSION = '1.2.3';, or a
// Toolkit managed-block marker whose toolkit= version is the only thing a version bump changes.
const VERSION_LINES = Object.freeze([
  /^\s*(?:(?:export\s+)?(?:const|let|var)\s+)?["'`]?[A-Za-z_]*version[A-Za-z_]*["'`]?\s*[:=]\s*["'`]v?\d+\.\d+\.\d+["'`]\s*[,;]?\s*$/i,
  /^\s*<!-- AI-AGENT-TOOLKIT:[^\s]+:BEGIN [A-Z0-9-]+ v\d+ toolkit=\d+\.\d+\.\d+ sha256=[0-9a-f]{12} -->\s*$/,
]);

function fail(message) { throw Object.assign(new Error(message), { code: 'RISK_TIER_INPUT' }); }

// gitignore-style globs: `**` spans folders, `*` and `?` stay inside one name, and a pattern
// without a slash matches the name in any folder.
function globToRegExp(glob) {
  let source = '';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === '*' && glob[index + 1] === '*') {
      if (glob[index + 2] === '/') { source += '(?:.*/)?'; index += 2; } else { source += '.*'; index += 1; }
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(glob.includes('/') ? `^${source}$` : `(?:^|/)${source}$`);
}

function loadConfig(repoRoot) {
  const file = path.join(repoRoot, CONFIG_REL);
  if (!fs.existsSync(file)) return { config: DEFAULT_CONFIG, source: 'built-in default list' };
  let config;
  try { config = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { fail(`${CONFIG_REL} is not valid JSON: ${error.message}`); }
  if (!config || config.schema !== SCHEMA) fail(`${CONFIG_REL} must have schema ${SCHEMA}.`);
  for (const [key] of LISTS) {
    if (!Array.isArray(config[key]) || config[key].some(entry => typeof entry !== 'string' || !entry.trim())) fail(`${CONFIG_REL} "${key}" must be a list of path patterns.`);
  }
  return { config, source: CONFIG_REL };
}

function versionOnly(changedLines) {
  return changedLines.length > 0 && changedLines.every(line => VERSION_LINES.some(pattern => pattern.test(line)));
}

// One changed file: { path, changedLines } where changedLines is null when the content is unknown
// (an added, deleted or binary file, or a path given on the command line).
function classifyFile(file, config) {
  if (file.changedLines && versionOnly(file.changedLines)) return { path: file.path, tier: 'LIGHT', rule: 'version-only change' };
  for (const [key, tier] of LISTS) {
    const pattern = config[key].find(glob => globToRegExp(glob).test(file.path));
    if (pattern) return { path: file.path, tier, rule: `${key}: ${pattern}` };
  }
  return { path: file.path, tier: 'NORMAL', rule: 'no list matched' };
}

function classify(files, config) {
  const results = files.map(file => classifyFile(file, config));
  const tier = results.reduce((top, entry) => (TIERS.indexOf(entry.tier) > TIERS.indexOf(top) ? entry.tier : top), 'LIGHT');
  return { tier, files: results };
}

class GitChange {
  constructor(repoRoot, run = spawnSync) {
    this.repoRoot = repoRoot;
    this.run = run;
  }

  git(args) {
    const result = this.run('git', ['-C', this.repoRoot, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (result.error || result.status !== 0) fail(`git ${args.join(' ')} failed: ${(result.stderr || result.error?.message || '').trim()}`);
    return result.stdout;
  }

  defaultBase() {
    const remoteHead = this.run('git', ['-C', this.repoRoot, 'symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], { encoding: 'utf8' });
    if (remoteHead.status === 0 && remoteHead.stdout.trim()) return remoteHead.stdout.trim().replace(/^refs\/remotes\//, '');
    return 'origin/main';
  }

  files(base) {
    const mergeBase = this.git(['merge-base', base || this.defaultBase(), 'HEAD']).trim();
    const changed = new Map();
    for (const line of this.git(['diff', '--name-status', '-M', mergeBase]).split('\n').filter(Boolean)) {
      const [status, ...paths] = line.split('\t');
      for (const rel of paths) changed.set(rel, status.startsWith('M') && paths.length === 1 ? this.changedLines(mergeBase, rel) : null);
    }
    for (const rel of this.git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean)) changed.set(rel, null);
    return [...changed].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([rel, changedLines]) => ({ path: rel, changedLines }));
  }

  changedLines(mergeBase, rel) {
    const diff = this.git(['diff', '-U0', '--no-color', mergeBase, '--', rel]);
    if (/^Binary files /m.test(diff)) return null;
    return diff.split('\n').filter(line => /^[+-]/.test(line) && !/^(\+\+\+|---) /.test(line)).map(line => line.slice(1));
  }
}

function parseArgs(argv) {
  const args = { repo: process.cwd(), base: '', json: false, paths: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--repo') args.repo = argv[++index] || fail('--repo needs a folder.');
    else if (arg === '--base') args.base = argv[++index] || fail('--base needs a git ref.');
    else if (arg === '--json') args.json = true;
    else if (arg === '--') { args.paths = argv.slice(index + 1); break; }
    else fail(`Unknown argument: ${arg}`);
  }
  if (args.paths) args.paths = args.paths.map(rel => rel.replace(/\\/g, '/').replace(/^\.\//, ''));
  return args;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const repoRoot = path.resolve(args.repo);
  const { config, source } = loadConfig(repoRoot);
  const files = args.paths ? args.paths.map(rel => ({ path: rel, changedLines: null })) : new GitChange(repoRoot).files(args.base);
  const result = { ...classify(files, config), list: source };
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

module.exports = { DEFAULT_CONFIG, GitChange, classify, classifyFile, globToRegExp, loadConfig, main, parseArgs, versionOnly };
