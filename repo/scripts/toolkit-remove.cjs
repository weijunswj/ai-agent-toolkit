#!/usr/bin/env node
'use strict';

// Remove Toolkit from this computer: its old scheduled tasks and task records, its global rules, the
// app settings it set, its helper agent files and skill copies (the n8n skills it copied included), its
// Codex setup record and update reports, and its own folder, keeping only the key list, the recovery
// records and this removal's backup there.
//
// The plan prints the owner's screen (Removed, Kept, Never touched; long lists folded, --full unfolds
// them) and, after the AGENT_LINE, the agent's own steps: the plugin uninstall lines and the apply line
// with the plan code. Every line is one this removal found and that is true for it.
//
// Earlier releases put scheduled tasks into Windows Task Scheduler for every repository they served;
// Toolkit no longer does, and removing the plugin does not remove them. This command finds every task that carries Toolkit's
// marker in any Task Scheduler folder (not only the folders this computer has on record), lists what
// it would remove, and removes exactly that list after the owner's OK.
//
//   plan    read-only. Prints the list and a plan code that stands for exactly that list.
//   apply   needs --confirm <plan code> from the plan the owner was shown. A list that changed since
//           then gives a different code, and nothing is removed.
//
// It never touches a repository, the env store or any key, or anything the owner made. App settings
// change only where Toolkit recorded its own value: Codex's project_doc_max_bytes line and helper
// limit block in config.toml, and Claude Code's subagent limit in settings.json (backups first). Claude
// Code's own settings that setup turned on (attribution, session messages, model switching, reading
// AGENTS.md) stay as they are, and so does every plugin Toolkit did not install. The other parts are in toolkit-remove-parts.cjs. The managed checkout and the rest of Toolkit's folder go
// last, and only once no Toolkit plugin is installed; the plan lists the plugin uninstall lines, which
// the agent runs after the owner's OK. A task the owner changed by hand is kept unless it is named with
// --include; a changed task with no marker, and a task of the owner's own that Toolkit only lists
// (adopted), are always kept.
//
// --app is required: the agent first asks the owner whether to remove Toolkit from only the app it
// runs in or from every app, and never picks for them. With one app, that app's plugin, global rules, settings, helper files and skill copies go. What every app
// shares (old scheduled tasks and their files, Antigravity's rules and skill copies, the update reports
// and the Toolkit folder) goes only once no other app still has the Toolkit plugin; the plan names the
// shared parts found on the computer, whether they go or stay. --app all removes Toolkit from every app.
// The Claude desktop app's Toolkit copy from the claude.ai account is listed with the owner's own
// removal steps and never changed.
//
// Usage: node repo/scripts/toolkit-remove.cjs plan --app codex|claude-code|all [--include <task id>[,<task id>...]] [--full] [--json]
//        node repo/scripts/toolkit-remove.cjs apply --confirm <plan code> --app ... [--include ...] [--json]

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tasks = require('./toolkit-tasks.cjs');
const windows = require('./toolkit-windows-tasks.cjs');
const parts = require('./toolkit-remove-parts.cjs');
const { HOST_LABELS } = require('./agent-host-markers.cjs');

const SCHEMA = 'toolkit.remove-plan.v1';
const USAGE = 'Usage: node repo/scripts/toolkit-remove.cjs plan --app codex|claude-code|all [--include <task id>,...] [--full] [--json]\n'
  + '       node repo/scripts/toolkit-remove.cjs apply --confirm <plan code> --app codex|claude-code|all [--include <task id>,...] [--json]';
const NEEDS_APP = 'remove needs --app: ask the owner first whether to remove Toolkit from only this app (--app codex or --app claude-code) or from every app (--app all). Nothing was planned or removed.';
const APPS = Object.freeze(['codex', 'claude-code', 'all']);
// The global rules file each app reads; Antigravity's is shared.
const RULE_HARNESS = Object.freeze({ codex: 'codex', 'claude-code': 'claude-code' });
// What each kind of task is called in the list, and whether it goes without being named.
const KINDS = Object.freeze({
  toolkit: Object.freeze({ label: "Toolkit's own", removes: true }),
  unrecorded: Object.freeze({ label: "Toolkit's own (carries the marker; its record is missing)", removes: true }),
  disabled: Object.freeze({ label: "Toolkit's own (disabled after Toolkit went missing)", removes: true }),
  changed: Object.freeze({ label: 'changed by you since Toolkit made it', removes: false }),
  adopted: Object.freeze({ label: 'yours (only listed by Toolkit)', removes: false }),
});
const RULE_STATES_WITH_BLOCK = Object.freeze(['current', 'stale', 'tampered']);
const RULE_STATES_HELD = Object.freeze(['broken', 'not-utf8']);
// The Codex settings actions that write config.toml.
const CODEX_WRITES = Object.freeze(['restore', 'delete-file']);

class RemovalError extends Error {
  constructor(message, exitCode = 1) { super(message); this.name = 'RemovalError'; this.exitCode = exitCode; }
}

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])]));
  return value;
}
const sha = value => crypto.createHash('sha256').update(JSON.stringify(ordered(value))).digest('hex');
const sameName = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

