'use strict';

// Test-only preload for the clock-ahead run (run-tests.cjs --clock-ahead): moves Date and Date.now in
// this process forward by TOOLKIT_TEST_CLOCK_OFFSET_DAYS whole days. Date() called without new, new
// Date() with no argument and Date.now() read the moved clock; a date built from a value, Date.parse
// and Date.UTC are unchanged. File times, git dates and other processes keep the real clock. A child
// process that inherits NODE_OPTIONS and the variable moves too; one started with an environment
// that drops the variable keeps the real clock. The runner adds it to the test processes only,
// never to itself.

const RealDate = Date;
const raw = process.env.TOOLKIT_TEST_CLOCK_OFFSET_DAYS;
if (raw !== undefined && !/^[1-9][0-9]{0,3}$/.test(raw)) {
  throw new Error(`TOOLKIT_TEST_CLOCK_OFFSET_DAYS must be a whole number of days from 1 to 9999 (got ${JSON.stringify(raw)}).`);
}
if (raw !== undefined) {
  const offsetMs = Number(raw) * 24 * 60 * 60 * 1000;
  const movedNow = () => RealDate.now() + offsetMs;
  const MovedDate = function Date(...args) {
    if (!new.target) return new RealDate(movedNow()).toString();
    return Reflect.construct(RealDate, args.length ? args : [movedNow()], new.target);
  };
  Object.setPrototypeOf(MovedDate, RealDate);
  Object.defineProperty(MovedDate, 'prototype', { value: RealDate.prototype });
  Object.defineProperty(MovedDate, 'length', { value: RealDate.length });
  MovedDate.now = movedNow;
  globalThis.Date = MovedDate;
}
