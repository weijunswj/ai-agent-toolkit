'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const test = require('node:test');
const {
  run: runBridge,
  runRepoValidation,
  getRepoValidationLabels,
  openUpdateReport,
  updateReportDir,
  cleanupUpdateReports,
  sanitizeOutputMessage,
  replaceDirectoryAtomically,
  runAgentRulesPreflight,
  formatAgentRulesPreflight,
  discoverCodexPluginHookRoots,
  repairThirdPartyCodexPluginHooks,
  recoverInterruptedN8nReplacement,
  reconcileSelectedN8nSkillsCache,
  n8nSkillsTargetLockIdentity,
  adapterPayloads,
  payloadChecksum,
  updateReportSignature,
  classifyUpdateReport,
  maybeWriteUpdateReport
} = require('../scripts/toolkit-local-bridge.cjs');
const {
  CACHE_FINGERPRINT_PATHS,
  prepareInstalledSessionStart,
  sourceSessionStartCommand,
  windowsSessionStartCommand,
  verifyInstalledCacheFreshness
} = require('../scripts/setup-codex-toolkit-plugin.cjs');
const {
  N8N_SKILLS_COMPATIBILITY,
  N8N_SKILLS_COMPATIBILITY_ADAPTERS,
  N8N_SKILLS_TREE_LIMITS,
  inspectN8nSkillsTree,
  repairPluginRoot
} = require('../scripts/repair-codex-plugin-windows-hooks.cjs');
const { auditPluginRoot, collectHookCommands } = require('../scripts/audit-n8n-skills-plugin-hooks.cjs');
const {
  RECORD_PREFIX,
  createOwnedStagingGeneration
} = require('../scripts/toolkit-staging-generations.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');
const script = path.join(repoRoot, 'repo', 'scripts', 'toolkit-local-bridge.cjs');
const expectedBridgeVersion = '2.9.2';
const supportedN8nFixtureRoot = path.join(repoRoot, 'repo', 'tests', 'fixtures', 'n8n-skills-1.0.1');
const currentN8nManifestPath = path.join(
  repoRoot,
  '_projects',
  'n8n',
  'skills-plugin-compatibility',
  '_main',
  'plugins',
  'n8n-skills',
  '.codex-plugin',
  'plugin.json'
);

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
    cwd: options.cwd || repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}) },
    timeout: options.timeout || 300000
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
    timeout: 60000
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

function snapshotTree(root) {
  const entries = [];
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const fullPath = path.join(current, entry.name);
      const relativePath = path.relative(root, fullPath).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        entries.push('dir:' + relativePath);
        visit(fullPath);
      } else if (entry.isFile()) {
        entries.push('file:' + relativePath + ':' + fs.readFileSync(fullPath, 'utf8'));
      } else {
        entries.push('other:' + relativePath);
      }
    }
  }
  visit(root);
  return entries;
}

function ownedStagingArtifacts(parent) {
  if (!fs.existsSync(parent)) return [];
  return fs.readdirSync(parent).filter((name) => name.startsWith(RECORD_PREFIX) || name.startsWith('.staging-') || /^\..+\.staging-/.test(name));
}

function n8nTransactionArtifacts(pluginRoot) {
  const parent = path.dirname(pluginRoot);
  if (!fs.existsSync(parent)) return [];
  const lockName = n8nSkillsTargetLockIdentity(pluginRoot).lockName;
  return fs.readdirSync(parent).filter((name) => (
    name.startsWith(`.${path.basename(pluginRoot)}.staging-`)
    || name.startsWith(`.${path.basename(pluginRoot)}.backup-`)
    || name.startsWith(`.${path.basename(pluginRoot)}.n8n-repair-backup-`)
    || name === lockName
    || name.startsWith(`${lockName}.`)
    || name.startsWith(RECORD_PREFIX)
  ));
}

function waitForChild(child, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`child process timed out: ${stderr || stdout}`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`child exited ${code}: ${stderr || stdout}`));
      else resolve({ stdout, stderr });
    });
  });
}

function waitForAbruptChild(child, expectedCode = 73, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`child process timed out: ${stderr || stdout}`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== expectedCode) reject(new Error(`child exited ${code}: ${stderr || stdout}`));
      else resolve({ stdout, stderr });
    });
  });
}

function writeDisabledHookHub(hub) {
  writeJson(path.join(hub, 'state.json'), {
    schema_version: 1,
    architecture_version: 2,
    hub_version: expectedBridgeVersion,
    auto_sync_enabled: false,
    targets: {}
  });
}

function createActiveNoTargetFixture(initialSource = 'codex-plugin') {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  const sourceRepo = createMinimalToolkitSource(root, { alpha: 'alpha no-target fixture\n' });
  for (const relPath of CACHE_FINGERPRINT_PATHS) {
    const sourcePath = path.join(repoRoot, ...relPath.split('/'));
    const fixturePath = path.join(sourceRepo, ...relPath.split('/'));
    fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
    fs.copyFileSync(sourcePath, fixturePath);
  }
  fs.cpSync(
    path.join(repoRoot, '.codex-plugin', 'assets'),
    path.join(sourceRepo, '.codex-plugin', 'assets'),
    { recursive: true }
  );
  fs.cpSync(
    path.join(repoRoot, 'skills', 'ai-coding-agent-rules'),
    path.join(sourceRepo, 'skills', 'ai-coding-agent-rules'),
    { recursive: true }
  );
  const pluginRoot = path.join(root, 'codex-cache', 'ai-agent-toolkit');
  fs.cpSync(sourceRepo, pluginRoot, {
    recursive: true,
    filter: (source) => !source.split(path.sep).includes('.git'),
  });
  if (process.platform === 'win32') prepareInstalledSessionStart(pluginRoot);
  const temp = path.join(root, 'temp');
  fs.mkdirSync(temp, { recursive: true });
  const env = isolatedHomeEnv(root, { TEMP: temp, TMP: temp });
  const setup = run([
    '--hub', hub,
    '--write',
    '--enable-auto-sync',
    '--enable-target', 'ag2',
    '--repo-path', sourceRepo,
    '--sync-source', initialSource
  ], { env });
  assert.equal(setup.status, 0, setup.stderr);
  return { root, hub, sourceRepo, pluginRoot, temp, env };
}

function runFixtureBridge(fixture, args) {
  const originalPluginRoot = process.env.PLUGIN_ROOT;
  if (args.includes('codex-plugin')) process.env.PLUGIN_ROOT = fixture.pluginRoot;
  try {
    return runBridge(args);
  } finally {
    if (originalPluginRoot === undefined) delete process.env.PLUGIN_ROOT;
    else process.env.PLUGIN_ROOT = originalPluginRoot;
  }
}

function expectedMissingAgentsContext(root) {
  return [
    "STOP: Root AGENTS.md is missing. Toolkit repo-local ai-coding-agent-rules are not installed in this Git repository. Stop before repository work. Ask the user whether to install/repair Toolkit repo-local rules now or proceed without Toolkit repo-local rules. Do not install, repair, create, or write anything without the user's decision.",
    'Toolkit agent-rules preflight: repo-local instructions need attention in the current repository.',
    '- AGENTS.md: required instruction file is missing',
    'No files were changed by this hook.'
  ].join('\n');
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
  git(repoPath, ['config', 'core.autocrlf', 'false']);
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
  for (const name of [
    'codex-delegation-backup.cjs',
    'codex-delegation-common.cjs',
    'codex-delegation-config.cjs',
    'codex-delegation-layout.cjs',
    'codex-delegation-state.cjs',
    'setup-toolkit-core.cjs',
    'repo-ignore-hygiene.cjs',
    'repo-local-backup.cjs',
    'toolkit-agent-control.cjs',
    'claude-process-launch.cjs',
    'toolkit-staging-generations.cjs'
  ]) {
    writeFile(path.join(repoPath, 'repo', 'scripts', name), "'use strict';\n");
  }
}

function writeCodexPluginRefreshFixture(repoPath) {
  writeFile(path.join(repoPath, '.codex-plugin', 'plugin.json'), JSON.stringify({
    name: 'ai-agent-toolkit',
    version: expectedBridgeVersion,
    hooks: './.codex-plugin/hooks/hooks.json'
  }, null, 2));
  writeFile(path.join(repoPath, '.codex-plugin', 'assets', 'fixture.txt'), 'fixture asset\n');
  writeFile(path.join(repoPath, '.codex-plugin', 'hooks', 'hooks.json'), `${JSON.stringify({
    hooks: {
      SessionStart: [
        {
          matcher: 'startup|resume|clear|compact',
          hooks: [
            {
              type: 'command',
              command: sourceSessionStartCommand()
            }
          ]
        }
      ]
    }
  }, null, 2)}\n`);
  for (const relPath of [
    '_projects/n8n/skills-plugin-compatibility/_main/compatibility-contract.json',
    '_projects/n8n/skills-plugin-compatibility/SOURCE-LOCK.json',
    'repo/scripts/audit-n8n-skills-plugin-hooks.cjs',
    'repo/scripts/repair-codex-plugin-windows-hooks.cjs',
    'repo/scripts/toolkit-codex-session-start.cjs',
    'repo/scripts/toolkit-codex-session-start.ps1',
  ]) {
    const target = path.join(repoPath, ...relPath.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(repoRoot, ...relPath.split('/')), target);
  }
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
    "if (process.platform === 'win32') {",
    "  const hooksPath = path.join(target, '.codex-plugin', 'hooks', 'hooks.json');",
    "  const hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));",
    `  hooks.hooks.SessionStart[0].hooks[0].command = ${JSON.stringify(windowsSessionStartCommand())};`,
    "  fs.writeFileSync(hooksPath, JSON.stringify(hooks, null, 2) + '\\n');",
    "  const runtimePath = path.join(target, '.codex-plugin', 'session-start-runtime.json');",
    "  fs.writeFileSync(runtimePath, JSON.stringify({ schema: 1, node_path: process.execPath }, null, 2) + '\\n');",
    "}",
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

function writeGenericPluginHookFixture(pluginRoot, command = 'hooks/session-start.sh') {
  writeJson(path.join(pluginRoot, 'plugin.json'), {
    name: 'generic-third-party',
    version: '0.0.0-test',
    repository: 'https://example.invalid/generic-third-party'
  });
  writeJson(path.join(pluginRoot, 'hooks', 'hooks.json'), {
    hooks: {
      SessionStart: [
        {
          matcher: 'startup',
          hooks: [
            {
              type: 'command',
              command
            }
          ]
        }
      ]
    }
  });
  writeFile(path.join(pluginRoot, 'hooks', 'session-start.sh'), [
    '#!/usr/bin/env bash',
    'echo "generic hook"',
    ''
  ].join('\n'));
}

function copySupportedN8nPluginFixture(pluginRoot) {
  fs.rmSync(pluginRoot, { recursive: true, force: true });
  fs.mkdirSync(pluginRoot, { recursive: true });
  fs.cpSync(supportedN8nFixtureRoot, pluginRoot, { recursive: true, force: true });
}

function copyCurrentSupportedN8nPluginFixture(pluginRoot) {
  copySupportedN8nPluginFixture(pluginRoot);
  fs.copyFileSync(currentN8nManifestPath, path.join(pluginRoot, '.codex-plugin', 'plugin.json'));
}

function copySupportedN8nCrlfPluginFixture(pluginRoot) {
  copySupportedN8nPluginFixture(pluginRoot);
  let converted = 0;
  for (const relPath of N8N_SKILLS_COMPATIBILITY.text_eol_paths) {
    const filePath = path.join(pluginRoot, ...relPath.split('/'));
    if (!fs.existsSync(filePath)) continue;
    const bytes = fs.readFileSync(filePath);
    const output = [];
    for (let index = 0; index < bytes.length; index += 1) {
      if (bytes[index] === 0x0a && (index === 0 || bytes[index - 1] !== 0x0d)) output.push(0x0d);
      output.push(bytes[index]);
    }
    fs.writeFileSync(filePath, Buffer.from(output));
    converted += 1;
  }
  assert.equal(converted, 12);
}

function n8nInstalledEntry(version = '1.0.1', overrides = {}) {
  return {
    pluginId: 'n8n-skills@n8n-io',
    name: 'n8n-skills',
    marketplaceName: 'n8n-io',
    version,
    installed: true,
    enabled: true,
    ...overrides
  };
}

function spawnAbruptN8nRepair(pluginRoot, version, hookName) {
  const childSource = [
    `const bridge = require(${JSON.stringify(path.join(repoRoot, 'repo', 'scripts', 'toolkit-local-bridge.cjs'))});`,
    'const pluginRoot = process.argv[1];',
    'const version = process.argv[2];',
    'const hookName = process.argv[3];',
    'const hooks = {};',
    'hooks[hookName] = () => process.exit(73);',
    'bridge.reconcileSelectedN8nSkillsCache({',
    "  plugin_id: 'n8n-skills@n8n-io', version, selected_version: version, directory_version: version, plugin_root: pluginRoot",
    '}, { write: true, testHooks: hooks });',
    'process.exit(74);'
  ].join('\n');
  return spawn(process.execPath, ['-e', childSource, pluginRoot, version, hookName], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function readSingleN8nOwnedGeneration(pluginRoot) {
  const parent = path.dirname(pluginRoot);
  const names = fs.readdirSync(parent)
    .filter((name) => new RegExp(`^${RECORD_PREFIX}[0-9a-f-]{36}\\.json$`, 'i').test(name));
  assert.equal(names.length, 1, 'fixture must contain exactly one owned transaction generation');
  const recordPath = path.join(parent, names[0]);
  return {
    recordPath,
    record: readJson(recordPath)
  };
}

function codexPluginList(entries = []) {
  return { installed: entries, available: [] };
}

function writeFakeCodexPluginList(root, pluginList) {
  const statePath = path.join(root, 'fake-codex-plugin-list.json');
  const commandPath = path.join(root, 'fake-codex-plugin-list.cjs');
  writeJson(statePath, pluginList);
  writeFile(commandPath, [
    "'use strict';",
    "const fs = require('node:fs');",
    `const statePath = ${JSON.stringify(statePath)};`,
    'const args = process.argv.slice(2);',
    "if (args.join(' ') === 'plugin --help') {",
    "  process.stdout.write('Manage Codex plugins\\n');",
    '  process.exit(0);',
    '}',
    "if (args.join(' ') === 'plugin list --json --available') {",
    "  process.stdout.write(fs.readFileSync(statePath, 'utf8'));",
    '  process.exit(0);',
    '}',
    "process.stderr.write(`unexpected fake Codex arguments: ${args.join(' ')}\\n`);",
    'process.exit(2);',
    ''
  ].join('\n'));
  return { commandPath, statePath };
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

function reportPathFromOutput(stdout, hub) {
  assert.match(String(stdout || ''), /^Toolkit local bridge sync complete\.$/m);
  const reportPath = readJson(path.join(hub, 'state.json')).last_update_report_path;
  assert.ok(reportPath, stdout);
  return reportPath;
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

test('cross-source versions do not block native hosts or repo target sync', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  writeJson(path.join(hub, 'state.json'), {
    schema_version: 1,
    architecture_version: 2,
    hub_version: '9.9.9',
    bridge_versions_by_source: {
      repo: '9.9.9',
      'codex-plugin': '9.8.0'
    },
    auto_sync_enabled: true,
    targets: {}
  });

  let result = run(['--hub', hub, '--write', '--enable-target', 'ag2', '--sync-source', 'claude-plugin'], {
    env: isolatedHomeEnv(root)
  });
  assert.equal(result.status, 0, result.stderr);
  let state = readJson(path.join(hub, 'state.json'));
  assert.deepEqual(state.bridge_versions_by_source, {
    repo: '9.9.9',
    'codex-plugin': '9.8.0',
    'claude-plugin': expectedBridgeVersion
  });
  assert.equal(state.targets.ag2.synced_version, expectedBridgeVersion);
  assert.equal(state.hub_version, '9.9.9');

  state.bridge_versions_by_source['claude-plugin'] = '9.7.0';
  delete state.bridge_versions_by_source['codex-plugin'];
  writeJson(path.join(hub, 'state.json'), state);
  result = run(['--hub', hub, '--write', '--enable-auto-sync', '--sync-source', 'codex-plugin'], {
    env: isolatedHomeEnv(root)
  });
  assert.equal(result.status, 0, result.stderr);
  state = readJson(path.join(hub, 'state.json'));
  assert.equal(state.bridge_versions_by_source['claude-plugin'], '9.7.0');
  assert.equal(state.bridge_versions_by_source['codex-plugin'], expectedBridgeVersion);
  assert.equal(state.hub_version, '9.9.9');
});

test('same-source downgrade refuses unless forced and forced write changes only that source', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  writeJson(path.join(hub, 'state.json'), {
    schema_version: 1,
    architecture_version: 2,
    hub_version: '9.9.9',
    bridge_versions_by_source: {
      repo: '9.8.0',
      'codex-plugin': '9.9.9',
      'claude-plugin': '8.8.8'
    },
    auto_sync_enabled: false,
    forward_compatible_setting: { keep: true },
    targets: {}
  });

  let result = run(['--hub', hub, '--write', '--enable-target', 'ag2', '--sync-source', 'codex-plugin'], {
    env: isolatedHomeEnv(root)
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Refusing downgrade for sync source codex-plugin/);
  assert.match(result.stderr, /running bridge .* recorded codex-plugin bridge 9\.9\.9/);
  assert.match(result.stderr, /setup toolkit.*Codex/i);
  assert.match(result.stderr, /--force-downgrade.*explicit manual same-source recovery/);

  result = run(['--hub', hub, '--write', '--force-downgrade', '--enable-target', 'ag2', '--sync-source', 'codex-plugin'], {
    env: isolatedHomeEnv(root)
  });
  assert.equal(result.status, 0, result.stderr);
  const state = readJson(path.join(hub, 'state.json'));
  assert.equal(state.bridge_versions_by_source.repo, '9.8.0');
  assert.equal(state.bridge_versions_by_source['codex-plugin'], expectedBridgeVersion);
  assert.equal(state.bridge_versions_by_source['claude-plugin'], '8.8.8');
  assert.equal(state.hub_version, '9.9.9');
  assert.deepEqual(state.forward_compatible_setting, { keep: true });

  result = run(['--hub', hub, '--write', '--force-downgrade', '--enable-target', 'unsupported'], {
    env: isolatedHomeEnv(root)
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unsupported target/);
});

test('hook mode downgrade skip exits 0 and prints host remediation on stdout', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  writeJson(path.join(hub, 'state.json'), {
    schema_version: 1,
    architecture_version: 2,
    hub_version: '9.9.9',
    bridge_versions_by_source: { 'claude-plugin': '9.9.9' },
    auto_sync_enabled: true,
    targets: {}
  });

  const result = run(
    ['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'claude-plugin'],
    { env: isolatedHomeEnv(root) }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Toolkit local bridge hook skipped: Refusing downgrade/);
  assert.match(result.stdout, /setup toolkit --host claude-code/);
  assert.match(result.stdout, /or `setup toolkit` from Claude Code/);
  assert.match(result.stdout, /restart Claude Code/);
  assert.match(result.stdout, /claude plugin update ai-agent-toolkit@ai-agent-toolkit-local --scope user/);
  assert.match(result.stdout, /reinstall through the supported Claude Code marketplace path/);
  assert.doesNotMatch(result.stdout, /--force-downgrade/);
});

test('Claude checker SessionStart exits successfully before all optional maintenance and mutation', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  const repoPath = path.join(root, 'managed-source');
  const openCodeTarget = path.join(root, 'opencode-target');
  const pluginRoot = path.join(root, 'installed-plugin');
  fs.mkdirSync(repoPath, { recursive: true });
  fs.mkdirSync(openCodeTarget, { recursive: true });
  fs.mkdirSync(pluginRoot, { recursive: true });
  fs.writeFileSync(path.join(repoPath, 'sentinel.txt'), 'repo update must not run\n');
  fs.writeFileSync(path.join(openCodeTarget, 'sentinel.txt'), 'target sync must not run\n');
  fs.writeFileSync(path.join(pluginRoot, 'sentinel.txt'), 'hook repair and cache refresh must not run\n');
  writeJson(path.join(hub, 'state.json'), {
    schema_version: 1,
    architecture_version: 2,
    hub_version: expectedBridgeVersion,
    bridge_versions_by_source: { 'claude-plugin': expectedBridgeVersion },
    auto_sync_enabled: true,
    repo_auto_update_enabled: true,
    repo_path: repoPath,
    repo_branch: 'main',
    repo_remote: 'https://example.invalid/no-network.git',
    update_report_enabled: true,
    codex_plugin_auto_refresh_enabled: true,
    targets: { opencode: { enabled: true, path: openCodeTarget } }
  });
  const env = isolatedHomeEnv(root, {
    AI_AGENT_TOOLKIT_CHECKER: '1',
    PLUGIN_ROOT: pluginRoot,
    TOOLKIT_BRIDGE_TEST_DELEGATE_MARKER: path.join(root, 'network-or-maintenance-marker.txt')
  });
  const before = snapshotTree(root);
  const result = run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'claude-plugin'], { env });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.deepEqual(snapshotTree(root), before);
  assert.equal(fs.existsSync(env.TOOLKIT_BRIDGE_TEST_DELEGATE_MARKER), false);

  const previous = process.env.AI_AGENT_TOOLKIT_CHECKER;
  process.env.AI_AGENT_TOOLKIT_CHECKER = '1';
  try {
    assert.deepEqual(runBridge(['--hook', '--unsupported-checker-fixture']), { status: 0, audit: null, checker_session_noop: true });
  } finally {
    if (previous === undefined) delete process.env.AI_AGENT_TOOLKIT_CHECKER;
    else process.env.AI_AGENT_TOOLKIT_CHECKER = previous;
  }
});

test('Claude capability-probe SessionStart exits before parsing, maintenance, or mutation', () => {
  const root = tmpRoot();
  const sentinel = path.join(root, 'owned-state.txt');
  fs.writeFileSync(sentinel, 'unchanged\n');
  const before = snapshotTree(root);
  const previous = process.env.AI_AGENT_TOOLKIT_CAPABILITY_PROBE;
  process.env.AI_AGENT_TOOLKIT_CAPABILITY_PROBE = '1';
  try {
    assert.deepEqual(runBridge(['--hook', '--unsupported-capability-probe-fixture']), {
      status: 0, audit: null, capability_probe_noop: true,
    });
  } finally {
    if (previous === undefined) delete process.env.AI_AGENT_TOOLKIT_CAPABILITY_PROBE;
    else process.env.AI_AGENT_TOOLKIT_CAPABILITY_PROBE = previous;
  }
  assert.deepEqual(snapshotTree(root), before);
});
test('repo same-source downgrade names managed source remediation', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  writeJson(path.join(hub, 'state.json'), {
    schema_version: 1,
    hub_version: '9.9.9',
    bridge_versions_by_source: { repo: '9.9.9' },
    targets: {}
  });
  const result = run(['--hub', hub, '--write', '--enable-auto-sync', '--sync-source', 'repo'], {
    env: isolatedHomeEnv(root)
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /sync source repo/);
  assert.match(result.stderr, /managed Toolkit source checkout/);
  assert.doesNotMatch(result.stderr, /Codex plugin cache|Claude Code plugin cache/);
});

test('legacy migration seeds only an attributable recognized source', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  writeJson(path.join(hub, 'state.json'), {
    schema_version: 1,
    hub_version: '2.4.3',
    last_sync_source: 'codex-plugin',
    preserved_setting: 'keep',
    targets: {}
  });

  let result = run(['--hub', hub, '--write', '--enable-auto-sync', '--sync-source', 'claude-plugin'], {
    env: isolatedHomeEnv(root)
  });
  assert.equal(result.status, 0, result.stderr);
  let state = readJson(path.join(hub, 'state.json'));
  assert.deepEqual(state.bridge_versions_by_source, {
    'codex-plugin': '2.4.3',
    'claude-plugin': expectedBridgeVersion
  });
  assert.equal(state.bridge_versions_by_source.repo, undefined);
  assert.equal(state.preserved_setting, 'keep');

  result = run(['--hub', hub, '--write', '--enable-auto-sync', '--sync-source', 'claude-plugin'], {
    env: isolatedHomeEnv(root)
  });
  assert.equal(result.status, 0, result.stderr);
  state = readJson(path.join(hub, 'state.json'));
  assert.deepEqual(state.bridge_versions_by_source, {
    'codex-plugin': '2.4.3',
    'claude-plugin': expectedBridgeVersion
  });
});

test('attributable legacy same-source history still refuses a genuine downgrade', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  writeJson(path.join(hub, 'state.json'), {
    schema_version: 1,
    hub_version: '9.9.9',
    last_sync_source: 'claude-plugin',
    targets: {}
  });
  const result = run(['--hub', hub, '--write', '--enable-auto-sync', '--sync-source', 'claude-plugin'], {
    env: isolatedHomeEnv(root)
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /recorded claude-plugin bridge 9\.9\.9/);
});

test('unattributed legacy hub versions do not cross-block and establish the running source', () => {
  for (const lastSyncSource of [undefined, 'unknown-host']) {
    const root = tmpRoot();
    const hub = path.join(root, 'hub', 'current');
    const legacy = {
      schema_version: 1,
      hub_version: '9.9.9',
      targets: {}
    };
    if (lastSyncSource) legacy.last_sync_source = lastSyncSource;
    writeJson(path.join(hub, 'state.json'), legacy);

    const result = run(['--hub', hub, '--write', '--enable-auto-sync', '--sync-source', 'claude-plugin'], {
      env: isolatedHomeEnv(root)
    });
    assert.equal(result.status, 0, result.stderr);
    const state = readJson(path.join(hub, 'state.json'));
    assert.deepEqual(state.bridge_versions_by_source, { 'claude-plugin': expectedBridgeVersion });
    assert.equal(state.hub_version, '9.9.9');
  }
});

test('partially migrated state never attributes the reporting watermark to a missing source', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  writeJson(path.join(hub, 'state.json'), {
    schema_version: 1,
    hub_version: '9.9.9',
    last_sync_source: 'codex-plugin',
    bridge_versions_by_source: { repo: '9.9.9' },
    targets: {}
  });

  const result = run(['--hub', hub, '--write', '--enable-auto-sync', '--sync-source', 'claude-plugin'], {
    env: isolatedHomeEnv(root)
  });
  assert.equal(result.status, 0, result.stderr);
  const state = readJson(path.join(hub, 'state.json'));
  assert.deepEqual(state.bridge_versions_by_source, {
    repo: '9.9.9',
    'claude-plugin': expectedBridgeVersion
  });
  assert.equal(state.bridge_versions_by_source['codex-plugin'], undefined);
});

