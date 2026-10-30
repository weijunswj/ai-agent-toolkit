'use strict';
require('./toolkit-test-temp-guard.cjs'); // private temp; fails if real update reports appear

// The Codex reader reads files only. Each case builds a temporary Codex home (config.toml and the
// installed plugin cache) and a managed copy, then checks the reader, the Claude Code session-start
// line and the setup rows built from it.

const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CodexToolkitInstall, codexReminderLine, docLimitState, describeHookStates, readToolkitHookStates } = require('../scripts/toolkit-codex-install-state.cjs');
const { ToolkitInstallHealthCheck, STATUS } = require('../scripts/toolkit-install-health.cjs');
const core = require('../scripts/setup-toolkit-core.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');
const HOOKS = fs.readFileSync(path.join(repoRoot, '.codex-plugin', 'hooks', 'hooks.json'), 'utf8');
const ID = 'ai-agent-toolkit@ai-agent-toolkit-local';
const KEYS = ['session_start:0:0', 'user_prompt_submit:0:0', 'pre_tool_use:0:0', 'pre_tool_use:1:0', 'post_tool_use:0:0', 'stop:0:0'];
const ALL_NAMES = 'Session start updates, Prompt check, Shell and agent check, File edit check, Checkpoint after tool use, Checkpoint at stop';

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

// hooks: one of 'on' | 'off' | 'none' | 'trusted' per hook key, or one value for all six.
function hookTables(hooks) {
  return KEYS.map((key, index) => {
    const state = Array.isArray(hooks) ? hooks[index] : hooks;
    if (state === 'none') return '';
    const header = `[hooks.state."${ID}:.codex-plugin/hooks/hooks.json:${key}"]`;
    if (state === 'trusted') return `${header}\ntrusted_hash = "sha256:${'a'.repeat(64)}"\n`;
    return `${header}\ntrusted_hash = "sha256:${'b'.repeat(64)}"\nenabled = ${state === 'on'}\n`;
  }).join('\n');
}

