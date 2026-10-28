#!/usr/bin/env node
'use strict';

// Refreshes the measured per-file test times in the shard manifest (repo/contracts/ci/test-shards.json)
// from the test summaries of the latest green Validate run on main. It makes no model calls.
//
//   node repo/scripts/refresh-shard-timings.cjs [--run <id>] [--write | --open-pr]
//
// Without a flag it only reports. Each shard job already uploads its run-tests.cjs summary (per-file
// seconds) as a test-summary-<shard> artifact, so this reads those through read-only `gh` and changes
// nothing. --run <id> reads that finished Validate run instead, for example a pull request's run
// that measured a new or split test file. It reports the refresh triggers it checks:
//   - more than 10% of test files have no measured time;
//   - with the fresh times, the slowest shard of a system is estimated over 1.3x its fastest;
//   - a file is over its per-file budget (budgets in the manifest). Refreshing cannot fix this: the
//     report says to split or speed up that file.
// --write updates the manifest in this checkout when the first two triggers fire: durations from
// the run and, when the shards are out of balance, files moved between the named shards (the rest
// shard keeps every file no named shard lists). --open-pr does the same on a new branch from
// origin/main in a temporary worktree, pushes it and opens a pull request; with no trigger crossed
// it opens nothing.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const shards = require('./ci-test-shards.cjs');

const WORKFLOW_FILE = 'validate.yml';
const ARTIFACT_PATTERN = 'test-summary-*';
const UNTIMED_SHARE = 0.1;
const IMBALANCE_RATIO = 1.3;
const CONCURRENCY = 3; // run-tests.cjs default; node --test runs three files at a time per shard
const USAGE = 'Usage: node repo/scripts/refresh-shard-timings.cjs [--run <id>] [--write | --open-pr]';

class UsageError extends Error {}

function parseArgs(argv) {
  const options = { run: null, write: false, openPr: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--write') options.write = true;
    else if (arg === '--open-pr') options.openPr = true;
    else if (arg === '--run') {
      const value = argv[index += 1];
      if (!/^[0-9]+$/.test(value || '')) throw new UsageError('--run needs a numeric run id');
      options.run = value;
    } else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new UsageError(`Unknown argument: ${arg}`);
  }
  if (options.write && options.openPr) throw new UsageError('Use --write or --open-pr, not both');
  return options;
}

// Per-file seconds by system from run-tests.cjs summaries, keeping only discovered test files.
function timingsFromSummaries(summaries, discovered) {
  const known = new Set(discovered);
  const result = Object.fromEntries(shards.SYSTEMS.map((system) => [system, {}]));
  for (const summary of summaries) {
    if (!summary || summary.schema !== shards.SUMMARY_SCHEMA || !shards.SYSTEMS.includes(summary.system) || !Array.isArray(summary.files)) {
      throw new Error(`a downloaded summary is not a ${shards.SUMMARY_SCHEMA} file`);
    }
    for (const entry of summary.files) {
      if (known.has(entry.file) && typeof entry.seconds === 'number' && Number.isFinite(entry.seconds) && entry.seconds >= 0) {
        result[summary.system][entry.file] = Math.round(entry.seconds * 10) / 10;
      }
    }
  }
  return result;
}

function shardEstimates(manifest, system, discovered, durations) {
  return shards.systemShards(manifest, system, discovered)
    .map(({ id, files }) => ({ id, seconds: Math.round(shards.estimateShardSeconds(files, durations, CONCURRENCY) * 10) / 10 }));
}

function imbalance(estimates) {
  const values = estimates.map((item) => item.seconds);
  const fastest = Math.min(...values);
  return fastest > 0 ? Math.max(...values) / fastest : (Math.max(...values) > 0 ? Infinity : 1);
}

// Moves files between a system's shards so their estimated times are close: longest files first,
// each to the shard that would finish soonest with it. Shard ids and the rest shard stay.
function rebalance(manifest, system, discovered, durations) {
  const list = manifest.systems[system].shards;
  const buckets = list.map(() => []);
  const ordered = shards.runOrder(discovered, durations);
  for (const file of ordered) {
    let best = 0;
    let bestSeconds = Infinity;
    buckets.forEach((files, index) => {
      const seconds = shards.estimateShardSeconds([...files, file], durations, CONCURRENCY);
      if (seconds < bestSeconds) { best = index; bestSeconds = seconds; }
    });
    buckets[best].push(file);
  }
  return list.map((shard, index) => (shard.rest ? { id: shard.id, rest: true } : { id: shard.id, files: [...buckets[index]].sort() }));
}

