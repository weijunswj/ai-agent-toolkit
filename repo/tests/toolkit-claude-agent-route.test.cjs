'use strict';
require('./toolkit-test-temp-guard.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const route = require('../scripts/toolkit-claude-agent-route.cjs');
const tail = require('../scripts/toolkit-transcript-tail.cjs');
const hook = require('../scripts/toolkit-claude-agent-hook.cjs');
const hostile = require('./support/hostile-inputs.cjs');

const { costDecision, targetRoute, readFrontMatter, SKILL_REASON, COULD_NOT_CHECK } = route;
const BOM = String.fromCharCode(0xfeff);

const definition = (name, model, effort, extra = '') => `---\nname: ${name}\ndescription: Test agent.\n${model === undefined ? '' : `model: ${model}\n`}${effort === undefined ? '' : `effort: ${effort}\n`}${extra}---\n\nReply OK.\n`;

// Transcript entries as Claude Code writes them.
const said = (model, effort) => ({ type: 'assistant', message: { model, content: [{ type: 'text', text: 'ok' }] }, effort });
const skillCall = name => ({ type: 'assistant', message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: 't1', name: 'Skill', input: { skill: name } }] }, effort: 'high' });
const typed = name => ({ type: 'user', message: { role: 'user', content: `<command-name>/${name}</command-name>\n<command-message>${name}</command-message>` } });
const compaction = { type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted' };
const SKILL = skillCall('ai-agent-toolkit:agent-cost-control');
const caller = (model, effort) => [SKILL, said(`claude-${model}`, effort)];

// A scratch git repository (with a nested working folder), a Claude config folder and a managed
// agents folder. Nothing outside `base`.
class Scratch {
  constructor() {
    this.base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-agent-route-')));
    this.repo = path.join(this.base, 'repo');
    this.nested = path.join(this.repo, 'packages', 'app');
    this.config = path.join(this.base, 'config');
    this.managed = path.join(this.base, 'managed', '.claude', 'agents');
    this.transcript = path.join(this.base, 'session.jsonl');
    fs.mkdirSync(path.join(this.repo, '.git'), { recursive: true });
    fs.mkdirSync(this.nested, { recursive: true });
  }
  write(relative, text) { const file = path.join(this.base, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
  entries(list) { fs.writeFileSync(this.transcript, `${list.map(entry => JSON.stringify(entry)).join('\n')}\n`); }
  environment(extra = {}) { return { CLAUDE_CONFIG_DIR: this.config, ...extra }; }
  input(tool_input, cwd = this.repo) { return { tool_name: 'Agent', cwd, transcript_path: this.transcript, tool_input }; }
  remove() { fs.rmSync(this.base, { recursive: true, force: true }); }
}

const reason = output => output?.hookSpecificOutput?.permissionDecisionReason || null;
const decisionOf = output => output?.hookSpecificOutput?.permissionDecision || 'pass';
const launch = (subagent_type, extra = {}) => ({ ...(subagent_type === undefined ? {} : { subagent_type }), description: 'test', prompt: 'Reply OK', ...extra });

// [case, tool_input, caller { model, effort }, expected { model, effort } (source too when given), options]
const ROUTES = [
  ['a call model alias', launch('general-purpose', { model: 'haiku' }), { model: 'claude-opus-5-5', effort: 'high' }, { model: 'haiku-5.5', effort: 'default', source: 'call' }],
  ['a call model and effort', launch('general-purpose', { model: 'sonnet', effort: 'low' }), { model: 'claude-opus-5-5', effort: 'high' }, { model: 'sonnet-5.5', effort: 'low' }],
  ['no model inherits the caller route', launch('general-purpose'), { model: 'claude-opus-5-5', effort: 'high' }, { model: 'opus-5.5', effort: 'high', source: 'inherits' }],
  ['no type inherits too', launch(undefined), { model: 'claude-sonnet-5-5', effort: 'medium' }, { model: 'sonnet-5.5', effort: 'medium' }],
  ['the same model on the call keeps the caller effort', launch('general-purpose', { model: 'opus' }), { model: 'claude-opus-5-5', effort: 'high' }, { model: 'opus-5.5', effort: 'high' }],
  ['a call model inherit counts as none', launch('general-purpose', { model: 'inherit' }), { model: 'claude-opus-5-5', effort: 'high' }, { model: 'opus-5.5', effort: 'high' }],
  ['a fork runs on the caller route whatever the call says', launch('fork', { model: 'haiku', effort: 'low' }), { model: 'claude-opus-5-5[1m]', effort: 'high' }, { model: 'opus-5.5', effort: 'high', source: 'fork' }],
  ['Explore inherits', launch('Explore'), { model: 'claude-opus-5-5', effort: 'xhigh' }, { model: 'opus-5.5', effort: 'xhigh' }],
  ['Explore ignores an unforced model variable', launch('Explore'), { model: 'claude-opus-5-5', effort: 'high' }, { model: 'opus-5.5', effort: 'high' }, { environment: { CLAUDE_CODE_SUBAGENT_MODEL: 'haiku' } }],
  ['general-purpose takes the model variable', launch('general-purpose'), { model: 'claude-opus-5-5', effort: 'high' }, { model: 'haiku-5.5', effort: 'default' }, { environment: { CLAUDE_CODE_SUBAGENT_MODEL: 'haiku' } }],
  ['a forced variable beats the call model', launch('Explore', { model: 'opus' }), { model: 'claude-opus-5-5', effort: 'high' }, { model: 'haiku-5.5', effort: 'default' },
    { environment: { CLAUDE_CODE_SUBAGENT_MODEL: 'claude-haiku-5-5', CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1' } }],
  ['the higher of the call effort and CLAUDE_CODE_EFFORT_LEVEL', launch('general-purpose', { model: 'haiku', effort: 'low' }), { model: 'claude-opus-5-5', effort: 'high' }, { model: 'haiku-5.5', effort: 'xhigh' },
    { environment: { CLAUDE_CODE_EFFORT_LEVEL: 'xhigh' } }],
  ['CLAUDE_CODE_SUBAGENT_EFFORT on another model', launch('general-purpose', { model: 'haiku' }), { model: 'claude-opus-5-5', effort: 'high' }, { model: 'haiku-5.5', effort: 'medium' },
    { environment: { CLAUDE_CODE_SUBAGENT_EFFORT: 'medium' } }],
  ['own-model built-ins', launch('claude-code-guide'), { model: 'claude-opus-5-5', effort: 'high' }, { model: 'haiku-5.5', effort: 'default', source: 'built-in' }],
  ['statusline-setup runs on sonnet', launch('statusline-setup'), { model: 'claude-opus-5-5', effort: 'high' }, { model: 'sonnet-5.5', effort: 'default' }],
  ['a project file pins model and effort, found by name', launch('checker'), { model: 'claude-opus-5-5', effort: 'high' }, { model: 'haiku-5.5', effort: 'xhigh', source: 'definition' },
    { files: { 'repo/.claude/agents/other.md': definition('checker', 'claude-haiku-5-5', 'xhigh') } }],
  ['a project file with model inherit', launch('reviewer'), { model: 'claude-sonnet-5-5', effort: 'low' }, { model: 'sonnet-5.5', effort: 'low', source: 'inherits' },
    { files: { 'repo/.claude/agents/reviewer.md': definition('reviewer', 'inherit') } }],
  ['a project file with no model takes the variable', launch('reviewer'), { model: 'claude-opus-5-5', effort: 'high' }, { model: 'sonnet-5.5', effort: 'default' },
    { environment: { CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet' }, files: { 'repo/.claude/agents/reviewer.md': definition('reviewer') } }],
  ['a user file named Explore overrides the built-in', launch('Explore'), { model: 'claude-opus-5-5', effort: 'high' }, { model: 'haiku-5.5', effort: 'low' },
    { files: { 'config/agents/explore.md': definition('Explore', 'haiku', 'low') } }],
  ['the managed folder outranks the project', launch('reviewer'), { model: 'claude-opus-5-5', effort: 'high' }, { model: 'opus-5.5', effort: 'high' },
    { files: { 'managed/.claude/agents/r.md': definition('reviewer', 'inherit'), 'repo/.claude/agents/reviewer.md': definition('reviewer', 'haiku') } }],
  ['the project outranks the user folder', launch('reviewer'), { model: 'claude-opus-5-5', effort: 'high' }, { model: 'opus-5.5', effort: 'high' },
    { files: { 'repo/.claude/agents/reviewer.md': definition('reviewer'), 'config/agents/reviewer.md': definition('reviewer', 'sonnet') } }],
  ['the closest project folder wins', launch('reviewer'), { model: 'claude-opus-5-5', effort: 'high' }, { model: 'haiku-5.5', effort: 'default' },
    { cwd: s => s.nested, files: { 'repo/packages/app/.claude/agents/reviewer.md': definition('reviewer', 'haiku'), 'repo/.claude/agents/reviewer.md': definition('reviewer', 'inherit') } }],
  ['a folder above the git root is not read', launch('reviewer'), { model: 'claude-opus-5-5', effort: 'high' }, { model: null, effort: null, source: 'unknown agent' },
    { files: { '.claude/agents/reviewer.md': definition('reviewer', 'haiku') } }],
  ['an installed plugin copy', launch('review-kit:code-reviewer'), { model: 'claude-opus-5-5', effort: 'high' }, { model: 'opus-5.5', effort: 'high' },
    { files: { 'config/plugins/cache/m/review-kit/1.0.0/agents/code-reviewer.md': definition('code-reviewer', 'inherit') } }],
  ['the last version folder in name order is read first', launch('review-kit:code-reviewer'), { model: 'claude-opus-5-5', effort: 'high' }, { model: 'sonnet-5.5', effort: 'default' },
    { files: { 'config/plugins/cache/m/review-kit/1.0.0/agents/code-reviewer.md': definition('code-reviewer', 'inherit'), 'config/plugins/cache/m/review-kit/2.0.0/agents/code-reviewer.md': definition('code-reviewer', 'sonnet') } }],
  ['a marketplace plugin copy and a nested name', launch('review-kit:deep:code-reviewer'), { model: 'claude-opus-5-5', effort: 'high' }, { model: 'haiku-5.5', effort: 'low' },
    { files: { 'config/plugins/marketplaces/m/plugins/review-kit/agents/deep/code-reviewer.md': definition('code-reviewer', 'haiku', 'low') } }],
  ['a plugin name that climbs folders is not looked up', launch('..:code-reviewer'), { model: 'claude-opus-5-5', effort: 'high' }, { model: null, effort: null },
    { files: { 'config/plugins/marketplaces/m/plugins/review-kit/agents/code-reviewer.md': definition('code-reviewer', 'haiku') } }],
  ['a plugin agent with no copy is unknown', launch('some-plugin:reviewer'), { model: 'claude-opus-5-5', effort: 'high' }, { model: null, effort: null }],
  ['an unknown name is unknown', launch('reviewer'), { model: 'claude-opus-5-5', effort: 'high' }, { model: null, effort: null }],
  ['an unreadable definition counts as not found', launch('reviewer'), { model: 'claude-opus-5-5', effort: 'high' }, { model: null, effort: null },
    { files: { 'repo/.claude/agents/reviewer.md': definition('reviewer', '[inherit]') } }],
  ['an inheriting launch with no caller route is unknown', launch('general-purpose'), {}, { model: null, effort: null }],
  ['a subagent_type that is not a string is unreadable', launch(42), { model: 'claude-opus-5-5', effort: 'high' }, { model: null, effort: null, source: 'unreadable' }],
];

test('the target route follows Claude Code model and effort order', () => {
  for (const [name, input, from, expected, options = {}] of ROUTES) {
    const scratch = new Scratch();
    try {
      for (const [file, text] of Object.entries(options.files || {})) scratch.write(file, text);
      const got = targetRoute(scratch.input(input, options.cwd ? options.cwd(scratch) : scratch.repo), { environment: scratch.environment(options.environment), managedAgentsDirectory: scratch.managed, caller: from });
      assert.equal(got.model, expected.model, `${name}: model`);
      assert.equal(got.effort, expected.effort, `${name}: effort`);
      if (expected.source) assert.equal(got.source, expected.source, `${name}: source`);
    } finally { scratch.remove(); }
  }
});

const ASK = /^Toolkit: this .+ would run on .+, not cheaper than this agent's .+\. Allow only if the cost is worth it/;
const MAX = /would run at max effort/;

// [case, tool_input, transcript entries (null: no transcript file), expected ('pass', 'skill', 'ask', 'max' or 'unknown'), options]
const COSTS = [
  ['no skill read, a cheaper launch', launch('general-purpose', { model: 'haiku' }), [said('claude-opus-5-5', 'high')], 'skill'],
  ['the skill read before the last compaction', launch('general-purpose', { model: 'haiku' }), [SKILL, compaction, said('claude-opus-5-5', 'high')], 'skill'],
  ['another skill does not count', launch('general-purpose', { model: 'haiku' }), [skillCall('agent-cost-control-extra'), said('claude-opus-5-5', 'high')], 'skill'],
  ['a subagent skill read does not count', launch('general-purpose', { model: 'haiku' }), [{ ...SKILL, isSidechain: true }, said('claude-opus-5-5', 'high')], 'skill'],
  ['a Toolkit helper preset needs no skill read', launch('toolkit-g0-helper'), [said('claude-opus-5-5', 'high')], 'pass',
    { files: { 'config/agents/toolkit-g0-helper.md': definition('toolkit-g0-helper', 'claude-haiku-5-5', 'xhigh') } }],
  ['a preset still passes the cost test', launch('toolkit-g1-helper'), [said('claude-haiku-5-5', 'low')], 'ask',
    { files: { 'config/agents/toolkit-g1-helper.md': definition('toolkit-g1-helper', 'claude-haiku-5-5', 'xhigh') } }],
  ['a preset that is not installed cannot be checked', launch('toolkit-g0-helper'), [said('claude-opus-5-5', 'high')], 'unknown'],
  ['a cheaper model after the skill', launch(undefined, { model: 'haiku' }), caller('opus-5-5', 'high'), 'pass'],
  ['owner example: haiku xhigh from opus high', launch('checker'), caller('opus-5-5', 'high'), 'pass', { files: { 'repo/.claude/agents/checker.md': definition('checker', 'haiku', 'xhigh') } }],
  ['owner example: haiku xhigh from sonnet low', launch(undefined, { model: 'haiku', effort: 'xhigh' }), caller('sonnet-5-5', 'low'), 'pass'],
  ['owner example: sonnet low from haiku xhigh', launch(undefined, { model: 'sonnet', effort: 'low' }), caller('haiku-5-5', 'xhigh'), 'ask'],
  ['the same family at a lower effort', launch(undefined, { model: 'opus', effort: 'medium' }), caller('opus-5-5', 'high'), 'pass'],
  ['the typed skill command counts', launch(undefined, { model: 'haiku' }), [typed('agent-cost-control'), said('claude-opus-5-5', 'high')], 'pass'],
  ['a plugin-named typed skill counts', launch(undefined, { model: 'haiku' }), [typed('ai-agent-toolkit:agent-cost-control'), said('claude-opus-5-5', 'high')], 'pass'],
  ['an own-model built-in', launch('claude-code-guide'), caller('opus-5-5', 'high'), 'pass'],
  ['the 23 Nov shape: general-purpose with no model', launch('general-purpose'), caller('opus-5-5', 'high'), 'ask'],
  ['a raised model', launch('general-purpose', { model: 'opus' }), caller('sonnet-5-5', 'medium'), 'ask'],
  ['a raised effort on the call', launch('general-purpose', { model: 'sonnet', effort: 'high' }), caller('sonnet-5-5', 'medium'), 'ask'],
  ['a raised effort in the agent file', launch('reviewer'), caller('sonnet-5-5', 'medium'), 'ask', { files: { 'repo/.claude/agents/reviewer.md': definition('reviewer', 'sonnet', 'high') } }],
  ['the same route', launch(undefined, { model: 'sonnet', effort: 'medium' }), caller('sonnet-5-5', 'medium'), 'ask'],
  ['a fork', launch('fork'), caller('opus-5-5', 'high'), 'ask'],
  ['Explore inherits', launch('Explore'), caller('opus-5-5', 'high'), 'ask'],
  ['a cheaper model at max effort', launch(undefined, { model: 'haiku', effort: 'max' }), caller('opus-5-5', 'high'), 'max'],
  ['an agent file at max effort', launch('reviewer'), caller('opus-5-5', 'high'), 'max', { files: { 'repo/.claude/agents/reviewer.md': definition('reviewer', 'haiku', 'max') } }],
  ['a CLAUDE_CODE_EFFORT_LEVEL of max', launch(undefined, { model: 'haiku' }), caller('opus-5-5', 'high'), 'max', { environment: { CLAUDE_CODE_EFFORT_LEVEL: 'max' } }],
  ['a lower family with no effort under a max-effort caller may serve max', launch(undefined, { model: 'haiku' }), caller('opus-5-5', 'max'), 'max'],
  ['a lower family with its effort set under a max-effort caller', launch(undefined, { model: 'haiku', effort: 'high' }), caller('opus-5-5', 'max'), 'pass'],
  ['an unknown target', launch('some-plugin:reviewer'), caller('opus-5-5', 'high'), 'unknown'],
  ['a model the ladder does not list', launch(undefined, { model: 'gpt-6' }), caller('opus-5-5', 'high'), 'unknown'],
  ['no caller route yet', launch(undefined, { model: 'opus' }), [typed('agent-cost-control')], 'unknown'],
  ['no transcript file', launch(undefined, { model: 'haiku' }), null, 'unknown'],
  ['tool_input that is not an object', 'not an object', caller('opus-5-5', 'high'), 'unknown'],
  ['the hook effort field names the caller effort', launch(undefined, { model: 'opus', effort: 'high' }), caller('opus-5-5', 'high'), 'pass', { effort: 'xhigh' }],
];

test('each cost-table row gives its expected result', t => {
  for (const [name, input, entries, expected, options = {}] of COSTS) {
    const scratch = new Scratch();
    try {
      for (const [file, text] of Object.entries(options.files || {})) scratch.write(file, text);
      if (entries) scratch.entries(entries);
      const event = { ...scratch.input(input), ...(options.effort ? { effort: { level: options.effort } } : {}) };
      const output = costDecision(event, { environment: scratch.environment(options.environment), managedAgentsDirectory: scratch.managed });
      if (expected === 'pass') { assert.deepEqual(output, {}, name); continue; }
      assert.equal(output.hookSpecificOutput.hookEventName, 'PreToolUse', name);
      if (expected === 'skill') { assert.equal(decisionOf(output), 'deny', name); assert.equal(reason(output), SKILL_REASON, name); continue; }
      assert.equal(decisionOf(output), 'ask', name);
      if (expected === 'ask') assert.match(reason(output), ASK, name);
      if (expected === 'max') assert.match(reason(output), MAX, name);
      if (expected === 'unknown') assert.equal(reason(output), COULD_NOT_CHECK, name);
    } finally { scratch.remove(); }
  }
  t.diagnostic(`${COSTS.length} cases`);
});

test('the prompt names both routes in plain words and never echoes odd caller text', () => {
  const scratch = new Scratch();
  try {
    scratch.entries(caller('sonnet-5-5', 'medium'));
    assert.equal(reason(costDecision(scratch.input(launch('general-purpose', { model: 'opus' })), { environment: scratch.environment(), managedAgentsDirectory: scratch.managed })),
      "Toolkit: this general-purpose would run on opus-5.5 at its default effort, not cheaper than this agent's sonnet-5.5/medium. Allow only if the cost is worth it; otherwise deny and the agent retries on a cheaper model.");
    const odd = 'x'.repeat(81);
    scratch.write('repo/.claude/agents/long.md', definition(odd, 'opus'));
    assert.match(reason(costDecision(scratch.input(launch(odd)), { environment: scratch.environment(), managedAgentsDirectory: scratch.managed })), /^Toolkit: this agent would run on/);
  } finally { scratch.remove(); }
});

test('the agent hook: asks outside gate runs, refuses in gate runs, one layer for subagents', () => {
  const scratch = new Scratch();
  const control = path.join(scratch.base, 'control');
  fs.mkdirSync(control);
  try {
    // A Toolkit helper exactly as setup renders it, written before any transcript so it is not
    // newer than the session.
    const { ClaudeHelperAgentRenderer } = require('../scripts/toolkit-claude-helper-agents.cjs');
    const rendered = ClaudeHelperAgentRenderer.fromRepository('owner-claude').render('G1');
    scratch.write(`config/agents/${rendered.file}`, rendered.text);
    const call = (input, extra = {}) => hook.decision({ ...scratch.input(launch('general-purpose')), ...input }, { environment: { ...scratch.environment(), AI_AGENT_TOOLKIT_CONTROL_ROOT: control, ...extra }, root: control, agent_route: { managedAgentsDirectory: scratch.managed },
      helper_policy: { managedAgentsDirectory: scratch.managed } });
    scratch.entries(caller('opus-5-5', 'high'));
    assert.equal(decisionOf(call({})), 'ask', 'the 23 Nov shape asks');
    assert.equal(decisionOf(call({ tool_name: 'Task' })), 'ask', 'Task too');
    assert.deepEqual(call({ tool_input: launch('Explore', { model: 'haiku' }) }), {});
    assert.deepEqual(call({ tool_name: 'Read' }), {}, 'other tools are untouched');
    assert.match(reason(call({ agent_id: 'sub-1', tool_input: launch('general-purpose', { model: 'haiku' }) })), /one layer only/, 'a subagent caller keeps one layer');
    // A gate run: the same cost test against the lead, but anything not cheaper is refused, never asked.
    scratch.entries([{ type: 'user', message: { role: 'user', content: 'Gate: G1\nRoute: owner-claude BUILDER opus-5.5/high\n\nBuild it.' } }, said('claude-opus-5-5', 'high')]);
    const gate = { TOOLKIT_GATE_ROLE: 'G1' };
    for (const cheaper of [launch('Explore', { model: 'haiku' }), launch('Explore', { model: 'haiku', effort: 'xhigh' }), launch('general-purpose', { model: 'sonnet', effort: 'xhigh' }), launch(undefined, { model: 'opus', effort: 'medium' })]) {
      assert.deepEqual(call({ tool_input: cheaper }, gate), {}, JSON.stringify(cheaper));
    }
    for (const off of [launch('Explore'), launch('general-purpose'), launch(undefined, { model: 'opus', effort: 'high' }), launch(undefined, { model: 'haiku', effort: 'max' }), launch('fork'), launch('some-plugin:reviewer')]) {
      assert.equal(decisionOf(call({ tool_input: off }, gate)), 'deny', JSON.stringify(off));
    }
    assert.equal(reason(call({ tool_input: launch('general-purpose') }, gate)), route.GATE_NOT_CHEAPER_REASON('general-purpose', 'opus-5.5/high', 'opus-5.5/high'));
    assert.match(reason(call({ tool_input: launch(undefined, { model: 'haiku', effort: 'max' }) }, gate)), /no helper runs at max effort/);
    assert.equal(decisionOf(call({ tool_input: launch('Explore', { model: 'haiku', effort: 'low' }) }, { ...gate, CLAUDE_CODE_EFFORT_LEVEL: 'max' })), 'deny', 'an effort override at max is refused');
    assert.match(reason(call({ agent_id: 'h1', tool_input: launch('Explore', { model: 'haiku', effort: 'xhigh' }) }, gate)), /a helper cannot launch another agent/);
    // The Toolkit preset passes its file check and then the same cost test: it runs under an Opus
    // high lead, and is refused under a lead already on its route or at max effort.
    assert.deepEqual(call({ tool_input: launch('toolkit-g1-helper') }, gate), {});
    scratch.entries([{ type: 'user', message: { role: 'user', content: 'Gate: G1\nRoute: owner-claude BUILDER opus-5.5/high\n\nBuild it.' } }, said('claude-haiku-5-5', 'xhigh')]);
    assert.equal(reason(call({ tool_input: launch('toolkit-g1-helper') }, gate)), route.GATE_NOT_CHEAPER_REASON('toolkit-g1-helper', 'haiku-5.5/xhigh', 'haiku-5.5/xhigh'));
    scratch.entries([{ type: 'user', message: { role: 'user', content: 'Gate: G1\nRoute: owner-claude BUILDER opus-5.5/high\n\nBuild it.' } }, said('claude-opus-5-5', 'max')]);
    assert.match(reason(call({ tool_input: launch(undefined, { model: 'haiku' }) }, gate)), /no helper runs at max effort/, 'an unset effort under a max lead counts as max');
    assert.deepEqual(call({ tool_input: launch(undefined, { model: 'haiku', effort: 'high' }) }, gate), {});
    assert.match(reason(call({ tool_input: launch('Explore', { model: 'haiku', effort: 'xhigh' }) }, { TOOLKIT_GATE_ROLE: 'G2' })), /G2 review sessions launch no helpers/);
    // Without a readable transcript the lead's route is not known, so the launch is refused.
    fs.rmSync(scratch.transcript);
    assert.match(reason(call({ tool_input: launch('Explore', { model: 'haiku', effort: 'xhigh' }) }, gate)), /cannot be told/);
  } finally { scratch.remove(); }
});

test('the transcript tail reader: last served route, skill since compaction, partial first line', () => {
  const scratch = new Scratch();
  try {
    scratch.entries([said('claude-sonnet-5-5', 'low'), SKILL, { ...said('claude-haiku-5-5', 'xhigh'), isSidechain: true }, said('claude-opus-5-5', 'high'), { type: 'assistant', message: { model: '<synthetic>' } }]);
    const read = tail.readTail(scratch.transcript, 1 << 20);
    assert.equal(read.complete, true);
    assert.deepEqual(tail.servedRoute(read.entries), { model: 'claude-opus-5-5', effort: 'high' });
    assert.equal(tail.skillLoadedSinceCompaction(read, 'agent-cost-control'), true);
    assert.equal(tail.skillLoadedSinceCompaction(read, 'cost-control'), false, 'a name is matched whole');
    // A slice that starts mid-file drops its partial first line, and a skill read past the slice counts as not read.
    const padding = { type: 'user', message: { role: 'user', content: 'x'.repeat(4000) } };
    scratch.entries([SKILL, padding, said('claude-opus-5-5', 'high')]);
    const short = tail.readTail(scratch.transcript, 2000);
    assert.equal(short.complete, false);
    assert.deepEqual(short.entries.map(entry => entry.type), ['assistant']);
    assert.equal(tail.skillLoadedSinceCompaction(short, 'agent-cost-control'), false);
    assert.equal(tail.readTail(path.join(scratch.base, 'missing.jsonl'), 100), null);
    assert.equal(tail.skillLoadedSinceCompaction(null, 'agent-cost-control'), false);
  } finally { scratch.remove(); }
});

test('the front-matter reader reads only plain name, model and effort lines', () => {
  assert.deepEqual(readFrontMatter(definition('a', 'haiku', 'xhigh')), { name: 'a', model: 'haiku', effort: 'xhigh' });
  assert.deepEqual(readFrontMatter(definition('a')), { name: 'a', model: null, effort: null });
  assert.deepEqual(readFrontMatter(definition('a', '')), { name: 'a', model: null, effort: null });
  assert.deepEqual(readFrontMatter(definition('a', '~')), { name: 'a', model: null, effort: null });
  assert.deepEqual(readFrontMatter(definition('a', 'claude-opus-5-5[1m]')), { name: 'a', model: 'claude-opus-5-5[1m]', effort: null });
  assert.deepEqual(readFrontMatter(definition('a', '"inherit"')), { name: 'a', model: 'inherit', effort: null });
  assert.deepEqual(readFrontMatter(definition('\'a\' # note', '"haiku" # pinned')), { name: 'a', model: 'haiku', effort: null });
  assert.deepEqual(readFrontMatter(definition('a', 'haiku').replace(/\n/g, '\r\n')), { name: 'a', model: 'haiku', effort: null }, 'CRLF');
  assert.deepEqual(readFrontMatter(`${BOM}${definition('a', 'haiku')}`), { name: 'a', model: 'haiku', effort: null }, 'leading byte order mark');
  assert.deepEqual(readFrontMatter(definition('a', 'haiku', undefined, 'tools:\n  model: inherit\n')), { name: 'a', model: 'haiku', effort: null }, 'a nested key is not the model');
  for (const [why, text] of [
    ['no front matter', 'name: a\nmodel: haiku\n'],
    ['unclosed front matter', '---\nname: a\nmodel: haiku\n'],
    ['no name', definition('', 'haiku')],
    ['a repeated model', definition('a', 'inherit', undefined, 'model: haiku\n')],
    ['a repeated effort', definition('a', 'haiku', 'low', 'effort: max\n')],
    ['a repeated name', definition('a', 'haiku', undefined, 'name: b\n')],
    ['a flow sequence', definition('a', '[haiku]')],
    ['a block scalar', definition('a', '|')],
    ['a value that continues on the next line', definition('a', '', undefined, '  haiku\n')],
    ['an anchor', definition('a', '&m haiku')],
    ['an unclosed quote', definition('a', '"haiku')],
    ['a lone carriage return', definition('a', 'inherit\rmodel: haiku')],
    ['a quoted model key', '---\nname: a\n"model": opus\neffort: low\n---\n'],
    ['a single-quoted effort key', '---\nname: a\nmodel: haiku\n\'effort\': low\n---\n'],
    ['a model key with no space after the colon', '---\nname: a\nmodel:haiku\n---\n'],
    ['not text', null],
  ]) assert.equal(readFrontMatter(text), null, why);
});

test('hostile YAML shapes never turn model inherit into a pinned model, and reading stays linear', () => {
  // A shape hides a second `model: haiku` line after the real `model: inherit`: the reader must
  // read it as inherit or not at all, never as pinned.
  const pinned = text => { const read = readFrontMatter(text); return Boolean(read && read.model && read.model.toLowerCase() !== 'inherit'); };
  const yaml = hostile.cases(hostile.FAMILIES, ['yaml']).filter(shape => shape.place !== 'name');
  const list = yaml.map(shape => ({ ...shape, text: `---\nname: probe\nmodel: inherit\n${shape.text.split('continue-on-error: true').join('model: haiku')}\n---\n` }));
  hostile.expectDefaultDeny(assert, pinned, list);
  for (const variant of hostile.variants(definition('probe', 'inherit', undefined, 'model: haiku\n'))) assert.equal(pinned(variant.text), false, variant.id);
  const timing = hostile.timing(readFrontMatter, size => `---\nname: probe\n${'description: word word word\n'.repeat(Math.ceil(size / 28))}model: haiku\n---\n`);
  assert.ok(timing.ok, timing.message);
});