test('malformed and attacker-controlled version maps follow the safe normalization policy', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  writeJson(path.join(hub, 'state.json'), {
    schema_version: 1,
    hub_version: '2.4.3',
    last_sync_source: 'repo',
    bridge_versions_by_source: ['repo', '9.9.9'],
    targets: {}
  });
  let result = run(['--hub', hub, '--write', '--enable-auto-sync', '--sync-source', 'claude-plugin'], {
    env: isolatedHomeEnv(root)
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readJson(path.join(hub, 'state.json')).bridge_versions_by_source, {
    repo: '2.4.3',
    'claude-plugin': expectedBridgeVersion
  });

  fs.writeFileSync(path.join(hub, 'state.json'), `${JSON.stringify({
    schema_version: 1,
    hub_version: '9.9.9',
    bridge_versions_by_source: {
      repo: '9.9.9',
      unsupported: '99.0.0',
      constructor: '99.0.0'
    },
    targets: {}
  }, null, 2).replace('"constructor": "99.0.0"', '"__proto__": "99.0.0",\n      "constructor": "99.0.0"')}\n`, 'utf8');
  result = run(['--hub', hub, '--write', '--enable-auto-sync', '--sync-source', 'claude-plugin'], {
    env: isolatedHomeEnv(root)
  });
  assert.equal(result.status, 0, result.stderr);
  const safeMap = readJson(path.join(hub, 'state.json')).bridge_versions_by_source;
  assert.deepEqual(safeMap, { repo: '9.9.9', 'claude-plugin': expectedBridgeVersion });
  assert.equal(Object.prototype.polluted, undefined);

  writeJson(path.join(hub, 'state.json'), {
    schema_version: 1,
    bridge_versions_by_source: { 'claude-plugin': 'not-semver' },
    targets: {}
  });
  result = run(['--hub', hub, '--hook', '--write', '--sync-enabled', '--sync-source', 'claude-plugin'], {
    env: isolatedHomeEnv(root)
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /hook skipped: Invalid bridge_versions_by_source\.claude-plugin/);
});

test('audit reports source-scoped versions and reporting-only hub watermark', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  writeJson(path.join(hub, 'state.json'), {
    schema_version: 1,
    hub_version: '9.9.9',
    bridge_versions_by_source: { repo: '9.9.9', 'codex-plugin': '2.4.4' },
    targets: {}
  });
  const result = run(['--hub', hub, '--audit', '--sync-source', 'claude-plugin'], {
    env: isolatedHomeEnv(root)
  });
  assert.equal(result.status, 0, result.stderr);
  const audit = parseLastJson(result.stdout);
  assert.equal(audit.running_bridge_source, 'claude-plugin');
  assert.equal(audit.running_bridge_version, expectedBridgeVersion);
  assert.deepEqual(audit.bridge_versions_by_source, { repo: '9.9.9', 'codex-plugin': '2.4.4' });
  assert.equal(audit.hub_reporting_version, '9.9.9');
  assert.equal(audit.downgrade_enforcement_source, 'claude-plugin');
});

test('unsupported running sync sources fail closed without writing state', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  const result = run(['--hub', hub, '--write', '--enable-auto-sync', '--sync-source', 'attacker-controlled'], {
    env: isolatedHomeEnv(root)
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--sync-source must be repo, codex-plugin, or claude-plugin/);
  assert.equal(fs.existsSync(hub), false);
});

test('alternating source writes preserve all source entries and stable state', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  for (const source of ['codex-plugin', 'claude-plugin', 'repo', 'codex-plugin']) {
    const result = run(['--hub', hub, '--write', '--enable-auto-sync', '--sync-source', source], {
      env: isolatedHomeEnv(root)
    });
    assert.equal(result.status, 0, result.stderr);
  }
  const state = readJson(path.join(hub, 'state.json'));
  assert.deepEqual(state.bridge_versions_by_source, {
    repo: expectedBridgeVersion,
    'codex-plugin': expectedBridgeVersion,
    'claude-plugin': expectedBridgeVersion
  });
  assert.equal(state.hub_version, expectedBridgeVersion);
});

test('concurrent source writers retry lock contention and preserve every source entry', async () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  const worker = [
    "'use strict';",
    "const { spawnSync } = require('node:child_process');",
    'const [script, hub, source, cwd, home] = process.argv.slice(1);',
    'for (let attempt = 0; attempt < 500; attempt += 1) {',
    "  const result = spawnSync(process.execPath, [script, '--hub', hub, '--write', '--enable-auto-sync', '--sync-source', source], {",
    "    cwd, encoding: 'utf8', env: { ...process.env, PATH: '', USERPROFILE: home, HOME: home, LOCALAPPDATA: home }",
    '  });',
    '  if (result.status === 0) process.exit(0);',
    "  if (!/Toolkit bridge lock/.test(result.stderr)) { process.stderr.write(result.stderr); process.exit(result.status || 1); }",
    '  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);',
    '}',
    "process.stderr.write('lock retry limit exceeded\\n');",
    'process.exit(1);'
  ].join('\n');

  const results = await Promise.all(['repo', 'codex-plugin', 'claude-plugin'].map((source) => new Promise((resolve) => {
    const child = spawn(process.execPath, ['-e', worker, script, hub, source, repoRoot, root], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ source, status, stderr }));
  })));
  for (const result of results) assert.equal(result.status, 0, `${result.source}: ${result.stderr}`);
  assert.deepEqual(readJson(path.join(hub, 'state.json')).bridge_versions_by_source, {
    repo: expectedBridgeVersion,
    'codex-plugin': expectedBridgeVersion,
    'claude-plugin': expectedBridgeVersion
  });
});

test('writer recomputes its complete snapshot from state committed before lock acquisition', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  const sourceA = createMinimalToolkitSource(path.join(root, 'source-a'), { alpha: 'source A\n' });
  const sourceB = createMinimalToolkitSource(path.join(root, 'source-b'), { alpha: 'source B\n' });
  const sourceATarget = path.join(root, 'opencode-source-a');
  const sourceBTarget = path.join(root, 'opencode-source-b');
  const env = isolatedHomeEnv(root);
  const setup = run([
    '--hub', hub,
    '--write',
    '--enable-auto-sync',
    '--enable-target', 'opencode',
    '--opencode-target', sourceATarget,
    '--repo-path', sourceA,
    '--sync-source', 'repo'
  ], { env });
  assert.equal(setup.status, 0, setup.stderr);
  const codexWriter = run([
    '--hub', hub,
    '--sync-enabled',
    '--write',
    '--repo-path', sourceA,
    '--opencode-target', sourceATarget,
    '--sync-source', 'codex-plugin',
    '--suppress-update-report'
  ], { env });
  assert.equal(codexWriter.status, 0, codexWriter.stderr);
  const state = readJson(path.join(hub, 'state.json'));
  state.update_report_enabled = false;
  state.future_bridge_metadata = { owner: 'future-version', preserve: true };
  writeJson(path.join(hub, 'state.json'), state);

  let writerBResult = null;
  const writerAResult = runBridge([
    '--hub', hub,
    '--sync-enabled',
    '--write',
    '--sync-source', 'repo'
  ], {
    afterInitialSnapshotDerivation(initialSnapshot) {
      assert.equal(initialSnapshot.sourceRoot, path.resolve(sourceA));
      assert.deepEqual(initialSnapshot.plannedTargetSyncs, []);
      assert.match(initialSnapshot.payloads.opencode['skills/alpha/SKILL.md'].toString('utf8'), /source A/);
      writerBResult = run([
        '--hub', hub,
        '--sync-enabled',
        '--write',
        '--repo-path', sourceB,
        '--opencode-target', sourceBTarget,
        '--sync-source', 'claude-plugin'
      ], { env });
      assert.equal(writerBResult.status, 0, writerBResult.stderr);
      writeFile(path.join(sourceB, 'skills', 'alpha', 'SKILL.md'), [
        '---',
        'name: alpha',
        'description: alpha fixture skill for Toolkit bridge tests',
        '---',
        '',
        'source B after writer B',
        ''
      ].join('\n'));
      git(sourceB, ['add', '.']);
      git(sourceB, ['commit', '-m', 'advance source B after writer B snapshot']);
    }
  });

  assert.ok(writerBResult, 'writer B must commit while writer A is paused before lock acquisition');
  assert.equal(writerAResult.status, 0);
  const finalState = readJson(path.join(hub, 'state.json'));
  const manifest = readJson(path.join(hub, 'manifest.json'));
  const expectedPayloads = adapterPayloads({ repo_path: sourceB });
  assert.equal(finalState.repo_path, path.resolve(sourceB));
  assert.deepEqual(finalState.bridge_versions_by_source, {
    repo: expectedBridgeVersion,
    'codex-plugin': expectedBridgeVersion,
    'claude-plugin': expectedBridgeVersion
  });
  assert.deepEqual(finalState.future_bridge_metadata, { owner: 'future-version', preserve: true });
  assert.equal(manifest.checksum, payloadChecksum(expectedPayloads));
  assert.equal(manifest.source_commit, git(sourceB, ['rev-parse', 'HEAD']));
  assert.equal(path.resolve(finalState.targets.opencode.target_path), path.resolve(sourceBTarget));
  assert.equal(path.resolve(manifest.targets.opencode.target_path), path.resolve(sourceBTarget));
  assert.equal(finalState.targets.opencode.synced_checksum, manifest.checksum);
  assert.match(fs.readFileSync(path.join(hub, 'adapters', 'opencode', 'skills', 'alpha', 'SKILL.md'), 'utf8'), /source B after writer B/);
  assert.doesNotMatch(fs.readFileSync(path.join(hub, 'adapters', 'opencode', 'skills', 'alpha', 'SKILL.md'), 'utf8'), /source A/);
  assert.match(fs.readFileSync(path.join(sourceBTarget, 'alpha', 'SKILL.md'), 'utf8'), /source B after writer B/);

  const hubRoot = path.dirname(hub);
  const residuePattern = /^(?:update\.lock(?:$|\.recovery(?:$|\.)|\.displaced\.)|\.staging-)/;
  assert.deepEqual(fs.readdirSync(hubRoot).filter((name) => residuePattern.test(name)), []);

  const firstChecksum = manifest.checksum;
  const firstVersions = finalState.bridge_versions_by_source;
  const rerun = run([
    '--hub', hub,
    '--sync-enabled',
    '--write',
    '--repo-path', sourceB,
    '--opencode-target', sourceBTarget,
    '--sync-source', 'repo',
    '--suppress-update-report'
  ], { env });
  assert.equal(rerun.status, 0, rerun.stderr);
  const rerunState = readJson(path.join(hub, 'state.json'));
  const rerunManifest = readJson(path.join(hub, 'manifest.json'));
  assert.equal(rerunState.repo_path, path.resolve(sourceB));
  assert.equal(path.resolve(rerunState.targets.opencode.target_path), path.resolve(sourceBTarget));
  assert.equal(rerunManifest.checksum, firstChecksum);
  assert.deepEqual(rerunState.bridge_versions_by_source, firstVersions);
  assert.deepEqual(rerunState.future_bridge_metadata, { owner: 'future-version', preserve: true });
  assert.equal(rerunState.targets.opencode.synced_checksum, firstChecksum);
  assert.match(fs.readFileSync(path.join(sourceBTarget, 'alpha', 'SKILL.md'), 'utf8'), /source B after writer B/);
  assert.deepEqual(fs.readdirSync(hubRoot).filter((name) => residuePattern.test(name)), []);

  const rerunAudit = run(['--hub', hub, '--audit', '--sync-source', 'repo'], { env });
  assert.equal(rerunAudit.status, 0, rerunAudit.stderr);
  const audit = parseLastJson(rerunAudit.stdout);
  assert.equal(audit.checksum, firstChecksum);
  assert.equal(audit.targets.opencode.synced, true);
  assert.equal(audit.targets.opencode.would_write, false);
});

test('owned hub snapshot success and handled payload, validation, and replacement failures leave no generation residue', () => {
  const cases = [
    { name: 'success', hooks: {}, succeeds: true },
    {
      name: 'payload-write',
      hooks: { beforeHubPayloadWrite() { throw new Error('injected payload-write failure'); } },
      succeeds: false
    },
    {
      name: 'validation',
      hooks: { afterHubPayloadWrite({ stagePath }) { fs.rmSync(path.join(stagePath, 'state.json')); } },
      succeeds: false
    },
    {
      name: 'replacement',
      hooks: { beforeHubReplacement() { throw new Error('injected replacement failure'); } },
      succeeds: false
    }
  ];

  for (const fixture of cases) {
    const root = tmpRoot();
    const hub = path.join(root, `hub with spaces ${fixture.name}`, 'current');
    const args = [
      '--hub', hub,
      '--enable-auto-sync',
      '--write',
      '--sync-source', 'repo'
    ];
    const savedEnv = Object.fromEntries(Object.keys(isolatedHomeEnv(root)).map((key) => [key, process.env[key]]));
    Object.assign(process.env, isolatedHomeEnv(root));
    try {
      if (fixture.succeeds) {
        const result = runBridge(args, fixture.hooks);
        assert.equal(result.status, 0);
        assert.equal(fs.existsSync(path.join(hub, 'manifest.json')), true);
      } else {
        assert.throws(() => runBridge(args, fixture.hooks));
      }
    } finally {
      for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
    assert.deepEqual(ownedStagingArtifacts(path.dirname(hub)), [], `${fixture.name} hub staging must be cleaned`);
  }
});

function deadTestPid() {
  // A short-lived child that has already exited gives a PID that is
  // definitely not alive when the bridge checks it.
  const child = spawnSync(process.execPath, ['-e', ''], { windowsHide: true });
  assert.ok(child.pid > 0, 'fixture child must have spawned');
  return child.pid;
}

test('bridge audit and approved reconciliation clean only one exact abandoned new-format generation', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'managed hub with spaces', 'current');
  const parent = path.dirname(hub);
  fs.mkdirSync(parent, { recursive: true });
  const historical = path.join(parent, '.staging-historical-user-bytes');
  fs.mkdirSync(historical);
  fs.writeFileSync(path.join(historical, 'keep.txt'), 'historical bytes stay unchanged\n');
  const generation = createOwnedStagingGeneration({
    parent,
    target: hub,
    operation: 'hub-snapshot-replacement',
    sourceType: 'repo',
    bridgeVersion: expectedBridgeVersion,
    pid: deadTestPid()
  });
  fs.writeFileSync(path.join(generation.stagePath, 'partial.txt'), 'private fixture payload\n');
  const env = isolatedHomeEnv(root);

  const auditResult = run(['--hub', hub, '--audit', '--sync-source', 'repo'], { env });
  assert.equal(auditResult.status, 0, auditResult.stderr);
  const audit = parseLastJson(auditResult.stdout);
  assert.equal(audit.staging_generations.counts['dead-owned'], 1);
  assert.equal(audit.staging_generations.counts['historical-unmarked'], 1);
  assert.doesNotMatch(auditResult.stdout, /private fixture payload|historical bytes stay unchanged/);

  const preview = run(['--hub', hub, '--reconcile-staging', generation.record.generation_id, '--sync-source', 'repo'], { env });
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(fs.existsSync(generation.stagePath), true);

  const approved = run(['--hub', hub, '--reconcile-staging', generation.record.generation_id, '--write', '--sync-source', 'repo'], { env });
  assert.equal(approved.status, 0, approved.stderr);
  assert.equal(fs.existsSync(generation.stagePath), false);
  assert.equal(fs.readFileSync(path.join(historical, 'keep.txt'), 'utf8'), 'historical bytes stay unchanged\n');

  const idempotent = run(['--hub', hub, '--reconcile-staging', generation.record.generation_id, '--write', '--sync-source', 'repo'], { env });
  assert.equal(idempotent.status, 0, idempotent.stderr);
  assert.equal(fs.readFileSync(path.join(historical, 'keep.txt'), 'utf8'), 'historical bytes stay unchanged\n');
});

test('isolated reconciliation bypasses reports, state, targets, repo update, and native maintenance', () => {
  const root = tmpRoot();
  const tempRoot = path.join(root, 'isolated-temp');
  const hub = path.join(root, 'managed-hub', 'current');
  const parent = path.dirname(hub);
  const openCodeTarget = path.join(root, 'opencode-target', 'skills');
  const repoPath = path.join(root, 'configured-repo');
  const pluginRoot = path.join(root, 'native-plugin-cache');
  const reportDir = path.join(tempRoot, 'ai-agent-toolkit', 'update-reports');
  const historical = path.join(parent, '.staging-historical-preserve');
  const unrelated = path.join(parent, '.user.staging-preserve');
  fs.mkdirSync(parent, { recursive: true });
  fs.mkdirSync(openCodeTarget, { recursive: true });
  fs.mkdirSync(repoPath, { recursive: true });
  fs.mkdirSync(pluginRoot, { recursive: true });
  fs.mkdirSync(reportDir, { recursive: true });
  fs.mkdirSync(historical);
  fs.mkdirSync(unrelated);
  fs.writeFileSync(path.join(openCodeTarget, 'enabled-target.txt'), 'enabled target bytes\n');
  fs.writeFileSync(path.join(pluginRoot, 'native-cache.txt'), 'native cache bytes\n');
  fs.writeFileSync(path.join(historical, 'keep.txt'), 'historical staging bytes\n');
  fs.writeFileSync(path.join(unrelated, 'keep.txt'), 'unrelated staging bytes\n');
  fs.writeFileSync(path.join(reportDir, 'toolkit-update-20000101-000000.md'), 'expired report bytes\n');
  for (let index = 0; index < 205; index += 1) {
    fs.writeFileSync(path.join(reportDir, `toolkit-update-20260714-120000-${index}.md`), `over-limit report ${index}\n`);
  }
  const oldDate = new Date('2000-01-01T00:00:00.000Z');
  fs.utimesSync(path.join(reportDir, 'toolkit-update-20000101-000000.md'), oldDate, oldDate);

  writeJson(path.join(hub, 'state.json'), {
    schema_version: 1,
    architecture_version: 2,
    hub_version: expectedBridgeVersion,
    bridge_versions_by_source: { repo: expectedBridgeVersion },
    auto_sync_enabled: true,
    repo_auto_update_enabled: true,
    repo_path: repoPath,
    update_report_enabled: true,
    update_report_open_enabled: true,
    update_report_retention_days: 1,
    codex_plugin_auto_refresh_enabled: true,
    targets: {
      opencode: {
        enabled: true,
        explicitly_disabled: false,
        target_path: openCodeTarget,
        synced_version: '0.0.1',
        synced_checksum: 'stale'
      },
      ag2: { enabled: false, explicitly_disabled: true }
    }
  });
  fs.writeFileSync(path.join(hub, 'manifest.json'), 'manifest bytes remain exact\n');
  const generation = createOwnedStagingGeneration({
    parent,
    target: hub,
    operation: 'hub-snapshot-replacement',
    sourceType: 'repo',
    bridgeVersion: expectedBridgeVersion,
    pid: deadTestPid()
  });
  fs.writeFileSync(path.join(generation.stagePath, 'partial.txt'), 'selected generation bytes\n');

  const env = isolatedHomeEnv(root, {
    PATH: '',
    TEMP: tempRoot,
    TMP: tempRoot,
    TMPDIR: tempRoot,
    PLUGIN_ROOT: pluginRoot,
    TOOLKIT_BRIDGE_TEST_DELEGATE_MARKER: path.join(root, 'repo-update-marker.txt')
  });
  const reportBefore = snapshotTree(reportDir);
  const stateBefore = fs.readFileSync(path.join(hub, 'state.json'));
  const manifestBefore = fs.readFileSync(path.join(hub, 'manifest.json'));
  const targetBefore = snapshotTree(openCodeTarget);
  const pluginBefore = snapshotTree(pluginRoot);
  const historicalBefore = snapshotTree(historical);
  const unrelatedBefore = snapshotTree(unrelated);
  const lockPath = path.join(parent, 'update.lock');

  const dryRun = run(['--hub', hub, '--reconcile-staging', generation.record.generation_id], { env });
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.equal(parseLastJson(dryRun.stdout).staging_reconciliation.status, 'would-clean');
  assert.deepEqual(snapshotTree(reportDir), reportBefore);
  assert.deepEqual(fs.readFileSync(path.join(hub, 'state.json')), stateBefore);
  assert.deepEqual(fs.readFileSync(path.join(hub, 'manifest.json')), manifestBefore);
  assert.deepEqual(snapshotTree(openCodeTarget), targetBefore);
  assert.deepEqual(snapshotTree(pluginRoot), pluginBefore);
  assert.equal(fs.existsSync(lockPath), false, 'dry-run reconciliation must not create a lock');

  const write = run(['--hub', hub, '--reconcile-staging', generation.record.generation_id, '--write'], { env });
  assert.equal(write.status, 0, write.stderr);
  assert.equal(parseLastJson(write.stdout).staging_reconciliation.status, 'cleaned');
  assert.equal(fs.existsSync(generation.stagePath), false);
  assert.equal(fs.existsSync(generation.recordPath), false);
  assert.equal(fs.existsSync(lockPath), false, 'write reconciliation must release its lock');
  assert.deepEqual(snapshotTree(reportDir), reportBefore);
  assert.deepEqual(fs.readFileSync(path.join(hub, 'state.json')), stateBefore);
  assert.deepEqual(fs.readFileSync(path.join(hub, 'manifest.json')), manifestBefore);
  assert.deepEqual(snapshotTree(openCodeTarget), targetBefore);
  assert.deepEqual(snapshotTree(pluginRoot), pluginBefore);
  assert.deepEqual(snapshotTree(historical), historicalBefore);
  assert.deepEqual(snapshotTree(unrelated), unrelatedBefore);
  assert.equal(fs.existsSync(env.TOOLKIT_BRIDGE_TEST_DELEGATE_MARKER), false, 'repo auto-update must not run');

  const rerun = run(['--hub', hub, '--reconcile-staging', generation.record.generation_id, '--write'], { env });
  assert.equal(rerun.status, 0, rerun.stderr);
  const rerunOutput = parseLastJson(rerun.stdout);
  assert.equal(rerunOutput.staging_reconciliation.status, 'already-absent');
  assert.equal(rerunOutput.staging_reconciliation.checked_parent_count, 3);
  assert.deepEqual(snapshotTree(reportDir), reportBefore);
});

test('reconciliation rejects every unrelated command flag before mutation', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  const sentinel = path.join(root, 'sentinel.txt');
  fs.writeFileSync(sentinel, 'unchanged\n');
  writeJson(path.join(hub, 'state.json'), {
    schema_version: 1,
    architecture_version: 2,
    hub_version: expectedBridgeVersion,
    update_report_enabled: false,
    update_report_open_enabled: false,
    codex_plugin_auto_refresh_enabled: false,
    targets: {}
  });
  const stateBefore = fs.readFileSync(path.join(hub, 'state.json'));
  const generationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const incompatible = [
    ['--hook'],
    ['--audit'],
    ['--sync-enabled'],
    ['--enable-auto-sync'],
    ['--disable-auto-sync'],
    ['--enable-repo-auto-update'],
    ['--disable-repo-auto-update'],
    ['--repo-path', root],
    ['--repo-branch', 'main'],
    ['--repo-remote', 'https://example.invalid/repo'],
    ['--repo-update-now'],
    ['--skip-repo-auto-update'],
    ['--open-update-report'],
    ['--enable-update-reports'],
    ['--disable-update-reports'],
    ['--update-report-retention-days', '1'],
    ['--enable-update-report-open'],
    ['--disable-update-report-open'],
    ['--enable-codex-plugin-auto-refresh'],
    ['--disable-codex-plugin-auto-refresh'],
    ['--suppress-update-report'],
    ['--enable-target', 'opencode'],
    ['--disable-target', 'opencode'],
    ['--opencode-command', 'unused-opencode'],
    ['--python-command', 'unused-python'],
    ['--set-ag2-python-command', 'unused-python']
  ];
  const env = isolatedHomeEnv(root, { PATH: '' });
  for (const extraArgs of incompatible) {
    const result = run(['--hub', hub, '--reconcile-staging', generationId, '--write', ...extraArgs], { env });
    assert.notEqual(result.status, 0, `${extraArgs[0]} must fail`);
    assert.match(result.stderr, /--reconcile-staging cannot be combined with:/);
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'unchanged\n');
    assert.deepEqual(fs.readFileSync(path.join(hub, 'state.json')), stateBefore);
    assert.equal(fs.existsSync(path.join(path.dirname(hub), 'update.lock')), false);
  }
});

test('reconciliation lock refusal preserves the selected generation and unrelated files', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  const parent = path.dirname(hub);
  fs.mkdirSync(parent, { recursive: true });
  const generation = createOwnedStagingGeneration({
    parent,
    target: hub,
    operation: 'hub-snapshot-replacement',
    sourceType: 'repo',
    bridgeVersion: expectedBridgeVersion,
    pid: deadTestPid()
  });
  fs.writeFileSync(path.join(generation.stagePath, 'partial.txt'), 'selected bytes\n');
  const unrelated = path.join(parent, 'unrelated.txt');
  fs.writeFileSync(unrelated, 'unrelated bytes\n');
  const lockPath = path.join(parent, 'update.lock');
  writeJson(lockPath, { created_at: new Date().toISOString(), pid: process.pid, token: 'live-owner-token' });
  const before = snapshotTree(parent);

  const result = run(['--hub', hub, '--reconcile-staging', generation.record.generation_id, '--write'], {
    env: isolatedHomeEnv(root, { PATH: '' })
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /staging reconciliation blocked|held by live process/);
  assert.deepEqual(snapshotTree(parent), before);
});

function fsError(code) {
  const error = new Error(`injected ${code}`);
  error.code = code;
  return error;
}

test('fresh lock owned by a live process blocks manual writes and is not deleted', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  const lockPath = path.join(root, 'hub', 'update.lock');
  // This test process is alive for the whole bridge child run.
  writeJson(lockPath, { created_at: new Date().toISOString(), pid: process.pid });

  const result = run(['--hub', hub, '--write', '--enable-target', 'ag2'], { env: isolatedHomeEnv(root) });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /held by live process/);
  assert.equal(fs.existsSync(lockPath), true, 'a live-owner lock must never be deleted');
});

test('fresh lock owned by a dead process is recovered immediately without waiting for the stale age', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  const lockPath = path.join(root, 'hub', 'update.lock');
  const unrelatedPath = path.join(root, 'hub', 'unrelated-user-file.txt');
  writeJson(lockPath, { created_at: new Date().toISOString(), pid: deadTestPid() });
  fs.writeFileSync(unrelatedPath, 'keep me\n', 'utf8');

  const result = run(['--hub', hub, '--write', '--enable-target', 'ag2'], {
    env: isolatedHomeEnv(root),
    timeout: 480000
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(lockPath), false, 'recovered lock is released after successful sync');
  assert.equal(fs.readFileSync(unrelatedPath, 'utf8'), 'keep me\n', 'unrelated files are untouched');
});

