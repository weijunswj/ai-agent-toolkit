'use strict';

// The hook test pack runner (toolkit-hook-pack.cjs): the corpus format, how it picks the hooks a
// host starts, how it reads a hook's decision, the expectation-change check and one real row end
// to end. The whole pack runs in CI's hook-pack job, not here.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const pack = require('../scripts/toolkit-hook-pack.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const hooksOf = host => JSON.parse(fs.readFileSync(path.join(ROOT, host === 'claude' ? '.claude-plugin' : '.codex-plugin', 'hooks', 'hooks.json'), 'utf8'));
const row = (extra = {}) => ({ id: 'X1', source: 'test', kind: 'benign', hosts: ['claude'], payload: { tool_name: 'Bash', tool_input: { command: 'git status' } }, expect: { decision: 'allow' }, status: 'pass', ...extra });
const output = (status, stdout = '', stderr = '') => ({ status, stdout, stderr });

test('the corpus loads with unique ids, and every known-bad row names its lane and date', () => {
  const corpus = pack.loadCorpus();
  assert.deepEqual(corpus.errors, []);
  assert.ok(corpus.rows.length >= 20);
  for (const entry of corpus.rows.filter(item => item.status === 'known-bad')) assert.ok(entry.lane && entry.added, entry.id);
  for (const kind of ['benign', 'hostile', 'fault', 'update', 'parity']) assert.ok(corpus.rows.some(item => item.kind === kind), kind);
});

test('a row with a wrong shape is refused with the reason', () => {
  assert.deepEqual(pack.rowErrors(row()), []);
  const cases = [
    [row({ id: 'lower' }), /id must start/],
    [row({ hosts: ['claude', 'claude'] }), /hosts must list/],
    [row({ expect: { decision: 'maybe' } }), /decision must be allow or deny/],
    [row({ expect: { decision: 'deny', reason: 'Refused because ...' } }), /reason is a hook name/],
    [row({ status: 'known-bad' }), /names the lane/],
    [row({ status: 'known-bad', lane: 'x', added: '2026-10-30', known_bad_on: ['codex'] }), /known_bad_on lists some/],
    [row({ lane: 'x' }), /only a known-bad row/],
    [row({ fault: { type: 'throw-module', file: '../outside.cjs' } }), /names a file under repo\/scripts/],
    [row({ fixture: { repo: { governance: 'maybe' } } }), /governance must be one of/],
    [row({ expect_by_host: { codex: { decision: 'deny' } } }), /does not run on/],
    [row({ extra: true }), /unknown key extra/],
  ];
  for (const [bad, reason] of cases) assert.match(pack.rowErrors(bad).join('\n'), reason, JSON.stringify(bad));
  const parsed = pack.parseCorpusFile(JSON.stringify({ schema: pack.SCHEMA, family: 'other', rows: [] }), 'push.json');
  assert.match(parsed.errors.join('\n'), /family must be "push"/);
});

test('matchers read as the hosts read them: none matches all, a plain list exactly, anything else as a pattern', () => {
  assert.equal(pack.matches(undefined, 'Bash'), true);
  assert.equal(pack.matches('*', 'Bash'), true);
  assert.equal(pack.matches('Agent|Task', 'Task'), true);
  assert.equal(pack.matches('Agent|Task', 'TaskStop'), false);
  assert.equal(pack.matches('^mcp__.*[Mm][Ee][Rr][Gg][Ee].*$', 'mcp__github__merge_pull_request'), true);
});

test('the hooks a host starts for a call come from its real hooks.json', () => {
  const names = (host, event, tool) => pack.selectHooks(hooksOf(host), event, tool).map(hook => /([a-z-]+)\.cjs/.exec(hook.command)[1]);
  assert.deepEqual(names('claude', 'PreToolUse', 'Bash'), ['toolkit-claude-attribution-hook', 'toolkit-governance-hook']);
  assert.deepEqual(names('claude', 'PreToolUse', 'mcp__github__merge_pull_request'), ['toolkit-governance-hook']);
  assert.deepEqual(names('claude', 'PreToolUse', 'mcp__hearthbot__post_message'), ['toolkit-governance-hook']);
  assert.deepEqual(names('claude', 'PreToolUse', 'Read'), ['toolkit-governance-hook']);
  assert.deepEqual(names('codex', 'PreToolUse', 'exec_command'), ['toolkit-codex-helper-hook']);
  assert.deepEqual(names('codex', 'UserPromptSubmit'), ['toolkit-codex-helper-hook']);
  const blocking = pack.selectHooks(hooksOf('claude'), 'PreToolUse', 'Bash').map(hook => hook.onFailure || 'none');
  assert.deepEqual(blocking, ['none', 'block']);
});

test('the plugin root is written into the command, and Codex on Windows runs the installed launcher', () => {
  const hook = { command: 'node "${PLUGIN_ROOT}/repo/scripts/a.cjs"', commandWindows: 'C:\\Windows\\ps.exe -File "${PLUGIN_ROOT}/repo/scripts/a.ps1" ; exit $LASTEXITCODE' };
  assert.equal(pack.hostCommand('codex', hook, '/tmp/plugin', 'linux'), 'node "/tmp/plugin/repo/scripts/a.cjs"');
  assert.equal(pack.hostCommand('codex', hook, 'C:\\p', 'win32'), 'C:\\Windows\\ps.exe -File "C:/p/repo/scripts/a.ps1" ; exit $LASTEXITCODE');
  assert.equal(pack.hostCommand('claude', { command: 'node "${CLAUDE_PLUGIN_ROOT}/repo/scripts/b.cjs"' }, 'C:\\p', 'win32'), 'node "C:/p/repo/scripts/b.cjs"');
});

