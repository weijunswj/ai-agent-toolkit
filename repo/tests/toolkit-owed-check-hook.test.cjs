'use strict';

// The turn-end owed check (repo/scripts/toolkit-owed-check-hook.cjs): who it stops, what it lists, that
// it stops a turn only for an entry it has not shown, and that anything unreadable is a note, never a
// block. Every test builds its own temp home, checkout, transcript and desktop session files.

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const HOOK = path.join(ROOT, 'repo', 'scripts', 'toolkit-owed-check-hook.cjs');
const hook = require(HOOK);
const cache = require(path.join(ROOT, 'skills', 'github-program-reconciler', 'scripts', 'programme-attention-cache.cjs'));
const support = require('./toolkit-governed-fixture-support.cjs');
const { LAUNCHER_MARKERS } = require(path.join(ROOT, 'repo', 'scripts', 'toolkit-governed-repo.cjs'));

// This session's id, and the id of a chat its transcript may be copied from.
const SESSION = '00000000-0000-4000-8000-0000000000b1';
const PARENT = '00000000-0000-4000-8000-0000000000b2';
const SELF = 'local_00000000-0000-4000-8000-000000000001';
const CHILD = n => `local_00000000-0000-4000-9000-${String(n).padStart(12, '0')}`;
const NOW = Date.parse('2026-11-23T12:00:00Z');
const HOUR = 3600000;
const iso = ms => new Date(ms).toISOString();

function fixture(t, { governed = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owed-check-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, 'home');
  const work = path.join(dir, 'work');
  fs.mkdirSync(home, { recursive: true });
  support.makeGoverned(work, 'owed', { home });
  const sessions = path.join(dir, 'local', 'Claude-Data', 'claude_fx', 'claude-code-sessions', 'a', 'b');
  fs.mkdirSync(sessions, { recursive: true });
  const transcript = path.join(dir, `${SESSION}.jsonl`);
  const fx = {
    dir, home, work, sessions, transcript, repository: 'toolkit-test-fixture/owed',
    deps: { home, nowMs: NOW, localAppData: path.join(dir, 'local'), startRefresh: () => {}, governanceState: () => (governed ? { state: 'ENABLED', programme_records_bind: true } : { state: 'DISABLED' }),
      env: { CLAUDE_CODE_HOST_SESSION_ID: SELF } },
    rows: [],
    // Transcript rows, in order; each call is { name, input, at (hours ago), result, error }.
    brief(text) { fx.rows.unshift({ type: 'user', sessionId: SESSION, message: { role: 'user', content: text }, timestamp: iso(NOW - 30 * HOUR) }); return fx; },
    // Rewrites the rows so far as a copy of another chat's, one function from row to row.
    copied(asCopy) { fx.rows = fx.rows.map(asCopy); return fx; },
    call({ name, input, hoursAgo = 1, result = 'ok', error = false }) {
      const id = `toolu_${fx.rows.length}`;
      fx.rows.push({ type: 'assistant', sessionId: SESSION, timestamp: iso(NOW - hoursAgo * HOUR), message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
      fx.rows.push({ type: 'user', sessionId: SESSION, timestamp: iso(NOW - hoursAgo * HOUR), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: result }], ...(error ? { is_error: true } : {}) }] } });
      return fx;
    },
    launch(n, { gate = 'G1', hoursAgo = 1, error = false, brief = '' } = {}) {
      return fx.call({ name: 'mcp__ccd_session__start_session', hoursAgo, error, input: { initiation: 'user_asked', title: `Gate ${n}`, prompt: `Gate: ${gate}\nRoute: owner-claude BUILDER opus-5.5/high\n${brief}\nTask ${n}` },
        result: error ? 'refused' : `Started session "Gate ${n}" (session_id: ${CHILD(n)}, name: gate-${n}). It runs on its own.` });
    },
    // A gate held at its first turn until the controller's go-ahead, and that go-ahead.
    held(n, opts = {}) { return fx.launch(n, { brief: 'FIRST TURN: reply only READY, then stop. The controller sends the go-ahead.', ...opts }); },
    send(input, opts = {}) { return fx.call({ name: 'SendMessage', input: { message: 'Go ahead.', ...input }, result: '{"success":true,"message":"Sent"}', ...opts }); },
    // What an accepted `programme.cjs gate-session` leaves in this computer's cache.
    record(n, assignment, { closed = false, issue = 9 } = {}) {
      assert.equal(cache.writeGateSession(fx.repository, { issue, assignment, session: n === null ? null : CHILD(n), closed }, { home, now: () => iso(NOW) }), true);
      return fx;
    },
    shell(command, opts = {}) { return fx.call({ name: 'Bash', input: { command }, ...opts }); },
    archive(n, opts = {}) { return fx.call({ name: 'mcp__ccd_session_mgmt__archive_session', input: { session_id: CHILD(n) }, ...opts }); },
    controller() { return fx.shell('node programme.cjs ack --finding abcdefabcdef --next "x" --session ctl --controller'); },
    writeTranscript() { fs.writeFileSync(transcript, fx.rows.map(row => JSON.stringify(row)).join('\n') + '\n'); return fx; },
    net(entries) {
      cache.writeCache(fx.repository, { complete: true,
        net: entries.map((entry, index) => ({ id: entry.id || `00000000000${index}`.slice(-12), issue: 7, kind: null, due: null, ...entry })) }, { home, now: () => iso(NOW) });
      return fx;
    },
    desktop(own = {}, children = []) {
      fs.writeFileSync(path.join(sessions, `${SELF}.json`), JSON.stringify({ sessionId: SELF, isArchived: false, createdAt: NOW - 48 * HOUR, ...own }));
      children.forEach((child, index) => fs.writeFileSync(path.join(sessions, `${child.sessionId || CHILD(index + 100)}.json`),
        JSON.stringify({ sessionId: CHILD(index + 100), spawnedFrom: { sessionId: SELF, title: `Side ${index + 100}` }, ...child })));
      return fx;
    },
    run(input = {}) { return hook.check({ hook_event_name: 'Stop', session_id: SESSION, transcript_path: transcript, cwd: fx.work, stop_hook_active: false, ...input }, fx.deps); },
  };
  return fx;
}

// A finished side session as the desktop app writes it.
const finished = (extra = {}) => ({ isArchived: false, prs: [{ prNumber: 5, state: 'MERGED' }], postTurnSummary: { status_category: 'completed', needs_action: '' },
  postTurnSummaryFor: 'u1', lastAssistantUuid: 'u1', lastTurnEdgeAt: NOW - HOUR, latestUserFrameAt: NOW - 2 * HOUR, ...extra });

