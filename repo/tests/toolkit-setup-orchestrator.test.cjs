'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
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
    version: '2.3.28',
    skills: './skills',
    hooks: './.claude-plugin/hooks/hooks.json'
  }, null, 2));
  writeFile(path.join(root, '.codex-plugin', 'plugin.json'), JSON.stringify({
    name: 'ai-agent-toolkit',
    version: '2.3.28',
    hooks: './.codex-plugin/hooks/hooks.json'
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
    "process.stdout.write(JSON.stringify({ ok: true, version: '2.3.28', installed: true, enabled: true, current: true, cache_root: path.join(process.cwd(), 'fake-codex-cache'), hook_trust_status: 'verification-unavailable', hook_execution_status: 'verification unavailable; open /hooks in Codex', hook_trust_message: 'Hook trust verification unavailable; open /hooks in Codex and review the current Toolkit SessionStart hook' }));",
    'process.exit(0);',
    ''
  ].join('\n'));
  writeFile(path.join(root, 'repo', 'scripts', 'setup-claude-toolkit-plugin.cjs'), [
    "'use strict';",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "fs.appendFileSync(path.join(process.cwd(), 'CLAUDE_PLUGIN_HELPER_ARGS.log'), `${process.argv.slice(2).join(' ')}\\n`);",
    "if (process.argv.includes('--write')) fs.appendFileSync(path.join(process.cwd(), 'CLAUDE_PLUGIN_SETUP.log'), `${process.argv.slice(2).join(' ')}\\n`);",
    "process.stdout.write(JSON.stringify({ ok: true, version: '2.3.28', scope: 'user' }));",
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
    "      opencode: { detected: false, enabled: false, synced: false, status: 'not detected', synced_version: '', path: '' },",
    "      ag2: { detected: false, enabled: false, synced: false, status: 'not detected', synced_version: '', path: '' }",
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

function createFakeManagedSetupScript(root, version = '2.3.28', options = {}) {
  const managedPath = path.join(root, '.ai-agent-toolkit', 'source', 'ai-agent-toolkit');
  const scriptPath = path.join(managedPath, 'repo', 'scripts', 'setup-toolkit.cjs');
  const emitQuestionBank = options.emitQuestionBank !== false;
  const exitCode = Number.isInteger(options.exitCode) ? options.exitCode : 23;
  writeFile(scriptPath, [
    '#!/usr/bin/env node',
    "'use strict';",
    `console.log('managed setup script version ${version}');`,
    ...(emitQuestionBank ? ["console.log('# setup toolkit question bank');"] : []),
    ...(options.extraLines || []),
    "console.log('Setup script path executed: ' + __filename);",
    `process.exit(${exitCode});`,
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

function createGitBackedRealSetupRepo(root) {
  const result = createGitBackedSetupRepo(root);
  writeFile(path.join(result.setupRepo, 'repo', 'scripts', 'setup-toolkit.cjs'), fs.readFileSync(script, 'utf8'));
  runTestGit(result.setupRepo, ['add', 'repo/scripts/setup-toolkit.cjs']);
  runTestGit(result.setupRepo, ['commit', '-m', 'real setup script']);
  runTestGit(result.setupRepo, ['push', 'origin', 'main']);
  return result;
}

function runSetupScript(scriptPath, args, options = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: options.cwd || path.dirname(scriptPath),
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}) },
    input: options.input,
    timeout: 15000,
    windowsHide: true
  });
}

function flattenCommands(plan) {
  return plan.steps.flatMap((step) => step.commands || []);
}

// Regression harness for the stdin-hang bug: a plain spawnSync call (even
// with an explicit non-TTY stdio array) auto-closes an unwritten stdin pipe,
// so it can never reproduce "a non-interactive harness whose stdin pipe is
// left open forever." Only an async spawn() with a stdin pipe that the
// parent deliberately never writes to or ends reproduces that condition.
function runWithUnclosedStdin(scriptPath, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: options.cwd || repoRoot,
      env: { ...process.env, ...(options.env || {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const deadlineMs = options.deadlineMs || 15000;
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(
        `${path.basename(scriptPath)} did not exit within ${deadlineMs}ms even though every setup question ` +
        `was already answered; it appears blocked on an unconditional stdin read.\nstdout:\n${stdout}\nstderr:\n${stderr}`
      ));
    }, deadlineMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      child.stdin.destroy();
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      child.stdin.destroy();
      resolve({ code, stdout, stderr });
    });
    // Deliberately never write to or end child.stdin.
  });
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
  for (const heading of [
    '## Active worktree',
    '## Managed main checkout',
    '## Question bank',
    '## Codex native plugin',
    '## Claude Code native plugin',
    '## Bridge state',
    '## Targets',
    '## Validation'
  ]) {
    assert.match(result.stdout, new RegExp(escapeRegExp(heading)));
  }
  assert.match(result.stdout, /Active worktree path:/);
  assert.match(result.stdout, /Active worktree branch:/);
  assert.match(result.stdout, /Active worktree commit: [0-9a-f]{40}/);
  assert.match(result.stdout, /Active worktree status: clean|dirty|unknown/);
  assert.match(result.stdout, /Active worktree role: not used for writes/);
  assert.match(result.stdout, /Managed checkout path:/);
  assert.match(result.stdout, /Managed checkout default path: .*\.ai-agent-toolkit.*source.*ai-agent-toolkit/);
  assert.match(result.stdout, /%USERPROFILE%\\\.ai-agent-toolkit\\source\\ai-agent-toolkit/);
  assert.match(result.stdout, /\$HOME\/.ai-agent-toolkit\/source\/ai-agent-toolkit/);
  assert.match(result.stdout, /Managed checkout branch: main/);
  assert.match(result.stdout, /Managed checkout remote:/);
  assert.match(result.stdout, /Managed checkout commit before: [0-9a-f]{40}|unknown/);
  assert.match(result.stdout, /Managed checkout commit after: [0-9a-f]{40}/);
  assert.match(result.stdout, /Managed checkout update action: already up to date/);
  assert.match(result.stdout, /Setup script path executed:/);
  assert.match(result.stdout, /Question bank appeared: yes/);
  assert.match(result.stdout, /Question bank stopped for answers: no/);
  assert.match(result.stdout, /Question answer source: user-approved yes-recommended/);
  assert.match(result.stdout, /Preference\/target writes before answers: no/);
  assert.match(result.stdout, /Codex plugin cache path:/);
  assert.match(result.stdout, /Codex expected Toolkit version: 2\.3\.28/);
  assert.match(result.stdout, /Codex installed Toolkit version: 2\.3\.28/);
  assert.match(result.stdout, /Codex plugin installed: yes/);
  assert.match(result.stdout, /Codex plugin enabled: yes/);
  assert.match(result.stdout, /Codex plugin current: yes/);
  assert.match(result.stdout, /Codex plugin status: already fresh/);
  assert.match(result.stdout, /Codex plugin updated this run: no/);
  assert.match(result.stdout, /Codex restart required: no/);
  assert.match(result.stdout, /Codex hook trust status: verification-unavailable/);
  assert.match(result.stdout, /Codex hook execution status: verification unavailable; open \/hooks in Codex/);
  assert.match(result.stdout, /Codex hook trust action: .*open \/hooks in Codex/i);
  assert.match(result.stdout, /Claude plugin status: not checked for this host/);
  assert.match(result.stdout, /Claude plugin mutation: no; Codex setup does not mutate Claude Code plugin cache\./);
  assert.match(result.stdout, /Repo auto-update enabled: yes/);
  assert.match(result.stdout, /Repo auto-update path:/);
  assert.match(result.stdout, /Repo auto-update status:/);
  assert.match(result.stdout, /Update report\/log retention days: 7/);
  assert.match(result.stdout, /Update report\/log directory:/);
  assert.match(result.stdout, /Update report cleanup deleted count: 0/);
  assert.match(result.stdout, /Update report cleanup error count: 0/);
  assert.match(result.stdout, /OpenCode detected: no/);
  assert.match(result.stdout, /OpenCode enabled: no/);
  assert.match(result.stdout, /OpenCode synced: no/);
  assert.match(result.stdout, /OpenCode version: unknown/);
  assert.match(result.stdout, /OpenCode path: unknown/);
  assert.match(result.stdout, /OpenCode status:/);
  assert.match(result.stdout, /OpenCode action this run: kept/, 'OpenCode should remain disabled when only ag2 is selected');
  assert.match(result.stdout, /AG2 action this run: enabled\/synced/);
  assert.match(result.stdout, /Validation command: node --test repo\/tests\/toolkit-local-bridge-hook-light\.test\.cjs/);
  assert.match(result.stdout, /Validation command: node repo\/scripts\/validate-toolkit\.cjs/);
  assert.match(result.stdout, /Validation status: passed/);

  const bridgeLog = fs.readFileSync(path.join(setupRepo, 'BRIDGE_ARGS.log'), 'utf8');
  assert.match(bridgeLog, /--enable-repo-auto-update/);
  assert.match(bridgeLog, /--enable-update-reports --update-report-retention-days 7 --enable-update-report-open --write/);
  assert.match(bridgeLog, /--enable-codex-plugin-auto-refresh --write/);
  assert.match(bridgeLog, /--enable-target ag2 --write/);
  assert.doesNotMatch(bridgeLog, /--enable-target opencode/);
});

