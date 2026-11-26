'use strict';

// The parts of `remove toolkit` beyond scheduled tasks and global rules: each one lists what Toolkit
// left in one place and removes only that, through the module that owns it.
//
// Every part has:
//   key, title
//   label, unit   the bold label its lines carry on the owner's screen, and what its items are called
//                 when a long list is folded into a count. An item's own `label` wins.
//   plan(context) read-only; [{ what, action: 'remove' | 'keep' | 'held' | 'save', detail?, label?, text?,
//                 short?, backup? }]. `text` replaces what and detail on the screen, and `short` replaces
//                 `text` on every screen after the first plan (the full lists and the closing lines);
//                 `backup: true` marks an
//                 item whose removal saves a backup first. context.savesBackup says whether an earlier
//                 step of this removal saves one. The plan code covers this list, so a list that
//                 changes after the owner saw it removes nothing.
//   summary(items) optional: the screen's one-line summary of a folded list of the part's removals.
//   apply(items)  removes the items planned as 'remove'; [{ what, result, reason? }].
//   app           whose part it is: 'codex', 'claude-code', 'shared' (used by every app) or 'any' (always
//                 runs). An item's own `app` wins, for parts that span apps. `remove toolkit` runs in one
//                 app and plans only that app's items; shared items wait while another app keeps Toolkit.
//   shared        optional: what the part's shared items are called in the plan's scope line, which names
//                 only the shared parts found on the computer (default: the title).
//
// The Toolkit folder (~/.ai-agent-toolkit) goes last, and only once neither the Claude Code nor the
// Codex plugin is installed, because a plugin that is still installed reads its records there. Only
// the MCP report runs after it.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PLUGIN_ID = 'ai-agent-toolkit@ai-agent-toolkit-local';
const MARKETPLACE = 'ai-agent-toolkit-local';
// Top-level entries of ~/.ai-agent-toolkit that Toolkit makes: the managed checkout, the hub snapshot,
// its records, ledgers and locks, the bridge's update markers, and the backups. A full removal (or the
// last app's) removes them all, keeping only KEPT_ENTRIES, the backups Toolkit holds for the owner and
// this removal's backup. Anything else found there is not Toolkit's: it is kept and listed.
const FOLDER_ENTRIES = Object.freeze(['source', 'current', 'user-state', 'agent-control', 'backups', 'global-rules.json', 'n8n-official-skills.json', 'antigravity-toolkit-skills.json', 'antigravity-refresh',
  'remote-check.json', 'update.readers', 'update.lock', 'update.lock.recovery', 'update.tree-moving', 'agent-rules-notices.json', 'hook-skips.json']);
// The names the bridge gives its short-lived entries (toolkit-local-bridge.cjs, toolkit-staging-generations.cjs):
// lock claims, displaced locks and their tombstones, staging folders and their records, and the old hub
// kept during a swap.
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const FOLDER_PATTERNS = Object.freeze([/^update\.lock\.recovery\.claim-[0-9a-f]{16}$/, new RegExp(`^update\\.lock\\.displaced\\.${UUID}(?:\\.retired-[0-9a-f]{16})?$`),
  new RegExp(`^\\.staging-${UUID}$`), new RegExp(`^\\.toolkit-staging-generation-${UUID}(?:\\.(?:ready|completed|failed))?\\.json$`), /^\.current\.backup-\d+-\d+$/]);
