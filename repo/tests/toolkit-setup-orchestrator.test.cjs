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
  fs.writeFileSync(filePath, text);
}


function run(args, options = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}) },
    timeout: 10000,
    windowsHide: true
  });
}

function createMinimalSetupRepo(root) {
  writeFile(path.join(root, 'AGENTS.md'), '# fake toolkit repo\n');
  writeFile(path.join(root, 'repo', 'scripts', 'setup-codex-toolkit-plugin.cjs'), [
    "'use strict';",
    "require('node:fs').writeFileSync(require('node:path').join(process.cwd(), 'PLUGIN_SETUP_RAN'), 'yes');",
    'process.exit(0);',
    ''
  ].join('\n'));
  writeFile(path.join(root, 'repo', 'scripts', 'toolkit-local-bridge.cjs'), "'use strict';\nprocess.exit(0);\n");
  writeFile(path.join(root, 'repo', 'scripts', 'validate-toolkit.cjs'), "'use strict';\nprocess.exit(0);\n");
  writeFile(path.join(root, 'repo', 'tests', 'toolkit-local-bridge-hook-light.test.cjs'), [
    "'use strict';",
    "const test = require('node:test');",
    "test('fake hook light', () => {});",
    ''
  ].join('\n'));
}

function createMinimalSetupRepoWithBridgeLog(root) {
  createMinimalSetupRepo(root);
  writeFile(path.join(root, 'repo', 'scripts', 'setup-codex-toolkit-plugin.cjs'), "'use strict';\nprocess.exit(0);\n");
  writeFile(path.join(root, 'repo', 'scripts', 'toolkit-local-bridge.cjs'), [
    "'use strict';",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "fs.appendFileSync(path.join(process.cwd(), 'BRIDGE_ARGS.log'), `${process.argv.slice(2).join(' ')}\\n`);",
    'process.exit(0);',
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
function flattenCommands(plan) {
  return plan.steps.flatMap((step) => step.commands || []);
}

test('setup toolkit plan is full journey rather than plugin verify only', () => {
  const root = tmpRoot();
  const result = run(['--plan', '--json', '--repo-root', repoRoot], {
    env: isolatedHomeEnv(root)
  });
  assert.equal(result.status, 0, result.stderr);

  const plan = JSON.parse(result.stdout);
  assert.equal(plan.name, 'setup toolkit');
  assert.deepEqual(plan.steps.map((step) => step.id), [
    'trusted_repo_state',
    'codex_native_plugin_cache',
    'lite_validation',
    'repo_backed_auto_update',
    'bridge_audit',
    'update_report_open_preference',
    'codex_plugin_auto_refresh_preference',
    'non_native_target_approval',
    'approved_target_sync'
  ]);

  const commands = flattenCommands(plan);
  assert.deepEqual(commands.slice(0, 6), [
    'git status --short',
    'git switch main',
    'git fetch origin main',
    'git rev-parse FETCH_HEAD',
    'git merge --ff-only origin/main',
    'git rev-parse HEAD'
  ]);
  assert.ok(commands.includes('node repo/scripts/setup-codex-toolkit-plugin.cjs --verify --json'));
  assert.ok(commands.includes('node repo/scripts/setup-codex-toolkit-plugin.cjs --write --json'));
  assert.ok(commands.includes('node repo/scripts/setup-codex-toolkit-plugin.cjs --verify --json'));
  assert.ok(commands.includes('node repo/scripts/validate-toolkit.cjs'));
  assert.ok(commands.includes('node --test repo/tests/toolkit-local-bridge-hook-light.test.cjs'));
  assert.ok(commands.includes(`node repo/scripts/toolkit-local-bridge.cjs --enable-repo-auto-update --repo-path ${JSON.stringify(repoRoot)} --repo-branch main --enable-auto-sync --write`));
  assert.ok(commands.includes('node repo/scripts/toolkit-local-bridge.cjs --audit'));
  assert.ok(commands.includes('node repo/scripts/toolkit-local-bridge.cjs --enable-update-report-open --write'));
  assert.ok(commands.includes('node repo/scripts/toolkit-local-bridge.cjs --enable-codex-plugin-auto-refresh --write'));
  assert.ok(commands.includes('node repo/scripts/toolkit-local-bridge.cjs --sync-enabled --write'));

  const text = JSON.stringify(plan);
  assert.doesNotMatch(text, /repo\/tests\/toolkit-local-bridge\.test\.cjs/);
  assert.doesNotMatch(text, /npm\s+run\s+validate:all/);
  assert.doesNotMatch(text, /--open-update-report/);
  assert.doesNotMatch(text, /\b(?:npm|pip|docker|n8n)\s+(?:install|run|compose|import|export)\b/i);
  assert.equal(fs.existsSync(path.join(root, '.ai-agent-toolkit')), false, 'plan mode must not write user-local bridge state');
});

test('setup execute rejects local main ahead of fetched origin before plugin setup', () => {
  const root = tmpRoot();
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
  writeFile(path.join(setupRepo, 'LOCAL_ONLY.md'), 'local-only\n');
  runTestGit(setupRepo, ['add', 'LOCAL_ONLY.md']);
  runTestGit(setupRepo, ['commit', '-m', 'local only']);

  const result = run(['--execute', '--repo-root', setupRepo, '--repo-remote', origin], {
    env: isolatedHomeEnv(root)
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires local main to match origin\/main/i);
  assert.equal(fs.existsSync(path.join(setupRepo, 'PLUGIN_SETUP_RAN')), false, 'plugin setup must not run from local-only commits');
});
test('setup toolkit plan keeps repo auto-update and target writes approval-gated', () => {
  const root = tmpRoot();
  const result = run(['--plan', '--json', '--repo-root', repoRoot], {
    env: isolatedHomeEnv(root)
  });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);

  const repoStep = plan.steps.find((step) => step.id === 'repo_backed_auto_update');
  assert.equal(repoStep.approval_required, true);
  assert.equal(repoStep.write_flag, '--write-repo-auto-update');
  assert.match(repoStep.approval_question, /repo-backed auto-update/i);
  assert.match(repoStep.approval_question, /main/i);
  assert.doesNotMatch(repoStep.commands.join('\n'), /--enable-target/);

  const reportStep = plan.steps.find((step) => step.id === 'update_report_open_preference');
  assert.equal(reportStep.approval_required, true);
  assert.equal(reportStep.write_flag, '--enable-update-report-open');
  assert.equal(reportStep.decline_flag, '--skip-update-report-open');
  assert.match(reportStep.approval_question, /^\*\*.+\?\*\*$/);
  assert.match(reportStep.approval_question, /open Toolkit update reports automatically/i);
  assert.match(reportStep.commands.join('\n'), /--enable-update-report-open --write/);

  const refreshStep = plan.steps.find((step) => step.id === 'codex_plugin_auto_refresh_preference');
  assert.equal(refreshStep.approval_required, true);
  assert.equal(refreshStep.write_flag, '--enable-codex-plugin-auto-refresh');
  assert.equal(refreshStep.decline_flag, '--skip-codex-plugin-auto-refresh');
  assert.match(refreshStep.approval_question, /^\*\*.+\?\*\*$/);
  assert.match(refreshStep.approval_question, /auto-refresh the Toolkit native plugin cache/i);
  assert.match(refreshStep.commands.join('\n'), /--enable-codex-plugin-auto-refresh --write/);

  const targetStep = plan.steps.find((step) => step.id === 'non_native_target_approval');
  assert.equal(targetStep.approval_required, true);
  assert.match(targetStep.approval_question, /OpenCode/);
  assert.match(targetStep.approval_question, /Antigravity 2/);
  assert.match(targetStep.approval_question, /~\/\.config\/opencode\/skills\/ai-agent-toolkit/);
  assert.match(targetStep.approval_question, /~\/\.gemini\/config\/plugins\/ai-agent-toolkit/);

  const syncStep = plan.steps.find((step) => step.id === 'approved_target_sync');
  assert.equal(syncStep.approval_required, true);
  assert.equal(syncStep.write_flag, '--enable-target <opencode|ag2>');
  assert.match(syncStep.commands.join('\n'), /--enable-target opencode --enable-target ag2 --write/);
  assert.match(syncStep.commands.join('\n'), /--sync-enabled --write/);
});

test('setup execute pauses for update report open preference until explicitly answered', () => {
  const root = tmpRoot();
  const origin = path.join(root, 'origin.git');
  const setupRepo = path.join(root, 'repo');
  fs.mkdirSync(setupRepo, { recursive: true });
  runTestGit(root, ['init', '--bare', origin]);
  runTestGit(setupRepo, ['init']);
  runTestGit(setupRepo, ['checkout', '-b', 'main']);
  runTestGit(setupRepo, ['config', 'user.email', 'setup-test@example.invalid']);
  runTestGit(setupRepo, ['config', 'user.name', 'Setup Test']);
  createMinimalSetupRepoWithBridgeLog(setupRepo);
  runTestGit(setupRepo, ['add', '.']);
  runTestGit(setupRepo, ['commit', '-m', 'base']);
  runTestGit(setupRepo, ['remote', 'add', 'origin', origin]);
  runTestGit(setupRepo, ['push', '-u', 'origin', 'main']);

  let result = run([
    '--execute',
    '--repo-root', setupRepo,
    '--repo-remote', origin,
    '--write-repo-auto-update',
    '--enable-target', 'ag2'
  ], {
    env: isolatedHomeEnv(root)
  });

  assert.equal(result.status, 21, result.stderr || result.stdout);
  assert.match(result.stdout, /SETUP PAUSED: update report auto-open is approval-gated\./);
  assert.match(result.stdout, /\*\*Do you want Codex to open Toolkit update reports automatically after meaningful hook activity\?\*\*/);
  assert.match(result.stdout, /--enable-update-report-open/);
  assert.match(result.stdout, /--skip-update-report-open/);
  let bridgeLog = fs.readFileSync(path.join(setupRepo, 'BRIDGE_ARGS.log'), 'utf8');
  assert.match(bridgeLog, /--enable-repo-auto-update/);
  assert.doesNotMatch(bridgeLog, /--enable-update-report-open/);
  assert.doesNotMatch(bridgeLog, /--enable-target ag2/);

  fs.rmSync(path.join(setupRepo, 'BRIDGE_ARGS.log'));
  result = run([
    '--execute',
    '--repo-root', setupRepo,
    '--repo-remote', origin,
    '--write-repo-auto-update',
    '--enable-update-report-open',
    '--enable-target', 'ag2'
  ], {
    env: isolatedHomeEnv(root)
  });

  assert.equal(result.status, 22, result.stderr || result.stdout);
  assert.match(result.stdout, /SETUP PAUSED: Codex plugin auto-refresh is approval-gated\./);
  assert.match(result.stdout, /\*\*Do you want Codex to auto-refresh the Toolkit native plugin cache from this trusted main checkout when a startup hook detects it is stale\?\*\*/);
  assert.match(result.stdout, /--enable-codex-plugin-auto-refresh/);
  assert.match(result.stdout, /--skip-codex-plugin-auto-refresh/);
  bridgeLog = fs.readFileSync(path.join(setupRepo, 'BRIDGE_ARGS.log'), 'utf8');
  assert.match(bridgeLog, /--enable-update-report-open --write/);
  assert.doesNotMatch(bridgeLog, /--enable-codex-plugin-auto-refresh/);
  assert.doesNotMatch(bridgeLog, /--enable-target ag2/);

  fs.rmSync(path.join(setupRepo, 'BRIDGE_ARGS.log'));
  result = run([
    '--execute',
    '--repo-root', setupRepo,
    '--repo-remote', origin,
    '--write-repo-auto-update',
    '--enable-update-report-open',
    '--enable-codex-plugin-auto-refresh',
    '--enable-target', 'ag2'
  ], {
    env: isolatedHomeEnv(root)
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  bridgeLog = fs.readFileSync(path.join(setupRepo, 'BRIDGE_ARGS.log'), 'utf8');
  assert.match(bridgeLog, /--enable-update-report-open --write/);
  assert.match(bridgeLog, /--enable-codex-plugin-auto-refresh --write/);
  assert.match(bridgeLog, /--enable-target ag2 --write/);

  fs.rmSync(path.join(setupRepo, 'BRIDGE_ARGS.log'));
  result = run([
    '--execute',
    '--repo-root', setupRepo,
    '--repo-remote', origin,
    '--write-repo-auto-update',
    '--skip-update-report-open',
    '--skip-codex-plugin-auto-refresh',
    '--enable-target', 'ag2'
  ], {
    env: isolatedHomeEnv(root)
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  bridgeLog = fs.readFileSync(path.join(setupRepo, 'BRIDGE_ARGS.log'), 'utf8');
  assert.doesNotMatch(bridgeLog, /--enable-update-report-open/);
  assert.doesNotMatch(bridgeLog, /--enable-codex-plugin-auto-refresh/);
  assert.match(bridgeLog, /--enable-target ag2 --write/);
});

test('setup docs route setup and refresh prompts to the orchestrator', () => {
  const relPaths = [
    '_projects/development/toolkit-local-bridge/curated_output_for_ai/skills/toolkit-setup/SKILL.md',
    'skills/toolkit-setup/SKILL.md',
    'repo/docs/FOR_AI_AGENTS.md',
    'repo/docs/TOOLKIT-LOCAL-BRIDGE-V2.md',
    'repo/docs/HOW-TO-USE.md'
  ];

  for (const relPath of relPaths) {
    const text = fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
    assert.match(text, /setup toolkit/i, relPath);
    assert.match(text, /refresh toolkit/i, relPath);
    assert.match(text, /plain `refresh`/i, relPath);
    assert.match(text, /full (?:script-backed )?(?:setup )?journey/i, relPath);
    assert.match(text, /node repo\/scripts\/setup-toolkit\.cjs --execute/i, relPath);
  }
});
