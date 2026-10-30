'use strict';
require('./toolkit-test-temp-guard.cjs'); // private temp; fails if real update reports appear

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
  cleanupUpdateReports,
  sanitizeOutputMessage,
  replaceDirectoryAtomically,
  runAgentRulesPreflight,
  formatAgentRulesPreflight,
  toolkitSkillPayload,
  payloadChecksum,
  classifyUpdateReport,
  maybeWriteUpdateReport
} = require('../scripts/toolkit-local-bridge.cjs');
const {
  CACHE_FINGERPRINT_PATHS,
  prepareInstalledSessionStart
} = require('../scripts/setup-codex-toolkit-plugin.cjs');
const {
  RECORD_PREFIX,
  createOwnedStagingGeneration
} = require('../scripts/toolkit-staging-generations.cjs');
const {
  repoRoot,
  script,
  expectedBridgeVersion,
  tmpRoot,
  run,
  isolatedHomeEnv,
  installToolkitCopy,
  claudeHookEnv,
  readJson,
  writeJson,
  git,
  writeFile,
  writeDisabledHookHub,
  completeCoreCacheFixture,
  createMinimalToolkitSource,
  readLatestReport,
  writeRepoToolkitFixture,
  commitAll,
  createRepoAutoUpdateFixture,
  currentCommit
} = require('./support/toolkit-local-bridge-fixture.cjs');

