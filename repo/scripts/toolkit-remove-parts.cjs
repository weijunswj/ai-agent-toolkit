'use strict';

// The parts of `remove toolkit` beyond scheduled tasks and global rules: each one lists what Toolkit
// left in one place and removes only that, through the module that owns it.
//
// Every part has:
//   key, title
//   plan()        read-only; [{ what, action: 'remove' | 'keep' | 'held', detail? }]. The plan code
//                 covers this list, so a list that changes after the owner saw it removes nothing.
//   apply(items)  removes the items planned as 'remove'; [{ what, result, reason? }].
//   app           whose part it is: 'codex', 'claude-code', 'shared' (used by every app) or 'any' (always
//                 runs). An item's own `app` wins, for parts that span apps. `remove toolkit` runs in one
//                 app and plans only that app's items; shared items wait while another app keeps Toolkit.
//
// The Toolkit folder (~/.ai-agent-toolkit) goes last, and only once neither the Claude Code nor the
// Codex plugin is installed, because a plugin that is still installed reads its records there.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PLUGIN_ID = 'ai-agent-toolkit@ai-agent-toolkit-local';
const MARKETPLACE = 'ai-agent-toolkit-local';
// Top-level entries of ~/.ai-agent-toolkit that are Toolkit's own and can be rebuilt by setup.
// `env` (the list of your keys; the values sit in the computer's credential store) and `backups` are
// never in this list, and anything else found there is kept and listed.
const FOLDER_ENTRIES = Object.freeze(['source', 'current', 'user-state', 'agent-control', 'global-rules.json', 'n8n-official-skills.json', 'antigravity-toolkit-skills.json']);
// Backup folders inside Toolkit's own entries that stay with the rest of the backups.
const KEPT_INSIDE = Object.freeze({ 'agent-control': ['backups'] });
const KEPT_ENTRIES = Object.freeze(['env', 'backups']);

const safe = (error) => String(error?.message || error || 'error').replace(/[\r\n]+/g, ' ').slice(0, 300);
const display = (home, file) => {
  const relative = path.relative(home, file);
  return !relative.startsWith('..') && !path.isAbsolute(relative) ? `~/${relative.split(path.sep).join('/')}` : file;
};
const claudeConfigDir = (environment, home) => path.resolve(environment.CLAUDE_CONFIG_DIR || path.join(home, '.claude'));
const codexHomeDir = (environment, home) => path.resolve(environment.CODEX_HOME || path.join(home, '.codex'));

// Runs one item's removal and turns a throw into a failed line.
function attempt(item, run) {
  try { return { what: item.what, ...run() }; }
  catch (error) { return { what: item.what, result: 'failed', reason: safe(error) }; }
}

