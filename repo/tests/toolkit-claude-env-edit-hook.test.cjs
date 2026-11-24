'use strict';
require('./toolkit-test-temp-guard.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const HOOK = path.join(ROOT, 'repo', 'scripts', 'toolkit-claude-env-edit-hook.cjs');
const { main, decide, REASON } = require('../scripts/toolkit-claude-env-edit-hook.cjs');

const HOME_POSIX = '/home/user';
const HOME_WIN = 'C:\\Users\\User';
const EDIT_FILE = 'env-edit-0123456789abcdef.env';
const call = (tool_name, tool_input) => ({ tool_name, tool_input });
const run = (input) => spawnSync(process.execPath, [HOOK], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8' });

const REFUSED = [
  ['Read the edit file', call('Read', { file_path: `${HOME_POSIX}/.ai-agent-toolkit/env/edit/${EDIT_FILE}` })],
  ['Read the edit file, Windows path', call('Read', { file_path: `${HOME_WIN}\\.ai-agent-toolkit\\env\\edit\\${EDIT_FILE}` })],
  ['Read the edit file, mixed case', call('Read', { file_path: `${HOME_WIN}\\.AI-Agent-Toolkit\\Env\\Edit\\${EDIT_FILE}` })],
  ['Read the session record', call('Read', { file_path: `~/.ai-agent-toolkit/env/edit/session.json` })],
  ['Write the edit file', call('Write', { file_path: `${HOME_POSIX}/.ai-agent-toolkit/env/edit/${EDIT_FILE}`, content: 'X=1\n' })],
  ['Edit the edit file', call('Edit', { file_path: `${HOME_POSIX}/.ai-agent-toolkit/env/edit/${EDIT_FILE}`, old_string: 'a', new_string: 'b' })],
  ['MultiEdit the edit file', call('MultiEdit', { file_path: `${HOME_POSIX}/.ai-agent-toolkit/env/edit/${EDIT_FILE}`, edits: [] })],
  ['Grep the edit folder', call('Grep', { pattern: 'TOKEN', path: `${HOME_POSIX}/.ai-agent-toolkit/env/edit` })],
  ['Grep the env folder', call('Grep', { pattern: 'TOKEN', path: `${HOME_POSIX}/.ai-agent-toolkit/env` })],
  ['Grep with a glob naming an edit file', call('Grep', { pattern: 'TOKEN', path: HOME_POSIX, glob: '**/env-edit-*.env' })],
  ['Glob the edit folder', call('Glob', { pattern: `${HOME_POSIX}/.ai-agent-toolkit/env/edit/*` })],
  ['Glob the env folder', call('Glob', { pattern: '*', path: `${HOME_WIN}\\.ai-agent-toolkit\\env\\` })],
  ['LS the edit folder', call('LS', { path: `${HOME_POSIX}/.ai-agent-toolkit/env/edit/` })],
  ['NotebookEdit there', call('NotebookEdit', { notebook_path: `${HOME_POSIX}/.ai-agent-toolkit/env/edit/x.ipynb`, new_source: '' })],
  ['cat the edit file', call('Bash', { command: `cat ~/.ai-agent-toolkit/env/edit/${EDIT_FILE}` })],
  ['cat by file name alone', call('Bash', { command: `cat ${EDIT_FILE}` })],
  ['an earlier edit file name', call('Bash', { command: 'type env-edit-0123456789abcdef.txt' })],
  ['a wildcard for edit files', call('PowerShell', { command: 'Get-ChildItem -Recurse -Filter env-edit-*.env $HOME' })],
  ['ls the env folder', call('Bash', { command: 'ls -la ~/.ai-agent-toolkit/env' })],
  ['cd into the env folder', call('Bash', { command: 'cd "$HOME/.ai-agent-toolkit/env/" && cat edit/*' })],
  ['grep -r the edit folder', call('Bash', { command: 'grep -r TOKEN "$HOME/.ai-agent-toolkit/env/edit"' })],
  ['Get-Content in PowerShell', call('PowerShell', { command: `Get-Content "$env:USERPROFILE\\.ai-agent-toolkit\\env\\edit\\${EDIT_FILE}"` })],
  ['Join-Path pieces in PowerShell', call('PowerShell', { command: "Get-ChildItem (Join-Path $HOME '.ai-agent-toolkit' 'env' 'edit')" })],
  ['node path.join pieces', call('Bash', { command: "node -e \"console.log(require('fs').readdirSync(require('path').join(require('os').homedir(), '.ai-agent-toolkit', 'env', 'edit')))\"" })],
  ['a watch on the folder', call('Monitor', { command: 'tail -f ~/.ai-agent-toolkit/env/edit/last-result.json' })],
];

const PASSED = [
  ['Read the manifest', call('Read', { file_path: `${HOME_POSIX}/.ai-agent-toolkit/env/manifest.json` })],
  ['Read a managed checkout file', call('Read', { file_path: `${HOME_POSIX}/.ai-agent-toolkit/source/ai-agent-toolkit/repo/scripts/toolkit-env.cjs` })],
  ['Edit a document that mentions the folder', call('Edit', { file_path: '/work/skills/toolkit-env/SKILL.md', old_string: 'Never open `~/.ai-agent-toolkit/env/edit/`', new_string: 'Never read `~/.ai-agent-toolkit/env/edit/env-edit-x.env`' })],
  ['Write a test that mentions the folder', call('Write', { file_path: '/work/repo/tests/a.test.cjs', content: "path.join(home, '.ai-agent-toolkit', 'env', 'edit')" })],
  ['Grep for the folder path as text', call('Grep', { pattern: '\\.ai-agent-toolkit/env/edit', path: '/work/repo' })],
  ['Grep the managed checkout', call('Grep', { pattern: 'EDIT_FILE', path: `${HOME_POSIX}/.ai-agent-toolkit/source/ai-agent-toolkit` })],
  ['toolkit env edit', call('Bash', { command: `node "${HOME_WIN.replace(/\\/g, '/')}/.ai-agent-toolkit/source/ai-agent-toolkit/repo/scripts/toolkit-env.cjs" edit` })],
  ['toolkit env apply', call('PowerShell', { command: 'node "C:/Users/User/.ai-agent-toolkit/source/ai-agent-toolkit/repo/scripts/toolkit-env.cjs" apply' })],
  ['toolkit env status', call('Bash', { command: 'node "/home/user/.ai-agent-toolkit/source/ai-agent-toolkit/repo/scripts/toolkit-env.cjs" status' })],
  ['cat the manifest', call('Bash', { command: 'cat ~/.ai-agent-toolkit/env/manifest.json' })],
  ['ls the Toolkit folder', call('Bash', { command: 'ls ~/.ai-agent-toolkit' })],
  ['an environment folder', call('Bash', { command: 'ls ~/.ai-agent-toolkit/environment' })],
  ['an editor folder', call('Bash', { command: 'ls ~/.ai-agent-toolkit/env/editor-notes.md' })],
  ['the env tests', call('PowerShell', { command: 'node repo/scripts/run-tests.cjs repo/tests/toolkit-env.test.cjs repo/tests/toolkit-env-no-delete.test.cjs' })],
  ['a plain env edit word', call('Bash', { command: 'git log --oneline -- repo/scripts/toolkit-env.cjs && echo "env edit"' })],
  ['an unrelated tool', call('WebFetch', { url: 'https://example.com/.ai-agent-toolkit/env/edit' })],
];

test('every call that reads, writes, searches or lists the env edit folder is refused', () => {
  for (const [label, input] of REFUSED) assert.equal(decide(input), true, label);
});

test('reads of the manifest, the env commands and documents that mention the folder pass', () => {
  for (const [label, input] of PASSED) assert.equal(decide(input), false, label);
});

test('a refusal reaches Claude Code as a deny decision with the plain reason, and a pass prints nothing', () => {
  const refused = run(REFUSED[0][1]);
  assert.equal(refused.status, 2);
  const decision = JSON.parse(refused.stdout).hookSpecificOutput;
  assert.deepEqual(decision, { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: REASON });
  assert.equal(refused.stderr.trim(), REASON);
  const passed = run(PASSED[0][1]);
  assert.equal(passed.status, 0);
  assert.equal(passed.stdout, '');
});

test('input it cannot read passes unless it names the env folder or an edit file', () => {
  assert.equal(run('not json').status, 0);
  assert.equal(run('').status, 0);
  assert.equal(run('{"tool_name":"Read","tool_input":{"file_path":"C:\\\\Users\\\\U\\\\.ai-agent-toolkit\\\\env\\\\edit\\\\x"').status, 2);
  assert.equal(run(`{broken ${EDIT_FILE}`).status, 2);
  assert.equal(run('{broken ~/.ai-agent-toolkit/env/manifest.json').status, 0);
});

test('when its own check throws, a call naming the folder is refused and any other call passes', () => {
  const broken = () => { throw new Error('broken'); };
  const quiet = { write() { return true; } };
  const out = process.stdout.write; const err = process.stderr.write;
  process.stdout.write = quiet.write; process.stderr.write = quiet.write;
  try {
    assert.equal(main(() => JSON.stringify(REFUSED[0][1]), broken), 2);
    assert.equal(main(() => JSON.stringify(PASSED[1][1]), broken), 0);
    assert.equal(main(() => { throw new Error('no stdin'); }), 0);
  } finally {
    process.stdout.write = out; process.stderr.write = err;
  }
});

test('Claude Code runs it for file and shell tools, after the existing PreToolUse hooks, without onFailure block', () => {
  for (const file of ['.claude-plugin/hooks/hooks.json', 'repo/contracts/toolkit-local-bridge/claude-plugin/hooks/hooks.json']) {
    const pre = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')).hooks.PreToolUse;
    const entry = pre.at(-1);
    assert.equal(entry.hooks[0].command, 'node "${CLAUDE_PLUGIN_ROOT}/repo/scripts/toolkit-claude-env-edit-hook.cjs"', file);
    assert.equal(entry.hooks[0].onFailure, undefined, file);
    const matcher = new RegExp(entry.matcher);
    for (const tool of ['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'NotebookRead', 'Grep', 'Glob', 'LS', 'Bash', 'PowerShell', 'Monitor']) assert.ok(matcher.test(tool), `${file}: ${tool}`);
    for (const tool of ['WebFetch', 'Agent', 'ReadMcpResource', 'mcp__x__Read']) assert.ok(!matcher.test(tool), `${file}: ${tool}`);
  }
  const codex = fs.readFileSync(path.join(ROOT, 'repo/contracts/toolkit-local-bridge/codex-plugin/hooks/hooks.json'), 'utf8');
  assert.doesNotMatch(codex, /env-edit-hook/, 'Claude Code only');
});
