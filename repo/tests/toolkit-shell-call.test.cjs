'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

const { SHELL_TOOL_NAMES, UNREADABLE, ShellCall, argvText } = require('../scripts/toolkit-shell-call.cjs');
const hostile = require('./support/hostile-inputs.cjs');

const base = path.resolve(os.tmpdir(), 'toolkit-shell-call-session');
const other = path.resolve(os.tmpdir(), 'toolkit-shell-call-other');
const read = (tool, toolInput, extra = {}) => ShellCall.from({ tool_name: tool, cwd: base, tool_input: toolInput, ...extra });

test('every host shape of a shell call gives the same text and the folder the command runs in', () => {
  const rows = [
    ['R1 Claude Bash command', read('Bash', { command: 'git push origin main' }), 'git push origin main', base],
    ['R2 Claude PowerShell command', read('PowerShell', { command: 'git push origin main' }), 'git push origin main', base],
    ['R3 Codex Bash command, cwd is the run folder', read('Bash', { command: 'git push origin main', workdir: base }), 'git push origin main', base],
    ['R4 Codex Bash cmd and workdir', read('Bash', { cmd: 'git push origin main', workdir: other }), 'git push origin main', other],
    ['R5 Codex exec_command cmd and workdir', read('exec_command', { cmd: 'git push origin main', workdir: other }), 'git push origin main', other],
    ['R6 Codex shell argv with bash -lc', read('shell', { command: ['bash', '-lc', 'git push origin main'], workdir: other }), 'git push origin main', other],
    ['R6 Codex local_shell argv with pwsh -Command', read('local_shell', { command: ['pwsh.exe', '-NoProfile', '-Command', 'git', 'push', 'origin', 'main'] }), 'git push origin main', base],
    ['R6 cmd /c argv', read('shell', { cmd: ['C:\\Windows\\System32\\cmd.exe', '/c', 'git push origin main'] }), 'git push origin main', base],
    ['R7 argv without a shell', read('shell', { command: ['git', 'push', '--force', 'x'] }), 'git push --force x', base],
    ['R8 relative workdir', read('exec_command', { cmd: 'git push', workdir: 'sub' }), 'git push', path.join(base, 'sub')],
    ['R8 tool cwd when there is no workdir', read('Bash', { command: 'git push', cwd: other }), 'git push', other],
    ['R9 both command and cmd', read('Bash', { command: 'git status', cmd: 'git push --force' }), 'git status\ngit push --force', base],
  ];
  for (const [name, call, text, folder] of rows) {
    assert.equal(call.isShell, true, name);
    assert.equal(call.text, text, name);
    assert.equal(call.folder, folder, name);
    assert.equal(call.unreadable, false, name);
    assert.equal(call.refusal(), '', name);
  }
  assert.deepEqual(read('Bash', { command: 'x', workdir: other, cwd: base }).folders, [other, base], 'every folder the call names');
  // No folder in the call: the session folder, else this process's folder.
  assert.equal(ShellCall.from({ tool_name: 'Bash', tool_input: { command: 'x' } }).folder, process.cwd());
});

test('argument lists keep their words: quoting reads back, and a shell wrapper hands over its script only', () => {
  assert.equal(argvText(['git', 'commit', '-m', "it's done"]), "git commit -m 'it''s done'");
  assert.equal(argvText(['git', '-C', 'C:\\work\\repo', 'push']), "git -C 'C:\\work\\repo' push");
  assert.equal(argvText(['git', 'commit', '-m', '']), "git commit -m ''");
  assert.equal(argvText(['bash', '-c', 'git push', 'argument']), 'git push', 'later words are the script\'s own arguments');
  assert.equal(argvText(['/bin/zsh', '-ic', 'git push']), 'git push');
  for (const options of [['-c', '-e'], ['-lc', '--']]) {
    assert.equal(argvText(['bash', ...options, 'git push origin HEAD:main']), 'git push origin HEAD:main');
  }
  for (const option of ['-c', '-Co', '-Comm', '-Command']) {
    assert.equal(argvText(['pwsh', '-NoProfile', option, 'git push']), 'git push', option);
  }
  for (const command of [['bash', '-c', '-e'], ['bash', '-c', '-o', 'pipefail', 'git push'],
    ['bash', '--rcfile', 'config', '-c', 'git push'], ['bash', '-c', '-e', '']]) {
    assert.equal(argvText(command), command.join(' '), 'an uncertain wrapper keeps every word');
  }
  assert.equal(argvText(['bash', '--login']), 'bash --login', 'no script option: the words themselves');
  assert.equal(argvText(['bash', 'script.sh', '-c', 'x']), 'bash script.sh -c x', 'a script file ends the options');
  assert.equal(argvText(['powershell', '-c']), 'powershell -c', 'a script option with no script');
});

