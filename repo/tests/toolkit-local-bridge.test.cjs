'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const script = path.join(repoRoot, 'repo', 'scripts', 'toolkit-local-bridge.cjs');

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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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
  assert.match(audit.targets.opencode.target_path, /opencode[\\/]skills[\\/]ai-agent-toolkit$/);
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
  const targetSkill = path.join(opencodeConfig, 'skills', 'ai-agent-toolkit', 'SKILL.md');
  assert.equal(state.targets.opencode.enabled, true);
  assert.equal(state.targets.opencode.synced_version, '2.0.0');
  assert.equal(manifest.sync_source, 'codex-plugin');
  assert.ok(fs.existsSync(path.join(hub, 'adapters', 'opencode', 'skills', 'ai-agent-toolkit', 'SKILL.md')));
  assert.ok(fs.existsSync(targetSkill), 'OpenCode target skill is written only after explicit enablement');
  assert.doesNotMatch(targetSkill.replace(/\\/g, '/'), /\.agents\/skills/);
});

test('explicit AG2 setup writes adapter metadata under the hub without package installs', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  const result = run(['--hub', hub, '--write', '--enable-target', 'ag2', '--sync-source', 'claude-plugin']);
  assert.equal(result.status, 0, result.stderr);

  const state = readJson(path.join(hub, 'state.json'));
  const metadataPath = path.join(hub, 'adapters', 'ag2', 'ai-agent-toolkit-ag2-adapter.json');
  const metadata = readJson(metadataPath);
  assert.equal(state.targets.ag2.enabled, true);
  assert.equal(state.targets.ag2.synced_version, '2.0.0');
  assert.equal(metadata.policy.no_package_install_by_default, true);
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

test('sync-enabled command does not create bridge state before setup', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  const result = run(['--hub', hub, '--sync-enabled', '--write']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no enabled stale targets to sync/);
  assert.equal(fs.existsSync(hub), false);
});

test('disabled target is not overwritten during later sync', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  const opencodeConfig = path.join(root, 'opencode');
  let result = run(['--hub', hub, '--write', '--enable-target', 'opencode', '--opencode-config-dir', opencodeConfig]);
  assert.equal(result.status, 0, result.stderr);

  const targetDir = path.join(opencodeConfig, 'skills', 'ai-agent-toolkit');
  const marker = path.join(targetDir, 'USER-MARKER.txt');
  fs.writeFileSync(marker, 'keep me\n', 'utf8');

  result = run(['--hub', hub, '--write', '--disable-target', 'opencode', '--opencode-config-dir', opencodeConfig]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(marker, 'utf8'), 'keep me\n');

  result = run(['--hub', hub, '--sync-enabled', '--write', '--opencode-config-dir', opencodeConfig]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(marker, 'utf8'), 'keep me\n', 'disabled target must not be overwritten');
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

  let result = run(['--hub', hub, '--write', '--enable-target', 'ag2']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Refusing downgrade/);

  result = run(['--hub', hub, '--write', '--force-downgrade', '--enable-target', 'ag2']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readJson(path.join(hub, 'state.json')).hub_version, '2.0.0');
});

test('fresh lock blocks manual writes and stale lock is recovered', () => {
  const root = tmpRoot();
  const hub = path.join(root, 'hub', 'current');
  const lockPath = path.join(root, 'hub', 'update.lock');
  writeJson(lockPath, { created_at: new Date().toISOString(), pid: 123 });

  let result = run(['--hub', hub, '--write', '--enable-target', 'ag2']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /fresh Toolkit bridge lock/);

  writeJson(lockPath, { created_at: '2000-01-01T00:00:00.000Z', pid: 123 });
  result = run(['--hub', hub, '--write', '--enable-target', 'ag2']);
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

  const result = run(['--hub', hub, '--hook', '--write', '--sync-source', 'claude-plugin']);
  assert.equal(result.status, 0, result.stderr);
  const state = readJson(path.join(hub, 'state.json'));
  assert.equal(state.hub_version, '2.0.0');
  assert.equal(state.targets.ag2.synced_version, '2.0.0');
  assert.equal(state.last_sync_source, 'claude-plugin');
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
  assert.match(codexCommand, /toolkit-local-bridge\.cjs/);
  assert.match(codexCommand, /\$\{PLUGIN_ROOT\}\/repo\/scripts\/toolkit-local-bridge\.cjs/);
  assert.doesNotMatch(codexCommand, /CODEX_PLUGIN_ROOT|CODEX_PLUGIN_DATA|CLAUDE_PLUGIN_ROOT|CLAUDE_PLUGIN_DATA/);
  assert.match(codexCommand, /--sync-enabled/);
  assert.match(codexCommand, /--sync-source codex-plugin/);
  assert.match(claudeCommand, /toolkit-local-bridge\.cjs/);
  assert.match(claudeCommand, /\$\{CLAUDE_PLUGIN_ROOT\}\/repo\/scripts\/toolkit-local-bridge\.cjs/);
  assert.doesNotMatch(claudeCommand, /CODEX_PLUGIN_ROOT|CODEX_PLUGIN_DATA/);
  assert.match(claudeCommand, /--sync-enabled/);
  assert.match(claudeCommand, /--sync-source claude-plugin/);
  assert.doesNotMatch(`${codexCommand}\n${claudeCommand}`, /--enable-target|--force-downgrade/);
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
    return /toolkit-local-bridge\.cjs|Toolkit Local Bridge|OpenCode bridge support|AG2 adapter support|stale bridge state/i.test(skillText);
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
    return /toolkit-local-bridge\.cjs|Toolkit Local Bridge|OpenCode bridge support|AG2 adapter support|stale bridge state/i.test(skillText);
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
    (manifest.writes.allowed || [])
      .filter((output) => String(output || '').startsWith('skills/'))
      .sort(),
    [
      'skills/toolkit-setup/README.md',
      'skills/toolkit-setup/SKILL.md',
      'skills/toolkit-setup/agents/openai.yaml'
    ].sort()
  );
});
