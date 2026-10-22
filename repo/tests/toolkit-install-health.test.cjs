'use strict';
require('./toolkit-test-temp-guard.cjs'); // private temp; fails if real update reports appear

// The install check never reports a check it could not complete as passed. Unit cases use
// stand-in helper and depth owners; the setup cases run setup.cjs against a temporary home,
// Claude config folder and fake setup repo.

const test = require('node:test');
const os = require('node:os');
const { ToolkitInstallHealthCheck, STATUS } = require('../scripts/toolkit-install-health.cjs');
const { ClaudeHelperAgentRenderer } = require('../scripts/toolkit-claude-helper-agents.cjs');
const { ClaudeNamedHelperPolicy } = require('../scripts/toolkit-claude-helper-policy.cjs');
const {
  assert, fs, path, repoRoot, tmpRoot, isolatedHomeEnv, writeFile, run, runTestGit, createGitBackedSetupRepo,
} = require('./toolkit-setup-test-support.cjs');

const VERSION = JSON.parse(fs.readFileSync(path.join(repoRoot, '.claude-plugin', 'plugin.json'), 'utf8')).version;

function unit(t, { helpers = { status: 'current' }, depth = { state: 'toolkit-one-layer', value: '1' }, recorded = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-install-health-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const hubPath = path.join(root, 'hub');
  if (recorded) writeFile(path.join(hubPath, 'state.json'), JSON.stringify({ bridge_versions_by_source: recorded }));
  const helperDefinitions = {
    refresh: () => { if (helpers instanceof Error) throw helpers; return helpers; },
    check: () => ({ status: 'current', project_overrides: [], detail: '' }),
  };
  return new ToolkitInstallHealthCheck({ toolkitRoot: root, expectedVersion: VERSION, hubPath, helperDefinitions, depthSetting: { inspect: () => depth } });
}

const plugin = (root, extra = {}) => ({ installed: true, current: true, running_copy: root, updated_this_run: false, ...extra });
const byId = (result, id) => result.checks.find((entry) => entry.id === id);

test('everything current passes with no actions', (t) => {
  const passed = unit(t).run({ topology: 'root-only' });
  assert.equal(passed.status, STATUS.PASSED);
  assert.deepEqual(passed.actions, []);
  assert.deepEqual(passed.checks.map((entry) => entry.id), ['update-record', 'helpers', 'depth']);
});

test('the plugin check follows the setup facts and the copy Claude Code runs', (t) => {
  const check = unit(t);
  const toolkitRoot = path.dirname(path.join(os.tmpdir(), 'x')); // any folder other than the check root
  const elsewhere = check.run({ plugin: plugin(toolkitRoot), topology: 'root-only' });
  assert.equal(elsewhere.status, STATUS.ACTION);
  assert.match(byId(elsewhere, 'plugin').summary, /does not run Toolkit from the managed checkout/);
  const missing = check.run({ plugin: plugin('', { installed: false, current: false }) });
  assert.equal(missing.status, STATUS.ACTION);
  assert.match(missing.actions[0], /Run `setup toolkit` and choose to install or refresh the Claude Code plugin/);
});

test('a same-run install is restart-required, not passed and not action-required', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-install-health-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const check = new ToolkitInstallHealthCheck({ toolkitRoot: root, expectedVersion: VERSION, hubPath: path.join(root, 'hub'),
    helperDefinitions: { refresh: () => ({ status: 'not-installed' }), check: () => ({ project_overrides: [] }) },
    depthSetting: { inspect: () => ({ state: 'toolkit-one-layer', value: '1' }) } });
  const result = check.run({ plugin: plugin(root, { updated_this_run: true }), topology: 'root-only' });
  assert.equal(result.status, STATUS.RESTART);
  assert.match(result.actions[0], /Restart Claude Code/);
});

