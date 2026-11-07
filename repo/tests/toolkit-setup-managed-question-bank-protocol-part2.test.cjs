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
function realManagedFixture() {
  const root = tmpRoot();
  const { origin } = createGitBackedRealSetupRepo(root);
  const managedPath = path.join(root, '.ai-agent-toolkit', 'source', 'ai-agent-toolkit');
  runTestGit(root, ['clone', '--branch', 'main', origin, managedPath]);
  return { root, origin, managedPath };
}
function assertCompletedWithoutClaudePlugin(status, result) {
  assert.equal(status, core.SETUP_ACTION_REQUIRED, result.stderr || result.stdout);
  assert.match(result.stdout, /## Install check\nInstall check: action required\nClaude Code plugin: Toolkit \S+ is not installed, enabled and current in Claude Code, so its hooks are not enforced\./);
  assert.doesNotMatch(result.stderr, /Managed setup failed/);
}
function runRealManaged(fixture, extraArgs = [], input, options = {}) {
  return run([
    '--execute', '--profile', 'auto-main', '--host', 'claude-code',
    '--repo-remote', fixture.origin, ...extraArgs,
  ], { env: { ...(options.baseEnv || isolatedHomeEnv(fixture.root)), ...(options.env || {}) }, input, timeout: 300000 });
}

// Split by complete test declarations to keep the per-file time budget.
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
    '--claude-plugin-behavior', 'instructions', '--keep-update-reports',
  ], { env: isolatedHomeEnv(root), timeout: 30000 });
  assert.equal(result.status, 23, result.stderr || result.stdout);
  const logged = JSON.parse(fs.readFileSync(argsLogPath, 'utf8'));
  assert.equal(logged.argv.filter((arg) => arg === '--host').length, 1);
  assert.equal(logged.argv.filter((arg) => arg === 'claude-code').length, 1);
  assert.equal(logged.argv.filter((arg) => arg === '--claude-plugin-behavior').length, 1);
  assert.equal(logged.argv.filter((arg) => arg === 'instructions').length, 1);
  assert.equal(logged.argv.filter((arg) => arg === '--keep-update-reports').length, 1);
  assert.equal(logged.depth, '1');
  assert.equal(logged.workingFolder, path.resolve(__dirname, '..', '..'));
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
