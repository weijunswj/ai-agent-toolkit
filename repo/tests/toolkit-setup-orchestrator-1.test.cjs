'use strict';

const test = require('node:test');
const {
  assert, fs, path, spawnSync, repoRoot, script, tmpRoot, isolatedHomeEnv, writeFile, createFakeCodexAppServer, run, runTestGit, escapeRegExp,
  createGitBackedSetupRepo, createGitBackedRealSetupRepo, createFakeManagedSetupScript,
  runWithUnclosedStdin, codexConfig, backupFiles, displayedBankReference, auditFixture, specsForAudit, parseConciseInFreshProcess
} = require('./toolkit-setup-test-support.cjs');
const core = require('../scripts/setup-toolkit-core.cjs');

test('restoration accepts only its dedicated forms before invoking the handler, for owners and agents', async (t) => {
  const delegation = require('../scripts/codex-delegation-config.cjs');
  const flag = delegation.RESTORE_FLAG;
  const metadata = path.join(tmpRoot(), 'backup metadata.json');
  const handler = t.mock.method(delegation, 'restoreCodexDelegationBackup', () => ({ status: 'restored' }));
  t.mock.method(console, 'log', () => {});
  const dedicated = [[flag, metadata], [`${flag}=${metadata}`]];
  const mixed = [
    ...['--plan', '--explain', '--explain=1.1', '--execute', '--help', '-h', '--json', '--extra', 'extra', flag, `${flag}=${metadata}`]
      .flatMap(extra => dedicated.flatMap(form => [[extra, ...form], [...form, extra]])),
    [flag], [flag, ''], [`${flag}=`], [flag, '--plan'], [flag, '--help'], [flag, '-h'],
  ];
  for (const environment of [{}, { CODEX_THREAD_ID: 'synthetic-agent' }, { CLAUDECODE: '1' }]) {
    for (const argv of mixed) {
      const before = handler.mock.callCount();
      await assert.rejects(core.main(argv, { environment }), /runs on its own|requires a backup metadata path/, argv.join(' '));
      assert.equal(handler.mock.callCount(), before, 'refuse before the recovery handler');
    }
    for (const argv of dedicated) {
      const before = handler.mock.callCount();
      assert.equal(await core.main(argv, { environment }), 0);
      assert.equal(handler.mock.callCount(), before + 1);
      assert.deepEqual(handler.mock.calls.at(-1).arguments, [metadata]);
    }
  }
});

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

