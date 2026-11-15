'use strict';

// The usage reader (repo/scripts/toolkit-usage-report.cjs) turns Claude Code and Codex session
// transcripts into token and tool counts per session, and must never carry any prompt, reply,
// thinking, tool input, tool result or file text into its output. The fixtures below copy the
// field names and nesting of real transcript lines: Claude Code writes one line per content block
// of a reply, each repeating the reply's message id and usage, and Codex writes session_meta,
// turn_context, response_item and event_msg token_count lines. Every text field holds a marker
// word, and the no-text test proves none of them reaches the report, stdout or stderr.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'toolkit-usage-report.cjs');

const tempFolders = [];
test.after(() => { for (const dir of tempFolders) fs.rmSync(dir, { recursive: true, force: true }); });

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-usage-'));
  tempFolders.push(dir);
  return dir;
}

function run(args) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', windowsHide: true });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function writeLines(file, lines) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.map((line) => (typeof line === 'string' ? line : JSON.stringify(line))).join('\n')}\n`);
}

// Marker words, one per text field, so a leak names the field it came from.
const TEXT = Object.freeze({
  context: 'LEAKMARK-session-context hourly daily weekly merge train',
  relay: 'LEAKMARK-relay-body',
  prompt: 'LEAKMARK-plain-prompt',
  thinking: 'LEAKMARK-thinking',
  reply: 'LEAKMARK-reply-text',
  command: 'LEAKMARK-bash-command',
  readPath: '/home/LEAKMARK-user/project/LEAKMARK-file.md',
  result: 'LEAKMARK-tool-result',
  cwd: '/home/LEAKMARK-cwd',
  branch: 'LEAKMARK-branch',
  codexInstructions: 'LEAKMARK-codex-instructions',
  codexPrompt: 'LEAKMARK-codex-prompt',
  codexArgs: 'LEAKMARK-codex-args',
  codexOutput: 'LEAKMARK-codex-output',
  codexReasoning: 'LEAKMARK-codex-reasoning',
});

const SESSION = '0f1e2d3c-4b5a-4968-8776-655443322110';

function base(extra) {
  return {
    cwd: TEXT.cwd,
    entrypoint: 'remote',
    gitBranch: TEXT.branch,
    isSidechain: false,
    parentUuid: null,
    sessionId: SESSION,
    userType: 'external',
    version: '2.1.0',
    ...extra,
  };
}

function userLine(uuid, timestamp, content) {
  return base({ type: 'user', uuid, timestamp, message: { role: 'user', content } });
}

function usage(input, creation, read, output) {
  return {
    input_tokens: input,
    cache_creation_input_tokens: creation,
    cache_read_input_tokens: read,
    output_tokens: output,
    service_tier: 'standard',
    cache_creation: { ephemeral_1h_input_tokens: creation, ephemeral_5m_input_tokens: 0 },
  };
}

// One line per content block of one reply, as Claude Code writes them.
function replyLines({ id, requestId, timestamp, model = 'claude-opus-5-5', blocks, use, sidechain = false, uuidBase }) {
  return blocks.map((block, index) => base({
    type: 'assistant',
    uuid: `${uuidBase}-${index}`,
    timestamp,
    requestId,
    isSidechain: sidechain,
    effort: 'high',
    requestedModel: model,
    message: { id, type: 'message', role: 'assistant', model, content: [block], stop_reason: 'tool_use', usage: use[index] ?? use[use.length - 1] },
  }));
}

function relayPrompt(gateLine) {
  return [
    '<wake reason="spawn" current-time="2026-11-15T16:50:41Z">',
    '  <project id="chan_x" name="P" type="project">',
    '    <thread ts="cmsg_a">',
    '      <message trigger="true" from="agent" trust="relay" role="initiator" id="cmsg_a">Build the LEAKMARK-title thing</message>',
    '    </thread>',
    '  </project>',
    '</wake>',
    '<relay from="coordinator" session="session_x" current-time="2026-11-15T16:50:41Z" reason="spawn">',
    '  <note>',
    `      ${gateLine}`,
    '      Route: owner-claude BUILDER opus-5.5/high',
    `      ${TEXT.relay}`,
    '  </note>',
    '</relay>',
  ].join('\n');
}