// The report and, when a refresh trigger fired, the refreshed manifest. Never touches the file system.
function planRefresh(manifest, discovered, fresh) {
  const findings = [];
  const lines = [];
  const next = JSON.parse(JSON.stringify(manifest));
  const budgets = manifest.budgets || {};
  let refresh = false;
  for (const system of shards.SYSTEMS) {
    const recorded = (manifest.durations_seconds || {})[system] || {};
    const measured = fresh[system] || {};
    const untimed = discovered.filter((file) => typeof recorded[file] !== 'number');
    if (untimed.length > discovered.length * UNTIMED_SHARE) {
      refresh = true;
      findings.push(`${system}: ${untimed.length} of ${discovered.length} test files have no recorded time`);
    }
    const missing = discovered.filter((file) => typeof measured[file] !== 'number');
    if (missing.length) lines.push(`${system}: the run has no time for ${missing.length} file(s); a recorded time is kept where there is one`);
    const merged = {};
    for (const file of discovered) {
      if (typeof measured[file] === 'number') merged[file] = measured[file];
      else if (typeof recorded[file] === 'number') merged[file] = recorded[file];
    }
    next.durations_seconds = next.durations_seconds || {};
    next.durations_seconds[system] = merged;
    const estimates = shardEstimates(manifest, system, discovered, merged);
    const ratio = imbalance(estimates);
    lines.push(`${system}: estimated shard seconds ${estimates.map((item) => `${item.id} ${item.seconds}`).join(', ')}`);
    if (ratio > IMBALANCE_RATIO) {
      refresh = true;
      next.systems[system].shards = rebalance(manifest, system, discovered, merged);
      const after = shardEstimates(next, system, discovered, merged);
      findings.push(`${system}: slowest shard is ${ratio.toFixed(2)}x the fastest (over ${IMBALANCE_RATIO}x); rebalanced to ${after.map((item) => `${item.id} ${item.seconds}`).join(', ')}`);
    }
    const limit = (budgets.seconds_per_file || {})[system];
    if (limit !== undefined) {
      for (const [file, seconds] of Object.entries(measured)) {
        const raise = (budgets.raised || {})[`${system}:${file}`];
        const allowed = raise ? raise.seconds : limit;
        if (seconds > allowed) findings.push(`${system}: ${file} took ${seconds} s, over its ${allowed} s budget; split it by area or make it faster (refreshing does not fix this)`);
      }
    }
  }
  if (refresh) shards.assertManifest(next, discovered);
  return { refresh, findings, lines, manifest: refresh ? next : manifest };
}