test('a recorded version newer than the install is action-required with the one-time recovery', (t) => {
  const result = unit(t, { recorded: { 'claude-plugin': '99.0.0', 'codex-plugin': '99.0.0' } }).run();
  assert.equal(result.status, STATUS.ACTION);
  assert.match(byId(result, 'update-record').summary, /claude-plugin 99\.0\.0/);
  assert.doesNotMatch(byId(result, 'update-record').summary, /codex-plugin/, 'Codex keeps its own record');
  assert.match(result.actions[0], /--sync-source claude-plugin --force-downgrade/);
});

test('helper definitions: refreshed passes, held or failed is action-required, never passed', (t) => {
  assert.match(byId(unit(t, { helpers: { status: 'updated', backup_dir: 'B' } }).run(), 'helpers').summary, /updated this run \(backup: B\)/);
  assert.equal(byId(unit(t, { helpers: { status: 'not-installed' } }).run(), 'helpers').summary, 'not installed');
  const held = unit(t, { helpers: { status: 'held', detail: 'toolkit-g1-helper.md was not written by Toolkit.' } }).run();
  assert.equal(held.status, STATUS.ACTION);
  assert.equal(held.actions[0], 'toolkit-g1-helper.md was not written by Toolkit.');
  const failed = unit(t, { helpers: new Error('disk full') }).run();
  assert.equal(failed.status, STATUS.ACTION);
  assert.match(byId(failed, 'helpers').summary, /could not be checked: disk full/);
});

test('the depth setting must match the selected topology', (t) => {
  const state = (depth, topology) => unit(t, { depth }).run({ topology });
  assert.equal(state({ state: 'owner-value', value: '1' }, 'root-only').status, STATUS.PASSED);
  const missing = state({ state: 'claude-default' }, 'root-only');
  assert.equal(missing.status, STATUS.ACTION);
  assert.match(missing.actions[0], /choose root-only to set it/);
  const deeper = state({ state: 'owner-value', value: '2' }, 'root-only');
  assert.equal(deeper.status, STATUS.ACTION);
  assert.match(byId(deeper, 'depth').summary, /Toolkit does not change a value you set/);
  assert.equal(state({ state: 'toolkit-one-layer', value: '1' }, 'broader-native').status, STATUS.ACTION);
  assert.equal(state({ state: 'claude-default' }, 'broader-native').status, STATUS.PASSED);
  assert.equal(state({ state: 'unreadable', detail: 'The Claude Code user settings file is not valid JSON.' }, 'root-only').status, STATUS.ACTION);
  assert.equal(byId(state({ state: 'claude-default' }, null), 'depth'), undefined, 'no topology, no depth check');
});

// ---- setup execution ----

function claudeSetup(root, setupRepo, origin, extra = [], env = {}) {
  return run(['--execute', '--host', 'claude-code', '--repo-root', setupRepo, '--repo-remote', origin, '--yes-recommended',
    '--claude-plugin-behavior', 'instructions', ...extra], { env: { ...isolatedHomeEnv(root), ...env }, timeout: 300000 });
}

test('setup reports a newer recorded Toolkit version as action required and exits non-zero', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  writeFile(path.join(root, '.ai-agent-toolkit', 'current', 'state.json'), JSON.stringify({ bridge_versions_by_source: { 'claude-plugin': '99.0.0' } }));
  const result = claudeSetup(root, setupRepo, origin);
  assert.equal(result.status, 24, result.stderr || result.stdout);
  assert.match(result.stdout, /## Install check\nInstall check: action required\n/);
  assert.match(result.stdout, /Update record: The update record holds a newer version \(claude-plugin 99\.0\.0\)/);
  assert.match(result.stdout, /What to do:\n1\. If .+ is the version you want, clear the record once with: node ".+" --sync-enabled --write --sync-source claude-plugin --force-downgrade/);
});

