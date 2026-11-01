'use strict';

// Setup shows only the question bank of the app that started it: a Codex chat that asks for the
// Claude Code questions (or the reverse) stops before any step, and an unclear start keeps --host.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { AGENT_HOST_MARKER_NAMES, HOST_MARKERS, detectAgentHost } = require('../scripts/agent-host-markers.cjs');
const { AGENT_MARKERS } = require('../scripts/toolkit-env.cjs');
const core = require('../scripts/setup-toolkit-core.cjs');
const { run, tmpRoot, isolatedHomeEnv, noHostMarkers } = require('./toolkit-setup-test-support.cjs');

test('the detected app comes from exact marker names only', () => {
  const rows = [
    [{}, 'unknown'],
    [{ CLAUDECODE: '1' }, 'claude-code'],
    [{ CLAUDE_CODE_ENTRYPOINT: 'cli' }, 'claude-code'],
    [{ CODEX_THREAD_ID: 'thread' }, 'codex'],
    [{ CODEX_CI: '1' }, 'codex'],
    [{ CODEX_SANDBOX: 'seatbelt' }, 'codex'],
    [{ CODEX_SANDBOX_NETWORK_DISABLED: '1' }, 'codex'],
    [{ CLAUDECODE: '1', CODEX_THREAD_ID: 'thread' }, 'unknown'],
    [{ CLAUDECODE: '' }, 'unknown'],
    [{ CODEX_HOME: 'C:\\codex' }, 'unknown'],
    [{ CLAUDE_CONFIG_DIR: 'C:\\claude' }, 'unknown'],
    [{ CODEX_HOME: 'C:\\codex', CLAUDE_CONFIG_DIR: 'C:\\claude', AI_AGENT: 'x' }, 'unknown']
  ];
  for (const [environment, expected] of rows) assert.equal(detectAgentHost(environment), expected, JSON.stringify(environment));
});

test('toolkit-env reads the same marker list', () => {
  assert.deepEqual(AGENT_MARKERS.filter((name) => name !== 'AI_AGENT'), AGENT_HOST_MARKER_NAMES);
  assert.deepEqual(AGENT_HOST_MARKER_NAMES, [...HOST_MARKERS['claude-code'], ...HOST_MARKERS.codex]);
});

test('each start and --host pair keeps or stops setup as planned', () => {
  const rows = [
    [{ CODEX_THREAD_ID: 't' }, ['--plan'], null],
    [{ CODEX_THREAD_ID: 't' }, ['--plan', '--host', 'codex'], null],
    [{ CODEX_THREAD_ID: 't' }, ['--plan', '--host', 'claude-code'], /^SETUP STOPPED: setup was started from Codex, and this command is not the Codex setup\. Nothing was changed\.\nRun it again as: node "[^"]+setup-toolkit\.cjs" --plan$/],
    [{ CODEX_THREAD_ID: 't' }, ['--execute', '--host=claude-code', '--json'], /Run it again as: node "[^"]+setup-toolkit\.cjs" --execute --json$/],
    [{ CLAUDECODE: '1' }, ['--plan', '--host', 'claude-code'], null],
    [{ CLAUDECODE: '1' }, ['--plan'], /^SETUP STOPPED: setup was started from Claude Code, and this command is not the Claude Code setup\. Nothing was changed\.\nRun it again as: node "[^"]+setup-toolkit\.cjs" --plan --host claude-code$/],
    [{ CLAUDECODE: '1' }, ['--plan', '--host', 'codex'], /Run it again as: node "[^"]+setup-toolkit\.cjs" --plan --host claude-code$/],
    [{}, ['--plan'], null],
    [{}, ['--plan', '--host', 'claude-code'], null],
    [{ CLAUDECODE: '1', CODEX_CI: '1' }, ['--plan'], null],
    [{ CLAUDECODE: '1', CODEX_CI: '1' }, ['--plan', '--host', 'claude-code'], null]
  ];
  for (const [environment, argv, expected] of rows) {
    const message = core.hostMismatch(core.parseArgs(argv), environment);
    if (expected === null) assert.equal(message, null, `${JSON.stringify(environment)} ${argv.join(' ')}`);
    else assert.match(message, expected, `${JSON.stringify(environment)} ${argv.join(' ')}`);
  }
});

test('a mismatched start stops with exit 2, no question bank and nothing written', () => {
  for (const [marker, host, app, otherApp] of [['CODEX_THREAD_ID', 'claude-code', 'Codex', 'Claude'], ['CLAUDECODE', 'codex', 'Claude Code', 'Codex']]) {
    const root = tmpRoot();
    try {
      const env = isolatedHomeEnv(root);
      const before = fs.readdirSync(root).sort();
      const result = run(['--plan', '--host', host], { env: { ...env, [marker]: '1' }, codexDocLimitQuestion: true });
      assert.equal(result.status, core.SETUP_HOST_MISMATCH, result.stderr);
      assert.equal(core.SETUP_HOST_MISMATCH, 2);
      assert.match(result.stderr, new RegExp(`^SETUP STOPPED: setup was started from ${app}, and this command is not the ${app} setup`));
      // The stop names only the app that started setup, never the other app.
      assert.doesNotMatch(result.stderr, new RegExp(otherApp));
      assert.equal(result.stdout, '');
      assert.deepEqual(fs.readdirSync(root).sort(), before);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('test runs blank every host marker so they pass inside either app', () => {
  assert.deepEqual(Object.keys(noHostMarkers()), AGENT_HOST_MARKER_NAMES);
  assert.ok(Object.values(noHostMarkers()).every((value) => value === ''));
});
