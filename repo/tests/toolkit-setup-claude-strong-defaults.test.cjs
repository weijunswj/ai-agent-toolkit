'use strict';

// Claude Code setup asks one approval question over strong-default rows: a yes applies each Toolkit default
// not set yet and records it, an off the owner chose is kept off, and a reply that lists only changes leaves
// every other row as it is. The answers run through the real answer path and the real settings owners, in
// a temporary Claude config folder.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const core = require('../scripts/setup-toolkit-core.cjs');
const { ClaudeUserSettings, STATES } = require('../scripts/toolkit-claude-user-settings.cjs');
const { ClaudeSubagentDepthSetting, STATES: DEPTH_STATES } = require('../scripts/toolkit-claude-subagent-depth.cjs');

const ENV_KEYS = ['CLAUDE_CONFIG_DIR', 'AI_AGENT_TOOLKIT_CONTROL_ROOT', 'CLAUDE_CODE_EXECPATH'];
const NEW_ID = 'cc-plugin-agents-md@builtin';
const OLD_ID = 'agents-md@builtin';

// A temporary Claude config folder and Toolkit control folder, used by the real settings owners through the
// same environment variables a real run reads; the Claude Code binary path names its version folder.
function claudeHome(t, version = '2.1.330') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-strong-defaults-'));
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.CLAUDE_CONFIG_DIR = path.join(root, '.claude');
  process.env.AI_AGENT_TOOLKIT_CONTROL_ROOT = path.join(root, 'control');
  process.env.CLAUDE_CODE_EXECPATH = path.join(root, 'claude-code', version, 'build', 'claude.exe');
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    fs.rmSync(root, { recursive: true, force: true });
  });
  const settingsPath = path.join(root, '.claude', 'settings.json');
  return { root, read: () => (fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, 'utf8')) : {}) };
}

// The computer as setup reads it: Toolkit installed and current, reports and retention at their defaults,
// and the Claude Code settings and subagent limit read from the temporary folder.
function currentState() {
  const base = core.documentationFixtureState();
  return {
    ...base,
    antigravity: { installed: false, copies: false },
    agentProfile: { supported: true, topology: 'root-only' },
    claudeSubagentDepth: new ClaudeSubagentDepthSetting().inspect(),
    claudeSettings: new ClaudeUserSettings().inspect(),
    claudePluginInstall: { installed: true, enabled: true, recordCurrent: true, version: '1.0.0', runningRoot: base.managed.currentPath },
    nativePlugin: { status: 'fresh', manifest_version: '1.0.0' },
  };
}

// One setup or refresh run in a terminal, answered with `replies` in order; a further prompt stops the run.
async function answer(replies, { refresh = false } = {}) {
  const args = core.parseArgs(['--execute', '--profile', 'auto-main', '--host', 'claude-code', ...(refresh ? ['--refresh'] : [])]);
  const prompts = [];
  let written = '';
  const log = console.log;
  console.log = () => {};
  try {
    const result = await core.answerSetupQuestionBank(args, currentState(), {
      isTTY: true,
      write(text) { written += text; return true; },
      createReadlineInterface: () => ({
        async question(prompt) {
          prompts.push(prompt);
          if (prompts.length > replies.length) throw new Error('Setup question bank requires an answer (test stop)');
          return replies[prompts.length - 1];
        },
        close() {},
      }),
    });
    return { args, result, written, prompts };
  } finally {
    console.log = log;
  }
}

// The Claude Code writes a run makes after its answers, in setup's own order.
function applyAnswers(args) {
  core.applyClaudeSubagentDepth(args);
  return core.applyClaudeUserSettings(args);
}

const agentsMd = (settings, id = NEW_ID) => settings.pluginConfigs?.[id]?.options?.instructionFiles;
const stateOf = (id) => new ClaudeUserSettings().inspect().find((entry) => entry.id === id).state;

test('a fresh Claude Code shows one question, and yes writes and records every Toolkit default', async (t) => {
  const home = claudeHome(t);
  const run = await answer(['yes']);
  assert.match(run.written, /1 question: Apply these defaults\?/);
  assert.doesNotMatch(run.written, /\d+ questions across/);
  assert.equal(run.prompts.length, 1, 'one prompt');
  assert.equal(run.result.answer_source, 'user-approved defaults');
  applyAnswers(run.args);
  const settings = home.read();
  assert.equal(settings.attribution, false);
  assert.equal(settings.crossSessionInbound, 'accept');
  assert.equal(agentsMd(settings), 'claude-md-and-agents-md');
  assert.equal(settings.env?.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH, '1');
  for (const id of ['attribution', 'cross-session-inbound', 'agents-md']) assert.equal(stateOf(id), STATES.TOOLKIT, `${id} is recorded as Toolkit's value`);
  assert.equal(new ClaudeSubagentDepthSetting().inspect().state, DEPTH_STATES.TOOLKIT);
});

