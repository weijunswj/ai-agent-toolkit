'use strict';
require('./toolkit-test-temp-guard.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { inheritedModelDecision, readFrontMatter, INHERITED_REASON, FORK_REASON } = require('../scripts/toolkit-claude-inherited-model.cjs');
const hook = require('../scripts/toolkit-claude-agent-hook.cjs');
const hostile = require('./support/hostile-inputs.cjs');

const definition = (name, model, extra = '') => `---\nname: ${name}\ndescription: Test agent.\n${model === undefined ? '' : `model: ${model}\n`}${extra}---\n\nReply OK.\n`;

// A scratch folder with a git repository (and a nested working folder), a Claude config folder
// and a managed agents folder. Nothing outside `base`.
class Scratch {
  constructor() {
    this.base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-inherited-model-')));
    this.repo = path.join(this.base, 'repo');
    this.nested = path.join(this.repo, 'packages', 'app');
    this.config = path.join(this.base, 'config');
    this.managed = path.join(this.base, 'managed', '.claude', 'agents');
    fs.mkdirSync(path.join(this.repo, '.git'), { recursive: true });
    fs.mkdirSync(this.nested, { recursive: true });
  }
  write(relative, text) { const file = path.join(this.base, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
  decide(tool_input, { environment = {}, cwd = this.repo } = {}) {
    return inheritedModelDecision({ tool_name: 'Agent', cwd, tool_input }, { environment: { CLAUDE_CONFIG_DIR: this.config, ...environment }, managedAgentsDirectory: this.managed });
  }
  remove() { fs.rmSync(this.base, { recursive: true, force: true }); }
}

const reason = output => output?.hookSpecificOutput?.permissionDecisionReason || null;
const launch = (subagent_type, extra = {}) => ({ ...(subagent_type === undefined ? {} : { subagent_type }), description: 'test', prompt: 'Reply OK', ...extra });
const FORCED = { CLAUDE_CODE_SUBAGENT_MODEL: 'haiku', CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1' };

// [case, tool_input, expected ('pass', 'inherited' or 'fork'), options]; options: environment,
// files ({ path under base: text }), cwd (scratch => folder). One row per decision-table row.
const CASES = [
  ['1 tool_input is not an object', 'not an object', 'pass'],
  ['1 tool_input is an array', [], 'pass'],
  ['2 fork with no model', launch('fork'), 'fork'],
  ['2 fork with a model', launch('fork', { model: 'haiku' }), 'fork'],
  ['2 fork with the model variable forced', launch('fork'), 'fork', { environment: FORCED }],
  ['3 general-purpose with model haiku', launch('general-purpose', { model: 'haiku' }), 'pass'],
  ['3 an explicit opus is the caller\'s choice', launch('general-purpose', { model: 'opus' }), 'pass'],
  ['3 Explore with model haiku', launch('Explore', { model: 'haiku' }), 'pass'],
  ['3 a definition with model inherit, with a model on the call', launch('reviewer', { model: 'sonnet' }), 'pass', { files: { 'repo/.claude/agents/reviewer.md': definition('reviewer', 'inherit') } }],
  ['3 an empty model counts as none', launch('general-purpose', { model: '  ' }), 'inherited'],
  ['3 model inherit on the call counts as none', launch('general-purpose', { model: 'inherit' }), 'inherited'],
  ['3 a model that is not a string counts as none', launch('general-purpose', { model: 7 }), 'inherited'],
  ['4 Explore with the model variable forced', launch('Explore'), 'pass', { environment: FORCED }],
  ['4 force switched off keeps the refusal', launch('Explore'), 'inherited', { environment: { CLAUDE_CODE_SUBAGENT_MODEL: 'haiku', CLAUDE_CODE_SUBAGENT_MODEL_FORCE: 'false' } }],
  ['4 force without a model variable keeps the refusal', launch('general-purpose'), 'inherited', { environment: { CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1' } }],
  ['5 toolkit-g0-helper', launch('toolkit-g0-helper'), 'pass'],
  ['5 toolkit-g1-helper', launch('toolkit-g1-helper'), 'pass'],
  ['5 an inherited object key is not a helper', launch('constructor'), 'pass'],
  ['6 project definition pins a model, found by name not file name', launch('general-purpose'), 'pass', { files: { 'repo/.claude/agents/other.md': definition('general-purpose', 'haiku') } }],
  ['6 project definition with model inherit', launch('reviewer'), 'inherited', { files: { 'repo/.claude/agents/reviewer.md': definition('reviewer', 'inherit') } }],
  ['6 project definition with no model', launch('reviewer'), 'inherited', { files: { 'repo/.claude/agents/reviewer.md': definition('reviewer') } }],
  ['6 project definition with no model and the model variable', launch('Plan'), 'pass',
    { environment: { CLAUDE_CODE_SUBAGENT_MODEL: 'haiku' }, files: { 'repo/.claude/agents/plan.md': definition('Plan') } }],
  ['6 project definition with model inherit and the model variable', launch('reviewer'), 'inherited',
    { environment: { CLAUDE_CODE_SUBAGENT_MODEL: 'haiku' }, files: { 'repo/.claude/agents/reviewer.md': definition('reviewer', 'inherit') } }],
  ['6 project definition with a quoted model and a comment', launch('reviewer'), 'pass', { files: { 'repo/.claude/agents/reviewer.md': definition('"reviewer"', '\'claude-haiku-5-5\' # pinned') } }],
  ['6 project definition with a quoted inherit and a comment', launch('reviewer'), 'inherited', { files: { 'repo/.claude/agents/reviewer.md': definition('"reviewer"', '\'inherit\' # parent') } }],
  ['6 project definition with an unquoted inherit and a comment', launch('reviewer'), 'inherited', { files: { 'repo/.claude/agents/reviewer.md': definition('reviewer', 'inherit # parent') } }],
  ['6 user definition with model inherit', launch('helper-x'), 'inherited', { files: { 'config/agents/helper-x.md': definition('helper-x', 'inherit') } }],
  ['6 user definition pins a model', launch('claude'), 'pass', { files: { 'config/agents/helper-x.md': definition('claude', 'sonnet') } }],
  ['6 managed definition outranks a project one', launch('reviewer'), 'inherited',
    { files: { 'managed/.claude/agents/reviewer.md': definition('reviewer', 'inherit'), 'repo/.claude/agents/reviewer.md': definition('reviewer', 'haiku') } }],
  ['6 project definition outranks a user one', launch('reviewer'), 'inherited',
    { files: { 'repo/.claude/agents/reviewer.md': definition('reviewer'), 'config/agents/reviewer.md': definition('reviewer', 'sonnet') } }],
  ['6 the closest project folder wins', launch('reviewer'), 'pass',
    { cwd: s => s.nested, files: { 'repo/packages/app/.claude/agents/reviewer.md': definition('reviewer', 'haiku'), 'repo/.claude/agents/reviewer.md': definition('reviewer', 'inherit') } }],
  ['6 the git root folder is read from a nested working folder', launch('reviewer'), 'inherited',
    { cwd: s => s.nested, files: { 'repo/.claude/agents/reviewer.md': definition('reviewer', 'inherit') } }],
  ['6 a folder above the git root is not read', launch('reviewer'), 'pass', { files: { '.claude/agents/reviewer.md': definition('reviewer', 'inherit') } }],
  ['6 a user definition named Explore that pins a model overrides the built-in', launch('Explore'), 'pass', { files: { 'config/agents/explore.md': definition('Explore', 'haiku') } }],
  ['6 a user definition named claude-code-guide with model inherit', launch('claude-code-guide'), 'inherited', { files: { 'config/agents/guide.md': definition('claude-code-guide', 'inherit') } }],
  ['6 an unreadable definition counts as not found', launch('reviewer'), 'pass', { files: { 'repo/.claude/agents/reviewer.md': definition('reviewer', '[inherit]') } }],
  ['7 general-purpose with no model', launch('general-purpose'), 'inherited'],
  ['7 no subagent_type', launch(undefined), 'inherited'],
  ['7 an empty subagent_type', launch(''), 'inherited'],
  ['7 a null subagent_type', launch(null), 'inherited'],
  ['7 claude with no model', launch('claude'), 'inherited'],
  ['7 general-purpose with the model variable', launch('general-purpose'), 'pass', { environment: { CLAUDE_CODE_SUBAGENT_MODEL: 'haiku' } }],
  ['7 default agent with the model variable', launch(undefined), 'pass', { environment: { CLAUDE_CODE_SUBAGENT_MODEL: 'haiku' } }],
  ['8 Explore with no model', launch('Explore'), 'inherited'],
  ['8 Plan with no model', launch('Plan'), 'inherited'],
  ['8 Explore with only the model variable', launch('Explore'), 'inherited', { environment: { CLAUDE_CODE_SUBAGENT_MODEL: 'haiku' } }],
  ['8 Plan with only the model variable', launch('Plan'), 'inherited', { environment: { CLAUDE_CODE_SUBAGENT_MODEL: 'haiku' } }],
  ['9 claude-code-guide', launch('claude-code-guide'), 'pass'],
  ['9 statusline-setup', launch('statusline-setup'), 'pass'],
  ['9 web-fetch', launch('web-fetch'), 'pass'],
  ['6b installed plugin copy with model inherit', launch('review-kit:code-reviewer'), 'inherited', { files: { 'config/plugins/cache/m/review-kit/1.0.0/agents/code-reviewer.md': definition('code-reviewer', 'inherit') } }],
  ['6b marketplace plugin copy with model inherit', launch('review-kit:code-reviewer'), 'inherited', { files: { 'config/plugins/marketplaces/m/plugins/review-kit/agents/code-reviewer.md': definition('code-reviewer', 'inherit') } }],
  ['6b marketplace plugin copy with no model', launch('review-kit:code-reviewer'), 'inherited', { files: { 'config/plugins/marketplaces/m/plugins/review-kit/agents/code-reviewer.md': definition('code-reviewer') } }],
  ['6b plugin copy pins a model', launch('review-kit:code-reviewer'), 'pass', { files: { 'config/plugins/marketplaces/m/plugins/review-kit/agents/code-reviewer.md': definition('code-reviewer', 'sonnet') } }],
  ['6b the last installed version folder in name order is read first', launch('review-kit:code-reviewer'), 'pass',
    { files: { 'config/plugins/cache/m/review-kit/1.0.0/agents/code-reviewer.md': definition('code-reviewer', 'inherit'), 'config/plugins/cache/m/review-kit/2.0.0/agents/code-reviewer.md': definition('code-reviewer', 'sonnet') } }],
  ['6b installed copy outranks the marketplace copy', launch('review-kit:code-reviewer'), 'pass',
    { files: { 'config/plugins/cache/m/review-kit/1.0.0/agents/code-reviewer.md': definition('code-reviewer', 'sonnet'), 'config/plugins/marketplaces/m/plugins/review-kit/agents/code-reviewer.md': definition('code-reviewer', 'inherit') } }],
  ['6b a nested plugin agent reads its subfolder', launch('review-kit:deep:code-reviewer'), 'inherited', { files: { 'config/plugins/marketplaces/m/plugins/review-kit/agents/deep/code-reviewer.md': definition('code-reviewer', 'inherit') } }],
  ['6b a top-level name does not read a subfolder', launch('review-kit:code-reviewer'), 'pass', { files: { 'config/plugins/marketplaces/m/plugins/review-kit/agents/deep/code-reviewer.md': definition('code-reviewer', 'inherit') } }],
  ['6b a plugin name that climbs folders is not looked up', launch('..:code-reviewer'), 'pass', { files: { 'config/plugins/marketplaces/m/plugins/review-kit/agents/code-reviewer.md': definition('code-reviewer', 'inherit') } }],
  ['6b a plugin agent is never read from the project folder', launch('review-kit:code-reviewer'), 'pass', { files: { 'repo/.claude/agents/code-reviewer.md': definition('review-kit:code-reviewer', 'inherit') } }],
  ['10 a plugin agent with no copy on disk (accepted gap)', launch('some-plugin:reviewer'), 'pass'],
  ['10 an unknown name', launch('reviewer'), 'pass'],
  ['10 a subagent_type that is not a string', launch(42), 'pass'],
];

test('each decision-table row gives its expected result', t => {
  for (const [name, input, expected, options = {}] of CASES) {
    const scratch = new Scratch();
    try {
      for (const [file, text] of Object.entries(options.files || {})) scratch.write(file, text);
      const output = scratch.decide(input, { environment: options.environment, cwd: options.cwd ? options.cwd(scratch) : scratch.repo });
      if (expected === 'pass') assert.deepEqual(output, {}, name);
      else {
        assert.equal(output.hookSpecificOutput?.permissionDecision, 'deny', name);
        assert.equal(output.hookSpecificOutput.hookEventName, 'PreToolUse', name);
        if (expected === 'fork') assert.equal(reason(output), FORK_REASON, name);
        else assert.match(reason(output), /^Toolkit: this .+ launch names no model, so it would run on this session's model\./, name);
      }
    } finally { scratch.remove(); }
  }
  t.diagnostic(`${CASES.length} cases`);
});

test('the refusal names the cheaper routes and the requested agent, never raw caller text', () => {
  const scratch = new Scratch();
  try {
    const text = reason(scratch.decide(launch('general-purpose')));
    assert.equal(text, INHERITED_REASON('general-purpose'));
    for (const route of ['toolkit-g0-helper', 'toolkit-g1-helper', 'model: "haiku"', 'prefetch GitHub data first']) assert.ok(text.includes(route), route);
    assert.equal(reason(scratch.decide(launch(undefined))), INHERITED_REASON('default (general-purpose)'));
    assert.equal(reason(scratch.decide(launch('Explore'))), INHERITED_REASON('Explore'));
    // A name the refusal cannot show plainly is replaced, so caller text never reaches the reason.
    const odd = 'x'.repeat(81);
    scratch.write('repo/.claude/agents/long.md', definition(odd, 'inherit'));
    assert.equal(reason(scratch.decide(launch(odd))), INHERITED_REASON('agent'));
    assert.match(FORK_REASON, /toolkit-g0-helper or toolkit-g1-helper/);
  } finally { scratch.remove(); }
});

test('the agent hook runs the check only for a main-session launch outside a gate run', () => {
  const scratch = new Scratch();
  const control = path.join(scratch.base, 'control');
  fs.mkdirSync(control);
  try {
    const environment = { CLAUDE_CONFIG_DIR: scratch.config, AI_AGENT_TOOLKIT_CONTROL_ROOT: control };
    const call = (input, env = environment) => hook.decision({ tool_name: 'Agent', cwd: scratch.repo, ...input }, { environment: env, root: control, inherited_model: { managedAgentsDirectory: scratch.managed } });
    assert.equal(reason(call({ tool_input: launch('general-purpose') })), INHERITED_REASON('general-purpose'));
    assert.equal(reason(call({ tool_name: 'Task', tool_input: launch('general-purpose') })), INHERITED_REASON('general-purpose'));
    assert.deepEqual(call({ tool_input: launch('general-purpose', { model: 'haiku' }) }), {});
    assert.deepEqual(call({ tool_name: 'Read', tool_input: launch('general-purpose') }), {}, 'other tools are untouched');
    // A subagent caller keeps the one-layer refusal, never the model reason.
    assert.match(reason(call({ agent_id: 'sub-1', tool_input: launch('general-purpose', { model: 'haiku' }) })), /one layer only/);
    // In a gate run the named-helper policy decides, unchanged.
    assert.match(reason(call({ tool_input: launch('general-purpose', { model: 'haiku' }) }, { ...environment, TOOLKIT_GATE_ROLE: 'G1' })), /allows only the toolkit-g0-helper and toolkit-g1-helper agents/);
  } finally { scratch.remove(); }
});

test('the front-matter reader reads only plain name and model lines', () => {
  assert.deepEqual(readFrontMatter(definition('a', 'haiku')), { name: 'a', model: 'haiku' });
  assert.deepEqual(readFrontMatter(definition('a')), { name: 'a', model: null });
  assert.deepEqual(readFrontMatter(definition('a', '')), { name: 'a', model: null });
  assert.deepEqual(readFrontMatter(definition('a', '~')), { name: 'a', model: null });
  assert.deepEqual(readFrontMatter(definition('a', 'claude-opus-5-5[1m]')), { name: 'a', model: 'claude-opus-5-5[1m]' });
  assert.deepEqual(readFrontMatter(definition('a', '"inherit"')), { name: 'a', model: 'inherit' });
  assert.deepEqual(readFrontMatter(definition('\'a\' # note', '"haiku" # pinned')), { name: 'a', model: 'haiku' });
  assert.deepEqual(readFrontMatter(definition('a', 'haiku').replace(/\n/g, '\r\n')), { name: 'a', model: 'haiku' }, 'CRLF');
  assert.deepEqual(readFrontMatter(`\ufeff${definition('a', 'haiku')}`), { name: 'a', model: 'haiku' }, 'leading byte order mark');
  assert.deepEqual(readFrontMatter(definition('a', 'haiku', 'tools:\n  model: inherit\n')), { name: 'a', model: 'haiku' }, 'a nested key is not the model');
  for (const [why, text] of [
    ['no front matter', 'name: a\nmodel: haiku\n'],
    ['unclosed front matter', '---\nname: a\nmodel: haiku\n'],
    ['no name', definition('', 'haiku')],
    ['a repeated model', definition('a', 'inherit', 'model: haiku\n')],
    ['a repeated name', definition('a', 'haiku', 'name: b\n')],
    ['a flow sequence', definition('a', '[haiku]')],
    ['a block scalar', definition('a', '|')],
    ['a value that continues on the next line', definition('a', '', '  haiku\n')],
    ['an anchor', definition('a', '&m haiku')],
    ['an unclosed quote', definition('a', '"haiku')],
    ['a lone carriage return', definition('a', 'inherit\rmodel: haiku')],
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
  for (const variant of hostile.variants(definition('probe', 'inherit', 'model: haiku\n'))) assert.equal(pinned(variant.text), false, variant.id);
  const timing = hostile.timing(readFrontMatter, size => `---\nname: probe\n${'description: word word word\n'.repeat(Math.ceil(size / 28))}model: haiku\n---\n`);
  assert.ok(timing.ok, timing.message);
});
