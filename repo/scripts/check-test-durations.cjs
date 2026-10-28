#!/usr/bin/env node
'use strict';

// Checks per-file test times against the repository's declared budget.
//
//   node repo/scripts/check-test-durations.cjs <report.json>...
//   node repo/scripts/check-test-durations.cjs --ci
//
// Each report is a run-tests.cjs --summary or --report-durations file. --ci reads every shard summary
// the validate job downloaded to $RUNNER_TEMP/test-summaries (the same folder run-tests.cjs
// --verify-ci checks), so CI fails a file over its budget. The budget lives in the
// shard manifest (repo/contracts/ci/test-shards.json) under `budgets`:
//
//   "budgets": {
//     "seconds_per_file": { "linux": 30, "windows": 60 },
//     "raised": { "windows:repo/tests/slow.test.cjs": { "seconds": 90, "reason": "why it needs longer" } }
//   }
//
// A file over its budget fails the check. A raised budget needs a reason. Without a budget for a
// system the check only reports the slowest files, so a repository can adopt it before it has
// measured enough to set one.

const fs = require('node:fs');
const path = require('node:path');
const shards = require('./ci-test-shards.cjs');

const CI_ARGUMENT = '--ci';
// The validate job's gate command; a local gate run has no shard summaries and leaves it out.
const CI_COMMAND = `node repo/scripts/check-test-durations.cjs ${CI_ARGUMENT}`;
const REPORT_SCHEMAS = new Set(['toolkit-test-durations/v1', shards.SUMMARY_SCHEMA]);

// { system, files: { file: seconds } } from either report shape.
function readReport(value) {
  if (!value || !REPORT_SCHEMAS.has(value.schema) || !shards.SYSTEMS.includes(value.system)) throw new Error('not a run-tests.cjs summary or duration report');
  if (value.schema === shards.SUMMARY_SCHEMA) return { system: value.system, files: Object.fromEntries(value.files.map((entry) => [entry.file, entry.seconds])) };
  return { system: value.system, files: { ...value.files } };
}

function budgetErrors(budgets) {
  if (budgets === undefined) return [];
  const errors = [];
  if (!budgets || typeof budgets !== 'object' || Array.isArray(budgets)) return ['budgets must be an object'];
  for (const [system, seconds] of Object.entries(budgets.seconds_per_file || {})) {
    if (!shards.SYSTEMS.includes(system)) errors.push(`budgets.seconds_per_file: unknown system ${system}`);
    if (typeof seconds !== 'number' || !(seconds > 0)) errors.push(`budgets.seconds_per_file.${system} must be a positive number`);
  }
  for (const [key, raise] of Object.entries(budgets.raised || {})) {
    const system = key.split(':')[0];
    if (!shards.SYSTEMS.includes(system) || !key.includes(':')) errors.push(`budgets.raised: ${key} must be <system>:<test file>`);
    if (!raise || typeof raise.seconds !== 'number' || !(raise.seconds > 0)) errors.push(`budgets.raised.${key} needs seconds`);
    if (!raise || typeof raise.reason !== 'string' || raise.reason.trim().length < 10) errors.push(`budgets.raised.${key} needs a recorded reason`);
  }
  return errors;
}

// The check over parsed reports. Returns { errors, lines } and never touches the file system.
function checkDurations(reports, budgets = {}) {
  const errors = budgetErrors(budgets);
  const lines = [];
  const perFile = (budgets && budgets.seconds_per_file) || {};
  const raised = (budgets && budgets.raised) || {};
  for (const report of reports) {
    const limit = perFile[report.system];
    const sorted = Object.entries(report.files).sort((a, b) => b[1] - a[1]);
    if (limit === undefined) {
      lines.push(`${report.system}: no budget set; slowest files: ${sorted.slice(0, 5).map(([file, seconds]) => `${path.posix.basename(file)} ${seconds} s`).join(', ')}`);
      continue;
    }
    for (const [file, seconds] of sorted) {
      const raise = raised[`${report.system}:${file}`];
      const allowed = raise ? raise.seconds : limit;
      if (seconds > allowed) errors.push(`${report.system}: ${file} took ${seconds} s, over its ${allowed} s budget${raise ? ' (raised)' : ''}`);
    }
    lines.push(`${report.system}: ${sorted.length} file(s) checked against ${limit} s per file`);
  }
  return { errors, lines };
}

// The shard summaries the validate job downloaded. No summary at all is an error, never a pass.
function ciReportFiles(env = process.env) {
  if (!env.RUNNER_TEMP) throw new Error('--ci needs RUNNER_TEMP, which only the CI runner sets');
  const dir = path.join(env.RUNNER_TEMP, 'test-summaries');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort().map((name) => path.join(dir, name)) : [];
  if (!files.length) throw new Error(`no shard summaries in ${dir}`);
  return files;
}

function main(argv = process.argv.slice(2), { root = shards.ROOT, out = process.stdout, err = process.stderr, env = process.env } = {}) {
  if (!argv.length || (argv.includes('--ci') && argv.length > 1)) {
    err.write(`Usage: node repo/scripts/check-test-durations.cjs <report.json>... | ${CI_ARGUMENT}\n`);
    return 2;
  }
  let files = argv;
  if (argv[0] === CI_ARGUMENT) {
    try { files = ciReportFiles(env); }
    catch (error) {
      err.write(`Test duration check could not run: ${error.message}\n`);
      return 2;
    }
  }
  const reports = files.map((file) => readReport(JSON.parse(fs.readFileSync(file, 'utf8'))));
  const { errors, lines } = checkDurations(reports, shards.loadManifest(root).budgets);
  for (const line of lines) out.write(`${line}\n`);
  if (errors.length) {
    err.write(`Test duration check failed:\n- ${errors.join('\n- ')}\n`);
    return 1;
  }
  out.write('Test duration check passed.\n');
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = Object.freeze({ CI_COMMAND, checkDurations, ciReportFiles, main, readReport });
