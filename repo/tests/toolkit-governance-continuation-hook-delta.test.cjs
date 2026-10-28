'use strict';

// Continuation hook deltas: the construction and sentinel cases through both source hooks with a
// queue trap, and the raw guards that run before any new evidence allowance.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { ContinuationResolver } = require('../scripts/toolkit-governance-continuation.cjs');
const gate = require('../scripts/toolkit-governance-gate.cjs');
const matrix = require('./support/governance-continuation-matrix.json');
const { fixture, root, runNodeProcesses, sentinelText, shell, snapshot } = require('./support/governance-continuation-fixture.cjs');

test('source-hook construction delta uses production defaults and preserves every queue mode', async t => {
  const model = matrix.evidence_boundary_model, trace = fixture(t);
  const preload = path.join(trace.dir, 'queue-trap.cjs');
  let traces = 0;
  fs.writeFileSync(preload, `'use strict';
const fs = require('node:fs'); let accesses = 0;
for (const name of ['readFileSync', 'readdirSync', 'statSync', 'lstatSync', 'existsSync']) {
  const original = fs[name]; fs[name] = function(file, ...args) {
    if (String(file).includes('held-prompts.v1.json')) { accesses += 1; throw Error('SYNTHETIC_QUEUE_ACCESS'); }
    return original.call(this, file, ...args);
  };
}
process.on('exit', () => fs.writeFileSync(process.env.SYNTHETIC_QUEUE_TRACE, JSON.stringify({ accesses })));
`);
  const hooks = [
    { name: 'claude', file: 'toolkit-governance-hook.cjs', args: ['--event', 'PreToolUse'], deniedExit: 0 },
    { name: 'codex', file: 'toolkit-codex-helper-hook.cjs', args: [], deniedExit: 2 },
  ];
  const stdin = body => "@'\n" + body + "\n'@ | python -";
  let sourceCalls = 0, deltaCalls = 0, smokeCalls = 0;
  for (const mode of ['absent', 'unrelated', 'rootless', 'sessionless', 'stale', 'malformed', 'unreadable']) {
    const ctx = fixture(t), env = { ...process.env, ...ctx.environment, GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: path.join(ctx.home, 'absent-gitconfig') };
    for (const key of Object.keys(env)) if (/^(?:TOOLKIT_|CLAUDE_CODE_REMOTE|CLAUDE_ENV_FILE|NODE_OPTIONS)/.test(key)) delete env[key];
    for (const [cwd, name] of [[ctx.caller, 'caller'], [ctx.other, 'held']]) {
      for (const args of [['init', '--quiet'], ['remote', 'add', 'origin', 'https://github.com/example-owner/' + name + '.git']]) {
        const result = spawnSync('git', ['-c', 'core.fsmonitor=false', '-C', cwd, ...args], { env, encoding: 'utf8', windowsHide: true, timeout: 10000 });
        assert.equal(result.status, 0, 'synthetic fixture git: ' + result.stderr);
      }
    }
    gate.writeGovernanceDecision(ctx.caller, 'enable', { registryOptions: ctx.options });
    const heldFile = path.join(path.dirname(ctx.options.registryPath), gate.HELD_BASENAME);
    if (mode === 'malformed') fs.writeFileSync(heldFile, '{broken');
    else if (mode === 'unreadable') fs.mkdirSync(heldFile);
    else if (mode !== 'absent') new gate.HeldPrompts({ registryOptions: ctx.options,
      ...(mode === 'stale' ? { now: () => new Date('2020-01-01T00:00:00Z') } : {}) })
      .add('synthetic-queue', 'synthetic held fixture', ['rootless', 'sessionless'].includes(mode) ? null : 'synthetic-session', {}, mode === 'rootless' ? null : ctx.other);
    // Each case is its own hook process with its own stdin and queue-trap file; the cases of one
    // mode run a few at a time, and the fixture snapshot is compared before and after them.
    const pending = [];
    function invoke(hook, tool_name, id, command, selected, expected) {
      const input = { ...shell(ctx, command), tool_name, tool_input: { command, ...(selected === null ? {} : { shell: selected }) } };
      pending.push({ hook, input, id, selected, expected, traceFile: path.join(trace.dir, 'queue-trace-' + (traces += 1) + '.json') });
    }
    for (const hook of hooks) for (const tool_name of ['Bash', 'PowerShell']) {
      for (const [id, command, expected] of [
        ['binding', stdin('for key,value in items:\n    print(key,value)'), 'NOT_CONTINUATION'],
        ['git', 'git push origin HEAD:refs/heads/codex/example; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; git fetch origin codex/example', 'NOT_CONTINUATION'],
        ['explicit', model.confirmed_constructions[0][1], 'UNKNOWN'],
        ['implicit', model.construction_siblings.find(row => row[0] === 'awk-valid-one-argument')[1], 'UNKNOWN'],
      ]) { invoke(hook, tool_name, id, command, null, expected); smokeCalls += 1; }
      if (mode !== 'absent') continue;
      for (const [id, text] of model.confirmed_constructions) for (const selected of model.shells) {
        invoke(hook, tool_name, id, text, selected, 'UNKNOWN'); deltaCalls += 1;
      }
      for (const [id, body] of model.binding_cases) for (const selected of [null, 'powershell.exe', 'pwsh']) {
        invoke(hook, tool_name, id, stdin(body), selected, 'NOT_CONTINUATION'); deltaCalls += 1;
      }
      for (const [id, source, expected, padding] of model.unproved_binding_cases) for (const n of [0, 1]) {
        const text = padding ? source.replace("\n'@", '\n' + 'x'.repeat(padding) + "\n'@") : source;
        invoke(hook, tool_name, id, text, model.shells[n], expected[n]); deltaCalls += 1;
      }
      for (const [id, body] of model.embedded_neighbours) for (const selected of [null, 'powershell.exe']) {
        invoke(hook, tool_name, id, stdin(body), selected, 'UNKNOWN'); deltaCalls += 1;
      }
    }
    const before = snapshot(ctx.dir);
    const results = await runNodeProcesses(pending.map(({ hook, input, traceFile }) => ({
      args: ['--require', preload, path.join(root, 'repo/scripts', hook.file), ...hook.args], input: JSON.stringify(input), env: { ...env, SYNTHETIC_QUEUE_TRACE: traceFile }, cwd: ctx.caller,
    })));
    pending.forEach(({ hook, id, selected, expected, traceFile }, index) => {
      const result = results[index];
      const denied = expected === 'UNKNOWN', label = hook.name + '/' + mode + '/' + id + '/' + selected;
      assert.equal(result.status, denied ? hook.deniedExit : 0, label + ': exit');
      const output = result.stdout.trim() ? JSON.parse(result.stdout) : {};
      assert.equal(output.hookSpecificOutput?.permissionDecision === 'deny', denied, label);
      assert.equal(result.stdout, denied ? JSON.stringify(output) + '\n' : hook.name === 'codex' ? '' : '{}\n', label + ': exact stdout');
      assert.equal(result.stderr, denied && hook.name === 'codex' ? output.hookSpecificOutput.permissionDecisionReason + '\n' : '', label + ': exact stderr');
      assert.doesNotMatch(result.stdout + result.stderr, /synthetic held fixture|synthetic fixture/);
      assert.equal(JSON.parse(fs.readFileSync(traceFile)).accesses, 0, label + ': queue trap');
      sourceCalls += 1;
    });
    assert.deepEqual(snapshot(ctx.dir), before, mode + ': bytes and directories unchanged');
  }
  assert.equal(deltaCalls, 396); assert.equal(smokeCalls, 112); assert.equal(sourceCalls, 508);
  t.diagnostic(JSON.stringify({ sourceCalls, deltaCalls, smokeCalls, queueModes: 7, productionDefault: true,
    stateReaderInjected: false, resolverInjected: false, queueAccesses: 0, byteAndDirectoryEquality: true, nativeDispatchExercised: false }));
});