test('shellPath reads the home folder, Git Bash drive paths and /tmp as the shell does, and leaves every other path to Node', () => {
  const { shellPath } = require('../scripts/toolkit-shell-call.cjs');
  const base = 'C:\\Users\\u\\work';
  const windows = { platform: 'win32', home: 'C:\\Users\\u', temp: 'C:\\Users\\u\\AppData\\Local\\Temp' };
  for (const [value, expected] of [
    ['~', 'C:\\Users\\u'],
    ['~/repo', 'C:\\Users\\u\\repo'],
    ['~\\repo\\sub', 'C:\\Users\\u\\repo\\sub'],
    ['~other/repo', 'C:\\Users\\u\\work\\~other\\repo'],
    ['/tmp', 'C:\\Users\\u\\AppData\\Local\\Temp'],
    ['/tmp/scratch', 'C:\\Users\\u\\AppData\\Local\\Temp\\scratch'],
    ['/tmpfiles/x', 'C:\\tmpfiles\\x'],
    ['$HOME/repo', 'C:\\Users\\u\\work\\$HOME\\repo'],
    ['/c/Users/u/repo', 'C:\\Users\\u\\repo'],
    ['/C/Users/u/repo/', 'C:\\Users\\u\\repo'],
    ['/d', 'D:\\'],
    ['/d/', 'D:\\'],
    ['/cygdrive/e/data', 'E:\\data'],
    ['/c/Users/u/../v', 'C:\\Users\\v'],
    ['C:/Users/u/repo', 'C:\\Users\\u\\repo'],
    ['sub', 'C:\\Users\\u\\work\\sub'],
    ['..\\other', 'C:\\Users\\u\\other'],
    ['/cd/x', 'C:\\cd\\x'],
  ]) assert.equal(shellPath(base, value, windows), expected, value);
  // Elsewhere /c and /tmp are real folders; ~ is still the home folder.
  assert.equal(shellPath('/home/u', '/c/Users', { platform: 'linux' }), path.resolve('/home/u', '/c/Users'));
  assert.equal(shellPath('/home/u', '/tmp/x', { platform: 'linux', temp: '/var/elsewhere' }), path.resolve('/tmp/x'));
  assert.equal(shellPath('/srv', '~/repo', { platform: 'linux', home: '/home/u' }), path.resolve('/home/u', 'repo'));
});

test('the shell tool list is the one the gate, the merge hold and the Codex hook use', () => {
  assert.deepEqual(SHELL_TOOL_NAMES, ['Bash', 'PowerShell', 'Monitor', 'exec_command', 'shell', 'local_shell']);
  for (const name of SHELL_TOOL_NAMES) assert.equal(ShellCall.isShellTool(name), true, name);
  for (const name of ['bash', 'write_stdin', 'apply_patch', 'Edit', '', undefined, 7]) assert.equal(ShellCall.isShellTool(name), false, String(name));
  assert.equal(ShellCall.from({ tool_name: 'Edit', tool_input: { command: 'git push' } }).isShell, false);
  assert.equal(ShellCall.from({ tool_name: 'Edit', tool_input: { command: 'git push' } }, { shell: true }).isShell, true, 'a caller that routed it as a shell call');
});

