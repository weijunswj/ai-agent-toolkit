'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const script = path.join(repoRoot, 'repo', 'scripts', 'setup-toolkit.cjs');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-setup-'));
}

function isolatedHomeEnv(root) {
  const fakeCodex = createFakeCodexAppServer(root);
  return {
    PATH: process.env.PATH || '',
    USERPROFILE: root,
    HOME: root,
    CODEX_HOME: path.join(root, '.codex'),
    CODEX_TOOLKIT_CODEX_CLI: fakeCodex,
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

function createFakeCodexAppServer(root) {
  const fakeCodex = path.join(root, 'fake-codex-app-server.cjs');
  writeFile(fakeCodex, [
    "'use strict';",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const readline = require('node:readline');",
    "const rl = readline.createInterface({ input: process.stdin });",
    "rl.on('line', (line) => {",
    "  const message = JSON.parse(line);",
    "  if (message.method === 'initialize') process.stdout.write(JSON.stringify({ id: message.id, result: {} }) + '\\n');",
    "  if (message.method === 'experimentalFeature/list') {",
    "    const v1 = process.env.SETUP_FAKE_CODEX_RUNTIME === 'v1';",
    "    process.stdout.write(JSON.stringify({ id: message.id, result: { data: [{ name: 'multi_agent_v2', enabled: !v1 }, { name: 'multi_agent', enabled: v1 }] } }) + '\\n');",
    "  }",
    "  if (message.method === 'config/batchWrite') {",
    "    if (process.env.SETUP_FAKE_CODEX_EDITOR_LOG) fs.appendFileSync(process.env.SETUP_FAKE_CODEX_EDITOR_LOG, 'config/batchWrite\\n');",
    "    const target = path.join(process.env.CODEX_HOME, 'config.toml');",
    "    const text = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';",
    "    const separator = text ? (text.endsWith('\\n') ? '\\n' : '\\n\\n') : '';",
    "    const edits = message.params.edits;",
    "    const values = Object.fromEntries(edits.map((edit) => [edit.keyPath.split('.').at(-1), edit.value]));",
    "    const replacement = Object.hasOwn(values, 'max_threads')",
    "      ? '[agents]\\nmax_threads = ' + values.max_threads + '\\nmax_depth = ' + values.max_depth + '\\n'",
    "      : '[features.multi_agent_v2]\\nenabled = ' + values.enabled + '\\nmax_concurrent_threads_per_session = ' + values.max_concurrent_threads_per_session + '\\nroot_agent_usage_hint_text = ' + JSON.stringify(values.root_agent_usage_hint_text) + '\\nsubagent_usage_hint_text = ' + JSON.stringify(values.subagent_usage_hint_text) + '\\n';",
    "    fs.writeFileSync(target, text + separator + replacement);",
    "    process.stdout.write(JSON.stringify({ id: message.id, result: {} }) + '\\n');",
    "  }",
    '});',
    ''
  ].join('\n'));
  return fakeCodex;
}

function run(args, options = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}) },
    input: options.input,
    timeout: options.timeout || 120000,
    windowsHide: true
  });
}

function runTestGit(cwd, args) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: 120000,
    windowsHide: true
  });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return (result.stdout || '').trim();
}