test('source-hook sentinel delta uses both production defaults with exact non-mutation', async t => {
  const model = matrix.evidence_boundary_model, trace = fixture(t), ctx = fixture(t);
  const preload = path.join(trace.dir, 'sentinel-queue-trap.cjs');
  fs.writeFileSync(preload, String.raw`'use strict';
const fs = require('node:fs'); let accesses = 0;
for (const name of ['readFileSync', 'readdirSync', 'statSync', 'lstatSync', 'existsSync']) {
  const original = fs[name]; fs[name] = function(file, ...args) {
    if (String(file).includes('held-prompts.v1.json')) { accesses += 1; throw Error('SYNTHETIC_QUEUE_ACCESS'); }
    return original.call(this, file, ...args);
  };
}
process.on('exit', () => fs.writeFileSync(process.env.SYNTHETIC_QUEUE_TRACE, JSON.stringify({ accesses })));
`);
  const env = { ...process.env, ...ctx.environment, GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: path.join(ctx.home, 'absent-gitconfig') };
  for (const key of Object.keys(env)) if (/^(?:TOOLKIT_|CLAUDE_CODE_REMOTE|CLAUDE_ENV_FILE|NODE_OPTIONS)/.test(key)) delete env[key];
  for (const [cwd, name] of [[ctx.caller, 'caller'], [ctx.other, 'held']]) {
    for (const args of [['init', '--quiet'], ['remote', 'add', 'origin', 'https://github.com/example-owner/' + name + '.git']]) {
      const result = spawnSync('git', ['-c', 'core.fsmonitor=false', '-C', cwd, ...args], { env, encoding: 'utf8', windowsHide: true, timeout: 10000 });
      assert.equal(result.status, 0, 'synthetic fixture git: ' + result.stderr);
    }
  }
  gate.writeGovernanceDecision(ctx.caller, 'enable', { registryOptions: ctx.options });
  const hooks = [
    { name: 'claude', file: 'toolkit-governance-hook.cjs', args: ['--event', 'PreToolUse'], deniedExit: 0 },
    { name: 'codex', file: 'toolkit-codex-helper-hook.cjs', args: [], deniedExit: 2 },
  ];
  let calls = 0, restoredRefusals = 0, withdrawnExtraRefusals = 0;
  // Each case is its own hook process with its own stdin and queue-trap file; they run a few at a
  // time, and the fixture snapshot is compared before and after all of them.
  const cases = [];
  for (const hook of hooks) for (const tool_name of ['Bash', 'PowerShell']) for (const selected of model.shells)
    for (const [id, template, expected] of model.sentinel_transforms.adapter_cases) {
      const command = sentinelText(template, 'codex', String.fromCharCode(0));
      const input = { ...shell(ctx, command), tool_name, tool_input: { command, ...(selected === null ? {} : { shell: selected }) } };
      cases.push({ hook, tool_name, selected, id, expected, input, traceFile: path.join(trace.dir, 'sentinel-queue-trace-' + cases.length + '.json') });
    }
  const before = snapshot(ctx.dir);
  const results = await runNodeProcesses(cases.map(({ hook, input, traceFile }) => ({
    args: ['--require', preload, path.join(root, 'repo/scripts', hook.file), ...hook.args], input: JSON.stringify(input), env: { ...env, SYNTHETIC_QUEUE_TRACE: traceFile }, cwd: ctx.caller,
  })));
  cases.forEach(({ hook, tool_name, selected, id, expected, traceFile }, index) => {
      const result = results[index];
      const denied = expected === 'UNKNOWN', label = hook.name + '/' + id + '/' + selected + '/' + tool_name;
      assert.equal(result.status, denied ? hook.deniedExit : 0, label + ': exit');
      const output = result.stdout.trim() ? JSON.parse(result.stdout) : {};
      assert.equal(output.hookSpecificOutput?.permissionDecision === 'deny', denied, label);
      assert.equal(result.stdout, denied ? JSON.stringify(output) + '\n' : hook.name === 'codex' ? '' : '{}\n', label + ': exact stdout');
      assert.equal(result.stderr, denied && hook.name === 'codex' ? output.hookSpecificOutput.permissionDecisionReason + '\n' : '', label + ': exact stderr');
      assert.doesNotMatch(result.stdout + result.stderr, /synthetic held fixture|synthetic fixture/);
      assert.equal(JSON.parse(fs.readFileSync(traceFile)).accesses, 0, label + ': queue trap');
      calls += 1; if (id === 'numeric-opener' || id === 'expansion-opener') restoredRefusals += 1;
      if (id.endsWith('-join-reversal')) withdrawnExtraRefusals += 1;
  });
  assert.deepEqual(snapshot(ctx.dir), before, 'bytes and directories unchanged');
  assert.equal(calls, 168); assert.equal(restoredRefusals, 48); assert.equal(withdrawnExtraRefusals, 48);
  t.diagnostic(JSON.stringify({ calls, restoredRefusals, withdrawnExtraRefusals, productionDefault: true,
    stateReaderInjected: false, resolverInjected: false, candidateModulePreloaded: false,
    queueAccesses: 0, byteAndDirectoryEquality: true, nativeDispatchExercised: false }));
});

