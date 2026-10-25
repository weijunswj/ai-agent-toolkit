'use strict';
require('./toolkit-test-temp-guard.cjs'); // private temp; fails if real update reports appear

// The Claude Code session-start hook runs only from the installed Toolkit copy, and checks
// the install after its maintenance. Every case uses a temporary home, Claude config folder
// and hub; the Toolkit copy Claude Code runs is recorded in a temporary plugin registry.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { BRIDGE_VERSION } = require('../scripts/toolkit-local-bridge.cjs');
const { ClaudeHelperAgentRenderer } = require('../scripts/toolkit-claude-helper-agents.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');
const script = path.join(repoRoot, 'repo', 'scripts', 'toolkit-local-bridge.cjs');
const UNINSTALLED_LINE = /^Toolkit: this session runs an uninstalled Toolkit copy \(.+\); session-start maintenance is skipped and nothing is recorded\.$/m;

function tmpRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-claude-install-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

// Records `runningRoot` as the installed Toolkit copy, the way `claude plugin marketplace add`
// and `claude plugin install` record it (shape measured on Claude Code 2.1.306).
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
  return configDir;
}

function env(root, extra = {}) {
  return {
    ...process.env,
    USERPROFILE: root,
    HOME: root,
    LOCALAPPDATA: path.join(root, 'local-app-data'),
    CLAUDE_CONFIG_DIR: path.join(root, '.claude'),
    AI_AGENT_TOOLKIT_CONTROL_ROOT: path.join(root, '.ai-agent-toolkit', 'agent-control'),
    ...extra,
  };
}

function hook(root, hub, pluginRoot) {
  return spawnSync(process.execPath, [script, '--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'claude-plugin'], {
    cwd: root, encoding: 'utf8', timeout: 120000, env: env(root, { CLAUDE_PLUGIN_ROOT: pluginRoot, CLAUDE_PROJECT_DIR: root }),
  });
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function treeDigest(dir) {
  const hash = crypto.createHash('sha256');
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      hash.update(path.relative(dir, full));
      if (entry.isDirectory()) walk(full);
      else hash.update(fs.readFileSync(full));
    }
  };
  walk(dir);
  return hash.digest('hex');
}

function reports() {
  const dir = path.join(os.tmpdir(), 'ai-agent-toolkit', 'update-reports');
  try { return fs.readdirSync(dir).filter((name) => name.endsWith('.md')).map((name) => fs.readFileSync(path.join(dir, name), 'utf8')); }
  catch { return []; }
}

// A managed checkout with a reachable origin and one unpulled commit, so a hook from the
// installed copy would fast-forward it.
function managedCheckout(root) {
  const origin = path.join(root, 'origin.git');
  const managed = path.join(root, 'managed');
  const seed = path.join(root, 'seed');
  fs.mkdirSync(seed, { recursive: true });
  git(root, ['init', '--bare', '-b', 'main', origin]);
  git(seed, ['init', '-b', 'main']);
  git(seed, ['config', 'user.email', 'test@example.invalid']);
  git(seed, ['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(seed, 'README.md'), 'one\n');
  git(seed, ['add', '.']);
  git(seed, ['commit', '-m', 'one']);
  git(seed, ['remote', 'add', 'origin', origin]);
  git(seed, ['push', 'origin', 'main']);
  git(root, ['clone', origin, managed]);
  fs.writeFileSync(path.join(seed, 'README.md'), 'two\n');
  git(seed, ['commit', '-am', 'two']);
  git(seed, ['push', 'origin', 'main']);
  return managed;
}

// A fake Toolkit source checkout at `dir` carrying `version`.
function fakeToolkit(dir, version) {
  writeJson(path.join(dir, '.claude-plugin', 'plugin.json'), { name: 'ai-agent-toolkit', version });
  writeJson(path.join(dir, 'repo', 'contracts', 'toolkit-local-bridge', 'version.json'), { version });
}

const STALE_LINE = /^Toolkit: this copy is (\S+), older than the (\S+) in the Toolkit repository at (.+), so safety hooks added since then \(for example the force-push guard\) do not run in this session\. Ask the owner to refresh the account's Toolkit plugin copy\.$/m;

test('an uninstalled copy older than a Toolkit repository in the session folder says it is stale', (t) => {
  const root = tmpRoot(t);
  const hub = path.join(root, '.ai-agent-toolkit', 'current');
  const [major] = BRIDGE_VERSION.split('.');
  const newer = `${Number(major) + 1}.0.0`;
  // A cloud session starts in the folder its repositories are cloned into.
  fakeToolkit(path.join(root, 'ai-agent-toolkit'), newer);
  const result = hook(root, hub, repoRoot);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, UNINSTALLED_LINE);
  const match = result.stdout.match(STALE_LINE);
  assert.ok(match, result.stdout);
  assert.equal(match[1], BRIDGE_VERSION);
  assert.equal(match[2], newer);
  assert.ok(match[3].endsWith('/ai-agent-toolkit'), match[3]);
});

test('an uninstalled copy says nothing more when the repository in the session folder is not newer', (t) => {
  const root = tmpRoot(t);
  const hub = path.join(root, '.ai-agent-toolkit', 'current');
  fakeToolkit(path.join(root, 'same'), BRIDGE_VERSION);
  fakeToolkit(path.join(root, 'older'), '0.0.1');
  writeJson(path.join(root, 'other', '.claude-plugin', 'plugin.json'), { name: 'another-plugin', version: '999.0.0' });
  writeJson(path.join(root, 'other', 'repo', 'contracts', 'toolkit-local-bridge', 'version.json'), { version: '999.0.0' });
  const result = hook(root, hub, repoRoot);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, UNINSTALLED_LINE);
  assert.doesNotMatch(result.stdout, STALE_LINE);
});

