'use strict';

// node --test reporter for run-tests.cjs: one JSON line per test file summary (counts and time),
// plus one line for the whole run. A file that fails to load gets no file line, which is how
// run-tests.cjs and the CI verify step tell a load failure from a file with failing tests.
// Each skipped or todo test (or suite) also gets a line naming it, so the CI check can hold every
// skip to the list in repo/contracts/ci/test-skips.json.

module.exports = async function* testSummaryReporter(source) {
  for await (const event of source) {
    if (event.type === 'test:pass' || event.type === 'test:fail') {
      const { file, name, skip, todo } = event.data || {};
      const kind = todo !== undefined && todo !== false ? 'todo' : skip !== undefined && skip !== false ? 'skip' : '';
      if (kind) yield `${JSON.stringify({ skipped_test: { file: file || null, name: String(name), kind } })}\n`;
      continue;
    }
    if (event.type !== 'test:summary') continue;
    const { counts = {}, duration_ms: durationMs, file, success } = event.data || {};
    yield `${JSON.stringify({ file: file || null, counts, duration_ms: durationMs, success: success === true })}\n`;
  }
};
