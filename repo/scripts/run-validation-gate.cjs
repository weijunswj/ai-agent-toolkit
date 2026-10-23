#!/usr/bin/env node
'use strict';

// The full validation gate has one list: the "Run validation" step of .github/workflows/validate.yml,
// which CI runs on every pull request and push to main. `npm run validate:all` runs the same commands,
// in the same order, from that step, stopping at the first failure. In CI the last command checks the
// summaries of the test shards that ran before it; locally there are no shards, so the gate runs every
// test file there instead (repo/scripts/run-tests.cjs --all).

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'validate.yml');
const STEP_NAME = 'Run validation';
const { VERIFY_COMMAND } = require('./ci-test-shards.cjs');
const LOCAL_TESTS = 'node repo/scripts/run-tests.cjs --all';

// The gate as a local run executes it.
function localCommands(commands) {
  return commands.map((command) => (command === VERIFY_COMMAND ? LOCAL_TESTS : command));
}

// The commands of the named step's `run: |` block, one per line.
function gateCommands(source, stepName = STEP_NAME) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((line) => line === `      - name: ${stepName}`);
  if (start === -1) throw new Error(`validate.yml has no "${stepName}" step.`);
  const run = lines.findIndex((line, index) => index > start && /^ {8}run: \|\s*$/.test(line));
  const nextStep = lines.findIndex((line, index) => index > start && /^ {6}- /.test(line));
  if (run === -1 || (nextStep !== -1 && run > nextStep)) throw new Error(`The "${stepName}" step has no multi-line run block.`);
  const commands = [];
  for (let index = run + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === '') continue;
    if (!/^ {10}\S/.test(line)) break;
    commands.push(line.trim());
  }
  if (!commands.length) throw new Error(`The "${stepName}" step lists no commands.`);
  return commands;
}

function main() {
  const commands = localCommands(gateCommands(fs.readFileSync(WORKFLOW, 'utf8')));
  for (const command of commands) {
    process.stdout.write(`\n> ${command}\n`);
    // The commands come from the repository's own workflow file, run in the repository root.
    const result = spawnSync(command, { cwd: ROOT, shell: true, stdio: 'inherit', windowsHide: true });
    if (result.status !== 0) {
      process.stderr.write(`Validation gate stopped: "${command}" failed.\n`);
      return result.status === null ? 1 : result.status;
    }
  }
  process.stdout.write(`\nValidation gate passed: ${commands.length} commands.\n`);
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = Object.freeze({ LOCAL_TESTS, gateCommands, localCommands, main });
