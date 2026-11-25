'use strict';

// The gate launch check: a Claude Code start_session whose brief names a gate is refused unless it
// carries the Gate, Route and Assignment lines and pins the route's model and effort, judged by the
// same route reader the started session's route check uses; after a start it prints the effort
// raise and record steps.
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const launch = require('../scripts/toolkit-claude-gate-launch-hook.cjs');
const route = require('../scripts/toolkit-gate-route.cjs');

const registry = route.loadRegistry();
const TOOL = 'mcp__ccd_session__start_session';
const HOOK = path.join(__dirname, '..', 'scripts', 'toolkit-claude-gate-launch-hook.cjs');
const G1_BRIEF = 'Gate: G1\nRoute: owner-claude BUILDER opus-5.5/high\nAssignment: 1265-g1-s4-20261123\n\nBuild slice S4.';
const G2_BRIEF = 'Gate: G2\nRoute: owner-claude opus opus-5.5/xhigh\nAssignment: 1265-g2-pr1480\n\nReview PR 1480.';
const start = (fields = {}) => ({ initiation: 'user_asked', title: 'G1 #1265 S4: gate launch check', model: 'claude-opus-5-5', effort: 'high', prompt: G1_BRIEF, background: 'b'.repeat(90), ...fields });
const pre = (toolInput, { level = 'high', environment = {} } = {}) => launch.preToolUse({ tool_name: TOOL, tool_input: toolInput, ...(level ? { effort: { level } } : {}) }, { environment, registry });
const reason = output => output && output.hookSpecificOutput && output.hookSpecificOutput.permissionDecision === 'deny' ? output.hookSpecificOutput.permissionDecisionReason : null;

