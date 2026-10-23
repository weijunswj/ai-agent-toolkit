'use strict';
require('./toolkit-test-temp-guard.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'repo', 'scripts', 'toolkit-claude-session-agents.cjs');
const { checkClaudeArguments, helperRedefinitions, pinnedRoutes } = require('../scripts/toolkit-claude-session-agents.cjs');

const routes = pinnedRoutes('owner-claude', ROOT);
const onRoute = role => ({ description: 'x', prompt: 'y', model: routes[role].model, effort: routes[role].effort, disallowedTools: ['Agent', 'Task'] });

test('A14: the pinned routes come from the rendered helper definitions of the selected stack', () => {
  assert.deepEqual(routes.G0, { model: 'claude-haiku-5-5', effort: 'xhigh' });
  assert.deepEqual(routes.G1, { model: 'claude-haiku-5-5', effort: 'xhigh' });
});

test('A14: an --agents copy of a Toolkit helper off its route, or not a leaf, is refused with a plain reason', () => {
  assert.deepEqual(helperRedefinitions({ 'toolkit-g0-helper': onRoute('G0'), 'toolkit-g1-helper': onRoute('G1'), reviewer: { model: 'opus' } }, routes), []);
  const cases = [
    [{ 'toolkit-g0-helper': { ...onRoute('G0'), model: 'claude-opus-5-5' } }, /redefines the Toolkit helper toolkit-g0-helper: its model is claude-opus-5-5, not claude-haiku-5-5\.$/],
    [{ 'toolkit-g1-helper': { ...onRoute('G1'), effort: 'low' } }, /its effort is low, not xhigh/],
    [{ 'toolkit-g1-helper': { ...onRoute('G1'), effort: undefined } }, /its effort is not set, not xhigh/],
    [{ 'toolkit-g0-helper': { ...onRoute('G0'), disallowedTools: ['Agent'] } }, /it does not disallow Task/],
    [{ 'toolkit-g0-helper': { ...onRoute('G0'), disallowedTools: undefined } }, /it does not disallow Agent and Task/],
    [{ 'toolkit-g0-helper': 'text' }, /it is not an agent definition/],
    [[], /not a JSON object of agent definitions/],
  ];
  for (const [agents, pattern] of cases) {
    const reasons = helperRedefinitions(agents, routes);
    assert.equal(reasons.length, 1, JSON.stringify(agents));
    assert.match(reasons[0], pattern);
  }
  // A comma-separated tools string is read the way Claude Code reads it.
  assert.deepEqual(helperRedefinitions({ 'toolkit-g0-helper': { ...onRoute('G0'), disallowedTools: 'Agent, Task' } }, routes), []);
});

test('A14: every --agents form in an argument list is checked: inline JSON, = form and a JSON file', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-session-agents-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bad = JSON.stringify({ 'toolkit-g0-helper': { ...onRoute('G0'), model: 'claude-opus-5-5', effort: 'low' } });
  fs.writeFileSync(path.join(dir, 'agents.json'), bad);
  const check = argv => checkClaudeArguments(argv, { routes, cwd: dir });
  assert.deepEqual(check(['-p', 'hi', '--model', 'claude-opus-5-5']), { refused: false, reasons: [] });
  assert.equal(check(['-p', 'hi', '--agents', JSON.stringify({ 'toolkit-g1-helper': onRoute('G1') })]).refused, false);
  for (const argv of [['--agents', bad], [`--agents=${bad}`], ['--agents', 'agents.json'], ['--agents', path.join(dir, 'agents.json')]]) {
    const result = check(argv);
    assert.equal(result.refused, true, argv.join(' '));
    assert.match(result.reasons[0], /model is claude-opus-5-5.*effort is low/);
  }
  for (const value of ['missing.json', '{not json', '']) {
    assert.match(check(['--agents', value]).reasons[0], /could not be read as JSON/, value);
  }
  assert.equal(check(['--', '--agents', bad]).refused, false, 'arguments after -- are prompt text, not flags');
});

test('A14: the command refuses with exit 2 and plain reasons, passes with exit 0, and needs a stack', () => {
  const run = args => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  const bad = JSON.stringify({ 'toolkit-g0-helper': { ...onRoute('G0'), effort: 'low' } });
  const refused = run(['--stack', 'owner-claude', '--', '-p', 'hi', '--agents', bad]);
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /^Toolkit: --agents redefines the Toolkit helper toolkit-g0-helper: its effort is low, not xhigh\.$/m);
  assert.match(refused.stderr, /the launch was not started/);
  const passed = run(['--stack', 'owner-claude', '--', '-p', 'hi', '--agents', JSON.stringify({ reviewer: { model: 'opus' } })]);
  assert.equal(passed.status, 0);
  assert.equal(passed.stderr, '');
  assert.equal(run(['--', '-p', 'hi']).status, 1);
});
