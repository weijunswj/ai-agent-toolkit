'use strict';

// Shared fixtures for the automatic-update tests (toolkit-local-bridge-auto-update*.test.cjs): a
// temporary home, Claude config folder, hub, git remote and a managed checkout behind it.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { BRIDGE_VERSION } = require('../../scripts/toolkit-local-bridge.cjs');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const script = path.join(repoRoot, 'repo', 'scripts', 'toolkit-local-bridge.cjs');
const NOTICE = /^Toolkit update notice: this session start updated Toolkit on this computer from .+ to .+\.$/m;

function tmpRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-auto-update-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function env(root, extra = {}) {
  return {
    ...process.env,
    USERPROFILE: root,
    HOME: root,
    LOCALAPPDATA: path.join(root, 'local-app-data'),
    CLAUDE_CONFIG_DIR: path.join(root, '.claude'),
    CODEX_HOME: path.join(root, '.codex'),
    AI_AGENT_TOOLKIT_CONTROL_ROOT: path.join(root, '.ai-agent-toolkit', 'agent-control'),
    CLAUDE_CODE_REMOTE: '',
    TOOLKIT_BRIDGE_HANDOFF_FROM: '',
    ...extra,
  };
}

// Records `runningRoot` as the Toolkit copy Claude Code CLI runs (shape from Claude Code 2.1.306).
function installToolkit(root, runningRoot) {
  const configDir = path.join(root, '.claude');
  writeJson(path.join(configDir, 'plugins', 'known_marketplaces.json'), {
    'ai-agent-toolkit-local': { source: { source: 'directory', path: runningRoot }, installLocation: runningRoot },
  });
  writeJson(path.join(configDir, 'plugins', 'installed_plugins.json'), {
    version: 2,
    plugins: { 'ai-agent-toolkit@ai-agent-toolkit-local': [{
      scope: 'user', version: BRIDGE_VERSION,
      installPath: path.join(configDir, 'plugins', 'cache', 'ai-agent-toolkit-local', 'ai-agent-toolkit', BRIDGE_VERSION),
    }] },
  });
}

// A managed checkout carrying the Toolkit runtime under test, behind its origin by one commit.
// Its validation stands in for the real one and logs each run, so a test can count validations.
function staleManagedCheckout(root) {
  const origin = path.join(root, 'origin.git');
  const seed = path.join(root, 'seed');
  const managed = path.join(root, 'pc', 'managed');
  git(root, ['init', '--bare', '-b', 'main', origin]);
  fs.mkdirSync(seed, { recursive: true });
  git(seed, ['init', '-b', 'main']);
  git(seed, ['config', 'user.email', 'test@example.invalid']);
  git(seed, ['config', 'user.name', 'Test']);
  for (const dir of ['repo/scripts', 'repo/contracts', '.claude-plugin']) {
    fs.cpSync(path.join(repoRoot, dir), path.join(seed, dir), { recursive: true });
  }
  fs.mkdirSync(path.join(seed, 'skills', 'fixture-skill'), { recursive: true });
  fs.writeFileSync(path.join(seed, 'skills', 'fixture-skill', 'SKILL.md'), '---\nname: fixture-skill\ndescription: Fixture skill\n---\n');
  fs.writeFileSync(path.join(seed, 'repo', 'scripts', 'validate-toolkit.cjs'),
    "'use strict';\nif (process.env.TOOLKIT_TEST_VALIDATION_LOG) require('node:fs').appendFileSync(process.env.TOOLKIT_TEST_VALIDATION_LOG, 'validated\\n');\n");
  fs.mkdirSync(path.join(seed, 'repo', 'tests'), { recursive: true });
  // The hook runs the light test; a manual update runs the full bridge tests.
  for (const name of ['hook-light', '', '-codex', '-claude']) {
    fs.writeFileSync(path.join(seed, 'repo', 'tests', `toolkit-local-bridge${name && `-${name}`.replace('--', '-')}.test.cjs`),
      `'use strict';\nrequire('node:test')('fixture bridge validation${name}', () => {});\n`);
  }
  git(seed, ['add', '.']);
  git(seed, ['commit', '-m', 'runnable fixture']);
  git(seed, ['remote', 'add', 'origin', origin]);
  git(seed, ['push', 'origin', 'main']);
  fs.mkdirSync(path.dirname(managed), { recursive: true });
  git(root, ['clone', origin, managed]);
  fs.writeFileSync(path.join(seed, 'NEWS.txt'), 'one new commit\n');
  git(seed, ['add', '.']);
  git(seed, ['commit', '-m', 'one new commit']);
  git(seed, ['push', 'origin', 'main']);
  return { origin, seed, managed, upstream: git(seed, ['rev-parse', 'HEAD']) };
}

function recordCheckout(root, managed, origin, extra = {}) {
  const hub = path.join(root, '.ai-agent-toolkit', 'current');
  writeJson(path.join(hub, 'state.json'), {
    schema_version: 1, architecture_version: 2, hub_version: BRIDGE_VERSION,
    auto_sync_enabled: true, repo_auto_update_enabled: true, repo_path: managed, repo_branch: 'main', repo_remote: origin,
    bridge_versions_by_source: { 'claude-plugin': BRIDGE_VERSION },
    ...extra,
  });
  return hub;
}

// A Toolkit copy from the claude.ai account, in the Claude desktop app's account-plugin layout.
function accountCopy(root, version = BRIDGE_VERSION) {
  const folder = path.join(root, 'local-app-data', 'Claude-Data', 'claude_test', 'rpm', 'a1', 'b2');
  writeJson(path.join(folder, 'manifest.json'), { plugins: [{ id: 'plugin_test', name: 'ai-agent-toolkit' }] });
  const plugin = path.join(folder, 'plugin_test');
  writeJson(path.join(plugin, '.claude-plugin', 'plugin.json'), { name: 'ai-agent-toolkit', version });
  writeJson(path.join(plugin, 'repo', 'contracts', 'toolkit-local-bridge', 'version.json'), { version });
  return plugin;
}

// The session-start hook as Claude Code runs it: `bridge` is the script of the copy the session
// runs (this checkout's code stands in for an account copy that already carries it).
function hook(root, hub, pluginRoot, { bridge = script, extra = {} } = {}) {
  return spawnSync(process.execPath, [bridge, '--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'claude-plugin'], {
    cwd: root, encoding: 'utf8', timeout: 300000,
    env: env(root, { CLAUDE_PLUGIN_ROOT: pluginRoot, CLAUDE_PROJECT_DIR: root, ...extra }),
  });
}

function validations(log) {
  try { return fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).length; } catch { return 0; }
}

module.exports = {
  repoRoot, script, NOTICE, tmpRoot, writeJson, readJson, git, env, installToolkit,
  staleManagedCheckout, recordCheckout, accountCopy, hook, validations,
};
