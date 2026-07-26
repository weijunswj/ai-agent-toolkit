'use strict';

const assert = require('node:assert/strict');

function tupleToString(f) {
  return f.code + '|' + f.severity + '|' + f.group + '|' + (f.subject || '@') + '|' + f.message_key;
}

function assertExactTuples(actualFindings, expectedTuples) {
  var actual = actualFindings.map(tupleToString).sort();
  var expected = expectedTuples.map(tupleToString).sort();

  if (actual.length !== expected.length) {
    throw new assert.AssertionError({
      message: 'Tuple cardinality mismatch: expected ' + expected.length + ', found ' + actual.length + '.\nExpected: ' + JSON.stringify(expected) + '\nActual:   ' + JSON.stringify(actual),
      actual: actual.length,
      expected: expected.length
    });
  }

  for (var i = 0; i < actual.length; i++) {
    if (actual[i] !== expected[i]) {
      throw new assert.AssertionError({
        message: 'Tuple mismatch at position ' + i + ':\n  Expected: ' + expected[i] + '\n  Found:    ' + actual[i],
        actual: actual[i],
        expected: expected[i]
      });
    }
  }
}

module.exports = { assertExactTuples, tupleToString };