test('O-1 a controller turn with a finding new for 4 hours is stopped once, with the steps', t => {
  const fx = fixture(t).controller().writeTranscript().net([{ code: 'TASK_IDLE', state: 'new', changed_at: iso(NOW - 5 * HOUR) }]).desktop();
  const first = fx.run();
  assert.equal(first.outcome, 'BLOCK');
  assert.equal(first.output.decision, 'block');
  assert.match(first.output.reason, /Findings due \(1\):\n- TASK_IDLE on #7 \(000000000000\), new for 5 h/);
  assert.match(first.output.reason, /ack --finding <id> --next/);
  // The same list again: silent. The host's own repeat flag: silent before anything is read.
  assert.deepEqual(fx.run(), { outcome: 'SHOWN', output: null });
  assert.deepEqual(fx.run({ stop_hook_active: true }), { outcome: 'ALREADY_BLOCKED', output: null });
});

test('O-2 only findings new for 4 hours or acknowledged past due are listed, and CLOSE_DUE has its own section', t => {
  const fx = fixture(t).controller().writeTranscript().desktop().net([
    { id: 'aaaaaaaaaaaa', code: 'TASK_IDLE', state: 'new', changed_at: iso(NOW - 3 * HOUR) },
    { id: 'bbbbbbbbbbbb', code: 'TASK_IDLE', state: 'acknowledged', changed_at: iso(NOW - 10 * HOUR), due: iso(NOW - HOUR) },
    { id: 'cccccccccccc', code: 'TASK_IDLE', state: 'acknowledged', changed_at: iso(NOW - 10 * HOUR), due: iso(NOW + HOUR) },
    { id: 'dddddddddddd', code: 'CLOSE_DUE', state: 'new', kind: 'g1-1225-a1', changed_at: iso(NOW - HOUR) },
  ]);
  const { reason } = fx.run().output;
  assert.doesNotMatch(reason, /aaaaaaaaaaaa|cccccccccccc/);
  assert.match(reason, /- TASK_IDLE on #7 \(bbbbbbbbbbbb\), acknowledged and 1 h past its due time/);
  assert.match(reason, /Gate sessions due to close \(1\):\n- assignment g1-1225-a1 on #7 \(finding dddddddddddd\)/);
  assert.match(reason, /archive it with the app's archive_session tool \(never this session\)/);
  assert.doesNotMatch(reason.split('Gate sessions due')[0], /dddddddddddd/);
});

test('O-2a an open pull request no task owns stops the turn once, named as a pull request; a store one has no #', t => {
  const fx = fixture(t).controller().writeTranscript().desktop().net([
    { id: 'aaaaaaaaaaaa', code: 'PR_UNOWNED', issue: 1261, state: 'new', changed_at: iso(NOW - 5 * HOUR) },
    { id: 'bbbbbbbbbbbb', code: 'PR_RED_UNOWNED', issue: 1443, state: 'acknowledged', changed_at: iso(NOW - 26 * HOUR), due: iso(NOW - 2 * HOUR) },
    { id: 'cccccccccccc', code: 'PR_UNOWNED', issue: 12, kind: 'store', state: 'new', changed_at: iso(NOW - 4 * HOUR) },
    { id: 'dddddddddddd', code: 'PR_UNOWNED', issue: 1471, state: 'new', changed_at: iso(NOW - 4 * HOUR + 60000) },
    { id: 'eeeeeeeeeeee', code: 'PR_UNOWNED', issue: 1472, state: 'acknowledged', changed_at: iso(NOW - 5 * HOUR), due: iso(NOW + HOUR) },
  ]);
  const first = fx.run();
  assert.equal(first.outcome, 'BLOCK');
  assert.match(first.output.reason, /Findings due \(3\):\n- PR_UNOWNED on PR #1261 \(aaaaaaaaaaaa\), new for 5 h\n- PR_UNOWNED on store PR 12 \(cccccccccccc\), new for 4 h\n- PR_RED_UNOWNED on PR #1443 \(bbbbbbbbbbbb\), acknowledged and 2 h past its due time/);
  assert.doesNotMatch(first.output.reason, /dddddddddddd|eeeeeeeeeeee|#12\b/);
  assert.deepEqual(fx.run(), { outcome: 'SHOWN', output: null }, 'the same list again is silent');
});

test('O-3 an added entry stops the turn again; a shorter list does not', t => {
  const fx = fixture(t).controller().writeTranscript().desktop();
  const one = { id: 'aaaaaaaaaaaa', code: 'TASK_IDLE', state: 'new', changed_at: iso(NOW - 5 * HOUR) };
  const two = { id: 'bbbbbbbbbbbb', code: 'TASK_IDLE', state: 'new', changed_at: iso(NOW - 6 * HOUR) };
  fx.net([one]);
  assert.equal(fx.run().outcome, 'BLOCK');
  fx.net([one, two]);
  assert.equal(fx.run().outcome, 'BLOCK');
  fx.net([two]);
  assert.equal(fx.run().outcome, 'SHOWN');
  fx.net([]);
  assert.equal(fx.run().outcome, 'NOTHING_OWED');
  // An entry that comes back after it was cleared is new again.
  fx.net([one]);
  assert.equal(fx.run().outcome, 'BLOCK');
});

test('O-4 gate, helper and non-controller sessions and ungoverned checkouts are never stopped', t => {
  const fx = fixture(t).controller().writeTranscript().desktop().net([{ code: 'TASK_IDLE', state: 'new', changed_at: iso(NOW - 9 * HOUR) }]);
  for (const name of LAUNCHER_MARKERS) {
    fx.deps.env = { CLAUDE_CODE_HOST_SESSION_ID: SELF, [name]: '1' };
    assert.deepEqual(fx.run(), { outcome: 'EXECUTOR', output: null }, name);
  }
  fx.deps.env = { CLAUDE_CODE_HOST_SESSION_ID: SELF };
  assert.equal(fx.run({ hook_event_name: 'PreToolUse' }).outcome, 'NOT_STOP');
  assert.equal(fx.run({ cwd: fx.dir }).outcome, 'NOT_GOVERNED');
  fx.deps.governanceState = () => ({ state: 'DISABLED' });
  assert.equal(fx.run().outcome, 'NOT_GOVERNED');
  fx.deps.governanceState = () => ({ state: 'ENABLED', programme_records_bind: true });
  // A session whose first message is a gate brief.
  const gate = fixture(t).brief('Gate: G1\nRoute: owner-claude BUILDER opus-5.5/high\nBuild it.').controller().writeTranscript();
  gate.deps.env = { CLAUDE_CODE_HOST_SESSION_ID: SELF };
  assert.deepEqual(gate.run(), { outcome: 'GATE', output: null });
  // A session that never acted as the controller.
  const plain = fixture(t).brief('Fix the typo.').shell('node programme.cjs attention').writeTranscript().net([{ code: 'TASK_IDLE', state: 'new', changed_at: iso(NOW - 9 * HOUR) }]);
  assert.deepEqual(plain.run(), { outcome: 'NOT_CONTROLLER', output: null });
});

test('O-5 finished side sessions in the desktop app are listed; open, running, waiting, kept and archived ones are not', t => {
  const fx = fixture(t).controller().writeTranscript().net([]).desktop({}, [
    finished(),
    finished({ prs: [{ prNumber: 6, state: 'OPEN' }] }),
    finished({ prs: [] }),
    finished({ isArchived: true }),
    finished({ autoArchiveExempt: true }),
    finished({ postTurnSummary: { status_category: 'blocked', needs_action: 'Owner: approve' } }),
    finished({ postTurnSummary: { status_category: 'completed', needs_action: 'Reply yes' } }),
    finished({ turnWrapUp: { needsUser: true } }),
    finished({ latestUserFrameAt: NOW }),
    finished({ postTurnSummaryFor: 'old' }),
    finished({ spawnedFrom: { sessionId: CHILD(999), title: 'Someone else' } }),
    finished({ prs: [{ prNumber: 7, state: 'CLOSED' }, { prNumber: 8, state: 'MERGED' }] }),
  ]);
  const { reason } = fx.run().output;
  assert.match(reason, /Finished side sessions, not archived \(2\):/);
  assert.match(reason, new RegExp(`- Side 100: session_id ${CHILD(100)}, PR #5 merged or closed`));
  assert.match(reason, new RegExp(`- Side 111: session_id ${CHILD(111)}, PR #7, #8 merged or closed`));
  assert.equal(reason.match(/session_id local_/g).length, 2);
});

test('O-6 desktop session files in an unknown format are one note, shown once, and never a block', t => {
  const fx = fixture(t).controller().writeTranscript().net([]).desktop({}, [{ ...finished(), isArchived: undefined, archived: false }]);
  const first = fx.run();
  assert.equal(first.outcome, 'NOTE');
  assert.equal(first.output.decision, undefined);
  assert.match(first.output.systemMessage, /^Toolkit could not read everything for the owed check: the Claude desktop app's session files are not in the format this check knows/);
  assert.deepEqual(fx.run(), { outcome: 'NOTHING_OWED', output: null });
  // An unknown pull request state, and this session's own file missing, are notes too.
  const states = fixture(t).controller().writeTranscript().net([]).desktop({}, [finished({ prs: [{ prNumber: 1, state: 'DRAFTED' }] })]);
  assert.match(states.run().output.systemMessage, /not in the format this check knows/);
  const missing = fixture(t).controller().writeTranscript().net([]);
  assert.match(missing.run().output.systemMessage, /this session's own file was not found/);
  // Outside the desktop app (no host session) the desktop part is skipped without a note.
  const cli = fixture(t).controller().writeTranscript().net([]);
  cli.deps.env = {};
  assert.deepEqual(cli.run(), { outcome: 'NOTHING_OWED', output: null });
});

test('O-7 a missing or older attention cache is a note; with other entries owed it rides on the block', t => {
  const fx = fixture(t).controller().writeTranscript().desktop();
  assert.match(fx.run().output.systemMessage, /the attention cache for toolkit-test-fixture\/owed is missing or older than this check/);
  const older = fixture(t).controller().launch(1).writeTranscript().desktop();
  cache.writeCache(older.repository, { line: 'Attention: fixture', counts: { new: 0, acknowledged: 0 }, digest: 'd', complete: true }, { home: older.home });
  const { reason } = older.run().output;
  assert.match(reason, /Gate launches with no gate-session record \(1\)/);
  assert.match(reason, /Toolkit could not read everything: the attention cache for toolkit-test-fixture\/owed is missing or older than this check/);
});

test('O-8 gate launches with no gate-session record, and archived gate sessions with no close, are listed', t => {
  const fx = fixture(t)
    .launch(1).launch(2).launch(3, { gate: 'none' }).launch(4, { error: true }).launch(5, { hoursAgo: 30 }).launch(6).launch(7)
    .record(2, 'g1-9-a2').record(6, 'g1-9-a6').record(7, 'g1-9-a7').archive(6).archive(7).record(7, 'g1-9-a7', { closed: true })
    .writeTranscript().net([]).desktop();
  const { reason } = fx.run().output;
  assert.match(reason, new RegExp(`Gate launches with no gate-session record \\(1\\):\\n- G1 "Gate 1": session_id ${CHILD(1)}\\n`));
  assert.match(reason, /Record each: node "[^"]*programme\.cjs" gate-session --issue <n> --assignment <id> --host claude-code --host-session <session_id>\. If it answers STALE_ASSIGNMENT/);
  assert.match(reason, /Record each: node "[^"]*programme\.cjs" gate-session --issue <n> --assignment <id> --closed\./);
  assert.match(reason, /Archived gate sessions with no close record \(1\):\n- assignment g1-9-a6 \(its session was archived\)/);
  assert.doesNotMatch(reason, /g1-9-a7|g1-9-a2/);
});

test('O-9 a launch whose session the desktop app shows archived owes no launch record; a refused archive counts for nothing', t => {
  const fx = fixture(t).launch(1).launch(2).record(2, 'g1-9-a2')
    .archive(2, { error: true, result: 'still working' }).writeTranscript().net([])
    .desktop({}, [{ sessionId: CHILD(1), isArchived: true, prs: [] }]);
  assert.deepEqual(fx.run(), { outcome: 'NOTHING_OWED', output: null });
});

test('O-10 the hook process prints one JSON block on stdout, exits 0, and stays silent on bad input', t => {
  const fx = fixture(t).controller().writeTranscript().desktop().net([{ code: 'TASK_IDLE', state: 'new', changed_at: iso(Date.now() - 5 * HOUR) }]);
  // The real process with the fixture's home; governance comes from the fixture's recorded binding.
  const env = { ...process.env, HOME: fx.home, USERPROFILE: fx.home, LOCALAPPDATA: path.join(fx.dir, 'local'), TOOLKIT_GOVERNANCE_OFFLINE: '1', CLAUDE_CODE_HOST_SESSION_ID: SELF };
  for (const name of LAUNCHER_MARKERS) delete env[name];
  const input = JSON.stringify({ hook_event_name: 'Stop', session_id: SESSION, transcript_path: fx.transcript, cwd: fx.work, stop_hook_active: false });
  const run = text => childProcess.spawnSync(process.execPath, [HOOK], { input: text, env, encoding: 'utf8', timeout: 30000, windowsHide: true });
  const first = run(input);
  assert.equal(first.status, 0, first.stderr);
  const output = JSON.parse(first.stdout);
  assert.equal(output.decision, 'block');
  assert.match(output.reason, /TASK_IDLE on #7/);
  assert.deepEqual([run(input).status, run(input).stdout], [0, '']);
  for (const bad of ['{broken', '', 'null']) assert.deepEqual([run(bad).status, run(bad).stdout], [0, ''], bad);
});

test('O-11 the per-session memory holds hashes only: no session IDs, titles, finding IDs or paths', t => {
  const fx = fixture(t).launch(1).writeTranscript().desktop({}, [finished()]).net([{ id: 'aaaaaaaaaaaa', code: 'TASK_IDLE', state: 'new', changed_at: iso(NOW - 5 * HOUR) }]);
  assert.equal(fx.run().outcome, 'BLOCK');
  const folder = path.join(fx.home, '.ai-agent-toolkit', 'user-state', 'owed-check');
  const files = fs.readdirSync(folder);
  assert.equal(files.length, 1);
  assert.equal(files[0].includes(SESSION), false);
  const text = fs.readFileSync(path.join(folder, files[0]), 'utf8');
  for (const secret of ['local_', 'Gate 1', 'Side 100', 'aaaaaaaaaaaa', fx.dir.replace(/\\/g, '\\\\'), SESSION]) assert.equal(text.includes(secret), false, secret);
  assert.deepEqual(Object.keys(JSON.parse(text)).sort(), ['keys', 'notes', 'schema']);
});

test('O-12 the attention cache keeps well-formed net entries and refuses a malformed list whole', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owed-cache-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const good = { id: 'abcdefabcdef', code: 'CLOSE_DUE', issue: 4, kind: 'g1-4-a1', state: 'new', changed_at: iso(NOW), due: null };
  assert.equal(cache.writeCache('acme/app', { complete: true, net: [good] }, { home: dir }), true);
  assert.deepEqual(cache.readCache('acme/app', { home: dir }).net, [good]);
  for (const bad of [[{ ...good, id: 'short' }], [{ ...good, kind: 'has space' }], [{ ...good, state: 'resolved' }], [{ ...good, issue: 0 }], [{ ...good, changed_at: 'nope' }],
    Array.from({ length: cache.NET_LIMIT + 1 }, () => good), 'x', undefined]) {
    assert.equal(cache.writeCache('acme/app', { complete: true, net: bad }, { home: dir }), false, JSON.stringify(bad)?.slice(0, 80));
    assert.deepEqual(cache.readCache('acme/app', { home: dir }).net, [good], 'the last good cache stays');
  }
  // Extra fields are not carried into the cache.
  cache.writeCache('acme/app', { complete: true, net: [{ ...good, detail: 'free text' }] }, { home: dir });
  assert.deepEqual(cache.readCache('acme/app', { home: dir }).net, [good]);
  assert.equal(fs.readFileSync(cache.cacheFile('acme/app', { home: dir }), 'utf8').includes('free text'), false);
});

test('O-13 a block from an attention cache over an hour old says how old it is', t => {
  const fx = fixture(t).controller().writeTranscript().desktop();
  const entry = { id: 'aaaaaaaaaaaa', issue: 7, kind: null, due: null, code: 'TASK_IDLE', state: 'new', changed_at: iso(NOW - 8 * HOUR) };
  cache.writeCache(fx.repository, { complete: true, net: [entry] }, { home: fx.home, now: () => iso(NOW - 3 * HOUR) });
  assert.match(fx.run().output.reason, /Findings due \(1, from the attention cache as of 3 h ago\):/);
  // A fresh cache adds nothing.
  const fresh = fixture(t).controller().writeTranscript().desktop().net([entry]);
  assert.match(fresh.run().output.reason, /Findings due \(1\):/);
});

test('O-14 when its memory file cannot be saved, the check notes the owed entries and never stops the turn', t => {
  const fx = fixture(t).controller().writeTranscript().desktop().net([{ code: 'TASK_IDLE', state: 'new', changed_at: iso(NOW - 5 * HOUR) }]);
  // A plain file where the memory folder goes (in the fixture's own temp home) makes every save fail.
  const folder = path.join(fx.home, '.ai-agent-toolkit', 'user-state');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'owed-check'), 'not a folder');
  for (let turn = 0; turn < 2; turn += 1) {
    const result = fx.run();
    assert.equal(result.outcome, 'NO_MEMORY');
    assert.equal(result.output.decision, undefined);
    assert.match(result.output.systemMessage, /1 entries owed, but its memory file could not be saved, so the turn was not stopped/);
  }
});

// The CLAUDE_CODE_* variables a hook sees in a top-level desktop chat, with fake values.
const DESKTOP_ENV = Object.freeze({
  CLAUDECODE: '1',
  CLAUDE_CODE_ACCOUNT_UUID: '00000000-0000-4000-8000-0000000000a1', CLAUDE_CODE_CHILD_NOTES_DIR: 'fixture-notes', CLAUDE_CODE_CHILD_SESSION: '1',
  CLAUDE_CODE_DESKTOP_APP_VERSION: '0.0.0-fixture', CLAUDE_CODE_DISABLE_CRON: '1', CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '1', CLAUDE_CODE_EAGER_FLUSH: '1',
  CLAUDE_CODE_EMIT_STARTUP_TIMING: '1', CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES: '1', CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL: '1',
  CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING: '1', CLAUDE_CODE_ENTRYPOINT: 'claude-desktop', CLAUDE_CODE_EXECPATH: 'fixture-claude',
  CLAUDE_CODE_HOST_SESSION_ID: SELF, CLAUDE_CODE_HOST_SHORT_TEMP_DIRS: '1', CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '1', CLAUDE_CODE_MESSAGING_SOCKET: 'fixture-socket',
  CLAUDE_CODE_MESSAGING_TOKEN: 'fixture', CLAUDE_CODE_ORGANIZATION_UUID: '00000000-0000-4000-8000-0000000000a2', CLAUDE_CODE_REPORT_FINDINGS: '1',
  CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH: '1', CLAUDE_CODE_SESSION_ATTENDED: '1', CLAUDE_CODE_SESSION_ID: SESSION,
  CLAUDE_CODE_SIMPLE: '1', CLAUDE_CODE_STARTUP_FAILURE_RESULTS: '1', CLAUDE_CODE_TERMINAL_MCP_TOOLS: '1', CLAUDE_CODE_USER_EMAIL: 'owner@example.com',
});
// The variables a hook sees in a plain CLI chat, with fake values.
const CLI_ENV = Object.freeze({ CLAUDECODE: '1', CLAUDE_CODE_CHILD_SESSION: '1', CLAUDE_CODE_SESSION_ID: SESSION, CLAUDE_CODE_SESSION_ATTENDED: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' });
// The two Claude Code shapes: the desktop app (with its session files and one finished side session)
// and a plain CLI (no desktop files).
const SHAPES = Object.freeze([
  { name: 'desktop app', env: DESKTOP_ENV, setup: fx => fx.desktop({}, [finished()]), side: true },
  { name: 'plain CLI', env: CLI_ENV, setup: fx => fx, side: false },
]);

test('O-15 a top-level controller is stopped the same in the desktop app and a plain CLI; the desktop files only add the side-session section', t => {
  for (const shape of SHAPES) {
    const fx = shape.setup(fixture(t).launch(1).writeTranscript().net([{ code: 'TASK_IDLE', state: 'new', changed_at: iso(NOW - 5 * HOUR) }]));
    fx.deps.env = { ...shape.env };
    const result = fx.run();
    assert.equal(result.outcome, 'BLOCK', shape.name);
    assert.match(result.output.reason, /Findings due \(1\):\n- TASK_IDLE on #7/, shape.name);
    assert.match(result.output.reason, new RegExp(`Gate launches with no gate-session record \\(1\\):\\n- G1 "Gate 1": session_id ${CHILD(1)}`), shape.name);
    assert.equal(/Finished side sessions, not archived/.test(result.output.reason), shape.side, shape.name);
    assert.doesNotMatch(result.output.reason, /could not read everything/, shape.name);
    // The real hook process, with only the shape's host variables: none of this run's own Claude
    // variables or launcher marks (the test runner's own settings, such as its clock offset, stay).
    const live = shape.setup(fixture(t).launch(1).writeTranscript().net([{ code: 'TASK_IDLE', state: 'new', changed_at: iso(Date.now() - 5 * HOUR) }]));
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^CLAUDE/i.test(key) && !LAUNCHER_MARKERS.includes(key)));
    Object.assign(env, { HOME: live.home, USERPROFILE: live.home, LOCALAPPDATA: path.join(live.dir, 'local'), TOOLKIT_GOVERNANCE_OFFLINE: '1' }, shape.env);
    const input = JSON.stringify({ hook_event_name: 'Stop', session_id: SESSION, transcript_path: live.transcript, cwd: live.work, stop_hook_active: false });
    const run = childProcess.spawnSync(process.execPath, [HOOK], { input, env, encoding: 'utf8', timeout: 30000, windowsHide: true });
    assert.equal(run.status, 0, run.stderr);
    assert.notEqual(run.stdout.trim(), '', `${shape.name}: the hook process printed nothing, so it did not stop the turn`);
    const output = JSON.parse(run.stdout);
    assert.equal(output.decision, 'block', shape.name);
    assert.match(output.reason, /TASK_IDLE on #7/, shape.name);
  }
});

test('O-16 in both shapes, gate briefs, launcher marks, a repeated stop and non-controller sessions stay silent', t => {
  const due = [{ code: 'TASK_IDLE', state: 'new', changed_at: iso(NOW - 9 * HOUR) }];
  for (const shape of SHAPES) {
    const run = (fx, input, extraEnv = {}) => { fx.deps.env = { ...shape.env, ...extraEnv }; return fx.run(input); };
    const gate = shape.setup(fixture(t).brief('Gate: G2\nRoute: owner-claude BUILDER opus-5.5/high\nReview it.').launch(1).writeTranscript().net(due));
    assert.deepEqual(run(gate), { outcome: 'GATE', output: null }, shape.name);
    const controller = shape.setup(fixture(t).launch(1).writeTranscript().net(due));
    for (const name of LAUNCHER_MARKERS) {
      assert.deepEqual(run(controller, {}, { [name]: 'fixture' }), { outcome: 'EXECUTOR', output: null }, `${shape.name} ${name}`);
    }
    assert.deepEqual(run(controller, { stop_hook_active: true }), { outcome: 'ALREADY_BLOCKED', output: null }, shape.name);
    const side = shape.setup(fixture(t).brief('Fix the typo.').shell('node programme.cjs attention').writeTranscript().net(due));
    assert.deepEqual(run(side), { outcome: 'NOT_CONTROLLER', output: null }, shape.name);
  }
});

test('O-17 the launcher-marker copies kept for a module failure match the shared list', () => {
  for (const file of ['toolkit-claude-agent-hook.cjs', 'toolkit-codex-helper-hook.cjs', 'toolkit-governance-gate.cjs']) {
    const text = fs.readFileSync(path.join(ROOT, 'repo', 'scripts', file), 'utf8');
    const copy = /const LAUNCHER_MARKERS = (?:Object\.freeze\()?\[([^\]]*)\]/.exec(text);
    assert.ok(copy, file);
    assert.deepEqual(copy[1].split(',').map(name => name.trim().replace(/^'|'$/g, '')), [...LAUNCHER_MARKERS], file);
  }
});

const DUE = [{ code: 'TASK_IDLE', state: 'new', changed_at: iso(NOW - 9 * HOUR) }];
const ACK = 'ack --finding abcdefabcdef --next "x" --session ctl --controller';

// Rows Claude Code copied from another chat, in the three shapes it writes: a file copy keeps the other
// chat's session id, a branch rewrites the id and adds forkedFrom, and a continuation under a new id
// (the desktop app's rewind, or a CLI resume with --fork-session) rewrites the id and names the old one
// on assistant rows only.
const fileCopy = row => ({ ...row, sessionId: PARENT });
const branched = row => ({ ...row, forkedFrom: { sessionId: PARENT, messageUuid: 'u1' }, ...(row.type === 'assistant' ? { requestSessionId: PARENT } : {}) });
const continued = row => ({ ...row, ...(row.type === 'assistant' ? { requestSessionId: PARENT } : {}) });
// The other chat's own transcript beside this one, with its last turn that many hours ago.
const parentFile = (fx, hoursAgo) => fs.writeFileSync(path.join(fx.dir, `${PARENT}.jsonl`),
  [30, hoursAgo].map(age => JSON.stringify({ type: 'assistant', sessionId: PARENT, timestamp: iso(NOW - age * HOUR), message: { role: 'assistant', content: [{ type: 'text', text: 'x' }] } })).join('\n') + '\n');
// A chat that only answers a question, after the rows so far: what a side chat's own rows hold.
const asks = fx => fx.call({ name: 'Read', input: { file_path: 'README.md' }, hoursAgo: 0.5 });

test('O-18 rows copied from the controller\'s chat never make a fork, side chat or branch the controller', t => {
  for (const shape of SHAPES) {
    for (const [name, asCopy] of Object.entries({ 'file copy (Fork, /btw, a forked side session)': fileCopy, 'branch (forkedFrom)': branched })) {
      const copy = asks(shape.setup(fixture(t)).launch(1).controller().copied(asCopy)).writeTranscript().net(DUE);
      copy.deps.env = { ...shape.env };
      assert.deepEqual(copy.run(), { outcome: 'NOT_CONTROLLER', output: null }, `${shape.name}: ${name}`);
      // The control: the same copied rows, then the chat's own controller command. Only its own launch is listed.
      const own = shape.setup(fixture(t)).launch(1).controller().copied(asCopy).launch(2).controller().writeTranscript().net(DUE);
      own.deps.env = { ...shape.env };
      const result = own.run();
      assert.equal(result.outcome, 'BLOCK', `${shape.name}: ${name}, own rows`);
      assert.match(result.output.reason, new RegExp(`Gate launches with no gate-session record \\(1\\):\\n- G1 "Gate 2": session_id ${CHILD(2)}`));
    }
    // A CLI resume with --fork-session while the controller's own chat goes on.
    const forked = asks(shape.setup(fixture(t)).launch(1, { hoursAgo: 3 }).copied(continued)).writeTranscript().net(DUE);
    parentFile(forked, 0.1);
    forked.deps.env = { ...shape.env };
    assert.deepEqual(forked.run(), { outcome: 'NOT_CONTROLLER', output: null }, `${shape.name}: --fork-session`);
  }
});

test('O-19 a resumed controller chat still counts: same id after a restart or compaction, or a new id the chat continued under', t => {
  // The same session id after a restart (another host version) and a compaction: the rows stay its own.
  const same = fixture(t).launch(1);
  same.rows.forEach(row => { row.version = '2.1.330'; });
  same.rows.push({ type: 'system', subtype: 'compact_boundary', sessionId: SESSION, timestamp: iso(NOW - HOUR) },
    { type: 'user', isCompactSummary: true, sessionId: SESSION, timestamp: iso(NOW - HOUR), message: { role: 'user', content: 'summary' } });
  asks(same).writeTranscript().net(DUE);
  assert.equal(same.run().outcome, 'BLOCK');
  // A new id with the earlier rows carried over (the desktop app's rewind): the chat left the old id
  // before the new one began, or its old transcript is gone.
  for (const [name, setup] of Object.entries({ 'the old transcript stopped': fx => parentFile(fx, 2), 'the old transcript is gone': () => {} })) {
    const resumed = asks(fixture(t).launch(1, { hoursAgo: 3 }).copied(continued)).writeTranscript().net(DUE);
    setup(resumed);
    const result = resumed.run();
    assert.equal(result.outcome, 'BLOCK', name);
    assert.match(result.output.reason, new RegExp(`session_id ${CHILD(1)}`), name);
  }
  // An old id that is not a session id is never read as a path: the rows still count.
  const odd = asks(fixture(t).launch(1, { hoursAgo: 3 }).copied(row => ({ ...continued(row), ...(row.type === 'assistant' ? { requestSessionId: '../outside' } : {}) }))).writeTranscript().net(DUE);
  assert.equal(odd.run().outcome, 'BLOCK');
});

test('O-20 only a command that runs programme.cjs with --controller counts, never one that mentions it', t => {
  const script = 'C:/Users/owner/.ai-agent-toolkit/repo/skills/github-program-reconciler/scripts/programme.cjs';
  const runs = [
    ['Bash', `node "${script}" ${ACK}`],
    ['Bash', `cd repo && timeout 60 node skills/github-program-reconciler/scripts/programme.cjs ${ACK} 2>&1 | tail -5`],
    ['Bash', `P="${script}"\nnode "$P" ${ACK}`],
    ['Bash', `P='node ${script}'; $P ${ACK}`],
    ['Bash', `A='--session ctl --controller'; node ${script} ack --finding abcdefabcdef --next x $A`],
    ['Bash', `for id in a b; do node "${script}" ack --finding $id --next x --session ctl --controller; done`],
    ['Bash', `out=$(node ${script} ${ACK}) && echo "$out"`],
    ['Bash', `bash -c 'node ${script} ${ACK}'`],
    ['Bash', `run() { node "${script}" "$@" --session ctl --controller; }\nrun ack --finding abcdefabcdef --next x`],
    ['PowerShell', `node "${script.replace(/\//g, '\\')}" ${ACK}`],
    ['PowerShell', `$p = "${script}"\n& node $p ${ACK}`],
    ['PowerShell', `$out = node.exe ${script} ${ACK}; $out | Select-Object -Last 5`],
    ['PowerShell', `foreach ($id in 'a','b') { node ${script} ack --finding $id --next x --session ctl --controller }`],
  ];
  const mentions = [
    ['Bash', 'grep -n -- " --controller" skills/github-program-reconciler/scripts/programme.cjs'],
    ['Bash', 'rg -n "programme.cjs attention --controller" repo/tests'],
    ['Bash', 'git commit -m "programme.cjs: refuse --controller without a session"'],
    ['Bash', 'gh issue comment 7 --body "run node programme.cjs ack --session ctl --controller"'],
    ['Bash', 'echo node programme.cjs ack --session ctl --controller'],
    ['Bash', `node ${script} reconcile --controller --help`],
    ['Bash', `node ${script} attention && grep -rn -- --controller repo/docs`],
    ['Bash', `cat > notes.md <<'EOF'\nnode programme.cjs ${ACK}\nEOF`],
    ['Bash', `node -e "console.log('programme.cjs --controller')" -- --controller`],
    ['Bash', `node repo/tests/fixture.cjs programme.cjs --controller`],
    ['PowerShell', 'Select-String -Path repo/docs/*.md -Pattern "programme.cjs .* --controller"'],
    ['PowerShell', `Get-Content ${script} | Select-String -- ' --controller'`],
  ];
  for (const [rows, expected] of [[runs, 'BLOCK'], [mentions, 'NOT_CONTROLLER']]) {
    for (const [name, command] of rows) {
      const fx = fixture(t).brief('What does the flag do?').call({ name, input: { command } }).writeTranscript().net(DUE);
      assert.equal(fx.run().outcome, expected, `${name}: ${command}`);
    }
  }
});

test('O-21 a gate is what the route check says: a Gate line with a Route line, in a brief or a launch', t => {
  const route = 'Route: owner-claude BUILDER opus-5.5/high';
  const briefs = [
    ['Gate: G2\nRoute: owner-claude opus opus-5.5/xhigh\nReview it.', 'GATE'],
    [`Background (from the session that started this one):\nGate: G1\n${route}\n\nTask:\nBuild.`, 'GATE'],
    ['You are taking over as controller.\nGate: G1 of PR 5 is running.\n', 'BLOCK'],
    ['Gate: please check the two reviews\nYou are the controller.', 'BLOCK'],
    ['Gate: none\nCheck the docs.', 'BLOCK'],
  ];
  for (const [text, expected] of briefs) {
    const fx = fixture(t).brief(text).controller().writeTranscript().net(DUE);
    assert.equal(fx.run().outcome, expected, text);
    assert.equal(routeSaysGate(text), expected === 'GATE', text);
  }
  // A launch: the brief as the started session reads it (background, then prompt), and a start that happened.
  const started = `Started session "Gate 1" (session_id: ${CHILD(1)}, name: gate-1). It runs on its own.`;
  const launches = [
    [{ prompt: `Gate: G1\n${route}\nBuild.` }, started, 'BLOCK'],
    [{ background: `Gate: G1\n${route}`, prompt: 'Build.' }, started, 'BLOCK'],
    [{ prompt: 'Gate: please look at these\nRead the docs.' }, started, 'NOT_CONTROLLER'],
    [{ prompt: 'Gate: G1 of PR 5 is running; summarise its notes.' }, started, 'NOT_CONTROLLER'],
    [{ prompt: `Gate: G1\n${route}\nBuild.`, initiation: 'own_initiative' }, 'Proposed as a card (task_id: task_1). It starts when the user clicks it.', 'NOT_CONTROLLER'],
  ];
  for (const [input, result, expected] of launches) {
    const fx = fixture(t).brief('Help me plan.').call({ name: 'mcp__ccd_session__start_session', input: { initiation: 'user_asked', title: 'Gate 1', ...input }, result }).writeTranscript().net([]);
    assert.equal(fx.run().outcome, expected, JSON.stringify(input));
  }
});

test('O-22 a record counts by what programme.cjs accepted on this computer, never by the words of a command', t => {
  // Made through a script file or shell variables: the transcript never spells the command out.
  const made = fixture(t).launch(1).launch(2).launch(3).record(1, 'g1-9-a1').record(2, 'g1-9-a2')
    .shell('node .tmp/record-gates.cjs').shell('P=x; W="--host claude-code"; node $P gate-session $A $W')
    .archive(2).record(2, 'g1-9-a2', { closed: true }).record(3, 'g2-9-a3').writeTranscript().net([]).desktop();
  assert.deepEqual(made.run(), { outcome: 'NOTHING_OWED', output: null });
  // Refused: the command is spelled out and its call did not fail (a pipe hid the exit code), yet nothing was accepted.
  const refused = fixture(t).launch(1).launch(2).record(2, 'g1-9-a2').archive(2)
    .shell(`node programme.cjs gate-session --issue 9 --assignment g1-9-a1 --host claude-code --host-session ${CHILD(1)} --session ctl --controller | tail -3`, { result: 'STALE_ASSIGNMENT: #9 has no gate session entry' })
    .shell('node programme.cjs gate-session --issue 9 --assignment g1-9-a2 --closed --session ctl --controller | tail -3', { result: 'ROLE_REFUSED: not the holder' })
    .writeTranscript().net([]).desktop();
  const { reason } = refused.run().output;
  assert.match(reason, new RegExp(`Gate launches with no gate-session record \\(1\\):\\n- G1 "Gate 1": session_id ${CHILD(1)}\\n`));
  assert.match(reason, /Archived gate sessions with no close record \(1\):\n- assignment g1-9-a2 \(its session was archived\)/);
  // Another repository's record, and one for another session, do not count.
  const other = fixture(t).launch(1).record(2, 'g1-9-a2').writeTranscript().net([]).desktop();
  cache.writeGateSession('toolkit-test-fixture/other', { issue: 9, assignment: 'g1-9-a1', session: CHILD(1) }, { home: other.home });
  assert.match(other.run().output.reason, /Gate launches with no gate-session record \(1\)/);
});

test('O-23 a replaced session owes nothing more; its assignment\'s close is owed only for the current session', t => {
  // Session 1 was recorded, then session 2 took over the same assignment (gate-session --replace).
  const fx = fixture(t).launch(1).launch(2).record(1, 'g1-9-a1').record(2, 'g1-9-a1').archive(1).writeTranscript().net([]).desktop();
  assert.deepEqual(fx.run(), { outcome: 'NOTHING_OWED', output: null });
  const both = fixture(t).launch(1).launch(2).record(1, 'g1-9-a1').record(2, 'g1-9-a1').archive(1).archive(2).writeTranscript().net([]).desktop();
  assert.match(both.run().output.reason, /Archived gate sessions with no close record \(1\):\n- assignment g1-9-a1 /);
});

test('O-24 gate records that cannot be read are one note, and never an owed entry', t => {
  const fx = fixture(t).launch(1).writeTranscript().net([]).desktop();
  const folder = cache.cacheFile(fx.repository, { home: fx.home }).replace(/\.json$/, '.gates');
  fs.writeFileSync(folder, 'not a folder');
  const first = fx.run();
  assert.equal(first.outcome, 'NOTE');
  assert.match(first.output.systemMessage, /the gate sessions recorded on this computer could not be read, so gate launches and closes were not checked/);
  assert.deepEqual(fx.run(), { outcome: 'NOTHING_OWED', output: null });
  // One broken file among good ones is left out alone.
  const broken = fixture(t).launch(1).launch(2).record(1, 'g1-9-a1').record(2, 'g1-9-a2').writeTranscript().net([]).desktop();
  const gates = cache.cacheFile(broken.repository, { home: broken.home }).replace(/\.json$/, '.gates');
  for (const name of fs.readdirSync(gates)) if (fs.readFileSync(path.join(gates, name), 'utf8').includes('g1-9-a2')) fs.writeFileSync(path.join(gates, name), '{broken');
  assert.match(broken.run().output.reason, new RegExp(`no gate-session record \\(1\\):\\n- G1 "Gate 2": session_id ${CHILD(2)}\\n`));
});

test('O-25 a session held before its go-ahead owes no record; the go-ahead makes it owed', t => {
  const owed = n => new RegExp(`Gate launches with no gate-session record \\(1\\):\\n- G1 "Gate ${n}": session_id ${CHILD(n)}\\n`);
  // Held: nothing owed, whatever else runs, and a pure idle subscription or a message to another session is not a go-ahead.
  const held = fixture(t).held(1).send({ to: CHILD(1), message: '', notify_when_idle: true }).send({ to: CHILD(2) })
    .send({ to: CHILD(1) }, { error: true, result: 'refused' }).send({ to: CHILD(1) }, { result: '{"success":false,"message":"not listed"}' }).writeTranscript().net([]);
  assert.deepEqual(held.run().output?.decision, undefined, JSON.stringify(held.run()));
  // The same session once its go-ahead was sent, by id, by name, by title with its reference, or through the app's own tool.
  for (const send of [fx => fx.send({ to: CHILD(1) }), fx => fx.send({ to: 'gate-1' }), fx => fx.send({ to: 'Gate 1 [aee3f8]' }),
    fx => fx.call({ name: 'mcp__ccd_session_mgmt__send_message', input: { session_id: CHILD(1), message: 'Go ahead.' } })]) {
    assert.match(send(fixture(t).held(1)).writeTranscript().net([]).run().output.reason, owed(1));
  }
  // Recorded after the go-ahead: nothing owed.
  assert.equal(fixture(t).held(1).send({ to: CHILD(1) }).record(1, 'g1-9-a1').writeTranscript().net([]).run().output?.decision, undefined);
  // The day to record in starts at the go-ahead; a session that was not held starts at its launch.
  assert.match(fixture(t).held(1, { hoursAgo: 40 }).send({ to: CHILD(1) }, { hoursAgo: 2 }).writeTranscript().net([]).run().output.reason, owed(1));
  assert.equal(fixture(t).controller().launch(1, { hoursAgo: 40 }).send({ to: CHILD(1) }, { hoursAgo: 2 }).writeTranscript().net([]).run().output?.decision, undefined);
  // Only a brief line that starts with "First turn:" and names READY holds a session; a later mention does not.
  for (const brief of ['', 'When CI is green mark the PR READY.', 'Report READY after the first turn: see the plan.', 'First turn: read the plan and start.', 'First turn: reply ready when you have read it.']) {
    assert.match(fixture(t).launch(1, { brief }).writeTranscript().net([]).run().output.reason, owed(1), brief);
  }
  for (const brief of ['First turn: reply only READY.', '- **First turn:** reply READY, then stop.', '  first turn: read AGENTS.md, then reply only `READY`.\r']) {
    assert.equal(fixture(t).launch(1, { brief }).writeTranscript().net([]).run().output?.decision, undefined, brief);
  }
});

test('O-26 the desktop app\'s own file shows a held session that went on: it owes its record', t => {
  const child = extra => ({ sessionId: CHILD(1), isArchived: false, prs: [], ...extra });
  const run = extra => fixture(t).held(1).writeTranscript().net([]).desktop({}, [child(extra)]).run();
  // Its one turn ended with READY, and nothing came since.
  assert.deepEqual(run({ completedTurns: 1, lastTurnEdgeAt: NOW - HOUR, latestUserFrameAt: NOW - 2 * HOUR }), { outcome: 'NOTHING_OWED', output: null });
  assert.deepEqual(run({ latestUserFrameAt: NOW - 2 * HOUR }), { outcome: 'NOTHING_OWED', output: null }, 'still in its first turn');
  assert.deepEqual(run({ completedTurns: 0, lastTurnEdgeAt: NOW - 3 * HOUR, latestUserFrameAt: NOW - 2 * HOUR }), { outcome: 'NOTHING_OWED', output: null }, 'no turn of it ended yet');
  // The owner or another chat sent it on: a message after its first turn, or a second turn.
  assert.match(run({ completedTurns: 1, lastTurnEdgeAt: NOW - 2 * HOUR, latestUserFrameAt: NOW - HOUR }).output.reason, /Gate launches with no gate-session record \(1\)/);
  assert.match(run({ completedTurns: 2, lastTurnEdgeAt: NOW - HOUR, latestUserFrameAt: NOW - 2 * HOUR }).output.reason, /Gate launches with no gate-session record \(1\)/);
});

test('O-27 the stop text asks for what is owed only, never the last message or its question again', t => {
  const { reason } = fixture(t).launch(1).writeTranscript().net([]).desktop().run().output;
  assert.match(reason, /^Toolkit owed check: this turn leaves work owed\. Do each step now, or say in one line why it waits\. Add only what you did: do not repeat your last message or ask its question again\.\n/);
});

test('O-28 no row carried over counts once any chat it names went on, however the copy was made', t => {
  // A copy of a controller chat that was itself rewound: its older rows name the first, stopped id and
  // its newer ones the chat that goes on.
  const GRAND = '00000000-0000-4000-8000-0000000000b3';
  const carried = id => row => ({ ...row, ...(row.type === 'assistant' ? { requestSessionId: id } : {}) });
  const chain = fixture(t).launch(1, { hoursAgo: 5 }).copied(carried(GRAND));
  chain.rows.push(...fixture(t).launch(2, { hoursAgo: 4 }).rows.map(carried(PARENT)).map(row => JSON.parse(JSON.stringify(row).replaceAll('toolu_', 'toolu_b'))));
  asks(chain).writeTranscript().net(DUE);
  fs.writeFileSync(path.join(chain.dir, `${GRAND}.jsonl`), `${JSON.stringify({ type: 'assistant', sessionId: GRAND, timestamp: iso(NOW - 20 * HOUR), message: { role: 'assistant', content: [] } })}\n`);
  parentFile(chain, 0.1);
  assert.deepEqual(chain.run(), { outcome: 'NOT_CONTROLLER', output: null });
  // The control: neither chat went on (a controller rewound twice), so its rows still count.
  parentFile(chain, 3.9);
  assert.equal(chain.run().outcome, 'BLOCK');
});

test('O-29 what shows that the old chat went on: its own talk after this one began, read only from a session file beside it', t => {
  const carriedOn = rows => {
    const fx = asks(fixture(t).launch(1, { hoursAgo: 3 }).copied(continued)).writeTranscript().net(DUE);
    fs.writeFileSync(path.join(fx.dir, `${PARENT}.jsonl`), rows.map(row => JSON.stringify({ sessionId: PARENT, timestamp: iso(NOW - 0.1 * HOUR), ...row })).join('\n') + '\n');
    return fx.run().outcome;
  };
  const talk = type => ({ type, message: { role: type, content: [{ type: 'text', text: 'x' }] } });
  assert.equal(carriedOn([talk('user')]), 'NOT_CONTROLLER', 'a user row');
  assert.equal(carriedOn([talk('assistant')]), 'NOT_CONTROLLER', 'an assistant row');
  assert.equal(carriedOn([{ type: 'system', subtype: 'turn_duration' }]), 'BLOCK', 'the host\'s own row is not talk');
  assert.equal(carriedOn([{ ...talk('assistant'), isSidechain: true }]), 'BLOCK', 'a subagent\'s row is not the chat');
  // A path in place of an id is never read, even where a file that went on waits at its end.
  const odd = asks(fixture(t).launch(1, { hoursAgo: 3 }).copied(row => ({ ...continued(row), ...(row.type === 'assistant' ? { requestSessionId: '../planted/chat' } : {}) })));
  odd.transcript = path.join(odd.dir, 'chats', `${SESSION}.jsonl`);
  fs.mkdirSync(path.join(odd.dir, 'chats'));
  fs.mkdirSync(path.join(odd.dir, 'planted'));
  fs.writeFileSync(odd.transcript, odd.rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  fs.writeFileSync(path.join(odd.dir, 'planted', 'chat.jsonl'), `${JSON.stringify({ sessionId: PARENT, timestamp: iso(NOW - 0.1 * HOUR), ...talk('assistant') })}\n`);
  odd.net(DUE);
  assert.equal(odd.run({ transcript_path: odd.transcript }).outcome, 'BLOCK');
});

test('O-30 a launch reads its brief as the started session does, and only node runs programme.cjs', t => {
  const started = `Started session "Gate 1" (session_id: ${CHILD(1)}, name: gate-1). It runs on its own.`;
  const launch = input => fixture(t).brief('Help me plan.').call({ name: 'mcp__ccd_session__start_session', input: { initiation: 'user_asked', title: 'Gate 1', prompt: 'Build.', background: 'Gate: G1\nRoute: owner-claude BUILDER opus-5.5/high', ...input }, result: started }).writeTranscript().net([]).run().outcome;
  assert.equal(launch({}), 'BLOCK');
  assert.equal(launch({ context: 'fork' }), 'NOT_CONTROLLER', 'a fork takes no background');
  for (const program of ['python', 'deno run', 'cat']) {
    const fx = fixture(t).brief('What does it do?').shell(`${program} scripts/programme.cjs ${ACK}`).writeTranscript().net(DUE);
    assert.deepEqual(fx.run(), { outcome: 'NOT_CONTROLLER', output: null }, program);
  }
});

test('O-31 the gate session cache keeps hashes only, the newest session last, and drops month-old records', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owed-gates-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const at = hours => ({ home: dir, now: () => iso(NOW + hours * HOUR) });
  assert.deepEqual(cache.readGateSessions('acme/app', { home: dir }), []);
  for (const bad of [{ issue: 0, assignment: 'a' }, { issue: 9, assignment: 'has space' }, { issue: 9, assignment: '../up' }]) assert.equal(cache.writeGateSession('acme/app', bad, at(0)), false, JSON.stringify(bad));
  assert.equal(cache.writeGateSession('not a repository', { issue: 9, assignment: 'a1' }, at(0)), false);
  cache.writeGateSession('acme/app', { issue: 9, assignment: 'a1', session: CHILD(1) }, at(0));
  cache.writeGateSession('acme/app', { issue: 8, assignment: 'a1', session: CHILD(3) }, at(0));
  cache.writeGateSession('acme/app', { issue: 9, assignment: 'a1', session: CHILD(2) }, at(1));
  cache.writeGateSession('Acme/App', { issue: 9, assignment: 'a1', closed: true }, at(2));
  const mine = cache.readGateSessions('acme/app', { home: dir }).find(record => record.issue === 9);
  assert.deepEqual(mine, { issue: 9, assignment: 'a1', sessions: [cache.gateSessionHash(CHILD(1)), cache.gateSessionHash(CHILD(2))], closed: true, at: iso(NOW + 2 * HOUR) });
  assert.equal(cache.readGateSessions('acme/app', { home: dir }).length, 2, 'one record per task and assignment');
  const folder = cache.cacheFile('acme/app', { home: dir }).replace(/\.json$/, '.gates');
  for (const name of fs.readdirSync(folder)) assert.equal(fs.readFileSync(path.join(folder, name), 'utf8').includes('local_'), false, name);
  for (let n = 10; n < 25; n += 1) cache.writeGateSession('acme/app', { issue: 9, assignment: 'a1', session: CHILD(n) }, at(3));
  const kept = cache.readGateSessions('acme/app', { home: dir }).find(record => record.issue === 9).sessions;
  assert.equal(kept.length, 10);
  assert.equal(kept.at(-1), cache.gateSessionHash(CHILD(24)));
  cache.writeGateSession('acme/app', { issue: 9, assignment: 'a2', session: CHILD(4) }, { home: dir, now: () => iso(NOW + cache.GATE_KEEP_MS + HOUR / 2) });
  assert.deepEqual(cache.readGateSessions('acme/app', { home: dir }).map(record => `${record.issue} ${record.assignment}`).sort(), ['9 a1', '9 a2'], 'the month-old record of #8 is gone');
});

// Whether the route check itself reads a first prompt as a gate.
function routeSaysGate(text) {
  const gateRoute = require(path.join(ROOT, 'repo', 'scripts', 'toolkit-gate-route.cjs'));
  return gateRoute.evaluate({ environment: {}, transcript: { brief: text, model: null, effort: null } }).gate !== null;
}
