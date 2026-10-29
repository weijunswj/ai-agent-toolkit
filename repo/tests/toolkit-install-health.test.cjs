'use strict';
require('./toolkit-test-temp-guard.cjs'); // private temp; fails if real update reports appear

// The install check never reports a check it could not complete as passed. Unit cases use
// stand-in helper and depth owners; the setup cases run setup.cjs against a temporary home,
// Claude config folder and fake setup repo.

const test = require('node:test');
const os = require('node:os');
const { ToolkitInstallHealthCheck, STATUS, claudeAccountPluginFolders, claudeAccountToolkitVersion } = require('../scripts/toolkit-install-health.cjs');
const { ClaudeHelperAgentRenderer } = require('../scripts/toolkit-claude-helper-agents.cjs');
const { ClaudeNamedHelperPolicy } = require('../scripts/toolkit-claude-helper-policy.cjs');
const {
  assert, fs, path, repoRoot, tmpRoot, isolatedHomeEnv, writeFile, run, runTestGit, createGitBackedSetupRepo,
} = require('./toolkit-setup-test-support.cjs');

const VERSION = JSON.parse(fs.readFileSync(path.join(repoRoot, '.claude-plugin', 'plugin.json'), 'utf8')).version;

const CURRENT_GLOBAL_RULES = Object.freeze({ status: 'current', files: [], covered: [], backup_dir: null, detail: '' });
const fakeGlobalRules = (result = CURRENT_GLOBAL_RULES) => ({ refresh: () => { if (result instanceof Error) throw result; return result; } });

function unit(t, { helpers = { status: 'current' }, depth = { state: 'toolkit-one-layer', value: '1' }, recorded = null, globalRules = CURRENT_GLOBAL_RULES } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-install-health-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const hubPath = path.join(root, 'hub');
  if (recorded) writeFile(path.join(hubPath, 'state.json'), JSON.stringify({ bridge_versions_by_source: recorded }));
  const helperDefinitions = {
    refresh: () => { if (helpers instanceof Error) throw helpers; return helpers; },
    check: () => ({ status: 'current', project_overrides: [], detail: '' }),
  };
  return new ToolkitInstallHealthCheck({ toolkitRoot: root, expectedVersion: VERSION, hubPath, helperDefinitions,
    globalRules: fakeGlobalRules(globalRules), depthSetting: { inspect: () => depth } });
}

test('the global rules check passes when current or updated, reports covered sections, and holds on broken markers', (t) => {
  const file = path.join(os.tmpdir(), 'AGENTS.md');
  const updated = unit(t, { globalRules: { status: 'updated', backup_dir: os.tmpdir(), detail: '',
    files: [{ harness: 'codex', file, state: 'current', action: 'refreshed' }], covered: [{ file, title: 'Toolkit Controller Bootstrap' }] } })
    .run({ topology: 'root-only' });
  assert.equal(updated.status, STATUS.PASSED);
  assert.equal(byId(updated, 'global-rules').updated, true, 'a write this run goes into the update report');
  assert.match(byId(updated, 'global-rules').summary, /Codex \(.*AGENTS\.md\): refreshed/);
  assert.match(byId(updated, 'global-rules').summary, /hand-written "Toolkit Controller Bootstrap" section .* Toolkit does not edit it/);
  const held = unit(t, { globalRules: { status: 'held', backup_dir: null, covered: [], detail: 'broken',
    files: [{ harness: 'claude-code', file, state: 'broken', detail: 'BEGIN GLOBAL-RULES without END', action: 'held' }] } }).run({ topology: 'root-only' });
  assert.equal(held.status, STATUS.ACTION);
  assert.match(held.actions.join(' '), /Toolkit markers are broken \(BEGIN GLOBAL-RULES without END\)/);
  const failed = unit(t, { globalRules: new Error('source missing') }).run({ topology: 'root-only' });
  assert.equal(failed.status, STATUS.ACTION);
  assert.match(byId(failed, 'global-rules').summary, /could not be checked: source missing/);
});

const plugin = (root, extra = {}) => ({ installed: true, current: true, running_copy: root, updated_this_run: false, ...extra });
const byId = (result, id) => result.checks.find((entry) => entry.id === id);

