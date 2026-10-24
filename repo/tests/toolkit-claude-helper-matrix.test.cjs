'use strict';
require('./toolkit-test-temp-guard.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ClaudeMatrixContext, runHookCase, HOOK_CASES, OTHER_ROWS, LIVE_TOO, ROW_IDS } = require('./support/claude-helper-matrix.cjs');

const ROOT = path.resolve(__dirname, '..', '..');

test('every launch-matrix row has exactly one kind of proof, and every row is accounted for', () => {
  const hookRows = new Set(HOOK_CASES.map(([row]) => row));
  for (const row of hookRows) assert.equal(Object.hasOwn(OTHER_ROWS, row), false, `${row} is both a hook row and another kind`);
  assert.deepEqual([...new Set([...hookRows, ...Object.keys(OTHER_ROWS)])].sort(), [...ROW_IDS].sort());
  for (const row of LIVE_TOO) assert.ok(hookRows.has(row), `${row} needs a hook case before its live proof`);
  for (const [row, entry] of Object.entries(OTHER_ROWS)) {
    assert.ok(['config', 'live', 'waits', 'other-host', 'other-test'].includes(entry.proof), row);
    if (entry.proof === 'waits') assert.ok(entry.on, `${row} names what it waits on`);
    if (entry.proof === 'other-test') assert.ok(fs.existsSync(path.join(ROOT, entry.file)), `${row}: ${entry.file}`);
  }
});

test('each hook row gives the expected decision through the real hook process', t => {
  const context = new ClaudeMatrixContext();
  t.after(() => context.remove());
  for (const entry of HOOK_CASES) {
    const verdict = runHookCase(context, entry);
    if (verdict.skipped) { t.diagnostic(`${verdict.row} ${verdict.case}: skipped, ${verdict.skipped}`); continue; }
    assert.ok(verdict.pass, `${verdict.row} ${verdict.case}: ${JSON.stringify(verdict.observed)}`);
  }
});

test('the matrix context leaves the process home alone and writes nothing there', t => {
  const home = path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'toolkit-matrix-home-')), 'never-written-home');
  t.after(() => fs.rmSync(path.dirname(home), { recursive: true, force: true }));
  const probe = `const os = require('node:os');
    const { ClaudeMatrixContext } = require(${JSON.stringify(path.join(__dirname, 'support', 'claude-helper-matrix.cjs'))});
    const context = new ClaudeMatrixContext();
    const seen = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, homedir: os.homedir(), context: context.environment.HOME === context.home };
    context.remove();
    process.stdout.write(JSON.stringify(seen));`;
  const result = require('node:child_process').spawnSync(process.execPath, ['-e', probe],
    { env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { HOME: home, USERPROFILE: home, homedir: home, context: true });
  assert.equal(fs.existsSync(home), false, 'nothing was written to the home folder');
});

test('live sessions in both modes keep the real login and read the scratch registry, where the repository is ENABLED', t => {
  const { liveEnvironment } = require('./qualification/claude-helper-matrix.live.cjs');
  const context = new ClaudeMatrixContext();
  t.after(() => context.remove());
  const userHome = path.join(context.base, 'user-home');
  // The runner's own environment, outside a cloud session and with one machine setting installed mode keeps.
  const runner = { ...process.env, CLAUDE_CODE_SUBAGENT_MODEL: 'from-the-machine' };
  for (const name of ['CLAUDE_CODE_REMOTE', 'CLAUDE_CONFIG_DIR', 'AI_AGENT_TOOLKIT_CONTROL_ROOT']) delete runner[name];
  const hold = environment => JSON.parse(require('node:child_process').spawnSync(process.execPath, [path.join(ROOT, 'repo', 'scripts', 'toolkit-governance-hook.cjs'), '--event', 'UserPromptSubmit'],
    { input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'live-env', cwd: context.repo, prompt: 'hello' }), env: environment, encoding: 'utf8' }).stdout || '{}').decision === 'block';
  const modes = [['plugin', context.controlRoot, undefined], ['installed', path.join(userHome, '.ai-agent-toolkit', 'agent-control'), 'from-the-machine']];
  const environments = modes.map(([mode, controlRoot, subagentModel]) => {
    const environment = liveEnvironment(mode, context, { environment: runner, userHome, decisions: path.join(context.base, 'log.ndjson') });
    assert.deepEqual([environment.HOME, environment.USERPROFILE, environment.CLAUDE_CONFIG_DIR, environment.AI_AGENT_TOOLKIT_CONTROL_ROOT, environment.CLAUDE_CODE_SUBAGENT_MODEL, environment.TOOLKIT_HOOK_DECISION_LOG],
      [context.home, context.home, path.join(userHome, '.claude'), controlRoot, subagentModel, path.join(context.base, 'log.ndjson')], mode);
    assert.equal(hold(environment), false, `${mode}: the scratch repository is ENABLED for the session's hooks`);
    return environment;
  });
  assert.equal(fs.existsSync(userHome), false, 'nothing was written to the user\'s home or user-state');
  // With the user's own home, as the runner gave installed mode before, the scratch repository is held.
  for (const environment of environments) assert.equal(hold({ ...environment, HOME: userHome, USERPROFILE: userHome }), true);
  const configured = liveEnvironment('plugin', context, { environment: { ...runner, CLAUDE_CONFIG_DIR: path.join(userHome, 'work') }, userHome });
  assert.equal(configured.CLAUDE_CONFIG_DIR, path.join(userHome, 'work'));
});

