'use strict';

// node --test reporter for run-tests.cjs: one JSON line per test file summary (counts and time),
// plus one line for the whole run. A file that fails to load gets no file line, which is how
// run-tests.cjs and the CI verify step tell a load failure from a file with failing tests.

module.exports = async function* testSummaryReporter(source) {
  for await (const event of source) {
    if (event.type !== 'test:summary') continue;
    const { counts = {}, duration_ms: durationMs, file, success } = event.data || {};
    yield `${JSON.stringify({ file: file || null, counts, duration_ms: durationMs, success: success === true })}\n`;
  }
};
