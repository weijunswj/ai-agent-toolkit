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
test('explicit limit previews path and block, creates backup, and writes only after setup succeeds', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const configPath = codexConfig(root);
  writeFile(configPath, 'model = "gpt-5.6"\r\n');
  const original = fs.readFileSync(configPath);
  const result = run([
    '--execute', '--repo-root', setupRepo, '--repo-remote', origin,
    '--yes-recommended', '--skip-codex-plugin-auto-refresh',
    '--codex-delegation-control', 'limit', '--codex-cli', createFakeCodexAppServer(root)
  ], { env: isolatedHomeEnv(root), timeout: 300000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, new RegExp(`Codex config path: ${escapeRegExp(configPath)}`));
  assert.match(result.stdout, /Proposed Toolkit-managed TOML block:[\s\S]*enabled = true[\s\S]*max_concurrent_threads_per_session = 2[\s\S]*root_agent_usage_hint_text/);
  assert.match(result.stdout, /Codex backup directory:/);
  assert.match(result.stdout, /Normal helper capacity: 1 helper agent; 2 total session threads including the main agent/);
  assert.match(result.stdout, /Exact backup metadata:/);
  assert.match(result.stdout, /Exact restore command \(PowerShell\):/);
  const configured = fs.readFileSync(configPath, 'utf8');
  assert.ok(configured.startsWith(original.toString('utf8')));
  assert.match(configured, /\[features\.multi_agent_v2\]\r?\n# AI-AGENT-TOOLKIT:BEGIN CODEX-V2-ENABLEMENT v1\r?\nenabled = true\r?\n# AI-AGENT-TOOLKIT:END CODEX-V2-ENABLEMENT\r?\n# AI-AGENT-TOOLKIT:BEGIN CODEX-HELPER-CAPACITY v3\r?\nmax_concurrent_threads_per_session = 2/);
  assert.ok(backupFiles(root).length > 0);
});

test('root-only choice maps V2 to one total session thread', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const result = run([
    '--execute', '--repo-root', setupRepo, '--repo-remote', origin,
    '--yes-recommended', '--skip-codex-plugin-auto-refresh', '--codex-helper-capacity', 'root-only'
  ], { env: isolatedHomeEnv(root), timeout: 300000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(fs.readFileSync(codexConfig(root), 'utf8'), /max_concurrent_threads_per_session = 1/);
  assert.match(result.stdout, /Normal helper capacity: 0 helper agents; 1 total session threads including the main agent/);
});

test('distinct piped answers follow the canonical question order without shifts', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const configPath = codexConfig(root);
  writeFile(configPath, 'model = "gpt-5.6"\n');
  const result = run([
    '--execute', '--repo-root', setupRepo, '--repo-remote', origin,
    '--codex-cli', createFakeCodexAppServer(root),
  ], {
    env: isolatedHomeEnv(root),
    input: ['disable', 'enable', 'default', 'one-helper', 'keep', 'install'].join('\n'),
    timeout: 300000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const bank = result.stdout.split('<!-- setup-toolkit-question-bank:complete -->')[0];
  assert.match(bank, /Some visible questions are already resolved by explicit setup flags/);
  // The Codex home exists, so 3.1 asks about the Codex plugin; the Codex hooks status line takes no answer line.
  assert.match(bank, /Reply with one line for each unresolved question in this exact order:[\s\S]*\*\*1\.2\*\* Automatic updates[\s\S]*\*\*1\.3\*\* Update reports[\s\S]*\*\*1\.4\*\* Report retention[\s\S]*\*\*2\.2\*\* Codex Toolkit maintenance[\s\S]*\*\*3\.1\*\* Keep Toolkit available in Codex\?/);
  assert.doesNotMatch(bank, /\*\*\d+\.\d+\*\* Toolkit hooks in Codex|\| \d+\.\d+ \| Toolkit hooks in Codex/);
  assert.match(bank, /\nStatus \(nothing to answer\): Toolkit hooks in Codex: /);
  assert.doesNotMatch(bank, /Reply with either:|: all recommended/);
  assert.match(result.stdout, /Setup choices confirmed before writes:[\s\S]*2\.2 Codex Toolkit maintenance: A - Keep current \(canonical: keep; effective: disable\)/);
  // Reports are already kept for seven days, so "enable" and "default" name the hidden twins of the
  // recommended Keep current and apply as keep, with the same effect.
  assert.match(result.stdout, /1\.3 Update reports: A - Keep current \(canonical: keep; effective: enable\)/);
  assert.match(result.stdout, /1\.4 Report retention: A - Keep current \(canonical: keep; effective: 7 days\)/);
  assert.doesNotMatch(result.stdout, /Codex helper agents:/);
  assert.match(result.stdout, /Question answers initially required: yes/);
  assert.match(result.stdout, /Question answers supplied by complete stdin: yes/);
  assert.match(result.stdout, /Question answers prompted interactively: no/);
  assert.match(result.stdout, /Question bank stopped for answers: no/);
  assert.match(fs.readFileSync(configPath, 'utf8'), /AI-AGENT-TOOLKIT:BEGIN CODEX-HELPER-CAPACITY/);
  const bridgeArgs = fs.readFileSync(path.join(setupRepo, 'BRIDGE_ARGS.log'), 'utf8');
  assert.match(bridgeArgs, /--disable-repo-auto-update/);
  assert.match(bridgeArgs, /--disable-update-report-open --write/);
  assert.doesNotMatch(bridgeArgs, /--enable-update-reports|--update-report-retention-days/);
  assert.doesNotMatch(bridgeArgs, /codex-plugin-auto-refresh/);
  assert.doesNotMatch(bridgeArgs, /--enable-target|--disable-target/);
});
