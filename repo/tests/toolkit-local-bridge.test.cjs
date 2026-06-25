'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const {
  runRepoValidation,
  getRepoValidationLabels,
  openUpdateReport,
  updateReportDir,
  cleanupUpdateReports
} = require('../scripts/toolkit-local-bridge.cjs');
const { verifyInstalledCacheFreshness } = require('../scripts/setup-codex-toolkit-plugin.cjs');
const { repairPluginRoot } = require('../scripts/repair-codex-plugin-windows-hooks.cjs');
const { auditPluginRoot, collectHookCommands } = require('../scripts/audit-n8n-skills-plugin-hooks.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');
const script = path.join(repoRoot, 'repo', 'scripts', 'toolkit-local-bridge.cjs');
const expectedBridgeVersion = '2.2.0';

function tmpBaseDir() {
  if (process.platform === 'win32' && process.env.USERPROFILE) {
    const userTemp = path.join(process.env.USERPROFILE, 'AppData', 'Local', 'Temp');
    fs.mkdirSync(userTemp, { recursive: true });
    return userTemp;
  }
  return os.tmpdir();
}

function tmpRoot() {
  return fs.mkdtempSync(path.join(tmpBaseDir(), 'toolkit-bridge-'));
}

function run(args, options = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}) },
    timeout: 30000
  });
}

function isolatedHomeEnv(root, extra = {}) {
  return {
    PATH: '',
    USERPROFILE: root,
    HOME: root,
    LOCALAPPDATA: path.join(root, 'local-app-data'),
    VIRTUAL_ENV: '',
    CONDA_PREFIX: '',
    UV_PYTHON: '',
    ...extra
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function repoSkillNames(root = repoRoot) {
  return fs.readdirSync(path.join(root, 'skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => fs.existsSync(path.join(root, 'skills', name, 'SKILL.md')))
    .sort();
}

function expectedManagedSkillNames(root = repoRoot) {
  return ['ai-agent-toolkit', ...repoSkillNames(root)].sort();
}

function targetSkillDirs(skillsRoot) {
  return fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(skillsRoot, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort();
}

function readPngSize(filePath) {
  const buffer = fs.readFileSync(filePath);
  assert.deepEqual(
    [...buffer.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    `${filePath} must be a PNG file`
  );
  assert.equal(buffer.toString('ascii', 12, 16), 'IHDR', `${filePath} must include a PNG IHDR chunk`);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function parseLastJson(stdout) {
  const start = stdout.indexOf('{');
  assert.notEqual(start, -1, stdout);
  return JSON.parse(stdout.slice(start));
}

function git(cwd, args) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' },
    timeout: 15000
  });
  assert.equal(
    result.status,
    0,
    `git ${args.join(' ')} failed in ${cwd}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  );
  return result.stdout.trim();
}

function currentBranch(repoPath) {
  return git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
}

function writeFile(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, 'utf8');
}

function quoteCommandPart(value) {
  assert.doesNotMatch(value, /"/, 'test command parts must not contain quotes');
  return `"${value}"`;
}

function writeFakePython(root) {
  const logPath = path.join(root, 'fake-python.log');
  const scriptPath = path.join(root, 'fake-python.cjs');
  writeFile(scriptPath, [
    "'use strict';",
    "const fs = require('node:fs');",
    `const logPath = ${JSON.stringify(logPath)};`,
    'const args = process.argv.slice(2);',
    "fs.appendFileSync(logPath, `${args.join(' ')}\\n`, 'utf8');",
    "if (args[0] === '--version') {",
    "  console.log('Python 3.11.0');",
    '  process.exit(0);',
    '}',
    "if (args[0] === '-m' && args[1] === 'pip' && args[2] === 'show' && args[3] === 'ag2') {",
    "  console.log('Name: ag2');",
    '  process.exit(0);',
    '}',
    'process.exit(4);',
    ''
  ].join('\n'), 'utf8');
  const command = `${quoteCommandPart(process.execPath)} ${quoteCommandPart(scriptPath)}`;
  return { command, logPath };
}

function writeFakePythonWithoutAg2(root) {
  const logPath = path.join(root, 'fake-python-without-ag2.log');
  const scriptPath = path.join(root, 'fake-python-without-ag2.cjs');
  writeFile(scriptPath, [
    "'use strict';",
    "const fs = require('node:fs');",
    `const logPath = ${JSON.stringify(logPath)};`,
    'const args = process.argv.slice(2);',
    "fs.appendFileSync(logPath, `${args.join(' ')}\\n`, 'utf8');",
    "if (args[0] === '--version') {",
    "  console.log('Python 3.11.0');",
    '  process.exit(0);',
    '}',
    "if (args[0] === '-m' && args[1] === 'pip' && args[2] === 'show' && args[3] === 'ag2') {",
    "  console.error('Package(s) not found: ag2');",
    '  process.exit(1);',
    '}',
    'process.exit(4);',
    ''
  ].join('\n'), 'utf8');
  const command = `${quoteCommandPart(process.execPath)} ${quoteCommandPart(scriptPath)}`;
  return { command, logPath };
}

function powershellSingleQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function csharpString(value) {
  return `@"${String(value).replace(/"/g, '""')}"`;
}

function writeFakePythonExecutable(exePath, logPath) {
  fs.mkdirSync(path.dirname(exePath), { recursive: true });
  const sourcePath = path.join(path.dirname(exePath), 'fake-python.cs');
  writeFile(sourcePath, [
    'using System;',
    'using System.IO;',
    '',
    'public static class FakePython {',
    '  public static int Main(string[] args) {',
    `    File.AppendAllText(${csharpString(logPath)}, string.Join(" ", args) + Environment.NewLine);`,
    '    if (args.Length == 1 && args[0] == "--version") {',
    '      Console.WriteLine("Python 3.14.0");',
    '      return 0;',
    '    }',
    '    if (args.Length == 4 && args[0] == "-m" && args[1] == "pip" && args[2] == "show" && args[3] == "ag2") {',
    '      Console.WriteLine("Name: ag2");',
    '      return 0;',
    '    }',
    '    return 4;',
    '  }',
    '}',
    ''
  ].join('\n'));
  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    `$ErrorActionPreference = 'Stop'; Add-Type -Path ${powershellSingleQuote(sourcePath)} -OutputAssembly ${powershellSingleQuote(exePath)} -OutputType ConsoleApplication`
  ], {
    encoding: 'utf8',
    timeout: 30000,
    windowsHide: true
  });
  assert.equal(result.status, 0, `failed to compile fake Python executable\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
}

function configureGitUser(repoPath) {
  git(repoPath, ['config', 'user.email', 'toolkit-test@example.invalid']);
  git(repoPath, ['config', 'user.name', 'Toolkit Bridge Test']);
}

function writeHookLightSmokeFixture(repoPath) {
  writeFile(path.join(repoPath, 'repo', 'tests', 'toolkit-local-bridge-hook-light.test.cjs'), [
    "'use strict';",
    "const assert = require('node:assert/strict');",
    "const test = require('node:test');",
    "test('fixture bridge smoke test passes', () => assert.equal(true, true));",
    ''
  ].join('\n'));
}

function writeRepoToolkitFixture(repoPath, label) {
  writeFile(path.join(repoPath, 'VERSION.txt'), `${label}\n`);
  writeFile(path.join(repoPath, 'skills', 'fixture-skill', 'SKILL.md'), [
    '---',
    'name: fixture-skill',
    `description: Fixture Toolkit skill for bridge repo source tests ${label}`,
    '---',
    '',
    `# Fixture Skill ${label}`,
    ''
  ].join('\n'));
  writeFile(path.join(repoPath, 'skills', 'fixture-skill', 'README.md'), `fixture ${label}\n`);
  writeFile(path.join(repoPath, 'repo', 'scripts', 'validate-toolkit.cjs'), [
    '#!/usr/bin/env node',
    "'use strict';",
    "if (process.env.TOOLKIT_BRIDGE_TEST_VALIDATE_FAIL === '1') {",
    "  console.error('validation failed by fixture');",
    '  process.exit(7);',
    '}',
    ''
  ].join('\n'));
  writeFile(path.join(repoPath, 'repo', 'tests', 'toolkit-local-bridge.test.cjs'), [
    "'use strict';",
    "const assert = require('node:assert/strict');",
    "const test = require('node:test');",
    "test('fixture bridge tests pass', () => assert.equal(true, true));",
    ''
  ].join('\n'));
  writeHookLightSmokeFixture(repoPath);
  writeFile(path.join(repoPath, 'repo', 'scripts', 'toolkit-local-bridge.cjs'), [
    '#!/usr/bin/env node',
    "'use strict';",
    "const fs = require('node:fs');",
    "const marker = process.env.TOOLKIT_BRIDGE_TEST_DELEGATE_MARKER;",
    "if (marker) fs.appendFileSync(marker, `${JSON.stringify(process.argv.slice(2))}\\n`, 'utf8');",
    "if (!process.argv.includes('--skip-repo-auto-update')) {",
    "  console.error('missing recursion guard');",
    '  process.exit(43);',
    '}',
    ''
  ].join('\n'));
}

function writeCodexPluginRefreshFixture(repoPath) {
  writeFile(path.join(repoPath, '.codex-plugin', 'plugin.json'), JSON.stringify({
    name: 'ai-agent-toolkit',
    version: expectedBridgeVersion,
    hooks: './.codex-plugin/hooks/hooks.json'
  }, null, 2));
  writeFile(path.join(repoPath, '.codex-plugin', 'assets', 'fixture.txt'), 'fixture asset\n');
  writeFile(path.join(repoPath, '.codex-plugin', 'hooks', 'hooks.json'), JSON.stringify({
    hooks: {
      SessionStart: [
        {
          matcher: 'startup',
          hooks: [
            {
              type: 'command',
              command: 'node repo/scripts/toolkit-local-bridge.cjs --hook --sync-enabled --write --sync-source codex-plugin'
            }
          ]
        }
      ]
    }
  }, null, 2));
  writeFile(path.join(repoPath, 'repo', 'scripts', 'setup-toolkit.cjs'), [
    '#!/usr/bin/env node',
    "'use strict';",
    ''
  ].join('\n'));
  writeFile(path.join(repoPath, 'repo', 'scripts', 'setup-codex-toolkit-plugin.cjs'), [
    '#!/usr/bin/env node',
    "'use strict';",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const source = process.cwd();",
    "const target = process.env.PLUGIN_ROOT;",
    "if (!target) { console.error('missing PLUGIN_ROOT'); process.exit(9); }",
    "fs.rmSync(target, { recursive: true, force: true });",
    "fs.mkdirSync(path.dirname(target), { recursive: true });",
    "fs.cpSync(source, target, {",
    "  recursive: true,",
    "  filter: (src) => !src.split(path.sep).includes('.git')",
    "});",
    "process.stdout.write(JSON.stringify({ ok: true }));",
    ''
  ].join('\n'));
}

function writeRealBridgeDelegator(repoPath) {
  writeFile(path.join(repoPath, 'repo', 'scripts', 'toolkit-local-bridge.cjs'), [
    '#!/usr/bin/env node',
    "'use strict';",
    "const { spawnSync } = require('node:child_process');",
    `const script = ${JSON.stringify(script)};`,
    "const result = spawnSync(process.execPath, [script, ...process.argv.slice(2)], {",
    "  cwd: process.cwd(),",
    "  encoding: 'utf8',",
    "  env: process.env,",
    "  timeout: 15000",
    "});",
    "if (result.stdout) process.stdout.write(result.stdout);",
    "if (result.stderr) process.stderr.write(result.stderr);",
    "process.exit(result.status || 0);",
    ''
  ].join('\n'));
}

function commitAll(repoPath, message) {
  git(repoPath, ['add', '.']);
  git(repoPath, ['commit', '-m', message]);
  return git(repoPath, ['rev-parse', 'HEAD']);
}

function createRepoAutoUpdateFixture() {
  const root = tmpRoot();
  const origin = path.join(root, 'origin.git');
  const repo = path.join(root, 'repo');
  const upstream = path.join(root, 'upstream');
  git(root, ['init', '--bare', origin]);
  fs.mkdirSync(repo, { recursive: true });
  git(repo, ['init']);
  git(repo, ['checkout', '-B', 'main']);
  configureGitUser(repo);
  writeRepoToolkitFixture(repo, 'initial');
  const initialCommit = commitAll(repo, 'initial toolkit fixture');
  git(repo, ['remote', 'add', 'origin', origin]);
  git(repo, ['push', '-u', 'origin', 'main']);
  git(root, ['--git-dir', origin, 'symbolic-ref', 'HEAD', 'refs/heads/main']);
  git(root, ['clone', origin, upstream]);
  configureGitUser(upstream);
  return { root, origin, repo, upstream, initialCommit };
}

function createMinimalToolkitSource(root, skills = { alpha: 'alpha v1\n', beta: 'beta v1\n' }) {
  const repo = path.join(root, 'source-repo');
  fs.mkdirSync(repo, { recursive: true });
  git(repo, ['init']);
  git(repo, ['checkout', '-B', 'main']);
  configureGitUser(repo);
  for (const [name, body] of Object.entries(skills)) {
    writeFile(path.join(repo, 'skills', name, 'SKILL.md'), [
      '---',
      `name: ${name}`,
      `description: ${name} fixture skill for Toolkit bridge tests`,
      '---',
      '',
      body.trimEnd(),
      ''
    ].join('\n'));
    writeFile(path.join(repo, 'skills', name, 'README.md'), `${name} readme\n`);
  }
  commitAll(repo, 'minimal toolkit skills');
  return repo;
}

