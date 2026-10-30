'use strict';

// Closure matrix for the continuation guard's candidate reader: one table row for each shape in
// the plan's closure matrix, with refused and allowed controls, under every shell reading that may
// run the text. A command is refused only when a place where a shell runs a program could run
// Claude or Codex with a resume or fork selector; arguments are data. Then the commands the owner
// and agents had refused, the real hook entry points (which set the host), the raw guards that
// still run before an allowed command, and the bounds on nesting and input length.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { ContinuationResolver, LIMITS, parse } = require('../scripts/toolkit-governance-continuation.cjs');
const gate = require('../scripts/toolkit-governance-gate.cjs');
const { HOOKS, ID, fixture, root, runNodeProcesses, shell, snapshot } = require('./support/governance-continuation-fixture.cjs');

// The shell readings: the hook entry point sets the host, never the payload. Claude Code's Bash
// tool runs bash and its PowerShell tool PowerShell; Codex, Monitor and an unknown host name no
// shell, so bash, PowerShell or the first line under cmd may run the text.
const ENVELOPES = Object.freeze({
  'claude bash': [{ tool_name: 'Bash' }, 'claude'],
  'claude powershell': [{ tool_name: 'PowerShell' }, 'claude'],
  'claude monitor': [{ tool_name: 'Monitor' }, 'claude'],
  codex: [{ tool_name: 'Bash' }, 'codex'],
  omitted: [{ tool_name: 'Bash' }, null],
  bash: [{ tool_name: 'Bash', shell: 'bash' }, null],
  powershell: [{ tool_name: 'Bash', shell: 'powershell' }, null],
  cmd: [{ tool_name: 'Bash', shell: 'cmd' }, null],
});
const N = 'NOT_CONTINUATION', U = 'UNKNOWN', V = 'VERIFIED';
const all = status => Object.fromEntries(Object.keys(ENVELOPES).map(name => [name, status]));
const but = (status, changes) => ({ ...all(status), ...changes });
// Readings where only bash, only PowerShell or only cmd can run the text. Where another shell's
// reading also refuses text it would not run (`iex` under bash), the result errs towards refusal.
const POSIX_ONLY = ['claude bash', 'bash'], POWERSHELL_ONLY = ['claude powershell', 'powershell'], COMMON = ['claude monitor', 'codex', 'omitted'];
const only = (names, status, rest) => ({ ...all(rest), ...Object.fromEntries(names.map(name => [name, status])) });
function envelope(ctx, text, name) {
  const [{ tool_name, shell: selected }, host] = ENVELOPES[name];
  return { input: { tool_name, cwd: ctx.caller, session_id: 'fixture-run', tool_input: { command: text, ...(selected ? { shell: selected } : {}) } }, host };
}

const CODEX_WORKTREE = 'C:/Users/example/.codex/worktrees/a1b2/example-app';
const SSH = 'ssh deploy@203.0.113.10';
// The owner's server comparison as Codex sent it: a Python script in a PowerShell here-string,
// piped into Codex's bundled Python, which runs a read-only docker inspect over ssh.
const COMPARISON = [
  "git -C 'C:/Users/example/GitHub/example-app' rev-parse --show-toplevel",
  "@'",
  'import json,shlex,subprocess',
  "code=r'''import json,subprocess",
  "def read(cid):",
  " r=subprocess.run(['/usr/bin/docker','inspect',cid],capture_output=True,timeout=20)",
  " return json.loads(r.stdout)[0] if r.returncode==0 else None",
  "a=read('old');b=read('new')",
  "keys=sorted(k for k in set(a['HostConfig'])|set(b['HostConfig']) if a['HostConfig'].get(k)!=b['HostConfig'].get(k))",
  "print(json.dumps({'changed_host_config_keys':keys,'non_sensitive':{k:{'old':a['HostConfig'].get(k)} for k in keys}}))'''",
  "r=subprocess.run(['C:/Windows/System32/OpenSSH/ssh.exe','-T','-o','BatchMode=yes','example-vps','python3 -I -S -B -c '+shlex.quote(code)],capture_output=True,text=True,timeout=35)",
  'print(r.stdout)',
  "'@ | & 'C:/Users/example/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe' -B -",
].join('\n');
// A read-only PowerShell probe of the kind Codex runs at chat start.
const CHAT_START = "$probe = @'\nimport json,pathlib\np=pathlib.Path('C:/Users/example/.codex/sessions/2026/10/29/rollout-x.jsonl')\nprint(sum(1 for _ in p.open()))\n'@\n"
  + "$probe | & 'C:/Users/example/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe' -\n"
  + "Get-ChildItem \"$env:USERPROFILE\\.codex\\plugins\" -Recurse -Filter version.json -ErrorAction SilentlyContinue | ForEach-Object { \"$($_.FullName) :: \" + (Get-Content $_.FullName -Raw | ConvertFrom-Json).version }";
