'use strict';

const test = require('node:test');
const core = require('../scripts/setup-toolkit-core.cjs');
const {
  assert, fs, path, script, tmpRoot, isolatedHomeEnv, writeFile, run, runTestGit,
  createFakeManagedSetupScript, createGitBackedRealSetupRepo, runWithUnclosedStdin, codexConfig,
} = require('./toolkit-setup-test-support.cjs');

function markerCount(text, marker) {
  return String(text || '').split(marker).length - 1;
}

function snapshotOwned(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { recursive: true })
    .map((entry) => path.join(root, entry))
    .filter((entry) => fs.lstatSync(entry).isFile())
    .sort()
    .map((entry) => [path.relative(root, entry).replaceAll('\\', '/'), fs.readFileSync(entry).toString('hex')]);
}

function seedOwnedMutationSentinels(root) {
  const paths = [
    '.ai-agent-toolkit/current/manifest.json',
    '.ai-agent-toolkit/current/state.json',
    '.ai-agent-toolkit/current/.toolkit-staging-owner.json',
    '.ai-agent-toolkit/staging/managed/sentinel.json',
    '.ai-agent-toolkit/update-reports/sentinel.txt',
    '.codex/config.toml',
    '.codex/plugins/cache/ai-agent-toolkit-local/ai-agent-toolkit/stale/manifest.json',
    '.config/opencode/skills/ai-agent-toolkit/sentinel.txt',
    '.ag2/plugins/ai-agent-toolkit/sentinel.txt',
    '.claude/plugins/cache/ai-agent-toolkit-local/ai-agent-toolkit/stale/plugin.json',
  ];
  for (const rel of paths) writeFile(path.join(root, ...rel.split('/')), `sentinel:${rel}\n`);
}
function createSequencedProtocolFake(root, options = {}) {
  const fake = createFakeManagedSetupScript(root);
  const bank = Buffer.from(options.bank || [
    `${core.QUESTION_BANK_BEGIN}\r\n`,
    '# Toolkit setup choices\r\n',
    `${core.QUESTION_BANK_COMPLETE}\r\n`,
  ].join(''), 'utf8');
  const receipt = {
    protocol: core.MANAGED_QUESTION_BANK_PROTOCOL,
    event: 'question-bank-complete',
    stream: 'stdout',
    begin_markers: 1,
    complete_markers: 1,
    question_count: 1,
    bank_byte_length: options.bankByteLength ?? bank.length,
    bank_sha256: options.bankSha256 || require('node:crypto').createHash('sha256').update(bank).digest('hex'),
  };
  const chunks = options.chunks || [bank.subarray(0, 17), bank.subarray(17, bank.length - 9), bank.subarray(bank.length - 9)];
  const control = options.control || `${JSON.stringify(receipt)}\n`;
  writeFile(fake.scriptPath, [
    '#!/usr/bin/env node', "'use strict';", "const fs = require('node:fs');",
    `const protocol = ${JSON.stringify(core.MANAGED_QUESTION_BANK_PROTOCOL)};`,
    "if (process.argv.length === 3 && process.argv[2] === '--managed-question-bank-protocol-probe') {",
    "  process.stdout.write(JSON.stringify({ protocol, question_bank_stream: 'stdout', control_fd: 3, acknowledgement_fd: 4, pause_status: 23 }) + '\\n');",
    '  process.exit(0);',
    '}',
    '(async () => {',
    ...(options.receiptFirst === false ? [] : [`  fs.writeSync(3, ${JSON.stringify(control)});`]),
    ...chunks.map((chunk, index) => `  ${index ? `await new Promise((resolve) => setTimeout(resolve, ${options.delayMs || 40})); ` : ''}fs.writeSync(1, Buffer.from(${JSON.stringify(Buffer.from(chunk).toString('base64'))}, 'base64'));`),
    ...(options.receiptFirst === false ? [`  fs.writeSync(3, ${JSON.stringify(control)});`] : []),
    ...(options.awaitAcknowledgement === false ? [] : [
      "  const acknowledgement = fs.readFileSync(4, 'utf8').trim();",
      ...(options.ackLogPath ? [`  fs.writeFileSync(${JSON.stringify(options.ackLogPath)}, acknowledgement);`] : []),
      "  if (acknowledgement !== 'question-bank-visible') process.exit(91);",
    ]),
    `  process.exit(${options.exitCode ?? 23});`,
    '})().catch(() => process.exit(92));',
    '',
  ].join('\n'));
  return { ...fake, bank };
}

