'use strict';

// The gate route check: a declared gate session runs only on its stack-registry pin (or an owner
// override that cites the owner), proof comes from the host's record or the launcher's Route line and
// never from the model, and verdicts and G1 bodies carry the session's own route stamp.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const route = require('../scripts/toolkit-gate-route.cjs');

const HEAD = 'a'.repeat(40);
const registry = route.loadRegistry();

function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-route-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A Projects-shaped transcript: the first prompt holds the session context and the spawn relay.
function transcript(dir, { brief, model = 'claude-opus-5-5', effort = 'high', outside = '' }) {
  const file = path.join(dir, `${Math.random().toString(36).slice(2)}.jsonl`);
  const first = brief && brief.plain ? brief.plain : `<session-context>${outside}</session-context>\n<relay from="coordinator" session="s" reason="spawn">\n  <note>\n${brief}\n  </note>\n</relay>`;
  const entries = [
    { type: 'user', isMeta: true, message: { role: 'user', content: first } },
    { type: 'assistant', message: { model: 'claude-haiku-5-5' }, isSidechain: true },
    ...(model ? [{ type: 'assistant', message: { model }, effort }] : []),
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'Gate: G2' }] } },
  ];
  fs.writeFileSync(file, entries.map(entry => JSON.stringify(entry)).join('\n') + '\n');
  return file;
}

const brief = (gate, line, extra = '') => `You are the builder.\nGate: ${gate}\nRoute: ${line}\n${extra}`;
const G1 = brief('G1', 'owner-claude BUILDER opus-5.5/high');
const G2 = brief('G2', 'owner-claude opus opus-5.5/xhigh');

