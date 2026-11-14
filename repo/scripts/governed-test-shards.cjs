'use strict';

// Sharded tests for a governed repository, in any language: the shard list
// (.github/toolkit-test-shards.json, schema toolkit-test-shards/v2) and the runner that runs one shard.
// Toolkit's own list (repo/contracts/ci/test-shards.json, v1) and run-tests.cjs's Node path stay as they
// are; run-tests.cjs hands a run here only when it is given --repo-root.
//
// A v2 list is v1 plus, for each system it names, how to find the test files (`discover`, a glob from
// the repository root) and how to run one (`command`, an argument list with one "{files}" argument that
// becomes the test file). The runner starts the command once per file with no shell, so a file name can
// never become shell syntax, and times each file, which gives per-file seconds for any language and
// lets Shard Timings rebalance the shards. Each shard writes the same summary as Toolkit's own shards.

const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const MANIFEST_REL = '.github/toolkit-test-shards.json';
const MANIFEST_SCHEMA = 'toolkit-test-shards/v2';
const SUMMARY_SCHEMA = 'toolkit-test-summary/v1';
const SYSTEMS = Object.freeze(['linux', 'windows']);
const SHARD_ID = /^[a-z]+-[1-9][0-9]*$/;
const FILES_ARG = '{files}';
const DEFAULT_WORKFLOW = 'toolkit-test-shards.yml';
const WORKFLOW_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.ya?ml$/;
const DEFAULT_CONCURRENCY = 3;
// One test file's command is stopped after this many seconds unless the list sets file_timeout_seconds.
const DEFAULT_FILE_TIMEOUT_SECONDS = 900;
const MAX_FILE_TIMEOUT_SECONDS = 7200;
// Programs that read their arguments as shell code. A command that starts with one would undo the
// no-shell rule, so the list refuses it.
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'csh', 'tcsh', 'cmd', 'powershell', 'pwsh', 'env', 'busybox', 'xargs']);
// Folders discovery never enters: version control, installed packages and the pinned Toolkit copy.
const SKIPPED_FOLDERS = new Set(['.git', 'node_modules', '.toolkit', '.venv', 'venv', '__pycache__']);
const TOP_KEYS = new Set(['schema', 'description', 'workflow', 'systems', 'budgets', 'durations_seconds', 'file_timeout_seconds']);
const SYSTEM_KEYS = new Set(['command', 'discover', 'shards']);

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

// A discover glob: forward slashes, relative, no `..`; `**` matches any number of folders, `*` and
// `?` stay inside one folder name.
function globError(glob) {
  if (typeof glob !== 'string' || !glob.trim()) return 'discover must be a glob such as tests/**/test_*.py';
  if (glob.startsWith('/') || /^[A-Za-z]:/.test(glob) || glob.includes('\\')) return 'discover must be relative to the repository root, with forward slashes';
  if (glob.split('/').some((part) => part === '..' || part === '.' || part === '')) return 'discover may not use empty, . or .. folder names';
  if (/[[\]{}!]/.test(glob)) return 'discover uses only *, ** and ?';
  return null;
}