test('fresh lock without a usable owner PID keeps the age-based fallback and stale lock is recovered', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  const lockPath = path.join(root, 'hub', 'update.lock');

  // Missing PID, fresh created_at: age fallback blocks the write.
  writeJson(lockPath, { created_at: new Date().toISOString() });
  let result = run(['--hub', hub, '--write', '--enable-target', 'ag2'], { env: isolatedHomeEnv(root) });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /fresh Toolkit bridge lock/);

  // Malformed PID, fresh created_at: same safe age fallback.
  writeJson(lockPath, { created_at: new Date().toISOString(), pid: 'not-a-pid' });
  result = run(['--hub', hub, '--write', '--enable-target', 'ag2'], { env: isolatedHomeEnv(root) });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /fresh Toolkit bridge lock/);

  // Legacy stale lock without a live owner is still recovered by age.
  writeJson(lockPath, { created_at: '2000-01-01T00:00:00.000Z', pid: 'not-a-pid' });
  result = run(['--hub', hub, '--write', '--enable-target', 'ag2'], {
    env: isolatedHomeEnv(root),
    timeout: 480000
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(lockPath), false, 'lock is released after successful sync');
});

test('malformed lock JSON falls back to file mtime: fresh is respected, old is recovered', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  const lockPath = path.join(root, 'hub', 'update.lock');
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  // Freshly written malformed lock (for example a partial write from another
  // process) must not be recklessly removed.
  fs.writeFileSync(lockPath, '{ this is not json', 'utf8');
  let result = run(['--hub', hub, '--write', '--enable-target', 'ag2'], { env: isolatedHomeEnv(root) });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /fresh Toolkit bridge lock/);
  assert.equal(fs.existsSync(lockPath), true, 'fresh unverifiable lock is not removed');

  // The same malformed lock with an old mtime is recoverable.
  const oldTime = new Date(Date.now() - 60 * 60 * 1000);
  fs.utimesSync(lockPath, oldTime, oldTime);
  result = run(['--hub', hub, '--write', '--enable-target', 'ag2'], {
    env: isolatedHomeEnv(root),
    timeout: 480000
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(lockPath), false, 'lock is released after successful sync');
});

test('hook mode skips instead of failing when the lock owner is alive', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  const lockPath = path.join(root, 'hub', 'update.lock');
  // An enabled stale target with auto-sync on makes the hook reach the sync
  // lock; the live lock must then produce a skip, not a failure, and must
  // survive untouched.
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
  writeJson(lockPath, { created_at: new Date().toISOString(), pid: process.pid });

  const result = run(
    ['--hub', hub, '--hook', '--write', '--sync-source', 'claude-plugin'],
    { env: isolatedHomeEnv(root) }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /held by live process/);
  assert.equal(fs.existsSync(lockPath), true, 'a live-owner lock must never be deleted');
});

test('two contenders recovering the same dead lock: the loser never deletes the winner replacement', () => {
  const root = tmpRoot();
  const hubRoot = path.join(root, 'hub');
  const lockPath = path.join(hubRoot, 'update.lock');
  const bridge = require('../scripts/toolkit-local-bridge.cjs');
  fs.mkdirSync(hubRoot, { recursive: true });
  writeJson(lockPath, { created_at: new Date().toISOString(), pid: 999999 });

  // In-process contenders share this test's PID, so liveness is injected:
  // the seeded dead lock's PID reports dead, and any replacement written by
  // this process reports alive. The afterInspect seam runs contender B's
  // complete recovery between A's inspection and A's recovery claim -- the
  // exact interleaving the atomic marker protocol must survive.
  const liveness = (pid) => (Number(pid) === process.pid ? 'alive' : 'dead');

  let winner = null;
  const loser = bridge.acquireLock(hubRoot, { hook: true, syncSource: 'repo' }, {
    liveness,
    afterInspect: () => {
      winner = bridge.acquireLock(hubRoot, { hook: true, syncSource: 'repo' }, { liveness });
    }
  });

  assert.equal(winner.acquired, true, 'contender B recovers the dead lock');
  assert.equal(loser.acquired, false, 'only one contender may own the lock');
  assert.match(loser.skipReason, /held by live process/);
  const current = readJson(lockPath);
  assert.equal(current.token, winner.token, 'the winner replacement lock survives the loser recovery attempt');
  assert.equal(fs.existsSync(`${lockPath}.recovery`), false, 'no recovery marker is left behind');

  // Neither the loser handle nor a forged stale handle may release the
  // winner's lock; only the winner's own ownership token removes it.
  bridge.releaseLock(loser);
  bridge.releaseLock({ acquired: true, lockPath, token: 'stale-forged-token' });
  assert.equal(fs.existsSync(lockPath), true, 'foreign release attempts must not delete the winner lock');
  bridge.releaseLock(winner);
  assert.equal(fs.existsSync(lockPath), false, 'the winner releases its own lock');
});

test('a recovery marker held by a live process blocks other recoveries without deleting anything', () => {
  const root = tmpRoot();
  const hubRoot = path.join(root, 'hub');
  const lockPath = path.join(hubRoot, 'update.lock');
  const markerPath = `${lockPath}.recovery`;
  const bridge = require('../scripts/toolkit-local-bridge.cjs');
  fs.mkdirSync(hubRoot, { recursive: true });
  writeJson(lockPath, { created_at: new Date().toISOString(), pid: 999999 });
  writeJson(markerPath, { created_at: new Date().toISOString(), pid: 888888, token: 'other-recovery' });

  const liveness = (pid) => (Number(pid) === 888888 ? 'alive' : 'dead');
  const result = bridge.acquireLock(hubRoot, { hook: true, syncSource: 'repo' }, { liveness });

  assert.equal(result.acquired, false);
  assert.match(result.skipReason, /recovery .* is in progress by live process 888888/);
  assert.equal(readJson(lockPath).pid, 999999, 'the recoverable lock is untouched while recovery is claimed elsewhere');
  assert.equal(readJson(markerPath).token, 'other-recovery', 'the live recovery marker is untouched');
});

test('a recovery marker left by a dead recovery is cleared and recovery proceeds', () => {
  const root = tmpRoot();
  const hubRoot = path.join(root, 'hub');
  const lockPath = path.join(hubRoot, 'update.lock');
  const markerPath = `${lockPath}.recovery`;
  const bridge = require('../scripts/toolkit-local-bridge.cjs');
  fs.mkdirSync(hubRoot, { recursive: true });
  writeJson(lockPath, { created_at: new Date().toISOString(), pid: 999999 });
  writeJson(markerPath, { created_at: new Date().toISOString(), pid: 999998, token: 'crashed-recovery' });

  const liveness = () => 'dead';
  const result = bridge.acquireLock(hubRoot, { hook: true, syncSource: 'repo' }, { liveness });

  assert.equal(result.acquired, true, 'a crashed recovery marker must not wedge future recoveries');
  assert.equal(fs.existsSync(markerPath), false, 'the crashed marker is cleared');
  bridge.releaseLock(result);
  assert.equal(fs.existsSync(lockPath), false);
});

test('release does not delete a lock that replaced this run own lock', () => {
  const root = tmpRoot();
  const hubRoot = path.join(root, 'hub');
  const lockPath = path.join(hubRoot, 'update.lock');
  const bridge = require('../scripts/toolkit-local-bridge.cjs');

  const own = bridge.acquireLock(hubRoot, { hook: true, syncSource: 'repo' });
  assert.equal(own.acquired, true);

  // Another process replaces the lock after acquisition but before release.
  writeJson(lockPath, { created_at: new Date().toISOString(), pid: 424242, token: 'replacement-owner' });
  bridge.releaseLock(own);
  assert.equal(fs.existsSync(lockPath), true, 'the old owner must not delete the replacement lock');
  assert.equal(readJson(lockPath).token, 'replacement-owner');
});

test('two contenders reclaiming the same dead recovery marker: only one recovery owner emerges', () => {
  const root = tmpRoot();
  const hubRoot = path.join(root, 'hub');
  const lockPath = path.join(hubRoot, 'update.lock');
  const markerPath = `${lockPath}.recovery`;
  const bridge = require('../scripts/toolkit-local-bridge.cjs');
  fs.mkdirSync(hubRoot, { recursive: true });
  // A dead main lock plus a marker left behind by a crashed recovery.
  writeJson(lockPath, { created_at: new Date().toISOString(), pid: 999999 });
  writeJson(markerPath, { created_at: new Date().toISOString(), pid: 999998, token: 'crashed-recovery' });

  const liveness = (pid) => (Number(pid) === process.pid ? 'alive' : 'dead');

  // Both contenders inspect the same dead marker generation before either
  // cleanup completes: A's afterMarkerInspect seam runs B's complete
  // acquisition between A's marker classification and A's reclaim attempt.
  let winner = null;
  const loser = bridge.acquireLock(hubRoot, { hook: true, syncSource: 'repo' }, {
    liveness,
    afterMarkerInspect: () => {
      if (winner) return; // only the outer contender A schedules B once
      winner = bridge.acquireLock(hubRoot, { hook: true, syncSource: 'repo' }, { liveness });
    }
  });

  assert.equal(winner.acquired, true, 'contender B reclaims the dead marker and recovers the lock');
  assert.equal(loser.acquired, false, 'contender A must lose the identity-safe reclaim');
  assert.match(loser.skipReason, /already reclaimed by another process|changed while being reclaimed|re-created by another process|held by live process/);
  assert.equal(readJson(lockPath).token, winner.token, 'the loser never displaces or deletes the winner main lock');
  assert.equal(fs.existsSync(markerPath), false, 'the winner released its own marker; the loser never deleted a live one');

  bridge.releaseLock(loser);
  assert.equal(fs.existsSync(lockPath), true, 'the loser handle cannot release the winner lock');
  bridge.releaseLock(winner);
  assert.equal(fs.existsSync(lockPath), false);
});

test('a third contender cannot create a main lock while recovery has displaced it', () => {
  const root = tmpRoot();
  const hubRoot = path.join(root, 'hub');
  const lockPath = path.join(hubRoot, 'update.lock');
  const bridge = require('../scripts/toolkit-local-bridge.cjs');
  fs.mkdirSync(hubRoot, { recursive: true });
  writeJson(lockPath, { created_at: new Date().toISOString(), pid: 999999 });

  const liveness = (pid) => (Number(pid) === process.pid ? 'alive' : 'dead');

  // C starts during the exact gap in which A has displaced the dead lock
  // but has not yet written its replacement: the main lock path is absent
  // and only A's live recovery marker guards the hub.
  let thirdContender = null;
  const recoverer = bridge.acquireLock(hubRoot, { hook: true, syncSource: 'repo' }, {
    liveness,
    afterDisplace: () => {
      assert.equal(fs.existsSync(lockPath), false, 'fixture: the main lock is displaced during this gap');
      thirdContender = bridge.acquireLock(hubRoot, { hook: true, syncSource: 'repo' }, { liveness });
    }
  });

  assert.equal(recoverer.acquired, true, 'the recoverer remains the only possible owner');
  assert.equal(thirdContender.acquired, false, 'the third contender must not create a lock behind the recoverer');
  assert.match(thirdContender.skipReason, /recovery .* is in progress by live process/);
  assert.equal(readJson(lockPath).token, recoverer.token);
  bridge.releaseLock(recoverer);
});

test('a displaced live lock that cannot be restored fails closed without deleting evidence', () => {
  const root = tmpRoot();
  const hubRoot = path.join(root, 'hub');
  const lockPath = path.join(hubRoot, 'update.lock');
  const bridge = require('../scripts/toolkit-local-bridge.cjs');
  fs.mkdirSync(hubRoot, { recursive: true });
  writeJson(lockPath, { created_at: new Date().toISOString(), pid: 999999 });

  const liveness = (pid) => (Number(pid) === 777777 ? 'alive' : 'dead');

  // A live replacement appears after the under-marker recheck but before the
  // displacement rename, and an intruding lock occupies the main path before
  // restoration: the protocol must preserve the displaced live-owner
  // evidence, must not let this contender write, and must say where the
  // evidence lives.
  const result = bridge.acquireLock(hubRoot, { hook: true, syncSource: 'repo' }, {
    liveness,
    beforeDisplace: () => {
      writeJson(lockPath, { created_at: new Date().toISOString(), pid: 777777, token: 'live-replacement' });
    },
    afterDisplace: () => {
      writeJson(lockPath, { created_at: new Date().toISOString(), pid: 424242, token: 'intruder' });
    }
  });

  assert.equal(result.acquired, false, 'no second writer proceeds');
  assert.match(result.skipReason, /displaced a lock held by live process 777777; no-clobber restoration is not guaranteed/);
  assert.match(result.skipReason, /preserved at/);
  const displacedFiles = fs.readdirSync(hubRoot).filter((entry) => entry.startsWith('update.lock.displaced.'));
  assert.equal(displacedFiles.length, 1, 'the displaced live-owner lock is preserved as evidence');
  assert.equal(readJson(path.join(hubRoot, displacedFiles[0])).token, 'live-replacement');
  assert.equal(readJson(lockPath).token, 'intruder', 'the intruding lock is not touched either');
});

test('a displaced live lock remains evidence when the main path is free', () => {
  const root = tmpRoot();
  const hubRoot = path.join(root, 'hub');
  const lockPath = path.join(hubRoot, 'update.lock');
  const bridge = require('../scripts/toolkit-local-bridge.cjs');
  fs.mkdirSync(hubRoot, { recursive: true });
  writeJson(lockPath, { created_at: new Date().toISOString(), pid: 999999 });

  const liveness = (pid) => (Number(pid) === 777777 ? 'alive' : 'dead');
  const result = bridge.acquireLock(hubRoot, { hook: true, syncSource: 'repo' }, {
    liveness,
    beforeDisplace: () => {
      writeJson(lockPath, { created_at: new Date().toISOString(), pid: 777777, token: 'live-replacement' });
    }
  });

  assert.equal(result.acquired, false);
  assert.match(result.skipReason, /no-clobber restoration is not guaranteed/);
  assert.equal(fs.existsSync(lockPath), false, 'no main lock is created when restoration is unsafe');
  const displacedFiles = fs.readdirSync(hubRoot).filter((entry) => /^update\.lock\.displaced\.[0-9a-f-]+$/i.test(entry));
  assert.equal(displacedFiles.length, 1, 'the live lock remains persistent evidence');
  assert.equal(readJson(path.join(hubRoot, displacedFiles[0])).token, 'live-replacement');
});

test('no-clobber restoration preserves an intruder created at the restoration commitment', () => {
  const root = tmpRoot();
  const hubRoot = path.join(root, 'hub');
  const lockPath = path.join(hubRoot, 'update.lock');
  const bridge = require('../scripts/toolkit-local-bridge.cjs');
  fs.mkdirSync(hubRoot, { recursive: true });
  writeJson(lockPath, { created_at: new Date().toISOString(), pid: 999999 });

  const liveness = (pid) => (Number(pid) === 777777 ? 'alive' : 'dead');
  let intruderRaw = null;
  const hookRun = bridge.acquireLock(hubRoot, { hook: true, syncSource: 'repo' }, {
    liveness,
    beforeDisplace: () => {
      writeJson(lockPath, { created_at: new Date().toISOString(), pid: 777777, token: 'live-replacement' });
    },
    beforeRestorationCommit: () => {
      assert.equal(fs.existsSync(lockPath), false, 'restoration initially appears possible');
      writeJson(lockPath, { created_at: new Date().toISOString(), pid: 424242, token: 'intruder-at-commit' });
      intruderRaw = fs.readFileSync(lockPath, 'utf8');
    }
  });

  assert.equal(hookRun.acquired, false, 'the recoverer never acquires');
  assert.match(hookRun.skipReason, /no-clobber restoration is not guaranteed/);
  assert.equal(fs.readFileSync(lockPath, 'utf8'), intruderRaw, 'the intruding main lock remains byte-for-byte untouched');
  const displacedFiles = fs.readdirSync(hubRoot).filter((entry) => /^update\.lock\.displaced\.[0-9a-f-]+$/i.test(entry));
  assert.equal(displacedFiles.length, 1, 'the displaced live-owner lock remains evidence');
  const evidencePath = path.join(hubRoot, displacedFiles[0]);
  const evidenceRaw = fs.readFileSync(evidencePath, 'utf8');
  assert.equal(JSON.parse(evidenceRaw).token, 'live-replacement');

  assert.throws(
    () => bridge.acquireLock(hubRoot, { hook: false, syncSource: 'repo' }, { liveness }),
    /displaced lock evidence at .* belongs to live process 777777/,
    'manual mode fails clearly while the evidence owner is alive'
  );
  const later = bridge.acquireLock(hubRoot, { hook: true, syncSource: 'repo' }, { liveness });
  assert.equal(later.acquired, false, 'a later contender remains blocked');
  assert.match(later.skipReason, /belongs to live process 777777/);
  assert.equal(fs.readFileSync(lockPath, 'utf8'), intruderRaw, 'later contenders do not alter the intruder');
  assert.equal(fs.readFileSync(evidencePath, 'utf8'), evidenceRaw, 'later contenders do not alter the evidence');
});

test('the no-lock acquisition path respects an active recovery claim', () => {
  const root = tmpRoot();
  const hubRoot = path.join(root, 'hub');
  const lockPath = path.join(hubRoot, 'update.lock');
  const markerPath = `${lockPath}.recovery`;
  const bridge = require('../scripts/toolkit-local-bridge.cjs');
  fs.mkdirSync(hubRoot, { recursive: true });
  // No main lock, but a live recovery is in flight.
  writeJson(markerPath, { created_at: new Date().toISOString(), pid: 888888, token: 'live-recovery' });

  const liveness = (pid) => (Number(pid) === 888888 ? 'alive' : 'dead');

  const hookRun = bridge.acquireLock(hubRoot, { hook: true, syncSource: 'repo' }, { liveness });
  assert.equal(hookRun.acquired, false, 'hook runs skip while recovery is active');
  assert.match(hookRun.skipReason, /recovery .* is in progress by live process 888888/);
  assert.equal(fs.existsSync(lockPath), false, 'no lock is created behind the recoverer');

  assert.throws(
    () => bridge.acquireLock(hubRoot, { hook: false, syncSource: 'repo' }, { liveness }),
    /recovery .* is in progress by live process 888888/,
    'manual runs fail while recovery is active'
  );
  assert.equal(readJson(markerPath).token, 'live-recovery', 'the live recovery marker is untouched');
});

// Builds the full fail-closed lifecycle: a recoverable old lock, a live
// replacement displaced mid-recovery, and an intruder occupying the main
// path so restoration fails and the live evidence is preserved.
function buildFailClosedDisplacedEvidence(bridge, hubRoot, lockPath, liveness) {
  writeJson(lockPath, { created_at: new Date().toISOString(), pid: 999999 });
  const failedRecovery = bridge.acquireLock(hubRoot, { hook: true, syncSource: 'repo' }, {
    liveness,
    beforeDisplace: () => {
      writeJson(lockPath, { created_at: new Date().toISOString(), pid: 777777, token: 'live-displaced-owner' });
    },
    afterDisplace: () => {
      writeJson(lockPath, { created_at: new Date().toISOString(), pid: 424242, token: 'intruder' });
    }
  });
  assert.equal(failedRecovery.acquired, false);
  const evidenceFiles = fs.readdirSync(hubRoot).filter((entry) => /^update\.lock\.displaced\.[0-9a-f-]+$/i.test(entry));
  assert.equal(evidenceFiles.length, 1, 'fixture: displaced live evidence is preserved');
  return path.join(hubRoot, evidenceFiles[0]);
}

test('a contender that scanned before failed-restoration evidence existed is blocked by the under-marker recheck', () => {
  const root = tmpRoot();
  const hubRoot = path.join(root, 'hub');
  const lockPath = path.join(hubRoot, 'update.lock');
  const markerPath = `${lockPath}.recovery`;
  const bridge = require('../scripts/toolkit-local-bridge.cjs');
  fs.mkdirSync(hubRoot, { recursive: true });
  writeJson(lockPath, { created_at: new Date().toISOString(), pid: 999999 });

  const liveness = (pid) => (Number(pid) === 777777 ? 'alive' : 'dead');
  let failedRecovery = null;
  let evidencePath = null;
  let evidenceRaw = null;

  // C completes its initial evidence scan while none exists. During the
  // injected pause, R displaces a live replacement, cannot restore it because
  // an intruder occupies the main path, preserves evidence, releases its
  // marker, and declines acquisition. The intruder then exits before C resumes.
  const contender = bridge.acquireLock(hubRoot, { hook: true, syncSource: 'repo' }, {
    liveness,
    afterInitialEvidenceInspect: () => {
      failedRecovery = bridge.acquireLock(hubRoot, { hook: true, syncSource: 'repo' }, {
        liveness,
        beforeDisplace: () => {
          writeJson(lockPath, { created_at: new Date().toISOString(), pid: 777777, token: 'live-displaced-owner' });
        },
        afterDisplace: () => {
          writeJson(lockPath, { created_at: new Date().toISOString(), pid: 424242, token: 'intruder' });
        }
      });
      assert.equal(failedRecovery.acquired, false, 'R must not acquire after failed restoration');
      assert.equal(fs.existsSync(markerPath), false, 'R releases its recovery marker');
      const evidenceFiles = fs.readdirSync(hubRoot).filter((entry) => /^update\.lock\.displaced\.[0-9a-f-]+$/i.test(entry));
      assert.equal(evidenceFiles.length, 1, 'R preserves exactly one evidence generation');
      evidencePath = path.join(hubRoot, evidenceFiles[0]);
      evidenceRaw = fs.readFileSync(evidencePath, 'utf8');
      fs.rmSync(lockPath, { force: true });
    }
  });

  assert.equal(contender.acquired, false, 'C must not acquire from its stale initial scan');
  assert.match(contender.skipReason, /displaced lock evidence at .* belongs to live process 777777/);
  assert.equal(fs.existsSync(lockPath), false, 'C does not create the main lock');
  assert.equal(fs.readFileSync(evidencePath, 'utf8'), evidenceRaw, 'C does not alter the evidence');

  assert.throws(
    () => bridge.acquireLock(hubRoot, { hook: false, syncSource: 'repo' }, { liveness }),
    /displaced lock evidence at .* belongs to live process 777777/,
    'manual acquisition fails clearly behind the same evidence'
  );
  const later = bridge.acquireLock(hubRoot, { hook: true, syncSource: 'repo' }, { liveness });
  assert.equal(later.acquired, false, 'a later contender remains blocked while the displaced owner lives');
  assert.equal(fs.existsSync(lockPath), false);
  assert.equal(fs.readFileSync(evidencePath, 'utf8'), evidenceRaw);
});

test('displaced live evidence blocks later contenders after the marker and intruder are gone', () => {
  const root = tmpRoot();
  const hubRoot = path.join(root, 'hub');
  const lockPath = path.join(hubRoot, 'update.lock');
  const bridge = require('../scripts/toolkit-local-bridge.cjs');
  fs.mkdirSync(hubRoot, { recursive: true });
  const liveness = (pid) => (Number(pid) === 777777 ? 'alive' : 'dead');

  const evidencePath = buildFailClosedDisplacedEvidence(bridge, hubRoot, lockPath, liveness);
  assert.equal(fs.existsSync(`${lockPath}.recovery`), false, 'the failed recovery released its marker');

  // The intruder later releases its main lock: nothing is left but the
  // preserved evidence, and it alone must keep every later contender out.
  fs.rmSync(lockPath, { force: true });

  const laterHook = bridge.acquireLock(hubRoot, { hook: true, syncSource: 'repo' }, { liveness });
  assert.equal(laterHook.acquired, false, 'a later contender must not acquire behind a live displaced owner');
  assert.match(laterHook.skipReason, /displaced lock evidence at .* belongs to live process 777777/);
  assert.equal(fs.existsSync(lockPath), false, 'no new main lock is created');
  assert.equal(fs.existsSync(evidencePath), true, 'the later contender does not delete the evidence');

  assert.throws(
    () => bridge.acquireLock(hubRoot, { hook: false, syncSource: 'repo' }, { liveness }),
    /displaced lock evidence at .* belongs to live process 777777/,
    'manual runs fail clearly while the displaced owner is alive'
  );
  assert.equal(fs.existsSync(evidencePath), true);
});

test('aged displaced live evidence survives cleanup and still blocks acquisition', () => {
  const root = tmpRoot();
  const hubRoot = path.join(root, 'hub');
  const lockPath = path.join(hubRoot, 'update.lock');
  const bridge = require('../scripts/toolkit-local-bridge.cjs');
  fs.mkdirSync(hubRoot, { recursive: true });
  const liveness = (pid) => (Number(pid) === 777777 ? 'alive' : 'dead');

  const evidencePath = buildFailClosedDisplacedEvidence(bridge, hubRoot, lockPath, liveness);
  fs.rmSync(lockPath, { force: true });

  // Age the evidence far beyond the artifact GC threshold: age alone must
  // never delete evidence whose owner is alive.
  const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  fs.utimesSync(evidencePath, old, old);

  const later = bridge.acquireLock(hubRoot, { hook: true, syncSource: 'repo' }, { liveness });
  assert.equal(later.acquired, false);
  assert.match(later.skipReason, /belongs to live process 777777/);
  assert.equal(fs.existsSync(evidencePath), true, 'cleanup must not age out live displaced evidence');
  assert.equal(fs.existsSync(lockPath), false, 'no new writer enters');
});

test('displaced evidence with an indeterminate owner fails closed', () => {
  const root = tmpRoot();
  const hubRoot = path.join(root, 'hub');
  const lockPath = path.join(hubRoot, 'update.lock');
  const bridge = require('../scripts/toolkit-local-bridge.cjs');
  fs.mkdirSync(hubRoot, { recursive: true });

  const buildLiveness = (pid) => (Number(pid) === 777777 ? 'alive' : 'dead');
  const evidencePath = buildFailClosedDisplacedEvidence(bridge, hubRoot, lockPath, buildLiveness);
  fs.rmSync(lockPath, { force: true });

  // The displaced owner's liveness probe now reports EPERM-style
  // indeterminacy: not proof of death, so acquisition fails closed.
  const indeterminate = (pid) => (Number(pid) === 777777 ? 'indeterminate' : 'dead');

  const hookRun = bridge.acquireLock(hubRoot, { hook: true, syncSource: 'repo' }, { liveness: indeterminate });
  assert.equal(hookRun.acquired, false);
  assert.match(hookRun.skipReason, /liveness cannot be verified; failing closed/);
  assert.equal(fs.existsSync(evidencePath), true, 'evidence remains under indeterminate ownership');
  assert.equal(fs.existsSync(lockPath), false, 'no main lock is created');

  assert.throws(
    () => bridge.acquireLock(hubRoot, { hook: false, syncSource: 'repo' }, { liveness: indeterminate }),
    /liveness cannot be verified; failing closed/
  );
});