test('a declared gate runs only on its pin, read from the host record', t => {
  const dir = scratch(t);
  const run = (text, { model, effort, level, environment = {} } = {}) => route.evaluate({ input: { transcript_path: transcript(dir, { brief: text, model, effort }), ...(level ? { effort: { level } } : {}) }, environment, registry });
  const cases = [
    ['G1 on its pin', G1, { level: 'high' }, { stamp: 'Route: host-verified opus-5.5/high pin=owner-claude/BUILDER' }],
    ['G2 on its pin', G2, { effort: 'xhigh', level: 'xhigh' }, { stamp: 'Route: host-verified opus-5.5/xhigh pin=owner-claude/opus' }],
    // The 15 November miss: a G2 at medium against the xhigh pin, and a G1 at xhigh against high.
    ['G2 at medium', G2, { effort: 'medium', level: 'medium' }, { deny: /runs on effort medium, but its route is opus-5.5\/xhigh/ }],
    ['G1 at xhigh', G1, { effort: 'xhigh', level: 'xhigh' }, { deny: /runs on effort xhigh/ }],
    ['effort from CLAUDE_EFFORT', G1, { effort: null, environment: { CLAUDE_EFFORT: 'medium' } }, { deny: /effort medium/ }],
    ['effort from the transcript', G1, { effort: 'low' }, { deny: /effort low/ }],
    ['wrong model', G1, { model: 'claude-sonnet-5-5', level: 'high' }, { deny: /model sonnet-5.5/ }],
    ['no model on record', G1, { model: null, level: 'high' }, { stamp: 'Route: launcher-attested opus-5.5/high pin=owner-claude/BUILDER, self-check unavailable' }],
    ['no host record at all', G1, { model: null, effort: null }, { stamp: /^Route: launcher-attested / }],
    ['brief asks off the pin', brief('G1', 'owner-claude BUILDER opus-5.5/xhigh'), { effort: 'xhigh', level: 'xhigh' }, { deny: /pin is opus-5.5\/high/ }],
    ['no Route line', 'Gate: G2\nReview it.', { level: 'xhigh' }, { deny: /has no Route line/ }],
    ['a plain first prompt with only a Gate line', { plain: 'Gate: G2 for PR 5 please' }, { effort: 'low' }, { gate: null, stamp: 'Route: UNVERIFIED' }],
    ['a plain first prompt with both lines', { plain: 'Gate: G1\nRoute: owner-claude BUILDER opus-5.5/high' }, { effort: 'xhigh' }, { deny: /runs on effort xhigh/ }],
    ['malformed Route line', brief('G1', 'Opus 5.5 high'), { level: 'high' }, { deny: /is not `Route: <profile>/ }],
    ['unknown profile', brief('G1', 'owner-mixed BUILDER opus-5.5/high'), { level: 'high' }, { deny: /has no route owner-mixed\/BUILDER/ }],
    ['G2 on the builder route', brief('G2', 'owner-claude BUILDER opus-5.5/high'), { level: 'high' }, { deny: /not the G2 route/ }],
    ['G1 on a reviewer route', brief('G1', 'owner-claude opus opus-5.5/xhigh'), { level: 'xhigh' }, { deny: /not the G1 route/ }],
    ['a Gate line naming no gate declares nothing', brief('please check', 'owner-claude BUILDER opus-5.5/high'), { effort: 'low' }, { gate: null, stamp: 'Route: UNVERIFIED' }],
    ['Gate: none is not a gate', 'Gate: none\nKeep the records.', { effort: 'low', level: 'low' }, { gate: null, stamp: 'Route: UNVERIFIED' }],
    ['no Gate line is not a gate', 'Do the records.', { effort: 'low' }, { gate: null, stamp: 'Route: UNVERIFIED' }],
    ['G2 recheck is a G2', brief('G2 recheck', 'owner-claude opus opus-5.5/xhigh'), { effort: 'xhigh' }, { stamp: /pin=owner-claude\/opus$/ }],
    // A temporary owner change, for this launch only, citing the owner's own record or message.
    ['owner override', brief('G1', 'owner-claude BUILDER opus-5.5/high', 'Route override: BUILDER deepseek-v4/high owner=rec 990'), { model: 'deepseek-v4' }, { stamp: 'Route: host-verified deepseek-v4/high pin=owner-claude/BUILDER override=rec-990' }],
    ['override by message', brief('G1', 'owner-claude BUILDER opus-5.5/high', 'Route override: BUILDER opus-5.5/xhigh owner=cmsg_01ABCdef'), { effort: 'xhigh' }, { stamp: /override=cmsg_01ABCdef$/ }],
    ['override with no citation', brief('G1', 'owner-claude BUILDER opus-5.5/high', 'Route override: BUILDER deepseek-v4/high'), { model: 'deepseek-v4' }, { deny: /citing the owner's own record/ }],
    ['override for another member', brief('G1', 'owner-claude BUILDER opus-5.5/high', 'Route override: opus deepseek-v4/high owner=rec 1'), {}, { deny: /Route override line/ }],
    ['host off the override', brief('G1', 'owner-claude BUILDER opus-5.5/high', 'Route override: BUILDER deepseek-v4/high owner=rec 990'), { level: 'high' }, { deny: /model opus-5.5, but its route is deepseek-v4\/high \(owner override rec-990\)/ }],
    ['launcher mark without a brief', 'Do the work.', { level: 'high', environment: { TOOLKIT_GATE_ROLE: 'G1' } }, { gate: 'G1', stamp: 'Route: UNVERIFIED' }],
    ['launcher mark and brief agree', G1, { level: 'high', environment: { TOOLKIT_GATE_ROLE: 'G1' } }, { stamp: /^Route: host-verified/ }],
    ['launcher mark and brief differ', G2, { level: 'xhigh', environment: { TOOLKIT_GATE_ROLE: 'G1' } }, { deny: /marked this session G1 but its brief says Gate: G2/ }],
  ];
  for (const [name, text, options, want] of cases) {
    const got = run(text, options);
    if (want.deny) assert.match(got.deny || '', want.deny, name);
    else assert.equal(got.deny, undefined, `${name}: ${got.deny}`);
    if (want.stamp instanceof RegExp) assert.match(got.stamp, want.stamp, name);
    else if (want.stamp) assert.equal(got.stamp, want.stamp, name);
    if ('gate' in want) assert.equal(got.gate, want.gate, name);
  }
});

test('a wording-only G2 may run at high on the pinned model, and only its stamp says so', t => {
  const dir = scratch(t);
  const run = (text, { model, effort, level } = {}) => route.evaluate({ input: { transcript_path: transcript(dir, { brief: text, model, effort }), ...(level ? { effort: { level } } : {}) }, environment: {}, registry });
  const wording = (gate, line) => brief(gate, line, 'Review class: wording-only');
  const cases = [
    ['wording-only G2 at high', wording('G2', 'owner-claude opus opus-5.5/high'), { effort: 'high', level: 'high' }, { stamp: 'Route: host-verified opus-5.5/high pin=owner-claude/opus' }],
    ['the same G2 without the class line', brief('G2', 'owner-claude opus opus-5.5/high'), { effort: 'high', level: 'high' }, { deny: /pin is opus-5.5\/xhigh/ }],
    ['wording-only G2 at medium', wording('G2', 'owner-claude opus opus-5.5/medium'), { effort: 'medium', level: 'medium' }, { deny: /pin is opus-5.5\/xhigh/ }],
    ['wording-only G2 on another model', wording('G2', 'owner-claude opus sonnet-5.5/high'), { model: 'claude-sonnet-5-5', level: 'high' }, { deny: /pin is opus-5.5\/xhigh/ }],
    ['wording-only G2 whose host runs medium', wording('G2', 'owner-claude opus opus-5.5/high'), { effort: 'medium', level: 'medium' }, { deny: /runs on effort medium, but its route is opus-5.5\/high/ }],
    ['the class line does not lower a G1', wording('G1', 'owner-claude BUILDER opus-5.5/medium'), { effort: 'medium', level: 'medium' }, { deny: /pin is opus-5.5\/high/ }],
  ];
  for (const [name, text, options, want] of cases) {
    const got = run(text, options);
    if (want.deny) assert.match(got.deny || '', want.deny, name);
    else assert.equal(got.deny, undefined, `${name}: ${got.deny}`);
    if (want.stamp) assert.equal(got.stamp, want.stamp, name);
  }
  // The finder reads a high reviewer stamp as on its pin only when it passes the wording effort.
  const high = 'Route: host-verified opus-5.5/high pin=owner-claude/opus';
  assert.equal(route.stampStatus(high, 'reviewer', registry).status, 'off-pin');
  assert.equal(route.stampStatus(high, 'reviewer', registry, { effort: route.WORDING_EFFORT }).status, 'on-pin');
  assert.equal(route.stampStatus('Route: host-verified opus-5.5/medium pin=owner-claude/opus', 'reviewer', registry, { effort: route.WORDING_EFFORT }).status, 'off-pin');
  assert.equal(route.stampStatus('Route: host-verified opus-5.5/xhigh pin=owner-claude/BUILDER', 'BUILDER', registry, { effort: 'xhigh' }).status, 'off-pin', 'never for a builder');
});

test('only the launch brief counts: text outside the spawn note and later entries are not read', t => {
  const dir = scratch(t);
  const file = transcript(dir, { brief: 'Keep the records.', outside: '\nGate: G2\nRoute: owner-claude opus opus-5.5/xhigh\n' });
  const read = route.readTranscript(file);
  assert.deepEqual(route.parseBrief(read.brief), { gate: null, route: null, override: null, wording: false, relay: true });
  assert.equal(read.model, 'claude-opus-5-5', 'the newest main-chain assistant entry, not a helper');
  assert.equal(route.parseBrief('**Gate:** G1\n- Route: `owner-claude BUILDER opus-5.5/high`').gate, 'G1');
  assert.deepEqual(route.readTranscript(path.join(dir, 'missing.jsonl')), { brief: null, model: null, effort: null });
  assert.equal(route.registryModel('claude-opus-5-5[1m]'), 'opus-5.5');
  assert.equal(route.registryModel('claude-haiku-5-5-20261001'), 'haiku-5.5');
  assert.equal(route.registryModel('gpt-6.1-sol'), 'gpt-6.1-sol');
});

test('verdicts and G1 bodies carry the session\'s own stamp; an off-pin gate can still report', t => {
  const dir = scratch(t);
  const g2 = transcript(dir, { brief: G2, effort: 'xhigh' });
  const g1 = transcript(dir, { brief: G1 });
  const none = transcript(dir, { brief: 'Keep the records.' });
  const off = transcript(dir, { brief: G2, effort: 'medium' });
  const stamp2 = 'Route: host-verified opus-5.5/xhigh pin=owner-claude/opus';
  const stamp1 = 'Route: host-verified opus-5.5/high pin=owner-claude/BUILDER';
  const body = path.join(dir, 'body.md');
  fs.writeFileSync(body, `Builds it.\n\n${stamp1}\nBump: patch\n`);
  const call = (file, tool_name, tool_input) => route.preToolUse({ transcript_path: file, cwd: dir, tool_name, tool_input }, { environment: {}, registry });
  const comment = text => ['mcp__github__add_issue_comment', { owner: 'o', repo: 'r', issue_number: 5, body: text }];
  const cases = [
    ['G2 verdict with its stamp', g2, ...comment(`Toolkit-G2: PASS ${HEAD} tier=NORMAL\n${stamp2}\n---\nReport: x`), null],
    ['G2 verdict without a stamp', g2, ...comment(`Toolkit-G2: PASS ${HEAD} tier=NORMAL\n---\nReport: x`), /next line|line after the Toolkit-G2 verdict line/],
    ['G2 verdict claiming another route', g2, ...comment(`Toolkit-G2: PASS ${HEAD} tier=NORMAL\nRoute: launcher-attested opus-5.5/xhigh pin=owner-claude/opus, self-check unavailable\n---`), /exactly:\nRoute: host-verified/],
    ['G2 verdict inline in gh', g2, 'Bash', { command: `gh pr comment 5 --body "Toolkit-G2: FAIL ${HEAD} tier=RISKY\\n${stamp2}\\n---\\nReport: x"` }, null],
    ['G2 verdict inline in gh, unstamped', g2, 'Bash', { command: `gh pr comment 5 --body "Toolkit-G2: FAIL ${HEAD} tier=RISKY\\n---"` }, /route stamp/],
    ['ordinary comment', g2, ...comment('Thanks, looking now.'), null],
    ['non-gate verdict must say UNVERIFIED', none, ...comment(`Toolkit-G2: PASS ${HEAD} tier=NORMAL\n${stamp2}\n---`), /must be `Route: UNVERIFIED`/],
    ['non-gate verdict saying UNVERIFIED', none, ...comment(`Toolkit-G2: PASS ${HEAD} tier=NORMAL\nRoute: UNVERIFIED\n---`), null],
    ['a G1 never posts a verdict', g1, ...comment(`Toolkit-G2: PASS ${HEAD} tier=NORMAL\nRoute: UNVERIFIED\n---`), /G1 session does not post a Toolkit-G2 verdict/],
    ['G1 PR body with its stamp', g1, 'mcp__github__create_pull_request', { title: 't', head: 'b', base: 'main', body: `Builds it.\n\n${stamp1}\nBump: patch` }, null],
    ['G1 PR body without a stamp', g1, 'mcp__github__update_pull_request', { pullNumber: 5, body: 'Builds it.\n\nBump: patch' }, /exactly one route stamp line/],
    ['G1 PR body file with its stamp', g1, 'Bash', { command: `gh pr create --title t --body-file ${body}` }, null],
    ['G1 PR edit of labels only', g1, 'Bash', { command: 'gh pr edit 5 --add-label x' }, null],
    ['G1 body with two stamps', g1, 'mcp__github__update_pull_request', { pullNumber: 5, body: `${stamp1}\nRoute: UNVERIFIED` }, /exactly one route stamp line/],
    ['coordinator edits a G1 body', none, 'mcp__github__update_pull_request', { pullNumber: 5, body: `Builds it.\n\n${stamp1}` }, null],
    ['off-pin gate: shell refused', off, 'Bash', { command: 'git status' }, /runs on effort medium/],
    ['off-pin gate: edits refused', off, 'Edit', { file_path: 'x', old_string: 'a', new_string: 'b' }, /runs on effort medium/],
    ['off-pin gate: can still report', off, 'mcp__hearthbot__post_message', { text: 'Off route, stopping.' }, null],
    ['off-pin gate: can read its launch record', off, 'mcp__claude-code-remote__get_session', {}, null],
    ['off-pin gate: reads stay open', off, 'Read', { file_path: 'x' }, null],
  ];
  for (const [name, file, tool, input, want] of cases) {
    const got = call(file, tool, input);
    if (want) assert.match(got || '', want, name); else assert.equal(got, null, `${name}: ${got}`);
  }
});

test('a check that cannot run refuses only a launcher-marked gate', t => {
  const file = transcript(scratch(t), { brief: G1 });
  const unreadable = { get profiles() { throw new Error('registry unreadable'); } };
  const call = environment => route.preToolUse({ tool_name: 'Bash', tool_input: { command: 'ls' }, transcript_path: file }, { environment, registry: unreadable });
  assert.equal(call({}), null, 'without a launcher mark the call goes through');
  assert.match(call({ TOOLKIT_GATE_ROLE: 'G1' }), /the check failed \(registry unreadable\)/);
  assert.equal(route.preToolUse({ tool_name: 'Bash', tool_input: { command: 'ls' }, transcript_path: 42 }, { environment: {}, registry }), null, 'no transcript is no gate');
});

test('stamp status for train acceptance reads the line against the registry', () => {
  const cases = [
    ['Route: host-verified opus-5.5/xhigh pin=owner-claude/opus', 'reviewer', 'on-pin'],
    ['Route: launcher-attested opus-5.5/xhigh pin=owner-claude/opus, self-check unavailable', 'reviewer', 'on-pin'],
    ['Route: launcher-attested opus-5.5/xhigh pin=owner-claude/opus', 'reviewer', 'missing'],
    ['Route: host-verified opus-5.5/xhigh pin=owner-claude/opus, self-check unavailable', 'reviewer', 'missing'],
    ['Route: host-verified opus-5.5/medium pin=owner-claude/opus', 'reviewer', 'off-pin'],
    ['Route: host-verified gpt-6.1-sol/xhigh pin=owner-gpt/sol', 'reviewer', 'on-pin'],
    ['Route: host-verified opus-5.5/high pin=owner-claude/BUILDER', 'reviewer', 'off-pin'],
    ['Route: host-verified opus-5.5/high pin=owner-claude/BUILDER', 'BUILDER', 'on-pin'],
    ['Route: host-verified opus-5.5/high pin=owner-claude/DISCOVERY', 'BUILDER', 'off-pin'],
    ['Route: host-verified deepseek-v4/high pin=owner-claude/BUILDER override=rec-990', 'BUILDER', 'on-pin'],
    ['Route: UNVERIFIED', 'BUILDER', 'unverified'],
    ['Route: Opus 5.5 high (get_session)', 'BUILDER', 'missing'],
    [null, 'reviewer', 'missing'],
  ];
  for (const [line, want, status] of cases) assert.equal(route.stampStatus(line, want, registry).status, status, String(line));
});

test('the stamp command prints the session\'s own stamp, or why it is off its route', t => {
  const dir = scratch(t);
  const projects = path.join(dir, 'projects', 'folder');
  fs.mkdirSync(projects, { recursive: true });
  const file = transcript(dir, { brief: G1 });
  fs.copyFileSync(file, path.join(projects, 'session-1.jsonl'));
  const lines = [];
  const write = text => lines.push(text);
  assert.equal(route.main(['stamp'], { CLAUDE_CONFIG_DIR: dir, CLAUDE_CODE_SESSION_ID: 'session-1', CLAUDE_EFFORT: 'high' }, write), 0);
  assert.equal(lines.pop(), 'Route: host-verified opus-5.5/high pin=owner-claude/BUILDER\n');
  assert.equal(route.main(['stamp', '--transcript', file], { CLAUDE_EFFORT: 'xhigh' }, write), 1);
  assert.match(lines.pop(), /runs on effort xhigh/);
  assert.equal(route.main([], {}, write), 2);
});

test('a brief may name the member by its role: REVIEWER resolves to the profile\'s one reviewer id', t => {
  const dir = scratch(t);
  const run = (text, level, reg = registry) => route.evaluate({ input: { transcript_path: transcript(dir, { brief: text, effort: level }), effort: { level } }, environment: {}, registry: reg });
  // The coordinator launches every G2 with this line.
  assert.equal(run(brief('G2', 'owner-claude REVIEWER opus-5.5/xhigh'), 'xhigh').stamp, 'Route: host-verified opus-5.5/xhigh pin=owner-claude/opus');
  assert.equal(run(brief('G2 recheck', 'owner-claude reviewer opus-5.5/xhigh'), 'xhigh').stamp, 'Route: host-verified opus-5.5/xhigh pin=owner-claude/opus');
  assert.match(run(brief('G2', 'owner-claude REVIEWER opus-5.5/xhigh'), 'medium').deny, /runs on effort medium, but its route is opus-5.5\/xhigh/);
  assert.equal(run(brief('G1', 'owner-claude builder opus-5.5/high'), 'high').stamp, 'Route: host-verified opus-5.5/high pin=owner-claude/BUILDER');
  assert.equal(run(brief('G0', 'owner-claude DISCOVERY opus-5.5/high'), 'high').stamp, 'Route: host-verified opus-5.5/high pin=owner-claude/DISCOVERY');
  assert.match(run(brief('G1', 'owner-claude REVIEWER opus-5.5/xhigh'), 'xhigh').deny, /not the G1 route/);
  assert.equal(run(brief('G2', 'owner-claude REVIEWER opus-5.5/xhigh', 'Route override: REVIEWER opus-5.5/high owner=rec 5'), 'high').stamp, 'Route: host-verified opus-5.5/high pin=owner-claude/opus override=rec-5');
  assert.equal(run(brief('G2', 'owner-claude REVIEWER opus-5.5/xhigh', 'Route override: opus opus-5.5/high owner=rec 5'), 'high').stamp, 'Route: host-verified opus-5.5/high pin=owner-claude/opus override=rec-5');
  // A wrong member is refused with the members the profile has.
  assert.match(run(brief('G2', 'owner-claude REVIEWERS opus-5.5/xhigh'), 'xhigh').deny, /has no route owner-claude\/REVIEWERS\. Its members: DISCOVERY, BUILDER, DESIGN_CHALLENGE, REVIEWER \(opus\)/);
  // With two reviewers, REVIEWER is ambiguous: the brief names one reviewer id.
  const two = JSON.parse(JSON.stringify(registry));
  two.profiles['owner-claude'].reviewers.push({ ...two.profiles['owner-claude'].reviewers[0], reviewer_id: 'opus-b' });
  assert.match(run(brief('G2', 'owner-claude REVIEWER opus-5.5/xhigh'), 'xhigh', two).deny, /owner-claude has 2 reviewers \(opus, opus-b\)/);
  assert.equal(run(brief('G2', 'owner-claude opus-b opus-5.5/xhigh'), 'xhigh', two).stamp, 'Route: host-verified opus-5.5/xhigh pin=owner-claude/opus-b');
});

test('a helper inside a gate is checked against its helper pin, never the gate\'s', t => {
  const dir = scratch(t);
  const g2 = transcript(dir, { brief: brief('G2', 'owner-claude REVIEWER opus-5.5/xhigh'), effort: 'xhigh' });
  const g1 = transcript(dir, { brief: G1 });
  const g0 = transcript(dir, { brief: brief('G0', 'owner-claude DISCOVERY opus-5.5/high') });
  const helper = (file, level, tool_name = 'Bash', tool_input = { command: 'git log -1' }, environment = {}) => route.preToolUse({ transcript_path: file, cwd: dir, tool_name, tool_input, agent_id: 'agent-1', agent_type: 'Explore', ...(level ? { effort: { level } } : {}) }, { environment, registry });
  // The hook input of a helper's call carries the gate's transcript and the helper's own effort.
  assert.equal(helper(g2, 'medium'), null, 'a helper at medium inside an xhigh G2');
  assert.equal(helper(g1, 'xhigh'), null, 'a G1 helper on its BUILDER_HELPER pin (xhigh) inside a high G1');
  assert.equal(helper(g0, 'xhigh', 'Write', { file_path: 'x', content: 'y' }), null, 'a G0 helper on its DISCOVERY_HELPER pin');
  assert.equal(helper(g1, null), null, 'a helper whose host sends no effort');
  assert.equal(helper(g1, 'xhigh', 'Bash', { command: 'ls' }, { CLAUDE_EFFORT: 'high' }), null, 'the session environment is the gate\'s, not the helper\'s');
  assert.match(helper(g1, 'medium'), /this G1 helper runs on effort medium, but the owner-claude\/BUILDER_HELPER pin is haiku-5.5\/xhigh/);
  assert.match(helper(g2, 'xhigh', 'mcp__github__add_issue_comment', { body: `Toolkit-G2: PASS ${HEAD} tier=NORMAL\nRoute: host-verified opus-5.5/xhigh pin=owner-claude/opus\n---` }), /a helper does not post a Toolkit-G2 verdict/);
  // The gate's own calls are still checked.
  assert.match(route.preToolUse({ transcript_path: g1, cwd: dir, tool_name: 'Bash', tool_input: { command: 'ls' }, effort: { level: 'xhigh' } }, { environment: {}, registry }), /this G1 runs on effort xhigh/);
});

test('only a published comment whose first line is a verdict is read as a verdict', t => {
  const dir = scratch(t);
  const g2 = transcript(dir, { brief: G2, effort: 'xhigh' });
  const g1 = transcript(dir, { brief: G1 });
  const none = transcript(dir, { brief: 'Keep the records.' });
  const off = transcript(dir, { brief: G2, effort: 'medium' });
  const stamp2 = 'Route: host-verified opus-5.5/xhigh pin=owner-claude/opus';
  const verdict = `Toolkit-G2: PASS ${HEAD} tier=NORMAL`;
  const file = (name, text) => { const out = path.join(dir, name); fs.writeFileSync(out, text); return out; };
  const unstamped = file('unstamped.md', `${verdict}\n---\nReport: x\n`);
  const stamped = file('stamped.md', `${verdict}\n${stamp2}\n---\nReport: x\n`);
  const call = (session, tool_name, tool_input) => route.preToolUse({ transcript_path: session, cwd: dir, tool_name, tool_input }, { environment: {}, registry });
  const read = `gh api repos/o/r/issues/5/comments --jq '.[] | select(.body | startswith("${verdict}")) | .html_url'`;
  const heredoc = text => `gh pr comment 5 --body "$(cat <<'EOF'\n${text}\nEOF\n)"`;
  const cases = [
    // Reads and quotes, from every kind of session.
    ['records thread quotes a verdict inline', none, 'mcp__github__add_issue_comment', { body: `The G2 posted "${verdict}" at 11:31, so the train can pick it up.` }, null],
    ['records thread reads verdicts with gh api', none, 'Bash', { command: read }, null],
    ['G2 reads its own posted verdict', g2, 'Bash', { command: read }, null],
    ['G1 reads the verdict', g1, 'Bash', { command: read }, null],
    ['G1 quotes the verdict in a reply', g1, 'mcp__github__add_issue_comment', { body: `Fixed what ${verdict} asked for.` }, null],
    ['search with GET fields', none, 'Bash', { command: `gh api -X GET search/issues -f q="${verdict}"` }, null],
    ['gh pr view', g1, 'Bash', { command: `gh pr view 5 --comments | grep "${verdict}"` }, null],
    // Real verdict posts, every way gh writes one.
    ['G2 heredoc verdict with its stamp', g2, 'Bash', { command: heredoc(`${verdict}\n${stamp2}\n---\nReport: x`) }, null],
    ['G2 heredoc verdict, unstamped', g2, 'Bash', { command: heredoc(`${verdict}\n---\nReport: x`) }, /route stamp/],
    ['G2 api raw field with its stamp', g2, 'Bash', { command: `gh api repos/o/r/issues/5/comments -f body="${verdict}\n${stamp2}\n---"` }, null],
    ['G2 api raw field, unstamped', g2, 'Bash', { command: `gh api repos/o/r/issues/5/comments -f body="${verdict}\n---"` }, /route stamp/],
    ['G2 api -F body file, unstamped', g2, 'Bash', { command: `gh api repos/o/r/issues/5/comments -F body=@${unstamped}` }, /route stamp/],
    ['G2 api --field body file, unstamped', g2, 'Bash', { command: `gh api repos/o/r/issues/5/comments --field body=@${unstamped}` }, /route stamp/],
    ['G2 api --field body file with its stamp', g2, 'Bash', { command: `gh api repos/o/r/issues/5/comments --field body=@${stamped}` }, null],
    ['G2 comment body file, unstamped', g2, 'Bash', { command: `gh pr comment 5 --body-file ${unstamped}` }, /route stamp/],
    ['G2 comment from cat of a file, unstamped', g2, 'Bash', { command: `gh pr comment 5 --body "$(cat ${unstamped})"` }, /route stamp/],
    ['G1 posts a real verdict', g1, 'Bash', { command: `gh pr comment 5 --body-file ${stamped}` }, /G1 session does not post a Toolkit-G2 verdict/],
    ['records thread posts an unmarked verdict', none, 'Bash', { command: `gh issue comment 5 --body-file ${stamped}` }, /must be `Route: UNVERIFIED`/],
    // An off-pin gate keeps only its messaging tools.
    ['off-pin gate cannot start a device session', off, 'mcp__hearthbot__start_remote_control', { instructions: 'x' }, /runs on effort medium/],
    ['off-pin gate can message the coordinator', off, 'mcp__hearthbot__message_coordinator', { text: 'Off route.' }, null],
  ];
  for (const [name, session, tool, input, want] of cases) {
    const got = call(session, tool, input);
    if (want) assert.match(got || '', want, name); else assert.equal(got, null, `${name}: ${got}`);
  }
});