const isToolkitEntry = name => FOLDER_ENTRIES.includes(name) || FOLDER_PATTERNS.some(pattern => pattern.test(name));
// What stays: the list of the owner's keys and the evidence of outside resources checked before a
// live change.
const KEPT_ENTRIES = Object.freeze(['env', 'recovery-identities']);
const KEPT_LABELS = Object.freeze({
  env: { label: 'Your key list', detail: 'the keys themselves stay in the credential store' },
  'recovery-identities': { label: 'Recovery records', detail: 'the evidence of outside resources checked before a live change' },
});
// The folders that hold backups, relative to the Toolkit folder. Files a removal writes there are its
// own backup: they are gathered into REMOVAL_BACKUP; every other file there is an older backup of
// Toolkit's own and goes, except the backups below that other features keep for the owner.
const BACKUP_TREES = Object.freeze(['backups', 'agent-control/backups']);
const REMOVAL_BACKUP = 'backups/remove-toolkit';
// Backups Toolkit holds for the owner, which a removal keeps and names: the owner's own ~/.codex/.env
// that `toolkit env retire-codex-env` moved (it never deletes it), the MCP entries `toolkit env
// revoke --feeders` puts back (the kept env record points at them), and memory tidy's backups, which
// its restore reads. Matched on the folder directly under backups/.
const OWNER_BACKUPS = Object.freeze([
  { match: name => /^env-retire-[0-9A-Za-z-]+$/.test(name), label: 'Your old Codex .env', detail: 'the file toolkit env moved there; it may be your only copy of its comment lines' },
  { match: name => name === 'env-feeders', label: 'Key connection backups', detail: 'the MCP settings toolkit env changed, which `toolkit env` can put back' },
  { match: name => name === 'memory-tidy', label: 'Memory tidy backups', detail: 'your memory notes from before a tidy, which memory tidy can put back' },
]);
const ownerBackupOf = file => { const [top, name] = file.split('/'); return top === 'backups' && name ? OWNER_BACKUPS.find(entry => entry.match(name)) || null : null; };

