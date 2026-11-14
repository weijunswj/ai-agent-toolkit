#!/usr/bin/env node
'use strict';

// Refreshes the measured per-file test times in the shard manifest (repo/contracts/ci/test-shards.json)
// from the test summaries of the latest green Validate run on main. It makes no model calls.
//
//   node repo/scripts/refresh-shard-timings.cjs [--repo-root <checkout>] [--run <id>] [--write | --open-pr]
// --repo-root selects another repository using the same shard manifest and Validate summary contract.
//
// Without a flag it only reports. Each shard job already uploads its run-tests.cjs summary (per-file
// seconds) as a test-summary-<shard>-attempt-<n>-<commit> artifact, so this reads those through read-only `gh` and changes
// nothing. --run <id> reads that finished Validate run instead, for example a pull request's run
// that measured a new or split test file. It reports the refresh triggers it checks:
//   - more than 10% of test files have no measured time;
//   - with the fresh times, the slowest shard is over 1.5x its fastest on Linux, 1.3x on Windows;
//   - a file is over its per-file budget (budgets in the manifest). Refreshing cannot fix this: the
//     report says to split or speed up that file.
// --write updates the manifest in this checkout when the first two triggers fire: durations from
// the run and, when the shards are out of balance, files moved between the named shards (the rest
// shard keeps every file no named shard lists). --open-pr does the same on a new branch from
// origin/main in a temporary worktree, pushes it and opens a pull request; with no trigger crossed
// it opens nothing. While an earlier refresh pull request is open it opens no second one, and one
// open for over 7 days fails the run naming it: merge or close it.
// --fail-if-due makes a report run fail when a refresh trigger crossed, for a run that cannot
// publish (no governance App), so the drift does not repeat as a green report forever.
//
// A governed repository's shard list (.github/toolkit-test-shards.json, schema v2, see
// governed-test-shards.cjs) is refreshed the same way when --repo-root names a checkout that has one:
// the run summaries come from the workflow the list names (`workflow`, default
// toolkit-test-shards.yml), each system the list names gets its own discovered files, and the
// durations and the named shards are written back to that list. Without a v2 list the Toolkit's own
// v1 manifest and its Validate runs are used, exactly as before.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const shards = require('./ci-test-shards.cjs');
const governed = require('./governed-test-shards.cjs');

const WORKFLOW_FILE = 'validate.yml';
const ARTIFACT_PATTERN = 'test-summary-*';
const UNTIMED_SHARE = 0.1;
const IMBALANCE_RATIO = Object.freeze({ linux: 1.5, windows: 1.3 });
const CONCURRENCY = 3; // run-tests.cjs default; node --test runs three files at a time per shard
const STALE_PR_DAYS = 7;
// What the refresh reads and writes: the Toolkit's v1 manifest and its Validate runs, or a governed
// repository's v2 list and the workflow it names. `discover` gives the discovered files, which
// `filesFor` splits by system (v1 discovers one list for both systems).
const V1 = Object.freeze({
  kind: 'v1',
  manifestRel: shards.MANIFEST_REL,
  workflowFile: WORKFLOW_FILE,
  workflowName: 'Validate',
  load: (root) => shards.loadManifest(root),
  discover: (root) => shards.discoverTestFiles(root),
  systems: () => shards.SYSTEMS,
  filesFor: (discovered) => discovered,
  systemShards: (manifest, system, discovered) => shards.systemShards(manifest, system, discovered),
  assert: (manifest, discovered) => shards.assertManifest(manifest, discovered),
  budget: (budgets, system, file) => {
    const limit = (budgets.seconds_per_file || {})[system];
    if (limit === undefined) return undefined;
    const raise = (budgets.raised || {})[`${system}:${file}`];
    return raise ? raise.seconds : limit;
  },
});

