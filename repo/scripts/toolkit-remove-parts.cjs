'use strict';

// The parts of `remove toolkit` beyond scheduled tasks and global rules: each one lists what Toolkit
// left in one place and removes only that, through the module that owns it.
//
// Every part has:
//   key, title
//   plan()        read-only; [{ what, action: 'remove' | 'keep' | 'held', detail? }]. The plan code
//                 covers this list, so a list that changes after the owner saw it removes nothing.
//   apply(items)  removes the items planned as 'remove'; [{ what, result, reason? }].
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
  key = 'claude_settings'; title = 'Claude Code subagent limit';
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
  key = 'claude_preferences'; title = 'Claude Code preferences you chose at setup';
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
  key = 'codex_helper_limit'; title = 'Codex helper limit';
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
      { dir: path.join(claudeConfigDir(environment, home), 'agents'), marker: require('./toolkit-claude-helper-agents.cjs').MARKER },
      { dir: path.join(codexHomeDir(environment, home), 'agents'), marker: require('./toolkit-codex-helper-agents.cjs').MARKER },
    ];
  }
  #found() {
    const found = [];
    for (const { dir, marker } of this.#folders) {
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const file = path.join(dir, entry.name);
        let text = '';
        try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
        if (text.includes(marker)) found.push({ file, marker });
      }
    }
    return found.sort((a, b) => a.file.localeCompare(b.file));
  }
  plan() { return this.#found().map(({ file }) => ({ what: display(this.#home, file), action: 'remove' })); }
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
  #owners; #home;
  constructor({ home = os.homedir(), toolkitRoot = path.resolve(__dirname, '..', '..'), owners } = {}) {
    this.#home = home;
    if (owners) { this.#owners = owners; return; }
    const { OfficialN8nSkills } = require('./toolkit-n8n-official-skills.cjs');
    const { AntigravityGlobalSkills } = require('./toolkit-antigravity-project-skills.cjs');
    this.#owners = [new OfficialN8nSkills({ toolkitRoot, host: 'claude-code', homeDir: home, antigravity: true }), new AntigravityGlobalSkills({ toolkitRoot, homeDir: home })];
  }
  plan() {
    return this.#owners.flatMap(owner => owner.recorded()).map(({ target, skill }) => ({ what: display(this.#home, path.join(target, skill)), action: 'remove' }))
      .sort((a, b) => a.what.localeCompare(b.what));
  }
  apply(items) {
    if (!items.some(item => item.action === 'remove')) return [];
    const removed = new Set();
    const failures = [];
    for (const owner of this.#owners) {
      try { for (const { target, skill } of owner.remove()) removed.add(display(this.#home, path.join(target, skill))); }
      catch (error) { failures.push(safe(error)); }
    }
    return items.filter(item => item.action === 'remove').map(item => removed.has(item.what) ? { what: item.what, result: 'removed' }
      : failures.length ? { what: item.what, result: 'failed', reason: failures.join('; ') } : { what: item.what, result: 'already gone' });
  }
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
  key = 'toolkit_folder'; title = 'Toolkit folder';
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

// The parts in the order apply runs them: settings, then files, then the folder last.
function defaultParts({ environment = process.env, home = os.homedir() } = {}) {
  return [new ClaudeDepthPart({ environment, home }), new ClaudeUserSettingsPart({ environment, home }), new CodexHelperLimitPart({ environment, home }), new HelperAgentFilesPart({ environment, home }),
    new SkillCopiesPart({ home }), new ToolkitFolderPart({ home, environment })];
}

module.exports = { ClaudeDepthPart, ClaudeUserSettingsPart, CodexHelperLimitPart, HelperAgentFilesPart, SkillCopiesPart, ToolkitFolderPart, FOLDER_ENTRIES, KEPT_ENTRIES, PLUGIN_ID, MARKETPLACE, PLUGIN_STEPS, defaultParts, pluginState, removeExcept };
