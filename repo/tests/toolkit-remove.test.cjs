'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const tasks = require('../scripts/toolkit-tasks.cjs');
const windows = require('../scripts/toolkit-windows-tasks.cjs');
const launcher = require('../scripts/toolkit-task-launcher.cjs');
const removal = require('../scripts/toolkit-remove.cjs');
const s = require('./support/windows-task-switch-world.cjs');

// One repository's footer cleaner, enrolled through the real planner and apply, on the fake scheduler.
// Each checkout keeps its own repository name, so a second repository in one home is not mistaken for the first.
function enrol(t, world, name) {
  const root = s.checkout(t);
  world.names = (world.names || new Map()).set(root, name);
  const governance = { readIdentity: target => ({ valid: true, root: target || root, remote: { host: 'github.com', path: `/example/${world.names.get(target || root) || name}.git` } }),
    governanceState: () => ({ state: 'DISABLED', merged: { status: 'none', fresh: true } }), readObservation: () => ({ status: 'none', fresh: true }) };
  const desired = windows.desiredTasks({ checkout: root, toolkitRoot: world.managed, nodePath: s.NODE, home: world.home, deps: { identityReader: s.identityReader, governance } });
  const applied = windows.applyTasks(desired, { home: world.home, scheduler: world.scheduler });
  assert.ok(!applied.refused, JSON.stringify(applied));
  const entry = tasks.readRegistry(world.home).tasks.find(item => item.repository === `example/${name}`);
  return { root, entry, live: () => world.scheduler.folders.get(entry.folder)?.find(task => task.name === entry.name) };
}

// The fake scheduler has no method for the launcher-disabled task; it keeps the same two checks the
// PowerShell side makes: the fixed description, and the exact recorded definition.
function withDisabledRemoval(scheduler) {
  scheduler.unregisterDisabled = (folder, name, previous) => {
    scheduler.calls.push(['unregister-disabled', folder, name]);
    const list = scheduler.folders.get(folder) || [], task = list.find(item => item.name === name);
    if (task && task.description !== launcher.DISABLED_DESCRIPTION) throw new Error('marker');
    if (task && (!previous || !s.assertDefinition(task, previous))) throw new Error('changed before removal');
    scheduler.folders.set(folder, list.filter(item => item.name !== name));
    return { removed: Boolean(task) };
  };
  return scheduler;
}

function world(t) {
  const home = s.tempHome(t);
  return { home, managed: path.join(home, 'managed'), scheduler: withDisabledRemoval(s.fakeScheduler()) };
}

function fakeRules(states = { 'claude-code': 'current', codex: 'absent' }) {
  const calls = [];
  const files = () => Object.entries(states).map(([harness, state]) => ({ harness, file: `~/${harness}/rules.md`, display: `~/${harness}/rules.md`, state, ...(state === 'broken' ? { detail: 'the Toolkit markers are broken' } : {}) }));
  const factory = () => ({
    check() { calls.push('check'); return { files: files() }; },
    remove() {
      calls.push('remove');
      const result = files().map(file => ({ ...file, action: ['current', 'stale', 'tampered'].includes(file.state) ? 'removed' : file.state === 'broken' ? 'held' : 'absent', ...(file.state === 'current' ? { backup: 'x' } : {}) }));
      for (const harness of Object.keys(states)) if (['current', 'stale', 'tampered'].includes(states[harness])) states[harness] = 'absent';
      return { files: result };
    },
  });
  return { factory, calls };
}

const owner = (w, options = {}) => new removal.ToolkitRemoval({ home: w.home, scheduler: w.scheduler, rules: options.rules === undefined ? null : options.rules, include: options.include || [] });
const adopt = (w, folder, name, id) => {
  w.scheduler.folders.set(folder, [...(w.scheduler.folders.get(folder) || []), { name, description: 'My own backup job', state: 'Ready', execute: 'C:\\backup.exe', arguments: '', working_directory: '', actions: [{ execute: 'C:\\backup.exe', arguments: '', working_directory: '' }], triggers: [] }]);
  return windows.adoptTask({ folder, task: name, id, purpose: 'nightly backup' }, { scheduler: w.scheduler, home: w.home });
};
const treeOf = folder => {
  const out = {};
  const walk = dir => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); if (entry.isDirectory()) walk(file); else out[path.relative(folder, file)] = fs.readFileSync(file, 'hex'); } };
  walk(folder);
  return out;
};