const CLAUDE_DATA = 'C:/Users/example/AppData/Local/Claude-Data/claude_x/rpm';

// [closure matrix row, text, expected status per shell reading]
const MATRIX = [
  // 1-2. The two verifiable forms; the target check follows (commands test).
  [2, 'codex exec resume --last', all(V)], [2, 'codex e resume --last', all(V)],
  // 3. Unverifiable resume or fork.
  [3, 'claude -c', all(U)], [3, 'claude -r', all(U)], [3, 'claude --continue', all(U)], [3, 'claude --resume ' + ID, all(U)],
  [3, 'claude --session-id ' + ID, all(U)], [3, 'claude -p --fork-session x', all(U)], [3, 'codex resume', all(U)],
  [3, 'codex fork abc', all(U)], [3, 'codex resume --last', all(U)], [3, 'cd /c/work/repo && claude -r', all(U)],
  [3, 'echo start; codex resume --last', but(U, { cmd: N })], [3, 'git status && claude -c "go on"', all(U)],
  // 4. Wrapped launches: wrappers, shells with a script, the call operator and script blocks.
  [4, 'env claude -c', all(U)], [4, 'nohup codex resume --last &', all(U)], [4, 'xargs -n1 claude -c', all(U)], [4, 'timeout 5 codex fork x', all(U)],
  [4, "Start-Process claude -ArgumentList '--resume'", all(U)], [4, "Start-Process -FilePath codex -ArgumentList 'resume','--last'", but(U, { cmd: N })],
  [4, 'cmd /c claude -c', all(U)], [4, 'cmd /c "codex resume"', all(U)], [4, "bash -lc 'claude -c'", but(U, { cmd: N })], [4, "sh -c 'cd x && codex resume'", but(U, { cmd: N })],
  [4, 'pwsh -Command "codex resume"', all(U)], [4, 'powershell -NoProfile -c "claude --continue"', all(U)],
  [4, "& 'C:/Users/example/.local/bin/claude.exe' -c", but(U, { cmd: N })], [4, 'npx @anthropic-ai/claude-code --resume x', all(U)],
  [4, 'find . -name x -exec codex resume {} ;', all(U)], [4, 'wsl codex resume', all(U)],
  [4, 'Get-ChildItem ~/.codex | ForEach-Object { codex resume }', only([...POWERSHELL_ONLY, ...COMMON], U, N)],
  [4, 'Invoke-Command -ScriptBlock { claude -c }', only([...POWERSHELL_ONLY, ...COMMON], U, N)],
  [4, 'f() { codex resume; }; f', but(U, { cmd: N })], [4, 'echo "$(codex resume)"', but(U, { cmd: N })],
  // 5. Split spellings of the command word, read as each shell joins them.
  [5, 'c"o"dex resume --last', all(U)], [5, "cl'au'de -c", but(U, { cmd: N })], [5, 'cl\\aude -c', only([...POSIX_ONLY, ...COMMON], U, N)],
  [5, 'cl^aude -c', only(['cmd', ...COMMON], U, N)], [5, 'co`dex resume', but(U, { cmd: N })],
  [5, '~/.claude/local/cl*de -r', only([...POSIX_ONLY, ...POWERSHELL_ONLY, ...COMMON], U, N)], [5, '~/.claude -r', all(U)],
  // 6. Dynamic command words with host letters, in an assignment or in the word itself.
  [6, 'iex "claude -c"', all(U)], [6, 'eval "codex resume"', all(U)],
  [6, '& ("cla"+"ude") -c', only([...POWERSHELL_ONLY, ...COMMON], U, N)], [6, "$h='codex'; & $h resume", but(U, { cmd: N })],
  [6, 'x=co; "${x}dex" resume', only([...POSIX_ONLY, ...COMMON], U, N)], [6, 'H=claude; $H --continue', only([...POSIX_ONLY, ...COMMON], U, N)],
  [6, '& ("co".Replace("z","")+"dex") ("re".Replace("z","")+"sume") --last', only([...POWERSHELL_ONLY, ...COMMON], U, N)],
  [6, '& ("c{0}dex" -f "o") ("res{0}me" -f "u")', only([...POWERSHELL_ONLY, ...COMMON], U, N)],
  [6, '$(echo claude) -c', only([...POSIX_ONLY, ...COMMON], U, N)], [6, 'echo /x/.claude -r | iex', all(U)],
  // 7. Interpreter scripts with a literal host and selector.
  [7, "node -e \"require('child_process').spawn('claude',['-c'])\"", all(U)], [7, "python -c \"import subprocess; subprocess.run(['codex','resume'])\"", all(U)],
  [7, "python - <<'EOF'\nimport subprocess\nsubprocess.run(['codex', 'resume', '--last'])\nEOF", but(U, { 'claude powershell': N, powershell: N })],
  [7, "@'\nimport subprocess\nsubprocess.run(['claude', '-c'])\n'@ | python -", but(U, { cmd: N })],
  [7, "[Diagnostics.Process]::Start('codex', 'resume --last')", but(U, { cmd: N })],
  // 8. An interpreter script that builds the name is out of this layer's reach (informational):
  // the resumed session's own repository hold still applies.
  [8, "python -c \"n='cla'+'ude'; import subprocess; subprocess.run([n,'-c'])\"", all(N)], [8, '& ([char[]](99,111,100,101,120) -join "") resume', all(N)],
  // 9-10. Help, version and new sessions are not resumes.
  [9, 'codex resume --help', all(N)], [9, "codex 'resume' --help", all(N)], [9, 'claude --resume --help', all(N)], [9, 'claude --version', all(N)],
  [10, 'claude -p "summarise the repo"', all(N)], [10, 'codex exec "fix the resume parser"', all(N)], [10, 'codex -c model=x exec "summarise"', all(N)],
  // 11. Host-named folders as data, with pipes, chains, variables and loops.
  [11, `cd ${CODEX_WORKTREE} && ${SSH} "docker compose config" | diff - docker-compose.yml`, all(N)],
  [11, `${SSH} "docker compose config" | diff - ${CODEX_WORKTREE}/docker-compose.yml`, all(N)],
  [11, `${SSH} "docker compose config" | Out-File $env:TEMP\\r.yml; git diff --no-index ${CODEX_WORKTREE}\\docker-compose.yml $env:TEMP\\r.yml`, all(N)],
  [11, `$remote = ${SSH} "cat /srv/example-app/.env.example"; $local = Get-Content "${CODEX_WORKTREE}/.env.example"; Compare-Object $local $remote`, all(N)],
  [11, `ls "${CLAUDE_DATA}" ; echo done`, all(N)], [11, `cd ${CLAUDE_DATA} && ls -r`, all(N)],
  [11, 'S="/c/Users/example/AppData/Local/Temp/claude/x"; mkdir -p "$S" && git archive origin/main | tar -x -C "$S"', all(N)],
  [11, 'Get-ChildItem "$env:USERPROFILE\\.codex\\plugins" -Recurse | ForEach-Object { $_.FullName }', all(N)],
  [11, 'Get-Content ~/.claude/x.json -Raw | ConvertFrom-Json', all(N)], [11, 'cat ~/.codex/sessions/x.jsonl | grep resume | head', all(N)],
  [11, 'node scripts/toolkit-codex-helper-hook.cjs --resume', all(N)], [11, 'git checkout -b claude/project-thread-x origin/main', all(N)],
  [11, 'Get-Content C:/x/.codex/notes.py -Raw | python -', all(N)],
  // 12. Host words and selectors as data: patterns, messages, heredoc and here-string bodies.
  [12, 'git log --oneline | grep fork', all(N)], [12, 'grep -rn "resume" docs', all(N)], [12, 'git log --grep=resume', all(N)],
  [12, "rg -n 'codex resume' docs", all(N)], [12, 'echo "claude --resume x"', all(N)], [12, 'git commit -m "codex resume; claude --resume"', all(N)],
  [12, "cat <<'EOF' > notes.txt\ncodex resume --last\nEOF", only(['cmd'], U, N)], [12, "@'\ncodex resume\n'@ | Out-File notes.txt", only(['cmd'], U, N)],
  [12, 'Example-Run "codex resume"', all(N)], [12, "echo 'fixture & codex resume & echo fixture'", only(['cmd', ...COMMON], U, N)],
  // 13. Loops and flags near host-named paths.
  [13, 'for k in a b; do echo $k; done; ls ~/.codex', all(N)], [13, 'rm -rf .tmp/claude-scratch', all(N)], [13, 'Get-ChildItem -Force $env:USERPROFILE\\.claude', all(N)],
  [13, `for s in app db; do ${SSH} "docker inspect example-$s --format '{{json .HostConfig.RestartPolicy}}'"; done`, all(N)],
  // 14. ssh remote commands are data, even when they name a host.
  [14, `${SSH} "docker compose -f /srv/example-app/docker-compose.yml config"`, all(N)], [14, `${SSH} "codex resume --last"`, all(N)],
  // 15. Unreadable text falls back to the letters check; encoded PowerShell is decoded and read.
  [15, "echo 'unclosed codex resume", but(U, { cmd: N })], [15, 'echo fine', all(N)],
  [15, 'pwsh -EncodedCommand ' + Buffer.from('codex resume', 'utf16le').toString('base64'), all(U)],
  [15, 'pwsh -EncodedCommand ' + Buffer.from('Get-ChildItem', 'utf16le').toString('base64'), all(N)],
  // 16. Programs whose option values or piped input run commands.
  [16, 'git -c alias.x="!codex resume" x', all(U)], [16, 'git -c core.sshCommand="claude -c" fetch', all(U)], [16, 'rg --pre=codex pattern resume', all(U)],
  [16, 'echo /.claude -r | cut -c3- | sh', all(U)], [16, 'git -c user.name=x commit -m "fix codex resume parsing"', all(N)],
  [16, 'git -c alias.x=!codex x resume', all(U)], [16, "o='--upload-pack=codex resume'; git fetch origin $o", but(U, { cmd: N })],
  // 17. A wrapper that starts a shell with one argument string (review finding 1).
  [17, 'Start-Process pwsh -ArgumentList "-NoExit -Command codex resume --last"', all(U)],
  [17, 'Start-Process powershell -ArgumentList "-NoExit -Command claude --continue"', all(U)],
  [17, "Start-Process bash -ArgumentList '-c \"codex resume\"'", but(U, { cmd: N })], [17, 'Start-Process ~/.claude -r', all(U)],
  [17, 'Start-Process pwsh -ArgumentList "-NoExit -Command Get-ChildItem ~/.codex"', all(N)],
  // 18. A command or selector held in a variable assigned earlier (review finding 2).
  [18, '$c = "claude --continue"; Invoke-Expression $c', only([...POWERSHELL_ONLY, ...COMMON], U, N)], [18, '$b = @\'\ncodex resume\n\'@; iex $b', only([...POWERSHELL_ONLY, ...COMMON, 'cmd'], U, N)],
  [18, 'c="codex resume"; eval "$c"', but(U, { cmd: N })], [18, 'c="codex resume"; $c', only([...POSIX_ONLY, ...COMMON], U, N)],
  [18, 'c="codex resume"; bash -c "$c"', but(U, { cmd: N })], [18, 'M=resume; codex "$M"', but(U, { cmd: N })],
  [18, 'M=status; codex "$M"', all(N)], [18, 'c="ls -la"; eval "$c"', all(N)],
  // 19. A script written and then run in the same command (review finding 3).
  [19, "cat > r.sh <<'EOF'\ncodex resume\nEOF\nbash r.sh", but(U, { 'claude powershell': N, powershell: N })],
  [19, "Set-Content r.ps1 'claude --continue'; pwsh -File r.ps1", but(U, { cmd: N })], [19, "echo 'claude -c' > r.sh && sh r.sh", all(U)],
  [19, "cat > notes.txt <<'EOF'\ncodex resume\nEOF\nbash build.sh", only(['cmd'], U, N)],
  // 20. cmd keeps ';' inside one command (review finding 6).
  [20, "gh api repos/x/y/issues/1/comments -f body='Claude resumed; Codex fork done'", all(N)], [20, "git commit -m 'Fix x; codex resume refused'", all(N)],
  // 21. Shell functions that build the name (review finding 4).
  [21, 'd(){ printf d; }; ume(){ printf ume; }; co$(d)ex res$(ume)', but(U, { cmd: N })],
  // Restored from the earlier refuse lists: functions defined in PowerShell, command variables
  // and remotes held in variables (review finding 4).
  [21, "$function:gh = 'codex resume'; gh issue view 1", only([...POWERSHELL_ONLY, ...COMMON], U, N)],
  [21, "Set-Content function:gh 'codex resume'; gh issue view 1", but(U, { cmd: N })],
  [21, "GIT_PAGER='codex resume' git log", but(U, { cmd: N })], [21, "$env:GIT_PAGER='claude --continue'; git log", but(U, { cmd: N })],
  [21, "r='ext::codex resume'; git push \"$r\" main", but(U, { cmd: N })], [21, "x='a --upload-pack=codex${IFS}resume'; git fetch origin $x", but(U, { cmd: N })],
  [21, "GIT_PAGER='less -R' git log", all(N)],
];

