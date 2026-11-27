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
const { ClaudeUserSettings, SETTINGS, STATES } = require('../scripts/toolkit-claude-user-settings.cjs');
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
function currentState({ profile = { supported: true, topology: 'root-only' } } = {}) {
  const base = core.documentationFixtureState();
  return {
    ...base,
    antigravity: { installed: false, copies: false },
    agentProfile: profile,
    claudeSubagentDepth: new ClaudeSubagentDepthSetting().inspect(),
    claudeSettings: new ClaudeUserSettings().inspect(),
    claudePluginInstall: { installed: true, enabled: true, recordCurrent: true, version: '1.0.0', runningRoot: base.managed.currentPath },
    nativePlugin: { status: 'fresh', manifest_version: '1.0.0' },
  };
}

// One setup or refresh run in a terminal, answered with `replies` in order; a further prompt stops the run.
async function answer(replies, { refresh = false, profile, flags = [] } = {}) {
  const args = core.parseArgs(['--execute', '--profile', 'auto-main', '--host', 'claude-code', ...(refresh ? ['--refresh'] : []), ...flags]);
  const prompts = [];
  let written = '';
  const log = console.log;
  console.log = () => {};
  try {
    const result = await core.answerSetupQuestionBank(args, currentState({ profile }), {
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
  assert.match(run.written, /1 question: Apply Toolkit's defaults to the 4 Claude Code settings that have no value yet\? Your own values and offs stay\./);
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
  assert.match(again.written, /3\.5 Claude Code setting: Read AGENTS\.md \(in all local repos\) too\?\n  Current: Off \(you turned it off\)\n  Setup applies: A\. Keep current\n/);
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

// One run with stdin piped in (not a terminal), in a child process so its stdin is real; returns what it printed
// and the settings it wrote. The child reads the same temporary folders through the environment.
function pipedRun(input) {
  const { spawnSync } = require('node:child_process');
  const code = [
    `const core = require(${JSON.stringify(require.resolve('../scripts/setup-toolkit-core.cjs'))});`,
    `const { ClaudeUserSettings } = require(${JSON.stringify(require.resolve('../scripts/toolkit-claude-user-settings.cjs'))});`,
    `const { ClaudeSubagentDepthSetting } = require(${JSON.stringify(require.resolve('../scripts/toolkit-claude-subagent-depth.cjs'))});`,
    'const base = core.documentationFixtureState();',
    "const current = { ...base, antigravity: { installed: false, copies: false }, agentProfile: { supported: true, topology: 'root-only' }, claudeSubagentDepth: new ClaudeSubagentDepthSetting().inspect(), claudeSettings: new ClaudeUserSettings().inspect(), claudePluginInstall: { installed: true, enabled: true, recordCurrent: true, version: '1.0.0', runningRoot: base.managed.currentPath }, nativePlugin: { status: 'fresh', manifest_version: '1.0.0' } };",
    "const args = core.parseArgs(['--execute', '--profile', 'auto-main', '--host', 'claude-code']);",
    "let written = '';",
    "core.answerSetupQuestionBank(args, current, { isTTY: false, write(text) { written += text; return true; } })",
    "  .then((result) => { core.applyClaudeSubagentDepth(args); core.applyClaudeUserSettings(args); process.stdout.write(JSON.stringify({ written, source: result.answer_source, asked: result.answers_initially_required, sent: result.answers_supplied_by_complete_stdin })); })",
    "  .catch((error) => { process.stdout.write(JSON.stringify({ error: error.message })); });",
  ].join('\n');
  const run = spawnSync(process.execPath, ['-e', code], { input, encoding: 'utf8', env: process.env, timeout: 60000 });
  return { stdout: run.stdout, ...JSON.parse(run.stdout.slice(run.stdout.lastIndexOf('{"'))) };
}

test('with every setting already set, setup asks nothing and keeps them; a piped change still applies', async (t) => {
  const home = claudeHome(t);
  applyAnswers((await answer(['yes'])).args);
  const before = home.read();
  const run = await answer([]);
  assert.equal(run.prompts.length, 0, 'no question in a terminal');
  assert.equal(run.result.answer_source, 'nothing to approve');
  assert.match(run.written, /Toolkit setup - no questions: every setting already has a value\n/);
  // Nothing reads a reply in the owner's own terminal, so it names the flag there.
  assert.match(run.written, /Every setting already has a value, so setup asks nothing and keeps them all as they are\. To change one, run setup again with its flag \(--help lists them\), or say setup toolkit in a chat and reply there\./);
  assert.doesNotMatch(run.written, /could not read|does not have|reply with its number/i);
  assert.deepEqual([run.result.answers_initially_required, run.result.answers_supplied_by_complete_stdin], [false, false], 'nothing was asked or sent');
  assert.doesNotMatch(run.written, /a yes changes nothing|Apply Toolkit's defaults|Reply yes to apply/);
  applyAnswers(run.args);
  assert.deepEqual(home.read(), before, 'nothing changed');

  const empty = pipedRun('');
  assert.equal(empty.error, undefined, 'an empty pipe keeps every row');
  assert.equal(empty.source, 'nothing to approve');
  assert.match(empty.written, /keeps them all as they are\. To change one, reply with its number and choice, for example 3\.5=B/);
  assert.deepEqual([empty.asked, empty.sent], [false, false], 'an empty pipe sent no answer');
  assert.deepEqual(home.read(), before);
  const reference = /Bank reference: (\S+)/.exec(empty.written)[1];
  const change = pipedRun(`${reference}: 3.5=off\n`);
  assert.equal(change.source, 'user-approved listed changes only');
  assert.deepEqual([change.asked, change.sent], [false, true]);
  assert.equal(agentsMd(home.read()), undefined, 'the piped change turned 3.5 off');
  assert.equal(stateOf('agents-md'), STATES.OWNER_OFF);
});

// A settings.json Toolkit cannot read (a comment, a trailing comma) leaves four rows with no value it knows.
const unreadable = (home) => fs.writeFileSync(path.join(home.root, '.claude', 'settings.json'), '{ "attribution": false, // my note');

test('a setting setup could not read is named and never counted as having a value, in setup and in refresh, and is not asked about', async (t) => {
  const home = claudeHome(t);
  applyAnswers((await answer(['yes'])).args);
  unreadable(home);
  const bytes = fs.readFileSync(path.join(home.root, '.claude', 'settings.json'), 'utf8');
  const run = await answer([]);
  assert.equal(run.prompts.length, 0, 'a yes would write nothing there, so nothing is asked');
  assert.equal(run.result.answer_source, 'nothing to approve');
  assert.match(run.written, /Toolkit setup - no questions: nothing to approve, and \d settings could not be read\n/);
  // The four setting rows and the agents row, whose subagent limit sits in the same file.
  assert.match(run.written, /No setting needs your approval, so setup asks nothing and keeps them all as they are\. Setup could not read 5 settings \(2\.1, 3\.2, 3\.3, 3\.4, 3\.5\), so it writes nothing there\./);
  assert.deepEqual([...run.written.matchAll(/^(\d\.\d) .*\n {2}Current: Could not read$/gm)].map((match) => match[1]), ['3.2', '3.3', '3.4', '3.5']);
  assert.doesNotMatch(run.written, /already has a value|already have a value/);
  applyAnswers(run.args);

  const refresh = await answer([], { refresh: true });
  assert.equal(refresh.prompts.length, 0);
  assert.equal(refresh.result.refresh, 'kept-current');
  // Refresh shows no table, so it gives each row its title.
  assert.match(refresh.written, /^No setting needs your approval, so refresh kept your current answers, with no question\.$/m, 'never counted as kept on all settings');
  assert.match(refresh.written, /^Setup could not read 5 settings \(2\.1 How should Claude Code use agents, 3\.2 Claude Code setting: Hide AI credit in commits\/PRs, [^?]+\), so it writes nothing there\.$/m);
  applyAnswers(refresh.args);
  assert.equal(fs.readFileSync(path.join(home.root, '.claude', 'settings.json'), 'utf8'), bytes, 'nothing is written');

  // A piped run's heading and closing line say the same.
  const piped = pipedRun('');
  assert.equal(piped.source, 'nothing to approve');
  assert.match(piped.stdout, /^No setting needs your approval, so setup asked nothing and keeps them all as they are\. Setup could not read 5 settings /m);
  assert.doesNotMatch(piped.stdout + piped.written, /already has a value/i);
  assert.match(piped.written, /^# Toolkit setup - no questions: nothing to approve, and \d settings could not be read$/m);
});

test('a row whose parent entry is not an object is named as not read, never counted as having a value, and is not asked about', async (t) => {
  const home = claudeHome(t);
  applyAnswers((await answer(['yes'])).args);
  const file = path.join(home.root, '.claude', 'settings.json');
  for (const [pluginConfigs, refs] of [['x', '3.5'], [[], '3.5'], [{ [NEW_ID]: { options: null } }, '3.5']]) {
    const bytes = JSON.stringify({ ...home.read(), pluginConfigs });
    fs.writeFileSync(file, bytes);
    const run = await answer([]);
    assert.equal(run.prompts.length, 0);
    assert.match(run.written, /3\.5 .*\n {2}Current: Cannot change: a parent entry is not an object\n/);
    assert.match(run.written, /Toolkit setup - no questions: nothing to approve, and 1 setting could not be read\n/);
    assert.ok(run.written.includes(`Setup could not read 1 setting (${refs}), so it writes nothing there.`), run.written);
    assert.doesNotMatch(run.written, /already has a value/);
    applyAnswers(run.args);
    assert.equal(fs.readFileSync(file, 'utf8'), bytes, 'nothing is written');
  }
});

test('an unreadable settings file with no usable agent profile says setup still sets the profile, in setup and in refresh', async (t) => {
  const home = claudeHome(t);
  applyAnswers((await answer(['yes'])).args);
  unreadable(home);
  const still = /so it writes nothing there\. Toolkit's own agent profile is still set to root-only, because no saved one can be used\./;
  for (const refresh of [false, true]) {
    assert.match((await answer([], { refresh, profile: { supported: false, topology: 'root-only' } })).written, still);
    const kept = await answer([], { refresh });
    assert.match(kept.written, /so it writes nothing there\./);
    assert.doesNotMatch(kept.written, /agent profile is still set/, 'a usable profile is kept as it is');
  }
});

test('a subagent limit setup could read says nothing about one it could not read, even with no usable agent profile', (t) => {
  const home = claudeHome(t);
  fs.mkdirSync(path.join(home.root, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home.root, '.claude', 'settings.json'), JSON.stringify({ env: { CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '3' } }));
  const args = core.parseArgs(['--execute', '--profile', 'auto-main', '--host', 'claude-code']);
  const row = core.setupQuestionSpecs(args, currentState({ profile: { supported: false, topology: 'root-only' } })).find((spec) => spec.presentation.question_ref === '2.1');
  assert.equal(row.default_state, 'owner-value');
  assert.equal(row.recommendation_reason, 'This is your own value, so setup keeps it.');
});

test('with a default left to apply, the one question still names the settings it could not read', async (t) => {
  const home = claudeHome(t);
  fs.mkdirSync(path.join(home.root, '.claude'), { recursive: true });
  unreadable(home);
  // A row with no value yet, which a yes sets, beside the settings that could not be read.
  const args = core.parseArgs(['--execute', '--profile', 'auto-main', '--host', 'claude-code']);
  const specs = core.setupQuestionSpecs(args, currentState());
  const row = specs.find((spec) => spec.default_state === 'toolkit-default');
  const pending = specs.map((spec) => (spec === row ? { ...spec, default_state: 'unset', applies_default: true } : spec));
  const bank = require('../scripts/toolkit-question-bank.cjs').renderStrongDefaultBank(pending.map((spec) => ({ ...spec, presentation: undefined })), { markdown: false }).join('\n');
  assert.match(bank, /1 question: Apply Toolkit's default to the 1 Claude Code setting that has no value yet\?/);
  assert.match(bank, /Setup applies the Toolkit default to 1 setting not set yet and keeps every other setting as it is\. Setup could not read 5 settings \(2\.1, 3\.2, 3\.3, 3\.4, 3\.5\), so it writes nothing there\./);
});

test('a setting this Claude Code version does not have is named as that, never as having a value or unreadable', async (t) => {
  claudeHome(t, '2.1.270');
  applyAnswers((await answer(['yes'])).args);
  const run = await answer([]);
  assert.equal(run.prompts.length, 0);
  assert.match(run.written, /Toolkit setup - no questions: nothing to approve\n/);
  assert.match(run.written, /setup asks nothing and keeps them all as they are\. This Claude Code version does not have 1 setting \(3\.5\), so setup writes nothing there\./);
  assert.match(run.written, /3\.5 .*\n {2}Current: Not in this Claude Code version\n/);
  assert.doesNotMatch(run.written, /could not read|already has a value/i);
});

// Owner decision of 23 November 2026: Toolkit never asks about or recommends the Claude desktop app's
// "archive sessions when their PR closes" setting, because it would archive the controller chat that binds a
// merge train's pull request. Setup has no row, flag or text for it, and the four Claude Code rows stand alone.
test('setup has no row, flag or text for the desktop app\'s archive-on-PR-close setting', (t) => {
  claudeHome(t);
  const ids = ['attribution', 'cross-session-inbound', 'switch-models-on-flag', 'agents-md'];
  assert.deepEqual(SETTINGS.map((spec) => spec.id), ids);
  const archive = /archive|auto_archive_on_pr_close|claude-app-setting/i;
  for (const host of ['claude-code', 'codex']) {
    const specs = core.setupQuestionSpecs(core.parseArgs(['--execute', '--host', host]), currentState());
    assert.deepEqual(specs.filter((spec) => archive.test(`${spec.id} ${spec.title}`)).map((spec) => spec.id), [], host);
  }
  const claudeRows = core.setupQuestionSpecs(core.parseArgs(['--execute', '--host', 'claude-code']), currentState()).filter((spec) => /^claude-setting-/.test(spec.id));
  assert.deepEqual(claudeRows.map((spec) => spec.id), ids.map((id) => `claude-setting-${id}`));
  assert.throws(() => core.parseArgs(['--execute', '--host', 'claude-code', '--claude-app-setting', 'auto_archive_on_pr_close=off']));
  assert.throws(() => core.parseArgs(['--execute', '--host', 'claude-code', '--claude-setting', 'auto-archive-on-pr-close=enable']), /Unsupported --claude-setting name/);
  for (const file of ['skills/toolkit-setup/SKILL.md', 'repo/docs/HOW-TO-USE.md', 'repo/docs/SETUP-QUESTIONS.generated.md', 'repo/scripts/setup-toolkit-core.cjs', 'repo/scripts/toolkit-question-bank.cjs']) {
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8'), /auto_archive_on_pr_close|auto-archive-on-pr-close|archive sessions when their PR closes|archive row|--claude-app-setting/i, file);
  }
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
