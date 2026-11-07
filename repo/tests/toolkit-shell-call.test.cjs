'use strict';

const closureReader = require('../scripts/toolkit-shell-call.cjs');
require('node:test')('executable closure reader separates scripts from data without changing generic words', () => {
  const assert = require('node:assert/strict');
  for (const command of ['echo "gh issue close 1"', 'grep -rn "gh pr create" docs', "cat <<'EOF'\ngh issue close later\nEOF", "Write-Output @'\ngh pr edit later\n'@", 'for x in a b; do echo "gh pr edit $x"; done']) assert.equal(closureReader.closureWriteCandidate({ tool_name:'Bash',tool_input:{command} }), false, command);
  for (const command of ['bash -c "gh issue close 1"', "bash <<'EOF'\ngh issue close 1\nEOF", 'for x in a b; do gh issue close 1; done', '& { gh pr edit 7 --body Safe }']) assert.equal(closureReader.closureWriteCandidate({ tool_name:'Bash',tool_input:{command} }), true, command);
  assert.equal(closureReader.executableCommands('git push origin feature && gh pr create --title T --body B')[1].movesTarget, false);
  assert.equal(closureReader.executableCommands('cd another; gh pr edit 7 --body B')[1].movesTarget, true);
  for (const prefix of ['export GH_REPO=other.test/app', 'unset GH_REPO', "eval 'cd another'", "eval 'GH_REPO=other.test/app'"]) assert.equal(closureReader.executableCommands(prefix + '; gh pr edit 7 --body B').at(-1).movesTarget, true, prefix);
  assert.equal(closureReader.executableCommands("eval 'echo GH_REPO=example.test/app'; gh pr edit 7 --body B").at(-1).movesTarget, false);
  assert.equal(closureReader.executableCommands('NOTE=GH_REPO; gh pr create --title T --body B').at(-1).movesTarget, false);
  assert.equal(closureReader.closureWriteCandidate({tool_name:'Bash',tool_input:{command:"gh pr create --title 'Closes #1' --body '--help'"}}), true);
  assert.equal(closureReader.closureWriteCandidate({tool_name:'Bash',tool_input:{command:'gh pr create --help'}}), false);
  for (const command of ['echo { gh pr edit later }', 'Write-Output {\n gh pr edit later\n}', 'Write-Output { echo { gh pr edit later } }']) assert.equal(closureReader.closureWriteCandidate({tool_name:'PowerShell',tool_input:{command}}), false, command);
  assert.equal(closureReader.closureWriteCandidate({tool_name:'Bash',tool_input:{command:'# an unmatched { in a comment\ngh issue close 1'}}), true);
});
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

const { SHELL_TOOL_NAMES, UNREADABLE, ShellCall, argvText, plainGitLine } = require('../scripts/toolkit-shell-call.cjs');
const hostile = require('./support/hostile-inputs.cjs');
const SPELLINGS = [
  'gh -R toolkit-test-fixture/fixture issue close 1', 'gh --repo toolkit-test-fixture/fixture issue close 1',
  'gh issue -R toolkit-test-fixture/fixture close 1', 'gh issue --repo=toolkit-test-fixture/fixture close 1',
  'gh.exe issue close 1', 'C:/tools/gh.exe issue close 1', 'gh pr new --title x',
  'gh -R toolkit-test-fixture/fixture pr new --title x', 'gh pr -R toolkit-test-fixture/fixture edit 7 --body x',
  'gh --repo toolkit-test-fixture/fixture pr create --title x --body y', 'GH   ISSUE   CLOSE 1',
];
const CONTROLS = ['gh issue list', 'gh issue view 5', 'gh issue view 5 --json closedAt,state',
  'gh issue list --state closed', 'gh pr view 7', 'gh pr list --state closed', 'gh pr checks 7',
  'gh pr diff 7', 'gh pr view 7 --json mergeable,mergedAt', 'gh auth status', 'gh run list',
  'gh repo view', 'rg -n closing docs', 'echo issue closed', 'git status'];