function globRegExp(glob) {
  let source = '';
  const parts = glob.split('/');
  parts.forEach((part, index) => {
    const last = index === parts.length - 1;
    if (part === '**') { source += last ? '.*' : '(?:[^/]+/)*'; return; }
    source += part.replace(/[.+^$()|\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
    if (!last) source += '/';
  });
  return new RegExp(`^${source}$`);
}

// Every regular file the glob matches, repository-relative with forward slashes, sorted. Links are
// never followed.
function discoverFiles(root, glob) {
  const pattern = globRegExp(glob);
  const found = [];
  const walk = (folder, prefix) => {
    let entries;
    try { entries = fs.readdirSync(folder, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { if (!SKIPPED_FOLDERS.has(entry.name)) walk(path.join(folder, entry.name), rel); }
      else if (entry.isFile() && pattern.test(rel)) found.push(rel);
    }
  };
  walk(root, '');
  return found.sort();
}

// The program's bare name: either separator, any case, without a Windows program suffix, so
// C:\\Windows\\System32\\cmd.exe and /bin/bash.exe compare as cmd and bash on every system.
function programName(program) {
  return program.split(/[\\/]/).pop().toLowerCase().replace(/\.(exe|com|bat|cmd)$/, '');
}

function commandError(command) {
  if (!Array.isArray(command) || command.length < 2 || !command.every((part) => typeof part === 'string' && part.length > 0)) return 'command must be a list of at least two non-empty strings, such as ["python", "-m", "pytest", "{files}"]';
  if (command.filter((part) => part === FILES_ARG).length !== 1) return `command must hold "${FILES_ARG}" exactly once, as its own argument`;
  if (command[0] === FILES_ARG) return 'command must start with the program to run';
  if (SHELLS.has(programName(command[0]))) return `command may not start with a shell (${command[0]}): name the test program itself`;
  return null;
}

// Every problem with a v2 list, given the files each system's glob finds ({ linux: [...], windows: [...] }).
// Empty when it is usable.
function manifestErrors(manifest, discoveredBySystem = {}) {
  if (!isObject(manifest)) return ['the shard list is not a JSON object'];
  const errors = [];
  if (manifest.schema !== MANIFEST_SCHEMA) errors.push(`schema must be ${MANIFEST_SCHEMA}`);
  for (const key of Object.keys(manifest)) if (!TOP_KEYS.has(key)) errors.push(`unknown key ${key}`);
  if (manifest.workflow !== undefined && (typeof manifest.workflow !== 'string' || !WORKFLOW_FILE.test(manifest.workflow))) errors.push('workflow must be a file name in .github/workflows, such as toolkit-test-shards.yml');
  if (manifest.file_timeout_seconds !== undefined && !(Number.isInteger(manifest.file_timeout_seconds) && manifest.file_timeout_seconds >= 1 && manifest.file_timeout_seconds <= MAX_FILE_TIMEOUT_SECONDS)) errors.push(`file_timeout_seconds must be a whole number of seconds from 1 to ${MAX_FILE_TIMEOUT_SECONDS}`);
  const systems = manifest.systems;
  if (!isObject(systems) || !Object.keys(systems).length) return [...errors, 'systems must name linux, windows or both'];
  for (const system of Object.keys(systems)) {
    if (!SYSTEMS.includes(system)) { errors.push(`unknown system ${system}`); continue; }
    const entry = systems[system];
    if (!isObject(entry)) { errors.push(`${system} must be an object`); continue; }
    for (const key of Object.keys(entry)) if (!SYSTEM_KEYS.has(key)) errors.push(`${system}: unknown key ${key}`);
    const commandProblem = commandError(entry.command);
    if (commandProblem) errors.push(`${system}: ${commandProblem}`);
    const globProblem = globError(entry.discover);
    if (globProblem) errors.push(`${system}: ${globProblem}`);
    const known = new Set(discoveredBySystem[system] || []);
    if (!globProblem && !known.size) errors.push(`${system}: discover ${entry.discover} finds no test file`);
    const shards = entry.shards;
    if (!Array.isArray(shards) || !shards.length) { errors.push(`${system}: shards must be a non-empty list`); continue; }
    const ids = new Set();
    const owner = new Map();
    let rest = 0;
    shards.forEach((shard, index) => {
      const label = `${system} shard ${index + 1}`;
      if (!isObject(shard)) { errors.push(`${label} is not an object`); return; }
      if (typeof shard.id !== 'string' || !SHARD_ID.test(shard.id) || !shard.id.startsWith(`${system}-`)) errors.push(`${label}: id must look like ${system}-<n>`);
      else if (ids.has(shard.id)) errors.push(`${system}: shard id ${shard.id} appears twice`);
      else ids.add(shard.id);
      const keys = Object.keys(shard).sort().join(',');
      if (shard.rest === true) {
        rest += 1;
        if (keys !== 'id,rest') errors.push(`${label}: a rest shard has only id and rest`);
        return;
      }
      if (keys !== 'files,id') errors.push(`${label}: a named shard has only id and files`);
      if (!Array.isArray(shard.files) || !shard.files.length) { errors.push(`${label}: files must be a non-empty list`); return; }
      for (const file of shard.files) {
        if (!known.has(file)) errors.push(`${shard.id}: ${file} is not a file discover finds`);
        else if (owner.has(file)) errors.push(`${system}: ${file} is in both ${owner.get(file)} and ${shard.id}`);
        else owner.set(file, shard.id);
      }
    });
    if (rest !== 1) errors.push(`${system}: exactly one shard must be the rest shard (found ${rest})`);
    else if (known.size && owner.size >= known.size) errors.push(`${system}: the rest shard is empty`);
  }
  for (const field of ['durations_seconds', 'budgets']) {
    const value = manifest[field];
    if (value === undefined) continue;
    if (!isObject(value)) { errors.push(`${field} must be an object`); continue; }
    for (const [system, table] of Object.entries(value)) {
      if (!Object.hasOwn(systems, system)) { errors.push(`${field}: ${system} is not a system this list names`); continue; }
      if (!isObject(table)) { errors.push(`${field}.${system} must be an object`); continue; }
      if (field === 'budgets') continue;
      const known = new Set(discoveredBySystem[system] || []);
      for (const [file, seconds] of Object.entries(table)) {
        if (!known.has(file)) errors.push(`${field}.${system}: ${file} is not a file discover finds`);
        if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) errors.push(`${field}.${system}: ${file} needs a non-negative number`);
      }
    }
  }
  return errors;
}

function loadManifest(root) {
  const file = path.join(root, ...MANIFEST_REL.split('/'));
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`${MANIFEST_REL} is missing in ${root}: this repository has no shard list.`);
    throw error;
  }
  try { return JSON.parse(text.replace(/^﻿/, '')); } catch { throw new Error(`${MANIFEST_REL} is not valid JSON.`); }
}