// The name: line of a workflow file, or null.
function workflowNameOf(text) {
  const match = /^name:\s*(['"]?)([^'"\n]{1,80})\1\s*$/m.exec(String(text).replace(/\r\n/g, '\n'));
  return match ? match[2].trim() : null;
}

function v2Profile(root) {
  const manifest = governed.loadManifest(root);
  const workflowFile = typeof manifest.workflow === 'string' ? manifest.workflow : governed.DEFAULT_WORKFLOW;
  let text = null;
  try { text = fs.readFileSync(path.join(root, '.github', 'workflows', workflowFile), 'utf8'); } catch { /* reported below */ }
  const workflowName = text === null ? null : workflowNameOf(text);
  if (!workflowName) throw new Error(`.github/workflows/${workflowFile}, the workflow the shard list names, is missing or has no name: line`);
  return Object.freeze({
    kind: 'v2',
    manifestRel: governed.MANIFEST_REL,
    workflowFile,
    workflowName,
    load: (dir) => governed.loadManifest(dir),
    discover: (dir) => governed.discoverAll(dir, governed.loadManifest(dir)),
    systems: (list) => Object.keys(list.systems),
    filesFor: (discovered, system) => discovered[system] || [],
    systemShards: (list, system, discovered) => list.systems[system].shards.map((shard) => ({ id: shard.id, files: governed.resolveShard(list, system, shard.id, discovered) })),
    assert: (list, discovered) => governed.assertManifest(list, discovered),
    // A v2 list keeps budgets by system: { linux: { seconds_per_file, raised: { <file>: { seconds } } } }.
    budget: (budgets, system, file) => {
      const table = budgets[system] || {};
      if (typeof table.seconds_per_file !== 'number') return undefined;
      const raise = (table.raised || {})[file];
      return raise && typeof raise.seconds === 'number' ? raise.seconds : table.seconds_per_file;
    },
  });
}

// The v2 profile when `root` has a governed shard list, otherwise the Toolkit's own v1.
function profileFor(root) {
  return fs.existsSync(path.join(root, ...governed.MANIFEST_REL.split('/'))) ? v2Profile(root) : V1;
}

const USAGE = 'Usage: node repo/scripts/refresh-shard-timings.cjs [--repo-root <checkout>] [--run <id>] [--write | --open-pr | --fail-if-due]\nBalance trigger: over 1.5x on Linux, over 1.3x on Windows.';

class UsageError extends Error {}

function parseArgs(argv) {
  const options = { run: null, write: false, openPr: false, failIfDue: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--write') options.write = true;
    else if (arg === '--open-pr') options.openPr = true;
    else if (arg === '--fail-if-due') options.failIfDue = true;
    else if (arg === '--repo-root') {
      const value = argv[index += 1];
      if (!value || !path.isAbsolute(value)) throw new UsageError('--repo-root needs an absolute checkout path');
      options.root = value;
    }
    else if (arg === '--run') {
      const value = argv[index += 1];
      if (!/^[0-9]+$/.test(value || '')) throw new UsageError('--run needs a numeric run id');
      options.run = value;
    } else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new UsageError(`Unknown argument: ${arg}`);
  }
  if ([options.write, options.openPr, options.failIfDue].filter(Boolean).length > 1) throw new UsageError('Use one of --write, --open-pr or --fail-if-due');
  return options;
}

// Per-file seconds by system from run-tests.cjs summaries, keeping only discovered test files. A
// failed shard also uploads its summary; its times come from a failing run, so they are left out.
// `discovered` is one list (v1) or a list per system (v2). Command mode summaries (a governed
// repository's shards, one test per file) carry per-file seconds the same way.
function timingsFromSummaries(summaries, discovered) {
  const knownBySystem = Object.fromEntries(shards.SYSTEMS.map((system) => [system, new Set(Array.isArray(discovered) ? discovered : (discovered[system] || []))]));
  const result = Object.fromEntries(shards.SYSTEMS.map((system) => [system, {}]));
  for (const summary of summaries) {
    if (!summary || summary.schema !== shards.SUMMARY_SCHEMA || !shards.SYSTEMS.includes(summary.system) || !Array.isArray(summary.files)) {
      throw new Error(`a downloaded summary is not a ${shards.SUMMARY_SCHEMA} file`);
    }
    if (summary.exit_code !== 0) continue;
    const known = knownBySystem[summary.system];
    for (const entry of summary.files) {
      if (known.has(entry.file) && typeof entry.seconds === 'number' && Number.isFinite(entry.seconds) && entry.seconds >= 0) {
        result[summary.system][entry.file] = Math.round(entry.seconds * 10) / 10;
      }
    }
  }
  return result;
}

function shardEstimates(manifest, system, discovered, durations, profile = V1) {
  return profile.systemShards(manifest, system, discovered)
    .map(({ id, files }) => ({ id, seconds: Math.round(shards.estimateShardSeconds(files, durations, CONCURRENCY) * 10) / 10 }));
}

function imbalance(estimates) {
  const values = estimates.map((item) => item.seconds);
  const fastest = Math.min(...values);
  return fastest > 0 ? Math.max(...values) / fastest : (Math.max(...values) > 0 ? Infinity : 1);
}

// Moves files between a system's shards so their estimated times are close: longest files first,
// each to the shard that would finish soonest with it. Shard ids and the rest shard stay.
function rebalance(manifest, system, discovered, durations, profile = V1) {
  const list = manifest.systems[system].shards;
  const buckets = list.map(() => []);
  const ordered = shards.runOrder(profile.filesFor(discovered, system), durations);
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
function planRefresh(manifest, discovered, fresh, profile = V1) {
  const findings = [];
  const lines = [];
  const next = JSON.parse(JSON.stringify(manifest));
  const budgets = manifest.budgets || {};
  let refresh = false;
  for (const system of profile.systems(manifest)) {
    const recorded = (manifest.durations_seconds || {})[system] || {};
    const measured = fresh[system] || {};
    const files = profile.filesFor(discovered, system);
    const untimed = files.filter((file) => typeof recorded[file] !== 'number');
    if (untimed.length > files.length * UNTIMED_SHARE) {
      refresh = true;
      findings.push(`${system}: ${untimed.length} of ${files.length} test files have no recorded time`);
    }
    const missing = files.filter((file) => typeof measured[file] !== 'number');
    if (missing.length) lines.push(`${system}: the run has no time for ${missing.length} file(s); a recorded time is kept where there is one`);
    const merged = {};
    for (const file of files) {
      if (typeof measured[file] === 'number') merged[file] = measured[file];
      else if (typeof recorded[file] === 'number') merged[file] = recorded[file];
    }
    next.durations_seconds = next.durations_seconds || {};
    next.durations_seconds[system] = merged;
    const estimates = shardEstimates(manifest, system, discovered, merged, profile);
    const ratio = imbalance(estimates);
    lines.push(`${system}: estimated shard seconds ${estimates.map((item) => `${item.id} ${item.seconds}`).join(', ')}`);
    if (ratio > IMBALANCE_RATIO[system]) {
      refresh = true;
      next.systems[system].shards = rebalance(manifest, system, discovered, merged, profile);
      const after = shardEstimates(next, system, discovered, merged, profile);
      findings.push(`${system}: slowest shard is ${ratio.toFixed(2)}x the fastest (over ${IMBALANCE_RATIO[system]}x); rebalanced to ${after.map((item) => `${item.id} ${item.seconds}`).join(', ')}`);
    }
    for (const [file, seconds] of Object.entries(measured)) {
      const allowed = profile.budget(budgets, system, file);
      if (allowed !== undefined) {
        if (seconds > allowed) findings.push(`${system}: ${file} took ${seconds} s, over its ${allowed} s budget; split it by area or make it faster (refreshing does not fix this)`);
      }
    }
  }
  if (refresh) profile.assert(next, discovered);
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

// Cleanup must preserve the primary result even when Git cannot start or delete the ref.
function gitCommand(root, args) {
  try {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
    return { ok: !result.error && result.status === 0 };
  } catch {
    return { ok: false };
  }
}

function latestGreenRun(root, run, profile = V1) {
  const fields = 'databaseId,headSha,conclusion,headBranch,workflowName';
  if (run) {
    // A named run may have failed, for example on a file over its budget or a failed shard. Only the
    // summaries of shards whose tests passed are read (timingsFromSummaries), so every time is from a passing run.
    const value = JSON.parse(command('gh', ['run', 'view', run, '--json', fields], { cwd: root }));
    if (!value.conclusion || value.workflowName !== profile.workflowName) throw new Error(`run ${run} is not a finished ${profile.workflowName} run`);
    return value;
  }
  const list = JSON.parse(command('gh', ['run', 'list', '--workflow', profile.workflowFile, '--branch', 'main', '--event', 'push', '--status', 'success', '--limit', '1', '--json', fields], { cwd: root }));
  if (!list.length) throw new Error(`no successful ${profile.workflowFile} run on main was found`);
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

function prBody(run, plan, profile = V1) {
  return [
    `Refreshes the measured test times in \`${profile.manifestRel}\` from the test summaries of ${profile.workflowName} run ${run.databaseId} on main (${run.headSha.slice(0, 7)}).`,
    '',
    'Triggers crossed:',
    ...plan.findings.map((finding) => `- ${finding}`),
    '',
    'Made by `node <Toolkit>/repo/scripts/refresh-shard-timings.cjs --repo-root <checkout> --open-pr`, which makes no model calls. Only the shard manifest changes; no test is added, removed or skipped.',
    '',
    'This is a generated candidate. Required route and evidence:',
    '- G0: pending checks of the source run, trigger and unchanged budgets.',
    '- A fresh G1: pending verification and recorded classifier tier, currently RISKY for the shard manifest.',
    '- Agent UAT: pending exact-head CI coverage on Linux and Windows.',
    '- Owner UAT: NOT_REQUIRED for manifest-only redistribution because both CI systems exercise the entire changed surface.',
    '- Full G2: pending before merge.',
    'Budget or generator changes need their own impact assessment.',
  ].join('\n');
}

// The open pull requests a previous refresh made (branch toolkit/shard-timings-<sha>): while one is
// open, a scheduled run opens no second one.
const REFRESH_BRANCH_PREFIX = 'toolkit/shard-timings-';
function openRefreshPrs(root) {
  const open = JSON.parse(command('gh', ['pr', 'list', '--state', 'open', '--base', 'main', '--limit', '100', '--json', 'number,headRefName,createdAt'], { cwd: root }));
  return open.filter(pr => typeof pr.headRefName === 'string' && pr.headRefName.startsWith(REFRESH_BRANCH_PREFIX));
}

// On GitHub the workflow reads runs with its built-in token and publishes with the governance App's
// token, given as TOOLKIT_SHARD_PUBLISH_TOKEN. The push and the pull request then use that token, the
// push through an environment-only git header (never a command-line argument or a saved config).
function publishEnv(env = process.env) {
  const token = env.TOOLKIT_SHARD_PUBLISH_TOKEN;
  if (!token) return undefined;
  const index = Number.parseInt(env.GIT_CONFIG_COUNT || '0', 10) || 0;
  const basic = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64');
  const out = { ...env, GH_TOKEN: token, GIT_CONFIG_COUNT: String(index + 1),
    [`GIT_CONFIG_KEY_${index}`]: 'http.https://github.com/.extraheader', [`GIT_CONFIG_VALUE_${index}`]: `AUTHORIZATION: basic ${basic}` };
  delete out.TOOLKIT_SHARD_PUBLISH_TOKEN;
  delete out.GITHUB_TOKEN;
  return out;
}

function openPr(root, run, out, profile = V1) {
  const branch = `toolkit/shard-timings-${run.headSha.slice(0, 7)}`;
  if (command('git', ['ls-remote', '--heads', 'origin', branch], { cwd: root }).trim()) {
    out.write(`Branch ${branch} already exists on origin; no new pull request.\n`);
    return 0;
  }
  const fetchRef = `refs/toolkit/fetch/${process.pid}-${randomBytes(12).toString('hex')}`;
  let parent;
  let tree;
  try {
    command('git', ['fetch', '--quiet', '--no-tags', 'origin', `main:${fetchRef}`], { cwd: root });
    const fetchedCommit = command('git', ['rev-parse', `${fetchRef}^{commit}`], { cwd: root }).trim();
    parent = fs.mkdtempSync(path.join(os.tmpdir(), 'shard-timings-wt-'));
    tree = path.join(parent, 'tree');
    command('git', ['worktree', 'add', '--quiet', '-b', branch, tree, fetchedCommit], { cwd: root });
    const discovered = profile.discover(tree);
    const plan = planRefresh(profile.load(tree), discovered, timingsFromSummaries(downloadSummaries(root, run.databaseId), discovered), profile);
    for (const finding of plan.findings) out.write(`- ${finding}\n`);
    if (!plan.refresh) {
      out.write('No refresh trigger crossed on origin/main; no pull request.\n');
      command('git', ['worktree', 'remove', '--force', tree], { cwd: root });
      command('git', ['branch', '-D', branch], { cwd: root });
      return 0;
    }
    fs.writeFileSync(path.join(tree, ...profile.manifestRel.split('/')), manifestText(plan.manifest));
    command('git', ['add', profile.manifestRel], { cwd: tree });
    command('git', ['commit', '--quiet', '-m', `Refresh test shard timings from main run ${run.databaseId}`], { cwd: tree });
    const env = publishEnv();
    command('git', ['push', '--quiet', '-u', 'origin', branch], { cwd: tree, ...(env ? { env } : {}) });
    const url = command('gh', ['pr', 'create', '--base', 'main', '--head', branch, '--title', 'Refresh test shard timings', '--body', prBody(run, plan, profile)], { cwd: tree, ...(env ? { env } : {}) }).trim();
    out.write(`Opened ${url}\n`);
    command('git', ['worktree', 'remove', '--force', tree], { cwd: root });
    return 0;
  } finally {
    try {
      const cleanup = gitCommand(root, ['update-ref', '-d', fetchRef]);
      if (!cleanup.ok) out.write(`Warning: could not remove owned fetch ref ${fetchRef}; it may remain.\n`);
    } finally {
      if (tree && fs.existsSync(tree)) out.write(`The temporary worktree ${tree} was left for inspection; remove it with git worktree remove.\n`);
      else if (parent) fs.rmSync(parent, { recursive: true, force: true });
    }
  }
}

function main(argv = process.argv.slice(2), { root = shards.ROOT, out = process.stdout, err = process.stderr, readRun = latestGreenRun, readSummaries = downloadSummaries, publish = openPr, findOpen = openRefreshPrs, now = Date.now() } = {}) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    err.write(`${error.message}\n${USAGE}\n`);
    return 2;
  }
  if (options.help) { out.write(`${USAGE}\n`); return 0; }
  root = options.root || root;
  try {
    const profile = profileFor(root);
    const run = readRun(root, options.run, profile);
    out.write(`${profile.workflowName} run ${run.databaseId} on ${run.headBranch} (${run.headSha.slice(0, 7)})\n`);
    if (options.openPr) {
      if (run.headBranch !== 'main') throw new Error('--open-pr reads main runs only');
      const open = findOpen(root);
      if (open.length) {
        out.write(`A shard timing pull request is already open (#${open.map(pr => pr.number).join(', #')}); no new pull request.\n`);
        const stale = open.filter(pr => now - Date.parse(pr.createdAt || '') > STALE_PR_DAYS * 86400000);
        if (stale.length) {
          err.write(`Shard timing pull request${stale.length > 1 ? 's' : ''} open over ${STALE_PR_DAYS} days: ${stale.map(pr => `#${pr.number} (open since ${String(pr.createdAt).slice(0, 10)})`).join(', ')}. Owner or controller: merge or close ${stale.length > 1 ? 'them' : 'it'}; the next run then opens a fresh refresh.\n`);
          return 1;
        }
        return 0;
      }
      return publish(root, run, out, profile);
    }
    const discovered = profile.discover(root);
    const plan = planRefresh(profile.load(root), discovered, timingsFromSummaries(readSummaries(root, run.databaseId), discovered), profile);
    for (const line of plan.lines) out.write(`${line}\n`);
    for (const finding of plan.findings) out.write(`- ${finding}\n`);
    if (!plan.refresh) out.write('No refresh trigger crossed.\n');
    else if (options.write) {
      fs.writeFileSync(path.join(root, ...profile.manifestRel.split('/')), manifestText(plan.manifest));
      out.write(`Updated ${profile.manifestRel}.\n`);
    } else if (options.failIfDue) {
      err.write(`A refresh trigger crossed and this run cannot publish. Owner: set up the governance App (TOOLKIT_GOVERNANCE_APP_CLIENT_ID and TOOLKIT_GOVERNANCE_APP_PRIVATE_KEY) so the daily run opens the pull request, or run node ${profile.kind === 'v1' ? 'repo/scripts/refresh-shard-timings.cjs --write' : '<Toolkit>/repo/scripts/refresh-shard-timings.cjs --repo-root <checkout> --write'} and open the pull request by hand.\n`);
      return 1;
    } else out.write('A refresh trigger crossed; run again with --write or --open-pr to apply it.\n');
    return 0;
  } catch (error) {
    err.write(`Shard timing refresh could not run: ${error.message}\n`);
    return 2;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = Object.freeze({ V1, profileFor, STALE_PR_DAYS, IMBALANCE_RATIO, UNTIMED_SHARE, REFRESH_BRANCH_PREFIX, main, manifestText, parseArgs, planRefresh, publishEnv, rebalance, timingsFromSummaries });
