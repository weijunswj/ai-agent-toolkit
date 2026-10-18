'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const HOOK = path.join(ROOT, 'repo', 'scripts', 'toolkit-codex-helper-hook.cjs');
function run(input, env = {}) {
  const clean = { ...process.env, ...env };
  for (const key of ['TOOLKIT_NATIVE_HELPER_BINDING', 'TOOLKIT_NATIVE_HELPER_BINDING_SHA256', 'TOOLKIT_NATIVE_HELPER_IDENTITY']) if (!(key in env)) delete clean[key];
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(input), env: clean, encoding: 'utf8', timeout: 20000 });
  return { status: r.status, output: JSON.parse(r.stdout.trim() || '{}'), stderr: r.stderr };
}

test('the Codex plugin registers the blocking PreToolUse helper hook for spawn_agent and its Agent alias', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(ROOT, '.codex-plugin', 'hooks', 'hooks.json'), 'utf8'));
  const entry = hooks.hooks.PreToolUse.find(item => item.matcher === 'spawn_agent|Agent');
  assert.ok(entry, 'PreToolUse registration');
  assert.match(entry.hooks[0].command, /toolkit-codex-helper-hook\.cjs/);
  for (const name of ['spawn_agent', 'Agent']) assert.ok(new RegExp(`^(?:${entry.matcher})$`).test(name), name);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(ROOT, 'repo', 'contracts', 'toolkit-local-bridge', 'codex-plugin', 'hooks', 'hooks.json'), 'utf8')), hooks);
});

test('outside a V3-governed checkout and without a binding the hook makes no decision', () => {
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-codex-hook-'));
  try {
    const r = run({ tool_name: 'spawn_agent', cwd: elsewhere, tool_input: { agent_type: 'any' } });
    assert.equal(r.status, 0); assert.deepEqual(r.output, {});
  } finally { fs.rmSync(elsewhere, { recursive: true, force: true }); }
});

test('inside the V3-governed Toolkit checkout an unbound helper request is blocked before dispatch', () => {
  for (const tool of ['spawn_agent', 'Agent']) {
    const r = run({ tool_name: tool, hook_event_name: 'PreToolUse', cwd: ROOT, tool_input: { agent_type: 'toolkit-g1-helper' } });
    assert.equal(r.status, 2, tool);
    assert.equal(r.output.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(r.stderr, /Toolkit helper held: NATIVE_BINDING_REQUIRED/);
  }
  assert.deepEqual(run({ tool_name: 'shell', cwd: ROOT }).output, {}, 'other tools are untouched');
});

test('a drifted pinned binding is blocked wherever it is supplied', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-codex-hook-'));
  try {
    const binding = path.join(dir, 'binding.json'); fs.writeFileSync(binding, '{}');
    const r = run({ tool_name: 'spawn_agent', cwd: dir, tool_input: {} }, { TOOLKIT_NATIVE_HELPER_BINDING: binding, TOOLKIT_NATIVE_HELPER_BINDING_SHA256: '0'.repeat(64) });
    assert.equal(r.status, 2); assert.match(r.stderr, /NATIVE_BINDING_DRIFT/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
