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
    input: ['enable', 'default', 'one-helper', 'keep', 'install'].join('\n'),
    timeout: 300000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const bank = result.stdout.split('<!-- setup-toolkit-question-bank:complete -->')[0];
  assert.match(bank, /Some visible questions are already resolved by explicit setup flags/);
  // The Codex home exists, so 3.1 asks about the Codex plugin; the Codex hooks status line takes no answer line.
  assert.match(bank, /Reply with one line for each unresolved question in this exact order:[\s\S]*\*\*1\.2\*\* Update reports[\s\S]*\*\*1\.3\*\* Report retention[\s\S]*\*\*2\.2\*\* Codex Toolkit maintenance[\s\S]*\*\*3\.1\*\* Keep Toolkit available in Codex\?/);
  assert.doesNotMatch(bank, /\*\*\d+\.\d+\*\* Toolkit hooks in Codex|\| \d+\.\d+ \| Toolkit hooks in Codex/);
  assert.match(bank, /\nStatus \(nothing to answer\): Toolkit hooks in Codex: /);
  assert.doesNotMatch(bank, /Reply with either:|: all recommended/);
  assert.match(result.stdout, /Setup choices confirmed before writes:[\s\S]*2\.2 Codex Toolkit maintenance: A - Keep current \(canonical: keep; effective: disable\)/);
  // Reports are already kept for seven days, so "enable" and "default" name the hidden twins of the
  // recommended Keep current and apply as keep, with the same effect.
  assert.match(result.stdout, /1\.2 Update reports: A - Keep current \(canonical: keep; effective: enable\)/);
  assert.match(result.stdout, /1\.3 Report retention: A - Keep current \(canonical: keep; effective: 7 days\)/);
  assert.doesNotMatch(result.stdout, /Codex helper agents:/);
  assert.match(result.stdout, /Question answers initially required: yes/);
  assert.match(result.stdout, /Question answers supplied by complete stdin: yes/);
  assert.match(result.stdout, /Question answers prompted interactively: no/);
  assert.match(result.stdout, /Question bank stopped for answers: no/);
  assert.match(fs.readFileSync(configPath, 'utf8'), /AI-AGENT-TOOLKIT:BEGIN CODEX-HELPER-CAPACITY/);
  const bridgeArgs = fs.readFileSync(path.join(setupRepo, 'BRIDGE_ARGS.log'), 'utf8');
  // Automatic updates are always on: setup records the managed checkout as the update source, with no switch.
  assert.match(bridgeArgs, /--repo-path \S+ --repo-branch main --repo-remote \S+ --enable-auto-sync --write/);
  assert.doesNotMatch(bridgeArgs, /--enable-repo-auto-update|--disable-repo-auto-update/);
  assert.match(bridgeArgs, /--disable-update-report-open --write/);
  assert.doesNotMatch(bridgeArgs, /--enable-update-reports|--update-report-retention-days/);
  assert.doesNotMatch(bridgeArgs, /codex-plugin-auto-refresh/);
  assert.doesNotMatch(bridgeArgs, /--enable-target|--disable-target/);
});

// A fake terminal for the question bank: each readline question is answered from `answers`, and the RAM
// Enter prompt is answered by `confirm`. Returns the bank result with what was asked at each prompt.
async function bankAtTerminal(flags, { answers = [], confirm = async () => true } = {}) {
  const args = core.parseArgs(['--execute', '--host', 'codex', '--yes-recommended', ...flags]);
  const questions = [];
  const asked = [];
  const result = await core.answerSetupQuestionBank(args, core.documentationFixtureState(), {
    isTTY: true,
    write() { return true; },
    createReadlineInterface() {
      return {
        async question(prompt) {
          questions.push(prompt);
          if (!answers.length) throw new Error(`terminal fixture exhausted at prompt: ${prompt}`);
          return answers.shift();
        },
        close() {},
      };
    },
    confirm: async effect => { asked.push(effect); return confirm(effect); },
  });
  return { args, questions, asked, result };
}

// The summary's "prompted interactively" reads the question interface, which the RAM Enter prompt closes
// before it asks. A helper count typed at the terminal is still a prompted answer.
test('a helper count typed at the terminal is reported as prompted interactively, even though the RAM Enter prompt follows', async () => {
  const run = await bankAtTerminal(['--codex-helper-capacity', 'custom'], { answers: ['2'] });
  assert.equal(run.args.codexHelperCount, 2);
  assert.deepEqual(run.questions, ['How many helper agents may Codex use? Enter a non-negative integer: ']);
  assert.deepEqual(run.asked, ['accept the RAM risk of 2 helpers']);
  assert.equal(run.result.answers_prompted_interactively, true);
});

test('a RAM Enter that is the only terminal prompt is reported as prompted interactively', async () => {
  const run = await bankAtTerminal(['--codex-helper-count', '2']);
  assert.deepEqual(run.questions, []);
  assert.deepEqual(run.asked, ['accept the RAM risk of 2 helpers']);
  assert.equal(run.result.answers_prompted_interactively, true);
});