test('everything current passes with no actions', (t) => {
  const passed = unit(t).run({ topology: 'root-only' });
  assert.equal(passed.status, STATUS.PASSED);
  assert.deepEqual(passed.actions, []);
  assert.deepEqual(passed.checks.map((entry) => entry.id), ['update-record', 'helpers', 'global-rules', 'depth', 'helper-routes']);
});

test('the helper routes line reports the stored native result for this platform and the known limits', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-install-health-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const record = JSON.parse(fs.readFileSync(path.join(repoRoot, 'repo', 'contracts', 'host-qualification', 'claude-code.json'), 'utf8'));
  writeFile(path.join(root, 'repo', 'contracts', 'host-qualification', 'claude-code.json'), JSON.stringify(record));
  const check = (platform, toolkitRoot = root) => new ToolkitInstallHealthCheck({ toolkitRoot, expectedVersion: VERSION, hubPath: path.join(root, 'hub'),
    helperDefinitions: { refresh: () => ({ status: 'current' }), check: () => ({ status: 'current', project_overrides: [] }) },
    globalRules: fakeGlobalRules(), depthSetting: { inspect: () => ({}) }, platform }).run();
  const linux = byId(check('linux'), 'helper-routes');
  assert.equal(linux.status, STATUS.PASSED, 'informational: nothing for the owner to fix');
  assert.match(linux.summary, /^Qualified on Claude Code 2\.1\.309 \(Linux, 2026-10-23\)\./);
  assert.match(linux.summary, /Known limit: A session started with --agents can redefine a Toolkit helper name/);
  assert.match(byId(check('win32'), 'helper-routes').summary, /^Qualified on Claude Code 2\.1\.310 \(Windows, 2026-10-25\)\./);
  assert.match(byId(check('darwin'), 'helper-routes').summary, /^Not yet qualified on macOS; last qualified on Claude Code 2\.1\.310 \(Windows, 2026-10-25\)\./);
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-install-health-'));
  t.after(() => fs.rmSync(empty, { recursive: true, force: true }));
  assert.equal(byId(check('win32', empty), 'helper-routes').summary, 'Not yet qualified: no stored native result.');
});

test('the plugin check follows the setup facts and the copy Claude Code runs', (t) => {
  const check = unit(t);
  const toolkitRoot = path.dirname(path.join(os.tmpdir(), 'x')); // any folder other than the check root
  const elsewhere = check.run({ plugin: plugin(toolkitRoot), topology: 'root-only' });
  assert.equal(elsewhere.status, STATUS.ACTION);
  assert.match(byId(elsewhere, 'plugin').summary, /does not run Toolkit from the managed checkout/);
  const missing = check.run({ plugin: plugin('', { installed: false, current: false }) });
  assert.equal(missing.status, STATUS.ACTION);
  // Matrix row A10: a missing or disabled plugin (setup's verify fails, so installed is false) is not enforced.
  assert.match(byId(missing, 'plugin').summary, /is not installed, enabled and current in Claude Code, so its hooks are not enforced\./);
  assert.match(missing.actions[0], /Run `setup toolkit` and choose to install or refresh the Claude Code plugin/);
});

