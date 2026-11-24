'use strict';

// Session start shows the governance status only: the attention line, the stale-check rows, the daily
// stale-check stamp and its background run are gone. Due programme work reaches the controller at turn
// end instead (toolkit-owed-check-hook.cjs), which also keeps this computer's attention cache fresh.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const gate = require('../scripts/toolkit-governance-gate.cjs');
const cache = require('../../skills/github-program-reconciler/scripts/programme-attention-cache.cjs');
const trigger = require('../../skills/github-program-reconciler/scripts/programme-refresh-trigger.cjs');
const controllerCheck = require('../scripts/toolkit-controller-check.cjs');
const hook = require('../scripts/toolkit-owed-check-hook.cjs');
const support = require('./toolkit-governed-fixture-support.cjs');

const temps = [];
const tmp = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-start-only-')); temps.push(dir); return dir; };
test.after(() => { for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true }); });

// A cache and a stale-check stamp as earlier Toolkit wrote them, planted as raw files.
function plantOldFiles(home, attentionDir) {
  fs.mkdirSync(attentionDir, { recursive: true });
  fs.writeFileSync(path.join(attentionDir, 'acme--app.json'), JSON.stringify({ schema: 'toolkit.programme-attention-cache.v1', repository: 'acme/app', as_of: '2026-11-23T09:00:00.000Z',
    complete: true, counts: { new: 3, acknowledged: 1 }, line: 'Attention: 3 new, 1 acknowledged', digest: 'd', queue: null, shown_digest: null }));
  const stamp = path.join(home, '.ai-agent-toolkit', 'user-state', 'stale-check', 'acme--app.json');
  fs.mkdirSync(path.dirname(stamp), { recursive: true });
  fs.writeFileSync(stamp, JSON.stringify({ date: '2026-11-23', at: '2026-11-23T09:00:00.000Z', rows: ['JUDGE? #12 PR merged: check its DONE WHEN, then close it yourself or keep it open (READY_TO_CLOSE)'] }));
  return stamp;
}

test('S-1 an ENABLED repository\'s session start shows the governance status with no attention or stale-check line, and starts nothing', () => {
  const root = tmp();
  const home = tmp();
  const attentionDir = tmp();
  const stamp = plantOldFiles(home, attentionDir);
  const before = fs.readFileSync(stamp, 'utf8');
  const started = [];
  const programmeDeps = { attentionDir, sessionsDir: tmp(), home, mergedBinding: () => ({ repository: 'acme/app' }), now: () => '2026-11-23T10:00:00.000Z',
    startRefresh: folder => started.push(['refresh', folder]), startStaleSweep: folder => started.push(['stale', folder]) };
  const enabled = { state: 'ENABLED', rule: 'M1', materials_complete: true, programme_records_bind: true, root };
  const text = gate.sessionLine(root, { stateReader: () => enabled, programmeDeps });
  assert.match(text, /^Toolkit governance: ENABLED/);
  for (const gone of [/Attention:/, /Stale check/, /toolkit-controller-check/, /answer each new or overdue finding/, /work queue/i]) assert.doesNotMatch(text, gone);
  assert.deepEqual(started, [], 'no background refresh and no stale check from session start');
  assert.equal(fs.readFileSync(stamp, 'utf8'), before);
  assert.equal(gate.FINDING_ACTIONS.attention, undefined);
  assert.equal(gate.FINDING_ACTIONS.queue, undefined);
});

test('S-2 the stale check, its stamp and the session-start cache readers are gone from the modules', () => {
  for (const name of ['sessionAttention', 'markShown', 'queueText', 'staleStampFile', 'readStaleStamp', 'writeStaleStamp']) assert.equal(cache[name], undefined, name);
  assert.equal(trigger.startStaleSweep, undefined);
  assert.equal(controllerCheck.CHECKS.includes('stale'), false);
  for (const name of ['staleOnlySkip', 'localDate', 'polishRows', 'rowTicks']) assert.equal(controllerCheck[name], undefined, name);
  // The cache keeps only what the turn-end check reads: no session-start line, counts or digest.
  const dir = tmp();
  const net = [{ id: 'abcdefabcdef', code: 'TASK_IDLE', issue: 4, kind: null, state: 'new', changed_at: '2026-11-23T01:00:00.000Z', due: null }];
  assert.equal(cache.writeCache('acme/app', { complete: true, net }, { attentionDir: dir }), true);
  const written = JSON.parse(fs.readFileSync(cache.cacheFile('acme/app', { attentionDir: dir }), 'utf8'));
  assert.deepEqual(Object.keys(written).sort(), ['as_of', 'complete', 'net', 'repository', 'schema']);
  assert.deepEqual(cache.readCache('acme/app', { attentionDir: dir }).net, net);
  // A cache an earlier Toolkit wrote is not read: the turn-end check says so and refreshes it.
  const old = tmp();
  plantOldFiles(tmp(), old);
  assert.equal(cache.readCache('acme/app', { attentionDir: old }), null);
});