// Runs `fn` with this process's home, Claude config folder and Toolkit control root inside the
// isolated `root`. An in-process bridge run then reads the isolated plugin registry, and the install
// check it starts (a child that inherits this environment) reads and prunes only isolated folders.
function withIsolatedClaudeHome(root, fn) {
  const isolated = {
    USERPROFILE: root,
    HOME: root,
    CLAUDE_CONFIG_DIR: path.join(root, '.claude'),
    AI_AGENT_TOOLKIT_CONTROL_ROOT: path.join(root, '.ai-agent-toolkit', 'agent-control')
  };
  const original = Object.fromEntries(Object.keys(isolated).map((key) => [key, process.env[key]]));
  Object.assign(process.env, isolated);
  try { return fn(); }
  finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
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

function parseLastJson(stdout) {
  const start = stdout.indexOf('{');
  assert.notEqual(start, -1, stdout);
  return JSON.parse(stdout.slice(start));
}

function currentBranch(repoPath) {
  return git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
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
  completeCoreCacheFixture(sourceRepo, false);
  fs.cpSync(path.join(repoRoot, 'repo', 'scripts'), path.join(sourceRepo, 'repo', 'scripts'), { recursive: true, force: false });
  fs.cpSync(path.join(repoRoot, '.claude-plugin'), path.join(sourceRepo, '.claude-plugin'), { recursive: true });
  fs.cpSync(
    path.join(repoRoot, '.codex-plugin', 'assets'),
    path.join(sourceRepo, '.codex-plugin', 'assets'),
    { recursive: true }
  );
  fs.cpSync(
    path.join(repoRoot, 'skills', 'repository-agent-rules'),
    path.join(sourceRepo, 'skills', 'repository-agent-rules'),
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
  const env = isolatedHomeEnv(root, { TEMP: temp, TMP: temp, CLAUDE_PLUGIN_ROOT: sourceRepo });
  const setup = run([
    '--hub', hub,
    '--write',
    '--enable-auto-sync',
    '--repo-path', sourceRepo,
    '--sync-source', initialSource
  ], { env });
  assert.equal(setup.status, 0, setup.stderr);
  return { root, hub, sourceRepo, pluginRoot, temp, env };
}

function runFixtureBridge(fixture, args) {
  const original = { PLUGIN_ROOT: process.env.PLUGIN_ROOT, CLAUDE_PLUGIN_ROOT: process.env.CLAUDE_PLUGIN_ROOT };
  if (args.includes('codex-plugin')) process.env.PLUGIN_ROOT = fixture.pluginRoot;
  process.env.CLAUDE_PLUGIN_ROOT = fixture.sourceRepo;
  try {
    return withIsolatedClaudeHome(fixture.root, () => runBridge(args));
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function quoteCommandPart(value) {
  assert.doesNotMatch(value, /"/, 'test command parts must not contain quotes');
  return `"${value}"`;
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
    last_repo_update_to_commit: toCommit
  });
  return { root, sourceRepo, hub, fromCommit, toCommit };
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

function pushRepoToolkitUpdate(fixture, label) {
  writeRepoToolkitFixture(fixture.upstream, label);
  const commit = commitAll(fixture.upstream, `update ${label}`);
  git(fixture.upstream, ['push', 'origin', 'main']);
  return commit;
}

function reportPathFromOutput(stdout, hub) {
  assert.match(String(stdout || ''), /^Toolkit local bridge sync complete\.$/m);
  const reportPath = readJson(path.join(hub, 'state.json')).last_update_report_path;
  assert.ok(reportPath, stdout);
  return reportPath;
}

test('dry-run audit performs no writes and reports the requested settings', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');

  const result = run(['--hub', hub, '--audit', '--enable-auto-sync']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(hub), false, 'dry-run must not create the hub');

  const audit = parseLastJson(result.stdout);
  assert.equal(audit.dry_run, true);
  assert.equal(audit.auto_sync_enabled, true);
  assert.equal(Object.hasOwn(audit, 'targets'), false);
});

test('Antigravity portable skills preview and copy only into an explicit workspace skills folder', () => {
  const root = tmpRoot();
  const projectRoot = path.join(root, 'workspace');
  fs.mkdirSync(projectRoot, { recursive: true });
  const args = ['--copy-antigravity-skills', '--antigravity-project-root', projectRoot];

  let result = run(args);
  assert.equal(result.status, 0, result.stderr);
  const preview = parseLastJson(result.stdout);
  assert.equal(preview.status, 'dry-run');
  assert.equal(preview.target, '.agents/skills');
  assert.equal(preview.wrote, false);
  assert.ok(preview.files_to_copy > 0);
  assert.equal(fs.existsSync(path.join(projectRoot, '.agents')), false, 'preview must not create workspace files');
  assert.equal(fs.existsSync(path.join(root, '.gemini')), false, 'portable preview must not inspect or create Gemini plugin config');

  result = run([...args, '--write']);
  assert.equal(result.status, 0, result.stderr);
  const copied = parseLastJson(result.stdout);
  assert.equal(copied.status, 'copied');
  assert.equal(copied.target, '.agents/skills');
  assert.equal(copied.wrote, true);
  const skillsRoot = path.join(projectRoot, '.agents', 'skills');
  const { INTERNAL_SKILLS } = require('../scripts/toolkit-antigravity-project-skills.cjs');
  assert.deepEqual(targetSkillDirs(skillsRoot), repoSkillNames().filter((name) => !INTERNAL_SKILLS.includes(name)));
  assert.equal(fs.existsSync(path.join(skillsRoot, 'toolkit-setup')), false, 'Toolkit-only skills stay out of the portable copy');
  assert.equal(fs.existsSync(path.join(projectRoot, '.gemini')), false);
  assert.equal(fs.existsSync(path.join(projectRoot, '.opencode')), false);
  assert.equal(fs.existsSync(path.join(root, 'hub')), false, 'portable copying must not mutate bridge state');
});

test('removed Python command options reject instead of invoking a command shim', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  const shim = path.join(root, 'python.cmd');
  const marker = path.join(root, 'shim-ran.txt');
  writeFile(shim, 'echo shim ran > "' + marker + '"\\n');

  const result = run(['--hub', hub, '--audit', '--python-command', shim], {
    env: isolatedHomeEnv(root)
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown argument: --python-command/);
  assert.equal(fs.existsSync(marker), false, 'unsupported command shims must never be invoked');
  assert.equal(fs.existsSync(hub), false, 'unsupported discovery flags must fail before writes');
});

test('sync-enabled command does not create bridge state before setup', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  const result = run(['--hub', hub, '--sync-enabled', '--write']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /nothing configured to sync/);
  assert.equal(fs.existsSync(hub), false);
});

test('skill payload checksum includes Toolkit repo skill files', () => {
  const root = tmpRoot();
  const sourceRepo = createMinimalToolkitSource(root);
  const hub = path.join(root, 'hub', 'current');
  let result = run([
    '--hub', hub,
    '--repo-path', sourceRepo,
    '--write',
    '--enable-auto-sync'
  ], { env: isolatedHomeEnv(root, { PATH: process.env.PATH }) });
  assert.equal(result.status, 0, result.stderr);

  let audit = parseLastJson(run(['--hub', hub, '--audit'], {
    env: isolatedHomeEnv(root, { PATH: process.env.PATH })
  }).stdout);
  const beforeChecksum = audit.checksum;

  writeFile(path.join(sourceRepo, 'skills', 'alpha', 'README.md'), 'alpha changed\n');
  audit = parseLastJson(run(['--hub', hub, '--audit'], {
    env: isolatedHomeEnv(root, { PATH: process.env.PATH })
  }).stdout);
  assert.notEqual(audit.checksum, beforeChecksum);
});

test('sync-enabled records the checksum of changed Toolkit skill contents from the configured repo source', () => {
  const root = tmpRoot();
  const sourceRepo = createMinimalToolkitSource(root);
  const hub = path.join(root, 'hub', 'current');
  let result = run([
    '--hub', hub,
    '--repo-path', sourceRepo,
    '--write',
    '--enable-auto-sync'
  ], { env: isolatedHomeEnv(root, { PATH: process.env.PATH }) });
  assert.equal(result.status, 0, result.stderr);
  const before = readJson(path.join(hub, 'manifest.json')).checksum;

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
  const after = readJson(path.join(hub, 'manifest.json')).checksum;
  assert.notEqual(after, before);
  assert.equal(after, parseLastJson(run(['--hub', hub, '--audit'], {
    env: isolatedHomeEnv(root, { PATH: process.env.PATH })
  }).stdout).checksum);
  assert.equal(fs.existsSync(path.join(hub, 'adapters')), false, 'the hub holds no target adapters');
});

test('cross-source versions do not block native hosts or repo sync', () => {
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

  let result = run(['--hub', hub, '--write', '--enable-auto-sync', '--sync-source', 'claude-plugin'], {
    env: isolatedHomeEnv(root)
  });
  assert.equal(result.status, 0, result.stderr);
  let state = readJson(path.join(hub, 'state.json'));
  assert.deepEqual(state.bridge_versions_by_source, {
    repo: '9.9.9',
    'codex-plugin': '9.8.0',
    'claude-plugin': expectedBridgeVersion
  });
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

  let result = run(['--hub', hub, '--write', '--enable-auto-sync', '--sync-source', 'codex-plugin'], {
    env: isolatedHomeEnv(root)
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Refusing downgrade for sync source codex-plugin/);
  assert.match(result.stderr, /running bridge .* recorded codex-plugin bridge 9\.9\.9/);
  assert.match(result.stderr, /setup toolkit.*Codex/i);
  assert.match(result.stderr, /--force-downgrade.*explicit manual same-source recovery/);

  result = run(['--hub', hub, '--write', '--force-downgrade', '--enable-auto-sync', '--sync-source', 'codex-plugin'], {
    env: isolatedHomeEnv(root)
  });
  assert.equal(result.status, 0, result.stderr);
  const state = readJson(path.join(hub, 'state.json'));
  assert.equal(state.bridge_versions_by_source.repo, '9.8.0');
  assert.equal(state.bridge_versions_by_source['codex-plugin'], expectedBridgeVersion);
  assert.equal(state.bridge_versions_by_source['claude-plugin'], '8.8.8');
  assert.equal(state.hub_version, '9.9.9');
  assert.deepEqual(state.forward_compatible_setting, { keep: true });

  result = run(['--hub', hub, '--write', '--force-downgrade', '--enable-target', 'opencode'], {
    env: isolatedHomeEnv(root)
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown argument: --enable-target/);
});

test('hook mode downgrade skip exits 0 and prints the one-step recovery on stdout', () => {
  const root = tmpRoot();
  installToolkitCopy(root);
  const hub = path.join(root, 'hub', 'current');
  writeJson(path.join(hub, 'state.json'), {
    schema_version: 1,
    architecture_version: 2,
    hub_version: '9.9.9',
    bridge_versions_by_source: { 'claude-plugin': '9.9.9' },
    auto_sync_enabled: true,
    repo_path: repoRoot
  });

  const result = run(
    ['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'claude-plugin'],
    { env: claudeHookEnv(root) }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Toolkit local bridge hook skipped: Refusing downgrade/);
  assert.match(result.stdout, /a newer Toolkit copy, such as a test candidate, ran a session here/);
  assert.match(result.stdout, /--sync-source claude-plugin --force-downgrade/);
  assert.match(result.stdout, /Otherwise run `setup toolkit` to install the newer version/);
  assert.doesNotMatch(result.stdout, /claude plugin update|setup toolkit --host claude-code|restart Claude Code/);
  assert.doesNotMatch(result.stdout, /explicit manual same-source recovery/);
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
  installToolkitCopy(root);
  result = run(['--hub', hub, '--hook', '--write', '--sync-enabled', '--sync-source', 'claude-plugin'], {
    env: claudeHookEnv(root)
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
  const env = isolatedHomeEnv(root);
  const setup = run([
    '--hub', hub,
    '--write',
    '--enable-auto-sync',
    '--repo-path', sourceA,
    '--sync-source', 'repo'
  ], { env });
  assert.equal(setup.status, 0, setup.stderr);
  const codexWriter = run([
    '--hub', hub,
    '--sync-enabled',
    '--write',
    '--repo-path', sourceA,
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
      assert.equal(initialSnapshot.checksum, payloadChecksum(toolkitSkillPayload({ repo_path: sourceA })));
      writerBResult = run([
        '--hub', hub,
        '--sync-enabled',
        '--write',
        '--repo-path', sourceB,
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
  const expectedPayload = toolkitSkillPayload({ repo_path: sourceB });
  assert.equal(finalState.repo_path, path.resolve(sourceB));
  assert.deepEqual(finalState.bridge_versions_by_source, {
    repo: expectedBridgeVersion,
    'codex-plugin': expectedBridgeVersion,
    'claude-plugin': expectedBridgeVersion
  });
  assert.deepEqual(finalState.future_bridge_metadata, { owner: 'future-version', preserve: true });
  assert.equal(manifest.checksum, payloadChecksum(expectedPayload));
  assert.equal(manifest.source_commit, git(sourceB, ['rev-parse', 'HEAD']));
  assert.equal(Object.hasOwn(finalState, 'targets'), false);
  assert.equal(Object.hasOwn(manifest, 'targets'), false);

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
    '--sync-source', 'repo',
    '--suppress-update-report'
  ], { env });
  assert.equal(rerun.status, 0, rerun.stderr);
  const rerunState = readJson(path.join(hub, 'state.json'));
  const rerunManifest = readJson(path.join(hub, 'manifest.json'));
  assert.equal(rerunState.repo_path, path.resolve(sourceB));
  assert.equal(rerunManifest.checksum, firstChecksum);
  assert.deepEqual(rerunState.bridge_versions_by_source, firstVersions);
  assert.deepEqual(rerunState.future_bridge_metadata, { owner: 'future-version', preserve: true });
  assert.deepEqual(fs.readdirSync(hubRoot).filter((name) => residuePattern.test(name)), []);

  const rerunAudit = run(['--hub', hub, '--audit', '--sync-source', 'repo'], { env });
  assert.equal(rerunAudit.status, 0, rerunAudit.stderr);
  const audit = parseLastJson(rerunAudit.stdout);
  assert.equal(audit.checksum, firstChecksum);
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
      // A Toolkit 3.2 target record: reconciliation leaves the state bytes and the old target folder alone.
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
  assert.equal(rerunOutput.staging_reconciliation.checked_parent_count, 1, 'reconciliation checks only the hub parent');
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
    ['--enable-auto-sync'],
    ['--disable-target', 'opencode'],
    ['--opencode-command', 'unused-opencode'],
    ['--python-command', 'unused-python'],
    ['--disable-target', 'ag2']
  ];
  const env = isolatedHomeEnv(root, { PATH: '' });
  for (const extraArgs of incompatible) {
    const result = run(['--hub', hub, '--reconcile-staging', generationId, '--write', ...extraArgs], { env });
    assert.notEqual(result.status, 0, `${extraArgs[0]} must fail`);
    if (['--python-command', '--disable-target', '--opencode-command'].includes(extraArgs[0])) {
      assert.match(result.stderr, new RegExp(`Unknown argument: ${extraArgs[0]}`));
    } else {
      assert.match(result.stderr, /--reconcile-staging cannot be combined with:/);
    }
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

  const result = run(['--hub', hub, '--write', '--enable-auto-sync'], { env: isolatedHomeEnv(root) });
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

  const result = run(['--hub', hub, '--write', '--enable-auto-sync'], {
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
  let result = run(['--hub', hub, '--write', '--enable-auto-sync'], { env: isolatedHomeEnv(root) });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /fresh Toolkit bridge lock/);

  // Malformed PID, fresh created_at: same safe age fallback.
  writeJson(lockPath, { created_at: new Date().toISOString(), pid: 'not-a-pid' });
  result = run(['--hub', hub, '--write', '--enable-auto-sync'], { env: isolatedHomeEnv(root) });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /fresh Toolkit bridge lock/);

  // Legacy stale lock without a live owner is still recovered by age.
  writeJson(lockPath, { created_at: '2000-01-01T00:00:00.000Z', pid: 'not-a-pid' });
  result = run(['--hub', hub, '--write', '--enable-auto-sync'], {
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
  // Dated by Node's clock, which the clock-ahead run moves and file times do not.
  const freshTime = new Date();
  fs.utimesSync(lockPath, freshTime, freshTime);
  let result = run(['--hub', hub, '--write', '--enable-auto-sync'], { env: isolatedHomeEnv(root) });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /fresh Toolkit bridge lock/);
  assert.equal(fs.existsSync(lockPath), true, 'fresh unverifiable lock is not removed');

  // The same malformed lock with an old mtime is recoverable.
  const oldTime = new Date(Date.now() - 60 * 60 * 1000);
  fs.utimesSync(lockPath, oldTime, oldTime);
  result = run(['--hub', hub, '--write', '--enable-auto-sync'], {
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
  // Auto-sync on makes the hook reach the sync lock; the live lock must then
  // produce a skip, not a failure, and must survive untouched.
  writeJson(path.join(hub, 'state.json'), {
    schema_version: 1,
    architecture_version: 2,
    hub_version: '1.0.0',
    auto_sync_enabled: true,
    repo_path: repoRoot
  });
  writeJson(lockPath, { created_at: new Date().toISOString(), pid: process.pid });

  installToolkitCopy(root);
  const result = run(
    ['--hub', hub, '--hook', '--write', '--sync-source', 'claude-plugin'],
    { env: claudeHookEnv(root) }
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
  assert.equal(fullSuiteValidation[1], 'node --test repo/tests/toolkit-local-bridge.test.cjs repo/tests/toolkit-local-bridge-codex.test.cjs repo/tests/toolkit-local-bridge-claude.test.cjs');

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
    path.join(repoRoot, 'skills', 'repository-agent-rules', 'repo-local', 'AGENTS.managed.template.md'),
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

const NEVER_HALTING = /STOP|stop before repository work|ask the user/i;

function managedAgentsTemplate() {
  return fs.readFileSync(path.join(repoRoot, 'skills', 'repository-agent-rules', 'repo-local', 'AGENTS.managed.template.md'), 'utf8');
}

// Runs the SessionStart hook in `cwd` with a hub outside the repository, so the
// repository snapshot proves the hook wrote nothing there.
function runSessionStartHook(cwd, home, syncSource = 'codex-plugin') {
  const hub = path.join(home, 'hub', 'current');
  if (!fs.existsSync(path.join(hub, 'state.json'))) writeDisabledHookHub(hub);
  installToolkitCopy(home);
  return run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', syncSource], {
    cwd,
    env: claudeHookEnv(home, { PATH: process.env.PATH, PLUGIN_ROOT: repoRoot })
  });
}

const DISABLED_LINE = 'Toolkit local bridge: auto-sync disabled; run node repo/scripts/toolkit-local-bridge.cjs --audit for status.\n';

test('SessionStart notice is silent outside Toolkit-managed git roots and writes nothing', async (t) => {
  const cases = {
    'non-git directory': (root) => writeFile(path.join(root, 'README.md'), '# notes\n'),
    'git repository without AGENTS.md': (root) => {
      fs.mkdirSync(path.join(root, '.git'), { recursive: true });
      writeFile(path.join(root, 'packages', 'app', 'README.md'), '# app\n');
    },
    'git repository with its own unmanaged AGENTS.md': (root) => {
      fs.mkdirSync(path.join(root, '.git'), { recursive: true });
      writeFile(path.join(root, 'AGENTS.md'), '# Project rules\n\nUse tabs.\n');
    }
  };
  for (const [name, arrange] of Object.entries(cases)) {
    await t.test(name, () => {
      const root = tmpRoot();
      arrange(root);
      const cwd = fs.existsSync(path.join(root, 'packages', 'app')) ? path.join(root, 'packages', 'app') : root;
      const direct = runAgentRulesPreflight({ hook: true, syncSource: 'claude-plugin' }, { targetRoot: cwd, pluginRoot: repoRoot });
      assert.equal(direct.status, 'not-managed');
      assert.deepEqual(direct.findings, []);
      assert.equal(formatAgentRulesPreflight(direct), '');

      const home = tmpRoot();
      const before = snapshotTree(root);
      for (const source of ['codex-plugin', 'claude-plugin']) {
        const result = runSessionStartHook(cwd, home, source);
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stdout, DISABLED_LINE);
        assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /Toolkit note/);
        assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, NEVER_HALTING);
      }
      assert.deepEqual(snapshotTree(root), before);
    });
  }
});

test('SessionStart notice names a vendored Toolkit check that is older or missing in an ENABLED repository, read-only', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  writeFile(path.join(root, 'AGENTS.md'), managedAgentsTemplate());
  const installer = require('../../skills/secure-ci-cd/scripts/install-plain-text-check.cjs');
  const copy = path.join(root, '.github', 'scripts', 'plain-text-check.cjs');
  writeFile(copy, installer.vendoredText());
  const options = { targetRoot: root, pluginRoot: repoRoot, state: {}, governanceEnabled: () => true };
  assert.equal(runAgentRulesPreflight({ hook: true, syncSource: 'codex-plugin' }, options).status, 'ok', 'a current copy is quiet');
  const source = fs.readFileSync(path.join(repoRoot, 'skills', 'secure-ci-cd', 'scripts', 'plain-text-check.cjs'), 'utf8');
  writeFile(copy, installer.vendoredText(`${source}// an older copy\n`));
  const before = snapshotTree(root);
  const result = runAgentRulesPreflight({ hook: true, syncSource: 'codex-plugin' }, options);
  assert.equal(result.status, 'needs-attention');
  assert.deepEqual(result.findings.map((finding) => [finding.file, finding.kind]), [['.github/scripts/plain-text-check.cjs', 'repo-check']]);
  const message = formatAgentRulesPreflight(result);
  assert.match(message, /^Toolkit note: this repository's Toolkit checks \(\.github\/scripts\/plain-text-check\.cjs\) differ from the running Toolkit .*refresh them with repository-agent-rules when convenient\. No files were changed\.$/);
  assert.doesNotMatch(message, NEVER_HALTING);
  assert.deepEqual(snapshotTree(root), before);
  const notGoverned = runAgentRulesPreflight({ hook: true, syncSource: 'codex-plugin' }, { ...options, governanceEnabled: () => false });
  assert.equal(notGoverned.status, 'ok', 'outside an ENABLED repository the vendored checks are not compared');
  fs.rmSync(copy);
  const missing = runAgentRulesPreflight({ hook: true, syncSource: 'codex-plugin' }, options);
  assert.deepEqual(missing.findings.map((finding) => [finding.file, finding.detail]), [['.github/scripts/plain-text-check.cjs', 'missing']]);
  assert.match(formatAgentRulesPreflight(missing), /Toolkit checks \(\.github\/scripts\/plain-text-check\.cjs\) are missing or differ from the running Toolkit /);
  assert.equal(runAgentRulesPreflight({ hook: true, syncSource: 'codex-plugin' }, { ...options, governanceEnabled: () => false }).status, 'ok', 'a missing copy is not noted outside an ENABLED repository');
  writeFile(path.join(root, '.github', 'plain-text.json'), JSON.stringify({ off_reason: 'the owner switched it off for this repository' }));
  assert.equal(runAgentRulesPreflight({ hook: true, syncSource: 'codex-plugin' }, options).status, 'ok', 'a check switched off with a recorded reason is not noted as missing');
});

test('SessionStart notice says repository rules from a newer Toolkit are authoritative, once, without writing', () => {
  // Hub state records a newer Toolkit than the running copy, and the repository block differs.
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  writeFile(path.join(root, 'AGENTS.md'), managedAgentsTemplate().replace('Repository-wide CI', 'Repository CI in newer wording'));
  const state = { bridge_versions_by_source: { 'codex-plugin': '99.0.0' } };
  const result = runAgentRulesPreflight({ hook: true, syncSource: 'codex-plugin' }, { targetRoot: root, pluginRoot: repoRoot, state });
  assert.equal(result.status, 'needs-attention');
  assert.equal(result.direction, 'newer');
  const message = formatAgentRulesPreflight(result);
  assert.equal(message.split('\n').length, 1);
  assert.doesNotMatch(message, NEVER_HALTING);
  assert.match(message, /newer Toolkit \(99\.0\.0\) than the running copy/);
  assert.match(message, /repository rules are authoritative/);
  assert.match(message, /Refresh Toolkit when convenient/);

  // A Toolkit source checkout newer than the running copy is the same direction, even when current.
  const checkout = tmpRoot();
  fs.mkdirSync(path.join(checkout, '.git'), { recursive: true });
  writeFile(path.join(checkout, 'skills', 'repository-agent-rules', 'repo-local', 'AGENTS.managed.template.md'), managedAgentsTemplate());
  writeFile(path.join(checkout, 'repo', 'scripts', 'sync-agent-instruction-shims.cjs'), '// marker\n');
  writeFile(path.join(checkout, 'repo', 'contracts', 'toolkit-local-bridge', 'version.json'), JSON.stringify({ version: '99.0.0' }));
  writeFile(path.join(checkout, 'AGENTS.md'), managedAgentsTemplate());
  const pluginRoot = tmpRoot();
  writeFile(path.join(pluginRoot, 'skills', 'repository-agent-rules', 'repo-local', 'AGENTS.managed.template.md'),
    managedAgentsTemplate().replace('Finish fast', 'Finish in an older wording'));
  const source = runAgentRulesPreflight({ hook: true, syncSource: 'codex-plugin' }, { targetRoot: checkout, pluginRoot });
  assert.equal(source.reference, 'source-checkout');
  assert.deepEqual(source.findings, []);
  assert.equal(source.direction, 'newer');
  assert.doesNotMatch(formatAgentRulesPreflight(source), NEVER_HALTING);

  // Through the hook: one line on the first session, nothing on the next, no repository writes.
  const home = tmpRoot();
  const hub = path.join(home, 'hub', 'current');
  writeJson(path.join(hub, 'state.json'), { schema_version: 1, architecture_version: 2, hub_version: expectedBridgeVersion,
    auto_sync_enabled: false, targets: {}, bridge_versions_by_source: { 'claude-plugin': '99.0.0' } });
  const before = snapshotTree(root);
  const first = run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'codex-plugin'], {
    cwd: root, env: isolatedHomeEnv(home, { PATH: process.env.PATH, PLUGIN_ROOT: repoRoot })
  });
  assert.equal(first.status, 0, first.stderr);
  const notes = first.stdout.split('\n').filter((line) => line.startsWith('Toolkit note:'));
  assert.equal(notes.length, 1);
  assert.match(notes[0], /newer Toolkit \(99\.0\.0\)/);
  assert.doesNotMatch(first.stdout, NEVER_HALTING);
  const second = runSessionStartHook(root, home);
  assert.equal(second.status, 0, second.stderr);
  assert.doesNotMatch(second.stdout, /Toolkit note/);
  assert.deepEqual(snapshotTree(root), before);
});

test('SessionStart notice offers a refresh for differing or broken repository blocks, once per finding, without writing', async (t) => {
  const cases = [
    { name: 'stale managed block', agents: managedAgentsTemplate().replace('Repository-wide CI', 'Keep tests in edited wording') },
    { name: 'malformed managed block', agents: '<!-- AI-AGENT-TOOLKIT:repo/contracts/agent-rules/toolkit-governed-rules.md:BEGIN TOOLKIT-GOVERNED-RULES v2 toolkit=3.4.0 sha256=000000000000 -->\n# broken\n' }
  ];
  for (const fixture of cases) {
    await t.test(fixture.name, () => {
      const root = tmpRoot();
      fs.mkdirSync(path.join(root, '.git'), { recursive: true });
      writeFile(path.join(root, 'AGENTS.md'), fixture.agents);
      const direct = runAgentRulesPreflight({ hook: true, syncSource: 'codex-plugin' }, { targetRoot: root, pluginRoot: repoRoot });
      assert.equal(direct.status, 'needs-attention');
      // No newer Toolkit is known here, so which side is newer is unknown: the note says "differ".
      assert.equal(direct.direction, 'differs');
      const message = formatAgentRulesPreflight(direct);
      assert.equal(message.split('\n').length, 1);
      assert.doesNotMatch(message, NEVER_HALTING);
      assert.match(message, /\(AGENTS\.md\) differ from the running Toolkit [0-9.]+ templates/);
      assert.doesNotMatch(message, /are older/);
      assert.match(message, /refresh them with repository-agent-rules when convenient/);
      assert.match(message, /No files were changed/);

      const home = tmpRoot();
      const before = snapshotTree(root);
      const first = runSessionStartHook(root, home);
      assert.equal(first.status, 0, first.stderr);
      assert.equal(first.stdout, `${message}\n${DISABLED_LINE}`);
      // Resume, compact or a new session with the same finding stays quiet.
      const again = runSessionStartHook(root, home);
      assert.equal(again.stdout, DISABLED_LINE);
      // A changed finding is new and is shown once.
      fs.appendFileSync(path.join(root, 'AGENTS.md'), '\n<!-- AI-AGENT-TOOLKIT:x:BEGIN EXTRA v1 -->\n');
      const changed = runSessionStartHook(root, home);
      assert.match(changed.stdout, /^Toolkit note:/);
      const after = snapshotTree(root);
      assert.deepEqual(after.filter((entry) => !entry.startsWith('file:AGENTS.md:')), before.filter((entry) => !entry.startsWith('file:AGENTS.md:')));
      assert.equal(fs.existsSync(path.join(root, '_agent-toolkit-backups')), false);
      assert.equal(fs.existsSync(path.join(root, '.agent-toolkit-backups')), false);
    });
  }
});

test('SessionStart notice ledger survives hub snapshot swaps when auto-sync is on', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  writeFile(path.join(root, 'AGENTS.md'), managedAgentsTemplate().replace('Repository-wide CI', 'Keep tests in ledger swap wording'));
  const home = tmpRoot();
  const hub = path.join(home, 'hub', 'current');
  writeJson(path.join(hub, 'state.json'), { schema_version: 1, architecture_version: 2, hub_version: expectedBridgeVersion, auto_sync_enabled: true, targets: {} });
  const hook = () => run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'codex-plugin'], {
    cwd: root, env: isolatedHomeEnv(home, { PATH: process.env.PATH, PLUGIN_ROOT: repoRoot })
  });
  const first = hook();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout.split('\n').filter((line) => line.startsWith('Toolkit note:')).length, 1);
  // The auto-sync hook rewrites the snapshot directory; the ledger sits beside it.
  assert.equal(fs.existsSync(path.join(hub, 'agent-rules-notices.json')), false);
  assert.equal(fs.existsSync(path.join(path.dirname(hub), 'agent-rules-notices.json')), true);
  for (let session = 2; session <= 3; session += 1) {
    const again = hook();
    assert.equal(again.status, 0, again.stderr);
    assert.doesNotMatch(again.stdout, /Toolkit note:/, `session ${session}`);
  }
  assert.equal(readJson(path.join(hub, 'state.json')).auto_sync_enabled, true);
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
    '--enable-auto-sync',
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

  result = run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'repo'], {
    env: isolatedHomeEnv(fixture.root, { PATH: process.env.PATH })
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /Toolkit local bridge sync complete\./);
  let state = readJson(path.join(hub, 'state.json'));
  assert.equal(state.last_update_report_path || '', '');
  assert.equal(state.last_repo_update_status, 'up-to-date');
  assert.equal(state.last_repo_update_to_commit, fixture.initialCommit);

  result = run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'repo'], {
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

  result = run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'repo'], {
    env: isolatedHomeEnv(fixture.root, { PATH: process.env.PATH })
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readJson(path.join(hub, 'state.json')).last_repo_update_to_commit, fixture.initialCommit);

  const updatedCommit = pushRepoToolkitUpdate(fixture, 'already-advanced');
  git(fixture.repo, ['fetch', 'origin', 'main']);
  git(fixture.repo, ['merge', '--ff-only', 'FETCH_HEAD']);
  assert.equal(currentCommit(fixture.repo), updatedCommit);

  result = run(['--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'repo'], {
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
});

test('active hook writes persist each source independently without requiring a report', () => {
  const fixture = createActiveNoTargetFixture('codex-plugin');
  installToolkitCopy(fixture.root, fixture.sourceRepo);
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

test('active hook write persists lazy legacy migration', () => {
  const fixture = createActiveNoTargetFixture('codex-plugin');
  installToolkitCopy(fixture.root, fixture.sourceRepo);
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

test('forced same-source hook downgrade changes only that source and keeps hub watermark', () => {
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
  installToolkitCopy(fixture.root, fixture.sourceRepo);
  const hookEnv = claudeHookEnv(fixture.root, { TEMP: fixture.temp, TMP: fixture.temp, CLAUDE_PLUGIN_ROOT: fixture.sourceRepo });
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

  const report = readLatestReport(fixture.hub);
  assert.match(report.text, /## TL;DR/);
  assert.match(report.text, /Triggered from: manual or repo run \(`repo`\)\./);
  assert.match(report.text, new RegExp(`Toolkit updated to commit: \`${fixture.toCommit}\``));
  assert.match(report.text, new RegExp(`Previous commit: \`${fixture.fromCommit}\``));
  assert.match(report.text, /Running bridge source: `repo`/);
  assert.match(report.text, /Time \(SGT\): `\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} SGT`/);
  assert.doesNotMatch(report.text, /Timestamp: `\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z`/);
  assert.match(report.text, /Repo: updated from [0-9a-f]{8} to [0-9a-f]{8}\./);
  assert.match(report.text, /Action needed: none\./);
  assert.match(report.text, /- `skills\/alpha\/SKILL\.md`/);
  assert.match(report.text, /repo update status: `updated`/);
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
    '--enable-auto-sync',
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
  const repoPattern = fixture.repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(report.text, new RegExp(`Action needed: the configured Toolkit source checkout \\(\`${repoPattern}\`\\) has uncommitted changes, so startup updates stay skipped until it is clean: commit or stash them there, or run \`setup toolkit\` to use a dedicated clean \`main\` checkout\\.`));
  assert.doesNotMatch(report.text, /will retry on the next hook run/);
  assert.match(report.text, new RegExp(`Configured repo path: \`${fixture.repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\``));
  assert.match(report.text, /repo update status: `skipped`/);
  assert.match(report.text, /warning\/error: `dirty working tree`/i);
  assert.match(report.text, /Suggested fix: the configured Toolkit source checkout \(`[^`]+`\) has uncommitted changes, so startup updates stay skipped until it is clean/);
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
    '--enable-auto-sync',
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
    '--enable-auto-sync',
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
    '--enable-auto-sync',
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
    '--enable-auto-sync',
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
    '--enable-auto-sync',
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
  const base = { repo: {}, nativePluginCache: {} };
  assert.deepEqual(classifyUpdateReport(base), { meaningful: false, actionable: false, kind: 'no-op' });
  assert.deepEqual(classifyUpdateReport({ ...base, repo: { status: 'updated' } }), { meaningful: true, actionable: false, kind: 'successful-activity' });
  assert.deepEqual(classifyUpdateReport({ ...base, nativePluginCache: { status: 'refreshed' } }), { meaningful: true, actionable: false, kind: 'successful-activity' });
  assert.equal(classifyUpdateReport({ ...base, repo: { status: 'validation-failed' } }).actionable, true);
  assert.equal(classifyUpdateReport({ ...base, repo: { status: 'skipped', error: 'remote mismatch' } }).actionable, true);
  assert.equal(classifyUpdateReport({ ...base, nativePluginCache: { status: 'refresh-failed' } }).actionable, true);

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

test('each restored hand edit gets its own report, even on the same Toolkit content', () => {
  const restored = (folder) => ({ repo: {}, nativePluginCache: {}, installCheck: { status: 'passed', actions: [], checks: [
    { id: 'helpers', status: 'passed', summary: 'current' },
    { id: 'global-rules', status: 'passed', updated: true,
      summary: `Claude Code (~/.claude/CLAUDE.md): restored; an edit inside the Toolkit block was replaced, and the edited copy is in the backup below Backup: ~/.ai-agent-toolkit/backups/global-rules/${folder}` }
  ] } });
  const writes = [];
  let state = { update_report_enabled: true, last_update_report_signature: '', last_update_report_cleanup: {}, bridge_versions_by_source: {}, hub_version: '', update_report_retention_days: 7 };
  const invoke = (context) => {
    const result = maybeWriteUpdateReport({
      args: { hook: true, repoUpdateNow: false, openUpdateReport: false, suppressUpdateReport: false, syncSource: 'claude-plugin' },
      hubPath: 'unused', state, checksum: 'same-content', context,
      writeReport(markdown) { writes.push(markdown); return `restore-${writes.length}.md`; },
      openReport() { return { ok: true }; },
    });
    state = result.state;
    return result;
  };
  assert.equal(invoke(restored('2026-10-22T09-00-00-000Z')).reportPath, 'restore-1.md');
  assert.equal(invoke(restored('2026-10-22T10-00-00-000Z')).reportPath, 'restore-2.md', 'a second restore is not hidden by the first report signature');
  assert.equal(writes.length, 2);
  assert.match(writes[1], /restored; an edit inside the Toolkit block was replaced/);
  assert.equal(invoke(restored('2026-10-22T10-00-00-000Z')).reportPath, '', 'the same run replayed is still deduplicated');

  // A file recreated after a hand deletion has the same summary each time; its run id still differs.
  const created = (run) => ({ repo: {}, nativePluginCache: {}, installCheck: { status: 'passed', actions: [], checks: [
    { id: 'global-rules', status: 'passed', updated: true, run, summary: 'Claude Code (~/.claude/CLAUDE.md): created' }] } });
  assert.equal(invoke(created('2026-10-22T11-00-00-000Z')).reportPath, 'restore-3.md');
  assert.equal(invoke(created('2026-10-22T12-00-00-000Z')).reportPath, 'restore-4.md');
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
  assert.deepEqual(Object.keys(codexHooks.hooks).sort(), ['PostToolUse', 'PreToolUse', 'SessionStart', 'Stop', 'UserPromptSubmit']);
  // The Codex helper guard is the first PreToolUse entry; it guards spawn_agent, its Agent alias and the
  // flattened namespaced MultiAgentV2 spawn names such as collaborationspawn_agent, and checks shell
  // commands (Bash) for AI attribution in commits and pull requests. The second entry and the
  // UserPromptSubmit entry run the same script for the governance hold (#542).
  assert.deepEqual(codexHooks.hooks.PreToolUse.map(entry => entry.matcher), ['^(?:Agent|[A-Za-z0-9_-]*spawn_agent|Bash|exec_command|shell|local_shell|PowerShell)$', '^(?:apply_patch|Edit|Write|mcp__.*)$']);
  for (const entry of [...codexHooks.hooks.PreToolUse, ...codexHooks.hooks.UserPromptSubmit]) assert.match(entry.hooks[0].command, /toolkit-codex-helper-hook.cjs/);
  assert.deepEqual(Object.keys(claudeHooks.hooks).sort(), ['PostToolUse', 'PreToolUse', 'SessionStart', 'Stop', 'UserPromptSubmit']);
  const claudeAgentHook = claudeHooks.hooks.PreToolUse[0];
  assert.equal(claudeAgentHook.matcher, 'Agent|Task');
  assert.match(claudeAgentHook.hooks[0].command, /\$\{CLAUDE_PLUGIN_ROOT\}\/repo\/scripts\/toolkit-claude-agent-hook\.cjs/);
  assert.deepEqual(claudeHooks.hooks.PreToolUse.map(entry => entry.matcher), ['Agent|Task', 'Bash|PowerShell', '^(?:Bash|PowerShell|Monitor|Edit|Write|MultiEdit|NotebookEdit|Agent|Task|TaskStop|EnterWorktree|CronCreate|CronDelete|RemoteTrigger|SendMessage|Workflow|mcp__.*)$', '^(?!(?:Bash|PowerShell|Monitor|Edit|Write|MultiEdit|NotebookEdit|Agent|Task|TaskStop|EnterWorktree|CronCreate|CronDelete|RemoteTrigger|SendMessage|Workflow|mcp__.*)$)', '^(?:mcp__hearthbot__(?:post_message|edit_message)|Bash|PowerShell|mcp__.*[Mm][Ee][Rr][Gg][Ee].*)$', '^mcp__hearthbot__start_thread$', '^propose_skills$']);
  assert.match(claudeHooks.hooks.PreToolUse[1].hooks[0].command, /toolkit-claude-attribution-hook\.cjs/);
  // The governance hook in two entries: state-changing tools (held if the hook cannot start) and the rest.
  for (const index of [2, 3]) assert.match(claudeHooks.hooks.PreToolUse[index].hooks[0].command, /toolkit-governance-hook\.cjs" --event PreToolUse$/);
  assert.deepEqual([claudeHooks.hooks.PreToolUse[2].hooks[0].onFailure, claudeHooks.hooks.PreToolUse[3].hooks[0].onFailure], ['block', undefined]);
  assert.match(claudeHooks.hooks.PreToolUse[4].hooks[0].command, /toolkit-claude-project-post-hook\.cjs"$/);
  // The gate route hook checks Projects thread launches; a hook that cannot start never stops every launch.
  assert.match(claudeHooks.hooks.PreToolUse[5].hooks[0].command, /toolkit-claude-project-gate-route-hook\.cjs"$/);
  assert.equal(claudeHooks.hooks.PreToolUse[5].hooks[0].onFailure, undefined);
  // The skill card hook checks controller skill cards against main; a hook that cannot start never stops every card.
  assert.match(claudeHooks.hooks.PreToolUse[6].hooks[0].command, /toolkit-claude-project-skill-card-hook\.cjs"$/);
  assert.equal(claudeHooks.hooks.PreToolUse[6].hooks[0].onFailure, undefined);
  assert.match(claudeHooks.hooks.UserPromptSubmit[0].hooks[0].command, /toolkit-governance-hook\.cjs" --event UserPromptSubmit$/);
  assert.equal(codexHooks.hooks.SessionEnd, undefined);
  assert.equal(claudeHooks.hooks.SessionEnd, undefined);
  // The only turn-end hook is the programme checkpoint: one command, a 30-second timeout and no matcher.
  for (const [hooks, root] of [[codexHooks, 'PLUGIN_ROOT'], [claudeHooks, 'CLAUDE_PLUGIN_ROOT']]) {
    assert.deepEqual(hooks.hooks.Stop, [{ hooks: [{ type: 'command', command: `node "\${${root}}/repo/scripts/toolkit-programme-checkpoint-hook.cjs"`, timeout: 30 }] }]);
  }
  // The after-tool checkpoint hook runs the same script, only to mark a GitHub write for the turn-end
  // programme refresh. Claude Code also reads the answer tapped on the governance card after the tool runs.
  for (const [hooks, root, matcher] of [[codexHooks, 'PLUGIN_ROOT', '^(?:Bash|exec_command|shell|local_shell|PowerShell|mcp__.*[Gg][Ii][Tt][Hh][Uu][Bb].*)$'], [claudeHooks, 'CLAUDE_PLUGIN_ROOT', '^(?:Bash|PowerShell|mcp__.*[Gg][Ii][Tt][Hh][Uu][Bb].*)$']]) {
    const checkpoint = { matcher, hooks: [{ type: 'command', command: `node "\${${root}}/repo/scripts/toolkit-programme-checkpoint-hook.cjs"`, timeout: 10 }] };
    const card = { matcher: '^AskUserQuestion$', hooks: [{ type: 'command', command: `node "\${${root}}/repo/scripts/toolkit-governance-hook.cjs" --event PostToolUse`, timeout: 10 }] };
    // Claude Code also checks what GitHub sent back for the cloud route's "Generated by Claude Code" footer.
    const footer = { matcher, hooks: [{ type: 'command', command: `node "\${${root}}/repo/scripts/toolkit-github-footer-hook.cjs"`, timeout: 10 }] };
    assert.deepEqual(hooks.hooks.PostToolUse, hooks === claudeHooks ? [card, checkpoint, footer] : [checkpoint]);
  }
  assert.doesNotMatch(`${codexCommand}\n${claudeCommand}`, /--enable-target|--force-downgrade/);
  assert.doesNotMatch(`${codexCommand}\n${claudeCommand}`, /\.sh(?:$|[\s"'])/i);
  assert.doesNotMatch(`${codexCommand}\n${claudeCommand}`, /(?:^|\s)(?:bash|bash\.exe)(?:\s|$)|[A-Z]:\\WINDOWS\\system32\\bash\.exe/i);
  assert.doesNotMatch(`${codexCommand}\n${claudeCommand}`, /\b(?:jq|python3)\b/i);
});

test('toolkit setup skill documents the end-to-end English setup journey', () => {
  const paths = [
    'skills/toolkit-setup/SKILL.md'
  ];

  for (const relPath of paths) {
    const text = fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
    assert.match(text, /setup toolkit/i, relPath);
    assert.match(text, /Resolve the home folder yourself and run the managed script by its full path, in forward slashes inside double quotes/, relPath);
    assert.match(text, /```text\r?\nnode "<home folder>\/\.ai-agent-toolkit\/source\/ai-agent-toolkit\/repo\/scripts\/setup-toolkit\.cjs" --execute --profile auto-main\r?\n```/, relPath);
    assert.doesNotMatch(text, /"%USERPROFILE%/, relPath);
    assert.doesNotMatch(text, /\$HOME\/\.ai-agent-toolkit/, relPath);
    assert.match(text, /active repo command is bootstrap\/fallback only/, relPath);
    assert.match(text, /append `--host claude-code`|with `--host claude-code`/i, relPath);
    assert.match(text, /Do not run an active stale verifier after managed setup|Verification after managed setup must use the managed checkout verifier/i, relPath);
    assert.match(text, /active worktree path and commit|active worktree path\/commit/i, relPath);
    assert.match(text, /exact setup script path executed/i, relPath);
    assert.match(text, /dedicated clean `main` checkout as the single update source/, relPath);
    assert.match(text, /%USERPROFILE%\\\.ai-agent-toolkit\\source\\ai-agent-toolkit/, relPath);
    assert.doesNotMatch(text, /~\/\.ai-agent-toolkit\/source\/ai-agent-toolkit/, relPath);
    assert.match(text, /separate from the active Codex or Claude Code worktree, plugin caches, `\.tmp` directories, and temporary marketplace checkouts/i, relPath);
    assert.match(text, /complete compact bank|semantic wizard model/i, relPath);
    assert.match(text, /report auto-open is not an ordinary question|failure-only behavior/i, relPath);
    assert.match(text, /Omit host-specific rows when they have no practical effect/i, relPath);
    assert.match(text, /Allowed later blockers include dirty managed checkout, unexpected remote, fetch\/auth failure, non-fast-forward update, validation failure/i, relPath);
    assert.match(text, /node repo\/scripts\/validate-toolkit\.cjs/, relPath);
    const setupValidationBlock = text.match(/For bridge or setup-surface changes, prefer targeted checks first:[\s\S]*?```powershell\r?\n([\s\S]*?)\r?\n```/i);
    assert.ok(setupValidationBlock, relPath);
    assert.match(setupValidationBlock[1], /node --test repo\/tests\/toolkit-local-bridge-hook-light\.test\.cjs/, relPath);
    assert.doesNotMatch(setupValidationBlock[1], /node --test repo\/tests\/toolkit-local-bridge\.test\.cjs/, relPath);
    assert.match(text, /Run `node --test repo\/tests\/toolkit-local-bridge\.test\.cjs repo\/tests\/toolkit-local-bridge-codex\.test\.cjs repo\/tests\/toolkit-local-bridge-claude\.test\.cjs` when the change affects bridge behavior/i, relPath);
    assert.match(text, /Codex native plugin/i, relPath);
    assert.match(text, /setup-codex-toolkit-plugin\.cjs/, relPath);
    assert.match(text, /\.claude-plugin\/plugin\.json/, relPath);
    assert.match(text, /--codex-cli "<home folder>\/\.codex\/plugins\/\.plugin-appserver\/codex\.exe"` as a full path in forward slashes inside double quotes/, relPath);
    assert.match(text, /Do not use Codex to update Claude Code or Claude Code to update Codex/i, relPath);
    assert.match(text, /repo-backed auto-update/i, relPath);
    assert.match(text, /OpenCode is not a Toolkit target/i, relPath);
    assert.doesNotMatch(text, /OpenCode (?:native )?project plugin|--install-opencode-project-plugin/i, relPath);
    assert.match(text, /semantic wizard model|One semantic wizard model/i, relPath);
    assert.match(text, /What this controls.*Current:.*Recommended:.*Why:.*Choices:.*consequence.*After applying:/is, relPath);
    assert.match(text, /Omit host-specific rows when they have no practical effect/i, relPath);
    assert.match(text, /Antigravity receives explicit portable skills copies: setup's opt-in question copies them into `~\/\.gemini\/config\/skills`[^\n]*; native AG2 install\/update\/sync is unsupported/i, relPath);
    assert.match(text, /--copy-antigravity-skills/, relPath);
    assert.match(text, /The bridge writes into no other app/i, relPath);
    assert.match(text, /fast-forward/i, relPath);
    assert.match(text, /Toolkit-managed update reports\/logs older than 7 days/i, relPath);
    assert.match(text, /Setup copies the official `n8n-io\/skills` folders as plain skills, so the `n8n-skills@n8n-io` plugin is not needed/i, relPath);
    assert.match(text, /pre-approval Claude(?: Code)? setup and plan discovery (?:start|launch) no Claude session/i, relPath);
    assert.match(text, /The visible choices are `Toolkit repos: main session \+ Toolkit planning and build helpers only\. Elsewhere: one layer of subagents\.`, `Broader native behaviour`, and `Keep current`/, relPath);
    assert.match(text, /`toolkit-direct`\) worker and checker topology is retired/, relPath);
    assert.match(text, /setup runs no worker or checker launch probes/i, relPath);
    assert.match(text, /restart-pending, stale, or failed verification leaves the safe root-only policy/i, relPath);
    assert.doesNotMatch(text, /Direct Toolkit-managed subagents only|Fable 5 worker|Opus 4\.8 checker|AI_AGENT_TOOLKIT_CAPABILITY_PROBE/i, relPath);
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
  assert.match(text, /older Claude Code bridge still uses the legacy global `hub_version` guard/i);
  // Claude Code runs Toolkit in place from the managed checkout, not from a cache copy.
  assert.match(text, /Claude Code runs Toolkit in place from the managed checkout/);
  assert.match(text, /fully resolved on a machine only after the Codex cache and the managed checkout both have the fixed bridge/i);
  assert.match(text, /Codex: run `setup toolkit` in Codex/i);
  assert.match(text, /Claude Code: run `setup toolkit --host claude-code`/i);
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
    'setup-opencode-bridge',
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
  }

  const bridgeSkillNames = skillNames.filter((skill) => {
    const skillPath = path.join(repoRoot, 'skills', skill, 'SKILL.md');
    if (!fs.existsSync(skillPath)) return false;
    const skillText = fs.readFileSync(skillPath, 'utf8');
    return /toolkit-local-bridge\.cjs|Toolkit Local Bridge|OpenCode bridge support|Antigravity portable skills|stale bridge state/i.test(skillText);
  });
  assert.deepEqual(bridgeSkillNames, ['toolkit-setup'], 'exactly one Toolkit setup/bridge discoverability skill should exist');

  for (const rel of [
    'skills/toolkit-setup/README.md',
    'skills/toolkit-setup/SKILL.md',
    'skills/toolkit-setup/agents/openai.yaml'
  ]) {
    assert.equal(fs.existsSync(path.join(repoRoot, rel)), true, `${rel} should be present`);
  }
  assert.doesNotMatch(fs.readFileSync(path.join(repoRoot, 'skills', 'toolkit-setup', 'SKILL.md'), 'utf8'), /Generated from toolkit (?:project source|curated output for AI)/);
});

test('the removed rule-refresh PR merge choice is gone: its flags are rejected and an old state key is dropped on the next write', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  const env = isolatedHomeEnv(root, { PATH: process.env.PATH });
  for (const flag of ['--enable-refresh-pr-auto-merge', '--disable-refresh-pr-auto-merge']) {
    const result = run(['--hub', hub, '--write', flag], { env });
    assert.notEqual(result.status, 0, flag);
  }
  assert.equal(run(['--hub', hub, '--write', '--enable-update-reports'], { env }).status, 0);
  const statePath = path.join(hub, 'state.json');
  writeJson(statePath, { ...readJson(statePath), refresh_pr_auto_merge_enabled: true });
  const audit = run(['--hub', hub, '--audit'], { env });
  assert.equal(audit.status, 0, audit.stderr);
  assert.equal('refresh_pr_auto_merge_enabled' in JSON.parse(audit.stdout), false);
  assert.equal(run(['--hub', hub, '--write', '--enable-update-reports'], { env }).status, 0);
  assert.equal('refresh_pr_auto_merge_enabled' in readJson(statePath), false);
});