test('tasks in three folders: the two Toolkit tasks and their empty folders go, the adopted task stays', t => {
  const w = world(t), one = enrol(t, w, 'widget'), two = enrol(t, w, 'gadget');
  assert.notEqual(one.entry.folder, two.entry.folder);
  adopt(w, 'MINE', 'Nightly backup', 'nightly-backup');
  const before = w.scheduler.calls.length;
  const plan = owner(w).plan();
  assert.deepEqual(plan.tasks.map(item => [item.folder, item.kind, item.action]).sort(), [[two.entry.folder, 'toolkit', 'remove'], ['MINE', 'adopted', 'keep'], [one.entry.folder, 'toolkit', 'remove']].sort());
  assert.deepEqual(plan.folders.map(item => item.expected), ['removed', 'removed']);
  assert.match(removal.describePlan(plan).join('\n'), /Plan code: [a-f0-9]{64}/);
  assert.ok(w.scheduler.calls.slice(before).every(call => ['list', 'marked-folders'].includes(call[0])), `plan is read-only: ${JSON.stringify(w.scheduler.calls.slice(before))}`);

  const result = owner(w).apply(plan.code);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.tasks.map(item => item.result), ['removed', 'removed']);
  assert.equal(w.scheduler.folders.has(one.entry.folder), false);
  assert.equal(w.scheduler.folders.has(two.entry.folder), false);
  assert.equal(w.scheduler.folders.get('MINE').length, 1);
  assert.deepEqual(tasks.readRegistry(w.home).tasks.map(entry => entry.id), ['nightly-backup']);
  assert.equal(fs.existsSync(path.dirname(windows.launcherPath(w.home))), false, 'the shared runner goes with the last Toolkit task');
});