test('AT7: M3 readable call shapes preserve closure decisions across Codex shell names', () => {
  const { IssueClosureGuard } = require('../../skills/github-program-reconciler/scripts/issue-closure.cjs');
  const { FakeGitHub } = require('./toolkit-programme-fake-github.cjs');
  const github = new FakeGitHub({ repository: 'example.test/app' });
  github.addIssue(9001); github.addIssue(9002, { parent: 9001 });
  const guard = new IssueClosureGuard({ repository: 'example.test/app', transport: github });
  const closure = require('../scripts/toolkit-issue-closure.cjs');
  const close = 'gh issue close 9001 -R example.test/app';
  const cases = [
    ['git status', false], ['gh pr view 7', false], ['echo "gh issue close 9001"', false], ['git log --grep=push', false],
    [close, true], ['gh issue close 9002 -R example.test/app', true],
    ['gh pr create --title T --body "Closes #9001"', true], ['gh pr create --title T --body "Refs #9001"', true],
    // The merge hold refuses this, asserted by CLOSURE.m3-merge-tools-shapes.
    ['gh pr merge 7', false], ['gh api repos/example.test/app/issues/9001 -X PATCH -f state=closed', true],
    ['git commit -m "Co-Authored-By: Example <a@example.test>"', false], ['git push origin main', false], ['git push origin side', false],
  ];
  // Candidate means inspect, not refuse: leaf closures and Refs writes are permitted by the hook.
  for (const tool_name of ['Bash', 'exec_command', 'shell', 'local_shell', 'PowerShell']) {
    for (const [command, candidate] of cases) {
      for (const tool_input of [{ command }, { cmd: command }, { command, workdir: process.cwd() }, { command: [tool_name === 'PowerShell' ? 'pwsh' : 'bash', '-c', command] }]) {
        assert.equal(closureReader.closureWriteCandidate({ tool_name, tool_input }, { host: 'codex' }), candidate, `${tool_name}: ${command}`);
        const guarded = command.includes('issue close 9001') && !command.startsWith('echo') || command.includes('Closes #9001') || command.startsWith('gh api');
        const withRepo = { ...tool_input };
        // Explicit identity keeps this decision table offline, including the PR text cases.
        if (command.startsWith('gh pr create')) {
          if (typeof withRepo.command === 'string') withRepo.command += ' -R example.test/app';
          else if (typeof withRepo.cmd === 'string') withRepo.cmd += ' -R example.test/app';
          else withRepo.command = [...withRepo.command.slice(0, 2), withRepo.command[2] + ' -R example.test/app'];
        }
        assert.equal(Boolean(closure.issueClosureDecision({ tool_name, tool_input: withRepo }, { host: 'codex', guard })?.deny), guarded, `${tool_name}: closure decision for ${command}`);
      }
    }
  }
});

test('AT7b: M3 rows 7, 9, 10 and 11 read the same under every Codex shell name and input shape', () => {
  const work = os.tmpdir();
  for (const command of ['gh pr merge 5 --merge', 'git commit -m x -m "Co-Authored-By: Claude <noreply@anthropic.com>"',
    'git push origin HEAD:main', 'git push --force origin feature', 'git push origin feature']) {
    for (const tool_name of ['Bash', 'exec_command', 'shell', 'local_shell', 'PowerShell']) {
      for (const tool_input of [{ command }, { cmd: command }, { command, workdir: work },
        { command: [tool_name === 'PowerShell' ? 'pwsh' : 'bash', '-c', command] }]) {
        const call = ShellCall.from({ tool_name, cwd: work, tool_input });
        assert.equal(call.text, command);
        assert.equal(call.folder, work);
      }
    }
  }
});

test('AT8: Codex Bash gets the PowerShell alternate reading without changing Claude Bash', () => {
  const command = String.raw`echo "a\" ; gh issue close 9001 ; echo \"b"`;
  const input = { tool_name: 'Bash', tool_input: { command } };
  assert.throws(() => closureReader.closureCommands(input, { host: 'codex' }), /shell quoting/);
  assert.equal(closureReader.closureWriteCandidate(input, { host: 'claude' }), false);
  assert.equal(closureReader.closureWriteCandidate({ ...input, tool_input: { command, shell: 'bash' } }, { host: 'codex' }), false, 'a named POSIX shell is unambiguous');
  const issue = require('../scripts/toolkit-issue-closure.cjs');
  const deny = issue.issueClosureDecision(input, { host: 'codex' }).deny;
  assert.equal(deny, 'Toolkit: The shell quoting around this GitHub write can be read two ways, so it was refused. Run the GitHub write as its own command, without backslash-escaped quotes around it.');
  assert.doesNotMatch(deny, /Toolkit: Toolkit|explicit repository, PR or issue number/);
});