test('S-3 the controller check has no stale check; a retired name in --skip is accepted and runs nothing', () => {
  assert.throws(() => controllerCheck.parseArgs(['--skip', 'nosuch']), /unknown check nosuch/);
  const options = controllerCheck.parseArgs(['--skip', 'programme,traces,stale,ci,handoff']);
  assert.deepEqual([...options.skip].sort(), ['ci', 'handoff', 'programme', 'traces']);
});

test('S-4 the turn-end check starts one background refresh when the cache is missing or over an hour old, never offline', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owed-refresh-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, 'home');
  const work = path.join(dir, 'work');
  fs.mkdirSync(home, { recursive: true });
  support.makeGoverned(work, 'owed', { home });
  const transcript = path.join(dir, 't.jsonl');
  fs.writeFileSync(transcript, `${JSON.stringify({ type: 'assistant', timestamp: '2026-11-23T11:00:00.000Z', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'node programme.cjs ack --finding abcdefabcdef --controller' } }] } })}\n`);
  let nowMs = Date.parse('2026-11-23T12:00:00.000Z');
  const started = [];
  const deps = { home, get nowMs() { return nowMs; }, now: () => new Date(nowMs).toISOString(), env: {}, governanceState: () => ({ state: 'ENABLED', programme_records_bind: true }), startRefresh: folder => started.push(folder) };
  const run = () => hook.check({ hook_event_name: 'Stop', session_id: 's-1', transcript_path: transcript, cwd: work }, deps);
  run();
  assert.equal(started.length, 1, 'no cache: one refresh');
  assert.equal(fs.realpathSync(started[0]), fs.realpathSync(work));
  nowMs += 10 * 60000;
  run();
  assert.equal(started.length, 1, 'throttled within 15 minutes');
  // A fresh cache starts nothing; one over an hour old starts the next refresh.
  cache.writeCache('toolkit-test-fixture/owed', { complete: true, net: [] }, { home, now: () => new Date(nowMs).toISOString() });
  nowMs += 30 * 60000;
  run();
  assert.equal(started.length, 1, 'fresh cache');
  nowMs += 90 * 60000;
  run();
  assert.equal(started.length, 2, 'old cache');
  // A cloud session never starts one.
  nowMs += 120 * 60000;
  hook.check({ hook_event_name: 'Stop', session_id: 's-1', transcript_path: transcript, cwd: work }, { ...deps, env: { CLAUDE_CODE_REMOTE: 'true' } });
  assert.equal(started.length, 2, 'no refresh from a cloud session');
  // Offline (a test run) with no injected starter: nothing starts.
  const offline = { ...deps, startRefresh: undefined, env: { TOOLKIT_GOVERNANCE_OFFLINE: '1' } };
  nowMs += 120 * 60000;
  assert.doesNotThrow(() => hook.check({ hook_event_name: 'Stop', session_id: 's-1', transcript_path: transcript, cwd: work }, offline));
});

test('S-5 no Toolkit script or doc still names the stale check, its stamp or its background run', () => {
  const files = ['repo/scripts/toolkit-governance-gate.cjs', 'repo/scripts/toolkit-controller-check.cjs', 'skills/github-program-reconciler/scripts/programme-refresh-trigger.cjs',
    'skills/github-program-reconciler/scripts/programme-attention-cache.cjs', 'repo/controller/principles.md', 'repo/CONTROLLER.md', 'skills/github-program-reconciler/SKILL.md',
    'repo/contracts/claude-projects/web-controller-projects/tasks/hourly-nudge.md', 'repo/contracts/claude-projects/web-controller-projects/tasks/daily-check-in.md',
    'repo/contracts/claude-projects/web-controller-projects/reference/cloud-hook-parity.md', 'repo/contracts/agent-rules/controller-enforcement-map.json', 'repo/tests/hook-pack/README.md'];
  for (const file of files) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const gone of [/stale[- ]check/i, /staleStamp|StaleStamp|startStaleSweep|staleOnlySkip|stale_rows/, /,stale,|,stale\b(?!-)/]) assert.doesNotMatch(text, gone, `${file}: ${gone}`);
  }
});