function writeN8nPluginHookFixture(pluginRoot) {
  writeJson(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), {
    name: 'n8n-skills',
    version: '0.0.0-test',
    repository: 'https://github.com/n8n-io/skills'
  });
  writeJson(path.join(pluginRoot, 'hooks', 'hooks.json'), {
    hooks: {
      SessionStart: [
        {
          matcher: 'startup',
          hooks: [
            {
              type: 'command',
              command: 'hooks/session-start.sh'
            }
          ]
        }
      ],
      PreToolUse: [
        {
          matcher: 'mcp__n8n__get_node',
          hooks: [
            {
              type: 'command',
              command: 'bash hooks/pre-tool-use/_emit.sh'
            }
          ]
        }
      ],
      PostToolUse: [
        {
          matcher: 'mcp__n8n__validate_workflow',
          hooks: [
            {
              type: 'command',
              command: 'hooks/post-tool-use/validate-workflow.sh'
            }
          ]
        }
      ]
    }
  });

  writeFile(path.join(pluginRoot, 'hooks', 'session-start.sh'), [
    '#!/usr/bin/env bash',
    'INPUT="$(cat)"',
    'ADDITIONAL_CONTEXT="Load using-n8n-skills before n8n work."',
    'if command -v jq >/dev/null 2>&1; then',
    '  jq -n --arg ctx "${ADDITIONAL_CONTEXT}" \'{ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: $ctx } }\'',
    'fi',
    ''
  ].join('\n'));
  writeFile(path.join(pluginRoot, 'hooks', 'pre-tool-use', '_emit.sh'), [
    '#!/usr/bin/env bash',
    'INPUT="$(cat)"',
    'REMINDER="Load using-n8n-skills before n8n tool use."',
    'if command -v jq >/dev/null 2>&1; then',
    '  SESSION_ID="$(echo "${INPUT}" | jq -r \'.session_id // empty\' 2>/dev/null)"',
    'elif command -v python3 >/dev/null 2>&1; then',
    '  SESSION_ID="$(echo "${INPUT}" | python3 -c \'import json,sys; d=json.load(sys.stdin); print(d.get("session_id",""))\' 2>/dev/null)"',
    'else',
    '  exit 0',
    'fi',
    'if command -v jq >/dev/null 2>&1; then',
    '  jq -n --arg ctx "${REMINDER}" \'{ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: $ctx } }\'',
    'fi',
    ''
  ].join('\n'));
  writeFile(path.join(pluginRoot, 'hooks', 'post-tool-use', 'validate-workflow.sh'), [
    '#!/usr/bin/env bash',
    'if ! command -v jq >/dev/null 2>&1; then',
    '  exit 0',
    'fi',
    '',
    'INPUT="$(cat)"',
    'CODE="$(echo "$INPUT" | jq -r \'.tool_input.code // empty\' 2>/dev/null)"',
    'if [ -z "$CODE" ]; then',
    '  echo "No workflow code returned" >/dev/null',
    '  exit 0',
    'fi',
    'WARNINGS="Load using-n8n-skills before publishing workflows."',
    'jq -n --arg ctx "$WARNINGS" \'{',
    '  hookSpecificOutput: {',
    '    hookEventName: "PostToolUse",',
    '    additionalContext: $ctx',
    '  }',
    '}\'',
    ''
  ].join('\n'));

  for (const rel of [
    'hooks/session-start.sh',
    'hooks/pre-tool-use/_emit.sh',
    'hooks/post-tool-use/validate-workflow.sh'
  ]) {
    try {
      fs.chmodSync(path.join(pluginRoot, ...rel.split('/')), 0o755);
    } catch {
      // Windows Git Bash can usually run these, and chmod can be unavailable in restricted filesystems.
    }
  }
}

function pushRepoToolkitUpdate(fixture, label) {
  writeRepoToolkitFixture(fixture.upstream, label);
  const commit = commitAll(fixture.upstream, `update ${label}`);
  git(fixture.upstream, ['push', 'origin', 'main']);
  return commit;
}

function currentCommit(repoPath) {
  return git(repoPath, ['rev-parse', 'HEAD']);
}

function reportPathFromOutput(stdout) {
  const match = String(stdout || '').match(/Toolkit updated: (.+)$/m);
  assert.ok(match, stdout);
  return match[1].trim();
}

function readLatestReport(hub) {
  const state = readJson(path.join(hub, 'state.json'));
  assert.ok(state.last_update_report_path, 'state should record latest update report path');
  assert.equal(fs.existsSync(state.last_update_report_path), true, 'latest update report should exist');
  return {
    state,
    reportPath: state.last_update_report_path,
    text: fs.readFileSync(state.last_update_report_path, 'utf8')
  };
}

function createLegacyDelegatedSyncFixture() {
  const root = tmpRoot();
  const sourceRepo = createMinimalToolkitSource(root, { alpha: 'alpha legacy v1\n' });
  const fromCommit = currentCommit(sourceRepo);
  writeFile(path.join(sourceRepo, 'skills', 'alpha', 'SKILL.md'), [
    '---',
    'name: alpha',
    'description: alpha fixture skill for Toolkit bridge tests',
    '---',
    '',
    'alpha legacy v2',
    ''
  ].join('\n'));
  const toCommit = commitAll(sourceRepo, 'legacy delegated update');
  const hub = path.join(root, 'hub', 'current');
  writeJson(path.join(hub, 'state.json'), {
    schema_version: 1,
    architecture_version: 2,
    hub_version: expectedBridgeVersion,
    auto_sync_enabled: true,
    repo_path: sourceRepo,
    last_repo_update_status: 'updated',
    last_repo_update_from_commit: fromCommit,
    last_repo_update_to_commit: toCommit,
    targets: {
      ag2: {
        enabled: true,
        explicitly_disabled: false,
        synced_version: '1.0.0',
        synced_checksum: 'old'
      }
    }
  });
  return { root, sourceRepo, hub, fromCommit, toCommit };
}

test('dry-run audit performs no writes and reports planned targets', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  const opencodeConfig = path.join(root, 'opencode');
  fs.mkdirSync(opencodeConfig, { recursive: true });

  const result = run(['--hub', hub, '--audit', '--enable-target', 'opencode', '--opencode-config-dir', opencodeConfig]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(hub), false, 'dry-run must not create the hub');

  const audit = parseLastJson(result.stdout);
  assert.equal(audit.dry_run, true);
  assert.equal(audit.targets.opencode.enabled, true);
  assert.equal(audit.targets.opencode.would_write, true);
  assert.match(audit.targets.opencode.target_path, /opencode[\\/]skills$/);
});

test('explicit OpenCode setup writes only managed hub and OpenCode target paths', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  const opencodeConfig = path.join(root, 'opencode');
  const result = run([
    '--hub', hub,
    '--write',
    '--enable-target', 'opencode',
    '--opencode-config-dir', opencodeConfig,
    '--sync-source', 'codex-plugin'
  ]);
  assert.equal(result.status, 0, result.stderr);

  const state = readJson(path.join(hub, 'state.json'));
  const manifest = readJson(path.join(hub, 'manifest.json'));
  const opencodeSkillsRoot = path.join(opencodeConfig, 'skills');
  const targetSkill = path.join(opencodeConfig, 'skills', 'ai-agent-toolkit', 'SKILL.md');
  assert.equal(state.targets.opencode.enabled, true);
  assert.equal(state.targets.opencode.synced_version, expectedBridgeVersion);
  assert.equal(manifest.sync_source, 'codex-plugin');
  assert.ok(fs.existsSync(path.join(hub, 'adapters', 'opencode', 'skills', 'ai-agent-toolkit', 'SKILL.md')));
  assert.ok(fs.existsSync(targetSkill), 'OpenCode target skill is written only after explicit enablement');
  assert.equal(path.resolve(state.targets.opencode.target_path), path.resolve(path.join(opencodeConfig, 'skills')));
  assert.deepEqual(targetSkillDirs(opencodeSkillsRoot), expectedManagedSkillNames());
  assert.deepEqual(
    readJson(path.join(opencodeSkillsRoot, '.ai-agent-toolkit-managed.json')).managed_skill_names,
    expectedManagedSkillNames()
  );
  assert.doesNotMatch(targetSkill.replace(/\\/g, '/'), /\.agents\/skills/);
});

test('explicit OpenCode setup infers the user OpenCode skill location', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  const result = run(['--hub', hub, '--write', '--enable-target', 'opencode'], {
    env: isolatedHomeEnv(root)
  });
  assert.equal(result.status, 0, result.stderr);

  const targetSkill = path.join(root, '.config', 'opencode', 'skills', 'ai-agent-toolkit', 'SKILL.md');
  const audit = parseLastJson(run(['--hub', hub, '--audit'], { env: isolatedHomeEnv(root) }).stdout);
  assert.ok(fs.existsSync(targetSkill), 'OpenCode target skill should be installed into the user OpenCode config');
  assert.match(fs.readFileSync(targetSkill, 'utf8'), /AI Agent Toolkit Bridge/);
  assert.equal(path.resolve(audit.targets.opencode.target_path), path.resolve(path.dirname(path.dirname(targetSkill))));
  assert.equal(audit.targets.opencode.target_exists, true);
  assert.equal(audit.targets.opencode.synced, true);
});

test('explicit Antigravity 2 setup writes a plugin-scoped skill under Gemini config without package installs', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  const result = run(['--hub', hub, '--write', '--enable-target', 'ag2', '--sync-source', 'claude-plugin'], {
    env: isolatedHomeEnv(root)
  });
  assert.equal(result.status, 0, result.stderr);

  const state = readJson(path.join(hub, 'state.json'));
  const pluginRoot = path.join(root, '.gemini', 'config', 'plugins', 'ai-agent-toolkit');
  const pluginJson = readJson(path.join(pluginRoot, 'plugin.json'));
  const versionMarker = readJson(path.join(pluginRoot, 'installed_version.json'));
  const targetSkill = path.join(pluginRoot, 'skills', 'ai-agent-toolkit', 'SKILL.md');
  const audit = parseLastJson(run(['--hub', hub, '--audit'], { env: isolatedHomeEnv(root) }).stdout);

  assert.equal(state.targets.ag2.enabled, true);
  assert.equal(state.targets.ag2.synced_version, expectedBridgeVersion);
  assert.equal(pluginJson.name, 'ai-agent-toolkit');
  assert.equal(versionMarker.version, expectedBridgeVersion);
  assert.ok(fs.existsSync(targetSkill), 'Antigravity target skill should be installed into the plugin-scoped skills folder');
  assert.match(fs.readFileSync(targetSkill, 'utf8'), /AI Agent Toolkit AG2 Adapter/);
  assert.deepEqual(targetSkillDirs(path.join(pluginRoot, 'skills')), expectedManagedSkillNames());
  assert.deepEqual(
    readJson(path.join(pluginRoot, '.ai-agent-toolkit-managed.json')).managed_skill_names,
    expectedManagedSkillNames()
  );
  assert.equal(path.resolve(audit.targets.ag2.target_path), path.resolve(pluginRoot));
  assert.equal(audit.targets.ag2.target_exists, true);
  assert.equal(audit.targets.ag2.synced, true);
  assert.ok(fs.existsSync(path.join(hub, 'adapters', 'ag2', 'plugin.json')), 'hub should keep internal AG2 adapter metadata');
});

test('detected but not enabled OpenCode target receives no writes', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  const opencodeConfig = path.join(root, 'opencode');
  fs.mkdirSync(opencodeConfig, { recursive: true });

  const result = run(['--hub', hub, '--write', '--opencode-config-dir', opencodeConfig]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    fs.existsSync(path.join(opencodeConfig, 'skills', 'ai-agent-toolkit')),
    false,
    'OpenCode target must not be written without explicit enablement'
  );
});

test('OpenCode audit detects persisted bridge target state without enabling writes', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  const persistedTarget = path.join(root, 'opencode-persisted', 'skills', 'ai-agent-toolkit');
  writeJson(path.join(hub, 'state.json'), {
    schema_version: 1,
    architecture_version: 2,
    hub_version: expectedBridgeVersion,
    targets: {
      opencode: {
        enabled: false,
        detected: true,
        target_path: persistedTarget,
        synced_version: expectedBridgeVersion,
        synced_checksum: 'older'
      }
    }
  });

  const result = run(['--hub', hub, '--audit', '--opencode-command', 'missing-opencode-command']);
  assert.equal(result.status, 0, result.stderr);
  const audit = parseLastJson(result.stdout);
  assert.equal(audit.targets.opencode.detected, true);
  assert.equal(audit.targets.opencode.enabled, false);
  assert.equal(audit.targets.opencode.status, 'detected');
  assert.equal(audit.targets.opencode.synced, false);
  assert.equal(path.resolve(audit.targets.opencode.target_path), path.resolve(path.dirname(persistedTarget)));
  assert.equal(audit.targets.opencode.signals.persisted_state, true);
  assert.equal(audit.targets.opencode.signals.migrated_target_path, true);
});

