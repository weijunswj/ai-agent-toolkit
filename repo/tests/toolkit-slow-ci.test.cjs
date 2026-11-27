'use strict';

// The daily slow-CI line (owner decision INT-TK421-1393): a per-repository record on this computer,
// a background check at most once a day, and the line given once per new result at whichever comes
// first, session start or turn end. Real git checkouts with a github.com origin; the background start
// is recorded, never run.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const slowCi = require('../scripts/toolkit-slow-ci.cjs');
const owed = require('../scripts/toolkit-owed-check-hook.cjs');

const HOUR = 60 * 60 * 1000;
const START = Date.parse('2026-11-27T09:00:00Z');
const SHARDS = { level: 'GAP', check: 'speed.shards', path: '.github/workflows/ci.yml', message: 'CI / Validate app took up to 48 min', fix: '', facts: { job: 'CI / Validate app', seconds: 2880, shards: 5, tests: 142 } };
const LOPSIDED = { level: 'GAP', check: 'speed.shards-lopsided', path: '.github/workflows/ci.yml', message: 'lopsided', fix: '', facts: { slow: 'CI / Tests (1)', slow_seconds: 900, fast: 'CI / Tests (2)', fast_seconds: 300 } };
const report = (...items) => ({ schema: 'ci-checkup-report/v1', items });

function checkout(t, origin = 'https://github.com/acme/app.git') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slow-ci-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repo = path.join(dir, 'app');
  fs.mkdirSync(repo);
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: repo }).status, 0);
  if (origin) assert.equal(spawnSync('git', ['remote', 'add', 'origin', origin], { cwd: repo }).status, 0);
  return { repo, state: path.join(dir, 'state') };
}

// One computer: a record, a clock that moves and the background starts it asked for.
function computer(fx, { offline = false, startCheck = true } = {}) {
  const clock = { now: START };
  const starts = [];
  const record = new slowCi.SlowCiRecord({
    registryOptions: { testOnly: true, stateDirectory: fx.state },
    now: () => new Date(clock.now),
    environment: offline ? { TOOLKIT_GOVERNANCE_OFFLINE: '1' } : {},
    ...(startCheck ? { startCheck: root => starts.push(root) } : {}),
    runCheckup: () => clock.report || null,
  });
  return { record, clock, starts };
}

test('a new finding is given once, at whichever comes first: session start, then nothing at turn end', (t) => {
  const fx = checkout(t);
  const pc = computer(fx);
  pc.record.record(fx.repo, report(SHARDS));
  const first = slowCi.sessionStartLine(pc.record.note(fx.repo));
  assert.equal(first, 'Toolkit CI check: acme/app\'s CI would gain from shards: CI / Validate app took up to 48 min with no sharding; about 5 shards would bring it near 10 min (142 tracked test files). In your first reply, tell the user once, in one line; this repository\'s controller arranges or rebalances shards in its own CI (fast-tests-and-sharding playbook, section Arrange Shards In This Repository\'s CI), or records why not with a reason in .github/ci-checkup.json. Nothing waits on it.');
  assert.equal(pc.record.note(fx.repo), null, 'the next turn end says nothing');
  assert.equal(pc.record.note(fx.repo), null, 'nor the next session start');
});

test('turn end first: the owner sees it there, and the next session start stays quiet', (t) => {
  const fx = checkout(t);
  const pc = computer(fx);
  pc.record.record(fx.repo, report(SHARDS, LOPSIDED));
  assert.equal(slowCi.turnEndLine(pc.record.note(fx.repo)), 'Toolkit CI check: acme/app\'s CI would gain from shards: CI / Validate app took up to 48 min with no sharding; about 5 shards would bring it near 10 min (142 tracked test files); CI / Tests (1) took 15 min and CI / Tests (2) 5 min, so its shards are lopsided. Its controller can arrange or rebalance them (fast-tests-and-sharding playbook, section Arrange Shards In This Repository\'s CI); nothing waits on it.');
  assert.equal(pc.record.note(fx.repo), null);
});

test('quiet until the result changes: new times alone say nothing, a new shard count or job does', (t) => {
  const fx = checkout(t);
  const pc = computer(fx);
  pc.record.record(fx.repo, report(SHARDS));
  assert.ok(pc.record.note(fx.repo));
  pc.record.record(fx.repo, report({ ...SHARDS, facts: { ...SHARDS.facts, seconds: 2950, tests: 143 } }));
  assert.equal(pc.record.note(fx.repo), null, 'the same result a day later');
  pc.record.record(fx.repo, report({ ...SHARDS, facts: { ...SHARDS.facts, seconds: 3700, shards: 7 } }));
  assert.match(slowCi.turnEndLine(pc.record.note(fx.repo)), /about 7 shards/);
  pc.record.record(fx.repo, report());
  assert.equal(pc.record.note(fx.repo), null, 'a result with no finding gives no line');
  pc.record.record(fx.repo, report({ ...SHARDS, facts: { ...SHARDS.facts, seconds: 3700, shards: 7 } }));
  assert.ok(pc.record.note(fx.repo), 'the finding coming back after it cleared is new again');
});

