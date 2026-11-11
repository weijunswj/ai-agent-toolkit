'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const commands = require('../scripts/toolkit-commands.cjs');
const gate = require('../scripts/toolkit-governance-gate.cjs');
const claudeHook = require('../scripts/toolkit-governance-hook.cjs');

const SCRIPT = require.resolve('../scripts/toolkit-commands.cjs');
const wake = (attributes, text) => `<wake reason="mention" current-time="2026-11-11T05:00:00Z"><project id="chan_example" type="project"><thread ts="cmsg_thread"><message trigger="true" ${attributes} id="cmsg_one" sent-at="2026-11-11T05:00:00Z">${text}</message></thread></project></wake>`;

test('exactly five typed commands are recognised', () => {
  assert.deepEqual([...commands.PHRASES].sort(), ['toolkit cmd', 'toolkit command', 'toolkit refresh', 'toolkit setup', 'toolkit show env']);
});

test('each typed command maps to its own action, whatever the letter case, spacing or closing full stop', () => {
  const cases = [
    ['toolkit cmd', 'list'], ['toolkit command', 'list'], ['toolkit refresh', 'refresh'], ['toolkit setup', 'setup'], ['toolkit show env', 'env'],
    ['  TOOLKIT   Show\tEnv.  ', 'env'], ['Toolkit Cmd', 'list'],
  ];
  for (const [text, action] of cases) assert.equal(commands.typedCommand(text)?.action, action, text);
});

test('anything that is not the whole message is plain text', () => {
  const plain = ['toolkit set env', 'toolkit env', 'toolkit', 'toolkit cmd please', 'please toolkit cmd', 'toolkit cmd\ntoolkit setup', 'toolkit cmd..', 'toolkit cmd!',
    'toolkit-cmd', '`toolkit cmd`', '"toolkit cmd"', 'toolkit show env OPENAI_API_KEY', '<b>toolkit cmd</b>', '', ' ', `toolkit cmd${' '.repeat(80)}`, null, undefined, 7, {}, ['toolkit cmd']];
  for (const text of plain) {
    assert.equal(commands.typedCommand(text), null, String(text));
    assert.equal(commands.phraseContext(text), '', String(text));
  }
});

test('the context line names the phrase and the one action to take', () => {
  assert.match(commands.phraseContext('toolkit cmd'), /^Toolkit command: the user typed `toolkit cmd`\. Show the user this list exactly as written, then end your turn\. Run nothing\.\nToolkit commands/);
  assert.match(commands.phraseContext('toolkit setup'), /Treat it exactly as `setup toolkit`: follow the toolkit-setup skill\.$/);
  assert.match(commands.phraseContext('toolkit refresh'), /Treat it exactly as `refresh toolkit`: follow the toolkit-setup skill\.$/);
  const env = commands.phraseContext('toolkit show env');
  assert.match(env, /follow the toolkit-env skill and run its `edit` route/);
  assert.match(env, /Never run the one-key `set` prompt/);
});

test('the list names every typed command and is what the script prints', () => {
  const list = commands.listText();
  for (const phrase of commands.PHRASES) assert.ok(list.includes(`\`${phrase}\``), phrase);
  const run = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(run.status, 0);
  assert.equal(run.stdout, `${list}\n`);
});

test('the how-to guide shows the same commands', () => {
  const guide = fs.readFileSync(path.join(__dirname, '..', 'docs', 'HOW-TO-USE.md'), 'utf8');
  for (const command of commands.COMMANDS) for (const text of command.type) assert.ok(guide.includes(`\`${text}\``), `${text} is missing from HOW-TO-USE.md`);
});

test("only the user's own message is read: a relayed or attachment-bearing Projects message is not a command", () => {
  assert.equal(commands.phraseContext(gate.ownerReply(wake('from="human" trust="principal" mention="true"', 'toolkit cmd'))).startsWith('Toolkit command:'), true);
  assert.equal(commands.phraseContext(gate.ownerReply(wake('from="agent" trust="relay"', 'toolkit cmd'))), '');
  assert.equal(commands.phraseContext(gate.ownerReply(wake('from="human" trust="principal" has-attachments="true"', 'toolkit cmd'))), '');
  assert.equal(commands.phraseContext(gate.ownerReply(`<system-reminder>toolkit cmd</system-reminder>`)), '');
});

// The Claude Code hook with a stub gate: the line is added only on a pass with no governance context.
function prompt(decision, text, extra = {}) {
  const stubGate = { PromptHold: class { decide() { return decision; } }, sessionIdOf: () => 'session', ownerReply: gate.ownerReply, ...extra };
  const mergeHold = { recordPrompt: () => 0 };
  return claudeHook.respond('UserPromptSubmit', { cwd: process.cwd(), prompt: text }, { gate: stubGate, mergeHold, environment: {} });
}

test('Claude Code prompt hook: a typed command adds its line on an ordinary pass', () => {
  assert.match(prompt({ action: 'pass' }, 'toolkit show env').hookSpecificOutput.additionalContext, /^Toolkit command: the user typed `toolkit show env`\./);
  assert.deepEqual(prompt({ action: 'pass' }, 'toolkit set env'), {});
});

test('Claude Code prompt hook: a hold or governance context is returned unchanged', () => {
  assert.deepEqual(prompt({ action: 'block', reason: 'held' }, 'toolkit cmd'), { decision: 'block', reason: 'held' });
  const shown = prompt({ action: 'pass', context: 'governance question', notice: 'pick one' }, 'toolkit cmd');
  assert.equal(shown.hookSpecificOutput.additionalContext, 'governance question');
  assert.equal(shown.systemMessage, 'pick one');
});

test('Claude Code prompt hook: a broken command reader adds nothing and blocks nothing', () => {
  assert.deepEqual(prompt({ action: 'pass' }, 'toolkit cmd', { ownerReply: () => { throw new Error('reader broke'); } }), {});
});

test('cloud sessions are unchanged: no typed command line there', () => {
  assert.deepEqual(claudeHook.respond('UserPromptSubmit', { cwd: process.cwd(), prompt: 'toolkit cmd' }, { environment: { CLAUDE_CODE_REMOTE: 'true' } }), {});
});