test('a hook process decides as the host reads it', () => {
  const plain = { command: 'node "x/repo/scripts/toolkit-a-hook.cjs"' };
  const blocking = { ...plain, onFailure: 'block' };
  const deny = JSON.stringify({ hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: 'no' } });
  assert.deepEqual(pack.hookDecision('claude', plain, output(0, '')), { decision: 'allow' });
  assert.equal(pack.hookDecision('claude', plain, output(0, deny)).reason, 'toolkit-a-hook');
  assert.equal(pack.hookDecision('codex', plain, output(2, '', 'no')).decision, 'deny');
  assert.equal(pack.hookDecision('claude', plain, output(0, JSON.stringify({ decision: 'block', reason: 'held' }))).decision, 'deny');
  // A hook that itself fails: Claude Code blocks only with onFailure: block, Codex never.
  assert.deepEqual(pack.hookDecision('claude', blocking, output(1, '', 'boom')).reason, 'toolkit-a-hook:failure');
  assert.equal(pack.hookDecision('claude', blocking, output(null)).decision, 'deny');
  assert.equal(pack.hookDecision('claude', plain, output(1, '', 'boom')).decision, 'allow');
  assert.equal(pack.hookDecision('codex', blocking, output(1, '', 'boom')).decision, 'allow');
});

test('a refusal only because a hook failed meets a row only when the row names it', () => {
  const deny = { decision: 'deny', problems: [], failed: [] };
  const hostile = row({ kind: 'hostile', expect: { decision: 'deny' } });
  assert.equal(pack.meets(hostile, 'claude', { ...deny, reason: 'toolkit-claude-attribution-hook' }), true);
  assert.equal(pack.meets(hostile, 'claude', { ...deny, reason: 'toolkit-governance-hook:failure' }), false);
  const named = row({ kind: 'update', expect: { decision: 'deny', reason: 'toolkit-governance-hook:failure' } });
  assert.equal(pack.meets(named, 'claude', { ...deny, reason: 'toolkit-governance-hook:failure' }), true);
  assert.equal(pack.meets(named, 'claude', { ...deny, reason: 'toolkit-claude-attribution-hook' }), false);
});

test('an expectation that changes, a removed row or a row lowered to known-bad needs a reason in the pull request body', () => {
  const base = [row({ id: 'A1' }), row({ id: 'A2' }), row({ id: 'A3', hosts: ['claude', 'codex'] }), row({ id: 'A4' })];
  const head = [
    row({ id: 'A1', expect: { decision: 'deny' } }),
    row({ id: 'A3', hosts: ['claude', 'codex'], status: 'known-bad', lane: 'x', added: '2026-10-30', known_bad_on: ['codex'] }),
    row({ id: 'A4' }), row({ id: 'A5', status: 'known-bad', lane: 'x', added: '2026-10-30' }),
  ];
  assert.deepEqual(pack.expectationChanges(base, head).map(change => change.id), ['A1', 'A2', 'A3']);
  // Flipping a known-bad row to pass, and adding known-bad rows, need no reason.
  const bad = row({ id: 'B1', hosts: ['claude', 'codex'], status: 'known-bad', lane: 'x', added: '2026-10-30' });
  assert.deepEqual(pack.expectationChanges([bad], [row({ id: 'B1', hosts: ['claude', 'codex'] })]), []);
  assert.deepEqual(pack.expectationChanges([bad], [{ ...bad, known_bad_on: ['codex'] }]), []);
  // Any other change can stop a row proving what it proved, so each one needs a reason.
  const neutered = [
    { hosts: ['claude'] },
    { payload: { tool_name: 'Bash', tool_input: { command: 'git status --short' } } },
    { fixture: { repo: { governance: 'none' } } },
    { fault: { type: 'bad-json' } },
    { event: 'PostToolUse' },
    { kind: 'parity' },
  ];
  for (const change of neutered) {
    const found = pack.expectationChanges([bad], [{ ...bad, ...change }]);
    assert.equal(found.length, 1, JSON.stringify(change));
    assert.match(found[0].change, new RegExp(`${Object.keys(change)[0]} changed`));
  }
  const body = '## Summary\nx\n\n## Pack changes\n- A1: the hook now refuses this on purpose\n- `A2` - merged into A1\n\n## Validation\n- A3: not here\n';
  assert.deepEqual([...pack.explainedRows(body).keys()], ['A1', 'A2']);
  assert.equal(pack.explainedRows('no heading\n- A1: x').size, 0);
});

test('command-line options are checked before anything runs', async () => {
  const lines = [];
  const out = { write: text => lines.push(text) };
  assert.equal(await pack.main(['nope'], out), 2);
  assert.equal(await pack.main(['run', '--suite', 'odd'], out), 2);
  assert.equal(await pack.main(['run', '--rows', 'NO-SUCH-ROW'], out), 2);
  for (const value of ['-x', '--output=/tmp/x', '--exec=evil']) {
    assert.equal(await pack.main(['run', '--against', value], out), 2, value);
    assert.equal(await pack.main(['check-expectations', '--base', value], out), 2, value);
  }
  assert.doesNotThrow(() => pack.parseArgs(['run', '--against', 'HEAD~1']));
  assert.equal(await pack.main(['validate'], out), 0);
  assert.match(lines.join(''), /no problems/);
});

test('end to end: a real row runs through the Claude Code hooks as Claude Code starts them', async () => {
  const lines = [];
  const code = await pack.main(['run', '--rows', 'ATTR.co-author-trailer', '--host', 'claude'], { write: text => lines.push(text) });
  assert.equal(code, 0, lines.join(''));
  assert.match(lines.join(''), /attribution\s+1\s+1\s+0/);
});