test('AT9: alternate reading retains ordinary escaped quotes, reads and Refs text', () => {
  for (const command of [String.raw`echo "a\"b"`, 'gh pr view 7', String.raw`gh pr create --title T --body "Refs #9001 \"quoted\""`]) {
    assert.doesNotThrow(() => closureReader.closureCommands({ tool_name: 'Bash', tool_input: { command } }, { host: 'codex' }), command);
  }
});

test('AT11: unreadable shapes with issue close refuse; harmless unreadable shapes pass', () => {
  const shapes = s => [{ command: { a: s } }, { command: [s, 7] }, { command: 7, hint: s }, { hint: s }, s];
  for (const tool_name of ['Bash', 'exec_command', 'shell', 'local_shell', 'PowerShell']) {
    for (const command of SPELLINGS) for (const tool_input of shapes(command)) {
      assert.ok(ShellCall.from({ tool_name, tool_input }).refusal(), `${tool_name}: ${command}`);
    }
    for (const command of CONTROLS) for (const tool_input of shapes(command)) {
      assert.equal(Boolean(ShellCall.from({ tool_name, tool_input }).refusal()), false, `${tool_name}: ${command}`);
    }
    for (const tool_input of [{ command: { a: 'gh issue close 9001' } }, { command: ['gh issue close 9001', 7] }, { command: 7, hint: 'gh issue close 9001' }, { hint: 'gh issue close 9001' }, 'gh issue close 9001']) {
      assert.equal(Boolean(ShellCall.from({ tool_name, tool_input }).refusal()), true, `${tool_name}: ${JSON.stringify(tool_input)}`);
    }
    for (const tool_input of [{ command: 7 }, { command: { a: 'git status' } }, null]) assert.equal(Boolean(ShellCall.from({ tool_name, tool_input }).refusal()), false);
  }
  // Shared hostile inputs supply line break and BOM variants of the guarded raw shape.
  for (const { id, text } of hostile.variants('gh issue close 9001\n')) assert.ok(ShellCall.from({ tool_name: 'Bash', tool_input: { command: { text } } }).refusal(), id);
});

test('AT20: the launcher and reader screens use the same wide gh patterns', () => {
  // Named failure: the broken launcher and unreadable reader missed global repo flags and pr new.
  const launcher = require('node:fs').readFileSync(path.join(__dirname, '../scripts/toolkit-codex-helper-hook.ps1'), 'utf8');
  const line = launcher.split(/\r?\n/).find(text => text.trimStart().startsWith('$guardedShell ='));
  const patterns = [...line.matchAll(/-match '([^']+)'/g)].map(match => match[1].replace(/\(\?s\)/g, '').replace(/\.\*/g, '[\\s\\S]*'));
  assert.ok(Array.isArray(closureReader.GUARDED_SCREEN));
  for (const pattern of closureReader.GUARDED_SCREEN) assert.ok(patterns.includes(pattern.source), pattern.source);
  for (const command of SPELLINGS) assert.ok(closureReader.GUARDED_SCREEN.some(pattern => pattern.test(command)), command);
});

test('AT12: shipped matchers cover nested shell calls but not the outer code cell or stdin', () => {
  const fs = require('node:fs');
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../../.codex-plugin/hooks/hooks.json'), 'utf8'));
  const matchers = manifest.hooks.PreToolUse.map(group => new RegExp(group.matcher));
  for (const tool of ['Bash', 'exec_command', 'shell', 'local_shell', 'PowerShell']) assert.ok(matchers.some(m => m.test(tool)), tool);
  for (const tool of ['exec', 'code_mode_exec', 'wait', 'write_stdin']) assert.equal(matchers.some(m => m.test(tool)), false, tool);
});
// Closure scans are linear (about the same time per character from 4K to 1M characters), but from
// 16K to 64K the per-character cost still steps up, so on a busy runner a 5ms sample at 16K grew past
// the 10x limit. Start at 16K, grow until the smaller sample takes 15ms, and keep the best of five.
const SCAN_TIMING = Object.freeze({ startSize: 16384, maxSize: 524288, minMs: 15, runs: 5 });

test('generic token values and offsets stay pinned while expansion follows quoting', () => {
  const source = "echo '$body' \"$body\" '\u0060literal\u0060' \\$body \"$ \"; gh pr edit 7";
  const commands = closureReader.shellCommands(source);
  assert.deepEqual(commands.map(({ words, offsets }) => ({ words, offsets })), [
    { words: ['echo','$body','$body','`literal`','\\$body','$ '], offsets: [0,5,13,21,33,40] },
    { words: ['gh','pr','edit','7'], offsets: [46,49,52,57] },
  ]);
  assert.deepEqual(commands[0].expanding, [false,false,true,false,false,false]);
  assert.equal(closureReader.wordText({ words:['__heredoc_999__'], expanding:[false] },0).unresolved,true);
});