function fixture(t, { versions = ['3.19.3'], source = '3.19.3', plugin = 'true', hooks = 'on', docLimit = 'raised', config = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-codex-state-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const codexHome = path.join(root, '.codex');
  const managed = path.join(root, 'managed');
  write(path.join(managed, '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'ai-agent-toolkit', version: source }));
  for (const version of versions) {
    const cache = path.join(codexHome, 'plugins', 'cache', 'ai-agent-toolkit-local', 'ai-agent-toolkit', version);
    write(path.join(cache, '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'ai-agent-toolkit', version }));
    write(path.join(cache, '.codex-plugin', 'hooks', 'hooks.json'), HOOKS);
  }
  const limit = { raised: '# AI-AGENT-TOOLKIT:global-rules:BEGIN PROJECT-DOC-MAX-BYTES previous=none\nproject_doc_max_bytes = 65536\n# AI-AGENT-TOOLKIT:global-rules:END PROJECT-DOC-MAX-BYTES\n',
    yours: 'project_doc_max_bytes = 40000\n', off: 'project_doc_max_bytes = 0\n', absent: '' }[docLimit];
  const text = [
    limit,
    '[marketplaces.ai-agent-toolkit-local]', 'source_type = "local"', `source = '\\\\?\\${managed}'`, '',
    ...(plugin === null ? [] : [`[plugins."${ID}"]`, `enabled = ${plugin}`, '']),
    '[hooks.state]', '', hookTables(hooks),
  ].join('\n');
  if (config === true) write(path.join(codexHome, 'config.toml'), text);
  else if (config === 'unreadable') fs.mkdirSync(path.join(codexHome, 'config.toml'), { recursive: true });
  else fs.mkdirSync(codexHome, { recursive: true });
  return { root, codexHome, managed, read: () => new CodexToolkitInstall({ codexHome, managedRoot: managed }).read() };
}

test('the reader names the version, on/off state, marketplace, instruction limit and each hook from the files', (t) => {
  const { read, managed } = fixture(t);
  const state = read();
  assert.equal(state.present, true);
  assert.equal(state.config, 'read');
  assert.equal(state.plugin, 'on');
  assert.deepEqual(state.versions, ['3.19.3']);
  assert.equal(state.version, '3.19.3');
  assert.equal(state.sourceVersion, '3.19.3');
  assert.equal(state.older, false);
  assert.equal(state.marketplacePath, managed, 'the Windows \\\\?\\ prefix is dropped');
  assert.equal(state.cacheFresh, null, 'the file comparison runs only when asked');
  assert.equal(state.journalPending, false);
  assert.deepEqual(state.docLimit, { value: 65536, toolkit: true });
  assert.deepEqual(state.hooks.entries.map((entry) => [entry.name, entry.state]), ALL_NAMES.split(', ').map((name) => [name, 'on']));
  assert.equal(codexReminderLine(state), '');
  assert.deepEqual(describeHookStates(state.hooks), { status: 'on', message: 'All 6 Toolkit hooks are on in Codex.', execution: 'running' });
});

// The S2 matrix: what Claude Code's session start says for each Codex state.
test('the session-start line covers an older Codex Toolkit, hooks off or not reviewed, and stays silent otherwise', (t) => {
  const cases = [
    ['older cache, hooks on', { versions: ['3.19.0'] }, 'Codex runs Toolkit 3.19.0; this PC has 3.19.3. In Codex say "refresh toolkit", then open /hooks and turn the Toolkit hooks on.'],
    ['same version, hooks on', {}, ''],
    ['all six off', { hooks: 'off' }, 'Codex: All 6 Toolkit hooks are off. Open /hooks in Codex and turn them on.'],
    ['two off', { hooks: ['on', 'on', 'off', 'off', 'on', 'on'] }, 'Codex: Toolkit hooks off (Shell and agent check, File edit check). Open /hooks in Codex and turn them on.'],
    ['one not reviewed', { hooks: ['on', 'on', 'on', 'none', 'on', 'on'] }, 'Codex: Toolkit hooks not reviewed (File edit check). Open /hooks in Codex and turn them on.'],
    ['older and two off', { versions: ['3.19.0'], hooks: ['on', 'on', 'off', 'off', 'on', 'on'] },
      'Codex runs Toolkit 3.19.0; this PC has 3.19.3, and Toolkit hooks off (Shell and agent check, File edit check). In Codex say "refresh toolkit", then open /hooks and turn the Toolkit hooks on.'],
    ['plugin off', { hooks: 'off', plugin: 'false' }, ''],
    ['no plugin entry', { hooks: 'off', plugin: null }, ''],
    ['config unreadable', { config: 'unreadable' }, ''],
    ['no config.toml', { config: false }, ''],
    ['two cache versions, the highest is older', { versions: ['3.18.9', '3.19.0'] }, 'Codex runs Toolkit 3.19.0; this PC has 3.19.3. In Codex say "refresh toolkit", then open /hooks and turn the Toolkit hooks on.'],
    // Codex writes trusted entries without `enabled` for hooks never switched; they run.
    ['trusted without enabled', { hooks: 'trusted' }, ''],
  ];
  for (const [label, options, line] of cases) assert.equal(codexReminderLine(fixture(t, options).read()), line, label);
  assert.deepEqual(fixture(t, { versions: ['3.18.9', '3.19.0'] }).read().versions, ['3.18.9', '3.19.0']);

  const absent = new CodexToolkitInstall({ codexHome: path.join(os.tmpdir(), 'toolkit-no-codex-home-here'), managedRoot: repoRoot }).read();
  assert.equal(absent.present, false);
  assert.equal(codexReminderLine(absent), '');
  assert.equal(fixture(t, { config: 'unreadable' }).read().config, 'unreadable');
});

// A preload that records and refuses every child process, loaded before any Toolkit module so a
// destructured spawn is caught too. With codexOnly it refuses only Codex commands and passes on
// to child node processes through NODE_OPTIONS.
function spyPreload(root, { codexOnly = false } = {}) {
  const file = path.join(root, 'process-spy.cjs');
  const log = path.join(root, 'process-spy.log');
  write(file, [
    "'use strict';",
    "const childProcess = require('node:child_process');",
    "const fs = require('node:fs');",
    `const log = ${JSON.stringify(log)};`,
    "const codex = (value) => /(^|[\\\\/\\s])codex(\\.exe|\\.cmd|\\.ps1)?($|\\s)|fake-codex/i.test(String(value || ''));",
    "for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {",
    '  const original = childProcess[name];',
    '  childProcess[name] = function spy(command, args, ...rest) {',
    "    const line = [command, ...(Array.isArray(args) ? args : [])].join(' ');",
    `    if (!${codexOnly} || codex(command) || (Array.isArray(args) && args.some(codex))) {`,
    "      fs.appendFileSync(log, `${name}: ${line}\\n`);",
    "      throw new Error('refused by the test spy');",
    '    }',
    '    return original.call(this, command, args, ...rest);',
    '  };',
    '}',
    '',
  ].join('\n'));
  return { file, log };
}

test('the reader and the session-start line start no process and write nothing', (t) => {
  const { root, codexHome, managed } = fixture(t, { versions: ['3.19.0'], hooks: 'off' });
  const config = path.join(codexHome, 'config.toml');
  const before = fs.readFileSync(config);
  const spy = spyPreload(root);
  const probe = path.join(root, 'probe.cjs');
  write(probe, [
    `const { CodexToolkitInstall, codexReminderLine } = require(${JSON.stringify(path.join(repoRoot, 'repo', 'scripts', 'toolkit-codex-install-state.cjs'))});`,
    `const state = new CodexToolkitInstall({ codexHome: ${JSON.stringify(codexHome)}, managedRoot: ${JSON.stringify(managed)} }).read();`,
    'process.stdout.write(codexReminderLine(state));',
    '',
  ].join('\n'));
  const result = childProcess.spawnSync(process.execPath, ['--require', spy.file, probe], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Codex runs Toolkit 3\.19\.0; this PC has 3\.19\.3, and all 6 Toolkit hooks are off\./);
  assert.equal(fs.existsSync(spy.log), false, fs.existsSync(spy.log) ? fs.readFileSync(spy.log, 'utf8') : '');
  assert.ok(fs.readFileSync(config).equals(before), 'config.toml is never written');
});

test('the read-only Codex setup plan launches no Codex command', (t) => {
  const support = require('./toolkit-setup-test-support.cjs');
  const root = support.tmpRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = support.isolatedHomeEnv(root);
  // A Codex home with Toolkit installed, so the Codex rows are shown.
  write(path.join(root, '.codex', 'config.toml'), `[plugins."${ID}"]\nenabled = true\n\n[hooks.state]\n\n${hookTables(['on', 'on', 'off', 'off', 'on', 'on'])}`);
  const cache = path.join(root, '.codex', 'plugins', 'cache', 'ai-agent-toolkit-local', 'ai-agent-toolkit', '3.19.0');
  write(path.join(cache, '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'ai-agent-toolkit', version: '3.19.0' }));
  write(path.join(cache, '.codex-plugin', 'hooks', 'hooks.json'), HOOKS);
  const spy = spyPreload(root, { codexOnly: true });
  // NODE_OPTIONS reads backslashes as escapes, so the path goes in with forward slashes.
  const result = support.run(['--plan', '--host', 'codex'], { env: { ...env, NODE_OPTIONS: `--require "${spy.file.replace(/\\/g, '/')}"` } });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(fs.existsSync(spy.log), false, fs.existsSync(spy.log) ? fs.readFileSync(spy.log, 'utf8') : '');
  assert.match(result.stdout, /\| 3\.1 \| Keep Toolkit available in Codex\? \| On, 3\.19\.0 \([^|]*\) \| A\. Install or refresh/);
  assert.match(result.stdout, /\nStatus \(nothing to answer\): Toolkit hooks in Codex: Off: Shell and agent check, File edit check\. Turn them on in Codex: open \/hooks and turn on Shell and agent check and File edit check\. Codex may ask you to review the hooks again after a refresh; check \/hooks afterwards\.\n/);
});

// Every numbered row in the setup table takes an answer, so each one shows letters; state the owner
// changes elsewhere (the Codex hooks) is an unnumbered status line instead.
test('every numbered setup row has letter choices in the Codex and Claude Code plans', (t) => {
  const support = require('./toolkit-setup-test-support.cjs');
  const root = support.tmpRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = support.isolatedHomeEnv(root);
  // Codex hooks off, so the report-only state is present.
  write(path.join(root, '.codex', 'config.toml'), `[plugins."${ID}"]\nenabled = true\n\n[hooks.state]\n\n${hookTables('off')}`);
  const cache = path.join(root, '.codex', 'plugins', 'cache', 'ai-agent-toolkit-local', 'ai-agent-toolkit', '3.19.0');
  write(path.join(cache, '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'ai-agent-toolkit', version: '3.19.0' }));
  write(path.join(cache, '.codex-plugin', 'hooks', 'hooks.json'), HOOKS);
  for (const host of ['codex', 'claude-code']) {
    const result = support.run(['--plan', '--host', host], { env });
    assert.equal(result.status, 0, `${host}\n${result.stdout}\n${result.stderr}`);
    const rows = result.stdout.split(/\r?\n/).filter((line) => /^\| \d+\.\d+ \|/.test(line));
    assert.ok(rows.length >= 7, `${host}: ${rows.length} numbered rows`);
    const refs = [];
    for (const row of rows) {
      const [, ref, , , recommended, others] = row.split(/ \| |^\| | \|$/);
      refs.push(ref);
      assert.match(recommended, /^[A-Z]+\. \S/, `${host} ${ref} recommends a letter`);
      assert.match(others, /^[A-Z]+\. \S/, `${host} ${ref} lists other letters`);
    }
    // Numbers stay contiguous within each section.
    const bySection = new Map();
    for (const ref of refs) {
      const [section, index] = ref.split('.').map(Number);
      assert.equal(index, (bySection.get(section) || 0) + 1, `${host} ${ref} follows on`);
      bySection.set(section, index);
    }
    assert.doesNotMatch(result.stdout, /report only/i, host);
    // The heading counts only the numbered questions.
    assert.match(result.stdout, new RegExp(`Toolkit setup choices - ${rows.length} questions across`), host);
    if (host === 'codex') {
      assert.match(result.stdout, /\nStatus \(nothing to answer\): Toolkit hooks in Codex: All 6 off\. Turn them on in Codex: open \/hooks and turn on /);
      assert.doesNotMatch(result.stdout, /\| Toolkit hooks in Codex \|/);
    } else {
      assert.doesNotMatch(result.stdout, /Toolkit hooks in Codex/);
    }
  }
});

test('the instruction limit is read from the top level of config.toml with its Toolkit markers', () => {
  assert.deepEqual(docLimitState(''), { value: null, toolkit: false });
  assert.deepEqual(docLimitState('project_doc_max_bytes = 40000\n'), { value: 40000, toolkit: false });
  assert.deepEqual(docLimitState('project_doc_max_bytes = 0 # off\n'), { value: 0, toolkit: false });
  assert.deepEqual(docLimitState('# AI-AGENT-TOOLKIT:global-rules:BEGIN PROJECT-DOC-MAX-BYTES previous=none\r\nproject_doc_max_bytes = 65536\r\n# AI-AGENT-TOOLKIT:global-rules:END PROJECT-DOC-MAX-BYTES\r\n'), { value: 65536, toolkit: true });
  assert.deepEqual(docLimitState('[profiles.work]\nproject_doc_max_bytes = 9000\n'), { value: null, toolkit: false }, 'a table value is not the top-level one');
});

test('hook states come from the cache hooks file and say unknown when it or config.toml cannot be read', (t) => {
  const { codexHome } = fixture(t);
  assert.equal(readToolkitHookStates(null, codexHome).status, 'unreadable');
  assert.equal(readToolkitHookStates('', path.join(codexHome, 'no-such-cache')).status, 'no-hooks-file');
  const unknown = describeHookStates({ status: 'unreadable', entries: [] });
  assert.equal(unknown.status, 'unreadable');
  assert.match(unknown.message, /Open `\/hooks` in Codex/);
  const off = describeHookStates(readToolkitHookStates(hookTables(['on', 'on', 'off', 'none', 'on', 'on']), path.join(codexHome, 'plugins', 'cache', 'ai-agent-toolkit-local', 'ai-agent-toolkit', '3.19.3')));
  assert.equal(off.status, 'off');
  assert.equal(off.message, 'Open `/hooks` in Codex and turn on: Shell and agent check, File edit check. Codex skips a Toolkit hook that is off or not reviewed.');
});

test('the install check shows the Codex line as a notice that never blocks', (t) => {
  const check = (codexInstall) => new ToolkitInstallHealthCheck({ toolkitRoot: repoRoot, expectedVersion: '9.9.1', hubPath: path.join(os.tmpdir(), 'toolkit-no-hub-here'),
    helperDefinitions: { refresh: () => ({ status: 'current' }), check: () => ({ status: 'current', project_overrides: [], detail: '' }) },
    globalRules: { refresh: () => ({ status: 'current', files: [], covered: [], backup_dir: null, detail: '' }) },
    depthSetting: { inspect: () => ({ state: 'toolkit-one-layer', value: '1' }) }, codexInstall }).run({ refreshHelpers: false });
  const find = (result) => result.checks.find((entry) => entry.id === 'codex-toolkit');
  const { codexHome, managed } = fixture(t, { versions: ['3.19.0'], hooks: 'off' });
  const result = check(new CodexToolkitInstall({ codexHome, managedRoot: managed }));
  assert.equal(result.status, STATUS.PASSED);
  assert.equal(find(result).status, STATUS.PASSED);
  assert.equal(find(result).notice, true);
  assert.equal(find(result).summary, 'Codex runs Toolkit 3.19.0; this PC has 3.19.3, and all 6 Toolkit hooks are off. In Codex say "refresh toolkit", then open /hooks and turn the Toolkit hooks on.');
  assert.equal(find(check(null)), undefined, 'skipped without a reader');
  assert.equal(find(check({ read: () => { throw new Error('unreadable'); } })), undefined, 'a reader failure says nothing');
  const current = fixture(t);
  assert.equal(find(check(new CodexToolkitInstall({ codexHome: current.codexHome, managedRoot: current.managed }))), undefined);
});

test('at setup time Keep current and Show instructions only run no Codex plugin command; Install or refresh does', (t) => {
  const support = require('./toolkit-setup-test-support.cjs');
  const runWith = (behavior) => {
    const root = support.tmpRoot();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const { origin, setupRepo } = support.createGitBackedSetupRepo(root);
    // A Codex home with an older Toolkit, so a plugin check would want a refresh.
    write(path.join(root, '.codex', 'config.toml'), `[plugins."${ID}"]\nenabled = true\n\n[hooks.state]\n\n${hookTables('on')}`);
    const cache = path.join(root, '.codex', 'plugins', 'cache', 'ai-agent-toolkit-local', 'ai-agent-toolkit', '1.0.0');
    write(path.join(cache, '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'ai-agent-toolkit', version: '1.0.0' }));
    write(path.join(cache, '.codex-plugin', 'hooks', 'hooks.json'), HOOKS);
    const spy = spyPreload(root, { codexOnly: true });
    const result = support.run(['--execute', '--repo-root', setupRepo, '--repo-remote', origin, '--yes-recommended', '--skip-codex-plugin-auto-refresh',
      '--codex-helper-capacity', 'keep', '--codex-plugin-behavior', behavior], {
      env: { ...support.isolatedHomeEnv(root), SETUP_FAKE_CODEX_REFRESH_REQUIRED: '1', NODE_OPTIONS: `--require "${spy.file.replace(/\\/g, '/')}"` },
      timeout: 300000,
    });
    assert.equal(result.status, 0, `${behavior}: ${result.stdout}\n${result.stderr}`);
    assert.equal(fs.existsSync(spy.log), false, `${behavior}: ${fs.existsSync(spy.log) ? fs.readFileSync(spy.log, 'utf8') : ''}`);
    // The fake plugin helper writes this log on --write and the refresh marker on a write.
    return { result, wrote: fs.existsSync(path.join(setupRepo, 'PLUGIN_SETUP.log')), refreshed: fs.existsSync(path.join(setupRepo, 'CODEX_PLUGIN_REFRESHED')) };
  };
  const kept = runWith('keep');
  assert.deepEqual([kept.wrote, kept.refreshed], [false, false], 'Keep current runs no plugin command');
  assert.match(kept.result.stdout, /Codex plugin status: kept/);
  assert.match(kept.result.stdout, /Codex installed Toolkit version: 1\.0\.0/);
  const instructions = runWith('instructions');
  assert.deepEqual([instructions.wrote, instructions.refreshed], [false, false], 'Show instructions only runs no plugin command');
  assert.match(instructions.result.stdout, /Codex plugin status: instructions only/);
  assert.match(instructions.result.stdout, /Codex plugin instructions: no plugin change was made\. To refresh it, say "refresh toolkit" in Codex/);
  const installed = runWith('install');
  assert.deepEqual([installed.wrote, installed.refreshed], [true, true], 'Install or refresh runs verify, write, verify');
  assert.match(installed.result.stdout, /Codex plugin status: refreshed/);
});

// Row 3.1 of the Codex bank and its hooks status line, built from a reader state.
function codexRows(install, audit = {}) {
  const managedPath = core.defaultManagedSourcePath();
  const current = {
    managed: { currentPath: managedPath, selectedPath: managedPath, defaultPath: managedPath, exists: true, git: true, dirty: false, branch: core.DEFAULT_REPO_BRANCH, remote: core.DEFAULT_REPO_REMOTE },
    audit: { repo_auto_update: {}, ...audit },
    runtime: { runtime: 'MultiAgentV1', from_config: true },
    delegation: { status: 'configured', ownership: 'toolkit-managed-v1', helper_count: 1, detail: 'Toolkit-managed Codex V1 (multi_agent) capacity allows 1 helper(s).' },
    nativePlugin: { status: 'verification-deferred' },
    codexInstall: install === null ? undefined : {
      present: true, config: 'read', plugin: 'on', versions: ['3.19.3'], version: '3.19.3', sourceVersion: '3.19.3', older: false,
      marketplacePath: managedPath, cacheFresh: true, journalPending: false, docLimit: { value: 65536, toolkit: true },
      hooks: { status: 'read', entries: ALL_NAMES.split(', ').map((name) => ({ name, state: 'on' })) }, ...install,
    },
  };
  const rows = core.setupQuestionSpecs(core.parseArgs(['--plan', '--host', 'codex']), current);
  return Object.fromEntries(rows.map((row) => [row.id, row]));
}

test('setup row 3.1 and the Codex hooks status line match the session-start line', () => {
  const same = codexRows({});
  assert.equal(same['codex-toolkit-plugin'].presentation.question_ref, '3.1');
  assert.equal(same['codex-toolkit-plugin'].current_short, 'On, 3.19.3');
  assert.equal(same['codex-toolkit-plugin'].recommended, 'keep');
  assert.deepEqual(same['codex-toolkit-plugin'].choices.map((choice) => choice.label), ['Install or refresh', 'Show instructions only', 'Keep current']);
  assert.equal(same['codex-toolkit-hooks'].presentation.question_ref, '');
  assert.equal(same['codex-toolkit-hooks'].current_short, 'All 6 on');
  assert.equal(same['codex-toolkit-hooks'].recommended_text, 'Nothing to do');

  const older = codexRows({ versions: ['3.19.0'], version: '3.19.0', older: true, cacheFresh: null });
  assert.equal(older['codex-toolkit-plugin'].current_short, 'On, 3.19.0 (3.19.3 available)');
  assert.equal(older['codex-toolkit-plugin'].recommended, 'install');
  assert.equal(older['codex-toolkit-hooks'].recommended_text, 'Nothing to do. Codex may ask you to review the hooks again after a refresh; check /hooks afterwards');

  const off = codexRows({ hooks: { status: 'read', entries: ALL_NAMES.split(', ').map((name) => ({ name, state: 'off' })) } });
  assert.equal(off['codex-toolkit-plugin'].recommended, 'keep');
  assert.equal(off['codex-toolkit-hooks'].current_short, 'All 6 off');
  assert.equal(off['codex-toolkit-hooks'].recommended_text, 'Turn them on in Codex: open /hooks and turn on Session start updates, Prompt check, Shell and agent check, File edit check, Checkpoint after tool use and Checkpoint at stop');

  const notReviewed = codexRows({ hooks: { status: 'read', entries: ALL_NAMES.split(', ').map((name) => ({ name, state: name === 'File edit check' ? 'not-reviewed' : 'on' })) } });
  assert.equal(notReviewed['codex-toolkit-hooks'].current_short, 'Not reviewed: File edit check');
  const mixed = codexRows({ hooks: { status: 'read', entries: ALL_NAMES.split(', ').map((name) => ({ name, state: name === 'Prompt check' ? 'off' : name === 'File edit check' ? 'not-reviewed' : 'on' })) } });
  assert.equal(mixed['codex-toolkit-hooks'].current_short, 'Off: Prompt check; Not reviewed: File edit check');

  const pluginOff = codexRows({ plugin: 'off', version: '3.19.0', versions: ['3.19.0'], older: true });
  assert.equal(pluginOff['codex-toolkit-plugin'].current_short, 'Off, 3.19.0 (3.19.3 available)');
  assert.equal(pluginOff['codex-toolkit-hooks'].current_short, 'Plugin off');

  const unreadable = codexRows({ config: 'unreadable', plugin: 'unknown', docLimit: null, hooks: { status: 'unreadable', entries: [] } });
  assert.equal(unreadable['codex-toolkit-plugin'].current_short, 'Could not read');
  assert.equal(unreadable['codex-toolkit-hooks'].current_short, 'Could not read');
  assert.equal(unreadable['codex-instruction-limit'].current_short, 'Could not read');

  const two = codexRows({ versions: ['3.18.9', '3.19.3'], cacheFresh: null });
  assert.equal(two['codex-toolkit-plugin'].current_short, 'On, 2 versions installed');
  assert.equal(two['codex-toolkit-plugin'].recommended, 'install');

  for (const [label, change, note] of [
    ['files differ', { cacheFresh: false }, 'files differ from the update copy'],
    ['another folder', { marketplacePath: path.join(os.tmpdir(), 'elsewhere') }, 'runs from another folder'],
    ['unfinished journal', { journalPending: true }, 'an earlier setup step did not finish'],
  ]) {
    const row = codexRows(change)['codex-toolkit-plugin'];
    assert.equal(row.recommended, 'install', label);
    assert.equal(row.current_short, `On, 3.19.3 (${note})`, label);
  }
  assert.equal(codexRows({ versions: [], version: '' })['codex-toolkit-plugin'].current_short, 'Not installed');

  const absent = codexRows(null);
  assert.equal(absent['codex-toolkit-plugin'], undefined, 'no Codex home: row 3.1 and the hooks status line are not shown');
  assert.equal(absent['codex-toolkit-hooks'], undefined);
});

test('1.5 and 2.1 read config.toml rather than Toolkit records', () => {
  const limit = (docLimit, record) => codexRows({ docLimit }, { codex_doc_limit_enabled: record })['codex-instruction-limit'];
  assert.equal(limit({ value: 65536, toolkit: true }, true).current_short, 'Raised (65536)');
  assert.equal(limit({ value: 65536, toolkit: true }, true).recommended, 'keep');
  assert.equal(limit({ value: null, toolkit: false }, false).current_short, 'Left alone (32 KiB default)');
  assert.equal(limit({ value: 40000, toolkit: false }, false).current_short, 'Yours (40000)');
  assert.equal(limit({ value: 0, toolkit: false }, false).current_short, 'Project docs off (0)');
  const disagree = limit({ value: null, toolkit: false }, true);
  assert.equal(disagree.current_short, 'Record says raised; config has 32768');
  assert.equal(disagree.recommended, 'enable', 'Raise it is recommended when the record and the file disagree');

  const helpers = codexRows({})['codex-helper-capacity'];
  assert.equal(helpers.current_short, '1 helper (V1 setting)');
  assert.equal(helpers.recommended, 'keep');
  assert.equal(helpers.choices.some((choice) => choice.value === 'root-only'), false, 'No helpers is not offered for the V1 form');
  assert.ok(helpers.choices.some((choice) => choice.value === 'migrate'), 'migrating to V2 stays reachable; Codex is checked after the answers');
});
