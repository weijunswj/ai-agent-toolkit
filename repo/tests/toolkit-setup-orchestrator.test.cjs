'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const script = path.join(repoRoot, 'repo', 'scripts', 'setup-toolkit.cjs');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-setup-'));
}

function isolatedHomeEnv(root) {
  return {
    PATH: process.env.PATH || '',
    USERPROFILE: root,
    HOME: root,
    LOCALAPPDATA: path.join(root, 'local-app-data'),
    VIRTUAL_ENV: '',
    CONDA_PREFIX: '',
    UV_PYTHON: ''
  };
}

function writeFile(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, 'utf8');
}

function run(args, options = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}) },
    timeout: 15000,
    windowsHide: true
  });
}

function createMinimalSetupRepo(root) {
  writeFile(path.join(root, 'AGENTS.md'), '# fake toolkit repo\n');
  writeFile(path.join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({
    name: 'ai-agent-toolkit',
    version: '2.2.0',
    skills: './skills',
    hooks: './.claude-plugin/hooks/hooks.json'
  }, null, 2));
  writeFile(path.join(root, '.claude-plugin', 'hooks', 'hooks.json'), JSON.stringify({
    hooks: {
      SessionStart: [
        {
          matcher: '*',
          hooks: [
            {
              type: 'command',
              command: 'node "${CLAUDE_PLUGIN_ROOT}/repo/scripts/toolkit-local-bridge.cjs" --hook --sync-enabled --write --sync-source claude-plugin'
            }
          ]
        }
      ]
    }
  }, null, 2));
  writeFile(path.join(root, 'repo', 'scripts', 'setup-codex-toolkit-plugin.cjs'), [
    "'use strict';",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "fs.appendFileSync(path.join(process.cwd(), 'PLUGIN_SETUP.log'), `${process.argv.slice(2).join(' ')}\\n`);",
    "process.stdout.write(JSON.stringify({ ok: true }));",
    'process.exit(0);',
    ''
  ].join('\n'));
  writeFile(path.join(root, 'repo', 'scripts', 'toolkit-local-bridge.cjs'), [
    "'use strict';",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const args = process.argv.slice(2);",
    "fs.appendFileSync(path.join(process.cwd(), 'BRIDGE_ARGS.log'), `${args.join(' ')}\\n`);",
    "if (args.includes('--audit')) {",
    "  process.stdout.write(JSON.stringify({",
    "    repo_auto_update: { last_status: 'configured' },",
    "    update_report_cleanup: { retention_days: 7, deleted_count: 0, error_count: 0, report_log_directory: path.join(process.cwd(), 'tmp-reports') },",
    "    targets: { opencode: { enabled: args.includes('opencode'), status: 'synced' }, ag2: { enabled: args.includes('ag2'), status: 'synced' } }",
    "  }));",
    "}",
    'process.exit(0);',
    ''
  ].join('\n'));
  writeFile(path.join(root, 'repo', 'scripts', 'validate-toolkit.cjs'), "'use strict';\nprocess.exit(0);\n");
  writeFile(path.join(root, 'repo', 'tests', 'toolkit-local-bridge-hook-light.test.cjs'), [
    "'use strict';",
    "const test = require('node:test');",
    "test('fake hook light', () => {});",
    ''
  ].join('\n'));
}

function runTestGit(cwd, args) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: 30000,
    windowsHide: true
  });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return (result.stdout || '').trim();
}

function createGitBackedSetupRepo(root) {
  const origin = path.join(root, 'origin.git');
  const setupRepo = path.join(root, 'repo');
  fs.mkdirSync(setupRepo, { recursive: true });
  runTestGit(root, ['init', '--bare', origin]);
  runTestGit(setupRepo, ['init']);
  runTestGit(setupRepo, ['checkout', '-b', 'main']);
  runTestGit(setupRepo, ['config', 'user.email', 'setup-test@example.invalid']);
  runTestGit(setupRepo, ['config', 'user.name', 'Setup Test']);
  createMinimalSetupRepo(setupRepo);
  runTestGit(setupRepo, ['add', '.']);
  runTestGit(setupRepo, ['commit', '-m', 'base']);
  runTestGit(setupRepo, ['remote', 'add', 'origin', origin]);
  runTestGit(setupRepo, ['push', '-u', 'origin', 'main']);
  return { origin, setupRepo };
}