test('AG2 Python command can be persisted and reused without installing packages', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  const fakePython = writeFakePython(root);

  let result = run([
    '--hub', hub,
    '--write',
    '--set-ag2-python-command', fakePython.command,
    '--enable-target', 'ag2'
  ], { env: isolatedHomeEnv(root) });
  assert.equal(result.status, 0, result.stderr);

  let state = readJson(path.join(hub, 'state.json'));
  assert.equal(state.targets.ag2.enabled, true);
  assert.equal(state.targets.ag2.detected, true);
  assert.equal(state.targets.ag2.python_command, fakePython.command);
  assert.equal(state.targets.ag2.synced_version, expectedBridgeVersion);

  let invocations = fs.readFileSync(fakePython.logPath, 'utf8');
  assert.match(invocations, /--version/);
  assert.match(invocations, /-m pip show ag2/);
  assert.doesNotMatch(invocations, /\binstall\b/i);

  result = run(['--hub', hub, '--audit'], { env: isolatedHomeEnv(root) });
  assert.equal(result.status, 0, result.stderr);
  const audit = parseLastJson(result.stdout);
  assert.equal(audit.targets.ag2.detected, true);
  assert.equal(audit.targets.ag2.status, 'enabled');
  assert.equal(audit.targets.ag2.python_command, fakePython.command);
  assert.equal(audit.targets.ag2.ag2_package_detected, true);
  assert.equal(audit.targets.ag2.signals.selected_python_command, fakePython.command);

  state = readJson(path.join(hub, 'state.json'));
  assert.equal(state.targets.ag2.python_command, fakePython.command);
});

test('AG2 audit detects Antigravity config without requiring the Python ag2 package', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  const antigravityConfig = path.join(root, '.antigravity');
  const fakePython = writeFakePythonWithoutAg2(root);
  fs.mkdirSync(antigravityConfig, { recursive: true });

  const result = run(['--hub', hub, '--audit', '--python-command', fakePython.command], {
    env: {
      PATH: '',
      USERPROFILE: root,
      HOME: root,
      LOCALAPPDATA: path.join(root, 'local-app-data'),
      VIRTUAL_ENV: '',
      CONDA_PREFIX: '',
      UV_PYTHON: ''
    }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(hub), false, 'dry-run audit must not create the hub');

  const audit = parseLastJson(result.stdout);
  assert.equal(audit.targets.ag2.detected, true);
  assert.equal(audit.targets.ag2.status, 'detected');
  assert.equal(audit.targets.ag2.ag2_package_detected, false);
  assert.equal(audit.targets.ag2.python_command, '');
  assert.equal(audit.targets.ag2.would_write, false);
  assert.equal(path.resolve(audit.targets.ag2.signals.antigravity_config_dir), path.resolve(antigravityConfig));
  assert.equal(audit.targets.ag2.signals.antigravity_config_exists, true);
  assert.equal(audit.targets.ag2.signals.selected_python_command, '');
  assert.match(audit.targets.ag2.signals.tried_python_commands[0].ag2_package_output, /Package\(s\) not found: ag2/);
});

test('AG2 audit detects Gemini plugin config without requiring the Python ag2 package', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  const geminiConfig = path.join(root, '.gemini', 'config');
  const geminiPlugins = path.join(geminiConfig, 'plugins');
  const fakePython = writeFakePythonWithoutAg2(root);
  fs.mkdirSync(geminiPlugins, { recursive: true });

  const result = run(['--hub', hub, '--audit', '--python-command', fakePython.command], {
    env: {
      PATH: '',
      USERPROFILE: root,
      HOME: root,
      LOCALAPPDATA: path.join(root, 'local-app-data'),
      VIRTUAL_ENV: '',
      CONDA_PREFIX: '',
      UV_PYTHON: ''
    }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(hub), false, 'dry-run audit must not create the hub');

  const audit = parseLastJson(result.stdout);
  assert.equal(audit.targets.ag2.detected, true);
  assert.equal(audit.targets.ag2.status, 'detected');
  assert.equal(audit.targets.ag2.ag2_package_detected, false);
  assert.equal(audit.targets.ag2.python_command, '');
  assert.equal(audit.targets.ag2.would_write, false);
  assert.equal(path.resolve(audit.targets.ag2.signals.gemini_config_dir), path.resolve(geminiConfig));
  assert.equal(audit.targets.ag2.signals.gemini_config_exists, true);
  assert.equal(path.resolve(audit.targets.ag2.signals.gemini_plugins_dir), path.resolve(geminiPlugins));
  assert.equal(audit.targets.ag2.signals.gemini_plugins_dir_exists, true);
  assert.equal(audit.targets.ag2.signals.selected_python_command, '');
  assert.match(audit.targets.ag2.signals.tried_python_commands[0].ag2_package_output, /Package\(s\) not found: ag2/);
});

test('AG2 audit records exactly which Python commands were tried when not detected', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  writeJson(path.join(hub, 'state.json'), {
    schema_version: 1,
    architecture_version: 2,
    hub_version: expectedBridgeVersion,
    targets: {
      ag2: {
        enabled: false,
        python_command: 'missing-saved-python'
      }
    }
  });

  const result = run(['--hub', hub, '--audit', '--python-command', 'missing-explicit-python'], {
    env: {
      PATH: '',
      USERPROFILE: root,
      HOME: root,
      LOCALAPPDATA: path.join(root, 'local-app-data'),
      VIRTUAL_ENV: '',
      CONDA_PREFIX: '',
      UV_PYTHON: ''
    }
  });
  assert.equal(result.status, 0, result.stderr);
  const audit = parseLastJson(result.stdout);
  assert.equal(audit.targets.ag2.detected, false);
  assert.equal(audit.targets.ag2.status, 'not detected');
  assert.equal(audit.targets.ag2.python_command, '');
  const tried = audit.targets.ag2.signals.tried_python_commands.map((entry) => entry.command);
  assert.deepEqual(tried.slice(0, 2), ['missing-saved-python', 'missing-explicit-python']);
  assert.ok(tried.includes('python'), tried.join('\n'));
  assert.ok(tried.includes('python3'), tried.join('\n'));
  assert.ok(tried.includes('py'), tried.join('\n'));
});

test('AG2 Python discovery rejects command shims instead of invoking a shell', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  const shim = path.join(root, 'fake-python.cmd');
  const marker = path.join(root, 'shim-ran.txt');
  writeFile(shim, `echo shim ran > "${marker}"\n`);

  const result = run(['--hub', hub, '--audit', '--python-command', shim], {
    env: {
      PATH: '',
      USERPROFILE: root,
      HOME: root,
      LOCALAPPDATA: path.join(root, 'local-app-data'),
      VIRTUAL_ENV: '',
      CONDA_PREFIX: '',
      UV_PYTHON: ''
    }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(marker), false, 'command shim must not be invoked');
  const audit = parseLastJson(result.stdout);
  const first = audit.targets.ag2.signals.tried_python_commands[0];
  assert.equal(first.command, shim);
  assert.equal(first.python_ok, false);
  assert.match(first.python_error, /command shims/);
});

test('AG2 audit selects Windows user-local python versioned executables', {
  skip: process.platform !== 'win32' ? 'Windows user-local Python discovery is Windows-only' : false
}, (t) => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  const pythonExe = path.join(root, '.local', 'bin', 'python3.14.exe');
  const logPath = path.join(root, 'python3.14.log');
  writeFakePythonExecutable(pythonExe, logPath);
  const probe = spawnSync(pythonExe, ['--version'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
  if (probe.error && /\bUNKNOWN\b/.test(probe.error.message || '')) {
    t.skip(`freshly compiled fake Python executable cannot be spawned in this environment: ${probe.error.message}`);
    return;
  }
  assert.equal(probe.status, 0, `fake Python executable must run before discovery\nstdout:\n${probe.stdout}\nstderr:\n${probe.stderr}\nerror:\n${probe.error?.message || ''}`);

  const result = run(['--hub', hub, '--audit'], {
    env: {
      PATH: '',
      USERPROFILE: root,
      HOME: root,
      LOCALAPPDATA: path.join(root, 'local-app-data'),
      VIRTUAL_ENV: '',
      CONDA_PREFIX: '',
      UV_PYTHON: ''
    }
  });
  assert.equal(result.status, 0, result.stderr);
  const audit = parseLastJson(result.stdout);
  assert.equal(audit.targets.ag2.detected, true);
  assert.equal(path.resolve(audit.targets.ag2.python_command), path.resolve(pythonExe));
  assert.equal(path.resolve(audit.targets.ag2.signals.selected_python_command), path.resolve(pythonExe));
  const tried = audit.targets.ag2.signals.tried_python_commands.map((entry) => path.resolve(entry.command));
  assert.ok(tried.includes(path.resolve(pythonExe)), tried.join('\n'));

  const invocations = fs.readFileSync(logPath, 'utf8');
  assert.match(invocations, /--version/);
  assert.match(invocations, /-m pip show ag2/);
  assert.doesNotMatch(invocations, /\binstall\b/i);
});

test('sync-enabled command does not create bridge state before setup', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  const result = run(['--hub', hub, '--sync-enabled', '--write']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no enabled stale targets to sync/);
  assert.equal(fs.existsSync(hub), false);
});

test('sync-enabled updates enabled OpenCode and Antigravity app outputs after Toolkit changes', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  let result = run(['--hub', hub, '--write', '--enable-target', 'opencode', '--enable-target', 'ag2'], {
    env: isolatedHomeEnv(root)
  });
  assert.equal(result.status, 0, result.stderr);

  const opencodeSkill = path.join(root, '.config', 'opencode', 'skills', 'ai-agent-toolkit', 'SKILL.md');
  const ag2Skill = path.join(root, '.gemini', 'config', 'plugins', 'ai-agent-toolkit', 'skills', 'ai-agent-toolkit', 'SKILL.md');
  writeFile(opencodeSkill, 'stale opencode skill\n');
  writeFile(ag2Skill, 'stale ag2 skill\n');

  const statePath = path.join(hub, 'state.json');
  const state = readJson(statePath);
  state.targets.opencode.synced_version = '1.0.0';
  state.targets.opencode.synced_checksum = 'old';
  state.targets.ag2.synced_version = '1.0.0';
  state.targets.ag2.synced_checksum = 'old';
  writeJson(statePath, state);

  result = run(['--hub', hub, '--sync-enabled', '--write'], { env: isolatedHomeEnv(root) });
  assert.equal(result.status, 0, result.stderr);
  assert.match(fs.readFileSync(opencodeSkill, 'utf8'), /AI Agent Toolkit Bridge/);
  assert.match(fs.readFileSync(ag2Skill, 'utf8'), /AI Agent Toolkit AG2 Adapter/);

  const audit = parseLastJson(run(['--hub', hub, '--audit'], { env: isolatedHomeEnv(root) }).stdout);
  assert.equal(audit.targets.opencode.synced, true);
  assert.equal(audit.targets.ag2.synced, true);
  assert.equal(audit.targets.opencode.would_write, false);
  assert.equal(audit.targets.ag2.would_write, false);
});

test('skill payload checksum includes Toolkit repo skill files and marks enabled targets stale', () => {
  const root = tmpRoot();
  const sourceRepo = createMinimalToolkitSource(root);
  const hub = path.join(root, 'hub', 'current');
  let result = run([
    '--hub', hub,
    '--repo-path', sourceRepo,
    '--write',
    '--enable-target', 'ag2'
  ], { env: isolatedHomeEnv(root, { PATH: process.env.PATH }) });
  assert.equal(result.status, 0, result.stderr);

  let audit = parseLastJson(run(['--hub', hub, '--audit'], {
    env: isolatedHomeEnv(root, { PATH: process.env.PATH })
  }).stdout);
  assert.equal(audit.targets.ag2.synced, true);
  assert.equal(audit.targets.ag2.would_write, false);
  const beforeChecksum = audit.checksum;

  writeFile(path.join(sourceRepo, 'skills', 'alpha', 'README.md'), 'alpha changed\n');
  audit = parseLastJson(run(['--hub', hub, '--audit'], {
    env: isolatedHomeEnv(root, { PATH: process.env.PATH })
  }).stdout);
  assert.notEqual(audit.checksum, beforeChecksum);
  assert.equal(audit.targets.ag2.synced, false);
  assert.equal(audit.targets.ag2.would_write, true);
});

test('sync-enabled updates changed Toolkit skill contents from the configured repo source', () => {
  const root = tmpRoot();
  const sourceRepo = createMinimalToolkitSource(root);
  const hub = path.join(root, 'hub', 'current');
  let result = run([
    '--hub', hub,
    '--repo-path', sourceRepo,
    '--write',
    '--enable-target', 'opencode',
    '--enable-target', 'ag2'
  ], { env: isolatedHomeEnv(root, { PATH: process.env.PATH }) });
  assert.equal(result.status, 0, result.stderr);

  writeFile(path.join(sourceRepo, 'skills', 'alpha', 'SKILL.md'), [
    '---',
    'name: alpha',
    'description: alpha fixture skill for Toolkit bridge tests',
    '---',
    '',
    'alpha v2 from source repo',
    ''
  ].join('\n'));

  result = run(['--hub', hub, '--sync-enabled', '--write'], {
    env: isolatedHomeEnv(root, { PATH: process.env.PATH })
  });
  assert.equal(result.status, 0, result.stderr);

  assert.match(
    fs.readFileSync(path.join(root, '.config', 'opencode', 'skills', 'alpha', 'SKILL.md'), 'utf8'),
    /alpha v2 from source repo/
  );
  assert.match(
    fs.readFileSync(path.join(root, '.gemini', 'config', 'plugins', 'ai-agent-toolkit', 'skills', 'alpha', 'SKILL.md'), 'utf8'),
    /alpha v2 from source repo/
  );
});

