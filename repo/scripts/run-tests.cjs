#!/usr/bin/env node
'use strict';

// Runs Toolkit's tests, locally and in CI, from one shard manifest (repo/contracts/ci/test-shards.json).
//
//   node repo/scripts/run-tests.cjs                    the test files your change affects (same as --changed)
//   node repo/scripts/run-tests.cjs --all              every test file
//   node repo/scripts/run-tests.cjs <file>...          the named test files
//   node repo/scripts/run-tests.cjs --shard windows-2 --os windows   one CI shard
//   node repo/scripts/run-tests.cjs --plan             the shards and their estimated times
//   node repo/scripts/run-tests.cjs --verify-ci <dir>  the CI aggregate check over the leg summaries
//
// Every run gets its own scratch temp folder, <temp root>\<run id>, set as TEMP, TMP and TMPDIR for
// the run and every child process. It is removed when the run finishes, also when tests fail.
// The next run removes a folder an interrupted run left once it is more than a day old.
// Write anything a run must keep with --summary or --report-durations to a path outside the run folder.
// The temp root is %USERPROFILE%\t unless
// --temp-root names another folder (CI passes the runner's temp folder); a folder directly under
// a drive root is refused. On Windows the folder is used in its long form, never an 8.3 short name.
// Options: --summary <file> writes the run's JSON summary,
// --report-durations <file> writes seconds per file, --concurrency <n> (default 3), --base <ref>
// for --changed (default origin/main).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const shards = require('./ci-test-shards.cjs');

const REPORTER = path.join(__dirname, 'test-summary-reporter.cjs');
const DEFAULT_CONCURRENCY = 3;
const STALE_RUN_AGE_MS = 24 * 60 * 60 * 1000;
const USAGE = 'Usage: node repo/scripts/run-tests.cjs [--changed | --all | --shard <id> --os <linux|windows> | --plan | --verify-ci <dir> | <test file>...] [--temp-root <dir>] [--summary <file>] [--report-durations <file>] [--concurrency <n>] [--base <ref>]';

class UsageError extends Error {}

function parseArgs(argv) {
  const options = { mode: null, files: [], concurrency: DEFAULT_CONCURRENCY, base: 'origin/main' };
  const valued = new Set(['--shard', '--os', '--temp-root', '--summary', '--report-durations', '--concurrency', '--base', '--verify-ci']);
  const setMode = (mode) => {
    if (options.mode && options.mode !== mode) throw new UsageError(`Choose one of --changed, --all, --shard, --plan, --verify-ci or test files (got ${options.mode} and ${mode}).`);
    options.mode = mode;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (valued.has(arg)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new UsageError(`${arg} needs a value.`);
      index += 1;
      if (arg === '--shard') { setMode('shard'); options.shard = value; }
      else if (arg === '--os') options.os = value;
      else if (arg === '--temp-root') options.tempRoot = value;
      else if (arg === '--summary') options.summary = value;
      else if (arg === '--report-durations') options.reportDurations = value;
      else if (arg === '--base') options.base = value;
      else if (arg === '--verify-ci') { setMode('verify-ci'); options.verifyDir = value; }
      else if (arg === '--concurrency') {
        if (!/^[1-9][0-9]?$/.test(value)) throw new UsageError('--concurrency takes a whole number from 1 to 99.');
        options.concurrency = Number(value);
      }
    } else if (arg === '--all') setMode('all');
    else if (arg === '--changed') setMode('changed');
    else if (arg === '--plan') setMode('plan');
    else if (arg === '--help' || arg === '-h') setMode('help');
    else if (arg.startsWith('--')) throw new UsageError(`Unknown option ${arg}.`);
    else { setMode('files'); options.files.push(arg); }
  }
  if (!options.mode) options.mode = 'changed';
  if (options.mode === 'shard' && !options.os) throw new UsageError('--shard needs --os linux or --os windows.');
  if (options.os && options.mode !== 'shard') throw new UsageError('--os goes with --shard.');
  return options;
}

// Refuse a temp root at or directly under a drive root.
function tempRootError(root) {
  const resolved = path.resolve(root);
  const fsRoot = path.parse(resolved).root;
  if (resolved === fsRoot || path.dirname(resolved) === fsRoot) return `The temp root ${resolved} is at a drive root. Use a folder inside the user profile, such as ${path.join(os.homedir(), 't')}; each run removes its own folder there when it finishes.`;
  return null;
}

// One test run: owns its temp folder (removed when the run finishes), the node --test child and the summary it reports.
class TestRun {
  constructor({ root, system, tempRoot, env = process.env, spawn = spawnSync, now = () => Date.now(), stdio = 'inherit', out = process.stdout, err = process.stderr }) {
    this.root = root;
    this.system = system;
    this.tempRoot = path.resolve(tempRoot);
    this.env = env;
    this.spawn = spawn;
    this.now = now;
    this.stdio = stdio;
    this.out = out;
    this.err = err;
    this.folder = null;
  }

