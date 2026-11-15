'use strict';

// Closure matrix for toolkit-merge-train.cjs, rows 1 to 11 and the table checks; rows 12 to 18 run in
// toolkit-merge-train-closure-late.test.cjs. The rows and why they matter: support/merge-train-closure-matrix.cjs.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { fixture } = require('./support/merge-train-fixture.cjs');
const { MATRIX } = require('./support/merge-train-closure-matrix.cjs');

test('the closure matrix lists rows 1 to 18 once each', () => {
  assert.deepEqual(MATRIX.map(entry => entry.row), Array.from({ length: 18 }, (_, index) => index + 1));
  for (const entry of MATRIX) assert.equal(Boolean(entry.run) + Boolean(entry.elsewhere) + Boolean(entry.later), 1, `row ${entry.row} has one home`);
});

test('rows run elsewhere name a test that exists', () => {
  for (const { row, elsewhere } of MATRIX.filter(entry => entry.elsewhere)) {
    const [file, title] = elsewhere;
    assert.ok(fs.readFileSync(path.join(__dirname, file), 'utf8').includes(`test('${title.replaceAll("'", "\\'")}'`), `row ${row}: ${file} has no test "${title}"`);
  }
});

for (const entry of MATRIX.filter(row => row.run && row.row <= 11)) {
  test(`row ${entry.row} (${entry.kind}, ${entry.expect}): ${entry.sequence}`, t => entry.run(fixture(t)));
}
