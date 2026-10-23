#!/usr/bin/env node
'use strict';

// Temporary R4c G0 measurement, not product code. With no arguments it times every test file on its
// own, then the whole suite as CI runs it, and prints one JSON summary. With `--detail <files>` it
// runs the named files one at a time and prints their slowest tests and every failure's diagnostics.

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
  });
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const failed = [...output.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1]).slice(0, 20);
  return { ms: Math.round(ms), status: result.status, signal: result.signal, timedOut: Boolean(result.error && result.error.code === 'ETIMEDOUT'), ...counts(output), failed, output };
}

// Top-level test names with their durations, and the diagnostic block under each failure.
function detail(output) {
  const lines = output.split(/\r?\n/);
  const tests = [];
  const failures = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^(ok|not ok) \d+ - (.+?)(?: # .*)?$/);
    if (!m) continue;
    let ms = null;
    const block = [];
    for (let j = i + 1; j < lines.length && !/^(ok|not ok) \d+ - |^# Subtest: /.test(lines[j]); j += 1) {
      const d = lines[j].match(/^\s{2}duration_ms: ([\d.]+)/);
      if (d && ms === null) ms = Number(d[1]);
      if (m[1] === 'not ok' && block.length < 45) block.push(lines[j]);
    }
    tests.push({ name: m[2], ms });
    if (m[1] === 'not ok') failures.push({ name: m[2], block: block.join('\n') });
  }
  tests.sort((a, b) => (b.ms || 0) - (a.ms || 0));
  return { slowest: tests.slice(0, 15), failures };
}

const detailIndex = process.argv.indexOf('--detail');
if (detailIndex !== -1) {
  const names = process.argv[detailIndex + 1].split(',');
  for (const name of names) {
    const result = run(['--test', '--test-reporter=tap', path.join('repo', 'tests', name)]);
    const { slowest, failures } = detail(result.output);
    process.stdout.write(`\n===== ${name}: ${result.ms} ms, status ${result.status}, tests ${result.tests}, fail ${result.fail}\n`);
    for (const t of slowest) process.stdout.write(`  ${String(Math.round(t.ms || 0)).padStart(7)} ms  ${t.name}\n`);
    for (const f of failures.slice(0, 4)) process.stdout.write(`  --- FAIL ${f.name}\n${f.block}\n`);
  }
  process.exit(0);
}

const files = fs.readdirSync(TEST_DIR).filter((name) => name.endsWith('.test.cjs')).sort();
const perFile = [];
for (const name of files) {
  const { output, ...entry } = { file: name, ...run(['--test', '--test-reporter=tap', path.join('repo', 'tests', name)]) };
  perFile.push(entry);
  process.stdout.write(`R4C_FILE ${JSON.stringify(entry)}\n`);
}
const { output, ...suite } = run(['--test', '--test-reporter=tap', ...files.map((name) => path.join('repo', 'tests', name))]);
const summary = {
  platform: process.platform,
  node: process.version,
  cpus: os.availableParallelism(),
  memoryGb: Math.round(os.totalmem() / 1e9),
  serialSumMs: perFile.reduce((sum, entry) => sum + entry.ms, 0),
  suite,
};
process.stdout.write(`R4C_SUMMARY ${JSON.stringify(summary)}\n`);