function discoverAll(root, manifest) {
  const out = {};
  for (const [system, entry] of Object.entries(isObject(manifest?.systems) ? manifest.systems : {})) {
    if (SYSTEMS.includes(system) && isObject(entry) && !globError(entry.discover)) out[system] = discoverFiles(root, entry.discover);
  }
  return out;
}

function assertManifest(manifest, discoveredBySystem) {
  const errors = manifestErrors(manifest, discoveredBySystem);
  if (errors.length) throw new Error(`The shard list ${MANIFEST_REL} is not usable:\n- ${errors.join('\n- ')}`);
}

// The files one shard runs, in discovery order; the rest shard takes every file no other shard names.
function resolveShard(manifest, system, shardId, discoveredBySystem) {
  assertManifest(manifest, discoveredBySystem);
  if (!Object.hasOwn(manifest.systems, system)) throw new Error(`The shard list names no ${system} shards.`);
  const shards = manifest.systems[system].shards;
  const shard = shards.find((item) => item.id === shardId);
  if (!shard) throw new Error(`Unknown shard "${shardId}" for ${system}. Shards: ${shards.map((item) => item.id).join(', ')}.`);
  const discovered = discoveredBySystem[system];
  const named = new Set(shards.filter((item) => !item.rest).flatMap((item) => item.files));
  const listed = new Set(shard.rest ? [] : shard.files);
  const files = discovered.filter((file) => (shard.rest ? !named.has(file) : listed.has(file)));
  if (!files.length) throw new Error(`Shard "${shardId}" for ${system} has no test files.`);
  return files;
}

// Longest measured first, unmeasured last in discovery order (as Toolkit's own shards run).
function runOrder(files, durations = {}) {
  return files
    .map((file, index) => ({ file, index, seconds: typeof durations[file] === 'number' ? durations[file] : -1 }))
    .sort((a, b) => (b.seconds - a.seconds) || (a.index - b.index))
    .map((item) => item.file);
}

function estimateShardSeconds(files, durations = {}, concurrency = DEFAULT_CONCURRENCY) {
  const slots = new Array(Math.max(1, concurrency)).fill(0);
  for (const file of runOrder(files, durations)) {
    const next = slots.indexOf(Math.min(...slots));
    slots[next] += typeof durations[file] === 'number' ? durations[file] : 0;
  }
  return Math.max(...slots);
}

function argvFor(command, file) {
  return command.map((part) => (part === FILES_ARG ? file : part));
}