test('a session started from an uninstalled Toolkit copy writes no update state and leaves the managed checkout alone', (t) => {
  const root = tmpRoot(t);
  const managed = managedCheckout(root);
  installToolkit(root, managed);
  const hub = path.join(root, '.ai-agent-toolkit', 'current');
  writeJson(path.join(hub, 'state.json'), {
    schema_version: 1, architecture_version: 2, hub_version: BRIDGE_VERSION,
    auto_sync_enabled: true, repo_auto_update_enabled: true, repo_path: managed, repo_branch: 'main',
    bridge_versions_by_source: { 'claude-plugin': BRIDGE_VERSION },
  });
  const hubBefore = treeDigest(hub);
  const headBefore = git(managed, ['rev-parse', 'HEAD']);
  const reportsBefore = reports().length;

  // A test candidate loaded with --plugin-dir runs from its own folder.
  const result = hook(root, hub, repoRoot);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, UNINSTALLED_LINE);
  assert.equal(result.stdout.trim().split(/\r?\n/).length, 1, result.stdout);
  assert.equal(treeDigest(hub), hubBefore, 'hub state, ledger and snapshot are untouched');
  assert.equal(git(managed, ['rev-parse', 'HEAD']), headBefore, 'managed checkout not fast-forwarded');
  assert.equal(reports().length, reportsBefore, 'no update report');
});

test('a registered copy that is not the managed checkout in the hub state is treated as uninstalled', (t) => {
  const root = tmpRoot(t);
  const managed = managedCheckout(root);
  // Claude Code's registry names this folder, but the hub records a different managed checkout.
  installToolkit(root, repoRoot);
  const hub = path.join(root, '.ai-agent-toolkit', 'current');
  writeJson(path.join(hub, 'state.json'), {
    schema_version: 1, architecture_version: 2, hub_version: BRIDGE_VERSION,
    auto_sync_enabled: true, repo_auto_update_enabled: true, repo_path: managed, repo_branch: 'main',
    bridge_versions_by_source: { 'claude-plugin': BRIDGE_VERSION },
  });
  const hubBefore = treeDigest(hub);
  const headBefore = git(managed, ['rev-parse', 'HEAD']);
  const result = hook(root, hub, repoRoot);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, UNINSTALLED_LINE);
  assert.equal(treeDigest(hub), hubBefore);
  assert.equal(git(managed, ['rev-parse', 'HEAD']), headBefore);

  // With no managed checkout recorded at all, nothing is the managed install either.
  writeJson(path.join(hub, 'state.json'), { schema_version: 1, architecture_version: 2, hub_version: '1.0.0', auto_sync_enabled: true });
  const unrecorded = hook(root, hub, repoRoot);
  assert.equal(unrecorded.status, 0, unrecorded.stderr);
  assert.match(unrecorded.stdout, UNINSTALLED_LINE);
});

