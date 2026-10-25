#!/usr/bin/env node
'use strict';

// CI check-up: compares what a repository contains with what its CI actually runs, and lists
// facts and candidate gaps for an agent to judge. Read-only and zero-dependency (Node, plus git
// and a read-only `gh` run listing when they are available). It never edits a file, never runs
// repository code and never fails a build by itself: the exit code is 0 for any report and 2
// only when it cannot run (bad arguments or a refused settings file).
//
// Usage: node ci-checkup.cjs [--repo <dir>] [--base <ref>] [--runs <n>] [--no-github] [--json]
//   --repo       repository folder (default: current folder)
//   --base       only report items touching paths changed since this ref (for change planning)
//   --runs       how many recent green default-branch runs to read job times from (default 5)
//   --no-github  skip the GitHub run listing; speed rows say "not checked"
//   --json       machine-readable report
// Settings: <repo>/.github/ci-checkup.json (optional), schema ci-checkup/v1:
//   { "schema": "ci-checkup/v1",
//     "status_doc": "docs/ci-cd/CURRENT_CICD_STATUS.md",
//     "budgets": { "job_seconds": 600, "unsharded_test_job_seconds": 300 },
//     "ignore": [ { "check": "scripts.untested", "path": "tools/once.sh", "reason": "..." } ] }
// Every ignore entry needs a reason; a path ending in "/" covers the whole folder.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SETTINGS_REL = '.github/ci-checkup.json';
const SETTINGS_SCHEMA = 'ci-checkup/v1';
const REPORT_SCHEMA = 'ci-checkup-report/v1';
const DEFAULT_STATUS_DOC = 'docs/ci-cd/CURRENT_CICD_STATUS.md';
const TOOLKIT_SHARDS_REL = 'repo/contracts/ci/test-shards.json';
const TOOLKIT_SHARDS_SCHEMA = 'toolkit-test-shards/v1';
// Starting values, not measurements: a repository sets its own in the settings file.
const DEFAULTS = Object.freeze({ job_seconds: null, unsharded_test_job_seconds: 300, runs: 5 });
const MIN_REASON = 12;

const SKIP_DIRS = new Set(['.git', 'node_modules', '.tmp', 'dist', 'build', 'vendor', '.venv', 'venv', '__pycache__', 'target', 'coverage', '.next', '.cache']);
const SCRIPT_EXT = /\.(cjs|js|mjs|ts|py|sh|ps1)$/;
const CODE_EXT = /\.(cjs|js|mjs|ts|tsx|jsx|py|go|rs|sh|ps1|rb|java|kt|php|cs)$/;
const TEST_NAME = /(\.(test|spec)\.[A-Za-z0-9]+$)|(^test_[^/]*\.py$)|(_test\.(py|go)$)/;
// Vendored, example and fixture code is not the repository's own to test.
const NOT_OWN_CODE = /(^|\/)(third[-_]party|examples?|fixtures?|__fixtures__)\//;
const TEST_DIR_NAMES = new Set(['test', 'tests', '__tests__', 'spec']);
const CONFIG_NAME = /(^|\/)([^/]*\.config\.[cm]?[jt]s|\.eslintrc\.[cm]?js|\.prettierrc\.[cm]?js|\.?babel\.config\.[cm]?js|[^/]*\.d\.ts)$/;
const RUNNERS = Object.freeze({
  js: /\b(jest|vitest|mocha|ava|tap|node\s+(?:[^\n]*\s)?--test|playwright\s+test|cypress\s+run)\b/,
  py: /\b(pytest|py\.test|unittest|tox|nox)\b/,
  go: /\bgo\s+test\b/,
  rs: /\bcargo\s+(test|nextest)\b/,
});
const MANIFEST_TOOLS = Object.freeze({
  'go.mod': { label: 'Go module', tool: /\bgo\s+(test|build|vet)\b/ },
  'Cargo.toml': { label: 'Rust crate', tool: /\bcargo\s+(test|build|check|clippy|nextest)\b/ },
  'pom.xml': { label: 'Maven project', tool: /\bmvnw?\b/ },
  'build.gradle': { label: 'Gradle project', tool: /\bgradlew?\b/ },
  'build.gradle.kts': { label: 'Gradle project', tool: /\bgradlew?\b/ },
  'pyproject.toml': { label: 'Python project', tool: /\b(python3?|pip3?|pytest|uv|poetry|tox|nox|ruff|mypy|hatch|pdm)\b/ },
  'setup.py': { label: 'Python project', tool: /\b(python3?|pip3?|pytest|uv|poetry|tox|nox|ruff|mypy|hatch|pdm)\b/ },
});
const PACKAGE_SCRIPTS = Object.freeze(['test', 'lint', 'build', 'typecheck']);
const PM_BUILTINS = new Set(['install', 'i', 'ci', 'add', 'remove', 'rm', 'uninstall', 'exec', 'dlx', 'x', 'npx', 'audit', 'publish', 'pack', 'link', 'init', 'create', 'outdated', 'update', 'up', 'upgrade', 'config', 'set', 'cache', 'why', 'list', 'ls', 'version', 'help', 'login', 'whoami', 'prune', 'dedupe', 'rebuild', 'fetch', 'store', 'import', 'workspace', 'workspaces', 'env', 'setup', 'self-update']);
const CHECKS = Object.freeze({
  'parts.package-script': 'a package test, lint, build or typecheck script no CI step runs',
  'parts.manifest': 'a package manifest no CI step builds or tests',
  'parts.docker': 'a Dockerfile or compose build no CI step builds',
  'tests.unreached': 'a test file or test folder no CI step reaches',
  'scripts.untested': 'a script no test names or imports',
  'speed.budget': 'no declared time budget, or a budget not checked in CI',
  'speed.durations': 'test files with no measured time',
  'speed.jobs': 'a CI job over its budget, or a long test job with no sharding',
  'hygiene.unpinned': 'an action not pinned to a full commit SHA',
  'hygiene.permissions': 'a workflow with no permissions block',
  'hygiene.masked': 'a test step whose failure is masked',
  'hygiene.paths': 'a pull request trigger with path filters',
  'hygiene.dependabot': 'no Dependabot entry to keep action pins current',
  'status.doc': 'a CI status document that is missing or does not match the workflows',
});

