'use strict';

// Temporary check of the clock-ahead CI job, removed in the next commit: this test pins a date but
// reads the real clock, so it passes today and must fail in the tests-clock-ahead job.

const test = require('node:test');
const assert = require('node:assert/strict');

const STAMPED = Date.parse('2026-10-30T00:00:00Z');

test('an entry stamped with a pinned date still reads as under seven days old', () => {
  assert.ok((Date.now() - STAMPED) / (24 * 60 * 60 * 1000) < 7);
});