test('closure commands read supported positions, wrapper chains and nested scripts', () => {
  const gh='gh issue close 1 -R example.test/app';
  for(const command of [`if ${gh}`,`while ${gh}`,`until ${gh}`,`elif ${gh}`,`! ${gh}`,`time -p ${gh}`,`sudo -u me nohup timeout -k 5 30 ${gh}`,`env -u X ${gh}`,`nice -n 5 ${gh}`,`echo 1 | xargs ${gh}`,`cmd /c ${gh}`,`powershell -Command ${gh}`,`powershell ${gh}`,`x="$(${gh})"`,'x=`'+gh+'`',`cd x && bash <<'EOF'\n${gh}\nEOF`,`cat <<'EOF' | bash\n${gh}\nEOF`,`f() { ${gh}; }`,`1 | % { ${gh} }`,`switch (1) { 1 { ${gh} } }`]) {
    assert.equal(closureReader.closureWriteCandidate({tool_name:'Bash',tool_input:{command}}),true,command);
  }
  assert.deepEqual(closureReader.executableCommands('bash -c "bash -c \'bash -c echo\'"',5),[]);
  assert.throws(()=>closureReader.executableCommands(gh,5),/bound exceeded/);
});

test('literal document text survives CRLF, tab-stripped heredocs and here-strings', () => {
  for(const command of ["gh pr edit 7 --body \"$(cat <<'EOF'\nRefs #1\nEOF\n)\"", "gh pr edit 7 --body \"$(cat <<-EOF\r\n\tRefs #1\r\n\tEOF\r\n)\"", "gh pr edit 7 --body @'\nRefs #1\n'@"]) {
    const read=closureReader.scriptCommands(command)[0];
    assert.equal(closureReader.wordText(read,read.words.indexOf('--body')+1).value,'Refs #1',command);
  }
  assert.equal(closureReader.closureWriteCandidate({tool_name:'Bash',tool_input:{command:'cat <<< "gh issue close later"'}}),false);
  assert.equal(closureReader.closureWriteCandidate({tool_name:'PowerShell',tool_input:{command:'echo "a`ngh issue close 1`n"'}}),false,'PowerShell backticks escape instead of substituting');
});

test('closure scanner stays bounded on missing documents, substitutions and braces', () => {
  for(const unit of ['a<<b ','<<a\n',"@'\n",'"$(', 'x{','{} ','`x ']) {
    const result=hostile.timing(text=>closureReader.scriptCommands(text),size=>unit.repeat(Math.ceil(size/unit.length)),SCAN_TIMING);
    assert.ok(result.ok,`${unit}: ${result.message}`);
  }
});

const base = path.resolve(os.tmpdir(), 'toolkit-shell-call-session');
const other = path.resolve(os.tmpdir(), 'toolkit-shell-call-other');
const read = (tool, toolInput, extra = {}) => ShellCall.from({ tool_name: tool, cwd: base, tool_input: toolInput, ...extra });

test('plain git lines are one git command with no substitutions or unquoted shell operators', () => {
  const allowed = [
    'git push origin feature', 'git push origin HEAD', 'git.exe push', '/usr/bin/git push',
    String.raw`"C:\Program Files\Git\bin\git.exe" push origin feature`,
    'git commit --allow-empty -m bash -m "Document -c git push handling"',
    'git commit -m "Refuse bash -c git push wrappers"',
    'git commit -m "literal ; & | ( ) { } %NAME%"', "git commit -m 'it''s quoted'",
    'git commit -m "line one\nline two"', String.raw`git commit -m "quoted \"bash\""`,
  ];
  const refused = [
    '', 'gitty push', '/usr/bin/notgit push', 'env git push', 'echo git push',
    'git status; git push', 'git status && git push', 'git push & echo ready',
    'git push | cat', '(git push)', '{git push}', 'git push\n', 'git push\r\n',
    'git push %NAME%', 'git push "unfinished', "git push 'unfinished",
    String.raw`git push \\; echo ready`, 'git push \\\norigin HEAD',
    ...['$(run)', '${VALUE}', '`run`', '<(run)', '>(run)'].flatMap(value => [
      `git push ${value}`, `git commit -m "${value}"`, `git commit -m '${value}'`,
    ]),
  ];
  for (const command of allowed) assert.equal(plainGitLine(command), true, command);
  for (const command of refused) assert.equal(plainGitLine(command), false, command);
  hostile.expectDefaultDeny(assert, plainGitLine, hostile.cases(hostile.FAMILIES, ['shell']));
  assert.equal(plainGitLine(read('shell', { command: ['bash', '-lc', 'git push origin work'] }).text), true, 'host wrapper is unwrapped first');
});

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

