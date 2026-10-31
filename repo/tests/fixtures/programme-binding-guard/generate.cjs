#!/usr/bin/env node
'use strict';

// Records the binding guard answers of one copy of programme-state.cjs:
//   node generate.cjs <path to programme-state.cjs> [<sha it was taken from>]
// It prints the JSON that expected-<sha>.json holds. To check the recorded file, run it against the
// bound main (git show <sha>:<path> > a scratch copy beside its own scripts) and compare.

const path = require('node:path');
const { evaluate } = require('./cases.cjs');

const target = process.argv[2];
if (!target) {
  console.error('Usage: node generate.cjs <path to programme-state.cjs> [<sha>]');
  process.exit(2);
}
const state = require(path.resolve(target));
process.stdout.write(`${JSON.stringify({ recorded_from: process.argv[3] || null, results: evaluate(state) }, null, 2)}\n`);
