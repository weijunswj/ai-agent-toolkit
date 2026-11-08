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
for (const host of ['codex', 'claude-code']) {
  test(`${host}: setup applies On, Current and Off to only its own file`, () => {
    const root = tmpRoot();
    const { origin, setupRepo } = createGitBackedSetupRepo(root);
    // The fake bridge writes its invocation log inside this disposable source clone.
    fs.appendFileSync(path.join(setupRepo, '.git', 'info', 'exclude'), '\nBRIDGE_ARGS.log\n');
    const env = isolatedHomeEnv(root);
    const file = path.join(root, '.ai-agent-toolkit', 'user-state', `task-auto-merge.${host}.v1.json`);
    const other = path.join(root, '.ai-agent-toolkit', 'user-state', `task-auto-merge.${host === 'codex' ? 'claude-code' : 'codex'}.v1.json`);
    const args = ['--execute', '--host', host, '--repo-root', setupRepo, '--repo-remote', origin,
      '--yes-recommended', '--codex-helper-capacity', 'keep', '--claude-topology', 'keep', '--claude-plugin-behavior', 'instructions'];
    for (const [choice, expected] of [['after-gates', 'after-gates'], ['keep', 'after-gates'], ['off', 'off']]) {
      const before = fs.existsSync(file) ? fs.readFileSync(file) : null;
      const result = run([...args, '--task-auto-merge', choice], { env, taskAutoMergeQuestion: true });
      assert.ok([0, core.SETUP_ACTION_REQUIRED].includes(result.status), result.stderr || result.stdout);
      assert.equal(JSON.parse(fs.readFileSync(file)).value, expected);
      if (choice === 'keep') assert.deepEqual(fs.readFileSync(file), before);
      assert.equal(fs.existsSync(other), false);
      if (host === 'claude-code') assert.doesNotMatch(result.stdout, /May Codex|## Antigravity/);
    }
  });

  test(`${host}: task preference is not written before complete answers; unreadable records stop all writes`, () => {
    const root = tmpRoot();
    const env = isolatedHomeEnv(root);
    const file = path.join(root, '.ai-agent-toolkit', 'user-state', `task-auto-merge.${host}.v1.json`);
    const partial = run(['--execute', '--host', host, '--task-auto-merge', 'after-gates'], { env, input: '', taskAutoMergeQuestion: true });
    assert.equal(partial.status, core.SETUP_PAUSED_FOR_QUESTION_BANK);
    assert.equal(fs.existsSync(file), false);
    writeFile(file, 'unreadable');
    const blockedPlan = run(['--plan', '--host', host, '--json'], { env, taskAutoMergeQuestion: true });
    const row = JSON.parse(blockedPlan.stdout).question_bank.find(row => row.id === 'task-auto-merge');
    assert.equal(row.availability.status, 'blocked');
    const blocked = run(['--execute', '--host', host, '--yes-recommended'], { env, input: '', taskAutoMergeQuestion: true });
    assert.equal(blocked.status, 1);
    assert.match(blocked.stderr, /blocked|Could not read/);
    assert.equal(fs.readFileSync(file, 'utf8'), 'unreadable');
    assert.equal(fs.existsSync(path.join(root, '.ai-agent-toolkit', 'source')), false);
  });
}
