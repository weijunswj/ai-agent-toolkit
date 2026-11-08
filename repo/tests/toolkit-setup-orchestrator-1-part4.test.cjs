'use strict';
const test = require('node:test');
const {
  assert, fs, path, spawnSync, repoRoot, script, tmpRoot, isolatedHomeEnv, writeFile, createFakeCodexAppServer, run, runTestGit, escapeRegExp,
  createGitBackedSetupRepo, createGitBackedRealSetupRepo, createFakeManagedSetupScript,
  runWithUnclosedStdin, codexConfig, backupFiles, displayedBankReference, auditFixture, specsForAudit, parseConciseInFreshProcess
} = require('./toolkit-setup-test-support.cjs');
const core = require('../scripts/setup-toolkit-core.cjs');
function snapshotTree(root) {
  const entries = [];
  const visit = dir => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, item.name);
      entries.push([path.relative(root, file), item.isDirectory() ? null : fs.readFileSync(file).toString('base64')]);
      if (item.isDirectory()) visit(file);
    }
  };
  visit(root);
  return entries;
}

// Split by complete test declarations to keep the per-file time budget.
test('ordinary bank displays capacity while explicit compatibility flags remain restrictive', () => {
  const args = core.parseArgs(['--plan', '--codex-helper-count', '2', '--approve-high-helper-capacity']);
  const current = { managed: { currentPath: '', selectedPath: '', defaultPath: '', exists: false, git: false, dirty: false, branch: '', remote: '' }, audit: { repo_auto_update: {}, targets: {} }, runtime: { runtime: 'MultiAgentV2' }, delegation: { status: 'configured', helper_count: 4 }, nativePlugin: { status: 'not checked' } };
  const specs = core.setupQuestionSpecs(args, current);
  assert.equal(specs.find((spec) => spec.key === 'codexHelperCapacity').selected, 'custom');
  assert.equal(args.setupChoices.codexHelperCapacity, 'custom');
  assert.equal(args.codexHelperCount, 2);
});

test('missing wizard output fails after one render and never emits a shortcut alone', () => {
  const specs = [{
    key: 'example', section: 'Automatic updates', title: 'Example?', description: 'Example control.',
    current: 'Off.', recommended_outcome: 'On.', recommended: 'on', selected: 'on', empty_input: 'on',
    choices: [{ value: 'on', label: 'On - recommended' }, { value: 'off', label: 'Off' }],
  }];
  let writes = 0;
  assert.throws(() => core.emitCompleteQuestionBank(specs, { write() { writes += 1; return false; } }), /no approval prompt or write is allowed/i);
  assert.equal(writes, 1);
  assert.throws(() => core.emitCompleteQuestionBank(specs, { write() { return false; } }), /no approval prompt or write is allowed/i);
});

test('--yes-recommended applies the visibly recommended one-helper Codex outcome', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const result = run(['--execute', '--repo-root', setupRepo, '--repo-remote', origin, '--yes-recommended', '--skip-codex-plugin-auto-refresh'], { env: isolatedHomeEnv(root) });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const ordinaryBank = result.stdout.split('<!-- setup-toolkit-question-bank:complete -->')[0];
  assert.doesNotMatch(ordinaryBank, /Codex helper agents|helper quantity/i);
  assert.match(result.stdout, /Helper-agent capacity questions shown: yes/);
  assert.match(result.stdout, /Codex helper-agent runtime: V2 \(multi_agent_v2\)/);
  assert.match(result.stdout, /Helper-capacity outcome this run: configured/);
  assert.match(result.stdout, /Configuration changed this run: yes/);
  assert.match(fs.readFileSync(codexConfig(root), 'utf8'), /max_concurrent_threads_per_session = 2/);
  assert.ok(backupFiles(root).length > 0);
});