test('A9: the agent hook blocks the launch when it fails or times out', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'hooks', 'hooks.json'), 'utf8'));
  const agent = hooks.hooks.PreToolUse.find(group => group.matcher === 'Agent|Task');
  assert.equal(agent.hooks.length, 1);
  assert.equal(agent.hooks[0].onFailure, 'block');
  assert.match(agent.hooks[0].command, /toolkit-claude-agent-hook\.cjs/);
});

test('the live runner gives a session every tool its helpers list, so no helper starts with zero tools', () => {
  const { sessionTools } = require('./qualification/claude-helper-matrix.live.cjs');
  const tools = sessionTools({
    g0: { text: '---\nname: toolkit-g0-helper\ntools: Read, Glob, Grep\ndisallowedTools: Agent, Task\n---\n' },
    g1: { text: '---\nname: toolkit-g1-helper\ntools: Read, Glob, Grep, Bash, Edit, Write\n---\n' }
  }).split(',');
  assert.deepEqual(tools, ['Agent', 'Read', 'Glob', 'Grep', 'Bash', 'Edit', 'Write']);
});

test('installed mode picks the local Toolkit install over a claude.ai account copy', () => {
  const { pickInstalledPlugin } = require('./qualification/claude-helper-matrix.live.cjs');
  const local = { id: 'ai-agent-toolkit@ai-agent-toolkit-local', scope: 'user', enabled: true, version: '1.0.0', installPath: '/cache/tk', readFromFolder: '/src/tk' };
  const synced = { id: 'ai-agent-toolkit@synced', scope: 'synced', enabled: true, version: '0.9.0', installPath: '/synced/tk' };
  assert.equal(pickInstalledPlugin([synced, local]).root, path.resolve('/src/tk'));
  assert.equal(pickInstalledPlugin([synced]).root, path.resolve('/synced/tk'));
  assert.equal(pickInstalledPlugin([{ ...synced, installPath: '' }, local]).root, path.resolve('/src/tk'));
  assert.throws(() => pickInstalledPlugin([{ ...synced, installPath: '' }]), /ai-agent-toolkit@synced \(synced, no folder\)/);
  assert.throws(() => pickInstalledPlugin([{ ...local, enabled: false }]), /found: none/);
  assert.throws(() => pickInstalledPlugin([local, { ...local, id: 'ai-agent-toolkit@other', scope: 'project' }]), /ai-agent-toolkit@other \(project\)/);
});

test('the live runner sets no dollar cap unless one is given', () => {
  const { parseArgs, sessionArgs } = require('./qualification/claude-helper-matrix.live.cjs');
  const definitions = { g0: { text: '---\nname: toolkit-g0-helper\ntools: Read, Glob, Grep\n---\n' } };
  const capFlags = options => {
    const args = sessionArgs(options, definitions, { prompt: 'p', sessionId: 's' });
    return args.flatMap((arg, i) => arg === '--max-budget-usd' ? [args[i + 1]] : []);
  };
  const uncapped = parseArgs(['--out', 'x']);
  assert.equal(uncapped.maxBudgetUsd, null);
  assert.deepEqual(capFlags(uncapped), [], 'no cap flag without --max-budget-usd');
  assert.deepEqual(capFlags(parseArgs(['--out', 'x', '--max-budget-usd', '2.50'])), ['2.50'], 'a given cap is passed once, as given');
  for (const bad of ['', '-1', '0', '0.0', 'lots', '1e3']) {
    assert.throws(() => parseArgs(['--out', 'x', '--max-budget-usd', bad]), /takes a dollar amount above 0/, `refuses ${JSON.stringify(bad)}`);
  }
});