test('the setup install check reads the update record in the hub that --hub names', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const hub = path.join(root, 'candidate-hub', 'current');
  writeFile(path.join(hub, 'state.json'), JSON.stringify({ bridge_versions_by_source: { 'claude-plugin': '99.0.0' } }));
  const result = claudeSetup(root, setupRepo, origin, ['--hub', hub]);
  assert.equal(result.status, 24, result.stderr || result.stdout);
  assert.match(result.stdout, /Update record: The update record holds a newer version \(claude-plugin 99\.0\.0\)/);
  assert.equal(fs.existsSync(path.join(root, '.ai-agent-toolkit', 'current', 'state.json')), false, 'the default hub is not read or written');
});

test('setup reports root-only with a deeper owner depth value as action required', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  writeFile(path.join(root, '.claude', 'settings.json'), `${JSON.stringify({ env: { CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '2' } })}\n`);
  const result = claudeSetup(root, setupRepo, origin, ['--claude-topology', 'root-only']);
  assert.equal(result.status, 24, result.stderr || result.stdout);
  assert.match(result.stdout, /Claude Code depth setting: Your Claude Code user settings set CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=2/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8')).env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH, '2', 'owner value kept');
});

test('a clean Claude setup passes the install check and exits 0', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const result = claudeSetup(root, setupRepo, origin);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /## Install check\nInstall check: passed\nClaude Code plugin: Claude Code runs Toolkit .+ from the managed checkout\.\nUpdate record: .+\nToolkit helpers: not installed\nClaude Code depth setting: CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1 is set/);
});

test('a same-run plugin install reports its facts and restart required, never a bare refreshed', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const result = run(['--execute', '--host', 'claude-code', '--repo-root', setupRepo, '--repo-remote', origin, '--yes-recommended',
    '--claude-plugin-behavior', 'install'], { env: { ...isolatedHomeEnv(root), SETUP_FAKE_CLAUDE_REFRESH_REQUIRED: '1' }, timeout: 300000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Claude plugin status: installed this run/);
  assert.doesNotMatch(result.stdout, /Claude plugin status: refreshed/);
  assert.match(result.stdout, /Install check: restart required\n/);
  assert.match(result.stdout, /Next step:\n1\. Restart Claude Code so it loads Toolkit \S+\. After that, each session start rechecks the update record, helper definitions and depth setting, and reports only a problem\./);
});

test('setup refreshes Toolkit helper definitions made stale by a stack registry change', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  // Registry A: the definitions are rendered from the real registry and installed.
  const registryRel = path.join('repo', 'contracts', 'controller-kernel', 'stack-registry-v3.json');
  writeFile(path.join(setupRepo, registryRel), fs.readFileSync(path.join(repoRoot, registryRel), 'utf8'));
  const agents = path.join(root, '.claude', 'agents');
  for (const role of ['G0', 'G1']) {
    const { file, text } = ClaudeHelperAgentRenderer.fromRepository('owner-claude', setupRepo).render(role);
    writeFile(path.join(agents, file), text);
  }
  // Registry A': one byte changes, as an auto-update of the managed checkout would.
  fs.appendFileSync(path.join(setupRepo, registryRel), '\n');
  runTestGit(setupRepo, ['add', '.']);
  runTestGit(setupRepo, ['commit', '-m', 'registry A prime']);
  runTestGit(setupRepo, ['push', 'origin', 'main']);
  const policy = new ClaudeNamedHelperPolicy({ toolkitRoot: setupRepo, environment: { CLAUDE_CONFIG_DIR: path.join(root, '.claude') } });
  const launch = { tool_input: { subagent_type: 'toolkit-g0-helper' }, cwd: root };
  assert.equal(policy.decide(launch, {}).hookSpecificOutput?.permissionDecision, 'deny', 'stale before setup');

  const result = claudeSetup(root, setupRepo, origin);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Toolkit helpers: updated this run \(backup: .+\)/);
  assert.deepEqual(policy.decide(launch, {}), {}, 'the hook policy admits the refreshed helper');
});