class UsageError extends Error {}

function toPosix(rel) { return rel.split(path.sep).join('/'); }
function norm(rel) {
  const out = path.posix.normalize(rel.replace(/\\/g, '/')).replace(/^\.\//, '').replace(/\/$/, '');
  return out === '.' ? '' : out;
}
function under(file, dir) { return dir === '' || file === dir || file.startsWith(`${dir}/`); }
function readText(root, rel) {
  try { return fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n'); } catch { return null; }
}
function run(cmd, args, cwd) {
  try {
    const result = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 60000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    return result.error ? { ok: false, out: '' } : { ok: result.status === 0, out: result.stdout || '' };
  } catch { return { ok: false, out: '' }; }
}

// ---------------------------------------------------------------------------------------------
// Repository files.

function listFiles(root) {
  const git = run('git', ['ls-files', '-co', '--exclude-standard', '-z'], root);
  if (git.ok && git.out) {
    return git.out.split('\0').filter(Boolean).map(norm)
      .filter((rel) => !rel.split('/').some((part) => SKIP_DIRS.has(part)))
      .filter((rel) => { try { return fs.statSync(path.join(root, rel)).isFile(); } catch { return false; } })
      .sort();
  }
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) walk(rel); }
      else if (entry.isFile()) out.push(rel);
    }
  };
  walk('');
  return out.sort();
}

function loadSettings(root) {
  const text = readText(root, SETTINGS_REL);
  if (text === null) return { present: false, status_doc: null, budgets: {}, ignore: [] };
  let data;
  try { data = JSON.parse(text); } catch (error) { throw new UsageError(`${SETTINGS_REL} is not valid JSON: ${error.message}`); }
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new UsageError(`${SETTINGS_REL} must be a JSON object`);
  if (data.schema !== SETTINGS_SCHEMA) errors.push(`schema must be ${SETTINGS_SCHEMA}`);
  for (const key of Object.keys(data)) if (!['schema', 'status_doc', 'budgets', 'ignore'].includes(key)) errors.push(`unknown key ${key}`);
  if (data.status_doc !== undefined && (typeof data.status_doc !== 'string' || !data.status_doc.trim())) errors.push('status_doc must be a repository path');
  const budgets = data.budgets === undefined ? {} : data.budgets;
  if (!budgets || typeof budgets !== 'object' || Array.isArray(budgets)) errors.push('budgets must be an object');
  else for (const [key, value] of Object.entries(budgets)) {
    if (!['job_seconds', 'unsharded_test_job_seconds'].includes(key)) errors.push(`budgets.${key} is not a known budget`);
    else if (!Number.isFinite(value) || value <= 0) errors.push(`budgets.${key} must be a positive number of seconds`);
  }
  const ignore = data.ignore === undefined ? [] : data.ignore;
  if (!Array.isArray(ignore)) errors.push('ignore must be a list');
  else ignore.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') { errors.push(`ignore[${index}] must be an object`); return; }
    if (!CHECKS[entry.check]) errors.push(`ignore[${index}].check must be one of ${Object.keys(CHECKS).join(', ')}`);
    if (typeof entry.path !== 'string' || !entry.path.trim()) errors.push(`ignore[${index}].path must be a repository path`);
    if (typeof entry.reason !== 'string' || entry.reason.trim().length < MIN_REASON) errors.push(`ignore[${index}] needs a reason of at least ${MIN_REASON} characters`);
  });
  if (errors.length) throw new UsageError(`${SETTINGS_REL} refused: ${errors.join('; ')}`);
  return { present: true, status_doc: data.status_doc ? norm(data.status_doc) : null, budgets: budgets || {}, ignore };
}

// ---------------------------------------------------------------------------------------------
// Workflows: a line reader for the parts of GitHub Actions YAML this check needs.