test('closure matrix: every shape of the plan, under every shell reading', t => {
  const ctx = fixture(t), before = snapshot(ctx.dir);
  const rows = new Set();
  let checks = 0;
  for (const [row, text, expected] of MATRIX) {
    rows.add(row);
    for (const name of Object.keys(ENVELOPES)) {
      const { input, host } = envelope(ctx, text, name);
      assert.equal(parse(text, input, { host }).status, expected[name], `row ${row} ${name}: ${text}`);
      // The resolver carries the same host. A selector proves no target here, so nothing is spawned.
      if (expected[name] !== V) {
        const resolver = new ContinuationResolver({ environment: ctx.environment, host, spawn() { assert.fail('no metadata acquisition'); } });
        assert.equal(resolver.resolve(text, input).status, expected[name], `resolver row ${row} ${name}: ${text}`);
      }
      checks += 1;
    }
  }
  assert.deepEqual([...rows].sort((a, b) => a - b), [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
  assert.deepEqual(snapshot(ctx.dir), before);
  t.diagnostic(JSON.stringify({ closureChecks: checks }));
});

test('the commands the owner and agents had refused pass in the shape each host sends them', t => {
  const ctx = fixture(t);
  const make = stateReader => new gate.ToolGate({ registryOptions: ctx.options, environment: ctx.environment, stateReader, host: 'codex' });
  const held = { state: 'UNDECIDED', rule: 'R4', repository_id: 'synthetic-held' }, safe = { state: 'DISABLED', rule: 'R1' };
  const PWSH = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
  for (const text of [COMPARISON, CHAT_START, `cd ${CODEX_WORKTREE} && ${SSH} "docker compose config" | diff - docker-compose.yml`]) {
    for (const input of [
      { tool_name: 'Bash', cwd: ctx.caller, tool_input: { command: text } },
      { tool_name: 'exec_command', cwd: ctx.caller, tool_input: { cmd: text, workdir: ctx.caller } },
      { tool_name: 'shell', cwd: ctx.caller, tool_input: { command: [PWSH, '-Command', text], workdir: ctx.caller } },
      { tool_name: 'PowerShell', cwd: ctx.caller, tool_input: { command: text } },
    ]) {
      assert.equal(parse(text, input, { host: 'codex' }).status, N, `${input.tool_name}: ${text.slice(0, 60)}`);
      assert.equal(make(() => safe).decide(input)?.deny, undefined, input.tool_name);
      assert.ok(make(() => held).decide(input)?.deny, input.tool_name + ': the repository guard still runs first');
    }
  }
  // The same comparison with a real launch added on its own line is still refused.
  const launch = `${COMPARISON}\ncodex resume --last`;
  assert.equal(parse(launch, { tool_name: 'Bash', cwd: ctx.caller, tool_input: { command: launch } }, { host: 'codex' }).status, U);
});

test('a refusal names what it found and the forms that work', t => {
  const ctx = fixture(t);
  const decide = command => new gate.ToolGate({ registryOptions: ctx.options, environment: ctx.environment, stateReader: () => ({ state: 'DISABLED', rule: 'R1' }), host: 'claude' })
    .decide({ tool_name: 'Bash', cwd: ctx.caller, tool_input: { command } })?.deny || '';
  const reason = decide('git status && claude -c');
  assert.match(reason, /^Toolkit: this command could resume or fork a Claude or Codex session \(found: claude -c\)/);
  assert.match(reason, /`claude --resume <full path to the session's \.jsonl file>` or `codex exec resume --last`/);
  assert.match(reason, /Never act as the user/);
  assert.match(decide('Start-Process codex -ArgumentList resume'), /found: codex resume/);
  assert.equal(decide('ls ~/.claude && grep -rn resume docs'), '');
});

test('nested command substitution stops at a fixed depth and never throws, up to the length limit', () => {
  const tail = 'cat .claude/x';
  const widest = Math.floor((LIMITS.command - 'grep -c x '.length - tail.length) / 3);
  for (const depth of [1000, 5000, widest]) {
    for (const [open, close] of [['$(', ')'], ['"$(', ')"']]) {
      const text = 'grep -c x ' + open.repeat(depth) + tail + close.repeat(depth);
      if (text.length > LIMITS.command) continue;
      for (const name of Object.keys(ENVELOPES)) {
        const { input, host } = envelope({ caller: root }, text, name);
        // cmd has no command substitution, so it reads the parentheses as plain text.
        assert.equal(parse(text, input, { host }).status, name === 'cmd' ? N : U, `${depth} ${open} ${name}`);
      }
    }
  }
  assert.equal(parse('echo $(echo $(echo ok))', { tool_name: 'Bash', cwd: root, tool_input: { command: 'echo $(echo $(echo ok))' } }, { host: 'claude' }).status, N);
  // A smaller stack than the default must not reach its limit either.
  const probe = `const { parse } = require(${JSON.stringify(path.join(root, 'repo/scripts/toolkit-governance-continuation.cjs'))});
const text = 'grep -c x ' + '$('.repeat(1000) + 'cat .claude/x' + ')'.repeat(1000);
process.stdout.write(parse(text, { tool_name: 'Bash', cwd: process.cwd(), tool_input: { command: text } }).status);`;
  const result = spawnSync(process.execPath, ['--stack-size=400', '-e', probe], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, U);
});

test('inputs at the length limit are read in linear time', () => {
  const time = text => {
    const start = process.hrtime.bigint();
    parse(text, { tool_name: 'Bash', cwd: root, tool_input: { command: text } });
    return Number(process.hrtime.bigint() - start) / 1e6;
  };
  const shapes = [
    size => '${'.repeat(size / 2) + ' ls ~/.claude/x', size => '"'.repeat(size), size => "'a' ".repeat(size / 4) + 'codex',
    size => '$('.repeat(size / 2), size => '{ '.repeat(size / 2), size => 'env '.repeat(size / 4) + 'claude -c',
    size => '@(\n'.repeat(size / 3), size => 'a | '.repeat(size / 4) + 'sh', size => ('x=' + 'c'.repeat(64) + '; ').repeat(size / 70) + '$x -c',
    size => 'env '.repeat(size / 4) + 'ls', size => 'pwsh '.repeat(size / 5) + 'ls', size => 'sudo env nohup timeout 5 '.repeat(size / 25) + 'ls',
  ];
  for (const shape of shapes) {
    const ms = time(shape(LIMITS.command));
    assert.ok(ms < 1000, `classified ${shape(16).slice(0, 16)}... at the length limit in ${ms.toFixed(0)} ms`);
  }
});

test('the source hooks set their own host: Claude Bash reads as bash, Codex and Monitor keep every common shell', async t => {
  const ctx = fixture(t);
  const env = { ...process.env, ...ctx.environment, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(ctx.home, 'absent-gitconfig') };
  for (const key of Object.keys(env)) if (/^(?:TOOLKIT_|CLAUDE_CODE_REMOTE|CLAUDE_ENV_FILE|NODE_OPTIONS)/.test(key)) delete env[key];
  for (const args of [['init', '--quiet'], ['remote', 'add', 'origin', 'https://github.com/example-owner/caller.git']]) {
    const result = spawnSync('git', ['-c', 'core.fsmonitor=false', '-C', ctx.caller, ...args], { env, encoding: 'utf8', windowsHide: true, timeout: 10000 });
    assert.equal(result.status, 0, 'synthetic fixture git: ' + result.stderr);
  }
  gate.writeGovernanceDecision(ctx.caller, 'enable', { registryOptions: ctx.options });
  const POSIX_TEXT = 'x=co; "${x}dex" resume';
  // [text, tool, refused by the Claude hook, refused by the Codex hook]
  const cases = [
    [COMPARISON, 'Bash', false, false], [CHAT_START, 'PowerShell', false, false], [CHAT_START, 'Bash', false, false],
    [POSIX_TEXT, 'Bash', true, true], [POSIX_TEXT, 'PowerShell', false, false], [POSIX_TEXT, 'Monitor', true, true],
    ['codex resume', 'Bash', true, true], ['claude --resume ' + ID, 'Bash', true, true],
  ];
  const calls = [];
  for (const hook of HOOKS) for (const [command, tool_name, claudeDenies, codexDenies] of cases) {
    calls.push({ hook, denied: hook.name === 'claude' ? claudeDenies : codexDenies, label: hook.name + '/' + tool_name + ': ' + command.slice(0, 60),
      input: { ...shell(ctx, command), tool_name, tool_input: { command } } });
  }
  const before = snapshot(ctx.dir);
  const results = await runNodeProcesses(calls.map(({ hook, input }) => ({
    args: [path.join(root, 'repo/scripts', hook.file), ...hook.args], input: JSON.stringify(input), env, cwd: ctx.caller,
  })));
  calls.forEach(({ hook, denied, label }, index) => {
    const result = results[index];
    assert.equal(result.status, denied ? hook.deniedExit : 0, label + ': exit');
    const output = result.stdout.trim() ? JSON.parse(result.stdout) : {};
    assert.equal(output.hookSpecificOutput?.permissionDecision === 'deny', denied, label);
    if (denied) assert.match(output.hookSpecificOutput.permissionDecisionReason, /could resume or fork a Claude or Codex session/, label);
  });
  assert.deepEqual(snapshot(ctx.dir), before);
});

test('allowed commands still meet every raw guard, without reading a held queue or acquiring metadata', t => {
  const ctx = fixture(t), before = snapshot(ctx.dir);
  const held = { state: 'UNDECIDED', rule: 'R4', repository_id: 'synthetic-held' }, safe = { state: 'DISABLED', rule: 'R1' };
  const allowed = [COMPARISON, CHAT_START, `cd ${CODEX_WORKTREE} && ${SSH} "docker compose config" | diff - docker-compose.yml`,
    'git commit -m "codex resume; claude --resume"', 'rg -e "codex resume" fixture.txt', 'for k in a b; do echo $k; done; ls ~/.codex'];
  const originals = {}; let queueReads = 0, spawns = 0, checks = 0;
  // Throw on queue reads rather than inferring zero access solely from equal bytes after the call.
  for (const name of ['readFileSync', 'readdirSync', 'statSync', 'lstatSync', 'existsSync']) {
    originals[name] = fs[name];
    fs[name] = (file, ...args) => {
      if (String(file).includes(gate.HELD_BASENAME)) { queueReads += 1; throw new Error('SYNTHETIC_QUEUE_ACCESS'); }
      return originals[name](file, ...args);
    };
  }
  try {
    for (const command of allowed) for (const tool_name of ['Bash', 'PowerShell']) {
      const input = { ...shell(ctx, command), tool_name, tool_input: { cmd: command } };
      const make = stateReader => new gate.ToolGate({ registryOptions: ctx.options, environment: ctx.environment, stateReader,
        continuationResolver: new ContinuationResolver({ environment: ctx.environment, spawn() { spawns += 1; throw new Error('UNEXPECTED_METADATA'); } }) });
      const check = (stateReader, value, denied, reason) => { assert.equal(Boolean(make(stateReader).decide(value)?.deny), denied, `${reason}: ${command.slice(0, 50)}`); checks += 1; };
      check(() => safe, input, false, 'ordinary');
      check(() => held, input, true, 'held current');
      check(() => ({ ...held, rule: 'ERROR', error_code: 'SYNTHETIC' }), input, true, 'unreadable current');
      check(cwd => path.resolve(cwd) === ctx.other ? held : safe, { ...input, tool_input: { ...input.tool_input, workdir: ctx.other } }, true, 'held workdir');
      check(cwd => path.resolve(cwd).startsWith(ctx.other) ? held : safe,
        { ...input, tool_input: { ...input.tool_input, cmd: command + '\nGet-Content -LiteralPath "' + ctx.other + '/fixture.txt"' } }, true, 'held raw path');
      check(() => safe, { ...input, tool_input: { ...input.tool_input, cmd: command + '\nnode toolkit-governance.cjs enable' } }, true, 'owner answer');
    }
  } finally { for (const name of Object.keys(originals)) fs[name] = originals[name]; }
  assert.equal(checks, allowed.length * 2 * 6); assert.equal(queueReads, 0); assert.equal(spawns, 0);
  assert.deepEqual(snapshot(ctx.dir), before);
  t.diagnostic(JSON.stringify({ rawGuardChecks: checks, queueReads, metadataSpawns: spawns }));
});
