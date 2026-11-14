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
  test(`${host}: setup writes no task auto-merge answer, keeps an old one for governance to remove, and says where it moved`, () => {
    const root = tmpRoot();
    const { origin, setupRepo } = createGitBackedSetupRepo(root);
    // The fake bridge writes its invocation log inside this disposable source clone.
    fs.appendFileSync(path.join(setupRepo, '.git', 'info', 'exclude'), '\nBRIDGE_ARGS.log\n');
    const env = isolatedHomeEnv(root);
    const file = path.join(root, '.ai-agent-toolkit', 'user-state', `task-auto-merge.${host}.v1.json`);
    const args = ['--execute', '--host', host, '--repo-root', setupRepo, '--repo-remote', origin,
      '--yes-recommended', '--codex-helper-capacity', 'keep', '--claude-topology', 'keep', '--claude-plugin-behavior', 'instructions'];
    const fresh = run(args, { env });
    assert.ok([0, core.SETUP_ACTION_REQUIRED].includes(fresh.status), fresh.stderr || fresh.stdout);
    assert.equal(fs.existsSync(file), false, 'setup saves no per-app answer');
    assert.doesNotMatch(fresh.stdout, /May (Codex|Claude Code) merge|now lives in each repository's governance/);
    const old = JSON.stringify({ schema: 'toolkit.task-auto-merge-preferences.v1', host, value: 'after-gates' });
    writeFile(file, old);
    const upgraded = run(args, { env });
    assert.ok([0, core.SETUP_ACTION_REQUIRED].includes(upgraded.status), upgraded.stderr || upgraded.stdout);
    assert.match(upgraded.stdout, /Task auto-merge now lives in each repository's governance; say refresh governance to see or change it\./);
    assert.equal(fs.readFileSync(file, 'utf8'), old, 'only a governance read-back of the new switch removes it');
    const rejected = run([...args, '--task-auto-merge', 'after-gates'], { env });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /Unknown|Unsupported/i);
  });
}
