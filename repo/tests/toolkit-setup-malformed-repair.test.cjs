'use strict';

const test = require('node:test');
const config = require('../scripts/codex-delegation-config.cjs');
const {
  assert,
  fs,
  path,
  tmpRoot,
  isolatedHomeEnv,
  writeFile,
  createGitBackedSetupRepo,
  run,
  codexConfig,
  backupFiles,
} = require('./toolkit-setup-test-support.cjs');

function malformedConfig(eol = '\n') {
  const malformed = config.expectedV2Block(1, eol).replace(`${config.CODEX_HELPER_CAPACITY_END}${eol}`, '');
  return `private_note = "SYNTHETIC-DO-NOT-PRINT"${eol}${eol}[features.multi_agent_v2]${eol}${malformed}${eol}${eol}[unrelated]${eol}keep = true${eol}`;
}

test('complete question bank precedes a sanitized malformed-marker proposal and decline performs no write or backup', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const filePath = codexConfig(root);
  const original = Buffer.from(malformedConfig('\r\n'));
  writeFile(filePath, original.toString('utf8'));
  const result = run([
    '--execute', '--repo-root', setupRepo, '--repo-remote', origin,
    '--yes-recommended', '--skip-codex-plugin-auto-refresh',
  ], {
    env: { ...isolatedHomeEnv(root), SYNTHETIC_PRIVATE_ENV: 'ENV-DO-NOT-PRINT' },
    timeout: 300000,
  });
  assert.equal(result.status, 23, result.stderr || result.stdout);
  const bankEnd = result.stdout.indexOf('setup-toolkit-question-bank:complete');
  const proposalStart = result.stdout.indexOf('# Codex helper-agent config preview');
  assert.ok(bankEnd >= 0 && proposalStart > bankEnd);
  assert.match(result.stdout, /Historical Toolkit marker repair required: yes/);
  assert.match(result.stdout, /Malformed marker classes: missing-end-marker/);
  assert.match(result.stdout, /Marker\/assignment categories to remove or replace:/);
  assert.match(result.stdout, /Exact affected line ranges:/);
  assert.match(result.stdout, /Proposal digest \(SHA-256\): [a-f0-9]{64}/);
  assert.match(result.stdout, /Unrelated configuration bytes remain unchanged: yes/);
  assert.match(result.stdout, /Planned exact backup metadata:/);
  assert.match(result.stdout, /Exact restore command after the approved write \(PowerShell\):/);
  assert.doesNotMatch(result.stdout, /SYNTHETIC-DO-NOT-PRINT|ENV-DO-NOT-PRINT/);
  assert.match(result.stderr, /answer `apply`/);
  assert.deepEqual(fs.readFileSync(filePath), original);
  assert.deepEqual(backupFiles(root), []);
  assert.equal(fs.existsSync(path.join(setupRepo, 'PLUGIN_SETUP.log')), false);
});
test('literal apply completes the bounded root-only repair after the full question bank', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const filePath = codexConfig(root);
  const original = malformedConfig('\n');
  writeFile(filePath, original);
  const result = run([
    '--execute', '--repo-root', setupRepo, '--repo-remote', origin,
    '--skip-codex-plugin-auto-refresh',
  ], {
    env: isolatedHomeEnv(root),
    input: ['keep', 'keep', 'keep', 'root-only', 'apply'].join('\n'),
    timeout: 300000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /setup-toolkit-question-bank:complete/);
  assert.match(result.stdout, /Historical Toolkit marker repair required: yes/);
  assert.match(result.stdout, /Helper-capacity outcome this run: configured/);
  assert.match(result.stdout, /Malformed historical Toolkit marker material repaired: yes/);
  assert.match(result.stdout, /Configuration changed this run: yes/);
  const after = fs.readFileSync(filePath, 'utf8');
  assert.match(after, /max_concurrent_threads_per_session = 1/);
  assert.match(after, /AI-AGENT-TOOLKIT:BEGIN CODEX-HELPER-CAPACITY v3/);
  assert.ok(after.startsWith('private_note = "SYNTHETIC-DO-NOT-PRINT"\n\n'));
  assert.ok(after.endsWith('[unrelated]\nkeep = true\n'));
  assert.ok(backupFiles(root).length > 0);
});

test('plan and JSON question surfaces remain coherent and read-only for malformed synthetic config', () => {
  for (const json of [false, true]) {
    const root = tmpRoot();
    const { origin, setupRepo } = createGitBackedSetupRepo(root);
    const filePath = codexConfig(root);
    const original = Buffer.from(malformedConfig());
    writeFile(filePath, original.toString('utf8'));
    const result = run([
      '--plan', ...(json ? ['--json'] : []), '--repo-root', setupRepo, '--repo-remote', origin,
      '--skip-codex-plugin-auto-refresh',
    ], { env: isolatedHomeEnv(root), timeout: 300000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /codex-helper-agents|Codex helper agents/);
    assert.match(result.stdout, /root-only|Root agent only/);
    assert.doesNotMatch(result.stdout, /SYNTHETIC-DO-NOT-PRINT/);
    assert.deepEqual(fs.readFileSync(filePath), original);
    assert.deepEqual(backupFiles(root), []);
  }
});