test('removed managed Toolkit skills are cleaned up without deleting unrelated user skills or files', () => {
  const root = tmpRoot();
  const sourceRepo = createMinimalToolkitSource(root, { alpha: 'alpha v1\n', beta: 'beta v1\n' });
  const hub = path.join(root, 'hub', 'current');
  let result = run([
    '--hub', hub,
    '--repo-path', sourceRepo,
    '--write',
    '--enable-target', 'opencode',
    '--enable-target', 'ag2'
  ], { env: isolatedHomeEnv(root, { PATH: process.env.PATH }) });
  assert.equal(result.status, 0, result.stderr);

  const opencodeSkillsRoot = path.join(root, '.config', 'opencode', 'skills');
  const ag2PluginRoot = path.join(root, '.gemini', 'config', 'plugins', 'ai-agent-toolkit');
  writeFile(path.join(opencodeSkillsRoot, 'user-skill', 'SKILL.md'), 'user opencode skill\n');
  writeFile(path.join(ag2PluginRoot, 'skills', 'user-skill', 'SKILL.md'), 'user ag2 skill\n');
  writeFile(path.join(ag2PluginRoot, 'USER-NOTES.txt'), 'keep this note\n');

  fs.rmSync(path.join(sourceRepo, 'skills', 'beta'), { recursive: true, force: true });
  git(sourceRepo, ['add', '.']);
  git(sourceRepo, ['commit', '-m', 'remove beta skill']);

  result = run(['--hub', hub, '--sync-enabled', '--write'], {
    env: isolatedHomeEnv(root, { PATH: process.env.PATH })
  });
  assert.equal(result.status, 0, result.stderr);

  assert.equal(fs.existsSync(path.join(opencodeSkillsRoot, 'beta')), false);
  assert.equal(fs.existsSync(path.join(ag2PluginRoot, 'skills', 'beta')), false);
  assert.equal(fs.existsSync(path.join(opencodeSkillsRoot, 'user-skill', 'SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(ag2PluginRoot, 'skills', 'user-skill', 'SKILL.md')), true);
  assert.equal(fs.readFileSync(path.join(ag2PluginRoot, 'USER-NOTES.txt'), 'utf8'), 'keep this note\n');
});

test('old single-adapter AG2 target migrates to the full managed Toolkit skill set', () => {
  const root = tmpRoot();
  const sourceRepo = createMinimalToolkitSource(root, { alpha: 'alpha v1\n' });
  const hub = path.join(root, 'hub', 'current');
  const pluginRoot = path.join(root, '.gemini', 'config', 'plugins', 'ai-agent-toolkit');
  writeFile(path.join(pluginRoot, 'skills', 'ai-agent-toolkit', 'SKILL.md'), 'old adapter only\n');
  writeJson(path.join(hub, 'state.json'), {
    schema_version: 1,
    architecture_version: 2,
    hub_version: '2.1.0',
    auto_sync_enabled: true,
    repo_path: sourceRepo,
    targets: {
      ag2: {
        enabled: true,
        target_path: pluginRoot,
        synced_version: '2.1.0',
        synced_checksum: 'old'
      }
    }
  });

  const result = run(['--hub', hub, '--sync-enabled', '--write'], {
    env: isolatedHomeEnv(root, { PATH: process.env.PATH })
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(fs.readFileSync(path.join(pluginRoot, 'skills', 'ai-agent-toolkit', 'SKILL.md'), 'utf8'), /AI Agent Toolkit AG2 Adapter/);
  assert.match(fs.readFileSync(path.join(pluginRoot, 'skills', 'alpha', 'SKILL.md'), 'utf8'), /alpha v1/);

  const audit = parseLastJson(run(['--hub', hub, '--audit'], {
    env: isolatedHomeEnv(root, { PATH: process.env.PATH })
  }).stdout);
  assert.equal(audit.targets.ag2.synced, true);
  assert.equal(audit.targets.ag2.would_write, false);
});

test('audit separates hub adapter metadata from app-facing target sync', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  let result = run(['--hub', hub, '--write', '--enable-target', 'opencode', '--enable-target', 'ag2'], {
    env: isolatedHomeEnv(root)
  });
  assert.equal(result.status, 0, result.stderr);

  const opencodeTarget = path.join(root, '.config', 'opencode', 'skills');
  const ag2Target = path.join(root, '.gemini', 'config', 'plugins', 'ai-agent-toolkit');
  fs.rmSync(opencodeTarget, { recursive: true, force: true });
  fs.rmSync(ag2Target, { recursive: true, force: true });

  result = run(['--hub', hub, '--audit'], { env: isolatedHomeEnv(root) });
  assert.equal(result.status, 0, result.stderr);
  const audit = parseLastJson(result.stdout);
  assert.equal(audit.targets.opencode.internal_adapter_exists, true);
  assert.equal(audit.targets.opencode.target_exists, false);
  assert.equal(audit.targets.opencode.synced, false);
  assert.equal(audit.targets.opencode.would_write, true);
  assert.equal(path.resolve(audit.targets.opencode.internal_adapter_path), path.resolve(path.join(hub, 'adapters', 'opencode')));
  assert.equal(path.resolve(audit.targets.opencode.target_path), path.resolve(opencodeTarget));

  assert.equal(audit.targets.ag2.internal_adapter_exists, true);
  assert.equal(audit.targets.ag2.target_exists, false);
  assert.equal(audit.targets.ag2.synced, false);
  assert.equal(audit.targets.ag2.would_write, true);
  assert.equal(path.resolve(audit.targets.ag2.internal_adapter_path), path.resolve(path.join(hub, 'adapters', 'ag2')));
  assert.equal(path.resolve(audit.targets.ag2.target_path), path.resolve(ag2Target));
});

test('disabled target is not overwritten during later sync', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  let result = run(['--hub', hub, '--write', '--enable-target', 'opencode', '--enable-target', 'ag2'], {
    env: isolatedHomeEnv(root)
  });
  assert.equal(result.status, 0, result.stderr);

  const opencodeTargetDir = path.join(root, '.config', 'opencode', 'skills');
  const ag2TargetDir = path.join(root, '.gemini', 'config', 'plugins', 'ai-agent-toolkit');
  const opencodeMarker = path.join(opencodeTargetDir, 'USER-MARKER.txt');
  const ag2Marker = path.join(ag2TargetDir, 'USER-MARKER.txt');
  fs.writeFileSync(opencodeMarker, 'keep opencode\n', 'utf8');
  fs.writeFileSync(ag2Marker, 'keep ag2\n', 'utf8');

  result = run(['--hub', hub, '--write', '--disable-target', 'opencode', '--disable-target', 'ag2'], {
    env: isolatedHomeEnv(root)
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(opencodeMarker, 'utf8'), 'keep opencode\n');
  assert.equal(fs.readFileSync(ag2Marker, 'utf8'), 'keep ag2\n');

  result = run(['--hub', hub, '--sync-enabled', '--write'], { env: isolatedHomeEnv(root) });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(opencodeMarker, 'utf8'), 'keep opencode\n', 'disabled OpenCode target must not be overwritten');
  assert.equal(fs.readFileSync(ag2Marker, 'utf8'), 'keep ag2\n', 'disabled Antigravity target must not be overwritten');
});

test('older bridge refuses to overwrite newer hub state unless forced', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  writeJson(path.join(hub, 'state.json'), {
    schema_version: 1,
    architecture_version: 2,
    hub_version: '9.9.9',
    auto_sync_enabled: false,
    targets: {}
  });

  let result = run(['--hub', hub, '--write', '--enable-target', 'ag2'], { env: isolatedHomeEnv(root) });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Refusing downgrade/);

  result = run(['--hub', hub, '--write', '--force-downgrade', '--enable-target', 'ag2'], {
    env: isolatedHomeEnv(root)
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readJson(path.join(hub, 'state.json')).hub_version, expectedBridgeVersion);
});

test('fresh lock blocks manual writes and stale lock is recovered', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  const lockPath = path.join(root, 'hub', 'update.lock');
  writeJson(lockPath, { created_at: new Date().toISOString(), pid: 123 });

  let result = run(['--hub', hub, '--write', '--enable-target', 'ag2'], { env: isolatedHomeEnv(root) });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /fresh Toolkit bridge lock/);

  writeJson(lockPath, { created_at: '2000-01-01T00:00:00.000Z', pid: 123 });
  result = run(['--hub', hub, '--write', '--enable-target', 'ag2'], { env: isolatedHomeEnv(root) });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(lockPath), false, 'lock is released after successful sync');
});

test('hook mode does not create bridge state before setup', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  const result = run(['--hub', hub, '--hook', '--write', '--sync-source', 'codex-plugin']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(hub), false);
});

test('hook mode auto-syncs enabled stale targets only when auto-sync is enabled', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  writeJson(path.join(hub, 'state.json'), {
    schema_version: 1,
    architecture_version: 2,
    hub_version: '1.0.0',
    auto_sync_enabled: true,
    targets: {
      ag2: {
        enabled: true,
        explicitly_disabled: false,
        synced_version: '1.0.0',
        synced_checksum: 'old'
      }
    }
  });

  const result = run(['--hub', hub, '--hook', '--write', '--sync-source', 'claude-plugin'], {
    env: isolatedHomeEnv(root)
  });
  assert.equal(result.status, 0, result.stderr);
  const state = readJson(path.join(hub, 'state.json'));
  assert.equal(state.hub_version, expectedBridgeVersion);
  assert.equal(state.targets.ag2.synced_version, expectedBridgeVersion);
  assert.equal(state.last_sync_source, 'claude-plugin');
});

test('hook mode syncs enabled stale targets from the configured repo skill source', () => {
  const root = tmpRoot();
  const sourceRepo = createMinimalToolkitSource(root, { alpha: 'alpha hook source\n' });
  const hub = path.join(root, 'hub', 'current');
  writeJson(path.join(hub, 'state.json'), {
    schema_version: 1,
    architecture_version: 2,
    hub_version: '1.0.0',
    auto_sync_enabled: true,
    repo_path: sourceRepo,
    targets: {
      opencode: {
        enabled: true,
        explicitly_disabled: false,
        synced_version: '1.0.0',
        synced_checksum: 'old'
      }
    }
  });

  const result = run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'codex-plugin'], {
    env: isolatedHomeEnv(root, { PATH: process.env.PATH })
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    fs.readFileSync(path.join(root, '.config', 'opencode', 'skills', 'alpha', 'SKILL.md'), 'utf8'),
    /alpha hook source/
  );
  assert.match(
    fs.readFileSync(path.join(root, '.config', 'opencode', 'skills', 'ai-agent-toolkit', 'SKILL.md'), 'utf8'),
    /AI Agent Toolkit Bridge/
  );
});

test('hook mode validation uses hook-light smoke validation and skips full bridge test suite', () => {
  const fixture = createRepoAutoUpdateFixture();
  writeFile(path.join(fixture.repo, 'repo', 'tests', 'toolkit-local-bridge.test.cjs'), [
    "'use strict';",
    "const test = require('node:test');",
    "test('full suite sanity', () => assert.equal(1 + 1, 2));",
    ''
  ].join('\n'));
  writeFile(path.join(fixture.repo, 'repo', 'tests', 'toolkit-local-bridge-hook-light.test.cjs'), [
    "'use strict';",
    "const test = require('node:test');",
    "test('hook-light validation runs', () => {});",
    ''
  ].join('\n'));

  const fullSuiteValidation = getRepoValidationLabels();
  assert.equal(fullSuiteValidation.length, 2);
  assert.equal(fullSuiteValidation[0], 'node repo/scripts/validate-toolkit.cjs');
  assert.equal(fullSuiteValidation[1], 'node --test repo/tests/toolkit-local-bridge.test.cjs');

  const validation = runRepoValidation(path.join(fixture.repo), { hookMode: true });
  assert.equal(validation.status, 'passed');
  assert.equal(validation.commands.length, 2);
  assert.equal(validation.commands[0], 'node repo/scripts/validate-toolkit.cjs');
  assert.equal(
    validation.commands[1],
    'node --test repo/tests/toolkit-local-bridge-hook-light.test.cjs'
  );
});

test('startup hook mode syncs stale enabled OpenCode and Antigravity 2 targets and does not reuse stale repo status', () => {
  const root = tmpRoot();
  createMinimalToolkitSource(root, { alpha: 'alpha startup source\n' });
  const hub = path.join(root, 'hub', 'current');
  writeJson(path.join(hub, 'state.json'), {
    schema_version: 1,
    architecture_version: 2,
    hub_version: expectedBridgeVersion,
    auto_sync_enabled: true,
    repo_auto_update_enabled: false,
    last_repo_update_status: 'validation-failed',
    last_repo_update_from_commit: 'legacy-commit-a',
    last_repo_update_to_commit: 'legacy-commit-b',
    targets: {
      opencode: {
        enabled: true,
        explicitly_disabled: false,
        synced_version: '1.0.0',
        synced_checksum: 'legacy'
      },
      ag2: {
        enabled: true,
        explicitly_disabled: false,
        synced_version: '1.0.0',
        synced_checksum: 'legacy'
      }
    }
  });

  const result = run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'codex-plugin'], {
    env: isolatedHomeEnv(root, { PATH: process.env.PATH })
  });
  assert.equal(result.status, 0, result.stderr);
  const report = readLatestReport(hub);
  assert.match(report.text, /Synced Toolkit skills to OpenCode:/);
  assert.match(report.text, /Synced Toolkit skills to Antigravity 2:/);
  assert.match(report.text, /repo update status: `not run`/);
  assert.match(report.text, /hook-light validation: `not run`/);
  assert.match(report.text, /target sync status: `synced`/);
  const state = readJson(path.join(hub, 'state.json'));
  assert.equal(state.targets.opencode.synced_version, expectedBridgeVersion);
  assert.equal(state.targets.ag2.synced_version, expectedBridgeVersion);
});