test('the installed copy is recognised in any path spelling and keeps its session-start maintenance', (t) => {
  const root = tmpRoot(t);
  installToolkit(root, repoRoot);
  const hub = path.join(root, '.ai-agent-toolkit', 'current');
  writeJson(path.join(hub, 'state.json'), { schema_version: 1, architecture_version: 2, hub_version: '1.0.0', auto_sync_enabled: true, repo_path: repoRoot });
  // Claude Code passes CLAUDE_PLUGIN_ROOT with forward slashes; Windows paths are case-insensitive.
  const spelled = process.platform === 'win32' ? repoRoot.replace(/\\/g, '/').toUpperCase() : repoRoot;
  const result = hook(root, hub, spelled);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, UNINSTALLED_LINE);
  const state = JSON.parse(fs.readFileSync(path.join(hub, 'state.json'), 'utf8'));
  assert.equal(state.bridge_versions_by_source['claude-plugin'], BRIDGE_VERSION);
  assert.equal(state.last_sync_source, 'claude-plugin');
});

test('a newer recorded version names the likely cause and the one-step recovery', (t) => {
  const root = tmpRoot(t);
  installToolkit(root, repoRoot);
  const hub = path.join(root, '.ai-agent-toolkit', 'current');
  writeJson(path.join(hub, 'state.json'), {
    schema_version: 1, architecture_version: 2, hub_version: BRIDGE_VERSION, auto_sync_enabled: true, repo_path: repoRoot,
    bridge_versions_by_source: { 'claude-plugin': '99.0.0' },
  });
  const before = treeDigest(hub);
  const result = hook(root, hub, repoRoot);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /a newer Toolkit copy, such as a test candidate, ran a session here/);
  assert.match(result.stdout, /--sync-source claude-plugin --force-downgrade/);
  assert.match(result.stdout, /Otherwise run `setup toolkit` to install the newer version/);
  assert.doesNotMatch(result.stdout, /claude plugin update|plugin cache is stale/);
  assert.equal(treeDigest(hub), before);
});

