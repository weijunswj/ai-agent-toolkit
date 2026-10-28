'use strict';

// Host words used as data: commit text, issue bodies, search patterns, paths, branch names and
// Toolkit setup options. A fixed data-command schema must prove every command in the input, and
// only then may the classifier answer NOT_CONTINUATION where it would otherwise refuse.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ContinuationResolver, parse } = require('../scripts/toolkit-governance-continuation.cjs');
const gate = require('../scripts/toolkit-governance-gate.cjs');

const ENVELOPES = Object.freeze({
  omitted: ['Bash', {}],
  'powershell tool': ['PowerShell', {}],
  powershell: ['Bash', { shell: 'powershell' }],
  bash: ['Bash', { shell: 'bash' }],
  cmd: ['Bash', { shell: 'cmd' }],
});
const ALL = Object.keys(ENVELOPES);
const POSIX_AND_PS = ['omitted', 'powershell tool', 'powershell', 'bash'];
const PS_ONLY = ['powershell tool', 'powershell'];

function fixture(t) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'continuation-data-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, 'home');
  fs.mkdirSync(path.join(dir, 'caller'), { recursive: true });
  return { dir, caller: path.join(dir, 'caller'), options: { registryPath: path.join(home, '.ai-agent-toolkit', 'user-state', 'repository-governance.v1.json'), testOnly: true },
    environment: { USERPROFILE: home, HOME: home, CLAUDE_CONFIG_DIR: path.join(home, '.claude'), CODEX_HOME: path.join(home, '.codex') } };
}
function input(ctx, text, envelope) {
  const [tool_name, extra] = ENVELOPES[envelope];
  return { tool_name, cwd: ctx.caller, session_id: 'fixture-run', tool_input: { command: text, ...extra } };
}
function snapshot(dir) {
  const result = {};
  (function walk(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) { result[path.relative(dir, file)] = 'directory'; walk(file); }
      else result[path.relative(dir, file)] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    }
  })(dir);
  return result;
}

// Each row names the envelopes where its host words are proved data. Every other envelope keeps
// the earlier refusal: cmd always, and the other shells where the syntax means something else.
const DATA = [
  // Reported failures.
  ["$body=@'\nNotes for Claude and Codex: Codex resumes later. It's fine.\n'@; gh issue comment 421 --body $body", PS_ONLY],
  ['gh issue comment 421 --body "Claude checked codex resume at $(git rev-parse --short HEAD)"', POSIX_AND_PS],
  ["gh issue comment 421 --body 'Claude resumes; Codex stopped'", POSIX_AND_PS],
  ['grep -rn "claude -r" repo/docs', POSIX_AND_PS],
  ['node "$env:USERPROFILE/.ai-agent-toolkit/managed/ai-agent-toolkit/repo/scripts/setup-toolkit.cjs" --execute --host codex', POSIX_AND_PS],
  ['git worktree remove "$env:USERPROFILE\\t\\codex-542"; git worktree prune', POSIX_AND_PS],
  ["cat > f.md <<'EOF'\nClaude and Codex: codex resume --last\nEOF", ['omitted', 'bash']],
  // Everyday false refusals: branch names, folders, variable names, apostrophes, API edits.
  ['git -C C:/Users/example/GitHub/repo push -u origin claude/project-thread-x', POSIX_AND_PS],
  ['git -C "C:/example.test/codex/resume" push origin HEAD:refs/heads/codex/example', POSIX_AND_PS],
  ['Get-ChildItem "$env:LOCALAPPDATA\\Claude-Data\\logs" -Recurse | Select-Object -First 5', POSIX_AND_PS],
  ['Get-ChildItem "$env:USERPROFILE\\.claude\\projects" | Sort-Object LastWriteTime -Descending | Select-Object -First 3', POSIX_AND_PS],
  ['$codexHome = "$env:USERPROFILE\\.codex"; Get-ChildItem $codexHome -Recurse', PS_ONLY],
  ['Remove-Item -Recurse -Force C:\\Users\\example\\AppData\\Local\\Temp\\CodexAgentTemp\\run1', POSIX_AND_PS],
  ['gh pr comment 12 --body "Claude\'s fix: Codex doesn\'t resume here"', POSIX_AND_PS],
  ["gh api -X PATCH repos/example/example/issues/1 -f body='Claude resumed; Codex fork done'", POSIX_AND_PS],
  ['git commit -m "Keep claude --resume out of the docs" -m "Codex fork notes"', ALL],
  ["@'\nClaude resume notes\n'@ | Set-Content -Path notes.md", PS_ONLY],
  ['rg -n -e "codex resume" repo/docs | head -n 5', ALL],
  ["rg -n -e 'codex resume' repo/docs; git log --oneline -n 3 -- 'docs/claude notes.md'", ['powershell tool', 'powershell', 'bash']],
];

