#!/usr/bin/env node
'use strict';

// Remove Toolkit from this computer: its scheduled tasks and task records, its global rules, the app
// settings it set, its helper agent files and skill copies, and its own folder.
//
// `setup toolkit` puts scheduled tasks into Windows Task Scheduler for every repository it serves.
// Removing the plugin does not remove them. This command finds every task that carries Toolkit's
// marker in any Task Scheduler folder (not only the folders this computer has on record), lists what
// it would remove, and removes exactly that list after the owner's OK.
//
//   plan    read-only. Prints the list and a plan code that stands for exactly that list.
//   apply   needs --confirm <plan code> from the plan the owner was shown. A list that changed since
//           then gives a different code, and nothing is removed.
//
// It never touches a repository, the env store or any key, or anything the owner made. App settings
// change only where Toolkit recorded its own value: Codex's project_doc_max_bytes line and helper
// limit block in config.toml, and Claude Code's subagent limit in settings.json (backups first). The
// other parts are in toolkit-remove-parts.cjs. The managed checkout and the rest of Toolkit's folder go
// last, and only once no Toolkit plugin is installed; the plan lists the plugin uninstall lines, which
// the agent runs after the owner's OK. A task the owner changed by hand is kept unless it is named with
// --include; a task of the owner's own that Toolkit only lists (adopted) is always kept.
//
// Usage: node repo/scripts/toolkit-remove.cjs plan [--include <task id>[,<task id>...]] [--json]
//        node repo/scripts/toolkit-remove.cjs apply --confirm <plan code> [--include ...] [--json]

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tasks = require('./toolkit-tasks.cjs');
const windows = require('./toolkit-windows-tasks.cjs');
const { DISABLED_DESCRIPTION } = require('./toolkit-task-launcher.cjs');
const parts = require('./toolkit-remove-parts.cjs');

