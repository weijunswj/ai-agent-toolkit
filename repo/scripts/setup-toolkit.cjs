#!/usr/bin/env node
'use strict';

const core = require('./setup-toolkit-core.cjs');

async function main(argv = process.argv.slice(2)) {
  return core.main(argv);
}

if (require.main === module) {
  main()
    .then((code) => { process.exitCode = code; })
    .catch((error) => {
      if (/Setup question bank requires|must be one of|requires a path answer|requires a helper-count answer|require the exact approval answer|Selected helper setting remains unapplied/.test(error.message)) {
        process.exitCode = core.SETUP_PAUSED_FOR_QUESTION_BANK;
        console.error(`SETUP PAUSED: ${error.message}`);
        console.error('Question bank pause is intentional. Ask the user for the missing setup answers; do not rerun with --yes-recommended unless the user explicitly requested recommended defaults.');
      } else {
        process.exitCode = 1;
        console.error(`FAIL: ${error.message}`);
      }
    });
}

module.exports = { ...core, main };
