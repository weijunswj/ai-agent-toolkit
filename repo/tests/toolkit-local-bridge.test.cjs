'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { repairPluginRoot } = require('../scripts/repair-codex-plugin-windows-hooks.cjs');
const { auditPluginRoot, collectHookCommands } = require('../scripts/audit-n8n-skills-plugin-hooks.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');
const script = path.join(repoRoot, 'repo', 'scripts', 'toolkit-local-bridge.cjs');
const expectedBridgeVersion = '2.2.0';

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-bridge-'));
}

function run(args, options = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}) },
    timeout: 15000
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
}, () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  const pythonExe = path.join(root, '.local', 'bin', 'python3.14.exe');
  const logPath = path.join(root, 'python3.14.log');
  writeFakePythonExecutable(pythonExe, logPath);

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
  writeFile(path.join(fixture.repo, 'DIRTY.txt'), 'dirty\n');

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
  assert.match(state.last_repo_update_error, /dirty/i);
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
    '--skip-repo-auto-update'
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
    assert.match(text, /git fetch origin main/, relPath);
    assert.match(text, /git merge --ff-only origin\/main/, relPath);
    assert.match(text, /node repo\/scripts\/validate-toolkit\.cjs/, relPath);
    assert.match(text, /node --test repo\/tests\/toolkit-local-bridge\.test\.cjs/, relPath);
    assert.match(text, /Codex native plugin/i, relPath);
    assert.match(text, /\.codex-plugin\/plugin\.json/, relPath);
    assert.match(text, /setup-codex-toolkit-plugin\.cjs --verify/, relPath);
    assert.match(text, /setup-codex-toolkit-plugin\.cjs --write/, relPath);
    assert.match(text, /codex plugin marketplace add/, relPath);
    assert.match(text, /codex plugin add ai-agent-toolkit@ai-agent-toolkit-local/, relPath);
    assert.match(text, /\.agents\/plugins\/marketplace\.json/, relPath);
    assert.match(text, /installed plugin cache/i, relPath);
    assert.match(text, /2\.2\.0/, relPath);
    assert.match(text, /fail clearly/i, relPath);
    assert.match(text, /do not use Codex to install or update Claude Code/i, relPath);
    assert.match(text, /--enable-repo-auto-update/, relPath);
    assert.match(text, /--repo-path/, relPath);
    assert.match(text, /--enable-auto-sync/, relPath);
    assert.match(text, /OpenCode and Antigravity 2/i, relPath);
    assert.match(text, /ask once/i, relPath);
    assert.match(text, /Never silently enable OpenCode or Antigravity 2/i, relPath);
    assert.match(text, /--enable-target opencode/, relPath);
    assert.match(text, /--enable-target ag2/, relPath);
    assert.match(text, /--sync-enabled --write/, relPath);
    assert.match(text, /SessionStart/i, relPath);
    assert.match(text, /fast-forward/i, relPath);
  }
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
  const files = [
    'repo/scripts/toolkit-local-bridge.cjs',
    'skills/toolkit-setup/SKILL.md',
    '.codex-plugin/plugin.json',
    '.codex-plugin/hooks/hooks.json',
    '.claude-plugin/plugin.json',
    '.claude-plugin/hooks/hooks.json'
  ];
  const text = files.map((rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8')).join('\n');
  assert.doesNotMatch(text, /\.codex[\\/]+plugins[\\/]+cache|\.claude[\\/]+plugins/i);
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