test('unknown executable positions mark guarded words hidden and keep data consumers inert', () => {
  const close='gh issue close 1 -R example.test/app';
  const hidden=[`$x = ${close}`,`$x=${close}`,`[string]$x += ${close}`,`stdbuf -oL ${close}`,`wsl bash -c '${close}'`,`$r = iex '${close}'`,`1 | Where-Object { ${close} }`,`W { ${close} }`];
  for(const command of hidden)for(const powershell of [false,true]) {
    const commands=closureReader.executableCommands(command,0,{powershell});
    assert.ok(commands.some(command=>command.hidden && closureReader.ghCommand(command.words)?.verb==='close'),command);
  }
  for(const program of ['echo','printf','Write-Output','Write-Host','grep','rg','Select-String','cat','Get-Content','git','command -v']) {
    assert.equal(closureReader.closureWriteCandidate({tool_name:'PowerShell',tool_input:{command:`$x = ${program} ${close}`}}),false,program);
  }
  for(const command of ["$x = 'gh issue close 1'",'node x "gh issue close 1"','gh pr view 7']) assert.equal(closureReader.closureWriteCandidate({tool_name:'PowerShell',tool_input:{command}}),false,command);
  hostile.expectDefaultDeny(assert,text=>{
    try{return !closureReader.closureWriteCandidate({tool_name:'PowerShell',tool_input:{command:`$x = ${close} ${text}`}});}catch{return false;}
  },hostile.cases(hostile.FAMILIES,['shell']));
});

test('closure shell quoting, braces, documents and script options retain the executable boundary',()=>{
  const close='gh issue close 1 -R example.test/app';
  assert.equal(closureReader.shellCommands('cd "C:\\x\\"; '+close,{powershell:true}).length,2);
  for(const command of [`echo {\n${close}`,`echo { ; ${close} ; }`,`foo { ; ${close} ; }`,`bash <<< '${close}'`,`bash <<<'${close}'`,`bash -ce '${close}'`,`bash -c -- '${close}'`,`bash -c -o pipefail '${close}'`,`cmd /c "gh issue ^\nclose 1 -R example.test/app"`]) assert.equal(closureReader.closureWriteCandidate({tool_name:'Bash',tool_input:{command}}),true,command);
  assert.throws(()=>closureReader.closureWriteCandidate({tool_name:'exec_command',tool_input:{cmd:'cd "C:\\x\\"; '+close}}),/shell quoting/);
  assert.equal(closureReader.scriptCommands('gh api repos/{owner}/{repo}/issues/1')[0].words.at(-1),'repos/{owner}/{repo}/issues/1');
  for(const marker of ["'PR-BODY'",'\\EOF']) {
    const end=marker==="'PR-BODY'"?'PR-BODY':'EOF';
    assert.equal(closureReader.closureWriteCandidate({tool_name:'Bash',tool_input:{command:`cat <<${marker}\n${close}\n${end}`}}),false);
  }
});

test('wrapper, hidden-position and document scans grow within their existing bound',()=>{
  for(const [unit,powershell,tail]of [['time ',false,''],['<<EOF\n',false,'\tEOF'],['x gh ',false,''],['$x = ',true,''],['$x=',true,''],['W { ',true,''],['command ',false,''],['x bash ',false,'']]) {
    const result=hostile.timing(text=>closureReader.scriptCommands(text,{powershell}),size=>unit.repeat(Math.ceil(size/unit.length))+tail,SCAN_TIMING);
    assert.ok(result.ok,`${unit}: ${result.message}`);
  }
});