// Owns the read of what Toolkit left on this computer and the removal of exactly that. Every
// effect goes through an injected boundary: the scheduler, the task registry and the global rules.
class ToolkitRemoval {
  #home; #scheduler; #registry; #rules; #include; #parts; #plugins; #app;
  // scheduler: the Windows scheduler interface, or null where there is no Task Scheduler.
  // rules: (harnesses) => a GlobalRules-shaped object with check() and remove() for those harnesses
  //   (null for every harness setup manages), or null to leave rules out.
  // parts: the other removal parts (toolkit-remove-parts.cjs), in the order apply runs them.
  // plugins: () => { 'claude-code': bool, codex: bool }, whether the Toolkit plugin is installed.
  // app: 'codex' or 'claude-code' removes Toolkit from that app; 'all' from every app.
  constructor({ home = os.homedir(), scheduler = null, registry = tasks, rules = null, include = [], parts: extra = [], plugins = () => ({}), app = 'all' } = {}) {
    if (!APPS.includes(app)) throw new RemovalError(`--app takes ${APPS.join(', ')}; ${JSON.stringify(app)} is not one`);
    this.#app = app;
    for (const id of include) if (!tasks.ID.test(String(id))) throw new RemovalError(`--include takes task ids from the plan; ${JSON.stringify(id)} is not one`);
    this.#home = home; this.#scheduler = scheduler; this.#registry = registry; this.#rules = rules; this.#include = [...new Set(include)].sort();
    this.#parts = extra; this.#plugins = plugins;
  }

