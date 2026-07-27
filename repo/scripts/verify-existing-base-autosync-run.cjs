#!/usr/bin/env node
'use strict';

const fs = require('node:fs');

function fail(code) {
  process.stderr.write(code + '\n');
  process.exit(2);
}

function main() {
  if (process.argv.length !== 4 || process.argv[2] !== '--input') fail('BASE_RUN_ARGUMENTS');
  let evidence;
  try {
    evidence = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  } catch {
    fail('BASE_RUN_INPUT');
  }
  const sha = /^[0-9a-f]{40}$/;
  if (evidence.pr_number !== 310 || !sha.test(evidence.h0) || !sha.test(evidence.h1) ||
      evidence.remote_head !== evidence.h1 || evidence.event !== 'pull_request_target' ||
      evidence.action !== 'synchronize' || evidence.event_head !== evidence.h1 ||
      evidence.run_count !== 1 || evidence.conclusion !== 'success') fail('BASE_RUN_AUTHORITY');
  const expected = {
    'Preflight guard': 'success',
    'Checkout trusted base revision': 'skipped',
    'Checkout PR head commit': 'skipped',
    'Commit generated surfaces': 'skipped',
    'Push generated surfaces': 'skipped'
  };
  for (const [name, conclusion] of Object.entries(expected)) {
    if (!evidence.steps || evidence.steps[name] !== conclusion) fail('BASE_RUN_STEP');
  }
  if (evidence.commit_attempts !== 0 || evidence.push_attempts !== 0 ||
      evidence.remote_head_after !== evidence.h1 || evidence.unexplained_commits !== 0) fail('BASE_RUN_WRITE');
  process.stdout.write(JSON.stringify({ protocol_version: 1, verified: true, head: evidence.h1 }) + '\n');
}

main();