// Each of these still runs, or may run, a host or a program the schemas do not cover.
const RETAINED = [
  'claude $flag', 'codex $mode --last', 'gh issue comment 1 --body x; codex resume', "gh alias set x '!codex resume'",
  "bash <<'EOF'\ncodex resume\nEOF", "$b=@'\ncodex resume\n'@; iex $b", 'Start-Process codex -ArgumentList $a',
  'gh issue comment 1 --body "$(codex resume --last)"', 'find . -exec codex resume \\;', "gh issue comment 1 --body 'codex resume",
  "gh issue comment 1 --body 'codex resume \u2014'", "grep -h 'codex resume' notes.md | sh", "cat > r.sh <<'EOF'\ncodex resume\nEOF\nbash r.sh",
  "cat > .gitconfig <<'EOF'\n[core]\npager = codex resume\nEOF", "cat > notes.md <<EOF\n$(codex resume)\nEOF",
  "$function:gh = 'codex resume'; gh issue view 1", "Set-Content function:gh 'codex resume'; gh issue view 1",
  "$o='--upload-pack=codex resume'; git fetch $o", "$env:GIT_PAGER='codex resume'; git log", "GIT_PAGER='codex resume'; git log",
  "GIT_PAGER='codex resume' git log", 'node -e "require(\'child_process\').execSync(\'codex resume\')"', 'git push ext::codex resume', "r='ext::codex resume'; git push \"$r\" main", 'git fetch "$(cat remote.txt)" codex-resume',
  // One argument to bash, but Windows PowerShell and cmd can split it into an option.
  ["git fetch origin 'a \"--upload-pack=codex resume\" b'", ['omitted', 'powershell tool', 'powershell', 'cmd']],
  ['git fetch "C:\\example test\\" "x --upload-pack=codex${IFS}resume"', ['omitted', 'powershell tool', 'powershell', 'cmd']],
  // Unquoted expansions split into extra arguments, so staged text could become an option.
  "x='a --upload-pack=codex${IFS}resume'; git fetch origin $x", "cat > notes.md <<'EOF'\n --upload-pack=codex${IFS}resume\nEOF\ngit fetch origin x$(cat notes.md)",
  "@'\n--upload-pack=codex resume\n'@ | Set-Content notes.md; git fetch origin $(Get-Content notes.md)",
  'git log `codex resume`', 'gh issue comment 1 --body "${x:-$(codex resume)}"',
  'gh issue comment 1 --body x & codex resume', "gh issue comment 1 --body 'x' | codex resume",
  // Data to bash and PowerShell, but an omitted shell may be cmd, which runs or expands these.
  ["gh issue comment 1 --body 'x & codex resume'", ['omitted', 'cmd']], ['gh issue comment 1 --body "%x% codex resume"', ['omitted', 'cmd']], "echo 'codex resume' > run.ps1", "echo 'codex resume' > ../notes.md",
  "node ./evil/setup-toolkit.cjs.ps1 --host codex; codex resume", 'node $x/setup-toolkit.cjs --host codex resume', 'node --require ./x.cjs setup-toolkit.cjs --host codex resume',
  "rg --pre codex resume", "rg -e 'codex resume' --pre=x .", 'git -c alias.x=!codex x resume', "Start-Process codex resume",
  "$x = codex resume", "& gh issue comment 1 --body 'codex resume'", "gh issue comment 1 --body @('codex', 'resume')",
  ['git fetch origin,--upload-pack=codex resume', ['omitted', 'powershell tool', 'powershell', 'cmd']],"git log -- $(codex resume)", "Get-Content (codex resume)",
  ...['Start-Process', 'saps', 'start', 'call'].map(wrapper => wrapper + ' /.claude -r'),
  'echo /.claude -r | git -c alias.x=!sh x',
];

test('host words proved as data are ordinary only on the shells that read them as data', t => {
  const ctx = fixture(t);
  let checks = 0;
  for (const [text, envelopes] of DATA) for (const envelope of ALL) {
    const expected = envelopes.includes(envelope) ? 'NOT_CONTINUATION' : 'UNKNOWN';
    assert.equal(parse(text, input(ctx, text, envelope)).status, expected, envelope + ': ' + text); checks += 1;
  }
  for (const row of RETAINED) {
    const [text, envelopes] = typeof row === 'string' ? [row, ALL] : row;
    for (const envelope of envelopes) {
      assert.notEqual(parse(text, input(ctx, text, envelope)).status, 'NOT_CONTINUATION', envelope + ': ' + text); checks += 1;
    }
  }
  t.diagnostic(JSON.stringify({ dataChecks: checks }));
});

test('production ToolGate keeps every raw guard for host words used as data', t => {
  const ctx = fixture(t), before = snapshot(ctx.dir);
  const held = { state: 'UNDECIDED', rule: 'R4', repository_id: 'synthetic-held' }, safe = { state: 'DISABLED', rule: 'R1' };
  const make = stateReader => new gate.ToolGate({ registryOptions: ctx.options, environment: ctx.environment, stateReader,
    continuationResolver: new ContinuationResolver({ environment: ctx.environment, spawn() { throw new Error('UNEXPECTED_METADATA'); } }) });
  let checks = 0;
  for (const [text, envelopes] of DATA) for (const envelope of envelopes) {
    assert.equal(make(() => safe).decide(input(ctx, text, envelope))?.deny, undefined, envelope + ': ' + text);
    assert.ok(make(() => held).decide(input(ctx, text, envelope))?.deny, envelope + ': ' + text);
    checks += 2;
  }
  for (const row of RETAINED) {
    const text = typeof row === 'string' ? row : row[0];
    assert.ok(make(() => safe).decide(input(ctx, text, 'omitted'))?.deny, text);
  }
  assert.deepEqual(snapshot(ctx.dir), before);
  t.diagnostic(JSON.stringify({ gateChecks: checks }));
});

test('unclosed parameter-expansion runs stay linear', () => {
  const text = '${'.repeat(16380) + ' ls ~/.claude/x';
  const start = process.hrtime.bigint();
  parse(text, { tool_name: 'Bash', cwd: os.tmpdir(), tool_input: { command: text } });
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  assert.ok(ms < 400, `classified a 32 KB unclosed run in ${ms.toFixed(0)} ms`);
});