test('the background check starts at most once a day, claimed so chats starting together start one', (t) => {
  const fx = checkout(t);
  const pc = computer(fx);
  assert.equal(pc.record.note(fx.repo), null, 'nothing checked yet: no line');
  assert.deepEqual(pc.starts, [fx.repo]);
  pc.record.note(fx.repo);
  assert.equal(pc.starts.length, 1, 'claimed: a second chat starts no second check');
  pc.clock.now += 30 * 60 * 1000;
  pc.clock.report = report(SHARDS);
  pc.record.check(fx.repo);
  pc.clock.now += 23 * HOUR;
  pc.record.note(fx.repo);
  assert.equal(pc.starts.length, 1, 'checked under a day ago');
  pc.clock.now += 2 * HOUR;
  pc.record.note(fx.repo);
  assert.equal(pc.starts.length, 2, 'a day after the last check');
});

test('a check that could not read GitHub keeps the last result and is tried again an hour after it began', (t) => {
  const fx = checkout(t);
  const pc = computer(fx);
  pc.record.record(fx.repo, report(SHARDS));
  assert.ok(pc.record.note(fx.repo));
  pc.clock.now += 25 * HOUR;
  pc.record.note(fx.repo);
  assert.equal(pc.starts.length, 1);
  pc.clock.report = report({ level: 'CHECK', check: 'speed.jobs', path: '', message: 'job times not checked (no GitHub access)', fix: '' });
  assert.equal(pc.record.check(fx.repo), null, 'nothing saved');
  pc.clock.now += 30 * 60 * 1000;
  pc.record.note(fx.repo);
  assert.equal(pc.starts.length, 1, 'within the hour');
  pc.clock.now += 31 * 60 * 1000;
  assert.equal(pc.record.note(fx.repo), null, 'the kept result was shown already');
  assert.equal(pc.starts.length, 2, 'an hour after the failed check began');
});

test('the record keeps codes, job names, times and counts only', (t) => {
  const fx = checkout(t);
  const pc = computer(fx);
  pc.record.record(fx.repo, report({ ...SHARDS, facts: { ...SHARDS.facts, token: 'x' }, extra: 'y' }, { level: 'GAP', check: 'parts.docker', path: 'Dockerfile', message: 'no CI step builds this Dockerfile' }));
  const saved = JSON.parse(fs.readFileSync(pc.record.file, 'utf8'));
  const [entry] = Object.values(saved.repositories);
  assert.deepEqual(entry.findings, [{ code: 'speed.shards', job: 'CI / Validate app', seconds: 2880, shards: 5, tests: 142 }]);
  assert.equal(entry.name, 'acme/app');
  assert.deepEqual(Object.keys(entry).sort(), ['checked_at', 'findings', 'name', 'result']);
});

test('no line and no check outside a github.com checkout, offline, or when the record cannot be saved', (t) => {
  const elsewhere = checkout(t, 'https://gitlab.com/acme/app.git');
  const pc = computer(elsewhere);
  assert.equal(pc.record.note(elsewhere.repo), null);
  assert.deepEqual(pc.starts, []);
  const none = checkout(t, null);
  assert.equal(computer(none).record.note(none.repo), null, 'no origin');

  const fx = checkout(t);
  const offline = computer(fx, { offline: true, startCheck: false });
  offline.record.note(fx.repo);
  assert.equal(fs.existsSync(offline.record.file), false, 'offline: no start and nothing claimed');

  const pc2 = computer(fx);
  pc2.record.record(fx.repo, report(SHARDS));
  // A record that can be read but not saved gives no line, so the line never repeats: a read-only
  // record file (Windows refuses to replace it) in a read-only folder (Linux refuses the new file).
  const folder = path.dirname(pc2.record.file);
  const writable = () => { fs.chmodSync(folder, 0o700); fs.chmodSync(pc2.record.file, 0o600); };
  fs.chmodSync(pc2.record.file, 0o400);
  fs.chmodSync(folder, 0o500);
  try {
    assert.equal(Object.values(pc2.record.read().repositories)[0].findings.length, 1, 'the unshown result is readable');
    assert.equal(pc2.record.note(fx.repo), null);
  } finally { writable(); }
  assert.ok(pc2.record.note(fx.repo), 'once it can be saved, the line is given');
});