function claudeFixture(dir) {
  const main = path.join(dir, 'claude', `${SESSION}.jsonl`);
  writeLines(main, [
    { type: 'queue-operation', operation: 'enqueue', sessionId: SESSION, timestamp: '2026-11-15T10:00:00.000Z', content: TEXT.prompt },
    userLine('u1', '2026-11-15T10:00:00.100Z', TEXT.context),
    userLine('u2', '2026-11-15T10:00:00.200Z', relayPrompt('Gate: G1')),
    // Reply 1: three lines, one per block; the first line was written before output finished.
    ...replyLines({
      id: 'msg_01', requestId: 'req_01', timestamp: '2026-11-15T10:00:05.000Z', uuidBase: 'a1',
      blocks: [
        { type: 'thinking', thinking: TEXT.thinking, signature: 'sig' },
        { type: 'tool_use', id: 'toolu_01', name: 'Read', input: { file_path: TEXT.readPath } },
        { type: 'tool_use', id: 'toolu_02', name: 'Bash', input: { command: `cd /x && sleep 30 && echo ${TEXT.command}` } },
      ],
      use: [usage(10, 1000, 4000, 5), usage(10, 1000, 4000, 200)],
    }),
    userLine('u3', '2026-11-15T10:00:06.000Z', [{ type: 'tool_result', tool_use_id: 'toolu_01', content: TEXT.result }]),
    // Reply 2: reads the same file again, schedules a wake-up and starts a helper.
    ...replyLines({
      id: 'msg_02', requestId: 'req_02', timestamp: '2026-11-15T10:01:00.000Z', uuidBase: 'a2',
      blocks: [
        { type: 'text', text: TEXT.reply },
        { type: 'tool_use', id: 'toolu_03', name: 'Read', input: { file_path: TEXT.readPath, offset: 10 } },
        { type: 'tool_use', id: 'toolu_04', name: 'ScheduleWakeup', input: { delaySeconds: 900, prompt: TEXT.prompt } },
        { type: 'tool_use', id: 'toolu_05', name: 'Agent', input: { prompt: TEXT.prompt, description: TEXT.prompt } },
        { type: 'tool_use', id: 'toolu_06', name: 'Bash', input: { command: `echo ${TEXT.command}` } },
      ],
      use: [usage(20, 0, 5000, 300)],
    }),
    // A synthetic placeholder reply (an API error Claude Code records) is not a model turn.
    ...replyLines({ id: 'msg_03', requestId: 'req_03', timestamp: '2026-11-15T10:02:00.000Z', uuidBase: 'a3', model: '<synthetic>', blocks: [{ type: 'text', text: TEXT.reply }], use: [usage(0, 0, 0, 0)] }),
    { type: 'tools-used', sessionId: SESSION, tools: ['Read', 'Bash'] },
    { type: 'last-prompt', sessionId: SESSION, leafUuid: 'a2-4' },
  ]);
  // The helper's own transcript sits in the session's folder and carries the parent session id.
  const helper = path.join(dir, 'claude', SESSION, 'subagents', 'agent-a1b2c3.jsonl');
  writeLines(helper, [
    base({ type: 'user', uuid: 's0', timestamp: '2026-11-15T10:01:01.000Z', isSidechain: true, message: { role: 'user', content: TEXT.prompt } }),
    ...replyLines({
      id: 'msg_s1', requestId: 'req_s1', timestamp: '2026-11-15T10:01:02.000Z', uuidBase: 's1', sidechain: true, model: 'claude-haiku-5-5',
      blocks: [{ type: 'tool_use', id: 'toolu_s1', name: 'Grep', input: { pattern: TEXT.command } }],
      use: [usage(100, 0, 0, 50)],
    }),
  ]);
  return { main, helper };
}

const CODEX_SESSION = '7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d';