// Stops a timed-out command and every process it started: its process group on Linux, its process
// tree (taskkill /T) on Windows. Best effort; a process already gone is fine.
function stopTree(child, platform = process.platform) {
  if (!child || !Number.isInteger(child.pid)) { try { child?.kill?.('SIGKILL'); } catch {} return; }
  if (platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  else { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
  try { child.kill('SIGKILL'); } catch {}
}

// Runs one file's command and resolves { code, seconds, error }. Never throws: a program that cannot
// start (not installed, or a script Windows only runs through a shell) is that file's failure.
function runOne({ root, command, file, env, spawnFn, clock, write, timeoutSeconds = DEFAULT_FILE_TIMEOUT_SECONDS }) {
  return new Promise((resolve) => {
    const [program, ...args] = argvFor(command, file);
    const started = clock();
    let child;
    // On Linux the command leads its own process group, so a timeout can stop everything it started.
    try { child = spawnFn(program, args, { cwd: root, env, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (error) { resolve({ code: null, seconds: 0, error: error.message }); return; }
    const chunks = [];
    child.stdout?.on('data', (chunk) => chunks.push(chunk));
    child.stderr?.on('data', (chunk) => chunks.push(chunk));
    let settled = false;
    // A file that hangs is stopped and fails by name, so one stuck test cannot hold the shard until
    // the CI job's own limit.
    const timer = setTimeout(() => {
      stopTree(child);
      // A process the test started may still hold the output pipes; closing them here lets the shard
      // finish now instead of when that process ends.
      child.stdout?.destroy();
      child.stderr?.destroy();
      finish(null, `timed out after ${timeoutSeconds} s`);
    }, timeoutSeconds * 1000);
    const finish = (code, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const output = Buffer.concat(chunks).toString('utf8');
      write(`--- ${file}\n${output}${output && !output.endsWith('\n') ? '\n' : ''}`);
      resolve({ code, seconds: Math.round((clock() - started) / 100) / 10, error });
    };
    child.on('error', (error) => finish(null, error.code === 'ENOENT' ? `${program} was not found` : error.message));
    child.on('close', (code) => finish(code, null));
  });
}

// Runs one shard and resolves { exitCode, summary }. Each file's output is printed whole when it ends,
// so parallel files never interleave.
async function runShard({ root, manifest, system, shardId, concurrency = DEFAULT_CONCURRENCY, env = process.env, spawnFn = spawn, clock = Date.now, out = process.stdout }) {
  const discovered = discoverAll(root, manifest);
  const files = resolveShard(manifest, system, shardId, discovered);
  const durations = (manifest.durations_seconds || {})[system] || {};
  const command = manifest.systems[system].command;
  // A runner started inside a Node test run would otherwise make a node --test child report to that
  // run instead of exiting with its own result.
  const childEnv = { ...env };
  delete childEnv.NODE_TEST_CONTEXT;
  out.write(`Running ${files.length} test file(s) (${shardId}) with ${command.join(' ')}, ${concurrency} at a time.\n`);
  const queue = runOrder(files, durations);
  const results = new Map();
  const worker = async () => {
    while (queue.length) {
      const file = queue.shift();
      results.set(file, await runOne({ root, command, file, env: childEnv, spawnFn, timeoutSeconds: manifest.file_timeout_seconds || DEFAULT_FILE_TIMEOUT_SECONDS, clock, write: (text) => out.write(text) }));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
  const entries = files.map((file) => {
    const result = results.get(file);
    const passed = result.code === 0 ? 1 : 0;
    const entry = { file, tests: 1, passed, failed: 1 - passed, skipped: 0, todo: 0, cancelled: 0, seconds: result.seconds };
    if (!passed) entry.error = result.error || `exit code ${result.code === null ? 'none' : result.code}`;
    return entry;
  });
  const failed = entries.filter((entry) => entry.failed);
  for (const entry of failed) out.write(`FAILED ${entry.file}: ${entry.error}\n`);
  const exitCode = failed.length ? 1 : 0;
  return { exitCode, summary: { schema: SUMMARY_SCHEMA, system, shard: shardId, exit_code: exitCode, node: process.version, command_mode: true, files: entries, missing: [] } };
}

const USAGE = 'Usage: node repo/scripts/run-tests.cjs --repo-root <dir> (--check | --plan | --shard <id> --os <linux|windows> [--summary <file>] [--concurrency <n>])';

class UsageError extends Error {}

function parseArgs(argv) {
  const options = { mode: null, concurrency: DEFAULT_CONCURRENCY };
  const setMode = (mode) => {
    if (options.mode && options.mode !== mode) throw new UsageError(`Choose one of --check, --plan or --shard (got ${options.mode} and ${mode}).`);
    options.mode = mode;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (['--repo-root', '--shard', '--os', '--summary', '--concurrency'].includes(arg)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new UsageError(`${arg} needs a value.`);
      index += 1;
      if (arg === '--repo-root') options.root = value;
      else if (arg === '--shard') { setMode('shard'); options.shard = value; }
      else if (arg === '--os') options.os = value;
      else if (arg === '--summary') options.summary = value;
      else {
        if (!/^[1-9][0-9]?$/.test(value)) throw new UsageError('--concurrency takes a whole number from 1 to 99.');
        options.concurrency = Number(value);
      }
    } else if (arg === '--check') setMode('check');
    else if (arg === '--plan') setMode('plan');
    else throw new UsageError(`${arg} does not go with --repo-root.`);
  }
  if (!options.root) throw new UsageError('--repo-root needs a value.');
  if (!options.mode) throw new UsageError('Choose --check, --plan or --shard.');
  if (options.mode === 'shard' && !SYSTEMS.includes(options.os)) throw new UsageError('--shard needs --os linux or --os windows.');
  if (options.os && options.mode !== 'shard') throw new UsageError('--os goes with --shard.');
  if (options.summary && options.mode !== 'shard') throw new UsageError('--summary goes with --shard.');
  return options;
}

function platformSystem(platform = process.platform) {
  return platform === 'win32' ? 'windows' : platform === 'linux' ? 'linux' : null;
}

// The commit a GitHub Actions run tested, or null outside one (as Toolkit's own shard summaries record it).
function testedCommit(env = process.env) {
  return env.GITHUB_ACTIONS === 'true' && /^[0-9a-f]{40}$/.test(env.GITHUB_SHA || '') ? env.GITHUB_SHA : null;
}

async function main(argv, { out = process.stdout, err = process.stderr, env = process.env, platform = process.platform, spawnFn = spawn } = {}) {
  let options;
  try {
    options = parseArgs(argv);
    const root = path.resolve(options.root);
    let manifest;
    try { manifest = loadManifest(root); } catch (error) { throw new UsageError(error.message); }
    const discovered = discoverAll(root, manifest);
    const errors = manifestErrors(manifest, discovered);
    if (errors.length) {
      err.write(`The shard list ${MANIFEST_REL} is not usable:\n- ${errors.join('\n- ')}\n`);
      return 1;
    }
    if (options.mode === 'check' || options.mode === 'plan') {
      for (const system of Object.keys(manifest.systems)) {
        const durations = (manifest.durations_seconds || {})[system] || {};
        for (const shard of manifest.systems[system].shards) {
          const files = resolveShard(manifest, system, shard.id, discovered);
          out.write(`${shard.id}: ${files.length} file(s), about ${Math.round(estimateShardSeconds(files, durations, DEFAULT_CONCURRENCY))} s\n`);
        }
      }
      if (options.mode === 'check') out.write(`${MANIFEST_REL} is usable.\n`);
      return 0;
    }
    if (options.os !== platformSystem(platform)) throw new UsageError(`--os ${options.os} does not match this machine (${platformSystem(platform) || platform}).`);
    let result;
    try { result = await runShard({ root, manifest, system: options.os, shardId: options.shard, concurrency: options.concurrency, env, spawnFn, out }); }
    catch (error) { throw new UsageError(error.message); }
    const { exitCode, summary } = result;
    const attempt = Number(env.GITHUB_RUN_ATTEMPT);
    if (Number.isInteger(attempt) && attempt > 0) summary.run_attempt = attempt;
    const commit = testedCommit(env);
    if (commit) summary.commit = commit;
    const passed = summary.files.filter((entry) => entry.passed).length;
    out.write(`${summary.files.length} file(s): ${passed} passed, ${summary.files.length - passed} failed\n`);
    if (options.summary) {
      fs.mkdirSync(path.dirname(path.resolve(options.summary)), { recursive: true });
      fs.writeFileSync(options.summary, `${JSON.stringify(summary, null, 2)}\n`);
    }
    return exitCode;
  } catch (error) {
    if (error instanceof UsageError) { err.write(`${error.message}\n${USAGE}\n`); return 2; }
    throw error;
  }
}

module.exports = Object.freeze({
  DEFAULT_FILE_TIMEOUT_SECONDS,
  DEFAULT_WORKFLOW,
  FILES_ARG,
  MANIFEST_REL,
  MANIFEST_SCHEMA,
  SYSTEMS,
  argvFor,
  assertManifest,
  commandError,
  discoverAll,
  discoverFiles,
  estimateShardSeconds,
  globError,
  globRegExp,
  loadManifest,
  main,
  manifestErrors,
  parseArgs,
  resolveShard,
  runOrder,
  runShard,
});