test('setup execute with every question pre-answered does not block on an unclosed non-interactive stdin pipe', async () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);

  const result = await runWithUnclosedStdin(script, [
    '--execute',
    '--repo-root', setupRepo,
    '--repo-remote', origin,
    '--yes-recommended',
    '--skip-codex-plugin-auto-refresh'
  ], {
    env: isolatedHomeEnv(root)
  });

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /# setup toolkit final summary/);
  assert.match(result.stdout, /Question answer source: user-approved yes-recommended/);
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
  assert.match(result.stdout, /Managed checkout update action: cloned/);
});

test('setup final summary distinguishes fast-forwarded managed checkout', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const managedPath = path.join(root, '.ai-agent-toolkit', 'source', 'ai-agent-toolkit');
  runTestGit(root, ['clone', '--branch', 'main', origin, managedPath]);
  writeFile(path.join(setupRepo, 'REMOTE_ONLY.md'), 'remote-only\n');
  runTestGit(setupRepo, ['add', 'REMOTE_ONLY.md']);
  runTestGit(setupRepo, ['commit', '-m', 'remote only']);
  runTestGit(setupRepo, ['push', 'origin', 'main']);

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
  assert.match(result.stdout, /Managed checkout commit before: [0-9a-f]{40}/);
  assert.match(result.stdout, /Managed checkout commit after: [0-9a-f]{40}/);
  assert.match(result.stdout, /Managed checkout update action: fast-forwarded/);
});