function tokenCount(total, last) {
  return { timestamp: '2026-11-15T11:00:10.000Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: total, last_token_usage: last, model_context_window: 272000 }, rate_limits: null } };
}

function tokens(input, cached, output, reasoning) {
  return { input_tokens: input, cached_input_tokens: cached, output_tokens: output, reasoning_output_tokens: reasoning, total_tokens: input + output };
}

function codexFixture(dir) {
  const file = path.join(dir, 'codex', '2026', '11', '15', `rollout-2026-11-15T11-00-00-${CODEX_SESSION}.jsonl`);
  writeLines(file, [
    { timestamp: '2026-11-15T11:00:00.000Z', type: 'session_meta', payload: { id: CODEX_SESSION, timestamp: '2026-11-15T11:00:00.000Z', cwd: TEXT.cwd, originator: 'codex_cli_rs', cli_version: '0.60.0', instructions: TEXT.codexInstructions, git: { commit_hash: 'abc', branch: TEXT.branch } } },
    { timestamp: '2026-11-15T11:00:01.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `Gate: G2\nRoute: owner-codex REVIEWER\n${TEXT.codexPrompt}` }] } },
    { timestamp: '2026-11-15T11:00:01.500Z', type: 'turn_context', payload: { cwd: TEXT.cwd, approval_policy: 'on-request', sandbox_policy: { type: 'workspace-write' }, model: 'gpt-5.1-codex-max', effort: 'xhigh', summary: 'auto' } },
    { timestamp: '2026-11-15T11:00:02.000Z', type: 'event_msg', payload: { type: 'token_count', info: null, rate_limits: null } },
    { timestamp: '2026-11-15T11:00:03.000Z', type: 'response_item', payload: { type: 'reasoning', summary: [{ type: 'summary_text', text: TEXT.codexReasoning }] } },
    { timestamp: '2026-11-15T11:00:04.000Z', type: 'response_item', payload: { type: 'function_call', name: 'shell_command', arguments: JSON.stringify({ command: `sleep 20; echo ${TEXT.codexArgs}` }), call_id: 'call_1' } },
    { timestamp: '2026-11-15T11:00:05.000Z', type: 'response_item', payload: { type: 'function_call_output', call_id: 'call_1', output: TEXT.codexOutput } },
    tokenCount(tokens(1000, 600, 100, 40), tokens(1000, 600, 100, 40)),
    // The same event again (Codex repeats a token count when nothing new ran): not a new call.
    tokenCount(tokens(1000, 600, 100, 40), tokens(1000, 600, 100, 40)),
    { timestamp: '2026-11-15T11:00:12.000Z', type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: JSON.stringify({ command: ['bash', '-lc', `cat ${TEXT.codexArgs}`] }), call_id: 'call_2' } },
    tokenCount(tokens(3000, 2500, 160, 60), tokens(2000, 1900, 60, 20)),
    '{"timestamp":"2026-11-15T11:00:13.000Z","type":"event_msg","payload":{"type":"token_count","info":{',
  ]);
  return file;
}

function report(dir, extraArgs = []) {
  const out = path.join(dir, 'report.json');
  const result = run(['--transcripts', path.join(dir, 'claude'), '--codex', path.join(dir, 'codex'), '--out', out, ...extraArgs]);
  assert.equal(result.status, 0, `exit ${result.status}: ${result.stderr}`);
  return { result, out, text: fs.readFileSync(out, 'utf8'), json: JSON.parse(fs.readFileSync(out, 'utf8')) };
}

function sessionOf(json, source) {
  const found = json.sessions.filter((session) => session.source === source);
  assert.equal(found.length, 1, `one ${source} session`);
  return found[0];
}

test('Claude Code: one reply written as several lines counts once, with its final usage', () => {
  const dir = tempDir();
  claudeFixture(dir);
  codexFixture(dir);
  const session = sessionOf(report(dir).json, 'claude');
  assert.equal(session.session_id, SESSION);
  // msg_01, msg_02 and the helper's msg_s1; the synthetic reply is not a turn.
  assert.equal(session.assistant_turns, 3);
  assert.equal(session.subagent_turns, 1);
  assert.deepEqual(session.tokens, { input: 10 + 20 + 100, cache_creation: 1000, cache_read: 4000 + 5000, output: 200 + 300 + 50 });
  assert.equal(session.cache_hit_share, Number((9000 / (130 + 1000 + 9000)).toFixed(4)));
  assert.deepEqual(session.models, { 'claude-opus-5-5': 2, 'claude-haiku-5-5': 1 });
  assert.equal(session.first_at, '2026-11-15T10:00:00.100Z');
  assert.equal(session.last_at, '2026-11-15T10:01:02.000Z');
});

test('Claude Code: tool calls, repeat reads, sleeps, wake-ups and helpers are counted', () => {
  const dir = tempDir();
  claudeFixture(dir);
  codexFixture(dir);
  const session = sessionOf(report(dir).json, 'claude');
  assert.deepEqual(session.tool_calls, { Agent: 1, Bash: 2, Grep: 1, Read: 2, ScheduleWakeup: 1 });
  assert.equal(session.sleeps, 1);
  assert.equal(session.wakeups, 1);
  assert.equal(session.subagents, 1);
  assert.equal(session.repeat_reads.paths, 1);
  assert.equal(session.repeat_reads.extra_reads, 1);
  assert.equal(session.repeat_reads.top.length, 1);
  assert.equal(session.repeat_reads.top[0].reads, 2);
  assert.match(session.repeat_reads.top[0].path_id, /^[0-9a-f]{16}$/);
  assert.equal(session.run_type, 'g1');
});

test('Codex: token counts come from new token_count events, with cached input split out', () => {
  const dir = tempDir();
  claudeFixture(dir);
  codexFixture(dir);
  const { json } = report(dir);
  const session = sessionOf(json, 'codex');
  assert.equal(session.session_id, CODEX_SESSION);
  assert.equal(session.assistant_turns, 2);
  assert.deepEqual(session.tokens, { input: (1000 - 600) + (2000 - 1900), cache_creation: 0, cache_read: 600 + 1900, output: 100 + 60 });
  assert.deepEqual(session.models, { 'gpt-5.1-codex-max': 2 });
  assert.deepEqual(session.tool_calls, { shell: 1, shell_command: 1 });
  assert.equal(session.sleeps, 1);
  assert.equal(session.run_type, 'g2');
  // Codex transcripts do not show these, so the report says unknown rather than zero.
  assert.equal(session.repeat_reads, null);
  assert.equal(session.wakeups, null);
  assert.equal(session.subagents, null);
  assert.equal(json.skipped.malformed_lines, 1);
});

test('no prompt, reply, thinking, tool or file text reaches the report or the console', () => {
  const dir = tempDir();
  claudeFixture(dir);
  codexFixture(dir);
  const { result, text } = report(dir);
  for (const output of [text, result.stdout, result.stderr]) {
    assert.doesNotMatch(output, /LEAKMARK/);
  }
  for (const [field, value] of Object.entries(TEXT)) {
    assert.ok(!text.includes(value), `${field} text reached the report`);
  }
});

test('a malformed or non-object line is counted and skipped, and the rest is read', () => {
  const dir = tempDir();
  const file = path.join(dir, 'claude', 'one.jsonl');
  writeLines(file, [
    '{"type":"assistant", broken',
    '[1,2,3]',
    '"just a string"',
    ...replyLines({ id: 'msg_x', requestId: 'req_x', timestamp: '2026-11-15T12:00:00.000Z', uuidBase: 'x', blocks: [{ type: 'text', text: TEXT.reply }], use: [usage(1, 2, 3, 4)] }),
  ]);
  const out = path.join(dir, 'r.json');
  const result = run(['--transcripts', file, '--out', out]);
  assert.equal(result.status, 0, result.stderr);
  const json = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(json.skipped.malformed_lines, 3);
  assert.equal(json.sessions.length, 1);
  assert.deepEqual(json.sessions[0].tokens, { input: 1, cache_creation: 2, cache_read: 3, output: 4 });
  assert.doesNotMatch(result.stdout + result.stderr, /broken/);
});

test('a secret-shaped string bound for the report refuses the whole report', () => {
  const dir = tempDir();
  // A GitHub-token-shaped tool name, built from pieces so this source holds no token.
  const shaped = ['gh', 'p_', 'Qw3rTy7uIo9pAs2dFg4hJk6lZx8cVb1nM5q0'].join('');
  const file = path.join(dir, 'claude', 'secret.jsonl');
  writeLines(file, replyLines({ id: 'msg_s', requestId: 'req_s', timestamp: '2026-11-15T12:00:00.000Z', uuidBase: 's', blocks: [{ type: 'tool_use', id: 'toolu_s', name: shaped, input: {} }], use: [usage(1, 0, 0, 1)] }));
  const out = path.join(dir, 'r.json');
  const result = run(['--transcripts', file, '--out', out]);
  assert.equal(result.status, 1);
  assert.equal(fs.existsSync(out), false, 'nothing is written');
  assert.match(result.stderr, /GitHub token/);
  assert.ok(!(result.stdout + result.stderr).includes(shaped.slice(4)), 'the value is never echoed');
});

test('run type: table of title, gate line and override cases', () => {
  const { classifyRunType } = require(SCRIPT);
  const titled = (title) => [`<wake reason="spawn">\n<thread ts="x">\n<message trigger="true" from="agent" role="initiator" id="x">${title}</message>\n</thread>\n</wake>`];
  const rows = [
    { name: 'relay gate G0', texts: [TEXT.context, relayPrompt('Gate: G0')], want: 'g0' },
    { name: 'relay gate G2 beats a train title', texts: [titled('Review train 48 release').concat(relayPrompt('Gate: G2')).join('\n')], want: 'g2' },
    { name: 'plain prompt opening with a gate line', texts: [`\n  Gate: G1\nRoute: x\n${TEXT.prompt}`], want: 'g1' },
    { name: 'gate line not first in a plain prompt', texts: [`${TEXT.prompt}\nGate: G1`], want: 'other' },
    { name: 'gate words only in a memory note', texts: ['Brief MUST start with `Gate: G0`'], want: 'other' },
    { name: 'unknown gate', texts: [relayPrompt('Gate: G7')], want: 'other' },
    { name: 'hourly title', texts: titled('Hourly reconcile run'), want: 'hourly' },
    { name: 'daily title', texts: titled('Daily check-in'), want: 'daily' },
    { name: 'weekly title', texts: titled('Add weekly repo health loop'), want: 'weekly' },
    { name: 'train title', texts: titled('Run next merge train'), want: 'train' },
    { name: 'schedule words outside the title', texts: [TEXT.context], want: 'other' },
    { name: 'no text', texts: [], want: 'other' },
  ];
  for (const row of rows) assert.equal(classifyRunType(row.texts), row.want, row.name);
});

test('--tag sets a session run type, --since drops earlier activity', () => {
  const dir = tempDir();
  claudeFixture(dir);
  codexFixture(dir);
  const tagged = report(dir, ['--tag', `${SESSION}=coordinator`]).json;
  assert.equal(sessionOf(tagged, 'claude').run_type, 'coordinator');
  assert.equal(tagged.totals.by_run_type.coordinator.sessions, 1);
  assert.equal(tagged.totals.by_run_type.g2.sessions, 1);

  const later = report(dir, ['--since', '2026-11-15T10:00:30Z']).json;
  const claude = sessionOf(later, 'claude');
  assert.equal(claude.assistant_turns, 2);
  assert.deepEqual(claude.tokens, { input: 120, cache_creation: 0, cache_read: 5000, output: 350 });
  assert.equal(claude.sleeps, 0);
  // Gate tags still come from the session's start, which is before --since.
  assert.equal(claude.run_type, 'g1');

  const none = report(dir, ['--since', '2026-11-16T00:00:00Z']).json;
  assert.equal(none.sessions.length, 0);
});

test('bad arguments exit 2 and write nothing', () => {
  const dir = tempDir();
  const out = path.join(dir, 'r.json');
  for (const args of [
    ['--out', out],
    ['--transcripts', dir],
    ['--transcripts', dir, '--out', out, '--since', 'yesterday'],
    ['--transcripts', dir, '--out', out, '--tag', 'abc=boss'],
    ['--transcripts', path.join(dir, 'missing'), '--out', out],
    ['--transcripts', dir, '--out', out, '--bogus'],
  ]) {
    const result = run(args);
    assert.equal(result.status, 2, args.join(' '));
    assert.equal(fs.existsSync(out), false);
  }
});
