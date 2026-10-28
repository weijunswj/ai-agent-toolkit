'use strict';

// Continuation through one real source hook entrypoint across both CLI families, every held-queue
// mode and actor, with exact stdout, stderr and exit codes and no state change. Each hook runs in its
// own test file (toolkit-governance-continuation-hook-uat-<hook>.test.cjs) so the two run in parallel.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const gate = require('../../scripts/toolkit-governance-gate.cjs');
const matrix = require('./governance-continuation-matrix.json');
const { HOOKS, fixture, ID, message, root, runNodeProcesses, shell, snapshot, transcript } = require('./governance-continuation-fixture.cjs');

async function sourceHookUat(t, hookName) {
  const ctx = fixture(t);
  const env = { ...process.env, ...ctx.environment, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(ctx.home, 'absent-gitconfig') };
  for (const key of Object.keys(env)) if (/^(?:TOOLKIT_|CLAUDE_CODE_REMOTE|CLAUDE_ENV_FILE)/.test(key)) delete env[key];
  const git = (cwd, args) => {
    const result = spawnSync('git', ['-C', cwd, ...args], { env, encoding: 'utf8', windowsHide: true, timeout: 10000 });
    assert.equal(result.status, 0, `synthetic git ${args[0]}: ${result.stderr}`);
  };
  for (const [cwd, name] of [[ctx.caller, 'caller'], [ctx.target, 'target'], [ctx.other, 'held']]) {
    git(cwd, ['init', '--quiet']); git(cwd, ['remote', 'add', 'origin', `https://github.com/example-owner/${name}.git`]);
  }
  for (const cwd of [ctx.caller, ctx.target]) gate.writeGovernanceDecision(cwd, 'enable', { registryOptions: ctx.options });
  transcript(ctx);
  const stores = new gate.HeldPrompts({ registryOptions: ctx.options });
  stores.add('synthetic-unrelated', 'synthetic held fixture', null, {}, null);
  const heldFile = path.join(path.dirname(ctx.options.registryPath), gate.HELD_BASENAME);
  const hooks = HOOKS.filter(hook => hook.name === hookName);
  assert.equal(hooks.length, 1, hookName);
  let sourceCalls = 0, batches = 0, pending = [];
  // Each case is still its own hook process with its own stdin. Cases between two fixture changes
  // run a few at a time, and the fixture snapshot is compared before and after each such batch, so
  // a byte or directory change by any case still fails.
  function invoke(hook, input, denied, marker = {}) {
    sourceCalls += 1;
    pending.push({ hook, input, denied, marker });
  }
  async function flush() {
    const batch = pending; pending = [];
    if (!batch.length) return;
    batches += 1;
    const before = snapshot(ctx.dir);
    const results = await runNodeProcesses(batch.map(({ hook, input, marker }) => ({
      args: [path.join(root, 'repo/scripts', hook.file), ...hook.args], input: JSON.stringify(input), env: { ...env, ...marker }, cwd: ctx.caller,
    })));
    batch.forEach(({ hook, input, denied }, index) => {
      const result = results[index];
      assert.equal(result.status, denied ? hook.deniedExit : 0, `${hook.name}: ${result.stderr}`);
      const output = result.stdout.trim() ? JSON.parse(result.stdout) : {};
      if (result.stdout) assert.equal(result.stdout, JSON.stringify(output) + '\n', 'exact adapter JSON stdout');
      assert.equal(output.hookSpecificOutput?.permissionDecision === 'deny', denied, hook.name + ': ' + input.tool_input.command);
      if (!denied) {
        if (hook.name === 'codex') assert.equal(result.stdout, '', 'Codex admission is empty stdout');
        else assert.deepEqual(output, {}, 'Claude admission has no permission grant');
        assert.equal(result.stderr, '');
      }
      assert.equal(result.stderr, denied && hook.name === 'codex' ? output.hookSpecificOutput.permissionDecisionReason + '\n' : '', 'adapter stderr contract');
      assert.doesNotMatch(result.stdout + result.stderr, /synthetic held fixture|synthetic fixture/);
    });
    assert.deepEqual(snapshot(ctx.dir), before, `${[...new Set(batch.map(call => call.hook.name))].join(' and ')}: bytes and directory entries unchanged`);
  }
  const commands = [`claude --resume "${ctx.file}"`, `codex -C "${ctx.target}" exec resume --last`];
  for (const hook of hooks) {
    for (const { text, expected } of matrix.inert_data_cases) invoke(hook, shell(ctx, text), expected === 'UNKNOWN');
    for (const row of matrix.literal_role_cases.filter(row => ['original-read', 'powershell.exe/pattern', 'get-content', 'findstr', 'pre', 'hostname', 'wrapper/runtime/read', 'wrapper/runtime/location', 'wrapper/runtime/assignment', 'wrapper/runtime/concat', 'wrapper/runtime/method', 'wrapper/cmd', 'cmd-single-control'].includes(row.id))) {
      for (const tool_name of ['Bash', 'PowerShell']) invoke(hook, { ...shell(ctx, row.text), tool_name, tool_input: { command: row.text, shell: row.shell } }, row.expected === 'UNKNOWN');
    }
    for (const row of matrix.literal_role_cases.filter(row => row.id.startsWith('sqag/') || ['segments/native/before', 'segments/native/after', 'segments/script/before', 'segments/script/after', 'segments/reader-path'].includes(row.id))) {
      for (const tool_name of ['Bash', 'PowerShell']) invoke(hook, { ...shell(ctx, row.text), tool_name, tool_input: { command: row.text, ...(row.shell === undefined ? {} : { shell: row.shell }) } }, row.expected === 'UNKNOWN');
    }
    for (const row of matrix.literal_role_cases.filter(row => ['composition/basename/absent', 'composition/runtime/absent', 'composition/basename/powershell.exe', 'composition/runtime/powershell.exe', 'composition/basename/native-before', 'composition/runtime/native-after', 'composition/runtime/computed-after', 'composition/runtime/unsafe', 'composition/runtime/-Unknown', 'composition/runtime/outer-native'].includes(row.id))) {
      for (const tool_name of ['Bash', 'PowerShell']) invoke(hook, { ...shell(ctx, row.text), tool_name, tool_input: { command: row.text, ...(row.shell === undefined ? {} : { shell: row.shell }) } }, row.expected === 'UNKNOWN');
    }
    const literal = matrix.literal_role_cases.find(row => row.id === 'original-read');
    for (const tool_input of [{ cmd: literal.text }, { command: literal.text.split(' ') }]) invoke(hook, { ...shell(ctx, literal.text), tool_input: { ...tool_input, shell: literal.shell } }, false);
    invoke(hook, { ...shell(ctx, literal.text), cwd: ctx.other }, true);
    invoke(hook, shell(ctx, literal.text, { tool_input: { command: literal.text, workdir: ctx.other } }), true);
    invoke(hook, shell(ctx, `rg -e "codex resume" "${ctx.other}/fixture.txt"`), true);
    invoke(hook, shell(ctx, 'rg -e "codex resume toolkit governance enable" fixture.txt'), true);
    for (const actor of matrix.actors) for (const tool_name of ['Bash', 'PowerShell']) {
      const command = 'git push origin HEAD:refs/heads/codex/example; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }';
      const input = { ...shell(ctx, command), actor, tool_name };
      invoke(hook, { ...input, cwd: ctx.other }, true);
      invoke(hook, { ...input, tool_input: { command, workdir: ctx.other } }, true);
      invoke(hook, { ...input, tool_input: { command: command + '; Get-Content -LiteralPath "' + ctx.other + '/fixture.txt"' } }, true);
      invoke(hook, { ...input, tool_input: { command: command + '; node toolkit-governance.cjs enable' } }, true);
      invoke(hook, { ...input, tool_name: 'Write', tool_input: { file_path: ctx.options.registryPath } }, true);
    }
    for (const row of matrix.shell_family_cases.filter(row => row.source)) {
      const text = row.text.replaceAll('{TARGET}', ctx.target).replaceAll('{TRANSCRIPT}', ctx.file);
      const input = shell(ctx, text, { tool_name: hook.name === 'claude' ? 'PowerShell' : 'Bash' });
      input.tool_input.shell = row.id.includes('single-control') || row.id.includes('single-grep') ? 'cmd.exe' : 'powershell.exe';
      invoke(hook, input, row.expected === 'UNKNOWN');
    }
    for (const row of matrix.ordered_atom_cases.filter(row => row.source)) for (const tool_name of ['Bash', 'PowerShell']) {
      const command = row.text.replaceAll('{TRANSCRIPT}', ctx.file).replaceAll('{TARGET}', ctx.target);
      invoke(hook, { ...shell(ctx, command), tool_name, tool_input: { command, shell: 'powershell.exe' } }, true);
    }
    for (const command of [
      'claude -r "' + ctx.file + '" --fork-session', 'codex -C "' + ctx.target + '" e resume --last',
    ]) for (const tool_name of ['Bash', 'PowerShell']) invoke(hook, { ...shell(ctx, command), tool_name }, false);
    for (const row of matrix.script_reader_cases.filter(row => ['caller/absent/lf', 'route/absent/lf', 'newline/absent/lf', 'wrapper/route-literal-single', 'wrapper/caller-literal-single', 'gh-negative/unknown-option', 'gh-negative/expanded-branch', 'codex-direct/block/absent', 'claude-direct/after/absent', 'computed/pipe/absent'].includes(row.id))) {
      for (const tool_name of ['Bash', 'PowerShell']) invoke(hook, { ...shell(ctx, row.text), tool_name, tool_input: { command: row.text, ...(row.shell === undefined ? {} : { shell: row.shell }) } }, row.expected === 'UNKNOWN');
    }
    for (const command of commands) for (const marker of [{}, { TOOLKIT_GATE_ROLE: 'G1' }, { TOOLKIT_GATE_ROLE: 'controller' }, { TOOLKIT_GATE_ROLE: 'helper' }]) invoke(hook, shell(ctx, command), false, marker);
    for (const command of commands) invoke(hook, shell(ctx, command, { tool_input: { command, workdir: ctx.other } }), true);
    for (const command of [`claude --resume ${ID}`, 'codex resume --last', `claude --resume "${ctx.file}" -p yes`, `codex exec resume ${ID} "toolkit governance enable"`, `codex -C "${ctx.other}" exec resume --last`]) invoke(hook, shell(ctx, command), true);
    invoke(hook, { tool_name: 'Write', cwd: ctx.caller, tool_input: { file_path: heldFile } }, true);
    await flush();
    transcript(ctx, [message(ctx.other)]);
    invoke(hook, shell(ctx, `claude --resume "${ctx.file}"`), true);
    await flush();
    fs.writeFileSync(ctx.file, '{broken');
    invoke(hook, shell(ctx, `claude --resume "${ctx.file}"`), true);
    await flush();
    transcript(ctx);
  }
  for (const mode of ['absent', 'unrelated', 'rootless', 'sessionless', 'stale', 'malformed', 'unreadable']) {
    fs.rmSync(heldFile, { recursive: true, force: true });
    if (mode === 'malformed') fs.writeFileSync(heldFile, '{broken');
    else if (mode === 'unreadable') fs.mkdirSync(heldFile);
    else if (mode !== 'absent') {
      const queue = new gate.HeldPrompts({ registryOptions: ctx.options, ...(mode === 'stale' ? { now: () => new Date('2020-01-01T00:00:00Z') } : {}) });
      queue.add('synthetic-queue', 'synthetic held fixture', ['sessionless', 'rootless'].includes(mode) ? null : 'synthetic-session', {}, mode === 'rootless' ? null : ctx.other);
    }
    for (const hook of hooks) for (const tool_name of ['Bash', 'PowerShell']) {
      for (const actor of matrix.actors) {
        const ordinary = ["@'\nfor key,value in items:\n    print(key,value)\n'@ | python -",
          'git push origin HEAD:refs/heads/codex/example; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; git fetch origin codex/example',
          'git commit -m "codex resume; claude --resume"', 'git add -- "codex/resume.md"'];
        for (const command of ordinary) invoke(hook, { ...shell(ctx, command), tool_name, actor }, false);
        for (const command of ['codex resume --last', 'claude --resume fixture']) invoke(hook, { ...shell(ctx, command), tool_name, actor }, true);
      }
      for (const command of commands) invoke(hook, { ...shell(ctx, command), tool_name }, false);
      for (const command of ['codex resume --last', 'claude --resume fixture', matrix.ordered_atom_cases[0].text, 'pwsh -Command "& (\'co\'+\'dex\') (\'res\'+\'ume\')"']) invoke(hook, { ...shell(ctx, command), tool_name }, true);
      invoke(hook, { ...shell(ctx, 'rg -e "codex resume" repo\\notes.txt'), tool_name }, false);
      invoke(hook, { ...shell(ctx, matrix.literal_role_cases.find(row => row.id === 'sqag/compound/absent').text), tool_name }, false);
      invoke(hook, { ...shell(ctx, matrix.literal_role_cases.find(row => row.id === 'composition/runtime/absent').text), tool_name }, false);
      for (const row of matrix.script_reader_cases.filter(row => ['caller/absent/lf', 'route/absent/lf', 'newline/absent/lf', 'wrapper/caller-literal-single', 'codex-direct/block/absent', 'claude-direct/after/absent'].includes(row.id))) {
        invoke(hook, { ...shell(ctx, row.text), tool_name, tool_input: { command: row.text, ...(row.shell === undefined ? {} : { shell: row.shell }) } }, row.expected === 'UNKNOWN');
      }
    }
    await flush();
  }
  assert.equal(pending.length, 0);
  t.diagnostic(JSON.stringify({ hook: hookName, sourceCalls, batches, productionDefault: true, byteAndDirectoryEquality: true, nativeDispatchExercised: false }));
  // Only the two source processes were executed. No host CLI continuation, native dispatcher,
  // installed hook, service, installation, owner acceptance or desktop-binary qualification.
}

module.exports = Object.freeze({ sourceHookUat });