test('evidence that vanishes with ENOENT after enumeration does not create a false barrier', () => {
  const root = tmpRoot();
  const hubRoot = path.join(root, 'hub');
  const lockPath = path.join(hubRoot, 'update.lock');
  const evidencePath = path.join(hubRoot, 'update.lock.displaced.aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  const bridge = require('../scripts/toolkit-local-bridge.cjs');
  fs.mkdirSync(hubRoot, { recursive: true });
  writeJson(evidencePath, { created_at: new Date().toISOString(), pid: 999999, token: 'vanishing' });

  let injected = false;
  const result = bridge.acquireLock(hubRoot, { hook: true, syncSource: 'repo' }, {
    liveness: () => 'dead',
    readDisplacedEvidence: (fullPath, phase) => {
      if (phase === 'initial' && !injected) {
        injected = true;
        fs.rmSync(fullPath);
        throw fsError('ENOENT');
      }
      return fs.readFileSync(fullPath, 'utf8');
    }
  });

  assert.equal(result.acquired, true, 'genuine ENOENT means the enumerated evidence vanished');
  assert.equal(fs.existsSync(evidencePath), false);
  bridge.releaseLock(result);
  assert.equal(fs.existsSync(lockPath), false);
});

test('initial unreadable evidence fails closed in hook and manual modes', () => {
  for (const code of ['EACCES', 'EPERM']) {
    const root = tmpRoot();
    const hubRoot = path.join(root, 'hub');
    const lockPath = path.join(hubRoot, 'update.lock');
    const evidencePath = path.join(hubRoot, `update.lock.displaced.${code === 'EACCES' ? 'aaaaaaaa' : 'bbbbbbbb'}-1111-4222-8333-444444444444`);
    const bridge = require('../scripts/toolkit-local-bridge.cjs');
    fs.mkdirSync(hubRoot, { recursive: true });
    writeJson(evidencePath, { created_at: new Date().toISOString(), pid: 777777, token: code });
    const original = fs.readFileSync(evidencePath, 'utf8');
    const testHooks = {
      liveness: () => 'alive',
      readDisplacedEvidence: () => { throw fsError(code); }
    };

    const hookRun = bridge.acquireLock(hubRoot, { hook: true, syncSource: 'repo' }, testHooks);
    assert.equal(hookRun.acquired, false);
    assert.match(hookRun.skipReason, new RegExp(`evidence at .* is unreadable \\(${code}\\); failing closed`));
    assert.equal(fs.existsSync(lockPath), false, `${code}: hook mode must not create a main lock`);
    assert.equal(fs.readFileSync(evidencePath, 'utf8'), original, `${code}: hook mode leaves evidence untouched`);

    assert.throws(
      () => bridge.acquireLock(hubRoot, { hook: false, syncSource: 'repo' }, testHooks),
      new RegExp(`evidence at .* is unreadable \\(${code}\\); failing closed`),
      `${code}: manual mode fails with the precise unreadable-evidence reason`
    );
    assert.equal(fs.existsSync(lockPath), false, `${code}: manual mode must not create a main lock`);
    assert.equal(fs.readFileSync(evidencePath, 'utf8'), original, `${code}: manual mode leaves evidence untouched`);
  }
});

test('evidence that becomes unreadable under marker ownership still blocks creation', () => {
  const root = tmpRoot();
  const hubRoot = path.join(root, 'hub');
  const lockPath = path.join(hubRoot, 'update.lock');
  const evidencePath = path.join(hubRoot, 'update.lock.displaced.bbbbbbbb-2222-4333-8444-555555555555');
  const bridge = require('../scripts/toolkit-local-bridge.cjs');
  fs.mkdirSync(hubRoot, { recursive: true });
  writeJson(evidencePath, { created_at: new Date().toISOString(), pid: 999999, token: 'under-marker' });
  const original = fs.readFileSync(evidencePath, 'utf8');
  let underMarkerUnreadable = false;

  const result = bridge.acquireLock(hubRoot, { hook: true, syncSource: 'repo' }, {
    liveness: () => 'dead',
    afterInitialEvidenceInspect: () => { underMarkerUnreadable = true; },
    readDisplacedEvidence: (fullPath, phase) => {
      if (phase === 'under-marker' && underMarkerUnreadable) throw fsError('EACCES');
      return fs.readFileSync(fullPath, 'utf8');
    }
  });

  assert.equal(result.acquired, false);
  assert.match(result.skipReason, /evidence at .* is unreadable \(EACCES\); failing closed/);
  assert.equal(fs.existsSync(lockPath), false, 'the authoritative under-marker read cannot fail open');
  assert.equal(fs.readFileSync(evidencePath, 'utf8'), original, 'the unreadable evidence remains untouched');
});

test('retirement verification ENOENT permits acquisition only after the evidence genuinely vanished', () => {
  const root = tmpRoot();
  const hubRoot = path.join(root, 'hub');
  const lockPath = path.join(hubRoot, 'update.lock');
  const evidencePath = path.join(hubRoot, 'update.lock.displaced.cccccccc-1111-4222-8333-444444444444');
  const bridge = require('../scripts/toolkit-local-bridge.cjs');
  fs.mkdirSync(hubRoot, { recursive: true });
  writeJson(evidencePath, { created_at: new Date().toISOString(), pid: 999999, token: 'dead-owner' });

  const result = bridge.acquireLock(hubRoot, { hook: true, syncSource: 'repo' }, {
    liveness: () => 'dead',
    readDisplacedEvidence: (fullPath, phase) => {
      if (phase === 'retirement-verification') {
        fs.rmSync(fullPath);
        throw fsError('ENOENT');
      }
      return fs.readFileSync(fullPath, 'utf8');
    }
  });

  assert.equal(result.acquired, true);
  assert.equal(fs.existsSync(evidencePath), false, 'ENOENT corresponds to genuinely absent evidence');
  bridge.releaseLock(result);
  assert.equal(fs.existsSync(lockPath), false);
});

test('unreadable retirement verification fails closed and preserves evidence', () => {
  for (const code of ['EACCES', 'EPERM']) {
    const root = tmpRoot();
    const hubRoot = path.join(root, 'hub');
    const lockPath = path.join(hubRoot, 'update.lock');
    const evidencePath = path.join(hubRoot, `update.lock.displaced.${code === 'EACCES' ? 'dddddddd' : 'eeeeeeee'}-1111-4222-8333-444444444444`);
    const bridge = require('../scripts/toolkit-local-bridge.cjs');
    fs.mkdirSync(hubRoot, { recursive: true });
    writeJson(evidencePath, { created_at: new Date().toISOString(), pid: 999999, token: code });
    const original = fs.readFileSync(evidencePath, 'utf8');

    const result = bridge.acquireLock(hubRoot, { hook: true, syncSource: 'repo' }, {
      liveness: () => 'dead',
      readDisplacedEvidence: (fullPath, phase) => {
        if (phase === 'retirement-verification') throw fsError(code);
        return fs.readFileSync(fullPath, 'utf8');
      }
    });

    assert.equal(result.acquired, false);
    assert.match(result.skipReason, new RegExp(`became unreadable during retirement verification \\(${code}\\)`));
    assert.equal(fs.existsSync(lockPath), false, `${code}: no main lock is created`);
    assert.equal(fs.readFileSync(evidencePath, 'utf8'), original, `${code}: evidence remains untouched`);
  }
});

test('post-rename unreadable evidence is preserved without creating an owned main lock', () => {
  for (const code of ['EACCES', 'EPERM']) {
    const root = tmpRoot();
    const hubRoot = path.join(root, 'hub');
    const lockPath = path.join(hubRoot, 'update.lock');
    const bridge = require('../scripts/toolkit-local-bridge.cjs');
    fs.mkdirSync(hubRoot, { recursive: true });
    writeJson(lockPath, { created_at: new Date().toISOString(), pid: 999999, token: `recoverable-${code}` });
    const original = fs.readFileSync(lockPath, 'utf8');

    const result = bridge.acquireLock(hubRoot, { hook: true, syncSource: 'repo' }, {
      liveness: () => 'dead',
      afterDisplace: () => {
        writeJson(lockPath, { created_at: new Date().toISOString(), pid: 424242, token: 'intruder' });
      },
      readDisplacedEvidence: (fullPath, phase) => {
        if (phase === 'post-displacement') throw fsError(code);
        return fs.readFileSync(fullPath, 'utf8');
      }
    });

    assert.equal(result.acquired, false);
    assert.match(result.skipReason, new RegExp(`evidence at .* is unreadable \\(${code}\\); failing closed`));
    assert.equal(readJson(lockPath).token, 'intruder', `${code}: the intruding main lock is not replaced`);
    const evidenceFiles = fs.readdirSync(hubRoot).filter((entry) => /^update\.lock\.displaced\.[0-9a-f-]+$/i.test(entry));
    assert.equal(evidenceFiles.length, 1, `${code}: the unreadable displaced path is preserved`);
    assert.equal(fs.readFileSync(path.join(hubRoot, evidenceFiles[0]), 'utf8'), original, `${code}: evidence bytes are untouched`);
  }
});

test('unreadable evidence directory enumeration fails closed', () => {
  for (const mode of ['hook', 'manual']) {
    const root = tmpRoot();
    const hubRoot = path.join(root, 'hub');
    const lockPath = path.join(hubRoot, 'update.lock');
    const evidencePath = path.join(hubRoot, 'update.lock.displaced.ffffffff-1111-4222-8333-444444444444');
    const bridge = require('../scripts/toolkit-local-bridge.cjs');
    fs.mkdirSync(hubRoot, { recursive: true });
    writeJson(evidencePath, { created_at: new Date().toISOString(), pid: 777777, token: mode });
    const original = fs.readFileSync(evidencePath, 'utf8');
    const testHooks = {
      liveness: () => 'alive',
      listDisplacedEvidence: () => { throw fsError('EACCES'); }
    };

    if (mode === 'hook') {
      const result = bridge.acquireLock(hubRoot, { hook: true, syncSource: 'repo' }, testHooks);
      assert.equal(result.acquired, false);
      assert.match(result.skipReason, /evidence cannot be enumerated .* \(EACCES\); failing closed/);
    } else {
      assert.throws(
        () => bridge.acquireLock(hubRoot, { hook: false, syncSource: 'repo' }, testHooks),
        /evidence cannot be enumerated .* \(EACCES\); failing closed/
      );
    }
    assert.equal(fs.existsSync(lockPath), false, `${mode}: enumeration failure must not create a main lock`);
    assert.equal(fs.readFileSync(evidencePath, 'utf8'), original, `${mode}: enumeration failure leaves evidence untouched`);
  }
});

test('dead-owner displaced evidence is retired by exactly one marker owner before acquisition', () => {
  const root = tmpRoot();
  const hubRoot = path.join(root, 'hub');
  const lockPath = path.join(hubRoot, 'update.lock');
  const bridge = require('../scripts/toolkit-local-bridge.cjs');
  fs.mkdirSync(hubRoot, { recursive: true });

  const buildLiveness = (pid) => (Number(pid) === 777777 ? 'alive' : 'dead');
  const evidencePath = buildFailClosedDisplacedEvidence(bridge, hubRoot, lockPath, buildLiveness);
  fs.rmSync(lockPath, { force: true });

  // The displaced owner has since provably died. A owns the marker before its
  // retirement seam runs B, so B must yield to that marker and A alone may
  // retire the generation and acquire.
  const liveness = (pid) => (Number(pid) === process.pid ? 'alive' : 'dead');
  let loser = null;
  const winner = bridge.acquireLock(hubRoot, { hook: true, syncSource: 'repo' }, {
    liveness,
    afterEvidenceInspect: () => {
      if (loser) return;
      loser = bridge.acquireLock(hubRoot, { hook: true, syncSource: 'repo' }, { liveness });
    }
  });

  assert.equal(winner.acquired, true, 'the marker owner retires the evidence and acquires');
  assert.equal(loser.acquired, false, 'the racing contender serializes on the recovery marker');
  assert.match(loser.skipReason, /recovery .* is in progress by live process/);
  assert.equal(fs.existsSync(evidencePath), false, 'the dead-owner evidence generation was retired');
  assert.equal(readJson(lockPath).token, winner.token, 'one final main-lock owner emerges');

  bridge.releaseLock(loser);
  bridge.releaseLock({ acquired: true, lockPath, token: 'forged' });
  assert.equal(fs.existsSync(lockPath), true, 'stale or foreign handles cannot delete the winner');
  bridge.releaseLock(winner);
});

test('displaced evidence replaced after inspection is not deleted and the contender yields', () => {
  const root = tmpRoot();
  const hubRoot = path.join(root, 'hub');
  const lockPath = path.join(hubRoot, 'update.lock');
  const bridge = require('../scripts/toolkit-local-bridge.cjs');
  fs.mkdirSync(hubRoot, { recursive: true });

  const buildLiveness = (pid) => (Number(pid) === 777777 ? 'alive' : 'dead');
  const evidencePath = buildFailClosedDisplacedEvidence(bridge, hubRoot, lockPath, buildLiveness);
  fs.rmSync(lockPath, { force: true });

  const liveness = () => 'dead';
  const result = bridge.acquireLock(hubRoot, { hook: true, syncSource: 'repo' }, {
    liveness,
    afterEvidenceInspect: () => {
      writeJson(evidencePath, { created_at: new Date().toISOString(), pid: 555555, token: 'replaced-generation' });
    }
  });

  assert.equal(result.acquired, false, 'the contender yields when the evidence generation changed');
  assert.match(result.skipReason, /changed while being retired/);
  assert.equal(readJson(evidencePath).token, 'replaced-generation', 'the changed generation is not deleted');
  assert.equal(fs.existsSync(lockPath), false, 'no second writer enters');
});

test('artifact cleanup removes only exact Toolkit tombstone namespaces', () => {
  const root = tmpRoot();
  const hubRoot = path.join(root, 'hub');
  const lockPath = path.join(hubRoot, 'update.lock');
  const bridge = require('../scripts/toolkit-local-bridge.cjs');
  fs.mkdirSync(hubRoot, { recursive: true });

  const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const liveEvidence = path.join(hubRoot, 'update.lock.displaced.aaaa1111-22bb-4ccc-8ddd-eeee5555ffff');
  const spentReclaim = path.join(hubRoot, 'update.lock.recovery.claim-deadbeefdeadbeef');
  const spentRetire = path.join(hubRoot, 'update.lock.displaced.bbbb2222-33cc-4ddd-8eee-ffff66660000.retired-abcdef0123456789');
  const unrelatedSuffix = path.join(hubRoot, 'user-notes.retired-deadbeef');
  const unrelatedFile = path.join(hubRoot, 'unrelated-user-file.txt');
  const unrelatedDirectory = path.join(hubRoot, 'update.lock.displaced.cccc3333-44dd-4eee-8fff-aaaa77771111.retired-0123456789abcdef');
  writeJson(liveEvidence, { created_at: new Date(old).toISOString(), pid: 777777, token: 'live-owner' });
  writeJson(spentReclaim, { created_at: new Date(old).toISOString(), pid: 999998 });
  writeJson(spentRetire, { created_at: new Date(old).toISOString(), pid: 999997 });
  fs.writeFileSync(unrelatedSuffix, 'keep similar suffix\n', 'utf8');
  fs.writeFileSync(unrelatedFile, 'keep unrelated file\n', 'utf8');
  fs.mkdirSync(unrelatedDirectory);
  fs.writeFileSync(path.join(unrelatedDirectory, 'keep.txt'), 'keep unrelated directory\n', 'utf8');
  for (const file of [liveEvidence, spentReclaim, spentRetire, unrelatedSuffix, unrelatedFile, unrelatedDirectory]) {
    fs.utimesSync(file, old, old);
  }

  const liveness = (pid) => (Number(pid) === 777777 ? 'alive' : 'dead');
  const result = bridge.acquireLock(hubRoot, { hook: true, syncSource: 'repo' }, { liveness });

  assert.equal(result.acquired, false, 'the live evidence still blocks after cleanup ran');
  assert.equal(fs.existsSync(liveEvidence), true, 'live displaced evidence is never age-collected');
  assert.equal(fs.existsSync(spentReclaim), false, 'spent reclaim tombstones age out');
  assert.equal(fs.existsSync(spentRetire), false, 'spent retirement tombstones age out');
  assert.equal(fs.readFileSync(unrelatedSuffix, 'utf8'), 'keep similar suffix\n', 'a similar retirement suffix is unrelated and preserved');
  assert.equal(fs.readFileSync(unrelatedFile, 'utf8'), 'keep unrelated file\n', 'an unrelated file is preserved');
  assert.equal(fs.readFileSync(path.join(unrelatedDirectory, 'keep.txt'), 'utf8'), 'keep unrelated directory\n', 'an unrelated directory is preserved even when its name matches the file namespace');
  assert.equal(fs.existsSync(lockPath), false, 'no new writer entered');
});

test('recovery marker release is token-guarded', () => {
  const root = tmpRoot();
  const hubRoot = path.join(root, 'hub');
  const markerPath = path.join(hubRoot, 'update.lock.recovery');
  const bridge = require('../scripts/toolkit-local-bridge.cjs');
  fs.mkdirSync(hubRoot, { recursive: true });
  writeJson(markerPath, { created_at: new Date().toISOString(), pid: process.pid, token: 'winning-recovery' });

  bridge.releaseRecoveryMarker(markerPath, 'forged-token');
  assert.equal(fs.existsSync(markerPath), true, 'a forged token cannot remove the winning marker');
  bridge.releaseRecoveryMarker(markerPath, 'winning-recovery');
  assert.equal(fs.existsSync(markerPath), false, 'the owner token releases its own marker');
});

test('lockOwnerLiveness classifies alive, dead, indeterminate, and unusable PIDs safely', () => {
  const bridge = require('../scripts/toolkit-local-bridge.cjs');

  assert.equal(bridge.lockOwnerLiveness(undefined), 'unknown');
  assert.equal(bridge.lockOwnerLiveness(null), 'unknown');
  assert.equal(bridge.lockOwnerLiveness('not-a-pid'), 'unknown');
  assert.equal(bridge.lockOwnerLiveness(-5), 'unknown');
  assert.equal(bridge.lockOwnerLiveness(0), 'unknown');
  assert.equal(bridge.lockOwnerLiveness(1.5), 'unknown');

  // A lock recording this process's own PID is recoverable leftover state.
  assert.equal(bridge.lockOwnerLiveness(process.pid), 'dead');

  // Injected probes prove each classification without real signals.
  assert.equal(bridge.lockOwnerLiveness(4242, () => {}), 'alive');
  assert.equal(
    bridge.lockOwnerLiveness(4242, () => {
      const error = new Error('no such process');
      error.code = 'ESRCH';
      throw error;
    }),
    'dead'
  );
  // Permission denied is not proof of death: the owner may be alive.
  assert.equal(
    bridge.lockOwnerLiveness(4242, () => {
      const error = new Error('permission denied');
      error.code = 'EPERM';
      throw error;
    }),
    'indeterminate'
  );
  assert.equal(bridge.lockOwnerLiveness(deadTestPid()), 'dead');
});

test('hook mode does not create bridge state before setup', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  const result = run(['--hub', hub, '--hook', '--write', '--sync-source', 'codex-plugin']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(hub), false);
});

test('diagnostic path sanitizer handles bounded synthetic path forms without harming useful text', () => {
  const cases = [
    {
      name: 'clean diagnostic text',
      input: 'validation failed without a path',
      expected: 'validation failed without a path',
      paths: [],
      suffixes: [],
      placeholders: 0
    },
    {
      name: 'unquoted POSIX path',
      input: 'cannot read /synthetic/home/repo/private.json; retry later',
      expected: 'cannot read <private-path>; retry later',
      paths: ['/synthetic/home/repo/private.json'],
      suffixes: ['repo/private.json'],
      placeholders: 1
    },
    {
      name: 'single-quoted POSIX path',
      input: "cannot read '/synthetic/home/repo/private.json'; retry later",
      expected: 'cannot read <private-path>; retry later',
      paths: ['/synthetic/home/repo/private.json'],
      suffixes: ['repo/private.json'],
      placeholders: 1
    },
    {
      name: 'double-quoted POSIX path',
      input: 'cannot read "/synthetic/home/repo/private.json"; retry later',
      expected: 'cannot read <private-path>; retry later',
      paths: ['/synthetic/home/repo/private.json'],
      suffixes: ['repo/private.json'],
      placeholders: 1
    },
    {
      name: 'POSIX path containing spaces',
      input: 'cannot read /synthetic/home/jane doe/repo/private file.json; retry later',
      expected: 'cannot read <private-path>; retry later',
      paths: ['/synthetic/home/jane doe/repo/private file.json'],
      suffixes: ['jane doe/repo/private file.json'],
      placeholders: 1
    },
    {
      name: 'unquoted Windows backslash path',
      input: 'cannot read Z:\\Synthetic\\Jane\\repo\\private.txt; retry later',
      expected: 'cannot read <private-path>; retry later',
      paths: ['Z:\\Synthetic\\Jane\\repo\\private.txt'],
      suffixes: ['Jane\\repo\\private.txt'],
      placeholders: 1
    },
    {
      name: 'Windows forward-slash path',
      input: 'cannot read Z:/Synthetic/Jane/repo/private.txt; retry later',
      expected: 'cannot read <private-path>; retry later',
      paths: ['Z:/Synthetic/Jane/repo/private.txt'],
      suffixes: ['Jane/repo/private.txt'],
      placeholders: 1
    },
    {
      name: 'single-quoted Windows path',
      input: "cannot read 'Z:\\Synthetic\\Jane\\repo\\private.txt'; retry later",
      expected: 'cannot read <private-path>; retry later',
      paths: ['Z:\\Synthetic\\Jane\\repo\\private.txt'],
      suffixes: ['Jane\\repo\\private.txt'],
      placeholders: 1
    },
    {
      name: 'double-quoted Windows path',
      input: 'cannot read "Z:\\Synthetic\\Jane\\repo\\private.txt"; retry later',
      expected: 'cannot read <private-path>; retry later',
      paths: ['Z:\\Synthetic\\Jane\\repo\\private.txt'],
      suffixes: ['Jane\\repo\\private.txt'],
      placeholders: 1
    },
    {
      name: 'Windows path containing spaces',
      input: 'cannot read Z:\\Synthetic Users\\Jane Doe\\repo\\private file.txt; retry later',
      expected: 'cannot read <private-path>; retry later',
      paths: ['Z:\\Synthetic Users\\Jane Doe\\repo\\private file.txt'],
      suffixes: ['Jane Doe\\repo\\private file.txt'],
      placeholders: 1
    },
    {
      name: 'unquoted UNC path',
      input: 'cannot read \\\\synthetic-host\\synthetic-share\\repo\\private.txt; retry later',
      expected: 'cannot read <private-path>; retry later',
      paths: ['\\\\synthetic-host\\synthetic-share\\repo\\private.txt'],
      suffixes: ['synthetic-share\\repo\\private.txt'],
      placeholders: 1
    },
    {
      name: 'quoted forward UNC path',
      input: "cannot read '//synthetic-host/synthetic-share/repo/private.txt'; retry later",
      expected: 'cannot read <private-path>; retry later',
      paths: ['//synthetic-host/synthetic-share/repo/private.txt'],
      suffixes: ['synthetic-share/repo/private.txt'],
      placeholders: 1
    },
    {
      name: 'double-quoted backslash UNC path',
      input: 'cannot read "\\\\synthetic-host\\share name\\repo folder\\private file.txt"; retry later',
      expected: 'cannot read <private-path>; retry later',
      paths: ['\\\\synthetic-host\\share name\\repo folder\\private file.txt'],
      suffixes: ['share name\\repo folder\\private file.txt'],
      placeholders: 1
    },
    {
      name: 'UNC path containing spaces',
      input: 'cannot read \\\\synthetic-host\\share name\\repo folder\\private file.txt; retry later',
      expected: 'cannot read <private-path>; retry later',
      paths: ['\\\\synthetic-host\\share name\\repo folder\\private file.txt'],
      suffixes: ['share name\\repo folder\\private file.txt'],
      placeholders: 1
    },
    {
      name: 'Windows file URI',
      input: 'cannot read file:///Z:/Synthetic/Jane/repo/private.txt; retry later',
      expected: 'cannot read <private-path>; retry later',
      paths: ['file:///Z:/Synthetic/Jane/repo/private.txt'],
      suffixes: ['Jane/repo/private.txt'],
      placeholders: 1
    },
    {
      name: 'POSIX file URI containing spaces',
      input: 'cannot read file:///synthetic/home/jane doe/repo/private.txt; retry later',
      expected: 'cannot read <private-path>; retry later',
      paths: ['file:///synthetic/home/jane doe/repo/private.txt'],
      suffixes: ['jane doe/repo/private.txt'],
      placeholders: 1
    },
    {
      name: 'UNC file URI',
      input: 'cannot read file://synthetic-host/share name/repo/private.txt; retry later',
      expected: 'cannot read <private-path>; retry later',
      paths: ['file://synthetic-host/share name/repo/private.txt'],
      suffixes: ['share name/repo/private.txt'],
      placeholders: 1
    },
    {
      name: 'multiple private paths',
      input: 'copy /synthetic/source/private.txt; then write Z:\\Synthetic Target\\private.txt, if allowed',
      expected: 'copy <private-path>; then write <private-path>, if allowed',
      paths: ['/synthetic/source/private.txt', 'Z:\\Synthetic Target\\private.txt'],
      suffixes: ['source/private.txt', 'Synthetic Target\\private.txt'],
      placeholders: 2
    },
    {
      name: 'path followed by punctuation',
      input: 'failure at /synthetic/home/repo/private.txt, code EACCES',
      expected: 'failure at <private-path>, code EACCES',
      paths: ['/synthetic/home/repo/private.txt'],
      suffixes: ['repo/private.txt'],
      placeholders: 1
    },
    {
      name: 'useful text around an unquoted lock path',
      input: 'lock at Z:\\Synthetic User\\bridge\\update.lock is held by live process 4242',
      expected: 'lock at <private-path> is held by live process 4242',
      paths: ['Z:\\Synthetic User\\bridge\\update.lock'],
      suffixes: ['bridge\\update.lock'],
      placeholders: 1
    },
    {
      name: 'ordinary HTTPS URL stays readable',
      input: 'see https://example.test/docs/setup/path for guidance',
      expected: 'see https://example.test/docs/setup/path for guidance',
      paths: [],
      suffixes: [],
      placeholders: 0
    },
    {
      name: 'option names and relative slash text stay readable',
      input: 'run --audit and compare read/write behavior',
      expected: 'run --audit and compare read/write behavior',
      paths: [],
      suffixes: [],
      placeholders: 0
    },
    {
      name: 'no-path failure output stays unchanged',
      input: 'FAIL: validation failed with code EINVAL.',
      expected: 'FAIL: validation failed with code EINVAL.',
      paths: [],
      suffixes: [],
      placeholders: 0
    }
  ];

  for (const fixture of cases) {
    const sanitized = sanitizeOutputMessage(fixture.input);
    assert.equal(sanitized, fixture.expected, fixture.name);
    assert.equal(
      sanitized.split('<private-path>').length - 1,
      fixture.placeholders,
      `${fixture.name}: placeholder count`
    );
    for (const privatePath of fixture.paths) {
      assert.equal(sanitized.includes(privatePath), false, `${fixture.name}: complete path leaked`);
    }
    for (const suffix of fixture.suffixes) {
      assert.equal(sanitized.includes(suffix), false, `${fixture.name}: path suffix leaked`);
    }
  }
});