test('turn end: the owed-check hook adds the line for the owner, never in a cloud or launcher session', (t) => {
  const fx = checkout(t);
  const pc = computer(fx);
  pc.record.record(fx.repo, report(SHARDS));
  const stop = { hook_event_name: 'Stop', session_id: 'abc', cwd: fx.repo };
  assert.equal(owed.check(stop, { env: { CLAUDE_CODE_REMOTE: 'true' }, slowCi: pc.record }).output, null, 'cloud');
  assert.equal(owed.check(stop, { env: { TOOLKIT_GATE_ROLE: 'G1' }, slowCi: pc.record }).output, null, 'launcher');
  const shown = owed.check(stop, { env: {}, slowCi: pc.record }).output;
  assert.match(shown.systemMessage, /^Toolkit CI check: acme\/app's CI would gain from shards: CI \/ Validate app took up to 48 min/);
  assert.equal(shown.decision, undefined, 'never a block');
  assert.equal(owed.check(stop, { env: {}, slowCi: pc.record }).output, null, 'once');
});

const FAKE_GATE = { SESSION_TEXT_LIMIT: 10000, startSession() {}, sessionIdOf: input => input.session_id, sessionLine: () => 'Toolkit governance: off here.' };

test('Claude Code session start: the line follows the governance text once, never in a launcher session', (t) => {
  const { respond } = require('../scripts/toolkit-governance-hook.cjs');
  const fx = checkout(t);
  const pc = computer(fx);
  pc.record.record(fx.repo, report(SHARDS));
  const start = environment => respond('SessionStart', { cwd: fx.repo, session_id: 's1', source: 'startup' }, {
    environment, refreshBinding: () => {}, gate: FAKE_GATE, repoCatchUp: { catchUp: () => null }, slowCi: pc.record,
  }).hookSpecificOutput?.additionalContext || '';
  assert.equal(start({ TOOLKIT_GATE_ROLE: 'G1' }), 'Toolkit governance: off here.', 'a launcher session neither shows nor uses up the line');
  const first = start({});
  assert.match(first, /^Toolkit governance: off here\.\n\nToolkit CI check: acme\/app's CI would gain from shards: CI \/ Validate app took up to 48 min.* In your first reply, tell the user once, in one line;/);
  assert.equal(start({}), 'Toolkit governance: off here.', 'once');
});

test('Claude Code session start: a governance text that fails does not use the line up', (t) => {
  const { respond } = require('../scripts/toolkit-governance-hook.cjs');
  const fx = checkout(t);
  const pc = computer(fx);
  pc.record.record(fx.repo, report(SHARDS));
  const start = gate => respond('SessionStart', { cwd: fx.repo, session_id: 's1', source: 'startup' }, {
    environment: {}, refreshBinding: () => {}, gate, repoCatchUp: { catchUp: () => null }, slowCi: pc.record,
  }).hookSpecificOutput?.additionalContext || '';
  assert.doesNotMatch(start({ ...FAKE_GATE, sessionLine() { throw new Error('governance read failed'); } }), /Toolkit CI check/);
  assert.match(start(FAKE_GATE), /\n\nToolkit CI check: acme\/app's CI would gain from shards/, 'the next session start still gives it');
});

test('two chats at once: only the one that saves it as shown gives the line', (t) => {
  const fx = checkout(t);
  const pc = computer(fx);
  pc.record.record(fx.repo, report(SHARDS));
  const first = pc.record.peek(fx.repo);
  const second = pc.record.peek(fx.repo);
  assert.ok(first.note && second.note);
  assert.equal(first.markShown(), true);
  assert.equal(second.markShown(), false);
});

test('Codex session start: the line is printed after the governance line once', (t) => {
  const launcher = require('../scripts/toolkit-codex-session-start.cjs');
  const fx = checkout(t);
  const pc = computer(fx);
  pc.record.record(fx.repo, report(LOPSIDED));
  const start = () => {
    const lines = [];
    const original = console.log;
    console.log = line => lines.push(String(line));
    try {
      assert.equal(launcher.main(launcher.HOOK_ARGS, { bridge: { run: () => ({ status: 0 }) }, input: { cwd: fx.repo, session_id: 's1' }, gate: FAKE_GATE, catchUp: { catchUp: () => null }, environment: {}, slowCi: pc.record }), 0);
    } finally { console.log = original; }
    return lines;
  };
  const first = start();
  assert.equal(first.length, 2);
  assert.equal(first[0], 'Toolkit governance: off here.');
  assert.match(first[1], /^Toolkit CI check: acme\/app's CI would gain from shards: CI \/ Tests \(1\) took 15 min and CI \/ Tests \(2\) 5 min, so its shards are lopsided\. In your first reply/);
  assert.deepEqual(start(), ['Toolkit governance: off here.']);
});