test('hook report is generated when repo auto-update fast-forwards and lists changed files', () => {
  const fixture = createRepoAutoUpdateFixture();
  const hub = path.join(fixture.root, 'hub', 'current');
  const marker = path.join(fixture.root, 'delegate.log');
  const updatedCommit = pushRepoToolkitUpdate(fixture, 'report-fast-forward');
  let result = run([
    '--hub', hub,
    '--enable-repo-auto-update',
    '--repo-path', fixture.repo,
    '--repo-remote', fixture.origin,
    '--enable-auto-sync',
    '--enable-target', 'ag2',
    '--write'
  ], { env: isolatedHomeEnv(fixture.root, { PATH: process.env.PATH }) });
  assert.equal(result.status, 0, result.stderr);

  result = run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'codex-plugin'], {
    env: isolatedHomeEnv(fixture.root, {
      PATH: process.env.PATH,
      TOOLKIT_BRIDGE_TEST_DELEGATE_MARKER: marker
    })
  });
  assert.equal(result.status, 0, result.stderr);
  const reportPath = reportPathFromOutput(result.stdout);
  const report = readLatestReport(hub);
  assert.equal(path.resolve(report.reportPath), path.resolve(reportPath));
  assert.match(report.text, /^# AI Agent Toolkit Update/m);
  assert.match(report.text, new RegExp(`Toolkit updated to commit: \`${updatedCommit}\``));
  assert.match(report.text, new RegExp(`Previous commit: \`${fixture.initialCommit}\``));
  assert.match(report.text, /Source: `codex-plugin`/);
  assert.match(report.text, /- `VERSION\.txt`/);
  assert.match(report.text, /- `skills\/fixture-skill\/SKILL\.md`/);
  assert.match(report.text, /repo update status: `updated`/);
  assert.match(report.text, /hook-light validation: `passed`/);
  assert.match(report.text, /Skipped n8n\/live systems; not touched\./);
});

test('no-op repo auto-update hook with unchanged observed commit does not create a report', () => {
  const fixture = createRepoAutoUpdateFixture();
  const hub = path.join(fixture.root, 'hub', 'current');
  let result = run([
    '--hub', hub,
    '--enable-repo-auto-update',
    '--repo-path', fixture.repo,
    '--repo-branch', 'main',
    '--repo-remote', fixture.origin,
    '--enable-auto-sync',
    '--write'
  ], { env: isolatedHomeEnv(fixture.root, { PATH: process.env.PATH }) });
  assert.equal(result.status, 0, result.stderr);

  result = run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'claude-plugin'], {
    env: isolatedHomeEnv(fixture.root, { PATH: process.env.PATH })
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /Toolkit updated:/);
  let state = readJson(path.join(hub, 'state.json'));
  assert.equal(state.last_update_report_path || '', '');
  assert.equal(state.last_repo_update_status, 'up-to-date');
  assert.equal(state.last_repo_update_to_commit, fixture.initialCommit);

  result = run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'claude-plugin'], {
    env: isolatedHomeEnv(fixture.root, { PATH: process.env.PATH })
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /Toolkit updated:/);
  state = readJson(path.join(hub, 'state.json'));
  assert.equal(state.last_update_report_path || '', '');
});

test('hook report is generated when repo was already advanced before the hook run', () => {
  const fixture = createRepoAutoUpdateFixture();
  const hub = path.join(fixture.root, 'hub', 'current');
  let result = run([
    '--hub', hub,
    '--enable-repo-auto-update',
    '--repo-path', fixture.repo,
    '--repo-branch', 'main',
    '--repo-remote', fixture.origin,
    '--enable-auto-sync',
    '--write'
  ], { env: isolatedHomeEnv(fixture.root, { PATH: process.env.PATH }) });
  assert.equal(result.status, 0, result.stderr);

  result = run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'claude-plugin'], {
    env: isolatedHomeEnv(fixture.root, { PATH: process.env.PATH })
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readJson(path.join(hub, 'state.json')).last_repo_update_to_commit, fixture.initialCommit);

  const updatedCommit = pushRepoToolkitUpdate(fixture, 'already-advanced');
  git(fixture.repo, ['fetch', 'origin', 'main']);
  git(fixture.repo, ['merge', '--ff-only', 'FETCH_HEAD']);
  assert.equal(currentCommit(fixture.repo), updatedCommit);

  result = run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'claude-plugin'], {
    env: isolatedHomeEnv(fixture.root, { PATH: process.env.PATH })
  });
  assert.equal(result.status, 0, result.stderr);
  const report = readLatestReport(hub);
  assert.match(result.stdout, /Toolkit updated:/);
  assert.match(report.text, /Local repo was already advanced before this hook run\./);
  assert.match(report.text, /Likely from a manual pull or another local Git update\./);
  assert.match(report.text, /Configured branch: `main`/);
  assert.match(report.text, new RegExp(`Configured remote: \`${fixture.origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\``));
  assert.match(report.text, new RegExp(`Previous observed commit: \`${fixture.initialCommit}\``));
  assert.match(report.text, new RegExp(`Current commit: \`${updatedCommit}\``));
  assert.match(report.text, /repo update status: `up-to-date`/);
  assert.match(report.text, /target sync status: `not needed`/);
});

test('hook report includes both external repo advance and Antigravity 2 target sync', () => {
  const fixture = createRepoAutoUpdateFixture();
  const hub = path.join(fixture.root, 'hub', 'current');
  writeRealBridgeDelegator(fixture.repo);
  commitAll(fixture.repo, 'delegate to real bridge for target sync');
  git(fixture.repo, ['push', 'origin', 'main']);
  fixture.initialCommit = currentCommit(fixture.repo);
  git(fixture.upstream, ['fetch', 'origin', 'main']);
  git(fixture.upstream, ['reset', '--hard', 'origin/main']);

  let result = run([
    '--hub', hub,
    '--enable-repo-auto-update',
    '--repo-path', fixture.repo,
    '--repo-branch', 'main',
    '--repo-remote', fixture.origin,
    '--enable-auto-sync',
    '--enable-target', 'ag2',
    '--write'
  ], { env: isolatedHomeEnv(fixture.root, { PATH: process.env.PATH }) });
  assert.equal(result.status, 0, result.stderr);

  result = run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'claude-plugin'], {
    env: isolatedHomeEnv(fixture.root, { PATH: process.env.PATH })
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readJson(path.join(hub, 'state.json')).last_repo_update_to_commit, fixture.initialCommit);

  pushRepoToolkitUpdate(fixture, 'already-advanced-ag2-sync');
  writeRealBridgeDelegator(fixture.upstream);
  const updatedCommit = commitAll(fixture.upstream, 'delegate updated bridge target sync');
  git(fixture.upstream, ['push', 'origin', 'main']);
  git(fixture.repo, ['fetch', 'origin', 'main']);
  git(fixture.repo, ['merge', '--ff-only', 'FETCH_HEAD']);
  assert.equal(currentCommit(fixture.repo), updatedCommit);

  result = run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'claude-plugin'], {
    env: isolatedHomeEnv(fixture.root, { PATH: process.env.PATH })
  });
  assert.equal(result.status, 0, result.stderr);
  const report = readLatestReport(hub);
  assert.match(report.text, /Local repo was already advanced before this hook run\./);
  assert.match(report.text, /Synced Toolkit skills to Antigravity 2:/);
  assert.match(report.text, /Copied\/updated `2` Toolkit skills\./);
  assert.match(report.text, /repo update status: `up-to-date`/);
  assert.match(report.text, /target sync status: `synced`/);
});

test('hook report is generated when target sync happens without a repo commit change', () => {
  const root = tmpRoot();
  const sourceRepo = createMinimalToolkitSource(root, { alpha: 'alpha sync report\n' });
  const hub = path.join(root, 'hub', 'current');
  writeJson(path.join(hub, 'state.json'), {
    schema_version: 1,
    architecture_version: 2,
    hub_version: '1.0.0',
    auto_sync_enabled: true,
    repo_path: sourceRepo,
    targets: {
      opencode: {
        enabled: true,
        explicitly_disabled: false,
        synced_version: '1.0.0',
        synced_checksum: 'old'
      }
    }
  });

  const result = run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'claude-plugin'], {
    env: isolatedHomeEnv(root, { PATH: process.env.PATH })
  });
  assert.equal(result.status, 0, result.stderr);
  const reportPath = reportPathFromOutput(result.stdout);
  const report = readLatestReport(hub);
  assert.equal(path.resolve(report.reportPath), path.resolve(reportPath));
  assert.match(report.text, /Previous commit: `none`/);
  assert.match(report.text, /No repo commit change; local bridge target state was stale\./);
  assert.match(report.text, /Synced Toolkit skills to OpenCode:/);
  assert.match(report.text, /Copied\/updated `2` Toolkit skills\./);
  assert.match(report.text, /target sync status: `synced`/);
  assert.match(report.text, /checksum: `[a-f0-9]{64}`/);
});

test('hook report tells user to run setup toolkit when Codex native plugin cache is stale', () => {
  const root = tmpRoot();
  const sourceRepo = createMinimalToolkitSource(root, { alpha: 'alpha codex cache source\n' });
  const stalePluginRoot = path.join(root, 'codex-cache', 'ai-agent-toolkit');
  const hub = path.join(root, 'hub', 'current');

  writeFile(path.join(stalePluginRoot, 'skills', 'alpha', 'SKILL.md'), 'old alpha cache\n');
  let result = run([
    '--hub', hub,
    '--repo-path', sourceRepo,
    '--write',
    '--enable-auto-sync',
    '--enable-target', 'ag2',
    '--sync-source', 'codex-plugin'
  ], { env: isolatedHomeEnv(root, { PATH: process.env.PATH }) });
  assert.equal(result.status, 0, result.stderr);

  result = run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'codex-plugin'], {
    env: isolatedHomeEnv(root, {
      PATH: process.env.PATH,
      PLUGIN_ROOT: stalePluginRoot
    })
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Toolkit updated:/);

  const report = readLatestReport(hub);
  assert.match(report.text, /Codex native plugin cache: `stale`/);
  assert.match(report.text, /Enable Codex plugin auto-refresh|run `setup toolkit`/);
  assert.match(report.text, /target sync status: `not needed`/);
  assert.equal(report.state.targets.ag2.synced_version, expectedBridgeVersion);
  assert.match(report.state.last_update_report_signature, /^[a-f0-9]{64}$/);

  result = run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'codex-plugin'], {
    env: isolatedHomeEnv(root, {
      PATH: process.env.PATH,
      PLUGIN_ROOT: stalePluginRoot
    })
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /Toolkit updated:/);
  const repeatedState = readJson(path.join(hub, 'state.json'));
  assert.equal(repeatedState.last_update_report_path, report.reportPath);
  assert.equal(repeatedState.last_update_report_signature, report.state.last_update_report_signature);
});

test('Claude hook reports host-local manual native cache action and never runs Codex refresh', () => {
  const root = tmpRoot();
  const sourceRepo = createMinimalToolkitSource(root, { alpha: 'alpha claude cache source\n' });
  const claudePluginRoot = path.join(root, 'claude-cache', 'ai-agent-toolkit');
  const hub = path.join(root, 'hub', 'current');

  let result = run([
    '--hub', hub,
    '--repo-path', sourceRepo,
    '--write',
    '--enable-auto-sync',
    '--enable-target', 'ag2',
    '--sync-source', 'claude-plugin'
  ], { env: isolatedHomeEnv(root, { PATH: process.env.PATH }) });
  assert.equal(result.status, 0, result.stderr);
  const statePath = path.join(hub, 'state.json');
  const state = readJson(statePath);
  state.targets.ag2.synced_checksum = 'old';
  writeJson(statePath, state);

  result = run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'claude-plugin'], {
    env: isolatedHomeEnv(root, {
      PATH: process.env.PATH,
      CLAUDE_PLUGIN_ROOT: claudePluginRoot
    })
  });
  assert.equal(result.status, 0, result.stderr);
  const report = readLatestReport(hub);
  assert.match(report.text, /Claude Code native plugin cache: `check-only`/);
  assert.match(report.text, /refresh it through Claude Code native plugin flow/);
  assert.doesNotMatch(report.text, /Codex native plugin cache was auto-refreshed/);
});