test('routine bridge CLI output sanitizes success, hook skip, lock, cleanup warning, and failure paths', () => {
  const root = path.join(tmpRoot(), 'synthetic user home with spaces');
  const tempRoot = path.join(root, 'synthetic temporary root with spaces');
  const hub = path.join(root, 'bridge root with spaces', 'current');
  fs.mkdirSync(tempRoot, { recursive: true });
  const env = isolatedHomeEnv(root, { TEMP: tempRoot, TMP: tempRoot, TMPDIR: tempRoot });

  let result = run(['--hub', hub, '--enable-auto-sync', '--write'], { env });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'Toolkit local bridge sync complete.\n');

  result = run(['--hub', hub, '--audit'], { env });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(parseLastJson(result.stdout).hub_path, path.resolve(hub), 'explicit audit keeps its path field');

  const unsafeHub = process.platform === 'win32'
    ? 'Z:\\Synthetic Private Root\\Jane Doe\\repo\\private file.txt'
    : '/synthetic-private-root/jane doe/repo/private file.txt';
  const unsafeSuffix = process.platform === 'win32'
    ? 'Jane Doe\\repo\\private file.txt'
    : 'jane doe/repo/private file.txt';

  result = run(['--hub', unsafeHub, '--hook', '--write', '--sync-source', 'codex-plugin'], { env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Toolkit local bridge hook skipped: .*<private-path>/);
  assert.equal(result.stdout.includes(unsafeHub), false);
  assert.equal(result.stdout.includes(unsafeSuffix), false);
  assert.match(result.stdout, /must stay under the current user home or temp directory/);

  result = run(['--hub', unsafeHub, '--write'], { env });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /^FAIL: .*<private-path>/);
  assert.equal(result.stderr.includes(unsafeHub), false);
  assert.equal(result.stderr.includes(unsafeSuffix), false);
  assert.match(result.stderr, /must stay under the current user home or temp directory/);

  const lockState = readJson(path.join(hub, 'state.json'));
  lockState.targets.opencode.enabled = true;
  lockState.targets.opencode.explicitly_disabled = false;
  writeJson(path.join(hub, 'state.json'), lockState);
  const lockPath = path.join(path.dirname(hub), 'update.lock');
  writeJson(lockPath, { created_at: new Date().toISOString(), pid: process.pid });
  result = run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'codex-plugin'], { env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Toolkit bridge lock at <private-path> is held by live process .*; skipping sync\./);
  assert.equal(result.stdout.includes(lockPath), false);
  assert.equal(result.stdout.includes('bridge root with spaces'), false);

  const blockedReportDir = path.join(tempRoot, 'ai-agent-toolkit', 'update-reports');
  writeFile(blockedReportDir, 'synthetic directory blocker\n');
  const cleanupHub = path.join(root, 'cleanup warning hub', 'current');
  result = run(['--hub', cleanupHub, '--enable-auto-sync', '--write'], { env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /Toolkit update report cleanup warning: .*<private-path>/);
  assert.equal(result.stderr.includes(blockedReportDir), false);
  assert.equal(result.stderr.includes('synthetic temporary root with spaces'), false);
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

test('agent-rules preflight accepts current managed blocks and ignores literal marker examples', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  const nested = path.join(root, 'nested');
  fs.mkdirSync(nested, { recursive: true });
  const agentsTemplate = fs.readFileSync(
    path.join(repoRoot, 'skills', 'ai-coding-agent-rules', 'repo-local', 'AGENTS.managed.template.md'),
    'utf8'
  );
  writeFile(path.join(root, 'AGENTS.md'), [
    agentsTemplate,
    '',
    'Marker examples:',
    '`<!-- AI-AGENT-TOOLKIT:<source-path>:BEGIN <BLOCK-NAME> v1 -->`',
    '`<!-- AI-AGENT-TOOLKIT:<source-path>:END <BLOCK-NAME> -->`',
    ''
  ].join('\n'));

  const result = runAgentRulesPreflight(
    { hook: true, syncSource: 'codex-plugin' },
    { targetRoot: nested, pluginRoot: repoRoot }
  );
  assert.equal(result.status, 'ok');
  assert.equal(result.targetRoot, root);
  assert.deepEqual(result.findings, []);
});

test('agent-rules preflight stops loudly when a git repo is missing root AGENTS without writing files', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  const nested = path.join(root, 'packages', 'app');
  writeFile(path.join(nested, 'README.md'), '# app\n');
  const before = fs.readdirSync(root).sort();

  const result = runAgentRulesPreflight(
    { hook: true, syncSource: 'codex-plugin' },
    { targetRoot: nested, pluginRoot: repoRoot }
  );

  assert.equal(result.status, 'needs-attention');
  assert.equal(result.targetRoot, root);
  assert.equal(result.gitRepoDetected, true);
  assert.deepEqual(result.findings.map((finding) => `${finding.file}:${finding.kind}`), ['AGENTS.md:missing']);
  const message = formatAgentRulesPreflight(result);
  assert.match(message, /STOP/);
  assert.match(message, /AGENTS\.md is missing/);
  assert.match(message, /repo-local ai-coding-agent-rules are not installed/);
  assert.match(message, /ask the user whether to install\/repair/i);
  assert.match(message, /proceed without Toolkit repo-local rules/);
  assert.match(message, /No files were changed by this hook/);
  assert.deepEqual(fs.readdirSync(root).sort(), before);
  assert.equal(fs.existsSync(path.join(root, 'AGENTS.md')), false);
  assert.equal(fs.existsSync(path.join(root, 'docs', 'agent-playbooks')), false);
  assert.equal(fs.existsSync(path.join(root, '_agent-toolkit-backups')), false);
  assert.equal(fs.existsSync(path.join(root, '.agent-toolkit-backups')), false);
});

test('Codex SessionStart hook puts the exact missing-AGENTS decision instruction on stdout without target-repo writes', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  const nested = path.join(root, 'packages', 'app');
  writeFile(path.join(nested, 'README.md'), '# app\n');
  const hub = path.join(root, '.test-home', 'hub', 'current');
  writeDisabledHookHub(hub);
  const before = snapshotTree(root);

  const result = run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'codex-plugin'], {
    cwd: nested,
    env: isolatedHomeEnv(path.join(root, '.test-home'), {
      PATH: process.env.PATH,
      PLUGIN_ROOT: repoRoot
    })
  });

  const expectedContext = expectedMissingAgentsContext(root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `${expectedContext}\nToolkit local bridge: auto-sync disabled; run node repo/scripts/toolkit-local-bridge.cjs --audit for status.\n`);
  assert.doesNotMatch(result.stderr, /STOP: Root AGENTS\.md is missing/);
  assert.deepEqual(snapshotTree(root), before);
  assert.equal(fs.existsSync(path.join(root, 'AGENTS.md')), false);
  assert.equal(fs.existsSync(path.join(root, '_agent-toolkit-backups')), false);
  assert.equal(fs.existsSync(path.join(root, '.agent-toolkit-backups')), false);
});

test('Codex SessionStart hook adds no missing-rule STOP instruction for current AGENTS', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  const template = fs.readFileSync(
    path.join(repoRoot, 'skills', 'ai-coding-agent-rules', 'repo-local', 'AGENTS.managed.template.md'),
    'utf8'
  );
  writeFile(path.join(root, 'AGENTS.md'), template);
  const hub = path.join(root, '.test-home', 'hub', 'current');
  writeDisabledHookHub(hub);

  const result = run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'codex-plugin'], {
    cwd: root,
    env: isolatedHomeEnv(path.join(root, '.test-home'), {
      PATH: process.env.PATH,
      PLUGIN_ROOT: repoRoot
    })
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'Toolkit local bridge: auto-sync disabled; run node repo/scripts/toolkit-local-bridge.cjs --audit for status.\n');
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /STOP: Root AGENTS\.md is missing|repo-local ai-coding-agent-rules are not installed/);
});

test('agent-rules preflight reports stale managed block content without writing files', () => {
  const root = tmpRoot();
  const agentsTemplate = fs.readFileSync(
    path.join(repoRoot, 'skills', 'ai-coding-agent-rules', 'repo-local', 'AGENTS.managed.template.md'),
    'utf8'
  );
  writeFile(
    path.join(root, 'AGENTS.md'),
    agentsTemplate.replace('Optimize for correctness, safety, useful progress', 'Optimize for correctness, safety, unusually loud progress')
  );

  const result = runAgentRulesPreflight(
    { hook: true, syncSource: 'codex-plugin' },
    { targetRoot: root, pluginRoot: repoRoot }
  );
  assert.equal(result.status, 'needs-attention');
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].kind, 'stale-block');
  assert.equal(result.findings[0].file, 'AGENTS.md');
  const message = formatAgentRulesPreflight(result);
  assert.match(message, /No files were changed by this hook/);
  assert.match(message, /repair\/refresh Toolkit repo-local rules now/);
  assert.match(message, /proceed without current Toolkit repo-local rules/);
  assert.doesNotMatch(message, /before implementation/);
  assert.equal(fs.existsSync(path.join(root, '_agent-toolkit-backups')), false);
  assert.equal(fs.existsSync(path.join(root, '.agent-toolkit-backups')), false);
});

test('Codex SessionStart hook puts stale and malformed repair decisions on stdout without automatic repair', async (t) => {
  const template = fs.readFileSync(
    path.join(repoRoot, 'skills', 'ai-coding-agent-rules', 'repo-local', 'AGENTS.managed.template.md'),
    'utf8'
  );
  const cases = [
    {
      name: 'stale managed block',
      agents: template.replace('Optimize for correctness, safety, useful progress', 'Optimize for correctness, safety, startup context progress'),
      finding: /managed block GLOBAL-AGENTS\.MD-TEMPLATE differs from the bundled template/
    },
    {
      name: 'malformed managed block',
      agents: '<!-- AI-AGENT-TOOLKIT:_projects/development/ai-coding-agent-rules/_main/_partials/ai-coding-agent-execution.md:BEGIN GLOBAL-AGENTS.MD-TEMPLATE v1 -->\n# broken\n',
      finding: /BEGIN marker without matching END/
    }
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, () => {
      const root = tmpRoot();
      fs.mkdirSync(path.join(root, '.git'), { recursive: true });
      writeFile(path.join(root, 'AGENTS.md'), fixture.agents);
      const hub = path.join(root, '.test-home', 'hub', 'current');
      writeDisabledHookHub(hub);
      const before = snapshotTree(root);

      const result = run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'codex-plugin'], {
        cwd: root,
        env: isolatedHomeEnv(path.join(root, '.test-home'), {
          PATH: process.env.PATH,
          PLUGIN_ROOT: repoRoot
        })
      });

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /^STOP: Toolkit-managed repo-local instruction blocks are stale or broken\./);
      assert.match(result.stdout, /Stop before repository work\./);
      assert.match(result.stdout, /Ask the user whether to repair\/refresh Toolkit repo-local rules now or proceed without current Toolkit repo-local rules\./);
      assert.match(result.stdout, /Do not repair, refresh, create backups, or write anything without the user's decision\./);
      assert.match(result.stdout, fixture.finding);
      assert.match(result.stdout, /No files were changed by this hook\./);
      assert.deepEqual(snapshotTree(root), before);
      assert.equal(fs.existsSync(path.join(root, '_agent-toolkit-backups')), false);
      assert.equal(fs.existsSync(path.join(root, '.agent-toolkit-backups')), false);
    });
  }
});

test('agent-rules preflight keeps broken managed-block warnings as stop-and-ask only', () => {
  const root = tmpRoot();
  writeFile(path.join(root, 'AGENTS.md'), [
    '<!-- AI-AGENT-TOOLKIT:_projects/development/ai-coding-agent-rules/_main/_partials/ai-coding-agent-execution.md:BEGIN GLOBAL-AGENTS.MD-TEMPLATE v1 -->',
    '# broken managed block',
    ''
  ].join('\n'));

  const result = runAgentRulesPreflight(
    { hook: true, syncSource: 'codex-plugin' },
    { targetRoot: root, pluginRoot: repoRoot }
  );
  assert.equal(result.status, 'needs-attention');
  assert.deepEqual(result.findings.map((finding) => `${finding.file}:${finding.kind}`), ['AGENTS.md:broken-marker']);
  const message = formatAgentRulesPreflight(result);
  assert.match(message, /No files were changed by this hook/);
  assert.match(message, /Stop before repository work/);
  assert.match(message, /proceed without current Toolkit repo-local rules/);
  assert.equal(fs.existsSync(path.join(root, '_agent-toolkit-backups')), false);
  assert.equal(fs.existsSync(path.join(root, '.agent-toolkit-backups')), false);
});

test('agent-rules preflight does not describe a non-git directory as a Git repo missing root AGENTS', () => {
  const root = tmpRoot();
  const result = runAgentRulesPreflight(
    { hook: true, syncSource: 'codex-plugin' },
    { targetRoot: root, pluginRoot: repoRoot }
  );
  const message = formatAgentRulesPreflight(result);

  assert.equal(result.gitRepoDetected, false);
  assert.equal(result.gitRoot, '');
  assert.doesNotMatch(message, /this Git repository|Root AGENTS\.md is missing/);
});

test('agent-rules preflight checks Claude shim content in Claude hook mode', () => {
  const root = tmpRoot();
  const templateDir = path.join(repoRoot, 'skills', 'ai-coding-agent-rules', 'repo-local');
  writeFile(path.join(root, 'AGENTS.md'), fs.readFileSync(path.join(templateDir, 'AGENTS.managed.template.md'), 'utf8'));
  writeFile(path.join(root, 'CLAUDE.md'), fs.readFileSync(path.join(templateDir, 'CLAUDE.shim.template.md'), 'utf8').replace('@AGENTS.md', '@./AGENTS.md'));

  const result = runAgentRulesPreflight(
    { hook: true, syncSource: 'claude-plugin' },
    { targetRoot: root, pluginRoot: repoRoot }
  );
  assert.equal(result.status, 'needs-attention');
  assert.deepEqual(result.findings.map((finding) => `${finding.file}:${finding.kind}`), ['CLAUDE.md:stale-block']);
});

test('hook mode runs passive agent-rules preflight before bridge no-op return', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  const agentsTemplate = fs.readFileSync(
    path.join(repoRoot, 'skills', 'ai-coding-agent-rules', 'repo-local', 'AGENTS.managed.template.md'),
    'utf8'
  );
  writeFile(
    path.join(root, 'AGENTS.md'),
    agentsTemplate.replace('Optimize for correctness, safety, useful progress', 'Optimize for correctness, safety, startup preflight test progress')
  );

  const result = run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'codex-plugin'], {
    cwd: root,
    env: isolatedHomeEnv(root, {
      PATH: process.env.PATH,
      PLUGIN_ROOT: repoRoot
    })
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Toolkit agent-rules preflight/);
  assert.match(result.stdout, /AGENTS\.md: managed block GLOBAL-AGENTS\.MD-TEMPLATE differs from the bundled template/);
  assert.match(result.stdout, /repair\/refresh Toolkit repo-local rules now/);
  assert.match(result.stdout, /proceed without current Toolkit repo-local rules/);
  assert.doesNotMatch(result.stderr, /Toolkit agent-rules preflight/);
  assert.doesNotMatch(result.stdout, /Toolkit local bridge sync complete\./);
  assert.equal(fs.existsSync(path.join(root, '_agent-toolkit-backups')), false);
  assert.equal(fs.existsSync(path.join(root, '.agent-toolkit-backups')), false);
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
  const reportPath = reportPathFromOutput(result.stdout, hub);
  const report = readLatestReport(hub);
  assert.equal(path.resolve(report.reportPath), path.resolve(reportPath));
  assert.match(report.text, /^# AI Agent Toolkit Update/m);
  assert.match(report.text, new RegExp(`Toolkit updated to commit: \`${updatedCommit}\``));
  assert.match(report.text, new RegExp(`Previous commit: \`${fixture.initialCommit}\``));
  assert.match(report.text, /Running bridge source: `codex-plugin`/);
  assert.equal(report.text.includes(`Running bridge version: \`${expectedBridgeVersion}\``), true);
  assert.match(report.text, /Recorded repo version:/);
  assert.match(report.text, /Recorded Codex plugin version:/);
  assert.match(report.text, /Recorded Claude plugin version:/);
  assert.match(report.text, /Hub reporting version:/);
  assert.match(report.text, /Downgrade enforcement scope: `codex-plugin only`/);
  assert.match(report.text, /- `VERSION\.txt`/);
  assert.match(report.text, /- `skills\/fixture-skill\/SKILL\.md`/);
  assert.match(report.text, /repo update status: `updated`/);
  assert.match(report.text, /hook-light validation: `passed`/);
  assert.match(report.text, /Skipped live n8n systems; not touched\./);
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
  assert.doesNotMatch(result.stdout, /Toolkit local bridge sync complete\./);
  let state = readJson(path.join(hub, 'state.json'));
  assert.equal(state.last_update_report_path || '', '');
  assert.equal(state.last_repo_update_status, 'up-to-date');
  assert.equal(state.last_repo_update_to_commit, fixture.initialCommit);

  result = run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'claude-plugin'], {
    env: isolatedHomeEnv(fixture.root, { PATH: process.env.PATH })
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /Toolkit local bridge sync complete\./);
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
  assert.match(result.stdout, /Toolkit local bridge sync complete\./);
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

test('final report relock uses final target enablement for skipped targets and signature', () => {
  const fixture = createRepoAutoUpdateFixture();
  const hub = path.join(fixture.root, 'hub', 'current');
  const opencodeTarget = path.join(fixture.root, 'final-opencode-skills');
  const env = isolatedHomeEnv(fixture.root, { PATH: process.env.PATH });
  const setup = run([
    '--hub', hub,
    '--enable-repo-auto-update',
    '--repo-path', fixture.repo,
    '--repo-branch', 'main',
    '--repo-remote', fixture.origin,
    '--enable-auto-sync',
    '--write'
  ], { env });
  assert.equal(setup.status, 0, setup.stderr);
  pushRepoToolkitUpdate(fixture, 'final-report-relock-target-state');

  let competingWriter = null;
  let capturedReport = null;
  const result = runBridge([
    '--hub', hub,
    '--hook',
    '--sync-enabled',
    '--write',
    '--sync-source', 'claude-plugin'
  ], {
    beforeFinalReportLock() {
      competingWriter = run([
        '--hub', hub,
        '--sync-enabled',
        '--write',
        '--enable-target', 'opencode',
        '--opencode-target', opencodeTarget,
        '--repo-path', fixture.repo,
        '--sync-source', 'codex-plugin',
        '--suppress-update-report'
      ], { env });
      assert.equal(competingWriter.status, 0, competingWriter.stderr);
    },
    afterFinalReportBuild(details) {
      capturedReport = details;
    }
  });

  assert.ok(competingWriter, 'competing writer must change target enablement before the final report lock');
  assert.equal(result.status, 0);
  assert.ok(capturedReport, 'final report context must be observable after the relock');
  assert.deepEqual(capturedReport.reportContext.skippedTargets, ['ag2']);
  assert.equal(capturedReport.reportSnapshot.state.targets.opencode.enabled, true);
  assert.equal(capturedReport.reportSnapshot.state.targets.ag2.enabled, false);

  const report = readLatestReport(hub);
  assert.doesNotMatch(report.text, /Skipped OpenCode because target is disabled/);
  assert.match(report.text, /Skipped Antigravity 2 because target is disabled/);
  const persisted = readJson(path.join(hub, 'state.json'));
  const signatureContext = {
    cleanup: capturedReport.reportSnapshot.state.last_update_report_cleanup || {},
    ...capturedReport.reportContext
  };
  const expectedSignature = updateReportSignature({
    args: capturedReport.args,
    checksum: capturedReport.reportSnapshot.checksum,
    context: signatureContext
  });
  const staleSignature = updateReportSignature({
    args: capturedReport.args,
    checksum: capturedReport.reportSnapshot.checksum,
    context: { ...signatureContext, skippedTargets: ['opencode', 'ag2'] }
  });
  assert.equal(persisted.last_update_report_signature, expectedSignature);
  assert.notEqual(persisted.last_update_report_signature, staleSignature);
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
  const reportPath = reportPathFromOutput(result.stdout, hub);
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
  assert.match(result.stdout, /Toolkit local bridge sync complete\./);

  const report = readLatestReport(hub);
  assert.match(report.text, /Codex native plugin cache: `stale`/);
  assert.match(report.text, /Action needed: enable Codex plugin auto-refresh in setup, or run `setup toolkit`\./);
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
  assert.doesNotMatch(result.stdout, /Toolkit local bridge sync complete\./);
  const repeatedState = readJson(path.join(hub, 'state.json'));
  assert.equal(repeatedState.last_update_report_path, report.reportPath);
  assert.equal(repeatedState.last_update_report_signature, report.state.last_update_report_signature);
});