  createFolder() {
    const problem = tempRootError(this.tempRoot);
    if (problem) throw new UsageError(problem);
    fs.mkdirSync(this.tempRoot, { recursive: true });
    // realpath.native gives the long form of every part, so tests never see an 8.3 short name.
    const longRoot = fs.realpathSync.native(this.tempRoot);
    const now = this.now();
    for (const entry of fs.readdirSync(longRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('run-')) continue;
      const folder = path.join(longRoot, entry.name);
      try {
        if (now - fs.statSync(folder).mtimeMs <= STALE_RUN_AGE_MS) continue;
        fs.rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
        if (!fs.existsSync(folder)) continue;
      } catch {}
      this.err.write(`Could not remove the stale test temp folder ${folder}. The next run removes it once it is more than a day old and no longer held open.\n`);
    }
    const stamp = new Date(now).toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
    this.folder = fs.mkdtempSync(path.join(longRoot, `run-${stamp}-`));
    return this.folder;
  }

  removeFolder() {
    if (!this.folder) return true;
    // Tests should clean up after themselves; whatever they left goes with the run folder, also when tests fail.
    try {
      let left = [];
      try { left = fs.readdirSync(this.folder).filter((name) => name !== 'test-results.jsonl'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (left.length) this.out.write(`Removing ${left.length} temp item(s) tests left behind (${left.slice(0, 3).join(', ')}${left.length > 3 ? ', ...' : ''}).\n`);
      fs.rmSync(this.folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      if (!fs.existsSync(this.folder)) return true;
    } catch {}
    this.err.write(`Could not remove the test temp folder ${this.folder}. The next run removes it once it is more than a day old and no longer held open.\n`);
    return false;
  }

  childEnv() {
    const env = { ...this.env, TEMP: this.folder, TMP: this.folder, TMPDIR: this.folder };
    // toolkit-test-temp-guard.cjs watches the real update-report folder; it lives under the
    // temp root the run started with, not the run's own folder.
    env.TOOLKIT_TEST_REAL_TEMP = this.env.TOOLKIT_TEST_REAL_TEMP || os.tmpdir();
    return env;
  }

  // Runs the files and returns { exitCode, summary }. The run folder is removed in every case;
  // a folder an interrupted run left is removed by the next run once it is a day old.
  run(files, { concurrency = DEFAULT_CONCURRENCY, label = 'tests' } = {}) {
    this.createFolder();
    let exitCode = 1;
    let summary = null;
    try {
      const results = path.join(this.folder, 'test-results.jsonl');
      this.out.write(`Running ${files.length} test file(s) (${label}) in temp folder ${this.folder}, removed when the run finishes.\n`);
      const result = this.spawn(process.execPath, [
        '--test', `--test-concurrency=${concurrency}`,
        '--test-reporter=spec', '--test-reporter-destination=stdout',
        `--test-reporter=${pathToFileURL(REPORTER).href}`, `--test-reporter-destination=${results}`,
        ...files,
      ], { cwd: this.root, env: this.childEnv(), stdio: this.stdio, windowsHide: true });
      if (result.error) throw result.error;
      exitCode = result.status === null ? 1 : result.status;
      summary = summarize(this.root, this.system, files, readResults(results), exitCode);
      if (exitCode === 0 && summary.missing.length) exitCode = 1;
    } finally {
      if (!this.removeFolder() && exitCode === 0) exitCode = 1;
    }
    return { exitCode, summary };
  }
}

function readResults(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function summarize(root, system, files, lines, exitCode) {
  const byFile = new Map();
  for (const line of lines) if (line.file) byFile.set(shards.relativeTestFile(root, line.file), line);
  const entries = [];
  const missing = [];
  for (const file of files.map((item) => shards.relativeTestFile(root, item))) {
    const line = byFile.get(file);
    if (!line) { missing.push(file); continue; }
    const counts = line.counts || {};
    entries.push({
      file,
      tests: counts.tests || 0,
      passed: counts.passed || 0,
      failed: counts.failed || 0,
      skipped: counts.skipped || 0,
      todo: counts.todo || 0,
      cancelled: counts.cancelled || 0,
      seconds: Math.round((line.duration_ms || 0) / 100) / 10,
    });
  }
  return { schema: shards.SUMMARY_SCHEMA, system, exit_code: exitCode, node: process.version, files: entries, missing };
}

function totalsLine(summary) {
  const sum = (key) => summary.files.reduce((total, entry) => total + entry[key], 0);
  return `${summary.files.length} file(s), ${sum('tests')} test(s): ${sum('passed')} passed, ${sum('failed')} failed, ${sum('skipped')} skipped, ${sum('cancelled')} cancelled`;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new UsageError(`git ${args.join(' ')} failed: ${(result.stderr || '').trim()}`);
  return result.stdout;
}

function changedPaths(root, base) {
  const mergeBase = git(root, ['merge-base', base, 'HEAD']).trim();
  const committed = git(root, ['diff', '--name-only', `${mergeBase}...HEAD`]).split('\n');
  const working = git(root, ['status', '--porcelain', '--untracked-files=all']).split('\n').map((line) => line.slice(3).replace(/^.* -> /, ''));
  return [...new Set([...committed, ...working].map((item) => item.trim().replace(/^"|"$/g, '')).filter(Boolean))];
}

function readSummaries(dir) {
  const found = [];
  const walk = (folder) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.json')) found.push(JSON.parse(fs.readFileSync(full, 'utf8')));
    }
  };
  walk(dir);
  return found;
}

function verifyCi(root, options, out, err) {
  const manifest = shards.loadManifest(root);
  const discovered = shards.discoverTestFiles(root);
  let needs = null;
  try { needs = JSON.parse(process.env.TEST_LEGS || 'null'); }
  catch { needs = null; }
  const summaries = fs.existsSync(options.verifyDir) ? readSummaries(options.verifyDir) : [];
  const { errors, totals } = shards.verifyCiSummaries({ manifest, discovered, summaries, needs });
  errors.push(...shards.workflowErrors(fs.readFileSync(path.join(root, '.github', 'workflows', 'validate.yml'), 'utf8'), manifest));
  for (const system of Object.keys(totals)) {
    const total = totals[system];
    out.write(`${system}: ${total.files} file(s), ${total.tests} test(s): ${total.passed} passed, ${total.failed} failed, ${total.skipped} skipped, ${total.cancelled} cancelled\n`);
  }
  if (errors.length) {
    err.write(`The test legs do not prove the full suite passed:\n- ${errors.join('\n- ')}\n`);
    return 1;
  }
  out.write(`Every test leg passed and together they ran all ${discovered.length} test files on each system.\n`);
  return 0;
}

function plan(root, out) {
  const manifest = shards.loadManifest(root);
  const discovered = shards.discoverTestFiles(root);
  for (const system of shards.SYSTEMS) {
    const durations = (manifest.durations_seconds || {})[system] || {};
    for (const shard of shards.systemShards(manifest, system, discovered)) {
      const estimate = shards.estimateShardSeconds(shard.files, durations, DEFAULT_CONCURRENCY);
      out.write(`${shard.id}: ${shard.files.length} file(s), about ${Math.round(estimate)} s\n`);
    }
  }
  return 0;
}

function selectFiles(root, options, out) {
  const discovered = shards.discoverTestFiles(root);
  if (options.mode === 'all') return { files: discovered, label: 'all' };
  if (options.mode === 'shard') {
    const system = shards.platformSystem();
    if (options.os !== system) throw new UsageError(`--os ${options.os} does not match this machine (${system || process.platform}).`);
    let files;
    try { files = shards.resolveShard(shards.loadManifest(root), options.os, options.shard, discovered); }
    catch (error) { throw new UsageError(error.message); }
    return { files, label: options.shard, shard: options.shard };
  }
  if (options.mode === 'files') {
    const files = options.files.map((file) => shards.relativeTestFile(root, file));
    const unknown = files.filter((file) => !discovered.includes(file));
    if (unknown.length) throw new UsageError(`Not a test file in repo/tests: ${unknown.join(', ')}`);
    return { files: [...new Set(files)], label: 'named files' };
  }
  const affected = shards.affectedTestFiles(changedPaths(root, options.base), discovered, (file) => fs.readFileSync(path.join(root, file), 'utf8'));
  for (const item of affected) out.write(`  ${item.file} (${item.reason})\n`);
  return { files: affected.map((item) => item.file), label: `changed since ${options.base}` };
}

function main(argv = process.argv.slice(2), { root = shards.ROOT, out = process.stdout, err = process.stderr } = {}) {
  let options;
  try {
    options = parseArgs(argv);
    if (options.mode === 'help') { out.write(`${USAGE}\n`); return 0; }
    if (options.mode === 'verify-ci') return verifyCi(root, options, out, err);
    if (options.mode === 'plan') return plan(root, out);
    const selection = selectFiles(root, options, out);
    if (!selection.files.length) {
      out.write('No test file is affected by the change. Use --all to run every test file.\n');
      return 0;
    }
    const system = shards.platformSystem();
    const manifest = shards.loadManifest(root);
    const durations = (manifest.durations_seconds || {})[system] || {};
    const testRun = new TestRun({ root, system, tempRoot: options.tempRoot || path.join(os.homedir(), 't'), out, err });
    const { exitCode, summary } = testRun.run(shards.runOrder(selection.files, durations), { concurrency: options.concurrency, label: selection.label });
    if (summary) {
      if (selection.shard) summary.shard = selection.shard;
      out.write(`${totalsLine(summary)}\n`);
      if (summary.missing.length) err.write(`No result for ${summary.missing.join(', ')}: the file did not load.\n`);
      if (options.summary) writeJson(options.summary, summary);
      if (options.reportDurations) {
        writeJson(options.reportDurations, {
          schema: 'toolkit-test-durations/v1',
          system,
          files: Object.fromEntries(summary.files.map((entry) => [entry.file, entry.seconds])),
        });
      }
    }
    return exitCode;
  } catch (error) {
    if (error instanceof UsageError) {
      err.write(`${error.message}\n${USAGE}\n`);
      return 2;
    }
    throw error;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = Object.freeze({ TestRun, main, parseArgs, summarize, tempRootError });