test('a gate brief is refused at launch unless its lines and launch fields match the pin', () => {
  const cases = [
    // Allowed.
    ['a full G1 launch on its pin', start(), {}, null],
    ['a G2 launch capped below its pin by the caller', start({ title: 'G2 PR 1480', prompt: G2_BRIEF, effort: 'high' }), {}, null],
    ['REVIEWER names the profile\'s one reviewer', start({ title: 'G2 PR 1480', prompt: G2_BRIEF.replace('owner-claude opus', 'owner-claude REVIEWER'), effort: 'high' }), {}, null],
    ['a wording-only G2 at high', start({ title: 'G2 PR 1480', prompt: 'Gate: G2\nRoute: owner-claude opus opus-5.5/high\nReview class: wording-only\nAssignment: none', effort: 'high' }), {}, null],
    ['Assignment: none for a gate outside a programme', start({ prompt: G1_BRIEF.replace('1265-g1-s4-20261123', 'none') }), {}, null],
    ['a bulleted bold brief', start({ prompt: '- **Gate:** G1\n- **Route:** `owner-claude BUILDER opus-5.5/high`\n- **Assignment:** `1265-g1-s4`' }), {}, null],
    ['a cloud start: model and effort do not apply there', start({ target: 'cloud', model: undefined, effort: undefined }), {}, null],
    ['the caller effort is unknown and the start is below the pin', start({ title: 'G2 PR 1480', prompt: G2_BRIEF, effort: 'high' }), { level: null }, null],
    // Refused: lines.
    ['a G2 title with no Gate line (23 Nov, "G2 PR 1452")', start({ title: 'G2 PR 1452', prompt: 'Review PR 1452 against the plan.' }), {}, /title names a G2 but its brief has no `Gate:` line/],
    ['a Gate line naming no gate under a gate title', start({ title: 'G1 build', prompt: 'Gate: builder\nRoute: owner-claude BUILDER opus-5.5/high' }), {}, /Gate: G0`, `Gate: G1`, `Gate: G2`/],
    ['no Route line', start({ prompt: 'Gate: G2\nAssignment: x1\nReview it.', title: 'Review PR 5' }), {}, /`Route: owner-claude opus opus-5\.5\/xhigh`/],
    ['a malformed Route line', start({ prompt: 'Gate: G1\nRoute: Opus 5.5 high\nAssignment: x1' }), {}, /is not `Route: <profile> <member> <model>\/<effort>`/],
    ['an unknown member names the profile\'s members', start({ prompt: 'Gate: G1\nRoute: owner-claude BUILD opus-5.5/high\nAssignment: x1' }), {}, /Its members: DISCOVERY, BUILDER, DESIGN_CHALLENGE, REVIEWER \(opus\)/],
    ['the wrong member for the gate', start({ prompt: 'Gate: G1\nRoute: owner-claude DISCOVERY opus-5.5/high\nAssignment: x1' }), {}, /not the G1 route \(BUILDER\)/],
    ['a Route line off the pin', start({ prompt: 'Gate: G1\nRoute: owner-claude BUILDER opus-5.5/xhigh\nAssignment: x1' }), {}, /pin is opus-5\.5\/high/],
    ['the retired Route override line', start({ prompt: `${G1_BRIEF}\nRoute override: INT-1` }), {}, /Route override line .* is retired/],
    ['a Codex-only route on Claude Code', start({ prompt: 'Gate: G1\nRoute: owner-gpt BUILDER gpt-6.1-sol/high\nAssignment: x1' }), {}, /gpt-6\.1-sol is not a Claude model/],
    ['no Assignment line', start({ prompt: 'Gate: G1\nRoute: owner-claude BUILDER opus-5.5/high\nBuild it.' }), {}, /has no `Assignment:` line/],
    ['an Assignment line that is not an id', start({ prompt: 'Gate: G1\nRoute: owner-claude BUILDER opus-5.5/high\nAssignment: #1265 slice four' }), {}, /`Assignment: #1265 slice four` is not an assignment id/],
    // Refused: launch fields.
    ['a fork carries no pinned model or effort', start({ context: 'fork' }), {}, /starts fresh/],
    ['no model in the launch call', start({ model: undefined }), {}, /pass `model: "claude-opus-5-5"`/],
    ['the wrong model', start({ model: 'claude-sonnet-5-5' }), {}, /asks for sonnet-5\.5, but the owner-claude\/BUILDER pin is opus-5\.5/],
    ['no effort in the launch call', start({ effort: undefined }), {}, /pass `effort: "high"`/],
    ['an effort above the pin', start({ effort: 'xhigh' }, {}), { level: 'xhigh' }, /above its pin opus-5\.5\/high; pass `effort: "high"`/],
    ['an effort below what the caller could give', start({ title: 'G2 PR 1480', prompt: G2_BRIEF, effort: 'medium' }), {}, /pass `effort: "high"`, the highest this session can give/],
    ['the Gate line in the background counts as the child reads it', start({ prompt: 'Do the work.', background: `Gate: G1\n${'b'.repeat(90)}` }), {}, /has no Route line/],
  ];
  for (const [label, input, options, expected] of cases) {
    const got = reason(pre(input, options));
    if (expected === null) assert.equal(got, null, `${label}: ${got}`);
    else {
      assert.ok(got, `${label}: allowed`);
      assert.match(got, /^Toolkit gate launch check: /, label);
      assert.match(got, expected, `${label}: ${got}`);
    }
  }
});

test('starts that are not gate briefs pass untouched', () => {
  const cases = [
    ['an ordinary side session', start({ title: 'Polish batch 3', prompt: 'Fix the typos in the README.' })],
    ['Gate: none under a gate-like title', start({ title: 'G2 runner lane', prompt: 'Gate: none\nRun the train.' })],
    ['a Gate line naming no gate under an ordinary title', start({ title: 'Notes', prompt: 'Gate: please check the notes' })],
    ['a title that only contains G2 later', start({ title: 'Relay the G2 verdict', prompt: 'Relay it.' })],
    ['a card start by proposal id', { proposal_id: 'task_b0c327da' }],
    ['an offer card', { initiation: 'offer', title: 'G1 build' }],
  ];
  for (const [label, input] of cases) assert.deepEqual(pre(input), {}, label);
  // Other tools are never read.
  assert.deepEqual(launch.preToolUse({ tool_name: 'mcp__ccd_session_mgmt__send_message', tool_input: { prompt: 'Gate: G1' } }, { registry }), {});
});

test('the launch check and the started session\'s route check read the same brief the same way', () => {
  // Every refusal of a Route line at launch is the started session's refusal too, worded once.
  const briefs = ['Gate: G1\nRoute: Opus 5.5 high', 'Gate: G1\nRoute: owner-claude BUILDER opus-5.5/xhigh', 'Gate: G2\nRoute: owner-claude BUILDER opus-5.5/high', 'Gate: G1\nRoute: owner-mixed BUILDER opus-5.5/high'];
  for (const text of briefs) {
    const brief = route.parseBrief(text);
    const shared = route.checkBriefRoute(registry, brief.gate, brief);
    assert.ok(shared.problem, text);
    const session = route.evaluate({ input: {}, environment: {}, registry, transcript: { brief: text, model: null, effort: null } });
    assert.equal(session.deny, `Toolkit gate route check: ${shared.problem}`, text);
    assert.equal(reason(pre(start({ prompt: `${text}\nAssignment: x1` }))), `Toolkit gate launch check: ${shared.problem}`, text);
  }
  assert.deepEqual(route.checkBriefRoute(registry, 'G1', route.parseBrief(G1_BRIEF)).pin, { profile: 'owner-claude', member: 'BUILDER', model: 'opus-5.5', effort: 'high' });
  assert.equal(route.parseBrief(G1_BRIEF).assignment, '1265-g1-s4-20261123');
});

test('hostile line breaks and large briefs never split the launch check from the session check', () => {
  const hostile = require('./support/hostile-inputs.cjs');
  // The started session declares a gate from its first prompt only with both lines (outside a relay),
  // so a brief whose Route line it would refuse must be refused at launch, whatever the line breaks.
  for (const text of ['Gate: G1\nRoute: Opus 5.5 high\nAssignment: x1', 'Gate: G2\nRoute: owner-claude BUILDER opus-5.5/high\nAssignment: x1']) {
    for (const variant of hostile.variants(text)) {
      const session = route.evaluate({ input: {}, environment: {}, registry, transcript: { brief: variant.text, model: null, effort: null } });
      const launched = reason(pre(start({ title: 'Side work', prompt: variant.text })));
      if (session.deny) assert.equal(launched, session.deny.replace('Toolkit gate route check: ', 'Toolkit gate launch check: '), variant.id);
      else assert.equal(session.gate, null, `${variant.id}: a session gate the launch check let through`);
    }
  }
  // Reading the brief stays linear in its size.
  const timed = hostile.timing(text => pre(start({ prompt: text })), size => `${G1_BRIEF}\n${'x '.repeat(size / 2)}\n`);
  assert.ok(timed.ok, timed.message);
});

// 25 Nov 2026: a review passed at 14:07Z and the controller saw it at 14:41Z, because the app continues a
// chat only once no session it started is working and another gate was still building.
const WAKE = /With more than one gate session running, start one background watch on GitHub for this one's own result once it is at work \(its verdict comment or its pull request\): the app continues this chat by itself only once no session it started is working\.$/;

test('after a start it prints the effort raise and the record steps', () => {
  const post = (toolInput, text, level = 'high') => launch.postToolUse({ tool_name: TOOL, tool_input: toolInput, tool_response: [{ type: 'text', text }], effort: { level } }, { environment: {}, registry });
  const context = output => output && output.hookSpecificOutput ? output.hookSpecificOutput.additionalContext : '';
  const started = 'Started session "G2 PR 1480" (session_id: local_1234abcd-0000-4000-8000-000000000001, name: g2-1480). It runs on its own.';
  const capped = context(post(start({ title: 'G2 PR 1480', prompt: G2_BRIEF, effort: 'high' }), started));
  assert.match(capped, /set_session_effort with session_id local_1234abcd-0000-4000-8000-000000000001 and effort xhigh/);
  assert.match(capped, /READY/);
  assert.match(capped, /programme\.cjs" assign --issue <n> --role G2 --assignment 1265-g2-pr1480/);
  assert.match(capped, WAKE);
  // On its pin already: only the record step.
  const onPin = context(post(start(), started.replace('G2 PR 1480', 'G1')));
  assert.doesNotMatch(onPin, /set_session_effort/);
  assert.match(onPin, /--role G1 --assignment 1265-g1-s4-20261123/);
  assert.match(onPin, WAKE);
  assert.equal(onPin.split('With more than one').length, 2, 'one line');
  // A gate outside a programme on its pin needs nothing.
  assert.deepEqual(post(start({ prompt: G1_BRIEF.replace('1265-g1-s4-20261123', 'none') }), started), {});
  // A proposal card: the steps wait for its start.
  const card = context(post(start({ initiation: 'own_initiative', title: 'G2 PR 1480', prompt: G2_BRIEF, effort: 'high' }), 'Proposed "G2 PR 1480" (task_id: task_b0c327da). The user sees a card.'));
  assert.match(card, /card task_b0c327da/);
  assert.match(card, /set_session_effort with session_id <its session id> and effort xhigh/);
  assert.match(card, WAKE);
  // Not a gate, or a start that was refused: nothing.
  assert.deepEqual(post(start({ title: 'Polish', prompt: 'Fix typos.' }), started), {});
  assert.deepEqual(post(start({ model: undefined }), started), {});
});

// G2 round 1, F1: the 23 Nov controller ran at high and passed the G2 pin's own `effort: "xhigh"`;
// the app took it without an error, capped the start at high, and every such start needed a manual
// raise. A start above the caller's own effort runs at the caller's.
test('a start that asks for more effort than the caller has still gets the raise step', () => {
  const started = 'Started session "G2 PR 1480" (session_id: local_1234abcd-0000-4000-8000-000000000002, name: g2-1480). It runs on its own.';
  const context = output => output && output.hookSpecificOutput ? output.hookSpecificOutput.additionalContext : '';
  const g2 = fields => start({ title: 'G2 PR 1480', prompt: G2_BRIEF, effort: 'xhigh', ...fields });
  for (const [label, input, environment] of [['caller effort in the hook input', { effort: { level: 'high' } }, {}], ['caller effort in CLAUDE_EFFORT', {}, { CLAUDE_EFFORT: 'high' }]]) {
    const call = { tool_name: TOOL, tool_input: g2(), ...input };
    assert.deepEqual(launch.preToolUse(call, { environment, registry }), {}, label);
    const steps = context(launch.postToolUse({ ...call, tool_response: [{ type: 'text', text: started }] }, { environment, registry }));
    assert.match(steps, /Its first turn runs at high, below its opus-5\.5\/xhigh pin/, label);
    assert.match(steps, /set_session_effort with session_id local_1234abcd-0000-4000-8000-000000000002 and effort xhigh/, label);
  }
  // The caller at the pin: the start runs on it, so no raise.
  const onPin = context(launch.postToolUse({ tool_name: TOOL, tool_input: g2(), effort: { level: 'xhigh' }, tool_response: [{ type: 'text', text: started }] }, { environment: {}, registry }));
  assert.doesNotMatch(onPin, /set_session_effort/);
  // A proposal card whose pin is above the caller: confirm and raise once it starts.
  const card = context(launch.postToolUse({ tool_name: TOOL, tool_input: g2({ initiation: 'own_initiative' }), effort: { level: 'high' }, tool_response: [{ type: 'text', text: 'Proposed "G2 PR 1480" (task_id: task_c1d2e3f4).' }] }, { environment: {}, registry }));
  assert.match(card, /card task_c1d2e3f4/);
  assert.match(card, /set_session_effort with session_id <its session id> and effort xhigh/);
});

// G2 round 1, L3: after an offer card the brief goes in a start_session call with proposal_id, which
// may not carry model or effort. Its lines are checked; its effort is the caller's.
test('an offer card brief sent with its proposal id is checked for its lines only', () => {
  const offer = fields => ({ proposal_id: 'task_0ffe12ab', prompt: G2_BRIEF, background: 'b'.repeat(90), ...fields });
  assert.deepEqual(pre(offer()), {});
  assert.match(reason(pre(offer({ prompt: 'Gate: G2\nAssignment: x1\nReview it.' }))), /has no Route line/);
  const steps = launch.postToolUse({ tool_name: TOOL, tool_input: offer(), effort: { level: 'high' }, tool_response: [{ type: 'text', text: 'Started session "G2" (session_id: local_1234abcd-0000-4000-8000-000000000003, name: g2).' }] }, { environment: {}, registry });
  assert.match(steps.hookSpecificOutput.additionalContext, /set_session_effort with session_id local_1234abcd-0000-4000-8000-000000000003 and effort xhigh/);
});

test('a failure inside the check lets the start through with a note', () => {
  const broken = { get profiles() { throw new Error('registry unreadable'); } };
  const output = launch.preToolUse({ tool_name: TOOL, tool_input: start(), effort: { level: 'high' } }, { environment: {}, registry: broken });
  assert.equal(reason(output), null);
  assert.match(output.systemMessage, /^Toolkit gate launch check could not run/);
  // The script itself answers on stdout with exit 0, also for unreadable input.
  const refused = JSON.stringify({ tool_name: TOOL, tool_input: start({ model: undefined }), effort: { level: 'high' } });
  for (const [event, stdin, denies] of [['PreToolUse', refused, true], ['PreToolUse', 'not json', false], ['PostToolUse', '{}', false], ['Nope', refused, false]]) {
    const run = spawnSync(process.execPath, [HOOK, '--event', event], { input: stdin, encoding: 'utf8', windowsHide: true });
    assert.equal(run.status, 0, run.stderr);
    const got = reason(JSON.parse(run.stdout));
    if (denies) assert.match(got, /pass `model: "claude-opus-5-5"`/);
    else assert.equal(got, null, `${event} ${stdin}`);
  }
});
