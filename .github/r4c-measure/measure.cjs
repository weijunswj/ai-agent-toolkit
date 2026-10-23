#!/usr/bin/env node
'use strict';

// Temporary R4c G0 measurement, not product code: times every test file on its own, then the whole
// suite as CI runs it, and prints one JSON summary. The G0 plan reads the summary from the job log.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const TEST_DIR = path.join(ROOT, 'repo', 'tests');
const PER_FILE_TIMEOUT_MS = 15 * 60 * 1000;

function counts(output) {
  const pick = (name) => {
    const match = output.match(new RegExp(`^# ${name} (\\d+)`, 'm'));
    return match ? Number(match[1]) : null;
  };
  return { tests: pick('tests'), pass: pick('pass'), fail: pick('fail'), skipped: pick('skipped'), cancelled: pick('cancelled') };
}

function run(args) {
  const started = process.hrtime.bigint();
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    timeout: PER_FILE_TIMEOUT_MS,
    windowsHide: true,
    env: { ...process.env, NODE_TEST_CONTEXT: undefined },
  });
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const failed = [...output.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1]).slice(0, 20);
  return { ms: Math.round(ms), status: result.status, signal: result.signal, timedOut: Boolean(result.error && result.error.code === 'ETIMEDOUT'), ...counts(output), failed };
}

const files = fs.readdirSync(TEST_DIR).filter((name) => name.endsWith('.test.cjs')).sort();
const perFile = [];
for (const name of files) {
  const entry = { file: name, ...run(['--test', '--test-reporter=tap', path.join('repo', 'tests', name)]) };
  perFile.push(entry);
  process.stdout.write(`R4C_FILE ${JSON.stringify(entry)}\n`);
}
const suite = run(['--test', '--test-reporter=tap', ...files.map((name) => path.join('repo', 'tests', name))]);
const summary = {
  platform: process.platform,
  node: process.version,
  cpus: os.availableParallelism(),
  memoryGb: Math.round(os.totalmem() / 1e9),
  serialSumMs: perFile.reduce((sum, entry) => sum + entry.ms, 0),
  suite,
};
process.stdout.write(`R4C_SUMMARY ${JSON.stringify(summary)}\n`);