test('a second run finds nothing and changes nothing', t => {
  const w = world(t); enrol(t, w, 'widget');
  const rules = fakeRules();
  assert.equal(owner(w, { rules: rules.factory }).apply(owner(w, { rules: rules.factory }).plan().code).ok, true);
  const before = treeOf(w.home), calls = w.scheduler.calls.length;
  const again = owner(w, { rules: rules.factory }).plan();
  assert.equal(again.nothing, true);
  assert.match(removal.describePlan(again).join('\n'), /Nothing of Toolkit's is left to remove\./);
  rules.calls.length = 0;
  const result = owner(w, { rules: rules.factory }).apply(again.code);
  assert.equal(result.ok, true);
  assert.deepEqual([result.tasks, result.steps, result.rules, result.folders], [[], [], [], []]);
  assert.deepEqual(treeOf(w.home), before);
  assert.deepEqual(rules.calls, ['check'], 'rules are read, never rewritten, when no block is left');
  assert.ok(!w.scheduler.calls.slice(calls).some(call => call[0] !== 'list'));
});

test('apply refuses a code from an older list, a missing code and a wrong code, and removes nothing', t => {
  const w = world(t), one = enrol(t, w, 'widget');
  const old = owner(w).plan().code;
  enrol(t, w, 'gadget');
  for (const code of [old, undefined, '', 'f'.repeat(64), null, 7]) assert.throws(() => owner(w).apply(code), /nothing was removed/);
  assert.ok(one.live());
  assert.equal(tasks.readRegistry(w.home).tasks.length, 2);
  assert.ok(!w.scheduler.calls.some(call => call[0] === 'unregister'));
});

// The removal matrix: one row per kind of task, with what the plan calls it and what apply does.
const MATRIX = [
  { row: "Toolkit's own, unchanged", kind: 'toolkit', action: 'remove', gone: true },
  { row: 'changed by hand', arrange: (w, e) => { e.live().arguments += ' --my-flag'; }, kind: 'changed', action: 'keep', gone: false },
  { row: 'changed by hand and named with --include', arrange: (w, e) => { e.live().state = 'Disabled'; }, include: true, kind: 'changed', action: 'remove', gone: true },
  { row: 'marker with its record lost', arrange: w => tasks.writeRegistry(w.home, []), kind: 'unrecorded', action: 'remove', gone: true },
  { row: 'disabled by the launcher, still the exact snapshot', arrange: (w, e) => disable(w, e), kind: 'disabled', action: 'remove', gone: true },
  { row: 'disabled by the launcher, then changed', arrange: (w, e) => { disable(w, e); e.live().definition_xml = '<edited/>'; }, kind: null, gone: false },
  { row: 'marker removed by hand', arrange: (w, e) => { e.live().description = 'mine now'; }, kind: null, gone: false },
];
function disable(w, e) {
  const live = e.live();
  live.state = 'Disabled'; live.description = launcher.DISABLED_DESCRIPTION; live.definition_xml = '<disabled-fixture/>';
  tasks.updateRegistry(w.home, list => list.map(entry => entry.id === e.entry.id ? { ...entry, toolkit_missing: true, enrolled: { ...entry.enrolled, description: launcher.DISABLED_DESCRIPTION, enabled: false, definition_xml: live.definition_xml } } : entry));
}
for (const row of MATRIX) test(`removal matrix: ${row.row}`, t => {
  const w = world(t), e = enrol(t, w, 'widget');
  if (row.arrange) row.arrange(w, e);
  const include = row.include ? [e.entry.id] : [];
  const plan = owner(w, { include }).plan();
  const item = plan.tasks.find(task => task.name === e.entry.name);
  assert.equal(item?.kind || null, row.kind);
  if (row.kind) assert.equal(item.action, row.action);
  const result = owner(w, { include }).apply(plan.code);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(Boolean(e.live()), !row.gone);
  if (!row.gone && row.kind === 'changed') {
    assert.ok(tasks.readRegistry(w.home).tasks.some(entry => entry.id === e.entry.id), 'a kept task keeps its record');
    assert.equal(fs.existsSync(windows.launcherPath(w.home)), true, 'a kept task keeps its runner');
  }
});

test('a record with no task behind it is cleared, and a task that is not Toolkit\'s is never listed or touched', t => {
  const w = world(t), e = enrol(t, w, 'widget');
  const folder = e.entry.folder;
  w.scheduler.folders.set(folder, [{ name: 'Someone else', description: 'not Toolkit', state: 'Ready', execute: 'x', arguments: '', working_directory: '', actions: [], triggers: [] }]);
  const plan = owner(w).plan();
  assert.deepEqual(plan.tasks, []);
  assert.deepEqual(plan.stale_records, [e.entry.id]);
  const result = owner(w).apply(plan.code);
  assert.equal(result.ok, true);
  assert.deepEqual(tasks.readRegistry(w.home).tasks, []);
  assert.deepEqual(w.scheduler.folders.get(folder).map(task => task.name), ['Someone else']);
});

test('a folder that still holds another task is kept', t => {
  const w = world(t), e = enrol(t, w, 'widget');
  w.scheduler.folders.get(e.entry.folder).push({ name: 'Someone else', description: 'not Toolkit', state: 'Ready', execute: 'x', arguments: '', working_directory: '', actions: [], triggers: [] });
  const plan = owner(w).plan();
  assert.deepEqual(plan.folders, [{ folder: e.entry.folder, expected: 'kept' }]);
  assert.deepEqual(owner(w).apply(plan.code).folders, [{ folder: e.entry.folder, result: 'kept' }]);
  assert.deepEqual(w.scheduler.folders.get(e.entry.folder).map(task => task.name), ['Someone else']);
});

test('the adopted task can never be named for removal, and an unknown id is refused', t => {
  const w = world(t); enrol(t, w, 'widget'); adopt(w, 'MINE', 'Nightly backup', 'nightly-backup');
  assert.throws(() => owner(w, { include: ['nightly-backup'] }).plan(), /Toolkit never removes it/);
  assert.throws(() => owner(w, { include: ['no-such-task'] }).plan(), /not a task in the plan/);
  assert.throws(() => owner(w, { include: ['../x'] }), /is not one/);
});

test('a task that changes between the plan read and its removal is left alone and reported', t => {
  const w = world(t), e = enrol(t, w, 'widget');
  const plan = owner(w).plan();
  const list = w.scheduler.list.bind(w.scheduler);
  let reads = 0;
  // The first list call belongs to apply's own fresh plan; the task changes just after it.
  w.scheduler.list = folder => { const rows = list(folder); if (++reads === 1) e.live().arguments += ' --late-edit'; return rows; };
  const result = owner(w).apply(plan.code);
  assert.equal(result.ok, false);
  assert.match(result.tasks[0].reason, /changed after the plan was read/);
  assert.ok(e.live());
  assert.ok(tasks.readRegistry(w.home).tasks.some(entry => entry.id === e.entry.id));
  assert.equal(fs.existsSync(windows.launcherPath(w.home)), true);
});

test('global rules: a present block is removed through the rules owner, a broken file is reported and left', t => {
  const w = world(t); enrol(t, w, 'widget');
  const rules = fakeRules({ 'claude-code': 'current', codex: 'broken' });
  const plan = owner(w, { rules: rules.factory }).plan();
  assert.deepEqual(plan.rules.map(file => file.action), ['remove', 'held']);
  const text = removal.describePlan(plan).join('\n');
  assert.match(text, /the Toolkit block is removed \(a backup is saved first/);
  assert.match(text, /left alone, the Toolkit markers are broken/);
  const result = owner(w, { rules: rules.factory }).apply(plan.code);
  assert.deepEqual(result.rules.map(file => file.result), ['removed', 'held']);
  assert.deepEqual(result.held_rules.map(file => file.harness), ['codex']);
});

test('nothing outside Toolkit\'s own task files changes: a repository, other user-state and settings stay byte for byte', t => {
  const w = world(t), e = enrol(t, w, 'widget');
  const outside = { repo: e.root, settings: path.join(w.home, '.claude'), state: path.join(tasks.userStateDir(w.home), 'env') };
  fs.mkdirSync(outside.settings, { recursive: true }); fs.writeFileSync(path.join(outside.settings, 'settings.json'), '{"permissions":{}}\n');
  fs.mkdirSync(outside.state, { recursive: true }); fs.writeFileSync(path.join(outside.state, 'index.json'), '{"names":["EXAMPLE_KEY"]}\n');
  fs.writeFileSync(path.join(e.root, 'AGENTS.md'), '# rules\n');
  tasks.writeLastRun(e.entry.id, { schema: 'toolkit.task-last-run.v1', id: e.entry.id, job: 'footer-sweep', started: '2026-11-11T00:00:00.000Z', finished: '2026-11-11T00:00:01.000Z', status: 'ok', exit: 0, summary: [] }, w.home);
  const before = Object.fromEntries(Object.entries(outside).map(([name, folder]) => [name, treeOf(folder)]));
  const plan = owner(w).plan();
  assert.ok(plan.state.includes(`~/.ai-agent-toolkit/user-state/tasks/${e.entry.id}`));
  assert.equal(owner(w).apply(plan.code).ok, true);
  for (const [name, folder] of Object.entries(outside)) assert.deepEqual(treeOf(folder), before[name], name);
  assert.equal(fs.existsSync(path.join(tasks.userStateDir(w.home), 'tasks', e.entry.id)), false);
});

test('an unreadable task record plans nothing and removes nothing', t => {
  const w = world(t), e = enrol(t, w, 'widget');
  fs.writeFileSync(tasks.registryPath(w.home), '{broken');
  assert.throws(() => owner(w).plan(), /could not be read .* nothing is planned/);
  assert.throws(() => owner(w).apply('a'.repeat(64)), /nothing is planned/);
  assert.ok(e.live());
});

test('without a Task Scheduler the plan says so and leaves task records alone', t => {
  const w = world(t), e = enrol(t, w, 'widget');
  const plan = new removal.ToolkitRemoval({ home: w.home, scheduler: null, rules: null }).plan();
  assert.equal(plan.scheduler, 'not available on this system');
  assert.deepEqual([plan.tasks, plan.stale_records, plan.state], [[], [], []]);
  assert.match(removal.describePlan(plan).join('\n'), /not checked, because this system has no Windows Task Scheduler/);
  assert.ok(tasks.readRegistry(w.home).tasks.some(entry => entry.id === e.entry.id));
});

test('command line: plan prints the list and the code, apply needs the code, bad arguments print usage', t => {
  const w = world(t); enrol(t, w, 'widget');
  const run = argv => { const out = [], err = []; const code = removal.main(argv, { home: w.home, scheduler: w.scheduler, rules: null, platform: 'win32', log: line => out.push(line), error: line => err.push(line) }); return { code, out: out.join('\n'), err: err.join('\n') }; };
  const plan = run(['plan']);
  assert.equal(plan.code, 0);
  const code = /Plan code: ([a-f0-9]{64})/.exec(plan.out)[1];
  assert.equal(JSON.parse(run(['plan', '--json']).out).code, code);
  assert.deepEqual([run(['apply']).code, run(['apply', '--confirm', 'nope']).code, run(['sweep']).code, run(['plan', '--confirm', code]).code], [1, 1, 1, 1]);
  assert.match(run(['apply']).err, /apply needs --confirm/);
  const wrong = run(['apply', '--confirm', '0'.repeat(64)]);
  assert.equal(wrong.code, 1); assert.match(wrong.err, /nothing was removed/);
  const done = run(['apply', '--confirm', code]);
  assert.equal(done.code, 0); assert.match(done.out, /: removed/); assert.match(done.out, /Done\./);
});

test('the real scheduler removes a launcher-disabled task only with its exact recorded definition', () => {
  const payloads = [];
  const run = (file, args, options) => { payloads.push(JSON.parse(options.env.TOOLKIT_TASK_PAYLOAD)); return { status: 0, stdout: '{"removed":true}', stderr: '' }; };
  const scheduler = windows.powerShellScheduler({ run });
  assert.throws(() => scheduler.unregisterDisabled('WIDGET', 'WIDGET - Footer sweep', { definition_xml: null }), /left alone/);
  assert.equal(payloads.length, 0);
  assert.deepEqual(scheduler.unregisterDisabled('WIDGET', 'WIDGET - Footer sweep', { definition_xml: '<x/>' }), { removed: true });
  assert.deepEqual(payloads[0], { folder: 'WIDGET', name: 'WIDGET - Footer sweep', marker: launcher.DISABLED_DESCRIPTION, expected_xml: '<x/>' });
});

// The real global rules owner, in a throwaway home, with Codex's load check stubbed so no Codex starts.
function realRules(w, probes) {
  const { GlobalRules } = require('../scripts/toolkit-global-rules.cjs');
  const environment = { HOME: w.home, USERPROFILE: w.home, CLAUDE_CONFIG_DIR: path.join(w.home, '.claude'), CODEX_HOME: path.join(w.home, '.codex') };
  const make = () => new GlobalRules({ environment, harnesses: ['claude-code', 'codex'], backupRoot: path.join(w.home, 'backups'),
    loadCheckOptions: { probe: file => { probes.push(file); return { status: 'verified' }; } } });
  make().refresh();
  return { factory: make, codex: path.join(environment.CODEX_HOME, 'config.toml'), claude: path.join(environment.CLAUDE_CONFIG_DIR, 'settings.json') };
}
const limitBlock = (previous, line = '') => [`# AI-AGENT-TOOLKIT:global-rules:BEGIN PROJECT-DOC-MAX-BYTES previous=${previous}${line ? ` line=${Buffer.from(line).toString('base64')}` : ''}${previous === 'none' && !line ? ' created=yes' : ''}`,
  'project_doc_max_bytes = 65536', '# AI-AGENT-TOOLKIT:global-rules:END PROJECT-DOC-MAX-BYTES'].join('\n');

test('Codex settings: the plan lists the raised project_doc_max_bytes line, its code covers it, and apply puts the earlier value back', t => {
  const w = world(t); enrol(t, w, 'widget');
  const probes = [];
  const rules = realRules(w, probes);
  const original = 'model = "example"\nproject_doc_max_bytes = 32768\n[tools]\nweb_search = true\n';
  fs.writeFileSync(rules.codex, original.replace('project_doc_max_bytes = 32768', limitBlock('32768', 'project_doc_max_bytes = 32768\n')));
  fs.mkdirSync(path.dirname(rules.claude), { recursive: true }); fs.writeFileSync(rules.claude, '{"permissions":{}}\n');
  const settings = fs.readFileSync(rules.claude);
  const plan = owner(w, { rules: rules.factory }).plan();
  assert.deepEqual(plan.codex_settings, { file: '~/.codex/config.toml', action: 'restore', previous: '32768' });
  const text = removal.describePlan(plan).join('\n');
  assert.match(text, /Codex settings:\n- ~\/\.codex\/config\.toml: Toolkit's project_doc_max_bytes line is taken out and the earlier value 32768 comes back; the rest of the file stays \(a backup is saved first, then Codex is asked to load the file\)/);
  assert.doesNotMatch(text, /Not touched:[^\n]*app settings files,/);
  assert.match(text, /Not touched: your repositories, your keys/);
  // The line is in the plan code: a list read without it removes nothing.
  const raised = fs.readFileSync(rules.codex);
  fs.writeFileSync(rules.codex, original);
  const without = owner(w, { rules: rules.factory }).plan();
  assert.equal(without.codex_settings, null);
  assert.notEqual(without.code, plan.code);
  fs.writeFileSync(rules.codex, raised);
  assert.throws(() => owner(w, { rules: rules.factory }).apply(without.code), /nothing was removed/);
  assert.deepEqual(fs.readFileSync(rules.codex), raised);
  assert.equal(probes.length, 0, 'a refused apply starts no Codex load check');
  const result = owner(w, { rules: rules.factory }).apply(plan.code);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(fs.readFileSync(rules.codex, 'utf8'), original);
  assert.deepEqual(result.codex_settings, { file: '~/.codex/config.toml', result: 'restored-previous', backup: 'saved', load_check: 'verified' });
  assert.deepEqual(probes, [rules.codex]);
  assert.match(removal.describeResult(result).join('\n'), /Codex settings ~\/\.codex\/config\.toml: restored-previous; Codex load check: verified/);
  assert.deepEqual(fs.readFileSync(rules.claude), settings, 'other app settings stay byte for byte');
  assert.equal(owner(w, { rules: rules.factory }).plan().nothing, true);
});

test('Codex settings: a config.toml Toolkit created for the line is deleted, and damaged markers are listed and left alone', t => {
  const w = world(t);
  const probes = [];
  const rules = realRules(w, probes);
  fs.writeFileSync(rules.codex, `${limitBlock('none')}\n`);
  const plan = owner(w, { rules: rules.factory }).plan();
  assert.deepEqual(plan.codex_settings, { file: '~/.codex/config.toml', action: 'delete-file', previous: 'none' });
  assert.match(removal.describePlan(plan).join('\n'), /the file is deleted, because Toolkit created it for its project_doc_max_bytes line and nothing else is in it/);
  assert.equal(plan.nothing, false);
  const result = owner(w, { rules: rules.factory }).apply(plan.code);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(fs.existsSync(rules.codex), false);
  assert.equal(result.codex_settings.result, 'deleted-file');
  const damaged = `model = "example"\n${limitBlock('none')}\n# AI-AGENT-TOOLKIT:global-rules:END PROJECT-DOC-MAX-BYTES\n`;
  fs.writeFileSync(rules.codex, damaged);
  const held = owner(w, { rules: rules.factory }).plan();
  assert.equal(held.codex_settings.action, 'held');
  assert.match(removal.describePlan(held).join('\n'), /~\/\.codex\/config\.toml: left alone, the Toolkit markers are not one intact pair/);
  const after = owner(w, { rules: rules.factory }).apply(held.code);
  assert.equal(fs.readFileSync(rules.codex, 'utf8'), damaged);
  assert.equal(after.codex_settings, null);
  assert.equal(after.held_codex_settings.action, 'held');
});

// ---- The other parts: app settings, helper agent files, skill copies and the Toolkit folder ----
const parts = require('../scripts/toolkit-remove-parts.cjs');
const { ClaudeSubagentDepthSetting } = require('../scripts/toolkit-claude-subagent-depth.cjs');
const { OfficialN8nSkills } = require('../scripts/toolkit-n8n-official-skills.cjs');
const claudeHelpers = require('../scripts/toolkit-claude-helper-agents.cjs');
const codexHelpers = require('../scripts/toolkit-codex-helper-agents.cjs');
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// A home with everything a full setup leaves behind, built through the owning modules where they run offline.
function fullHome(t) {
  const home = s.tempHome(t);
  const environment = { CLAUDE_CONFIG_DIR: path.join(home, '.claude'), CODEX_HOME: path.join(home, '.codex') };
  const control = path.join(home, '.ai-agent-toolkit', 'agent-control');
  const depth = new ClaudeSubagentDepthSetting({ environment, controlRoot: control });
  fs.mkdirSync(environment.CLAUDE_CONFIG_DIR, { recursive: true });
  fs.writeFileSync(path.join(environment.CLAUDE_CONFIG_DIR, 'settings.json'), '{\n  "theme": "dark"\n}\n');
  assert.equal(depth.apply('enable').changed, true);
  const { ClaudeUserSettings } = require('../scripts/toolkit-claude-user-settings.cjs');
  new ClaudeUserSettings({ environment, controlRoot: control }).apply({ attribution: 'enable' });
  const agents = { claude: path.join(environment.CLAUDE_CONFIG_DIR, 'agents'), codex: path.join(environment.CODEX_HOME, 'agents') };
  fs.mkdirSync(agents.claude, { recursive: true }); fs.mkdirSync(agents.codex, { recursive: true });
  fs.writeFileSync(path.join(agents.claude, 'toolkit-g0.md'), `---\nname: toolkit-g0\n---\n${claudeHelpers.MARKER}\n`);
  fs.writeFileSync(path.join(agents.claude, 'my-reviewer.md'), '---\nname: my-reviewer\n---\nMine.\n');
  fs.writeFileSync(path.join(agents.codex, 'toolkit-g1.toml'), `${codexHelpers.MARKER}\nname = "toolkit-g1"\n`);
  const n8n = new OfficialN8nSkills({ toolkitRoot: REPO_ROOT, host: 'claude-code', homeDir: home });
  assert.ok(n8n.install().copied.length > 0);
  fs.mkdirSync(path.join(home, '.claude', 'skills', 'my-skill'), { recursive: true });
  const folder = path.join(home, '.ai-agent-toolkit');
  for (const file of ['source/repo/README.md', 'current/state.json', 'user-state/tmp/scrap.txt', 'env/manifest.json', 'backups/global-rules/a.md', 'agent-control/backups/claude-settings/b.json', 'agent-control/profile.json', 'notes/mine.txt']) {
    fs.mkdirSync(path.dirname(path.join(folder, file)), { recursive: true }); fs.writeFileSync(path.join(folder, file), 'x');
  }
  const installed = { 'claude-code': true, codex: false };
  const delegation = { calls: [], RUNTIMES: { UNKNOWN: 'unknown', V1: 'v1', V2: 'v2' }, owned: true,
    inspectCodexDelegationConfig() { return this.owned ? { ownership: 'toolkit-managed-v2', helper_count: 2 } : { ownership: 'none', status: 'unconfigured' }; },
    removeCodexDelegation(file, options) { this.calls.push([file, options]); this.owned = false; return { status: 'removed', changed: true }; } };
  const list = [new parts.ClaudeDepthPart({ environment: { ...environment, AI_AGENT_TOOLKIT_CONTROL_ROOT: control }, home }),
    new parts.ClaudeUserSettingsPart({ environment: { ...environment, AI_AGENT_TOOLKIT_CONTROL_ROOT: control }, home }),
    new parts.CodexHelperLimitPart({ environment, home, delegation }), new parts.HelperAgentFilesPart({ environment, home }),
    new parts.SkillCopiesPart({ home, toolkitRoot: REPO_ROOT }), new parts.ToolkitFolderPart({ home, environment, plugins: () => installed })];
  const make = () => new removal.ToolkitRemoval({ home, parts: list, plugins: () => installed });
  return { home, environment, depth, agents, folder, installed, delegation, make };
}

test('full removal: settings, helper files and skill copies go after the OK; the folder waits for the plugins, then goes keeping env and backups', t => {
  const h = fullHome(t);
  const plan = h.make().plan();
  const text = removal.describePlan(plan).join('\n');
  assert.equal(plan.nothing, false);
  assert.deepEqual(plan.plugins, ['claude-code']);
  assert.match(text, /Claude Code subagent limit:\n- ~\/\.claude\/settings\.json: the subagent limit CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: removed/);
  assert.match(text, /Claude Code preferences you chose at setup:\n- ~\/\.claude\/settings\.json: No AI attribution in commits and pull requests \(attribution\): kept, set at setup and kept as your own/);
  assert.match(text, /Not touched: [^\n]*the Claude Code preferences you chose at setup/);
  assert.match(text, /Codex helper limit:\n- ~\/\.codex\/config\.toml: Toolkit's helper limit block: removed \(toolkit-managed-v2, 2 helpers; Codex may then use its own higher default/);
  assert.match(text, /- ~\/\.claude\/agents\/toolkit-g0\.md: removed\n- ~\/\.codex\/agents\/toolkit-g1\.toml: removed/);
  assert.doesNotMatch(text, /my-reviewer|my-skill/);
  assert.match(text, /Skill folders Toolkit copied:\n- ~\/\.claude\/skills\/[^\n]+: removed/);
  assert.match(text, /Toolkit folder \(goes last, once no Toolkit plugin is installed\):/);
  assert.match(text, /~\/\.ai-agent-toolkit\/agent-control: removed \(its backups folder stays\)/);
  assert.match(text, /~\/\.ai-agent-toolkit\/env: kept, the list of your keys/);
  assert.match(text, /~\/\.ai-agent-toolkit\/notes: kept, not a Toolkit file/);
  assert.match(text, /Plugins to uninstall[^\n]*\n- Claude Code: `claude plugin uninstall ai-agent-toolkit@ai-agent-toolkit-local`\n- Claude Code: `claude plugin marketplace remove ai-agent-toolkit-local`/);
  assert.doesNotMatch(text, /codex plugin remove/);
  // The plugin state is not in the code: the agent uninstalls between plan and apply.
  h.installed['claude-code'] = false;
  assert.equal(h.make().plan().code, plan.code);
  h.installed['claude-code'] = true;
  const first = h.make().apply(plan.code);
  assert.equal(first.ok, true, JSON.stringify(first));
  const settings = JSON.parse(fs.readFileSync(path.join(h.environment.CLAUDE_CONFIG_DIR, 'settings.json'), 'utf8'));
  assert.deepEqual(settings, { theme: 'dark', attribution: false }, 'the depth limit goes; the attribution preference stays');
  assert.equal(h.delegation.calls.length, 1);
  assert.equal(h.delegation.calls[0][1].approveCapacityResetRisk, true);
  assert.deepEqual(fs.readdirSync(h.agents.claude), ['my-reviewer.md']);
  assert.deepEqual(fs.readdirSync(h.agents.codex), []);
  assert.deepEqual(fs.readdirSync(path.join(h.home, '.claude', 'skills')), ['my-skill']);
  assert.ok(fs.existsSync(path.join(h.folder, 'source', 'repo', 'README.md')), 'the folder waits while a plugin is installed');
  assert.equal(first.folder_kept, true);
  const after = removal.describeResult(first).join('\n');
  assert.match(after, /~\/\.ai-agent-toolkit: kept \(the Claude Code plugin is still installed/);
  assert.match(after, /Last step, uninstall the plugin[^\n]*\n- Claude Code: `claude plugin uninstall/);
  assert.match(after, /say `remove toolkit` again, or run this in PowerShell and follow it:\nnode "[^"]*toolkit-remove\.cjs" plan/);
  // Once the plugin is gone, a second run lists only the folder and removes Toolkit's entries.
  h.installed['claude-code'] = false;
  const second = h.make().plan();
  assert.deepEqual(second.parts.filter(part => part.items.some(item => item.action === 'remove')).map(part => part.key), ['toolkit_folder']);
  const done = h.make().apply(second.code);
  assert.equal(done.ok, true, JSON.stringify(done));
  assert.equal(done.folder_kept, false);
  assert.deepEqual(fs.readdirSync(h.folder).sort(), ['agent-control', 'backups', 'env', 'notes']);
  assert.deepEqual(fs.readdirSync(path.join(h.folder, 'agent-control')), ['backups']);
  assert.equal(fs.readFileSync(path.join(h.folder, 'env', 'manifest.json'), 'utf8'), 'x');
  assert.match(removal.describeResult(done).join('\n'), /Start a new session in each app/);
  assert.equal(h.make().plan().nothing, true);
});

test('full removal: a Claude Code subagent limit you set yourself is listed as kept and left alone', t => {
  const h = fullHome(t);
  const file = path.join(h.environment.CLAUDE_CONFIG_DIR, 'settings.json');
  fs.writeFileSync(file, '{\n  "env": {\n    "CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH": "3"\n  }\n}\n');
  const plan = h.make().plan();
  assert.match(removal.describePlan(plan).join('\n'), /CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: kept, you set this value yourself/);
  h.make().apply(plan.code);
  assert.equal(fs.readFileSync(file, 'utf8'), '{\n  "env": {\n    "CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH": "3"\n  }\n}\n');
});

test('full removal: a helper file that changes after the plan gives a new code, and nothing is removed', t => {
  const h = fullHome(t);
  const plan = h.make().plan();
  fs.writeFileSync(path.join(h.agents.claude, 'toolkit-g0.md'), 'edited by hand, marker gone\n');
  assert.throws(() => h.make().apply(plan.code), /nothing was removed/);
  assert.equal(fs.readFileSync(path.join(h.agents.claude, 'toolkit-g0.md'), 'utf8'), 'edited by hand, marker gone\n');
  assert.ok(fs.existsSync(path.join(h.environment.CLAUDE_CONFIG_DIR, 'settings.json')));
  assert.equal(h.depth.inspect().state, 'toolkit-one-layer');
});

test('full removal: a part that cannot be read is held and the rest of the plan still shows', t => {
  const home = s.tempHome(t);
  const broken = { key: 'broken', title: 'Broken part', plan() { throw new Error('unreadable'); }, apply() { throw new Error('must not run'); } };
  const plan = new removal.ToolkitRemoval({ home, parts: [broken] }).plan();
  assert.match(removal.describePlan(plan).join('\n'), /Broken part:\n- Broken part: left alone, could not be read \(unreadable\)/);
});

test('plugin state reads the Claude Code registry and the Codex config and cache', t => {
  const home = s.tempHome(t);
  const environment = { CLAUDE_CONFIG_DIR: path.join(home, '.claude'), CODEX_HOME: path.join(home, '.codex') };
  assert.deepEqual(parts.pluginState({ environment, home }), { 'claude-code': false, codex: false });
  fs.mkdirSync(path.join(home, '.claude', 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: { [parts.PLUGIN_ID]: [{ scope: 'user' }] } }));
  fs.mkdirSync(path.join(home, '.codex', 'plugins', 'cache', parts.MARKETPLACE, 'ai-agent-toolkit'), { recursive: true });
  assert.deepEqual(parts.pluginState({ environment, home }), { 'claude-code': true, codex: false }, 'a cache without the config entry is not an install');
  fs.writeFileSync(path.join(home, '.codex', 'config.toml'), `model = "x"\n\n[plugins."${parts.PLUGIN_ID}"]\nenabled = true\n`);
  assert.deepEqual(parts.pluginState({ environment, home }), { 'claude-code': true, codex: true });
});

test('the setup skill routes remove toolkit to the full plan, never the app uninstall tool alone', () => {
  // A Codex session whose plugin cache moved on could not read this skill, saw only its listing, and
  // answered `remove toolkit` with Codex's own plugin uninstall tool, leaving everything else behind.
  const skill = fs.readFileSync(path.join(__dirname, '..', '..', 'skills', 'toolkit-setup', 'SKILL.md'), 'utf8');
  const description = skill.split('\n').find(line => line.startsWith('description: ')).slice('description: '.length);
  assert.ok(description.length <= 1024, `description ${description.length} characters`);
  assert.match(description, /`remove toolkit` to run the full removal plan \(`toolkit-remove\.cjs plan`[^)]*\), never the app's own plugin uninstall alone/);
  const section = skill.split('## Remove Toolkit from this computer')[1].split('\n## ')[0];
  assert.match(section, /Do this even when the app offers its own plugin uninstall tool \(such as Codex's `uninstall_plugin`\) or the plugin is already gone/);
  assert.match(section, /an app's own uninstall tool may do this step for that app/);
  assert.ok(section.indexOf('toolkit-remove.cjs plan') < section.indexOf('Only after a yes'), 'the plan comes before any uninstall');
  // The app's own uninstall tool is allowed only as a step after the user's yes, never before the plan is shown.
  const afterYes = section.slice(section.indexOf('Only after a yes'));
  assert.equal(section.split("an app's own uninstall tool may do this step").length, 2, 'the allowance appears once');
  assert.match(afterYes.split('. ')[0], /an app's own uninstall tool may do this step for that app/, 'the allowance sits in the step after the yes');
});