test('R10: an unreadable shell call is refused when its raw input could commit, push or touch a pull request', () => {
  const guarded = ['git push --force origin main', 'git commit -m x', 'gh pr create --fill', 'gh pr merge 5', 'gh api repos/o/r/pulls/5/merge', 'gh repo sync o/r'];
  const shapes = [
    text => ({ cmd: { script: text } }),
    text => ({ command: { argv: [text] } }),
    text => ({ command: ['git', 7, text] }),
    text => ({ cmd: text, workdir: { path: other } }),
    text => ({ script: text }),
    text => text,
  ];
  for (const shape of shapes) {
    for (const text of guarded) {
      const call = read('exec_command', shape(text));
      assert.equal(call.unreadable, true, JSON.stringify(shape(text)));
      assert.equal(call.refusal(), UNREADABLE, JSON.stringify(shape(text)));
    }
    const harmless = read('exec_command', shape('ls -la'));
    assert.equal(harmless.unreadable, true);
    assert.equal(harmless.refusal(), '', 'any other unreadable call runs');
  }
  // Tabs and continued lines still separate words for the screen.
  for (const text of ['git\tpush --force x', 'git \\\npush --force x', 'git `\r\npush x', 'gh pr\tmerge 5', 'gh pr \\\nmerge 5', 'gh pr ^\r\ncreate --fill']) {
    assert.equal(read('exec_command', { cmd: { script: text } }).refusal(), UNREADABLE, JSON.stringify(text));
  }
  // Deeper than the walk reads, the whole input is still screened.
  let deep = 'git push --force x';
  for (let depth = 0; depth < 40; depth += 1) deep = { inner: deep };
  assert.equal(read('exec_command', { cmd: deep }).refusal(), UNREADABLE, 'deeply nested');
  assert.equal(read('Bash', undefined).refusal(), '', 'no input at all has nothing to refuse');
  assert.equal(ShellCall.from({ tool_name: 'Edit', tool_input: { cmd: { x: 'git push' } } }).refusal(), '', 'only shell calls are judged');
  assert.match(UNREADABLE, /could not read this shell command, so it was refused\. Retry it; if this repeats, run `setup toolkit`\./);
});

test('hostile shell texts inside an unreadable shape are refused with the push in front of them', () => {
  const list = hostile.cases(hostile.FAMILIES, ['shell']);
  hostile.expectDefaultDeny(assert, text => read('exec_command', { cmd: { script: `git push origin main ${text}` } }).refusal() === '', list);
  hostile.expectDefaultDeny(assert, text => read('shell', { command: ['git', null, `${text}\ngit commit -m x`] }).refusal() === '', list);
});

test('C7: the governance gate refuses a Codex call whose run folder waits for its answer, under every shell shape', (t) => {
  const fs = require('node:fs');
  const gate = require('../scripts/toolkit-governance-gate.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-shell-call-gate-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const held = path.join(dir, 'held');
  const session = path.join(dir, 'session');
  for (const folder of [held, session]) fs.mkdirSync(folder);
  const registryOptions = { registryPath: path.join(dir, 'home', '.ai-agent-toolkit', 'user-state', 'repository-governance.v1.json'), testOnly: true };
  const stateReader = folder => (path.resolve(folder) === held ? { state: 'UNDECIDED', rule: 'R4', repository_id: 'synthetic-held' } : { state: 'DISABLED', rule: 'R1' });
  const decide = input => new gate.ToolGate({ registryOptions, stateReader }).decide(input);
  const rows = [
    ['R4', command => ({ tool_name: 'Bash', cwd: session, tool_input: { cmd: command, workdir: held } })],
    ['R5', command => ({ tool_name: 'exec_command', cwd: session, tool_input: { cmd: command, workdir: held } })],
    ['R6', command => ({ tool_name: 'shell', cwd: session, tool_input: { command: ['bash', '-lc', command], workdir: held } })],
    ['R7', command => ({ tool_name: 'shell', cwd: session, tool_input: { command: command.split(' '), workdir: held } })],
    ['R8', command => ({ tool_name: 'local_shell', cwd: dir, tool_input: { cmd: command, workdir: 'held' } })],
  ];
  if (process.platform === 'win32') {
    // A Git Bash drive path to the held folder, in cd, git -C, an absolute word and a Codex workdir.
    const drive = `/${held[0].toLowerCase()}${held.slice(2).replace(/\\/g, '/')}`;
    for (const input of [
      { tool_name: 'Bash', cwd: session, tool_input: { command: `cd ${drive} && git status` } },
      { tool_name: 'Bash', cwd: session, tool_input: { command: `git -C ${drive} status` } },
      { tool_name: 'Bash', cwd: session, tool_input: { command: `ls ${drive}` } },
      { tool_name: 'exec_command', cwd: session, tool_input: { cmd: 'git status', workdir: drive } },
    ]) assert.match(decide(input)?.deny || '', /works in a repository that is waiting for the user's governance answer/, JSON.stringify(input.tool_input));
  }
  for (const [row, shape] of rows) {
    assert.match(decide(shape('git status'))?.deny || '', /works in a repository that is waiting for the user's governance answer/, row);
    assert.equal(decide({ ...shape('git status'), tool_input: { ...shape('git status').tool_input, workdir: session } }), null, `${row}: a run folder that is not held`);
  }
});

test('reading a large argument list stays linear', () => {
  const result = hostile.timing(argv => ShellCall.from({ tool_name: 'shell', tool_input: { command: argv } }).text, size => Array.from({ length: size }, (_, index) => `word ${index}'`));
  assert.ok(result.ok, result.message);
});
