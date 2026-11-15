'use strict';

// Closure matrix for toolkit-merge-train.cjs, rows 12 to 18; rows 1 to 11 and the table checks run in
// toolkit-merge-train-closure.test.cjs. The rows and why they matter: support/merge-train-closure-matrix.cjs.

const test = require('node:test');
const { fixture } = require('./support/merge-train-fixture.cjs');
const { MATRIX } = require('./support/merge-train-closure-matrix.cjs');

for (const entry of MATRIX.filter(row => row.run && row.row > 11)) {
  test(`row ${entry.row} (${entry.kind}, ${entry.expect}): ${entry.sequence}`, t => entry.run(fixture(t)));
}
