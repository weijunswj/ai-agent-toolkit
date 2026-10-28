'use strict';
require('./toolkit-test-temp-guard.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const HOOK = path.join(ROOT, 'repo', 'scripts', 'toolkit-claude-project-gate-route-hook.cjs');
const { decide, gateDeclaration, normaliseModel, gateRouteLine } = require('../scripts/toolkit-claude-project-gate-route-hook.cjs');

const START = 'mcp__hearthbot__start_thread';
const READ = 'mcp__hearthbot__read_memory';
const UPDATE = 'mcp__hearthbot__update_memory';
const FOLDER = 'C:\\Users\\example\\GitHub\\toolkit';
const RC_LINE = `GATE ROUTE: profile owner-claude placement remote_control folder ${FOLDER}`;
const REGISTRY = JSON.parse(fs.readFileSync(path.join(ROOT, 'repo', 'contracts', 'controller-kernel', 'stack-registry-v3.json'), 'utf8'));
const TWO_REVIEWERS = {
  profiles: {
    ...REGISTRY.profiles,
    'two-review': {
      routes: REGISTRY.profiles['owner-claude'].routes,
      reviewers: [
        { reviewer_id: 'opus', provider: 'anthropic', model: 'opus-5.5', reasoning: 'xhigh' },
        { reviewer_id: 'second', provider: 'anthropic', model: 'opus-5.5', reasoning: 'high' },
      ],
    },
  },
};
let callCount = 0;

// Transcript lines in Claude Code's shape: a memory tool call and its result.
function call(name, input, result = 'ok', isError = false) {
  const id = `toolu_${callCount += 1}`;
  return [
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content: [{ type: 'text', text: result }] }] } },
  ];
}
const memory = text => call(READ, {}, `# MEMORY.md\n- BINDING: example\n- ${text}\n- other note`);
const lines = entries => entries.flat().map(entry => JSON.stringify(entry));
const GOOD_G0 = { effort: 'high', model: 'claude-opus-5-5', device: { mode: 'remote_control', folder: FOLDER } };

// One launch: the brief, the tool fields, the transcript entries and the registry.
function launch({ gate = 'G0', title = 'Plan the export fix', brief, fields = GOOD_G0, transcript = [memory(RC_LINE)], registry = () => REGISTRY, tool = START, path: transcriptPath = 't.jsonl' } = {}) {
  const instructions = brief ?? (gate === null ? 'Plan the export fix.' : `Gate: ${gate}\nPlan the export fix.`);
  return decide({ tool_name: tool, transcript_path: transcriptPath, tool_input: { title, instructions, ...fields } }, { readLines: () => lines(transcript), readRegistry: registry });
}

