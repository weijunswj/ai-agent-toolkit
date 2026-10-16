'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { capturedStack } = require('./support/captured-stack-fixture.cjs');
const { GateAssignment } = require('../scripts/toolkit-v3-lifecycle.cjs');
const { GateSessionLauncher } = require('../scripts/toolkit-gate-session-launcher.cjs');

const h = s => crypto.createHash('sha256').update(s).digest('hex');
function fakeSpawn(calls) {
  return (cmd, args) => { calls.push({ cmd, args });
    return { status: 0, stdout: `${JSON.stringify({ type: 'system', subtype: 'init', session_id: args[args.indexOf('--session-id') + 1] || args[args.indexOf('--resume') + 1], model: 'claude-opus-5-5' })}\n${JSON.stringify({ type: 'result', result: 'done', total_cost_usd: 0 })}\n` }; };
}
function gate() {
  return GateAssignment.admit({ assignment_id: 'qual-slice', programme: 421, child: 461, role: 'G1',
    acceptance: { mode: 'OBJECTIVE', objective_reference: h('criteria'), owner: 'owner' } })
    .launch({ session_id: 's1', launch_request_id: 'L1', requested_by: 'CONTROLLER' }).gate;
}

test('model and effort come only from the pinned registry binding for the role', () => {
  const launcher = new GateSessionLauncher({ captured: capturedStack('owner-claude'), role: 'G1', claude: 'claude', spawn: fakeSpawn([]) });
  assert.deepEqual({ model: launcher.route.model, effort: launcher.route.effort }, { model: 'claude-opus-5-5', effort: 'high' });
  assert.throws(() => new GateSessionLauncher({ captured: capturedStack('owner-gpt'), role: 'G1', spawn: fakeSpawn([]) }).route, e => e.code === 'CLAUDE_NATIVE_ROUTE_UNSUPPORTED');
});

test('a fresh start binds a derived native session identity; a second start of the same session is refused', () => {
  const calls = [], launcher = new GateSessionLauncher({ captured: capturedStack('owner-claude'), role: 'G1', claude: 'claude', spawn: fakeSpawn(calls) });
  const g = gate();
  const run = launcher.start(g, { session_id: 's1', prompt: 'work', cwd: '.' });
  assert.equal(run.native_session_id, GateSessionLauncher.nativeSessionId(g, 's1'));
  assert.deepEqual(calls[0].args.slice(calls[0].args.indexOf('--model'), calls[0].args.indexOf('--model') + 4), ['--model', 'claude-opus-5-5', '--effort', 'high']);
  const checkpointed = g.transition('s1', 'CHECKPOINT', h('cp'));
  assert.throws(() => launcher.start(checkpointed, { session_id: 's1', prompt: 'again', cwd: '.' }), e => e.code === 'LAUNCHER_SESSION_NOT_FRESH');
});

// Stream shaped like a native Claude Code run whose lead waited on a background
// helper: a second init and result follow the first turn's interim result.
function streamSpawn(events) {
  return (cmd, args) => {
    const id = args[args.indexOf('--session-id') + 1];
    const init = { type: 'system', subtype: 'init', session_id: id, model: 'claude-opus-5-5' };
    const lines = events.map(e => e === 'INIT' ? init : { type: 'result', session_id: id, ...e });
    return { status: 0, stdout: `${lines.map(l => JSON.stringify(l)).join('\n')}\n` };
  };
}
function startWith(events) {
  const launcher = new GateSessionLauncher({ captured: capturedStack('owner-claude'), role: 'G1', claude: 'claude', spawn: streamSpawn(events) });
  return launcher.start(gate(), { session_id: 's1', prompt: 'work', cwd: '.' });
}

test('UAT-F1: with several result events the terminal one supplies text, error state and cost', () => {
  const run = startWith(['INIT', { subtype: 'success', is_error: false, result: 'Waiting for the helper.', total_cost_usd: 0.4 },
    'INIT', { subtype: 'success', is_error: false, result: 'W3-DONE', total_cost_usd: 0.5 }]);
  assert.deepEqual({ text: run.result_text, error: run.is_error, cost: run.cost_usd }, { text: 'W3-DONE', error: false, cost: 0.5 });
});

test('UAT-F1 controls: a single result is unchanged and a terminal error after an interim success is reported', () => {
  const single = startWith(['INIT', { subtype: 'success', is_error: false, result: 'done', total_cost_usd: 0.25 }]);
  assert.deepEqual({ text: single.result_text, error: single.is_error, cost: single.cost_usd }, { text: 'done', error: false, cost: 0.25 });
  const failed = startWith(['INIT', { subtype: 'success', is_error: false, result: 'interim', total_cost_usd: 0.1 },
    'INIT', { subtype: 'error_during_execution', is_error: true, result: 'helper failed', total_cost_usd: 0.3 }]);
  assert.deepEqual({ text: failed.result_text, error: failed.is_error, cost: failed.cost_usd }, { text: 'helper failed', error: true, cost: 0.3 });
  assert.equal(single.terminal_result, true);
  // A clean process exit without a terminal result is not a completed run.
  const none = startWith(['INIT']);
  assert.equal(none.exit, 0);
  assert.deepEqual({ terminal: none.terminal_result, text: none.result_text, error: none.is_error, cost: none.cost_usd },
    { terminal: false, text: null, error: true, cost: null });
});

test('resume is refused for waiting, submitted, interrupted and retired sessions before any native process', () => {
  const calls = [], launcher = new GateSessionLauncher({ captured: capturedStack('owner-claude'), role: 'G1', claude: 'claude', spawn: fakeSpawn(calls) });
  const waiting = gate().transition('s1', 'ASK_OWNER', h('q'));
  assert.equal(waiting.session('s1').state, 'WAITING_OWNER');
  const replied = waiting.transition('s1', 'OWNER_REPLY', h('a'));
  launcher.resume(replied, { session_id: 's1', prompt: 'continue', cwd: '.' });
  assert.equal(calls.length, 1);
  const submitted = replied.transition('s1', 'SUBMIT', h('r'));
  assert.throws(() => launcher.resume(submitted, { session_id: 's1', prompt: 'x', cwd: '.' }), e => e.code === 'V3_SUBMITTED_SESSION_AWAITING_CONSUMPTION');
  const retired = submitted.consumeReturn({ session_id: 's1', return_digest: h('r'), disposition: 'ACCEPT' }).gate;
  assert.throws(() => launcher.resume(retired, { session_id: 's1', prompt: 'x', cwd: '.' }), e => e.code === 'V3_RETIRED_SESSION_REFUSED');
  const interrupted = gate().transition('s1', 'INTERRUPT', h('crash'));
  assert.throws(() => launcher.resume(interrupted, { session_id: 's1', prompt: 'x', cwd: '.' }), e => e.code === 'V3_INTERRUPTED_SESSION_REQUIRES_SUCCESSOR');
  assert.equal(calls.length, 1, 'no native process was started for a refused session');
});