  // Read-only. The list of what would go and what stays, with the code that stands for it.
  plan() { return this.#read().plan; }

  // Whether the plugin is installed in each app, read once per plan or apply.
  #installed() {
    try { return this.#plugins() || {}; } catch { return {}; }
  }

  // The apps other than the one being removed that still have the Toolkit plugin: while there is one,
  // what every app shares stays.
  #othersKeeping(installed) {
    if (this.#app === 'all') return [];
    return Object.keys(parts.PLUGIN_STEPS).filter(host => host !== this.#app && installed[host] === true);
  }

  // Whether an item of `app` is in this removal.
  #inScope(app, sharedGoes) {
    if (this.#app === 'all' || app === 'any' || app === this.#app) return true;
    return app === 'shared' && sharedGoes;
  }

  #read() {
    const installedBefore = this.#installed();
    const othersKeeping = this.#othersKeeping(installedBefore);
    const sharedGoes = othersKeeping.length === 0;
    const registry = this.#registry.readRegistry(this.#home);
    if (registry.status !== 'ok') throw new RemovalError(`The task record ${this.#registry.registryPath(this.#home)} could not be read (${registry.reason}), so nothing is planned. Repair it or move it aside, then run plan again.`);
    const recorded = registry.tasks.filter(entry => entry.host === 'windows');
    const found = [];
    // Scheduled tasks serve every app, so they wait while another app keeps Toolkit.
    const scheduler = sharedGoes ? this.#scheduler : null;
    if (scheduler) {
      const folders = [...new Set([...recorded.map(entry => entry.folder), ...scheduler.markedFolders()])].sort();
      for (const folder of folders) {
        const live = scheduler.list(folder);
        for (const task of live) {
          const item = this.#classify(folder, task, recorded);
          if (item) found.push({ ...item, tasks_in_folder: live.length });
        }
      }
    }
    for (const id of this.#include) {
      const item = found.find(task => task.id === id);
      if (!item) throw new RemovalError(`--include names ${id}, which is not a task in the plan. Run plan without --include to see the ids.`);
      if (item.kind === 'adopted') throw new RemovalError(`${id} is your own task, which Toolkit only lists. Toolkit never removes it; delete it in Task Scheduler if you want it gone.`);
      if (item.unmarked) throw new RemovalError(`${id} no longer carries Toolkit's marker and is not the copy Toolkit recorded, so Toolkit cannot tell it is still its own and never removes it. Delete it in Task Scheduler if you want it gone.`);
    }
    const listed = found.map(({ live, ...item }) => ({ ...item, action: KINDS[item.kind].removes || this.#include.includes(item.id) ? 'remove' : 'keep', definition: sha(windows.enrolledDefinition(live)) }));
    const going = listed.filter(item => item.action === 'remove');
    const liveIds = new Set(listed.map(item => item.record).filter(Boolean));
    // A record with no task behind it: Toolkit's own record of a task that is already gone.
    const stale = scheduler ? recorded.filter(entry => !entry.adopted && !liveIds.has(entry.id)).map(entry => entry.id).sort() : [];
    const folders = [...new Set(going.map(item => item.folder))].sort().map(folder => ({ folder,
      expected: going.filter(item => item.folder === folder).length === listed.find(item => item.folder === folder).tasks_in_folder ? 'removed' : 'kept' }));
    const records = [...new Set([...going.map(item => item.record).filter(Boolean), ...stale])].sort();
    // The shared runner and the standing task approval go only when no marked task is kept.
    const shared = Boolean(scheduler) && !listed.some(item => item.action === 'keep' && item.kind === 'changed');
    const state = this.#statePaths(records, shared);
    const owner = this.#rulesOwner(sharedGoes);
    const rules = owner ? owner.check().files.map(file => ({ harness: file.harness, file: file.display || file.file, state: file.state,
      action: RULE_STATES_WITH_BLOCK.includes(file.state) ? 'remove' : RULE_STATES_HELD.includes(file.state) ? 'held' : 'none', ...(file.detail ? { detail: file.detail } : {}) })) : [];
    // Codex's config.toml: Toolkit's raised project_doc_max_bytes line, when there is one. It is in
    // the plan code, so a line that appears or changes after the plan removes nothing.
    const limit = owner && typeof owner.docLimitOnRemove === 'function' ? owner.docLimitOnRemove() : null;
    const codexSettings = limit && limit.action !== 'none' ? { file: limit.file, action: limit.action,
      ...(limit.previous !== undefined ? { previous: limit.previous } : {}), ...(limit.detail ? { detail: limit.detail } : {}) } : null;
    const tasksOut = listed.map(({ tasks_in_folder: ignored, ...item }) => item);
    // The shared parts found on this computer, named in the scope line whether they go or stay.
    const sharedFound = [];
    const oldTasks = sharedGoes ? (going.length || stale.length || state.length ? 'yes' : 'no') : this.#oldTasksKept(recorded);
    if (oldTasks !== 'no') sharedFound.push(oldTasks === 'yes' ? 'old scheduled tasks from an earlier Toolkit with their files' : 'any old scheduled tasks from an earlier Toolkit (Task Scheduler could not be read)');
    if (sharedGoes ? rules.some(file => file.harness === 'antigravity' && file.action === 'remove') : this.#antigravityRulesKept()) sharedFound.push("Antigravity's global rules");
    // A part that cannot be read is held, so the rest of the plan still shows.
    // Only the items of the app being removed, and the shared ones once no other app keeps Toolkit.
    // Each part learns whether an earlier step saves a backup: the Toolkit folder keeps the last
    // removal's backup only when this removal saves none of its own.
    let savesBackup = rules.some(file => file.action === 'remove') || CODEX_WRITES.includes(codexSettings?.action);
    const others = this.#parts.map(part => {
      let items;
      try { items = part.plan({ savesBackup }); } catch (error) { items = [{ what: part.title, action: 'held', detail: `could not be read (${tasks.safeText(error.message)})`, app: part.app }]; }
      const scoped = items.map(item => ({ item, app: item.app || part.app || 'shared' }));
      if (scoped.some(({ item, app }) => app === 'shared' && item.action === 'remove')) sharedFound.push(part.shared || part.title);
      items = scoped.filter(({ app }) => this.#inScope(app, sharedGoes)).map(({ item: { app: ignored, ...item } }) => item);
      if (items.some(item => item.action === 'save' || (item.action === 'remove' && item.backup === true))) savesBackup = true;
      const removing = items.filter(item => item.action === 'remove');
      return { key: part.key, title: part.title, label: part.label || part.title, ...(part.unit ? { unit: part.unit } : {}), items,
        ...(typeof part.summary === 'function' && removing.length ? { summary: part.summary(removing) } : {}) };
    });
    const body = { app: this.#app, tasks: tasksOut, stale_records: stale, folders, state: state.map(item => item.display), rules, codex_settings: codexSettings, parts: others, include: this.#include,
      kept_for: othersKeeping, shared_parts: sharedFound };
    // Not in the plan code: the agent uninstalls the plugins between the plan and apply.
    const plugins = Object.keys(parts.PLUGIN_STEPS).filter(host => installedBefore[host] === true && (this.#app === 'all' || host === this.#app));
    const nothing = !going.length && !stale.length && !state.length && !rules.some(file => file.action === 'remove') && !CODEX_WRITES.includes(codexSettings?.action)
      && !others.some(part => part.items.some(item => item.action === 'remove'));
    const schedulerState = !this.#scheduler ? 'not available on this system' : scheduler ? 'read' : 'kept for another app';
    return { shared, plan: { schema: SCHEMA, ...body, plugins, scheduler: schedulerState, nothing, code: sha(body) } };
  }

  // While another app keeps Toolkit the scheduler is not read for the list, so whether old scheduled
  // tasks are there comes from the task records, then a read-only look for marked folders.
  #oldTasksKept(recorded) {
    if (recorded.some(entry => !entry.adopted)) return 'yes';
    if (!this.#scheduler) return 'no';
    try { return this.#scheduler.markedFolders().length ? 'yes' : 'no'; } catch { return 'unknown'; }
  }

  // Whether Antigravity's global rules file holds the Toolkit block while another app keeps it there.
  #antigravityRulesKept() {
    if (!this.#rules || this.#app === 'all') return false;
    return this.#rules(['antigravity']).check().files.some(file => file.harness === 'antigravity' && RULE_STATES_WITH_BLOCK.includes(file.state));
  }

  // The global rules owner for this removal: the app's own file, and Antigravity's once shared items go.
  #rulesOwner(sharedGoes) {
    if (!this.#rules) return null;
    if (this.#app === 'all') return this.#rules(null);
    return this.#rules([RULE_HARNESS[this.#app], ...(sharedGoes ? ['antigravity'] : [])]);
  }

  // One live task as the list shows it, or null for a task that is not Toolkit's and not listed by it.
  #classify(folder, live, recorded) {
    const marker = windows.parseMarker(live.description);
    const base = { folder, name: live.name, live };
    if (marker) {
      const entry = recorded.find(item => item.id === marker.id && item.folder === folder && !item.adopted) || null;
      const item = { ...base, id: marker.id, record: entry?.id || null, repository: entry?.repository || null };
      // A copy of a recorded task in another folder was moved or copied by hand: it is kept unless named.
      if (!entry) return { ...item, kind: recorded.some(other => other.id === marker.id && !other.adopted) ? 'changed' : 'unrecorded' };
      const changed = entry.enrolled && JSON.stringify(ordered(windows.enrolledDefinition(live))) !== JSON.stringify(ordered(entry.enrolled));
      return { ...item, kind: changed ? 'changed' : 'toolkit' };
    }
    const entry = recorded.find(item => item.folder === folder && sameName(item.name, live.name));
    if (!entry) return null;
    const item = { ...base, id: entry.id, record: entry.id, repository: entry.repository || null };
    if (entry.adopted) return { ...item, kind: 'adopted' };
    // An old launcher rewrote this task's description when it disabled it, so the marker is gone. It is
    // still Toolkit's own only while it is byte for byte the snapshot that launcher recorded.
    const snapshot = entry.toolkit_missing === true && live.description === windows.DISABLED_DESCRIPTION && entry.enrolled?.definition_xml;
    // Otherwise its record names a task that is still there but no longer Toolkit's: it is listed as
    // kept, so its record and the shared runner it may still use stay too.
    // With no marker and no matching snapshot, Toolkit cannot prove the task is its own, so --include
    // cannot name it either.
    return snapshot && live.definition_xml === snapshot ? { ...item, kind: 'disabled' } : { ...item, kind: 'changed', unmarked: true };
  }

  // Toolkit's own task files under the user-state folder that go with the removed records.
  #statePaths(records, shared) {
    const root = tasks.userStateDir(this.#home);
    const display = file => `~/${path.relative(this.#home, file).split(path.sep).join('/')}`;
    const paths = records.map(id => path.join(root, 'tasks', id));
    if (shared) paths.push(windows.runnersDir(this.#home), path.join(root, 'scheduled-task-approval.json'));
    return paths.filter(file => fs.existsSync(file)).map(file => ({ file, display: display(file) }));
  }

  // Removes exactly the confirmed list. A list that no longer matches the code removes nothing.
  apply(confirm) {
    const { plan, shared } = this.#read();
    const sharedGoes = plan.kept_for.length === 0;
    if (typeof confirm !== 'string' || confirm !== plan.code) throw new RemovalError('The list is not the one that was confirmed (it changed, or no plan code was given), so nothing was removed. Run plan again and show the owner the new list.');
    const results = [];
    for (const item of plan.tasks.filter(task => task.action === 'remove')) {
      try {
        const live = this.#scheduler.list(item.folder).find(task => task.name === item.name);
        if (!live || sha(windows.enrolledDefinition(live)) !== item.definition) throw new Error('the task changed after the plan was read');
        const removed = item.kind === 'disabled' ? this.#scheduler.unregisterDisabled(item.folder, item.name, live) : this.#scheduler.unregister(item.folder, item.name, item.id, live);
        if (removed?.removed !== true) throw new Error('removal was not acknowledged');
        if (this.#scheduler.list(item.folder).some(task => sameName(task.name, item.name))) throw new Error('the task is still there after removal');
        results.push({ ...item, result: 'removed' });
      } catch (error) { results.push({ ...item, result: 'failed', reason: tasks.safeText(error.message) }); }
    }
    const failed = results.some(item => item.result === 'failed');
    const drop = new Set([...results.filter(item => item.result === 'removed').map(item => item.record).filter(Boolean), ...plan.stale_records]);
    const steps = [];
    const step = (name, run) => { try { steps.push({ step: name, result: run() }); } catch (error) { steps.push({ step: name, result: 'failed', reason: tasks.safeText(error.message) }); } };
    if (drop.size) step('task records', () => { this.#registry.updateRegistry(this.#home, list => list.filter(entry => !(entry.host === 'windows' && !entry.adopted && drop.has(entry.id)))); return `${drop.size} cleared`; });
    const folders = [];
    for (const { folder } of plan.folders) {
      if (results.some(item => item.folder === folder && item.result === 'failed')) { folders.push({ folder, result: 'kept' }); continue; }
      try { folders.push({ folder, result: this.#scheduler.removeFolderIfEmpty(folder)?.folder || 'kept' }); }
      catch (error) { folders.push({ folder, result: 'failed', reason: tasks.safeText(error.message) }); }
    }
    const root = tasks.userStateDir(this.#home);
    // A task that could not be removed still needs the shared runner.
    for (const { file, display } of this.#statePaths([...drop], shared && !failed)) step(display, () => {
      // Only Toolkit's own task files, and only inside its user-state folder.
      const relative = path.relative(root, fs.realpathSync(file));
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('outside the Toolkit user-state folder; left alone');
      fs.rmSync(file, { recursive: true, force: true });
      return 'removed';
    });
    let rules = [];
    let codex = null;
    // The rules remover also puts Codex's limit back, so it runs when either is in the plan.
    if (this.#rules && (plan.rules.some(file => file.action === 'remove') || CODEX_WRITES.includes(plan.codex_settings?.action))) {
      try {
        const removed = this.#rulesOwner(sharedGoes).remove();
        rules = removed.files.map(file => ({ harness: file.harness, file: file.display || file.file, result: file.action, ...(file.backup ? { backup: 'saved' } : {}) }));
        const limit = removed.doc_limit;
        // A held line the plan already showed as left alone is the planned outcome, printed once below.
        const plannedHold = limit?.action === 'held' && plan.codex_settings?.action === 'held';
        if (limit && !plannedHold && !['reported', 'unchanged'].includes(limit.action)) {
          codex = { file: limit.display || plan.codex_settings?.file || null, result: limit.action === 'held' ? 'failed' : limit.action,
            ...(limit.action === 'held' ? { reason: tasks.safeText(limit.detail || 'left alone') } : {}), ...(limit.backup ? { backup: 'saved' } : {}),
            ...(limit.load_check?.status ? { load_check: limit.load_check.status } : {}) };
        }
      } catch (error) { rules = [{ result: 'failed', reason: tasks.safeText(error.message) }]; }
    }
    // The other parts, in order; the Toolkit folder checks the plugins itself, and only the MCP report
    // runs after it. Each result carries the label its planned item had.
    const others = this.#parts.map(part => {
      const planned = plan.parts.find(item => item.key === part.key) || { items: [] };
      let done;
      try { done = part.apply(planned.items); } catch (error) { done = [{ what: part.title, result: 'failed', reason: tasks.safeText(error.message) }]; }
      const labelled = done.map(item => ({ label: planned.items.find(entry => entry.what === item.what)?.label || planned.label || part.title, ...item }));
      return { key: part.key, title: part.title, label: planned.label || part.title, ...(planned.unit ? { unit: planned.unit } : {}), results: labelled,
        held: planned.items.filter(item => !['remove', 'save'].includes(item.action) && !done.some(entry => entry.what === item.what)) };
    });
    const installed = this.#installed();
    const plugins = Object.keys(parts.PLUGIN_STEPS).filter(host => installed[host] === true && (this.#app === 'all' || host === this.#app));
    const ok = !results.some(item => item.result === 'failed') && !steps.some(item => item.result === 'failed') && !folders.some(item => item.result === 'failed') && !rules.some(item => item.result === 'failed') && codex?.result !== 'failed'
      && !others.some(part => part.results.some(item => item.result === 'failed'));
    return { schema: 'toolkit.remove-result.v1', ok, app: plan.app, kept_for: plan.kept_for, shared_parts: plan.shared_parts, tasks: results, kept: plan.tasks.filter(task => task.action === 'keep'), folders, steps, rules, codex_settings: codex,
      held_rules: plan.rules.filter(file => file.action === 'held'), held_codex_settings: plan.codex_settings?.action === 'held' ? plan.codex_settings : null, parts: others, plugins,
      folder_kept: others.some(part => part.key === 'toolkit_folder' && part.results.some(item => item.result === 'kept')) };
  }
}

// What removal never touches. Always true, whatever the removal finds.
const NEVER_TOUCHED = '- Your repositories, your keys (in the credential store), other plugins, and every setting, agent, skill and file you made yourself.';
// The line that starts what only the agent reads. The skill says to show the owner everything above it.
const AGENT_LINE = "Agent steps (not for the owner's screen):";
const FOLD_AT = parts.FOLD_AT;

const listOf = names => names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
const bullet = (label, text) => `- **${label}:** ${text}`;
const parentOf = what => { const at = String(what).lastIndexOf('/'); return at > 0 ? String(what).slice(0, at) : null; };
const appsOf = hosts => listOf(hosts.map(host => parts.PLUGIN_STEPS[host]?.app || HOST_LABELS[host] || host));

// One group's lines for a list of [{ what, detail?, text?, label? }] under a label: each `text` item on
// its own line; the rest folded into counts per folder when longer than FOLD_AT (unless full, or
// noted with `onRequest` false for a result), else one line when they share a detail.
// `brief` shows an item's `short` line in place of its `text`: every screen after the first plan.
function groupLines(label, items, { unit = 'items', full = false, separator = ' (', onRequest = true, fold, brief = false } = {}) {
  const out = [];
  const byLabel = new Map();
  for (const item of items) { const name = item.label || label; (byLabel.get(name) || byLabel.set(name, []).get(name)).push(item); }
  let folded = false;
  for (const [name, list] of byLabel) {
    for (const item of list.filter(entry => entry.text)) out.push(bullet(name, brief && item.short ? item.short : item.text));
    const plain = list.filter(entry => !entry.text);
    if (!plain.length) continue;
    const said = item => `${item.what}${item.detail ? (separator === ' (' ? ` (${item.detail})` : `${separator}${item.detail}`) : ''}`;
    if (fold && name === label && !full) { out.push(bullet(name, fold)); folded = folded || plain.length > FOLD_AT; continue; }
    if (plain.length > FOLD_AT && !full) {
      folded = true;
      for (const parent of [...new Set(plain.map(item => parentOf(item.what)))]) {
        const count = plain.filter(item => parentOf(item.what) === parent).length;
        out.push(bullet(name, `${count} ${unit}${parent ? ` in ${parent}` : ''}${onRequest ? ' (full list on request)' : ''}`));
      }
      continue;
    }
    if (plain.length > FOLD_AT) { out.push(`- **${name}:**`, ...plain.map(item => `  - ${said(item)}`)); continue; }
    const details = [...new Set(plain.map(item => item.detail || ''))];
    if (details.length === 1) out.push(bullet(name, said({ what: listOf(plain.map(item => item.what)), detail: details[0] })));
    else for (const item of plain) out.push(bullet(name, said(item)));
  }
  return { lines: out, folded };
}

function taskWhere(item) {
  return `\\${item.folder}\\${item.name}${item.repository ? ` (${item.repository})` : ''}`;
}

// Who the removal is for. The shared parts kept for another app are a Kept line.
function fromLine(app, keptFor = [], shared = []) {
  if (app === 'all') return '**From:** every app on this computer.';
  const alone = !keptFor.length && shared.length ? '; no other app has the Toolkit plugin, so the shared parts below go too' : '';
  return `**From:** ${HOST_LABELS[app]} only${alone}.`;
}

function sharedKeptLine(app, keptFor = [], shared = []) {
  if (app === 'all' || !keptFor.length || !shared.length) return [];
  return [bullet('Shared parts', `${listOf(shared)} ${shared.length === 1 ? 'stays' : 'stay'}, because ${appsOf(keptFor)} still ${keptFor.length === 1 ? 'has' : 'have'} the Toolkit plugin`)];
}

// What the plan says about Codex's config.toml.
function codexPlanText(codex) {
  if (codex.action === 'held') return `${codex.file}: left alone, ${codex.detail || 'its Toolkit lines are damaged'}; fix or remove the Toolkit lines by hand`;
  if (codex.action === 'delete-file') return `${codex.file}, which Toolkit created for its project_doc_max_bytes line alone`;
  return `project_doc_max_bytes in ${codex.file} goes back to ${codex.previous === 'none' ? "Codex's own default (Toolkit added the line)" : codex.previous}`;
}

// The owner's screen for a plan: Removed, Kept and Never touched, then the agent's own steps.
function describePlan(plan, { full = false } = {}) {
  const removed = [], kept = [];
  let folded = false;
  const add = (target, result) => { target.push(...result.lines); folded = folded || result.folded; };
  if (plan.plugins?.length) removed.push(bullet('Plugin', `AI Agent Toolkit in ${appsOf(plan.plugins)}, uninstalled after your yes`));
  const going = plan.tasks.filter(item => item.action === 'remove');
  const extras = plan.state.length || plan.folders.some(item => item.expected === 'removed') ? '; their task files and empty Task Scheduler folders go too' : '';
  if (going.length) {
    if (going.length > FOLD_AT && !full) { folded = true; removed.push(bullet('Old scheduled tasks', `${going.length} from an earlier Toolkit (full list on request)${extras}`)); }
    else removed.push(bullet('Old scheduled tasks', `${listOf(going.map(taskWhere))}, from an earlier Toolkit${extras}`));
  } else if (plan.stale_records.length || plan.state.length) removed.push(bullet('Old task records', "Toolkit's records and files of old scheduled tasks that are already gone"));
  const rules = plan.rules.filter(file => file.action === 'remove');
  if (rules.length) removed.push(bullet('Global rules', `the Toolkit block in ${listOf(rules.map(file => file.file))} (the rest of ${rules.length === 1 ? 'the file' : 'each file'} stays)`));
  const codex = plan.codex_settings;
  if (codex && codex.action !== 'held') removed.push(bullet('Codex instruction limit', codexPlanText(codex)));
  for (const part of plan.parts || []) {
    add(removed, groupLines(part.label || part.title, part.items.filter(item => item.action === 'remove'), { unit: part.unit, full, fold: part.summary }));
  }
  for (const item of plan.tasks.filter(task => task.action === 'keep')) {
    const hint = item.kind === 'changed' && !item.unmarked ? `say to remove ${item.id} too if you want it gone` : 'delete it in Task Scheduler yourself if you want it gone';
    kept.push(bullet('Scheduled task', `${taskWhere(item)}: ${KINDS[item.kind].label}; ${hint}`));
  }
  for (const item of plan.folders.filter(entry => entry.expected === 'kept')) kept.push(bullet('Task Scheduler folder', `\\${item.folder}\\ stays, it still holds another task`));
  for (const file of plan.rules.filter(entry => entry.action === 'held')) kept.push(bullet('Global rules', `${file.file}: left alone, ${file.detail || file.state}; fix or remove the Toolkit lines by hand`));
  if (codex?.action === 'held') kept.push(bullet('Codex instruction limit', codexPlanText(codex)));
  for (const part of plan.parts || []) {
    const label = part.label || part.title;
    add(kept, groupLines(label, part.items.filter(item => item.action === 'save' || item.action === 'keep'), { unit: part.unit, full, separator: ': ', brief: full }));
    for (const item of part.items.filter(entry => entry.action === 'held')) kept.push(bullet(item.label || label, `${item.what}: left alone, ${item.detail || 'it could not be read'}`));
  }
  kept.push(...sharedKeptLine(plan.app, plan.kept_for, plan.shared_parts));
  const lines = ['**Remove Toolkit from this computer**', '', fromLine(plan.app, plan.kept_for, plan.shared_parts), ''];
  if (plan.nothing) lines.push("Nothing of Toolkit's is left to remove.", '');
  if (removed.length) lines.push('**Removed**', ...removed, '');
  if (kept.length) lines.push('**Kept**', ...kept, '');
  lines.push('**Never touched**', NEVER_TOUCHED);
  if (!plan.nothing) lines.push('', 'Nothing changes until you say yes.');
  lines.push('', AGENT_LINE, ...agentPlanSteps(plan, { folded }));
  return lines;
}

// The plugin uninstall lines for each app that still has the Toolkit plugin, and the app screen to
// give the owner when that app's command line is not available.
function uninstallSteps(hosts) {
  return hosts.map(host => {
    const step = parts.PLUGIN_STEPS[host];
    return `- Uninstall the ${step.app} plugin: ${step.lines.map(line => `\`${line}\``).join(', then ')}. Without its command line, ask the owner to ${step.ui}.`;
  });
}

function agentPlanSteps(plan, { folded }) {
  const app = `--app ${plan.app}${plan.include.length ? ` --include ${plan.include.join(',')}` : ''}`;
  const steps = [];
  if (plan.plugins?.length) steps.push("- After the owner's yes, first:", ...uninstallSteps(plan.plugins).map(line => `  ${line}`));
  if (!plan.nothing) steps.push(`- Then run apply ${app} --confirm ${plan.code}. A list that changed gets a new code and removes nothing: run plan again and ask again.`);
  if (folded) steps.push(`- The full lists, when the owner asks: run plan ${app} --full.`);
  if (!steps.length) steps.push('- None.');
  return steps;
}

// The rules remover's result codes, in plain words.
const RESULT_WORDS = Object.freeze({ removed: 'removed', 'deleted-file': 'put back; the file Toolkit created for it is deleted', 'restored-previous': 'put back to the earlier value',
  absent: 'nothing to remove', held: 'left alone', failed: 'failed', unchanged: 'unchanged', skipped: 'left alone', 'opted-out': 'already removed by you' });
const words = code => RESULT_WORDS[code] || String(code).replace(/-/g, ' ');

// The closing lines after apply, in the same groups, then what is left to do.
function describeResult(result) {
  const removed = [], kept = [], failed = [], next = [];
  const fail = (label, what, reason) => failed.push(bullet(label, `${what}${reason ? ` (${reason})` : ''}`));
  const tasksDone = result.tasks.filter(item => item.result === 'removed');
  if (tasksDone.length) removed.push(bullet('Old scheduled tasks', tasksDone.length > FOLD_AT ? `${tasksDone.length} from an earlier Toolkit` : listOf(tasksDone.map(taskWhere))));
  for (const item of result.tasks.filter(task => task.result === 'failed')) fail('Scheduled task', taskWhere(item), item.reason);
  for (const item of result.kept) kept.push(bullet('Scheduled task', `${taskWhere(item)}: ${KINDS[item.kind].label}`));
  const foldersGone = result.folders.filter(item => item.result === 'removed');
  if (foldersGone.length) removed.push(bullet('Task Scheduler folders', listOf(foldersGone.map(item => `\\${item.folder}\\`))));
  for (const item of result.folders.filter(entry => entry.result === 'failed')) fail('Task Scheduler folder', `\\${item.folder}\\`, item.reason);
  for (const item of result.folders.filter(entry => entry.result === 'kept')) kept.push(bullet('Task Scheduler folder', `\\${item.folder}\\, it still holds a task`));
  const stepsDone = result.steps.filter(item => item.result !== 'failed');
  if (stepsDone.length) removed.push(bullet('Old task records', `Toolkit's records and files of the removed tasks (${stepsDone.length} ${stepsDone.length === 1 ? 'item' : 'items'})`));
  for (const item of result.steps.filter(entry => entry.result === 'failed')) fail('Old task records', item.step, item.reason);
  const rulesGone = result.rules.filter(item => item.result === 'removed');
  if (rulesGone.length) removed.push(bullet('Global rules', `the Toolkit block in ${listOf(rulesGone.map(item => item.file))}`));
  for (const item of result.rules.filter(entry => !['removed', 'absent', 'failed'].includes(entry.result))) kept.push(bullet('Global rules', `${item.file || 'the rules files'}: ${words(item.result)}`));
  for (const item of result.rules.filter(entry => entry.result === 'failed')) fail('Global rules', item.file || 'the rules files', item.reason);
  for (const item of result.held_rules) kept.push(bullet('Global rules', `${item.file}: left alone, ${item.detail || item.state}`));
  const codex = result.codex_settings;
  if (codex) (codex.result === 'failed' ? failed : removed).push(bullet('Codex instruction limit', `${codex.file || "Codex's config.toml"}: ${words(codex.result)}${codex.reason ? ` (${codex.reason})` : ''}${codex.load_check ? `; Codex load check: ${codex.load_check}` : ''}`));
  if (result.held_codex_settings) kept.push(bullet('Codex instruction limit', `${result.held_codex_settings.file}: left alone, ${result.held_codex_settings.detail || 'its Toolkit lines are damaged'}`));
  const reconnect = [];
  for (const part of result.parts || []) {
    const label = part.label || part.title;
    const done = part.results.filter(item => item.result === 'removed');
    removed.push(...groupLines(label, done.map(({ reason, ...item }) => ({ ...item, ...(reason ? { detail: reason } : {}) })), { unit: part.unit, onRequest: false }).lines);
    const saved = part.results.filter(item => item.result === 'saved');
    kept.push(...groupLines(label, saved.map(({ text, ...item }) => item), { separator: ': ' }).lines);
    for (const item of part.results.filter(entry => entry.result === 'kept')) kept.push(bullet(item.label || label, `${item.what}${item.reason ? `: ${item.reason}` : ''}`));
    for (const item of part.results.filter(entry => entry.result === 'failed')) fail(item.label || label, item.what, item.reason);
    reconnect.push(...part.results.filter(entry => entry.reconnect).map(entry => entry.what));
    kept.push(...groupLines(label, part.held.filter(item => item.action !== 'held'), { separator: ': ', brief: true }).lines);
    for (const item of part.held.filter(entry => entry.action === 'held')) kept.push(bullet(item.label || label, `${item.what}: left alone, ${item.detail || 'it could not be read'}`));
  }
  if (reconnect.length) next.push(bullet('Reconnect MCP servers', `${listOf(reconnect)} ${reconnect.length === 1 ? 'keeps its' : 'keep their'} settings and ${reconnect.length === 1 ? 'key' : 'keys'}, but lost the key helper with the Toolkit folder. To use ${reconnect.length === 1 ? 'it' : 'one'} again, give it its key another way (in its own settings or the service's sign-in), or say \`setup toolkit\` and then \`toolkit env\``));
  if (result.plugins?.length) next.push(bullet('Still to do', `the Toolkit plugin is still installed in ${appsOf(result.plugins)}${result.folder_kept ? ', so the Toolkit folder stays' : ''}. Once it is uninstalled, say \`remove toolkit\` again${result.folder_kept ? ' to remove the folder' : ''}`));
  else if (result.folder_kept) next.push(bullet('Still to do', 'the Toolkit folder stays while a Toolkit plugin is installed. Once none is, say `remove toolkit` again to remove the folder'));
  const account = (result.parts || []).some(part => part.key === 'claude_account_copy' && part.held.length);
  if (account) next.push(bullet('The Claude app', 'it still runs Toolkit from your claude.ai account until you remove it there (the step is above)'));
  if (!result.plugins?.length && !result.folder_kept) next.push(bullet('New session', 'start a new session in each app so nothing of Toolkit stays loaded'));
  if (!result.ok) next.push(bullet('Some steps failed', 'nothing else was changed; say `remove toolkit` again to see what is left'));
  // A folder that waits for a plugin is still to remove, so nothing-left is not true then.
  const nothing = !removed.length && !failed.length && !result.folder_kept;
  const title = !result.ok ? '**Toolkit removal: some steps failed**' : result.folder_kept ? '**Toolkit removal: the Toolkit folder stays for now**' : '**Toolkit removal done**';
  const lines = [title, '', fromLine(result.app, result.kept_for, result.shared_parts), ''];
  if (nothing) lines.push("Nothing of Toolkit's was left to remove.", '');
  if (removed.length) lines.push('**Removed**', ...removed, '');
  if (failed.length) lines.push('**Failed**', ...failed, '');
  kept.push(...sharedKeptLine(result.app, result.kept_for, result.shared_parts));
  if (kept.length) lines.push('**Kept**', ...kept, '');
  lines.push('**Never touched**', NEVER_TOUCHED, '', '**Next**', ...next);
  const agent = [];
  if (result.plugins?.length) agent.push(...uninstallSteps(result.plugins));
  // After the plugin goes, the remove toolkit skill may be gone too, so the exact line is given.
  if (result.folder_kept) agent.push(`- Once the plugin is uninstalled and the owner says \`remove toolkit\` again, and the skill is gone, run: node "${path.resolve(__filename)}" plan --app ${result.app || 'all'}`);
  if (agent.length) lines.push('', AGENT_LINE, ...agent);
  return lines;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!['plan', 'apply'].includes(command)) throw new RemovalError(USAGE);
  const args = { command, include: [], confirm: null, json: false, full: false, app: null };
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === '--json') args.json = true;
    else if (rest[i] === '--full' && command === 'plan') args.full = true;
    else if (rest[i] === '--app' && rest[i + 1] && APPS.includes(rest[i + 1]) && !args.app) args.app = rest[++i];
    else if (rest[i] === '--include' && rest[i + 1]) args.include.push(...rest[++i].split(',').filter(Boolean));
    else if (rest[i] === '--confirm' && rest[i + 1] && command === 'apply') args.confirm = rest[++i];
    else throw new RemovalError(USAGE);
  }
  if (command === 'apply' && !/^[a-f0-9]{64}$/.test(args.confirm || '')) throw new RemovalError('apply needs --confirm <plan code> from the plan the owner was shown.');
  if (!args.app) throw new RemovalError(NEEDS_APP);
  return args;
}

// The rules owner for the given harnesses, kept to the ones setup manages; null means all of those.
function defaultRules(environment = process.env) {
  const { GlobalRules } = require('./toolkit-global-rules.cjs');
  return (only = null) => {
    const managed = GlobalRules.setupHarnesses({ environment });
    return new GlobalRules({ environment, harnesses: only ? managed.filter(harness => only.includes(harness)) : managed });
  };
}

function main(argv = process.argv.slice(2), deps = {}) {
  const log = deps.log || console.log;
  try {
    const args = parseArgs(argv);
    const platform = deps.platform || process.platform;
    const home = deps.home || os.homedir();
    const environment = deps.environment || process.env;
    const removal = new ToolkitRemoval({ home, include: args.include, app: args.app,
      scheduler: deps.scheduler !== undefined ? deps.scheduler : platform === 'win32' ? windows.powerShellScheduler() : null,
      rules: deps.rules !== undefined ? deps.rules : defaultRules(environment),
      parts: deps.parts !== undefined ? deps.parts : parts.defaultParts({ environment, home }),
      plugins: deps.plugins !== undefined ? deps.plugins : () => parts.pluginState({ environment, home }) });
    const output = args.command === 'plan' ? removal.plan() : removal.apply(args.confirm);
    for (const line of args.json ? [JSON.stringify(output, null, 2)] : args.command === 'plan' ? describePlan(output, { full: args.full }) : describeResult(output)) log(line);
    return args.command === 'apply' && !output.ok ? 1 : 0;
  } catch (error) {
    // A task module's own error comes from the plan read and can carry a native line (PowerShell's
    // stderr), so it is named inside the plain line, screened.
    const own = error?.name === 'WindowsTasksError' || error?.name === 'TasksError';
    (deps.error || console.error)(error instanceof RemovalError ? error.message
      : `Toolkit removal could not be planned${own ? ` (${tasks.safeText(error.message, 1000)})` : ''}; nothing was removed.`);
    return error?.exitCode || 1;
  }
}

module.exports = { ToolkitRemoval, RemovalError, KINDS, SCHEMA, AGENT_LINE, NEVER_TOUCHED, describePlan, describeResult, parseArgs, main };

if (require.main === module) process.exitCode = main();
