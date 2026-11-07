'use strict';
const test = require('node:test');
const {
  assert, fs, path, spawnSync, repoRoot, script, tmpRoot, isolatedHomeEnv, writeFile, run, runTestGit, escapeRegExp,
  createGitBackedSetupRepo, createGitBackedRealSetupRepo, createFakeManagedSetupScript,
  runWithUnclosedStdin, codexConfig, backupFiles
} = require('./toolkit-setup-test-support.cjs');
function runOwnManagedSetup(root, origin, managedPath) {
  const managedScript = path.join(managedPath, 'repo', 'scripts', 'setup-toolkit.cjs');
  return spawnSync(process.execPath, [managedScript, '--execute', '--profile', 'auto-main', '--repo-remote', origin, '--yes-recommended', '--skip-codex-plugin-auto-refresh'], {
    cwd: managedPath, encoding: 'utf8', env: { ...process.env, ...isolatedHomeEnv(root) }, timeout: 300000, windowsHide: true
  });
}
function pushToOrigin(setupRepo, rel, text) {
  writeFile(path.join(setupRepo, ...rel.split('/')), text);
  runTestGit(setupRepo, ['add', rel]);
  runTestGit(setupRepo, ['commit', '-m', `update ${rel}`]);
  runTestGit(setupRepo, ['push', 'origin', 'main']);
  return runTestGit(setupRepo, ['rev-parse', 'HEAD']).trim();
}

// Split by complete test declarations to keep the per-file time budget.
test('Security policy never raises normal capacity or relabels sequential review as Deep Scan', () => {
  const core = fs.readFileSync(path.join(repoRoot, 'repo/scripts/setup-toolkit-core.cjs'), 'utf8');
  const delegation = fs.readFileSync(path.join(repoRoot, 'repo/scripts/codex-delegation-common.cjs'), 'utf8');
  const docs = fs.readFileSync(path.join(repoRoot, 'repo/docs/TOOLKIT-LOCAL-BRIDGE.md'), 'utf8');
  assert.match(delegation, /CODEX_V2_RAM_SAFE_HELPERS = 1/);
  assert.doesNotMatch(delegation, /CODEX_V2_RAM_SAFE_HELPERS = [7-9]/);
  assert.match(core, /normal global capacity is never raised automatically/i);
  assert.match(core, /explicitly make a temporary global increase with exact backup, restart, restoration, and another restart/i);
  assert.match(core, /A sequential custom review is not an official Deep Security Scan/i);
  assert.match(docs, /No documented Codex Security scan-scoped capacity activation exists/i);
  assert.match(docs, /explicitly approved temporary global increase with backup and restoration/i);
});

for (const [label, rel, edit] of [
  ['its own scripts', 'repo/scripts/setup-self-update-marker.cjs', () => "'use strict';\n"],
  // A release that changes only the version (the version source and plugin metadata) stops it too.
  ['only the version source', 'repo/contracts/toolkit-local-bridge/version.json',
    text => {
      const source = JSON.parse(text || fs.readFileSync(path.join(repoRoot, 'repo', 'contracts', 'toolkit-local-bridge', 'version.json'), 'utf8'));
      return `${JSON.stringify({ ...source, version_notes: `${source.version_notes} (updated)` }, null, 2)}\n`;
    }],
]) test(`setup that updates ${label} stops before plugin and config steps, and the next run finishes`, () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedRealSetupRepo(root);
  const managedPath = path.join(root, '.ai-agent-toolkit', 'source', 'ai-agent-toolkit');
  runTestGit(root, ['clone', '--branch', 'main', origin, managedPath]);
  const current = fs.existsSync(path.join(setupRepo, ...rel.split('/'))) ? fs.readFileSync(path.join(setupRepo, ...rel.split('/')), 'utf8') : '';
  const updated = pushToOrigin(setupRepo, rel, edit(current));

  const first = runOwnManagedSetup(root, origin, managedPath);
  assert.equal(first.status, 24, first.stderr || first.stdout);
  assert.match(first.stdout, /## Setup updated itself\nSetup updated its Toolkit copy from [0-9a-f]{7} to [0-9a-f]{7}, and the update changed setup's own scripts\./);
  assert.match(first.stdout, /Run the same setup command again/);
  assert.equal(runTestGit(managedPath, ['rev-parse', 'HEAD']).trim(), updated);
  assert.equal(fs.existsSync(codexConfig(root)), false);
  assert.doesNotMatch(first.stdout, /Configuration changed this run/);

  const second = runOwnManagedSetup(root, origin, managedPath);
  assert.equal(second.status, 0, second.stderr || second.stdout);
  assert.doesNotMatch(second.stdout, /## Setup updated itself/);
  assert.equal(fs.existsSync(codexConfig(root)), true);
});

test('an update outside setup scripts does not stop the setup run', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedRealSetupRepo(root);
  const managedPath = path.join(root, '.ai-agent-toolkit', 'source', 'ai-agent-toolkit');
  runTestGit(root, ['clone', '--branch', 'main', origin, managedPath]);
  pushToOrigin(setupRepo, 'repo/docs/NOTE.md', 'docs only\n');

  const result = runOwnManagedSetup(root, origin, managedPath);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(result.stdout, /## Setup updated itself/);
  assert.equal(fs.existsSync(codexConfig(root)), true);
});
