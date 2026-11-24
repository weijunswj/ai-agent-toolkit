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
  const transcript = path.join(dir, 'transcript.jsonl');
  const fx = {
    dir, home, work, sessions, transcript, repository: 'toolkit-test-fixture/owed',
    deps: { home, nowMs: NOW, localAppData: path.join(dir, 'local'), startRefresh: () => {}, governanceState: () => (governed ? { state: 'ENABLED', programme_records_bind: true } : { state: 'DISABLED' }),
      env: { CLAUDE_CODE_HOST_SESSION_ID: SELF } },
    rows: [],
    // Transcript rows, in order; each call is { name, input, at (hours ago), result, error }.
    brief(text) { fx.rows.unshift({ type: 'user', message: { role: 'user', content: text }, timestamp: iso(NOW - 30 * HOUR) }); return fx; },
    call({ name, input, hoursAgo = 1, result = 'ok', error = false }) {
      const id = `toolu_${fx.rows.length}`;
      fx.rows.push({ type: 'assistant', timestamp: iso(NOW - hoursAgo * HOUR), message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
      fx.rows.push({ type: 'user', timestamp: iso(NOW - hoursAgo * HOUR), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: result }], ...(error ? { is_error: true } : {}) }] } });
      return fx;
    },
    launch(n, { gate = 'G1', hoursAgo = 1, error = false } = {}) {
      return fx.call({ name: 'mcp__ccd_session__start_session', hoursAgo, error, input: { initiation: 'user_asked', title: `Gate ${n}`, prompt: `Gate: ${gate}\nRoute: owner-claude BUILDER opus-5.5/high\nTask ${n}` },
        result: error ? 'refused' : `Started session "Gate ${n}" (session_id: ${CHILD(n)}, name: gate-${n}). It runs on its own.` });
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
    run(input = {}) { return hook.check({ hook_event_name: 'Stop', session_id: 'cli-session-1', transcript_path: transcript, cwd: fx.work, stop_hook_active: false, ...input }, fx.deps); },
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
    .shell(`node programme.cjs gate-session --issue 9 --assignment g1-9-a2 --host claude-code --host-session ${CHILD(2)} --session ctl --controller`)
    .shell(`node programme.cjs gate-session --issue 9 --assignment=g1-9-a6 --host claude-code --host-session "${CHILD(6)}" --session ctl --controller`)
    .shell(`node programme.cjs gate-session --issue 9 --assignment g1-9-a7 --host claude-code --host-session ${CHILD(7)}`)
    .archive(6).archive(7).shell('node programme.cjs gate-session --issue 9 --assignment g1-9-a7 --closed --session ctl --controller')
    .writeTranscript().net([]).desktop();
  const { reason } = fx.run().output;
  assert.match(reason, new RegExp(`Gate launches with no gate-session record \\(1\\):\\n- G1 "Gate 1": session_id ${CHILD(1)}\\n`));
  assert.match(reason, /Record each: node "[^"]*programme\.cjs" gate-session --issue <n> --assignment <id> --host claude-code --host-session <session_id>\. If it answers STALE_ASSIGNMENT/);
  assert.match(reason, /Record each: node "[^"]*programme\.cjs" gate-session --issue <n> --assignment <id> --closed\./);
  assert.match(reason, /Archived gate sessions with no close record \(1\):\n- assignment g1-9-a6 \(its session was archived\)/);
  assert.doesNotMatch(reason, /g1-9-a7|g1-9-a2/);
});

test('O-9 a launch whose session the desktop app shows archived owes no launch record; a refused archive counts for nothing', t => {
  const fx = fixture(t).launch(1).launch(2)
    .shell(`node programme.cjs gate-session --issue 9 --assignment g1-9-a2 --host claude-code --host-session ${CHILD(2)} --session ctl --controller`)
    .archive(2, { error: true, result: 'still working' }).writeTranscript().net([])
    .desktop({}, [{ sessionId: CHILD(1), isArchived: true, prs: [] }]);
  assert.deepEqual(fx.run(), { outcome: 'NOTHING_OWED', output: null });
});