test('the AGENTS.md setting goes where the running Claude Code reads it, and nowhere on a version without it', (t) => {
  const older = claudeHome(t, '2.1.280');
  new ClaudeUserSettings().apply({ 'agents-md': 'enable' });
  assert.equal(agentsMd(older.read(), OLD_ID), 'claude-md-and-agents-md');
  assert.equal(agentsMd(older.read(), NEW_ID), undefined);

  const oldest = claudeHome(t, '2.1.270');
  const [result] = new ClaudeUserSettings().apply({ 'agents-md': 'enable' }).filter((entry) => entry.id === 'agents-md');
  assert.equal(result.status, 'held');
  assert.equal(result.state, STATES.UNSUPPORTED);
  assert.match(result.detail, /Claude Code 2\.1\.270 has no AGENTS\.md setting \(it needs 2\.1\.277 or later\)/);
  assert.deepEqual(oldest.read(), {});
});

test('an off the owner chose stays off: a later setup keeps it and a refresh asks nothing', async (t) => {
  const home = claudeHome(t);
  applyAnswers((await answer(['yes, 3.5=off'])).args);
  assert.equal(agentsMd(home.read()), undefined);
  assert.equal(stateOf('agents-md'), STATES.OWNER_OFF);

  const refresh = await answer([], { refresh: true });
  assert.equal(refresh.prompts.length, 0, 'refresh asks nothing');
  assert.equal(refresh.result.refresh, 'kept-current');
  applyAnswers(refresh.args);
  assert.equal(agentsMd(home.read()), undefined, 'refresh leaves it off');

  const again = await answer(['yes']);
  assert.match(again.written, /3\.5 Claude Code setting: Read AGENTS\.md too\?\n  Current: Off \(you turned it off\)\n  Setup applies: A\. Keep current\n/);
  applyAnswers(again.args);
  assert.equal(agentsMd(home.read()), undefined, 'a later yes leaves it off');
  assert.equal(stateOf('agents-md'), STATES.OWNER_OFF);
});

test('a reply that lists only one change leaves every other row as it is', async (t) => {
  const home = claudeHome(t);
  const run = await answer(['3.2=B']);
  assert.equal(run.result.answer_source, 'user-approved listed changes only');
  applyAnswers(run.args);
  const settings = home.read();
  assert.equal(settings.attribution, false, 'the listed row changes');
  assert.equal(Object.hasOwn(settings, 'crossSessionInbound'), false);
  assert.equal(agentsMd(settings), undefined);
  assert.equal(settings.env?.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH, undefined);
});

test('no changes nothing, and a refresh with a row still unset asks the one question', async (t) => {
  const home = claudeHome(t);
  const declined = await answer(['no']);
  assert.equal(declined.result.declined, true);
  assert.deepEqual(home.read(), {});
  const empty = await answer(['', '']).catch((error) => ({ error }));
  assert.match(String(empty.error?.message), /requires an answer: enter yes, no, or changes/, 'an empty reply is not a yes and is not asked forever');
  const refresh = await answer([], { refresh: true }).catch((error) => ({ error }));
  assert.match(String(refresh.error?.message), /Setup question bank requires an answer/);
});

test('the setup skill keeps the bank relay rule as its own short rule', () => {
  const skill = fs.readFileSync(path.join(__dirname, '..', '..', 'skills', 'toolkit-setup', 'SKILL.md'), 'utf8');
  const section = skill.split(/^## /m).find((part) => part.startsWith('Relay the question bank\n'));
  assert.ok(section, 'the skill has a "Relay the question bank" section');
  const rule = section.split('\n').find((line) => line.startsWith('Relay rule:'));
  assert.ok(rule, 'the section holds the rule sentence');
  for (const phrase of ['one table per section', 'Other choices', 'no buttons']) assert.ok(rule.includes(phrase), `the rule says ${phrase}`);
  assert.ok(skill.indexOf('## Relay the question bank') < skill.indexOf('## Required Route'), 'the rule sits near the top');
  assert.doesNotMatch(skill, /emit the complete compact bank \(one table per section\)/, 'the old mid-paragraph copy is a pointer now');
});

test('the Codex questions are unchanged: the generated Codex reference and the Codex fixture bank match their pinned bytes', () => {
  const crypto = require('node:crypto');
  const digest = (text) => crypto.createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
  const codexPart = (text) => text.slice(0, text.indexOf('# Claude Code setup questions'));
  const checkedIn = fs.readFileSync(path.join(__dirname, '..', 'docs', 'SETUP-QUESTIONS.generated.md'), 'utf8');
  assert.equal(digest(codexPart(checkedIn)), '8350d49eaeef3c76637fdc4c4fdca3cadb8466071cc7ce584e8ed0f1e22287ef');
  assert.equal(digest(codexPart(core.renderSetupQuestionDocumentation())), '8350d49eaeef3c76637fdc4c4fdca3cadb8466071cc7ce584e8ed0f1e22287ef');
  assert.equal(digest(core.renderSetupQuestionBank(core.setupQuestionDocumentationSpecs())), 'b603ee9b96ab5117ab9a4ba32e17d52c91b5add9bf9c81b35f746e3eda78dc6d');
});