test('hook auto-refreshes stale Codex native plugin cache only after setup opt-in', () => {
  const fixture = createRepoAutoUpdateFixture();
  const hub = path.join(fixture.root, 'hub', 'current');
  const stalePluginRoot = path.join(fixture.root, 'codex-cache', 'ai-agent-toolkit');
  writeCodexPluginRefreshFixture(fixture.repo);
  const refreshedCommit = commitAll(fixture.repo, 'add codex plugin refresh fixture');
  git(fixture.repo, ['push', 'origin', 'main']);
  writeFile(path.join(stalePluginRoot, 'repo', 'scripts', 'toolkit-local-bridge.cjs'), '// stale bridge cache\n');

  let result = run([
    '--hub', hub,
    '--enable-repo-auto-update',
    '--repo-path', fixture.repo,
    '--repo-branch', 'main',
    '--repo-remote', fixture.origin,
    '--enable-auto-sync',
    '--enable-codex-plugin-auto-refresh',
    '--write'
  ], { env: isolatedHomeEnv(fixture.root, { PATH: process.env.PATH }) });
  assert.equal(result.status, 0, result.stderr);

  result = run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'codex-plugin'], {
    env: isolatedHomeEnv(fixture.root, {
      PATH: process.env.PATH,
      PLUGIN_ROOT: stalePluginRoot
    })
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Toolkit updated:/);
  assert.equal(currentCommit(fixture.repo), refreshedCommit);
  assert.deepEqual(
    verifyInstalledCacheFreshness(stalePluginRoot, fixture.repo),
    [],
    'auto-refresh should leave the installed plugin cache matching the trusted repo'
  );

  const report = readLatestReport(hub);
  assert.match(report.text, /Codex native plugin cache was auto-refreshed/);
  assert.match(report.text, /Codex native plugin cache: `refreshed`/);
  const state = readJson(path.join(hub, 'state.json'));
  assert.equal(state.codex_plugin_auto_refresh_enabled, true);
});

test('hook report records removed stale managed skill folders during target sync', () => {
  const root = tmpRoot();
  const sourceRepo = createMinimalToolkitSource(root, { alpha: 'alpha v1\n', beta: 'beta v1\n' });
  const hub = path.join(root, 'hub', 'current');
  let result = run([
    '--hub', hub,
    '--repo-path', sourceRepo,
    '--write',
    '--enable-auto-sync',
    '--enable-target', 'opencode'
  ], { env: isolatedHomeEnv(root, { PATH: process.env.PATH }) });
  assert.equal(result.status, 0, result.stderr);

  fs.rmSync(path.join(sourceRepo, 'skills', 'beta'), { recursive: true, force: true });
  git(sourceRepo, ['add', '.']);
  git(sourceRepo, ['commit', '-m', 'remove beta skill']);

  result = run(['--hub', hub, '--hook', '--sync-enabled', '--write'], {
    env: isolatedHomeEnv(root, { PATH: process.env.PATH })
  });
  assert.equal(result.status, 0, result.stderr);
  const report = readLatestReport(hub);
  assert.match(report.text, /Removed stale managed skill folders:/);
  assert.match(report.text, /- `beta`/);
});

test('no-op hook sync does not generate or open an update report', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  let result = run(['--hub', hub, '--write', '--enable-target', 'ag2'], {
    env: isolatedHomeEnv(root)
  });
  assert.equal(result.status, 0, result.stderr);
  const existingState = readJson(path.join(hub, 'state.json'));
  assert.equal(existingState.last_update_report_path || '', '');

  result = run(['--hub', hub, '--hook', '--sync-enabled', '--write'], {
    env: isolatedHomeEnv(root)
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /Toolkit updated:/);
  const state = readJson(path.join(hub, 'state.json'));
  assert.equal(state.last_update_report_path || '', '');
});