for (const host of ['codex', 'claude-code']) {
  for (const mode of [['--plan'], ['--plan', '--json'], ['--explain', '1.1']]) {
    for (const state of ['missing', 'current', 'legacy', 'malformed', 'unreadable']) {
      test(`${host} ${mode.join(' ')} with ${state} nested state is observational even with write choices`, () => {
        const root = tmpRoot();
        const env = isolatedHomeEnv(root);
        const config = require('../scripts/codex-delegation-config.cjs');
        const files = {
          '.codex/config.toml': state === 'legacy'
            ? `[agents]\n${config.CODEX_DELEGATION_BEGIN}\nmax_threads = 2\nmax_depth = 1\n${config.CODEX_DELEGATION_END}\n`
            : `[features.multi_agent_v2]\n${config.expectedV2Block(1, '\n')}\n`,
          '.claude/settings.json': JSON.stringify({ env: { CLAUDE_CODE_MAX_SUBAGENT_DEPTH: '1' } }),
          [`.ai-agent-toolkit/agent-control/profiles/${host}.json`]: JSON.stringify({ schema: 1, host,
            topology: state === 'legacy' ? 'retired' : 'broader-native', capacity_mode: 'root-only', manual_maximum: 0,
            worker_estimate_bytes: 1024, queue_limit: 4, reservation_limit: 4, updated_at: '2026-01-01T00:00:00Z' }),
          '.ai-agent-toolkit/current/state.json': JSON.stringify({ schema_version: 1, architecture_version: 2,
            auto_sync_enabled: true, repo_auto_update_enabled: true, update_report_enabled: true,
            update_report_open_enabled: state === 'legacy',
            ...(state === 'legacy' ? { targets: { retired: { enabled: true } } } : {}) }),
          '.ai-agent-toolkit/current/manifest.json': JSON.stringify({ schema_version: 1, assets: [] }),
          [`.ai-agent-toolkit/user-state/task-auto-merge.${host}.v1.json`]: JSON.stringify({ schema: 'toolkit.task-auto-merge-preferences.v1', host, value: 'after-gates' }),
        };
        if (state !== 'missing') {
          for (const [rel, text] of Object.entries(files)) writeFile(path.join(root, rel), state === 'malformed' ? '{ malformed' : text);
          writeFile(path.join(root, '.ai-agent-toolkit', 'agent-control', 'backups', 'existing.json'), 'existing backup\n');
        }
        // Exercise real readers, with permission errors injected rather than Windows ACL changes.
        // Only the existing read-only audit, isolated TOML parser and local git inspection may launch.
        const preload = path.join(root, 'plan-guard.cjs');
        writeFile(preload, `
          const fs = require('node:fs');
          const cp = require('node:child_process');
          const path = require('node:path');
          const denied = new Set(${JSON.stringify(Object.keys(files).map(rel => path.join(root, rel)))});
          const read = fs.readFileSync;
          fs.readFileSync = function(file, ...args) {
            if (${state === 'unreadable'} && denied.has(String(file))) throw Object.assign(new Error('synthetic unreadable state'), { code: 'EACCES' });
            return read.call(this, file, ...args);
          };
          for (const name of ['writeFileSync', 'appendFileSync', 'mkdirSync', 'renameSync', 'unlinkSync', 'rmSync', 'copyFileSync', 'chmodSync']) {
            fs[name] = () => { throw new Error('planning attempted a filesystem mutation: ' + name); };
          }
          const spawnSync = cp.spawnSync;
          cp.spawnSync = function(command, args, ...rest) {
            const audit = command === process.execPath && path.basename(args[0] || '') === 'toolkit-local-bridge.cjs' && args.includes('--audit');
            const localGit = /^(git|git.exe)$/i.test(path.basename(command)) && ['rev-parse', 'branch', 'remote', 'status', 'log'].includes(args[0]) && !args.includes('fetch');
            const toml = ['py', 'python3', 'python', process.env.AI_AGENT_TOOLKIT_PYTHON].includes(command)
              && JSON.stringify(args.slice(0, -1)) === JSON.stringify(command === 'py' ? ['-3', '-I', '-c'] : ['-I', '-c'])
              && args.at(-1).includes('tomllib');
            if (!audit && !localGit && !toml) throw new Error('planning attempted an unexpected process: ' + command);
            return spawnSync.call(this, command, args, ...rest);
          };
          cp.spawn = cp.exec = cp.execSync = cp.execFile = cp.execFileSync = () => { throw new Error('planning attempted a host session or task'); };
          for (const name of ['node:net', 'node:tls', 'node:http', 'node:https']) {
            const api = require(name);
            for (const key of ['connect', 'createConnection', 'request', 'get']) if (api[key]) api[key] = () => { throw new Error('planning attempted network'); };
          }
        `);
        const before = snapshotTree(root);
        const result = run([...mode, '--host', host, '--yes-recommended', '--task-auto-merge', 'after-gates',
          '--enable-repo-auto-update', '--enable-codex-plugin-auto-refresh', '--claude-settings', 'enable'], {
          env: { ...env, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require="${preload.replace(/\\/g, '/')}"` },
          taskAutoMergeQuestion: true,
        });
        assert.equal(result.status, 0, result.stderr || result.stdout);
        assert.doesNotMatch(result.stdout + result.stderr, /planning attempted/);
        assert.deepEqual(snapshotTree(root), before, 'existing bytes and every newly created path');
      });
    }
  }
}

test('drive, spaced, UNC and file URL values remain non-concise in a fresh parser process', () => {
  const specs = specsForAudit(auditFixture());
  for (const value of [
    'C:\\Toolkit Source',
    'C:\\Toolkit Source With Spaces',
    '\\\\server\\share\\Toolkit Source',
    'file:///C:/Toolkit%20Source',
  ]) {
    const parsed = parseConciseInFreshProcess(specs, value);
    assert.equal(parsed.status, 0, parsed.stderr);
    assert.equal(parsed.stdout, 'accepted');
  }
});

test('plan mode remains read-only and exposes the existing setup journey', () => {
  const root = tmpRoot();
  const result = run(['--plan', '--json'], { env: isolatedHomeEnv(root) });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.name, 'setup toolkit');
  assert.deepEqual(plan.steps.map((step) => step.id), [
    'upfront_setup_checklist', 'managed_main_checkout', 'codex_native_plugin_cache',
    'lite_validation', 'bridge_preferences',
    'final_bridge_audit', 'host_delegation_control', 'final_summary'
  ]);
  assert.equal(fs.existsSync(path.join(root, '.ai-agent-toolkit')), false);
});

test('Claude Code plan omits unsupported automatic admission and never emits Codex config work', () => {
  const root = tmpRoot();
  const result = run(['--plan', '--json', '--host', 'claude-code'], { env: { ...isolatedHomeEnv(root), PATH: '' } });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.host, 'claude-code');
  assert.equal(plan.preferences.helper_capacity_backstop, 'root-only');
  assert.equal(plan.question_bank.some((row) => row.key === 'claudeAgentCapacity'), false);
  assert.doesNotMatch(plan.steps.flatMap((step) => step.commands || []).join('\n'), /agents\.max_threads|agents\.max_depth/);
});

test('plain and JSON plans expose the one-helper recommendation', () => {
  const root = tmpRoot();
  const plain = run(['--plan'], { env: isolatedHomeEnv(root) });
  const json = run(['--plan', '--json'], { env: isolatedHomeEnv(root) });
  assert.equal(plain.status, 0, plain.stderr);
  assert.equal(json.status, 0, json.stderr);
  assert.doesNotMatch(plain.stdout, /Codex helper agents|how many helper|custom number/i);
  const plan = JSON.parse(json.stdout);
  assert.equal(plan.question_bank.find((row) => row.key === 'codexHelperCapacity').recommended, 'one-helper');
  assert.equal(plan.preferences.helper_capacity_backstop, 'one-helper');
});

test('canonical question specification orders delegation before plugin auto-refresh for TTY and stdin', () => {
  const args = core.parseArgs(['--execute']);
  const current = {
    managed: { currentPath: '', selectedPath: '', defaultPath: '', exists: false, git: false, dirty: false, branch: '', remote: '' },
    audit: { repo_auto_update: {}, targets: {} },
    delegation: { status: 'unconfigured', detail: 'not configured' },
    nativePlugin: { status: 'not checked' },
  };
  const keys = core.setupQuestionSpecs(args, current).map((spec) => spec.key);
  assert.deepEqual(keys, [
    'managedCheckout', 'repoAutoUpdate', 'updateReports', 'updateReportRetention', 'codexDocLimit', 'codexHelperCapacity', 'codexPluginAutoRefresh', 'taskAutoMerge',
  ]);
  assert.equal(args.setupChoices.codexHelperCapacity, '');
});

test('agent-facing setup docs match the report question rows', () => {
  const args = core.parseArgs(['--plan']);
  const current = {
    managed: { currentPath: '', selectedPath: '', defaultPath: '', exists: false, git: false, dirty: false, branch: '', remote: '' },
    audit: { repo_auto_update: {}, targets: {} },
    delegation: { status: 'unconfigured', detail: 'not configured' },
    nativePlugin: { status: 'not checked' },
  };
  const reportRows = core.setupQuestionSpecs(args, current)
    .filter((spec) => /report/i.test(`${spec.key} ${spec.title}`));
  assert.deepEqual(reportRows.map((spec) => spec.key), ['updateReports', 'updateReportRetention']);
  assert.equal(reportRows.some((spec) => /open/i.test(spec.key)), false);

  const docs = [
    'repo/docs/FOR_AI_AGENTS.md',
    'repo/docs/HOW-TO-USE.md',
    'repo/docs/TOOLKIT-LOCAL-BRIDGE.md',
    'skills/toolkit-setup/SKILL.md',
  ];
  for (const relPath of docs) {
    const text = fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
    assert.match(text, /report creation|update report writes|meaningful update reports (?:stay|are) enabled/i, relPath);
    assert.match(text, /report creation and retention|report(?:\/log)? retention|reports\/logs older than|reports.*kept for/i, relPath);
    assert.match(text, /(?:action-required|failed or safety-blocked|reports (?:needing|requiring) action)[^.;\n]{0,120}open automatically/i, relPath);
    assert.match(text, /successful[^.;\n]{0,100}reports (?:remain|stay) closed/i, relPath);
    assert.doesNotMatch(text, /(?:question bank|wizard)[^.\n]*(?:report auto-open|report opening)/i, relPath);
    assert.doesNotMatch(text, /(?:ask|answer|pipe|choice)[^.\n]{0,100}(?:report auto-open|report opening)/i, relPath);
  }
});

test('canonical wizard renderer is compact, aligned, and free of implementation vocabulary', () => {
  const args = core.parseArgs(['--plan']);
  const current = {
    managed: { currentPath: '', selectedPath: 'C:\\hidden', defaultPath: 'C:\\hidden', exists: false, git: false, dirty: false, branch: '', remote: '' },
    audit: {
      repo_auto_update: { enabled: false },
      update_report_enabled: true,
      update_report_open_enabled: true,
      update_report_retention_days: 7,
      codex_plugin_auto_refresh_enabled: false,
    },
    runtime: { runtime: 'MultiAgentV2' },
    delegation: { status: 'unconfigured', helper_count: null, detail: 'technical detail' },
    nativePlugin: { status: 'fresh' },
  };
  const planned = core.plannedQuestionBank(args, current);
  const text = core.renderSetupQuestionBank(planned.specs);
  const terminal = core.renderSetupQuestionBankTerminal(planned.specs);
  assert.match(text, /## 1\. Updates and reports[\s\S]*## 2\. Computer performance/);
  assert.doesNotMatch(text, /## \d+\. Toolkit in your coding apps/);
  assert.doesNotMatch(text, /Update report auto-open|MultiAgentV[12]|max_threads|max_concurrent|AI-AGENT-TOOLKIT|PR #|issue #|C:\\|restore command|migration/i);
  assert.doesNotMatch(text, /Codex helper agents|One helper at most|Use a custom number/i);
  assert.doesNotMatch(text, /\bAdvanced(?: options)?\b|Show advanced choices|More options/);
  assert.doesNotMatch(text, /\*\*Choices:\*\*[^\n]*(?:\/|\|)/);
  assert.doesNotMatch(terminal, /Codex helper agents|One helper at most|Use a custom number/i);
  assert.doesNotMatch(terminal, /Choices:[^\n]*(?:\/|,)/);
  assert.match(text, /Bank reference: [\s\S]*Reply with either:[\s\S]*- `all recommended`[\s\S]*setup-toolkit-question-bank:complete/);
  for (const spec of planned.specs) assert.ok(spec.description.split(/(?<=[.!?])\s+/).filter(Boolean).length <= 2, spec.key);

  current.delegation.helper_count = 4;
  assert.equal(core.setupQuestionSpecs(args, current).find((spec) => spec.key === 'codexHelperCapacity').recommended, 'one-helper');
});

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

test('partial explicit flags reject concise input before writes and accept only the displayed ordered contract', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const args = ['--execute', '--repo-root', setupRepo, '--repo-remote', origin];
  const env = isolatedHomeEnv(root);
  const preview = run(args, { env, input: '' });
  const reference = displayedBankReference(preview.stdout);
  assert.match(preview.stdout, /Some visible questions are already resolved by explicit setup flags/);
  assert.doesNotMatch(preview.stdout, /Reply with either:/);

  const rejected = run(args, { env, input: `${reference}: all recommended\n` });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /Concise bank-reference answers are not accepted when explicit setup flags already resolved part of the bank/);
  assert.equal(fs.existsSync(path.join(setupRepo, 'BRIDGE_ARGS.log')), false);
  assert.equal(fs.existsSync(path.join(setupRepo, 'PLUGIN_SETUP.log')), false);

  const accepted = run(args, {
    env,
    input: ['disable', 'enable', 'default', 'one-helper', 'keep'].join('\n'),
    timeout: 300000,
  });
  assert.equal(accepted.status, 0, accepted.stderr || accepted.stdout);
  assert.match(accepted.stdout, /1\.2 Automatic updates: C - Turn off/);
});

test('multiple explicit flags render and accept one remaining ordered non-TTY answer', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const result = run([
    '--execute', '--repo-root', setupRepo, '--repo-remote', origin,
    '--enable-repo-auto-update', '--enable-update-reports', '--default-update-report-retention-days',
  ], { env: isolatedHomeEnv(root), input: 'keep\nA\n', timeout: 300000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const bank = result.stdout.split('<!-- setup-toolkit-question-bank:complete -->')[0];
  const guide = bank.slice(bank.indexOf('Some visible questions'));
  // Maintenance is off already, so Turn off folds into Keep current and A is Keep current.
  assert.match(guide, /\*\*2\.2\*\* Codex Toolkit maintenance \[A-B\]/);
  assert.doesNotMatch(guide, /\*\*1\.2\*\* Automatic updates \[A-C\]|: all recommended/);
  assert.match(result.stdout, /2\.2 Codex Toolkit maintenance: A - Keep current \(canonical: keep; effective: disable\)/);
});

test('choice-activated custom checkout detail is rendered and consumed in the canonical post-answer block', () => {
  const root = tmpRoot();
  const { origin } = createGitBackedSetupRepo(root);
  const customPath = path.join(root, 'Chosen Managed Source');
  const result = run(['--execute', '--repo-remote', origin, '--enable-repo-auto-update'], {
    env: isolatedHomeEnv(root),
    input: ['custom', 'A', 'A', 'keep', 'A', customPath].join('\n'),
    timeout: 300000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const bank = result.stdout.split('<!-- setup-toolkit-question-bank:complete -->')[0];
  assert.match(bank, /After those question-answer lines, append detail lines in this exact canonical order[\s\S]*1\. 1\.1 Update source: custom managed-checkout path \(when 1\.1 is [A-Z]+\/custom/);
  assert.match(result.stdout, /Detail 1 1\.1 Update source: custom managed-checkout path - custom path supplied \(value remains private\)/);
  assert.equal(fs.existsSync(path.join(customPath, 'BRIDGE_ARGS.log')), true);
});

test('choice-activated custom retention detail follows the displayed canonical order', () => {
  const root = tmpRoot();
  const { origin } = createGitBackedSetupRepo(root);
  const result = run(['--execute', '--repo-remote', origin, '--enable-repo-auto-update'], {
    env: isolatedHomeEnv(root),
    input: ['A', 'A', 'B', 'keep', 'A', '14'].join('\n'),
    timeout: 300000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /2\. 1\.4 Report retention: positive report-retention duration in days \(when 1\.4 is B\/custom/);
  assert.match(result.stdout, /Detail 2 1\.4 Report retention: positive report-retention duration in days - 14 days/);
});

test('simultaneous custom checkout and retention consume details in displayed order', () => {
  const root = tmpRoot();
  const { origin } = createGitBackedSetupRepo(root);
  const customPath = path.join(root, 'Two Detail Managed Source');
  const result = run(['--execute', '--repo-remote', origin, '--enable-repo-auto-update'], {
    env: isolatedHomeEnv(root),
    input: ['custom', 'A', 'B', 'keep', 'A', customPath, '21'].join('\n'),
    timeout: 300000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const bank = result.stdout.split('<!-- setup-toolkit-question-bank:complete -->')[0];
  assert.ok(bank.indexOf('1. 1.1 Update source: custom managed-checkout path') < bank.indexOf('2. 1.4 Report retention: positive report-retention duration'));
  assert.ok(result.stdout.indexOf('Detail 1 1.1 Update source') < result.stdout.indexOf('Detail 2 1.4 Report retention'));
  assert.match(result.stdout, /Detail 2 1\.4 Report retention:[^\n]*21 days/);
  assert.equal(fs.existsSync(path.join(customPath, 'BRIDGE_ARGS.log')), true);
});

test('preselected path and helper details share rendering consumption and summary order with custom retention', () => {
  const root = tmpRoot();
  const { origin } = createGitBackedSetupRepo(root);
  const customPath = path.join(root, 'Preselected Detail Source');
  const result = run([
    '--execute', '--repo-remote', origin, '--managed-checkout', 'custom', '--enable-repo-auto-update',
    '--codex-helper-capacity', 'custom', '--codex-cli', createFakeCodexAppServer(root),
    '--approve-codex-config-proposal',
  ], {
    env: isolatedHomeEnv(root),
    input: ['A', 'B', 'A', customPath, '30', '1'].join('\n'),
    timeout: 300000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const bank = result.stdout.split('<!-- setup-toolkit-question-bank:complete -->')[0];
  const rendered = [
    bank.indexOf('1. 1.1 Update source: custom managed-checkout path'),
    bank.indexOf('2. 1.4 Report retention: positive report-retention duration'),
    bank.indexOf('3. 2.1 Codex helper capacity: bounded Codex helper count'),
  ];
  assert.ok(rendered.every((index) => index >= 0) && rendered[0] < rendered[1] && rendered[1] < rendered[2]);
  const summary = [
    result.stdout.indexOf('Detail 1 1.1 Update source'),
    result.stdout.indexOf('Detail 2 1.4 Report retention'),
    result.stdout.indexOf('Detail 3 2.1 Codex helper capacity'),
  ];
  assert.ok(summary.every((index) => index >= 0) && summary[0] < summary[1] && summary[1] < summary[2]);
});

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