// The closure matrix: [row, launch options, expected ('' for pass, or a pattern the refusal must match)].
const ROWS = [
  ['1 Gate none passes whatever its fields', { gate: 'none', fields: {}, transcript: [] }, ''],
  ['1 Gate none with text after it', { brief: 'Gate: none (record keeper). Re-check the G2 verdict file.', fields: {} }, ''],
  ['2 no Gate line and no gate word', { gate: null, fields: {}, transcript: [] }, ''],
  ['3 G0 in the brief without a Gate line', { brief: 'Run a G0 for the export fix.', fields: {} }, /mentions "G0" but the brief has no Gate line/],
  ['4 gate in the title only', { gate: null, title: 'Fix the gate check', fields: {} }, /mentions "gate"/],
  ['4 recheck and re-check are gate words', { brief: 'Please Re-check the verdict.', fields: {} }, /mentions "Re-check"/],
  ['4 upper-case role names are gate words', { brief: 'Act as BUILDER.', fields: {} }, /mentions "BUILDER"/],
  ['5 lower-case g0 and discovery are not', { gate: null, brief: 'Read g0 notes and discovery docs.', fields: {} }, ''],
  ['6 G0 on route', {}, ''],
  ['7 effort missing', { fields: { ...GOOD_G0, effort: undefined } }, /Missing or wrong: effort \(got none\)\./],
  ['8 effort medium', { fields: { ...GOOD_G0, effort: 'medium' } }, /effort \(got "medium"\)/],
  ['9 model missing', { fields: { ...GOOD_G0, model: undefined } }, /model \(got none\)/],
  ['10 model alias opus', { fields: { ...GOOD_G0, model: 'opus' } }, /model \(got "opus"\)/],
  ['11 model with a context tag', { fields: { ...GOOD_G0, model: 'claude-opus-5-5[1m]' } }, ''],
  ['11 model in registry form', { fields: { ...GOOD_G0, model: 'opus-5.5' } }, ''],
  ['12 an older model', { fields: { ...GOOD_G0, model: 'claude-opus-5' } }, /model \(got "claude-opus-5"\)/],
  ['12 another family', { fields: { ...GOOD_G0, model: 'claude-sonnet-5-5' } }, /model \(got "claude-sonnet-5-5"\)/],
  ['13 cloud launch', { fields: { effort: 'high', model: 'claude-opus-5-5' } }, /device \(got cloud\)/],
  ['14 Remote Control in another folder', { fields: { ...GOOD_G0, device: { mode: 'remote_control', folder: 'C:\\Users\\example\\other' } } }, /device \(got remote_control in "C:\\\\Users\\\\example\\\\other"\)/],
  ['14 Remote Control with no folder', { fields: { ...GOOD_G0, device: { mode: 'remote_control' } } }, /device \(got remote_control in null\)/],
  ['14 a files device is not Remote Control', { fields: { ...GOOD_G0, device: { folder: FOLDER } } }, /device \(got files\)/],
  ['15 folder differs by case and trailing separator', { fields: { ...GOOD_G0, device: { mode: 'remote_control', folder: 'c:/users/EXAMPLE/GitHub/toolkit\\' } } }, ''],
  ['15 Remote Control line without a folder takes any folder', { transcript: [memory('GATE ROUTE: profile owner-claude placement remote_control')], fields: { ...GOOD_G0, device: { mode: 'remote_control', folder: 'D:\\x' } } }, ''],
  ['16 cloud line, no device', { transcript: [memory('GATE ROUTE: profile owner-claude placement cloud')], fields: { effort: 'high', model: 'claude-opus-5-5' } }, ''],
  ['16 cloud line, files device', { transcript: [memory('GATE ROUTE: profile owner-claude placement cloud')], fields: { effort: 'high', model: 'claude-opus-5-5', device: { mode: 'files', folder: FOLDER } } }, ''],
  ['17 cloud line, Remote Control device', { transcript: [memory('GATE ROUTE: profile owner-claude placement cloud')] }, /no device \(a cloud thread\)\. Missing or wrong: device \(got remote_control/],
  ['18 any placement, cloud', { transcript: [memory('GATE ROUTE: profile owner-claude placement any')], fields: { effort: 'high', model: 'claude-opus-5-5' } }, ''],
  ['18 any placement, Remote Control', { transcript: [memory('GATE ROUTE: profile owner-claude placement any')] }, ''],
  ['19 G1 at high', { gate: 'G1. You are the G1 builder.' }, ''],
  ['19 G1 at xhigh', { gate: 'G1', fields: { ...GOOD_G0, effort: 'xhigh' } }, /G1 \(BUILDER, profile owner-claude\) must start with effort "high"/],
  ['20 G2 at xhigh', { gate: 'G2', fields: { ...GOOD_G0, effort: 'xhigh' } }, ''],
  ['20 G2 at high', { gate: 'G2', fields: GOOD_G0 }, /G2 \(reviewer opus, profile owner-claude\) must start with effort "xhigh"/],
  ['21 G2 recheck is G2', { gate: 'G2 recheck', fields: { ...GOOD_G0, effort: 'xhigh' } }, ''],
  ['21 recheck is G2', { gate: 'recheck', fields: GOOD_G0 }, /G2 \(reviewer opus/],
  ['21 delta review is G2', { gate: 'delta review', fields: { ...GOOD_G0, effort: 'xhigh' } }, ''],
  ['22 two reviewers, none named', { gate: 'G2', transcript: [memory(RC_LINE.replace('owner-claude', 'two-review'))], registry: () => TWO_REVIEWERS }, /more than one reviewer \(opus, second\)/],
  ['22 two reviewers, one named', { gate: 'G2 reviewer second', transcript: [memory(RC_LINE.replace('owner-claude', 'two-review'))], registry: () => TWO_REVIEWERS }, ''],
  ['22 two reviewers, unknown one named', { gate: 'G2 reviewer third', transcript: [memory(RC_LINE.replace('owner-claude', 'two-review'))], registry: () => TWO_REVIEWERS }, /more than one reviewer/],
  ['23 design challenge at xhigh', { gate: 'design challenge', fields: { ...GOOD_G0, effort: 'xhigh' } }, ''],
  ['23 design challenge at high', { gate: 'Design challenge', fields: GOOD_G0 }, /DESIGN_CHALLENGE, profile owner-claude\) must start with effort "xhigh"/],
  ['24 an openai profile', { transcript: [memory(RC_LINE.replace('owner-claude', 'owner-gpt'))] }, /runs on provider openai, which cannot run as a Projects thread/],
  ['25 unknown profile', { transcript: [memory(RC_LINE.replace('owner-claude', 'owner-x'))] }, /profile "owner-x", which the stack registry does not have \(known profiles: owner-gpt, owner-claude\)/],
  ['26 memory read, no line', { transcript: [call(READ, {}, '- BINDING: example')] }, /project memory has none\. Add one line `GATE ROUTE: profile <profile> placement/],
  ['26 malformed line', { transcript: [memory('GATE ROUTE: owner-claude on the laptop')] }, /does not read as `GATE ROUTE: profile/],
  ['27 no read_memory in the transcript', { transcript: [] }, /has not read project memory\. Call read_memory/],
  ['27 a failed read_memory does not count', { transcript: [call(READ, {}, RC_LINE, true)] }, /has not read project memory/],
  ['28 a newer line in update_memory wins', { transcript: [memory(RC_LINE), call(UPDATE, { content: RC_LINE.replace('remote_control folder', 'cloud folder').replace(/ folder .*$/, '') })] }, /device \(got remote_control/],
  ['28 a newer read wins over an older update', { transcript: [call(UPDATE, { content: 'GATE ROUTE: profile owner-claude placement cloud' }), memory(RC_LINE)] }, ''],
  ['28 a failed update does not count', { transcript: [memory(RC_LINE), call(UPDATE, { content: 'GATE ROUTE: profile owner-claude placement cloud' }, 'error', true)] }, ''],
  ['28 the old text of an edit does not count', { transcript: [memory('GATE ROUTE: profile owner-claude placement cloud'), call(UPDATE, { old_str: 'GATE ROUTE: profile owner-claude placement cloud', new_str: RC_LINE })] }, ''],
  ['28 an update before any read counts once memory was read', { transcript: [call(READ, {}, '- BINDING: x'), call(UPDATE, { content: RC_LINE })] }, ''],
  ['29 registry unreadable', { registry: () => { throw new Error('ENOENT'); } }, /stack registry bundled with this plugin cannot be read/],
  ['29 registry not a registry', { registry: () => ({ schema: 'x' }) }, /cannot be read/],
  ['30 gate with no transcript path', { path: '' }, /has not read project memory/],
  ['30 gate with an unreadable transcript', { transcript: null }, /has not read project memory/],
  ['30 non-gate with no transcript path', { gate: 'none', path: '' }, ''],
  ['33 a Gate line inside a code fence is ignored', { brief: 'Run the G0.\n```\nGate: G0\n```', fields: {} }, /mentions "G0" but the brief has no Gate line/],
  ['34 the first Gate line wins', { brief: 'Gate: G0\nGate: none\nPlan it.' }, ''],
  ['34 the first Gate line wins, refusing', { brief: '**Gate:** G0\nGate: none', fields: {} }, /Missing or wrong: effort/],
  ['35 an unknown value', { gate: 'G3', fields: {} }, /Gate line says "G3", which is not a gate value\. Use one of G0, G1, G2/],
];

test('the closure matrix: every row passes or refuses as planned', () => {
  for (const [row, options, expected] of ROWS) {
    const transcript = options.transcript === null ? undefined : options.transcript;
    const result = options.transcript === null
      ? decide({ tool_name: START, transcript_path: 't', tool_input: { title: 't', instructions: 'Gate: G0', ...GOOD_G0 } }, { readLines: () => { throw new Error('EACCES'); }, readRegistry: () => REGISTRY })
      : launch({ ...options, transcript });
    if (expected === '') assert.equal(result, '', row);
    else assert.match(result, expected, row);
  }
});

test('31: other tools are never checked, even with gate words and no memory', () => {
  for (const tool of ['mcp__hearthbot__post_message', 'Agent', 'Bash', 'mcp__hearthbot__message_thread', 'start_thread', 'mcp__other__start_thread']) {
    assert.equal(launch({ tool, brief: 'Run the G0 now.', fields: {}, transcript: [] }), '', tool);
  }
  assert.equal(decide({ tool_name: START }), '');
  assert.equal(decide({ tool_name: START, tool_input: 'Gate: G0' }), '');
});

test('36: a gate refusal names every failing field with paste-ready values and never offers Gate: none', () => {
  const reason = launch({ fields: { model: 'opus' } });
  assert.equal(reason, `Toolkit Projects rule: gate route. This G0 (DISCOVERY, profile owner-claude) must start with effort "high", model "claude-opus-5-5" and device {"mode":"remote_control","folder":"C:\\\\Users\\\\example\\\\GitHub\\\\toolkit"}. Missing or wrong: effort (got none), model (got "opus"), device (got cloud). The owner's project rules ask for these values on every gate. Pass those fields to start_thread and launch again.`);
  // The device JSON pastes back as the right value.
  const device = JSON.parse(reason.match(/device (\{.*?\})\./)[1]);
  assert.deepEqual(device, { mode: 'remote_control', folder: FOLDER });
  // Only the refusals that ask for a Gate line list none as a value; no route refusal offers it.
  let routeRefusals = 0;
  for (const [row, options] of ROWS) {
    const result = launch(options.transcript === null ? {} : options);
    if (!result || /no Gate line|not a gate value/.test(result)) continue;
    routeRefusals += 1;
    assert.doesNotMatch(result, /Gate: none|or none\b|value none/, row);
  }
  assert.ok(routeRefusals > 20, String(routeRefusals));
});

test('helpers: Gate line forms, model names and the GATE ROUTE line', () => {
  assert.deepEqual(gateDeclaration('**Gate:** G1 builder'), { gate: 'G1', reviewer: null });
  assert.deepEqual(gateDeclaration('- **Gate: G2 recheck, reviewer opus**'), { gate: 'G2', reviewer: 'opus' });
  assert.deepEqual(gateDeclaration('gate: re-check'), { gate: 'G2', reviewer: null });
  assert.deepEqual(gateDeclaration('Intro.\n~~~\nGate: G0\n~~~\nGate: none'), { gate: 'NONE', reviewer: null });
  assert.equal(gateDeclaration('The gate rules apply.'), null);
  assert.deepEqual(gateDeclaration('Gate: G01'), { unknown: 'G01' });
  for (const model of ['claude-opus-5-5', 'claude-opus-5-5[1m]', 'opus-5.5', ' Claude-Opus-5-5 ']) assert.equal(normaliseModel(model), 'opus-5-5', model);
  for (const model of ['opus', 'claude-opus-5', 'claude-sonnet-5-5', 'claude-opus-5-5-x', '', undefined]) assert.notEqual(normaliseModel(model), 'opus-5-5', String(model));
  assert.deepEqual(gateRouteLine(`- \`${RC_LINE}\``), { profile: 'owner-claude', placement: 'remote_control', folder: FOLDER });
  assert.deepEqual(gateRouteLine('GATE ROUTE: profile p placement any'), { profile: 'p', placement: 'any', folder: null });
  assert.deepEqual(gateRouteLine('GATE ROUTE: profile p placement any\nGATE ROUTE: profile q placement cloud'), { profile: 'q', placement: 'cloud', folder: null });
  assert.deepEqual(gateRouteLine('GATE ROUTE: profile p placement laptop'), { malformed: 'GATE ROUTE: profile p placement laptop' });
  assert.equal(gateRouteLine('no line here'), null);
  // The folder runs to the end of the line, spaces included.
  assert.equal(gateRouteLine('GATE ROUTE: profile p placement remote_control folder C:\\My Repos\\x').folder, 'C:\\My Repos\\x');
});

test('the hook process denies with a reason, passes the rest, and reads its bundled registry', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-gate-route-hook-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const transcript = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(transcript, `${lines([memory(RC_LINE)]).join('\n')}\n`);
  const run = input => spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8' });
  const tool = fields => JSON.stringify({ tool_name: START, transcript_path: transcript, tool_input: { title: 'Plan it', instructions: 'Gate: G0\nPlan it.', ...fields } });
  const denied = run(tool({}));
  assert.equal(denied.status, 2);
  const decision = JSON.parse(denied.stdout).hookSpecificOutput;
  assert.equal(decision.hookEventName, 'PreToolUse');
  assert.equal(decision.permissionDecision, 'deny');
  assert.match(decision.permissionDecisionReason, /effort "high", model "claude-opus-5-5"/);
  const allowed = run(tool(GOOD_G0));
  assert.equal(allowed.status, 0);
  assert.equal(allowed.stdout, '');
  // 32: input that is not JSON, another tool and a non-gate launch all pass silently.
  for (const input of ['not json', '', JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'G0' } }), JSON.stringify({ tool_name: START, tool_input: { title: 'x', instructions: 'Write the notes.' } })]) {
    const result = run(input);
    assert.equal(result.status, 0, input);
    assert.equal(result.stdout, '', input);
  }
});

test('only the Claude Code plugin registers the hook, on start_thread alone and without onFailure block', () => {
  for (const rel of ['.claude-plugin/hooks/hooks.json', 'repo/contracts/toolkit-local-bridge/claude-plugin/hooks/hooks.json']) {
    const hooks = JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    const entries = hooks.hooks.PreToolUse.filter(entry => entry.hooks.some(hook => /toolkit-claude-project-gate-route-hook/.test(hook.command)));
    assert.deepEqual(entries, [{ matcher: '^mcp__hearthbot__start_thread$', hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/repo/scripts/toolkit-claude-project-gate-route-hook.cjs"', timeout: 10 }] }], rel);
  }
  for (const other of ['.codex-plugin/hooks/hooks.json', 'repo/contracts/toolkit-local-bridge/codex-plugin/hooks/hooks.json']) {
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, other), 'utf8'), /gate-route-hook/, other);
  }
});