function createMinimalSetupRepo(root, options = {}) {
  writeFile(path.join(root, 'AGENTS.md'), '# fake toolkit repo\n');
  writeFile(path.join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({
    name: 'ai-agent-toolkit', version: '2.7.10', skills: './skills', hooks: './.claude-plugin/hooks/hooks.json'
  }, null, 2));
  writeFile(path.join(root, '.codex-plugin', 'plugin.json'), JSON.stringify({
    name: 'ai-agent-toolkit', version: '2.7.10', hooks: './.codex-plugin/hooks/hooks.json'
  }, null, 2));
  writeFile(path.join(root, '.claude-plugin', 'hooks', 'hooks.json'), JSON.stringify({
    hooks: {
      SessionStart: [{ matcher: '*', hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/repo/scripts/toolkit-local-bridge.cjs" --hook --sync-enabled --write --sync-source claude-plugin' }] }],
      PreToolUse: [{ matcher: 'Agent|Task', hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/repo/scripts/toolkit-claude-agent-hook.cjs"' }] }]
    }
  }, null, 2));
  writeFile(path.join(root, 'repo', 'scripts', 'setup-codex-toolkit-plugin.cjs'), [
    "'use strict';",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "if (process.env.SETUP_FAKE_PLUGIN_FAILURE === '1') { console.error('synthetic plugin failure'); process.exit(1); }",
    "if (process.argv.includes('--write')) fs.appendFileSync(path.join(process.cwd(), 'PLUGIN_SETUP.log'), `${process.argv.slice(2).join(' ')}\\n`);",
    "process.stdout.write(JSON.stringify({ ok: true, version: '2.7.10', installed: true, enabled: true, current: true, cache_root: path.join(process.cwd(), 'fake-codex-cache'), hook_trust_status: 'verification-unavailable', hook_execution_status: 'verification unavailable; open /hooks in Codex', hook_trust_message: 'Hook trust verification unavailable; open /hooks in Codex and review the current Toolkit SessionStart hook' }));",
    'process.exit(0);', ''
  ].join('\n'));
  writeFile(path.join(root, 'repo', 'scripts', 'setup-claude-toolkit-plugin.cjs'), [
    "'use strict';",
    "const crypto = require('node:crypto');",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "if (process.argv.includes('--write')) fs.appendFileSync(path.join(process.cwd(), 'CLAUDE_PLUGIN_SETUP.log'), `${process.argv.slice(2).join(' ')}\\n`);",
    "const active = process.env.SETUP_FAKE_CLAUDE_ENFORCEMENT !== '0' && process.env.SETUP_FAKE_CLAUDE_TRUST !== '0';",
    "const cachePath = path.join(process.cwd(), 'fake-claude-cache');",
    "const proof = active ? { schema: 3, source: 'claude-plugin-list', plugin_version: '2.7.10', cache_identity: crypto.createHash('sha256').update(path.resolve(cachePath)).digest('hex'), hook_sha256: 'b'.repeat(64), controller_sha256: 'c'.repeat(64), process_launch_sha256: 'e'.repeat(64), agent_hook_sha256: 'd'.repeat(64) } : null;",
    "process.stdout.write(JSON.stringify({ ok: true, version: '2.7.10', scope: 'user', current: true, installed_current: true, enabled: true, strict_enforcement_verified: active, enforcement_verified: active, source_path: process.cwd(), cache_path: cachePath, trusted: process.env.SETUP_FAKE_CLAUDE_TRUST !== '0', hook_active: active, activation_proof: proof }));",
    'process.exit(0);', ''
  ].join('\n'));
  writeFile(path.join(root, 'repo', 'scripts', 'toolkit-local-bridge.cjs'), [
    "'use strict';",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const args = process.argv.slice(2);",
    "if (args.includes('--write')) fs.appendFileSync(path.join(process.cwd(), 'BRIDGE_ARGS.log'), `${args.join(' ')}\\n`);",
    "if (args.includes('--audit')) {",
    "  if (process.env.SETUP_FAKE_AUDIT_COUNT_PATH) {",
    "    const countPath = process.env.SETUP_FAKE_AUDIT_COUNT_PATH;",
    "    const count = fs.existsSync(countPath) ? Number(fs.readFileSync(countPath, 'utf8')) + 1 : 1;",
    "    fs.writeFileSync(countPath, String(count));",
    "    if (process.env.SETUP_FAKE_CONFIG_DRIFT_CONTENT && count === Number(process.env.SETUP_FAKE_CONFIG_DRIFT_ON_AUDIT || '2')) {",
    "      const configPath = path.join(process.env.CODEX_HOME, 'config.toml');",
    "      fs.mkdirSync(path.dirname(configPath), { recursive: true });",
    "      fs.writeFileSync(configPath, process.env.SETUP_FAKE_CONFIG_DRIFT_CONTENT);",
    "    }",
    "  }",
    "  const fallback = { update_report_enabled: true, update_report_open_enabled: false, update_report_retention_days: 7, codex_plugin_auto_refresh_enabled: false, repo_auto_update: { enabled: false, last_status: 'configured', repo_path: '' }, update_report_cleanup: { retention_days: 7, deleted_count: 0, error_count: 0, report_log_directory: path.join(process.cwd(), 'tmp-reports') }, targets: { opencode: { detected: false, enabled: false, synced: false, status: 'not detected', synced_version: '', path: '' }, ag2: { detected: false, enabled: false, synced: false, status: 'not detected', synced_version: '', path: '' } } };",
    "  process.stdout.write(process.env.SETUP_FAKE_AUDIT_MALFORMED === '1' ? 'not-json' : JSON.stringify(process.env.SETUP_FAKE_AUDIT_JSON ? JSON.parse(process.env.SETUP_FAKE_AUDIT_JSON) : fallback));",
    "}",
    'process.exit(0);', ''
  ].join('\n'));
  writeFile(path.join(root, 'repo', 'scripts', 'validate-toolkit.cjs'), options.validationFailure
    ? "'use strict';\nconsole.error('synthetic validation failure');\nprocess.exit(1);\n"
    : "'use strict';\nprocess.exit(0);\n");
  writeFile(path.join(root, 'repo', 'tests', 'toolkit-local-bridge-hook-light.test.cjs'), "'use strict';\nconst test = require('node:test');\ntest('fake hook light', () => {});\n");
}

function createGitBackedSetupRepo(root, options = {}) {
  const origin = path.join(root, 'origin.git');
  const setupRepo = path.join(root, 'repo');
  fs.mkdirSync(setupRepo, { recursive: true });
  runTestGit(root, ['init', '--bare', origin]);
  runTestGit(setupRepo, ['init']);
  runTestGit(setupRepo, ['checkout', '-b', 'main']);
  runTestGit(setupRepo, ['config', 'user.email', 'setup-test@example.invalid']);
  runTestGit(setupRepo, ['config', 'user.name', 'Setup Test']);
  createMinimalSetupRepo(setupRepo, options);
  runTestGit(setupRepo, ['add', '.']);
  runTestGit(setupRepo, ['commit', '-m', 'base']);
  runTestGit(setupRepo, ['remote', 'add', 'origin', origin]);
  runTestGit(setupRepo, ['push', '-u', 'origin', 'main']);
  return { origin, setupRepo };
}

function createGitBackedRealSetupRepo(root) {
  const result = createGitBackedSetupRepo(root);
  for (const name of ['setup-toolkit.cjs', 'setup-toolkit-core.cjs', 'codex-delegation-common.cjs', 'codex-delegation-layout.cjs', 'codex-delegation-state.cjs', 'codex-delegation-backup.cjs', 'codex-delegation-config.cjs', 'toolkit-agent-control.cjs', 'claude-process-launch.cjs', 'setup-claude-toolkit-plugin.cjs']) {
    writeFile(
      path.join(result.setupRepo, 'repo', 'scripts', name),
      fs.readFileSync(path.join(repoRoot, 'repo', 'scripts', name), 'utf8')
    );
  }
  runTestGit(result.setupRepo, ['add', 'repo/scripts']);
  runTestGit(result.setupRepo, ['commit', '-m', 'real setup scripts']);
  runTestGit(result.setupRepo, ['push', 'origin', 'main']);
  return result;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createFakeManagedSetupScript(root, options = {}) {
  const managedPath = path.join(root, '.ai-agent-toolkit', 'source', 'ai-agent-toolkit');
  const scriptPath = path.join(managedPath, 'repo', 'scripts', 'setup-toolkit.cjs');
  const exitCode = Number.isInteger(options.exitCode) ? options.exitCode : 23;
  writeFile(scriptPath, [
    '#!/usr/bin/env node', "'use strict';",
    "console.log('managed setup script version 2.7.10');",
    ...(options.emitQuestionBank === false ? [] : [
      "console.log('<!-- setup-toolkit-question-bank:begin -->');",
      "console.log('# Toolkit setup choices');",
      "console.log('<!-- setup-toolkit-question-bank:complete -->');"
    ]),
    ...(options.extraLines || []),
    "console.log('Setup script path executed: ' + __filename);",
    `process.exit(${exitCode});`, ''
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

function runWithUnclosedStdin(scriptPath, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: options.cwd || repoRoot,
      env: { ...process.env, ...(options.env || {}) },
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true
    });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`setup did not exit\n${stdout}\n${stderr}`)); }, options.deadlineMs || 120000);
    child.on('error', (error) => { clearTimeout(timer); child.stdin.destroy(); reject(error); });
    child.on('exit', (code) => { clearTimeout(timer); child.stdin.destroy(); resolve({ code, stdout, stderr }); });
  });
}

function codexConfig(root) {
  return path.join(root, '.codex', 'config.toml');
}

function backupFiles(root) {
  const location = path.join(root, '.ai-agent-toolkit', 'backups', 'codex-delegation');
  if (!fs.existsSync(location)) return [];
  return fs.readdirSync(location, { recursive: true });
}

module.exports = { assert, fs, path, spawnSync, repoRoot, script, tmpRoot, isolatedHomeEnv, writeFile, createFakeCodexAppServer, run, runTestGit, createMinimalSetupRepo, createGitBackedSetupRepo, createGitBackedRealSetupRepo, escapeRegExp, createFakeManagedSetupScript, runWithUnclosedStdin, codexConfig, backupFiles };