function indentOf(line) { return line.length - line.trimStart().length; }
function unquote(value) { return value.trim().replace(/^(['"])(.*)\1$/, '$2'); }

function blockValue(lines, index, keyIndent, inline) {
  const value = inline.replace(/\s+#.*$/, '').trim();
  if (!/^[|>][-+0-9]*$/.test(value)) return { text: unquote(inline), end: index };
  const body = [];
  let end = index;
  for (let i = index + 1; i < lines.length; i++) {
    if (lines[i].trim() && indentOf(lines[i]) <= keyIndent) break;
    body.push(lines[i]);
    end = i;
  }
  const strip = Math.min(...body.filter((line) => line.trim()).map(indentOf), Infinity);
  return { text: body.map((line) => line.slice(Number.isFinite(strip) ? strip : 0)).join('\n'), end };
}

// Keys of a mapping block that starts at `start` with keys at `indent`.
function mapKeys(lines, start, end, indent) {
  const keys = [];
  for (let i = start; i < end; i++) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith('#') || indentOf(line) !== indent) continue;
    const match = line.trim().match(/^(?:-\s+)?("?[\w-]+"?)\s*:\s*(.*)$/);
    if (match) keys.push({ key: match[1].replace(/"/g, ''), value: match[2], line: i });
  }
  return keys;
}

function blockEnd(lines, start, indent) {
  for (let i = start + 1; i < lines.length; i++) if (lines[i].trim() && !lines[i].trimStart().startsWith('#') && indentOf(lines[i]) <= indent) return i;
  return lines.length;
}

function parseSteps(lines, start, end) {
  const steps = [];
  let itemIndent = null;
  const starts = [];
  for (let i = start; i < end; i++) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (itemIndent === null && /^\s*-\s/.test(line)) itemIndent = indentOf(line);
    if (itemIndent !== null && indentOf(line) === itemIndent && /^\s*-\s/.test(line)) starts.push(i);
  }
  starts.forEach((first, n) => {
    const last = n + 1 < starts.length ? starts[n + 1] : end;
    const block = lines.slice(first, last);
    block[0] = block[0].replace(/^(\s*)-\s/, '$1  ');
    const keyIndent = itemIndent + 2;
    const step = { line: first + 1 };
    for (let i = 0; i < block.length; i++) {
      if (indentOf(block[i]) !== keyIndent) continue;
      const match = block[i].trim().match(/^([\w-]+)\s*:\s*(.*)$/);
      if (!match) continue;
      const { text, end: stop } = blockValue(block, i, keyIndent, match[2]);
      step[match[1]] = text;
      if (match[1] === 'with' || match[1] === 'env') step[match[1]] = block.slice(i + 1, stop + 1 > i + 1 ? stop + 1 : blockEnd(block, i, keyIndent)).join('\n');
      i = Math.max(i, stop);
    }
    steps.push(step);
  });
  return steps;
}

function defaultsDir(lines, start, end, indent) {
  const defaults = mapKeys(lines, start, end, indent).find((entry) => entry.key === 'defaults');
  if (!defaults) return '';
  const match = lines.slice(defaults.line, blockEnd(lines, defaults.line, indent)).join('\n').match(/working-directory:\s*(.+)/);
  return match ? norm(unquote(match[1])) : '';
}

function parseWorkflow(rel, text) {
  const lines = text.split('\n');
  const top = mapKeys(lines, 0, lines.length, 0);
  const onKey = top.find((entry) => ['on', 'true'].includes(entry.key));
  const onText = onKey ? lines.slice(onKey.line, blockEnd(lines, onKey.line, 0)).join('\n') : '';
  const prBlock = onText.match(/\n\s+pull_request(?:_target)?:[\s\S]*?(?=\n\s{2}\w|$)/);
  const workflow = {
    rel,
    text,
    permissions: top.some((entry) => entry.key === 'permissions'),
    prPathFilters: Boolean(prBlock && /\n\s+paths(-ignore)?:/.test(prBlock[0])),
    dir: defaultsDir(lines, 0, lines.length, 0),
    jobs: [],
  };
  const jobsKey = top.find((entry) => entry.key === 'jobs');
  if (!jobsKey) return workflow;
  const jobsEnd = blockEnd(lines, jobsKey.line, 0);
  const jobIndent = (lines.slice(jobsKey.line + 1, jobsEnd).find((line) => line.trim() && !line.trimStart().startsWith('#')) || '  ').length - (lines.slice(jobsKey.line + 1, jobsEnd).find((line) => line.trim() && !line.trimStart().startsWith('#')) || '  ').trimStart().length;
  for (const job of mapKeys(lines, jobsKey.line + 1, jobsEnd, jobIndent)) {
    const end = blockEnd(lines, job.line, jobIndent);
    const keys = mapKeys(lines, job.line + 1, end, jobIndent + 2);
    const stepsKey = keys.find((entry) => entry.key === 'steps');
    const body = lines.slice(job.line, end).join('\n');
    workflow.jobs.push({
      id: job.key,
      line: job.line + 1,
      permissions: keys.some((entry) => entry.key === 'permissions'),
      continueOnError: keys.some((entry) => entry.key === 'continue-on-error' && !/^false$/i.test(unquote(entry.value))),
      matrix: /\bmatrix:/.test(body),
      uses: (keys.find((entry) => entry.key === 'uses') || {}).value,
      dir: defaultsDir(lines, job.line + 1, end, jobIndent + 2) || workflow.dir,
      steps: stepsKey ? parseSteps(lines, stepsKey.line + 1, blockEnd(lines, stepsKey.line, jobIndent + 2)) : [],
    });
  }
  return workflow;
}

// ---------------------------------------------------------------------------------------------
// What CI reaches: commands, the package scripts they call, the files they name, and the
// require/import closure of those files.

function tokens(text) {
  return (text.match(/[A-Za-z0-9_@.\/\\-]+/g) || []).map((token) => token.replace(/^['"]|['"]$/g, ''));
}

function packageInvocations(command) {
  const calls = [];
  const words = command.split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const pm = words[i].replace(/^.*\//, '');
    if (!['npm', 'pnpm', 'yarn', 'bun'].includes(pm)) continue;
    let dir = null;
    let all = false;
    let name = null;
    for (let j = i + 1; j < words.length; j++) {
      const word = words[j];
      if (/^(&&|\|\||;|\|)$/.test(word)) break;
      if (['--prefix', '-C', '--cwd', '--dir'].includes(word)) { dir = words[++j]; continue; }
      if (['--workspaces', '-ws', '-r', '--recursive'].includes(word)) { all = true; continue; }
      if (['--filter', '-w', '--workspace', '-F'].includes(word)) { all = true; j++; continue; }
      if (word.startsWith('-')) continue;
      if (word === 'run' || word === 'run-script') continue;
      if (pm === 'npm' && ['t', 'tst'].includes(word)) name = 'test';
      else if (PM_BUILTINS.has(word)) name = null;
      else name = word;
      break;
    }
    if (name) calls.push({ name, dir: dir ? norm(dir) : null, all });
  }
  return calls;
}

function commandLines(text, baseDir) {
  // Split on newlines and `&&`, following `cd <dir>` so later commands use that folder.
  const out = [];
  let dir = baseDir;
  for (const raw of text.split('\n')) {
    for (const part of raw.split(/&&|;/)) {
      const cmd = part.trim();
      if (!cmd || cmd.startsWith('#')) continue;
      const cd = cmd.match(/^cd\s+(\S+)$/);
      if (cd) { dir = norm(path.posix.join(dir, unquote(cd[1]))); continue; }
      out.push({ cmd, dir });
    }
  }
  return out;
}

function resolveImport(files, fromRel, spec) {
  const base = norm(path.posix.join(path.posix.dirname(fromRel), spec));
  for (const suffix of ['', '.js', '.cjs', '.mjs', '.ts', '.tsx', '.json', '/index.js', '/index.cjs', '/index.ts']) if (files.has(base + suffix)) return base + suffix;
  return null;
}

function importsOf(files, rel, text) {
  const out = [];
  if (/\.(cjs|js|mjs|ts|tsx|jsx)$/.test(rel)) {
    const re = /(?:require\(\s*|import\s*\(\s*|from\s+|import\s+)['"](\.{1,2}\/[^'"]+)['"]/g;
    let match;
    while ((match = re.exec(text))) { const hit = resolveImport(files, rel, match[1]); if (hit) out.push(hit); }
  }
  if (rel.endsWith('.py')) {
    // Plain imports and importlib.import_module("name"); a test that puts a sibling folder such
    // as ../scripts or ../src on sys.path is covered by looking there too.
    const re = /^\s*(?:from\s+(\.*[\w.]*)\s+import\s+\(?([\w ,]+)|import\s+([\w.]+))|import_module\(\s*['"]([\w.]+)['"]/gm;
    const here = path.posix.dirname(rel);
    const parent = norm(path.posix.dirname(here));
    let match;
    while ((match = re.exec(text))) {
      const mod = (match[1] !== undefined ? match[1] : match[3] || match[4]).replace(/^\.+/, '').replace(/\./g, '/');
      // `from pkg import a, b` may name modules pkg/a.py and pkg/b.py as well as names in pkg.
      const names = match[1] !== undefined ? match[2].split(',').map((n) => n.trim().split(/\s+/)[0]).filter(Boolean) : [];
      const mods = [mod, ...names.map((n) => (mod ? `${mod}/${n}` : n))].filter(Boolean);
      for (const dir of [here, parent, `${parent}/src`, `${parent}/scripts`, `${parent}/lib`, '', 'src']) {
        for (const m of mods) for (const cand of [`${m}.py`, `${m}/__init__.py`]) { const full = norm(path.posix.join(dir, cand)); if (files.has(full)) out.push(full); }
      }
    }
  }
  return out;
}

function fileTokens(files, text, dirs) {
  const out = new Set();
  for (const token of tokens(text)) {
    const clean = token.replace(/\\/g, '/');
    for (const dir of dirs) {
      const rel = norm(path.posix.join(dir, clean));
      if (rel && files.has(rel)) out.add(rel);
    }
  }
  return out;
}

function packageScripts(root, files) {
  const out = new Map();
  for (const rel of files) {
    if (path.posix.basename(rel) !== 'package.json') continue;
    try { out.set(norm(path.posix.dirname(rel)), JSON.parse(readText(root, rel)).scripts || {}); } catch { out.set(norm(path.posix.dirname(rel)), {}); }
  }
  return out;
}

function reachAnalysis(root, fileList, workflows) {
  const files = new Set(fileList);
  const packages = packageScripts(root, fileList);
  const texts = []; // { text, dir } reached texts, used for folder and runner matches
  const invoked = new Set(); // `${pkgDir}\0${script}`
  const reached = new Set();
  const queue = [];
  const addFile = (rel) => { if (!reached.has(rel)) { reached.add(rel); queue.push(rel); } };
  const pkgFor = (dir) => { for (let d = dir; ; d = norm(path.posix.dirname(d))) { if (packages.has(d)) return d; if (!d) return null; } };

  const visitCommand = (cmd, dir, depth) => {
    texts.push({ text: cmd, dir });
    for (const rel of fileTokens(files, cmd, [dir, ''])) addFile(rel);
    if (depth > 6) return;
    for (const call of packageInvocations(cmd)) {
      const targets = call.all ? [...packages.keys()] : [call.dir !== null ? norm(path.posix.join(dir, call.dir)) : pkgFor(dir)].filter((d) => d !== null && packages.has(d));
      for (const pkgDir of targets) {
        for (const name of [`pre${call.name}`, call.name, `post${call.name}`]) {
          const script = packages.get(pkgDir)[name];
          if (typeof script !== 'string' || invoked.has(`${pkgDir}\0${name}`)) continue;
          invoked.add(`${pkgDir}\0${name}`);
          for (const line of commandLines(script, pkgDir)) visitCommand(line.cmd, line.dir, depth + 1);
        }
      }
    }
  };

  for (const workflow of workflows) {
    for (const job of workflow.jobs) {
      if (job.uses) for (const rel of fileTokens(files, job.uses.split('@')[0], [''])) addFile(rel);
      for (const step of job.steps) {
        const dir = step['working-directory'] ? norm(unquote(step['working-directory'])) : job.dir;
        if (step.run) for (const line of commandLines(step.run, dir)) visitCommand(line.cmd, line.dir, 0);
        if (step.with) { texts.push({ text: step.with, dir: '' }); for (const rel of fileTokens(files, step.with, [''])) addFile(rel); }
        if (step.uses && step.uses.startsWith('./')) for (const rel of fileTokens(files, step.uses, [''])) addFile(rel);
      }
    }
  }
  while (queue.length) {
    const rel = queue.shift();
    if (!CODE_EXT.test(rel) && !/\.(json|ya?ml|toml)$/.test(rel)) continue;
    const text = readText(root, rel) || '';
    const dir = norm(path.posix.dirname(rel));
    texts.push({ text, dir: '' });
    if (!CODE_EXT.test(rel)) continue;
    for (const hit of importsOf(files, rel, text)) addFile(hit);
    for (const hit of fileTokens(files, text, ['', dir])) if (CODE_EXT.test(hit)) addFile(hit);
  }
  return { files, packages, texts, invoked, reached };
}

// ---------------------------------------------------------------------------------------------
// Checks.

function item(level, check, rel, message, fix) { return { level, check, path: rel || '', message, fix: fix || '' }; }

function isTestFile(rel) { return TEST_NAME.test(path.posix.basename(rel)) && CODE_EXT.test(rel); }
function testDirOf(rel) {
  const parts = rel.split('/');
  for (let i = parts.length - 2; i >= 0; i--) if (TEST_DIR_NAMES.has(parts[i])) return parts.slice(0, i + 1).join('/');
  return null;
}
function langOf(rel) {
  if (/\.(cjs|js|mjs|ts|tsx|jsx)$/.test(rel)) return 'js';
  if (rel.endsWith('.py')) return 'py';
  if (rel.endsWith('.go')) return 'go';
  if (rel.endsWith('.rs')) return 'rs';
  return null;
}

// A path is reached when a reached text names it or one of its folders (relative to the repo or
// to the folder the text runs in), or when a test runner for its language runs from a folder
// above it.
function makeReachTest(analysis) {
  const named = new Set();
  const runnersAt = { js: [], py: [], go: [], rs: [] };
  for (const { text, dir } of analysis.texts) {
    for (const token of tokens(text)) {
      const clean = token.replace(/\\/g, '/').replace(/\/\*\*?.*$/, '');
      named.add(norm(clean));
      named.add(norm(path.posix.join(dir, clean)));
    }
    for (const [lang, re] of Object.entries(RUNNERS)) if (re.test(text)) runnersAt[lang].push(dir);
  }
  named.delete('');
  return (rel) => {
    if (analysis.reached.has(rel) || named.has(rel)) return true;
    for (let dir = norm(path.posix.dirname(rel)); dir; dir = norm(path.posix.dirname(dir))) if (named.has(dir)) return true;
    const lang = langOf(rel);
    return Boolean(lang && runnersAt[lang].some((dir) => under(rel, dir)));
  };
}

function checkParts(root, fileList, workflows, analysis, reachable) {
  const items = [];
  const ciText = workflows.map((w) => w.text).join('\n');
  for (const [pkgDir, scripts] of analysis.packages) {
    const manifest = pkgDir ? `${pkgDir}/package.json` : 'package.json';
    for (const name of PACKAGE_SCRIPTS) {
      const script = scripts[name];
      if (typeof script !== 'string' || /no test specified/.test(script)) continue;
      if (analysis.invoked.has(`${pkgDir}\0${name}`)) continue;
      const targets = [...fileTokens(analysis.files, script, [pkgDir, ''])];
      if (targets.length && targets.every((rel) => analysis.reached.has(rel))) continue;
      if (ciText.includes(script.trim())) continue;
      items.push(item('GAP', 'parts.package-script', manifest, `the "${name}" script (${script.trim()}) is not run by any CI step`, `add a step that runs it (npm run ${name}${pkgDir ? ` with working-directory: ${pkgDir}` : ''}), or remove the script if it is dead`));
    }
  }
  for (const rel of fileList) {
    const spec = MANIFEST_TOOLS[path.posix.basename(rel)];
    if (!spec) continue;
    const dir = norm(path.posix.dirname(rel));
    const hit = analysis.texts.some(({ text, dir: at }) => spec.tool.test(text) && (under(dir, at) || tokens(text).some((t) => norm(t) === dir && dir)));
    if (!hit) items.push(item('GAP', 'parts.manifest', rel, `no CI step builds or tests this ${spec.label}`, 'add a CI job that installs, lints and tests it, following the secure-ci-cd plan'));
  }
  const dockerfiles = fileList.filter((rel) => /(^|\/)(Dockerfile(\.[\w-]+)?|[\w.-]+\.Dockerfile)$/.test(rel));
  const dockerBuild = /\bdocker\s+(buildx\s+)?build\b|\bdocker[\s-]compose\s+(build|up)\b|docker\/build-push-action/.test(ciText);
  for (const rel of dockerfiles) {
    if (!dockerBuild) items.push(item('GAP', 'parts.docker', rel, 'no CI step builds this Dockerfile', 'add a build step (docker build or docker/build-push-action) so a broken image fails the PR'));
    else if (dockerfiles.length > 1 && !reachable(rel) && !ciText.includes(path.posix.dirname(rel))) items.push(item('CHECK', 'parts.docker', rel, 'CI builds images, but no step names this Dockerfile or its folder', 'confirm a build step covers it, or add one'));
  }
  for (const rel of fileList.filter((f) => /(^|\/)(docker-)?compose(\.[\w-]+)?\.ya?ml$/.test(f))) {
    if (/^\s+build:/m.test(readText(root, rel) || '') && !/\bdocker[\s-]compose\b/.test(ciText)) items.push(item('CHECK', 'parts.docker', rel, 'this compose file builds images and no CI step runs docker compose', 'add a docker compose build or config step if the images ship from this repository'));
  }
  return items;
}

function checkTests(fileList, reachable) {
  const items = [];
  const testFiles = fileList.filter(isTestFile);
  const reportedDirs = new Set();
  for (const rel of testFiles) {
    if (reachable(rel)) continue;
    items.push(item('GAP', 'tests.unreached', rel, 'no CI step runs this test file', 'add its folder or runner to a CI test step, or delete it if it is dead'));
  }
  for (const rel of fileList.filter((f) => CODE_EXT.test(f) && !isTestFile(f))) {
    const dir = testDirOf(rel);
    if (!dir || reportedDirs.has(dir)) continue;
    const inDir = fileList.filter((f) => under(f, dir) && CODE_EXT.test(f));
    if (inDir.some(reachable) || inDir.some(isTestFile)) continue;
    reportedDirs.add(dir);
    items.push(item('CHECK', 'tests.unreached', `${dir}/`, `no CI step reaches the test folder ${dir}/`, 'if it holds tests, run them in CI; if it holds helpers or manual checks, add an ignore with the reason'));
  }
  return items;
}

// Files a script loads: require/import, plus sibling or repository paths it names as strings
// (a reporter or helper passed to a child process, for example).
function loadsOf(files, rel, text) {
  return [...importsOf(files, rel, text), ...[...fileTokens(files, text, [norm(path.posix.dirname(rel)), ''])].filter((hit) => SCRIPT_EXT.test(hit))];
}

function checkScripts(root, fileList, analysis) {
  const files = analysis.files;
  const scripts = fileList.filter((rel) => SCRIPT_EXT.test(rel) && !isTestFile(rel) && !testDirOf(rel) && !CONFIG_NAME.test(rel) && !NOT_OWN_CODE.test(rel));
  const tests = fileList.filter((rel) => isTestFile(rel) || (testDirOf(rel) && CODE_EXT.test(rel)));
  const testText = tests.map((rel) => readText(root, rel) || '').join('\n');
  const covered = new Set();
  for (const rel of scripts) {
    const base = path.posix.basename(rel);
    if (testText.includes(rel) || testText.includes(base)) covered.add(rel);
  }
  // Package scripts that tests call by name cover the files they run.
  for (const [pkgDir, pkgScripts] of analysis.packages) {
    for (const [name, script] of Object.entries(pkgScripts)) {
      if (typeof script !== 'string') continue;
      const named = new RegExp(`(?:run(?:-script)?\\s+|['"\`])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:['"\`\\s]|$)`).test(testText);
      if (named) for (const rel of fileTokens(files, script, [pkgDir, ''])) covered.add(rel);
    }
  }
  // Tests import scripts, and covered scripts cover what they import.
  const queue = [...covered];
  for (const rel of tests) for (const hit of importsOf(files, rel, readText(root, rel) || '')) if (!covered.has(hit)) { covered.add(hit); queue.push(hit); }
  queue.push(...covered);
  while (queue.length) {
    const rel = queue.shift();
    for (const hit of loadsOf(files, rel, readText(root, rel) || '')) if (!covered.has(hit)) { covered.add(hit); queue.push(hit); }
  }
  return scripts.filter((rel) => !covered.has(rel)).map((rel) => item('CHECK', 'scripts.untested', rel, 'no test names or imports this script', 'add a test if it holds logic worth keeping working; if it is a thin wrapper or one-off, add an ignore with the reason'));
}

function ghJson(root, args, gh = 'gh') {
  const result = run(gh, args, root);
  if (!result.ok) return null;
  try { return JSON.parse(result.out); } catch { return null; }
}

function jobTimes(root, runs, gh) {
  if (!run(gh, ['auth', 'status'], root).ok) return null;
  const repo = ghJson(root, ['repo', 'view', '--json', 'defaultBranchRef'], gh);
  if (!repo || !repo.defaultBranchRef) return null;
  const list = ghJson(root, ['run', 'list', '--branch', repo.defaultBranchRef.name, '--status', 'success', '--limit', String(runs), '--json', 'databaseId,workflowName'], gh);
  if (!list) return null;
  const jobs = new Map();
  for (const entry of list) {
    const view = ghJson(root, ['run', 'view', String(entry.databaseId), '--json', 'jobs'], gh);
    for (const job of (view && view.jobs) || []) {
      if (!job.startedAt || !job.completedAt) continue;
      const seconds = (Date.parse(job.completedAt) - Date.parse(job.startedAt)) / 1000;
      const key = `${entry.workflowName} / ${job.name}`;
      jobs.set(key, Math.max(jobs.get(key) || 0, seconds));
    }
  }
  return jobs;
}

function checkSpeed(root, fileList, workflows, analysis, settings, options) {
  const items = [];
  const ciText = analysis.texts.map((t) => t.text).join('\n');
  const budgets = { ...DEFAULTS, ...settings.budgets };
  const manifestText = fileList.includes(TOOLKIT_SHARDS_REL) ? readText(root, TOOLKIT_SHARDS_REL) : null;
  let manifest = null;
  try { manifest = manifestText && JSON.parse(manifestText); } catch { manifest = null; }
  if (manifest && manifest.schema === TOOLKIT_SHARDS_SCHEMA) {
    if (manifest.budgets === undefined) items.push(item('GAP', 'speed.budget', TOOLKIT_SHARDS_REL, 'the shard manifest declares no per-file time budget, so the duration check only reports', 'measure, then add budgets.seconds_per_file per system to the manifest'));
    if (!/check-test-durations/.test(workflows.map((w) => w.text).join('\n'))) items.push(item('GAP', 'speed.budget', TOOLKIT_SHARDS_REL, 'no CI step runs the per-file duration check, so a slow file never fails anything', 'add the duration check to the CI gate job that reads the shard summaries'));
    const tests = fileList.filter((rel) => /^repo\/tests\/[^/]+\.test\.cjs$/.test(rel));
    for (const [system, durations] of Object.entries(manifest.durations_seconds || {})) {
      const missing = tests.filter((rel) => !(durations && Object.prototype.hasOwnProperty.call(durations, rel)));
      if (missing.length) items.push(item('CHECK', 'speed.durations', TOOLKIT_SHARDS_REL, `${missing.length} of ${tests.length} test files have no measured ${system} time, so shard balance is a guess for them`, 'refresh durations from a full run (run-tests.cjs --report-durations) and rebalance shards'));
    }
  } else if (!budgets.job_seconds) {
    items.push(item('CHECK', 'speed.budget', SETTINGS_REL, 'no CI job-time budget is declared', `measure the job times, then set budgets.job_seconds in ${SETTINGS_REL}`));
  }
  const testJobs = [];
  for (const workflow of workflows) for (const job of workflow.jobs) {
    const text = job.steps.map((s) => s.run || '').join('\n');
    if (Object.values(RUNNERS).some((re) => re.test(text)) || /\b(npm|pnpm|yarn|bun)\s+(run\s+)?t(est)?\b/.test(text) || /run-tests/.test(text)) testJobs.push({ workflow, job });
  }
  const times = options.github ? jobTimes(root, options.runs, options.gh) : null;
  if (!times) {
    items.push(item('CHECK', 'speed.jobs', '', 'job times not checked (no GitHub access)', 'run again with a working gh login to compare job times with budgets'));
    return items;
  }
  for (const [name, seconds] of times) {
    if (budgets.job_seconds && seconds > budgets.job_seconds) items.push(item('GAP', 'speed.jobs', '', `${name} took ${Math.round(seconds)} s, over the ${budgets.job_seconds} s budget`, 'make the slow files fast or shard the job (fast-tests-and-sharding playbook)'));
  }
  for (const { workflow, job } of testJobs) {
    if (job.matrix) continue;
    for (const [name, seconds] of times) {
      if (name.endsWith(`/ ${job.id}`) && seconds > budgets.unsharded_test_job_seconds) items.push(item('CHECK', 'speed.jobs', workflow.rel, `test job ${job.id} took ${Math.round(seconds)} s with no sharding`, 'shard it from one manifest once measured (fast-tests-and-sharding playbook)'));
    }
  }
  return items;
}

function checkHygiene(fileList, workflows, root) {
  const items = [];
  for (const workflow of workflows) {
    const lines = workflow.text.split('\n');
    lines.forEach((line, index) => {
      const match = line.match(/^\s*(?:-\s+)?uses:\s*['"]?([^\s'"#]+)/);
      if (!match) return;
      const ref = match[1];
      if (ref.startsWith('./') || ref.startsWith('docker://')) return;
      const at = ref.split('@')[1] || '';
      if (!/^[0-9a-f]{40}$/.test(at)) items.push(item('GAP', 'hygiene.unpinned', `${workflow.rel}:${index + 1}`, `${ref} is not pinned to a full commit SHA`, 'pin it to the full SHA of the release, with the version in a comment'));
    });
    if (!workflow.permissions && workflow.jobs.some((job) => !job.permissions)) items.push(item('GAP', 'hygiene.permissions', workflow.rel, 'no top-level permissions block, so jobs get the repository default token scope', 'add permissions: contents: read at the top and widen per job only where needed'));
    for (const job of workflow.jobs) {
      const testy = (text) => Object.values(RUNNERS).some((re) => re.test(text)) || /\b(npm|pnpm|yarn|bun)\s+(run\s+)?t(est)?\b|run-tests|\btest\b/i.test(text);
      if (job.continueOnError) items.push(item(testy(job.steps.map((s) => `${s.name || ''} ${s.run || ''}`).join('\n')) ? 'GAP' : 'CHECK', 'hygiene.masked', `${workflow.rel}:${job.line}`, `job ${job.id} has continue-on-error, so its failure never fails the run`, 'remove continue-on-error, or move the job out of the required set with a recorded reason'));
      for (const step of job.steps) {
        const label = `${step.name || ''} ${step.run || ''}`;
        const masked = (step['continue-on-error'] && !/^false$/i.test(unquote(step['continue-on-error'])))
          || /\|\|\s*(true|:|exit\s+0|echo\b)|\bset\s+\+e\b|;\s*exit\s+0\b/.test(step.run || '')
          || (step.shell && !/-e\b|pwsh|powershell|python|cmd/.test(step.shell));
        if (masked) items.push(item(testy(label) ? 'GAP' : 'CHECK', 'hygiene.masked', `${workflow.rel}:${step.line}`, `step "${(step.name || step.run || '').split('\n')[0].trim()}" can hide a failing command (continue-on-error, || true, set +e or a shell without -e)`, 'let the command fail the step; handle an expected failure explicitly instead'));
      }
    }
    if (workflow.prPathFilters) items.push(item('CHECK', 'hygiene.paths', workflow.rel, 'the pull request trigger has path filters; if any job here is a required check, PRs that skip it wait on "Pending" forever', 'drop the path filter from required workflows, or keep it only on workflows that are not required'));
  }
  if (workflows.some((w) => /^\s*(?:-\s+)?uses:\s*['"]?[\w.-]+\//m.test(w.text))) {
    const dependabot = fileList.find((rel) => /^\.github\/dependabot\.ya?ml$/.test(rel));
    if (!dependabot || !/package-ecosystem:\s*['"]?github-actions/.test(readText(root, dependabot) || '')) items.push(item('CHECK', 'hygiene.dependabot', dependabot || '.github/dependabot.yml', 'no Dependabot github-actions entry keeps action pins current', 'add a github-actions update entry so pinned actions get update PRs'));
  }
  return items;
}

function checkStatusDoc(root, fileList, workflows, settings) {
  if (!workflows.length) return [];
  const rel = settings.status_doc || DEFAULT_STATUS_DOC;
  const text = readText(root, rel);
  if (text === null) return [item('GAP', 'status.doc', rel, 'no CI status document', `create it from the secure-ci-cd status template, or name the existing one as status_doc in ${SETTINGS_REL}`)];
  const items = [];
  for (const workflow of workflows) {
    const base = path.posix.basename(workflow.rel);
    if (!text.includes(base)) items.push(item('GAP', 'status.doc', rel, `does not list ${workflow.rel}`, 'add the workflow and what it checks to the status document'));
  }
  const listed = new Set((text.match(/[\w.-]+\.ya?ml/g) || []).filter((name) => /workflows\//.test(text.slice(Math.max(0, text.indexOf(name) - 40), text.indexOf(name)))));
  for (const name of listed) if (!fileList.includes(`.github/workflows/${name}`)) items.push(item('GAP', 'status.doc', rel, `lists .github/workflows/${name}, which does not exist`, 'remove it or correct the name'));
  return items;
}

// ---------------------------------------------------------------------------------------------

function changedPaths(root, base) {
  const committed = run('git', ['diff', '--name-only', `${base}...HEAD`], root);
  if (!committed.ok) throw new UsageError(`cannot diff against ${base} (is it a ref in this repository?)`);
  const local = run('git', ['diff', '--name-only', 'HEAD'], root);
  const untracked = run('git', ['ls-files', '--others', '--exclude-standard'], root);
  return [...new Set([committed.out, local.out, untracked.out].join('\n').split('\n').map(norm).filter(Boolean))];
}

function relevant(entry, changed) {
  const rel = norm(entry.path.replace(/:\d+$/, ''));
  if (!rel) return false;
  return changed.some((file) => under(file, rel) || under(rel, file) || (entry.check === 'status.doc' && file.startsWith('.github/workflows/')));
}

function ignoredBy(entry, ignore) {
  const rel = entry.path.replace(/:\d+$/, '');
  return ignore.find((rule) => rule.check === entry.check && (rule.path.endsWith('/') ? `${rel}/`.startsWith(rule.path) : rule.path === rel));
}

function checkup(root, options = {}) {
  const opts = { github: true, gh: 'gh', runs: DEFAULTS.runs, base: null, ...options };
  const settings = loadSettings(root);
  const fileList = listFiles(root);
  const workflows = fileList.filter((rel) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(rel)).map((rel) => parseWorkflow(rel, readText(root, rel)));
  const analysis = reachAnalysis(root, fileList, workflows);
  const reachable = makeReachTest(analysis);
  let items = [
    ...checkParts(root, fileList, workflows, analysis, reachable),
    ...checkTests(fileList, reachable),
    ...checkScripts(root, fileList, analysis),
    ...checkSpeed(root, fileList, workflows, analysis, settings, opts),
    ...checkHygiene(fileList, workflows, root),
    ...checkStatusDoc(root, fileList, workflows, settings),
  ];
  const ignored = items.filter((entry) => ignoredBy(entry, settings.ignore));
  items = items.filter((entry) => !ignoredBy(entry, settings.ignore));
  const unusedIgnores = settings.ignore.filter((rule) => !ignored.some((entry) => ignoredBy(entry, [rule])));
  let changed = null;
  if (opts.base) {
    changed = changedPaths(root, opts.base);
    items = items.filter((entry) => relevant(entry, changed));
  }
  const notes = [];
  if (!settings.present) notes.push(`no ${SETTINGS_REL}; defaults used (status document ${DEFAULT_STATUS_DOC}, no job budget)`);
  if (!workflows.length) notes.push('no workflow files under .github/workflows');
  for (const rule of unusedIgnores) notes.push(`ignore for ${rule.check} ${rule.path} matched nothing; remove it`);
  return { schema: REPORT_SCHEMA, repo: root, base: opts.base, changed: changed ? changed.length : null, workflows: workflows.map((w) => w.rel), items, ignored: ignored.length, notes };
}

function formatReport(report) {
  const lines = [`CI check-up of ${report.repo}${report.base ? ` (changes since ${report.base}: ${report.changed} paths)` : ''}`];
  for (const note of report.notes) lines.push(`NOTE  ${note}`);
  for (const area of ['parts', 'tests', 'scripts', 'speed', 'hygiene', 'status']) {
    const hits = report.items.filter((entry) => entry.check.startsWith(`${area}.`));
    if (!hits.length) { lines.push(`OK    ${area}`); continue; }
    for (const entry of hits) lines.push(`${entry.level.padEnd(5)} ${entry.check}  ${entry.path ? `${entry.path}: ` : ''}${entry.message}.${entry.fix ? ` Fix: ${entry.fix}.` : ''}`);
  }
  const gaps = report.items.filter((entry) => entry.level === 'GAP').length;
  lines.push(`${gaps} GAP, ${report.items.length - gaps} CHECK, ${report.ignored} ignored with a reason. GAP is clear and fixable; CHECK needs judgement. This report changes nothing.`);
  return lines.join('\n');
}

function parseArgs(argv) {
  const options = { repo: process.cwd(), json: false, github: true, runs: DEFAULTS.runs, base: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => { if (i + 1 >= argv.length) throw new UsageError(`${arg} needs a value`); return argv[++i]; };
    if (arg === '--repo') options.repo = path.resolve(value());
    else if (arg === '--base') options.base = value();
    else if (arg === '--runs') { options.runs = Number(value()); if (!Number.isInteger(options.runs) || options.runs < 1 || options.runs > 50) throw new UsageError('--runs must be a whole number from 1 to 50'); }
    else if (arg === '--no-github') options.github = false;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new UsageError(`unknown argument ${arg}`);
  }
  return options;
}

function main(argv) {
  try {
    const options = parseArgs(argv);
    if (options.help) { process.stdout.write(`${fs.readFileSync(__filename, 'utf8').split('\n').slice(3, 21).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')}\n`); return 0; }
    if (!fs.existsSync(options.repo) || !fs.statSync(options.repo).isDirectory()) throw new UsageError(`--repo ${options.repo} is not a folder`);
    const report = checkup(options.repo, options);
    process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : `${formatReport(report)}\n`);
    return 0;
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    process.stderr.write(`ci-checkup: ${error.message}\n`);
    return 2;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = Object.freeze({ CHECKS, SETTINGS_REL, checkup, formatReport, main, packageInvocations, parseWorkflow });