test('session start refreshes a stale Toolkit helper definition and reports it', (t) => {
  const root = tmpRoot(t);
  installToolkit(root, repoRoot);
  const hub = path.join(root, '.ai-agent-toolkit', 'current');
  writeJson(path.join(hub, 'state.json'), { schema_version: 1, architecture_version: 2, hub_version: '1.0.0', auto_sync_enabled: true, repo_path: repoRoot });
  const renderer = ClaudeHelperAgentRenderer.fromRepository('owner-claude', repoRoot);
  const agents = path.join(root, '.claude', 'agents');
  fs.mkdirSync(agents, { recursive: true });
  // Rendered from an older stack registry: same stack and route, different registry digest.
  for (const role of ['G0', 'G1']) {
    const { file, text } = renderer.render(role);
    fs.writeFileSync(path.join(agents, file), text.replace(/SHA-256 `[0-9a-f]{64}`/, `SHA-256 \`${'0'.repeat(64)}\``));
  }
  const result = hook(root, hub, repoRoot);
  assert.equal(result.status, 0, result.stderr);
  for (const role of ['G0', 'G1']) {
    const { file, text } = renderer.render(role);
    assert.equal(fs.readFileSync(path.join(agents, file), 'utf8'), text, `${file} refreshed`);
  }
  const report = reports().find((text) => /## Install check/.test(text) && /Toolkit helpers: updated this run/.test(text));
  assert.ok(report, 'the update report records the refresh');
  assert.match(report, /- Result: `passed`/);
});

test('session start reports a newer recorded repo version as action required', (t) => {
  const root = tmpRoot(t);
  installToolkit(root, repoRoot);
  const hub = path.join(root, '.ai-agent-toolkit', 'current');
  writeJson(path.join(hub, 'state.json'), {
    schema_version: 1, architecture_version: 2, hub_version: '1.0.0', auto_sync_enabled: true, repo_path: repoRoot,
    bridge_versions_by_source: { repo: '99.0.0' },
  });
  const result = hook(root, hub, repoRoot);
  assert.equal(result.status, 0, result.stderr);
  const report = reports().find((text) => /## Install check/.test(text) && /action-required/.test(text));
  assert.ok(report, 'an action-required report is written');
  assert.match(report, /Action needed: see Install check below/);
  assert.match(report, /Update record: The update record holds a newer version \(repo 99\.0\.0\)/);
  assert.match(report, /--sync-source repo --force-downgrade/);
});

// A managed checkout that carries the Toolkit runtime Claude Code runs from it, with stand-in
// validation so the update path stays fast. Fixture data only: no real Toolkit state is read.
function runnableManagedCheckout(root) {
  const origin = path.join(root, 'origin.git');
  const seed = path.join(root, 'seed');
  const managed = path.join(root, 'managed');
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
  fs.writeFileSync(path.join(seed, 'repo', 'scripts', 'validate-toolkit.cjs'), "'use strict';\n");
  fs.mkdirSync(path.join(seed, 'repo', 'tests'), { recursive: true });
  fs.writeFileSync(path.join(seed, 'repo', 'tests', 'toolkit-local-bridge-hook-light.test.cjs'),
    "'use strict';\nrequire('node:test')('fixture hook-light validation', () => {});\n");
  git(seed, ['add', '.']);
  git(seed, ['commit', '-m', 'runnable fixture']);
  git(seed, ['remote', 'add', 'origin', origin]);
  git(seed, ['push', 'origin', 'main']);
  git(root, ['clone', origin, managed]);
  return { origin, seed, managed };
}

test('an automatic update that changes the stack registry refreshes the installed helper definitions', (t) => {
  const root = tmpRoot(t);
  const { origin, seed, managed } = runnableManagedCheckout(root);
  installToolkit(root, managed);
  const hub = path.join(root, '.ai-agent-toolkit', 'current');
  writeJson(path.join(hub, 'state.json'), {
    schema_version: 1, architecture_version: 2, hub_version: BRIDGE_VERSION,
    auto_sync_enabled: true, repo_auto_update_enabled: true, repo_path: managed, repo_branch: 'main', repo_remote: origin,
    bridge_versions_by_source: { 'claude-plugin': BRIDGE_VERSION },
  });
  const agents = path.join(root, '.claude', 'agents');
  fs.mkdirSync(agents, { recursive: true });
  for (const role of ['G0', 'G1']) {
    const { file, text } = ClaudeHelperAgentRenderer.fromRepository('owner-claude', managed).render(role);
    fs.writeFileSync(path.join(agents, file), text);
  }

  // Upstream changes the registry bytes (same routes, new digest), so the installed helpers go stale.
  const registry = path.join(seed, 'repo', 'contracts', 'controller-kernel', 'stack-registry-v3.json');
  fs.writeFileSync(registry, `${JSON.stringify(JSON.parse(fs.readFileSync(registry, 'utf8')))}\n`);
  git(seed, ['commit', '-am', 'compact the stack registry']);
  git(seed, ['push', 'origin', 'main']);
  const updated = git(seed, ['rev-parse', 'HEAD']);

  const result = spawnSync(process.execPath, [path.join(managed, 'repo', 'scripts', 'toolkit-local-bridge.cjs'),
    '--hub', hub, '--hook', '--sync-enabled', '--write', '--sync-source', 'claude-plugin'], {
    cwd: root, encoding: 'utf8', timeout: 300000, env: env(root, { CLAUDE_PLUGIN_ROOT: managed }),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, UNINSTALLED_LINE);
  assert.equal(git(managed, ['rev-parse', 'HEAD']), updated, 'the managed checkout was fast-forwarded');
  for (const role of ['G0', 'G1']) {
    const { file, text } = ClaudeHelperAgentRenderer.fromRepository('owner-claude', managed).render(role);
    assert.equal(fs.readFileSync(path.join(agents, file), 'utf8'), text, `${file} rendered from the updated registry`);
  }
  const report = reports().find((text) => /Toolkit helpers: updated this run/.test(text) && text.includes(updated));
  assert.ok(report, 'the update report records the refresh');
});