function flattenCommands(plan) {
  return plan.steps.flatMap((step) => step.commands || []);
}

test('setup toolkit plan shows one upfront checklist and managed main checkout defaults', () => {
  const root = tmpRoot();
  const result = run(['--plan', '--json'], {
    env: isolatedHomeEnv(root)
  });
  assert.equal(result.status, 0, result.stderr);

  const plan = JSON.parse(result.stdout);
  const managedPath = path.join(root, '.ai-agent-toolkit', 'source', 'ai-agent-toolkit');
  assert.equal(plan.name, 'setup toolkit');
  assert.equal(plan.managed_source.path, managedPath);
  assert.equal(plan.managed_source.branch, 'main');
  assert.equal(plan.managed_source.remote, 'https://github.com/weijunswj/ai-agent-toolkit');
  assert.match(plan.checklist_explanation, /\*\*Toolkit will use a dedicated clean `main` checkout as the single update source\./);
  assert.deepEqual(plan.steps.map((step) => step.id), [
    'upfront_setup_checklist',
    'managed_main_checkout',
    'codex_native_plugin_cache',
    'lite_validation',
    'bridge_preferences',
    'approved_target_sync',
    'final_summary'
  ]);
  assert.deepEqual(plan.preferences, {
    repo_backed_auto_update: true,
    host_native_plugin_cache_auto_refresh: true,
    write_meaningful_update_reports: true,
    open_update_reports_automatically: false,
    update_report_retention_days: 7,
    opencode_sync: 'disabled',
    ag2_antigravity_sync: 'disabled'
  });

  const commands = flattenCommands(plan).join('\n');
  assert.match(commands, /git clone --branch main/);
  assert.match(commands, /git merge --ff-only FETCH_HEAD/);
  assert.match(commands, /--enable-repo-auto-update/);
  assert.match(commands, /--enable-update-reports --update-report-retention-days 7 --disable-update-report-open --write/);
  assert.match(commands, /--enable-codex-plugin-auto-refresh --write/);
  assert.doesNotMatch(commands, /repo\/tests\/toolkit-local-bridge\.test\.cjs/);
  assert.doesNotMatch(commands, /npm\s+run\s+validate:all/);
  assert.equal(fs.existsSync(path.join(root, '.ai-agent-toolkit')), false, 'plan mode must not write user-local source or bridge state');
});

test('claude-code setup plan checks only Claude native plugin metadata and never Codex cache', () => {
  const root = tmpRoot();
  const result = run(['--plan', '--json', '--host', 'claude-code'], {
    env: isolatedHomeEnv(root)
  });
  assert.equal(result.status, 0, result.stderr);

  const plan = JSON.parse(result.stdout);
  assert.equal(plan.host, 'claude-code');
  assert.deepEqual(plan.steps.map((step) => step.id), [
    'upfront_setup_checklist',
    'managed_main_checkout',
    'claude_native_plugin_cache',
    'lite_validation',
    'bridge_preferences',
    'approved_target_sync',
    'final_summary'
  ]);
  assert.equal(plan.preferences.host_native_plugin_cache_auto_refresh, 'manual-verification-only');
  assert.doesNotMatch(flattenCommands(plan).join('\n'), /setup-codex-toolkit-plugin\.cjs/);
});