test('new evidence allowances retain every raw guard without reading a held queue or acquiring metadata', t => {
  const ctx = fixture(t), before = snapshot(ctx.dir);
  const held = { state: 'UNDECIDED', rule: 'R4', repository_id: 'synthetic-held' }, safe = { state: 'DISABLED', rule: 'R1' };
  const positives = ["@'\nfor key,value in items:\n    print(key,value)\n'@ | python -",
    'git push origin HEAD:refs/heads/codex/example; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; git fetch origin codex/example',
    'git commit -m "codex resume; claude --resume"', 'git add -- "codex/resume.md"', 'rg -e "codex resume" fixture.txt'];
  const originals = {}; let queueReads = 0, spawns = 0, checks = 0;
  // Throw on queue reads, metadata probes or directory scans, rather than inferring
  // zero access solely from equal bytes after the call.
  for (const name of ['readFileSync', 'readdirSync', 'statSync', 'lstatSync', 'existsSync']) {
    originals[name] = fs[name];
    fs[name] = (file, ...args) => {
      if (String(file).includes(gate.HELD_BASENAME)) { queueReads += 1; throw new Error('SYNTHETIC_QUEUE_ACCESS'); }
      return originals[name](file, ...args);
    };
  }
  try {
    for (const command of positives) for (const actor of matrix.actors) for (const tool_name of ['Bash', 'PowerShell']) for (const selected of [undefined, 'powershell.exe']) {
      const input = { ...shell(ctx, command), actor, tool_name, tool_input: { cmd: command, ...(selected === undefined ? {} : { shell: selected }) } };
      const make = stateReader => new gate.ToolGate({ registryOptions: ctx.options, environment: ctx.environment, stateReader,
        continuationResolver: new ContinuationResolver({ environment: ctx.environment, spawn() { spawns += 1; throw new Error('UNEXPECTED_METADATA'); } }) });
      const check = (stateReader, value, denied, reason) => {
        assert.equal(Boolean(make(stateReader).decide(value)?.deny), denied, reason); checks += 1;
      };
      check(() => safe, input, false, 'ordinary');
      check(() => held, input, true, 'held current');
      check(() => ({ ...held, rule: 'ERROR', error_code: 'SYNTHETIC' }), input, true, 'unreadable current');
      check(cwd => path.resolve(cwd) === ctx.other ? held : safe, { ...input, tool_input: { ...input.tool_input, workdir: ctx.other } }, true, 'held workdir');
      check(cwd => path.resolve(cwd).startsWith(ctx.other) ? held : safe,
        { ...input, tool_input: { ...input.tool_input, cmd: command + '; Get-Content -LiteralPath "' + ctx.other + '/fixture.txt"' } }, true, 'held raw path');
      check(() => safe, { ...input, tool_input: { ...input.tool_input, cmd: command + '; node toolkit-governance.cjs enable' } }, true, 'owner answer');
      check(() => safe, { ...input, tool_name: 'Write', tool_input: { file_path: ctx.options.registryPath } }, true, 'user-state edit');
    }
  } finally { for (const name of Object.keys(originals)) fs[name] = originals[name]; }
  assert.equal(checks, 560); assert.equal(queueReads, 0); assert.equal(spawns, 0);
  assert.deepEqual(snapshot(ctx.dir), before);
  t.diagnostic(JSON.stringify({ rawGuardChecks: checks, queueReads, metadataSpawns: spawns, bytesAndDirectoriesUnchanged: true }));
});