test('a same-run install is restart-required, not passed and not action-required', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-install-health-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const check = new ToolkitInstallHealthCheck({ toolkitRoot: root, expectedVersion: VERSION, hubPath: path.join(root, 'hub'),
    helperDefinitions: { refresh: () => ({ status: 'not-installed' }), check: () => ({ project_overrides: [] }) }, globalRules: fakeGlobalRules(),
    depthSetting: { inspect: () => ({ state: 'toolkit-one-layer', value: '1' }) } });
  const result = check.run({ plugin: plugin(root, { updated_this_run: true }), topology: 'root-only' });
  assert.equal(result.status, STATUS.RESTART);
  assert.match(result.actions[0], /Start a new Claude Code session, and close sessions opened before the update/);
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
  const result = claudeSetup(root, setupRepo, origin, ['--enable-codex-doc-limit']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /## Install check\nInstall check: passed\nClaude Code plugin: Claude Code runs Toolkit .+ from the managed checkout\.\nUpdate record: .+\nToolkit helpers: not installed\nGlobal rules: Claude Code \(~\/\.claude\/CLAUDE\.md\): created Codex \(~\/\.codex\/AGENTS\.md\): created (?:Codex config check: [^\n]+? )?Codex project_doc_max_bytes \(~\/\.codex\/config\.toml\): raised to 65536 \(was the default 32768\); --remove puts it back Codex instructions: ~\/\.codex\/AGENTS\.md \d+ B \+ \S+ \d+ B = \d+ B of 65536 B\nClaude Code depth setting: CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1 is set/);
  for (const file of [path.join(root, '.claude', 'CLAUDE.md'), path.join(root, '.codex', 'AGENTS.md')]) {
    assert.match(fs.readFileSync(file, 'utf8'), /^<!-- AI-AGENT-TOOLKIT:repo\/contracts\/agent-rules\/global-rules\.md:BEGIN GLOBAL-RULES v2 /, file);
  }
  // A yes to the setup question raises Codex's instruction limit, inside Toolkit markers.
  assert.match(fs.readFileSync(path.join(root, '.codex', 'config.toml'), 'utf8'), /^# AI-AGENT-TOOLKIT:global-rules:BEGIN PROJECT-DOC-MAX-BYTES previous=none created=yes\nproject_doc_max_bytes = 65536\n/);
});

test('a same-run plugin install reports its facts and new session needed, never a bare refreshed', () => {
  const root = tmpRoot();
  const { origin, setupRepo } = createGitBackedSetupRepo(root);
  const result = run(['--execute', '--host', 'claude-code', '--repo-root', setupRepo, '--repo-remote', origin, '--yes-recommended',
    '--claude-plugin-behavior', 'install'], { env: { ...isolatedHomeEnv(root), SETUP_FAKE_CLAUDE_REFRESH_REQUIRED: '1' }, timeout: 300000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Claude plugin status: installed this run/);
  assert.doesNotMatch(result.stdout, /Claude plugin status: refreshed/);
  assert.match(result.stdout, /Install check: new session needed\n/);
  assert.match(result.stdout, /Next step:\n1\. Start a new Claude Code session, and close sessions opened before the update, so it loads Toolkit \S+\. After that, each session start rechecks the update record, helper definitions, global rules and depth setting, and reports only a problem\./);
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

test('the Projects controller skill check compares the synced claude.ai copy with the repo and blocks nothing', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-projects-skill-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repoVersion = /^Version:\s*(\S+)$/m.exec(fs.readFileSync(path.join(repoRoot, 'repo', 'contracts', 'claude-projects', 'web-controller-projects', 'SKILL.md'), 'utf8'))[1];
  const synced = path.join(root, 'synced');
  const check = () => new ToolkitInstallHealthCheck({ toolkitRoot: repoRoot, expectedVersion: VERSION, hubPath: path.join(root, 'hub'),
    helperDefinitions: { refresh: () => ({ status: 'current' }), check: () => ({ status: 'current', project_overrides: [], detail: '' }) },
    globalRules: fakeGlobalRules(), depthSetting: { inspect: () => ({ state: 'toolkit-one-layer', value: '1' }) }, syncedSkillsDir: synced })
    .run({ refreshHelpers: false }).checks.find((entry) => entry.id === 'projects-skill');
  assert.equal(check(), undefined, 'no synced copy: nothing is shown');
  writeFile(path.join(synced, 'abc_def', 'web-controller-projects', 'SKILL.md'), '---\nname: web-controller-projects\n---\nVersion: 2026-01-01.1\n');
  const older = check();
  assert.equal(older.status, STATUS.PASSED);
  // The update is offered as a skill card; uploading by hand is only the fallback without a card tool.
  assert.match(older.summary, new RegExp(`Your uploaded copy is 2026-01-01\\.1; Toolkit has ${repoVersion.replace('.', '\\.')}\\. Skill card: offer \\S*web-controller-projects/SKILL\\.md as a skill update card to save\\. Without a card tool, upload the folder \\S*web-controller-projects to claude\\.ai`));
  const reference = path.join(synced, 'abc_def', 'web-controller-projects', 'reference');
  fs.cpSync(path.join(repoRoot, 'repo', 'contracts', 'claude-projects', 'web-controller-projects', 'reference'), reference, { recursive: true });
  assert.match(check().summary, /Skill card: offer/, 'reference files equal to Toolkit\'s: a card is enough');
  writeFile(path.join(reference, 'recurring-tasks.md'), 'edited on the account\n');
  const edited = check();
  assert.match(edited.summary, /Your copy has its own reference files, so a skill card is not enough: upload the folder \S*web-controller-projects to claude\.ai/);
  assert.doesNotMatch(edited.summary, /Skill card: offer/);
  writeFile(path.join(synced, 'abc_def', 'web-controller-projects', 'SKILL.md'), `Version: ${repoVersion}\n`);
  assert.match(check().summary, /Your uploaded copy is current/);
});

test('the Claude app account copy check reports an older claude.ai copy with the fix, reads only, and blocks nothing', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-account-plugin-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const localAppData = path.join(root, 'LocalAppData');
  const folder = path.join(localAppData, 'Claude-Data', 'claude_example', 'rpm', 'aaa', 'bbb');
  const put = (rel, value) => { fs.mkdirSync(path.dirname(path.join(folder, rel)), { recursive: true }); fs.writeFileSync(path.join(folder, rel), JSON.stringify(value)); };
  const check = (folders) => new ToolkitInstallHealthCheck({ toolkitRoot: repoRoot, expectedVersion: '9.9.1', hubPath: path.join(root, 'hub'),
    helperDefinitions: { refresh: () => ({ status: 'current' }), check: () => ({ status: 'current', project_overrides: [], detail: '' }) },
    globalRules: fakeGlobalRules(), depthSetting: { inspect: () => ({ state: 'toolkit-one-layer', value: '1' }) }, accountPluginFolders: folders })
    .run({ refreshHelpers: false });
  const find = (result) => result.checks.find((entry) => entry.id === 'account-plugin');

  assert.deepEqual(claudeAccountPluginFolders({}), [], 'no LOCALAPPDATA: no folders');
  assert.deepEqual(claudeAccountPluginFolders({ LOCALAPPDATA: localAppData }), [], 'no Claude app data: no folders');
  assert.equal(find(check(null)), undefined, 'skipped when no folders are given');

  put('manifest.json', { plugins: [{ id: 'plugin_other', name: 'something-else' }, { id: 'plugin_toolkit', name: 'ai-agent-toolkit' }] });
  put('plugin_toolkit/.claude-plugin/plugin.json', { name: 'ai-agent-toolkit', version: '9.8.0' });
  const folders = claudeAccountPluginFolders({ LOCALAPPDATA: localAppData });
  assert.deepEqual(folders, [folder]);
  assert.equal(claudeAccountToolkitVersion(folders), '9.8.0');
  const before = fs.readFileSync(path.join(folder, 'manifest.json'));
  const result = check(folders);
  const older = find(result);
  assert.equal(older.status, STATUS.PASSED, 'an older account copy never blocks');
  assert.equal(result.status, STATUS.PASSED);
  assert.match(older.summary, /Your claude\.ai account copy of Toolkit is 9\.8\.0; this computer has 9\.9\.1\. The Claude app runs the account copy, and claude\.ai updates it from Toolkit's main branch: check that Sync automatically is on for the ai-agent-toolkit marketplace in claude\.ai, and if the copy stays behind, remove that marketplace and add it again\./);
  assert.doesNotMatch(older.summary, /plugin_toolkit|claude_example|LocalAppData/, 'no ids or paths in the report');
  assert.ok(fs.readFileSync(path.join(folder, 'manifest.json')).equals(before), 'the check never writes');

  put('plugin_toolkit/.claude-plugin/plugin.json', { name: 'ai-agent-toolkit', version: '9.9.1' });
  assert.match(find(check(folders)).summary, /Your claude\.ai account copy of Toolkit is current \(9\.9\.1\)\./);

  // Unsafe ids and malformed versions are ignored, so nothing is reported.
  put('manifest.json', { plugins: [{ id: '../escape', name: 'ai-agent-toolkit' }] });
  assert.equal(find(check(folders)), undefined);
  put('manifest.json', { plugins: [{ id: 'plugin_toolkit', name: 'ai-agent-toolkit' }] });
  put('plugin_toolkit/.claude-plugin/plugin.json', { version: 'latest' });
  assert.equal(find(check(folders)), undefined);
});
