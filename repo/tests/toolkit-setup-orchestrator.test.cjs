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
    input: options.input,
    timeout: 15000,
    windowsHide: true
  });
}

function createMinimalSetupRepo(root) {
  writeFile(path.join(root, 'AGENTS.md'), '# fake toolkit repo\n');
  writeFile(path.join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({
    name: 'ai-agent-toolkit',
    version: '2.2.1',
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
    "if (process.argv.includes('--write')) fs.appendFileSync(path.join(process.cwd(), 'PLUGIN_SETUP.log'), `${process.argv.slice(2).join(' ')}\\n`);",
    "process.stdout.write(JSON.stringify({ ok: true }));",
    'process.exit(0);',
    ''
  ].join('\n'));
  writeFile(path.join(root, 'repo', 'scripts', 'toolkit-local-bridge.cjs'), [
    "'use strict';",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const args = process.argv.slice(2);",
    "if (args.includes('--write')) fs.appendFileSync(path.join(process.cwd(), 'BRIDGE_ARGS.log'), `${args.join(' ')}\\n`);",
    "if (args.includes('--audit')) {",
    "  const fallback = {",
    "    update_report_enabled: true,",
    "    update_report_open_enabled: false,",
    "    update_report_retention_days: 7,",
    "    codex_plugin_auto_refresh_enabled: false,",
    "    repo_auto_update: { enabled: false, last_status: 'configured', repo_path: '' },",
    "    update_report_cleanup: { retention_days: 7, deleted_count: 0, error_count: 0, report_log_directory: path.join(process.cwd(), 'tmp-reports') },",
    "    targets: {",
    "      opencode: { detected: false, enabled: false, synced: false, status: 'not detected', synced_version: '' },",
    "      ag2: { detected: false, enabled: false, synced: false, status: 'not detected', synced_version: '' }",
    "    }",
    "  };",
    "  process.stdout.write(JSON.stringify(process.env.SETUP_FAKE_AUDIT_JSON ? JSON.parse(process.env.SETUP_FAKE_AUDIT_JSON) : fallback));",
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createFakeManagedSetupScript(root, version = '2.2.1') {
  const managedPath = path.join(root, '.ai-agent-toolkit', 'source', 'ai-agent-toolkit');
  const scriptPath = path.join(managedPath, 'repo', 'scripts', 'setup-toolkit.cjs');
  writeFile(scriptPath, [
    '#!/usr/bin/env node',
    "'use strict';",
    `console.log('managed setup script version ${version}');`,
    "console.log('# setup toolkit question bank');",
    "console.log('Setup script path executed: ' + __filename);",
    'process.exit(23);',
    ''
  ].join('\n'));
  writeFile(path.join(managedPath, 'AGENTS.md'), '# fake managed toolkit repo\n');
  runTestGit(managedPath, ['init']);
  runTestGit(managedPath, ['checkout', '-b', 'main']);
  runTestGit(managedPath, ['config', 'user.email', 'setup-test@example.invalid']);
  runTestGit(managedPath, ['config', 'user.name', 'Setup Test']);
  runTestGit(managedPath, ['add', '.']);
  runTestGit(managedPath, ['commit', '-m', 'managed setup']);
  return { managedPath, scriptPath };
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
    repo_backed_auto_update: 'question-required',
    host_native_plugin_cache_auto_refresh: 'question-required',
    write_meaningful_update_reports: 'question-required',
    open_update_reports_automatically: 'question-required',
    update_report_retention_days: 'question-required',
    opencode_sync: 'question-required',
    ag2_antigravity_sync: 'question-required'
  });

  const commands = flattenCommands(plan).join('\n');
  assert.match(commands, /git clone --branch main/);
  assert.match(commands, /git merge --ff-only FETCH_HEAD/);
  assert.doesNotMatch(commands, /--enable-repo-auto-update/);
  assert.doesNotMatch(commands, /--disable-update-report-open/);
  assert.doesNotMatch(commands, /--enable-codex-plugin-auto-refresh --write/);
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
    '--yes-recommended',
    '--default-update-report-retention-days',
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
  assert.match(result.stdout, /OpenCode target choice: kept current state/, 'OpenCode should remain disabled when only ag2 is selected');
  assert.match(result.stdout, /AG2\/Antigravity target choice: enabled\/synced/);

  const bridgeLog = fs.readFileSync(path.join(setupRepo, 'BRIDGE_ARGS.log'), 'utf8');
  assert.match(bridgeLog, /--enable-repo-auto-update/);
  assert.match(bridgeLog, /--enable-update-reports --update-report-retention-days 7 --enable-update-report-open --write/);
  assert.match(bridgeLog, /--enable-codex-plugin-auto-refresh --write/);
  assert.match(bridgeLog, /--enable-target ag2 --write/);
  assert.doesNotMatch(bridgeLog, /--enable-target opencode/);
});

test('setup execute without explicit choices pauses before preference or target writes', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const result = run([
    '--execute',
    '--profile', 'auto-main',
    '--repo-root', setupRepo,
    '--repo-remote', origin
  ], {
    env: isolatedHomeEnv(root)
  });

  assert.equal(result.status, 23, result.stderr || result.stdout);
  assert.match(result.stdout, /# setup toolkit question bank/);
  assert.match(result.stdout, /Update report auto-open/);
  assert.match(result.stdout, /OpenCode bridge target/);
  assert.match(result.stdout, /AG2\/Antigravity bridge target/);
  assert.match(result.stdout, /Repo-backed auto-update/);
  assert.match(result.stdout, /Managed checkout/);
  assert.match(result.stdout, /Codex plugin cache auto-refresh/);
  assert.equal(fs.existsSync(path.join(setupRepo, 'PLUGIN_SETUP.log')), false, 'plugin setup must not run before all answers');
  const bridgeLog = fs.existsSync(path.join(setupRepo, 'BRIDGE_ARGS.log'))
    ? fs.readFileSync(path.join(setupRepo, 'BRIDGE_ARGS.log'), 'utf8')
    : '';
  assert.doesNotMatch(bridgeLog, /--write/, 'bridge preference and target writes must not happen before all answers');
});

test('setup execute accepts one consolidated answer bank and preserves report auto-open on keep', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const audit = {
    update_report_enabled: true,
    update_report_open_enabled: true,
    update_report_retention_days: 14,
    codex_plugin_auto_refresh_enabled: true,
    repo_auto_update: { enabled: true, last_status: 'configured', repo_path: setupRepo },
    update_report_cleanup: { retention_days: 14, deleted_count: 0, error_count: 0, report_log_directory: path.join(setupRepo, 'tmp-reports') },
    targets: {
      opencode: { detected: false, enabled: false, synced: false, status: 'not detected', synced_version: '' },
      ag2: { detected: true, enabled: true, synced: false, status: 'enabled', synced_version: '2.1.0' }
    }
  };
  const result = run([
    '--execute',
    '--profile', 'auto-main',
    '--repo-root', setupRepo,
    '--repo-remote', origin
  ], {
    env: { ...isolatedHomeEnv(root), SETUP_FAKE_AUDIT_JSON: JSON.stringify(audit) },
    input: [
      'keep',
      'keep',
      'keep',
      'keep',
      'keep',
      'keep',
      'enable-sync',
      ''
    ].join('\n')
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /AG2\/Antigravity bridge target:[\s\S]*enabled=yes[\s\S]*version=2\.1\.0/);
  const bridgeLog = fs.readFileSync(path.join(setupRepo, 'BRIDGE_ARGS.log'), 'utf8');
  assert.doesNotMatch(bridgeLog, /--disable-update-report-open/);
  assert.doesNotMatch(bridgeLog, /--enable-update-report-open/);
  assert.match(bridgeLog, /--enable-target ag2 --write/);
  assert.match(bridgeLog, /--sync-enabled --write/);
});

test('setup execute creates missing managed checkout by cloning the expected remote', () => {
  const root = tmpRoot();
  const { origin } = createGitBackedSetupRepo(root);
  const managedPath = path.join(root, '.ai-agent-toolkit', 'source', 'ai-agent-toolkit');
  const result = run([
    '--execute',
    '--repo-root', managedPath,
    '--repo-remote', origin,
    '--yes-recommended',
    '--skip-codex-plugin-auto-refresh'
  ], {
    env: isolatedHomeEnv(root)
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(path.join(managedPath, 'AGENTS.md')), true);
  assert.equal(runTestGit(managedPath, ['branch', '--show-current']), 'main');
  assert.match(result.stdout, /Managed checkout path:/);
});

test('active setup command delegates to managed checkout script when it exists', () => {
  const root = tmpRoot();
  const { managedPath, scriptPath } = createFakeManagedSetupScript(root, '2.2.1');
  const beforeStatus = runTestGit(repoRoot, ['status', '--short']);
  const result = run(['--execute', '--profile', 'auto-main'], {
    env: isolatedHomeEnv(root)
  });
  const afterStatus = runTestGit(repoRoot, ['status', '--short']);

  assert.equal(result.status, 23, result.stderr || result.stdout);
  assert.equal(beforeStatus, afterStatus, 'active worktree status must not change during delegation');
  assert.match(result.stdout, /# setup toolkit managed route/);
  assert.match(result.stdout, new RegExp(`Active worktree path: ${escapeRegExp(repoRoot)}`));
  assert.match(result.stdout, /Active worktree commit: [0-9a-f]{40}/);
  assert.match(result.stdout, new RegExp(`Managed checkout path: ${escapeRegExp(managedPath)}`));
  assert.match(result.stdout, /Managed checkout commit: [0-9a-f]{40}/);
  assert.match(result.stdout, new RegExp(`Setup script path executed: ${escapeRegExp(scriptPath)}`));
  assert.match(result.stdout, /managed setup script version 2\.2\.1/);
  assert.match(result.stdout, /# setup toolkit question bank/);
});

test('active setup command falls back locally when managed checkout script is missing', () => {
  const root = tmpRoot();
  const result = run(['--execute', '--profile', 'auto-main'], {
    env: isolatedHomeEnv(root)
  });

  assert.equal(result.status, 23, result.stderr || result.stdout);
  assert.doesNotMatch(result.stdout, /# setup toolkit managed route/);
  assert.match(result.stdout, /# setup toolkit question bank/);
});

test('yes-recommended uses the default managed checkout when stored repo path is the active worktree', () => {
  const root = tmpRoot();
  const { origin } = createGitBackedSetupRepo(root);
  const managedPath = path.join(root, '.ai-agent-toolkit', 'source', 'ai-agent-toolkit');
  runTestGit(root, ['clone', '--branch', 'main', origin, managedPath]);
  const audit = {
    update_report_enabled: true,
    update_report_open_enabled: true,
    update_report_retention_days: 7,
    codex_plugin_auto_refresh_enabled: false,
    repo_auto_update: { enabled: true, last_status: 'configured', repo_path: repoRoot },
    update_report_cleanup: { retention_days: 7, deleted_count: 0, error_count: 0, report_log_directory: path.join(root, 'tmp-reports') },
    targets: {
      opencode: { detected: false, enabled: false, synced: false, status: 'not detected', synced_version: '' },
      ag2: { detected: false, enabled: false, synced: false, status: 'not detected', synced_version: '' }
    }
  };

  const result = run([
    '--execute',
    '--profile', 'auto-main',
    '--repo-remote', origin,
    '--yes-recommended',
    '--skip-codex-plugin-auto-refresh'
  ], {
    env: { ...isolatedHomeEnv(root), SETUP_FAKE_AUDIT_JSON: JSON.stringify(audit) }
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Managed checkout:[\s\S]*recommended: default/);
  assert.match(result.stdout, /- Managed checkout: default/);
  assert.match(result.stdout, new RegExp(`Managed checkout path: ${escapeRegExp(managedPath)}`));
  assert.equal(fs.existsSync(path.join(managedPath, 'AGENTS.md')), true);
  assert.equal(fs.existsSync(path.join(repoRoot, 'BRIDGE_ARGS.log')), false, 'active worktree must not receive setup writes');
});

test('yes-recommended may keep the safe standard managed checkout', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const managedPath = path.join(root, '.ai-agent-toolkit', 'source', 'ai-agent-toolkit');
  runTestGit(root, ['clone', '--branch', 'main', origin, managedPath]);
  const audit = {
    update_report_enabled: true,
    update_report_open_enabled: false,
    update_report_retention_days: 7,
    codex_plugin_auto_refresh_enabled: false,
    repo_auto_update: { enabled: true, last_status: 'configured', repo_path: managedPath },
    update_report_cleanup: { retention_days: 7, deleted_count: 0, error_count: 0, report_log_directory: path.join(managedPath, 'tmp-reports') },
    targets: {
      opencode: { detected: false, enabled: false, synced: false, status: 'not detected', synced_version: '' },
      ag2: { detected: false, enabled: false, synced: false, status: 'not detected', synced_version: '' }
    }
  };

  const result = run([
    '--execute',
    '--profile', 'auto-main',
    '--repo-remote', origin,
    '--yes-recommended',
    '--skip-codex-plugin-auto-refresh'
  ], {
    env: { ...isolatedHomeEnv(root), SETUP_FAKE_AUDIT_JSON: JSON.stringify(audit) }
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Managed checkout:[\s\S]*recommended: keep/);
  assert.match(result.stdout, /- Managed checkout: keep/);
  assert.match(result.stdout, new RegExp(`Managed checkout path: ${escapeRegExp(managedPath)}`));
  assert.equal(fs.existsSync(path.join(setupRepo, 'BRIDGE_ARGS.log')), false, 'old source worktree must not receive setup writes');
});

test('setup execute refuses local managed checkout divergence before plugin setup', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  writeFile(path.join(setupRepo, 'LOCAL_ONLY.md'), 'local-only\n');
  runTestGit(setupRepo, ['add', 'LOCAL_ONLY.md']);
  runTestGit(setupRepo, ['commit', '-m', 'local only']);

  const result = run(['--execute', '--repo-root', setupRepo, '--repo-remote', origin, '--yes-recommended'], {
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
    '--yes-recommended',
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

test('setup final summary distinguishes target keep skip enable-sync and disable choices', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const first = run([
    '--execute',
    '--repo-root', setupRepo,
    '--repo-remote', origin,
    '--yes-recommended',
    '--skip-codex-plugin-auto-refresh',
    '--skip-target', 'opencode',
    '--enable-target', 'ag2'
  ], {
    env: isolatedHomeEnv(root)
  });

  assert.equal(first.status, 0, first.stderr || first.stdout);
  assert.match(first.stdout, /OpenCode target choice: skipped this run/);
  assert.match(first.stdout, /AG2\/Antigravity target choice: enabled\/synced/);
  assert.doesNotMatch(first.stdout, /Skipped target writes:/);

  fs.rmSync(path.join(setupRepo, 'BRIDGE_ARGS.log'), { force: true });
  const second = run([
    '--execute',
    '--repo-root', setupRepo,
    '--repo-remote', origin,
    '--yes-recommended',
    '--skip-codex-plugin-auto-refresh',
    '--disable-target', 'opencode',
    '--keep-target', 'ag2'
  ], {
    env: isolatedHomeEnv(root)
  });

  assert.equal(second.status, 0, second.stderr || second.stdout);
  assert.match(second.stdout, /OpenCode target choice: disabled/);
  assert.match(second.stdout, /AG2\/Antigravity target choice: kept current state/);
  assert.doesNotMatch(second.stdout, /Skipped target writes:/);
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