const SCHEMA = 'toolkit.remove-plan.v1';
const USAGE = 'Usage: node repo/scripts/toolkit-remove.cjs plan [--include <task id>,...] [--json]\n'
  + '       node repo/scripts/toolkit-remove.cjs apply --confirm <plan code> [--include <task id>,...] [--json]';
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
  #home; #scheduler; #registry; #rules; #include; #parts; #plugins;
  // scheduler: the Windows scheduler interface, or null where there is no Task Scheduler.
  // rules: () => a GlobalRules-shaped object with check() and remove(), or null to leave rules out.
  // parts: the other removal parts (toolkit-remove-parts.cjs), in the order apply runs them.
  // plugins: () => { 'claude-code': bool, codex: bool }, whether the Toolkit plugin is installed.
  constructor({ home = os.homedir(), scheduler = null, registry = tasks, rules = null, include = [], parts: extra = [], plugins = () => ({}) } = {}) {
    for (const id of include) if (!tasks.ID.test(String(id))) throw new RemovalError(`--include takes task ids from the plan; ${JSON.stringify(id)} is not one`);
    this.#home = home; this.#scheduler = scheduler; this.#registry = registry; this.#rules = rules; this.#include = [...new Set(include)].sort();
    this.#parts = extra; this.#plugins = plugins;
  }

  // Read-only. The list of what would go and what stays, with the code that stands for it.
  plan() { return this.#read().plan; }

  #read() {
    const registry = this.#registry.readRegistry(this.#home);
    if (registry.status !== 'ok') throw new RemovalError(`The task record ${this.#registry.registryPath(this.#home)} could not be read (${registry.reason}), so nothing is planned. Repair it or move it aside, then run plan again.`);
    const recorded = registry.tasks.filter(entry => entry.host === 'windows');
    const found = [];
    if (this.#scheduler) {
      const folders = [...new Set([...recorded.map(entry => entry.folder), ...this.#scheduler.markedFolders()])].sort();
      for (const folder of folders) {
        const live = this.#scheduler.list(folder);
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
    }
    const listed = found.map(({ live, ...item }) => ({ ...item, action: KINDS[item.kind].removes || this.#include.includes(item.id) ? 'remove' : 'keep', definition: sha(windows.enrolledDefinition(live)) }));
    const going = listed.filter(item => item.action === 'remove');
    const liveIds = new Set(listed.map(item => item.record).filter(Boolean));
    // A record with no task behind it: Toolkit's own record of a task that is already gone.
    const stale = this.#scheduler ? recorded.filter(entry => !entry.adopted && !liveIds.has(entry.id)).map(entry => entry.id).sort() : [];
    const folders = [...new Set(going.map(item => item.folder))].sort().map(folder => ({ folder,
      expected: going.filter(item => item.folder === folder).length === listed.find(item => item.folder === folder).tasks_in_folder ? 'removed' : 'kept' }));
    const records = [...new Set([...going.map(item => item.record).filter(Boolean), ...stale])].sort();
    // The shared runner and the standing task approval go only when no marked task is kept.
    const shared = Boolean(this.#scheduler) && !listed.some(item => item.action === 'keep' && item.kind === 'changed');
    const state = this.#statePaths(records, shared);
    const owner = this.#rules ? this.#rules() : null;
    const rules = owner ? owner.check().files.map(file => ({ harness: file.harness, file: file.display || file.file, state: file.state,
      action: RULE_STATES_WITH_BLOCK.includes(file.state) ? 'remove' : RULE_STATES_HELD.includes(file.state) ? 'held' : 'none', ...(file.detail ? { detail: file.detail } : {}) })) : [];
    // Codex's config.toml: Toolkit's raised project_doc_max_bytes line, when there is one. It is in
    // the plan code, so a line that appears or changes after the plan removes nothing.
    const limit = owner && typeof owner.docLimitOnRemove === 'function' ? owner.docLimitOnRemove() : null;
    const codexSettings = limit && limit.action !== 'none' ? { file: limit.file, action: limit.action,
      ...(limit.previous !== undefined ? { previous: limit.previous } : {}), ...(limit.detail ? { detail: limit.detail } : {}) } : null;
    const tasksOut = listed.map(({ tasks_in_folder: ignored, ...item }) => item);
    // A part that cannot be read is held, so the rest of the plan still shows.
    const others = this.#parts.map(part => {
      let items;
      try { items = part.plan(); } catch (error) { items = [{ what: part.title, action: 'held', detail: `could not be read (${tasks.safeText(error.message)})` }]; }
      return { key: part.key, title: part.title, items };
    });
    const body = { tasks: tasksOut, stale_records: stale, folders, state: state.map(item => item.display), rules, codex_settings: codexSettings, parts: others, include: this.#include };
    // Not in the plan code: the agent uninstalls the plugins between the plan and apply.
    let installed = {};
    try { installed = this.#plugins() || {}; } catch { installed = {}; }
    const plugins = Object.keys(parts.PLUGIN_STEPS).filter(host => installed[host] === true);
    const nothing = !going.length && !stale.length && !state.length && !rules.some(file => file.action === 'remove') && !CODEX_WRITES.includes(codexSettings?.action)
      && !others.some(part => part.items.some(item => item.action === 'remove'));
    return { shared, plan: { schema: SCHEMA, ...body, plugins, scheduler: this.#scheduler ? 'read' : 'not available on this system', nothing, code: sha(body) } };
  }

  // One live task as the list shows it, or null for a task that is not Toolkit's and not listed by it.
  #classify(folder, live, recorded) {
    const marker = windows.parseMarker(live.description);
    const base = { folder, name: live.name, live };
    if (marker) {
      const entry = recorded.find(item => item.id === marker.id && item.folder === folder && !item.adopted) || null;
      const item = { ...base, id: marker.id, record: entry?.id || null, repository: entry?.repository || null };
      if (!entry) return { ...item, kind: 'unrecorded' };
      const changed = entry.enrolled && JSON.stringify(ordered(windows.enrolledDefinition(live))) !== JSON.stringify(ordered(entry.enrolled));
      return { ...item, kind: changed ? 'changed' : 'toolkit' };
    }
    const entry = recorded.find(item => item.folder === folder && sameName(item.name, live.name));
    if (!entry) return null;
    const item = { ...base, id: entry.id, record: entry.id, repository: entry.repository || null };
    if (entry.adopted) return { ...item, kind: 'adopted' };
    // The launcher rewrote this task's description when it disabled it, so the marker is gone. It is
    // still Toolkit's own only while it is byte for byte the snapshot the launcher recorded.
    const snapshot = entry.toolkit_missing === true && live.description === DISABLED_DESCRIPTION && entry.enrolled?.definition_xml;
    return snapshot && live.definition_xml === snapshot ? { ...item, kind: 'disabled' } : null;
  }

  // Toolkit's own task files under the user-state folder that go with the removed records.
  #statePaths(records, shared) {
    const root = tasks.userStateDir(this.#home);
    const display = file => `~/${path.relative(this.#home, file).split(path.sep).join('/')}`;
    const paths = records.map(id => path.join(root, 'tasks', id));
    if (shared) paths.push(path.dirname(windows.launcherPath(this.#home)), path.join(root, 'scheduled-task-approval.json'));
    return paths.filter(file => fs.existsSync(file)).map(file => ({ file, display: display(file) }));
  }

  // Removes exactly the confirmed list. A list that no longer matches the code removes nothing.
  apply(confirm) {
    const { plan, shared } = this.#read();
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
        const removed = this.#rules().remove();
        rules = removed.files.map(file => ({ harness: file.harness, file: file.display || file.file, result: file.action, ...(file.backup ? { backup: 'saved' } : {}) }));
        const limit = removed.doc_limit;
        if (limit && !['reported', 'unchanged'].includes(limit.action)) {
          codex = { file: limit.display || plan.codex_settings?.file || null, result: limit.action === 'held' ? 'failed' : limit.action,
            ...(limit.action === 'held' ? { reason: tasks.safeText(limit.detail || 'left alone') } : {}), ...(limit.backup ? { backup: 'saved' } : {}),
            ...(limit.load_check?.status ? { load_check: limit.load_check.status } : {}) };
        }
      } catch (error) { rules = [{ result: 'failed', reason: tasks.safeText(error.message) }]; }
    }
    // The other parts, in order; the Toolkit folder is last and checks the plugins itself.
    const others = this.#parts.map(part => {
      const planned = plan.parts.find(item => item.key === part.key)?.items || [];
      let done;
      try { done = part.apply(planned); } catch (error) { done = [{ what: part.title, result: 'failed', reason: tasks.safeText(error.message) }]; }
      return { key: part.key, title: part.title, results: done, held: planned.filter(item => !['remove', 'save'].includes(item.action)) };
    });
    let installed = {};
    try { installed = this.#plugins() || {}; } catch { installed = {}; }
    const plugins = Object.keys(parts.PLUGIN_STEPS).filter(host => installed[host] === true);
    const ok = !results.some(item => item.result === 'failed') && !steps.some(item => item.result === 'failed') && !folders.some(item => item.result === 'failed') && !rules.some(item => item.result === 'failed') && codex?.result !== 'failed'
      && !others.some(part => part.results.some(item => item.result === 'failed'));
    return { schema: 'toolkit.remove-result.v1', ok, tasks: results, kept: plan.tasks.filter(task => task.action === 'keep'), folders, steps, rules, codex_settings: codex,
      held_rules: plan.rules.filter(file => file.action === 'held'), held_codex_settings: plan.codex_settings?.action === 'held' ? plan.codex_settings : null, parts: others, plugins,
      folder_kept: others.some(part => part.key === 'toolkit_folder' && part.results.some(item => item.result === 'kept')) };
  }
}

const NOT_TOUCHED = 'Not touched: your repositories, your keys (the env store and the credential store), the Claude Code preferences you chose at setup (listed above when there are any), and every setting, agent, skill and file you made yourself.';

// The plugin uninstall lines for each app that still has the Toolkit plugin, and the app screen to use
// when its command line is not available.
function pluginLines(hosts, { after = false } = {}) {
  if (!hosts.length) return [after ? 'Plugins: none installed.' : 'Plugins: none installed, so nothing to uninstall.'];
  return [after ? 'Last step, uninstall the plugin (then start a new session):' : 'Plugins to uninstall (the agent runs these lines after your OK, before apply):',
    ...hosts.flatMap(host => { const step = parts.PLUGIN_STEPS[host]; return step.lines.map(line => `- ${step.app}: \`${line}\``).concat(`- ${step.app} without its command line: ${step.ui}.`); })];
}

function partPlanLine(item) {
  if (item.action === 'remove') return `- ${item.what}: removed${item.detail ? ` (${item.detail})` : ''}`;
  if (item.action === 'held') return `- ${item.what}: left alone, ${item.detail || 'it could not be read'}`;
  if (item.action === 'save') return `- ${item.what}: saved${item.detail ? `, ${item.detail}` : ''}`;
  return `- ${item.what}: kept${item.detail ? `, ${item.detail}` : ''}`;
}

function taskLine(item) {
  const where = `\\${item.folder}\\${item.name}`;
  return `${where}${item.repository ? ` (${item.repository})` : ''}: ${KINDS[item.kind].label}; id ${item.id}`;
}

function describePlan(plan) {
  const lines = ['# Remove Toolkit from this computer', ''];
  const going = plan.tasks.filter(item => item.action === 'remove');
  const kept = plan.tasks.filter(item => item.action === 'keep');
  if (plan.scheduler !== 'read') lines.push('Scheduled tasks: not checked, because this system has no Windows Task Scheduler.');
  if (plan.nothing) lines.push("Nothing of Toolkit's is left to remove.");
  if (going.length) lines.push('Scheduled tasks to stop and remove:', ...going.map(item => `- ${taskLine(item)}`));
  if (kept.length) lines.push('Scheduled tasks kept:', ...kept.map(item => `- ${taskLine(item)}${item.kind === 'changed' ? `. Add --include ${item.id} to remove it too` : '. Delete it in Task Scheduler yourself if you want it gone'}`));
  if (plan.folders.length) lines.push('Task Scheduler folders:', ...plan.folders.map(item => `- \\${item.folder}\\: ${item.expected === 'removed' ? 'removed once empty' : 'kept, it still holds a task'}`));
  if (plan.stale_records.length) lines.push(`Records of tasks that are already gone: ${plan.stale_records.join(', ')}`);
  if (plan.state.length) lines.push("Toolkit's own task files:", ...plan.state.map(file => `- ${file}`));
  const rules = plan.rules.filter(file => file.action !== 'none');
  const codex = plan.codex_settings;
  if (codex) lines.push('Codex settings:', `- ${codex.file}: ${codexPlanLine(codex)}`);
  if (rules.length) lines.push('Toolkit global rules:', ...rules.map(file => `- ${file.file}: ${file.action === 'remove' ? 'the Toolkit block is removed (a backup is saved first; the rest of the file stays)' : `left alone, ${file.detail || file.state}; fix or remove the Toolkit lines by hand`}`));
  for (const part of plan.parts || []) {
    if (!part.items.length) continue;
    lines.push(part.key === 'toolkit_folder' ? `${part.title} (goes last, once no Toolkit plugin is installed):` : `${part.title}:`, ...part.items.map(partPlanLine));
  }
  lines.push('', ...pluginLines(plan.plugins || []), '', NOT_TOUCHED);
  if (!plan.nothing) lines.push('', `Plan code: ${plan.code}`, 'Show the owner this list. After their OK, run apply with --confirm and this code. A list that changed gets a new code and removes nothing.');
  return lines;
}

// What the plan says about Codex's config.toml.
function codexPlanLine(codex) {
  if (codex.action === 'held') return `left alone, ${codex.detail || 'its Toolkit lines are damaged'}; fix or remove the Toolkit lines by hand`;
  const earlier = codex.previous === 'none' ? "Codex's own default (Toolkit added the line)" : `the earlier value ${codex.previous}`;
  const what = codex.action === 'delete-file'
    ? `the file is deleted, because Toolkit created it for its project_doc_max_bytes line and nothing else is in it`
    : `Toolkit's project_doc_max_bytes line is taken out and ${earlier} comes back; the rest of the file stays`;
  return `${what} (a backup is saved first, then Codex is asked to load the file)`;
}

function describeResult(result) {
  const lines = ['# Remove Toolkit from this computer', ''];
  for (const item of result.tasks) lines.push(`- ${taskLine(item)}: ${item.result}${item.reason ? ` (${item.reason})` : ''}`);
  for (const item of result.kept) lines.push(`- ${taskLine(item)}: kept`);
  for (const item of result.folders) lines.push(`- Folder \\${item.folder}\\: ${item.result}${item.reason ? ` (${item.reason})` : ''}`);
  for (const item of result.steps) lines.push(`- ${item.step}: ${item.result}${item.reason ? ` (${item.reason})` : ''}`);
  for (const item of result.rules) lines.push(`- Global rules ${item.file || ''}: ${item.result}${item.reason ? ` (${item.reason})` : ''}`);
  for (const item of result.held_rules) lines.push(`- Global rules ${item.file}: left alone, ${item.detail || item.state}`);
  if (result.codex_settings) lines.push(`- Codex settings ${result.codex_settings.file || ''}: ${result.codex_settings.result}${result.codex_settings.reason ? ` (${result.codex_settings.reason})` : ''}${result.codex_settings.load_check ? `; Codex load check: ${result.codex_settings.load_check}` : ''}`);
  if (result.held_codex_settings) lines.push(`- Codex settings ${result.held_codex_settings.file}: left alone, ${result.held_codex_settings.detail || 'its Toolkit lines are damaged'}`);
  for (const part of result.parts || []) {
    for (const item of part.results) lines.push(`- ${item.what}: ${item.result}${item.reason ? ` (${item.reason})` : ''}`);
    for (const item of part.held) lines.push(`- ${item.what}: ${item.action === 'held' ? `left alone, ${item.detail || 'it could not be read'}` : 'kept'}`);
  }
  const partsDone = (result.parts || []).some(part => part.results.length);
  if (!result.tasks.length && !result.steps.length && !result.rules.length && !result.codex_settings && !partsDone) lines.push("Nothing of Toolkit's was left to remove.");
  lines.push('', result.ok ? 'Done.' : 'Some steps failed. Nothing else was changed; run plan again to see what is left.');
  if (result.plugins?.length) lines.push('', ...pluginLines(result.plugins, { after: true }));
  // After the plugin goes, the remove toolkit skill may be gone too, so the exact line is printed.
  if (result.folder_kept) lines.push('', 'The Toolkit folder stays until the plugin is uninstalled. Then say `remove toolkit` again, or run this in PowerShell and follow it:',
    `node "${path.resolve(__filename)}" plan`);
  if (!result.plugins?.length && !result.folder_kept) lines.push('', 'Start a new session in each app so nothing of Toolkit stays loaded.');
  lines.push(NOT_TOUCHED);
  return lines;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!['plan', 'apply'].includes(command)) throw new RemovalError(USAGE);
  const args = { command, include: [], confirm: null, json: false };
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === '--json') args.json = true;
    else if (rest[i] === '--include' && rest[i + 1]) args.include.push(...rest[++i].split(',').filter(Boolean));
    else if (rest[i] === '--confirm' && rest[i + 1] && command === 'apply') args.confirm = rest[++i];
    else throw new RemovalError(USAGE);
  }
  if (command === 'apply' && !/^[a-f0-9]{64}$/.test(args.confirm || '')) throw new RemovalError('apply needs --confirm <plan code> from the plan the owner was shown.');
  return args;
}

function defaultRules(environment = process.env) {
  const { GlobalRules } = require('./toolkit-global-rules.cjs');
  return () => new GlobalRules({ environment, harnesses: GlobalRules.setupHarnesses({ environment }) });
}

function main(argv = process.argv.slice(2), deps = {}) {
  const log = deps.log || console.log;
  try {
    const args = parseArgs(argv);
    const platform = deps.platform || process.platform;
    const home = deps.home || os.homedir();
    const environment = deps.environment || process.env;
    const removal = new ToolkitRemoval({ home, include: args.include,
      scheduler: deps.scheduler !== undefined ? deps.scheduler : platform === 'win32' ? windows.powerShellScheduler() : null,
      rules: deps.rules !== undefined ? deps.rules : defaultRules(environment),
      parts: deps.parts !== undefined ? deps.parts : parts.defaultParts({ environment, home }),
      plugins: deps.plugins !== undefined ? deps.plugins : () => parts.pluginState({ environment, home }) });
    const output = args.command === 'plan' ? removal.plan() : removal.apply(args.confirm);
    for (const line of args.json ? [JSON.stringify(output, null, 2)] : args.command === 'plan' ? describePlan(output) : describeResult(output)) log(line);
    return args.command === 'apply' && !output.ok ? 1 : 0;
  } catch (error) {
    (deps.error || console.error)(error instanceof RemovalError || error?.name === 'WindowsTasksError' || error?.name === 'TasksError' ? error.message : 'Toolkit removal could not be planned; nothing was removed.');
    return error?.exitCode || 1;
  }
}

module.exports = { ToolkitRemoval, RemovalError, KINDS, SCHEMA, describePlan, describeResult, parseArgs, main };

if (require.main === module) process.exitCode = main();