test('setup execute persists all selected preferences in one run and prints final summary', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const result = run([
    '--execute',
    '--repo-root', setupRepo,
    '--repo-remote', origin,
    '--enable-update-report-open',
    '--enable-target', 'ag2'
  ], {
    env: isolatedHomeEnv(root)
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(result.stdout, /SETUP PAUSED/);
  assert.match(result.stdout, /# setup toolkit checklist/);
  assert.match(result.stdout, /# setup toolkit final summary/);
  assert.match(result.stdout, /Managed checkout path:/);
  assert.match(result.stdout, /Update report\/log retention days: 7/);
  assert.match(result.stdout, /Skipped target writes:/, 'OpenCode should remain disabled when only ag2 is selected');

  const bridgeLog = fs.readFileSync(path.join(setupRepo, 'BRIDGE_ARGS.log'), 'utf8');
  assert.match(bridgeLog, /--enable-repo-auto-update/);
  assert.match(bridgeLog, /--enable-update-reports --update-report-retention-days 7 --enable-update-report-open --write/);
  assert.match(bridgeLog, /--enable-codex-plugin-auto-refresh --write/);
  assert.match(bridgeLog, /--enable-target ag2 --write/);
  assert.doesNotMatch(bridgeLog, /--enable-target opencode/);
});

test('setup execute creates missing managed checkout by cloning the expected remote', () => {
  const root = tmpRoot();
  const { origin } = createGitBackedSetupRepo(root);
  const managedPath = path.join(root, '.ai-agent-toolkit', 'source', 'ai-agent-toolkit');
  const result = run([
    '--execute',
    '--repo-root', managedPath,
    '--repo-remote', origin,
    '--skip-codex-plugin-auto-refresh'
  ], {
    env: isolatedHomeEnv(root)
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(path.join(managedPath, 'AGENTS.md')), true);
  assert.equal(runTestGit(managedPath, ['branch', '--show-current']), 'main');
  assert.match(result.stdout, /Managed checkout path:/);
});

test('setup execute refuses local managed checkout divergence before plugin setup', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  writeFile(path.join(setupRepo, 'LOCAL_ONLY.md'), 'local-only\n');
  runTestGit(setupRepo, ['add', 'LOCAL_ONLY.md']);
  runTestGit(setupRepo, ['commit', '-m', 'local only']);

  const result = run(['--execute', '--repo-root', setupRepo, '--repo-remote', origin], {
    env: isolatedHomeEnv(root)
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cannot fast-forward/i);
  assert.equal(fs.existsSync(path.join(setupRepo, 'PLUGIN_SETUP.log')), false, 'plugin setup must not run from local-only commits');
});

test('claude-code setup execute verifies Claude plugin metadata and skips Codex helper', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const result = run([
    '--execute',
    '--host', 'claude-code',
    '--repo-root', setupRepo,
    '--repo-remote', origin,
    '--skip-update-report-open',
    '--enable-target', 'ag2'
  ], {
    env: isolatedHomeEnv(root)
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Claude Code native plugin metadata verified/);
  assert.equal(fs.existsSync(path.join(setupRepo, 'PLUGIN_SETUP.log')), false, 'Claude setup must not call the Codex helper');
  const bridgeLog = fs.readFileSync(path.join(setupRepo, 'BRIDGE_ARGS.log'), 'utf8');
  assert.match(bridgeLog, /--enable-repo-auto-update/);
  assert.doesNotMatch(bridgeLog, /--enable-codex-plugin-auto-refresh/);
  assert.match(bridgeLog, /--enable-target ag2 --write/);
});

test('setup docs route setup and refresh prompts to the one-checklist orchestrator', () => {
  const relPaths = [
    '_projects/development/toolkit-local-bridge/curated_output_for_ai/skills/toolkit-setup/SKILL.md',
    'skills/toolkit-setup/SKILL.md',
    'repo/docs/FOR_AI_AGENTS.md',
    'repo/docs/TOOLKIT-LOCAL-BRIDGE.md',
    'repo/docs/HOW-TO-USE.md'
  ];

  for (const relPath of relPaths) {
    const text = fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
    assert.match(text, /setup toolkit/i, relPath);
    assert.match(text, /refresh toolkit/i, relPath);
    assert.match(text, /plain `refresh`/i, relPath);
    assert.match(text, /dedicated clean `main` checkout/i, relPath);
    assert.match(text, /node repo\/scripts\/setup-toolkit\.cjs --execute --profile auto-main/i, relPath);
  }
});