test('O-10 the hook process prints one JSON block on stdout, exits 0, and stays silent on bad input', t => {
  const fx = fixture(t).controller().writeTranscript().desktop().net([{ code: 'TASK_IDLE', state: 'new', changed_at: iso(Date.now() - 5 * HOUR) }]);
  // The real process with the fixture's home; governance comes from the fixture's recorded binding.
  const env = { ...process.env, HOME: fx.home, USERPROFILE: fx.home, LOCALAPPDATA: path.join(fx.dir, 'local'), TOOLKIT_GOVERNANCE_OFFLINE: '1', CLAUDE_CODE_HOST_SESSION_ID: SELF };
  for (const name of LAUNCHER_MARKERS) delete env[name];
  const input = JSON.stringify({ hook_event_name: 'Stop', session_id: 'cli-session-2', transcript_path: fx.transcript, cwd: fx.work, stop_hook_active: false });
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
  assert.doesNotMatch(files[0], /cli-session/);
  const text = fs.readFileSync(path.join(folder, files[0]), 'utf8');
  for (const secret of ['local_', 'Gate 1', 'Side 100', 'aaaaaaaaaaaa', fx.dir.replace(/\\/g, '\\\\'), 'cli-session']) assert.equal(text.includes(secret), false, secret);
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

// Every CLAUDE_CODE_* variable the Claude desktop app sets in a top-level chat, with fake values.
const DESKTOP_ENV = Object.freeze({
  CLAUDE_CODE_ACCOUNT_UUID: '00000000-0000-4000-8000-0000000000a1', CLAUDE_CODE_CHILD_NOTES_DIR: 'fixture-notes', CLAUDE_CODE_CHILD_SESSION: '1',
  CLAUDE_CODE_DESKTOP_APP_VERSION: '0.0.0-fixture', CLAUDE_CODE_DISABLE_CRON: '1', CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '1', CLAUDE_CODE_EAGER_FLUSH: '1',
  CLAUDE_CODE_EMIT_STARTUP_TIMING: '1', CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES: '1', CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL: '1',
  CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING: '1', CLAUDE_CODE_ENTRYPOINT: 'claude-desktop', CLAUDE_CODE_EXECPATH: 'fixture-claude',
  CLAUDE_CODE_HOST_SESSION_ID: SELF, CLAUDE_CODE_HOST_SHORT_TEMP_DIRS: '1', CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '1', CLAUDE_CODE_MESSAGING_SOCKET: 'fixture-socket',
  CLAUDE_CODE_MESSAGING_TOKEN: 'fixture', CLAUDE_CODE_ORGANIZATION_UUID: '00000000-0000-4000-8000-0000000000a2', CLAUDE_CODE_REPORT_FINDINGS: '1',
  CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH: '1', CLAUDE_CODE_SESSION_ATTENDED: '1', CLAUDE_CODE_SESSION_ID: '00000000-0000-4000-8000-0000000000a3',
  CLAUDE_CODE_SIMPLE: '1', CLAUDE_CODE_STARTUP_FAILURE_RESULTS: '1', CLAUDE_CODE_TERMINAL_MCP_TOOLS: '1', CLAUDE_CODE_USER_EMAIL: 'owner@example.com',
});
// The two Claude Code shapes: the desktop app (its variables and session files, with one finished side
// session) and a plain CLI (no host variables, no desktop files).
const SHAPES = Object.freeze([
  { name: 'desktop app', env: DESKTOP_ENV, setup: fx => fx.desktop({}, [finished()]), side: true },
  { name: 'plain CLI', env: {}, setup: fx => fx, side: false },
]);

test('O-15 a top-level controller is stopped the same in the desktop app and a plain CLI; host variables only add the side-session section', t => {
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
    const input = JSON.stringify({ hook_event_name: 'Stop', session_id: 'cli-session-3', transcript_path: live.transcript, cwd: live.work, stop_hook_active: false });
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