function runFake(options = {}, argv = ['--execute', '--profile', 'auto-main', '--host', 'claude-code']) {
  const root = tmpRoot();
  const fake = createFakeManagedSetupScript(root, options);
  const result = run(argv, { env: isolatedHomeEnv(root), timeout: 30000 });
  return { root, fake, result };
}

test('managed child bank is forwarded exactly once before intentional status 23 pause', () => {
  const { result } = runFake();
  assert.equal(result.status, 23, result.stderr || result.stdout);
  assert.equal(markerCount(result.stdout, core.QUESTION_BANK_BEGIN), 1);
  assert.equal(markerCount(result.stdout, core.QUESTION_BANK_COMPLETE), 1);
  assert.match(result.stderr, /displayed the complete question bank and requires additional approved answers/);
});

test('status 23 without output is rejected precisely without retry', () => {
  const { result } = runFake({ emitQuestionBank: false });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /returned no question-bank output/);
  assert.doesNotMatch(result.stderr, /retry/i);
});

for (const scenario of [
  ['begin without complete', { omitComplete: true }, /partial question bank/],
  ['complete without begin', { omitBegin: true }, /complete marker without a begin marker/],
  ['duplicate begin', { duplicateBegin: true }, /duplicate question-bank begin markers/],
  ['duplicate complete', { duplicateComplete: true }, /duplicate question-bank complete markers/],
  ['bank on stderr', { bankStream: 'stderr' }, /on stderr instead of documented stdout/],
  ['missing control receipt', { controlReceipt: false }, /matching question-bank control receipt/],
]) {
  test(`managed protocol rejects ${scenario[0]}`, () => {
    const { result } = runFake(scenario[1]);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stderr, scenario[2]);
    assert.doesNotMatch(result.stdout, /Accept all displayed recommended settings/);
  });
}

test('genuine child failure is not classified as question-bank pause and raw logs stay hidden', () => {
  const { root, result } = runFake({ emitQuestionBank: false, exitCode: 9, extraLines: ["console.error('PRIVATE RAW LOG ' + __filename);"] });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /failed before completing the question-bank protocol/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /PRIVATE RAW LOG/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
});