test('attached gh words, variable commands and shell option spellings remain guarded on every shell', () => {
  const close = 'gh issue close 1 -R example.test/app';
  const commands = [
    `$sb={${close}}`, `?{${close}}`, `Where-Object{${close}}`, `Sort-Object{${close}}`,
    `Select-Object @{n='x';e={${close}}}`, `$h=@{a={${close}}}`, '$sb={gh pr create}',
    `$sb={gh api -X PATCH repos/example.test/app/issues/1 -f state=closed}`,
    `$r = if ($a) {${close}}`, `$r = try {${close}} catch {0}`, `1 | Where-Object {${close}}`,
    `Start-ThreadJob {${close}}`, `foo {${close}}`, `foo {gh api repos/example.test/app/issues/1} {${close}}`,
    `?{${close}`, `$x =${close}`, `$x +=${close}`, `$r =bash -c '${close}'`,
    `gh --% issue close 1`, `gh issue --% close 1`, `gh pr --% create --title T --body Safe`,
    'gh --% api -X PATCH repos/example.test/app/issues/1 -f state=closed',
    `pwsh -Command 'gh --% issue close 1'`, 'gh issue $v 1', 'gh $n close', 'gh @a', '& gh $a',
    'gh "$@"', 'gh "${a[@]}"', 'gh pr $v 7', 'function g { gh @args }; g issue close 1',
    'g() { gh "$@"; }; g issue close 1', 'stdbuf -oL gh $n close 1',
    `<# note #> ${close}`, `<# a\nb #> ${close}`, `gh pr view 7 <# x #>; ${close}`,
    `cmd /c"${close}"`, `pwsh /c '${close}'`, `pwsh --command '${close}'`,
    `pwsh -Command:'${close}'`, `pwsh -cwa '${close}'`, `stdbuf -oL pwsh --command '${close}'`,
    `env -iS '${close}'`, `env --split-string='${close}'`,
  ];
  for (const tool_name of ['PowerShell', 'Bash', 'exec_command']) for (const command of commands) {
    assert.equal(closureReader.closureWriteCandidate({tool_name,tool_input:{command}}), true, `${tool_name}: ${command}`);
  }
});

test('word-level controls preserve read commands, data owners and generic stop-parsing words', () => {
  const close = 'gh issue close 1 -R example.test/app';
  for (const tool_name of ['PowerShell','Bash','exec_command']) for (const command of [
    '$h=@{a=1}', '{a,b}', 'foo {a,b}', '$x = {gh pr view 7}', '$x={gh pr view 7}', '$h=@{a={gh pr view 7}}',
    `echo {${close}}`, `echo a={${close}}`, 'echo {gh pr view 7}', 'node x --name=gh issue close 1',
    'gh run list --limit $n', 'gh pr list --search $q', 'foo ${gh}', '<# note #> gh pr view 7',
    "echo '<# a #>'", 'gh --% pr view 7', 'gh --% pr list --assignee @me', 'echo --%',
    "pwsh /c 'gh pr view 7'", 'pwsh -ConfigurationName x -File y', "env -S 'gh pr view 7'",
    `Write-Warning ${close}`, `Write-Error ${close}`, `Write-Verbose ${close}`, `<# ${close} #> gh pr view 7`,
  ]) assert.equal(closureReader.closureWriteCandidate({tool_name,tool_input:{command}}), false, `${tool_name}: ${command}`);
  assert.ok(closureReader.shellCommands('gh --% issue close 1')[0].words.includes('--%'));
  assert.deepEqual(closureReader.scriptCommands('gh --% issue close 1')[0].words, ['gh','issue','close','1']);
  assert.ok(closureReader.scriptCommands("gh '--%' pr view 7")[0].words.includes('--%'));
  const attached = closureReader.scriptCommands('$x =gh pr view 7')[0];
  assert.equal(attached.words[0], 'gh'); assert.equal(attached.hidden, true);
  for (const command of ['gh api repos/{owner}/{repo}/pulls/7', 'gh --% api repos/{owner}/{repo}/pulls/7']) {
    assert.equal(closureReader.scriptCommands(command)[0].words.at(-1), 'repos/{owner}/{repo}/pulls/7');
  }
});

test('attached blocks, comments and stop-parsing scans retain the hostile input bound', () => {
  for (const [unit,powershell] of [['x {gh ',false],['a{gh} ',false],['<# ',true],['--% ',true],['$x =y ',true],['f { ',false]]) {
    const result = hostile.timing(text => {
      try { closureReader.scriptCommands(text,{powershell}); }
      catch (error) { assert.match(error.message,/bound exceeded/); }
    }, size => {
      const count = Math.ceil(size/unit.length);
      return unit.repeat(count) + (unit === 'f { ' ? '} '.repeat(count) : '');
    }, SCAN_TIMING);
    assert.ok(result.ok, `${unit}: ${result.message}`);
  }
});