test('active setup command delegates to managed checkout script when it exists', () => {
  const root = tmpRoot();
  const { managedPath, scriptPath } = createFakeManagedSetupScript(root, '2.3.28');
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
  assert.match(result.stdout, /managed setup script version 2\.3\.28/);
  assert.match(result.stdout, /# setup toolkit question bank/);
});

test('active setup command does not block on stdin before delegating to the managed checkout', async () => {
  const root = tmpRoot();
  createFakeManagedSetupScript(root, '2.3.28', { emitQuestionBank: false, exitCode: 0 });

  const result = await runWithUnclosedStdin(script, ['--execute', '--profile', 'auto-main'], {
    env: isolatedHomeEnv(root)
  });

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /# setup toolkit managed route/);
  assert.match(result.stdout, /managed setup script version 2\.3\.28/);
});

test('managed question-bank pause is not bypassed with active fallback', () => {
  const root = tmpRoot();
  createFakeManagedSetupScript(root, '2.3.28');
  const result = run(['--execute', '--profile', 'auto-main'], {
    env: isolatedHomeEnv(root)
  });

  assert.equal(result.status, 23, result.stderr || result.stdout);
  assert.match(result.stdout, /# setup toolkit managed route/);
  assert.match(result.stdout, /# setup toolkit question bank/);
  assert.doesNotMatch(result.stdout, /# setup toolkit checklist/);
  assert.doesNotMatch(result.stdout, /--yes-recommended selected/);
});

test('managed safety blocker is not bypassed with active fallback', () => {
  const root = tmpRoot();
  createFakeManagedSetupScript(root, '2.3.28', {
    emitQuestionBank: false,
    exitCode: 1,
    extraLines: ["console.error('managed safety blocker');"]
  });
  const result = run(['--execute', '--profile', 'auto-main'], {
    env: isolatedHomeEnv(root)
  });

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout, /# setup toolkit managed route/);
  assert.match(result.stderr, /managed safety blocker/);
  assert.doesNotMatch(result.stdout, /# setup toolkit question bank/);
  assert.doesNotMatch(result.stdout, /# setup toolkit checklist/);
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

test('managed setup script running from standard managed checkout allows its own path', () => {
  const root = tmpRoot();
  const { origin } = createGitBackedRealSetupRepo(root);
  const managedPath = path.join(root, '.ai-agent-toolkit', 'source', 'ai-agent-toolkit');
  runTestGit(root, ['clone', '--branch', 'main', origin, managedPath]);
  const scriptPath = path.join(managedPath, 'repo', 'scripts', 'setup-toolkit.cjs');
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

  const result = runSetupScript(scriptPath, [
    '--execute',
    '--profile', 'auto-main',
    '--repo-remote', origin,
    '--yes-recommended',
    '--skip-codex-plugin-auto-refresh'
  ], {
    cwd: managedPath,
    env: { ...isolatedHomeEnv(root), SETUP_FAKE_AUDIT_JSON: JSON.stringify(audit) }
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Managed checkout:[\s\S]*recommended: keep/);
  assert.match(result.stdout, /- Managed checkout: keep/);
  assert.match(result.stdout, new RegExp(`Managed checkout path: ${escapeRegExp(managedPath)}`));
  assert.doesNotMatch(result.stderr, /must not live inside the active Toolkit worktree/);
});

test('active user worktree is still rejected when selected as managed checkout', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedRealSetupRepo(root);
  const scriptPath = path.join(setupRepo, 'repo', 'scripts', 'setup-toolkit.cjs');
  const audit = {
    update_report_enabled: true,
    update_report_open_enabled: false,
    update_report_retention_days: 7,
    codex_plugin_auto_refresh_enabled: false,
    repo_auto_update: { enabled: true, last_status: 'configured', repo_path: setupRepo },
    update_report_cleanup: { retention_days: 7, deleted_count: 0, error_count: 0, report_log_directory: path.join(root, 'tmp-reports') },
    targets: {
      opencode: { detected: false, enabled: false, synced: false, status: 'not detected', synced_version: '' },
      ag2: { detected: false, enabled: false, synced: false, status: 'not detected', synced_version: '' }
    }
  };

  const result = runSetupScript(scriptPath, [
    '--execute',
    '--profile', 'auto-main',
    '--repo-remote', origin
  ], {
    cwd: setupRepo,
    env: { ...isolatedHomeEnv(root), SETUP_FAKE_AUDIT_JSON: JSON.stringify(audit) },
    input: [
      'keep',
      'keep',
      'keep',
      'keep',
      'keep',
      'keep',
      'keep',
      'keep',
      ''
    ].join('\n')
  });

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, /Default managed source checkout must not live inside the active Toolkit worktree/);
});

test('unsafe plugin cache and tmp default managed paths are rejected', () => {
  const root = tmpRoot();
  const { origin } = createGitBackedSetupRepo(root);
  for (const unsafeHome of [
    path.join(root, '.codex', 'plugins', 'cache', 'ai-agent-toolkit-local'),
    path.join(root, '.tmp', 'marketplace-checkout')
  ]) {
    const result = run([
      '--execute',
      '--profile', 'auto-main',
      '--repo-remote', origin,
      '--yes-recommended',
      '--skip-codex-plugin-auto-refresh'
    ], {
      env: isolatedHomeEnv(unsafeHome)
    });

    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stderr, /Managed source checkout must not live inside plugin cache or temporary marketplace paths/);
  }
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

test('claude-code setup execute with instructions behavior verifies Claude plugin metadata and skips Codex helper', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const result = run([
    '--execute',
    '--host', 'claude-code',
    '--repo-root', setupRepo,
    '--repo-remote', origin,
    '--yes-recommended',
    '--claude-plugin-behavior', 'instructions',
    '--skip-update-report-open',
    '--enable-target', 'ag2'
  ], {
    env: isolatedHomeEnv(root)
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Claude Code native plugin metadata verified/);
  assert.match(result.stdout, /## Claude Code native plugin/);
  assert.match(result.stdout, /Claude plugin manifest path:/);
  assert.match(result.stdout, /Claude expected Toolkit version: 2\.3\.28/);
  assert.match(result.stdout, /Claude manifest Toolkit version: 2\.3\.28/);
  assert.match(result.stdout, /Claude plugin status: metadata present/);
  assert.match(result.stdout, /Claude plugin updated this run: no/);
  assert.match(result.stdout, /Claude restart required: no/);
  assert.match(result.stdout, /Claude hook trust action:/);
  assert.match(result.stdout, /Codex plugin status: not checked for this host/);
  assert.match(result.stdout, /Codex plugin mutation: no/);
  assert.equal(fs.existsSync(path.join(setupRepo, 'PLUGIN_SETUP.log')), false, 'Claude setup must not call the Codex helper');
  const bridgeLog = fs.readFileSync(path.join(setupRepo, 'BRIDGE_ARGS.log'), 'utf8');
  assert.match(bridgeLog, /--enable-repo-auto-update/);
  assert.doesNotMatch(bridgeLog, /--enable-codex-plugin-auto-refresh/);
  assert.match(bridgeLog, /--enable-target ag2 --write/);
});

test('--verify-claude-plugin delegates to the Claude helper verify path', () => {
  const root = tmpRoot();
  const { setupRepo } = createGitBackedSetupRepo(root);
  const fakeClaudeCli = path.join(root, 'fake claude cli.cmd');
  const result = run([
    '--verify-claude-plugin',
    '--host', 'claude-code',
    '--repo-root', setupRepo,
    '--claude-cli', fakeClaudeCli
  ], {
    env: isolatedHomeEnv(root)
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /"ok":true|"ok": true/);
  assert.doesNotMatch(result.stdout, /Claude Code native plugin metadata verified/);
  const helperLog = fs.readFileSync(path.join(setupRepo, 'CLAUDE_PLUGIN_HELPER_ARGS.log'), 'utf8');
  assert.match(helperLog, /--verify --json/);
  assert.match(helperLog, new RegExp(`--repo-root ${escapeRegExp(setupRepo)}`));
  assert.match(helperLog, new RegExp(`--claude-cli ${escapeRegExp(fakeClaudeCli)}`));
  assert.equal(fs.existsSync(path.join(setupRepo, 'CLAUDE_PLUGIN_SETUP.log')), false, 'verify must not invoke --write');
  assert.equal(fs.existsSync(path.join(setupRepo, 'PLUGIN_SETUP.log')), false, 'Claude verify must not call the Codex helper');
});

test('claude-code setup execute defaults to install behavior and calls the Claude helper, not the Codex helper', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const result = run([
    '--execute',
    '--host', 'claude-code',
    '--repo-root', setupRepo,
    '--repo-remote', origin,
    '--yes-recommended',
    '--skip-update-report-open'
  ], {
    env: isolatedHomeEnv(root)
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Claude Code plugin behavior:[\s\S]*recommended: install/);
  assert.match(result.stdout, /- Claude Code plugin behavior: install/);
  assert.match(result.stdout, /Claude plugin status: already fresh/);
  assert.equal(fs.existsSync(path.join(setupRepo, 'PLUGIN_SETUP.log')), false, 'Claude install setup must not call the Codex helper');
  assert.equal(fs.existsSync(path.join(setupRepo, 'CLAUDE_PLUGIN_SETUP.log')), false, 'verify-only pass must not invoke --write');
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
  assert.match(first.stdout, /OpenCode action this run: skipped/);
  assert.match(first.stdout, /AG2 action this run: enabled\/synced/);
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
  assert.match(second.stdout, /OpenCode action this run: disabled/);
  assert.match(second.stdout, /AG2 action this run: kept/);
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
    assert.match(text, /exit code `23`|code `23`/i, relPath);
    assert.match(text, /do not rerun with `--yes-recommended` unless the user explicitly|must not rerun with `--yes-recommended` unless the user explicitly/i, relPath);
    assert.match(text, /non-interactive|chat/i, relPath);
  }
});