test('legacy delegated repo sync writes an update report using stored repo update metadata', () => {
  const fixture = createLegacyDelegatedSyncFixture();
  const result = run([
    '--hub', fixture.hub,
    '--sync-enabled',
    '--write',
    '--sync-source', 'repo',
    '--skip-repo-auto-update'
  ], {
    env: isolatedHomeEnv(fixture.root, { PATH: process.env.PATH })
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Toolkit update report:/);

  const targetSkill = path.join(
    fixture.root,
    '.gemini',
    'config',
    'plugins',
    'ai-agent-toolkit',
    'skills',
    'alpha',
    'SKILL.md'
  );
  assert.match(fs.readFileSync(targetSkill, 'utf8'), /alpha legacy v2/);

  const report = readLatestReport(fixture.hub);
  assert.match(report.text, /## TL;DR/);
  assert.match(report.text, new RegExp(`Toolkit updated to commit: \`${fixture.toCommit}\``));
  assert.match(report.text, new RegExp(`Previous commit: \`${fixture.fromCommit}\``));
  assert.match(report.text, /Source: `repo`/);
  assert.match(report.text, /Time \(SGT\): `\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} SGT`/);
  assert.doesNotMatch(report.text, /Timestamp: `\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z`/);
  assert.match(report.text, /Repo: updated from [0-9a-f]{8} to [0-9a-f]{8}\./);
  assert.match(report.text, /Targets: synced Antigravity 2 \(2 skills\)\./);
  assert.match(report.text, /Action needed: none\./);
  assert.match(report.text, /- `skills\/alpha\/SKILL\.md`/);
  assert.match(report.text, /Synced Toolkit skills to Antigravity 2:/);
  assert.match(report.text, /Copied\/updated `2` Toolkit skills\./);
  assert.match(report.text, /repo update status: `updated`/);
  assert.match(report.text, /target sync status: `synced`/);
  assert.match(report.text, /checksum: `[a-f0-9]{64}`/);
  assert.match(report.text, /Skipped n8n\/live systems; not touched\./);
});

test('suppressed legacy delegated repo sync does not write an update report', () => {
  const fixture = createLegacyDelegatedSyncFixture();
  const result = run([
    '--hub', fixture.hub,
    '--sync-enabled',
    '--write',
    '--sync-source', 'repo',
    '--skip-repo-auto-update',
    '--suppress-update-report'
  ], {
    env: isolatedHomeEnv(fixture.root, { PATH: process.env.PATH })
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /Toolkit update report:/);
  assert.equal(readJson(path.join(fixture.hub, 'state.json')).last_update_report_path || '', '');
  assert.match(
    fs.readFileSync(path.join(
      fixture.root,
      '.gemini',
      'config',
      'plugins',
      'ai-agent-toolkit',
      'skills',
      'alpha',
      'SKILL.md'
    ), 'utf8'),
    /alpha legacy v2/
  );
});

test('enabling repo auto-update records repo path branch and remote in hub state', () => {
  const fixture = createRepoAutoUpdateFixture();
  const hub = path.join(fixture.root, 'hub', 'current');

  const result = run([
    '--hub', hub,
    '--enable-repo-auto-update',
    '--repo-path', fixture.repo,
    '--repo-branch', 'main',
    '--repo-remote', fixture.origin,
    '--write'
  ]);
  assert.equal(result.status, 0, result.stderr);

  const state = readJson(path.join(hub, 'state.json'));
  assert.equal(state.repo_auto_update_enabled, true);
  assert.equal(path.resolve(state.repo_path), path.resolve(fixture.repo));
  assert.equal(state.repo_branch, 'main');
  assert.equal(path.resolve(state.repo_remote), path.resolve(fixture.origin));
  assert.equal(state.last_repo_update_status, 'configured');
});

test('hook mode does nothing when repo auto-update is disabled', () => {
  const fixture = createRepoAutoUpdateFixture();
  const hub = path.join(fixture.root, 'hub', 'current');
  const marker = path.join(fixture.root, 'delegate.log');
  writeJson(path.join(hub, 'state.json'), {
    schema_version: 1,
    architecture_version: 2,
    hub_version: '2.0.0',
    auto_sync_enabled: false,
    repo_auto_update_enabled: false,
    repo_path: fixture.repo,
    repo_branch: 'main',
    repo_remote: fixture.origin,
    targets: {}
  });

  const result = run(['--hub', hub, '--hook', '--sync-enabled', '--write'], {
    env: { TOOLKIT_BRIDGE_TEST_DELEGATE_MARKER: marker }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(marker), false);
  assert.equal(readJson(path.join(hub, 'state.json')).last_repo_update_status || '', '');
});

test('hook mode refuses a dirty repo before update and does not sync targets', () => {
  const fixture = createRepoAutoUpdateFixture();
  const hub = path.join(fixture.root, 'hub', 'current');
  const marker = path.join(fixture.root, 'delegate.log');
  let result = run([
    '--hub', hub,
    '--enable-repo-auto-update',
    '--repo-path', fixture.repo,
    '--repo-remote', fixture.origin,
    '--enable-auto-sync',
    '--enable-target', 'ag2',
    '--write'
  ], { env: isolatedHomeEnv(fixture.root, { PATH: process.env.PATH }) });
  assert.equal(result.status, 0, result.stderr);
  git(fixture.repo, ['checkout', '-b', 'feature-work']);
  writeFile(path.join(fixture.repo, 'DIRTY.txt'), 'dirty\n');

  result = run(['--hub', hub, '--hook', '--sync-enabled', '--write'], {
    env: isolatedHomeEnv(fixture.root, {
      PATH: process.env.PATH,
      TOOLKIT_BRIDGE_TEST_DELEGATE_MARKER: marker
    })
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(marker), false);
  assert.equal(currentBranch(fixture.repo), 'feature-work');
  const state = readJson(path.join(hub, 'state.json'));
  assert.equal(state.last_repo_update_status, 'skipped');
  assert.match(state.last_repo_update_error, /dirty/i);
  const report = readLatestReport(hub);
  assert.match(result.stdout, /Toolkit updated:/);
  assert.match(report.text, /repo update status: `skipped`/);
  assert.match(report.text, /warning\/error: `dirty working tree`/i);
});

test('hook mode auto-switches a clean repo back to main before update and sync', () => {
  const fixture = createRepoAutoUpdateFixture();
  const hub = path.join(fixture.root, 'hub', 'current');
  const marker = path.join(fixture.root, 'delegate.log');
  let result = run([
    '--hub', hub,
    '--enable-repo-auto-update',
    '--repo-path', fixture.repo,
    '--repo-branch', 'main',
    '--repo-remote', fixture.origin,
    '--enable-auto-sync',
    '--enable-target', 'ag2',
    '--write'
  ], { env: isolatedHomeEnv(fixture.root, { PATH: process.env.PATH }) });
  assert.equal(result.status, 0, result.stderr);

  git(fixture.repo, ['checkout', '-b', 'feature-work']);
  assert.equal(currentBranch(fixture.repo), 'feature-work');

  result = run(['--hub', hub, '--hook', '--sync-enabled', '--write'], {
    env: isolatedHomeEnv(fixture.root, {
      PATH: process.env.PATH,
      TOOLKIT_BRIDGE_TEST_DELEGATE_MARKER: marker
    })
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(currentBranch(fixture.repo), 'main');
  assert.equal(fs.existsSync(marker), true);
  const state = readJson(path.join(hub, 'state.json'));
  assert.equal(state.last_repo_update_status, 'up-to-date');
  assert.equal(state.last_repo_update_error || '', '');
  const report = readLatestReport(hub);
  assert.match(result.stdout, /Toolkit updated:/);
  assert.match(report.text, /## TL;DR/);
  assert.match(report.text, /Repo: auto-switched to `main`; already up to date\./);
  assert.match(report.text, /Bridge action: auto-switched clean Toolkit repo from `feature-work` to `main`\./);
});

test('hook mode rejects a repo whose origin remote does not match configured remote', () => {
  const fixture = createRepoAutoUpdateFixture();
  const hub = path.join(fixture.root, 'hub', 'current');
  const marker = path.join(fixture.root, 'delegate.log');
  let result = run([
    '--hub', hub,
    '--enable-repo-auto-update',
    '--repo-path', fixture.repo,
    '--repo-remote', `${fixture.origin}-other`,
    '--enable-auto-sync',
    '--enable-target', 'ag2',
    '--write'
  ], { env: isolatedHomeEnv(fixture.root, { PATH: process.env.PATH }) });
  assert.equal(result.status, 0, result.stderr);

  result = run(['--hub', hub, '--hook', '--sync-enabled', '--write'], {
    env: isolatedHomeEnv(fixture.root, {
      PATH: process.env.PATH,
      TOOLKIT_BRIDGE_TEST_DELEGATE_MARKER: marker
    })
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(marker), false);
  const state = readJson(path.join(hub, 'state.json'));
  assert.equal(state.last_repo_update_status, 'skipped');
  assert.match(state.last_repo_update_error, /remote/i);
});

test('hook mode performs a fast-forward repo update before delegating sync', () => {
  const fixture = createRepoAutoUpdateFixture();
  const hub = path.join(fixture.root, 'hub', 'current');
  const marker = path.join(fixture.root, 'delegate.log');
  const updatedCommit = pushRepoToolkitUpdate(fixture, 'fast-forward');
  let result = run([
    '--hub', hub,
    '--enable-repo-auto-update',
    '--repo-path', fixture.repo,
    '--repo-remote', fixture.origin,
    '--enable-auto-sync',
    '--enable-target', 'ag2',
    '--write'
  ], { env: isolatedHomeEnv(fixture.root, { PATH: process.env.PATH }) });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(currentCommit(fixture.repo), fixture.initialCommit);

  result = run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'codex-plugin'], {
    env: isolatedHomeEnv(fixture.root, {
      PATH: process.env.PATH,
      TOOLKIT_BRIDGE_TEST_DELEGATE_MARKER: marker
    })
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(currentCommit(fixture.repo), updatedCommit);

  const delegateArgs = fs.readFileSync(marker, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(delegateArgs.length, 1);
  assert.deepEqual(delegateArgs[0], [
    '--sync-enabled',
    '--write',
    '--sync-source',
    'repo',
    '--hub',
    hub,
    '--skip-repo-auto-update',
    '--suppress-update-report'
  ]);
  const state = readJson(path.join(hub, 'state.json'));
  assert.equal(state.last_repo_update_status, 'updated');
  assert.equal(state.last_repo_update_from_commit, fixture.initialCommit);
  assert.equal(state.last_repo_update_to_commit, updatedCommit);
});

test('repo update failure does not sync targets', () => {
  const fixture = createRepoAutoUpdateFixture();
  const hub = path.join(fixture.root, 'hub', 'current');
  const marker = path.join(fixture.root, 'delegate.log');
  let result = run([
    '--hub', hub,
    '--enable-repo-auto-update',
    '--repo-path', fixture.repo,
    '--repo-remote', fixture.origin,
    '--enable-auto-sync',
    '--enable-target', 'ag2',
    '--write'
  ], { env: isolatedHomeEnv(fixture.root, { PATH: process.env.PATH }) });
  assert.equal(result.status, 0, result.stderr);

  writeFile(path.join(fixture.repo, 'LOCAL.txt'), 'local\n');
  const localCommit = commitAll(fixture.repo, 'local divergence');
  pushRepoToolkitUpdate(fixture, 'remote-divergence');

  result = run(['--hub', hub, '--hook', '--sync-enabled', '--write'], {
    env: isolatedHomeEnv(fixture.root, {
      PATH: process.env.PATH,
      TOOLKIT_BRIDGE_TEST_DELEGATE_MARKER: marker
    })
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(currentCommit(fixture.repo), localCommit);
  assert.equal(fs.existsSync(marker), false);
  const state = readJson(path.join(hub, 'state.json'));
  assert.equal(state.last_repo_update_status, 'skipped');
  assert.match(state.last_repo_update_error, /fast-forward/i);
});

test('validation failure after update does not sync targets', () => {
  const fixture = createRepoAutoUpdateFixture();
  const hub = path.join(fixture.root, 'hub', 'current');
  const marker = path.join(fixture.root, 'delegate.log');
  const updatedCommit = pushRepoToolkitUpdate(fixture, 'validation-failure');
  let result = run([
    '--hub', hub,
    '--enable-repo-auto-update',
    '--repo-path', fixture.repo,
    '--repo-remote', fixture.origin,
    '--enable-auto-sync',
    '--enable-target', 'ag2',
    '--write'
  ], { env: isolatedHomeEnv(fixture.root, { PATH: process.env.PATH }) });
  assert.equal(result.status, 0, result.stderr);

  result = run(['--hub', hub, '--hook', '--sync-enabled', '--write'], {
    env: isolatedHomeEnv(fixture.root, {
      PATH: process.env.PATH,
      TOOLKIT_BRIDGE_TEST_DELEGATE_MARKER: marker,
      TOOLKIT_BRIDGE_TEST_VALIDATE_FAIL: '1'
    })
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(currentCommit(fixture.repo), updatedCommit);
  assert.equal(fs.existsSync(marker), false);
  const state = readJson(path.join(hub, 'state.json'));
  assert.equal(state.last_repo_update_status, 'validation-failed');
  assert.equal(state.last_repo_update_from_commit, fixture.initialCommit);
  assert.equal(state.last_repo_update_to_commit, updatedCommit);
  assert.match(state.last_repo_update_error, /validate-toolkit/i);
  const report = readLatestReport(hub);
  assert.match(result.stdout, /Toolkit updated:/);
  assert.match(report.text, /repo update status: `validation-failed`/);
  assert.match(report.text, /hook-light validation: `failed/);
  assert.match(report.text, /- `VERSION\.txt`/);
});

test('skip repo auto-update guard prevents recursive repo update', () => {
  const fixture = createRepoAutoUpdateFixture();
  const hub = path.join(fixture.root, 'hub', 'current');
  const marker = path.join(fixture.root, 'delegate.log');
  writeJson(path.join(hub, 'state.json'), {
    schema_version: 1,
    architecture_version: 2,
    hub_version: '2.0.0',
    auto_sync_enabled: false,
    repo_auto_update_enabled: true,
    repo_path: path.join(fixture.root, 'missing-repo'),
    repo_branch: 'main',
    repo_remote: fixture.origin,
    targets: {}
  });

  const result = run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--skip-repo-auto-update'], {
    env: { TOOLKIT_BRIDGE_TEST_DELEGATE_MARKER: marker }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(marker), false);
  assert.equal(readJson(path.join(hub, 'state.json')).last_repo_update_status || '', '');
});

test('audit output reports repo auto-update state and last status', () => {
  const fixture = createRepoAutoUpdateFixture();
  const hub = path.join(fixture.root, 'hub', 'current');
  let result = run([
    '--hub', hub,
    '--enable-repo-auto-update',
    '--repo-path', fixture.repo,
    '--repo-branch', 'main',
    '--repo-remote', fixture.origin,
    '--write'
  ]);
  assert.equal(result.status, 0, result.stderr);

  result = run(['--hub', hub, '--audit']);
  assert.equal(result.status, 0, result.stderr);
  const audit = parseLastJson(result.stdout);
  assert.equal(audit.repo_auto_update.enabled, true);
  assert.equal(path.resolve(audit.repo_auto_update.repo_path), path.resolve(fixture.repo));
  assert.equal(audit.repo_auto_update.repo_branch, 'main');
  assert.equal(path.resolve(audit.repo_auto_update.repo_remote), path.resolve(fixture.origin));
  assert.equal(audit.repo_auto_update.last_status, 'configured');
});

test('audit output includes latest update report path', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  writeJson(path.join(hub, 'state.json'), {
    schema_version: 1,
    architecture_version: 2,
    hub_version: expectedBridgeVersion,
    last_update_report_path: path.join(root, 'reports', 'latest.md'),
    targets: {}
  });

  const result = run(['--hub', hub, '--audit'], {
    env: isolatedHomeEnv(root)
  });
  assert.equal(result.status, 0, result.stderr);
  const audit = parseLastJson(result.stdout);
  assert.equal(audit.last_update_report_path, path.join(root, 'reports', 'latest.md'));
});

test('update report opening is Windows-only notepad and rejects non-report paths', () => {
  const calls = [];
  const reportDir = updateReportDir();
  const reportPath = path.join(reportDir, 'toolkit-update-20990101-010203.md');
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(reportPath, '# report\n', 'utf8');
  const fakeChild = { unref() { calls.push(['unref']); } };
  const opened = openUpdateReport(reportPath, {
    platform: 'win32',
    spawnImpl(command, args, options) {
      calls.push([command, args, options]);
      return fakeChild;
    }
  });

  assert.equal(opened.ok, true);
  assert.equal(calls[0][0], 'notepad.exe');
  assert.deepEqual(calls[0][1], [reportPath]);
  assert.equal(calls[0][2].detached, true);
  assert.equal(calls[0][2].stdio, 'ignore');
  assert.deepEqual(calls[1], ['unref']);

  assert.equal(openUpdateReport(path.join(os.tmpdir(), 'not-a-toolkit-report.md'), {
    platform: 'win32',
    spawnImpl() {
      throw new Error('must not spawn for unsafe paths');
    }
  }).ok, false);
  assert.equal(openUpdateReport(reportPath, {
    platform: 'linux',
    spawnImpl() {
      throw new Error('must not spawn on non-Windows');
    }
  }).ok, false);
});

test('update report opening is persisted opt-in', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  let result = run(['--hub', hub, '--enable-update-report-open', '--write'], {
    env: isolatedHomeEnv(root)
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readJson(path.join(hub, 'state.json')).update_report_open_enabled, true);

  result = run(['--hub', hub, '--disable-update-report-open', '--write'], {
    env: isolatedHomeEnv(root)
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readJson(path.join(hub, 'state.json')).update_report_open_enabled, false);
});

test('update report cleanup deletes only old Toolkit-managed reports inside the report root', () => {
  const root = tmpRoot();
  const reportDir = path.join(root, 'reports');
  fs.mkdirSync(reportDir, { recursive: true });
  const oldReport = path.join(reportDir, 'toolkit-update-20200101-010101.md');
  const newReport = path.join(reportDir, 'toolkit-update-20990101-010101.md');
  const unrelated = path.join(reportDir, 'user-note.md');
  writeFile(oldReport, '# old\n');
  writeFile(newReport, '# new\n');
  writeFile(unrelated, '# user\n');
  const oldDate = new Date('2020-01-01T00:00:00Z');
  const newDate = new Date('2099-01-01T00:00:00Z');
  fs.utimesSync(oldReport, oldDate, oldDate);
  fs.utimesSync(newReport, newDate, newDate);

  const result = cleanupUpdateReports({
    reportDir,
    expectedDir: reportDir,
    retentionDays: 7,
    nowMs: new Date('2020-01-20T00:00:00Z').getTime()
  });

  assert.equal(result.deleted_count, 1);
  assert.equal(result.error_count, 0);
  assert.equal(fs.existsSync(oldReport), false);
  assert.equal(fs.existsSync(newReport), true);
  assert.equal(fs.existsSync(unrelated), true);
});

test('update report cleanup refuses paths outside the Toolkit-managed report root', () => {
  const root = tmpRoot();
  const expectedDir = path.join(root, 'reports');
  const outsideDir = path.join(root, 'outside');
  fs.mkdirSync(outsideDir, { recursive: true });
  const outsideReport = path.join(outsideDir, 'toolkit-update-20200101-010101.md');
  writeFile(outsideReport, '# outside\n');

  const result = cleanupUpdateReports({
    reportDir: outsideDir,
    expectedDir,
    retentionDays: 7,
    nowMs: new Date('2020-01-20T00:00:00Z').getTime()
  });

  assert.equal(result.deleted_count, 0);
  assert.equal(result.error_count, 1);
  assert.match(result.errors.join('\n'), /refusing cleanup outside Toolkit report directory/);
  assert.equal(fs.existsSync(outsideReport), true);
});

test('native plugin manifests and hooks are valid and policy-light', () => {
  const codexManifest = readJson(path.join(repoRoot, '.codex-plugin', 'plugin.json'));
  const claudeManifest = readJson(path.join(repoRoot, '.claude-plugin', 'plugin.json'));
  const codexHooks = readJson(path.join(repoRoot, '.codex-plugin', 'hooks', 'hooks.json'));
  const claudeHooks = readJson(path.join(repoRoot, '.claude-plugin', 'hooks', 'hooks.json'));

  for (const manifest of [codexManifest, claudeManifest]) {
    assert.equal(manifest.name, 'ai-agent-toolkit');
    assert.equal(manifest.skills, './skills');
    assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  }
  assert.equal(codexManifest.hooks, './.codex-plugin/hooks/hooks.json');
  assert.equal(claudeManifest.hooks, './.claude-plugin/hooks/hooks.json');

  const codexCommand = codexHooks.hooks.SessionStart[0].hooks[0].command;
  const claudeCommand = claudeHooks.hooks.SessionStart[0].hooks[0].command;
  assert.match(codexCommand, /^node\s+"/);
  assert.match(codexCommand, /toolkit-local-bridge\.cjs/);
  assert.match(codexCommand, /\$\{PLUGIN_ROOT\}\/repo\/scripts\/toolkit-local-bridge\.cjs/);
  assert.doesNotMatch(codexCommand, /CODEX_PLUGIN_ROOT|CODEX_PLUGIN_DATA|CLAUDE_PLUGIN_ROOT|CLAUDE_PLUGIN_DATA/);
  assert.match(codexCommand, /--sync-enabled/);
  assert.match(codexCommand, /--sync-source codex-plugin/);
  assert.ok(
    codexManifest.interface.defaultPrompt.some((prompt) => /setup toolkit/i.test(prompt)),
    'Codex plugin should expose the English setup toolkit journey'
  );
  assert.equal(codexManifest.interface.composerIcon, './.codex-plugin/assets/composer-icon.png');
  assert.equal(codexManifest.interface.logo, './.codex-plugin/assets/logo.png');
  assert.deepEqual(
    readPngSize(path.join(repoRoot, '.codex-plugin', 'assets', 'composer-icon.png')),
    { width: 128, height: 128 }
  );
  assert.deepEqual(
    readPngSize(path.join(repoRoot, '.codex-plugin', 'assets', 'logo.png')),
    { width: 512, height: 512 }
  );
  assert.match(claudeCommand, /^node\s+"/);
  assert.match(claudeCommand, /toolkit-local-bridge\.cjs/);
  assert.match(claudeCommand, /\$\{CLAUDE_PLUGIN_ROOT\}\/repo\/scripts\/toolkit-local-bridge\.cjs/);
  assert.doesNotMatch(claudeCommand, /CODEX_PLUGIN_ROOT|CODEX_PLUGIN_DATA/);
  assert.match(claudeCommand, /--sync-enabled/);
  assert.match(claudeCommand, /--sync-source claude-plugin/);
  assert.deepEqual(Object.keys(codexHooks.hooks).sort(), ['SessionStart']);
  assert.deepEqual(Object.keys(claudeHooks.hooks).sort(), ['SessionStart']);
  assert.equal(codexHooks.hooks.SessionEnd, undefined);
  assert.equal(claudeHooks.hooks.SessionEnd, undefined);
  assert.equal(codexHooks.hooks.Stop, undefined);
  assert.equal(claudeHooks.hooks.Stop, undefined);
  assert.doesNotMatch(`${codexCommand}\n${claudeCommand}`, /--enable-target|--force-downgrade/);
  assert.doesNotMatch(`${codexCommand}\n${claudeCommand}`, /\.sh(?:$|[\s"'])/i);
  assert.doesNotMatch(`${codexCommand}\n${claudeCommand}`, /(?:^|\s)(?:bash|bash\.exe)(?:\s|$)|[A-Z]:\\WINDOWS\\system32\\bash\.exe/i);
  assert.doesNotMatch(`${codexCommand}\n${claudeCommand}`, /\b(?:jq|python3)\b/i);
});

test('toolkit setup skill documents the end-to-end English setup journey', () => {
  const paths = [
    'skills/toolkit-setup/SKILL.md',
    '_projects/development/toolkit-local-bridge/curated_output_for_ai/skills/toolkit-setup/SKILL.md'
  ];

  for (const relPath of paths) {
    const text = fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
    assert.match(text, /setup toolkit/i, relPath);
    assert.match(text, /node repo\/scripts\/setup-toolkit\.cjs --execute --profile auto-main/, relPath);
    assert.match(text, /node repo\/scripts\/setup-toolkit\.cjs --execute --profile auto-main --host claude-code/, relPath);
    assert.match(text, /dedicated clean `main` checkout as the single update source/, relPath);
    assert.match(text, /%USERPROFILE%\\\.ai-agent-toolkit\\source\\ai-agent-toolkit/, relPath);
    assert.match(text, /~\/\.ai-agent-toolkit\/source\/ai-agent-toolkit/, relPath);
    assert.match(text, /separate from the active Codex or Claude Code worktree, plugin caches, `\.tmp` directories, and temporary marketplace checkouts/i, relPath);
    assert.match(text, /one upfront checklist/i, relPath);
    assert.match(text, /Allowed later blockers include dirty managed checkout, unexpected remote, fetch\/auth failure, non-fast-forward update, validation failure/i, relPath);
    assert.match(text, /node repo\/scripts\/validate-toolkit\.cjs/, relPath);
    const setupValidationBlock = text.match(/For bridge or setup-surface changes, prefer targeted checks first:[\s\S]*?```powershell\r?\n([\s\S]*?)\r?\n```/i);
    assert.ok(setupValidationBlock, relPath);
    assert.match(setupValidationBlock[1], /node --test repo\/tests\/toolkit-local-bridge-hook-light\.test\.cjs/, relPath);
    assert.doesNotMatch(setupValidationBlock[1], /node --test repo\/tests\/toolkit-local-bridge\.test\.cjs/, relPath);
    assert.match(text, /Run `node --test repo\/tests\/toolkit-local-bridge\.test\.cjs` when the change affects bridge behavior/i, relPath);
    assert.match(text, /Codex native plugin/i, relPath);
    assert.match(text, /setup-codex-toolkit-plugin\.cjs/, relPath);
    assert.match(text, /\.claude-plugin\/plugin\.json/, relPath);
    assert.match(text, /repair-codex-plugin-windows-hooks\.cjs/, relPath);
    assert.match(text, /installed plugin cache/i, relPath);
    assert.match(text, /%USERPROFILE%\\\\\.codex\\\\plugins\\\\\.plugin-appserver\\\\codex\.exe/, relPath);
    assert.match(text, /fail with the repair error/i, relPath);
    assert.match(text, /Do not use Codex to update Claude Code or Claude Code to update Codex/i, relPath);
    assert.match(text, /repo-backed auto-update/i, relPath);
    assert.match(text, /OpenCode and Antigravity 2/i, relPath);
    assert.match(text, /one setup checklist collects all preferences up front/i, relPath);
    assert.match(text, /Enable OpenCode target sync only when explicitly selected/i, relPath);
    assert.match(text, /Enable AG2\/Antigravity target sync only when explicitly selected/i, relPath);
    assert.match(text, /OpenCode and Antigravity 2 are opt-in only/i, relPath);
    assert.match(text, /Sync only enabled targets/i, relPath);
    assert.match(text, /fast-forward/i, relPath);
    assert.match(text, /Toolkit-managed update reports\/logs older than 7 days/i, relPath);
    assert.match(text, /official `n8n-io\/skills` plugin setup/i, relPath);
    assert.match(text, /Do not repair or audit temporary marketplace checkout paths/i, relPath);
  }
});

test('bridge docs document cache-first setup and release branch auto-update bounds', () => {
  const text = fs.readFileSync(path.join(repoRoot, 'repo', 'docs', 'TOOLKIT-LOCAL-BRIDGE.md'), 'utf8');
  assert.match(text, /managed clean `main` checkout as the default source/i);
  assert.match(text, /dedicated clean `main` checkout as the single update source/i);
  assert.match(text, /creates or verifies that checkout, validates the expected remote, refuses dirty worktrees, fetches `origin main`, updates only by fast-forward, runs hook-light validation/i);
  assert.match(text, /Codex agents verify and refresh only the Codex native Toolkit plugin cache/i);
  assert.match(text, /Claude Code verifies `\.claude-plugin\/plugin\.json` and `\.claude-plugin\/hooks\/hooks\.json`/i);
  assert.match(text, /Routine setup uses `repo\/tests\/toolkit-local-bridge-hook-light\.test\.cjs`/);
  assert.match(text, /Release-branch auto-update consideration/i);
  assert.match(text, /configure `--repo-branch release` only after that branch exists and has a clear CI\/merge policy/i);
  assert.match(text, /pull-on-session-start/i);
  assert.match(text, /does not run a GitHub webhook listener or background push daemon/i);
});

test('Toolkit exposes a local Codex marketplace wrapper for supported plugin install', () => {
  const marketplace = readJson(path.join(repoRoot, '.agents', 'plugins', 'marketplace.json'));
  assert.equal(marketplace.name, 'ai-agent-toolkit-local');
  assert.equal(marketplace.interface.displayName, 'AI Agent Toolkit local');
  assert.equal(Array.isArray(marketplace.plugins), true);
  assert.equal(marketplace.plugins.length, 1);
  assert.deepEqual(marketplace.plugins[0], {
    name: 'ai-agent-toolkit',
    source: {
      source: 'local',
      path: '.'
    },
    policy: {
      installation: 'AVAILABLE',
      authentication: 'ON_USE'
    },
    category: 'Developer Tools'
  });
});

test('bridge surfaces avoid private plugin caches, package installs, and command-per-bridge skills', () => {
  const privateCacheFreeFiles = [
    '.codex-plugin/plugin.json',
    '.codex-plugin/hooks/hooks.json',
    '.claude-plugin/plugin.json',
    '.claude-plugin/hooks/hooks.json'
  ];
  const privateCacheFreeText = privateCacheFreeFiles.map((rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8')).join('\n');
  assert.doesNotMatch(privateCacheFreeText, /\.codex[\\/]+plugins[\\/]+cache|\.claude[\\/]+plugins/i);

  const files = [
    'repo/scripts/toolkit-local-bridge.cjs',
    'skills/toolkit-setup/SKILL.md',
    'repo/docs/TOOLKIT-LOCAL-BRIDGE.md',
    '.codex-plugin/plugin.json',
    '.codex-plugin/hooks/hooks.json',
    '.claude-plugin/plugin.json',
    '.claude-plugin/hooks/hooks.json'
  ];
  const text = files.map((rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8')).join('\n');
  assert.match(text, /must not use Codex or Claude private plugin caches as the skill payload source/i);
  assert.doesNotMatch(text, /\b(?:npm|pnpm|yarn|pip)\s+install\b/i);

  const removedBridgeSkills = [
    'setup-local-toolkit-bridge',
    'setup-opencode-bridge',
    'setup-ag2-bridge',
    'setup-all-non-native-bridges',
    'sync-enabled-bridges',
    'audit-local-toolkit-bridge',
    'disable-local-toolkit-bridge'
  ];
  const skillNames = fs.readdirSync(path.join(repoRoot, 'skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  assert.deepEqual([...new Set(skillNames)].sort(), skillNames.sort());
  assert.equal(skillNames.includes('ai-agent-toolkit'), false, 'OpenCode adapter skill name must not duplicate a root Toolkit skill');
  assert.equal(skillNames.includes('toolkit-setup'), true, 'one compact Toolkit setup discoverability skill should be published');
  for (const skill of removedBridgeSkills) {
    assert.equal(skillNames.includes(skill), false, `${skill} should be setup infrastructure, not a published skill`);
    assert.equal(
      fs.existsSync(path.join(repoRoot, '_projects', 'development', 'toolkit-local-bridge', 'curated_output_for_ai', 'skills', skill)),
      false,
      `${skill} should not have curated bridge skill source`
    );
  }

  const bridgeSkillNames = skillNames.filter((skill) => {
    const skillPath = path.join(repoRoot, 'skills', skill, 'SKILL.md');
    if (!fs.existsSync(skillPath)) return false;
    const skillText = fs.readFileSync(skillPath, 'utf8');
    return /toolkit-local-bridge\.cjs|Toolkit Local Bridge|OpenCode bridge support|Antigravity 2 adapter support|stale bridge state/i.test(skillText);
  });
  assert.deepEqual(bridgeSkillNames, ['toolkit-setup'], 'exactly one Toolkit setup/bridge discoverability skill should exist');

  const curatedSkillsDir = path.join(repoRoot, '_projects', 'development', 'toolkit-local-bridge', 'curated_output_for_ai', 'skills');
  const curatedSkillNames = fs.readdirSync(curatedSkillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const curatedBridgeSkillNames = curatedSkillNames.filter((skill) => {
    const skillPath = path.join(curatedSkillsDir, skill, 'SKILL.md');
    if (!fs.existsSync(skillPath)) return false;
    const skillText = fs.readFileSync(skillPath, 'utf8');
    return /toolkit-local-bridge\.cjs|Toolkit Local Bridge|OpenCode bridge support|Antigravity 2 adapter support|stale bridge state/i.test(skillText);
  });
  assert.deepEqual(curatedBridgeSkillNames, ['toolkit-setup'], 'curated output should contain exactly one Toolkit setup/bridge discoverability skill');
  for (const rel of [
    'skills/toolkit-setup/README.md',
    'skills/toolkit-setup/SKILL.md',
    'skills/toolkit-setup/agents/openai.yaml'
  ]) {
    assert.equal(fs.existsSync(path.join(repoRoot, rel)), true, `${rel} should be generated`);
  }
  assert.match(fs.readFileSync(path.join(repoRoot, 'skills', 'toolkit-setup', 'SKILL.md'), 'utf8'), /Generated from toolkit curated output for AI/);

  const manifest = readJson(path.join(repoRoot, '_projects', 'development', 'toolkit-local-bridge', 'toolkit.project.json'));
  assert.equal(manifest.surface.publish_as, 'skill');
  assert.equal(manifest.surface.skill.status, 'published');
  assert.equal(manifest.surface.skill.path, 'skills/toolkit-setup');
  assert.deepEqual(
    (manifest.outputs || [])
      .map((output) => String(output.output || ''))
      .filter((output) => output.startsWith('skills/'))
      .sort(),
    [
      'skills/toolkit-setup/README.md',
      'skills/toolkit-setup/SKILL.md',
      'skills/toolkit-setup/agents/openai.yaml'
    ].sort()
  );
  assert.deepEqual(
    (manifest.outputs || [])
      .map((output) => String(output.output || ''))
      .filter((output) => output.startsWith('.codex-plugin/'))
      .sort(),
    [
      '.codex-plugin/assets/composer-icon.png',
      '.codex-plugin/assets/logo.png',
      '.codex-plugin/hooks/hooks.json',
      '.codex-plugin/plugin.json'
    ].sort()
  );
  assert.deepEqual(
    (manifest.writes.allowed || [])
      .filter((output) => String(output || '').startsWith('skills/'))
      .sort(),
    [
      'skills/toolkit-setup/README.md',
      'skills/toolkit-setup/SKILL.md',
      'skills/toolkit-setup/agents/openai.yaml'
    ].sort()
  );
  assert.deepEqual(
    (manifest.writes.allowed || [])
      .filter((output) => String(output || '').startsWith('.codex-plugin/'))
      .sort(),
    [
      '.codex-plugin/assets/composer-icon.png',
      '.codex-plugin/assets/logo.png',
      '.codex-plugin/hooks/hooks.json',
      '.codex-plugin/plugin.json'
    ].sort()
  );
});

test('Windows n8n plugin hook repair removes bare shell hooks and verifies hook JSON output', {
  skip: process.platform !== 'win32' ? 'Windows PowerShell/Git Bash hook verification is Windows-only' : false
}, () => {
  const root = tmpRoot();
  const pluginRoot = path.join(root, 'n8n-skills-plugin');
  writeN8nPluginHookFixture(pluginRoot);

  assert.ok(
    auditPluginRoot(pluginRoot, { windows: true }).some((error) => /directly invokes|bare bash/i.test(error)),
    'fixture should start with Windows-unsafe shell hooks'
  );

  const repair = repairPluginRoot(pluginRoot, {
    windows: true,
    write: true,
    n8n: true
  });
  assert.ok(repair.repaired, 'repair should update the fixture');

  const hooksJson = readJson(path.join(pluginRoot, 'hooks', 'hooks.json'));
  for (const entry of collectHookCommands(hooksJson)) {
    assert.match(entry.command, /^powershell(?:\.exe)?\s/i, entry.command);
    assert.match(entry.command, /hooks\/run-hook\.ps1/, entry.command);
    assert.doesNotMatch(entry.command, /^(?:\.\/)?hooks\/.+\.sh(?:$|\s)/i, entry.command);
    assert.doesNotMatch(entry.command, /^(?:bash|bash\.exe)(?:\s|$)/i, entry.command);
  }

  const errors = auditPluginRoot(pluginRoot, { windows: true, verifyOutput: true });
  assert.deepEqual(errors, []);
});
