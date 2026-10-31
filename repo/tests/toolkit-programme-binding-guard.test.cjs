'use strict';

// The public state branch changes programme-state.cjs, which the governance and checkpoint hooks
// load. These tests hold it to what main answered before that change: the binding, journal,
// canonical-JSON, host and transport answers recorded from main (fixtures/programme-binding-guard),
// and the module's top-level requires, so hook load time does not grow.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const STATE_FILE = path.join(repoRoot, 'skills', 'github-program-reconciler', 'scripts', 'programme-state.cjs');
const state = require(STATE_FILE);
const checkpoint = require(path.join(repoRoot, 'skills', 'github-program-reconciler', 'scripts', 'programme-checkpoint.cjs'));
const { BINDINGS, evaluate } = require('./fixtures/programme-binding-guard/cases.cjs');
const recorded = require('./fixtures/programme-binding-guard/expected-4707537.json');

const now = evaluate(state);
const before = recorded.results;

test('the guard answers were recorded from the bound main', () => {
  assert.equal(recorded.recorded_from, '47075370b3b6c51662545a85757d43aaf0740d29');
  assert.equal(before.bindings.length, BINDINGS.length);
});

test('every binding keeps main\'s answer, except a v2 binding whose one new key is a valid state block beside a valid store', () => {
  for (const [index, entry] of BINDINGS.entries()) {
    const was = before.bindings[index];
    const is = now.bindings[index];
    assert.equal(is.name, was.name);
    if (entry.state_exception) {
      assert.equal(was.validate.ok, false, `${entry.name} was invalid on main`);
      assert.equal(is.validate.ok, true, `${entry.name} is valid now: ${is.validate.message || ''}`);
      assert.equal(is.enabled, entry.binding.governance === 'enabled');
      continue;
    }
    if (was.validate.ok) {
      assert.deepEqual(is, was, `${entry.name} keeps the same normalised binding and enabled answer`);
    } else {
      assert.equal(is.validate.ok, false, `${entry.name} stays invalid`);
      assert.equal(is.validate.code, was.validate.code, `${entry.name} keeps its error code`);
      // Bindings without a state key keep their exact errors too.
      if (!Object.hasOwn(Object(entry.binding), 'state')) assert.deepEqual(is, was, `${entry.name} keeps its exact errors`);
    }
  }
});

test('SCHEMA.journal, validateJournal, canonical, isGitHubHost and GitHubTransport answer as on main', () => {
  for (const key of ['schema_journal', 'journals', 'canonical', 'hosts', 'transport_parse', 'transport_request']) {
    assert.deepEqual(now[key], before[key], key);
  }
});

test('programme-state.cjs keeps exactly main\'s top-level requires (lines 21-27)', () => {
  const lines = fs.readFileSync(STATE_FILE, 'utf8').split(/\r?\n/);
  const topLevel = lines.map((line, index) => [index + 1, line]).filter(([, line]) => /^(?:const|let|var)\b.*\brequire\(/.test(line));
  assert.deepEqual(topLevel, [
    [21, "const crypto = require('node:crypto');"],
    [22, "const fs = require('node:fs');"],
    [23, "const path = require('node:path');"],
    [24, "const { spawnSync } = require('node:child_process');"],
    [25, "const { DEFAULT_THRESHOLD, INDEX_COMMENT_MARKER, auditDecisionTraces, traceEntries, commentLink, issueUrl } = require('./decision-trace-audit.cjs');"],
    [26, "const { OTHER_COMMENTS } = require('./decision-tags.cjs');"],
    [27, "const { ProgrammeError, resolveExecutable } = require('./resolve-executable.cjs');"],
  ]);
  // Any other require sits inside a function body (indented), loaded on first use.
  const others = lines.filter(line => /\brequire\(/.test(line) && !/^(?:const|let|var)\b/.test(line));
  assert.ok(others.every(line => /^\s+/.test(line)), 'every other require is inside a function');
});

test('loading programme-state.cjs does not load programme-checkpoint.cjs; the public hash is the journal hash', () => {
  const child = require('node:child_process').spawnSync(process.execPath, ['-e', `require(${JSON.stringify(STATE_FILE)}); console.log(Object.keys(require.cache).some(file => file.endsWith('programme-checkpoint.cjs')))`], { encoding: 'utf8' });
  assert.equal(child.stdout.trim(), 'false');
  const doc = state.newParent({ repository: 'example-owner/example-repo', parentIssue: 7 });
  doc.fence = { epoch: 1, holder_prefix: 'INT-ER7-', holder_session: 'session-example-1' };
  assert.equal(state.publicView('parent', doc).fence.holder_session_hash, checkpoint.sessionHash('session-example-1'));
  assert.deepEqual(state.refreshWriter(doc), { by_hash: true, session_hash: checkpoint.sessionHash('session-example-1'), prefix: 'INT-ER7-' });
});