test('managed script identity mismatch fails before execution and reveals no private path', () => {
  const { root, result } = runFake({ identityMismatch: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /identity does not support the required question-bank protocol/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
});

test('host and user arguments survive delegation exactly once and recursion depth is explicit', () => {
  const root = tmpRoot();
  const argsLogPath = path.join(root, 'managed-args.json');
  createFakeManagedSetupScript(root, { argsLogPath });
  const result = run([
    '--execute', '--profile', 'auto-main', '--host', 'claude-code',
    '--claude-plugin-behavior', 'instructions', '--skip-target', 'opencode',
  ], { env: isolatedHomeEnv(root), timeout: 30000 });
  assert.equal(result.status, 23, result.stderr || result.stdout);
  const logged = JSON.parse(fs.readFileSync(argsLogPath, 'utf8'));
  assert.equal(logged.argv.filter((arg) => arg === '--host').length, 1);
  assert.equal(logged.argv.filter((arg) => arg === 'claude-code').length, 1);
  assert.equal(logged.argv.filter((arg) => arg === '--claude-plugin-behavior').length, 1);
  assert.equal(logged.argv.filter((arg) => arg === 'instructions').length, 1);
  assert.equal(logged.argv.filter((arg) => arg === '--skip-target').length, 1);
  assert.equal(logged.depth, '1');
});

test('receipt may arrive before a delayed fragmented bank and acknowledgement follows exact forwarding', () => {
  const root = tmpRoot();
  const ackLogPath = path.join(root, 'ack.txt');
  createSequencedProtocolFake(root, { receiptFirst: true, delayMs: 75, ackLogPath });
  const result = run(['--execute', '--profile', 'auto-main', '--host', 'claude-code'], {
    env: isolatedHomeEnv(root), timeout: 30000,
  });
  assert.equal(result.status, 23, result.stderr || result.stdout);
  assert.equal(markerCount(result.stdout, core.QUESTION_BANK_BEGIN), 1);
  assert.equal(markerCount(result.stdout, core.QUESTION_BANK_COMPLETE), 1);
  assert.equal(fs.readFileSync(ackLogPath, 'utf8'), 'question-bank-visible');
});

test('truncated bank, receipt length mismatch, and receipt digest mismatch fail closed', async () => {
  const truncatedRoot = tmpRoot();
  const fullBank = Buffer.from(`${core.QUESTION_BANK_BEGIN}\n# choices\n${core.QUESTION_BANK_COMPLETE}\n`);
  const truncated = createSequencedProtocolFake(truncatedRoot, {
    bank: fullBank, chunks: [fullBank.subarray(0, fullBank.length - 9)], awaitAcknowledgement: false,
  });
  await assert.rejects(
    core.runManagedQuestionBankChild(truncated.scriptPath, truncated.managedPath, ['--execute'], { timeoutMs: 5000 }),
    /length did not match/,
  );

  const lengthRoot = tmpRoot();
  const length = createSequencedProtocolFake(lengthRoot, { bankByteLength: 9999, awaitAcknowledgement: false });
  await assert.rejects(
    core.runManagedQuestionBankChild(length.scriptPath, length.managedPath, ['--execute'], { timeoutMs: 5000 }),
    /length did not match/,
  );

  const digestRoot = tmpRoot();
  const digest = createSequencedProtocolFake(digestRoot, { bankSha256: '0'.repeat(64) });
  await assert.rejects(
    core.runManagedQuestionBankChild(digest.scriptPath, digest.managedPath, ['--execute'], { timeoutMs: 5000 }),
    /digest did not match/,
  );
});

test('oversized receipt, payload, and delegated stdin fail with bounded privacy-safe diagnostics', async () => {
  const controlRoot = tmpRoot();
  const control = createSequencedProtocolFake(controlRoot, { control: `${'x'.repeat(5000)}\n`, awaitAcknowledgement: false });
  await assert.rejects(
    core.runManagedQuestionBankChild(control.scriptPath, control.managedPath, ['--execute'], { timeoutMs: 5000 }),
    /oversized question-bank control receipt/,
  );

  const payloadRoot = tmpRoot();
  const oversizedBank = `${core.QUESTION_BANK_BEGIN}\n${'x'.repeat((1024 * 1024) + 1)}\n${core.QUESTION_BANK_COMPLETE}\n`;
  const payload = createSequencedProtocolFake(payloadRoot, { bank: oversizedBank, awaitAcknowledgement: false });
  await assert.rejects(
    core.runManagedQuestionBankChild(payload.scriptPath, payload.managedPath, ['--execute'], { timeoutMs: 5000 }),
    /oversized question-bank payload/,
  );

  const inputRoot = tmpRoot();
  const input = createSequencedProtocolFake(inputRoot);
  await assert.rejects(
    core.runManagedQuestionBankChild(input.scriptPath, input.managedPath, ['--execute'], { stdinInput: Buffer.alloc((64 * 1024) + 1), timeoutMs: 5000 }),
    /input exceeded the bounded transport limit/,
  );
});

test('timeout and signal termination have distinct privacy-safe diagnoses', async () => {
  const timeoutRoot = tmpRoot();
  const timeoutFake = createFakeManagedSetupScript(timeoutRoot, { hang: true, emitQuestionBank: false });
  await assert.rejects(
    core.runManagedQuestionBankChild(timeoutFake.scriptPath, timeoutFake.managedPath, ['--execute'], { timeoutMs: 100 }),
    /timed out before the question-bank protocol completed/,
  );

  const signalRoot = tmpRoot();
  const signalFake = createFakeManagedSetupScript(signalRoot, { hang: true, emitQuestionBank: false });
  await assert.rejects(
    core.runManagedQuestionBankChild(signalFake.scriptPath, signalFake.managedPath, ['--execute'], { timeoutMs: 5000, terminateAfterMs: 100 }),
    /terminated by a signal before the question-bank protocol completed/,
  );
});

test('Windows CRLF bank markers are accepted by the documented stdout protocol', () => {
  const { result } = runFake();
  assert.equal(result.status, 23, result.stderr || result.stdout);
  assert.match(result.stdout, /question-bank:begin -->\r?\n/);
  assert.match(result.stdout, /question-bank:complete -->/);
});

function realManagedFixture() {
  const root = tmpRoot();
  const { origin } = createGitBackedRealSetupRepo(root);
  const managedPath = path.join(root, '.ai-agent-toolkit', 'source', 'ai-agent-toolkit');
  runTestGit(root, ['clone', '--branch', 'main', origin, managedPath]);
  return { root, origin, managedPath };
}

function runRealManaged(fixture, extraArgs = [], input, options = {}) {
  return run([
    '--execute', '--profile', 'auto-main', '--host', 'claude-code',
    '--repo-remote', fixture.origin, ...extraArgs,
  ], { env: { ...(options.baseEnv || isolatedHomeEnv(fixture.root)), ...(options.env || {}) }, input, timeout: 300000 });
}

test('real active-to-managed Claude route shows one complete bank then pauses on empty input with zero writes', () => {
  const fixture = realManagedFixture();
  const result = runRealManaged(fixture, [], '');
  assert.equal(result.status, 23, result.stderr || result.stdout);
  assert.equal(markerCount(result.stdout, core.QUESTION_BANK_BEGIN), 1);
  assert.equal(markerCount(result.stdout, core.QUESTION_BANK_COMPLETE), 1);
  assert.equal(fs.existsSync(path.join(fixture.managedPath, 'BRIDGE_ARGS.log')), false);
  assert.equal(fs.existsSync(path.join(fixture.managedPath, 'CLAUDE_PLUGIN_SETUP.log')), false);
  assert.equal(fs.existsSync(codexConfig(fixture.root)), false);
});

test('stale SessionStart and owned-state sentinels remain untouched through the entire pre-approval lifecycle', () => {
  for (const input of ['', 'default\n']) {
    const fixture = realManagedFixture();
    seedOwnedMutationSentinels(fixture.root);
    const staleSessionStart = path.join(fixture.root, 'stale-session-start-sentinel.txt');
    const workerProbe = path.join(fixture.root, 'worker-probe-sentinel.txt');
    const checkerProbe = path.join(fixture.root, 'checker-probe-sentinel.txt');
    const fakeClaude = path.join(fixture.root, 'Claude CLI With Spaces', 'stale-claude.cjs');
    writeFile(fakeClaude, [
      "'use strict';", "const fs = require('node:fs');", "const args = process.argv.slice(2);",
      `fs.writeFileSync(${JSON.stringify(staleSessionStart)}, 'stale SessionStart ran');`,
      `if (args.includes('--print') && args.includes('opus-4.8')) fs.writeFileSync(${JSON.stringify(checkerProbe)}, 'checker');`,
      `if (args.includes('--print') && !args.includes('opus-4.8')) fs.writeFileSync(${JSON.stringify(workerProbe)}, 'worker');`,
      "if (args.includes('--version')) console.log('2.3.25 stale'); else console.log('{}');",
    ].join('\n'));
    const baseEnv = isolatedHomeEnv(fixture.root);
    const before = snapshotOwned(fixture.root);
    const result = runRealManaged(fixture, ['--claude-cli', fakeClaude], input, { baseEnv });
    assert.equal(result.status, 23, result.stderr || result.stdout);
    assert.equal(markerCount(result.stdout, core.QUESTION_BANK_BEGIN), 1);
    assert.equal(markerCount(result.stdout, core.QUESTION_BANK_COMPLETE), 1);
    assert.deepEqual(snapshotOwned(fixture.root), before);
    assert.equal(fs.existsSync(staleSessionStart), false);
    assert.equal(fs.existsSync(workerProbe), false);
    assert.equal(fs.existsSync(checkerProbe), false);
  }
});

test('Claude plan and JSON plan are observational and report launch verification deferred', () => {
  for (const json of [false, true]) {
    const fixture = realManagedFixture();
    seedOwnedMutationSentinels(fixture.root);
    const staleSessionStart = path.join(fixture.root, `plan-session-${json}.txt`);
    const fakeClaude = path.join(fixture.root, 'Claude Plan CLI', 'stale-claude.cjs');
    writeFile(fakeClaude, `require('node:fs').writeFileSync(${JSON.stringify(staleSessionStart)}, 'session');\n`);
    const env = isolatedHomeEnv(fixture.root);
    const before = snapshotOwned(fixture.root);
    const result = run([
      '--plan', ...(json ? ['--json'] : []), '--host', 'claude-code', '--repo-root', fixture.managedPath,
      '--repo-remote', fixture.origin, '--claude-cli', fakeClaude,
    ], { env, timeout: 300000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /root-only|root agent/i);
    assert.deepEqual(snapshotOwned(fixture.root), before);
    assert.equal(fs.existsSync(staleSessionStart), false);
  }
});
test('managed explicit flags without yes-recommended complete with non-TTY stdin still open', async () => {
  const fixture = realManagedFixture();
  const result = await runWithUnclosedStdin(script, [
    '--execute', '--profile', 'auto-main', '--host', 'claude-code', '--repo-remote', fixture.origin,
    '--use-default-managed-checkout', '--enable-repo-auto-update', '--enable-update-reports',
    '--default-update-report-retention-days', '--claude-topology', 'root-only',
    '--claude-agent-capacity', 'root-only', '--claude-plugin-behavior', 'instructions',
  ], { env: isolatedHomeEnv(fixture.root), deadlineMs: 300000 });
  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.equal(markerCount(result.stdout, core.QUESTION_BANK_BEGIN), 1);
  assert.equal(markerCount(result.stdout, core.QUESTION_BANK_COMPLETE), 1);
});

test('managed unresolved unclosed input displays the bank before EOF and then pauses when input closes', async () => {
  const fixture = realManagedFixture();
  const result = await runWithUnclosedStdin(script, [
    '--execute', '--profile', 'auto-main', '--host', 'claude-code', '--repo-remote', fixture.origin,
  ], {
    env: isolatedHomeEnv(fixture.root),
    closeStdinAfterOutput: core.QUESTION_BANK_COMPLETE,
    deadlineMs: 300000,
  });
  assert.equal(result.code, 23, result.stderr || result.stdout);
  assert.equal(markerCount(result.stdout, core.QUESTION_BANK_BEGIN), 1);
  assert.equal(markerCount(result.stdout, core.QUESTION_BANK_COMPLETE), 1);
  assert.equal(fs.existsSync(path.join(fixture.managedPath, 'BRIDGE_ARGS.log')), false);
});

test('delegated stdin transport preserves bounded input bytes exactly', () => {
  const root = tmpRoot();
  const stdinHexLogPath = path.join(root, 'stdin.hex');
  createFakeManagedSetupScript(root, { stdinHexLogPath });
  const input = Buffer.from([0x00, 0x0a, 0x7f, 0x80, 0xff, 0x0d, 0x0a]);
  const result = run(['--execute', '--profile', 'auto-main', '--host', 'claude-code'], {
    env: isolatedHomeEnv(root), input, timeout: 30000,
  });
  assert.equal(result.status, 23, result.stderr || result.stdout);
  assert.equal(fs.readFileSync(stdinHexLogPath, 'utf8'), input.toString('hex'));
});

test('real partial piped answers still show one complete effective bank before pausing', () => {
  const fixture = realManagedFixture();
  const result = runRealManaged(fixture, [], 'default\n');
  assert.equal(result.status, 23, result.stderr || result.stdout);
  assert.equal(markerCount(result.stdout, core.QUESTION_BANK_BEGIN), 1);
  assert.equal(markerCount(result.stdout, core.QUESTION_BANK_COMPLETE), 1);
  assert.match(result.stdout, /Update source[\s\S]*Selected:/);
  assert.equal(fs.existsSync(path.join(fixture.managedPath, 'BRIDGE_ARGS.log')), false);
});

test('real complete piped answers show one bank before synthetic-home setup mutation', () => {
  const fixture = realManagedFixture();
  const input = ['default', 'enable', 'enable', 'default', 'instructions', ''].join('\n');
  const result = runRealManaged(fixture, [], input);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(markerCount(result.stdout, core.QUESTION_BANK_BEGIN), 1);
  assert.equal(markerCount(result.stdout, core.QUESTION_BANK_COMPLETE), 1);
  assert.equal(fs.existsSync(path.join(fixture.managedPath, 'CLAUDE_PLUGIN_SETUP.log')), false);
  assert.equal(fs.existsSync(codexConfig(fixture.root)), false);
});

test('real explicit yes-recommended still shows one bank before synthetic-home setup mutation', () => {
  const fixture = realManagedFixture();
  const result = runRealManaged(fixture, [
    '--yes-recommended', '--claude-plugin-behavior', 'instructions',
    '--claude-topology', 'root-only', '--claude-agent-capacity', 'root-only',
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(markerCount(result.stdout, core.QUESTION_BANK_BEGIN), 1);
  assert.equal(markerCount(result.stdout, core.QUESTION_BANK_COMPLETE), 1);
  assert.match(result.stdout, /--yes-recommended selected/);
  assert.equal(fs.existsSync(path.join(fixture.managedPath, 'CLAUDE_PLUGIN_SETUP.log')), false);
  assert.equal(fs.existsSync(codexConfig(fixture.root)), false);
});

test('Claude probe timeout cannot silently suppress the real managed bank', () => {
  const fixture = realManagedFixture();
  const fakeClaude = path.join(fixture.root, 'Claude CLI With Spaces', 'fake-claude.cjs');
  writeFile(fakeClaude, [
    "'use strict';",
    "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);",
    '',
  ].join('\n'));
  const result = run([
    '--execute', '--profile', 'auto-main', '--host', 'claude-code',
    '--repo-remote', fixture.origin, '--claude-cli', fakeClaude,
  ], {
    env: {
      ...isolatedHomeEnv(fixture.root),
      CLAUDE_TOOLKIT_CLAUDE_CLI_TIMEOUT_MS: '50',
      CLAUDE_TOOLKIT_CLAUDE_CLI_PROBE_TIMEOUT_MS: '50',
    },
    input: '',
    timeout: 300000,
  });
  assert.equal(result.status, 23, result.stderr || result.stdout);
  assert.equal(markerCount(result.stdout, core.QUESTION_BANK_BEGIN), 1);
  assert.equal(markerCount(result.stdout, core.QUESTION_BANK_COMPLETE), 1);
  assert.match(result.stdout, /could not be verified|may need attention|unavailable/i);
  assert.equal(fs.existsSync(path.join(fixture.managedPath, 'BRIDGE_ARGS.log')), false);
  assert.equal(fs.existsSync(codexConfig(fixture.root)), false);
});
