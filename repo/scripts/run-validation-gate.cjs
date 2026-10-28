#!/usr/bin/env node
'use strict';

// The full validation gate has one list: the "Run validation" step of .github/workflows/validate.yml,
// which CI runs on every pull request and push to main. `npm run validate:all` runs the same commands,
// in the same order, from that step, stopping at the first failure. In CI the last command checks the
// summaries of the test shards that ran before it; locally there are no shards, so the gate runs every
// test file there instead (repo/scripts/run-tests.cjs --all). The per-file time budget check also
// reads those CI summaries, and local times are not CI times, so a local run leaves it out and says so.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'validate.yml');
const { VERIFY_COMMAND, gateCommands } = require('./ci-test-shards.cjs');
const { CI_COMMAND: DURATIONS_COMMAND } = require('./check-test-durations.cjs');
const LOCAL_TESTS = 'node repo/scripts/run-tests.cjs --all';

// The gate as a local run executes it.
function localCommands(commands) {
  return commands
    .filter((command) => command !== DURATIONS_COMMAND)
    .map((command) => (command === VERIFY_COMMAND ? LOCAL_TESTS : command));
}

function main() {
  const gate = gateCommands(fs.readFileSync(WORKFLOW, 'utf8'));
  const commands = localCommands(gate);
  if (gate.includes(DURATIONS_COMMAND)) process.stdout.write(`Left out locally: "${DURATIONS_COMMAND}" checks the CI shard summaries; CI runs it.\n`);
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

module.exports = Object.freeze({ DURATIONS_COMMAND, LOCAL_TESTS, gateCommands, localCommands, main });