// Claude Code's CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH, only while it holds the value Toolkit recorded.
class ClaudeDepthPart {
  key = 'claude_settings'; title = 'Claude Code subagent limit'; app = 'claude-code';
  #setting; #what;
  constructor({ environment = process.env, home = os.homedir(), setting } = {}) {
    if (setting) this.#setting = setting;
    else {
      const { ClaudeSubagentDepthSetting } = require('./toolkit-claude-subagent-depth.cjs');
      this.#setting = new ClaudeSubagentDepthSetting({ environment, controlRoot: environment.AI_AGENT_TOOLKIT_CONTROL_ROOT || path.join(home, '.ai-agent-toolkit', 'agent-control') });
    }
    this.#what = `${display(home, path.join(claudeConfigDir(environment, home), 'settings.json'))}: the subagent limit CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`;
  }
  plan() {
    const state = this.#setting.inspect();
    if (state.state === 'toolkit-one-layer') return [{ what: this.#what, action: 'remove', detail: 'set by Toolkit; Claude Code goes back to its default (a backup is saved first)' }];
    if (state.state === 'owner-value') return [{ what: this.#what, action: 'keep', detail: 'you set this value yourself' }];
    if (state.state === 'unreadable') return [{ what: this.#what, action: 'held', detail: state.detail || 'the settings file could not be read' }];
    return [];
  }
  apply(items) {
    return items.filter(item => item.action === 'remove').map(item => attempt(item, () => {
      const result = this.#setting.apply('disable');
      if (result.status === 'claude-default') return { result: result.changed ? 'removed' : 'already gone' };
      return { result: 'kept', reason: result.status === 'owner-value-kept' ? 'it changed to a value of yours after the plan' : result.detail || result.status };
    }));
  }
}

// The Claude Code preferences setup turned on (no AI attribution, session messages, model switching,
// reading AGENTS.md). Listed, never changed: they are choices the owner made at setup, and turning
// attribution back on would put trailers back in commits. The listing says how to change one by hand.
class ClaudeUserSettingsPart {
  key = 'claude_preferences'; title = 'Claude Code preferences you chose at setup'; app = 'claude-code';
  #settings; #file;
  constructor({ environment = process.env, home = os.homedir(), settings } = {}) {
    if (settings) this.#settings = settings;
    else {
      const { ClaudeUserSettings } = require('./toolkit-claude-user-settings.cjs');
      this.#settings = new ClaudeUserSettings({ environment, controlRoot: environment.AI_AGENT_TOOLKIT_CONTROL_ROOT || path.join(home, '.ai-agent-toolkit', 'agent-control') });
    }
    this.#file = display(home, path.join(claudeConfigDir(environment, home), 'settings.json'));
  }
  plan() {
    return this.#settings.inspect().filter(entry => entry.state === 'toolkit-value' || (entry.state === 'off-value' && entry.toolkit))
      .map(entry => ({ what: `${this.#file}: ${entry.label} (${entry.id})`, action: 'keep', detail: 'set at setup and kept as your own; edit settings.json to change it' }));
  }
  apply() { return []; }
}

// Toolkit's helper-capacity block in Codex's config.toml.
class CodexHelperLimitPart {
  key = 'codex_helper_limit'; title = 'Codex helper limit'; app = 'codex';
  #delegation; #configPath; #what;
  constructor({ environment = process.env, home = os.homedir(), delegation, configPath } = {}) {
    this.#delegation = delegation || require('./codex-delegation-config.cjs');
    this.#configPath = configPath || path.join(codexHomeDir(environment, home), 'config.toml');
    this.#what = `${display(home, this.#configPath)}: Toolkit's helper limit block`;
  }
  #state() {
    const { RUNTIMES } = this.#delegation;
    const block = this.#delegation.inspectCodexDelegationConfig(this.#configPath, RUNTIMES.UNKNOWN);
    const runtime = { 'toolkit-managed-v1': RUNTIMES.V1, 'toolkit-managed-v2': RUNTIMES.V2 }[block.ownership] || RUNTIMES.UNKNOWN;
    return { block, runtime };
  }
  plan() {
    const { block } = this.#state();
    if (!String(block.ownership || '').startsWith('toolkit-managed')) return [];
    return [{ what: this.#what, action: 'remove', detail: `${block.ownership}, ${Number.isInteger(block.helper_count) ? `${block.helper_count} helpers` : 'helper count unknown'}; Codex may then use its own higher default (a backup is saved first)` }];
  }
  apply(items) {
    return items.filter(item => item.action === 'remove').map(item => attempt(item, () => {
      const { runtime } = this.#state();
      const result = this.#delegation.removeCodexDelegation(this.#configPath, { runtime, approveCapacityResetRisk: true });
      if (result.status === 'removed') return { result: 'removed' };
      if (result.changed === false && !String(result.ownership || '').startsWith('toolkit-managed')) return { result: 'already gone' };
      return { result: 'failed', reason: safe(result.detail || result.status) };
    }));
  }
}

// Helper agent files Toolkit generated, found by their marker; any other file stays.
class HelperAgentFilesPart {
  key = 'helper_agents'; title = 'Toolkit helper agent files';
  #folders; #home;
  constructor({ environment = process.env, home = os.homedir(), folders } = {}) {
    this.#home = home;
    this.#folders = folders || [
      { dir: path.join(claudeConfigDir(environment, home), 'agents'), marker: require('./toolkit-claude-helper-agents.cjs').MARKER, app: 'claude-code' },
      { dir: path.join(codexHomeDir(environment, home), 'agents'), marker: require('./toolkit-codex-helper-agents.cjs').MARKER, app: 'codex' },
    ];
  }
  #found() {
    const found = [];
    for (const { dir, marker, app = 'shared' } of this.#folders) {
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const file = path.join(dir, entry.name);
        let text = '';
        try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
        if (text.includes(marker)) found.push({ file, marker, app });
      }
    }
    return found.sort((a, b) => a.file.localeCompare(b.file));
  }
  plan() { return this.#found().map(({ file, app }) => ({ what: display(this.#home, file), action: 'remove', app })); }
  apply(items) {
    const found = this.#found();
    return items.filter(item => item.action === 'remove').map(item => attempt(item, () => {
      const hit = found.find(entry => display(this.#home, entry.file) === item.what);
      if (!hit) return { result: 'already gone' };
      // Read again just before removal: a file that lost the marker is no longer Toolkit's.
      if (!fs.readFileSync(hit.file, 'utf8').includes(hit.marker)) return { result: 'kept', reason: 'it no longer carries the Toolkit marker' };
      fs.rmSync(hit.file, { force: true });
      return { result: 'removed' };
    }));
  }
}

// Skill folders Toolkit copied and recorded: the official n8n skills and the Antigravity copies.
class SkillCopiesPart {
  key = 'skill_copies'; title = 'Skill folders Toolkit copied';
  #owners; #home; #apps;
  constructor({ environment = process.env, home = os.homedir(), toolkitRoot = path.resolve(__dirname, '..', '..'), owners } = {}) {
    this.#home = home;
    // The app that reads each copy folder: Claude Code its skills folder, Codex ~/.agents/skills; any
    // other folder (Antigravity's) is shared.
    this.#apps = [{ dir: path.join(claudeConfigDir(environment, home), 'skills'), app: 'claude-code' }, { dir: path.join(home, '.agents', 'skills'), app: 'codex' }];
    if (owners) { this.#owners = owners; return; }
    const { OfficialN8nSkills } = require('./toolkit-n8n-official-skills.cjs');
    const { AntigravityGlobalSkills } = require('./toolkit-antigravity-project-skills.cjs');
    this.#owners = [new OfficialN8nSkills({ toolkitRoot, host: 'claude-code', homeDir: home, antigravity: true }), new AntigravityGlobalSkills({ toolkitRoot, homeDir: home })];
  }
  #appOf(target) {
    const hit = this.#apps.find(entry => path.resolve(entry.dir).toLowerCase() === path.resolve(target).toLowerCase());
    return hit ? hit.app : 'shared';
  }
  plan() {
    return this.#owners.flatMap(owner => owner.recorded()).map(({ target, skill }) => ({ what: display(this.#home, path.join(target, skill)), action: 'remove', app: this.#appOf(target), target: display(this.#home, target) }))
      .sort((a, b) => a.what.localeCompare(b.what));
  }
  // Removes the recorded copies only in the folders the plan listed, so another app's copies stay.
  apply(items) {
    if (!items.some(item => item.action === 'remove')) return [];
    const targets = new Set(items.filter(item => item.action === 'remove').map(item => item.target));
    const removed = new Set();
    const failures = [];
    for (const owner of this.#owners) {
      for (const target of [...new Set(owner.recorded().map(entry => entry.target))].filter(dir => targets.has(display(this.#home, dir)))) {
        try { for (const { target: dir, skill } of owner.remove(target)) removed.add(display(this.#home, path.join(dir, skill))); }
        catch (error) { failures.push(safe(error)); }
      }
    }
    return items.filter(item => item.action === 'remove').map(item => removed.has(item.what) ? { what: item.what, result: 'removed' }
      : failures.length ? { what: item.what, result: 'failed', reason: failures.join('; ') } : { what: item.what, result: 'already gone' });
  }
}

// The reinstall note (toolkit-reinstall-note.cjs): the helper stack each app's Toolkit helper files
// name, so `setup toolkit` can put them back later. Scheduled tasks are never noted. Saved
// first, into the kept backups folder. Its content is in the plan, so the owner sees it.
class ReinstallNotePart {
  key = 'reinstall_note'; title = 'Kept for a later reinstall'; app = 'any';
  #home; #helpers;
  constructor({ environment = process.env, home = os.homedir(), helpers } = {}) {
    this.#home = home;
    this.#helpers = helpers || (() => {
      const { ClaudeHelperDefinitions } = require('./toolkit-claude-helper-agents.cjs');
      const { CodexHelperDefinitions } = require('./toolkit-codex-helper-agents.cjs');
      const env = { ...environment, CLAUDE_CONFIG_DIR: claudeConfigDir(environment, home), CODEX_HOME: codexHomeDir(environment, home) };
      const stackOf = (make) => { try { return make().check().files.map(file => file.stack).find(Boolean) || null; } catch { return null; } };
      return { 'claude-code': stackOf(() => new ClaudeHelperDefinitions({ environment: env })), codex: stackOf(() => new CodexHelperDefinitions({ environment: env })) };
    });
  }
  plan() {
    const stacks = this.#helpers();
    const helpers = Object.fromEntries(Object.entries(stacks).filter(([, stack]) => stack));
    const note = require('./toolkit-reinstall-note.cjs');
    if (!Object.keys(helpers).length) return [];
    const said = Object.entries(helpers).map(([host, stack]) => `the ${host === 'codex' ? 'Codex' : 'Claude Code'} helpers (stack ${stack})`);
    return [{ what: display(this.#home, note.notePath(this.#home)), action: 'save', detail: `so setup toolkit can put back ${said.join(' and ')}; no keys`, note: { helpers } }];
  }
  apply(items) {
    const note = require('./toolkit-reinstall-note.cjs');
    return items.filter(item => item.action === 'save').map(item => attempt(item, () => { note.saveNote(this.#home, item.note); return { result: 'saved' }; }));
  }
}

// Codex's approval records for the Toolkit plugin's hooks ([hooks.state."ai-agent-toolkit@..."] tables
// in config.toml) and the empty Toolkit plugin cache folder. `codex plugin remove` leaves both behind.
// Removed only once the Codex plugin is uninstalled, so an installed plugin keeps its hook approvals.
// The edit is checked with Python's tomllib: the new file must parse and equal the old one without
// exactly those tables. Without Python, or on any difference, the file is left alone.
class CodexHookStatePart {
  key = 'codex_hook_state'; title = 'Codex hook records for Toolkit'; app = 'codex';
  #home; #codexHome; #plugins; #parse; #now;
  constructor({ environment = process.env, home = os.homedir(), plugins, parse, now = () => new Date() } = {}) {
    this.#home = home;
    this.#codexHome = codexHomeDir(environment, home);
    this.#plugins = plugins || (() => pluginState({ environment, home }));
    this.#parse = parse || require('./codex-delegation-common.cjs').parseTomlDocument;
    this.#now = now;
  }
  get #config() { return path.join(this.#codexHome, 'config.toml'); }
  get #cache() { return path.join(this.#codexHome, 'plugins', 'cache', MARKETPLACE); }
  plan() {
    const items = [];
    let text = null;
    try { text = fs.readFileSync(this.#config, 'utf8'); } catch { text = null; }
    const keys = text === null ? [] : require('./setup-codex-toolkit-plugin.cjs').toolkitHookStateTables(text).keys;
    if (keys.length) items.push({ what: `${display(this.#home, this.#config)}: Codex's approval records for ${keys.length} Toolkit ${keys.length === 1 ? 'hook' : 'hooks'}`, action: 'remove',
      detail: 'once the Codex plugin is uninstalled; a backup is saved first and the rest of the file stays', keys: [...keys].sort() });
    if (fs.existsSync(this.#cache)) items.push({ what: display(this.#home, this.#cache), action: 'remove', detail: 'once the Codex plugin is uninstalled and the folder holds no files' });
    return items;
  }
  apply(items) {
    const codexOn = () => { try { return this.#plugins().codex === true; } catch { return true; } };
    return items.filter(item => item.action === 'remove').map(item => attempt(item, () => {
      if (codexOn()) return { result: 'kept', reason: 'the Codex plugin is still installed' };
      return item.keys ? this.#removeTables(item.keys) : this.#removeCache();
    }));
  }
  #removeCache() {
    if (!fs.existsSync(this.#cache)) return { result: 'already gone' };
    const holdsFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).some(entry => !entry.isDirectory() || holdsFiles(path.join(dir, entry.name)));
    if (fs.lstatSync(this.#cache).isSymbolicLink() || holdsFiles(this.#cache)) return { result: 'kept', reason: 'it still holds files' };
    fs.rmSync(this.#cache, { recursive: true, force: true });
    return { result: 'removed' };
  }
  #removeTables(planned) {
    const { toolkitHookStateTables } = require('./setup-codex-toolkit-plugin.cjs');
    const before = fs.readFileSync(this.#config);
    const text = before.toString('utf8');
    const found = toolkitHookStateTables(text);
    if (!found.keys.length) return { result: 'already gone' };
    if ([...found.keys].sort().join('\n') !== planned.join('\n')) return { result: 'kept', reason: 'the hook records changed after the plan; run plan again' };
    const after = Buffer.from(found.text, 'utf8');
    const old = this.#parse(before), next = this.#parse(after);
    const byHand = `remove the [hooks.state."${PLUGIN_ID}:..."] tables by hand`;
    if (!old.ok || !next.ok) return { result: 'kept', reason: old.kind === 'parser-unavailable' || next.kind === 'parser-unavailable' ? `Python 3.11 or later is needed to check the edit; ${byHand}` : `the file did not parse as expected; ${byHand}` };
    if (JSON.stringify(withoutHookStates(old.doc, planned)) !== JSON.stringify(withoutHookStates(next.doc, []))) return { result: 'kept', reason: `taking the tables out would change other settings; ${byHand}` };
    const backupDir = path.join(this.#home, '.ai-agent-toolkit', 'backups', 'remove-toolkit', this.#now().toISOString().replace(/[:.]/g, '-'));
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, 'codex-config.toml'), before, { mode: 0o600 });
    if (!fs.readFileSync(this.#config).equals(before)) return { result: 'kept', reason: 'the file changed while it was being edited; run plan again' };
    const temp = `${this.#config}.toolkit-${process.pid}.tmp`;
    try { fs.writeFileSync(temp, after, { mode: fs.statSync(this.#config).mode & 0o777 }); fs.renameSync(temp, this.#config); }
    finally { fs.rmSync(temp, { force: true }); }
    if (!fs.readFileSync(this.#config).equals(after)) throw new Error('config.toml did not read back as written; the backup is in ' + display(this.#home, backupDir));
    return { result: 'removed', reason: `backup in ${display(this.#home, backupDir)}` };
  }
}

// A parsed TOML document (codex-delegation-common's typed form) without the given hook records, and
// with a hooks.state or hooks table that is left empty dropped, so both sides compare alike.
function withoutHookStates(doc, keys) {
  const copy = JSON.parse(JSON.stringify(doc || { t: 'table', v: {} }));
  const hooks = copy.v?.hooks;
  const state = hooks?.t === 'table' ? hooks.v.state : null;
  if (state?.t === 'table') {
    for (const key of keys) delete state.v[key];
    if (!Object.keys(state.v).length) delete hooks.v.state;
  }
  if (hooks?.t === 'table' && !Object.keys(hooks.v).length) delete copy.v.hooks;
  return copy;
}

// MCP servers whose key helper runs toolkit-env.cjs from inside the Toolkit folder. Listed, never
// changed: their settings stay, but they get no key until Toolkit is reinstalled. The keys themselves
// stay in the computer's credential store.
class McpKeyHelpersPart {
  key = 'mcp_key_helpers'; title = 'MCP servers that get their key through Toolkit';
  #home; #claudeJson; #codexConfig; #folder;
  constructor({ environment = process.env, home = os.homedir() } = {}) {
    this.#home = home;
    this.#claudeJson = path.join(home, '.claude.json');
    this.#codexConfig = path.join(codexHomeDir(environment, home), 'config.toml');
    this.#folder = path.join(home, '.ai-agent-toolkit');
  }
  // A command that runs toolkit-env.cjs from inside the Toolkit folder, compared with forward slashes
  // and, as on Windows, without regard to case.
  #inFolder(value) {
    const text = String(value || '').replace(/\\\\/g, '/').replace(/\\/g, '/').toLowerCase();
    return text.includes('toolkit-env.cjs') && text.includes(this.#folder.replace(/\\/g, '/').toLowerCase());
  }
  #claude() {
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(this.#claudeJson, 'utf8').replace(/^﻿/, '')); } catch { return []; }
    const found = [];
    const scan = (servers, scope) => {
      if (!servers || typeof servers !== 'object') return;
      for (const [name, entry] of Object.entries(servers)) {
        const parts = [entry?.headersHelper, entry?.command, ...(Array.isArray(entry?.args) ? entry.args : [])];
        if (parts.some(part => this.#inFolder(part))) found.push({ what: `Claude Code ${scope}: ${name}`, app: 'claude-code' });
      }
    };
    scan(parsed?.mcpServers, 'user server');
    for (const [project, settings] of Object.entries(parsed?.projects || {})) scan(settings?.mcpServers, `server in ${project}`);
    return found;
  }
  #codex() {
    let text;
    try { text = fs.readFileSync(this.#codexConfig, 'utf8'); } catch { return []; }
    const found = new Set();
    let server = null;
    for (const line of text.split(/\r?\n/)) {
      const header = line.match(/^\s*\[\s*mcp_servers\.("([^"]+)"|'([^']+)'|[A-Za-z0-9_-]+)[\].]/);
      if (header) { server = header[2] || header[3] || header[1]; continue; }
      if (/^\s*\[/.test(line)) { server = null; continue; }
      if (server && this.#inFolder(line)) found.add(`Codex server: ${server}`);
    }
    return [...found].map(what => ({ what, app: 'codex' }));
  }
  plan() {
    return [...this.#claude(), ...this.#codex()].sort((a, b) => a.what.localeCompare(b.what)).map(({ what, app }) => ({ what, app, action: 'keep',
      detail: 'its settings stay, but it gets no key until Toolkit is reinstalled; the key stays in the credential store' }));
  }
  apply() { return []; }
}

// Whether the Toolkit plugin is installed in each app. Read from the apps' own files, never by
// starting an app.
function pluginState({ environment = process.env, home = os.homedir() } = {}) {
  let claude = false;
  try {
    const { ClaudePluginRegistry } = require('./toolkit-claude-plugin-registry.cjs');
    claude = new ClaudePluginRegistry({ environment, homeDir: home }).toolkitInstall().records.length > 0;
  } catch { claude = false; }
  const codexHome = codexHomeDir(environment, home);
  let config = '';
  try { config = fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8'); } catch { config = ''; }
  // A plain line compare: the table header is one line, possibly with a trailing comment.
  const header = `[plugins."${PLUGIN_ID}"]`;
  const table = config.split(/\r?\n/).some(line => { const text = line.trim(); return text === header || text.startsWith(`${header} #`); });
  const cache = fs.existsSync(path.join(codexHome, 'plugins', 'cache', MARKETPLACE, 'ai-agent-toolkit'));
  return { 'claude-code': claude, codex: table && cache };
}

const PLUGIN_STEPS = Object.freeze({
  'claude-code': Object.freeze({ app: 'Claude Code', lines: [`claude plugin uninstall ${PLUGIN_ID}`, `claude plugin marketplace remove ${MARKETPLACE}`], ui: 'type /plugin, open AI Agent Toolkit and choose Uninstall' }),
  codex: Object.freeze({ app: 'Codex', lines: [`codex plugin remove ${PLUGIN_ID}`, `codex plugin marketplace remove ${MARKETPLACE}`], ui: 'open Plugins, find AI Agent Toolkit and remove it' }),
});

// Toolkit's own entries in ~/.ai-agent-toolkit. Removed only when no Toolkit plugin is installed.
class ToolkitFolderPart {
  key = 'toolkit_folder'; title = 'Toolkit folder'; app = 'shared';
  #home; #root; #plugins;
  constructor({ home = os.homedir(), environment = process.env, plugins } = {}) {
    this.#home = home;
    this.#root = path.join(home, '.ai-agent-toolkit');
    this.#plugins = plugins || (() => pluginState({ environment, home }));
  }
  get root() { return this.#root; }
  #present() {
    try { return fs.readdirSync(this.#root).sort(); } catch { return []; }
  }
  // Toolkit's entries with something to remove: one that holds nothing but its kept backups has none.
  #going() {
    const onlyKept = name => { try { return fs.readdirSync(path.join(this.#root, name)).every(child => KEPT_INSIDE[name].includes(child)); } catch { return false; } };
    return this.#present().filter(name => FOLDER_ENTRIES.includes(name) && !(KEPT_INSIDE[name] && onlyKept(name)));
  }
  plan() {
    const names = this.#present();
    const going = this.#going();
    const kept = names.filter(name => !going.includes(name));
    return [
      ...going.map(name => ({ what: display(this.#home, path.join(this.#root, name)), action: 'remove',
        ...(KEPT_INSIDE[name] ? { detail: `its ${KEPT_INSIDE[name].join(', ')} folder stays` } : {}) })),
      ...kept.map(name => ({ what: display(this.#home, path.join(this.#root, name)), action: 'keep',
        detail: name === 'env' ? 'the list of your keys; the keys themselves stay in the credential store' : name === 'backups' || KEPT_INSIDE[name] ? 'copies of the files Toolkit changed, including this removal' : 'not a Toolkit file' })),
    ];
  }
  // Runs last. Entries a removal step wrote after the plan (such as the global rules record) go too,
  // because they are on the same fixed list.
  apply(items) {
    if (!items.some(item => item.action === 'remove')) return [];
    const installed = Object.entries(this.#plugins()).filter(([, on]) => on).map(([host]) => PLUGIN_STEPS[host].app);
    if (installed.length) return [{ what: display(this.#home, this.#root), result: 'kept', reason: `the ${installed.join(' and ')} plugin is still installed and reads its records there` }];
    // A process whose folder is inside what goes could not remove it on Windows.
    const cwd = process.cwd();
    const inside = path.relative(this.#root, cwd);
    if (!inside.startsWith('..') && !path.isAbsolute(inside)) process.chdir(this.#home);
    const results = [];
    for (const name of this.#going()) {
      const target = path.join(this.#root, name);
      results.push(attempt({ what: display(this.#home, target) }, () => { removeExcept(target, KEPT_INSIDE[name] || []); return { result: 'removed' }; }));
    }
    try { if (fs.readdirSync(this.#root).length === 0) { fs.rmdirSync(this.#root); results.push({ what: display(this.#home, this.#root), result: 'removed' }); } } catch { /* kept; listed above */ }
    return results;
  }
}

// Removes a file or folder, keeping the named direct children of a folder.
function removeExcept(target, keep) {
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || !keep.length) { fs.rmSync(target, { recursive: true, force: true, maxRetries: 3 }); return; }
  for (const name of fs.readdirSync(target)) if (!keep.includes(name)) fs.rmSync(path.join(target, name), { recursive: true, force: true, maxRetries: 3 });
  if (fs.readdirSync(target).length === 0) fs.rmdirSync(target);
}

// The parts in the order apply runs them: the reinstall note first, then settings, then files, then
// the folder last.
function defaultParts({ environment = process.env, home = os.homedir() } = {}) {
  return [new ReinstallNotePart({ environment, home }), new McpKeyHelpersPart({ environment, home }), new ClaudeDepthPart({ environment, home }), new ClaudeUserSettingsPart({ environment, home }),
    new CodexHelperLimitPart({ environment, home }), new CodexHookStatePart({ environment, home }), new HelperAgentFilesPart({ environment, home }),
    new SkillCopiesPart({ environment, home }), new ToolkitFolderPart({ home, environment })];
}

module.exports = { ReinstallNotePart, CodexHookStatePart, McpKeyHelpersPart, withoutHookStates, ClaudeDepthPart, ClaudeUserSettingsPart, CodexHelperLimitPart, HelperAgentFilesPart, SkillCopiesPart, ToolkitFolderPart, FOLDER_ENTRIES, KEPT_ENTRIES, PLUGIN_ID, MARKETPLACE, PLUGIN_STEPS, defaultParts, pluginState, removeExcept };