function manifestText(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

// Runs git or gh with no shell; returns stdout or throws with the command's own error text.
function command(program, args, options = {}) {
  const result = spawnSync(program, args, { encoding: 'utf8', windowsHide: true, ...options });
  if (result.error) throw new Error(`${program} could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${program} ${args[0]} failed: ${(result.stderr || result.stdout || '').trim().split('\n').slice(-3).join(' ')}`);
  return result.stdout;
}

function latestGreenRun(root, run) {
  const fields = 'databaseId,headSha,conclusion,headBranch,workflowName';
  if (run) {
    // A named run may have failed after its shards, for example on a file over its budget. Only a
    // shard whose tests passed uploads its summary, so every time read from it is from a passing run.
    const value = JSON.parse(command('gh', ['run', 'view', run, '--json', fields], { cwd: root }));
    if (!value.conclusion || value.workflowName !== 'Validate') throw new Error(`run ${run} is not a finished Validate run`);
    return value;
  }
  const list = JSON.parse(command('gh', ['run', 'list', '--workflow', WORKFLOW_FILE, '--branch', 'main', '--event', 'push', '--status', 'success', '--limit', '1', '--json', fields], { cwd: root }));
  if (!list.length) throw new Error(`no successful ${WORKFLOW_FILE} run on main was found`);
  return list[0];
}

function downloadSummaries(root, runId) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shard-timings-'));
  try {
    command('gh', ['run', 'download', String(runId), '--pattern', ARTIFACT_PATTERN, '--dir', dir], { cwd: root });
    const summaries = [];
    for (const folder of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!folder.isDirectory()) continue;
      for (const file of fs.readdirSync(path.join(dir, folder.name))) {
        if (file.endsWith('.json')) summaries.push(JSON.parse(fs.readFileSync(path.join(dir, folder.name, file), 'utf8')));
      }
    }
    if (!summaries.length) throw new Error(`run ${runId} has no ${ARTIFACT_PATTERN} artifacts (they are kept for 7 days)`);
    return summaries;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function prBody(run, plan) {
  return [
    `Refreshes the measured test times in \`${shards.MANIFEST_REL}\` from the test summaries of Validate run ${run.databaseId} on main (${run.headSha.slice(0, 7)}).`,
    '',
    'Triggers crossed:',
    ...plan.findings.map((finding) => `- ${finding}`),
    '',
    'Made by `node repo/scripts/refresh-shard-timings.cjs --open-pr`, which makes no model calls. Only the shard manifest changes; no test is added, removed or skipped.',
  ].join('\n');
}

function openPr(root, run, out) {
  const branch = `toolkit/shard-timings-${run.headSha.slice(0, 7)}`;
  if (command('git', ['ls-remote', '--heads', 'origin', branch], { cwd: root }).trim()) {
    out.write(`Branch ${branch} already exists on origin; no new pull request.\n`);
    return 0;
  }
  command('git', ['fetch', '--quiet', 'origin', 'main'], { cwd: root });
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'shard-timings-wt-'));
  const tree = path.join(parent, 'tree');
  command('git', ['worktree', 'add', '--quiet', '-b', branch, tree, 'FETCH_HEAD'], { cwd: root });
  try {
    const discovered = shards.discoverTestFiles(tree);
    const plan = planRefresh(shards.loadManifest(tree), discovered, timingsFromSummaries(downloadSummaries(root, run.databaseId), discovered));
    for (const finding of plan.findings) out.write(`- ${finding}\n`);
    if (!plan.refresh) {
      out.write('No refresh trigger crossed on origin/main; no pull request.\n');
      command('git', ['worktree', 'remove', '--force', tree], { cwd: root });
      command('git', ['branch', '-D', branch], { cwd: root });
      return 0;
    }
    fs.writeFileSync(path.join(tree, ...shards.MANIFEST_REL.split('/')), manifestText(plan.manifest));
    command('git', ['add', shards.MANIFEST_REL], { cwd: tree });
    command('git', ['commit', '--quiet', '-m', `Refresh test shard timings from main run ${run.databaseId}`], { cwd: tree });
    command('git', ['push', '--quiet', '-u', 'origin', branch], { cwd: tree });
    const url = command('gh', ['pr', 'create', '--base', 'main', '--head', branch, '--title', 'Refresh test shard timings', '--body', prBody(run, plan)], { cwd: tree }).trim();
    out.write(`Opened ${url}\n`);
    command('git', ['worktree', 'remove', '--force', tree], { cwd: root });
    return 0;
  } finally {
    if (fs.existsSync(tree)) out.write(`The temporary worktree ${tree} was left for inspection; remove it with git worktree remove.\n`);
    else fs.rmSync(parent, { recursive: true, force: true });
  }
}

function main(argv = process.argv.slice(2), { root = shards.ROOT, out = process.stdout, err = process.stderr } = {}) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    err.write(`${error.message}\n${USAGE}\n`);
    return 2;
  }
  if (options.help) { out.write(`${USAGE}\n`); return 0; }
  try {
    const run = latestGreenRun(root, options.run);
    out.write(`Validate run ${run.databaseId} on ${run.headBranch} (${run.headSha.slice(0, 7)})\n`);
    if (options.openPr) {
      if (run.headBranch !== 'main') throw new Error('--open-pr reads main runs only');
      return openPr(root, run, out);
    }
    const discovered = shards.discoverTestFiles(root);
    const plan = planRefresh(shards.loadManifest(root), discovered, timingsFromSummaries(downloadSummaries(root, run.databaseId), discovered));
    for (const line of plan.lines) out.write(`${line}\n`);
    for (const finding of plan.findings) out.write(`- ${finding}\n`);
    if (!plan.refresh) out.write('No refresh trigger crossed.\n');
    else if (options.write) {
      fs.writeFileSync(path.join(root, ...shards.MANIFEST_REL.split('/')), manifestText(plan.manifest));
      out.write(`Updated ${shards.MANIFEST_REL}.\n`);
    } else out.write('A refresh trigger crossed; run again with --write or --open-pr to apply it.\n');
    return 0;
  } catch (error) {
    err.write(`Shard timing refresh could not run: ${error.message}\n`);
    return 2;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = Object.freeze({ IMBALANCE_RATIO, UNTIMED_SHARE, manifestText, parseArgs, planRefresh, rebalance, timingsFromSummaries });
