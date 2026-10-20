'use strict';

// End-to-end harness for Claude Code plugin auto-refresh: the real bridge
// SessionStart path and the real managed-source setup helper, with one fake
// native Claude CLI shared by every isolated Claude Code configuration home.
//
// The fake follows the Claude Code 2.1.301 record shape: installed_plugins.json
// (version 2) under the plugins root, which is CLAUDE_CODE_PLUGIN_CACHE_DIR or
// <CLAUDE_CONFIG_DIR>/plugins; caches at <plugins root>/cache/<marketplace>/
// <plugin>/<version>; `plugin list --json` reports `enabled` for the project of
// its working directory (local > project > user enabledPlugins settings); and
// `plugin update <id> --scope <scope>` updates the record of that scope (for
// project/local scope, the record of the working-directory project). No real
// Claude CLI, account, plugin cache or host setting is touched.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PLUGIN_ID = 'ai-agent-toolkit@ai-agent-toolkit-local';
const ENV_KEYS = ['CLAUDE_PLUGIN_ROOT', 'CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_PLUGIN_CACHE_DIR', 'CLAUDE_CODE_SUBPROCESS_ENV_SCRUB',
  'CLAUDE_PROJECT_DIR', 'AI_AGENT_TOOLKIT_CLAUDE_CLI', 'CLAUDE_TOOLKIT_CLAUDE_CLI', 'CLAUDE_CLI_PATH', 'HOME', 'USERPROFILE',
  'TEMP', 'TMP', 'TMPDIR', 'CODEX_HOME', 'XDG_CONFIG_HOME', 'APPDATA', 'LOCALAPPDATA', 'CLAUDE_TOOLKIT_CLAUDE_PLUGIN_MUTATION_POLL_MS'];

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readJson(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; }
}

const FAKE_CLAUDE = String.raw`'use strict';
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const home = process.env.HOME || process.env.USERPROFILE || '';
const config = process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
const pluginsRoot = process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR || path.join(config, 'plugins');
const registryPath = path.join(pluginsRoot, 'installed_plugins.json');
const behaviorPath = path.join(pluginsRoot, 'fake-behavior.json');
const read = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const same = (a, b) => Boolean(a && b) && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
fs.appendFileSync(path.join(pluginsRoot, 'fake-calls.jsonl'), JSON.stringify({ args, cwd: process.cwd(), config, pluginsRoot }) + '\n');
if (args[0] === '--version') { process.stdout.write('2.1.301 (fake)\n'); process.exit(0); }
const registry = read(registryPath, { version: 2, plugins: {} });
const enabledFor = (id) => {
  const layers = [path.join(process.cwd(), '.claude', 'settings.local.json'), path.join(process.cwd(), '.claude', 'settings.json'), path.join(config, 'settings.json')];
  for (const file of layers) {
    const value = read(file, {})?.enabledPlugins?.[id];
    if (typeof value === 'boolean') return value;
  }
  return false;
};
if (args[0] === 'plugin' && args[1] === 'list') {
  const out = [];
  for (const [id, records] of Object.entries(registry.plugins || {})) {
    for (const record of records) {
      out.push({ id, version: record.version, scope: record.scope, enabled: enabledFor(id), installPath: record.installPath,
        ...(record.projectPath ? { projectPath: record.projectPath } : {}) });
    }
  }
  process.stdout.write(JSON.stringify(out) + '\n');
  process.exit(0);
}
if (args[0] === 'plugin' && args[1] === 'update') {
  const id = args[2];
  const scope = args[args.indexOf('--scope') + 1];
  const behavior = read(behaviorPath, { update: 'fail' });
  const records = registry.plugins[id] || [];
  const record = records.find((entry) => entry.scope === scope && (scope === 'user' || same(entry.projectPath, process.cwd())));
  if (!record) { process.stderr.write('Plugin ' + id + ' is not installed in scope ' + scope + '\n'); process.exit(1); }
  if (behavior.update === 'fail') { process.stderr.write('fake native update failure\n'); process.exit(1); }
  if (behavior.update === 'succeed') {
    record.version = behavior.version;
    record.installPath = behavior.installPath;
    record.gitCommitSha = behavior.gitCommitSha;
    fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n');
  }
  process.exit(0);
}
process.stderr.write('unexpected fake claude args: ' + args.join(' ') + '\n');
process.exit(9);
`;

