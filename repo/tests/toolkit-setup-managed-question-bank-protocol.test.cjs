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
test('managed child bank is forwarded exactly once before intentional status 23 pause', () => {
  const { result } = runFake();
  assert.equal(result.status, 23, result.stderr || result.stdout);
  assert.equal(markerCount(result.stdout, core.QUESTION_BANK_BEGIN), 1);
  assert.equal(markerCount(result.stdout, core.QUESTION_BANK_COMPLETE), 1);
  assert.equal((result.stdout.match(/Bank reference: 0123-4567-89AB-CDEF/g) || []).length, 1);
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
