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

test('ordinary setup keeps malformed legacy marker repair migration-only', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const filePath = codexConfig(root);
  const original = Buffer.from(malformedConfig('\r\n'));
  writeFile(filePath, original.toString('utf8'));
  const result = run([
    '--execute', '--repo-root', setupRepo, '--repo-remote', origin,
    '--yes-recommended', '--skip-codex-plugin-auto-refresh', '--codex-helper-capacity', 'root-only',
  ], {
    env: { ...isolatedHomeEnv(root), SYNTHETIC_PRIVATE_ENV: 'ENV-DO-NOT-PRINT' },
    timeout: 300000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Route contract: toolkit\.route-resolution\.resolved-launch-record\.v1/);
  assert.doesNotMatch(result.stdout, /Codex helper-agent config preview|Historical Toolkit marker repair required/);
  assert.doesNotMatch(result.stdout, /SYNTHETIC-DO-NOT-PRINT|ENV-DO-NOT-PRINT/);
  assert.deepEqual(fs.readFileSync(filePath), original);
  assert.deepEqual(backupFiles(root), []);
  assert.equal(fs.existsSync(path.join(setupRepo, 'PLUGIN_SETUP.log')), false);
});
test('explicit legacy repair flags do not become active setup policy', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const filePath = codexConfig(root);
  const original = malformedConfig('\n');
  writeFile(filePath, original);
  const result = run([
    '--execute', '--repo-root', setupRepo, '--repo-remote', origin,
    '--skip-codex-plugin-auto-refresh', '--yes-recommended', '--codex-helper-capacity', 'root-only', '--approve-codex-config-proposal',
  ], {
    env: isolatedHomeEnv(root),
    timeout: 300000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /setup-toolkit-question-bank:complete/);
  assert.match(result.stdout, /Route contract: toolkit\.route-resolution\.resolved-launch-record\.v1/);
  assert.doesNotMatch(result.stdout, /Configuration changed this run: yes|Historical Toolkit marker repair required/);
  assert.equal(fs.readFileSync(filePath, 'utf8'), original);
  assert.deepEqual(backupFiles(root), []);
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
    assert.doesNotMatch(result.stdout, /codex-helper-agents|Codex helper agents/);
    assert.match(result.stdout, /Route contract|exact-launch-record|versioned role registry/i);
    assert.doesNotMatch(result.stdout, /SYNTHETIC-DO-NOT-PRINT/);
    assert.deepEqual(fs.readFileSync(filePath), original);
    assert.deepEqual(backupFiles(root), []);
  }
});