test('hook report does not ask to enable Codex auto-refresh when it is already enabled', () => {
  const fixture = createRepoAutoUpdateFixture();
  const root = fixture.root;
  const sourceRepo = fixture.repo;
  const stalePluginRoot = path.join(root, 'codex-cache', 'ai-agent-toolkit');
  const hub = path.join(root, 'hub', 'current');

  writeCodexPluginRefreshFixture(sourceRepo);
  writeFile(path.join(stalePluginRoot, 'skills', 'alpha', 'SKILL.md'), 'old alpha cache\n');
  let result = run([
    '--hub', hub,
    '--repo-path', sourceRepo,
    '--write',
    '--enable-auto-sync',
    '--enable-codex-plugin-auto-refresh',
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
  assert.match(result.stdout, /Toolkit local bridge sync complete\./);

  const report = readLatestReport(hub);
  assert.match(report.text, /Action needed: none\./);
  assert.match(report.text, /Codex native plugin cache was auto-refreshed/);
  assert.match(report.text, /Codex native plugin cache: `refreshed`/);
  assert.doesNotMatch(report.text, /Enable Codex plugin auto-refresh/);
  assert.doesNotMatch(report.text, /run `setup toolkit`/);
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
  assert.match(result.stdout, /Toolkit local bridge sync complete\./);
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

test('Codex auto-refresh runs before delegated target sync failure', () => {
  const fixture = createRepoAutoUpdateFixture();
  const hub = path.join(fixture.root, 'hub', 'current');
  const stalePluginRoot = path.join(fixture.root, 'codex-cache', 'ai-agent-toolkit');
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

  writeCodexPluginRefreshFixture(fixture.upstream);
  writeFile(path.join(fixture.upstream, 'repo', 'scripts', 'toolkit-local-bridge.cjs'), [
    '#!/usr/bin/env node',
    "'use strict';",
    "console.error('Refusing downgrade: delegated fixture is intentionally older than hub state');",
    'process.exit(42);',
    ''
  ].join('\n'));
  git(fixture.upstream, ['add', '.']);
  git(fixture.upstream, ['commit', '-m', 'refresh codex cache but fail delegated sync']);
  git(fixture.upstream, ['push', 'origin', 'main']);

  result = run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'codex-plugin'], {
    env: isolatedHomeEnv(fixture.root, {
      PATH: process.env.PATH,
      PLUGIN_ROOT: stalePluginRoot
    })
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Toolkit local bridge sync complete\./);
  assert.match(result.stdout, /delegated repo sync failed/);
  assert.deepEqual(
    verifyInstalledCacheFreshness(stalePluginRoot, fixture.repo),
    [],
    'auto-refresh should still update the Codex plugin cache before delegated sync failure is reported'
  );

  const report = readLatestReport(hub);
  assert.match(report.text, /Codex native plugin cache was auto-refreshed/);
  assert.match(report.text, /Codex native plugin cache: `refreshed`/);
  assert.match(report.text, /target sync status: `failed`/);
  assert.match(report.text, /warning\/error: `delegated repo sync failed:/);
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

test('active no-target writes persist each source independently without requiring a report', () => {
  const fixture = createActiveNoTargetFixture('codex-plugin');
  let state = readJson(path.join(fixture.hub, 'state.json'));
  assert.deepEqual(state.bridge_versions_by_source, { 'codex-plugin': expectedBridgeVersion });
  state.update_report_enabled = false;
  writeJson(path.join(fixture.hub, 'state.json'), state);

  let result = runFixtureBridge(fixture, [
    '--hub', fixture.hub,
    '--hook',
    '--sync-enabled',
    '--write',
    '--sync-source', 'claude-plugin'
  ]);
  assert.equal(result.status, 0);
  assert.ok(result.audit);
  state = readJson(path.join(fixture.hub, 'state.json'));
  assert.deepEqual(state.bridge_versions_by_source, {
    'codex-plugin': expectedBridgeVersion,
    'claude-plugin': expectedBridgeVersion
  });
  assert.deepEqual(result.audit.bridge_versions_by_source, state.bridge_versions_by_source);
  assert.equal(state.hub_version, expectedBridgeVersion);
  assert.equal(state.last_update_report_path || '', '');
  assert.equal(fs.existsSync(path.join(fixture.temp, 'ai-agent-toolkit', 'update-reports')), false);

  state.update_report_enabled = true;
  state.last_update_report_path = 'existing-report.md';
  state.last_update_report_signature = 'a'.repeat(64);
  writeJson(path.join(fixture.hub, 'state.json'), state);
  result = runFixtureBridge(fixture, [
    '--hub', fixture.hub,
    '--sync-enabled',
    '--write',
    '--sync-source', 'repo'
  ]);
  assert.equal(result.status, 0);
  state = readJson(path.join(fixture.hub, 'state.json'));
  assert.equal(state.bridge_versions_by_source.repo, expectedBridgeVersion);
  assert.deepEqual(result.audit.bridge_versions_by_source, state.bridge_versions_by_source);
  assert.equal(state.last_update_report_path, 'existing-report.md');
  assert.equal(state.last_update_report_signature, 'a'.repeat(64));

  result = runFixtureBridge(fixture, [
    '--hub', fixture.hub,
    '--hook',
    '--sync-enabled',
    '--write',
    '--sync-source', 'repo',
    '--suppress-update-report'
  ]);
  assert.equal(result.status, 0);
  state = readJson(path.join(fixture.hub, 'state.json'));
  assert.deepEqual(result.audit.bridge_versions_by_source, state.bridge_versions_by_source);
  assert.equal(state.last_update_report_signature, 'a'.repeat(64));

  delete state.bridge_versions_by_source['codex-plugin'];
  writeJson(path.join(fixture.hub, 'state.json'), state);
  result = runFixtureBridge(fixture, [
    '--hub', fixture.hub,
    '--hook',
    '--sync-enabled',
    '--write',
    '--sync-source', 'codex-plugin'
  ]);
  assert.equal(result.status, 0);
  const firstCodexState = readJson(path.join(fixture.hub, 'state.json'));
  assert.deepEqual(firstCodexState.bridge_versions_by_source, {
    repo: expectedBridgeVersion,
    'codex-plugin': expectedBridgeVersion,
    'claude-plugin': expectedBridgeVersion
  });
  assert.deepEqual(result.audit.bridge_versions_by_source, firstCodexState.bridge_versions_by_source);
  assert.equal(firstCodexState.last_update_report_path, 'existing-report.md');
  assert.equal(firstCodexState.last_update_report_signature, 'a'.repeat(64));

  result = runFixtureBridge(fixture, [
    '--hub', fixture.hub,
    '--hook',
    '--sync-enabled',
    '--write',
    '--sync-source', 'codex-plugin'
  ]);
  assert.equal(result.status, 0);
  const repeatedState = readJson(path.join(fixture.hub, 'state.json'));
  assert.deepEqual(repeatedState.bridge_versions_by_source, firstCodexState.bridge_versions_by_source);
  assert.equal(repeatedState.hub_version, firstCodexState.hub_version);
  assert.deepEqual(repeatedState.targets, firstCodexState.targets);
  assert.deepEqual(result.audit.bridge_versions_by_source, repeatedState.bridge_versions_by_source);

  delete repeatedState.bridge_versions_by_source['claude-plugin'];
  writeJson(path.join(fixture.hub, 'state.json'), repeatedState);
  result = runFixtureBridge(fixture, [
    '--hub', fixture.hub,
    '--hook',
    '--write',
    '--sync-source', 'claude-plugin'
  ]);
  assert.equal(result.status, 0);
  const hookOnlyState = readJson(path.join(fixture.hub, 'state.json'));
  assert.equal(hookOnlyState.bridge_versions_by_source['claude-plugin'], expectedBridgeVersion);
  assert.deepEqual(result.audit.bridge_versions_by_source, hookOnlyState.bridge_versions_by_source);
  assert.equal(hookOnlyState.last_update_report_signature, 'a'.repeat(64));
  assert.equal(fs.existsSync(path.join(fixture.temp, 'ai-agent-toolkit', 'update-reports')), false);
});

test('active no-target write persists lazy legacy migration', () => {
  const fixture = createActiveNoTargetFixture('codex-plugin');
  const state = readJson(path.join(fixture.hub, 'state.json'));
  delete state.bridge_versions_by_source;
  state.hub_version = '2.4.3';
  state.last_sync_source = 'codex-plugin';
  state.update_report_enabled = false;
  writeJson(path.join(fixture.hub, 'state.json'), state);

  const result = runFixtureBridge(fixture, [
    '--hub', fixture.hub,
    '--hook',
    '--sync-enabled',
    '--write',
    '--sync-source', 'claude-plugin'
  ]);
  assert.equal(result.status, 0);
  const persisted = readJson(path.join(fixture.hub, 'state.json'));
  assert.deepEqual(persisted.bridge_versions_by_source, {
    'codex-plugin': '2.4.3',
    'claude-plugin': expectedBridgeVersion
  });
  assert.equal(persisted.hub_version, expectedBridgeVersion);
  assert.deepEqual(result.audit.bridge_versions_by_source, persisted.bridge_versions_by_source);
});

test('forced same-source no-target downgrade changes only that source and keeps hub watermark', () => {
  const fixture = createActiveNoTargetFixture('claude-plugin');
  const state = readJson(path.join(fixture.hub, 'state.json'));
  state.bridge_versions_by_source = {
    repo: '8.8.8',
    'codex-plugin': '9.9.9',
    'claude-plugin': '7.7.7'
  };
  state.hub_version = '10.0.0';
  state.update_report_enabled = false;
  writeJson(path.join(fixture.hub, 'state.json'), state);

  const result = runFixtureBridge(fixture, [
    '--hub', fixture.hub,
    '--hook',
    '--sync-enabled',
    '--write',
    '--force-downgrade',
    '--sync-source', 'codex-plugin'
  ]);
  assert.equal(result.status, 0);
  const persisted = readJson(path.join(fixture.hub, 'state.json'));
  assert.deepEqual(persisted.bridge_versions_by_source, {
    repo: '8.8.8',
    'codex-plugin': expectedBridgeVersion,
    'claude-plugin': '7.7.7'
  });
  assert.equal(persisted.hub_version, '10.0.0');
  assert.deepEqual(result.audit.bridge_versions_by_source, persisted.bridge_versions_by_source);
});

test('disabled hook remains no-write and active lock contention reports an unpersisted skip', () => {
  const fixture = createActiveNoTargetFixture('codex-plugin');
  let state = readJson(path.join(fixture.hub, 'state.json'));
  state.auto_sync_enabled = false;
  state.repo_auto_update_enabled = false;
  writeJson(path.join(fixture.hub, 'state.json'), state);
  const statePath = path.join(fixture.hub, 'state.json');
  const disabledBytes = fs.readFileSync(statePath);

  let result = run([
    '--hub', fixture.hub,
    '--hook',
    '--sync-enabled',
    '--write',
    '--sync-source', 'claude-plugin'
  ], { env: fixture.env });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fs.readFileSync(statePath), disabledBytes);
  assert.match(result.stdout, /auto-sync disabled/);

  state = readJson(statePath);
  state.auto_sync_enabled = true;
  writeJson(statePath, state);
  const lockPath = path.join(path.dirname(fixture.hub), 'update.lock');
  writeJson(lockPath, { created_at: new Date().toISOString(), pid: process.pid });
  result = run([
    '--hub', fixture.hub,
    '--hook',
    '--sync-enabled',
    '--write',
    '--sync-source', 'claude-plugin'
  ], { env: fixture.env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /lock at <private-path>.*held by live process.*skipping sync/i);
  assert.equal(readJson(statePath).bridge_versions_by_source['claude-plugin'], undefined);
  fs.rmSync(lockPath, { force: true });
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
  assert.match(result.stdout, /Toolkit local bridge sync complete\./);

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
  assert.match(report.text, /Triggered from: manual or repo run \(`repo`\)\./);
  assert.match(report.text, new RegExp(`Toolkit updated to commit: \`${fixture.toCommit}\``));
  assert.match(report.text, new RegExp(`Previous commit: \`${fixture.fromCommit}\``));
  assert.match(report.text, /Running bridge source: `repo`/);
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
  assert.match(report.text, /Skipped live n8n systems; not touched\./);
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
  assert.equal(result.stdout, 'Toolkit local bridge sync complete.\n');
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
  assert.match(result.stdout, /Toolkit local bridge sync complete\./);
  assert.match(report.text, /Repo: skipped \(configured Toolkit source checkout is dirty\)\./);
  assert.match(report.text, /Action needed: finish or stash changes in the configured Toolkit source checkout, or run `setup toolkit` to use a dedicated clean `main` checkout for startup updates\./);
  assert.match(report.text, new RegExp(`Configured repo path: \`${fixture.repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\``));
  assert.match(report.text, /repo update status: `skipped`/);
  assert.match(report.text, /warning\/error: `dirty working tree`/i);
  assert.match(report.text, /Suggested fix: finish or stash changes in the configured Toolkit source checkout, or run `setup toolkit` to use a dedicated clean `main` checkout for startup updates\./);
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
  assert.match(result.stdout, /Toolkit local bridge sync complete\./);
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
  const preUpdateState = readJson(path.join(hub, 'state.json'));
  preUpdateState.bridge_versions_by_source.repo = '9.9.9';
  preUpdateState.hub_version = '9.9.9';
  writeJson(path.join(hub, 'state.json'), preUpdateState);

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
  assert.equal(state.bridge_versions_by_source.repo, '9.9.9');
  assert.equal(state.bridge_versions_by_source['codex-plugin'], expectedBridgeVersion);
  assert.equal(state.hub_version, '9.9.9');
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
  assert.match(result.stdout, /Toolkit local bridge sync complete\./);
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
  const root = tmpRoot();
  const reportDir = path.join(root, 'reports');
  const reportPath = path.join(reportDir, 'toolkit-update-20990101-010203.md');
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(reportPath, '# report\n', 'utf8');
  const fakeChild = { unref() { calls.push(['unref']); } };
  const opened = openUpdateReport(reportPath, {
    reportDir,
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
    reportDir,
    platform: 'win32',
    spawnImpl() {
      throw new Error('must not spawn for unsafe paths');
    }
  }).ok, false);
  assert.equal(openUpdateReport(reportPath, {
    reportDir,
    platform: 'linux',
    spawnImpl() {
      throw new Error('must not spawn on non-Windows');
    }
  }).ok, false);
});

test('legacy update-report open flags retain failure-only behavior', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  let result = run(['--hub', hub, '--enable-update-report-open', '--write'], {
    env: isolatedHomeEnv(root)
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readJson(path.join(hub, 'state.json')).update_report_open_enabled, false);
  assert.equal(readJson(path.join(hub, 'state.json')).update_report_open_behavior, 'action-required-only');

  result = run(['--hub', hub, '--disable-update-report-open', '--write'], {
    env: isolatedHomeEnv(root)
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readJson(path.join(hub, 'state.json')).update_report_open_enabled, false);
});

test('legacy persisted all-report opening migrates while retention is preserved', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  writeJson(path.join(hub, 'state.json'), {
    schema_version: 1,
    architecture_version: 2,
    hub_version: expectedBridgeVersion,
    update_report_open_enabled: true,
    update_report_retention_days: 14,
    targets: {}
  });
  let result = run(['--hub', hub, '--enable-update-reports', '--write'], {
    env: isolatedHomeEnv(root)
  });
  assert.equal(result.status, 0, result.stderr);
  let state = readJson(path.join(hub, 'state.json'));
  assert.equal(state.update_report_open_enabled, false);
  assert.equal(state.legacy_update_report_open_migrated, true);
  assert.equal(state.update_report_retention_days, 14);

  result = run(['--hub', hub, '--audit'], {
    env: isolatedHomeEnv(root)
  });
  assert.equal(result.status, 0, result.stderr);
  const audit = parseLastJson(result.stdout);
  assert.equal(audit.update_report_open_enabled, false);
  assert.equal(audit.update_report_open_behavior, 'action-required-only');
  assert.equal(audit.legacy_update_report_open_migrated, true);
  assert.equal(audit.update_report_retention_days, 14);
});

test('central report classification opens only actionable reports', () => {
  const base = { repo: {}, nativePluginCache: {}, thirdPartyHookRepair: {}, targetSyncs: [], targetSyncStatus: 'not needed' };
  assert.deepEqual(classifyUpdateReport(base), { meaningful: false, actionable: false, kind: 'no-op' });
  assert.deepEqual(classifyUpdateReport({ ...base, repo: { status: 'updated' } }), { meaningful: true, actionable: false, kind: 'successful-activity' });
  assert.deepEqual(classifyUpdateReport({ ...base, nativePluginCache: { status: 'refreshed' } }), { meaningful: true, actionable: false, kind: 'successful-activity' });
  assert.deepEqual(classifyUpdateReport({ ...base, thirdPartyHookRepair: { status: 'repaired' } }), { meaningful: true, actionable: false, kind: 'successful-activity' });
  assert.equal(classifyUpdateReport({ ...base, repo: { status: 'validation-failed' } }).actionable, true);
  assert.equal(classifyUpdateReport({ ...base, repo: { status: 'skipped', error: 'remote mismatch' } }).actionable, true);
  assert.equal(classifyUpdateReport({ ...base, nativePluginCache: { status: 'refresh-failed' } }).actionable, true);
  assert.equal(classifyUpdateReport({ ...base, thirdPartyHookRepair: { status: 'partial-failed' } }).actionable, true);
  assert.equal(classifyUpdateReport({ ...base, targetSyncStatus: 'failed' }).actionable, true);

  const writes = [];
  const opens = [];
  const invoke = (context) => maybeWriteUpdateReport({
    args: { hook: true, repoUpdateNow: false, openUpdateReport: false, suppressUpdateReport: false, syncSource: 'repo' },
    hubPath: 'unused',
    state: { update_report_enabled: true, last_update_report_signature: '', last_update_report_cleanup: {}, bridge_versions_by_source: {}, hub_version: '', update_report_retention_days: 7 },
    checksum: 'fixture',
    context,
    writeReport(markdown) { writes.push(markdown); return `fixture-${writes.length}.md`; },
    openReport(reportPath) { opens.push(reportPath); return { ok: true }; },
  });
  invoke({ ...base, repo: { status: 'updated' } });
  assert.equal(writes.length, 1);
  assert.equal(opens.length, 0);
  invoke({ ...base, repo: { status: 'validation-failed' } });
  assert.equal(writes.length, 2);
  assert.deepEqual(opens, ['fixture-2.md']);
  invoke(base);
  assert.equal(writes.length, 2);
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

test('update report cleanup caps newest Toolkit reports inside the retention window', () => {
  const root = tmpRoot();
  const reportDir = path.join(root, 'reports');
  fs.mkdirSync(reportDir, { recursive: true });
  const names = [
    'toolkit-update-20200120-010101.md',
    'toolkit-update-20200120-010102.md',
    'toolkit-update-20200120-010103.md',
    'toolkit-update-20200120-010104.md',
    'toolkit-update-20200120-010105.md'
  ];
  names.forEach((name, index) => {
    const filePath = path.join(reportDir, name);
    writeFile(filePath, `# report ${index}\n`);
    const date = new Date(`2020-01-20T00:00:0${index}Z`);
    fs.utimesSync(filePath, date, date);
  });
  const unrelated = path.join(reportDir, 'user-note.md');
  writeFile(unrelated, '# user\n');

  const result = cleanupUpdateReports({
    reportDir,
    expectedDir: reportDir,
    retentionDays: 7,
    maxReports: 2,
    nowMs: new Date('2020-01-20T00:00:10Z').getTime()
  });

  assert.equal(result.deleted_count, 3);
  assert.equal(result.skipped_count, 3);
  assert.equal(result.error_count, 0);
  assert.equal(fs.existsSync(path.join(reportDir, names[0])), false);
  assert.equal(fs.existsSync(path.join(reportDir, names[1])), false);
  assert.equal(fs.existsSync(path.join(reportDir, names[2])), false);
  assert.equal(fs.existsSync(path.join(reportDir, names[3])), true);
  assert.equal(fs.existsSync(path.join(reportDir, names[4])), true);
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

test('replaceDirectoryAtomically retries transient rename EPERM failures', () => {
  const root = tmpRoot();
  const source = path.join(root, 'source');
  const target = path.join(root, 'current');
  writeFile(path.join(source, 'manifest.json'), '{"next":true}\n');
  writeFile(path.join(target, 'manifest.json'), '{"previous":true}\n');

  const originalRenameSync = fs.renameSync;
  let targetRenameAttempts = 0;
  fs.renameSync = function flakyRename(from, to) {
    if (path.resolve(from) === path.resolve(source) &&
      path.resolve(to) === path.resolve(target) &&
      targetRenameAttempts === 0) {
      targetRenameAttempts += 1;
      const error = new Error('simulated Windows file lock');
      error.code = 'EPERM';
      throw error;
    }
    return originalRenameSync.apply(this, arguments);
  };

  try {
    replaceDirectoryAtomically(source, target, { retryDelayMs: 1 });
  } finally {
    fs.renameSync = originalRenameSync;
  }

  assert.equal(targetRenameAttempts, 1);
  assert.equal(fs.readFileSync(path.join(target, 'manifest.json'), 'utf8'), '{"next":true}\n');
  assert.equal(fs.existsSync(source), false);
});

test('replaceDirectoryAtomically falls back to copy when Windows blocks final rename', () => {
  const root = tmpRoot();
  const source = path.join(root, 'source');
  const target = path.join(root, 'current');
  writeFile(path.join(source, 'manifest.json'), '{"next":true}\n');
  writeFile(path.join(source, 'nested', 'state.json'), '{"ok":true}\n');
  writeFile(path.join(target, 'manifest.json'), '{"previous":true}\n');

  const originalRenameSync = fs.renameSync;
  let targetRenameAttempts = 0;
  fs.renameSync = function lockedFinalRename(from, to) {
    if (path.resolve(from) === path.resolve(source) && path.resolve(to) === path.resolve(target)) {
      targetRenameAttempts += 1;
      const error = new Error('simulated persistent Windows file lock');
      error.code = 'EPERM';
      throw error;
    }
    return originalRenameSync.apply(this, arguments);
  };

  try {
    replaceDirectoryAtomically(source, target, { renameAttempts: 2, retryDelayMs: 1 });
  } finally {
    fs.renameSync = originalRenameSync;
  }

  assert.equal(targetRenameAttempts, 2);
  assert.equal(fs.readFileSync(path.join(target, 'manifest.json'), 'utf8'), '{"next":true}\n');
  assert.equal(fs.readFileSync(path.join(target, 'nested', 'state.json'), 'utf8'), '{"ok":true}\n');
  assert.equal(fs.existsSync(source), false);
  assert.deepEqual(
    fs.readdirSync(root).filter((entry) => entry.includes('backup')),
    []
  );
});

test('replaceDirectoryAtomically restores the exact original when post-install verification fails', () => {
  const root = tmpRoot();
  const source = path.join(root, 'source');
  const target = path.join(root, 'current');
  writeFile(path.join(source, 'manifest.json'), '{"next":true}\n');
  writeFile(path.join(target, 'manifest.json'), '{"previous":true}\n');
  const before = snapshotTree(target);

  assert.throws(
    () => replaceDirectoryAtomically(source, target, {
      verifyTarget() {
        throw new Error('simulated verification failure');
      }
    }),
    /simulated verification failure/
  );
  assert.deepEqual(snapshotTree(target), before, 'verification failure must restore the original target bytes');
  assert.deepEqual(fs.readdirSync(root).filter((entry) => entry.includes('backup')), []);
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
  assert.match(codexCommand, /toolkit-codex-session-start\.cjs/);
  assert.match(codexCommand, /\$\{PLUGIN_ROOT\}\/repo\/scripts\/toolkit-codex-session-start\.cjs/);
  assert.doesNotMatch(codexCommand, /toolkit-local-bridge\.cjs/);
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
  assert.deepEqual(Object.keys(claudeHooks.hooks).sort(), ['PreToolUse', 'SessionStart']);
  const claudeAgentHook = claudeHooks.hooks.PreToolUse[0];
  assert.equal(claudeAgentHook.matcher, 'Agent|Task');
  assert.match(claudeAgentHook.hooks[0].command, /\$\{CLAUDE_PLUGIN_ROOT\}\/repo\/scripts\/toolkit-claude-agent-hook\.cjs/);
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
    assert.match(text, /%USERPROFILE%\\\.ai-agent-toolkit\\source\\ai-agent-toolkit\\repo\\scripts\\setup-toolkit\.cjs/, relPath);
    assert.match(text, /\$HOME\/\.ai-agent-toolkit\/source\/ai-agent-toolkit\/repo\/scripts\/setup-toolkit\.cjs/, relPath);
    assert.match(text, /active repo command is bootstrap\/fallback only|active `repo\/scripts\/setup-toolkit\.cjs --execute --profile auto-main` as bootstrap\/fallback only|active repo only as bootstrap\/fallback/i, relPath);
    assert.match(text, /append `--host claude-code`|with `--host claude-code`/i, relPath);
    assert.match(text, /Do not run an active stale verifier after managed setup|Verification after managed setup must use the managed checkout verifier/i, relPath);
    assert.match(text, /active worktree path and commit|active worktree path\/commit/i, relPath);
    assert.match(text, /exact setup script path executed/i, relPath);
    assert.match(text, /dedicated clean `main` checkout as the single update source/, relPath);
    assert.match(text, /%USERPROFILE%\\\.ai-agent-toolkit\\source\\ai-agent-toolkit/, relPath);
    assert.match(text, /~\/\.ai-agent-toolkit\/source\/ai-agent-toolkit/, relPath);
    assert.match(text, /separate from the active Codex or Claude Code worktree, plugin caches, `\.tmp` directories, and temporary marketplace checkouts/i, relPath);
    assert.match(text, /complete compact bank|semantic wizard model/i, relPath);
    assert.match(text, /report auto-open is not an ordinary question|failure-only behavior/i, relPath);
    assert.match(text, /OpenCode.*omit|Omit OpenCode/i, relPath);
    assert.match(text, /Antigravity.*omit|Omit OpenCode, Antigravity/i, relPath);
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
    assert.match(text, /%USERPROFILE%\\\.codex\\plugins\\\.plugin-appserver\\codex\.exe/, relPath);
    assert.match(text, /fail with the repair error/i, relPath);
    assert.match(text, /Do not use Codex to update Claude Code or Claude Code to update Codex/i, relPath);
    assert.match(text, /repo-backed auto-update/i, relPath);
    assert.match(text, /OpenCode and Antigravity 2/i, relPath);
    assert.match(text, /semantic wizard model|One semantic wizard model/i, relPath);
    assert.match(text, /What this controls.*Current:.*Recommended:.*Why:.*Choices:.*consequence.*After applying:/is, relPath);
    assert.match(text, /OpenCode.*omit|Omit OpenCode/i, relPath);
    assert.match(text, /Antigravity.*omit|Omit OpenCode, Antigravity/i, relPath);
    assert.match(text, /OpenCode and Antigravity 2 are opt-in only/i, relPath);
    assert.match(text, /Sync only enabled targets/i, relPath);
    assert.match(text, /fast-forward/i, relPath);
    assert.match(text, /Toolkit-managed update reports\/logs older than 7 days/i, relPath);
    assert.match(text, /official `n8n-io\/skills` plugin setup/i, relPath);
    assert.match(text, /Do not repair or audit temporary marketplace checkout paths/i, relPath);
    assert.match(text, /pre-approval Claude(?: Code)? setup and plan discovery (?:start|launch) no Claude session/i, relPath);
    assert.match(text, /does not prove worker\/checker launch capability/i, relPath);
    assert.match(text, /root-only is the conservative recommendation while strict capability is unverified/i, relPath);
    assert.match(text, /direct.*(?:visible|displayed).*request/i, relPath);
    assert.match(text, /selecting it does not mean it is (?:already )?(?:active|enabled)/i, relPath);
    assert.match(text, /Fable 5 worker.*Opus 4\.8 checker/i, relPath);
    assert.match(text, /verified-current no-maintenance SessionStart identity/i, relPath);
    assert.match(text, /stale installed Toolkit code is never trusted/i, relPath);
    assert.match(text, /Restart-pending, stale, or failed verification leaves root-only active/i, relPath);
    assert.doesNotMatch(text, /offers .* only when the detected CLI supports their real effects/i, relPath);
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
  assert.match(text, /New bridges never use `hub_version` for downgrade enforcement/i);
  assert.match(text, /old Claude Code cache still uses the legacy global `hub_version` guard/i);
  assert.match(text, /selects only the single installed and enabled `n8n-skills@n8n-io` version positively reported by Codex, or the one exact cache candidate backed by explicit config enablement/i);
  assert.match(text, /never guesses by directory or version ordering/i);
  assert.match(text, /unknown or malformed layouts fail closed/i);
  assert.doesNotMatch(text, /automatic repair path is generic for third-party/i);
  assert.doesNotMatch(text, /opt-in also permits repair of unsafe hook launchers in installed third-party/i);
  assert.match(text, /fully resolved on a machine only after every affected native host cache has the fixed bridge/i);
  assert.match(text, /Codex: run `setup toolkit` in Codex/i);
  assert.match(text, /Claude Code: run `setup toolkit --host claude-code`/i);
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
  copySupportedN8nPluginFixture(pluginRoot);

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

test('Codex plugin hook reconciliation repairs only the exact supported n8n cache', () => {
  const root = tmpRoot();
  const codexHome = path.join(root, 'Codex Home With Spaces');
  const toolkitRoot = path.join(codexHome, 'plugins', 'cache', 'ai-agent-toolkit-local', 'ai-agent-toolkit', expectedBridgeVersion);
  const thirdPartyRoot = path.join(codexHome, 'plugins', 'cache', 'example-marketplace', 'generic-third-party', '1.0.0');
  const n8nRoot = path.join(codexHome, 'plugins', 'cache', 'n8n-io', 'n8n-skills', '1.0.1');
  const historicalN8nRoot = path.join(codexHome, 'plugins', 'cache', 'n8n-io', 'n8n-skills', '1.0.0');
  writeGenericPluginHookFixture(toolkitRoot);
  writeGenericPluginHookFixture(thirdPartyRoot);
  copySupportedN8nCrlfPluginFixture(n8nRoot);
  copySupportedN8nPluginFixture(historicalN8nRoot);
  const historicalManifestPath = path.join(historicalN8nRoot, '.codex-plugin', 'plugin.json');
  const historicalManifest = readJson(historicalManifestPath);
  historicalManifest.version = '1.0.0';
  writeJson(historicalManifestPath, historicalManifest);
  const unrelatedBefore = fs.readFileSync(path.join(thirdPartyRoot, 'hooks', 'hooks.json'));
  const historicalBefore = snapshotTree(historicalN8nRoot);

  const result = repairThirdPartyCodexPluginHooks({
    codexHome,
    currentPluginRoot: toolkitRoot,
    windows: true,
    write: true,
    pluginList: codexPluginList([n8nInstalledEntry('1.0.1')])
  });

  assert.equal(result.status, 'repaired');
  assert.deepEqual(result.repaired.map((entry) => entry.plugin_root), [n8nRoot]);
  assert.deepEqual(
    result.skipped.map((entry) => entry.plugin_root).sort(),
    [historicalN8nRoot, thirdPartyRoot, toolkitRoot].sort()
  );

  const repairedHooks = readJson(path.join(n8nRoot, 'hooks', 'hooks.json'));
  const repairedCommand = collectHookCommands(repairedHooks)[0].command;
  assert.match(repairedCommand, /^powershell(?:\.exe)?\s/i);
  assert.match(repairedCommand, /hooks\/run-hook\.ps1/);
  assert.equal(fs.existsSync(path.join(n8nRoot, 'hooks', 'run-hook.ps1')), true);
  assert.deepEqual(fs.readFileSync(path.join(thirdPartyRoot, 'hooks', 'hooks.json')), unrelatedBefore);
  assert.equal(fs.existsSync(path.join(thirdPartyRoot, 'hooks', 'run-hook.ps1')), false);
  assert.deepEqual(snapshotTree(historicalN8nRoot), historicalBefore, 'retained historical n8n cache must not be repaired');

  const toolkitHooks = readJson(path.join(toolkitRoot, 'hooks', 'hooks.json'));
  assert.equal(collectHookCommands(toolkitHooks)[0].command, 'hooks/session-start.sh');

  const repairedBefore = snapshotTree(n8nRoot);
  const second = repairThirdPartyCodexPluginHooks({
    codexHome,
    currentPluginRoot: toolkitRoot,
    windows: true,
    write: true,
    pluginList: codexPluginList([n8nInstalledEntry('1.0.1')])
  });
  assert.equal(second.status, 'not-needed');
  assert.deepEqual(snapshotTree(n8nRoot), repairedBefore, 'current healthy cache must be a byte-idempotent no-op');
});

test('Codex plugin reconciliation supports current n8n 1.0.2 through inspection, repair, and no-op rerun', () => {
  const root = tmpRoot();
  const codexHome = path.join(root, 'Codex Home & [literal] With Spaces');
  const n8nRoot = path.join(codexHome, 'plugins', 'cache', 'n8n-io', 'n8n-skills', '1.0.2');
  copyCurrentSupportedN8nPluginFixture(n8nRoot);
  writeFile(path.join(n8nRoot, 'unrelated & literal.txt'), 'preserve exactly\n');
  const pristine = snapshotTree(n8nRoot);

  const inspection = repairThirdPartyCodexPluginHooks({
    codexHome,
    windows: true,
    write: false,
    pluginList: codexPluginList([n8nInstalledEntry('1.0.2')])
  });
  assert.equal(inspection.status, 'not-needed');
  assert.equal(inspection.selection_status, 'selected');
  assert.deepEqual(inspection.unchanged.map((entry) => entry.classification), ['repair-required']);
  assert.deepEqual(snapshotTree(n8nRoot), pristine, 'inspection and decline must not mutate the selected cache');

  const repair = repairThirdPartyCodexPluginHooks({
    codexHome,
    windows: true,
    write: true,
    pluginList: codexPluginList([n8nInstalledEntry('1.0.2')])
  });
  assert.equal(repair.status, 'repaired');
  assert.deepEqual(fs.readFileSync(path.join(n8nRoot, 'unrelated & literal.txt')), Buffer.from('preserve exactly\n'));
  assert.equal(readJson(path.join(n8nRoot, '.codex-plugin', 'plugin.json')).version, '1.0.2');

  const healthy = snapshotTree(n8nRoot);
  const second = repairThirdPartyCodexPluginHooks({
    codexHome,
    windows: true,
    write: true,
    pluginList: codexPluginList([n8nInstalledEntry('1.0.2')])
  });
  assert.equal(second.status, 'not-needed');
  assert.deepEqual(snapshotTree(n8nRoot), healthy, 'current healthy cache rerun must be byte-identical');
});

test('Codex n8n repair requires exact selected, directory, manifest, and adapter version agreement', () => {
  const cases = [
    { label: 'CLI 1.0.1 with 1.0.2 manifest', directory: '1.0.1', manifest: '1.0.2', config: false },
    { label: 'CLI 1.0.2 with 1.0.1 manifest', directory: '1.0.2', manifest: '1.0.1', config: false },
    { label: 'config directory 1.0.1 with 1.0.2 manifest', directory: '1.0.1', manifest: '1.0.2', config: true }
  ];
  for (const fixture of cases) {
    const root = tmpRoot();
    const codexHome = path.join(root, fixture.label.replace(/[^A-Za-z0-9]+/g, '-'));
    const pluginRoot = path.join(codexHome, 'plugins', 'cache', 'n8n-io', 'n8n-skills', fixture.directory);
    if (fixture.manifest === '1.0.2') copyCurrentSupportedN8nPluginFixture(pluginRoot);
    else copySupportedN8nPluginFixture(pluginRoot);
    if (fixture.config) {
      writeFile(path.join(codexHome, 'config.toml'), [
        '[plugins."n8n-skills@n8n-io"]',
        'enabled = true',
        ''
      ].join('\n'));
    }
    const before = snapshotTree(pluginRoot);
    const result = repairThirdPartyCodexPluginHooks({
      codexHome,
      windows: true,
      write: true,
      pluginList: codexPluginList(fixture.config ? [] : [n8nInstalledEntry(fixture.directory)])
    });
    assert.equal(result.status, 'repair-failed', fixture.label);
    assert.equal(result.code, 'selected-version-mismatch', fixture.label);
    assert.match(result.errors.join('\n'), /versions do not agree exactly/i, fixture.label);
    assert.deepEqual(snapshotTree(pluginRoot), before, `${fixture.label} must leave target bytes unchanged`);
    assert.deepEqual(n8nTransactionArtifacts(pluginRoot), [], `${fixture.label} must create no stage, backup, marker, or lock residue`);
  }
});

test('Codex n8n repair blocks contract or runtime parity drift before cache mutation', () => {
  const root = tmpRoot();
  const pluginRoot = path.join(root, 'codex-home', 'plugins', 'cache', 'n8n-io', 'n8n-skills', '1.0.2');
  copyCurrentSupportedN8nPluginFixture(pluginRoot);
  const before = snapshotTree(pluginRoot);
  const contractPath = path.join(root, 'compatibility-contract.json');
  const contract = readJson(path.join(
    repoRoot,
    '_projects',
    'n8n',
    'skills-plugin-compatibility',
    '_main',
    'compatibility-contract.json'
  ));
  contract.upstream_commit = '0000000000000000000000000000000000000000';
  writeJson(contractPath, contract);
  const entry = {
    plugin_id: 'n8n-skills@n8n-io', version: '1.0.2', selected_version: '1.0.2', directory_version: '1.0.2', plugin_root: pluginRoot
  };
  assert.throws(
    () => reconcileSelectedN8nSkillsCache(entry, { write: true, compatibilityContract: { contractPath } }),
    (error) => error.code === 'compatibility-contract-drift'
  );
  assert.deepEqual(snapshotTree(pluginRoot), before);
  assert.deepEqual(n8nTransactionArtifacts(pluginRoot), []);

  const driftedAdapters = {
    ...N8N_SKILLS_COMPATIBILITY_ADAPTERS,
    '1.0.2': { ...N8N_SKILLS_COMPATIBILITY_ADAPTERS['1.0.2'], repair_profile: 'runtime-only-drift' }
  };
  assert.throws(
    () => reconcileSelectedN8nSkillsCache(entry, {
      write: true,
      compatibilityContract: { adapters: driftedAdapters }
    }),
    (error) => error.code === 'compatibility-contract-drift'
  );
  assert.deepEqual(snapshotTree(pluginRoot), before);
  assert.deepEqual(n8nTransactionArtifacts(pluginRoot), []);
});

test('Codex n8n repair serializes two cross-process writers for one exact cache', async () => {
  const root = tmpRoot();
  const pluginRoot = path.join(root, 'codex-home', 'plugins', 'cache', 'n8n-io', 'n8n-skills', '1.0.2');
  copyCurrentSupportedN8nPluginFixture(pluginRoot);
  writeFile(path.join(pluginRoot, 'unrelated.txt'), 'winner must preserve this exactly\n');
  const childSource = [
    "const path = require('node:path');",
    `const bridge = require(${JSON.stringify(path.join(repoRoot, 'repo', 'scripts', 'toolkit-local-bridge.cjs'))});`,
    'const pluginRoot = process.argv[1];',
    'const result = bridge.reconcileSelectedN8nSkillsCache({',
    "  plugin_id: 'n8n-skills@n8n-io', version: '1.0.2', selected_version: '1.0.2', directory_version: '1.0.2', plugin_root: pluginRoot",
    '}, { write: true, testHooks: {',
    '  afterN8nRepairLockAcquired() { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.argv[2] || 0)); }',
    '} });',
    'process.stdout.write(JSON.stringify({ status: result.status, repaired: Boolean(result.repaired) }));'
  ].join('\n');
  const first = spawn(process.execPath, ['-e', childSource, pluginRoot, '250'], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] });
  const second = spawn(process.execPath, ['-e', childSource, pluginRoot, '0'], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] });
  const outputs = await Promise.all([waitForChild(first), waitForChild(second)]);
  const results = outputs.map((output) => JSON.parse(output.stdout));
  assert.equal(results.filter((result) => result.repaired).length, 1, 'exactly one writer performs the mutation');
  assert.equal(results.filter((result) => !result.repaired && result.status === 'healthy').length, 1, 'the losing writer re-evaluates the winner as healthy');
  const finalState = reconcileSelectedN8nSkillsCache({
    plugin_id: 'n8n-skills@n8n-io',
    version: '1.0.2',
    selected_version: '1.0.2',
    directory_version: '1.0.2',
    plugin_root: pluginRoot
  }, { write: false });
  assert.equal(finalState.status, 'healthy');
  assert.deepEqual(fs.readFileSync(path.join(pluginRoot, 'unrelated.txt')), Buffer.from('winner must preserve this exactly\n'));
  assert.deepEqual(n8nTransactionArtifacts(pluginRoot), [], 'success leaves no stage, backup, marker, or lock residue');
});

test('Codex n8n repair durably recovers every abrupt replacement transition', async () => {
  const crashPoints = [
    'afterN8nRepairTransactionRegistration',
    'afterN8nRepairTargetDisplaced',
    'afterN8nRepairStageInstalled',
    'afterN8nRepairVerification'
  ];
  for (const crashPoint of crashPoints) {
    const root = tmpRoot();
    const codexHome = path.join(root, `codex-home-${crashPoint}`);
    const pluginRoot = path.join(codexHome, 'plugins', 'cache', 'n8n-io', 'n8n-skills', '1.0.2');
    const historicalRoot = path.join(codexHome, 'plugins', 'cache', 'n8n-io', 'n8n-skills', '1.0.1');
    copyCurrentSupportedN8nPluginFixture(pluginRoot);
    copySupportedN8nPluginFixture(historicalRoot);
    writeFile(path.join(pluginRoot, 'unrelated.txt'), `preserve ${crashPoint}\n`);
    const historicalBefore = snapshotTree(historicalRoot);
    const decoy = path.join(path.dirname(pluginRoot), `.decoy-backup-${crashPoint}`);
    fs.mkdirSync(decoy);
    writeFile(path.join(decoy, 'sentinel.txt'), 'unrelated decoy\n');

    await waitForAbruptChild(spawnAbruptN8nRepair(pluginRoot, '1.0.2', crashPoint));
    const recovered = repairThirdPartyCodexPluginHooks({
      codexHome,
      windows: true,
      write: true,
      pluginList: codexPluginList([n8nInstalledEntry('1.0.2')])
    });
    assert.ok(['repaired', 'not-needed'].includes(recovered.status), crashPoint);
    assert.equal(
      reconcileSelectedN8nSkillsCache({
        plugin_id: 'n8n-skills@n8n-io',
        version: '1.0.2',
        selected_version: '1.0.2',
        directory_version: '1.0.2',
        plugin_root: pluginRoot
      }, { write: false }).status,
      'healthy',
      crashPoint
    );
    assert.deepEqual(snapshotTree(historicalRoot), historicalBefore, `${crashPoint} must preserve retained historical caches`);
    assert.equal(fs.readFileSync(path.join(decoy, 'sentinel.txt'), 'utf8'), 'unrelated decoy\n', `${crashPoint} must preserve decoys`);
    assert.deepEqual(n8nTransactionArtifacts(pluginRoot), [], `${crashPoint} must leave no owned transaction residue`);

    const retry = repairThirdPartyCodexPluginHooks({
      codexHome,
      windows: true,
      write: true,
      pluginList: codexPluginList([n8nInstalledEntry('1.0.2')])
    });
    assert.equal(retry.status, 'not-needed', `${crashPoint} retry must be idempotent`);
    assert.deepEqual(n8nTransactionArtifacts(pluginRoot), [], `${crashPoint} retry must leave no residue`);
  }
});

test('Codex n8n interrupted replacement restores exact original bytes when the recorded stage is invalid', async () => {
  const root = tmpRoot();
  const codexHome = path.join(root, 'codex-home');
  const pluginRoot = path.join(codexHome, 'plugins', 'cache', 'n8n-io', 'n8n-skills', '1.0.2');
  copyCurrentSupportedN8nPluginFixture(pluginRoot);
  writeFile(path.join(pluginRoot, 'unrelated.bin'), 'original bytes remain recoverable\n');
  const original = snapshotTree(pluginRoot);

  await waitForAbruptChild(spawnAbruptN8nRepair(pluginRoot, '1.0.2', 'afterN8nRepairTargetDisplaced'));
  assert.equal(fs.existsSync(pluginRoot), false, 'fixture must stop while the canonical target is displaced');
  const owned = readSingleN8nOwnedGeneration(pluginRoot);
  fs.appendFileSync(path.join(owned.record.expected_staging_path, 'plugin', 'hooks', 'session-start.sh'), '# invalidated after crash\n', 'utf8');

  const recovery = recoverInterruptedN8nReplacement({
    codexHome,
    pluginInspection: { ok: true, pluginList: codexPluginList([n8nInstalledEntry('1.0.2')]), errors: [] },
    write: true
  });
  assert.equal(recovery.status, 'original-restored');
  assert.deepEqual(snapshotTree(pluginRoot), original, 'recovery must restore the exact original cache bytes');
  assert.deepEqual(n8nTransactionArtifacts(pluginRoot), [], 'rollback recovery must remove exact owned residue');

  const repaired = repairThirdPartyCodexPluginHooks({
    codexHome,
    windows: true,
    write: true,
    pluginList: codexPluginList([n8nInstalledEntry('1.0.2')])
  });
  assert.equal(repaired.status, 'repaired');
  assert.deepEqual(n8nTransactionArtifacts(pluginRoot), [], 'post-recovery retry must remain residue-free');
});

test('Codex n8n interrupted rollback restores the exact original after the failed target was removed', async () => {
  const root = tmpRoot();
  const codexHome = path.join(root, 'codex-home');
  const pluginRoot = path.join(codexHome, 'plugins', 'cache', 'n8n-io', 'n8n-skills', '1.0.2');
  copyCurrentSupportedN8nPluginFixture(pluginRoot);
  writeFile(path.join(pluginRoot, 'unrelated.txt'), 'original rollback bytes\n');
  const original = snapshotTree(pluginRoot);
  const childSource = [
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    `const bridge = require(${JSON.stringify(path.join(repoRoot, 'repo', 'scripts', 'toolkit-local-bridge.cjs'))});`,
    'const pluginRoot = process.argv[1];',
    'bridge.reconcileSelectedN8nSkillsCache({',
    "  plugin_id: 'n8n-skills@n8n-io', version: '1.0.2', selected_version: '1.0.2', directory_version: '1.0.2', plugin_root: pluginRoot",
    '}, { write: true, testHooks: {',
    "  beforeN8nRepairVerification({ pluginRoot: installed }) { fs.appendFileSync(path.join(installed, 'unrelated.txt'), 'verification drift\\n'); },",
    '  afterN8nRepairFailedTargetRemoved() { process.exit(73); }',
    '} });',
    'process.exit(74);'
  ].join('\n');
  const child = spawn(process.execPath, ['-e', childSource, pluginRoot], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await waitForAbruptChild(child);
  assert.equal(fs.existsSync(pluginRoot), false, 'fixture must stop between failed-target removal and backup restoration');

  const recovery = recoverInterruptedN8nReplacement({
    codexHome,
    pluginInspection: { ok: true, pluginList: codexPluginList([n8nInstalledEntry('1.0.2')]), errors: [] },
    write: true
  });
  assert.equal(recovery.status, 'original-restored');
  assert.deepEqual(snapshotTree(pluginRoot), original, 'interrupted rollback must restore exact original bytes');
  assert.deepEqual(n8nTransactionArtifacts(pluginRoot), [], 'interrupted rollback recovery must leave no residue');
});

test('Codex n8n interrupted verification restores an identity-bound installed directory that drifted', async () => {
  const root = tmpRoot();
  const codexHome = path.join(root, 'codex-home');
  const pluginRoot = path.join(codexHome, 'plugins', 'cache', 'n8n-io', 'n8n-skills', '1.0.2');
  copyCurrentSupportedN8nPluginFixture(pluginRoot);
  writeFile(path.join(pluginRoot, 'unrelated.txt'), 'original verification bytes\n');
  const original = snapshotTree(pluginRoot);
  const childSource = [
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    `const bridge = require(${JSON.stringify(path.join(repoRoot, 'repo', 'scripts', 'toolkit-local-bridge.cjs'))});`,
    'const pluginRoot = process.argv[1];',
    'bridge.reconcileSelectedN8nSkillsCache({',
    "  plugin_id: 'n8n-skills@n8n-io', version: '1.0.2', selected_version: '1.0.2', directory_version: '1.0.2', plugin_root: pluginRoot",
    '}, { write: true, testHooks: {',
    "  beforeN8nRepairVerification({ pluginRoot: installed }) { fs.appendFileSync(path.join(installed, 'unrelated.txt'), 'verification drift\\n'); process.exit(73); }",
    '} });',
    'process.exit(74);'
  ].join('\n');
  const child = spawn(process.execPath, ['-e', childSource, pluginRoot], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await waitForAbruptChild(child);
  assert.equal(fs.existsSync(pluginRoot), true, 'fixture must leave the installed owned directory present');

  const recovery = recoverInterruptedN8nReplacement({
    codexHome,
    pluginInspection: { ok: true, pluginList: codexPluginList([n8nInstalledEntry('1.0.2')]), errors: [] },
    write: true
  });
  assert.equal(recovery.status, 'original-restored');
  assert.deepEqual(snapshotTree(pluginRoot), original, 'interrupted verification must restore exact original bytes');
  assert.deepEqual(n8nTransactionArtifacts(pluginRoot), [], 'interrupted verification recovery must leave no residue');
});

test('Codex n8n recovery cleans an exact original restored before abrupt rollback cleanup', async () => {
  const root = tmpRoot();
  const codexHome = path.join(root, 'codex-home');
  const pluginRoot = path.join(codexHome, 'plugins', 'cache', 'n8n-io', 'n8n-skills', '1.0.2');
  copyCurrentSupportedN8nPluginFixture(pluginRoot);
  const original = snapshotTree(pluginRoot);
  const childSource = [
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    `const bridge = require(${JSON.stringify(path.join(repoRoot, 'repo', 'scripts', 'toolkit-local-bridge.cjs'))});`,
    'const pluginRoot = process.argv[1];',
    'bridge.reconcileSelectedN8nSkillsCache({',
    "  plugin_id: 'n8n-skills@n8n-io', version: '1.0.2', selected_version: '1.0.2', directory_version: '1.0.2', plugin_root: pluginRoot",
    '}, { write: true, testHooks: {',
    "  beforeN8nRepairVerification({ pluginRoot: installed }) { fs.appendFileSync(path.join(installed, 'hooks', 'session-start.sh'), '# verification drift\\n'); },",
    '  afterN8nRepairBackupRestored() { process.exit(73); }',
    '} });',
    'process.exit(74);'
  ].join('\n');
  const child = spawn(process.execPath, ['-e', childSource, pluginRoot], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await waitForAbruptChild(child);
  assert.deepEqual(snapshotTree(pluginRoot), original, 'fixture must already contain the exact restored original');

  const recovery = recoverInterruptedN8nReplacement({
    codexHome,
    pluginInspection: { ok: true, pluginList: codexPluginList([n8nInstalledEntry('1.0.2')]), errors: [] },
    write: true
  });
  assert.equal(recovery.status, 'original-preserved');
  assert.deepEqual(snapshotTree(pluginRoot), original);
  assert.deepEqual(n8nTransactionArtifacts(pluginRoot), [], 'post-restore cleanup recovery must leave no residue');
});

test('Codex n8n interrupted recovery requires the exact registered contract and source-lock bytes', async () => {
  const root = tmpRoot();
  const codexHome = path.join(root, 'codex-home');
  const pluginRoot = path.join(codexHome, 'plugins', 'cache', 'n8n-io', 'n8n-skills', '1.0.2');
  copyCurrentSupportedN8nPluginFixture(pluginRoot);
  const original = snapshotTree(pluginRoot);
  await waitForAbruptChild(spawnAbruptN8nRepair(pluginRoot, '1.0.2', 'afterN8nRepairTransactionRegistration'));

  const contract = readJson(path.join(
    repoRoot,
    '_projects',
    'n8n',
    'skills-plugin-compatibility',
    '_main',
    'compatibility-contract.json'
  ));
  const reformattedContractPath = path.join(root, 'compatibility-contract.json');
  fs.writeFileSync(reformattedContractPath, `${JSON.stringify(contract, null, 4)}\n`, 'utf8');
  assert.throws(
    () => recoverInterruptedN8nReplacement({
      codexHome,
      pluginInspection: { ok: true, pluginList: codexPluginList([n8nInstalledEntry('1.0.2')]), errors: [] },
      write: true,
      compatibilityContract: { contractPath: reformattedContractPath }
    }),
    (error) => error.code === 'recovery-evidence-invalid'
  );
  assert.deepEqual(snapshotTree(pluginRoot), original, 'contract-byte drift must not mutate the canonical target');

  const recovered = recoverInterruptedN8nReplacement({
    codexHome,
    pluginInspection: { ok: true, pluginList: codexPluginList([n8nInstalledEntry('1.0.2')]), errors: [] },
    write: true
  });
  assert.equal(recovered.status, 'original-preserved');
  assert.deepEqual(n8nTransactionArtifacts(pluginRoot), []);
});

test('Codex n8n interrupted recovery fails closed on malformed, mismatched, or ambiguous evidence', async () => {
  for (const mode of ['malformed', 'mismatched']) {
    const root = tmpRoot();
    const codexHome = path.join(root, `${mode}-home`);
    const pluginRoot = path.join(codexHome, 'plugins', 'cache', 'n8n-io', 'n8n-skills', '1.0.2');
    copyCurrentSupportedN8nPluginFixture(pluginRoot);
    const before = snapshotTree(pluginRoot);
    await waitForAbruptChild(spawnAbruptN8nRepair(pluginRoot, '1.0.2', 'afterN8nRepairTransactionRegistration'));
    const owned = readSingleN8nOwnedGeneration(pluginRoot);
    const transactionPath = owned.recordPath.replace(/\.json$/, '.n8n-replacement.json');
    if (mode === 'malformed') fs.writeFileSync(transactionPath, '{not-json', 'utf8');
    else {
      const transaction = readJson(transactionPath);
      transaction.target_identity = '0'.repeat(64);
      writeJson(transactionPath, transaction);
    }
    const result = repairThirdPartyCodexPluginHooks({
      codexHome,
      windows: true,
      write: true,
      pluginList: codexPluginList([n8nInstalledEntry('1.0.2')])
    });
    assert.equal(result.status, 'repair-failed', mode);
    assert.equal(result.code, 'recovery-evidence-invalid', mode);
    assert.deepEqual(snapshotTree(pluginRoot), before, `${mode} evidence must not mutate the canonical target`);
  }

  const ambiguousRoot = tmpRoot();
  const codexHome = path.join(ambiguousRoot, 'ambiguous-home');
  const oldRoot = path.join(codexHome, 'plugins', 'cache', 'n8n-io', 'n8n-skills', '1.0.1');
  const currentRoot = path.join(codexHome, 'plugins', 'cache', 'n8n-io', 'n8n-skills', '1.0.2');
  copySupportedN8nPluginFixture(oldRoot);
  copyCurrentSupportedN8nPluginFixture(currentRoot);
  const oldBefore = snapshotTree(oldRoot);
  const currentBefore = snapshotTree(currentRoot);
  await waitForAbruptChild(spawnAbruptN8nRepair(oldRoot, '1.0.1', 'afterN8nRepairTransactionRegistration'));
  await waitForAbruptChild(spawnAbruptN8nRepair(currentRoot, '1.0.2', 'afterN8nRepairTransactionRegistration'));
  const ambiguous = repairThirdPartyCodexPluginHooks({
    codexHome,
    windows: true,
    write: true,
    pluginList: codexPluginList([n8nInstalledEntry('1.0.2')])
  });
  assert.equal(ambiguous.status, 'repair-failed');
  assert.equal(ambiguous.code, 'ambiguous-recovery');
  assert.deepEqual(snapshotTree(oldRoot), oldBefore);
  assert.deepEqual(snapshotTree(currentRoot), currentBefore);

  const tamperedRoot = tmpRoot();
  const tamperedHome = path.join(tamperedRoot, 'tampered-backup-home');
  const tamperedTarget = path.join(tamperedHome, 'plugins', 'cache', 'n8n-io', 'n8n-skills', '1.0.2');
  copyCurrentSupportedN8nPluginFixture(tamperedTarget);
  await waitForAbruptChild(spawnAbruptN8nRepair(tamperedTarget, '1.0.2', 'afterN8nRepairStageInstalled'));
  const tamperedOwned = readSingleN8nOwnedGeneration(tamperedTarget);
  const tamperedTransaction = readJson(tamperedOwned.recordPath.replace(/\.json$/, '.n8n-replacement.json'));
  fs.appendFileSync(path.join(tamperedTransaction.backup_path, 'hooks', 'session-start.sh'), '# tampered backup\n', 'utf8');
  const healthyWinner = snapshotTree(tamperedTarget);
  const tampered = repairThirdPartyCodexPluginHooks({
    codexHome: tamperedHome,
    windows: true,
    write: true,
    pluginList: codexPluginList([n8nInstalledEntry('1.0.2')])
  });
  assert.equal(tampered.status, 'repair-failed');
  assert.equal(tampered.code, 'recovery-evidence-invalid');
  assert.deepEqual(snapshotTree(tamperedTarget), healthyWinner, 'invalid backup evidence must never remove or roll back a healthy winner');
  assert.equal(fs.existsSync(tamperedTransaction.backup_path), true, 'mismatched backup evidence remains for review');
});

test('Codex n8n target locks recover stale owners and do not block unrelated caches', async () => {
  const root = tmpRoot();
  const cacheRoot = path.join(root, 'codex-home', 'plugins', 'cache', 'n8n-io', 'n8n-skills');
  const firstRoot = path.join(cacheRoot, '1.0.1');
  const secondRoot = path.join(cacheRoot, '1.0.2');
  copySupportedN8nPluginFixture(firstRoot);
  copyCurrentSupportedN8nPluginFixture(secondRoot);
  const staleLock = n8nSkillsTargetLockIdentity(firstRoot);
  writeJson(path.join(staleLock.hubRoot, staleLock.lockName), {
    created_at: '2000-01-01T00:00:00.000Z',
    pid: 2147483647,
    token: 'stale-dead-test-owner',
    bridge_version: expectedBridgeVersion,
    sync_source: 'codex-plugin'
  });
  const recovered = reconcileSelectedN8nSkillsCache({
    plugin_id: 'n8n-skills@n8n-io', version: '1.0.1', selected_version: '1.0.1', directory_version: '1.0.1', plugin_root: firstRoot
  }, { write: true });
  assert.equal(recovered.status, 'repaired');
  assert.deepEqual(n8nTransactionArtifacts(firstRoot), [], 'bounded dead-lock recovery leaves no residue');

  const reusedRoot = path.join(root, 'reused-home', 'plugins', 'cache', 'n8n-io', 'n8n-skills', '1.0.2');
  copyCurrentSupportedN8nPluginFixture(reusedRoot);
  const reusedLock = n8nSkillsTargetLockIdentity(reusedRoot);
  const reusedPidProcess = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { stdio: 'ignore' });
  writeJson(path.join(reusedLock.hubRoot, reusedLock.lockName), {
    created_at: '2000-01-01T00:00:00.000Z',
    pid: reusedPidProcess.pid,
    token: 'orphaned-owner-with-reused-live-pid',
    bridge_version: expectedBridgeVersion,
    sync_source: 'codex-plugin'
  });
  try {
    const reused = reconcileSelectedN8nSkillsCache({
      plugin_id: 'n8n-skills@n8n-io', version: '1.0.2', selected_version: '1.0.2', directory_version: '1.0.2', plugin_root: reusedRoot
    }, { write: true });
    assert.equal(reused.status, 'repaired');
    assert.equal(reusedPidProcess.exitCode, null, 'PID reuse recovery does not signal the unrelated live process');
    assert.deepEqual(n8nTransactionArtifacts(reusedRoot), [], 'expired live-PID lease recovery leaves no residue');
  } finally {
    reusedPidProcess.kill();
  }

  const sleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { stdio: 'ignore' });
  const unrelatedLock = n8nSkillsTargetLockIdentity(firstRoot);
  writeJson(path.join(unrelatedLock.hubRoot, unrelatedLock.lockName), {
    created_at: new Date().toISOString(),
    pid: sleeper.pid,
    token: 'live-unrelated-test-owner',
    bridge_version: expectedBridgeVersion,
    sync_source: 'codex-plugin'
  });
  try {
    const unrelated = reconcileSelectedN8nSkillsCache({
      plugin_id: 'n8n-skills@n8n-io', version: '1.0.2', selected_version: '1.0.2', directory_version: '1.0.2', plugin_root: secondRoot
    }, { write: true });
    assert.equal(unrelated.status, 'repaired');
    assert.equal(fs.existsSync(path.join(unrelatedLock.hubRoot, unrelatedLock.lockName)), true, 'unrelated target lock remains owned and untouched');
    assert.deepEqual(n8nTransactionArtifacts(secondRoot), [], 'unrelated target repair leaves no transaction residue');
  } finally {
    sleeper.kill();
    fs.rmSync(path.join(unrelatedLock.hubRoot, unrelatedLock.lockName), { force: true });
  }

  const retry = reconcileSelectedN8nSkillsCache({
    plugin_id: 'n8n-skills@n8n-io', version: '1.0.1', selected_version: '1.0.1', directory_version: '1.0.1', plugin_root: firstRoot
  }, { write: true });
  assert.equal(retry.status, 'healthy');
  assert.equal(Boolean(retry.repaired), false, 'retry is idempotent');
});

test('Codex n8n repair blocks stale approval and restores exact bytes after verification failure', () => {
  const root = tmpRoot();
  const staleHome = path.join(root, 'stale-home');
  const staleRoot = path.join(staleHome, 'plugins', 'cache', 'n8n-io', 'n8n-skills', '1.0.2');
  copyCurrentSupportedN8nPluginFixture(staleRoot);
  const staleHookPath = path.join(staleRoot, 'hooks', 'session-start.sh');
  const stale = repairThirdPartyCodexPluginHooks({
    codexHome: staleHome,
    windows: true,
    write: true,
    pluginList: codexPluginList([n8nInstalledEntry('1.0.2')]),
    testHooks: {
      beforeN8nRepairRevalidation() {
        fs.appendFileSync(staleHookPath, '# target changed after approval\n', 'utf8');
      }
    }
  });
  assert.equal(stale.status, 'repair-failed');
  assert.match(stale.errors.join('\n'), /approval is stale/i);
  assert.equal(fs.existsSync(path.join(staleRoot, 'hooks', 'run-hook.ps1')), false);

  const lateHome = path.join(root, 'late-stale-home');
  const lateRoot = path.join(lateHome, 'plugins', 'cache', 'n8n-io', 'n8n-skills', '1.0.2');
  copyCurrentSupportedN8nPluginFixture(lateRoot);
  const lateUnrelated = path.join(lateRoot, 'unrelated.txt');
  writeFile(lateUnrelated, 'original\n');
  const late = repairThirdPartyCodexPluginHooks({
    codexHome: lateHome,
    windows: true,
    write: true,
    pluginList: codexPluginList([n8nInstalledEntry('1.0.2')]),
    testHooks: {
      beforeN8nRepairReplacement() {
        fs.appendFileSync(lateUnrelated, 'changed after staging\n', 'utf8');
      }
    }
  });
  assert.equal(late.status, 'repair-failed');
  assert.match(late.errors.join('\n'), /approval is stale/i);
  assert.equal(fs.existsSync(path.join(lateRoot, 'hooks', 'run-hook.ps1')), false);

  const rollbackHome = path.join(root, 'rollback-home');
  const rollbackRoot = path.join(rollbackHome, 'plugins', 'cache', 'n8n-io', 'n8n-skills', '1.0.2');
  copyCurrentSupportedN8nPluginFixture(rollbackRoot);
  const rollbackUnrelated = path.join(rollbackRoot, 'unrelated.txt');
  writeFile(rollbackUnrelated, 'preserve exact bytes\n');
  const before = snapshotTree(rollbackRoot);
  const failed = repairThirdPartyCodexPluginHooks({
    codexHome: rollbackHome,
    windows: true,
    write: true,
    pluginList: codexPluginList([n8nInstalledEntry('1.0.2')]),
    testHooks: {
      beforeN8nRepairVerification({ pluginRoot }) {
        fs.appendFileSync(path.join(pluginRoot, 'unrelated.txt'), 'verification drift\n', 'utf8');
      }
    }
  });
  assert.equal(failed.status, 'repair-failed');
  assert.equal(failed.code, 'verification-failed');
  assert.match(failed.errors.join('\n'), /verification failed/i);
  assert.deepEqual(snapshotTree(rollbackRoot), before, 'verification failure must restore the exact original cache');
  assert.deepEqual(n8nTransactionArtifacts(rollbackRoot), [], 'rollback failure path leaves no stage, backup, marker, or lock residue');
});

test('Codex plugin identity discovery exposes moved n8n hook layouts and fails closed', () => {
  const root = tmpRoot();
  const codexHome = path.join(root, 'Codex Home With Spaces');
  const n8nRoot = path.join(codexHome, 'plugins', 'cache', 'n8n-io', 'n8n-skills', '1.0.1');
  copySupportedN8nPluginFixture(n8nRoot);
  fs.renameSync(path.join(n8nRoot, 'hooks', 'hooks.json'), path.join(n8nRoot, 'hooks', 'hooks-v2.json'));
  const before = snapshotTree(n8nRoot);

  const discovered = discoverCodexPluginHookRoots({ codexHome });
  assert.deepEqual(discovered.roots.map((entry) => entry.plugin_root), [n8nRoot]);

  const result = repairThirdPartyCodexPluginHooks({
    codexHome,
    windows: true,
    write: true,
    pluginList: codexPluginList([n8nInstalledEntry('1.0.1')])
  });
  assert.equal(result.status, 'repair-failed');
  assert.match(result.errors.join('\n'), /malformed|fingerprint|layout|unexpected critical hook/i);
  assert.deepEqual(snapshotTree(n8nRoot), before, 'moved hook layout must fail closed without writes');
});

test('Codex n8n repair rejects every bounded hooks traversal limit before transaction mutation', () => {
  const cases = [
    {
      label: 'depth',
      mutate(pluginRoot) {
        let current = path.join(pluginRoot, 'hooks', 'limit-depth');
        fs.mkdirSync(current);
        for (let index = 0; index < N8N_SKILLS_TREE_LIMITS.max_depth; index += 1) {
          current = path.join(current, `d${index}`);
          fs.mkdirSync(current);
        }
        return () => assert.equal(fs.existsSync(current), true);
      },
      reason: /directory depth/i
    },
    {
      label: 'directory-count',
      mutate(pluginRoot) {
        const baseline = inspectN8nSkillsTree(pluginRoot, N8N_SKILLS_COMPATIBILITY_ADAPTERS['1.0.2']).counts.directories;
        const container = path.join(pluginRoot, 'hooks', 'limit-directories');
        fs.mkdirSync(container);
        const required = N8N_SKILLS_TREE_LIMITS.max_directories - baseline;
        for (let index = 0; index < required; index += 1) fs.mkdirSync(path.join(container, `d${index}`));
        return () => assert.equal(fs.readdirSync(container).length, required);
      },
      reason: /directory count/i
    },
    {
      label: 'file-count',
      mutate(pluginRoot) {
        const baseline = inspectN8nSkillsTree(pluginRoot, N8N_SKILLS_COMPATIBILITY_ADAPTERS['1.0.2']).counts.files;
        const container = path.join(pluginRoot, 'hooks', 'limit-files');
        fs.mkdirSync(container);
        const required = N8N_SKILLS_TREE_LIMITS.max_files - baseline + 1;
        for (let index = 0; index < required; index += 1) fs.closeSync(fs.openSync(path.join(container, `f${index}`), 'wx'));
        return () => assert.equal(fs.readdirSync(container).length, required);
      },
      reason: /regular-file count/i
    },
    {
      label: 'total-bytes',
      mutate(pluginRoot) {
        const container = path.join(pluginRoot, 'hooks', 'limit-total-bytes');
        fs.mkdirSync(container);
        const files = [];
        for (let index = 0; index < 4; index += 1) {
          const filePath = path.join(container, `large${index}.bin`);
          fs.closeSync(fs.openSync(filePath, 'wx'));
          fs.truncateSync(filePath, N8N_SKILLS_TREE_LIMITS.max_file_bytes);
          files.push(filePath);
        }
        return () => files.forEach((filePath) => assert.equal(fs.statSync(filePath).size, N8N_SKILLS_TREE_LIMITS.max_file_bytes));
      },
      reason: /total byte limit/i
    },
    {
      label: 'individual-file-bytes',
      mutate(pluginRoot) {
        const filePath = path.join(pluginRoot, 'hooks', 'oversized.bin');
        fs.closeSync(fs.openSync(filePath, 'wx'));
        fs.truncateSync(filePath, N8N_SKILLS_TREE_LIMITS.max_file_bytes + 1);
        return () => assert.equal(fs.statSync(filePath).size, N8N_SKILLS_TREE_LIMITS.max_file_bytes + 1);
      },
      reason: /regular file exceeds the supported byte limit/i
    },
    {
      label: 'redirected-special-entry',
      mutate(pluginRoot) {
        const external = path.join(path.dirname(path.dirname(path.dirname(path.dirname(pluginRoot)))), 'redirect-target');
        fs.mkdirSync(external, { recursive: true });
        writeFile(path.join(external, 'sentinel.txt'), 'must remain external\n');
        const redirected = path.join(pluginRoot, 'hooks', 'redirected');
        fs.symlinkSync(external, redirected, process.platform === 'win32' ? 'junction' : 'dir');
        return () => assert.equal(fs.readFileSync(path.join(external, 'sentinel.txt'), 'utf8'), 'must remain external\n');
      },
      reason: /symbolic link|junction|redirected/i
    }
  ];

  for (const fixture of cases) {
    const root = tmpRoot();
    const codexHome = path.join(root, fixture.label);
    const pluginRoot = path.join(codexHome, 'plugins', 'cache', 'n8n-io', 'n8n-skills', '1.0.2');
    copyCurrentSupportedN8nPluginFixture(pluginRoot);
    const manifestBefore = fs.readFileSync(path.join(pluginRoot, '.codex-plugin', 'plugin.json'));
    const hooksBefore = fs.readFileSync(path.join(pluginRoot, 'hooks', 'hooks.json'));
    const assertFixtureUnchanged = fixture.mutate(pluginRoot);
    const result = repairThirdPartyCodexPluginHooks({
      codexHome,
      windows: true,
      write: true,
      pluginList: codexPluginList([n8nInstalledEntry('1.0.2')])
    });
    assert.equal(result.status, 'repair-failed', fixture.label);
    assert.match(result.errors.join('\n'), fixture.reason, fixture.label);
    assert.deepEqual(fs.readFileSync(path.join(pluginRoot, '.codex-plugin', 'plugin.json')), manifestBefore, fixture.label);
    assert.deepEqual(fs.readFileSync(path.join(pluginRoot, 'hooks', 'hooks.json')), hooksBefore, fixture.label);
    assert.equal(fs.existsSync(path.join(pluginRoot, 'hooks', 'run-hook.ps1')), false, fixture.label);
    assertFixtureUnchanged();
    assert.deepEqual(n8nTransactionArtifacts(pluginRoot), [], `${fixture.label} must create no stage, backup, lock, or transaction evidence`);
  }
});

test('Codex plugin reconciliation refuses ambiguous current state and cleanly skips no target', () => {
  const root = tmpRoot();
  const codexHome = path.join(root, 'codex-home');
  const supportedRoot = path.join(codexHome, 'plugins', 'cache', 'n8n-io', 'n8n-skills', '1.0.1');
  const unknownRoot = path.join(codexHome, 'plugins', 'cache', 'n8n-io', 'n8n-skills', '1.0.2');
  copySupportedN8nCrlfPluginFixture(supportedRoot);
  copySupportedN8nPluginFixture(unknownRoot);
  const unknownManifestPath = path.join(unknownRoot, '.codex-plugin', 'plugin.json');
  const unknownManifest = readJson(unknownManifestPath);
  unknownManifest.version = '1.0.2';
  writeJson(unknownManifestPath, unknownManifest);
  const supportedBefore = snapshotTree(supportedRoot);
  const unknownBefore = snapshotTree(unknownRoot);

  const ambiguous = repairThirdPartyCodexPluginHooks({
    codexHome,
    windows: true,
    write: true,
    pluginList: codexPluginList([n8nInstalledEntry('1.0.1'), n8nInstalledEntry('1.0.2')])
  });
  assert.equal(ambiguous.status, 'repair-failed');
  assert.equal(ambiguous.selection_status, 'ambiguous-target');
  assert.match(ambiguous.errors.join('\n'), /ambiguous|multiple/i);
  assert.deepEqual(snapshotTree(supportedRoot), supportedBefore, 'ambiguous current state must not repair supported cache');
  assert.deepEqual(snapshotTree(unknownRoot), unknownBefore, 'ambiguous current state must not modify unknown cache');

  const noTarget = repairThirdPartyCodexPluginHooks({
    codexHome,
    windows: true,
    write: true,
    pluginList: codexPluginList([])
  });
  assert.equal(noTarget.status, 'repair-failed');
  assert.match(noTarget.errors.join('\n'), /cannot be proven|ambiguous|omitted/i);
  assert.deepEqual(snapshotTree(supportedRoot), supportedBefore, 'CLI omission must not repair a supported cache without independent proof');
  assert.deepEqual(snapshotTree(unknownRoot), unknownBefore, 'CLI omission must not modify an unknown cache without independent proof');
});

test('Codex n8n config fallback distinguishes enabled, disabled, and unprovable CLI omissions', () => {
  const root = tmpRoot();
  const enabledHome = path.join(root, 'enabled-home');
  const enabledRoot = path.join(enabledHome, 'plugins', 'cache', 'n8n-io', 'n8n-skills', '1.0.1');
  copySupportedN8nCrlfPluginFixture(enabledRoot);
  writeFile(path.join(enabledHome, 'config.toml'), [
    '[plugins."n8n-skills@n8n-io"]',
    'enabled = true',
    ''
  ].join('\n'));

  const enabled = repairThirdPartyCodexPluginHooks({
    codexHome: enabledHome,
    windows: true,
    write: true,
    pluginList: codexPluginList([])
  });
  assert.equal(enabled.status, 'repaired');
  assert.deepEqual(enabled.repaired.map((entry) => entry.plugin_root), [enabledRoot]);
  assert.match(collectHookCommands(readJson(path.join(enabledRoot, 'hooks', 'hooks.json')))[0].command, /^powershell(?:\.exe)?\s/i);
  const enabledAfterRepair = snapshotTree(enabledRoot);
  const enabledAgain = repairThirdPartyCodexPluginHooks({
    codexHome: enabledHome,
    windows: true,
    write: true,
    pluginList: codexPluginList([])
  });
  assert.equal(enabledAgain.status, 'not-needed');
  assert.deepEqual(snapshotTree(enabledRoot), enabledAfterRepair, 'config fallback rerun must be a byte-idempotent no-op');

  const disabledHome = path.join(root, 'disabled-home');
  const disabledRoot = path.join(disabledHome, 'plugins', 'cache', 'n8n-io', 'n8n-skills', '1.0.1');
  copySupportedN8nCrlfPluginFixture(disabledRoot);
  writeFile(path.join(disabledHome, 'config.toml'), [
    '[plugins."n8n-skills@n8n-io"]',
    'enabled = false',
    ''
  ].join('\n'));
  const disabledBefore = snapshotTree(disabledRoot);
  const disabled = repairThirdPartyCodexPluginHooks({
    codexHome: disabledHome,
    windows: true,
    write: true,
    pluginList: codexPluginList([])
  });
  assert.equal(disabled.status, 'not-needed');
  assert.equal(disabled.selection_status, 'disabled');
  assert.equal(disabled.code, 'disabled');
  assert.deepEqual(snapshotTree(disabledRoot), disabledBefore, 'explicitly disabled retained cache must remain untouched');

  const unprovableHome = path.join(root, 'unprovable-home');
  const unprovableRoot = path.join(unprovableHome, 'plugins', 'cache', 'n8n-io', 'n8n-skills', '1.0.1');
  copySupportedN8nPluginFixture(unprovableRoot);
  const unprovableBefore = snapshotTree(unprovableRoot);
  const unprovable = repairThirdPartyCodexPluginHooks({
    codexHome: unprovableHome,
    windows: true,
    write: true,
    pluginList: codexPluginList([])
  });
  assert.equal(unprovable.status, 'repair-failed');
  assert.match(unprovable.errors.join('\n'), /cannot be proven|omitted|config/i);
  assert.deepEqual(snapshotTree(unprovableRoot), unprovableBefore, 'unprovable CLI omission must perform zero writes');
});

test('Codex n8n config fallback never selects arbitrarily across retained versions', () => {
  const root = tmpRoot();
  const codexHome = path.join(root, 'codex-home');
  const supportedRoot = path.join(codexHome, 'plugins', 'cache', 'n8n-io', 'n8n-skills', '1.0.1');
  const unknownRoot = path.join(codexHome, 'plugins', 'cache', 'n8n-io', 'n8n-skills', '1.0.2');
  copySupportedN8nCrlfPluginFixture(supportedRoot);
  copySupportedN8nPluginFixture(unknownRoot);
  const unknownManifestPath = path.join(unknownRoot, '.codex-plugin', 'plugin.json');
  const unknownManifest = readJson(unknownManifestPath);
  unknownManifest.version = '1.0.2';
  writeJson(unknownManifestPath, unknownManifest);
  writeFile(path.join(codexHome, 'config.toml'), [
    '[plugins."n8n-skills@n8n-io"]',
    'enabled = true',
    ''
  ].join('\n'));
  const supportedBefore = snapshotTree(supportedRoot);
  const unknownBefore = snapshotTree(unknownRoot);

  const result = repairThirdPartyCodexPluginHooks({
    codexHome,
    windows: true,
    write: true,
    pluginList: codexPluginList([])
  });
  assert.equal(result.status, 'repair-failed');
  assert.match(result.errors.join('\n'), /multiple|ambiguous|cannot be proven/i);
  assert.deepEqual(snapshotTree(supportedRoot), supportedBefore);
  assert.deepEqual(snapshotTree(unknownRoot), unknownBefore);
});

test('Codex n8n reconciliation cleanly skips when no n8n cache identity exists', () => {
  const root = tmpRoot();
  const codexHome = path.join(root, 'codex-home');
  writeGenericPluginHookFixture(path.join(codexHome, 'plugins', 'cache', 'example-marketplace', 'generic-third-party', '1.0.0'));

  const result = repairThirdPartyCodexPluginHooks({
    codexHome,
    windows: true,
    write: true,
    pluginList: codexPluginList([])
  });
  assert.equal(result.status, 'not-needed');
  assert.equal(result.scanned, 0);
  assert.deepEqual(result.repaired, []);
});

test('Codex maintenance auto-reapplies supported n8n hook repair after refresh', {
  skip: process.platform !== 'win32' ? 'Windows hook repair is Windows-only' : false
}, () => {
  const root = tmpRoot();
  const sourceRepo = createMinimalToolkitSource(root, { alpha: 'alpha hook repair\n' });
  const hub = path.join(root, 'hub', 'current');
  const codexHome = path.join(root, 'codex-home');
  const toolkitRoot = path.join(codexHome, 'plugins', 'cache', 'ai-agent-toolkit-local', 'ai-agent-toolkit', expectedBridgeVersion);
  const thirdPartyRoot = path.join(codexHome, 'plugins', 'cache', 'example-marketplace', 'generic-third-party', '1.0.0');
  const n8nRoot = path.join(codexHome, 'plugins', 'cache', 'n8n-io', 'n8n-skills', '1.0.1');
  const historicalN8nRoot = path.join(codexHome, 'plugins', 'cache', 'n8n-io', 'n8n-skills', '1.0.0');
  writeGenericPluginHookFixture(toolkitRoot);
  writeGenericPluginHookFixture(thirdPartyRoot);
  copySupportedN8nCrlfPluginFixture(n8nRoot);
  copySupportedN8nPluginFixture(historicalN8nRoot);
  const historicalManifestPath = path.join(historicalN8nRoot, '.codex-plugin', 'plugin.json');
  const historicalManifest = readJson(historicalManifestPath);
  historicalManifest.version = '1.0.0';
  writeJson(historicalManifestPath, historicalManifest);
  const fakeCodex = writeFakeCodexPluginList(root, codexPluginList([n8nInstalledEntry('1.0.1')]));
  const unrelatedBefore = fs.readFileSync(path.join(thirdPartyRoot, 'hooks', 'hooks.json'));
  const historicalBefore = snapshotTree(historicalN8nRoot);

  let result = run([
    '--hub', hub,
    '--repo-path', sourceRepo,
    '--write',
    '--enable-auto-sync',
    '--enable-target', 'ag2',
    '--enable-codex-plugin-auto-refresh',
    '--sync-source', 'codex-plugin'
  ], {
    env: isolatedHomeEnv(root, {
      PATH: process.env.PATH,
      CODEX_HOME: codexHome,
      CODEX_TOOLKIT_CODEX_CLI: fakeCodex.commandPath,
      PLUGIN_ROOT: toolkitRoot
    })
  });
  assert.equal(result.status, 0, result.stderr);

  result = run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'codex-plugin'], {
    env: isolatedHomeEnv(root, {
      PATH: process.env.PATH,
      CODEX_HOME: codexHome,
      CODEX_TOOLKIT_CODEX_CLI: fakeCodex.commandPath,
      PLUGIN_ROOT: toolkitRoot
    })
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Toolkit local bridge sync complete\./);

  const report = readLatestReport(hub);
  assert.match(report.text, /Repaired `1` supported n8n Skills Codex plugin hook cache/);
  assert.match(report.text, /n8n-skills@n8n-io/);
  assert.match(report.text, /n8n Skills plugin hook reconciliation: `repaired`/);

  const repairedHooks = readJson(path.join(n8nRoot, 'hooks', 'hooks.json'));
  assert.match(collectHookCommands(repairedHooks)[0].command, /^powershell(?:\.exe)?\s/i);
  assert.deepEqual(fs.readFileSync(path.join(thirdPartyRoot, 'hooks', 'hooks.json')), unrelatedBefore);
  const toolkitHooks = readJson(path.join(toolkitRoot, 'hooks', 'hooks.json'));
  assert.equal(collectHookCommands(toolkitHooks)[0].command, 'hooks/session-start.sh');

  copySupportedN8nCrlfPluginFixture(n8nRoot);
  result = run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'codex-plugin'], {
    env: isolatedHomeEnv(root, { PATH: process.env.PATH, CODEX_HOME: codexHome, CODEX_TOOLKIT_CODEX_CLI: fakeCodex.commandPath, PLUGIN_ROOT: toolkitRoot })
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(collectHookCommands(readJson(path.join(n8nRoot, 'hooks', 'hooks.json')))[0].command, /^powershell(?:\.exe)?\s/i);
  assert.deepEqual(snapshotTree(historicalN8nRoot), historicalBefore, 'startup maintenance must skip retained historical caches');

  const afterRefreshRepair = fs.readFileSync(path.join(n8nRoot, 'hooks', 'hooks.json'));
  result = run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'codex-plugin'], {
    env: isolatedHomeEnv(root, { PATH: process.env.PATH, CODEX_HOME: codexHome, CODEX_TOOLKIT_CODEX_CLI: fakeCodex.commandPath, PLUGIN_ROOT: toolkitRoot })
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fs.readFileSync(path.join(n8nRoot, 'hooks', 'hooks.json')), afterRefreshRepair);
  assert.deepEqual(snapshotTree(historicalN8nRoot), historicalBefore, 'idempotent startup maintenance must leave historical caches unchanged');
});

test('Codex plugin hook reconciliation fails closed on unknown n8n layout without touching cache extras', () => {
  const root = tmpRoot();
  const codexHome = path.join(root, 'Codex Home With Spaces');
  const historicalRoot = path.join(codexHome, 'plugins', 'cache', 'n8n-io', 'n8n-skills', '1.0.1');
  const n8nRoot = path.join(codexHome, 'plugins', 'cache', 'n8n-io', 'n8n-skills', '1.0.3');
  copySupportedN8nPluginFixture(historicalRoot);
  copySupportedN8nPluginFixture(n8nRoot);
  const manifestPath = path.join(n8nRoot, '.codex-plugin', 'plugin.json');
  const manifest = readJson(manifestPath);
  manifest.version = '1.0.3';
  writeJson(manifestPath, manifest);
  const envPath = path.join(n8nRoot, '.env');
  writeFile(envPath, 'fixture sentinel must remain untouched\n');
  const beforeHooks = fs.readFileSync(path.join(n8nRoot, 'hooks', 'hooks.json'));
  const beforeEnv = fs.readFileSync(envPath);
  const historicalBefore = snapshotTree(historicalRoot);

  const result = repairThirdPartyCodexPluginHooks({
    codexHome,
    windows: true,
    write: true,
    pluginList: codexPluginList([n8nInstalledEntry('1.0.3')])
  });

  assert.equal(result.status, 'repair-failed');
  assert.match(result.errors.join('\n'), /unsupported n8n Skills version 1\.0\.3|exact adapter/i);
  assert.deepEqual(fs.readFileSync(path.join(n8nRoot, 'hooks', 'hooks.json')), beforeHooks);
  assert.deepEqual(fs.readFileSync(envPath), beforeEnv);
  assert.equal(fs.existsSync(path.join(n8nRoot, 'hooks', 'run-hook.ps1')), false);
  assert.deepEqual(snapshotTree(historicalRoot), historicalBefore, 'retained supported cache must not be repaired when current is unknown');
});
test('narrow n8n plugin routing keeps workflow, MCP/API, and consumer-helper intents excluded', () => {
  const source = fs.readFileSync(path.join(
    repoRoot,
    '_projects',
    'development',
    'toolkit-local-bridge',
    'curated_output_for_ai',
    'skills',
    'toolkit-setup',
    'SKILL.md'
  ), 'utf8');
  const published = fs.readFileSync(path.join(repoRoot, 'skills', 'toolkit-setup', 'SKILL.md'), 'utf8');
  for (const text of [source, published]) {
    assert.match(text, /repair n8n plugin/i);
    assert.match(text, /fix n8n Skills hooks/i);
    assert.match(text, /inspect n8n plugin compatibility/i);
    assert.match(text, /reconcile installed n8n Skills package/i);
    assert.match(text, /Workflow import\/export and transport/i);
    assert.match(text, /MCP\/API configuration/i);
    assert.match(text, /consumer-helper refresh/i);
    assert.match(text, /routing here never authorizes cache mutation/i);
  }
});