// The files a managed source needs for the setup helper, its source
// validation and the full installed-enforcement identity.
function sourceFiles(repoRoot) {
  const setup = require(path.join(repoRoot, 'repo', 'scripts', 'setup-claude-toolkit-plugin.cjs'));
  const refresh = require(path.join(repoRoot, 'repo', 'scripts', 'toolkit-claude-plugin-auto-refresh.cjs'));
  return [...new Set([
    ...setup.INSTALLED_ENFORCEMENT_FILES, ...refresh.CURRENT_IDENTITY_FILES,
    '.claude-plugin/marketplace.json', 'repo/scripts/claude-process-launch.cjs',
    'repo/scripts/repo-ignore-hygiene.cjs', 'repo/scripts/repo-local-backup.cjs'
  ])];
}

function copyTree(repoRoot, files, target, version) {
  for (const relPath of files) {
    const to = path.join(target, ...relPath.split('/'));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(repoRoot, ...relPath.split('/')), to);
  }
  if (version) {
    const manifestPath = path.join(target, '.claude-plugin', 'plugin.json');
    const manifest = readJson(manifestPath);
    writeJson(manifestPath, { ...manifest, version });
  }
  return target;
}

function git(cwd, args) {
  const result = spawnSync('git', ['-c', 'user.name=Toolkit Test', '-c', 'user.email=toolkit-test@example.invalid', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

// One isolated world: a shared Toolkit hub, a clean managed-source checkout
// and any number of Claude Code configuration homes.
class NativeWorld {
  constructor(repoRoot, root) {
    this.repoRoot = repoRoot;
    this.root = root;
    this.files = sourceFiles(repoRoot);
    this.version = readJson(path.join(repoRoot, '.claude-plugin', 'plugin.json')).version;
    this.oldVersion = '3.0.9';
    this.source = copyTree(repoRoot, this.files, path.join(root, 'source'));
    git(this.source, ['init', '-q']);
    git(this.source, ['add', '-A']);
    git(this.source, ['commit', '-q', '-m', 'managed source']);
    this.commit = git(this.source, ['rev-parse', 'HEAD']).toLowerCase();
    this.fake = path.join(root, 'fake-claude.cjs');
    fs.writeFileSync(this.fake, FAKE_CLAUDE, 'utf8');
    this.osHome = path.join(root, 'os-home');
    this.temp = path.join(root, 'temp');
    fs.mkdirSync(this.osHome, { recursive: true });
    fs.mkdirSync(this.temp, { recursive: true });
    this.hubPath = path.join(this.osHome, 'hub', 'current');
    writeJson(path.join(this.hubPath, 'state.json'), {
      schema_version: 1, hub_version: this.version, bridge_versions_by_source: {},
      auto_sync_enabled: false, repo_auto_update_enabled: false, codex_plugin_auto_refresh_enabled: false,
      claude_plugin_auto_refresh_enabled: true, repo_path: this.source
    });
    this.attemptPath = path.join(path.dirname(this.hubPath), 'claude-plugin-auto-refresh.json');
  }

  // A Claude Code configuration home with one Toolkit install record.
  // options: name, version, scope, project (dir for project/local), enabledIn
  // ('user'|'project'|'local'|'none'), cacheDir (CLAUDE_CODE_PLUGIN_CACHE_DIR).
  home(options = {}) {
    const name = options.name || 'home-a';
    const configHome = path.join(this.root, name, '.claude');
    const pluginsRoot = options.cacheDir || path.join(configHome, 'plugins');
    const version = options.version || this.oldVersion;
    const scope = options.scope || 'user';
    const project = options.project || path.join(this.root, name, 'project');
    fs.mkdirSync(project, { recursive: true });
    const family = path.join(pluginsRoot, 'cache', 'ai-agent-toolkit-local', 'ai-agent-toolkit');
    const installPath = copyTree(this.repoRoot, this.files, path.join(family, version), version);
    const record = { scope, installPath, version, installedAt: '2026-10-20T00:00:00.000Z', lastUpdated: '2026-10-20T00:00:00.000Z',
      gitCommitSha: version === this.version ? this.commit : 'b'.repeat(40), ...(scope === 'user' ? {} : { projectPath: project }) };
    writeJson(path.join(pluginsRoot, 'installed_plugins.json'), { version: 2, plugins: { [PLUGIN_ID]: [record] } });
    writeJson(path.join(pluginsRoot, 'known_marketplaces.json'), {
      'ai-agent-toolkit-local': { source: { source: 'directory', path: this.source }, installLocation: this.source, lastUpdated: '2026-10-20T00:00:00.000Z' }
    });
    const enabledIn = options.enabledIn || scope;
    const settingsFile = { user: path.join(configHome, 'settings.json'), project: path.join(project, '.claude', 'settings.json'),
      local: path.join(project, '.claude', 'settings.local.json') }[enabledIn];
    if (settingsFile) writeJson(settingsFile, { enabledPlugins: { [PLUGIN_ID]: true } });
    if (options.disabledIn) {
      const file = { project: path.join(project, '.claude', 'settings.json'), local: path.join(project, '.claude', 'settings.local.json') }[options.disabledIn];
      writeJson(file, { enabledPlugins: { [PLUGIN_ID]: false } });
    }
    const home = { name, configHome, pluginsRoot, family, project, scope, installPath, cacheDir: options.cacheDir || '' };
    this.setBehavior(home, { update: 'fail' });
    return home;
  }

  setBehavior(home, behavior) { writeJson(path.join(home.pluginsRoot, 'fake-behavior.json'), behavior); }

  // Stage the current version in a home's cache family and make the fake
  // native update land there (the effect a successful `plugin update` has).
  stageUpdate(home) {
    const installPath = copyTree(this.repoRoot, this.files, path.join(home.family, this.version));
    this.setBehavior(home, { update: 'succeed', version: this.version, installPath, gitCommitSha: this.commit });
    return installPath;
  }

  // The native effect of a manual, owner-run update of one home.
  nativeUpdate(home) {
    const installPath = copyTree(this.repoRoot, this.files, path.join(home.family, this.version));
    const registryPath = path.join(home.pluginsRoot, 'installed_plugins.json');
    const registry = readJson(registryPath);
    for (const record of registry.plugins[PLUGIN_ID]) Object.assign(record, { version: this.version, installPath, gitCommitSha: this.commit });
    writeJson(registryPath, registry);
    return installPath;
  }

  calls(home) {
    try {
      return fs.readFileSync(path.join(home.pluginsRoot, 'fake-calls.jsonl'), 'utf8').trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    } catch { return []; }
  }

  updates(home) { return this.calls(home).filter((call) => call.args[0] === 'plugin' && call.args[1] === 'update'); }

  attemptBytes() { try { return fs.readFileSync(this.attemptPath, 'utf8'); } catch { return null; } }
  attempt() { return readJson(this.attemptPath); }

  #isolatedEnv(home, options, runningRoot) {
    return {
      CLAUDE_PLUGIN_ROOT: runningRoot,
      CLAUDE_CONFIG_DIR: options.scrubConfig || !home ? undefined : home.configHome,
      CLAUDE_CODE_PLUGIN_CACHE_DIR: home?.cacheDir || undefined,
      CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: options.scrubConfig ? '1' : undefined,
      CLAUDE_PROJECT_DIR: options.projectDir || home?.project,
      AI_AGENT_TOOLKIT_CLAUDE_CLI: this.fake,
      CLAUDE_TOOLKIT_CLAUDE_CLI: undefined,
      CLAUDE_CLI_PATH: undefined,
      HOME: this.osHome, USERPROFILE: this.osHome, TEMP: this.temp, TMP: this.temp, TMPDIR: this.temp,
      CODEX_HOME: path.join(this.osHome, '.codex'), XDG_CONFIG_HOME: path.join(this.osHome, '.config'),
      APPDATA: this.osHome, LOCALAPPDATA: this.osHome,
      CLAUDE_TOOLKIT_CLAUDE_PLUGIN_MUTATION_POLL_MS: '25',
      ...(options.env || {})
    };
  }

  #withEnv(env, fn) {
    const previous = {};
    for (const key of ENV_KEYS) previous[key] = process.env[key];
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    const lines = [];
    const original = console.log;
    console.log = (...items) => { lines.push(items.join(' ')); };
    try {
      fn();
    } finally {
      console.log = original;
      for (const key of ENV_KEYS) {
        if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
      }
    }
    return lines;
  }

  // The recovery that explicit setup opt-in (bridge
  // --enable-claude-plugin-auto-refresh, never a hook) applies to the hub.
  setupOptIn(bridge) {
    return bridge.clearClaudeAutoRefreshHold(this.hubPath);
  }

  // One real Claude SessionStart hook run of a session using `home`,
  // running Toolkit from runningRoot (default: the home's installed cache).
  // options.preload runs the real helper with a node preload module (used to
  // inject a failure inside the helper process).
  session(bridge, home, options = {}) {
    const runningRoot = options.runningRoot || home.installPath;
    const deps = { validateRepo: () => {} };
    if (options.preload) {
      deps.runNode = (scriptPath, nodeArgs, runOptions) => {
        const result = spawnSync(process.execPath, ['-r', options.preload, scriptPath, ...nodeArgs], {
          cwd: runOptions.cwd, encoding: 'utf8', timeout: runOptions.timeout, windowsHide: true, env: runOptions.env
        });
        return { ok: result.status === 0, status: result.status, stdout: result.stdout || '', stderr: result.stderr || '',
          error: result.error ? result.error.message : '', timedOut: Boolean(result.error && result.error.code === 'ETIMEDOUT') };
      };
    }
    const lines = this.#withEnv(this.#isolatedEnv(home, options, runningRoot), () => {
      bridge.run(['--hook', '--sync-enabled', '--write', '--sync-source', 'claude-plugin', '--hub', this.hubPath], {
        claudeAutoRefreshExecutingRoot: runningRoot,
        // Full managed-source validation is covered by its own suites; the
        // source here is a clean committed copy of the files under test.
        claudeAutoRefreshDeps: deps,
        openUpdateReport: () => ({ ok: true })
      });
    });
    return this.#summary(lines);
  }

  #summary(lines) {
    const line = lines.find((text) => text.startsWith('Toolkit Claude plugin auto-refresh:')) || '';
    const status = (/^Toolkit Claude plugin auto-refresh: action required \((?<status>[a-z-]+)\)/.exec(line) || {}).groups?.status
      || (/: updated /.test(line) ? 'updated' : /earlier unverified refresh record for it is resolved/.test(line) ? 'resolved-current'
        : /already installed/.test(line) ? 'installed-current' : /directly from the managed checkout/.test(line) ? 'running-in-place'
          : /deferred|plan changed/i.test(line) ? 'deferred' : line ? 'other' : 'silent');
    return { line, status };
  }
}

function makeWorld(repoRoot, prefix = 'claude-native-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return { world: new NativeWorld(repoRoot, root), cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

module.exports = { NativeWorld, PLUGIN_ID, makeWorld, readJson, writeJson };