// A list longer than this is folded on the owner's screen into a count, with the full list on request.
const FOLD_AT = 3;

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
  key = 'claude_settings'; title = 'Claude Code subagent limit'; label = 'Claude Code subagent limit'; app = 'claude-code';
  #setting; #what;
  constructor({ environment = process.env, home = os.homedir(), setting } = {}) {
    if (setting) this.#setting = setting;
    else {
      const { ClaudeSubagentDepthSetting } = require('./toolkit-claude-subagent-depth.cjs');
      this.#setting = new ClaudeSubagentDepthSetting({ environment, controlRoot: environment.AI_AGENT_TOOLKIT_CONTROL_ROOT || path.join(home, '.ai-agent-toolkit', 'agent-control') });
    }
    this.#what = `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH in ${display(home, path.join(claudeConfigDir(environment, home), 'settings.json'))}`;
  }
  plan() {
    const state = this.#setting.inspect();
    if (state.state === 'toolkit-one-layer') return [{ what: this.#what, action: 'remove', detail: "Toolkit's value; Claude Code goes back to its default", backup: true }];
    if (state.state === 'owner-value') return [{ what: this.#what, action: 'keep', detail: 'your own value' }];
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

// The Claude Code settings setup turned on (no AI attribution, session messages, model switching,
// reading AGENTS.md). Listed, never changed: they are Claude Code's own settings, which removal leaves
// exactly as they are, and turning attribution back on would put trailers back in commits. The
// listing says how to change one by hand.
class ClaudeUserSettingsPart {
  key = 'claude_preferences'; title = 'Claude Code settings left as they are'; label = 'Claude Code settings from setup'; unit = 'settings'; app = 'claude-code';
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
      .map(entry => entry.id === 'attribution'
        // The owner's wording for the one setting most owners know.
        ? { what: `${entry.label} (${entry.id})`, action: 'keep', label: 'No AI credit in commits', text: `a Claude Code setting setup turned on; change it in ${this.#file}` }
        : { what: `${entry.label} (${entry.id})`, action: 'keep', detail: `Claude Code's own settings, so they stay as they are; change them in ${this.#file}` });
  }
  apply() { return []; }
}

// Codex setup's journal (setup-codex-toolkit-plugin.cjs), its record of each plugin step it ran. One
// whose last step finished goes. One that records an unfinished or unreadable step stays: it is the
// evidence of what was attempted, and setup reads it so it never retries that step blindly.
class CodexSetupJournalPart {
  key = 'codex_setup_journal'; title = 'Codex setup record'; label = 'Codex setup record'; app = 'codex';
  #home; #journal;
  constructor({ environment = process.env, home = os.homedir(), journal } = {}) {
    this.#home = home;
    this.#journal = journal || new (require('./setup-codex-toolkit-plugin.cjs').CodexSetupJournal)(codexHomeDir(environment, home));
  }
  #state() {
    if (!fs.existsSync(this.#journal.path)) return 'absent';
    return this.#journal.unresolved() ? 'unfinished' : 'finished';
  }
  plan() {
    const what = display(this.#home, this.#journal.path);
    const state = this.#state();
    if (state === 'finished') return [{ what, action: 'remove' }];
    if (state === 'unfinished') return [{ what, action: 'keep', detail: 'it records a setup step that did not finish or cannot be read, so it stays as the evidence of what was attempted' }];
    return [];
  }
  apply(items) {
    return items.filter(item => item.action === 'remove').map(item => attempt(item, () => {
      // Read again just before removal: a step that started after the plan keeps the journal.
      const state = this.#state();
      if (state === 'absent') return { result: 'already gone' };
      if (state === 'unfinished') return { result: 'kept', reason: 'a setup step started after the plan; it is the evidence of what was attempted' };
      fs.rmSync(this.#journal.path, { force: true });
      return { result: 'removed' };
    }));
  }
}

// The update reports the bridge writes to the temp folder (toolkit-local-bridge.cjs). Only files with
// the bridge's report name go; the folder goes once empty, and its ai-agent-toolkit parent too. Like
// the Toolkit folder, it waits while a Toolkit plugin is installed, because the plugin writes there.
class UpdateReportsPart {
  key = 'update_reports'; title = 'Toolkit update reports'; label = 'Update reports'; app = 'shared'; shared = "Toolkit's update reports";
  #home; #dir; #isReport; #plugins;
  constructor({ environment = process.env, home = os.homedir(), reportDir, isReport, plugins } = {}) {
    this.#home = home;
    const bridge = reportDir && isReport ? null : require('./toolkit-local-bridge.cjs');
    this.#dir = path.resolve(reportDir || bridge.updateReportDir());
    this.#isReport = isReport || (file => bridge.isUpdateReportPath(file, { reportDir: this.#dir }));
    this.#plugins = plugins || (() => pluginState({ environment, home }));
  }
  #reports() {
    let names = [];
    try { names = fs.readdirSync(this.#dir); } catch { return []; }
    return names.map(name => path.join(this.#dir, name)).filter(file => this.#isReport(file));
  }
  // Listed while a Toolkit report is there, or the folder is empty; a folder left holding only other
  // files is not listed again after a removal that kept it.
  plan() {
    let names;
    try { names = fs.readdirSync(this.#dir); } catch { return []; }
    if (names.length && !this.#reports().length) return [];
    return [{ what: display(this.#home, this.#dir), action: 'remove', detail: "Toolkit's report files; any other file there stays" }];
  }
  apply(items) {
    return items.filter(item => item.action === 'remove').map(item => attempt(item, () => {
      const installed = Object.entries(this.#plugins()).filter(([, on]) => on).map(([host]) => PLUGIN_STEPS[host].app);
      if (installed.length) return { result: 'kept', reason: `the ${installed.join(' and ')} plugin is still installed and writes its reports there` };
      if (!fs.existsSync(this.#dir)) return { result: 'already gone' };
      for (const file of this.#reports()) fs.rmSync(file, { force: true });
      for (const dir of [this.#dir, path.dirname(this.#dir)]) { try { if (!fs.readdirSync(dir).length) fs.rmdirSync(dir); } catch { break; } }
      return fs.existsSync(this.#dir) ? { result: 'kept', reason: 'it still holds files that are not Toolkit reports' } : { result: 'removed' };
    }));
  }
}

// Toolkit's helper-capacity block in Codex's config.toml.
class CodexHelperLimitPart {
  key = 'codex_helper_limit'; title = 'Codex helper limit'; label = 'Codex helper limit'; app = 'codex';
  #delegation; #configPath; #what;
  constructor({ environment = process.env, home = os.homedir(), delegation, configPath } = {}) {
    this.#delegation = delegation || require('./codex-delegation-config.cjs');
    this.#configPath = configPath || path.join(codexHomeDir(environment, home), 'config.toml');
    this.#what = `Toolkit's block in ${display(home, this.#configPath)}`;
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
    return [{ what: this.#what, action: 'remove', detail: `${Number.isInteger(block.helper_count) ? `${block.helper_count} helpers; ` : ''}Codex may then use its own higher default`, backup: true }];
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
  key = 'helper_agents'; title = 'Toolkit helper agent files'; label = 'Helper agents'; unit = 'Toolkit files';
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
  key = 'skill_copies'; title = 'Skill folders Toolkit copied'; label = 'Skill copies'; unit = 'skill folders Toolkit copied'; shared = "Antigravity's skill copies";
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
  key = 'reinstall_note'; title = 'Kept for a later reinstall'; label = 'Reinstall note'; app = 'any';
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
    return [{ what: display(this.#home, note.notePath(this.#home)), action: 'save', text: `saved with this removal's backup, so \`setup toolkit\` can put back ${said.join(' and ')}; it holds no keys`, note: { helpers } }];
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
  key = 'codex_hook_state'; title = 'Codex hook records for Toolkit'; label = 'Codex hook approvals'; app = 'codex';
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
    if (keys.length) items.push({ what: `Codex's approval records for ${keys.length} Toolkit ${keys.length === 1 ? 'hook' : 'hooks'} in ${display(this.#home, this.#config)}`, action: 'remove',
      detail: 'once the Codex plugin is uninstalled; the rest of the file stays', keys: [...keys].sort(), backup: true });
    if (fs.existsSync(this.#cache)) items.push({ what: display(this.#home, this.#cache), action: 'remove', label: 'Codex plugin cache', detail: 'once the Codex plugin is uninstalled and the folder is empty' });
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

// MCP servers whose key helper runs toolkit-env.cjs from inside a Toolkit folder entry that this
// removal deletes (the managed checkout, as a rule). Listed only then, and never changed: their
// settings and keys stay, but they get no key once the helper is gone. Shared, because the Toolkit
// folder is; it runs after the folder, so apply reports each server whose helper is now gone, and the
// closing lines say how to connect it again.
class McpKeyHelpersPart {
  key = 'mcp_key_helpers'; title = 'MCP servers that get their key through Toolkit'; label = 'MCP servers'; app = 'shared';
  #home; #claudeJson; #codexConfig; #root; #folder;
  // folder: the ToolkitFolderPart, which says which of its entries this removal deletes.
  constructor({ environment = process.env, home = os.homedir(), folder } = {}) {
    this.#home = home;
    this.#claudeJson = path.join(home, '.claude.json');
    this.#codexConfig = path.join(codexHomeDir(environment, home), 'config.toml');
    this.#root = path.join(home, '.ai-agent-toolkit');
    this.#folder = folder || new ToolkitFolderPart({ home, environment });
  }
  // The Toolkit folder entry a command runs toolkit-env.cjs from, or null. Compared with forward
  // slashes and, as on Windows, without regard to case.
  #entryOf(value) {
    const text = String(value || '').replace(/\\\\/g, '/').replace(/\\/g, '/').toLowerCase();
    const root = `${this.#root.replace(/\\/g, '/').toLowerCase()}/`;
    const at = text.indexOf(root);
    if (!text.includes('toolkit-env.cjs') || at === -1) return null;
    return text.slice(at + root.length).match(/^[^/"'\s]+/)?.[0] || null;
  }
  #claude() {
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(this.#claudeJson, 'utf8').replace(/^﻿/, '')); } catch { return []; }
    const found = [];
    const scan = (servers, scope) => {
      if (!servers || typeof servers !== 'object') return;
      for (const [name, entry] of Object.entries(servers)) {
        const entryName = [entry?.headersHelper, entry?.command, ...(Array.isArray(entry?.args) ? entry.args : [])].map(part => this.#entryOf(part)).find(Boolean);
        if (entryName) found.push({ what: `${name} (Claude Code${scope})`, entry: entryName });
      }
    };
    scan(parsed?.mcpServers, '');
    for (const [project, settings] of Object.entries(parsed?.projects || {})) scan(settings?.mcpServers, `, in ${display(this.#home, project)}`);
    return found;
  }
  #codex() {
    let text;
    try { text = fs.readFileSync(this.#codexConfig, 'utf8'); } catch { return []; }
    const found = new Map();
    let server = null;
    for (const line of text.split(/\r?\n/)) {
      const header = line.match(/^\s*\[\s*mcp_servers\.("([^"]+)"|'([^']+)'|[A-Za-z0-9_-]+)[\].]/);
      if (header) { server = header[2] || header[3] || header[1]; continue; }
      if (/^\s*\[/.test(line)) { server = null; continue; }
      const entryName = server && this.#entryOf(line);
      if (entryName && !found.has(server)) found.set(server, entryName);
    }
    return [...found].map(([name, entryName]) => ({ what: `${name} (Codex)`, entry: entryName }));
  }
  plan() {
    const going = this.#folder.goingEntries().map(name => name.toLowerCase());
    return [...this.#claude(), ...this.#codex()].filter(item => going.includes(item.entry)).sort((a, b) => a.what.localeCompare(b.what))
      .map(item => ({ ...item, action: 'keep', text: `${item.what} keeps its settings and key, but its key helper runs from the Toolkit folder, which goes; the closing lines say how to connect it again` }));
  }
  // After the folder part: a server whose helper's folder entry is gone has lost its key helper; one
  // whose entry is still there (the folder waits for a plugin) keeps it until the folder goes.
  apply(items) {
    return items.filter(item => item.action === 'keep' && item.entry).map(item => (fs.existsSync(path.join(this.#root, item.entry))
      ? { what: item.what, result: 'kept', reason: 'its key helper stays until the Toolkit folder goes' }
      : { what: item.what, result: 'lost its key helper', reconnect: true }));
  }
}

// The Claude desktop app's Toolkit copy from the user's claude.ai account. Listed, never changed: it is
// not this computer's install but the account's, synced by claude.ai to every computer and cloud session
// signed in to it, so only the owner can remove it there. Until they do, the Claude app keeps running
// Toolkit's hooks from it, so the list says so and gives the steps.
const ACCOUNT_COPY_STEPS = "only claude.ai can remove it, and that removes Toolkit from the Claude app on every computer and cloud session signed in to that account. Until then the Claude app keeps running Toolkit's hooks from it. To remove it: on claude.ai in a web browser, open Customize > Plugins and remove the ai-agent-toolkit plugin and then its marketplace (while the marketplace stays, Sync automatically can put the plugin back), then fully quit and reopen the Claude app.";
// The one line every screen after the first plan shows.
const ACCOUNT_COPY_SHORT = 'remove it on claude.ai under Customize > Plugins (plugin, then marketplace), then restart the app';
class ClaudeAccountCopyPart {
  key = 'claude_account_copy'; title = "The Claude app's Toolkit copy from your claude.ai account"; label = "The Claude app's claude.ai copy"; app = 'claude-code';
  #home; #find;
  constructor({ environment = process.env, home = os.homedir(), find } = {}) {
    this.#home = home;
    this.#find = find || (() => require('./toolkit-hook-capability.cjs').accountHookCopy(environment));
  }
  plan() {
    const folder = this.#find();
    if (!folder) return [];
    return [{ what: display(this.#home, folder), action: 'keep', text: ACCOUNT_COPY_STEPS, short: ACCOUNT_COPY_SHORT }];
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

// The files under a folder, by path relative to `base` with forward slashes, each with what tells a
// later read whether it changed. Links are listed as files and never followed.
function filesUnder(base, relative) {
  const out = new Map();
  const walk = rel => {
    const full = path.join(base, ...rel.split('/'));
    let stat;
    try { stat = fs.lstatSync(full); } catch { return; }
    if (stat.isDirectory()) { for (const name of fs.readdirSync(full).sort()) walk(`${rel}/${name}`); return; }
    let digest = '';
    if (stat.isFile()) { try { digest = require('node:crypto').createHash('sha256').update(fs.readFileSync(full)).digest('hex'); } catch { digest = 'unreadable'; } }
    out.set(rel, `${stat.size}:${stat.mtimeMs}:${digest}`);
  };
  walk(relative);
  return out;
}

// Toolkit's own entries in ~/.ai-agent-toolkit. Removed only when no Toolkit plugin is installed.
// What stays: KEPT_ENTRIES, the backups Toolkit holds for the owner (OWNER_BACKUPS), anything that is
// not Toolkit's, and the backup this removal writes, which is gathered into backups/remove-toolkit. That folder holds the last removal's backup, so a removal
// that saves no backup of its own keeps it; one that does replaces it.
class ToolkitFolderPart {
  key = 'toolkit_folder'; title = 'Toolkit folder'; label = 'Toolkit folder'; unit = 'items'; app = 'shared'; shared = 'the Toolkit folder';
  #home; #root; #plugins; #now; #before = new Map(); #savesBackup = false; #planned = false;
  constructor({ home = os.homedir(), environment = process.env, plugins, now = () => new Date() } = {}) {
    this.#home = home;
    this.#root = path.join(home, '.ai-agent-toolkit');
    this.#plugins = plugins || (() => pluginState({ environment, home }));
    this.#now = now;
  }
  get root() { return this.#root; }
  #present() {
    try { return fs.readdirSync(this.#root).sort(); } catch { return []; }
  }
  #backups() {
    const all = new Map();
    for (const tree of BACKUP_TREES) for (const [file, mark] of filesUnder(this.#root, tree)) all.set(file, mark);
    return all;
  }
  #lastRemoval(file) { return file.startsWith(`${REMOVAL_BACKUP}/`); }
  // An older backup of Toolkit's own, which a full removal deletes: never one Toolkit holds for the
  // owner, and the last removal's only when this removal saves a backup of its own.
  #older(file, savesBackup) { return file.startsWith('backups/') ? !ownerBackupOf(file) && (savesBackup || !this.#lastRemoval(file)) : true; }
  // The top-level entries this removal deletes, read-only. A backups folder that holds only what is
  // kept has nothing to delete.
  goingEntries({ savesBackup = this.#savesBackup } = {}) {
    const backups = this.#backups();
    return this.#present().filter(name => isToolkitEntry(name)
      && (name !== 'backups' || [...backups.keys()].some(file => file.startsWith('backups/') && this.#older(file, savesBackup))));
  }
  // context.savesBackup: whether an earlier step of this removal saves a backup, which then replaces
  // the last removal's.
  plan(context = {}) {
    this.#savesBackup = context.savesBackup === true;
    this.#planned = true;
    // Read again at apply's own plan read, before any step writes: what is here now is older.
    this.#before = this.#backups();
    const older = [...this.#before.keys()].filter(file => this.#older(file, this.#savesBackup));
    const lastKept = !this.#savesBackup && [...this.#before.keys()].some(file => this.#lastRemoval(file));
    const going = this.goingEntries();
    const names = this.#present();
    const shown = name => display(this.#home, path.join(this.#root, name));
    const olderIn = name => older.filter(file => file.startsWith(`${name}/`)).length;
    const ownerFolders = [...new Set([...this.#before.keys()].filter(ownerBackupOf).map(file => file.split('/').slice(0, 2).join('/')))].sort();
    return [
      ...going.map(name => ({ what: shown(name), action: 'remove',
        ...(BACKUP_TREES.some(tree => tree.split('/')[0] === name) && olderIn(name) ? { detail: `${olderIn(name)} older backup ${olderIn(name) === 1 ? 'file' : 'files'}`, older: olderIn(name) } : {}) })),
      // This removal gathers its backup in a one-app removal too, so the line shows in every scope.
      ...(this.#savesBackup ? [{ what: shown(REMOVAL_BACKUP), action: 'save', app: 'any', label: "This removal's backup", text: `${shown(REMOVAL_BACKUP)}, the copies of the files this removal changes` }] : []),
      ...(lastKept ? [{ what: shown(REMOVAL_BACKUP), action: 'keep', label: "The last removal's backup", text: shown(REMOVAL_BACKUP) }] : []),
      ...ownerFolders.map(folder => { const { label, detail } = ownerBackupOf(`${folder}/x`); return { what: shown(folder), action: 'keep', label, detail }; }),
      ...names.filter(name => !isToolkitEntry(name)).map(name => ({ what: shown(name), action: 'keep', ...(KEPT_LABELS[name] || { label: "Not Toolkit's" }) })),
    ];
  }
  // The owner's one line for the folder's removals, naming what goes; the full list is shown on request.
  summary(items) {
    const names = items.map(item => item.what.split('/').pop());
    const older = items.reduce((sum, item) => sum + (item.older || 0), 0);
    const what = [...(names.includes('source') ? ['the Toolkit checkout'] : []),
      ...(names.some(name => !['source', 'backups'].includes(name)) ? ['its records and locks'] : []),
      ...(older ? [`${older} older backup ${older === 1 ? 'file' : 'files'} of Toolkit's own`] : [])];
    const said = what.length < 2 ? what.join('') : `${what.slice(0, -1).join(', ')}, and ${what.at(-1)}`;
    return `${display(this.#home, this.#root)}: ${said}${items.length > FOLD_AT ? ` (${items.length} items, full list on request)` : ''}; it goes last, once no Toolkit plugin is installed`;
  }
  // Runs last. Entries a removal step wrote after the plan (such as the global rules record) go too,
  // because they are on the same fixed list. This removal's backup files are moved into
  // backups/remove-toolkit before anything goes, also in a one-app removal that keeps the folder.
  apply(items) {
    const removes = items.some(item => item.action === 'remove');
    if (!removes && !items.some(item => item.action === 'save')) return [];
    // Without its own plan read it cannot tell this removal's backup from the older ones.
    if (!this.#planned) throw new Error('the Toolkit folder was not read before its removal');
    // This removal's backup is gathered first, also when the folder waits for a plugin, so a later run
    // that removes the folder keeps it as the last removal's backup.
    const gathered = attempt({ what: display(this.#home, path.join(this.#root, REMOVAL_BACKUP)) }, () => this.#gather());
    if (gathered.result === 'failed') return [gathered];
    const fresh = gathered.result === 'saved';
    if (!removes) return fresh ? [gathered] : [];
    const installed = Object.entries(this.#plugins()).filter(([, on]) => on).map(([host]) => PLUGIN_STEPS[host].app);
    if (installed.length) return [...(fresh ? [gathered] : []), { what: display(this.#home, this.#root), result: 'kept', reason: `the ${installed.join(' and ')} plugin is still installed and reads its records there` }];
    // A process whose folder is inside what goes could not remove it on Windows.
    const cwd = process.cwd();
    const inside = path.relative(this.#root, cwd);
    if (!inside.startsWith('..') && !path.isAbsolute(inside)) process.chdir(this.#home);
    const results = [];
    for (const name of this.goingEntries({ savesBackup: fresh })) {
      const target = path.join(this.#root, name);
      if (name === 'backups') { results.push(attempt({ what: display(this.#home, target) }, () => this.#clearBackups(fresh))); continue; }
      results.push(attempt({ what: display(this.#home, target) }, () => { fs.rmSync(target, { recursive: true, force: true, maxRetries: 3 }); return { result: 'removed' }; }));
    }
    if (fresh) results.push(gathered);
    try { if (fs.readdirSync(this.#root).length === 0) { fs.rmdirSync(this.#root); results.push({ what: display(this.#home, this.#root), result: 'removed' }); } } catch { /* kept; listed above */ }
    return results;
  }
  // Moves every backup file this removal wrote (new since the plan read, or changed) into
  // backups/remove-toolkit/<time>/, keeping its path; files already in backups/remove-toolkit stay where
  // they are.
  #gather() {
    const now = this.#backups();
    // A file another feature keeps for the owner is never this removal's backup.
    const fresh = [...now.keys()].filter(file => this.#before.get(file) !== now.get(file) && !ownerBackupOf(file));
    if (!fresh.length) return { result: 'none' };
    const stamp = this.#now().toISOString().replace(/[:.]/g, '-');
    for (const file of fresh.filter(entry => !this.#lastRemoval(entry))) {
      const to = path.join(this.#root, ...REMOVAL_BACKUP.split('/'), stamp, ...file.replace(/^agent-control\/backups\//, 'agent-control/').replace(/^backups\//, '').split('/'));
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.renameSync(path.join(this.#root, ...file.split('/')), to);
    }
    return { result: 'saved' };
  }
  // Deletes Toolkit's own older backup files, unchanged since the plan read; the last removal's backup
  // goes only when this removal saved one of its own, and the owner's backups never. Empty folders go
  // after.
  #clearBackups(fresh) {
    let count = 0;
    const now = this.#backups();
    for (const [file, mark] of this.#before) {
      if (!file.startsWith('backups/') || !this.#older(file, fresh) || now.get(file) !== mark) continue;
      fs.rmSync(path.join(this.#root, ...file.split('/')), { force: true });
      count += 1;
    }
    const prune = dir => {
      let stat;
      try { stat = fs.lstatSync(dir); } catch { return; }
      if (!stat.isDirectory()) return;
      for (const name of fs.readdirSync(dir)) prune(path.join(dir, name));
      if (!fs.readdirSync(dir).length) fs.rmdirSync(dir);
    };
    prune(path.join(this.#root, 'backups'));
    return { result: 'removed', reason: `${count} older backup ${count === 1 ? 'file' : 'files'}` };
  }
}

// The parts in the order apply runs them: the reinstall note first, then settings, then files, then
// the Toolkit folder, and after it the MCP servers that lose their key helper with it (a report only).
function defaultParts({ environment = process.env, home = os.homedir() } = {}) {
  const folder = new ToolkitFolderPart({ home, environment });
  return [new ReinstallNotePart({ environment, home }), new ClaudeAccountCopyPart({ environment, home }), new ClaudeDepthPart({ environment, home }), new ClaudeUserSettingsPart({ environment, home }),
    new CodexHelperLimitPart({ environment, home }), new CodexHookStatePart({ environment, home }), new CodexSetupJournalPart({ environment, home }), new HelperAgentFilesPart({ environment, home }),
    new SkillCopiesPart({ environment, home }), new UpdateReportsPart({ environment, home }), folder, new McpKeyHelpersPart({ environment, home, folder })];
}

module.exports = { ReinstallNotePart, ClaudeAccountCopyPart, CodexHookStatePart, CodexSetupJournalPart, UpdateReportsPart, McpKeyHelpersPart, withoutHookStates, ClaudeDepthPart, ClaudeUserSettingsPart, CodexHelperLimitPart, HelperAgentFilesPart, SkillCopiesPart, ToolkitFolderPart, FOLDER_ENTRIES, KEPT_ENTRIES, BACKUP_TREES, REMOVAL_BACKUP, FOLD_AT, PLUGIN_ID, MARKETPLACE, PLUGIN_STEPS, defaultParts, pluginState };
